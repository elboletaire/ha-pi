import { renderMarkdown, escapeHtml } from './renderer'
import { initSettings, handleAuthStatus, handleLoginEvent } from './settings'
import { handleAvailableModels, handleCurrentModel, initModelSelector, openModelSelector } from './model-selector'
import { initShortcutsLegend } from './shortcuts'
import { buildSessionHistoryOps } from './session-history'
import type { ClientMessage, ServerMessage, SessionMessage } from './protocol'

// ---------------------------------------------------------------------------
// WebSocket connection (auto-reconnect)
// ---------------------------------------------------------------------------

const RECONNECT_DELAY = 3000

// ---------------------------------------------------------------------------
// DOM refs
// ---------------------------------------------------------------------------

const $messages = document.getElementById('messages')!
const $input = document.getElementById('input') as HTMLTextAreaElement
const $btnSend = document.getElementById('btn-send') as HTMLButtonElement
const $btnAbort = document.getElementById('btn-abort') as HTMLButtonElement
const $btnSessions = document.getElementById('btn-sessions')!
const $btnNewSession = document.getElementById('btn-new-session')!
const $btnCloseSessions = document.getElementById('btn-close-sessions')!
const $modelBadge = document.getElementById('model-badge')!
const $statusText = document.getElementById('status-text')!
const $sessionInfo = document.getElementById('session-info')!
const $sessionsOverlay = document.getElementById('sessions-overlay')!
const $sessionsList = document.getElementById('sessions-list')!

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let ws: WebSocket | null = null
let streaming = false
let currentSessionFile: string | undefined

// Per-run tracking
let currentAgentBubble: HTMLElement | null = null
let currentRawText = ''
let currentThinkingEl: HTMLElement | null = null
let currentThinkingRaw = ''
let currentToolEls = new Map<string, { header: HTMLElement; body: HTMLElement }>()

// Render debounce
let renderPending = false

// ---------------------------------------------------------------------------
// WebSocket lifecycle
// ---------------------------------------------------------------------------

function wsUrl(): string {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws'
  // Build the WS URL relative to the current page path so it works both
  // directly (localhost:3000) and behind HA Ingress (which adds a dynamic
  // prefix like /api/hassio_ingress/TOKEN/ to all requests).
  const base = location.pathname.replace(/\/$/, '')
  return `${proto}://${location.host}${base}/ws`
}

function connect() {
  setStatus('Connecting…')
  ws = new WebSocket(wsUrl())

  ws.addEventListener('open', () => {
    setStatus('Connected')
    send({ type: 'get_state' })
  })

  ws.addEventListener('message', (ev) => {
    try {
      const msg = JSON.parse(ev.data) as ServerMessage
      handleMessage(msg)
    } catch (e) {
      console.error('Bad message:', e)
    }
  })

  ws.addEventListener('close', () => {
    setStatus('Disconnected — reconnecting…')
    setStreaming(false)
    setTimeout(connect, RECONNECT_DELAY)
  })

  ws.addEventListener('error', () => {
    ws?.close()
  })
}

function send(msg: ClientMessage) {
  ws?.readyState === WebSocket.OPEN && ws.send(JSON.stringify(msg))
}

// ---------------------------------------------------------------------------
// Message handling
// ---------------------------------------------------------------------------

function handleMessage(msg: ServerMessage) {
  switch (msg.type) {
    case 'agent_start':
      startAgentTurn()
      break

    case 'text_delta':
      appendText(msg.delta)
      break

    case 'thinking_delta':
      appendThinking(msg.delta)
      break

    case 'tool_start':
      addToolBlock(msg.id, msg.name, msg.args)
      break

    case 'tool_update':
      updateToolBlock(msg.id, msg.output)
      break

    case 'tool_result':
      finaliseToolBlock(msg.id, msg.output, msg.isError)
      break

    case 'agent_end':
      endAgentTurn()
      break

    case 'error':
      showError(msg.message)
      break

    case 'state':
      applyState(msg)
      break

    case 'sessions':
      renderSessionsList(msg.sessions)
      break

    case 'session_history':
      void hydrateSessionHistory(msg.messages)
      break

    case 'available_models':
      handleAvailableModels(msg.models)
      break

    case 'auth_status':
      handleAuthStatus(msg.providers)
      break

    case 'login_device_flow':
    case 'login_open_url':
    case 'login_progress':
    case 'login_prompt':
    case 'login_complete':
    case 'login_error':
      handleLoginEvent(msg)
      break

    default:
      break
  }
}

// ---------------------------------------------------------------------------
// Agent turn management
// ---------------------------------------------------------------------------

