/**
 * ChannelBridge — Provider-agnostic bridge between chat adapters and the pi SDK.
 *
 * Handles:
 * - Per-sender AgentManager lifecycle
 * - FIFO message queue per sender
 * - Concurrent message processing
 * - Command routing (/new, /sessions, etc.)
 * - Session storage shared with web UI
 */

import { existsSync } from 'node:fs'
import type {
  ChannelAdapter,
  IncomingMessage,
  IncomingAttachment,
  SenderSession,
  QueuedPrompt,
  CommandResult,
  InlineKeyboardMarkup,
} from './types'
import { AgentManager } from '../agent-manager'
import { processCommand } from './commands'
import { log, PATHS } from '../options'
import { SenderSessionRegistry } from './sender-session-registry'
import { startTypingLoop } from './typing'
import { AuthStorage } from '@mariozechner/pi-coding-agent'
import type { ResourceLoader } from '@mariozechner/pi-coding-agent'
import { createResourceLoader } from '../resource-loader'
import type { AgentSessionEvent } from '@mariozechner/pi-coding-agent'
import { formatSourceHeader, markdownToTelegramHTML } from './message-format'

/**
 * Create a unique sender ID for a chat/user.
 * For Telegram: chat ID (e.g., "-1001234567890" for groups, "123456789" for users)
 */
function getSenderId(adapter: string, sender: string): string {
  return `${adapter}:${sender}`
}

interface ActiveDraftState {
  draftId: number
  source: string
  phase: 'status' | 'text' | 'done'
  body: string
}

export class ChannelBridge {
  private adapters: Map<string, ChannelAdapter> = new Map()
  private agentManagers: Map<string, AgentManager> = new Map()
  private senderSessions: Map<string, SenderSession> = new Map()
  private draftCounter = 0
  private running = false
  private maxConcurrent: number
  private processingCount = 0
  private provider: string
  private modelId: string
  private resourceLoader: ResourceLoader
  private authStorage: AuthStorage
  private typingIndicators: boolean
  private streamingDrafts: boolean
  private streamingIntervalMs: number
  private abortControllers: Map<string, AbortController> = new Map()
  private activeDrafts: Map<string, ActiveDraftState> = new Map()
  private currentDraftSources: Map<string, string> = new Map()
  /** Cleanup functions for active typing loops, keyed by senderId. */
  private stopTypingFunctions: Map<string, () => void> = new Map()
  /** Timestamp of the last throttled draft send per sender, for token-stream rate limiting. */
  private lastDraftSent: Map<string, number> = new Map()
  /** Persists senderId → sessionFile across server restarts. */
  private senderSessionRegistry: SenderSessionRegistry

  constructor(config: {
    provider: string
    modelId: string
    resourceLoader: ResourceLoader
    authStorage: AuthStorage
    maxConcurrent?: number
    typingIndicators?: boolean
    /** Stream partial responses via Telegram Bot API 9.3+ sendMessageDraft (default: true). */
    streamingDrafts?: boolean
    /** Minimum ms between draft token updates; lower = smoother but more API calls (default: 500). */
    streamingIntervalMs?: number
    /**
     * Injectable SenderSessionRegistry instance (for testing).
     * Defaults to a file-backed registry at
     * `${PATHS.piAgentDir}/bridge-sessions.json`.
     */
    senderSessionRegistry?: SenderSessionRegistry
  }) {
    this.provider = config.provider
    this.modelId = config.modelId
    this.resourceLoader = config.resourceLoader
    this.authStorage = config.authStorage
    this.maxConcurrent = config.maxConcurrent ?? 2
    this.typingIndicators = config.typingIndicators ?? true
    this.streamingDrafts = config.streamingDrafts ?? true
    this.streamingIntervalMs = config.streamingIntervalMs ?? 500
    this.senderSessionRegistry =
      config.senderSessionRegistry ?? new SenderSessionRegistry(`${PATHS.piAgentDir}/bridge-sessions.json`)
  }

