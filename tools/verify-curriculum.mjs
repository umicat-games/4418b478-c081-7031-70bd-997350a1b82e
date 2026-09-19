// Bundle the lesson checker for node and run it. The curriculum is plain
// TypeScript with no DOM in it, which is the point: the exercises can be
// proved solvable without a browser, a canvas or an engine.
import { build } from 'esbuild';
import { pathToFileURL } from 'node:url';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const dir = mkdtempSync(path.join(tmpdir(), 'go-verify-'));
const out = path.join(dir, 'verify.mjs');
await build({
  entryPoints: ['src/teach/verify.ts'],
  outfile: out,
  bundle: true,
  format: 'esm',
  platform: 'node',
  logLevel: 'warning',
});
const { verify, report } = await import(pathToFileURL(out).href);

const rows = report();
const pad = (s, n) => String(s).padEnd(n);
console.log(`${pad('lesson', 12)}${pad('phase', 10)}${pad('goal', 10)}${pad('solutions', 11)}legal`);
for (const r of rows) {
  console.log(`${pad(r.lesson, 12)}${pad(r.phase, 10)}${pad(r.problem, 10)}${pad(r.solutions, 11)}${r.legal}${r.error ? '  ← ' + r.error : ''}`);
}

const bad = verify();
rmSync(dir, { recursive: true, force: true });
if (bad.length) {
  console.error(`\n${bad.length} broken exercise(s):`);
  for (const b of bad) console.error(`  ${b.lesson}/${b.phase}[${b.index}] — ${b.error}`);
  process.exit(1);
}
console.log('\nevery exercise is solvable, and no quiz passes on anything.');
