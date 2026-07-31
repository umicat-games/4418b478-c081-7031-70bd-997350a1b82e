// Data-driven CRAFTING RECIPES — the 5th game data table (alongside items / crops /
// foragables / big-stones). Lives in `public/data/recipes.json`; the game LOADS it at
// boot. Each recipe turns RAW materials the player has (pulled from the chest) into an
// OUTPUT item (into the chest). Name / icon / description of a recipe come from its
// OUTPUT item (via `itemFromId` + i18n `item_<id>` / `desc_<id>`), so a recipe row only
// needs the output id, how many it yields, and the material cost. This is the shape the
// platform Data Tables tool (ADR-020) edits.

export interface RecipeMat { id: string; count: number }
export interface Recipe { id: string; output: string; count: number; materials: RecipeMat[] }

// Starter recipes, all using EXISTING items (turn harvested goods back into seeds /
// saplings / bushes, and stone into building pieces). Tune freely in recipes.json.
const FALLBACK: Recipe[] = [
  // Crops → their seeds (re-plant without buying).
  { id: 'corn-seed', output: 'corn-seed', count: 1, materials: [{ id: 'crop-corn', count: 1 }] },
  { id: 'carrot-seed', output: 'carrot-seed', count: 1, materials: [{ id: 'crop-carrot', count: 1 }] },
  { id: 'tomato-seed', output: 'tomato-seed', count: 1, materials: [{ id: 'crop-tomato', count: 1 }] },
  { id: 'eggplant-seed', output: 'eggplant-seed', count: 1, materials: [{ id: 'crop-eggplant', count: 1 }] },
  { id: 'pumpkin-seed', output: 'pumpkin-seed', count: 1, materials: [{ id: 'crop-pumpkin', count: 1 }] },
  // Fruit → tree seedlings; berries → bushes.
  { id: 'tree-apple', output: 'tree-apple', count: 1, materials: [{ id: 'fruit-apple', count: 3 }] },
  { id: 'tree-pear', output: 'tree-pear', count: 1, materials: [{ id: 'fruit-pear', count: 3 }] },
  { id: 'tree-peach', output: 'tree-peach', count: 1, materials: [{ id: 'fruit-peach', count: 3 }] },
  { id: 'bush-strawberry', output: 'bush-strawberry', count: 1, materials: [{ id: 'fruit-strawberry', count: 3 }] },
  { id: 'bush-grape', output: 'bush-grape', count: 1, materials: [{ id: 'fruit-grape', count: 3 }] },
  { id: 'bush-blueberry', output: 'bush-blueberry', count: 1, materials: [{ id: 'fruit-blueberry', count: 3 }] },
  // Stone → building pieces.
  { id: 'floor', output: 'floor', count: 2, materials: [{ id: 'stone', count: 1 }] },
  { id: 'wall', output: 'wall', count: 1, materials: [{ id: 'stone', count: 2 }] },
  { id: 'window', output: 'window', count: 1, materials: [{ id: 'stone', count: 2 }, { id: 'forage-grass', count: 1 }] },
];

// MUTABLE, populated by applyRecipeData() at boot; seeded with the fallback so the game
// works even if the data file never loads. Consumers import the live reference.
export let RECIPES: Recipe[] = FALLBACK.slice();

interface RecipeRow { id?: string; output?: string; count?: number; materials?: RecipeMat[] }

/** Replace RECIPES with the loaded table (`public/data/recipes.json`, shape
 *  `{ recipes: RecipeRow[] }`). Tolerant: keeps the fallback if the payload is unusable. */
export function applyRecipeData(json: unknown): void {
  const rows = (json as { recipes?: RecipeRow[] } | null | undefined)?.recipes;
  if (!Array.isArray(rows) || rows.length === 0) return; // keep fallback
  const next: Recipe[] = [];
  for (const r of rows) {
    if (!r || typeof r.output !== 'string' || !Array.isArray(r.materials)) continue;
    const mats = r.materials
      .filter((m) => m && typeof m.id === 'string' && typeof m.count === 'number' && m.count > 0)
      .map((m) => ({ id: m.id, count: Math.round(m.count) }));
    if (mats.length === 0) continue;
    next.push({ id: r.id || r.output, output: r.output, count: Math.max(1, Math.round(r.count ?? 1)), materials: mats });
  }
  if (next.length === 0) return; // unusable → keep fallback
  RECIPES = next;
}
