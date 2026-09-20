// The board: what is legal, what just happened, and when it is over.
//
// This wraps `chess.js` rather than reimplementing it, and that is a decision
// rather than laziness. The Go game writes its own rules in two hundred lines
// because Go's rules ARE two hundred lines. Chess is castling rights, en
// passant (including the pin that makes it illegal), promotion, threefold
// repetition, the fifty-move rule and insufficient material — a long tail of
// cases each of which is rare, correct in one library already, and load-bearing
// here: every factual thing the companion says rests on the position being
// what the game says it is.
//
// What this file adds is the shape the rest of the game wants — `{x,y}` squares
// instead of `"e4"` strings, a snapshot that survives a save, and the handicap
// setup — and nothing else. When something about chess itself looks wrong, it
// is a chess.js question, not a question about this file.
import { Chess, type Color, type PieceSymbol, type Square } from 'chess.js';
import { fromSan, toSan, type Sq } from './coords';

export type Side = 'white' | 'black';
export type Kind = 'pawn' | 'knight' | 'bishop' | 'rook' | 'queen' | 'king';

const KIND: Record<PieceSymbol, Kind> = {
  p: 'pawn', n: 'knight', b: 'bishop', r: 'rook', q: 'queen', k: 'king',
};
export const sideOf = (c: Color): Side => (c === 'w' ? 'white' : 'black');
export const colorOf = (s: Side): Color => (s === 'white' ? 'w' : 'b');
export const other = (s: Side): Side => (s === 'white' ? 'black' : 'white');

/** What a piece is worth, in pawns. Used for ordering and for "is this piece
 *  worth more than the one attacking it" — never for judging a position, which
 *  is the engine's job. */
export const VALUE: Record<Kind, number> = {
  pawn: 1, knight: 3, bishop: 3, rook: 5, queen: 9, king: 100,
};

export interface PieceAt { x: number; y: number; kind: Kind; side: Side }

export interface PlayedMove {
  from: Sq;
  to: Sq;
  san: string;
  uci: string;
  piece: Kind;
  captured: Kind | null;
  /** The mover, which is NOT `toPlay` any more by the time anyone reads this. */
  by: Side;
  check: boolean;
  mate: boolean;
  castle: boolean;
  promotion: Kind | null;
}

/** Odds given to the student by taking a piece off the ENGINE's side. The
 *  chess answer to a Go handicap, and a real one — beginners have been given
 *  queen odds for four hundred years. */
export type Odds = 'none' | 'knight' | 'rook' | 'queen';

export type Outcome =
  | 'checkmate' | 'stalemate' | 'repetition' | 'fifty-move' | 'insufficient' | 'resigned';

export interface ChessSnapshot {
  /** Where this game started — not always the standard position, because of
   *  odds. Restoring from the final FEN alone would work for the pieces and
   *  quietly lose the repetition history, so the moves are replayed. */
  start: string;
  moves: string[];
  human: Side;
  odds: Odds;
  resignedBy: Side | null;
}

/** The standard position with one of the engine's pieces removed. Always the
 *  QUEEN'S side piece where there is a choice, which is the traditional odds
 *  and also the one whose absence a beginner notices least. */
function startingFen(human: Side, odds: Odds): string {
  const std = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
  if (odds === 'none') return std;
  const engine = other(human);
  const rank = engine === 'white' ? 'RNBQKBNR' : 'rnbqkbnr';
  // Files a..h. b1/b8 knight, a1/a8 rook, d1/d8 queen.
  const file = odds === 'knight' ? 1 : odds === 'rook' ? 0 : 3;
  const stripped = rank.split('').map((c, i) => (i === file ? '1' : c)).join('');
  // Back into FEN run-length form: `RNBQKBNR` with a hole is `R1BQKBNR`, and
  // two adjacent holes would have to merge — they cannot here, because only
  // one piece is ever removed.
  const withHole = stripped.replace(/1+/g, (run) => String(run.length));
  const rows = std.split(' ')[0].split('/');
  if (engine === 'black') rows[0] = withHole; else rows[7] = withHole;
  // Castling rights follow the rook: a rook that is not there cannot castle.
  let castling = 'KQkq';
  if (odds === 'rook') castling = castling.replace(engine === 'white' ? 'Q' : 'q', '');
  return `${rows.join('/')} w ${castling || '-'} - 0 1`;
}

