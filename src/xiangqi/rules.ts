// The rules of xiangqi, and nothing else.
//
// This file is the referee. Both the player and the engine move through it, so
// there is exactly one implementation of what a horse may do and not two that
// can disagree; and the engine's search calls `make`/`unmake` on the same
// board the player is looking at, which is what keeps "what the engine thinks
// it is searching" and "what is on screen" the same position.
//
// Getting this right matters more here than playing strength does. A weak
// opponent is a pleasant game; an opponent that moves a horse through a
// blocked leg is not a game at all. So the awkward rules — the ones casual
// implementations skip — are all here and all named:
//
//   蹩马腿   a horse is blocked by the piece on its orthogonal step
//   塞象眼   an elephant is blocked by the piece at the middle of its diagonal
//   过河     an elephant never crosses the river; a soldier that has may also
//            step sideways, and may never step back
//   炮打隔子 a cannon captures over exactly one screen, and moves like a
//            chariot only when it is not capturing
//   将帅照面 the two kings may never see each other down an open file, which
//            makes it illegal to MOVE into that, not merely bad
//   困毙     no legal move is a LOSS, not a draw as it is in western chess
//
// `tools/perft.mjs` walks the whole move tree from the opening position and
// compares the counts against the published ones (44 / 1920 / 79666 /
// 3290240). Those numbers only come out right if every rule above is right,
// which is why they are the test.
//
// Geometry: 9 files, 10 ranks, and the array runs TOP TO BOTTOM — `y = 0` is
// Black's back line, `y = 9` is Red's. Coordinates spoken out loud are the
// other way up; `coords.ts` owns that flip.

export type Side = 0 | 1;
export const RED: Side = 0;
export const BLACK: Side = 1;
export const other = (s: Side): Side => (s === RED ? BLACK : RED);

/** Piece types. The code stored on the board is `type | side << 3`, so an
 *  empty square is 0 and nothing else can be. */
export const KING = 1, ADVISOR = 2, ELEPHANT = 3, HORSE = 4, CHARIOT = 5, CANNON = 6, SOLDIER = 7;
export type PieceType = 1 | 2 | 3 | 4 | 5 | 6 | 7;

export const pieceCode = (side: Side, type: PieceType): number => type | (side << 3);
export const typeOf = (code: number): PieceType => (code & 7) as PieceType;
export const sideOf = (code: number): Side => ((code >> 3) & 1) as Side;

export const FILES = 9;
export const RANKS = 10;
export const SQUARES = FILES * RANKS;

export const sq = (x: number, y: number): number => y * FILES + x;
export const fileOf = (s: number): number => s % FILES;
export const rankOf = (s: number): number => (s / FILES) | 0;
const onBoard = (x: number, y: number): boolean => x >= 0 && x < FILES && y >= 0 && y < RANKS;

/** A move is one integer: `from | to << 7`. Cheap to push by the thousand in
 *  a search, which is the only reason it is not an object. */
export type Move = number;
export const mv = (from: number, to: number): Move => from | (to << 7);
export const moveFrom = (m: Move): number => m & 127;
export const moveTo = (m: Move): number => (m >> 7) & 127;

const ORTHO: Array<[number, number]> = [[0, -1], [0, 1], [-1, 0], [1, 0]];
const DIAG: Array<[number, number]> = [[-1, -1], [1, -1], [-1, 1], [1, 1]];
const HORSE_STEPS: Array<[number, number]> = [
  [1, 2], [2, 1], [-1, 2], [-2, 1], [1, -2], [2, -1], [-1, -2], [-2, -1],
];

/** Inside your own palace — the three-by-three the king and advisors never
 *  leave. Red's is at the bottom of the array, Black's at the top. */
const inPalace = (side: Side, x: number, y: number): boolean =>
  x >= 3 && x <= 5 && (side === RED ? y >= 7 : y <= 2);

/** Your own half of the river. Elephants never leave it. */
const ownHalf = (side: Side, y: number): boolean => (side === RED ? y >= 5 : y <= 4);

/** Which way a soldier faces: Red marches up the array, Black down it. */
const forward = (side: Side): number => (side === RED ? -1 : 1);

