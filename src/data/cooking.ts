// Data-driven COOKING RECIPES — the cooking counterpart to crafting (recipes.ts). Lives in
// `public/data/cooking.json`; the game LOADS it at boot. Same shape as a crafting recipe:
// each turns raw INGREDIENTS the player has into an OUTPUT dish. Name / icon / description of
// a recipe come from its OUTPUT item (via `itemFromId` + i18n `item_<id>` / `desc_<id>`), so a
// row only needs the output id, yield count, and the ingredient cost. Cooking is opened from
// the kitchen STOVE (inside the house); crafting from the work station (on the island).
// This is the shape the platform Data Tables tool (ADR-020) edits.

export interface CookMat { id: string; count: number }
export interface CookRecipe { id: string; output: string; count: number; materials: CookMat[] }

// The real dish table. `egg-any` / `milk-any` are wildcard materials (see `materialMatches`
// in GameScene): hens and cows produce whatever colour they are, so naming one colour would
// make a dish uncraftable for a player through no choice of their own.
//
// Kept in step with `public/data/cooking.json` on purpose — this fallback is what runs if the
// data file fails to load, and a fallback that disagrees would quietly play a different game
// from the one that was balanced.
const FALLBACK: CookRecipe[] = [
  { id: 'cook-vegetable-stew', output: 'dish-vegetable-stew', count: 1, materials: [{ id: 'crop-carrot', count: 1 }, { id: 'crop-corn', count: 1 }, { id: 'crop-parsnip', count: 1 }] },
  { id: 'cook-tomato-soup', output: 'dish-tomato-soup', count: 1, materials: [{ id: 'crop-tomato', count: 2 }] },
  { id: 'cook-mushroom-soup', output: 'dish-mushroom-soup', count: 1, materials: [{ id: 'forage-red-mushroom', count: 1 }, { id: 'forage-purple-mushroom', count: 1 }, { id: 'milk-any', count: 1 }] },
  { id: 'cook-pumpkin-soup', output: 'dish-pumpkin-soup', count: 1, materials: [{ id: 'crop-pumpkin', count: 1 }, { id: 'milk-any', count: 1 }] },
  { id: 'cook-strawberry-pie', output: 'dish-strawberry-pie', count: 1, materials: [{ id: 'fruit-strawberry', count: 2 }, { id: 'crop-wheat', count: 1 }, { id: 'egg-any', count: 1 }] },
  { id: 'cook-strawberry-yogurt', output: 'dish-strawberry-yogurt', count: 1, materials: [{ id: 'fruit-strawberry', count: 1 }, { id: 'fruit-blueberry', count: 1 }, { id: 'milk-any', count: 1 }] },
  { id: 'cook-fruit-salad', output: 'dish-fruit-salad', count: 1, materials: [{ id: 'fruit-apple', count: 1 }, { id: 'fruit-pear', count: 1 }, { id: 'fruit-grape', count: 1 }] },
  { id: 'cook-pancakes', output: 'dish-pancakes', count: 1, materials: [{ id: 'crop-wheat', count: 1 }, { id: 'egg-any', count: 1 }, { id: 'milk-any', count: 1 }] },
  { id: 'cook-fried-egg', output: 'dish-fried-egg', count: 1, materials: [{ id: 'egg-any', count: 1 }] },
  { id: 'cook-bread', output: 'dish-bread', count: 1, materials: [{ id: 'crop-wheat', count: 2 }] },
];

// MUTABLE, populated by applyCookingData() at boot; seeded with the fallback so the game works
// even if the data file never loads. Consumers import the live reference.
export let COOKING_RECIPES: CookRecipe[] = FALLBACK.slice();

interface CookRow { id?: string; output?: string; count?: number; materials?: CookMat[] }

/** Replace COOKING_RECIPES with the loaded table (`public/data/cooking.json`, shape
 *  `{ recipes: CookRow[] }`). Tolerant: keeps the fallback if the payload is unusable. */
export function applyCookingData(json: unknown): void {
  const rows = (json as { recipes?: CookRow[] } | null | undefined)?.recipes;
  if (!Array.isArray(rows)) return; // keep fallback (a genuinely empty [] is honoured below)
  const next: CookRecipe[] = [];
  for (const r of rows) {
    if (!r || typeof r.output !== 'string' || !Array.isArray(r.materials)) continue;
    const mats = r.materials
      .filter((m) => m && typeof m.id === 'string' && typeof m.count === 'number' && m.count > 0)
      .map((m) => ({ id: m.id, count: Math.round(m.count) }));
    if (mats.length === 0) continue;
    next.push({ id: r.id || r.output, output: r.output, count: Math.max(1, Math.round(r.count ?? 1)), materials: mats });
  }
  // An explicit non-empty table replaces the fallback; an all-invalid payload keeps it.
  if (next.length > 0) COOKING_RECIPES = next;
}
