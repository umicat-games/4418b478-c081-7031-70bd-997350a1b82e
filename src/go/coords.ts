// Go coordinates, the way people say them out loud.
//
// The coach talks in "D4" and "Q16"; the board thinks in `{x, y}`. One
// conversion, here, because the two conventions disagree in three separate
// ways and every one of them has been a bug in somebody's Go program:
//
//   • the letter I IS SKIPPED (…H, J, K…), historically so it cannot be
//     confused with 1 or J in handwriting;
//   • numbers count UP from the bottom, while `y` counts down from the top;
//   • numbers are 1-based.
const LETTERS = 'ABCDEFGHJKLMNOPQRST'; // no I

export const toGtp = (x: number, y: number, size: number): string =>
  `${LETTERS[x]}${size - y}`;

/** Parse "D4" / "d4" back to board coordinates. Returns null if it is not a
 *  point on THIS board — which is the common case when a language model makes
 *  one up, and the reason this returns null instead of throwing. */
export function fromGtp(text: string, size: number): { x: number; y: number } | null {
  // Trimmed of whatever it arrived wrapped in — "(D4)", "D4.", "「D4」". A
  // model writing a coordinate inside punctuation is writing a coordinate,
  // and refusing it means a mark that silently never appears.
  const m = /^[^A-Za-z0-9]*([A-HJ-Ta-hj-t])\s*(\d{1,2})[^A-Za-z0-9]*$/.exec(text);
  if (!m) return null;
  const x = LETTERS.indexOf(m[1].toUpperCase());
  const y = size - Number(m[2]);
  if (x < 0 || x >= size || y < 0 || y >= size) return null;
  return { x, y };
}
