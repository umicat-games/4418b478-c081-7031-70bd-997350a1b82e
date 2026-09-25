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
 * The two tiles the player may clear: the bottom of column `cursor` and of the
 * next non-empty column after it.
 *
 * The first version took the two lowest tiles outright, which sounds like the
 * same thing and is not. Refilling keeps every column at the same height, so
 * "lowest" was a tie across the whole bottom row every single turn, the
 * tie-break always resolved left, and the pair never moved off the bottom-left
 * corner. Only that one column ever drained and refilled — the right half of the
 * board became a frozen wall that nothing but a lucky chain ever touched.
 *
 * A cursor that advances past whatever was just cleared sweeps the pair across
 * the bottom instead, so every column circulates. The player still reads it the
 * same way (two ringed tiles at the bottom, draw one of them) and it costs them
 * no decision, because the choice was always WHICH GLYPH, never which column.
 */
export function targets(g: Grid, cursor: number, n = 2): { tile: Tile; col: number }[] {
  const out: { tile: Tile; col: number }[] = [];
  for (let k = 0; k < COLS && out.length < n; k++) {
    const col = (cursor + k) % COLS;
    const tile = g[0][col];
    if (tile) out.push({ tile, col });
  }
  return out;
}

/** Where the cursor goes after clearing the target at offset `k` of the pair.
 *  Past the furthest one cleared, so the sweep only ever moves forward — a tile
 *  stepped over comes round again next lap rather than holding the pair up. */
export const advance = (cursor: number, k: number): number => (cursor + k + 1) % COLS;

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

export const isLost = (g: Grid): boolean => g[ROWS - 1].some((t) => t !== null);
