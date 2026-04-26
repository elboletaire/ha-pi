# Plan: Revamp /model to Button-Based Pagination

## Problem

The current `/model` command (without arguments) shows a plain text list of available models. With arguments, it directly sets the model. We want the same button-driven, paginated experience built for `/sessions`.

## Current Behavior

1. `/model` → text list: "📊 Current model: X\n\nAvailable models:\n  • provider/id\n  ..."
2. `/model provider/model-id` → sets model immediately
3. `list_models` callback → same as `/model` (no args)

## Target Behavior

### Step 1: Model List (paginated)

When user sends `/model` (or taps `list_models` callback):

**Message text:** `🤖 Select a model`

**Buttons:** Paginated list of available models. Each button shows `provider/id`. The currently active model gets a ✓ prefix. Page size: 5 models per page.

Layout:
```
[ "✓ anthropic/claude-sonnet-4-5"  ]
[ "anthropic/claude-opus-4"        ]
[ "google/gemini-2.5-pro"          ]
[ "openai/gpt-4.1"                 ]
[ "openai/o3"                      ]
[      ← Page 1/2 →               ]
```

Each model button: `callback_data` = `models:select:<index>` where index is the model's position in the `getAvailableModels()` array (0-based).

Navigation: `models:page:<N>` — reuses the same pagination utility from Plan 02.

**Why index-based instead of name-based:** Model IDs like `anthropic/claude-sonnet-4-5-20250929` can be up to ~45 chars. With prefix `models:select:` (14 chars), that's ~59 bytes — technically within Telegram's 64-byte limit but dangerously close, and longer model IDs from OpenRouter or custom providers could exceed it. Index-based references (`models:select:3`) are always short and safe. The downside (index could be stale if model list changes) is minimal since the model list is static per session.

### Step 2: Model Detail (confirmation)

When a model button is tapped (`models:select:<index>`):

Resolve the index against `getAvailableModels()`. If index is out of range, return an error.

**Message text** (using Markdown-safe patterns from Plan 01):
```
🤖 Model details

**Provider:** `anthropic`
**Model:** `claude-sonnet-4-5`
**Current:** ✓ / ✗
```

All dynamic values (provider, model name) are backtick-wrapped. These values are unlikely to contain Markdown-special characters, but wrapping them in code style is both visually consistent and defensively safe.

**Buttons:**
```
[ ✅ Use this model ]   [ ← Back ]
```

- `✅ Use this model` → `models:load:<index>` — sets the model
- `← Back` → `models:page:0` — back to model list

If the selected model is already the active model, still show the button — setting the same model is a no-op and simpler than conditional logic. The "Current: ✓" indicator already tells the user.

### Step 3: Model Set Confirmation

When `models:load:<index>` is triggered, resolve index, call `agentManager.setModel(provider, modelId)`:

```
✅ Model changed to: `anthropic/claude-sonnet-4-5`
```

No buttons after confirmation.

### Step 4: Remove Legacy Parsing

Remove:
- `/model <name>` argument parsing — models are now selected via buttons only
- The `model` case in `parseCommand` that returns `{ type: 'model'; model?: string }` with a model string

Keep `list_models` callback as an alias that maps to `{ type: 'model', page: 0 }` for backward compatibility — existing inline buttons in old messages (e.g. from `/abort` response) may still carry this callback data.

## Implementation

### Reuse Pagination Utility

The `src/channel-bridge/pagination.ts` module from Plan 02 is reused. The model list uses the same `PaginationConfig` interface with:
- `callbackPrefix: 'models'`
- `buttonLabel: (m, index) => (isCurrentModel ? '✓ ' : '') + m.provider + '/' + m.id` — note: the label function needs access to the current model to show ✓. The pagination utility should support passing extra context, or the caller pre-computes labels.
  - **Preferred approach:** the caller maps models into items with pre-computed labels before passing to the pagination utility. The utility is generic and doesn't know about "current model" semantics.
- `buttonData: (m, index) => 'models:select:' + index` — where `index` is the *global* index in the full list, not the page-relative index. The pagination utility must pass the global index to the `buttonData` callback. Ensure the utility's signature supports this: `buttonData: (item: T, globalIndex: number) => string`.

### Changes to `commands.ts`

1. **Refactor `handleModelCommand`** — split into multiple handlers:
   - `handleModelListCommand(agentManager, page = 0)` — returns paginated model buttons
   - `handleModelSelectCommand(agentManager, index: number)` — shows detail with "Use" and "Back" buttons
   - `handleModelLoadCommand(agentManager, index: number)` — sets the model and returns confirmation

