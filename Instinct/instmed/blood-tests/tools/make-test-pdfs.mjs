// Generates FICTIONAL lab-report PDFs for testing the importer.
// All names, values, ranges and labs below are invented. Nothing here is real medical data.
//
// Usage:  node tools/make-test-pdfs.mjs
// Needs Microsoft Edge or Google Chrome (headless "print to PDF"). Override with EDGE_PATH=...
import fs from 'fs';
import os from 'os';
import path from 'path';
import crypto from 'crypto';
import { execFileSync } from 'child_process';
import { fileURLToPath, pathToFileURL } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'test-pdfs');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'bt-fixtures-'));

const BROWSER = process.env.EDGE_PATH || [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  '/usr/bin/google-chrome', '/usr/bin/chromium', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
].find((p) => fs.existsSync(p));
if (!BROWSER) { console.error('Edge/Chrome not found. Set EDGE_PATH.'); process.exit(1); }

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/* ---------------- Fictional reports ---------------- */
// Each row: [cells as printed..., expected { name, value, valueStatus, unit, range }]

const reports = [
  {
    file: 'alpha-2026-03-12-hebrew.pdf',
    lang: 'he', dir: 'rtl',
    lines: ['מעבדת אלפא לבדיקות (בדיונית)', 'מסמך הדגמה בדיוני — אינו דוח מעבדה אמיתי', 'שם: מטופל הדגמה', 'תאריך בדיקה: 12/03/2026', 'תאריך הדפסה: 15/03/2026'],
    header: ['שם הבדיקה', 'תוצאה', 'יחידות', 'טווח תקין'], unitCol: 2,
    rows: [
      ['המוגלובין (Hemoglobin)', '13.4', 'g/dL', '12.0-16.0'],
      ['תאי דם לבנים (WBC)', '7.2', '10^3/µL', '4.0-10.5'],
      ['טסיות דם', '255', '10^3/µL', '150-400'],
      ['גלוקוז', '96', 'mg/dL', '70-100'],
      ['כולסטרול כללי', '188', 'mg/dL', '< 200'],
      ['קריאטינין', '0.91', 'mg/dL', '0.6-1.2'],
      ['TSH', '2.4', 'mIU/L', '0.4-4.0'],
      ['ויטמין D', '27', 'ng/mL', '30-100'],
    ],
    expected: { date: '2026-03-12', lab: 'מעבדת אלפא לבדיקות (בדיונית)' },
    toExpected: ([name, value, unit, range]) => ({ name, value, unit, range }),
  },
  {
    file: 'alpha-2026-06-18-hebrew-missing-and-range-change.pdf',
    lang: 'he', dir: 'rtl',
    lines: ['מעבדת אלפא לבדיקות (בדיונית)', 'מסמך הדגמה בדיוני — אינו דוח מעבדה אמיתי', 'שם: מטופל הדגמה', 'תאריך בדיקה: 18/06/2026', 'תאריך הדפסה: 20/06/2026'],
    header: ['שם הבדיקה', 'תוצאה', 'יחידות', 'טווח תקין'], unitCol: 2,
    rows: [
      ['המוגלובין (Hemoglobin)', '12.6', 'g/dL', '11.5-15.5'],   // range changed vs March
      ['תאי דם לבנים (WBC)', '6.8', '10^3/µL', '4.0-10.5'],
      ['טסיות דם', '241', '10^3/µL', '150-400'],
      ['גלוקוז', '103', 'mg/dL', '70-100'],
      ['כולסטרול כללי', '194', 'mg/dL', '< 200'],
      ['קריאטינין', '0.95', 'mg/dL', ''],                       // no range printed
      ['TSH', '4.6', 'mIU/L', '0.4-4.0'],
      ['ויטמין D', '—', 'ng/mL', '30-100'],                      // missing value
    ],
    expected: { date: '2026-06-18', lab: 'מעבדת אלפא לבדיקות (בדיונית)' },
    toExpected: ([name, value, unit, range]) => (value === '—'
      ? { name, value: '', valueStatus: 'missing', unit, range }
      : { name, value, unit, range }),
  },
  {
    file: 'beta-2026-09-14-english.pdf',
    lang: 'en', dir: 'ltr',
    lines: ['Beta Diagnostics Laboratory (fictional)', 'FICTIONAL DEMO DOCUMENT - NOT A REAL LAB REPORT', 'Patient: Demo Patient', 'Collection date: 2026-09-14', 'Report printed: 2026-09-16'],
    header: ['Test', 'Result', 'Flag', 'Units', 'Reference Range'],
    rows: [
      ['Hemoglobin', '12.1', '', 'g/dL', '11.5 - 15.5'],
      ['WBC', '11.4', 'H', '10^3/µL', '4.0 - 10.5'],
      ['Glucose', '5.8', 'H', 'mmol/L', '3.9 - 5.6'],
      ['Total Cholesterol', '4.9', '', 'mmol/L', '< 5.2'],
      ['TSH', '3.1', '', 'mIU/L', '0.5 - 4.5'],
      ['Ferritin', '14', 'L', 'ng/mL', '20 - 200'],
      ['Vitamin B12', '410', '', 'pg/mL', '200 - 900'],
      ['CRP', '<0.5', '', 'mg/L', '< 5'],                       // not a plain number → unclear
    ],
    expected: { date: '2026-09-14', lab: 'Beta Diagnostics Laboratory (fictional)' },
    toExpected: ([name, value, , unit, range]) => (value.startsWith('<')
      ? { name, value: '', valueStatus: 'unclear', unit, range }
      : { name, value, unit, range }),
  },
  {
    file: 'gamma-2026-11-02-mixed.pdf',
    lang: 'he', dir: 'rtl',
    lines: ['מכון גמא לבדיקות (בדיוני)', 'מסמך הדגמה בדיוני — אינו דוח מעבדה אמיתי', 'תאריך דגימה: 02.11.2026'],
    header: ['בדיקה', 'תוצאה', 'Units', 'טווח ייחוס', 'סימון'], unitCol: 2,
    rows: [
      ['המוגלובין (Hemoglobin)', '12.8', 'g/dL', '12.0-15.5', ''],
      ['גלוקוז', '5.4', 'mmol/L', '3.9-5.6', ''],                 // same name as Alpha, different unit
      ['כולסטרול כללי', '4.6', 'mmol/L', '< 5.2', ''],
      ['TSH', '2.2', 'mIU/L', '0.4-4.0', ''],
      ['נתרן (Sodium)', '139', 'mEq/L', '135-145', ''],
      ['אשלגן (Potassium)', '5.3 H', 'mEq/L', '3.5-5.1', 'H'],   // printed flag next to the value
      ['חלבון בשתן', 'שלילי', '', 'שלילי', ''],                    // non-numeric value, no unit
    ],
    expected: { date: '2026-11-02', lab: 'מכון גמא לבדיקות (בדיוני)' },
    toExpected: ([name, value, unit, range]) => {
      if (value === 'שלילי') return { name, value: '', valueStatus: 'unclear', unit: '', unitStatus: 'missing', range };
      return { name, value: value.replace(/\s*H$/, ''), unit, range };
    },
  },
];

