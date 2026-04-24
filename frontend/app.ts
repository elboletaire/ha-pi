import { renderMarkdown, escapeHtml } from "./renderer";
import { initSettings, handleAuthStatus, handleLoginEvent, type ProviderStatus } from "./settings";

// ---------------------------------------------------------------------------
// WebSocket connection (auto-reconnect)
// ---------------------------------------------------------------------------

const RECONNECT_DELAY = 3000;

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
  | { type: "auth_status"; providers: ProviderStatus[] };

type ClientMessage =
  | { type: "prompt"; text: string }
  | { type: "abort" }
  | { type: "new_session" }
  | { type: "switch_session"; sessionFile: string }
  | { type: "get_sessions" }
  | { type: "get_state" };

// ---------------------------------------------------------------------------
// DOM refs
// ---------------------------------------------------------------------------

const $messages   = document.getElementById("messages")!;
const $input      = document.getElementById("input") as HTMLTextAreaElement;
const $btnSend    = document.getElementById("btn-send") as HTMLButtonElement;
const $btnAbort   = document.getElementById("btn-abort") as HTMLButtonElement;
const $btnSessions    = document.getElementById("btn-sessions")!;
const $btnNewSession  = document.getElementById("btn-new-session")!;
const $btnCloseSessions = document.getElementById("btn-close-sessions")!;
const $modelBadge = document.getElementById("model-badge")!;
const $statusText = document.getElementById("status-text")!;
const $sessionInfo = document.getElementById("session-info")!;
const $sessionsOverlay = document.getElementById("sessions-overlay")!;
const $sessionsList    = document.getElementById("sessions-list")!;

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let ws: WebSocket | null = null;
let streaming = false;

// Per-run tracking
let currentAgentBubble: HTMLElement | null = null;
let currentRawText = "";
let currentThinkingEl: HTMLElement | null = null;
let currentThinkingRaw = "";
let currentToolEls = new Map<string, { header: HTMLElement; body: HTMLElement }>();

// Render debounce
let renderPending = false;

// ---------------------------------------------------------------------------
// WebSocket lifecycle
// ---------------------------------------------------------------------------

function wsUrl(): string {
  const proto = location.protocol === "https:" ? "wss" : "ws";
  // Build the WS URL relative to the current page path so it works both
  // directly (localhost:3000) and behind HA Ingress (which adds a dynamic
  // prefix like /api/hassio_ingress/TOKEN/ to all requests).
  const base = location.pathname.replace(/\/$/, "");
  return `${proto}://${location.host}${base}/ws`;
}

function connect() {
  setStatus("Connecting…");
  ws = new WebSocket(wsUrl());

  ws.addEventListener("open", () => {
    setStatus("Connected");
    send({ type: "get_state" });
  });

  ws.addEventListener("message", (ev) => {
    try {
      const msg = JSON.parse(ev.data) as ServerMessage;
      handleMessage(msg);
    } catch (e) {
      console.error("Bad message:", e);
    }
  });

  ws.addEventListener("close", () => {
    setStatus("Disconnected — reconnecting…");
    setStreaming(false);
    setTimeout(connect, RECONNECT_DELAY);
  });

  ws.addEventListener("error", () => {
    ws?.close();
  });
}

function send(msg: Record<string, unknown>) {
  ws?.readyState === WebSocket.OPEN && ws.send(JSON.stringify(msg));
}

// ---------------------------------------------------------------------------
// Message handling
// ---------------------------------------------------------------------------

function handleMessage(msg: ServerMessage) {
  switch (msg.type) {
    case "agent_start":
      startAgentTurn();
      break;

    case "text_delta":
      appendText(msg.delta);
      break;

    case "thinking_delta":
      appendThinking(msg.delta);
      break;

    case "tool_start":
      addToolBlock(msg.id, msg.name, msg.args);
      break;

    case "tool_update":
      updateToolBlock(msg.id, msg.output);
      break;

    case "tool_result":
      finaliseToolBlock(msg.id, msg.output, msg.isError);
      break;

    case "agent_end":
      endAgentTurn();
      break;

    case "error":
      showError(msg.message);
      break;

    case "state":
      applyState(msg);
      break;

    case "sessions":
      renderSessionsList(msg.sessions);
      break;

    case "auth_status":
      handleAuthStatus((msg as any).providers);
      break;

    default:
      if (typeof (msg as any).type === "string" && (msg as any).type.startsWith("login_")) {
        handleLoginEvent(msg as Record<string, unknown>);
      }
      break;
  }
}

