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
 * **The chain must not be completable on the board that teaches the game.**
 * At 35 / 110 / 220 it cost 365 against the ~550 Meadow pays out, so a player
 * could buy every step on the first board and still have 185 left for towers —
 * reported, correctly, as "the weapon upgrades come far too fast".
 *
 * 70 / 220 / 480 is 770. On Meadow the first step is about three ballistas and
 * the second takes most of what is left, so the second is a real decision and
 * the third is not on offer at all. On Crossroads, which pays about 2150, the
 * whole chain is affordable alongside a defence — which is the point: these
 * belong to the boards you have earned your way to.
 *
 * The first step was 60 once and was cut to 35 because the balance BOT never
 * reached 60 spare. That was a bad reason: the bot builds towers by preference
 * and only ever buys a tier with money it has no other use for, so it measures
 * the most tower-heavy player there is rather than a person who WANTS the
 * weapon. A human bought the lot on the first board.
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

// Priced in MANA, which has a ceiling of 100 — these were gold, against a
// board that paid out about 550 over a whole run, and carrying those numbers
// over would have made the first upgrade cost seven full mana bars.
//
// The shape to preserve is that the chain costs more than one bar-full: 34
// is about six absorbed orbs and buyable inside the first minute, and the
// three together are 172, which is most of a good run's income. Upgrading is
// meant to compete with ATTACKING and with HEALING for the same pool — that
// competition is the decision, and a chain you can complete out of pocket
// change is a chain with no decision in it.
export const RUN_TIERS: Record<Cast, RunTier[]> = {
  melee: [
    { label: 'Sharper — a longer, harder swing', cost: 34 },
    { label: 'Heavy — the blow lands with a shock', cost: 56 },
    { label: 'Crushing — it hits harder again', cost: 82 },
  ],
  arrow: [
    { label: 'Further — the arrow carries further', cost: 34 },
    { label: 'Two arrows, spread', cost: 56 },
    { label: 'Three arrows', cost: 82 },
  ],
  burst: [
    { label: 'A wider blast', cost: 34 },
    { label: 'A shorter wait between casts', cost: 56 },
    { label: 'A heavier blast, wider still', cost: 82 },
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

/**
 * What a tier LOOKS like — one table, read by two things.
 *
 * The blade's smear and the blade itself take the same colour, because they are
 * the same statement: this sword is at this level. Two tables would be two
 * ramps that agree until somebody edits one.
 *
 * `band` is the smear's thickness as a fraction of its radius, and `glow` is
 * how hot the blade itself burns. Both climb, so the step is legible whether
 * you are watching the sword or the arc it leaves.
 */
export interface TierLook { color: number; band: number; glow: number }

// `band` is the smear's thickness as a fraction of its radius, and it is the
// ONLY thing here the trail reads — `color` and `glow` are shared with the
// blade's own material, so they cannot be tuned for the smear alone.
//
// These were 0.14 → 0.40 and the base swing came back as "you have to look
// carefully to see it": at the play camera that is a four-pixel thread. The
// floor moved up rather than the top moving down, so tier 3 keeps its lead.
const LOOKS: TierLook[] = [
  { color: 0xffc9c2, band: 0.30, glow: 0 },
  { color: 0xff9a8a, band: 0.36, glow: 0.22 },
  { color: 0xff6a52, band: 0.44, glow: 0.45 },
  { color: 0xff3a24, band: 0.54, glow: 0.75 },
];

export const tierLook = (tier: number): TierLook =>
  LOOKS[Math.max(0, Math.min(LOOKS.length - 1, Math.round(tier)))];
