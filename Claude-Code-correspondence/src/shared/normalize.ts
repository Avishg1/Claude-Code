/**
 * Explicit record adapters: original JSON value -> display model.
 *
 * The original value is always retained on the display record (`raw`). Nothing is invented:
 * fields that are absent stay undefined, and anything not understood is kept as an
 * "unknown" block/record that can be inspected as raw JSON.
 *
 * Adapters (checked in this order):
 *  - "message-envelope": { type: "user"|"assistant", message: { role, content } }
 *  - "summary":          { type: "summary", summary: string }
 *  - "system":           { type: "system", ... }   (content/subtype shown when present)
 *  - "bare-message":     { role: "user"|"assistant", content }   (no envelope)
 *  - "attachment":       { type: "attachment", attachment: { type, ... }, rendered?: [{ content }], renderedRole? }
 *                        (observed in a real Claude Code file: context injected into the conversation)
 *  - "ai-title":         { type: "ai-title", aiTitle: string }   (observed: a title stored in the file)
 *  - "typed-other":      any object with a string "type" not handled above -> metadata item
 *  - "unknown":          anything else (arrays, primitives, objects without "type")
 *
 * Content adapters inside messages:
 *  - string content -> one text block
 *  - array content  -> per block: text, thinking, redacted_thinking, tool_use, tool_result,
 *                      image, document; anything else -> unknown block (raw JSON)
 */
import type { ParsedLine } from './jsonl.js';

export type Block =
  | { kind: 'text'; text: string }
  | { kind: 'thinking'; text: string; redacted: boolean }
  | { kind: 'tool_use'; id?: string; name?: string; input: unknown }
  | { kind: 'tool_result'; toolUseId?: string; isError?: boolean; content: Block[] }
  | { kind: 'image'; mediaType?: string; sourceType?: string; approxBytes?: number; url?: string }
  | { kind: 'unknown'; type?: string; raw: unknown };

export type RecordKind =
  | 'human'
  | 'assistant'
  | 'tool-result'
  | 'system'
  | 'summary'
  | 'meta'
  | 'unknown'
  | 'malformed'
  | 'pending';

export interface DisplayRecord {
  /** Index in the records array (source order). */
  index: number;
  /** 1-based physical line number in the file. */
  line: number;
  kind: RecordKind;
  adapter: string;
  /** The record's own "type" value, verbatim, when it is a string. */
  rawType?: string;
  role?: string;
  uuid?: string;
  parentUuid?: string | null;
  timestamp?: string;
  isSidechain?: boolean;
  isMeta?: boolean;
  model?: string;
  subtype?: string;
  /** attachment.type for "attachment" records. */
  attachmentType?: string;
  /** renderedRole for "attachment" records, verbatim. */
  renderedRole?: string;
  /** aiTitle for "ai-title" records, verbatim. */
  title?: string;
  blocks: Block[];
  summaryText?: string;
  /** Original parsed JSON (undefined for malformed/pending lines). */
  raw?: unknown;
  /** Original line text for malformed/pending lines, shown only on demand. */
  rawText?: string;
  error?: string;
  noTrailingNewline?: boolean;
  /** Lower-cased text used for full-file search. */
  searchText: string;
}

type Obj = Record<string, unknown>;

const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);
const bool = (v: unknown): boolean | undefined => (typeof v === 'boolean' ? v : undefined);

export function normalizeContent(content: unknown): Block[] {
  if (typeof content === 'string') return [{ kind: 'text', text: content }];
  if (Array.isArray(content)) return content.map(normalizeBlock);
  if (content === undefined || content === null) return [];
  return [{ kind: 'unknown', raw: content }];
}

export function normalizeBlock(b: unknown): Block {
  if (typeof b === 'string') return { kind: 'text', text: b };
  if (!isObj(b)) return { kind: 'unknown', raw: b };
  const type = str(b.type);
  switch (type) {
    case 'text':
      if (typeof b.text === 'string') return { kind: 'text', text: b.text };
      break;
    case 'thinking':
      if (typeof b.thinking === 'string') return { kind: 'thinking', text: b.thinking, redacted: false };
      break;
    case 'redacted_thinking':
      return { kind: 'thinking', text: '', redacted: true };
    case 'tool_use':
    case 'server_tool_use':
      return { kind: 'tool_use', id: str(b.id), name: str(b.name), input: b.input };
    case 'tool_result':
      return {
        kind: 'tool_result',
        toolUseId: str(b.tool_use_id),
        isError: bool(b.is_error),
        content: normalizeContent(b.content),
      };
    case 'image':
    case 'document': {
      const src = isObj(b.source) ? b.source : undefined;
      const data = src ? str(src.data) : undefined;
      return {
        kind: 'image',
        mediaType: src ? str(src.media_type) : undefined,
        sourceType: src ? str(src.type) : undefined,
        approxBytes: data ? Math.floor((data.length * 3) / 4) : undefined,
        url: src ? str(src.url) : undefined,
      };
    }
  }
  return { kind: 'unknown', type, raw: b };
}

