import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const css = readFileSync(path.resolve(__dirname, '..', 'src', 'client', 'styles.css'), 'utf8');
const vars: Record<string, string> = {};
for (const m of css.matchAll(/--([\w-]+):\s*(#[0-9a-fA-F]{6})/g)) vars[m[1]!] = m[2]!;

const resolve = (c: string) => (c.startsWith('--') ? vars[c.slice(2)]! : c);
function luminance(hex: string): number {
  const n = parseInt(hex.slice(1), 16);
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * ch[0]! + 0.7152 * ch[1]! + 0.0722 * ch[2]!;
}
export function contrast(a: string, b: string): number {
  const [l1, l2] = [luminance(resolve(a)), luminance(resolve(b))].sort((x, y) => y - x);
  return (l1! + 0.05) / (l2! + 0.05);
}

// [foreground, background, what]
const PAIRS: [string, string, string][] = [
  ['--text', '--bg', 'main text on page'],
  ['--text', '--panel', 'main text on panel'],
  ['--text', '--human-bg', 'text in human card'],
  ['--text', '--assistant-bg', 'text in assistant card'],
  ['--text', '--selected-bg', 'text in selected list item'],
  ['--muted', '--panel', 'muted text on panel'],
  ['--muted', '--human-bg', 'muted text in human card'],
  ['--muted', '--panel-3', 'muted text on button bg'],
  ['--muted', '--selected-bg', 'meta text in selected item'],
  ['--accent', '--panel', 'accent links on panel'],
  ['--accent', '--human-bg', 'accent links in human card'],
  ['--accent-strong', '--panel', 'headings on panel'],
  ['--accent-2', '--assistant-bg', 'assistant label'],
  ['#04182f', '--accent', 'selected badge'],
  ['--warn-text', '--warn-bg', 'warning text'],
  ['--error-text', '--error-bg', 'error text'],
  ['#8ea6c4', '--panel-2', 'input placeholder'],
  ['#ffd9a0', '--panel-2', 'tool-call summary'],
  ['#b9f0d0', '--panel-2', 'tool-result summary'],
  ['#d8ccff', '--panel-2', 'thinking summary'],
  ['#081426', '#ffd166', 'current search match'],
];

describe('color contrast (WCAG AA, 4.5:1 for normal text)', () => {
  it('parsed the palette', () => {
    expect(vars.bg).toBe('#081426');
    expect(vars.panel).toBe('#10233f');
    expect(vars.accent).toBe('#53b8ff');
    expect(vars.text).toBe('#e6eef8');
  });
  it.each(PAIRS)('%s on %s (%s)', (fg, bg) => {
    expect(contrast(fg, bg)).toBeGreaterThanOrEqual(4.5);
  });
  it('focus ring is clearly visible against the page (≥ 3:1)', () => {
    expect(contrast('--focus', '--bg')).toBeGreaterThanOrEqual(3);
    expect(contrast('--focus', '--panel')).toBeGreaterThanOrEqual(3);
  });
});
