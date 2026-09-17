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

/** Which key does what the button with this glyph on it does.
 *
 *  Keyed by GLYPH rather than by action id because that is what the prompts
 *  have in hand — and because the one button changes glyph as you hold it
 *  (build → upgrade → sell) while staying the same key. `null` on a touch
 *  screen: there, the button is the answer. Must stay in step with the `keys`
 *  of the `actions` each scene declares to the SDK. */
export const keyFor = (glyph: IconName | string): string | null => {
  if (touchLikely()) return null;
  const byIcon: Record<string, string> = {
    build: 'E', upgrade: 'E', sell: 'E',
    sword: 'J', bow: 'J', fire: 'J', ice: 'J', bolt: 'J',
    jump: 'Space',
  };
  return byIcon[glyph] ?? null;
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
  const key = keyFor(glyph);
  return key ? `<span style="${CAP_CSS}">${key}</span>` : iconHtml(glyph, size);
};

/** "the ⟨icon⟩ button on the right", or "the E key" — whichever the player
 *  actually has. For sentences, which is what the tutorial is made of. */
export const pressName = (glyph: IconName): string => {
  const key = keyFor(glyph);
  return key
    ? `the <span style="${CAP_CSS}">${key}</span> key`
    : `the ${iconHtml(glyph, '1.25em')} button on the right`;
};

/** What a drag is done with. */
export const dragThing = (): string =>
  (touchLikely() ? 'slide your finger' : 'move the mouse');

/** "Tap" or "Click". The tutorial's first instruction is to choose a weapon
 *  from the bar, and it is done with whatever the machine has. */
export const tapWord = (): string => (touchLikely() ? 'Tap' : 'Click');
