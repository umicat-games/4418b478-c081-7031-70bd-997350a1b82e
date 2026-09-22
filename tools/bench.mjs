// How deep can it look, how long does that take, and does it play?
import { build } from 'esbuild';
import { pathToFileURL } from 'node:url';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const dir = mkdtempSync(path.join(tmpdir(), 'othello-bench-'));
const out = path.join(dir, 'b.mjs');
await build({ entryPoints: ['tools/bench-entry.ts'], outfile: out, bundle: true, format: 'esm', platform: 'node', logLevel: 'warning' });
const { Othello, search } = await import(pathToFileURL(out).href);
rmSync(dir, { recursive: true, force: true });
const name = (i) => `${'abcdefgh'[i % 8]}${((i / 8) | 0) + 1}`;

console.log('the opening position');
for (const depth of [2, 4, 6, 8]) {
  const g = new Othello();
  const t0 = performance.now();
  const r = search(g, { depth, timeMs: 30000, exactFrom: 0 });
  console.log(`  depth ${depth}: ${name(r.roots[0].move)}  score ${Math.round(r.score)}  ${r.nodes} nodes  ${Math.round(performance.now() - t0)}ms`);
}

console.log('\na game against itself, depth 4');
{
  const g = new Othello();
  const t0 = performance.now();
  const line = [];
  while (!g.over) {
    const r = search(g, { depth: 4, timeMs: 3000, exactFrom: 10 });
    const m = r.roots[0]?.move;
    if (m === undefined) break;
    if (!g.play(m)) { console.log('  ILLEGAL MOVE FROM THE ENGINE'); process.exit(1); }
    line.push(name(m));
  }
  const { black, white } = g.counts();
  console.log(`  ${g.moves.length} moves in ${Math.round(performance.now() - t0)}ms — black ${black}, white ${white}, ${JSON.stringify(g.outcome().kind)}`);
  console.log('  ' + line.slice(0, 20).join(' '));
}

console.log('\nthe exact ending');
{
  // Play down to a dozen empties, then ask for the truth.
  const g = new Othello();
  while (g.empties > 12 && !g.over) {
    const r = search(g, { depth: 2, timeMs: 1000, exactFrom: 0 });
    if (r.roots[0] === undefined) break;
    g.play(r.roots[0].move);
  }
  const t0 = performance.now();
  const r = search(g, { depth: 0, timeMs: 20000, exactFrom: 14 });
  const ms = Math.round(performance.now() - t0);
  console.log(`  ${g.empties} empties: ${r.exact !== undefined ? `solved — ${r.exact > 0 ? 'wins' : r.exact < 0 ? 'loses' : 'draws'} by ${Math.abs(r.exact)} discs` : 'not solved in time'}  (${r.nodes} nodes, ${ms}ms)`);
}
