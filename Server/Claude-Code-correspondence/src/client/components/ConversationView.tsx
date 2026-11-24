import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { DisplayRecord, FileAnalysis, RecordKind } from '../../shared/normalize';
import type { LoadedFile } from '../api';
import { formatBytes, formatDateTime, formatNumber } from '../format';
import { RecordCard, type RecordContext } from './RecordCard';

export const PAGE_SIZE = 100;

type FilterKey = 'human' | 'assistant' | 'tools' | 'system' | 'meta' | 'unknown';
const FILTERS: { key: FilterKey; label: string; kinds: RecordKind[] }[] = [
  { key: 'human', label: 'משתמש', kinds: ['human'] },
  { key: 'assistant', label: 'עוזר', kinds: ['assistant'] },
  { key: 'tools', label: 'תוצאות כלים', kinds: ['tool-result'] },
  { key: 'system', label: 'מערכת וסיכום', kinds: ['system', 'summary'] },
  { key: 'meta', label: 'מטא-נתונים וצרופות', kinds: ['meta'] },
  { key: 'unknown', label: 'לא מוכר', kinds: ['unknown'] },
];
const ALL_FILTERS = new Set<FilterKey>(FILTERS.map((f) => f.key));

function isVisible(kind: RecordKind, active: Set<FilterKey>): boolean {
  if (kind === 'malformed' || kind === 'pending') return true; // warnings are never hidden
  const f = FILTERS.find((x) => x.kinds.includes(kind));
  return !f || active.has(f.key);
}

function countOccurrences(hay: string, needle: string): number {
  let n = 0;
  let i = hay.indexOf(needle);
  while (i !== -1) {
    n++;
    i = hay.indexOf(needle, i + needle.length);
  }
  return n;
}

type PendingScroll =
  | { type: 'record'; index: number; focus: boolean; offset?: number }
  | { type: 'top' }
  | { type: 'bottom' };

interface Props {
  project: string;
  fileId: string;
  loaded: LoadedFile;
  analysis: FileAnalysis;
  onRefresh: () => void;
  refreshing: boolean;
  refreshNote: string | null;
}