export class ChessGame {
  private c: Chess;
  readonly human: Side;
  readonly odds: Odds;
  readonly start: string;
  private resigned: Side | null = null;

  constructor(human: Side = 'white', odds: Odds = 'none', start?: string) {
    this.human = human;
    this.odds = odds;
    this.start = start ?? startingFen(human, odds);
    this.c = new Chess(this.start);
  }

  // ── reading the position ────────────────────────────────────────────────
  get toPlay(): Side { return sideOf(this.c.turn()); }
  get fen(): string { return this.c.fen(); }
  get inCheck(): boolean { return this.c.inCheck(); }
  get resignedBy(): Side | null { return this.resigned; }
  /** Every move played, in SAN — what a scoresheet would say. */
  get moves(): string[] { return this.c.history(); }
  /** Full moves, the way chess counts them: 1 for White's first. */
  get moveNumber(): number { return Math.floor(this.c.history().length / 2) + 1; }
  get plies(): number { return this.c.history().length; }

  get over(): boolean { return !!this.resigned || this.c.isGameOver(); }

  get outcome(): Outcome | null {
    if (this.resigned) return 'resigned';
    if (this.c.isCheckmate()) return 'checkmate';
    if (this.c.isStalemate()) return 'stalemate';
    if (this.c.isThreefoldRepetition()) return 'repetition';
    if (this.c.isDrawByFiftyMoves()) return 'fifty-move';
    if (this.c.isInsufficientMaterial()) return 'insufficient';
    return null;
  }

  /** Who won, or null for a draw. Only meaningful once `over`. */
  get winner(): Side | null {
    if (this.resigned) return other(this.resigned);
    if (this.c.isCheckmate()) return other(this.toPlay);
    return null;
  }

  pieces(): PieceAt[] {
    const out: PieceAt[] = [];
    // chess.js `board()` is row-major from rank 8 down, which is exactly our y.
    this.c.board().forEach((row, y) => row.forEach((cell, x) => {
      if (cell) out.push({ x, y, kind: KIND[cell.type], side: sideOf(cell.color) });
    }));
    return out;
  }

  at(sq: Sq): PieceAt | null {
    const p = this.c.get(toSan(sq.x, sq.y));
    return p ? { ...sq, kind: KIND[p.type], side: sideOf(p.color) } : null;
  }

  /** Where the piece on this square may legally go. Empty for an empty square,
   *  for an enemy piece, and for a piece that is pinned solid — which is the
   *  same answer the board gives, and the right one. */
  movesFrom(sq: Sq): Array<{ to: Sq; san: string; capture: boolean; promotion: boolean }> {
    const verbose = this.c.moves({ square: toSan(sq.x, sq.y), verbose: true });
    const seen = new Set<string>();
    const out: Array<{ to: Sq; san: string; capture: boolean; promotion: boolean }> = [];
    for (const m of verbose) {
      // The four promotion moves to one square are one destination as far as
      // pointing at the board goes; which piece is asked afterwards.
      if (seen.has(m.to)) continue;
      seen.add(m.to);
      const to = fromSan(m.to);
      if (!to) continue;
      out.push({ to, san: m.san, capture: !!m.captured, promotion: !!m.promotion });
    }
    return out;
  }

  legal(from: Sq, to: Sq): boolean {
    return this.movesFrom(from).some((m) => m.to.x === to.x && m.to.y === to.y);
  }

  /** Squares the side to move could move a piece FROM. What the board lights
   *  up when it is your turn. */
  movable(side: Side): Sq[] {
    if (this.toPlay !== side || this.over) return [];
    const seen = new Set<string>();
    for (const m of this.c.moves({ verbose: true })) seen.add(m.from);
    return [...seen].map((s) => fromSan(s)).filter((s): s is Sq => !!s);
  }

  get lastMove(): PlayedMove | null {
    const h = this.c.history({ verbose: true });
    const m = h[h.length - 1];
    if (!m) return null;
    return describe(m);
  }

