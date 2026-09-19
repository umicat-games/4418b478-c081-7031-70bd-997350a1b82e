// Counting the board at the end.
//
// The hard part of scoring Go is not arithmetic, it is agreeing which stones
// are DEAD — the one question a beginner and a machine will argue about, and
// the reason most beginner apps either ask the player to mark dead stones (and
// then get argued with) or refuse to score at all.
//
// We do not have to do either, because the engine's network has an OWNERSHIP
// head: for every intersection it reports who ends up owning it, and a stone
// standing on ground its opponent owns is, by definition, dead. So the count
// here is a count of ownership, not a flood fill with a dead-stone dialogue
// bolted on.
//
// Chinese (area) scoring, as `rules.ts` explains: stones plus the empty points
// they surround, which is exactly what an ownership map already is.
import type { GoGame } from './rules';
import type { Read } from './opponent';
import type { Player } from '../engine/types';
import { t } from '../i18n';

export interface Score {
  /** Points for each side. White's already includes komi. */
  black: number;
  white: number;
  /** Positive = Black is ahead, by this many points. */
  lead: number;
  winner: Player;
  /** Stones standing on ground the other side owns. */
  dead: Array<{ x: number; y: number; player: Player }>;
  /** Per-intersection owner for the overlay: 1 black, −1 white, 0 nobody. */
  owner: number[];
  /** True when the engine's own score estimate disagrees with the count here
   *  by more than a point — a position too unsettled to count honestly. */
  unsettled: boolean;
}

/** How sure the network has to be before a point is called for someone. In a
 *  finished position ownership sits near ±1; anything genuinely in dispute
 *  lands near zero and is left neutral, which is what dame are. */
const CERTAIN = 0.6;

/**
 * Count a finished board from an engine read of it.
 *
 * `read` must be of the position being counted — pass the read taken AFTER the
 * second pass, not the one the last move was chosen with, or the count will be
 * one move stale and occasionally wrong about a stone that just died.
 */
export function scoreFrom(game: GoGame, read: Read): Score {
  const size = game.size;
  const owner: number[] = new Array(size * size).fill(0);
  const dead: Score['dead'] = [];
  let black = 0;
  let white = 0;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      // Row-major, y first — the engine's own convention (`analyzeMcts.ts`
      // indexes `y * BOARD_SIZE + x`), verified against a lopsided board in
      // the probe rather than assumed.
      const own = read.ownership[y * size + x] ?? 0;
      const side = own > CERTAIN ? 1 : own < -CERTAIN ? -1 : 0;
      owner[y * size + x] = side;
      if (side === 1) black++;
      else if (side === -1) white++;

      const stone = game.board[y][x];
      // A stone on ground the other colour owns is dead — it will come off the
      // board in the count, and the player is owed an explanation of why.
      if (stone && side !== 0 && ((stone === 'black') !== (side === 1))) {
        dead.push({ x, y, player: stone });
      }
    }
  }

  white += game.komi;
  const lead = black - white;
  return {
    black,
    white,
    lead,
    winner: lead > 0 ? 'black' : 'white',
    dead,
    owner,
    // The engine's own number for the same position. They should agree; when
    // they do not, the position was not actually finished, and saying so is
    // better than announcing a result nobody can reproduce.
    unsettled: Math.abs(lead - read.scoreLead) > 1,
  };
}

/** The result as a person would say it. */
export function describe(score: Score, game: GoGame): string {
  if (game.resignedBy) return t(game.resignedBy === 'black' ? 'score.youResigned' : 'score.whiteResigned');
  const margin = Math.abs(score.lead);
  return t(score.winner === 'black' ? 'score.youWin' : 'score.whiteWins', {
    margin: margin % 1 === 0 ? margin : margin.toFixed(1),
    black: score.black,
    white: score.white,
    komi: game.komi,
  });
}
