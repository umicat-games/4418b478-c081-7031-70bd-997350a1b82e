/**
 * The town — what the hub is FOR between runs.
 *
 * Gold used to die with the run. Measured games were sitting on 1600 of it by
 * wave seven with a finished defence and nowhere to put it, which is a currency
 * that has stopped being a decision. Now it comes home as `coin`, and this is
 * where it goes.
 *
 * Each building changes the NEXT run in a way you can point at, rather than
 * adding a percent to a number. "+1 tower" and "+2 armour" are things you can
 * plan a run around; "+8% damage" is a thing you take on faith.
 *
 * Buying one is the same verb as everything else in this game: walk to the
 * plot, press the action button. No menu.
 */

import type { Materials } from './progress';
import { iconHtml, type IconName } from './icons';

export interface TownBuilding {
  id: string;
  name: string;
  /** Shown at the plot. Three or four words — it is a prompt, not a manual. */
  effect: string;
  /** What this building HANDS YOU, as a shape. More use than a picture of the
   *  building: "+1 tower" is the reason to buy the smithy. */
  icon: IconName;
  /** The model that appears once it is built, one per level. Later levels are
   *  bigger buildings, so the town visibly grows. */
  models: [string, string, string];
  /** What each level costs, in materials carried home from runs. */
  costs: [Materials, Materials, Materials];
  /** Where it stands in the hub. */
  x: number;
  z: number;
  /** Which way it faces. */
  yaw: number;
}

export const TOWN: TownBuilding[] = [
  {
    id: 'smithy',
    name: 'Smithy',
    effect: '+1 tower · unlocks tower mounts',
    icon: 'tower',
    // Lv1 the Watchtower, Lv2 the Bastion, Lv3 the Spire. Each is three or four
    // ground weapons' worth of gold, and the reason to want one is REACH — the
    // corner two ground weapons cannot cover between them.
    models: ['bld-house-a', 'bld-house-b', 'bld-house-c'],
    costs: [
      { gold: 150, wood: 20, stone: 10 },
      { gold: 400, wood: 50, stone: 35 },
      { gold: 900, wood: 110, stone: 90 },
    ],
    x: -3.5, z: -1.6, yaw: Math.PI / 2,
  },
  {
    // The ID stays `clinic`, and it is not a leftover.
    //
    // It is the key this building is saved under (`town.clinic`), the key its
    // POSITION is saved under (`spots.clinic`), and the name its meshes carry
    // in the generated scene (`town_clinic_1`). Renaming it would take a
    // building people had paid for off their save and leave its model standing
    // in the village with nothing to own it. The player never sees an id.
    id: 'clinic',
    name: 'Barracks',
    // No numbers. A player does not need to know that a level is worth two
    // points off a hit — they need to know that more of it means less damage
    // taken. The exact figure belongs to whoever is tuning the game, not to
    // whoever is deciding what to buy next.
    effect: 'Train, and take less from every hit',
    icon: 'shield',
    models: ['town-stall-red', 'town-watermill', 'bld-house-b'],
    costs: [
      { gold: 120, wood: 25, stone: 5 },
      { gold: 320, wood: 60, stone: 25 },
      { gold: 750, wood: 120, stone: 70 },
    ],
    x: -3.5, z: 2.2, yaw: Math.PI / 2,
  },
  {
    id: 'market',
    name: 'Market',
    effect: '+50 starting gold per level',
    icon: 'coin',
    models: ['town-stall-green', 'bld-house-a', 'town-watermill'],
    costs: [
      { gold: 120, wood: 15, stone: 15 },
      { gold: 300, wood: 40, stone: 40 },
      { gold: 700, wood: 90, stone: 95 },
    ],
    x: 3.5, z: -1.6, yaw: -Math.PI / 2,
  },
  {
    id: 'range',
    name: 'Range',
    effect: 'Train, and hit harder with everything',
    icon: 'bow',
    models: ['bld-tower-b', 'bld-tower-a', 'town-windmill'],
    costs: [
      { gold: 170, wood: 30, stone: 10 },
      { gold: 450, wood: 70, stone: 30 },
      { gold: 1000, wood: 130, stone: 80 },
    ],
    x: 3.5, z: 2.2, yaw: -Math.PI / 2,
  },
  {
    id: 'armory',
    name: 'Armory',
    effect: 'forge and improve weapons',
    icon: 'sword',
    // Behind the weapon rack, which is its frontage: the rack is what you walk
    // along, and this is the building that explains why the rack can do
    // anything. Deliberately not another corner plot — the four of those are a
    // shape, and a fifth corner would have been a fifth of the same thing.
    //
    // OFF the centre line, though. At x 0 the Lv3 building stood squarely in
    // front of the exit door and hid it: the one thing in the hub a player has
    // to be able to find is the way out.
    models: ['town-cart', 'town-stall-red', 'bld-tower-a'],
    costs: [
      { gold: 180, wood: 30, stone: 10 },
      { gold: 480, wood: 60, stone: 45 },
      { gold: 1050, wood: 120, stone: 110 },
    ],
    x: -2.0, z: -3.0, yaw: 0,
  },
];

export const TOWN_MAX_LEVEL = 3;

