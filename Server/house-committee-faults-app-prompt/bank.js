'use strict';

/*
 * Bank page: transactions imported from bank-statement CSV files.
 *
 * The browser parses the CSV (encoding, delimiter, header row, column mapping
 * are chosen there with a preview) and sends normalized rows:
 *   { date: 'YYYY-MM-DD', valueDate?, description, reference?, amount (signed), balance? }
 * The server validates them, skips rows it already has (hash), and applies the
 * building's auto-categorization rules and contract links.
 */

const crypto = require('node:crypto');
const express = require('express');
const db = require('./db');

const nowIso = () => new Date().toISOString();
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_ROWS = 20000;

const DEFAULT_CATEGORIES = [
  ['דמי ועד בית', 'income'], ['הכנסה אחרת', 'income'], ['ריבית', 'income'],
  ['מעליות', 'expense'], ['ניקיון', 'expense'], ['גינון', 'expense'], ['חשמל', 'expense'], ['מים', 'expense'],
  ['ביטוח', 'expense'], ['תיקונים ותחזוקה', 'expense'], ['בטיחות', 'expense'], ['עמלות בנק', 'expense'], ['הוצאה אחרת', 'expense'],
];
const DEFAULT_RULES = [
  ['ועד', 'income', 'דמי ועד בית'], ['ריבית', 'income', 'ריבית'], ['עמל', 'expense', 'עמלות בנק'],
  ['דמי ניהול', 'expense', 'עמלות בנק'], ['חשמל', 'expense', 'חשמל'], ['מים', 'expense', 'מים'], ['תאגיד', 'expense', 'מים'],
  ['ביטוח', 'expense', 'ביטוח'], ['מעלי', 'expense', 'מעליות'], // "מעלי" matches both מעלית and מעליות ['ניקיון', 'expense', 'ניקיון'], ['גינון', 'expense', 'גינון'],
  ['גנני', 'expense', 'גינון'], ['כיבוי אש', 'expense', 'בטיחות'],
];

