// The opponent's head: alpha-beta search over the same rules the player moves
// through.
//
// Why this is written here rather than vendored, which is the opposite of what
// the Go game did: every strong open-source xiangqi engine — Pikafish,
// ElephantEye, XQWLight — is GPL, and linking one into a game distributed on
// the platform would put the whole game under GPL. Go was lucky (KataGo is MIT
// and its network is CC0); xiangqi has no such option.
//
// And it does not need one. Go is the game where hand-written evaluation fails
// and neural search is the only thing that works. Xiangqi is the opposite: the
// position is about material and attacked squares, both of which a table and a
// few hundred thousand nodes handle perfectly well. This will not beat anyone
// who studies the game. It plays a real, legal, non-embarrassing game of
// xiangqi, which is what was asked for.
//
// The search is plain and deliberately so:
//
//   iterative deepening      so a time limit can stop it anywhere and still
//                            leave a complete answer behind
//   fail-soft alpha-beta     with killers and a history table for ordering
//   quiescence on captures   without it, the search "wins" a chariot on the
//                            last ply and never sees it recaptured — the one
//                            bug that makes an engine look mad
//   check extensions         a forced sequence is not a place to stop counting
//
// Strength is depth plus temperature over the engine's OWN root moves, exactly
// as in the Go game and for the same reason: a random legal move is not a
// weaker player, it is a move no human would make, and a beginner shown one
// learns something false.
import {
  CANNON, CHARIOT, ELEPHANT, HORSE, KING, SOLDIER, ADVISOR,
  Position, RED, SQUARES, fileOf, moveFrom, moveTo, rankOf, sideOf, typeOf,
  type Move, type PieceType, type Side,
} from './rules';

/** What a piece is worth, in hundredths of a soldier. A chariot is worth about
 *  two horses, a cannon sits between them, and the guards are worth keeping
 *  precisely because a cannon without a screen to shoot over is half a piece. */
const VALUE: Record<PieceType, number> = {
  [KING]: 10000,
  [ADVISOR]: 200,
  [ELEPHANT]: 200,
  [HORSE]: 400,
  [CHARIOT]: 900,
  [CANNON]: 450,
  [SOLDIER]: 100,
};

const MATE = 30000;

/**
 * Where a piece would rather be, from Red's side of the river.
 *
 * Written out here rather than borrowed, and kept coarse on purpose — these
 * tables are the difference between an engine that shuffles and one that
 * develops, and past that the depth does the work.
 */
function buildTables(): Record<PieceType, Int16Array> {
  const t = {} as Record<PieceType, Int16Array>;
  for (const type of [KING, ADVISOR, ELEPHANT, HORSE, CHARIOT, CANNON, SOLDIER] as PieceType[]) {
    t[type] = new Int16Array(SQUARES);
  }
  for (let s = 0; s < SQUARES; s++) {
    const x = fileOf(s), y = rankOf(s);
    const centre = 4 - Math.abs(x - 4);      // 4 on the middle file, 0 at the edge
    const crossed = y <= 4;                  // Red has crossed the river
    const advance = 9 - y;                   // how far up the board

    // A soldier is worth more the moment it crosses, and most of all when it
    // is two or three ranks into the enemy's half with a file to work on. On
    // the very last rank it can only shuffle sideways, so it is worth less.
    t[SOLDIER][s] = crossed ? [40, 70, 90, 80, 60][Math.max(0, Math.min(4, 4 - y))] + centre * 3 : advance * 2;
    // Horses hate edges and back ranks and love the middle of the board.
    t[HORSE][s] = centre * 4 + (crossed ? 18 : 0) + (y === 9 ? -18 : 0);
    // A cannon's whole game is the central file and the enemy's half.
    t[CANNON][s] = centre * 5 + (x === 4 ? 12 : 0) + (crossed ? 6 : 0);
    // Chariots want to be off the back rank and on open ground.
    t[CHARIOT][s] = centre * 3 + (y === 9 ? -12 : 10) + (crossed ? 8 : 0);
    // The guards are worth exactly as much as being at home. Anywhere else is
    // impossible for them anyway; this keeps the table honest.
    t[ADVISOR][s] = 0;
    t[ELEPHANT][s] = 0;
    // A king that has wandered up its palace is a king about to be checked.
    t[KING][s] = y === 9 ? 6 : 0;
  }
  return t;
}
const TABLE = buildTables();
/** The same square from the other side of the board. */
const mirror = (s: number): number => (9 - rankOf(s)) * 9 + fileOf(s);

/** Material plus position, from the point of view of the side to move. */
export function evaluate(pos: Position): number {
  let score = 0;
  for (let s = 0; s < SQUARES; s++) {
    const code = pos.board[s];
    if (!code) continue;
    const type = typeOf(code);
    const side = sideOf(code);
    const worth = VALUE[type] + TABLE[type][side === RED ? s : mirror(s)];
    score += side === RED ? worth : -worth;
  }
  return pos.side === RED ? score : -score;
}

export interface RootMove { move: Move; score: number }

export interface SearchResult {
  /** Every root move with a score, best first — what the level's temperature
   *  picks from, and what the assistant is allowed to talk about. */
  roots: RootMove[];
  /** How deep it actually got before the clock ran out. */
  depth: number;
  nodes: number;
  /** Positive means the side to move is better off, in hundredths of a soldier. */
  score: number;
  /** Plies to mate, when the search found one. Negative means being mated. */
  mateIn?: number;
}

