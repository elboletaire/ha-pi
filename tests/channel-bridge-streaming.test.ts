import { describe, it, expect, vi } from 'vitest'
import { ChannelBridge } from '../src/channel-bridge/bridge'
import type { ChannelAdapter } from '../src/channel-bridge/types'

// ── Helpers ──────────────────────────────────────────────────────────────────

function createMockAdapter(): ChannelAdapter & {
  send: ReturnType<typeof vi.fn>
  sendDraft: ReturnType<typeof vi.fn>
  sendTyping: ReturnType<typeof vi.fn>
} {
  return {
    direction: 'bidirectional',
    send: vi.fn().mockResolvedValue(undefined),
    sendDraft: vi.fn().mockResolvedValue(undefined),
    sendTyping: vi.fn().mockResolvedValue(undefined),
  }
}

function createBridge(
  adapter: ChannelAdapter,
  opts: {
    streamingDrafts?: boolean
    streamingIntervalMs?: number
    typingIndicators?: boolean
  } = {}
): ChannelBridge {
  const bridge = new ChannelBridge({
    provider: 'test',
    modelId: 'test-model',
    resourceLoader: {} as any,
    authStorage: {} as any,
    typingIndicators: opts.typingIndicators ?? false,
    streamingDrafts: opts.streamingDrafts ?? true,
    streamingIntervalMs: opts.streamingIntervalMs ?? 500,
  })
  bridge.registerAdapter('test', adapter)
  return bridge
}

/** Seed activeDrafts AND senderSessions so event-handler tests don't need a full processQueue run. */
function seedDraft(
  bridge: ChannelBridge,
  senderId: string,
  body = '',
  phase: 'status' | 'text' | 'done' = 'status',
  source = '🤖 anthropic/claude-3'
) {
  const [adapter, ...rest] = senderId.split(':')
  const sender = rest.join(':')
  ;(bridge as any).currentDraftSources.set(senderId, source)
  ;(bridge as any).draftCounter = Math.max((bridge as any).draftCounter ?? 0, 1)
  ;(bridge as any).activeDrafts.set(senderId, { draftId: 1, source, phase, body })
  if (!(bridge as any).senderSessions.has(senderId)) {
    ;(bridge as any).senderSessions.set(senderId, {
      adapter,
      sender,
      displayName: sender,
      queue: [],
      processing: false,
      abortController: null,
      messageCount: 0,
      startedAt: Date.now(),
    })
  }
}

/** Build a message_update event with the given AssistantMessageEvent payload. */
function msgUpdate(ae: Record<string, unknown>) {
  return {
    type: 'message_update',
    message: { role: 'assistant', content: [] },
    assistantMessageEvent: ae,
  }
}

const SOURCE_HEADER = '🧠 Pi · claude-3\n───\n'

// ── startDraftStreaming ───────────────────────────────────────────────────────

describe('startDraftStreaming', () => {
  it('returns null when streamingDrafts is false', () => {
    const adapter = createMockAdapter()
    const bridge = createBridge(adapter, { streamingDrafts: false })
    expect((bridge as any).startDraftStreaming('telegram:123')).toBeNull()
  })

  it('returns null when adapter has no sendDraft', () => {
    const adapter: ChannelAdapter = { direction: 'bidirectional', send: vi.fn() as any }
    const bridge = createBridge(adapter)
    expect((bridge as any).startDraftStreaming('telegram:123')).toBeNull()
  })

  it('returns a numeric draft ID and seeds activeDrafts when enabled', () => {
    const adapter = createMockAdapter()
    const bridge = createBridge(adapter)
    const id = (bridge as any).startDraftStreaming('telegram:123')
    expect(typeof id).toBe('number')
    expect(id).toBeGreaterThan(0)
    expect((bridge as any).activeDrafts.get('telegram:123')).toEqual({
      draftId: id,
      source: 'agent',
      phase: 'status',
      body: '',
    })
  })
})

// ── thinking_start → source header + 🤔 ──────────────────────────────────────

