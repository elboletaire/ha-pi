// tests/typing-loop.test.ts
import { describe, it, expect, vi, afterEach } from 'vitest'
import { startTypingLoop } from '../src/channel-bridge/typing'
import type { ChannelAdapter } from '../src/channel-bridge/types'

function makeAdapter(): ChannelAdapter & { sendTyping: ReturnType<typeof vi.fn> } {
  return {
    direction: 'bidirectional',
    send: vi.fn().mockResolvedValue(undefined),
    sendTyping: vi.fn().mockResolvedValue(undefined),
  }
}

afterEach(() => {
  vi.useRealTimers()
})

describe('startTypingLoop', () => {
  it('continues beyond 30 iterations (the old hardcoded cap)', async () => {
    vi.useFakeTimers()
    const adapter = makeAdapter()

    startTypingLoop({ adapter, recipient: '123', intervalMs: 1000 })

    // Advance 35 full intervals — the old cap would have stopped at 30
    await vi.advanceTimersByTimeAsync(35_000)

    expect(adapter.sendTyping.mock.calls.length).toBeGreaterThan(30)
  })

  it('stops immediately when the returned cleanup function is called', async () => {
    vi.useFakeTimers()
    const adapter = makeAdapter()

    const stop = startTypingLoop({ adapter, recipient: '123', intervalMs: 1000 })

    // Advance one interval so the first call fires
    await vi.advanceTimersByTimeAsync(1000)
    const countAfterOne = adapter.sendTyping.mock.calls.length
    expect(countAfterOne).toBeGreaterThanOrEqual(1)

    stop()

    // Advance several more intervals — no new calls should happen
    await vi.advanceTimersByTimeAsync(5000)
    expect(adapter.sendTyping.mock.calls.length).toBe(countAfterOne)
  })

  it('fires on the first tick before any interval elapses', async () => {
    vi.useFakeTimers()
    const adapter = makeAdapter()

    startTypingLoop({ adapter, recipient: '123', intervalMs: 60_000 })

    // Flush initial synchronous microtasks — the loop fires immediately
    await vi.advanceTimersByTimeAsync(0)
    expect(adapter.sendTyping.mock.calls.length).toBeGreaterThanOrEqual(1)
  })
})
