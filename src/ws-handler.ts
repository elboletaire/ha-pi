import type { WebSocket } from "ws";
import type { AgentSessionEvent } from "@mariozechner/pi-coding-agent";
import type { AgentManager } from "./agent-manager";
import type { LoginManager, LoginEvent } from "./login-manager";
import type { AvailableModelSummary } from "./model-selection";
import { log } from "./options";

// ---------------------------------------------------------------------------
// Types for messages exchanged over the WebSocket
// ---------------------------------------------------------------------------

/** Messages sent FROM the browser to the server */
type ClientMessage =
  | { type: "prompt"; text: string }
  | { type: "abort" }
  | { type: "new_session" }
  | { type: "switch_session"; sessionFile: string }
  | { type: "get_sessions" }
  | { type: "get_state" }
  | { type: "get_available_models" }
  | { type: "set_model"; provider: string; modelId: string }
  | { type: "cycle_model"; direction?: "forward" | "backward" }
  | { type: "login_start"; provider: string }
  | { type: "login_abort" }
  | { type: "login_prompt_response"; promptId: string; value: string }
  | { type: "logout"; provider: string }
  | { type: "set_api_key"; provider: string; key: string }
  | { type: "clear_api_key"; provider: string }
  | { type: "delete_session"; sessionFile: string }
  | { type: "get_auth_status" };

/** Messages sent FROM the server to the browser */
type ServerMessage =
  | { type: "agent_start" }
  | { type: "agent_end" }
  | { type: "text_delta"; delta: string }
  | { type: "thinking_delta"; delta: string }
  | { type: "tool_start"; id: string; name: string; args: unknown }
  | { type: "tool_update"; id: string; name: string; output: string }
  | { type: "tool_result"; id: string; name: string; output: string; isError: boolean }
  | { type: "error"; message: string }
  | { type: "state"; isStreaming: boolean; sessionId: string; sessionFile?: string; model: string | null; thinkingLevel: string; messageCount: number }
  | { type: "sessions"; sessions: Array<{ id: string; file: string; name?: string; firstMessage: string; modified: string }> }
  | { type: "session_history"; messages: ReturnType<AgentManager["getMessages"]> }
  | { type: "available_models"; models: AvailableModelSummary[] }
  | LoginEvent;

// ---------------------------------------------------------------------------
// WsHandler — one instance per connected client
// ---------------------------------------------------------------------------

export class WsHandler {
  private unsub: (() => void) | null = null;

  constructor(
    private readonly ws: WebSocket,
    private readonly agent: AgentManager,
    private readonly login: LoginManager
  ) {
    this.unsub = this.agent.subscribe((event) => this.onAgentEvent(event));
    this.ws.on("message", (raw) => this.onClientMessage(raw.toString()));
    this.ws.on("close", () => this.unsub?.());
  }

  // -------------------------------------------------------------------------
  // Agent → Browser
  // -------------------------------------------------------------------------

  private onAgentEvent(event: AgentSessionEvent): void {
    switch (event.type) {
      case "agent_start":
        this.send({ type: "agent_start" });
        break;

      case "agent_end":
        this.send({ type: "agent_end" });
        void this.sendStateWhenIdle();
        break;

      case "message_update": {
        const e = event.assistantMessageEvent;
        if (e.type === "text_delta") {
          this.send({ type: "text_delta", delta: e.delta });
        } else if (e.type === "thinking_delta") {
          this.send({ type: "thinking_delta", delta: e.delta });
        }
        break;
      }

      case "tool_execution_start":
        this.send({
          type: "tool_start",
          id: event.toolCallId,
          name: event.toolName,
          args: event.args,
        });
        break;

      case "tool_execution_update": {
        const content = event.partialResult?.content;
        const output =
          Array.isArray(content)
            ? content.map((c: any) => (typeof c.text === "string" ? c.text : "")).join("")
            : "";
        this.send({
          type: "tool_update",
          id: event.toolCallId,
          name: event.toolName,
          output,
        });
        break;
      }

      case "tool_execution_end": {
        const content = event.result?.content;
        const output =
          Array.isArray(content)
            ? content.map((c: any) => (typeof c.text === "string" ? c.text : "")).join("")
            : "";
        this.send({
          type: "tool_result",
          id: event.toolCallId,
          name: event.toolName,
          output,
          isError: event.isError,
        });
        break;
      }

      case "compaction_start":
        this.send({ type: "text_delta", delta: "\n\n*[Compacting context...]*\n\n" });
        break;

      case "auto_retry_start":
        this.send({
          type: "text_delta",
          delta: `\n\n*[Retrying after error: ${event.errorMessage}]*\n\n`,
        });
        break;

      default:
        // Ignore other events (compaction_end, queue_update, etc.)
        break;
    }
  }

  // -------------------------------------------------------------------------
  // Browser → Agent
  // -------------------------------------------------------------------------

