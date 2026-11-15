// UI: routing, dashboard (demo / imported — never mixed), PDF import, review, management.
import { esc, fmtDate, fmtNum, fmtUnit, flagOf, rangeTextOf, sameRange, names, seriesKey, parseStrictNumber, isHebrew } from './domain.js';
import { drawChart } from './charts.js';
import { loadImported, addImported, deleteImportBatch, deleteAllImported, exportImported } from './store.js';
import { extractPdf, warmUp, ImportError, errorMessage } from './pdf-extract.js';
import { parseReport } from './parser.js';

const $ = (id) => document.getElementById(id);

const state = {
  demo: [],
  imported: loadImported(),
  source: 'demo',        // 'demo' | 'pdf' — dummy data is the default until something is imported
  selectedDate: { demo: null, pdf: null },
  drafts: [],            // parsed files awaiting review (memory only)
};
if (state.imported.length) state.source = 'pdf';

/* ====================== Small HTML helpers ====================== */

const bdi = (text, dir = 'auto') => `<bdi dir="${dir}">${esc(text)}</bdi>`;

function abbr(rec) {
  const base = rec.source === 'pdf' ? String(rec.nameRaw || '') : String(rec.nameEn || rec.nameHe);
  const latin = base.match(/[A-Za-z][A-Za-z0-9]*/g);
  if (latin?.length) {
    if (latin.length > 1 && latin[0].length > 4) return (latin[0][0] + latin[1][0]).toUpperCase();
    return latin[0].length <= 4 ? latin[0].toUpperCase() : latin[0].slice(0, 3);
  }
  const heb = base.replace(/[^א-ת ]/g, '').trim();
  return heb.slice(0, 2) || '?';
}

const html = {
  avatar: (r) => `<span class="test-avatar ${r.source === 'pdf' ? 'avatar-pdf' : ''}" aria-hidden="true">${esc(abbr(r))}</span>`,
  testName(r, { badge = true } = {}) {
    const n = names(r);
    const primary = isHebrew(n.primary) ? esc(n.primary) : bdi(n.primary, r.source === 'pdf' ? 'auto' : 'ltr');
    const secondary = n.secondary ? `<bdi class="test-en" dir="ltr">${esc(n.secondary)}</bdi>` : '';
    const badgeHtml = badge && r.source === 'pdf'
      ? `<span class="badge-pdf" title="יובא מקובץ PDF">PDF · <bdi dir="ltr">${esc(r.fileName)}</bdi></span>`
      : '';
    return `<span class="test-he">${primary}</span>${secondary}${badgeHtml}`;
  },
  value(r) {
    if (r.value != null) return `<span class="value ltr">${esc(fmtNum(r.value))}</span>`;
    if (r.valueText && String(r.valueText).trim()) return `<span class="value ltr">${esc(r.valueText)}</span> <span class="unclear">לא מספרי</span>`;
    return '<span class="missing">חסר</span>';
  },
  unit: (r) => (String(r.unit ?? '').trim()
    ? `<bdi class="unit" dir="ltr">${esc(fmtUnit(r.unit))}</bdi>`
    : '<span class="range-unknown">יחידה לא ידועה</span>'),
  range(r) {
    const t = rangeTextOf(r);
    return t == null ? '<span class="range-unknown">טווח ייחוס לא ידוע</span>' : `<bdi class="range" dir="ltr">${esc(t)}</bdi>`;
  },
  flag(r) {
    switch (flagOf(r)) {
      case 'high': return '<span class="flag flag-high"><span aria-hidden="true">▲</span> גבוה</span>';
      case 'low': return '<span class="flag flag-low"><span aria-hidden="true">▼</span> נמוך</span>';
      case 'in': return '<span class="flag flag-in">בטווח</span>';
      case 'unknown': return '<span class="flag flag-none">ללא סימון</span>';
      case 'nonnum': return '<span class="flag flag-none">ללא סימון (טווח לא מספרי)</span>';
      case 'unclear': return '<span class="flag flag-none">ללא סימון (ערך לא מספרי)</span>';
      default: return '<span class="flag flag-none" aria-label="אין ערך, אין סימון">—</span>';
    }
  },
};

