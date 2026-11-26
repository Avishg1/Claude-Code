'use strict';

const path = require('node:path');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const crypto = require('node:crypto');
const { promisify } = require('node:util');
const express = require('express');
const db = require('./db');
const markdown = require('./markdown');
const { insertDefaultOptions, seedDemo, removeFiles, nowIso } = require('./seed');
const bank = require('./bank');

const PORT = Number(process.env.PORT) || 3100;
const COOKIE_NAME = 'hcf_session';
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 7; // 7 days
const SECURE_COOKIES = process.env.NODE_ENV === 'production';
const MAX_UPLOAD = '200mb';
const MAX_BACKUP = '1gb';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const PHONE_RE = /^[0-9+\-\s()]{7,20}$/;

const STATUSES = ['new', 'in_progress', 'waiting_vendor', 'waiting_parts', 'resolved', 'closed', 'cancelled'];
const DONE_STATUSES = new Set(['resolved', 'closed']);
const PRIORITIES = ['low', 'medium', 'high', 'urgent'];
const CHANNELS = ['whatsapp', 'phone', 'in_person', 'committee'];
const OPTION_KINDS = ['category', 'floor', 'area'];
const MEDIA_TYPES = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp',
  mp4: 'video/mp4', mov: 'video/quicktime', webm: 'video/webm',
};

/* ------------------------------------------------------------------ */
/* Password hashing (scrypt, built into Node's crypto module)          */
/* ------------------------------------------------------------------ */

const scrypt = promisify(crypto.scrypt);
const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64 };

async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = await scrypt(password, salt, SCRYPT.keylen, { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p });
  return ['scrypt', SCRYPT.N, SCRYPT.r, SCRYPT.p, salt.toString('hex'), hash.toString('hex')].join('$');
}

async function verifyPassword(password, stored) {
  const [alg, N, r, p, saltHex, hashHex] = String(stored).split('$');
  if (alg !== 'scrypt' || !saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, 'hex');
  const actual = await scrypt(password, Buffer.from(saltHex, 'hex'), expected.length, {
    N: Number(N), r: Number(r), p: Number(p),
  });
  return crypto.timingSafeEqual(expected, actual);
}

// Used when the email doesn't exist, so login takes the same time either way.
const DUMMY_HASH = (() => {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync('dummy-password', salt, SCRYPT.keylen, { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p });
  return ['scrypt', SCRYPT.N, SCRYPT.r, SCRYPT.p, salt.toString('hex'), hash.toString('hex')].join('$');
})();

/* ------------------------------------------------------------------ */
/* Sessions (random token in an HttpOnly cookie, SHA-256 hash in DB)   */
/* ------------------------------------------------------------------ */

const hashToken = (token) => crypto.createHash('sha256').update(token).digest('hex');

function getCookie(req, name) {
  const header = req.headers.cookie;
  if (!header) return null;
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i === -1) continue;
    if (part.slice(0, i).trim() === name) {
      try { return decodeURIComponent(part.slice(i + 1).trim()); } catch { return null; }
    }
  }
  return null;
}

const cookieOptions = () => ({ httpOnly: true, sameSite: 'lax', secure: SECURE_COOKIES, path: '/' });

function startSession(res, userId) {
  const token = crypto.randomBytes(32).toString('base64url');
  db.prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)')
    .run(hashToken(token), userId, Date.now() + SESSION_TTL_MS);
  res.cookie(COOKIE_NAME, token, { ...cookieOptions(), maxAge: SESSION_TTL_MS });
}

function purgeExpiredSessions() {
  db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(Date.now());
}

/* ------------------------------------------------------------------ */
/* Generic helpers                                                     */
/* ------------------------------------------------------------------ */

function parseId(value) {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
}

function isValidDate(s) {
  if (typeof s !== 'string' || !DATE_RE.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

const cleanText = (v) => (typeof v === 'string' ? v.trim().replace(/\s+/g, ' ') : '');

function readName(value) {
  const name = cleanText(value);
  if (!name) return { error: 'יש להזין שם' };
  if (name.length > 60) return { error: 'השם ארוך מדי (עד 60 תווים)' };
  return { name };
}

function readPhone(value) {
  const phone = cleanText(value);
  if (phone && !PHONE_RE.test(phone)) return { error: 'מספר הטלפון אינו תקין' };
  return { phone: phone || null };
}

const isUniqueViolation = (err) => String(err?.message).includes('UNIQUE');

/** Every uploaded file of a building (ticket media + contract documents). */
const buildingFiles = (buildingId) => db.prepare('SELECT file FROM media WHERE building_id = ? UNION ALL SELECT file FROM contract_files WHERE building_id = ?')
  .all(buildingId, buildingId).map((r) => r.file);

/* ------------------------------------------------------------------ */
/* App setup                                                           */
/* ------------------------------------------------------------------ */

const app = express();
app.disable('x-powered-by');

app.use((req, res, next) => {
  res.set({
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'same-origin',
    'Content-Security-Policy': "default-src 'self'; img-src 'self' blob: data:; media-src 'self' blob:; style-src 'self' 'unsafe-inline'; script-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'",
  });
  next();
});

// Small JSON bodies everywhere, except routes that have their own (large) parser.
const smallJson = express.json({ limit: '200kb' });
const LARGE_JSON_ROUTES = new Set(['/api/building/backup', '/api/bank/import']);
app.use((req, res, next) => (LARGE_JSON_ROUTES.has(req.path) ? next() : smallJson(req, res, next)));

// The building `buildingId` as seen by `userId`, or null if they aren't a member.
function membership(buildingId, userId) {
  if (!buildingId) return null;
  return db.prepare(`
    SELECT b.id, b.name, b.address, b.owner_id AS ownerId, m.role
    FROM buildings b
    JOIN building_members m ON m.building_id = b.id AND m.user_id = ?
    WHERE b.id = ?
  `).get(userId, buildingId) || null;
}

function firstBuildingOf(userId) {
  const row = db.prepare(`
    SELECT b.id FROM buildings b JOIN building_members m ON m.building_id = b.id
    WHERE m.user_id = ? ORDER BY b.name COLLATE NOCASE LIMIT 1
  `).get(userId);
  return row ? row.id : null;
}

// Attach the logged-in user (if any) and the building this request works in.
app.use((req, res, next) => {
  req.user = null;
  req.building = null;
  const token = getCookie(req, COOKIE_NAME);
  if (token) {
    const row = db.prepare(`
      SELECT u.id, u.email, u.name, u.phone, u.active_building_id AS activeBuildingId, s.expires_at AS expiresAt
      FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = ?
    `).get(hashToken(token));
    if (row && row.expiresAt > Date.now()) {
      req.user = { id: row.id, email: row.email, name: row.name, phone: row.phone || '' };
      req.sessionTokenHash = hashToken(token);

      // Pages send the building they show (X-Building-Id), so two tabs on different
      // buildings never mix. A page that hasn't loaded yet gets the last one chosen.
      const requested = req.get('X-Building-Id');
      if (requested) {
        req.building = membership(parseId(requested), row.id);
        if (!req.building) req.buildingGone = true;
      }
      req.building ||= membership(row.activeBuildingId, row.id) || membership(firstBuildingOf(row.id), row.id);
    }
  }
  next();
});

function requireAuth(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'יש להתחבר מחדש' });
  next();
}

function requireBuilding(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'יש להתחבר מחדש' });
  if (req.buildingGone) return res.status(409).json({ error: 'אין לך יותר גישה לבניין הזה', code: 'building_gone' });
  if (!req.building) return res.status(409).json({ error: 'עדיין אין בניין. יש ליצור בניין או לבקש הצטרפות.', code: 'no_building' });
  next();
}

function requireOwner(req, res, next) {
  if (req.building.role !== 'owner') return res.status(403).json({ error: 'רק מנהל/ת הבניין יכול/ה לעשות זאת' });
  next();
}

/* ------------------------------------------------------------------ */
/* Pages                                                               */
/* ------------------------------------------------------------------ */

const VIEWS = path.join(__dirname, 'views');

function sendPage(res, file) {
  res.set('Cache-Control', 'no-store');
  res.sendFile(path.join(VIEWS, file));
}

const APP_ROUTES = ['/dashboard', '/table', '/calendar', '/stats', '/settings', '/tickets/new', '/tickets/:id', '/tickets/:id/edit',
  '/contracts', '/contracts/new', '/contracts/:id', '/contracts/:id/edit', '/bank'];

app.get('/', (req, res) => (req.user ? res.redirect('/dashboard') : sendPage(res, 'index.html')));
app.get(APP_ROUTES, (req, res) => (req.user ? sendPage(res, 'app.html') : res.redirect('/')));

// User guide: README.he.md rendered into views/help.html. Open to everyone.
app.get('/help', async (req, res, next) => {
  try {
    const [template, guide] = await Promise.all([
      fsp.readFile(path.join(VIEWS, 'help.html'), 'utf8'),
      fsp.readFile(path.join(__dirname, 'README.he.md'), 'utf8'),
    ]);
    const back = req.user ? { href: '/dashboard', label: 'חזרה לקריאות' } : { href: '/', label: 'חזרה להתחברות' };
    res.set('Cache-Control', 'no-store');
    res.type('html').send(template
      .replaceAll('<!--BACK_HREF-->', back.href)
      .replace('<!--BACK_LABEL-->', back.label)
      .replace('<!--GUIDE-->', () => markdown.render(guide)));
  } catch (err) {
    next(err);
  }
});

