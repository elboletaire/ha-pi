import type {
  Message as SessionMessage,
  UserMessage,
  AssistantMessage,
  ToolResultMessage,
  TextContent,
  ImageContent,
  ThinkingContent,
  ToolCall,
} from '@earendil-works/pi-ai'

/**
 * pi's `AgentSession.messages` is an `AgentMessage[]`, not a `Message[]`: on top
 * of the three LLM roles it carries compaction and branch summaries, `!` bash
 * executions, and extension-injected custom messages. Those shapes have no
 * `content` field at all — a compaction summary is `{ role, summary,
 * tokensBefore, timestamp }`.
 *
 * They are declared here rather than imported because they live in
 * `@earendil-works/pi-agent-core`, which reaches us only as a transitive
 * dependency, and because this is the wire format the browser sees — the same
 * reason the rest of the protocol is described locally.
 */
type AgentOnlyMessage =
  | { role: 'bashExecution'; command: string; output: string; excludeFromContext?: boolean }
  | { role: 'custom'; customType: string; content: string | (TextContent | ImageContent)[]; display: boolean }
  | { role: 'branchSummary'; summary: string }
  | { role: 'compactionSummary'; summary: string; tokensBefore: number }

export type HistoryMessage = SessionMessage | AgentOnlyMessage

export type SessionHistoryOp =
  | { type: 'user'; text: string }
  | { type: 'assistant_start' }
  | { type: 'assistant_text'; text: string }
  | { type: 'assistant_thinking'; text: string }
  | { type: 'assistant_tool_call'; id: string; name: string; args: Record<string, unknown> }
  | { type: 'assistant_end' }
  | { type: 'tool_result'; id: string; name: string; output: string; isError: boolean }
  /** Out-of-band conversation event — a compaction, a branch return, a `!` command. */
  | { type: 'note'; label: string; text: string }

export function buildSessionHistoryOps(messages: HistoryMessage[]): SessionHistoryOp[] {
  const ops: SessionHistoryOp[] = []

  for (const message of messages) {
    switch (message.role) {
      case 'user':
        ops.push({ type: 'user', text: contentToDisplayText(message.content) })
        break

      case 'assistant':
        ops.push({ type: 'assistant_start' })
        for (const block of message.content ?? []) {
          if (block.type === 'text') {
            if (block.text) ops.push({ type: 'assistant_text', text: block.text })
            continue
          }
          if (block.type === 'thinking') {
            if (block.thinking) ops.push({ type: 'assistant_thinking', text: block.thinking })
            continue
          }
          ops.push({
            type: 'assistant_tool_call',
            id: block.id,
            name: block.name,
            args: block.arguments ?? {},
          })
        }
        ops.push({ type: 'assistant_end' })
        break

      case 'toolResult':
        ops.push({
          type: 'tool_result',
          id: message.toolCallId,
          name: message.toolName,
          output: contentToDisplayText(message.content),
          isError: message.isError,
        })
        break

      case 'compactionSummary':
        ops.push({
          type: 'note',
          label: `Context compacted (${message.tokensBefore.toLocaleString()} tokens summarised)`,
          text: message.summary,
        })
        break

      case 'branchSummary':
        ops.push({ type: 'note', label: 'Returned from a branch', text: message.summary })
        break

      case 'bashExecution':
        ops.push({ type: 'note', label: `Ran \`${message.command}\``, text: message.output })
        break

      case 'custom':
        // Extensions decide whether their messages are meant to be seen.
        if (message.display) {
          ops.push({ type: 'note', label: message.customType, text: contentToDisplayText(message.content) })
        }
        break

      default:
        // Unreachable per the types, but upstream adds message roles between
        // releases and an unknown one must not take the whole transcript down.
        break
    }
  }

  return ops
}

/**
 * Tolerates missing content on purpose: pi parses session files without
 * validation, so an old, forked, or hand-edited session can carry a message
 * with no content at all, and one such message must not blank the transcript.
 */
function contentToDisplayText(content: string | (TextContent | ImageContent)[] | null | undefined): string {
  if (content == null) return ''
  if (typeof content === 'string') return content
  const parts = content.map((block) => {
    if (block.type === 'text') return block.text
    return `[image:${block.mimeType}]`
  })
  return parts.join('').trim()
}
