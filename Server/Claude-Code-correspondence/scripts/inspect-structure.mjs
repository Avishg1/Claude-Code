// Read-only STRUCTURE report for one JSONL file chosen by the user.
// Prints only counts, record "type"/"subtype"/"role" values, field NAMES and block types.
// Never prints message text, ids, paths, timestamps or other values.
// Usage: node scripts/inspect-structure.mjs <file.jsonl>
import { readFileSync, statSync } from 'node:fs';
import { JsonlLineParser } from '../src/shared/jsonl.ts';
import { normalizeLine, analyzeRecords } from '../src/shared/normalize.ts';

const file = process.argv[2];
const st = statSync(file);
const bytes = readFileSync(file); // read-only
const inc = (m, k, n = 1) => m.set(k, (m.get(k) ?? 0) + n);
const safeKey = (k) => (/[\/:]/.test(k) || k.length > 40 ? '<non-field-key>' : k);
const keysOf = (o) => (o && typeof o === 'object' && !Array.isArray(o) ? Object.keys(o).map(safeKey).sort().join(',') : typeof o);
const enumVal = (v) => (typeof v === 'string' && /^[a-z_-]{1,40}$/i.test(v) ? v : `<${typeof v}>`);

const recordShapes = new Map(), messageKeys = new Map(), blockShapes = new Map(), toolResultKeys = new Map(),
  contentForms = new Map(), kinds = new Map(), adapters = new Map(), unknownBlockTypes = new Map(), subtypes = new Map(),
  nestedResultBlocks = new Map();
const records = [];
const parser = new JsonlLineParser((e) => {
  const r = normalizeLine(e, records.length);
  records.push(r);
  inc(kinds, r.kind);
  inc(adapters, r.adapter);
  if (e.kind !== 'ok') return;
  const v = e.value;
  const t = v && typeof v === 'object' ? enumVal(v.type) : '<non-object>';
  inc(recordShapes, `type=${t} :: ${keysOf(v)}`);
  if (v?.subtype !== undefined) inc(subtypes, `${t}/${enumVal(v.subtype)}`);
  if (v?.message && typeof v.message === 'object') {
    inc(messageKeys, `type=${t} role=${enumVal(v.message.role)} :: ${keysOf(v.message)}`);
    const c = v.message.content;
    inc(contentForms, `type=${t} content=${Array.isArray(c) ? 'array' : c === undefined ? 'absent' : typeof c}`);
    if (Array.isArray(c)) for (const b of c) {
      inc(blockShapes, `${enumVal(b?.type)} :: ${keysOf(b)}`);
      if (b?.type === 'tool_result' && Array.isArray(b.content)) for (const nb of b.content) inc(nestedResultBlocks, `${enumVal(nb?.type)} :: ${keysOf(nb)}`);
      if (b?.type === 'tool_result') inc(nestedResultBlocks, `(tool_result.content form: ${Array.isArray(b.content) ? 'array' : typeof b.content})`);
    }
  }
  if (v?.toolUseResult !== undefined) inc(toolResultKeys, keysOf(v.toolUseResult));
  for (const b of r.blocks) if (b.kind === 'unknown') inc(unknownBlockTypes, String(b.type));
});
const dec = new TextDecoder('utf-8');
parser.push(dec.decode(bytes));
parser.finish();
const a = analyzeRecords(records);

const show = (title, m) => {
  console.log(`\n## ${title}`);
  [...m.entries()].sort((x, y) => y[1] - x[1]).forEach(([k, n]) => console.log(`${String(n).padStart(6)}  ${k}`));
};
console.log(`size=${st.size} bytes, physical lines=${parser.physicalLines}, records=${records.length}, BOM=${bytes[0] === 0xef}`);
show('parser classification (kind)', kinds);
show('adapter used', adapters);
show('record type + top-level field names', recordShapes);
show('system/other subtypes', subtypes);
show('message field names', messageKeys);
show('message.content form', contentForms);
show('content block type + field names', blockShapes);
show('tool_result inner content', nestedResultBlocks);
show('toolUseResult field names', toolResultKeys);
show('blocks the parser treated as unknown', unknownBlockTypes);
console.log(`\n## analysis\nbranchPoints=${a.branchPoints.size} duplicateUuids=${a.duplicateUuids.size} sidechain=${a.sidechainCount} toolLinks=${a.toolLinks.size} unmatchedCalls=${[...a.toolLinks.values()].filter((l) => l.resultRecords.length === 0).length} orphanResults=${[...a.toolLinks.values()].filter((l) => l.callRecord < 0).length} cwdDistinct=${a.cwdValues.length} sessions=${a.sessionIds.length} hasTimestamps=${!!a.firstTimestamp}`);