function startAgentTurn() {
  setStreaming(true)
  currentAgentBubble = null
  currentRawText = ''
  currentThinkingEl = null
  currentThinkingRaw = ''
  currentToolEls.clear()
  renderPending = false
}

function endAgentTurn() {
  setStreaming(false)
  const bubble = currentAgentBubble
  void renderAssistantMarkdown(bubble, currentRawText)
  currentAgentBubble = null
  currentRawText = ''
  currentThinkingEl = null
  currentThinkingRaw = ''
  currentToolEls.clear()
  scrollBottom()
}

function createAgentBubble(withCursor: boolean): HTMLElement {
  const msg = document.createElement('div')
  msg.className = 'msg msg-agent'

  // Thinking toggle + block (initially empty/hidden)
  const thinkToggle = document.createElement('div')
  thinkToggle.className = 'thinking-toggle hidden'
  thinkToggle.textContent = '▸ Thinking'

  const thinkBlock = document.createElement('div')
  thinkBlock.className = 'thinking-block'

  thinkToggle.addEventListener('click', () => {
    const open = thinkBlock.classList.toggle('expanded')
    thinkToggle.textContent = open ? '▾ Thinking' : '▸ Thinking'
  })

  // Text bubble
  const bubble = document.createElement('div')
  bubble.className = 'msg-bubble'

  const textEl = document.createElement('div')
  textEl.className = withCursor ? 'msg-text cursor' : 'msg-text'
  bubble.appendChild(textEl)

  msg.appendChild(thinkToggle)
  msg.appendChild(thinkBlock)
  msg.appendChild(bubble)

  $messages.appendChild(msg)
  currentAgentBubble = msg
  currentThinkingEl = thinkBlock

  scrollBottom()
  return msg
}

function ensureAgentBubble(): HTMLElement {
  if (!currentAgentBubble) {
    createAgentBubble(true)
  }
  return currentAgentBubble!
}

function appendText(delta: string) {
  ensureAgentBubble()
  currentRawText += delta
  scheduleRender()
}

function appendThinking(delta: string) {
  ensureAgentBubble()
  currentThinkingRaw += delta

  // Show thinking toggle if we have content
  const toggle = currentAgentBubble!.querySelector<HTMLElement>('.thinking-toggle')
  toggle?.classList.remove('hidden')

  if (currentThinkingEl) {
    currentThinkingEl.textContent = currentThinkingRaw
  }
}

function scheduleRender() {
  if (renderPending) return
  renderPending = true
  requestAnimationFrame(async () => {
    renderPending = false
    if (!currentAgentBubble || !currentRawText) return
    const textEl = currentAgentBubble.querySelector<HTMLElement>('.msg-text')
    if (textEl) {
      const html = await renderMarkdown(currentRawText)
      textEl.innerHTML = html
      textEl.classList.add('cursor')
      scrollBottom()
    }
  })
}

function resetConversation() {
  setStreaming(false)
  currentAgentBubble = null
  currentRawText = ''
  currentThinkingEl = null
  currentThinkingRaw = ''
  currentToolEls.clear()
  renderPending = false
  $messages.innerHTML = ''
}

function renderUserBubble(text: string) {
  const msg = document.createElement('div')
  msg.className = 'msg msg-user'
  msg.innerHTML = `<div class="msg-bubble">${escapeHtml(text).replace(/\n/g, '<br>')}</div>`
  $messages.appendChild(msg)
  scrollBottom()
}

async function renderAssistantMarkdown(bubble: HTMLElement | null, rawText: string) {
  if (!bubble) return

  const textBubble = bubble.querySelector<HTMLElement>('.msg-bubble')
  if (!rawText) {
    textBubble?.remove()
    scrollBottom()
    return
  }

  const textEl = bubble.querySelector<HTMLElement>('.msg-text')
  if (!textEl) return
  const html = await renderMarkdown(rawText)
  textEl.innerHTML = html
  textEl.classList.remove('cursor')
  scrollBottom()
}

