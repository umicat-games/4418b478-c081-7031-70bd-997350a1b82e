/**
 * The weapons, what they cost to make, and what they do to the things they hit.
 *
 * Weapons used to arrive on a timer: sword at zero finished levels, bow at one,
 * staff at two. That is a schedule, not a decision — it happens TO you, in the
 * same order, whatever you did with the run. Now they are made at the Armory
 * out of the same gold, wood and stone as everything else in this game, and
 * each one levels on its own, so "which weapon do I pour this run into" is a
 * question you get to answer.
 *
 * The staff split into three. One "magic" that bursts a group is a delivery
 * method; fire, ice and lightning are three different answers to a board —
 * something that keeps burning after you have walked away, something that makes
 * a wave arrive late, and something that punishes a crowd for standing close
 * together. They share the cast; they do not share the point.
 *
 * The numbers here are ARITHMETIC, like `progress.ts` — worked out against what
 * a run pays (Meadow ~550 gold, Crossroads ~2150) so the whole rack is a second
 * sink beside the town rather than a second grind. Tune by playing.
 */

import type { Materials } from './progress';

export type Weapon = 'sword' | 'bow' | 'fire' | 'ice' | 'bolt';

export const WEAPON_MAX_LEVEL = 3;

/** What a hit leaves behind. `undefined` is an honest answer: the sword and the
 *  bow hit things, and a status on everything would make status mean nothing. */
export type Status = 'burn' | 'chill' | 'chain';

export interface WeaponKind {
  id: Weapon;
  name: string;
  icon: string;
  /** What it DOES, in a few words. It goes on the card, so it is a prompt. */
  blurb: string;
  /** How the attack is delivered. Three shapes, five weapons — the three
   *  elements differ in what they leave behind, not in how they are thrown. */
  cast: 'melee' | 'arrow' | 'burst';
  status?: Status;
  /** `null` = you already have it. You are never weaponless, so the Armory is
   *  somewhere to go rather than something you must visit before playing. */
  forge: Materials | null;
  /** Lv1→2, then Lv2→3. */
  upgrades: [Materials, Materials];
  /** Direct damage per level, before the Range bonus. */
  damage: [number, number, number];
  /** How far a burst reaches. Ignored by the other two shapes. */
  radius?: number;
  /** Seconds between casts. Ignored by melee, which is paced by its animation. */
  cooldown?: number;
  /** Per level: burn = damage per second, chill = how much speed is left,
   *  chain = how many extra enemies it jumps to. */
  effect?: [number, number, number];
  /** Seconds the status lasts. Chain is instant and has none. */
  effectSeconds?: number;
  /** The clip this one plays when it goes off, uploaded through the Assets
   *  tool and keyed by filename. On the WEAPON rather than in a switch inside
   *  the level, so a fourth staff arrives with its sound instead of arriving
   *  silent and waiting for someone to remember the other file. */
  sound?: string;
  /** What colour this one is, when it is a staff. The shaft is the same carved
   *  stick for all three — only the gem and what comes out of it differ, so the
   *  rack reads as three staves rather than three unrelated objects. */
  tint?: { gem: number; glow: number; mote: number; mote2: number };
}

export const WEAPONS: WeaponKind[] = [
  {
    id: 'sword',
    name: 'Sword',
    icon: '🗡',
    blurb: 'Hits everything close',
    cast: 'melee',
    forge: null,
    upgrades: [
      { gold: 240, wood: 40, stone: 15 },
      { gold: 520, wood: 80, stone: 40 },
    ],
    damage: [2, 3, 5],
  },
  {
    id: 'bow',
    name: 'Bow',
    icon: '🏹',
    blurb: 'Locks on at range',
    cast: 'arrow',
    forge: { gold: 200, wood: 30, stone: 5 },
    upgrades: [
      { gold: 320, wood: 50, stone: 15 },
      { gold: 650, wood: 95, stone: 40 },
    ],
    damage: [3, 4, 6],
  },
  {
    id: 'fire',
    name: 'Fire staff',
    icon: '🔥',
    // The burn is the point: it is the only damage in the game that happens
    // while you are somewhere else.
    blurb: 'Sets them alight — keeps burning',
    cast: 'burst',
    status: 'burn',
    forge: { gold: 340, wood: 15, stone: 45 },
    upgrades: [
      { gold: 520, wood: 25, stone: 70 },
      { gold: 980, wood: 45, stone: 125 },
    ],
    // A TAP, and then the fire does the work. It used to be 3/4/5, which with
    // the Range bonus is 6/7/8 against a wave-one saucer's 10 — so the thing
    // fire is FOR was killing them before it could be seen, and the element
    // whose whole identity is "damage that happens while you are somewhere
    // else" played as the one that killed on contact.
    damage: [1, 1, 2],
    radius: 2.2,
    cooldown: 1.7,
    // What came off the direct hit went in here, so the staff is worth about
    // what it was worth: with the Range at 3, a Lv1 cast was 6 + 2x3.5 = 13 and
    // is now 4 + 3.06x3.5 = 14.7. Fresh, with no town, it is 8.7 against 10 —
    // slightly weaker on the first run, which is the run where you have time to
    // watch it.
    effect: [2.2, 3.8, 5.4],   // damage per second
    effectSeconds: 3.5,
    sound: 'fire-magic-wand-sound-effect.mp3',
    tint: { gem: 0xff7a3a, glow: 0xd63a10, mote: 0xff3606, mote2: 0xffc07a },
  },
  {
    id: 'ice',
    name: 'Ice staff',
    icon: '❄',
    // Hits softest and is often the best answer anyway: a wave that arrives
    // late arrives into towers that have reloaded.
    blurb: 'A wide chill — slows a whole group',
    cast: 'burst',
    status: 'chill',
    forge: { gold: 340, wood: 15, stone: 45 },
    upgrades: [
      { gold: 520, wood: 25, stone: 70 },
      { gold: 980, wood: 45, stone: 125 },
    ],
    damage: [2, 3, 4],
    radius: 3.2,
    cooldown: 1.7,
    effect: [0.55, 0.42, 0.3], // how much of their speed is LEFT — lower is colder
    effectSeconds: 3,
    sound: 'ice-magic-wand-sound-effect.mp3',
    tint: { gem: 0x7fd4ff, glow: 0x2aa7d6, mote: 0x3fb0ff, mote2: 0xcdefff },
  },
  {
    id: 'bolt',
    name: 'Storm staff',
    icon: '⚡',
    // This one is not new. The staff was ALREADY a lightning spell (`vfx.lightning`,
    // sky-to-ground bolts) before the rack existed, so it keeps the reach and the
    // look it had — a player who has been using it must not find it quietly cut
    // down. What it gains is the arc: the burst, and then it goes looking.
    blurb: 'Bursts a group, then arcs onward',
    cast: 'burst',
    status: 'chain',
    forge: { gold: 460, wood: 20, stone: 60 },
    upgrades: [
      { gold: 700, wood: 35, stone: 95 },
      { gold: 1250, wood: 60, stone: 170 },
    ],
    damage: [4, 5, 7],    // Lv1 is exactly what the staff always did
    radius: 2.6,          // ditto — unchanged from the staff it used to be
    cooldown: 1.7,
    effect: [1, 2, 3],    // how many further enemies the arc reaches
    sound: 'lightning-magic-wand-sound-effect.mp3',
    tint: { gem: 0xffe66a, glow: 0xd6b400, mote: 0xfff07a, mote2: 0xffffff },
  },
];

