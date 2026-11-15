// Small, dependency-free helpers for Hebrew/RTL text extracted from PDFs.

export const HEB = /[֐-׿]/;
const MIRROR = { '(': ')', ')': '(', '[': ']', ']': '[', '{': '}', '}': '{', '<': '>', '>': '<', '≤': '≥', '≥': '≤' };
export const mirrorable = (s) => /^[\s()[\]{}<>≤≥]+$/.test(s);
export const mirror = (s) => s.replace(/[()[\]{}<>≤≥]/g, (c) => MIRROR[c]);

const FINALS = 'ךםןףץ';
const HEB_WORD = /[א-ת]{2,}/g;

/**
 * Some PDFs store Hebrew in visual (reversed) order, so pdf.js returns "האצות" for "תוצאה".
 * Hebrew final letters (ך ם ן ף ץ) appear only at the END of a word, so many words that START
 * with a final letter — and few that end with one — mean the text is reversed.
 */
export function looksReversed(strings) {
  let start = 0, end = 0;
  for (const s of strings) {
    for (const w of String(s).match(HEB_WORD) || []) {
      if (FINALS.includes(w[0])) start++;
      if (FINALS.includes(w[w.length - 1])) end++;
    }
  }
  return start >= 3 && start > end * 2;
}

/**
 * Turn visually-ordered text (left-to-right as drawn) into logical order for an RTL line:
 * reverse everything, then restore the internal order of left-to-right runs (numbers, Latin, units),
 * and mirror brackets / comparison signs that now face the wrong way.
 */
export function reverseVisual(s) {
  const reversed = [...String(s)].reverse().join('');
  return reversed
    .replace(/[A-Za-z0-9µμ%^³⁶][A-Za-z0-9µμ%^³⁶.,:/\-+ ]*[A-Za-z0-9µμ%^³⁶]|[A-Za-z0-9µμ%^³⁶]/g, (run) => [...run].reverse().join(''))
    .replace(/[()[\]{}<>≤≥]/g, (c) => MIRROR[c]);
}
