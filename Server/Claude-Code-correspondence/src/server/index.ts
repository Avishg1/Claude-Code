import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { existsSync } from 'node:fs';
import { loadConfig } from './config.js';
import { createApp } from './http.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const appDir = path.resolve(here, '..', '..');
const clientDir = path.resolve(here, '..', 'client');

const cfg = loadConfig(appDir);
if (!existsSync(path.join(clientDir, 'index.html'))) {
  console.error('הממשק לא נבנה עדיין. הריצו: npm run build');
  process.exit(1);
}

const server = createApp({
  root: cfg.root,
  maxFileBytes: cfg.maxFileBytes,
  rootSource: cfg.rootSource,
  clientDir,
  log: process.env.CCV_QUIET ? undefined : (line) => console.log(`[ccv] ${line}`),
});

// Loopback only: never bind to 0.0.0.0 or a LAN interface.
const HOST = '127.0.0.1';
server.listen(cfg.port, HOST, () => {
  console.log(`[ccv] Claude Code correspondence viewer: http://${HOST}:${cfg.port}/`);
  console.log(`[ccv] Root (${cfg.rootSource}): ${cfg.root}`);
  console.log(`[ccv] Max file size: ${Math.round(cfg.maxFileBytes / 1024 / 1024)} MB. Read-only. Press Ctrl+C to stop.`);
});
server.on('error', (err: NodeJS.ErrnoException) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`[ccv] Port ${cfg.port} is already in use. Set CCV_PORT to another port.`);
  } else {
    console.error(`[ccv] Server error: ${err.code ?? 'unknown'}`);
  }
  process.exit(1);
});
