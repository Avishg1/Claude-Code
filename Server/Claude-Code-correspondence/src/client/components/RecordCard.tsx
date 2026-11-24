import { memo, useEffect, useState, type ReactNode } from 'react';
import type { Block, DisplayRecord, FileAnalysis, RecordKind } from '../../shared/normalize';
import { Markdown } from '../markdown';
import { formatBytes, formatDateTime } from '../format';
import { CopyButton } from './CopyButton';
import { JsonView, RawTextView } from './JsonView';

export const KIND_LABELS: Record<RecordKind, string> = {
  human: 'משתמש',
  assistant: 'עוזר (Claude)',
  'tool-result': 'תוצאת כלי',
  system: 'רשומת מערכת',
  summary: 'סיכום שנשמר בקובץ',
  meta: 'מטא-נתונים',
  unknown: 'רשומה לא מוכרת',
  malformed: 'שורה פגומה',
  pending: 'שורה אחרונה חלקית',
};

const KIND_ICONS: Record<RecordKind, string> = {
  human: '👤',
  assistant: '🤖',
  'tool-result': '📤',
  system: '⚙',
  summary: '📝',
  meta: 'ℹ',
  unknown: '❓',
  malformed: '⚠',
  pending: '⏳',
};

export interface RecordContext {
  analysis: FileAnalysis;
  records: DisplayRecord[];
  markdown: boolean;
  query: string;
  onJump: (index: number) => void;
}

