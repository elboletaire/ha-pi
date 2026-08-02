import { describe, expect, it } from 'vitest'
import { buildSessionHistoryOps } from '../frontend/session-history'

describe('buildSessionHistoryOps', () => {
  it('converts session messages into ordered UI operations', () => {
    const ops = buildSessionHistoryOps([
      { role: 'user', content: 'hello', timestamp: 1 },
      {
        role: 'assistant',
        api: 'anthropic-messages',
        provider: 'anthropic',
        model: 'claude-sonnet-4-5',
        usage: {
          input: 1,
          output: 1,
          cacheRead: 0,
          cacheWrite: 0,
          totalTokens: 2,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
        },
        stopReason: 'toolUse',
        timestamp: 2,
        content: [
          { type: 'thinking', thinking: 'hmm' },
          { type: 'text', text: 'Let me check' },
          { type: 'toolCall', id: 't1', name: 'bash', arguments: { command: 'ls' } },
        ],
      },
      {
        role: 'toolResult',
        toolCallId: 't1',
        toolName: 'bash',
        isError: false,
        timestamp: 3,
        content: [{ type: 'text', text: 'file.txt' }],
      },
    ] as any)

    expect(ops).toEqual([
      { type: 'user', text: 'hello' },
      { type: 'assistant_start' },
      { type: 'assistant_thinking', text: 'hmm' },
      { type: 'assistant_text', text: 'Let me check' },
      { type: 'assistant_tool_call', id: 't1', name: 'bash', args: { command: 'ls' } },
      { type: 'assistant_end' },
      { type: 'tool_result', id: 't1', name: 'bash', output: 'file.txt', isError: false },
    ])
  })

  it('includes image placeholders in display text', () => {
    const ops = buildSessionHistoryOps([
      {
        role: 'user',
        content: [
          { type: 'text', text: 'see this' },
          { type: 'image', data: 'abcd', mimeType: 'image/png' },
        ],
        timestamp: 1,
      },
    ] as any)

    expect(ops).toEqual([{ type: 'user', text: 'see this[image:image/png]' }])
  })

  // pi's AgentSession carries more than the three LLM roles. These shapes have
  // no `content` field, and reading one crashed the whole transcript — opening
  // any compacted session rendered nothing at all.
  describe('agent-only message roles', () => {
    it('renders a compaction summary as a note instead of throwing', () => {
      const ops = buildSessionHistoryOps([
        { role: 'compactionSummary', summary: 'We migrated the auth layer.', tokensBefore: 120000, timestamp: 1 },
      ] as any)

      // Built the same way the code does: the grouping separator is the
      // reader's locale, so pinning a literal would fail outside en-US.
      const grouped = (120000).toLocaleString()
      expect(ops).toEqual([
        {
          type: 'note',
          label: `Context compacted (${grouped} tokens summarised)`,
          text: 'We migrated the auth layer.',
        },
      ])
    })

    it('renders a branch summary as a note', () => {
      const ops = buildSessionHistoryOps([
        { role: 'branchSummary', summary: 'Tried the musl route.', fromId: 'e1', timestamp: 1 },
      ] as any)

      expect(ops).toEqual([{ type: 'note', label: 'Returned from a branch', text: 'Tried the musl route.' }])
    })

    it('renders a bash execution as a note', () => {
      const ops = buildSessionHistoryOps([
        { role: 'bashExecution', command: 'ls -la', output: 'file.txt', exitCode: 0, timestamp: 1 },
      ] as any)

      expect(ops).toEqual([{ type: 'note', label: 'Ran `ls -la`', text: 'file.txt' }])
    })

    it('honours the display flag on extension-injected custom messages', () => {
      const shown = buildSessionHistoryOps([
        { role: 'custom', customType: 'skill', content: 'loaded', display: true, timestamp: 1 },
      ] as any)
      const hidden = buildSessionHistoryOps([
        { role: 'custom', customType: 'skill', content: 'loaded', display: false, timestamp: 1 },
      ] as any)

      expect(shown).toEqual([{ type: 'note', label: 'skill', text: 'loaded' }])
      expect(hidden).toEqual([])
    })

    it('skips roles it does not know rather than dropping the transcript', () => {
      const ops = buildSessionHistoryOps([
        { role: 'user', content: 'before', timestamp: 1 },
        { role: 'somethingUpstreamAddedLater', payload: {}, timestamp: 2 },
        { role: 'user', content: 'after', timestamp: 3 },
      ] as any)

      expect(ops).toEqual([
        { type: 'user', text: 'before' },
        { type: 'user', text: 'after' },
      ])
    })

    it('survives a message whose content is missing entirely', () => {
      const ops = buildSessionHistoryOps([
        { role: 'user', timestamp: 1 },
        { role: 'assistant', content: undefined, timestamp: 2 },
      ] as any)

      expect(ops).toEqual([{ type: 'user', text: '' }, { type: 'assistant_start' }, { type: 'assistant_end' }])
    })
  })
})
