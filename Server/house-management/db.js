'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const dataDir = process.env.DATA_DIR || path.join(__dirname, 'data');
fs.mkdirSync(dataDir, { recursive: true });

const db = new DatabaseSync(path.join(dataDir, 'tasks.db'));

/*
 * Data model
 *   users              — accounts
 *   workspaces         — a place tasks live: every user has one personal workspace,
 *                        and teams are workspaces shared by their members
 *   workspace_members  — who belongs to which workspace (role: owner | member)
 *   categories, tasks  — belong to a workspace; tasks.user_id is who created the task,
 *                        tasks.assignee_id is who is responsible for it
 */
db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;

  CREATE TABLE IF NOT EXISTS users (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    email               TEXT NOT NULL UNIQUE COLLATE NOCASE,
    password_hash       TEXT NOT NULL,
    name                TEXT,
    sort_mode           TEXT NOT NULL DEFAULT 'due',
    active_workspace_id INTEGER,
    created_at          TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

  CREATE TABLE IF NOT EXISTS workspaces (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    name       TEXT NOT NULL,
    owner_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    personal   INTEGER NOT NULL DEFAULT 0 CHECK (personal IN (0, 1)),
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE UNIQUE INDEX IF NOT EXISTS idx_workspaces_personal ON workspaces(owner_id) WHERE personal = 1;

  CREATE TABLE IF NOT EXISTS workspace_members (
    workspace_id INTEGER NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role         TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('owner', 'member')),
    joined_at    TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (workspace_id, user_id)
  );
  CREATE INDEX IF NOT EXISTS idx_members_user ON workspace_members(user_id);

  CREATE TABLE IF NOT EXISTS categories (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    workspace_id INTEGER NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    name         TEXT NOT NULL COLLATE NOCASE,
    created_at   TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE (workspace_id, name)
  );

  CREATE TABLE IF NOT EXISTS tasks (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    workspace_id INTEGER REFERENCES workspaces(id) ON DELETE CASCADE,
    category_id  INTEGER REFERENCES categories(id) ON DELETE SET NULL,
    assignee_id  INTEGER REFERENCES users(id) ON DELETE SET NULL,
    title        TEXT NOT NULL,
    description  TEXT,
    due_date     TEXT NOT NULL,
    priority     TEXT NOT NULL DEFAULT 'medium' CHECK (priority IN ('low', 'medium', 'high')),
    completed    INTEGER NOT NULL DEFAULT 0 CHECK (completed IN (0, 1)),
    position     INTEGER NOT NULL DEFAULT 0,
    created_at   TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_tasks_category ON tasks(category_id);
`);

/* ---------- Migrations for databases created by earlier versions ---------- */

const hasColumn = (table, column) =>
  db.prepare(`PRAGMA table_info(${table})`).all().some((c) => c.name === column);

if (!hasColumn('tasks', 'position')) {
  // Seed the manual order with the existing due-date order, per user.
  db.exec(`
    ALTER TABLE tasks ADD COLUMN position INTEGER NOT NULL DEFAULT 0;
    UPDATE tasks SET position = (
      SELECT rn FROM (
        SELECT id, ROW_NUMBER() OVER (
          PARTITION BY user_id
          ORDER BY due_date, CASE priority WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END, id
        ) - 1 AS rn
        FROM tasks
      ) r WHERE r.id = tasks.id
    );
  `);
}

if (!hasColumn('users', 'sort_mode')) {
  db.exec(`ALTER TABLE users ADD COLUMN sort_mode TEXT NOT NULL DEFAULT 'due'`);
}
if (!hasColumn('users', 'name')) {
  db.exec('ALTER TABLE users ADD COLUMN name TEXT');
}
if (!hasColumn('users', 'active_workspace_id')) {
  db.exec('ALTER TABLE users ADD COLUMN active_workspace_id INTEGER');
}
if (!hasColumn('tasks', 'workspace_id')) {
  db.exec('ALTER TABLE tasks ADD COLUMN workspace_id INTEGER REFERENCES workspaces(id) ON DELETE CASCADE');
}
if (!hasColumn('tasks', 'assignee_id')) {
  db.exec('ALTER TABLE tasks ADD COLUMN assignee_id INTEGER REFERENCES users(id) ON DELETE SET NULL');
}

/* ---------- Personal workspaces ---------- */

const PERSONAL_NAME = 'המשימות שלי';

// Every user has exactly one personal workspace. Returns its id.
function ensurePersonalWorkspace(userId) {
  const existing = db.prepare('SELECT id FROM workspaces WHERE owner_id = ? AND personal = 1').get(userId);
  if (existing) return existing.id;
  const id = Number(db.prepare('INSERT INTO workspaces (name, owner_id, personal) VALUES (?, ?, 1)')
    .run(PERSONAL_NAME, userId).lastInsertRowid);
  db.prepare("INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (?, ?, 'owner')").run(id, userId);
  return id;
}

for (const { id } of db.prepare(`
  SELECT id FROM users u
  WHERE NOT EXISTS (SELECT 1 FROM workspaces w WHERE w.owner_id = u.id AND w.personal = 1)
`).all()) {
  ensurePersonalWorkspace(id);
}

// Categories used to belong to a user (UNIQUE per user). Move them into the owner's
// personal workspace; SQLite can't change a UNIQUE constraint in place, so rebuild the table.
if (hasColumn('categories', 'user_id')) {
  db.exec('PRAGMA foreign_keys = OFF');
  db.exec('BEGIN');
  try {
    db.exec(`
      CREATE TABLE categories_new (
        id           INTEGER PRIMARY KEY AUTOINCREMENT,
        workspace_id INTEGER NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
        name         TEXT NOT NULL COLLATE NOCASE,
        created_at   TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE (workspace_id, name)
      );
      INSERT INTO categories_new (id, workspace_id, name, created_at)
        SELECT c.id, w.id, c.name, c.created_at
        FROM categories c
        JOIN workspaces w ON w.owner_id = c.user_id AND w.personal = 1;
      DROP TABLE categories;
      ALTER TABLE categories_new RENAME TO categories;
    `);
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  } finally {
    db.exec('PRAGMA foreign_keys = ON');
  }
}

// Tasks from before teams existed go to their creator's personal workspace.
db.exec(`
  UPDATE tasks SET workspace_id = (
    SELECT w.id FROM workspaces w WHERE w.owner_id = tasks.user_id AND w.personal = 1
  ) WHERE workspace_id IS NULL;
`);

db.exec(`
  CREATE INDEX IF NOT EXISTS idx_tasks_workspace_due ON tasks(workspace_id, due_date);
  CREATE INDEX IF NOT EXISTS idx_tasks_workspace_position ON tasks(workspace_id, position);
  CREATE INDEX IF NOT EXISTS idx_tasks_assignee ON tasks(assignee_id);
  CREATE INDEX IF NOT EXISTS idx_categories_workspace ON categories(workspace_id);
  DROP INDEX IF EXISTS idx_tasks_user_due;
  DROP INDEX IF EXISTS idx_tasks_user_position;
`);

db.ensurePersonalWorkspace = ensurePersonalWorkspace;

module.exports = db;