function toast(msg) {
  const t = $('toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => { t.hidden = true; }, 3500);
}

/* ====================== Tooltip ====================== */

const FLAG_TEXT = {
  high: '▲ גבוה ביחס לטווח שבדוח', low: '▼ נמוך ביחס לטווח שבדוח', in: 'בטווח שבדוח',
  unknown: 'ללא סימון (אין טווח בדוח)', nonnum: 'ללא סימון (טווח לא מספרי)', unclear: 'ללא סימון (ערך לא מספרי)', missing: 'אין ערך בדוח',
};
const tip = {
  show(r, x, y) {
    const t = $('tooltip');
    const val = r.value != null
      ? `<bdi dir="ltr"><strong>${esc(fmtNum(r.value))}</strong> ${esc(fmtUnit(r.unit))}</bdi>`
      : r.valueText ? `<bdi dir="ltr">${esc(r.valueText)}</bdi> (לא מספרי)` : '<strong>חסר</strong>';
    const rt = rangeTextOf(r);
    t.innerHTML = `
      <div class="tt-date">${esc(fmtDate(r.date))}</div>
      <div>ערך: ${val}</div>
      <div>טווח ייחוס: ${rt == null ? 'לא ידוע' : bdi(rt, 'ltr')}</div>
      <div>${FLAG_TEXT[flagOf(r)]}</div>
      <div class="tt-muted">${r.source === 'pdf' ? `יובא מ-PDF: ${bdi(r.fileName, 'ltr')}` : 'נתוני הדגמה בדיוניים'}${r.lab ? ' · ' + esc(r.lab) : ''}</div>`;
    t.hidden = false;
    tip.move(x, y);
  },
  move(x, y) {
    const t = $('tooltip');
    if (t.hidden) return;
    const w = t.offsetWidth, h = t.offsetHeight;
    let top = y - h - 14;
    if (top < 60) top = y + 18;
    t.style.left = `${Math.max(8, Math.min(x - w / 2, window.innerWidth - w - 8))}px`;
    t.style.top = `${top}px`;
  },
  hide() { $('tooltip').hidden = true; },
};

/* ====================== Dashboard ====================== */

const currentRecords = () => (state.source === 'pdf' ? state.imported : state.demo);

function renderSourceBar() {
  $('srcDemo').setAttribute('aria-checked', state.source === 'demo');
  $('srcPdf').setAttribute('aria-checked', state.source === 'pdf');
  $('pdfCount').textContent = state.imported.length ? `(${state.imported.length})` : '';
  $('sourceNote').innerHTML = state.source === 'demo'
    ? 'מוצגים <strong>נתוני הדגמה בדיוניים</strong> — הערכים וטווחי הייחוס אינם נתונים רפואיים אמיתיים.'
    : 'מוצגים <strong>נתונים שיובאו מקובצי PDF</strong> ואושרו ידנית. טווחי הייחוס כפי שהודפסו בכל דוח. נתוני ההדגמה אינם משולבים בתצוגה זו.';
}

function renderDashboard() {
  renderSourceBar();
  const records = currentRecords();
  const empty = state.source === 'pdf' && !records.length;
  $('emptyImported').hidden = !empty;
  $('dashboardContent').hidden = empty;
  if (empty) return;

  const dates = [...new Set(records.map((r) => r.date))].sort();
  let sel = state.selectedDate[state.source];
  if (!dates.includes(sel)) sel = dates[dates.length - 1];
  renderTable(records, dates, sel, false);
  renderCharts(records);
}

function renderTabs(dates, selected) {
  const tabs = $('dateTabs');
  tabs.innerHTML = dates.map((d) => `
    <button class="date-tab" role="tab" type="button" data-date="${esc(d)}"
      aria-selected="${d === selected}" tabindex="${d === selected ? 0 : -1}">${esc(fmtDate(d))}</button>`).join('');
  tabs.onclick = (e) => {
    const btn = e.target.closest('.date-tab');
    if (btn) renderTable(currentRecords(), dates, btn.dataset.date, true);
  };
  tabs.onkeydown = (e) => {
    const delta = { ArrowLeft: 1, ArrowRight: -1 }[e.key]; // RTL
    if (delta == null) return;
    e.preventDefault();
    const i = dates.indexOf(selected);
    renderTable(currentRecords(), dates, dates[(i + delta + dates.length) % dates.length], true);
  };
}

const ICONS = {
  total: '<path d="M9 3h6M10 3v6l-5 9a2 2 0 0 0 1.7 3h10.6a2 2 0 0 0 1.7-3l-5-9V3"/>',
  out: '<path d="M12 4v16M5 11l7-7 7 7"/>',
  missing: '<circle cx="12" cy="12" r="9" stroke-dasharray="3 3"/>',
  unknown: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.5 2.5 0 0 1 4.9.8c0 1.7-2.4 2.2-2.4 3.7M12 17h.01"/>',
};

function renderTable(records, dates, date, focusTab) {
  state.selectedDate[state.source] = date;
  renderTabs(dates, date);
  if (focusTab) $('dateTabs').querySelector(`[data-date="${date}"]`)?.focus();

  const rows = records.filter((r) => r.date === date);
  const labs = [...new Set(rows.map((r) => r.lab).filter(Boolean))];
  const files = [...new Set(rows.map((r) => r.fileName).filter(Boolean))];
  $('reportMeta').innerHTML = `
    <span>תאריך בדיקה: <strong>${esc(fmtDate(date))}</strong></span>
    ${labs.length ? `<span>מעבדה: <strong>${labs.map(esc).join(', ')}</strong></span>` : ''}
    ${files.length ? `<span>קובץ: <strong>${files.map((f) => bdi(f, 'ltr')).join(', ')}</strong></span>` : ''}
    <span>${rows.length} בדיקות</span>`;

  // Counts only — a summary of what is shown, not an interpretation.
  const count = (k) => rows.filter((r) => flagOf(r) === k).length;
  const hi = count('high'), lo = count('low');
  const tile = (key, value, label, detail = '') => `
    <div class="stat">
      <span class="stat-icon i-${key}" aria-hidden="true"><svg viewBox="0 0 24 24">${ICONS[key]}</svg></span>
      <div><div class="stat-value">${value}${detail ? `<span class="stat-detail">${detail}</span>` : ''}</div><div class="stat-label">${label}</div></div>
    </div>`;
  $('summary').innerHTML =
    tile('total', rows.length, 'בדיקות בדוח') +
    tile('out', hi + lo, 'מחוץ לטווח שבדוח', hi + lo ? `▲${hi} · ▼${lo}` : '') +
    tile('missing', count('missing') + count('unclear'), 'ערכים חסרים / לא מספריים') +
    tile('unknown', rows.filter((r) => rangeTextOf(r) == null).length, 'ללא טווח ייחוס');

  $('resultsBody').innerHTML = rows.map((r) => `
    <tr class="${r.source === 'pdf' ? 'row-pdf' : ''}">
      <td class="cell-test"><div class="test-cell">${html.avatar(r)}<div>${html.testName(r)}</div></div></td>
      <td data-label="ערך">${html.value(r)}</td>
      <td data-label="יחידה">${html.unit(r)}</td>
      <td data-label="טווח ייחוס (מהדוח)">${html.range(r)}</td>
      <td data-label="סימון">${html.flag(r)}</td>
    </tr>`).join('');
}

const observers = [];
function renderCharts(records) {
  observers.splice(0).forEach((o) => o.disconnect());
  // Group by series: same test AND same unit. Different units never share a chart.
  const groups = new Map();
  for (const r of records) {
    const k = seriesKey(r);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(r);
  }
  const nameKey = (r) => seriesKey(r).split('|').slice(0, 2).join('|');
  const unitsPerName = {};
  for (const recs of groups.values()) (unitsPerName[nameKey(recs[0])] ??= new Set()).add(String(recs[0].unit ?? ''));

  const container = $('charts');
  container.innerHTML = '';
  let idx = 0;
  for (const recs of groups.values()) {
    recs.sort((a, b) => a.date.localeCompare(b.date));
    const first = recs[0];
    const key = `c${idx++}`;
    const split = unitsPerName[nameKey(first)].size > 1;
    const changes = [];
    for (let i = 1; i < recs.length; i++) if (!sameRange(recs[i - 1], recs[i])) changes.push([recs[i - 1], recs[i]]);
    const rangeLabel = (prefix, r) => (rangeTextOf(r) == null ? `${prefix}טווח לא ידוע` : `${prefix}־${bdi(rangeTextOf(r), 'ltr')}`);

    const card = document.createElement('article');
    card.className = 'chart-card';
    card.dataset.series = seriesKey(first);
    card.innerHTML = `
      <div class="chart-head">
        <div class="chart-head-main">
          ${html.avatar(first)}
          <h3 class="chart-title">${html.testName(first, { badge: false })}</h3>
        </div>
        <span class="chart-unit">יחידה: ${html.unit(first)}${split ? ' · <strong>מוצג בנפרד בשל יחידה שונה</strong>' : ''}</span>
      </div>
      ${first.source === 'pdf' ? '<div class="chart-origin">יובא מ-PDF</div>' : ''}
      <div class="chart-box"></div>
      <div class="chart-legend" aria-hidden="true">
        <span><span class="swatch swatch-line"></span>ערך נמדד</span>
        <span><span class="swatch swatch-band"></span>טווח ייחוס (מהדוח)</span>
        ${changes.length ? '<span><span class="swatch swatch-change"></span>שינוי טווח</span>' : ''}
        <span>▲ גבוה · ▼ נמוך</span>
      </div>
      ${changes.length ? `<ul class="range-changes">${changes.map(([a, b]) =>
        `<li>טווח הייחוס השתנה ב־${esc(fmtDate(b.date))}: ${rangeLabel('מ', a)} ${rangeLabel('ל', b)}</li>`).join('')}</ul>` : ''}
      <details class="chart-data">
        <summary>הצגת הנתונים כטבלה</summary>
        <table>
          <thead><tr><th>תאריך</th><th>ערך</th><th>טווח ייחוס</th><th>סימון</th></tr></thead>
          <tbody>${recs.map((r) => `
            <tr><td>${esc(fmtDate(r.date))}</td><td>${html.value(r)}</td><td>${html.range(r)}</td><td>${html.flag(r)}</td></tr>`).join('')}
          </tbody>
        </table>
      </details>`;
    container.appendChild(card);

    const box = card.querySelector('.chart-box');
    let raf = 0;
    const ro = new ResizeObserver(() => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => drawChart(box, recs, key, tip));
    });
    ro.observe(box);
    observers.push(ro);
  }
}

