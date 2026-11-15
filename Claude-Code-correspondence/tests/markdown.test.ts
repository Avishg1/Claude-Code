import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { Markdown, safeHref } from '../src/client/markdown';

const render = (text: string) => renderToStaticMarkup(createElement(Markdown, { text }));

describe('safeHref', () => {
  it.each([
    ['javascript:alert(1)', null],
    ['JAVASCRIPT:alert(1)', null],
    [' javascript:alert(1)', null],
    ['java\nscript:alert(1)', null],
    ['data:text/html;base64,AAAA', null],
    ['vbscript:msgbox(1)', null],
    ['file:///C:/Windows/win.ini', null],
    ['../../etc/passwd', null],
    ['//evil.example/x', null],
    ['https://example.org/a?b=1', 'https://example.org/a?b=1'],
    ['http://example.org/', 'http://example.org/'],
    ['mailto:someone@example.org', 'mailto:someone@example.org'],
  ])('%s -> %s', (input, expected) => {
    expect(safeHref(input)).toBe(expected);
  });
});

describe('Markdown rendering is inert', () => {
  const hostileLine = readFileSync(
    path.resolve(__dirname, '..', 'fixtures', 'projects', 'E--demo-edge-cases', 'hostile-markdown.jsonl'),
    'utf8',
  ).split('\n')[0]!;
  const hostile = (JSON.parse(hostileLine) as { message: { content: string } }).message.content;
  const html = render(hostile);

  it('emits no executable or remote-loading elements', () => {
    expect(html).not.toMatch(/<script/i);
    expect(html).not.toMatch(/<img/i);
    expect(html).not.toMatch(/<iframe/i);
    // Attribute checks only look inside real tags (escaped text like "onerror=&quot;" is fine).
    expect(html).not.toMatch(/<[^>]*\son[a-z]+=/i);
    expect(html).not.toMatch(/href="(javascript|data|vbscript|file):/i);
    expect(html).not.toMatch(/<[^>]*\ssrc=/i);
  });

  it('keeps the hostile text visible as escaped text', () => {
    expect(html).toContain('&lt;script&gt;window.__pwned = 1&lt;/script&gt;');
    expect(html).toContain('תמונה (לא נטענה)');
    expect(html).toContain('https://evil.example/track.png'); // shown as text, not loaded
  });

  it('renders the safe link with isolation attributes', () => {
    expect(html).toMatch(
      /<a href="https:\/\/example\.org\/page\?q=1" target="_blank" rel="noopener noreferrer nofollow" referrerPolicy="no-referrer"/,
    );
    // Only the single safe link becomes an anchor.
    expect(html.match(/<a /g)).toHaveLength(1);
  });

  it('renders fenced code as escaped LTR text with a language label and copy button', () => {
    const out = render('```ts\nconst a = 1 < 2;\n```');
    expect(out).toContain('<pre dir="ltr"');
    expect(out).toContain('const a = 1 &lt; 2;');
    expect(out).toContain('>ts<');
    expect(out).toContain('העתקה');
  });

  it('preserves single line breaks and paragraphs, with auto direction', () => {
    const out = render('שורה אחת\nline two\n\nפסקה שנייה');
    expect(out).toBe('<div class="md"><p dir="auto">שורה אחת<br/>line two</p><p dir="auto">פסקה שנייה</p></div>');
  });
});
