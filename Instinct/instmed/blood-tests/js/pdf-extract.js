// Local PDF text extraction with the bundled pdf.js (no CDN, no fonts, no wasm, no network).
// The worker is created once at app start, so importing a PDF makes no network requests.
import * as pdfjsLib from '../vendor/pdfjs/pdf.min.mjs';

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL('../vendor/pdfjs/pdf.worker.min.mjs', import.meta.url).href;

export const MAX_BYTES = 20 * 1024 * 1024; // 20MB
export const MAX_PAGES = 30;

let worker = null;
/** Start the pdf.js worker ahead of time (one local request at app start). */
export function warmUp() {
  if (!worker) worker = new pdfjsLib.PDFWorker({ name: 'blood-tests-pdf' });
  return worker.promise;
}

export class ImportError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

const MSG = {
  empty: 'הקובץ ריק.',
  tooLarge: `הקובץ גדול מדי (מעל ${MAX_BYTES / 1024 / 1024}MB). לא יובא דבר.`,
  notPdf: 'הקובץ אינו קובץ PDF תקין. לא יובא דבר.',
  password: 'הקובץ מוגן בסיסמה. לא ניתן לקרוא אותו, ולא יובא דבר.',
  corrupt: 'הקובץ פגום או שלא ניתן לפענח אותו. לא יובא דבר.',
  tooManyPages: `לקובץ יותר מ-${MAX_PAGES} עמודים. לא יובא דבר.`,
  noText: 'לא נמצאה בקובץ שכבת טקסט קריאה — ככל הנראה מדובר בקובץ סרוק או בתמונה. לא יובא דבר (אין זיהוי תווים חיצוני).',
  generic: 'אירעה שגיאה בקריאת הקובץ. לא יובא דבר.',
};
export const errorMessage = (code) => MSG[code] || MSG.generic;

const HEB = /[֐-׿]/;
const MIRROR = { '(': ')', ')': '(', '[': ']', ']': '[', '{': '}', '}': '{', '<': '>', '>': '<', '≤': '≥', '≥': '≤' };
const mirrorable = (s) => /^[\s()[\]{}<>≤≥]+$/.test(s);
const mirror = (s) => s.replace(/[()[\]{}<>≤≥]/g, (c) => MIRROR[c]);

const LATIN = /[A-Za-zµμ]/;
const kindOf = (s) => (HEB.test(s) ? 'R' : LATIN.test(s) ? 'L' : /\d/.test(s) ? 'N' : 'O');

/**
 * Join the items of one cell into logical-order text.
 * pdf.js gives each item's own text in logical order, but items are positioned visually.
 * In an RTL line (the line contains Hebrew) the items are read right-to-left, except that
 * consecutive Latin items (with any neutral between them) form one left-to-right run,
 * like the Unicode bidi algorithm does. Standalone brackets / < > in RTL appear mirrored.
 */
function joinCell(items, lineRtl) {
  const visual = [...items].sort((a, b) => a.x0 - b.x0);
  const gapBefore = (i) => i > 0 && visual[i].x0 - visual[i - 1].x1 > visual[i].h * 0.15;
  if (!lineRtl) {
    return visual.map((it, i) => (gapBefore(i) ? ' ' : '') + it.str).join('').replace(/\s+/g, ' ').trim();
  }
  const kinds = visual.map((it) => kindOf(it.str));
  // Build units in visual order: Latin runs (L, optionally joined by neutrals between L items) or single items.
  const units = [];
  for (let i = 0; i < visual.length; i++) {
    if (kinds[i] === 'L') {
      const start = i;
      while (i + 1 < visual.length) {
        if (kinds[i + 1] === 'L') { i++; continue; }
        // neutral(s) followed by another L → part of the run
        let j = i + 1;
        while (j < visual.length && kinds[j] === 'O') j++;
        if (j < visual.length && j > i + 1 && kinds[j] === 'L') { i = j; continue; }
        break;
      }
      units.push({ from: start, to: i, run: true });
    } else {
      units.push({ from: i, to: i, run: false });
    }
  }
  let out = '';
  for (let u = units.length - 1; u >= 0; u--) {
    const { from, to, run } = units[u];
    let s = '';
    for (let i = from; i <= to; i++) s += (i > from && gapBefore(i) ? ' ' : '') + visual[i].str;
    if (!run && mirrorable(s)) s = mirror(s);
    out += s;
    if (gapBefore(from)) out += ' ';
  }
  return out.replace(/\s+/g, ' ').trim();
}

