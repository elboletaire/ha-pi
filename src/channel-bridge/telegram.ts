/**
 * pi-channels — Built-in Telegram adapter (bidirectional).
 *
 * Outgoing: Telegram Bot API sendMessage.
 * Incoming: Long-polling via getUpdates.
 *
 * Supports:
 *   - Text messages
 *   - Photos (downloaded → temp file → passed as image attachment)
 *   - Documents (text files downloaded → content included in message)
 *   - PDFs (text extracted via pdftotext/fallback, up to 10MB)
 *   - Voice messages (transcribed via Wyoming Vosk STT, up to 20MB)
 *   - File size validation (1MB text docs, 10MB PDFs/images, 20MB voice)
 *   - MIME type filtering (text-like files only for documents)
 *
 * Config (in settings.json under pi-channels.adapters.telegram):
 * {
 *   "type": "telegram",
 *   "botToken": "your-telegram-bot-token",
 *   "parseMode": "Markdown",
 *   "polling": true,
 *   "pollingTimeout": 30,
 *   "allowedChatIds": ["<YOUR_CHAT_ID>", "<GROUP_CHAT_ID>"]
 * }
 */

import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { convertToPcm } from './audio-convert'
import { getCommandsForTelegram } from './commands'
import { extractPdfText } from './pdf-extract'
import type {
  AdapterConfig,
  ChannelAdapter,
  ChannelMessage,
  IncomingAttachment,
  IncomingMessage,
  OnIncomingMessage,
} from './types'
import { log } from '../options'
import { transcribeAudio, type WyomingSttOptions } from './wyoming-stt'

const MAX_LENGTH = 4096
const MAX_FILE_SIZE = 1_048_576 // 1MB — for text documents inlined into prompt
const MAX_PDF_SIZE = 10_485_760 // 10MB — PDFs extracted to text before prompt
const MAX_VOICE_SIZE = 20_971_520 // 20MB — Telegram Bot API download limit
const MAX_IMAGE_SIZE = 10_485_760 // 10MB — generous for photos

/** MIME types we treat as text documents (content inlined into the prompt). */
const TEXT_MIME_TYPES = new Set([
  'text/plain',
  'text/markdown',
  'text/csv',
  'text/html',
  'text/xml',
  'text/css',
  'text/javascript',
  'application/json',
  'application/xml',
  'application/javascript',
  'application/typescript',
  'application/x-yaml',
  'application/x-toml',
  'application/x-sh',
])

/** File extensions we treat as text even if MIME is generic (application/octet-stream). */
const TEXT_EXTENSIONS = new Set([
  '.md',
  '.markdown',
  '.txt',
  '.csv',
  '.json',
  '.jsonl',
  '.yaml',
  '.yml',
  '.toml',
  '.xml',
  '.html',
  '.htm',
  '.css',
  '.js',
  '.ts',
  '.tsx',
  '.jsx',
  '.py',
  '.rs',
  '.go',
  '.rb',
  '.php',
  '.java',
  '.kt',
  '.c',
  '.cpp',
  '.h',
  '.sh',
  '.bash',
  '.zsh',
  '.fish',
  '.sql',
  '.graphql',
  '.gql',
  '.env',
  '.ini',
  '.cfg',
  '.conf',
  '.properties',
  '.log',
  '.gitignore',
  '.dockerignore',
  '.editorconfig',
])

/** Image MIME prefixes. */
function isImageMime(mime: string | undefined): boolean {
  if (!mime) return false
  return mime.startsWith('image/')
}

function isTextDocument(mimeType: string | undefined, filename: string | undefined): boolean {
  if (mimeType && TEXT_MIME_TYPES.has(mimeType)) return true
  if (filename) {
    const ext = path.extname(filename).toLowerCase()
    if (TEXT_EXTENSIONS.has(ext)) return true
  }
  return false
}

function isPdf(mimeType: string | undefined, filename: string | undefined): boolean {
  if (mimeType === 'application/pdf') return true
  if (filename) {
    const ext = path.extname(filename).toLowerCase()
    if (ext === '.pdf') return true
  }
  return false
}

