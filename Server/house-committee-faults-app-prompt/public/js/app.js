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
    mp4: 'video/mp4', mov: 'video/quicktime', webm: 'video/webm',
  };
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
    const [settings, t] = await Promise.all([api('GET', '/api/settings'), api('GET', '/api/tickets')]);
    state.settings = settings;
    state.tickets = t.tickets;
    state.loadedAt = Date.now();
  }

  function replaceTicket(t) {
    const i = state.tickets.findIndex((x) => x.id === t.id);
    if (i >= 0) state.tickets[i] = t; else state.tickets.unshift(t);
    return t;
  }

  /** Upload files one by one; returns how many succeeded. */
  async function uploadFiles(ticketId, files, updateId = null) {
    let ok = 0;
    for (const f of files) {
      const type = f.type || EXT_MIME[extOf(f.name)] || 'application/octet-stream';
      const url = `/api/tickets/${ticketId}/media${updateId ? `?updateId=${updateId}` : ''}`;
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

  function filePickerHtml(id) {
    return `
      <div class="file-picker" id="${id}">
        <label class="file-drop">
          <input type="file" multiple class="file-input" accept=".jpg,.jpeg,.png,.gif,.webp,.mp4,.mov,.webm,image/jpeg,image/png,image/gif,image/webp,video/mp4,video/quicktime,video/webm">
          <span class="file-drop-title">📎 צירוף תמונות או סרטונים</span>
          <span class="file-drop-sub">לחיצה לבחירה או גרירת קבצים לכאן · jpg, png, gif, webp, mp4, mov, webm</span>
        </label>
        <ul class="file-previews" aria-label="קבצים שנבחרו"></ul>
      </div>`;
  }

  function bindFilePicker(root) {
    const input = $('.file-input', root);
    const list = $('.file-previews', root);
    const drop = $('.file-drop', root);
    let items = [];
    let seq = 0;

    function render() {
      list.innerHTML = items.map((it) => `
        <li class="file-chip">
          ${/^(mp4|mov|webm)$/.test(extOf(it.file.name)) ? '<span class="file-chip-icon" aria-hidden="true">🎬</span>' : `<img src="${it.url}" alt="" class="file-chip-thumb">`}
          <span class="file-chip-name" dir="auto">${esc(it.file.name)}</span>
          <span class="file-chip-size">${fmtSize(it.file.size)}</span>
          <button type="button" class="icon-btn" data-remove="${it.id}" aria-label="${esc('הסרת הקובץ ' + it.file.name)}">✕</button>
        </li>`).join('');
    }
    function add(fileList) {
      for (const f of Array.from(fileList || [])) {
        if (!ALLOWED_EXT.includes(extOf(f.name))) { toast(`סוג הקובץ "${f.name}" אינו נתמך.`, 'error'); continue; }
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

  const APP_PATH = /^\/(dashboard|table|calendar|stats|settings|tickets\/(new|\d+(\/edit)?))\/?$/;

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
    currentView = view === 'tickets' ? (parts[1] === 'new' ? 'new' : parts[2] === 'edit' ? 'edit' : 'ticket') : view;
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
  let calMode = 'expected'; // 'expected' | 'created'

  function calendarEvents() {
    return state.tickets.flatMap((t) => {
      if (calMode === 'expected') {
        if (!t.external.opened || !t.external.expectedAt) return [];
        return [{ t, date: t.external.expectedAt, draggable: isOpen(t) }];
      }
      return [{ t, date: toDateInput(new Date(t.createdAt)), draggable: false }];
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

    const chip = (ev) => {
      const due = calMode === 'expected' ? dueState(ev.t) : null;
      return `<a href="/tickets/${ev.t.id}" class="cal-chip ${due ? 'cal-' + due : ''} ${isOpen(ev.t) ? '' : 'cal-done'} chip-pr-${ev.t.priority}"
        ${ev.draggable ? `draggable="true" data-drag-id="${ev.t.id}"` : ''}
        title="${esc(`#${ev.t.number} ${ev.t.title} · ${statusOf(ev.t.status).label}${ev.t.external.company && calMode === 'expected' ? ' · ' + ev.t.external.company : ''}`)}">
        <span class="cal-chip-num">#${ev.t.number}</span> ${esc(ev.t.title)}</a>`;
    };

    const monthEvents = events.filter((ev) => {
      const d = parseDate(ev.date);
      return d.getFullYear() === calMonth.getFullYear() && d.getMonth() === calMonth.getMonth();
    }).sort((a, b) => a.date.localeCompare(b.date) || a.t.number - b.t.number);

    setView(`
      <div class="page-head">
        <div>
          <h1>לוח שנה</h1>
          <p class="muted">${calMode === 'expected'
            ? 'מועדי ההגעה שהבטיחו הגורמים החיצוניים. גררו קריאה פתוחה ליום אחר כדי לעדכן את המועד.'
            : 'הקריאות לפי תאריך הדיווח.'}</p>
        </div>
        <div class="segmented" role="radiogroup" aria-label="מה להציג בלוח">
          <button type="button" class="segmented-btn ${calMode === 'expected' ? 'is-active' : ''}" role="radio" aria-checked="${calMode === 'expected'}" data-mode="expected">מועדי הגעה</button>
          <button type="button" class="segmented-btn ${calMode === 'created' ? 'is-active' : ''}" role="radio" aria-checked="${calMode === 'created'}" data-mode="created">תאריכי דיווח</button>
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
                aria-label="${esc(dfWeekdayLong.format(d) + (evs.length ? `, ${evs.length} קריאות` : ''))}">
              <span class="cal-date" aria-hidden="true">${d.getDate()}</span>
              <div class="cal-events">${evs.slice(0, 3).map(chip).join('')}${evs.length > 3 ? `<span class="cal-more">+${evs.length - 3} נוספות</span>` : ''}</div>
            </div>`;
          }).join('')}</div>`).join('')}
        </div>
        <p class="cal-legend"><span class="cal-chip cal-overdue">באיחור</span> <span class="cal-chip cal-upcoming">מתקרב</span> <span class="cal-chip">מתוכנן</span> <span class="cal-chip cal-done">טופל / סגור</span></p>
      </section>

      <section class="card" aria-labelledby="agenda-h">
        <h2 id="agenda-h">${calMode === 'expected' ? 'הגעות צפויות' : 'דיווחים'} ב${esc(dfMonthShort.format(calMonth))} <span class="count">${monthEvents.length}</span></h2>
        ${monthEvents.length ? `<ul class="agenda">${monthEvents.map((ev) => `
          <li><time datetime="${ev.date}">${esc(dfWeekdayLong.format(parseDate(ev.date)))}</time>
            <a href="/tickets/${ev.t.id}">#${ev.t.number} – ${esc(ev.t.title)}</a>
            ${statusBadge(ev.t.status)} ${calMode === 'expected' ? dueBadge(ev.t) : ''}
            ${calMode === 'expected' && ev.t.external.company ? `<span class="muted">${esc(ev.t.external.company)}</span>` : ''}</li>`).join('')}</ul>`
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
              <p class="muted">טעינת 10 קריאות לדוגמה במקום הקריאות הקיימות.</p>
              <button type="button" class="btn btn-secondary" data-action="restore-demo">טעינת נתוני הדגמה</button>
            </div>
            <div>
              <h3>התחלה מאפס</h3>
              <p class="muted">מחיקת כל הקריאות והקבצים של הבניין. הרשימות והספקים נשמרים.</p>
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
   * Data operations: wipe, demo, delete building, backup, restore
   * ==================================================================== */

  async function reloadAndGo(msg) {
    await loadData();
    filters = Object.assign({}, DEFAULT_FILTERS);
    toast(msg, 'success');
    if (location.pathname === '/dashboard') rerender(); else navigate('/dashboard');
  }

  async function wipeAllData() {
    const ok = await confirmDialog(`פעולה זו תמחק את כל הקריאות, העדכונים והקבצים של הבניין "${state.building.name}" – אצל כל חברי הוועד.\nהרשימות והספקים יישמרו. מומלץ לבצע גיבוי לפני כן.\n\nלהמשיך?`, { title: 'מחיקת כל הנתונים', okLabel: 'כן, למחוק הכל', danger: true });
    if (!ok) return;
    await attempt(async () => {
      await api('DELETE', '/api/building/tickets');
      await reloadAndGo('כל הקריאות נמחקו. אפשר להתחיל מחדש.');
    });
  }

  async function restoreDemo() {
    if (state.tickets.length) {
      const ok = await confirmDialog('טעינת נתוני ההדגמה תחליף את כל הקריאות הקיימות בבניין (אצל כל חברי הוועד). להמשיך?', { okLabel: 'טעינת נתוני הדגמה', danger: true });
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
      if (['new', 'edit', 'settings'].includes(currentView) || document.body.classList.contains('modal-open')) return;
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
