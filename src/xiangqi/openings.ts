// What the opening is called.
//
// A lookup table and not a question for the assistant, for exactly the reason
// `show_moves` is not a question for the assistant: a language model asked to
// name a xiangqi opening from a move list will produce a plausible name,
// fluently, and be wrong often enough to matter. Being told "this is 屏风马"
// when it is not is worse than being told nothing, because the player will go
// and read about 屏风马.
//
// Deliberately short: what a beginner actually plays in the first two or three
// moves, named, and quiet after that. The moment this file tries to be an
// opening encyclopaedia is the moment it stops being maintainable.
//
// Moves are ICCS pairs ("h2e2"), and the board is symmetric — every line below
// exists twice, once from each wing, which is why the table is written once
// and mirrored in code.
const BOOK: Array<[string[], string]> = [
  [['h2e2'], '中炮(当头炮)'],
  [['h2e2', 'h9g7'], '中炮对屏风马'],
  [['h2e2', 'b9c7'], '中炮对屏风马'],
  [['h2e2', 'h7e7'], '顺炮'],
  [['h2e2', 'b7e7'], '列炮'],
  [['h2e2', 'c9e7'], '中炮对飞象局'],
  [['h2f2'], '士角炮'],
  [['h2d2'], '过宫炮'],
  [['g0e2'], '飞相局'],
  [['h0g2'], '起马局'],
  [['g3g4'], '仙人指路'],
  [['g3g4', 'c7g7'], '仙人指路对卒底炮'],
  [['e3e4'], '中兵局'],
  [['i3i4'], '进边兵'],
];

/** Left and right are the same opening under a different name only to a
 *  pedant; to a beginner they are the same idea. The mirror flips files
 *  a↔i, b↔h, c↔g, d↔f and leaves e alone. */
const FILES = 'abcdefghi';
const mirrorSquare = (s: string): string => FILES[8 - FILES.indexOf(s[0])] + s[1];
const mirrorMove = (m: string): string => mirrorSquare(m.slice(0, 2)) + mirrorSquare(m.slice(2, 4));

const TABLE: Array<[string[], string]> = BOOK.flatMap(([line, name]) => [
  [line, name] as [string[], string],
  [line.map(mirrorMove), name] as [string[], string],
]);

/** The name of the opening these moves are in, or null. Longest match wins, so
 *  a line that has become something more specific is named as that. */
export function openingName(moves: string[]): string | null {
  let best: string | null = null;
  let bestLength = 0;
  for (const [line, name] of TABLE) {
    if (line.length > moves.length || line.length <= bestLength) continue;
    if (line.every((m, i) => m === moves[i])) { best = name; bestLength = line.length; }
  }
  return best;
}
