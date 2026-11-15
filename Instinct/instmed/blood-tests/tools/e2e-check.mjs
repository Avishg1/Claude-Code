// End-to-end check in a real (headless) Edge/Chrome via the DevTools protocol.
// Starts the local server + browser, imports the FICTIONAL test PDFs, and verifies the acceptance criteria.
//
// Usage:  node tools/e2e-check.mjs [--shots]
//   --shots  also saves screenshots (desktop + mobile) to the OS temp folder
import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 5199, DBG = 9339;
const BASE = `http://127.0.0.1:${PORT}`;
const SHOTS = process.argv.includes('--shots');
const BROWSER = process.env.EDGE_PATH || [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  '/usr/bin/google-chrome', '/usr/bin/chromium',
].find((p) => fs.existsSync(p));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok, detail }); console.log(`${ok ? '✔' : '✘'} ${name}${detail ? ` — ${detail}` : ''}`); };

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'bt-e2e-'));
const server = spawn(process.execPath, [path.join(ROOT, 'server.js')], { env: { ...process.env, PORT }, stdio: 'ignore' });
const browser = spawn(BROWSER, ['--headless=new', '--disable-gpu', `--remote-debugging-port=${DBG}`, `--user-data-dir=${profile}`,
  '--no-first-run', '--disable-extensions', '--disable-background-networking', '--disable-component-update', 'about:blank'], { stdio: 'ignore' });

async function cleanup() {
  server.kill(); browser.kill();
  await sleep(500);
  try { fs.rmSync(profile, { recursive: true, force: true }); } catch { /* browser may still hold files */ }
}

let ws, seq = 0;
const pending = new Map();
const listeners = [];
function send(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = ++seq;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });
}
async function evaluate(expr) {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
  return r.result.value;
}
async function waitFor(expr, timeout = 15000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) { if (await evaluate(expr)) return true; await sleep(100); }
  return false;
}
async function shot(name, width) {
  if (!SHOTS) return;
  await send('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: width < 600 });
  await sleep(400);
  const h = await evaluate('document.documentElement.scrollHeight');
  const { data } = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, clip: { x: 0, y: 0, width, height: Math.min(h, 7000), scale: 1 } });
  const file = path.join(os.tmpdir(), `bt-e2e-${name}.png`);
  fs.writeFileSync(file, Buffer.from(data, 'base64'));
  console.log('  screenshot:', file);
}

