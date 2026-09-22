// The rules' own test.
//
// Perft walks the entire move tree to a depth and counts the leaves. It is a
// blunt instrument and that is its virtue: if a flip runs one square too far,
// stops one square short, ignores a direction, or accepts a move that turns
// nothing over, the count changes — and no amount of plausible-looking code
// hides it.
//
// The expected numbers are the published ones for the Othello opening
// position, the set every engine checks against.
import { build } from 'esbuild';
import { pathToFileURL } from 'node:url';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const dir = mkdtempSync(path.join(tmpdir(), 'othello-perft-'));
const out = path.join(dir, 'rules.mjs');
await build({ entryPoints: ['src/game/rules.ts'], outfile: out, bundle: true, format: 'esm', platform: 'node', logLevel: 'warning' });
const { Othello, perft } = await import(pathToFileURL(out).href);
rmSync(dir, { recursive: true, force: true });

const EXPECTED = [1, 4, 12, 56, 244, 1396, 8200, 55092, 390216, 3005288];
const depth = Number(process.argv[2] ?? 8);

let bad = 0;
for (let d = 1; d <= depth; d++) {
  const g = new Othello();
  const t0 = performance.now();
  const n = perft(g, d);
  const ms = Math.round(performance.now() - t0);
  const want = EXPECTED[d];
  const ok = want === undefined ? '?' : n === want ? 'ok' : `WRONG, expected ${want}`;
  if (want !== undefined && n !== want) bad++;
  console.log(`perft(${d}) = ${String(n).padStart(9)}   ${String(ms).padStart(6)}ms   ${ok}`);
}
process.exit(bad ? 1 : 0);
