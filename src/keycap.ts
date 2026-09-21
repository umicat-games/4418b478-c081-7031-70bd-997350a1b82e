import { iconHtml, type IconName } from './icons';

/**
 * Telling the player what to press, on a machine where it might be a key.
 *
 * The SDK mounts its on-screen buttons only where there is a touch screen, so
 * on a desktop every "press the ⟨build⟩ button on the right" points at a corner
 * of the screen with nothing in it. The actions were bound to keys all along —
 * what was missing was anybody saying so. Reported as "I picked a weapon with
 * the mouse and I cannot place it", which is exactly what that looks like.
 *
 * One module because the village and the level each grew their own set of these
 * prompts, and a key named in one place and not the other is worse than neither.
 */

/** A phone rather than a laptop with a touchscreen — coarse pointer and no fine
 *  one. The same question the SDK asks before it draws the controls; asking a
 *  different one would eventually name a button that is not there. */
export const touchLikely = (): boolean =>
  window.matchMedia?.('(pointer: coarse)').matches === true
  && window.matchMedia?.('(any-pointer: fine)').matches !== true;

/** How this action is performed on THIS machine.
 *
 *  Keyed by GLYPH rather than by action id because that is what the prompts
 *  have in hand — and because the one button changes glyph as you hold it
 *  (build → upgrade → sell) while staying the same control. Must stay in step
 *  with the `keys` of the `actions` each scene declares to the SDK.
 */
export type Press =
  /** A button on the screen. What a phone has, and what the prompts described
   *  back when a phone was the only thing anybody tested on. */
  | { kind: 'button' }
  | { kind: 'key'; key: string }
  /** The left mouse button, on the world. Not drawn as a key cap, because it
   *  is not one and a cap saying "LMB" is a worse picture of a mouse click
   *  than the words. */
  | { kind: 'click' };

/** Placing, upgrading and selling: SPACE.
 *
 *  It was `E`, which is a perfectly good key and the wrong one here. The left
 *  hand is on WASD the whole time — the hero is walking while you decide where
 *  a tower goes — and the thumb is the only finger that is free. `E` and `J`
 *  both ask that hand to leave the keys it is steering with. Reported by the
 *  player as "反人类", which is exactly right.
 *
 *  `E` and `B` stay bound. A key that used to work and silently stopped is a
 *  worse surprise than an extra one nobody presses. */
export const PLACE_KEY = 'Space';

/* There is no JUMP_KEY. The hero does not jump — see `jump: false` where the
   scenes declare their controls — so Space is simply the place key, and the
   whole Space-versus-jump argument this file used to carry is gone with it. */

export const pressFor = (glyph: IconName | string): Press => {
  if (touchLikely()) return { kind: 'button' };
  const byIcon: Record<string, Press> = {
    build: { kind: 'key', key: PLACE_KEY },
    upgrade: { kind: 'key', key: PLACE_KEY },
    sell: { kind: 'key', key: PLACE_KEY },
    sword: { kind: 'click' }, bow: { kind: 'click' },
    fire: { kind: 'click' }, ice: { kind: 'click' }, bolt: { kind: 'click' },
  };
  return byIcon[glyph] ?? { kind: 'button' };
};

/** The key a glyph is pressed with, or null when it is not a key at all. */
export const keyFor = (glyph: IconName | string): string | null => {
  const p = pressFor(glyph);
  return p.kind === 'key' ? p.key : null;
};

const CAP_CSS = 'display:inline-block; min-width:1.6em; padding:1px 5px;'
  + ' border-radius:5px; background:rgba(255,255,255,.18);'
  + ' border:1px solid rgba(255,255,255,.35); font:700 .82em/1.4 system-ui;'
  + ' text-align:center; vertical-align:.04em;';

/** A key drawn as a key: a little cap, not a word in the middle of a line. */
export const keyCap = (key: string): HTMLElement => {
  const el = document.createElement('span');
  el.textContent = key;
  el.style.cssText = `${CAP_CSS} margin-right:5px;`;
  return el;
};

/** What goes where the button icon used to: the icon, or the key cap. For the
 *  short prompts that are an icon followed by a name. */
export const pressGlyph = (glyph: IconName, size = '1.25em'): string => {
  const p = pressFor(glyph);
  if (p.kind === 'key') return `<span style="${CAP_CSS}">${p.key}</span>`;
  if (p.kind === 'click') return `<span style="${CAP_CSS}">Click</span>`;
  return iconHtml(glyph, size);
};

/** "the ⟨icon⟩ button on the right", or "the E key" — whichever the player
 *  actually has. For sentences, which is what the tutorial is made of. */
export const pressName = (glyph: IconName): string => {
  const p = pressFor(glyph);
  if (p.kind === 'key') return `the <span style="${CAP_CSS}">${p.key}</span> key`;
  if (p.kind === 'click') return 'the left mouse button';
  return `the ${iconHtml(glyph, '1.25em')} button on the right`;
};

/** What a drag is done with. */
export const dragThing = (): string =>
  (touchLikely() ? 'slide your finger' : 'move the mouse');

/** "Tap" or "Click". The tutorial's first instruction is to choose a weapon
 *  from the bar, and it is done with whatever the machine has. */
export const tapWord = (): string => (touchLikely() ? 'Tap' : 'Click');
