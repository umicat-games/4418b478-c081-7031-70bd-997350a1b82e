// The twenty-one pieces, and the one rule that makes Blokus Blokus.
//
// A piece may touch your own colour at the CORNERS and never along an EDGE.
// Everything else — the first piece having to cover your corner of the board,
// a turn being skipped when nothing fits, the game ending when nobody can
// move — falls out of that single test, which is why `canPlace` is the only
// place in this game that is allowed to decide whether a move is legal. The
// board view asks it, the bot asks it, the network never sends anything else.
//
// Cells are `[x, y]` with `y` running down the board, and the board is a flat
// array of 400 indexed `y * 20 + x`, so a row printed in order is a row as a
// player sees it. The same array is what crosses the network.

export type Cell = [number, number];
export type Cells = Cell[];

export const SIZE = 20;
export const CELLS = SIZE * SIZE;

/** Nobody's. `-1` rather than `0` so player 0 is a real player. */
export const EMPTY = -1;

// ── the shapes ─────────────────────────────────────────────────────────────
// One polyomino per size class, in the standard Blokus set: the monomino, the
// domino, two trominoes, five tetrominoes, twelve pentominoes. 89 squares in
// all, which is also the perfect score.
export const BASE: Record<string, Cells> = {
  I1: [[0, 0]],
  I2: [[0, 0], [1, 0]],
  I3: [[0, 0], [1, 0], [2, 0]],
  V3: [[0, 0], [1, 0], [0, 1]],
  I4: [[0, 0], [1, 0], [2, 0], [3, 0]],
  L4: [[0, 0], [0, 1], [0, 2], [1, 2]],
  T4: [[0, 0], [1, 0], [2, 0], [1, 1]],
  S4: [[1, 0], [2, 0], [0, 1], [1, 1]],
  O4: [[0, 0], [1, 0], [0, 1], [1, 1]],
  F5: [[1, 0], [2, 0], [0, 1], [1, 1], [1, 2]],
  I5: [[0, 0], [1, 0], [2, 0], [3, 0], [4, 0]],
  L5: [[0, 0], [0, 1], [0, 2], [0, 3], [1, 3]],
  N5: [[1, 0], [1, 1], [0, 2], [1, 2], [0, 3]],
  P5: [[0, 0], [1, 0], [0, 1], [1, 1], [0, 2]],
  T5: [[0, 0], [1, 0], [2, 0], [1, 1], [1, 2]],
  U5: [[0, 0], [2, 0], [0, 1], [1, 1], [2, 1]],
  V5: [[0, 0], [0, 1], [0, 2], [1, 2], [2, 2]],
  W5: [[0, 0], [0, 1], [1, 1], [1, 2], [2, 2]],
  X5: [[1, 0], [0, 1], [1, 1], [2, 1], [1, 2]],
  Y5: [[1, 0], [0, 1], [1, 1], [1, 2], [1, 3]],
  Z5: [[0, 0], [1, 0], [1, 1], [1, 2], [2, 2]],
};

export const ALL_PIECES = Object.keys(BASE);

/** Every square of every piece, for one player. The perfect score. */
export const PERFECT = ALL_PIECES.reduce((n, p) => n + BASE[p].length, 0);

// ── turning them ───────────────────────────────────────────────────────────

/** Ninety degrees clockwise, pushed back against the origin. */
function rotate(cells: Cells): Cells {
  const turned = cells.map(([x, y]) => [-y, x] as Cell);
  return normalise(turned);
}

/** Mirrored left-to-right. Blokus pieces may be flipped; several are
 *  chiral (L, N, F, Y, Z, S, P) and the mirror is a different shape. */
function mirror(cells: Cells): Cells {
  return normalise(cells.map(([x, y]) => [-x, y] as Cell));
}

/** Slide a shape so its bounding box starts at (0, 0). Without this the same
 *  shape in two positions would look like two shapes to `key`. */
function normalise(cells: Cells): Cells {
  const minX = Math.min(...cells.map((c) => c[0]));
  const minY = Math.min(...cells.map((c) => c[1]));
  return cells.map(([x, y]) => [x - minX, y - minY] as Cell);
}

function key(cells: Cells): string {
  return [...cells]
    .sort((a, b) => (a[1] !== b[1] ? a[1] - b[1] : a[0] - b[0]))
    .map(([x, y]) => `${x},${y}`)
    .join('|');
}