  /**
   * Register a channel adapter under an explicit name.
   *
   * Using an explicit name prevents adapters of the same direction from
   * silently overwriting each other in the internal map.
   */
  registerAdapter(name: string, adapter: ChannelAdapter): void {
    this.adapters.set(name, adapter)
    log.info(`Registered adapter: ${name} (${adapter.direction})`)
  }

  /**
   * Return the first registered adapter that supports sending
   * (direction === 'outgoing' or 'bidirectional').
   * Returns undefined when no suitable adapter is registered.
   */
  private getAdapter(): ChannelAdapter | undefined {
    for (const adapter of this.adapters.values()) {
      if (adapter.direction === 'bidirectional' || adapter.direction === 'outgoing') {
        return adapter
      }
    }
    return undefined
  }

  /**
   * Start all registered adapters.
   */
  async start(): Promise<void> {
    if (this.running) return
    this.running = true

    for (const [name, adapter] of this.adapters) {
      try {
        if (adapter.start) {
          await adapter.start((msg) => {
            void this.handleIncomingMessage(msg).catch((err: any) => {
              log.error(`Unhandled incoming message error from ${name}:`, err.message)
            })
          })
          log.info(`Started adapter: ${name}`)
        }
      } catch (err: any) {
        log.error(`Failed to start adapter ${name}:`, err.message)
      }
    }
  }

  /**
   * Stop all registered adapters.
   */
  async stop(): Promise<void> {
    this.running = false

    for (const [name, adapter] of this.adapters) {
      try {
        if (adapter.stop) {
          await adapter.stop()
          log.info(`Stopped adapter: ${name}`)
        }
      } catch (err: any) {
        log.error(`Failed to stop adapter ${name}:`, err.message)
      }
    }
  }

  /**
   * Handle an incoming message from any adapter.
   */
  private async handleIncomingMessage(msg: IncomingMessage): Promise<void> {
    const senderId = getSenderId(msg.adapter, msg.sender)
    const session = this.getOrCreateSession(msg.adapter, msg.sender)

    // Parse if it's a command
    const agentManager = await this.getAgentManager(senderId)
    const command = await processCommand(agentManager, msg.text)

    if (command) {
      // Empty command responses are intentional no-ops (e.g. page-indicator buttons).
      // They should not be sent back to the user or treated as prompts.
      if (command.text.trim().length === 0) {
        return
      }

      // Send the command response
      if (this.typingIndicators) {
        await this.sendTyping(msg.adapter, msg.sender)
      }

      const isCallback = msg.metadata?.isCallback === true
      const editMessageId = isCallback ? (msg.metadata?.messageId as number | undefined) : undefined

      await this.sendMessage(
        {
          adapter: msg.adapter,
          recipient: msg.sender,
          text: command.text,
          editMessageId,
        },
        command.markup as InlineKeyboardMarkup | undefined
      )

      // Commands like /new and /session <ID> change the active session file.
      // Persist the updated mapping so the next restart resumes correctly.
      this.persistSessionFile(senderId, agentManager)

      return
    }

    // Queue the message for processing
    const queued: QueuedPrompt = {
      id: crypto.randomUUID(),
      adapter: msg.adapter,
      sender: msg.sender,
      text: msg.text,
      attachments: msg.attachments,
      metadata: msg.metadata,
      enqueuedAt: Date.now(),
    }

    session.queue.push(queued)

    // Process if we have capacity
    if (this.processingCount < this.maxConcurrent) {
      void this.processQueue(senderId).catch((err: any) => {
        log.error(`Unhandled queue processing error for ${senderId}:`, err.message)
      })
    }
  }