app.use(express.static(path.join(__dirname, 'public'), { index: false }));

/* ------------------------------------------------------------------ */
/* Auth & profile                                                      */
/* ------------------------------------------------------------------ */

function readCredentials(body) {
  const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : '';
  const password = typeof body?.password === 'string' ? body.password : '';
  return { email, password };
}

app.post('/api/auth/signup', async (req, res) => {
  const { email, password } = readCredentials(req.body);
  const { name, error: nameError } = readName(req.body?.name);
  if (nameError) return res.status(400).json({ error: nameError });
  const { phone, error: phoneError } = readPhone(req.body?.phone);
  if (phoneError) return res.status(400).json({ error: phoneError });
  if (!EMAIL_RE.test(email) || email.length > 254) return res.status(400).json({ error: 'כתובת האימייל אינה תקינה' });
  if (password.length < 8) return res.status(400).json({ error: 'הסיסמה חייבת להכיל לפחות 8 תווים' });
  if (password.length > 200) return res.status(400).json({ error: 'הסיסמה ארוכה מדי' });
  if (db.prepare('SELECT 1 FROM users WHERE email = ?').get(email)) {
    return res.status(409).json({ error: 'כבר קיים חשבון עם כתובת האימייל הזו' });
  }
  const passwordHash = await hashPassword(password);
  let userId;
  try {
    userId = Number(db.prepare('INSERT INTO users (email, password_hash, name, phone, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(email, passwordHash, name, phone, nowIso()).lastInsertRowid);
  } catch (err) {
    if (isUniqueViolation(err)) return res.status(409).json({ error: 'כבר קיים חשבון עם כתובת האימייל הזו' });
    throw err;
  }
  startSession(res, userId);
  res.status(201).json({ user: { id: userId, email, name, phone: phone || '' } });
});

app.post('/api/auth/login', async (req, res) => {
  const { email, password } = readCredentials(req.body);
  if (!email || !password) return res.status(400).json({ error: 'יש להזין אימייל וסיסמה' });
  const user = db.prepare('SELECT id, email, name, password_hash AS passwordHash FROM users WHERE email = ?').get(email);
  const ok = await verifyPassword(password, user ? user.passwordHash : DUMMY_HASH);
  if (!user || !ok) return res.status(401).json({ error: 'אימייל או סיסמה שגויים' });
  purgeExpiredSessions();
  startSession(res, user.id);
  res.json({ user: { id: user.id, email: user.email, name: user.name } });
});

app.post('/api/auth/logout', (req, res) => {
  if (req.sessionTokenHash) db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(req.sessionTokenHash);
  res.clearCookie(COOKIE_NAME, cookieOptions());
  res.status(204).end();
});

const buildingInfo = (b) => (b ? { id: b.id, name: b.name, address: b.address || '', role: b.role, isOwner: b.role === 'owner' } : null);

function listBuildings(userId) {
  return db.prepare(`
    SELECT b.id, b.name, b.address, m.role,
           (SELECT COUNT(*) FROM building_members x WHERE x.building_id = b.id) AS memberCount
    FROM buildings b JOIN building_members m ON m.building_id = b.id AND m.user_id = ?
    ORDER BY b.name COLLATE NOCASE
  `).all(userId);
}

function listMembers(buildingId) {
  return db.prepare(`
    SELECT u.id, u.name, u.email, COALESCE(u.phone, '') AS phone, m.role
    FROM building_members m JOIN users u ON u.id = m.user_id
    WHERE m.building_id = ?
    ORDER BY m.role = 'owner' DESC, u.name COLLATE NOCASE
  `).all(buildingId);
}

// Everything a page needs to start.
app.get('/api/auth/me', requireAuth, (req, res) => {
  if (req.buildingGone) return res.status(409).json({ error: 'אין לך יותר גישה לבניין הזה', code: 'building_gone' });
  res.json({
    user: req.user,
    building: buildingInfo(req.building),
    buildings: listBuildings(req.user.id),
    members: req.building ? listMembers(req.building.id) : [],
  });
});

app.put('/api/profile', requireAuth, (req, res) => {
  const { name, error } = readName(req.body?.name);
  if (error) return res.status(400).json({ error });
  const { phone, error: phoneError } = readPhone(req.body?.phone);
  if (phoneError) return res.status(400).json({ error: phoneError });
  db.prepare('UPDATE users SET name = ?, phone = ? WHERE id = ?').run(name, phone, req.user.id);
  res.json({ user: { ...req.user, name, phone: phone || '' } });
});

/* ------------------------------------------------------------------ */
/* Buildings & committee members                                        */
/*   Every member reads and edits tickets, lists and vendors; only the */
/*   owner manages members, renames/deletes the building, and replaces */
/*   or wipes its data.                                                */
/* ------------------------------------------------------------------ */

function readBuilding(body) {
  const name = cleanText(body?.name);
  const address = cleanText(body?.address);
  if (!name) return { error: 'יש להזין שם לבניין' };
  if (name.length > 60) return { error: 'שם הבניין ארוך מדי (עד 60 תווים)' };
  if (address.length > 120) return { error: 'הכתובת ארוכה מדי (עד 120 תווים)' };
  return { name, address: address || null };
}

app.post('/api/buildings', requireAuth, (req, res) => {
  const { name, address, error } = readBuilding(req.body);
  if (error) return res.status(400).json({ error });
  const id = db.transaction(() => {
    const newId = Number(db.prepare('INSERT INTO buildings (name, address, owner_id, created_at) VALUES (?, ?, ?, ?)')
      .run(name, address, req.user.id, nowIso()).lastInsertRowid);
    db.prepare("INSERT INTO building_members (building_id, user_id, role, joined_at) VALUES (?, ?, 'owner', ?)").run(newId, req.user.id, nowIso());
    db.prepare('UPDATE users SET active_building_id = ? WHERE id = ?').run(newId, req.user.id);
    insertDefaultOptions(newId);
    return newId;
  });
  res.status(201).json({ building: buildingInfo(membership(id, req.user.id)) });
});

app.put('/api/buildings/active', requireAuth, (req, res) => {
  const b = membership(parseId(req.body?.id), req.user.id);
  if (!b) return res.status(404).json({ error: 'הבניין לא נמצא' });
  db.prepare('UPDATE users SET active_building_id = ? WHERE id = ?').run(b.id, req.user.id);
  res.json({ building: buildingInfo(b) });
});

app.use('/api/building', requireBuilding);

app.put('/api/building', requireOwner, (req, res) => {
  const { name, address, error } = readBuilding(req.body);
  if (error) return res.status(400).json({ error });
  db.prepare('UPDATE buildings SET name = ?, address = ? WHERE id = ?').run(name, address, req.building.id);
  res.json({ building: { ...buildingInfo(req.building), name, address: address || '' } });
});

// Deletes the building with all its tickets, lists and files.
app.delete('/api/building', requireOwner, (req, res) => {
  const files = buildingFiles(req.building.id);
  db.transaction(() => {
    db.prepare('UPDATE users SET active_building_id = NULL WHERE active_building_id = ?').run(req.building.id);
    db.prepare('DELETE FROM buildings WHERE id = ?').run(req.building.id);
  });
  removeFiles(files);
  res.status(204).end();
});

app.get('/api/building/members', (req, res) => res.json({ members: listMembers(req.building.id) }));

// Add someone who already has an account, by the email they signed up with.
app.post('/api/building/members', requireOwner, (req, res) => {
  const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
  if (!EMAIL_RE.test(email)) return res.status(400).json({ error: 'כתובת האימייל אינה תקינה' });
  const user = db.prepare("SELECT id, name, email, COALESCE(phone, '') AS phone FROM users WHERE email = ?").get(email);
  if (!user) return res.status(404).json({ error: 'אין משתמש עם האימייל הזה. בקשו ממנו להירשם למערכת, ואז הוסיפו אותו.' });
  if (db.prepare('SELECT 1 FROM building_members WHERE building_id = ? AND user_id = ?').get(req.building.id, user.id)) {
    return res.status(409).json({ error: 'המשתמש כבר חבר בוועד של הבניין' });
  }
  db.prepare("INSERT INTO building_members (building_id, user_id, role, joined_at) VALUES (?, ?, 'member', ?)").run(req.building.id, user.id, nowIso());
  res.status(201).json({ member: { ...user, role: 'member' } });
});

// The owner removes a member, or a member leaves. Their tickets become unassigned.
app.delete('/api/building/members/:userId', (req, res) => {
  const userId = parseId(req.params.userId);
  const leaving = userId === req.user.id;
  if (!leaving && req.building.role !== 'owner') return res.status(403).json({ error: 'רק מנהל/ת הבניין יכול/ה להסיר חברים' });
  const member = db.prepare('SELECT role FROM building_members WHERE building_id = ? AND user_id = ?').get(req.building.id, userId);
  if (!member) return res.status(404).json({ error: 'החבר/ה לא נמצא/ה בוועד' });
  if (member.role === 'owner') return res.status(400).json({ error: 'מנהל/ת הבניין לא יכול/ה לעזוב. אפשר למחוק את הבניין.' });
  db.transaction(() => {
    db.prepare('DELETE FROM building_members WHERE building_id = ? AND user_id = ?').run(req.building.id, userId);
    db.prepare('UPDATE tickets SET responsible_id = NULL WHERE building_id = ? AND responsible_id = ?').run(req.building.id, userId);
    db.prepare('UPDATE users SET active_building_id = NULL WHERE id = ? AND active_building_id = ?').run(userId, req.building.id);
  });
  res.status(204).end();
});

/* ------------------------------------------------------------------ */
/* Settings lists: categories / floors / areas, and the vendor directory */
/* ------------------------------------------------------------------ */

function listSettings(buildingId) {
  const options = db.prepare(`
    SELECT o.id, o.kind, o.name,
           (SELECT COUNT(*) FROM tickets t
             WHERE (o.kind = 'category' AND t.category_id = o.id)
                OR (o.kind = 'floor' AND t.floor_id = o.id)
                OR (o.kind = 'area' AND t.area_id = o.id)) AS used
    FROM options o WHERE o.building_id = ?
    ORDER BY o.position, o.id
  `).all(buildingId);
  const vendors = db.prepare(`
    SELECT id, company, COALESCE(contact, '') AS contact, COALESCE(phone, '') AS phone, COALESCE(specialty, '') AS specialty
    FROM vendors WHERE building_id = ? ORDER BY company COLLATE NOCASE
  `).all(buildingId);
  const pick = (kind) => options.filter((o) => o.kind === kind).map(({ id, name, used }) => ({ id, name, used }));
  return { categories: pick('category'), floors: pick('floor'), areas: pick('area'), vendors };
}

app.get('/api/settings', requireBuilding, (req, res) => res.json(listSettings(req.building.id)));

function readOptionName(body) {
  const name = cleanText(body?.name);
  if (!name) return { error: 'יש להזין שם' };
  if (name.length > 50) return { error: 'השם ארוך מדי (עד 50 תווים)' };
  return { name };
}

app.post('/api/options', requireBuilding, (req, res) => {
  const kind = req.body?.kind;
  if (!OPTION_KINDS.includes(kind)) return res.status(400).json({ error: 'סוג רשימה לא תקין' });
  const { name, error } = readOptionName(req.body);
  if (error) return res.status(400).json({ error });
  try {
    const pos = db.prepare('SELECT COALESCE(MAX(position), -1) + 1 AS p FROM options WHERE building_id = ? AND kind = ?').get(req.building.id, kind).p;
    const id = Number(db.prepare('INSERT INTO options (building_id, kind, name, position) VALUES (?, ?, ?, ?)').run(req.building.id, kind, name, pos).lastInsertRowid);
    res.status(201).json({ option: { id, kind, name, used: 0 } });
  } catch (err) {
    if (isUniqueViolation(err)) return res.status(409).json({ error: `"${name}" כבר קיים ברשימה` });
    throw err;
  }
});

app.put('/api/options/:id', requireBuilding, (req, res) => {
  const { name, error } = readOptionName(req.body);
  if (error) return res.status(400).json({ error });
  try {
    const { changes } = db.prepare('UPDATE options SET name = ? WHERE id = ? AND building_id = ?').run(name, parseId(req.params.id), req.building.id);
    if (!changes) return res.status(404).json({ error: 'הפריט לא נמצא' });
    res.json({ option: { id: parseId(req.params.id), name } });
  } catch (err) {
    if (isUniqueViolation(err)) return res.status(409).json({ error: `"${name}" כבר קיים ברשימה` });
    throw err;
  }
});

app.delete('/api/options/:id', requireBuilding, (req, res) => {
  const id = parseId(req.params.id);
  const opt = db.prepare('SELECT id, name FROM options WHERE id = ? AND building_id = ?').get(id, req.building.id);
  if (!opt) return res.status(404).json({ error: 'הפריט לא נמצא' });
  const used = db.prepare('SELECT COUNT(*) AS n FROM tickets WHERE category_id = ? OR floor_id = ? OR area_id = ?').get(id, id, id).n;
  if (used) return res.status(409).json({ error: `לא ניתן למחוק את "${opt.name}" – בשימוש ב-${used} קריאות` });
  db.prepare('DELETE FROM options WHERE id = ?').run(id);
  res.status(204).end();
});

function readVendor(body) {
  const v = {
    company: cleanText(body?.company), contact: cleanText(body?.contact),
    phone: cleanText(body?.phone), specialty: cleanText(body?.specialty),
  };
  if (!v.company) return { error: 'יש להזין שם חברה' };
  if (v.company.length > 100 || v.contact.length > 80 || v.specialty.length > 80) return { error: 'אחד השדות ארוך מדי' };
  if (v.phone && !PHONE_RE.test(v.phone)) return { error: 'מספר הטלפון אינו תקין' };
  return { vendor: v };
}

app.post('/api/vendors', requireBuilding, (req, res) => {
  const { vendor, error } = readVendor(req.body);
  if (error) return res.status(400).json({ error });
  if (db.prepare('SELECT 1 FROM vendors WHERE building_id = ? AND company = ?').get(req.building.id, vendor.company)) {
    return res.status(409).json({ error: 'ספק בשם זה כבר קיים בספר הספקים' });
  }
  const id = Number(db.prepare('INSERT INTO vendors (building_id, company, contact, phone, specialty) VALUES (?, ?, ?, ?, ?)')
    .run(req.building.id, vendor.company, vendor.contact || null, vendor.phone || null, vendor.specialty || null).lastInsertRowid);
  res.status(201).json({ vendor: { id, ...vendor } });
});

app.put('/api/vendors/:id', requireBuilding, (req, res) => {
  const { vendor, error } = readVendor(req.body);
  if (error) return res.status(400).json({ error });
  const id = parseId(req.params.id);
  const { changes } = db.prepare('UPDATE vendors SET company = ?, contact = ?, phone = ?, specialty = ? WHERE id = ? AND building_id = ?')
    .run(vendor.company, vendor.contact || null, vendor.phone || null, vendor.specialty || null, id, req.building.id);
  if (!changes) return res.status(404).json({ error: 'הספק לא נמצא' });
  res.json({ vendor: { id, ...vendor } });
});

// Tickets keep the vendor details they copied; only the link to the directory is removed.
app.delete('/api/vendors/:id', requireBuilding, (req, res) => {
  const { changes } = db.prepare('DELETE FROM vendors WHERE id = ? AND building_id = ?').run(parseId(req.params.id), req.building.id);
  if (!changes) return res.status(404).json({ error: 'הספק לא נמצא' });
  res.status(204).end();
});

/* ------------------------------------------------------------------ */
/* Tickets                                                             */
/* ------------------------------------------------------------------ */

const str = (v) => v ?? '';

const TICKET_SELECT = `
  SELECT t.*, r.name AS responsible_name, COALESCE(r.phone, '') AS responsible_phone, c.name AS created_by_name
  FROM tickets t
  LEFT JOIN users r ON r.id = t.responsible_id
  LEFT JOIN users c ON c.id = t.created_by
`;

const serializeMedia = (m) => ({ id: m.id, name: m.name, type: m.type, size: m.size, url: `/api/media/${m.id}` });

/** Full ticket objects (with updates, history and media) for a building, or one ticket. */
function loadTickets(buildingId, ticketId = null) {
  const one = ticketId ? ' AND t.id = ?' : '';
  const args = ticketId ? [buildingId, ticketId] : [buildingId];
  const rows = db.prepare(`${TICKET_SELECT} WHERE t.building_id = ?${one} ORDER BY t.number DESC`).all(...args);
  if (!rows.length) return [];

  const updates = db.prepare(`
    SELECT u.*, a.name AS author_name FROM ticket_updates u
    JOIN tickets t ON t.id = u.ticket_id LEFT JOIN users a ON a.id = u.author_id
    WHERE t.building_id = ?${one} ORDER BY u.created_at DESC, u.id DESC
  `).all(...args);
  const history = db.prepare(`
    SELECT h.*, b.name AS by_name FROM status_history h
    JOIN tickets t ON t.id = h.ticket_id LEFT JOIN users b ON b.id = h.by_id
    WHERE t.building_id = ?${one} ORDER BY h.at, h.id
  `).all(...args);
  const media = db.prepare(`
    SELECT m.id, m.ticket_id, m.update_id, m.name, m.type, m.size FROM media m
    JOIN tickets t ON t.id = m.ticket_id
    WHERE t.building_id = ?${one} ORDER BY m.id
  `).all(...args);

  const group = (list, key) => list.reduce((map, x) => { (map[x[key]] ||= []).push(x); return map; }, {});
  const updByTicket = group(updates, 'ticket_id');
  const histByTicket = group(history, 'ticket_id');
  const mediaByTicket = group(media, 'ticket_id');

  return rows.map((t) => {
    const tMedia = mediaByTicket[t.id] || [];
    return {
      id: t.id, number: t.number, title: t.title, description: str(t.description),
      categoryId: t.category_id, floorId: t.floor_id, areaId: t.area_id, apartment: str(t.apartment),
      priority: t.priority, status: t.status,
      reporter: { name: str(t.reporter_name), phone: str(t.reporter_phone), channel: t.reporter_channel },
      responsibleId: t.responsible_id, responsibleName: str(t.responsible_name), responsiblePhone: str(t.responsible_phone),
      createdById: t.created_by, createdByName: str(t.created_by_name),
      createdAt: t.created_at, updatedAt: t.updated_at, resolvedAt: t.resolved_at,
      external: {
        opened: t.ext_opened === 1, vendorId: t.ext_vendor_id, company: str(t.ext_company), refNo: str(t.ext_ref),
        contactName: str(t.ext_contact), contactPhone: str(t.ext_phone),
        referredAt: str(t.ext_referred_at), expectedAt: str(t.ext_expected_at),
      },
      media: tMedia.filter((m) => !m.update_id).map(serializeMedia),
      updates: (updByTicket[t.id] || []).map((u) => ({
        id: u.id, at: u.created_at, authorId: u.author_id, authorName: str(u.author_name), text: str(u.text),
        statusFrom: u.status_from, statusTo: u.status_to,
        media: tMedia.filter((m) => m.update_id === u.id).map(serializeMedia),
      })),
      statusHistory: (histByTicket[t.id] || []).map((h) => ({ status: h.status, at: h.at, byId: h.by_id, byName: str(h.by_name) })),
    };
  });
}

const getTicket = (buildingId, id) => loadTickets(buildingId, id)[0] || null;

/* ---------- Field validators (shared by POST, PUT and PATCH) ---------- */

function textField(max, label, required = false) {
  return (v) => {
    if (v === undefined || v === null) v = '';
    if (typeof v !== 'string' && typeof v !== 'number') return { error: `${label}: ערך לא תקין` };
    const s = String(v).trim();
    if (required && !s) return { error: `יש להזין ${label}` };
    if (s.length > max) return { error: `${label} ארוך מדי (עד ${max} תווים)` };
    return { value: s || null };
  };
}
const phoneField = (label) => (v) => {
  const r = textField(20, label)(v);
  if (r.error) return r;
  return r.value && !PHONE_RE.test(r.value) ? { error: `${label} אינו תקין` } : r;
};
const enumField = (list, message) => (v) => (list.includes(v) ? { value: v } : { error: message });
const dateField = (label) => (v) => {
  if (v === undefined || v === null || v === '') return { value: null };
  return isValidDate(v) ? { value: v } : { error: `${label} אינו תקין` };
};
const boolField = (v) => (typeof v === 'boolean' ? { value: v ? 1 : 0 } : { error: 'ערך לא תקין' });
const optionField = (kind, label, required = false) => (v, ws) => {
  if (v === undefined || v === null || v === '') return required ? { error: `יש לבחור ${label}` } : { value: null };
  const id = parseId(v);
  const ok = id && db.prepare('SELECT 1 FROM options WHERE id = ? AND building_id = ? AND kind = ?').get(id, ws, kind);
  return ok ? { value: id } : { error: `ה${label} לא נמצא/ה` };
};
const memberField = (v, ws) => {
  if (v === undefined || v === null || v === '') return { value: null };
  const id = parseId(v);
  const ok = id && db.prepare('SELECT 1 FROM building_members WHERE building_id = ? AND user_id = ?').get(ws, id);
  return ok ? { value: id } : { error: 'האחראי/ת אינו/ה חבר/ת ועד בבניין' };
};
const vendorField = (v, ws) => {
  if (v === undefined || v === null || v === '') return { value: null };
  const id = parseId(v);
  const ok = id && db.prepare('SELECT 1 FROM vendors WHERE id = ? AND building_id = ?').get(id, ws);
  return ok ? { value: id } : { error: 'הספק לא נמצא' };
};

const TICKET_FIELDS = {
  title: { col: 'title', parse: textField(200, 'כותרת', true) },
  description: { col: 'description', parse: textField(5000, 'תיאור') },
  categoryId: { col: 'category_id', parse: optionField('category', 'קטגוריה', true) },
  floorId: { col: 'floor_id', parse: optionField('floor', 'קומה') },
  areaId: { col: 'area_id', parse: optionField('area', 'אזור') },
  apartment: { col: 'apartment', parse: textField(10, 'מספר דירה') },
  priority: { col: 'priority', parse: enumField(PRIORITIES, 'רמת העדיפות אינה תקינה'), def: 'medium' },
  status: { col: 'status', parse: enumField(STATUSES, 'הסטטוס אינו תקין'), def: 'new' },
  reporterName: { col: 'reporter_name', parse: textField(80, 'שם המדווח') },
  reporterPhone: { col: 'reporter_phone', parse: phoneField('טלפון המדווח') },
  reporterChannel: { col: 'reporter_channel', parse: enumField(CHANNELS, 'אופן הדיווח אינו תקין'), def: 'whatsapp' },
  responsibleId: { col: 'responsible_id', parse: memberField },
  extOpened: { col: 'ext_opened', parse: boolField, def: false },
  extVendorId: { col: 'ext_vendor_id', parse: vendorField },
  extCompany: { col: 'ext_company', parse: textField(100, 'שם החברה') },
  extRef: { col: 'ext_ref', parse: textField(60, 'מספר הקריאה אצל הספק') },
  extContact: { col: 'ext_contact', parse: textField(80, 'שם איש המקצוע') },
  extPhone: { col: 'ext_phone', parse: phoneField('טלפון איש המקצוע') },
  extReferredAt: { col: 'ext_referred_at', parse: dateField('תאריך הפנייה') },
  extExpectedAt: { col: 'ext_expected_at', parse: dateField('מועד ההגעה הצפוי') },
};
const EXT_KEYS = ['extVendorId', 'extCompany', 'extRef', 'extContact', 'extPhone', 'extReferredAt', 'extExpectedAt'];

/**
 * Validate a ticket body. Full mode (POST / PUT) reads every field (missing → default);
 * partial mode (PATCH) reads only the fields that were sent.
 */
function readTicketInput(body, ws, partial, existing = null) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { error: 'בקשה לא תקינה' };
  if (partial) {
    const unknown = Object.keys(body).find((k) => !Object.hasOwn(TICKET_FIELDS, k));
    if (unknown) return { error: `שדה לא מוכר: ${unknown}` };
    if (!Object.keys(body).length) return { error: 'לא נשלחו שינויים' };
  }
  const values = {};
  for (const [key, f] of Object.entries(TICKET_FIELDS)) {
    const has = Object.hasOwn(body, key);
    if (partial && !has) continue;
    const r = f.parse(has ? body[key] : f.def, ws);
    if (r.error) return { error: r.error };
    values[key] = r.value;
  }
  // Closing the external handling clears its details.
  if (values.extOpened === 0) EXT_KEYS.forEach((k) => { values[k] = null; });

  const referred = values.extReferredAt !== undefined ? values.extReferredAt : existing?.ext_referred_at;
  const expected = values.extExpectedAt !== undefined ? values.extExpectedAt : existing?.ext_expected_at;
  if (referred && expected && expected < referred) return { error: 'מועד ההגעה הצפוי אינו יכול להיות לפני תאריך הפנייה' };
  return { values };
}

/** Change a ticket's status, recording history and maintaining the resolution date. */
function changeStatus(row, to, userId, now) {
  if (!to || row.status === to) return;
  const resolvedAt = DONE_STATUSES.has(to) ? (row.resolved_at || now) : null;
  db.prepare('UPDATE tickets SET status = ?, resolved_at = ?, updated_at = ? WHERE id = ?').run(to, resolvedAt, now, row.id);
  db.prepare('INSERT INTO status_history (ticket_id, status, by_id, at) VALUES (?, ?, ?, ?)').run(row.id, to, userId, now);
}

const ticketRow = (ws, id) => db.prepare('SELECT * FROM tickets WHERE id = ? AND building_id = ?').get(id, ws);
const touchTicket = (id, now = nowIso()) => db.prepare('UPDATE tickets SET updated_at = ? WHERE id = ?').run(now, id);

app.use('/api/tickets', requireBuilding);

app.get('/api/tickets', (req, res) => res.json({ tickets: loadTickets(req.building.id) }));

app.get('/api/tickets/:id', (req, res) => {
  const t = getTicket(req.building.id, parseId(req.params.id));
  if (!t) return res.status(404).json({ error: 'הקריאה לא נמצאה' });
  res.json({ ticket: t });
});

app.post('/api/tickets', (req, res) => {
  const ws = req.building.id;
  const { values, error } = readTicketInput(req.body, ws, false);
  if (error) return res.status(400).json({ error });
  const now = nowIso();
  const id = db.transaction(() => {
    const { next_number: number } = db.prepare('SELECT next_number FROM buildings WHERE id = ?').get(ws);
    db.prepare('UPDATE buildings SET next_number = next_number + 1 WHERE id = ?').run(ws);
    const keys = Object.keys(values);
    const cols = keys.map((k) => TICKET_FIELDS[k].col).concat(['building_id', 'number', 'created_by', 'created_at', 'updated_at', 'resolved_at']);
    const params = keys.map((k) => values[k]).concat([ws, number, req.user.id, now, now, DONE_STATUSES.has(values.status) ? now : null]);
    const newId = Number(db.prepare(`INSERT INTO tickets (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`).run(...params).lastInsertRowid);
    db.prepare('INSERT INTO status_history (ticket_id, status, by_id, at) VALUES (?, ?, ?, ?)').run(newId, values.status, req.user.id, now);
    return newId;
  });
  res.status(201).json({ ticket: getTicket(ws, id) });
});

function updateTicket(req, res, partial) {
  const ws = req.building.id;
  const row = ticketRow(ws, parseId(req.params.id));
  if (!row) return res.status(404).json({ error: 'הקריאה לא נמצאה' });
  const { values, error } = readTicketInput(req.body, ws, partial, row);
  if (error) return res.status(400).json({ error });
  const now = nowIso();
  db.transaction(() => {
    const keys = Object.keys(values).filter((k) => k !== 'status');
    const sets = keys.map((k) => `${TICKET_FIELDS[k].col} = ?`).concat('updated_at = ?');
    db.prepare(`UPDATE tickets SET ${sets.join(', ')} WHERE id = ?`).run(...keys.map((k) => values[k]), now, row.id);
    if (values.status !== undefined) changeStatus(row, values.status, req.user.id, now);
  });
  res.json({ ticket: getTicket(ws, row.id) });
}

app.put('/api/tickets/:id', (req, res) => updateTicket(req, res, false));
// Partial update, e.g. { "status": "resolved" } from the table view or { "extExpectedAt": "2026-12-01" } from the calendar.
app.patch('/api/tickets/:id', (req, res) => updateTicket(req, res, true));

app.delete('/api/tickets/:id', (req, res) => {
  const row = ticketRow(req.building.id, parseId(req.params.id));
  if (!row) return res.status(404).json({ error: 'הקריאה לא נמצאה' });
  const files = db.prepare('SELECT file FROM media WHERE ticket_id = ?').all(row.id).map((r) => r.file);
  db.prepare('DELETE FROM tickets WHERE id = ?').run(row.id);
  removeFiles(files);
  res.status(204).end();
});

/* ---------- Updates timeline ---------- */

app.post('/api/tickets/:id/updates', (req, res) => {
  const ws = req.building.id;
  const row = ticketRow(ws, parseId(req.params.id));
  if (!row) return res.status(404).json({ error: 'הקריאה לא נמצאה' });
  const text = typeof req.body?.text === 'string' ? req.body.text.trim() : '';
  if (text.length > 5000) return res.status(400).json({ error: 'העדכון ארוך מדי (עד 5000 תווים)' });
  const status = req.body?.status || null;
  if (status && !STATUSES.includes(status)) return res.status(400).json({ error: 'הסטטוס אינו תקין' });
  const withMedia = req.body?.withMedia === true;
  const changing = status && status !== row.status;
  if (!text && !changing && !withMedia) return res.status(400).json({ error: 'יש לכתוב תוכן לעדכון, לצרף קובץ או לשנות סטטוס' });
  const now = nowIso();
  const updateId = db.transaction(() => {
    const id = Number(db.prepare('INSERT INTO ticket_updates (ticket_id, author_id, text, status_from, status_to, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(row.id, req.user.id, text || null, changing ? row.status : null, changing ? status : null, now).lastInsertRowid);
    if (changing) changeStatus(row, status, req.user.id, now);
    touchTicket(row.id, now);
    return id;
  });
  res.status(201).json({ updateId, ticket: getTicket(ws, row.id) });
});

// The author of an update, or the building owner, may delete it (with its attachments).
app.delete('/api/tickets/:id/updates/:updateId', (req, res) => {
  const ws = req.building.id;
  const row = ticketRow(ws, parseId(req.params.id));
  const upd = row && db.prepare('SELECT id, author_id FROM ticket_updates WHERE id = ? AND ticket_id = ?').get(parseId(req.params.updateId), row.id);
  if (!upd) return res.status(404).json({ error: 'העדכון לא נמצא' });
  if (upd.author_id !== req.user.id && req.building.role !== 'owner') {
    return res.status(403).json({ error: 'רק כותב/ת העדכון או מנהל/ת הבניין יכולים למחוק אותו' });
  }
  const files = db.prepare('SELECT file FROM media WHERE update_id = ?').all(upd.id).map((r) => r.file);
  db.prepare('DELETE FROM ticket_updates WHERE id = ?').run(upd.id);
  removeFiles(files);
  res.json({ ticket: getTicket(ws, row.id) });
});

/* ---------- Media (images / videos stored on disk) ---------- */

// Upload one file as the raw request body. Headers: Content-Type, X-File-Name (URI-encoded).
// Query: ?updateId=<id> to attach it to an update instead of to the ticket itself.
app.post('/api/tickets/:id/media', express.raw({ type: () => true, limit: MAX_UPLOAD }), async (req, res) => {
  const ws = req.building.id;
  const row = ticketRow(ws, parseId(req.params.id));
  if (!row) return res.status(404).json({ error: 'הקריאה לא נמצאה' });
  let updateId = null;
  if (req.query.updateId) {
    updateId = parseId(req.query.updateId);
    if (!updateId || !db.prepare('SELECT 1 FROM ticket_updates WHERE id = ? AND ticket_id = ?').get(updateId, row.id)) {
      return res.status(404).json({ error: 'העדכון לא נמצא' });
    }
  }
  let name = 'file';
  try { name = decodeURIComponent(req.get('X-File-Name') || 'file'); } catch { /* keep default */ }
  name = path.basename(name).slice(0, 150) || 'file';
  const ext = (name.split('.').pop() || '').toLowerCase();
  if (!MEDIA_TYPES[ext]) return res.status(400).json({ error: 'סוג הקובץ אינו נתמך (jpg, png, gif, webp, mp4, mov, webm)' });
  if (!Buffer.isBuffer(req.body) || !req.body.length) return res.status(400).json({ error: 'הקובץ ריק' });

  const file = `${crypto.randomBytes(16).toString('hex')}.${ext}`;
  await fsp.writeFile(path.join(db.uploadsDir, file), req.body);
  try {
    const id = Number(db.prepare('INSERT INTO media (building_id, ticket_id, update_id, name, type, size, file, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(ws, row.id, updateId, name, MEDIA_TYPES[ext], req.body.length, file, nowIso()).lastInsertRowid);
    touchTicket(row.id);
    res.status(201).json({ media: serializeMedia({ id, name, type: MEDIA_TYPES[ext], size: req.body.length }) });
  } catch (err) {
    removeFiles([file]);
    throw err;
  }
});

// Served to any member of the file's building (img/video tags can't send X-Building-Id).
app.get('/api/media/:id', requireAuth, (req, res) => {
  const m = db.prepare('SELECT * FROM media WHERE id = ?').get(parseId(req.params.id));
  if (!m || !membership(m.building_id, req.user.id)) return res.status(404).json({ error: 'הקובץ לא נמצא' });
  res.set({
    'Cache-Control': 'private, max-age=86400',
    'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; sandbox",
    'Content-Disposition': `inline; filename*=UTF-8''${encodeURIComponent(m.name)}`,
  });
  res.type(m.type);
  res.sendFile(path.join(db.uploadsDir, path.basename(m.file)), (err) => {
    if (err && !res.headersSent) res.status(404).json({ error: 'הקובץ לא נמצא' });
  });
});

app.delete('/api/media/:id', requireBuilding, (req, res) => {
  const m = db.prepare('SELECT * FROM media WHERE id = ? AND building_id = ?').get(parseId(req.params.id), req.building.id);
  if (!m) return res.status(404).json({ error: 'הקובץ לא נמצא' });
  db.prepare('DELETE FROM media WHERE id = ?').run(m.id);
  removeFiles([m.file]);
  res.json({ ticket: getTicket(req.building.id, m.ticket_id) });
});

/* ------------------------------------------------------------------ */
/* Service contracts                                                   */
/*   Renewal reminders are computed by the client from end_date (one   */
/*   calendar month before it). "Handled" is stored per end date in    */
/*   reminder_ack_end, so renewing re-arms the reminder automatically. */
/* ------------------------------------------------------------------ */

const FREQUENCIES = ['monthly', 'quarterly', 'semiannual', 'yearly', 'one_time'];
const CONTRACT_FILE_TYPES = { ...MEDIA_TYPES, pdf: 'application/pdf' };
delete CONTRACT_FILE_TYPES.mp4;
delete CONTRACT_FILE_TYPES.mov;
delete CONTRACT_FILE_TYPES.webm;

const emailField = (v) => {
  const r = textField(254, 'אימייל')(v);
  if (r.error) return r;
  return r.value && !EMAIL_RE.test(r.value) ? { error: 'כתובת האימייל אינה תקינה' } : r;
};
const intField = (min, max, message) => (v) => {
  if (v === undefined || v === null || v === '') return { value: null };
  const n = Number(v);
  return Number.isInteger(n) && n >= min && n <= max ? { value: n } : { error: message };
};
const moneyField = (v) => {
  if (v === undefined || v === null || v === '') return { value: null };
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 && n <= 100000000 ? { value: Math.round(n * 100) / 100 } : { error: 'העלות אינה תקינה' };
};
const requiredDate = (label) => (v) => (isValidDate(v) ? { value: v } : { error: `יש לבחור ${label} תקין` });

const CONTRACT_FIELDS = {
  title: { col: 'title', parse: textField(120, 'שם השירות', true) },
  categoryId: { col: 'category_id', parse: optionField('category', 'קטגוריה') },
  vendorId: { col: 'vendor_id', parse: vendorField },
  company: { col: 'company', parse: textField(100, 'שם החברה / הספק', true) },
  contactName: { col: 'contact_name', parse: textField(80, 'שם איש הקשר') },
  contactPhone: { col: 'contact_phone', parse: phoneField('טלפון איש הקשר') },
  contactEmail: { col: 'contact_email', parse: emailField },
  contractNumber: { col: 'contract_number', parse: textField(60, 'מספר החוזה') },
  startDate: { col: 'start_date', parse: dateField('תאריך תחילת החוזה') },
  endDate: { col: 'end_date', parse: requiredDate('תאריך סיום / חידוש') },
  autoRenew: { col: 'auto_renew', parse: boolField, def: false },
  renewalMonths: { col: 'renewal_months', parse: intField(1, 120, 'תקופת החידוש אינה תקינה (1–120 חודשים)'), def: 12 },
  cost: { col: 'cost', parse: moneyField },
  paymentFrequency: { col: 'payment_frequency', parse: enumField(FREQUENCIES, 'תדירות התשלום אינה תקינה'), def: 'yearly' },
  scope: { col: 'scope', parse: textField(3000, 'פירוט השירות') },
  notes: { col: 'notes', parse: textField(3000, 'הערות') },
  responsibleId: { col: 'responsible_id', parse: memberField },
};

function readContractInput(body, ws) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { error: 'בקשה לא תקינה' };
  const values = {};
  for (const [key, f] of Object.entries(CONTRACT_FIELDS)) {
    const has = Object.hasOwn(body, key);
    const r = f.parse(has ? body[key] : f.def, ws);
    if (r.error) return { error: r.error };
    values[key] = r.value;
  }
  if (values.renewalMonths == null) values.renewalMonths = 12;
  if (values.startDate && values.endDate < values.startDate) return { error: 'תאריך הסיום אינו יכול להיות לפני תאריך התחילה' };
  return { values };
}

const serializeContractFile = (f) => ({ id: f.id, name: f.name, type: f.type, size: f.size, url: `/api/contract-files/${f.id}` });

function loadContracts(buildingId, contractId = null) {
  const one = contractId ? ' AND c.id = ?' : '';
  const args = contractId ? [buildingId, contractId] : [buildingId];
  const rows = db.prepare(`
    SELECT c.*, r.name AS responsible_name, COALESCE(r.phone, '') AS responsible_phone, a.name AS ack_by_name
    FROM service_contracts c
    LEFT JOIN users r ON r.id = c.responsible_id
    LEFT JOIN users a ON a.id = c.reminder_ack_by
    WHERE c.building_id = ?${one} ORDER BY c.end_date, c.id
  `).all(...args);
  const files = db.prepare(`
    SELECT f.id, f.contract_id, f.name, f.type, f.size FROM contract_files f
    JOIN service_contracts c ON c.id = f.contract_id WHERE c.building_id = ?${one} ORDER BY f.id
  `).all(...args);
  return rows.map((c) => ({
    id: c.id, title: c.title, categoryId: c.category_id, vendorId: c.vendor_id, company: c.company,
    contactName: str(c.contact_name), contactPhone: str(c.contact_phone), contactEmail: str(c.contact_email),
    contractNumber: str(c.contract_number), startDate: str(c.start_date), endDate: c.end_date,
    autoRenew: c.auto_renew === 1, renewalMonths: c.renewal_months, cost: c.cost, paymentFrequency: c.payment_frequency,
    scope: str(c.scope), notes: str(c.notes),
    responsibleId: c.responsible_id, responsibleName: str(c.responsible_name), responsiblePhone: str(c.responsible_phone),
    reminderHandled: !!c.reminder_ack_end && c.reminder_ack_end === c.end_date,
    reminderAckByName: str(c.ack_by_name), reminderAckAt: c.reminder_ack_at,
    createdAt: c.created_at, updatedAt: c.updated_at,
    files: files.filter((f) => f.contract_id === c.id).map(serializeContractFile),
  }));
}

const getContract = (ws, id) => loadContracts(ws, id)[0] || null;
const contractRow = (ws, id) => db.prepare('SELECT * FROM service_contracts WHERE id = ? AND building_id = ?').get(id, ws);

app.use('/api/contracts', requireBuilding);

app.get('/api/contracts', (req, res) => res.json({ contracts: loadContracts(req.building.id) }));

app.get('/api/contracts/:id', (req, res) => {
  const c = getContract(req.building.id, parseId(req.params.id));
  if (!c) return res.status(404).json({ error: 'החוזה לא נמצא' });
  res.json({ contract: c });
});

app.post('/api/contracts', (req, res) => {
  const ws = req.building.id;
  const { values, error } = readContractInput(req.body, ws);
  if (error) return res.status(400).json({ error });
  const now = nowIso();
  const keys = Object.keys(values);
  const cols = keys.map((k) => CONTRACT_FIELDS[k].col).concat(['building_id', 'created_by', 'created_at', 'updated_at']);
  const params = keys.map((k) => values[k]).concat([ws, req.user.id, now, now]);
  const id = Number(db.prepare(`INSERT INTO service_contracts (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`).run(...params).lastInsertRowid);
  res.status(201).json({ contract: getContract(ws, id) });
});

app.put('/api/contracts/:id', (req, res) => {
  const ws = req.building.id;
  const row = contractRow(ws, parseId(req.params.id));
  if (!row) return res.status(404).json({ error: 'החוזה לא נמצא' });
  const { values, error } = readContractInput(req.body, ws);
  if (error) return res.status(400).json({ error });
  const keys = Object.keys(values);
  db.prepare(`UPDATE service_contracts SET ${keys.map((k) => `${CONTRACT_FIELDS[k].col} = ?`).join(', ')}, updated_at = ? WHERE id = ?`)
    .run(...keys.map((k) => values[k]), nowIso(), row.id);
  res.json({ contract: getContract(ws, row.id) });
});

// Renew: the old end date becomes the new start date, and the end date moves forward.
app.post('/api/contracts/:id/renew', (req, res) => {
  const ws = req.building.id;
  const row = contractRow(ws, parseId(req.params.id));
  if (!row) return res.status(404).json({ error: 'החוזה לא נמצא' });
  const endDate = req.body?.endDate;
  if (!isValidDate(endDate)) return res.status(400).json({ error: 'יש לבחור תאריך סיום חדש תקין' });
  if (endDate <= row.end_date) return res.status(400).json({ error: 'תאריך הסיום החדש חייב להיות אחרי תאריך הסיום הנוכחי' });
  const cost = req.body?.cost === undefined ? { value: row.cost } : moneyField(req.body.cost);
  if (cost.error) return res.status(400).json({ error: cost.error });
  db.prepare('UPDATE service_contracts SET start_date = ?, end_date = ?, cost = ?, updated_at = ? WHERE id = ?')
    .run(row.end_date, endDate, cost.value, nowIso(), row.id);
  res.json({ contract: getContract(ws, row.id) });
});

// Mark the current renewal reminder as handled (or undo it).
app.post('/api/contracts/:id/reminder', (req, res) => {
  const ws = req.building.id;
  const row = contractRow(ws, parseId(req.params.id));
  if (!row) return res.status(404).json({ error: 'החוזה לא נמצא' });
  if (req.body?.handled === false) {
    db.prepare('UPDATE service_contracts SET reminder_ack_end = NULL, reminder_ack_by = NULL, reminder_ack_at = NULL WHERE id = ?').run(row.id);
  } else {
    db.prepare('UPDATE service_contracts SET reminder_ack_end = end_date, reminder_ack_by = ?, reminder_ack_at = ? WHERE id = ?')
      .run(req.user.id, nowIso(), row.id);
  }
  res.json({ contract: getContract(ws, row.id) });
});

app.delete('/api/contracts/:id', (req, res) => {
  const row = contractRow(req.building.id, parseId(req.params.id));
  if (!row) return res.status(404).json({ error: 'החוזה לא נמצא' });
  const files = db.prepare('SELECT file FROM contract_files WHERE contract_id = ?').all(row.id).map((r) => r.file);
  db.prepare('DELETE FROM service_contracts WHERE id = ?').run(row.id);
  removeFiles(files);
  res.status(204).end();
});

// Upload a contract document (PDF or image) as the raw request body, like ticket media.
app.post('/api/contracts/:id/files', express.raw({ type: () => true, limit: MAX_UPLOAD }), async (req, res) => {
  const ws = req.building.id;
  const row = contractRow(ws, parseId(req.params.id));
  if (!row) return res.status(404).json({ error: 'החוזה לא נמצא' });
  let name = 'file';
  try { name = decodeURIComponent(req.get('X-File-Name') || 'file'); } catch { /* keep default */ }
  name = path.basename(name).slice(0, 150) || 'file';
  const ext = (name.split('.').pop() || '').toLowerCase();
  if (!CONTRACT_FILE_TYPES[ext]) return res.status(400).json({ error: 'סוג הקובץ אינו נתמך (pdf, jpg, png, gif, webp)' });
  if (!Buffer.isBuffer(req.body) || !req.body.length) return res.status(400).json({ error: 'הקובץ ריק' });
  const file = `${crypto.randomBytes(16).toString('hex')}.${ext}`;
  await fsp.writeFile(path.join(db.uploadsDir, file), req.body);
  try {
    const id = Number(db.prepare('INSERT INTO contract_files (building_id, contract_id, name, type, size, file, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(ws, row.id, name, CONTRACT_FILE_TYPES[ext], req.body.length, file, nowIso()).lastInsertRowid);
    db.prepare('UPDATE service_contracts SET updated_at = ? WHERE id = ?').run(nowIso(), row.id);
    res.status(201).json({ file: serializeContractFile({ id, name, type: CONTRACT_FILE_TYPES[ext], size: req.body.length }) });
  } catch (err) {
    removeFiles([file]);
    throw err;
  }
});

app.get('/api/contract-files/:id', requireAuth, (req, res) => {
  const f = db.prepare('SELECT * FROM contract_files WHERE id = ?').get(parseId(req.params.id));
  if (!f || !membership(f.building_id, req.user.id)) return res.status(404).json({ error: 'הקובץ לא נמצא' });
  res.set({
    'Cache-Control': 'private, max-age=86400',
    'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; sandbox",
    'Content-Disposition': `inline; filename*=UTF-8''${encodeURIComponent(f.name)}`,
  });
  res.type(f.type);
  res.sendFile(path.join(db.uploadsDir, path.basename(f.file)), (err) => {
    if (err && !res.headersSent) res.status(404).json({ error: 'הקובץ לא נמצא' });
  });
});

app.delete('/api/contract-files/:id', requireBuilding, (req, res) => {
  const f = db.prepare('SELECT * FROM contract_files WHERE id = ? AND building_id = ?').get(parseId(req.params.id), req.building.id);
  if (!f) return res.status(404).json({ error: 'הקובץ לא נמצא' });
  db.prepare('DELETE FROM contract_files WHERE id = ?').run(f.id);
  removeFiles([f.file]);
  res.json({ contract: getContract(req.building.id, f.contract_id) });
});

/* ------------------------------------------------------------------ */
/* Bank (see bank.js)                                                  */
/* ------------------------------------------------------------------ */

bank.registerBankRoutes(app, { requireBuilding });

/* ------------------------------------------------------------------ */
/* Building data: demo, wipe, backup, restore                          */
/* ------------------------------------------------------------------ */

app.post('/api/building/demo', requireOwner, (req, res) => {
  const memberIds = listMembers(req.building.id).map((m) => m.id);
  seedDemo(req.building.id, memberIds);
  res.json({ ok: true });
});

// "Start empty": removes all tickets and service contracts (lists and vendors are kept).
app.delete('/api/building/tickets', requireOwner, (req, res) => {
  const files = buildingFiles(req.building.id);
  db.transaction(() => {
    db.prepare('DELETE FROM tickets WHERE building_id = ?').run(req.building.id);
    db.prepare('DELETE FROM service_contracts WHERE building_id = ?').run(req.building.id);
    bank.wipeBank(req.building.id);
    db.prepare('UPDATE buildings SET next_number = 1001 WHERE id = ?').run(req.building.id);
  });
  removeFiles(files);
  res.status(204).end();
});

// Full backup: lists, vendors and tickets, with attachments as base64. People are referenced by email.
app.get('/api/building/backup', async (req, res, next) => {
  try {
    const ws = req.building.id;
    const settings = listSettings(ws);
    const emailOf = new Map(db.prepare('SELECT id, email FROM users').all().map((u) => [u.id, u.email]));
    const optName = new Map([...settings.categories, ...settings.floors, ...settings.areas].map((o) => [o.id, o.name]));
    const files = new Map(db.prepare('SELECT id, file FROM media WHERE building_id = ?').all(ws).map((m) => [m.id, m.file]));
    const packMedia = async (list) => Promise.all(list.map(async (m) => ({
      name: m.name, type: m.type,
      data: (await fsp.readFile(path.join(db.uploadsDir, files.get(m.id))).catch(() => Buffer.alloc(0))).toString('base64'),
    })));
    const tickets = [];
    for (const t of loadTickets(ws)) {
      tickets.push({
        number: t.number, title: t.title, description: t.description,
        category: optName.get(t.categoryId) || null, floor: optName.get(t.floorId) || null, area: optName.get(t.areaId) || null,
        apartment: t.apartment, priority: t.priority, status: t.status, reporter: t.reporter,
        responsibleEmail: emailOf.get(t.responsibleId) || null, createdByEmail: emailOf.get(t.createdById) || null,
        createdAt: t.createdAt, updatedAt: t.updatedAt, resolvedAt: t.resolvedAt,
        external: { ...t.external },
        media: await packMedia(t.media),
        updates: await Promise.all(t.updates.map(async (u) => ({
          authorEmail: emailOf.get(u.authorId) || null, text: u.text, statusFrom: u.statusFrom, statusTo: u.statusTo, at: u.at,
          media: await packMedia(u.media),
        }))),
        statusHistory: t.statusHistory.map((h) => ({ status: h.status, at: h.at, byEmail: emailOf.get(h.byId) || null })),
      });
    }
    const contractFiles = new Map(db.prepare('SELECT id, file FROM contract_files WHERE building_id = ?').all(ws).map((f) => [f.id, f.file]));
    const contracts = [];
    for (const c of loadContracts(ws)) {
      contracts.push({
        title: c.title, category: optName.get(c.categoryId) || null, vendorId: c.vendorId, company: c.company,
        contactName: c.contactName, contactPhone: c.contactPhone, contactEmail: c.contactEmail, contractNumber: c.contractNumber,
        startDate: c.startDate, endDate: c.endDate, autoRenew: c.autoRenew, renewalMonths: c.renewalMonths, cost: c.cost,
        paymentFrequency: c.paymentFrequency, scope: c.scope, notes: c.notes,
        responsibleEmail: emailOf.get(c.responsibleId) || null, reminderHandled: c.reminderHandled,
        createdAt: c.createdAt, updatedAt: c.updatedAt,
        files: await Promise.all(c.files.map(async (f) => ({
          name: f.name, type: f.type,
          data: (await fsp.readFile(path.join(db.uploadsDir, contractFiles.get(f.id))).catch(() => Buffer.alloc(0))).toString('base64'),
        }))),
      });
    }
    const payload = {
      app: 'house-committee-faults', version: 2, exportedAt: nowIso(), contracts, bank: bank.exportBank(ws),
      building: { name: req.building.name, address: req.building.address || '' },
      nextNumber: db.prepare('SELECT next_number FROM buildings WHERE id = ?').get(ws).next_number,
      settings: {
        categories: settings.categories.map((o) => o.name), floors: settings.floors.map((o) => o.name),
        areas: settings.areas.map((o) => o.name), vendors: settings.vendors,
      },
      tickets,
    };
    const date = nowIso().slice(0, 10);
    res.set('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(`גיבוי-תקלות-${date}.json`)}`);
    res.type('application/json').send(JSON.stringify(payload));
  } catch (err) {
    next(err);
  }
});

// Restore replaces all of the building's lists, vendors and tickets with the backup's.
app.post('/api/building/backup', requireOwner, express.json({ limit: MAX_BACKUP }), (req, res) => {
  const p = req.body;
  if (!p || p.app !== 'house-committee-faults' || p.version !== 2 || !Array.isArray(p.tickets) || !p.settings) {
    return res.status(400).json({ error: 'הקובץ אינו קובץ גיבוי תקין של מערכת זו' });
  }
  const ws = req.building.id;
  // Backups made before service contracts existed have no "contracts" key: keep the current ones then.
  const replaceContracts = Array.isArray(p.contracts);
  const oldFiles = replaceContracts ? buildingFiles(ws) : db.prepare('SELECT file FROM media WHERE building_id = ?').all(ws).map((r) => r.file);
  const memberByEmail = new Map(listMembers(ws).map((m) => [m.email.toLowerCase(), m.id]));
  const who = (email) => (email && memberByEmail.get(String(email).toLowerCase())) || null;
  const safe = (v, max) => (typeof v === 'string' ? v.slice(0, max) : null) || null;
  const written = [];

  try {
    db.transaction(() => {
      db.prepare('DELETE FROM tickets WHERE building_id = ?').run(ws);
      db.prepare('DELETE FROM options WHERE building_id = ?').run(ws);
      db.prepare('DELETE FROM vendors WHERE building_id = ?').run(ws);

      const optIds = { category: new Map(), floor: new Map(), area: new Map() };
      const insOpt = db.prepare('INSERT OR IGNORE INTO options (building_id, kind, name, position) VALUES (?, ?, ?, ?)');
      for (const [kind, list] of [['category', p.settings.categories], ['floor', p.settings.floors], ['area', p.settings.areas]]) {
        (Array.isArray(list) ? list : []).forEach((name, i) => {
          if (typeof name !== 'string' || !name.trim()) return;
          insOpt.run(ws, kind, name.trim().slice(0, 50), i);
          optIds[kind].set(name.trim().slice(0, 50), db.prepare('SELECT id FROM options WHERE building_id = ? AND kind = ? AND name = ?').get(ws, kind, name.trim().slice(0, 50)).id);
        });
      }
      const vendorIds = new Map();
      for (const v of Array.isArray(p.settings.vendors) ? p.settings.vendors : []) {
        if (!v || typeof v.company !== 'string' || !v.company.trim()) continue;
        const id = Number(db.prepare('INSERT INTO vendors (building_id, company, contact, phone, specialty) VALUES (?, ?, ?, ?, ?)')
          .run(ws, v.company.slice(0, 100), safe(v.contact, 80), safe(v.phone, 20), safe(v.specialty, 80)).lastInsertRowid);
        vendorIds.set(v.id, id);
      }

      const insMedia = db.prepare('INSERT INTO media (building_id, ticket_id, update_id, name, type, size, file, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
      const addMedia = (ticketId, updateId, list) => {
        for (const m of Array.isArray(list) ? list : []) {
          const ext = (String(m?.name || '').split('.').pop() || '').toLowerCase();
          const type = MEDIA_TYPES[ext] || (ext === 'svg' ? 'image/svg+xml' : null);
          if (!type || typeof m.data !== 'string') continue;
          const buf = Buffer.from(m.data, 'base64');
          const file = `${crypto.randomBytes(16).toString('hex')}.${ext}`;
          fs.writeFileSync(path.join(db.uploadsDir, file), buf);
          written.push(file);
          insMedia.run(ws, ticketId, updateId, path.basename(String(m.name)).slice(0, 150), type, buf.length, file, nowIso());
        }
      };

      const seen = new Set();
      let maxNumber = 1000;
      for (const t of p.tickets) {
        const number = parseId(t?.number);
        if (!number || seen.has(number) || typeof t.title !== 'string' || !t.title.trim()) continue;
        seen.add(number);
        maxNumber = Math.max(maxNumber, number);
        const e = t.external || {};
        const status = STATUSES.includes(t.status) ? t.status : 'new';
        const created = typeof t.createdAt === 'string' ? t.createdAt : nowIso();
        const id = Number(db.prepare(`
          INSERT INTO tickets (building_id, number, title, description, category_id, floor_id, area_id, apartment, priority, status,
            reporter_name, reporter_phone, reporter_channel, responsible_id, created_by, created_at, updated_at, resolved_at,
            ext_opened, ext_vendor_id, ext_company, ext_ref, ext_contact, ext_phone, ext_referred_at, ext_expected_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
          ws, number, t.title.slice(0, 200), safe(t.description, 5000),
          optIds.category.get(t.category) ?? null, optIds.floor.get(t.floor) ?? null, optIds.area.get(t.area) ?? null,
          safe(t.apartment, 10), PRIORITIES.includes(t.priority) ? t.priority : 'medium', status,
          safe(t.reporter?.name, 80), safe(t.reporter?.phone, 20), CHANNELS.includes(t.reporter?.channel) ? t.reporter.channel : 'whatsapp',
          who(t.responsibleEmail), who(t.createdByEmail), created,
          typeof t.updatedAt === 'string' ? t.updatedAt : created,
          DONE_STATUSES.has(status) && typeof t.resolvedAt === 'string' ? t.resolvedAt : null,
          e.opened ? 1 : 0, vendorIds.get(e.vendorId) ?? null, safe(e.company, 100), safe(e.refNo, 60), safe(e.contactName, 80),
          safe(e.contactPhone, 20), isValidDate(e.referredAt) ? e.referredAt : null, isValidDate(e.expectedAt) ? e.expectedAt : null,
        ).lastInsertRowid);
        addMedia(id, null, t.media);
        for (const u of Array.isArray(t.updates) ? t.updates : []) {
          const uid = Number(db.prepare('INSERT INTO ticket_updates (ticket_id, author_id, text, status_from, status_to, created_at) VALUES (?, ?, ?, ?, ?, ?)')
            .run(id, who(u.authorEmail), safe(u.text, 5000), STATUSES.includes(u.statusFrom) ? u.statusFrom : null,
              STATUSES.includes(u.statusTo) ? u.statusTo : null, typeof u.at === 'string' ? u.at : created).lastInsertRowid);
          addMedia(id, uid, u.media);
        }
        for (const h of Array.isArray(t.statusHistory) ? t.statusHistory : []) {
          if (!STATUSES.includes(h?.status)) continue;
          db.prepare('INSERT INTO status_history (ticket_id, status, by_id, at) VALUES (?, ?, ?, ?)')
            .run(id, h.status, who(h.byEmail), typeof h.at === 'string' ? h.at : created);
        }
      }
      db.prepare('UPDATE buildings SET next_number = ? WHERE id = ?').run(Math.max(parseId(p.nextNumber) || 0, maxNumber + 1), ws);

      if (replaceContracts) {
        db.prepare('DELETE FROM service_contracts WHERE building_id = ?').run(ws);
        const insFile = db.prepare('INSERT INTO contract_files (building_id, contract_id, name, type, size, file, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)');
        for (const c of p.contracts) {
          if (!c || typeof c.title !== 'string' || !c.title.trim() || !isValidDate(c.endDate)) continue;
          const created = typeof c.createdAt === 'string' ? c.createdAt : nowIso();
          const cost = moneyField(c.cost);
          const id = Number(db.prepare(`
            INSERT INTO service_contracts (building_id, title, category_id, vendor_id, company, contact_name, contact_phone, contact_email,
              contract_number, start_date, end_date, auto_renew, renewal_months, cost, payment_frequency, scope, notes, responsible_id,
              reminder_ack_end, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
            ws, c.title.slice(0, 120), optIds.category.get(c.category) ?? null, vendorIds.get(c.vendorId) ?? null,
            safe(c.company, 100) || '—', safe(c.contactName, 80), safe(c.contactPhone, 20), safe(c.contactEmail, 254),
            safe(c.contractNumber, 60), isValidDate(c.startDate) ? c.startDate : null, c.endDate, c.autoRenew ? 1 : 0,
            Number.isInteger(c.renewalMonths) && c.renewalMonths >= 1 && c.renewalMonths <= 120 ? c.renewalMonths : 12,
            cost.error ? null : cost.value, FREQUENCIES.includes(c.paymentFrequency) ? c.paymentFrequency : 'yearly',
            safe(c.scope, 3000), safe(c.notes, 3000), who(c.responsibleEmail), c.reminderHandled ? c.endDate : null,
            created, typeof c.updatedAt === 'string' ? c.updatedAt : created,
          ).lastInsertRowid);
          for (const f of Array.isArray(c.files) ? c.files : []) {
            const ext = (String(f?.name || '').split('.').pop() || '').toLowerCase();
            if (!CONTRACT_FILE_TYPES[ext] || typeof f.data !== 'string') continue;
            const buf = Buffer.from(f.data, 'base64');
            const file = `${crypto.randomBytes(16).toString('hex')}.${ext}`;
            fs.writeFileSync(path.join(db.uploadsDir, file), buf);
            written.push(file);
            insFile.run(ws, id, path.basename(String(f.name)).slice(0, 150), CONTRACT_FILE_TYPES[ext], buf.length, file, nowIso());
          }
        }
      }
      // Backups made before the bank page existed have no "bank" key: keep the current bank data then.
      if (p.bank) bank.restoreBank(ws, p.bank);
    });
  } catch (err) {
    removeFiles(written);
    throw err;
  }
  removeFiles(oldFiles);
  res.json({ ok: true, tickets: db.prepare('SELECT COUNT(*) AS n FROM tickets WHERE building_id = ?').get(ws).n });
});

/* ------------------------------------------------------------------ */
/* Fallbacks & errors                                                  */
/* ------------------------------------------------------------------ */

app.use('/api', (req, res) => res.status(404).json({ error: 'לא נמצא' }));
app.use((req, res) => res.redirect('/'));

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'בקשה לא תקינה' });
  if (err.type === 'entity.too.large') return res.status(413).json({ error: 'הקובץ גדול מדי' });
  console.error(err);
  res.status(500).json({ error: 'אירעה שגיאה בשרת' });
});

purgeExpiredSessions();
setInterval(purgeExpiredSessions, 60 * 60 * 1000).unref();

app.listen(PORT, () => {
  console.log(`House committee faults app running at http://localhost:${PORT}`);
});
