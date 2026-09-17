import { icon, type IconName } from './icons';
import { keyCap } from './keycap';

/**
 * The controls a desktop has to be given, because the SDK does not draw any.
 *
 * On a phone the platform mounts round buttons bottom-right and everything —
 * building, upgrading, selling, attacking — happens on them. On a desktop it
 * mounts nothing, so the game has to put something there itself. This is that
 * something, in the same corner, so the two devices share one mental picture.
 *
 * Two cells:
 *
 *   ACTION — a real button. Click it to build, click it on a tower to upgrade,
 *            hold it to sell. It is also what the tutorial's spotlight rings.
 *   WEAPON — a readout, not a control: the weapon in hand with its recharge
 *            drawn over it. What fires it is a click on the world, and a chip
 *            that looked pressable would be claiming otherwise.
 *
 * The button does not call the game directly. It pushes its key through the
 * SDK's own latch (`input.press` / `input.release`), so a click, a hold, the
 * dead zone and the sell ring all behave exactly as they do for the key and for
 * the thumb — one implementation of "what a press means", not three.
 */

export interface ActionPad {
  /** The action button, for the cooldown dial and the tutorial's spotlight. */
  readonly button: HTMLElement;
  /** The weapon readout, or null on a pad built without one. */
  readonly weapon: HTMLElement | null;
  /** What the button will do right now. `null` greys it out. */
  setAction(glyph: IconName | null): void;
  setWeapon(glyph: IconName | null): void;
  /** Match the hotbar's cells, which size themselves to the room available. */
  setCellSize(px: number): void;
  dispose(): void;
}

export interface ActionPadOpts {
  /** The key this button stands for, drawn on it and pushed through the SDK. */
  key: string;
  press(): void;
  release(): void;
  /** Whether to include the weapon readout. The village has no weapons. */
  withWeapon?: boolean;
  /** What the weapon cell is fired with, drawn on it. */
  weaponKey?: string;
}

const CELL = `
  border-radius: 12px; background: rgba(0,0,0,.42); color: #fff;
  font: 600 12px/1.25 system-ui, sans-serif;
  display: flex; flex-direction: column; align-items: center; gap: 3px;
  padding: 6px 3px 5px; box-sizing: border-box;
`;

export function createActionPad(opts: ActionPadOpts): ActionPad {
  const pad = document.createElement('div');
  pad.dataset.actionPad = '';
  pad.style.cssText = `
    position: fixed; right: 14px; bottom: 14px; z-index: 30;
    display: flex; gap: 6px; align-items: flex-end;
    pointer-events: none;
  `;

  const button = document.createElement('button');
  button.dataset.actionButton = '';
  button.style.cssText = `${CELL}
    width: 62px; border: 2px solid rgba(255,255,255,.28); cursor: pointer;
    pointer-events: auto; -webkit-tap-highlight-color: transparent;
    transition: opacity .12s linear, background .12s linear;
  `;
  const glyphBox = document.createElement('span');
  glyphBox.style.cssText = 'display:flex; align-items:center; justify-content:center; width:58%; aspect-ratio:1;';
  button.append(glyphBox, keyCap(opts.key));

  // Down is press, and EVERYTHING is release. A button whose only way out is
  // its own pointerup is a button that can be left held — and held, here, means
  // a tower selling itself a second after you meant to cancel.
  let down = false;
  const end = (): void => {
    if (!down) return;
    down = false;
    button.style.background = 'rgba(0,0,0,.42)';
    opts.release();
  };
  button.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    if (down) return;
    down = true;
    button.style.background = 'rgba(255,255,255,.22)';
    // Capture, so sliding off the button mid-hold is still a hold. Without it,
    // the sell gesture ends the moment the cursor drifts a few pixels.
    try { button.setPointerCapture(e.pointerId); } catch { /* a nicety */ }
    opts.press();
  });
  button.addEventListener('pointerup', end);
  button.addEventListener('pointercancel', end);
  window.addEventListener('blur', end);
  document.addEventListener('visibilitychange', end);

  let weapon: HTMLElement | null = null;
  let weaponGlyph: HTMLElement | null = null;
  if (opts.withWeapon) {
    weapon = document.createElement('div');
    weapon.dataset.weaponChip = '';
    weapon.style.cssText = `${CELL}
      width: 62px; border: 2px dashed rgba(255,255,255,.18); pointer-events: none;
    `;
    weaponGlyph = document.createElement('span');
    weaponGlyph.style.cssText = glyphBox.style.cssText;
    weapon.append(weaponGlyph);
    if (opts.weaponKey) weapon.append(keyCap(opts.weaponKey));
  }

  // The weapon first, then the action: the action is the one the hand is going
  // to and belongs nearest the corner it lives in.
  if (weapon) pad.append(weapon);
  pad.append(button);
  document.body.append(pad);

  const fill = (box: HTMLElement | null, glyph: IconName | null): void => {
    if (!box) return;
    box.textContent = '';
    if (glyph) box.append(icon(glyph, '100%'));
  };

  return {
    button,
    weapon,
    setAction(glyph) {
      fill(glyphBox, glyph);
      button.style.opacity = glyph ? '1' : '.35';
      button.style.cursor = glyph ? 'pointer' : 'default';
    },
    setWeapon(glyph) { fill(weaponGlyph, glyph); },
    setCellSize(px) {
      button.style.width = `${px}px`;
      if (weapon) weapon.style.width = `${px}px`;
    },
    dispose() {
      end();
      window.removeEventListener('blur', end);
      document.removeEventListener('visibilitychange', end);
      pad.remove();
    },
  };
}
