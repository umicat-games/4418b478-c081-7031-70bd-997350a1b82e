/**
 * What a weapon learns during ONE run, bought with the run's own gold.
 *
 * The village decides how HARD you hit — the Armory's weapon level and the
 * Range's flat bonus, both permanent. This decides what the weapon DOES, and
 * only for this run: a sword that throws a crescent, a bow that fires a spread,
 * a staff that reaches further and waits less. Walk out of the board and it is
 * gone.
 *
 * **Two systems, two axes, on purpose.** If a run could also buy raw damage,
 * the towers would be competing with the hero on the one thing they are for —
 * and the towers cannot move, so they would lose. The tiers here are mostly
 * SHAPE and REACH, with damage as a small rider.
 *
 * They are paid for out of the gold that would otherwise buy a tower, which is
 * the whole point: "this lane, or me?" is a question the player answers with
 * one purse.
 *
 * **The first step is deliberately cheap — 35, between a ballista at 25 and a
 * cannon at 45.** It started at 60 and the balance bot, told to build a proper
 * defence before spending on itself, never once reached the threshold across a
 * whole Meadow run: the board pays about 550 and a full board of towers and
 * upgrades absorbs all of it. A feature nobody can afford on the board that
 * teaches the game is a feature most players never meet. The later steps stay
 * expensive — those are for the boards that pay two thousand.
 *
 * The labels carry NO figures, for the same reason the town's cards stopped
 * carrying them: "the swing throws a crescent" is what a player needs, and
 * "+1.4 reach" is a number for whoever is tuning it.
 */

/** How the attack is delivered — the three shapes the five weapons share. */
export type Cast = 'melee' | 'arrow' | 'burst';

export interface RunTier {
  /** What it does, in words. Goes on the hotbar cell's tooltip and the banner
   *  announcing the purchase. */
  label: string;
  /** Gold, and rising: the last one should be a real decision late in a run
   *  rather than something you mop up. */
  cost: number;
}

export const RUN_TIERS: Record<Cast, RunTier[]> = {
  melee: [
    { label: 'Sharper — a longer, harder swing', cost: 35 },
    { label: 'Heavy — the blow lands with a shock', cost: 110 },
    { label: 'Crushing — it hits harder again', cost: 220 },
  ],
  arrow: [
    { label: 'Further — the arrow carries further', cost: 35 },
    { label: 'Two arrows, spread', cost: 110 },
    { label: 'Three arrows', cost: 220 },
  ],
  burst: [
    { label: 'A wider blast', cost: 35 },
    { label: 'A shorter wait between casts', cost: 110 },
    { label: 'A heavier blast, wider still', cost: 220 },
  ],
};

export const MAX_RUN_TIER = 3;

/** What the next step costs, or null when there is nothing left to buy. */
export function nextTierCost(cast: Cast, tier: number): number | null {
  return tier < MAX_RUN_TIER ? RUN_TIERS[cast][tier].cost : null;
}
export function tierLabel(cast: Cast, tier: number): string | null {
  return tier > 0 && tier <= MAX_RUN_TIER ? RUN_TIERS[cast][tier - 1].label : null;
}

// --- what each tier is worth, read by the attack code ------------------------
//
// Functions rather than a table of numbers, because each shape scales a
// different thing and a shared shape would be a lie about all three.

/** Melee: reach, and weight.
 *
 *  It threw a CRESCENT at tier 2 for a while, and a widening arc in front of
 *  the hero is the same picture as the bow's widening fan — two weapons that
 *  read the same are one weapon. A sword's identity is weight.
 *
 *  This is the one shape that buys raw damage, and the exception has a reason:
 *  melee only reaches what is next to you, so the position you have to stand in
 *  is the cost. A ranged weapon has no equivalent, which is why the other two
 *  buy shape. */
export const meleeReach = (base: number, tier: number): number =>
  base * (tier >= 1 ? 1.35 : 1);
export const meleeBonusDamage = (tier: number): number =>
  (tier >= 1 ? 1 : 0) + (tier >= 2 ? 2 : 0) + (tier >= 3 ? 3 : 0);
/** How hard the blow LOOKS, 0..1 — `null` while the swing is just a swing. */
export const meleeImpact = (tier: number): number | null =>
  tier >= 3 ? 1 : tier >= 2 ? 0.45 : null;

/** Arrow: how long it flies, and how many go out at once. */
export const arrowLife = (base: number, tier: number): number => base * (tier >= 1 ? 1.5 : 1);
export const arrowShots = (tier: number): number => (tier >= 3 ? 3 : tier >= 2 ? 2 : 1);
/** Each arrow of a spread is worth less than the single one it replaced.
 *  Multishot multiplies with how MANY enemies there are, which is the axis the
 *  towers are for — a spread that kept full damage per arrow would take that
 *  axis off them. */
export const arrowShare = (tier: number): number => (tier >= 3 ? 0.55 : tier >= 2 ? 0.65 : 1);
/** Radians between arrows in a spread. */
export const ARROW_SPREAD = 0.22;

/** Burst: how wide, how often, how hard. */
export const burstRadiusBonus = (tier: number): number => (tier >= 1 ? 0.7 : 0) + (tier >= 3 ? 0.7 : 0);
export const burstCooldownScale = (tier: number): number => (tier >= 2 ? 0.7 : 1);
export const burstBonusDamage = (tier: number): number => (tier >= 3 ? 1 : 0);
