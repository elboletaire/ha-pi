/**
 * Message formatting utilities for channel adapters.
 * Shared between Telegram adapter and bridge for consistent message formatting.
 */

/**
 * Format a source label into a unified message header.
 *
 * Examples:
 *   "🤖 anthropic/claude-opus-4-6" → "🧠 Pi · opus-4-6\n───"
 *   "cron:daily-standup"           → "⏰ cron:daily-standup\n───"
 *   "channel:test"                 → "🏓 test\n───"
 */
export function formatSourceHeader(source: string): string {
  // Agent reply: "🤖 provider/model" or "🤖 model"
  if (source.startsWith('🤖')) {
    const modelRaw = source.replace(/^🤖\s*/, '')
    const short = modelRaw.includes('/') ? modelRaw.split('/').pop()! : modelRaw
    return `🧠 Pi · ${short}\n───\n`
  }

  // Cron job: "cron:job-name"
  if (source.startsWith('cron:')) {
    return `⏰ ${source}\n───\n`
  }

  // Channel test: "channel:test"
  if (source.startsWith('channel:')) {
    const label = source.replace('channel:', '')
    return `🏓 ${label}\n───\n`
  }

  // Fallback: use source as-is
  return `📨 ${source}\n───\n`
}

/**
 * Convert Markdown to Telegram HTML format.
 * Supports: bold, italic, code, code blocks, headers, links, lists, tables.
 * Escapes HTML special characters to prevent breaking Telegram's parser.
 */
export function markdownToTelegramHTML(text: string): string {
  const escapeHTML = (str: string) => str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

  // Step 1: Protect code blocks FIRST — must happen before inline code so that
  // backticks inside triple-backtick fences are not extracted as inline code spans.
  const codeBlocks: string[] = []
  let result = text.replace(/```([\s\S]*?)```/g, (match, code) => {
    const placeholder = `___CODEBLOCK_${codeBlocks.length}___`
    codeBlocks.push(`<pre>${escapeHTML(code.trim())}</pre>`)
    return placeholder
  })

  // Step 2: Protect inline code — safe now because triple-backtick regions are already
  // replaced with placeholders, so their content cannot be captured here.
  const inlineCodes: string[] = []
  result = result.replace(/`([^`]+)`/g, (match, code) => {
    const placeholder = `___INLINECODE_${inlineCodes.length}___`
    inlineCodes.push(`<code>${escapeHTML(code)}</code>`)
    return placeholder
  })

  // Step 3: Convert Markdown tables to aligned text
  const tables: string[] = []
  result = result.replace(/(?:^\|.+\|$\n?)+/gm, (match) => {
    const placeholder = `___TABLE_${tables.length}___`
    tables.push(convertMarkdownTable(match))
    return placeholder
  })

  // Step 4: Escape remaining HTML in non-code content
  result = escapeHTML(result)

  // Step 5: Convert remaining Markdown to HTML
  let html = result

  // Headers (### Header → <b>Header</b>)
  html = html.replace(/^#{1,6}\s+(.+)$/gm, '<b>$1</b>')

  // Bold (**text** only — __text__ is intentionally omitted because double underscores
  // appear in URLs, file paths, and Python dunder methods and must not be bolded)
  html = html.replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')

  // Italic (*text* or _text_) - use word boundary checks to avoid URLs
  html = html
    .replace(/(?<!\w)\*(.+?)\*(?!\w)/g, '<i>$1</i>')
    .replace(/(?<!\w)(?<!_)_(?!_)(.+?)(?<!_)_(?!_)(?!\w)/g, '<i>$1</i>')

  // Links [text](url) → <a href="url">text</a>
  html = html.replace(/\[(.+?)\]\((.+?)\)/g, '<a href="$2">$1</a>')

  // Step 6: Restore protected content (tables, code blocks, inline code)
  tables.forEach((table, i) => {
    html = html.replace(`___TABLE_${i}___`, table)
  })
  codeBlocks.forEach((code, i) => {
    html = html.replace(`___CODEBLOCK_${i}___`, code)
  })
  inlineCodes.forEach((code, i) => {
    html = html.replace(`___INLINECODE_${i}___`, code)
  })

  return html
}

function convertMarkdownTable(tableText: string): string {
  const lines = tableText.trim().split('\n')
  if (lines.length < 2) return tableText

  const rows = lines
    .filter((line) => !line.match(/^\s*\|?\s*[-:|\s]+\|?\s*$/))
    .map((line) =>
      line
        .split('|')
        .map((cell) => cell.trim())
        .filter((cell) => cell !== '')
    )

  if (rows.length === 0) return tableText

  const numCols = Math.max(...rows.map((r) => r.length))
  const colWidths: number[] = []
  for (let i = 0; i < numCols; i++) {
    const maxWidth = Math.max(...rows.map((r) => (r[i] || '').length))
    colWidths.push(maxWidth)
  }

  const alignedRows = rows.map((row) => {
    const cells = row.map((cell, colIdx) => cell.padEnd(colWidths[colIdx], ' '))
    return cells.join('  ').trimEnd()
  })

  const separator = '─'.repeat(alignedRows[0].length)
  alignedRows.splice(1, 0, separator)

  return `<pre>${alignedRows.join('\n')}</pre>`
}