function reportHtml(r) {
  return `<!DOCTYPE html><html lang="${r.lang}" dir="${r.dir}"><head><meta charset="utf-8"><title>-</title>
<style>
  @page { size: A4; margin: 18mm; }
  body { font-family: Arial, sans-serif; font-size: 11pt; color: #111; }
  .top p { margin: 3px 0; } .top p:first-child { font-size: 16pt; font-weight: bold; margin-bottom: 8px; }
  .demo { color: #a00; font-weight: bold; }
  table { border-collapse: collapse; margin-top: 18px; width: 100%; }
  th, td { padding: 6px 12px; border-bottom: 1px solid #bbb; text-align: start; }
  th { background: #eee; }
</style></head><body>
<div class="top">${r.lines.map((l, i) => `<p class="${i === 1 ? 'demo' : ''}">${esc(l)}</p>`).join('')}</div>
<table><thead><tr>${r.header.map((h) => `<th>${esc(h)}</th>`).join('')}</tr></thead>
<tbody>${r.rows.map((row) => `<tr>${row.map((c, i) => `<td${i === r.unitCol ? ' dir="ltr"' : ''}>${esc(c)}</td>`).join('')}</tr>`).join('')}</tbody></table>
</body></html>`;
}

function printToPdf(htmlFile, pdfFile) {
  execFileSync(BROWSER, ['--headless=new', '--disable-gpu', '--no-pdf-header-footer', '--print-to-pdf-no-header',
    `--user-data-dir=${path.join(TMP, 'profile')}`, `--print-to-pdf=${pdfFile}`, pathToFileURL(htmlFile).href], { stdio: 'ignore' });
}
function screenshot(htmlFile, pngFile) {
  execFileSync(BROWSER, ['--headless=new', '--disable-gpu', '--hide-scrollbars', '--window-size=900,1100',
    `--user-data-dir=${path.join(TMP, 'profile')}`, `--screenshot=${pngFile}`, pathToFileURL(htmlFile).href], { stdio: 'ignore' });
}

/* ---------------- Password-protected PDF (RC4 40-bit, R2) ---------------- */