export function ConversationView({ project, fileId, loaded, analysis, onRefresh, refreshing, refreshNote }: Props) {
  const records = loaded.records;
  const [queryInput, setQueryInput] = useState('');
  const [query, setQuery] = useState('');
  const [filters, setFilters] = useState<Set<FilterKey>>(ALL_FILTERS);
  const [page, setPage] = useState(0);
  const [current, setCurrent] = useState(-1);
  const [markdown, setMarkdown] = useState(true);
  const [notice, setNotice] = useState<string | null>(null);
  // File details start collapsed on narrow screens to leave room for the conversation.
  const [factsOpen, setFactsOpen] = useState(() => !window.matchMedia('(max-width: 820px)').matches);
  const [pendingScroll, setPendingScroll] = useState<PendingScroll | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const anchorRef = useRef<{ line: number; offset: number } | null>(null);

  // Debounce search input so typing stays responsive on large files.
  useEffect(() => {
    const t = window.setTimeout(() => setQuery(queryInput.trim().toLowerCase()), 180);
    return () => window.clearTimeout(t);
  }, [queryInput]);

  const visible = useMemo(() => records.filter((r) => isVisible(r.kind, filters)), [records, filters]);
  const posMap = useMemo(() => {
    const m = new Map<number, number>();
    visible.forEach((r, i) => m.set(r.index, i));
    return m;
  }, [visible]);
  const hiddenCount = records.length - visible.length;
  const pageCount = Math.max(1, Math.ceil(visible.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount - 1);
  const pageRecords = visible.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE);

  // Full-file search across all loaded records (not just the rendered page).
  const search = useMemo(() => {
    if (!query) return { matches: [] as number[], occurrences: 0, hiddenMatches: 0, set: new Set<number>() };
    const matches: number[] = [];
    let occurrences = 0;
    let hiddenMatches = 0;
    for (const r of records) {
      const n = countOccurrences(r.searchText, query);
      if (n === 0) continue;
      if (posMap.has(r.index)) {
        matches.push(r.index);
        occurrences += n;
      } else hiddenMatches++;
    }
    return { matches, occurrences, hiddenMatches, set: new Set(matches) };
  }, [records, query, posMap]);

  useEffect(() => setCurrent(-1), [query, filters]);

  const goToRecord = useCallback(
    (index: number, focus: boolean) => {
      const pos = posMap.get(index);
      if (pos === undefined) {
        setNotice('הרשומה המבוקשת מוסתרת על ידי המסננים. נקו את המסננים כדי להציג אותה.');
        return;
      }
      setNotice(null);
      setPage(Math.floor(pos / PAGE_SIZE));
      setPendingScroll({ type: 'record', index, focus });
    },
    [posMap],
  );

  const stepMatch = (dir: 1 | -1) => {
    const n = search.matches.length;
    if (n === 0) return;
    const next = current < 0 ? (dir === 1 ? 0 : n - 1) : (current + dir + n) % n;
    setCurrent(next);
    goToRecord(search.matches[next]!, false);
  };

  // Perform scrolling only in response to explicit actions (pendingScroll).
  useLayoutEffect(() => {
    if (!pendingScroll) return;
    const box = scrollRef.current;
    if (!box) return;
    if (pendingScroll.type === 'top') box.scrollTop = 0;
    else if (pendingScroll.type === 'bottom') box.scrollTop = box.scrollHeight;
    else {
      const el = document.getElementById(`rec-${pendingScroll.index}`);
      if (el) {
        // Scroll only the conversation box (never the page), keeping the anchor offset when restoring.
        const offset = pendingScroll.offset ?? 8;
        box.scrollTop += el.getBoundingClientRect().top - box.getBoundingClientRect().top - offset;
        if (pendingScroll.focus) el.focus({ preventScroll: true });
      }
    }
    setPendingScroll(null);
  }, [pendingScroll, safePage]);

  // Track a reading anchor (first record at the top of the viewport) so refresh can restore it.
  const updateAnchor = useCallback(() => {
    const box = scrollRef.current;
    if (!box) return;
    const top = box.getBoundingClientRect().top;
    for (const el of box.querySelectorAll<HTMLElement>('article.record')) {
      const rect = el.getBoundingClientRect();
      if (rect.bottom > top + 1) {
        anchorRef.current = { line: Number(el.dataset.line), offset: rect.top - top };
        return;
      }
    }
  }, []);

  // When a new snapshot of the same file arrives, restore the reader's position by line number.
  const prevLoaded = useRef(loaded);
  useLayoutEffect(() => {
    if (prevLoaded.current === loaded) return;
    prevLoaded.current = loaded;
    const a = anchorRef.current;
    if (!a) return;
    const target = loaded.records.find((r) => r.line === a.line);
    const pos = target ? posMap.get(target.index) : undefined;
    if (target && pos !== undefined) {
      setPage(Math.floor(pos / PAGE_SIZE));
      setPendingScroll({ type: 'record', index: target.index, focus: false, offset: a.offset });
    }
  }, [loaded, posMap]);

  // Highlight query occurrences in the rendered page using the CSS Custom Highlight API (no DOM mutation).
  useEffect(() => {
    const highlights = (globalThis as { CSS?: { highlights?: Map<string, unknown> } }).CSS?.highlights;
    const HighlightCtor = (globalThis as { Highlight?: new (...r: Range[]) => unknown }).Highlight;
    if (!highlights || !HighlightCtor) return;
    highlights.delete('ccv-search');
    highlights.delete('ccv-search-current');
    const box = scrollRef.current;
    if (!query || !box) return;
    const all: Range[] = [];
    const cur: Range[] = [];
    const currentIdx = current >= 0 ? search.matches[current] : undefined;
    const walker = document.createTreeWalker(box, NodeFilter.SHOW_TEXT);
    let node: Node | null;
    let budget = 5000;
    while ((node = walker.nextNode()) && budget > 0) {
      const text = (node.nodeValue ?? '').toLowerCase();
      let i = text.indexOf(query);
      while (i !== -1 && budget-- > 0) {
        const range = new Range();
        range.setStart(node, i);
        range.setEnd(node, i + query.length);
        const art = node.parentElement?.closest('article.record');
        if (currentIdx !== undefined && art?.id === `rec-${currentIdx}`) cur.push(range);
        else all.push(range);
        i = text.indexOf(query, i + query.length);
      }
    }
    highlights.set('ccv-search', new HighlightCtor(...all));
    highlights.set('ccv-search-current', new HighlightCtor(...cur));
    return () => {
      highlights.delete('ccv-search');
      highlights.delete('ccv-search-current');
    };
  });

  const ctx: RecordContext = useMemo(
    () => ({ analysis, records, markdown, query, onJump: (i: number) => goToRecord(i, true) }),
    [analysis, records, markdown, query, goToRecord],
  );

  const toggleFilter = (k: FilterKey) => {
    setFilters((prev) => {
      const next = new Set(prev);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });
    setPage(0);
  };
  const clearFilters = () => {
    setFilters(ALL_FILTERS);
    setNotice(null);
  };

  const goPage = (p: number) => {
    setPage(Math.max(0, Math.min(pageCount - 1, p)));
    setPendingScroll({ type: 'top' });
  };

  const c = analysis.counts;
  const warnings = c.malformed + c.pending;
  const firstWarning = records.find((r) => r.kind === 'malformed' || r.kind === 'pending');
  const isNested = fileId.includes('/');

  return (
    <section className="conversation" aria-label="תצוגת ההתכתבות">
      <div className="conv-header">
        <div className="conv-title-row">
          <h2 className="conv-title">
            <span className="conv-project">
              פרויקט: <bdi dir="ltr">{project}</bdi>
            </span>
            <span className="conv-file">
              קובץ: <bdi dir="ltr">{fileId}</bdi>
              {isNested && <span className="badge">קובץ בתת-תיקייה</span>}
            </span>
          </h2>
          <div className="conv-actions">
            <button type="button" className="btn" onClick={onRefresh} disabled={refreshing}>
              {refreshing ? 'מרענן…' : '⟳ רענון קובץ'}
            </button>
          </div>
        </div>
        <details
          className="conv-facts-wrap"
          open={factsOpen}
          onToggle={(e) => setFactsOpen(e.currentTarget.open)}
        >
          <summary>פרטי הקובץ</summary>
        <dl className="conv-facts">
          <div>
            <dt>רשומות</dt>
            <dd>
              {formatNumber(records.length)} (מתוך {formatNumber(loaded.physicalLines)} שורות פיזיות)
            </dd>
          </div>
          <div>
            <dt>גודל וזמן שינוי</dt>
            <dd>
              {formatBytes(loaded.snapshotSize)}
              {loaded.snapshotMtimeMs > 0 && <> · {formatDateTime(loaded.snapshotMtimeMs)}</>}
            </dd>
          </div>
          {analysis.firstTimestamp && (
            <div>
              <dt>טווח זמנים ברשומות</dt>
              <dd>
                {formatDateTime(analysis.firstTimestamp)}
                {analysis.lastTimestamp && analysis.lastTimestamp !== analysis.firstTimestamp && (
                  <> — {formatDateTime(analysis.lastTimestamp)}</>
                )}
              </dd>
            </div>
          )}
          {analysis.aiTitles.length > 0 && (
            <div>
              <dt>כותרת שנשמרה בקובץ (aiTitle, האחרונה)</dt>
              <dd>
                <bdi dir="auto" className="secondary-label">
                  {analysis.aiTitles[analysis.aiTitles.length - 1]}
                </bdi>
              </dd>
            </div>
          )}
          {analysis.cwdValues.length > 0 && (
            <div>
              <dt>תיקיית עבודה לפי השדה cwd ברשומות</dt>
              <dd>
                {analysis.cwdValues.slice(0, 3).map((v) => (
                  <bdi key={v} dir="ltr" className="ltr-inline secondary-label">
                    {v}
                  </bdi>
                ))}
                {analysis.cwdValues.length > 3 && <> ועוד {analysis.cwdValues.length - 3}</>}
              </dd>
            </div>
          )}
          <div>
            <dt>הרכב</dt>
            <dd>
              משתמש {c.human} · עוזר {c.assistant} · תוצאות כלים {c['tool-result']} · מערכת {c.system} · סיכום {c.summary} · מטא{' '}
              {c.meta} · לא מוכר {c.unknown}
            </dd>
          </div>
          {(analysis.branchPoints.size > 0 || analysis.sidechainCount > 0 || analysis.duplicateUuids.size > 0) && (
            <div>
              <dt>מבנה</dt>
              <dd>
                {analysis.branchPoints.size > 0 && <>זוהו {analysis.branchPoints.size} נקודות הסתעפות (מוצג לפי סדר הקובץ) · </>}
                {analysis.sidechainCount > 0 && <>{analysis.sidechainCount} רשומות sidechain · </>}
                {analysis.duplicateUuids.size > 0 && <>{analysis.duplicateUuids.size} מזהי uuid חוזרים (לא אוחדו)</>}
              </dd>
            </div>
          )}
        </dl>
        </details>
        {warnings > 0 && (
          <div className="alert alert-warning" role="status">
            ⚠ {c.malformed > 0 && <>{c.malformed} שורות פגומות</>}
            {c.malformed > 0 && c.pending > 0 && ' · '}
            {c.pending > 0 && <>השורה האחרונה חלקית (ייתכן שהקובץ עדיין נכתב)</>}. הרשומות התקינות מוצגות כרגיל.{' '}
            {firstWarning && (
              <button type="button" className="link-button" onClick={() => goToRecord(firstWarning.index, true)}>
                מעבר לאזהרה הראשונה (שורה {firstWarning.line})
              </button>
            )}
          </div>
        )}
        {refreshNote && (
          <div className="alert alert-info" role="status">
            {refreshNote}
          </div>
        )}

        <div className="toolbar" role="toolbar" aria-label="כלי חיפוש וסינון">
          <div className="search-group">
            <label htmlFor="conv-search" className="visually-hidden">
              חיפוש בקובץ
            </label>
            <input
              id="conv-search"
              type="search"
              className="input"
              placeholder="חיפוש בכל הקובץ…"
              value={queryInput}
              onChange={(e) => setQueryInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  stepMatch(e.shiftKey ? -1 : 1);
                }
              }}
              dir="auto"
            />
            <button type="button" className="btn btn-small" onClick={() => stepMatch(-1)} disabled={!search.matches.length} aria-label="התאמה קודמת">
              ▲ הקודם
            </button>
            <button type="button" className="btn btn-small" onClick={() => stepMatch(1)} disabled={!search.matches.length} aria-label="התאמה הבאה">
              ▼ הבא
            </button>
            <span className="match-count" role="status" aria-live="polite">
              {query
                ? search.matches.length
                  ? `${current >= 0 ? `רשומה ${current + 1} מתוך ` : ''}${formatNumber(search.matches.length)} רשומות תואמות · ${formatNumber(search.occurrences)} מופעים`
                  : 'אין התאמות'
                : ''}
              {search.hiddenMatches > 0 && ` · ${search.hiddenMatches} התאמות נוספות ברשומות מוסתרות`}
            </span>
          </div>
          <fieldset className="filters">
            <legend className="visually-hidden">סינון לפי סוג רשומה</legend>
            {FILTERS.map((f) => (
              <label key={f.key} className="chip">
                <input type="checkbox" checked={filters.has(f.key)} onChange={() => toggleFilter(f.key)} />
                {f.label}
              </label>
            ))}
            <label className="chip">
              <input type="checkbox" checked={markdown} onChange={(e) => setMarkdown(e.target.checked)} />
              עיבוד Markdown
            </label>
          </fieldset>
          {hiddenCount > 0 && (
            <div className="hidden-info" role="status">
              {formatNumber(hiddenCount)} רשומות מוסתרות על ידי המסננים.{' '}
              <button type="button" className="link-button" onClick={clearFilters}>
                ניקוי מסננים
              </button>
            </div>
          )}
          {notice && (
            <div className="hidden-info" role="alert">
              {notice}{' '}
              <button type="button" className="link-button" onClick={clearFilters}>
                ניקוי מסננים
              </button>
            </div>
          )}
        </div>
      </div>

      <div className="conv-scroll" ref={scrollRef} onScroll={updateAnchor} tabIndex={0} aria-label="רשומות ההתכתבות">
        {visible.length === 0 ? (
          <p className="empty-state">{records.length === 0 ? 'הקובץ ריק — אין בו רשומות.' : 'כל הרשומות מוסתרות על ידי המסננים.'}</p>
        ) : (
          pageRecords.map((r: DisplayRecord) => (
            <RecordCard
              key={r.index}
              record={r}
              ctx={ctx}
              isMatch={search.set.has(r.index)}
              isCurrent={current >= 0 && search.matches[current] === r.index}
            />
          ))
        )}
      </div>

      <nav className="conv-footer" aria-label="ניווט בין עמודים">
        <div className="pager">
          <button type="button" className="btn btn-small" onClick={() => goPage(0)} disabled={safePage === 0}>
            ⇤ ראשון
          </button>
          <button type="button" className="btn btn-small" onClick={() => goPage(safePage - 1)} disabled={safePage === 0}>
            → הקודם
          </button>
          <span className="page-info">
            עמוד {formatNumber(safePage + 1)} מתוך {formatNumber(pageCount)} · רשומות{' '}
            <bdi dir="ltr">
              {visible.length ? formatNumber(safePage * PAGE_SIZE + 1) : 0}–{formatNumber(Math.min(visible.length, (safePage + 1) * PAGE_SIZE))}
            </bdi>
          </span>
          <button type="button" className="btn btn-small" onClick={() => goPage(safePage + 1)} disabled={safePage >= pageCount - 1}>
            הבא ←
          </button>
          <button type="button" className="btn btn-small" onClick={() => goPage(pageCount - 1)} disabled={safePage >= pageCount - 1}>
            אחרון ⇥
          </button>
        </div>
        <div className="jump">
          <button
            type="button"
            className="btn btn-small"
            onClick={() => {
              setPage(0);
              setPendingScroll({ type: 'top' });
            }}
          >
            ⤒ לתחילת הקובץ
          </button>
          <button
            type="button"
            className="btn btn-small"
            onClick={() => {
              setPage(pageCount - 1);
              setPendingScroll({ type: 'bottom' });
            }}
          >
            ⤓ לסוף הקובץ
          </button>
        </div>
      </nav>
    </section>
  );
}
