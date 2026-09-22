// How deep can it look, how long does that take, and does it actually play?
// Run before touching the search and after — "it feels stronger" is not a
// measurement.
import { build } from 'esbuild';
import { pathToFileURL } from 'node:url';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const dir = mkdtempSync(path.join(tmpdir(), 'gomoku-bench-'));
const out = path.join(dir, 'b.mjs');
await build({ entryPoints: ['tools/bench-entry.ts'], outfile: out, bundle: true, format: 'esm', platform: 'node', logLevel: 'warning' });
const { Gomoku, search, BLACK, WHITE } = await import(pathToFileURL(out).href);
rmSync(dir, { recursive: true, force: true });

const name = (g, i) => `${'ABCDEFGHIJKLMNO'[g.xOf(i)]}${g.size - g.yOf(i)}`;

console.log('from a few stones in the middle');
{
  for (const [depth, width] of [[2, 8], [4, 10], [6, 12]]) {
    const g = new Gomoku(15);
    for (const [x, y] of [[7, 7], [8, 8], [8, 7], [6, 8], [7, 6]]) g.play(g.idx(x, y));
    const t0 = performance.now();
    const r = search(g, { depth, timeMs: 30000, width });
    console.log(`  depth ${depth} width ${width}: ${name(g, r.roots[0].move)}  score ${Math.round(r.score)}  ${r.nodes} nodes  ${Math.round(performance.now() - t0)}ms`);
  }
}

console.log('\ndoes it see the things it must see');
{
  // Four in a row with both ends open: it has to finish, not defend.
  const g = Gomoku.fromRows([
    '...............', '...............', '...............', '...............',
    '...............', '.....xxxx......', '...............', '...............',
    '...............', '...............', '...............', '...............',
    '...............', '...............', '...............',
  ], BLACK);
  const r = search(g, { depth: 4, timeMs: 5000, width: 10 });
  console.log(`  black to play on an open four → ${name(g, r.roots[0].move)} (${r.decided === 1 ? 'won' : 'NOT SEEN'})`);
}
{
  // White has four; Black must block, not build.
  const g = Gomoku.fromRows([
    '...............', '...............', '...............', '...............',
    '...............', '.....oooo......', '...xxx.........', '...............',
    '...............', '...............', '...............', '...............',
    '...............', '...............', '...............',
  ], BLACK);
  const r = search(g, { depth: 4, timeMs: 5000, width: 10 });
  const at = name(g, r.roots[0].move);
  console.log(`  black to play against a white four → ${at} (${at === 'J10' || at === 'E10' ? 'blocked' : 'NOT BLOCKED'})`);
}

console.log('\na game against itself, depth 4, up to 120 plies');
{
  const g = new Gomoku(15);
  const t0 = performance.now();
  const line = [];
  while (!g.over && g.moves.length < 120) {
    const r = search(g, { depth: 4, timeMs: 3000, width: 10 });
    const m = r.roots[0]?.move;
    if (m === undefined) break;
    if (!g.play(m)) { console.log('  ILLEGAL MOVE FROM THE ENGINE'); process.exit(1); }
    line.push(name(g, m));
  }
  const ms = Math.round(performance.now() - t0);
  console.log(`  ${g.moves.length} plies in ${ms}ms (${Math.round(ms / Math.max(1, g.moves.length))}ms/move) — ${JSON.stringify(g.outcome().kind)}`);
  console.log('  ' + line.slice(0, 20).join(' '));
}

console.log('\nthe assistant asks the expensive question');
{
  // How long `threats()` takes on a board with something on it — it runs once
  // per message the assistant answers, so tens of milliseconds is fine and
  // seconds is not.
  const g = new Gomoku(15);
  for (let i = 0; i < 40; i++) {
    const r = search(g, { depth: 2, timeMs: 500, width: 8 });
    if (!g.play(r.roots[0].move)) break;
    if (g.over) break;
  }
  for (const who of [BLACK, WHITE]) {
    const t0 = performance.now();
    const t = g.threats(who);
    console.log(`  ${who === BLACK ? 'black' : 'white'}: win ${t.win.length}, open four ${t.openFour.length}, open three ${t.openThree.length} — ${Math.round(performance.now() - t0)}ms on a ${g.moves.length}-stone board`);
  }
}
