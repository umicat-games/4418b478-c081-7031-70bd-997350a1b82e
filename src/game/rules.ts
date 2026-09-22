// The rules of Othello, and nothing else.
//
// This file is the referee. The player and the engine both move through it,
// so there is one implementation of what a move flips and not two that can
// disagree — and the assistant's facts come from here, never from a language
// model's reading of the board.
//
// Othello's rules fit in a paragraph and its subtleties are all in one place:
//
//   a move must FLIP something. Placing a disc that turns nothing over is not
//   a quiet move, it is not a move at all;
//   a flip runs in a straight line from the disc you place, over an unbroken
//   run of the opponent's discs, and stops at one of YOURS. A gap or an edge
//   ends the line and flips nothing in that direction;
//   all eight directions are resolved, and they are independent;
//   a player with no legal move PASSES — not as a choice, automatically — and
//   the game ends only when neither side can move.
//
// `tools/perft.mjs` walks the whole move tree from the opening position and
// compares the counts against the published ones (4 / 12 / 56 / 244 / 1396 /
// 8200 / 55092 / 390216). Those numbers only come out right if the flipping
// rules are right, which is why they are the test.

export type Player = 0 | 1;
export const BLACK: Player = 0;
export const WHITE: Player = 1;
export const other = (p: Player): Player => (p === BLACK ? WHITE : BLACK);

export const SIZE = 8;
export const CELLS = SIZE * SIZE;

/** The eight directions, as (dx, dy). All eight, unlike a line-of-three game:
 *  a flip has a direction, and the opposite direction is a different flip. */
const DIRS: Array<[number, number]> = [
  [1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1],
];

export interface Point { x: number; y: number }

export type Outcome =
  | { kind: 'playing' }
  | { kind: 'win'; winner: Player; black: number; white: number }
  | { kind: 'draw'; black: number; white: number }
  | { kind: 'resign'; winner: Player; black: number; white: number };

export interface OthelloSnapshot {
  /** Cells played, in order. A game is saved as its moves and replayed
   *  through the referee, so a save can never hold a position the rules
   *  cannot reach. Passes are not stored: they are forced, so they follow. */
  moves: number[];
  resigned?: Player;
}

export class Othello {
  /** 0 empty, 1 black, 2 white. */
  readonly board = new Int8Array(CELLS);
  readonly moves: number[] = [];
  resignedBy: Player | null = null;
  private turn: Player = BLACK;
  /**
   * What each move did, so it can be taken back exactly.
   *
   * The search makes and unmakes hundreds of thousands of moves a second and
   * cannot afford to rebuild the board from the start each time — which is
   * what the first version did, and it cost perft(7) four seconds.
   */
  private readonly history: Array<{ move: number; flipped: number[]; turn: Player }> = [];

  constructor() {
    // The four in the middle: white on d4 and e5, black on e4 and d5, and
    // Black opens. Getting this diagonal the wrong way round mirrors every
    // opening in the book.
    this.board[idx(3, 3)] = WHITE + 1;
    this.board[idx(4, 4)] = WHITE + 1;
    this.board[idx(4, 3)] = BLACK + 1;
    this.board[idx(3, 4)] = BLACK + 1;
  }

  get toPlay(): Player { return this.turn; }
  get over(): boolean { return this.outcome().kind !== 'playing'; }
  get last(): number | null { return this.moves.length ? this.moves[this.moves.length - 1] : null; }

  at(i: number): number { return this.board[i]; }
  xOf(i: number): number { return i % SIZE; }
  yOf(i: number): number { return (i / SIZE) | 0; }
  idx(x: number, y: number): number { return idx(x, y); }

  /**
   * What playing here would turn over, for this player. Empty means the move
   * is illegal — in Othello those are the same statement, which is why this
   * one function answers both questions and nothing else has to.
   */
  flips(i: number, p: Player = this.turn): number[] {
    if (i < 0 || i >= CELLS || this.board[i] !== 0) return [];
    const mine = p + 1;
    const theirs = other(p) + 1;
    const x = this.xOf(i), y = this.yOf(i);
    const out: number[] = [];
    for (const [dx, dy] of DIRS) {
      const run: number[] = [];
      let cx = x + dx, cy = y + dy;
      while (inside(cx, cy) && this.board[idx(cx, cy)] === theirs) {
        run.push(idx(cx, cy));
        cx += dx; cy += dy;
      }
      // The run only flips if something of MINE closes it. Running off the
      // edge, or into a gap, flips nothing in this direction.
      if (run.length && inside(cx, cy) && this.board[idx(cx, cy)] === mine) out.push(...run);
    }
    return out;
  }

  legal(i: number, p: Player = this.turn): boolean { return this.flips(i, p).length > 0; }

  /** Every cell this player may play. */
  legalMoves(p: Player = this.turn): number[] {
    const out: number[] = [];
    for (let i = 0; i < CELLS; i++) if (this.board[i] === 0 && this.flips(i, p).length) out.push(i);
    return out;
  }

