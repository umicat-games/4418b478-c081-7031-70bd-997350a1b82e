/**
 * The town — what the hub is FOR between runs.
 *
 * Gold used to die with the run. Measured games were sitting on 1600 of it by
 * wave seven with a finished defence and nowhere to put it, which is a currency
 * that has stopped being a decision. Now it comes home as `coin`, and this is
 * where it goes.
 *
 * Each building changes the NEXT run in a way you can point at, rather than
 * adding a percent to a number. "+1 tower" and "+2 hearts" are things you can
 * plan a run around; "+8% damage" is a thing you take on faith.
 *
 * Buying one is the same verb as everything else in this game: walk to the
 * plot, press the action button. No menu.
 */

export interface TownBuilding {
  id: string;
  name: string;
  /** Shown at the plot. Three or four words — it is a prompt, not a manual. */
  effect: string;
  icon: string;
  /** The model that appears once it is built, one per level. Later levels are
   *  bigger buildings, so the town visibly grows. */
  models: [string, string, string];
  /** What each level costs, in coin carried home from runs. */
  costs: [number, number, number];
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
    icon: '⚒',
    // Lv1 the Watchtower, Lv2 the Bastion, Lv3 the Spire. Each is three or four
    // ground weapons' worth of gold, and the reason to want one is REACH — the
    // corner two ground weapons cannot cover between them.
    models: ['bld-house-a', 'bld-house-b', 'bld-house-c'],
    costs: [180, 450, 1000],
    x: -4.2, z: -1.0, yaw: Math.PI / 2,
  },
  {
    id: 'clinic',
    name: 'Clinic',
    effect: '+2 hearts per level',
    icon: '❤',
    models: ['town-stall-red', 'bld-house-a', 'bld-house-b'],
    costs: [150, 400, 900],
    x: -4.2, z: 2.6, yaw: Math.PI / 2,
  },
  {
    id: 'market',
    name: 'Market',
    effect: '+50 starting gold per level',
    icon: '💰',
    models: ['town-stall-green', 'town-cart', 'town-watermill'],
    costs: [140, 360, 820],
    x: 4.2, z: -1.0, yaw: -Math.PI / 2,
  },
  {
    id: 'range',
    name: 'Range',
    effect: '+1 to your own attacks per level',
    icon: '🏹',
    models: ['bld-tower-a', 'bld-tower-b', 'town-windmill'],
    costs: [200, 500, 1100],
    x: 4.2, z: 2.6, yaw: -Math.PI / 2,
  },
];

export const TOWN_MAX_LEVEL = 3;

/** What the town is worth on the next run. */
export interface TownBonus {
  towerCap: number;
  hearts: number;
  gold: number;
  heroDamage: number;
  /** The smithy's level, which is also which tower mounts are for sale. It
   *  gives a NUMBER rather than a list of ids so that adding a mount is a line
   *  in the tower table and nothing here. */
  smithy: number;
}

export const NO_BONUS: TownBonus =
  { towerCap: 0, hearts: 0, gold: 0, heroDamage: 0, smithy: 0 };

/** Levels bought, by building id, turned into the numbers a run cares about.
 *
 *  One place, so the hub can show what a purchase will do and the level can
 *  apply it without either of them knowing the other's arithmetic. */
export function bonusesFrom(town: Record<string, number> | undefined): TownBonus {
  const lv = (id: string): number => Math.min(town?.[id] ?? 0, TOWN_MAX_LEVEL);
  return {
    towerCap: lv('smithy'),
    smithy: lv('smithy'),
    hearts: lv('clinic') * 2,
    gold: lv('market') * 50,
    heroDamage: lv('range'),
  };
}
