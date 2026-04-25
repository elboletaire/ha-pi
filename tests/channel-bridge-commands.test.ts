import { describe, expect, it } from 'vitest'
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
    expect(parseCommand('session:session-123')).toEqual({ type: 'session', path: 'session-123' })
    expect(parseCommand('/session abc123')).toEqual({ type: 'session', path: 'abc123' })
    expect(parseCommand('/model provider/model-id')).toEqual({ type: 'model', model: 'provider/model-id' })
  })

  it('returns a welcome response for /start and /help', async () => {
    const result = await processCommand({} as AgentManager, '/start')

    expect(result?.text).toContain('Welcome to Pi Agent!')
    expect(result?.text).toContain('/start - This message')
    expect(result?.markup).toBeTruthy()
  })

  it('exposes the expected Telegram command menu', () => {
    const commands = getCommandsForTelegram().map((entry) => entry.command)

    expect(commands).toEqual([
      'start',
      'help',
      'new',
      'sessions',
      'session',
      'delete',
      'status',
      'model',
      'abort',
    ])
  })
})
