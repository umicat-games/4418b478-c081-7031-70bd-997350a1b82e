// The board, and the rules that decide what may be put on it.
//
// This is the game's own state — deliberately NOT the engine's. The engine is
// asked what it would play; whether a stone may go down at all is answered
// here, for the AI exactly as for the player. That split is the whole safety
// model: an opponent that suggests an illegal move loses the argument rather
// than corrupting the board.
//
// The primitives (liberties, captures, legality, superko keys) come from the
// vendored KataGo engine's own helpers, so the rules the board enforces and the
// rules the engine searches under are one implementation, not two that agree
// until they don't.
import { applyCapturesInPlace, getOpponent, isValidMove } from '../engine/utils/gameLogic';
import { situationalKey } from '../engine/utils/superko';
import type { BoardState, GameRules, Move, Player } from '../engine/types';

export type BoardSize = 9 | 13 | 19;

/** A move, or one of the two things a player can do instead of moving. */
export type Turn =
  | { kind: 'play'; x: number; y: number; player: Player; captured: number }
  | { kind: 'pass'; player: Player }
  | { kind: 'resign'; player: Player };

export interface GoSnapshot {
  size: BoardSize;
  komi: number;
  handicap: number;
  turns: Turn[];
}

/**
 * Chinese rules, and the reason is not taste: area scoring counts stones on the
 * board, so a game can be scored from the position alone. Territory scoring
 * needs agreement about which stones are dead — the one part of Go a beginner
 * and a machine argue about — and we would be building that argument into the
 * first release.
 */
export const RULES: GameRules = 'chinese';

/** Chinese komi, every board size. The half point is not decoration: without
 *  it area scoring produces draws, and a draw is a bad answer to "did I win?". */
export const KOMI = 7.5;

const emptyBoard = (size: number): BoardState =>
  Array.from({ length: size }, () => Array.from({ length: size }, () => null as Player | null));

/** Where handicap stones go, per board size — the standard star points. */
const HANDICAP_POINTS: Record<BoardSize, Array<[number, number]>> = {
  // order matters: 2 stones use the first two, 3 the first three, and so on.
  9: [[6, 2], [2, 6], [6, 6], [2, 2], [4, 4]],
  13: [[9, 3], [3, 9], [9, 9], [3, 3], [6, 6], [3, 6], [9, 6], [6, 3], [6, 9]],
  19: [[15, 3], [3, 15], [15, 15], [3, 3], [9, 9], [3, 9], [15, 9], [9, 3], [9, 15]],
};

export class GoGame {
  readonly size: BoardSize;
  readonly komi: number;
  readonly handicap: number;
  board: BoardState;
  /** Whose turn it is. White moves first when Black has taken handicap stones. */
  toPlay: Player;
  readonly turns: Turn[] = [];
  readonly captures = { black: 0, white: 0 };
  /**
   * The stones the last play lifted, where they were standing.
   *
   * The turn log keeps the COUNT, because that is all a replay needs — a
   * saved game is the move list and the rules put the stones back. Anything
   * that has to show the capture happening needs the points, and by the time
   * it is asked the board no longer has them.
   */
  lastCaptured: Array<{ x: number; y: number }> = [];
  /** Winner by resignation, if someone resigned. */
  resignedBy: Player | null = null;

  // The engine's neural input wants the two previous positions, and superko
  // wants every position that has ever occurred. Kept separately because they
  // answer different questions and have very different lifetimes.
  private previous: BoardState | null = null;
  private previousPrevious: BoardState | null = null;
  private readonly seen: string[] = [];

  constructor(size: BoardSize, opts: { handicap?: number; komi?: number } = {}) {
    this.size = size;
    this.handicap = Math.max(0, Math.min(opts.handicap ?? 0, HANDICAP_POINTS[size].length));
    this.board = emptyBoard(size);
    for (const [x, y] of HANDICAP_POINTS[size].slice(0, this.handicap)) this.board[y][x] = 'black';
    // Handicap already pays White; komi on top of it would pay twice.
    this.komi = opts.komi ?? (this.handicap > 0 ? 0.5 : KOMI);
    this.toPlay = this.handicap > 0 ? 'white' : 'black';
    this.seen.push(situationalKey(this.board, this.toPlay));
  }