  private async onClientMessage(raw: string): Promise<void> {
    let msg: ClientMessage;
    try {
      msg = JSON.parse(raw) as ClientMessage;
    } catch {
      log.warn("Received invalid JSON from client:", raw.slice(0, 200));
      return;
    }

    try {
      switch (msg.type) {
        case "prompt":
          await this.agent.prompt(msg.text);
          break;

        case "abort":
          await this.agent.abort();
          break;

        case "new_session":
          await this.agent.newSession();
          this.sendState();
          break;

        case "switch_session":
          await this.agent.switchSession(msg.sessionFile);
          this.sendSessionHistory();
          this.sendState();
          break;

        case "get_sessions":
          await this.sendSessions();
          break;

        case "get_state":
          this.sendSessionHistory();
          this.sendState();
          break;

        case "get_available_models":
          this.sendAvailableModels();
          break;

        case "set_model":
          await this.agent.setModel(msg.provider, msg.modelId);
          this.sendState();
          break;

        case "cycle_model":
          await this.agent.cycleModel(msg.direction);
          this.sendState();
          break;

        case "login_start":
          // Fire and forget — events are streamed back via send callbacks
          this.login.startLogin(msg.provider, (event) => this.onLoginEvent(event));
          break;

        case "login_abort":
          this.login.abortLogin();
          break;

        case "login_prompt_response":
          this.login.respondToPrompt(msg.promptId, msg.value);
          break;

        case "logout":
          this.login.logout(msg.provider);
          await this.handleAuthChanged();
          break;

        case "set_api_key":
          if (!msg.key.trim()) {
            throw new Error("API key cannot be empty");
          }
          this.login.setApiKey(msg.provider, msg.key.trim());
          await this.handleAuthChanged();
          break;

        case "clear_api_key":
          this.login.clearApiKey(msg.provider);
          await this.handleAuthChanged();
          break;

        case "delete_session":
          await this.handleDeleteSession(msg.sessionFile);
          break;

        case "get_auth_status":
          this.sendAuthStatus();
          this.sendAvailableModels();
          break;

        default:
          log.warn("Unknown message type from client:", (msg as any).type);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      log.error("Error handling client message:", message);
      this.send({ type: "error", message });
    }
  }

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  private sendState(): void {
    const state = this.agent.getState();
    if (!state) return;
    this.send({
      type: "state",
      isStreaming: state.isStreaming,
      sessionId: state.sessionId,
      sessionFile: state.sessionFile,
      model: state.model,
      thinkingLevel: String(state.thinkingLevel),
      messageCount: state.messageCount,
    });
  }

  private async sendStateWhenIdle(): Promise<void> {
    const pollIntervalMs = 50;
    const timeoutMs = 5000;
    const started = Date.now();

    while (Date.now() - started < timeoutMs) {
      const state = this.agent.getState();
      if (state && !state.isStreaming) {
        this.sendState();
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
    }

    // Safety fallback: send the latest state even if the agent never flipped
    // to idle within the timeout. This should be rare, but keeps the UI from
    // getting stuck if the session tears down unexpectedly.
    this.sendState();
  }

  private async sendSessions(): Promise<void> {
    try {
      const sessions = await this.agent.listSessions();
      this.send({
        type: "sessions",
        sessions: sessions.map((s) => ({
          id: s.id,
          file: s.path,
          name: s.name,
          firstMessage: s.firstMessage.slice(0, 120),
          modified: s.modified.toISOString(),
        })),
      });
    } catch (err) {
      log.error("Failed to list sessions:", err);
    }
  }

  private async handleAuthChanged(): Promise<void> {
    this.sendAuthStatus();
    this.sendAvailableModels();

    if (!this.agent.getState()) {
      try {
        await this.agent.init();
        this.sendSessionHistory();
        this.sendState();
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        this.send({ type: "error", message });
      }
    }
  }

  private async handleDeleteSession(sessionFile: string): Promise<void> {
    const trimmed = sessionFile.trim();
    if (!trimmed) {
      throw new Error("Session file cannot be empty");
    }

    const current = this.agent.getState();
    const isCurrentSession = current?.sessionFile === trimmed;
    if (isCurrentSession && current?.isStreaming) {
      throw new Error("Stop the current conversation before deleting it.");
    }

    await this.agent.deleteSession(trimmed);

    if (isCurrentSession) {
      await this.agent.newSession();
      this.sendSessionHistory();
      this.sendState();
    }

    await this.sendSessions();
  }

  private onLoginEvent(event: LoginEvent): void {
    this.send(event);
    if (event.type === "login_complete") {
      void this.handleAuthChanged();
    }
  }

  private sendAuthStatus(): void {
    this.send({
      type: "auth_status",
      providers: this.login.getProviders(),
    });
  }

  private sendSessionHistory(): void {
    try {
      this.send({
        type: "session_history",
        messages: this.agent.getMessages(),
      });
    } catch {
      // No active session yet — nothing to hydrate.
    }
  }

  private sendAvailableModels(): void {
    this.send({
      type: "available_models",
      models: this.agent.getAvailableModels(),
    });
  }

  private send(msg: ServerMessage): void {
    if (this.ws.readyState !== 1 /* OPEN */) return;
    try {
      this.ws.send(JSON.stringify(msg));
    } catch (err) {
      log.warn("Failed to send WS message:", err);
    }
  }
}
