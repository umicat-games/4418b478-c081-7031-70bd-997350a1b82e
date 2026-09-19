// The course: five lessons, each one a level.
//
// A lesson runs teach → practice → quiz → summary, and the point of the shape
// is that everyone knows when it is over. Before this existed the coach had a
// persona but no agenda: it would explain something, the student would nod, and
// the conversation would trail off with nothing having been established.
//
// **The goal of every exercise is CODE, not a sentence in a prompt.** "Did they
// capture a stone" is a question the board can answer; leaving it to the model
// would mean a student could be told they had passed for saying the right
// thing. The coach teaches and judges understanding; the game judges the move.
//
// The positions are authored, for the same reason: a language model cannot set
// up a clean atari, and should not be able to put stones on the board at all.
// Every one of them is checked by `npm run verify` — that a solving move
// exists, and (for a quiz) that not just anything passes.
import { fromGtp } from '../go/coords';
import { getLiberties, isEye } from '../engine/utils/gameLogic';
import type { BoardSize, GoGame } from '../go/rules';
import type { Player } from '../engine/types';

/** What the student has to make happen. Each maps to a checker below. */
export type Goal =
  /** Take at least `count` stones off the board. */
  | { kind: 'capture'; count: number }
  /** Reduce any white group to one liberty. */
  | { kind: 'atari' }
  /** The stones at `a` and `b` end up in one group. */
  | { kind: 'connect'; a: string; b: string }
  /** The WHITE stones at `a` and `b` can no longer be joined. */
  | { kind: 'cut'; a: string; b: string }
  /** The black group containing `at` has two eyes. */
  | { kind: 'alive'; at: string }
  /** The black stone at `at` is still there, with room to breathe. */
  | { kind: 'save'; at: string }
  /** Play the game out to the end. */
  | { kind: 'finish' };

export interface Problem {
  /** Stones already on the board, in the coordinates people say out loud. */
  black?: string[];
  white?: string[];
  goal: Goal;
  /** Does White answer? Off for a one-move problem, so a beginner is not
   *  punished by a reply they were never asked to read. */
  reply?: boolean;
}

export interface Lesson {
  id: string;
  size: BoardSize;
  /** What the coach should get across, in its own words. Fed to the coach as
   *  its brief for this lesson — not shown to the player. */
  brief: string;
  /** Shown on the demo board while the coach explains. Optional. */
  demo?: Problem;
  practice: Problem[];
  quiz: Problem[];
}

/**
 * Five lessons: from "I do not know what the stones do" to "I have finished a
 * game and understood the result". Everything past that — opening direction,
 * ko, shape — is another course, and a course nobody finishes teaches nothing.
 */
export const LESSONS: Lesson[] = [
  {
    id: 'liberties',
    size: 9,
    brief:
      'Liberties and capture. A stone lives by the empty points next to it; fill the last one and it comes off ' +
      'the board. Teach the counting: this stone has four, this one on the edge has three, this one in the corner ' +
      'has two. The exercise is a white stone with one liberty left.',
    demo: { black: ['D5', 'F5', 'E6'], white: ['E5'], goal: { kind: 'capture', count: 1 } },
    practice: [{ black: ['D5', 'F5', 'E6'], white: ['E5'], goal: { kind: 'capture', count: 1 } }],
    quiz: [{ black: ['D5', 'D6', 'F5', 'F6', 'E7'], white: ['E5', 'E6'], goal: { kind: 'capture', count: 2 } }],
  },
  {
    id: 'atari',
    size: 9,
    brief:
      'Atari, and running away. A group down to its last liberty is in atari — one move from being taken. ' +
      'Teach both sides of it: putting a stone in atari, and getting out by extending to make more liberties. ' +
      'The practice is the attack; the quiz is the escape, which is the one they will need first in a real game.',
    practice: [{ black: ['D5', 'F5'], white: ['E5'], goal: { kind: 'atari' } }],
    quiz: [{ black: ['E5'], white: ['D5', 'F5', 'E4'], goal: { kind: 'save', at: 'E5' }, reply: true }],
  },
  {
    id: 'connect',
    size: 9,
    brief:
      'Connection and the cut. Two stones side by side share their liberties and are hard to kill; two stones ' +
      'with a gap are two weak things. Teach them to see the cutting point — the single place that decides ' +
      'whether a shape is one group or two — from both sides of the board.',
    practice: [{ black: ['D5', 'F5'], white: ['E4', 'E6'], goal: { kind: 'connect', a: 'D5', b: 'F5' } }],
    quiz: [{ black: ['E4', 'E6'], white: ['D5', 'F5'], goal: { kind: 'cut', a: 'D5', b: 'F5' } }],
  },
  {
    id: 'twoeyes',
    size: 9,
    brief:
      'Life. A group with two separate eyes can never be filled in, so it can never be captured — that is the ' +
      'whole of it, and it is the idea that makes Go a game rather than a race. The exercise is a group with a ' +
      'three-point eye space: playing the middle makes two eyes, playing either end makes one and dies.',
    practice: [{
      black: ['A4', 'B4', 'B3', 'B2', 'B1'],
      white: ['A5', 'B5', 'C4', 'C3', 'C2', 'C1'],
      goal: { kind: 'alive', at: 'B2' },
    }],
    quiz: [{
      black: ['J4', 'H4', 'H3', 'H2', 'H1'],
      white: ['J5', 'H5', 'G4', 'G3', 'G2', 'G1'],
      goal: { kind: 'alive', at: 'H2' },
    }],
  },
  {
    id: 'territory',
    size: 9,
    brief:
      'Territory, and how a game ends. Empty points your stones surround are yours; when neither side has ' +
      'anything useful left, both pass and the board is counted. Play a whole game with them — gently — and at ' +
      'the end walk them through the count rather than just announcing it.',
    practice: [],
    quiz: [{ goal: { kind: 'finish' }, reply: true }],
  },
];

