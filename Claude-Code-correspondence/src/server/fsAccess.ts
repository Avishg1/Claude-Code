/**
 * Read-only, root-confined filesystem access.
 *
 * Rules enforced here:
 *  - The root is fixed server-side; requests can never replace it.
 *  - Projects are identified by an exact immediate child directory name of the root.
 *  - Files are identified by a POSIX-style relative path that must appear in a fresh,
 *    server-generated listing of that project (no arbitrary paths).
 *  - Symbolic links and Windows junctions are never followed (they are counted and skipped),
 *    and every resolved real path is re-checked to be inside the real root.
 *  - Only regular files ending in ".jsonl" are readable. Files are opened read-only.
 */
import { promises as fsp, constants, type Dirent, type ReadStream } from 'node:fs';
import path from 'node:path';

export class AccessError extends Error {
  constructor(
    public readonly code: string,
    public readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export interface ProjectEntry {
  name: string;
  mtimeMs: number;
}

export interface FileEntry {
  /** Relative path inside the project, always with forward slashes. */
  id: string;
  size: number;
  mtimeMs: number;
}

export interface FileListing {
  files: FileEntry[];
  skippedLinks: number;
  unreadableDirs: string[];
  truncatedWalk: boolean;
}

const MAX_WALK_DEPTH = 12;
const MAX_WALK_ENTRIES = 50_000;

function fsErrorCode(err: unknown): string | undefined {
  return typeof err === 'object' && err !== null && 'code' in err ? String((err as { code: unknown }).code) : undefined;
}

function isPermissionError(err: unknown): boolean {
  const c = fsErrorCode(err);
  return c === 'EACCES' || c === 'EPERM';
}

/** True when `child` is strictly inside `parent` (both must already be real, absolute paths). */
export function isStrictlyInside(parent: string, child: string): boolean {
  const rel = path.relative(parent, child);
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel) && !rel.split(path.sep).includes('..');
}

export async function realRootOf(root: string): Promise<string> {
  let real: string;
  try {
    real = await fsp.realpath(root);
  } catch (err) {
    const c = fsErrorCode(err);
    if (c === 'ENOENT' || c === 'ENOTDIR') {
      throw new AccessError('ROOT_NOT_FOUND', 404, 'תיקיית השורש שהוגדרה לא נמצאה במחשב.');
    }
    if (isPermissionError(err)) {
      throw new AccessError('ROOT_ACCESS_DENIED', 403, 'אין הרשאה לגשת לתיקיית השורש שהוגדרה.');
    }
    throw new AccessError('ROOT_UNREADABLE', 500, 'לא ניתן לקרוא את תיקיית השורש.');
  }
  const st = await fsp.stat(real).catch(() => null);
  if (!st || !st.isDirectory()) {
    throw new AccessError('ROOT_NOT_DIRECTORY', 400, 'הנתיב שהוגדר כשורש אינו תיקייה.');
  }
  return real;
}

async function readDirOrThrow(dir: string, kind: 'root' | 'project'): Promise<Dirent[]> {
  try {
    return await fsp.readdir(dir, { withFileTypes: true });
  } catch (err) {
    if (isPermissionError(err)) {
      throw kind === 'root'
        ? new AccessError('ROOT_ACCESS_DENIED', 403, 'אין הרשאה לקרוא את תוכן תיקיית השורש.')
        : new AccessError('PROJECT_ACCESS_DENIED', 403, 'אין הרשאה לקרוא את תיקיית הפרויקט.');
    }
    const c = fsErrorCode(err);
    if (c === 'ENOENT') {
      throw kind === 'root'
        ? new AccessError('ROOT_NOT_FOUND', 404, 'תיקיית השורש שהוגדרה לא נמצאה במחשב.')
        : new AccessError('PROJECT_NOT_FOUND', 404, 'תיקיית הפרויקט לא נמצאה (ייתכן שנמחקה). רעננו את הרשימה.');
    }
    throw kind === 'root'
      ? new AccessError('ROOT_UNREADABLE', 500, 'לא ניתן לקרוא את תיקיית השורש.')
      : new AccessError('PROJECT_UNREADABLE', 500, 'לא ניתן לקרוא את תיקיית הפרויקט.');
  }
}

export async function listProjects(root: string): Promise<{ projects: ProjectEntry[]; skippedLinks: number }> {
  const realRoot = await realRootOf(root);
  const entries = await readDirOrThrow(realRoot, 'root');
  const projects: ProjectEntry[] = [];
  let skippedLinks = 0;
  for (const d of entries) {
    if (d.isSymbolicLink()) {
      skippedLinks++;
      continue;
    }
    if (!d.isDirectory()) continue;
    const full = path.join(realRoot, d.name);
    const st = await fsp.lstat(full).catch(() => null);
    if (!st) continue;
    if (st.isSymbolicLink()) {
      skippedLinks++;
      continue;
    }
    if (!st.isDirectory()) continue;
    projects.push({ name: d.name, mtimeMs: st.mtimeMs });
  }
  projects.sort((a, b) => b.mtimeMs - a.mtimeMs || a.name.localeCompare(b.name));
  return { projects, skippedLinks };
}

/** Validates a single directory-name segment used as a project identifier. */
function assertSafeSegment(name: unknown): asserts name is string {
  if (
    typeof name !== 'string' ||
    name.length === 0 ||
    name.length > 255 ||
    name === '.' ||
    name === '..' ||
    /[\\/:\0*?"<>|]/.test(name) ||
    path.isAbsolute(name)
  ) {
    throw new AccessError('INVALID_PROJECT', 400, 'מזהה הפרויקט אינו תקין.');
  }
}

/** Returns the real path of a project that is an immediate, non-link child directory of the root. */
export async function resolveProject(root: string, name: unknown): Promise<{ realRoot: string; realProject: string }> {
  assertSafeSegment(name);
  const realRoot = await realRootOf(root);
  const entries = await readDirOrThrow(realRoot, 'root');
  const match = entries.find((d) => d.name === name);
  if (!match || !match.isDirectory() || match.isSymbolicLink()) {
    if (match?.isSymbolicLink()) {
      throw new AccessError('LINK_REJECTED', 403, 'הפרויקט הוא קישור (symlink/junction) ולכן אינו נפתח.');
    }
    throw new AccessError('PROJECT_NOT_FOUND', 404, 'הפרויקט לא נמצא בתיקיית השורש. רעננו את הרשימה.');
  }
  const candidate = path.join(realRoot, name);
  const lst = await fsp.lstat(candidate).catch(() => null);
  if (!lst || lst.isSymbolicLink() || !lst.isDirectory()) {
    throw new AccessError('LINK_REJECTED', 403, 'הפרויקט אינו תיקייה רגילה ולכן אינו נפתח.');
  }
  const realProject = await fsp.realpath(candidate).catch(() => null);
  if (!realProject || !isStrictlyInside(realRoot, realProject) || path.dirname(realProject) !== realRoot) {
    throw new AccessError('OUTSIDE_ROOT', 403, 'הגישה נחסמה: הנתיב מוביל אל מחוץ לתיקיית השורש.');
  }
  return { realRoot, realProject };
}

function isJsonlName(name: string): boolean {
  return name.toLowerCase().endsWith('.jsonl');
}

export async function listFiles(root: string, project: unknown): Promise<FileListing> {
  const { realProject } = await resolveProject(root, project);
  // Make sure the project itself is readable; this is the error we want to report.
  await readDirOrThrow(realProject, 'project');

  const files: FileEntry[] = [];
  const unreadableDirs: string[] = [];
  let skippedLinks = 0;
  let visited = 0;
  let truncatedWalk = false;

  async function walk(dir: string, relParts: string[], depth: number): Promise<void> {
    if (depth > MAX_WALK_DEPTH) {
      truncatedWalk = true;
      return;
    }
    let entries: Dirent[];
    try {
      entries = await fsp.readdir(dir, { withFileTypes: true });
    } catch {
      unreadableDirs.push(relParts.join('/') || '.');
      return;
    }
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const d of entries) {
      if (++visited > MAX_WALK_ENTRIES) {
        truncatedWalk = true;
        return;
      }
      if (d.isSymbolicLink()) {
        skippedLinks++;
        continue;
      }
      const full = path.join(dir, d.name);
      if (d.isDirectory()) {
        // Double-check with lstat: junctions must never be traversed.
        const lst = await fsp.lstat(full).catch(() => null);
        if (!lst || lst.isSymbolicLink()) {
          skippedLinks++;
          continue;
        }
        await walk(full, [...relParts, d.name], depth + 1);
      } else if (d.isFile() && isJsonlName(d.name)) {
        const lst = await fsp.lstat(full).catch(() => null);
        if (!lst || lst.isSymbolicLink() || !lst.isFile()) continue;
        files.push({ id: [...relParts, d.name].join('/'), size: lst.size, mtimeMs: lst.mtimeMs });
      }
    }
  }

  await walk(realProject, [], 0);
  files.sort((a, b) => b.mtimeMs - a.mtimeMs || a.id.localeCompare(b.id));
  return { files, skippedLinks, unreadableDirs, truncatedWalk };
}

function assertSafeFileId(id: unknown): asserts id is string {
  if (
    typeof id !== 'string' ||
    id.length === 0 ||
    id.length > 2048 ||
    id.includes('\0') ||
    id.includes('\\') ||
    id.includes(':') ||
    id.startsWith('/') ||
    path.isAbsolute(id) ||
    id.split('/').some((seg) => seg === '' || seg === '.' || seg === '..') ||
    !isJsonlName(id)
  ) {
    throw new AccessError('INVALID_FILE', 400, 'מזהה הקובץ אינו תקין. ניתן לפתוח רק קובצי ‎.jsonl‎ מתוך רשימת הפרויקט.');
  }
}

export interface FileSnapshot {
  size: number;
  mtimeMs: number;
  stream: ReadStream | null;
}

/**
 * Opens a validated JSONL file read-only and returns a stream limited to the size at open time,
 * so a refresh never mixes two different states of a file that is being written.
 */
export async function openFileSnapshot(
  root: string,
  project: unknown,
  fileId: unknown,
  maxBytes: number,
): Promise<FileSnapshot> {
  assertSafeFileId(fileId);
  const { realProject } = await resolveProject(root, project);
  const listing = await listFiles(root, project);
  if (!listing.files.some((f) => f.id === fileId)) {
    throw new AccessError('FILE_NOT_FOUND', 404, 'הקובץ לא נמצא ברשימת הקבצים של הפרויקט. רעננו את הרשימה.');
  }
  const candidate = path.join(realProject, ...fileId.split('/'));
  const lst = await fsp.lstat(candidate).catch(() => null);
  if (!lst || lst.isSymbolicLink() || !lst.isFile()) {
    throw new AccessError('LINK_REJECTED', 403, 'הקובץ אינו קובץ רגיל ולכן אינו נפתח.');
  }
  const real = await fsp.realpath(candidate).catch(() => null);
  if (!real || !isStrictlyInside(realProject, real)) {
    throw new AccessError('OUTSIDE_ROOT', 403, 'הגישה נחסמה: הנתיב מוביל אל מחוץ לתיקיית הפרויקט.');
  }

  let fh: fsp.FileHandle;
  try {
    fh = await fsp.open(real, constants.O_RDONLY);
  } catch (err) {
    if (isPermissionError(err)) {
      throw new AccessError('FILE_ACCESS_DENIED', 403, 'אין הרשאה לקרוא את הקובץ.');
    }
    if (fsErrorCode(err) === 'EBUSY') {
      throw new AccessError('FILE_BUSY', 423, 'הקובץ נעול כרגע על ידי תוכנה אחרת. נסו לרענן בעוד רגע.');
    }
    throw new AccessError('FILE_UNREADABLE', 500, 'לא ניתן לפתוח את הקובץ לקריאה.');
  }
  try {
    const st = await fh.stat();
    if (!st.isFile()) throw new AccessError('FILE_UNREADABLE', 400, 'הנתיב אינו קובץ רגיל.');
    if (st.size > maxBytes) {
      throw new AccessError(
        'FILE_TOO_LARGE',
        413,
        `הקובץ גדול מהמגבלה שהוגדרה (${Math.round(maxBytes / 1024 / 1024)} MB) ולכן לא נקרא כלל. ניתן להגדיל את המגבלה בהגדרות השרת.`,
      );
    }
    if (st.size === 0) {
      await fh.close();
      return { size: 0, mtimeMs: st.mtimeMs, stream: null };
    }
    const stream = fh.createReadStream({ start: 0, end: st.size - 1, autoClose: true, highWaterMark: 256 * 1024 });
    return { size: st.size, mtimeMs: st.mtimeMs, stream };
  } catch (err) {
    await fh.close().catch(() => undefined);
    throw err;
  }
}
