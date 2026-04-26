# Plan: Revamp /sessions to Button-Based Pagination

## Problem

The current `/sessions` command renders a text-based list with `/s<id>` command links. This is fragile (the `/s[0-9a-f]+` regex parsing is complex), visually cluttered, and not user-friendly on mobile. We want a fully button-driven flow for session browsing and selection.

## Current Behavior

1. `/sessions` → text list with `/s<id>` links and preview quotes
2. User taps `/s<id>` → session switches immediately
3. `parseCommand` has special `/s[0-9a-f]{6,}` regex and `session:` callback prefix parsing

## Target Behavior

### Step 1: Session List (paginated)

When user sends `/sessions` (or taps "📚 Sessions" button, or `list_sessions` callback):

**Message text:** `📚 Select a session to load`

**Buttons (inline keyboard):** A paginated list of sessions, each button showing a truncated preview of the session's first message (or short ID + message count if no preview). Page size: 5 sessions per page.

Layout:
```
[ "What does this code do in se…"  ]    ← row 1: session button
[ "Fix the login bug in auth mo…"  ]    ← row 2: session button
[ "Add pagination to the UI"       ]    ← row 3: session button
[ "Debug WebSocket reconnection…"  ]    ← row 4: session button
[ "Refactor the build pipeline"    ]    ← row 5: session button
[    ← Page 1/3    →    ]               ← navigation row
```

Each session button's `callback_data` encodes the session ID: `sessions:select:<short_id>` (e.g. `sessions:select:019dc5e5`).

