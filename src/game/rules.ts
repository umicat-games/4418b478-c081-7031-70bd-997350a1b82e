// The rules of gomoku, and nothing else.
//
// This file is the referee. The player and the engine both move through it, so
// there is one implementation of "is that five in a row" and not two that can
// disagree — and the assistant's facts come from here too, never from the
// language model's reading of the board.
//
// Gomoku's rules fit on a page, which is why this game is the template: the
// seam between "the shell" and "the game" is visible rather than buried under
// seven hundred lines of chess. What is NOT small is `threats()`, and that is
// on purpose — it is the thing the assistant must be right about, and the
// reason it lives in the referee rather than in the engine is that the engine
// is allowed to approximate and the assistant is not.
//
// **Free-style gomoku**: five or more in a row wins, for either side, and
// there are no forbidden moves. That is the game almost everyone in China
// actually plays. Renju's forbidden moves for Black (三三, 四四, 長連) are the
// obvious extension and the place to add them is marked in `play()` — be
// warned that their real definition is recursive and subtle, which is exactly
// why they are not in a file whose job is to be readable.

export type Player = 0 | 1;
export const BLACK: Player = 0;
export const WHITE: Player = 1;
export const other = (p: Player): Player => (p === BLACK ? WHITE : BLACK);

/** Board sizes on offer. 15 is the standard; 19 is a Go board, which is what
 *  most people have lying around; 13 is a quicker game. */
export type BoardSize = 13 | 15 | 19;
export const SIZES: BoardSize[] = [13, 15, 19];

/** How many in a row. Five or more — an overline wins in free-style. */
export const WIN = 5;

/** The four directions a line can run. Only four, not eight: a line and its
 *  reverse are the same line, and counting both is how double-counting bugs
 *  get in. */
const DIRS: Array<[number, number]> = [[1, 0], [0, 1], [1, 1], [1, -1]];

export interface Point { x: number; y: number }

export type Outcome =
  | { kind: 'playing' }
  | { kind: 'win'; winner: Player; line: Point[] }
  | { kind: 'draw' }
  | { kind: 'resign'; winner: Player };

export interface GomokuSnapshot {
  /** Plain `number` rather than `BoardSize`: a save is bytes that came back
   *  from somewhere else, and `restore` is where it is checked. */
  size: number;
  /** Move indices in order, Black first. A game is saved as its moves, never
   *  as a board: replaying through the referee means a save can never hold a
   *  position the rules cannot reach. */
  moves: number[];
  resigned?: Player;
}

/** What one side has on the board that the other has to answer. Every field is
 *  a list of EMPTY cells, because a threat is only ever a threat about a move
 *  somebody could make next. */
export interface Threats {
  /** Playing here makes five. One of these on your turn is a win; one of the
   *  opponent's is something you must block or beat. */
  win: number[];
  /** Playing here makes an open four — four with a winning cell at each end,
   *  which cannot be blocked. */
  openFour: number[];
  /** Playing here makes an open three: a three that becomes an open four next
   *  move unless it is answered now. */
  openThree: number[];
}

export class Gomoku {
  /**
   * A position somebody wrote out, rather than one that was played.
   *
   * The rule tests use it, and so would a puzzle: "here is a shape, find the
   * move". Rows are top first, `x` is Black and `o` is White.
   */
  static fromRows(rows: string[], toPlay: Player = BLACK): Gomoku {
    const g = new Gomoku(rows.length);
    rows.forEach((row, y) => [...row].forEach((ch, x) => {
      if (ch === 'x') g.board[g.idx(x, y)] = BLACK + 1;
      else if (ch === 'o') g.board[g.idx(x, y)] = WHITE + 1;
    }));
    // `toPlay` is read off the move count, and a written-out position has no
    // moves — so it gets a placeholder list of the right parity. They are
    // never replayed; `snapshot()` on such a game is not meaningful, which is
    // why this is a test and puzzle door and not a game one.
    g.synthetic = toPlay;
    return g;
  }
  private synthetic: Player | null = null;

  /** 0 empty, 1 black, 2 white. A flat array because every hot loop in the
   *  engine walks lines through it. */
  readonly board: Int8Array;
  readonly moves: number[] = [];
  resignedBy: Player | null = null;

  constructor(readonly size: number = 15) {
    this.board = new Int8Array(size * size);
  }

  get toPlay(): Player {
    if (this.synthetic !== null) return ((this.moves.length + this.synthetic) % 2) as Player;
    return (this.moves.length % 2) as Player;
  }
  get over(): boolean { return this.outcome().kind !== 'playing'; }
  get last(): number | null { return this.moves.length ? this.moves[this.moves.length - 1] : null; }