/* ====================== Import ====================== */

let batchSeq = 0;
const STATUS_LABEL = { missing: 'חסר', unclear: 'לא ברור' };

function setFileStatus(id, fileName, kind, message) {
  let li = document.getElementById(`fs-${id}`);
  if (!li) {
    li = document.createElement('li');
    li.id = `fs-${id}`;
    $('fileStatus').prepend(li);
  }
  li.className = `fs fs-${kind}`;
  li.setAttribute('role', kind === 'error' ? 'alert' : 'status');
  li.innerHTML = `<bdi dir="ltr" class="fs-name">${esc(fileName)}</bdi><span class="fs-msg">${esc(message)}</span>`;
}

async function handleFiles(fileList) {
  const files = [...fileList];
  for (const file of files) {
    const id = `b${Date.now().toString(36)}${++batchSeq}`;
    setFileStatus(id, file.name, 'busy', 'קורא את הקובץ…');
    try {
      const extracted = await extractPdf(file);
      const parsed = parseReport(extracted);
      if (!parsed.rows.length) {
        setFileStatus(id, file.name, 'error', 'נמצא טקסט בקובץ, אך לא זוהו בו שורות תוצאות בדיקה. לא יובא דבר.');
        continue;
      }
      state.drafts.push({ id, fileName: file.name, numPages: extracted.numPages, pages: extracted.pages, ...parsed });
      setFileStatus(id, file.name, 'ok', `זוהו ${parsed.rows.length} שורות. יש לבדוק ולאשר במסך הבדיקה למטה — דבר לא נוסף עדיין.`);
    } catch (err) {
      const msg = err instanceof ImportError ? err.message : errorMessage('generic');
      if (!(err instanceof ImportError)) console.error(err);
      setFileStatus(id, file.name, 'error', msg);
    }
  }
  renderReviews();
}

