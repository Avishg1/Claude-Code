import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { analyzeRecords } from '../shared/normalize';
import {
  api,
  ApiError,
  isAbort,
  loadFile,
  type AppConfig,
  type FileListing,
  type LoadedFile,
  type LoadProgress,
  type ProjectListing,
} from './api';
import { formatBytes, formatDateTime, formatNumber } from './format';
import { SelectList } from './components/SelectList';
import { ConversationView } from './components/ConversationView';

type Async<T> = { status: 'idle' } | { status: 'loading' } | { status: 'ok'; data: T } | { status: 'error'; error: ApiError };

type Conv =
  | { status: 'idle' }
  | { status: 'loading'; progress: LoadProgress | null }
  | { status: 'ok'; loaded: LoadedFile; refreshing: boolean; refreshNote: string | null }
  | { status: 'error'; error: ApiError };

function toApiError(err: unknown): ApiError {
  return err instanceof ApiError ? err : new ApiError('CLIENT', 'אירעה שגיאה בלתי צפויה בממשק.', 0);
}

const HINTS: Record<string, string> = {
  ROOT_NOT_FOUND: 'בדקו שהנתיב קיים, או הגדירו נתיב אחר במשתנה הסביבה CCV_ROOT או בקובץ config.local.json והפעילו מחדש את השרת.',
  ROOT_ACCESS_DENIED: 'ודאו שלמשתמש שמריץ את השרת יש הרשאת קריאה לתיקייה.',
  PROJECT_ACCESS_DENIED: 'ודאו שלמשתמש שמריץ את השרת יש הרשאת קריאה לתיקיית הפרויקט.',
  FILE_ACCESS_DENIED: 'ייתכן שהקובץ נעול או שאין הרשאת קריאה. נסו לרענן בעוד רגע.',
  NETWORK: 'השרת המקומי אינו זמין.',
};

function ErrorBox({ error, onRetry }: { error: ApiError; onRetry?: () => void }) {
  return (
    <div className="alert alert-error" role="alert">
      <strong>{error.message}</strong>
      {HINTS[error.code] && <div className="hint">{HINTS[error.code]}</div>}
      <div className="error-code" dir="ltr">
        {error.code}
      </div>
      {onRetry && (
        <button type="button" className="btn btn-small" onClick={onRetry}>
          נסו שוב
        </button>
      )}
    </div>
  );
}

