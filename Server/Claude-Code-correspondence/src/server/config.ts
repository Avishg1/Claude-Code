import { readFileSync } from 'node:fs';
import path from 'node:path';

/** The exact default root requested by the user. */
export const DEFAULT_ROOT = 'C:\\Users\\Avishay\\.claude\\projects';
export const DEFAULT_PORT = 5178;
export const DEFAULT_MAX_FILE_MB = 256;

export interface ServerConfig {
  root: string;
  port: number;
  maxFileBytes: number;
  rootSource: 'default' | 'env' | 'config.local.json';
}

/**
 * Root resolution order (server-side only, never from a request):
 *   1. CCV_ROOT environment variable
 *   2. "root" in config.local.json next to package.json
 *   3. DEFAULT_ROOT
 */
export function loadConfig(appDir: string, env: NodeJS.ProcessEnv = process.env): ServerConfig {
  let fileCfg: { root?: unknown; port?: unknown; maxFileMB?: unknown } = {};
  try {
    fileCfg = JSON.parse(readFileSync(path.join(appDir, 'config.local.json'), 'utf8'));
  } catch {
    fileCfg = {};
  }

  let root = DEFAULT_ROOT;
  let rootSource: ServerConfig['rootSource'] = 'default';
  if (env.CCV_ROOT && env.CCV_ROOT.trim()) {
    root = env.CCV_ROOT.trim();
    rootSource = 'env';
  } else if (typeof fileCfg.root === 'string' && fileCfg.root.trim()) {
    root = fileCfg.root.trim();
    rootSource = 'config.local.json';
  }
  root = path.resolve(root);

  const port = toPositiveInt(env.CCV_PORT ?? fileCfg.port, DEFAULT_PORT);
  const maxMb = toPositiveInt(env.CCV_MAX_FILE_MB ?? fileCfg.maxFileMB, DEFAULT_MAX_FILE_MB);
  return { root, port, maxFileBytes: maxMb * 1024 * 1024, rootSource };
}

function toPositiveInt(v: unknown, fallback: number): number {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number.parseInt(v, 10) : NaN;
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}