async function hydrateSessionHistory(messages: SessionMessage[]) {
  resetConversation()

  const ops = buildSessionHistoryOps(messages)
  for (const op of ops) {
    switch (op.type) {
      case 'user':
        if (currentAgentBubble) {
          await renderAssistantMarkdown(currentAgentBubble, currentRawText)
          currentAgentBubble = null
        }
        currentToolEls.clear()
        currentRawText = ''
        currentThinkingRaw = ''
        currentThinkingEl = null
        renderUserBubble(op.text)
        break

      case 'assistant_start':
        if (currentAgentBubble) {
          await renderAssistantMarkdown(currentAgentBubble, currentRawText)
        }
        currentToolEls.clear()
        currentRawText = ''
        currentThinkingRaw = ''
        currentAgentBubble = createAgentBubble(false)
        break

      case 'assistant_text':
        currentRawText += op.text
        break

      case 'assistant_thinking':
        if (!currentAgentBubble) {
          currentAgentBubble = createAgentBubble(false)
        }
        currentThinkingRaw += op.text
        currentThinkingEl = currentAgentBubble.querySelector<HTMLElement>('.thinking-block')
        currentThinkingEl?.classList.remove('hidden')
        if (currentThinkingEl) {
          currentThinkingEl.textContent = currentThinkingRaw
        }
        const toggle = currentAgentBubble.querySelector<HTMLElement>('.thinking-toggle')
        toggle?.classList.remove('hidden')
        break

      case 'assistant_tool_call':
        if (!currentAgentBubble) {
          currentAgentBubble = createAgentBubble(false)
        }
        addToolBlock(op.id, op.name, op.args)
        break

      case 'assistant_end':
        await renderAssistantMarkdown(currentAgentBubble, currentRawText)
        break

      case 'tool_result': {
        if (!currentAgentBubble) {
          currentAgentBubble = createAgentBubble(false)
        }
        const els = currentToolEls.get(op.id)
        if (els) {
          els.body.textContent = op.output
          const statusEl = els.header.querySelector('.tool-status')!
          statusEl.className = `tool-status ${op.isError ? 'err' : 'ok'}`
          statusEl.textContent = op.isError ? '✕ error' : '✓ done'
        } else {
          addToolBlock(op.id, op.name, {})
          finaliseToolBlock(op.id, op.output, op.isError)
        }
        break
      }
    }
  }

  await renderAssistantMarkdown(currentAgentBubble, currentRawText)
  scrollBottom()
}

// ---------------------------------------------------------------------------
// Tool blocks
// ---------------------------------------------------------------------------

function addToolBlock(id: string, name: string, args: unknown) {
  ensureAgentBubble()
  const block = document.createElement('div')
  block.className = 'tool-block'

  const header = document.createElement('div')
  header.className = 'tool-header'
  header.innerHTML = `
    <span class="tool-name">${escapeHtml(name)}</span>
    <code class="tool-args">${escapeHtml(JSON.stringify(args).slice(0, 80))}</code>
    <span class="tool-status running">⟳ running</span>
  `

  const body = document.createElement('div')
  body.className = 'tool-body'

  header.addEventListener('click', () => {
    body.classList.toggle('visible')
    header.classList.toggle('open')
  })

  block.appendChild(header)
  block.appendChild(body)

  // Insert before the text bubble
  const bubble = currentAgentBubble!.querySelector('.msg-bubble')!
  currentAgentBubble!.insertBefore(block, bubble)

  currentToolEls.set(id, { header, body })
  scrollBottom()
}

function updateToolBlock(id: string, output: string) {
  const els = currentToolEls.get(id)
  if (els) {
    els.body.textContent = output
  }
}

function finaliseToolBlock(id: string, output: string, isError: boolean) {
  const els = currentToolEls.get(id)
  if (!els) return
  const statusEl = els.header.querySelector('.tool-status')!
  statusEl.className = `tool-status ${isError ? 'err' : 'ok'}`
  statusEl.textContent = isError ? '✕ error' : '✓ done'
  els.body.textContent = output
}

// ---------------------------------------------------------------------------
// Error message
// ---------------------------------------------------------------------------

function showError(message: string) {
  setStreaming(false)
  const msg = document.createElement('div')
  msg.className = 'msg msg-agent'
  msg.innerHTML = `<div class="msg-bubble" style="border-color:var(--danger);color:var(--danger)">
    ⚠ ${escapeHtml(message)}
  </div>`
  $messages.appendChild(msg)
  scrollBottom()
}

// ---------------------------------------------------------------------------
// Sending user messages
// ---------------------------------------------------------------------------

function sendPrompt() {
  const text = $input.value.trim()
  if (!text || streaming) return

  // Show user bubble
  const msg = document.createElement('div')
  msg.className = 'msg msg-user'
  msg.innerHTML = `<div class="msg-bubble">${escapeHtml(text).replace(/\n/g, '<br>')}</div>`
  $messages.appendChild(msg)
  scrollBottom()

  $input.value = ''
  resizeInput()

  send({ type: 'prompt', text })
}

// ---------------------------------------------------------------------------
// UI helpers
// ---------------------------------------------------------------------------

function setStreaming(on: boolean) {
  streaming = on
  $btnSend.disabled = on
  $btnAbort.classList.toggle('hidden', !on)

  if (!on) {
    clearStreamingCursor()
  }
}

function setStatus(text: string) {
  $statusText.textContent = text
}