// ---------------------------------------------------------------------------
// Agent turn management
// ---------------------------------------------------------------------------

function startAgentTurn() {
  setStreaming(true);
  currentAgentBubble = null;
  currentRawText = "";
  currentThinkingEl = null;
  currentThinkingRaw = "";
  currentToolEls.clear();
  renderPending = false;
}

function endAgentTurn() {
  setStreaming(false);
  // Final render pass
  if (currentAgentBubble && currentRawText) {
    renderMarkdown(currentRawText).then((html) => {
      const bubble = currentAgentBubble!.querySelector<HTMLElement>(".msg-text");
      if (bubble) {
        bubble.innerHTML = html;
        bubble.classList.remove("cursor");
      }
    });
  }
  currentAgentBubble = null;
  scrollBottom();
}

function ensureAgentBubble(): HTMLElement {
  if (!currentAgentBubble) {
    const msg = document.createElement("div");
    msg.className = "msg msg-agent";

    // Thinking toggle + block (initially empty/hidden)
    const thinkToggle = document.createElement("div");
    thinkToggle.className = "thinking-toggle hidden";
    thinkToggle.textContent = "▸ Thinking";

    const thinkBlock = document.createElement("div");
    thinkBlock.className = "thinking-block";

    thinkToggle.addEventListener("click", () => {
      const open = thinkBlock.classList.toggle("expanded");
      thinkToggle.textContent = open ? "▾ Thinking" : "▸ Thinking";
    });

    // Text bubble
    const bubble = document.createElement("div");
    bubble.className = "msg-bubble";

    const textEl = document.createElement("div");
    textEl.className = "msg-text cursor";
    bubble.appendChild(textEl);

    msg.appendChild(thinkToggle);
    msg.appendChild(thinkBlock);
    msg.appendChild(bubble);

    $messages.appendChild(msg);
    currentAgentBubble = msg;
    currentThinkingEl = thinkBlock;

    scrollBottom();
  }
  return currentAgentBubble;
}

function appendText(delta: string) {
  ensureAgentBubble();
  currentRawText += delta;
  scheduleRender();
}

function appendThinking(delta: string) {
  ensureAgentBubble();
  currentThinkingRaw += delta;

  // Show thinking toggle if we have content
  const toggle = currentAgentBubble!.querySelector<HTMLElement>(".thinking-toggle");
  toggle?.classList.remove("hidden");

  if (currentThinkingEl) {
    currentThinkingEl.textContent = currentThinkingRaw;
  }
}

function scheduleRender() {
  if (renderPending) return;
  renderPending = true;
  requestAnimationFrame(async () => {
    renderPending = false;
    if (!currentAgentBubble || !currentRawText) return;
    const textEl = currentAgentBubble.querySelector<HTMLElement>(".msg-text");
    if (textEl) {
      const html = await renderMarkdown(currentRawText);
      textEl.innerHTML = html;
      textEl.classList.add("cursor");
      scrollBottom();
    }
  });
}

// ---------------------------------------------------------------------------
// Tool blocks
// ---------------------------------------------------------------------------

function addToolBlock(id: string, name: string, args: unknown) {
  ensureAgentBubble();
  const block = document.createElement("div");
  block.className = "tool-block";

  const header = document.createElement("div");
  header.className = "tool-header";
  header.innerHTML = `
    <span class="tool-name">${escapeHtml(name)}</span>
    <code class="tool-args">${escapeHtml(JSON.stringify(args).slice(0, 80))}</code>
    <span class="tool-status running">⟳ running</span>
  `;

  const body = document.createElement("div");
  body.className = "tool-body";

  header.addEventListener("click", () => {
    body.classList.toggle("visible");
    header.classList.toggle("open");
  });

  block.appendChild(header);
  block.appendChild(body);

  // Insert before the text bubble
  const bubble = currentAgentBubble!.querySelector(".msg-bubble")!;
  currentAgentBubble!.insertBefore(block, bubble);

  currentToolEls.set(id, { header, body });
  scrollBottom();
}