  idx(x: number, y: number): number { return y * this.size + x; }
  xOf(i: number): number { return i % this.size; }
  yOf(i: number): number { return (i / this.size) | 0; }
  at(i: number): number { return this.board[i]; }
  inside(x: number, y: number): boolean { return x >= 0 && y >= 0 && x < this.size && y < this.size; }

  legal(i: number): boolean {
    return !this.over && i >= 0 && i < this.board.length && this.board[i] === 0;
  }

  /** Put a stone down, if the rules take it. Returns whether it went down.
   *
   *  This is where renju's forbidden moves would go: a move Black may not
   *  play is a move this function refuses, and everything else — the engine,
   *  the assistant, the UI — follows automatically, because they all ask
   *  here. */
  play(i: number): boolean {
    if (!this.legal(i)) return false;
    this.board[i] = this.toPlay + 1;
    this.moves.push(i);
    return true;
  }

  /** Take the last stone back. Nothing in the game undoes a move — the engine
   *  and the tests do. */
  undo(): void {
    const i = this.moves.pop();
    if (i !== undefined) this.board[i] = 0;
  }

  resign(p: Player): void { this.resignedBy = p; }

  outcome(): Outcome {
    if (this.resignedBy !== null) return { kind: 'resign', winner: other(this.resignedBy) };
    const last = this.last;
    if (last !== null) {
      // Only the last stone can have completed a line, which is what makes
      // this cheap enough to call from anywhere.
      const line = this.lineThrough(last);
      if (line) return { kind: 'win', winner: (this.board[last] - 1) as Player, line };
    } else {
      // A position that was written out rather than played has no last stone,
      // so the whole board has to be looked at. Only puzzles and tests reach
      // this, and they reach it once.
      for (let i = 0; i < this.board.length; i++) {
        if (!this.board[i]) continue;
        const line = this.lineThrough(i);
        if (line) return { kind: 'win', winner: (this.board[i] - 1) as Player, line };
      }
    }
    if (this.moves.length >= this.board.length) return { kind: 'draw' };
    return { kind: 'playing' };
  }

  /** The five (or more) in a row through this stone, if there is one. */
  lineThrough(i: number): Point[] | null {
    const stone = this.board[i];
    if (!stone) return null;
    const x = this.xOf(i), y = this.yOf(i);
    for (const [dx, dy] of DIRS) {
      const points: Point[] = [{ x, y }];
      for (const sign of [1, -1]) {
        for (let k = 1; ; k++) {
          const nx = x + dx * sign * k, ny = y + dy * sign * k;
          if (!this.inside(nx, ny) || this.board[this.idx(nx, ny)] !== stone) break;
          points.push({ x: nx, y: ny });
        }
      }
      if (points.length >= WIN) {
        return points.sort((a, b) => (a.x - b.x) || (a.y - b.y));
      }
    }
    return null;
  }

  /**
   * The empty cells worth thinking about at all: everything within `radius` of
   * a stone already on the board.
   *
   * A stone on its own in the corner of an empty board does nothing, and
   * generating all 225 cells at every node is what makes a naive gomoku engine
   * slow. For THREATS this is exact rather than a heuristic — a pattern is
   * five cells long, so a cell that matters is within four of a stone — and
   * the engine uses a tighter radius deliberately, which is a heuristic and is
   * marked as one where it is used.
   */
  relevant(radius = 2): number[] {
    // Asked of the BOARD, not of the move list: a position that was written
    // out rather than played has no moves, and answering "only the centre"
    // for one of those made every threat on it invisible.
    if (!this.board.some((c) => c !== 0)) return [this.idx(this.size >> 1, this.size >> 1)];
    const out: number[] = [];
    for (let i = 0; i < this.board.length; i++) {
      if (this.board[i] !== 0) continue;
      const x = this.xOf(i), y = this.yOf(i);
      let near = false;
      for (let dy = -radius; dy <= radius && !near; dy++) {
        for (let dx = -radius; dx <= radius; dx++) {
          const nx = x + dx, ny = y + dy;
          if (this.inside(nx, ny) && this.board[this.idx(nx, ny)] !== 0) { near = true; break; }
        }
      }
      if (near) out.push(i);
    }
    return out;
  }