function rowStatusBadges(row) {
  const out = [];
  const v = String(row.valueText ?? '').trim();
  if (!v) out.push(`<span class="st st-${row.valueStatus === 'unclear' ? 'unclear' : 'missing'}">ערך: ${row.valueStatus === 'unclear' ? 'לא ברור' : 'חסר'}</span>`);
  else if (parseStrictNumber(v) == null) out.push('<span class="st st-unclear">ערך לא מספרי — ללא סימון</span>');
  if (!String(row.unit ?? '').trim()) out.push(`<span class="st st-${row.unitStatus === 'unclear' ? 'unclear' : 'missing'}">יחידה: ${STATUS_LABEL[row.unitStatus] || 'חסר'}</span>`);
  if (!String(row.rangeText ?? '').trim()) out.push(`<span class="st st-${row.rangeStatus === 'unclear' ? 'unclear' : 'missing'}">${row.rangeStatus === 'unclear' ? 'טווח: לא ברור' : 'טווח ייחוס לא ידוע'}</span>`);
  return out.join('') || '<span class="st st-ok">נקרא</span>';
}

function renderReviews() {
  const host = $('reviews');
  host.innerHTML = state.drafts.map((d) => `
    <section class="panel review" data-draft="${esc(d.id)}" aria-label="בדיקת נתונים לפני שמירה: ${esc(d.fileName)}">
      <div class="panel-pad">
        <div class="review-head">
          <div>
            <div class="review-kicker">בדיקה לפני שמירה · דבר לא נוסף ללוח עד לאישור</div>
            <h2><bdi dir="ltr">${esc(d.fileName)}</bdi></h2>
            <p class="section-sub">${d.numPages} עמודים · ${d.rows.length} שורות זוהו. יש להשוות כל שורה לשורת המקור, לתקן או למחוק לפי הצורך.</p>
          </div>
        </div>

        <div class="review-meta">
          <label class="field">
            <span>תאריך הבדיקה</span>
            <input type="date" class="in-date" value="${esc(d.date.iso)}" required>
            <small>${d.date.status === 'ok' ? `כפי שהודפס: ${bdi(d.date.raw, 'ltr')}` :
              d.date.status === 'unclear' ? `<span class="st st-unclear">לא ברור</span> נמצאו כמה תאריכים: ${bdi(d.date.raw, 'ltr')}` :
              '<span class="st st-missing">חסר</span> לא נמצא תאריך בדיקה בדוח'}</small>
          </label>
          <label class="field">
            <span>שם המעבדה (אם מופיע)</span>
            <input type="text" class="in-lab" value="${esc(d.lab.lab)}" dir="auto">
            <small>${d.lab.status === 'ok' ? 'כפי שהודפס בדוח' : '<span class="st st-missing">חסר</span> לא זוהה בדוח'}</small>
          </label>
        </div>

        <div class="table-scroll">
          <table class="review-table">
            <thead><tr>
              <th>שם הבדיקה (כפי שנכתב)</th><th>ערך</th><th>יחידה</th><th>טווח ייחוס (כפי שהודפס)</th><th>מצב</th><th>שורת המקור בקובץ</th><th><span class="visually-hidden">מחיקה</span></th>
            </tr></thead>
            <tbody>
              ${d.rows.map((r) => `
              <tr data-row="${esc(r.id)}">
                <td data-label="שם הבדיקה"><input class="in-name" dir="auto" value="${esc(r.nameRaw)}" aria-label="שם הבדיקה"></td>
                <td data-label="ערך"><input class="in-value" dir="ltr" value="${esc(r.valueText)}" placeholder="${r.valueStatus === 'unclear' ? 'לא ברור' : 'חסר'}" aria-label="ערך"></td>
                <td data-label="יחידה"><input class="in-unit" dir="ltr" value="${esc(r.unit)}" placeholder="${STATUS_LABEL[r.unitStatus] || ''}" aria-label="יחידה"></td>
                <td data-label="טווח ייחוס"><input class="in-range" dir="ltr" value="${esc(r.rangeText)}" placeholder="${r.rangeStatus === 'unclear' ? 'לא ברור' : 'לא ידוע'}" aria-label="טווח ייחוס"></td>
                <td data-label="מצב" class="row-status">${rowStatusBadges(r)}</td>
                <td data-label="מקור" class="src-cell"><span class="src-page">עמ' ${r.page}</span><bdi dir="auto" class="src-line">${esc(r.sourceLine)}</bdi></td>
                <td><button type="button" class="icon-btn del-row" aria-label="מחיקת השורה">
                  <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/></svg></button></td>
              </tr>`).join('')}
            </tbody>
          </table>
        </div>

        <details class="source-text">
          <summary>הצגת כל הטקסט שחולץ מהקובץ (לפי עמודים)</summary>
          ${d.pages.map((p) => `
            <div class="src-page-block">
              <div class="src-page-title">עמוד ${p.pageNumber}</div>
              <ol>${p.lines.map((l) => `<li><bdi dir="auto">${esc(l.text)}</bdi></li>`).join('')}</ol>
            </div>`).join('')}
        </details>

        <p class="review-error" role="alert" hidden></p>
        <div class="actions">
          <button type="button" class="btn btn-primary confirm-draft">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12l5 5L20 7"/></svg>
            אישור והוספה ללוח הבקרה
          </button>
          <button type="button" class="btn btn-secondary cancel-draft">ביטול — לא לייבא קובץ זה</button>
        </div>
      </div>
    </section>`).join('');
}

