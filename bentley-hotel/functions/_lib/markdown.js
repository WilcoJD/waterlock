/**
 * A small Markdown-to-HTML converter for blog posts. Supports headings, paragraphs, bold, italic,
 * inline code, links, images, ordered and unordered lists, blockquotes, horizontal rules, fenced code
 * blocks and hard line breaks. Raw HTML in the source is escaped, so posts cannot inject scripts.
 */

export function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function safeUrl(u) {
  const t = String(u || "").trim();
  if (/^(javascript|data|vbscript):/i.test(t)) return "#";
  return escapeHtml(t);
}

export function inline(text) {
  let s = escapeHtml(text);
  // code spans first, so their contents are left alone
  const codes = [];
  s = s.replace(/`([^`]+)`/g, (_, c) => { codes.push(c); return `\u0000${codes.length - 1}\u0000`; });
  s = s.replace(/!\[([^\]]*)\]\(([^)\s]+)(?:\s+"([^"]*)")?\)/g, (_, alt, src, title) =>
    `<img src="${safeUrl(src)}" alt="${alt}"${title ? ` title="${title}"` : ""} loading="lazy">`);
  s = s.replace(/\[([^\]]+)\]\(([^)\s]+)(?:\s+"([^"]*)")?\)/g, (_, label, href, title) => {
    const ext = /^https?:\/\//i.test(href) ? ' rel="noopener"' : "";
    return `<a href="${safeUrl(href)}"${title ? ` title="${title}"` : ""}${ext}>${label}</a>`;
  });
  s = s.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>").replace(/__([^_]+)__/g, "<strong>$1</strong>");
  s = s.replace(/(^|[^*\w])\*([^*\n]+)\*(?!\w)/g, "$1<em>$2</em>").replace(/(^|[^_\w])_([^_\n]+)_(?!\w)/g, "$1<em>$2</em>");
  s = s.replace(/ {2,}\n/g, "<br>\n");
  s = s.replace(/\u0000(\d+)\u0000/g, (_, i) => `<code>${codes[Number(i)]}</code>`);
  return s;
}

export function markdownToHtml(md) {
  const lines = String(md || "").replace(/\r\n?/g, "\n").split("\n");
  const out = [];
  let i = 0;
  const para = [];
  const flush = () => {
    if (para.length) { out.push(`<p>${inline(para.join("\n"))}</p>`); para.length = 0; }
  };
  while (i < lines.length) {
    const line = lines[i];
    if (/^\s*$/.test(line)) { flush(); i++; continue; }
    const fence = /^```(\w+)?\s*$/.exec(line);
    if (fence) {
      flush();
      const buf = [];
      i++;
      while (i < lines.length && !/^```\s*$/.test(lines[i])) buf.push(lines[i++]);
      i++;
      out.push(`<pre><code${fence[1] ? ` class="language-${escapeHtml(fence[1])}"` : ""}>${escapeHtml(buf.join("\n"))}</code></pre>`);
      continue;
    }
    const h = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line);
    if (h) { flush(); const lvl = Math.min(6, h[1].length + 1); out.push(`<h${lvl}>${inline(h[2])}</h${lvl}>`); i++; continue; }
    if (/^(?:-{3,}|\*{3,}|_{3,})\s*$/.test(line)) { flush(); out.push("<hr>"); i++; continue; }
    if (/^>\s?/.test(line)) {
      flush();
      const buf = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) buf.push(lines[i++].replace(/^>\s?/, ""));
      out.push(`<blockquote>${markdownToHtml(buf.join("\n"))}</blockquote>`);
      continue;
    }
    const li = /^(\s*)([-*+]|\d+[.)])\s+(.+)$/.exec(line);
    if (li) {
      flush();
      const ordered = /\d/.test(li[2]);
      const items = [];
      while (i < lines.length) {
        const m = /^(\s*)([-*+]|\d+[.)])\s+(.+)$/.exec(lines[i]);
        if (!m || /\d/.test(m[2]) !== ordered) break;
        let text = m[3];
        i++;
        while (i < lines.length && /^\s{2,}\S/.test(lines[i]) && !/^\s*([-*+]|\d+[.)])\s+/.test(lines[i])) text += "\n" + lines[i++].trim();
        items.push(`<li>${inline(text)}</li>`);
      }
      out.push(`<${ordered ? "ol" : "ul"}>${items.join("")}</${ordered ? "ol" : "ul"}>`);
      continue;
    }
    para.push(line);
    i++;
  }
  flush();
  return out.join("\n");
}

/** Plain-text excerpt (first N characters) from Markdown, for listings and meta descriptions. */
export function excerptFromMarkdown(md, max = 160) {
  const text = String(md || "")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/[#>*_`]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (text.length <= max) return text;
  return text.slice(0, max - 1).replace(/\s+\S*$/, "") + "…";
}
