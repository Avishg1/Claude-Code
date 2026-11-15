// Shared domain logic: reference-range parsing, flags, formatting.
// Display only — no interpretation. Flags compare a value ONLY with the range
// printed in the same report (same record).

export const LOCALE = 'he-IL';

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const toDate = (iso) => new Date(iso + 'T00:00:00');
export const fmtDate = (iso) => (iso ? toDate(iso).toLocaleDateString(LOCALE, { day: 'numeric', month: 'long', year: 'numeric' }) : '');
export const fmtDateShort = (iso) => toDate(iso).toLocaleDateString(LOCALE, { month: 'short', year: '2-digit' });
export const fmtNum = (n) => n.toLocaleString(LOCALE, { maximumFractionDigits: 4, useGrouping: false });
// Display-only prettifying of the unit string (no conversion).
export const fmtUnit = (u) => String(u ?? '').replace(/\^3\b/, '³').replace(/\^6\b/, '⁶');

const NUM = '(-?\\d+(?:\\.\\d+)?)';

/** Strict number parse of a printed value: "12.4" → 12.4. Anything else → null. */
export function parseStrictNumber(text) {
  const t = String(text ?? '').trim();
  return new RegExp(`^${NUM}$`).test(t) ? Number(t) : null;
}

/**
 * Parse numeric bounds out of a printed range text, for flagging only.
 * The text itself is always kept and displayed as printed.
 * Returns null when the text is missing or not unambiguously numeric
 * (e.g. "Negative", "12,5-16" — a comma could be a decimal or a thousands separator).
 */
export function parseRange(text) {
  if (text == null) return null;
  let t = String(text).trim();
  if (!t) return null;
  t = t.replace(/^\((.*)\)$/, '$1').replace(/^\[(.*)\]$/, '$1').trim();
  let m;
  if ((m = t.match(new RegExp(`^${NUM}\\s*[-–—]\\s*${NUM}$`)))) {
    const low = Number(m[1]), high = Number(m[2]);
    return low <= high ? { low, high, lowInc: true, highInc: true } : null;
  }
  if ((m = t.match(new RegExp(`^(<=?|≤|עד|up to)\\s*${NUM}$`, 'i')))) {
    return { low: null, high: Number(m[2]), lowInc: true, highInc: m[1] !== '<' };
  }
  if ((m = t.match(new RegExp(`^(>=?|≥|מעל|above)\\s*${NUM}$`, 'i')))) {
    return { low: Number(m[2]), high: null, lowInc: m[1] !== '>', highInc: true };
  }
  return null;
}

export const rangeTextOf = (rec) => {
  const t = rec.refRange?.text;
  return t != null && String(t).trim() ? String(t).trim() : null;
};

/**
 * 'missing'  — no value in the report
 * 'unclear'  — a value is printed but is not a plain number (e.g. "<0.5"); no flag
 * 'unknown'  — no reference range in the report; no flag
 * 'nonnum'   — a range is printed but has no numeric bounds; no flag
 * 'low' | 'high' | 'in'
 */
export function flagOf(rec) {
  if (rec.value == null) return rec.valueText && String(rec.valueText).trim() ? 'unclear' : 'missing';
  const text = rangeTextOf(rec);
  if (text == null) return 'unknown';
  const b = parseRange(text);
  if (!b) return 'nonnum';
  if (b.low != null && (b.lowInc ? rec.value < b.low : rec.value <= b.low)) return 'low';
  if (b.high != null && (b.highInc ? rec.value > b.high : rec.value >= b.high)) return 'high';
  return 'in';
}

/** Did the printed range change between two reports? Numeric bounds if both parse, else the text. */
export function sameRange(a, b) {
  const ta = rangeTextOf(a), tb = rangeTextOf(b);
  if (ta == null || tb == null) return ta === tb;
  const ba = parseRange(ta), bb = parseRange(tb);
  if (ba && bb) return ba.low === bb.low && ba.high === bb.high && ba.lowInc === bb.lowInc && ba.highInc === bb.highInc;
  return ta === tb;
}

export const isHebrew = (s) => /[֐-׿]/.test(String(s ?? ''));

/** Display name for a record (demo: Hebrew + English; imported: as written in the PDF). */
export function names(rec) {
  if (rec.source === 'pdf') return { primary: rec.nameRaw, secondary: '' };
  return { primary: rec.nameHe, secondary: rec.nameEn && rec.nameEn !== rec.nameHe ? rec.nameEn : '' };
}

/** Series key: imported tests are keyed by the name as written + the unit as written. */
export function seriesKey(rec) {
  if (rec.source === 'pdf') {
    const n = String(rec.nameRaw ?? '').replace(/\s+/g, ' ').trim().toLowerCase();
    return `pdf|${n}|${String(rec.unit ?? '').trim()}`;
  }
  return `demo|${rec.testId}|${rec.unit}`;
}