  /**
   * Process the message queue for a sender.
   */
  private async processQueue(senderId: string): Promise<void> {
    if (this.processingCount >= this.maxConcurrent) {
      return
    }

    const session = this.senderSessions.get(senderId)
    if (!session || session.processing || session.queue.length === 0) {
      return
    }

    session.processing = true
    this.processingCount++

    // Declare outside try so finally can always reach it
    let stopTyping: (() => void) | null = null

    try {
      const prompt = session.queue.shift()!

      const agentManager = await this.getAgentManager(senderId)

      // Start typing indicators
      if (this.typingIndicators) {
        const channelAdapter = this.getAdapter()
        if (channelAdapter?.sendTyping) {
          stopTyping = startTypingLoop({
            adapter: channelAdapter,
            recipient: prompt.sender,
            intervalMs: 4000,
          })
          // Store so handleAgentEvent can stop it when streaming begins
          this.stopTypingFunctions.set(senderId, stopTyping)
        }
      }

      // Resolve the current model before generation starts so draft bubbles can show
      // the source header from the very beginning.
      const stateBeforePrompt = agentManager.getState()
      const modelSource = stateBeforePrompt?.model ? `🤖 ${stateBeforePrompt.model}` : 'agent'
      this.currentDraftSources.set(senderId, modelSource)

      // Execute the prompt and process response
      await agentManager.prompt(prompt.text)

      // Get the response from the session
      const messages = agentManager.getMessages()
      const assistantMessage = messages
        .slice()
        .reverse()
        .find((m) => (m as { role: string }).role === 'assistant' || (m as { role: string }).role === 'ai')

      // Handle content that may be an array (pi SDK returns (TextContent | ThinkingContent | ToolCall)[]).
      // Only type==='text' blocks are extracted; tool calls and thinking blocks are skipped
      // to avoid [object Object] appearing in the final message.
      const content = (assistantMessage as { content?: unknown } | undefined)?.content
      const responseText = Array.isArray(content)
        ? content
            .filter((block) => (block as { type?: string }).type === 'text')
            .map((block) => (block as { type: 'text'; text: string }).text)
            .join('\n') || 'No response generated.'
        : typeof content === 'string'
          ? content
          : 'No response generated.'

      const activeDraft = this.activeDrafts.get(senderId)

      // If a streaming draft bubble is still pending (not yet finalized by the event stream),
      // finalize it now so the draft preview reflects the complete response.
      if (activeDraft && activeDraft.phase !== 'done') {
        await this.finalizeDraft(senderId, prompt.adapter, prompt.sender, responseText, undefined, modelSource)
      }

      // Always deliver the permanent message via sendMessage.
      // sendMessageDraft only shows a transient typing-animation preview — it disappears when
      // the typing indicator ends and is never stored as a chat message by Telegram.
      // The authoritative, persistent reply must always be sent via sendMessage.
      await this.sendMessage(
        {
          adapter: prompt.adapter,
          recipient: prompt.sender,
          text: responseText,
          source: modelSource,
        },
        undefined
      )

      // Clear abort controller after completion
      const controller = this.abortControllers.get(senderId)
      if (controller) {
        controller.abort()
        this.abortControllers.delete(senderId)
      }

      // Persist the session file so that the next restart resumes this conversation.
      this.persistSessionFile(senderId, agentManager)
    } catch (err: any) {
      log.error(`Error processing message for ${senderId}:`, err.message)

      // Send error message back to user
      await this.sendMessage({
        adapter: session.adapter,
        recipient: session.sender,
        text: `❌ Error: ${err.message}`,
        source: 'telegram:error',
      })
    } finally {
      // Always stop typing indicator, regardless of success or failure
      if (stopTyping) {
        stopTyping()
      }
      // Clean up per-sender streaming state (no-op if already cleaned up by event handler)
      this.stopTypingFunctions.delete(senderId)
      this.activeDrafts.delete(senderId)
      this.currentDraftSources.delete(senderId)
      this.lastDraftSent.delete(senderId)

      session.processing = false
      this.processingCount--

      // Process next queued message if available
      if (session.queue.length > 0) {
        this.processQueue(senderId)
      }
    }
  }

  /**
   * Save the current session file for `senderId` into the registry.
   * Called after init, after commands, and after prompt completion so the
   * mapping is always up-to-date regardless of how the session changed.
   */
  private persistSessionFile(senderId: string, agentManager: AgentManager): void {
    const sessionFile = agentManager.getState()?.sessionFile
    if (sessionFile) {
      this.senderSessionRegistry.set(senderId, sessionFile)
    }
  }

