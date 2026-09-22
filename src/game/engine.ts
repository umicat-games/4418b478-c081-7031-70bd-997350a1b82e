// The opponent's head: alpha-beta over the same rules the player moves
// through, with a pattern-counting evaluation.
//
// Gomoku is the game where a hand-written engine is most obviously enough.
// The position is a small number of shapes with known values — five, an open
// four, a four, an open three — and counting them is all the evaluation
// anybody needs. What makes a gomoku engine *feel* strong is not depth, it is
// never missing something that is on the board right now, so the search is
// wrapped in two exact checks:
//
//   if I can make five, make it;
//   if the opponent can make five, block it — and if they can do it in two
//   different places, the game is already lost and there is no point pretending
//   otherwise.
//
// Those two come from `Gomoku.threats()`, the referee's exact function, and
// they run once per move rather than per node. Everything deeper is the fast
// approximation below. The rule of the house: **the engine may approximate,
// the assistant may not** — anything the assistant says out loud comes from
// the referee.
//
// The other thing that makes this feasible: candidates are only cells near
// stones (`relevant`), ordered by how much they change the local shape, and
// only the best handful are searched. A gomoku board has 225 empty cells and
// searching all of them four deep is 2.5 billion positions; searching twelve
// of them is thirty thousand.
import { BLACK, Gomoku, type Player, other } from './rules';

/** What a shape is worth. Five is beyond anything; an open four wins next
 *  move whatever the answer; a four and an open three both force a reply. */
const FIVE = 10_000_000;
const OPEN_FOUR = 200_000;
const FOUR = 10_000;
const OPEN_THREE = 12_000;
const THREE = 800;
const OPEN_TWO = 120;
const TWO = 20;

/** How much more a threat against ME matters than the same threat of mine.
 *  Above 1 the engine answers before it attacks — which is the difference
 *  between an opponent that plays a game and one that races and loses. */
const DEFENCE = 1.15;

export const MATE = FIVE;

/**
 * Count the shapes on the board for one player.
 *
 * Runs of same-coloured stones, with their ends noted: a run with two open
 * ends is worth far more than the same run walled in. Each run is counted
 * once — the walk starts only where a run starts — which is the bug to look
 * for if the numbers ever look doubled.
 */
export function score(g: Gomoku, p: Player): number {
  const stone = p + 1;
  const n = g.size;
  let total = 0;
  const dirs: Array<[number, number]> = [[1, 0], [0, 1], [1, 1], [1, -1]];

  for (const [dx, dy] of dirs) {
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        if (g.board[g.idx(x, y)] !== stone) continue;
        // Only from the start of a run.
        const px = x - dx, py = y - dy;
        if (g.inside(px, py) && g.board[g.idx(px, py)] === stone) continue;

        let len = 0;
        let cx = x, cy = y;
        while (g.inside(cx, cy) && g.board[g.idx(cx, cy)] === stone) { len++; cx += dx; cy += dy; }
        const openAhead = g.inside(cx, cy) && g.board[g.idx(cx, cy)] === 0;
        const openBehind = g.inside(px, py) && g.board[g.idx(px, py)] === 0;
        const open = (openAhead ? 1 : 0) + (openBehind ? 1 : 0);

        if (len >= 5) total += FIVE;
        else if (len === 4) total += open === 2 ? OPEN_FOUR : open === 1 ? FOUR : 0;
        else if (len === 3) total += open === 2 ? OPEN_THREE : open === 1 ? THREE : 0;
        else if (len === 2) total += open === 2 ? OPEN_TWO : open === 1 ? TWO : 0;
      }
    }
  }
  return total;
}

/** The position from `p`'s point of view. */
export function evaluate(g: Gomoku, p: Player): number {
  return score(g, p) - DEFENCE * score(g, other(p));
}

/**
 * What one line through a cell would be worth if `p` played there.
 *
 * LOCAL on purpose. The first version of this asked the whole board what it
 * was worth before and after — three full scans per candidate, sixty
 * candidates a node, and the engine spent 600ms on a move it could make in
 * 40. Nothing outside the four lines through a cell changes when a stone
 * lands on it, so nothing outside them needs looking at.
 */
function lineValue(g: Gomoku, i: number, p: Player, dx: number, dy: number): number {
  const stone = p + 1;
  const x = g.xOf(i), y = g.yOf(i);
  let len = 1;
  let open = 0;
  for (const sign of [1, -1]) {
    let k = 1;
    for (; ; k++) {
      const nx = x + dx * sign * k, ny = y + dy * sign * k;
      if (!g.inside(nx, ny) || g.board[g.idx(nx, ny)] !== stone) break;
      len++;
    }
    const ex = x + dx * sign * k, ey = y + dy * sign * k;
    if (g.inside(ex, ey) && g.board[g.idx(ex, ey)] === 0) open++;
  }
  if (len >= 5) return FIVE;
  if (len === 4) return open === 2 ? OPEN_FOUR : open === 1 ? FOUR : 0;
  if (len === 3) return open === 2 ? OPEN_THREE : open === 1 ? THREE : 0;
  if (len === 2) return open === 2 ? OPEN_TWO : open === 1 ? TWO : 0;
  return open * 2;
}

