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
3. To see the app with data, use **טעינת נתוני הדגמה** (owner only) to load 10 sample tickets with vendors and placeholder images. **מחיקת כל הנתונים** clears the tickets again.
4. To add other committee members, they first sign up, and then the owner adds them by email in Settings.

## Layout

```
server.js     Express app: auth, buildings, members, lists, vendors, tickets, updates, media, backup
db.js         Schema (users, sessions, buildings, building_members, options, vendors,
              tickets, ticket_updates, status_history, media)
seed.js       Default lists and the demo data set
markdown.js   Renders README.he.md for /help
views/        index.html (login), app.html (single-page app shell), help.html
public/js/    app.js (all logged-in views), auth.js, a11y.js (accessibility menu)
public/css/   styles.css
standalone/   The earlier offline, browser-only version (open standalone/index.html)
```

## How it works

- **Sessions:** a random token in an HttpOnly cookie. The database stores only its SHA-256 hash. Passwords are hashed with scrypt.
- **Building scoping:** every API request sends `X-Building-Id`, so two tabs on different buildings never mix. If the header is missing, the server uses the user's last active building. Media URLs (`/api/media/:id`) instead check that the user is a member of the file's building, because `<img>` and `<video>` tags can't send the header.
- **Roles:** all members read and write tickets, lists, and vendors. Only the owner manages members, renames or deletes the building, and runs restore, demo, or wipe.
- **Media:** uploaded as the raw request body (`POST /api/tickets/:id/media`, `X-File-Name` header), up to 200MB per file. Files are stored in `data/uploads/` under random names. The allowed types are jpg, png, gif, webp, mp4, mov, and webm. Files are served with a sandboxing CSP.
- **Ticket fields:** validated by one table (`TICKET_FIELDS`) shared by POST, PUT, and PATCH. Status changes write `status_history` and keep `resolved_at` up to date.
- **Backup:** `GET /api/building/backup` returns JSON in which people are referenced by email and attachments are base64. `POST` restores it (owner only, up to 1GB) and maps emails back to current members.
