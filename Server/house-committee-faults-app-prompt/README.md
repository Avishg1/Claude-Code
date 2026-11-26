# House Committee Faults

A web app for a residential building's house committee to log faults, track them from report to resolution, coordinate external vendors, and keep a history. The UI is in Hebrew and right-to-left. The architecture follows `Server/task-manager`: Node.js, Express, and SQLite through the built-in `node:sqlite` module, with email/password accounts and shared buildings in place of teams.

The end-user guide is [README.he.md](README.he.md), served at `/help`.

## Run

```bash
npm install
npm start          # http://localhost:3100
npm run dev        # restarts on file changes
```

Requires Node.js 22.13 or later.

| Env var | Default | Purpose |
|---|---|---|
| `PORT` | `3100` | HTTP port |
| `DATA_DIR` | `./data` | SQLite file (`faults.db`) and `uploads/` |
| `NODE_ENV` | | `production` sets the `Secure` flag on cookies (needs HTTPS) |

## First use

1. Sign up. Each account starts with no building.
2. Create a building. Its creator becomes the owner, and the building gets default categories, floors, and areas.
3. To see the app with data, use **טעינת נתוני הדגמה** (owner only). It loads 10 sample tickets with vendors and placeholder images, 5 service contracts (one in each reminder state), and four months of bank transactions, including a savings deposit and its repayment. It replaces any existing tickets, contracts, and bank transactions. **מחיקת כל הנתונים** clears all three again but keeps the lists, vendors, and bank categories and rules.
4. To add other committee members, they first sign up, and then the owner adds them by email in Settings.

## Layout

```
server.js     Express app: auth, buildings, members, lists, vendors, tickets, updates, media,
              service contracts, demo/wipe, backup
bank.js       Bank tab: categories, rules, deposits, import/dedupe, routes, backup, demo data
db.js         Schema and migrations (users, sessions, buildings, building_members, options,
              vendors, tickets, ticket_updates, status_history, media, service_contracts,
              contract_files, bank_categories, bank_rules, bank_imports, bank_transactions)
seed.js       Default lists and the demo data set (tickets, contracts, then bank via bank.js)
markdown.js   Renders README.he.md for /help
views/        index.html (login), app.html (single-page app shell), help.html
public/js/    app.js (all logged-in views, incl. the CSV/xls/xlsx readers), auth.js,
              a11y.js (accessibility menu)
public/css/   styles.css
public/samples/  bank-sample.csv (linked from the import dialog)
standalone/   The earlier offline, browser-only version (open standalone/index.html)
```

## How it works

- **Sessions:** a random token in an HttpOnly cookie. The database stores only its SHA-256 hash. Passwords are hashed with scrypt.
- **Building scoping:** every API request sends `X-Building-Id`, so two tabs on different buildings never mix. If the header is missing, the server uses the user's last active building. Media URLs (`/api/media/:id`) instead check that the user is a member of the file's building, because `<img>` and `<video>` tags can't send the header.
- **Roles:** all members read and write tickets, lists, and vendors. Only the owner manages members, renames or deletes the building, and runs restore, demo, or wipe.
- **Media:** uploaded as the raw request body (`POST /api/tickets/:id/media`, `X-File-Name` header), up to 200MB per file. Files are stored in `data/uploads/` under random names. The allowed types are jpg, png, gif, webp, mp4, mov, and webm. Files are served with a sandboxing CSP.
- **Ticket fields:** validated by one table (`TICKET_FIELDS`) shared by POST, PUT, and PATCH. Status changes write `status_history` and keep `resolved_at` up to date.
- **Service contracts:** stored in `service_contracts`, with documents in `contract_files` (pdf, jpg, png, gif, webp). `end_date` is the renewal date. The client derives each contract's state (active, due, handled, or expired) using a reminder date one calendar month earlier. "Mark as handled" stores the acknowledged end date in `reminder_ack_end`, so renewing (`POST /api/contracts/:id/renew`) re-arms the reminder. Reminders are shown in the app and can be exported as `.ics` (an alarm at 09:00 on the reminder day, and one a week before the renewal). No email is sent.
- **Bank** ([bank.js](bank.js)): the browser reads the statement file, using small in-house readers for CSV (UTF-8 or windows-1255), `.xlsx` (unzipped with `DecompressionStream`), BIFF8 `.xls` (OLE2 compound file), HTML-table `.xls`, and Excel XML 2003. It auto-detects the header row and column mapping, shows a preview, and posts normalized rows to `POST /api/bank/import`. The server hashes each row (by occurrence) to skip duplicates on re-import, applies the `bank_rules` keyword → category rules, and links payments to service contracts by vendor name. Amounts are signed: positive is credit/income. No external libraries are used. A sample statement is in `public/samples/bank-sample.csv`.
  - **Category kinds:** `income`, `expense`, or `transfer`. Rows in a `transfer` category are shown but left out of the income/expense totals and charts. An older database whose `bank_categories` CHECK constraint lacks `transfer` is migrated on startup by rebuilding the table.
  - **Deposits:** a description matching `DEPOSIT_RE` ("הפקדה לפיקדון" or "פירעון פיקדון", including the spellings without yod) always gets the `פיקדון` category (kind `transfer`, created on demand) and the note "לא נחשב כהכנסה או הוצאה". This takes priority over keyword rules and contract linking, and is applied on import, on manual entry, and by `POST /api/bank/rules/apply`. When the category is first created, existing matching rows are backfilled. The client uses the same regex, so a deposit row counts as neutral even if its category is later changed.
  - **Undo import:** `DELETE /api/bank/imports/:id` removes the transactions it added. It is allowed for the member who imported the file and for the owner.
  - Routes: `GET /api/bank`, `POST /api/bank/import` (up to 15MB of JSON), `/api/bank/transactions` (POST, PATCH, DELETE, and `/bulk`), `/api/bank/categories`, `/api/bank/rules`, and `/api/bank/rules/apply`.
- **Backup:** `GET /api/building/backup` returns JSON with the lists, vendors, tickets, service contracts, and the bank (categories, rules, imports, transactions). People are referenced by email and attachments are base64. `POST` restores it (owner only, up to 1GB) and maps emails back to current members. Backups made before the bank tab existed restore without touching bank data.
- **Copyright:** every page (login, app, help) ends with `© כל הזכויות שמורות לאבישי גרינברג`, fixed to the bottom-right corner.
