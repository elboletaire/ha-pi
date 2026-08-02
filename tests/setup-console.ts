/**
 * Silences the add-on's own logger during tests.
 *
 * `log` in src/options.ts defaults to the `info` threshold and writes straight
 * to console, so every test that exercises a logging code path prints to the
 * terminal. Those lines are the code behaving correctly — RTK's fail-open
 * warning, ChannelBridge lifecycle info, a deliberately corrupt registry file —
 * so they are noise around a passing run, not diagnostics.
 *
 * Only calls carrying the logger's own `[pi-agent]` prefix are dropped. Anything
 * else a test writes to console still comes through, so an unexpected message
 * remains visible instead of being buried by a blanket stub.
 *
 * Set VITEST_LOG=1 to see the logger output anyway when debugging a failure.
 */
const PREFIX = '[pi-agent]'

if (!process.env.VITEST_LOG) {
  for (const level of ['debug', 'info', 'warn', 'error'] as const) {
    // Reassigned rather than vi.spyOn'd: a spy would be undone by the
    // vi.restoreAllMocks() that several suites call in afterEach.
    const original = console[level]
    console[level] = (...args: unknown[]) => {
      if (args[0] === PREFIX) return
      original(...args)
    }
  }
}
