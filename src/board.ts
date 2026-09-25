import { GLYPHS, type Glyph } from './gesture/recognize';

/**
 * The board, with no three.js in it.
 *
 * Kept pure on purpose: gravity and chain resolution are the two places a
 * match-3 quietly goes wrong — a group counted twice, a column that compacts
 * one cell short, a chain that stops one wave early — and none of those look
 * like anything on screen. They look like "the game feels slightly off". So the
 * rules live here and `tools/board-test.mjs` checks them against hand-written
 * boards.
 *
 * Row 0 is the BOTTOM. Every rule in this game is expressed from the bottom up
 * (what the player clears, where tiles land, which two are live), and a grid
 * indexed from the top makes every one of them read backwards.
 */

export const COLS = 6;
export const ROWS = 9;

export interface Tile { id: number; glyph: Glyph; fresh?: boolean }
export type Grid = (Tile | null)[][];

let nextId = 1;
export const newTile = (glyph: Glyph, fresh = false): Tile => ({ id: nextId++, glyph, fresh });

export const emptyGrid = (): Grid =>
  Array.from({ length: ROWS }, () => Array.from({ length: COLS }, () => null));

export const height = (g: Grid, col: number): number => {
  let h = 0;
  for (let r = 0; r < ROWS; r++) if (g[r][col]) h = r + 1;
  return h;
};

/** Flood fill, 4-neighbour, same glyph. */
export function findGroups(g: Grid, min = 3): Tile[][] {
  const seen = new Set<number>();
  const out: Tile[][] = [];
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const t = g[r][c];
      if (!t || seen.has(t.id)) continue;
      const group: Tile[] = [];
      const stack: [number, number][] = [[r, c]];
      seen.add(t.id);
      while (stack.length) {
        const [rr, cc] = stack.pop()!;
        group.push(g[rr][cc]!);
        for (const [dr, dc] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
          const nr = rr + dr, nc = cc + dc;
          if (nr < 0 || nr >= ROWS || nc < 0 || nc >= COLS) continue;
          const n = g[nr][nc];
          if (!n || seen.has(n.id) || n.glyph !== t.glyph) continue;
          seen.add(n.id);
          stack.push([nr, nc]);
        }
      }
      if (group.length >= min) out.push(group);
    }
  }
  return out;
}

/**
 * What a drawn glyph clears: every tile of that glyph in the LOWEST row that
 * contains one.
 *
 * Two earlier rules and why they lost. **Two ringed targets** told the player
 * what to draw, which left them no decision at all — it was a reaction test
 * wearing a puzzle's clothes. **One tile per gesture** gave the decision back
 * but made it thin, because clearing a single cell rarely changes the shape of
 * anything.
 *
 * Clearing the whole row's worth at once is what makes the choice interesting:
 * the first thing to read is which glyph the floor row holds most of, and the
 * second is what the columns above would land on once it drops. Scoring handles
 * the rest — `n²` for width, divided by depth, so a gesture is never wasted but
 * the one sitting on the floor is the one worth having.
 */
export function lowestMatch(g: Grid, glyph: Glyph): { row: number; tiles: Tile[] } | null {
  for (let r = 0; r < ROWS; r++) {
    const tiles: Tile[] = [];
    for (let c = 0; c < COLS; c++) if (g[r][c]?.glyph === glyph) tiles.push(g[r][c]!);
    if (tiles.length) return { row: r, tiles };
  }
  return null;
}

/** Every glyph still on the board. Fed to the recogniser as `expect`, which
 *  narrows nothing while all four are present and starts helping once the board
 *  runs out of one — and refuses to "recognise" a glyph that could not be
 *  cleared even if it were drawn perfectly. */
export function present(g: Grid): Glyph[] {
  const seen = new Set<Glyph>();
  for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) { const t = g[r][c]; if (t) seen.add(t.glyph); }
  return [...seen];
}

