// Flexible lab-report parser over positioned text lines (from pdf-extract.js).
// Rules: copy name / unit / range exactly as printed; never convert, normalize or invent.
// Anything not read with confidence is left empty and marked 'missing' or 'unclear'.

const HEB = /[֐-׿]/;
const NUM = '-?\\d+(?:[.,]\\d+)?';

const RANGE_RE = new RegExp(`^[([]?\\s*(?:(?:<=?|>=?|≤|≥|עד|מעל|up to|above)\\s*${NUM}|${NUM}\\s*[-–—]\\s*${NUM})\\s*[)\\]]?$`, 'i');
// A printed lab flag may follow the number, or precede it when an RTL line was laid out visually ("H 5.3").
const LAB_FLAG = '(?:HH|LL|H|L|\\*|↑|↓|גבוה|נמוך)';
const VALUE_RE = new RegExp(`^(?:${LAB_FLAG}\\s+)?([<>≤≥]?\\s*-?\\d+(?:[.,]\\d+)?)(?:\\s*${LAB_FLAG})?$`, 'i');
const MISSING_RE = /^(—|–|-|־|-{2,3}|\*{1,3}|N\/?A|n\.a\.|לא בוצע|חסר|ממתין|pending|not done)$/i;
const FLAG_RE = /^(HH|LL|H|L|\*|↑|↓|גבוה|נמוך|high|low|normal|תקין|N)$/i;
const UNIT_KNOWN = /^(%|fL|pg|g\/dL|mg\/dL|mg\/L|g\/L|mmol\/L|µmol\/L|μmol\/L|umol\/L|mEq\/L|U\/L|IU\/L|mIU\/L|µIU\/mL|uIU\/mL|mIU\/mL|ng\/mL|ng\/dL|pg\/mL|µg\/dL|ug\/dL|µg\/L|nmol\/L|pmol\/L|sec|ratio|INR|mm\/h|mm\/hr|cells\/µL|K\/µL|K\/uL|M\/µL|M\/uL|10\^?\d+\/[µμu]?L|10[³⁶⁹]\/[µμu]?L|x?10\^?\d+\/L)$/i;

