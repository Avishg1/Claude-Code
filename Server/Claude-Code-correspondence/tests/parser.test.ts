import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { JsonlLineParser, parseJsonlText, type ParsedLine } from '../src/shared/jsonl';
import { analyzeRecords, normalizeLine, type DisplayRecord } from '../src/shared/normalize';

const FIX = path.resolve(__dirname, '..', 'fixtures', 'projects');
const load = (rel: string): DisplayRecord[] =>
  parseJsonlText(readFileSync(path.join(FIX, rel), 'utf8')).map((e, i) => normalizeLine(e, i));

describe('JsonlLineParser', () => {
  it('handles BOM, CRLF, blank lines, malformed middle line and an incomplete final line', () => {
    const out = parseJsonlText('\uFEFF{"a":1}\r\n\r\n   \n{bad json}\n{"b":2}\n{"c":');
    expect(out.map((e) => [e.kind, e.line])).toEqual([
      ['ok', 1],
      ['malformed', 4],
      ['ok', 5],
      ['pending', 6],
    ]);
    expect((out[0] as Extract<ParsedLine, { kind: 'ok' }>).value).toEqual({ a: 1 });
    expect((out[1] as Extract<ParsedLine, { kind: 'malformed' }>).rawText).toBe('{bad json}');
  });

  it('accepts a complete final line without trailing newline', () => {
    const out = parseJsonlText('{"a":1}\n{"b":2}');
    expect(out).toHaveLength(2);
    expect(out[1]).toMatchObject({ kind: 'ok', line: 2, noTrailingNewline: true });
  });

  it('produces identical results regardless of chunk boundaries (incl. inside multi-byte text)', () => {
    const text = readFileSync(path.join(FIX, 'C--demo-alpha-project', '11111111-demo-4000-8000-000000000001.jsonl'), 'utf8');
    const whole = parseJsonlText(text);
    for (const size of [1, 2, 3, 7, 64, 1000]) {
      const got: ParsedLine[] = [];
      const p = new JsonlLineParser((e) => got.push(e));
      for (let i = 0; i < text.length; i += size) p.push(text.slice(i, i + size));
      p.finish();
      expect(got).toEqual(whole);
    }
  });

  it('decodes UTF-8 split across byte chunks via a streaming TextDecoder', () => {
    const bytes = new TextEncoder().encode('{"t":"שלום 😀"}\n');
    const dec = new TextDecoder('utf-8');
    const got: ParsedLine[] = [];
    const p = new JsonlLineParser((e) => got.push(e));
    for (let i = 0; i < bytes.length; i++) p.push(dec.decode(bytes.subarray(i, i + 1), { stream: true }));
    p.push(dec.decode());
    p.finish();
    expect(got[0]).toMatchObject({ kind: 'ok', value: { t: 'שלום 😀' } });
  });
});

describe('normalization of the main fixture', () => {
  const recs = load('C--demo-alpha-project/11111111-demo-4000-8000-000000000001.jsonl');

  it('keeps physical order and line numbers', () => {
    expect(recs.map((r) => r.line)).toEqual(recs.map((_, i) => i + 1));
  });

  it('assigns roles from the record, not by guessing', () => {
    expect(recs.map((r) => r.kind)).toEqual([
      'summary',
      'human',
      'assistant',
      'tool-result',
      'assistant',
      'tool-result',
      'human',
      'assistant',
      'system',
      'meta',
      'human',
      'assistant',
      'unknown',
      'unknown',
    ]);
  });

  it('preserves text exactly, including Hebrew/English and line breaks', () => {
    const first = recs[1]!.blocks[0]!;
    expect(first).toEqual({
      kind: 'text',
      text: 'שלום! יש לי באג בפונקציה `sortItems` בקובץ src/sort.ts.\nהיא מחזירה סדר הפוך.\n\nCan you take a look?',
    });
  });

  it('does not invent missing fields', () => {
    const missing = recs[11]!;
    expect(missing.kind).toBe('assistant');
    expect(missing.blocks).toEqual([]);
    expect(missing.timestamp).toBeUndefined();
    expect(missing.uuid).toBeUndefined();
    expect(recs[10]!.timestamp).toBeUndefined();
    expect(recs[10]!.isMeta).toBe(true);
  });

  it('keeps unknown blocks and records inspectable with their raw JSON', () => {
    const unknownBlock = recs[6]!.blocks.find((b) => b.kind === 'unknown');
    expect(unknownBlock).toMatchObject({ kind: 'unknown', type: 'future_block_type' });
    expect(recs[12]!.raw).toEqual({ some: 'record', without: 'type field' });
    expect(recs[13]!.raw).toEqual(['an', 'array', 'record']);
    expect(recs[9]!.rawType).toBe('file-history-snapshot');
  });

  it('represents images as metadata only and redacted thinking without content', () => {
    expect(recs[6]!.blocks[1]).toMatchObject({ kind: 'image', mediaType: 'image/png', sourceType: 'base64' });
    expect(recs[7]!.blocks[0]).toEqual({ kind: 'thinking', text: '', redacted: true });
  });

  it('links tool calls and results by their actual ids', () => {
    const a = analyzeRecords(recs);
    expect(a.toolLinks.get('toolu_demo_001')).toMatchObject({ callRecord: 2, resultRecords: [3], name: 'Read' });
    expect(a.toolLinks.get('toolu_demo_002')).toMatchObject({ callRecord: 4, resultRecords: [5], name: 'Edit' });
    expect(a.cwdValues).toEqual(['C:\\demo\\alpha-project']);
    expect(a.firstTimestamp).toBe('2026-01-05T09:00:00.000Z');
    expect(a.lastTimestamp).toBe('2026-01-05T09:07:00.000Z');
  });

  it('retains the original record next to the display model', () => {
    expect((recs[3]!.raw as { toolUseResult: unknown }).toolUseResult).toEqual({ type: 'text', note: 'fictional extra metadata' });
  });
});

