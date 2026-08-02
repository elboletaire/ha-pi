import { randomUUID } from 'crypto'
import type { ModelRuntime } from '@earendil-works/pi-coding-agent'
import type { AuthEvent, AuthPrompt } from '@earendil-works/pi-ai'
import { log } from './options'

/**
 * pi 0.83 moved auth orchestration off `AuthStorage` (now a plain credential
 * store) and onto `ModelRuntime`, which owns login/logout/status for both
 * api-key and OAuth providers behind one `AuthInteraction` callback pair.
 *
 * `AuthStatus` is not re-exported from either package root, so it is derived
 * from the method that produces it rather than deep-imported — the package
 * `exports` map blocks `dist/**` paths anyway.
 */
type AuthStatus = ReturnType<ModelRuntime['getProviderAuthStatus']>

export interface ProviderStatus {
  id: string
  name: string
  isOAuth: boolean
  auth: AuthStatus
}

const API_KEY_PROVIDERS: Array<Pick<ProviderStatus, 'id' | 'name'>> = [
  { id: 'anthropic', name: 'Anthropic' },
  { id: 'openai', name: 'OpenAI' },
  { id: 'google', name: 'Google Gemini' },
]

export type LoginEvent =
  | { type: 'login_device_flow'; provider: string; url: string; code: string }
  | { type: 'login_open_url'; provider: string; url: string }
  | { type: 'login_progress'; provider: string; message: string }
  | { type: 'login_prompt'; provider: string; promptId: string; message: string; placeholder?: string }
  | { type: 'login_complete'; provider: string }
  | { type: 'login_error'; provider: string; message: string }
  | { type: 'auth_status'; providers: ProviderStatus[] }

export class LoginManager {
  private abortController: AbortController | null = null
  private activeProvider: string | null = null
  private pendingPrompts = new Map<string, (value: string) => void>()

  constructor(private readonly runtime: ModelRuntime) {}

  // ---------------------------------------------------------------------------
  // Provider & auth status
  // ---------------------------------------------------------------------------

  getProviders(): ProviderStatus[] {
    const oauthProviders = this.runtime
      .getProviders()
      .filter((provider) => provider.auth.oauth)
      .map((provider) => ({
        id: provider.id,
        name: provider.name,
        isOAuth: true,
        auth: this.runtime.getProviderAuthStatus(provider.id),
      }))

    const apiProviders = API_KEY_PROVIDERS.map((provider) => ({
      ...provider,
      isOAuth: false,
      auth: this.runtime.getProviderAuthStatus(provider.id),
    }))

    return [...oauthProviders, ...apiProviders]
  }

  /**
   * Persists an API key.
   *
   * Deliberately routed through `login()` rather than `setRuntimeApiKey()`:
   * the latter only populates an in-process overlay (`AuthStatus.source` of
   * `"runtime"`), so the key would be silently lost the next time the add-on
   * restarts. `login()` writes through the credential store to auth.json.
   *
   * The standard api-key flow asks exactly one `secret` question. Anything
   * else means a provider with a non-standard flow the web UI has no field
   * for, so we fail loudly instead of answering the wrong prompt with a key.
   */
  async setApiKey(providerId: string, apiKey: string): Promise<void> {
    await this.runtime.login(providerId, 'api_key', {
      prompt: async (prompt: AuthPrompt) => {
        if (prompt.type === 'secret' || prompt.type === 'text') return apiKey
        throw new Error(
          `Provider "${providerId}" requested "${prompt.type}" input during API key setup, ` +
            `which the web UI cannot answer. Configure this provider from the terminal.`
        )
      },
      notify: () => {},
    })
  }

  async clearApiKey(providerId: string): Promise<void> {
    await this.runtime.logout(providerId)
  }

  // ---------------------------------------------------------------------------
  // Login
  // ---------------------------------------------------------------------------

  async startLogin(providerId: string, send: (event: LoginEvent) => void): Promise<void> {
    if (this.activeProvider) {
      this.abortLogin()
    }

    this.abortController = new AbortController()
    this.activeProvider = providerId

    log.info(`Starting OAuth login for provider: ${providerId}`)

    try {
      await this.runtime.login(providerId, 'oauth', {
        signal: this.abortController.signal,

        notify: (event: AuthEvent) => {
          switch (event.type) {
            // Device flows (GitHub Copilot): the user types `userCode` at
            // `verificationUri`. Callback-server flows emit `auth_url` with no
            // instructions — just a browser URL to open.
            case 'device_code':
              send({
                type: 'login_device_flow',
                provider: providerId,
                url: event.verificationUri,
                code: event.userCode,
              })
              break

            case 'auth_url':
              if (event.instructions) {
                send({
                  type: 'login_device_flow',
                  provider: providerId,
                  url: event.url,
                  code: event.instructions,
                })
              } else {
                send({ type: 'login_open_url', provider: providerId, url: event.url })
              }
              break

            case 'info':
            case 'progress':
              send({ type: 'login_progress', provider: providerId, message: event.message })
              break
          }
        },

        prompt: (prompt: AuthPrompt) => {
          return new Promise<string>((resolve) => {
            const promptId = randomUUID()
            this.pendingPrompts.set(promptId, resolve)
            send({
              type: 'login_prompt',
              provider: providerId,
              promptId,
              message: describePrompt(prompt),
              placeholder: 'placeholder' in prompt ? prompt.placeholder : undefined,
            })
          })
        },
      })

      log.info(`OAuth login successful for provider: ${providerId}`)
      send({ type: 'login_complete', provider: providerId })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      if (message.includes('aborted') || message.includes('abort')) {
        log.info(`Login aborted for provider: ${providerId}`)
      } else {
        log.error(`Login failed for provider: ${providerId}`, message)
        send({ type: 'login_error', provider: providerId, message })
      }
    } finally {
      this.activeProvider = null
      this.abortController = null
      this.pendingPrompts.clear()
    }
  }

  abortLogin(): void {
    if (this.abortController) {
      this.abortController.abort()
      this.pendingPrompts.clear()
    }
  }

  respondToPrompt(promptId: string, value: string): void {
    const resolve = this.pendingPrompts.get(promptId)
    if (resolve) {
      this.pendingPrompts.delete(promptId)
      resolve(value)
    }
  }

  // ---------------------------------------------------------------------------
  // Logout
  // ---------------------------------------------------------------------------

  async logout(providerId: string): Promise<void> {
    await this.runtime.logout(providerId)
    log.info(`Logged out from provider: ${providerId}`)
  }
}

/**
 * Flattens an AuthPrompt into the single free-text question the web UI can
 * render. `select` has no dedicated UI control, so its options are listed in
 * the message and the user replies with an option id.
 */
function describePrompt(prompt: AuthPrompt): string {
  if (prompt.type === 'select') {
    const options = prompt.options.map((option) => `  ${option.id} — ${option.label}`).join('\n')
    return `${prompt.message}\n${options}`
  }
  return prompt.message
}
