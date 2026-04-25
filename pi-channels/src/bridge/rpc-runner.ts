/**
 * pi-channels — Persistent RPC session runner.
 *
 * Maintains a long-lived `pi --mode rpc` subprocess per sender,
 * enabling persistent conversation context across messages.
 * Falls back to stateless runner if RPC fails to start.
 *
 * Lifecycle:
 *   1. First message from a sender spawns a new RPC subprocess
 *   2. Subsequent messages reuse the same subprocess (session persists)
 *   3. /new command or idle timeout restarts the session
 *   4. Subprocess crash triggers auto-restart on next message
 *
 * Context persistence:
 *   - When idle timeout fires, conversation messages are saved to a JSON file
 *   - On restart, saved messages are replayed into the new subprocess
 *   - Crash restarts notify the user that context was lost
 */

import { spawn, type ChildProcess } from 'node:child_process'
import * as readline from 'node:readline'
import * as fs from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'
import type { RunResult, IncomingAttachment } from '../types.ts'

export interface RpcRunnerOptions {
  cwd: string
  model?: string | null
  timeoutMs: number
  extensions?: string[]
}

interface PendingRequest {
  resolve: (result: RunResult) => void
  startTime: number
  timer: ReturnType<typeof setTimeout>
  textChunks: string[]
  abortHandler?: () => void
}

/**
 * A persistent RPC session for a single sender.
 * Wraps a `pi --mode rpc` subprocess.
 */
export class RpcSession {
  private child: ChildProcess | null = null
  private rl: readline.Interface | null = null
  private options: RpcRunnerOptions
  private pending: PendingRequest | null = null
  private ready = false
  private startedAt = 0
  private _onStreaming: ((text: string) => void) | null = null
  private _getMessagesResolve: ((messages: unknown[]) => void) | null = null

  constructor(options: RpcRunnerOptions) {
    this.options = options
  }

  /** Spawn the RPC subprocess if not already running. */
  async start(): Promise<boolean> {
    if (this.child && this.ready) return true
    this.cleanup()

    // Use --no-extensions to avoid loading workspace extensions that cause
    // port conflicts (pi-webserver EADDRINUSE). Only load the specific
    // extensions needed (e.g. llama-local for model resolution).
    const args = ['--mode', 'rpc', '--no-extensions']

    if (this.options.extensions?.length) {
      for (const ext of this.options.extensions) {
        args.push('-e', ext)
      }
    }

    if (this.options.model) args.push('--model', this.options.model)

    try {
      this.child = spawn('pi', args, {
        cwd: this.options.cwd,
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env },
      })
    } catch {
      return false
    }

    if (!this.child.stdout || !this.child.stdin) {
      this.cleanup()
      return false
    }

    this.rl = readline.createInterface({ input: this.child.stdout })
    this.rl.on('line', (line) => this.handleLine(line))

    this.child.on('close', () => {
      this.ready = false
      // Reject any pending request
      if (this.pending) {
        const p = this.pending
        this.pending = null
        clearTimeout(p.timer)
        const text = p.textChunks.join('')
        p.resolve({
          ok: false,
          response: text || '(session ended)',
          error: 'RPC subprocess exited unexpectedly',
          durationMs: Date.now() - p.startTime,
          exitCode: 1,
        })
      }
      this.child = null
      this.rl = null
    })

    this.child.on('error', () => {
      this.cleanup()
    })