/** The piece a horse's leg stands on, for a move of (dx, dy). */
const horseLeg = (x: number, y: number, dx: number, dy: number): number =>
  (Math.abs(dx) === 2 ? sq(x + dx / 2, y) : sq(x, y + dy / 2));

export const START_LAYOUT: string[] = [
  'rnbakabnr',
  '.........',
  '.c.....c.',
  'p.p.p.p.p',
  '.........',
  '.........',
  'P.P.P.P.P',
  '.C.....C.',
  '.........',
  'RNBAKABNR',
];

const LETTERS: Record<string, PieceType> = {
  k: KING, a: ADVISOR, b: ELEPHANT, n: HORSE, r: CHARIOT, c: CANNON, p: SOLDIER,
};

/** What Black gives away before the game starts, when the player wants a head
 *  start. Removing material is the only handicap xiangqi has — there is no
 *  equivalent of Go's extra stones, because Red already moves first. */
export type Handicap = 'none' | 'horse' | 'horses' | 'chariot';
const HANDICAP_SQUARES: Record<Handicap, Array<[number, number]>> = {
  none: [],
  horse: [[7, 0]],
  horses: [[1, 0], [7, 0]],
  chariot: [[0, 0]],
};

export interface PieceOnBoard { square: number; code: number; side: Side; type: PieceType }

/**
 * A position, and the moves that can be made from it.
 *
 * Mutable on purpose: the engine makes and unmakes a hundred thousand moves a
 * second and cannot afford to copy a board for each one. Everything that
 * `make` needs in order to undo itself goes on `history`.
 */
export class Position {
  readonly board = new Int8Array(SQUARES);
  side: Side = RED;
  /** Where each king is, kept up to date by `make` — check detection asks for
   *  it on every node and scanning ninety squares for it is the single most
   *  expensive thing a naive engine does. */
  readonly kings: [number, number] = [-1, -1];
  private readonly history: Array<{ move: Move; captured: number }> = [];

  static fromLayout(layout: string[], handicap: Handicap = 'none'): Position {
    const p = new Position();
    layout.forEach((row, y) => {
      [...row].forEach((ch, x) => {
        if (ch === '.') return;
        const type = LETTERS[ch.toLowerCase()];
        if (!type) throw new Error(`unknown piece "${ch}"`);
        const side: Side = ch === ch.toUpperCase() ? RED : BLACK;
        p.board[sq(x, y)] = pieceCode(side, type);
      });
    });
    for (const [x, y] of HANDICAP_SQUARES[handicap]) p.board[sq(x, y)] = 0;
    p.findKings();
    return p;
  }

  static start(handicap: Handicap = 'none'): Position { return Position.fromLayout(START_LAYOUT, handicap); }

  /** Rebuild a position from the raw squares — how a board crosses into the
   *  search worker, where classes do not survive the trip. */
  static fromBoard(board: ArrayLike<number>, side: Side): Position {
    const p = new Position();
    for (let s = 0; s < SQUARES; s++) p.board[s] = board[s];
    p.side = side;
    p.findKings();
    return p;
  }

  clone(): Position {
    const p = new Position();
    p.board.set(this.board);
    p.side = this.side;
    p.kings[0] = this.kings[0];
    p.kings[1] = this.kings[1];
    return p;
  }

