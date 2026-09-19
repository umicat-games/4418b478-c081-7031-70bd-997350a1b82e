import { installLiftStyles, LIFT } from './buttons';

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

/** The colour the tutorial points with, and only the tutorial.
 *
 *  NOT gold. Gold already means "chosen" in this game: the selected hotbar cell
 *  wears a `#ffd54a` border, so a gold tutorial ring around the button read as
 *  a second selection rather than as an instruction, and the two were
 *  indistinguishable sitting next to each other.
 *
 *  Cyan is unused anywhere else, and it holds up both on green grass and on the
 *  dark grey of the controls. */
const POINT = '#4fd2ff';

/** The breathing, as one stylesheet rather than a per-frame write.
 *
 *  A ring that sits there is furniture; a ring that breathes is something
 *  asking to be pressed. Done in CSS so the browser animates it off the main
 *  thread — sixty `boxShadow` writes a second is sixty style recalculations.
 *
 *  It APPENDS `--lift-rest` rather than just writing its own ring. A keyframe
 *  that sets box-shadow replaces the whole property, and the things this points
 *  at — the hotbar cells, the desktop pad's button — carry their relief in that
 *  same property, so the highlighted button went flat for as long as it was
 *  being pointed at. The fallback covers anything with no relief on it. */
function breatheStyle(): HTMLStyleElement {
  const st = document.createElement('style');
  st.textContent = `
    @keyframes umicat-point {
      0%, 100% { box-shadow: 0 0 0 3px ${POINT}, 0 0 10px rgba(79,210,255,.45),
                             var(--lift-rest, 0 0 0 0 transparent); }
      50%      { box-shadow: 0 0 0 5px ${POINT}, 0 0 26px rgba(79,210,255,.95),
                             var(--lift-rest, 0 0 0 0 transparent); }
    }
    .umicat-point { animation: umicat-point 1.25s ease-in-out infinite; }
  `;
  return st;
}

/** The scrim, with a hole in it where the thing to press is.
 *
 *  `clip-path` rather than a z-index sandwich: the buttons belong to the SDK's
 *  own touch layer and the hotbar to the game's, each its own stacking context,
 *  and lifting a child out of one of those above a full-screen overlay is not
 *  something a child can do. A hole in the overlay needs no cooperation from
 *  either.
 *
 *  It also takes the pointer events with it — a `clip-path` clips hit-testing,
 *  not just paint — so everything outside the hole is dimmed AND dead, which is
 *  the point. `evenodd` is what makes the inner subpath a hole rather than a
 *  second island.
 */
function makeScrim(): HTMLElement {
  const el = document.createElement('div');
  el.dataset.scrim = '';
  el.style.cssText = `
    position: fixed; inset: 0; z-index: 28; display: none;
    background: rgba(6,10,14,.62); pointer-events: auto;
  `;
  return el;
}

/** Punch the hole over `el`, or take the scrim down if there is nothing to
 *  point at. Rounded, and a little larger than the thing itself, so the ring
 *  breathing around it is inside the hole rather than cut in half by it. */
function spotlight(scrim: HTMLElement, el: HTMLElement | null): void {
  if (!el) { scrim.style.display = 'none'; return; }
  const r = el.getBoundingClientRect();
  if (r.width < 1) { scrim.style.display = 'none'; return; }
  const pad = 10;
  const x = r.left - pad, y = r.top - pad;
  const w = r.width + pad * 2, h = r.height + pad * 2;
  const rad = Math.min(w, h) / 2;
  const W = window.innerWidth, H = window.innerHeight;
  // Outer rectangle, then the hole as its own subpath. Arcs, so a round button
  // gets a round hole and a hotbar cell a rounded-rectangle one.
  const hole = `M ${x + rad} ${y}`
    + ` H ${x + w - rad} A ${rad} ${rad} 0 0 1 ${x + w} ${y + rad}`
    + ` V ${y + h - rad} A ${rad} ${rad} 0 0 1 ${x + w - rad} ${y + h}`
    + ` H ${x + rad} A ${rad} ${rad} 0 0 1 ${x} ${y + h - rad}`
    + ` V ${y + rad} A ${rad} ${rad} 0 0 1 ${x + rad} ${y} Z`;
  scrim.style.clipPath = `path(evenodd, '${`M 0 0 H ${W} V ${H} H 0 Z ${hole}`}')`;
  scrim.style.display = 'block';
}

/** Ring the on-screen button a step is telling you to press.
 *
 *  The SDK draws the action buttons and gives them no id, so they are found by
 *  the icon they are currently wearing — each one's glyph is a `<span>` masked
 *  with that action's SVG. Fragile, and worth replacing with a `data-action`
 *  attribute in the SDK the next time it is published; today it is the only way
 *  a game can point at its own button.
 */
export function ringActionButton(icon: string | null): HTMLElement | null {
  const buttons = [...document.querySelectorAll<HTMLElement>('[data-umicat-touch] div')]
    .filter((d) => d.style.borderRadius === '50%');
  let lit: HTMLElement | null = null;
  for (const b of buttons) {
    const glyph = b.querySelector<HTMLElement>('span');
    const mask = glyph ? (glyph.style.webkitMask || glyph.style.mask || '') : '';
    const wanted = !!icon && mask.includes(`${icon}.svg`);
    b.classList.toggle('umicat-point', wanted);
    if (!wanted) b.style.boxShadow = '';
    else lit = b;
  }
  return lit;
}

