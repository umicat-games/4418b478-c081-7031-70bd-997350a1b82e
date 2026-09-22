// The rules perft cannot reach.
//
// Perft proves the flipping from the opening position, which is most of it.
// What it does not reach in eight plies is the end of a game: the forced
// pass, the game that finishes with empty squares nobody may use, and the
// count that decides it. Those are the rules that decide GAMES rather than
// move counts.
//
// Positions are written out as eight rows, row 1 first: `x` Black, `o` White.
import { build } from 'esbuild';
import { pathToFileURL } from 'node:url';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const dir = mkdtempSync(path.join(tmpdir(), 'othello-rules-'));
const out = path.join(dir, 'rules.mjs');
await build({ entryPoints: ['src/game/rules.ts'], outfile: out, bundle: true, format: 'esm', platform: 'node', logLevel: 'warning' });
const R = await import(pathToFileURL(out).href);
rmSync(dir, { recursive: true, force: true });

const FILES = 'abcdefgh';
const sq = (n) => (Number(n[1]) - 1) * 8 + FILES.indexOf(n[0]);
const name = (i) => `${FILES[i % 8]}${((i / 8) | 0) + 1}`;

let failures = 0;
const check = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failures++;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${ok ? '' : `\n         got ${JSON.stringify(got)}\n        want ${JSON.stringify(want)}`}`);
};
const of = (rows, toPlay = R.BLACK) => R.Othello.fromRows(rows, toPlay);
const EMPTY = '........';

console.log('flipping');
{
  // One line, one flip. And the same shape with a gap flips nothing.
  const g = of(['........', '........', '........', '.xoo.o..', EMPTY, EMPTY, EMPTY, EMPTY]);
  // Sorted, because a flip walks OUTWARD from the disc you place: the order
  // is d4 then c4, which is the right answer and the wrong expectation.
  check('a run closed by my own disc flips', g.flips(sq('e4')).map(name).sort(), ['c4', 'd4']);
  check('a run with a gap behind it flips nothing', g.flips(sq('g4')).map(name), []);
}
{
  // A run that reaches the edge without one of mine is not a flip.
  const g = of([EMPTY, EMPTY, EMPTY, 'xooooooo', EMPTY, EMPTY, EMPTY, EMPTY], R.BLACK);
  check('a run that runs off the edge flips nothing', g.legalMoves().map(name), []);
}
{
  // Eight directions at once: d4 is empty, every neighbour is White, and
  // beyond each of them is Black. Playing there has to turn all eight.
  const g = of([
    EMPTY,
    '.x.x.x..',
    '..ooo...',
    '.xo.ox..',
    '..ooo...',
    '.x.x.x..',
    EMPTY,
    EMPTY,
  ], R.BLACK);
  check('all eight directions resolve, independently',
    g.flips(sq('d4')).map(name).sort(), ['c3', 'c4', 'c5', 'd3', 'd5', 'e3', 'e4', 'e5']);
}

console.log('\npassing, and the end');
{
  // White has nothing to play: after Black's move it is Black again, and
  // nobody had to press anything.
  const g = of([
    'xxxxxxxx', 'xxxxxxxx', 'xxxxxxxx', 'xxxxxxxx',
    'xxxxxxxx', 'xxxxxxxx', 'xxxxxxo.', 'xxxxxxxx',
  ], R.BLACK);
  check('white has no move here', g.legalMoves(R.WHITE).map(name), []);
  check('and black does', g.legalMoves(R.BLACK).map(name), ['h7']);
  g.play(sq('h7'));
  check('so the turn comes straight back to black', g.toPlay, R.BLACK);
}
{
  // Neither side can move, and the board is NOT full: the game is over all
  // the same, and the count decides it.
  const g = of([
    'xxxxxxxx', 'xxxxxxxx', 'xxxxxxxx', 'xxxxxxxx',
    'xxxxxxxx', 'xxxxxxxx', 'xxxxxxxx', 'xxxxxxx.',
  ], R.WHITE);
  const out = g.outcome();
  check('a game can end with an empty square on the board', out.kind, 'win');
  check('and the count is what decides it', [out.winner, out.black, out.white], [R.BLACK, 63, 0]);
}
{
  const g = of([
    'xxxxoooo', 'xxxxoooo', 'xxxxoooo', 'xxxxoooo',
    'xxxxoooo', 'xxxxoooo', 'xxxxoooo', 'xxxxoooo',
  ], R.BLACK);
  check('an equal full board is a draw', g.outcome().kind, 'draw');
}

console.log('\nplaying');
{
  const g = new R.Othello();
  check('black opens', g.toPlay, R.BLACK);
  check('and has four openings', g.legalMoves().map(name).sort(), ['c4', 'd3', 'e6', 'f5']);
  check('a cell that flips nothing is refused', g.play(sq('a1')), null);
  const flipped = g.play(sq('d3'));
  check('and one that does, flips', flipped.map(name), ['d4']);
  check('discs after the first move', g.counts(), { black: 4, white: 1 });
  const back = R.Othello.restore(g.snapshot());
  check('a game restores to the same board', back.diagram().join(), g.diagram().join());
}

console.log(failures ? `\n${failures} failing rule(s).` : '\nevery rule holds.');
process.exit(failures ? 1 : 0);