function safeStringify(v: unknown): string {
  try {
    return JSON.stringify(v) ?? '';
  } catch {
    return '';
  }
}

function blockSearchText(b: Block): string {
  switch (b.kind) {
    case 'text':
    case 'thinking':
      return b.text;
    case 'tool_use':
      return `${b.name ?? ''} ${b.id ?? ''} ${safeStringify(b.input)}`;
    case 'tool_result':
      return `${b.toolUseId ?? ''} ${b.content.map(blockSearchText).join('\n')}`;
    case 'image':
      return `${b.mediaType ?? ''} ${b.url ?? ''}`;
    case 'unknown':
      return safeStringify(b.raw);
  }
}

function commonFields(o: Obj) {
  return {
    rawType: str(o.type),
    uuid: str(o.uuid),
    parentUuid: o.parentUuid === null ? null : str(o.parentUuid),
    timestamp: str(o.timestamp),
    isSidechain: bool(o.isSidechain),
    isMeta: bool(o.isMeta),
  };
}

export function normalizeLine(entry: ParsedLine, index: number): DisplayRecord {
  if (entry.kind !== 'ok') {
    return {
      index,
      line: entry.line,
      kind: entry.kind,
      adapter: entry.kind,
      blocks: [],
      rawText: entry.rawText,
      error: entry.error,
      searchText: entry.rawText.toLowerCase(),
    };
  }
  const v = entry.value;
  const base = { index, line: entry.line, raw: v, noTrailingNewline: entry.noTrailingNewline };

  if (!isObj(v)) {
    return { ...base, kind: 'unknown', adapter: 'unknown', blocks: [], searchText: safeStringify(v).toLowerCase() };
  }
  const common = commonFields(v);

  // Envelope: { type: user|assistant, message: { role, content } }
  if ((v.type === 'user' || v.type === 'assistant') && isObj(v.message)) {
    const msg = v.message;
    const role = str(msg.role) ?? v.type;
    const blocks = normalizeContent(msg.content);
    return finish({
      ...base,
      ...common,
      adapter: 'message-envelope',
      kind: classifyRole(role, blocks),
      role,
      model: str(msg.model),
      blocks,
    });
  }

  if (v.type === 'summary' && typeof v.summary === 'string') {
    return finish({ ...base, ...common, adapter: 'summary', kind: 'summary', summaryText: v.summary, blocks: [] });
  }

  if (v.type === 'system') {
    const blocks = v.content !== undefined ? normalizeContent(v.content) : [];
    return finish({ ...base, ...common, adapter: 'system', kind: 'system', subtype: str(v.subtype), blocks });
  }

  // Bare message without an envelope.
  if ((v.role === 'user' || v.role === 'assistant') && 'content' in v) {
    const role = v.role;
    const blocks = normalizeContent(v.content);
    return finish({ ...base, ...common, adapter: 'bare-message', kind: classifyRole(role, blocks), role, blocks });
  }

  if (v.type === 'attachment' && isObj(v.attachment)) {
    const blocks: Block[] = Array.isArray(v.rendered)
      ? v.rendered.map((it): Block => (isObj(it) && typeof it.content === 'string' ? { kind: 'text', text: it.content } : normalizeBlock(it)))
      : [];
    return finish({
      ...base,
      ...common,
      adapter: 'attachment',
      kind: 'meta',
      attachmentType: str(v.attachment.type),
      renderedRole: str(v.renderedRole),
      blocks,
    });
  }

  if (v.type === 'ai-title' && typeof v.aiTitle === 'string') {
    return finish({ ...base, ...common, adapter: 'ai-title', kind: 'meta', title: v.aiTitle, blocks: [] });
  }

  if (typeof v.type === 'string') {
    return finish({ ...base, ...common, adapter: 'typed-other', kind: 'meta', blocks: [] });
  }

  return finish({ ...base, ...common, adapter: 'unknown', kind: 'unknown', blocks: [] });
}

function classifyRole(role: string, blocks: Block[]): RecordKind {
  if (role === 'assistant') return 'assistant';
  if (role === 'user') {
    if (blocks.length > 0 && blocks.every((b) => b.kind === 'tool_result')) return 'tool-result';
    return 'human';
  }
  return 'unknown';
}

function finish(r: Omit<DisplayRecord, 'searchText'>): DisplayRecord {
  let text: string;
  if (r.kind === 'meta' || r.kind === 'unknown' || r.kind === 'system') {
    // Metadata is searchable through its JSON so nothing becomes unreachable.
    text = safeStringify(r.raw);
  } else {
    text = [r.summaryText ?? '', ...r.blocks.map(blockSearchText)].join('\n');
  }
  return { ...r, searchText: text.toLowerCase() };
}