/**
 * The next tile to fall: which column, and which glyph.
 *
 * Biased towards the shorter columns, or the rain piles into one place and the
 * run ends on a coin flip rather than on how the player played. The glyph avoids
 * completing a three-in-a-row where it will land, for the reason the refill
 * already learned: a chain the dealer handed over is not a chain anyone earned,
 * and the cascades it sets off run away.
 *
 * Null means every column is full — there is nowhere left to put anything, which
 * is the end of the run.
 */
export function nextDrop(g: Grid, rng: () => number): { col: number; glyph: Glyph } | null {
  const room: { col: number; weight: number }[] = [];
  let total = 0;
  for (let c = 0; c < COLS; c++) {
    const h = height(g, c);
    if (h >= ROWS) continue;
    const weight = (ROWS - h) ** 1.6;
    room.push({ col: c, weight });
    total += weight;
  }
  if (!room.length) return null;
  let roll = rng() * total;
  let col = room[room.length - 1].col;
  for (const r of room) { roll -= r.weight; if (roll <= 0) { col = r.col; break; } }
  return { col, glyph: safeGlyph(g, height(g, col), col, rng, 3) };
}

/** Put a tile on top of a column's stack. */
export function drop(g: Grid, col: number, glyph: Glyph): Tile | null {
  const r = height(g, col);
  if (r >= ROWS) return null;
  const t = newTile(glyph, true);
  g[r][col] = t;
  return t;
}

export function remove(g: Grid, ids: Set<number>): void {
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const t = g[r][c];
      if (t && ids.has(t.id)) g[r][c] = null;
    }
  }
}

/** Compact every column downwards. Returns true if anything moved. */
export function applyGravity(g: Grid): boolean {
  let moved = false;
  for (let c = 0; c < COLS; c++) {
    let write = 0;
    for (let r = 0; r < ROWS; r++) {
      const t = g[r][c];
      if (!t) continue;
      if (r !== write) { g[write][c] = t; g[r][c] = null; moved = true; }
      write++;
    }
  }
  return moved;
}

/** A glyph that does not already complete a group of `min` where it is landing —
 *  used for the opening board, so the first move is the player's and not the
 *  dealer's. Falls back to a plain random pick when every option matches. */
function safeGlyph(g: Grid, r: number, c: number, rng: () => number, min: number): Glyph {
  const order = [...GLYPHS].sort(() => rng() - 0.5);
  for (const glyph of order) {
    g[r][c] = newTile(glyph);
    const bad = findGroups(g, min).length > 0;
    g[r][c] = null;
    if (!bad) return glyph;
  }
  return GLYPHS[Math.floor(rng() * GLYPHS.length)];
}

/** Fill every column up to `to`, bottom-up. New tiles are flagged `fresh` so the
 *  view knows to drop them in from above the board instead of fading them in. */
export function refill(g: Grid, to: number, rng: () => number, avoidMatches = false): Tile[] {
  const added: Tile[] = [];
  for (let c = 0; c < COLS; c++) {
    for (let r = height(g, c); r < Math.min(to, ROWS); r++) {
      const glyph = avoidMatches
        ? safeGlyph(g, r, c, rng, 3)
        : GLYPHS[Math.floor(rng() * GLYPHS.length)];
      const t = newTile(glyph, true);
      g[r][c] = t;
      added.push(t);
    }
  }
  return added;
}

export const findAt = (g: Grid, id: number): { row: number; col: number } | null => {
  for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) if (g[r][c]?.id === id) return { row: r, col: c };
  return null;
};

/** No room left anywhere. The well filling to the top IS the loss condition, so
 *  this is asked by trying to place the next tile, not by watching a line. */
/** How many tiles are on the board. The rain reads it to know whether the well
 *  has run so empty that there is nothing left to play. */
export const count = (g: Grid): number => {
  let n = 0;
  for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) if (g[r][c]) n++;
  return n;
};

export const isFull = (g: Grid): boolean => {
  for (let c = 0; c < COLS; c++) if (height(g, c) < ROWS) return false;
  return true;
};
