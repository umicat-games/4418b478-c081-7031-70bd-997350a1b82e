/**
 * Reading and writing this game's one save row.
 *
 * It lives in its own file for one reason: **a save is untrusted input the
 * moment it is read back**, and `??` does not check that — it catches a MISSING
 * save, never a malformed one. That distinction crashed the game for real. The
 * debounced `save()` reads `character.position` 500ms later, and if that fires
 * after the character or its rigid body has gone, a coordinate comes back
 * `undefined` — which `JSON.stringify` DROPS from the object rather than writing
 * `null`. The next load gets `{y, z}` with no `x`: truthy, so `saved ?? SPAWN`
 * hands it straight to Rapier, which throws "translation components must be
 * numbers". The whole boot fails, Edit mode included, and because the bad row is
 * now in the database it fails again on every future load until something clears
 * it.
 *
 * Guarded on both ends, because they fix different halves: validating on READ
 * self-heals a row that is already broken, and validating on WRITE stops a new
 * one being made.
 *
 * Where this differs from `umicat-template`, which refuses the whole write when
 * the position is bad: this row carries the run's gold and its two records in
 * the same object as the position. Refusing the write would throw away a
 * session's earnings over one bad coordinate, and writing it would poison the
 * next boot — so the position and the progress are validated separately and a
 * bad position is simply left out. The next load then finds no position and
 * starts at SPAWN with the gold intact.
 */

export interface Vec3 { x: number; y: number; z: number }
export interface Progress { gold: number; bestClock: number; bestKills: number }
export interface SaveRow extends Partial<Vec3>, Partial<Progress> {}

/** Every axis present AND actually a number. `Number.isFinite` rather than
 *  `typeof === 'number'` on purpose: NaN and Infinity are numbers and Rapier
 *  rejects both. */
export function isVec3(v: unknown): v is Vec3 {
  const p = v as Partial<Record<keyof Vec3, unknown>> | null | undefined;
  return !!p && Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.z);
}

const num = (v: unknown, fallback: number): number => (Number.isFinite(v) ? (v as number) : fallback);

/** Everything the game needs from the row, with a usable value for each field
 *  whatever shape the row turned out to be. */
export function readSave(raw: unknown, spawn: Vec3): Vec3 & Progress {
  const row = (raw ?? {}) as SaveRow;
  const position = isVec3(row) ? { x: row.x, y: row.y, z: row.z } : spawn;
  return {
    ...position,
    // The same class of bug applies to every other field — a NaN gold would
    // survive `?? 0` and then render as "NaN" forever.
    gold: num(row.gold, 0),
    bestClock: num(row.bestClock, 0),
    bestKills: num(row.bestKills, 0),
  };
}

/** The row to write. A position that is not fully numeric is omitted rather than
 *  written, so it cannot break the next boot; the progress goes either way. */
export function writeSave(position: unknown, progress: Progress): SaveRow {
  const safe: SaveRow = {
    gold: num(progress.gold, 0),
    bestClock: num(progress.bestClock, 0),
    bestKills: num(progress.bestKills, 0),
  };
  if (isVec3(position)) { safe.x = position.x; safe.y = position.y; safe.z = position.z; }
  return safe;
}
