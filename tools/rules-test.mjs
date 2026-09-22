// The referee's test.
//
// Gomoku has no perft to check against the way chess-likes do — the move tree
// is "every empty cell" and counting it proves nothing. What is worth proving
// is the two things the rest of the game trusts this file for:
//
//   does it see five in a row, in every direction, including at the edge and
//   including an overline;
//   does `threats()` agree with what a player would call a four and an open
//   three — including the awkward shapes (split, blocked at one end, running
//   into the wall) that pattern-matching implementations get wrong.
//
// The assistant reports threats out loud, so a wrong answer here is the game
// telling a beginner something false with a straight face.
//
// Positions are written out as rows, top first: `x` Black, `o` White, `.` empty.
import { build } from 'esbuild';
import { pathToFileURL } from 'node:url';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const dir = mkdtempSync(path.join(tmpdir(), 'gomoku-rules-'));
const out = path.join(dir, 'rules.mjs');
await build({ entryPoints: ['src/game/rules.ts'], outfile: out, bundle: true, format: 'esm', platform: 'node', logLevel: 'warning' });
const R = await import(pathToFileURL(out).href);
rmSync(dir, { recursive: true, force: true });

let failures = 0;
const check = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failures++;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${ok ? '' : `\n         got ${JSON.stringify(got)}\n        want ${JSON.stringify(want)}`}`);
};

/** Cells as "x,y", sorted, so a failure reads as coordinates. */
const cells = (g, list) => list.map((i) => `${g.xOf(i)},${g.yOf(i)}`).sort();
const of = (rows, toPlay = R.BLACK) => R.Gomoku.fromRows(rows, toPlay);

console.log('five in a row');
{
  const rows = [
    '.........',
    '..xxxxx..',
    '.........',
    '...o.....',
    '...o.....',
    '...o.....',
    '...o.....',
    '...o.....',
    '.........',
  ];
  const g = of(rows);
  const out = g.outcome();
  check('across', out.kind === 'win' && out.winner === R.BLACK, true);
}
{
  // A diagonal that ends on the edge — the direction loops have to stop at the
  // wall rather than wrap onto the next row, which a flat array makes easy to
  // get wrong.
  const g = of([
    '....x....',
    '.....x...',
    '......x..',
    '.......x.',
    '........x',
    '.........',
    '.........',
    '.........',
    '.........',
  ]);
  const out = g.outcome();
  check('diagonal into the corner', out.kind === 'win' && out.line.length === 5, true);
}
{
  // Six in a row. Free-style: an overline wins. (Renju forbids it for Black,
  // and this is the test that would change if it were ever added.)
  const g = of([
    '.........',
    '.xxxxxx..',
    '.........',
    '.........',
    '.........',
    '.........',
    '.........',
    '.........',
    '.........',
  ]);
  check('an overline wins in free-style', g.outcome().kind, 'win');
}
{
  const g = of([
    '.........',
    '..xxxx...',
    '.........',
    '.........',
    '.........',
    '.........',
    '.........',
    '.........',
    '.........',
  ]);
  check('four in a row is not a win', g.outcome().kind, 'playing');
}

console.log('\nwinning cells');
{
  const g = of([
    '.........',
    '..xxxx...',
    '.........',
    '.........',
    '.........',
    '.........',
    '.........',
    '.........',
    '.........',
  ]);
  check('both ends of an open four', cells(g, g.threats(R.BLACK).win), ['1,1', '6,1']);
}
{
  // Blocked on the left: only one way to finish.
  const g = of([
    '.........',
    '.oxxxx...',
    '.........',
    '.........',
    '.........',
    '.........',
    '.........',
    '.........',
    '.........',
  ]);
  check('a blocked four has one', cells(g, g.threats(R.BLACK).win), ['6,1']);
}
{
  // A split four: the gap is the only winning cell. Pattern matchers miss it.
  const g = of([
    '.........',
    '..xx.xx..',
    '.........',
    '.........',
    '.........',
    '.........',
    '.........',
    '.........',
    '.........',
  ]);
  check('a split four wins in the gap', cells(g, g.threats(R.BLACK).win), ['4,1']);
}

console.log('\nopen threes and fours');
{
  const g = of([
    '.........',
    '..xxx....',
    '.........',
    '.........',
    '.........',
    '.........',
    '.........',
    '.........',
    '.........',
  ]);
  const t = g.threats(R.BLACK);
  check('an open three can be made into an open four', cells(g, t.openFour), ['1,1', '5,1']);
  check('and is not itself a win', t.win.length, 0);
}
{
  // The same three with one end blocked is a dead three: nothing to answer.
  const g = of([
    '.........',
    '.oxxx....',
    '.........',
    '.........',
    '.........',
    '.........',
    '.........',
    '.........',
    '.........',
  ]);
  const t = g.threats(R.BLACK);
  check('a three blocked at one end makes no open four', t.openFour.length, 0);
}
{
  // Two stones with room. Four cells make an open three out of them, not two:
  // beside them (`..xxx.`) and — the ones a pattern matcher misses — one gap
  // away (`.x.xx.`), which is a broken three and every bit as live, because
  // filling the gap makes an open four.
  const g = of([
    '.........',
    '...xx....',
    '.........',
    '.........',
    '.........',
    '.........',
    '.........',
    '.........',
    '.........',
  ]);
  const t = g.threats(R.BLACK);
  check('a live two has four open-three moves, including the broken ones', cells(g, t.openThree), ['1,1', '2,1', '5,1', '6,1']);
}
{
  // Against the wall there is no room for an open four, so the same shape is
  // not an open three at all.
  const g = of([
    '.........',
    'xx.......',
    '.........',
    '.........',
    '.........',
    '.........',
    '.........',
    '.........',
    '.........',
  ]);
  check('no open threes against the wall', g.threats(R.BLACK).openThree.length, 0);
}

console.log('\nplaying');
{
  const g = new R.Gomoku(15);
  check('black moves first', g.toPlay, R.BLACK);
  g.play(g.idx(7, 7));
  check('and then white', g.toPlay, R.WHITE);
  check('an occupied cell is refused', g.play(g.idx(7, 7)), false);
  const snap = g.snapshot();
  const back = R.Gomoku.restore(snap);
  check('a game restores to the same board', back.diagram().join(), g.diagram().join());
}

console.log(failures ? `\n${failures} failing rule(s).` : '\nevery rule holds.');
process.exit(failures ? 1 : 0);
