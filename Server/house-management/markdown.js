'use strict';

// Minimal Markdown → HTML for the user guide (README.he.md).
// Supports: headings (with GitHub-style ids for the table of contents), paragraphs,
// bullet and numbered lists, block quotes, horizontal rules, **bold**, `code`,
// [links](url), and raw HTML blocks/inline tags (the guide is a trusted local file).

const slug = (text) => text
  .replace(/<[^>]+>/g, '')
  .trim()
  .toLowerCase()
  .replace(/[^\p{L}\p{N}\s-]/gu, '')
  .replace(/\s/g, '-');

const escapeAttr = (s) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;');

function inline(text) {
  return text
    .replace(/`([^`]+)`/g, (_, code) => `<code>${code.replace(/</g, '&lt;')}</code>`)
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, label, href) => `<a href="${escapeAttr(href)}">${label}</a>`);
}

function render(markdown) {
  const lines = markdown.replace(/\r\n?/g, '\n').split('\n');
  const out = [];
  let paragraph = [];
  let list = null; // { tag: 'ul' | 'ol', items: [] }

  const flushParagraph = () => {
    if (paragraph.length) out.push(`<p>${paragraph.map(inline).join('<br>\n')}</p>`);
    paragraph = [];
  };
  const flushList = () => {
    if (list) out.push(`<${list.tag}>\n${list.items.map((i) => `  <li>${inline(i)}</li>`).join('\n')}\n</${list.tag}>`);
    list = null;
  };
  const flush = () => { flushParagraph(); flushList(); };

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    let m;

    if (!line.trim()) { flush(); continue; }

    // Raw HTML block: passes through until the next blank line.
    if (/^\s*<\/?[a-z]/i.test(line) && !paragraph.length) {
      flush();
      while (i < lines.length && lines[i].trim()) out.push(lines[i++]);
      continue;
    }

    if ((m = line.match(/^(#{1,6})\s+(.*)$/))) {
      flush();
      const level = m[1].length;
      out.push(`<h${level} id="${escapeAttr(slug(m[2]))}">${inline(m[2])}</h${level}>`);
      continue;
    }

    if (/^\s*(-{3,}|\*{3,})\s*$/.test(line)) { flush(); out.push('<hr>'); continue; }

    if ((m = line.match(/^>\s?(.*)$/))) {
      flush();
      out.push(`<blockquote><p>${inline(m[1])}</p></blockquote>`);
      continue;
    }

    if ((m = line.match(/^\s*(?:[-*]|(\d+)\.)\s+(.*)$/))) {
      flushParagraph();
      const tag = m[1] ? 'ol' : 'ul';
      if (list && list.tag !== tag) flushList();
      if (!list) list = { tag, items: [] };
      list.items.push(m[2]);
      continue;
    }

    flushList();
    paragraph.push(line.trim());
  }
  flush();
  return out.join('\n');
}

module.exports = { render };
