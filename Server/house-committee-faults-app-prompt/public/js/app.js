/**
 * House Committee Fault Management – client application (logged-in pages).
 *
 * A single-page app served at /dashboard, /table, /calendar, /stats, /settings,
 * /tickets/new, /tickets/:id and /tickets/:id/edit. All data comes from the
 * server's JSON API; every request carries X-Building-Id so each tab stays on
 * the building it shows.
 */
(function () {
  'use strict';

  /* ======================================================================
   * Constants
   * ==================================================================== */

  const DAY = 864e5;
  const MAX_FILE_MB = 200;
  const ALLOWED_EXT = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'mp4', 'mov', 'webm'];
  const EXT_MIME = {
    jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp',
    mp4: 'video/mp4', mov: 'video/quicktime', webm: 'video/webm', pdf: 'application/pdf',
  };
  const CONTRACT_EXT = ['pdf', 'jpg', 'jpeg', 'png', 'gif', 'webp'];
  const BUILDING_KEY = 'hcf.building';

  const STATUSES = [
    { id: 'new', label: 'חדשה', color: '#1d4ed8' },
    { id: 'in_progress', label: 'בטיפול', color: '#7c3aed' },
    { id: 'waiting_vendor', label: 'ממתינה לגורם חיצוני', color: '#c2410c' },
    { id: 'waiting_parts', label: 'ממתינה לחלקים', color: '#a16207' },
    { id: 'resolved', label: 'טופלה', color: '#15803d' },
    { id: 'closed', label: 'סגורה', color: '#475569' },
    { id: 'cancelled', label: 'בוטלה', color: '#9ca3af' },
  ];
  const OPEN_STATUSES = new Set(['new', 'in_progress', 'waiting_vendor', 'waiting_parts']);
  const DONE_STATUSES = new Set(['resolved', 'closed']);

  const PRIORITIES = [
    { id: 'low', label: 'נמוכה', rank: 1, color: '#15803d' },
    { id: 'medium', label: 'בינונית', rank: 2, color: '#1d4ed8' },
    { id: 'high', label: 'גבוהה', rank: 3, color: '#c2410c' },
    { id: 'urgent', label: 'דחופה', rank: 4, color: '#b91c1c' },
  ];

  const CHANNELS = [
    { id: 'whatsapp', label: 'וואטסאפ' },
    { id: 'phone', label: 'שיחת טלפון' },
    { id: 'in_person', label: 'פנים אל פנים' },
    { id: 'committee', label: 'חבר ועד' },
  ];

  // Areas that are building-wide: the recurring-fault hint ignores the floor for them.
  const WIDE_AREA_NAMES = new Set(['מעלית', 'לובי', 'גג', 'חצר וגינה']);

  /* ======================================================================
   * State
   * ==================================================================== */

  const state = {
    user: null,
    building: null,
    buildings: [],
    members: [],
    settings: { categories: [], floors: [], areas: [], vendors: [] },
    tickets: [],
    contracts: [],
    bank: null, // loaded on first visit to /bank
    loadedAt: 0,
  };

  /* ======================================================================
   * Generic utilities
   * ==================================================================== */

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  function esc(v) {
    return String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  const nl2br = (v) => esc(v).replace(/\n/g, '<br>');

  /** Parse an ISO timestamp or a YYYY-MM-DD date (as local midnight). */
  function parseDate(v) {
    if (!v) return null;
    if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v;
    if (/^\d{4}-\d{2}-\d{2}$/.test(v)) {
      const [y, m, d] = v.split('-').map(Number);
      return new Date(y, m - 1, d);
    }
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  function startOfDay(d) { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; }
  function toDateInput(d) {
    const x = new Date(d);
    return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
  }
  const daysBetween = (a, b) => Math.round((startOfDay(b) - startOfDay(a)) / DAY);

  const dfDate = new Intl.DateTimeFormat('he-IL', { day: '2-digit', month: '2-digit', year: 'numeric' });
  const dfTime = new Intl.DateTimeFormat('he-IL', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  const dfMonthShort = new Intl.DateTimeFormat('he-IL', { month: 'short' });
  const dfMonthLong = new Intl.DateTimeFormat('he-IL', { month: 'long', year: 'numeric' });
  const dfWeekday = new Intl.DateTimeFormat('he-IL', { weekday: 'short' });
  const dfWeekdayLong = new Intl.DateTimeFormat('he-IL', { weekday: 'long', day: 'numeric', month: 'long' });
  const nfNum = new Intl.NumberFormat('he-IL', { maximumFractionDigits: 1 });

  /** DD/MM/YYYY built from he-IL parts (guarantees slashes across browsers). */
  function fmtDate(v) {
    const d = parseDate(v);
    if (!d) return '—';
    const p = {};
    dfDate.formatToParts(d).forEach((x) => { p[x.type] = x.value; });
    return `${p.day}/${p.month}/${p.year}`;
  }
  const fmtTime = (v) => { const d = parseDate(v); return d ? dfTime.format(d) : ''; };
  const fmtDateTime = (v) => { const d = parseDate(v); return d ? `${fmtDate(d)} ${fmtTime(d)}` : '—'; };

  function fmtSize(bytes) {
    if (!bytes) return '0 KB';
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1048576) return nfNum.format(bytes / 1024) + ' KB';
    return nfNum.format(bytes / 1048576) + ' MB';
  }

  /** Wrap negative numbers (e.g. "קומה -2") in an LTR isolate so the minus renders correctly in RTL. */
  const bidiFix = (text) => String(text ?? '').replace(/(^|\s)(-\d+)/g, '$1⁦$2⁩');

  function telLink(phone, cls = 'tel') {
    if (!phone) return '—';
    return `<a href="tel:${esc(String(phone).replace(/[^\d+]/g, ''))}" class="${cls}" dir="ltr">${esc(phone)}</a>`;
  }

  const extOf = (name) => (String(name).split('.').pop() || '').toLowerCase();

  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }

  async function copyText(text) {
    try {
      if (navigator.clipboard && window.isSecureContext) { await navigator.clipboard.writeText(text); return true; }
    } catch (e) { /* fall back below */ }
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
    ta.remove();
    return ok;
  }
  /** Never let a pending clipboard permission block the UI. */
  const copyWithTimeout = (text, ms = 1500) => Promise.race([copyText(text).catch(() => false), new Promise((r) => setTimeout(() => r(false), ms))]);

  /* ======================================================================
   * Server API
   * ==================================================================== */

  async function api(method, url, body, { raw = false, headers = {} } = {}) {
    const opts = { method, headers: { ...headers }, credentials: 'same-origin' };
    if (state.building) opts.headers['X-Building-Id'] = String(state.building.id);
    if (body !== undefined) {
      if (raw) opts.body = body;
      else { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body); }
    }
    let res;
    try { res = await fetch(url, opts); } catch (e) { throw new Error('אין חיבור לשרת. בדקו שהשרת פועל ונסו שוב.'); }
    if (res.status === 401) { location.replace('/'); throw new Error('יש להתחבר מחדש'); }
    const data = res.status === 204 ? {} : await res.json().catch(() => ({}));
    if (!res.ok) {
      if (data.code === 'building_gone') {
        try { sessionStorage.removeItem(BUILDING_KEY); } catch (e) { /* ignore */ }
        toast(data.error, 'error');
        setTimeout(() => location.replace('/dashboard'), 1500);
      }
      const err = new Error(data.error || 'אירעה שגיאה, נסו שוב');
      err.status = res.status;
      err.code = data.code;
      throw err;
    }
    return data;
  }

  /** Run an async action and show its error as a toast. Returns undefined on failure. */
  async function attempt(fn) {
    try { return await fn(); } catch (e) { if (e.message) toast(e.message, 'error'); return undefined; }
  }

  async function loadSession() {
    let stored = null;
    try { stored = Number(sessionStorage.getItem(BUILDING_KEY)) || null; } catch (e) { /* ignore */ }
    if (stored) state.building = { id: stored };
    let me;
    try {
      me = await api('GET', '/api/auth/me');
    } catch (e) {
      if (e.code === 'building_gone') { state.building = null; me = await api('GET', '/api/auth/me'); } else throw e;
    }
    Object.assign(state, { user: me.user, building: me.building, buildings: me.buildings, members: me.members });
    try { if (state.building) sessionStorage.setItem(BUILDING_KEY, state.building.id); } catch (e) { /* ignore */ }
  }

  async function loadData() {
    if (!state.building) return;
    const [settings, t, c] = await Promise.all([api('GET', '/api/settings'), api('GET', '/api/tickets'), api('GET', '/api/contracts')]);
    state.settings = settings;
    state.tickets = t.tickets;
    state.contracts = c.contracts;
    state.loadedAt = Date.now();
    updateContractsBadge();
  }

  function replaceContract(c) {
    const i = state.contracts.findIndex((x) => x.id === c.id);
    if (i >= 0) state.contracts[i] = c; else state.contracts.push(c);
    updateContractsBadge();
    return c;
  }

  function replaceTicket(t) {
    const i = state.tickets.findIndex((x) => x.id === t.id);
    if (i >= 0) state.tickets[i] = t; else state.tickets.unshift(t);
    return t;
  }

  /** Upload ticket media one by one; returns how many succeeded. */
  function uploadFiles(ticketId, files, updateId = null) {
    return uploadTo(`/api/tickets/${ticketId}/media${updateId ? `?updateId=${updateId}` : ''}`, files);
  }

  async function uploadTo(url, files) {
    let ok = 0;
    for (const f of files) {
      const type = f.type || EXT_MIME[extOf(f.name)] || 'application/octet-stream';
      try {
        await api('POST', url, f, { raw: true, headers: { 'Content-Type': type, 'X-File-Name': encodeURIComponent(f.name) } });
        ok++;
      } catch (e) {
        toast(`העלאת "${f.name}" נכשלה: ${e.message}`, 'error');
      }
    }
    return ok;
  }

  /* ======================================================================
   * Domain helpers
   * ==================================================================== */

  const byId = (arr, id) => arr.find((x) => x.id === id);
  const findTicket = (id) => state.tickets.find((t) => t.id === Number(id));
  const statusOf = (id) => STATUSES.find((s) => s.id === id) || { id, label: id || '—', color: '#64748b' };
  const priorityOf = (id) => PRIORITIES.find((p) => p.id === id) || { id, label: id || '—', rank: 0, color: '#64748b' };
  const channelLabel = (id) => (CHANNELS.find((c) => c.id === id) || { label: '—' }).label;

  const catName = (id) => (byId(state.settings.categories, id) || { name: id ? 'קטגוריה שנמחקה' : '—' }).name;
  const floorName = (id, plain = false) => { const f = byId(state.settings.floors, id); return f ? (plain ? f.name : bidiFix(f.name)) : ''; };
  const areaName = (id) => (byId(state.settings.areas, id) || { name: '' }).name;
  const member = (id) => byId(state.members, id);
  const memberName = (id) => { const m = member(id); return m ? m.name : '—'; };
  const responsibleText = (t) => (t.responsibleId ? (t.responsibleName || memberName(t.responsibleId)) : '—');

  function locationText(t, plain = false) {
    const parts = [floorName(t.floorId, plain), areaName(t.areaId)];
    if (t.apartment) parts.push('דירה ' + t.apartment);
    return parts.filter(Boolean).join(' · ') || '—';
  }

  const isOpen = (t) => OPEN_STATUSES.has(t.status);
  const isDone = (t) => DONE_STATUSES.has(t.status);
  const isOwner = () => !!(state.building && state.building.isOwner);

  function isResolvedThisMonth(t) {
    if (!isDone(t) || !t.resolvedAt) return false;
    const d = new Date(t.resolvedAt);
    const n = new Date();
    return d.getFullYear() === n.getFullYear() && d.getMonth() === n.getMonth();
  }

  /** 'overdue' | 'upcoming' | null – based on the external party's promised date. */
  function dueState(t) {
    if (!isOpen(t) || !t.external.opened || !t.external.expectedAt) return null;
    const diff = daysBetween(new Date(), parseDate(t.external.expectedAt));
    if (diff < 0) return 'overdue';
    if (diff <= 2) return 'upcoming';
    return null;
  }

  function dueText(t) {
    const s = dueState(t);
    if (!s) return '';
    const diff = daysBetween(new Date(), parseDate(t.external.expectedAt));
    if (s === 'overdue') return diff === -1 ? 'באיחור של יום' : `באיחור של ${-diff} ימים`;
    if (diff === 0) return 'צפוי היום';
    if (diff === 1) return 'צפוי מחר';
    return `צפוי בעוד ${diff} ימים`;
  }

  function daysOpen(t) {
    const end = t.resolvedAt ? new Date(t.resolvedAt) : (t.status === 'cancelled' ? new Date(t.updatedAt) : new Date());
    return Math.max(0, Math.floor((end - new Date(t.createdAt)) / DAY));
  }

  /** Earlier tickets with the same category in the same location (recurring-fault hint). */
  function findSimilar(categoryId, floorId, areaId, apartment, excludeId) {
    if (!categoryId || (!areaId && !floorId)) return [];
    const wide = areaId && WIDE_AREA_NAMES.has(areaName(areaId));
    const isApt = areaName(areaId) === 'דירה';
    return state.tickets.filter((t) => {
      if (t.id === excludeId || t.categoryId !== categoryId) return false;
      if (wide) return t.areaId === areaId;
      if (areaId && t.areaId !== areaId) return false;
      if (isApt && apartment) return t.apartment === apartment;
      return floorId ? t.floorId === floorId : true;
    }).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  const statusBadge = (id) => { const s = statusOf(id); return `<span class="badge st-${esc(s.id)}">${esc(s.label)}</span>`; };
  const priorityBadge = (id) => { const p = priorityOf(id); return `<span class="badge pr-${esc(p.id)}"><span class="dot" aria-hidden="true"></span>${esc(p.label)}</span>`; };
  function dueBadge(t) {
    const s = dueState(t);
    return s ? `<span class="badge due-${s}">${s === 'overdue' ? '⚠ באיחור' : '⏰ מתקרב'}</span>` : '';
  }

  /* ======================================================================
   * UI primitives: toast, modal, confirm, lightbox
   * ==================================================================== */

  function toast(msg, type = 'info') {
    const el = document.createElement('div');
    el.className = `toast toast-${type}`;
    el.textContent = msg;
    $('#toasts').appendChild(el);
    setTimeout(() => { el.classList.add('hide'); setTimeout(() => el.remove(), 300); }, type === 'error' ? 5500 : 3500);
  }

  const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), video[controls], [tabindex]:not([tabindex="-1"])';
  let modalSeq = 0;

  /**
   * Accessible modal dialog.
   * actions: [{ label, className, onClick(modalEl) }] – onClick may return false (or a Promise of false) to keep it open.
   */
  function openModal({ title, body, actions = [], wide = false, onClose, initialFocus }) {
    const prevFocus = document.activeElement;
    const titleId = `modal-title-${++modalSeq}`;
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
      <div class="modal ${wide ? 'modal-wide' : ''}" role="dialog" aria-modal="true" aria-labelledby="${titleId}">
        <div class="modal-head">
          <h2 id="${titleId}">${esc(title)}</h2>
          <button type="button" class="icon-btn" data-close aria-label="סגירת החלון">✕</button>
        </div>
        <div class="modal-body">${body}</div>
        ${actions.length ? `<div class="modal-foot">${actions.map((a, i) =>
          `<button type="button" class="btn ${a.className || 'btn-secondary'}" data-act="${i}">${esc(a.label)}</button>`).join('')}</div>` : ''}
      </div>`;
    document.body.appendChild(overlay);
    document.body.classList.add('modal-open');
    const modal = overlay.firstElementChild;
    let closed = false;

    function close() {
      if (closed) return;
      closed = true;
      overlay.remove();
      document.removeEventListener('keydown', onKey, true);
      if (!$('.modal-overlay')) document.body.classList.remove('modal-open');
      if (onClose) onClose();
      if (prevFocus && prevFocus.isConnected && prevFocus.focus) prevFocus.focus();
    }
    function onKey(e) {
      if ($$('.modal-overlay').pop() !== overlay) return;
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); return; }
      if (e.key === 'Tab') {
        const f = $$(FOCUSABLE, modal).filter((el) => el.offsetParent !== null);
        if (!f.length) return;
        const first = f[0], last = f[f.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    }
    document.addEventListener('keydown', onKey, true);
    overlay.addEventListener('mousedown', (e) => { if (e.target === overlay) close(); });
    modal.addEventListener('click', async (e) => {
      if (e.target.closest('[data-close]')) { close(); return; }
      const b = e.target.closest('[data-act]');
      if (!b) return;
      const a = actions[Number(b.dataset.act)];
      b.disabled = true;
      const r = a.onClick ? await a.onClick(modal) : undefined;
      b.disabled = false;
      if (r !== false) close();
    });
    const target = (initialFocus && $(initialFocus, modal)) || $$(FOCUSABLE, $('.modal-body', modal))[0] || $('.modal-foot .btn', modal) || $('[data-close]', modal);
    if (target) target.focus();
    return { modal, close };
  }

  function confirmDialog(message, { title = 'אישור פעולה', okLabel = 'אישור', danger = false } = {}) {
    return new Promise((resolve) => {
      let ok = false;
      openModal({
        title,
        body: `<p class="confirm-text">${nl2br(message)}</p>`,
        actions: [
          { label: okLabel, className: danger ? 'btn-danger' : 'btn-primary', onClick: () => { ok = true; } },
          { label: 'ביטול', className: 'btn-secondary' },
        ],
        initialFocus: danger ? '.modal-foot [data-act="1"]' : '.modal-foot [data-act="0"]',
        onClose: () => resolve(ok),
      });
    });
  }

  function openLightbox(url, name) {
    openModal({ title: name, wide: true, body: `<div class="lightbox"><img src="${esc(url)}" alt="${esc('תמונה מצורפת: ' + name)}"></div>` });
  }

  /* ======================================================================
   * Media rendering & file picker
   * ==================================================================== */

  function mediaGrid(list, { deletable = true } = {}) {
    if (!list || !list.length) return '';
    return `<div class="media-grid">${list.map((m) => `
      <figure class="media-item" data-media-id="${m.id}" data-media-url="${esc(m.url)}" data-media-name="${esc(m.name)}">
        <div class="media-slot">${m.type.startsWith('video/')
          ? `<video controls preload="metadata" src="${esc(m.url)}" aria-label="${esc('סרטון מצורף: ' + m.name)}"></video>`
          : `<button type="button" class="thumb" data-action="open-image" aria-label="${esc('הצגת התמונה ' + m.name + ' בגודל מלא')}">
               <img src="${esc(m.url)}" alt="${esc('תמונה מצורפת: ' + m.name)}" loading="lazy"></button>`}</div>
        <figcaption dir="auto">${esc(m.name)}</figcaption>
        ${deletable ? '<button type="button" class="media-del" data-action="delete-media" aria-label="מחיקת הקובץ המצורף">✕</button>' : ''}
      </figure>`).join('')}</div>`;
  }

  function filePickerHtml(id, { exts = ALLOWED_EXT, title = '📎 צירוף תמונות או סרטונים' } = {}) {
    return `
      <div class="file-picker" id="${id}">
        <label class="file-drop">
          <input type="file" multiple class="file-input" accept="${exts.map((e) => '.' + e).join(',')}">
          <span class="file-drop-title">${title}</span>
          <span class="file-drop-sub">לחיצה לבחירה או גרירת קבצים לכאן · ${exts.filter((e) => e !== 'jpeg').join(', ')}</span>
        </label>
        <ul class="file-previews" aria-label="קבצים שנבחרו"></ul>
      </div>`;
  }

  function bindFilePicker(root, allowed = ALLOWED_EXT) {
    const input = $('.file-input', root);
    const list = $('.file-previews', root);
    const drop = $('.file-drop', root);
    let items = [];
    let seq = 0;

    function render() {
      list.innerHTML = items.map((it) => `
        <li class="file-chip">
          ${/^(mp4|mov|webm)$/.test(extOf(it.file.name)) ? '<span class="file-chip-icon" aria-hidden="true">🎬</span>'
            : extOf(it.file.name) === 'pdf' ? '<span class="file-chip-icon" aria-hidden="true">📄</span>'
              : `<img src="${it.url}" alt="" class="file-chip-thumb">`}
          <span class="file-chip-name" dir="auto">${esc(it.file.name)}</span>
          <span class="file-chip-size">${fmtSize(it.file.size)}</span>
          <button type="button" class="icon-btn" data-remove="${it.id}" aria-label="${esc('הסרת הקובץ ' + it.file.name)}">✕</button>
        </li>`).join('');
    }
    function add(fileList) {
      for (const f of Array.from(fileList || [])) {
        if (!allowed.includes(extOf(f.name))) { toast(`סוג הקובץ "${f.name}" אינו נתמך.`, 'error'); continue; }
        if (f.size > MAX_FILE_MB * 1048576) { toast(`הקובץ "${f.name}" גדול מ-${MAX_FILE_MB}MB.`, 'error'); continue; }
        items.push({ id: String(++seq), file: f, url: URL.createObjectURL(f) });
      }
      input.value = '';
      render();
    }
    input.addEventListener('change', () => add(input.files));
    list.addEventListener('click', (e) => {
      const b = e.target.closest('[data-remove]');
      if (!b) return;
      const it = items.find((x) => x.id === b.dataset.remove);
      if (it) URL.revokeObjectURL(it.url);
      items = items.filter((x) => x.id !== b.dataset.remove);
      render();
      input.focus();
    });
    ['dragenter', 'dragover'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('dragging'); }));
    ['dragleave', 'drop'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove('dragging'); }));
    drop.addEventListener('drop', (e) => add(e.dataTransfer && e.dataTransfer.files));
    return {
      get files() { return items.map((x) => x.file); },
      clear() { items.forEach((x) => URL.revokeObjectURL(x.url)); items = []; render(); },
    };
  }

  /* ======================================================================
   * Router (History API)
   * ==================================================================== */

  let appEl;
  let currentView = '';

  const APP_PATH = /^\/(dashboard|table|calendar|stats|settings|contracts|bank|(tickets|contracts)\/(new|\d+(\/edit)?))\/?$/;

  function setView(html) {
    appEl.onclick = appEl.onsubmit = appEl.onchange = appEl.oninput = null;
    appEl.ondragstart = appEl.ondragover = appEl.ondragleave = appEl.ondrop = null;
    appEl.innerHTML = html;
  }

  function navigate(url, { replace = false } = {}) {
    if (replace) history.replaceState(null, '', url); else history.pushState(null, '', url);
    route();
  }

  function route() {
    const parts = location.pathname.replace(/^\/|\/$/g, '').split('/');
    const view = parts[0] || 'dashboard';
    currentView = view === 'tickets' ? (parts[1] === 'new' ? 'new' : parts[2] === 'edit' ? 'edit' : 'ticket')
      : view === 'contracts' && parts[1] ? (parts[1] === 'new' ? 'contract-new' : parts[2] === 'edit' ? 'contract-edit' : 'contract')
        : view;
    $$('#main-nav a').forEach((a) => {
      const active = a.dataset.nav === view || (view === 'tickets' && a.dataset.nav === 'dashboard');
      a.classList.toggle('active', active);
      if (active) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
    });

    if (!state.building && view !== 'settings') renderOnboarding();
    else {
      switch (currentView) {
        case 'ticket': renderTicket(parts[1]); break;
        case 'new': renderForm(null); break;
        case 'edit': renderForm(parts[1]); break;
        case 'table': renderTable(); break;
        case 'calendar': renderCalendar(); break;
        case 'stats': renderStats(); break;
        case 'settings': renderSettings(); break;
        case 'contracts': renderContracts(); break;
        case 'bank': renderBank(); break;
        case 'contract': renderContract(parts[1]); break;
        case 'contract-new': renderContractForm(null); break;
        case 'contract-edit': renderContractForm(parts[1]); break;
        default: renderDashboard();
      }
    }
    window.scrollTo(0, 0);
    const h1 = $('h1', appEl);
    document.title = (h1 ? h1.textContent.trim() + ' · ' : '') + 'ניהול תקלות – ועד הבית';
  }

  /** Re-render the current view (after data changed), keeping the scroll position. */
  function rerender() {
    const y = window.scrollY;
    route();
    window.scrollTo(0, y);
  }

  /* ======================================================================
   * Header (building switcher, user)
   * ==================================================================== */

  function renderHeader() {
    $('#user-name').textContent = state.user ? state.user.name : '';
    $('#brand-building').textContent = state.building ? state.building.name : 'ועד הבית';
    const wrap = $('#building-switch');
    const sel = $('#building-select');
    wrap.hidden = state.buildings.length < 2;
    sel.innerHTML = state.buildings.map((b) => `<option value="${b.id}" ${state.building && b.id === state.building.id ? 'selected' : ''}>${esc(b.name)}</option>`).join('');
    $('#main-nav').hidden = !state.building;
  }

  async function switchBuilding(id) {
    await attempt(async () => {
      const { building } = await api('PUT', '/api/buildings/active', { id });
      state.building = building;
      try { sessionStorage.setItem(BUILDING_KEY, building.id); } catch (e) { /* ignore */ }
      filters = Object.assign({}, DEFAULT_FILTERS);
      state.bank = null;
      await loadSession();
      await loadData();
      renderHeader();
      toast(`עברת לבניין "${building.name}".`, 'success');
      navigate('/dashboard');
    });
  }

  /* ======================================================================
   * Onboarding – a user that doesn't belong to any building yet
   * ==================================================================== */

  function buildingFormHtml(prefix, b = { name: '', address: '' }) {
    return `
      <div class="field"><label for="${prefix}-name">שם הבניין <span class="req" aria-hidden="true">*</span></label>
        <input id="${prefix}-name" name="name" required maxlength="60" value="${esc(b.name)}" placeholder="למשל: הרצל 12"></div>
      <div class="field"><label for="${prefix}-address">כתובת</label>
        <input id="${prefix}-address" name="address" maxlength="120" value="${esc(b.address)}" placeholder="רחוב, מספר, עיר"></div>`;
  }

  async function createBuilding(form) {
    const fd = new FormData(form);
    return attempt(async () => {
      const { building } = await api('POST', '/api/buildings', { name: fd.get('name'), address: fd.get('address') });
      state.building = building;
      try { sessionStorage.setItem(BUILDING_KEY, building.id); } catch (e) { /* ignore */ }
      await loadSession();
      await loadData();
      renderHeader();
      toast(`הבניין "${building.name}" נוצר. אתם מנהלי הבניין.`, 'success');
      navigate('/dashboard');
      return building;
    });
  }

  function renderOnboarding() {
    setView(`
      <div class="onboarding">
        <section class="card onboarding-card">
          <h1>ברוכים הבאים, ${esc(state.user.name)}</h1>
          <p class="muted">כדי להתחיל, צרו בניין חדש או בקשו ממנהל/ת הוועד להוסיף אתכם לבניין קיים.</p>
          <div class="onboarding-grid">
            <form id="create-building" class="onboarding-option" novalidate>
              <h2>🏢 יצירת בניין חדש</h2>
              ${buildingFormHtml('ob')}
              <button type="submit" class="btn btn-primary">יצירת הבניין</button>
            </form>
            <div class="onboarding-option">
              <h2>🤝 הצטרפות לבניין קיים</h2>
              <p>מנהל/ת הבניין מוסיף/ה חברי ועד לפי כתובת האימייל שאיתה נרשמו. מסרו לו/לה את האימייל שלכם:</p>
              <p class="email-chip" dir="ltr">${esc(state.user.email)}</p>
              <button type="button" class="btn btn-secondary" data-action="refresh">כבר הוסיפו אותי – רענון</button>
            </div>
          </div>
        </section>
      </div>`);
    appEl.onsubmit = async (e) => {
      e.preventDefault();
      if (!e.target.elements.name.value.trim()) { toast('יש להזין שם לבניין.', 'error'); e.target.elements.name.focus(); return; }
      await createBuilding(e.target);
    };
    appEl.onclick = async (e) => {
      if (!e.target.closest('[data-action="refresh"]')) return;
      await attempt(async () => {
        await loadSession();
        await loadData();
        renderHeader();
        if (state.building) { toast(`הצטרפת לבניין "${state.building.name}".`, 'success'); navigate('/dashboard'); }
        else toast('עדיין לא נוספת לאף בניין.', 'info');
      });
    };
  }

  /* ======================================================================
   * Filters (shared by the dashboard list and the table view)
   * ==================================================================== */

  const DEFAULT_FILTERS = { q: '', status: 'all', priority: 'all', category: 'all', responsible: 'all', overdue: false, external: false, resolvedMonth: false };
  let filters = Object.assign({}, DEFAULT_FILTERS);
  let sort = { key: 'number', dir: 'desc' };

  function ticketSearchText(t) {
    return [t.number, t.title, t.description, t.reporter.name, t.external.company, t.external.refNo, t.external.contactName]
      .concat(t.updates.map((u) => u.text)).join(' ').toLowerCase();
  }

  function applyFilters(list) {
    const q = filters.q.trim().toLowerCase();
    return list.filter((t) => {
      if (q && !ticketSearchText(t).includes(q)) return false;
      if (filters.status === 'open' && !isOpen(t)) return false;
      if (filters.status === 'done' && !isDone(t)) return false;
      if (!['all', 'open', 'done'].includes(filters.status) && t.status !== filters.status) return false;
      if (filters.priority === 'high_plus' && !['high', 'urgent'].includes(t.priority)) return false;
      if (!['all', 'high_plus'].includes(filters.priority) && t.priority !== filters.priority) return false;
      if (filters.category !== 'all' && String(t.categoryId) !== filters.category) return false;
      if (filters.responsible === 'none' && t.responsibleId) return false;
      if (!['all', 'none'].includes(filters.responsible) && String(t.responsibleId) !== filters.responsible) return false;
      if (filters.overdue && dueState(t) !== 'overdue') return false;
      if (filters.external && !(isOpen(t) && t.external.opened)) return false;
      if (filters.resolvedMonth && !isResolvedThisMonth(t)) return false;
      return true;
    });
  }

  function sortValue(t, key) {
    switch (key) {
      case 'number': return t.number;
      case 'title': return t.title;
      case 'category': return catName(t.categoryId);
      case 'location': return locationText(t, true);
      case 'priority': return priorityOf(t.priority).rank;
      case 'status': return STATUSES.findIndex((s) => s.id === t.status);
      case 'responsible': return t.responsibleId ? responsibleText(t) : '';
      case 'vendor': return t.external.opened ? t.external.company : '';
      case 'expected': return t.external.opened ? t.external.expectedAt : '';
      case 'days': return daysOpen(t);
      case 'updated': return t.updatedAt;
      default: return '';
    }
  }

  function sortTickets(list) {
    const dir = sort.dir === 'asc' ? 1 : -1;
    return list.slice().sort((a, b) => {
      const va = sortValue(a, sort.key), vb = sortValue(b, sort.key);
      const ea = va === '' || va == null, eb = vb === '' || vb == null;
      if (ea && eb) return b.number - a.number;
      if (ea) return 1; // empty values always last
      if (eb) return -1;
      const cmp = typeof va === 'number' && typeof vb === 'number' ? va - vb : String(va).localeCompare(String(vb), 'he');
      return cmp * dir || b.number - a.number;
    });
  }

  function filtersHtml() {
    const opt = (v, label, cur) => `<option value="${esc(v)}" ${String(cur) === String(v) ? 'selected' : ''}>${esc(label)}</option>`;
    return `
      <form class="filters" id="filters" role="search" aria-label="סינון וחיפוש קריאות">
        <div class="field field-grow">
          <label for="f-q">חיפוש חופשי</label>
          <input type="search" id="f-q" name="q" value="${esc(filters.q)}" placeholder="חיפוש בכותרת, בתיאור ובעדכונים…" autocomplete="off">
        </div>
        <div class="field">
          <label for="f-status">סטטוס</label>
          <select id="f-status" name="status">
            ${opt('all', 'הכל', filters.status)}${opt('open', 'כל הפתוחות', filters.status)}${opt('done', 'טופלו / נסגרו', filters.status)}
            <optgroup label="סטטוס מסוים">${STATUSES.map((s) => opt(s.id, s.label, filters.status)).join('')}</optgroup>
          </select>
        </div>
        <div class="field">
          <label for="f-priority">עדיפות</label>
          <select id="f-priority" name="priority">
            ${opt('all', 'הכל', filters.priority)}${opt('high_plus', 'גבוהה ודחופה', filters.priority)}
            ${PRIORITIES.map((p) => opt(p.id, p.label, filters.priority)).join('')}
          </select>
        </div>
        <div class="field">
          <label for="f-category">קטגוריה</label>
          <select id="f-category" name="category">
            ${opt('all', 'הכל', filters.category)}${state.settings.categories.map((c) => opt(c.id, c.name, filters.category)).join('')}
          </select>
        </div>
        <div class="field">
          <label for="f-resp">אחראי</label>
          <select id="f-resp" name="responsible">
            ${opt('all', 'הכל', filters.responsible)}${opt('none', 'ללא אחראי', filters.responsible)}
            ${state.members.map((m) => opt(m.id, m.name, filters.responsible)).join('')}
          </select>
        </div>
        <div class="filter-checks">
          <label class="check"><input type="checkbox" name="overdue" ${filters.overdue ? 'checked' : ''}> באיחור בלבד</label>
          <label class="check"><input type="checkbox" name="external" ${filters.external ? 'checked' : ''}> בטיפול חיצוני</label>
          <label class="check"><input type="checkbox" name="resolvedMonth" ${filters.resolvedMonth ? 'checked' : ''}> נפתרו החודש</label>
          <button type="button" class="btn btn-ghost btn-sm" data-action="clear-filters">ניקוי סינון</button>
        </div>
      </form>`;
  }

  /** Wire the filter form; onChange re-renders only the list so focus stays in the search box. */
  function bindFilters(onChange) {
    const form = $('#filters');
    const read = () => {
      const fd = new FormData(form);
      filters = {
        q: String(fd.get('q') || ''), status: fd.get('status'), priority: fd.get('priority'),
        category: fd.get('category'), responsible: fd.get('responsible'),
        overdue: fd.get('overdue') === 'on', external: fd.get('external') === 'on', resolvedMonth: fd.get('resolvedMonth') === 'on',
      };
      onChange();
    };
    form.addEventListener('input', read);
    form.addEventListener('change', read);
    form.addEventListener('submit', (e) => e.preventDefault());
  }

  /* ======================================================================
   * Dashboard
   * ==================================================================== */

  const COLUMNS = [
    { key: 'number', label: 'מס׳' }, { key: 'title', label: 'כותרת' }, { key: 'category', label: 'קטגוריה' },
    { key: 'location', label: 'מיקום' }, { key: 'priority', label: 'עדיפות' }, { key: 'status', label: 'סטטוס' },
    { key: 'responsible', label: 'אחראי' }, { key: 'vendor', label: 'גורם חיצוני' }, { key: 'expected', label: 'מועד צפוי' },
    { key: 'days', label: 'ימים פתוחה' },
  ];

  function sortHeader(c) {
    const active = sort.key === c.key;
    const ariaSort = active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none';
    return `<th scope="col" aria-sort="${ariaSort}"><button type="button" class="sort-btn ${active ? 'active' : ''}" data-sort="${c.key}">
      ${c.label}<span class="sort-ind" aria-hidden="true">${active ? (sort.dir === 'asc' ? '▲' : '▼') : '↕'}</span></button></th>`;
  }

  function handleSortClick(btn, renderList) {
    const key = btn.dataset.sort;
    sort = sort.key === key ? { key, dir: sort.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: ['number', 'days', 'priority', 'updated'].includes(key) ? 'desc' : 'asc' };
    renderList();
    const again = $(`[data-sort="${key}"]`);
    if (again) again.focus();
  }

  function emptyListHtml() {
    return `
      <div class="empty-state">
        <p class="empty-icon" aria-hidden="true">🏢</p>
        <h3>אין עדיין קריאות בבניין</h3>
        <p class="muted">אפשר לפתוח קריאה ראשונה${isOwner() ? ' או לטעון נתוני הדגמה כדי להתרשם מהמערכת' : ''}.</p>
        <div class="btn-row center">
          <a href="/tickets/new" class="btn btn-primary">פתיחת קריאה ראשונה</a>
          ${isOwner() ? '<button type="button" class="btn btn-secondary" data-action="restore-demo">טעינת נתוני הדגמה</button>' : ''}
        </div>
      </div>`;
  }

  function renderDashboard() {
    const all = state.tickets;
    const open = all.filter(isOpen);
    const sum = {
      open: open.length,
      urgent: open.filter((t) => t.priority === 'high' || t.priority === 'urgent').length,
      external: open.filter((t) => t.external.opened).length,
      overdue: all.filter((t) => dueState(t) === 'overdue').length,
      resolved: all.filter(isResolvedThisMonth).length,
    };
    const card = (key, cls, value, label, icon) => `
      <button type="button" class="summary-card ${cls}" data-card="${key}" aria-label="${esc(label)}: ${value}. לחיצה לסינון הרשימה">
        <span class="sc-icon" aria-hidden="true">${icon}</span>
        <span class="sc-value">${value}</span>
        <span class="sc-label">${label}</span>
      </button>`;

    setView(`
      <div class="page-head">
        <div>
          <h1>לוח בקרה</h1>
          <p class="muted">${esc(state.building.name)}${state.building.address ? ' · ' + esc(state.building.address) : ''} – מעקב אחר כל התקלות, מדיווח ועד פתרון.</p>
        </div>
        <a class="btn btn-primary" href="/tickets/new" aria-keyshortcuts="N"><span aria-hidden="true">＋</span> קריאה חדשה</a>
      </div>

      ${contractsBannerHtml()}

      <section class="summary-grid" aria-label="סיכום מצב התקלות">
        ${card('open', 'sc-open', sum.open, 'קריאות פתוחות', '📋')}
        ${card('urgent', 'sc-urgent', sum.urgent, 'דחופות / עדיפות גבוהה', '🔥')}
        ${card('external', 'sc-external', sum.external, 'בטיפול גורם חיצוני', '🛠')}
        ${card('overdue', 'sc-overdue', sum.overdue, 'באיחור', '⚠')}
        ${card('resolved', 'sc-resolved', sum.resolved, 'נפתרו החודש', '✔')}
      </section>

      <section class="card" aria-labelledby="list-title">
        <div class="card-head"><h2 id="list-title">רשימת הקריאות</h2></div>
        ${filtersHtml()}
        <div class="list-toolbar">
          <p id="result-count" class="muted" aria-live="polite"></p>
          <div class="btn-row">
            <button type="button" class="btn btn-secondary btn-sm" data-action="export-filtered">⬇ ייצוא התצוגה ל-Excel</button>
            <button type="button" class="btn btn-secondary btn-sm" data-action="export-all">⬇ ייצוא כל הקריאות</button>
            ${isOwner() ? '<button type="button" class="btn btn-danger-outline btn-sm" data-action="wipe">🗑 מחיקת כל הנתונים</button>' : ''}
          </div>
        </div>
        <div id="ticket-list"></div>
      </section>`);

    renderTicketList();
    bindFilters(renderTicketList);

    appEl.onclick = async (e) => {
      const cardBtn = e.target.closest('[data-card]');
      if (cardBtn) {
        filters = Object.assign({}, DEFAULT_FILTERS);
        const k = cardBtn.dataset.card;
        if (k === 'open') filters.status = 'open';
        if (k === 'urgent') { filters.status = 'open'; filters.priority = 'high_plus'; }
        if (k === 'external') filters.external = true;
        if (k === 'overdue') filters.overdue = true;
        if (k === 'resolved') filters.resolvedMonth = true;
        renderDashboard();
        $('#ticket-list').scrollIntoView({ behavior: 'smooth', block: 'start' });
        return;
      }
      const sortBtn = e.target.closest('[data-sort]');
      if (sortBtn) { handleSortClick(sortBtn, renderTicketList); return; }
      const act = e.target.closest('[data-action]');
      if (act) {
        const a = act.dataset.action;
        if (a === 'clear-filters') { filters = Object.assign({}, DEFAULT_FILTERS); renderDashboard(); $('#f-q').focus(); }
        if (a === 'export-filtered') exportCsv(sortTickets(applyFilters(state.tickets)), 'קריאות-תצוגה');
        if (a === 'export-all') exportCsv(sortTickets(state.tickets), 'כל-הקריאות');
        if (a === 'wipe') wipeAllData();
        if (a === 'restore-demo') restoreDemo();
        return;
      }
      const row = e.target.closest('tr[data-id]');
      if (row && !e.target.closest('a')) navigate('/tickets/' + row.dataset.id);
    };
  }

  function renderTicketList() {
    const container = $('#ticket-list');
    if (!container) return;
    const all = state.tickets;
    const list = sortTickets(applyFilters(all));
    $('#result-count').textContent = `מוצגות ${list.length} מתוך ${all.length} קריאות`;
    if (!all.length) { container.innerHTML = emptyListHtml(); return; }
    if (!list.length) {
      container.innerHTML = `<div class="empty-state"><h3>לא נמצאו קריאות התואמות לסינון</h3>
        <button type="button" class="btn btn-secondary" data-action="clear-filters">ניקוי סינון</button></div>`;
      return;
    }
    container.innerHTML = `
      <div class="table-wrap">
        <table class="tickets-table">
          <caption class="visually-hidden">רשימת קריאות. לחיצה על כותרת עמודה ממיינת את הרשימה.</caption>
          <thead><tr>${COLUMNS.map(sortHeader).join('')}</tr></thead>
          <tbody>
            ${list.map((t) => {
              const due = dueState(t);
              return `<tr data-id="${t.id}" class="${due ? 'row-' + due : ''} ${isOpen(t) ? '' : 'row-done'}">
                <td data-label="מס׳" class="col-num">#${t.number}</td>
                <td data-label="כותרת" class="col-title"><a href="/tickets/${t.id}">${esc(t.title)}</a>
                  ${t.updates.length ? `<span class="upd-count">${t.updates.length} עדכונים</span>` : ''}</td>
                <td data-label="קטגוריה">${esc(catName(t.categoryId))}</td>
                <td data-label="מיקום">${esc(locationText(t))}</td>
                <td data-label="עדיפות">${priorityBadge(t.priority)}</td>
                <td data-label="סטטוס">${statusBadge(t.status)}</td>
                <td data-label="אחראי">${esc(responsibleText(t))}</td>
                <td data-label="גורם חיצוני">${t.external.opened ? esc(t.external.company || 'נפתחה פנייה') : '—'}</td>
                <td data-label="מועד צפוי">${t.external.opened && t.external.expectedAt ? fmtDate(t.external.expectedAt) : '—'} ${dueBadge(t)}</td>
                <td data-label="ימים פתוחה" class="col-days">${daysOpen(t)}</td>
              </tr>`;
            }).join('')}
          </tbody>
        </table>
      </div>`;
  }

  /* ======================================================================
   * Table view – quick inline editing of many tickets
   * ==================================================================== */

  const TABLE_COLUMNS = [
    { key: 'number', label: 'מס׳' }, { key: 'title', label: 'כותרת' }, { key: 'category', label: 'קטגוריה' },
    { key: 'priority', label: 'עדיפות' }, { key: 'status', label: 'סטטוס' }, { key: 'responsible', label: 'אחראי' },
    { key: 'vendor', label: 'גורם חיצוני' }, { key: 'expected', label: 'מועד הגעה צפוי' }, { key: 'updated', label: 'עדכון אחרון' },
  ];

  function renderTable() {
    setView(`
      <div class="page-head">
        <div>
          <h1>מבנה טבלאי</h1>
          <p class="muted">עריכה מהירה: שינוי בתא נשמר מיד ונרשם בהיסטוריית הקריאה.</p>
        </div>
        <a class="btn btn-primary" href="/tickets/new"><span aria-hidden="true">＋</span> קריאה חדשה</a>
      </div>
      <section class="card" aria-label="טבלת קריאות">
        ${filtersHtml()}
        <div class="list-toolbar">
          <p id="result-count" class="muted" aria-live="polite"></p>
          <button type="button" class="btn btn-secondary btn-sm" data-action="export-filtered">⬇ ייצוא התצוגה ל-Excel</button>
        </div>
        <div id="grid-list"></div>
      </section>`);

    renderGrid();
    bindFilters(renderGrid);

    appEl.onclick = (e) => {
      const sortBtn = e.target.closest('[data-sort]');
      if (sortBtn) { handleSortClick(sortBtn, renderGrid); return; }
      const act = e.target.closest('[data-action]');
      if (!act) return;
      if (act.dataset.action === 'clear-filters') { filters = Object.assign({}, DEFAULT_FILTERS); renderTable(); }
      if (act.dataset.action === 'export-filtered') exportCsv(sortTickets(applyFilters(state.tickets)), 'קריאות-טבלה');
      if (act.dataset.action === 'restore-demo') restoreDemo();
    };

    // Inline edits (event delegation; the filter form has no data-field so it is ignored here)
    appEl.onchange = async (e) => {
      const el = e.target.closest('[data-field]');
      if (!el) return;
      const t = findTicket(el.dataset.id);
      if (!t) return;
      const field = el.dataset.field;
      let value = el.value;
      if (field === 'responsibleId') value = value ? Number(value) : null;
      const cell = el.closest('td');
      cell.classList.remove('cell-saved', 'cell-error');
      cell.classList.add('cell-saving');
      el.disabled = true;
      try {
        const body = { [field]: value };
        // Setting a date on a ticket without external handling opens it.
        if (field === 'extExpectedAt' && !t.external.opened && value) body.extOpened = true;
        const { ticket } = await api('PATCH', `/api/tickets/${t.id}`, body);
        replaceTicket(ticket);
        cell.classList.add('cell-saved');
        const row = el.closest('tr');
        const due = dueState(ticket);
        row.className = `${due ? 'row-' + due : ''} ${isOpen(ticket) ? '' : 'row-done'}`;
        $('.col-updated', row).textContent = fmtDateTime(ticket.updatedAt);
        $('.col-due', row).innerHTML = dueBadge(ticket);
        $('#grid-status').textContent = `קריאה #${ticket.number} עודכנה.`;
      } catch (err) {
        cell.classList.add('cell-error');
        toast(err.message, 'error');
        // Revert to the stored value
        const cur = field === 'extExpectedAt' ? t.external.expectedAt : t[field];
        el.value = cur == null ? '' : String(cur);
      } finally {
        cell.classList.remove('cell-saving');
        el.disabled = false;
      }
    };
  }

  function renderGrid() {
    const container = $('#grid-list');
    if (!container) return;
    const all = state.tickets;
    const list = sortTickets(applyFilters(all));
    $('#result-count').textContent = `מוצגות ${list.length} מתוך ${all.length} קריאות`;
    if (!all.length) { container.innerHTML = emptyListHtml(); return; }
    if (!list.length) { container.innerHTML = '<div class="empty-state"><h3>לא נמצאו קריאות התואמות לסינון</h3></div>'; return; }

    const options = (items, cur, labelFn) => items.map((i) => `<option value="${esc(i.id)}" ${String(i.id) === String(cur) ? 'selected' : ''}>${esc(labelFn(i))}</option>`).join('');
    container.innerHTML = `
      <p class="visually-hidden" id="grid-status" aria-live="polite"></p>
      <div class="table-wrap grid-wrap">
        <table class="tickets-table grid-table">
          <caption class="visually-hidden">טבלת עריכה מהירה. שינוי בתא נשמר מיד.</caption>
          <thead><tr>${TABLE_COLUMNS.map(sortHeader).join('')}</tr></thead>
          <tbody>
            ${list.map((t) => {
              const due = dueState(t);
              const lbl = (what) => esc(`${what} של קריאה ${t.number}`);
              return `<tr class="${due ? 'row-' + due : ''} ${isOpen(t) ? '' : 'row-done'}">
                <td data-label="מס׳" class="col-num">#${t.number}</td>
                <td data-label="כותרת" class="col-title"><a href="/tickets/${t.id}">${esc(t.title)}</a><small class="muted">${esc(locationText(t))}</small></td>
                <td data-label="קטגוריה">
                  <select data-field="categoryId" data-id="${t.id}" aria-label="${lbl('קטגוריה')}">${options(state.settings.categories, t.categoryId, (c) => c.name)}</select></td>
                <td data-label="עדיפות">
                  <select data-field="priority" data-id="${t.id}" class="sel-pr-${t.priority}" aria-label="${lbl('עדיפות')}">${options(PRIORITIES, t.priority, (p) => p.label)}</select></td>
                <td data-label="סטטוס">
                  <select data-field="status" data-id="${t.id}" aria-label="${lbl('סטטוס')}">${options(STATUSES, t.status, (s) => s.label)}</select></td>
                <td data-label="אחראי">
                  <select data-field="responsibleId" data-id="${t.id}" aria-label="${lbl('אחראי')}"><option value="">ללא</option>${options(state.members, t.responsibleId, (m) => m.name)}</select></td>
                <td data-label="גורם חיצוני">${t.external.opened ? esc(t.external.company || 'נפתחה פנייה') : '<span class="muted">—</span>'}</td>
                <td data-label="מועד הגעה צפוי">
                  <input type="date" data-field="extExpectedAt" data-id="${t.id}" value="${esc(t.external.expectedAt)}" aria-label="${lbl('מועד הגעה צפוי')}">
                  <span class="col-due">${dueBadge(t)}</span></td>
                <td data-label="עדכון אחרון" class="col-updated">${fmtDateTime(t.updatedAt)}</td>
              </tr>`;
            }).join('')}
          </tbody>
        </table>
      </div>`;
  }

  /* ======================================================================
   * Calendar view – vendor visit dates (drag to reschedule) or report dates
   * ==================================================================== */

  let calMonth = (() => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1); })();
  let calMode = 'expected'; // 'expected' | 'created' | 'contracts'

  /** Generic calendar events: { date, href, num, prefix, label, cls, title, badges, extra, sort, draggable, dragId }. */
  function calendarEvents() {
    if (calMode === 'contracts') {
      return state.contracts.flatMap((c) => {
        const st = contractState(c);
        const base = { href: `/contracts/${c.id}`, num: '', label: c.title, sort: c.id, draggable: false, badges: contractBadge(c), extra: c.company };
        return [
          { ...base, date: c.endDate, prefix: '📄', cls: st === 'expired' ? 'cal-overdue' : st === 'due' ? 'cal-upcoming' : '', title: `סיום / חידוש חוזה: ${c.title} · ${c.company}` },
          { ...base, date: reminderDate(c), prefix: '🔔', cls: 'cal-reminder', title: `תזכורת – חודש לפני חידוש החוזה: ${c.title}` },
        ];
      });
    }
    return state.tickets.flatMap((t) => {
      const due = calMode === 'expected' ? dueState(t) : null;
      const base = {
        href: `/tickets/${t.id}`, num: `#${t.number}`, prefix: '', label: t.title, sort: t.number,
        cls: `${due ? 'cal-' + due : ''} ${isOpen(t) ? '' : 'cal-done'}`,
        title: `#${t.number} ${t.title} · ${statusOf(t.status).label}${t.external.company && calMode === 'expected' ? ' · ' + t.external.company : ''}`,
        badges: statusBadge(t.status) + (calMode === 'expected' ? ' ' + dueBadge(t) : ''),
        extra: calMode === 'expected' ? t.external.company : '',
      };
      if (calMode === 'expected') {
        if (!t.external.opened || !t.external.expectedAt) return [];
        return [{ ...base, date: t.external.expectedAt, draggable: isOpen(t), dragId: t.id }];
      }
      return [{ ...base, date: toDateInput(new Date(t.createdAt)), draggable: false }];
    });
  }

  function renderCalendar() {
    const events = calendarEvents();
    const byDate = events.reduce((m, ev) => { (m[ev.date] ||= []).push(ev); return m; }, {});
    const first = new Date(calMonth);
    const start = new Date(first);
    start.setDate(1 - first.getDay()); // weeks start on Sunday
    const todayKey = toDateInput(new Date());
    const days = [];
    for (let i = 0; i < 42; i++) {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      days.push(d);
    }
    // Drop the last week if it is entirely in the next month
    if (days[35].getMonth() !== calMonth.getMonth()) days.length = 35;

    const chip = (ev) => `<a href="${ev.href}" class="cal-chip ${ev.cls}"
        ${ev.draggable ? `draggable="true" data-drag-id="${ev.dragId}"` : ''} title="${esc(ev.title)}">
        ${ev.prefix ? `<span aria-hidden="true">${ev.prefix}</span> ` : ''}${ev.num ? `<span class="cal-chip-num">${ev.num}</span> ` : ''}${esc(ev.label)}</a>`;

    const monthEvents = events.filter((ev) => {
      const d = parseDate(ev.date);
      return d.getFullYear() === calMonth.getFullYear() && d.getMonth() === calMonth.getMonth();
    }).sort((a, b) => a.date.localeCompare(b.date) || a.sort - b.sort);
    const MODE_TEXT = {
      expected: { desc: 'מועדי ההגעה שהבטיחו הגורמים החיצוניים. גררו קריאה פתוחה ליום אחר כדי לעדכן את המועד.', agenda: 'הגעות צפויות' },
      created: { desc: 'הקריאות לפי תאריך הדיווח.', agenda: 'דיווחים' },
      contracts: { desc: 'תאריכי סיום / חידוש של חוזי השירות (📄), והתזכורת חודש לפני כל אחד מהם (🔔).', agenda: 'חידושי חוזים ותזכורות' },
    }[calMode];

    setView(`
      <div class="page-head">
        <div>
          <h1>לוח שנה</h1>
          <p class="muted">${MODE_TEXT.desc}</p>
        </div>
        <div class="segmented" role="radiogroup" aria-label="מה להציג בלוח">
          ${[['expected', 'מועדי הגעה'], ['created', 'תאריכי דיווח'], ['contracts', 'חידושי חוזים']].map(([m, label]) =>
            `<button type="button" class="segmented-btn ${calMode === m ? 'is-active' : ''}" role="radio" aria-checked="${calMode === m}" data-mode="${m}">${label}</button>`).join('')}
        </div>
      </div>
      <section class="card calendar-card" aria-labelledby="cal-title">
        <div class="cal-toolbar">
          <button type="button" class="btn btn-secondary btn-sm" data-cal="prev" aria-label="החודש הקודם">→ הקודם</button>
          <h2 id="cal-title" aria-live="polite">${esc(dfMonthLong.format(calMonth))}</h2>
          <button type="button" class="btn btn-secondary btn-sm" data-cal="next" aria-label="החודש הבא">הבא ←</button>
          <button type="button" class="btn btn-ghost btn-sm" data-cal="today">היום</button>
        </div>
        <div class="cal-grid" role="grid" aria-labelledby="cal-title">
          <div class="cal-row cal-head" role="row">
            ${days.slice(0, 7).map((d) => `<div class="cal-dow" role="columnheader">${esc(dfWeekday.format(d))}</div>`).join('')}
          </div>
          ${Array.from({ length: days.length / 7 }, (_, w) => `<div class="cal-row" role="row">${days.slice(w * 7, w * 7 + 7).map((d) => {
            const key = toDateInput(d);
            const evs = byDate[key] || [];
            const other = d.getMonth() !== calMonth.getMonth();
            return `<div class="cal-day ${other ? 'cal-other' : ''} ${key === todayKey ? 'cal-today' : ''}" role="gridcell" data-date="${key}"
                aria-label="${esc(dfWeekdayLong.format(d) + (evs.length ? `, ${evs.length} אירועים` : ''))}">
              <span class="cal-date" aria-hidden="true">${d.getDate()}</span>
              <div class="cal-events">${evs.slice(0, 3).map(chip).join('')}${evs.length > 3 ? `<span class="cal-more">+${evs.length - 3} נוספות</span>` : ''}</div>
            </div>`;
          }).join('')}</div>`).join('')}
        </div>
        <p class="cal-legend">${calMode === 'contracts'
          ? '<span class="cal-chip cal-overdue">פג תוקף</span> <span class="cal-chip cal-upcoming">לחידוש בקרוב</span> <span class="cal-chip">בתוקף</span> <span class="cal-chip cal-reminder">תזכורת</span>'
          : '<span class="cal-chip cal-overdue">באיחור</span> <span class="cal-chip cal-upcoming">מתקרב</span> <span class="cal-chip">מתוכנן</span> <span class="cal-chip cal-done">טופל / סגור</span>'}</p>
      </section>

      <section class="card" aria-labelledby="agenda-h">
        <h2 id="agenda-h">${MODE_TEXT.agenda} ב${esc(dfMonthShort.format(calMonth))} <span class="count">${monthEvents.length}</span></h2>
        ${monthEvents.length ? `<ul class="agenda">${monthEvents.map((ev) => `
          <li><time datetime="${ev.date}">${esc(dfWeekdayLong.format(parseDate(ev.date)))}</time>
            <a href="${ev.href}">${ev.prefix ? `<span aria-hidden="true">${ev.prefix}</span> ${ev.prefix === '🔔' ? 'תזכורת: ' : 'חידוש: '}` : ''}${ev.num ? ev.num + ' – ' : ''}${esc(ev.label)}</a>
            ${ev.badges}
            ${ev.extra ? `<span class="muted">${esc(ev.extra)}</span>` : ''}</li>`).join('')}</ul>`
          : '<p class="muted">אין אירועים בחודש זה.</p>'}
      </section>`);

    appEl.onclick = (e) => {
      const m = e.target.closest('[data-mode]');
      if (m) { calMode = m.dataset.mode; renderCalendar(); return; }
      const c = e.target.closest('[data-cal]');
      if (!c) return;
      if (c.dataset.cal === 'prev') calMonth = new Date(calMonth.getFullYear(), calMonth.getMonth() - 1, 1);
      if (c.dataset.cal === 'next') calMonth = new Date(calMonth.getFullYear(), calMonth.getMonth() + 1, 1);
      if (c.dataset.cal === 'today') { const d = new Date(); calMonth = new Date(d.getFullYear(), d.getMonth(), 1); }
      renderCalendar();
      const again = $(`[data-cal="${c.dataset.cal}"]`);
      if (again) again.focus();
    };

    // Drag & drop rescheduling of the expected arrival date
    appEl.ondragstart = (e) => {
      const el = e.target.closest('[data-drag-id]');
      if (!el) return;
      e.dataTransfer.setData('text/plain', el.dataset.dragId);
      e.dataTransfer.effectAllowed = 'move';
      el.classList.add('dragging');
    };
    appEl.ondragover = (e) => {
      const day = e.target.closest('.cal-day');
      if (!day) return;
      e.preventDefault();
      $$('.cal-drop').forEach((x) => x !== day && x.classList.remove('cal-drop'));
      day.classList.add('cal-drop');
    };
    appEl.ondragleave = (e) => {
      const day = e.target.closest('.cal-day');
      if (day && !day.contains(e.relatedTarget)) day.classList.remove('cal-drop');
    };
    appEl.ondrop = async (e) => {
      const day = e.target.closest('.cal-day');
      $$('.cal-drop, .dragging').forEach((x) => x.classList.remove('cal-drop', 'dragging'));
      if (!day) return;
      e.preventDefault();
      const t = findTicket(e.dataTransfer.getData('text/plain'));
      if (!t || t.external.expectedAt === day.dataset.date) return;
      await attempt(async () => {
        const { ticket } = await api('PATCH', `/api/tickets/${t.id}`, { extExpectedAt: day.dataset.date });
        replaceTicket(ticket);
        toast(`מועד ההגעה של קריאה #${ticket.number} עודכן ל-${fmtDate(ticket.external.expectedAt)}.`, 'success');
        renderCalendar();
      });
    };
  }

  /* ======================================================================
   * Ticket detail
   * ==================================================================== */

  function notFoundHtml() {
    return `<div class="card empty-state"><h1>הקריאה לא נמצאה</h1><p class="muted">ייתכן שהקריאה נמחקה.</p>
      <a href="/dashboard" class="btn btn-primary">חזרה ללוח הבקרה</a></div>`;
  }

  function renderTicket(id) {
    const t = findTicket(id);
    if (!t) { setView(notFoundHtml()); return; }
    const due = dueState(t);
    const ex = t.external;
    const resp = member(t.responsibleId);
    const canDeleteUpdate = (u) => isOwner() || u.authorId === state.user.id;

    setView(`
      <nav class="breadcrumbs" aria-label="מיקום בעמוד">
        <a href="/dashboard">לוח בקרה</a><span aria-hidden="true">‹</span><span aria-current="page">קריאה #${t.number}</span>
      </nav>

      <section class="card ticket-head">
        <div class="ticket-head-main">
          <div class="ticket-number"><small>קריאה</small>#${t.number}</div>
          <div class="ticket-head-text">
            <h1 class="ticket-title">${esc(t.title)}</h1>
            <div class="badges">${statusBadge(t.status)}${priorityBadge(t.priority)}${dueBadge(t)}<span class="badge badge-neutral">${esc(catName(t.categoryId))}</span></div>
            <p class="meta">דווחה ב-${fmtDateTime(t.createdAt)}${t.createdByName ? ' על ידי ' + esc(t.createdByName) : ''} · עדכון אחרון ${fmtDateTime(t.updatedAt)} · ${isOpen(t) ? 'פתוחה' : 'הייתה פתוחה'} ${daysOpen(t)} ימים</p>
          </div>
        </div>
        <div class="btn-row ticket-actions">
          <a class="btn btn-primary" href="/tickets/${t.id}/edit">✎ עריכה</a>
          <button type="button" class="btn btn-whatsapp" data-action="whatsapp">💬 טקסט לוואטסאפ</button>
          <button type="button" class="btn btn-secondary" data-action="print">🖨 הדפסת סיכום</button>
          <button type="button" class="btn btn-danger-outline" data-action="delete-ticket">🗑 מחיקה</button>
        </div>
      </section>

      ${due === 'overdue' ? `<div class="alert alert-danger" role="alert"><strong>⚠ באיחור:</strong> הגורם החיצוני היה אמור להגיע עד ${fmtDate(ex.expectedAt)} (${dueText(t)}) והתקלה טרם טופלה.</div>` : ''}
      ${due === 'upcoming' ? `<div class="alert alert-warning"><strong>⏰ מועד מתקרב:</strong> הגעת הגורם החיצוני צפויה ב-${fmtDate(ex.expectedAt)} (${dueText(t)}).</div>` : ''}

      <div class="ticket-layout">
        <div class="ticket-main">
          <section class="card" aria-labelledby="desc-h">
            <h2 id="desc-h">תיאור התקלה</h2>
            <p class="description">${t.description ? nl2br(t.description) : '<span class="muted">לא הוזן תיאור.</span>'}</p>
            ${t.media.length ? `<h3 class="sub-h">קבצים מצורפים לדיווח</h3>${mediaGrid(t.media)}` : ''}
          </section>

          <section class="card" aria-labelledby="add-upd-h">
            <h2 id="add-upd-h">הוספת עדכון</h2>
            <form id="update-form" class="update-form" novalidate>
              <div class="grid-2">
                <div class="field">
                  <span class="label">כותב/ת העדכון</span>
                  <p class="static-field">${esc(state.user.name)}</p>
                </div>
                <div class="field">
                  <label for="u-status">שינוי סטטוס (אופציונלי)</label>
                  <select id="u-status" name="status"><option value="">ללא שינוי (${esc(statusOf(t.status).label)})</option>
                    ${STATUSES.filter((s) => s.id !== t.status).map((s) => `<option value="${s.id}">${esc(s.label)}</option>`).join('')}</select>
                </div>
                <div class="field span-2">
                  <label for="u-text">תוכן העדכון</label>
                  <textarea id="u-text" name="text" rows="3" maxlength="5000" placeholder="מה התחדש? למשל: הטכנאי ביקר והזמין חלק חלופי…"></textarea>
                  <p class="field-error" id="u-text-err" hidden></p>
                </div>
                <div class="field span-2">${filePickerHtml('u-files')}</div>
              </div>
              <div class="btn-row"><button type="submit" class="btn btn-primary">הוספת העדכון</button></div>
            </form>
          </section>

          <section class="card" aria-labelledby="tl-h">
            <h2 id="tl-h">עדכונים <span class="count">${t.updates.length}</span></h2>
            ${t.updates.length ? `<ol class="timeline">${t.updates.map((u) => `
              <li class="tl-item">
                <span class="tl-dot" aria-hidden="true"></span>
                <article class="tl-body">
                  <header class="tl-head">
                    <strong>${esc(u.authorName || 'ללא שם')}</strong>
                    <time datetime="${esc(u.at)}">${fmtDateTime(u.at)}</time>
                  </header>
                  ${u.statusTo ? `<p class="tl-status">הסטטוס שונה: ${statusBadge(u.statusFrom)} <span aria-hidden="true">←</span><span class="visually-hidden">ל</span> ${statusBadge(u.statusTo)}</p>` : ''}
                  ${u.text ? `<p class="tl-text">${nl2br(u.text)}</p>` : ''}
                  ${mediaGrid(u.media, { deletable: canDeleteUpdate(u) })}
                  ${canDeleteUpdate(u) ? `<button type="button" class="link-btn link-danger" data-action="delete-update" data-update-id="${u.id}">מחיקת העדכון</button>` : ''}
                </article>
              </li>`).join('')}</ol>` : '<p class="muted">אין עדיין עדכונים לקריאה זו.</p>'}
          </section>
        </div>

        <aside class="ticket-side" aria-label="פרטי הקריאה">
          <section class="card" aria-labelledby="det-h">
            <h2 id="det-h">פרטי הקריאה</h2>
            <dl class="details">
              <dt>קטגוריה</dt><dd>${esc(catName(t.categoryId))}</dd>
              <dt>מיקום</dt><dd>${esc(locationText(t))}</dd>
              <dt>מדווח/ת</dt><dd>${esc(t.reporter.name || '—')}${t.reporter.phone ? '<br>' + telLink(t.reporter.phone) : ''}</dd>
              <dt>אופן הדיווח</dt><dd>${esc(channelLabel(t.reporter.channel))}</dd>
              <dt>אחראי/ת לקריאה</dt><dd>${t.responsibleId ? esc(responsibleText(t)) + (resp && resp.phone ? '<br>' + telLink(resp.phone) : '') : '—'}</dd>
              <dt>תאריך דיווח</dt><dd>${fmtDateTime(t.createdAt)}</dd>
              <dt>עדכון אחרון</dt><dd>${fmtDateTime(t.updatedAt)}</dd>
              <dt>תאריך פתרון</dt><dd>${t.resolvedAt ? fmtDateTime(t.resolvedAt) : '—'}</dd>
            </dl>
          </section>

          <section class="card external-card ${due ? 'ext-' + due : ''}" aria-labelledby="ext-h">
            <h2 id="ext-h">טיפול חיצוני</h2>
            ${ex.opened ? `
              <p class="ext-flag">✔ נפתחה תקלה אצל גורם חיצוני</p>
              <dl class="details">
                <dt>חברה / ספק</dt><dd>${esc(ex.company || '—')}</dd>
                <dt>מספר קריאה אצל הספק</dt><dd><span dir="ltr">${esc(ex.refNo || '—')}</span></dd>
                <dt>איש המקצוע</dt><dd>${esc(ex.contactName || '—')}</dd>
                <dt>טלפון</dt><dd>${telLink(ex.contactPhone)}</dd>
                <dt>תאריך הפנייה</dt><dd>${fmtDate(ex.referredAt)}</dd>
                <dt>מועד הגעה צפוי</dt><dd>${fmtDate(ex.expectedAt)} ${dueBadge(t)}${due ? `<br><small>${dueText(t)}</small>` : ''}</dd>
              </dl>
              ${ex.contactPhone ? `<a class="btn btn-primary btn-block" href="tel:${esc(ex.contactPhone.replace(/[^\d+]/g, ''))}">📞 התקשרות ל${esc(ex.contactName || 'איש המקצוע')}</a>` : ''}
            ` : `<p class="muted">לא נפתחה תקלה אצל גורם חיצוני.</p><a class="btn btn-secondary btn-sm" href="/tickets/${t.id}/edit">פתיחת טיפול חיצוני</a>`}
          </section>

          <section class="card" aria-labelledby="hist-h">
            <h2 id="hist-h">היסטוריית סטטוסים</h2>
            <ol class="status-history">
              ${t.statusHistory.slice().reverse().map((h) => `
                <li>${statusBadge(h.status)}<span class="sh-meta"><time datetime="${esc(h.at)}">${fmtDateTime(h.at)}</time>${h.byName ? ' · ' + esc(h.byName) : ''}</span></li>`).join('')}
            </ol>
          </section>
        </aside>
      </div>`);

    const picker = bindFilePicker($('#u-files'));

    appEl.onsubmit = async (e) => {
      if (e.target.id !== 'update-form') return;
      e.preventDefault();
      const form = e.target;
      const text = form.elements.text.value.trim();
      const status = form.elements.status.value;
      const files = picker.files;
      const err = $('#u-text-err');
      if (!text && !files.length && !status) {
        err.textContent = 'יש לכתוב תוכן לעדכון, לצרף קובץ או לשנות סטטוס.';
        err.hidden = false;
        form.elements.text.setAttribute('aria-invalid', 'true');
        form.elements.text.setAttribute('aria-describedby', 'u-text-err');
        form.elements.text.focus();
        return;
      }
      const btn = $('button[type="submit"]', form);
      btn.disabled = true;
      btn.textContent = files.length ? 'מעלה קבצים…' : 'שומר…';
      const ok = await attempt(async () => {
        const res = await api('POST', `/api/tickets/${t.id}/updates`, { text, status: status || null, withMedia: files.length > 0 });
        if (files.length) await uploadFiles(t.id, files, res.updateId);
        const { ticket } = files.length ? await api('GET', `/api/tickets/${t.id}`) : res;
        replaceTicket(ticket);
        return true;
      });
      if (!ok) { btn.disabled = false; btn.textContent = 'הוספת העדכון'; return; }
      picker.clear();
      toast('העדכון נוסף בהצלחה.', 'success');
      renderTicket(t.id);
      const tl = $('#tl-h');
      if (tl) tl.scrollIntoView({ behavior: 'smooth', block: 'start' });
    };

    appEl.onclick = async (e) => {
      const act = e.target.closest('[data-action]');
      if (!act) return;
      const a = act.dataset.action;
      if (a === 'open-image') { const fig = act.closest('[data-media-id]'); openLightbox(fig.dataset.mediaUrl, fig.dataset.mediaName); return; }
      if (a === 'whatsapp') { showWhatsApp(t); return; }
      if (a === 'print') { printTicket(t); return; }
      if (a === 'delete-ticket') {
        const ok = await confirmDialog(`למחוק לצמיתות את קריאה #${t.number} – "${t.title}"?\nכל העדכונים והקבצים המצורפים יימחקו, גם אצל שאר חברי הוועד.`, { okLabel: 'מחיקת הקריאה', danger: true, title: 'מחיקת קריאה' });
        if (!ok) return;
        await attempt(async () => {
          await api('DELETE', `/api/tickets/${t.id}`);
          state.tickets = state.tickets.filter((x) => x.id !== t.id);
          toast(`קריאה #${t.number} נמחקה.`, 'success');
          navigate('/dashboard');
        });
        return;
      }
      if (a === 'delete-update') {
        const ok = await confirmDialog('למחוק את העדכון? הקבצים המצורפים אליו יימחקו גם הם.', { okLabel: 'מחיקה', danger: true });
        if (!ok) return;
        await attempt(async () => {
          const { ticket } = await api('DELETE', `/api/tickets/${t.id}/updates/${act.dataset.updateId}`);
          replaceTicket(ticket);
          toast('העדכון נמחק.', 'success');
          rerender();
        });
        return;
      }
      if (a === 'delete-media') {
        const fig = act.closest('[data-media-id]');
        const ok = await confirmDialog('למחוק את הקובץ המצורף?', { okLabel: 'מחיקה', danger: true });
        if (!ok) return;
        await attempt(async () => {
          const { ticket } = await api('DELETE', `/api/media/${fig.dataset.mediaId}`);
          replaceTicket(ticket);
          toast('הקובץ נמחק.', 'success');
          rerender();
        });
      }
    };
  }

  /* ======================================================================
   * Ticket create / edit form
   * ==================================================================== */

  function renderForm(id) {
    const existing = id ? findTicket(id) : null;
    if (id && !existing) { setView(notFoundHtml()); return; }
    const t = existing || {
      title: '', description: '', categoryId: null, floorId: null, areaId: null, apartment: '', priority: 'medium', status: 'new',
      reporter: { name: '', phone: '', channel: 'whatsapp' }, responsibleId: state.user.id, media: [],
      external: { opened: false, vendorId: null, company: '', refNo: '', contactName: '', contactPhone: '', referredAt: '', expectedAt: '' },
    };
    const ex = t.external;
    const sel = (items, cur, empty, labelFn = (i) => i.name) =>
      (empty != null ? `<option value="">${esc(empty)}</option>` : '') +
      items.map((i) => `<option value="${esc(i.id)}" ${String(i.id) === String(cur) ? 'selected' : ''}>${esc(labelFn(i))}</option>`).join('');

    setView(`
      <nav class="breadcrumbs" aria-label="מיקום בעמוד">
        <a href="/dashboard">לוח בקרה</a><span aria-hidden="true">‹</span>
        ${existing ? `<a href="/tickets/${t.id}">קריאה #${t.number}</a><span aria-hidden="true">‹</span><span aria-current="page">עריכה</span>` : '<span aria-current="page">קריאה חדשה</span>'}
      </nav>
      <div class="page-head">
        <div>
          <h1>${existing ? `עריכת קריאה #${t.number}` : 'פתיחת קריאה חדשה'}</h1>
          <p class="muted">${existing ? 'שינויים בסטטוס יירשמו בהיסטוריית הקריאה.' : 'מספר הקריאה יוקצה אוטומטית בשמירה.'}</p>
        </div>
      </div>

      <form id="ticket-form" class="ticket-form" novalidate>
        <div class="form-error-summary alert alert-danger" id="form-errors" role="alert" hidden></div>

        <fieldset class="card">
          <legend>פרטי התקלה</legend>
          <div class="grid-2">
            <div class="field span-2">
              <label for="tf-title">כותרת <span class="req" aria-hidden="true">*</span></label>
              <input id="tf-title" name="title" required maxlength="200" value="${esc(t.title)}" placeholder="תיאור קצר, למשל: נזילה בחדר המדרגות">
            </div>
            <div class="field span-2">
              <label for="tf-desc">תיאור מפורט</label>
              <textarea id="tf-desc" name="description" rows="4" maxlength="5000" placeholder="מה בדיוק קרה, ממתי, ומי מושפע">${esc(t.description)}</textarea>
            </div>
            <div class="field">
              <label for="tf-cat">קטגוריה <span class="req" aria-hidden="true">*</span></label>
              <select id="tf-cat" name="categoryId" required>${sel(state.settings.categories, t.categoryId, 'בחירת קטגוריה…')}</select>
            </div>
            <div class="field">
              <label for="tf-status">סטטוס</label>
              <select id="tf-status" name="status">${sel(STATUSES, t.status, null, (s) => s.label)}</select>
            </div>
            <div class="field span-2">
              <span class="label" id="prio-label">עדיפות</span>
              <div class="pill-group" role="radiogroup" aria-labelledby="prio-label">
                ${PRIORITIES.map((p) => `<label class="pill pill-${p.id}"><input type="radio" name="priority" value="${p.id}" ${t.priority === p.id ? 'checked' : ''}><span>${p.label}</span></label>`).join('')}
              </div>
            </div>
          </div>
        </fieldset>

        <fieldset class="card">
          <legend>מיקום בבניין</legend>
          <div class="grid-3">
            <div class="field">
              <label for="tf-floor">קומה</label>
              <select id="tf-floor" name="floorId">${sel(state.settings.floors, t.floorId, 'לא צוין', (f) => bidiFix(f.name))}</select>
            </div>
            <div class="field">
              <label for="tf-area">אזור</label>
              <select id="tf-area" name="areaId">${sel(state.settings.areas, t.areaId, 'לא צוין')}</select>
            </div>
            <div class="field">
              <label for="tf-apt">מספר דירה <small class="muted">(אם רלוונטי)</small></label>
              <input id="tf-apt" name="apartment" value="${esc(t.apartment)}" inputmode="numeric" maxlength="10">
            </div>
          </div>
          <div id="recurring-hint" aria-live="polite"></div>
        </fieldset>

        <fieldset class="card">
          <legend>מדווח ואחראי</legend>
          <div class="grid-2">
            <div class="field">
              <label for="tf-rname">שם המדווח/ת</label>
              <input id="tf-rname" name="reporterName" value="${esc(t.reporter.name)}" maxlength="80" autocomplete="off">
            </div>
            <div class="field">
              <label for="tf-rphone">טלפון המדווח/ת</label>
              <input id="tf-rphone" name="reporterPhone" type="tel" dir="ltr" inputmode="tel" maxlength="20" value="${esc(t.reporter.phone)}" placeholder="050-0000000">
            </div>
            <div class="field">
              <label for="tf-channel">אופן הדיווח</label>
              <select id="tf-channel" name="reporterChannel">${sel(CHANNELS, t.reporter.channel, null, (c) => c.label)}</select>
            </div>
            <div class="field">
              <label for="tf-resp">אחראי/ת לקריאה (חבר/ת ועד)</label>
              <select id="tf-resp" name="responsibleId">${sel(state.members, t.responsibleId, 'ללא אחראי', (m) => m.name + (m.phone ? ' · ' + m.phone : ''))}</select>
            </div>
          </div>
        </fieldset>

        <fieldset class="card">
          <legend>טיפול חיצוני</legend>
          <label class="switch">
            <input type="checkbox" id="tf-ext" name="extOpened" ${ex.opened ? 'checked' : ''}>
            <span class="switch-track" aria-hidden="true"></span>
            <span>האם נפתחה תקלה אצל גורם חיצוני?</span>
          </label>
          <div id="ext-fields" class="ext-fields" ${ex.opened ? '' : 'hidden'}>
            <div class="grid-2">
              <div class="field span-2">
                <label for="tf-vendor">בחירה מספר הספקים <small class="muted">(ממלא את הפרטים אוטומטית)</small></label>
                <select id="tf-vendor" name="extVendorId">${sel(state.settings.vendors, ex.vendorId, '— ספק שאינו ברשימה —', (v) => v.company + (v.specialty ? ' (' + v.specialty + ')' : ''))}</select>
              </div>
              <div class="field">
                <label for="tf-company">שם החברה / הספק</label>
                <input id="tf-company" name="extCompany" maxlength="100" value="${esc(ex.company)}">
              </div>
              <div class="field">
                <label for="tf-ref">מספר קריאה אצל הספק</label>
                <input id="tf-ref" name="extRef" dir="ltr" maxlength="60" value="${esc(ex.refNo)}" placeholder="SC-00000">
              </div>
              <div class="field">
                <label for="tf-cname">שם איש המקצוע המטפל</label>
                <input id="tf-cname" name="extContact" maxlength="80" value="${esc(ex.contactName)}">
              </div>
              <div class="field">
                <label for="tf-cphone">טלפון איש המקצוע</label>
                <input id="tf-cphone" name="extPhone" type="tel" dir="ltr" inputmode="tel" maxlength="20" value="${esc(ex.contactPhone)}" placeholder="050-0000000">
              </div>
              <div class="field">
                <label for="tf-referred">תאריך הפנייה</label>
                <input id="tf-referred" name="extReferredAt" type="date" value="${esc(ex.referredAt)}">
              </div>
              <div class="field">
                <label for="tf-expected">מתי אמור להגיע / מועד תיקון שהובטח</label>
                <input id="tf-expected" name="extExpectedAt" type="date" value="${esc(ex.expectedAt)}">
              </div>
            </div>
            <button type="button" class="btn btn-ghost btn-sm" data-action="save-vendor">＋ שמירת הספק בספר הספקים</button>
          </div>
        </fieldset>

        <fieldset class="card">
          <legend>תמונות וסרטונים</legend>
          ${existing && t.media.length ? `<p class="muted">קבצים קיימים:</p>${mediaGrid(t.media)}` : ''}
          ${filePickerHtml('tf-files')}
        </fieldset>

        <div class="form-actions">
          <button type="submit" class="btn btn-primary btn-lg">${existing ? 'שמירת השינויים' : 'פתיחת הקריאה'}</button>
          <a class="btn btn-secondary btn-lg" href="${existing ? '/tickets/' + t.id : '/dashboard'}">ביטול</a>
        </div>
      </form>`);

    const form = $('#ticket-form');
    const picker = bindFilePicker($('#tf-files'));
    const numOrNull = (v) => (v ? Number(v) : null);

    const updateHint = () => {
      const catId = numOrNull(form.elements.categoryId.value);
      const floorId = numOrNull(form.elements.floorId.value);
      const areaId = numOrNull(form.elements.areaId.value);
      const box = $('#recurring-hint');
      const similar = findSimilar(catId, floorId, areaId, form.elements.apartment.value.trim(), existing && existing.id);
      if (!similar.length) { box.innerHTML = ''; return; }
      const wide = areaId && WIDE_AREA_NAMES.has(areaName(areaId));
      const where = [areaName(areaId), wide ? '' : floorName(floorId)].filter(Boolean).join(', ');
      box.innerHTML = `
        <div class="alert alert-info recurring">
          <p><strong>💡 תקלה חוזרת?</strong> במיקום זה (${esc(where)}) דווחו בעבר ${similar.length === 1 ? 'תקלה אחת' : similar.length + ' תקלות'} מסוג ${esc(catName(catId))}:</p>
          <ul>${similar.slice(0, 6).map((s) => `<li><a href="/tickets/${s.id}" target="_blank" rel="noopener">#${s.number} – ${esc(s.title)}</a>
            <span class="muted">(${fmtDate(s.createdAt)})</span> ${statusBadge(s.status)}</li>`).join('')}</ul>
        </div>`;
    };
    updateHint();

    appEl.onchange = (e) => {
      const n = e.target.name;
      if (['categoryId', 'floorId', 'areaId', 'apartment'].includes(n)) updateHint();
      if (n === 'extOpened') {
        $('#ext-fields').hidden = !e.target.checked;
        if (e.target.checked && !$('#tf-referred').value) $('#tf-referred').value = toDateInput(new Date());
      }
      if (n === 'extVendorId') {
        const v = byId(state.settings.vendors, Number(e.target.value));
        if (v) {
          $('#tf-company').value = v.company || '';
          $('#tf-cname').value = v.contact || '';
          $('#tf-cphone').value = v.phone || '';
          toast(`פרטי "${v.company}" מולאו אוטומטית.`, 'info');
        }
      }
    };
    appEl.oninput = (e) => { if (e.target.name === 'apartment') updateHint(); };

    appEl.onclick = async (e) => {
      const act = e.target.closest('[data-action]');
      if (!act) return;
      const a = act.dataset.action;
      if (a === 'open-image') { const fig = act.closest('[data-media-id]'); openLightbox(fig.dataset.mediaUrl, fig.dataset.mediaName); return; }
      if (a === 'save-vendor') {
        const company = $('#tf-company').value.trim();
        if (!company) { toast('יש להזין שם חברה לפני השמירה בספר הספקים.', 'error'); $('#tf-company').focus(); return; }
        const catId = numOrNull(form.elements.categoryId.value);
        await attempt(async () => {
          const { vendor } = await api('POST', '/api/vendors', {
            company, contact: $('#tf-cname').value.trim(), phone: $('#tf-cphone').value.trim(), specialty: catId ? catName(catId) : '',
          });
          state.settings.vendors.push(vendor);
          const vs = $('#tf-vendor');
          vs.insertAdjacentHTML('beforeend', `<option value="${vendor.id}">${esc(vendor.company)}${vendor.specialty ? ' (' + esc(vendor.specialty) + ')' : ''}</option>`);
          vs.value = String(vendor.id);
          toast(`"${company}" נשמר בספר הספקים.`, 'success');
        });
        return;
      }
      if (a === 'delete-media' && existing) {
        const fig = act.closest('[data-media-id]');
        const ok = await confirmDialog('למחוק את הקובץ המצורף?', { okLabel: 'מחיקה', danger: true });
        if (!ok) return;
        await attempt(async () => {
          const { ticket } = await api('DELETE', `/api/media/${fig.dataset.mediaId}`);
          replaceTicket(ticket);
          fig.remove();
          toast('הקובץ נמחק.', 'success');
        });
      }
    };

    appEl.onsubmit = async (e) => {
      e.preventDefault();
      await saveTicketForm(form, existing, picker);
    };
  }

  function showFieldError(form, name, msg) {
    const el = form.elements[name];
    if (!el || !el.closest) return;
    const errId = el.id + '-err';
    el.setAttribute('aria-invalid', 'true');
    el.setAttribute('aria-describedby', errId);
    const p = document.createElement('p');
    p.className = 'field-error';
    p.id = errId;
    p.textContent = msg;
    el.closest('.field').appendChild(p);
  }

  function clearFieldErrors(form) {
    $$('.field-error', form).forEach((p) => p.remove());
    $$('[aria-invalid]', form).forEach((el) => { el.removeAttribute('aria-invalid'); el.removeAttribute('aria-describedby'); });
    $('#form-errors').hidden = true;
  }

  async function saveTicketForm(form, existing, picker) {
    clearFieldErrors(form);
    const v = (k) => String(form.elements[k] ? (form.elements[k].value ?? '') : '').trim();
    const extOpened = form.elements.extOpened.checked;
    const phoneOk = (p) => !p || /^[0-9+\-\s()]{7,20}$/.test(p);

    const errors = [];
    if (!v('title')) errors.push(['title', 'יש להזין כותרת לתקלה.']);
    if (!v('categoryId')) errors.push(['categoryId', 'יש לבחור קטגוריה.']);
    if (!phoneOk(v('reporterPhone'))) errors.push(['reporterPhone', 'מספר הטלפון אינו תקין.']);
    if (extOpened) {
      if (!phoneOk(v('extPhone'))) errors.push(['extPhone', 'מספר הטלפון אינו תקין.']);
      if (v('extReferredAt') && v('extExpectedAt') && v('extExpectedAt') < v('extReferredAt')) errors.push(['extExpectedAt', 'מועד ההגעה אינו יכול להיות לפני תאריך הפנייה.']);
    }
    if (errors.length) {
      errors.forEach(([n, m]) => showFieldError(form, n, m));
      const summary = $('#form-errors');
      summary.innerHTML = `<strong>יש לתקן ${errors.length === 1 ? 'שגיאה אחת' : errors.length + ' שגיאות'}:</strong><ul>${errors.map(([, m]) => `<li>${esc(m)}</li>`).join('')}</ul>`;
      summary.hidden = false;
      form.elements[errors[0][0]].focus();
      return;
    }

    const numOrNull = (x) => (x ? Number(x) : null);
    const payload = {
      title: v('title'), description: v('description'), categoryId: numOrNull(v('categoryId')),
      floorId: numOrNull(v('floorId')), areaId: numOrNull(v('areaId')), apartment: v('apartment'),
      priority: (form.querySelector('input[name="priority"]:checked') || {}).value || 'medium',
      status: v('status') || 'new',
      reporterName: v('reporterName'), reporterPhone: v('reporterPhone'), reporterChannel: v('reporterChannel') || 'whatsapp',
      responsibleId: numOrNull(v('responsibleId')),
      extOpened,
      extVendorId: extOpened ? numOrNull(v('extVendorId')) : null,
      extCompany: extOpened ? v('extCompany') : '', extRef: extOpened ? v('extRef') : '',
      extContact: extOpened ? v('extContact') : '', extPhone: extOpened ? v('extPhone') : '',
      extReferredAt: extOpened ? v('extReferredAt') : '', extExpectedAt: extOpened ? v('extExpectedAt') : '',
    };

    const btn = $('button[type="submit"]', form);
    btn.disabled = true;
    btn.textContent = 'שומר…';
    try {
      let { ticket } = existing
        ? await api('PUT', `/api/tickets/${existing.id}`, payload)
        : await api('POST', '/api/tickets', payload);
      const files = picker.files;
      if (files.length) {
        btn.textContent = 'מעלה קבצים…';
        await uploadFiles(ticket.id, files);
        ({ ticket } = await api('GET', `/api/tickets/${ticket.id}`));
      }
      replaceTicket(ticket);
      toast(existing ? 'השינויים נשמרו.' : `קריאה #${ticket.number} נפתחה בהצלחה.`, 'success');
      navigate('/tickets/' + ticket.id);
    } catch (err) {
      toast(err.message, 'error');
      const summary = $('#form-errors');
      summary.textContent = err.message;
      summary.hidden = false;
      btn.disabled = false;
      btn.textContent = existing ? 'שמירת השינויים' : 'פתיחת הקריאה';
    }
  }

  /* ======================================================================
   * Statistics
   * ==================================================================== */

  function barChart(rows, { color = 'var(--primary)', suffix = '' } = {}) {
    if (!rows.length) return '<p class="muted">אין נתונים להצגה.</p>';
    const max = Math.max(1, ...rows.map((r) => r.value));
    return `<ul class="bar-chart">${rows.map((r) => `
      <li>
        <span class="bar-label">${esc(r.label)}</span>
        <span class="bar-track"><span class="bar-fill" style="width:${(r.value / max) * 100}%;background:${r.color || color}"></span></span>
        <span class="bar-value">${nfNum.format(r.value)}${suffix}</span>
      </li>`).join('')}</ul>`;
  }

  function donutChart(segments, centerLabel) {
    const total = segments.reduce((s, x) => s + x.value, 0);
    const r = 60, c = 2 * Math.PI * r;
    let offset = 0;
    const arcs = total ? segments.filter((s) => s.value).map((s) => {
      const len = (s.value / total) * c;
      const el = `<circle r="${r}" cx="80" cy="80" fill="none" stroke="${s.color}" stroke-width="26"
        stroke-dasharray="${len} ${c - len}" stroke-dashoffset="${-offset}" transform="rotate(-90 80 80)"><title>${esc(s.label)}: ${s.value}</title></circle>`;
      offset += len;
      return el;
    }).join('') : `<circle r="${r}" cx="80" cy="80" fill="none" stroke="var(--border)" stroke-width="26"/>`;
    return `
      <div class="donut-wrap">
        <svg viewBox="0 0 160 160" class="donut" role="img" aria-label="${esc(segments.map((s) => `${s.label}: ${s.value}`).join(', '))}">
          ${arcs}
          <text x="80" y="78" text-anchor="middle" class="donut-num">${total}</text>
          <text x="80" y="100" text-anchor="middle" class="donut-lbl">${esc(centerLabel)}</text>
        </svg>
        <ul class="legend">${segments.map((s) => `<li><span class="swatch" style="background:${s.color}" aria-hidden="true"></span>${esc(s.label)} <strong>${s.value}</strong></li>`).join('')}</ul>
      </div>`;
  }

  function renderStats() {
    const all = state.tickets;
    const done = all.filter((t) => isDone(t) && t.resolvedAt);
    const resDays = (t) => (new Date(t.resolvedAt) - new Date(t.createdAt)) / DAY;
    const avg = (arr) => (arr.length ? arr.reduce((s, x) => s + x, 0) / arr.length : 0);
    const avgAll = avg(done.map(resDays));

    const byStatus = STATUSES.map((s) => ({ label: s.label, value: all.filter((t) => t.status === s.id).length, color: s.color }));
    const byCat = state.settings.categories.map((c) => ({ label: c.name, value: all.filter((t) => t.categoryId === c.id).length }))
      .filter((r) => r.value).sort((a, b) => b.value - a.value);
    const byPriority = PRIORITIES.map((p) => ({ label: p.label, value: all.filter((t) => t.priority === p.id).length, color: p.color }));
    const byResp = state.members.map((m) => ({ label: m.name, value: all.filter((t) => isOpen(t) && t.responsibleId === m.id).length }))
      .filter((r) => r.value).sort((a, b) => b.value - a.value);
    const avgByCat = state.settings.categories.map((c) => {
      const arr = done.filter((t) => t.categoryId === c.id).map(resDays);
      return { label: c.name, value: Math.round(avg(arr) * 10) / 10, n: arr.length };
    }).filter((r) => r.n).sort((a, b) => b.value - a.value);

    const months = [];
    const n = new Date();
    for (let i = 11; i >= 0; i--) {
      const d = new Date(n.getFullYear(), n.getMonth() - i, 1);
      const count = all.filter((t) => { const c = new Date(t.createdAt); return c.getFullYear() === d.getFullYear() && c.getMonth() === d.getMonth(); }).length;
      months.push({ label: dfMonthShort.format(d), year: String(d.getFullYear()).slice(2), value: count });
    }
    const maxMonth = Math.max(1, ...months.map((m) => m.value));

    setView(`
      <div class="page-head">
        <div><h1>סטטיסטיקה</h1><p class="muted">תמונת מצב של כל התקלות שנרשמו בבניין.</p></div>
      </div>
      <section class="kpi-row" aria-label="מדדים מרכזיים">
        <div class="kpi"><span class="kpi-value">${all.length}</span><span class="kpi-label">סך כל הקריאות</span></div>
        <div class="kpi"><span class="kpi-value">${all.filter(isOpen).length}</span><span class="kpi-label">פתוחות כעת</span></div>
        <div class="kpi"><span class="kpi-value">${done.length}</span><span class="kpi-label">טופלו / נסגרו</span></div>
        <div class="kpi kpi-accent"><span class="kpi-value">${done.length ? nfNum.format(avgAll) : '—'}</span><span class="kpi-label">ממוצע ימים עד פתרון</span></div>
      </section>
      <div class="stats-grid">
        <section class="card" aria-labelledby="st1"><h2 id="st1">קריאות לפי סטטוס</h2>${donutChart(byStatus, 'קריאות')}</section>
        <section class="card" aria-labelledby="st2"><h2 id="st2">קריאות לפי קטגוריה</h2>${barChart(byCat)}</section>
        <section class="card span-all" aria-labelledby="st3">
          <h2 id="st3">קריאות שנפתחו בכל חודש</h2>
          <div class="col-chart" role="img" aria-label="${esc(months.map((m) => `${m.label} ${m.year}: ${m.value}`).join(', '))}">
            ${months.map((m) => `<div class="col">
              <div class="col-plot">
                <span class="col-value">${m.value || ''}</span>
                <span class="col-bar" style="height:${(m.value / maxMonth) * 85}%"></span>
              </div>
              <span class="col-label">${esc(m.label)}<br><small>${m.year}</small></span>
            </div>`).join('')}
          </div>
        </section>
        <section class="card" aria-labelledby="st4"><h2 id="st4">ממוצע ימים עד פתרון לפי קטגוריה</h2>${barChart(avgByCat, { color: 'var(--success)', suffix: ' ימים' })}</section>
        <section class="card" aria-labelledby="st5"><h2 id="st5">קריאות לפי עדיפות</h2>${barChart(byPriority)}</section>
        <section class="card" aria-labelledby="st6"><h2 id="st6">קריאות פתוחות לפי אחראי/ת</h2>${barChart(byResp, { color: '#7c3aed' })}</section>
      </div>`);
  }

  /* ======================================================================
   * Settings: building, members, profile, lists, vendors, data
   * ==================================================================== */

  const LIST_DEFS = {
    categories: { kind: 'category', title: 'קטגוריות תקלה', single: 'קטגוריה', label: 'שם הקטגוריה' },
    floors: { kind: 'floor', title: 'קומות', single: 'קומה', label: 'שם הקומה' },
    areas: { kind: 'area', title: 'אזורים בבניין', single: 'אזור', label: 'שם האזור' },
  };
  const VENDOR_FIELDS = [
    { key: 'company', label: 'חברה', required: true, max: 100 }, { key: 'contact', label: 'איש קשר', max: 80 },
    { key: 'phone', label: 'טלפון', type: 'tel', max: 20 }, { key: 'specialty', label: 'תחום התמחות', max: 80 },
  ];

  function inputField(id, name, label, value, { required = false, type, max = 80 } = {}) {
    return `<div class="field">
      <label for="${id}">${esc(label)}${required ? ' <span class="req" aria-hidden="true">*</span>' : ''}</label>
      <input id="${id}" name="${name}" value="${esc(value || '')}" maxlength="${max}" ${type === 'tel' ? 'type="tel" dir="ltr" inputmode="tel"' : ''} ${type === 'email' ? 'type="email" dir="ltr"' : ''} ${required ? 'required' : ''}>
    </div>`;
  }

  function optionListCard(key) {
    const def = LIST_DEFS[key];
    const items = state.settings[key];
    return `
      <section class="card settings-card" aria-labelledby="h-${key}">
        <div class="card-head"><h2 id="h-${key}" tabindex="-1">${def.title}</h2><span class="count">${items.length}</span></div>
        <ul class="option-list">
          ${items.map((it) => `<li>
            <span class="option-name">${esc(key === 'floors' ? bidiFix(it.name) : it.name)}</span>
            ${it.used ? `<span class="muted option-used">${it.used} קריאות</span>` : ''}
            <span class="row-actions">
              <button type="button" class="icon-btn" data-action="edit-option" data-list="${key}" data-id="${it.id}" aria-label="${esc('עריכת ' + it.name)}">✎</button>
              <button type="button" class="icon-btn icon-danger" data-action="delete-option" data-list="${key}" data-id="${it.id}" aria-label="${esc('מחיקת ' + it.name)}">🗑</button>
            </span></li>`).join('') || '<li class="muted">הרשימה ריקה.</li>'}
        </ul>
        <form class="add-item-form" data-add-option="${key}" novalidate>
          ${inputField(`add-${key}`, 'name', def.label, '', { required: true, max: 50 })}
          <button type="submit" class="btn btn-primary">הוספת ${def.single}</button>
        </form>
      </section>`;
  }

  function vendorsCard() {
    const items = state.settings.vendors;
    return `
      <section class="card settings-card span-all" aria-labelledby="h-vendors">
        <div class="card-head"><h2 id="h-vendors" tabindex="-1">ספר ספקים ובעלי מקצוע</h2><span class="count">${items.length}</span></div>
        <p class="muted">בחירת ספק בטופס הקריאה ממלאת את פרטיו אוטומטית.</p>
        <div class="table-wrap">
          <table class="simple-table">
            <thead><tr>${VENDOR_FIELDS.map((f) => `<th scope="col">${f.label}</th>`).join('')}<th scope="col"><span class="visually-hidden">פעולות</span></th></tr></thead>
            <tbody>
              ${items.length ? items.map((v) => `<tr>
                ${VENDOR_FIELDS.map((f) => `<td data-label="${f.label}">${f.type === 'tel' ? telLink(v[f.key]) : esc(v[f.key] || '—')}</td>`).join('')}
                <td class="row-actions">
                  <button type="button" class="icon-btn" data-action="edit-vendor" data-id="${v.id}" aria-label="${esc('עריכת ' + v.company)}">✎</button>
                  <button type="button" class="icon-btn icon-danger" data-action="delete-vendor" data-id="${v.id}" aria-label="${esc('מחיקת ' + v.company)}">🗑</button>
                </td></tr>`).join('') : `<tr><td colspan="${VENDOR_FIELDS.length + 1}" class="muted">אין עדיין ספקים.</td></tr>`}
            </tbody>
          </table>
        </div>
        <form class="add-item-form" id="add-vendor" novalidate>
          ${VENDOR_FIELDS.map((f) => inputField(`add-v-${f.key}`, f.key, f.label, '', f)).join('')}
          <button type="submit" class="btn btn-primary">הוספת ספק</button>
        </form>
      </section>`;
  }

  function renderSettings() {
    if (!state.building) {
      // No building yet: profile + create building only
      setView(`<div class="page-head"><div><h1>הגדרות</h1></div></div>
        <div class="settings-grid">${profileCard()}</div>`);
      bindSettingsHandlers();
      return;
    }
    const b = state.building;
    const owner = isOwner();
    setView(`
      <div class="page-head">
        <div><h1>הגדרות</h1><p class="muted">ניהול הבניין, חברי הוועד, הרשימות והנתונים.</p></div>
      </div>
      <div class="settings-grid">
        <section class="card settings-card" aria-labelledby="h-building">
          <div class="card-head"><h2 id="h-building">הבניין</h2>${owner ? '<span class="badge badge-neutral">מנהל/ת</span>' : ''}</div>
          ${owner ? `
            <form id="building-form" class="stack-form" novalidate>
              ${buildingFormHtml('bf', b)}
              <button type="submit" class="btn btn-primary">שמירת פרטי הבניין</button>
            </form>` : `<p><strong>${esc(b.name)}</strong>${b.address ? '<br>' + esc(b.address) : ''}</p>
            <p class="muted">רק מנהל/ת הבניין יכול/ה לשנות את פרטיו.</p>`}
          <hr>
          <details class="new-building">
            <summary>ניהול בניין נוסף</summary>
            <form id="new-building-form" class="stack-form" novalidate>
              ${buildingFormHtml('nb')}
              <button type="submit" class="btn btn-secondary">יצירת בניין נוסף</button>
            </form>
          </details>
        </section>

        <section class="card settings-card" aria-labelledby="h-members">
          <div class="card-head"><h2 id="h-members" tabindex="-1">חברי הוועד</h2><span class="count">${state.members.length}</span></div>
          <p class="muted">חברי הוועד רואים ועורכים את כל הקריאות של הבניין, ונבחרים כאחראים לקריאות.</p>
          <ul class="member-list">
            ${state.members.map((m) => `<li>
              <span class="member-avatar" aria-hidden="true">${esc(m.name.trim().charAt(0))}</span>
              <span class="member-info"><strong>${esc(m.name)}</strong>${m.role === 'owner' ? ' <span class="badge badge-neutral">מנהל/ת</span>' : ''}
                <small dir="ltr">${esc(m.email)}</small>${m.phone ? telLink(m.phone) : ''}</span>
              ${m.role !== 'owner' && (owner || m.id === state.user.id)
                ? `<button type="button" class="btn btn-danger-outline btn-sm" data-action="remove-member" data-id="${m.id}">${m.id === state.user.id ? 'עזיבת הבניין' : 'הסרה'}</button>` : ''}
            </li>`).join('')}
          </ul>
          ${owner ? `
            <form id="add-member-form" class="add-item-form" novalidate>
              ${inputField('am-email', 'email', 'הוספת חבר/ת ועד לפי אימייל', '', { required: true, type: 'email', max: 254 })}
              <button type="submit" class="btn btn-primary">הוספה</button>
            </form>
            <p class="muted small">החבר/ה צריך/ה להירשם למערכת קודם, עם אותה כתובת אימייל.</p>` : ''}
        </section>

        ${profileCard()}

        ${vendorsCard()}
        ${optionListCard('categories')}
        ${optionListCard('floors')}
        ${optionListCard('areas')}

        <section class="card settings-card span-all" aria-labelledby="h-data">
          <div class="card-head"><h2 id="h-data">גיבוי ונתונים</h2></div>
          <p class="muted">הנתונים נשמרים בשרת ומשותפים לכל חברי הוועד. בבניין ${state.tickets.length} קריאות.</p>
          <div class="data-actions">
            <div>
              <h3>גיבוי מלא</h3>
              <p class="muted">קובץ JSON עם כל הקריאות, הרשימות, הספקים והקבצים המצורפים (בקידוד base64).</p>
              <button type="button" class="btn btn-primary" data-action="backup">⬇ הורדת קובץ גיבוי</button>
            </div>
            ${owner ? `
            <div>
              <h3>שחזור מגיבוי</h3>
              <p class="muted">מחליף את כל הקריאות, הרשימות והספקים של הבניין בנתוני הקובץ.</p>
              <label class="btn btn-secondary file-btn">⬆ בחירת קובץ גיבוי
                <input type="file" accept=".json,application/json" id="restore-file" class="visually-hidden">
              </label>
            </div>
            <div>
              <h3>נתוני הדגמה</h3>
              <p class="muted">טעינת 10 קריאות ו-5 חוזי שירות לדוגמה במקום הקיימים.</p>
              <button type="button" class="btn btn-secondary" data-action="restore-demo">טעינת נתוני הדגמה</button>
            </div>
            <div>
              <h3>התחלה מאפס</h3>
              <p class="muted">מחיקת כל הקריאות, חוזי השירות והקבצים של הבניין. הרשימות והספקים נשמרים.</p>
              <button type="button" class="btn btn-danger" data-action="wipe">🗑 מחיקת כל הנתונים</button>
            </div>
            <div>
              <h3>מחיקת הבניין</h3>
              <p class="muted">מחיקת הבניין עם כל הנתונים שלו, לכל חברי הוועד.</p>
              <button type="button" class="btn btn-danger-outline" data-action="delete-building">מחיקת הבניין</button>
            </div>` : '<div><p class="muted">שחזור, טעינת נתוני הדגמה ומחיקה זמינים למנהל/ת הבניין בלבד.</p></div>'}
          </div>
        </section>
      </div>`);
    bindSettingsHandlers();
  }

  function profileCard() {
    return `
      <section class="card settings-card" aria-labelledby="h-profile">
        <div class="card-head"><h2 id="h-profile">הפרופיל שלי</h2></div>
        <form id="profile-form" class="stack-form" novalidate>
          ${inputField('pf-name', 'name', 'שם מלא', state.user.name, { required: true, max: 60 })}
          ${inputField('pf-phone', 'phone', 'טלפון', state.user.phone, { type: 'tel', max: 20 })}
          <p class="muted small">אימייל: <span dir="ltr">${esc(state.user.email)}</span></p>
          <button type="submit" class="btn btn-primary">שמירת הפרופיל</button>
        </form>
      </section>`;
  }

  async function refreshSettingsView(focusSel) {
    const [settings, me] = await Promise.all([api('GET', '/api/settings'), api('GET', '/api/auth/me')]);
    state.settings = settings;
    Object.assign(state, { user: me.user, building: me.building, buildings: me.buildings, members: me.members });
    renderHeader();
    rerender();
    const el = focusSel && $(focusSel);
    if (el) el.focus({ preventScroll: true });
  }

  function bindSettingsHandlers() {
    appEl.onsubmit = async (e) => {
      e.preventDefault();
      const form = e.target;
      const fd = new FormData(form);
      if (form.id === 'profile-form') {
        await attempt(async () => {
          const { user } = await api('PUT', '/api/profile', { name: fd.get('name'), phone: fd.get('phone') });
          state.user = user;
          if (state.building) state.members = (await api('GET', '/api/building/members')).members;
          renderHeader();
          toast('הפרופיל נשמר.', 'success');
        });
        return;
      }
      if (form.id === 'building-form') {
        await attempt(async () => {
          const { building } = await api('PUT', '/api/building', { name: fd.get('name'), address: fd.get('address') });
          state.building = building;
          await refreshSettingsView('#h-building');
          toast('פרטי הבניין נשמרו.', 'success');
        });
        return;
      }
      if (form.id === 'new-building-form') {
        if (!String(fd.get('name') || '').trim()) { toast('יש להזין שם לבניין.', 'error'); return; }
        await createBuilding(form);
        return;
      }
      if (form.id === 'add-member-form') {
        await attempt(async () => {
          const { member: m } = await api('POST', '/api/building/members', { email: fd.get('email') });
          toast(`${m.name} נוסף/ה לוועד.`, 'success');
          await refreshSettingsView('#am-email');
        });
        return;
      }
      if (form.id === 'add-vendor') {
        const body = Object.fromEntries(VENDOR_FIELDS.map((f) => [f.key, String(fd.get(f.key) || '').trim()]));
        if (!body.company) { toast('יש להזין שם חברה.', 'error'); form.elements.company.focus(); return; }
        await attempt(async () => {
          await api('POST', '/api/vendors', body);
          toast(`"${body.company}" נוסף לספר הספקים.`, 'success');
          await refreshSettingsView('#add-v-company');
        });
        return;
      }
      const key = form.dataset.addOption;
      if (key) {
        const name = String(fd.get('name') || '').trim();
        if (!name) { toast('יש להזין שם.', 'error'); form.elements.name.focus(); return; }
        await attempt(async () => {
          await api('POST', '/api/options', { kind: LIST_DEFS[key].kind, name });
          toast(`"${name}" נוסף.`, 'success');
          await refreshSettingsView(`#add-${key}`);
        });
      }
    };

    appEl.onchange = (e) => { if (e.target.id === 'restore-file') restoreBackup(e.target.files[0]); };

    appEl.onclick = async (e) => {
      const act = e.target.closest('[data-action]');
      if (!act) return;
      const a = act.dataset.action;
      if (a === 'backup') exportBackup();
      if (a === 'restore-demo') restoreDemo();
      if (a === 'wipe') wipeAllData();
      if (a === 'delete-building') deleteBuilding();
      if (a === 'remove-member') {
        const m = member(Number(act.dataset.id));
        if (!m) return;
        const self = m.id === state.user.id;
        const ok = await confirmDialog(self
          ? `לעזוב את הבניין "${state.building.name}"? לא תהיה לך יותר גישה לקריאות שלו.`
          : `להסיר את ${m.name} מוועד הבניין? הקריאות שבאחריותו/ה יישארו ללא אחראי.`, { okLabel: self ? 'עזיבה' : 'הסרה', danger: true });
        if (!ok) return;
        await attempt(async () => {
          await api('DELETE', `/api/building/members/${m.id}`);
          if (self) {
            try { sessionStorage.removeItem(BUILDING_KEY); } catch (err) { /* ignore */ }
            location.replace('/dashboard');
            return;
          }
          toast(`${m.name} הוסר/ה מהוועד.`, 'success');
          await loadData();
          await refreshSettingsView('#h-members');
        });
      }
      if (a === 'edit-option') {
        const key = act.dataset.list;
        const item = byId(state.settings[key], Number(act.dataset.id));
        if (!item) return;
        openModal({
          title: `עריכת ${LIST_DEFS[key].single}`,
          body: `<form id="edit-form" class="stack-form" novalidate>${inputField('edit-name', 'name', LIST_DEFS[key].label, item.name, { required: true, max: 50 })}</form>`,
          actions: [
            {
              label: 'שמירה', className: 'btn-primary', onClick: async (modal) => {
                const name = $('#edit-name', modal).value.trim();
                if (!name) { toast('יש להזין שם.', 'error'); return false; }
                const ok = await attempt(async () => { await api('PUT', `/api/options/${item.id}`, { name }); return true; });
                if (!ok) return false;
                toast('השינויים נשמרו.', 'success');
                setTimeout(() => attempt(() => refreshSettingsView(`#h-${key}`)), 0);
                return true;
              },
            },
            { label: 'ביטול' },
          ],
        });
        submitOnEnter('#edit-form');
      }
      if (a === 'delete-option') {
        const key = act.dataset.list;
        const item = byId(state.settings[key], Number(act.dataset.id));
        if (!item) return;
        if (item.used) { toast(`לא ניתן למחוק את "${item.name}" – בשימוש ב-${item.used} קריאות.`, 'error'); return; }
        const ok = await confirmDialog(`למחוק את "${item.name}" מהרשימה?`, { okLabel: 'מחיקה', danger: true });
        if (!ok) return;
        await attempt(async () => {
          await api('DELETE', `/api/options/${item.id}`);
          toast('הפריט נמחק.', 'success');
          await refreshSettingsView(`#h-${key}`);
        });
      }
      if (a === 'edit-vendor') {
        const v = byId(state.settings.vendors, Number(act.dataset.id));
        if (!v) return;
        openModal({
          title: 'עריכת ספק',
          body: `<form id="edit-form" class="stack-form" novalidate>${VENDOR_FIELDS.map((f) => inputField(`ev-${f.key}`, f.key, f.label, v[f.key], f)).join('')}</form>`,
          actions: [
            {
              label: 'שמירה', className: 'btn-primary', onClick: async (modal) => {
                const form = $('#edit-form', modal);
                const body = Object.fromEntries(VENDOR_FIELDS.map((f) => [f.key, form.elements[f.key].value.trim()]));
                if (!body.company) { toast('יש להזין שם חברה.', 'error'); return false; }
                const ok = await attempt(async () => { await api('PUT', `/api/vendors/${v.id}`, body); return true; });
                if (!ok) return false;
                toast('השינויים נשמרו.', 'success');
                setTimeout(() => attempt(() => refreshSettingsView('#h-vendors')), 0);
                return true;
              },
            },
            { label: 'ביטול' },
          ],
        });
        submitOnEnter('#edit-form');
      }
      if (a === 'delete-vendor') {
        const v = byId(state.settings.vendors, Number(act.dataset.id));
        if (!v) return;
        const ok = await confirmDialog(`למחוק את "${v.company}" מספר הספקים?\nקריאות קיימות ישמרו את פרטי הספק שהוזנו בהן.`, { okLabel: 'מחיקה', danger: true });
        if (!ok) return;
        await attempt(async () => {
          await api('DELETE', `/api/vendors/${v.id}`);
          toast('הספק נמחק.', 'success');
          await refreshSettingsView('#h-vendors');
        });
      }
    };
  }

  /** Pressing Enter inside a modal form clicks its first (primary) action. */
  function submitOnEnter(sel) {
    const form = $(sel);
    if (form) form.addEventListener('submit', (e) => { e.preventDefault(); const b = $('.modal-foot [data-act="0"]'); if (b) b.click(); });
  }

  /* ======================================================================
   * Service contracts – list, detail, form, renewal reminders
   *   A contract's end date is its renewal date. The reminder starts one
   *   calendar month before it and shows on the dashboard, in the nav badge,
   *   on the contracts page and in the calendar, until it is marked as
   *   handled or the contract is renewed (which re-arms it for the next term).
   * ==================================================================== */

  const FREQUENCIES = [
    { id: 'monthly', label: 'חודשי', perYear: 12 }, { id: 'quarterly', label: 'רבעוני', perYear: 4 },
    { id: 'semiannual', label: 'חצי שנתי', perYear: 2 }, { id: 'yearly', label: 'שנתי', perYear: 1 },
    { id: 'one_time', label: 'חד פעמי', perYear: 0 },
  ];
  const freqOf = (id) => FREQUENCIES.find((f) => f.id === id) || FREQUENCIES[3];
  const nfMoney = new Intl.NumberFormat('he-IL', { style: 'currency', currency: 'ILS', maximumFractionDigits: 0 });
  const fmtMoney = (v) => (v == null || v === '' ? '—' : nfMoney.format(v));
  const findContract = (id) => state.contracts.find((c) => c.id === Number(id));
  const safeFileName = (s) => String(s).replace(/[\\/:*?"<>|]+/g, '-').slice(0, 60);

  /** Same day N calendar months later / earlier, clamped to the month's end (31/03 − 1 month = 28/02). */
  function addMonths(dateStr, n) {
    const [y, m, d] = dateStr.split('-').map(Number);
    const target = new Date(y, m - 1 + n, 1);
    const daysInMonth = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
    target.setDate(Math.min(d, daysInMonth));
    return toDateInput(target);
  }
  const reminderDate = (c) => addMonths(c.endDate, -1);
  const daysToEnd = (c) => daysBetween(new Date(), parseDate(c.endDate));

  /** 'expired' | 'due' (in the month before renewal) | 'handled' (due, reminder marked handled) | 'active' */
  function contractState(c) {
    const today = toDateInput(new Date());
    if (c.endDate < today) return 'expired';
    if (today >= reminderDate(c)) return c.reminderHandled ? 'handled' : 'due';
    return 'active';
  }
  const needsAttention = (c) => { const s = contractState(c); return s === 'due' || (s === 'expired' && !c.reminderHandled); };
  const annualCost = (c) => (c.cost ? c.cost * freqOf(c.paymentFrequency).perYear : 0);

  function contractBadge(c) {
    const [cls, label] = {
      expired: ['due-overdue', '⛔ פג תוקף'], due: ['due-upcoming', '🔔 לחידוש בקרוב'],
      handled: ['badge-handled', '✔ התזכורת טופלה'], active: ['st-resolved', 'בתוקף'],
    }[contractState(c)];
    return `<span class="badge ${cls}">${label}</span>`;
  }

  function endText(c) {
    const d = daysToEnd(c);
    if (d < 0) return d === -1 ? 'פג אתמול' : `פג לפני ${-d} ימים`;
    if (d === 0) return 'מסתיים היום';
    if (d === 1) return 'מסתיים מחר';
    return `בעוד ${d} ימים`;
  }

  function updateContractsBadge() {
    const el = $('#contracts-badge');
    if (!el) return;
    const n = state.contracts.filter(needsAttention).length;
    el.innerHTML = n ? `${n}<span class="visually-hidden"> חוזים דורשים טיפול</span>` : '';
    el.hidden = !n;
  }

  function contractsBannerHtml() {
    const list = state.contracts.filter(needsAttention).sort((a, b) => a.endDate.localeCompare(b.endDate));
    if (!list.length) return '';
    return `
      <div class="alert alert-warning contracts-banner" role="status">
        <p><strong>🔔 תזכורת חידוש חוזים:</strong> ${list.length === 1 ? 'חוזה שירות אחד דורש' : list.length + ' חוזי שירות דורשים'} טיפול לקראת חידוש.</p>
        <ul>${list.slice(0, 5).map((c) => `<li><a href="/contracts/${c.id}">${esc(c.title)}</a> – ${esc(c.company)} · ${fmtDate(c.endDate)} (${endText(c)}) ${contractBadge(c)}</li>`).join('')}</ul>
        <a href="/contracts" class="btn btn-secondary btn-sm">לכל חוזי השירות</a>
      </div>`;
  }

  /* ---------- Calendar file (.ics) with the reminder and the renewal date ---------- */

  const icsEscape = (s) => String(s ?? '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');

  /** RFC 5545 line folding (max 75 octets per line, UTF-8 aware). */
  function icsFold(line) {
    const enc = new TextEncoder();
    const out = [];
    let cur = '';
    let bytes = 0;
    for (const ch of line) {
      const b = enc.encode(ch).length;
      if (bytes + b > 74) { out.push(cur); cur = ' ' + ch; bytes = 1 + b; } else { cur += ch; bytes += b; }
    }
    out.push(cur);
    return out.join('\r\n');
  }

  function contractIcsEvents(c) {
    const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');
    const ymd = (s) => s.replace(/-/g, '');
    const nextDay = (s) => { const d = parseDate(s); d.setDate(d.getDate() + 1); return ymd(toDateInput(d)); };
    const url = `${location.origin}/contracts/${c.id}`;
    const desc = [
      `ספק: ${c.company}`, c.contactName || c.contactPhone ? `איש קשר: ${c.contactName} ${c.contactPhone}`.trim() : '',
      c.contractNumber ? `מספר חוזה: ${c.contractNumber}` : '', `תאריך סיום / חידוש: ${fmtDate(c.endDate)}`,
      c.autoRenew ? `מתחדש אוטומטית לתקופה של ${c.renewalMonths} חודשים` : 'אינו מתחדש אוטומטית', url,
    ].filter(Boolean).join('\n');
    const ev = (kind, date, summary, trigger) => [
      'BEGIN:VEVENT', `UID:contract-${c.id}-${kind}-${ymd(c.endDate)}@house-committee-faults`, `DTSTAMP:${stamp}`,
      `DTSTART;VALUE=DATE:${ymd(date)}`, `DTEND;VALUE=DATE:${nextDay(date)}`,
      `SUMMARY:${icsEscape(summary)}`, `DESCRIPTION:${icsEscape(desc)}`, `URL:${url}`, 'TRANSP:TRANSPARENT',
      'BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${icsEscape(summary)}`, `TRIGGER:${trigger}`, 'END:VALARM', 'END:VEVENT',
    ];
    return [
      // Alarm at 09:00 on the reminder day (a month before), and a week before the renewal date itself.
      ...ev('reminder', reminderDate(c), `🔔 תזכורת: חוזה "${c.title}" מתחדש בעוד חודש`, 'PT9H'),
      ...ev('renewal', c.endDate, `📄 סיום / חידוש חוזה: ${c.title} (${c.company})`, '-P7D'),
    ];
  }

  function downloadIcs(list, filename) {
    if (!list.length) { toast('אין חוזים לייצוא.', 'error'); return; }
    const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//House Committee Faults//HE', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
      `X-WR-CALNAME:${icsEscape('חוזי שירות – ' + state.building.name)}`, ...list.flatMap(contractIcsEvents), 'END:VCALENDAR'];
    downloadBlob(new Blob([lines.map(icsFold).join('\r\n') + '\r\n'], { type: 'text/calendar;charset=utf-8' }), filename);
    toast('קובץ היומן הורד – פתחו אותו כדי להוסיף את התזכורות ליומן (Google, Outlook או הטלפון).', 'success');
  }

  function exportContractsCsv(list) {
    if (!list.length) { toast('אין חוזים לייצוא.', 'error'); return; }
    const headers = ['שם השירות', 'קטגוריה', 'חברה / ספק', 'איש קשר', 'טלפון', 'אימייל', 'מספר חוזה', 'תאריך תחילה', 'תאריך סיום / חידוש',
      'תאריך תזכורת', 'מצב', 'חידוש אוטומטי', 'תקופת חידוש (חודשים)', 'עלות', 'תדירות תשלום', 'עלות שנתית משוערת', 'אחראי', 'פירוט השירות', 'הערות'];
    const stateLabel = { expired: 'פג תוקף', due: 'לחידוש בקרוב', handled: 'התזכורת טופלה', active: 'בתוקף' };
    const rows = list.map((c) => [c.title, c.categoryId ? catName(c.categoryId) : '', c.company, c.contactName, c.contactPhone, c.contactEmail,
      c.contractNumber, c.startDate ? fmtDate(c.startDate) : '', fmtDate(c.endDate), fmtDate(reminderDate(c)), stateLabel[contractState(c)],
      c.autoRenew ? 'כן' : 'לא', c.renewalMonths, c.cost ?? '', freqOf(c.paymentFrequency).label, annualCost(c) || '',
      c.responsibleId ? (c.responsibleName || memberName(c.responsibleId)) : '', c.scope, c.notes]);
    const cell = (v) => { const s = String(v ?? '').replace(/\r?\n/g, ' '); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
    downloadBlob(new Blob(['\uFEFF' + [headers, ...rows].map((r) => r.map(cell).join(',')).join('\r\n')], { type: 'text/csv;charset=utf-8' }),
      `חוזי-שירות-${toDateInput(new Date())}.csv`);
    toast(`יוצאו ${list.length} חוזים לקובץ CSV.`, 'success');
  }

  /* ---------- Actions shared by the list and the detail page ---------- */

  function renewContract(c) {
    const suggested = addMonths(c.endDate, c.renewalMonths || 12);
    openModal({
      title: `חידוש החוזה: ${c.title}`,
      body: `
        <form id="renew-form" class="stack-form" novalidate>
          <p class="muted">תאריך הסיום הנוכחי: <strong>${fmtDate(c.endDate)}</strong>. אחרי החידוש הוא יהפוך לתאריך התחילה, והתזכורת תופעל מחדש חודש לפני הסיום החדש.</p>
          <div class="field"><label for="rn-end">תאריך סיום / חידוש חדש <span class="req" aria-hidden="true">*</span></label>
            <input id="rn-end" name="endDate" type="date" required value="${suggested}" min="${addMonths(c.endDate, 0)}"></div>
          <div class="field"><label for="rn-cost">עלות (₪, ${esc(freqOf(c.paymentFrequency).label)})</label>
            <input id="rn-cost" name="cost" type="number" min="0" step="1" inputmode="decimal" value="${c.cost ?? ''}"></div>
        </form>`,
      actions: [
        {
          label: 'חידוש החוזה', className: 'btn-primary', onClick: async (modal) => {
            const f = $('#renew-form', modal);
            const endDate = f.elements.endDate.value;
            if (!endDate || endDate <= c.endDate) { toast('תאריך הסיום החדש חייב להיות אחרי הנוכחי.', 'error'); f.elements.endDate.focus(); return false; }
            const costVal = f.elements.cost.value;
            const ok = await attempt(async () => {
              const { contract } = await api('POST', `/api/contracts/${c.id}/renew`, { endDate, cost: costVal === '' ? null : Number(costVal) });
              replaceContract(contract);
              toast(`החוזה חודש עד ${fmtDate(contract.endDate)}.`, 'success');
              return true;
            });
            if (!ok) return false;
            setTimeout(rerender, 0);
            return true;
          },
        },
        { label: 'ביטול' },
      ],
      initialFocus: '#rn-end',
    });
    submitOnEnter('#renew-form');
  }

  async function handleContractAction(action, c) {
    if (action === 'renew') { renewContract(c); return true; }
    if (action === 'ics') { downloadIcs([c], `תזכורת-חוזה-${safeFileName(c.title)}.ics`); return true; }
    if (action === 'ack' || action === 'unack') {
      await attempt(async () => {
        const { contract } = await api('POST', `/api/contracts/${c.id}/reminder`, { handled: action === 'ack' });
        replaceContract(contract);
        toast(action === 'ack' ? 'התזכורת סומנה כטופלה. היא תופעל שוב בחידוש הבא.' : 'התזכורת הופעלה מחדש.', 'success');
        rerender();
      });
      return true;
    }
    if (action === 'delete-contract') {
      const ok = await confirmDialog(`למחוק לצמיתות את החוזה "${c.title}" (${c.company}) עם המסמכים המצורפים אליו?`, { title: 'מחיקת חוזה', okLabel: 'מחיקת החוזה', danger: true });
      if (!ok) return true;
      await attempt(async () => {
        await api('DELETE', `/api/contracts/${c.id}`);
        state.contracts = state.contracts.filter((x) => x.id !== c.id);
        updateContractsBadge();
        toast('החוזה נמחק.', 'success');
        navigate('/contracts');
      });
      return true;
    }
    return false;
  }

  /* ---------- List ---------- */

  let contractFilter = { q: '', status: 'all' };

  function renderContracts() {
    const all = state.contracts;
    const valid = all.filter((c) => contractState(c) !== 'expired');
    const attention = all.filter(needsAttention).sort((a, b) => a.endDate.localeCompare(b.endDate));
    const yearly = valid.reduce((s, c) => s + annualCost(c), 0);
    const card = (key, cls, value, label, icon) => `
      <button type="button" class="summary-card ${cls}" data-cfilter="${key}" aria-label="${esc(label)}: ${value}. לחיצה לסינון">
        <span class="sc-icon" aria-hidden="true">${icon}</span><span class="sc-value">${value}</span><span class="sc-label">${label}</span>
      </button>`;

    setView(`
      <div class="page-head">
        <div>
          <h1>חוזי שירות</h1>
          <p class="muted">כל חוזי השירות של הבניין. תזכורת מופיעה חודש לפני תאריך החידוש של כל חוזה.</p>
        </div>
        <div class="btn-row">
          <button type="button" class="btn btn-secondary" data-action="ics-all" title="קובץ יומן עם תזכורת חודש לפני כל חידוש">📅 כל התזכורות ליומן</button>
          <a class="btn btn-primary" href="/contracts/new"><span aria-hidden="true">＋</span> חוזה חדש</a>
        </div>
      </div>

      ${attention.length ? `
        <section class="card reminders-card" aria-labelledby="rem-h">
          <h2 id="rem-h">🔔 תזכורות לחידוש <span class="count">${attention.length}</span></h2>
          <ul class="reminder-list">${attention.map((c) => `
            <li class="reminder-${contractState(c)}">
              <div class="reminder-main">
                <a href="/contracts/${c.id}"><strong>${esc(c.title)}</strong></a> <span class="muted">· ${esc(c.company)}</span>
                <div class="reminder-meta">תאריך חידוש: <strong>${fmtDate(c.endDate)}</strong> (${endText(c)}) ${contractBadge(c)}
                  ${c.autoRenew ? '<span class="badge badge-neutral">מתחדש אוטומטית</span>' : ''}</div>
              </div>
              <div class="btn-row">
                <button type="button" class="btn btn-primary btn-sm" data-action="renew" data-id="${c.id}">חידוש</button>
                <button type="button" class="btn btn-secondary btn-sm" data-action="ack" data-id="${c.id}">✔ סימון כטופל</button>
                <button type="button" class="btn btn-ghost btn-sm" data-action="ics" data-id="${c.id}">📅 ליומן</button>
              </div>
            </li>`).join('')}</ul>
        </section>` : ''}

      <section class="summary-grid summary-grid-4" aria-label="סיכום חוזי השירות">
        ${card('active', 'sc-resolved', valid.length, 'חוזים בתוקף', '📄')}
        ${card('due', 'sc-urgent', all.filter((c) => ['due', 'handled'].includes(contractState(c))).length, 'מתחדשים בחודש הקרוב', '🔔')}
        ${card('expired', 'sc-overdue', all.length - valid.length, 'פגי תוקף', '⛔')}
        <div class="summary-card sc-open"><span class="sc-icon" aria-hidden="true">₪</span><span class="sc-value">${esc(fmtMoney(yearly))}</span><span class="sc-label">עלות שנתית משוערת (חוזים בתוקף)</span></div>
      </section>

      <section class="card" aria-labelledby="cl-h">
        <div class="card-head"><h2 id="cl-h">רשימת החוזים</h2></div>
        <form class="filters filters-compact" id="contract-filters" role="search" aria-label="סינון חוזים">
          <div class="field field-grow">
            <label for="cf-q">חיפוש</label>
            <input type="search" id="cf-q" name="q" value="${esc(contractFilter.q)}" placeholder="שם שירות, ספק, מספר חוזה…" autocomplete="off">
          </div>
          <div class="field">
            <label for="cf-status">מצב</label>
            <select id="cf-status" name="status">
              ${[['all', 'הכל'], ['active', 'בתוקף'], ['due', 'מתחדשים בחודש הקרוב'], ['expired', 'פגי תוקף']].map(([v, l]) =>
                `<option value="${v}" ${contractFilter.status === v ? 'selected' : ''}>${l}</option>`).join('')}
            </select>
          </div>
        </form>
        <div class="list-toolbar">
          <p id="contract-count" class="muted" aria-live="polite"></p>
          <button type="button" class="btn btn-secondary btn-sm" data-action="export-contracts">⬇ ייצוא ל-Excel</button>
        </div>
        <div id="contract-list"></div>
      </section>`);

    renderContractList();
    const form = $('#contract-filters');
    const read = () => { contractFilter = { q: form.elements.q.value, status: form.elements.status.value }; renderContractList(); };
    form.addEventListener('input', read);
    form.addEventListener('change', read);
    form.addEventListener('submit', (e) => e.preventDefault());

    appEl.onclick = async (e) => {
      const cf = e.target.closest('[data-cfilter]');
      if (cf) { contractFilter = { q: '', status: cf.dataset.cfilter }; renderContracts(); $('#contract-list').scrollIntoView({ behavior: 'smooth' }); return; }
      const act = e.target.closest('[data-action]');
      if (act) {
        const a = act.dataset.action;
        if (a === 'ics-all') { downloadIcs(state.contracts.filter((c) => contractState(c) !== 'expired'), `תזכורות-חוזי-שירות-${safeFileName(state.building.name)}.ics`); return; }
        if (a === 'export-contracts') { exportContractsCsv(filteredContracts()); return; }
        const c = findContract(act.dataset.id);
        if (c) await handleContractAction(a, c);
        return;
      }
      const row = e.target.closest('tr[data-contract-id]');
      if (row && !e.target.closest('a')) navigate('/contracts/' + row.dataset.contractId);
    };
  }

  function filteredContracts() {
    const q = contractFilter.q.trim().toLowerCase();
    return state.contracts.filter((c) => {
      const s = contractState(c);
      if (contractFilter.status === 'active' && s === 'expired') return false;
      if (contractFilter.status === 'due' && !['due', 'handled'].includes(s)) return false;
      if (contractFilter.status === 'expired' && s !== 'expired') return false;
      if (q && ![c.title, c.company, c.contractNumber, c.contactName, c.scope, c.notes].join(' ').toLowerCase().includes(q)) return false;
      return true;
    }).sort((a, b) => a.endDate.localeCompare(b.endDate));
  }

  function renderContractList() {
    const box = $('#contract-list');
    if (!box) return;
    const list = filteredContracts();
    $('#contract-count').textContent = `מוצגים ${list.length} מתוך ${state.contracts.length} חוזים · ממוינים לפי תאריך חידוש`;
    if (!state.contracts.length) {
      box.innerHTML = `<div class="empty-state"><p class="empty-icon" aria-hidden="true">📄</p><h3>אין עדיין חוזי שירות</h3>
        <p class="muted">הוסיפו את חוזי השירות של הבניין (מעליות, ניקיון, גינון, ביטוח…) כדי לקבל תזכורת חודש לפני כל חידוש.</p>
        <a class="btn btn-primary" href="/contracts/new">הוספת חוזה ראשון</a></div>`;
      return;
    }
    if (!list.length) { box.innerHTML = '<div class="empty-state"><h3>לא נמצאו חוזים התואמים לסינון</h3></div>'; return; }
    box.innerHTML = `
      <div class="table-wrap">
        <table class="tickets-table contracts-table">
          <caption class="visually-hidden">רשימת חוזי השירות, ממוינת לפי תאריך החידוש</caption>
          <thead><tr>${['שם השירות', 'ספק', 'קטגוריה', 'מספר חוזה', 'תאריך חידוש', 'מצב', 'עלות', 'אחראי'].map((h) => `<th scope="col"><span class="th-static">${h}</span></th>`).join('')}</tr></thead>
          <tbody>${list.map((c) => {
            const s = contractState(c);
            return `<tr data-contract-id="${c.id}" class="${s === 'expired' ? 'row-overdue' : s === 'due' ? 'row-upcoming' : ''}">
              <td data-label="שם השירות" class="col-title"><a href="/contracts/${c.id}">${esc(c.title)}</a>${c.files.length ? `<span class="upd-count">📎 ${c.files.length} מסמכים</span>` : ''}</td>
              <td data-label="ספק">${esc(c.company)}${c.contactPhone ? `<br>${telLink(c.contactPhone)}` : ''}</td>
              <td data-label="קטגוריה">${c.categoryId ? esc(catName(c.categoryId)) : '—'}</td>
              <td data-label="מספר חוזה"><span dir="ltr">${esc(c.contractNumber || '—')}</span></td>
              <td data-label="תאריך חידוש"><strong>${fmtDate(c.endDate)}</strong><br><small class="muted">${endText(c)}</small></td>
              <td data-label="מצב">${contractBadge(c)}${c.autoRenew ? '<br><small class="muted">מתחדש אוטומטית</small>' : ''}</td>
              <td data-label="עלות">${c.cost != null ? `${esc(fmtMoney(c.cost))} <small class="muted">${esc(freqOf(c.paymentFrequency).label)}</small>` : '—'}</td>
              <td data-label="אחראי">${c.responsibleId ? esc(c.responsibleName || memberName(c.responsibleId)) : '—'}</td>
            </tr>`;
          }).join('')}</tbody>
        </table>
      </div>`;
  }

  /* ---------- Detail ---------- */

  function renderContract(id) {
    const c = findContract(id);
    if (!c) {
      setView('<div class="card empty-state"><h1>החוזה לא נמצא</h1><p class="muted">ייתכן שהחוזה נמחק.</p><a href="/contracts" class="btn btn-primary">חזרה לחוזי השירות</a></div>');
      return;
    }
    const s = contractState(c);
    const resp = member(c.responsibleId);
    const freq = freqOf(c.paymentFrequency);
    setView(`
      <nav class="breadcrumbs" aria-label="מיקום בעמוד">
        <a href="/contracts">חוזי שירות</a><span aria-hidden="true">‹</span><span aria-current="page">${esc(c.title)}</span>
      </nav>

      <section class="card ticket-head">
        <div class="ticket-head-main">
          <div class="ticket-number contract-icon" aria-hidden="true">📄</div>
          <div class="ticket-head-text">
            <h1 class="ticket-title">${esc(c.title)}</h1>
            <div class="badges">${contractBadge(c)}${c.categoryId ? `<span class="badge badge-neutral">${esc(catName(c.categoryId))}</span>` : ''}${c.autoRenew ? '<span class="badge badge-neutral">מתחדש אוטומטית</span>' : ''}</div>
            <p class="meta">${esc(c.company)} · תאריך חידוש ${fmtDate(c.endDate)} (${endText(c)}) · תזכורת ב-${fmtDate(reminderDate(c))}</p>
          </div>
        </div>
        <div class="btn-row ticket-actions">
          <a class="btn btn-primary" href="/contracts/${c.id}/edit">✎ עריכה</a>
          <button type="button" class="btn btn-secondary" data-action="renew">🔄 חידוש</button>
          ${s === 'due' || (s === 'expired' && !c.reminderHandled) ? '<button type="button" class="btn btn-secondary" data-action="ack">✔ סימון התזכורת כטופלה</button>' : ''}
          ${c.reminderHandled && (s === 'handled' || s === 'expired') ? '<button type="button" class="btn btn-ghost" data-action="unack">החזרת התזכורת</button>' : ''}
          <button type="button" class="btn btn-secondary" data-action="ics">📅 הוספה ליומן</button>
          <button type="button" class="btn btn-danger-outline" data-action="delete-contract">🗑 מחיקה</button>
        </div>
      </section>

      ${s === 'expired' ? `<div class="alert alert-danger" role="alert"><strong>⛔ החוזה פג תוקף</strong> ב-${fmtDate(c.endDate)} (${endText(c)}). ${c.autoRenew ? 'החוזה מוגדר כמתחדש אוטומטית – אם חודש, עדכנו את התאריכים בלחיצה על "חידוש".' : 'יש לחדש אותו או לסיים את ההתקשרות.'}</div>` : ''}
      ${s === 'due' ? `<div class="alert alert-warning" role="status"><strong>🔔 תזכורת:</strong> החוזה מסתיים ב-${fmtDate(c.endDate)} (${endText(c)}). ${c.autoRenew ? 'הוא יתחדש אוטומטית אם לא תישלח הודעת ביטול – זה הזמן לבדוק אם להמשיך או לבקש הצעות מתחרות.' : 'זה הזמן לחדש את החוזה או לבקש הצעות מחיר.'}</div>` : ''}
      ${s === 'handled' ? `<div class="alert alert-info">✔ התזכורת לחידוש הנוכחי סומנה כטופלה${c.reminderAckByName ? ' על ידי ' + esc(c.reminderAckByName) : ''}${c.reminderAckAt ? ' ב-' + fmtDate(c.reminderAckAt) : ''}.</div>` : ''}

      <div class="ticket-layout">
        <div class="ticket-main">
          <section class="card" aria-labelledby="scope-h">
            <h2 id="scope-h">מה כולל השירות</h2>
            <p class="description">${c.scope ? nl2br(c.scope) : '<span class="muted">לא הוזן פירוט.</span>'}</p>
            ${c.notes ? `<h3 class="sub-h">הערות</h3><p class="description">${nl2br(c.notes)}</p>` : ''}
          </section>

          <section class="card" aria-labelledby="docs-h">
            <h2 id="docs-h">מסמכי החוזה <span class="count">${c.files.length}</span></h2>
            ${c.files.length ? `<ul class="doc-list">${c.files.map((f) => `
              <li data-file-id="${f.id}">
                ${f.type === 'application/pdf'
                  ? `<a href="${esc(f.url)}" target="_blank" rel="noopener" class="doc-link"><span aria-hidden="true">📄</span> <span dir="auto">${esc(f.name)}</span></a>`
                  : `<button type="button" class="doc-thumb" data-action="open-doc-image" data-url="${esc(f.url)}" data-name="${esc(f.name)}" aria-label="${esc('הצגת ' + f.name)}"><img src="${esc(f.url)}" alt="" loading="lazy"></button>
                     <a href="${esc(f.url)}" target="_blank" rel="noopener" class="doc-link" dir="auto">${esc(f.name)}</a>`}
                <span class="muted doc-size">${fmtSize(f.size)}</span>
                <button type="button" class="icon-btn icon-danger" data-action="delete-doc" data-id="${f.id}" aria-label="${esc('מחיקת ' + f.name)}">🗑</button>
              </li>`).join('')}</ul>` : '<p class="muted">לא צורפו מסמכים.</p>'}
            <form id="doc-upload" class="doc-upload" novalidate>
              ${filePickerHtml('doc-files', { exts: CONTRACT_EXT, title: '📎 צירוף החוזה או מסמכים נוספים' })}
              <button type="submit" class="btn btn-primary btn-sm">העלאת הקבצים</button>
            </form>
          </section>
        </div>

        <aside class="ticket-side" aria-label="פרטי החוזה">
          <section class="card" aria-labelledby="cd-h">
            <h2 id="cd-h">פרטי החוזה</h2>
            <dl class="details">
              <dt>חברה / ספק</dt><dd>${esc(c.company)}</dd>
              <dt>איש קשר</dt><dd>${esc(c.contactName || '—')}</dd>
              <dt>טלפון</dt><dd>${telLink(c.contactPhone)}</dd>
              <dt>אימייל</dt><dd>${c.contactEmail ? `<a href="mailto:${esc(c.contactEmail)}" dir="ltr">${esc(c.contactEmail)}</a>` : '—'}</dd>
              <dt>מספר חוזה</dt><dd><span dir="ltr">${esc(c.contractNumber || '—')}</span></dd>
              <dt>תחילת החוזה</dt><dd>${fmtDate(c.startDate)}</dd>
              <dt>סיום / חידוש</dt><dd><strong>${fmtDate(c.endDate)}</strong><br><small>${endText(c)}</small></dd>
              <dt>תאריך התזכורת</dt><dd>${fmtDate(reminderDate(c))} <small class="muted">(חודש לפני)</small></dd>
              <dt>חידוש אוטומטי</dt><dd>${c.autoRenew ? `כן, לתקופה של ${c.renewalMonths} חודשים` : 'לא'}</dd>
              <dt>עלות</dt><dd>${c.cost != null ? `${esc(fmtMoney(c.cost))} (${esc(freq.label)})` : '—'}</dd>
              ${freq.perYear > 1 && c.cost ? `<dt>עלות שנתית</dt><dd>${esc(fmtMoney(annualCost(c)))}</dd>` : ''}
              <dt>אחראי/ת</dt><dd>${c.responsibleId ? esc(c.responsibleName || memberName(c.responsibleId)) + (resp && resp.phone ? '<br>' + telLink(resp.phone) : '') : '—'}</dd>
              <dt>עדכון אחרון</dt><dd>${fmtDateTime(c.updatedAt)}</dd>
            </dl>
            ${c.contactPhone ? `<a class="btn btn-primary btn-block" href="tel:${esc(c.contactPhone.replace(/[^\d+]/g, ''))}">📞 התקשרות ל${esc(c.contactName || c.company)}</a>` : ''}
          </section>
        </aside>
      </div>`);

    const picker = bindFilePicker($('#doc-files'), CONTRACT_EXT);

    appEl.onsubmit = async (e) => {
      if (e.target.id !== 'doc-upload') return;
      e.preventDefault();
      const files = picker.files;
      if (!files.length) { toast('יש לבחור קובץ להעלאה.', 'error'); return; }
      const btn = $('button[type="submit"]', e.target);
      btn.disabled = true;
      btn.textContent = 'מעלה…';
      const n = await uploadTo(`/api/contracts/${c.id}/files`, files);
      await attempt(async () => {
        const { contract } = await api('GET', `/api/contracts/${c.id}`);
        replaceContract(contract);
        if (n) toast(n === 1 ? 'הקובץ הועלה.' : `${n} קבצים הועלו.`, 'success');
        rerender();
      });
    };

    appEl.onclick = async (e) => {
      const act = e.target.closest('[data-action]');
      if (!act) return;
      const a = act.dataset.action;
      if (a === 'open-doc-image') { openLightbox(act.dataset.url, act.dataset.name); return; }
      if (a === 'delete-doc') {
        const ok = await confirmDialog('למחוק את המסמך?', { okLabel: 'מחיקה', danger: true });
        if (!ok) return;
        await attempt(async () => {
          const { contract } = await api('DELETE', `/api/contract-files/${act.dataset.id}`);
          replaceContract(contract);
          toast('המסמך נמחק.', 'success');
          rerender();
        });
        return;
      }
      await handleContractAction(a, c);
    };
  }

  /* ---------- Create / edit form ---------- */

  function renderContractForm(id) {
    const existing = id ? findContract(id) : null;
    if (id && !existing) { renderContract(id); return; }
    const c = existing || {
      title: '', categoryId: null, vendorId: null, company: '', contactName: '', contactPhone: '', contactEmail: '', contractNumber: '',
      startDate: toDateInput(new Date()), endDate: addMonths(toDateInput(new Date()), 12), autoRenew: false, renewalMonths: 12,
      cost: null, paymentFrequency: 'yearly', scope: '', notes: '', responsibleId: state.user.id,
    };
    const sel = (items, cur, empty, labelFn = (i) => i.name) =>
      (empty != null ? `<option value="">${esc(empty)}</option>` : '') +
      items.map((i) => `<option value="${esc(i.id)}" ${String(i.id) === String(cur) ? 'selected' : ''}>${esc(labelFn(i))}</option>`).join('');

    setView(`
      <nav class="breadcrumbs" aria-label="מיקום בעמוד">
        <a href="/contracts">חוזי שירות</a><span aria-hidden="true">‹</span>
        ${existing ? `<a href="/contracts/${c.id}">${esc(c.title)}</a><span aria-hidden="true">‹</span><span aria-current="page">עריכה</span>` : '<span aria-current="page">חוזה חדש</span>'}
      </nav>
      <div class="page-head"><div>
        <h1>${existing ? 'עריכת חוזה שירות' : 'חוזה שירות חדש'}</h1>
        <p class="muted">תזכורת תופיע אוטומטית חודש לפני תאריך הסיום / החידוש.</p>
      </div></div>

      <form id="contract-form" class="ticket-form" novalidate>
        <div class="alert alert-danger" id="form-errors" role="alert" hidden></div>

        <fieldset class="card">
          <legend>השירות</legend>
          <div class="grid-2">
            <div class="field span-2">
              <label for="cf-title">שם השירות <span class="req" aria-hidden="true">*</span></label>
              <input id="cf-title" name="title" required maxlength="120" value="${esc(c.title)}" placeholder="למשל: תחזוקת מעליות שוטפת">
            </div>
            <div class="field">
              <label for="cf-cat">קטגוריה</label>
              <select id="cf-cat" name="categoryId">${sel(state.settings.categories, c.categoryId, 'ללא קטגוריה')}</select>
            </div>
            <div class="field">
              <label for="cf-resp">אחראי/ת מטעם הוועד</label>
              <select id="cf-resp" name="responsibleId">${sel(state.members, c.responsibleId, 'ללא אחראי')}</select>
            </div>
            <div class="field span-2">
              <label for="cf-scope">מה כולל השירות</label>
              <textarea id="cf-scope" name="scope" rows="3" maxlength="3000" placeholder="תדירות ביקורים, זמני תגובה, מה כלול ומה לא">${esc(c.scope)}</textarea>
            </div>
          </div>
        </fieldset>

        <fieldset class="card">
          <legend>הספק</legend>
          <div class="grid-2">
            <div class="field span-2">
              <label for="cf-vendor">בחירה מספר הספקים <small class="muted">(ממלא את הפרטים אוטומטית)</small></label>
              <select id="cf-vendor" name="vendorId">${sel(state.settings.vendors, c.vendorId, '— ספק שאינו ברשימה —', (v) => v.company + (v.specialty ? ' (' + v.specialty + ')' : ''))}</select>
            </div>
            <div class="field">
              <label for="cf-company">שם החברה / הספק <span class="req" aria-hidden="true">*</span></label>
              <input id="cf-company" name="company" required maxlength="100" value="${esc(c.company)}">
            </div>
            <div class="field">
              <label for="cf-number">מספר החוזה</label>
              <input id="cf-number" name="contractNumber" dir="ltr" maxlength="60" value="${esc(c.contractNumber)}">
            </div>
            <div class="field">
              <label for="cf-contact">איש קשר</label>
              <input id="cf-contact" name="contactName" maxlength="80" value="${esc(c.contactName)}">
            </div>
            <div class="field">
              <label for="cf-phone">טלפון</label>
              <input id="cf-phone" name="contactPhone" type="tel" dir="ltr" inputmode="tel" maxlength="20" value="${esc(c.contactPhone)}" placeholder="050-0000000">
            </div>
            <div class="field span-2">
              <label for="cf-email">אימייל</label>
              <input id="cf-email" name="contactEmail" type="email" dir="ltr" maxlength="254" value="${esc(c.contactEmail)}" placeholder="name@example.com">
            </div>
          </div>
        </fieldset>

        <fieldset class="card">
          <legend>תקופה, חידוש ועלות</legend>
          <div class="grid-3">
            <div class="field">
              <label for="cf-start">תאריך תחילה</label>
              <input id="cf-start" name="startDate" type="date" value="${esc(c.startDate)}">
            </div>
            <div class="field">
              <label for="cf-end">תאריך סיום / חידוש <span class="req" aria-hidden="true">*</span></label>
              <input id="cf-end" name="endDate" type="date" required value="${esc(c.endDate)}">
            </div>
            <div class="field">
              <label for="cf-months">תקופת חידוש (חודשים)</label>
              <input id="cf-months" name="renewalMonths" type="number" min="1" max="120" step="1" value="${esc(c.renewalMonths)}">
            </div>
            <div class="field">
              <label for="cf-cost">עלות (₪)</label>
              <input id="cf-cost" name="cost" type="number" min="0" step="1" inputmode="decimal" value="${c.cost ?? ''}">
            </div>
            <div class="field">
              <label for="cf-freq">תדירות תשלום</label>
              <select id="cf-freq" name="paymentFrequency">${sel(FREQUENCIES, c.paymentFrequency, null, (f) => f.label)}</select>
            </div>
            <div class="field field-switch">
              <label class="switch">
                <input type="checkbox" name="autoRenew" ${c.autoRenew ? 'checked' : ''}>
                <span class="switch-track" aria-hidden="true"></span>
                <span>מתחדש אוטומטית</span>
              </label>
            </div>
          </div>
          <p class="alert alert-info reminder-preview" id="reminder-preview" aria-live="polite"></p>
          <div class="field">
            <label for="cf-notes">הערות</label>
            <textarea id="cf-notes" name="notes" rows="2" maxlength="3000" placeholder="למשל: יש לשלוח הודעת ביטול 30 יום מראש">${esc(c.notes)}</textarea>
          </div>
        </fieldset>

        ${existing ? '' : `<fieldset class="card"><legend>מסמכי החוזה</legend>${filePickerHtml('cf-files', { exts: CONTRACT_EXT, title: '📎 צירוף החוזה (PDF) או צילום שלו' })}</fieldset>`}

        <div class="form-actions">
          <button type="submit" class="btn btn-primary btn-lg">${existing ? 'שמירת השינויים' : 'שמירת החוזה'}</button>
          <a class="btn btn-secondary btn-lg" href="${existing ? '/contracts/' + c.id : '/contracts'}">ביטול</a>
        </div>
      </form>`);

    const form = $('#contract-form');
    const picker = existing ? null : bindFilePicker($('#cf-files'), CONTRACT_EXT);
    const updatePreview = () => {
      const end = form.elements.endDate.value;
      const box = $('#reminder-preview');
      if (!end) { box.textContent = 'יש לבחור תאריך סיום / חידוש כדי לקבוע את התזכורת.'; return; }
      const rem = addMonths(end, -1);
      box.innerHTML = `🔔 התזכורת תופיע ב-<strong>${fmtDate(rem)}</strong>, חודש לפני תאריך החידוש ${fmtDate(end)}.`;
    };
    updatePreview();

    appEl.onchange = (e) => {
      if (e.target.name === 'endDate') updatePreview();
      if (e.target.name === 'vendorId') {
        const v = byId(state.settings.vendors, Number(e.target.value));
        if (v) {
          form.elements.company.value = v.company || '';
          form.elements.contactName.value = v.contact || '';
          form.elements.contactPhone.value = v.phone || '';
          toast(`פרטי "${v.company}" מולאו אוטומטית.`, 'info');
        }
      }
    };
    appEl.oninput = (e) => { if (e.target.name === 'endDate') updatePreview(); };

    appEl.onsubmit = async (e) => {
      e.preventDefault();
      clearFieldErrors(form);
      const v = (k) => String(form.elements[k].value ?? '').trim();
      const errors = [];
      if (!v('title')) errors.push(['title', 'יש להזין את שם השירות.']);
      if (!v('company')) errors.push(['company', 'יש להזין את שם החברה / הספק.']);
      if (!v('endDate')) errors.push(['endDate', 'יש לבחור תאריך סיום / חידוש.']);
      if (v('startDate') && v('endDate') && v('endDate') < v('startDate')) errors.push(['endDate', 'תאריך הסיום אינו יכול להיות לפני תאריך התחילה.']);
      if (v('contactPhone') && !/^[0-9+\-\s()]{7,20}$/.test(v('contactPhone'))) errors.push(['contactPhone', 'מספר הטלפון אינו תקין.']);
      if (v('contactEmail') && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v('contactEmail'))) errors.push(['contactEmail', 'כתובת האימייל אינה תקינה.']);
      const months = Number(v('renewalMonths') || 12);
      if (!Number.isInteger(months) || months < 1 || months > 120) errors.push(['renewalMonths', 'תקופת החידוש צריכה להיות בין 1 ל-120 חודשים.']);
      if (v('cost') && !(Number(v('cost')) >= 0)) errors.push(['cost', 'העלות אינה תקינה.']);
      if (errors.length) {
        errors.forEach(([n, m]) => showFieldError(form, n, m));
        const summary = $('#form-errors');
        summary.innerHTML = `<strong>יש לתקן ${errors.length === 1 ? 'שגיאה אחת' : errors.length + ' שגיאות'}:</strong><ul>${errors.map(([, m]) => `<li>${esc(m)}</li>`).join('')}</ul>`;
        summary.hidden = false;
        form.elements[errors[0][0]].focus();
        return;
      }
      const numOrNull = (x) => (x === '' ? null : Number(x));
      const payload = {
        title: v('title'), categoryId: numOrNull(v('categoryId')), vendorId: numOrNull(v('vendorId')), company: v('company'),
        contactName: v('contactName'), contactPhone: v('contactPhone'), contactEmail: v('contactEmail'), contractNumber: v('contractNumber'),
        startDate: v('startDate'), endDate: v('endDate'), autoRenew: form.elements.autoRenew.checked, renewalMonths: months,
        cost: numOrNull(v('cost')), paymentFrequency: v('paymentFrequency'), scope: v('scope'), notes: v('notes'),
        responsibleId: numOrNull(v('responsibleId')),
      };
      const btn = $('button[type="submit"]', form);
      btn.disabled = true;
      btn.textContent = 'שומר…';
      try {
        let { contract } = existing ? await api('PUT', `/api/contracts/${existing.id}`, payload) : await api('POST', '/api/contracts', payload);
        if (picker && picker.files.length) {
          btn.textContent = 'מעלה מסמכים…';
          await uploadTo(`/api/contracts/${contract.id}/files`, picker.files);
          ({ contract } = await api('GET', `/api/contracts/${contract.id}`));
        }
        replaceContract(contract);
        toast(existing ? 'החוזה עודכן.' : 'החוזה נשמר. התזכורת תופיע חודש לפני החידוש.', 'success');
        navigate('/contracts/' + contract.id);
      } catch (err) {
        toast(err.message, 'error');
        const summary = $('#form-errors');
        summary.textContent = err.message;
        summary.hidden = false;
        btn.disabled = false;
        btn.textContent = existing ? 'שמירת השינויים' : 'שמירת החוזה';
      }
    };
  }

  /* ======================================================================
   * Bank – import bank-statement CSV files and review the transactions
   *   CSV handling happens here in the browser: encoding (UTF-8 or the
   *   windows-1255 used by many Israeli banks), delimiter, header row and
   *   column mapping are detected automatically and can be adjusted with a
   *   live preview. The server stores normalized rows and skips duplicates.
   * ==================================================================== */

  const FORMAT_LABEL = { csv: 'CSV', xlsx: 'Excel ‏(xlsx)', xls: 'Excel 97-2003 ‏(xls)', html: 'Excel ‏(xls בפורמט HTML)', xml: 'Excel XML 2003' };
  const nfMoney2 = new Intl.NumberFormat('he-IL', { style: 'currency', currency: 'ILS', minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const fmtMoney2 = (v) => (v == null ? '' : nfMoney2.format(v));
  const DEFAULT_ACCOUNT = 'חשבון ועד הבית';

  /* ---------- CSV parsing ---------- */

  function decodeBytes(buf, encoding) {
    if (encoding === 'auto') {
      try { return { text: new TextDecoder('utf-8', { fatal: true }).decode(buf), encoding: 'utf-8' }; } catch (e) {
        return { text: new TextDecoder('windows-1255').decode(buf), encoding: 'windows-1255' };
      }
    }
    return { text: new TextDecoder(encoding).decode(buf), encoding };
  }

  function detectDelimiter(text) {
    const lines = text.split(/\r?\n/).filter((l) => l.trim()).slice(0, 30);
    let best = ',', bestScore = 0;
    for (const d of [',', ';', '\t', '|']) {
      const counts = lines.map((l) => l.split(d).length - 1).filter((n) => n > 0).sort((a, b) => a - b);
      if (!counts.length) continue;
      const median = counts[Math.floor(counts.length / 2)];
      const score = median * counts.length;
      if (score > bestScore) { best = d; bestScore = score; }
    }
    return best;
  }

  /** RFC 4180 CSV → array of rows (quoted fields, escaped quotes, newlines inside quotes). */
  function parseCsv(text, delim) {
    const rows = [];
    let row = [], field = '', quoted = false;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (quoted) {
        if (ch === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else quoted = false; } else field += ch;
      } else if (ch === '"' && field.trim() === '') { quoted = true; field = ''; }
      else if (ch === delim) { row.push(field); field = ''; }
      else if (ch === '\n' || ch === '\r') {
        if (ch === '\r' && text[i + 1] === '\n') i++;
        row.push(field); rows.push(row); row = []; field = '';
      } else field += ch;
    }
    if (field !== '' || row.length) { row.push(field); rows.push(row); }
    return rows.map((r) => r.map((c) => c.trim())).filter((r) => r.some((c) => c !== ''));
  }

  /* ---------- Excel readers (no external library) ----------
   * .xlsx            – zip of XML; unzipped with the browser's DecompressionStream
   * .xls (BIFF8)     – Excel 97-2003 binary inside an OLE2 compound file
   * .xls (HTML)      – many Israeli banks export an HTML table with an .xls name
   * .xls (XML 2003)  – "XML Spreadsheet 2003"
   * All return rows as arrays of strings; numbers are kept as plain numeric text and
   * Excel date serials are converted later by parseDateCell. */

  const numText = (n) => String(Math.round(n * 1e6) / 1e6);
  const tidyRows = (rows) => rows.map((r) => Array.from(r, (c) => (c == null ? '' : String(c).trim()))).filter((r) => r.some((c) => c !== ''));

  async function readTabular(buf, encoding, delimiter) {
    const b = new Uint8Array(buf);
    if (b[0] === 0xD0 && b[1] === 0xCF && b[2] === 0x11 && b[3] === 0xE0) return { rows: readXls(buf), format: 'xls' };
    if (b[0] === 0x50 && b[1] === 0x4B && b[2] === 0x03 && b[3] === 0x04) return { rows: await readXlsx(buf), format: 'xlsx' };
    const { text, encoding: enc } = decodeBytes(buf, encoding);
    // XML 2003 is checked first: it also has a <Table> element.
    if (text.includes('urn:schemas-microsoft-com:office:spreadsheet') && /<Workbook[\s>]/.test(text)) return { rows: readXml2003(text), format: 'xml', encoding: enc };
    if (/<table[\s>]/i.test(text)) return { rows: readHtmlTable(text), format: 'html', encoding: enc };
    const delim = delimiter || detectDelimiter(text);
    return { rows: parseCsv(text, delim), format: 'csv', encoding: enc, delimiter: delim };
  }

  function readHtmlTable(text) {
    const doc = new DOMParser().parseFromString(text, 'text/html');
    const tables = [...doc.querySelectorAll('table')];
    if (!tables.length) return [];
    const best = tables.reduce((a, t) => (t.rows.length > a.rows.length ? t : a));
    return tidyRows([...best.rows].map((tr) => {
      const out = [];
      for (const cell of tr.cells) { out.push(cell.textContent.replace(/\s+/g, ' ')); for (let i = 1; i < (cell.colSpan || 1); i++) out.push(''); }
      return out;
    }));
  }

  function readXml2003(text) {
    const doc = new DOMParser().parseFromString(text, 'application/xml');
    const sheet = doc.getElementsByTagNameNS('*', 'Worksheet')[0];
    if (!sheet) return [];
    return tidyRows([...sheet.getElementsByTagNameNS('*', 'Row')].map((row) => {
      const out = [];
      for (const cell of row.getElementsByTagNameNS('*', 'Cell')) {
        const idx = cell.getAttribute('ss:Index') || cell.getAttributeNS('urn:schemas-microsoft-com:office:spreadsheet', 'Index');
        if (idx) while (out.length < Number(idx) - 1) out.push('');
        const data = cell.getElementsByTagNameNS('*', 'Data')[0];
        out.push(data ? data.textContent : '');
      }
      return out;
    }));
  }

  /** Minimal zip reader: returns { name → Uint8Array } for the requested entries. */
  async function unzip(buf, wanted) {
    const dv = new DataView(buf);
    let eocd = -1;
    for (let i = buf.byteLength - 22; i >= Math.max(0, buf.byteLength - 66000); i--) if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    if (eocd < 0) throw new Error('zip');
    const count = dv.getUint16(eocd + 10, true);
    let p = dv.getUint32(eocd + 16, true);
    const dec = new TextDecoder();
    const out = {};
    for (let i = 0; i < count; i++) {
      if (dv.getUint32(p, true) !== 0x02014b50) break;
      const method = dv.getUint16(p + 10, true);
      const size = dv.getUint32(p + 20, true);
      const nameLen = dv.getUint16(p + 28, true), extraLen = dv.getUint16(p + 30, true), commentLen = dv.getUint16(p + 32, true);
      const local = dv.getUint32(p + 42, true);
      const name = dec.decode(new Uint8Array(buf, p + 46, nameLen));
      p += 46 + nameLen + extraLen + commentLen;
      if (!wanted(name)) continue;
      const start = local + 30 + dv.getUint16(local + 26, true) + dv.getUint16(local + 28, true);
      const raw = new Uint8Array(buf, start, size);
      out[name] = method === 0 ? raw
        : new Uint8Array(await new Response(new Blob([raw]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).arrayBuffer());
    }
    return out;
  }

  async function readXlsx(buf) {
    const files = await unzip(buf, (n) => /^xl\/(workbook\.xml|_rels\/workbook\.xml\.rels|sharedStrings\.xml|worksheets\/[^/]+\.xml)$/.test(n));
    const dec = new TextDecoder();
    const xml = (name) => (files[name] ? new DOMParser().parseFromString(dec.decode(files[name]), 'application/xml') : null);
    const tags = (doc, tag) => (doc ? [...doc.getElementsByTagNameNS('*', tag)] : []);
    // First sheet in workbook order → its file through the relationships
    let sheetPath = 'xl/worksheets/sheet1.xml';
    const first = tags(xml('xl/workbook.xml'), 'sheet')[0];
    const rid = first && (first.getAttribute('r:id') || [...first.attributes].find((a) => a.localName === 'id')?.value);
    const rel = rid && tags(xml('xl/_rels/workbook.xml.rels'), 'Relationship').find((r) => r.getAttribute('Id') === rid);
    if (rel) { const t = rel.getAttribute('Target').replace(/^\/?xl\//, '').replace(/^\//, ''); if (files['xl/' + t]) sheetPath = 'xl/' + t; }
    if (!files[sheetPath]) sheetPath = Object.keys(files).find((n) => n.startsWith('xl/worksheets/')) || sheetPath;
    const shared = tags(xml('xl/sharedStrings.xml'), 'si').map((si) => tags(si, 't').map((t) => t.textContent).join(''));
    const colIndex = (ref) => { let n = 0; for (const ch of ref.replace(/\d+/g, '')) n = n * 26 + (ch.charCodeAt(0) - 64); return n - 1; };
    return tidyRows(tags(xml(sheetPath), 'row').map((row) => {
      const out = [];
      for (const c of tags(row, 'c')) {
        const idx = c.getAttribute('r') ? colIndex(c.getAttribute('r')) : out.length;
        const type = c.getAttribute('t');
        const v = tags(c, 'v')[0]?.textContent ?? '';
        let val;
        if (type === 's') val = shared[Number(v)] ?? '';
        else if (type === 'inlineStr') val = tags(c, 't').map((t) => t.textContent).join('');
        else if (type === 'str' || type === 'b' || type === 'e') val = v;
        else val = v === '' ? '' : numText(Number(v));
        while (out.length < idx) out.push('');
        out[idx] = val;
      }
      return out;
    }));
  }

  /** Excel 97-2003 (.xls): OLE2 compound file → "Workbook" stream → BIFF records of the first sheet. */
  function readXls(buf) {
    const dv = new DataView(buf);
    const secSize = 1 << dv.getUint16(0x1E, true);
    const miniCutoff = dv.getUint32(0x38, true);
    const END = 0xFFFFFFFE;
    const sectorOffset = (sid) => (sid + 1) * secSize;
    // FAT sectors: 109 in the header, the rest in the DIFAT chain
    const fatSectors = [];
    for (let i = 0; i < 109; i++) { const s = dv.getUint32(0x4C + i * 4, true); if (s < END) fatSectors.push(s); }
    let difat = dv.getUint32(0x44, true);
    for (let guard = 0; difat < END && guard < 10000; guard++) {
      const off = sectorOffset(difat);
      for (let i = 0; i < secSize / 4 - 1; i++) { const s = dv.getUint32(off + i * 4, true); if (s < END) fatSectors.push(s); }
      difat = dv.getUint32(off + secSize - 4, true);
    }
    const fat = [];
    for (const s of fatSectors) for (let i = 0; i < secSize / 4; i++) fat.push(dv.getUint32(sectorOffset(s) + i * 4, true));
    const chain = (start, table) => { const out = []; for (let s = start, g = 0; s < END && g < 1e6; s = table[s], g++) out.push(s); return out; };
    const readStream = (start, size) => {
      const out = new Uint8Array(size);
      let pos = 0;
      for (const s of chain(start, fat)) {
        const n = Math.min(secSize, size - pos);
        if (n <= 0) break;
        out.set(new Uint8Array(buf, sectorOffset(s), n), pos);
        pos += n;
      }
      return out;
    };
    // Directory
    const dirBytes = readStream(dv.getUint32(0x30, true), chain(dv.getUint32(0x30, true), fat).length * secSize);
    const ddv = new DataView(dirBytes.buffer);
    const entries = [];
    for (let off = 0; off + 128 <= dirBytes.length; off += 128) {
      const nameLen = ddv.getUint16(off + 0x40, true);
      const name = String.fromCharCode(...new Uint16Array(dirBytes.buffer.slice(off, off + Math.max(0, nameLen - 2))));
      entries.push({ name, type: dirBytes[off + 0x42], start: ddv.getUint32(off + 0x74, true), size: ddv.getUint32(off + 0x78, true) });
    }
    const wb = entries.find((e) => e.type === 2 && /^(Workbook|Book)$/i.test(e.name));
    if (!wb) throw new Error('no workbook');
    let stream;
    if (wb.size < miniCutoff) {
      const root = entries[0];
      const miniStream = readStream(root.start, root.size);
      const miniFat = [];
      const mfStart = dv.getUint32(0x3C, true);
      for (const s of chain(mfStart, fat)) for (let i = 0; i < secSize / 4; i++) miniFat.push(dv.getUint32(sectorOffset(s) + i * 4, true));
      stream = new Uint8Array(wb.size);
      let pos = 0;
      for (const s of chain(wb.start, miniFat)) { const n = Math.min(64, wb.size - pos); if (n <= 0) break; stream.set(miniStream.subarray(s * 64, s * 64 + n), pos); pos += n; }
    } else stream = readStream(wb.start, wb.size);
    return parseBiff(stream);
  }

  function parseBiff(bytes) {
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const cells = new Map(); // row → array
    const put = (r, c, v) => { if (!cells.has(r)) cells.set(r, []); cells.get(r)[c] = v; };
    const rk = (v) => {
      let n;
      if (v & 2) n = (v | 0) >> 2;
      else { const t = new DataView(new ArrayBuffer(8)); t.setUint32(4, v & 0xFFFFFFFC, true); n = t.getFloat64(0, true); }
      return v & 1 ? n / 100 : n;
    };
    let biff8 = true;
    let codepage = 'windows-1255';
    let sst = [];
    let sheetIndex = -1; // -1 = workbook globals, 0 = first worksheet
    let pendingFormula = null;
    let pos = 0;
    const latin = (u8) => String.fromCharCode(...u8);
    const decode8 = (u8) => { try { return new TextDecoder(codepage).decode(u8); } catch (e) { return latin(u8); } };
    const utf16 = (u8) => { let s = ''; for (let i = 0; i + 1 < u8.length; i += 2) s += String.fromCharCode(u8[i] | (u8[i + 1] << 8)); return s; };
    // XLUnicodeString inside a single record (LABEL / STRING)
    const recString = (off, end, lenBytes) => {
      const cch = lenBytes === 1 ? dv.getUint8(off) : dv.getUint16(off, true);
      off += lenBytes;
      if (!biff8) return decode8(bytes.subarray(off, Math.min(end, off + cch)));
      const flags = dv.getUint8(off++);
      return flags & 1 ? utf16(bytes.subarray(off, Math.min(end, off + cch * 2))) : latin(bytes.subarray(off, Math.min(end, off + cch)));
    };

    while (pos + 4 <= bytes.length) {
      const type = dv.getUint16(pos, true);
      const len = dv.getUint16(pos + 2, true);
      const d = pos + 4;
      const end = d + len;
      if (end > bytes.length) break;

      if (type === 0x0809) { // BOF
        biff8 = dv.getUint16(d, true) === 0x0600;
        if (dv.getUint16(d + 2, true) === 0x0010) sheetIndex++;
      } else if (type === 0x0042) { // CODEPAGE
        const cp = dv.getUint16(d, true);
        codepage = cp === 1200 ? 'utf-16le' : cp === 1252 ? 'windows-1252' : cp === 1255 ? 'windows-1255' : 'windows-1255';
      } else if (type === 0x00FC) { // SST (+ CONTINUE records)
        const segs = [[d, end]];
        let q = end;
        while (q + 4 <= bytes.length && dv.getUint16(q, true) === 0x003C) { const l = dv.getUint16(q + 2, true); segs.push([q + 4, q + 4 + l]); q += 4 + l; }
        let si = 0, p = d + 8;
        const unique = dv.getUint32(d + 4, true);
        const ensure = () => { if (p >= segs[si][1] && si + 1 < segs.length) { si++; p = segs[si][0]; return true; } return false; };
        const u8 = () => { ensure(); return dv.getUint8(p++); };
        const u16 = () => { ensure(); const v = dv.getUint16(p, true); p += 2; return v; };
        const u32 = () => { ensure(); const v = dv.getUint32(p, true); p += 4; return v; };
        const skip = (n) => { while (n > 0) { ensure(); const take = Math.min(n, segs[si][1] - p); p += take; n -= take; if (take === 0) break; } };
        for (let k = 0; k < unique && si < segs.length; k++) {
          let cch = u16();
          let flags = u8();
          const runs = flags & 8 ? u16() : 0;
          const ext = flags & 4 ? u32() : 0;
          let s = '';
          while (cch > 0) {
            if (p >= segs[si][1]) { if (si + 1 >= segs.length) break; si++; p = segs[si][0]; flags = dv.getUint8(p++); }
            const wide = flags & 1;
            const avail = Math.floor((segs[si][1] - p) / (wide ? 2 : 1));
            const n = Math.min(cch, avail);
            const chunk = bytes.subarray(p, p + n * (wide ? 2 : 1));
            s += wide ? utf16(chunk) : latin(chunk);
            p += n * (wide ? 2 : 1);
            cch -= n;
            if (n === 0 && p < segs[si][1]) break;
          }
          skip(runs * 4 + ext);
          sst.push(s);
        }
        pos = q;
        continue;
      } else if (sheetIndex === 0) {
        if (type === 0x000A) break; // EOF of the first worksheet
        const row = len >= 4 ? dv.getUint16(d, true) : 0;
        const col = len >= 4 ? dv.getUint16(d + 2, true) : 0;
        if (type === 0x00FD) put(row, col, sst[dv.getUint32(d + 6, true)] ?? '');              // LABELSST
        else if (type === 0x0203) put(row, col, numText(dv.getFloat64(d + 6, true)));           // NUMBER
        else if (type === 0x027E) put(row, col, numText(rk(dv.getUint32(d + 6, true))));         // RK
        else if (type === 0x00BD) {                                                               // MULRK
          const last = dv.getUint16(end - 2, true);
          for (let c = col, o = d + 4; c <= last; c++, o += 6) put(row, c, numText(rk(dv.getUint32(o + 2, true))));
        } else if (type === 0x0204 || type === 0x00D6) put(row, col, recString(d + 6, end, 2));  // LABEL / RSTRING
        else if (type === 0x0006) {                                                               // FORMULA (cached value)
          if (dv.getUint16(d + 12, true) === 0xFFFF) {
            const kind = dv.getUint8(d + 6);
            if (kind === 0) pendingFormula = [row, col];
            else if (kind === 1) put(row, col, dv.getUint8(d + 8) ? 'TRUE' : 'FALSE');
          } else put(row, col, numText(dv.getFloat64(d + 6, true)));
        } else if (type === 0x0207 && pendingFormula) { put(pendingFormula[0], pendingFormula[1], recString(d, end, biff8 ? 2 : 1)); pendingFormula = null; }
      }
      pos = end;
    }
    const maxRow = Math.max(-1, ...cells.keys());
    const rows = [];
    for (let r = 0; r <= maxRow; r++) rows.push(cells.get(r) || []);
    return tidyRows(rows);
  }

  const BANK_FIELDS = [
    { key: 'date', label: 'תאריך', required: true },
    { key: 'valueDate', label: 'תאריך ערך' },
    { key: 'description', label: 'תיאור', required: true },
    { key: 'reference', label: 'אסמכתא' },
    { key: 'debit', label: 'חובה (הוצאה)' },
    { key: 'credit', label: 'זכות (הכנסה)' },
    { key: 'amount', label: 'סכום (עמודה אחת)' },
    { key: 'balance', label: 'יתרה' },
    { key: 'note', label: 'הערה' },
  ];
  // Checked in this order, so "תאריך ערך" is not taken as the main date and "סכום חובה" not as a single amount.
  const HEADER_KEYS = [
    ['valueDate', ['תאריך ערך', 'value date', 'ערך']],
    ['date', ['תאריך', 'date', 'יום']],
    ['debit', ['חובה', 'חיוב', 'debit', 'withdrawal', 'הוצאה']],
    ['credit', ['זכות', 'זיכוי', 'credit', 'deposit', 'הכנסה']],
    ['balance', ['יתרה', 'balance']],
    ['reference', ['אסמכתא', 'אסמכתה', 'reference', 'ref', 'מס. פעולה']],
    ['description', ['תיאור', 'תאור', 'פרטים', 'הפעולה', 'description', 'details', 'memo', 'פירוט']],
    ['amount', ['סכום', 'amount']],
    ['note', ['הערה', 'הערות', 'note']],
  ];

  function matchHeader(cell) {
    const h = String(cell || '').replace(/["'״׳]/g, '').trim().toLowerCase();
    if (!h) return null;
    for (const [key, words] of HEADER_KEYS) if (words.some((w) => h === w || h.includes(w))) return key;
    return null;
  }

  function findHeaderRow(rows) {
    let best = 0, bestScore = 0;
    rows.slice(0, 30).forEach((r, i) => {
      const score = new Set(r.map(matchHeader).filter(Boolean)).size;
      if (score > bestScore) { best = i; bestScore = score; }
    });
    return bestScore >= 2 ? best : 0;
  }

  function autoMapping(headers) {
    const map = {};
    const used = new Set();
    for (const [key] of HEADER_KEYS) {
      const idx = headers.findIndex((h, i) => !used.has(i) && matchHeader(h) === key);
      if (idx >= 0) { map[key] = idx; used.add(idx); }
    }
    return map;
  }

  function parseAmount(raw) {
    if (raw == null) return null;
    let s = String(raw).trim();
    if (!s) return null;
    let neg = false;
    if (/^\(.*\)$/.test(s)) { neg = true; s = s.slice(1, -1); }
    s = s.replace(/₪|ש"ח|ש״ח|nis|ils/gi, '').replace(/[\s ‎‏]/g, '').replace(/[−–]/g, '-');
    if (s.endsWith('-')) { neg = !neg; s = s.slice(0, -1); }
    if (s.startsWith('-')) { neg = !neg; s = s.slice(1); }
    if (s.startsWith('+')) s = s.slice(1);
    if (!s) return null;
    if (s.includes(',') && s.includes('.')) {
      s = s.lastIndexOf(',') > s.lastIndexOf('.') ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
    } else if (s.includes(',')) {
      s = /^\d{1,3}(,\d{3})+$/.test(s) ? s.replace(/,/g, '') : s.replace(',', '.');
    }
    if (!/^\d*\.?\d+$/.test(s)) return NaN;
    const n = Number(s);
    return neg ? -n : n;
  }

  function parseDateCell(raw, fmt) {
    const s = String(raw || '').trim().split(/\s+/)[0].replace(/T[\d:.]+Z?$/, ''); // drop a time part (2026-10-01T00:00:00)
    // Excel stores dates as serial day numbers (days since 30/12/1899)
    if (/^\d{5}(\.\d+)?$/.test(s) && Number(s) > 20000 && Number(s) < 80000) {
      const dt = new Date(Date.UTC(1899, 11, 30) + Math.floor(Number(s)) * DAY);
      return dt.toISOString().slice(0, 10);
    }
    let m, y, mo, d;
    if ((m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/))) [, y, mo, d] = m;
    else if ((m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2}|\d{4})$/))) {
      if (fmt === 'mdy') { mo = m[1]; d = m[2]; } else { d = m[1]; mo = m[2]; }
      y = m[3].length === 2 ? '20' + m[3] : m[3];
    } else return null;
    const iso = `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const dt = new Date(Number(y), Number(mo) - 1, Number(d));
    return dt.getFullYear() === Number(y) && dt.getMonth() === Number(mo) - 1 && dt.getDate() === Number(d) ? iso : null;
  }

  function detectDateFormat(values) {
    for (const v of values) {
      const m = String(v || '').trim().match(/^(\d{1,2})[-/.](\d{1,2})[-/.]\d{2,4}/);
      if (m && Number(m[1]) > 12) return 'dmy';
      if (m && Number(m[2]) > 12) return 'mdy';
    }
    return 'dmy'; // Israeli default
  }

  /** Turn the parsed CSV + mapping into normalized rows, with a per-row status for the preview. */
  function buildImportRows(st) {
    const cell = (r, key) => (st.mapping[key] == null ? '' : r[st.mapping[key]] ?? '');
    const data = st.rows.slice(st.headerRow + 1);
    const out = [];
    const preview = [];
    let invalid = 0;
    for (const r of data) {
      const date = parseDateCell(cell(r, 'date'), st.dateFormat);
      let amount;
      if (st.amountMode === 'split') {
        const debit = parseAmount(cell(r, 'debit'));
        const credit = parseAmount(cell(r, 'credit'));
        amount = Number.isNaN(debit) || Number.isNaN(credit) ? NaN : Math.abs(credit || 0) - Math.abs(debit || 0);
      } else {
        amount = parseAmount(cell(r, 'amount'));
        if (amount != null && st.invert) amount = -amount;
      }
      const balance = parseAmount(cell(r, 'balance'));
      const row = {
        date, valueDate: parseDateCell(cell(r, 'valueDate'), st.dateFormat),
        description: cell(r, 'description'), reference: cell(r, 'reference'), note: cell(r, 'note'),
        amount: Math.round((amount || 0) * 100) / 100, balance: balance == null || Number.isNaN(balance) ? null : balance,
      };
      const ok = !!date && amount != null && !Number.isNaN(amount) && amount !== 0;
      if (ok) out.push(row); else invalid++;
      if (preview.length < 8) preview.push({ ...row, ok });
    }
    return { rows: out, invalid, preview };
  }

  /* ---------- Data ---------- */

  let bankFilter = { q: '', period: 'all', from: '', to: '', account: 'all', type: 'all', category: 'all' };
  let bankSort = { key: 'date', dir: 'desc' };
  let bankLimit = 100;
  let bankTab = 'imports';
  const bankSelected = new Set();

  async function loadBankData() {
    state.bank = await api('GET', '/api/bank');
    return state.bank;
  }

  const bankCat = (id) => (state.bank ? byId(state.bank.categories, id) : null);

  /*
   * Neutral lines – money moved to / from a savings deposit ("הפקדה לפיקדון", "פירעון פיקדון"),
   * or any line in a category of kind 'transfer' – are not income and not expenses:
   * they are left out of the totals and charts (the server also tags them with the
   * "פיקדון" category and a remark). Same pattern as bank.js.
   */
  const DEPOSIT_RE = /הפקדה\s*ל\s*פי?קדון|פי?רעון\s+פי?קדון/;
  const isNeutral = (t) => DEPOSIT_RE.test(t.description) || bankCat(t.categoryId)?.kind === 'transfer';
  const isIncome = (t) => t.amount > 0 && !isNeutral(t);
  const isExpense = (t) => t.amount < 0 && !isNeutral(t);
  const KIND_LABEL = { income: 'הכנסות', expense: 'הוצאות', transfer: 'ללא השפעה (פיקדונות / העברות)' };
  /** <optgroup>s of the building's bank categories, grouped by kind. */
  const bankCatGroups = (cur) => ['income', 'expense', 'transfer'].map((kind) => {
    const cats = state.bank.categories.filter((c) => c.kind === kind);
    return cats.length ? `<optgroup label="${KIND_LABEL[kind]}">${cats.map((c) =>
      `<option value="${c.id}" ${String(cur) === String(c.id) ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</optgroup>` : '';
  }).join('');
  const bankAccounts = () => [...new Set((state.bank?.transactions || []).map((t) => t.account))].sort((a, b) => a.localeCompare(b, 'he'));

  function periodRange() {
    const now = new Date();
    const y = now.getFullYear(), m = now.getMonth();
    const d = (yy, mm, dd) => toDateInput(new Date(yy, mm, dd));
    switch (bankFilter.period) {
      case 'this_month': return [d(y, m, 1), d(y, m + 1, 0)];
      case 'last_month': return [d(y, m - 1, 1), d(y, m, 0)];
      case 'last_3': return [d(y, m - 2, 1), d(y, m + 1, 0)];
      case 'this_year': return [d(y, 0, 1), d(y, 11, 31)];
      case 'last_year': return [d(y - 1, 0, 1), d(y - 1, 11, 31)];
      case 'custom': return [bankFilter.from || '0000-01-01', bankFilter.to || '9999-12-31'];
      default: return ['0000-01-01', '9999-12-31'];
    }
  }

  function filteredBank() {
    const [from, to] = periodRange();
    const q = bankFilter.q.trim().toLowerCase();
    const list = (state.bank?.transactions || []).filter((t) => {
      if (t.date < from || t.date > to) return false;
      if (bankFilter.account !== 'all' && t.account !== bankFilter.account) return false;
      if (bankFilter.type === 'income' && !isIncome(t)) return false;
      if (bankFilter.type === 'expense' && !isExpense(t)) return false;
      if (bankFilter.type === 'neutral' && !isNeutral(t)) return false;
      if (bankFilter.category === 'none' && t.categoryId) return false;
      if (!['all', 'none'].includes(bankFilter.category) && String(t.categoryId) !== bankFilter.category) return false;
      if (q && ![t.description, t.reference, t.note, String(Math.abs(t.amount))].join(' ').toLowerCase().includes(q)) return false;
      return true;
    });
    const dir = bankSort.dir === 'asc' ? 1 : -1;
    const val = (t) => ({
      date: t.date, description: t.description, amount: t.amount, balance: t.balance ?? -Infinity,
      category: t.categoryId ? (bankCat(t.categoryId)?.name || '') : '',
    })[bankSort.key];
    return list.sort((a, b) => {
      const va = val(a), vb = val(b);
      const cmp = typeof va === 'number' ? va - vb : String(va).localeCompare(String(vb), 'he');
      return cmp * dir || (b.id - a.id) * (bankSort.key === 'date' ? dir : 1);
    });
  }

  /* ---------- Page ---------- */

  async function renderBank() {
    if (!state.bank) {
      setView('<p class="loading">טוען נתוני בנק…</p>');
      try { await loadBankData(); } catch (e) { setView(`<div class="alert alert-danger" role="alert">${esc(e.message)}</div>`); return; }
      if (currentView !== 'bank') return;
    }
    const b = state.bank;
    const accounts = bankAccounts();
    const opt = (v, label, cur) => `<option value="${esc(v)}" ${String(cur) === String(v) ? 'selected' : ''}>${esc(label)}</option>`;
    const catOptions = (cur) => bankCatGroups(cur);

    setView(`
      <div class="page-head">
        <div>
          <h1>בנק</h1>
          <p class="muted">תנועות חשבון הבנק של הוועד, מיובאות מקובצי CSV או Excel שמורידים מאתר הבנק.</p>
        </div>
        <div class="btn-row">
          <button type="button" class="btn btn-primary" data-action="bank-import">⬆ ייבוא קובץ CSV / Excel</button>
          <button type="button" class="btn btn-secondary" data-action="bank-manual">＋ תנועה ידנית</button>
          <button type="button" class="btn btn-secondary" data-action="bank-export">⬇ ייצוא ל-Excel</button>
        </div>
      </div>

      ${b.transactions.length ? `
        <section class="summary-grid summary-grid-5" id="bank-summary" aria-label="סיכום התקופה"></section>

        <section class="card" aria-labelledby="bank-list-h">
          <div class="card-head"><h2 id="bank-list-h">תנועות</h2></div>
          <form class="filters bank-filters" id="bank-filters" role="search" aria-label="סינון תנועות">
            <div class="field field-grow">
              <label for="bf-q">חיפוש</label>
              <input type="search" id="bf-q" name="q" value="${esc(bankFilter.q)}" placeholder="תיאור, אסמכתא, הערה או סכום…" autocomplete="off">
            </div>
            <div class="field">
              <label for="bf-period">תקופה</label>
              <select id="bf-period" name="period">
                ${[['all', 'כל התקופה'], ['this_month', 'החודש'], ['last_month', 'החודש הקודם'], ['last_3', '3 חודשים אחרונים'], ['this_year', 'השנה'], ['last_year', 'השנה הקודמת'], ['custom', 'טווח תאריכים…']]
                  .map(([v, l]) => opt(v, l, bankFilter.period)).join('')}
              </select>
            </div>
            <div class="field bank-custom" ${bankFilter.period === 'custom' ? '' : 'hidden'}>
              <label for="bf-from">מתאריך</label><input type="date" id="bf-from" name="from" value="${esc(bankFilter.from)}">
            </div>
            <div class="field bank-custom" ${bankFilter.period === 'custom' ? '' : 'hidden'}>
              <label for="bf-to">עד תאריך</label><input type="date" id="bf-to" name="to" value="${esc(bankFilter.to)}">
            </div>
            <div class="field">
              <label for="bf-type">סוג</label>
              <select id="bf-type" name="type">${[['all', 'הכל'], ['income', 'הכנסות (זכות)'], ['expense', 'הוצאות (חובה)'], ['neutral', 'פיקדונות / העברות']].map(([v, l]) => opt(v, l, bankFilter.type)).join('')}</select>
            </div>
            <div class="field">
              <label for="bf-cat">קטגוריה</label>
              <select id="bf-cat" name="category">${opt('all', 'הכל', bankFilter.category)}${opt('none', 'ללא קטגוריה', bankFilter.category)}${catOptions(bankFilter.category)}</select>
            </div>
            ${accounts.length > 1 ? `<div class="field">
              <label for="bf-acc">חשבון</label>
              <select id="bf-acc" name="account">${opt('all', 'כל החשבונות', bankFilter.account)}${accounts.map((a) => opt(a, a, bankFilter.account)).join('')}</select>
            </div>` : ''}
            <div class="filter-checks"><button type="button" class="btn btn-ghost btn-sm" data-action="bank-clear">ניקוי סינון</button></div>
          </form>
          <div class="bulk-bar" id="bank-bulk" hidden></div>
          <div id="bank-table"></div>
        </section>

        <section class="card" aria-labelledby="bank-charts-h">
          <h2 id="bank-charts-h">ניתוח</h2>
          <div class="stats-grid" id="bank-charts"></div>
        </section>` : `
        <section class="card empty-state">
          <p class="empty-icon" aria-hidden="true">🏦</p>
          <h3>עדיין לא יובאו תנועות בנק</h3>
          <p class="muted">הורידו מאתר הבנק את פירוט התנועות כקובץ CSV או Excel ‏(xls / xlsx), ולחצו על "ייבוא קובץ".<br>
            המערכת מזהה אוטומטית את העמודות הנפוצות: תאריך, תיאור, אסמכתא, חובה, זכות ויתרה.</p>
          <div class="btn-row center">
            <button type="button" class="btn btn-primary" data-action="bank-import">⬆ ייבוא קובץ CSV / Excel</button>
            <a class="btn btn-secondary" href="/samples/bank-sample.csv" download>⬇ קובץ לדוגמה</a>
          </div>
        </section>`}

      <section class="card" aria-labelledby="bank-manage-h">
        <div class="card-head bank-manage-head">
          <h2 id="bank-manage-h">ניהול</h2>
          <div class="segmented" role="tablist" aria-label="ניהול נתוני הבנק">
            ${[['imports', 'היסטוריית ייבוא'], ['rules', 'סיווג אוטומטי'], ['categories', 'קטגוריות']].map(([k, l]) =>
              `<button type="button" class="segmented-btn ${bankTab === k ? 'is-active' : ''}" role="tab" aria-selected="${bankTab === k}" data-bank-tab="${k}">${l}</button>`).join('')}
          </div>
        </div>
        <div id="bank-manage"></div>
      </section>`);

    renderBankDynamic();
    renderBankManage();

    const form = $('#bank-filters');
    if (form) {
      const read = () => {
        const fd = new FormData(form);
        bankFilter = {
          q: String(fd.get('q') || ''), period: fd.get('period'), from: String(fd.get('from') || ''), to: String(fd.get('to') || ''),
          account: fd.get('account') || 'all', type: fd.get('type'), category: fd.get('category'),
        };
        $$('.bank-custom', form).forEach((el) => { el.hidden = bankFilter.period !== 'custom'; });
        bankLimit = 100;
        bankSelected.clear();
        renderBankDynamic();
      };
      form.addEventListener('input', read);
      form.addEventListener('change', read);
      form.addEventListener('submit', (e) => e.preventDefault());
    }

    appEl.onchange = async (e) => {
      const el = e.target;
      if (el.closest('#bank-filters')) return;
      if (el.matches('[data-select-row]')) {
        if (el.checked) bankSelected.add(Number(el.dataset.selectRow)); else bankSelected.delete(Number(el.dataset.selectRow));
        renderBulkBar();
        return;
      }
      if (el.matches('[data-select-all]')) {
        const visible = filteredBank().slice(0, bankLimit);
        visible.forEach((t) => (el.checked ? bankSelected.add(t.id) : bankSelected.delete(t.id)));
        $$('[data-select-row]').forEach((c) => { c.checked = el.checked; });
        renderBulkBar();
        return;
      }
      if (el.matches('[data-tx-field]')) {
        const t = byId(state.bank.transactions, Number(el.dataset.id));
        const field = el.dataset.txField;
        const value = el.value ? Number(el.value) : null;
        el.disabled = true;
        const ok = await attempt(async () => { await api('PATCH', `/api/bank/transactions/${t.id}`, { [field]: value }); return true; });
        el.disabled = false;
        if (ok) {
          t[field] = value;
          el.closest('td').classList.add('cell-saved');
          $('#bank-sr').textContent = 'התנועה עודכנה.';
          renderBankSummary();
          renderBankCharts();
        } else el.value = t[field] == null ? '' : String(t[field]);
      }
    };

    appEl.onsubmit = async (e) => {
      const form2 = e.target;
      if (form2.id === 'bank-filters') return;
      e.preventDefault();
      const fd = new FormData(form2);
      if (form2.id === 'rule-form') {
        await attempt(async () => {
          await api('POST', '/api/bank/rules', { pattern: fd.get('pattern'), direction: fd.get('direction'), categoryId: Number(fd.get('categoryId')) || null });
          toast('הכלל נוסף. לחצו "החלת הכללים" כדי לסווג תנועות קיימות.', 'success');
          await reloadBank();
        });
      }
      if (form2.id === 'bank-cat-form') {
        await attempt(async () => {
          await api('POST', '/api/bank/categories', { name: fd.get('name'), kind: fd.get('kind') });
          toast('הקטגוריה נוספה.', 'success');
          await reloadBank();
        });
      }
    };

    appEl.onclick = async (e) => {
      const tab = e.target.closest('[data-bank-tab]');
      if (tab) { bankTab = tab.dataset.bankTab; $$('[data-bank-tab]').forEach((b2) => { const on = b2 === tab; b2.classList.toggle('is-active', on); b2.setAttribute('aria-selected', String(on)); }); renderBankManage(); return; }
      const sortBtn = e.target.closest('[data-bank-sort]');
      if (sortBtn) {
        const key = sortBtn.dataset.bankSort;
        bankSort = bankSort.key === key ? { key, dir: bankSort.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: key === 'date' || key === 'amount' ? 'desc' : 'asc' };
        renderBankTable();
        const again = $(`[data-bank-sort="${key}"]`);
        if (again) again.focus();
        return;
      }
      const act = e.target.closest('[data-action]');
      if (!act) return;
      const a = act.dataset.action;
      const t = act.dataset.id ? byId(state.bank.transactions, Number(act.dataset.id)) : null;
      if (a === 'bank-import') openBankImport();
      if (a === 'bank-manual') openManualTx();
      if (a === 'bank-export') exportBankCsv(filteredBank());
      if (a === 'bank-clear') { bankFilter = { q: '', period: 'all', from: '', to: '', account: 'all', type: 'all', category: 'all' }; renderBank(); }
      if (a === 'bank-more') { bankLimit += 100; renderBankTable(); }
      if (a === 'bank-uncat') { bankFilter = { ...bankFilter, category: 'none' }; renderBank(); }
      if (a === 'bank-neutral') { bankFilter = { ...bankFilter, type: 'neutral', category: 'all' }; renderBank(); }
      if (a === 'tx-note' && t) editTxNote(t);
      if (a === 'tx-delete' && t) {
        if (!(await confirmDialog(`למחוק את התנועה "${t.description}" (${fmtMoney2(t.amount)}) מתאריך ${fmtDate(t.date)}?`, { okLabel: 'מחיקה', danger: true }))) return;
        await attempt(async () => { await api('DELETE', `/api/bank/transactions/${t.id}`); toast('התנועה נמחקה.', 'success'); await reloadBank(); });
      }
      if (a === 'bulk-category') {
        const sel = $('#bulk-cat');
        await attempt(async () => {
          const r = await api('POST', '/api/bank/transactions/bulk', { ids: [...bankSelected], action: 'category', categoryId: sel.value ? Number(sel.value) : null });
          toast(`${r.changed} תנועות עודכנו.`, 'success');
          bankSelected.clear();
          await reloadBank();
        });
      }
      if (a === 'bulk-delete') {
        if (!(await confirmDialog(`למחוק ${bankSelected.size} תנועות?`, { okLabel: 'מחיקה', danger: true }))) return;
        await attempt(async () => {
          const r = await api('POST', '/api/bank/transactions/bulk', { ids: [...bankSelected], action: 'delete' });
          toast(`${r.changed} תנועות נמחקו.`, 'success');
          bankSelected.clear();
          await reloadBank();
        });
      }
      if (a === 'bulk-clear') { bankSelected.clear(); $$('[data-select-row], [data-select-all]').forEach((c) => { c.checked = false; }); renderBulkBar(); }
      if (a === 'import-undo') {
        const imp = byId(state.bank.imports, Number(act.dataset.id));
        if (!imp || !(await confirmDialog(`לבטל את הייבוא של "${imp.fileName || 'קובץ'}" מתאריך ${fmtDateTime(imp.createdAt)}?\n${imp.remaining} התנועות שנוספו בו יימחקו.`, { title: 'ביטול ייבוא', okLabel: 'ביטול הייבוא', danger: true }))) return;
        await attempt(async () => { await api('DELETE', `/api/bank/imports/${imp.id}`); toast('הייבוא בוטל.', 'success'); await reloadBank(); });
      }
      if (a === 'rule-delete') {
        await attempt(async () => { await api('DELETE', `/api/bank/rules/${act.dataset.id}`); toast('הכלל נמחק.', 'success'); await reloadBank(); });
      }
      if (a === 'rules-apply') {
        await attempt(async () => {
          const r = await api('POST', '/api/bank/rules/apply');
          toast(`סווגו ${r.categorized} תנועות וקושרו ${r.linked} לחוזי שירות.`, 'success');
          await reloadBank();
        });
      }
      if (a === 'bank-cat-edit') editBankCategory(bankCat(Number(act.dataset.id)));
      if (a === 'bank-cat-delete') {
        const c = bankCat(Number(act.dataset.id));
        const used = state.bank.transactions.filter((x) => x.categoryId === c.id).length;
        if (!(await confirmDialog(`למחוק את הקטגוריה "${c.name}"?${used ? `\n${used} תנועות יישארו ללא קטגוריה.` : ''}\nכללי הסיווג שלה יימחקו גם הם.`, { okLabel: 'מחיקה', danger: true }))) return;
        await attempt(async () => { await api('DELETE', `/api/bank/categories/${c.id}`); toast('הקטגוריה נמחקה.', 'success'); await reloadBank(); });
      }
    };
  }

  async function reloadBank() {
    await loadBankData();
    const y = window.scrollY;
    await renderBank();
    window.scrollTo(0, y);
  }

  function renderBankDynamic() {
    renderBankSummary();
    renderBankTable();
    renderBankCharts();
  }

  function renderBankSummary() {
    const box = $('#bank-summary');
    if (!box) return;
    const list = filteredBank();
    const income = list.filter(isIncome).reduce((s, t) => s + t.amount, 0);
    const expense = list.filter(isExpense).reduce((s, t) => s + t.amount, 0);
    const neutral = list.filter(isNeutral);
    const depositedOut = -neutral.filter((t) => t.amount < 0).reduce((s, t) => s + t.amount, 0);
    const depositedIn = neutral.filter((t) => t.amount > 0).reduce((s, t) => s + t.amount, 0);
    const uncategorized = list.filter((t) => !t.categoryId).length;
    // Latest known balance per account (from the statement's balance column)
    const accounts = bankFilter.account === 'all' ? bankAccounts() : [bankFilter.account];
    const balances = accounts.map((acc) => state.bank.transactions.filter((t) => t.account === acc && t.balance != null)
      .sort((a, b) => b.date.localeCompare(a.date) || b.id - a.id)[0]).filter(Boolean);
    const balance = balances.length ? balances.reduce((s, t) => s + t.balance, 0) : null;
    const latest = balances.length ? balances.map((t) => t.date).sort().pop() : null;
    box.innerHTML = `
      <div class="summary-card sc-resolved"><span class="sc-icon" aria-hidden="true">⬇</span><span class="sc-value money">${esc(fmtMoney(income))}</span><span class="sc-label">הכנסות בתקופה</span></div>
      <div class="summary-card sc-overdue"><span class="sc-icon" aria-hidden="true">⬆</span><span class="sc-value money">${esc(fmtMoney(-expense))}</span><span class="sc-label">הוצאות בתקופה</span></div>
      <div class="summary-card ${income + expense >= 0 ? 'sc-open' : 'sc-urgent'}"><span class="sc-icon" aria-hidden="true">±</span><span class="sc-value money">${esc(fmtMoney(income + expense))}</span><span class="sc-label">נטו (הכנסות פחות הוצאות)</span></div>
      <div class="summary-card sc-external"><span class="sc-icon" aria-hidden="true">🏦</span><span class="sc-value money">${balance == null ? '—' : esc(fmtMoney(balance))}</span><span class="sc-label">יתרה ${latest ? 'לפי הדף האחרון (' + fmtDate(latest) + ')' : '(אין עמודת יתרה)'}</span></div>
      <button type="button" class="summary-card sc-urgent" data-action="bank-uncat" aria-label="${uncategorized} תנועות ללא קטגוריה. לחיצה לסינון"><span class="sc-icon" aria-hidden="true">🏷</span><span class="sc-value">${uncategorized}</span><span class="sc-label">ללא קטגוריה · ${list.length} תנועות</span></button>
      ${neutral.length ? `<p class="neutral-note span-all">🏦 תנועות פיקדון בתקופה (לא נחשבות כהכנסה או הוצאה): הופקדו לפיקדון <strong class="money-inline">${esc(fmtMoney2(depositedOut))}</strong>,
        נפרעו מפיקדון <strong class="money-inline">${esc(fmtMoney2(depositedIn))}</strong>.
        <button type="button" class="link-btn" data-action="bank-neutral">הצגת התנועות</button></p>` : ''}`;
  }

  function renderBankTable() {
    const box = $('#bank-table');
    if (!box) return;
    const list = filteredBank();
    const shown = list.slice(0, bankLimit);
    const multiAcc = bankAccounts().length > 1;
    const b = state.bank;
    const opt = (v, label, cur) => `<option value="${esc(v)}" ${String(cur) === String(v) ? 'selected' : ''}>${esc(label)}</option>`;
    const catSelect = (t) => `<select data-tx-field="categoryId" data-id="${t.id}" aria-label="${esc('קטגוריה לתנועה ' + t.description)}" class="${t.categoryId ? '' : 'sel-empty'}">
      <option value="">— ללא —</option>${bankCatGroups(t.categoryId)}</select>`;
    const contractSelect = (t) => `<select data-tx-field="contractId" data-id="${t.id}" aria-label="${esc('חוזה שירות לתנועה ' + t.description)}">
      <option value="">—</option>${state.contracts.map((c) => opt(c.id, c.title, t.contractId)).join('')}</select>`;
    const th = (key, label) => {
      const active = bankSort.key === key;
      return `<th scope="col" aria-sort="${active ? (bankSort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}">
        <button type="button" class="sort-btn ${active ? 'active' : ''}" data-bank-sort="${key}">${label}<span class="sort-ind" aria-hidden="true">${active ? (bankSort.dir === 'asc' ? '▲' : '▼') : '↕'}</span></button></th>`;
    };
    if (!list.length) { box.innerHTML = '<div class="empty-state"><h3>אין תנועות התואמות לסינון</h3></div>'; renderBulkBar(); return; }
    box.innerHTML = `
      <p class="visually-hidden" id="bank-sr" aria-live="polite"></p>
      <div class="table-wrap">
        <table class="tickets-table bank-table">
          <caption class="visually-hidden">תנועות בנק. שינוי קטגוריה או חוזה נשמר מיד.</caption>
          <thead><tr>
            <th scope="col" class="col-check"><input type="checkbox" data-select-all aria-label="בחירת כל התנועות המוצגות" ${shown.length && shown.every((t) => bankSelected.has(t.id)) ? 'checked' : ''}></th>
            ${th('date', 'תאריך')}${th('description', 'תיאור')}${multiAcc ? '<th scope="col"><span class="th-static">חשבון</span></th>' : ''}
            ${th('category', 'קטגוריה')}<th scope="col"><span class="th-static">חוזה שירות</span></th>
            ${th('amount', 'חובה')}<th scope="col"><span class="th-static">זכות</span></th>${th('balance', 'יתרה')}
            <th scope="col"><span class="visually-hidden">פעולות</span></th>
          </tr></thead>
          <tbody>${shown.map((t) => `
            <tr class="${isNeutral(t) ? 'tx-neutral' : t.amount < 0 ? 'tx-out' : 'tx-in'}" ${isNeutral(t) ? 'title="לא נחשב כהכנסה או הוצאה"' : ''}>
              <td class="col-check"><input type="checkbox" data-select-row="${t.id}" aria-label="${esc('בחירת התנועה ' + t.description)}" ${bankSelected.has(t.id) ? 'checked' : ''}></td>
              <td data-label="תאריך" class="col-date">${fmtDate(t.date)}${t.valueDate && t.valueDate !== t.date ? `<small class="muted">ערך ${fmtDate(t.valueDate)}</small>` : ''}</td>
              <td data-label="תיאור" class="col-desc"><span dir="auto">${esc(t.description)}</span>
                ${t.reference ? `<small class="muted">אסמכתא <span dir="ltr">${esc(t.reference)}</span></small>` : ''}
                ${t.note ? `<small class="tx-note">📝 ${esc(t.note)}</small>` : ''}${t.manual ? '<small class="muted">הוזנה ידנית</small>' : ''}</td>
              ${multiAcc ? `<td data-label="חשבון">${esc(t.account)}</td>` : ''}
              <td data-label="קטגוריה">${catSelect(t)}</td>
              <td data-label="חוזה שירות">${contractSelect(t)}</td>
              <td data-label="חובה" class="col-money money-out">${t.amount < 0 ? esc(fmtMoney2(-t.amount)) : ''}</td>
              <td data-label="זכות" class="col-money money-in">${t.amount > 0 ? esc(fmtMoney2(t.amount)) : ''}</td>
              <td data-label="יתרה" class="col-money">${t.balance != null ? esc(fmtMoney2(t.balance)) : ''}</td>
              <td class="row-actions">
                <button type="button" class="icon-btn" data-action="tx-note" data-id="${t.id}" aria-label="${esc('הערה לתנועה ' + t.description)}" title="הערה">📝</button>
                <button type="button" class="icon-btn icon-danger" data-action="tx-delete" data-id="${t.id}" aria-label="${esc('מחיקת התנועה ' + t.description)}" title="מחיקה">🗑</button>
              </td>
            </tr>`).join('')}</tbody>
        </table>
      </div>
      <div class="list-toolbar bank-foot">
        <p class="muted">מוצגות ${shown.length} מתוך ${list.length} תנועות</p>
        ${list.length > shown.length ? `<button type="button" class="btn btn-secondary btn-sm" data-action="bank-more">הצגת 100 נוספות</button>` : ''}
      </div>`;
    renderBulkBar();
  }

  function renderBulkBar() {
    const bar = $('#bank-bulk');
    if (!bar) return;
    const n = bankSelected.size;
    bar.hidden = !n;
    if (!n) { bar.innerHTML = ''; return; }
    const cats = state.bank.categories;
    bar.innerHTML = `
      <strong>${n} תנועות נבחרו</strong>
      <label for="bulk-cat" class="visually-hidden">קטגוריה לתנועות שנבחרו</label>
      <select id="bulk-cat"><option value="">— ללא קטגוריה —</option>
        ${bankCatGroups(null)}
      </select>
      <button type="button" class="btn btn-primary btn-sm" data-action="bulk-category">שיוך לקטגוריה</button>
      <button type="button" class="btn btn-danger-outline btn-sm" data-action="bulk-delete">מחיקה</button>
      <button type="button" class="btn btn-ghost btn-sm" data-action="bulk-clear">ביטול הבחירה</button>`;
  }

  function renderBankCharts() {
    const box = $('#bank-charts');
    if (!box) return;
    const list = filteredBank();
    // Monthly income vs expenses – last 12 months (account filter applies)
    const base = state.bank.transactions.filter((t) => bankFilter.account === 'all' || t.account === bankFilter.account);
    const n = new Date();
    const months = [];
    for (let i = 11; i >= 0; i--) {
      const d = new Date(n.getFullYear(), n.getMonth() - i, 1);
      const key = toDateInput(d).slice(0, 7);
      const inMonth = base.filter((t) => t.date.startsWith(key));
      months.push({ label: dfMonthShort.format(d), year: String(d.getFullYear()).slice(2),
        income: inMonth.filter(isIncome).reduce((s, t) => s + t.amount, 0),
        expense: -inMonth.filter(isExpense).reduce((s, t) => s + t.amount, 0) });
    }
    const max = Math.max(1, ...months.flatMap((m) => [m.income, m.expense]));
    const byCat = new Map();
    list.filter(isExpense).forEach((t) => {
      const name = t.categoryId ? (bankCat(t.categoryId)?.name || '—') : 'ללא קטגוריה';
      byCat.set(name, (byCat.get(name) || 0) - t.amount);
    });
    const catRows = [...byCat].map(([label, value]) => ({ label, value: Math.round(value) })).sort((a, b) => b.value - a.value);
    const incCat = new Map();
    list.filter(isIncome).forEach((t) => {
      const name = t.categoryId ? (bankCat(t.categoryId)?.name || '—') : 'ללא קטגוריה';
      incCat.set(name, (incCat.get(name) || 0) + t.amount);
    });
    const incRows = [...incCat].map(([label, value]) => ({ label, value: Math.round(value) })).sort((a, b) => b.value - a.value);
    box.innerHTML = `
      <div class="span-all">
        <h3>הכנסות מול הוצאות – 12 חודשים אחרונים</h3>
        <p class="chart-legend"><span class="swatch" style="background:var(--success)" aria-hidden="true"></span> הכנסות <span class="swatch" style="background:var(--danger)" aria-hidden="true"></span> הוצאות</p>
        <div class="col-chart col-chart-pair" role="img" aria-label="${esc(months.map((m) => `${m.label} ${m.year}: הכנסות ${Math.round(m.income)}, הוצאות ${Math.round(m.expense)}`).join('; '))}">
          ${months.map((m) => `<div class="col">
            <div class="col-plot col-plot-pair">
              <span class="col-bar bar-in" style="height:${(m.income / max) * 90}%" title="הכנסות ${esc(fmtMoney(m.income))}"></span>
              <span class="col-bar bar-out" style="height:${(m.expense / max) * 90}%" title="הוצאות ${esc(fmtMoney(m.expense))}"></span>
            </div>
            <span class="col-label">${esc(m.label)}<br><small>${m.year}</small></span>
          </div>`).join('')}
        </div>
      </div>
      <div><h3>הוצאות לפי קטגוריה (בתקופה שנבחרה)</h3>${barChart(catRows, { color: 'var(--danger)', suffix: ' ₪' })}</div>
      <div><h3>הכנסות לפי קטגוריה (בתקופה שנבחרה)</h3>${barChart(incRows, { color: 'var(--success)', suffix: ' ₪' })}</div>`;
  }

  function renderBankManage() {
    const box = $('#bank-manage');
    if (!box || !state.bank) return;
    const b = state.bank;
    const catName2 = (id) => bankCat(id)?.name || '—';
    if (bankTab === 'imports') {
      box.innerHTML = b.imports.length ? `
        <div class="table-wrap"><table class="simple-table">
          <thead><tr><th scope="col">מועד הייבוא</th><th scope="col">קובץ</th><th scope="col">חשבון</th><th scope="col">נוספו</th><th scope="col">כפולות שדולגו</th><th scope="col">על ידי</th><th scope="col"><span class="visually-hidden">פעולות</span></th></tr></thead>
          <tbody>${b.imports.map((i) => `<tr>
            <td data-label="מועד">${fmtDateTime(i.createdAt)}</td>
            <td data-label="קובץ"><span dir="auto">${esc(i.fileName || '—')}</span></td>
            <td data-label="חשבון">${esc(i.account)}</td>
            <td data-label="נוספו">${i.rowsImported}${i.remaining !== i.rowsImported ? ` <small class="muted">(נותרו ${i.remaining})</small>` : ''}</td>
            <td data-label="כפולות">${i.rowsDuplicate}</td>
            <td data-label="על ידי">${esc(i.importedByName || '—')}</td>
            <td class="row-actions">${isOwner() || i.importedById === state.user.id ? `<button type="button" class="btn btn-danger-outline btn-sm" data-action="import-undo" data-id="${i.id}">ביטול הייבוא</button>` : ''}</td>
          </tr>`).join('')}</tbody></table></div>
        <p class="muted small">ייבוא חוזר של אותו קובץ (או של קובץ חופף) מדלג אוטומטית על תנועות שכבר קיימות.</p>`
        : '<p class="muted">עדיין לא בוצעו ייבואים.</p>';
      return;
    }
    if (bankTab === 'rules') {
      const dirLabel = { any: 'כל תנועה', income: 'הכנסה', expense: 'הוצאה' };
      box.innerHTML = `
        <p class="muted">כשמייבאים קובץ, כל תנועה שהתיאור שלה מכיל את המילה מקבלת את הקטגוריה. תשלומים לספק של חוזה שירות מקושרים לחוזה לפי שם הספק.</p>
        <ul class="option-list rule-list">${b.rules.map((r) => `<li>
          <span class="option-name">אם התיאור מכיל «${esc(r.pattern)}» <span class="badge badge-neutral">${dirLabel[r.direction]}</span> ← ${esc(catName2(r.categoryId))}</span>
          <button type="button" class="icon-btn icon-danger" data-action="rule-delete" data-id="${r.id}" aria-label="${esc('מחיקת הכלל ' + r.pattern)}">🗑</button></li>`).join('') || '<li class="muted">אין כללים.</li>'}</ul>
        <form id="rule-form" class="add-item-form" novalidate>
          <div class="field"><label for="rl-pattern">התיאור מכיל</label><input id="rl-pattern" name="pattern" maxlength="60" required placeholder="למשל: חברת החשמל"></div>
          <div class="field"><label for="rl-dir">סוג תנועה</label><select id="rl-dir" name="direction"><option value="any">כל תנועה</option><option value="expense">הוצאה</option><option value="income">הכנסה</option></select></div>
          <div class="field"><label for="rl-cat">קטגוריה</label><select id="rl-cat" name="categoryId">${b.categories.map((c) => `<option value="${c.id}">${esc(c.name)}</option>`).join('')}</select></div>
          <button type="submit" class="btn btn-primary">הוספת כלל</button>
        </form>
        <button type="button" class="btn btn-secondary" data-action="rules-apply">החלת הכללים על תנועות ללא קטגוריה</button>`;
      return;
    }
    box.innerHTML = `
      <div class="grid-3">
        ${['income', 'expense', 'transfer'].map((kind) => `<div>
          <h3>${KIND_LABEL[kind]}</h3>
          ${kind === 'transfer' ? '<p class="muted small">תנועות בקטגוריות אלה אינן נחשבות כהכנסה או הוצאה.</p>' : ''}
          <ul class="option-list">${b.categories.filter((c) => c.kind === kind).map((c) => `<li>
            <span class="option-name">${esc(c.name)}</span>
            <span class="muted option-used">${b.transactions.filter((t) => t.categoryId === c.id).length} תנועות</span>
            <span class="row-actions">
              <button type="button" class="icon-btn" data-action="bank-cat-edit" data-id="${c.id}" aria-label="${esc('עריכת ' + c.name)}">✎</button>
              <button type="button" class="icon-btn icon-danger" data-action="bank-cat-delete" data-id="${c.id}" aria-label="${esc('מחיקת ' + c.name)}">🗑</button>
            </span></li>`).join('') || '<li class="muted">אין קטגוריות.</li>'}</ul>
        </div>`).join('')}
      </div>
      <form id="bank-cat-form" class="add-item-form" novalidate>
        <div class="field"><label for="bc-name">קטגוריה חדשה</label><input id="bc-name" name="name" maxlength="50" required></div>
        <div class="field"><label for="bc-kind">סוג</label><select id="bc-kind" name="kind"><option value="expense">הוצאה</option><option value="income">הכנסה</option><option value="transfer">ללא השפעה (פיקדון / העברה)</option></select></div>
        <button type="submit" class="btn btn-primary">הוספה</button>
      </form>`;
  }

  /* ---------- Dialogs ---------- */

  function editTxNote(t) {
    openModal({
      title: 'הערה לתנועה',
      body: `<form id="note-form" class="stack-form" novalidate>
        <p class="muted">${fmtDate(t.date)} · <span dir="auto">${esc(t.description)}</span> · ${esc(fmtMoney2(t.amount))}</p>
        <div class="field"><label for="tx-note-text">הערה</label><textarea id="tx-note-text" rows="3" maxlength="500">${esc(t.note)}</textarea></div></form>`,
      actions: [
        {
          label: 'שמירה', className: 'btn-primary', onClick: async (modal) => {
            const note = $('#tx-note-text', modal).value.trim();
            const ok = await attempt(async () => { await api('PATCH', `/api/bank/transactions/${t.id}`, { note }); return true; });
            if (!ok) return false;
            t.note = note;
            toast('ההערה נשמרה.', 'success');
            setTimeout(renderBankTable, 0);
            return true;
          },
        },
        { label: 'ביטול' },
      ],
      initialFocus: '#tx-note-text',
    });
  }

  function editBankCategory(c) {
    if (!c) return;
    openModal({
      title: 'עריכת קטגוריה',
      body: `<form id="edit-form" class="stack-form" novalidate>
        <div class="field"><label for="ebc-name">שם</label><input id="ebc-name" maxlength="50" value="${esc(c.name)}"></div>
        <div class="field"><label for="ebc-kind">סוג</label><select id="ebc-kind"><option value="expense" ${c.kind === 'expense' ? 'selected' : ''}>הוצאה</option><option value="income" ${c.kind === 'income' ? 'selected' : ''}>הכנסה</option><option value="transfer" ${c.kind === 'transfer' ? 'selected' : ''}>ללא השפעה (פיקדון / העברה)</option></select></div></form>`,
      actions: [
        {
          label: 'שמירה', className: 'btn-primary', onClick: async (modal) => {
            const ok = await attempt(async () => { await api('PUT', `/api/bank/categories/${c.id}`, { name: $('#ebc-name', modal).value, kind: $('#ebc-kind', modal).value }); return true; });
            if (!ok) return false;
            toast('הקטגוריה עודכנה.', 'success');
            setTimeout(() => attempt(reloadBank), 0);
            return true;
          },
        },
        { label: 'ביטול' },
      ],
    });
    submitOnEnter('#edit-form');
  }

  function openManualTx() {
    const accounts = bankAccounts();
    const cats = state.bank.categories;
    openModal({
      title: 'הוספת תנועה ידנית',
      body: `<form id="manual-form" class="stack-form" novalidate>
        <p class="muted">למשל תשלום במזומן או תנועה שעדיין לא הופיעה בקובץ מהבנק.</p>
        <div class="grid-2">
          <div class="field"><label for="mt-date">תאריך *</label><input id="mt-date" name="date" type="date" value="${toDateInput(new Date())}" required></div>
          <div class="field"><label for="mt-acc">חשבון *</label><input id="mt-acc" name="account" list="mt-accounts" value="${esc(accounts[0] || DEFAULT_ACCOUNT)}" maxlength="80">
            <datalist id="mt-accounts">${accounts.map((a) => `<option value="${esc(a)}">`).join('')}</datalist></div>
          <div class="field span-2"><label for="mt-desc">תיאור *</label><input id="mt-desc" name="description" maxlength="300" required></div>
          <div class="field"><span class="label" id="mt-type-l">סוג *</span>
            <div class="pill-group" role="radiogroup" aria-labelledby="mt-type-l">
              <label class="pill pill-high"><input type="radio" name="type" value="expense" checked><span>הוצאה (חובה)</span></label>
              <label class="pill pill-low"><input type="radio" name="type" value="income"><span>הכנסה (זכות)</span></label>
            </div></div>
          <div class="field"><label for="mt-amount">סכום (₪) *</label><input id="mt-amount" name="amount" type="number" min="0.01" step="0.01" inputmode="decimal" required></div>
          <div class="field"><label for="mt-ref">אסמכתא</label><input id="mt-ref" name="reference" dir="ltr" maxlength="60"></div>
          <div class="field"><label for="mt-cat">קטגוריה</label><select id="mt-cat" name="categoryId"><option value="">— זיהוי אוטומטי —</option>${cats.map((c) => `<option value="${c.id}">${esc(c.name)}</option>`).join('')}</select></div>
          <div class="field span-2"><label for="mt-note">הערה</label><input id="mt-note" name="note" maxlength="500"></div>
        </div></form>`,
      actions: [
        {
          label: 'הוספה', className: 'btn-primary', onClick: async (modal) => {
            const f = $('#manual-form', modal);
            const amount = Number(f.elements.amount.value);
            if (!f.elements.date.value || !f.elements.description.value.trim() || !(amount > 0) || !f.elements.account.value.trim()) {
              toast('יש למלא תאריך, חשבון, תיאור וסכום גדול מאפס.', 'error');
              return false;
            }
            const type = f.querySelector('input[name="type"]:checked').value;
            const ok = await attempt(async () => {
              await api('POST', '/api/bank/transactions', {
                date: f.elements.date.value, account: f.elements.account.value, description: f.elements.description.value,
                amount: type === 'expense' ? -amount : amount, reference: f.elements.reference.value,
                categoryId: f.elements.categoryId.value ? Number(f.elements.categoryId.value) : null, note: f.elements.note.value,
              });
              return true;
            });
            if (!ok) return false;
            toast('התנועה נוספה.', 'success');
            setTimeout(() => attempt(reloadBank), 0);
            return true;
          },
        },
        { label: 'ביטול' },
      ],
      initialFocus: '#mt-desc',
    });
  }

  /** Import dialog: pick a file → detected settings + column mapping + live preview → import. */
  function openBankImport() {
    const lastAccount = state.bank?.imports[0]?.account || bankAccounts()[0] || DEFAULT_ACCOUNT;
    const st = { file: null, buf: null, encoding: 'auto', resolved: '', delimiter: ',', rows: [], headerRow: 0, mapping: {}, amountMode: 'split', invert: false, dateFormat: 'dmy', account: lastAccount };
    const { modal, close } = openModal({
      title: 'ייבוא תנועות מקובץ CSV או Excel',
      wide: true,
      body: `
        <div class="import-step">
          <div class="grid-2">
            <div class="field span-2">${filePickerHtml('imp-file', { exts: ['csv', 'xls', 'xlsx', 'xml', 'txt'], title: '📄 בחירת קובץ CSV או Excel מהבנק' })}</div>
            <div class="field"><label for="imp-account">שם החשבון</label><input id="imp-account" maxlength="80" value="${esc(lastAccount)}"></div>
            <div class="field"><span class="label">צריך קובץ לדוגמה?</span><a href="/samples/bank-sample.csv" download class="link-small">⬇ הורדת קובץ CSV לדוגמה</a></div>
          </div>
          <p class="muted small">טיפ: באתרי הבנקים בוחרים "ייצוא לאקסל" או "הורדה כ-CSV". נתמכים קבצי CSV, ‏Excel ‏(xlsx) ו-Excel 97-2003 ‏(xls), כולל קובצי ה-xls שהבנקים מייצאים בפורמט HTML.</p>
        </div>
        <div id="imp-config"></div>`,
      actions: [
        { label: 'ייבוא', className: 'btn-primary', onClick: () => doImport() },
        { label: 'ביטול' },
      ],
    });
    const importBtn = $('.modal-foot [data-act="0"]', modal);
    importBtn.disabled = true;

    // Reuse the generic file picker, but keep only the last chosen file.
    const input = $('#imp-file .file-input', modal);
    const drop = $('#imp-file .file-drop', modal);
    const take = async (files) => {
      const f = files && files[0];
      if (!f) return;
      if (!/\.(csv|txt|xls|xlsx|xml)$/i.test(f.name)) { toast('יש לבחור קובץ CSV או Excel ‏(xls / xlsx).', 'error'); return; }
      if (f.size > 20 * 1048576) { toast('הקובץ גדול מדי (עד 20MB).', 'error'); return; }
      st.file = f;
      st.buf = await f.arrayBuffer();
      st.encoding = 'auto';
      st.delimiter = null;
      parseFile(true);
    };
    input.addEventListener('change', () => { take(input.files); input.value = ''; });
    ['dragenter', 'dragover'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('dragging'); }));
    ['dragleave', 'drop'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove('dragging'); }));
    drop.addEventListener('drop', (e) => take(e.dataTransfer && e.dataTransfer.files));

    /** (Re)read the file. detectHeader: re-detect the header row and column mapping. */
    async function parseFile(detectHeader) {
      try {
        const res = await readTabular(st.buf, st.encoding, st.delimiter);
        st.format = res.format;
        st.resolved = res.encoding || '';
        if (res.delimiter) st.delimiter = res.delimiter;
        st.rows = res.rows;
      } catch (err) {
        console.error(err);
        st.rows = [];
        $('#imp-config', modal).innerHTML = '<p class="alert alert-danger">לא ניתן לקרוא את הקובץ. ודאו שזה קובץ CSV או Excel תקין, או שמרו אותו מחדש מ-Excel בפורמט CSV.</p>';
        importBtn.disabled = true;
        return;
      }
      if (detectHeader) {
        st.headerRow = findHeaderRow(st.rows);
        applyHeaderDetection();
      }
      renderConfig();
    }

    function applyHeaderDetection() {
      const headers = st.rows[st.headerRow] || [];
      st.mapping = autoMapping(headers);
      st.amountMode = st.mapping.debit != null || st.mapping.credit != null ? 'split' : 'single';
      st.dateFormat = detectDateFormat(st.rows.slice(st.headerRow + 1, st.headerRow + 60).map((r) => r[st.mapping.date]));
    }

    function renderConfig() {
      const box = $('#imp-config', modal);
      if (!st.rows.length) { box.innerHTML = '<p class="alert alert-danger">הקובץ ריק או שלא ניתן לקרוא אותו.</p>'; importBtn.disabled = true; return; }
      const headers = st.rows[st.headerRow] || [];
      const colOptions = (cur) => `<option value="">— אין —</option>${headers.map((h, i) => `<option value="${i}" ${cur === i ? 'selected' : ''}>${esc(h || `עמודה ${i + 1}`)}</option>`).join('')}`;
      const fields = BANK_FIELDS.filter((f) => (st.amountMode === 'split' ? f.key !== 'amount' : !['debit', 'credit'].includes(f.key)));
      const built = buildImportRows(st);
      const missing = !st.mapping.date && st.mapping.date !== 0 ? 'תאריך' : (st.mapping.description == null ? 'תיאור' : null)
        || (st.amountMode === 'split' ? (st.mapping.debit == null && st.mapping.credit == null ? 'חובה / זכות' : null) : (st.mapping.amount == null ? 'סכום' : null));
      importBtn.disabled = !!missing || !built.rows.length;
      importBtn.textContent = built.rows.length ? `ייבוא ${built.rows.length} תנועות` : 'ייבוא';
      box.innerHTML = `
        <hr>
        <p><strong>${esc(st.file.name)}</strong> · ${esc(FORMAT_LABEL[st.format] || st.format)} · ${st.rows.length} שורות${st.resolved ? ` · קידוד ${st.resolved === 'utf-8' ? 'UTF-8' : 'Windows-1255 (עברית)'}` : ''}</p>
        <div class="grid-3 import-settings">
          ${st.resolved ? `<div class="field"><label for="imp-enc">קידוד</label><select id="imp-enc">
            ${[['auto', 'זיהוי אוטומטי'], ['utf-8', 'UTF-8'], ['windows-1255', 'Windows-1255 (עברית)']].map(([v, l]) => `<option value="${v}" ${st.encoding === v ? 'selected' : ''}>${l}</option>`).join('')}</select></div>` : ''}
          ${st.format === 'csv' ? `<div class="field"><label for="imp-delim">מפריד</label><select id="imp-delim">
            ${[[',', 'פסיק ,'], [';', 'נקודה-פסיק ;'], ['\t', 'טאב'], ['|', 'קו |']].map(([v, l]) => `<option value="${esc(v)}" ${st.delimiter === v ? 'selected' : ''}>${l}</option>`).join('')}</select></div>` : ''}
          <div class="field"><label for="imp-header">שורת הכותרות</label><select id="imp-header">
            ${st.rows.slice(0, 30).map((r, i) => `<option value="${i}" ${st.headerRow === i ? 'selected' : ''}>שורה ${i + 1}: ${esc(r.slice(0, 4).join(' | ').slice(0, 50))}</option>`).join('')}</select></div>
          <div class="field"><label for="imp-datefmt">פורמט תאריך</label><select id="imp-datefmt">
            ${[['dmy', 'יום/חודש/שנה'], ['mdy', 'חודש/יום/שנה'], ['ymd', 'שנה-חודש-יום']].map(([v, l]) => `<option value="${v}" ${st.dateFormat === v ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
          <div class="field"><label for="imp-mode">סכומים</label><select id="imp-mode">
            <option value="split" ${st.amountMode === 'split' ? 'selected' : ''}>עמודות חובה וזכות נפרדות</option>
            <option value="single" ${st.amountMode === 'single' ? 'selected' : ''}>עמודת סכום אחת (חיובי = זכות)</option></select></div>
          ${st.amountMode === 'single' ? `<div class="field field-switch"><label class="check"><input type="checkbox" id="imp-invert" ${st.invert ? 'checked' : ''}> היפוך סימן (חיובי = הוצאה)</label></div>` : '<div></div>'}
        </div>
        <h3 class="sub-h">התאמת עמודות</h3>
        <div class="grid-3 import-mapping">
          ${fields.map((f) => `<div class="field"><label for="map-${f.key}">${f.label}${f.required ? ' *' : ''}</label>
            <select id="map-${f.key}" data-map="${f.key}">${colOptions(st.mapping[f.key])}</select></div>`).join('')}
        </div>
        ${missing ? `<p class="alert alert-danger">יש לבחור עמודה עבור: ${esc(missing)}</p>` : ''}
        <h3 class="sub-h">תצוגה מקדימה</h3>
        <div class="table-wrap"><table class="simple-table import-preview">
          <thead><tr><th scope="col">תאריך</th><th scope="col">תיאור</th><th scope="col">אסמכתא</th><th scope="col">חובה</th><th scope="col">זכות</th><th scope="col">יתרה</th><th scope="col">מצב</th></tr></thead>
          <tbody>${built.preview.map((r) => `<tr class="${r.ok ? '' : 'row-invalid'}">
            <td>${r.date ? fmtDate(r.date) : '—'}</td><td dir="auto">${esc(r.description || '—')}</td><td dir="ltr">${esc(r.reference || '')}</td>
            <td class="money-out">${r.ok && r.amount < 0 ? esc(fmtMoney2(-r.amount)) : ''}</td><td class="money-in">${r.ok && r.amount > 0 ? esc(fmtMoney2(r.amount)) : ''}</td>
            <td>${r.balance != null ? esc(fmtMoney2(r.balance)) : ''}</td><td>${r.ok ? '✔' : '<span class="muted">תדולג</span>'}</td></tr>`).join('')}</tbody>
        </table></div>
        <p class="muted small">${built.rows.length} תנועות תקינות לייבוא${built.invalid ? ` · ${built.invalid} שורות בלי תאריך או סכום (למשל שורות סיכום) ידולגו` : ''}. תנועות שכבר יובאו בעבר ידולגו אוטומטית.</p>`;
    }

    modal.addEventListener('change', (e) => {
      const el = e.target;
      if (!st.buf) return;
      if (el.id === 'imp-enc') { st.encoding = el.value; parseFile(false); }
      else if (el.id === 'imp-delim') { st.delimiter = el.value; parseFile(true); }
      else if (el.id === 'imp-header') { st.headerRow = Number(el.value); applyHeaderDetection(); renderConfig(); }
      else if (el.id === 'imp-datefmt') { st.dateFormat = el.value; renderConfig(); }
      else if (el.id === 'imp-mode') { st.amountMode = el.value; renderConfig(); }
      else if (el.id === 'imp-invert') { st.invert = el.checked; renderConfig(); }
      else if (el.dataset.map) { st.mapping[el.dataset.map] = el.value === '' ? null : Number(el.value); renderConfig(); }
    });

    async function doImport() {
      const account = $('#imp-account', modal).value.trim();
      if (!account) { toast('יש להזין שם לחשבון.', 'error'); $('#imp-account', modal).focus(); return false; }
      const { rows } = buildImportRows(st);
      if (!rows.length) return false;
      importBtn.textContent = 'מייבא…';
      const r = await attempt(() => api('POST', '/api/bank/import', { account, fileName: st.file.name, rows }));
      if (!r) { importBtn.textContent = `ייבוא ${rows.length} תנועות`; return false; }
      toast(`יובאו ${r.imported} תנועות${r.duplicates ? `, ${r.duplicates} כפולות דולגו` : ''}${r.invalid ? `, ${r.invalid} שורות לא תקינות` : ''}.`, r.imported ? 'success' : 'info');
      bankFilter = { q: '', period: 'all', from: '', to: '', account: 'all', type: 'all', category: 'all' };
      setTimeout(() => attempt(reloadBank), 0);
      return true;
    }
    return close;
  }

  function exportBankCsv(list) {
    if (!list.length) { toast('אין תנועות לייצוא.', 'error'); return; }
    const headers = ['תאריך', 'תאריך ערך', 'חשבון', 'תיאור', 'אסמכתא', 'חובה', 'זכות', 'יתרה', 'קטגוריה', 'חוזה שירות', 'הערה', 'נחשב כהכנסה / הוצאה'];
    const contractTitle = (id) => (state.contracts.find((c) => c.id === id) || {}).title || '';
    const rows = list.map((t) => [fmtDate(t.date), t.valueDate ? fmtDate(t.valueDate) : '', t.account, t.description, t.reference,
      t.amount < 0 ? (-t.amount).toFixed(2) : '', t.amount > 0 ? t.amount.toFixed(2) : '', t.balance != null ? t.balance.toFixed(2) : '',
      t.categoryId ? (bankCat(t.categoryId)?.name || '') : '', contractTitle(t.contractId), t.note,
      isNeutral(t) ? 'לא' : 'כן']);
    const cell = (v) => { const s = String(v ?? '').replace(/\r?\n/g, ' '); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
    downloadBlob(new Blob(['﻿' + [headers, ...rows].map((r) => r.map(cell).join(',')).join('\r\n')], { type: 'text/csv;charset=utf-8' }),
      `תנועות-בנק-${toDateInput(new Date())}.csv`);
    toast(`יוצאו ${list.length} תנועות.`, 'success');
  }

  /* ======================================================================
   * Data operations: wipe, demo, delete building, backup, restore
   * ==================================================================== */

  async function reloadAndGo(msg) {
    state.bank = null;
    await loadData();
    filters = Object.assign({}, DEFAULT_FILTERS);
    toast(msg, 'success');
    if (location.pathname === '/dashboard') rerender(); else navigate('/dashboard');
  }

  async function wipeAllData() {
    const ok = await confirmDialog(`פעולה זו תמחק את כל הקריאות, העדכונים, חוזי השירות, תנועות הבנק והקבצים של הבניין "${state.building.name}" – אצל כל חברי הוועד.\nהרשימות והספקים יישמרו. מומלץ לבצע גיבוי לפני כן.\n\nלהמשיך?`, { title: 'מחיקת כל הנתונים', okLabel: 'כן, למחוק הכל', danger: true });
    if (!ok) return;
    await attempt(async () => {
      await api('DELETE', '/api/building/tickets');
      await reloadAndGo('כל הקריאות וחוזי השירות נמחקו. אפשר להתחיל מחדש.');
    });
  }

  async function restoreDemo() {
    if (state.tickets.length || state.contracts.length) {
      const ok = await confirmDialog('טעינת נתוני ההדגמה תחליף את כל הקריאות וחוזי השירות הקיימים בבניין (אצל כל חברי הוועד). להמשיך?', { okLabel: 'טעינת נתוני הדגמה', danger: true });
      if (!ok) return;
    }
    await attempt(async () => {
      await api('POST', '/api/building/demo');
      const settings = await api('GET', '/api/settings');
      state.settings = settings;
      await reloadAndGo('נתוני ההדגמה נטענו.');
    });
  }

  async function deleteBuilding() {
    const ok = await confirmDialog(`למחוק לצמיתות את הבניין "${state.building.name}" עם כל הקריאות, הקבצים והרשימות שלו?\nהפעולה תשפיע על כל חברי הוועד ואין דרך לבטל אותה.`, { title: 'מחיקת הבניין', okLabel: 'מחיקת הבניין', danger: true });
    if (!ok) return;
    await attempt(async () => {
      await api('DELETE', '/api/building');
      try { sessionStorage.removeItem(BUILDING_KEY); } catch (e) { /* ignore */ }
      location.replace('/dashboard');
    });
  }

  async function exportBackup() {
    toast('מכין קובץ גיבוי…', 'info');
    await attempt(async () => {
      const res = await fetch('/api/building/backup', { headers: { 'X-Building-Id': String(state.building.id) }, credentials: 'same-origin' });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'יצירת הגיבוי נכשלה');
      downloadBlob(await res.blob(), `גיבוי-תקלות-${state.building.name}-${toDateInput(new Date())}.json`);
      toast('קובץ הגיבוי הורד.', 'success');
    });
  }

  async function restoreBackup(file) {
    const input = $('#restore-file');
    if (!file) return;
    let payload;
    try { payload = JSON.parse(await file.text()); } catch (e) { toast('הקובץ אינו קובץ JSON תקין.', 'error'); if (input) input.value = ''; return; }
    if (!payload || payload.app !== 'house-committee-faults' || payload.version !== 2 || !Array.isArray(payload.tickets)) {
      toast('הקובץ אינו קובץ גיבוי של מערכת זו.', 'error');
      if (input) input.value = '';
      return;
    }
    const ok = await confirmDialog(`לשחזר ${payload.tickets.length} קריאות מגיבוי של "${payload.building?.name || ''}" מתאריך ${fmtDateTime(payload.exportedAt)}?\nכל הקריאות, הרשימות והספקים הנוכחיים של הבניין יוחלפו.`, { title: 'שחזור מגיבוי', okLabel: 'שחזור', danger: true });
    if (!ok) { if (input) input.value = ''; return; }
    toast('משחזר נתונים…', 'info');
    await attempt(async () => {
      const res = await api('POST', '/api/building/backup', payload);
      state.settings = await api('GET', '/api/settings');
      await reloadAndGo(`הנתונים שוחזרו (${res.tickets} קריאות).`);
    });
  }

  /* ======================================================================
   * Export (CSV), WhatsApp text, print
   * ==================================================================== */

  function exportCsv(list, name) {
    if (!list.length) { toast('אין קריאות לייצוא.', 'error'); return; }
    const headers = ['מספר קריאה', 'כותרת', 'תיאור', 'קטגוריה', 'מיקום', 'עדיפות', 'סטטוס', 'שם המדווח', 'טלפון המדווח', 'אופן דיווח',
      'אחראי', 'תאריך דיווח', 'עדכון אחרון', 'תאריך פתרון', 'ימים פתוחה', 'נפתחה תקלה אצל גורם חיצוני', 'חברה / ספק',
      'מספר קריאה אצל הספק', 'איש מקצוע', 'טלפון איש מקצוע', 'תאריך הפנייה', 'מועד הגעה צפוי', 'מצב מועד', 'מספר עדכונים', 'עדכון אחרון (תוכן)'];
    const rows = list.map((t) => {
      const ex = t.external;
      const last = t.updates.find((u) => u.text);
      const due = dueState(t);
      return [t.number, t.title, t.description, catName(t.categoryId), locationText(t, true), priorityOf(t.priority).label, statusOf(t.status).label,
        t.reporter.name, t.reporter.phone, channelLabel(t.reporter.channel), t.responsibleId ? responsibleText(t) : '',
        fmtDateTime(t.createdAt), fmtDateTime(t.updatedAt), t.resolvedAt ? fmtDate(t.resolvedAt) : '', daysOpen(t),
        ex.opened ? 'כן' : 'לא', ex.opened ? ex.company : '', ex.opened ? ex.refNo : '', ex.opened ? ex.contactName : '',
        ex.opened ? ex.contactPhone : '', ex.opened && ex.referredAt ? fmtDate(ex.referredAt) : '',
        ex.opened && ex.expectedAt ? fmtDate(ex.expectedAt) : '', due === 'overdue' ? 'באיחור' : due === 'upcoming' ? 'מתקרב' : '',
        t.updates.length, last ? last.text : ''];
    });
    const cell = (v) => {
      const s = String(v ?? '').replace(/\r?\n/g, ' ');
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const csv = '﻿' + [headers, ...rows].map((r) => r.map(cell).join(',')).join('\r\n');
    downloadBlob(new Blob([csv], { type: 'text/csv;charset=utf-8' }), `${name}-${toDateInput(new Date())}.csv`);
    toast(`יוצאו ${list.length} קריאות לקובץ CSV (נפתח ב-Excel).`, 'success');
  }

  function whatsappText(t) {
    const ex = t.external;
    const lines = [
      `*עדכון תקלה #${t.number} – ${t.title}*`,
      `📍 מיקום: ${locationText(t, true)}`,
      `📌 סטטוס: ${statusOf(t.status).label}`,
      `⚡ עדיפות: ${priorityOf(t.priority).label}`,
      `👤 אחראי/ת מטעם הוועד: ${t.responsibleId ? responsibleText(t) : 'טרם נקבע'}`,
    ];
    if (ex.opened) {
      lines.push(`🛠 גורם מטפל: ${ex.company || 'גורם חיצוני'}${ex.refNo ? ` (קריאה ${ex.refNo})` : ''}`);
      if (ex.expectedAt) lines.push(`📅 מועד הגעה צפוי: ${fmtDate(ex.expectedAt)}${dueState(t) === 'overdue' ? ' ⚠️ המועד עבר, הוועד מטפל מול הספק' : ''}`);
    }
    const last = t.updates.find((u) => u.text);
    if (last) lines.push(`📝 עדכון אחרון (${fmtDate(last.at)}): ${last.text}`);
    lines.push('', `ועד הבית – ${state.building.name}`);
    return lines.join('\n');
  }

  async function showWhatsApp(t) {
    const text = whatsappText(t);
    const { modal } = openModal({
      title: 'טקסט לקבוצת הוואטסאפ',
      body: `
        <p class="muted" id="wa-status" role="status">מעתיק ללוח…</p>
        <label for="wa-text" class="visually-hidden">טקסט ההודעה</label>
        <textarea id="wa-text" class="wa-text" rows="10" readonly>${esc(text)}</textarea>
        <a class="link-small" href="https://wa.me/?text=${encodeURIComponent(text)}" target="_blank" rel="noopener">פתיחה באפליקציית וואטסאפ ↗</a>`,
      actions: [
        { label: 'העתקה שוב', className: 'btn-whatsapp', onClick: async () => { const ok = await copyWithTimeout(text); toast(ok ? 'הטקסט הועתק.' : 'ההעתקה נכשלה – יש לסמן ולהעתיק ידנית.', ok ? 'success' : 'error'); return false; } },
        { label: 'סגירה' },
      ],
      initialFocus: '#wa-text',
    });
    const copied = await copyWithTimeout(text);
    const status = $('#wa-status', modal);
    if (!status) return;
    status.className = copied ? 'copy-ok' : 'muted';
    status.textContent = copied ? '✔ הטקסט הועתק ללוח – אפשר להדביק בקבוצת הדיירים.' : 'לא ניתן היה להעתיק אוטומטית – יש לסמן את הטקסט ולהעתיק ידנית (Ctrl+C).';
  }

  async function printTicket(t) {
    const ex = t.external;
    const images = t.media.concat(...t.updates.map((u) => u.media)).filter((m) => m.type.startsWith('image/'));
    const resp = member(t.responsibleId);
    const row = (k, v) => `<tr><th>${k}</th><td>${v}</td></tr>`;
    const area = $('#print-area');
    area.innerHTML = `
      <article class="print-ticket">
        <header class="print-header">
          <div>
            <p class="print-org">ועד הבית – ${esc(state.building.name)} · סיכום קריאה</p>
            <h1>קריאה #${t.number}: ${esc(t.title)}</h1>
          </div>
          <p class="print-date">הופק ב-${fmtDateTime(new Date())}</p>
        </header>
        <table class="print-table">
          ${row('סטטוס', esc(statusOf(t.status).label))}
          ${row('עדיפות', esc(priorityOf(t.priority).label))}
          ${row('קטגוריה', esc(catName(t.categoryId)))}
          ${row('מיקום', esc(locationText(t)))}
          ${row('מדווח/ת', esc([t.reporter.name, t.reporter.phone].filter(Boolean).join(' · ') || '—') + ' (' + esc(channelLabel(t.reporter.channel)) + ')')}
          ${row('אחראי/ת', t.responsibleId ? esc(responsibleText(t) + (resp && resp.phone ? ' · ' + resp.phone : '')) : '—')}
          ${row('תאריך דיווח', fmtDateTime(t.createdAt))}
          ${row('עדכון אחרון', fmtDateTime(t.updatedAt))}
          ${row('תאריך פתרון', t.resolvedAt ? fmtDateTime(t.resolvedAt) : '—')}
          ${row('ימים פתוחה', daysOpen(t))}
        </table>
        <h2>תיאור התקלה</h2>
        <p>${t.description ? nl2br(t.description) : '—'}</p>
        <h2>טיפול חיצוני</h2>
        ${ex.opened ? `<table class="print-table">
          ${row('חברה / ספק', esc(ex.company || '—'))}
          ${row('מספר קריאה אצל הספק', esc(ex.refNo || '—'))}
          ${row('איש מקצוע', esc([ex.contactName, ex.contactPhone].filter(Boolean).join(' · ') || '—'))}
          ${row('תאריך הפנייה', fmtDate(ex.referredAt))}
          ${row('מועד הגעה צפוי', fmtDate(ex.expectedAt) + (dueState(t) ? ' – ' + esc(dueText(t)) : ''))}
        </table>` : '<p>לא נפתחה תקלה אצל גורם חיצוני.</p>'}
        <h2>עדכונים (${t.updates.length})</h2>
        ${t.updates.length ? `<ol class="print-updates">${t.updates.map((u) => `<li><strong>${fmtDateTime(u.at)} · ${esc(u.authorName || 'ללא שם')}</strong>
          ${u.statusTo ? `<br><em>הסטטוס שונה מ"${esc(statusOf(u.statusFrom).label)}" ל"${esc(statusOf(u.statusTo).label)}"</em>` : ''}
          ${u.text ? `<br>${nl2br(u.text)}` : ''}</li>`).join('')}</ol>` : '<p>אין עדכונים.</p>'}
        ${images.length ? `<h2>תמונות</h2><div class="print-images">${images.map((i) => `<img src="${esc(i.url)}" alt="${esc(i.name)}">`).join('')}</div>` : ''}
      </article>`;
    await Promise.all($$('img', area).map((img) => (img.complete ? null : new Promise((r) => { img.onload = img.onerror = r; setTimeout(r, 2000); }))));
    document.body.classList.add('printing');
    window.print();
  }

  window.addEventListener('afterprint', () => {
    document.body.classList.remove('printing');
    $('#print-area').innerHTML = '';
  });

  /* ======================================================================
   * Startup, navigation, keyboard shortcuts, refresh on focus
   * ==================================================================== */

  function initGlobalHandlers() {
    // Internal links navigate without a page reload
    document.addEventListener('click', (e) => {
      const a = e.target.closest('a[href]');
      if (!a || a.target || a.hasAttribute('download') || e.defaultPrevented || e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return;
      const url = new URL(a.href, location.href);
      if (url.origin !== location.origin || !APP_PATH.test(url.pathname)) return;
      e.preventDefault();
      if (url.pathname !== location.pathname) navigate(url.pathname);
    });
    window.addEventListener('popstate', route);

    $('#building-select').addEventListener('change', (e) => switchBuilding(Number(e.target.value)));
    $('#logout-btn').addEventListener('click', async () => {
      try { await fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin' }); } catch (e) { /* ignore */ }
      try { sessionStorage.removeItem(BUILDING_KEY); } catch (e) { /* ignore */ }
      location.replace('/');
    });

    document.addEventListener('keydown', (e) => {
      if (e.ctrlKey || e.metaKey || e.altKey || document.body.classList.contains('modal-open') || !state.building) return;
      const tag = (e.target.tagName || '').toLowerCase();
      if (['input', 'textarea', 'select'].includes(tag) || e.target.isContentEditable) return;
      if (e.code === 'KeyN') { e.preventDefault(); navigate('/tickets/new'); }
      if (e.code === 'Slash') {
        e.preventDefault();
        if (!$('#f-q')) navigate('/dashboard');
        const s = $('#f-q');
        if (s) s.focus();
      }
    });

    // Other committee members may have changed things: refresh when the tab regains focus
    // (not while a form is open, so nothing typed is lost).
    window.addEventListener('focus', async () => {
      if (!state.building || Date.now() - state.loadedAt < 30000) return;
      if (['new', 'edit', 'settings', 'contract-new', 'contract-edit', 'bank'].includes(currentView) || document.body.classList.contains('modal-open')) return;
      if (appEl.contains(document.activeElement) && ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName)) return;
      try {
        await loadData();
        if (currentView === 'ticket') {
          const text = $('#u-text');
          if (text && text.value.trim()) return; // an update is being typed
        }
        rerender();
      } catch (e) { /* offline – keep showing what we have */ }
    });
  }

  async function init() {
    appEl = $('#app');
    initGlobalHandlers();
    await loadSession();
    await loadData();
    renderHeader();
    route();
  }

  document.addEventListener('DOMContentLoaded', () => {
    init().catch((err) => {
      console.error(err);
      $('#app').innerHTML = `<div class="alert alert-danger" role="alert">אירעה שגיאה בטעינת המערכת: ${esc(err.message)}. נסו לרענן את הדף.</div>`;
    });
  });
})();
