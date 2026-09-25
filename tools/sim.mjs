/**
 * Balance simulator — how full is the well, move by move?
 *
 * The economy of this game is three numbers (what a manual clear pays back, what
 * a chain pays back, how fast the free drip is) and the interaction between them
 * is not something anyone can hold in their head: chains fire far more often
 * than intuition says, because clearing a glyph across two columns drops both by
 * one and that is most of what it takes to line up three.
 *
 * So it gets played, ten thousand moves at a time, by a policy that plays the
 * obvious way (take the widest match in the lowest row). What matters is not the
 * score — it is whether the tile count HOLDS. A well that drains has no board
 * left to read; a well that fills regardless of play is a timer.
 *
 *   node tools/sim.mjs <bundled-board.mjs>
 */
const B = await import(process.argv[2] ?? '/tmp/board.mjs');
const GLYPHS = ['circle', 'chevron', 'cross', 'wave'];

let seed = 12345;
const rng = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);

const tiles = (g) => {
  let n = 0;
  for (let r = 0; r < B.ROWS; r++) for (let c = 0; c < B.COLS; c++) if (g[r][c]) n++;
  return n;
};

/** Play the obvious way: the widest match in the lowest row that has one. */
function bestMove(g) {
  let best = null;
  for (const glyph of GLYPHS) {
    const m = B.lowestMatch(g, glyph);
    if (!m) continue;
    if (!best || m.row < best.row || (m.row === best.row && m.tiles.length > best.tiles.length)) best = m;
  }
  return best;
}

/** Play badly but legally: any glyph that matches, picked at random. A number
 *  tuned against the optimal policy is a number no human can meet. */
function anyMove(g) {
  const opts = GLYPHS.map((x) => B.lowestMatch(g, x)).filter(Boolean);
  return opts.length ? opts[Math.floor(rng() * opts.length)] : null;
}

function run({ rainPerMove, rainGrowth, policy, openingRows, floor, moves = 500, every = 50 }) {
  seed = 12345;
  const g = B.emptyGrid();
  B.refill(g, openingRows, rng, true);
  let owed = 0, chainTiles = 0, manualTiles = 0, chains = 0;
  const trace = [];
  const pick = policy === 'best' ? bestMove : anyMove;
  for (let i = 0; i < moves; i++) {
    const m = pick(g);
    if (m) {
      B.remove(g, new Set(m.tiles.map((t) => t.id)));
      B.applyGravity(g);
      manualTiles += m.tiles.length;
      for (let guard = 0; guard < 40; guard++) {
        const groups = B.findGroups(g);
        if (!groups.length) break;
        if (guard === 0) chains++;
        const ids = new Set(groups.flat().map((t) => t.id));
        chainTiles += ids.size;
        B.remove(g, ids);
        B.applyGravity(g);
      }
    }
    owed += rainPerMove + rainGrowth * i;
    // The catch-up: a well this empty has nothing left to read, so it is topped
    // up regardless of rate. It engages near zero and never at playing heights,
    // so it is a floor under the board, not a hand on the scales.
    if (tiles(g) < floor) owed += floor - tiles(g);
    while (owed >= 1) {
      const d = B.nextDrop(g, rng);
      if (!d) break;
      B.drop(g, d.col, d.glyph);
      B.applyGravity(g);
      owed -= 1;
    }
    if (i % every === 0) trace.push(tiles(g));
    if (B.isFull(g)) return { end: `FULL @${i}`, trace, chains, manualTiles, chainTiles, moves: i };
  }
  return { end: 'held', trace, chains, manualTiles, chainTiles, moves };
}

const CAP = B.COLS * B.ROWS;
console.log(`well is ${B.COLS}x${B.ROWS} = ${CAP} cells, opening 4 rows = 24\n`);
console.log('policy  rain/move  growth  | outcome    tiles every 40 moves');
for (const policy of ['best', 'any']) {
  for (const rainPerMove of [3.0, 3.4, 3.8]) {
    for (const rainGrowth of [0.01, 0.02, 0.03]) {
      const r = run({ rainPerMove, rainGrowth, policy, openingRows: 4, floor: 14, moves: 400, every: 40 });
      console.log(
        `${policy.padEnd(7)} ${String(rainPerMove).padEnd(10)} ${String(rainGrowth).padEnd(7)} | ` +
        `${r.end.padEnd(10)} ${r.trace.slice(0, 10).join(' ')}`,
      );
    }
  }
}
const ref = run({ rainPerMove: 3.4, rainGrowth: 0.02, policy: 'best', openingRows: 4, floor: 14, every: 40 });
const bad = run({ rainPerMove: 3.4, rainGrowth: 0.02, policy: 'any', openingRows: 4, floor: 14, every: 40 });
console.log(`\nat 3.4 + 0.02:`);
console.log(`  playing well : lasts ${ref.moves} moves, chain on ${(ref.chains / ref.moves * 100).toFixed(0)}% of them, ` +
  `${(ref.manualTiles / ref.moves).toFixed(2)}+${(ref.chainTiles / ref.moves).toFixed(2)} tiles/move`);
console.log(`  playing badly: lasts ${bad.moves} moves, chain on ${(bad.chains / bad.moves * 100).toFixed(0)}% of them, ` +
  `${(bad.manualTiles / bad.moves).toFixed(2)}+${(bad.chainTiles / bad.moves).toFixed(2)} tiles/move`);