export interface SearchLimits {
  depth: number;
  /** Milliseconds. The search stops between iterations and, roughly, inside
   *  them — it is a budget, not a guarantee. */
  timeMs: number;
}

const now = (): number => (typeof performance !== 'undefined' ? performance.now() : Date.now());

export function search(pos: Position, limits: SearchLimits): SearchResult {
  const deadline = now() + limits.timeMs;
  const killers: Move[][] = Array.from({ length: 64 }, () => []);
  const history = new Int32Array(SQUARES * SQUARES);
  let nodes = 0;
  let stopped = false;

  const outOfTime = (): boolean => {
    // Checked every few thousand nodes: `performance.now()` in the inner loop
    // costs more than the search it is guarding.
    if ((nodes & 1023) !== 0) return stopped;
    if (now() >= deadline) stopped = true;
    return stopped;
  };

  /** Most valuable victim, least valuable attacker — plus the history of what
   *  has caused cut-offs before. Ordering is most of what makes this fast. */
  const scoreMove = (m: Move, ply: number): number => {
    const victim = pos.board[moveTo(m)];
    if (victim) return 1_000_000 + VALUE[typeOf(victim)] * 16 - VALUE[typeOf(pos.board[moveFrom(m)])];
    if (killers[ply]?.includes(m)) return 900_000;
    return history[moveFrom(m) * SQUARES + moveTo(m)];
  };

  const ordered = (moves: Move[], ply: number): Move[] =>
    moves.map((m) => ({ m, s: scoreMove(m, ply) })).sort((a, b) => b.s - a.s).map((e) => e.m);

  /** Captures only, until the position stops exploding. */
  const quiesce = (alpha: number, beta: number, ply: number): number => {
    nodes++;
    const stand = evaluate(pos);
    if (stand >= beta) return stand;
    if (stand > alpha) alpha = stand;
    if (ply > 32 || outOfTime()) return stand;

    let best = stand;
    for (const m of ordered(pos.pseudoMoves(pos.side, true), ply)) {
      const side = pos.side;
      pos.make(m);
      if (pos.inCheck(side) || pos.kingsFacing()) { pos.unmake(); continue; }
      const score = -quiesce(-beta, -alpha, ply + 1);
      pos.unmake();
      if (score > best) best = score;
      if (score > alpha) alpha = score;
      if (alpha >= beta) break;
    }
    return best;
  };

  const negamax = (depth: number, alpha: number, beta: number, ply: number): number => {
    if (outOfTime()) return evaluate(pos);
    nodes++;

    const inCheck = pos.inCheck();
    // A forced sequence is not a place to stop counting.
    if (inCheck) depth += 1;
    if (depth <= 0) return quiesce(alpha, beta, ply);

    let best = -MATE - 1;
    let legal = 0;
    for (const m of ordered(pos.pseudoMoves(), ply)) {
      const side = pos.side;
      pos.make(m);
      if (pos.inCheck(side) || pos.kingsFacing()) { pos.unmake(); continue; }
      legal++;
      const score = -negamax(depth - 1, -beta, -alpha, ply + 1);
      pos.unmake();

      if (score > best) best = score;
      if (score > alpha) {
        alpha = score;
        if (!pos.board[moveTo(m)]) history[moveFrom(m) * SQUARES + moveTo(m)] += depth * depth;
      }
      if (alpha >= beta) {
        if (!pos.board[moveTo(m)]) {
          const k = killers[ply];
          if (k[0] !== m) killers[ply] = [m, k[0]].filter((x) => x !== undefined) as Move[];
        }
        break;
      }
    }

    // No legal move is a loss either way — mated or merely stuck. The ply is
    // in the score so that a mate in one is preferred to a mate in three.
    if (legal === 0) return -MATE + ply;
    return best;
  };

  // The root, scored move by move so the level can choose among them.
  let roots: RootMove[] = pos.legalMoves().map((move) => ({ move, score: -MATE }));
  let reached = 0;
  for (let depth = 1; depth <= limits.depth; depth++) {
    const scored: RootMove[] = [];
    let alpha = -MATE - 1;
    for (const { move } of roots) {
      pos.make(move);
      const score = -negamax(depth - 1, -MATE - 1, -alpha, 1);
      pos.unmake();
      if (stopped) break;
      scored.push({ move, score });
      if (score > alpha) alpha = score;
    }
    // A half-finished iteration is worse than none: the moves it did look at
    // are ordered by an alpha the others never faced.
    if (stopped || scored.length !== roots.length) break;
    scored.sort((a, b) => b.score - a.score);
    roots = scored;
    reached = depth;
    // A mate is a mate; deeper will not improve on it.
    if (Math.abs(roots[0].score) > MATE - 100) break;
  }

  const top = roots[0]?.score ?? 0;
  const mateIn = Math.abs(top) > MATE - 100
    ? (top > 0 ? MATE - top : -(MATE + top))
    : undefined;
  return { roots, depth: reached, nodes, score: top, ...(mateIn !== undefined ? { mateIn } : {}) };
}

/** Is this side's position hopeless enough to give up? Material only: an
 *  engine that resigns on a search score resigns to a blunder it is about to
 *  be shown to have imagined. */
export function materialBalance(pos: Position, side: Side): number {
  let mine = 0, theirs = 0;
  for (let s = 0; s < SQUARES; s++) {
    const code = pos.board[s];
    if (!code || typeOf(code) === KING) continue;
    if (sideOf(code) === side) mine += VALUE[typeOf(code)];
    else theirs += VALUE[typeOf(code)];
  }
  return mine - theirs;
}
