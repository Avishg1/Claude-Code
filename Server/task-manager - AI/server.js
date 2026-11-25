'use strict';

const path = require('node:path');
const fs = require('node:fs/promises');
const crypto = require('node:crypto');
const { promisify } = require('node:util');
const express = require('express');
const db = require('./db');
const markdown = require('./markdown');

const PORT = Number(process.env.PORT) || 3000;
const COOKIE_NAME = 'tm_session';
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 7; // 7 days
const SECURE_COOKIES = process.env.NODE_ENV === 'production';

const PRIORITIES = new Set(['low', 'medium', 'high']);
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

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

function cookieOptions() {
  return { httpOnly: true, sameSite: 'lax', secure: SECURE_COOKIES, path: '/' };
}

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
/* App setup                                                           */
/* ------------------------------------------------------------------ */

const app = express();
app.disable('x-powered-by');

app.use((req, res, next) => {
  res.set({
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'same-origin',
  });
  next();
});

app.use(express.json({ limit: '100kb' }));

// The workspace `workspaceId` as seen by `userId`, or null if they aren't a member.
function membership(workspaceId, userId) {
  if (!workspaceId) return null;
  const row = db.prepare(`
    SELECT w.id, w.name, w.personal, w.owner_id AS ownerId, m.role
    FROM workspaces w
    JOIN workspace_members m ON m.workspace_id = w.id AND m.user_id = ?
    WHERE w.id = ?
  `).get(userId, workspaceId);
  return row ? { ...row, personal: row.personal === 1 } : null;
}

// Attach the logged-in user (if any) and the workspace this request works in.
app.use((req, res, next) => {
  req.user = null;
  req.workspace = null;
  const token = getCookie(req, COOKIE_NAME);
  if (token) {
    const row = db.prepare(`
      SELECT u.id, u.email, u.name, u.sort_mode AS sortMode, u.active_workspace_id AS activeWorkspaceId,
             s.expires_at AS expiresAt
      FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = ?
    `).get(hashToken(token));
    if (row && row.expiresAt > Date.now()) {
      req.user = { id: row.id, email: row.email, name: row.name, sortMode: row.sortMode };
      req.sessionTokenHash = hashToken(token);

      // Pages send the workspace they show (X-Workspace-Id), so two tabs on different
      // workspaces never mix. A page that hasn't loaded yet gets the last one chosen.
      const requested = req.get('X-Workspace-Id');
      if (requested) {
        req.workspace = membership(parseId(requested), row.id);
        // No longer a member (removed, or the team was deleted): the page must reload.
        if (!req.workspace) req.workspaceGone = true;
      }
      req.workspace ||= membership(row.activeWorkspaceId, row.id)
        || membership(db.ensurePersonalWorkspace(row.id), row.id);
    }
  }
  next();
});

function requireAuth(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'יש להתחבר מחדש' });
  if (req.workspaceGone) {
    return res.status(409).json({ error: 'אין לך יותר גישה לצוות הזה', code: 'workspace_gone' });
  }
  next();
}

function parseId(value) {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
}