  // Called by `fromBoard`, which is outside the instance.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  private findKings(): void {
    this.kings[0] = this.kings[1] = -1;
    for (let s = 0; s < SQUARES; s++) {
      const code = this.board[s];
      if (code && typeOf(code) === KING) this.kings[sideOf(code)] = s;
    }
  }

  pieces(): PieceOnBoard[] {
    const out: PieceOnBoard[] = [];
    for (let s = 0; s < SQUARES; s++) {
      const code = this.board[s];
      if (code) out.push({ square: s, code, side: sideOf(code), type: typeOf(code) });
    }
    return out;
  }

  at(x: number, y: number): number { return this.board[sq(x, y)]; }

  // ── moving ──────────────────────────────────────────────────────────────

  make(m: Move): void {
    const from = moveFrom(m), to = moveTo(m);
    const moved = this.board[from];
    const captured = this.board[to];
    this.history.push({ move: m, captured });
    this.board[to] = moved;
    this.board[from] = 0;
    if (typeOf(moved) === KING) this.kings[sideOf(moved)] = to;
    this.side = other(this.side);
  }

  unmake(): void {
    const last = this.history.pop();
    if (!last) return;
    const from = moveFrom(last.move), to = moveTo(last.move);
    const moved = this.board[to];
    this.board[from] = moved;
    this.board[to] = last.captured;
    if (typeOf(moved) === KING) this.kings[sideOf(moved)] = from;
    this.side = other(this.side);
  }

  // ── generating ──────────────────────────────────────────────────────────

  /**
   * Every move the pieces could make, before asking whether it leaves the king
   * hanging. Pseudo-legal and legal are kept apart because the search wants to
   * order moves before it pays for the legality test on each one.
   */
  pseudoMoves(side: Side = this.side, capturesOnly = false): Move[] {
    const out: Move[] = [];
    const push = (from: number, x: number, y: number): void => {
      if (!onBoard(x, y)) return;
      const target = this.board[sq(x, y)];
      if (target && sideOf(target) === side) return;
      if (capturesOnly && !target) return;
      out.push(mv(from, sq(x, y)));
    };

    for (let from = 0; from < SQUARES; from++) {
      const code = this.board[from];
      if (!code || sideOf(code) !== side) continue;
      const x = fileOf(from), y = rankOf(from);

      switch (typeOf(code)) {
        case KING:
          for (const [dx, dy] of ORTHO) {
            if (inPalace(side, x + dx, y + dy)) push(from, x + dx, y + dy);
          }
          break;

        case ADVISOR:
          for (const [dx, dy] of DIAG) {
            if (inPalace(side, x + dx, y + dy)) push(from, x + dx, y + dy);
          }
          break;

        case ELEPHANT:
          for (const [dx, dy] of DIAG) {
            const nx = x + dx * 2, ny = y + dy * 2;
            // 塞象眼 — and never across the river, which is what makes an
            // elephant a defensive piece rather than a bishop.
            if (!onBoard(nx, ny) || !ownHalf(side, ny)) continue;
            if (this.board[sq(x + dx, y + dy)]) continue;
            push(from, nx, ny);
          }
          break;

        case HORSE:
          for (const [dx, dy] of HORSE_STEPS) {
            const nx = x + dx, ny = y + dy;
            if (!onBoard(nx, ny)) continue;
            if (this.board[horseLeg(x, y, dx, dy)]) continue; // 蹩马腿
            push(from, nx, ny);
          }
          break;

        case CHARIOT:
          for (const [dx, dy] of ORTHO) {
            for (let nx = x + dx, ny = y + dy; onBoard(nx, ny); nx += dx, ny += dy) {
              const target = this.board[sq(nx, ny)];
              if (!target) { if (!capturesOnly) out.push(mv(from, sq(nx, ny))); continue; }
              if (sideOf(target) !== side) out.push(mv(from, sq(nx, ny)));
              break;
            }
          }
          break;

        case CANNON:
          for (const [dx, dy] of ORTHO) {
            let nx = x + dx, ny = y + dy;
            // Quiet moves: exactly a chariot's, up to the first piece.
            for (; onBoard(nx, ny) && !this.board[sq(nx, ny)]; nx += dx, ny += dy) {
              if (!capturesOnly) out.push(mv(from, sq(nx, ny)));
            }
            // Then one screen, and the first piece BEYOND it is the target.
            if (!onBoard(nx, ny)) continue;
            for (nx += dx, ny += dy; onBoard(nx, ny); nx += dx, ny += dy) {
              const target = this.board[sq(nx, ny)];
              if (!target) continue;
              if (sideOf(target) !== side) out.push(mv(from, sq(nx, ny)));
              break;
            }
          }
          break;

        case SOLDIER: {
          const dy = forward(side);
          push(from, x, y + dy);
          // Sideways only once it has crossed — and never, ever backwards.
          if (!ownHalf(side, y)) { push(from, x - 1, y); push(from, x + 1, y); }
          break;
        }
      }
    }
    return out;
  }

  /** The moves that may actually be played: pseudo-legal, minus the ones that
   *  leave your own king in check or facing the other one. */
  legalMoves(side: Side = this.side): Move[] {
    return this.pseudoMoves(side).filter((m) => this.isLegal(m, side));
  }

  /** Does this move leave the position legal for the side that made it? */
  isLegal(m: Move, side: Side = this.side): boolean {
    this.make(m);
    const ok = !this.inCheck(side) && !this.kingsFacing();
    this.unmake();
    return ok;
  }

  /** Is this square attacked by that side? The one hot function in the whole
   *  engine — it runs from the king outwards rather than over every piece. */
  attacked(target: number, by: Side): boolean {
    const x = fileOf(target), y = rankOf(target);

    // Chariots (the first piece down a line) and cannons (the first piece past
    // exactly one screen) share one walk.
    for (const [dx, dy] of ORTHO) {
      let nx = x + dx, ny = y + dy;
      for (; onBoard(nx, ny) && !this.board[sq(nx, ny)]; nx += dx, ny += dy) { /* empty */ }
      if (!onBoard(nx, ny)) continue;
      const first = this.board[sq(nx, ny)];
      if (sideOf(first) === by) {
        const t = typeOf(first);
        if (t === CHARIOT) return true;
        // Kings attack the square next to them; the facing-kings rule is a
        // separate test, because it is about legality rather than about check.
        if (t === KING && Math.abs(nx - x) + Math.abs(ny - y) === 1) return true;
        if (t === SOLDIER && Math.abs(nx - x) + Math.abs(ny - y) === 1) {
          // Forwards onto the square, or sideways once it has crossed.
          if (nx === x && ny - y === -forward(by)) return true;
          if (ny === y && !ownHalf(by, ny)) return true;
        }
      }
      for (nx += dx, ny += dy; onBoard(nx, ny); nx += dx, ny += dy) {
        const second = this.board[sq(nx, ny)];
        if (!second) continue;
        if (sideOf(second) === by && typeOf(second) === CANNON) return true;
        break;
      }
    }

    // Horses, from the eight squares one could stand on — with its leg, which
    // is a square adjacent to the HORSE and so depends on where it stands.
    for (const [dx, dy] of HORSE_STEPS) {
      const hx = x + dx, hy = y + dy;
      if (!onBoard(hx, hy)) continue;
      const code = this.board[sq(hx, hy)];
      if (!code || sideOf(code) !== by || typeOf(code) !== HORSE) continue;
      if (this.board[horseLeg(hx, hy, -dx, -dy)]) continue; // 蹩马腿, for the attacker
      return true;
    }

    return false;
  }

  inCheck(side: Side = this.side): boolean {
    const king = this.kings[side];
    return king >= 0 && this.attacked(king, other(side));
  }

  /** 将帅照面 — the kings on one file with nothing in between. An illegal
   *  POSITION, whoever caused it, which is why it is tested after every move
   *  rather than generated as a move a king could make. */
  kingsFacing(): boolean {
    const a = this.kings[RED], b = this.kings[BLACK];
    if (a < 0 || b < 0) return false;
    if (fileOf(a) !== fileOf(b)) return false;
    const x = fileOf(a);
    const lo = Math.min(rankOf(a), rankOf(b)), hi = Math.max(rankOf(a), rankOf(b));
    for (let y = lo + 1; y < hi; y++) if (this.board[sq(x, y)]) return false;
    return true;
  }

  /** A key that is equal for equal positions, for repetition counting. Cheap
   *  and exact — a hash would be smaller and would eventually be wrong. */
  key(): string { return `${this.board.join('')}|${this.side}`; }

  /** The board as the assistant sees it: ten rows, Black's back line first. */
  diagram(): string[] {
    const chars = ['.', 'k', 'a', 'b', 'n', 'r', 'c', 'p'];
    const rows: string[] = [];
    for (let y = 0; y < RANKS; y++) {
      let row = '';
      for (let x = 0; x < FILES; x++) {
        const code = this.board[sq(x, y)];
        if (!code) { row += '.'; continue; }
        const ch = chars[typeOf(code)];
        row += sideOf(code) === RED ? ch.toUpperCase() : ch;
      }
      rows.push(row);
    }
    return rows;
  }
}

