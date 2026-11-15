// Starts the viewer against the FICTIONAL fixtures (never against real data).
import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const app = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fixtures = path.join(app, 'fixtures', 'projects');
spawnSync(process.execPath, [path.join(app, 'scripts', 'make-fixtures.mjs')], { stdio: 'inherit' });
if (!existsSync(path.join(fixtures, 'large-demo-project', 'large-session.jsonl'))) {
  spawnSync(process.execPath, [path.join(app, 'scripts', 'gen-large-fixture.mjs')], { stdio: 'inherit' });
}
const child = spawn(process.execPath, [path.join(app, 'dist', 'server', 'index.js')], {
  stdio: 'inherit',
  env: { ...process.env, CCV_ROOT: fixtures },
});
child.on('exit', (code) => process.exit(code ?? 0));
