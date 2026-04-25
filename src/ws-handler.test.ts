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
    setApiKey: vi.fn(),
    clearApiKey: vi.fn(),
  } as unknown as LoginManager;
}

function makeAgent() {
  return {
    subscribe: vi.fn(() => vi.fn()), // returns an unsubscribe fn
    prompt: vi.fn(),
    abort: vi.fn().mockResolvedValue(undefined),
    newSession: vi.fn().mockResolvedValue(undefined),
    switchSession: vi.fn().mockResolvedValue(undefined),
    deleteSession: vi.fn().mockResolvedValue(undefined),
    init: vi.fn().mockResolvedValue(undefined),
    listSessions: vi.fn().mockResolvedValue([]),
    getMessages: vi.fn().mockReturnValue([]),
    getAvailableModels: vi.fn().mockReturnValue([]),
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

// Helper used across describe blocks below
function agentCallbackFrom(agent: AgentManager) {
  return (agent.subscribe as ReturnType<typeof vi.fn>).mock.calls[0][0] as
    (event: any) => void;
}

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

  it("routes 'get_state' and sends back history plus a state message", async () => {
    clientSend({ type: "get_state" });
    await flushPromises();
    const [history, state] = ws._sent.map((s) => JSON.parse(s));
    expect(history.type).toBe("session_history");
    expect(Array.isArray(history.messages)).toBe(true);
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

  it("routes 'switch_session' with the correct file path and sends history", async () => {
    clientSend({ type: "switch_session", sessionFile: "/data/sessions/old.json" });
    await flushPromises();
    expect(agent.switchSession).toHaveBeenCalledWith("/data/sessions/old.json");
    expect(JSON.parse(ws._sent[0]).type).toBe("session_history");
  });

  it("routes 'get_sessions' and sends a sessions message", async () => {
    clientSend({ type: "get_sessions" });
    await flushPromises();
    const msg = JSON.parse(ws._sent[0]);
    expect(msg.type).toBe("sessions");
    expect(Array.isArray(msg.sessions)).toBe(true);
  });

  it("routes 'delete_session' and refreshes the session list", async () => {
    (agent.listSessions as ReturnType<typeof vi.fn>).mockResolvedValueOnce([]);
    clientSend({ type: "delete_session", sessionFile: "/data/sessions/old.json" });
    await flushPromises();
    expect((agent.deleteSession as ReturnType<typeof vi.fn>)).toHaveBeenCalledWith("/data/sessions/old.json");
    expect(JSON.parse(ws._sent[0]).type).toBe("sessions");
  });

  it("deleting the current session starts a new one and sends fresh history", async () => {
    (agent.getState as ReturnType<typeof vi.fn>)
      .mockReturnValueOnce({
        isStreaming: false,
        sessionId: "sess-1",
        sessionFile: "/data/sessions/sess-1.json",
        model: "anthropic/claude-3-5-sonnet",
        thinkingLevel: "medium",
        messageCount: 4,
      })
      .mockReturnValue({
        isStreaming: false,
        sessionId: "sess-2",
        sessionFile: "/data/sessions/sess-2.json",
        model: "anthropic/claude-3-5-sonnet",
        thinkingLevel: "medium",
        messageCount: 0,
      });
    (agent.listSessions as ReturnType<typeof vi.fn>).mockResolvedValueOnce([]);

    clientSend({ type: "delete_session", sessionFile: "/data/sessions/sess-1.json" });
    await flushPromises();

    expect(agent.deleteSession).toHaveBeenCalledWith("/data/sessions/sess-1.json");
    expect(agent.newSession).toHaveBeenCalled();
    expect(ws._sent.map((s) => JSON.parse(s).type)).toEqual(["session_history", "state", "sessions"]);
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

// ---------------------------------------------------------------------------
// Agent event → browser message dispatch
// ---------------------------------------------------------------------------

describe("WsHandler — agent event dispatch", () => {
  let ws: ReturnType<typeof makeWs>;
  let agent: ReturnType<typeof makeAgent>;
  let agentCb: (event: any) => void;

  beforeEach(() => {
    ws = makeWs();
    agent = makeAgent();
    new WsHandler(ws as any, agent, makeLogin());
    agentCb = agentCallbackFrom(agent);
  });

  it("agent_start → sends { type: 'agent_start' }", () => {
    agentCb({ type: "agent_start" });
    expect(JSON.parse(ws._sent[0])).toEqual({ type: "agent_start" });
  });

  it("agent_end → sends agent_end immediately and waits for idle before sending state", async () => {
    vi.useFakeTimers();
    try {
      (agent.getState as ReturnType<typeof vi.fn>)
        .mockReturnValueOnce({
          isStreaming: true,
          sessionId: "sess-1",
          sessionFile: "/data/sessions/sess-1.json",
          model: "anthropic/claude-3-5-sonnet",
          thinkingLevel: "medium",
          messageCount: 4,
        })
        .mockReturnValue({
          isStreaming: false,
          sessionId: "sess-1",
          sessionFile: "/data/sessions/sess-1.json",
          model: "anthropic/claude-3-5-sonnet",
          thinkingLevel: "medium",
          messageCount: 4,
        });

      agentCb({ type: "agent_end" });
      expect(ws._sent.map((s) => JSON.parse(s).type)).toEqual(["agent_end"]);

      await vi.advanceTimersByTimeAsync(60);
      const msgs = ws._sent.map((s) => JSON.parse(s));
      expect(msgs[1].type).toBe("state");
      expect(msgs[1].isStreaming).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("message_update text_delta → sends { type: 'text_delta', delta }", () => {
    agentCb({ type: "message_update", assistantMessageEvent: { type: "text_delta", delta: "hello" } });
    expect(JSON.parse(ws._sent[0])).toEqual({ type: "text_delta", delta: "hello" });
  });

  it("message_update thinking_delta → sends { type: 'thinking_delta', delta }", () => {
    agentCb({ type: "message_update", assistantMessageEvent: { type: "thinking_delta", delta: "hmm" } });
    expect(JSON.parse(ws._sent[0])).toEqual({ type: "thinking_delta", delta: "hmm" });
  });

  it("message_update with other sub-type → sends nothing", () => {
    agentCb({ type: "message_update", assistantMessageEvent: { type: "other" } });
    expect(ws._sent).toHaveLength(0);
  });

  it("tool_execution_start → sends tool_start with id, name, args", () => {
    agentCb({ type: "tool_execution_start", toolCallId: "t1", toolName: "bash", args: { command: "ls" } });
    expect(JSON.parse(ws._sent[0])).toMatchObject({
      type: "tool_start",
      id: "t1",
      name: "bash",
      args: { command: "ls" },
    });
  });

  it("tool_execution_update extracts text content array into output string", () => {
    agentCb({
      type: "tool_execution_update",
      toolCallId: "t1",
      toolName: "bash",
      partialResult: { content: [{ type: "text", text: "foo " }, { type: "text", text: "bar" }] },
    });
    const msg = JSON.parse(ws._sent[0]);
    expect(msg.type).toBe("tool_update");
    expect(msg.output).toBe("foo bar");
  });

  it("tool_execution_update with no content → empty output", () => {
    agentCb({ type: "tool_execution_update", toolCallId: "t1", toolName: "bash", partialResult: undefined });
    expect(JSON.parse(ws._sent[0]).output).toBe("");
  });

  it("tool_execution_end (success) → sends tool_result with isError: false", () => {
    agentCb({
      type: "tool_execution_end",
      toolCallId: "t1",
      toolName: "bash",
      result: { content: [{ type: "text", text: "done" }] },
      isError: false,
    });
    const msg = JSON.parse(ws._sent[0]);
    expect(msg.type).toBe("tool_result");
    expect(msg.output).toBe("done");
    expect(msg.isError).toBe(false);
  });

  it("tool_execution_end (error) → sends tool_result with isError: true", () => {
    agentCb({
      type: "tool_execution_end",
      toolCallId: "t1",
      toolName: "bash",
      result: { content: [{ type: "text", text: "boom" }] },
      isError: true,
    });
    expect(JSON.parse(ws._sent[0]).isError).toBe(true);
  });

  it("compaction_start → sends a text_delta containing the compaction notice", () => {
    agentCb({ type: "compaction_start" });
    const msg = JSON.parse(ws._sent[0]);
    expect(msg.type).toBe("text_delta");
    expect(msg.delta).toContain("Compacting");
  });

  it("auto_retry_start → sends a text_delta containing the error message", () => {
    agentCb({ type: "auto_retry_start", errorMessage: "rate limited" });
    const msg = JSON.parse(ws._sent[0]);
    expect(msg.type).toBe("text_delta");
    expect(msg.delta).toContain("rate limited");
  });

  it("unknown event type → sends nothing", () => {
    agentCb({ type: "queue_update" });
    expect(ws._sent).toHaveLength(0);
  });

  it("does not send anything when socket is closed (readyState !== 1)", () => {
    (ws as any).readyState = 3; // CLOSED
    agentCb({ type: "agent_start" });
    expect(ws._sent).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Login message routing
// ---------------------------------------------------------------------------

describe("WsHandler — login message routing", () => {
  let ws: ReturnType<typeof makeWs>;
  let login: LoginManager;
  let agent: ReturnType<typeof makeAgent>;

  beforeEach(async () => {
    ws = makeWs();
    login = makeLogin();
    agent = makeAgent();
    new WsHandler(ws as any, agent, login);
  });

  function clientSend(msg: unknown) {
    ws._emit("message", JSON.stringify(msg));
  }

  it("login_start → calls login.startLogin with provider", async () => {
    clientSend({ type: "login_start", provider: "github" });
    await flushPromises();
    expect(login.startLogin).toHaveBeenCalledWith("github", expect.any(Function));
  });

  it("login_complete → refreshes auth state and reinitializes when no session is active", async () => {
    (agent.getState as ReturnType<typeof vi.fn>).mockReturnValueOnce(null);
    (login.startLogin as ReturnType<typeof vi.fn>).mockImplementation((_provider, send) => {
      send({ type: "login_complete", provider: "github" });
      return Promise.resolve();
    });

    clientSend({ type: "login_start", provider: "github" });
    await flushPromises();

    expect(agent.init).toHaveBeenCalled();
    expect(JSON.parse(ws._sent[0]).type).toBe("login_complete");
    expect(JSON.parse(ws._sent[1]).type).toBe("auth_status");
  });

  it("login_abort → calls login.abortLogin", async () => {
    clientSend({ type: "login_abort" });
    await flushPromises();
    expect(login.abortLogin).toHaveBeenCalled();
  });

  it("login_prompt_response → calls login.respondToPrompt with promptId and value", async () => {
    clientSend({ type: "login_prompt_response", promptId: "p-1", value: "the-code" });
    await flushPromises();
    expect(login.respondToPrompt).toHaveBeenCalledWith("p-1", "the-code");
  });

  it("logout → calls login.logout and sends auth_status", async () => {
    clientSend({ type: "logout", provider: "github" });
    await flushPromises();
    expect(login.logout).toHaveBeenCalledWith("github");
    const msg = JSON.parse(ws._sent[0]);
    expect(msg.type).toBe("auth_status");
  });

  it("get_auth_status → sends auth_status with providers list", async () => {
    clientSend({ type: "get_auth_status" });
    await flushPromises();
    const msg = JSON.parse(ws._sent[0]);
    expect(msg.type).toBe("auth_status");
    expect(Array.isArray(msg.providers)).toBe(true);
  });

  it("set_api_key → stores the key and refreshes auth state", async () => {
    clientSend({ type: "set_api_key", provider: "anthropic", key: "sk-test" });
    await flushPromises();
    expect(login.setApiKey).toHaveBeenCalledWith("anthropic", "sk-test");
    expect(JSON.parse(ws._sent[0]).type).toBe("auth_status");
  });

  it("clear_api_key → removes the stored key and refreshes auth state", async () => {
    clientSend({ type: "clear_api_key", provider: "openai" });
    await flushPromises();
    expect(login.clearApiKey).toHaveBeenCalledWith("openai");
    expect(JSON.parse(ws._sent[0]).type).toBe("auth_status");
  });

  it("auth changes reinitialize the agent when no session is active", async () => {
    (agent.getState as ReturnType<typeof vi.fn>).mockReturnValueOnce(null);
    clientSend({ type: "set_api_key", provider: "google", key: "secret" });
    await flushPromises();
    expect(agent.init).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// sendSessions field mapping
// ---------------------------------------------------------------------------

describe("WsHandler — sendSessions mapping", () => {
  it("maps s.path to file, truncates firstMessage at 120 chars, and ISO-formats modified", async () => {
    const modifiedDate = new Date("2024-06-15T12:00:00.000Z");
    const longMessage = "a".repeat(150);
    const agent = makeAgent();
    (agent.listSessions as ReturnType<typeof vi.fn>).mockResolvedValue([{
      id: "s1",
      path: "/data/sessions/s1.json",
      name: "My session",
      firstMessage: longMessage,
      modified: modifiedDate,
    }]);

    const ws = makeWs();
    new WsHandler(ws as any, agent, makeLogin());
    ws._emit("message", JSON.stringify({ type: "get_sessions" }));
    await flushPromises();

    const msg = JSON.parse(ws._sent[0]);
    const [s] = msg.sessions;
    expect(s.file).toBe("/data/sessions/s1.json");    // path → file
    expect(s.firstMessage).toHaveLength(120);            // truncated
    expect(s.modified).toBe(modifiedDate.toISOString()); // ISO string
  });
});

// ---------------------------------------------------------------------------
// Error propagation
// ---------------------------------------------------------------------------

describe("WsHandler — error propagation", () => {
  it("sends { type: 'error' } when agent.prompt rejects", async () => {
    const agent = makeAgent();
    (agent.prompt as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("quota exceeded"));
    const ws = makeWs();
    new WsHandler(ws as any, agent, makeLogin());

    ws._emit("message", JSON.stringify({ type: "prompt", text: "hello" }));
    await flushPromises();

    const msg = JSON.parse(ws._sent[0]);
    expect(msg.type).toBe("error");
    expect(msg.message).toContain("quota exceeded");
  });
});

