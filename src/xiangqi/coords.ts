// Xiangqi coordinates, in the one notation everything here agrees on.
//
// Chinese chess has two ways of naming a move and neither is a grid reference.
// The traditional one ("炮二平五") names the FILE by counting from the moving
// side's own right, so the same square has two different names depending on
// whose turn it is, and a piece's name changes as it moves. Beautiful to read,
// impossible to anchor a speech bubble to.
//
// So the game speaks ICCS, which is the standard machine notation and is a
// plain grid: files `a`–`i` left to right from Red's seat, ranks `0`–`9`
// counting up from Red's back line. Red's king starts on `e0`, Black's on
// `e9`. A move is a pair of squares, `h2e2`.
//
// The assistant is told to use it too (see `public/playbooks/coach.md`), for
// the same reason the Go coach was told to use `D4`: a coordinate the game can
// parse is a coordinate it can point at. It is free to SAY "炮二平五" in its
// prose — that is the language of the game — as long as the marker it aims
// the bubble with is `[e2]`.
//
// The board array runs top to bottom, so `y = 0` is Black's back line and
// `y = 9` is Red's: rank and row are mirror images of each other, which is the
// one conversion in this file and the one bug everybody writes twice.
const FILE_LETTERS = 'abcdefghi';

export interface Point { x: number; y: number }

export const toIccs = (x: number, y: number): string => `${FILE_LETTERS[x]}${9 - y}`;

export const pointOf = (square: number): Point => ({ x: square % 9, y: (square / 9) | 0 });
export const squareOf = (x: number, y: number): number => y * 9 + x;

/** Parse "e4" — tolerating whatever it arrived wrapped in, because a model
 *  that writes "(e4)" or "「e4」" is writing a coordinate, and refusing it is a
 *  mark that silently never appears. Null when it is not a square. */
export function fromIccs(text: string): Point | null {
  const m = /^[^A-Za-z0-9]*([A-Ia-i])\s*(\d)[^A-Za-z0-9]*$/.exec(text.trim());
  if (!m) return null;
  const x = FILE_LETTERS.indexOf(m[1].toLowerCase());
  const y = 9 - Number(m[2]);
  if (x < 0 || y < 0 || y > 9) return null;
  return { x, y };
}

/** Parse "h2e2" — a move, as the assistant writes one. */
export function moveFromIccs(text: string): { from: Point; to: Point } | null {
  const m = /^[^A-Za-z0-9]*([A-Ia-i])(\d)\s*[-x]?\s*([A-Ia-i])(\d)[^A-Za-z0-9]*$/.exec(text.trim());
  if (!m) return null;
  const from = fromIccs(m[1] + m[2]);
  const to = fromIccs(m[3] + m[4]);
  return from && to ? { from, to } : null;
}
