import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { parseSemver, isRtkTooOld, rewriteCommand, rtkExtension } from './rtk-extension'

// ---------------------------------------------------------------------------
// Test doubles
// ---------------------------------------------------------------------------

type ExecResult = { stdout: string; stderr: string; code: number; killed: boolean }

const ok = (stdout: string): ExecResult => ({ stdout, stderr: '', code: 0, killed: false })
const exit = (code: number, stdout = ''): ExecResult => ({ stdout, stderr: '', code, killed: false })
const timedOut = (): ExecResult => ({ stdout: '', stderr: '', code: 143, killed: true })

/**
 * Minimal ExtensionAPI stand-in. `exec` is scripted per (command, args[0]) so a
 * single fake serves both the version probe and the rewrite calls.
 */
function fakePi(script: { version?: ExecResult | (() => never); rewrite?: ExecResult | (() => never) }): {
  pi: any
  handler: () => any
  execCalls: string[][]
} {
  const execCalls: string[][] = []
  let registered: any = null

  const pi = {
    exec: vi.fn(async (cmd: string, args: string[]) => {
      execCalls.push([cmd, ...args])
      const entry = args[0] === '--version' ? script.version : script.rewrite
      if (typeof entry === 'function') entry()
      if (!entry) throw new Error(`unscripted exec: ${cmd} ${args.join(' ')}`)
      return entry
    }),
    on: vi.fn((event: string, fn: any) => {
      if (event === 'tool_call') registered = fn
    }),
  }

  return { pi, handler: () => registered, execCalls }
}

const bashEvent = (command: string) => ({
  type: 'tool_call' as const,
  toolCallId: 'call-1',
  toolName: 'bash' as const,
  input: { command },
})

const ctx = { signal: undefined } as any

beforeEach(() => {
  delete process.env.RTK_DISABLED
})

afterEach(() => {
  vi.restoreAllMocks()
  delete process.env.RTK_DISABLED
})

// ---------------------------------------------------------------------------
// parseSemver
// ---------------------------------------------------------------------------

