// The opponent's head: alpha-beta over the same rules the player moves
// through, and — for the last dozen squares — the exact answer.
//
// Othello is the game where a hand-written evaluation is not just adequate
// but close to the real thing, because what matters is known and countable:
//
//   MOBILITY. How many moves you have and how few they have. A player with
//   two legal moves is being steered; a player with twelve is steering. This
//   is the midgame, and it is why the beginner's instinct — take the most
//   discs — loses: every disc you flip is a square you no longer threaten.
//
//   CORNERS, and the squares beside them. A corner can never be flipped, so
//   it is worth more than any count; the three squares touching it are worth
//   less than nothing, because they hand it over.
//
//   FRONTIER. Discs beside an empty square are discs the opponent can play
//   against. Fewer is better, which is the same idea as mobility seen from
//   the other end.
//
//   DISCS. Worth almost nothing until the end, and then the only thing.
//
// And the ending is EXACT. With a dozen squares left the whole tree fits, so
// the engine stops estimating and plays the result: from there it knows, and
// the assistant is allowed to say so.
import { BLACK, CELLS, Othello, SIZE, WHITE, other, type Player } from './rules';

/**
 * What a square is worth to stand on.
 *
 * The corners are the point; the X-squares diagonally inside them are the
 * trap. These numbers are the well-known ones, and they are a MIDGAME hint
 * rather than a truth — `positional` is weighted down as the board fills and
 * the actual count starts to matter.
 */
const WEIGHTS = [
  120, -20, 20, 5, 5, 20, -20, 120,
  -20, -40, -5, -5, -5, -5, -40, -20,
  20, -5, 15, 3, 3, 15, -5, 20,
  5, -5, 3, 3, 3, 3, -5, 5,
  5, -5, 3, 3, 3, 3, -5, 5,
  20, -5, 15, 3, 3, 15, -5, 20,
  -20, -40, -5, -5, -5, -5, -40, -20,
  120, -20, 20, 5, 5, 20, -20, 120,
];

const CORNERS = [0, 7, 56, 63];
/** The three squares around each corner, which are worth avoiding until the
 *  corner itself is settled. */
const NEAR_CORNER: Record<number, number[]> = {
  0: [1, 8, 9], 7: [6, 14, 15], 56: [48, 49, 57], 63: [54, 55, 62],
};

/** A win, in the units the search works in. Exact endings are scored in discs
 *  and multiplied up, so a one-disc win still beats any estimate. */
export const WIN = 1_000_000;

export interface Limits {
  depth: number;
  timeMs: number;
  /** Below this many empty squares, stop estimating and play it out exactly.
   *  Zero turns it off. */
  exactFrom: number;
  /** Count discs and nothing else — a coherent way to be weak, and exactly
   *  the mistake a beginner makes. */
  greedy?: boolean;
}

export interface RootMove { move: number; score: number }
export interface SearchResult {
  roots: RootMove[];
  depth: number;
  nodes: number;
  score: number;
  /** Set when the search reached the end of the game rather than an estimate:
   *  the final disc difference, from the searching side's point of view. */
  exact?: number;
}

const now = (): number => (typeof performance !== 'undefined' ? performance.now() : Date.now());

/** Discs beside an empty square — the ones the opponent can play against. */
function frontier(g: Othello, p: Player): number {
  const stone = p + 1;
  let n = 0;
  for (let i = 0; i < CELLS; i++) {
    if (g.board[i] !== stone) continue;
    const x = i % SIZE, y = (i / SIZE) | 0;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= SIZE || ny >= SIZE) continue;
        if (g.board[ny * SIZE + nx] === 0) { n++; dy = 2; break; }
      }
    }
  }
  return n;
}

/**
 * The position from `p`'s point of view.
 *
 * Each term is scaled by how full the board is. Early, mobility and shape are
 * everything and the count is noise; late, the count is the game. Getting
 * that crossover wrong is what makes an Othello engine play well for forty
 * moves and then lose.
 */
