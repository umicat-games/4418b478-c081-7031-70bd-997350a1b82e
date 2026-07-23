// Data-driven CROP config — a first taste of umicat's "game data table" idea.
//
// The tunable content (which crops exist + their stats: grow time, stages, …) lives
// in `public/data/crops.json` — a plain table (rows = crops, columns = fields). The
// game just LOADS it at boot; nothing about balance is hard-coded in logic. This is
// the shape a future visual "data table" tool (or the AI, or a non-coder) would edit.
//
// The built-in FALLBACK below is used only if the JSON is missing/unusable, so the
// game never breaks. NOTE: a crop's `name` must match its atlas frame names
// (`grow-<name>-<n>`, `<name>-seed-bag`, `crop-<name>`), so adding a NEW crop needs
// matching art — the eventual tool would wire that via asset-reference columns.

export type CropName = string;
export interface CropDef {
  stages: number; // growth stages (frames grow-<name>-0 .. -(stages-1)); mature = last
  tall: boolean; // 16×32 art (corn) vs 16×16
  label: string;
  growWateredMs: number; // ms per stage on WET soil
  growDryMs: number; // ms per stage on dry soil
}

const FALLBACK: Record<string, CropDef> = {
  corn: { stages: 5, tall: true, label: 'Corn', growWateredMs: 3500, growDryMs: 12000 },
  carrot: { stages: 4, tall: false, label: 'Carrot', growWateredMs: 2500, growDryMs: 9000 },
  tomato: { stages: 4, tall: false, label: 'Tomato', growWateredMs: 3000, growDryMs: 10000 },
  eggplant: { stages: 4, tall: false, label: 'Eggplant', growWateredMs: 4000, growDryMs: 14000 },
  pumpkin: { stages: 4, tall: false, label: 'Pumpkin', growWateredMs: 6000, growDryMs: 20000 },
};

// MUTABLE, populated by applyCropData() at boot. Seeded with the fallback so the game
// works even if the data file never loads. Consumers import the live reference.
export const CROPS: Record<string, CropDef> = { ...FALLBACK };
export let CROP_NAMES: string[] = Object.keys(CROPS);

interface CropRow {
  name: string;
  label?: string;
  stages?: number;
  tall?: boolean;
  growWateredSec?: number;
  growDrySec?: number;
}

/** Replace CROPS with the loaded data table (`public/data/crops.json`, shape
 *  `{ crops: CropRow[] }`). Tolerant: skips malformed rows, keeps the fallback if the
 *  payload is unusable. Mutates the shared CROPS object in place so existing imports
 *  see the update. */
export function applyCropData(json: unknown): void {
  const rows = (json as { crops?: CropRow[] } | null | undefined)?.crops;
  if (!Array.isArray(rows) || rows.length === 0) return; // keep fallback
  const next: Record<string, CropDef> = {};
  for (const r of rows) {
    if (!r || typeof r.name !== 'string') continue;
    next[r.name] = {
      stages: Math.max(2, Math.round(r.stages ?? 4)),
      tall: !!r.tall,
      label: r.label ?? r.name,
      growWateredMs: Math.round((r.growWateredSec ?? 3.5) * 1000),
      growDryMs: Math.round((r.growDrySec ?? 12) * 1000),
    };
  }
  if (Object.keys(next).length === 0) return; // keep fallback
  for (const k of Object.keys(CROPS)) delete CROPS[k];
  Object.assign(CROPS, next);
  CROP_NAMES = Object.keys(CROPS);
}
