import { describe, expect, it, vi } from 'vitest'
import { getCommandsForTelegram, parseCommand, processCommand } from '../src/channel-bridge/commands'
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
  })

  it('parses session callback data (no longer uses /s<id> shortcut)', () => {
    // Session selection via button callbacks
    expect(parseCommand('sessions:select:019dc5e5')).toEqual({ type: 'session_select', id: '019dc5e5' })
    expect(parseCommand('sessions:load:019dc5e5')).toEqual({ type: 'session_load', id: '019dc5e5' })
    expect(parseCommand('sessions:page:2')).toEqual({ type: 'sessions', page: 2 })
    expect(parseCommand('sessions:noop')).toEqual({ type: 'noop' })
  })

  it('does NOT parse old session callback prefix (session:) or /s<id> shortcut', () => {
    // These were removed in the button-based refactor
    expect(parseCommand('session:session-123')).toBeUndefined()
    expect(parseCommand('/session abc123')).toBeUndefined()
    expect(parseCommand('/s019dc5e5')).toBeUndefined()
  })

  it('does NOT confuse /status or /sessions with the old /s<id> shortcut', () => {
    expect(parseCommand('/status')).toEqual({ type: 'status' })
    expect(parseCommand('/sessions')).toEqual({ type: 'sessions' })
  })

  it('returns a welcome response for /start and /help', async () => {
    const result = await processCommand({} as AgentManager, '/start')

    expect(result?.text).toContain('Welcome to Pi Agent!')
    expect(result?.text).toContain('/start - This message')
    expect(result?.markup).toBeTruthy()
  })

  it('exposes the expected Telegram command menu (no /session)', () => {
    const commands = getCommandsForTelegram().map((entry) => entry.command)

    expect(commands).toEqual(['start', 'help', 'new', 'sessions', 'delete', 'status', 'model', 'abort'])
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

    const result = await processCommand(fakeManager, '/new')

    expect(result?.text).toContain('**ID:** `019dc5e5`')
    expect(result?.text).toContain('**Model:** `anthropic/claude-sonnet-4-5`')
    expect(result?.markup).toBeUndefined()
  })
})

describe('session list with pagination', () => {
  it('renders paginated buttons with session previews (first page)', async () => {
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
    expect(result?.text).toBe('📚 Select a session to load')
    expect(result?.markup?.inline_keyboard).toBeDefined()

    const buttons = result?.markup?.inline_keyboard as any[]

    // Two session buttons (one per row)
    expect(buttons.length).toBe(2)

    // Session button labels are truncated to 40 chars
    expect(buttons[0][0].text).toBe('What does this code do in server.ts and …')
    expect(buttons[1][0].text).toBe('Fix the login bug in auth module')

    // Callback data encodes short ID and select action
    expect(buttons[0][0].callback_data).toBe('sessions:select:019dc5e5')
    expect(buttons[1][0].callback_data).toBe('sessions:select:019dc5c8')

    // No navigation row (only 2 sessions, fits on one page)
    expect(buttons.length).toBe(2)
  })

  it('renders navigation buttons when there are more than 5 sessions', async () => {
    const sessions = Array.from({ length: 7 }, (_, i) => ({
      id: `session-${i.toString().padStart(8, '0')}-c123-7456-89ab-cdef01234567`,
      path: `/sessions/s${i}.jsonl`,
      messageCount: 10,
      modified: new Date('2026-04-25T22:32:00Z'),
      firstMessage: `Session ${i} preview text`,
      name: undefined,
    }))

    const fakeManager = {
      listSessions: vi.fn().mockResolvedValue(sessions),
    } as unknown as AgentManager

    const result = await processCommand(fakeManager, '/sessions')
    expect(result?.text).toBe('📚 Select a session to load')
    expect(result?.markup?.inline_keyboard).toBeDefined()

    const buttons = result?.markup?.inline_keyboard as any[]

    // 5 session buttons + 1 navigation row = 6 total
    expect(buttons.length).toBe(6)

    // Last row is navigation with page indicator and → (no ← on first page)
    const navRow = buttons[5]
    expect(navRow).toHaveLength(2) // no left arrow on first page
    expect(navRow[0].text).toBe('1/2')
    expect(navRow[0].callback_data).toBe('sessions:noop')
    expect(navRow[1].text).toBe('→')
    expect(navRow[1].callback_data).toBe('sessions:page:1')
  })

  it('shows no ← button on second page', async () => {
    const sessions = Array.from({ length: 7 }, (_, i) => ({
      id: `session-${i.toString().padStart(8, '0')}-c123-7456-89ab-cdef01234567`,
      path: `/sessions/s${i}.jsonl`,
      messageCount: 10,
      modified: new Date('2026-04-25T22:32:00Z'),
      firstMessage: `Session ${i} preview text`,
      name: undefined,
    }))

    const fakeManager = {
      listSessions: vi.fn().mockResolvedValue(sessions),
    } as unknown as AgentManager

    // Request second page (page 1)
    const result = await processCommand(fakeManager, 'sessions:page:1')
    expect(result?.markup?.inline_keyboard).toBeDefined()

    const buttons = result?.markup?.inline_keyboard as any[]
    const navRow = buttons[buttons.length - 1]

    // Should have ← but not → (last page)
    expect(navRow).toHaveLength(2) // no right arrow on last page
    expect(navRow[0].text).toBe('←')
    expect(navRow[0].callback_data).toBe('sessions:page:0')
    expect(navRow[1].text).toBe('2/2')
    expect(navRow[1].callback_data).toBe('sessions:noop')
  })

  it('shows a hint with button when there are no sessions', async () => {
    const fakeManager = {
      listSessions: vi.fn().mockResolvedValue([]),
    } as unknown as AgentManager

    const result = await processCommand(fakeManager, '/sessions')
    expect(result?.text).toBe('No sessions found.')
    expect(result?.markup?.inline_keyboard).toBeDefined()

    const buttons = result?.markup?.inline_keyboard as any[]
    expect(buttons.length).toBe(1)
    expect(buttons[0][0].text).toBe('🆕 New session')
    expect(buttons[0][0].callback_data).toBe('/new')
  })

  it('handles page navigation correctly', async () => {
    const sessions = Array.from({ length: 7 }, (_, i) => ({
      id: `session-${i.toString().padStart(8, '0')}-c123-7456-89ab-cdef01234567`,
      path: `/sessions/s${i}.jsonl`,
      messageCount: 10,
      modified: new Date('2026-04-25T22:32:00Z'),
      firstMessage: `Session ${i} preview text`,
      name: undefined,
    }))

    const fakeManager = {
      listSessions: vi.fn().mockResolvedValue(sessions),
    } as unknown as AgentManager

    // Request second page
    const result = await processCommand(fakeManager, 'sessions:page:1')
    expect(result?.markup?.inline_keyboard).toBeDefined()

    const buttons = result?.markup?.inline_keyboard as any[]

    // Should show sessions 5 and 6 (second page)
    expect(buttons[0][0].text).toBe('Session 5 preview text')
    expect(buttons[1][0].text).toBe('Session 6 preview text')

    const navRow = buttons[buttons.length - 1]
    // Should have ← but no → (last page)
    expect(navRow).toHaveLength(2)
    expect(navRow[0].text).toBe('←')
    expect(navRow[0].callback_data).toBe('sessions:page:0')
    expect(navRow[1].text).toBe('2/2')
    expect(navRow[1].callback_data).toBe('sessions:noop')
  })
})

