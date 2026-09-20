// What the opening is called.
//
// This is a lookup table and not a question for the companion, for exactly the
// reason `show_attacks` is not a question for the companion: a language model
// asked to name an opening from a move list will produce a plausible name,
// fluently, and be wrong often enough to matter — and being told "that is the
// Sicilian Dragon" when it is not is worse than being told nothing, because
// the player will go and read about the Dragon.
//
// Deliberately short. It covers what a beginner will actually play in the
// first four or five moves, names it, and stays quiet after that. The moment
// this file starts trying to be an ECO database is the moment it stops being
// maintainable, and a companion that can say "this is a Queen's Gambit" has
// already done the useful part.
//
// Longest match wins, so `1.e4 c5 2.Nf3 d6` is the Najdorf-ish Open Sicilian
// rather than just "Sicilian Defence".
const BOOK: Array<[string[], string]> = [
  [['e4'], 'King\'s Pawn Opening'],
  [['e4', 'e5'], 'Open Game'],
  [['e4', 'e5', 'Nf3'], 'King\'s Knight Opening'],
  [['e4', 'e5', 'Nf3', 'Nc6'], 'King\'s Knight, Normal Variation'],
  [['e4', 'e5', 'Nf3', 'Nc6', 'Bb5'], 'Ruy Lopez'],
  [['e4', 'e5', 'Nf3', 'Nc6', 'Bc4'], 'Italian Game'],
  [['e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'Bc5'], 'Giuoco Piano'],
  [['e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'Nf6'], 'Two Knights Defence'],
  [['e4', 'e5', 'Nf3', 'Nc6', 'd4'], 'Scotch Game'],
  [['e4', 'e5', 'Nf3', 'Nf6'], 'Petrov\'s Defence'],
  [['e4', 'e5', 'Nf3', 'd6'], 'Philidor Defence'],
  [['e4', 'e5', 'Nc3'], 'Vienna Game'],
  [['e4', 'e5', 'Bc4'], 'Bishop\'s Opening'],
  [['e4', 'e5', 'f4'], 'King\'s Gambit'],
  [['e4', 'c5'], 'Sicilian Defence'],
  [['e4', 'c5', 'Nf3'], 'Sicilian Defence'],
  [['e4', 'c5', 'Nf3', 'd6'], 'Sicilian, Open'],
  [['e4', 'c5', 'Nf3', 'Nc6'], 'Sicilian, Old Variation'],
  [['e4', 'c5', 'Nf3', 'e6'], 'Sicilian, French Variation'],
  [['e4', 'c5', 'c3'], 'Sicilian, Alapin'],
  [['e4', 'e6'], 'French Defence'],
  [['e4', 'e6', 'd4', 'd5'], 'French Defence'],
  [['e4', 'c6'], 'Caro-Kann Defence'],
  [['e4', 'd5'], 'Scandinavian Defence'],
  [['e4', 'Nf6'], 'Alekhine\'s Defence'],
  [['e4', 'd6'], 'Pirc Defence'],
  [['e4', 'g6'], 'Modern Defence'],
  [['d4'], 'Queen\'s Pawn Opening'],
  [['d4', 'd5'], 'Closed Game'],
  [['d4', 'd5', 'c4'], 'Queen\'s Gambit'],
  [['d4', 'd5', 'c4', 'dxc4'], 'Queen\'s Gambit Accepted'],
  [['d4', 'd5', 'c4', 'e6'], 'Queen\'s Gambit Declined'],
  [['d4', 'd5', 'c4', 'c6'], 'Slav Defence'],
  [['d4', 'd5', 'Nf3'], 'Queen\'s Pawn Game'],
  [['d4', 'Nf6'], 'Indian Defence'],
  [['d4', 'Nf6', 'c4'], 'Indian Game'],
  [['d4', 'Nf6', 'c4', 'e6'], 'Indian, East Indian'],
  [['d4', 'Nf6', 'c4', 'e6', 'Nc3', 'Bb4'], 'Nimzo-Indian Defence'],
  [['d4', 'Nf6', 'c4', 'e6', 'Nf3', 'b6'], 'Queen\'s Indian Defence'],
  [['d4', 'Nf6', 'c4', 'g6'], 'King\'s Indian Defence'],
  [['d4', 'Nf6', 'c4', 'c5'], 'Benoni Defence'],
  [['d4', 'f5'], 'Dutch Defence'],
  [['c4'], 'English Opening'],
  [['Nf3'], 'Réti Opening'],
  [['b3'], 'Nimzo-Larsen Attack'],
  [['f4'], 'Bird\'s Opening'],
  [['g3'], 'Benko Opening'],
];

/** Sorted longest-first, once, so the lookup is a scan and not a sort. */
const SORTED = [...BOOK].sort((a, b) => b[0].length - a[0].length);

/** The name of the opening this game is in, or null once it is out of book. */
export function openingName(moves: string[]): string | null {
  // Past ten plies the name stops being useful and starts being a claim about
  // a transposition we have not checked.
  if (moves.length > 10) {
    const early = moves.slice(0, 10);
    return lookup(early);
  }
  return lookup(moves);
}

function lookup(moves: string[]): string | null {
  for (const [line, name] of SORTED) {
    if (line.length > moves.length) continue;
    if (line.every((san, i) => san === moves[i])) return name;
  }
  return null;
}