function draftFromEvent(e) {
  const sec = e.target.closest('.review');
  return sec ? { sec, draft: state.drafts.find((d) => d.id === sec.dataset.draft) } : {};
}

function onReviewInput(e) {
  const { draft } = draftFromEvent(e);
  const tr = e.target.closest('tr[data-row]');
  if (!draft || !tr) return;
  const row = draft.rows.find((r) => r.id === tr.dataset.row);
  if (!row) return;
  const map = { 'in-name': 'nameRaw', 'in-value': 'valueText', 'in-unit': 'unit', 'in-range': 'rangeText' };
  const field = map[[...e.target.classList].find((c) => map[c])];
  if (!field) return;
  row[field] = e.target.value;
  // User-edited fields are no longer "unclear" — they are what the user typed.
  if (field === 'valueText') row.valueStatus = row.valueText.trim() ? 'ok' : 'missing';
  if (field === 'unit') row.unitStatus = row.unit.trim() ? 'ok' : 'missing';
  if (field === 'rangeText') row.rangeStatus = row.rangeText.trim() ? 'ok' : 'missing';
  tr.querySelector('.row-status').innerHTML = rowStatusBadges(row);
}

function onReviewClick(e) {
  const { sec, draft } = draftFromEvent(e);
  if (!draft) return;
  if (e.target.closest('.del-row')) {
    const tr = e.target.closest('tr[data-row]');
    draft.rows = draft.rows.filter((r) => r.id !== tr.dataset.row);
    tr.remove();
    return;
  }
  if (e.target.closest('.cancel-draft')) {
    state.drafts = state.drafts.filter((d) => d !== draft);
    setFileStatus(draft.id, draft.fileName, 'muted', 'בוטל — לא יובא דבר.');
    renderReviews();
    return;
  }
  if (e.target.closest('.confirm-draft')) confirmDraft(sec, draft);
}