function isValidDate(s) {
  if (typeof s !== 'string' || !DATE_RE.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

/* ------------------------------------------------------------------ */
/* Pages                                                               */
/* ------------------------------------------------------------------ */

const VIEWS = path.join(__dirname, 'views');

function sendPage(res, file) {
  res.set('Cache-Control', 'no-store');
  res.sendFile(path.join(VIEWS, file));
}

app.get('/', (req, res) => (req.user ? res.redirect('/dashboard') : sendPage(res, 'index.html')));
app.get('/dashboard', (req, res) => (req.user ? sendPage(res, 'dashboard.html') : res.redirect('/')));
app.get('/table', (req, res) => (req.user ? sendPage(res, 'table.html') : res.redirect('/')));
app.get('/calendar', (req, res) => (req.user ? sendPage(res, 'calendar.html') : res.redirect('/')));

// User guide: README.he.md rendered into views/help.html. Open to everyone, logged in or not.
app.get('/help', async (req, res, next) => {
  try {
    const [template, guide] = await Promise.all([
      fs.readFile(path.join(VIEWS, 'help.html'), 'utf8'),
      fs.readFile(path.join(__dirname, 'README.he.md'), 'utf8'),
    ]);
    const back = req.user
      ? { href: '/dashboard', label: 'חזרה למשימות' }
      : { href: '/', label: 'חזרה להתחברות' };
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
/* Auth API                                                            */
/* ------------------------------------------------------------------ */

function readCredentials(body) {
  const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : '';
  const password = typeof body?.password === 'string' ? body.password : '';
  return { email, password };
}

function readName(value) {
  const name = typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : '';
  if (!name) return { error: 'יש להזין שם' };
  if (name.length > 60) return { error: 'השם ארוך מדי (עד 60 תווים)' };
  return { name };
}

app.post('/api/auth/signup', async (req, res) => {
  const { email, password } = readCredentials(req.body);
  const { name, error: nameError } = readName(req.body?.name);
  if (nameError) return res.status(400).json({ error: nameError });
  if (!EMAIL_RE.test(email) || email.length > 254) {
    return res.status(400).json({ error: 'כתובת האימייל אינה תקינה' });
  }
  if (password.length < 8) {
    return res.status(400).json({ error: 'הסיסמה חייבת להכיל לפחות 8 תווים' });
  }
  if (password.length > 200) {
    return res.status(400).json({ error: 'הסיסמה ארוכה מדי' });
  }
  if (db.prepare('SELECT 1 FROM users WHERE email = ?').get(email)) {
    return res.status(409).json({ error: 'כבר קיים חשבון עם כתובת האימייל הזו' });
  }

  const passwordHash = await hashPassword(password);
  let userId;
  db.exec('BEGIN');
  try {
    userId = Number(db.prepare('INSERT INTO users (email, password_hash, name) VALUES (?, ?, ?)')
      .run(email, passwordHash, name).lastInsertRowid);
    const workspaceId = db.ensurePersonalWorkspace(userId);
    db.prepare('UPDATE users SET active_workspace_id = ? WHERE id = ?').run(workspaceId, userId);
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    if (String(err.message).includes('UNIQUE')) {
      return res.status(409).json({ error: 'כבר קיים חשבון עם כתובת האימייל הזו' });
    }
    throw err;
  }

  startSession(res, userId);
  res.status(201).json({ user: { id: userId, email, name } });
});

app.post('/api/auth/login', async (req, res) => {
  const { email, password } = readCredentials(req.body);
  if (!email || !password) {
    return res.status(400).json({ error: 'יש להזין אימייל וסיסמה' });
  }

  const user = db.prepare('SELECT id, email, name, password_hash AS passwordHash FROM users WHERE email = ?').get(email);
  const ok = await verifyPassword(password, user ? user.passwordHash : DUMMY_HASH);
  if (!user || !ok) {
    return res.status(401).json({ error: 'אימייל או סיסמה שגויים' });
  }

  purgeExpiredSessions();
  startSession(res, user.id);
  res.json({ user: { id: user.id, email: user.email, name: user.name } });
});

app.post('/api/auth/logout', (req, res) => {
  if (req.sessionTokenHash) {
    db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(req.sessionTokenHash);
  }
  res.clearCookie(COOKIE_NAME, cookieOptions());
  res.status(204).end();
});

// Everything a page needs to start: who you are, the workspace it shows, the other
// workspaces you can switch to, and the members (for "responsible" pickers).
app.get('/api/auth/me', requireAuth, (req, res) => {
  res.json({
    user: req.user,
    workspace: workspaceInfo(req.workspace),
    workspaces: listWorkspaces(req.user.id),
    members: listMembers(req.workspace.id),
  });
});

app.put('/api/profile', requireAuth, (req, res) => {
  const { name, error } = readName(req.body?.name);
  if (error) return res.status(400).json({ error });
  db.prepare('UPDATE users SET name = ? WHERE id = ?').run(name, req.user.id);
  res.json({ user: { ...req.user, name } });
});

/* ------------------------------------------------------------------ */
/* User settings                                                       */
/* ------------------------------------------------------------------ */

const SORT_MODES = new Set(['due', 'manual']);

app.put('/api/settings', requireAuth, (req, res) => {
  const sortMode = req.body?.sortMode;
  if (!SORT_MODES.has(sortMode)) return res.status(400).json({ error: 'אפשרות מיון לא תקינה' });
  db.prepare('UPDATE users SET sort_mode = ? WHERE id = ?').run(sortMode, req.user.id);
  res.json({ settings: { sortMode } });
});

/* ------------------------------------------------------------------ */
/* Workspaces & teams                                                  */
/*   Every user has a personal workspace; teams are shared workspaces. */
/*   All members can read and edit a team's tasks and categories;      */
/*   only the owner manages members, renames or deletes the team.      */
/* ------------------------------------------------------------------ */

const workspaceInfo = (ws) => ({
  id: ws.id,
  name: ws.name,
  personal: ws.personal,
  role: ws.role,
  isOwner: ws.role === 'owner',
});

function listWorkspaces(userId) {
  return db.prepare(`
    SELECT w.id, w.name, w.personal, m.role,
           (SELECT COUNT(*) FROM workspace_members x WHERE x.workspace_id = w.id) AS memberCount
    FROM workspaces w
    JOIN workspace_members m ON m.workspace_id = w.id AND m.user_id = ?
    ORDER BY w.personal DESC, w.name COLLATE NOCASE
  `).all(userId).map((w) => ({ ...w, personal: w.personal === 1 }));
}

function listMembers(workspaceId) {
  return db.prepare(`
    SELECT u.id, u.name, u.email, m.role
    FROM workspace_members m JOIN users u ON u.id = m.user_id
    WHERE m.workspace_id = ?
    ORDER BY m.role = 'owner' DESC, COALESCE(u.name, u.email) COLLATE NOCASE
  `).all(workspaceId);
}

function readTeamName(body) {
  const name = typeof body?.name === 'string' ? body.name.trim().replace(/\s+/g, ' ') : '';
  if (!name) return { error: 'יש להזין שם לצוות' };
  if (name.length > 50) return { error: 'שם הצוות ארוך מדי (עד 50 תווים)' };
  return { name };
}

// Team management applies to the workspace the page is showing, and only to teams.
function requireTeam(req, res, next) {
  if (req.workspace.personal) return res.status(400).json({ error: 'זו רשימה אישית ולא צוות' });
  next();
}

function requireOwner(req, res, next) {
  if (req.workspace.role !== 'owner') return res.status(403).json({ error: 'רק מנהל הצוות יכול לעשות זאת' });
  next();
}

app.use(['/api/workspaces', '/api/workspace'], requireAuth);

app.get('/api/workspaces', (req, res) => {
  res.json({ workspaces: listWorkspaces(req.user.id) });
});

// Create a team. The creator becomes its owner and switches to it.
app.post('/api/workspaces', (req, res) => {
  const { name, error } = readTeamName(req.body);
  if (error) return res.status(400).json({ error });
  db.exec('BEGIN');
  try {
    const id = Number(db.prepare('INSERT INTO workspaces (name, owner_id, personal) VALUES (?, ?, 0)')
      .run(name, req.user.id).lastInsertRowid);
    db.prepare("INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (?, ?, 'owner')").run(id, req.user.id);
    db.prepare('UPDATE users SET active_workspace_id = ? WHERE id = ?').run(id, req.user.id);
    db.exec('COMMIT');
    res.status(201).json({ workspace: workspaceInfo(membership(id, req.user.id)) });
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
});

// Switch the workspace that pages open by default.
app.put('/api/workspaces/active', (req, res) => {
  const ws = membership(parseId(req.body?.id), req.user.id);
  if (!ws) return res.status(404).json({ error: 'הצוות לא נמצא' });
  db.prepare('UPDATE users SET active_workspace_id = ? WHERE id = ?').run(ws.id, req.user.id);
  res.json({ workspace: workspaceInfo(ws) });
});

app.put('/api/workspace', requireTeam, requireOwner, (req, res) => {
  const { name, error } = readTeamName(req.body);
  if (error) return res.status(400).json({ error });
  db.prepare('UPDATE workspaces SET name = ? WHERE id = ?').run(name, req.workspace.id);
  res.json({ workspace: { ...workspaceInfo(req.workspace), name } });
});

// Deletes the team with all of its tasks and categories.
app.delete('/api/workspace', requireTeam, requireOwner, (req, res) => {
  db.exec('BEGIN');
  try {
    db.prepare('UPDATE users SET active_workspace_id = NULL WHERE active_workspace_id = ?').run(req.workspace.id);
    db.prepare('DELETE FROM workspaces WHERE id = ?').run(req.workspace.id);
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
  res.status(204).end();
});

app.get('/api/workspace/members', (req, res) => {
  res.json({ members: listMembers(req.workspace.id) });
});

// Add someone who already has an account, by the email they signed up with.
app.post('/api/workspace/members', requireTeam, requireOwner, (req, res) => {
  const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
  if (!EMAIL_RE.test(email)) return res.status(400).json({ error: 'כתובת האימייל אינה תקינה' });
  const user = db.prepare('SELECT id, name, email FROM users WHERE email = ?').get(email);
  if (!user) {
    return res.status(404).json({ error: 'אין משתמש עם האימייל הזה. בקשו ממנו להירשם לאפליקציה, ואז הוסיפו אותו.' });
  }
  const exists = db.prepare('SELECT 1 FROM workspace_members WHERE workspace_id = ? AND user_id = ?').get(req.workspace.id, user.id);
  if (exists) return res.status(409).json({ error: 'המשתמש כבר חבר בצוות' });
  db.prepare("INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (?, ?, 'member')").run(req.workspace.id, user.id);
  res.status(201).json({ member: { ...user, role: 'member' } });
});

// The owner removes a member, or a member leaves. Their tasks in the team become unassigned.
app.delete('/api/workspace/members/:userId', requireTeam, (req, res) => {
  const userId = parseId(req.params.userId);
  const leaving = userId === req.user.id;
  if (!leaving && req.workspace.role !== 'owner') {
    return res.status(403).json({ error: 'רק מנהל הצוות יכול להסיר חברים' });
  }
  const member = db.prepare('SELECT role FROM workspace_members WHERE workspace_id = ? AND user_id = ?').get(req.workspace.id, userId);
  if (!member) return res.status(404).json({ error: 'החבר לא נמצא בצוות' });
  if (member.role === 'owner') {
    return res.status(400).json({ error: 'מנהל הצוות לא יכול לעזוב. אפשר למחוק את הצוות.' });
  }
  db.exec('BEGIN');
  try {
    db.prepare('DELETE FROM workspace_members WHERE workspace_id = ? AND user_id = ?').run(req.workspace.id, userId);
    db.prepare('UPDATE tasks SET assignee_id = NULL WHERE workspace_id = ? AND assignee_id = ?').run(req.workspace.id, userId);
    db.prepare('UPDATE users SET active_workspace_id = NULL WHERE id = ? AND active_workspace_id = ?').run(userId, req.workspace.id);
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
  res.status(204).end();
});

/* ------------------------------------------------------------------ */
/* Categories API (scoped to the current workspace)                    */
/* ------------------------------------------------------------------ */

app.use('/api/categories', requireAuth);

function readCategoryName(body) {
  const name = typeof body?.name === 'string' ? body.name.trim() : '';
  if (!name) return { error: 'יש להזין שם לקטגוריה' };
  if (name.length > 50) return { error: 'שם הקטגוריה ארוך מדי (עד 50 תווים)' };
  return { name };
}

function isUniqueViolation(err) {
  return String(err?.message).includes('UNIQUE');
}

app.get('/api/categories', (req, res) => {
  const categories = db.prepare(`
    SELECT c.id, c.name,
           COUNT(t.id) AS total,
           COALESCE(SUM(t.completed = 0), 0) AS open
    FROM categories c
    LEFT JOIN tasks t ON t.category_id = c.id
    WHERE c.workspace_id = ?
    GROUP BY c.id
    ORDER BY c.name COLLATE NOCASE
  `).all(req.workspace.id);

  const totals = db.prepare(`
    SELECT COUNT(*) AS total,
           COALESCE(SUM(completed = 0), 0) AS open,
           COALESCE(SUM(category_id IS NULL), 0) AS uncategorizedTotal,
           COALESCE(SUM(category_id IS NULL AND completed = 0), 0) AS uncategorizedOpen
    FROM tasks WHERE workspace_id = ?
  `).get(req.workspace.id);

  res.json({
    categories,
    all: { total: totals.total, open: totals.open },
    uncategorized: { total: totals.uncategorizedTotal, open: totals.uncategorizedOpen },
  });
});

app.post('/api/categories', (req, res) => {
  const { name, error } = readCategoryName(req.body);
  if (error) return res.status(400).json({ error });
  try {
    const id = Number(db.prepare('INSERT INTO categories (workspace_id, name) VALUES (?, ?)').run(req.workspace.id, name).lastInsertRowid);
    res.status(201).json({ category: { id, name, total: 0, open: 0 } });
  } catch (err) {
    if (isUniqueViolation(err)) return res.status(409).json({ error: 'כבר קיימת קטגוריה בשם הזה' });
    throw err;
  }
});

app.put('/api/categories/:id', (req, res) => {
  const id = parseId(req.params.id);
  const { name, error } = readCategoryName(req.body);
  if (error) return res.status(400).json({ error });
  try {
    const { changes } = db.prepare('UPDATE categories SET name = ? WHERE id = ? AND workspace_id = ?').run(name, id, req.workspace.id);
    if (!changes) return res.status(404).json({ error: 'הקטגוריה לא נמצאה' });
    res.json({ category: { id, name } });
  } catch (err) {
    if (isUniqueViolation(err)) return res.status(409).json({ error: 'כבר קיימת קטגוריה בשם הזה' });
    throw err;
  }
});

app.delete('/api/categories/:id', (req, res) => {
  const id = parseId(req.params.id);
  // Tasks in this category are kept and become uncategorized (ON DELETE SET NULL).
  const { changes } = db.prepare('DELETE FROM categories WHERE id = ? AND workspace_id = ?').run(id, req.workspace.id);
  if (!changes) return res.status(404).json({ error: 'הקטגוריה לא נמצאה' });
  res.status(204).end();
});

/* ------------------------------------------------------------------ */
/* Tasks API (scoped to the current workspace)                         */
/* ------------------------------------------------------------------ */

app.use('/api/tasks', requireAuth);

const TASK_SELECT = `
  SELECT t.id, t.title, t.description, t.due_date AS dueDate, t.priority,
         t.completed, t.position, t.category_id AS categoryId, c.name AS categoryName,
         t.assignee_id AS assigneeId, a.name AS assigneeName, a.email AS assigneeEmail,
         t.user_id AS createdById, cb.name AS createdByName, cb.email AS createdByEmail,
         t.created_at AS createdAt
  FROM tasks t
  LEFT JOIN categories c ON c.id = t.category_id
  LEFT JOIN users a ON a.id = t.assignee_id
  LEFT JOIN users cb ON cb.id = t.user_id
`;

const serializeTask = (row) => ({ ...row, completed: row.completed === 1 });

function getTask(id, workspaceId) {
  const row = db.prepare(`${TASK_SELECT} WHERE t.id = ? AND t.workspace_id = ?`).get(id, workspaceId);
  return row ? serializeTask(row) : null;
}

// One validator per editable field, shared by create (POST), full update (PUT)
// and partial update (PATCH). Each returns { value } or { error }.
const TASK_FIELDS = {
  title: {
    column: 'title',
    parse(v) {
      const title = typeof v === 'string' ? v.trim() : '';
      if (!title) return { error: 'יש להזין כותרת למשימה' };
      if (title.length > 200) return { error: 'הכותרת ארוכה מדי (עד 200 תווים)' };
      return { value: title };
    },
  },
  description: {
    column: 'description',
    parse(v) {
      if (v === undefined || v === null) return { value: null };
      if (typeof v !== 'string') return { error: 'תיאור לא תקין' };
      const description = v.trim();
      if (description.length > 2000) return { error: 'התיאור ארוך מדי (עד 2000 תווים)' };
      return { value: description || null };
    },
  },
  dueDate: {
    column: 'due_date',
    parse: (v) => (isValidDate(v) ? { value: v } : { error: 'יש לבחור תאריך יעד תקין' }),
  },
  priority: {
    column: 'priority',
    parse: (v) => (PRIORITIES.has(v) ? { value: v } : { error: 'רמת העדיפות אינה תקינה' }),
  },
  categoryId: {
    column: 'category_id',
    parse(v, workspaceId) {
      if (v === undefined || v === null || v === '') return { value: null };
      const categoryId = parseId(v);
      const owned = categoryId && db.prepare('SELECT 1 FROM categories WHERE id = ? AND workspace_id = ?').get(categoryId, workspaceId);
      return owned ? { value: categoryId } : { error: 'הקטגוריה לא נמצאה' };
    },
  },
  // Who is responsible: any member of the workspace, or nobody.
  assigneeId: {
    column: 'assignee_id',
    parse(v, workspaceId) {
      if (v === undefined || v === null || v === '') return { value: null };
      const userId = parseId(v);
      const member = userId && db.prepare('SELECT 1 FROM workspace_members WHERE workspace_id = ? AND user_id = ?').get(workspaceId, userId);
      return member ? { value: userId } : { error: 'האחראי אינו חבר בצוות' };
    },
  },
  completed: {
    column: 'completed',
    parse: (v) => (typeof v === 'boolean' ? { value: v ? 1 : 0 } : { error: 'ערך לא תקין' }),
  },
};

// Full task input (POST / PUT): every field except "completed". "assigneeId" is only
// read when sent, so a client that doesn't know about it never clears it by accident.
function readTaskInput(body, workspaceId) {
  const value = {};
  for (const key of ['title', 'description', 'dueDate', 'priority', 'categoryId', 'assigneeId']) {
    if (key === 'assigneeId' && !Object.hasOwn(body ?? {}, 'assigneeId')) continue;
    const raw = key === 'priority' ? (body?.priority ?? 'medium') : body?.[key];
    const result = TASK_FIELDS[key].parse(raw, workspaceId);
    if (result.error) return { error: result.error };
    value[key] = result.value;
  }
  return { value };
}

app.get('/api/tasks', (req, res) => {
  const rows = db.prepare(`
    ${TASK_SELECT}
    WHERE t.workspace_id = ?
    ORDER BY t.due_date ASC,
             CASE t.priority WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END,
             t.id ASC
  `).all(req.workspace.id);
  res.json({ tasks: rows.map(serializeTask) });
});

app.post('/api/tasks', (req, res) => {
  const ws = req.workspace.id;
  const { value, error } = readTaskInput(req.body, ws);
  if (error) return res.status(400).json({ error });
  // New tasks go to the top of the manual order.
  const id = Number(db.prepare(`
    INSERT INTO tasks (user_id, workspace_id, category_id, assignee_id, title, description, due_date, priority, position)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, (SELECT COALESCE(MIN(position), 0) - 1 FROM tasks WHERE workspace_id = ?))
  `).run(req.user.id, ws, value.categoryId, value.assigneeId ?? null, value.title, value.description,
    value.dueDate, value.priority, ws).lastInsertRowid);
  res.status(201).json({ task: getTask(id, ws) });
});

// Save the manual order. Body: { ids: [...] } — every task id in the workspace, in the new order.
// Must be registered before PUT /api/tasks/:id.
app.put('/api/tasks/order', (req, res) => {
  const ws = req.workspace.id;
  const ids = req.body?.ids;
  if (!Array.isArray(ids) || ids.length > 10000 || !ids.every((id) => Number.isInteger(id) && id > 0)) {
    return res.status(400).json({ error: 'סדר לא תקין' });
  }

  const owned = new Set(db.prepare('SELECT id FROM tasks WHERE workspace_id = ?').all(ws).map((r) => r.id));
  const unique = new Set(ids);
  if (unique.size !== ids.length || unique.size !== owned.size || !ids.every((id) => owned.has(id))) {
    return res.status(409).json({ error: 'רשימת המשימות השתנתה, נסו שוב' });
  }

  const update = db.prepare('UPDATE tasks SET position = ? WHERE id = ? AND workspace_id = ?');
  db.exec('BEGIN');
  try {
    ids.forEach((id, index) => update.run(index, id, ws));
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
  res.status(204).end();
});

app.put('/api/tasks/:id', (req, res) => {
  const ws = req.workspace.id;
  const id = parseId(req.params.id);
  const { value, error } = readTaskInput(req.body, ws);
  if (error) return res.status(400).json({ error });
  const assignee = value.assigneeId === undefined ? '' : ', assignee_id = ?';
  const params = [value.categoryId, value.title, value.description, value.dueDate, value.priority];
  if (value.assigneeId !== undefined) params.push(value.assigneeId);
  const { changes } = db.prepare(`
    UPDATE tasks SET category_id = ?, title = ?, description = ?, due_date = ?, priority = ?${assignee}
    WHERE id = ? AND workspace_id = ?
  `).run(...params, id, ws);
  if (!changes) return res.status(404).json({ error: 'המשימה לא נמצאה' });
  res.json({ task: getTask(id, ws) });
});

// Partial update: send only the fields that changed, e.g. { priority: "high" }.
app.patch('/api/tasks/:id', (req, res) => {
  const ws = req.workspace.id;
  const id = parseId(req.params.id);
  const body = req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : {};
  const keys = Object.keys(body);
  if (!keys.length) return res.status(400).json({ error: 'לא נשלחו שינויים' });

  const sets = [];
  const params = [];
  for (const key of keys) {
    if (!Object.hasOwn(TASK_FIELDS, key)) return res.status(400).json({ error: `שדה לא מוכר: ${key}` });
    const result = TASK_FIELDS[key].parse(body[key], ws);
    if (result.error) return res.status(400).json({ error: result.error });
    sets.push(`${TASK_FIELDS[key].column} = ?`);
    params.push(result.value);
  }

  const { changes } = db.prepare(`UPDATE tasks SET ${sets.join(', ')} WHERE id = ? AND workspace_id = ?`)
    .run(...params, id, ws);
  if (!changes) return res.status(404).json({ error: 'המשימה לא נמצאה' });
  res.json({ task: getTask(id, ws) });
});

app.delete('/api/tasks/:id', (req, res) => {
  const id = parseId(req.params.id);
  const { changes } = db.prepare('DELETE FROM tasks WHERE id = ? AND workspace_id = ?').run(id, req.workspace.id);
  if (!changes) return res.status(404).json({ error: 'המשימה לא נמצאה' });
  res.status(204).end();
});

/* ------------------------------------------------------------------ */
/* Fallbacks & errors                                                  */
/* ------------------------------------------------------------------ */

app.use('/api', (req, res) => res.status(404).json({ error: 'לא נמצא' }));
app.use((req, res) => res.redirect('/'));

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'בקשה לא תקינה' });
  }
  console.error(err);
  res.status(500).json({ error: 'אירעה שגיאה בשרת' });
});

purgeExpiredSessions();
setInterval(purgeExpiredSessions, 60 * 60 * 1000).unref();

app.listen(PORT, () => {
  console.log(`Task manager running at http://localhost:${PORT}`);
});
