// Generates a large FICTIONAL conversation for scrolling/search/perf checks.
// Usage: node scripts/gen-large-fixture.mjs [recordCount] [outDir]
import { mkdirSync, createWriteStream } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const count = Number(process.argv[2] ?? 30000);
const outDir = path.resolve(process.argv[3] ?? path.join(here, '..', 'fixtures', 'projects', 'large-demo-project'));
mkdirSync(outDir, { recursive: true });
const file = path.join(outDir, 'large-session.jsonl');
const out = createWriteStream(file, 'utf8');

const filler =
  'זהו טקסט בדוי שנועד לבדיקת ביצועים. Lorem ipsum dolor sit amet, consectetur adipiscing elit. ' +
  'עוד משפט בעברית עם `inline code` ו-**הדגשה**.';
let prev = null;
for (let i = 1; i <= count; i++) {
  const uuid = `L-${i}`;
  const timestamp = new Date(Date.UTC(2026, 1, 1, 0, 0, i)).toISOString();
  let rec;
  if (i % 3 === 1) {
    const marker = i % 997 === 0 || i === 1 || i === count - 2 ? ' NEEDLE-MARKER' : '';
    rec = { type: 'user', uuid, parentUuid: prev, timestamp, message: { role: 'user', content: `שאלה מספר ${i}.${marker} ${filler}` } };
  } else if (i % 3 === 2) {
    rec = {
      type: 'assistant', uuid, parentUuid: prev, timestamp,
      message: {
        role: 'assistant',
        content: [
          { type: 'text', text: `תשובה מספר ${i}. ${filler}\n\n\`\`\`js\nconsole.log(${i});\n\`\`\`` },
          { type: 'tool_use', id: `toolu_L${i}`, name: 'Bash', input: { command: `echo fictional-${i}` } },
        ],
      },
    };
  } else {
    rec = { type: 'user', uuid, parentUuid: prev, timestamp, message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: `toolu_L${i - 1}`, content: `fictional-${i - 1}\n${filler}` }] } };
  }
  out.write(JSON.stringify(rec) + '\n');
  prev = uuid;
}
out.end(() => console.log(`Wrote ${count} fictional records to ${file}`));
