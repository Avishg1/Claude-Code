import http from 'node:http';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { AccessError, listFiles, listProjects, openFileSnapshot } from './fsAccess.js';

export interface AppOptions {
  root: string;
  maxFileBytes: number;
  rootSource: string;
  /** Directory containing the built client (index.html + assets). May be absent in tests. */
  clientDir?: string;
  log?: (line: string) => void;
}

const SECURITY_HEADERS: Record<string, string> = {
  'Content-Security-Policy':
    "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; font-src 'self'; " +
    "connect-src 'self'; manifest-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'X-Frame-Options': 'DENY',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Resource-Policy': 'same-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
};

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.json': 'application/json; charset=utf-8',
};

/** Builds a fixed in-memory map of the built client files. Requests can only hit these keys. */
function loadStaticFiles(clientDir: string | undefined): Map<string, { body: Buffer; type: string }> {
  const map = new Map<string, { body: Buffer; type: string }>();
  if (!clientDir) return map;
  const walk = (dir: string, rel: string) => {
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    for (const name of entries) {
      const full = path.join(dir, name);
      const st = statSync(full);
      const key = `${rel}/${name}`;
      if (st.isDirectory()) walk(full, key);
      else if (st.isFile()) {
        const type = CONTENT_TYPES[path.extname(name).toLowerCase()];
        if (type) map.set(key, { body: readFileSync(full), type });
      }
    }
  };
  walk(clientDir, '');
  return map;
}

function sendJson(res: http.ServerResponse, status: number, body: unknown): void {
  const payload = Buffer.from(JSON.stringify(body), 'utf8');
  res.writeHead(status, {
    ...SECURITY_HEADERS,
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': String(payload.length),
    'Cache-Control': 'no-store',
  });
  res.end(payload);
}

function sendError(res: http.ServerResponse, status: number, code: string, message: string): void {
  sendJson(res, status, { error: { code, message } });
}

export function createApp(opts: AppOptions): http.Server {
  const staticFiles = loadStaticFiles(opts.clientDir);
  const log = opts.log ?? (() => undefined);

  const server = http.createServer(async (req, res) => {
    const started = Date.now();
    let routeLabel = 'static';
    res.on('finish', () => {
      // Redacted log line: never includes query strings, project names, file names or content.
      log(`${req.method ?? '?'} ${routeLabel} ${res.statusCode} ${Date.now() - started}ms`);
    });

    try {
      const addr = server.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      const allowedHosts = new Set([`127.0.0.1:${port}`, `localhost:${port}`]);

      // 1. Host header validation (blocks DNS-rebinding style access).
      const host = (req.headers.host ?? '').toLowerCase();
      if (!allowedHosts.has(host)) {
        routeLabel = 'rejected-host';
        return sendError(res, 421, 'BAD_HOST', 'כותרת Host אינה מורשית. יש לגשת דרך http://127.0.0.1 בלבד.');
      }
      // 2. Origin validation: only the app's own origin; no CORS headers are ever emitted.
      const origin = req.headers.origin;
      if (origin !== undefined && !(origin.startsWith('http://') && allowedHosts.has(origin.slice(7).toLowerCase()))) {
        routeLabel = 'rejected-origin';
        return sendError(res, 403, 'BAD_ORIGIN', 'הבקשה הגיעה ממקור לא מורשה.');
      }
      const fetchSite = req.headers['sec-fetch-site'];
      if (fetchSite === 'cross-site' || fetchSite === 'same-site') {
        routeLabel = 'rejected-fetch-site';
        return sendError(res, 403, 'BAD_ORIGIN', 'בקשה חוצת-אתרים נחסמה.');
      }
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        routeLabel = 'rejected-method';
        res.setHeader('Allow', 'GET, HEAD');
        return sendError(res, 405, 'METHOD_NOT_ALLOWED', 'השרת מאפשר קריאה בלבד.');
      }

      const url = new URL(req.url ?? '/', 'http://127.0.0.1');
      const pathname = url.pathname;

      if (pathname.startsWith('/api/')) {
        routeLabel = pathname;
        switch (pathname) {
          case '/api/config':
            return sendJson(res, 200, {
              root: opts.root,
              rootSource: opts.rootSource,
              maxFileBytes: opts.maxFileBytes,
            });
          case '/api/projects': {
            const result = await listProjects(opts.root);
            return sendJson(res, 200, { root: opts.root, ...result });
          }
          case '/api/files': {
            const result = await listFiles(opts.root, url.searchParams.get('project') ?? undefined);
            return sendJson(res, 200, { ...result, maxFileBytes: opts.maxFileBytes });
          }
          case '/api/file': {
            const snap = await openFileSnapshot(
              opts.root,
              url.searchParams.get('project') ?? undefined,
              url.searchParams.get('file') ?? undefined,
              opts.maxFileBytes,
            );
            res.writeHead(200, {
              ...SECURITY_HEADERS,
              // Served as inert bytes, never as a renderable document.
              'Content-Type': 'application/octet-stream',
              'Content-Disposition': 'attachment',
              'Content-Length': String(snap.size),
              'Cache-Control': 'no-store',
              'X-Snapshot-Size': String(snap.size),
              'X-Snapshot-Mtime': String(Math.floor(snap.mtimeMs)),
            });
            if (!snap.stream || req.method === 'HEAD') {
              snap.stream?.destroy();
              return res.end();
            }
            snap.stream.on('error', () => res.destroy());
            res.on('close', () => snap.stream?.destroy());
            snap.stream.pipe(res);
            return;
          }
          default:
            return sendError(res, 404, 'NOT_FOUND', 'נתיב API לא קיים.');
        }
      }

      const key = pathname === '/' ? '/index.html' : pathname;
      const file = staticFiles.get(key);
      if (!file) {
        return sendError(res, 404, 'NOT_FOUND', 'הקובץ המבוקש לא נמצא.');
      }
      res.writeHead(200, {
        ...SECURITY_HEADERS,
        'Content-Type': file.type,
        'Content-Length': String(file.body.length),
        'Cache-Control': key === '/index.html' ? 'no-store' : 'public, max-age=3600',
      });
      res.end(req.method === 'HEAD' ? undefined : file.body);
    } catch (err) {
      if (err instanceof AccessError) {
        return sendError(res, err.status, err.code, err.message);
      }
      routeLabel += ' (internal-error)';
      if (!res.headersSent) sendError(res, 500, 'INTERNAL', 'שגיאה פנימית בשרת המקומי.');
      else res.destroy();
    }
  });
  return server;
}