function applyState(state: Extract<ServerMessage, { type: 'state' }>) {
  streaming = state.isStreaming
  currentSessionFile = state.sessionFile
  $btnSend.disabled = state.isStreaming
  $btnAbort.classList.toggle('hidden', !state.isStreaming)
  $modelBadge.textContent = state.model ?? ''
  $sessionInfo.textContent = `${state.messageCount} msgs`
  handleCurrentModel(state.model)
  setStatus('Ready')
}

function clearStreamingCursor() {
  $messages.querySelectorAll<HTMLElement>('.msg-text.cursor').forEach((el) => el.classList.remove('cursor'))
}

function scrollBottom() {
  $messages.scrollTop = $messages.scrollHeight
}

function resizeInput() {
  $input.style.height = 'auto'
  $input.style.height = Math.min($input.scrollHeight, 200) + 'px'
}

function renderSessionsList(
  sessions: Array<{ id: string; file: string; name?: string; firstMessage: string; modified: string }>
) {
  $sessionsList.innerHTML = ''
  if (sessions.length === 0) {
    $sessionsList.innerHTML = `<li style="color:var(--text-dim);padding:16px">No sessions yet</li>`
    return
  }
  for (const s of sessions.sort((a, b) => b.modified.localeCompare(a.modified))) {
    const li = document.createElement('li')
    li.className = 'session-row'

    const info = document.createElement('div')
    info.className = 'session-meta'

    const first = document.createElement('div')
    first.className = 'session-first'
    first.textContent = s.name ?? s.firstMessage ?? s.id

    const date = document.createElement('div')
    date.className = 'session-date'
    date.textContent = new Date(s.modified).toLocaleString()

    info.appendChild(first)
    info.appendChild(date)

    const actions = document.createElement('div')
    actions.className = 'session-actions'

    if (s.file === currentSessionFile) {
      const badge = document.createElement('span')
      badge.className = 'session-current-badge'
      badge.textContent = 'Current'
      actions.appendChild(badge)
    }

    const deleteBtn = document.createElement('button')
    deleteBtn.type = 'button'
    deleteBtn.className = 'session-delete-btn'
    deleteBtn.textContent = 'Delete'
    deleteBtn.title = 'Delete this session'
    deleteBtn.addEventListener('click', (e) => {
      e.stopPropagation()
      const message =
        s.file === currentSessionFile
          ? 'Delete this session and start a fresh one?'
          : 'Delete this session permanently?'
      if (confirm(message)) {
        send({ type: 'delete_session', sessionFile: s.file })
      }
    })
    actions.appendChild(deleteBtn)

    li.appendChild(info)
    li.appendChild(actions)

    li.addEventListener('click', () => {
      send({ type: 'switch_session', sessionFile: s.file })
      $sessionsOverlay.classList.add('hidden')
    })
    $sessionsList.appendChild(li)
  }
}

// ---------------------------------------------------------------------------
// Event wiring
// ---------------------------------------------------------------------------

$btnSend.addEventListener('click', sendPrompt)

$btnAbort.addEventListener('click', () => send({ type: 'abort' }))

$input.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault()
    sendPrompt()
  }
})

$input.addEventListener('input', resizeInput)

$btnNewSession.addEventListener('click', () => {
  if (confirm('Start a new session? Current session is saved.')) {
    send({ type: 'new_session' })
    $messages.innerHTML = ''
  }
})

$btnSessions.addEventListener('click', () => {
  send({ type: 'get_sessions' })
  $sessionsOverlay.classList.remove('hidden')
})

$btnCloseSessions.addEventListener('click', () => {
  $sessionsOverlay.classList.add('hidden')
})

$sessionsOverlay.addEventListener('click', (e) => {
  if (e.target === $sessionsOverlay) $sessionsOverlay.classList.add('hidden')
})

// Browser-safe keyboard shortcuts. Keep them broad and explicit so we don't
// fight with built-in browser shortcuts like Ctrl+L / Ctrl+P.
document.addEventListener('keydown', (e) => {
  if (!e.altKey || !e.shiftKey || e.ctrlKey || e.metaKey) return

  switch (e.code) {
    case 'KeyM':
      e.preventDefault()
      openModelSelector()
      break
    case 'KeyH':
      e.preventDefault()
      document.getElementById('btn-shortcuts')?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      break
    case 'Comma':
      e.preventDefault()
      send({ type: 'cycle_model', direction: 'backward' })
      break
    case 'Period':
      e.preventDefault()
      send({ type: 'cycle_model', direction: 'forward' })
      break
  }
})

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

initModelSelector(send)
initShortcutsLegend()
initSettings(send)
connect()
