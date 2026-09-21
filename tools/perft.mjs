// The rules' own test.
//
// Perft walks the entire move tree to a depth and counts the leaves. It is a
// blunt instrument and that is its virtue: a single rule implemented wrongly —
// a horse that ignores its leg, an elephant that crosses the river, a king
// that may step onto the open file facing the other one — changes the count,
// and no amount of plausible-looking code hides it.
//
// The expected numbers are the published ones for the xiangqi opening
// position, the same set every serious engine checks against.
import { build } from 'esbuild';
import { pathToFileURL } from 'node:url';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const dir = mkdtempSync(path.join(tmpdir(), 'xq-perft-'));
const out = path.join(dir, 'rules.mjs');
await build({ entryPoints: ['src/xiangqi/rules.ts'], outfile: out, bundle: true, format: 'esm', platform: 'node', logLevel: 'warning' });
const rules = await import(pathToFileURL(out).href);
rmSync(dir, { recursive: true, force: true });

const EXPECTED = [1, 44, 1920, 79666, 3290240, 133312995];
const depth = Number(process.argv[2] ?? 4);

let bad = 0;
for (let d = 1; d <= depth; d++) {
  const pos = rules.Position.start();
  const t0 = performance.now();
  const n = rules.perft(pos, d);
  const ms = Math.round(performance.now() - t0);
  const want = EXPECTED[d];
  const ok = want === undefined ? '?' : n === want ? 'ok' : `WRONG, expected ${want}`;
  if (want !== undefined && n !== want) bad++;
  console.log(`perft(${d}) = ${String(n).padStart(9)}   ${String(ms).padStart(6)}ms   ${ok}`);
}
process.exit(bad ? 1 : 0);
