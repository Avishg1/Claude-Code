# Task Manager

בשלב ראשון נתקין את התלויות: סוגרים את Claude Code (/exit או ctrl-c). נכנסים למחיצת הפרוייקט ומקישים npm install. הפעולה מורידה את כל הספריות והיישום הנדרשים לשרת.
מתחילים את השרת באמצעות npm start או node server.js (Claude Code יודיע לנו מה נחוץ כאן).
נקבל תגובה בסגנון "Server running on http://localhost:3000"



A full-stack task management app built with Node.js, Express, and SQLite. The frontend is plain HTML, CSS, and JavaScript, and the interface is in Hebrew (right-to-left).

For a user guide in Hebrew, see [README.he.md](README.he.md) (מדריך למשתמש).

## Features

- **Accounts:** sign up with an email and password, log in, and log out. Passwords are hashed with **scrypt** and a random salt per user. Sessions use a random token in an `HttpOnly` cookie, and only a SHA-256 hash of that token is stored in the database.
- **Tasks:** each task has a title, an optional description, a due date, and a priority (low, medium, or high). You can create, edit, delete, and mark tasks as complete.
- **Categories:** users create their own categories, then rename or delete them. Deleting a category doesn't delete its tasks; they move to "ללא קטגוריה" (uncategorized).
- **Search:** the search bar at the top filters tasks as you type, matching titles and descriptions. Search ignores case and Hebrew vowel marks, every word you type must match, and matches are highlighted. A line above the list shows how many tasks matched, plus a link when more matches are hidden by the current category or status filter. Press Escape to clear the search.
- **Keyboard shortcuts:** **N** opens the new task modal, **F** (or Ctrl+K / ⌘K) jumps to the search bar, and **Escape** closes whatever is on top: an open dropdown, then a modal, then the task details panel. Shortcuts use the physical key position, so they also work with a Hebrew keyboard layout, and they're ignored while you're typing in a field. A hint at the bottom of the dashboard lists them; it's hidden on touch devices.
- **Task details panel:** click a task to open a panel from the left with all its details: title, description, due date, priority, category, creation date and status. Every field can be edited in place, and changes save automatically: text fields shortly after you stop typing, everything else immediately. The panel shows "saving…" and "saved" as it goes.
- **Manual ordering:** drag tasks to reorder them, or focus a task's grip handle and press the up and down arrow keys. On touchscreens, drag by the handle. The order is saved automatically. A switch lets you choose between "by due date" and "manual order", and dragging a task while sorted by date switches to manual order.
- **Dashboard:** by default, tasks are sorted by due date, then by priority. Overdue tasks are highlighted in red. The sidebar shows each category with its count of open tasks, and you can filter the list by status (all, open, or completed). Buttons at the top switch to the table and calendar views.
- **Table view (`/table`):** every task in one editable grid. Click a cell to edit it, and changes save automatically. Sort by any column, filter by status (all, open, overdue, completed) or category, and search. Counters at the top show totals for open, overdue, and completed tasks.
- **Calendar view (`/calendar`):** a monthly calendar that shows each task on its due date, colored by priority. Overdue tasks are red and completed tasks are struck through.
  - Use the arrows to move between months, and **היום** to jump back to today.
  - **Drag a task to another day** to change its due date.
  - **Click a task** to edit it, mark it complete, or delete it.
  - The **+** in a day cell creates a task with that date already filled in.
  - Filter by category, hide completed tasks, or search.
  - Shortcuts: **N** for a new task, **T** for today, and **PageUp** / **PageDown** to change month.
  - On narrow screens, tasks shrink to colored dots. Tap a day to list its tasks below the calendar.

## Requirements

- **Node.js 22.13 or newer.** The app uses Node's built-in `node:sqlite` module, so you don't need a database server or any native build tools.

Check your version with:

```bash
node --version
```

## Running locally

```bash
cd task-manager
npm install
npm start
```

Then open <http://localhost:3000> in your browser.

To have the server restart automatically when you edit files, use `npm run dev` instead of `npm start`.

The SQLite database is created automatically at `data/tasks.db` the first time the server starts. To start over with an empty database, stop the server and delete the `data/` folder.

### Configuration (optional)

| Environment variable | Default  | Purpose |
|----------------------|----------|---------|
| `PORT`               | `3000`   | Port the server listens on |
| `DATA_DIR`           | `./data` | Folder where `tasks.db` is stored |
| `NODE_ENV`           | —        | Set to `production` to add the `Secure` flag to the session cookie (requires HTTPS) |

To use a different port on Windows (PowerShell):

```powershell
$env:PORT = 4000; npm start
```

On macOS or Linux:

```bash
PORT=4000 npm start
```

## Project structure

```
task-manager/
├── server.js            Express server: pages, auth, and the REST API
├── db.js                SQLite connection and schema
├── views/
│   ├── index.html       Login / sign-up page
│   ├── dashboard.html   Dashboard (only served to logged-in users)
│   ├── table.html       Table view
│   └── calendar.html    Calendar view
├── public/
│   ├── css/
│   │   ├── styles.css   Shared styles
│   │   ├── table.css    Table view (also used by the calendar's header and toolbar)
│   │   └── calendar.css Calendar view
│   └── js/
│       ├── auth.js      Login / sign-up logic
│       ├── dashboard.js Dashboard logic
│       ├── table.js     Table view logic
│       └── calendar.js  Calendar view logic
└── data/                Created at runtime; holds tasks.db (git-ignored)
```

## Pages

| Path         | Description |
|--------------|-------------|
| `/`          | Login / sign-up (redirects to `/dashboard` when logged in) |
| `/dashboard` | Task list with sidebar, details panel, and manual ordering |
| `/table`     | Editable table view |
| `/calendar`  | Monthly calendar view |

Every page except `/` redirects to `/` when you're not logged in.

## API reference

Every endpoint except sign-up and login requires a session cookie. Request and response bodies are JSON.

| Method | Path                  | Description |
|--------|-----------------------|-------------|
| POST   | `/api/auth/signup`    | `{ email, password }`: creates an account and logs in |
| POST   | `/api/auth/login`     | `{ email, password }`: logs in |
| POST   | `/api/auth/logout`    | Logs out |
| GET    | `/api/auth/me`        | Returns the current user |
| GET    | `/api/tasks`          | Lists all of the user's tasks, sorted by due date |
| POST   | `/api/tasks`          | `{ title, description?, dueDate: "YYYY-MM-DD", priority, categoryId? }` |
| PUT    | `/api/tasks/:id`      | Updates a task (same body as POST) |
| PATCH  | `/api/tasks/:id`      | Partial update: any of `title`, `description`, `dueDate`, `priority`, `categoryId`, `completed` |
| PUT    | `/api/tasks/order`    | `{ ids: [...] }`: saves the manual order (must list every one of the user's task IDs) |
| PUT    | `/api/settings`       | `{ sortMode: "due" \| "manual" }` |
| DELETE | `/api/tasks/:id`      | Deletes a task |
| GET    | `/api/categories`     | Lists categories with `total` and `open` task counts |
| POST   | `/api/categories`     | `{ name }` |
| PUT    | `/api/categories/:id` | `{ name }`: renames a category |
| DELETE | `/api/categories/:id` | Deletes a category; its tasks become uncategorized |