describe('session select and load flow', () => {
  it('shows session details with Load/Back buttons', async () => {
    const sessions = [
      {
        id: '019dc5e5-c123-7456-89ab-cdef01234567',
        path: '/sessions/target.jsonl',
        messageCount: 3,
        modified: new Date('2026-04-25T22:32:00Z'),
        firstMessage: 'Hello there',
        name: undefined,
      },
    ]

    const fakeManager = {
      listSessions: vi.fn().mockResolvedValue(sessions),
      getState: vi.fn().mockReturnValue({ messageCount: 0 }),
      getMessages: vi.fn().mockReturnValue([]),
    } as unknown as AgentManager

    const result = await processCommand(fakeManager, 'sessions:select:019dc5e5')

    expect(result?.text).toContain('📚 Session details')
    expect(result?.text).toContain('**ID:** `019dc5e5`')
    expect(result?.text).toContain('**Messages:** 3')
    expect(result?.text).toContain('**Modified:**')
    expect(result?.text).toContain('**Preview:** `Hello there`')
    expect(result?.markup?.inline_keyboard).toBeDefined()

    const buttons = result?.markup?.inline_keyboard as any[]
    expect(buttons.length).toBe(1)

    // Two buttons: Load and Back
    expect(buttons[0][0].text).toBe('✅ Load session')
    expect(buttons[0][0].callback_data).toBe('sessions:load:019dc5e5')
    expect(buttons[0][1].text).toBe('← Back')
    expect(buttons[0][1].callback_data).toBe('sessions:page:0')
  })

  it('handles invalid session ID in select', async () => {
    const fakeManager = {
      listSessions: vi.fn().mockResolvedValue([]),
    } as unknown as AgentManager

    const result = await processCommand(fakeManager, 'sessions:select:invalidid')

    expect(result?.text).toBe('❌ Session not found: invalidid')
    expect(result?.markup).toBeUndefined()
  })

  it('loads session and returns success message', async () => {
    const sessions = [
      {
        id: '019dc5e5-c123-7456-89ab-cdef01234567',
        path: '/sessions/target.jsonl',
        messageCount: 3,
        modified: new Date('2026-04-25T22:32:00Z'),
        firstMessage: 'Hello there',
        name: undefined,
      },
    ]

    const fakeManager = {
      listSessions: vi.fn().mockResolvedValue(sessions),
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

    const result = await processCommand(fakeManager, 'sessions:load:019dc5e5')

    expect(fakeManager.switchSession).toHaveBeenCalledWith('/sessions/target.jsonl')
    expect(result?.markup).toBeUndefined()
    expect(result?.text).toContain('✅ Switched to session.')
    expect(result?.text).toContain('**ID:** `019dc5e5`')
    expect(result?.text).toContain('**Model:** `anthropic/claude-sonnet-4-5-20250929`')
    expect(result?.text).toContain('**Messages:** 3')
    expect(result?.text).toContain('**Latest message:** `Last message from the user`')
  })

  it('handles backticks in session preview', async () => {
    const sessions = [
      {
        id: '019dc5e5-c123-7456-89ab-cdef01234567',
        path: '/sessions/target.jsonl',
        messageCount: 3,
        modified: new Date('2026-04-25T22:32:00Z'),
        firstMessage: 'Use `git commit` to save changes',
        name: undefined,
      },
    ]

    const fakeManager = {
      listSessions: vi.fn().mockResolvedValue(sessions),
      getState: vi.fn().mockReturnValue({ messageCount: 0 }),
      getMessages: vi.fn().mockReturnValue([]),
    } as unknown as AgentManager

    const result = await processCommand(fakeManager, 'sessions:select:019dc5e5')

    // Backticks in preview should be stripped and replaced with single quotes
    expect(result?.text).toContain('**Preview:** `Use \'git commit\' to save changes`')
  })

  it('handles asterisks and underscores in session preview (Markdown injection safety)', async () => {
    const sessions = [
      {
        id: '019dc5e5-c123-7456-89ab-cdef01234567',
        path: '/sessions/target.jsonl',
        messageCount: 3,
        modified: new Date('2026-04-25T22:32:00Z'),
        firstMessage: 'Fix the *important* bug in **main.py**',
        name: undefined,
      },
    ]

    const fakeManager = {
      listSessions: vi.fn().mockResolvedValue(sessions),
      getState: vi.fn().mockReturnValue({ messageCount: 0 }),
      getMessages: vi.fn().mockReturnValue([]),
    } as unknown as AgentManager

    const result = await processCommand(fakeManager, 'sessions:select:019dc5e5')

    // Markdown chars should appear literally inside backticks
    expect(result?.text).toContain('**Preview:** `Fix the *important* bug in **main.py**`')
  })
})

describe('noop callback handling', () => {
  it('returns null for sessions:noop (page indicator)', async () => {
    const fakeManager = {} as unknown as AgentManager
    const result = await processCommand(fakeManager, 'sessions:noop')
    expect(result).toBeNull()
  })
})

describe('handleStatusCommand', () => {
  it('shows formatted status with bold labels and code values when session is active', async () => {
    const fakeManager = {
      getState: vi.fn().mockReturnValue({
        sessionId: '019dc5e5-c123-7456-89ab-cdef01234567',
        model: 'anthropic/claude-sonnet-4-5-20250929',
        messageCount: 12,
        isStreaming: false,
        thinkingLevel: 'medium',
      }),
    } as unknown as AgentManager

    const result = await processCommand(fakeManager, '/status')

    expect(result?.text).toContain('📊 **Session Status**')
    expect(result?.text).toContain('**Session ID:** `019dc5e5`')
    expect(result?.text).toContain('**Model:** `anthropic/claude-sonnet-4-5-20250929`')
    expect(result?.text).toContain('**Messages:** 12')
    expect(result?.text).toContain('**Streaming:** ❌')
    expect(result?.text).toContain('**Thinking Level:** `medium`')
  })

  it('shows ✅ when streaming is true', async () => {
    const fakeManager = {
      getState: vi.fn().mockReturnValue({
        sessionId: '019dc5e5-c123-7456-89ab-cdef01234567',
        model: 'anthropic/claude-sonnet-4-5',
        messageCount: 5,
        isStreaming: true,
        thinkingLevel: 'high',
      }),
    } as unknown as AgentManager

    const result = await processCommand(fakeManager, '/status')

    expect(result?.text).toContain('**Streaming:** ✅')
  })

  it('shows no session active when state is null', async () => {
    const fakeManager = {
      getState: vi.fn().mockReturnValue(null),
    } as unknown as AgentManager

    const result = await processCommand(fakeManager, '/status')

    expect(result?.text).toBe('⚠️ No session active.')
  })

  it('shows not set when model is null', async () => {
    const fakeManager = {
      getState: vi.fn().mockReturnValue({
        sessionId: '019dc5e5-c123-7456-89ab-cdef01234567',
        model: null,
        messageCount: 0,
        isStreaming: false,
        thinkingLevel: 'minimal',
      }),
    } as unknown as AgentManager

    const result = await processCommand(fakeManager, '/status')

    expect(result?.text).toContain('`not set`')
  })
})
