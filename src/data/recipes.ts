// Data-driven CRAFTING RECIPES — the 5th game data table (alongside items / crops /
// foragables / big-stones). Lives in `public/data/recipes.json`; the game LOADS it at
// boot. Each recipe turns RAW materials the player has (pulled from the chest) into an
// OUTPUT item (into the chest). Name / icon / description of a recipe come from its
// OUTPUT item (via `itemFromId` + i18n `item_<id>` / `desc_<id>`), so a recipe row only
// needs the output id, how many it yields, and the material cost. This is the shape the
// platform Data Tables tool (ADR-020) edits.

export interface RecipeMat { id: string; count: number }
// `price` set → a WORKBENCH TOOL recipe: materials come from the backpack (+ chest), it also
// costs coins, and crafting plays the making cinematic (output → the 工具 tab if it's a tool,
// else the backpack). No `price` → a legacy chest recipe (materials + output both in the chest).
export interface Recipe { id: string; output: string; count: number; materials: RecipeMat[]; price?: number }

// Starter recipes, all using EXISTING items (turn harvested goods back into seeds /
// saplings / bushes, and stone into building pieces). Tune freely in recipes.json.
const FALLBACK: Recipe[] = [
  // Workbench TOOL recipes only (materials from the backpack + coins → the making cinematic).
  { id: 'stick', output: 'stick', count: 1, materials: [{ id: 'wood', count: 1 }], price: 30 },
  { id: 'fishing-rod', output: 'fishing-rod', count: 1, materials: [{ id: 'stick', count: 1 }, { id: 'fiber', count: 1 }], price: 100 },
];

// MUTABLE, populated by applyRecipeData() at boot; seeded with the fallback so the game
// works even if the data file never loads. Consumers import the live reference.
export let RECIPES: Recipe[] = FALLBACK.slice();

interface RecipeRow { id?: string; output?: string; count?: number; materials?: RecipeMat[]; price?: number }

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
    const price = typeof r.price === 'number' && r.price >= 0 ? Math.round(r.price) : undefined;
    next.push({ id: r.id || r.output, output: r.output, count: Math.max(1, Math.round(r.count ?? 1)), materials: mats, price });
  }
  if (next.length === 0) return; // unusable → keep fallback
  RECIPES = next;
}
