/**
 * Markdown renderer using marked + highlight.js.
 * Loaded lazily to avoid blocking initial paint.
 */

let _marked: typeof import('marked').marked | null = null
let _hljs: typeof import('highlight.js').default | null = null

async function getMarked() {
  if (!_marked) {
    const mod = await import('marked')
    const hljsMod = await import('highlight.js')
    _hljs = hljsMod.default

    mod.marked.setOptions({
      async: false,
    })

    // Code highlighting extension
    const renderer = new mod.Renderer()
    renderer.code = ({ text, lang }) => {
      const language = lang && _hljs!.getLanguage(lang) ? lang : 'plaintext'
      const highlighted = _hljs!.highlight(text, { language }).value
      return `<pre><code class="hljs language-${language}">${highlighted}</code></pre>`
    }
    mod.marked.use({ renderer })
    _marked = mod.marked
  }
  return _marked
}

export async function renderMarkdown(text: string): Promise<string> {
  const marked = await getMarked()
  const html = marked(text) as string
  // Basic sanitisation: strip script tags and dangerous attributes.
  // For a full sanitiser, DOMPurify would be ideal but adds bundle weight.
  return html.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/\son\w+\s*=/gi, ' data-removed=')
}

export function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}
