/**
 * What a player carries between runs: a level, and a pile of materials.
 *
 * The numbers here are ARITHMETIC, not measurement — worked out from how many
 * things a board has on it and how many of them a run kills, so that a full
 * village is something like ten good runs rather than two or eighty. They are
 * meant to be adjusted by playing; `verify-3d-balance` measures the fight, not
 * the economy, and pretending otherwise would cost hours per tweak.
 *
 * The working, so the next person can move a number and know what moves:
 *
 *   Enemies per board, boss included: Meadow 75, Frostfall 105, Rivermeet 131,
 *   Crossroads 159. A run that goes the distance kills most of them and
 *   COLLECTS about seventy per cent of what drops — the rest lands on the far
 *   side of the board and times out. So call it 45 pickups on Meadow and 95 on
 *   Crossroads.
 *
 *   At the weights below that is roughly 550 gold / 20 wood / 16 stone from
 *   Meadow, and 2150 / 63 / 51 from Crossroads — before anything is spent on
 *   towers, which comes out of the gold only. Wood and stone have no use during
 *   a run, so they all come home; gold is the one that has to be chosen over.
 *
 *   A fully built village is 4500 gold, 660 wood, 490 stone. Eight to twelve
 *   runs, weighted towards the later boards, which is the point of the later
 *   boards.
 */

export type Material = 'gold' | 'wood' | 'stone';

export interface Materials { gold: number; wood: number; stone: number; }

export const NO_MATERIALS: Materials = { gold: 0, wood: 0, stone: 0 };

export const MATERIAL_ICON: Record<Material, string> = {
  gold: '🪙', wood: '🪵', stone: '🪨',
};

/** What one kill leaves behind, as odds out of one.
 *
 *  Health is the rarest on purpose: with a bar rather than hearts, a drop that
 *  heals is worth a fifth of it, and a kill that might hand one over every
 *  other time makes the bar stop being something to manage. */
export const DROP_WEIGHTS: { kind: Material | 'health'; weight: number }[] = [
  { kind: 'gold', weight: 0.5 },
  { kind: 'wood', weight: 0.22 },
  { kind: 'stone', weight: 0.18 },
  { kind: 'health', weight: 0.1 },
];

/** Roll one. `wounded` is false when the hero is at full health, in which case
 *  a health drop would be a drop that paid nothing. */
export function rollDrop(wounded: boolean): Material | 'health' {
  let r = Math.random();
  for (const d of DROP_WEIGHTS) {
    if (d.kind === 'health' && !wounded) continue;
    r -= d.weight;
    if (r <= 0) return d.kind;
  }
  return 'gold';
}

// --- levels ---------------------------------------------------------------

/** Experience to go from `level` to the next one.
 *
 *  Linear rather than exponential: this is not an RPG, and a curve that doubles
 *  makes the tenth level a grind nobody reaches. Level 10 is about 10,600 XP
 *  total, or twenty-odd runs. */
export const xpToNext = (level: number): number => 300 + (level - 1) * 220;

/** What a finished run is worth.
 *
 *  Waves reached matter more than kills so that pushing deeper beats farming
 *  wave one, and winning is worth a wave and a half on its own. */
export function xpFromRun(opts: { kills: number; wave: number; won: boolean }): number {
  return opts.kills * 3 + opts.wave * 15 + (opts.won ? 100 : 0);
}

/** Fold experience into levels. Returns the level reached and what is left
 *  over, so a summary can fill the bar the right number of times. */
export function applyXp(level: number, xp: number, gained: number): { level: number; xp: number } {
  let lv = level;
  let have = xp + gained;
  while (have >= xpToNext(lv)) {
    have -= xpToNext(lv);
    lv += 1;
  }
  return { level: lv, xp: have };
}

/** Eight per cent a level. At level ten a sword hits for 3.4 instead of 2 —
 *  noticeable across a session, not a different game by level three. */
export const attackMultiplier = (level: number): number => 1 + (level - 1) * 0.08;

/** And three and a half per cent off what comes back, capped at half. Without
 *  a cap this ends as immortality, which is the same as no fight. */
export const damageTakenMultiplier = (level: number): number =>
  1 - Math.min(0.5, (level - 1) * 0.035);