function isValidDate(s) {
  if (typeof s !== 'string' || !DATE_RE.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}
const parseId = (v) => { const n = Number(v); return Number.isInteger(n) && n > 0 ? n : null; };
const cleanText = (v, max) => (typeof v === 'string' || typeof v === 'number' ? String(v).trim().replace(/\s+/g, ' ').slice(0, max) : '');
const finiteOrNull = (v) => (v === null || v === undefined || v === '' ? null : (Number.isFinite(Number(v)) ? Math.round(Number(v) * 100) / 100 : NaN));

/*
 * Savings-deposit transfers are neither income nor expense:
 *   "הפקדה לפיקדון" (money moved into a deposit) is not counted as an expense,
 *   "פירעון פיקדון" (deposit repaid to the account) is not counted as income.
 * Such lines get the "פיקדון" category (kind 'transfer') and a remark. Banks spell it
 * both with and without yod (פיקדון / פקדון, פירעון / פרעון), so both are matched.
 */
const DEPOSIT_RE = /הפקדה\s*ל\s*פי?קדון|פי?רעון\s+פי?קדון/;
const DEPOSIT_CATEGORY = 'פיקדון';
const DEPOSIT_NOTE = 'לא נחשב כהכנסה או הוצאה';
const isDeposit = (description) => DEPOSIT_RE.test(String(description || ''));
const withDepositNote = (note) => (note && note.includes(DEPOSIT_NOTE) ? note : [note, DEPOSIT_NOTE].filter(Boolean).join(' · '));

/**
 * Make sure the building has the "פיקדון" transfer category. The first time it is created,
 * deposit lines that are already stored are classified too. Returns its id.
 */
function ensureDepositCategory(ws) {
  const row = db.prepare('SELECT id, kind FROM bank_categories WHERE building_id = ? AND name = ?').get(ws, DEPOSIT_CATEGORY);
  if (row) {
    if (row.kind !== 'transfer') db.prepare("UPDATE bank_categories SET kind = 'transfer' WHERE id = ?").run(row.id);
    return row.id;
  }
  const pos = db.prepare('SELECT COALESCE(MAX(position), -1) + 1 AS p FROM bank_categories WHERE building_id = ?').get(ws).p;
  const id = Number(db.prepare("INSERT INTO bank_categories (building_id, name, kind, position) VALUES (?, ?, 'transfer', ?)").run(ws, DEPOSIT_CATEGORY, pos).lastInsertRowid);
  const setDep = db.prepare('UPDATE bank_transactions SET category_id = ?, note = ? WHERE id = ?');
  for (const t of db.prepare('SELECT id, description, note FROM bank_transactions WHERE building_id = ?').all(ws)) {
    if (isDeposit(t.description)) setDep.run(id, withDepositNote(t.note), t.id);
  }
  return id;
}

/** A new building (or one that never opened the bank page) gets the default categories and rules. */
function ensureBankDefaults(ws) {
  if (db.prepare('SELECT 1 FROM bank_categories WHERE building_id = ? LIMIT 1').get(ws)) { ensureDepositCategory(ws); return; }
  const insCat = db.prepare('INSERT OR IGNORE INTO bank_categories (building_id, name, kind, position) VALUES (?, ?, ?, ?)');
  DEFAULT_CATEGORIES.forEach(([name, kind], i) => insCat.run(ws, name, kind, i));
  const catId = (name) => db.prepare('SELECT id FROM bank_categories WHERE building_id = ? AND name = ?').get(ws, name)?.id;
  const insRule = db.prepare('INSERT INTO bank_rules (building_id, pattern, direction, category_id) VALUES (?, ?, ?, ?)');
  for (const [pattern, direction, cat] of DEFAULT_RULES) { const id = catId(cat); if (id) insRule.run(ws, pattern, direction, id); }
  ensureDepositCategory(ws);
}

/** Company name without legal suffixes, for matching it inside bank descriptions. */
const companyKey = (s) => String(s || '').replace(/בע["״'׳]?מ/g, '').replace(/[.,"״'׳–-]+/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase();

function matchers(ws) {
  const rules = db.prepare('SELECT pattern, direction, category_id FROM bank_rules WHERE building_id = ? ORDER BY id').all(ws)
    .map((r) => ({ ...r, pattern: r.pattern.toLowerCase() }));
  const contracts = db.prepare('SELECT id, company, category_id FROM service_contracts WHERE building_id = ?').all(ws)
    .map((c) => ({ id: c.id, key: companyKey(c.company) })).filter((c) => c.key.length >= 3);
  const depositId = ensureDepositCategory(ws);
  return {
    depositId,
    category(description, amount) {
      if (isDeposit(description)) return depositId; // fixed rule, before the building's own rules
      const d = description.toLowerCase();
      const dir = amount >= 0 ? 'income' : 'expense';
      const r = rules.find((x) => (x.direction === 'any' || x.direction === dir) && d.includes(x.pattern));
      return r ? r.category_id : null;
    },
    contract(description, amount) {
      if (amount >= 0 || isDeposit(description)) return null;
      const d = companyKey(description);
      const c = contracts.find((x) => d.includes(x.key));
      return c ? c.id : null;
    },
  };
}

/** Validate one incoming row; returns a normalized row or null. */
function normalizeRow(r) {
  if (!r || typeof r !== 'object') return null;
  if (!isValidDate(r.date)) return null;
  const amount = finiteOrNull(r.amount);
  if (amount === null || Number.isNaN(amount) || amount === 0) return null;
  const balance = finiteOrNull(r.balance);
  return {
    date: r.date, valueDate: isValidDate(r.valueDate) ? r.valueDate : null,
    description: cleanText(r.description, 300) || '—', reference: cleanText(r.reference, 60) || null,
    amount, balance: Number.isNaN(balance) ? null : balance, note: cleanText(r.note, 500) || null,
  };
}

/**
 * Insert statement rows, skipping ones already stored. Identical rows inside one file are kept
 * apart by their occurrence number, so re-importing the same file adds nothing.
 */
function insertTransactions(ws, { account, rows, importId = null, userId = null }) {
  const m = matchers(ws);
  const existing = new Set(db.prepare('SELECT hash FROM bank_transactions WHERE building_id = ? AND hash IS NOT NULL').all(ws).map((r) => r.hash));
  const ins = db.prepare(`INSERT INTO bank_transactions (building_id, import_id, account, date, value_date, description, reference, amount, balance,
    category_id, contract_id, note, hash, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  const seen = new Map();
  let imported = 0, duplicates = 0, invalid = 0;
  for (const raw of rows) {
    const r = normalizeRow(raw);
    if (!r) { invalid++; continue; }
    const base = crypto.createHash('sha1')
      .update([account, r.date, r.amount.toFixed(2), r.description, r.reference || '', r.balance ?? ''].join('|')).digest('hex');
    const n = (seen.get(base) || 0) + 1;
    seen.set(base, n);
    const hash = `${base}#${n}`;
    if (existing.has(hash)) { duplicates++; continue; }
    existing.add(hash);
    ins.run(ws, importId, account, r.date, r.valueDate, r.description, r.reference, r.amount, r.balance,
      m.category(r.description, r.amount), m.contract(r.description, r.amount),
      isDeposit(r.description) ? withDepositNote(r.note) : r.note, hash, userId, nowIso());
    imported++;
  }
  return { imported, duplicates, invalid };
}

function loadBank(ws) {
  ensureBankDefaults(ws);
  const transactions = db.prepare(`
    SELECT id, import_id AS importId, account, date, value_date AS valueDate, description, COALESCE(reference, '') AS reference,
           amount, balance, category_id AS categoryId, contract_id AS contractId, COALESCE(note, '') AS note, hash IS NULL AS manual
    FROM bank_transactions WHERE building_id = ? ORDER BY date DESC, id DESC
  `).all(ws).map((t) => ({ ...t, manual: t.manual === 1 }));
  const imports = db.prepare(`
    SELECT i.id, i.account, COALESCE(i.file_name, '') AS fileName, i.rows_total AS rowsTotal, i.rows_imported AS rowsImported,
           i.rows_duplicate AS rowsDuplicate, i.imported_by AS importedById, COALESCE(u.name, '') AS importedByName, i.created_at AS createdAt,
           (SELECT COUNT(*) FROM bank_transactions t WHERE t.import_id = i.id) AS remaining
    FROM bank_imports i LEFT JOIN users u ON u.id = i.imported_by
    WHERE i.building_id = ? ORDER BY i.created_at DESC, i.id DESC
  `).all(ws);
  const categories = db.prepare('SELECT id, name, kind FROM bank_categories WHERE building_id = ? ORDER BY kind DESC, position, id').all(ws);
  const rules = db.prepare('SELECT id, pattern, direction, category_id AS categoryId FROM bank_rules WHERE building_id = ? ORDER BY id').all(ws);
  return { transactions, imports, categories, rules };
}

/* ---------- Backup / restore / wipe / demo helpers (used by server.js and seed.js) ---------- */

function exportBank(ws) {
  const b = loadBank(ws);
  const catName = new Map(b.categories.map((c) => [c.id, c.name]));
  const contractTitle = new Map(db.prepare('SELECT id, title FROM service_contracts WHERE building_id = ?').all(ws).map((c) => [c.id, c.title]));
  const hashes = new Map(db.prepare('SELECT id, hash FROM bank_transactions WHERE building_id = ?').all(ws).map((t) => [t.id, t.hash]));
  return {
    categories: b.categories.map(({ name, kind }) => ({ name, kind })),
    rules: b.rules.map((r) => ({ pattern: r.pattern, direction: r.direction, category: catName.get(r.categoryId) })),
    imports: b.imports.map((i) => ({ key: i.id, account: i.account, fileName: i.fileName, rowsTotal: i.rowsTotal, rowsImported: i.rowsImported, rowsDuplicate: i.rowsDuplicate, createdAt: i.createdAt })),
    transactions: b.transactions.map((t) => ({
      importKey: t.importId, account: t.account, date: t.date, valueDate: t.valueDate, description: t.description, reference: t.reference,
      amount: t.amount, balance: t.balance, category: catName.get(t.categoryId) || null, contract: contractTitle.get(t.contractId) || null,
      note: t.note, hash: hashes.get(t.id) || null,
    })),
  };
}

function restoreBank(ws, bank) {
  if (!bank || typeof bank !== 'object') return;
  db.prepare('DELETE FROM bank_transactions WHERE building_id = ?').run(ws);
  db.prepare('DELETE FROM bank_imports WHERE building_id = ?').run(ws);
  db.prepare('DELETE FROM bank_rules WHERE building_id = ?').run(ws);
  db.prepare('DELETE FROM bank_categories WHERE building_id = ?').run(ws);
  const catIds = new Map();
  (Array.isArray(bank.categories) ? bank.categories : []).forEach((c, i) => {
    const name = cleanText(c?.name, 50);
    if (!name || catIds.has(name)) return;
    const id = Number(db.prepare('INSERT INTO bank_categories (building_id, name, kind, position) VALUES (?, ?, ?, ?)')
      .run(ws, name, ['income', 'transfer'].includes(c.kind) ? c.kind : 'expense', i).lastInsertRowid);
    catIds.set(name, id);
  });
  for (const r of Array.isArray(bank.rules) ? bank.rules : []) {
    const pattern = cleanText(r?.pattern, 60);
    const cat = catIds.get(r?.category);
    if (pattern && cat) db.prepare('INSERT INTO bank_rules (building_id, pattern, direction, category_id) VALUES (?, ?, ?, ?)')
      .run(ws, pattern, ['income', 'expense'].includes(r.direction) ? r.direction : 'any', cat);
  }
  const importIds = new Map();
  for (const i of Array.isArray(bank.imports) ? bank.imports : []) {
    const id = Number(db.prepare(`INSERT INTO bank_imports (building_id, account, file_name, rows_total, rows_imported, rows_duplicate, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)`).run(ws, cleanText(i?.account, 80) || 'חשבון', cleanText(i?.fileName, 150) || null,
      Number(i?.rowsTotal) || 0, Number(i?.rowsImported) || 0, Number(i?.rowsDuplicate) || 0,
      typeof i?.createdAt === 'string' ? i.createdAt : nowIso()).lastInsertRowid);
    importIds.set(i.key, id);
  }
  const contractId = (title) => (title ? db.prepare('SELECT id FROM service_contracts WHERE building_id = ? AND title = ?').get(ws, title)?.id ?? null : null);
  const ins = db.prepare(`INSERT OR IGNORE INTO bank_transactions (building_id, import_id, account, date, value_date, description, reference, amount, balance,
    category_id, contract_id, note, hash, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  for (const t of Array.isArray(bank.transactions) ? bank.transactions : []) {
    const r = normalizeRow(t);
    if (!r) continue;
    ins.run(ws, importIds.get(t.importKey) ?? null, cleanText(t.account, 80) || 'חשבון', r.date, r.valueDate, r.description, r.reference,
      r.amount, r.balance, catIds.get(t.category) ?? null, contractId(t.contract), r.note,
      typeof t.hash === 'string' ? t.hash.slice(0, 80) : null, nowIso());
  }
}

function wipeBank(ws) {
  db.prepare('DELETE FROM bank_transactions WHERE building_id = ?').run(ws);
  db.prepare('DELETE FROM bank_imports WHERE building_id = ?').run(ws);
}

/** Four months of realistic demo transactions, imported as one "file". Call inside a transaction. */
function seedDemoBank(ws, userId) {
  wipeBank(ws);
  ensureBankDefaults(ws);
  const today = new Date();
  const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const rows = [];
  const add = (monthsBack, day, description, amount, reference = '') => {
    const d = new Date(today.getFullYear(), today.getMonth() - monthsBack, day);
    if (d <= today) rows.push({ date: ymd(d), description, amount, reference: reference || String(10000 + rows.length * 37) });
  };
  const residents = ['כהן', 'לוי', 'מזרחי', 'פרץ', 'ביטון', 'אברהם', 'פרידמן', 'דהן', 'שמש', 'רוזן', 'ברגר', 'גבאי'];
  for (let mb = 4; mb >= 0; mb--) {
    residents.forEach((name, i) => { if (!(mb === 0 && i === 7)) add(mb, 1 + (i % 5), `העברה מ${name} – דמי ועד דירה ${i + 1}`, 250); });
    add(mb, 10, 'מעליות השרון בע"מ – הוראת קבע', -650);
    add(mb, 12, 'ניקיון הכרמל – תשלום חודשי', -1800);
    add(mb, 20, 'עמלת ניהול חשבון', -15.9);
    add(mb, 28, 'ריבית זכות', 3.2);
    if (mb % 2 === 0) add(mb, 15, 'חברת החשמל לישראל – חשבון תקופתי', -(820 + mb * 35));
    if (mb % 2 === 1) add(mb, 17, 'תאגיד המים – צריכה משותפת', -(300 + mb * 12));
    if (mb === 3 || mb === 0) add(mb, 6, 'גנני העמק – תחזוקת גינה רבעונית', -4200);
  }
  add(1, 22, 'ביטוח ישיר לבניינים – פוליסה שנתית', -9600);
  add(2, 9, 'מסגרות אבי – תיקון דלת חירום', -1450);
  add(1, 3, 'הפקדת מזומן – תשלום פיגורים', 500);
  add(3, 8, 'הפקדה לפיקדון – פיקדון שקלי 3 חודשים', -10000);
  add(0, 8, 'פירעון פיקדון – פיקדון שקלי 3 חודשים', 10085.4);
  rows.sort((a, b) => a.date.localeCompare(b.date));
  let balance = 24500;
  for (const r of rows) { balance = Math.round((balance + r.amount) * 100) / 100; r.balance = balance; }
  const importId = Number(db.prepare(`INSERT INTO bank_imports (building_id, account, file_name, rows_total, imported_by, created_at)
    VALUES (?, ?, ?, ?, ?, ?)`).run(ws, 'חשבון ועד הבית', 'נתוני-הדגמה.csv', rows.length, userId, nowIso()).lastInsertRowid);
  const res = insertTransactions(ws, { account: 'חשבון ועד הבית', rows, importId, userId });
  db.prepare('UPDATE bank_imports SET rows_imported = ?, rows_duplicate = ? WHERE id = ?').run(res.imported, res.duplicates, importId);
}

/* ---------- Routes ---------- */

function registerBankRoutes(app, { requireBuilding }) {
  const tx = (fn) => db.transaction(fn);
  const txRow = (ws, id) => db.prepare('SELECT * FROM bank_transactions WHERE id = ? AND building_id = ?').get(id, ws);
  const catOk = (ws, id) => id === null || !!db.prepare('SELECT 1 FROM bank_categories WHERE id = ? AND building_id = ?').get(id, ws);
  const contractOk = (ws, id) => id === null || !!db.prepare('SELECT 1 FROM service_contracts WHERE id = ? AND building_id = ?').get(id, ws);
  const optId = (v) => (v === null || v === undefined || v === '' ? null : parseId(v) || -1);

  app.use('/api/bank', requireBuilding);

  app.get('/api/bank', (req, res) => res.json(loadBank(req.building.id)));

  app.post('/api/bank/import', express.json({ limit: '15mb' }), (req, res) => {
    const ws = req.building.id;
    const account = cleanText(req.body?.account, 80);
    const rows = req.body?.rows;
    if (!account) return res.status(400).json({ error: 'יש להזין שם לחשבון הבנק' });
    if (!Array.isArray(rows) || !rows.length) return res.status(400).json({ error: 'לא נמצאו שורות לייבוא' });
    if (rows.length > MAX_ROWS) return res.status(400).json({ error: `הקובץ גדול מדי (עד ${MAX_ROWS} שורות בייבוא אחד)` });
    const result = tx(() => {
      const importId = Number(db.prepare('INSERT INTO bank_imports (building_id, account, file_name, rows_total, imported_by, created_at) VALUES (?, ?, ?, ?, ?, ?)')
        .run(ws, account, cleanText(req.body?.fileName, 150) || null, rows.length, req.user.id, nowIso()).lastInsertRowid);
      const r = insertTransactions(ws, { account, rows, importId, userId: req.user.id });
      if (!r.imported) db.prepare('DELETE FROM bank_imports WHERE id = ?').run(importId);
      else db.prepare('UPDATE bank_imports SET rows_imported = ?, rows_duplicate = ? WHERE id = ?').run(r.imported, r.duplicates, importId);
      return r;
    });
    res.status(201).json(result);
  });

  // Manual transaction (e.g. cash). Not deduplicated.
  app.post('/api/bank/transactions', (req, res) => {
    const ws = req.building.id;
    const r = normalizeRow(req.body);
    const account = cleanText(req.body?.account, 80);
    if (!account) return res.status(400).json({ error: 'יש להזין שם חשבון' });
    if (!r) return res.status(400).json({ error: 'יש להזין תאריך תקין וסכום שונה מאפס' });
    let categoryId = optId(req.body?.categoryId);
    const contractId = optId(req.body?.contractId);
    if (!catOk(ws, categoryId)) return res.status(400).json({ error: 'הקטגוריה לא נמצאה' });
    if (!contractOk(ws, contractId)) return res.status(400).json({ error: 'החוזה לא נמצא' });
    const deposit = isDeposit(r.description);
    if (categoryId === null || deposit) categoryId = matchers(ws).category(r.description, r.amount);
    const id = Number(db.prepare(`INSERT INTO bank_transactions (building_id, account, date, value_date, description, reference, amount, balance,
      category_id, contract_id, note, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(ws, account, r.date, r.valueDate, r.description, r.reference, r.amount, r.balance, categoryId, contractId,
        deposit ? withDepositNote(r.note) : r.note, req.user.id, nowIso()).lastInsertRowid);
    res.status(201).json({ id });
  });

  // Edit classification fields: { categoryId?, contractId?, note? }
  app.patch('/api/bank/transactions/:id', (req, res) => {
    const ws = req.building.id;
    const row = txRow(ws, parseId(req.params.id));
    if (!row) return res.status(404).json({ error: 'התנועה לא נמצאה' });
    const body = req.body || {};
    const sets = [];
    const params = [];
    if (Object.hasOwn(body, 'categoryId')) {
      const v = optId(body.categoryId);
      if (!catOk(ws, v)) return res.status(400).json({ error: 'הקטגוריה לא נמצאה' });
      sets.push('category_id = ?'); params.push(v);
    }
    if (Object.hasOwn(body, 'contractId')) {
      const v = optId(body.contractId);
      if (!contractOk(ws, v)) return res.status(400).json({ error: 'החוזה לא נמצא' });
      sets.push('contract_id = ?'); params.push(v);
    }
    if (Object.hasOwn(body, 'note')) { sets.push('note = ?'); params.push(cleanText(body.note, 500) || null); }
    if (!sets.length) return res.status(400).json({ error: 'לא נשלחו שינויים' });
    db.prepare(`UPDATE bank_transactions SET ${sets.join(', ')} WHERE id = ?`).run(...params, row.id);
    res.json({ ok: true });
  });

  app.delete('/api/bank/transactions/:id', (req, res) => {
    const { changes } = db.prepare('DELETE FROM bank_transactions WHERE id = ? AND building_id = ?').run(parseId(req.params.id), req.building.id);
    if (!changes) return res.status(404).json({ error: 'התנועה לא נמצאה' });
    res.status(204).end();
  });

  // Bulk: { ids: [...], action: 'category' | 'delete', categoryId? }
  app.post('/api/bank/transactions/bulk', (req, res) => {
    const ws = req.building.id;
    const ids = Array.isArray(req.body?.ids) ? req.body.ids.map(parseId).filter(Boolean).slice(0, MAX_ROWS) : [];
    if (!ids.length) return res.status(400).json({ error: 'לא נבחרו תנועות' });
    const action = req.body?.action;
    let changed = 0;
    if (action === 'category') {
      const cat = optId(req.body?.categoryId);
      if (!catOk(ws, cat)) return res.status(400).json({ error: 'הקטגוריה לא נמצאה' });
      const st = db.prepare('UPDATE bank_transactions SET category_id = ? WHERE id = ? AND building_id = ?');
      tx(() => ids.forEach((id) => { changed += st.run(cat, id, ws).changes; }));
    } else if (action === 'delete') {
      const st = db.prepare('DELETE FROM bank_transactions WHERE id = ? AND building_id = ?');
      tx(() => ids.forEach((id) => { changed += st.run(id, ws).changes; }));
    } else return res.status(400).json({ error: 'פעולה לא מוכרת' });
    res.json({ changed });
  });

  // Undo an import: deletes the transactions it added. Allowed for whoever imported it, or the owner.
  app.delete('/api/bank/imports/:id', (req, res) => {
    const ws = req.building.id;
    const imp = db.prepare('SELECT id, imported_by FROM bank_imports WHERE id = ? AND building_id = ?').get(parseId(req.params.id), ws);
    if (!imp) return res.status(404).json({ error: 'הייבוא לא נמצא' });
    if (imp.imported_by !== req.user.id && req.building.role !== 'owner') {
      return res.status(403).json({ error: 'רק מי שביצע את הייבוא או מנהל/ת הבניין יכולים לבטל אותו' });
    }
    db.prepare('DELETE FROM bank_imports WHERE id = ?').run(imp.id);
    res.status(204).end();
  });

  /* Categories */
  const readCategory = (body) => {
    const name = cleanText(body?.name, 50);
    if (!name) return { error: 'יש להזין שם לקטגוריה' };
    return { name, kind: ['income', 'transfer'].includes(body?.kind) ? body.kind : 'expense' };
  };
  app.post('/api/bank/categories', (req, res) => {
    const c = readCategory(req.body);
    if (c.error) return res.status(400).json({ error: c.error });
    try {
      const pos = db.prepare('SELECT COALESCE(MAX(position), -1) + 1 AS p FROM bank_categories WHERE building_id = ?').get(req.building.id).p;
      const id = Number(db.prepare('INSERT INTO bank_categories (building_id, name, kind, position) VALUES (?, ?, ?, ?)').run(req.building.id, c.name, c.kind, pos).lastInsertRowid);
      res.status(201).json({ category: { id, ...c } });
    } catch (err) {
      if (String(err.message).includes('UNIQUE')) return res.status(409).json({ error: `הקטגוריה "${c.name}" כבר קיימת` });
      throw err;
    }
  });
  app.put('/api/bank/categories/:id', (req, res) => {
    const c = readCategory(req.body);
    if (c.error) return res.status(400).json({ error: c.error });
    try {
      const { changes } = db.prepare('UPDATE bank_categories SET name = ?, kind = ? WHERE id = ? AND building_id = ?').run(c.name, c.kind, parseId(req.params.id), req.building.id);
      if (!changes) return res.status(404).json({ error: 'הקטגוריה לא נמצאה' });
      res.json({ ok: true });
    } catch (err) {
      if (String(err.message).includes('UNIQUE')) return res.status(409).json({ error: `הקטגוריה "${c.name}" כבר קיימת` });
      throw err;
    }
  });
  // Transactions in a deleted category become uncategorized; its rules are removed.
  app.delete('/api/bank/categories/:id', (req, res) => {
    const { changes } = db.prepare('DELETE FROM bank_categories WHERE id = ? AND building_id = ?').run(parseId(req.params.id), req.building.id);
    if (!changes) return res.status(404).json({ error: 'הקטגוריה לא נמצאה' });
    res.status(204).end();
  });

  /* Auto-categorization rules */
  app.post('/api/bank/rules', (req, res) => {
    const ws = req.building.id;
    const pattern = cleanText(req.body?.pattern, 60);
    const categoryId = parseId(req.body?.categoryId);
    if (!pattern) return res.status(400).json({ error: 'יש להזין מילה או ביטוי לחיפוש' });
    if (!categoryId || !catOk(ws, categoryId)) return res.status(400).json({ error: 'יש לבחור קטגוריה' });
    const direction = ['income', 'expense'].includes(req.body?.direction) ? req.body.direction : 'any';
    const id = Number(db.prepare('INSERT INTO bank_rules (building_id, pattern, direction, category_id) VALUES (?, ?, ?, ?)').run(ws, pattern, direction, categoryId).lastInsertRowid);
    res.status(201).json({ rule: { id, pattern, direction, categoryId } });
  });
  app.delete('/api/bank/rules/:id', (req, res) => {
    const { changes } = db.prepare('DELETE FROM bank_rules WHERE id = ? AND building_id = ?').run(parseId(req.params.id), req.building.id);
    if (!changes) return res.status(404).json({ error: 'הכלל לא נמצא' });
    res.status(204).end();
  });
  // Apply the rules (and contract matching) to uncategorized / unlinked transactions.
  app.post('/api/bank/rules/apply', (req, res) => {
    const ws = req.building.id;
    const m = matchers(ws);
    const rows = db.prepare('SELECT id, description, amount, category_id, contract_id, note FROM bank_transactions WHERE building_id = ?').all(ws);
    let categorized = 0, linked = 0;
    const setCat = db.prepare('UPDATE bank_transactions SET category_id = ? WHERE id = ?');
    const setCon = db.prepare('UPDATE bank_transactions SET contract_id = ? WHERE id = ?');
    const setDep = db.prepare('UPDATE bank_transactions SET category_id = ?, note = ? WHERE id = ?');
    tx(() => {
      for (const r of rows) {
        // Deposit lines always get the deposit category and remark
        if (isDeposit(r.description)) {
          if (r.category_id !== m.depositId || !String(r.note || '').includes(DEPOSIT_NOTE)) { setDep.run(m.depositId, withDepositNote(r.note), r.id); categorized++; }
          continue;
        }
        if (r.category_id === null) { const c = m.category(r.description, r.amount); if (c) { setCat.run(c, r.id); categorized++; } }
        if (r.contract_id === null) { const c = m.contract(r.description, r.amount); if (c) { setCon.run(c, r.id); linked++; } }
      }
    });
    res.json({ categorized, linked });
  });
}

module.exports = { registerBankRoutes, exportBank, restoreBank, wipeBank, seedDemoBank, ensureBankDefaults };