describe('handleAgentEvent — thinking_start', () => {
  it('renders the header immediately and sends the thinking emoji', async () => {
    const adapter = createMockAdapter()
    const bridge = createBridge(adapter)
    seedDraft(bridge, 'telegram:123')

    await (bridge as any).handleAgentEvent(
      'telegram:123',
      msgUpdate({ type: 'thinking_start', contentIndex: 0, partial: {} })
    )

    expect(adapter.sendDraft).toHaveBeenCalledOnce()
    expect(adapter.sendDraft).toHaveBeenCalledWith('123', 1, `${SOURCE_HEADER}<i>🤔</i>`, 'HTML')
    expect((bridge as any).activeDrafts.get('telegram:123')).toMatchObject({
      source: '🤖 anthropic/claude-3',
      phase: 'status',
      body: '<i>🤔</i>',
    })
  })

  it('is a no-op when no active draft exists (streamingDrafts off or adapter unsupported)', async () => {
    const adapter = createMockAdapter()
    const bridge = createBridge(adapter, { streamingDrafts: false })

    await (bridge as any).handleAgentEvent(
      'telegram:123',
      msgUpdate({ type: 'thinking_start', contentIndex: 0, partial: {} })
    )

    expect(adapter.sendDraft).not.toHaveBeenCalled()
  })
})

// ── tool_execution_start → source header + Using {tool}... ───────────────────

describe('handleAgentEvent — tool_execution_start', () => {
  it('renders the header immediately and sends the tool name', async () => {
    const adapter = createMockAdapter()
    const bridge = createBridge(adapter)
    seedDraft(bridge, 'telegram:123')

    await (bridge as any).handleAgentEvent('telegram:123', {
      type: 'tool_execution_start',
      toolCallId: 'call-1',
      toolName: 'bash',
      args: {},
    })

    expect(adapter.sendDraft).toHaveBeenCalledOnce()
    expect(adapter.sendDraft).toHaveBeenCalledWith('123', 1, `${SOURCE_HEADER}<i>Using bash...</i>`, 'HTML')
    expect((bridge as any).activeDrafts.get('telegram:123')).toMatchObject({
      source: '🤖 anthropic/claude-3',
      phase: 'status',
      body: '<i>Using bash...</i>',
    })
  })

  it('shows different tool names for sequential tool calls', async () => {
    const adapter = createMockAdapter()
    const bridge = createBridge(adapter)
    seedDraft(bridge, 'telegram:123')

    await (bridge as any).handleAgentEvent('telegram:123', {
      type: 'tool_execution_start',
      toolCallId: 'call-1',
      toolName: 'find',
      args: {},
    })
    await (bridge as any).handleAgentEvent('telegram:123', {
      type: 'tool_execution_start',
      toolCallId: 'call-2',
      toolName: 'curl',
      args: {},
    })

    expect(adapter.sendDraft).toHaveBeenCalledTimes(2)
    expect(adapter.sendDraft).toHaveBeenLastCalledWith('123', 1, `${SOURCE_HEADER}<i>Using curl...</i>`, 'HTML')
  })

  it('stops the typing indicator when a tool starts', async () => {
    const adapter = createMockAdapter()
    const bridge = createBridge(adapter)
    seedDraft(bridge, 'telegram:123')

    const stopFn = vi.fn()
    ;(bridge as any).stopTypingFunctions.set('telegram:123', stopFn)

    await (bridge as any).handleAgentEvent('telegram:123', {
      type: 'tool_execution_start',
      toolCallId: 'call-1',
      toolName: 'bash',
      args: {},
    })

    expect(stopFn).toHaveBeenCalledOnce()
    expect((bridge as any).stopTypingFunctions.has('telegram:123')).toBe(false)
  })
})

// ── text_start → header-only draft, then raw token streaming ─────────────────

describe('handleAgentEvent — text_start', () => {
  it('switches the bubble into text mode and clears the status body', async () => {
    const adapter = createMockAdapter()
    const bridge = createBridge(adapter)
    seedDraft(bridge, 'telegram:123', '<i>🤔</i>', 'status')

    await (bridge as any).handleAgentEvent(
      'telegram:123',
      msgUpdate({ type: 'text_start', contentIndex: 0, partial: {} })
    )

    expect(adapter.sendDraft).toHaveBeenCalledOnce()
    expect(adapter.sendDraft).toHaveBeenCalledWith('123', 1, SOURCE_HEADER, undefined)
    expect((bridge as any).activeDrafts.get('telegram:123')).toMatchObject({
      source: '🤖 anthropic/claude-3',
      phase: 'text',
      body: '',
    })
  })

  it('stops the typing indicator', async () => {
    const adapter = createMockAdapter()
    const bridge = createBridge(adapter)
    seedDraft(bridge, 'telegram:123')

    const stopFn = vi.fn()
    ;(bridge as any).stopTypingFunctions.set('telegram:123', stopFn)

    await (bridge as any).handleAgentEvent(
      'telegram:123',
      msgUpdate({ type: 'text_start', contentIndex: 0, partial: {} })
    )

    expect(stopFn).toHaveBeenCalledOnce()
    expect((bridge as any).stopTypingFunctions.has('telegram:123')).toBe(false)
  })
})

