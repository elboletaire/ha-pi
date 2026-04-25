import { readFileSync } from 'fs'
import { describe, expect, it } from 'vitest'

const configYaml = readFileSync(new URL('../config.yaml', import.meta.url), 'utf8')

describe('add-on config', () => {
  it('mounts /data and /config read/write', () => {
    expect(configYaml).toContain('- data:rw')
    expect(configYaml).toContain('- config:rw')
  })

  it('exposes log_level, agents_md_append, and telegram configuration in the add-on UI', () => {
    expect(configYaml).toContain("log_level: 'info'")
    expect(configYaml).toContain("agents_md_append: ''")
    expect(configYaml).toContain('telegram_enabled: false')
    expect(configYaml).toContain("telegram_bot_token: ''")
    expect(configYaml).toContain("telegram_allowed_chat_ids: ''")
    expect(configYaml).not.toContain('anthropic_api_key')
    expect(configYaml).not.toContain('openai_api_key')
    expect(configYaml).not.toContain('google_api_key')
    expect(configYaml).not.toContain('provider: "anthropic"')
    expect(configYaml).not.toContain('model: "claude-sonnet-4-5-20250929"')
  })
})