function confirmDraft(sec, draft) {
  const errBox = sec.querySelector('.review-error');
  const date = sec.querySelector('.in-date').value;
  const lab = sec.querySelector('.in-lab').value.trim();
  const problems = [];
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) problems.push('יש להזין את תאריך הבדיקה כפי שמופיע בדוח.');
  if (!draft.rows.length) problems.push('אין שורות לשמירה.');
  const noName = draft.rows.filter((r) => !String(r.nameRaw).trim());
  if (noName.length) problems.push('לכל שורה נדרש שם בדיקה (או למחוק את השורה).');
  if (problems.length) {
    errBox.textContent = problems.join(' ');
    errBox.hidden = false;
    return;
  }
  const importedAt = new Date().toISOString();
  const records = draft.rows.map((r) => {
    const valueText = String(r.valueText ?? '').trim();
    const rangeText = String(r.rangeText ?? '').trim();
    return {
      source: 'pdf',
      batchId: draft.id,
      fileName: draft.fileName,
      importedAt,
      date,
      dateRaw: draft.date.raw,
      lab,
      nameRaw: String(r.nameRaw).trim(),
      valueText,
      value: parseStrictNumber(valueText),
      unit: String(r.unit ?? '').trim(),
      refRange: rangeText ? { text: rangeText } : null,
      page: r.page,
      sourceLine: r.sourceLine,
    };
  });
  state.imported = addImported(records);
  state.drafts = state.drafts.filter((d) => d !== draft);
  setFileStatus(draft.id, draft.fileName, 'done', `נשמרו ${records.length} שורות (מיובאות מ-PDF).`);
  state.source = 'pdf';
  state.selectedDate.pdf = date;
  renderReviews();
  renderBatches();
  toast(`נשמרו ${records.length} שורות מהקובץ ${draft.fileName}`);
}

