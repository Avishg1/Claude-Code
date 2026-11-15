import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import http from 'node:http';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { createApp } from '../src/server/http';

const FIX = path.resolve(__dirname, '..', 'fixtures', 'projects');
let tmp: string;
let root: string;
let server: http.Server;
let port: number;
let fileSymlinkCreated = false;
let deniedDir: string | null = null;
const logLines: string[] = [];

function hashTree(dir: string): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (d: string) => {
    let entries;
    try {
      entries = readdirSync(d, { withFileTypes: true });
    } catch {
      out[path.relative(dir, d) + '/'] = 'unreadable';
      return;
    }
    for (const e of entries) {
      const full = path.join(d, e.name);
      if (e.isSymbolicLink()) continue;
      if (e.isDirectory()) walk(full);
      else if (e.isFile()) {
        const st = statSync(full);
        out[path.relative(dir, full)] = createHash('sha256').update(readFileSync(full)).digest('hex') + ':' + st.mtimeMs;
      }
    }
  };
  walk(dir);
  return out;
}

interface Resp {
  status: number;
  headers: http.IncomingHttpHeaders;
  body: Buffer;
  json: () => any;
}
function get(p: string, headers: Record<string, string> = {}, method = 'GET', usePort = port): Promise<Resp> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: '127.0.0.1', port: usePort, path: p, method, headers: { host: `127.0.0.1:${usePort}`, ...headers } },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => {
          const body = Buffer.concat(chunks);
          resolve({ status: res.statusCode ?? 0, headers: res.headers, body, json: () => JSON.parse(body.toString('utf8')) });
        });
      },
    );
    req.on('error', reject);
    req.end();
  });
}
const q = (project: string, file?: string) =>
  `?project=${encodeURIComponent(project)}${file !== undefined ? `&file=${encodeURIComponent(file)}` : ''}`;

let beforeHashes: Record<string, string>;
let fixtureHashes: Record<string, string>;

beforeAll(async () => {
  fixtureHashes = hashTree(FIX);
  tmp = mkdtempSync(path.join(os.tmpdir(), 'ccv-test-'));
  root = path.join(tmp, 'root');
  const outside = path.join(tmp, 'outside');
  mkdirSync(outside);
  writeFileSync(path.join(outside, 'secret.jsonl'), '{"secret":"OUTSIDE-ROOT-DATA"}\n');
  cpSync(FIX, root, {
    recursive: true,
    filter: (src) => !src.includes('large-demo-project'),
  });
  // Windows junctions (no admin rights needed): one as a project, one inside a project.
  symlinkSync(outside, path.join(root, 'zz-junction-project'), 'junction');
  symlinkSync(outside, path.join(root, 'C--demo-alpha-project', 'escape-dir'), 'junction');
  // A file symlink requires admin/developer mode on Windows; test it when possible.
  try {
    symlinkSync(path.join(outside, 'secret.jsonl'), path.join(root, 'C--demo-alpha-project', 'escape-file.jsonl'), 'file');
    fileSymlinkCreated = true;
  } catch {
    fileSymlinkCreated = false;
  }
  // A project directory the current user cannot list (Windows ACL deny), when supported.
  const d = path.join(root, 'F--demo-denied');
  mkdirSync(d);
  writeFileSync(path.join(d, 'x.jsonl'), '{}\n');
  try {
    execFileSync('icacls', [d, '/deny', `${os.userInfo().username}:(RD)`], { stdio: 'ignore' });
    try {
      readdirSync(d);
      execFileSync('icacls', [d, '/remove:d', os.userInfo().username], { stdio: 'ignore' });
    } catch {
      deniedDir = d;
    }
  } catch {
    deniedDir = null;
  }

  beforeHashes = hashTree(root);
  server = createApp({ root, maxFileBytes: 1024 * 1024, rootSource: 'test', log: (l) => logLines.push(l) });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  port = (server.address() as AddressInfo).port;
});

afterAll(async () => {
  await new Promise<void>((r) => server.close(() => r()));
  if (deniedDir) {
    try {
      execFileSync('icacls', [deniedDir, '/remove:d', os.userInfo().username], { stdio: 'ignore' });
    } catch {
      /* ignore */
    }
  }
  rmSync(tmp, { recursive: true, force: true });
});

