# Task Manager

A full-stack task management app built with Node.js, Express, and SQLite. The frontend is plain HTML, CSS, and JavaScript, and the interface is in Hebrew (right-to-left).

## Features

- **Accounts:** sign up with an email and password, log in, and log out. Passwords are hashed with **scrypt** and a random salt per user. Sessions use a random token in an `HttpOnly` cookie, and only a SHA-256 hash of that token is stored in the database.
- **Tasks:** each task has a title, an optional description, a due date, and a priority (low, medium, or high). You can create, edit, delete, and mark tasks as complete.
- **Categories:** users create their own categories, then rename or delete them. Deleting a category doesn't delete its tasks; they move to "ללא קטגוריה" (uncategorized).
- **Dashboard:** tasks are sorted by due date, then by priority. Overdue tasks are highlighted in red. The sidebar shows each category with its count of open tasks, and you can filter the list by status (all, open, or completed).

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
│   └── dashboard.html   Dashboard (only served to logged-in users)
├── public/
│   ├── css/styles.css
│   └── js/
│       ├── auth.js      Login / sign-up logic
│       └── dashboard.js Dashboard logic
└── data/                Created at runtime; holds tasks.db (git-ignored)
```

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
| PATCH  | `/api/tasks/:id`      | `{ completed: true \| false }` |
| DELETE | `/api/tasks/:id`      | Deletes a task |
| GET    | `/api/categories`     | Lists categories with `total` and `open` task counts |
| POST   | `/api/categories`     | `{ name }` |
| PUT    | `/api/categories/:id` | `{ name }`: renames a category |
| DELETE | `/api/categories/:id` | Deletes a category; its tasks become uncategorized |