Navigation buttons:
- `←` with callback `sessions:page:<N-1>` (hidden on first page — don't render the button at all)
- Page indicator: a non-functional button with text like `1/3` and callback_data `sessions:noop` (Telegram requires callback_data on inline buttons; the handler ignores this callback)
- `→` with callback `sessions:page:<N+1>` (hidden on last page)
- When there's only one page, don't render the navigation row at all

When there are 0 sessions, show text "No sessions found." with a single `[🆕 New session]` button.

### Step 2: Session Detail (confirmation)

When a session button is tapped (callback `sessions:select:<id>`):

**Message text:** Session details (using the Markdown-safe patterns from Plan 01):
```
📚 Session details

**ID:** `019dc5e5`
**Messages:** 22
**Modified:** `4/25/2026, 10:32 PM`
**Preview:** `What does this code do in server.ts?`
```

All dynamic string values (ID, date, preview) are wrapped in backticks to prevent Markdown injection (see Plan 01 for rationale — session preview text can contain `*`, `_`, `` ` `` from user messages).

**Buttons:**
```
[ ✅ Load session ]   [ ← Back ]
```

- `✅ Load session` → callback `sessions:load:<id>` — performs the actual session switch, then sends the success message (similar to current `handleSessionCommand`)
- `← Back` → callback `sessions:page:0` — goes back to the session list page 0

### Step 3: Session Load Confirmation

When `sessions:load:<id>` is triggered, load the session and respond with (matching Plan 01 format):

```
✅ Switched to session.

**ID:** `019dc5e5`
**Model:** `anthropic/claude-sonnet-4-5-20250929`
**Messages:** 3
**Latest message:** `Last message from the user`
```

No buttons (clean state after loading).

### Step 4: Remove Legacy Command Parsing

Remove:
- The `/s[0-9a-f]{6,}` regex shortcut parsing in `parseTelegramCommand`
- The `session:` prefix callback parsing in `parseTelegramCommand`
- The `/session <ID>` command from `parseCommand` return types and the `getCommandsForTelegram` list
- The `buildSessionListText` function (no longer needed — replaced by button layout)

Keep:
- The `handleSessionCommand` function is refactored (not removed) — it will be used by `sessions:load:<id>` internally
- The `/delete <ID>` command remains unchanged for now

## Implementation

### New Pagination Utility

Create a reusable pagination module at `src/channel-bridge/pagination.ts`:

```
interface PaginationConfig<T> {
  items: T[]
  page: number
  pageSize: number
  callbackPrefix: string  // e.g. "sessions" or "models"
  buttonLabel: (item: T) => string
  buttonData: (item: T) => string
}

interface PaginatedResult {
  buttons: InlineKeyboardButton[][]
  page: number
  totalPages: number
}
```

This function takes items, page number, and config, and returns the paginated button rows including navigation. This will be reused by the `/model` command later.

Import `InlineKeyboardButton` from `./types` to type the output.

**Navigation row logic:**
- Calculate `totalPages = Math.ceil(items.length / pageSize)`
- Clamp requested `page` to `[0, totalPages - 1]`
- Slice items for current page: `items.slice(page * pageSize, (page + 1) * pageSize)`
- Build one button row per item: `[{ text: buttonLabel(item), callback_data: buttonData(item) }]`
- If `totalPages > 1`, append navigation row with conditional `←` / page indicator / `→`
- `←` button: `{ text: '←', callback_data: '<prefix>:page:<page-1>' }` — only if `page > 0`
- Page indicator: `{ text: '<page+1>/<totalPages>', callback_data: '<prefix>:noop' }`
- `→` button: `{ text: '→', callback_data: '<prefix>:page:<page+1>' }` — only if `page < totalPages - 1`

### Changes to `commands.ts`

1. **Remove `buildSessionListText`** — replaced by button-based flow.

2. **Refactor `handleSessionsCommand`** — accept optional `page` parameter (default 0). Return `CommandResult` with the paginated button layout. Use the pagination utility with:
   - `callbackPrefix: 'sessions'`
   - `buttonLabel: (s) => truncate(s.firstMessage || s.id.slice(0, 8), 40)` — truncate to 40 chars to fit Telegram button widths
   - `buttonData: (s) => 'sessions:select:' + s.id.slice(0, 8)`

3. **Add `handleSessionSelectCommand(agentManager, shortId)`** — find session by short ID prefix, show session detail with "Load" and "Back" buttons. Uses the Markdown-safe backtick pattern for all dynamic values.

4. **Refactor `handleSessionCommand`** — keep the core logic (find session, switch, get state, get latest message) but accept being called from the `sessions:load:` callback path. The match logic should accept short ID prefix (>= 6 chars, matching current behavior).

5. **Update `parseTelegramCommand`**:
   - Add parsing for `sessions:select:<id>`, `sessions:load:<id>`, `sessions:page:<N>` callbacks
   - Add `sessions:noop` → ignored (returns a no-op command or `undefined`)
   - Remove the `/s[0-9a-f]{6,}` regex shortcut
   - Remove the `session:` prefix callback parsing

6. **Update `parseCommand` return types** — add new types:
   - `{ type: 'sessions'; page?: number }` — page parameter for paginated list
   - `{ type: 'session_select'; id: string }` — session detail view
   - `{ type: 'session_load'; id: string }` — confirm and load session
   - Remove standalone `{ type: 'session'; path: string }` (sessions are now loaded via `session_load`)

7. **Update `processCommand`** — route new types to their handlers.

8. **Update `getCommandsForTelegram`** — remove `/session` from the bot command menu (sessions are now managed via buttons from `/sessions`). Keep `/delete` for now.

9. **Update `buildWelcomeText`** — remove `/session <ID>` line since it's no longer a user-facing command.

10. **Handle `sessions:noop`** — when the page indicator button is tapped, either return `undefined` from `parseCommand` (message is ignored) or return a minimal `CommandResult` with empty text. Since the callback_query must be answered (already handled by `answerCallbackQuery` in `telegram.ts`), returning `undefined` from `parseCommand` means the bridge will try to process it as a prompt. Better: add a `{ type: 'noop' }` return type and handle it in `processCommand` by returning `null` (no response sent).

### Changes to `bridge.ts`

No structural changes needed. The bridge already routes `CommandResult` with `markup` to `sendMessage`, which passes it through to the adapter. The new button callbacks will be received as `callback_query` updates, routed through `parseTelegramCommand` → `processCommand` like existing callbacks.

**One concern:** `handleIncomingMessage` sends the command text back if `processCommand` returns `null`. With `sessions:noop` returning `null`, the bridge would try to send "sessions:noop" as a prompt to the agent. Solutions:
- Return a no-op `CommandResult` like `{ text: '' }` — but empty text might fail in Telegram API
- Better: in `parseTelegramCommand`, match `sessions:noop` and return `undefined` — but then it falls through to the agent prompt path in the bridge.
- Best: add explicit handling in the bridge: if callback data starts with a known prefix and `processCommand` returns null, skip prompt processing. OR: return a `CommandResult` with an empty text that the bridge detects and skips sending.

**Simplest solution:** have `processCommand` return `{ text: '' }` for noop, and in `bridge.ts`'s `handleIncomingMessage`, skip `sendMessage` when `command.text` is empty. This is a minimal change.

### Changes to `telegram.ts`

No changes needed. The adapter already handles `callback_query` with `answerCallbackQuery` and routes `cbq.data` as text through `onMessage`. The new `sessions:select:*` and `sessions:page:*` callback data strings will be parsed by `parseTelegramCommand`.

## Tests

### Tests to Remove/Update in `tests/channel-bridge-commands.test.ts`

1. **Remove**: "parses /s<id> shortcut as a session switch" test
2. **Remove**: "does NOT parse /s<id> if the hex id is shorter than 6 chars" test
3. **Remove/Update**: "does NOT confuse /status or /sessions with the /s<id> shortcut" — remove the `/sessions` vs `/s<id>` assertion; keep `/status` assertion if needed
4. **Replace**: "renders /s<id> links and first-message previews" → replace with a test for paginated buttons
5. **Update**: "shows a hint when there are no sessions" → check for "No sessions found." text and a "🆕 New session" button
6. **Update**: "handleSessionCommand" test → update to test `sessions:load:<id>` flow, with Markdown assertions (from Plan 01)
7. **Update**: command parsing tests to include new callback data formats
8. **Update**: `getCommandsForTelegram` test — remove `/session` from expected command list
9. **Update**: welcome/help text test if it checks for `/session <ID>` line

### New Tests to Add

1. **Pagination utility tests** (`tests/pagination.test.ts`):
   - Paginates items correctly (first page, middle page, last page)
   - Handles single page (no navigation row rendered)
   - Handles empty items list (returns no buttons)
   - Shows `←` only when not on first page
   - Shows `→` only when not on last page
   - Clamps page number to valid range (e.g. page=99 on 3-page list → shows page 2)
   - Button labels are truncated correctly
   - `callback_data` is built correctly with the configured prefix
   - Page indicator shows correct `page+1/totalPages` text
   - Noop callback data is set on page indicator button

2. **Session list command tests** (in `tests/channel-bridge-commands.test.ts`):
   - `/sessions` returns "Select a session to load" text and paginated buttons with session previews
   - `/sessions` with >5 sessions shows navigation buttons on first page (no ←, has →)
   - `sessions:page:1` shows second page of sessions (has ←, may or may not have →)
   - Last page has ← but no →
   - Session button labels use truncated `firstMessage` (or short ID if no firstMessage)
   - Empty session list shows "No sessions found" with "🆕 New session" button

3. **Session select/load flow tests**:
   - `sessions:select:<id>` shows session detail with all fields in Markdown-safe format (backtick-wrapped dynamic values)
   - `sessions:select:<id>` includes "Load session" and "Back" buttons
   - `sessions:select:<invalid_id>` returns error message
   - `sessions:load:<id>` switches session and returns success message (Markdown formatted per Plan 01)
   - `sessions:load:<invalid_id>` returns error message

4. **Noop handling tests**:
   - `sessions:noop` returns empty/no-op result
   - Bridge does not send a message for empty command text

5. **Command parsing tests**:
   - `parseCommand('sessions:select:019dc5e5')` → `{ type: 'session_select', id: '019dc5e5' }`
   - `parseCommand('sessions:load:019dc5e5')` → `{ type: 'session_load', id: '019dc5e5' }`
   - `parseCommand('sessions:page:2')` → `{ type: 'sessions', page: 2 }`
   - `parseCommand('sessions:noop')` → noop handling
   - Old `/s<id>` format no longer parses as session command (returns undefined)
   - Old `session:xyz` format no longer parses (returns undefined)

6. **Markdown safety in session detail** (`tests/message-format.test.ts` or inline):
   - Session preview containing `*bold*` → appears literally inside backticks, not as italic
   - Session preview containing backticks → nested backticks are tricky; test that content inside backticks with internal backticks is handled (may need double-backtick wrapping or the internal backtick stripped/escaped)

### Edge Case: Backticks Inside Session Preview

If a user's first message is `` Use `git commit` to save ``, the preview text contains backticks. Wrapping this in backticks produces ``` ``Use `git commit` to save`` ``` — Telegram HTML uses `<code>` which doesn't have nesting issues (HTML-escaped). But `markdownToTelegramHTML` uses the regex `` /`([^`]+)`/g `` which would match the inner backticks first, breaking the outer wrapping.

**Mitigation:** Before wrapping in backticks, strip or replace any backtick characters in the dynamic value: `value.replace(/`/g, "'")`. This is a simple, safe transformation since backticks in a preview are cosmetic. Add this to the `truncate` call chain in the session detail builder.

## Risks

- **Callback data size limit**: Telegram limits `callback_data` to 64 bytes. Session IDs (8-char short IDs) plus prefix like `sessions:select:` = 25 bytes, well within limit.
- **Session list ordering**: Current `listSessions()` returns sessions ordered by `modified` date (most recent first). This ordering should be preserved in pagination.
- **Race condition**: A session could be deleted between showing the list and tapping "Load". The `handleSessionCommand` already handles "session not found" — this error path should carry through to the button flow.
- **Backticks in dynamic content**: Addressed with stripping (see edge case above).

## Acceptance Criteria

- `/sessions` shows an interactive button-based session browser
- Sessions are paginated (5 per page) with `←`/`→` navigation
- Navigation row is hidden when there's only one page
- Tapping a session shows details with "Load" and "Back" buttons
- Session detail uses Markdown-safe formatting (backtick-wrapped dynamic values)
- "Load session" switches to the session and shows confirmation
- `/s<id>` shortcut and `/session <ID>` command are removed
- All old tests are updated; new tests cover pagination, full flow, and edge cases
- The pagination utility is reusable (prepared for `/model` command)
- Page indicator noop button is handled gracefully (no message sent, no prompt triggered)
- Backticks in dynamic preview text are handled (stripped before wrapping)
