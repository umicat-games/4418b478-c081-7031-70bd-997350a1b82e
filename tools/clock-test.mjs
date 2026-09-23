// The two clocks, which are arithmetic and therefore testable without a room.
//
// Worth testing because nothing about them is observable until somebody loses
// a game to one: the numbers on the seats are derived from a stamp and a
// duration, and the only way to know the derivation is right is to do it with
// times you chose.
import { build } from 'esbuild';
import { pathToFileURL } from 'node:url';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const dir = mkdtempSync(path.join(tmpdir(), 'gomoku-clock-'));
const out = path.join(dir, 'clock.mjs');
await build({ entryPoints: ['src/shell/net/clock.ts'], outfile: out, bundle: true, format: 'esm', platform: 'node', logLevel: 'warning' });
const C = await import(pathToFileURL(out).href);
rmSync(dir, { recursive: true, force: true });

let failures = 0;
const check = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failures++;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${ok ? '' : `\n         got ${JSON.stringify(got)}\n        want ${JSON.stringify(want)}`}`);
};

const T0 = 1_000_000;                      // a stamp; any stamp
const inc = { mainMs: 60_000, incrementMs: 5_000 };
const byo = { mainMs: 60_000, byoyomi: { periodMs: 30_000, periods: 3 } };

console.log('an increment');
{
  const s = { moves: [], ...C.freshClock(T0, inc) };
  check('both sides start full', [s.clock[0], s.clock[1]], [60_000, 60_000]);
  check('the side to move is the only one spending',
    [C.left(s, 0, 0, T0 + 10_000).ms, C.left(s, 1, 0, T0 + 10_000).ms], [50_000, 60_000]);

  const after = { ...s, ...C.afterMove(s, 0, T0 + 10_000) };
  check('a ten-second move costs ten and gives five back', after.clock[0], 55_000);
  check('and the stamp moves to the new turn', after.at, T0 + 10_000);
  check('the other side is untouched', after.clock[1], 60_000);

  check('nothing left is nothing left', C.left(s, 0, 0, T0 + 61_000).out, true);
  check('a finished game spends nothing',
    C.left({ ...s, end: { kind: 'resign' } }, 0, 0, T0 + 99_000).ms, 60_000);
}

console.log('byo-yomi');
{
  const s = { moves: [], ...C.freshClock(T0, byo) };
  check('three periods to start', s.periods, [3, 3]);
  check('inside the main time it is the main time',
    C.left(s, 0, 0, T0 + 10_000), { ms: 50_000, kind: 'main', periods: 3, out: false });

  // Ten seconds past the hour: into the first period, twenty left on it.
  check('past the bank, the first period is running',
    C.left(s, 0, 0, T0 + 70_000), { ms: 20_000, kind: 'period', periods: 3, out: false });
  check('a whole period gone leaves two',
    C.left(s, 0, 0, T0 + 95_000), { ms: 25_000, kind: 'period', periods: 2, out: false });
  check('three whole periods is out of time', C.left(s, 0, 0, T0 + 151_000).out, true);

  // THE point of byo-yomi: moving inside a period keeps it.
  const kept = { ...s, ...C.afterMove(s, 0, T0 + 70_000) };
  check('moving inside a period spends the bank but keeps the period',
    [kept.clock[0], kept.periods[0]], [0, 3]);
  const spent = { ...s, ...C.afterMove(s, 0, T0 + 100_000) };
  check('running through one leaves two', spent.periods[0], 2);
  check('and the next move starts a fresh period',
    C.left(spent, 0, 0, spent.at + 10_000), { ms: 20_000, kind: 'period', periods: 2, out: false });
}

console.log('the flag, and the grace it is claimed with');
{
  const s = { moves: [], ...C.freshClock(T0, inc) };
  check('not flagged a moment before', C.flagged(s, 0, T0 + 59_000), false);
  check('nor in the two seconds after — the machines disagree about now',
    C.flagged(s, 0, T0 + 61_000), false);
  check('and flagged once that is past', C.flagged(s, 0, T0 + 63_000), true);
  check('never flagged after the game ended',
    C.flagged({ ...s, end: { kind: 'draw' } }, 0, T0 + 999_000), false);
}

console.log('what a seat shows');
{
  check('minutes and seconds', C.fmt(125_000), '2:05');
  check('a period says how many are left',
    C.show({ ms: 28_000, kind: 'period', periods: 3, out: false }), '0:28 ×3');
  check('a period is always the urgent state',
    C.low({ ms: 29_000, kind: 'period', periods: 3, out: false }), true);
  check('the bank is not, until it is', C.low({ ms: 45_000, kind: 'main', periods: 0, out: false }), false);
}

console.log(failures ? `\n${failures} wrong.` : '\nboth clocks add up.');
process.exit(failures ? 1 : 0);
