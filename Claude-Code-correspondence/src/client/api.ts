import { JsonlLineParser } from '../shared/jsonl';
import { normalizeLine, type DisplayRecord } from '../shared/normalize';

export interface AppConfig {
  root: string;
  rootSource: string;
  maxFileBytes: number;
}
export interface ProjectEntry {
  name: string;
  mtimeMs: number;
}
export interface ProjectListing {
  root: string;
  projects: ProjectEntry[];
  skippedLinks: number;
}
export interface FileEntry {
  id: string;
  size: number;
  mtimeMs: number;
}
export interface FileListing {
  files: FileEntry[];
  skippedLinks: number;
  unreadableDirs: string[];
  truncatedWalk: boolean;
  maxFileBytes: number;
}

export class ApiError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status: number,
  ) {
    super(message);
  }
}

const NETWORK_MESSAGE = 'לא ניתן להתחבר לשרת המקומי. ודאו שהשרת פועל (npm start) ורעננו.';

async function toApiError(res: Response): Promise<ApiError> {
  try {
    const body = (await res.json()) as { error?: { code?: string; message?: string } };
    if (body.error?.message) return new ApiError(body.error.code ?? 'ERROR', body.error.message, res.status);
  } catch {
    /* fall through */
  }
  return new ApiError('HTTP_' + res.status, `השרת החזיר שגיאה (${res.status}).`, res.status);
}

async function getJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, { signal, cache: 'no-store', credentials: 'same-origin' });
  } catch (err) {
    if (signal?.aborted) throw err;
    throw new ApiError('NETWORK', NETWORK_MESSAGE, 0);
  }
  if (!res.ok) throw await toApiError(res);
  return (await res.json()) as T;
}

export const api = {
  config: (signal?: AbortSignal) => getJson<AppConfig>('/api/config', signal),
  projects: (signal?: AbortSignal) => getJson<ProjectListing>('/api/projects', signal),
  files: (project: string, signal?: AbortSignal) =>
    getJson<FileListing>(`/api/files?project=${encodeURIComponent(project)}`, signal),
};

export interface LoadedFile {
  records: DisplayRecord[];
  snapshotSize: number;
  snapshotMtimeMs: number;
  physicalLines: number;
}

export interface LoadProgress {
  bytes: number;
  total: number;
  records: number;
}

/**
 * Streams one file snapshot and parses it line by line as bytes arrive.
 * Everything stays in memory; nothing is written to browser storage.
 */
export async function loadFile(
  project: string,
  file: string,
  signal: AbortSignal,
  onProgress: (p: LoadProgress) => void,
): Promise<LoadedFile> {
  const url = `/api/file?project=${encodeURIComponent(project)}&file=${encodeURIComponent(file)}`;
  let res: Response;
  try {
    res = await fetch(url, { signal, cache: 'no-store', credentials: 'same-origin' });
  } catch (err) {
    if (signal.aborted) throw err;
    throw new ApiError('NETWORK', NETWORK_MESSAGE, 0);
  }
  if (!res.ok) throw await toApiError(res);

  const total = Number(res.headers.get('X-Snapshot-Size') ?? '0') || 0;
  const mtime = Number(res.headers.get('X-Snapshot-Mtime') ?? '0') || 0;
  const records: DisplayRecord[] = [];
  const parser = new JsonlLineParser((entry) => records.push(normalizeLine(entry, records.length)));
  // fatal:false -> invalid UTF-8 sequences become U+FFFD instead of failing the whole file.
  const decoder = new TextDecoder('utf-8', { fatal: false, ignoreBOM: false });

  let bytes = 0;
  let lastReport = 0;
  if (res.body) {
    const reader = res.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      parser.push(decoder.decode(value, { stream: true }));
      const now = performance.now();
      if (now - lastReport > 80) {
        lastReport = now;
        onProgress({ bytes, total, records: records.length });
        // Yield so the progress bar paints and input stays responsive on large files.
        await new Promise((r) => setTimeout(r, 0));
        if (signal.aborted) throw new DOMException('aborted', 'AbortError');
      }
    }
  }
  parser.push(decoder.decode());
  parser.finish();
  if (total && bytes !== total) {
    throw new ApiError('INCOMPLETE_READ', 'הקריאה הסתיימה לפני שהתקבל כל הקובץ. נסו לרענן.', 0);
  }
  onProgress({ bytes, total, records: records.length });
  return { records, snapshotSize: total || bytes, snapshotMtimeMs: mtime, physicalLines: parser.physicalLines };
}

export function isAbort(err: unknown): boolean {
  return err instanceof DOMException && err.name === 'AbortError';
}