  /** May `player` put a stone here? Bounds, occupancy, suicide, ko, superko. */
  legal(x: number, y: number, player: Player = this.toPlay): boolean {
    if (!isValidMove(this.board, x, y, player, this.previous ?? undefined)) return false;
    // Positional superko on top of simple ko: Chinese rules forbid repeating a
    // whole position, and long cycles (triple ko) are how a game that cannot
    // end looks from the inside.
    const next = this.board.map((row) => [...row]);
    next[y][x] = player;
    applyCapturesInPlace(next, x, y, player);
    return !this.seen.includes(situationalKey(next, getOpponent(player)));
  }

  /** Play a stone. Returns false and changes nothing if the move is illegal. */
  play(x: number, y: number): boolean {
    if (this.over) return false;
    const player = this.toPlay;
    if (!this.legal(x, y, player)) return false;

    this.previousPrevious = this.previous;
    this.previous = this.board.map((row) => [...row]);

    this.board[y][x] = player;
    const captured = applyCapturesInPlace(this.board, x, y, player);
    this.captures[player] += captured.length;
    this.lastCaptured = captured;

    this.turns.push({ kind: 'play', x, y, player, captured: captured.length });
    this.toPlay = getOpponent(player);
    this.seen.push(situationalKey(this.board, this.toPlay));
    return true;
  }

  pass(): void {
    if (this.over) return;
    this.lastCaptured = [];
    this.previousPrevious = this.previous;
    this.previous = this.board.map((row) => [...row]);
    this.turns.push({ kind: 'pass', player: this.toPlay });
    this.toPlay = getOpponent(this.toPlay);
    this.seen.push(situationalKey(this.board, this.toPlay));
  }

  resign(player: Player = this.toPlay): void {
    if (this.over) return;
    this.resignedBy = player;
    this.turns.push({ kind: 'resign', player });
  }

  /** Two passes in a row end the game; so does a resignation. */
  get over(): boolean {
    if (this.resignedBy) return true;
    const n = this.turns.length;
    return n >= 2 && this.turns[n - 1].kind === 'pass' && this.turns[n - 2].kind === 'pass';
  }

  get lastMove(): Turn | null {
    return this.turns.length ? this.turns[this.turns.length - 1] : null;
  }

  /** The last stone actually placed — what the board highlights. */
  get lastStone(): { x: number; y: number; player: Player } | null {
    for (let i = this.turns.length - 1; i >= 0; i--) {
      const t = this.turns[i];
      if (t.kind === 'play') return { x: t.x, y: t.y, player: t.player };
      if (t.kind === 'resign') continue;
      return null; // a pass hides the marker: nothing was just played
    }
    return null;
  }

  /** What the engine needs to see a position the way KataGo's C++ does. */
  enginePosition(): {
    board: BoardState;
    previousBoard?: BoardState;
    previousPreviousBoard?: BoardState;
    currentPlayer: Player;
    moveHistory: Move[];
    repetitionHistory: string[];
    komi: number;
    rules: GameRules;
  } {
    return {
      board: this.board,
      previousBoard: this.previous ?? undefined,
      previousPreviousBoard: this.previousPrevious ?? undefined,
      currentPlayer: this.toPlay,
      // The network reads the last five moves; a pass is a real move to it, and
      // dropping passes here is how an engine misreads whose initiative it is.
      moveHistory: this.turns
        .filter((t): t is Extract<Turn, { kind: 'play' | 'pass' }> => t.kind !== 'resign')
        .map((t) => (t.kind === 'play'
          ? { x: t.x, y: t.y, player: t.player }
          // KataGo's convention for a pass in move history.
          : { x: -1, y: -1, player: t.player })),
      repetitionHistory: this.seen,
      komi: this.komi,
      rules: RULES,
    };
  }

  /** Stones on the board, for the renderer. */
  *stones(): Generator<{ x: number; y: number; player: Player }> {
    for (let y = 0; y < this.size; y++) {
      for (let x = 0; x < this.size; x++) {
        const p = this.board[y][x];
        if (p) yield { x, y, player: p };
      }
    }
  }

  /** A save is the list of turns, not the board: replaying is how the ko
   *  history and capture counts come back correct rather than approximately. */
  snapshot(): GoSnapshot {
    return { size: this.size, komi: this.komi, handicap: this.handicap, turns: [...this.turns] };
  }

  static restore(snap: GoSnapshot): GoGame {
    const game = new GoGame(snap.size, { handicap: snap.handicap, komi: snap.komi });
    for (const t of snap.turns) {
      if (t.kind === 'play') game.play(t.x, t.y);
      else if (t.kind === 'pass') game.pass();
      else game.resign(t.player);
    }
    return game;
  }
}
