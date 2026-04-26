# Plan: Add Thinking/Reasoning Level Command

## Problem

There is no way to change the thinking/reasoning level from the Telegram bridge. The pi SDK's `AgentSession` exposes `setThinkingLevel(level)`, `cycleThinkingLevel()`, and `getAvailableThinkingLevels()`, but these are not wired to any Telegram command. Additionally, some models don't support reasoning at all, and this must be handled gracefully.

## Background

### SDK API

From `@mariozechner/pi-coding-agent` and `@mariozechner/pi-ai`:

- **`ThinkingLevel`** type: `"minimal" | "low" | "medium" | "high" | "xhigh"`
- **`AgentSession.thinkingLevel`**: getter for current level
- **`AgentSession.setThinkingLevel(level)`**: sets the level (void return)
- **`AgentSession.getAvailableThinkingLevels()`**: returns `ThinkingLevel[]` — empty array if model doesn't support reasoning
- **`AgentSession.cycleThinkingLevel()`**: returns `ThinkingLevel | undefined` — cycles through available levels
- **`Model.capabilities.reasoning`**: boolean indicating if model supports reasoning

### Model Capabilities

- Models report `reasoning: boolean` in their capabilities
- `getAvailableThinkingLevels()` returns `[]` for non-reasoning models
- `setThinkingLevel()` on a non-reasoning model: behavior unclear — may silently no-op or throw. We must guard at the command level by checking `getAvailableThinkingLevels()` before calling `setThinkingLevel()`.

## Target Behavior

### Button-Based Flow (consistent with sessions/model plans)

**`/thinking` command** — shows current level and available options as buttons.

#### When Model Supports Reasoning

**Message text** (using Markdown-safe patterns from Plan 01):
```
🧠 **Thinking Level**

Current: `medium`
```

**Buttons:** One button per available level, with the current level marked with ✓. Since there are at most 5 levels (`minimal`, `low`, `medium`, `high`, `xhigh`), no pagination needed — all fit in a single view.

Layout: 2 buttons per row (compact), last row may have 1 button:
```
[ minimal ]       [ low ]
[ ✓ medium ]      [ high ]
[ xhigh ]
```

Each button: `callback_data` = `thinking:set:<level>` (e.g. `thinking:set:high`). Callback data is very short (max `thinking:set:minimal` = 22 bytes), well within Telegram's 64-byte limit.

#### When Model Does NOT Support Reasoning

**Message text:**
```
🧠 **Thinking Level**

The current model (`gpt-4.1`) does not support reasoning/thinking levels.
```

The model name is wrapped in backticks for Markdown safety and visual consistency.

**Buttons:** None.

### Level Set Confirmation

When `thinking:set:<level>` is triggered:

**Message text:**
```
✅ Thinking level changed to: `high`
```

No buttons.

### Error Handling

- **Invalid level** (not in `getAvailableThinkingLevels()`): Return `❌ Invalid thinking level: \`<level>\`. Available levels: minimal, low, medium, high, xhigh.` — list the actual available levels from `getAvailableThinkingLevels()`.
- **Model changed between view and tap** (new model doesn't support reasoning or doesn't support the tapped level): The validation against `getAvailableThinkingLevels()` at tap time catches this. Return: `❌ The current model does not support thinking level \`<level>\`. Use /thinking to see available options.`
- **`setThinkingLevel` throws** (unexpected SDK error): Catch and return `❌ Failed to set thinking level: <error>`.
- **No session active**: Return `⚠️ No session active.` — consistent with `/status`.

## Implementation

### Changes to `src/agent-manager.ts`

Add two new methods to expose the SDK's thinking level API:

1. **`getAvailableThinkingLevels(): string[]`** — delegates to `this.ensureSession().getAvailableThinkingLevels()`. Returns the array of valid levels for the current model, or empty array if model doesn't support reasoning.

2. **`setThinkingLevel(level: string): void`** — delegates to `this.ensureSession().setThinkingLevel(level as ThinkingLevel)`. The SDK method accepts `ThinkingLevel` which is a string union. We accept `string` and cast, letting the SDK validate internally. If the SDK doesn't throw for invalid levels, we add our own validation (see command handler).