  /**
   * Get or create an AgentManager for a sender.
   *
   * On first call for a given sender after a server restart the registry is
   * consulted.  If a session file was recorded from the previous run it is
   * passed to `AgentManager.init()`, which opens it via `SessionManager.open()`
   * so the conversation history is preserved.  A missing or corrupted file
   * transparently falls back to a fresh session.
   */
  private async getAgentManager(senderId: string): Promise<AgentManager> {
    if (this.agentManagers.has(senderId)) {
      const existing = this.agentManagers.get(senderId)!

      // Guard: if the session file was deleted (e.g. via the web UI) while this
      // manager was cached in memory, the SDK's _persist() would recreate the
      // file via appendFileSync without writing the session header first.
      // Detect this by checking whether the file still exists when the session
      // has already accumulated messages (messageCount > 0 means it was previously
      // written; messageCount === 0 means it's a fresh session whose file hasn't
      // been written yet — that is normal and should not trigger a reset).
      const state = existing.getState()
      if (state?.sessionFile && state.messageCount > 0 && !existsSync(state.sessionFile)) {
        log.info(`Session file deleted for ${senderId}, starting a new session`)
        await existing.newSession()
        this.persistSessionFile(senderId, existing)
      }

      return existing
    }

    const agentManager = new AgentManager(this.provider, this.modelId, this.resourceLoader, this.authStorage)

    // Subscribe to agent events for streaming responses
    const unsubscribe = agentManager.subscribe((event) => {
      this.handleAgentEvent(senderId, event)
    })

    // Look up the last known session file for this sender.
    const lastSessionFile = this.senderSessionRegistry.get(senderId)
    if (lastSessionFile) {
      log.info(`Resuming session for ${senderId}: ${lastSessionFile}`)
    }

    // Initialize the agent manager — resumes last session if file exists on disk.
    try {
      await agentManager.init(lastSessionFile)
    } catch (err: any) {
      log.error(`Failed to initialize AgentManager for ${senderId}:`, err.message)
      throw err
    }

    // Persist the session file (may differ from lastSessionFile if the stored
    // path no longer existed and the SDK created a new session).
    this.persistSessionFile(senderId, agentManager)

    this.agentManagers.set(senderId, agentManager)
    this.unsubscribeFunctions.set(senderId, unsubscribe)

    return agentManager
  }

  /**
   * Get or create a session record for a sender.
   */
  private getOrCreateSession(adapter: string, sender: string): SenderSession {
    const senderId = getSenderId(adapter, sender)

    if (this.senderSessions.has(senderId)) {
      return this.senderSessions.get(senderId)!
    }

    const session: SenderSession = {
      adapter,
      sender,
      displayName: sender,
      queue: [],
      processing: false,
      abortController: null,
      messageCount: 0,
      startedAt: Date.now(),
    }

    this.senderSessions.set(senderId, session)
    return session
  }

  /**
   * Store an unsubscribe function for a sender (separate map, not part of SenderSession).
   */
  private unsubscribeFunctions: Map<string, () => void> = new Map()

