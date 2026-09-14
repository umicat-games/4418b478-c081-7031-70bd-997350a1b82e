/**
 * The first board teaches itself.
 *
 * Not with a paragraph. This game's rule is that explanation happens where the
 * thing is — a prompt when you are standing somewhere the button does
 * something — and a tutorial is the same rule with an ORDER imposed on it: one
 * instruction at a time, and it goes away when you have done it.
 *
 * The steps are `{ text, done }`. `done` is asked every frame and the step is
 * finished the moment it answers true, so nothing is on screen for a second
 * longer than it is true. There is no "next" button: pressing a button to
 * dismiss an instruction about pressing buttons teaches the wrong button.
 *
 * The one real affordance is that **the first wave does not start until you
 * have built something.** A tutorial you can lose while reading it is not a
 * tutorial. Everything else is words.
 *
 * It runs while Meadow is UNCLEARED, not on a first visit — losing your first
 * run and coming back to no help is the moment help was for. Winning it once
 * turns the whole thing off for good.
 */
export interface TutorialStep {
  /** One line. If it needs two, it is two steps. */
  text: string;
  done: () => boolean;
  /** Hold the waves here until this step is finished. */
  gateWaves?: boolean;
  /** Give up on this step after this many seconds and move on.
   *
   *  For the steps that name something OPTIONAL. "Upgrade a tower" waits for a
   *  thing a player may reasonably not do for two minutes, and a step that
   *  waits forever is not an instruction any more, it is a permanent banner
   *  across the bottom of the screen. A probe found this by doing everything
   *  except the optional thing — which is also what a player does.
   *
   *  A step that GATES THE WAVES must never expire: the whole point of it is
   *  that nothing happens until it is satisfied. */
  expires?: number;
}

export interface Tutorial {
  /** The line to show, or null when there is nothing left to say. */
  line(): string | null;
  /** Whether the waves are being held for the current step. */
  holdsWaves(): boolean;
  /** Call once a frame, with the frame's REAL elapsed seconds. Real, because a
   *  step timing out is a thing that happens to a reader, not in the world. */
  update(dtSeconds: number): void;
  /** How far through, for probes and for the save. */
  step(): number;
  done(): boolean;
}

export function createTutorial(steps: TutorialStep[]): Tutorial {
  let i = 0;
  let shownFor = 0;
  return {
    line: () => (i < steps.length ? steps[i].text : null),
    holdsWaves: () => i < steps.length && steps[i].gateWaves === true,
    update: (dtSeconds: number) => {
      shownFor += dtSeconds;
      // A loop, not an `if`: two steps can both become true in the same frame —
      // building a tower finishes "stand on a spot" and "build one" at once —
      // and advancing one at a time would leave an instruction on screen that
      // was already satisfied.
      while (i < steps.length) {
        const s = steps[i];
        const over = s.expires !== undefined && !s.gateWaves && shownFor >= s.expires;
        if (!s.done() && !over) break;
        i += 1;
        shownFor = 0;
      }
    },
    step: () => i,
    done: () => i >= steps.length,
  };
}
