import { randomUUID } from 'crypto'
import { AuthStorage, type AuthStatus } from '@mariozechner/pi-coding-agent'
import type { OAuthProviderInterface } from '@mariozechner/pi-ai'
import { log } from './options'

export interface ProviderStatus {
  id: string
  name: string
  isOAuth: boolean
  usesCallbackServer: boolean
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

  constructor(private readonly authStorage: AuthStorage) {}

  // ---------------------------------------------------------------------------
  // Provider & auth status
  // ---------------------------------------------------------------------------

  getProviders(): ProviderStatus[] {
    const oauthProviders = this.authStorage.getOAuthProviders().map((p: OAuthProviderInterface) => ({
      id: p.id,
      name: p.name,
      isOAuth: true,
      usesCallbackServer: p.usesCallbackServer ?? false,
      auth: this.authStorage.getAuthStatus(p.id),
    }))

    const apiProviders = API_KEY_PROVIDERS.map((provider) => ({
      ...provider,
      isOAuth: false,
      usesCallbackServer: false,
      auth: this.authStorage.getAuthStatus(provider.id),
    }))

    return [...oauthProviders, ...apiProviders]
  }

  setApiKey(providerId: string, apiKey: string): void {
    this.authStorage.set(providerId, { type: 'api_key', key: apiKey })
  }

  clearApiKey(providerId: string): void {
    this.authStorage.remove(providerId)
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
      await this.authStorage.login(providerId, {
        signal: this.abortController.signal,

        onAuth: (info) => {
          // GitHub Copilot: info.instructions contains the user code
          // Callback-server providers: info.url is the browser URL, no code
          if (info.instructions) {
            send({
              type: 'login_device_flow',
              provider: providerId,
              url: info.url,
              code: info.instructions,
            })
          } else {
            send({
              type: 'login_open_url',
              provider: providerId,
              url: info.url,
            })
          }
        },

        onProgress: (message) => {
          send({ type: 'login_progress', provider: providerId, message })
        },

        onPrompt: (prompt) => {
          return new Promise<string>((resolve) => {
            const promptId = randomUUID()
            this.pendingPrompts.set(promptId, resolve)
            send({
              type: 'login_prompt',
              provider: providerId,
              promptId,
              message: prompt.message,
              placeholder: prompt.placeholder,
            })
          })
        },

        onManualCodeInput: () => {
          return new Promise<string>((resolve) => {
            const promptId = randomUUID()
            this.pendingPrompts.set(promptId, resolve)
            send({
              type: 'login_prompt',
              provider: providerId,
              promptId,
              message: 'Paste the authorization code from the browser redirect URL',
              placeholder: 'code=...',
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

  logout(providerId: string): void {
    this.authStorage.logout(providerId)
    log.info(`Logged out from provider: ${providerId}`)
  }
}