  /**
   * Handle agent session events.
   *
   * Drives the draft state machine:
   *   thinking_start       → show “<i>🤔</i>” (immediate)
   *   tool_execution_start → show “<i>Using bash...</i>” (immediate, stops typing loop)
   *   text_start           → switch the active bubble into text mode
   *   text_delta           → append token, throttled send (no parse_mode)
   *   text_end             → finalize the active bubble in place
   *   message_end          → count message (cleanup happens in processQueue)
   */
  private async handleAgentEvent(senderId: string, event: AgentSessionEvent): Promise<void> {
    const session = this.senderSessions.get(senderId)
    if (!session) return

    const senderIdParts = senderId.split(':')
    const adapter = senderIdParts[0]
    const sender = senderIdParts.slice(1).join(':')
    const source = this.getDraftSource(senderId)

    log.debug(`Agent event for ${senderId}: ${event.type}`)

    if (event.type === 'message_end') {
      session.messageCount++
      return
    }

    if (event.type === 'message_update') {
      const ae = event.assistantMessageEvent
      if (!ae) return

      if (ae.type === 'thinking_start') {
        const active = this.activeDrafts.get(senderId)
        if (active?.phase === 'text' && active.body) {
          await this.finalizeDraft(senderId, adapter, sender, active.body, undefined, active.source)
        }
        await this.sendDraftStatus(senderId, adapter, sender, source, '<i>🤔</i>')
        this.stopTypingFunctions.get(senderId)?.()
        this.stopTypingFunctions.delete(senderId)
      } else if (ae.type === 'text_start') {
        await this.transitionToText(senderId, adapter, sender, source)
        this.stopTypingFunctions.get(senderId)?.()
        this.stopTypingFunctions.delete(senderId)
      } else if (ae.type === 'text_delta') {
        await this.appendDraftToken(senderId, adapter, sender, source, ae.delta)
      } else if (ae.type === 'text_end') {
        const active = this.activeDrafts.get(senderId)
        if (active?.phase === 'text') {
          await this.finalizeDraft(senderId, adapter, sender, active.body, undefined, active.source)
        }
      }
      return
    }

    if (event.type === 'tool_execution_start') {
      const active = this.activeDrafts.get(senderId)
      if (active?.phase === 'text' && active.body) {
        await this.finalizeDraft(senderId, adapter, sender, active.body, undefined, active.source)
      }
      await this.sendDraftStatus(senderId, adapter, sender, source, `<i>Using ${event.toolName}...</i>`)
      this.stopTypingFunctions.get(senderId)?.()
      this.stopTypingFunctions.delete(senderId)
    }
  }

  /**
   * Get the source label for an active draft segment.
   */
  private getDraftSource(senderId: string): string {
    return this.currentDraftSources.get(senderId) ?? 'agent'
  }

  /**
   * Start draft streaming for a sender.
   * Returns the draft ID if streaming is enabled and the adapter supports it, null otherwise.
   */
  private startDraftStreaming(senderId: string, source = this.getDraftSource(senderId)): number | null {
    if (!this.streamingDrafts) return null
    const channelAdapter = this.getAdapter()
    if (!channelAdapter || !channelAdapter.sendDraft) return null

    const draftId = ++this.draftCounter
    this.activeDrafts.set(senderId, { draftId, source, phase: 'status', body: '' })
    return draftId
  }

  /**
   * Get the currently active draft, creating a new one if needed.
   */
  private ensureActiveDraft(senderId: string, source = this.getDraftSource(senderId)): ActiveDraftState | null {
    const active = this.activeDrafts.get(senderId)
    if (active && active.phase !== 'done') {
      return active
    }

    const draftId = this.startDraftStreaming(senderId, source)
    if (draftId === null) return null
    return this.activeDrafts.get(senderId) ?? null
  }

  /**
   * Overwrite the current draft with a complete status message.
   * Sends immediately with HTML parse_mode so italic tags render correctly.
   * Bypasses the token-stream throttle — status changes are infrequent.
   */
  private async sendDraftStatus(
    senderId: string,
    adapter: string,
    recipient: string,
    source: string,
    html: string
  ): Promise<void> {
    const active = this.ensureActiveDraft(senderId, source)
    if (!active) return

    active.phase = 'status'
    active.body = html
    this.lastDraftSent.set(senderId, Date.now())
    await this.sendDraft(adapter, recipient, active.draftId, `${formatSourceHeader(active.source)}${html}`, 'HTML')
  }

  /**
   * Switch the active draft into text mode.
   */
  private async transitionToText(senderId: string, adapter: string, recipient: string, source: string): Promise<void> {
    const active = this.ensureActiveDraft(senderId, source)
    if (!active || active.phase === 'text') return

    active.phase = 'text'
    active.body = ''
    this.lastDraftSent.delete(senderId)
    await this.sendDraft(adapter, recipient, active.draftId, formatSourceHeader(active.source))
  }