    this.ready = true
    this.startedAt = Date.now()
    return true
  }

  /** Send a prompt and collect the full response. */
  runPrompt(
    prompt: string,
    options?: {
      signal?: AbortSignal
      attachments?: IncomingAttachment[]
      onStreaming?: (text: string) => void
    }
  ): Promise<RunResult> {
    return new Promise(async (resolve) => {
      // Ensure subprocess is running
      if (!this.ready) {
        const ok = await this.start()
        if (!ok) {
          resolve({
            ok: false,
            response: '',
            error: 'Failed to start RPC session',
            durationMs: 0,
            exitCode: 1,
          })
          return
        }
      }

      const startTime = Date.now()
      this._onStreaming = options?.onStreaming ?? null

      // Timeout
      const timer = setTimeout(() => {
        if (this.pending) {
          const p = this.pending
          this.pending = null
          const text = p.textChunks.join('')
          p.resolve({
            ok: false,
            response: text || '(timed out)',
            error: 'Timeout',
            durationMs: Date.now() - p.startTime,
            exitCode: 124,
          })
          // Kill and restart on next message
          this.cleanup()
        }
      }, this.options.timeoutMs)

      this.pending = { resolve, startTime, timer, textChunks: [] }

      // Abort handler
      const onAbort = () => {
        this.sendCommand({ type: 'abort' })
      }
      if (options?.signal) {
        if (options.signal.aborted) {
          clearTimeout(timer)
          this.pending = null
          this.sendCommand({ type: 'abort' })
          resolve({
            ok: false,
            response: '(aborted)',
            error: 'Aborted by user',
            durationMs: Date.now() - startTime,
            exitCode: 130,
          })
          return
        }
        options.signal.addEventListener('abort', onAbort, { once: true })
        this.pending.abortHandler = () => options.signal?.removeEventListener('abort', onAbort)
      }

      // Build prompt command
      const cmd: Record<string, unknown> = {
        type: 'prompt',
        message: prompt,
      }

      // Process attachments: images as base64, documents inlined into prompt
      if (options?.attachments?.length) {
        const images: Array<Record<string, string>> = []
        const documentTexts: string[] = []

        for (const att of options.attachments) {
          if (att.type === 'image') {
            try {
              const fsModule = await import('node:fs')
              const data = fsModule.readFileSync(att.path).toString('base64')
              images.push({
                type: 'image',
                data,
                mimeType: att.mimeType || 'image/jpeg',
              })
            } catch {
              // Skip unreadable attachments
            }
          } else if (att.type === 'document') {
            try {
              const fsModule = await import('node:fs')
              const content = fsModule.readFileSync(att.path, 'utf-8')
              if (content.trim()) {
                const label = att.filename || 'document'
                documentTexts.push(`── ${label} ──\n${content.trim()}\n── fi ${label} ──`)
              }
            } catch {
              // Skip unreadable documents
            }
          }
        }

        if (images.length > 0) cmd.images = images

        // Inline document content into the prompt text
        if (documentTexts.length > 0) {
          cmd.message = documentTexts.join('\n\n') + '\n\n' + (cmd.message as string)
        }
      }

      this.sendCommand(cmd)
    })
  }

  /** Request a new session (clear context). */
  async newSession(): Promise<void> {
    if (this.ready) {
      this.sendCommand({ type: 'new_session' })
    }
  }

  /**
   * Retrieve conversation messages from the RPC subprocess.
   * Used to persist context before idle shutdown.
   * Returns null if the subprocess is not alive or fails.
   */
  getMessages(): Promise<unknown[] | null> {
    return new Promise((resolve) => {
      if (!this.ready || !this.child?.stdin?.writable) {
        resolve(null)
        return
      }

      const timer = setTimeout(() => {
        this._getMessagesResolve = null
        resolve(null)
      }, 5000)

      this._getMessagesResolve = (messages: unknown[]) => {
        clearTimeout(timer)
        this._getMessagesResolve = null
        resolve(messages)
      }

      this.sendCommand({ type: 'get_messages' })
    })
  }

  /** Check if the subprocess is alive. */
  isAlive(): boolean {
    return this.ready && this.child !== null
  }

  /** Get uptime in ms. */
  uptime(): number {
    return this.ready ? Date.now() - this.startedAt : 0
  }

  /** Kill the subprocess. */
  cleanup(): void {
    this.ready = false
    this._onStreaming = null
    if (this.pending) {
      clearTimeout(this.pending.timer)
      this.pending.abortHandler?.()
      this.pending = null
    }
    if (this.rl) {
      this.rl.close()
      this.rl = null
    }
    if (this.child) {
      this.child.kill('SIGTERM')
      setTimeout(() => {
        if (this.child && !this.child.killed) this.child.kill('SIGKILL')
      }, 3000)
      this.child = null
    }
  }

  // ── Private ─────────────────────────────────────────────

  private sendCommand(cmd: Record<string, unknown>): void {
    if (!this.child?.stdin?.writable) return
    this.child.stdin.write(JSON.stringify(cmd) + '\n')
  }

  private handleLine(line: string): void {
    let event: Record<string, unknown>
    try {
      event = JSON.parse(line)
    } catch {
      return
    }

    const type = event.type as string

    // Streaming text deltas
    if (type === 'message_update') {
      const delta = event.assistantMessageEvent as Record<string, unknown> | undefined
      if (delta?.type === 'text_delta' && typeof delta.delta === 'string') {
        if (this.pending) this.pending.textChunks.push(delta.delta)
        if (this._onStreaming) this._onStreaming(delta.delta)
      }
    }

    // Agent finished — resolve the pending promise
    if (type === 'agent_end') {
      if (this.pending) {
        const p = this.pending
        this.pending = null
        this._onStreaming = null
        clearTimeout(p.timer)
        p.abortHandler?.()
        const text = p.textChunks.join('').trim()
        p.resolve({
          ok: true,
          response: text || '(no output)',
          durationMs: Date.now() - p.startTime,
          exitCode: 0,
        })
      }
    }

    // Handle errors in message_update (aborted, error)
    if (type === 'message_update') {
      const delta = event.assistantMessageEvent as Record<string, unknown> | undefined
      if (delta?.type === 'done' && delta.reason === 'error') {
        if (this.pending) {
          const p = this.pending
          this.pending = null
          this._onStreaming = null
          clearTimeout(p.timer)
          p.abortHandler?.()
          const text = p.textChunks.join('').trim()
          p.resolve({
            ok: false,
            response: text || '',
            error: 'Agent error',
            durationMs: Date.now() - p.startTime,
            exitCode: 1,
          })
        }
      }
    }

    // get_messages response — resolve pending getMessages() call
    if (type === 'response') {
      const command = event.command as string
      if (command === 'get_messages' && event.success && this._getMessagesResolve) {
        const data = event.data as { messages?: unknown[] } | undefined
        this._getMessagesResolve(data?.messages ?? [])
        return
      }
    }

    // Prompt response (just ack, actual result comes via agent_end)
    // Response errors
    if (type === 'response') {
      const success = event.success as boolean
      if (!success && this.pending) {
        const p = this.pending
        this.pending = null
        this._onStreaming = null
        clearTimeout(p.timer)
        p.abortHandler?.()
        p.resolve({
          ok: false,
          response: '',
          error: (event.error as string) || 'RPC command failed',
          durationMs: Date.now() - p.startTime,
          exitCode: 1,
        })
      }
    }
  }
}

