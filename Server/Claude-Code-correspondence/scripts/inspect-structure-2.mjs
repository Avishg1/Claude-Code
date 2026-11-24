// Second STRUCTURE-only probe (same approved file): shapes of attachment / ai-title / api-request-blob records.
// Prints field names, value TYPES, enum-like short values and string LENGTHS only. Never text content.
import { readFileSync } from 'node:fs';
const lines = readFileSync(process.argv[2], 'utf8').split('\n').filter((l) => l.trim());
const enumVal = (v) => (typeof v === 'string' && /^[a-z_-]{1,40}$/i.test(v) ? v : `<${Array.isArray(v) ? 'array' : typeof v}>`);
const safeKey = (k) => (/[\/:]/.test(k) || k.length > 40 ? '<non-field-key>' : k);
const keys = (o) => (o && typeof o === 'object' && !Array.isArray(o) ? Object.keys(o).map(safeKey).sort().join(',') : `<${typeof o}>`);
const out = new Map();
const inc = (k) => out.set(k, (out.get(k) ?? 0) + 1);
for (const l of lines) {
  let v; try { v = JSON.parse(l); } catch { continue; }
  if (v.type === 'attachment') {
    const a = v.attachment;
    inc(`attachment: attachment.type=${enumVal(a?.type)} attachment keys=[${keys(a)}] rendered=${Array.isArray(v.rendered) ? 'array' : typeof v.rendered} renderedRole=${enumVal(v.renderedRole)}`);
    if (Array.isArray(v.rendered)) for (const b of v.rendered) inc(`  rendered[] item: type=${enumVal(b?.type)} keys=[${keys(b)}]`);
    if (typeof v.rendered === 'string') inc(`  rendered string length bucket=${v.rendered.length < 200 ? '<200' : v.rendered.length < 2000 ? '<2000' : '>=2000'}`);
  } else if (v.type === 'ai-title') inc(`ai-title: aiTitle=${typeof v.aiTitle} length=${String(v.aiTitle ?? '').length}`);
  else if (v.type === 'last-prompt') inc(`last-prompt: lastPrompt=${typeof v.lastPrompt}`);
  else if (v.type === 'api-request-blob') {
    const c = v.message?.content;
    if (Array.isArray(c)) for (const b of c) inc(`api-request-blob role=${enumVal(v.message?.role)} block type=${enumVal(b?.type)} keys=[${keys(b)}]`);
  } else if (v.type === 'system') inc(`system subtype=${enumVal(v.subtype)} has content=${'content' in v} isMeta=${v.isMeta}`);
}
[...out.entries()].forEach(([k, n]) => console.log(`${String(n).padStart(4)}  ${k}`));
