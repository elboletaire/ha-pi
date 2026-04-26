/**
 * Tests for ChannelBridge session resumption across restarts.
 *
 * Strategy: inject a mock SenderSessionRegistry and a mock AgentManager
 * (via vi.hoisted + vi.mock) so we can verify which session file is passed
 * to `init()` and when the registry is updated — without touching the real
 * pi SDK or file system.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ChannelBridge } from '../src/channel-bridge/bridge'
import type { ChannelAdapter, IncomingMessage } from '../src/channel-bridge/types'
import type { SenderSessionRegistry } from '../src/channel-bridge/sender-session-registry'

// ── Hoisted mock state ────────────────────────────────────────────────────────
// vi.hoisted() runs before any module imports, so these values are available
// inside the vi.mock() factory below.

const { existsSyncMock, mocks } = vi.hoisted(() => ({
  existsSyncMock: vi.fn<(path: string) => boolean>().mockReturnValue(true),
  mocks: {
  init: vi.fn<(sessionFile?: string) => Promise<void>>().mockResolvedValue(undefined),
  getState: vi.fn().mockReturnValue({
    sessionFile: '/sessions/current.jsonl',
    sessionId: 'abc123',
    model: 'test/test-model',
    isStreaming: false,
    thinkingLevel: 'off',
    messageCount: 0,
  }),
  subscribe: vi.fn().mockReturnValue(() => {}),
  prompt: vi.fn().mockResolvedValue(undefined),
  getMessages: vi.fn().mockReturnValue([
    { role: 'assistant', content: [{ type: 'text', text: 'Hello!' }] },
  ]),
  newSession: vi.fn().mockResolvedValue(undefined),
  switchSession: vi.fn().mockResolvedValue(undefined),
  abort: vi.fn().mockResolvedValue(undefined),
  getAvailableModels: vi.fn().mockReturnValue([]),
    listSessions: vi.fn().mockResolvedValue([]),
  },
}))

// ── node:fs mock ────────────────────────────────────────────────────────────
// Controls existsSync behaviour for the cached-session-file-deleted check in
// ChannelBridge.getAgentManager(). Default: file exists (returns true).

vi.mock('node:fs', () => ({
  existsSync: existsSyncMock,
}))

// ── AgentManager class mock ───────────────────────────────────────────────────

vi.mock('../src/agent-manager', () => ({
  AgentManager: class MockAgentManager {
    init = mocks.init
    getState = mocks.getState
    subscribe = mocks.subscribe
    prompt = mocks.prompt
    getMessages = mocks.getMessages
    newSession = mocks.newSession
    switchSession = mocks.switchSession
    abort = mocks.abort
    getAvailableModels = mocks.getAvailableModels
    listSessions = mocks.listSessions
  },
}))

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeMockRegistry(initial: Record<string, string> = {}): SenderSessionRegistry {
  const store = new Map<string, string>(Object.entries(initial))
  return {
    get: vi.fn((id: string) => store.get(id)),
    set: vi.fn((id: string, file: string) => {
      store.set(id, file)
    }),
    delete: vi.fn((id: string) => {
      store.delete(id)
    }),
    getAll: vi.fn(() => store as ReadonlyMap<string, string>),
  } as unknown as SenderSessionRegistry
}

function makeMockAdapter(): ChannelAdapter {
  return {
    direction: 'bidirectional',
    send: vi.fn().mockResolvedValue(undefined),
    sendTyping: vi.fn().mockResolvedValue(undefined),
  }
}

function makeIncomingMessage(text = 'hello', sender = '123'): IncomingMessage {
  return { adapter: 'telegram', sender, text }
}

function makeBridge(registry: SenderSessionRegistry): ChannelBridge {
  const bridge = new ChannelBridge({
    provider: 'test',
    modelId: 'test-model',
    resourceLoader: {} as any,
    authStorage: {} as any,
    typingIndicators: false,
    streamingDrafts: false,
    senderSessionRegistry: registry,
  })
  bridge.registerAdapter('test', makeMockAdapter())
  return bridge
}

// ── Setup ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks()
  // Re-apply default mock behaviours after clearAllMocks resets them
  mocks.init.mockResolvedValue(undefined)
  mocks.getState.mockReturnValue({
    sessionFile: '/sessions/current.jsonl',
    sessionId: 'abc123',
    model: 'test/test-model',
    isStreaming: false,
    thinkingLevel: 'off',
    messageCount: 0,
  })
  mocks.subscribe.mockReturnValue(() => {})
  mocks.prompt.mockResolvedValue(undefined)
  mocks.getMessages.mockReturnValue([
    { role: 'assistant', content: [{ type: 'text', text: 'Hello!' }] },
  ])
  mocks.newSession.mockResolvedValue(undefined)
  mocks.switchSession.mockResolvedValue(undefined)
  mocks.listSessions.mockResolvedValue([])
  // Default: session file exists on disk
  existsSyncMock.mockReturnValue(true)
})

// ── getAgentManager / init() ──────────────────────────────────────────────────

describe('ChannelBridge — session resume on first message', () => {
  it('passes undefined to init() when no prior session exists in registry', async () => {
    const registry = makeMockRegistry() // empty
    const bridge = makeBridge(registry)

    await (bridge as any).handleIncomingMessage(makeIncomingMessage())

    expect(mocks.init).toHaveBeenCalledOnce()
    expect(mocks.init).toHaveBeenCalledWith(undefined)
  })

  it('passes the stored session file to init() when one exists in the registry', async () => {
    const registry = makeMockRegistry({
      'telegram:123': '/sessions/previous.jsonl',
    })
    const bridge = makeBridge(registry)

    await (bridge as any).handleIncomingMessage(makeIncomingMessage())

    expect(mocks.init).toHaveBeenCalledOnce()
    expect(mocks.init).toHaveBeenCalledWith('/sessions/previous.jsonl')
  })

  it('saves the session file to the registry after init', async () => {
    const registry = makeMockRegistry()
    const bridge = makeBridge(registry)

    await (bridge as any).handleIncomingMessage(makeIncomingMessage())

    expect(registry.set).toHaveBeenCalledWith('telegram:123', '/sessions/current.jsonl')
  })

  it('updates the registry when getState returns a different file than what was stored', async () => {
    // Simulate: stored path was old/deleted, SDK started a fresh session at a new path
    const registry = makeMockRegistry({
      'telegram:123': '/sessions/old-gone.jsonl',
    })
    mocks.getState.mockReturnValue({
      sessionFile: '/sessions/fresh.jsonl',
      sessionId: 'xyz',
      model: 'test/test-model',
      isStreaming: false,
      thinkingLevel: 'off',
      messageCount: 0,
    })
    const bridge = makeBridge(registry)

    await (bridge as any).handleIncomingMessage(makeIncomingMessage())

    // Should have been updated to the actual session file returned by getState
    expect(registry.set).toHaveBeenCalledWith('telegram:123', '/sessions/fresh.jsonl')
  })

  it('does not call init() again for the same sender on the second message', async () => {
    const registry = makeMockRegistry()
    const bridge = makeBridge(registry)
    const msg = makeIncomingMessage()

    await (bridge as any).handleIncomingMessage(msg)
    await (bridge as any).handleIncomingMessage(msg)

    expect(mocks.init).toHaveBeenCalledOnce()
  })

  it('uses separate registry keys for different senders', async () => {
    const registry = makeMockRegistry({
      'telegram:111': '/sessions/alice.jsonl',
      'telegram:222': '/sessions/bob.jsonl',
    })
    const bridge = makeBridge(registry)

    await (bridge as any).handleIncomingMessage(makeIncomingMessage('hi', '111'))
    await (bridge as any).handleIncomingMessage(makeIncomingMessage('hi', '222'))

    // init() should have been called twice with the respective session files
    expect(mocks.init).toHaveBeenCalledTimes(2)
    const calls = mocks.init.mock.calls
    const files = calls.map((c) => c[0])
    expect(files).toContain('/sessions/alice.jsonl')
    expect(files).toContain('/sessions/bob.jsonl')
  })
})

// ── Registry update after commands ───────────────────────────────────────────

describe('ChannelBridge — registry updated after commands', () => {
  it('updates the registry after /new creates a new session', async () => {
    const registry = makeMockRegistry({
      'telegram:123': '/sessions/old.jsonl',
    })
    const bridge = makeBridge(registry)

    // First message initialises the manager, getState returns old file
    mocks.getState.mockReturnValueOnce({
      sessionFile: '/sessions/old.jsonl',
      sessionId: 'old-id',
      model: 'test/test-model',
      isStreaming: false,
      thinkingLevel: 'off',
      messageCount: 0,
    })

    // After /new the agent switches to a new session file
    mocks.getState.mockReturnValue({
      sessionFile: '/sessions/brand-new.jsonl',
      sessionId: 'new-id',
      model: 'test/test-model',
      isStreaming: false,
      thinkingLevel: 'off',
      messageCount: 0,
    })

    await (bridge as any).handleIncomingMessage(makeIncomingMessage('/new'))

    // The last call to registry.set should point at the new session file
    const setCalls = (registry.set as ReturnType<typeof vi.fn>).mock.calls
    const lastCall = setCalls.at(-1)
    expect(lastCall?.[0]).toBe('telegram:123')
    expect(lastCall?.[1]).toBe('/sessions/brand-new.jsonl')
  })

  it('updates the registry after /session switches to an existing session', async () => {
    const registry = makeMockRegistry({
      'telegram:123': '/sessions/first.jsonl',
    })
    const bridge = makeBridge(registry)

    // Init returns initial file
    mocks.getState.mockReturnValueOnce({
      sessionFile: '/sessions/first.jsonl',
      sessionId: 'first-id',
      model: 'test/test-model',
      isStreaming: false,
      thinkingLevel: 'off',
      messageCount: 0,
    })

    // listSessions returns a session the user can switch to
    mocks.listSessions.mockResolvedValue([
      {
        path: '/sessions/switched-to.jsonl',
        id: 'other-id',
        modified: new Date(),
        messageCount: 5,
        firstMessage: 'hello',
      },
    ])

    // After switch, getState reflects the new session file
    mocks.getState.mockReturnValue({
      sessionFile: '/sessions/switched-to.jsonl',
      sessionId: 'other-id',
      model: 'test/test-model',
      isStreaming: false,
      thinkingLevel: 'off',
      messageCount: 5,
    })

    await (bridge as any).handleIncomingMessage(makeIncomingMessage('/session other-id'))

    const setCalls = (registry.set as ReturnType<typeof vi.fn>).mock.calls
    const lastCall = setCalls.at(-1)
    expect(lastCall?.[0]).toBe('telegram:123')
    expect(lastCall?.[1]).toBe('/sessions/switched-to.jsonl')
  })
})

// ── Registry update after normal prompt ──────────────────────────────────────

describe('ChannelBridge — registry updated after prompt', () => {
  it('saves the session file after processing a regular message', async () => {
    const registry = makeMockRegistry()
    const bridge = makeBridge(registry)

    await (bridge as any).handleIncomingMessage(makeIncomingMessage('tell me a joke'))
    // Allow processQueue microtasks to complete
    await new Promise((r) => setTimeout(r, 0))

    expect(registry.set).toHaveBeenCalled()
    const setCalls = (registry.set as ReturnType<typeof vi.fn>).mock.calls.filter(
      (c) => c[0] === 'telegram:123'
    )
    expect(setCalls.length).toBeGreaterThanOrEqual(1)
    // Most recent call should point at the current session
    expect(setCalls.at(-1)?.[1]).toBe('/sessions/current.jsonl')
  })
})

// ── persistSessionFile helper ────────────────────────────────────────────────

describe('ChannelBridge — persistSessionFile', () => {
  it('writes to the registry when sessionFile is present', () => {
    const registry = makeMockRegistry()
    const bridge = makeBridge(registry)
    const fakeAgent = { getState: () => ({ sessionFile: '/sessions/test.jsonl' }) }

    ;(bridge as any).persistSessionFile('telegram:42', fakeAgent)

    expect(registry.set).toHaveBeenCalledOnce()
    expect(registry.set).toHaveBeenCalledWith('telegram:42', '/sessions/test.jsonl')
  })

  it('does not call registry.set when getState returns null', () => {
    const registry = makeMockRegistry()
    const bridge = makeBridge(registry)
    const fakeAgent = { getState: () => null }

    ;(bridge as any).persistSessionFile('telegram:42', fakeAgent)

    expect(registry.set).not.toHaveBeenCalled()
  })

  it('does not call registry.set when sessionFile is undefined', () => {
    const registry = makeMockRegistry()
    const bridge = makeBridge(registry)
    const fakeAgent = { getState: () => ({ sessionFile: undefined }) }

    ;(bridge as any).persistSessionFile('telegram:42', fakeAgent)

    expect(registry.set).not.toHaveBeenCalled()
  })
})

// ── Session file deleted while manager is cached in memory ────────────────────────

describe('ChannelBridge — session file deleted while manager is cached', () => {
  it('calls newSession() when the cached session file no longer exists on disk', async () => {
    const registry = makeMockRegistry()
    const bridge = makeBridge(registry)

    // First message — initialises and caches the AgentManager
    await (bridge as any).handleIncomingMessage(makeIncomingMessage('hello'))
    await new Promise((r) => setTimeout(r, 0))

    // Simulate: session now has prior messages and its file was deleted
    mocks.getState.mockReturnValue({
      sessionFile: '/sessions/active.jsonl',
      sessionId: 'abc123',
      model: 'test/test-model',
      isStreaming: false,
      thinkingLevel: 'off',
      messageCount: 5, // session was used before
    })
    existsSyncMock.mockReturnValue(false) // session file was deleted

    // After newSession() the agent reports a brand-new session
    mocks.newSession.mockImplementationOnce(async () => {
      mocks.getState.mockReturnValue({
        sessionFile: '/sessions/fresh.jsonl',
        sessionId: 'xyz789',
        model: 'test/test-model',
        isStreaming: false,
        thinkingLevel: 'off',
        messageCount: 0,
      })
    })

    // Second message — manager is cached but file was deleted
    await (bridge as any).handleIncomingMessage(makeIncomingMessage('hello again'))

    expect(mocks.newSession).toHaveBeenCalledOnce()

    // Registry must be updated to the fresh session path
    const setCalls = (registry.set as ReturnType<typeof vi.fn>).mock.calls
    const senderCalls = setCalls.filter((c) => c[0] === 'telegram:123')
    expect(senderCalls.at(-1)?.[1]).toBe('/sessions/fresh.jsonl')
  })

  it('does not call newSession() when the session file still exists on disk', async () => {
    const registry = makeMockRegistry()
    const bridge = makeBridge(registry)

    // First message
    await (bridge as any).handleIncomingMessage(makeIncomingMessage('hello'))
    await new Promise((r) => setTimeout(r, 0))

    // Session has prior messages but the file is intact (normal operation)
    mocks.getState.mockReturnValue({
      sessionFile: '/sessions/active.jsonl',
      sessionId: 'abc123',
      model: 'test/test-model',
      isStreaming: false,
      thinkingLevel: 'off',
      messageCount: 5,
    })
    // existsSyncMock stays true (default — file exists)

    // Second message
    await (bridge as any).handleIncomingMessage(makeIncomingMessage('hello again'))

    expect(mocks.newSession).not.toHaveBeenCalled()
  })

  it('does not call newSession() when session has no messages yet (new session, file not written yet)', async () => {
    const registry = makeMockRegistry()
    const bridge = makeBridge(registry)

    // First message — manager cached with a brand-new session (messageCount: 0, default)
    await (bridge as any).handleIncomingMessage(makeIncomingMessage('hello'))
    await new Promise((r) => setTimeout(r, 0))

    // File doesn't exist yet (normal for a fresh session before first assistant response)
    existsSyncMock.mockReturnValue(false)
    // getState still reports messageCount: 0 (no messages yet, default)

    // Second message
    await (bridge as any).handleIncomingMessage(makeIncomingMessage('hello again'))

    expect(mocks.newSession).not.toHaveBeenCalled()
  })
})
