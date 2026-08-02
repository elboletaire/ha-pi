import { describe, it, expect, vi } from 'vitest'
import { LoginManager, type LoginEvent } from './login-manager'
import type { ModelRuntime } from '@earendil-works/pi-coding-agent'

/** Minimal ModelRuntime stand-in — LoginManager only touches these four members. */
function makeRuntime(overrides: Record<string, unknown> = {}) {
  return {
    getProviders: vi.fn().mockReturnValue([]),
    getProviderAuthStatus: vi.fn().mockReturnValue({ configured: false }),
    login: vi.fn().mockResolvedValue({ type: 'api_key', key: 'stored' }),
    logout: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  } as unknown as ModelRuntime
}

/** A provider entry as ModelRuntime.getProviders() returns it. */
function provider(id: string, name: string, kind: 'oauth' | 'apiKey') {
  return { id, name, auth: kind === 'oauth' ? { oauth: { name } } : { apiKey: { name } } }
}

// ---------------------------------------------------------------------------
// getProviders
// ---------------------------------------------------------------------------

describe('LoginManager.getProviders', () => {
  it('returns the API key providers even when there are no OAuth providers', () => {
    const manager = new LoginManager(makeRuntime())
    expect(manager.getProviders()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'anthropic', name: 'Anthropic', isOAuth: false }),
        expect.objectContaining({ id: 'openai', name: 'OpenAI', isOAuth: false }),
        expect.objectContaining({ id: 'google', name: 'Google Gemini', isOAuth: false }),
      ])
    )
  })

  it('maps OAuth and API providers fields correctly', () => {
    const runtime = makeRuntime({
      getProviders: vi.fn().mockReturnValue([provider('github', 'GitHub Copilot', 'oauth')]),
      getProviderAuthStatus: vi.fn((providerId: string) => ({
        configured: providerId === 'github',
        label: providerId === 'github' ? 'Authenticated' : undefined,
      })),
    })
    const providers = new LoginManager(runtime).getProviders()

    expect(providers).toHaveLength(4)
    expect(providers).toContainEqual({
      id: 'github',
      name: 'GitHub Copilot',
      isOAuth: true,
      auth: { configured: true, label: 'Authenticated' },
    })
    expect(providers).toContainEqual({
      id: 'anthropic',
      name: 'Anthropic',
      isOAuth: false,
      auth: { configured: false, label: undefined },
    })
  })

  it('does not list api-key-only runtime providers as OAuth', () => {
    const runtime = makeRuntime({
      getProviders: vi.fn().mockReturnValue([provider('mistral', 'Mistral', 'apiKey')]),
    })
    const providers = new LoginManager(runtime).getProviders()
    expect(providers.some((entry) => entry.id === 'mistral')).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// API key helpers
// ---------------------------------------------------------------------------

describe('LoginManager API key helpers', () => {
  it('persists API keys through the api_key login flow', async () => {
    const runtime = makeRuntime()
    await new LoginManager(runtime).setApiKey('anthropic', 'sk-test')

    expect(runtime.login).toHaveBeenCalledWith('anthropic', 'api_key', expect.anything())
  })

  it('answers the login flow secret prompt with the supplied key', async () => {
    let answered: string | undefined
    const runtime = makeRuntime({
      login: vi.fn(async (_id: string, _type: string, interaction: any) => {
        answered = await interaction.prompt({ type: 'secret', message: 'Enter Anthropic API key' })
        return { type: 'api_key', key: answered }
      }),
    })

    await new LoginManager(runtime).setApiKey('anthropic', 'sk-test')
    expect(answered).toBe('sk-test')
  })

  // A provider whose flow asks something other than "paste your key" would
  // otherwise receive the key as the answer to the wrong question.
  it('refuses to answer a non-text prompt during API key setup', async () => {
    const runtime = makeRuntime({
      login: vi.fn(async (_id: string, _type: string, interaction: any) => {
        return interaction.prompt({ type: 'select', message: 'Pick one', options: [{ id: 'a', label: 'A' }] })
      }),
    })

    await expect(new LoginManager(runtime).setApiKey('weird', 'sk-test')).rejects.toThrow(/cannot answer/i)
  })

  it('clears API keys by logging the provider out', async () => {
    const runtime = makeRuntime()
    await new LoginManager(runtime).clearApiKey('openai')
    expect(runtime.logout).toHaveBeenCalledWith('openai')
  })
})

// ---------------------------------------------------------------------------
// startLogin — AuthEvent -> LoginEvent mapping
// ---------------------------------------------------------------------------

/** Runs a login whose flow emits `events`, and collects what reached the client. */
async function collectLoginEvents(events: unknown[]): Promise<LoginEvent[]> {
  const runtime = makeRuntime({
    login: vi.fn(async (_id: string, _type: string, interaction: any) => {
      for (const event of events) interaction.notify(event)
      return { type: 'oauth' }
    }),
  })
  const sent: LoginEvent[] = []
  await new LoginManager(runtime).startLogin('github', (event) => sent.push(event))
  return sent
}

describe('LoginManager.startLogin', () => {
  it('requests an oauth login', async () => {
    const runtime = makeRuntime()
    await new LoginManager(runtime).startLogin('github', () => {})
    expect(runtime.login).toHaveBeenCalledWith('github', 'oauth', expect.anything())
  })

  it('maps a device_code event to a device flow event', async () => {
    const sent = await collectLoginEvents([
      { type: 'device_code', userCode: 'ABCD-1234', verificationUri: 'https://github.com/login/device' },
    ])
    expect(sent).toContainEqual({
      type: 'login_device_flow',
      provider: 'github',
      url: 'https://github.com/login/device',
      code: 'ABCD-1234',
    })
  })

  it('maps an instruction-free auth_url to an open-url event', async () => {
    const sent = await collectLoginEvents([{ type: 'auth_url', url: 'https://example.com/authorize' }])
    expect(sent).toContainEqual({
      type: 'login_open_url',
      provider: 'github',
      url: 'https://example.com/authorize',
    })
  })

  it('maps an auth_url carrying instructions to a device flow event', async () => {
    const sent = await collectLoginEvents([
      { type: 'auth_url', url: 'https://example.com/authorize', instructions: 'WXYZ-9876' },
    ])
    expect(sent).toContainEqual({
      type: 'login_device_flow',
      provider: 'github',
      url: 'https://example.com/authorize',
      code: 'WXYZ-9876',
    })
  })

  it('maps info and progress events to progress events', async () => {
    const sent = await collectLoginEvents([
      { type: 'info', message: 'Opening browser' },
      { type: 'progress', message: 'Waiting for approval' },
    ])
    expect(sent).toContainEqual({ type: 'login_progress', provider: 'github', message: 'Opening browser' })
    expect(sent).toContainEqual({ type: 'login_progress', provider: 'github', message: 'Waiting for approval' })
  })

  it('emits login_complete on success', async () => {
    const sent = await collectLoginEvents([])
    expect(sent).toContainEqual({ type: 'login_complete', provider: 'github' })
  })

  it('emits login_error when the flow fails', async () => {
    const runtime = makeRuntime({ login: vi.fn().mockRejectedValue(new Error('token exchange failed')) })
    const sent: LoginEvent[] = []
    await new LoginManager(runtime).startLogin('github', (event) => sent.push(event))

    expect(sent).toContainEqual({ type: 'login_error', provider: 'github', message: 'token exchange failed' })
  })

  it('stays silent when the flow is aborted', async () => {
    const runtime = makeRuntime({ login: vi.fn().mockRejectedValue(new Error('login aborted')) })
    const sent: LoginEvent[] = []
    await new LoginManager(runtime).startLogin('github', (event) => sent.push(event))

    expect(sent.some((event) => event.type === 'login_error')).toBe(false)
  })

  it('flattens a select prompt into a message listing the option ids', async () => {
    const runtime = makeRuntime({
      login: vi.fn(async (_id: string, _type: string, interaction: any) => {
        return interaction.prompt({
          type: 'select',
          message: 'Choose an account',
          options: [
            { id: 'personal', label: 'Personal' },
            { id: 'work', label: 'Work' },
          ],
        })
      }),
    })

    const sent: LoginEvent[] = []
    const manager = new LoginManager(runtime)
    const login = manager.startLogin('github', (event) => sent.push(event))

    // The flow parks on the prompt until the client answers.
    const prompt = sent.find((event) => event.type === 'login_prompt')
    if (prompt?.type !== 'login_prompt') throw new Error('expected a login_prompt event')

    expect(prompt.message).toContain('Choose an account')
    expect(prompt.message).toContain('personal — Personal')
    expect(prompt.message).toContain('work — Work')

    manager.respondToPrompt(prompt.promptId, 'work')
    await login
  })
})

// ---------------------------------------------------------------------------
// abortLogin
// ---------------------------------------------------------------------------

describe('LoginManager.abortLogin', () => {
  it('does not throw when no login is in progress', () => {
    const manager = new LoginManager(makeRuntime())
    expect(() => manager.abortLogin()).not.toThrow()
  })
})

// ---------------------------------------------------------------------------
// respondToPrompt
// ---------------------------------------------------------------------------

describe('LoginManager.respondToPrompt', () => {
  it('calls the resolve function for a known promptId', () => {
    const manager = new LoginManager(makeRuntime())
    const resolve = vi.fn()
    // Inject directly into the private map
    ;(manager as any).pendingPrompts.set('p-1', resolve)

    manager.respondToPrompt('p-1', 'secret-code')

    expect(resolve).toHaveBeenCalledOnce()
    expect(resolve).toHaveBeenCalledWith('secret-code')
  })

  it('removes the entry from the map after resolving', () => {
    const manager = new LoginManager(makeRuntime())
    ;(manager as any).pendingPrompts.set('p-2', vi.fn())

    manager.respondToPrompt('p-2', 'value')

    expect((manager as any).pendingPrompts.has('p-2')).toBe(false)
  })

  it('does not throw for an unknown promptId', () => {
    const manager = new LoginManager(makeRuntime())
    expect(() => manager.respondToPrompt('unknown', 'value')).not.toThrow()
  })
})

// ---------------------------------------------------------------------------
// logout
// ---------------------------------------------------------------------------

describe('LoginManager.logout', () => {
  it('delegates to the runtime', async () => {
    const runtime = makeRuntime()
    await new LoginManager(runtime).logout('github')
    expect(runtime.logout).toHaveBeenCalledWith('github')
  })
})