2. **Update `parseTelegramCommand`**:
   - Parse `models:select:<index>` → `{ name: 'model_select', args: '<index>' }`
   - Parse `models:load:<index>` → `{ name: 'model_load', args: '<index>' }`
   - Parse `models:page:<N>` → `{ name: 'model', args: '' }` with page info encoded (e.g. add page to a new return field, or parse within `parseCommand`)
   - Parse `models:noop` → noop handling (same pattern as `sessions:noop` from Plan 02)
   - Keep `list_models` as alias → `{ name: 'model', args: '' }`

3. **Update `parseCommand` return types** — add:
   - `{ type: 'model'; page?: number }` — paginated list (page defaults to 0)
   - `{ type: 'model_select'; index: number }` — model detail view
   - `{ type: 'model_load'; index: number }` — confirm and set model
   - Remove: `{ type: 'model'; model?: string }` — no more direct model string argument

4. **Update `processCommand`** — route new types.

5. **Update `getCommandsForTelegram`** — keep `/model` in the menu but update description to "Browse and change AI model" (no argument needed).

6. **Update `buildWelcomeText`** — change `/model [name]` line to `/model - Browse and change AI model`.

### Error Handling

- **Index out of range:** Return `❌ Model not found. The model list may have changed. Use /model to browse again.`
- **`setModel` failure:** Catch and return `❌ Failed to set model: <error>`. Error messages go through `markdownToTelegramHTML` so angle brackets in error text are safely HTML-escaped by the converter.
- **No models available:** Return `⚠️ No models available. Check your API key configuration.` with no buttons.

### Changes to `bridge.ts`

No changes needed.

### Changes to `telegram.ts`

No changes needed.

## Tests

### Tests to Update in `tests/channel-bridge-commands.test.ts`

1. Update model-related parsing tests to handle new callback formats
2. Update the `/model` response test to check for buttons instead of text list
3. Update `parseCommand('/model provider/model-id')` test — should no longer parse the argument
4. Update `getCommandsForTelegram` test if description changed

### New Tests to Add

1. **Model list pagination**:
   - `/model` returns "Select a model" text and paginated buttons with model names
   - Current model shows ✓ prefix in button label
   - Navigation buttons appear when models exceed page size (>5)
   - `models:page:1` shows second page of models
   - Single page of models → no navigation row
   - No models available → warning message, no buttons

2. **Model selection flow**:
   - `models:select:3` shows model detail with provider, model name, current status
   - Detail view has "Use this model" and "Back" buttons
   - All dynamic values (provider, model name) are backtick-wrapped
   - `models:load:3` calls `agentManager.setModel` with correct provider and modelId
   - `models:load:3` returns confirmation with model name in backticks
   - `models:load:99` (out of range) returns error
   - `models:load:3` when `setModel` throws → returns friendly error

3. **Command parsing**:
   - `parseCommand('models:select:3')` → `{ type: 'model_select', index: 3 }`
   - `parseCommand('models:load:3')` → `{ type: 'model_load', index: 3 }`
   - `parseCommand('models:page:1')` → `{ type: 'model', page: 1 }`
   - `parseCommand('models:noop')` → noop
   - `parseCommand('list_models')` → `{ type: 'model', page: 0 }` (backward compat)
   - `parseCommand('/model')` → `{ type: 'model', page: 0 }` (no argument)
   - `parseCommand('/model some-model')` → should NOT set the model (returns `{ type: 'model', page: 0 }` ignoring args, or `undefined`)

4. **Edge cases**:
   - Only one model available → single button, no pagination, no navigation
   - Setting model that's already active → success message (no-op)
   - Model with ✓ prefix in detail view when it is the current model

5. **Markdown safety**:
   - Model provider/name with unusual characters in backticks renders safely

## Dependencies

- **Plan 02** must be implemented first to create the pagination utility in `src/channel-bridge/pagination.ts`. However, note that Plan 03 may require a minor enhancement to the utility: the `buttonData` callback needs access to the *global* index (not page-relative). If Plan 02's utility already provides this (recommended), no changes needed. If not, extend the utility's `buttonData` signature to `(item: T, globalIndex: number) => string`.

## Acceptance Criteria

- `/model` shows an interactive button-based model browser
- Models are paginated with the same utility as sessions
- Current model is visually marked with ✓ in button labels
- Tapping a model shows details with "Use this model" and "Back" buttons
- Model detail uses Markdown-safe formatting (backtick-wrapped values)
- Model setting works through the button flow
- `/model <name>` direct-set is removed
- Error cases (out of range, setModel failure, no models) are handled gracefully
- All tests updated and new tests cover the full flow
- `list_models` callback remains as backward-compatible alias
- Noop button (page indicator) is handled consistently with Plan 02
