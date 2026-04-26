// tests/message-format.test.ts
import { describe, it, expect } from 'vitest'
import { markdownToTelegramHTML, formatSourceHeader } from '../src/channel-bridge/message-format'

// ── markdownToTelegramHTML ───────────────────────────────────────────────────

describe('markdownToTelegramHTML — bold', () => {
  it('converts **text** to <b>text</b>', () => {
    expect(markdownToTelegramHTML('**hello**')).toBe('<b>hello</b>')
  })

  it('does NOT bold __text__ — double underscores in paths must be preserved', () => {
    const input = 'See `homeassistant/components/light/__init__.py` for the schema.'
    const output = markdownToTelegramHTML(input)
    // __init__ must not become <b>init</b>
    expect(output).toContain('__init__')
    expect(output).not.toContain('<b>init</b>')
  })

  it('does NOT bold segments in a URL containing double underscores', () => {
    const input = 'Open https://example.com/__path__/file to continue.'
    const output = markdownToTelegramHTML(input)
    expect(output).toContain('__path__')
    expect(output).not.toContain('<b>path</b>')
  })

  it('does NOT bold Python dunder method names outside code fences', () => {
    const input = 'Call __init__ or __repr__ directly.'
    const output = markdownToTelegramHTML(input)
    expect(output).toContain('__init__')
    expect(output).toContain('__repr__')
    expect(output).not.toContain('<b>init</b>')
    expect(output).not.toContain('<b>repr</b>')
  })
})

describe('markdownToTelegramHTML — code blocks are not bolded', () => {
  it('leaves __dunder__ inside backtick code spans untouched', () => {
    const input = 'Use `__init__` to initialize.'
    const output = markdownToTelegramHTML(input)
    expect(output).toContain('<code>__init__</code>')
    expect(output).not.toContain('<b>init</b>')
  })

  it('leaves __dunder__ inside triple-backtick fences untouched', () => {
    const input = '```\ndef __init__(self):\n    pass\n```'
    const output = markdownToTelegramHTML(input)
    expect(output).toContain('__init__')
    expect(output).not.toContain('<b>init</b>')
  })
})

describe('markdownToTelegramHTML — italic', () => {
  it('converts *text* to <i>text</i>', () => {
    expect(markdownToTelegramHTML('Hello *world*!')).toContain('<i>world</i>')
  })
})

describe('markdownToTelegramHTML — links', () => {
  it('converts [text](url) to <a href>', () => {
    const out = markdownToTelegramHTML('[Click here](https://example.com)')
    expect(out).toContain('<a href="https://example.com">Click here</a>')
  })
})

// ── formatSourceHeader ───────────────────────────────────────────────────────

describe('formatSourceHeader', () => {
  it('formats an agent source into the Pi header', () => {
    expect(formatSourceHeader('🤖 anthropic/claude-opus-4')).toBe('🧠 Pi · claude-opus-4\n───\n')
  })

  it('formats a cron source', () => {
    expect(formatSourceHeader('cron:daily')).toBe('⏰ cron:daily\n───\n')
  })

  it('formats a channel test source', () => {
    expect(formatSourceHeader('channel:test')).toBe('🏓 test\n───\n')
  })

  it('falls back gracefully for unknown sources', () => {
    expect(formatSourceHeader('custom')).toBe('📨 custom\n───\n')
  })
})