// ── the game around the position ──────────────────────────────────────────

/** A square, spoken. Defined here rather than imported so the rules stay a
 *  file with no dependencies at all. */
const iccs = (s: number): string => `${'abcdefghi'[fileOf(s)]}${9 - rankOf(s)}`;

export type Outcome =
  | { kind: 'playing' }
  | { kind: 'checkmate'; winner: Side }
  | { kind: 'stalemate'; winner: Side }
  | { kind: 'resign'; winner: Side }
  | { kind: 'perpetual'; winner: Side }
  | { kind: 'draw'; why: 'repetition' | 'quiet' };

export interface XiangqiSnapshot {
  handicap: Handicap;
  moves: Move[];
  resigned?: Side;
}

/** How many plies without a capture before the game is called a draw. Sixty
 *  moves each way is the tournament rule, and a game that reaches it has
 *  nothing left in it. */
const QUIET_LIMIT = 120;

export class XiangqiGame {
  readonly position: Position;
  readonly moves: Move[] = [];
  /** Pieces taken, by the side that took them — what the captured tray shows. */
  readonly captured: { 0: number[]; 1: number[] } = { 0: [], 1: [] };
  resignedBy: Side | null = null;

  /** One entry per ply reached, for repetition and for the quiet-move count. */
  private readonly seen = new Map<string, number>();
  private readonly checks: boolean[] = [];
  private quiet = 0;

