import type { Weapon } from './weapons';

/**
 * The game's glyphs, as shapes rather than as emoji.
 *
 * Kenney's Board Game Icons (CC0) — 255 white silhouettes, all one stroke
 * weight — plus a jump arrow, a lightning bolt and a snowflake drawn to match,
 * because the library has no word for any of those three.
 * `tools/pack-icons.mjs` is the recipe; `npm run icons` regenerates
 * `public/icons/`.
 *
 * **They are CSS MASKS, not images.** `mask-image` plus `background:
 * currentColor` throws the file's own white away and paints the shape in
 * whatever colour the element already is — so one `heart.svg` is a white button
 * glyph, a red health counter and a grey disabled row, and the file is fetched
 * once for all three.
 *
 * Why not emoji, which is what all of this was:
 *
 * - **An emoji is a different picture on every platform.** `⚔` is crossed
 *   swords on iOS, a single sword on Android and a monochrome outline on some
 *   Windows builds. `🗼` is Tokyo Tower, which is not a thing in this game.
 * - **It is TEXT, and text can be selected.** Long-pressing the attack button
 *   is how the iOS Copy / Look Up / Translate callout came up mid-fight.
 * - **It cannot be coloured.** An emoji ignores `color`, so a disabled row and
 *   an affordable one had the same bright glyph in them, and a warning could
 *   not be red.
 *
 * `size` is in `em` by default, so an icon is the size of the text beside it.
 */

export type IconName =
  | 'sword' | 'bow' | 'fire' | 'ice' | 'bolt'
  | 'build' | 'jump' | 'shield' | 'upgrade' | 'sell'
  | 'house' | 'tower' | 'gate' | 'crate'
  | 'coin' | 'wood' | 'stone' | 'heart' | 'award'
  | 'audioOn' | 'audioOff' | 'settings' | 'swap';

/** Two of these are PNG: the Game Icons pack ships its vectors as one sheet
 *  rather than a file per icon, and a mask reads the ALPHA channel — so a
 *  white-on-transparent PNG serves exactly as well as an SVG at these sizes. */
const PNG = new Set<IconName>(['audioOn', 'audioOff']);
const URL_OF = (name: IconName): string =>
  `icons/${name}.${PNG.has(name) ? 'png' : 'svg'}`;

/** Icons that have been PHOTOGRAPHED from the game's own models, by name.
 *
 *  A silhouette is right for a button — it has to read at a glance, at one
 *  colour, over whatever is behind it. It is wrong for gold and wood and stone,
 *  which are things rather than actions: those want to look like what they are.
 *
 *  Kept as a registry keyed by the SAME names, so every call site — the purse,
 *  the prices in the shop, the cards over buildings, the summary after a run —
 *  turns colour at once without any of them knowing this happened. The action
 *  buttons keep their silhouettes because they ask for different names. */
const photos = new Map<IconName, string>();

/** Hand over a rendered icon. Called once, from wherever has a renderer. */
export function setPhotoIcon(name: IconName, dataUrl: string): void {
  photos.set(name, dataUrl);
}
export function hasPhotoIcon(name: IconName): boolean {
  return photos.has(name);
}

/** What an element needs to BE this icon. Shared by the DOM helper and the HTML
 *  one, so a panel built from a string and a span built from code cannot
 *  drift apart. */
export function iconStyle(name: IconName, size = '1em'): string {
  const photo = photos.get(name);
  // A photograph gets a little more room than a glyph asking for the same size.
  // A silhouette is a solid shape filling its box; a rendered object is lit,
  // shaded and surrounded by its own air, so at the same em it reads smaller
  // and fainter. Done HERE so no call site has to know which kind it asked for.
  const box = `display:inline-block;width:${size};height:${size};`
    + `vertical-align:-0.14em;flex:0 0 auto;${photo ? `scale:1.22;margin:0 .1em;` : ''}`;
  // A photograph is drawn, not masked: a mask would throw away the colour,
  // which is the entire reason it is a photograph.
  if (photo) return `${box}background:url('${photo}') center/contain no-repeat;`;
  const u = `url('${URL_OF(name)}')`;
  return `${box}background-color:currentColor;`
    + `-webkit-mask:${u} center/contain no-repeat;mask:${u} center/contain no-repeat;`;
}

/** For code that appends elements. */
export function icon(name: IconName, size = '1em'): HTMLSpanElement {
  const el = document.createElement('span');
  el.style.cssText = iconStyle(name, size);
  // A shape has no reading. Anything that replaces a word rather than
  // decorating one has to say what it is, or the control is unlabelled.
  el.setAttribute('role', 'img');
  el.setAttribute('aria-label', name);
  return el;
}

/** For the panels that are built as HTML strings. */
export function iconHtml(name: IconName, size = '1em'): string {
  return `<span role="img" aria-label="${name}" style="${iconStyle(name, size)}"></span>`;
}

/** Set an element to `icon + text`, replacing whatever was there.
 *
 *  The HUD counters are rebuilt from a template string every time they change,
 *  and an icon cannot go in one — `textContent` would print the markup. */
export function setIconText(el: HTMLElement, name: IconName, text: string, size = '1em'): void {
  el.textContent = '';
  el.append(icon(name, size), document.createTextNode(text));
}

/** The right-hand buttons, which take URLs rather than elements. */
export const ICON = {
  build: URL_OF('build'),
  jump: URL_OF('jump'),
  // What the action button becomes depending on what you are standing on. The
  // button does three things; a button that looks the same for all three is a
  // button you have to remember rather than read.
  upgrade: URL_OF('upgrade'),
  swap: URL_OF('swap'),
  sell: URL_OF('sell'),
} as const;

/** What the attack button shows while you are holding `w`.
 *
 *  One control, five meanings — swinging a sword, loosing an arrow and calling
 *  down lightning are not the same action, and a button that shows a sword
 *  through all of them is telling you the wrong thing about the one you have. */
export const WEAPON_ICON: Record<Weapon, string> = {
  sword: URL_OF('sword'),
  bow: URL_OF('bow'),
  fire: URL_OF('fire'),
  ice: URL_OF('ice'),
  bolt: URL_OF('bolt'),
};