/** Result from getSessionWithStatus — tells the caller if context was lost. */
export interface SessionStatus {
  session: RpcSession
  /** True if a new subprocess was spawned (previous one died or timed out). */
  wasRestarted: boolean
  /** Reason for restart, if applicable. */
  reason?: 'idle' | 'crash' | 'new'
  /** True if saved context was restored into the new session. */
  contextRestored: boolean
}

/**
 * Manages RPC sessions across multiple senders.
 * Each sender gets their own persistent subprocess.
 *
 * Context persistence: when a session is killed due to idle timeout,
 * conversation messages are saved to disk. On the next message from
 * that sender, the saved context is restored into the new subprocess.
 */
export class RpcSessionManager {
  private sessions = new Map<string, RpcSession>()
  private options: RpcRunnerOptions
  private idleTimeoutMs: number
  private idleTimers = new Map<string, ReturnType<typeof setTimeout>>()
  /** Tracks why a session was killed (for the next getSessionWithStatus call). */
  private killReasons = new Map<string, 'idle' | 'crash'>()
  /** Directory for persisting conversation context across idle restarts. */
  private contextDir: string

  constructor(
    options: RpcRunnerOptions,
    idleTimeoutMs = 30 * 60_000 // 30 min default
  ) {
    this.options = options
    this.idleTimeoutMs = idleTimeoutMs
    this.contextDir = path.join(os.homedir(), '.pi', 'agent', 'bridge-context')
    try {
      fs.mkdirSync(this.contextDir, { recursive: true })
    } catch {
      /* ignore */
    }
  }

