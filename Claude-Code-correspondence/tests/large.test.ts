import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { JsonlLineParser } from '../src/shared/jsonl';
import { analyzeRecords, normalizeLine, type DisplayRecord } from '../src/shared/normalize';

describe('large fictional file', () => {
  it('parses 30,000 records incrementally and supports full-file search', () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'ccv-large-'));
    try {
      execFileSync(process.execPath, [path.resolve(__dirname, '..', 'scripts', 'gen-large-fixture.mjs'), '30000', dir]);
      const file = path.join(dir, 'large-session.jsonl');
      const bytes = readFileSync(file);
      expect(statSync(file).size).toBeGreaterThan(10 * 1024 * 1024);

      const t0 = performance.now();
      const records: DisplayRecord[] = [];
      const parser = new JsonlLineParser((e) => records.push(normalizeLine(e, records.length)));
      const dec = new TextDecoder('utf-8');
      for (let i = 0; i < bytes.length; i += 256 * 1024) {
        parser.push(dec.decode(bytes.subarray(i, i + 256 * 1024), { stream: true }));
      }
      parser.push(dec.decode());
      parser.finish();
      const parseMs = performance.now() - t0;

      expect(records).toHaveLength(30000);
      expect(records[29999]!.line).toBe(30000);
      expect(records.filter((r) => r.kind === 'malformed' || r.kind === 'pending')).toHaveLength(0);

      const a = analyzeRecords(records);
      expect(a.counts.human).toBe(10000);
      expect(a.counts.assistant).toBe(10000);
      expect(a.counts['tool-result']).toBe(10000);

      // Search over the whole file (records far beyond any rendered page).
      const t1 = performance.now();
      const needle = 'needle-marker';
      const hits = records.filter((r) => r.searchText.includes(needle)).map((r) => r.line);
      const searchMs = performance.now() - t1;
      const expected = [1];
      for (let i = 1; i <= 30000; i++) if (i % 3 === 1 && (i % 997 === 0 || i === 29998)) expected.push(i);
      expect(hits).toEqual(expected);
      expect(hits[hits.length - 1]).toBeGreaterThan(29000);

      console.log(`[large] ${Math.round(bytes.length / 1024 / 1024)} MB parsed in ${Math.round(parseMs)} ms; search ${searchMs.toFixed(1)} ms`);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
