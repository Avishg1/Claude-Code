// End-to-end check in a real browser (installed Microsoft Edge, headless) against FICTIONAL fixtures.
// Usage: npm run build && npm run e2e
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const app = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fixtures = path.join(app, 'fixtures', 'projects');
const shots = path.join(app, 'screenshots');
mkdirSync(shots, { recursive: true });
const PORT = 5199;
const BASE = `http://127.0.0.1:${PORT}`;

const EDGE_CANDIDATES = [
  process.env.CCV_BROWSER,
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
].filter(Boolean);
const browserPath = EDGE_CANDIDATES.find((p) => existsSync(p));
if (!browserPath) {
  console.error('No Edge/Chrome found. Set CCV_BROWSER to a Chromium-based browser executable.');
  process.exit(2);
}

spawnSync(process.execPath, [path.join(app, 'scripts', 'make-fixtures.mjs')], { stdio: 'ignore' });
if (!existsSync(path.join(fixtures, 'large-demo-project', 'large-session.jsonl'))) {
  spawnSync(process.execPath, [path.join(app, 'scripts', 'gen-large-fixture.mjs')], { stdio: 'ignore' });
}

function hashTree(dir) {
  const out = {};
  const walk = (d) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, e.name);
      if (e.isDirectory()) walk(full);
      else if (e.isFile()) out[path.relative(dir, full)] = createHash('sha256').update(readFileSync(full)).digest('hex') + ':' + statSync(full).mtimeMs;
    }
  };
  walk(dir);
  return JSON.stringify(out);
}
const before = hashTree(fixtures);

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok: !!ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
};

