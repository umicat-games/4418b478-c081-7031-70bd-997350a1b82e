// Gomoku coordinates: columns A onwards from the left, rows counted UP from
// the bottom, which is how gomoku and renju have always been written.
//
// Unlike Go, the letter I is NOT skipped — Go skips it because it can be
// misread as 1 or J in handwriting, and gomoku never adopted the habit. The
// board paints the same letters in its margin, so what the assistant says and
// what the player can see agree.
//
// The board array runs top to bottom, so row 1 is the LAST array row: that
// flip is this file's whole job, and it is the bug everybody writes twice.
import type { Notation, Point } from '../shell/notation';

const LETTERS = 'ABCDEFGHIJKLMNOPQRS';

export const notation = (size: number): Notation => ({
  format: (p: Point): string => `${LETTERS[p.x]}${size - p.y}`,
  parse: (text: string): Point | null => {
    // Trimmed of whatever it arrived wrapped in — "(H8)", "H8.", "「H8」". A
    // model writing a coordinate inside punctuation is writing a coordinate,
    // and refusing it means a mark that silently never appears.
    const m = /^[^A-Za-z0-9]*([A-Za-z])\s*(\d{1,2})[^A-Za-z0-9]*$/.exec(text.trim());
    if (!m) return null;
    const x = LETTERS.indexOf(m[1].toUpperCase());
    const y = size - Number(m[2]);
    if (x < 0 || x >= size || y < 0 || y >= size) return null;
    return { x, y };
  },
});

export const letters = LETTERS;
