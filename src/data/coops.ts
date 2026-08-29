// Data-driven CHICKEN COOP config — same "game data table" idea as crops.ts / items.ts.
//
// A coop is a PLACEABLE building (bought in the shop → delivered overnight → placed from the
// backpack). It comes in 3 SIZES (small → medium → big, upgraded in place) and 5 COLORS. Each
// colour hatches a matching-colour chick, so we only sell the colours that have a matching
// chick sprite: red / brown / green / blue / yellow (the coop art also has purple, but there's
// no purple chicken, so purple is not sold). "yellow" is the DEFAULT chicken art
// (`chicken_baby.png` / `chicken_default.png`); the others are `chicken_baby_<color>` /
// `chicken_<color>`.
//
// Sprite/frame mappings are DERIVED from (size,color) in code (see the helpers below) — the
// data table only holds the tunable NUMBERS (price / eggs-per-day / capacity). Loads at boot;
// the built-in FALLBACK is used if the JSON is missing, so the game never breaks.

export type CoopColor = 'red' | 'brown' | 'green' | 'blue' | 'yellow';
export const COOP_COLORS: CoopColor[] = ['red', 'brown', 'green', 'blue', 'yellow'];

export type CoopSize = 'small' | 'medium' | 'big';
export const COOP_SIZES: CoopSize[] = ['small', 'medium', 'big'];

// Ground FOOTPRINT (base row of tiles the coop stands on / occupies for placement + collision).
// The art is taller than this (it rises upward) — the footprint is just the base. Widths mirror
// the art: small 32px=2 tiles, medium 48px=3 tiles, big 64px=4 tiles.
export const COOP_FOOTPRINT: Record<CoopSize, { w: number; h: number }> = {
  small: { w: 2, h: 1 },
  medium: { w: 3, h: 1 },
  big: { w: 4, h: 1 },
};

export interface CoopTierDef {
  size: CoopSize;
  price: number; // coins to BUY a coop at this size (small = the shop price; medium/big are the UPGRADE targets)
  eggsPerDay: number; // eggs the coop lays each morning
  capacity: number; // max chickens (eggs + chicks + adults) this coop supports
  label: string;
}

// Small is the only one bought in the shop; medium/big are reached by UPGRADING a placed coop
// (the price is the coins the upgrade costs — see the coop action wheel).
const COOP_TIER_FALLBACK: Record<CoopSize, CoopTierDef> = {
  small: { size: 'small', price: 800, eggsPerDay: 2, capacity: 2, label: 'Small Coop' },
  medium: { size: 'medium', price: 2000, eggsPerDay: 3, capacity: 4, label: 'Medium Coop' },
  big: { size: 'big', price: 4000, eggsPerDay: 4, capacity: 6, label: 'Big Coop' },
};

export const COOP_TIERS: Record<CoopSize, CoopTierDef> = { ...COOP_TIER_FALLBACK };

interface CoopTierRow {
  size?: string;
  price?: number;
  eggsPerDay?: number;
  capacity?: number;
  label?: string;
}

export function applyCoopData(json: unknown): void {
  const rows = (json as { coops?: CoopTierRow[] } | null | undefined)?.coops;
  if (!Array.isArray(rows) || rows.length === 0) return; // keep fallback
  for (const r of rows) {
    if (!r || !COOP_SIZES.includes(r.size as CoopSize)) continue;
    const size = r.size as CoopSize;
    const fb = COOP_TIER_FALLBACK[size];
    COOP_TIERS[size] = {
      size,
      price: Math.max(0, Math.round(r.price ?? fb.price)),
      eggsPerDay: Math.max(0, Math.round(r.eggsPerDay ?? fb.eggsPerDay)),
      capacity: Math.max(1, Math.round(r.capacity ?? fb.capacity)),
      label: r.label ?? fb.label,
    };
  }
}

// ── Derived ids / sprite mappings (deterministic from size+color) ──────────────
/** The shop item id for a coop of a given size + colour, e.g. `coop-small-red`. */
export const coopItemId = (size: CoopSize, color: CoopColor): string => `coop-${size}-${color}`;
/** Parse a coop item id back into {size,color}, or null if it isn't one. */
export function parseCoopId(id: string): { size: CoopSize; color: CoopColor } | null {
  const m = /^coop-(small|medium|big)-(red|brown|green|blue|yellow)$/.exec(id);
  return m ? { size: m[1] as CoopSize, color: m[2] as CoopColor } : null;
}
/** The coop atlas (`coops`) frame name for a size+colour, e.g. `small-red-chicken-house`. */
export const coopFrame = (size: CoopSize, color: CoopColor): string => `${size}-${color}-chicken-house`;
/** The CHICK spritesheet texture key for a colour (yellow = the default `chicken_baby.png`). */
export const chickTexture = (color: CoopColor): string => (color === 'yellow' ? 'chick-yellow' : `chick-${color}`);
/** The ADULT chicken spritesheet texture key for a colour (yellow = the default `chicken_default.png`). */
export const chickenTexture = (color: CoopColor): string => (color === 'yellow' ? 'chicken-yellow' : `chicken-${color}`);
/** The egg-items atlas frame for a colour's laid egg (egg_items has red/brown/blue/yellow; green
 *  reuses the untagged `region` frame until a green egg is tagged). */
export const eggFrame = (color: CoopColor): string => (color === 'green' ? 'region' : color);
/** The speech-bubble texture for the "eggs ready" indicator, mapped to the nearest bubble colour
 *  (bubbles exist in yellow/green/blue/pink/purple/grey — red→pink, brown→grey). */
export const coopBubbleTexture = (color: CoopColor): string => {
  const map: Record<CoopColor, string> = { red: 'pink', brown: 'grey', green: 'green', blue: 'blue', yellow: 'yellow' };
  return `bubble-${map[color]}`;
};
