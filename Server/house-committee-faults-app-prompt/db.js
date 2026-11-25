'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const dataDir = process.env.DATA_DIR || path.join(__dirname, 'data');
const uploadsDir = path.join(dataDir, 'uploads');
fs.mkdirSync(uploadsDir, { recursive: true });

const db = new DatabaseSync(path.join(dataDir, 'faults.db'));

/*
 * Data model
 *   users             — accounts (name + phone are shown to the other committee members)
 *   buildings         — a building managed by a house committee; shared by its members
 *   building_members  — who belongs to which building (role: owner | member)
 *   options           — the editable lists of a building: categories, floors, areas
 *   vendors           — the building's directory of external companies / professionals
 *   tickets           — fault tickets; numbered per building (next_number)
 *   ticket_updates    — the updates timeline of a ticket (optionally with a status change)
 *   status_history    — every status a ticket went through, with who and when
 *   media             — image / video attachments; the file itself lives in data/uploads
 *
 * All timestamps are ISO-8601 UTC strings written by the server.
 * Date-only fields (ext_referred_at, ext_expected_at) are YYYY-MM-DD.
 */
db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;

  CREATE TABLE IF NOT EXISTS users (
    id                 INTEGER PRIMARY KEY AUTOINCREMENT,
    email              TEXT NOT NULL UNIQUE COLLATE NOCASE,
    password_hash      TEXT NOT NULL,
    name               TEXT NOT NULL,
    phone              TEXT,
    active_building_id INTEGER,
    created_at         TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

  CREATE TABLE IF NOT EXISTS buildings (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT NOT NULL,
    address     TEXT,
    owner_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    next_number INTEGER NOT NULL DEFAULT 1001,
    created_at  TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS building_members (
    building_id INTEGER NOT NULL REFERENCES buildings(id) ON DELETE CASCADE,
    user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role        TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('owner', 'member')),
    joined_at   TEXT NOT NULL,
    PRIMARY KEY (building_id, user_id)
  );
  CREATE INDEX IF NOT EXISTS idx_members_user ON building_members(user_id);

  CREATE TABLE IF NOT EXISTS options (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    building_id INTEGER NOT NULL REFERENCES buildings(id) ON DELETE CASCADE,
    kind        TEXT NOT NULL CHECK (kind IN ('category', 'floor', 'area')),
    name        TEXT NOT NULL COLLATE NOCASE,
    position    INTEGER NOT NULL DEFAULT 0,
    UNIQUE (building_id, kind, name)
  );

  CREATE TABLE IF NOT EXISTS vendors (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    building_id INTEGER NOT NULL REFERENCES buildings(id) ON DELETE CASCADE,
    company     TEXT NOT NULL,
    contact     TEXT,
    phone       TEXT,
    specialty   TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_vendors_building ON vendors(building_id);

  CREATE TABLE IF NOT EXISTS tickets (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    building_id      INTEGER NOT NULL REFERENCES buildings(id) ON DELETE CASCADE,
    number           INTEGER NOT NULL,
    title            TEXT NOT NULL,
    description      TEXT,
    category_id      INTEGER REFERENCES options(id) ON DELETE SET NULL,
    floor_id         INTEGER REFERENCES options(id) ON DELETE SET NULL,
    area_id          INTEGER REFERENCES options(id) ON DELETE SET NULL,
    apartment        TEXT,
    priority         TEXT NOT NULL DEFAULT 'medium' CHECK (priority IN ('low', 'medium', 'high', 'urgent')),
    status           TEXT NOT NULL DEFAULT 'new'
                     CHECK (status IN ('new', 'in_progress', 'waiting_vendor', 'waiting_parts', 'resolved', 'closed', 'cancelled')),
    reporter_name    TEXT,
    reporter_phone   TEXT,
    reporter_channel TEXT NOT NULL DEFAULT 'whatsapp',
    responsible_id   INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_by       INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at       TEXT NOT NULL,
    updated_at       TEXT NOT NULL,
    resolved_at      TEXT,
    ext_opened       INTEGER NOT NULL DEFAULT 0 CHECK (ext_opened IN (0, 1)),
    ext_vendor_id    INTEGER REFERENCES vendors(id) ON DELETE SET NULL,
    ext_company      TEXT,
    ext_ref          TEXT,
    ext_contact      TEXT,
    ext_phone        TEXT,
    ext_referred_at  TEXT,
    ext_expected_at  TEXT,
    UNIQUE (building_id, number)
  );
  CREATE INDEX IF NOT EXISTS idx_tickets_building ON tickets(building_id);

  CREATE TABLE IF NOT EXISTS ticket_updates (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    ticket_id   INTEGER NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
    author_id   INTEGER REFERENCES users(id) ON DELETE SET NULL,
    text        TEXT,
    status_from TEXT,
    status_to   TEXT,
    created_at  TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_updates_ticket ON ticket_updates(ticket_id);

  CREATE TABLE IF NOT EXISTS status_history (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    ticket_id INTEGER NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
    status    TEXT NOT NULL,
    by_id     INTEGER REFERENCES users(id) ON DELETE SET NULL,
    at        TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_history_ticket ON status_history(ticket_id);

  CREATE TABLE IF NOT EXISTS media (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    building_id INTEGER NOT NULL REFERENCES buildings(id) ON DELETE CASCADE,
    ticket_id   INTEGER NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
    update_id   INTEGER REFERENCES ticket_updates(id) ON DELETE CASCADE,
    name        TEXT NOT NULL,
    type        TEXT NOT NULL,
    size        INTEGER NOT NULL,
    file        TEXT NOT NULL UNIQUE,
    created_at  TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_media_ticket ON media(ticket_id);
`);

db.uploadsDir = uploadsDir;

/** Run fn inside a transaction; rolls back and rethrows on error. */
db.transaction = (fn) => {
  db.exec('BEGIN');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
};

module.exports = db;
