// A lesson, as a level: teach → practice → quiz → done.
//
// The shape exists so that both sides know where they are. Before it, the coach
// explained things and the conversation drifted; now there is always a current
// phase, a current goal, and a condition that ends it — and all three go into
// what the coach sees every turn, so it can no longer forget what it was doing.
//
// Who decides what:
//
//   the COACH  decides when the explaining is over (it is the only one who can
//              tell whether the student followed it) and does all the talking.
//   the GAME   decides whether an exercise was solved, tracks which lessons are
//              behind the student, and puts the stones out. None of that is
//              safe to leave to a model that wants to be encouraging.
//
// The quiz is the part that makes it a level rather than a chat: no hints, the
// coach stays out of it, and it is the pass that moves the student on. Failing
// is not a dead end — it goes back to practice, which is what a teacher does.
import { LESSONS, lessonById, type Lesson, type Problem } from './curriculum';

export type Phase = 'teach' | 'practice' | 'quiz' | 'done';

export interface Progress {
  /** Which lesson is open, or null when the student is not in the course. */
  lesson: string | null;
  phase: Phase;
  /** Lessons whose quiz has been passed, in the order they were passed. */
  passed: string[];
  /** Attempts at the CURRENT exercise. Reset on every phase change. */
  attempts: number;
}

export const NO_PROGRESS: Progress = { lesson: null, phase: 'teach', passed: [], attempts: 0 };

export class Course {
  private state: Progress;

  constructor(progress?: Partial<Progress>) {
    this.state = { ...NO_PROGRESS, ...progress };
  }

  get progress(): Progress { return { ...this.state }; }
  get active(): boolean { return this.state.lesson !== null && this.state.phase !== 'done'; }
  get phase(): Phase { return this.state.phase; }
  get attempts(): number { return this.state.attempts; }
  get lesson(): Lesson | null { return this.state.lesson ? lessonById(this.state.lesson) ?? null : null; }

  /** Where the student is in the course, for the banner: 2 of 5. */
  get position(): { index: number; total: number } {
    const index = this.lesson ? LESSONS.indexOf(this.lesson) + 1 : this.state.passed.length;
    return { index, total: LESSONS.length };
  }

  /** The first lesson they have not passed — where "continue" goes. */
  static nextFor(passed: string[]): Lesson {
    return LESSONS.find((l) => !passed.includes(l.id)) ?? LESSONS[LESSONS.length - 1];
  }

  /** Open a lesson at its first phase. Unknown ids are ignored rather than
   *  crashing the course: the coach can ask for one, and the coach can be wrong. */
  start(id?: string): Lesson | null {
    const lesson = id ? lessonById(id) : Course.nextFor(this.state.passed);
    if (!lesson) return null;
    this.state.lesson = lesson.id;
    this.state.phase = 'teach';
    this.state.attempts = 0;
    return lesson;
  }

  leave(): void {
    this.state.lesson = null;
    this.state.phase = 'done';
  }

  /** The position the current phase is played on, if it has one. `teach` may
   *  have a demo board; `done` never has anything. */
  problem(): Problem | null {
    const lesson = this.lesson;
    if (!lesson) return null;
    if (this.state.phase === 'teach') return lesson.demo ?? null;
    if (this.state.phase === 'practice') return lesson.practice[0] ?? null;
    if (this.state.phase === 'quiz') return lesson.quiz[0] ?? null;
    return null;
  }

  /** Count a failed attempt at the current exercise. */
  missed(): number {
    return ++this.state.attempts;
  }

  /**
   * Move on. Returns the phase now in play.
   *
   * A lesson with no practice problems (the last one is a whole game) skips
   * straight from teaching to its quiz — an empty exercise would otherwise be a
   * phase the student can never leave.
   */
  advance(): Phase {
    const lesson = this.lesson;
    if (!lesson) return 'done';
    this.state.attempts = 0;
    if (this.state.phase === 'teach') {
      this.state.phase = lesson.practice.length ? 'practice' : 'quiz';
    } else if (this.state.phase === 'practice') {
      this.state.phase = 'quiz';
    } else if (this.state.phase === 'quiz') {
      if (!this.state.passed.includes(lesson.id)) this.state.passed.push(lesson.id);
      this.state.phase = 'done';
    }
    return this.state.phase;
  }

  /** A failed quiz goes back to practice. Not to the start of the lesson: the
   *  explaining was not the part that did not work. */
  backToPractice(): void {
    const lesson = this.lesson;
    this.state.phase = lesson?.practice.length ? 'practice' : 'teach';
    this.state.attempts = 0;
  }

  /** Open the next unpassed lesson. Null when the course is finished. */
  next(): Lesson | null {
    const remaining = LESSONS.find((l) => !this.state.passed.includes(l.id));
    if (!remaining) { this.leave(); return null; }
    return this.start(remaining.id);
  }

  get finished(): boolean {
    return LESSONS.every((l) => this.state.passed.includes(l.id));
  }
}
