# Plan: Fix HTML Tags Showing in Session Switch Message

## Problem

When switching sessions via `/session <ID>`, the response message contains raw HTML tags like `<b>ID:</b>` that are displayed as literal text instead of being rendered as bold. This happens because the message is built with HTML tags in `commands.ts` (`handleSessionCommand`), but the bridge's `sendMessage` path in `bridge.ts` passes the text through `markdownToTelegramHTML()` in the adapter's `send()` method (`telegram.ts`), which HTML-escapes `<` and `>` characters as `&lt;` and `&gt;` before any HTML conversion takes place.

## Root Cause

In `src/channel-bridge/commands.ts`, `handleSessionCommand` (line ~157) builds the response using raw HTML tags:

```
<b>ID:</b> 019dc5e5
<b>Model:</b> anthropic/claude-sonnet-4-5-20250929
```

The message then flows through the bridge's `sendMessage` → adapter `send()` → `markdownToTelegramHTML()`, which escapes all `<` and `>` in non-code content at step 4. The HTML tags get double-escaped and appear as raw text.

The `/new` command avoids this by using Markdown backticks instead of HTML tags (e.g. `` `019dc5e5` ``), which survives the Markdown-to-HTML conversion correctly.

## Solution

Replace the HTML tags in `handleSessionCommand`'s response with Markdown formatting. Use `**ID:**` instead of `<b>ID:</b>`. The `markdownToTelegramHTML` converter already handles `**text**` → `<b>text</b>` correctly.

### Critical: Dynamic Content Must Be Escaped

The `markdownToTelegramHTML` function interprets Markdown syntax in ALL input text, including dynamic values. Session previews, error messages, and model names may contain `*`, `_`, or `` ` `` characters that would be misinterpreted as Markdown formatting. For example:

- A user's first message `"Fix the *important* bug in **main.py**"` would render `important` as italic and `main.py` as bold in the preview
- An error message like `"*args is not defined"` would italicize `args is not defined`
- Python `**kwargs` gets partially mangled into `<i>args and </i>*kwargs`

**Add an `escapeMarkdown` utility** that escapes `*`, `_`, `` ` ``, `[`, and `]` characters in dynamic text values before they are interpolated into Markdown templates. This is the Markdown equivalent of the existing `escapeHtml` function.

```
function escapeMarkdown(text: string): string {
  return text.replace(/([*_`\[\]])/g, '\\$1')
}
```

Note: verify that `markdownToTelegramHTML` respects backslash-escaped characters. Looking at the current implementation, it does NOT — the regex patterns like `/\*\*(.+?)\*\*/g` would still match `\*\*text\*\*`. This means backslash escaping won't work with the current converter.

**Alternative approach:** wrap dynamic content in inline code backticks where appropriate (backtick content is extracted and protected before Markdown processing). For values that should NOT be in code format (like the latest message preview), the dynamic content needs to be inserted AFTER the Markdown→HTML conversion, or the converter needs to support a placeholder/escape mechanism.

**Recommended solution — placeholder approach:**

1. Add an `escapeMarkdown` function that replaces Markdown-significant characters (`*`, `_`, `` ` ``) with Unicode look-alike characters or HTML entities (since the output is HTML). But this is fragile.

2. **Better: a two-phase approach.** Command handlers produce a *structured* template where dynamic values are marked as literal. Before `markdownToTelegramHTML` is called, the dynamic values are swapped with placeholders (like `___DYN_0___`). After conversion, the placeholders are replaced with the HTML-escaped dynamic values.

3. **Simplest practical approach:** For THIS specific fix (Plan 01), keep it scoped:
   - Session ID and Model → already safe in backticks (code spans are protected)
   - Message count → numeric, no special chars
   - Latest message → **this is the problematic value**. Wrap it in backticks too (shows in code style), OR truncate and apply `escapeHtml` after conversion

Actually, re-examining the pipeline: the command text goes through `markdownToTelegramHTML` which produces HTML. Telegram then renders that HTML. So the safest approach for dynamic text that shouldn't be interpreted as Markdown is:

**Use backtick wrapping for all dynamic string values** — inline code spans are extracted and HTML-escaped before Markdown processing (see `message-format.ts` lines 57-60). This means any content inside backticks is safe from both Markdown interpretation and HTML injection.

For the latest message preview, backtick wrapping may look odd for a long sentence. An alternative is to not display it as code but accept that markdown chars in previews might cause minor formatting artifacts (bold/italic on accidental patterns). This is acceptable for previews since the stakes are low — it's a cosmetic issue in an informational message.

### Changes

**`src/channel-bridge/commands.ts`** — `handleSessionCommand` return value:

Change the response text array to use Markdown `**bold**` for field labels. Use backtick wrapping for session ID and model (these are identifiers that look natural in code style). Leave message count as plain number. For the latest message preview, wrap in backticks for safety.

The result text should be:
```
✅ Switched to session.

**ID:** `019dc5e5`
**Model:** `anthropic/claude-sonnet-4-5-20250929`
**Messages:** 3
**Latest message:** `Last message from the user`
```

Remove the `escapeHtml()` calls — they're no longer needed since backticks provide escaping, and `markdownToTelegramHTML` HTML-escapes remaining content.

**Also fix `handleNewCommand`** for consistency: the `/new` response currently uses plain "ID:" and "Model:" without bold. Update to:
```
✅ New session created.

**ID:** `019dc5e5`
**Model:** `anthropic/claude-sonnet-4-5`
```

**Document the pattern:** Add a comment at the top of `commands.ts` explaining:
- Command responses use Markdown syntax (processed by `markdownToTelegramHTML` downstream)
- Dynamic string values should be wrapped in backticks to prevent Markdown injection
- Numeric values are safe to include directly

### Tests to Update

**`tests/channel-bridge-commands.test.ts`** — `handleSessionCommand` test (line ~113):

Update four assertions to check Markdown output:
- `result?.text` should contain `` **ID:** `019dc5e5` ``
- `result?.text` should contain `` **Model:** `anthropic/claude-sonnet-4-5-20250929` ``
- `result?.text` should contain `**Messages:** 3`
- `result?.text` should contain `` **Latest message:** `Last message from the user` ``

**`tests/channel-bridge-commands.test.ts`** — `handleNewCommand` test:

Update to check for bold labels:
- `result.text` should contain `` **ID:** `019dc5e5` ``
- `result.text` should contain `**Model:**`

### New Tests to Add

**`tests/message-format.test.ts`** — add tests verifying command-style messages render correctly:

1. **Bold labels with backtick values survive conversion**:
   - Input: `` **Model:** `anthropic/claude-sonnet-4-5` ``
   - Expected output: `<b>Model:</b> <code>anthropic/claude-sonnet-4-5</code>`

2. **Dynamic text in backticks is safe from Markdown interpretation**:
   - Input: `` **Preview:** `Fix the *important* bug in **main.py**` ``
   - Expected: `<b>Preview:</b> <code>Fix the *important* bug in **main.py**</code>` (asterisks preserved literally inside code)

3. **Dynamic text WITHOUT backticks gets Markdown-interpreted** (documenting the risk):
   - Input: `**Preview:** Fix the *important* bug`
   - Expected: `<b>Preview:</b> Fix the <i>important</i> bug` (unwanted italic)
   - This test documents WHY backtick wrapping is needed for dynamic content

4. **Numeric values are safe without backticks**:
   - Input: `**Messages:** 42`
   - Expected: `<b>Messages:</b> 42`

## Acceptance Criteria

- Session switch message renders field names in bold in Telegram
- No raw HTML tags visible in any command response
- Dynamic string values (session ID, model, latest message) are in backtick code style, protecting against Markdown injection
- `/new` command formatting is consistent with session switch
- All existing tests pass with updated assertions
- New message-format tests document the backtick safety pattern
- The `escapeHtml` function is not removed from the module (may be used elsewhere)