export const WEAPON_BY_ID = new Map(WEAPONS.map((w) => [w.id, w]));

/** Every enemy the chain touches after the first takes this much less. Without
 *  a falloff the storm staff is simply the best weapon on a full board. */
export const CHAIN_FALLOFF = 0.7;
/** How far the arc reaches for its next enemy. */
export const CHAIN_HOP = 2.4;

/** Which weapons are made, and how far. `0` is "not forged"; the sword starts
 *  at 1 because you arrive holding it. */
export type WeaponLevels = Partial<Record<Weapon, number>>;

export const STARTING_WEAPONS: WeaponLevels = { sword: 1 };

export function levelOf(levels: WeaponLevels | undefined, id: Weapon): number {
  return Math.min(levels?.[id] ?? 0, WEAPON_MAX_LEVEL);
}

/** Damage the weapon does right now, before the Range bonus. Level 0 is not a
 *  weapon you can hold, so it answers for level 1 — a caller that hands us an
 *  unforged id has a bug, and a zero would hide it as "my sword does nothing". */
export function weaponDamage(id: Weapon, level: number): number {
  const k = WEAPON_BY_ID.get(id);
  if (!k) return 1;
  return k.damage[Math.max(0, Math.min(k.damage.length - 1, level - 1))];
}

/** The status number at this level — dps for burn, remaining speed for chill,
 *  extra hops for chain. */
export function weaponEffect(id: Weapon, level: number): number {
  const k = WEAPON_BY_ID.get(id);
  if (!k?.effect) return 0;
  return k.effect[Math.max(0, Math.min(k.effect.length - 1, level - 1))];
}

/** The status, in the words the card uses. A number without its unit is a
 *  number nobody can compare: "0.42" means nothing, "slows to 42%" is a
 *  decision. */
export function effectText(id: Weapon, level: number): string {
  const k = WEAPON_BY_ID.get(id);
  if (!k?.status || level < 1) return '';
  const n = weaponEffect(id, level);
  if (k.status === 'burn') return `burns for ${n}/s over ${k.effectSeconds}s`;
  if (k.status === 'chill') return `slows to ${Math.round(n * 100)}% for ${k.effectSeconds}s`;
  return `arcs to ${n} more`;
}

/** What the next step costs, or `null` at the top. Forging and upgrading are
 *  the same act from the player's side — walk to the rack and pay — so they are
 *  one function rather than two the caller has to choose between. */
export function nextCost(id: Weapon, level: number): Materials | null {
  const k = WEAPON_BY_ID.get(id);
  if (!k) return null;
  if (level === 0) return k.forge ?? { gold: 0, wood: 0, stone: 0 };
  if (level >= WEAPON_MAX_LEVEL) return null;
  return k.upgrades[level - 1];
}

/** A save from before the Armory: weapons arrived by finished-level count, so
 *  reconstruct what that player had earned rather than taking it away.
 *
 *  The old `staff` becomes the STORM staff, because that is what it already was:
 *  `vfx.lightning` has thrown its bolts since the spell work. Mapping it to fire
 *  would have handed someone a different weapon and called it theirs. Levels
 *  start at 1: they earned the weapon, not an upgrade. */
export function migrateWeapons(
  levels: WeaponLevels | undefined, runs: number, equipped: string | undefined,
): { weapons: WeaponLevels; weapon: Weapon } {
  const out: WeaponLevels = { ...STARTING_WEAPONS, ...(levels ?? {}) };
  if (!levels) {
    if (runs >= 1) out.bow = Math.max(out.bow ?? 0, 1);
    if (runs >= 2) out.bolt = Math.max(out.bolt ?? 0, 1);
  }
  const asWeapon = equipped === 'staff' ? 'bolt' : equipped;
  const held = WEAPON_BY_ID.has(asWeapon as Weapon) ? asWeapon as Weapon : 'sword';
  // Never hand back something that is not made — a save can outlive a table.
  return { weapons: out, weapon: levelOf(out, held) > 0 ? held : 'sword' };
}
