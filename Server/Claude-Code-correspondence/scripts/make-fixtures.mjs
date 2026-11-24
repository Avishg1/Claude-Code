// Writes the FICTIONAL fixture projects used by tests and the demo.
// All names, paths, ids and texts below are invented. No real data is involved.
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', 'fixtures', 'projects');

const P1 = path.join(root, 'C--demo-alpha-project');
const P2 = path.join(root, 'D--demo-empty-project');
const P3 = path.join(root, 'E--demo-edge-cases');

for (const p of [P1, P2, P3]) rmSync(p, { recursive: true, force: true });
for (const p of [P1, P2, P3]) mkdirSync(p, { recursive: true });
writeFileSync(path.join(P2, '.gitkeep'), '', 'utf8'); // empty project: no .jsonl files

const j = (o) => JSON.stringify(o);
const SESSION = '00000000-demo-4000-8000-00000000a001';
const CWD = 'C:\\demo\\alpha-project';
let n = 0;
const uid = () => `u-${String(++n).padStart(4, '0')}`;
const ts = (min) => new Date(Date.UTC(2026, 0, 5, 9, min, 0)).toISOString();

// ---------------------------------------------------------------- main conversation
{
  const u1 = uid(), a1 = uid(), a2 = uid(), t1 = uid(), a3 = uid(), u2 = uid(), a4 = uid(), s1 = uid(), u3 = uid();
  const lines = [
    j({ type: 'summary', summary: 'שיחת הדגמה: תיקון פונקציית מיון (Demo sort fix)', leafUuid: a4 }),
    j({
      type: 'user', uuid: u1, parentUuid: null, sessionId: SESSION, cwd: CWD, timestamp: ts(0), version: '0.0.0-demo',
      message: { role: 'user', content: 'שלום! יש לי באג בפונקציה `sortItems` בקובץ src/sort.ts.\nהיא מחזירה סדר הפוך.\n\nCan you take a look?' },
    }),
    j({
      type: 'assistant', uuid: a1, parentUuid: u1, sessionId: SESSION, cwd: CWD, timestamp: ts(1),
      message: {
        role: 'assistant', model: 'demo-model-1',
        content: [
          { type: 'thinking', thinking: 'Fictional reasoning text stored in the fixture: check the comparator first.' },
          { type: 'text', text: 'בטח. אקרא קודם את הקובץ.' },
          { type: 'tool_use', id: 'toolu_demo_001', name: 'Read', input: { file_path: 'C:\\demo\\alpha-project\\src\\sort.ts' } },
        ],
      },
    }),
    j({
      type: 'user', uuid: t1, parentUuid: a1, sessionId: SESSION, cwd: CWD, timestamp: ts(2),
      message: {
        role: 'user',
        content: [
          {
            type: 'tool_result', tool_use_id: 'toolu_demo_001',
            content: 'export function sortItems(a: number[]) {\n  return [...a].sort((x, y) => y - x); // a very long line that keeps going and going to test horizontal scrolling inside the tool output box without widening the page at all\n}',
          },
        ],
      },
      toolUseResult: { type: 'text', note: 'fictional extra metadata' },
    }),
    j({
      type: 'assistant', uuid: a2, parentUuid: t1, sessionId: SESSION, cwd: CWD, timestamp: ts(3),
      message: {
        role: 'assistant', model: 'demo-model-1',
        content: [
          {
            type: 'text',
            text:
              '## מצאתי את הבעיה\n\nה-comparator הפוך. **התיקון**:\n\n```ts\nexport function sortItems(a: number[]) {\n  return [...a].sort((x, y) => x - y);\n}\n```\n\nרשימת בדיקות:\n1. מערך ריק\n2. מספרים שליליים — negative numbers\n3. ערכים כפולים\n\n> הערה: זהו טקסט בדוי לצורך הדגמה.\n\n| מקרה | Expected |\n|---|---|\n| [] | [] |\n| [3,1,2] | [1,2,3] |\n\nקישור לדוגמה: [Example](https://example.com/docs)',
          },
          { type: 'tool_use', id: 'toolu_demo_002', name: 'Edit', input: { file_path: 'src/sort.ts', old_string: 'y - x', new_string: 'x - y' } },
        ],
      },
    }),
    j({
      type: 'user', uuid: a3, parentUuid: a2, sessionId: SESSION, cwd: CWD, timestamp: ts(4),
      message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_demo_002', is_error: true, content: [{ type: 'text', text: 'Error: fictional permission denied' }] }] },
    }),
    j({
      type: 'user', uuid: u2, parentUuid: a3, sessionId: SESSION, cwd: CWD, timestamp: ts(5),
      message: {
        role: 'user',
        content: [
          { type: 'text', text: 'הנה צילום מסך (בדוי):' },
          { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==' } },
          { type: 'future_block_type', payload: { anything: [1, 2, 3] } },
        ],
      },
    }),
    j({
      type: 'assistant', uuid: a4, parentUuid: u2, sessionId: SESSION, cwd: CWD, timestamp: ts(6),
      message: { role: 'assistant', model: 'demo-model-1', content: [{ type: 'redacted_thinking', data: 'ZmljdGlvbmFs' }, { type: 'text', text: 'Thanks — the screenshot confirms the order is fixed.\nשורה שנייה באותה פסקה.\n\nפסקה שלישית.' }] },
    }),
    j({ type: 'system', subtype: 'informational', uuid: s1, parentUuid: a4, timestamp: ts(7), content: 'Fictional system notice: context compacted.', level: 'info' }),
    j({ type: 'file-history-snapshot', messageId: 'm-demo-1', snapshot: { trackedFileBackups: {}, timestamp: ts(7) } }),
    j({ type: 'user', uuid: u3, parentUuid: s1, isMeta: true, message: { role: 'user', content: 'Fictional meta message without timestamp.' } }),
    j({ type: 'assistant', message: { role: 'assistant' } }), // missing content + missing ids/timestamp
    j({ some: 'record', without: 'type field' }),
    j(['an', 'array', 'record']),
  ];
  writeFileSync(path.join(P1, '11111111-demo-4000-8000-000000000001.jsonl'), lines.join('\n') + '\n', 'utf8');
}

// ---------------------------------------------------------------- nested subagent file
{
  const dir = path.join(P1, '11111111-demo-4000-8000-000000000001', 'subagents');
  mkdirSync(dir, { recursive: true });
  const lines = [
    j({ type: 'user', uuid: 'sa-1', parentUuid: null, isSidechain: true, timestamp: ts(10), message: { role: 'user', content: 'Subagent task (fictional): list files.' } }),
    j({ type: 'assistant', uuid: 'sa-2', parentUuid: 'sa-1', isSidechain: true, timestamp: ts(11), message: { role: 'assistant', content: [{ type: 'text', text: 'Found 3 fictional files.' }] } }),
  ];
  writeFileSync(path.join(dir, 'agent-demo0001.jsonl'), lines.join('\n') + '\n', 'utf8');
  writeFileSync(path.join(P1, 'notes.txt'), 'not a jsonl file; must not be listed\n', 'utf8');
}

// ---------------------------------------------------------------- edge cases project
{
  // BOM + CRLF + blank lines + malformed middle line + incomplete final line
  const body =
    '\uFEFF' +
    j({ type: 'user', uuid: 'e-1', parentUuid: null, timestamp: ts(20), message: { role: 'user', content: 'שורה ראשונה אחרי BOM' } }) + '\r\n' +
    '\r\n' +
    '   \n' +
    '{"type":"assistant","uuid":"e-2", this is not json}\n' +
    j({ type: 'assistant', uuid: 'e-3', parentUuid: 'e-1', timestamp: ts(21), message: { role: 'assistant', content: 'Valid line after a malformed one. 😀 אמוג׳י ויוניקוד: ﷺ ‏ä ñ 漢字' } }) + '\n' +
    '{"type":"user","uuid":"e-4","message":{"role":"user","content":"partial wri';
  writeFileSync(path.join(P3, 'malformed-and-partial.jsonl'), body, 'utf8');

  // Branching: e-root has two different children; one child line is repeated verbatim.
  const b = [
    j({ type: 'user', uuid: 'b-1', parentUuid: null, timestamp: ts(30), message: { role: 'user', content: 'Branch root question' } }),
    j({ type: 'assistant', uuid: 'b-2a', parentUuid: 'b-1', timestamp: ts(31), message: { role: 'assistant', content: 'First answer (branch A)' } }),
    j({ type: 'assistant', uuid: 'b-2b', parentUuid: 'b-1', timestamp: ts(32), message: { role: 'assistant', content: 'Regenerated answer (branch B)' } }),
    j({ type: 'user', uuid: 'b-3', parentUuid: 'b-2b', timestamp: ts(33), message: { role: 'user', content: 'Follow-up on branch B' } }),
    j({ type: 'user', uuid: 'b-3', parentUuid: 'b-2b', timestamp: ts(33), message: { role: 'user', content: 'Follow-up on branch B' } }),
  ];
  writeFileSync(path.join(P3, 'branching.jsonl'), b.join('\n') + '\n', 'utf8');

  // Hostile markdown: everything here must stay inert.
  const hostile = [
    '<script>window.__pwned = 1</script>',
    '<img src="https://evil.example/x.png" onerror="window.__pwned = 2">',
    '[click js](javascript:window.__pwned=3)',
    '[click JS upper](JAVASCRIPT:window.__pwned=4)',
    '[data link](data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==)',
    '[vb](vbscript:msgbox(1))',
    '[file](file:///C:/Windows/win.ini)',
    '[relative](../../etc/passwd)',
    '<javascript:window.__pwned=5>',
    '![remote image](https://evil.example/track.png)',
    '<iframe src="https://evil.example"></iframe>',
    '<a href="https://evil.example" onclick="window.__pwned=6">html anchor</a>',
    '[safe link](https://example.org/page?q=1)',
    '```html\n<script>window.__pwned = 7</script>\n```',
  ].join('\n\n');
  writeFileSync(
    path.join(P3, 'hostile-markdown.jsonl'),
    [
      j({ type: 'user', uuid: 'h-1', parentUuid: null, timestamp: ts(40), message: { role: 'user', content: hostile } }),
      j({ type: 'assistant', uuid: 'h-2', parentUuid: 'h-1', timestamp: ts(41), message: { role: 'assistant', content: [{ type: 'text', text: hostile }] } }),
    ].join('\n') + '\n',
    'utf8',
  );

  writeFileSync(path.join(P3, 'empty.jsonl'), '', 'utf8');
}

// ---------------------------------------------------------------- shapes observed in a real file (values are invented)
{
  const S = '00000000-demo-4000-8000-00000000b002';
  const env = { cwd: 'C:\\demo\\alpha-project', entrypoint: 'cli', gitBranch: 'main', isSidechain: false, sessionId: S, userType: 'external', version: '0.0.0-demo' };
  const lines = [
    j({ type: 'mode', mode: 'normal', sessionId: S }),
    j({ type: 'permission-mode', permissionMode: 'default', sessionId: S }),
    j({ type: 'attachment', uuid: 'o-1', parentUuid: null, timestamp: ts(50), ...env, attachment: { type: 'date', date: '2026-01-05' }, rendered: [{ content: 'Fictional rendered context: today is a demo day.' }], renderedRole: 'system' }),
    j({ type: 'attachment', uuid: 'o-2', parentUuid: 'o-1', timestamp: ts(50), ...env, attachment: { type: 'session_context', context: { demo: true } } }),
    j({ type: 'user', uuid: 'o-3', parentUuid: 'o-2', timestamp: ts(51), ...env, promptId: 'p-demo', message: { role: 'user', content: 'בקשה בדויה: צור קובץ README קצר.' } }),
    j({ type: 'api-request-blob', hash: 'h-demo', sessionId: S, message: { role: 'user', content: [{ type: 'text', text: 'Fictional request copy' }] } }),
    j({ type: 'assistant', uuid: 'o-4', parentUuid: 'o-3', timestamp: ts(52), ...env, requestId: 'req-demo', message: { id: 'msg-demo', type: 'message', role: 'assistant', model: 'demo-model-2', content: [{ type: 'tool_use', id: 'toolu_obs_1', name: 'Write', input: { file_path: 'README.md', content: '# Demo' }, caller: { type: 'direct' } }], stop_reason: 'tool_use', usage: { input_tokens: 1, output_tokens: 1 } } }),
    j({ type: 'user', uuid: 'o-5', parentUuid: 'o-4', timestamp: ts(53), ...env, sourceToolAssistantUUID: 'o-4', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_obs_1', content: 'File created successfully (fictional)' }] }, toolUseResult: { type: 'create', filePath: 'README.md', content: '# Demo', structuredPatch: [], originalFile: null, userModified: false } }),
    j({ type: 'assistant', uuid: 'o-6', parentUuid: 'o-5', timestamp: ts(54), ...env, message: { id: 'msg-demo-2', type: 'message', role: 'assistant', model: 'demo-model-2', content: [{ type: 'text', text: 'יצרתי את הקובץ. Done.' }] } }),
    j({ type: 'system', subtype: 'turn_duration', durationMs: 1234, messageCount: 4, isMeta: false, uuid: 'o-7', parentUuid: 'o-6', timestamp: ts(55), ...env }),
    j({ type: 'ai-title', aiTitle: 'כותרת בדויה: יצירת README', sessionId: S }),
    j({ type: 'last-prompt', lastPrompt: 'Fictional last prompt', leafUuid: 'o-6', sessionId: S }),
    j({ type: 'cost-state', sessionId: S, totalCostUSD: 0, modelUsage: {} }),
  ];
  writeFileSync(path.join(P1, '22222222-demo-4000-8000-000000000002.jsonl'), lines.join('\n') + '\n', 'utf8');
}

console.log('Fictional fixtures written to', root);
