import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ChannelBridge } from '../src/channel-bridge/bridge'
import type { ChannelAdapter } from '../src/channel-bridge/types'
import type { SenderSessionRegistry } from '../src/channel-bridge/sender-session-registry'

const { mocks } = vi.hoisted(() => ({
  mocks: {
    init: vi.fn().mockResolvedValue(undefined),
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
    setModel: vi.fn().mockResolvedValue(undefined),
    deleteSession: vi.fn().mockResolvedValue(undefined),
  },
}))

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
    setModel = mocks.setModel
    deleteSession = mocks.deleteSession
  },
}))

function createFailingAdapter(): ChannelAdapter & { send: ReturnType<typeof vi.fn> } {
  return {
    direction: 'bidirectional',
    send: vi.fn().mockRejectedValue(new Error('fetch failed')),
  }
}

function createMockRegistry(): SenderSessionRegistry {
  return {
    get: vi.fn(),
    set: vi.fn(),
    delete: vi.fn(),
    getAll: vi.fn(() => new Map()),
  } as unknown as SenderSessionRegistry
}

function createBridge(adapter: ChannelAdapter): ChannelBridge {
  const bridge = new ChannelBridge({
    provider: 'test',
    modelId: 'test-model',
    resourceLoader: {} as any,
    authStorage: {} as any,
    typingIndicators: false,
    streamingDrafts: false,
    senderSessionRegistry: createMockRegistry(),
  })
  bridge.registerAdapter('test', adapter)
  return bridge
}

function makeIncomingMessage(text: string) {
  return {
    adapter: 'telegram',
    sender: '123',
    text,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
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
  mocks.abort.mockResolvedValue(undefined)
  mocks.getAvailableModels.mockReturnValue([])
  mocks.listSessions.mockResolvedValue([])
  mocks.setModel.mockResolvedValue(undefined)
  mocks.deleteSession.mockResolvedValue(undefined)
})

describe('ChannelBridge send failures', () => {
  it('does not reject when a command reply cannot be sent', async () => {
    const bridge = createBridge(createFailingAdapter())

    await expect((bridge as any).handleIncomingMessage(makeIncomingMessage('/new'))).resolves.toBeUndefined()

    expect(mocks.newSession).toHaveBeenCalledOnce()
  })

  it('does not reject when an assistant reply cannot be sent', async () => {
    const adapter = createFailingAdapter()
    const bridge = createBridge(adapter)
    const senderId = 'telegram:123'

    ;(bridge as any).senderSessions.set(senderId, {
      adapter: 'telegram',
      sender: '123',
      displayName: '123',
      queue: [
        {
          id: 'prompt-1',
          adapter: 'telegram',
          sender: '123',
          text: 'hello',
          enqueuedAt: Date.now(),
        },
      ],
      processing: false,
      abortController: null,
      messageCount: 0,
      startedAt: Date.now(),
    })

    ;(bridge as any).agentManagers.set(senderId, {
      init: mocks.init,
      getState: mocks.getState,
      subscribe: mocks.subscribe,
      prompt: mocks.prompt,
      getMessages: mocks.getMessages,
      newSession: mocks.newSession,
      switchSession: mocks.switchSession,
      abort: mocks.abort,
      getAvailableModels: mocks.getAvailableModels,
      listSessions: mocks.listSessions,
      setModel: mocks.setModel,
      deleteSession: mocks.deleteSession,
    })

    await expect((bridge as any).processQueue(senderId)).resolves.toBeUndefined()

    expect(mocks.prompt).toHaveBeenCalledOnce()
    expect(adapter.send).toHaveBeenCalled()
  })
})
