// Data-driven ITEM PRICES — the buy/sell economy table (the 4th game data table,
// alongside crops / foragables / big-stones). Lives in `public/data/prices.json`
// (rows = items, columns = buy / sell); the game just LOADS it at boot, nothing about
// economy balance is hard-coded in logic. This is the shape the platform Data Tables
// tool (ADR-020) edits.
//
// `buy`  set → the item is ORDERABLE (appears in the order book at that price).
// `sell` set → the item is SELLABLE (anything left in the mailbox at the day rollover
//              is sold for this; produce sells high, seeds/seedlings low).
// Label + icon are NOT here — they come from `itemFromId(id)`; this table is pure
// numbers. Ordering of the rows drives the order-book catalog order.

export interface PriceDef { buy?: number; sell?: number }

const FALLBACK: Record<string, PriceDef> = {
  // Seeds — buyable + cheap to sell.
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
  // Harvested produce — sell only (the profit).
  'crop-corn': { sell: 45 },
  'crop-carrot': { sell: 30 },
  'crop-tomato': { sell: 50 },
  'crop-eggplant': { sell: 60 },
  'crop-pumpkin': { sell: 90 },
  'fruit-apple': { sell: 14 },
  'fruit-pear': { sell: 12 },
  'fruit-peach': { sell: 18 },
  'fruit-strawberry': { sell: 20 },
  'fruit-grape': { sell: 24 },
  'fruit-blueberry': { sell: 28 },
  // Wild foragables + stone.
  'forage-grass': { sell: 3 },
  'forage-sunflower': { sell: 12 },
  'forage-wild-flower': { sell: 15 },
  'forage-red-mushroom': { sell: 18 },
  'forage-purple-mushroom': { sell: 25 },
  stone: { sell: 6 },
};

// MUTABLE, populated by applyPriceData() at boot. Seeded with the fallback so the game
// works even if the data file never loads. Consumers import the live reference.
export const PRICES: Record<string, PriceDef> = { ...FALLBACK };
// Insertion-ordered list of ORDERABLE ids (drives the order-book catalog order).
export let ORDERABLE_IDS: string[] = Object.keys(PRICES).filter((id) => PRICES[id]!.buy != null);

interface PriceRow { id: string; buy?: number; sell?: number }

/** Replace PRICES with the loaded table (`public/data/prices.json`, shape
 *  `{ items: PriceRow[] }`). Tolerant: keeps the fallback if the payload is unusable. */
export function applyPriceData(json: unknown): void {
  const rows = (json as { items?: PriceRow[] } | null | undefined)?.items;
  if (!Array.isArray(rows) || rows.length === 0) return; // keep fallback
  const next: Record<string, PriceDef> = {};
  for (const r of rows) {
    if (!r || typeof r.id !== 'string') continue;
    const def: PriceDef = {};
    if (typeof r.buy === 'number' && r.buy >= 0) def.buy = Math.round(r.buy);
    if (typeof r.sell === 'number' && r.sell >= 0) def.sell = Math.round(r.sell);
    next[r.id] = def;
  }
  if (Object.keys(next).length === 0) return; // unusable → keep fallback
  for (const k of Object.keys(PRICES)) delete PRICES[k];
  Object.assign(PRICES, next);
  ORDERABLE_IDS = Object.keys(PRICES).filter((id) => PRICES[id]!.buy != null);
}

export function buyPrice(id: string): number | undefined { return PRICES[id]?.buy; }
export function sellPrice(id: string): number { return PRICES[id]?.sell ?? 0; }
