/**
 * House Committee Fault Management – single-page application.
 *
 * Storage:
 *   - localStorage: tickets, settings lists, ticket counter (key STORAGE_KEY).
 *   - IndexedDB:    media attachments (images / videos) as Blobs.
 *
 * Runs directly from index.html (file://) with no build step and no network.
 * Routing is hash based: #/dashboard, #/ticket/<id>, #/new, #/edit/<id>, #/stats, #/settings
 */
(function () {
  'use strict';

  /* ======================================================================
   * Constants
   * ==================================================================== */

  const STORAGE_KEY = 'hcf.data.v1';
  const A11Y_KEY = 'hcf.a11y.v1';
  const DB_NAME = 'hcf-media';
  const DB_STORE = 'files';
  const DAY = 864e5;
  const MAX_FILE_MB = 200;
  const ALLOWED_EXT = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'mp4', 'mov', 'webm'];
  const EXT_MIME = {
    jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp',
    mp4: 'video/mp4', mov: 'video/quicktime', webm: 'video/webm', svg: 'image/svg+xml'
  };

  const STATUSES = [
    { id: 'new', label: 'חדשה', color: '#1d4ed8' },
    { id: 'in_progress', label: 'בטיפול', color: '#7c3aed' },
    { id: 'waiting_vendor', label: 'ממתינה לגורם חיצוני', color: '#c2410c' },
    { id: 'waiting_parts', label: 'ממתינה לחלקים', color: '#a16207' },
    { id: 'resolved', label: 'טופלה', color: '#15803d' },
    { id: 'closed', label: 'סגורה', color: '#475569' },
    { id: 'cancelled', label: 'בוטלה', color: '#9ca3af' }
  ];
  const OPEN_STATUSES = new Set(['new', 'in_progress', 'waiting_vendor', 'waiting_parts']);
  const DONE_STATUSES = new Set(['resolved', 'closed']);

  const PRIORITIES = [
    { id: 'low', label: 'נמוכה', rank: 1, color: '#15803d' },
    { id: 'medium', label: 'בינונית', rank: 2, color: '#1d4ed8' },
    { id: 'high', label: 'גבוהה', rank: 3, color: '#c2410c' },
    { id: 'urgent', label: 'דחופה', rank: 4, color: '#b91c1c' }
  ];

  const CHANNELS = [
    { id: 'whatsapp', label: 'וואטסאפ' },
    { id: 'phone', label: 'שיחת טלפון' },
    { id: 'in_person', label: 'פנים אל פנים' },
    { id: 'committee', label: 'חבר ועד' }
  ];

  // Areas that are building-wide: matching them for the recurring-fault hint ignores the floor.
  const WIDE_AREAS = new Set(['ar_elevator', 'ar_lobby', 'ar_roof', 'ar_yard']);

  /* ======================================================================
   * Generic utilities
   * ==================================================================== */

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  /** Escape a value for safe insertion into HTML. */
  function esc(v) {
    return String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  /** Escaped text with line breaks preserved. */
  function nl2br(v) { return esc(v).replace(/\n/g, '<br>'); }

  function uid(prefix = 'id') {
    return prefix + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  /** Parse an ISO timestamp or a YYYY-MM-DD date (as local midnight). */
  function parseDate(v) {
    if (!v) return null;
    if (v instanceof Date) return isNaN(v) ? null : v;
    if (/^\d{4}-\d{2}-\d{2}$/.test(v)) {
      const [y, m, d] = v.split('-').map(Number);
      return new Date(y, m - 1, d);
    }
    const d = new Date(v);
    return isNaN(d) ? null : d;
  }

  function startOfDay(d) { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; }

  function toDateInput(d) {
    const x = new Date(d);
    return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
  }

  /** Whole days from date a to date b (calendar days, local time). */
  function daysBetween(a, b) { return Math.round((startOfDay(b) - startOfDay(a)) / DAY); }

  const dfDate = new Intl.DateTimeFormat('he-IL', { day: '2-digit', month: '2-digit', year: 'numeric' });
  const dfTime = new Intl.DateTimeFormat('he-IL', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  const dfMonth = new Intl.DateTimeFormat('he-IL', { month: 'short' });
  const nfNum = new Intl.NumberFormat('he-IL', { maximumFractionDigits: 1 });

  /** DD/MM/YYYY using the he-IL locale parts (guarantees slashes across browsers). */
  function fmtDate(v) {
    const d = parseDate(v);
    if (!d) return '—';
    const p = {};
    dfDate.formatToParts(d).forEach(x => { p[x.type] = x.value; });
    return `${p.day}/${p.month}/${p.year}`;
  }
  function fmtTime(v) { const d = parseDate(v); return d ? dfTime.format(d) : ''; }
  function fmtDateTime(v) { const d = parseDate(v); return d ? `${fmtDate(d)} ${fmtTime(d)}` : '—'; }

  function fmtSize(bytes) {
    if (!bytes) return '0 KB';
    if (bytes < 1048576) return nfNum.format(bytes / 1024) + ' KB';
    return nfNum.format(bytes / 1048576) + ' MB';
  }

  /** Wrap negative numbers (e.g. "קומה -2") in an LTR isolate so the minus sign renders correctly in RTL. */
  function bidiFix(text) {
    return String(text ?? '').replace(/(^|\s)(-\d+)/g, '$1⁦$2⁩');
  }

  /** Tappable phone link (tel:), always rendered LTR. */
  function telLink(phone, cls = 'tel') {
    if (!phone) return '—';
    const clean = String(phone).replace(/[^\d+]/g, '');
    return `<a href="tel:${esc(clean)}" class="${cls}" dir="ltr">${esc(phone)}</a>`;
  }

  function extOf(name) { return (String(name).split('.').pop() || '').toLowerCase(); }

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

  function blobToBase64(blob) {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result).split(',')[1] || '');
      r.onerror = () => reject(r.error);
      r.readAsDataURL(blob);
    });
  }

  function base64ToBlob(b64, type) {
    const bin = atob(b64);
    const arr = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    return new Blob([arr], { type });
  }

  async function copyText(text) {
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(text);
        return true;
      }
    } catch (e) { /* fall back to execCommand below */ }
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

  /* ======================================================================
   * Persistent data (localStorage)
   * ==================================================================== */

  function defaultSettings(withPeople) {
    const floors = [
      { id: 'fl_m2', name: 'קומה -2' }, { id: 'fl_m1', name: 'קומה -1' }, { id: 'fl_0', name: 'קומת קרקע' }
    ];
    for (let i = 1; i <= 8; i++) floors.push({ id: 'fl_' + i, name: 'קומה ' + i });
    return {
      categories: [
        { id: 'cat_elevator', name: 'מעלית' }, { id: 'cat_plumbing', name: 'אינסטלציה' },
        { id: 'cat_electric', name: 'חשמל' }, { id: 'cat_intercom', name: 'אינטרקום' },
        { id: 'cat_lighting', name: 'תאורה' }, { id: 'cat_cleaning', name: 'ניקיון' },
        { id: 'cat_safety', name: 'בטיחות' }, { id: 'cat_garden', name: 'גינה' },
        { id: 'cat_parking', name: 'חניה' }, { id: 'cat_other', name: 'אחר' }
      ],
      floors,
      areas: [
        { id: 'ar_lobby', name: 'לובי' }, { id: 'ar_stairs', name: 'חדר מדרגות' },
        { id: 'ar_elevator', name: 'מעלית' }, { id: 'ar_roof', name: 'גג' },
        { id: 'ar_parking', name: 'חניה' }, { id: 'ar_apartment', name: 'דירה' },
        { id: 'ar_yard', name: 'חצר וגינה' }, { id: 'ar_other', name: 'אחר' }
      ],
      members: withPeople ? [
        { id: 'm1', name: 'רונית כהן', phone: '052-3456789' },
        { id: 'm2', name: 'אבי מזרחי', phone: '054-1122334' },
        { id: 'm3', name: 'דנה פרץ', phone: '050-9988776' }
      ] : [],
      vendors: withPeople ? [
        { id: 'v1', company: 'מעליות השרון בע״מ', contact: 'יוסי לוי', phone: '050-7771234', specialty: 'מעליות' },
        { id: 'v2', company: 'אינסטלציה גולן', contact: 'משה גולן', phone: '052-6665432', specialty: 'אינסטלציה' },
        { id: 'v3', company: 'קשר-טק מערכות אינטרקום', contact: 'אלון ברק', phone: '053-4443210', specialty: 'אינטרקום ובקרת כניסה' },
        { id: 'v4', company: 'חשמל הצפון', contact: 'סאמר חורי', phone: '054-2223344', specialty: 'חשמל' },
        { id: 'v5', company: 'גנני העמק', contact: 'רחל אדלר', phone: '058-1110099', specialty: 'גינון והשקיה' }
      ] : []
    };
  }

  function emptyData(settings) {
    return { version: 1, nextNumber: 1001, tickets: [], settings: settings || defaultSettings(false) };
  }

  function emptyExternal() {
    return { opened: false, vendorId: '', company: '', refNo: '', contactName: '', contactPhone: '', referredAt: '', expectedAt: '' };
  }

  /** Build a ticket object with every field present. */
  function makeTicket(o = {}) {
    return Object.assign({
      id: uid('t'), number: 0, title: '', description: '', category: '', floor: '', area: '', apartment: '',
      priority: 'medium', status: 'new', statusHistory: [],
      reporter: { name: '', phone: '', channel: 'whatsapp' },
      responsibleId: '', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), resolvedAt: null,
      media: [], updates: [], external: emptyExternal()
    }, o);
  }

  const Store = {
    data: null,
    persistent: true,

    /** Returns true if saved data was found. */
    load() {
      try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (raw) {
          this.data = this.normalize(JSON.parse(raw));
          return true;
        }
      } catch (e) {
        this.persistent = false;
        console.warn('localStorage unavailable:', e);
      }
      return false;
    },

    save() {
      if (!this.persistent) return;
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(this.data));
      } catch (e) {
        console.error(e);
        toast('שמירת הנתונים נכשלה – ייתכן שנפח האחסון בדפדפן מלא.', 'error');
      }
    },

    /** Make sure an imported/loaded object has the full expected shape. */
    normalize(d) {
      const base = emptyData(defaultSettings(false));
      const out = Object.assign(base, d || {});
      out.settings = Object.assign(defaultSettings(false), (d && d.settings) || {});
      ['categories', 'floors', 'areas', 'members', 'vendors'].forEach(k => {
        if (!Array.isArray(out.settings[k])) out.settings[k] = [];
      });
      out.tickets = (Array.isArray(out.tickets) ? out.tickets : []).map(t => {
        const nt = makeTicket(t);
        nt.reporter = Object.assign({ name: '', phone: '', channel: 'whatsapp' }, t.reporter || {});
        nt.external = Object.assign(emptyExternal(), t.external || {});
        nt.media = Array.isArray(t.media) ? t.media : [];
        nt.updates = (Array.isArray(t.updates) ? t.updates : []).map(u => Object.assign({ id: uid('u'), at: nt.createdAt, authorId: '', text: '', media: [] }, u));
        nt.statusHistory = Array.isArray(t.statusHistory) ? t.statusHistory : [];
        return nt;
      });
      const maxNum = out.tickets.reduce((m, t) => Math.max(m, Number(t.number) || 0), 1000);
      out.nextNumber = Math.max(Number(out.nextNumber) || 1001, maxNum + 1);
      return out;
    }
  };

  const S = () => Store.data.settings;
  const tickets = () => Store.data.tickets;

  /* ======================================================================
   * Media storage (IndexedDB)
   * ==================================================================== */

  const MediaDB = {
    db: null,
    available: false,

    async init() {
      if (!('indexedDB' in window)) return;
      try {
        this.db = await new Promise((resolve, reject) => {
          const req = indexedDB.open(DB_NAME, 1);
          req.onupgradeneeded = () => {
            if (!req.result.objectStoreNames.contains(DB_STORE)) req.result.createObjectStore(DB_STORE, { keyPath: 'id' });
          };
          req.onsuccess = () => resolve(req.result);
          req.onerror = () => reject(req.error);
          req.onblocked = () => reject(new Error('IndexedDB blocked'));
        });
        this.available = true;
      } catch (e) {
        console.warn('IndexedDB unavailable:', e);
      }
    },

    /** Run a single request inside a transaction and resolve with its result once committed. */
    run(mode, fn) {
      return new Promise((resolve, reject) => {
        if (!this.db) { reject(new Error('IndexedDB not available')); return; }
        const tx = this.db.transaction(DB_STORE, mode);
        const req = fn(tx.objectStore(DB_STORE));
        tx.oncomplete = () => resolve(req ? req.result : undefined);
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
      });
    },
    put(rec) { return this.run('readwrite', st => st.put(rec)); },
    get(id) { return this.run('readonly', st => st.get(id)); },
    del(id) { return this.run('readwrite', st => st.delete(id)); },
    clear() { return this.run('readwrite', st => st.clear()); },
    all() { return this.run('readonly', st => st.getAll()); }
  };

  // Cache of object URLs for media already loaded this session: id -> { url, type, name }
  const mediaCache = new Map();

  async function getMediaInfo(id) {
    if (mediaCache.has(id)) return mediaCache.get(id);
    let rec = null;
    try { rec = await MediaDB.get(id); } catch (e) { rec = null; }
    if (!rec || !rec.blob) return null;
    const info = { url: URL.createObjectURL(rec.blob), type: rec.type || rec.blob.type || '', name: rec.name || 'קובץ', size: rec.size };
    mediaCache.set(id, info);
    return info;
  }

  function forgetMedia(id) {
    const info = mediaCache.get(id);
    if (info) URL.revokeObjectURL(info.url);
    mediaCache.delete(id);
  }

  function forgetAllMedia() { Array.from(mediaCache.keys()).forEach(forgetMedia); }

  /** Store user-selected File objects in IndexedDB; returns the new media ids. */
  async function storeFiles(files) {
    if (!files.length) return [];
    if (!MediaDB.available) {
      toast('לא ניתן לשמור קבצים: אחסון IndexedDB אינו זמין בדפדפן זה.', 'error');
      return [];
    }
    const ids = [];
    for (const f of files) {
      const id = uid('m');
      try {
        await MediaDB.put({
          id, name: f.name, type: f.type || EXT_MIME[extOf(f.name)] || 'application/octet-stream',
          size: f.size, blob: f, createdAt: new Date().toISOString()
        });
        ids.push(id);
      } catch (e) {
        console.error(e);
        toast(`שמירת הקובץ "${f.name}" נכשלה.`, 'error');
      }
    }
    return ids;
  }

  async function deleteMediaIds(ids) {
    for (const id of ids) {
      forgetMedia(id);
      try { await MediaDB.del(id); } catch (e) { /* already gone */ }
    }
  }

  function allMediaIds(t) {
    return t.media.concat(...t.updates.map(u => u.media || []));
  }

  /* ======================================================================
   * Demo data
   * ==================================================================== */

  function placeholderSvg(title, color) {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600" viewBox="0 0 800 600">
<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${color}"/><stop offset="1" stop-color="#0a1f3d"/></linearGradient></defs>
<rect width="800" height="600" fill="url(#g)"/>
<g fill="none" stroke="#fff" stroke-opacity=".55" stroke-width="10" stroke-linejoin="round">
<rect x="290" y="170" width="220" height="160" rx="18"/><circle cx="400" cy="250" r="48"/><path d="M335 170l20-28h90l20 28"/></g>
<text x="400" y="420" font-family="Segoe UI, Arial, sans-serif" font-size="42" font-weight="700" fill="#fff" text-anchor="middle" direction="rtl">${esc(title)}</text>
<text x="400" y="470" font-family="Segoe UI, Arial, sans-serif" font-size="26" fill="#fff" fill-opacity=".8" text-anchor="middle" direction="rtl">תמונה לדוגמה</text>
</svg>`;
  }

  /** Replace everything with realistic sample data (10 tickets). */
  async function seedDemo() {
    if (MediaDB.available) { try { await MediaDB.clear(); } catch (e) { /* ignore */ } }
    forgetAllMedia();

    const now = Date.now();
    const at = (days, hours = 0) => new Date(now - days * DAY - hours * 3600e3).toISOString();
    const dOff = days => { const d = new Date(); d.setDate(d.getDate() + days); return toDateInput(d); };
    const img = async (title, color) => {
      if (!MediaDB.available) return [];
      try {
        const id = uid('m');
        const blob = new Blob([placeholderSvg(title, color)], { type: 'image/svg+xml' });
        await MediaDB.put({ id, name: title + '.svg', type: 'image/svg+xml', size: blob.size, blob, createdAt: new Date().toISOString() });
        return [id];
      } catch (e) { return []; }
    };
    const hist = (list, by) => list.map(([status, d, h]) => ({ status, at: at(d, h || 0), by }));
    const upd = (d, h, authorId, text, media = []) => ({ id: uid('u'), at: at(d, h), authorId, text, media });
    const ext = o => Object.assign(emptyExternal(), { opened: true }, o);

    const list = [
      makeTicket({
        number: 1001, title: 'רעש חריג וחריקות במעלית',
        description: 'דיירים מדווחים על חריקות חזקות בזמן תנועת המעלית, בעיקר בין הקומות 2 ל-4.',
        category: 'cat_elevator', floor: 'fl_0', area: 'ar_elevator', priority: 'medium', status: 'closed',
        reporter: { name: 'משה אברהם', phone: '050-1234567', channel: 'whatsapp' }, responsibleId: 'm2',
        createdAt: at(150), resolvedAt: at(146),
        statusHistory: hist([['new', 150], ['waiting_vendor', 149], ['resolved', 146], ['closed', 144]], 'm2'),
        external: ext({ vendorId: 'v1', company: 'מעליות השרון בע״מ', refNo: 'SC-31877', contactName: 'יוסי לוי', contactPhone: '050-7771234', referredAt: dOff(-149), expectedAt: dOff(-147) }),
        updates: [
          upd(149, 0, 'm2', 'נפתחה קריאת שירות בחברת המעליות, מספר SC-31877.'),
          upd(146, 0, 'm2', 'הטכנאי החליף גלגלת שחוקה ושימן את המסילות. הרעש נפסק.'),
          upd(144, 0, 'm1', 'נבדק מול הדיירים – אין תלונות נוספות. הקריאה נסגרת.')
        ]
      }),
      makeTicket({
        number: 1002, title: 'המעלית נעצרת בין קומות',
        description: 'דיירת נתקעה במעלית בין קומה 3 לקומה 4 למשך כ-10 דקות. המעלית חזרה לפעול לאחר איפוס.',
        category: 'cat_elevator', floor: 'fl_4', area: 'ar_elevator', priority: 'high', status: 'resolved',
        reporter: { name: 'שרה לוין', phone: '052-7654321', channel: 'phone' }, responsibleId: 'm2',
        createdAt: at(75), resolvedAt: at(72),
        statusHistory: hist([['new', 75], ['waiting_vendor', 75], ['resolved', 72]], 'm2'),
        external: ext({ vendorId: 'v1', company: 'מעליות השרון בע״מ', refNo: 'SC-40552', contactName: 'יוסי לוי', contactPhone: '050-7771234', referredAt: dOff(-75), expectedAt: dOff(-74) }),
        updates: [
          upd(75, 0, 'm2', 'הדיירת חולצה על ידי טכנאי החברה. נפתחה קריאה לבדיקה מקיפה.'),
          upd(72, 0, 'm2', 'הוחלף חיישן דלת בקומה 4. המעלית תקינה.')
        ]
      }),
      makeTicket({
        number: 1003, title: 'הפסקות חשמל חוזרות בלוח קומה 2',
        description: 'בשבוע האחרון קפץ החשמל בחדר המדרגות של קומה 2 שלוש פעמים.',
        category: 'cat_electric', floor: 'fl_2', area: 'ar_stairs', priority: 'high', status: 'cancelled',
        reporter: { name: 'יעקב דהן', phone: '054-3332211', channel: 'in_person' }, responsibleId: 'm3',
        createdAt: at(40),
        statusHistory: hist([['new', 40], ['in_progress', 39], ['cancelled', 38]], 'm3'),
        external: ext({ vendorId: 'v4', company: 'חשמל הצפון', refNo: '', contactName: 'סאמר חורי', contactPhone: '054-2223344', referredAt: dOff(-39), expectedAt: dOff(-39) }),
        updates: [
          upd(39, 0, 'm3', 'החשמלאי בדק את הלוח המשותף – הלוח תקין.'),
          upd(38, 0, 'm3', 'התברר שהתקלה בלוח הפרטי של דירה 7 ובאחריות הדייר. הקריאה בוטלה.')
        ]
      }),
      makeTicket({
        number: 1004, title: 'הלובי לא נוקה במשך שבוע',
        description: 'רצפת הלובי מלוכלכת ופחי האשפה ליד הכניסה מלאים.',
        category: 'cat_cleaning', floor: 'fl_0', area: 'ar_lobby', priority: 'medium', status: 'resolved',
        reporter: { name: 'רחל גבאי', phone: '053-9090901', channel: 'whatsapp' }, responsibleId: 'm1',
        createdAt: at(20), resolvedAt: at(12),
        statusHistory: hist([['new', 20], ['in_progress', 19], ['resolved', 12]], 'm1'),
        updates: [
          upd(19, 0, 'm1', 'שוחחתי עם חברת הניקיון – העובד הקבוע היה בחופשה ולא נשלח מחליף.'),
          upd(12, 0, 'm1', 'הניקיון חזר לסדרו. סוכם על בדיקה שבועית מול החברה.')
        ]
      }),
      makeTicket({
        number: 1005, title: 'שער החניה לא נפתח בשלט',
        description: 'השער החשמלי בכניסה לחניון אינו מגיב לשלטים. דיירים לא יכולים לצאת עם הרכב.',
        category: 'cat_parking', floor: 'fl_m1', area: 'ar_parking', priority: 'urgent', status: 'resolved',
        reporter: { name: 'אורי שמש', phone: '058-4445566', channel: 'phone' }, responsibleId: 'm2',
        createdAt: at(12), resolvedAt: at(9),
        statusHistory: hist([['new', 12], ['waiting_vendor', 12], ['waiting_parts', 11], ['resolved', 9]], 'm2'),
        external: ext({ vendorId: '', company: 'שערים ובקרה מ.ש.', refNo: 'G-2291', contactName: 'מיכאל שושן', contactPhone: '052-1239876', referredAt: dOff(-12), expectedAt: dOff(-10) }),
        updates: [
          upd(12, 0, 'm2', 'השער נפתח ידנית ויישאר פתוח עד לתיקון.'),
          upd(11, 0, 'm2', 'הטכנאי אבחן מנוע שרוף. הוזמן מנוע חלופי.'),
          upd(9, 0, 'm2', 'המנוע הוחלף והשער פועל כרגיל.', await img('שער החניה לאחר התיקון', '#15803d'))
        ]
      }),
      makeTicket({
        number: 1006, title: 'נזילת מים מצנרת בתקרת החניון',
        description: 'מים מטפטפים מהתקרה מעל מקום חניה 14. נראה שמקור הנזילה בצנרת הביוב המשותפת.',
        category: 'cat_plumbing', floor: 'fl_m2', area: 'ar_parking', priority: 'high', status: 'in_progress',
        reporter: { name: 'דוד פרידמן', phone: '050-8887766', channel: 'whatsapp' }, responsibleId: 'm3',
        createdAt: at(6),
        media: await img('נזילה בתקרת החניון', '#0e7490'),
        statusHistory: hist([['new', 6], ['in_progress', 5]], 'm3'),
        external: ext({ vendorId: 'v2', company: 'אינסטלציה גולן', refNo: 'P-118', contactName: 'משה גולן', contactPhone: '052-6665432', referredAt: dOff(-4), expectedAt: dOff(1) }),
        updates: [
          upd(6, 0, 'm3', 'הונח דלי מתחת לנזילה והמקום סומן. בעל מקום החניה עודכן.', await img('דלי מתחת לנזילה', '#1e40af')),
          upd(4, 0, 'm3', 'האינסטלטור ביקר – נדרשת החלפת קטע צנרת. יחזור עם החלקים.')
        ]
      }),
      makeTicket({
        number: 1007, title: 'המעלית תקועה בקומה 3',
        description: 'המעלית עומדת בקומה 3 עם דלתות פתוחות ואינה מגיבה לקריאות. דיירים מבוגרים בקומות העליונות מתקשים.',
        category: 'cat_elevator', floor: 'fl_3', area: 'ar_elevator', priority: 'urgent', status: 'waiting_vendor',
        reporter: { name: 'נועה ברגר', phone: '054-1010101', channel: 'phone' }, responsibleId: 'm2',
        createdAt: at(4),
        media: await img('מעלית – קומה 3', '#b91c1c'),
        statusHistory: hist([['new', 4], ['waiting_vendor', 4]], 'm2'),
        external: ext({ vendorId: 'v1', company: 'מעליות השרון בע״מ', refNo: 'SC-48213', contactName: 'יוסי לוי', contactPhone: '050-7771234', referredAt: dOff(-3), expectedAt: dOff(-1) }),
        updates: [
          upd(3, 0, 'm2', 'נפתחה קריאה בחברת המעליות (SC-48213). הובטח טכנאי תוך יום.'),
          upd(0, 5, 'm2', 'הטכנאי לא הגיע במועד. נשלחה תזכורת למוקד החברה.')
        ]
      }),
      makeTicket({
        number: 1008, title: 'האינטרקום בכניסה הראשית לא מצלצל',
        description: 'לחיצה על כפתורי הדירות בפאנל הכניסה אינה מצלצלת בדירות. הדלת נפתחת רק עם מפתח.',
        category: 'cat_intercom', floor: 'fl_0', area: 'ar_lobby', priority: 'medium', status: 'waiting_parts',
        reporter: { name: 'דנה פרץ', phone: '050-9988776', channel: 'committee' }, responsibleId: 'm1',
        createdAt: at(3),
        statusHistory: hist([['new', 3], ['waiting_vendor', 3], ['waiting_parts', 2]], 'm1'),
        external: ext({ vendorId: 'v3', company: 'קשר-טק מערכות אינטרקום', refNo: 'IT-5520', contactName: 'אלון ברק', contactPhone: '053-4443210', referredAt: dOff(-2), expectedAt: dOff(6) }),
        updates: [
          upd(2, 0, 'm1', 'הטכנאי אבחן תקלה בלוח הלחצנים. הוזמן לוח חדש מהספק, זמן אספקה כשבוע.')
        ]
      }),
      makeTicket({
        number: 1009, title: 'דלת יציאת החירום בקומה 6 לא נסגרת',
        description: 'דלת האש בחדר המדרגות בקומה 6 נשארת פתוחה ואינה נטרקת מעצמה.',
        category: 'cat_safety', floor: 'fl_6', area: 'ar_stairs', priority: 'high', status: 'in_progress',
        reporter: { name: 'מיכל רוזן', phone: '053-3030303', channel: 'in_person' }, responsibleId: 'm3',
        createdAt: at(1),
        statusHistory: hist([['new', 1], ['in_progress', 0, 20]], 'm3'),
        updates: [
          upd(0, 20, 'm3', 'המחזיר ההידראולי של הדלת שבור. אוספת הצעות מחיר להחלפה.')
        ]
      }),
      makeTicket({
        number: 1010, title: 'נורה שרופה בחדר המדרגות',
        description: 'הנורה בחדר המדרגות ליד דירה 18 אינה דולקת. חשוך מאוד בערב.',
        category: 'cat_lighting', floor: 'fl_5', area: 'ar_stairs', apartment: '18', priority: 'low', status: 'new',
        reporter: { name: 'יוסף כץ', phone: '050-4040404', channel: 'whatsapp' }, responsibleId: 'm1',
        createdAt: at(0, 5),
        statusHistory: hist([['new', 0, 5]], 'm1')
      })
    ];

    // updatedAt = latest activity on each ticket
    list.forEach(t => {
      const stamps = [t.createdAt].concat(t.updates.map(u => u.at), t.statusHistory.map(h => h.at));
      t.updatedAt = stamps.sort().pop();
    });

    Store.data = { version: 1, nextNumber: 1011, tickets: list, settings: defaultSettings(true) };
    Store.save();
  }

  /* ======================================================================
   * Domain helpers
   * ==================================================================== */

  const byId = (arr, id) => arr.find(x => x.id === id);
  const findTicket = id => tickets().find(t => t.id === id);

  const statusOf = id => STATUSES.find(s => s.id === id) || { id, label: id || '—', color: '#64748b' };
  const priorityOf = id => PRIORITIES.find(p => p.id === id) || { id, label: id || '—', rank: 0, color: '#64748b' };
  const channelLabel = id => (CHANNELS.find(c => c.id === id) || { label: '—' }).label;

  const catName = id => (byId(S().categories, id) || { name: id ? 'קטגוריה שנמחקה' : '—' }).name;
  const floorName = id => { const f = byId(S().floors, id); return f ? bidiFix(f.name) : ''; };
  const areaName = id => (byId(S().areas, id) || { name: '' }).name;
  const member = id => byId(S().members, id);
  const memberName = id => { const m = member(id); return m ? m.name : '—'; };

  function locationText(t, plain = false) {
    const floor = plain ? ((byId(S().floors, t.floor) || {}).name || '') : floorName(t.floor);
    const parts = [floor, areaName(t.area)];
    if (t.apartment) parts.push('דירה ' + t.apartment);
    return parts.filter(Boolean).join(' · ') || '—';
  }

  const isOpen = t => OPEN_STATUSES.has(t.status);
  const isDone = t => DONE_STATUSES.has(t.status);

  function isResolvedThisMonth(t) {
    if (!isDone(t) || !t.resolvedAt) return false;
    const d = new Date(t.resolvedAt);
    const n = new Date();
    return d.getFullYear() === n.getFullYear() && d.getMonth() === n.getMonth();
  }

  /** 'overdue' | 'upcoming' | null – based on the external party's promised date. */
  function dueState(t) {
    if (!isOpen(t) || !t.external || !t.external.opened || !t.external.expectedAt) return null;
    const diff = daysBetween(new Date(), parseDate(t.external.expectedAt));
    if (diff < 0) return 'overdue';
    if (diff <= 2) return 'upcoming';
    return null;
  }

  function dueText(t) {
    const state = dueState(t);
    if (!state) return '';
    const diff = daysBetween(new Date(), parseDate(t.external.expectedAt));
    if (state === 'overdue') return diff === -1 ? 'באיחור של יום' : `באיחור של ${-diff} ימים`;
    if (diff === 0) return 'צפוי היום';
    if (diff === 1) return 'צפוי מחר';
    return `צפוי בעוד ${diff} ימים`;
  }

  function daysOpen(t) {
    const end = t.resolvedAt ? new Date(t.resolvedAt)
      : (t.status === 'cancelled' ? new Date(t.updatedAt) : new Date());
    return Math.max(0, Math.floor((end - new Date(t.createdAt)) / DAY));
  }

  /** Change status, recording history and maintaining the resolution date. */
  function applyStatusChange(t, status, by, at) {
    if (!status || t.status === status) return false;
    t.statusHistory.push({ status, from: t.status, at, by: by || '' });
    t.status = status;
    if (DONE_STATUSES.has(status)) { if (!t.resolvedAt) t.resolvedAt = at; }
    else t.resolvedAt = null;
    t.updatedAt = at;
    return true;
  }

  /** Previous tickets with the same category in the same location (for the recurring-fault hint). */
  function findSimilar(category, floor, area, apartment, excludeId) {
    if (!category || (!area && !floor)) return [];
    return tickets().filter(t => {
      if (t.id === excludeId || t.category !== category) return false;
      if (area && WIDE_AREAS.has(area)) return t.area === area;
      if (area && t.area !== area) return false;
      if (area === 'ar_apartment' && apartment) return t.apartment === apartment;
      return floor ? t.floor === floor : true;
    }).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  const statusBadge = id => { const s = statusOf(id); return `<span class="badge st-${esc(s.id)}">${esc(s.label)}</span>`; };
  const priorityBadge = id => { const p = priorityOf(id); return `<span class="badge pr-${esc(p.id)}"><span class="dot" aria-hidden="true"></span>${esc(p.label)}</span>`; };
  function dueBadge(t) {
    const s = dueState(t);
    if (!s) return '';
    return `<span class="badge due-${s}">${s === 'overdue' ? '⚠ באיחור' : '⏰ מתקרב'}</span>`;
  }

  /* ======================================================================
   * UI primitives: toast, modal, confirm, lightbox
   * ==================================================================== */

  function toast(msg, type = 'info') {
    const el = document.createElement('div');
    el.className = `toast toast-${type}`;
    el.textContent = msg;
    $('#toasts').appendChild(el);
    setTimeout(() => {
      el.classList.add('hide');
      setTimeout(() => el.remove(), 300);
    }, type === 'error' ? 5500 : 3500);
  }

  const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), video[controls], [tabindex]:not([tabindex="-1"])';

  /**
   * Accessible modal dialog.
   * actions: [{ label, className, onClick(modalEl) }] – onClick may return false (or a Promise of false) to keep it open.
   */
  function openModal({ title, body, actions = [], wide = false, onClose, initialFocus }) {
    const prevFocus = document.activeElement;
    const titleId = uid('mt');
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
      const top = $$('.modal-overlay').pop();
      if (top !== overlay) return;
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); return; }
      if (e.key === 'Tab') {
        const f = $$(FOCUSABLE, modal).filter(el => el.offsetParent !== null || el === document.activeElement);
        if (!f.length) return;
        const first = f[0], last = f[f.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    }
    document.addEventListener('keydown', onKey, true);

    overlay.addEventListener('mousedown', e => { if (e.target === overlay) close(); });
    modal.addEventListener('click', async e => {
      if (e.target.closest('[data-close]')) { close(); return; }
      const b = e.target.closest('[data-act]');
      if (!b) return;
      const a = actions[Number(b.dataset.act)];
      const r = a.onClick ? await a.onClick(modal) : undefined;
      if (r !== false) close();
    });

    const target = (initialFocus && $(initialFocus, modal)) || $$(FOCUSABLE, $('.modal-body', modal))[0] || $('.modal-foot .btn', modal) || $('[data-close]', modal);
    if (target) target.focus();
    return { modal, close };
  }

  function confirmDialog(message, { title = 'אישור פעולה', okLabel = 'אישור', danger = false } = {}) {
    return new Promise(resolve => {
      let ok = false;
      openModal({
        title,
        body: `<p class="confirm-text">${nl2br(message)}</p>`,
        actions: [
          { label: okLabel, className: danger ? 'btn-danger' : 'btn-primary', onClick: () => { ok = true; } },
          { label: 'ביטול', className: 'btn-secondary' }
        ],
        initialFocus: danger ? '.modal-foot [data-act="1"]' : '.modal-foot [data-act="0"]',
        onClose: () => resolve(ok)
      });
    });
  }

  async function openLightbox(mediaId) {
    const info = await getMediaInfo(mediaId);
    if (!info) { toast('הקובץ אינו זמין.', 'error'); return; }
    openModal({
      title: info.name,
      wide: true,
      body: `<div class="lightbox"><img src="${info.url}" alt="${esc('תמונה מצורפת: ' + info.name)}"></div>`
    });
  }

  /* ======================================================================
   * Media rendering & file picker
   * ==================================================================== */

  /** Gallery skeleton; hydrateMedia() fills in the actual images / videos. owner: 't' or 'u:<updateId>' */
  function mediaGrid(ids, owner, { deletable = true } = {}) {
    if (!ids || !ids.length) return '';
    return `<div class="media-grid">${ids.map(id => `
      <figure class="media-item" data-media-id="${esc(id)}" data-owner="${esc(owner)}">
        <div class="media-slot"><span class="media-loading">טוען…</span></div>
        ${deletable ? `<button type="button" class="media-del" data-action="delete-media" aria-label="מחיקת הקובץ המצורף">✕</button>` : ''}
      </figure>`).join('')}</div>`;
  }

  async function hydrateMedia(root) {
    for (const fig of $$('[data-media-id]', root)) {
      const slot = $('.media-slot', fig);
      if (!slot || slot.dataset.ready) continue;
      const info = await getMediaInfo(fig.dataset.mediaId);
      if (!fig.isConnected) return;
      slot.dataset.ready = '1';
      if (!info) { slot.innerHTML = '<span class="media-missing">הקובץ אינו זמין</span>'; continue; }
      if (info.type.startsWith('video/')) {
        slot.innerHTML = `<video controls preload="metadata" src="${info.url}" aria-label="${esc('סרטון מצורף: ' + info.name)}"></video>`;
      } else {
        slot.innerHTML = `<button type="button" class="thumb" data-action="open-image" aria-label="${esc('הצגת התמונה ' + info.name + ' בגודל מלא')}">
          <img src="${info.url}" alt="${esc('תמונה מצורפת: ' + info.name)}" loading="lazy"></button>`;
      }
      const cap = document.createElement('figcaption');
      cap.textContent = info.name;
      cap.dir = 'auto'; // file names may be Latin or Hebrew
      fig.appendChild(cap);
    }
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

  /** Wire a file picker; returns an object exposing the selected files. */
  function bindFilePicker(root) {
    const input = $('.file-input', root);
    const list = $('.file-previews', root);
    const drop = $('.file-drop', root);
    let items = [];

    function render() {
      list.innerHTML = items.map(it => `
        <li class="file-chip">
          ${it.file.type.startsWith('video/') || /^(mp4|mov|webm)$/.test(extOf(it.file.name))
            ? '<span class="file-chip-icon" aria-hidden="true">🎬</span>'
            : `<img src="${it.url}" alt="" class="file-chip-thumb">`}
          <span class="file-chip-name">${esc(it.file.name)}</span>
          <span class="file-chip-size">${fmtSize(it.file.size)}</span>
          <button type="button" class="icon-btn" data-remove="${it.id}" aria-label="${esc('הסרת הקובץ ' + it.file.name)}">✕</button>
        </li>`).join('');
    }

    function add(fileList) {
      for (const f of Array.from(fileList || [])) {
        if (!ALLOWED_EXT.includes(extOf(f.name))) { toast(`סוג הקובץ "${f.name}" אינו נתמך.`, 'error'); continue; }
        if (f.size > MAX_FILE_MB * 1048576) { toast(`הקובץ "${f.name}" גדול מ-${MAX_FILE_MB}MB.`, 'error'); continue; }
        items.push({ id: uid('f'), file: f, url: URL.createObjectURL(f) });
      }
      input.value = '';
      render();
    }

    input.addEventListener('change', () => add(input.files));
    list.addEventListener('click', e => {
      const b = e.target.closest('[data-remove]');
      if (!b) return;
      const it = items.find(x => x.id === b.dataset.remove);
      if (it) URL.revokeObjectURL(it.url);
      items = items.filter(x => x.id !== b.dataset.remove);
      render();
      input.focus();
    });
    ['dragenter', 'dragover'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.add('dragging'); }));
    ['dragleave', 'drop'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.remove('dragging'); }));
    drop.addEventListener('drop', e => add(e.dataTransfer && e.dataTransfer.files));

    return {
      get files() { return items.map(x => x.file); },
      clear() { items.forEach(x => URL.revokeObjectURL(x.url)); items = []; render(); }
    };
  }

  /* ======================================================================
   * Router
   * ==================================================================== */

  let appEl;

  function setView(html) {
    appEl.onclick = appEl.onsubmit = appEl.onchange = appEl.oninput = null;
    appEl.innerHTML = html;
  }

  function route() {
    const parts = location.hash.replace(/^#\/?/, '').split('/');
    const view = parts[0] || 'dashboard';
    const id = parts[1];
    $$('.main-nav a').forEach(a => {
      const active = a.dataset.nav === view || (view === 'ticket' && a.dataset.nav === 'dashboard') || (view === 'edit' && a.dataset.nav === 'dashboard');
      a.classList.toggle('active', active);
      if (active) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
    });
    switch (view) {
      case 'ticket': renderTicket(id); break;
      case 'new': renderForm(null); break;
      case 'edit': renderForm(id); break;
      case 'stats': renderStats(); break;
      case 'settings': renderSettings(); break;
      default: renderDashboard();
    }
    window.scrollTo(0, 0);
    const h1 = $('h1', appEl);
    document.title = (h1 ? h1.textContent.trim() + ' · ' : '') + 'ניהול תקלות – ועד הבית';
  }

  /* ======================================================================
   * Dashboard
   * ==================================================================== */

  const DEFAULT_FILTERS = { q: '', status: 'all', priority: 'all', category: 'all', responsible: 'all', overdue: false, external: false, resolvedMonth: false };
  let filters = Object.assign({}, DEFAULT_FILTERS);
  let sort = { key: 'number', dir: 'desc' };

  const COLUMNS = [
    { key: 'number', label: 'מס׳' },
    { key: 'title', label: 'כותרת' },
    { key: 'category', label: 'קטגוריה' },
    { key: 'location', label: 'מיקום' },
    { key: 'priority', label: 'עדיפות' },
    { key: 'status', label: 'סטטוס' },
    { key: 'responsible', label: 'אחראי' },
    { key: 'vendor', label: 'גורם חיצוני' },
    { key: 'expected', label: 'מועד צפוי' },
    { key: 'days', label: 'ימים פתוחה' }
  ];

  function ticketSearchText(t) {
    return [t.number, t.title, t.description, t.reporter.name, t.external.company, t.external.refNo, t.external.contactName]
      .concat(t.updates.map(u => u.text)).join(' ').toLowerCase();
  }

  function applyFilters(list) {
    const q = filters.q.trim().toLowerCase();
    return list.filter(t => {
      if (q && !ticketSearchText(t).includes(q)) return false;
      if (filters.status === 'open' && !isOpen(t)) return false;
      if (filters.status === 'done' && !isDone(t)) return false;
      if (!['all', 'open', 'done'].includes(filters.status) && t.status !== filters.status) return false;
      if (filters.priority === 'high_plus' && !['high', 'urgent'].includes(t.priority)) return false;
      if (!['all', 'high_plus'].includes(filters.priority) && t.priority !== filters.priority) return false;
      if (filters.category !== 'all' && t.category !== filters.category) return false;
      if (filters.responsible === 'none' && t.responsibleId) return false;
      if (!['all', 'none'].includes(filters.responsible) && t.responsibleId !== filters.responsible) return false;
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
      case 'category': return catName(t.category);
      case 'location': return locationText(t, true);
      case 'priority': return priorityOf(t.priority).rank;
      case 'status': return STATUSES.findIndex(s => s.id === t.status);
      case 'responsible': return t.responsibleId ? memberName(t.responsibleId) : '';
      case 'vendor': return t.external.opened ? t.external.company : '';
      case 'expected': return t.external.opened ? t.external.expectedAt : '';
      case 'days': return daysOpen(t);
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

  function renderDashboard() {
    const all = tickets();
    const open = all.filter(isOpen);
    const sum = {
      open: open.length,
      urgent: open.filter(t => t.priority === 'high' || t.priority === 'urgent').length,
      external: open.filter(t => t.external.opened).length,
      overdue: all.filter(t => dueState(t) === 'overdue').length,
      resolved: all.filter(isResolvedThisMonth).length
    };
    const card = (key, cls, value, label, icon) => `
      <button type="button" class="summary-card ${cls}" data-card="${key}" aria-label="${esc(label)}: ${value}. לחיצה לסינון הרשימה">
        <span class="sc-icon" aria-hidden="true">${icon}</span>
        <span class="sc-value">${value}</span>
        <span class="sc-label">${label}</span>
      </button>`;

    const opt = (v, label, cur) => `<option value="${esc(v)}" ${cur === v ? 'selected' : ''}>${esc(label)}</option>`;

    setView(`
      <div class="page-head">
        <div>
          <h1>לוח בקרה</h1>
          <p class="muted">מעקב אחר כל התקלות בבניין – מדיווח ועד פתרון.</p>
        </div>
        <a class="btn btn-primary" href="#/new"><span aria-hidden="true">＋</span> קריאה חדשה</a>
      </div>

      <section class="summary-grid" aria-label="סיכום מצב התקלות">
        ${card('open', 'sc-open', sum.open, 'קריאות פתוחות', '📋')}
        ${card('urgent', 'sc-urgent', sum.urgent, 'דחופות / עדיפות גבוהה', '🔥')}
        ${card('external', 'sc-external', sum.external, 'בטיפול גורם חיצוני', '🛠')}
        ${card('overdue', 'sc-overdue', sum.overdue, 'באיחור', '⚠')}
        ${card('resolved', 'sc-resolved', sum.resolved, 'נפתרו החודש', '✔')}
      </section>

      <section class="card" aria-labelledby="list-title">
        <div class="card-head">
          <h2 id="list-title">רשימת הקריאות</h2>
        </div>
        <form class="filters" id="filters" role="search" aria-label="סינון וחיפוש קריאות">
          <div class="field field-grow">
            <label for="f-q">חיפוש חופשי</label>
            <input type="search" id="f-q" name="q" value="${esc(filters.q)}" placeholder="חיפוש בכותרת, בתיאור ובעדכונים…" autocomplete="off">
          </div>
          <div class="field">
            <label for="f-status">סטטוס</label>
            <select id="f-status" name="status">
              ${opt('all', 'הכל', filters.status)}${opt('open', 'כל הפתוחות', filters.status)}${opt('done', 'טופלו / נסגרו', filters.status)}
              <optgroup label="סטטוס מסוים">${STATUSES.map(s => opt(s.id, s.label, filters.status)).join('')}</optgroup>
            </select>
          </div>
          <div class="field">
            <label for="f-priority">עדיפות</label>
            <select id="f-priority" name="priority">
              ${opt('all', 'הכל', filters.priority)}${opt('high_plus', 'גבוהה ודחופה', filters.priority)}
              ${PRIORITIES.map(p => opt(p.id, p.label, filters.priority)).join('')}
            </select>
          </div>
          <div class="field">
            <label for="f-category">קטגוריה</label>
            <select id="f-category" name="category">
              ${opt('all', 'הכל', filters.category)}${S().categories.map(c => opt(c.id, c.name, filters.category)).join('')}
            </select>
          </div>
          <div class="field">
            <label for="f-resp">אחראי</label>
            <select id="f-resp" name="responsible">
              ${opt('all', 'הכל', filters.responsible)}${opt('none', 'ללא אחראי', filters.responsible)}
              ${S().members.map(m => opt(m.id, m.name, filters.responsible)).join('')}
            </select>
          </div>
          <div class="filter-checks">
            <label class="check"><input type="checkbox" name="overdue" ${filters.overdue ? 'checked' : ''}> באיחור בלבד</label>
            <label class="check"><input type="checkbox" name="external" ${filters.external ? 'checked' : ''}> בטיפול חיצוני</label>
            <label class="check"><input type="checkbox" name="resolvedMonth" ${filters.resolvedMonth ? 'checked' : ''}> נפתרו החודש</label>
            <button type="button" class="btn btn-ghost btn-sm" data-action="clear-filters">ניקוי סינון</button>
          </div>
        </form>

        <div class="list-toolbar">
          <p id="result-count" class="muted" aria-live="polite"></p>
          <div class="btn-row">
            <button type="button" class="btn btn-secondary btn-sm" data-action="export-filtered">⬇ ייצוא התצוגה ל-Excel</button>
            <button type="button" class="btn btn-secondary btn-sm" data-action="export-all">⬇ ייצוא כל הקריאות</button>
            <button type="button" class="btn btn-danger-outline btn-sm" data-action="wipe">🗑 מחיקת כל הנתונים</button>
          </div>
        </div>
        <div id="ticket-list"></div>
      </section>
    `);

    renderTicketList();

    const form = $('#filters');
    const readFilters = () => {
      const fd = new FormData(form);
      filters = {
        q: String(fd.get('q') || ''), status: fd.get('status'), priority: fd.get('priority'),
        category: fd.get('category'), responsible: fd.get('responsible'),
        overdue: fd.get('overdue') === 'on', external: fd.get('external') === 'on', resolvedMonth: fd.get('resolvedMonth') === 'on'
      };
      renderTicketList();
    };
    form.addEventListener('input', readFilters);
    form.addEventListener('change', readFilters);
    form.addEventListener('submit', e => e.preventDefault());

    appEl.onclick = async e => {
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
      if (sortBtn) {
        const key = sortBtn.dataset.sort;
        sort = sort.key === key ? { key, dir: sort.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: key === 'number' || key === 'days' || key === 'priority' ? 'desc' : 'asc' };
        renderTicketList();
        const again = $(`[data-sort="${key}"]`);
        if (again) again.focus();
        return;
      }
      const act = e.target.closest('[data-action]');
      if (act) {
        const a = act.dataset.action;
        if (a === 'clear-filters') { filters = Object.assign({}, DEFAULT_FILTERS); renderDashboard(); $('#f-q').focus(); }
        if (a === 'export-filtered') exportCsv(sortTickets(applyFilters(tickets())), 'קריאות-תצוגה');
        if (a === 'export-all') exportCsv(sortTickets(tickets()), 'כל-הקריאות');
        if (a === 'wipe') wipeAllData();
        if (a === 'restore-demo') restoreDemo();
        return;
      }
      const row = e.target.closest('tr[data-id]');
      if (row && !e.target.closest('a')) location.hash = '#/ticket/' + row.dataset.id;
    };
  }

  function renderTicketList() {
    const container = $('#ticket-list');
    if (!container) return;
    const all = tickets();
    const list = sortTickets(applyFilters(all));
    $('#result-count').textContent = `מוצגות ${list.length} מתוך ${all.length} קריאות`;

    if (!all.length) {
      container.innerHTML = `
        <div class="empty-state">
          <p class="empty-icon" aria-hidden="true">🏢</p>
          <h3>אין עדיין קריאות במערכת</h3>
          <p class="muted">אפשר לפתוח קריאה ראשונה או לטעון נתוני הדגמה.</p>
          <div class="btn-row center">
            <a href="#/new" class="btn btn-primary">פתיחת קריאה ראשונה</a>
            <button type="button" class="btn btn-secondary" data-action="restore-demo">טעינת נתוני הדגמה</button>
          </div>
        </div>`;
      return;
    }
    if (!list.length) {
      container.innerHTML = `<div class="empty-state"><h3>לא נמצאו קריאות התואמות לסינון</h3>
        <button type="button" class="btn btn-secondary" data-action="clear-filters">ניקוי סינון</button></div>`;
      return;
    }

    const th = c => {
      const active = sort.key === c.key;
      const ariaSort = active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none';
      return `<th scope="col" aria-sort="${ariaSort}"><button type="button" class="sort-btn ${active ? 'active' : ''}" data-sort="${c.key}">
        ${c.label}<span class="sort-ind" aria-hidden="true">${active ? (sort.dir === 'asc' ? '▲' : '▼') : '↕'}</span></button></th>`;
    };

    container.innerHTML = `
      <div class="table-wrap">
        <table class="tickets-table">
          <caption class="visually-hidden">רשימת קריאות. לחיצה על כותרת עמודה ממיינת את הרשימה.</caption>
          <thead><tr>${COLUMNS.map(th).join('')}</tr></thead>
          <tbody>
            ${list.map(t => {
              const due = dueState(t);
              return `<tr data-id="${t.id}" class="${due ? 'row-' + due : ''} ${isOpen(t) ? '' : 'row-done'}">
                <td data-label="מס׳" class="col-num">#${t.number}</td>
                <td data-label="כותרת" class="col-title"><a href="#/ticket/${t.id}">${esc(t.title)}</a>
                  ${t.updates.length ? `<span class="upd-count" title="מספר עדכונים">${t.updates.length} עדכונים</span>` : ''}</td>
                <td data-label="קטגוריה">${esc(catName(t.category))}</td>
                <td data-label="מיקום">${esc(locationText(t))}</td>
                <td data-label="עדיפות">${priorityBadge(t.priority)}</td>
                <td data-label="סטטוס">${statusBadge(t.status)}</td>
                <td data-label="אחראי">${esc(t.responsibleId ? memberName(t.responsibleId) : '—')}</td>
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
   * Ticket detail
   * ==================================================================== */

  function notFoundHtml() {
    return `<div class="card empty-state"><h1>הקריאה לא נמצאה</h1><p class="muted">ייתכן שהקריאה נמחקה.</p>
      <a href="#/dashboard" class="btn btn-primary">חזרה ללוח הבקרה</a></div>`;
  }

  function renderTicket(id) {
    const t = findTicket(id);
    if (!t) { setView(notFoundHtml()); return; }
    const due = dueState(t);
    const ex = t.external;
    const resp = member(t.responsibleId);
    const updates = t.updates.slice().sort((a, b) => b.at.localeCompare(a.at));

    const memberOptions = S().members.map(m => `<option value="${esc(m.id)}" ${m.id === t.responsibleId ? 'selected' : ''}>${esc(m.name)}</option>`).join('');

    setView(`
      <nav class="breadcrumbs" aria-label="מיקום בעמוד">
        <a href="#/dashboard">לוח בקרה</a><span aria-hidden="true">‹</span><span aria-current="page">קריאה #${t.number}</span>
      </nav>

      <section class="card ticket-head">
        <div class="ticket-head-main">
          <div class="ticket-number"><small>קריאה</small>#${t.number}</div>
          <div class="ticket-head-text">
            <h1 class="ticket-title">${esc(t.title)}</h1>
            <div class="badges">${statusBadge(t.status)}${priorityBadge(t.priority)}${dueBadge(t)}<span class="badge badge-neutral">${esc(catName(t.category))}</span></div>
            <p class="meta">דווחה ב-${fmtDateTime(t.createdAt)} · עדכון אחרון ${fmtDateTime(t.updatedAt)} · ${isOpen(t) ? 'פתוחה' : 'הייתה פתוחה'} ${daysOpen(t)} ימים</p>
          </div>
        </div>
        <div class="btn-row ticket-actions">
          <a class="btn btn-primary" href="#/edit/${t.id}">✎ עריכה</a>
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
            ${t.media.length ? `<h3 class="sub-h">קבצים מצורפים לדיווח</h3>${mediaGrid(t.media, 't')}` : ''}
          </section>

          <section class="card" aria-labelledby="add-upd-h">
            <h2 id="add-upd-h">הוספת עדכון</h2>
            <form id="update-form" class="update-form" novalidate>
              <div class="grid-2">
                <div class="field">
                  <label for="u-author">כותב/ת העדכון</label>
                  <select id="u-author" name="author"><option value="">ללא שם</option>${memberOptions}</select>
                </div>
                <div class="field">
                  <label for="u-status">שינוי סטטוס (אופציונלי)</label>
                  <select id="u-status" name="status"><option value="">ללא שינוי (${esc(statusOf(t.status).label)})</option>
                    ${STATUSES.filter(s => s.id !== t.status).map(s => `<option value="${s.id}">${esc(s.label)}</option>`).join('')}</select>
                </div>
                <div class="field span-2">
                  <label for="u-text">תוכן העדכון</label>
                  <textarea id="u-text" name="text" rows="3" placeholder="מה התחדש? למשל: הטכנאי ביקר והזמין חלק חלופי…"></textarea>
                  <p class="field-error" id="u-text-err" hidden></p>
                </div>
                <div class="field span-2">${filePickerHtml('u-files')}</div>
              </div>
              <div class="btn-row"><button type="submit" class="btn btn-primary">הוספת העדכון</button></div>
            </form>
          </section>

          <section class="card" aria-labelledby="tl-h">
            <h2 id="tl-h">עדכונים <span class="count">${t.updates.length}</span></h2>
            ${updates.length ? `<ol class="timeline">${updates.map(u => `
              <li class="tl-item">
                <span class="tl-dot" aria-hidden="true"></span>
                <article class="tl-body">
                  <header class="tl-head">
                    <strong>${esc(u.authorId ? memberName(u.authorId) : 'ללא שם')}</strong>
                    <time datetime="${esc(u.at)}">${fmtDateTime(u.at)}</time>
                  </header>
                  ${u.statusChange ? `<p class="tl-status">הסטטוס שונה: ${statusBadge(u.statusChange.from)} <span aria-hidden="true">←</span><span class="visually-hidden">ל</span> ${statusBadge(u.statusChange.to)}</p>` : ''}
                  ${u.text ? `<p class="tl-text">${nl2br(u.text)}</p>` : ''}
                  ${mediaGrid(u.media, 'u:' + u.id)}
                  <button type="button" class="link-btn link-danger" data-action="delete-update" data-update-id="${u.id}">מחיקת העדכון</button>
                </article>
              </li>`).join('')}</ol>` : '<p class="muted">אין עדיין עדכונים לקריאה זו.</p>'}
          </section>
        </div>

        <aside class="ticket-side" aria-label="פרטי הקריאה">
          <section class="card" aria-labelledby="det-h">
            <h2 id="det-h">פרטי הקריאה</h2>
            <dl class="details">
              <dt>קטגוריה</dt><dd>${esc(catName(t.category))}</dd>
              <dt>מיקום</dt><dd>${esc(locationText(t))}</dd>
              <dt>מדווח/ת</dt><dd>${esc(t.reporter.name || '—')}${t.reporter.phone ? '<br>' + telLink(t.reporter.phone) : ''}</dd>
              <dt>אופן הדיווח</dt><dd>${esc(channelLabel(t.reporter.channel))}</dd>
              <dt>אחראי/ת לקריאה</dt><dd>${resp ? esc(resp.name) + (resp.phone ? '<br>' + telLink(resp.phone) : '') : '—'}</dd>
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
            ` : `<p class="muted">לא נפתחה תקלה אצל גורם חיצוני.</p><a class="btn btn-secondary btn-sm" href="#/edit/${t.id}">פתיחת טיפול חיצוני</a>`}
          </section>

          <section class="card" aria-labelledby="hist-h">
            <h2 id="hist-h">היסטוריית סטטוסים</h2>
            <ol class="status-history">
              ${t.statusHistory.slice().reverse().map(h => `
                <li>${statusBadge(h.status)}<span class="sh-meta"><time datetime="${esc(h.at)}">${fmtDateTime(h.at)}</time>${h.by ? ' · ' + esc(memberName(h.by)) : ''}</span></li>`).join('')}
            </ol>
          </section>
        </aside>
      </div>
    `);

    hydrateMedia(appEl);
    const picker = bindFilePicker($('#u-files'));

    appEl.onsubmit = async e => {
      if (e.target.id !== 'update-form') return;
      e.preventDefault();
      const form = e.target;
      const fd = new FormData(form);
      const text = String(fd.get('text') || '').trim();
      const newStatus = String(fd.get('status') || '');
      const author = String(fd.get('author') || '');
      const err = $('#u-text-err');
      if (!text && !picker.files.length && !newStatus) {
        err.textContent = 'יש לכתוב תוכן לעדכון, לצרף קובץ או לשנות סטטוס.';
        err.hidden = false;
        $('#u-text').setAttribute('aria-invalid', 'true');
        $('#u-text').setAttribute('aria-describedby', 'u-text-err');
        $('#u-text').focus();
        return;
      }
      const btn = $('button[type="submit"]', form);
      btn.disabled = true;
      const nowIso = new Date().toISOString();
      const mediaIds = await storeFiles(picker.files);
      const upd = { id: uid('u'), at: nowIso, authorId: author, text, media: mediaIds };
      if (newStatus && newStatus !== t.status) {
        upd.statusChange = { from: t.status, to: newStatus };
        applyStatusChange(t, newStatus, author, nowIso);
      }
      t.updates.push(upd);
      t.updatedAt = nowIso;
      Store.save();
      picker.clear();
      toast('העדכון נוסף בהצלחה.', 'success');
      renderTicket(t.id);
      const tl = $('#tl-h');
      if (tl) tl.scrollIntoView({ behavior: 'smooth', block: 'start' });
    };

    appEl.onclick = async e => {
      const act = e.target.closest('[data-action]');
      if (!act) return;
      const a = act.dataset.action;
      if (a === 'open-image') { openLightbox(act.closest('[data-media-id]').dataset.mediaId); return; }
      if (a === 'whatsapp') { showWhatsApp(t); return; }
      if (a === 'print') { printTicket(t); return; }
      if (a === 'delete-ticket') {
        const ok = await confirmDialog(`למחוק לצמיתות את קריאה #${t.number} – "${t.title}"?\nכל העדכונים והקבצים המצורפים יימחקו.`, { okLabel: 'מחיקת הקריאה', danger: true, title: 'מחיקת קריאה' });
        if (!ok) return;
        await deleteMediaIds(allMediaIds(t));
        Store.data.tickets = tickets().filter(x => x.id !== t.id);
        Store.save();
        toast(`קריאה #${t.number} נמחקה.`, 'success');
        location.hash = '#/dashboard';
        return;
      }
      if (a === 'delete-update') {
        const u = t.updates.find(x => x.id === act.dataset.updateId);
        if (!u) return;
        const ok = await confirmDialog('למחוק את העדכון? הקבצים המצורפים אליו יימחקו גם הם.', { okLabel: 'מחיקה', danger: true });
        if (!ok) return;
        await deleteMediaIds(u.media || []);
        t.updates = t.updates.filter(x => x.id !== u.id);
        Store.save();
        toast('העדכון נמחק.', 'success');
        renderTicket(t.id);
        return;
      }
      if (a === 'delete-media') {
        const fig = act.closest('[data-media-id]');
        const ok = await confirmDialog('למחוק את הקובץ המצורף?', { okLabel: 'מחיקה', danger: true });
        if (!ok) return;
        removeMediaFromTicket(t, fig.dataset.mediaId, fig.dataset.owner);
        await deleteMediaIds([fig.dataset.mediaId]);
        Store.save();
        toast('הקובץ נמחק.', 'success');
        renderTicket(t.id);
      }
    };
  }

  function removeMediaFromTicket(t, mediaId, owner) {
    if (owner === 't') t.media = t.media.filter(x => x !== mediaId);
    else {
      const u = t.updates.find(x => 'u:' + x.id === owner);
      if (u) u.media = u.media.filter(x => x !== mediaId);
    }
  }

  /* ======================================================================
   * Ticket create / edit form
   * ==================================================================== */

  function renderForm(id) {
    const existing = id ? findTicket(id) : null;
    if (id && !existing) { setView(notFoundHtml()); return; }
    const t = existing || makeTicket({ status: 'new', priority: 'medium' });
    const ex = t.external;
    const sel = (items, cur, empty, labelFn = i => i.name) =>
      (empty != null ? `<option value="">${esc(empty)}</option>` : '') +
      items.map(i => `<option value="${esc(i.id)}" ${i.id === cur ? 'selected' : ''}>${esc(labelFn(i))}</option>`).join('');

    setView(`
      <nav class="breadcrumbs" aria-label="מיקום בעמוד">
        <a href="#/dashboard">לוח בקרה</a><span aria-hidden="true">‹</span>
        ${existing ? `<a href="#/ticket/${t.id}">קריאה #${t.number}</a><span aria-hidden="true">‹</span><span aria-current="page">עריכה</span>` : '<span aria-current="page">קריאה חדשה</span>'}
      </nav>
      <div class="page-head">
        <div>
          <h1>${existing ? `עריכת קריאה #${t.number}` : 'פתיחת קריאה חדשה'}</h1>
          <p class="muted">${existing ? 'שינויים בסטטוס יירשמו בהיסטוריית הקריאה.' : `מספר הקריאה יוקצה אוטומטית: <strong>#${Store.data.nextNumber}</strong>`}</p>
        </div>
      </div>

      <form id="ticket-form" class="ticket-form" novalidate>
        <div class="form-error-summary alert alert-danger" id="form-errors" role="alert" hidden></div>

        <fieldset class="card">
          <legend>פרטי התקלה</legend>
          <div class="grid-2">
            <div class="field span-2">
              <label for="tf-title">כותרת <span class="req" aria-hidden="true">*</span></label>
              <input id="tf-title" name="title" required maxlength="120" value="${esc(t.title)}" placeholder="תיאור קצר, למשל: נזילה בחדר המדרגות">
            </div>
            <div class="field span-2">
              <label for="tf-desc">תיאור מפורט</label>
              <textarea id="tf-desc" name="description" rows="4" placeholder="מה בדיוק קרה, ממתי, ומי מושפע">${esc(t.description)}</textarea>
            </div>
            <div class="field">
              <label for="tf-cat">קטגוריה <span class="req" aria-hidden="true">*</span></label>
              <select id="tf-cat" name="category" required>${sel(S().categories, t.category, 'בחירת קטגוריה…')}</select>
            </div>
            <div class="field">
              <label for="tf-status">סטטוס</label>
              <select id="tf-status" name="status">${sel(STATUSES, t.status, null, s => s.label)}</select>
            </div>
            <div class="field span-2">
              <span class="label" id="prio-label">עדיפות</span>
              <div class="pill-group" role="radiogroup" aria-labelledby="prio-label">
                ${PRIORITIES.map(p => `<label class="pill pill-${p.id}"><input type="radio" name="priority" value="${p.id}" ${t.priority === p.id ? 'checked' : ''}><span>${p.label}</span></label>`).join('')}
              </div>
            </div>
          </div>
        </fieldset>

        <fieldset class="card">
          <legend>מיקום בבניין</legend>
          <div class="grid-3">
            <div class="field">
              <label for="tf-floor">קומה</label>
              <select id="tf-floor" name="floor">${sel(S().floors, t.floor, 'לא צוין', f => bidiFix(f.name))}</select>
            </div>
            <div class="field">
              <label for="tf-area">אזור</label>
              <select id="tf-area" name="area">${sel(S().areas, t.area, 'לא צוין')}</select>
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
              <input id="tf-rname" name="reporterName" value="${esc(t.reporter.name)}" autocomplete="off">
            </div>
            <div class="field">
              <label for="tf-rphone">טלפון המדווח/ת</label>
              <input id="tf-rphone" name="reporterPhone" type="tel" dir="ltr" inputmode="tel" value="${esc(t.reporter.phone)}" placeholder="050-0000000">
            </div>
            <div class="field">
              <label for="tf-channel">אופן הדיווח</label>
              <select id="tf-channel" name="channel">${sel(CHANNELS, t.reporter.channel, null, c => c.label)}</select>
            </div>
            <div class="field">
              <label for="tf-resp">אחראי/ת לקריאה (חבר/ת ועד)</label>
              <select id="tf-resp" name="responsible">${sel(S().members, t.responsibleId, 'ללא אחראי', m => m.name + (m.phone ? ' · ' + m.phone : ''))}</select>
              ${S().members.length ? '' : '<small class="muted">אין חברי ועד ברשימה – ניתן להוסיף במסך <a href="#/settings">הגדרות</a>.</small>'}
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
                <select id="tf-vendor" name="vendorId">${sel(S().vendors, ex.vendorId, '— ספק שאינו ברשימה —', v => v.company + (v.specialty ? ' (' + v.specialty + ')' : ''))}</select>
              </div>
              <div class="field">
                <label for="tf-company">שם החברה / הספק</label>
                <input id="tf-company" name="company" value="${esc(ex.company)}">
              </div>
              <div class="field">
                <label for="tf-ref">מספר קריאה אצל הספק</label>
                <input id="tf-ref" name="refNo" dir="ltr" value="${esc(ex.refNo)}" placeholder="SC-00000">
              </div>
              <div class="field">
                <label for="tf-cname">שם איש המקצוע המטפל</label>
                <input id="tf-cname" name="contactName" value="${esc(ex.contactName)}">
              </div>
              <div class="field">
                <label for="tf-cphone">טלפון איש המקצוע</label>
                <input id="tf-cphone" name="contactPhone" type="tel" dir="ltr" inputmode="tel" value="${esc(ex.contactPhone)}" placeholder="050-0000000">
              </div>
              <div class="field">
                <label for="tf-referred">תאריך הפנייה</label>
                <input id="tf-referred" name="referredAt" type="date" value="${esc(ex.referredAt)}">
              </div>
              <div class="field">
                <label for="tf-expected">מתי אמור להגיע / מועד תיקון שהובטח</label>
                <input id="tf-expected" name="expectedAt" type="date" value="${esc(ex.expectedAt)}">
              </div>
            </div>
            <button type="button" class="btn btn-ghost btn-sm" data-action="save-vendor">＋ שמירת הספק בספר הספקים</button>
          </div>
        </fieldset>

        <fieldset class="card">
          <legend>תמונות וסרטונים</legend>
          ${existing && t.media.length ? `<p class="muted">קבצים קיימים:</p>${mediaGrid(t.media, 't')}` : ''}
          ${filePickerHtml('tf-files')}
        </fieldset>

        <div class="form-actions">
          <button type="submit" class="btn btn-primary btn-lg">${existing ? 'שמירת השינויים' : 'פתיחת הקריאה'}</button>
          <a class="btn btn-secondary btn-lg" href="${existing ? '#/ticket/' + t.id : '#/dashboard'}">ביטול</a>
        </div>
      </form>
    `);

    const form = $('#ticket-form');
    const picker = bindFilePicker($('#tf-files'));
    hydrateMedia(appEl);

    const updateHint = () => {
      const fd = new FormData(form);
      const cat = String(fd.get('category') || ''), floor = String(fd.get('floor') || ''), area = String(fd.get('area') || '');
      const apt = String(fd.get('apartment') || '').trim();
      const box = $('#recurring-hint');
      const similar = findSimilar(cat, floor, area, apt, existing && existing.id);
      if (!similar.length) { box.innerHTML = ''; return; }
      const where = [area ? areaName(area) : '', area && WIDE_AREAS.has(area) ? '' : floorName(floor)].filter(Boolean).join(', ');
      box.innerHTML = `
        <div class="alert alert-info recurring">
          <p><strong>💡 תקלה חוזרת?</strong> במיקום זה (${esc(where)}) דווחו בעבר ${similar.length === 1 ? 'תקלה אחת' : similar.length + ' תקלות'} מסוג ${esc(catName(cat))}:</p>
          <ul>${similar.slice(0, 6).map(s => `<li><a href="#/ticket/${s.id}" target="_blank" rel="noopener">#${s.number} – ${esc(s.title)}</a>
            <span class="muted">(${fmtDate(s.createdAt)})</span> ${statusBadge(s.status)}</li>`).join('')}</ul>
        </div>`;
    };
    updateHint();

    appEl.onchange = e => {
      const n = e.target.name;
      if (['category', 'floor', 'area', 'apartment'].includes(n)) updateHint();
      if (n === 'extOpened') {
        $('#ext-fields').hidden = !e.target.checked;
        if (e.target.checked && !$('#tf-referred').value) $('#tf-referred').value = toDateInput(new Date());
      }
      if (n === 'vendorId') {
        const v = byId(S().vendors, e.target.value);
        if (v) {
          $('#tf-company').value = v.company || '';
          $('#tf-cname').value = v.contact || '';
          $('#tf-cphone').value = v.phone || '';
          toast(`פרטי "${v.company}" מולאו אוטומטית.`, 'info');
        }
      }
    };
    appEl.oninput = e => { if (e.target.name === 'apartment') updateHint(); };

    appEl.onclick = async e => {
      const act = e.target.closest('[data-action]');
      if (!act) return;
      const a = act.dataset.action;
      if (a === 'open-image') { openLightbox(act.closest('[data-media-id]').dataset.mediaId); return; }
      if (a === 'save-vendor') {
        const company = $('#tf-company').value.trim();
        if (!company) { toast('יש להזין שם חברה לפני השמירה בספר הספקים.', 'error'); $('#tf-company').focus(); return; }
        const existingV = S().vendors.find(v => v.company === company);
        if (existingV) { toast('ספק בשם זה כבר קיים בספר הספקים.', 'info'); return; }
        const v = { id: uid('v'), company, contact: $('#tf-cname').value.trim(), phone: $('#tf-cphone').value.trim(), specialty: catName(form.category.value) === '—' ? '' : catName(form.category.value) };
        S().vendors.push(v);
        Store.save();
        const vs = $('#tf-vendor');
        vs.insertAdjacentHTML('beforeend', `<option value="${v.id}">${esc(v.company)}${v.specialty ? ' (' + esc(v.specialty) + ')' : ''}</option>`);
        vs.value = v.id;
        toast(`"${company}" נשמר בספר הספקים.`, 'success');
        return;
      }
      if (a === 'delete-media' && existing) {
        const fig = act.closest('[data-media-id]');
        const ok = await confirmDialog('למחוק את הקובץ המצורף?', { okLabel: 'מחיקה', danger: true });
        if (!ok) return;
        removeMediaFromTicket(existing, fig.dataset.mediaId, 't');
        await deleteMediaIds([fig.dataset.mediaId]);
        Store.save();
        fig.remove();
        toast('הקובץ נמחק.', 'success');
      }
    };

    appEl.onsubmit = async e => {
      e.preventDefault();
      await saveTicketForm(form, existing, picker);
    };
  }

  function showFieldError(form, name, msg) {
    const el = form.elements[name];
    if (!el) return;
    const field = el.closest('.field');
    el.setAttribute('aria-invalid', 'true');
    const errId = el.id + '-err';
    el.setAttribute('aria-describedby', errId);
    const p = document.createElement('p');
    p.className = 'field-error';
    p.id = errId;
    p.textContent = msg;
    field.appendChild(p);
  }

  function clearFieldErrors(form) {
    $$('.field-error', form).forEach(p => p.remove());
    $$('[aria-invalid]', form).forEach(el => { el.removeAttribute('aria-invalid'); el.removeAttribute('aria-describedby'); });
    $('#form-errors').hidden = true;
  }

  async function saveTicketForm(form, existing, picker) {
    clearFieldErrors(form);
    const fd = new FormData(form);
    const v = k => String(fd.get(k) ?? '').trim();
    const extOpened = fd.get('extOpened') === 'on';
    const phoneOk = p => !p || /^[0-9+\-\s()]{7,20}$/.test(p);

    const errors = [];
    if (!v('title')) errors.push(['title', 'יש להזין כותרת לתקלה.']);
    if (!v('category')) errors.push(['category', 'יש לבחור קטגוריה.']);
    if (!phoneOk(v('reporterPhone'))) errors.push(['reporterPhone', 'מספר הטלפון אינו תקין.']);
    if (extOpened) {
      if (!phoneOk(v('contactPhone'))) errors.push(['contactPhone', 'מספר הטלפון אינו תקין.']);
      if (v('referredAt') && v('expectedAt') && v('expectedAt') < v('referredAt')) errors.push(['expectedAt', 'מועד ההגעה אינו יכול להיות לפני תאריך הפנייה.']);
    }
    if (errors.length) {
      errors.forEach(([n, m]) => showFieldError(form, n, m));
      const summary = $('#form-errors');
      summary.innerHTML = `<strong>יש לתקן ${errors.length === 1 ? 'שגיאה אחת' : errors.length + ' שגיאות'}:</strong><ul>${errors.map(([, m]) => `<li>${esc(m)}</li>`).join('')}</ul>`;
      summary.hidden = false;
      form.elements[errors[0][0]].focus();
      return;
    }

    const btn = $('button[type="submit"]', form);
    btn.disabled = true;
    const nowIso = new Date().toISOString();
    const t = existing || makeTicket();
    const responsibleId = v('responsible');

    Object.assign(t, {
      title: v('title'), description: v('description'), category: v('category'),
      priority: v('priority') || 'medium', floor: v('floor'), area: v('area'), apartment: v('apartment'),
      responsibleId
    });
    t.reporter = { name: v('reporterName'), phone: v('reporterPhone'), channel: v('channel') || 'whatsapp' };
    t.external = extOpened ? {
      opened: true, vendorId: v('vendorId'), company: v('company'), refNo: v('refNo'),
      contactName: v('contactName'), contactPhone: v('contactPhone'), referredAt: v('referredAt'), expectedAt: v('expectedAt')
    } : Object.assign(emptyExternal(), { opened: false });

    const status = v('status') || 'new';
    if (!existing) {
      t.number = Store.data.nextNumber++;
      t.createdAt = nowIso;
      t.status = status;
      t.statusHistory = [{ status, at: nowIso, by: responsibleId }];
      t.resolvedAt = DONE_STATUSES.has(status) ? nowIso : null;
    } else {
      applyStatusChange(t, status, responsibleId, nowIso);
    }

    const ids = await storeFiles(picker.files);
    t.media = t.media.concat(ids);
    t.updatedAt = nowIso;
    if (!existing) Store.data.tickets.push(t);
    Store.save();
    toast(existing ? 'השינויים נשמרו.' : `קריאה #${t.number} נפתחה בהצלחה.`, 'success');
    location.hash = '#/ticket/' + t.id;
  }

  /* ======================================================================
   * Statistics
   * ==================================================================== */

  function barChart(rows, { color = 'var(--primary)', suffix = '' } = {}) {
    const max = Math.max(1, ...rows.map(r => r.value));
    if (!rows.length) return '<p class="muted">אין נתונים להצגה.</p>';
    return `<ul class="bar-chart">${rows.map(r => `
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
    const arcs = total ? segments.filter(s => s.value).map(s => {
      const len = (s.value / total) * c;
      const el = `<circle r="${r}" cx="80" cy="80" fill="none" stroke="${s.color}" stroke-width="26"
        stroke-dasharray="${len} ${c - len}" stroke-dashoffset="${-offset}" transform="rotate(-90 80 80)"><title>${esc(s.label)}: ${s.value}</title></circle>`;
      offset += len;
      return el;
    }).join('') : `<circle r="${r}" cx="80" cy="80" fill="none" stroke="var(--border)" stroke-width="26"/>`;
    return `
      <div class="donut-wrap">
        <svg viewBox="0 0 160 160" class="donut" role="img" aria-label="${esc(segments.map(s => `${s.label}: ${s.value}`).join(', '))}">
          ${arcs}
          <text x="80" y="78" text-anchor="middle" class="donut-num">${total}</text>
          <text x="80" y="100" text-anchor="middle" class="donut-lbl">${esc(centerLabel)}</text>
        </svg>
        <ul class="legend">${segments.map(s => `<li><span class="swatch" style="background:${s.color}" aria-hidden="true"></span>${esc(s.label)} <strong>${s.value}</strong></li>`).join('')}</ul>
      </div>`;
  }

  function renderStats() {
    const all = tickets();
    const done = all.filter(t => isDone(t) && t.resolvedAt);
    const resDays = t => (new Date(t.resolvedAt) - new Date(t.createdAt)) / DAY;
    const avg = arr => arr.length ? arr.reduce((s, x) => s + x, 0) / arr.length : 0;
    const avgAll = avg(done.map(resDays));

    const byStatus = STATUSES.map(s => ({ label: s.label, value: all.filter(t => t.status === s.id).length, color: s.color }));
    const byCat = S().categories.map(c => ({ label: c.name, value: all.filter(t => t.category === c.id).length }))
      .filter(r => r.value).sort((a, b) => b.value - a.value);
    const byPriority = PRIORITIES.map(p => ({ label: p.label, value: all.filter(t => t.priority === p.id).length, color: p.color }));
    const avgByCat = S().categories.map(c => {
      const arr = done.filter(t => t.category === c.id).map(resDays);
      return { label: c.name, value: Math.round(avg(arr) * 10) / 10, n: arr.length };
    }).filter(r => r.n).sort((a, b) => b.value - a.value);

    // Opened per month – last 12 months, oldest first (renders right-to-left in RTL)
    const months = [];
    const n = new Date();
    for (let i = 11; i >= 0; i--) {
      const d = new Date(n.getFullYear(), n.getMonth() - i, 1);
      const count = all.filter(t => { const c = new Date(t.createdAt); return c.getFullYear() === d.getFullYear() && c.getMonth() === d.getMonth(); }).length;
      months.push({ label: dfMonth.format(d), year: String(d.getFullYear()).slice(2), value: count });
    }
    const maxMonth = Math.max(1, ...months.map(m => m.value));

    setView(`
      <div class="page-head">
        <div><h1>סטטיסטיקה</h1><p class="muted">תמונת מצב של כל התקלות שנרשמו במערכת.</p></div>
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
          <div class="col-chart" role="img" aria-label="${esc(months.map(m => `${m.label} ${m.year}: ${m.value}`).join(', '))}">
            ${months.map(m => `<div class="col">
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
      </div>
    `);
  }

  /* ======================================================================
   * Settings
   * ==================================================================== */

  const LIST_DEFS = {
    categories: {
      title: 'קטגוריות תקלה', single: 'קטגוריה',
      fields: [{ key: 'name', label: 'שם הקטגוריה', required: true }],
      usage: id => tickets().filter(t => t.category === id).length
    },
    members: {
      title: 'חברי ועד הבית', single: 'חבר/ת ועד', hint: 'מהרשימה נבחר האחראי לכל קריאה וכותב כל עדכון.',
      fields: [{ key: 'name', label: 'שם מלא', required: true }, { key: 'phone', label: 'טלפון', type: 'tel' }],
      usage: id => tickets().filter(t => t.responsibleId === id || t.updates.some(u => u.authorId === id)).length
    },
    floors: {
      title: 'קומות', single: 'קומה',
      fields: [{ key: 'name', label: 'שם הקומה', required: true }],
      usage: id => tickets().filter(t => t.floor === id).length
    },
    areas: {
      title: 'אזורים בבניין', single: 'אזור',
      fields: [{ key: 'name', label: 'שם האזור', required: true }],
      usage: id => tickets().filter(t => t.area === id).length
    },
    vendors: {
      title: 'ספר ספקים ובעלי מקצוע', single: 'ספק', hint: 'בחירת ספק בטופס הקריאה ממלאת את פרטיו אוטומטית.',
      fields: [
        { key: 'company', label: 'חברה', required: true }, { key: 'contact', label: 'איש קשר' },
        { key: 'phone', label: 'טלפון', type: 'tel' }, { key: 'specialty', label: 'תחום התמחות' }
      ],
      usage: () => 0
    }
  };

  function itemLabel(key, item) { return key === 'vendors' ? item.company : item.name; }

  function fieldInput(key, f, value, idPrefix) {
    const id = `${idPrefix}-${key}-${f.key}`;
    return `<div class="field">
      <label for="${id}">${esc(f.label)}${f.required ? ' <span class="req" aria-hidden="true">*</span>' : ''}</label>
      <input id="${id}" name="${f.key}" value="${esc(value || '')}" ${f.type === 'tel' ? 'type="tel" dir="ltr" inputmode="tel"' : ''} ${f.required ? 'required' : ''} maxlength="80">
    </div>`;
  }

  function listCard(key) {
    const def = LIST_DEFS[key];
    const items = S()[key];
    const display = (f, it) => f.type === 'tel' ? telLink(it[f.key]) : esc(key === 'floors' ? bidiFix(it[f.key]) : (it[f.key] || '—'));
    return `
      <section class="card settings-card" id="set-${key}" aria-labelledby="h-${key}">
        <div class="card-head"><h2 id="h-${key}">${def.title}</h2><span class="count">${items.length}</span></div>
        ${def.hint ? `<p class="muted">${def.hint}</p>` : ''}
        <div class="table-wrap">
          <table class="simple-table">
            <thead><tr>${def.fields.map(f => `<th scope="col">${esc(f.label)}</th>`).join('')}<th scope="col"><span class="visually-hidden">פעולות</span></th></tr></thead>
            <tbody>
              ${items.length ? items.map(it => `<tr>
                ${def.fields.map(f => `<td data-label="${esc(f.label)}">${display(f, it)}</td>`).join('')}
                <td class="row-actions">
                  <button type="button" class="icon-btn" data-action="edit-item" data-list="${key}" data-id="${esc(it.id)}" aria-label="${esc('עריכת ' + itemLabel(key, it))}">✎</button>
                  <button type="button" class="icon-btn icon-danger" data-action="delete-item" data-list="${key}" data-id="${esc(it.id)}" aria-label="${esc('מחיקת ' + itemLabel(key, it))}">🗑</button>
                </td></tr>`).join('') : `<tr><td colspan="${def.fields.length + 1}" class="muted">הרשימה ריקה.</td></tr>`}
            </tbody>
          </table>
        </div>
        <form class="add-item-form" data-list="${key}" novalidate>
          ${def.fields.map(f => fieldInput(key, f, '', 'add')).join('')}
          <button type="submit" class="btn btn-primary">הוספת ${def.single}</button>
        </form>
      </section>`;
  }

  async function renderSettings() {
    setView(`
      <div class="page-head">
        <div><h1>הגדרות</h1><p class="muted">ניהול הרשימות במערכת, גיבוי ושחזור נתונים.</p></div>
      </div>
      <div class="settings-grid">
        ${listCard('members')}
        ${listCard('vendors')}
        ${listCard('categories')}
        ${listCard('floors')}
        ${listCard('areas')}
        <section class="card settings-card data-card" aria-labelledby="h-data">
          <div class="card-head"><h2 id="h-data">גיבוי ונתונים</h2></div>
          <p class="muted" id="storage-info">מחשב נפח אחסון…</p>
          <div class="data-actions">
            <div>
              <h3>גיבוי מלא</h3>
              <p class="muted">קובץ JSON הכולל את כל הקריאות, ההגדרות והקבצים המצורפים (בקידוד base64).</p>
              <button type="button" class="btn btn-primary" data-action="backup">⬇ הורדת קובץ גיבוי</button>
            </div>
            <div>
              <h3>שחזור מגיבוי</h3>
              <p class="muted">השחזור מחליף את כל הנתונים הקיימים בנתוני הקובץ.</p>
              <label class="btn btn-secondary file-btn">⬆ בחירת קובץ גיבוי
                <input type="file" accept=".json,application/json" id="restore-file" class="visually-hidden">
              </label>
            </div>
            <div>
              <h3>נתוני הדגמה</h3>
              <p class="muted">טעינה מחדש של 10 קריאות לדוגמה (מחליף את הנתונים הקיימים).</p>
              <button type="button" class="btn btn-secondary" data-action="restore-demo">טעינת נתוני הדגמה</button>
            </div>
            <div>
              <h3>התחלה מאפס</h3>
              <p class="muted">מחיקת כל הקריאות והקבצים. הרשימות שבהגדרות נשמרות.</p>
              <button type="button" class="btn btn-danger" data-action="wipe">🗑 מחיקת כל הנתונים</button>
            </div>
          </div>
        </section>
      </div>
    `);

    updateStorageInfo();

    appEl.onsubmit = e => {
      const form = e.target.closest('.add-item-form');
      if (!form) return;
      e.preventDefault();
      const key = form.dataset.list;
      const def = LIST_DEFS[key];
      const item = { id: uid(key.slice(0, 3)) };
      for (const f of def.fields) {
        item[f.key] = form.elements[f.key].value.trim();
        if (f.required && !item[f.key]) { toast(`יש למלא את השדה "${f.label}".`, 'error'); form.elements[f.key].focus(); return; }
      }
      const label = itemLabel(key, item);
      if (S()[key].some(x => itemLabel(key, x) === label)) { toast(`"${label}" כבר קיים ברשימה.`, 'error'); return; }
      S()[key].push(item);
      Store.save();
      toast(`"${label}" נוסף.`, 'success');
      rerenderSettingsKeepFocus(`#add-${key}-${def.fields[0].key}`);
    };

    appEl.onchange = e => { if (e.target.id === 'restore-file') restoreBackup(e.target.files[0]); };

    appEl.onclick = async e => {
      const act = e.target.closest('[data-action]');
      if (!act) return;
      const a = act.dataset.action;
      if (a === 'backup') exportBackup();
      if (a === 'restore-demo') restoreDemo();
      if (a === 'wipe') wipeAllData();
      if (a === 'edit-item') editListItem(act.dataset.list, act.dataset.id);
      if (a === 'delete-item') {
        const key = act.dataset.list;
        const item = byId(S()[key], act.dataset.id);
        if (!item) return;
        const used = LIST_DEFS[key].usage(item.id);
        if (used) { toast(`לא ניתן למחוק את "${itemLabel(key, item)}" – בשימוש ב-${used} קריאות.`, 'error'); return; }
        const ok = await confirmDialog(`למחוק את "${itemLabel(key, item)}" מהרשימה?`, { okLabel: 'מחיקה', danger: true });
        if (!ok) return;
        S()[key] = S()[key].filter(x => x.id !== item.id);
        if (key === 'vendors') tickets().forEach(t => { if (t.external.vendorId === item.id) t.external.vendorId = ''; });
        Store.save();
        toast('הפריט נמחק.', 'success');
        rerenderSettingsKeepFocus(`#h-${key}`);
      }
    };
  }

  function rerenderSettingsKeepFocus(selector) {
    const y = window.scrollY;
    renderSettings();
    window.scrollTo(0, y);
    const el = $(selector);
    if (el) { if (!el.hasAttribute('tabindex') && el.tagName === 'H2') el.setAttribute('tabindex', '-1'); el.focus({ preventScroll: true }); }
  }

  function editListItem(key, id) {
    const def = LIST_DEFS[key];
    const item = byId(S()[key], id);
    if (!item) return;
    openModal({
      title: `עריכת ${def.single}`,
      body: `<form class="modal-form" id="edit-item-form" novalidate>${def.fields.map(f => fieldInput(key, f, item[f.key], 'edit')).join('')}</form>`,
      actions: [
        {
          label: 'שמירה', className: 'btn-primary', onClick: modal => {
            const form = $('#edit-item-form', modal);
            const vals = {};
            for (const f of def.fields) {
              vals[f.key] = form.elements[f.key].value.trim();
              if (f.required && !vals[f.key]) { toast(`יש למלא את השדה "${f.label}".`, 'error'); form.elements[f.key].focus(); return false; }
            }
            Object.assign(item, vals);
            Store.save();
            toast('השינויים נשמרו.', 'success');
            setTimeout(() => rerenderSettingsKeepFocus(`#h-${key}`), 0);
            return true;
          }
        },
        { label: 'ביטול', className: 'btn-secondary' }
      ]
    });
    // Enter inside the modal form submits it
    const form = $('#edit-item-form');
    form.addEventListener('submit', e => { e.preventDefault(); $('.modal-foot [data-act="0"]').click(); });
  }

  async function updateStorageInfo() {
    const el = $('#storage-info');
    if (!el) return;
    let mediaCount = 0, mediaSize = 0;
    if (MediaDB.available) {
      try {
        const recs = await MediaDB.all();
        mediaCount = recs.length;
        mediaSize = recs.reduce((s, r) => s + (r.size || (r.blob && r.blob.size) || 0), 0);
      } catch (e) { /* ignore */ }
    }
    if (!el.isConnected) return;
    el.textContent = `במערכת ${tickets().length} קריאות ו-${mediaCount} קבצים מצורפים (${fmtSize(mediaSize)}).` +
      (MediaDB.available ? '' : ' שימו לב: אחסון קבצים (IndexedDB) אינו זמין בדפדפן זה.');
  }

  /* ======================================================================
   * Data operations: wipe, demo, backup, restore
   * ==================================================================== */

  async function wipeAllData() {
    const ok = await confirmDialog('פעולה זו תמחק את כל הקריאות, העדכונים והקבצים המצורפים.\nהרשימות שבהגדרות (חברי ועד, ספקים, קטגוריות) יישמרו.\nמומלץ לבצע גיבוי לפני כן.\n\nלהמשיך?', { title: 'מחיקת כל הנתונים', okLabel: 'כן, למחוק הכל', danger: true });
    if (!ok) return;
    if (MediaDB.available) { try { await MediaDB.clear(); } catch (e) { /* ignore */ } }
    forgetAllMedia();
    Store.data.tickets = [];
    Store.data.nextNumber = 1001;
    Store.save();
    filters = Object.assign({}, DEFAULT_FILTERS);
    toast('כל הנתונים נמחקו. אפשר להתחיל מחדש.', 'success');
    if (location.hash === '#/dashboard') route(); else location.hash = '#/dashboard';
  }

  async function restoreDemo() {
    if (tickets().length) {
      const ok = await confirmDialog('טעינת נתוני ההדגמה תחליף את כל הנתונים הקיימים (כולל ההגדרות). להמשיך?', { okLabel: 'טעינת נתוני הדגמה', danger: true });
      if (!ok) return;
    }
    await seedDemo();
    filters = Object.assign({}, DEFAULT_FILTERS);
    toast('נתוני ההדגמה נטענו.', 'success');
    if (location.hash === '#/dashboard') route(); else location.hash = '#/dashboard';
  }

  async function exportBackup() {
    toast('מכין קובץ גיבוי…', 'info');
    try {
      const recs = MediaDB.available ? await MediaDB.all() : [];
      const media = [];
      for (const r of recs) {
        media.push({ id: r.id, name: r.name, type: r.type, size: r.size, createdAt: r.createdAt, data: await blobToBase64(r.blob) });
      }
      const payload = { app: 'house-committee-faults', version: 1, exportedAt: new Date().toISOString(), data: Store.data, media };
      downloadBlob(new Blob([JSON.stringify(payload)], { type: 'application/json' }), `גיבוי-תקלות-ועד-הבית-${toDateInput(new Date())}.json`);
      toast(`הגיבוי הורד (${tickets().length} קריאות, ${media.length} קבצים).`, 'success');
    } catch (e) {
      console.error(e);
      toast('יצירת הגיבוי נכשלה.', 'error');
    }
  }

  async function restoreBackup(file) {
    if (!file) return;
    let payload;
    try {
      payload = JSON.parse(await file.text());
    } catch (e) {
      toast('הקובץ אינו קובץ גיבוי תקין (JSON שגוי).', 'error');
      return;
    }
    if (!payload || payload.app !== 'house-committee-faults' || !payload.data || !Array.isArray(payload.data.tickets)) {
      toast('הקובץ אינו קובץ גיבוי של מערכת זו.', 'error');
      return;
    }
    const ok = await confirmDialog(`לשחזר ${payload.data.tickets.length} קריאות ו-${(payload.media || []).length} קבצים מגיבוי מתאריך ${fmtDateTime(payload.exportedAt)}?\nכל הנתונים הנוכחיים יוחלפו.`, { title: 'שחזור מגיבוי', okLabel: 'שחזור', danger: true });
    if (!ok) { const inp = $('#restore-file'); if (inp) inp.value = ''; return; }
    try {
      if (MediaDB.available) {
        await MediaDB.clear();
        for (const m of payload.media || []) {
          await MediaDB.put({ id: m.id, name: m.name, type: m.type, size: m.size, createdAt: m.createdAt, blob: base64ToBlob(m.data || '', m.type || 'application/octet-stream') });
        }
      } else if ((payload.media || []).length) {
        toast('אחסון קבצים אינו זמין – הקבצים המצורפים לא שוחזרו.', 'error');
      }
      forgetAllMedia();
      Store.data = Store.normalize(payload.data);
      Store.save();
      filters = Object.assign({}, DEFAULT_FILTERS);
      toast('הנתונים שוחזרו בהצלחה.', 'success');
      location.hash = '#/dashboard';
    } catch (e) {
      console.error(e);
      toast('השחזור נכשל.', 'error');
    }
  }

  /* ======================================================================
   * Export (CSV), WhatsApp text, print
   * ==================================================================== */

  function exportCsv(list, name) {
    if (!list.length) { toast('אין קריאות לייצוא.', 'error'); return; }
    const headers = ['מספר קריאה', 'כותרת', 'תיאור', 'קטגוריה', 'מיקום', 'עדיפות', 'סטטוס', 'שם המדווח', 'טלפון המדווח', 'אופן דיווח',
      'אחראי', 'תאריך דיווח', 'עדכון אחרון', 'תאריך פתרון', 'ימים פתוחה', 'נפתחה תקלה אצל גורם חיצוני', 'חברה / ספק',
      'מספר קריאה אצל הספק', 'איש מקצוע', 'טלפון איש מקצוע', 'תאריך הפנייה', 'מועד הגעה צפוי', 'מצב מועד', 'מספר עדכונים', 'עדכון אחרון (תוכן)'];
    const rows = list.map(t => {
      const ex = t.external;
      const last = t.updates.slice().sort((a, b) => b.at.localeCompare(a.at))[0];
      const due = dueState(t);
      return [t.number, t.title, t.description, catName(t.category), locationText(t, true), priorityOf(t.priority).label, statusOf(t.status).label,
        t.reporter.name, t.reporter.phone, channelLabel(t.reporter.channel), t.responsibleId ? memberName(t.responsibleId) : '',
        fmtDateTime(t.createdAt), fmtDateTime(t.updatedAt), t.resolvedAt ? fmtDate(t.resolvedAt) : '', daysOpen(t),
        ex.opened ? 'כן' : 'לא', ex.opened ? ex.company : '', ex.opened ? ex.refNo : '', ex.opened ? ex.contactName : '',
        ex.opened ? ex.contactPhone : '', ex.opened && ex.referredAt ? fmtDate(ex.referredAt) : '',
        ex.opened && ex.expectedAt ? fmtDate(ex.expectedAt) : '', due === 'overdue' ? 'באיחור' : due === 'upcoming' ? 'מתקרב' : '',
        t.updates.length, last ? last.text : ''];
    });
    const cell = v => {
      const s = String(v ?? '').replace(/\r?\n/g, ' ');
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const csv = '﻿' + [headers, ...rows].map(r => r.map(cell).join(',')).join('\r\n');
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
      `👤 אחראי/ת מטעם הוועד: ${t.responsibleId ? memberName(t.responsibleId) : 'טרם נקבע'}`
    ];
    if (ex.opened) {
      lines.push(`🛠 גורם מטפל: ${ex.company || 'גורם חיצוני'}${ex.refNo ? ` (קריאה ${ex.refNo})` : ''}`);
      if (ex.expectedAt) {
        const due = dueState(t);
        lines.push(`📅 מועד הגעה צפוי: ${fmtDate(ex.expectedAt)}${due === 'overdue' ? ' ⚠️ המועד עבר, הוועד מטפל מול הספק' : ''}`);
      }
    }
    const last = t.updates.filter(u => u.text).sort((a, b) => b.at.localeCompare(a.at))[0];
    if (last) lines.push(`📝 עדכון אחרון (${fmtDate(last.at)}): ${last.text}`);
    lines.push('', 'ועד הבית');
    return lines.join('\n');
  }

  async function showWhatsApp(t) {
    const text = whatsappText(t);
    // Open the dialog first, then try to copy (the clipboard API may be slow or blocked).
    const { modal } = openModal({
      title: 'טקסט לקבוצת הוואטסאפ',
      body: `
        <p class="muted" id="wa-status" role="status">מעתיק ללוח…</p>
        <label for="wa-text" class="visually-hidden">טקסט ההודעה</label>
        <textarea id="wa-text" class="wa-text" rows="10" readonly>${esc(text)}</textarea>
        <a class="link-small" href="https://wa.me/?text=${encodeURIComponent(text)}" target="_blank" rel="noopener">פתיחה באפליקציית וואטסאפ ↗</a>`,
      actions: [
        { label: 'העתקה שוב', className: 'btn-whatsapp', onClick: async () => { toast(await copyWithTimeout(text) ? 'הטקסט הועתק.' : 'ההעתקה נכשלה – יש לסמן ולהעתיק ידנית.', 'success'); return false; } },
        { label: 'סגירה', className: 'btn-secondary' }
      ],
      initialFocus: '#wa-text'
    });
    const copied = await copyWithTimeout(text);
    const status = $('#wa-status', modal);
    if (!status) return;
    status.className = copied ? 'copy-ok' : 'muted';
    status.textContent = copied ? '✔ הטקסט הועתק ללוח – אפשר להדביק בקבוצת הדיירים.' : 'לא ניתן היה להעתיק אוטומטית – יש לסמן את הטקסט ולהעתיק ידנית (Ctrl+C).';
  }

  /** copyText with a fallback timeout, so a pending clipboard permission never blocks the UI. */
  function copyWithTimeout(text, ms = 1500) {
    return Promise.race([copyText(text).catch(() => false), new Promise(r => setTimeout(() => r(false), ms))]);
  }

  async function printTicket(t) {
    const ex = t.external;
    const imgIds = [];
    for (const id of allMediaIds(t)) {
      const info = await getMediaInfo(id);
      if (info && info.type.startsWith('image/')) imgIds.push(info);
    }
    const resp = member(t.responsibleId);
    const updates = t.updates.slice().sort((a, b) => b.at.localeCompare(a.at));
    const row = (k, v) => `<tr><th>${k}</th><td>${v}</td></tr>`;
    const area = $('#print-area');
    area.innerHTML = `
      <article class="print-ticket">
        <header class="print-header">
          <div>
            <p class="print-org">ועד הבית · סיכום קריאה</p>
            <h1>קריאה #${t.number}: ${esc(t.title)}</h1>
          </div>
          <p class="print-date">הופק ב-${fmtDateTime(new Date())}</p>
        </header>
        <table class="print-table">
          ${row('סטטוס', esc(statusOf(t.status).label))}
          ${row('עדיפות', esc(priorityOf(t.priority).label))}
          ${row('קטגוריה', esc(catName(t.category)))}
          ${row('מיקום', esc(locationText(t)))}
          ${row('מדווח/ת', esc([t.reporter.name, t.reporter.phone].filter(Boolean).join(' · ') || '—') + ' (' + esc(channelLabel(t.reporter.channel)) + ')')}
          ${row('אחראי/ת', resp ? esc(resp.name + (resp.phone ? ' · ' + resp.phone : '')) : '—')}
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
        <h2>עדכונים (${updates.length})</h2>
        ${updates.length ? `<ol class="print-updates">${updates.map(u => `<li><strong>${fmtDateTime(u.at)} · ${esc(u.authorId ? memberName(u.authorId) : 'ללא שם')}</strong>
          ${u.statusChange ? `<br><em>הסטטוס שונה מ"${esc(statusOf(u.statusChange.from).label)}" ל"${esc(statusOf(u.statusChange.to).label)}"</em>` : ''}
          ${u.text ? `<br>${nl2br(u.text)}` : ''}</li>`).join('')}</ol>` : '<p>אין עדכונים.</p>'}
        ${imgIds.length ? `<h2>תמונות</h2><div class="print-images">${imgIds.map(i => `<img src="${i.url}" alt="${esc(i.name)}">`).join('')}</div>` : ''}
      </article>`;
    // Wait (briefly) for images before opening the print dialog
    await Promise.all($$('img', area).map(img => img.complete ? null : new Promise(r => { img.onload = img.onerror = r; setTimeout(r, 1500); })));
    document.body.classList.add('printing');
    window.print();
  }

  window.addEventListener('afterprint', () => {
    document.body.classList.remove('printing');
    $('#print-area').innerHTML = '';
  });

  /* ======================================================================
   * Accessibility menu
   * ==================================================================== */

  const A11Y_DEFAULT = { font: 100, contrast: false, links: false, readable: false, spacing: false, motion: false, cursor: false };
  let a11y = Object.assign({}, A11Y_DEFAULT);

  function applyA11y() {
    const html = document.documentElement;
    html.style.fontSize = a11y.font + '%';
    ['contrast', 'links', 'readable', 'spacing', 'motion', 'cursor'].forEach(k => {
      html.classList.toggle('a11y-' + k, !!a11y[k]);
      const btn = $(`[data-a11y-toggle="${k}"]`);
      if (btn) btn.setAttribute('aria-pressed', String(!!a11y[k]));
    });
    $('#a11y-font-value').textContent = a11y.font + '%';
    try { localStorage.setItem(A11Y_KEY, JSON.stringify(a11y)); } catch (e) { /* not persisted */ }
  }

  function initA11y() {
    try { a11y = Object.assign({}, A11Y_DEFAULT, JSON.parse(localStorage.getItem(A11Y_KEY) || '{}')); } catch (e) { a11y = Object.assign({}, A11Y_DEFAULT); }
    applyA11y();
    const toggle = $('#a11y-toggle');
    const panel = $('#a11y-panel');
    const setOpen = open => {
      panel.hidden = !open;
      toggle.setAttribute('aria-expanded', String(open));
      if (open) $('.a11y-opt', panel).focus(); else toggle.focus();
    };
    toggle.addEventListener('click', () => setOpen(panel.hidden));
    panel.addEventListener('keydown', e => { if (e.key === 'Escape') { e.stopPropagation(); setOpen(false); } });
    document.addEventListener('click', e => {
      if (!panel.hidden && !panel.contains(e.target) && !toggle.contains(e.target)) { panel.hidden = true; toggle.setAttribute('aria-expanded', 'false'); }
    });
    panel.addEventListener('click', e => {
      const t = e.target.closest('[data-a11y-toggle]');
      if (t) { const k = t.dataset.a11yToggle; a11y[k] = !a11y[k]; applyA11y(); return; }
      const b = e.target.closest('[data-a11y]');
      if (!b) return;
      const a = b.dataset.a11y;
      if (a === 'font-inc') a11y.font = Math.min(160, a11y.font + 10);
      if (a === 'font-dec') a11y.font = Math.max(80, a11y.font - 10);
      if (a === 'reset') a11y = Object.assign({}, A11Y_DEFAULT);
      if (a === 'close') { setOpen(false); return; }
      applyA11y();
    });
  }

  /* ======================================================================
   * Keyboard shortcuts & startup
   * ==================================================================== */

  function initShortcuts() {
    document.addEventListener('keydown', e => {
      if (e.ctrlKey || e.metaKey || e.altKey || document.body.classList.contains('modal-open')) return;
      const tag = (e.target.tagName || '').toLowerCase();
      if (['input', 'textarea', 'select'].includes(tag) || e.target.isContentEditable) return;
      if (e.code === 'KeyN') { e.preventDefault(); location.hash = '#/new'; }
      if (e.code === 'Slash') {
        e.preventDefault();
        const focusSearch = () => { const s = $('#f-q'); if (s) s.focus(); };
        if ($('#f-q')) focusSearch(); else { location.hash = '#/dashboard'; setTimeout(focusSearch, 50); }
      }
    });
  }

  async function init() {
    appEl = $('#app');
    initA11y();
    initShortcuts();
    await MediaDB.init();

    const found = Store.load();
    if (!found) await seedDemo();

    const banner = $('#storage-banner');
    const warnings = [];
    if (!Store.persistent) warnings.push('האחסון המקומי בדפדפן חסום – הנתונים לא יישמרו לאחר סגירת הדף.');
    if (!MediaDB.available) warnings.push('אחסון הקבצים (IndexedDB) אינו זמין – לא ניתן יהיה לצרף תמונות וסרטונים.');
    if (warnings.length) { banner.textContent = '⚠ ' + warnings.join(' '); banner.hidden = false; }

    window.addEventListener('hashchange', route);
    if (!location.hash) { try { history.replaceState(null, '', '#/dashboard'); } catch (e) { /* hash stays empty; router defaults to dashboard */ } }
    route();
  }

  document.addEventListener('DOMContentLoaded', () => {
    init().catch(err => {
      console.error(err);
      $('#app').innerHTML = '<div class="alert alert-danger" role="alert">אירעה שגיאה בטעינת המערכת. נסו לרענן את הדף.</div>';
    });
  });
})();