  /**
   * Get or create a session for a sender.
   * @deprecated Use getSessionWithStatus() for restart awareness.
   */
  async getSession(senderKey: string): Promise<RpcSession> {
    const result = await this.getSessionWithStatus(senderKey)
    return result.session
  }

  /**
   * Get or create a session, with metadata about whether it was restarted.
   * This lets the bridge warn the user when context was lost.
   */
  async getSessionWithStatus(senderKey: string): Promise<SessionStatus> {
    let session = this.sessions.get(senderKey)
    if (session && session.isAlive()) {
      this.resetIdleTimer(senderKey)
      return { session, wasRestarted: false, contextRestored: false }
    }

    // Session is dead or missing — need to create a new one
    const reason = this.killReasons.get(senderKey)
    this.killReasons.delete(senderKey)

    // Clean up dead session
    if (session) {
      session.cleanup()
      this.sessions.delete(senderKey)
    }

    // Create new subprocess
    session = new RpcSession(this.options)
    const ok = await session.start()
    if (!ok) throw new Error('Failed to start RPC session')

    this.sessions.set(senderKey, session)
    this.resetIdleTimer(senderKey)

    // Try to restore saved context
    let contextRestored = false
    if (reason === 'idle') {
      contextRestored = await this.restoreContext(senderKey, session)
    }

    const wasRestarted = reason !== undefined
    return { session, wasRestarted, reason, contextRestored }
  }

  /** Reset a sender's session (new conversation). */
  async resetSession(senderKey: string): Promise<void> {
    const session = this.sessions.get(senderKey)
    if (session) {
      await session.newSession()
    }
    // Clear any saved context — user explicitly wants fresh start
    this.deleteSavedContext(senderKey)
  }

  /** Kill a specific sender's session, optionally saving context first. */
  killSession(senderKey: string): void {
    const session = this.sessions.get(senderKey)
    if (session) {
      session.cleanup()
      this.sessions.delete(senderKey)
    }
    const timer = this.idleTimers.get(senderKey)
    if (timer) {
      clearTimeout(timer)
      this.idleTimers.delete(senderKey)
    }
  }

  /** Kill all sessions. */
  killAll(): void {
    for (const [key, session] of this.sessions) {
      session.cleanup()
    }
    this.sessions.clear()
    for (const timer of this.idleTimers.values()) {
      clearTimeout(timer)
    }
    this.idleTimers.clear()
  }

  /** Update the model used for new sessions. */
  updateModel(model: string | null): void {
    this.options = { ...this.options, model: model ?? undefined }
  }

  /** Get stats. */
  getStats(): { activeSessions: number; senders: string[] } {
    return {
      activeSessions: this.sessions.size,
      senders: [...this.sessions.keys()],
    }
  }

  private resetIdleTimer(senderKey: string): void {
    const existing = this.idleTimers.get(senderKey)
    if (existing) clearTimeout(existing)

    const timer = setTimeout(async () => {
      const session = this.sessions.get(senderKey)

      // Save conversation context before killing
      if (session && session.isAlive()) {
        await this.saveContext(senderKey, session)
      }

      // Record why this session was killed (so getSessionWithStatus knows)
      this.killReasons.set(senderKey, 'idle')
      this.killSession(senderKey)
    }, this.idleTimeoutMs)

    this.idleTimers.set(senderKey, timer)
  }

  // ── Context persistence ─────────────────────────────────