// ── text_delta → throttled token append ──────────────────────────────────────

describe('handleAgentEvent — text_delta', () => {
  it('appends the delta to draft text', async () => {
    const adapter = createMockAdapter()
    const bridge = createBridge(adapter, { streamingIntervalMs: 0 })
    seedDraft(bridge, 'telegram:123', 'Hello', 'text')

    await (bridge as any).handleAgentEvent(
      'telegram:123',
      msgUpdate({ type: 'text_delta', contentIndex: 0, delta: ' world', partial: {} })
    )

    expect((bridge as any).activeDrafts.get('telegram:123')).toMatchObject({
      source: '🤖 anthropic/claude-3',
      phase: 'text',
      body: 'Hello world',
    })
  })

  it('sends the accumulated text without parseMode', async () => {
    const adapter = createMockAdapter()
    const bridge = createBridge(adapter, { streamingIntervalMs: 0 })
    seedDraft(bridge, 'telegram:123', '', 'text')
    // lastDraftSent not set → defaults to 0 → throttle always passes

    await (bridge as any).handleAgentEvent(
      'telegram:123',
      msgUpdate({ type: 'text_delta', contentIndex: 0, delta: 'Hi', partial: {} })
    )

    expect(adapter.sendDraft).toHaveBeenCalledOnce()
    expect(adapter.sendDraft).toHaveBeenCalledWith('123', 1, `${SOURCE_HEADER}Hi`, undefined)
  })

  it('throttles rapid token updates', async () => {
    const adapter = createMockAdapter()
    const bridge = createBridge(adapter, { streamingIntervalMs: 10_000 })
    seedDraft(bridge, 'telegram:123', '', 'text')
    // Simulate "just sent" so the throttle window is active
    ;(bridge as any).lastDraftSent.set('telegram:123', Date.now())

    await (bridge as any).handleAgentEvent(
      'telegram:123',
      msgUpdate({ type: 'text_delta', contentIndex: 0, delta: 'Hello', partial: {} })
    )

    // Text was accumulated but API call was suppressed
    expect((bridge as any).activeDrafts.get('telegram:123')).toMatchObject({
      source: '🤖 anthropic/claude-3',
      phase: 'text',
      body: 'Hello',
    })
    expect(adapter.sendDraft).not.toHaveBeenCalled()
  })

  it('bypasses throttle after interval elapses', async () => {
    const adapter = createMockAdapter()
    const bridge = createBridge(adapter, { streamingIntervalMs: 1 })
    seedDraft(bridge, 'telegram:123', '', 'text')
    // lastDraftSent set to the distant past
    ;(bridge as any).lastDraftSent.set('telegram:123', 0)

    await (bridge as any).handleAgentEvent(
      'telegram:123',
      msgUpdate({ type: 'text_delta', contentIndex: 0, delta: 'Hello', partial: {} })
    )

    expect(adapter.sendDraft).toHaveBeenCalledOnce()
  })

  it('status messages (thinking/tool) bypass throttle even within interval', async () => {
    const adapter = createMockAdapter()
    const bridge = createBridge(adapter, { streamingIntervalMs: 10_000 })
    seedDraft(bridge, 'telegram:123', '', 'text')
    ;(bridge as any).lastDraftSent.set('telegram:123', Date.now())

    // Status event should still fire despite throttle window being active
    await (bridge as any).handleAgentEvent('telegram:123', {
      type: 'tool_execution_start',
      toolCallId: 'call-1',
      toolName: 'bash',
      args: {},
    })

    expect(adapter.sendDraft).toHaveBeenCalledOnce()
    expect(adapter.sendDraft).toHaveBeenCalledWith('123', 1, `${SOURCE_HEADER}<i>Using bash...</i>`, 'HTML')
  })
})

// ── message_end does not clear activeDrafts ───────────────────────────────────

describe('handleAgentEvent — message_end', () => {
  it('increments messageCount but does NOT delete the active draft', async () => {
    const adapter = createMockAdapter()
    const bridge = createBridge(adapter)
    seedDraft(bridge, 'telegram:123', 'some streamed text', 'text')

    await (bridge as any).handleAgentEvent('telegram:123', {
      type: 'message_end',
      message: { role: 'assistant', content: [] },
    })

    expect((bridge as any).activeDrafts.has('telegram:123')).toBe(true)
    expect((bridge as any).senderSessions.get('telegram:123').messageCount).toBe(1)
  })
})