function toLines(textContent) {
  const items = [];
  for (const it of textContent.items) {
    if (!it.str || !it.str.trim()) continue;
    const h = it.height || Math.abs(it.transform[3]) || 10;
    const x0 = it.transform[4];
    items.push({ str: it.str, x0, x1: x0 + (it.width || 0), y: it.transform[5], h });
  }
  items.sort((a, b) => b.y - a.y || a.x0 - b.x0);

  const lines = [];
  for (const it of items) {
    const line = lines.find((l) => Math.abs(l.y - it.y) <= Math.max(2, Math.min(l.h, it.h) * 0.4));
    if (line) { line.items.push(it); line.h = Math.max(line.h, it.h); } else lines.push({ y: it.y, h: it.h, items: [it] });
  }
  lines.sort((a, b) => b.y - a.y);

  return lines.map((l) => {
    const sorted = l.items.sort((a, b) => a.x0 - b.x0);
    const cells = [];
    for (const it of sorted) {
      const cur = cells[cells.length - 1];
      const gapLimit = Math.max(6, Math.min(cur?.h ?? it.h, it.h) * 0.9);
      if (cur && it.x0 - cur.x1 <= gapLimit) {
        cur.items.push(it); cur.x1 = Math.max(cur.x1, it.x1); cur.h = Math.max(cur.h, it.h);
      } else {
        cells.push({ items: [it], x0: it.x0, x1: it.x1, h: it.h });
      }
    }
    // Paragraph direction of the line: RTL when it contains any Hebrew.
    const rtl = l.items.some((it) => HEB.test(it.str));
    const out = cells.map((c) => ({ text: joinCell(c.items, rtl), x0: c.x0, x1: c.x1 })).filter((c) => c.text);
    if (rtl) out.sort((a, b) => b.x1 - a.x1); // reading order
    return { y: l.y, rtl, cells: out, text: out.map((c) => c.text).join('   ') };
  });
}

async function readHead(file) {
  const buf = new Uint8Array(await file.slice(0, 1024).arrayBuffer());
  return new TextDecoder('latin1').decode(buf);
}

/**
 * Extract text lines from a PDF File. Throws ImportError with a Hebrew message on any problem.
 * The file content stays in memory only for the duration of this call.
 */
export async function extractPdf(file) {
  if (!file || file.size === 0) throw new ImportError('empty', MSG.empty);
  if (file.size > MAX_BYTES) throw new ImportError('tooLarge', MSG.tooLarge);
  if (!(await readHead(file)).includes('%PDF-')) throw new ImportError('notPdf', MSG.notPdf);

  await warmUp();
  let doc, task;
  try {
    const data = new Uint8Array(await file.arrayBuffer());
    task = pdfjsLib.getDocument({
      data,
      worker,
      useWasm: false,
      isEvalSupported: false,
      disableFontFace: true,
      useSystemFonts: false,
      enableXfa: false,
      disableAutoFetch: true,
      disableStream: true,
      disableRange: true,
      stopAtErrors: false,
      verbosity: 0,
    });
    // No onPassword handler: pdf.js then rejects with PasswordException (we never prompt).
    doc = await task.promise;
  } catch (err) {
    if (err?.name === 'PasswordException' || /password/i.test(err?.message || '')) throw new ImportError('password', MSG.password);
    if (err?.name === 'InvalidPDFException' || err?.name === 'FormatError') throw new ImportError('corrupt', MSG.corrupt);
    throw new ImportError('corrupt', MSG.corrupt);
  }

  try {
    if (doc.numPages > MAX_PAGES) throw new ImportError('tooManyPages', MSG.tooManyPages);
    const pages = [];
    let chars = 0;
    for (let p = 1; p <= doc.numPages; p++) {
      const page = await doc.getPage(p);
      const tc = await page.getTextContent();
      const lines = toLines(tc);
      chars += lines.reduce((s, l) => s + l.text.replace(/\s/g, '').length, 0);
      pages.push({ pageNumber: p, lines });
      page.cleanup();
    }
    if (chars < 20) throw new ImportError('noText', MSG.noText);
    return { numPages: doc.numPages, pages };
  } catch (err) {
    if (err instanceof ImportError) throw err;
    throw new ImportError('corrupt', MSG.corrupt);
  } finally {
    // Free the document; the shared worker stays alive. Never let cleanup mask the result.
    try { await task.destroy(); } catch { /* ignore */ }
  }
}
