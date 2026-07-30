// Data-driven ITEM PROPERTIES — the per-item tunable-number table (alongside crops /
// foragables / big-stones). Lives in `public/data/items.json` (rows = items, columns =
// buy / sell / food); the game LOADS it at boot, nothing about economy/food balance is
// hard-coded in logic. This is the shape the platform Data Tables tool (ADR-020) edits.
//
// `buy`  set → the item is ORDERABLE (appears in the shop at that price).
// `sell` set → the item is SELLABLE (chest "Sell" → this many coins).
// `food` set → the item is EDIBLE: Cato eats it from his bag when exhausted, restoring
//              this much stamina (staminaMax is 100 by default).
// DERIVED, NOT here: whether an item can go on the hotbar (that's `isHotbarUsable` =
// toolId/plants/place — a column would only drift). Label + icon come from `itemFromId`.

export interface ItemDef { buy?: number; sell?: number; food?: number }

const FALLBACK: Record<string, ItemDef> = {
  // Seeds — buyable + cheap to sell (not food).
  'corn-seed': { buy: 20, sell: 8 },
  'carrot-seed': { buy: 15, sell: 6 },
  'tomato-seed': { buy: 25, sell: 10 },
  'eggplant-seed': { buy: 30, sell: 12 },
  'pumpkin-seed': { buy: 40, sell: 16 },
  // Tree seedlings.
  'tree-apple': { buy: 260, sell: 100 },
  'tree-pear': { buy: 240, sell: 95 },
  'tree-peach': { buy: 300, sell: 120 },
  // Berry bushes.
  'bush-strawberry': { buy: 90, sell: 36 },
  'bush-grape': { buy: 110, sell: 44 },
  'bush-blueberry': { buy: 120, sell: 48 },
  // Harvested crops — sell + edible (filling).
  'crop-corn': { sell: 45, food: 30 },
  'crop-carrot': { sell: 30, food: 25 },
  'crop-tomato': { sell: 50, food: 30 },
  'crop-eggplant': { sell: 60, food: 35 },
  'crop-pumpkin': { sell: 90, food: 45 },
  // Tree fruit + berries — sell + edible.
  'fruit-apple': { sell: 14, food: 20 },
  'fruit-pear': { sell: 12, food: 18 },
  'fruit-peach': { sell: 18, food: 25 },
  'fruit-strawberry': { sell: 20, food: 22 },
  'fruit-grape': { sell: 24, food: 24 },
  'fruit-blueberry': { sell: 28, food: 26 },
  // Wild foragables — mushrooms are edible; grass / flowers / stone are not.
  'forage-grass': { sell: 3 },
  'forage-sunflower': { sell: 12 },
  'forage-wild-flower': { sell: 15 },
  'forage-red-mushroom': { sell: 18, food: 18 },
  'forage-purple-mushroom': { sell: 25, food: 28 },
  stone: { sell: 6 },
};

// MUTABLE, populated by applyItemData() at boot. Seeded with the fallback so the game
// works even if the data file never loads. Consumers import the live reference.
export const ITEMS: Record<string, ItemDef> = { ...FALLBACK };
// Insertion-ordered list of ORDERABLE ids (drives the shop catalog order).
export let ORDERABLE_IDS: string[] = Object.keys(ITEMS).filter((id) => ITEMS[id]!.buy != null);

interface ItemRow { id: string; buy?: number; sell?: number; food?: number }

/** Replace ITEMS with the loaded table (`public/data/items.json`, shape
 *  `{ items: ItemRow[] }`). Tolerant: keeps the fallback if the payload is unusable. */
export function applyItemData(json: unknown): void {
  const rows = (json as { items?: ItemRow[] } | null | undefined)?.items;
  if (!Array.isArray(rows) || rows.length === 0) return; // keep fallback
  const next: Record<string, ItemDef> = {};
  for (const r of rows) {
    if (!r || typeof r.id !== 'string') continue;
    const def: ItemDef = {};
    if (typeof r.buy === 'number' && r.buy >= 0) def.buy = Math.round(r.buy);
    if (typeof r.sell === 'number' && r.sell >= 0) def.sell = Math.round(r.sell);
    if (typeof r.food === 'number' && r.food > 0) def.food = Math.round(r.food);
    next[r.id] = def;
  }
  if (Object.keys(next).length === 0) return; // unusable → keep fallback
  for (const k of Object.keys(ITEMS)) delete ITEMS[k];
  Object.assign(ITEMS, next);
  ORDERABLE_IDS = Object.keys(ITEMS).filter((id) => ITEMS[id]!.buy != null);
}

export function buyPrice(id: string): number | undefined { return ITEMS[id]?.buy; }
export function sellPrice(id: string): number { return ITEMS[id]?.sell ?? 0; }
/** Stamina an item restores when Cato eats it (0 = not food). */
export function foodValue(id: string): number { return ITEMS[id]?.food ?? 0; }
export function isFood(id: string): boolean { return foodValue(id) > 0; }
