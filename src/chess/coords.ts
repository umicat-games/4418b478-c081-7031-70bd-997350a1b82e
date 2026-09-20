// `e4` ⇄ `{x, y}`, and the one convention this game holds to.
//
// Chess has exactly one naming convention and everybody agrees on it, which
// makes this file a tenth the size of the Go game's equivalent. What still has
// to be decided is which way `y` runs, and the answer is chosen so that three
// things line up for free:
//
//   y = 0 is RANK 8 — the far side of the board, Black's back rank.
//
// so `board[y][x]` printed top to bottom is a chess diagram as a book prints
// one (rank 8 first); the far side of the board is the far side in world space
// (+z is towards the player); and the array the coach is shown needs no
// flipping to be read.
import type { Square } from 'chess.js';

export interface Sq { x: number; y: number }

const FILES = 'abcdefgh';

/** `{x,y}` → `e4`. */
export const toSan = (x: number, y: number): Square => `${FILES[x]}${8 - y}` as Square;

/** `e4` → `{x,y}`. Null for anything that is not a square, which includes
 *  every piece of prose a language model might hand us. */
export function fromSan(s: string): Sq | null {
  const m = /^\s*([a-hA-H])\s*([1-8])\s*$/.exec(s);
  if (!m) return null;
  return { x: FILES.indexOf(m[1].toLowerCase()), y: 8 - Number(m[2]) };
}

export const sameSq = (a: Sq | null, b: Sq | null): boolean =>
  !!a && !!b && a.x === b.x && a.y === b.y;

/** A UCI move (`e2e4`, `e7e8q`) → the two squares and the promotion. */
export function fromUci(uci: string): { from: Sq; to: Sq; promotion?: string } | null {
  const m = /^([a-h][1-8])([a-h][1-8])([qrbn])?$/.exec(uci.trim().toLowerCase());
  if (!m) return null;
  const from = fromSan(m[1]);
  const to = fromSan(m[2]);
  if (!from || !to) return null;
  return { from, to, promotion: m[3] };
}

export const toUci = (from: Sq, to: Sq, promotion?: string): string =>
  `${toSan(from.x, from.y)}${toSan(to.x, to.y)}${promotion ?? ''}`;