export interface ScriptStep {
  /** The instruction. One thing to do.
   *
   *  OPTIONAL. A step with no text is pure staging — it spawns something, opens
   *  a gate, waits for a result — and runs with nothing on screen. Not every
   *  beat of a script needs narrating: a weapon that starts shooting the moment
   *  an enemy walks into range does not need a panel saying that it will, and a
   *  panel covers the very thing it is describing. */
  /** What this step is FOR, on its own line above the instruction.
   *
   *  The body says what to do with your hands; a player who reads
   *  "hold the button until it turns to a bin" and does it still does not
   *  know they have just been taught SELLING. Every step that speaks has one.
   *
   *  Two or three words, a verb first, and **name the thing** — no "it".
   *  A heading reading "Build it" is a heading that assumes the player has
   *  been following along, which is the one assumption a tutorial may not
   *  make; and it is read in the moment BEFORE the body, so there is nothing
   *  behind the pronoun yet. It is a heading, not a second sentence. */
  title?: string;
  text?: string;
  /** True once the player has done it. Asked every frame. */
  done: () => boolean;
  /** Fired once, when this step is CONFIRMED. Where the script spawns enemies
   *  and opens and closes the gates on what is allowed. */
  enter?: () => void;
  /** Called every frame while this step is the live one.
   *
   *  For keeping a step POSSIBLE. A step that waits for something to be killed
   *  in a particular way can have its subject killed the ordinary way — and
   *  then it waits forever, because nothing sends another. Twice now: a tower
   *  killing the enemy the sword step was about, and a tap killing the one the
   *  drag step was about. */
  tick?: () => void;
  /** Seconds to wait after this step is done before the next instruction.
   *
   *  What a step teaches is usually the RESULT — the weapon landing, the enemy
   *  falling, the gold flying to you — and all of that happens in the second
   *  after the step completes. A panel that opens the instant it is satisfied
   *  covers its own lesson. */
  after?: number;
  /** Where to point the ground trail, if anywhere. */
  at?: () => { x: number; z: number } | null;
  /** A hotbar slot to ring, if any. */
  slot?: () => number | null;
  /** Which on-screen action button to ring, by the icon it is wearing. */
  button?: () => string | null;
  /** Whether the player is in position to do this step RIGHT NOW.
   *
   *  The scrim only goes up when this is true, and that is the whole of what it
   *  is for. The scrim eats every touch outside its hole — including the
   *  movement stick — so raising it on a step that still requires WALKING
   *  somewhere pins the player in place, staring at a button that does nothing
   *  from where they are standing.
   *
   *  Absent means never dim: the last step is a chase, and there is no moment
   *  during it when the player should be unable to move. */
  ready?: () => boolean;
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
  /** Dim everything except this element. `null` takes the scrim down. Ignored
   *  unless the current step says it is ready to be acted on. */
  focus(el: HTMLElement | null): void;
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
  installLiftStyles();
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
      <div data-step-title style="font:800 13px/1.4 system-ui, sans-serif;
                  letter-spacing:.09em; text-transform:uppercase;
                  color:#ffd76a; margin-bottom:9px"></div>
      <div data-line style="font:700 16px/1.5 system-ui, sans-serif"></div>
      <button data-ok class="${LIFT.primary}" style="margin-top:16px; border:0; border-radius:999px; cursor:pointer;
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
  const style = breatheStyle();
  hudEl.append(style);
  const scrim = makeScrim();
  hudEl.append(scrim);
  const line = box.querySelector<HTMLElement>('[data-line]')!;
  const heading = box.querySelector<HTMLElement>('[data-step-title]')!;

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
  /** When the beat after a finished step runs out, or null if none is running. */
  let settleUntil: number | null = null;

  const enter = (n: number): void => {
    i = n;
    if (n < 0 || n >= steps.length) { box.style.display = 'none'; return; }
    const t = steps[n].text;
    if (!t) {
      // Nothing to read, so nothing to dismiss: the step begins at once.
      phase = 'do';
      box.style.display = 'none';
      steps[n].enter?.();
      return;
    }
    phase = 'read';
    // Collapsed rather than left empty when a step has no heading, or the
    // panel carries a stripe of padding where a title would have been.
    const head = steps[n].title;
    heading.textContent = head ?? '';
    heading.style.display = head ? 'block' : 'none';
    line.innerHTML = t;
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
      // Nothing is being watched for while the instruction is still up — except
      // the beat, which runs with the panel down.
      if (phase === 'read' && settleUntil === null) return;
      // Waiting out the beat after a finished step, so its result can be seen.
      if (settleUntil !== null) {
        if (performance.now() >= settleUntil) {
          settleUntil = null;
          if (i + 1 >= steps.length) { i = -1; box.style.display = 'none'; return; }
          enter(i + 1);
        }
        return;
      }
      steps[i].tick?.();
      if (steps[i].done()) {
        phase = 'read';            // stop watching; the panel is not up yet
        settleUntil = performance.now() + (steps[i].after ?? 0) * 1000;
      }
    },
    index: () => i,
    phase: () => phase,
    text: () => (i >= 0 && i < steps.length ? steps[i].text ?? null : null),
    target: () => (phase === 'do' && i >= 0 && i < steps.length ? steps[i].at?.() ?? null : null),
    slot: () => (phase === 'do' && i >= 0 && i < steps.length ? steps[i].slot?.() ?? null : null),
    button: () => (phase === 'do' && i >= 0 && i < steps.length ? steps[i].button?.() ?? null : null),
    focus: (el) => spotlight(
      scrim,
      phase === 'do' && i >= 0 && i < steps.length && steps[i].ready?.() ? el : null,
    ),
    done: () => i < 0,
    dispose: () => { box.remove(); skip.remove(); style.remove(); scrim.remove(); },
  };
}

// `withIcon` lived here. The steps build their own lines now, because several
// of them carry TWO pictures — "hold the one until it becomes the other" — and
// a helper that puts one icon in front of a sentence could not say that.
