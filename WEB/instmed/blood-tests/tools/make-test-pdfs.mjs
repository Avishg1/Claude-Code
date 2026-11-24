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
  {
    file: 'delta-2026-10-05-hebrew-extra-columns.pdf',
    lang: 'he', dir: 'rtl',
    // Extra columns (date, notes), other header words, and larger bold test names than the numbers.
    css: 'td:nth-child(2) { font-size: 13pt; font-weight: bold; } td { font-size: 9.5pt; }',
    lines: ['מעבדת דלתא (בדיונית)', 'מסמך הדגמה בדיוני — אינו דוח מעבדה אמיתי', 'תאריך קבלת דגימה: 05/10/2026'],
    header: ['תאריך', 'שם בדיקה', 'תוצאות', 'יחידות מידה', 'ערכים תקינים', 'הערות'], unitCol: 3,
    rows: [
      ['05/10/2026', 'המוגלובין (Hemoglobin)', '13.0', 'g/dL', '12.0-16.0', ''],
      ['05/10/2026', 'גלוקוז בצום', '88', 'mg/dL', '70-100', ''],
      ['05/10/2026', 'פריטין', '25', 'ng/mL', '15-150', ''],
      ['05/10/2026', 'ויטמין B12', '520', 'pg/mL', '200-900', ''],
      ['05/10/2026', 'כולסטרול LDL', '131', 'mg/dL', '< 130', 'גבוה'],
    ],
    expected: { date: '2026-10-05', lab: 'מעבדת דלתא (בדיונית)' },
    toExpected: ([, name, value, unit, range]) => ({ name, value, unit, range }),
  },
  {
    file: 'epsilon-2026-10-20-english-no-name-header.pdf',
    lang: 'en', dir: 'ltr',
    // Blank header above the test names; "Normal values" / "Status" columns; one blank value.
    lines: ['Epsilon Clinical Lab (fictional)', 'FICTIONAL DEMO DOCUMENT - NOT A REAL LAB REPORT', 'Date of collection: 2026-10-20'],
    header: ['', 'Results', 'Units', 'Normal values', 'Status'],
    rows: [
      ['Sodium', '140', 'mmol/L', '136 - 145', ''],
      ['Potassium', '4.1', 'mmol/L', '3.5 - 5.1', ''],
      ['Calcium', '10.9', 'mg/dL', '8.6 - 10.3', 'High'],
      ['Magnesium', '', 'mg/dL', '1.7 - 2.2', ''],
    ],
    expected: { date: '2026-10-20', lab: 'Epsilon Clinical Lab (fictional)' },
    toExpected: ([name, value, unit, range]) => (value ? { name, value, unit, range } : { name, value: '', valueStatus: 'missing', unit, range }),
  },
  {
    file: 'eta-2026-10-28-hebrew-tight-columns.pdf',
    lang: 'he', dir: 'rtl',
    // No table: each row is one line of text with single spaces, so the PDF has no column gaps.
    asText: true,
    lines: ['מעבדת אטה (בדיונית)', 'מסמך הדגמה בדיוני — אינו דוח מעבדה אמיתי', 'תאריך בדיקה: 28/10/2026'],
    header: ['שם בדיקה', 'תוצאה', 'יחידות', 'טווח ייחוס'],
    rows: [
      ['המוגלובין', '13.1', 'g/dL', '12.0-16.0'],
      ['גלוקוז', '91', 'mg/dL', '70-100'],
      ['כולסטרול כללי', '201', 'mg/dL', '< 200'],
      ['TSH', '1.9', 'mIU/L', '0.4-4.0'],
      ['ויטמין D', '—', 'ng/mL', '30-100'],
    ],
    expected: { date: '2026-10-28', lab: 'מעבדת אטה (בדיונית)' },
    toExpected: ([name, value, unit, range]) => (value === '—' ? { name, value: '', valueStatus: 'missing', unit, range } : { name, value, unit, range }),
  },
  {
    file: 'theta-2026-11-03-hebrew-range-bar.pdf',
    lang: 'he', dir: 'rtl',
    // Layout seen on some Israeli lab result PDFs: no unit column (unit printed with the result),
    // and a graphical "result vs. normal range" column that prints only the two limits.
    css: 'td { vertical-align: top; } .bar { display: inline-flex; align-items: center; gap: 6px; } .track { display: inline-block; width: 110px; height: 8px; background: #cfe3d6; border-radius: 4px; position: relative; } .mark { position: absolute; top: -16px; left: 70px; font-size: 9pt; } .limits { display: flex; justify-content: space-between; width: 170px; font-size: 9pt; color: #444; }',
    lines: ['מעבדת תטא (בדיונית)', 'מסמך הדגמה בדיוני — אינו דוח מעבדה אמיתי', 'תאריך בדיקה: 03/11/2026'],
    header: ['שם הבדיקה', 'תוצאה', 'תוצאה לעומת טווח הנורמה'],
    rowsHtml: [
      ['המוגלובין', '13.4 <span dir="ltr">g/dL</span>', "<div class=\"bar\"><span>12.0</span><span class=\"track\"></span><span>16.0</span></div>"],
      ['גלוקוז', '96 <span dir="ltr">mg/dL</span>', '<div class="bar"><span class="track"></span></div><div class="limits"><span>70</span><span>100</span></div>'],
      ['TSH', '5.9 <span dir="ltr">mIU/L</span>', "<div class=\"bar\"><span>0.4</span><span class=\"track\"><span class=\"mark\">5.9</span></span><span>4.0</span></div>"],
      ['כולסטרול כללי', '188 <span dir="ltr">mg/dL</span>', '&lt; 200'],
      ['ויטמין D', '— <span dir="ltr">ng/mL</span>', "<div class=\"bar\"><span>30</span><span class=\"track\"></span><span>100</span></div>"],
    ],
    expectedRows: [
      { name: 'המוגלובין', value: '13.4', unit: 'g/dL', range: '', rangeStatus: 'unclear', rangeHint: '12.0-16.0' },
      { name: 'גלוקוז', value: '96', unit: 'mg/dL', range: '', rangeStatus: 'unclear', rangeHint: '70-100' },
      { name: 'TSH', value: '5.9', unit: 'mIU/L', range: '', rangeStatus: 'unclear', rangeHint: '0.4-4.0' },
      { name: 'כולסטרול כללי', value: '188', unit: 'mg/dL', range: '< 200' },
      { name: 'ויטמין D', value: '', valueStatus: 'missing', unit: 'ng/mL', range: '', rangeStatus: 'unclear', rangeHint: '30-100' },
    ],
    expected: { date: '2026-11-03', lab: 'מעבדת תטא (בדיונית)' },
  },
];