describe('listing', () => {
  it('lists immediate project directories and skips junctions', async () => {
    const r = await get('/api/projects');
    expect(r.status).toBe(200);
    const body = r.json();
    const names = body.projects.map((p: { name: string }) => p.name).sort();
    expect(names).toContain('C--demo-alpha-project');
    expect(names).toContain('D--demo-empty-project');
    expect(names).not.toContain('zz-junction-project');
    expect(body.skippedLinks).toBeGreaterThanOrEqual(1);
    expect(body.root).toBe(root);
  });

  it('lists .jsonl files (incl. nested) with relative ids, never through junctions', async () => {
    const r = await get('/api/files' + q('C--demo-alpha-project'));
    expect(r.status).toBe(200);
    const ids = r.json().files.map((f: { id: string }) => f.id);
    expect(ids).toContain('11111111-demo-4000-8000-000000000001.jsonl');
    expect(ids).toContain('11111111-demo-4000-8000-000000000001/subagents/agent-demo0001.jsonl');
    expect(ids).not.toContain('notes.txt');
    expect(ids.some((i: string) => i.startsWith('escape-dir'))).toBe(false);
    expect(ids).not.toContain('escape-file.jsonl');
    expect(r.json().skippedLinks).toBeGreaterThanOrEqual(1);
  });

  it('sorts files newest-modified first', async () => {
    const files = (await get('/api/files' + q('E--demo-edge-cases'))).json().files as { mtimeMs: number }[];
    for (let i = 1; i < files.length; i++) expect(files[i - 1]!.mtimeMs).toBeGreaterThanOrEqual(files[i]!.mtimeMs);
  });

  it('reports an empty project as an empty list (not an error)', async () => {
    const r = await get('/api/files' + q('D--demo-empty-project'));
    expect(r.status).toBe(200);
    expect(r.json().files).toEqual([]);
  });
});

describe('file reading', () => {
  it('streams the exact bytes with snapshot headers', async () => {
    const rel = 'E--demo-edge-cases/malformed-and-partial.jsonl';
    const r = await get('/api/file' + q('E--demo-edge-cases', 'malformed-and-partial.jsonl'));
    expect(r.status).toBe(200);
    expect(r.body.equals(readFileSync(path.join(root, rel)))).toBe(true);
    expect(r.headers['x-snapshot-size']).toBe(String(r.body.length));
    expect(r.headers['content-type']).toBe('application/octet-stream');
    expect(r.headers['cache-control']).toBe('no-store');
  });

  it('reads nested files only via their listed relative id', async () => {
    const r = await get('/api/file' + q('C--demo-alpha-project', '11111111-demo-4000-8000-000000000001/subagents/agent-demo0001.jsonl'));
    expect(r.status).toBe(200);
  });

  it('serves an empty file as zero bytes', async () => {
    const r = await get('/api/file' + q('E--demo-edge-cases', 'empty.jsonl'));
    expect(r.status).toBe(200);
    expect(r.body.length).toBe(0);
  });

  it('refuses files over the configured size limit instead of truncating', async () => {
    const small = createApp({ root, maxFileBytes: 100, rootSource: 'test' });
    await new Promise<void>((r) => small.listen(0, '127.0.0.1', () => r()));
    const p = (small.address() as AddressInfo).port;
    const r = await get('/api/file' + q('C--demo-alpha-project', '11111111-demo-4000-8000-000000000001.jsonl'), {}, 'GET', p);
    await new Promise<void>((r2) => small.close(() => r2()));
    expect(r.status).toBe(413);
    expect(r.json().error.code).toBe('FILE_TOO_LARGE');
    expect(r.json().error.message).toMatch(/גדול מהמגבלה/);
  });
});

