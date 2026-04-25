import { readFileSync } from 'fs'
import { describe, expect, it } from 'vitest'

const translations = readFileSync(new URL('../translations/en.yaml', import.meta.url), 'utf8')

describe('translation files', () => {
  it('exposes a friendly label and helper text for agents_md_append', () => {
    expect(translations).toContain('agents_md_append:')
    expect(translations).toContain('name: Additional agent instructions')
    expect(translations).toContain('Optional free-form text appended to the built-in base instructions')
    expect(translations).toContain('It is combined with /data/pi-agent/AGENTS.md.')
    expect(translations).not.toContain('multiline textarea')
  })
})