export function createTelegramAdapter(config: AdapterConfig): ChannelAdapter {
  const botToken = config.botToken as string
  const parseMode = config.parseMode as string | undefined
  const pollingEnabled = config.polling === true
  const pollingTimeout = (config.pollingTimeout as number) ?? 30
  const allowedChatIds = config.allowedChatIds as string[] | undefined

  if (!botToken) {
    throw new Error('Telegram adapter requires botToken')
  }

  const apiBase = `https://api.telegram.org/bot${botToken}`
  let offset = 0
  let running = false
  let abortController: AbortController | null = null

  // Track temp files for cleanup
  const tempFiles: string[] = []

  // ── Telegram API helpers ────────────────────────────────

  async function sendTelegram(chatId: string, text: string, replyMarkup?: unknown): Promise<void> {
    const body: Record<string, unknown> = { chat_id: chatId, text }
    if (parseMode) body.parse_mode = parseMode
    if (replyMarkup) body.reply_markup = replyMarkup

    const res = await fetch(`${apiBase}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })

    if (!res.ok) {
      const err = await res.text().catch(() => 'unknown error')
      throw new Error(`Telegram API error ${res.status}: ${err}`)
    }
  }

  /**
   * Send a file/document to a Telegram chat.
   * Uses multipart/form-data to upload the file.
   * Automatically picks sendPhoto for images or sendDocument for everything else.
   */
  async function sendFileToChat(chatId: string, filePath: string, caption?: string): Promise<void> {
    const fileBuffer = fs.readFileSync(filePath)
    const filename = path.basename(filePath)
    const ext = path.extname(filename).toLowerCase()

    // Pick API method: sendPhoto for images, sendDocument for everything else
    const imageExts = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp'])
    const isImage = imageExts.has(ext)
    const method = isImage ? 'sendPhoto' : 'sendDocument'
    const fieldName = isImage ? 'photo' : 'document'

    // Build multipart/form-data manually
    const boundary = `----PiChannels${Date.now()}${Math.random().toString(36).slice(2)}`

    const parts: Buffer[] = []

    // chat_id field
    parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="chat_id"\r\n\r\n${chatId}\r\n`))

    // caption field (optional)
    if (caption) {
      parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="caption"\r\n\r\n${caption}\r\n`))
      // parse_mode for caption
      if (parseMode) {
        parts.push(
          Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="parse_mode"\r\n\r\n${parseMode}\r\n`)
        )
      }
    }

    // file field
    const mimeType = guessMimeType(ext)
    parts.push(
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="${fieldName}"; filename="${filename}"\r\nContent-Type: ${mimeType}\r\n\r\n`
      )
    )
    parts.push(fileBuffer)
    parts.push(Buffer.from(`\r\n--${boundary}--\r\n`))

    const body = Buffer.concat(parts)

    const res = await fetch(`${apiBase}/${method}`, {
      method: 'POST',
      headers: {
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
      },
      body,
    })

    if (!res.ok) {
      const err = await res.text().catch(() => 'unknown error')
      throw new Error(`Telegram ${method} error ${res.status}: ${err}`)
    }
  }

  async function sendDraft(chatId: string, draftId: number, text: string, parseMode?: string): Promise<void> {
    // Clamp text to API limits (1-4096 chars)
    const clamped = text.length > 4096 ? text.slice(0, 4096) : text
    if (!clamped) return

    const body: Record<string, unknown> = {
      chat_id: chatId,
      draft_id: draftId,
      text: clamped,
    }
    // Only set parse_mode for complete status messages (e.g. '<i>Thinking...</i>').
    // Token streams are partial and must not use parse_mode — unclosed tags break the parser.
    if (parseMode) body.parse_mode = parseMode

    try {
      const res = await fetch(`${apiBase}/sendMessageDraft`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      // Best-effort — don't throw on failures (API may not support it yet)
      if (!res.ok) {
        // Silently ignore — draft streaming is nice-to-have
      }
    } catch {
      // Best-effort
    }
  }

  async function sendChatAction(chatId: string, action = 'typing'): Promise<void> {
    try {
      await fetch(`${apiBase}/sendChatAction`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, action }),
      })
    } catch {
      // Best-effort
    }
  }

  /**
   * Download a file from Telegram by file_id.
   * Returns { path, size } or null on failure.
   * @param maxSize - Maximum allowed file size in bytes (default: MAX_FILE_SIZE)
   */
  async function downloadFile(
    fileId: string,
    suggestedName?: string,
    maxSize = MAX_FILE_SIZE
  ): Promise<{ localPath: string; size: number } | null> {
    try {
      // Get file info
      const infoRes = await fetch(`${apiBase}/getFile?file_id=${fileId}`)
      if (!infoRes.ok) return null

      const info = (await infoRes.json()) as {
        ok: boolean
        result?: { file_id: string; file_size?: number; file_path?: string }
      }
      if (!info.ok || !info.result?.file_path) return null

      const fileSize = info.result.file_size ?? 0

      // Size check before downloading
      if (fileSize > maxSize) return null

      // Download
      const fileUrl = `https://api.telegram.org/file/bot${botToken}/${info.result.file_path}`
      const fileRes = await fetch(fileUrl)
      if (!fileRes.ok) return null

      const buffer = Buffer.from(await fileRes.arrayBuffer())

      // Double-check size after download
      if (buffer.length > maxSize) return null

      // Write to temp file
      const ext = path.extname(info.result.file_path) || path.extname(suggestedName || '') || ''
      const tmpDir = path.join(os.tmpdir(), 'pi-channels')
      fs.mkdirSync(tmpDir, { recursive: true })
      const localPath = path.join(tmpDir, `${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`)
      fs.writeFileSync(localPath, buffer)
      tempFiles.push(localPath)

      return { localPath, size: buffer.length }
    } catch {
      return null
    }
  }

  // ── Message building helpers ────────────────────────────

  function buildBaseMetadata(msg: TelegramMessage): Record<string, unknown> {
    return {
      messageId: msg.message_id,
      chatType: msg.chat.type,
      chatTitle: msg.chat.title,
      userId: msg.from?.id,
      username: msg.from?.username,
      firstName: msg.from?.first_name,
      date: msg.date,
    }
  }

  function describeTelegramActor(chat: TelegramMessage['chat'], from?: TelegramMessage['from']): string {
    const parts: string[] = [`chat=${chat.type}:${chat.id}`]

    if (chat.title) {
      parts.push(`title=${chat.title}`)
    }

    if (from?.username) {
      parts.push(`username=@${from.username}`)
    } else if (from?.first_name) {
      parts.push(`name=${from.first_name}`)
    }

    return parts.join(' ')
  }

  // ── Incoming (long polling) ─────────────────────────────

  async function poll(onMessage: OnIncomingMessage): Promise<void> {
    while (running) {
      try {
        abortController = new AbortController()
        const url = `${apiBase}/getUpdates?offset=${offset}&timeout=${pollingTimeout}&allowed_updates=["message","callback_query"]`
        const res = await fetch(url, {
          signal: abortController.signal,
        })

        if (!res.ok) {
          await sleep(5000)
          continue
        }

        const data = (await res.json()) as {
          ok: boolean
          result: Array<{
            update_id: number
            message?: TelegramMessage
            callback_query?: TelegramCallbackQuery
          }>
        }

        if (!data.ok || !data.result?.length) continue

        for (const update of data.result) {
          offset = update.update_id + 1

          // Handle callback queries (inline button taps)
          const cbq = update.callback_query
          if (cbq && cbq.data && cbq.message) {
            const chatId = String(cbq.message.chat.id)
            if (allowedChatIds && !allowedChatIds.includes(chatId)) {
              log.warn(
                `Rejected Telegram callback from unauthorized chat ${describeTelegramActor(cbq.message.chat, cbq.from)}`
              )
              continue
            }

            // Answer the callback (removes loading spinner on button)
            fetch(`${apiBase}/answerCallbackQuery`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ callback_query_id: cbq.id }),
            }).catch(() => {})

            // Route as a normal text message
            const incoming: IncomingMessage = {
              adapter: 'telegram',
              sender: chatId,
              text: cbq.data,
              metadata: {
                messageId: cbq.message.message_id,
                chatType: cbq.message.chat.type,
                userId: cbq.from?.id,
                username: cbq.from?.username,
                firstName: cbq.from?.first_name,
                date: cbq.message.date,
                isCallback: true,
              },
            }
            onMessage(incoming)
            continue
          }

          const msg = update.message
          if (!msg) continue

          const chatId = String(msg.chat.id)
          if (allowedChatIds && !allowedChatIds.includes(chatId)) {
            log.warn(`Rejected Telegram message from unauthorized chat ${describeTelegramActor(msg.chat, msg.from)}`)
            continue
          }

          const incoming = await processMessage(msg, chatId)
          if (incoming) onMessage(incoming)
        }
      } catch (err: any) {
        if (err.name === 'AbortError') break
        if (running) await sleep(5000)
      }
    }
  }

  /**
   * Process a single Telegram message into an IncomingMessage.
   * Handles text, photos, and documents.
   */
  async function processMessage(msg: TelegramMessage, chatId: string): Promise<IncomingMessage | null> {
    const metadata = buildBaseMetadata(msg)
    const caption = msg.caption || ''

    // ── Photo ──────────────────────────────────────────
    if (msg.photo && msg.photo.length > 0) {
      // Pick the largest photo (last in array)
      const largest = msg.photo[msg.photo.length - 1]

      // Size check
      if (largest.file_size && largest.file_size > MAX_IMAGE_SIZE) {
        return {
          adapter: 'telegram',
          sender: chatId,
          text: `⚠️ Photo too large (${formatSize(largest.file_size)}, max ${formatSize(MAX_IMAGE_SIZE)}).`,
          metadata: { ...metadata, rejected: true },
        }
      }

      const downloaded = await downloadFile(largest.file_id, 'photo.jpg', MAX_IMAGE_SIZE)
      if (!downloaded) {
        return {
          adapter: 'telegram',
          sender: chatId,
          text: caption || '📷 (photo — failed to download)',
          metadata,
        }
      }

      const attachment: IncomingAttachment = {
        type: 'image',
        path: downloaded.localPath,
        filename: 'photo.jpg',
        mimeType: 'image/jpeg',
        size: downloaded.size,
      }

      return {
        adapter: 'telegram',
        sender: chatId,
        text: caption || 'Describe this image.',
        attachments: [attachment],
        metadata: { ...metadata, hasPhoto: true },
      }
    }

    // ── Document ───────────────────────────────────────
    if (msg.document) {
      const doc = msg.document
      const mimeType = doc.mime_type
      const filename = doc.file_name

      // Size check
      if (doc.file_size && doc.file_size > MAX_FILE_SIZE) {
        return {
          adapter: 'telegram',
          sender: chatId,
          text: `⚠️ File too large: ${filename || 'document'} (${formatSize(doc.file_size)}, max 1MB).`,
          metadata: { ...metadata, rejected: true },
        }
      }

      // Image documents (e.g. uncompressed photos sent as files)
      if (isImageMime(mimeType)) {
        const downloaded = await downloadFile(doc.file_id, filename)
        if (!downloaded) {
          return {
            adapter: 'telegram',
            sender: chatId,
            text: caption || `📎 ${filename || 'image'} (failed to download)`,
            metadata,
          }
        }

        const ext = path.extname(filename || '').toLowerCase()
        const attachment: IncomingAttachment = {
          type: 'image',
          path: downloaded.localPath,
          filename: filename || 'image',
          mimeType: mimeType || 'image/jpeg',
          size: downloaded.size,
        }

        return {
          adapter: 'telegram',
          sender: chatId,
          text: caption || 'Describe this image.',
          attachments: [attachment],
          metadata: { ...metadata, hasDocument: true, documentType: 'image' },
        }
      }

      // PDF documents — extract text and inline content
      if (isPdf(mimeType, filename)) {
        // Size check (PDFs get a generous limit — text extraction compresses well)
        if (doc.file_size && doc.file_size > MAX_PDF_SIZE) {
          return {
            adapter: 'telegram',
            sender: chatId,
            text: `⚠️ PDF too large: ${filename || 'document.pdf'} (${formatSize(doc.file_size)}, max ${formatSize(MAX_PDF_SIZE)}).`,
            metadata: { ...metadata, rejected: true },
          }
        }

        await sendChatAction(chatId, 'typing')

        const downloaded = await downloadFile(doc.file_id, filename, MAX_PDF_SIZE)
        if (!downloaded) {
          return {
            adapter: 'telegram',
            sender: chatId,
            text: caption || `📎 ${filename || 'document.pdf'} (failed to download)`,
            metadata,
          }
        }

        // Extract text from PDF
        const pdfText = extractPdfText(downloaded.localPath)
        if (!pdfText) {
          return {
            adapter: 'telegram',
            sender: chatId,
            text: `⚠️ Could not extract text from PDF "${filename || 'document.pdf'}". It may be a scanned (image-only) or protected PDF.`,
            metadata: { ...metadata, rejected: true },
          }
        }

        // Write extracted text to a temp file for the attachment
        const textPath = downloaded.localPath.replace(/\.pdf$/i, '.txt')
        fs.writeFileSync(textPath, pdfText, 'utf-8')

        const attachment: IncomingAttachment = {
          type: 'document',
          path: textPath,
          filename: (filename || 'document.pdf').replace(/\.pdf$/i, '.txt'),
          mimeType: 'text/plain',
          size: Buffer.byteLength(pdfText, 'utf-8'),
        }

        const pageInfo = pdfText.length > 1000 ? ` (~${Math.ceil(pdfText.length / 3000)} pages)` : ''

        return {
          adapter: 'telegram',
          sender: chatId,
          text: caption || `📄 PDF received: ${filename || 'document.pdf'}${pageInfo}. Text extracted below.`,
          attachments: [attachment],
          metadata: { ...metadata, hasDocument: true, documentType: 'pdf', originalFilename: filename },
        }
      }

      // Text documents — download and inline content
      if (isTextDocument(mimeType, filename)) {
        const downloaded = await downloadFile(doc.file_id, filename)
        if (!downloaded) {
          return {
            adapter: 'telegram',
            sender: chatId,
            text: caption || `📎 ${filename || 'document'} (failed to download)`,
            metadata,
          }
        }

        const attachment: IncomingAttachment = {
          type: 'document',
          path: downloaded.localPath,
          filename: filename || 'document',
          mimeType: mimeType || 'text/plain',
          size: downloaded.size,
        }

        return {
          adapter: 'telegram',
          sender: chatId,
          text: caption || `Here is the file ${filename || 'document'}.`,
          attachments: [attachment],
          metadata: { ...metadata, hasDocument: true, documentType: 'text' },
        }
      }

      // Unsupported file type
      return {
        adapter: 'telegram',
        sender: chatId,
        text: `⚠️ Unsupported file type: ${filename || 'document'} (${mimeType || 'unknown'}). Supported: text files, images, and PDFs.`,
        metadata: { ...metadata, rejected: true },
      }
    }

    // ── Voice ──────────────────────────────────────────
    if (msg.voice) {
      const voice = msg.voice

      // Show typing indicator while transcribing
      await sendChatAction(chatId, 'typing')

      // Size check (voice gets generous limit — audio compresses well for STT)
      if (voice.file_size && voice.file_size > MAX_VOICE_SIZE) {
        return {
          adapter: 'telegram',
          sender: chatId,
          text: `⚠️ Voice message too large (${formatSize(voice.file_size)}, max ${formatSize(MAX_VOICE_SIZE)}).`,
          metadata: { ...metadata, rejected: true },
        }
      }

      const downloaded = await downloadFile(voice.file_id, 'voice.oga', MAX_VOICE_SIZE)
      if (!downloaded) {
        return {
          adapter: 'telegram',
          sender: chatId,
          text: '⚠️ Failed to download voice message. Please try again or type your message.',
          metadata: { ...metadata, rejected: true },
        }
      }

      // Convert OGA → PCM (16kHz, mono, s16le)
      const pcm = convertToPcm(downloaded.localPath)
      if (!pcm || pcm.length === 0) {
        return {
          adapter: 'telegram',
          sender: chatId,
          text: '⚠️ Failed to process audio. Please try again or type your message.',
          metadata: { ...metadata, rejected: true },
        }
      }

      // Transcribe via Wyoming Vosk
      const sttOptions: Partial<WyomingSttOptions> = {}
      if (config.voiceTranscription) {
        const vt = config.voiceTranscription as Record<string, unknown>
        if (vt.host) sttOptions.host = vt.host as string
        if (vt.port) sttOptions.port = vt.port as number
        if (vt.language) sttOptions.language = vt.language as string
      }
      const transcript = await transcribeAudio(pcm, sttOptions)

      if (!transcript) {
        return {
          adapter: 'telegram',
          sender: chatId,
          text: '⚠️ Could not transcribe voice message. Please try again or type your message.',
          metadata: { ...metadata, rejected: true },
        }
      }

      return {
        adapter: 'telegram',
        sender: chatId,
        text: `[🎤 Voice transcription]: ${transcript}`,
        metadata: { ...metadata, hasVoice: true, voiceDuration: voice.duration },
      }
    }

    // ── Text ───────────────────────────────────────────
    if (msg.text) {
      return {
        adapter: 'telegram',
        sender: chatId,
        text: msg.text,
        metadata,
      }
    }

    // Unsupported message type (sticker, video note, etc.) — ignore
    return null
  }

  // ── Command sync ────────────────────────────────────────

  /**
   * Sync bot commands with Telegram API (setMyCommands).
   * Called on adapter start to ensure the bot menu matches real commands.
   */
  async function syncCommands(): Promise<void> {
    const cmds = getCommandsForTelegram()
    try {
      const res = await fetch(`${apiBase}/setMyCommands`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ commands: cmds }),
      })
      if (!res.ok) {
        const err = await res.text().catch(() => 'unknown')
        log.error(`Failed to sync Telegram commands: ${err}`)
      }
    } catch (err: any) {
      log.error(`Failed to sync Telegram commands: ${err.message}`)
    }
  }

  // ── Cleanup ─────────────────────────────────────────────

  function cleanupTempFiles(): void {
    for (const f of tempFiles) {
      try {
        fs.unlinkSync(f)
      } catch {
        /* ignore */
      }
    }
    tempFiles.length = 0
  }

  // ── Adapter ─────────────────────────────────────────────

  return {
    direction: 'bidirectional' as const,

    async sendTyping(recipient: string): Promise<void> {
      await sendChatAction(recipient, 'typing')
    },

    async sendFile(recipient: string, filePath: string, caption?: string): Promise<void> {
      await sendFileToChat(recipient, filePath, caption)
    },

    async sendDraft(recipient: string, draftId: number, text: string, parseMode?: string): Promise<void> {
      await sendDraft(recipient, draftId, text, parseMode)
    },

    async send(message: ChannelMessage): Promise<void> {
      const header = message.source ? formatSourceHeader(message.source) : ''
      const markdown = header ? `${header}\n${message.text}` : message.text

      // Convert Markdown to Telegram HTML
      const full = markdownToTelegramHTML(markdown)

      if (full.length <= MAX_LENGTH) {
        await sendTelegram(message.recipient, full, message.markup)
        return
      }

      // Split long messages at newlines — only attach markup to the last chunk
      let remaining = full
      while (remaining.length > 0) {
        if (remaining.length <= MAX_LENGTH) {
          await sendTelegram(message.recipient, remaining, message.markup)
          break
        }
        let splitAt = remaining.lastIndexOf('\n', MAX_LENGTH)
        if (splitAt < MAX_LENGTH / 2) splitAt = MAX_LENGTH
        await sendTelegram(message.recipient, remaining.slice(0, splitAt))
        remaining = remaining.slice(splitAt).replace(/^\n/, '')
      }
    },

    async start(onMessage: OnIncomingMessage): Promise<void> {
      if (!pollingEnabled) return
      if (running) return
      running = true
      // Sync bot command menu with actually registered commands
      await syncCommands()
      poll(onMessage)
    },

    async stop(): Promise<void> {
      running = false
      abortController?.abort()
      abortController = null
      cleanupTempFiles()
    },
  }
}