/** How interesting a cell is, for ordering — what it does for me plus what it
 *  denies them. Cheap on purpose: it runs on every candidate at every node. */
function cellScore(g: Gomoku, i: number, p: Player): number {
  let mine = 0, theirs = 0;
  for (const [dx, dy] of [[1, 0], [0, 1], [1, 1], [1, -1]] as Array<[number, number]>) {
    mine += lineValue(g, i, p, dx, dy);
    theirs += lineValue(g, i, other(p), dx, dy);
  }
  return mine + theirs * 0.9;
}

export interface RootMove { move: number; score: number }
export interface SearchResult {
  roots: RootMove[];
  depth: number;
  nodes: number;
  score: number;
  /** Set when the position is already decided: +1 the side to move wins by
   *  force, -1 it loses by force. */
  decided?: number;
}

export interface Limits {
  depth: number;
  timeMs: number;
  /** How many candidates to look at per node. The single biggest lever on
   *  both strength and speed. */
  width: number;
}

const now = (): number => (typeof performance !== 'undefined' ? performance.now() : Date.now());

export function search(g: Gomoku, limits: Limits): SearchResult {
  const deadline = now() + limits.timeMs;
  let nodes = 0;
  let stopped = false;
  const me = g.toPlay;

  const outOfTime = (): boolean => {
    if ((nodes & 255) !== 0) return stopped;
    if (now() >= deadline) stopped = true;
    return stopped;
  };

  /** The best `width` cells to try here, already ordered. */
  const candidates = (p: Player, width: number): number[] => {
    const cells = g.relevant(2);
    return cells
      .map((i) => ({ i, s: cellScore(g, i, p) }))
      .sort((a, b) => b.s - a.s)
      .slice(0, width)
      .map((e) => e.i);
  };

  const negamax = (p: Player, depth: number, alpha: number, beta: number): number => {
    nodes++;
    if (outOfTime()) return evaluate(g, p);
    // A five on the board ends it, whoever just made it.
    const last = g.last;
    if (last !== null && g.lineThrough(last)) {
      return g.board[last] - 1 === p ? FIVE : -FIVE;
    }
    if (depth <= 0) return evaluate(g, p);

    let best = -Infinity;
    for (const i of candidates(p, Math.max(4, limits.width - (limits.depth - depth)))) {
      g.play(i);
      const v = -negamax(other(p), depth - 1, -beta, -alpha);
      g.undo();
      if (v > best) best = v;
      if (best > alpha) alpha = best;
      if (alpha >= beta) break;
    }
    return best === -Infinity ? evaluate(g, p) : best;
  };

  // ── the two exact checks, before any search ────────────────────────────
  //
  // These come from the referee, not from the evaluation, because "there is a
  // five available right now" is a fact and the evaluation is an opinion.
  // Only the cheap half of the referee's threat functions: "who can make five
  // right now" is one poke per cell, while "who has an open three" walks the
  // whole reply tree and cost this search a quarter of a second per move when
  // it was asked for here. The assistant asks the expensive one; the engine
  // does not need it, because the search finds those shapes itself.
  const cells = g.relevant(4);
  const mineWin = g.winningCells(me, cells);
  const theirsWin = g.winningCells(other(me), cells);

  if (mineWin.length) {
    return { roots: mineWin.map((move) => ({ move, score: FIVE })), depth: 0, nodes, score: FIVE, decided: 1 };
  }
  if (theirsWin.length >= 2) {
    // Two ways to make five and only one stone to play: lost. Block one of
    // them anyway — resigning on the player's behalf is not this function's
    // job, and people do miss their own wins.
    return { roots: theirsWin.map((move) => ({ move, score: -FIVE })), depth: 0, nodes, score: -FIVE, decided: -1 };
  }
  // Exactly one: it is that cell or nothing.
  const forced = theirsWin.length === 1 ? theirsWin : null;

  let roots: RootMove[] = (forced ?? candidates(me, Math.max(limits.width, 8)))
    .map((move) => ({ move, score: -Infinity }));
  let reached = 0;

  for (let depth = 1; depth <= limits.depth; depth++) {
    const scored: RootMove[] = [];
    let alpha = -Infinity;
    for (const { move } of roots) {
      g.play(move);
      const v = -negamax(other(me), depth - 1, -Infinity, -alpha);
      g.undo();
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
    if (Math.abs(roots[0].score) >= FIVE) break;
  }

  const top = roots[0]?.score ?? 0;
  return {
    roots,
    depth: reached,
    nodes,
    score: top,
    ...(Math.abs(top) >= FIVE ? { decided: top > 0 ? 1 : -1 } : {}),
  };
}