const server = spawn(process.execPath, [path.join(app, 'dist', 'server', 'index.js')], {
  env: { ...process.env, CCV_ROOT: fixtures, CCV_PORT: String(PORT) },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let serverLog = '';
server.stdout.on('data', (d) => (serverLog += d));
server.stderr.on('data', (d) => (serverLog += d));
await new Promise((resolve, reject) => {
  const t = setTimeout(() => reject(new Error('server did not start')), 10000);
  server.stdout.on('data', () => {
    if (serverLog.includes('http://127.0.0.1')) {
      clearTimeout(t);
      resolve();
    }
  });
});

const browser = await chromium.launch({ executablePath: browserPath, headless: true });
const external = [];
const consoleErrors = [];

async function newPage(viewport) {
  const ctx = await browser.newContext({ viewport, locale: 'he-IL', permissions: ['clipboard-read', 'clipboard-write'] });
  // Record and block anything that is not the local app.
  await ctx.route('**/*', (route) => {
    const url = route.request().url();
    if (url.startsWith(BASE + '/')) return route.continue();
    external.push(url);
    return route.abort();
  });
  const page = await ctx.newPage();
  page.on('console', (m) => m.type() === 'error' && consoleErrors.push(m.text()));
  page.on('pageerror', (e) => consoleErrors.push(String(e)));
  return { ctx, page };
}

const projectItem = (page, name) => page.locator('[role="listbox"][aria-label="רשימת פרויקטים"] [role="option"]', { hasText: name });
const escRe = (t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const fileItem = (page, name) =>
  page
    .locator('[role="listbox"][aria-label^="קובצי השיחה"] [role="option"]')
    .filter({ has: page.locator('.item-name', { hasText: new RegExp(`^${escRe(name)}$`) }) });
const noHScroll = (page) => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1);

try {
  /* ------------------------------------------------------------ desktop */
  const { ctx, page } = await newPage({ width: 1440, height: 900 });
  await page.goto(BASE + '/');
  await page.waitForSelector('[role="listbox"][aria-label="רשימת פרויקטים"]');
  check('html is lang=he dir=rtl', (await page.getAttribute('html', 'lang')) === 'he' && (await page.getAttribute('html', 'dir')) === 'rtl');
  const rootText = await page.locator('.root-path').innerText();
  check('configured root is shown', rootText.trim() === fixtures, rootText);
  check('file panel asks to select a project first', await page.getByText('בחרו תחילה פרויקט מהרשימה.').isVisible());

  await projectItem(page, 'C--demo-alpha-project').click();
  await page.waitForSelector('[role="listbox"][aria-label^="קובצי השיחה"]');
  const fileIds = await page.locator('[role="listbox"][aria-label^="קובצי השיחה"] .item-name').allInnerTexts();
  check('nested subagent file listed by relative path', fileIds.includes('11111111-demo-4000-8000-000000000001/subagents/agent-demo0001.jsonl'), fileIds.join(' | '));
  check('non-jsonl file not listed', !fileIds.some((f) => f.includes('notes.txt')));

  await fileItem(page, '11111111-demo-4000-8000-000000000001.jsonl').click();
  await page.waitForSelector('article.record');
  const kinds = await page.locator('article.record').evaluateAll((els) => els.map((e) => [...e.classList].find((c) => c.startsWith('kind-'))));
  check(
    'roles & order match the file',
    JSON.stringify(kinds) ===
      JSON.stringify(['kind-summary', 'kind-human', 'kind-assistant', 'kind-tool-result', 'kind-assistant', 'kind-tool-result', 'kind-human', 'kind-assistant', 'kind-system', 'kind-meta', 'kind-human', 'kind-assistant', 'kind-unknown', 'kind-unknown']),
    kinds.join(','),
  );
  const lines = await page.locator('article.record').evaluateAll((els) => els.map((e) => e.dataset.line).join(','));
  check('source line numbers shown in order', lines === '1,2,3,4,5,6,7,8,9,10,11,12,13,14', lines);
  check('header shows project and file', (await page.locator('.conv-title').innerText()).includes('11111111-demo-4000-8000-000000000001.jsonl'));
  check('selected project & file are marked', (await page.locator('[role="option"][aria-selected="true"]').count()) === 2);
  check('cwd shown only as secondary label from record field', (await page.locator('.secondary-label').innerText()) === 'C:\\demo\\alpha-project');
  const humanText = await page.locator('article.record.kind-human').first().innerText();
  check('Hebrew/English text preserved', humanText.includes('שלום! יש לי באג') && humanText.includes('Can you take a look?'));
  const pre = page.locator('.code-block pre').first();
  check('code block is LTR', (await pre.evaluate((e) => getComputedStyle(e).direction)) === 'ltr');
  check('code block has language label + copy button', (await page.locator('.code-block .code-lang').first().innerText()) === 'ts' && (await page.locator('.code-block button').count()) > 0);
  await page.locator('.code-block button').first().click();
  const clip = await page.evaluate(() => navigator.clipboard.readText()).catch(() => null);
  check('copy-code copies exact code (clipboard CRLF normalized)', clip?.replace(/\r\n/g, '\n') === 'export function sortItems(a: number[]) {\n  return [...a].sort((x, y) => x - y);\n}', String(clip));
  // tool call collapsible + jump to its result
  await page.locator('details.tool-use summary', { hasText: 'Read' }).click();
  await page.getByRole('button', { name: /מעבר לתוצאה/ }).first().click();
  const focusedId = await page.evaluate(() => document.activeElement?.id);
  check('tool call links to its result record by id', focusedId === 'rec-3', String(focusedId));
  // open the long tool output and verify it scrolls inside the card, not the page
  await page.locator('details.tool-result summary').first().click();
  const toolOut = page.locator('pre.tool-output').first();
  const overflow = await toolOut.evaluate((e) => e.scrollWidth > e.clientWidth);
  check('long tool output scrolls horizontally inside its box', overflow);
  check('no horizontal page scrollbar (desktop)', await noHScroll(page));
  check('unknown block offered as raw JSON', (await page.locator('details.unknown-block summary').innerText()).includes('future_block_type'));
  check('image block not loaded (no <img> in conversation)', (await page.locator('.conversation img').count()) === 0);
  // raw JSON toggle
  await page.locator('article.record.kind-human').first().getByRole('button', { name: 'JSON גולמי' }).click();
  check('raw JSON toggle shows record JSON', (await page.locator('article.record.kind-human .record-raw pre').first().innerText()).includes('"sessionId"'));
  await page.screenshot({ path: path.join(shots, 'desktop-conversation.png') });

  // shapes observed in a real file (fictional values): compact metadata rows, attachment, aiTitle
  await fileItem(page, '22222222-demo-4000-8000-000000000002.jsonl').click();
  await page.waitForSelector('article.record.compact');
  check('metadata rendered as compact rows', (await page.locator('article.record.compact').count()) === 9);
  check('aiTitle shown as secondary label in header', (await page.locator('.conv-facts').innerText()).includes('כותרת בדויה: יצירת README'));
  const att = page.locator('article.record.compact', { hasText: 'צרופה: date' });
  await att.locator('summary').click();
  await att.locator('.rendered-content').waitFor();
  check('attachment rendered content viewable on demand', (await att.innerText()).includes('Fictional rendered context') && (await att.innerText()).includes('renderedRole: system'));
  await page.getByLabel('מטא-נתונים וצרופות').uncheck();
  check('metadata filter hides rows and reports the count', (await page.locator('article.record').count()) === 5 && (await page.locator('.hidden-info').first().innerText()).includes('8 רשומות מוסתרות'));
  await page.getByRole('button', { name: 'ניקוי מסננים' }).first().click();
  await page.screenshot({ path: path.join(shots, 'desktop-observed-shapes.png') });
  await fileItem(page, '11111111-demo-4000-8000-000000000001.jsonl').click();
  await page.waitForSelector('article.record.kind-summary');

  // filters
  await page.getByLabel('תוצאות כלים').uncheck();
  const hiddenTxt = await page.locator('.hidden-info').first().innerText();
  check('filter shows hidden count', hiddenTxt.includes('2 רשומות מוסתרות'), hiddenTxt);
  await page.getByRole('button', { name: 'ניקוי מסננים' }).first().click();
  check('clear filters restores all records', (await page.locator('article.record').count()) === 14);

  // project switch clears file and conversation immediately
  await projectItem(page, 'E--demo-edge-cases').click();
  check('changing project clears conversation', (await page.locator('article.record').count()) === 0 && (await page.getByText('בחרו קובץ שיחה כדי להציג את ההתכתבות.').isVisible()));
  check('changing project clears file selection', (await page.locator('[role="option"][aria-selected="true"]').count()) === 1);

  // malformed + partial
  await fileItem(page, 'malformed-and-partial.jsonl').click();
  await page.waitForSelector('article.record');
  const mk = await page.locator('article.record').evaluateAll((els) => els.map((e) => `${[...e.classList].find((c) => c.startsWith('kind-'))}@${e.dataset.line}`).join(','));
  check('malformed + partial lines shown as warnings with valid lines kept', mk === 'kind-human@1,kind-malformed@4,kind-assistant@5,kind-pending@6', mk);
  check('warning banner shown', (await page.locator('.alert-warning').innerText()).includes('1 שורות פגומות'));
  await page.locator('article.kind-malformed summary').click();
  check('malformed raw line inspectable on demand', (await page.locator('article.kind-malformed pre').innerText()).includes('this is not json'));
  await page.screenshot({ path: path.join(shots, 'desktop-warnings.png') });

  // hostile markdown
  await fileItem(page, 'hostile-markdown.jsonl').click();
  await page.waitForSelector('article.record');
  const pwned = await page.evaluate(() => window.__pwned);
  check('hostile markdown did not execute', pwned === undefined, String(pwned));
  check('no img/iframe/script elements rendered from content', (await page.locator('.conversation img, .conversation iframe, .conversation script').count()) === 0);
  const anchors = await page.locator('.conversation a').evaluateAll((as) => as.map((a) => `${a.getAttribute('href')}|${a.target}|${a.rel}`));
  check(
    'only safe links are anchors, with target=_blank and noopener',
    anchors.length === 2 && anchors.every((a) => a === 'https://example.org/page?q=1|_blank|noopener noreferrer nofollow'),
    anchors.join(' ; '),
  );

  // branching
  await fileItem(page, 'branching.jsonl').click();
  await page.waitForSelector('article.record');
  check('branching labeled', (await page.locator('.badge-branch').count()) >= 2 && (await page.locator('article.record').count()) === 5);

  // stale request race: click two files rapidly
  await fileItem(page, 'branching.jsonl').click();
  await fileItem(page, 'malformed-and-partial.jsonl').click();
  await fileItem(page, 'hostile-markdown.jsonl').click();
  await page.waitForSelector('article.record');
  await page.waitForTimeout(400);
  const title = await page.locator('.conv-title').innerText();
  const body = await page.locator('.conv-scroll').innerText();
  check('rapid selection shows only the last-selected file', title.includes('hostile-markdown.jsonl') && body.includes('safe link') && !body.includes('Branch root'), title);

  // empty file
  await fileItem(page, 'empty.jsonl').click();
  await page.waitForSelector('.conv-scroll');
  check('empty file state', (await page.locator('.conv-scroll').innerText()).includes('הקובץ ריק'));

  // empty project
  await projectItem(page, 'D--demo-empty-project').click();
  await page.waitForTimeout(300);
  check('empty project state', await page.getByText('לא נמצאו קובצי').isVisible());

  // large file: progress, pagination, full-file search, jump bottom, refresh anchoring
  await projectItem(page, 'large-demo-project').click();
  await fileItem(page, 'large-session.jsonl').click();
  const t0 = Date.now();
  await page.waitForSelector('article.record', { timeout: 60000 });
  const loadMs = Date.now() - t0;
  const facts = await page.locator('.conv-facts').innerText();
  check('large file fully loaded (30,000 records)', facts.includes('30,000'), `${loadMs} ms`);
  check('large file paginated (100 records rendered)', (await page.locator('article.record').count()) === 100);
  const scrollable = await page.locator('.conv-scroll').evaluate((e) => e.scrollHeight > e.clientHeight);
  check('conversation area scrolls', scrollable);
  await page.locator('#conv-search').fill('needle-marker');
  await page.waitForTimeout(400);
  const mc = await page.locator('.match-count').innerText();
  check('match count covers whole file', mc.includes('12 רשומות תואמות'), mc);
  await page.getByRole('button', { name: 'התאמה קודמת' }).click(); // wraps to last match
  await page.waitForTimeout(200);
  const cur = page.locator('article.record.is-current');
  const curLine = await cur.getAttribute('data-line');
  const inView = await cur.evaluate((el) => {
    const box = el.closest('.conv-scroll').getBoundingClientRect();
    const r = el.getBoundingClientRect();
    return r.top < box.bottom && r.bottom > box.top;
  });
  check('prev match jumps to last occurrence on a far page and scrolls it into view', curLine === '29998' && inView, `line ${curLine}`);
  const layoutStable = await page.evaluate(() => {
    const app = document.querySelector('.app');
    const head = document.querySelector('.conv-header').getBoundingClientRect();
    return document.scrollingElement.scrollTop === 0 && app.scrollTop === 0 && document.querySelector('.app-header').getBoundingClientRect().top === 0 && head.top >= 0 && head.bottom < innerHeight;
  });
  check('page itself never scrolls; header + file header stay visible after jump', layoutStable);
  const highlightCount = await page.evaluate(() => (CSS.highlights?.get('ccv-search-current')?.size ?? -1));
  check('current match highlighted in text', highlightCount >= 1, String(highlightCount));
  await page.screenshot({ path: path.join(shots, 'desktop-large-search.png') });
  await page.locator('#conv-search').fill('');
  await page.getByRole('button', { name: /לסוף הקובץ/ }).click();
  await page.waitForTimeout(200);
  const lastVisible = await page.locator('article.record').last().evaluate((el) => {
    const box = el.closest('.conv-scroll').getBoundingClientRect();
    const r = el.getBoundingClientRect();
    return { line: el.dataset.line, visible: r.bottom <= box.bottom + 2 && r.bottom > box.top };
  });
  check('jump to bottom shows the final record', lastVisible.line === '30000' && lastVisible.visible, JSON.stringify(lastVisible));

  // refresh keeps reading position (go to a middle page, scroll, refresh)
  await page.getByRole('button', { name: /לתחילת הקובץ/ }).click();
  for (let i = 0; i < 4; i++) await page.getByRole('button', { name: 'הבא ←' }).click();
  await page.locator('.conv-scroll').evaluate((e) => (e.scrollTop = 1500));
  await page.waitForTimeout(150);
  const anchorBefore = await page.evaluate(() => {
    const box = document.querySelector('.conv-scroll').getBoundingClientRect();
    return [...document.querySelectorAll('article.record')].find((el) => el.getBoundingClientRect().bottom > box.top + 1)?.dataset.line;
  });
  await page.getByRole('button', { name: /רענון קובץ/ }).click();
  await page.waitForSelector('.alert-info', { timeout: 30000 });
  await page.waitForTimeout(200);
  const anchorAfter = await page.evaluate(() => {
    const box = document.querySelector('.conv-scroll').getBoundingClientRect();
    return [...document.querySelectorAll('article.record')].find((el) => el.getBoundingClientRect().bottom > box.top + 1)?.dataset.line;
  });
  check('refresh keeps reading position (no jump)', anchorBefore && anchorBefore === anchorAfter, `${anchorBefore} -> ${anchorAfter}`);

  // project switch while a large file is loading
  await projectItem(page, 'C--demo-alpha-project').click();
  await fileItem(page, '11111111-demo-4000-8000-000000000001.jsonl').click();
  await page.waitForSelector('article.record');
  await projectItem(page, 'large-demo-project').click();
  await fileItem(page, 'large-session.jsonl').click();
  await projectItem(page, 'E--demo-edge-cases').click(); // immediately switch away
  await page.waitForTimeout(2500);
  check('switching project during a load never shows the stale file', (await page.locator('article.record').count()) === 0);

  // keyboard navigation in the project list
  await projectItem(page, 'C--demo-alpha-project').focus();
  await page.keyboard.press('Home');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(300);
  check('keyboard: arrows + Enter select a project', (await page.locator('[role="listbox"][aria-label="רשימת פרויקטים"] [aria-selected="true"]').count()) === 1);
  const outline = await page.evaluate(() => getComputedStyle(document.activeElement).outlineStyle);
  check('visible focus indicator', outline === 'solid', outline);
  await ctx.close();

  /* ------------------------------------------------------------ narrow */
  const n = await newPage({ width: 390, height: 844 });
  await n.page.goto(BASE + '/');
  await projectItem(n.page, 'C--demo-alpha-project').click();
  await n.page.screenshot({ path: path.join(shots, 'narrow-pickers.png'), fullPage: true });
  await fileItem(n.page, '11111111-demo-4000-8000-000000000001.jsonl').click();
  await n.page.waitForSelector('article.record');
  await n.page.locator('details.tool-result summary').first().click();
  check('no horizontal page scrollbar (narrow)', await noHScroll(n.page));
  await n.page.locator('.conversation').scrollIntoViewIfNeeded();
  await n.page.locator('article.record.kind-assistant').nth(1).scrollIntoViewIfNeeded();
  await n.page.screenshot({ path: path.join(shots, 'narrow-conversation.png') });
  await n.ctx.close();
} catch (err) {
  check('e2e run completed without exceptions', false, String(err?.stack ?? err));
} finally {
  await browser.close();
  server.kill();
}

check('no external network requests', external.length === 0, external.join(', '));
check('no console errors / CSP violations', consoleErrors.length === 0, consoleErrors.join(' | '));
check('fixture files unchanged', hashTree(fixtures) === before);
check('server log has no file names or content', !/demo-alpha|jsonl|large-session|project=/.test(serverLog.split('\n').filter((l) => !l.includes('Root (')).join('\n')));

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed. Screenshots: ${shots}`);
process.exit(failed.length ? 1 : 0);