const HEADER = {
  name: /^(שם\s*ה?בדיקה|ה?בדיקה|שם|test( name)?|analyte|parameter|examination|component)$/i,
  value: /^(ה?תוצאה|ערך|result|value)$/i,
  unit: /^(יחידות?|יח'?|units?)$/i,
  range: /^(טווח(\s*(תקין|ה?ייחוס|נורמה|תקינות))?|ערכי\s*(ה?ייחוס|נורמה)|reference(\s*(range|interval|values))?|ref\.?\s*range|normal\s*range|range)$/i,
  flag: /^(סימון|הערה|flag|h\/l)$/i,
};

const DATE_GOOD = /(תאריך\s*ה?(בדיקה|דגימה|לקיחה|נטילה)|collect(ion|ed)|sample\s*date|specimen|test\s*date|date\s*of\s*(test|collection)|drawn)/i;
const DATE_ANY = /(תאריך|date)/i;
const DATE_EXCLUDE = /(הדפסה|הופק|הפקה|print|report(ed)?\s*(date|on)|issued|לידה|birth|dob|אישור|approved|validated)/i;
const LAB_RE = /(מעבד(ה|ת)|laborator|\blab\b|diagnostics|מכון)/i;

const isUnit = (t) => {
  const s = t.trim();
  if (!s || s.length > 16 || HEB.test(s)) return false;
  if (UNIT_KNOWN.test(s)) return true;
  return /[/%µμ^]/.test(s) && /[a-zA-Zµμ%]/.test(s) && !/\d+\s*[-–—]\s*\d/.test(s);
};
const isName = (t) => /[A-Za-z֐-׿]{2,}/.test(t) && !isUnit(t) && !FLAG_RE.test(t.trim());

/** Value cell → { valueText, status }. Never guesses. */
function readValue(raw) {
  const t = (raw ?? '').trim();
  if (!t) return { valueText: '', status: 'missing' };
  if (MISSING_RE.test(t)) return { valueText: '', status: 'missing' };
  const m = t.match(VALUE_RE);
  if (m) {
    const v = m[1].replace(/\s+/g, '');
    if (/^-?\d+(\.\d+)?$/.test(v)) return { valueText: v, status: 'ok' };
    return { valueText: '', status: 'unclear' }; // "<0.5", "12,5" … not read with confidence
  }
  return { valueText: '', status: 'unclear' };
}

function readUnit(raw) {
  const t = (raw ?? '').trim();
  if (!t) return { unit: '', status: 'missing' };
  if (isUnit(t)) return { unit: t, status: 'ok' };
  // A number or range in the unit column means the columns were not read correctly.
  if (/^\s*[<>≤≥]?\s*\d/.test(t) || MISSING_RE.test(t)) return { unit: '', status: MISSING_RE.test(t) ? 'missing' : 'unclear' };
  return { unit: t, status: 'ok' };
}

function readRange(raw) {
  const t = (raw ?? '').trim();
  if (!t || MISSING_RE.test(t)) return { rangeText: '', status: 'missing' };
  if (RANGE_RE.test(t)) return { rangeText: t, status: 'ok' };
  if (/^[A-Za-z֐-׿\s]+$/.test(t)) return { rangeText: t, status: 'ok' }; // e.g. "Negative" / "שלילי" — kept as printed
  return { rangeText: '', status: 'unclear' };
}

function headerColumns(line) {
  const cols = [];
  for (const c of line.cells) {
    const t = c.text.trim().replace(/[:：]$/, '');
    const type = Object.keys(HEADER).find((k) => HEADER[k].test(t));
    if (!type) return null; // a header line consists of header words only
    cols.push({ type, x0: c.x0, x1: c.x1, cx: (c.x0 + c.x1) / 2 });
  }
  const types = new Set(cols.map((c) => c.type));
  if (!(types.has('name') && types.has('value') && (types.has('unit') || types.has('range')))) return null;

  // Column spans. Table cells are start-aligned: in an RTL table a column runs from its header's
  // right edge leftwards to the next header's right edge; in an LTR table from the left edge rightwards.
  // (A cell's own alignment may differ from the header's, e.g. an LTR unit in an RTL table.)
  const byX = [...cols].sort((a, b) => a.x0 - b.x0);
  byX.forEach((col, k) => {
    if (line.rtl) {
      col.lo = k > 0 ? byX[k - 1].x1 : -Infinity;
      col.hi = k < byX.length - 1 ? col.x1 : Infinity;
    } else {
      col.lo = k > 0 ? col.x0 : -Infinity;
      col.hi = k < byX.length - 1 ? byX[k + 1].x0 : Infinity;
    }
  });
  return cols;
}

function assignToColumns(line, cols) {
  const byCol = cols.map(() => []);
  for (const c of line.cells) {
    const cx = (c.x0 + c.x1) / 2;
    let best = cols.findIndex((col) => cx > col.lo && cx <= col.hi);
    if (best < 0) {
      // Fallback: nearest column centre
      let bestDist = Infinity;
      cols.forEach((col, i) => { const d = Math.abs(cx - col.cx); if (d < bestDist) { bestDist = d; best = i; } });
    }
    byCol[best].push(c);
  }
  const textOf = (type) => {
    const parts = [];
    cols.forEach((col, i) => { if (col.type === type) parts.push(byCol[i].map((c) => c.text).join(' ')); });
    return parts;
  };
  return {
    name: textOf('name').filter(Boolean).join(' / '),
    value: textOf('value').join(' ').trim(),
    unit: textOf('unit').join(' ').trim(),
    range: textOf('range').join(' ').trim(),
  };
}

/** No header found: classify cells by content. Requires a name and at least two other fields. */
function classifyByContent(line) {
  const out = { name: '', value: null, unit: '', range: '' };
  const names = [];
  let valueCells = 0;
  for (const c of line.cells) {
    const t = c.text.trim();
    if (RANGE_RE.test(t) && !/^[<>≤≥]?\s*-?\d+(?:[.,]\d+)?\s*(HH|LL|H|L)?$/i.test(t)) { out.range = out.range ? out.range + ' ' + t : t; continue; }
    if (VALUE_RE.test(t) || MISSING_RE.test(t)) { valueCells++; out.value = t; continue; }
    if (isUnit(t)) { out.unit = t; continue; }
    if (FLAG_RE.test(t)) continue;
    if (isName(t)) names.push(t);
  }
  out.name = names.join(' / ');
  if (valueCells > 1) out.value = '??ambiguous';
  const fields = (out.value != null ? 1 : 0) + (out.unit ? 1 : 0) + (out.range ? 1 : 0);
  return out.name && fields >= 2 ? out : null;
}

function findDate(lines) {
  const found = { good: new Map(), any: new Map() };
  const DMY = /(?<!\d)(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{4})(?!\d)/g;
  const ISO = /(?<!\d)(\d{4})-(\d{1,2})-(\d{1,2})(?!\d)/g;
  const valid = (y, m, d) => {
    const dt = new Date(Date.UTC(y, m - 1, d));
    return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
  };
  for (const l of lines) {
    const text = l.text;
    if (DATE_EXCLUDE.test(text) || !DATE_ANY.test(text)) continue;
    const bucket = DATE_GOOD.test(text) ? found.good : found.any;
    for (const m of text.matchAll(ISO)) {
      const [y, mo, d] = [+m[1], +m[2], +m[3]];
      if (valid(y, mo, d)) bucket.set(`${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`, m[0]);
    }
    for (const m of text.matchAll(DMY)) {
      // Day-first (dd/mm/yyyy), as printed on Israeli lab reports. The printed text is shown for review.
      const [d, mo, y] = [+m[1], +m[2], +m[3]];
      if (valid(y, mo, d)) bucket.set(`${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`, m[0]);
    }
  }
  for (const bucket of [found.good, found.any]) {
    if (bucket.size === 1) { const [[iso, raw]] = bucket; return { iso, raw, status: 'ok' }; }
    if (bucket.size > 1) return { iso: '', raw: [...bucket.values()].join(' / '), status: 'unclear' };
  }
  return { iso: '', raw: '', status: 'missing' };
}

function findLab(lines) {
  for (const l of lines) {
    if (!LAB_RE.test(l.text)) continue;
    if (l.cells.every((c) => Object.values(HEADER).some((re) => re.test(c.text.trim())))) continue;
    return { lab: l.cells.map((c) => c.text).join(' ').slice(0, 100), status: 'ok' };
  }
  return { lab: '', status: 'missing' };
}

let rowSeq = 0;

/** @returns { date, lab, rows } — rows always carry their source line for review. */
export function parseReport(extracted) {
  const allLines = extracted.pages.flatMap((p) => p.lines.map((l) => ({ ...l, page: p.pageNumber })));
  const rows = [];

  for (const page of extracted.pages) {
    let cols = null;
    for (const line of page.lines) {
      const hdr = headerColumns(line);
      if (hdr) { cols = hdr; continue; }

      let f = null;
      if (cols) {
        const a = assignToColumns(line, cols);
        const hasData = a.value || a.unit || a.range;
        if (a.name && isName(a.name) && hasData) f = a;
      }
      if (!f) {
        const c = classifyByContent(line);
        if (c) f = { name: c.name, value: c.value === '??ambiguous' ? '??' : c.value ?? '', unit: c.unit, range: c.range };
      }
      if (!f) continue;

      const v = f.value === '??' ? { valueText: '', status: 'unclear' } : readValue(f.value);
      const u = readUnit(f.unit);
      const r = readRange(f.range);
      rows.push({
        id: `r${++rowSeq}`,
        page: page.pageNumber,
        nameRaw: f.name.trim(),
        valueText: v.valueText, valueStatus: v.status,
        unit: u.unit, unitStatus: u.status,
        rangeText: r.rangeText, rangeStatus: r.status,
        sourceLine: line.text,
      });
    }
  }

  return { date: findDate(allLines), lab: findLab(allLines), rows };
}
