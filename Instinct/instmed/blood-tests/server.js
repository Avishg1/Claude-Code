// Minimal local static server — no dependencies, listens on localhost only.
// Serves an explicit allowlist of app files. PDFs are never uploaded here:
// they are read in the browser only.
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const HOST = '127.0.0.1';
const PORT = Number(process.env.PORT) || 5180;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
};

const ALLOWED = new Set([
  '/index.html',
  '/styles.css',
  '/data/demo-results.json',
  '/js/main.js',
  '/js/domain.js',
  '/js/charts.js',
  '/js/store.js',
  '/js/pdf-extract.js',
  '/js/parser.js',
  '/vendor/pdfjs/pdf.min.mjs',
  '/vendor/pdfjs/pdf.worker.min.mjs',
]);

const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "worker-src 'self'",
  "connect-src 'self'",
  "style-src 'self'",
  "img-src 'self' data: blob:",
  "font-src 'none'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join('; ');

http.createServer((req, res) => {
  let urlPath;
  try {
    urlPath = decodeURIComponent(new URL(req.url, `http://${HOST}`).pathname);
  } catch {
    res.writeHead(400); return res.end();
  }
  if (urlPath === '/') urlPath = '/index.html';

  if (req.method !== 'GET' || !ALLOWED.has(urlPath)) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    return res.end('לא נמצא');
  }

  fs.readFile(path.join(ROOT, urlPath), (err, body) => {
    if (err) {
      res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('שגיאה בקריאת הקובץ');
    }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(urlPath)] || 'application/octet-stream',
      'Cache-Control': 'no-store',
      'Content-Security-Policy': CSP,
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
    });
    res.end(body);
  });
}).listen(PORT, HOST, () => {
  console.log(`Blood test dashboard (demo data): http://${HOST}:${PORT}`);
});