// ── Telegram API types (subset) ─────────────────────────────────

interface TelegramMessage {
  message_id: number
  from?: { id: number; username?: string; first_name?: string }
  chat: { id: number; type: string; title?: string }
  date: number
  text?: string
  caption?: string
  photo?: Array<{ file_id: string; file_unique_id: string; width: number; height: number; file_size?: number }>
  document?: {
    file_id: string
    file_unique_id: string
    file_name?: string
    mime_type?: string
    file_size?: number
  }
  voice?: {
    file_id: string
    file_unique_id: string
    duration: number
    mime_type?: string
    file_size?: number
  }
}

interface TelegramCallbackQuery {
  id: string
  from?: { id: number; username?: string; first_name?: string }
  message?: TelegramMessage
  data?: string
}

/**
 * Format a source label into a unified message header.
 *
 * Examples:
 *   "🤖 anthropic/claude-opus-4-6" → "🧠 Pi · opus-4-6 · 14 Mar 09:48\n───"
 *   "cron:daily-standup"           → "⏰ cron:daily-standup · 14 Mar 09:48\n───"
 *   "channel:test"                 → "🏓 test · 14 Mar 09:48\n───"
 */
function formatSourceHeader(source: string): string {
  const now = new Date()
  const day = now.getDate()
  const month = now.toLocaleString('en-GB', { month: 'short' })
  const time = now.toLocaleTimeString('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
  const timestamp = `${day} ${month} ${time}`

  // Agent reply: "🤖 provider/model" or "🤖 model"
  if (source.startsWith('🤖')) {
    const modelRaw = source.replace(/^🤖\s*/, '')
    const short = modelRaw.includes('/') ? modelRaw.split('/').pop()! : modelRaw
    return `🧠 Pi · ${short} · ${timestamp}\n───`
  }

  // Cron job: "cron:job-name"
  if (source.startsWith('cron:')) {
    return `⏰ ${source} · ${timestamp}\n───`
  }

  // Channel test: "channel:test"
  if (source.startsWith('channel:')) {
    const label = source.replace('channel:', '')
    return `🏓 ${label} · ${timestamp}\n───`
  }

  // Fallback: use source as-is
  return `📨 ${source} · ${timestamp}\n───`
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function guessMimeType(ext: string): string {
  const types: Record<string, string> = {
    '.pdf': 'application/pdf',
    '.doc': 'application/msword',
    '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    '.xls': 'application/vnd.ms-excel',
    '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    '.csv': 'text/csv',
    '.txt': 'text/plain',
    '.md': 'text/markdown',
    '.json': 'application/json',
    '.xml': 'application/xml',
    '.html': 'text/html',
    '.zip': 'application/zip',
    '.tar': 'application/x-tar',
    '.gz': 'application/gzip',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.bmp': 'image/bmp',
    '.svg': 'image/svg+xml',
    '.mp3': 'audio/mpeg',
    '.wav': 'audio/wav',
    '.mp4': 'video/mp4',
    '.webm': 'video/webm',
  }
  return types[ext] || 'application/octet-stream'
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`
  if (bytes < 1_048_576) return `${(bytes / 1024).toFixed(1)}KB`
  return `${(bytes / 1_048_576).toFixed(1)}MB`
}

/**
 * Convert Markdown table to aligned text format with <pre>.
 * Example:
 *   | Name | Age |     →    Name    Age
 *   |------|-----|          ───────────
 *   | Joan | 25  |          Joan     25
 */
function convertMarkdownTable(tableText: string): string {
  const lines = tableText.trim().split('\n')
  if (lines.length < 2) return tableText

  // Parse rows
  const rows = lines
    .filter((line) => !line.match(/^\s*\|?\s*[-:|\s]+\|?\s*$/)) // Skip separator lines
    .map(
      (line) =>
        line
          .split('|')
          .map((cell) => cell.trim())
          .filter((cell) => cell !== '') // Remove empty cells from leading/trailing |
    )

  if (rows.length === 0) return tableText

  // Calculate column widths
  const numCols = Math.max(...rows.map((r) => r.length))
  const colWidths: number[] = []
  for (let i = 0; i < numCols; i++) {
    const maxWidth = Math.max(...rows.map((r) => (r[i] || '').length))
    colWidths.push(maxWidth)
  }

  // Build aligned table
  const alignedRows = rows.map((row, idx) => {
    const cells = row.map((cell, colIdx) => cell.padEnd(colWidths[colIdx], ' '))
    return cells.join('  ').trimEnd() // 2 spaces between columns, trim trailing spaces
  })

  // Add separator after header (first row)
  const separator = '─'.repeat(alignedRows[0].length)
  alignedRows.splice(1, 0, separator)

  return `<pre>${alignedRows.join('\n')}</pre>`
}

/**
 * Convert Markdown to Telegram HTML format.
 * Supports: bold, italic, code, code blocks, headers, links, lists, tables.
 * Escapes HTML special characters to prevent breaking Telegram's parser.
 */
function markdownToTelegramHTML(text: string): string {
  // Escape HTML special characters (but not inside code blocks)
  const escapeHTML = (str: string) => str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

  // Step 1: Protect code blocks FIRST — must happen before inline code so that
  // backticks inside triple-backtick fences are not extracted as inline code spans.
  const codeBlocks: string[] = []
  let result = text.replace(/```([\s\S]*?)```/g, (match, code) => {
    const placeholder = `___CODEBLOCK_${codeBlocks.length}___`
    codeBlocks.push(`<pre>${escapeHTML(code.trim())}</pre>`)
    return placeholder
  })

  // Step 2: Protect inline code — safe now because triple-backtick regions are already
  // replaced with placeholders, so their content cannot be captured here.
  const inlineCodes: string[] = []
  result = result.replace(/`([^`]+)`/g, (match, code) => {
    const placeholder = `___INLINECODE_${inlineCodes.length}___`
    // Escape HTML in the code content so special chars are preserved in the final output
    inlineCodes.push(`<code>${escapeHTML(code)}</code>`)
    return placeholder
  })

  // Step 3: Convert Markdown tables to aligned text
  const tables: string[] = []
  result = result.replace(/(?:^\|.+\|$\n?)+/gm, (match) => {
    const placeholder = `___TABLE_${tables.length}___`
    tables.push(convertMarkdownTable(match))
    return placeholder
  })

  // Step 4: Escape remaining HTML in non-code content
  result = escapeHTML(result)

  // Step 5: Convert remaining Markdown to HTML
  let html = result

  // Headers (### Header → <b>Header</b>)
  html = html.replace(/^#{1,6}\s+(.+)$/gm, '<b>$1</b>')

  // Bold (**text** or __text__) - placeholders are safe as they contain no asterisks/underscores
  html = html.replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/(?<!_)__(?!_)(.+?)(?<!_)__(?!_)/g, '<b>$1</b>')

  // Italic (*text* or _text_) - use word boundary checks to avoid URLs
  html = html
    .replace(/(?<!\w)\*(.+?)\*(?!\w)/g, '<i>$1</i>')
    .replace(/(?<!\w)(?<!_)_(?!_)(.+?)(?<!_)_(?!_)(?!\w)/g, '<i>$1</i>')

  // Links [text](url) → <a href="url">text</a>
  html = html.replace(/\[(.+?)\]\((.+?)\)/g, '<a href="$2">$1</a>')

  // Step 6: Restore protected content (tables, code blocks, inline code)
  tables.forEach((table, i) => {
    html = html.replace(`___TABLE_${i}___`, table)
  })
  codeBlocks.forEach((code, i) => {
    html = html.replace(`___CODEBLOCK_${i}___`, code)
  })
  inlineCodes.forEach((code, i) => {
    html = html.replace(`___INLINECODE_${i}___`, code)
  })

  return html
}
