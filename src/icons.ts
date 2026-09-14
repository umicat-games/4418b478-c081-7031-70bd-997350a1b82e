import type { Weapon } from './weapons';

/**
 * The glyphs on the right-hand buttons.
 *
 * Kenney's Board Game Icons (CC0), plus a jump arrow, a lightning bolt and a
 * snowflake drawn to match — the library has no word for any of those three.
 * `tools/pack-icons.mjs` is the recipe; `npm run icons` regenerates
 * `public/icons/`.
 *
 * Why not emoji, which is what these were:
 *
 * - **An emoji is a different picture on every platform.** `⚔` is crossed
 *   swords on iOS, a single sword on Android and a monochrome outline on some
 *   Windows builds — and the control layer is the one part of the screen that
 *   has to look deliberate on all of them.
 * - **It is TEXT, and text can be selected.** Long-pressing the attack button
 *   is how the iOS Copy / Look Up / Translate callout came up mid-fight, with
 *   the selection handles clamped around the little crossed swords.
 * - **It cannot be coloured.** An emoji ignores `color`, so a glyph could never
 *   match the controls drawn beside it.
 *
 * They go to `Input3D` as URLs and are drawn as CSS masks, so they take the
 * button's own colour rather than carrying one of their own.
 *
 * The bottom weapon hotbar is a separate design and is deliberately not here.
 */
export const ICON = {
  build: 'icons/build.svg',
  jump: 'icons/jump.svg',
} as const;

/** What the attack button shows while you are holding `w`.
 *
 *  One control, five meanings — swinging a sword, loosing an arrow and calling
 *  down lightning are not the same action, and a button that shows a sword
 *  through all of them is telling you the wrong thing about the one you have. */
export const WEAPON_ICON: Record<Weapon, string> = {
  sword: 'icons/sword.svg',
  bow: 'icons/bow.svg',
  fire: 'icons/fire.svg',
  ice: 'icons/ice.svg',
  bolt: 'icons/bolt.svg',
};
