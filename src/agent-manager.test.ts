import { describe, it, expect, vi } from 'vitest'
import { AgentManager } from './agent-manager'

/**
 * Create a manager without calling init() so we can test the logic that
 * runs before any session exists, without needing the pi SDK at all.
 */
function makeManager() {
  return new AgentManager(
    'anthropic',
    'claude-sonnet',
    {} as any, // resourceLoader — not used by the methods under test
    {} as any // authStorage     — not used by the methods under test
  )
}

// ---------------------------------------------------------------------------
// TUI command interception
// ---------------------------------------------------------------------------

describe('AgentManager.prompt — TUI command interception', () => {
  // All commands defined in the source
  const TUI_COMMANDS = [
    '/login',
    '/logout',
    '/model',
    '/settings',
    '/hotkeys',
    '/session',
    '/resume',
    '/new',
    '/compact',
    '/tree',
    '/fork',
    '/clone',
    '/reload',
    '/export',
    '/share',
    '/copy',
    '/quit',
    '/changelog',
  ]

  it.each(TUI_COMMANDS)('rejects "%s" with a terminal-only error', async (cmd) => {
    const manager = makeManager()
    await expect(manager.prompt(cmd)).rejects.toThrow('terminal-only command')
  })

  it('includes the command name in the error message', async () => {
    const manager = makeManager()
    await expect(manager.prompt('/model')).rejects.toThrow('`/model`')
  })

  it('includes a Providers modal hint specifically for /login', async () => {
    const manager = makeManager()
    await expect(manager.prompt('/login')).rejects.toThrow('Providers modal')
  })

  it('does not add the hint to other commands', async () => {
    const manager = makeManager()
    await expect(manager.prompt('/logout')).rejects.toThrow(expect.not.stringContaining('Providers modal'))
  })

  it('intercepts a command that has arguments (/model gpt-4o)', async () => {
    const manager = makeManager()
    await expect(manager.prompt('/model gpt-4o')).rejects.toThrow('`/model`')
  })

  it('trims leading whitespace before checking for slash commands', async () => {
    const manager = makeManager()
    await expect(manager.prompt('  /login')).rejects.toThrow('terminal-only command')
  })

  it("passes non-TUI slash text through to session (throws 'not initialised')", async () => {
    const manager = makeManager()
    await expect(manager.prompt('/not-a-tui-command')).rejects.toThrow('Agent not initialised')
  })

  it("passes regular text through to session (throws 'not initialised')", async () => {
    const manager = makeManager()
    await expect(manager.prompt('hello world')).rejects.toThrow('Agent not initialised')
  })
})

// ---------------------------------------------------------------------------
// getState
// ---------------------------------------------------------------------------

describe('AgentManager.getState', () => {
  it('returns null before init() is called', () => {
    expect(makeManager().getState()).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// abort
// ---------------------------------------------------------------------------

describe('AgentManager.abort', () => {
  it('resolves without throwing when no session is active', async () => {
    await expect(makeManager().abort()).resolves.toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// subscribe
// ---------------------------------------------------------------------------

describe('AgentManager.subscribe', () => {
  it('returns a callable unsubscribe function', () => {
    const unsub = makeManager().subscribe(vi.fn())
    expect(() => unsub()).not.toThrow()
  })

  it('the unsubscribed callback is no longer held (double-unsub is safe)', () => {
    const manager = makeManager()
    const unsub = manager.subscribe(vi.fn())
    unsub()
    expect(() => unsub()).not.toThrow()
  })
})