  /**
   * Play it, if the rules take it. Returns what flipped, or null when the
   * move was refused.
   *
   * The pass is handled here and is not a decision: after a move, the turn
   * goes to the opponent only if the opponent has one. A game where the
   * player has to notice they cannot move and press something is a game that
   * has misunderstood the rule.
   */
  play(i: number): number[] | null {
    if (this.over) return null;
    return this.make(i);
  }

  /**
   * The same move, for the search: no "is the game over" question, and every
   * one is undoable.
   */
  make(i: number): number[] | null {
    const flipped = this.flips(i, this.turn);
    if (!flipped.length) return null;
    this.history.push({ move: i, flipped, turn: this.turn });
    this.board[i] = this.turn + 1;
    for (const f of flipped) this.board[f] = this.turn + 1;
    this.moves.push(i);
    const next = other(this.turn);
    if (this.legalMoves(next).length) this.turn = next;
    // else: the opponent passes, and it stays this player's turn.
    return flipped;
  }

  /** Take the last move back, exactly. */
  unmake(): void {
    const last = this.history.pop();
    if (!last) return;
    this.board[last.move] = 0;
    const theirs = other(last.turn) + 1;
    for (const f of last.flipped) this.board[f] = theirs;
    this.turn = last.turn;
    this.moves.pop();
  }

  /** What the tests and the engine call it. */
  undo(): void { this.unmake(); }

  resign(p: Player): void { this.resignedBy = p; }

  /** Discs on the board, each side. The score, and the only number that
   *  decides an Othello game — which is why it is worth showing and worth
   *  being careful about: it swings wildly and means little until the end. */
  counts(): { black: number; white: number } {
    let black = 0, white = 0;
    for (let i = 0; i < CELLS; i++) {
      if (this.board[i] === BLACK + 1) black++;
      else if (this.board[i] === WHITE + 1) white++;
    }
    return { black, white };
  }

  /** Empty cells left. The engine counts down to an exact ending with it. */
  get empties(): number {
    let n = 0;
    for (let i = 0; i < CELLS; i++) if (this.board[i] === 0) n++;
    return n;
  }

  outcome(): Outcome {
    const { black, white } = this.counts();
    if (this.resignedBy !== null) {
      return { kind: 'resign', winner: other(this.resignedBy), black, white };
    }
    // Over when NEITHER side can move — which is usually a full board and is
    // sometimes not. A game can end with empty squares nobody may play in.
    if (this.legalMoves(BLACK).length === 0 && this.legalMoves(WHITE).length === 0) {
      if (black === white) return { kind: 'draw', black, white };
      return { kind: 'win', winner: black > white ? BLACK : WHITE, black, white };
    }
    return { kind: 'playing' };
  }

  /** The board as the assistant sees it: eight rows, row 1 first. */
  diagram(): string[] {
    const rows: string[] = [];
    for (let y = 0; y < SIZE; y++) {
      let row = '';
      for (let x = 0; x < SIZE; x++) row += '.xo'[this.board[idx(x, y)]];
      rows.push(row);
    }
    return rows;
  }

  snapshot(): OthelloSnapshot {
    return { moves: [...this.moves], ...(this.resignedBy !== null ? { resigned: this.resignedBy } : {}) };
  }

  static restore(s: OthelloSnapshot): Othello {
    const g = new Othello();
    for (const m of s.moves ?? []) if (!g.play(m)) break;
    if (s.resigned !== undefined) g.resignedBy = s.resigned;
    return g;
  }

  /**
   * A position somebody wrote out, rather than one that was played. The rule
   * tests use it, and so would a puzzle. Rows are row 1 first; `x` is Black,
   * `o` is White.
   */
  static fromRows(rows: string[], toPlay: Player = BLACK): Othello {
    const g = new Othello();
    g.board.fill(0);
    rows.forEach((row, y) => [...row].forEach((ch, x) => {
      if (ch === 'x') g.board[idx(x, y)] = BLACK + 1;
      else if (ch === 'o') g.board[idx(x, y)] = WHITE + 1;
    }));
    g.turn = toPlay;
    return g;
  }
}

const idx = (x: number, y: number): number => y * SIZE + x;
const inside = (x: number, y: number): boolean => x >= 0 && y >= 0 && x < SIZE && y < SIZE;

/**
 * How many leaves the move tree has at this depth. The rules' own test.
 *
 * A pass is a ply here, as it is in the published counts: when the side to
 * move has nothing, the turn goes over and the depth still goes down. It
 * never happens in the first eight plies of Othello, which is why every
 * implementation agrees about those numbers whatever it does about passing.
 */
export function perft(g: Othello, depth: number): number {
  if (depth === 0) return 1;
  const moves = g.legalMoves();
  if (!moves.length) return 1;   // nobody to move: this line is over
  let total = 0;
  for (const m of moves) {
    g.play(m);
    total += perft(g, depth - 1);
    g.undo();
  }
  return total;
}