**Import note:** `ThinkingLevel` is defined in `@mariozechner/pi-ai` as `"minimal" | "low" | "medium" | "high" | "xhigh"`. It's referenced by `AgentSession` from `@mariozechner/pi-coding-agent`. For the agent manager's public API, accept `string` to avoid leaking the pi-ai dependency. The command handler validates against `getAvailableThinkingLevels()` before calling `setThinkingLevel`.

**`thinkingLevel` in `getState()`**: Already exposed — `getState()` returns `{ thinkingLevel: session.thinkingLevel, ... }`. No change needed here.

### Changes to `src/channel-bridge/commands.ts`

1. **Add `handleThinkingCommand(agentManager)`** — shows current level and buttons:
   - Call `agentManager.getState()` to get current `thinkingLevel` and `model`
   - If no session: return "No session active"
   - Call `agentManager.getAvailableThinkingLevels()` to get options
   - If empty array → return "model doesn't support reasoning" message (with model name in backticks)
   - Otherwise → return text with current level in backticks, and buttons for each available level
   - Current level button gets ✓ prefix in label
   - Button layout: 2 per row using `chunk` helper (simple loop: push pairs of buttons into rows)

2. **Add `handleThinkingSetCommand(agentManager, level)`** — sets the level:
   - Call `agentManager.getAvailableThinkingLevels()`
   - If `level` is not in the array → return error with available levels listed
   - Call `agentManager.setThinkingLevel(level)` in try/catch
   - On success: return confirmation with level in backticks
   - On error: return friendly error message

3. **Update `parseTelegramCommand`**:
   - Parse `/thinking` → `{ name: 'thinking', args: '' }`
   - Parse `thinking:set:<level>` → `{ name: 'thinking_set', args: '<level>' }`

4. **Update `parseCommand` return types**:
   - `{ type: 'thinking' }` — show current level and options
   - `{ type: 'thinking_set'; level: string }` — set the level

5. **Update `processCommand`** — add cases for `'thinking'` and `'thinking_set'`.

6. **Update `getCommandsForTelegram`** — add `/thinking` with description "Change thinking/reasoning level".

7. **Update `buildWelcomeText`** — add `/thinking - Change thinking level` to the command list.

### Changes to `src/channel-bridge/bridge.ts`

No changes needed. Commands flow through the existing `processCommand` → `sendMessage` pipeline.

### Changes to `src/channel-bridge/telegram.ts`

No changes needed. Callback handling is already generic.

## Tests

### New Tests in `tests/channel-bridge-commands.test.ts`

1. **`/thinking` shows available levels with buttons**:
   - Mock `getState()` → `{ thinkingLevel: 'medium', model: 'anthropic/claude-sonnet-4-5', ... }`
   - Mock `getAvailableThinkingLevels()` → `['minimal', 'low', 'medium', 'high', 'xhigh']`
   - Assert response text contains `**Thinking Level**`
   - Assert response text contains `` `medium` ``
   - Assert `markup.inline_keyboard` has buttons for each level
   - Assert `medium` button has `✓` prefix: `{ text: '✓ medium', callback_data: 'thinking:set:medium' }`
   - Assert other buttons don't have ✓: `{ text: 'high', callback_data: 'thinking:set:high' }`
   - Assert button layout is 2 per row (first row has 2, second has 2, third has 1)

2. **`/thinking` when model doesn't support reasoning**:
   - Mock `getAvailableThinkingLevels()` → `[]`
   - Mock `getState()` → `{ model: 'openai/gpt-4.1', ... }`
   - Assert response contains "does not support reasoning"
   - Assert response contains `` `gpt-4.1` `` (model name in backticks — extract short name from `provider/id` format)
   - Assert no markup or empty markup

3. **`/thinking` when no session is active**:
   - Mock `getState()` → `null`
   - Assert response contains "No session active"

4. **`/thinking` when model has limited levels**:
   - Mock `getAvailableThinkingLevels()` → `['low', 'medium', 'high']` (only 3 levels)
   - Assert only 3 buttons rendered (2 in first row, 1 in second)

5. **`thinking:set:high` sets the level successfully**:
   - Mock `getAvailableThinkingLevels()` → `['minimal', 'low', 'medium', 'high', 'xhigh']`
   - Mock `setThinkingLevel` to resolve
   - Assert response contains `` `high` ``
   - Assert `setThinkingLevel` was called with `'high'`

