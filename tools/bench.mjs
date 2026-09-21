// How deep can it look, and how long does that take? Run before touching the
// search, and after — "it feels faster" is not a measurement.
import { build } from 'esbuild';
import { pathToFileURL } from 'node:url';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const dir = mkdtempSync(path.join(tmpdir(), 'xq-bench-'));
const out = path.join(dir, 'b.mjs');
await build({ entryPoints: ['tools/bench-entry.ts'], outfile: out, bundle: true, format: 'esm', platform: 'node', logLevel: 'warning' });
const { Position, search, moveFrom, moveTo, XiangqiGame } = await import(pathToFileURL(out).href);
rmSync(dir, { recursive: true, force: true });

const FILES = 'abcdefghi';
const name = (s) => `${FILES[s % 9]}${9 - ((s / 9) | 0)}`;
const show = (m) => `${name(moveFrom(m))}${name(moveTo(m))}`;

console.log('opening position');
for (const depth of [2, 3, 4, 5, 6]) {
  const pos = Position.start();
  const t0 = performance.now();
  const r = search(pos, { depth, timeMs: 30000 });
  const ms = Math.round(performance.now() - t0);
  console.log(`  depth ${depth}: ${show(r.roots[0].move)}  score ${r.score}  ${r.nodes} nodes  ${ms}ms`);
}

console.log('\na game against itself, depth 3, 80 plies');
const g = new XiangqiGame();
const t0 = performance.now();
let plies = 0;
const line = [];
while (!g.over && plies < 80) {
  const r = search(g.position, { depth: 3, timeMs: 3000 });
  const m = r.roots[0]?.move;
  if (m === undefined) break;
  if (g.play(moveFrom(m), moveTo(m)) === null) { console.log('  ILLEGAL MOVE FROM THE ENGINE:', show(m)); process.exit(1); }
  line.push(show(m));
  plies++;
}
const ms = Math.round(performance.now() - t0);
console.log(`  ${plies} plies in ${ms}ms (${Math.round(ms / Math.max(1, plies))}ms/move) — ${JSON.stringify(g.outcome())}`);
console.log('  ' + line.slice(0, 24).join(' '));
console.log('  captured by red:', g.captured[0].length, ' by black:', g.captured[1].length);
