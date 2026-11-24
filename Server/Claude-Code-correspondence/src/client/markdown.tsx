/**
 * Safe Markdown rendering.
 *
 * markdown-it is used only as a tokenizer (raw HTML disabled). Tokens are converted to React
 * elements from a fixed whitelist; there is no dangerouslySetInnerHTML anywhere, so message
 * content is always treated as data. Links are only created for absolute http(s)/mailto URLs and
 * open in a new tab with noopener/noreferrer. Images are never loaded: they are shown as inert
 * placeholders with their address as text.
 */
import MarkdownIt from 'markdown-it';
import type Token from 'markdown-it/lib/token.mjs';
import { createElement, Fragment, type ReactNode } from 'react';
import { CodeBlock } from './components/CodeBlock';

const md = new MarkdownIt({ html: false, linkify: false, breaks: true, typographer: false });
// Disable syntaxes that could otherwise produce HTML passthrough or remote loads.
md.disable(['html_block', 'html_inline']);

const SAFE_SCHEMES = new Set(['http:', 'https:', 'mailto:']);

/** Returns a normalized URL string for safe absolute links, otherwise null. */
export function safeHref(raw: string | null | undefined): string | null {
  if (!raw) return null;
  // Reject control characters and whitespace tricks like "java\nscript:".
  if (/[\u0000-\u001f\u007f\s]/.test(raw)) return null;
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return null; // relative links are not navigable inside this app
  }
  if (!SAFE_SCHEMES.has(u.protocol)) return null;
  return u.href;
}

md.validateLink = (url: string) => safeHref(url) !== null || !/^[a-z][a-z0-9+.-]*:/i.test(url.trim());

const BLOCK_TAGS: Record<string, string> = {
  paragraph: 'p',
  bullet_list: 'ul',
  ordered_list: 'ol',
  list_item: 'li',
  blockquote: 'blockquote',
  table: 'table',
  thead: 'thead',
  tbody: 'tbody',
  tr: 'tr',
  th: 'th',
  td: 'td',
  heading: 'div',
};
const INLINE_TAGS: Record<string, string> = {
  strong: 'strong',
  em: 'em',
  s: 's',
  link: 'a',
};

interface Frame {
  tag: string;
  props: Record<string, unknown>;
  children: ReactNode[];
  hidden: boolean;
}

function baseType(t: Token): string {
  return t.type.replace(/_(open|close)$/, '');
}

function propsForOpen(t: Token): { tag: string; props: Record<string, unknown> } | null {
  const type = baseType(t);
  if (type === 'link') {
    const href = safeHref(t.attrGet('href'));
    if (!href) return { tag: 'span', props: { className: 'md-link-disabled', title: 'קישור לא נתמך הוצג כטקסט' } };
    return {
      tag: 'a',
      props: { href, target: '_blank', rel: 'noopener noreferrer nofollow', referrerPolicy: 'no-referrer', title: href },
    };
  }
  const tag = BLOCK_TAGS[type] ?? INLINE_TAGS[type];
  if (!tag) return null;
  const props: Record<string, unknown> = {};
  if (type === 'heading') {
    const level = Number(t.tag.slice(1)) || 6;
    props.className = `md-heading md-h${level}`;
    props.role = 'heading';
    props['aria-level'] = Math.min(level + 2, 6);
    props.dir = 'auto';
  } else if (type === 'ordered_list') {
    const start = t.attrGet('start');
    if (start && /^\d+$/.test(start)) props.start = Number(start);
  } else if (type === 'th' || type === 'td') {
    const style = t.attrGet('style') ?? '';
    const m = /text-align:(left|right|center)/.exec(style);
    if (m) props.className = `md-align-${m[1]}`;
    props.dir = 'auto';
  }
  if (type === 'paragraph' || type === 'list_item' || type === 'blockquote' || type === 'bullet_list' || type === 'ordered_list') {
    props.dir = 'auto';
  }
  if (type === 'table') return { tag: 'table', props: { ...props, className: 'md-table' } };
  return { tag, props };
}

function renderTokenStream(tokens: Token[], keyBase: string): ReactNode[] {
  const root: Frame = { tag: 'root', props: {}, children: [], hidden: true };
  const stack: Frame[] = [root];
  let k = 0;
  const top = () => stack[stack.length - 1]!;

  for (const t of tokens) {
    const key = `${keyBase}-${k++}`;
    if (t.type === 'inline') {
      top().children.push(createElement(Fragment, { key }, ...renderTokenStream(t.children ?? [], key)));
      continue;
    }
    if (t.nesting === 1) {
      const spec = propsForOpen(t);
      stack.push({
        tag: spec?.tag ?? 'span',
        props: { ...(spec?.props ?? {}), key },
        children: [],
        hidden: t.hidden || !spec,
      });
      continue;
    }
    if (t.nesting === -1) {
      const frame = stack.length > 1 ? stack.pop()! : root;
      if (frame === root) continue;
      if (frame.hidden) top().children.push(createElement(Fragment, { key }, ...frame.children));
      else top().children.push(createElement(frame.tag, frame.props, ...frame.children));
      continue;
    }
    switch (t.type) {
      case 'text':
        top().children.push(t.content);
        break;
      case 'softbreak':
      case 'hardbreak':
        top().children.push(createElement('br', { key }));
        break;
      case 'code_inline':
        top().children.push(createElement('code', { key, className: 'md-code-inline', dir: 'ltr' }, t.content));
        break;
      case 'fence':
      case 'code_block': {
        const lang = (t.info ?? '').trim().split(/\s+/)[0] ?? '';
        top().children.push(createElement(CodeBlock, { key, code: t.content.replace(/\n$/, ''), lang }));
        break;
      }
      case 'hr':
        top().children.push(createElement('hr', { key }));
        break;
      case 'image': {
        const src = t.attrGet('src') ?? '';
        const alt = t.content || (t.children ?? []).map((c) => c.content).join('');
        top().children.push(
          createElement(
            'span',
            { key, className: 'md-image-placeholder', title: 'תמונות מרוחקות אינן נטענות' },
            `🖼 תמונה (לא נטענה)${alt ? `: ${alt}` : ''} `,
            createElement('bdi', { dir: 'ltr', className: 'ltr-inline' }, src),
          ),
        );
        break;
      }
      default:
        // html_* is disabled; anything else unexpected is rendered as inert text.
        if (t.content) top().children.push(t.content);
    }
  }
  // Close any unbalanced frames defensively.
  while (stack.length > 1) {
    const frame = stack.pop()!;
    top().children.push(createElement(Fragment, { key: `${keyBase}-u${k++}` }, ...frame.children));
  }
  return root.children;
}

export function Markdown({ text }: { text: string }): ReactNode {
  const tokens = md.parse(text, {});
  return createElement('div', { className: 'md' }, ...renderTokenStream(tokens, 'm'));
}