// ── finalizeDraft ────────────────────────────────────────────────────────────

describe('finalizeDraft', () => {
  it('updates draft with final HTML and marks the segment done', async () => {
    const adapter = createMockAdapter()
    const bridge = createBridge(adapter)
    seedDraft(bridge, 'telegram:123', '<i>🤔</i>', 'text')

    const finalized = await (bridge as any).finalizeDraft(
      'telegram:123',
      'telegram',
      '123',
      '**Final formatted response**',
      undefined,
      '🤖 anthropic/claude-3'
    )

    expect(finalized).toBe(true)
    expect(adapter.sendDraft).toHaveBeenCalledOnce()
    const call = (adapter.sendDraft as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(call[2]).toContain('🧠 Pi · claude-3')
    expect(call[2]).toContain('<b>Final formatted response</b>')
    expect(call[3]).toBe('HTML')
    expect((bridge as any).activeDrafts.get('telegram:123')).toMatchObject({
      source: '🤖 anthropic/claude-3',
      phase: 'done',
      body: '**Final formatted response**',
    })
  })

  it('returns false when the draft entry is missing', async () => {
    const adapter = createMockAdapter()
    const bridge = createBridge(adapter)

    const result = await (bridge as any).finalizeDraft('telegram:123', 'telegram', '123', 'Final', undefined, 'agent')

    expect(result).toBe(false)
    expect(adapter.sendDraft).not.toHaveBeenCalled()
  })
})

// ── full state-machine sequence ───────────────────────────────────────────────

describe('draft state machine — full sequence', () => {
  it('think → tool → stream → finalize → think again produces distinct bubbles', async () => {
    const adapter = createMockAdapter()
    const bridge = createBridge(adapter, { streamingIntervalMs: 0 })
    seedDraft(bridge, 'telegram:123')

    // 1. Model starts thinking
    await (bridge as any).handleAgentEvent(
      'telegram:123',
      msgUpdate({ type: 'thinking_start', contentIndex: 0, partial: {} })
    )
    expect((bridge as any).activeDrafts.get('telegram:123')).toMatchObject({
      source: '🤖 anthropic/claude-3',
      phase: 'status',
      body: '<i>🤔</i>',
    })

    // 2. Tool starts executing
    await (bridge as any).handleAgentEvent('telegram:123', {
      type: 'tool_execution_start',
      toolCallId: 'c1',
      toolName: 'bash',
      args: {},
    })
    expect((bridge as any).activeDrafts.get('telegram:123')).toMatchObject({
      source: '🤖 anthropic/claude-3',
      phase: 'status',
      body: '<i>Using bash...</i>',
    })

    // 3. Final response begins — text resets silently
    await (bridge as any).handleAgentEvent(
      'telegram:123',
      msgUpdate({ type: 'text_start', contentIndex: 0, partial: {} })
    )
    expect((bridge as any).activeDrafts.get('telegram:123')).toMatchObject({
      source: '🤖 anthropic/claude-3',
      phase: 'text',
      body: '',
    })

    // 4. Tokens stream in
    for (const token of ['Hello', ', ', 'world', '!']) {
      await (bridge as any).handleAgentEvent(
        'telegram:123',
        msgUpdate({ type: 'text_delta', contentIndex: 0, delta: token, partial: {} })
      )
    }
    expect((bridge as any).activeDrafts.get('telegram:123')).toMatchObject({
      source: '🤖 anthropic/claude-3',
      phase: 'text',
      body: 'Hello, world!',
    })

    // 5. Finalize with fully formatted text
    const finalized = await (bridge as any).finalizeDraft(
      'telegram:123',
      'telegram',
      '123',
      '**Hello**, world!',
      undefined,
      'agent'
    )
    expect(finalized).toBe(true)
    expect((bridge as any).activeDrafts.get('telegram:123')).toMatchObject({
      source: '🤖 anthropic/claude-3',
      phase: 'done',
      body: '**Hello**, world!',
    })

    // 6. If the model starts thinking again, a new bubble should be created
    await (bridge as any).handleAgentEvent(
      'telegram:123',
      msgUpdate({ type: 'thinking_start', contentIndex: 1, partial: {} })
    )
    const secondBubble = (bridge as any).activeDrafts.get('telegram:123')
    expect(secondBubble).toMatchObject({
      source: '🤖 anthropic/claude-3',
      phase: 'status',
      body: '<i>🤔</i>',
    })
    expect(secondBubble.draftId).toBeGreaterThan(1)
    expect(adapter.sendDraft).toHaveBeenCalled()
  })
})
