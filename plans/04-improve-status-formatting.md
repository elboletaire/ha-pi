# Plan: Improve /status Formatting

## Problem

The `/status` command currently outputs a flat, unformatted text block:

```
📊 Session Status

Session ID: 019dc5e5
Model: anthropic/claude-sonnet-4-5-20250929
Messages: 12
Streaming: false
Thinking Level: medium
```

Field names are not bold, and values lack visual distinction. The "Streaming" boolean is not particularly useful to the end user.

## Target Output

Using the Markdown-safe patterns established in Plan 01:

```
📊 **Session Status**

**Session ID:** `019dc5e5`
**Model:** `anthropic/claude-sonnet-4-5-20250929`
**Messages:** 12
**Streaming:** ✅ / ❌
**Thinking Level:** `medium`
```

Specifically:
- Field names use `**bold**` Markdown syntax (rendered by `markdownToTelegramHTML` downstream)
- Session ID and Model values are wrapped in backticks (inline code) — consistent with Plan 01 session switch message
- Thinking Level in backticks too for visual consistency (it's a short keyword like `medium`, `high`)
- Boolean "Streaming" shows ✅ for `true` and ❌ for `false`
- Message count is plain number (numeric, no Markdown risk)

## Changes

### `src/channel-bridge/commands.ts` — `handleStatusCommand`

Replace the current template string (line ~218) with Markdown-formatted text:

```typescript
text: [
  '📊 **Session Status**',
  '',
  `**Session ID:** \`${state.sessionId.slice(0, 8)}\``,
  `**Model:** \`${state.model || 'not set'}\``,
  `**Messages:** ${state.messageCount}`,
  `**Streaming:** ${state.isStreaming ? '✅' : '❌'}`,
  `**Thinking Level:** \`${state.thinkingLevel}\``,
].join('\n'),
```

**Note on `state.model`:** From `agent-manager.ts` `getState()`, `model` is `string | null` (it's `session.model ? \`${session.model.provider}/${session.model.id}\` : null`). When null, show `` `not set` ``. The backtick wrapping handles this safely.

**Note on `state.thinkingLevel`:** From `getState()`, this is `session.thinkingLevel` which is always a `ThinkingLevel` string (one of: `minimal`, `low`, `medium`, `high`, `xhigh`). No risk of special characters, but backtick wrapping is used for visual consistency.

### No Other File Changes

The bridge and adapter pipeline already handles Markdown → HTML conversion for all command responses.

## Tests

### New Tests in `tests/channel-bridge-commands.test.ts`

1. **`/status` shows formatted output with bold labels and code values**:
   - Mock `agentManager.getState()` returning:
     ```
     {
       sessionId: '019dc5e5-c123-7456-89ab-cdef01234567',
       model: 'anthropic/claude-sonnet-4-5-20250929',
       messageCount: 12,
       isStreaming: false,
       thinkingLevel: 'medium',
     }
     ```
   - Assert response text contains `**Session Status**`
   - Assert response text contains `` **Session ID:** `019dc5e5` `` (bold label, backtick value)
   - Assert response text contains `` **Model:** `anthropic/claude-sonnet-4-5-20250929` ``
   - Assert response text contains `**Messages:** 12`
   - Assert response text contains `**Streaming:** ❌` (false → ❌)
   - Assert response text contains `` **Thinking Level:** `medium` ``

2. **`/status` shows ✅ when streaming is true**:
   - Mock `getState()` with `isStreaming: true`
   - Assert response contains `**Streaming:** ✅`

3. **`/status` when no session is active**:
   - Mock `getState()` returning `null`
   - Assert response contains "No session active"

4. **`/status` with null model**:
   - Mock `getState()` returning `{ model: null, ... }`
   - Assert response contains `` `not set` ``

### Integration Test with `markdownToTelegramHTML`

Optionally, add a test in `tests/message-format.test.ts` that passes a full `/status`-style message through the converter to verify the end-to-end output:

5. **Status message renders correctly through markdownToTelegramHTML**:
   - Input: the Markdown text from `/status` (with bold labels, backtick values)
   - Expected: `<b>Session Status</b>` for the header, `<b>Session ID:</b> <code>019dc5e5</code>` for each field, etc.
   - This catches any interaction between the various Markdown patterns (bold + code on same line)

## Acceptance Criteria

- `/status` renders field names in bold in Telegram
- Session ID, Model, and Thinking Level appear in inline code style
- Streaming shows ✅/❌ instead of true/false
- Null model shows `` `not set` `` gracefully
- Message count is plain number
- Formatting is consistent with Plan 01 patterns (bold labels, backtick values)
- New tests cover all formatting variants (streaming true/false, null model, no session)
- End-to-end test verifies the Markdown → HTML conversion produces valid Telegram HTML