describe('edge-case fixtures', () => {
  it('keeps valid records around malformed and partial lines', () => {
    const recs = load('E--demo-edge-cases/malformed-and-partial.jsonl');
    expect(recs.map((r) => [r.kind, r.line])).toEqual([
      ['human', 1],
      ['malformed', 4],
      ['assistant', 5],
      ['pending', 6],
    ]);
    expect(recs[0]!.blocks[0]).toEqual({ kind: 'text', text: 'שורה ראשונה אחרי BOM' });
  });

  it('labels branching without reordering or removing duplicates', () => {
    const recs = load('E--demo-edge-cases/branching.jsonl');
    expect(recs).toHaveLength(5);
    const a = analyzeRecords(recs);
    expect(a.branchPoints.get('b-1')).toEqual([1, 2]);
    expect(a.branchMembership.get(2)).toMatchObject({ position: 2, total: 2 });
    expect(a.duplicateUuids.get('b-3')).toEqual([3, 4]);
    expect(a.branchPoints.has('b-2b')).toBe(false); // duplicate line is not a branch
  });

  it('handles an empty file', () => {
    expect(parseJsonlText('')).toEqual([]);
  });

  it('marks sidechain records from the nested subagent file', () => {
    const recs = load('C--demo-alpha-project/11111111-demo-4000-8000-000000000001/subagents/agent-demo0001.jsonl');
    expect(recs.every((r) => r.isSidechain)).toBe(true);
    expect(analyzeRecords(recs).sidechainCount).toBe(2);
  });
});

describe('adapters for shapes observed in a real Claude Code file (fictional values)', () => {
  const recs = load('C--demo-alpha-project/22222222-demo-4000-8000-000000000002.jsonl');

  it('classifies observed record types without mislabeling roles', () => {
    expect(recs.map((r) => `${r.kind}/${r.adapter}`)).toEqual([
      'meta/typed-other',
      'meta/typed-other',
      'meta/attachment',
      'meta/attachment',
      'human/message-envelope',
      'meta/typed-other', // api-request-blob carries a "message" but is not a conversation turn
      'assistant/message-envelope',
      'tool-result/message-envelope',
      'assistant/message-envelope',
      'system/system',
      'meta/ai-title',
      'meta/typed-other',
      'meta/typed-other',
    ]);
  });

  it('exposes attachment type, renderedRole and rendered content verbatim', () => {
    expect(recs[2]).toMatchObject({ attachmentType: 'date', renderedRole: 'system' });
    expect(recs[2]!.blocks).toEqual([{ kind: 'text', text: 'Fictional rendered context: today is a demo day.' }]);
    expect(recs[3]).toMatchObject({ attachmentType: 'session_context', blocks: [] });
    expect(recs[3]!.renderedRole).toBeUndefined();
  });

  it('records aiTitle verbatim and links the observed tool call/result', () => {
    const a = analyzeRecords(recs);
    expect(a.aiTitles).toEqual(['כותרת בדויה: יצירת README']);
    expect(a.toolLinks.get('toolu_obs_1')).toMatchObject({ callRecord: 6, resultRecords: [7], name: 'Write' });
    expect(recs[9]).toMatchObject({ subtype: 'turn_duration', blocks: [] });
  });
});
