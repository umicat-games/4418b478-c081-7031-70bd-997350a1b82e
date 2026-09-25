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

console.log('matching');
{
  const g = make(['oooooo', 'wwxwww', 'ovxwwo']);
  const m = B.lowestMatch(g, 'wave');
  ok('matches the lowest row holding the glyph', m.row === 0, JSON.stringify(m && m.row));
  ok('and takes every one of them in that row', m.tiles.length === 2, String(m && m.tiles.length));
  // Bottom two rows hold no circle at all; the pair up top is the match.
  const up = B.lowestMatch(make(['oo....', 'wwxwww', 'wvxwwv']), 'circle');
  ok('climbs past rows that do not hold it', up.row === 2 && up.tiles.length === 2,
    JSON.stringify(up && { row: up.row, n: up.tiles.length }));
  const high = B.lowestMatch(make(['oooooo', 'wwwwww']), 'circle');
  ok('a glyph only found higher up still matches', high.row === 1 && high.tiles.length === 6,
    JSON.stringify(high && { row: high.row, n: high.tiles.length }));
  ok('a glyph that is not on the board does not match',
    B.lowestMatch(make(['wwwwww']), 'cross') === null);
  ok('present() lists exactly what is there',
    B.present(make(['ovvv..'])).sort().join() === 'chevron,circle');
}

console.log('the rain');
{
  let s = 11;
  const rng = () => ((s = (s * 1103515245 + 12345) >>> 0) / 4294967296);
  const g = make(['....x.', 'oxwvox']);
  const n = B.nextDrop(g, rng);
  ok('picks a column with room', n && B.height(g, n.col) < B.ROWS, JSON.stringify(n));
  // Fire it a lot: the bias is towards short columns, so the tall one must not
  // be the one that keeps getting fed.
  const counts = new Array(B.COLS).fill(0);
  for (let i = 0; i < 400; i++) counts[B.nextDrop(g, rng).col]++;
  ok('and leans towards the shorter ones', counts[4] > counts[0] * 1.15,
    `col0(tall)=${counts[0]} col4(short)=${counts[4]}`);

  // 200 rained tiles must never hand out a free three-in-a-row.
  const live = B.emptyGrid();
  B.refill(live, 3, rng, true);
  let dealt = 0;
  for (let i = 0; i < 200; i++) {
    const d = B.nextDrop(live, rng);
    if (!d) break;
    B.drop(live, d.col, d.glyph);
    B.applyGravity(live);
    if (B.findGroups(live).length) { dealt++; }
    B.remove(live, new Set(B.findGroups(live).flat().map((t) => t.id)));
    B.applyGravity(live);
  }
  ok('never deals a match itself', dealt === 0, `${dealt} free matches dealt`);
}

console.log('the end');
{
  ok('an empty well is not full', B.isFull(B.emptyGrid()) === false);
  const packed = B.emptyGrid();
  let s2 = 3;
  B.refill(packed, B.ROWS, () => ((s2 = (s2 * 1103515245 + 12345) >>> 0) / 4294967296));
  ok('a packed well is', B.isFull(packed) === true);
  ok('and has nowhere left to drop', B.nextDrop(packed, Math.random) === null);
}

console.log('chain resolution');
{
  // Clearing the bottom-left circle drops the cross onto two crosses.
  const g = make(['x.....', 'x.....', 'oxx...']);
  const before = B.findGroups(g).length;
  B.remove(g, new Set(B.lowestMatch(g, 'circle').tiles.map((t) => t.id)));
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
