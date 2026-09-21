// The rules perft cannot reach.
//
// Perft proves the movement rules from the opening position, which is a lot —
// but five plies from the start no soldier has crossed the river, no king has
// ever seen the other one down an open file, and nobody has been mated. Those
// are the rules that decide GAMES rather than move counts, so each one gets a
// position of its own here.
//
// Positions are ten rows, Black's back line first, uppercase = Red. Watch the
// kings: a layout with both of them on the same open file is an ILLEGAL
// position, and every move from it looks broken. (Which is how the first draft
// of this file managed to fail nine true rules at once.)
import { build } from 'esbuild';
import { pathToFileURL } from 'node:url';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const dir = mkdtempSync(path.join(tmpdir(), 'xq-rules-'));
const out = path.join(dir, 'rules.mjs');
await build({ entryPoints: ['src/xiangqi/rules.ts'], outfile: out, bundle: true, format: 'esm', platform: 'node', logLevel: 'warning' });
const R = await import(pathToFileURL(out).href);
rmSync(dir, { recursive: true, force: true });

const FILES = 'abcdefghi';
const sq = (n) => (9 - Number(n[1])) * 9 + FILES.indexOf(n[0]);
const name = (s) => `${FILES[s % 9]}${9 - ((s / 9) | 0)}`;

let failures = 0;
const check = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failures++;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${ok ? '' : `\n         got ${JSON.stringify(got)}\n        want ${JSON.stringify(want)}`}`);
};

/** Legal destinations for the piece on `from`, as coordinates, sorted. */
const dests = (layout, side, from) => {
  const pos = R.Position.fromLayout(layout);
  pos.side = side;
  return pos.legalMoves().filter((m) => R.moveFrom(m) === sq(from)).map((m) => name(R.moveTo(m))).sort();
};

// Kings on different files, out of everyone's way, in every position below.
const K_BLACK = '...k.....';
const K_RED = '....K....';

console.log('soldiers');
check('a soldier that has crossed goes forward and sideways', dests([
  K_BLACK, '.........', '.........', '.........', '....P....',
  '.........', '.........', '.........', '.........', K_RED,
], R.RED, 'e5'), ['d5', 'e6', 'f5']);
check('a soldier in its own half only goes forward', dests([
  K_BLACK, '.........', '.........', '.........', '.........',
  '....P....', '.........', '.........', '.........', K_RED,
], R.RED, 'e4'), ['e5']);

console.log('elephants and horses');
check('an elephant may not cross the river', dests([
  K_BLACK, '.........', '.........', '.........', '.........',
  '..B......', '.........', '.........', '.........', K_RED,
], R.RED, 'c4'), ['a2', 'e2']);
check('a blocked eye stops the elephant', dests([
  K_BLACK, '.........', '.........', '.........', '.........',
  '..B......', '.P.......', '.........', '.........', K_RED,
], R.RED, 'c4'), ['e2']);
check('a blocked leg stops the horse', dests([
  K_BLACK, '.........', '.........', '.........', '.........',
  '....N....', '....P....', '.........', '.........', K_RED,
], R.RED, 'e4'), ['c3', 'c5', 'd6', 'f6', 'g3', 'g5']);

console.log('cannons');
check('a cannon takes over exactly one screen', dests([
  K_BLACK, '....r....', '.........', '....n....', '.........',
  '.........', '.........', '....C....', '.........', K_RED,
], R.RED, 'e2'), ['a2', 'b2', 'c2', 'd2', 'e1', 'e3', 'e4', 'e5', 'e8', 'f2', 'g2', 'h2', 'i2']);

console.log('the two kings');
check('a king may not step onto the file the other one is on', dests([
  '....k....', '.........', '.........', '.........', '.........',
  '.........', '.........', '.........', '.........', '...K.....',
], R.RED, 'd0'), ['d1']);
check('and may not expose that file by moving what blocks it', dests([
  '....k....', '.........', '.........', '.........', '.........',
  '.........', '.........', '....N....', '.........', '....K....',
], R.RED, 'e2'), []);

console.log('endings');
{
  // Chariot on the file, chariot on the back rank: nothing to move.
  const g = R.XiangqiGame.fromLayout([
    'R...k....', '.........', '.........', '.........', '....R....',
    '.........', '.........', '.........', '.........', '...K.....',
  ], R.BLACK);
  check('mate is a loss for the mated side', g.outcome(), { kind: 'checkmate', winner: R.RED });
}
{
  // Not in check, and still nowhere to go: 困毙, which is a LOSS in xiangqi
  // and would be a draw in western chess. This is the rule most ports get
  // wrong, because it is inherited rather than written.
  const g = R.XiangqiGame.fromLayout([
    '....k....', '...R.....', '.....R...', '.........', '.........',
    '.........', '.........', '.........', '.........', '...K.....',
  ], R.BLACK);
  check('the stalemated side is not in check', g.position.inCheck(), false);
  check('and has lost anyway', g.outcome(), { kind: 'stalemate', winner: R.RED });
}

console.log('repetition');
{
  // Red's chariot checks from d1, Black's king steps aside, Red follows. Three
  // times round and the side doing the checking is the side that loses.
  const g = R.XiangqiGame.fromLayout([
    '...k.....', '.........', '.........', '.........', '.........',
    '.........', '.........', '.........', '.....R...', '.....K...',
  ], R.RED);
  for (const s of ['f1d1', 'd9e9', 'd1e1', 'e9d9', 'e1d1', 'd9e9', 'd1e1', 'e9d9', 'e1d1']) {
    if (g.play(sq(s.slice(0, 2)), sq(s.slice(2))) === null) {
      console.log(`  FAIL could not play ${s}`);
      failures++;
      break;
    }
  }
  check('perpetual check loses for the checker', g.outcome(), { kind: 'perpetual', winner: R.BLACK });
}
{
  // The same shuffle with nobody in check is simply a draw.
  const g = R.XiangqiGame.fromLayout([
    '...k.....', '.........', '.........', '.........', '.........',
    '.........', '.........', '.........', '.R.....R.', '....K....',
  ], R.RED);
  // Eight plies, not nine: this shuffle starts ON the cycle, so the opening
  // position is itself the first of the three occurrences.
  for (const s of ['b1a1', 'd9d8', 'a1b1', 'd8d9', 'b1a1', 'd9d8', 'a1b1', 'd8d9']) {
    if (g.play(sq(s.slice(0, 2)), sq(s.slice(2))) === null) {
      console.log(`  FAIL could not play ${s}`);
      failures++;
      break;
    }
  }
  check('a repetition with no checks is a draw', g.outcome(), { kind: 'draw', why: 'repetition' });
}

console.log(failures ? `\n${failures} failing rule(s).` : '\nevery rule holds.');
process.exit(failures ? 1 : 0);