/**
 * Every DISTINCT way a piece can sit: up to eight, fewer when the shape is
 * symmetric. The duplicates are dropped on purpose — an X has one orientation
 * and a rotate button that cycles four identical pictures is a button that
 * looks broken.
 *
 * The order is fixed (four rotations, then the mirror's four) and both halves
 * are the same length by construction only when the piece is chiral, which is
 * why `flip` below jumps by half the list rather than assuming four.
 */
export function orientationsOf(base: Cells): Cells[] {
  const seen = new Set<string>();
  const out: Cells[] = [];
  for (const start of [normalise(base), mirror(base)]) {
    let cur = start;
    for (let r = 0; r < 4; r++) {
      const k = key(cur);
      if (!seen.has(k)) { seen.add(k); out.push(cur); }
      cur = rotate(cur);
    }
  }
  return out;
}

/** Precomputed once. Orientation INDICES are part of the shared vocabulary —
 *  the bot picks one and the board draws it — so this table must be built the
 *  same way on every client, which it is: it is derived, never authored. */
export const ORIENTATIONS: Record<string, Cells[]> = Object.fromEntries(
  Object.entries(BASE).map(([name, cells]) => [name, orientationsOf(cells)]),
);

/** The next orientation round. */
export const rotated = (piece: string, ori: number): number =>
  (ori + 1) % ORIENTATIONS[piece].length;

/**
 * The mirror of the current orientation.
 *
 * Half a list along: the list is four rotations of the shape followed by four
 * of its mirror, minus duplicates. For a symmetric piece the two halves
 * collapsed into one and this is a no-op — correct, since flipping an O
 * changes nothing and pretending otherwise would be a lie in the interface.
 */
export function flipped(piece: string, ori: number): number {
  const n = ORIENTATIONS[piece].length;
  return (ori + Math.floor(n / 2)) % n;
}

/** The width and height of a shape, in squares. */
export function extent(cells: Cells): { w: number; h: number } {
  return {
    w: Math.max(...cells.map((c) => c[0])) + 1,
    h: Math.max(...cells.map((c) => c[1])) + 1,
  };
}

/**
 * Where a piece's squares land when its shape origin is at `(x, y)`.
 *
 * Deliberately NOT clamped to the board: an off-board placement has to be
 * representable so `canPlace` can say no to it. A shape silently slid back
 * inside would place itself somewhere the player did not point at.
 */
export function cellsAt(piece: string, ori: number, x: number, y: number): Cells {
  const shape = ORIENTATIONS[piece][ori % ORIENTATIONS[piece].length];
  return shape.map(([dx, dy]) => [x + dx, y + dy] as Cell);
}

/**
 * The shape origin that centres a piece on the square under the pointer.
 *
 * Hanging a piece off its top-left corner means the thing you are aiming with
 * is a square that, for an L or a V, is not even part of the piece. Centring
 * keeps the piece under the finger through a rotation, which is what makes
 * "turn it and try again" feel like turning a tile over in your hand.
 */
export function originFor(piece: string, ori: number, aimX: number, aimY: number): Cell {
  const { w, h } = extent(ORIENTATIONS[piece][ori % ORIENTATIONS[piece].length]);
  return [aimX - Math.floor((w - 1) / 2), aimY - Math.floor((h - 1) / 2)];
}

// ── the players ────────────────────────────────────────────────────────────

/**
 * Which corner each colour starts from, and therefore which corner of the
 * board is theirs. Opposite corners for the first two, so a two-handed game
 * still meets in the middle.
 */
export const CORNERS: Cell[] = [
  [0, 0],            // blue    — far left
  [SIZE - 1, SIZE - 1], // red  — near right
  [SIZE - 1, 0],     // green   — far right
  [0, SIZE - 1],     // yellow  — near left
];

/** The four colours of a Blokus set, kept as they are: a player who has seen
 *  the board game should recognise their colour without being told. */
export const COLOURS = [0x3b82f6, 0xef4444, 0x22c55e, 0xf59e0b];
export const COLOUR_NAMES = ['blue', 'red', 'green', 'yellow'] as const;

// ── the rule ───────────────────────────────────────────────────────────────

const EDGES: Cell[] = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const DIAGONALS: Cell[] = [[1, 1], [1, -1], [-1, 1], [-1, -1]];

