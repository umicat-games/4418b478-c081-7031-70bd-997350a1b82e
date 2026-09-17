/**
 * The game's name, as a picture.
 *
 * It was `BALABOO` set in the system UI font at `min(13vw, 54px)` with a gold
 * fill and a hard drop shadow — a decent stand-in, and a different typeface on
 * every platform it ran on. This is the drawn logo.
 *
 * **One definition, because two screens draw it.** The loading screen and the
 * title screen wear the same wordmark at the same size in the same place, and
 * that is load-bearing: the title loads UNDER the loader and the loader fades
 * out over it, so anything that differs between the two turns a dissolve into a
 * cut, and the whole thing reads as two title screens rather than one screen
 * finishing. They drifted once already when the loader was flat blue with dark
 * letters, and the report was "it flashes a different title first".
 *
 * `aspect-ratio` is on the element, so the box exists before the image has
 * loaded. Without it the stack is short by 282 pixels for the first frames and
 * everything under it jumps down when the picture arrives — on the LOADING
 * screen, which is the first thing anyone sees.
 */

/** Its natural size, for the aspect box. */
const W = 880;
const H = 282;

export const WORDMARK = `<img src="uploaded/balaboo-title.png" alt="Balaboo"
  width="${W}" height="${H}" style="
    display:block; width:min(76vw, 380px); height:auto; aspect-ratio:${W}/${H};
    filter:drop-shadow(0 6px 14px rgba(0,0,0,.34));">`;
