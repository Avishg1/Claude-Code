'use strict';

// Default lists for a new building, and the optional demo data set.

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const db = require('./db');

const DAY = 864e5;

const DEFAULT_OPTIONS = {
  category: ['מעלית', 'אינסטלציה', 'חשמל', 'אינטרקום', 'תאורה', 'ניקיון', 'בטיחות', 'גינה', 'חניה', 'אחר'],
  floor: ['קומה -2', 'קומה -1', 'קומת קרקע', 'קומה 1', 'קומה 2', 'קומה 3', 'קומה 4', 'קומה 5', 'קומה 6', 'קומה 7', 'קומה 8'],
  area: ['לובי', 'חדר מדרגות', 'מעלית', 'גג', 'חניה', 'דירה', 'חצר וגינה', 'אחר'],
};

const DEMO_VENDORS = [
  { company: 'מעליות השרון בע״מ', contact: 'יוסי לוי', phone: '050-7771234', specialty: 'מעליות' },
  { company: 'אינסטלציה גולן', contact: 'משה גולן', phone: '052-6665432', specialty: 'אינסטלציה' },
  { company: 'קשר-טק מערכות אינטרקום', contact: 'אלון ברק', phone: '053-4443210', specialty: 'אינטרקום ובקרת כניסה' },
  { company: 'חשמל הצפון', contact: 'סאמר חורי', phone: '054-2223344', specialty: 'חשמל' },
  { company: 'גנני העמק', contact: 'רחל אדלר', phone: '058-1110099', specialty: 'גינון והשקיה' },
];

const nowIso = () => new Date().toISOString();

function toDateInput(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function insertDefaultOptions(buildingId) {
  const insert = db.prepare('INSERT OR IGNORE INTO options (building_id, kind, name, position) VALUES (?, ?, ?, ?)');
  for (const [kind, names] of Object.entries(DEFAULT_OPTIONS)) {
    names.forEach((name, i) => insert.run(buildingId, kind, name, i));
  }
}

/** Id of the option with this name, creating it if the building's list no longer has it. */
function optionId(buildingId, kind, name) {
  const row = db.prepare('SELECT id FROM options WHERE building_id = ? AND kind = ? AND name = ?').get(buildingId, kind, name);
  if (row) return row.id;
  const pos = db.prepare('SELECT COALESCE(MAX(position), -1) + 1 AS p FROM options WHERE building_id = ? AND kind = ?').get(buildingId, kind).p;
  return Number(db.prepare('INSERT INTO options (building_id, kind, name, position) VALUES (?, ?, ?, ?)').run(buildingId, kind, name, pos).lastInsertRowid);
}

function escXml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]));
}

