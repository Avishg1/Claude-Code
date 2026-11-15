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

// Column-header words seen on Hebrew and English lab reports. Header cells that match none of these
// (e.g. "תאריך", "קוד") become ignored "other" columns instead of disqualifying the header row.
const HEADER = {
  name: /^(שם\s*ה?בדיקה|ה?בדיקה|ה?בדיקות|(תיאור|תאור)\s*ה?בדיקה|שם\s*ה?מבחן|test(\s*name)?|tests|analyte|parameter|examination|component|description|investigation)$/i,
  value: /^(ה?תוצאה|ה?תוצאות|ה?ערך(\s*ה?נמדד)?|result|results|value|your\s*result)$/i,
  unit: /^(ה?יחידות?(\s*ה?מידה)?|יחידת\s*ה?מידה|יח['׳]?(\s*מידה)?|units?|uom)$/i,
  range: /^(ה?תוצאה\s*(ב?יחס\s*ל|לעומת|מול)\s*(ה?טווח|ה?ערכים)(\s*ה?(נורמה|תקין|תקינים|ייחוס))?|result\s*(vs\.?|versus|compared\s*(to|with))\s*(the\s*)?(normal|reference)?\s*range|טווח(\s*(ה?תקין|ה?ייחוס|ה?נורמה|נורמלי|תקינות|ערכים|ערכי\s*ייחוס))?|ערכי(ם)?\s*(ה?ייחוס|ה?נורמה|תקינים|נורמליים|נורמה)|ערך\s*(תקין|נורמלי|ייחוס)|תחום(\s*(ה?תקין|ה?נורמה|ה?ייחוס))?|גבולות(\s*(ה?נורמה|ייחוס))?|נורמה|reference(\s*(range|interval|values?|limits))?|ref\.?(\s*(range|interval|values?))?|normal(\s*(range|values?|limits))?|range|limits|biological\s*ref.*)$/i,
  flag: /^(סימון|הערה|הערות|סטטוס|חריגה|flag|flags|h\/l|status|comments?|remarks?)$/i,
};

/** Header type of a cell, trying the whole text and its Hebrew / English halves ("תוצאה Result"). */
function headerType(text) {
  const t = text.replace(/[:：*]+$/, '').replace(/\s+/g, ' ').trim();
  const candidates = [
    t,
    ...t.split(/\s*[/|]\s*/),
    t.replace(/[A-Za-z].*$/, '').trim(),
    t.replace(/[֐-׿"'״׳]+/g, ' ').replace(/\s+/g, ' ').trim(),
  ].filter(Boolean);
  for (const c of candidates) {
    const type = Object.keys(HEADER).find((k) => HEADER[k].test(c));
    if (type) return type;
  }
  return null;
}

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
    // Header cells are short labels; long text or numbers mean this is not a header row.
    if (c.text.length > 40 || /\d/.test(c.text)) return null;
    cols.push({ type: headerType(c.text) || 'other', x0: c.x0, x1: c.x1, cx: (c.x0 + c.x1) / 2 });
  }
  const types = new Set(cols.map((c) => c.type));
  const known = cols.filter((c) => c.type !== 'other').length;
  if (known < 2 || known < cols.length / 2) return null;
  const withName = types.has('name') && types.has('value') && (types.has('unit') || types.has('range'));
  const withoutName = !types.has('name') && types.has('value') && types.has('unit') && types.has('range');
  if (!withName && !withoutName) return null;

  if (withoutName) {
    // No header above the test names (a blank header cell): the names sit before the first column
    // in reading order — to the right in an RTL table, to the left in an LTR table.
    const edge = line.rtl ? Math.max(...cols.map((c) => c.x1)) : Math.min(...cols.map((c) => c.x0));
    const name = line.rtl ? { type: 'name', x0: edge + 1, x1: edge + 2 } : { type: 'name', x0: edge - 2, x1: edge - 1 };
    name.cx = (name.x0 + name.x1) / 2;
    cols.unshift(name);
  }

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

/* ---------- Word-level fallback: for PDFs whose columns are so close that a whole row is one text piece ---------- */

const HEADER_WORDS = {
  name: /^(ה?בדיקה|ה?בדיקות|שם|תיאור|תאור|test|tests|analyte|parameter|examination|description)$/i,
  value: /^(ה?תוצאה|ה?תוצאות|ערך|ה?ערך|result|results|value)$/i,
  unit: /^(ה?יחידות?|יחידת|יח['׳]?|מידה|units?|uom)$/i,
  range: /^(טווח|ה?ייחוס|נורמה|ה?נורמה|תקין|תקינים|גבולות|תחום|reference|range|normal|ref\.?|limits|interval)$/i,
};

/** A header row that came out as one piece of text: "שם בדיקה תוצאה יחידות טווח ייחוס". */
function isWordHeader(line) {
  const text = line.cells.map((c) => c.text).join(' ');
  if (/\d/.test(text) || text.length > 140) return false;
  const words = text.replace(/[:：*,|/()]+/g, ' ').split(/\s+/).filter(Boolean);
  const types = new Set();
  let matched = 0;
  for (const w of words) {
    const t = Object.keys(HEADER_WORDS).find((k) => HEADER_WORDS[k].test(w));
    if (t) { types.add(t); matched++; }
  }
  return types.has('value') && (types.has('unit') || types.has('range')) && types.size >= 3 && matched >= words.length * 0.6;
}

/**
 * Classify the words of one row without column positions. Order-independent:
 * one range, one plain number (value), one unit; the remaining words are the test name.
 * Anything ambiguous (two numbers, two units, two ranges) is marked unclear — never guessed.
 */
function classifyWords(line) {
  let t = ` ${line.cells.map((c) => c.text).join(' ').replace(/\s+/g, ' ').trim()} `;
  const RANGE_G = new RegExp(`(?<=\\s)[([]?(?:(?:<=?|>=?|≤|≥)\\s?${NUM}|${NUM}\\s?[-–—]\\s?${NUM})[)\\]]?(?=\\s)`, 'g');
  // In an RTL line, a comparison drawn visually ("200 >") is logically "< 200".
  const VISUAL_CMP_G = new RegExp(`(?<=\\s)(${NUM})\\s?([<>≤≥])(?=\\s)`, 'g');
  let range = '';
  const ranges = [...t.matchAll(RANGE_G)];
  const visual = line.rtl ? [...t.matchAll(VISUAL_CMP_G)] : [];
  if (ranges.length + visual.length > 1) return null;
  if (ranges.length === 1) {
    range = ranges[0][0];
    t = t.slice(0, ranges[0].index) + ' ' + t.slice(ranges[0].index + range.length);
  } else if (visual.length === 1) {
    const m = visual[0];
    range = `${({ '<': '>', '>': '<', '≤': '≥', '≥': '≤' })[m[2]]} ${m[1]}`;
    t = t.slice(0, m.index) + ' ' + t.slice(m.index + m[0].length);
  }
  const values = [], units = [], names = [];
  let missing = false;
  for (const tok of t.trim().split(' ').filter(Boolean)) {
    if (/^[<>≤≥]?-?\d+(?:[.,]\d+)?$/.test(tok)) values.push(tok);
    else if (MISSING_RE.test(tok)) missing = true;
    else if (FLAG_RE.test(tok)) continue;
    else if (isUnit(tok)) units.push(tok);
    else names.push(tok);
  }
  const name = names.join(' ').trim();
  if (!/[A-Za-z֐-׿]{2,}/.test(name)) return null;
  if (!values.length && !missing) return null;
  if (!units.length && !range) return null;
  return {
    name,
    value: values.length === 1 ? values[0] : values.length > 1 ? '??' : '',
    unit: units.length === 1 ? units[0] : units.length > 1 ? '??' : '',
    range,
  };
}

const PLAIN_NUM = /^-?\d+(?:\.\d+)?$/;

/**
 * Turn the raw field texts of one row into review fields.
 * - A unit printed inside the value cell ("13.4 g/dL") or the range column is moved to the unit field
 *   when the table has no unit of its own.
 * - A graphical range column ("תוצאה לעומת טווח הנורמה") often prints only the two limits as separate
 *   numbers. They are NOT turned into a range automatically: the range stays empty and "unclear", and
 *   the printed limits are offered as a hint the user can apply in the review screen.
 */
function buildFields(f) {
  let value = (f.value ?? '').trim(), unit = (f.unit ?? '').trim(), range = (f.range ?? '').trim();
  let rangeHint = '';

  if (!unit && value && value !== '??') {
    const parts = value.split(/\s+/);
    const u = parts.filter(isUnit);
    if (u.length === 1 && parts.length > 1) { unit = u[0]; value = parts.filter((p) => p !== u[0]).join(' '); }
  }

  if (range && range !== '??' && !RANGE_RE.test(range)) {
    let parts = range.split(/\s+/);
    const u = parts.filter(isUnit);
    if (u.length === 1) { if (!unit) unit = u[0]; parts = parts.filter((p) => p !== u[0]); }
    const rest = parts.join(' ');
    if (RANGE_RE.test(rest)) {
      range = rest;
    } else if (parts.length && parts.every((p) => PLAIN_NUM.test(p))) {
      let limits = parts;
      // A bar may also print the result itself; drop that exact printed value if three numbers appear.
      const vt = readValue(value).valueText;
      if (limits.length === 3 && vt && limits.includes(vt)) limits = limits.filter((p, i) => i !== limits.indexOf(vt));
      if (limits.length === 2) rangeHint = [...limits].sort((a, b) => Number(a) - Number(b)).join('-');
      range = '??';
    }
  }

  const v = value === '??' ? { valueText: '', status: 'unclear' } : readValue(value);
  const u = unit === '??' ? { unit: '', status: 'unclear' } : readUnit(unit);
  const r = range === '??' ? { rangeText: '', status: 'unclear' } : readRange(range);
  return {
    valueText: v.valueText, valueStatus: v.status,
    unit: u.unit, unitStatus: u.status,
    rangeText: r.rangeText, rangeStatus: r.status,
    rangeHint,
  };
}

/** @returns { date, lab, rows } — rows always carry their source line for review. */
export function parseReport(extracted) {
  const allLines = extracted.pages.flatMap((p) => p.lines.map((l) => ({ ...l, page: p.pageNumber })));
  const rows = [];
  let headerRows = 0;

  for (const page of extracted.pages) {
    let cols = null;
    let wordMode = false;
    const pageRows = []; // { f, row, y, h, extra: [] }
    const conts = [];    // continuation lines, assigned after the page is read
    for (const line of page.lines) {
      const hdr = headerColumns(line);
      if (hdr) { cols = hdr; wordMode = false; headerRows++; continue; }
      if (isWordHeader(line)) { cols = null; wordMode = true; headerRows++; continue; }

      let f = null;
      if (cols) {
        const a = assignToColumns(line, cols);
        const hasData = a.value || a.unit || a.range;
        if (a.name && isName(a.name) && hasData) f = a;
        // Continuation line: only range/unit text, e.g. limits printed under a range bar or a label above it.
        else if (!a.name && !a.value && (a.range || a.unit)) {
          conts.push({ a, line, prevIdx: pageRows.length - 1 });
          continue;
        }
      }
      if (!f && !wordMode) {
        const c = classifyByContent(line);
        if (c) f = { name: c.name, value: c.value === '??ambiguous' ? '??' : c.value ?? '', unit: c.unit, range: c.range };
      }
      // Word-level reading: after a one-piece header, or for rows that came out as one or two pieces.
      if (!f && (wordMode || line.cells.length < 3)) f = classifyWords(line);
      if (!f) continue;

      const row = {
        id: `r${++rowSeq}`,
        page: page.pageNumber,
        nameRaw: f.name.trim(),
        ...buildFields(f),
        sourceLine: line.text,
      };
      rows.push(row);
      pageRows.push({ f: { ...f }, row, y: line.y, h: line.h, extra: [] });
    }

    // Each continuation line belongs to the nearest row (above or below), if it is close enough.
    for (const c of conts) {
      const prev = pageRows[c.prevIdx], next = pageRows[c.prevIdx + 1];
      const dPrev = prev ? prev.y - c.line.y : Infinity;
      const dNext = next ? c.line.y - next.y : Infinity;
      const target = dNext < dPrev ? next : prev;
      if (!target || Math.min(dPrev, dNext) > (target.h || 10) * 2.6) continue;
      target.f.range = [target.f.range, c.a.range].filter(Boolean).join(' ');
      target.f.unit = target.f.unit || c.a.unit;
      target.extra.push(c.line.text);
    }
    for (const t of pageRows) {
      if (!t.extra.length) continue;
      Object.assign(t.row, buildFields(t.f));
      t.row.sourceLine += t.extra.map((x) => `   ⏎   ${x}`).join('');
    }
  }

  return { date: findDate(allLines), lab: findLab(allLines), rows, headerRows };
}