function updateToolBlock(id: string, output: string) {
  const els = currentToolEls.get(id);
  if (els) {
    els.body.textContent = output;
  }
}

function finaliseToolBlock(id: string, output: string, isError: boolean) {
  const els = currentToolEls.get(id);
  if (!els) return;
  const statusEl = els.header.querySelector(".tool-status")!;
  statusEl.className = `tool-status ${isError ? "err" : "ok"}`;
  statusEl.textContent = isError ? "✕ error" : "✓ done";
  els.body.textContent = output;
}

// ---------------------------------------------------------------------------
// Error message
// ---------------------------------------------------------------------------

function showError(message: string) {
  setStreaming(false);
  const msg = document.createElement("div");
  msg.className = "msg msg-agent";
  msg.innerHTML = `<div class="msg-bubble" style="border-color:var(--danger);color:var(--danger)">
    ⚠ ${escapeHtml(message)}
  </div>`;
  $messages.appendChild(msg);
  scrollBottom();
}

// ---------------------------------------------------------------------------
// Sending user messages
// ---------------------------------------------------------------------------

function sendPrompt() {
  const text = $input.value.trim();
  if (!text || streaming) return;

  // Show user bubble
  const msg = document.createElement("div");
  msg.className = "msg msg-user";
  msg.innerHTML = `<div class="msg-bubble">${escapeHtml(text).replace(/\n/g, "<br>")}</div>`;
  $messages.appendChild(msg);
  scrollBottom();

  $input.value = "";
  resizeInput();

  send({ type: "prompt", text });
}

// ---------------------------------------------------------------------------
// UI helpers
// ---------------------------------------------------------------------------

function setStreaming(on: boolean) {
  streaming = on;
  $btnSend.disabled = on;
  $btnAbort.classList.toggle("hidden", !on);
}

function setStatus(text: string) {
  $statusText.textContent = text;
}

function applyState(state: Extract<ServerMessage, { type: "state" }>) {
  streaming = state.isStreaming;
  $btnSend.disabled = state.isStreaming;
  $btnAbort.classList.toggle("hidden", !state.isStreaming);
  $modelBadge.textContent = state.model ?? "";
  $sessionInfo.textContent = `${state.messageCount} msgs`;
  setStatus("Ready");
}

function scrollBottom() {
  $messages.scrollTop = $messages.scrollHeight;
}

function resizeInput() {
  $input.style.height = "auto";
  $input.style.height = Math.min($input.scrollHeight, 200) + "px";
}

function renderSessionsList(sessions: Array<{ id: string; file: string; name?: string; firstMessage: string; modified: string }>) {
  $sessionsList.innerHTML = "";
  if (sessions.length === 0) {
    $sessionsList.innerHTML = `<li style="color:var(--text-dim);padding:16px">No sessions yet</li>`;
    return;
  }
  for (const s of sessions.sort((a, b) => b.modified.localeCompare(a.modified))) {
    const li = document.createElement("li");
    li.innerHTML = `
      <div class="session-first">${escapeHtml(s.name ?? s.firstMessage ?? s.id)}</div>
      <div class="session-date">${new Date(s.modified).toLocaleString()}</div>
    `;
    li.addEventListener("click", () => {
      send({ type: "switch_session", sessionFile: s.file });
      $sessionsOverlay.classList.add("hidden");
    });
    $sessionsList.appendChild(li);
  }
}

// ---------------------------------------------------------------------------
// Event wiring
// ---------------------------------------------------------------------------

$btnSend.addEventListener("click", sendPrompt);

$btnAbort.addEventListener("click", () => send({ type: "abort" }));

$input.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    sendPrompt();
  }
});

$input.addEventListener("input", resizeInput);

$btnNewSession.addEventListener("click", () => {
  if (confirm("Start a new session? Current session is saved.")) {
    send({ type: "new_session" });
    $messages.innerHTML = "";
  }
});

$btnSessions.addEventListener("click", () => {
  send({ type: "get_sessions" });
  $sessionsOverlay.classList.remove("hidden");
});

$btnCloseSessions.addEventListener("click", () => {
  $sessionsOverlay.classList.add("hidden");
});

$sessionsOverlay.addEventListener("click", (e) => {
  if (e.target === $sessionsOverlay) $sessionsOverlay.classList.add("hidden");
});

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

initSettings(send);
connect();