export function App() {
  const [config, setConfig] = useState<Async<AppConfig>>({ status: 'loading' });
  const [projects, setProjects] = useState<Async<ProjectListing>>({ status: 'loading' });
  const [projectFilter, setProjectFilter] = useState('');
  const [selectedProject, setSelectedProject] = useState<string | null>(null);
  const [files, setFiles] = useState<Async<FileListing>>({ status: 'idle' });
  const [fileFilter, setFileFilter] = useState('');
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [conv, setConv] = useState<Conv>({ status: 'idle' });
  const [topCollapsed, setTopCollapsed] = useState(false);

  // Request bookkeeping: every load gets a fresh controller; stale responses are ignored.
  const projectsCtl = useRef<AbortController | null>(null);
  const filesCtl = useRef<AbortController | null>(null);
  const fileCtl = useRef<AbortController | null>(null);
  const selection = useRef<{ project: string | null; file: string | null }>({ project: null, file: null });

  const loadProjects = useCallback(async () => {
    projectsCtl.current?.abort();
    const ctl = new AbortController();
    projectsCtl.current = ctl;
    setProjects({ status: 'loading' });
    try {
      const data = await api.projects(ctl.signal);
      if (projectsCtl.current === ctl) setProjects({ status: 'ok', data });
    } catch (err) {
      if (!isAbort(err) && projectsCtl.current === ctl) setProjects({ status: 'error', error: toApiError(err) });
    }
  }, []);

  useEffect(() => {
    const ctl = new AbortController();
    api
      .config(ctl.signal)
      .then((data) => setConfig({ status: 'ok', data }))
      .catch((err) => !isAbort(err) && setConfig({ status: 'error', error: toApiError(err) }));
    void loadProjects();
    return () => ctl.abort();
  }, [loadProjects]);

  const loadFiles = useCallback(async (project: string) => {
    filesCtl.current?.abort();
    const ctl = new AbortController();
    filesCtl.current = ctl;
    setFiles({ status: 'loading' });
    try {
      const data = await api.files(project, ctl.signal);
      if (filesCtl.current === ctl && selection.current.project === project) setFiles({ status: 'ok', data });
    } catch (err) {
      if (!isAbort(err) && filesCtl.current === ctl && selection.current.project === project) {
        setFiles({ status: 'error', error: toApiError(err) });
      }
    }
  }, []);

  const selectProject = (name: string) => {
    if (selection.current.project === name) return;
    // Clear the previous file and conversation immediately and cancel in-flight requests.
    filesCtl.current?.abort();
    fileCtl.current?.abort();
    selection.current = { project: name, file: null };
    setSelectedProject(name);
    setSelectedFile(null);
    setConv({ status: 'idle' });
    setFileFilter('');
    void loadFiles(name);
  };

  const startFileLoad = useCallback(async (project: string, file: string, mode: 'open' | 'refresh') => {
    fileCtl.current?.abort();
    const ctl = new AbortController();
    fileCtl.current = ctl;
    const isCurrent = () =>
      fileCtl.current === ctl && selection.current.project === project && selection.current.file === file;

    if (mode === 'open') setConv({ status: 'loading', progress: null });
    else setConv((c) => (c.status === 'ok' ? { ...c, refreshing: true, refreshNote: null } : c));

    try {
      const loaded = await loadFile(project, file, ctl.signal, (p) => {
        if (isCurrent() && mode === 'open') setConv({ status: 'loading', progress: p });
      });
      if (!isCurrent()) return;
      setConv((prev) => {
        let refreshNote: string | null = null;
        if (mode === 'refresh' && prev.status === 'ok') {
          const before = prev.loaded;
          if (loaded.snapshotSize < before.snapshotSize) {
            refreshNote = 'הקובץ קטן מאז הטעינה הקודמת (ייתכן שנכתב מחדש). מוצגת הגרסה העדכנית בלבד.';
          } else {
            const diff = loaded.records.length - before.records.length;
            refreshNote =
              diff > 0
                ? `הקובץ רוענן: נוספו ${formatNumber(diff)} רשומות. מיקום הקריאה נשמר.`
                : 'הקובץ רוענן: לא נמצאו רשומות חדשות.';
          }
        }
        return { status: 'ok', loaded, refreshing: false, refreshNote };
      });
    } catch (err) {
      if (isAbort(err) || !isCurrent()) return;
      const error = toApiError(err);
      setConv((prev) =>
        mode === 'refresh' && prev.status === 'ok'
          ? { ...prev, refreshing: false, refreshNote: `הרענון נכשל: ${error.message} מוצגת הגרסה שנטענה קודם.` }
          : { status: 'error', error },
      );
    }
  }, []);

  const selectFile = (id: string) => {
    const project = selection.current.project;
    if (!project) return;
    if (selection.current.file === id) return;
    selection.current = { project, file: id };
    setSelectedFile(id);
    void startFileLoad(project, id, 'open');
  };

  const cancelLoad = () => {
    fileCtl.current?.abort();
    selection.current = { ...selection.current, file: null };
    setSelectedFile(null);
    setConv({ status: 'idle' });
  };

  // Recompute analysis only when the snapshot changes, not on every refresh flag toggle.
  const loadedSnapshot = conv.status === 'ok' ? conv.loaded : null;
  const stableAnalysis = useMemo(() => (loadedSnapshot ? analyzeRecords(loadedSnapshot.records) : null), [loadedSnapshot]);

  const maxFileBytes = config.status === 'ok' ? config.data.maxFileBytes : files.status === 'ok' ? files.data.maxFileBytes : 0;

  const filteredProjects = useMemo(() => {
    if (projects.status !== 'ok') return [];
    const q = projectFilter.trim().toLowerCase();
    return q ? projects.data.projects.filter((p) => p.name.toLowerCase().includes(q)) : projects.data.projects;
  }, [projects, projectFilter]);

  const filteredFiles = useMemo(() => {
    if (files.status !== 'ok') return [];
    const q = fileFilter.trim().toLowerCase();
    return q ? files.data.files.filter((f) => f.id.toLowerCase().includes(q)) : files.data.files;
  }, [files, fileFilter]);

  const selectedProjectMissing =
    selectedProject !== null && projects.status === 'ok' && !projects.data.projects.some((p) => p.name === selectedProject);

  return (
    <div className={`app${topCollapsed ? ' top-collapsed' : ''}`}>
      <header className="app-header">
        <h1>צפייה בהתכתבויות Claude Code</h1>
        <div className="root-line">
          <span>תיקיית שורש:</span>
          <bdi dir="ltr" className="ltr-inline root-path">
            {config.status === 'ok' ? config.data.root : projects.status === 'ok' ? projects.data.root : '…'}
          </bdi>
          {config.status === 'ok' && (
            <span className="muted">
              ({config.data.rootSource === 'default' ? 'ברירת מחדל' : config.data.rootSource === 'env' ? 'מתוך CCV_ROOT' : 'מתוך config.local.json'} ·
              קריאה בלבד)
            </span>
          )}
          <button type="button" className="btn btn-small" onClick={() => void loadProjects()}>
            ⟳ רענון רשימת פרויקטים
          </button>
          {selectedFile && (
            <button type="button" className="btn btn-small" aria-expanded={!topCollapsed} onClick={() => setTopCollapsed((v) => !v)}>
              {topCollapsed ? '▼ הצגת אזור הבחירה' : '▲ הסתרת אזור הבחירה'}
            </button>
          )}
        </div>
      </header>

      {!topCollapsed && (
        <div className="picker">
          <section className="panel" aria-labelledby="projects-heading">
            <div className="panel-head">
              <h2 id="projects-heading">1. בחירת פרויקט</h2>
              {projects.status === 'ok' && (
                <span className="muted">
                  {formatNumber(filteredProjects.length)} מתוך {formatNumber(projects.data.projects.length)}
                </span>
              )}
            </div>
            <label className="field">
              <span>סינון לפי שם תיקייה</span>
              <input
                className="input"
                type="search"
                value={projectFilter}
                onChange={(e) => setProjectFilter(e.target.value)}
                placeholder="הקלידו חלק משם התיקייה…"
                dir="auto"
              />
            </label>
            <div className="panel-body">
              {projects.status === 'loading' && <p className="loading">טוען את רשימת הפרויקטים…</p>}
              {projects.status === 'error' && <ErrorBox error={projects.error} onRetry={() => void loadProjects()} />}
              {projects.status === 'ok' && projects.data.projects.length === 0 && (
                <p className="empty-state">לא נמצאו תיקיות פרויקט בתיקיית השורש.</p>
              )}
              {projects.status === 'ok' && projects.data.projects.length > 0 && filteredProjects.length === 0 && (
                <p className="empty-state">אין פרויקטים התואמים לסינון.</p>
              )}
              {projects.status === 'ok' && filteredProjects.length > 0 && (
                <SelectList
                  label="רשימת פרויקטים"
                  items={filteredProjects}
                  getKey={(p) => p.name}
                  selectedKey={selectedProject}
                  onSelect={(p) => selectProject(p.name)}
                  renderItem={(p, sel) => (
                    <>
                      <bdi dir="ltr" className="item-name">
                        {p.name}
                      </bdi>
                      <span className="item-meta">
                        {sel && <span className="badge badge-selected">נבחר</span>}
                        עודכן {formatDateTime(p.mtimeMs)}
                      </span>
                    </>
                  )}
                />
              )}
              {projects.status === 'ok' && projects.data.skippedLinks > 0 && (
                <p className="muted small">{projects.data.skippedLinks} קישורים (symlink/junction) בשורש דולגו ואינם נפתחים.</p>
              )}
              {selectedProjectMissing && (
                <p className="alert alert-warning small">הפרויקט הנבחר כבר לא נמצא בתיקיית השורש.</p>
              )}
            </div>
          </section>

          <section className="panel" aria-labelledby="files-heading">
            <div className="panel-head">
              <h2 id="files-heading">2. בחירת קובץ שיחה</h2>
              {selectedProject && (
                <button type="button" className="btn btn-small" onClick={() => void loadFiles(selectedProject)}>
                  ⟳ רענון קבצים
                </button>
              )}
            </div>
            {!selectedProject ? (
              <p className="empty-state">בחרו תחילה פרויקט מהרשימה.</p>
            ) : (
              <>
                <label className="field">
                  <span>סינון לפי שם קובץ</span>
                  <input
                    className="input"
                    type="search"
                    value={fileFilter}
                    onChange={(e) => setFileFilter(e.target.value)}
                    placeholder="לדוגמה: agent או חלק מהמזהה…"
                    dir="auto"
                  />
                </label>
                <div className="panel-body">
                  {files.status === 'loading' && <p className="loading">טוען את קובצי הפרויקט…</p>}
                  {files.status === 'error' && <ErrorBox error={files.error} onRetry={() => void loadFiles(selectedProject)} />}
                  {files.status === 'ok' && files.data.files.length === 0 && (
                    <p className="empty-state">לא נמצאו קובצי ‎.jsonl‎ בפרויקט זה.</p>
                  )}
                  {files.status === 'ok' && files.data.files.length > 0 && filteredFiles.length === 0 && (
                    <p className="empty-state">אין קבצים התואמים לסינון.</p>
                  )}
                  {files.status === 'ok' && filteredFiles.length > 0 && (
                    <SelectList
                      label="קובצי השיחה בפרויקט, מהחדש לישן"
                      items={filteredFiles}
                      getKey={(f) => f.id}
                      selectedKey={selectedFile}
                      onSelect={(f) => selectFile(f.id)}
                      renderItem={(f, sel) => (
                        <>
                          <bdi dir="ltr" className="item-name">
                            {f.id}
                          </bdi>
                          <span className="item-meta">
                            {sel && <span className="badge badge-selected">נבחר</span>}
                            {f.id.includes('/') && <span className="badge">תת-תיקייה</span>}
                            {maxFileBytes > 0 && f.size > maxFileBytes && (
                              <span className="badge badge-error">חורג ממגבלת הגודל</span>
                            )}
                            {formatDateTime(f.mtimeMs)} · {formatBytes(f.size)}
                          </span>
                        </>
                      )}
                    />
                  )}
                  {files.status === 'ok' && (files.data.skippedLinks > 0 || files.data.unreadableDirs.length > 0 || files.data.truncatedWalk) && (
                    <p className="muted small">
                      {files.data.skippedLinks > 0 && <>{files.data.skippedLinks} קישורים דולגו. </>}
                      {files.data.unreadableDirs.length > 0 && <>{files.data.unreadableDirs.length} תתי-תיקיות לא ניתנו לקריאה. </>}
                      {files.data.truncatedWalk && <>הסריקה נעצרה במגבלת עומק/כמות — ייתכן שחסרים קבצים.</>}
                    </p>
                  )}
                </div>
                {maxFileBytes > 0 && (
                  <p className="muted small limit-note">
                    מגבלת קריאה: {formatBytes(maxFileBytes)} לקובץ. קובץ גדול יותר לא ייקרא כלל — הוא לעולם אינו נקטע בשקט.
                  </p>
                )}
              </>
            )}
          </section>
        </div>
      )}

      <main className="lower">
        {conv.status === 'idle' && (
          <div className="empty-state big">
            {selectedProject ? 'בחרו קובץ שיחה כדי להציג את ההתכתבות.' : 'בחרו פרויקט ואחר כך קובץ שיחה כדי להציג את ההתכתבות.'}
          </div>
        )}
        {conv.status === 'loading' && (
          <div className="loading-box" role="status" aria-live="polite">
            <p>
              טוען את <bdi dir="ltr">{selectedFile}</bdi>…
            </p>
            {conv.progress && conv.progress.total > 0 ? (
              <>
                <progress max={conv.progress.total} value={conv.progress.bytes} aria-label="התקדמות הטעינה" />
                <p className="muted">
                  {Math.floor((conv.progress.bytes / conv.progress.total) * 100)}% · {formatBytes(conv.progress.bytes)} מתוך{' '}
                  {formatBytes(conv.progress.total)} · {formatNumber(conv.progress.records)} רשומות
                </p>
              </>
            ) : (
              <progress aria-label="טוען" />
            )}
            <button type="button" className="btn btn-small" onClick={cancelLoad}>
              ביטול
            </button>
          </div>
        )}
        {conv.status === 'error' && (
          <div className="error-wrap">
            <p>
              לא ניתן להציג את <bdi dir="ltr">{selectedFile}</bdi>.
            </p>
            <ErrorBox
              error={conv.error}
              onRetry={() => selectedProject && selectedFile && void startFileLoad(selectedProject, selectedFile, 'open')}
            />
          </div>
        )}
        {conv.status === 'ok' && stableAnalysis && selectedProject && selectedFile && (
          <ConversationView
            key={`${selectedProject}\u0000${selectedFile}`}
            project={selectedProject}
            fileId={selectedFile}
            loaded={conv.loaded}
            analysis={stableAnalysis}
            refreshing={conv.refreshing}
            refreshNote={conv.refreshNote}
            onRefresh={() => void startFileLoad(selectedProject, selectedFile, 'refresh')}
          />
        )}
      </main>
    </div>
  );
}
