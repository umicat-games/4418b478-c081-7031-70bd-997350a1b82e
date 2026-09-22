// Othello coordinates: columns a–h from the left, rows 1–8 from the TOP.
//
// Unlike chess, row 1 is the top row — that is the convention every Othello
// book and every online board uses, and the board array runs the same way, so
// there is no flip anywhere in this game. The one place that matters is the
// legend the assistant is given: it must say which end is row 1, because a
// model that has to guess will guess.
import type { Notation, Point } from '../shell/notation';

const LETTERS = 'abcdefgh';

export const notation = (): Notation => ({
  format: (p: Point): string => `${LETTERS[p.x]}${p.y + 1}`,
  parse: (text: string): Point | null => {
    // Trimmed of whatever it arrived wrapped in — "(d3)", "d3.", "「d3」".
    const m = /^[^A-Za-z0-9]*([A-Ha-h])\s*([1-8])[^A-Za-z0-9]*$/.exec(text.trim());
    if (!m) return null;
    return { x: LETTERS.indexOf(m[1].toLowerCase()), y: Number(m[2]) - 1 };
  },
});

export const letters = LETTERS;