  constructor(readonly handicap: Handicap = 'none', layout?: string[], side: Side = RED) {
    this.position = layout ? Position.fromLayout(layout) : Position.start(handicap);
    this.position.side = side;
    this.seen.set(this.position.key(), 1);
  }

  /** A game from a board somebody wrote out, rather than from the opening.
   *  The rule tests use it; a set-piece lesson would too. */
  static fromLayout(layout: string[], side: Side = RED): XiangqiGame {
    return new XiangqiGame('none', layout, side);
  }

  get toPlay(): Side { return this.position.side; }
  get over(): boolean { return this.outcome().kind !== 'playing'; }
  get lastMove(): { from: number; to: number } | null {
    const m = this.moves[this.moves.length - 1];
    return m === undefined ? null : { from: moveFrom(m), to: moveTo(m) };
  }

  legalMoves(): Move[] { return this.over ? [] : this.position.legalMoves(); }

  /** Every legal destination for the piece on this square — what the board
   *  shows when a piece is picked up, and what the assistant's `show_moves`
   *  reports. Empty when there is nothing there, or it is not yours. */
  movesFrom(square: number): number[] {
    if (this.over) return [];
    const code = this.position.board[square];
    if (!code || sideOf(code) !== this.toPlay) return [];
    return this.position.pseudoMoves(this.toPlay)
      .filter((m) => moveFrom(m) === square && this.position.isLegal(m))
      .map((m) => moveTo(m));
  }

  legal(from: number, to: number): boolean {
    if (this.over) return false;
    const code = this.position.board[from];
    if (!code || sideOf(code) !== this.toPlay) return false;
    const m = mv(from, to);
    return this.position.pseudoMoves(this.toPlay).includes(m) && this.position.isLegal(m);
  }

  /** Play it, if the rules take it. Returns the piece captured, `0` for none,
   *  or `null` when the move was refused — the board simply does not move. */
  play(from: number, to: number): number | null {
    if (!this.legal(from, to)) return null;
    const taken = this.position.board[to];
    this.position.make(mv(from, to));
    this.moves.push(mv(from, to));
    if (taken) { this.captured[sideOf(taken) === RED ? BLACK : RED].push(taken); this.quiet = 0; }
    else this.quiet += 1;
    // Recorded AFTER the move: "the side to play is in check", which is what a
    // perpetual check looks like from the position's side.
    this.checks.push(this.position.inCheck());
    const key = this.position.key();
    this.seen.set(key, (this.seen.get(key) ?? 0) + 1);
    return taken;
  }

  /** Take back the last move. Used by nothing in the game itself — the player
   *  cannot undo — but the probe and the engine's own bookkeeping want it. */
  undo(): void {
    const m = this.moves.pop();
    if (m === undefined) return;
    const key = this.position.key();
    const n = (this.seen.get(key) ?? 1) - 1;
    if (n <= 0) this.seen.delete(key); else this.seen.set(key, n);
    this.checks.pop();
    this.position.unmake();
    const to = moveTo(m);
    const taken = this.position.board[to];
    if (taken) this.captured[sideOf(taken) === RED ? BLACK : RED].pop();
  }

