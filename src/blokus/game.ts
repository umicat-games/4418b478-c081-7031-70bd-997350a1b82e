// The game itself: four hands, one board, whose turn it is.
//
// This class knows nothing about three.js, the network or the bots. It is the
// single copy of the rules that everything else reads — the view draws it, the
// bot searches it, the room broadcasts it. When an online client receives a
// board from the host it is written in HERE, and the screen follows from that
// rather than from the message.
//
// Scoring is squares placed, which is how the 2D game counted and the number a
// player can check by looking. Blokus's official score is the mirror of it
// (minus one per square left in hand, with a bonus for going out) and can be
// added later without moving anything: `squaresLeft` is already on screen.
import {
  ALL_PIECES, BASE, CELLS, EMPTY, SIZE, canPlace, cellsAt, hasMove, squaresLeft,
} from './pieces';

export const PLAYERS = 4;

export interface Move {
  piece: string;
  ori: number;
  /** The shape origin, not the square the player aimed at. */
  x: number;
  y: number;
}

/** Everything that has to survive a reload, or cross the network. */
export interface Snapshot {
  board: number[];
  hands: string[][];
  first: boolean[];
  scores: number[];
  turn: number;
  over: boolean;
}

export class BlokusGame {
  /** `y * 20 + x`, holding a player index or `EMPTY`. */
  board: number[] = new Array(CELLS).fill(EMPTY);
  /** What each player still has to play, by piece name. */
  hands: string[][] = [];
  /** Whether a player has yet to place anything — the corner rule. */
  first: boolean[] = [];
  scores: number[] = [];
  turn = 0;
  over = false;

  constructor() { this.reset(); }

  reset(): void {
    this.board = new Array(CELLS).fill(EMPTY);
    this.hands = Array.from({ length: PLAYERS }, () => [...ALL_PIECES]);
    this.first = Array.from({ length: PLAYERS }, () => true);
    this.scores = new Array(PLAYERS).fill(0);
    this.turn = 0;
    this.over = false;
  }

  /**
   * Is this a move the rules allow?
   *
   * Whose turn it is belongs in here with the rest of the rules, not in the
   * screen that asks. One of the callers is a message from another machine,
   * and a client that plays out of turn — by racing, by a bug, or on purpose
   * — would otherwise be obeyed by everyone else.
   */
  legal(player: number, move: Move): boolean {
    if (this.over || player !== this.turn) return false;
    if (!this.hands[player].includes(move.piece)) return false;
    return canPlace(this.board, cellsAt(move.piece, move.ori, move.x, move.y), player, this.first[player]);
  }

  /**
   * Put a piece down, and hand the turn on.
   *
   * Returns the squares it covered so the view can animate exactly those, or
   * `null` if the move was not legal — checked here rather than trusted,
   * because one of the callers is a message from another machine.
   */
  play(player: number, move: Move): ReturnType<typeof cellsAt> | null {
    if (!this.legal(player, move)) return null;
    const cells = cellsAt(move.piece, move.ori, move.x, move.y);
    for (const [x, y] of cells) this.board[y * SIZE + x] = player;
    this.scores[player] += cells.length;
    this.hands[player] = this.hands[player].filter((p) => p !== move.piece);
    this.first[player] = false;
    this.advance();
    return cells;
  }

  /** Give up the turn. A player may do this even with moves left — usually
   *  because they are keeping a piece back rather than because they are stuck. */
  pass(): void {
    if (this.over) return;
    this.advance();
  }

  /**
   * Whose turn is it now?
   *
   * Players with nothing that fits are skipped rather than asked, silently:
   * being told "you have no moves" once per round for the rest of a long game
   * is the game nagging someone about something they cannot do anything about.
   * When nobody can move, the game is over.
   */
  private advance(): void {
    for (let i = 1; i <= PLAYERS; i++) {
      const next = (this.turn + i) % PLAYERS;
      if (this.canMove(next)) { this.turn = next; return; }
    }
    this.over = true;
  }

  canMove(player: number): boolean {
    const hand = this.hands[player];
    return hand.length > 0 && hasMove(this.board, hand, player, this.first[player]);
  }

  /** Squares still in hand — what a player would be docked under the official
   *  scoring, and a fair measure of who is stuck. */
  left(player: number): number { return squaresLeft(this.hands[player]); }

  /** Highest score wins; squares left breaks a tie, which is the same order
   *  the official scoring would have produced anyway. */
  winners(): number[] {
    let best = -1;
    let leastLeft = Infinity;
    let out: number[] = [];
    for (let p = 0; p < PLAYERS; p++) {
      const s = this.scores[p];
      const l = this.left(p);
      if (s > best || (s === best && l < leastLeft)) { best = s; leastLeft = l; out = [p]; }
      else if (s === best && l === leastLeft) out.push(p);
    }
    return out;
  }

  snapshot(): Snapshot {
    return {
      board: [...this.board],
      hands: this.hands.map((h) => [...h]),
      first: [...this.first],
      scores: [...this.scores],
      turn: this.turn,
      over: this.over,
    };
  }

  /**
   * Take a state from somewhere else — a save, or the host of an online game.
   *
   * Everything is copied and defaulted rather than assigned: a snapshot can
   * arrive from an older build of the game or from a client that dropped
   * halfway through writing it, and a board of `undefined` is a white screen.
   */
  restore(s: Partial<Snapshot> | null | undefined): void {
    if (!s) return;
    if (Array.isArray(s.board) && s.board.length === CELLS) this.board = [...s.board];
    if (Array.isArray(s.hands)) {
      for (let p = 0; p < PLAYERS; p++) {
        const hand = s.hands[p];
        if (Array.isArray(hand)) this.hands[p] = hand.filter((n) => n in BASE);
      }
    }
    if (Array.isArray(s.first)) for (let p = 0; p < PLAYERS; p++) this.first[p] = !!s.first[p];
    if (Array.isArray(s.scores)) for (let p = 0; p < PLAYERS; p++) this.scores[p] = s.scores[p] ?? 0;
    if (typeof s.turn === 'number') this.turn = Math.max(0, Math.min(PLAYERS - 1, s.turn));
    this.over = !!s.over;
  }
}
