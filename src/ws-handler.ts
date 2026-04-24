import type { WebSocket } from "ws";
import type { AgentSessionEvent } from "@mariozechner/pi-coding-agent";
import type { AgentManager } from "./agent-manager.js";
import { log } from "./options.js";

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
  | { type: "get_state" };

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
  | { type: "sessions"; sessions: Array<{ id: string; file: string; name?: string; firstMessage: string; modified: string }> };

// ---------------------------------------------------------------------------
// WsHandler — one instance per connected client
// ---------------------------------------------------------------------------

export class WsHandler {
  private unsub: (() => void) | null = null;

  constructor(
    private readonly ws: WebSocket,
    private readonly agent: AgentManager
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
        this.sendState();
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
          this.sendState();
          break;

        case "get_sessions":
          await this.sendSessions();
          break;

        case "get_state":
          this.sendState();
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

  private send(msg: ServerMessage): void {
    if (this.ws.readyState !== 1 /* OPEN */) return;
    try {
      this.ws.send(JSON.stringify(msg));
    } catch (err) {
      log.warn("Failed to send WS message:", err);
    }
  }
}
