// tests/channel-bridge-adapter-registry.test.ts
import { describe, it, expect, vi } from 'vitest'
import { ChannelBridge } from '../src/channel-bridge/bridge'
import type { ChannelAdapter } from '../src/channel-bridge/types'

function createMockAdapter(): ChannelAdapter {
  return {
    direction: 'bidirectional',
    send: vi.fn().mockResolvedValue(undefined),
    sendDraft: vi.fn().mockResolvedValue(undefined),
    sendTyping: vi.fn().mockResolvedValue(undefined),
  }
}

function createBridge(): ChannelBridge {
  return new ChannelBridge({
    provider: 'test',
    modelId: 'test-model',
    resourceLoader: {} as any,
    authStorage: {} as any,
    typingIndicators: false,
    streamingDrafts: false,
  })
}

describe('ChannelBridge.registerAdapter', () => {
  it('stores adapters by name so a second adapter does not overwrite the first', () => {
    const bridge = createBridge()
    const adapter1 = createMockAdapter()
    const adapter2 = createMockAdapter()

    bridge.registerAdapter('telegram', adapter1)
    bridge.registerAdapter('slack', adapter2)

    expect((bridge as any).adapters.size).toBe(2)
    expect((bridge as any).adapters.get('telegram')).toBe(adapter1)
    expect((bridge as any).adapters.get('slack')).toBe(adapter2)
  })

  it('two bidirectional adapters with the same direction but different names coexist', () => {
    const bridge = createBridge()
    const first = createMockAdapter()
    const second = { ...createMockAdapter(), direction: 'bidirectional' as const }

    bridge.registerAdapter('first', first)
    bridge.registerAdapter('second', second)

    // Both are stored — first is not overwritten
    expect((bridge as any).adapters.get('first')).toBe(first)
    expect((bridge as any).adapters.get('second')).toBe(second)
  })
})