describe('parseSemver', () => {
  it('extracts a bare version triple', () => {
    expect(parseSemver('0.44.2')).toEqual([0, 44, 2])
  })

  it('extracts a version embedded in surrounding output', () => {
    expect(parseSemver('rtk 0.23.1\n')).toEqual([0, 23, 1])
  })

  it('returns null when there is no version to find', () => {
    expect(parseSemver('command not found')).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// isRtkTooOld
// ---------------------------------------------------------------------------

describe('isRtkTooOld', () => {
  it('rejects versions below 0.23.0, where `rtk rewrite` did not yet exist', () => {
    expect(isRtkTooOld('rtk 0.22.9')).toBe(true)
  })

  it('accepts exactly 0.23.0', () => {
    expect(isRtkTooOld('rtk 0.23.0')).toBe(false)
  })

  it('accepts the current release line', () => {
    expect(isRtkTooOld('rtk 0.44.2')).toBe(false)
  })

  it('accepts a future 1.x, which the 0.x minor check must not misjudge', () => {
    expect(isRtkTooOld('rtk 1.0.0')).toBe(false)
  })

  it('accepts unparseable output rather than assuming it is ancient', () => {
    expect(isRtkTooOld('some unexpected format')).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// rewriteCommand — exit code contract
// ---------------------------------------------------------------------------

describe('rewriteCommand', () => {
  it('returns the rewrite on exit 0', async () => {
    const exec = vi.fn(async () => ok('rtk git status\n'))
    await expect(rewriteCommand(exec as any, 'git status')).resolves.toBe('rtk git status')
  })

  it('returns the rewrite on exit 3 (advisory), same as exit 0', async () => {
    const exec = vi.fn(async () => exit(3, 'rtk ls\n'))
    await expect(rewriteCommand(exec as any, 'ls')).resolves.toBe('rtk ls')
  })

  it('returns null on exit 1, meaning no rtk equivalent exists', async () => {
    const exec = vi.fn(async () => exit(1))
    await expect(rewriteCommand(exec as any, 'sudo reboot')).resolves.toBeNull()
  })

  it('returns null when the call was killed by the timeout', async () => {
    const exec = vi.fn(async () => timedOut())
    await expect(rewriteCommand(exec as any, 'git status')).resolves.toBeNull()
  })

  it('returns null when exit 0 carries empty stdout', async () => {
    const exec = vi.fn(async () => ok('   \n'))
    await expect(rewriteCommand(exec as any, 'git status')).resolves.toBeNull()
  })

  it('passes an abort signal through to exec', async () => {
    const exec = vi.fn(async () => ok('rtk ls'))
    const signal = new AbortController().signal
    await rewriteCommand(exec as any, 'ls', signal)
    expect(exec).toHaveBeenCalledWith('rtk', ['rewrite', 'ls'], expect.objectContaining({ signal }))
  })
})

// ---------------------------------------------------------------------------
// rtkExtension — registration guards
// ---------------------------------------------------------------------------

describe('rtkExtension registration', () => {
  it('registers no handler when rtk is absent from PATH', async () => {
    const { pi } = fakePi({ version: exit(127) })
    await rtkExtension(pi)
    expect(pi.on).not.toHaveBeenCalled()
  })

  it('registers no handler when the version probe throws', async () => {
    const { pi } = fakePi({
      version: () => {
        throw new Error('ENOENT')
      },
    })
    await rtkExtension(pi)
    expect(pi.on).not.toHaveBeenCalled()
  })

  it('registers no handler when rtk predates 0.23.0', async () => {
    const { pi } = fakePi({ version: ok('rtk 0.22.0') })
    await rtkExtension(pi)
    expect(pi.on).not.toHaveBeenCalled()
  })

  it('registers no handler and never probes when RTK_DISABLED=1', async () => {
    process.env.RTK_DISABLED = '1'
    const { pi } = fakePi({ version: ok('rtk 0.44.2') })
    await rtkExtension(pi)
    expect(pi.on).not.toHaveBeenCalled()
    expect(pi.exec).not.toHaveBeenCalled()
  })

  it('registers a tool_call handler on a supported rtk', async () => {
    const { pi } = fakePi({ version: ok('rtk 0.44.2') })
    await rtkExtension(pi)
    expect(pi.on).toHaveBeenCalledWith('tool_call', expect.any(Function))
  })
})

// ---------------------------------------------------------------------------
// rtkExtension — rewrite behaviour
// ---------------------------------------------------------------------------

describe('rtkExtension rewriting', () => {
  async function armed(rewrite: ExecResult | (() => never)) {
    const fake = fakePi({ version: ok('rtk 0.44.2'), rewrite })
    await rtkExtension(fake.pi)
    return fake
  }

  it('mutates the command in place when rtk offers a rewrite', async () => {
    const { handler } = await armed(ok('rtk git status'))
    const event = bashEvent('git status')
    await handler()(event, ctx)
    expect(event.input.command).toBe('rtk git status')
  })

  it('leaves the command untouched when rtk has no equivalent', async () => {
    const { handler } = await armed(exit(1))
    const event = bashEvent('sudo reboot')
    await handler()(event, ctx)
    expect(event.input.command).toBe('sudo reboot')
  })

  it('ignores non-bash tool calls', async () => {
    const { handler, execCalls } = await armed(ok('rtk something'))
    const event = { type: 'tool_call', toolCallId: 'c', toolName: 'read', input: { file: 'a.ts' } } as any
    await handler()(event, ctx)
    expect(execCalls.filter((c) => c[1] === 'rewrite')).toHaveLength(0)
    expect(event.input).toEqual({ file: 'a.ts' })
  })

  it('skips commands that already invoke rtk', async () => {
    const { handler, execCalls } = await armed(ok('rtk rtk gain'))
    const event = bashEvent('rtk gain')
    await handler()(event, ctx)
    expect(execCalls.filter((c) => c[1] === 'rewrite')).toHaveLength(0)
    expect(event.input.command).toBe('rtk gain')
  })

  it('skips blank commands', async () => {
    const { handler, execCalls } = await armed(ok('irrelevant'))
    const event = bashEvent('   ')
    await handler()(event, ctx)
    expect(execCalls.filter((c) => c[1] === 'rewrite')).toHaveLength(0)
  })

  it('fails open, preserving the command, when the rewrite call throws', async () => {
    const { handler } = await armed(() => {
      throw new Error('rtk crashed')
    })
    const event = bashEvent('git status')
    await expect(handler()(event, ctx)).resolves.toBeUndefined()
    expect(event.input.command).toBe('git status')
  })

  it('never blocks a tool call', async () => {
    const { handler } = await armed(exit(1))
    const event = bashEvent('rm -rf /tmp/x')
    // Permission gating is out of scope; the handler must not return { block: true }.
    await expect(handler()(event, ctx)).resolves.toBeUndefined()
    expect(event.input.command).toBe('rm -rf /tmp/x')
  })
})
