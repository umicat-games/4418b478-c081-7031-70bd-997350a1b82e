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

/** Ring the on-screen button a step is telling you to press.
 *
 *  The SDK draws the action buttons and gives them no id, so they are found by
 *  the icon they are currently wearing — each one's glyph is a `<span>` masked
 *  with that action's SVG. Fragile, and worth replacing with a `data-action`
 *  attribute in the SDK the next time it is published; today it is the only way
 *  a game can point at its own button.
 */
export function ringActionButton(icon: string | null): void {
  const buttons = [...document.querySelectorAll<HTMLElement>('[data-umicat-touch] div')]
    .filter((d) => d.style.borderRadius === '50%');
  for (const b of buttons) {
    const glyph = b.querySelector<HTMLElement>('span');
    const mask = glyph ? (glyph.style.webkitMask || glyph.style.mask || '') : '';
    const wanted = !!icon && mask.includes(`${icon}.svg`);
    b.style.boxShadow = wanted ? '0 0 0 3px #ffd76a, 0 0 22px rgba(255,215,106,.85)' : '';
  }
}

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
  /** Which on-screen action button to ring, by the icon it is wearing. */
  button?: () => string | null;
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
  /** Which action button to ring this frame, by icon name. */
  button(): string | null;
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
  // TOP of the screen, not the bottom.
  //
  // It started above the hotbar, which put it across the middle of the play
  // area — over the hero, over the square the step was pointing at, and over
  // the enemy the step was telling you to watch. Translucent did not save it:
  // the thing an instruction is about is the one thing it must not cover.
  el.style.cssText = `
    position: fixed; left: 50%; transform: translateX(-50%); top: 14px;
    z-index: 30; max-width: min(520px, 84vw); pointer-events: none;
    background: rgba(12,17,23,.82); color: #fff; border-radius: 14px;
    padding: 11px 18px; text-align: center; opacity: 0;
    font: 700 15px/1.45 system-ui, sans-serif;
    transition: opacity 220ms ease-out;
  `;
  return el;
}

export function createScript(
  steps: ScriptStep[], hudEl: HTMLElement, onSkip?: () => void,
): Script {
  const box = makeBox();
  hudEl.append(box);

  /** A way out.
   *
   *  Every step here is meant to be completable from wherever you are standing,
   *  and the board cannot be lost — but a scripted sequence with no exit is a
   *  game you have to reinstall if any of that is ever wrong. It costs one
   *  small button and buys the whole class of failure.
   *
   *  It appears after a while, not at once: offered immediately it reads as the
   *  game expecting you to want out, and it is the first thing a player who
   *  skims would press. */
  const skip = document.createElement('button');
  skip.dataset.skip = '';
  skip.textContent = 'Skip';
  skip.style.cssText = `
    position: fixed; left: 50%; transform: translateX(-50%); top: 74px;
    z-index: 30; pointer-events: auto; border: 0; cursor: pointer;
    background: rgba(12,17,23,.55); color: rgba(255,255,255,.75);
    border-radius: 999px; padding: 5px 16px; opacity: 0;
    font: 700 12px/1.4 system-ui, sans-serif; transition: opacity 300ms ease-out;
  `;
  skip.onclick = () => onSkip?.();
  hudEl.append(skip);
  const shownAt = performance.now();
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
      // Offered once someone has been here long enough to want it.
      skip.style.opacity = performance.now() - shownAt > 45000 ? '1' : '0';
      if (step.done()) {
        if (i + 1 >= steps.length) { i = -1; box.style.opacity = '0'; return; }
        enter(i + 1);
      }
    },
    index: () => i,
    text: () => (i >= 0 && i < steps.length ? steps[i].text : null),
    target: () => (i >= 0 && i < steps.length ? steps[i].at?.() ?? null : null),
    slot: () => (i >= 0 && i < steps.length ? steps[i].slot?.() ?? null : null),
    button: () => (i >= 0 && i < steps.length ? steps[i].button?.() ?? null : null),
    done: () => i < 0,
    dispose: () => { box.remove(); skip.remove(); },
  };
}

/** The instruction text, with the button it names drawn into it. A step that
 *  says "press the build button" and does not show which button is a step that
 *  has to be read twice. */
export const withIcon = (icon: Parameters<typeof iconHtml>[0], text: string): string =>
  `${iconHtml(icon, '1.25em')} ${text}`;
