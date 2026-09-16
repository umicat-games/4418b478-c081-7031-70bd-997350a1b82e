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
  /** `read` while the panel is up, `do` once it has been dismissed. */
  phase(): 'read' | 'do';
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
  // Middle of the screen, and it goes away when you have read it.
  //
  // It was at the bottom first, which put it over the hero and over the square
  // it was pointing at. Moving it to the top put it over the health bar and the
  // purse. There is nowhere on a phone in landscape that is out of the way of
  // everything — so instead of hunting for a gap, it takes the middle, is
  // READ, and then is not there at all. What is left afterwards is the
  // highlights, which is what the player is supposed to be looking at.
  el.style.cssText = `
    position: fixed; inset: 0; z-index: 35; display: none;
    align-items: center; justify-content: center; padding: 20px;
    box-sizing: border-box; pointer-events: auto;
    background: rgba(8,12,17,.45);
  `;
  el.innerHTML = `
    <div style="max-width:min(460px,86vw); background:rgba(16,22,29,.97); color:#fff;
                border-radius:16px; padding:20px 22px; text-align:center;
                box-shadow:0 14px 44px rgba(0,0,0,.42)">
      <div data-line style="font:700 16px/1.5 system-ui, sans-serif"></div>
      <button data-ok style="margin-top:16px; border:0; border-radius:999px; cursor:pointer;
        padding:9px 30px; font:800 14px system-ui; background:#ffd76a; color:#241b00">OK</button>
    </div>
  `;
  return el;
}

export function createScript(
  steps: ScriptStep[], hudEl: HTMLElement, onSkip?: () => void,
): Script {
  const box = makeBox();
  hudEl.append(box);
  const line = box.querySelector<HTMLElement>('[data-line]')!;

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
  /** `read` while the instruction is up, `do` once it has been dismissed.
   *
   *  The step's own `enter` fires on the DISMISS, not when the step becomes
   *  current: it is where enemies are spawned and where the gates on what the
   *  buttons may do are opened, and none of that should be happening behind a
   *  panel the player is still reading. */
  let phase: 'read' | 'do' = 'read';

  const enter = (n: number): void => {
    i = n;
    if (n < 0 || n >= steps.length) { box.style.display = 'none'; return; }
    phase = 'read';
    line.innerHTML = steps[n].text;
    box.style.display = 'flex';
  };
  const confirm = (): void => {
    if (phase !== 'read' || i < 0 || i >= steps.length) return;
    phase = 'do';
    box.style.display = 'none';
    steps[i].enter?.();
  };
  box.querySelector<HTMLElement>('[data-ok]')!.onclick = confirm;
  enter(0);

  return {
    update() {
      if (i < 0 || i >= steps.length) return;
      // Offered once someone has been here long enough to want it, and never
      // over the instruction panel.
      skip.style.opacity = phase === 'do' && performance.now() - shownAt > 45000 ? '1' : '0';
      // Nothing is being watched for while the instruction is still up.
      if (phase === 'read') return;
      if (steps[i].done()) {
        if (i + 1 >= steps.length) { i = -1; box.style.display = 'none'; return; }
        enter(i + 1);
      }
    },
    index: () => i,
    phase: () => phase,
    text: () => (i >= 0 && i < steps.length ? steps[i].text : null),
    target: () => (phase === 'do' && i >= 0 && i < steps.length ? steps[i].at?.() ?? null : null),
    slot: () => (phase === 'do' && i >= 0 && i < steps.length ? steps[i].slot?.() ?? null : null),
    button: () => (phase === 'do' && i >= 0 && i < steps.length ? steps[i].button?.() ?? null : null),
    done: () => i < 0,
    dispose: () => { box.remove(); skip.remove(); },
  };
}

/** The instruction text, with the button it names drawn into it. A step that
 *  says "press the build button" and does not show which button is a step that
 *  has to be read twice. */
export const withIcon = (icon: Parameters<typeof iconHtml>[0], text: string): string =>
  `${iconHtml(icon, '1.25em')} ${text}`;
