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

  /*
   * Service contracts (elevator maintenance, cleaning, insurance…).
   * end_date is the renewal date; the app reminds one month before it.
   * reminder_ack_end holds the end_date whose reminder was marked as handled,
   * so changing/renewing the end date automatically re-arms the reminder.
   */
  CREATE TABLE IF NOT EXISTS service_contracts (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    building_id       INTEGER NOT NULL REFERENCES buildings(id) ON DELETE CASCADE,
    title             TEXT NOT NULL,
    category_id       INTEGER REFERENCES options(id) ON DELETE SET NULL,
    vendor_id         INTEGER REFERENCES vendors(id) ON DELETE SET NULL,
    company           TEXT NOT NULL,
    contact_name      TEXT,
    contact_phone     TEXT,
    contact_email     TEXT,
    contract_number   TEXT,
    start_date        TEXT,
    end_date          TEXT NOT NULL,
    auto_renew        INTEGER NOT NULL DEFAULT 0 CHECK (auto_renew IN (0, 1)),
    renewal_months    INTEGER NOT NULL DEFAULT 12,
    cost              REAL,
    payment_frequency TEXT NOT NULL DEFAULT 'yearly'
                      CHECK (payment_frequency IN ('monthly', 'quarterly', 'semiannual', 'yearly', 'one_time')),
    scope             TEXT,
    notes             TEXT,
    responsible_id    INTEGER REFERENCES users(id) ON DELETE SET NULL,
    reminder_ack_end  TEXT,
    reminder_ack_by   INTEGER REFERENCES users(id) ON DELETE SET NULL,
    reminder_ack_at   TEXT,
    created_by        INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at        TEXT NOT NULL,
    updated_at        TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_contracts_building ON service_contracts(building_id);

  -- Contract documents (PDF / images); the file itself lives in data/uploads.
  CREATE TABLE IF NOT EXISTS contract_files (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    building_id INTEGER NOT NULL REFERENCES buildings(id) ON DELETE CASCADE,
    contract_id INTEGER NOT NULL REFERENCES service_contracts(id) ON DELETE CASCADE,
    name        TEXT NOT NULL,
    type        TEXT NOT NULL,
    size        INTEGER NOT NULL,
    file        TEXT NOT NULL UNIQUE,
    created_at  TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_contract_files_contract ON contract_files(contract_id);

  /*
   * Bank: transactions imported from bank-statement CSV files (or added by hand).
   * amount is signed: positive = credit / income (זכות), negative = debit / expense (חובה).
   * hash identifies a statement row so importing the same file twice skips duplicates.
   */
  CREATE TABLE IF NOT EXISTS bank_categories (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    building_id INTEGER NOT NULL REFERENCES buildings(id) ON DELETE CASCADE,
    name        TEXT NOT NULL COLLATE NOCASE,
    -- transfer = neutral money movement (e.g. to / from a savings deposit): not income, not expense
    kind        TEXT NOT NULL DEFAULT 'expense' CHECK (kind IN ('income', 'expense', 'transfer')),
    position    INTEGER NOT NULL DEFAULT 0,
    UNIQUE (building_id, name)
  );

  -- Auto-categorization: description contains pattern (and matches direction) → category.
  CREATE TABLE IF NOT EXISTS bank_rules (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    building_id INTEGER NOT NULL REFERENCES buildings(id) ON DELETE CASCADE,
    pattern     TEXT NOT NULL,
    direction   TEXT NOT NULL DEFAULT 'any' CHECK (direction IN ('any', 'income', 'expense')),
    category_id INTEGER NOT NULL REFERENCES bank_categories(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS bank_imports (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    building_id    INTEGER NOT NULL REFERENCES buildings(id) ON DELETE CASCADE,
    account        TEXT NOT NULL,
    file_name      TEXT,
    rows_total     INTEGER NOT NULL DEFAULT 0,
    rows_imported  INTEGER NOT NULL DEFAULT 0,
    rows_duplicate INTEGER NOT NULL DEFAULT 0,
    imported_by    INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at     TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS bank_transactions (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    building_id INTEGER NOT NULL REFERENCES buildings(id) ON DELETE CASCADE,
    import_id   INTEGER REFERENCES bank_imports(id) ON DELETE CASCADE,
    account     TEXT NOT NULL,
    date        TEXT NOT NULL,
    value_date  TEXT,
    description TEXT NOT NULL,
    reference   TEXT,
    amount      REAL NOT NULL,
    balance     REAL,
    category_id INTEGER REFERENCES bank_categories(id) ON DELETE SET NULL,
    contract_id INTEGER REFERENCES service_contracts(id) ON DELETE SET NULL,
    note        TEXT,
    hash        TEXT,
    created_by  INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at  TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_bank_tx_building_date ON bank_transactions(building_id, date);
  CREATE UNIQUE INDEX IF NOT EXISTS idx_bank_tx_hash ON bank_transactions(building_id, hash) WHERE hash IS NOT NULL;
`);

/* ---------- Migrations ---------- */

// bank_categories created before the 'transfer' kind existed: rebuild it with the wider CHECK.
// (SQLite can't alter a CHECK constraint in place; ids are kept, so references stay valid.)
const bankCatSql = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'bank_categories'").get()?.sql || '';
if (bankCatSql && !bankCatSql.includes("'transfer'")) {
  db.exec('PRAGMA foreign_keys = OFF');
  db.exec('BEGIN');
  try {
    db.exec(`
      CREATE TABLE bank_categories_new (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        building_id INTEGER NOT NULL REFERENCES buildings(id) ON DELETE CASCADE,
        name        TEXT NOT NULL COLLATE NOCASE,
        kind        TEXT NOT NULL DEFAULT 'expense' CHECK (kind IN ('income', 'expense', 'transfer')),
        position    INTEGER NOT NULL DEFAULT 0,
        UNIQUE (building_id, name)
      );
      INSERT INTO bank_categories_new (id, building_id, name, kind, position) SELECT id, building_id, name, kind, position FROM bank_categories;
      DROP TABLE bank_categories;
      ALTER TABLE bank_categories_new RENAME TO bank_categories;
    `);
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  } finally {
    db.exec('PRAGMA foreign_keys = ON');
  }
}

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