const PAD = Buffer.from('28BF4E5E4E758A4164004E56FFFA01082E2E00B6D0683E802F0CA9FE6453697A', 'hex');
const md5 = (...b) => crypto.createHash('md5').update(Buffer.concat(b)).digest();
const padPw = (pw) => Buffer.concat([Buffer.from(pw, 'latin1'), PAD]).subarray(0, 32);
function rc4(key, data) {
  const S = [...Array(256).keys()];
  for (let i = 0, j = 0; i < 256; i++) { j = (j + S[i] + key[i % key.length]) & 255; [S[i], S[j]] = [S[j], S[i]]; }
  const out = Buffer.alloc(data.length);
  for (let k = 0, i = 0, j = 0; k < data.length; k++) {
    i = (i + 1) & 255; j = (j + S[i]) & 255; [S[i], S[j]] = [S[j], S[i]];
    out[k] = data[k] ^ S[(S[i] + S[j]) & 255];
  }
  return out;
}
function encryptedPdf(userPw, ownerPw) {
  const id = crypto.createHash('md5').update('fictional-demo').digest();
  const P = Buffer.alloc(4); P.writeInt32LE(-44);
  const O = rc4(md5(padPw(ownerPw)).subarray(0, 5), padPw(userPw));
  const key = md5(padPw(userPw), O, P, id).subarray(0, 5);
  const U = rc4(key, PAD);
  const objKey = (n) => md5(key, Buffer.from([n & 255, (n >> 8) & 255, (n >> 16) & 255, 0, 0])).subarray(0, 10);
  const content = rc4(objKey(4), Buffer.from('BT /F1 16 Tf 72 720 Td (Fictional demo - password protected) Tj ET', 'latin1'));
  const hex = (b) => `<${b.toString('hex')}>`;
  const objs = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    Buffer.concat([Buffer.from(`<< /Length ${content.length} >>\nstream\n`), content, Buffer.from('\nendstream')]),
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Filter /Standard /V 1 /R 2 /O ${hex(O)} /U ${hex(U)} /P -44 >>`,
  ];
  const parts = [Buffer.from('%PDF-1.4\n')];
  const offsets = [];
  let pos = parts[0].length;
  objs.forEach((o, i) => {
    const b = Buffer.concat([Buffer.from(`${i + 1} 0 obj\n`), Buffer.isBuffer(o) ? o : Buffer.from(o), Buffer.from('\nendobj\n')]);
    offsets.push(pos); pos += b.length; parts.push(b);
  });
  const xref = `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`;
  parts.push(Buffer.from(`${xref}trailer\n<< /Size ${objs.length + 1} /Root 1 0 R /Encrypt 6 0 R /ID [${hex(id)} ${hex(id)}] >>\nstartxref\n${pos}\n%%EOF\n`));
  return Buffer.concat(parts);
}

/* ---------------- Build ---------------- */

fs.mkdirSync(OUT, { recursive: true });
const expected = { _note: 'All fixtures are FICTIONAL demo documents. Expected values are exactly as printed in each PDF.', files: {} };

for (const r of reports) {
  const htmlFile = path.join(TMP, r.file.replace(/\.pdf$/, '.html'));
  fs.writeFileSync(htmlFile, reportHtml(r));
  printToPdf(htmlFile, path.join(OUT, r.file));
  expected.files[r.file] = { kind: 'ok', ...r.expected, rows: r.rows.map(r.toExpected) };
  console.log('✓', r.file);
}

// Scanned / image-only PDF: a picture of the first report, no text layer at all.
const png = path.join(TMP, 'scan.png');
screenshot(path.join(TMP, reports[0].file.replace(/\.pdf$/, '.html')), png);
const scanHtml = path.join(TMP, 'scan.html');
fs.writeFileSync(scanHtml, `<!DOCTYPE html><html><head><meta charset="utf-8"><style>@page{size:A4;margin:0}body{margin:0}img{width:100%;filter:grayscale(1) contrast(1.1)}</style></head><body><img src="data:image/png;base64,${fs.readFileSync(png).toString('base64')}"></body></html>`);
printToPdf(scanHtml, path.join(OUT, 'scanned-no-text-layer.pdf'));
expected.files['scanned-no-text-layer.pdf'] = { kind: 'error', code: 'noText' };
console.log('✓ scanned-no-text-layer.pdf');

fs.writeFileSync(path.join(OUT, 'bad-not-a-pdf.pdf'), 'This is a plain text file with a .pdf extension (fictional test file).\n');
expected.files['bad-not-a-pdf.pdf'] = { kind: 'error', code: 'notPdf' };

fs.writeFileSync(path.join(OUT, 'bad-corrupt.pdf'), Buffer.concat([Buffer.from('%PDF-1.7\n1 0 obj\n<< /Type /Catalog'), crypto.randomBytes(400)]));
expected.files['bad-corrupt.pdf'] = { kind: 'error', code: 'corrupt' };

fs.writeFileSync(path.join(OUT, 'bad-password-protected.pdf'), encryptedPdf('demo-user', 'demo-owner'));
expected.files['bad-password-protected.pdf'] = { kind: 'error', code: 'password' };
console.log('✓ bad-not-a-pdf.pdf, bad-corrupt.pdf, bad-password-protected.pdf');

fs.writeFileSync(path.join(OUT, 'expected.json'), JSON.stringify(expected, null, 2) + '\n');
fs.rmSync(TMP, { recursive: true, force: true });
console.log('Wrote', path.relative(ROOT, OUT));