export const lessonById = (id: string): Lesson | undefined => LESSONS.find((l) => l.id === id);

/** Everything a checker needs that the board alone does not say. */
export interface GoalContext {
  game: GoGame;
  /** Stones the student had taken before this move. */
  capturesBefore: number;
  /** Whether the white stones named by a `cut` goal started out connected. */
  connectedBefore?: boolean;
}

/** Has the student done the thing? Pure, and deliberately dull. */
export function goalMet(goal: Goal, ctx: GoalContext): boolean {
  const { game } = ctx;
  const size = game.size;
  const at = (p: string): { x: number; y: number } | null => fromGtp(p, size);

  switch (goal.kind) {
    case 'capture':
      return game.captures.black - ctx.capturesBefore >= goal.count;

    case 'atari': {
      // Any white group down to one liberty. Walking every stone is fine on a
      // 9x9 and avoids having to name the group in the lesson data.
      const seen = new Set<string>();
      for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
          if (game.board[y][x] !== 'white' || seen.has(`${x},${y}`)) continue;
          const { liberties, group } = getLiberties(game.board, x, y);
          for (const g of group) seen.add(`${g.x},${g.y}`);
          if (liberties === 1) return true;
        }
      }
      return false;
    }

    case 'connect': {
      const a = at(goal.a), b = at(goal.b);
      if (!a || !b) return false;
      return sameGroup(game, a, b);
    }

    case 'cut': {
      const a = at(goal.a), b = at(goal.b);
      if (!a || !b) return false;
      // Both must still be on the board: capturing one is not cutting.
      if (game.board[a.y][a.x] !== 'white' || game.board[b.y][b.x] !== 'white') return false;
      if (sameGroup(game, a, b)) return false;
      // And they must be beyond JOINING. Two stones with a gap between them are
      // already in different groups, so "different groups" on its own is true
      // before the student has done anything — the first version of this goal
      // passed on every legal move, which is how the verifier caught it. The
      // cut is the point in the gap: after it, no single move connects them.
      const groupA = getLiberties(game.board, a.x, a.y).group;
      const groupB = getLiberties(game.board, b.x, b.y).group;
      const touches = (group: Array<{ x: number; y: number }>, p: { x: number; y: number }): boolean =>
        group.some((g) => Math.abs(g.x - p.x) + Math.abs(g.y - p.y) === 1);
      for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
          if (game.board[y][x] !== null) continue;
          if (touches(groupA, { x, y }) && touches(groupB, { x, y })) return false;
        }
      }
      return true;
    }

    case 'alive': {
      const p = at(goal.at);
      if (!p || game.board[p.y][p.x] !== 'black') return false;
      const { group, liberties } = getLiberties(game.board, p.x, p.y);
      if (liberties < 2) return false;
      const eyes = new Set<string>();
      for (const s of group) {
        for (const n of neighbours(s, size)) {
          if (game.board[n.y][n.x] === null && isEye(game.board, n.x, n.y, 'black')) eyes.add(`${n.x},${n.y}`);
        }
      }
      // Two eyes, and they have to be separate points — a two-space eye is one
      // eye, and it is exactly the mistake this lesson is about.
      return eyes.size >= 2;
    }

    case 'save': {
      const p = at(goal.at);
      if (!p || game.board[p.y][p.x] !== 'black') return false;
      // Still there AND breathing: a stone saved into a second atari was not
      // saved, it was postponed.
      return getLiberties(game.board, p.x, p.y).liberties >= 2;
    }

    case 'finish':
      return game.over;
  }
}

const neighbours = (p: { x: number; y: number }, size: number): Array<{ x: number; y: number }> =>
  [{ x: p.x + 1, y: p.y }, { x: p.x - 1, y: p.y }, { x: p.x, y: p.y + 1 }, { x: p.x, y: p.y - 1 }]
    .filter((n) => n.x >= 0 && n.y >= 0 && n.x < size && n.y < size);

function sameGroup(game: GoGame, a: { x: number; y: number }, b: { x: number; y: number }): boolean {
  const colour = game.board[a.y][a.x];
  if (!colour || game.board[b.y][b.x] !== colour) return false;
  return getLiberties(game.board, a.x, a.y).group.some((g) => g.x === b.x && g.y === b.y);
}

/** Put a problem's stones on a board. Returns null if the data names a point
 *  that is not on this board — which the verifier turns into a failed test
 *  rather than a lesson that silently starts half-built. */
export function setUp(game: GoGame, problem: Problem): boolean {
  const place = (points: string[] | undefined, colour: Player): boolean => {
    for (const p of points ?? []) {
      const at = fromGtp(p, game.size);
      if (!at) return false;
      game.board[at.y][at.x] = colour;
    }
    return true;
  };
  return place(problem.black, 'black') && place(problem.white, 'white');
}
