import { existsSync } from 'fs'
import { unlink } from 'fs/promises'
import {
  createAgentSession,
  AuthStorage,
  ModelRegistry,
  SessionManager,
  SettingsManager,
  type AgentSession,
  type AgentSessionEvent,
} from '@mariozechner/pi-coding-agent'
import type { ResourceLoader } from '@mariozechner/pi-coding-agent'
import {
  selectInitialModel,
  summarizeAvailableModels,
  type AvailableModelSummary,
  type ModelRef,
} from './model-selection'
import { PATHS, log } from './options'

export type AgentEventCallback = (event: AgentSessionEvent) => void

export class AgentManager {
  private session: AgentSession | null = null
  private listeners = new Set<AgentEventCallback>()
  private unsubscribe: (() => void) | null = null
  private modelRegistry: ModelRegistry | null = null

  constructor(
    private readonly provider: string,
    private readonly modelId: string,
    private readonly resourceLoader: ResourceLoader,
    private readonly authStorage: AuthStorage
  ) {}

  /**
   * Initialise the agent.
   *
   * @param sessionFile - Optional path to an existing session file.  When
   *   provided and the file is present on disk the session is resumed via
   *   `SessionManager.open()`; otherwise a brand-new session is created.
   */
  async init(sessionFile?: string): Promise<void> {
    // Set process cwd so bash tool operates in workspace by default
    try {
      process.chdir(PATHS.workspace)
      log.debug(`Working directory: ${PATHS.workspace}`)
    } catch {
      log.warn(`Could not chdir to ${PATHS.workspace} — using current directory`)
    }

    const settingsManager = SettingsManager.create(PATHS.workspace, PATHS.piAgentDir)
    const modelRegistry = ModelRegistry.create(this.authStorage, `${PATHS.piAgentDir}/models.json`)
    this.modelRegistry = modelRegistry

    const preferredModels: Array<ModelRef | null> = [
      settingsManager.getDefaultProvider() && settingsManager.getDefaultModel()
        ? {
            provider: settingsManager.getDefaultProvider()!,
            modelId: settingsManager.getDefaultModel()!,
          }
        : null,
      { provider: this.provider, modelId: this.modelId },
    ]

    const model = selectInitialModel(preferredModels, modelRegistry.getAvailable())
    if (!model) {
      throw new Error(`No model available for provider "${this.provider}". ` + `Check your API key configuration.`)
    }

    log.info(`Using model: ${model.provider}/${model.id}`)

    const sessionManager =
      sessionFile && existsSync(sessionFile)
        ? SessionManager.open(sessionFile)
        : SessionManager.create(PATHS.workspace)

    const { session } = await createAgentSession({
      cwd: PATHS.workspace,
      agentDir: PATHS.piAgentDir,
      model,
      authStorage: this.authStorage,
      modelRegistry,
      sessionManager,
      settingsManager,
      resourceLoader: this.resourceLoader,
    })

    this.attachSession(session)
    log.info(`Agent session ready (id: ${session.sessionId})`)
  }

  private attachSession(session: AgentSession): void {
    // Unsubscribe from previous session if any
    this.unsubscribe?.()
    this.session = session
    this.unsubscribe = session.subscribe((event) => {
      for (const listener of this.listeners) {
        try {
          listener(event)
        } catch (err) {
          log.error('Agent event listener error:', err)
        }
      }
    })
  }

  subscribe(cb: AgentEventCallback): () => void {
    this.listeners.add(cb)
    return () => this.listeners.delete(cb)
  }

  async prompt(text: string): Promise<void> {
    // Built-in TUI commands (/login, /model, /settings, etc.) are not
    // accessible through the SDK — they only work in interactive terminal mode.
    // Intercept them early and return a helpful message instead of crashing.
    if (text.trim().startsWith('/')) {
      const command = text.trim().split(/\s+/)[0]
      const TUI_COMMANDS = [
        '/login',
        '/logout',
        '/model',
        '/settings',
        '/hotkeys',
        '/session',
        '/resume',
        '/new',
        '/compact',
        '/tree',
        '/fork',
        '/clone',
        '/reload',
        '/export',
        '/share',
        '/copy',
        '/quit',
        '/changelog',
      ]
      if (TUI_COMMANDS.includes(command)) {
        throw new Error(
          `\`${command}\` is a terminal-only command and cannot be used in the web UI.` +
            (command === '/login' ? ' To configure an API key, use the Providers modal in the web UI.' : '')
        )
      }
    }
    await this.ensureSession().prompt(text)
  }

  async abort(): Promise<void> {
    await this.session?.abort()
  }

  getMessages() {
    return this.ensureSession().messages
  }

  getAvailableModels(): AvailableModelSummary[] {
    return summarizeAvailableModels(this.ensureModelRegistry().getAvailable())
  }

  async setModel(provider: string, modelId: string): Promise<void> {
    const model = this.ensureModelRegistry().find(provider, modelId)
    if (!model) {
      throw new Error(`Model not found: ${provider}/${modelId}`)
    }
    await this.ensureSession().setModel(model)
  }

  async cycleModel(direction: 'forward' | 'backward' = 'forward') {
    return this.ensureSession().cycleModel(direction)
  }

  async newSession(): Promise<void> {
    const current = this.ensureSession()
    const modelRegistry = ModelRegistry.create(this.authStorage)
    const { session } = await createAgentSession({
      cwd: PATHS.workspace,
      agentDir: PATHS.piAgentDir,
      model: current.model ?? undefined,
      authStorage: this.authStorage,
      modelRegistry,
      sessionManager: SessionManager.create(PATHS.workspace),
      settingsManager: SettingsManager.create(PATHS.workspace, PATHS.piAgentDir),
      resourceLoader: this.resourceLoader,
    })
    this.attachSession(session)
    log.info(`New session started (id: ${session.sessionId})`)
  }

  async switchSession(sessionFile: string): Promise<void> {
    const modelRegistry = ModelRegistry.create(this.authStorage)
    const { session } = await createAgentSession({
      cwd: PATHS.workspace,
      agentDir: PATHS.piAgentDir,
      authStorage: this.authStorage,
      modelRegistry,
      sessionManager: SessionManager.open(sessionFile),
      settingsManager: SettingsManager.create(PATHS.workspace, PATHS.piAgentDir),
      resourceLoader: this.resourceLoader,
    })
    this.attachSession(session)
    log.info(`Switched to session ${sessionFile}`)
  }

  async listSessions() {
    return SessionManager.list(PATHS.workspace)
  }

  async deleteSession(sessionFile: string): Promise<void> {
    await unlink(sessionFile)
  }

  getState() {
    const session = this.session
    if (!session) return null
    return {
      isStreaming: session.isStreaming,
      sessionId: session.sessionId,
      sessionFile: session.sessionFile,
      model: session.model ? `${session.model.provider}/${session.model.id}` : null,
      thinkingLevel: session.thinkingLevel,
      messageCount: session.messages.length,
    }
  }

  private ensureSession(): AgentSession {
    if (!this.session) throw new Error('Agent not initialised')
    return this.session
  }

  private ensureModelRegistry(): ModelRegistry {
    if (!this.modelRegistry) throw new Error('Agent not initialised')
    return this.modelRegistry
  }
}