describe('path safety', () => {
  const badProjects = ['..', '.', '../root', '..\\root', 'C:\\Windows', '/etc', 'C--demo-alpha-project/..', 'nope', '', 'C:'];
  it.each(badProjects)('rejects project id %j', async (p) => {
    const r = await get('/api/files' + q(p));
    expect([400, 403, 404]).toContain(r.status);
    expect(r.body.toString()).not.toContain('OUTSIDE-ROOT-DATA');
  });

  const badFiles = [
    '../E--demo-edge-cases/branching.jsonl',
    '..\\E--demo-edge-cases\\branching.jsonl',
    '/C--demo-alpha-project/11111111-demo-4000-8000-000000000001.jsonl',
    'C:/Windows/win.ini',
    'C:\\x.jsonl',
    '11111111-demo-4000-8000-000000000001.jsonl:stream',
    'escape-dir/secret.jsonl',
    'escape-file.jsonl',
    'notes.txt',
    './11111111-demo-4000-8000-000000000001.jsonl',
    '11111111-demo-4000-8000-000000000001//subagents/agent-demo0001.jsonl',
    'does-not-exist.jsonl',
  ];
  it.each(badFiles)('rejects file id %j', async (f) => {
    const r = await get('/api/file' + q('C--demo-alpha-project', f));
    expect([400, 403, 404]).toContain(r.status);
    expect(r.body.toString()).not.toContain('OUTSIDE-ROOT-DATA');
  });

  it('rejects a project that is a junction pointing outside the root', async () => {
    const r = await get('/api/files' + q('zz-junction-project'));
    expect(r.status).toBe(403);
    expect(r.json().error.code).toBe('LINK_REJECTED');
    const f = await get('/api/file' + q('zz-junction-project', 'secret.jsonl'));
    expect(f.status).toBe(403);
    expect(f.body.toString()).not.toContain('OUTSIDE-ROOT-DATA');
  });

  it('rejects raw traversal in the URL path itself', async () => {
    for (const p of ['/../../Windows/win.ini', '/%2e%2e/%2e%2e/secret.jsonl', '/api/../api/projects/..%2f..%2f']) {
      const r = await get(p);
      expect(r.status).not.toBe(200);
    }
  });

  it('file symlink escape is blocked (when the OS allows creating one)', async () => {
    if (!fileSymlinkCreated) return void console.warn('[SKIPPED] file symlink test: OS refused to create a file symlink'); // requires admin/developer mode on Windows; covered by junction tests otherwise
    const r = await get('/api/file' + q('C--demo-alpha-project', 'escape-file.jsonl'));
    expect(r.status).not.toBe(200);
    console.log('[EXECUTED] file symlink escape test, status', r.status);
  });

  it('explains a permission-denied project directory in Hebrew', async () => {
    if (!deniedDir) return void console.warn('[SKIPPED] permission test: ACL deny not available'); // ACL deny not available in this environment
    const r = await get('/api/files' + q('F--demo-denied'));
    expect(r.status).toBe(403);
    expect(r.json().error.code).toBe('PROJECT_ACCESS_DENIED');
    expect(r.json().error.message).toMatch(/אין הרשאה/);
    console.log('[EXECUTED] permission-denied test');
  });
});

describe('origin / host / method guards', () => {
  it('rejects foreign Host headers (DNS rebinding)', async () => {
    const r = await get('/api/projects', { host: 'evil.example' });
    expect(r.status).toBe(421);
    const r2 = await get('/api/projects', { host: `192.168.1.10:${port}` });
    expect(r2.status).toBe(421);
  });

  it('accepts localhost and 127.0.0.1 with the right port', async () => {
    expect((await get('/api/projects', { host: `localhost:${port}` })).status).toBe(200);
  });

  it('rejects foreign Origins and cross-site fetch metadata, and never emits CORS headers', async () => {
    const r = await get('/api/projects', { origin: 'https://evil.example' });
    expect(r.status).toBe(403);
    expect(r.headers['access-control-allow-origin']).toBeUndefined();
    const r2 = await get('/api/projects', { 'sec-fetch-site': 'cross-site' });
    expect(r2.status).toBe(403);
    const ok = await get('/api/projects', { origin: `http://127.0.0.1:${port}` });
    expect(ok.status).toBe(200);
    expect(ok.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('is read-only: non-GET methods are rejected', async () => {
    for (const m of ['POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS']) {
      expect((await get('/api/projects', {}, m)).status).toBe(405);
    }
  });

  it('sets a strict CSP and isolation headers', async () => {
    const r = await get('/api/projects');
    expect(r.headers['content-security-policy']).toContain("default-src 'none'");
    expect(r.headers['content-security-policy']).toContain("connect-src 'self'");
    expect(r.headers['x-content-type-options']).toBe('nosniff');
    expect(r.headers['referrer-policy']).toBe('no-referrer');
  });
});

describe('root errors', () => {
  it('reports a missing root in Hebrew with no fake success', async () => {
    const s = createApp({ root: path.join(tmp, 'does-not-exist'), maxFileBytes: 1e6, rootSource: 'test' });
    await new Promise<void>((r) => s.listen(0, '127.0.0.1', () => r()));
    const p = (s.address() as AddressInfo).port;
    const r = await get('/api/projects', {}, 'GET', p);
    await new Promise<void>((r2) => s.close(() => r2()));
    expect(r.status).toBe(404);
    expect(r.json().error.code).toBe('ROOT_NOT_FOUND');
    expect(r.json().error.message).toMatch(/לא נמצאה/);
    expect(r.json().projects).toBeUndefined();
  });
});

describe('side effects', () => {
  it('never modifies source files and logs contain no names or content', async () => {
    expect(hashTree(root)).toEqual(beforeHashes);
    expect(hashTree(FIX)).toEqual(fixtureHashes);
    const joined = logLines.join('\n');
    expect(joined).not.toMatch(/demo-alpha|branching|jsonl|OUTSIDE-ROOT|project=/);
    expect(logLines.length).toBeGreaterThan(10);
  });
});
