import { describe, expect, it, vi } from 'vitest'
import {
  getCommandsForTelegram,
  parseCommand,
  processCommand,
  handleNewCommand,
} from '../src/channel-bridge/commands'
import type { AgentManager } from '../src/agent-manager'

describe('telegram command helpers', () => {
  it('parses /start, /help, and bot-username mentions', () => {
    expect(parseCommand('/start')).toEqual({ type: 'start' })
    expect(parseCommand('/start@anything_bot')).toEqual({ type: 'start' })
    expect(parseCommand('/help')).toEqual({ type: 'help' })
    expect(parseCommand('/new@anything_bot')).toEqual({ type: 'new' })
    expect(parseCommand('continue_chat')).toEqual({ type: 'start' })
    expect(parseCommand('list_sessions')).toEqual({ type: 'sessions' })
    expect(parseCommand('list_models')).toEqual({ type: 'model', model: undefined })
    expect(parseCommand('back_to_chat')).toEqual({ type: 'start' })
    expect(parseCommand('session:session-123')).toEqual({ type: 'session', path: 'session-123' })
    expect(parseCommand('/session abc123')).toEqual({ type: 'session', path: 'abc123' })
    expect(parseCommand('/model provider/model-id')).toEqual({ type: 'model', model: 'provider/model-id' })
  })

  it('parses /s<id> shortcut as a session switch', () => {
    expect(parseCommand('/s019dc5e5')).toEqual({ type: 'session', path: '019dc5e5' })
    expect(parseCommand('/s019dc5e5@mybot')).toEqual({ type: 'session', path: '019dc5e5' })
    expect(parseCommand('/sabcdef12')).toEqual({ type: 'session', path: 'abcdef12' })
  })

  it('does NOT parse /s<id> if the hex id is shorter than 6 chars', () => {
    // Too short — should fall through to unknown
    expect(parseCommand('/s0abc')).toBeUndefined()
  })

  it('does NOT confuse /status or /sessions with the /s<id> shortcut', () => {
    expect(parseCommand('/status')).toEqual({ type: 'status' })
    expect(parseCommand('/sessions')).toEqual({ type: 'sessions' })
  })

  it('returns a welcome response for /start and /help', async () => {
    const result = await processCommand({} as AgentManager, '/start')

    expect(result?.text).toContain('Welcome to Pi Agent!')
    expect(result?.text).toContain('/start - This message')
    expect(result?.markup).toBeTruthy()
  })

  it('exposes the expected Telegram command menu', () => {
    const commands = getCommandsForTelegram().map((entry) => entry.command)

    expect(commands).toEqual(['start', 'help', 'new', 'sessions', 'session', 'delete', 'status', 'model', 'abort'])
  })

  it('does NOT expose the /s shortcut in the autocomplete menu', () => {
    const commands = getCommandsForTelegram().map((entry) => entry.command)
    // Exact check: 's' alone is not a registered command
    expect(commands).not.toContain('s')
    // Pattern check: no command looks like 's' followed by 6+ hex chars
    // (note: 'sessions' starts with 'se' but 'e' alone is < 6 hex chars,
    //  so requiring {6,} correctly excludes it)
    expect(commands.some((c) => /^s[0-9a-f]{6,}/i.test(c))).toBe(false)
  })
})

describe('handleNewCommand', () => {
  it('wraps the session ID in backticks and returns no markup', async () => {
    const fakeManager = {
      newSession: vi.fn().mockResolvedValue(undefined),
      getState: vi.fn().mockReturnValue({
        sessionId: '019dc5e5-c123-7456-89ab-cdef01234567',
        model: 'anthropic/claude-sonnet-4-5',
      }),
    } as unknown as AgentManager

    const result = await handleNewCommand(fakeManager)

    expect(result.text).toContain('`019dc5e5`')
    expect(result.markup).toBeUndefined()
  })
})

describe('session list format', () => {
  it('renders /s<id> links and first-message previews', async () => {
    const sessions = [
      {
        id: '019dc5e5-c123-7456-89ab-cdef01234567',
        path: '/sessions/a.jsonl',
        messageCount: 22,
        modified: new Date('2026-04-25T22:32:00Z'),
        firstMessage: 'What does this code do in server.ts and how can I extend it properly for my project?',
        name: undefined,
      },
      {
        id: '019dc5c8-f000-7456-89ab-cdef01234567',
        path: '/sessions/b.jsonl',
        messageCount: 28,
        modified: new Date('2026-04-25T20:22:00Z'),
        firstMessage: 'Fix the login bug in auth module',
        name: undefined,
      },
    ]

    const fakeManager = {
      listSessions: vi.fn().mockResolvedValue(sessions),
    } as unknown as AgentManager

    const result = await processCommand(fakeManager, '/sessions')
    const text = result!.text

    // Session count header
    expect(text).toContain('Sessions (2)')

    // /s<id> links (8-char prefix of each UUID)
    expect(text).toContain('/s019dc5e5')
    expect(text).toContain('/s019dc5c8')

    // First-message previews shown as quoted strings
    expect(text).toContain('"What does this code do in server.ts')
    expect(text).toContain('"Fix the login bug in auth module"')

    // Long message is truncated (original ends with "extend it?" which is past 60 chars)
    expect(text).not.toContain('extend it?')

    // No old table headers
    expect(text).not.toContain('ID\t')
    expect(text).not.toContain('Name')
  })

  it('shows a hint when there are no sessions', async () => {
    const fakeManager = {
      listSessions: vi.fn().mockResolvedValue([]),
    } as unknown as AgentManager

    const result = await processCommand(fakeManager, '/sessions')
    expect(result!.text).toContain('No sessions found.')
    expect(result!.text).toContain('/new')
  })
})

describe('handleSessionCommand', () => {
  it('shows the latest message from the switched session and removes buttons', async () => {
    const fakeManager = {
      listSessions: vi.fn().mockResolvedValue([
        {
          id: '019dc5e5-c123-7456-89ab-cdef01234567',
          path: '/sessions/target.jsonl',
          messageCount: 3,
          modified: new Date('2026-04-25T22:32:00Z'),
          firstMessage: 'Hello there',
          name: undefined,
        },
      ]),
      switchSession: vi.fn().mockResolvedValue(undefined),
      getState: vi.fn().mockReturnValue({
        sessionId: '019dc5e5-c123-7456-89ab-cdef01234567',
        model: 'anthropic/claude-sonnet-4-5-20250929',
        messageCount: 3,
      }),
      getMessages: vi.fn().mockReturnValue([
        { role: 'assistant', content: [{ type: 'text', text: 'Earlier assistant reply' }] },
        { role: 'user', content: [{ type: 'text', text: 'Last message from the user' }] },
      ]),
    } as unknown as AgentManager

    const result = await processCommand(fakeManager, '/session 019dc5e5')

    expect(fakeManager.switchSession).toHaveBeenCalledWith('/sessions/target.jsonl')
    expect(result?.markup).toBeUndefined()
    expect(result?.text).toContain('**ID:** `019dc5e5`')
    expect(result?.text).toContain('**Model:** `anthropic/claude-sonnet-4-5-20250929`')
    expect(result?.text).toContain('**Messages:** 3')
    expect(result?.text).toContain('**Latest message:** `Last message from the user`')
  })
})
