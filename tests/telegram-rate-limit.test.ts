// tests/telegram-rate-limit.test.ts
import { describe, it, expect, vi, afterEach } from 'vitest'
import { createTelegramAdapter } from '../src/channel-bridge/telegram'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  vi.useRealTimers()
})

function okResponse(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
  } as unknown as Response
}

function errorResponse(status: number, body: unknown): Response {
  return {
    ok: false,
    status,
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
  } as unknown as Response
}

// Flush pending microtasks to let async chains complete up to the next setTimeout call.
// Each await flushes one microtask tick; 10 is more than enough for:
//   fetch() resolves → if(!res.ok) → res.json() resolves → sleep() called → setTimeout registered
async function flushMicrotasks(n = 10) {
  for (let i = 0; i < n; i++) await Promise.resolve()
}

describe('Telegram polling — 429 rate-limit handling', () => {
  it('sleeps for (retry_after + 1) * 1000 ms on a 429 response', async () => {
    // Use fake timers so sleep() schedules a setTimeout but it never fires,
    // preventing the poll loop from looping infinitely during the test.
    vi.useFakeTimers()

    vi.stubGlobal('fetch', vi.fn().mockImplementation(async (url: string) => {
      // syncCommands() fires first on start() — let it succeed silently
      if (url.includes('setMyCommands')) return okResponse({ ok: true, result: true })
      // Every getUpdates call returns 429 with retry_after: 7
      return errorResponse(429, {
        ok: false,
        error_code: 429,
        description: 'Too Many Requests: retry after 7',
        parameters: { retry_after: 7 },
      })
    }))

    const timeoutSpy = vi.spyOn(globalThis, 'setTimeout')

    const adapter = createTelegramAdapter({
      type: 'telegram',
      botToken: 'test-token',
      polling: true,
      pollingTimeout: 1,
    })

    // start() awaits syncCommands() then fires poll() without await
    await adapter.start!(vi.fn())

    // Flush microtasks so the fetch → res.json() → sleep() chain runs.
    // sleep() will call setTimeout(resolve, 8000) — recorded by spy but not fired
    // because fake timers are in use.
    await flushMicrotasks()

    const sleepMs = timeoutSpy.mock.calls.map((c) => c[1] as number)
    expect(sleepMs).toContain(8_000) // (7 + 1) * 1000

    await adapter.stop!()
  })

  it('falls back to 5000 ms sleep for other non-OK statuses', async () => {
    vi.useFakeTimers()

    vi.stubGlobal('fetch', vi.fn().mockImplementation(async (url: string) => {
      if (url.includes('setMyCommands')) return okResponse({ ok: true, result: true })
      return errorResponse(503, { ok: false, error_code: 503, description: 'Service Unavailable' })
    }))

    const timeoutSpy = vi.spyOn(globalThis, 'setTimeout')

    const adapter = createTelegramAdapter({
      type: 'telegram',
      botToken: 'test-token',
      polling: true,
      pollingTimeout: 1,
    })

    await adapter.start!(vi.fn())
    await flushMicrotasks()

    const sleepMs = timeoutSpy.mock.calls.map((c) => c[1] as number)
    expect(sleepMs).toContain(5_000)

    await adapter.stop!()
  })

  it('falls back to 5000 ms when 429 body has no retry_after', async () => {
    vi.useFakeTimers()

    vi.stubGlobal('fetch', vi.fn().mockImplementation(async (url: string) => {
      if (url.includes('setMyCommands')) return okResponse({ ok: true, result: true })
      // 429 but body has no parameters.retry_after
      return errorResponse(429, { ok: false, error_code: 429, description: 'Too Many Requests' })
    }))

    const timeoutSpy = vi.spyOn(globalThis, 'setTimeout')

    const adapter = createTelegramAdapter({
      type: 'telegram',
      botToken: 'test-token',
      polling: true,
      pollingTimeout: 1,
    })

    await adapter.start!(vi.fn())
    await flushMicrotasks()

    const sleepMs = timeoutSpy.mock.calls.map((c) => c[1] as number)
    expect(sleepMs).toContain(5_000)
    expect(sleepMs).not.toContain(1_000) // not some bogus small value

    await adapter.stop!()
  })
})