6. **`thinking:set:invalid` returns error for unknown level**:
   - Mock `getAvailableThinkingLevels()` → `['minimal', 'low', 'medium', 'high']`
   - Assert response contains error about invalid level
   - Assert response lists available levels
   - Assert `setThinkingLevel` was NOT called

7. **`thinking:set:high` when model no longer supports it** (model changed between view and tap):
   - Mock `getAvailableThinkingLevels()` → `[]`
   - Assert response contains error about model not supporting thinking levels

8. **`thinking:set:high` handles setThinkingLevel SDK error gracefully**:
   - Mock `getAvailableThinkingLevels()` → `['high', ...]`
   - Mock `setThinkingLevel` to throw `new Error('Internal SDK error')`
   - Assert response contains `❌` and the error message

9. **Command parsing**:
   - `parseCommand('/thinking')` → `{ type: 'thinking' }`
   - `parseCommand('/thinking@mybot')` → `{ type: 'thinking' }` (with bot username)
   - `parseCommand('thinking:set:high')` → `{ type: 'thinking_set', level: 'high' }`
   - `parseCommand('thinking:set:xhigh')` → `{ type: 'thinking_set', level: 'xhigh' }`
   - `parseCommand('thinking:set:minimal')` → `{ type: 'thinking_set', level: 'minimal' }`

10. **`getCommandsForTelegram` includes thinking**:
    - Assert the command list includes `{ command: 'thinking', description: '...' }`

11. **Welcome/help text includes thinking**:
    - Assert `buildWelcomeText` output (via `/start` or `/help`) contains `/thinking`

### Tests for `agent-manager.ts`

Extend `src/agent-manager.test.ts`:

1. **`getAvailableThinkingLevels` delegates to session**:
   - Mock session with `getAvailableThinkingLevels` returning `['low', 'medium', 'high']`
   - Assert the method returns the same array

2. **`setThinkingLevel` delegates to session**:
   - Mock session with `setThinkingLevel` as a spy
   - Call `agentManager.setThinkingLevel('high')`
   - Assert session's `setThinkingLevel` was called with `'high'`

3. **`getAvailableThinkingLevels` throws when no session**:
   - Call before `init()`
   - Assert throws "Agent not initialised" (via `ensureSession()`)

4. **`setThinkingLevel` throws when no session**:
   - Call before `init()`
   - Assert throws "Agent not initialised"

### Markdown Safety Tests

In `tests/message-format.test.ts` or inline in the command tests:

1. **Thinking level response with backtick value renders correctly**:
   - Input: `` **Thinking Level**\n\nCurrent: `medium` ``
   - Through `markdownToTelegramHTML`: `<b>Thinking Level</b>\n\nCurrent: <code>medium</code>`

2. **"Does not support reasoning" message with model name renders correctly**:
   - Input: `` The current model (`gpt-4.1`) does not support reasoning. ``
   - Through converter: model name safely in `<code>` tags

## Risks

- **SDK validation**: If `setThinkingLevel` throws for invalid levels internally, we catch it. We also pre-validate against `getAvailableThinkingLevels()` so SDK errors should be rare.
- **Model switch race**: User could change model between viewing `/thinking` and tapping a level button. The new model might not support that level. The validation step (check against current `getAvailableThinkingLevels()` at tap time) handles this gracefully with a clear error message.
- **Empty state**: If no session is active, `getState()` returns null. Handled with "No session active" message, consistent with `/status`.
- **ThinkingLevel type**: We accept `string` in the agent manager's public API to avoid dependency leakage. The SDK validates the actual value. The command handler additionally validates against the available levels list.

## Acceptance Criteria

- `/thinking` shows the current thinking level and available options as buttons
- Buttons are laid out 2 per row with current level marked ✓
- Tapping a level button changes the thinking level with confirmation (level in backticks)
- Non-reasoning models show a clear "not supported" message with model name in code style
- Invalid levels are rejected with a helpful error listing available options
- Model-changed-between-taps scenario is handled gracefully
- Errors from the SDK are caught and displayed as friendly error messages
- No session active → clear message
- New command appears in bot menu (`getCommandsForTelegram`) and welcome message
- `AgentManager` exposes `getAvailableThinkingLevels()` and `setThinkingLevel(level)` methods
- All new functionality has comprehensive test coverage (command handler, parsing, agent manager, edge cases)
- Formatting is consistent with Plans 01/04 (bold labels, backtick values)
