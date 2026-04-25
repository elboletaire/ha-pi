import { readFileSync } from 'fs'
import { describe, expect, it } from 'vitest'

const translations = readFileSync(new URL('../translations/en.yaml', import.meta.url), 'utf8')

describe('translation files', () => {
  it('exposes friendly labels and helper text for all configuration options', () => {
    // Verify all 5 configuration options have translations
    expect(translations).toContain('log_level:')
    expect(translations).toContain('agents_md_append:')
    expect(translations).toContain('telegram_enabled:')
    expect(translations).toContain('telegram_bot_token:')
    expect(translations).toContain('telegram_allowed_chat_ids:')

    // Verify each option has both name and description fields
    expect(translations).toContain('name: Logging level')
    expect(translations).toContain('name: Additional agent instructions')
    expect(translations).toContain('name: Enable Telegram')
    expect(translations).toContain('name: Telegram bot token')
    expect(translations).toContain('name: Allowed Telegram chat IDs')

    // Verify descriptions exist for all options
    expect(translations).toContain('Controls the verbosity of logs')
    expect(translations).toContain('Optional free-form text appended to the built-in base instructions')
    expect(translations).toContain('When enabled, the agent can send and receive messages via Telegram bot')
    expect(translations).toContain('The API token obtained from @BotFather')
    expect(translations).toContain('Comma-separated list of Telegram chat IDs')

    // Ensure no multiline textarea placeholder text
    expect(translations).not.toContain('multiline textarea')
  })
})
