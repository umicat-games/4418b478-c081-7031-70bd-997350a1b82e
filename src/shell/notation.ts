// How this game names a cell.
//
// The shell has to read and write coordinates in two places — the assistant's
// `[H8]` markers, and the "play here" offer on a speech bubble — and every
// game in this family names cells differently: Go skips the letter I, chess
// counts ranks up from White's side, xiangqi has two names for every file
// depending on whose turn it is. So the game supplies this pair of functions
// and the shell never has an opinion about notation at all.
//
// Parsing is deliberately allowed to fail: a model writes coordinates that do
// not exist, and `null` is how that stays a bubble in the middle of the board
// rather than a crash.
export interface Point { x: number; y: number }

export interface Notation {
  /** "H8" → the cell, or null if that is not a cell on THIS board. */
  parse(text: string): Point | null;
  /** The cell, as the assistant and the player say it. */
  format(p: Point): string;
}
