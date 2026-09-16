import { iconHtml } from './icons';

/**
 * The tutorial board's script.
 *
 * One instruction at a time, in a box, and the next one does not arrive until
 * the last one is DONE. That is a different teaching model from the rest of
 * this game — everywhere else, explanation happens where the thing is and goes
 * away when it stops being true — and it is the right one exactly once, for a
 * player who does not yet know that there is a bottom bar, or that the button
 * on the right does more than one thing.
 *
 * Two rules hold it together:
 *
 *  1. **Every step is satisfiable from wherever you are standing.** No step
 *     requires having done something optional first. A scripted sequence with
 *     a precondition that can fail is a game you have to reinstall.
 *  2. **The board cannot be lost.** Leaks do not cost a life and the hero takes
 *     no damage here (see `scripted` in `startLevel`). The script deliberately
 *     lets an enemy walk the whole road — that is how the last step teaches you
 *     to swing at it — and a board that punishes you for following its own
 *     instructions is not a tutorial.
 */

export interface ScriptStep {
  /** The instruction. One thing to do. */
  text: string;
  /** True once the player has done it. Asked every frame. */
  done: () => boolean;
  /** Fired once, when this step becomes the current one. Where the script
   *  spawns enemies and opens and closes the gates on what is allowed. */
  enter?: () => void;
  /** Where to point the ground trail, if anywhere. */
  at?: () => { x: number; z: number } | null;
  /** A hotbar slot to ring, if any. */
  slot?: () => number | null;
}

export interface Script {
  update(): void;
  /** Which step is current, for probes. -1 once it is over. */
  index(): number;
  text(): string | null;
  /** Where the trail should point this frame. */
  target(): { x: number; z: number } | null;
  /** Which hotbar slot to ring this frame. */
  slot(): number | null;
  done(): boolean;
  dispose(): void;
}

/** The box the instruction sits in.
 *
 *  Bottom-centre and ABOVE the hotbar, because half the steps are about the
 *  hotbar and a box covering the thing it is talking about is worse than no
 *  box. `pointer-events: none` throughout — every step is completed by playing,
 *  never by pressing the instruction. */
function makeBox(): HTMLElement {
  const el = document.createElement('div');
  el.dataset.script = '';
  el.style.cssText = `
    position: fixed; left: 50%; transform: translateX(-50%); bottom: 116px;
    z-index: 30; max-width: min(520px, 84vw); pointer-events: none;
    background: rgba(12,17,23,.82); color: #fff; border-radius: 14px;
    padding: 11px 18px; text-align: center; opacity: 0;
    font: 700 15px/1.45 system-ui, sans-serif;
    transition: opacity 220ms ease-out;
  `;
  return el;
}

export function createScript(steps: ScriptStep[], hudEl: HTMLElement): Script {
  const box = makeBox();
  hudEl.append(box);
  let i = -1;
  let shown: string | null = null;

  const enter = (n: number): void => {
    i = n;
    if (n >= 0 && n < steps.length) steps[n].enter?.();
  };
  enter(0);

  return {
    update() {
      if (i < 0 || i >= steps.length) return;
      // The text FIRST, then the completion test, so a step that is already
      // true when it arrives still gets its instruction on screen for a frame
      // rather than flashing past unread.
      const step = steps[i];
      if (step.text !== shown) {
        shown = step.text;
        box.innerHTML = step.text;
        box.style.opacity = '1';
      }
      if (step.done()) {
        if (i + 1 >= steps.length) { i = -1; box.style.opacity = '0'; return; }
        enter(i + 1);
      }
    },
    index: () => i,
    text: () => (i >= 0 && i < steps.length ? steps[i].text : null),
    target: () => (i >= 0 && i < steps.length ? steps[i].at?.() ?? null : null),
    slot: () => (i >= 0 && i < steps.length ? steps[i].slot?.() ?? null : null),
    done: () => i < 0,
    dispose: () => box.remove(),
  };
}

/** The instruction text, with the button it names drawn into it. A step that
 *  says "press the build button" and does not show which button is a step that
 *  has to be read twice. */
export const withIcon = (icon: Parameters<typeof iconHtml>[0], text: string): string =>
  `${iconHtml(icon, '1.25em')} ${text}`;
