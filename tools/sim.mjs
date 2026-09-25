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

function run({ rainPerMove, rainGrowth, policy, openingRows, floor, moves = 500, every = 50, startSeed = 12345 }) {
  seed = startSeed;
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
console.log(`well is ${B.COLS}x${B.ROWS} = ${CAP} cells\n`);

// The equilibrium, measured with the floor switched OFF. With it on, a rate
// that is too low still reads as "held" — the floor is quietly doing the
// holding, and the board sits at exactly the floor, which is the sparse,
// nothing-to-read board the whole rate is supposed to prevent.
console.log('steady state with NO floor and no growth — where does the well settle?');
console.log('rain/move | best play        | careless play');
for (const rainPerMove of [3.2, 4.0, 4.6, 5.2, 5.8, 6.4]) {
  const cells = ['best', 'any'].map((policy) => {
    const r = run({ rainPerMove, rainGrowth: 0, policy, openingRows: 4, floor: 0, moves: 400, every: 20 });
    const tail = r.trace.slice(-10);
    const mean = tail.reduce((a, b) => a + b, 0) / tail.length;
    return `${mean.toFixed(0).padStart(2)} tiles (${(mean / CAP * 100).toFixed(0)}% full, ` +
      `${(mean / B.COLS).toFixed(1)} rows)${r.end === 'held' ? '' : ' ' + r.end}`;
  });
  console.log(`   ${String(rainPerMove).padEnd(6)} | ${cells[0].padEnd(16)} | ${cells[1]}`);
}

console.log('\nwith the floor back on, how long does a run last?');
console.log('rain/move  growth | best play      | careless play');
for (const rainPerMove of [5.0, 5.2, 5.6]) {
  for (const rainGrowth of [0.02, 0.035, 0.05]) {
    const cells = ['best', 'any'].map((policy) => {
      const r = run({ rainPerMove, rainGrowth, policy, openingRows: 4, floor: 10, moves: 600, every: 40 });
      return `${r.end === 'held' ? 'held 600+' : r.end.replace('FULL @', 'ends @')} moves`;
    });
    console.log(`  ${String(rainPerMove).padEnd(9)} ${String(rainGrowth).padEnd(6)} | ${cells[0].padEnd(14)} | ${cells[1]}`);
  }
}

// One seed is a coin flip — the single-seed table above put 5.2/0.02 at a 3x
// skill gap and 5.6/0.02 at 1.04x, which is noise, not signal.
console.log('\naveraged over 7 seeds — run length in moves');
console.log('rain/move  growth | best play  careless play  skill gap');
for (const rainPerMove of [4.8, 5.0, 5.2]) {
  for (const rainGrowth of [0.02, 0.03, 0.04]) {
    const mean = (policy) => {
      const xs = [];
      for (let k = 0; k < 7; k++) {
        xs.push(run({ rainPerMove, rainGrowth, policy, openingRows: 4, floor: 10,
                      moves: 800, every: 40, startSeed: 1000 + k * 7919 }).moves);
      }
      return xs.reduce((a, b) => a + b, 0) / xs.length;
    };
    const good = mean('best'), bad = mean('any');
    console.log(`  ${String(rainPerMove).padEnd(9)} ${String(rainGrowth).padEnd(6)} | ` +
      `${good.toFixed(0).padStart(9)}  ${bad.toFixed(0).padStart(13)}  ${(good / bad).toFixed(2)}x`);
  }
}
