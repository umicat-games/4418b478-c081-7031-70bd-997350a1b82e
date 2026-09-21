/**
 * The board, and what crosses it.
 *
 * There is ONE board and it never ends — the run is over when the health bar
 * is, and what changes as it goes is how much is coming at you. So there is no
 * wave table here. A wave table is a list of discrete problems with a last
 * entry, and this game's difficulty is a CURVE read at whatever second the run
 * has reached.
 *
 * Everything below is a function of `t`, the seconds since the run began. That
 * is deliberate rather than incidental: a curve can be reasoned about at any
 * point ("what is minute three like") and tuned by moving one constant, where
 * a table of forty rows can only be tuned by editing forty rows and hoping the
 * shape between them is what you meant.
 */

import type { Pole } from './main';

export interface Wave {
  count: number; hp: number; speed: number; model: string; bounty: number;
  /** Whether this kind shoots back. */
  armed: boolean;
  /** The kit's UFOs are a full tile wide; this is how big they read next to
   *  a 0.72-tall hero. */
  scale: number;
  /** Which colour it is, and so which colour it SHOOTS. Left unset it is
   *  decided by a coin flip at spawn, which is what the ordinary crossings
   *  want — a board whose colours could be predicted is a board where the
   *  swap button is a rhythm rather than a read. */
  pole?: Pole;
  /** Walks on the ground rather than flying over it. Rigged models only — a
   *  UFO set down at y=0 looks parked. */
  ground?: boolean;
  /** Turns to face the way it is going, instead of spinning like a saucer. */
  facesTravel?: boolean;
  /** What it throws. Unused by the orbs, which are built rather than loaded;
   *  kept because the loader still preloads by model id. */
  ammo?: string;
  /** Damage per hit, in bar points. Defaults to the ordinary bullet. */
  damage?: number;
  /** Announced, health bar always up. */
  boss?: boolean;
  /** Shown on the banner when it arrives. */
  label?: string;
}

export interface LevelDef {
  id: string;
  name: string;
  /** One line, shown on the door in the hub. Not a paragraph. */
  blurb: string;
  /** How much the ground lets go. Kept at 0 — see the note in `ARENA`. */
  slip: number;
}

export const ARENA: LevelDef = {
  id: 'arena',
  name: 'The Clearing',
  blurb: 'Take their colour, or take the hit',
  // Dry ground, and it stays dry. Ice made a tower-defense hero overshoot the
  // square they were walking to, which cost time; here it would cost the one
  // input the whole game runs on — being in the right PLACE when a bullet
  // arrives. A slippery dodge is not a harder dodge, it is a coin flip.
  slip: 0,
};

/** Kept so the hub's list and the save's `cleared` still have something to
 *  read. One board: there is one thing to do and the village asks nothing. */
export const LEVELS: LevelDef[] = [ARENA];

// ─────────────────────────────────────────────────────────────────────────────
// The curve
//
// Three things ramp, and they ramp at different rates on purpose. Raising all
// of them together makes minute four the same fight as minute one with bigger
// numbers, which is the thing a wave table already does badly.

/** How long between crossings, at `t` seconds in.
 *
 *  Exponential rather than linear, and this is the important one: the board's
 *  pressure is how many things are on it at once, which is the spawn rate
 *  times how long each takes to cross. A linear ramp spends its first minute
 *  barely moving and then falls off a cliff; an exponential one is noticeably
 *  busier every thirty seconds from the very start, and flattens out where the
 *  screen is as full as it can usefully be.
 *
 *  It bottoms out at 0.62s. Below that the board is denser than the swap
 *  button can be read — and a fight you cannot read is not a harder fight, it
 *  is a different and worse game. */
export const spawnGapAt = (t: number): number =>
  0.62 + (2.7 - 0.62) * Math.exp(-t / 88);

/** What one of them is worth taking down, at `t` seconds in.
 *
 *  Linear and SLOW. Hit points are the least interesting axis there is — a
 *  tougher enemy is the same problem held for longer — so they climb just
 *  enough that a late board cannot be cleared with the opening weapon, and no
 *  faster. The density above is what makes minute four hard. */
export const hpAt = (t: number): number => 9 + t * 0.115;

/** And how fast they cross.
 *
 *  Capped at 1.55. Past that a crossing is over before the player can decide
 *  anything about it, and the enemy's own bullets start arriving behind it. */
export const speedAt = (t: number): number => Math.min(1.55, 0.72 + t * 0.0022);

/** An ordinary crossing at `t` seconds in. */
export const enemyAt = (t: number): Wave => ({
  count: 1,
  hp: hpAt(t),
  speed: speedAt(t),
  // Two saucer models, alternating by nothing more than a coin flip. They read
  // as the same threat — which they are — and the variety is only so that a
  // screen full of them is not a screen full of one sprite.
  model: Math.random() < 0.5 ? 'td-ufo-a' : 'td-ufo-b',
  bounty: 12,
  armed: true,
  scale: 0.62,
});

/** How often a boss comes. */
export const BOSS_EVERY = 68;

/** The `n`th boss, one-based.
 *
 *  It crosses like everything else — a straight line, no steering — and what
 *  makes it a boss is the SHAPE of what comes off it: a fan, in both colours
 *  at once. That is the one arrangement the swap button cannot answer by
 *  picking a side, so a boss is the moment the game stops being about choosing
 *  a colour and starts being about where you stand. */
export const bossAt = (n: number): Wave => ({
  count: 1,
  hp: 120 + (n - 1) * 95,
  // Slower than the saucers, and slower than the hero. A boss you cannot walk
  // away from is a boss that decides the fight by arithmetic.
  speed: 0.5,
  model: 'boss-orc',
  bounty: 90,
  armed: true,
  scale: 2.1,
  ground: true,
  facesTravel: true,
  ammo: 'td-ammo-boulder',
  damage: 16,
  boss: true,
  label: n === 1 ? 'BOSS' : `BOSS ${n}`,
});

/** The models a run has to have loaded before it starts. The loader preloads
 *  by id, and a model first named by a spawn three minutes in is a hitch three
 *  minutes in — or, when it is the boss, a throw. */
export const PRELOAD: Wave[] = [
  { count: 1, hp: 9, speed: 1, model: 'td-ufo-a', bounty: 0, armed: true, scale: 0.62 },
  { count: 1, hp: 9, speed: 1, model: 'td-ufo-b', bounty: 0, armed: true, scale: 0.62 },
  bossAt(1),
];