function Collapsible({
  summary,
  defaultOpen = false,
  className,
  children,
}: {
  summary: ReactNode;
  defaultOpen?: boolean;
  className?: string;
  children: () => ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  useEffect(() => {
    if (defaultOpen) setOpen(true);
  }, [defaultOpen]);
  return (
    <details className={`collapsible ${className ?? ''}`} open={open} onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary>{summary}</summary>
      {open && <div className="collapsible-body">{children()}</div>}
    </details>
  );
}

function blockPlainText(b: Block): string {
  switch (b.kind) {
    case 'text':
    case 'thinking':
      return b.text;
    case 'tool_result':
      return b.content.map(blockPlainText).join('\n');
    case 'tool_use':
      return JSON.stringify(b.input ?? null, null, 2);
    default:
      return '';
  }
}

function blockMatches(b: Block, q: string): boolean {
  if (!q) return false;
  const t = b.kind === 'unknown' ? JSON.stringify(b.raw) ?? '' : b.kind === 'tool_use' ? `${b.name ?? ''} ${JSON.stringify(b.input) ?? ''}` : blockPlainText(b);
  return t.toLowerCase().includes(q);
}

export function messageCopyText(r: DisplayRecord): string {
  if (r.kind === 'malformed' || r.kind === 'pending') return r.rawText ?? '';
  if (r.kind === 'summary') return r.summaryText ?? '';
  const textual = r.blocks.filter((b) => b.kind === 'text' || b.kind === 'tool_result');
  if (textual.length > 0) return textual.map(blockPlainText).join('\n\n');
  return JSON.stringify(r.raw, null, 2) ?? '';
}

function LineRef({ index, ctx, children }: { index: number; ctx: RecordContext; children: ReactNode }) {
  const target = ctx.records[index];
  if (!target) return null;
  return (
    <button type="button" className="link-button" onClick={() => ctx.onJump(index)}>
      {children} (שורה {target.line})
    </button>
  );
}

function TextBlock({ text, markdown }: { text: string; markdown: boolean }) {
  if (text === '') return <p className="muted">(בלוק טקסט ריק בקובץ)</p>;
  return markdown ? (
    <Markdown text={text} />
  ) : (
    <div className="plain-text" dir="auto">
      {text}
    </div>
  );
}

function BlockView({ block, ctx, record }: { block: Block; ctx: RecordContext; record: DisplayRecord }) {
  switch (block.kind) {
    case 'text':
      return <TextBlock text={block.text} markdown={ctx.markdown} />;
    case 'thinking':
      if (block.redacted) {
        return <p className="notice">🔒 בלוק חשיבה מוסתר (redacted_thinking) — התוכן אינו זמין בקובץ.</p>;
      }
      return (
        <Collapsible className="thinking" defaultOpen={blockMatches(block, ctx.query)} summary={<>💭 חשיבה (כפי שנשמרה בקובץ)</>}>
          {() => (block.text ? <div className="plain-text" dir="auto">{block.text}</div> : <p className="muted">(ריק בקובץ)</p>)}
        </Collapsible>
      );
    case 'tool_use': {
      const link = block.id ? ctx.analysis.toolLinks.get(block.id) : undefined;
      return (
        <Collapsible
          className="tool tool-use"
          defaultOpen={blockMatches(block, ctx.query)}
          summary={
            <>
              🔧 קריאה לכלי: <bdi dir="ltr" className="tool-name">{block.name ?? '(ללא שם בקובץ)'}</bdi>
              {block.id && (
                <span className="tool-id">
                  {' '}
                  · מזהה <bdi dir="ltr">{block.id}</bdi>
                </span>
              )}
            </>
          }
        >
          {() => (
            <>
              <div className="tool-links">
                {link && link.resultRecords.length > 0 ? (
                  link.resultRecords.map((ri) => (
                    <LineRef key={ri} index={ri} ctx={ctx}>
                      ← מעבר לתוצאה
                    </LineRef>
                  ))
                ) : (
                  <span className="muted">לא נמצאה בקובץ תוצאה עם מזהה זה.</span>
                )}
              </div>
              <JsonView value={block.input} label="קלט הכלי (JSON)" />
            </>
          )}
        </Collapsible>
      );
    }
    case 'tool_result': {
      const link = block.toolUseId ? ctx.analysis.toolLinks.get(block.toolUseId) : undefined;
      const callName = link?.name;
      return (
        <Collapsible
          className={`tool tool-result${block.isError ? ' is-error' : ''}`}
          defaultOpen={blockMatches(block, ctx.query)}
          summary={
            <>
              📤 תוצאת כלי{callName && (
                <>
                  {' '}של <bdi dir="ltr" className="tool-name">{callName}</bdi>
                </>
              )}
              {block.isError && <span className="badge badge-error">שגיאה</span>}
              {block.toolUseId && (
                <span className="tool-id">
                  {' '}
                  · מזהה <bdi dir="ltr">{block.toolUseId}</bdi>
                </span>
              )}
            </>
          }
        >
          {() => (
            <>
              <div className="tool-links">
                {link && link.callRecord >= 0 && link.callRecord !== record.index ? (
                  <LineRef index={link.callRecord} ctx={ctx}>
                    → מעבר לקריאה
                  </LineRef>
                ) : !block.toolUseId ? (
                  <span className="muted">לתוצאה זו אין מזהה קריאה בקובץ.</span>
                ) : (
                  <span className="muted">הקריאה המתאימה לא נמצאה בקובץ זה.</span>
                )}
              </div>
              {block.content.length === 0 ? (
                <p className="muted">(התוצאה ריקה בקובץ)</p>
              ) : (
                block.content.map((b, i) =>
                  b.kind === 'text' ? (
                    <pre key={i} className="tool-output" dir="auto" tabIndex={0}>
                      {b.text}
                    </pre>
                  ) : (
                    <BlockView key={i} block={b} ctx={ctx} record={record} />
                  ),
                )
              )}
            </>
          )}
        </Collapsible>
      );
    }
    case 'image':
      return (
        <p className="notice">
          🖼 תמונה/מסמך מוטמע{block.mediaType && <> (<bdi dir="ltr">{block.mediaType}</bdi>)</>}
          {block.approxBytes !== undefined && <> · כ-{formatBytes(block.approxBytes)}</>}
          {block.url && (
            <>
              {' '}
              · כתובת: <bdi dir="ltr">{block.url}</bdi>
            </>
          )}{' '}
          — אינו מוצג ואינו נטען (מטעמי פרטיות ואבטחה). ניתן לראות את הנתונים ב-JSON הגולמי.
        </p>
      );
    case 'unknown':
      return (
        <Collapsible
          className="unknown-block"
          defaultOpen={blockMatches(block, ctx.query)}
          summary={
            <>
              ❓ בלוק תוכן לא מוכר{block.type && <> מסוג <bdi dir="ltr">{block.type}</bdi></>}
            </>
          }
        >
          {() => <JsonView value={block.raw} label="בלוק לא מוכר (JSON)" />}
        </Collapsible>
      );
  }
}

function RecordBody({ r, ctx }: { r: DisplayRecord; ctx: RecordContext }) {
  switch (r.kind) {
    case 'malformed':
      return (
        <>
          <p className="warning-text">
            שורה זו אינה JSON תקין ולכן לא פוענחה. שאר השורות בקובץ ממשיכות להיקרא כרגיל.
          </p>
          <p className="muted" dir="ltr">
            {r.error}
          </p>
          <Collapsible summary="הצגת השורה הגולמית (מקומית בלבד)">
            {() => <RawTextView text={r.rawText ?? ''} label={`שורה ${r.line} גולמית`} />}
          </Collapsible>
        </>
      );
    case 'pending':
      return (
        <>
          <p className="warning-text">
            השורה האחרונה בקובץ לא הסתיימה (אין ירידת שורה והיא אינה JSON שלם). ייתכן שהקובץ עדיין נכתב — לחצו
            "רענון קובץ" כדי לקרוא אותו שוב. הרשומות הקודמות נשמרו.
          </p>
          <Collapsible summary="הצגת התוכן החלקי (מקומית בלבד)">
            {() => <RawTextView text={r.rawText ?? ''} label={`שורה ${r.line} חלקית`} />}
          </Collapsible>
        </>
      );
    case 'summary':
      return <TextBlock text={r.summaryText ?? ''} markdown={false} />;
    case 'meta':
    case 'unknown':
      return (
        <Collapsible
          summary={
            r.kind === 'meta' ? (
              <>
                פרטי רשומה מסוג <bdi dir="ltr">{r.rawType}</bdi>
              </>
            ) : (
              'פרטי הרשומה (JSON)'
            )
          }
          defaultOpen={!!ctx.query && r.searchText.includes(ctx.query)}
        >
          {() => <JsonView value={r.raw} label="תוכן הרשומה (JSON)" />}
        </Collapsible>
      );
    default:
      break;
  }
  if (r.blocks.length === 0) {
    return r.kind === 'system' ? (
      <Collapsible summary="פרטי רשומת המערכת (JSON)" defaultOpen={!!ctx.query && r.searchText.includes(ctx.query)}>
        {() => <JsonView value={r.raw} label="רשומת מערכת (JSON)" />}
      </Collapsible>
    ) : (
      <p className="muted">(אין תוכן בהודעה זו בקובץ)</p>
    );
  }
  return (
    <>
      {r.blocks.map((b, i) => (
        <BlockView key={i} block={b} ctx={ctx} record={r} />
      ))}
    </>
  );
}

interface CardProps {
  record: DisplayRecord;
  ctx: RecordContext;
  isMatch: boolean;
  isCurrent: boolean;
}

/**
 * Compact one-line row for metadata records (and system records without content):
 * the label is always visible; rendered content and raw JSON open on demand.
 */
function CompactRecord({ record: r, ctx, isMatch, isCurrent }: CardProps) {
  const ts = r.timestamp ? formatDateTime(r.timestamp) : '';
  const matches = !!ctx.query && r.searchText.includes(ctx.query);
  let label: ReactNode;
  if (r.adapter === 'attachment') {
    label = (
      <>
        📎 צרופה{r.attachmentType && <>: <bdi dir="ltr">{r.attachmentType}</bdi></>}
      </>
    );
  } else if (r.adapter === 'ai-title') {
    label = (
      <>
        🏷 כותרת שנשמרה בקובץ (aiTitle):{' '}
        <bdi dir="auto" className="compact-title">
          {r.title}
        </bdi>
      </>
    );
  } else if (r.kind === 'system') {
    label = (
      <>
        {KIND_ICONS.system} {KIND_LABELS.system}
        {r.subtype && (
          <>
            {' '}
            (<bdi dir="ltr">{r.subtype}</bdi>)
          </>
        )}
      </>
    );
  } else {
    label = (
      <>
        {KIND_ICONS.meta} {KIND_LABELS.meta}
        {r.rawType && (
          <>
            : <bdi dir="ltr">{r.rawType}</bdi>
          </>
        )}
      </>
    );
  }
  return (
    <article
      id={`rec-${r.index}`}
      className={`record compact kind-${r.kind}${isMatch ? ' is-match' : ''}${isCurrent ? ' is-current' : ''}`}
      aria-label={`${KIND_LABELS[r.kind]}, שורה ${r.line}`}
      tabIndex={-1}
      data-line={r.line}
    >
      <Collapsible
        defaultOpen={matches}
        summary={
          <>
            <span className="compact-label">{label}</span>
            {r.renderedRole && (
              <span className="badge" title="השדה renderedRole ברשומה">
                renderedRole: <bdi dir="ltr">{r.renderedRole}</bdi>
              </span>
            )}
            <span className="record-meta">
              <span className="line-no">שורה {r.line}</span>
              {ts && (
                <time dateTime={r.timestamp} title={r.timestamp}>
                  {ts}
                </time>
              )}
            </span>
          </>
        }
      >
        {() => (
          <>
            <div className="record-actions compact-actions">
              <CopyButton getText={() => messageCopyText(r)} label={`העתקת תוכן שורה ${r.line}`} />
            </div>
            {r.blocks.length > 0 && (
              <div className="rendered-content">
                <p className="muted small">התוכן כפי שנשמר בשדה rendered:</p>
                {r.blocks.map((b, i) =>
                  b.kind === 'text' ? (
                    <pre key={i} className="tool-output" dir="auto" tabIndex={0}>
                      {b.text}
                    </pre>
                  ) : (
                    <BlockView key={i} block={b} ctx={ctx} record={r} />
                  ),
                )}
              </div>
            )}
            <JsonView value={r.raw} label={`JSON גולמי של שורה ${r.line}`} />
          </>
        )}
      </Collapsible>
    </article>
  );
}

function RecordCardInner(props: CardProps) {
  const r0 = props.record;
  if (r0.kind === 'meta' || (r0.kind === 'system' && r0.blocks.length === 0)) return <CompactRecord {...props} />;
  return <FullRecordCard {...props} />;
}

function FullRecordCard({ record: r, ctx, isMatch, isCurrent }: CardProps) {
  const [showRaw, setShowRaw] = useState(false);
  const label = KIND_LABELS[r.kind];
  const branch = ctx.analysis.branchMembership.get(r.index);
  const branchChildren = r.uuid ? ctx.analysis.branchPoints.get(r.uuid) : undefined;
  const dupCount = r.uuid ? ctx.analysis.duplicateUuids.get(r.uuid)?.length : undefined;
  const ts = r.timestamp ? formatDateTime(r.timestamp) : '';
  const hasRawJson = r.kind !== 'malformed' && r.kind !== 'pending' && r.kind !== 'meta' && r.kind !== 'unknown';

  return (
    <article
      id={`rec-${r.index}`}
      className={`record kind-${r.kind}${isMatch ? ' is-match' : ''}${isCurrent ? ' is-current' : ''}`}
      aria-label={`${label}, שורה ${r.line}`}
      tabIndex={-1}
      data-line={r.line}
    >
      <header className="record-header">
        <span className="role-badge">
          <span aria-hidden="true">{KIND_ICONS[r.kind]}</span> {label}
          {r.kind === 'meta' && r.rawType && (
            <>
              : <bdi dir="ltr">{r.rawType}</bdi>
            </>
          )}
          {r.kind === 'system' && r.subtype && (
            <>
              {' '}
              (<bdi dir="ltr">{r.subtype}</bdi>)
            </>
          )}
        </span>
        <span className="record-meta">
          <span className="line-no">שורה {r.line}</span>
          {ts && (
            <time dateTime={r.timestamp} title={r.timestamp}>
              {ts}
            </time>
          )}
          {r.model && (
            <bdi dir="ltr" className="model">
              {r.model}
            </bdi>
          )}
        </span>
        <span className="record-badges">
          {r.isMeta && <span className="badge">isMeta</span>}
          {r.isSidechain && <span className="badge badge-side">שרשור משנה (sidechain)</span>}
          {branch && (
            <span className="badge badge-branch" title="לרשומת האב יש כמה המשכים בקובץ">
              ענף {branch.position} מתוך {branch.total}
            </span>
          )}
          {branchChildren && <span className="badge badge-branch">נקודת הסתעפות: {branchChildren.length} המשכים</span>}
          {dupCount && dupCount > 1 && (
            <span className="badge" title="אותו uuid מופיע ביותר משורה אחת; לא אוחד ולא הוסר">
              uuid חוזר ×{dupCount}
            </span>
          )}
          {r.noTrailingNewline && <span className="badge">ללא ירידת שורה בסוף</span>}
        </span>
        <span className="record-actions">
          <CopyButton getText={() => messageCopyText(r)} label={`העתקת תוכן שורה ${r.line}`} />
          {hasRawJson && (
            <button type="button" className="btn btn-small" aria-expanded={showRaw} onClick={() => setShowRaw((v) => !v)}>
              {showRaw ? 'הסתרת JSON' : 'JSON גולמי'}
            </button>
          )}
        </span>
      </header>
      <div className="record-body">
        <RecordBody r={r} ctx={ctx} />
      </div>
      {showRaw && hasRawJson && (
        <div className="record-raw">
          <JsonView value={r.raw} label={`JSON גולמי של שורה ${r.line}`} />
        </div>
      )}
    </article>
  );
}

export const RecordCard = memo(RecordCardInner);