/** What a building is giving RIGHT NOW, phrased as a total rather than a rate.
 *
 *  `effect` is the pitch for a plot you have not bought yet; this is what the
 *  building is doing for you NOW. Derived from `bonusesFrom` so it cannot drift
 *  from what a run actually applies.
 *
 *  The two STAT buildings say it in words and not in figures. A player deciding
 *  what to buy needs to know that more defence means less damage taken — the
 *  fact that a level is two points off a hit is a tuning number, and the card
 *  already carries the level on the line above. The countable ones keep their
 *  numbers: "+1 tower" and "+50 starting gold" are things you plan a run
 *  around, not parameters. */
export function townNow(id: string, town: Record<string, number> | undefined): string {
  const b = bonusesFrom(town);
  switch (id) {
    case 'smithy': return b.towerCap ? `+${b.towerCap} tower${b.towerCap > 1 ? 's' : ''} · ${b.smithy} mount${b.smithy > 1 ? 's' : ''}` : '';
    // A LEVEL, not a figure. The card already has the building's level on the
    // line above, so this says what the level MEANS.
    case 'clinic': return b.armour ? 'Enemies hit you for less' : '';
    case 'market': return b.gold ? `+${b.gold} starting gold` : '';
    case 'range': return b.heroDamage ? 'Your own attacks hit harder' : '';
    case 'armory': return b.weaponCap ? `weapons up to Lv${b.weaponCap}` : '';
    default: return '';
  }
}

/** The same, for the level you are ABOUT to buy — so the prompt can say what
 *  the money changes, not merely what it costs. */
export function townAfter(id: string, town: Record<string, number> | undefined, level: number): string {
  return townNow(id, { ...(town ?? {}), [id]: level });
}

/** Can this be paid for out of what is in the store? */
export const canAfford = (have: Materials, cost: Materials): boolean =>
  have.gold >= cost.gold && have.wood >= cost.wood && have.stone >= cost.stone;

/** What is still missing, for a prompt that says what to go and get. */
export function shortfall(have: Materials, cost: Materials): string {
  const bits: string[] = [];
  // HTML, because the cards these land in are built from strings. Everything
  // here is game-authored — prices and material names — and none of it is ever
  // player text, which is the only reason that is safe.
  if (have.gold < cost.gold) bits.push(`${iconHtml('coin')} ${cost.gold - have.gold}`);
  if (have.wood < cost.wood) bits.push(`${iconHtml('wood')} ${cost.wood - have.wood}`);
  if (have.stone < cost.stone) bits.push(`${iconHtml('stone')} ${cost.stone - have.stone}`);
  return bits.join('  ');
}

/** What the town is worth on the next run. */
export interface TownBonus {
  towerCap: number;
  /** How good a weapon this town can make. The Armory's level IS the cap, so
   *  upgrading it is what opens the next tier of every weapon at once rather
   *  than unlocking one more thing from a list. */
  weaponCap: number;
  /** Points taken off EVERY hit before anything else touches it.
   *
   *  It was `hearts`, +25 max health a level. The two are the same
   *  survivability and not the same design, and the deciding difference is
   *  that every heal in this game is FLAT — 40 a wave, 30 a crate, 18 a drop.
   *  Growing the pool to 175 turned a wave clear from 40% of the bar into 23%,
   *  so buying the Clinic quietly devalued every healing source in the game by
   *  43%. Armour does the opposite: it makes each heal cover more hits.
   *
   *  FLAT rather than a percentage, because a percentage is what player LEVEL
   *  already gives (`damageTakenMultiplier`) — two multiplying sources need a
   *  combined cap and make the building a duplicate of levelling up. Flat is a
   *  different lever: it guts the chip damage a saucer does (10 → 4) and barely
   *  touches the boss's boulder (22 → 16), which is aimed squarely at what the
   *  balance runs keep reporting — the base untouched and the hero shot to
   *  death walking between build spots. */
  armour: number;
  gold: number;
  heroDamage: number;
  /** The smithy's level, which is also which tower mounts are for sale. It
   *  gives a NUMBER rather than a list of ids so that adding a mount is a line
   *  in the tower table and nothing here. */
  smithy: number;
}

export const NO_BONUS: TownBonus =
  { towerCap: 0, armour: 0, gold: 0, heroDamage: 0, smithy: 0, weaponCap: 0 };

/** Levels bought, by building id, turned into the numbers a run cares about.
 *
 *  One place, so the hub can show what a purchase will do and the level can
 *  apply it without either of them knowing the other's arithmetic. */
/** What one level of the Clinic is worth. Measured with `verify-3d-balance`,
 *  not chosen: at 6 a saucer's shot goes from 10 to 4. */
export const ARMOUR_PER_LEVEL = 2;

export function bonusesFrom(town: Record<string, number> | undefined): TownBonus {
  const lv = (id: string): number => Math.min(town?.[id] ?? 0, TOWN_MAX_LEVEL);
  return {
    towerCap: lv('smithy'),
    weaponCap: lv('armory'),
    smithy: lv('smithy'),
    armour: lv('clinic') * ARMOUR_PER_LEVEL,
    gold: lv('market') * 50,
    heroDamage: lv('range'),
  };
}