  /**
   * What this player is threatening, exactly.
   *
   * Defined by consequence rather than by pattern, which is what makes it
   * testable and what keeps it honest:
   *
   *   a WIN cell    is one where playing makes five;
   *   an OPEN FOUR  is a cell after which there are two different winning
   *                 cells — so blocking one leaves the other;
   *   an OPEN THREE is a cell after which an open four is available.
   *
   * Written this way it is slower than matching `.OOO.` against a string, and
   * it is right about the awkward shapes (split threes, threes that run into
   * the edge, threes the opponent has already blocked) that pattern-matching
   * implementations get wrong. The assistant reports these, so they have to be
   * true; the engine has its own faster approximation and never calls this.
   */
  threats(p: Player): Threats {
    const win = this.winningCells(p);
    const openFour = this.openFourCells(p);
    return {
      win,
      openFour,
      openThree: this.openThreeCells(p, win, openFour),
    };
  }

  /**
   * Cells where `p` would make five. Cheap — one poke per candidate — which is
   * why the engine can afford to ask it before every move it makes.
   */
  winningCells(p: Player, cells = this.relevant(4)): number[] {
    const stone = p + 1;
    const found: number[] = [];
    for (const c of cells) {
      if (this.board[c] !== 0) continue;
      this.board[c] = stone;
      const made = !!this.lineThrough(c);
      this.board[c] = 0;
      if (made) found.push(c);
    }
    return found;
  }

  /**
   * The empty cells in the four lines through this one, within `reach`.
   *
   * Not a heuristic: a five containing a cell lies in a line through it, so
   * when the question is "what does a stone HERE make possible", these are
   * the only cells that can be part of the answer. It is the difference
   * between the threat functions costing a few milliseconds and costing a
   * few seconds on a crowded board.
   */
  lineCells(i: number, reach = 4): number[] {
    const x = this.xOf(i), y = this.yOf(i);
    const out: number[] = [];
    for (const [dx, dy] of DIRS) {
      for (const sign of [1, -1]) {
        for (let k = 1; k <= reach; k++) {
          const nx = x + dx * sign * k, ny = y + dy * sign * k;
          if (!this.inside(nx, ny)) break;
          const j = this.idx(nx, ny);
          if (this.board[j] === 0) out.push(j);
        }
      }
    }
    return out;
  }

  /** Cells after which `p` has TWO winning cells — a four nobody can block. */
  openFourCells(p: Player, cells = this.relevant(4)): number[] {
    const stone = p + 1;
    const found: number[] = [];
    for (const c of cells) {
      if (this.board[c] !== 0) continue;
      this.board[c] = stone;
      if (this.winningCells(p, this.lineCells(c)).length >= 2) found.push(c);
      this.board[c] = 0;
    }
    return found;
  }

  /**
   * Cells after which an open four is available — a three that has to be
   * answered now.
   *
   * The expensive one: it asks the open-four question about every reply to
   * every candidate. Fine once, when the assistant is asked what is going on;
   * never inside a search, which is why the three above are separate
   * functions rather than one call that always does all the work.
   */
  openThreeCells(p: Player, win = this.winningCells(p), openFour = this.openFourCells(p)): number[] {
    const stone = p + 1;
    const cells = this.relevant(4);
    const found: number[] = [];
    for (const c of cells) {
      if (this.board[c] !== 0 || openFour.includes(c) || win.includes(c)) continue;
      this.board[c] = stone;
      let makes = false;
      // Only replies in a line through `c`: an open four built on this stone
      // runs through it, so nothing else can make one.
      for (const d of this.lineCells(c)) {
        if (this.board[d] !== 0) continue;
        this.board[d] = stone;
        const two = this.winningCells(p, this.lineCells(d)).length >= 2;
        this.board[d] = 0;
        if (two) { makes = true; break; }
      }
      this.board[c] = 0;
      if (makes) found.push(c);
    }
    return found;
  }

  /** The board as the assistant sees it: one row per line, top row first. */
  diagram(): string[] {
    const rows: string[] = [];
    for (let y = 0; y < this.size; y++) {
      let row = '';
      for (let x = 0; x < this.size; x++) row += '.xo'[this.board[this.idx(x, y)]];
      rows.push(row);
    }
    return rows;
  }

  snapshot(): GomokuSnapshot {
    return { size: this.size, moves: [...this.moves], ...(this.resignedBy !== null ? { resigned: this.resignedBy } : {}) };
  }

  static restore(s: GomokuSnapshot): Gomoku {
    const g = new Gomoku(SIZES.includes(s.size as BoardSize) ? s.size : 15);
    for (const m of s.moves ?? []) if (!g.play(m)) break;
    if (s.resigned !== undefined) g.resignedBy = s.resigned;
    return g;
  }
}
