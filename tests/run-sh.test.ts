import { readFileSync } from 'fs'
import { describe, expect, it } from 'vitest'

const runSh = readFileSync(new URL('../run.sh', import.meta.url), 'utf8')

describe('run.sh telegram argument handling', () => {
  it('passes Telegram arguments via a shell array so quotes are preserved correctly', () => {
    expect(runSh).toContain('TELEGRAM_ARGS=()')
    expect(runSh).toContain('TELEGRAM_ARGS+=(--telegram-bot-token "$TELEGRAM_TOKEN")')
    expect(runSh).toContain('TELEGRAM_ARGS+=(--telegram-allowed-chat-ids "$TELEGRAM_CHAT_IDS")')
    expect(runSh).toContain('"${TELEGRAM_ARGS[@]}"')
    expect(runSh).not.toContain('--telegram-bot-token \\\"${TELEGRAM_TOKEN}\\\"')
    expect(runSh).not.toContain('--telegram-allowed-chat-ids \\\"${TELEGRAM_CHAT_IDS}\\\"')
  })
})