function placeholderSvg(title, color) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600" viewBox="0 0 800 600">
<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${color}"/><stop offset="1" stop-color="#0a1f3d"/></linearGradient></defs>
<rect width="800" height="600" fill="url(#g)"/>
<g fill="none" stroke="#fff" stroke-opacity=".55" stroke-width="10" stroke-linejoin="round">
<rect x="290" y="170" width="220" height="160" rx="18"/><circle cx="400" cy="250" r="48"/><path d="M335 170l20-28h90l20 28"/></g>
<text x="400" y="420" font-family="Segoe UI, Arial, sans-serif" font-size="42" font-weight="700" fill="#fff" text-anchor="middle" direction="rtl">${escXml(title)}</text>
<text x="400" y="470" font-family="Segoe UI, Arial, sans-serif" font-size="26" fill="#fff" fill-opacity=".8" text-anchor="middle" direction="rtl">תמונה לדוגמה</text>
</svg>`;
}

/** Delete media files from disk (rows are removed by the caller / cascades). */
function removeFiles(files) {
  for (const file of files) {
    fs.rm(path.join(db.uploadsDir, path.basename(file)), { force: true }, () => {});
  }
}

/**
 * Replace the building's tickets with 10 realistic demo tickets.
 * memberIds: the building's members; demo "committee members" m1..m3 map onto them.
 */
function seedDemo(buildingId, memberIds) {
  const now = Date.now();
  const at = (days, hours = 0) => new Date(now - days * DAY - hours * 3600e3).toISOString();
  const dOff = (days) => { const d = new Date(); d.setDate(d.getDate() + days); return toDateInput(d); };
  const m = (i) => memberIds[(i - 1) % memberIds.length] || null;
  const cat = (n) => optionId(buildingId, 'category', n);
  const fl = (n) => optionId(buildingId, 'floor', n);
  const ar = (n) => optionId(buildingId, 'area', n);
  const newFiles = [];

  const oldFiles = db.prepare('SELECT file FROM media WHERE building_id = ?').all(buildingId).map((r) => r.file);

  db.transaction(() => {
    db.prepare('DELETE FROM tickets WHERE building_id = ?').run(buildingId);

    // Demo vendors (only those not already in the directory)
    const vendorIds = DEMO_VENDORS.map((v) => {
      const row = db.prepare('SELECT id FROM vendors WHERE building_id = ? AND company = ?').get(buildingId, v.company);
      if (row) return row.id;
      return Number(db.prepare('INSERT INTO vendors (building_id, company, contact, phone, specialty) VALUES (?, ?, ?, ?, ?)')
        .run(buildingId, v.company, v.contact, v.phone, v.specialty).lastInsertRowid);
    });
    const ext = (vi, o) => {
      const v = vi ? DEMO_VENDORS[vi - 1] : null;
      return Object.assign({
        opened: 1, vendorId: vi ? vendorIds[vi - 1] : null,
        company: v ? v.company : '', contact: v ? v.contact : '', phone: v ? v.phone : '',
      }, o);
    };

    const insTicket = db.prepare(`
      INSERT INTO tickets (building_id, number, title, description, category_id, floor_id, area_id, apartment, priority, status,
        reporter_name, reporter_phone, reporter_channel, responsible_id, created_by, created_at, updated_at, resolved_at,
        ext_opened, ext_vendor_id, ext_company, ext_ref, ext_contact, ext_phone, ext_referred_at, ext_expected_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    const insUpdate = db.prepare('INSERT INTO ticket_updates (ticket_id, author_id, text, status_from, status_to, created_at) VALUES (?, ?, ?, ?, ?, ?)');
    const insHist = db.prepare('INSERT INTO status_history (ticket_id, status, by_id, at) VALUES (?, ?, ?, ?)');
    const insMedia = db.prepare('INSERT INTO media (building_id, ticket_id, update_id, name, type, size, file, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');

    const addImage = (ticketId, updateId, title, color) => {
      const svg = Buffer.from(placeholderSvg(title, color), 'utf8');
      const file = `${crypto.randomBytes(16).toString('hex')}.svg`;
      fs.writeFileSync(path.join(db.uploadsDir, file), svg);
      newFiles.push(file);
      insMedia.run(buildingId, ticketId, updateId, `${title}.svg`, 'image/svg+xml', svg.length, file, nowIso());
    };

    const demo = [
      {
        number: 1001, title: 'רעש חריג וחריקות במעלית', description: 'דיירים מדווחים על חריקות חזקות בזמן תנועת המעלית, בעיקר בין הקומות 2 ל-4.',
        cat: 'מעלית', floor: 'קומת קרקע', area: 'מעלית', priority: 'medium', status: 'closed',
        reporter: ['משה אברהם', '050-1234567', 'whatsapp'], resp: 2, created: at(150), resolved: at(146),
        history: [['new', 150], ['waiting_vendor', 149], ['resolved', 146], ['closed', 144]],
        ext: ext(1, { ref: 'SC-31877', referred: dOff(-149), expected: dOff(-147) }),
        updates: [[149, 0, 2, 'נפתחה קריאת שירות בחברת המעליות, מספר SC-31877.'], [146, 0, 2, 'הטכנאי החליף גלגלת שחוקה ושימן את המסילות. הרעש נפסק.'], [144, 0, 1, 'נבדק מול הדיירים – אין תלונות נוספות. הקריאה נסגרת.']],
      },
      {
        number: 1002, title: 'המעלית נעצרת בין קומות', description: 'דיירת נתקעה במעלית בין קומה 3 לקומה 4 למשך כ-10 דקות. המעלית חזרה לפעול לאחר איפוס.',
        cat: 'מעלית', floor: 'קומה 4', area: 'מעלית', priority: 'high', status: 'resolved',
        reporter: ['שרה לוין', '052-7654321', 'phone'], resp: 2, created: at(75), resolved: at(72),
        history: [['new', 75], ['waiting_vendor', 75], ['resolved', 72]],
        ext: ext(1, { ref: 'SC-40552', referred: dOff(-75), expected: dOff(-74) }),
        updates: [[75, 0, 2, 'הדיירת חולצה על ידי טכנאי החברה. נפתחה קריאה לבדיקה מקיפה.'], [72, 0, 2, 'הוחלף חיישן דלת בקומה 4. המעלית תקינה.']],
      },
      {
        number: 1003, title: 'הפסקות חשמל חוזרות בלוח קומה 2', description: 'בשבוע האחרון קפץ החשמל בחדר המדרגות של קומה 2 שלוש פעמים.',
        cat: 'חשמל', floor: 'קומה 2', area: 'חדר מדרגות', priority: 'high', status: 'cancelled',
        reporter: ['יעקב דהן', '054-3332211', 'in_person'], resp: 3, created: at(40), resolved: null,
        history: [['new', 40], ['in_progress', 39], ['cancelled', 38]],
        ext: ext(4, { ref: '', referred: dOff(-39), expected: dOff(-39) }),
        updates: [[39, 0, 3, 'החשמלאי בדק את הלוח המשותף – הלוח תקין.'], [38, 0, 3, 'התברר שהתקלה בלוח הפרטי של דירה 7 ובאחריות הדייר. הקריאה בוטלה.']],
      },
      {
        number: 1004, title: 'הלובי לא נוקה במשך שבוע', description: 'רצפת הלובי מלוכלכת ופחי האשפה ליד הכניסה מלאים.',
        cat: 'ניקיון', floor: 'קומת קרקע', area: 'לובי', priority: 'medium', status: 'resolved',
        reporter: ['רחל גבאי', '053-9090901', 'whatsapp'], resp: 1, created: at(20), resolved: at(12),
        history: [['new', 20], ['in_progress', 19], ['resolved', 12]], ext: null,
        updates: [[19, 0, 1, 'שוחחתי עם חברת הניקיון – העובד הקבוע היה בחופשה ולא נשלח מחליף.'], [12, 0, 1, 'הניקיון חזר לסדרו. סוכם על בדיקה שבועית מול החברה.']],
      },
      {
        number: 1005, title: 'שער החניה לא נפתח בשלט', description: 'השער החשמלי בכניסה לחניון אינו מגיב לשלטים. דיירים לא יכולים לצאת עם הרכב.',
        cat: 'חניה', floor: 'קומה -1', area: 'חניה', priority: 'urgent', status: 'resolved',
        reporter: ['אורי שמש', '058-4445566', 'phone'], resp: 2, created: at(12), resolved: at(9),
        history: [['new', 12], ['waiting_vendor', 12], ['waiting_parts', 11], ['resolved', 9]],
        ext: ext(0, { company: 'שערים ובקרה מ.ש.', ref: 'G-2291', contact: 'מיכאל שושן', phone: '052-1239876', referred: dOff(-12), expected: dOff(-10) }),
        updates: [[12, 0, 2, 'השער נפתח ידנית ויישאר פתוח עד לתיקון.'], [11, 0, 2, 'הטכנאי אבחן מנוע שרוף. הוזמן מנוע חלופי.'], [9, 0, 2, 'המנוע הוחלף והשער פועל כרגיל.', ['שער החניה לאחר התיקון', '#15803d']]],
      },
      {
        number: 1006, title: 'נזילת מים מצנרת בתקרת החניון', description: 'מים מטפטפים מהתקרה מעל מקום חניה 14. נראה שמקור הנזילה בצנרת הביוב המשותפת.',
        cat: 'אינסטלציה', floor: 'קומה -2', area: 'חניה', priority: 'high', status: 'in_progress',
        reporter: ['דוד פרידמן', '050-8887766', 'whatsapp'], resp: 3, created: at(6), resolved: null,
        image: ['נזילה בתקרת החניון', '#0e7490'],
        history: [['new', 6], ['in_progress', 5]],
        ext: ext(2, { ref: 'P-118', referred: dOff(-4), expected: dOff(1) }),
        updates: [[6, 0, 3, 'הונח דלי מתחת לנזילה והמקום סומן. בעל מקום החניה עודכן.', ['דלי מתחת לנזילה', '#1e40af']], [4, 0, 3, 'האינסטלטור ביקר – נדרשת החלפת קטע צנרת. יחזור עם החלקים.']],
      },
      {
        number: 1007, title: 'המעלית תקועה בקומה 3', description: 'המעלית עומדת בקומה 3 עם דלתות פתוחות ואינה מגיבה לקריאות. דיירים מבוגרים בקומות העליונות מתקשים.',
        cat: 'מעלית', floor: 'קומה 3', area: 'מעלית', priority: 'urgent', status: 'waiting_vendor',
        reporter: ['נועה ברגר', '054-1010101', 'phone'], resp: 2, created: at(4), resolved: null,
        image: ['מעלית – קומה 3', '#b91c1c'],
        history: [['new', 4], ['waiting_vendor', 4]],
        ext: ext(1, { ref: 'SC-48213', referred: dOff(-3), expected: dOff(-1) }),
        updates: [[3, 0, 2, 'נפתחה קריאה בחברת המעליות (SC-48213). הובטח טכנאי תוך יום.'], [0, 5, 2, 'הטכנאי לא הגיע במועד. נשלחה תזכורת למוקד החברה.']],
      },
      {
        number: 1008, title: 'האינטרקום בכניסה הראשית לא מצלצל', description: 'לחיצה על כפתורי הדירות בפאנל הכניסה אינה מצלצלת בדירות. הדלת נפתחת רק עם מפתח.',
        cat: 'אינטרקום', floor: 'קומת קרקע', area: 'לובי', priority: 'medium', status: 'waiting_parts',
        reporter: ['גלית חן', '052-2020202', 'committee'], resp: 1, created: at(3), resolved: null,
        history: [['new', 3], ['waiting_vendor', 3], ['waiting_parts', 2]],
        ext: ext(3, { ref: 'IT-5520', referred: dOff(-2), expected: dOff(6) }),
        updates: [[2, 0, 1, 'הטכנאי אבחן תקלה בלוח הלחצנים. הוזמן לוח חדש מהספק, זמן אספקה כשבוע.']],
      },
      {
        number: 1009, title: 'דלת יציאת החירום בקומה 6 לא נסגרת', description: 'דלת האש בחדר המדרגות בקומה 6 נשארת פתוחה ואינה נטרקת מעצמה.',
        cat: 'בטיחות', floor: 'קומה 6', area: 'חדר מדרגות', priority: 'high', status: 'in_progress',
        reporter: ['מיכל רוזן', '053-3030303', 'in_person'], resp: 3, created: at(1), resolved: null,
        history: [['new', 1], ['in_progress', 0, 20]], ext: null,
        updates: [[0, 20, 3, 'המחזיר ההידראולי של הדלת שבור. אוספת הצעות מחיר להחלפה.']],
      },
      {
        number: 1010, title: 'נורה שרופה בחדר המדרגות', description: 'הנורה בחדר המדרגות ליד דירה 18 אינה דולקת. חשוך מאוד בערב.',
        cat: 'תאורה', floor: 'קומה 5', area: 'חדר מדרגות', apartment: '18', priority: 'low', status: 'new',
        reporter: ['יוסף כץ', '050-4040404', 'whatsapp'], resp: 1, created: at(0, 5), resolved: null,
        history: [['new', 0, 5]], ext: null, updates: [],
      },
    ];

    for (const d of demo) {
      const stamps = [d.created, ...d.history.map(([, dd, h]) => at(dd, h || 0)), ...d.updates.map(([dd, h]) => at(dd, h))];
      const updated = stamps.sort().pop();
      const e = d.ext;
      const id = Number(insTicket.run(
        buildingId, d.number, d.title, d.description, cat(d.cat), fl(d.floor), ar(d.area), d.apartment || null, d.priority, d.status,
        d.reporter[0], d.reporter[1], d.reporter[2], m(d.resp), m(d.resp), d.created, updated, d.resolved,
        e ? 1 : 0, e ? e.vendorId : null, e ? e.company : null, e ? e.ref || null : null, e ? e.contact : null, e ? e.phone : null,
        e ? e.referred : null, e ? e.expected : null,
      ).lastInsertRowid);
      d.history.forEach(([status, dd, h]) => insHist.run(id, status, m(d.resp), at(dd, h || 0)));
      if (d.image) addImage(id, null, d.image[0], d.image[1]);
      for (const [dd, h, author, text, img] of d.updates) {
        const uid = Number(insUpdate.run(id, m(author), text, null, null, at(dd, h)).lastInsertRowid);
        if (img) addImage(id, uid, img[0], img[1]);
      }
    }
    db.prepare('UPDATE buildings SET next_number = 1011 WHERE id = ?').run(buildingId);
  });

  removeFiles(oldFiles);
  return { files: newFiles.length };
}

module.exports = { DEFAULT_OPTIONS, insertDefaultOptions, seedDemo, removeFiles, nowIso };