async function main() {
  if (!BROWSER) throw new Error('Edge/Chrome not found. Set EDGE_PATH.');
  // Connect
  let target;
  for (let i = 0; i < 50 && !target; i++) {
    try { target = await (await fetch(`http://127.0.0.1:${DBG}/json/new?about:blank`, { method: 'PUT' })).json(); } catch { await sleep(200); }
  }
  ws = new WebSocket(target.webSocketDebuggerUrl);
  ws.onmessage = (m) => {
    const d = JSON.parse(m.data);
    if (d.id && pending.has(d.id)) { const p = pending.get(d.id); pending.delete(d.id); d.error ? p.reject(new Error(d.error.message)) : p.resolve(d.result); }
    else if (d.method) listeners.forEach((fn) => fn(d));
  };
  await new Promise((r) => (ws.onopen = r));

  const requests = [];
  listeners.push((e) => { if (e.method === 'Network.requestWillBeSent') requests.push(e.params.request.url); });
  listeners.push((e) => {
    if (e.method === 'Runtime.consoleAPICalled' && ['error', 'warning'].includes(e.params.type)) {
      console.log(`  [browser ${e.params.type}]`, e.params.args.map((a) => a.value ?? a.description ?? '').join(' ').slice(0, 400));
    }
    if (e.method === 'Runtime.exceptionThrown') console.log('  [browser exception]', e.params.exceptionDetails.exception?.description?.slice(0, 400));
  });
  await send('Network.enable');
  await send('Page.enable');
  await send('Runtime.enable');
  await send('DOM.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1366, height: 900, deviceScaleFactor: 1, mobile: false });

  /* ---------- Demo dashboard ---------- */
  await send('Page.navigate', { url: `${BASE}/#/` });
  await waitFor(`document.querySelectorAll('#resultsBody tr').length > 0 && document.querySelectorAll('.chart-card').length > 0`);
  await sleep(800);
  check('App loads and shows demo data', await evaluate(`document.querySelectorAll('#resultsBody tr').length === 20`), '20 tests in the latest demo report');
  check('20 demo trend charts (one per test)', await evaluate(`document.querySelectorAll('.chart-card').length === 20`));
  check('Demo caption shown', await evaluate(`document.querySelector('.notices').textContent.includes('נתוני הדגמה בדיוניים בלבד - אינם ערכים רפואיים אמיתיים')`));
  check('Display-only caption shown', await evaluate(`document.querySelector('.notices').textContent.includes('המידע להצגה בלבד ואינו מהווה ייעוץ רפואי')`));
  check('lang="he" dir="rtl"', await evaluate(`document.documentElement.lang === 'he' && document.documentElement.dir === 'rtl'`));
  check('Demo: range change visible in chart (hemoglobin)', await evaluate(`[...document.querySelectorAll('.chart-card')].find(c => c.textContent.includes('Hemoglobin')).querySelectorAll('line.range-change').length >= 1`));
  check('Demo: missing value shown as "חסר" in chart', await evaluate(`[...document.querySelectorAll('.chart-card')].some(c => c.querySelector('rect.pill-missing'))`));
  const demoRow = (date, he) => evaluate(`(() => { document.querySelector('[data-date="${date}"]').click();
    const tr = [...document.querySelectorAll('#resultsBody tr')].find(r => r.querySelector('.test-he').textContent.trim() === ${JSON.stringify(he)});
    return [...tr.cells].slice(1).map(c => c.innerText.replace(/\\s+/g, ' ').trim()).join(' | '); })()`);
  const tshMay = await demoRow('2026-05-11', 'TSH');
  const tshAug = await demoRow('2026-08-03', 'TSH');
  check('Demo flag uses same-report range (TSH 4.2 vs 0.4–4.0 → high)', tshMay.includes('גבוה'), tshMay);
  check('Demo flag uses same-report range (TSH 4.3 vs 0.5–4.5 → in range)', tshAug.includes('בטווח'), tshAug);
  const crea = await demoRow('2026-08-03', 'קריאטינין');
  check('Demo: no range → "טווח ייחוס לא ידוע" + no flag', crea.includes('טווח ייחוס לא ידוע') && crea.includes('ללא סימון'), crea);
  const plt = await demoRow('2026-05-11', 'טסיות דם');
  check('Demo: missing value shown as "חסר"', plt.startsWith('חסר'), plt);
  await shot('desktop-demo', 1366);
  await send('Emulation.setDeviceMetricsOverride', { width: 1366, height: 900, deviceScaleFactor: 1, mobile: false });

  const external = requests.filter((u) => !u.startsWith(BASE) && !u.startsWith('data:') && !u.startsWith('blob:') && u !== 'about:blank');
  check('No external requests (scripts, fonts, APIs)', external.length === 0, external.join(', ') || `${requests.length} local requests`);

  /* ---------- Import ---------- */
  await send('Page.navigate', { url: `${BASE}/#/import` });
  await waitFor(`!document.getElementById('viewImport').hidden`);
  await sleep(1500); // let the pdf.js worker finish starting
  check('Import screen shows both captions', await evaluate(`!document.getElementById('viewImport').hidden && document.querySelector('.notices').offsetHeight > 0`));

  const expected = JSON.parse(fs.readFileSync(path.join(ROOT, 'test-pdfs', 'expected.json'), 'utf8')).files;
  const before = requests.length;
  const { root } = await send('DOM.getDocument', { depth: -1 });
  const ERR_WORD = { noText: 'שכבת טקסט', notPdf: 'אינו קובץ PDF', corrupt: 'פגום', password: 'סיסמה', tooLarge: 'גדול מדי' };

  for (const [file, exp] of Object.entries(expected)) {
    const { nodeId } = await send('DOM.querySelector', { nodeId: root.nodeId, selector: '#fileInput' });
    await send('DOM.setFileInputFiles', { nodeId, files: [path.join(ROOT, 'test-pdfs', file)] });
    const statusExpr = `[...document.querySelectorAll('#fileStatus .fs')].find(li => li.querySelector('.fs-name').textContent === ${JSON.stringify(file)} && !li.classList.contains('fs-busy'))`;
    await waitFor(`!!${statusExpr}`);
    const st = await evaluate(`(() => { const li = ${statusExpr}; return li ? { cls: li.className, msg: li.querySelector('.fs-msg').textContent } : null; })()`);
    if (exp.kind === 'error') {
      check(`${file}: rejected with Hebrew error, nothing imported`, st && st.cls.includes('fs-error') && st.msg.includes(ERR_WORD[exp.code]), st?.msg);
      continue;
    }
    const got = await evaluate(`(() => {
      const sec = [...document.querySelectorAll('.review')].find(s => s.querySelector('h2').textContent.trim() === ${JSON.stringify(file)});
      if (!sec) return null;
      return {
        date: sec.querySelector('.in-date').value,
        lab: sec.querySelector('.in-lab').value,
        rows: [...sec.querySelectorAll('tr[data-row]')].map(tr => ({
          name: tr.querySelector('.in-name').value, value: tr.querySelector('.in-value').value,
          unit: tr.querySelector('.in-unit').value, range: tr.querySelector('.in-range').value,
          status: tr.querySelector('.row-status').textContent, source: tr.querySelector('.src-line').textContent })),
      };
    })()`);
    if (!got) { check(`${file}: review screen shown`, false, st?.msg); continue; }
    check(`${file}: date read correctly`, got.date === exp.date, `${got.date} (expected ${exp.date})`);
    check(`${file}: lab name read as printed`, got.lab === exp.lab, got.lab);
    check(`${file}: row count`, got.rows.length === exp.rows.length, `${got.rows.length} / ${exp.rows.length}`);
    const mismatches = [];
    exp.rows.forEach((er, i) => {
      const g = got.rows[i];
      if (!g) { mismatches.push(`row ${i + 1} missing`); return; }
      for (const k of ['name', 'value', 'unit', 'range']) if (g[k].normalize('NFKC') !== er[k].normalize('NFKC')) mismatches.push(`row ${i + 1} ${k}: "${g[k]}" ≠ "${er[k]}"`);
      if (er.valueStatus === 'missing' && !g.status.includes('ערך: חסר')) mismatches.push(`row ${i + 1}: not marked חסר`);
      if (er.valueStatus === 'unclear' && !g.status.includes('ערך: לא ברור')) mismatches.push(`row ${i + 1}: not marked לא ברור`);
      if (!er.range && !g.status.includes('טווח ייחוס לא ידוע')) mismatches.push(`row ${i + 1}: missing range not marked`);
    });
    check(`${file}: values, units and ranges match the PDF exactly`, mismatches.length === 0, mismatches.join('; ') || `${exp.rows.length} rows`);
    check(`${file}: each row shows its source line`, got.rows.every((r) => r.source.trim().length > 0));
  }

  // Very large file (synthetic, in memory only)
  await evaluate(`(() => {
    const big = new Uint8Array(21 * 1024 * 1024); big.set(new TextEncoder().encode('%PDF-1.7\\n'));
    const dt = new DataTransfer(); dt.items.add(new File([big], 'very-large-test.pdf', { type: 'application/pdf' }));
    const input = document.getElementById('fileInput'); input.files = dt.files; input.dispatchEvent(new Event('change'));
  })()`);
  await waitFor(`[...document.querySelectorAll('#fileStatus .fs')].some(li => li.textContent.includes('very-large-test.pdf') && li.classList.contains('fs-error'))`);
  check('Very large file: Hebrew error, no crash', await evaluate(`[...document.querySelectorAll('#fileStatus .fs')].some(li => li.textContent.includes('very-large-test.pdf') && li.textContent.includes('גדול מדי'))`));

  const importRequests = requests.slice(before).filter((u) => !u.startsWith('data:') && !u.startsWith('blob:')); // data:/blob: never touch the network
  check('PDF import made no network requests', importRequests.length === 0, importRequests.join(', ') || '0 requests during all imports');
  check('Nothing saved before confirmation', await evaluate(`localStorage.getItem('bloodTests.imported.v1') === null`));

  await shot('desktop-review', 1366);
  await shot('mobile-review', 390);
  check('Mobile: import/review screen has no horizontal overflow', await evaluate(`document.documentElement.scrollWidth <= window.innerWidth`));
  await send('Emulation.setDeviceMetricsOverride', { width: 1366, height: 900, deviceScaleFactor: 1, mobile: false });

  // Review edits: delete one row from the Beta review, then confirm all drafts.
  const betaRowsBefore = await evaluate(`[...document.querySelectorAll('.review')].find(s => s.textContent.includes('beta-2026'))?.querySelectorAll('tr[data-row]').length ?? -1`);
  await evaluate(`[...document.querySelectorAll('.review')].find(s => s.textContent.includes('beta-2026'))?.querySelector('tr[data-row]:last-child .del-row')?.click()`);
  const betaRowsAfter = await evaluate(`[...document.querySelectorAll('.review')].find(s => s.textContent.includes('beta-2026'))?.querySelectorAll('tr[data-row]').length ?? -1`);
  check('Review: a row can be deleted before saving', betaRowsBefore > 0 && betaRowsAfter === betaRowsBefore - 1);

  const expectedSaved = Object.values(expected).filter((e) => e.kind === 'ok').reduce((s, e) => s + e.rows.length, 0) - 1;
  while (await evaluate(`!!document.querySelector('.confirm-draft')`)) {
    await evaluate(`document.querySelector('.confirm-draft').click()`);
    await sleep(150);
  }
  const stored = await evaluate(`localStorage.getItem('bloodTests.imported.v1') || ''`);
  const saved = stored ? JSON.parse(stored).records : [];
  check('Confirmed rows saved locally', saved.length === expectedSaved, `${saved.length} / ${expectedSaved}`);
  check('Saved rows are labeled as imported with file name', saved.every((r) => r.source === 'pdf' && r.fileName));
  check('No PDF content kept in storage', !stored.includes('%PDF') && stored.length < 50000, `${stored.length} bytes`);

  /* ---------- Imported data on the dashboard ---------- */
  await send('Page.navigate', { url: `${BASE}/#/` });
  await waitFor(`document.querySelectorAll('#resultsBody tr').length > 0`);
  await sleep(800);
  check('Dashboard switches to imported data after confirm', await evaluate(`document.getElementById('srcPdf').getAttribute('aria-checked') === 'true'`));
  check('Imported rows labeled "PDF · file name"', await evaluate(`[...document.querySelectorAll('#resultsBody tr')].every(tr => tr.querySelector('.badge-pdf'))`));
  check('Imported view does not mix in demo rows', await evaluate(`![...document.querySelectorAll('#resultsBody tr')].some(tr => !tr.classList.contains('row-pdf'))`));
  const glucoseCharts = await evaluate(`[...document.querySelectorAll('.chart-card')].filter(c => c.querySelector('.chart-title').textContent.trim() === 'גלוקוז').map(c => c.querySelector('.chart-unit bdi')?.textContent)`);
  check('Same test name, different units → separate charts', glucoseCharts.length === 2 && new Set(glucoseCharts).size === 2, glucoseCharts.join(' | '));
  check('No chart mixes units', await evaluate(`[...document.querySelectorAll('.chart-card')].every(c => c.querySelectorAll('.chart-unit bdi').length <= 1)`));
  check('Imported: range change visible (hemoglobin 12.0-16.0 → 11.5-15.5)', await evaluate(`[...document.querySelectorAll('.chart-card')].find(c => c.querySelector('.chart-title').textContent.includes('המוגלובין (Hemoglobin)')).querySelectorAll('line.range-change').length >= 1`));
  const impRow = (date, name) => evaluate(`(() => { document.querySelector('[data-date="${date}"]').click();
    const tr = [...document.querySelectorAll('#resultsBody tr')].find(r => r.querySelector('.test-he').textContent.trim() === ${JSON.stringify(name)});
    return tr ? [...tr.cells].slice(1).map(c => c.innerText.replace(/\\s+/g, ' ').trim()).join(' | ') : 'not found'; })()`);
  const vitd = await impRow('2026-06-18', 'ויטמין D');
  check('Imported: missing value shown as "חסר", not filled from March', vitd.startsWith('חסר') && !vitd.includes('27'), vitd);
  const creaJune = await impRow('2026-06-18', 'קריאטינין');
  check('Imported: no range in report → "טווח ייחוס לא ידוע", no flag', creaJune.includes('טווח ייחוס לא ידוע') && creaJune.includes('ללא סימון'), creaJune);
  const tshJune = await impRow('2026-06-18', 'TSH');
  check('Imported: flag against same report range (TSH 4.6 vs 0.4-4.0 → high)', tshJune.includes('גבוה'), tshJune);
  const glu = await impRow('2026-11-02', 'גלוקוז');
  check('Imported: unit copied as written (mmol/L, not converted)', glu.includes('5.4') && glu.includes('mmol/L'), glu);
  await shot('desktop-imported', 1366);
  await shot('mobile-imported', 390);
  check('Mobile: dashboard has no horizontal overflow', await evaluate(`document.documentElement.scrollWidth <= window.innerWidth`));
  await send('Emulation.setDeviceMetricsOverride', { width: 1366, height: 900, deviceScaleFactor: 1, mobile: false });

  /* ---------- Delete all ---------- */
  await send('Page.navigate', { url: `${BASE}/#/import` });
  await waitFor(`!document.getElementById('viewImport').hidden`);
  await evaluate(`window.confirm = () => true; document.getElementById('deleteAllBtn').click()`);
  await sleep(300);
  check('"Delete all imported data" clears storage', await evaluate(`localStorage.getItem('bloodTests.imported.v1') === null`));
  await send('Page.navigate', { url: `${BASE}/#/` });
  await waitFor(`document.querySelectorAll('#resultsBody tr').length > 0`);
  check('After delete: back to demo data', await evaluate(`document.getElementById('srcDemo').getAttribute('aria-checked') === 'true' && document.querySelectorAll('#resultsBody tr').length === 20`));

  const allExternal = requests.filter((u) => !u.startsWith(BASE) && !u.startsWith('data:') && !u.startsWith('blob:') && u !== 'about:blank');
  check('Whole session: no request left this computer', allExternal.length === 0, allExternal.join(', '));
}

main()
  .catch((err) => { check('E2E run completed', false, err.stack || String(err)); })
  .finally(async () => {
    const failed = results.filter((r) => !r.ok);
    console.log(`\n${results.length - failed.length}/${results.length} checks passed.`);
    await cleanup();
    process.exit(failed.length ? 1 : 0);
  });