function reportHtml(r) {
  if (r.asText) {
    return `<!DOCTYPE html><html lang="${r.lang}" dir="${r.dir}"><head><meta charset="utf-8"><title>-</title>
<style>@page { size: A4; margin: 18mm; } body { font-family: Arial, sans-serif; font-size: 11pt; } p { margin: 4px 0; } .top p:first-child { font-size: 16pt; font-weight: bold; } .demo { color: #a00; font-weight: bold; } .hdr { font-weight: bold; margin-top: 14px; }</style></head><body>
<div class="top">${r.lines.map((l, i) => `<p class="${i === 1 ? 'demo' : ''}">${esc(l)}</p>`).join('')}</div>
<p class="hdr">${esc(r.header.join(' '))}</p>
${r.rows.map((row) => `<p>${esc(row.join(' '))}</p>`).join('')}
</body></html>`;
  }
  return `<!DOCTYPE html><html lang="${r.lang}" dir="${r.dir}"><head><meta charset="utf-8"><title>-</title>
<style>
  @page { size: A4; margin: 18mm; }
  body { font-family: Arial, sans-serif; font-size: 11pt; color: #111; }
  .top p { margin: 3px 0; } .top p:first-child { font-size: 16pt; font-weight: bold; margin-bottom: 8px; }
  .demo { color: #a00; font-weight: bold; }
  table { border-collapse: collapse; margin-top: 18px; width: 100%; }
  th, td { padding: 6px 12px; border-bottom: 1px solid #bbb; text-align: start; }
  th { background: #eee; }
  ${r.css || ''}
</style></head><body>
<div class="top">${r.lines.map((l, i) => `<p class="${i === 1 ? 'demo' : ''}">${esc(l)}</p>`).join('')}</div>
<table><thead><tr>${r.header.map((h) => `<th>${esc(h)}</th>`).join('')}</tr></thead>
<tbody>${r.rowsHtml ? r.rowsHtml.map((row) => `<tr>${row.map((c) => `<td>${c}</td>`).join('')}</tr>`).join('') : r.rows.map((row) => `<tr>${row.map((c, i) => `<td${i === r.unitCol ? ' dir="ltr"' : ''}>${esc(c)}</td>`).join('')}</tr>`).join('')}</tbody></table>
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
  expected.files[r.file] = { kind: 'ok', ...r.expected, rows: r.expectedRows || r.rows.map(r.toExpected) };
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

// Text-based PDF without any results table → "no result rows found" (with the diagnostic view).
const letterHtml = path.join(TMP, 'letter.html');
fs.writeFileSync(letterHtml, `<!DOCTYPE html><html lang="he" dir="rtl"><head><meta charset="utf-8"><style>@page{size:A4;margin:22mm}body{font-family:Arial;font-size:12pt;line-height:1.7}</style></head><body>
<p><b>מכתב הדגמה בדיוני — אינו מסמך רפואי אמיתי</b></p>
<p>שלום רב, זהו מכתב לדוגמה שאין בו טבלת תוצאות. הוא משמש לבדיקה שהמערכת מודיעה בבירור כאשר לא נמצאו שורות תוצאה, ואינה מייבאת דבר.</p>
<p>בברכה, צוות ההדגמה.</p></body></html>`);
printToPdf(letterHtml, path.join(OUT, 'zeta-letter-no-table.pdf'));
expected.files['zeta-letter-no-table.pdf'] = { kind: 'error', code: 'noRows' };
console.log('✓ zeta-letter-no-table.pdf');

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