  /**
   * Append a streamed token to the current draft and send it throttled.
   * No parse_mode — partial markdown cannot be safely rendered mid-stream.
   */
  private async appendDraftToken(
    senderId: string,
    adapter: string,
    recipient: string,
    source: string,
    delta: string
  ): Promise<void> {
    const active = this.ensureActiveDraft(senderId, source)
    if (!active) return

    if (active.phase !== 'text') {
      await this.transitionToText(senderId, adapter, recipient, source)
    }

    const current = this.activeDrafts.get(senderId)
    if (!current) return

    current.phase = 'text'
    current.body += delta
    const lastSent = this.lastDraftSent.get(senderId) ?? 0
    if (Date.now() - lastSent < this.streamingIntervalMs) return
    this.lastDraftSent.set(senderId, Date.now())
    await this.sendDraft(adapter, recipient, current.draftId, `${formatSourceHeader(current.source)}${current.body}`)
  }

  /**
   * Finalize draft: deliver the fully-formatted final message.
   * Replaces any previous status with the complete response.
   */
  private async finalizeDraft(
    senderId: string,
    adapter: string,
    recipient: string,
    text: string,
    markup?: InlineKeyboardMarkup,
    source?: string
  ): Promise<boolean> {
    const active = this.activeDrafts.get(senderId)
    if (!active || active.phase === 'done') return false

    const draftSource = source ?? active.source ?? this.getDraftSource(senderId)
    const fullText = markdownToTelegramHTML(`${formatSourceHeader(draftSource)}${text}`)

    this.lastDraftSent.set(senderId, Date.now())
    const sent = await this.sendDraft(adapter, recipient, active.draftId, fullText, 'HTML')
    if (!sent) return false

    active.phase = 'done'
    active.body = text
    return true
  }

  /**
   * Send a message to a recipient.
   */
  private async sendMessage(
    message: { adapter: string; recipient: string; text: string; source?: string; editMessageId?: number },
    markup?: InlineKeyboardMarkup
  ): Promise<boolean> {
    const adapter = this.getAdapter()
    if (!adapter || !adapter.send) {
      log.error('No outgoing adapter available')
      return false
    }

    try {
      await adapter.send({
        adapter: message.adapter,
        recipient: message.recipient,
        text: message.text,
        source: message.source,
        markup: markup,
        editMessageId: message.editMessageId,
      })
      return true
    } catch (err: any) {
      log.error(`Failed to send message to ${message.adapter}:${message.recipient}:`, err.message)
      return false
    }
  }

  /**
   * Send a typing indicator to a recipient.
   */
  private async sendTyping(adapter: string, recipient: string): Promise<void> {
    const channelAdapter = this.getAdapter()
    if (!channelAdapter || !channelAdapter.sendTyping) {
      return
    }

    await channelAdapter.sendTyping(recipient)
  }

  /**
   * Send a draft update via the adapter.
   * Returns true when the update was handed off to the adapter, false on failure.
   * @param parseMode - Pass 'HTML' for complete status messages; omit for raw token streams.
   */
  private async sendDraft(
    adapter: string,
    recipient: string,
    draftId: number,
    text: string,
    parseMode?: string
  ): Promise<boolean> {
    const channelAdapter = this.getAdapter()
    if (!channelAdapter || !channelAdapter.sendDraft) return false

    try {
      await channelAdapter.sendDraft(recipient, draftId, text, parseMode)
      return true
    } catch (err: any) {
      log.debug(`Failed to send draft: ${err.message}`)
      // Best-effort — draft streaming is optional
      return false
    }
  }

  /**
   * Abort current generation for a sender.
   */
  async abort(senderId: string): Promise<void> {
    const agentManager = this.agentManagers.get(senderId)
    if (agentManager) {
      await agentManager.abort()
    }

    const abortController = this.abortControllers.get(senderId)
    if (abortController) {
      abortController.abort()
      this.abortControllers.delete(senderId)
    }
  }

  /**
   * Get current state of all sessions.
   */
  getStates(): Map<string, any> {
    const states = new Map<string, any>()

    for (const [senderId, agentManager] of this.agentManagers) {
      const state = agentManager.getState()
      if (state) {
        states.set(senderId, state)
      }
    }

    return states
  }
}
