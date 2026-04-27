// tests/channel-bridge-pagination-edit.test.ts
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { ChannelBridge } from '../src/channel-bridge/bridge'
import type { ChannelAdapter, ChannelMessage } from '../src/channel-bridge/types'
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
    getMessages: vi.fn().mockReturnValue([]),
    newSession: vi.fn().mockResolvedValue(undefined),
    switchSession: vi.fn().mockResolvedValue(undefined),
    abort: vi.fn().mockResolvedValue(undefined),
    getAvailableModels: vi.fn().mockReturnValue([]),
    listSessions: vi.fn().mockResolvedValue([]),
    setModel: vi.fn().mockResolvedValue(undefined),
    deleteSession: vi.fn().mockResolvedValue(undefined),
    getAvailableThinkingLevels: vi.fn().mockReturnValue([]),
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
    getAvailableThinkingLevels = mocks.getAvailableThinkingLevels
  },
}))

function createMockAdapter(): ChannelAdapter & { send: ReturnType<typeof vi.fn>; sentMessages: ChannelMessage[] } {
  const sentMessages: ChannelMessage[] = []
  return {
    direction: 'bidirectional',
    send: vi.fn().mockImplementation(async (msg: ChannelMessage) => {
      sentMessages.push(msg)
    }),
    sentMessages,
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
  mocks.getMessages.mockReturnValue([])
  mocks.newSession.mockResolvedValue(undefined)
  mocks.switchSession.mockResolvedValue(undefined)
  mocks.abort.mockResolvedValue(undefined)
  mocks.getAvailableModels.mockReturnValue([])
  mocks.listSessions.mockResolvedValue([])
  mocks.setModel.mockResolvedValue(undefined)
  mocks.deleteSession.mockResolvedValue(undefined)
  mocks.getAvailableThinkingLevels.mockReturnValue([])
})

describe('Callback query pagination: edit instead of new message', () => {
  it('passes editMessageId to adapter.send when command comes from a callback query', async () => {
    const adapter = createMockAdapter()
    const bridge = createBridge(adapter)

    await (bridge as any).handleIncomingMessage({
      adapter: 'telegram',
      sender: '123',
      text: 'sessions:page:1',
      metadata: {
        messageId: 42,
        isCallback: true,
      },
    })

    expect(adapter.send).toHaveBeenCalledOnce()
    const sentMsg = adapter.sentMessages[0]
    expect(sentMsg.editMessageId).toBe(42)
  })

  it('does NOT set editMessageId when command comes from a plain text message', async () => {
    const adapter = createMockAdapter()
    const bridge = createBridge(adapter)

    await (bridge as any).handleIncomingMessage({
      adapter: 'telegram',
      sender: '123',
      text: '/sessions',
      metadata: {
        messageId: 99,
        isCallback: false,
      },
    })

    expect(adapter.send).toHaveBeenCalledOnce()
    const sentMsg = adapter.sentMessages[0]
    expect(sentMsg.editMessageId).toBeUndefined()
  })

  it('does NOT set editMessageId when metadata is absent', async () => {
    const adapter = createMockAdapter()
    const bridge = createBridge(adapter)

    await (bridge as any).handleIncomingMessage({
      adapter: 'telegram',
      sender: '123',
      text: '/sessions',
    })

    expect(adapter.send).toHaveBeenCalledOnce()
    const sentMsg = adapter.sentMessages[0]
    expect(sentMsg.editMessageId).toBeUndefined()
  })

  it('passes editMessageId for models:page callback', async () => {
    mocks.getAvailableModels.mockReturnValue([{ provider: 'openai', id: 'gpt-4.1' }])
    const adapter = createMockAdapter()
    const bridge = createBridge(adapter)

    await (bridge as any).handleIncomingMessage({
      adapter: 'telegram',
      sender: '123',
      text: 'models:page:0',
      metadata: {
        messageId: 77,
        isCallback: true,
      },
    })

    expect(adapter.send).toHaveBeenCalledOnce()
    const sentMsg = adapter.sentMessages[0]
    expect(sentMsg.editMessageId).toBe(77)
  })
})

import { createTelegramAdapter } from '../src/channel-bridge/telegram'

describe('Telegram adapter: editMessageText vs sendMessage', () => {
  it('calls editMessageText when editMessageId is present', async () => {
    const calls: Array<{ url: string; body: Record<string, unknown> }> = []
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(async (url: string, opts: RequestInit) => {
        const body = JSON.parse(opts.body as string) as Record<string, unknown>
        calls.push({ url, body })
        return { ok: true, status: 200, json: async () => ({ ok: true }), text: async () => '' } as Response
      })
    )

    const adapter = createTelegramAdapter({
      type: 'telegram',
      botToken: 'test-token',
    })

    await adapter.send!({
      adapter: 'telegram',
      recipient: '123',
      text: '📚 Select a session to load',
      editMessageId: 42,
    })

    const editCall = calls.find((c) => c.url.includes('editMessageText'))
    expect(editCall).toBeDefined()
    expect(editCall!.body.chat_id).toBe('123')
    expect(editCall!.body.message_id).toBe(42)

    const sendCall = calls.find((c) => c.url.includes('sendMessage'))
    expect(sendCall).toBeUndefined()
  })

  it('calls sendMessage when editMessageId is absent', async () => {
    const calls: Array<{ url: string; body: Record<string, unknown> }> = []
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(async (url: string, opts: RequestInit) => {
        const body = JSON.parse(opts.body as string) as Record<string, unknown>
        calls.push({ url, body })
        return { ok: true, status: 200, json: async () => ({ ok: true }), text: async () => '' } as Response
      })
    )

    const adapter = createTelegramAdapter({
      type: 'telegram',
      botToken: 'test-token',
    })

    await adapter.send!({
      adapter: 'telegram',
      recipient: '123',
      text: '📚 Select a session to load',
    })

    const sendCall = calls.find((c) => c.url.includes('sendMessage'))
    expect(sendCall).toBeDefined()

    const editCall = calls.find((c) => c.url.includes('editMessageText'))
    expect(editCall).toBeUndefined()
  })

  it('falls back to sendMessage when editMessageText API returns an error', async () => {
    let editAttempted = false
    const calls: Array<{ url: string }> = []
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(async (url: string, opts: RequestInit) => {
        calls.push({ url })
        if (url.includes('editMessageText')) {
          editAttempted = true
          return {
            ok: false,
            status: 400,
            json: async () => ({ ok: false }),
            text: async () => 'Bad Request: message is not modified',
          } as Response
        }
        return { ok: true, status: 200, json: async () => ({ ok: true }), text: async () => '' } as Response
      })
    )

    const adapter = createTelegramAdapter({
      type: 'telegram',
      botToken: 'test-token',
    })

    await adapter.send!({
      adapter: 'telegram',
      recipient: '123',
      text: '📚 Select a session to load',
      editMessageId: 42,
    })

    expect(editAttempted).toBe(true)
    const sendCall = calls.find((c) => c.url.includes('sendMessage'))
    expect(sendCall).toBeDefined()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })
})
