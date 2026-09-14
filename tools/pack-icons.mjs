// The three glyphs on the right-hand buttons.
//
//     npm run icons
//
// Source: Kenney's `Icons/Board Game Icons`, CC0 — 255 white silhouettes, all
// the same stroke weight. Only what is used is copied in; adding another is one
// line in `WANT` and one rerun. (The bottom hotbar is a separate design and is
// deliberately NOT part of this.)
//
// Two things have to be done on the way in.
//
// **The source SVGs have no `viewBox`.** Their paths are centred on the origin
// and run to about +/-36.5, so an `<img src=...>` of one renders at some
// default size with three quarters of the icon off the canvas. ONE viewBox for
// the whole set, not a tight one per icon: a sword and an arrow should come out
// the same visual weight, and fitting each to its own bounds makes the small
// ones huge.
//
// **They are painted white.** They are used as CSS MASKS — `mask-image` plus
// `background: currentColor` — so the fill is discarded and the shape takes
// whatever colour the button already has. That is what keeps them matching the
// platform's own controls when those change colour.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const KENNEY = process.env.KENNEY
  ?? `${process.env.HOME}/work/game-assets/Kenney Game Assets All-in-1 3.4.0`;
const BOARD = join(KENNEY, 'Icons/Board Game Icons/Vector/Icons');
const OUT = new URL('../public/icons/', import.meta.url).pathname;

/** Covers every icon in the pack (they run to +/-36.5) with a little air. */
const VIEWBOX = '-38 -38 76 76';

/** game name -> Kenney file. The Kenney name is kept in the mapping so the
 *  trail back to the pack survives. */
const WANT = {
  // The attack button wears the weapon you are holding: an attack button
  // showing a sword while you carry a bow is a control lying about what it
  // does. `Input3D.setActionIcon` swaps it when the weapon changes.
  sword: 'sword',
  bow: 'bow',
  fire: 'fire',
  // "Put the thing you have chosen on this square" — a hand placing a block.
  // Kenney has no hammer anywhere in the library, and a hammer was the wrong
  // picture for it regardless: you are not hitting anything.
  build: 'hand_cube',
};

/** The one Kenney has no word for.
 *
 *  Drawn in the same weight as the rest — chunky, filled, no outline — so it
 *  sits in the set rather than beside it. The jump button was the text glyph
 *  `▲`, which is a different shape in every platform's font. */
const DRAWN = {
  // Two more the library has no word for. Searched all of it: there is no
  // lightning bolt and no snowflake in any Kenney icon or UI pack.
  bolt: 'M 6 -34 L -20 4 L -3 4 L -9 34 L 20 -6 L 2 -6 Z',
  ice: [
    'M -4.6 -34 L 4.6 -34 L 4.6 34 L -4.6 34 Z',
    'M -32.9 -17.3 L -28.3 -25.2 L 30.6 8.8 L 26 16.7 Z',
    'M 28.3 -25.2 L 32.9 -17.3 L -26 16.7 L -30.6 8.8 Z',
    'M -15 -26 L -4.6 -18 L -4.6 -7 L -19 -19 Z',
    'M 15 -26 L 4.6 -18 L 4.6 -7 L 19 -19 Z',
    'M -15 26 L -4.6 18 L -4.6 7 L -19 19 Z',
    'M 15 26 L 4.6 18 L 4.6 7 L 19 19 Z',
  ].join(' '),
  jump: 'M 0 -34 L 26 -6 L 11 -6 L 11 30 Q 11 34 7 34 L -7 34 Q -11 34 -11 30 L -11 -6 L -26 -6 Z',
};

function main() {
  mkdirSync(OUT, { recursive: true });
  const names = [];
  for (const [name, file] of Object.entries(WANT)) {
    const src = join(BOARD, `${file}.svg`);
    if (!existsSync(src)) { console.error(`missing: ${src}`); process.exitCode = 1; continue; }
    // The source has a bare <svg> with no box. Give it one; leave the paths.
    writeFileSync(join(OUT, `${name}.svg`), readFileSync(src, 'utf8').replace(
      /<svg([^>]*)>/, `<svg$1 viewBox="${VIEWBOX}" width="76" height="76">`));
    names.push(name);
  }
  for (const [name, d] of Object.entries(DRAWN)) {
    writeFileSync(join(OUT, `${name}.svg`),
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${VIEWBOX}" width="76" height="76">`
      + `<path fill="#FFFFFF" d="${d}"/></svg>\n`);
    names.push(name);
  }
  console.log(`${OUT} — ${names.join(', ')}`);
}

main();