const inside = (x: number, y: number): boolean => x >= 0 && y >= 0 && x < SIZE && y < SIZE;

/**
 * May this player put these squares here?
 *
 * Four conditions, in the order that rejects fastest:
 *   on the board, on empty squares, never edge-to-edge with your own colour,
 *   and touching your own colour at a corner — except for your first piece,
 *   which instead has to cover your starting corner of the board.
 *
 * Other players' colours are only an obstacle: you may sit edge to edge with
 * them all day, and blocking them that way is most of the game.
 */
export function canPlace(
  board: ArrayLike<number>,
  cells: Cells,
  player: number,
  firstMove: boolean,
): boolean {
  const own = new Set(cells.map(([x, y]) => `${x},${y}`));
  for (const [x, y] of cells) {
    if (!inside(x, y)) return false;
    if (board[y * SIZE + x] !== EMPTY) return false;
    for (const [dx, dy] of EDGES) {
      const nx = x + dx, ny = y + dy;
      if (inside(nx, ny) && board[ny * SIZE + nx] === player) return false;
    }
  }
  if (firstMove) {
    const [cx, cy] = CORNERS[player];
    return cells.some(([x, y]) => x === cx && y === cy);
  }
  for (const [x, y] of cells) {
    for (const [dx, dy] of DIAGONALS) {
      const nx = x + dx, ny = y + dy;
      if (!inside(nx, ny)) continue;
      // A corner of the piece touching another corner of the SAME piece is
      // not a connection to anything — it has to reach colour already down.
      if (board[ny * SIZE + nx] === player && !own.has(`${nx},${ny}`)) return true;
    }
  }
  return false;
}

/**
 * Has this player anywhere left to go?
 *
 * Every remaining piece, in every orientation, on every square — about two
 * million tests at the start of a game, under a millisecond in practice
 * because `canPlace` rejects on its first occupied square. It is asked after
 * every single move (that is what decides whether a turn is skipped), so if
 * it ever does show up in a profile, the fix is an incremental anchor set,
 * not a cheaper approximation: a player wrongly told they are stuck has had
 * the game taken away from them.
 */
export function hasMove(
  board: ArrayLike<number>,
  pieces: readonly string[],
  player: number,
  firstMove: boolean,
): boolean {
  for (const name of pieces) {
    for (const shape of ORIENTATIONS[name]) {
      for (let y = 0; y < SIZE; y++) {
        for (let x = 0; x < SIZE; x++) {
          const cells = shape.map(([dx, dy]) => [x + dx, y + dy] as Cell);
          if (canPlace(board, cells, player, firstMove)) return true;
        }
      }
    }
  }
  return false;
}

/**
 * The free squares a player could still build out from: their own corners,
 * not blocked, not beside their own colour.
 *
 * Drawn on the board while a piece is in hand, because "touch a corner" is the
 * rule beginners get wrong, and a rule you can see is a rule you stop getting
 * wrong. Before the first piece it is simply the starting corner.
 */
export function anchors(
  board: ArrayLike<number>,
  player: number,
  firstMove: boolean,
): Cells {
  if (firstMove) {
    const [cx, cy] = CORNERS[player];
    return board[cy * SIZE + cx] === EMPTY ? [[cx, cy]] : [];
  }
  const out: Cells = [];
  const seen = new Set<string>();
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      if (board[y * SIZE + x] !== player) continue;
      for (const [dx, dy] of DIAGONALS) {
        const nx = x + dx, ny = y + dy;
        if (!inside(nx, ny) || board[ny * SIZE + nx] !== EMPTY) continue;
        const k = `${nx},${ny}`;
        if (seen.has(k)) continue;
        let beside = false;
        for (const [ex, ey] of EDGES) {
          const ax = nx + ex, ay = ny + ey;
          if (inside(ax, ay) && board[ay * SIZE + ax] === player) { beside = true; break; }
        }
        if (beside) continue;
        seen.add(k);
        out.push([nx, ny]);
      }
    }
  }
  return out;
}

/** How many squares are still in a player's hand — the number their final
 *  score is docked by, and the one worth showing while they still can. */
export const squaresLeft = (pieces: readonly string[]): number =>
  pieces.reduce((n, p) => n + BASE[p].length, 0);
