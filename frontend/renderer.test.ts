import { describe, it, expect } from "vitest";
import { escapeHtml, renderMarkdown } from "./renderer";

// ---------------------------------------------------------------------------
// escapeHtml — pure function, no async
// ---------------------------------------------------------------------------

describe("escapeHtml", () => {
  it("escapes &", () => expect(escapeHtml("a & b")).toBe("a &amp; b"));
  it("escapes <", () => expect(escapeHtml("a < b")).toBe("a &lt; b"));
  it("escapes >", () => expect(escapeHtml("a > b")).toBe("a &gt; b"));
  it('escapes "', () => expect(escapeHtml('"quoted"')).toBe("&quot;quoted&quot;"));
  it("leaves clean text untouched", () => expect(escapeHtml("hello")).toBe("hello"));
  it("handles an empty string", () => expect(escapeHtml("")).toBe(""));
  it("escapes all special chars in one string", () =>
    expect(escapeHtml('<a href="x">test & demo</a>')).toBe(
      "&lt;a href=&quot;x&quot;&gt;test &amp; demo&lt;/a&gt;"
    ));
});

// ---------------------------------------------------------------------------
// renderMarkdown — async, uses dynamic imports for marked + highlight.js
// ---------------------------------------------------------------------------

describe("renderMarkdown", () => {
  it("renders a heading", async () => {
    const html = await renderMarkdown("# Hello");
    expect(html).toContain("<h1");
    expect(html).toContain("Hello");
  });

  it("renders bold text", async () => {
    const html = await renderMarkdown("**bold**");
    expect(html).toContain("<strong>bold</strong>");
  });

  it("renders a fenced code block with syntax highlighting", async () => {
    const html = await renderMarkdown("```js\nconst x = 1;\n```");
    expect(html).toContain("<pre>");
    expect(html).toContain("<code");
  });

  it("strips <script> tags", async () => {
    const html = await renderMarkdown("<script>alert(1)</script>");
    expect(html).not.toContain("<script");
  });

  it("removes inline event handlers", async () => {
    const html = await renderMarkdown('<img src="x" onerror="evil()">');
    expect(html).not.toMatch(/\sonerror\s*=/i);
  });
});