  /** What each side has taken, by piece. Derived from the move list rather
   *  than counted off the board, because with odds the board never had the
   *  full set on it and "missing" would read as "captured". */
  captured(): Record<Side, Kind[]> {
    const out: Record<Side, Kind[]> = { white: [], black: [] };
    for (const m of this.c.history({ verbose: true })) {
      if (m.captured) out[sideOf(m.color)].push(KIND[m.captured]);
    }
    return out;
  }

  /** Material, in pawns, from the given side's point of view. Geometry, not
   *  judgement: the engine's centipawns are the number that means anything. */
  material(side: Side): number {
    let sum = 0;
    for (const p of this.pieces()) {
      if (p.kind === 'king') continue;
      sum += p.side === side ? VALUE[p.kind] : -VALUE[p.kind];
    }
    return sum;
  }

  // ── changing it ─────────────────────────────────────────────────────────
  /** Play a move. Returns what happened, or null if the board would not take
   *  it — an illegal move is refused here and nowhere else, for the engine
   *  exactly as for the player. */
  play(from: Sq, to: Sq, promotion: 'q' | 'r' | 'b' | 'n' = 'q'): PlayedMove | null {
    if (this.over) return null;
    try {
      const m = this.c.move({ from: toSan(from.x, from.y), to: toSan(to.x, to.y), promotion });
      return m ? describe(m) : null;
    } catch {
      // chess.js throws on an illegal move rather than returning null. A
      // thrown exception here is the rules working, not a bug.
      return null;
    }
  }

  resign(side: Side): void { if (!this.over) this.resigned = side; }

  /** Take back the player's move and the engine's reply — both, because
   *  undoing one leaves the engine on move and it would simply play again. */
  undoPair(): boolean {
    if (this.resigned) return false;
    const undone = this.c.undo();
    if (!undone) return false;
    if (sideOf(undone.color) !== this.human) {
      // That was the engine's. Take the player's too, so it is their turn.
      if (!this.c.undo()) { this.c.move(undone.san); return false; }
    }
    return true;
  }

  // ── leaving and coming back ─────────────────────────────────────────────
  snapshot(): ChessSnapshot {
    return {
      start: this.start,
      moves: this.c.history({ verbose: true }).map((m) => m.lan),
      human: this.human,
      odds: this.odds,
      resignedBy: this.resigned,
    };
  }

  static restore(s: ChessSnapshot): ChessGame {
    const g = new ChessGame(s.human, s.odds, s.start);
    for (const lan of s.moves) {
      try { g.c.move(lan); } catch { break; }
    }
    g.resigned = s.resignedBy;
    return g;
  }

  /** The position as `position fen ... moves ...` wants it. */
  enginePosition(): { fen: string; moves: string[] } {
    return { fen: this.start, moves: this.c.history({ verbose: true }).map((m) => m.lan) };
  }

  /** A picture of the board for the companion: eight strings, rank 8 first,
   *  uppercase White. A diagram beats a move list for a model trying to answer
   *  "what is attacking my knight". */
  diagram(): string[] {
    return this.c.board().map((row) => row
      .map((cell) => (cell ? (cell.color === 'w' ? cell.type.toUpperCase() : cell.type) : '.'))
      .join(''));
  }

  /** Squares attacking a square, for the geometry the companion must not
   *  guess at. Exact, and nothing to do with whether the capture is GOOD. */
  attackers(sq: Sq, by: Side): Sq[] {
    return this.c.attackers(toSan(sq.x, sq.y), colorOf(by))
      .map((s: Square) => fromSan(s))
      .filter((s): s is Sq => !!s);
  }
}

function describe(m: {
  from: string; to: string; san: string; lan: string; piece: PieceSymbol;
  captured?: PieceSymbol; promotion?: PieceSymbol; color: Color; flags: string;
}): PlayedMove {
  const from = fromSan(m.from)!;
  const to = fromSan(m.to)!;
  return {
    from, to, san: m.san, uci: m.lan,
    piece: KIND[m.piece],
    captured: m.captured ? KIND[m.captured] : null,
    by: sideOf(m.color),
    check: m.san.includes('+'),
    mate: m.san.includes('#'),
    castle: m.flags.includes('k') || m.flags.includes('q'),
    promotion: m.promotion ? KIND[m.promotion] : null,
  };
}