/* ------------------------------------------------------------------ */
/* File-level analysis                                                */
/* ------------------------------------------------------------------ */

export interface ToolLink {
  callRecord: number;
  resultRecords: number[];
  name?: string;
}

export interface FileAnalysis {
  counts: Record<RecordKind, number>;
  firstTimestamp?: string;
  lastTimestamp?: string;
  cwdValues: string[];
  sessionIds: string[];
  /** parent uuid -> indexes of child records, only where a parent has more than one child. */
  branchPoints: Map<string, number[]>;
  /** record index -> { position, total } for records that are one of several siblings. */
  branchMembership: Map<number, { position: number; total: number; parentUuid: string }>;
  /** uuid values that appear on more than one line. */
  duplicateUuids: Map<string, number[]>;
  /** tool_use id -> link info */
  toolLinks: Map<string, ToolLink>;
  sidechainCount: number;
  /** aiTitle values in file order (verbatim). */
  aiTitles: string[];
}

const emptyCounts = (): Record<RecordKind, number> => ({
  human: 0,
  assistant: 0,
  'tool-result': 0,
  system: 0,
  summary: 0,
  meta: 0,
  unknown: 0,
  malformed: 0,
  pending: 0,
});

function isValidTimestamp(t: string | undefined): t is string {
  return !!t && !Number.isNaN(Date.parse(t));
}

export function analyzeRecords(records: DisplayRecord[]): FileAnalysis {
  const counts = emptyCounts();
  const cwd = new Set<string>();
  const sessions = new Set<string>();
  const children = new Map<string, number[]>();
  const uuidLines = new Map<string, number[]>();
  const toolLinks = new Map<string, ToolLink>();
  let firstTs: string | undefined;
  let lastTs: string | undefined;
  let firstMs = Infinity;
  let lastMs = -Infinity;
  let sidechainCount = 0;
  const aiTitles: string[] = [];

  for (const r of records) {
    counts[r.kind]++;
    if (isValidTimestamp(r.timestamp)) {
      const ms = Date.parse(r.timestamp);
      if (ms < firstMs) {
        firstMs = ms;
        firstTs = r.timestamp;
      }
      if (ms > lastMs) {
        lastMs = ms;
        lastTs = r.timestamp;
      }
    }
    if (isObj(r.raw)) {
      const c = str(r.raw.cwd);
      if (c) cwd.add(c);
      const s = str(r.raw.sessionId);
      if (s) sessions.add(s);
    }
    if (r.isSidechain) sidechainCount++;
    if (r.title !== undefined) aiTitles.push(r.title);
    if (r.uuid) {
      const arr = uuidLines.get(r.uuid) ?? [];
      arr.push(r.index);
      uuidLines.set(r.uuid, arr);
    }
    if (r.uuid && typeof r.parentUuid === 'string') {
      const arr = children.get(r.parentUuid) ?? [];
      arr.push(r.index);
      children.set(r.parentUuid, arr);
    }
    for (const b of r.blocks) {
      if (b.kind === 'tool_use' && b.id) {
        const link = toolLinks.get(b.id) ?? { callRecord: r.index, resultRecords: [] };
        link.callRecord = r.index;
        link.name = b.name;
        toolLinks.set(b.id, link);
      } else if (b.kind === 'tool_result' && b.toolUseId) {
        const link = toolLinks.get(b.toolUseId) ?? { callRecord: -1, resultRecords: [] };
        link.resultRecords.push(r.index);
        toolLinks.set(b.toolUseId, link);
      }
    }
  }

  const branchPoints = new Map<string, number[]>();
  const branchMembership = new Map<number, { position: number; total: number; parentUuid: string }>();
  for (const [parent, kids] of children) {
    // Count distinct child uuids so an exact duplicate line is not mistaken for a branch.
    const distinct: number[] = [];
    const seen = new Set<string>();
    for (const k of kids) {
      const u = records[k]?.uuid;
      if (u && !seen.has(u)) {
        seen.add(u);
        distinct.push(k);
      }
    }
    if (distinct.length > 1) {
      branchPoints.set(parent, distinct);
      distinct.forEach((k, i) => branchMembership.set(k, { position: i + 1, total: distinct.length, parentUuid: parent }));
    }
  }
  const duplicateUuids = new Map<string, number[]>();
  for (const [u, idx] of uuidLines) if (idx.length > 1) duplicateUuids.set(u, idx);

  return {
    counts,
    firstTimestamp: firstTs,
    lastTimestamp: lastTs,
    cwdValues: [...cwd],
    sessionIds: [...sessions],
    branchPoints,
    branchMembership,
    duplicateUuids,
    toolLinks,
    sidechainCount,
    aiTitles,
  };
}
