import {
  createAgentSession,
  AuthStorage,
  ModelRegistry,
  SessionManager,
  SettingsManager,
  type AgentSession,
  type AgentSessionEvent,
} from "@mariozechner/pi-coding-agent";
import type { ResourceLoader } from "@mariozechner/pi-coding-agent";
import { PATHS, log } from "./options.js";

export type AgentEventCallback = (event: AgentSessionEvent) => void;

export class AgentManager {
  private session: AgentSession | null = null;
  private listeners = new Set<AgentEventCallback>();
  private unsubscribe: (() => void) | null = null;

  constructor(
    private readonly provider: string,
    private readonly modelId: string,
    private readonly resourceLoader: ResourceLoader
  ) {}

  async init(): Promise<void> {
    // Set process cwd so bash tool operates in workspace by default
    try {
      process.chdir(PATHS.workspace);
      log.debug(`Working directory: ${PATHS.workspace}`);
    } catch {
      log.warn(`Could not chdir to ${PATHS.workspace} — using current directory`);
    }

    const authStorage = AuthStorage.create(`${PATHS.piAgentDir}/auth.json`);
    const modelRegistry = ModelRegistry.create(
      authStorage,
      `${PATHS.piAgentDir}/models.json`
    );

    // Resolve model — fall back to first available if specified one isn't found
    let model = modelRegistry.find(this.provider, this.modelId) ?? null;
    if (!model) {
      log.warn(
        `Model ${this.provider}/${this.modelId} not found in registry, ` +
          `falling back to first available`
      );
      const available = modelRegistry.getAvailable();
      model = available[0] ?? null;
    }
    if (!model) {
      throw new Error(
        `No model available for provider "${this.provider}". ` +
          `Check your API key configuration.`
      );
    }

    log.info(`Using model: ${model.provider}/${model.id}`);

    const sessionManager = SessionManager.create(PATHS.workspace);
    const settingsManager = SettingsManager.create(PATHS.workspace, PATHS.piAgentDir);

    const { session } = await createAgentSession({
      cwd: PATHS.workspace,
      agentDir: PATHS.piAgentDir,
      model,
      authStorage,
      modelRegistry,
      sessionManager,
      settingsManager,
      resourceLoader: this.resourceLoader,
    });

    this.attachSession(session);
    log.info(`Agent session ready (id: ${session.sessionId})`);
  }

  private attachSession(session: AgentSession): void {
    // Unsubscribe from previous session if any
    this.unsubscribe?.();
    this.session = session;
    this.unsubscribe = session.subscribe((event) => {
      for (const listener of this.listeners) {
        try {
          listener(event);
        } catch (err) {
          log.error("Agent event listener error:", err);
        }
      }
    });
  }

  subscribe(cb: AgentEventCallback): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  async prompt(text: string): Promise<void> {
    this.ensureSession().prompt(text);
  }

  async abort(): Promise<void> {
    await this.session?.abort();
  }

  async newSession(): Promise<void> {
    const current = this.ensureSession();
    const authStorage2 = AuthStorage.create(`${PATHS.piAgentDir}/auth.json`);
    const modelRegistry2 = ModelRegistry.create(authStorage2);
    const { session } = await createAgentSession({
      cwd: PATHS.workspace,
      agentDir: PATHS.piAgentDir,
      model: current.model ?? undefined,
      authStorage: authStorage2,
      modelRegistry: modelRegistry2,
      sessionManager: SessionManager.create(PATHS.workspace),
      settingsManager: SettingsManager.create(PATHS.workspace, PATHS.piAgentDir),
      resourceLoader: this.resourceLoader,
    });
    this.attachSession(session);
    log.info(`New session started (id: ${session.sessionId})`);
  }

  async switchSession(sessionFile: string): Promise<void> {
    const authStorage3 = AuthStorage.create(`${PATHS.piAgentDir}/auth.json`);
    const modelRegistry3 = ModelRegistry.create(authStorage3);
    const { session } = await createAgentSession({
      cwd: PATHS.workspace,
      agentDir: PATHS.piAgentDir,
      authStorage: authStorage3,
      modelRegistry: modelRegistry3,
      sessionManager: SessionManager.open(sessionFile),
      settingsManager: SettingsManager.create(PATHS.workspace, PATHS.piAgentDir),
      resourceLoader: this.resourceLoader,
    });
    this.attachSession(session);
    log.info(`Switched to session ${sessionFile}`);
  }

  async listSessions() {
    return SessionManager.list(PATHS.workspace);
  }

  getState() {
    const session = this.session;
    if (!session) return null;
    return {
      isStreaming: session.isStreaming,
      sessionId: session.sessionId,
      sessionFile: session.sessionFile,
      model: session.model
        ? `${session.model.provider}/${session.model.id}`
        : null,
      thinkingLevel: session.thinkingLevel,
      messageCount: session.messages.length,
    };
  }

  private ensureSession(): AgentSession {
    if (!this.session) throw new Error("Agent not initialised");
    return this.session;
  }
}
