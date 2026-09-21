// The bots.
//
// Blokus is a game about two things at once: getting your big pieces down
// early, and keeping somewhere to put the next one. A one-ply search that
// weighs exactly those two plays a recognisable game — it opens outwards,
// it fights for the middle, and it does not paint itself into a corner —
// without any of the machinery a real search would need.
//
// The three levels are the same search with different weights, plus noise.
// Noise is the honest way to make a weaker opponent HERE, where "random move"
// would not be: unlike chess, a random legal Blokus move is rarely a disaster,
// it is just a small piece played somewhere dull. That is what a beginner
// does, which is why Easy is allowed to be random and Chess's bots are not.
import {
  BASE, CORNERS, EMPTY, ORIENTATIONS, SIZE, canPlace,
} from './pieces';
import type { Cells, Cell } from './pieces';
import type { Move } from './game';

export type Difficulty = 'easy' | 'medium' | 'hard';
export const DIFFICULTIES: Difficulty[] = ['easy', 'medium', 'hard'];

/** How many valid moves Easy looks at before choosing one at random. Enough
 *  to be varied, few enough that it does not accidentally play well. */
const EASY_SAMPLE = 50;

const DIAGONALS: Cell[] = [[1, 1], [1, -1], [-1, 1], [-1, -1]];
const EDGES: Cell[] = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const inside = (x: number, y: number): boolean => x >= 0 && y >= 0 && x < SIZE && y < SIZE;

/**
 * How many NEW places to build from this move would open up.
 *
 * The count that matters in Blokus: a piece that lands with five free corners
 * has five ways to continue, and a piece tucked into a pocket has none no
 * matter how big it was. A corner only counts if it is free and not beside
 * the player's own colour — the same test `canPlace` will apply next turn, so
 * the bot is counting real options rather than hopeful ones.
 */
function newAnchors(board: readonly number[], cells: Cells, player: number): number {
  const placed = new Set(cells.map(([x, y]) => `${x},${y}`));
  const found = new Set<string>();
  for (const [x, y] of cells) {
    for (const [dx, dy] of DIAGONALS) {
      const nx = x + dx, ny = y + dy;
      if (!inside(nx, ny)) continue;
      if (board[ny * SIZE + nx] !== EMPTY || placed.has(`${nx},${ny}`)) continue;
      let beside = false;
      for (const [ex, ey] of EDGES) {
        const ax = nx + ex, ay = ny + ey;
        if (!inside(ax, ay)) continue;
        if (board[ay * SIZE + ax] === player || placed.has(`${ax},${ay}`)) { beside = true; break; }
      }
      if (!beside) found.add(`${nx},${ny}`);
    }
  }
  return found.size;
}

interface Weights { size: number; anchors: number; reach: number; noise: number }

/**
 * Medium plays a decent club game; Hard plays the same game with its hands
 * steadier. The difference is mostly the noise: at medium it is large enough
 * to overturn the odd close decision, which is what stops the bot repeating
 * the same opening at you forever.
 */
const WEIGHTS: Record<Exclude<Difficulty, 'easy'>, Weights> = {
  medium: { size: 20, anchors: 8, reach: 1.5, noise: 4 },
  hard: { size: 35, anchors: 15, reach: 3, noise: 0.5 },
};

function score(board: readonly number[], cells: Cells, player: number, piece: string, w: Weights): number {
  const [cx, cy] = CORNERS[player];
  // Manhattan distance from the player's own corner, averaged: pushing away
  // from home is how you reach the middle, and the middle is where the board
  // is still empty late in a game.
  const reach = cells.reduce((s, [x, y]) => s + Math.abs(x - cx) + Math.abs(y - cy), 0) / cells.length;
  return BASE[piece].length * w.size
    + newAnchors(board, cells, player) * w.anchors
    + reach * w.reach
    + Math.random() * w.noise;
}

/**
 * The bot's move, or `null` when it has nowhere to go.
 *
 * Big pieces are tried first so that, among equals, the bot gets rid of what
 * is hardest to place later — and because it lets the loop find a good
 * candidate early, which is what keeps this cheap enough to run inside a
 * turn's worth of thinking time.
 */
export function chooseMove(
  board: readonly number[],
  hand: readonly string[],
  player: number,
  firstMove: boolean,
  difficulty: Difficulty,
): Move | null {
  if (difficulty === 'easy') {
    const found: Move[] = [];
    for (const piece of hand) {
      const oris = ORIENTATIONS[piece];
      for (let ori = 0; ori < oris.length; ori++) {
        for (let y = 0; y < SIZE; y++) {
          for (let x = 0; x < SIZE; x++) {
            const cells = oris[ori].map(([dx, dy]) => [x + dx, y + dy] as Cell);
            if (canPlace(board, cells, player, firstMove)) found.push({ piece, ori, x, y });
            if (found.length >= EASY_SAMPLE) break;
          }
          if (found.length >= EASY_SAMPLE) break;
        }
        if (found.length >= EASY_SAMPLE) break;
      }
      if (found.length >= EASY_SAMPLE) break;
    }
    return found.length ? found[Math.floor(Math.random() * found.length)] : null;
  }

  const w = WEIGHTS[difficulty];
  const order = [...hand].sort((a, b) => BASE[b].length - BASE[a].length);
  let best: Move | null = null;
  let bestScore = -Infinity;
  for (const piece of order) {
    const oris = ORIENTATIONS[piece];
    for (let ori = 0; ori < oris.length; ori++) {
      for (let y = 0; y < SIZE; y++) {
        for (let x = 0; x < SIZE; x++) {
          const cells = oris[ori].map(([dx, dy]) => [x + dx, y + dy] as Cell);
          if (!canPlace(board, cells, player, firstMove)) continue;
          const s = score(board, cells, player, piece, w);
          if (s > bestScore) { bestScore = s; best = { piece, ori, x, y }; }
        }
      }
    }
  }
  return best;
}