  resign(side: Side): void { this.resignedBy = side; }

  /** How many times the position after this move would have occurred. The
   *  engine asks before it commits: a move that walks into a third repetition
   *  is a draw it did not intend to agree to, and at the root it is free to
   *  pick its second-best move instead. */
  repetitionsAfter(from: number, to: number): number {
    this.position.make(mv(from, to));
    const n = (this.seen.get(this.position.key()) ?? 0) + 1;
    this.position.unmake();
    return n;
  }

  /**
   * How the game stands.
   *
   * No legal move is a LOSS in xiangqi — mated or merely stuck, you have lost,
   * and calling a stalemate a draw here would be a different game.
   *
   * Repetition is where this simplifies, and it is worth being honest about
   * it: the full Chinese rules judge a repeated position by WHY it repeats
   * (perpetual check loses, perpetual chase loses, mutual chase draws) and
   * that is a body of case law rather than a rule. What is implemented is the
   * part everybody agrees on — if one side checked on every repetition, that
   * side loses; otherwise the position is a draw — and the rest is left as a
   * draw rather than guessed at.
   */
  outcome(): Outcome {
    if (this.resignedBy !== null) return { kind: 'resign', winner: other(this.resignedBy) };
    if (this.quiet >= QUIET_LIMIT) return { kind: 'draw', why: 'quiet' };

    const repeated = (this.seen.get(this.position.key()) ?? 0) >= 3;
    if (repeated) {
      const perpetual = this.perpetualChecker();
      if (perpetual !== null) return { kind: 'perpetual', winner: other(perpetual) };
      return { kind: 'draw', why: 'repetition' };
    }

    if (this.position.legalMoves().length === 0) {
      return this.position.inCheck()
        ? { kind: 'checkmate', winner: other(this.toPlay) }
        : { kind: 'stalemate', winner: other(this.toPlay) };
    }
    return { kind: 'playing' };
  }

  /** Which side, if either, has been giving check on every one of the moves
   *  that produced this repetition. */
  private perpetualChecker(): Side | null {
    // The last eight plies cover two full cycles of the shortest perpetual —
    // king shuffles one square, checker returns. Longer cycles that repeat
    // three times will also have filled these.
    const window = this.checks.slice(-8);
    if (window.length < 4) return null;
    const checksBy = (side: Side): boolean => window.every((inCheck, i) => {
      // `checks[i]` was recorded after a move by the side that moved then; the
      // moves alternate backwards from the last one.
      const movedBy: Side = (this.moves.length - window.length + i) % 2 === 0 ? RED : BLACK;
      return movedBy === side ? inCheck : true;
    }) && window.some(Boolean);
    const red = checksBy(RED), black = checksBy(BLACK);
    if (red && !black) return RED;
    if (black && !red) return BLACK;
    return null;
  }

  /** The moves so far, as the assistant and the opening book write them. */
  movesIccs(): string[] {
    return this.moves.map((m) => `${iccs(moveFrom(m))}${iccs(moveTo(m))}`);
  }

  snapshot(): XiangqiSnapshot {
    return { handicap: this.handicap, moves: [...this.moves], ...(this.resignedBy !== null ? { resigned: this.resignedBy } : {}) };
  }

  static restore(s: XiangqiSnapshot): XiangqiGame {
    const g = new XiangqiGame(s.handicap ?? 'none');
    // Replayed rather than restored from a board, so a saved game that somehow
    // contains an illegal move stops at the last legal position instead of
    // loading a position the rules cannot reach.
    for (const m of s.moves ?? []) {
      if (g.play(moveFrom(m), moveTo(m)) === null) break;
    }
    if (s.resigned !== undefined) g.resignedBy = s.resigned;
    return g;
  }
}

/** How many leaves the move tree has at this depth. The rules' own test —
 *  every published count is a different rule being wrong if it misses. */
export function perft(pos: Position, depth: number): number {
  if (depth === 0) return 1;
  let total = 0;
  for (const m of pos.pseudoMoves()) {
    const side = pos.side;
    pos.make(m);
    if (!pos.inCheck(side) && !pos.kingsFacing()) total += perft(pos, depth - 1);
    pos.unmake();
  }
  return total;
}
