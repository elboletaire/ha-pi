import { describe, it, expect, vi, beforeEach } from "vitest";
import { WsHandler } from "./ws-handler";
import type { AgentManager } from "./agent-manager";
import type { LoginManager } from "./login-manager";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Minimal fake WebSocket that captures sent messages and registered listeners. */
function makeWs() {
  const listeners: Record<string, Array<(...args: unknown[]) => void>> = {};
  const sent: string[] = [];

  return {
    readyState: 1 as const,
    send: vi.fn((data: string) => sent.push(data)),
    on: vi.fn((event: string, cb: (...args: unknown[]) => void) => {
      (listeners[event] ??= []).push(cb);
    }),
    // Test helpers
    _sent: sent,
    _emit(event: string, ...args: unknown[]) {
      listeners[event]?.forEach((cb) => cb(...args));
    },
  };
}

/** Minimal fake LoginManager. */
function makeLogin() {
  return {
    getProviders: vi.fn().mockReturnValue([]),
    startLogin: vi.fn(),
    abortLogin: vi.fn(),
    respondToPrompt: vi.fn(),
    logout: vi.fn(),
  } as unknown as LoginManager;
}

function makeAgent() {
  return {
    subscribe: vi.fn(() => vi.fn()), // returns an unsubscribe fn
    prompt: vi.fn(),
    abort: vi.fn().mockResolvedValue(undefined),
    newSession: vi.fn().mockResolvedValue(undefined),
    switchSession: vi.fn().mockResolvedValue(undefined),
    listSessions: vi.fn().mockResolvedValue([]),
    getState: vi.fn().mockReturnValue({
      isStreaming: false,
      sessionId: "sess-1",
      sessionFile: "/data/sessions/sess-1.json",
      model: "anthropic/claude-3-5-sonnet",
      thinkingLevel: "medium",
      messageCount: 4,
    }),
  } as unknown as AgentManager;
}

/** Flush the microtask / timer queue so async handlers can settle. */
const flushPromises = () => new Promise<void>((r) => setTimeout(r, 0));

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("WsHandler", () => {
  let ws: ReturnType<typeof makeWs>;
  let agent: AgentManager;
  let login: LoginManager;

  beforeEach(() => {
    ws = makeWs();
    agent = makeAgent();
    login = makeLogin();
    new WsHandler(ws as any, agent, login);
  });

  /** Simulate the browser sending a message over the socket. */
  function clientSend(msg: unknown) {
    ws._emit("message", JSON.stringify(msg));
  }

  it("subscribes to agent events on construction", () => {
    expect(agent.subscribe).toHaveBeenCalledOnce();
  });

  it("routes 'prompt' to agent.prompt()", async () => {
    clientSend({ type: "prompt", text: "hello world" });
    await flushPromises();
    expect(agent.prompt).toHaveBeenCalledWith("hello world");
  });

  it("routes 'abort' to agent.abort()", async () => {
    clientSend({ type: "abort" });
    await flushPromises();
    expect(agent.abort).toHaveBeenCalled();
  });

  it("routes 'get_state' and sends back a state message", async () => {
    clientSend({ type: "get_state" });
    await flushPromises();
    const state = JSON.parse(ws._sent[0]);
    expect(state.type).toBe("state");
    expect(state.sessionId).toBe("sess-1");
    expect(state.isStreaming).toBe(false);
    expect(state.messageCount).toBe(4);
  });

  it("routes 'new_session', calls agent and sends state", async () => {
    clientSend({ type: "new_session" });
    await flushPromises();
    expect(agent.newSession).toHaveBeenCalled();
    const state = JSON.parse(ws._sent.at(-1)!);
    expect(state.type).toBe("state");
  });

  it("routes 'switch_session' with the correct file path", async () => {
    clientSend({ type: "switch_session", sessionFile: "/data/sessions/old.json" });
    await flushPromises();
    expect(agent.switchSession).toHaveBeenCalledWith("/data/sessions/old.json");
  });

  it("routes 'get_sessions' and sends a sessions message", async () => {
    clientSend({ type: "get_sessions" });
    await flushPromises();
    const msg = JSON.parse(ws._sent[0]);
    expect(msg.type).toBe("sessions");
    expect(Array.isArray(msg.sessions)).toBe(true);
  });

  it("silently ignores invalid JSON", async () => {
    ws._emit("message", "not json at all");
    await flushPromises();
    expect(ws._sent).toHaveLength(0);
  });

  it("unsubscribes from agent events when the socket closes", () => {
    const unsub = vi.fn();
    (agent.subscribe as ReturnType<typeof vi.fn>).mockReturnValueOnce(unsub);
    new WsHandler(ws as any, agent, login); // second handler captures the new unsub
    ws._emit("close");
    expect(unsub).toHaveBeenCalled();
  });
});