function renderBatches() {
  const batches = new Map();
  for (const r of state.imported) {
    if (!batches.has(r.batchId)) batches.set(r.batchId, { id: r.batchId, fileName: r.fileName, date: r.date, n: 0 });
    batches.get(r.batchId).n++;
  }
  $('batchList').innerHTML = batches.size
    ? [...batches.values()].map((b) => `
      <li>
        <span class="badge-pdf">PDF</span>
        <bdi dir="ltr" class="fs-name">${esc(b.fileName)}</bdi>
        <span class="muted">${esc(fmtDate(b.date))} · ${b.n} שורות</span>
        <button type="button" class="btn btn-ghost del-batch" data-batch="${esc(b.id)}">מחיקה</button>
      </li>`).join('')
    : '<li class="muted">אין נתונים מיובאים.</li>';
  $('deleteAllBtn').disabled = !batches.size;
  $('exportBtn').disabled = !batches.size;
  renderSourceBar();
}

/* ====================== Routing & boot ====================== */

function route() {
  const isImport = location.hash.startsWith('#/import');
  $('viewDashboard').hidden = isImport;
  $('viewImport').hidden = !isImport;
  $('navDashboard').toggleAttribute('aria-current', !isImport);
  $('navImport').toggleAttribute('aria-current', isImport);
  if (isImport) { $('navImport').setAttribute('aria-current', 'page'); renderBatches(); }
  else { $('navDashboard').setAttribute('aria-current', 'page'); renderDashboard(); }
  tip.hide();
}

function bindEvents() {
  window.addEventListener('hashchange', route);
  window.addEventListener('scroll', tip.hide, { passive: true });

  document.querySelector('.source-switch').addEventListener('click', (e) => {
    const b = e.target.closest('.source-btn');
    if (!b) return;
    state.source = b.dataset.source;
    renderDashboard();
  });

  $('fileInput').addEventListener('change', (e) => {
    if (e.target.files?.length) handleFiles(e.target.files);
    e.target.value = '';
  });
  const dz = $('dropzone');
  ['dragenter', 'dragover'].forEach((t) => dz.addEventListener(t, (e) => { e.preventDefault(); dz.classList.add('drag'); }));
  ['dragleave', 'drop'].forEach((t) => dz.addEventListener(t, () => dz.classList.remove('drag')));
  dz.addEventListener('drop', (e) => { e.preventDefault(); if (e.dataTransfer?.files?.length) handleFiles(e.dataTransfer.files); });
  // Never let the browser open a dropped file outside the drop zone.
  window.addEventListener('dragover', (e) => e.preventDefault());
  window.addEventListener('drop', (e) => e.preventDefault());

  $('reviews').addEventListener('input', onReviewInput);
  $('reviews').addEventListener('click', onReviewClick);

  $('batchList').addEventListener('click', (e) => {
    const b = e.target.closest('.del-batch');
    if (!b) return;
    if (!confirm('למחוק את הנתונים שיובאו מקובץ זה?')) return;
    state.imported = deleteImportBatch(b.dataset.batch);
    if (!state.imported.length) state.source = 'demo';
    renderBatches();
    toast('הנתונים מהקובץ נמחקו');
  });
  $('deleteAllBtn').addEventListener('click', () => {
    if (!confirm('למחוק את כל הנתונים המיובאים מדפדפן זה? פעולה זו אינה הפיכה.')) return;
    state.imported = deleteAllImported();
    state.source = 'demo';
    renderBatches();
    toast('כל הנתונים המיובאים נמחקו');
  });
  $('exportBtn').addEventListener('click', exportImported);
}

async function init() {
  bindEvents();
  warmUp().catch((err) => console.error('pdf.js worker failed to start', err));
  try {
    const res = await fetch('data/demo-results.json', { cache: 'no-store' });
    if (!res.ok) throw new Error(res.status);
    const data = await res.json();
    state.demo = (data.records || []).map((r) => ({ ...r, source: 'demo' }));
  } catch (err) {
    console.error(err);
    document.querySelector('main').insertAdjacentHTML('afterbegin',
      `<div class="load-error" role="alert">לא ניתן לטעון את נתוני ההדגמה. יש להפעיל את האפליקציה בפקודה <bdi dir="ltr">npm start</bdi> מתוך תיקיית הפרויקט ולפתוח את הכתובת המקומית שמוצגת בטרמינל.</div>`);
  }
  route();
}

init();
