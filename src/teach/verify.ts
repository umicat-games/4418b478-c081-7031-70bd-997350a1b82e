// Are the lessons solvable?
//
// Every exercise is a hand-authored position plus a goal a checker has to be
// able to reach. Two ways that goes wrong silently: the position is built from
// a point that is not on the board (a typo in "J10"), or there is no move that
// satisfies the goal at all — a level nobody can finish, discovered by a
// beginner in the middle of being taught.
//
// So: build every problem, try every legal move, and count how many of them
// pass. At least one, or the lesson is broken. For a quiz, NOT all of them —
// an exercise everything passes is not a test of anything.
//
// Run with `npm run verify`.
import { LESSONS, goalMet, setUp, type Problem } from './curriculum';
import { GoGame } from '../go/rules';

export interface Finding { lesson: string; phase: string; index: number; problem: string; solutions: number; legal: number; error?: string }

function solutionsFor(problem: Problem, size: 9 | 13 | 19): { solutions: number; legal: number; error?: string } {
  const base = new GoGame(size);
  if (!setUp(base, problem)) return { solutions: 0, legal: 0, error: 'a point in this problem is not on the board' };

  // `finish` is not a one-move goal; playing a whole game out is the exercise.
  if (problem.goal.kind === 'finish') return { solutions: 1, legal: 1 };

  let solutions = 0;
  let legal = 0;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const game = new GoGame(size);
      if (!setUp(game, problem)) return { solutions: 0, legal: 0, error: 'setup failed' };
      const capturesBefore = game.captures.black;
      if (!game.play(x, y)) continue;
      legal++;
      if (goalMet(problem.goal, { game, capturesBefore })) solutions++;
    }
  }
  return { solutions, legal };
}

export function verify(): Finding[] {
  const bad: Finding[] = [];
  for (const lesson of LESSONS) {
    const phases: Array<[string, Problem[]]> = [
      ['demo', lesson.demo ? [lesson.demo] : []],
      ['practice', lesson.practice],
      ['quiz', lesson.quiz],
    ];
    for (const [phase, problems] of phases) {
      problems.forEach((problem, index) => {
        const { solutions, legal, error } = solutionsFor(problem, lesson.size);
        const row: Finding = { lesson: lesson.id, phase, index, problem: problem.goal.kind, solutions, legal, error };
        if (error) bad.push(row);
        else if (solutions === 0) bad.push({ ...row, error: 'no move solves it' });
        // A whole game is not a one-move problem, so "could anything pass?"
        // does not apply to it.
        else if (phase === 'quiz' && problem.goal.kind !== 'finish' && solutions === legal) {
          bad.push({ ...row, error: 'every legal move solves it' });
        }
      });
    }
  }
  return bad;
}

/** Everything, pass or fail — useful when tuning a position. */
export function report(): Finding[] {
  const rows: Finding[] = [];
  for (const lesson of LESSONS) {
    for (const [phase, problems] of [['demo', lesson.demo ? [lesson.demo] : []], ['practice', lesson.practice], ['quiz', lesson.quiz]] as Array<[string, Problem[]]>) {
      problems.forEach((problem, index) => {
        const r = solutionsFor(problem, lesson.size);
        rows.push({ lesson: lesson.id, phase, index, problem: problem.goal.kind, ...r });
      });
    }
  }
  return rows;
}