export function evaluate(g: Othello, p: Player, greedy = false): number {
  const { black, white } = g.counts();
  const mine = p === BLACK ? black : white;
  const theirs = p === BLACK ? white : black;
  if (greedy) return mine - theirs;

  const filled = black + white;
  const late = Math.max(0, Math.min(1, (filled - 44) / 20));   // 0 until move ~44, 1 at the end

  let pos = 0;
  for (let i = 0; i < CELLS; i++) {
    const cell = g.board[i];
    if (!cell) continue;
    pos += (cell - 1 === p ? 1 : -1) * WEIGHTS[i];
  }
  // A square beside a corner is only a liability while the corner is still
  // there to be lost. Once it is settled, the penalty is a lie.
  for (const c of CORNERS) {
    if (g.board[c] === 0) continue;
    const ownsCorner = g.board[c] - 1 === p;
    for (const n of NEAR_CORNER[c]) {
      if (g.board[n] === 0) continue;
      const ownsNear = g.board[n] - 1 === p;
      // Undo the static penalty, and add a small bonus for holding the wall
      // beside a corner that is already yours.
      pos += (ownsNear ? 1 : -1) * (WEIGHTS[n] < 0 ? -WEIGHTS[n] : 0) * (ownsCorner === ownsNear ? 1 : 0.4);
    }
  }

  const myMoves = g.legalMoves(p).length;
  const theirMoves = g.legalMoves(other(p)).length;
  const mobility = myMoves + theirMoves ? (100 * (myMoves - theirMoves)) / (myMoves + theirMoves) : 0;

  const myFront = frontier(g, p);
  const theirFront = frontier(g, other(p));
  const front = myFront + theirFront ? (60 * (theirFront - myFront)) / (myFront + theirFront) : 0;

  const discs = mine + theirs ? (100 * (mine - theirs)) / (mine + theirs) : 0;

  return (1 - late) * (pos * 1.0 + mobility * 10 + front * 6) + late * (discs * 30 + pos * 0.2);
}

export function search(g: Othello, limits: Limits): SearchResult {
  const deadline = now() + limits.timeMs;
  let nodes = 0;
  let stopped = false;
  const me = g.toPlay;

  const outOfTime = (): boolean => {
    if ((nodes & 511) !== 0) return stopped;
    if (now() >= deadline) stopped = true;
    return stopped;
  };

  /** The last squares, played out to the end: the score is the final disc
   *  difference and nothing is estimated. */
  const exact = limits.exactFrom > 0 && g.empties <= limits.exactFrom;

  const finished = (p: Player): number => {
    const { black, white } = g.counts();
    const diff = p === BLACK ? black - white : white - black;
    return diff === 0 ? 0 : Math.sign(diff) * (WIN - 1000 + Math.abs(diff));
  };

  /** Ordered best-guess-first, which is most of what makes alpha-beta work.
   *  Corners first, X-squares last, and otherwise the shape it leaves. */
  const ordered = (moves: number[]): number[] =>
    moves.map((m) => ({ m, s: WEIGHTS[m] })).sort((a, b) => b.s - a.s).map((e) => e.m);

  const negamax = (depth: number, alpha: number, beta: number): number => {
    nodes++;
    if (g.over) return finished(g.toPlay);
    if (outOfTime()) return evaluate(g, g.toPlay, limits.greedy);
    if (depth <= 0 && !exact) return evaluate(g, g.toPlay, limits.greedy);

    const moves = g.legalMoves();
    // `make` passes for the side with nothing, so an empty list here means
    // the game is over, which is already handled above.
    let best = -Infinity;
    for (const m of ordered(moves)) {
      const was = g.toPlay;
      g.make(m);
      // The opponent may have had to pass, in which case it is still this
      // player's move and the score is NOT negated. Getting this wrong makes
      // an engine that throws away every game containing a pass.
      const v = g.toPlay === was
        ? negamax(depth - 1, alpha, beta)
        : -negamax(depth - 1, -beta, -alpha);
      g.unmake();
      if (v > best) best = v;
      if (best > alpha) alpha = best;
      if (alpha >= beta) break;
    }
    return best === -Infinity ? evaluate(g, g.toPlay, limits.greedy) : best;
  };

  let roots: RootMove[] = g.legalMoves().map((move) => ({ move, score: -Infinity }));
  let reached = 0;
  const maxDepth = exact ? g.empties : limits.depth;

  for (let depth = 1; depth <= maxDepth; depth++) {
    const scored: RootMove[] = [];
    let alpha = -Infinity;
    for (const { move } of roots) {
      const was = g.toPlay;
      g.make(move);
      const v = g.toPlay === was
        ? negamax(depth - 1, alpha, Infinity)
        : -negamax(depth - 1, -Infinity, -alpha);
      g.unmake();
      if (stopped) break;
      scored.push({ move, score: v });
      if (v > alpha) alpha = v;
    }
    // A half-finished iteration is worse than none: the moves it looked at
    // were scored against an alpha the others never faced.
    if (stopped || scored.length !== roots.length) break;
    scored.sort((a, b) => b.score - a.score);
    roots = scored;
    reached = depth;
  }

  const top = roots[0]?.score ?? 0;
  const solved = exact && !stopped && reached === maxDepth;
  return {
    roots,
    depth: reached,
    nodes,
    score: top,
    ...(solved ? { exact: Math.sign(top) * (Math.abs(top) - (WIN - 1000)) } : {}),
  };
}

/** Which side the engine plays. The player is Black and moves first: the
 *  beginner should be the one who opens. */
export const ENGINE: Player = WHITE;
