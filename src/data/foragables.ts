// Data-driven WILD FORAGABLES + BIG STONES config — same "game data table" idea as
// crops.ts, but for the passive systems: things that spawn on their own on the grass.
//
//  - `public/data/foragables.json` — the growables (grass, sunflower, wild-flower,
//    red/purple-mushroom, small-stone). They appear at stage 1 and grow to `stages`;
//    only the MAX stage is harvestable. Frame convention = `<name>-<stage>` (1-based)
//    in the `forage` atlas (mushrooms_flowers_stones.png).
//  - `public/data/big-stones.json` — the minable rocks (tiers 1/2/3). Frame = `big-stone-<tier>`.
//
// Both load at boot; the built-in FALLBACK is used only if the JSON is missing/unusable,
// so the game never breaks. Tunable in the Data Tables tool.

export type ForagableName = string;
export interface ForagableDef {
  stages: number; // growth stages; frames `<name>-1` .. `<name>-<stages>`; mature = last
  tall: boolean; // 16×32 art (sunflower at max) vs 16×16
  label: string;
  growMs: number; // ms per stage
  spawnWeight: number; // relative chance to be the thing a spawn tick picks
  yieldCount: number; // items granted on harvest
}

export interface BigStoneDef {
  tier: number;
  label: string;
  readyStones: number; // stones available at once (regenerate after each pick)
  regenMs: number; // ms for one picked stone to come back
  breakBonus: number; // stones granted when the empty rock is knocked apart
  spawnWeight: number; // relative chance among big-stone tiers
}

// ---- Foragables ------------------------------------------------------------
const FORAGABLE_FALLBACK: Record<string, ForagableDef> = {
  grass: { stages: 4, tall: false, label: 'Grass', growMs: 6000, spawnWeight: 5, yieldCount: 1 },
  sunflower: { stages: 4, tall: true, label: 'Sunflower', growMs: 8000, spawnWeight: 3, yieldCount: 1 },
  'wild-flower': { stages: 3, tall: false, label: 'Wild Flower', growMs: 7000, spawnWeight: 3, yieldCount: 1 },
  'red-mushroom': { stages: 3, tall: false, label: 'Red Mushroom', growMs: 10000, spawnWeight: 2, yieldCount: 1 },
  'purple-mushroom': { stages: 4, tall: false, label: 'Purple Mushroom', growMs: 12000, spawnWeight: 1, yieldCount: 1 },
  'small-stone': { stages: 6, tall: false, label: 'Small Stone', growMs: 9000, spawnWeight: 2, yieldCount: 1 },
};

export const FORAGABLES: Record<string, ForagableDef> = { ...FORAGABLE_FALLBACK };
export let FORAGABLE_NAMES: string[] = Object.keys(FORAGABLES);

interface ForagableRow {
  name: string;
  label?: string;
  stages?: number;
  tall?: boolean;
  growSec?: number;
  spawnWeight?: number;
  yieldCount?: number;
}

export function applyForagableData(json: unknown): void {
  const rows = (json as { foragables?: ForagableRow[] } | null | undefined)?.foragables;
  if (!Array.isArray(rows) || rows.length === 0) return; // keep fallback
  const next: Record<string, ForagableDef> = {};
  for (const r of rows) {
    if (!r || typeof r.name !== 'string') continue;
    next[r.name] = {
      stages: Math.max(1, Math.round(r.stages ?? 3)),
      tall: !!r.tall,
      label: r.label ?? r.name,
      growMs: Math.round((r.growSec ?? 8) * 1000),
      spawnWeight: Math.max(0, r.spawnWeight ?? 1),
      yieldCount: Math.max(1, Math.round(r.yieldCount ?? 1)),
    };
  }
  if (Object.keys(next).length === 0) return;
  for (const k of Object.keys(FORAGABLES)) delete FORAGABLES[k];
  Object.assign(FORAGABLES, next);
  FORAGABLE_NAMES = Object.keys(FORAGABLES);
}

// ---- Big stones ------------------------------------------------------------
const BIG_STONE_FALLBACK: Record<number, BigStoneDef> = {
  1: { tier: 1, label: 'Big Stone I', readyStones: 1, regenMs: 30000, breakBonus: 1, spawnWeight: 3 },
  2: { tier: 2, label: 'Big Stone II', readyStones: 2, regenMs: 30000, breakBonus: 2, spawnWeight: 2 },
  3: { tier: 3, label: 'Big Stone III', readyStones: 3, regenMs: 30000, breakBonus: 3, spawnWeight: 1 },
};

export const BIG_STONES: Record<number, BigStoneDef> = { ...BIG_STONE_FALLBACK };
export let BIG_STONE_TIERS: number[] = Object.keys(BIG_STONES).map(Number);

interface BigStoneRow {
  tier?: number;
  label?: string;
  readyStones?: number;
  regenSec?: number;
  breakBonus?: number;
  spawnWeight?: number;
}

export function applyBigStoneData(json: unknown): void {
  const rows = (json as { bigStones?: BigStoneRow[] } | null | undefined)?.bigStones;
  if (!Array.isArray(rows) || rows.length === 0) return; // keep fallback
  const next: Record<number, BigStoneDef> = {};
  for (const r of rows) {
    if (!r || typeof r.tier !== 'number') continue;
    const tier = Math.round(r.tier);
    next[tier] = {
      tier,
      label: r.label ?? `Big Stone ${tier}`,
      readyStones: Math.max(1, Math.round(r.readyStones ?? tier)),
      regenMs: Math.round((r.regenSec ?? 30) * 1000),
      breakBonus: Math.max(0, Math.round(r.breakBonus ?? tier)),
      spawnWeight: Math.max(0, r.spawnWeight ?? 1),
    };
  }
  if (Object.keys(next).length === 0) return;
  for (const k of Object.keys(BIG_STONES)) delete BIG_STONES[Number(k)];
  Object.assign(BIG_STONES, next);
  BIG_STONE_TIERS = Object.keys(BIG_STONES).map(Number);
}

// ---- Spawn cadence (global, code-owned; per-type weights live in the tables) ----
export const FORAGE_SPAWN_INTERVAL_MS = 4000; // one spawn attempt this often
export const FORAGE_MAX_ON_MAP = 40; // cap on live foragables + big-stones
export const BIG_STONE_SPAWN_CHANCE = 0.15; // a spawn tick makes a big-stone this often (else a foragable)