  /** Filename for a sender's saved context. */
  private contextPath(senderKey: string): string {
    // Sanitize sender key for filesystem
    const safe = senderKey.replace(/[^a-zA-Z0-9_:-]/g, '_')
    return path.join(this.contextDir, `${safe}.json`)
  }

  /** Save conversation messages from a live session to disk. */
  private async saveContext(senderKey: string, session: RpcSession): Promise<void> {
    try {
      const messages = await session.getMessages()
      if (messages && messages.length > 0) {
        const data = JSON.stringify({
          senderKey,
          savedAt: new Date().toISOString(),
          messageCount: messages.length,
          messages,
        })
        fs.writeFileSync(this.contextPath(senderKey), data, 'utf-8')
      }
    } catch {
      // Best effort — if we can't save, context is lost (same as before)
    }
  }

  /**
   * Restore saved context into a newly spawned session.
   * Replays the saved messages as a context summary prompt so the agent
   * knows what was discussed before.
   */
  private async restoreContext(senderKey: string, session: RpcSession): Promise<boolean> {
    const ctxPath = this.contextPath(senderKey)
    try {
      if (!fs.existsSync(ctxPath)) return false

      const raw = fs.readFileSync(ctxPath, 'utf-8')
      const saved = JSON.parse(raw) as {
        savedAt: string
        messageCount: number
        messages: Array<{ role?: string; content?: unknown }>
      }

      // Build a context restoration prompt from the saved messages
      const summary = this.buildContextSummary(saved.messages)
      if (!summary) {
        this.deleteSavedContext(senderKey)
        return false
      }

      // Send the context as the first message so the agent has history
      const result = await session.runPrompt(
        `[CONTEXT RESTORATION — Previous conversation was saved before idle timeout. ` +
          `Here is the conversation history. Continue naturally from where we left off. ` +
          `Do NOT repeat this context back to the user — just acknowledge briefly that you remember the previous conversation.]\n\n` +
          summary
      )

      // Clean up saved context after successful restore
      this.deleteSavedContext(senderKey)
      return result.ok
    } catch {
      this.deleteSavedContext(senderKey)
      return false
    }
  }

  /** Build a readable summary from saved messages for context injection. */
  private buildContextSummary(messages: Array<{ role?: string; content?: unknown }>): string | null {
    if (!messages || messages.length === 0) return null

    const lines: string[] = []
    for (const msg of messages) {
      const role = msg.role || 'unknown'
      let text = ''

      if (typeof msg.content === 'string') {
        text = msg.content
      } else if (Array.isArray(msg.content)) {
        // Content blocks (text, tool_use, etc.)
        text = (msg.content as Array<{ type?: string; text?: string }>)
          .filter((b) => b.type === 'text' && b.text)
          .map((b) => b.text)
          .join('\n')
      }

      if (text) {
        // Truncate very long messages to keep context reasonable
        const truncated = text.length > 2000 ? text.slice(0, 2000) + '\n[...truncated...]' : text
        lines.push(`**${role}:** ${truncated}`)
      }
    }

    if (lines.length === 0) return null

    // Cap total context size to prevent token explosion
    const MAX_CONTEXT_CHARS = 15000
    let result = lines.join('\n\n')
    if (result.length > MAX_CONTEXT_CHARS) {
      // Keep the most recent messages (end of conversation is most relevant)
      const truncated: string[] = []
      let totalLen = 0
      for (let i = lines.length - 1; i >= 0; i--) {
        if (totalLen + lines[i].length > MAX_CONTEXT_CHARS) break
        truncated.unshift(lines[i])
        totalLen += lines[i].length
      }
      result = '[...earlier messages truncated...]\n\n' + truncated.join('\n\n')
    }

    return result
  }

  /** Delete saved context file for a sender. */
  private deleteSavedContext(senderKey: string): void {
    try {
      fs.unlinkSync(this.contextPath(senderKey))
    } catch {
      /* ignore */
    }
  }
}
