/**
 * Board rules, checked against hand-written boards.
 *
 * These are the bugs that do not look like bugs: a column that compacts one cell
 * short, a group counted twice, a chain that stops a wave early. On screen all
 * three read as "the game feels slightly off", which is not a thing anyone can
 * debug. Run after touching src/board.ts.
 *
 *   node tools/board-test.mjs <bundled-board.mjs>
 */
const B = await import(process.argv[2] ?? '/tmp/board.mjs');
let fails = 0;
const ok = (name, cond, extra = '') => {
  if (!cond) { fails++; console.log(`  FAIL ${name} ${extra}`); } else console.log(`  ok   ${name}`);
};

// Rows are written TOP-first here so the literals look like the screen, then
// reversed — the grid itself is bottom-up.
const make = (rows) => {
  const g = B.emptyGrid();
  const bottomUp = [...rows].reverse();
  bottomUp.forEach((row, r) => [...row].forEach((ch, c) => {
    if (ch !== '.') g[r][c] = B.newTile({ o: 'circle', v: 'chevron', x: 'cross', w: 'wave' }[ch]);
  }));
  return g;
};
const show = (g) => {
  const lines = [];
  for (let r = B.ROWS - 1; r >= 0; r--) {
    lines.push([...Array(B.COLS).keys()].map((c) => {
      const t = g[r][c];
      return t ? { circle: 'o', chevron: 'v', cross: 'x', wave: 'w' }[t.glyph] : '.';
    }).join(''));
  }
  return lines.join('\n');
};

console.log('gravity');
{
  const g = make(['o.....', '......', 'x.....']);
  ok('a floating stack lands on the floor', B.applyGravity(g));
  ok('order within the column is preserved',
    g[0][0].glyph === 'cross' && g[1][0].glyph === 'circle', '\n' + show(g));
  ok('a settled board reports no movement', B.applyGravity(g) === false);
}

console.log('groups');
{
  ok('three in a row is a group', B.findGroups(make(['ooo...'])).length === 1);
  ok('two is not', B.findGroups(make(['oo....'])).length === 0);
  ok('an L counts as one group, not two',
    B.findGroups(make(['o.....', 'ooo...'])).length === 1);
  const g = make(['ooo.xx', 'wwwwxx']);
  const groups = B.findGroups(g);
  ok('separate colours are separate groups', groups.length === 3, JSON.stringify(groups.map((x) => x.length)));
  ok('no tile is in two groups',
    new Set(groups.flat().map((t) => t.id)).size === groups.flat().length);
}

console.log('targets');
{
  const g = make(['....xx', 'ovxwwo']);
  const t0 = B.targets(g, 0);
  ok('the pair starts at the cursor column',
    t0.map((x) => x.tile.glyph).join() === 'circle,chevron', JSON.stringify(t0.map((x) => x.tile.glyph)));
  const t2 = B.targets(g, 2);
  ok('and moves with it',
    t2.map((x) => x.tile.glyph).join() === 'cross,wave', JSON.stringify(t2.map((x) => x.tile.glyph)));
  ok('the sweep wraps', B.targets(g, 5)[1].col === 0);
  const sparse = make(['..x...', 'o.x...']);
  ok('an empty column is stepped over, not stalled on',
    B.targets(sparse, 1).map((x) => x.col).join() === '2,0', JSON.stringify(B.targets(sparse, 1).map((x) => x.col)));
  ok('advancing goes past the furthest cleared', B.advance(4, 1) === 0 && B.advance(0, 0) === 1);
}

console.log('chain resolution');
{
  // Clearing the bottom-left circle drops the cross onto two crosses.
  const g = make(['x.....', 'x.....', 'oxx...']);
  const before = B.findGroups(g).length;
  B.remove(g, new Set([B.targets(g, 0)[0].tile.id]));
  B.applyGravity(g);
  const after = B.findGroups(g);
  ok('no group before the clear', before === 0);
  ok('the fall creates one', after.length === 1 && after[0].length === 4, '\n' + show(g));
}

console.log('refill');
{
  const g = B.emptyGrid();
  let s = 7;
  const rng = () => ((s = (s * 1103515245 + 12345) >>> 0) / 4294967296);
  B.refill(g, 5, rng, true);
  ok('fills every column to the requested height',
    [...Array(B.COLS).keys()].every((c) => B.height(g, c) === 5));
  ok('the opening board contains no free matches',
    B.findGroups(g).length === 0, '\n' + show(g));
}

console.log(fails ? `\n${fails} FAILED` : '\nall passed');
process.exit(fails ? 1 : 0);
