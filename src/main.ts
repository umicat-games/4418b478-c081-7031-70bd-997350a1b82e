import * as THREE from 'three';
import { mergeStatic } from './merge';
import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils.js';
import RAPIER from '@dimforge/rapier3d-compat';
import {
  ThreeUmicat, loadScene3D, loadModelAsset, attachToSocket, flashTint, updateTints, isTinted,
  CharacterController3D, CharacterAnimator, Input3D,
  type Scene3D, type Manifest3D,
} from '@umicat/three-sdk';
import { GAME_WIDTH, GAME_HEIGHT } from './config';
import { createAudio, MUSIC, SFX } from './audio';
import { runHub } from './hub';
import { showLoading, hideLoading } from './loading';
import { showTitle } from './title';
import { createDebugHud } from './debughud';
import { Vfx, ring as ringVfx, motes, corpse, dissolve, lightning, arcBetween, flames, frost, saucerBurst, hitSparks, slashFlash, bladeTrail, preloadAtlas, FRAME } from './vfx';
import { DEV, DEV_BANNER, devProgress, toggleDev } from './dev';
import { createSpendPanel, type Offer } from './spend';
import { createCoach } from './coach';
import { submit, readBoard, boardElement } from './board';
import {
  ARENA, LEVELS, PRELOAD, ORB_MODEL, BOSS_EVERY, bossAt, enemyAt, spawnGapAt, redShareAt,
  type LevelDef, type Wave,
} from './levels';
import { createScript, ringActionButton, type Script } from './scripted';
import { createWayfinder } from './wayfinder';
import { createAim } from './aim';
import { createCooldownDial } from './cooldown';
import { createActionPad } from './actionpad';
import { createSettings } from './settings';
import { skyWithClouds } from './sky';
import { readoutPlate } from './hud';
import { icon, setIconText, iconHtml, type IconName } from './icons';
import { createThumbMaker } from './thumbs';
import { makeResourceIcons } from './resicons';
import { ICON, WEAPON_ICON } from './icons';
import {
  touchLikely, keyCap, pressName, dragThing, tapWord, pressFor,
  PLACE_KEY,
} from './keycap';
import {
  WEAPONS, WEAPON_BY_ID, weaponDamage, weaponEffect, levelOf, CHAIN_FALLOFF, CHAIN_HOP,
  type Weapon, type WeaponLevels,
} from './weapons';
import { NO_BONUS, TOWN, ARMOUR_PER_LEVEL, type TownBonus } from './town';
import {
  RUN_TIERS, MAX_RUN_TIER, nextTierCost, tierLabel,
  meleeReach, meleeBonusDamage, meleeImpact, tierLook,
  arrowLife, arrowShots, arrowShare, ARROW_SPREAD,
  burstRadiusBonus, burstCooldownScale, burstBonusDamage,
} from './runtiers';
import {
  NO_MATERIALS, rollDrop, xpFromRun, applyXp, xpToNext,
  attackMultiplier, damageTakenMultiplier, MATERIAL_ICON,
  type Material, type Materials,
} from './progress';
import type { GameAudio } from '@umicat/three-sdk';
import { installLiftStyles, setLiftPressSound, LIFT } from './buttons';

/**
 * Woodland Defense — a tower defense you can walk around in.
 *
 * The two halves have to earn each other. Towers alone is a tower defense with
 * a camera; a hero alone is the brawler this used to be. So: towers are the
 * only thing that holds a lane while you are somewhere else, and the hero is
 * the only thing that can be somewhere else in time.
 *
 * Start here: `LEVELS` in `levels.ts`, `TOWERS` below, and the frame loop.
 */

const SAVE_KEY = 'td-progress';

/** What is kept between runs. */
export interface Progress {
  /** Which lessons the player has already been shown, by id.
   *
   *  On the SAVE rather than on the run: a lesson is a thing a person has
   *  learned, and learning it again on the second run is the game not having
   *  noticed. Ids rather than a count, so lessons can be added and reordered
   *  without re-teaching the ones already seen. */
  taught?: string[];
  best?: number;
  quality?: number;
  weapon?: Weapon;
  /** Which weapons are made, and how far. Absent on a save from before the
   *  Armory; `migrateWeapons` reconstructs one from `runs`. */
  weapons?: WeaponLevels;
  /** Levels finished. It used to be what unlocked weapons — they are forged
   *  now — and it is still the run counter the summary writes. */
  runs?: number;
  /** How many boards have been WON, in order. Level `i` is open when
   *  `cleared >= i`, so clearing Meadow opens Frostfall. */
  cleared?: number;
  /** Best wave reached on each board, by level id. */
  bests?: Record<string, number>;
  /** Gold carried home from runs. Superseded by `store`; still read once so a
   *  save from before the village took wood and stone is not thrown away. */
  coin?: number;
  /** The village store: gold, wood and stone brought back from runs. */
  store?: Materials;
  /** The hero's level and progress towards the next one. */
  level?: number;
  xp?: number;
  /** Which town buildings have been paid for, and to what level. */
  town?: Record<string, number>;
  /** Where the player put each one. A building that is paid for but has no
   *  spot is one they are still carrying — which is also how a game closed
   *  mid-placement picks up where it left off. */
  spots?: Record<string, { x: number; z: number }>;
  /** How loud the player wants each half of the mix, 0 to 1. Absent means
   *  "never touched it", which is not the same as zero — a missing field must
   *  read as the default and not as silence. */
  musicVolume?: number;
  sfxVolume?: number;
  /** How much of the village has been bought: an index into the hub's `LAND`.
   *  Absent means a save from before land was for sale, which the hub reads as
   *  "the size the village used to be" rather than as the smallest. */
  land?: number;
}

/** Read, change the named fields, write back.
 *
 *  Everything that saves has to go through this. The level used to write
 *  `{ best, quality }` wholesale, which erased the weapon the hub had just
 *  saved — a field written by one screen and deleted by the next, with nothing
 *  anywhere reporting a problem. */
export async function patchSave(
  umicat: Shared['umicat'], fields: Progress,
): Promise<void> {
  // The sandbox reads a save it was handed and writes nothing back. Without
  // this, opening `?dev` once and finishing a run would put `cleared: 4` and a
  // hundred thousand gold into the real save permanently.
  if (DEV) return;
  const prev = (await umicat.saves.get<Progress>(SAVE_KEY)) ?? {};
  await umicat.saves.set(SAVE_KEY, { ...prev, ...fields });
}

/** Read the save, with the sandbox folded over it if it is on. Everything that
 *  reads progress goes through this, or `?dev` unlocks half the game. */
export async function readSave(umicat: Shared['umicat']): Promise<Progress> {
  return devProgress((await umicat.saves.get<Progress>(SAVE_KEY)) ?? {});
}
// The spawn point is read from the scene's own hero entity (see `SPAWN` inside
// `startLevel`), not written down here. The hub had the two separately and they
// disagreed — the controller wins, so editing the scene did nothing at all.
const RESPAWN_BELOW_Y = -5;

// --- the hero -------------------------------------------------------------
const HERO_HALF_HEIGHT = 0.2;
const HERO_RADIUS = 0.16;
const HERO_SYNC_OFFSET = -(HERO_HALF_HEIGHT + HERO_RADIUS);
/** A BAR, not hearts. Eight hearts meant every hit cost an eighth of the run's
 *  survivability and the bar emptied in eight touches; a hundred points spends
 *  at ten or twenty a time and leaves room for a hit to be a scratch. */
const HERO_MAX_HP = 100;
/** What a saucer's bullet takes, before the level's defence is applied. */
/** What one orb of the WRONG colour takes off the bar.
 *
 *  Raised from 10. The arithmetic that matters is not the number itself but
 *  the number against `HERO_INVINCIBLE_SECONDS` (1.1), which is the real cap:
 *  however many orbs are in the air, the most the bar can lose is one hit per
 *  window. At 10 that was 9 a second and a full bar was eleven seconds of
 *  standing in the wrong colour — long enough that a careless run and a
 *  careful one ended at roughly the same place, just later.
 *
 *  At 16 it is 14.5 a second and about seven seconds, and a heal (35 for 30
 *  magic) buys back two hits instead of three and a half. A run should end
 *  because of how it was PLAYED, and the way to make that true is to make
 *  each mistake cost enough to notice.
 *
 *  It also has to move with the magnet: pulling your own colour in from twice
 *  the old radius raised income, and income is healing. Leaving the damage
 *  alone would have made runs longer than they were before the pull existed. */
const BULLET_DAMAGE = 16;
/** Healing, in the same points. A drop is worth a fifth of the bar; a crate a
 *  third; clearing a wave a quarter. */
const HEAL_DROP = 18;
const HEAL_CRATE = 30;
/** What surviving a wave gives back.
 *
 *  25 to begin with, raised after eight measured runs across two boards all
 *  ended the same way: the HERO dead and the base on most of its lives. That is
 *  not a tower problem and no wave table fixes it — you are a character on the
 *  board, you spend every wave walking through the fire to reach the next build
 *  spot, and a quarter of a bar per wave does not cover the walk. The bot was
 *  made to break off and heal like a player would and the boards STILL ended
 *  that way, which is what makes it the game's number rather than the bot's. */
const HEAL_WAVE = 40;
/** What each kind of drop looks like on the ground. Wood and stone come from
 *  the kit's own scenery, which is why a plank reads as a plank. Module scope
 *  because the preload list needs it before the run does. */
const DROP_MODEL: Record<Material | 'health', string> = {
  gold: 'td-coin', wood: 'td-wood-structure-part', stone: 'td-rocks', health: 'td-crystal',
};
const DROP_TINT: Partial<Record<Material | 'health', number>> = { health: 0xff4f6e };
const HERO_SPEED = 4.2;
const HERO_ATTACK_RANGE = 1.15;
/** How much bigger than the kit's sword. It measures 0.45 against a 0.72 hero
 *  — from this camera that is a knife, and a short blade carried level is what
 *  made it read as a scabbard. */
const SWORD_SCALE = 1.5;
/** How long the blade takes to cross the body. Matched by eye to the arm's own
 *  `attack-melee-right`, which is what it is riding on top of. */
const SWING_SECONDS = 0.4;
/** How far to either side the blade sweeps, measured from straight ahead. */
const SWING_ARC = 1.35;
/** How high above the hero's own origin the hilt is held through a cut. Chest
 *  height on a 0.72 hero — a cut at head height reads as a parry. */
const SWING_HEIGHT = 0.42;
/** How far the hilt sits from the hero's own centre during a cut. The arc is
 *  centred on the BODY, so this is the radius the hand travels on. */
const SWING_GRIP = 0.16;
/** How far out the smear is drawn.
 *
 *  Three different distances are in play and it is worth not confusing them:
 *  the blade TIP sweeps at about 0.52, the hit REACH is `HERO_ATTACK_RANGE`
 *  1.15 (and half again past tier 0), and this sits between them. Drawn at the
 *  tip it was a four-pixel thread at the play camera — measured, 277 changed
 *  pixels against a still frame — and drawn out at the reach it stopped being a
 *  blade smear at all and read as a ring on the floor, which is the same way
 *  the thrown crescent failed. 0.85 is the largest that still hangs off the
 *  body: five times the pixels, same reading. */
const SWING_SMEAR = 0.85;
/** How long a hit rocks a flyer, and how far. Short and shallow: this fires on
 *  every landed hit, and a big slow tilt would have the whole wave lolling. */
/** How long a connecting blow freezes the world. Sixty milliseconds is about
 *  four frames at sixty — long enough to feel, short enough that nobody reads
 *  it as a stutter. Fighting games live between two and eight frames. */
/** Sixty was measured in a fighting game and reported here as "I cannot tell
 *  it is happening". This swing is 400ms long and the camera is four metres
 *  away — a freeze has to be a beat at THIS scale, not at a 1v1 one. */
const HITSTOP_MS = 110;
/** The camera punch on a connecting blow. Centimetres, not metres: you are
 *  trying to stand on a particular square in this game, and a camera that
 *  lurches is a game you cannot aim in. */
const SHAKE_SECONDS = 0.18;
const SHAKE_AMOUNT = 0.055;
const WOBBLE_SECONDS = 0.34;
const WOBBLE_TILT = 0.30;
/** How much of the swing is the CUT; the rest is the blade coming back to the
 *  carry. */
const SWING_CUT = 0.62;
const HERO_ATTACK_DAMAGE = 2;
/** How often a burn actually bites. Half a second: often enough that the bar
 *  visibly drains while you walk away, rare enough that ten burning enemies are
 *  not twenty damage events a frame. */
const BURN_TICK = 0.5;
const HERO_INVINCIBLE_SECONDS = 1.1;

// --- enemies --------------------------------------------------------------
/** They fly, so they float above the path rather than walking it. */
const ENEMY_FLY_HEIGHT = 0.38;
/** UFOs SHOOT. Nothing about touching one hurts you.
 *
 *  It used to be a wind-up and then a distance check, which is a hitscan with
 *  a delay — and with a 1.7-unit range and nothing visible crossing the gap it
 *  read as "walking near it costs a heart". A bullet you can see leave, cross
 *  the ground and miss is a different game, from exactly the same numbers. */
/** How close one has to be to start shooting.
 *
 *  Large enough to cover the board, which is the point: an enemy crossing the
 *  far side still contributes, so the player is never standing somewhere with
 *  nothing to collect. At 3.4 — the tower defense's value, where shooting was
 *  something that happened when you strayed too near a lane — the only way to
 *  earn anything was to chase, and chasing is not what the colour rule is
 *  about. */
const ENEMY_SHOOT_RANGE = 15;
const ENEMY_SHOOT_COOLDOWN = 2.4;
/** The tell, before the shot leaves. */
const ENEMY_WINDUP_SECONDS = 0.45;
const BULLET_SPEED = 4.2;         // slower than the hero: it can be outrun
const BULLET_HIT_RADIUS = 0.38;
const BULLET_LIFE = 2.6;          // seconds before a miss gives up
// ─────────────────────────────────────────────────────────────────────────────
// Polarity
//
// The whole game is one rule: a bullet your own colour FEEDS you, a bullet of
// the other colour HURTS you, and you choose which is which at any moment.
// Everything else — mana, the weapons, the boss — hangs off that.
//
// Two poles, named `dark` and `light` rather than black and white because the
// names have to survive the art: the pieces that carry them are lit, and a
// "white" bullet in shadow is grey. What matters is which of the two it is,
// and that the player can tell at a glance.

export type Pole = 'red' | 'blue';
export const POLES: Pole[] = ['red', 'blue'];
export const other = (p: Pole): Pole => (p === 'red' ? 'blue' : 'red');

/** What each pole LOOKS like.
 *
 *  **Red and blue, which is a HUE difference — and that is why these pieces
 *  can be lit.** The first version was dark and light, and value contrast is
 *  exactly what a light source destroys: a white orb crossing a shadow goes
 *  grey and a dark one under the sun picks up a specular highlight, so the two
 *  poles converged precisely where the board was busiest. The only way to hold
 *  that apart was to take the lighting off them, and an unlit sphere on a lit
 *  board reads as a sticker rather than as an object in the world.
 *
 *  Hue survives lighting. A red ball in shadow is a darker red; it is not a
 *  blue ball. So the material goes back to being a real one — shaded, with a
 *  highlight, sitting in the same light as everything else — and the two poles
 *  stay legible because what separates them was never brightness.
 *
 *  Not the pure primaries. `#ff0000` against this game's grass vibrates, and a
 *  fully saturated blue disappears into the sky at the top of the frame. Both
 *  are pulled slightly towards warm and away from the extremes.
 *
 *  `glow` is the emissive, which is what keeps an orb readable in the shadow
 *  of a tree without flattening it; `rim` is a darker shade of the SAME hue,
 *  used for outlines and swatches — no longer the opposite end of a scale,
 *  because there is no scale any more. */
export const POLE_LOOK: Record<Pole, { body: number; rim: number; glow: number }> = {
  red:  { body: 0xe03b2f, rim: 0x6e1710, glow: 0xff5c3c },
  blue: { body: 0x2f7ad8, rim: 0x103a6e, glow: 0x3ca6ff },
};

/** How close a bullet of your own colour has to get before it is pulled in.
 *
 *  Comfortably wider than `BULLET_HIT_RADIUS`, and that gap is the design: a
 *  same-pole bullet is absorbed strictly before it could ever reach the body,
 *  so matching a colour is SAFE and not merely profitable. A player who has to
 *  wonder whether the absorb will win the race is a player who dodges instead
 *  of collecting, which is the game not being played. */
const ABSORB_RADIUS = 1.35;

/** How close an orb of your OWN colour has to be before it starts coming to
 *  you, and how hard it is pulled.
 *
 *  Twice the absorb radius, so there is a visible stretch where the orb is
 *  curving in and has not arrived. That stretch is the point: it turns
 *  "standing in the right place" into "standing NEAR the right place", which
 *  is a much more forgiving thing to ask of a player who is also dodging the
 *  other colour, and it says which orbs are yours without a single icon —
 *  the ones bending towards you are.
 *
 *  **Only your own colour is pulled.** The other colour must fly dead
 *  straight, because dodging is the only answer to it and a bullet that
 *  curves cannot be dodged by reading its line. This is also why the pull is
 *  not symmetric-looking: an orb swerving towards you is unambiguously good
 *  news, every time, with no case where it is the opposite. */
const ATTRACT_RADIUS = 2.8;
/** How hard the orb is TURNED towards you, per second, at the centre.
 *
 *  Steering, not acceleration. Acceleration was the first model and it does
 *  not capture: an orb entering the ring at 2.1 out gets a sideways nudge,
 *  curves visibly, and sails past — measured, it bent 1.4 off its line and
 *  collected nothing, which is the worst of both readings. It LOOKS attracted
 *  and is not, so the player learns that the pull is decorative.
 *
 *  Turning the velocity towards the hero instead means anything that enters
 *  the ring arrives. That is the promise the effect has to keep — "near enough
 *  counts" — and a magnet that sometimes drops what it caught is a magnet
 *  nobody trusts.
 *
 *  Scaled by `k` (linear in how far in it is) rather than `k²`: the square was
 *  chosen so the edge would be gentle, and gentle at the edge is precisely
 *  where the capture failed. */
const ATTRACT_TURN = 7.5;
/** How much faster a pulled orb travels at the centre. Small — it is here so
 *  the orb visibly hurries the last half-metre, not so it arrives early. */
const ATTRACT_SPEEDUP = 0.5;
/** And a ceiling on how fast a pulled orb may end up going. Without it a long
 *  approach accelerates into something that crosses the absorb radius between
 *  two frames — which the swept test would still catch, but which looks like
 *  the orb teleporting into you. */
const ATTRACT_MAX_SPEED = BULLET_SPEED * 2.2;

/** The boss's fan: how many pellets, and how far apart.
 *
 *  Seven at 13 degrees is a 78-degree spread — wide enough that standing
 *  still inside it is never right, narrow enough to be walked out of sideways
 *  rather than requiring a sprint. */
const BOSS_FAN = 7;
const BOSS_FAN_SPREAD = 0.227;
const UP = new THREE.Vector3(0, 1, 0);
const ZERO = new THREE.Vector3(0, 0, 0);

// --- mana ------------------------------------------------------------------
/** The one resource. Absorbing fills it, everything the hero does spends it.
 *
 *  There is no regeneration and no floor. Standing still earns nothing — the
 *  only way to have mana is to have stood in front of something shooting at
 *  you wearing the right colour, which is the risk the game is made of. */
const MANA_MAX = 100;
/** What you start with.
 *
 *  Deliberately BELOW both prices — a heal is 30 and the first upgrade 34 —
 *  so the opening cannot buy anything. The panel is a thing you earn your way
 *  into, and a game that offers it on frame one has explained its economy
 *  before the player has met the thing that feeds it.
 *
 *  Not zero, though: attacking costs mana too, and a hero who cannot swing
 *  until something has shot at them is a hero whose first input does nothing.
 *  Twenty is five sword swings. */
const MANA_START = 20;
const MANA_PER_ABSORB = 6;
const MANA_PER_KILL = 14;
const MANA_PER_BOSS_KILL = 45;

/** What a heal costs and what it gives. Flat, like every other heal in this
 *  game's history — see the Barracks note in CLAUDE.md for why a percentage
 *  heal quietly devalues itself. */
/** What a swing costs, by what the weapon REACHES.
 *
 *  A sword answers one thing beside you; an arrow answers something across the
 *  board; a staff answers a patch of it. That order is the design and it is
 *  the same order the weapons' damage runs in, inverted — the cheap one has to
 *  be worth using late, or a run becomes "hold the staff and never swing".
 *
 *  Absolute values are a first guess: one absorbed orb is 6, so a sword swing
 *  is two thirds of an orb and a staff cast is two and a half of them. */
export const MANA_PER_ATTACK: Record<'melee' | 'arrow' | 'burst', number> = {
  melee: 4,
  arrow: 7,
  burst: 15,
};

const HEAL_MANA_COST = 30;
const HEAL_AMOUNT = 35;

/** Bullets appear a little clear of the hull so they are not drawn inside it.
 *
 *  There is NO minimum shooting distance. I added one — a UFO on top of you
 *  could not fire — to stop point-blank hits landing in ten milliseconds, which
 *  looked like damage for standing nearby. It bought a far worse problem: park
 *  the hero against a UFO and it can never hurt him, so melee became free.
 *  A fast hit you barely see beats an enemy that cannot fight back. */
const BULLET_MUZZLE = 0.15;
/** The boss winds up for longer and fires less often — it hits for two hearts
 *  of six, so the answer to it has to be "move", and moving needs warning. */
/** How many things may be shooting at the hero at once.
 *
 *  **Seven, and the reason it is not two is the whole difference between this
 *  game and the one it was forked from.** There the cap existed because a
 *  bullet was purely danger: a crowd firing at once was a wall nobody dodges,
 *  and capping the shooters kept each enemy exactly as dangerous as it was
 *  while stopping the crowd from being dangerous by arithmetic.
 *
 *  Here half of what is in the air is FOOD. A cap on shooters is therefore a
 *  cap on income — and mana is what heals you, so starving the player of
 *  bullets is starving them of health. The same number that made the old game
 *  fair makes this one unplayable by drought.
 *
 *  It is not removed entirely, because the thing a cap protects against is
 *  real and did not go away: past about seven simultaneous streams the board
 *  is denser than the swap button can be READ, and a fight you cannot read is
 *  not a harder fight. The invincibility window (`HERO_INVINCIBLE_SECONDS`) is
 *  what actually bounds the damage — it puts a ceiling on how fast health can
 *  leave regardless of how much is flying — which is why the shooter cap is
 *  free to be about legibility instead.
 *
 *  The boss is exempt — it is the one thing that is supposed to be personal. */
const MAX_SHOOTERS = 7;
const BOSS_WINDUP_SECONDS = 0.9;
const BOSS_SHOOT_COOLDOWN = 3.2;
/** How long the body lies there before it sinks away. */
const CORPSE_SECONDS = 2.4;

// --- crates ---------------------------------------------------------------
/** Supply crates drop onto the back field while a wave is running. Breaking
 *  one pays gold or a heart.
 *
 *  They land AWAY from the road and away from the build spots, which is the
 *  whole design: the reward for leaving your towers to fend for themselves.
 *  Somewhere safe to stand that also pays you would just be the place to
 *  stand. */
const CRATE_EVERY = 11;         // seconds between drops
const CRATE_MAX = 3;            // how many can be waiting at once
const CRATE_LIFE = 26;          // seconds before an unopened one is gone
/** What a crate pays, in MANA. It was 12-30 GOLD against a run that paid
 *  about 550 of it; as mana — a bar of 100, six a bullet — the same numbers
 *  are two to five orbs, which is what a walk across the board is worth. */
const CRATE_GOLD = [12, 26];
/** A heart only if one is missing — a crate that pays nothing is worse than a
 *  crate that pays gold, so a full-health player gets the gold instead. */
const CRATE_HEART_CHANCE = 0.42;

// --- rare crates ---------------------------------------------------------
/** One crate in four is worth a detour on its own terms.
 *
 *  Gold and hearts are the same decision every time: go and get it if you can
 *  spare the walk. A timed effect is a different one — it is only worth
 *  anything if you are near something to use it on, so a rare crate during a
 *  quiet moment and a rare crate with sixteen saucers on the board are two
 *  different offers. */
const RARE_CRATE_CHANCE = 0.28;

// --- drops -----------------------------------------------------------------
/** What a kill leaves on the ground.
 *
 *  It used to fly straight to the counter and pay itself in. That is one fewer
 *  thing to do, which in this game is the wrong direction: the whole point of
 *  being a character on the board rather than a cursor over it is that money is
 *  somewhere, and you are somewhere else. Now it lands where the thing died and
 *  waits for you.
 *
 *  The magnet is what keeps that from being tedious. Three and a half tiles is
 *  wide enough that fighting near the road collects itself and standing at the
 *  far end of the board does not.
 */
const MAGNET_RADIUS = 3.5;
const PICKUP_LIFE = 14;         // seconds on the ground before it is gone
const PICKUP_BLINK = 3.5;       // it starts flashing this long before that
/** Bounties are worth more than the wave table says, because you no longer get
 *  all of them. A kill used to pay itself in; now it leaves a coin that is gone
 *  in fourteen seconds, and a player fighting on one side of the board simply
 *  does not collect what dies on the other. Measured: with the same numbers as
 *  the fly-to-the-counter version, Meadow went from a comfortable win to losing
 *  on wave seven with thirteen upgrades instead of sixty-nine.
 *
 *  One lever rather than forty edited numbers, so the wave tables stay readable
 *  as "how hard is this wave" rather than "how hard is this wave, adjusted". */
const BOUNTY_SCALE = 1.5;
const BUFF_SECONDS = 20;
interface BuffKind {
  id: string;
  /** Said once, on the banner, when you pick it up. */
  label: string;
  /** What sits in the HUD for twenty seconds. An icon and a countdown — the
   *  full sentence there pushed the readout off a phone's screen. */
  badge: IconName;
  /** The ring under the hero while it runs. */
  color: number;
  /** Happens once and is over. No ring, no countdown, no `buff`. */
  instant?: boolean;
}
/** What a rare crate pays.
 *
 *  **The label says what it DOES, not what it is called.** "Double strike" and
 *  "Shielded" are names, and a name only means something to somebody who
 *  already knows the game — reported as "I broke it and nothing told me what
 *  changed", which is what a name that is gone in 1.4 seconds amounts to.
 *
 *  The colour is the other half. A word is on screen for a moment; the ring
 *  under the hero is there for the whole twenty seconds, and it has to say
 *  WHICH one without repeating the sentence. */
const BUFFS: BuffKind[] = [
  { id: 'strike', label: 'Your hits land twice', badge: 'sword', color: 0xff7a4d },
  { id: 'shield', label: 'Nothing can hurt you', badge: 'shield', color: 0x6ec8ff },
  { id: 'slow', label: 'Everything slows down', badge: 'ice', color: 0x7fd4ff },
  // INSTANT. It has no twenty seconds to run for — the board is empty the
  // moment it lands — so it never becomes the `buff`, wears no ring and holds
  // no row in the readout. Kept in the same table anyway, because what a rare
  // crate can pay should be readable as one list.
  { id: 'wipe', label: 'The board is cleared', badge: 'bolt', color: 0xffe08a, instant: true },
];

/** How much of their speed is LEFT while `slow` runs.
 *
 *  0.35, and it slows their SHOOTING too — the cadence, not just the walk. A
 *  slow that only moved them would leave the same number of orbs arriving per
 *  second from things that happen to be further away, which is not what "slow
 *  down" looks like from the inside. */
const SLOW_MULT = 0.35;

// --- towers ---------------------------------------------------------------
interface TowerKind {
  id: string;
  label: string;
  model: string;
  ammo: string;
  cost: number;
  range: number;
  damage: number;
  /** Seconds between shots. */
  reload: number;
  /** How fast its shot travels, in units per second. */
  shotSpeed: number;
  /** Where the weapon sits.
   *
   *  `ground` is a weapon standing on the grass: cheap, there from the first
   *  run, and upgrading makes it bigger. `tower` puts the same sort of weapon
   *  on a stack of masonry — further, harder, and much more expensive — and it
   *  has to be unlocked at the smithy first. That is the difference between
   *  "what you fight the wave with" and "what you put in the corner when the
   *  corner needs reaching". */
  mount: 'ground' | 'tower';
  /** The masonry under the weapon, one piece added per level. Tower mounts
   *  only: the kit ships towers as stackable sections, so an upgrade makes the
   *  thing physically TALLER rather than changing a number in a tooltip. */
  stack?: [string, string, string];
  /** Smithy level required before this appears in the hotbar at all. */
  needsSmithy?: number;
}
/** Four, and each one is a different answer to "what is walking past me".
 *  Cheap-and-quick, slow-and-hard, long-and-lobbing, fast-and-weak. A second
 *  tower that is just the first with bigger numbers is a longer menu, not a
 *  decision. */
const TOWERS: TowerKind[] = [
  // On the ground. What you have from the first run, and what most of a board
  // gets built out of.
  { id: 'ballista', label: 'Ballista', model: 'td-ballista', ammo: 'td-ammo-arrow',
    cost: 25, range: 3.0, damage: 2, reload: 1.0, shotSpeed: 9, mount: 'ground' },
  { id: 'cannon', label: 'Cannon', model: 'td-cannon', ammo: 'td-ammo-ball',
    cost: 45, range: 2.2, damage: 5, reload: 2.0, shotSpeed: 7, mount: 'ground' },
  { id: 'catapult', label: 'Catapult', model: 'td-catapult', ammo: 'td-ammo-boulder',
    cost: 60, range: 4.2, damage: 7, reload: 3.0, shotSpeed: 5, mount: 'ground' },
  { id: 'turret', label: 'Turret', model: 'td-turret', ammo: 'td-ammo-arrow',
    cost: 40, range: 2.6, damage: 1, reload: 0.28, shotSpeed: 12, mount: 'ground' },

  // On a tower. Bought at the smithy, one per level of it, and priced so that
  // one of these is three or four of the things above — the reason to want one
  // is REACH, for a corner two ground weapons cannot cover between them.
  { id: 'watchtower', label: 'Watchtower', model: 'td-ballista', ammo: 'td-ammo-arrow',
    cost: 120, range: 5.0, damage: 4, reload: 0.9, shotSpeed: 11,
    mount: 'tower', needsSmithy: 1,
    stack: ['td-tower-square-bottom-a', 'td-tower-square-middle-a', 'td-tower-square-top-a'] },
  { id: 'bastion', label: 'Bastion', model: 'td-cannon', ammo: 'td-ammo-ball',
    cost: 190, range: 4.0, damage: 12, reload: 1.9, shotSpeed: 8,
    mount: 'tower', needsSmithy: 2,
    stack: ['td-tower-square-bottom-b', 'td-tower-square-middle-b', 'td-tower-square-top-b'] },
  { id: 'spire', label: 'Spire', model: 'td-turret', ammo: 'td-ammo-arrow',
    cost: 220, range: 4.4, damage: 2.2, reload: 0.26, shotSpeed: 13,
    mount: 'tower', needsSmithy: 3,
    stack: ['td-tower-round-bottom-a', 'td-tower-round-middle-a', 'td-tower-round-top-a'] },
];



interface Enemy {
  obj: THREE.Object3D;
  hp: number;
  maxHp: number;
  /** Only armed kinds shoot. */
  armed: boolean;
  /** Two quads over its head: a dark backing and a fill. Hidden at full
   *  health — a board of full bars is noise, and the interesting information
   *  is which things are nearly dead. */
  bar: THREE.Object3D | null;
  barFill: THREE.Mesh | null;
  speed: number;
  bounty: number;
  /** Which colour it is, and therefore what colour it SHOOTS. An enemy's pole
   *  is the whole of the information the player acts on: it says, from across
   *  the board and before a shot is fired, whether what is about to come out
   *  of it will feed them or hurt them. */
  pole: Pole;
  /** Where it is going, per second. Constant for its whole life — it enters
   *  from outside one side of the board and leaves outside another, and does
   *  not steer. A thing that follows you is a contact hit with extra steps;
   *  the threat here is the LINE it draws across the field, which you can read
   *  in advance precisely because it does not change. */
  vel: THREE.Vector3;
  /** Seconds left of the rock from being hit. Flyers only. */
  wobble: number;
  alive: boolean;
  shootCooldown: number;
  windup: number;
  /** Bosses only: the rig's mixer, and the clip currently playing. */
  mixer?: THREE.AnimationMixer;
  actions?: Map<string, THREE.AnimationAction>;
  clip?: string;
  /** Left alight by the fire staff. `tick` paces the damage: applying dps every
   *  frame would mean sixty hit-sounds a second per burning enemy. */
  burn?: { dps: number; left: number; tick: number };
  /** Chilled by the ice staff — `mult` is how much of its speed is LEFT. */
  chill?: { mult: number; left: number };
  ground: boolean;
  facesTravel: boolean;
  ammo: string;
  damage: number;
  boss: boolean;
}

interface Tower {
  kind: TowerKind;
  /** Everything ever spent on this one, build and every upgrade. The refund is
   *  a share of THIS, not of the build price — refunding the base cost of a
   *  Lv4 tower is a punishment nobody takes, and then "sell it and put
   *  something better here" is a feature that exists and never gets used, which
   *  is the exact thing it was added for. */
  invested: number;
  /** The whole tower: masonry plus the weapon. Sits on the cell and never
   *  turns — only the weapon on top does. A rotating stone base reads as the
   *  ground moving. */
  obj: THREE.Object3D;
  /** The weapon, riding on top of the stack. */
  mount: THREE.Object3D;
  /** How tall the masonry currently is, in world units. */
  height: number;
  cell: [number, number];
  reload: number;
  level: number;
}

/** Levels 1-3. Everything about a tower scales off its level rather than being
 *  stored per upgrade, so there is one place to change how upgrading feels. */
/** Four. Three was a ceiling on POWER, not just on levels: with the tower count
 *  capped, a board of maxed towers is a fixed amount of damage per second, and
 *  every measured run on the hardest board ended the same way — the defence
 *  complete, 1700 gold in hand and nothing to spend it on, watching wave ten
 *  walk through. A fourth level is where the late-game gold goes. */
const MAX_LEVEL = 4;
/** What each level multiplies, spelled out rather than raised to a power.
 *
 *  It WAS `1.7 ** (level - 1)`, and adding a fourth level therefore handed out
 *  a 4.9x tower — measured, that turned the hardest board from "lost on wave
 *  ten" into "won with ten of twelve lives still up". A table keeps the first
 *  three levels exactly as they were balanced and makes the fourth a step
 *  rather than another doubling. */
const DAMAGE_BY_LEVEL = [1, 1.7, 2.89, 3.75];
const RANGE_BY_LEVEL = [1, 1.15, 1.32, 1.42];
const RELOAD_BY_LEVEL = [1, 0.82, 0.672, 0.60];
const levelDamage = (t: Tower): number => t.kind.damage * DAMAGE_BY_LEVEL[t.level - 1];
const levelRange = (t: Tower): number => t.kind.range * RANGE_BY_LEVEL[t.level - 1];
const levelReload = (t: Tower): number => t.kind.reload * RELOAD_BY_LEVEL[t.level - 1];
const upgradeCost = (t: Tower): number => Math.round(t.kind.cost * 0.8 * t.level);

/** What selling one hands back: 60% of everything put in.
 *
 *  Enough that moving a tower is a real option late in a board, and short
 *  enough of the whole that where you put it still matters. A Lv4 ballista is
 *  145g in and 87g out. What binds on this board is the tower CAP rather than
 *  the gold, so selling is mostly about freeing a slot and a position — which
 *  is also why it must be quick to do, and why it is a hold rather than a
 *  dialogue box. */
const SELL_SHARE = 0.6;
const sellValue = (t: Tower): number => Math.round(t.invested * SELL_SHARE);

/** How long the build button has to be held, in REAL seconds.
 *
 *  Real, not game, time. `dt` is clamped at 0.05 so a slow scene runs the
 *  simulation in slow motion, and a hold is an interaction with a finger rather
 *  than a thing happening in the world — a player on a struggling phone should
 *  not have to hold the button for a second and a half. */
const SELL_HOLD_MS = 800;

/** How long before the sell UI appears at all.
 *
 *  A DEAD ZONE at the start of the press, and it is not cosmetic. The same
 *  button upgrades on a tap and sells on a hold, and without this the tap
 *  showed a flash of the sell ring and the word SELL every single time — the
 *  destructive reading of the button announcing itself during the ordinary
 *  one. It made upgrading feel like a cancelled sale.
 *
 *  Under this, a press is an upgrade and shows nothing. Over it, the ring
 *  appears and begins to fill. */
const SELL_ARM_MS = 200;

interface Shot {
  obj: THREE.Object3D;
  target: Enemy;
  damage: number;
  speed: number;
}

/** An enemy's bullet. It has a DIRECTION, not a target: once it is in the air
 *  it keeps going, which is what makes stepping aside work. */
interface Bullet {
  obj: THREE.Object3D;
  vel: THREE.Vector3;
  life: number;
  /** Bar points on contact — and only if the hero is the OTHER colour. */
  damage: number;
  /** Which colour it is. The single most important field in this game: it
   *  decides whether touching this thing pays the player or costs them. */
  pole: Pole;
}

/** Does the segment a→b pass within `r` of `c`? Closest-point-on-segment.
 *
 *  Needed because a bullet can cross a player entirely between two frames:
 *  testing only where it started and where it ended finds nothing, and the
 *  shot silently misses at exactly the range it should never miss. */
const _ab = new THREE.Vector3();
const _ac = new THREE.Vector3();
function segmentHitsSphere(a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, r: number): boolean {
  _ab.copy(b).sub(a);
  _ac.copy(c).sub(a);
  const len2 = _ab.lengthSq();
  const t = len2 < 1e-9 ? 0 : Math.max(0, Math.min(1, _ac.dot(_ab) / len2));
  return _ac.addScaledVector(_ab, -t).lengthSq() <= r * r;
}

/** What the hub hands to the level: one platform connection, one WebGL context.
 *
 *  A second `WebGLRenderer` on the same canvas cannot be created — the context
 *  is already taken — and a second `ThreeUmicat.init()` would open a second
 *  connection to the host. Both are made once and passed along. */
export interface Shared {
  umicat: ThreeUmicat;
  renderer: THREE.WebGLRenderer;
  canvas: HTMLCanvasElement;
  hudEl: HTMLElement;
  audio: GameAudio;
}

// The weapon table lives in `weapons.ts` now — what each one costs, what it
// does, and what it leaves behind. Re-exported because half the game imports
// the type from here.
export type { Weapon };

/** Runs one level. Resolves when the player walks back out through the exit
 *  door — so the caller can hand control to the hub and start the loop again. */
/** What a finished run reports back. */
export interface LevelResult { won: boolean; wave: number; level: number; banked: number; }

export async function startLevel(
  shared: Shared, startWeapon: Weapon = 'sword', levelIndex = 0,
  bonus: TownBonus = NO_BONUS, weaponLevels: WeaponLevels = { sword: 1 },
): Promise<LevelResult> {
  /** The tutorial board is entered as index -1. It is not in `LEVELS` because
   *  it is not a board you choose — it is the first two minutes of the game,
   *  once — and a list entry would leave it sitting there for good. */
  // There is one board, so there is nothing to choose and nothing to look up.
  // `levelIndex` survives as an argument because the hub and the save still
  // speak in board numbers; it no longer selects anything.
  void levelIndex;
  const scripted = false;
  const level: LevelDef = ARENA;
  const { umicat, renderer, canvas, hudEl, audio } = shared;

  // No path file. There is no road on this board — nothing follows one — so
  // the scene is the whole of what the level loads.
  const [manifest, scene3d] = await Promise.all([
    fetch('scenes3d/manifest.json').then((r) => r.json() as Promise<Manifest3D>),
    fetch('scenes3d/arena.json').then((r) => r.json() as Promise<Scene3D>),
  ]);
  const [world] = await Promise.all([
    loadScene3D(scene3d, manifest, { assetBase: '', rapier: RAPIER }),
    // The spell atlas, fetched WITH the scene rather than on the first cast.
    preloadAtlas(),
  ]);
  audio.setMusic(MUSIC.level);

  // --- Fold the board into a handful of draws ---
  //
  // The boards show prices and drops too. Idempotent — the hub has almost
  // always paid for these already, and whichever runs first does.
  await makeResourceIcons(renderer, manifest);
  const folded = mergeStatic(world, scene3d, manifest);
  // Clouds. AFTER the scene is loaded, and not as entities: the SDK fits every
  // shadow camera to the bounds of what it loaded, so anything far away costs
  // the whole board its shadow resolution. A background has no bounds.
  world.scene.background = skyWithClouds({
    horizon: `#${(world.scene.background as THREE.Color | null)?.getHexString?.() ?? '9fd4ef'}`,
  });

  const hero = world.entities.get('hero')!;
  const marker = world.entities.get('build_marker')!;
  const saved = await umicat.saves.get<{ best: number; quality?: number }>(SAVE_KEY);
  let bestWave = saved?.best ?? 0;
  /** 0 = smooth, 1 = sharp.
   *
   *  No longer a button, and no longer read from the save. Sharp is measured at
   *  a steady 60 on an iPhone 14 Pro, which is the machine that decides it, and
   *  a pill reading "Sharp" beside the gear was the last piece of workshop
   *  furniture left on a screen about to be released.
   *
   *  Dropping the control must not drop the ability to MEASURE — every
   *  performance decision in this game was made by reading the frame counter on
   *  a device — so `?quality=0` still picks the cheap one, alongside `?dpr` and
   *  `?shadow`. And it is not read back from the save: a player who once tapped
   *  Smooth would otherwise be held there for good by a button that no longer
   *  exists. */
  const qFlag = new URLSearchParams(location.search).get('quality');
  const quality = qFlag === '0' ? 0 : 1;

  /** The air wall, which is what the hero is held inside, and where enemies are
   *  made and are gone. Enemies FLY and were never touching the wall.
   *
   *  **Read from the scene, not written down here.** The generator knows how
   *  big it built the board; a second copy in this file is a constant that has
   *  to be kept in step by hand, and this project already has one of those
   *  (`LAND`, in `hub.ts` and `gen-scene.mjs`) with a note in CLAUDE.md saying
   *  what it costs. Resizing the arena is one number in `gen-scene.mjs`. */
  const arena = (scene3d as unknown as {
    arena?: { field: { x: number; z: number }; outside: number };
  }).arena;
  /** Half-width and half-DEPTH of the playfield — they differ, because the
   *  board is a landscape rectangle and the screen it is played on is too. */
  const FIELD_X = arena?.field.x ?? 6.6;
  const FIELD_Z = arena?.field.z ?? 4.6;
  const OUTSIDE = arena?.outside ?? 8.6;
  /** Anywhere on the board a thing may be dropped. There is no road and no
   *  build spot to avoid any more, so this is simply the field. */
  const BACKFIELD: [number, number][] = [];
  {
    // The cell centres inside the wall. Derived, so a smaller board does not
    // quietly keep dropping crates outside itself.
    const hx = Math.floor(FIELD_X - 1.1), hz = Math.floor(FIELD_Z - 1.1);
    for (let x = -hx; x <= hx; x += 1) for (let z = -hz; z <= hz; z += 1) BACKFIELD.push([x, z]);
  }

  /** Where the hero comes in, and where a knocked-out one is carried back to —
   *  read from the scene, so moving the hero entity moves the hero. */
  const SPAWN = {
    x: hero.position.x,
    y: hero.position.y + 0.5,
    z: hero.position.z,
  };
  const character = new CharacterController3D(world.world, RAPIER, {
    position: SPAWN, halfHeight: HERO_HALF_HEIGHT, radius: HERO_RADIUS,
    speed: HERO_SPEED, stepHeight: 0.17,
  });
  const input = new Input3D({
    actions: [
      // Shapes, not emoji — see `src/icons.ts`. The attack one is swapped in
      // `setWeapon` for whatever is in your hand.
      { id: 'attack', icon: WEAPON_ICON.sword, keys: ['KeyJ'] },
      // The colour. SPACE, and it is the most-pressed control in the game —
      // which is why it gets the key the thumb is already resting on, and why
      // it is declared FIRST among the two that are not the attack: the SDK
      // lays its buttons on an arc from the bottom corner outward, so the
      // earlier a button is declared the closer to the hinge of the thumb it
      // sits. The swap is pressed several times a second in a busy board; the
      // upgrade is pressed once a minute.
      { id: 'swap', icon: ICON.swap, keys: [PLACE_KEY, 'KeyQ'] },
      // Opens the panel. Not a thing done in a hurry, and it pauses.
      { id: 'upgrade', icon: ICON.upgrade, keys: ['KeyE', 'KeyB'] },
    ],
    // NO JUMP. This game is played by walking around a board, and the platform
    // draws only the buttons a game asks for. Declining it also frees `Space`,
    // which the SDK reads as jump and which swaps the pole here.
    jump: false,
  });

  const heroMixer = world.mixerFor.get('hero');
  // A hero with no mixer renders and walks around perfectly while never moving
  // a limb, and nothing anywhere says so — the mixer only exists because the
  // scene entity declares a starting clip. Refuse to start instead.
  if (!heroMixer) {
    throw new Error(
      "the hero has no animation mixer — give its scene entity an `animation` " +
      "block (e.g. { play: 'idle', loop: true }); without one it cannot animate at all");
  }
  const clipMap: Record<string, string> =
    (manifest.models?.find((m) => m.id === 'hero') as { animations?: Record<string, string> } | undefined)?.animations ?? {};
  const animator = new CharacterAnimator(heroMixer, world.clips.get('hero') ?? [], clipMap);

  // --- Two weapons ---
  //
  // The bow is BUILT, not loaded: there is no bow anywhere in the asset
  // library — I looked — and a torus arc with a string across it reads as one
  // at this scale, in this art style, for nothing. The character already knows
  // how to hold and fire one (`holding-both-shoot`), which is the part that
  // would have been expensive.
  const heroAsset = manifest.models?.find((m) => m.id === 'hero');
  const handRight = heroAsset?.sockets?.['hand-right'];
  let sword: THREE.Object3D | null = null;
  /** The sword's own pivot, between the hand socket and the blade. */
  let swordPivot: THREE.Object3D | null = null;
  /** The pivot's local position as the socket left it. */
  const swordBase = new THREE.Vector3();
  /** The blade's own materials, cloned so tinting it tints nothing else. */
  const bladeMats: THREE.MeshStandardMaterial[] = [];
  /** Paint the blade for the tier it is at.
   *
   *  EMISSIVE rather than the base colour: a sword whose steel is repainted
   *  pink reads as a toy, and one that glows hotter reads as a sword with
   *  something in it. Nothing else writes the blade's emissive, so there is no
   *  fight of the kind the burn and the chill have over an enemy's. */
  const paintBlade = (): void => {
    const look = tierLook(runTier);
    for (const m of bladeMats) {
      if (!m.emissive) continue;
      m.emissive.setHex(look.color);
      m.emissiveIntensity = look.glow;
      m.needsUpdate = true;
    }
  };
  const _want = new THREE.Vector3();
  /** Whether this swing has already drawn its smear. */
  let trailDone = false;
  /** Seconds left in the current swing; 0 is at rest. */
  let swing = 0;
  let bow: THREE.Object3D | null = null;
  let staff: THREE.Object3D | null = null;

  /** A staff, also built rather than loaded — a shaft and the kit's own
   *  crystal, which is already the right art for "this thing is magic". */
  /** One staff, three gems. Fire, ice and storm share a carved stick and differ
   *  at the end of it, which is what makes them read as a family — three
   *  separate models would have been three unrelated objects on the rack. */
  let staffGem: THREE.MeshStandardMaterial | null = null;
  const makeStaff = (): THREE.Object3D => {
    const g = new THREE.Object3D();
    const shaft = new THREE.Mesh(
      new THREE.CylinderGeometry(0.016, 0.02, 0.42, 6),
      new THREE.MeshStandardMaterial({ color: 0x6d4a2f, roughness: 0.9 }));
    staffGem = new THREE.MeshStandardMaterial({
      color: 0x9b6cff, emissive: 0x6a3fd6, emissiveIntensity: 0.9, roughness: 0.3 });
    const gem = new THREE.Mesh(new THREE.OctahedronGeometry(0.055), staffGem);
    gem.position.y = 0.24;
    g.add(shaft, gem);
    g.traverse((o) => { if ((o as THREE.Mesh).isMesh) (o as THREE.Mesh).castShadow = true; });
    return g;
  };


  const makeBow = (): THREE.Object3D => {
    const g = new THREE.Object3D();
    const wood = new THREE.MeshStandardMaterial({ color: 0x8a5a2b, roughness: 0.8 });
    const limb = new THREE.Mesh(new THREE.TorusGeometry(0.17, 0.018, 6, 16, Math.PI * 1.15), wood);
    limb.rotation.z = Math.PI * 0.42;
    const string = new THREE.Mesh(
      new THREE.CylinderGeometry(0.004, 0.004, 0.3, 4),
      new THREE.MeshStandardMaterial({ color: 0xe8e2d0, roughness: 1 }));
    string.position.x = 0.055;
    g.add(limb, string);
    g.traverse((o) => { if ((o as THREE.Mesh).isMesh) (o as THREE.Mesh).castShadow = true; });
    return g;
  };

  if (handRight) {
    const loaded = await loadModelAsset(manifest, 'sword', { assetBase: '' });
    const blade = loaded.object;
    blade.traverse((o) => { if ((o as THREE.Mesh).isMesh) (o as THREE.Mesh).castShadow = true; });
    // MATERIALS OF ITS OWN, before anything tints them.
    //
    // A GLB loaded twice hands back two objects pointing at ONE material. This
    // game has been bitten by that twice already — `flashTint` turning five
    // enemies red for one hit, and fading the Clinic fading the Armory because
    // both are built from the same stall — and a sword that glows hotter as it
    // levels would have quietly set fire to every other object sharing the
    // kit's material.
    blade.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh || !mesh.material) return;
      mesh.material = Array.isArray(mesh.material)
        ? mesh.material.map((m) => m.clone())
        : mesh.material.clone();
      const mats = (Array.isArray(mesh.material) ? mesh.material : [mesh.material]);
      for (const m of mats) bladeMats.push(m as THREE.MeshStandardMaterial);
    });
    // Longer. The kit's sword is 0.45 against a 0.72 hero, which from the
    // game's camera is a knife — and a short blade held level reads as a stick.
    blade.scale.setScalar(SWORD_SCALE);
    // A pivot of its own between the hand and the blade.
    //
    // The socket is shared by all three weapons, so it cannot hold the sword's
    // pose; and the swing is Kenney's `attack-melee-right`, which is a vertical
    // CHOP. Rotating this pivot is how the blade gets carried upright and swept
    // across the body instead — the arm does the chop, the blade does the cut.
    swordPivot = new THREE.Object3D();
    swordPivot.add(blade);
    sword = swordPivot;
    attachToSocket(hero, handRight, swordPivot);
    // Where the socket put it, kept so the levelling below can start from the
    // same place every frame instead of accumulating its own correction.
    swordBase.copy(swordPivot.position);
    // Not posed here: `restSword` reads vectors declared further down, and
    // calling it from up here is a reference into the temporal dead zone —
    // which throws inside an async boot and shows up as a loading screen that
    // never ends rather than as an error anyone sees. The frame loop poses it.
    bow = makeBow();
    attachToSocket(hero, handRight, bow);
    staff = makeStaff();
    attachToSocket(hero, handRight, staff);
  }

  const _up = new THREE.Vector3(0, 1, 0);
  const _dir = new THREE.Vector3();
  const _edge = new THREE.Vector3();
  const _localX = new THREE.Vector3();
  const _rest = new THREE.Vector3();
  const _cross = new THREE.Vector3();
  const _bladeQ = new THREE.Quaternion();
  const _roll = new THREE.Quaternion();
  const _parentQ = new THREE.Quaternion();

  /** Point the blade along a WORLD direction, with its edge leading.
   *
   *  Posing the pivot in its own Euler angles is how the sword ended up looking
   *  like a scabbard: the socket hangs off a bone whose frame is whatever the
   *  animation says this frame, so "up" in the pivot is not up. Aiming it in
   *  world space and converting back is exact and needs no numbers guessed off
   *  a bone.
   *
   *  `edge` matters as much as `dir`. The blade is a plate — 0.23 wide across
   *  its edges and 0.11 thick — so a swing with the flat leading is a swing
   *  with a plank. Rolling it so the edge faces the way the tip is travelling
   *  is the difference between a cut and a slap.
   */
  const aimBlade = (dir: THREE.Vector3, edge: THREE.Vector3): void => {
    if (!swordPivot?.parent) return;
    _dir.copy(dir).normalize();
    _bladeQ.setFromUnitVectors(_up, _dir);
    _localX.set(1, 0, 0).applyQuaternion(_bladeQ);
    _edge.copy(edge).projectOnPlane(_dir);
    if (_edge.lengthSq() > 1e-6) {
      _edge.normalize();
      const angle = Math.atan2(_cross.crossVectors(_localX, _edge).dot(_dir), _localX.dot(_edge));
      _bladeQ.premultiply(_roll.setFromAxisAngle(_dir, angle));
    }
    swordPivot.parent.getWorldQuaternion(_parentQ);
    swordPivot.quaternion.copy(_parentQ.invert().multiply(_bladeQ));
  };

  /** Hold the blade at ONE HEIGHT through the cut.
   *
   *  The arm is playing Kenney's `attack-melee-right`, which is a vertical
   *  chop, so the hand — and the hilt with it — rises and falls through the
   *  swing. Measured on the blade's own tip: 0.87 of sideways travel and **0.61
   *  of vertical**, which is why a sweep the code thought was level read as a
   *  tap or a stab. Aiming the blade in world space fixed its DIRECTION and
   *  could do nothing about where the hand carried it.
   *
   *  So the pivot is pushed back down by however far the hand went up. Only the
   *  vertical part: the hilt keeps whatever the hand does sideways, so it stays
   *  in the fist rather than floating beside it.
   *
   *  Eased in and out across the cut, because a hilt that snaps to a fixed
   *  height on the first frame of the swing is a sword that jumps in the hand. */
  const levelBlade = (k: number, dx: number, dz: number): void => {
    if (!swordPivot?.parent) return;
    const cut = Math.min(1, k / SWING_CUT);
    // A PLATEAU, not a bell. `sin(cut * PI)` eased off everywhere except the
    // exact middle, so the hilt was only half-levelled through most of the cut
    // and the tip still moved 0.26 vertically against 0.82 sideways. Full hold
    // across the body, easing only over the first and last tenth so the sword
    // does not jump in the hand at either end.
    const ease = (t: number): number => t * t * (3 - 2 * t);
    const inK = ease(Math.min(1, cut / 0.12));
    const outK = ease(Math.min(1, (1 - cut) / 0.12));
    const hold = Math.min(inK, outK);
    swordPivot.position.copy(swordBase);
    swordPivot.parent.updateMatrixWorld(true);
    swordPivot.updateMatrixWorld(true);
    // Where the hilt WANTS to be: on a circle around the hero's own centre, at
    // one height, in the direction the blade is pointing. The pivot hangs off
    // the hand, so left to itself the arc is centred on the HAND — a hand's
    // width off to the right, rising and falling with the chop. Measured before
    // this: the tip ran from +0.17 to −0.65 rather than either side of zero,
    // which is a lopsided arc around the wrong point.
    _want.set(
      hero.position.x + dx * SWING_GRIP,
      hero.position.y + SWING_HEIGHT,
      hero.position.z + dz * SWING_GRIP,
    );
    // `worldToLocal`, not a rotated delta. The hero is imported at 0.35 scale
    // and every bone carries it, so rotating a world-space offset into the
    // bone's frame moves about a third as far as it should — the hilt came out
    // drifting between 0.37 and 0.21 instead of sitting at 0.42. A full inverse
    // matrix has the scale in it.
    swordPivot.parent.worldToLocal(_want);
    swordPivot.position.lerp(_want, hold);
    swordPivot.updateMatrixWorld(true);
  };

  /** Carried: blade up, leaning a little forward, edge facing out. */
  function restSword(): void {
    if (!swordPivot) return;
    swordPivot.position.copy(swordBase);
    const yaw = hero.rotation.y;
    const fx = Math.sin(yaw), fz = Math.cos(yaw);
    aimBlade(_dir.set(fx * 0.22, 1, fz * 0.22), _edge.set(fx, 0, fz));
  }

  /** The hero carries all of them and shows one. */
  let weapon: Weapon = startWeapon;
  let kind = WEAPON_BY_ID.get(weapon) ?? WEAPON_BY_ID.get('sword')!;
  let weaponLevel = Math.max(1, levelOf(weaponLevels, weapon));
  /** Called once, with whatever came through the door. Not a control. */
  const setWeapon = (w: Weapon): void => {
    weapon = w;
    // The button wears what you are holding. Swinging a sword, loosing an
    // arrow and calling down lightning are three different actions sharing one
    // control, and a button that shows a sword through all of them is telling
    // you the wrong thing about the one you have.
    input.setActionIcon('attack', WEAPON_ICON[w] ?? WEAPON_ICON.sword);
    kind = WEAPON_BY_ID.get(w) ?? WEAPON_BY_ID.get('sword')!;
    // A weapon you are holding is at least level 1 — arriving with a 0 would
    // mean a hero swinging something that does no damage, which reads as the
    // weapon being broken rather than the save being wrong.
    weaponLevel = Math.max(1, levelOf(weaponLevels, w));
    if (sword) sword.visible = kind.cast === 'melee';
    if (bow) bow.visible = kind.cast === 'arrow';
    if (staff) staff.visible = kind.cast === 'burst';
    if (staffGem && kind.tint) {
      staffGem.color.setHex(kind.tint.gem);
      staffGem.emissive.setHex(kind.tint.glow);
    }
    if (lockRing) lockRing.visible = false;
    // Declared further down, and called on the first `setWeapon` before it
    // exists — the guard is why this is not a crash at boot.
    if (typeof drawWeaponChip === 'function') drawWeaponChip();
  };

  // Prototypes, cloned per placement. Loading inside the build handler would
  // put a download in the middle of a button press.
  const protos = new Map<string, THREE.Object3D>();
  /** The boss's clips. Kept because a rigged model needs a mixer per instance,
   *  and a mixer needs the clips — `loadModelAsset` hands them over and every
   *  other model in this game throws them away. */
  let bossClips: THREE.AnimationClip[] = [];
  /** Semantic name -> the clip actually in the file. `attack` is
   *  `attack-melee-right` in Kenney's rig; `walk` and `die` happen to match,
   *  which is exactly the kind of coincidence that hides a missing mapping. */
  const bossAnim: Record<string, string> =
    (manifest.models ?? []).find((m) => m.id === 'boss-orc')?.animations ?? {};
  for (const id of [...TOWERS.map((t) => t.model), ...TOWERS.map((t) => t.ammo),
                    ...TOWERS.flatMap((t) => t.stack ?? []), 'td-tower-round-crystals',
                    ...PRELOAD.map((w) => w.model), ...PRELOAD.map((w) => w.ammo ?? 'td-bullet'),
                    // The orb, named explicitly. It is currently also reached
                    // through `TOWERS`' ammo list — and the towers are one
                    // commit from being deleted, which would take every bullet
                    // in the game with them, silently.
                    ORB_MODEL,
                    // Everything `dropPickup`, `dropCrate` and the tower
                    // levels can ask for. A model that is not here is not a
                    // missing texture — it is `undefined.type` thrown out of
                    // the clone, from whichever frame first needed it.
                    'td-bullet', ...Object.values(DROP_MODEL),
                    'hub-crate', 'hub-barrel']) {
    if (protos.has(id)) continue;
    const { object, clips } = await loadModelAsset(manifest, id, { assetBase: '' });
    object.traverse((o) => { if ((o as THREE.Mesh).isMesh) { (o as THREE.Mesh).castShadow = true; } });
    protos.set(id, object);
    if (id === 'boss-orc') bossClips = clips;
  }
  /** A fresh copy, NOT parented to anything. `spawnFrom` is this plus adding to
   *  the scene; a tower needs the copy inside its own group instead. */
  const cloneOf = (id: string): THREE.Object3D => {
    // A plain clone of a SKINNED mesh shares its skeleton: two of them animate
    // as one, and the second to spawn snaps into the first one's pose. Only the
    // boss is skinned, and there is only ever one of it, but the rule belongs
    // next to the clone rather than in someone's memory.
    const proto = protos.get(id)!;
    const o = proto.type === 'Group' && bossClips.length && id === 'boss-orc'
      ? (SkeletonUtils.clone(proto) as THREE.Object3D)
      : proto.clone(true);
    return o;
  };
  const spawnFrom = (id: string): THREE.Object3D => {
    const o = cloneOf(id);
    world.scene.add(o);
    return o;
  };

  /** How tall a tower piece is, measured once from the model. Stacking by a
   *  number typed in here would be right until someone swaps a piece. */
  const pieceHeights = new Map<string, number>();
  const pieceHeight = (id: string): number => {
    let h = pieceHeights.get(id);
    if (h === undefined) { h = localTop(protos.get(id)!); pieceHeights.set(id, h); }
    return h;
  };

  /** Add the next section of masonry and lift the weapon onto it.
   *
   *  Past the last section there is no more masonry — a tower tall enough to
   *  hide the road behind it is a worse tower — so the final level decorates
   *  instead: the kit's crystal cluster at the foot, and a bigger weapon on
   *  top. It still has to LOOK different, or the most expensive upgrade in the
   *  game is the only one you cannot see. */
  const raiseTower = (t: Tower): void => {
    if (t.kind.mount === 'ground') {
      // No masonry. It grows instead — the same upgrade this game had before
      // the towers arrived, and still the right one for something standing in
      // the grass: a bigger ballista reads as a better ballista, and a ground
      // weapon that sprouted a stone plinth would just be a tower.
      t.obj.scale.setScalar(1 + (t.level - 1) * 0.16);
      return;
    }
    const stack = t.kind.stack!;
    if (t.level > stack.length) {
      const crystals = cloneOf('td-tower-round-crystals');
      crystals.position.y = 0;
      t.obj.add(crystals);
      t.mount.scale.setScalar(1.25);
      return;
    }
    const id = stack[t.level - 1];
    const piece = cloneOf(id);
    piece.position.y = t.height;
    t.obj.add(piece);
    t.height += pieceHeight(id);
    t.mount.position.y = t.height;
  };

  /** Cross-fade a boss clip in. `loop` false for the ones that end — a death
   *  animation on repeat is a thing standing up again. */
  const playEnemyClip = (e: Enemy, name: string, loop = true): void => {
    if (!e.actions || e.clip === name) return;
    const next = e.actions.get(bossAnim[name] ?? name);
    if (!next) return;
    const prev = e.clip ? e.actions.get(e.clip) : null;
    next.reset();
    next.setLoop(loop ? THREE.LoopRepeat : THREE.LoopOnce, Infinity);
    next.clampWhenFinished = !loop;
    next.fadeIn(0.15).play();
    prev?.fadeOut(0.15);
    e.clip = name;
  };

  // --- render ---
  // The renderer and the canvas come from the boot, already in use by the hub.
  // A second WebGLRenderer on the same canvas cannot be created at all.
  renderer.shadowMap.enabled = true;
  hudEl.textContent = '';
  // Render resolution, and the one graphics setting here that genuinely trades
  // picture for speed. A phone reports 3; 1.5 is the default because 2 is 1.8x
  // the fragments. `?dpr=2` to compare — the point is that this is decidable
  // by looking at the screen and the frame counter at the same time, on the
  // device, rather than by me picking a number on a laptop.
  // --- Picture quality ---
  //
  // Two settings genuinely trade picture for speed: how many pixels are
  // rendered, and how sharp shadows are. Which way to go is a matter of taste
  // on a particular screen, so it is a toggle the player can press while
  // looking at the game and the frame counter at the same time. (`?dpr=` and
  // `?shadow=` still override it, for probes — but the app has no address bar,
  // which is where the URL-flag version of this idea died.)
  const flags = new URLSearchParams(location.search);
  const dprFlag = Number(flags.get('dpr'));
  const shadowFlag = Number(flags.get('shadow'));
  // The SDK picks a shadow size for the device at load; remember it, because
  // "leave it alone" only works the first time. Going Sharp and back left the
  // 2048 map in place and Smooth was Sharp with fewer pixels.
  const defaultShadow = (() => {
    const d = world.scene.children.find((c) => (c as THREE.DirectionalLight).isDirectionalLight) as THREE.DirectionalLight | undefined;
    return d ? d.shadow.mapSize.width : 1024;
  })();
  const QUALITY = [
    { name: 'Smooth', dpr: 1.5, shadow: defaultShadow },
    { name: 'Sharp', dpr: 2, shadow: 2048 },
  ];
  // Ordered cheapest-first for the label to make sense, but the DEFAULT is
  // index 1. A default is a measurement, not a position in a list.

  const applyQuality = (): void => {
    const q = QUALITY[quality];
    // Smooth also drops the far half of the forest. It is half the triangles on
    // a board and it is the two rings you never stand next to — so if a phone
    // struggles with the trees, the control a player already has is the one
    // that helps, rather than a setting only I know about.
    for (const o of world.scene.children) {
      if (o.name === 'forest_far') o.visible = quality > 0;
    }
    const screen = window.devicePixelRatio ?? 1;
    renderer.setPixelRatio(Math.min(screen, dprFlag > 0 ? dprFlag : (screen > 2 ? q.dpr : 2)));
    const size = shadowFlag > 0 ? shadowFlag : q.shadow;
    if (size > 0) {
      for (const l of world.scene.children) {
        const d = l as THREE.DirectionalLight;
        if (!d.isDirectionalLight || !d.castShadow) continue;
        d.shadow.mapSize.set(size, size);
        // The map is allocated at the old size; drop it so three.js rebuilds
        // one. Changing mapSize alone does nothing at all.
        d.shadow.map?.dispose();
        d.shadow.map = null as unknown as THREE.WebGLRenderTarget;
      }
    }
    resize();
  };
  renderer.shadowMap.enabled = true;
  // --- the camera is the frame, and the frame is the screen -----------------
  //
  // The board fits the viewport. Not "roughly" — the four corners of the air
  // wall are solved for, so on any screen the whole playfield is visible and
  // nothing of it is off the edge.
  //
  // **Fitted to whichever axis is tighter.** On a wide screen the HEIGHT runs
  // out first, so the camera settles at the distance the board's depth needs
  // and the spare width is filled with forest — which is the look this was
  // asked for. On a tall one the width runs out first and the camera pulls
  // back until it fits, putting trees above and below instead. Either way the
  // player never sees past the world, and the board is never cropped.
  //
  // Solved by BISECTION rather than in closed form. The projection of a tilted
  // square is a trapezoid and its four corners are at four different depths,
  // so "how far back fits it" has no one-line answer worth trusting; thirty
  // iterations of "does it fit at this distance" is exact to a millimetre,
  // runs only on resize, and cannot be subtly wrong in a way nobody notices.

  /** How steep.
   *
   *  42°, and the angle is not only taste — it decides how big everything is.
   *  Two effects, pushing the same way:
   *
   *   - the board's DEPTH projects as `2·fieldZ·sin(pitch)`, so a shallower
   *     camera needs less of the screen's height for the same board and can
   *     therefore sit closer;
   *   - a standing thing keeps `cos(pitch)` of its height, so a shallower
   *     camera draws the hero taller in the bargain.
   *
   *  55° to 42° is about a third more hero for nothing. Past this it stops
   *  reading as looking DOWN at a board and the far half begins hiding behind
   *  the near half, which is where the trade turns. */
  const CAM_PITCH = 42 * (Math.PI / 180);
  /** A little air around the playfield, so the wall is not flush with the
   *  screen edge and the hero at the far corner is not half a pixel from it.
   *
   *  ONE. The wall sits exactly on the frame edge.
   *
   *  Every percent here is zoom given away twice over — the board is the
   *  screen, so padding around it comes straight off how big everything on it
   *  is, on both sides. And it buys nothing: enemies are spawned outside the
   *  wall and are visible on their way in regardless, because what is beyond
   *  the wall is forest rather than the edge of the world. */
  const CAM_MARGIN = 1.0;
  /** The height the fit is solved AT.
   *
   *  It was the wall's top, 1.6, which is conservative in the expensive
   *  direction: the far wall's top is the highest thing in frame, so fitting
   *  it pushed the camera back and shrank everything for the sake of a
   *  handspan of masonry nobody looks at. What has to be visible is the
   *  GROUND, the hero (0.72) and the flyers (0.38 plus their own height).
   *
   *  This is expensive and unavoidable: headroom is charged at BOTH ends of
   *  the board, so 0.8 of world height costs about a fifth of the screen's.
   *  Measured on a landscape phone, the ground corners sit at 67% of the
   *  frame's height and the rest is this. Lower than 0.8 and the hero's head
   *  clips at the far edge, which is the one place you cannot afford not to
   *  see them. */
  const CAM_AT_Y = 0.8;

  const _corner = new THREE.Vector3();
  /** Does everything that must be on screen fit, from this far away? */
  const fitsAt = (dist: number, aspect: number): boolean => {
    const cam = world.camera as THREE.PerspectiveCamera;
    const eye = new THREE.Vector3(0, Math.sin(CAM_PITCH), Math.cos(CAM_PITCH))
      .multiplyScalar(dist);
    // `Matrix4.lookAt` writes the ROTATION and leaves the translation alone,
    // so this is the camera's world matrix once the eye is put in it.
    const inv = new THREE.Matrix4().lookAt(eye, ZERO, UP).setPosition(eye).invert();
    const tanY = Math.tan((cam.fov * Math.PI / 180) / 2);
    const tanX = tanY * aspect;
    const FX = FIELD_X * CAM_MARGIN;
    const FZ = FIELD_Z * CAM_MARGIN;
    // Headroom at the FAR edge only.
    //
    // The ground's corners are all four; the raised ones are only the two at
    // -Z. That is not a shortcut, it is where the room is actually needed: the
    // camera looks down from +Z, so a standing thing at the NEAR edge projects
    // its base at the bottom of the frame and its head further UP — into the
    // board, not out of the picture. Only the far edge has a head that leaves
    // the top.
    //
    // Reserving it at both ends charged the headroom twice and gave the
    // difference to the tree line, which is what "the trees still take up a
    // lot of room" was. It is about a tenth of the frame's height, and it goes
    // straight into the playfield.
    //
    // Both ENDS of the ground still have to be solved, though — dropping the
    // near corners is how the board fell off the bottom of a laptop once.
    for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as const) {
      for (const y of sz < 0 ? [0, CAM_AT_Y] : [0]) {
        _corner.set(sx * FX, y, sz * FZ).applyMatrix4(inv);
        const depth = -_corner.z;
        if (depth <= 0.01) return false;
        if (Math.abs(_corner.x) > tanX * depth) return false;
        if (Math.abs(_corner.y) > tanY * depth) return false;
      }
    }
    return true;
  };

  /** Put the camera where the whole board is on screen. */
  const fitCamera = (): void => {
    const cam = world.camera as THREE.PerspectiveCamera;
    const aspect = Math.max(0.2, canvas.clientWidth / Math.max(1, canvas.clientHeight));
    let lo = 1, hi = 200;
    if (!fitsAt(hi, aspect)) lo = hi;      // nothing fits: take the far end
    else {
      for (let i = 0; i < 34; i++) {
        const mid = (lo + hi) / 2;
        if (fitsAt(mid, aspect)) hi = mid; else lo = mid;
      }
    }
    const dist = hi;
    cam.position.set(0, Math.sin(CAM_PITCH) * dist, Math.cos(CAM_PITCH) * dist);
    cam.lookAt(0, 0, 0);
    // The far plane is 500 by default, which is plenty; the NEAR plane matters
    // more here — at this distance a 0.1 near plane wastes most of the depth
    // buffer and the merged ground z-fights with the tiles on it.
    cam.near = Math.max(0.5, dist * 0.05);
    cam.far = dist + 120;
    cam.updateProjectionMatrix();
  };

  const resize = (): void => {
    renderer.setSize(window.innerWidth, window.innerHeight, false);
    world.camera.aspect = window.innerWidth / window.innerHeight;
    world.camera.updateProjectionMatrix();
    // Where the camera BELONGS depends on the aspect, so it is re-solved here
    // rather than once at load. A phone rotated from portrait to landscape is
    // the case that matters, and it is also the one nobody tests.
    fitCamera();
  };
  resize();
  window.addEventListener('resize', resize);
  fitCamera();
  applyQuality();

  // --- Warm every shader before the game starts ---
  //
  // A model's FIRST render is where the shader gets compiled and the texture
  // uploaded, and that is one long frame. It does not land when the object is
  // created — it lands a frame or two later, when it is first drawn — so it
  // shows up as "the game hitches when an enemy appears", once per wave,
  // because each wave uses a different UFO. Measured at 117ms against a 42ms
  // median.
  //
  // Drawing one of everything at a pinhead before the player sees anything
  // moves all of that into the loading screen where it belongs. Scale matters
  // only for looks: a bound texture uploads whether it covers one pixel or a
  // thousand.
  {
    const warm: THREE.Object3D[] = [];
    for (const id of protos.keys()) {
      const o = protos.get(id)!.clone(true);
      o.position.copy(world.camera.position).add(new THREE.Vector3(0, -0.4, -1));
      o.scale.setScalar(0.001);
      world.scene.add(o);
      warm.push(o);
    }
    // The updraft's additive quads are their own material, so they get a turn
    // too — otherwise the first upgrade of every run stutters.
    const spark = new THREE.Mesh(new THREE.PlaneGeometry(0.001, 0.001),
      new THREE.MeshBasicMaterial({ color: 0xffc94d, transparent: true, opacity: 0.01, depthWrite: false }));
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.001, 0.002, 24),
      new THREE.MeshBasicMaterial({ color: 0xffe08a, transparent: true, opacity: 0.01,
        side: THREE.DoubleSide, depthWrite: false }));
    for (const m of [spark, ring]) { m.position.copy(world.camera.position).add(new THREE.Vector3(0, -0.4, -1)); world.scene.add(m); warm.push(m); }

    renderer.compile(world.scene, world.camera);
    renderer.render(world.scene, world.camera);   // and actually draw them, so textures upload
    for (const o of warm) o.removeFromParent();
    spark.geometry.dispose(); ring.geometry.dispose();
  }

  // The lock frame: the same corner bracket the board uses for a build spot,
  // stood on its edge to face the camera. Reusing it is deliberate — in this
  // game that shape already means "this is the thing the button acts on".
  let lockRing: THREE.Object3D | null = null;
  {
    const { object } = await loadModelAsset(manifest, 'td-selection', { assetBase: '' });
    object.traverse((o) => { if ((o as THREE.Mesh).isMesh) (o as THREE.Mesh).castShadow = false; });
    object.visible = false;
    object.scale.setScalar(0.9);
    world.scene.add(object);
    lockRing = object;
  }

  // --- state ---
  // What the town is worth, folded in where the run reads it — one place each,
  // so a bonus cannot apply to the HUD and not to the rule, or the other way.
  const saveNow = await readSave(umicat);
  /** ONE, always. There is no player level any more.
   *
   *  It gave +8% attack and −3.5% damage taken per level, read off the save —
   *  and this game has a SHARED SCORE BOARD. A persistent power stat and a
   *  cross-player board cannot both be right: two players of the same skill
   *  post different numbers because one of them has played longer, so the
   *  board ranks accounts rather than runs. That is the board not working,
   *  and it is invisible — nothing on screen would ever say so.
   *
   *  So it is not merely hidden. A stat that silently scales every fight is
   *  the worst thing to leave switched on behind a readout somebody removed.
   *
   *  The save's `level` and `xp` are left alone rather than deleted: they cost
   *  nothing, and an old save that carries them is not worth breaking. Nothing
   *  reads them. */
  const playerLevel = 1;
  void saveNow.level;
  /** What this run has picked up, for the summary and for the village. */
  const earned: Materials = { ...NO_MATERIALS };
  let kills = 0;
  /** How many drops have been PICKED UP. The tutorial's "walk over it" step
   *  reads this: the counter moving is the whole lesson, since nothing in this
   *  game pays itself in. */
  let pickedUp = 0;
  /** Whether the hero has swung at anything and connected. */
  let heroHits = 0;
  const maxTowers = 0;
  /** Nothing is placed any more, so the hotbar offers no towers. It keeps its
   *  ONE remaining cell — the weapon, with the staff's recharge drawn on it —
   *  which is a readout rather than a row of things to buy.
   *
   *  Empty rather than deleted: `TOWERS` and everything that reads it are one
   *  commit away from being removed outright, and taking them out in the same
   *  pass as the new game would mean two large changes landing together with
   *  nothing to tell their failures apart. */
  const KINDS: TowerKind[] = [];
  // FIXED. The Clinic buys armour now, not a bigger pool — see `TownBonus`.
  // A percentage bar cannot show a pool growing anyway: it always starts full,
  // and 175/175 looks exactly like 100/100 until something hits you.
  const heroMaxHp = HERO_MAX_HP;
  /** Taken off every hit before the level's multiplier. */
  const armour = bonus.armour;
  /** What the hero actually lost this run, and to how many hits. */
  let tookDamage = 0;
  let tookHits = 0;
  // Every weapon, not just the sword. The Range says "+1 to your own attacks",
  // and a bonus that silently applied to one of three would be a lie told by
  // the only line of text the player ever reads about it.
  const baseHeroDamage = HERO_ATTACK_DAMAGE + bonus.heroDamage;
  /** What a swing is worth right now, effect included. A function rather than a
   *  constant, because "double strike" has to reach every weapon and every call
   *  site — a buff that reaches three of four looks broken to whoever notices.
   *  (`heroHit` is taken: it is the sphere a bullet is tested against.) */
  const withBuff = (base: number): number =>
    base * attackMultiplier(playerLevel) * (buff?.kind.id === 'strike' ? 2 : 1);
  const heroDamage = baseHeroDamage;
  let gold = bonus.gold;
  let lives = 1;
  let heroHp = heroMaxHp;
  let waveIndex = 0;
  // Countdown to the next wave. The FIRST one is longer than the rest: a board
  // with a short road gives the towers less time with everything that walks it,
  // and the answer to that is more time to build before it starts, not a
  // gentler wave one. Measured — Frostfall's opening cost eight of ten lives.
  let waveTimer = 0;
  /** Whether the wave at `waveIndex` has actually been sent out yet. */
  let waveLaunched = false;
  let wavesPaused = false;
  /** How long before the first crossing. Long enough to have looked at the
   *  board and found which colour you are, and not a second longer: what
   *  teaches this game is a bullet coming at you, and nothing before the first
   *  one teaches anything.
   *
   *  It is the SPAWN timer that carries this, not a separate opening delay.
   *  There was one — and the clock-driven loop that replaced the wave loop
   *  never read it, so the opening grace silently became zero and the first
   *  enemy arrived on frame one. */
  let spawnTimer = 3.5;
  let toSpawn = 0;
  /** Seconds the run has been going. The whole difficulty curve is a function
   *  of this and nothing else, so "what is minute three like" is a question
   *  with an answer you can read off `levels.ts` without playing to it. */
  let runClock = 0;
  let bossCount = 0;

  // --- the three numbers this game is actually about ----------------------

  /** Which colour the hero is RIGHT NOW. Everything follows from it: which
   *  bullets feed you and which ones hurt.
   *
   *  It starts `dark` rather than being chosen, and the opening board is a
   *  coin flip per enemy, so the first thing that happens to a new player is
   *  half the bullets going the wrong way. That is the lesson, delivered by
   *  the game rather than by a panel. */
  let pole: Pole = 'red';
  /** The one resource. Absorbing fills it; attacking, healing and upgrading
   *  spend it. It does not regenerate — see the note on `MANA_MAX`. */
  let mana = MANA_START;
  /** What the run is worth. Every point of mana TAKEN scores, and so does
   *  every kill — which means the score is a record of how much you were
   *  willing to stand in front of, not of how long you hid. A survival timer
   *  would reward the opposite. */
  let score = 0;

  /** `m:ss`. The run has no waves to count, so its length is the only thing
   *  left that says how far you got. */
  const formatTime = (t: number): string =>
    `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;

  /** Take mana, and score it. One function because the two must not drift:
   *  a source that pays mana and forgets to score is a source that quietly
   *  does not count. */
  const gainMana = (n: number): void => {
    mana = Math.min(MANA_MAX, mana + n);
    score += n;
    renderHud();
  };
  /** Spend it, if there is enough. Returns whether the thing may happen —
   *  every caller is an action that must not half-occur. */
  const spendMana = (n: number): boolean => {
    if (mana < n) return false;
    mana -= n;
    renderHud();
    return true;
  };
  let running = true;
  /** Milliseconds of HITSTOP left — the freeze on a connecting blow.
   *
   *  The single biggest thing in melee feel, and the cheapest: for a few frames
   *  after contact the world does not advance, so the swing, the victim and
   *  everything around them hold still for a moment. It reads as the blade
   *  MEETING something rather than passing through it.
   *
   *  Measured in REAL milliseconds, not in `dt`: `dt` is clamped at 0.05 and a
   *  freeze counted in game time would last four times as long on a phone
   *  having a bad second. Anything measured against a person uses the unclamped
   *  clock — the same rule the sell-hold and the tutorial's panels follow. */
  let hitstop = 0;
  /** Seconds left of the camera punch. */
  let shake = 0;

  /** Stopped by the settings dialog. NOT the same as `running`, which is about
   *  whether the RUN is still going — a paused run is still a run, and a
   *  finished one must not come back to life when a dialog closes. */
  let paused = false;
  /** What `input.setEnabled` was before the pause took it away. The summary
   *  turns input off when the run ends, and a dialog opened on the summary must
   *  not hand the controls back on the way out. */
  let inputWasOn = true;
  let won = false;
  // Long enough to walk out of the doorway. A board's road can pass close to
  // the door — on Meadow the whole north strip is inside enemy range — so
  // arriving used to mean taking fire before the first tower was up, which is
  // damage for nothing the player did.
  let invincible = 4;
  /** Which tower kind the build button places, or NOTHING.
   *
   *  Starts empty, and tapping a cell that is already chosen empties it again.
   *  That is what makes the range ring explicable: it appears because you
   *  CHOSE something and goes when you un-choose it, so the circle on the
   *  ground is visibly about the bar at the bottom of the screen.
   *
   *  It used to start on the ballista, which meant a ring was on the grass from
   *  the first frame of every run with nothing on screen tying it to anything —
   *  and several people read it as the staff's blast radius. A default is also
   *  a decision the game makes for you and then charges you for. */
  let selected: number | null = null;
  /** The fork alternates, so both gates stay under pressure all wave. */
  let nextRoute = 0;
  let buildCell: [number, number] | null = null;
  /** The tower under the player's feet, if any — the thing `build` upgrades. */
  let standingOn: Tower | null = null;
  /** The tower currently shrinking under a sell-hold, so it can be put back the
   *  frame the thumb comes off — including the frame it is sold, when
   *  `standingOn` has already been cleared. */
  let sellHeld: Tower | null = null;

  interface Crate { obj: THREE.Object3D; t: number; hp: number; cell: [number, number]; rare: boolean; }
  /** At most one at a time: two stacked effects is a state nobody can read off
   *  a HUD line, and this game already asks you to watch four things. */
  let buff: { kind: BuffKind; left: number } | null = null;
  const crates: Crate[] = [];
  let crateTimer = CRATE_EVERY * 0.6;
  /** Whether the hero is standing at an unopened crate — a HUD line, so it is
   *  kept as state rather than recomputed inside the render. */
  let atCrate = false;
  /** The circle a tower can reach.
   *
   *  Range is the number that decides where a tower is worth putting, and it
   *  was invisible: you placed a catapult by guessing whether "4.2" covered the
   *  bend. Shown while you are standing on a tower or on a spot you could build
   *  on, and gone the moment you walk off — a board with eight range circles
   *  drawn on it permanently is a board you cannot see.
   */
  const rangeRing = new THREE.Mesh(
    new THREE.RingGeometry(0.965, 1, 72).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({
      color: 0xffffff, transparent: true, opacity: 0.55,
      // Over the ground, not fighting it: a hairline ring lying exactly on the
      // tiles z-fights into a dashed mess at this camera distance.
      depthWrite: false, side: THREE.DoubleSide,
    }),
  );
  rangeRing.visible = false;
  rangeRing.renderOrder = 2;
  world.scene.add(rangeRing);
  /** A filled disc under it, very faint, so the ring reads as an AREA rather
   *  than as a circle drawn on the grass. */
  const rangeFill = new THREE.Mesh(
    new THREE.CircleGeometry(1, 72).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.09, depthWrite: false }),
  );
  rangeFill.visible = false;
  rangeFill.renderOrder = 1;
  world.scene.add(rangeFill);
  /** Out at the edge of the cell, not against the tower.
   *
   *  0.42 to 0.5 was the first try and it was invisible: a tower's own base and
   *  the hero standing on top of it cover everything inside about half a cell.
   *  A tile is one unit across, so this is as wide as it can be and still read
   *  as belonging to that square. */
  const SELL_RING_IN = 0.56;
  const SELL_RING_OUT = 0.72;
  /** Deep red, not the gold everything else in this game uses for money.
   *
   *  Selling is the one DESTRUCTIVE thing a player can do on a board — the only
   *  action that takes something away — and it deserves the colour the rest of
   *  the interface never uses. Deep rather than bright: a signal-red ring on a
   *  cartoon green board reads as an error message, and this is a choice, not a
   *  mistake.
   *
   *  The sparks AFTER it are still gold. Red while you can still let go, gold
   *  once you have been paid — the two halves of the gesture are two different
   *  things and should not be the same colour. */
  const SELL_RED = 0xb0342c;

  /** The sell hold, drawn ROUND THE TOWER rather than in the corner.
   *
   *  It was six block characters in the prompt line at the top left, which is
   *  the far corner of the screen from both the thumb doing the holding and the
   *  tower being sold — a progress bar nobody looks at is a progress bar that
   *  does not exist. This one is where the thing is.
   *
   *  A RING that fills clockwise, not a bar: it wraps the object, so it says
   *  "this one" as well as "how far". Built once and re-swept by rebuilding its
   *  geometry, because `RingGeometry`'s arc is baked into the vertices —
   *  scaling or rotating cannot shorten it.
   */
  const sellRing = new THREE.Mesh(
    new THREE.RingGeometry(SELL_RING_IN, SELL_RING_OUT, 56, 1, Math.PI / 2, 0).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({
      color: SELL_RED, transparent: true, opacity: 0.92,
      depthWrite: false, side: THREE.DoubleSide,
    }),
  );
  sellRing.visible = false;
  sellRing.renderOrder = 4;
  world.scene.add(sellRing);
  /** The track behind it, so the empty part of the sweep is visible too. An
   *  arc with nothing behind it reads as a stray mark rather than as progress. */
  const sellTrack = new THREE.Mesh(
    new THREE.RingGeometry(SELL_RING_IN, SELL_RING_OUT, 56).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({
      // The UNFILLED part of the same red ring, not a black shadow: at 0.28
      // black over grass it read as the tower's own shadow, so the ring looked
      // like a red arc floating on nothing. A dark red needs to be carried at
      // a fairly high opacity to stay red — under about a half, green grass
      // pulls it olive and the two halves of the ring stop looking related.
      color: 0x6b2a24, transparent: true, opacity: 0.62,
      depthWrite: false, side: THREE.DoubleSide,
    }),
  );
  sellTrack.visible = false;
  sellTrack.renderOrder = 3;
  world.scene.add(sellTrack);

  /** The word, over the tower. A ring says how far; it does not say what is
   *  about to happen, and "the thing under me is about to be sold" is not
   *  something a player should have to infer from a shrinking model.
   *
   *  DOM projected onto the world point rather than a sprite: it is text, it
   *  has to stay legible at any camera distance, and a canvas texture of a word
   *  goes soft the moment the camera moves. `pointer-events: none` — this game
   *  has drawn over the platform's control layer five times. */
  const sellTag = document.createElement('div');
  // A handle a probe can find in one query. Walking the DOM for text starting
  // with "Sell" works and costs a full document scan per sample, which is
  // enough to turn a measured TAP into a hold.
  sellTag.dataset.sellTag = '1';
  sellTag.style.cssText = `position: fixed; z-index: 28; pointer-events: none;
    display: none; transform: translate(-50%, -100%);
    font: 800 13px/1 system-ui, sans-serif; letter-spacing: .04em; color: #fff;
    /* Carries the ring's red so the two read as one warning rather than as a
       label that happens to be near a coloured circle. */
    background: rgba(138,36,30,.78); padding: 5px 10px; border-radius: 999px;
    white-space: nowrap; text-shadow: 0 1px 2px rgba(0,0,0,.5);`;
  document.body.appendChild(sellTag);

  const _tagAt = new THREE.Vector3();
  /** Sweep the ring and place the word, or put both away. */
  const showSellHold = (t: Tower | null, k: number): void => {
    const on = t !== null && k > 0;
    sellRing.visible = on;
    sellTrack.visible = on;
    sellTag.style.display = on ? 'block' : 'none';
    if (!t || !on) return;
    const [x, z] = t.cell;
    sellRing.position.set(x, 0.05, z);
    sellTrack.position.set(x, 0.045, z);
    // Starts at the NEAR side and sweeps clockwise.
    //
    // Twelve o'clock is where a hold-to-confirm ring starts on a flat screen,
    // but this one is lying on the ground under a character, and twelve
    // o'clock on the ground is the FAR side — directly behind the hero, who is
    // standing on the tower. The first third of the sweep happened where
    // nobody could see it. After `rotateX(-90°)` the ring's local +Y points
    // away from the camera, so -90° is the edge nearest it.
    sellRing.geometry.dispose();
    // (inner, outer, thetaSegments, PHISEGMENTS, thetaStart, thetaLength). The
    // fourth argument is not the start angle, and leaving it out type-checks
    // perfectly — every parameter is a number.
    sellRing.geometry = new THREE.RingGeometry(
      SELL_RING_IN, SELL_RING_OUT, 56, 1, -Math.PI / 2 - k * Math.PI * 2, k * Math.PI * 2,
    ).rotateX(-Math.PI / 2);

    _tagAt.set(x, 0.35 + t.height + 0.55, z).project(world.camera);
    sellTag.textContent = `Sell  +${sellValue(t)}g`;
    sellTag.style.left = `${(_tagAt.x * 0.5 + 0.5) * window.innerWidth}px`;
    sellTag.style.top = `${(-_tagAt.y * 0.5 + 0.5) * window.innerHeight}px`;
  };

  const RING_RING_ALPHA = 0.9;
  const RING_FILL_ALPHA = 0.09;

  /**
   * What the square under your feet can reach.
   *
   * It used to be drawn any time the cell was buildable, which on a board with
   * sixty build spots means ALWAYS: a white circle following the hero
   * everywhere, with nothing on screen tying it to anything — several people
   * read it as the STAFF's blast radius rather than as a preview of a tower
   * that does not exist yet.
   *
   * It is tied to the hotbar instead. Nothing is selected when a run starts;
   * tapping a weapon selects it and tapping it again un-selects it, and the
   * ring is drawn exactly while something is selected. That makes the circle
   * EXPLICABLE — it appeared because you chose that, and it goes when you
   * un-choose it — which "it appears when you stop walking" never was.
   *
   * A tower you are standing ON is different and always shown: that is a real
   * object's real reach, not a hypothetical, and nobody mistakes it for a spell.
   */
  const showRange = (
    at: [number, number] | null, radius: number, colour: number,
  ): void => {
    const on = at !== null;
    rangeRing.visible = on;
    rangeFill.visible = on;
    if (!on || !at) return;
    rangeRing.position.set(at[0], 0.035, at[1]);
    rangeFill.position.set(at[0], 0.03, at[1]);
    rangeRing.scale.setScalar(radius);
    rangeFill.scale.setScalar(radius);
    const ringMat = rangeRing.material as THREE.MeshBasicMaterial;
    const fillMat = rangeFill.material as THREE.MeshBasicMaterial;
    ringMat.color.setHex(colour);
    fillMat.color.setHex(colour);
    ringMat.opacity = RING_RING_ALPHA;
    fillMat.opacity = RING_FILL_ALPHA;
  };

  /** Short-lived visual things. The camera is read fresh each frame because a
   *  billboard has to face wherever it IS, and in this game it turns under the
   *  player's thumb. */
  const vfx = new Vfx(world.scene, () => world.camera);
  /** One point light, kept in the scene and turned up when a spell lands.
   *  Adding a light recompiles every lit material; driving one does not. */
  const spellLamp = new THREE.PointLight(0x9fd0ff, 0, 7, 1.6);
  world.scene.add(spellLamp);
  let spellFlash = 0;
  const _muzzle = new THREE.Vector3();
  const _box = new THREE.Box3();
  const _mat = new THREE.Matrix4();
  /** How tall a model is in ITS OWN units, from the geometry.
   *
   *  Not `Box3.setFromObject`: on a skinned mesh that reports 1.64 where the
   *  thing on screen is 0.78, because it accounts for where the bones could
   *  put the vertices rather than where they are. A health bar placed from
   *  that number floats a metre over the boss's head. */
  const localTop = (root: THREE.Object3D): number => {
    root.updateWorldMatrix(true, true);
    const inv = _mat.copy(root.matrixWorld).invert();
    const rel = new THREE.Matrix4();
    let top = 0;
    root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh || !m.geometry) return;
      if (!m.geometry.boundingBox) m.geometry.computeBoundingBox();
      _box.copy(m.geometry.boundingBox!);
      // A SKINNED mesh's vertices do not go through its node transform at all —
      // they go through the bind matrix and the bones. Applying the node
      // transform anyway scaled the boss's height to 0.37 of what is drawn, and
      // hung its health bar around its waist.
      if (!(m as unknown as THREE.SkinnedMesh).isSkinnedMesh) {
        _box.applyMatrix4(rel.multiplyMatrices(inv, m.matrixWorld));
      }
      top = Math.max(top, _box.max.y);
    });
    return top;
  };
  const enemies: Enemy[] = [];
  /** Things playing their death animation. Off the enemy list — it is dead, and
   *  everything that iterates enemies would otherwise have to say so. */
  const towers: Tower[] = [];
  const shots: Shot[] = [];
  const bullets: Bullet[] = [];
  // Everything that can flash has to be LISTED here, because `updateTints` only
  // restores what it is given. Flashing something that is not on this list
  // leaves it that colour for the rest of the run — the gates went red on the
  // first leak and stayed red, which reads as damage you cannot repair.
  const tinted: THREE.Object3D[] = [hero];

  // --- HUD ---
  //
  // A BAR, not a row of hearts. Eight hearts meant a hit was always an eighth
  // of what you had; a bar can show a scratch, and it is the thing the whole
  // run is now decided by.
  const line1 = document.createElement('div');
  line1.style.cssText = 'display:flex; align-items:center; gap:8px;';
  const hpTrack = document.createElement('div');
  hpTrack.style.cssText = `position: relative; width: 168px; height: 13px; border-radius: 7px;
    background: rgba(0,0,0,.42); box-shadow: inset 0 0 0 2px rgba(255,255,255,.25);
    overflow: hidden;`;
  const hpFill = document.createElement('div');
  hpFill.style.cssText = 'height:100%; width:100%; border-radius:7px; transition: width .18s;';
  hpTrack.appendChild(hpFill);
  // NOT segmented. Notches were tried — a divider every 25 health, on the
  // argument that a percentage bar hides how much one hit costs. They read as
  // clutter on a 13px bar: four dark lines across the one element the eye goes
  // to when things are going badly. The bar says how much is left, which is
  // what it is for, and the colour says how worried to be.
  // No `100/100` either. A bar IS the number, and most games stop there; the
  // digits were a second reading of the same thing, in the most crowded corner
  // of the screen.
  // The armour, beside the bar, only when there is any. A stat with no readout
  // is a stat the player is asked to take on faith — and the Clinic's whole
  // problem before was that what it bought could not be seen.
  const armourEl = document.createElement('span');
  armourEl.dataset.armour = '';
  armourEl.style.cssText = 'display:none; align-items:center; gap:3px; font: 700 13px/1 system-ui;'
    + ' color:#9fd0ff;';
  line1.append(hpTrack, armourEl);

  // --- the mana bar, and the colour you are ------------------------------
  //
  // Second row, under the health. They are the two bars the run is decided by
  // and they are read in this order: health says whether you are in trouble,
  // mana says what you can do about it.
  //
  // The SWATCH sits at the end of the mana bar rather than anywhere else on
  // the screen, because "what colour am I" and "what can I spend" are the two
  // halves of the same question — mana only arrives in the colour you are
  // wearing.
  const manaLine = document.createElement('div');
  manaLine.style.cssText = 'display:flex; align-items:center; gap:8px; margin-top:5px;';
  const manaTrack = document.createElement('div');
  manaTrack.dataset.mana = '';
  manaTrack.style.cssText = `position: relative; width: 168px; height: 10px; border-radius: 5px;
    background: rgba(0,0,0,.42); box-shadow: inset 0 0 0 2px rgba(255,255,255,.25);
    overflow: hidden; transition: box-shadow .12s;`;
  const manaFill = document.createElement('div');
  manaFill.style.cssText = 'height:100%; width:0%; border-radius:5px;'
    + ' background: linear-gradient(90deg,#7a4dff,#c9a6ff); transition: width .14s;';
  manaTrack.appendChild(manaFill);
  /** The colour you are, as a disc. Not a word: `DARK` and `LIGHT` are two
   *  five-letter words that have to be READ, and this is a thing the player
   *  checks several times a second. A disc is checked without reading. */
  const poleDot = document.createElement('span');
  poleDot.dataset.pole = '';
  poleDot.style.cssText = `width:17px; height:17px; border-radius:9px; display:inline-block;
    flex: none; transition: background .12s, box-shadow .12s;`;
  manaLine.append(manaTrack, poleDot);

  /** Say NO, visibly. The button refusing in silence is the thing this game's
   *  own history says never to do — the staff's cooldown spent a build being
   *  mistaken for a broken button. */
  const flashMana = (): void => {
    manaTrack.style.boxShadow = 'inset 0 0 0 2px #ef4b4b';
    window.setTimeout(() => { manaTrack.style.boxShadow = 'inset 0 0 0 2px rgba(255,255,255,.25)'; }, 190);
  };
  const line2 = document.createElement('div');
  const line3 = document.createElement('div');
  line3.dataset.prompt = '1';
  line3.style.opacity = '0.85';
  // Gold lives in its own element because a coin flying to the counter needs a
  // rectangle to aim at, and "somewhere in that line of text" is not one.
  const buffEl = document.createElement('span');
  buffEl.dataset.buff = '';
  // Its OWN row, and it says what the effect DOES for as long as it lasts.
  //
  // It lived on line 2 as an icon and a countdown, on the grounds that the full
  // sentence there pushed the readout off a phone's screen — true, and the
  // answer is a row rather than an abbreviation. An icon and "12s" is a thing
  // the player has to have READ the banner to understand, and the banner is
  // gone in under three seconds: "it flashed, I missed it, and now there is a
  // coloured ring under my feet and I have no idea what it is."
  //
  // The plate collapses an empty row, so this costs nothing when nothing is
  // running.
  buffEl.style.cssText = 'display:none; align-items:center; gap:5px;'
    + ' font: 700 13px/1.5 system-ui, sans-serif;';
  const towerEl = document.createElement('span');
  const livesEl = document.createElement('span');
  const goldEl = document.createElement('span');
  const waveEl = document.createElement('span');
  goldEl.style.transition = 'transform 120ms ease-out';
  // ALL of them. The tower counter and the effect readout were created, had
  // their text set every frame, and were never put in the document — the same
  // shape of bug as a button rendered under the control layer, and just as
  // invisible from the code.
  line2.append(livesEl, goldEl, waveEl, towerEl);
  const buttons = document.createElement('div');
  buttons.style.cssText = 'display: flex; align-items: center; pointer-events: auto;';
  // The settings button used to be a mute switch — one control, all or nothing.
  // See `src/settings.ts` for why it became a dialog.
  const settings = createSettings({
    host: buttons,
    music: { get: () => audio.musicLevel, set: (v) => audio.setMusicVolume(v) },
    sfx: { get: () => audio.sfxLevel, set: (v) => audio.setSfxVolume(v) },
    save: () => void patchSave(umicat,
      { musicVolume: audio.musicLevel, sfxVolume: audio.sfxLevel }),
    pause: (on: boolean) => setPaused(on),
    leave: () => quitRun(),
  });
  // The BUTTONS stay outside the plate — they carry their own backgrounds, and
  // a plate behind them would be a panel with two holes in it.
  hudEl.append(readoutPlate(line1, manaLine, line2, buffEl, line3), buttons);

  const banner = document.createElement('div');
  banner.style.cssText = `
    position: fixed; left: 50%; top: 38%; transform: translate(-50%, -50%);
    text-align: center; color: #fff; font: 700 26px/1.4 system-ui, sans-serif;
    text-shadow: 0 3px 10px rgba(0,0,0,.6); display: none; pointer-events: auto;
    /* ABOVE the platform's touch layer, which is a full-screen z-index 10.
       Without this the Play Again button is underneath the move zone and
       tapping it does nothing at all — see CLAUDE.md. */
    z-index: 40;
  `;
  document.body.appendChild(banner);

  const hitFlash = document.createElement('div');
  hitFlash.style.cssText = `
    position: fixed; inset: 0; pointer-events: none; background: rgba(220,30,30,0);
    transition: background 120ms ease-out;
  `;
  document.body.appendChild(hitFlash);
  const flashScreen = (): void => {
    hitFlash.style.background = 'rgba(220,30,30,0.32)';
    setTimeout(() => { hitFlash.style.background = 'rgba(220,30,30,0)'; }, 120);
  };

  // --- Health bars ---
  //
  // Two unlit quads per enemy, billboarded, and shown only once something has
  // been chipped off. In the scene rather than the DOM: forty absolutely
  // positioned divs tracking projected world positions is the shape of problem
  // this game has already paid for once.
  const barBackGeom = new THREE.PlaneGeometry(0.46, 0.075);
  const barFillGeom = new THREE.PlaneGeometry(0.44, 0.055);
  const barBackMat = new THREE.MeshBasicMaterial({ color: 0x1a1a1a, transparent: true, opacity: 0.65, depthWrite: false });
  const barFillMat = new THREE.MeshBasicMaterial({ color: 0x4ade5b, depthWrite: false });
  const makeHealthBar = (): { group: THREE.Object3D; fill: THREE.Mesh } => {
    const group = new THREE.Object3D();
    group.visible = false;
    const back = new THREE.Mesh(barBackGeom, barBackMat);
    const fill = new THREE.Mesh(barFillGeom, barFillMat.clone());
    // Anchored left so shrinking it empties from the right, like every health
    // bar anyone has ever seen. A centred quad scales towards its middle and
    // reads as "getting further away".
    fill.geometry = barFillGeom.clone().translate(0.22, 0, 0);
    fill.position.x = -0.22;
    // 4mm of separation, not 1: a depth buffer spanning 0.1 to 500 has no
    // precision to spare at range, and a fill that z-fights its own backing
    // reads as a solid black bar.
    fill.position.z = 0.004;
    group.add(back, fill);
    return { group, fill };
  };

  const updateHealthBars = (): void => {
    for (const e of enemies) {
      if (!e.alive || !e.bar || !e.barFill) continue;
      const frac = Math.max(0, e.hp / e.maxHp);
      // ALWAYS up, full or not.
      //
      // The tower defense hid full bars on the grounds that a board of them is
      // noise and the interesting information is what is nearly dead. That was
      // right there and is wrong here, for a reason that has nothing to do
      // with clutter: in this game you pay MANA to attack, so "how much is
      // left of this one" is a question asked BEFORE committing to it, not
      // afterwards. A bar that appears only once you have already spent on it
      // answers too late to change anything.
      e.bar.visible = true;
      e.barFill.scale.x = frac;
      (e.barFill.material as THREE.MeshBasicMaterial).color.setHex(
        frac > 0.5 ? 0x4ade5b : frac > 0.25 ? 0xf5c542 : 0xe8483a);
      // Face the camera, cancelling whatever the parent is doing — a UFO spins,
      // and a bar welded to it spins out of readability.
      e.bar.quaternion.copy(world.camera.quaternion);
      e.obj.getWorldQuaternion(_q).invert();
      e.bar.quaternion.premultiply(_q);
    }
  };

  /** The staff's discharge: a ring that races out to the damage radius and a
   *  scatter of sparks.
   *
   *  The ring's size is the RANGE, not a decoration — it ends exactly where
   *  the damage does, so one cast teaches the radius better than any number
   *  in the HUD could. */
  const _burstAt = new THREE.Vector3();
  /** An orb going in — Balaboo's upgrade sparkle, at absorb frequency.
   *
   *  `updraft` is what a tower upgrade throws: a gold ring opening, and
   *  twelve sparkles rising off it. It is the right picture, because what it
   *  has always meant in this game is *you just gained something* — and that
   *  is exactly the statement an absorb has to make, in the same half-second
   *  and the same place as a HIT, which is the other thing a bullet reaching
   *  you can be.
   *
   *  **Tuned down, because of how often it runs.** An upgrade happens a few
   *  times a run; this happens several times a second on a busy board. At
   *  `updraft`'s own settings — 12 motes, 0.85s — five absorbs a second is
   *  ten live effects against a whole-board budget of about twenty draws.
   *  This project has made that mistake once already, with the burn's flame
   *  running per BURNING ENEMY rather than per cast, and the fix there was the
   *  same one: fewer, shorter. Seven motes at 0.5s, and the ring is the same
   *  single mesh.
   *
   *  It is GOLD, not the pole's colour. The orb that arrived was already the
   *  pole's colour and is still on screen the frame before; what this has to
   *  add is "and it paid you", which is what gold says here and has said
   *  since the tower defense. It also keeps the absorb unmistakably distinct
   *  from a hit, which is red, shakes the camera and flashes the screen.
   *
   *  The ring is drawn ON THE HERO rather than where the orb died: the point
   *  being made is that the thing arrived HERE. */
  const _absorbAt = new THREE.Vector3();
  const _pull = new THREE.Vector3();
  const absorb = (at: THREE.Vector3): void => {
    motes(vfx, at, {
      count: 7, color: 0xffc94d, color2: 0xfff2c4, frame: FRAME.sparkle,
      radius: 0.22, rise: 1.0, spin: 2.6, life: 0.5, size: 0.15,
    });
    _absorbAt.set(hero.position.x, 0.05, hero.position.z);
    ringVfx(vfx, _absorbAt, {
      color: 0xffe08a, from: ABSORB_RADIUS * 0.7, to: 0.14, life: 0.26, opacity: 0.7,
    });
  };

  const castBurst = (at: THREE.Vector3): void => {
    const t = kind.tint;
    // One effect per element, each its own ONE draw call — the same budget the
    // bolts have always had. Three elements that all throw lightning would be
    // one element in three colours; fire climbs and scorches, frost goes out
    // and holds, and the storm still strikes.
    const r = burstRadius();
    // On the GROUND, under the target — not at the target's own height. A burst
    // is an area effect, and casting it on a FLYING enemy put the scorch, the
    // rings and the crystals two metres up in the air where nothing could see
    // them. The bolts never showed this because they run sky-to-ground and
    // reach the floor whatever height they start from.
    const floor = _burstAt.set(at.x, 0, at.z);
    // These used to be about half a second each, which is long enough to SEE
    // and too short to watch. A cast is the loudest thing a staff does and it
    // was over before the eye had finished moving to it — and the lightning's
    // own sound does not reach its peak until 1.2s, so the bang was landing on
    // an empty patch of grass.
    if (kind.status === 'burn') flames(vfx, floor, { radius: r, color: t?.mote, life: 1.25 });
    else if (kind.status === 'chill') frost(vfx, floor, { radius: r, color: t?.mote, life: 1.2 });
    else lightning(vfx, floor, { radius: r, bolts: 5, life: 1.15 });
    motes(vfx, at, {
      count: 14, color: t?.mote ?? 0x6aa9ff, color2: t?.mote2 ?? 0xdceaff, frame: FRAME.sparkle,
      // Fire rises, ice settles. The same particles with a different rise read
      // as two different things happening, which is most of what an element is.
      radius: 0.7, rise: kind.status === 'chill' ? 0.5 : 1.7, spin: 3.4, life: 1.0, size: 0.24,
    });
    // A real light, for the quarter-second it is worth one. Its intensity is
    // driven rather than the light being added and removed — adding a light to
    // a three scene recompiles every lit material in it, which is a stutter
    // exactly when the screen is busiest.
    spellFlash = 1;
  };

  /** Draw the arc, and mark what it hit.
   *
   *  It used to draw only the landing — "a connected beam between two moving
   *  points needs a primitive this game does not have" — which meant the storm
   *  staff's whole point, that it LEAVES the burst and goes looking, had to be
   *  inferred from a sequence of flashes. `beam` quads are that primitive, and
   *  they take the enemies' own position vectors, so the arc stays joined while
   *  both ends keep flying.
   *
   *  One draw for the arc and one for the landing: a level-three storm staff
   *  makes three hops, and the budget for a whole level is about twenty. */
  const arc = (from: THREE.Vector3, to: THREE.Vector3): void => {
    arcBetween(vfx, from, to, { color: 0xa8d4ff, life: 0.32 });
    lightning(vfx, to, { radius: 0.42, bolts: 2, life: 0.45, height: 1.6 });
  };

  /** Leave the held staff's status on something it just hit.
   *
   *  Re-applying REFRESHES rather than stacks: two casts on the same enemy
   *  should mean it burns for longer, not that it burns twice as fast — stacking
   *  turns "cast it again" into the only tactic there is. The stronger chill
   *  wins, so a levelled staff is never worse than the cast before it.
   */
  const applyStatus = (e: Enemy): void => {
    const n = weaponEffect(weapon, weaponLevel);
    const secs = kind.effectSeconds ?? 0;
    if (kind.status === 'burn') {
      // Everything the player grows has to reach the burn, because the burn is
      // where fire's damage lives. The Range bonus reads "+1 damage on every
      // weapon", so it arrives as +1 TOTAL spread across the burn rather than
      // +1 per second, which would be three and a half times what the sword
      // gets for the same building. `withBuff` carries the player's level and
      // the double-strike crate for the same reason: a buff that doubled a
      // fire cast's one point of contact damage and left the fire alone would
      // be a buff that does nothing, on the weapon it looks biggest on.
      const dps = withBuff(n + bonus.heroDamage / Math.max(1, secs));
      e.burn = { dps: Math.max(dps, e.burn?.dps ?? 0), left: secs, tick: 0 };
      // Burning things LOOK burnt, for the same reason chilled things look
      // chilled: fire's whole identity is the damage that happens while you
      // are somewhere else, and a status only visible in the arithmetic is a
      // status nobody believes in. This was the one element that marked its
      // victims in no way at all.
      flashTint(e.obj, { color: 0xff4a10, ms: secs * 1000 });
    } else if (kind.status === 'chill') {
      e.chill = { mult: Math.min(n, e.chill?.mult ?? 1), left: secs };
      // Chilled things LOOK chilled, for as long as they are: a slow that is
      // only visible in the arithmetic is a slow nobody believes in.
      flashTint(e.obj, { color: 0x8fd8ff, ms: secs * 1000 });
    } else if (kind.status === 'chain') {
      // The storm leaves nothing behind — that is what makes it the burst
      // element rather than the lingering one — so the mark is short. It still
      // has to exist: fire and ice both said something about what they had hit
      // and lightning said nothing, which read as the arcs missing.
      //
      // 0.8s, not the 0.26 it started at. A quarter of a second is a mark you
      // find in a frame grab and miss while playing — a probe reading the state
      // 300ms after the cast already found it gone, which is the same question
      // an eye asks. Still four times shorter than a burn, so it reads as
      // struck rather than as a status.
      flashTint(e.obj, { color: 0xdcefff, ms: 800 });
    }
  };

  /** A flame lifting off something that is burning.
   *
   *  Alternate bites only (`puff` flips), and three tongues rather than
   *  thirteen: this runs per BURNING ENEMY rather than per cast, so a wave
   *  caught in one burst is ten of these at once against a whole-level budget
   *  of about twenty draws. `MAX_LIVE` is the backstop, but a backstop that is
   *  hit every fight is a design that gets its effects eaten at random. */
  let puff = false;
  const burnPuff = (e: Enemy): void => {
    puff = !puff;
    if (!puff) return;
    flames(vfx, _burstAt.set(e.obj.position.x, e.obj.position.y - 0.25, e.obj.position.z), {
      radius: 0.26, tongues: 3, color: 0xff6a2a, life: 0.55, decals: false,
    });
  };

  /** Light lifting off an upgraded tower.
   *
   *  In the scene rather than the DOM, because it has to sit in the world next
   *  to the tower it belongs to: a DOM flourish over the same pixels stops
   *  being attached to anything the moment the camera turns. */
  const updraft = (at: THREE.Vector3): void => {
    ringVfx(vfx, at, { color: 0xffe08a, from: 0.18, to: 0.5, life: 0.55, opacity: 0.9 });
    motes(vfx, at, {
      count: 12, color: 0xffc94d, color2: 0xfff2c4, frame: FRAME.sparkle,
      radius: 0.24, rise: 1.1, spin: 2.6, life: 0.85, size: 0.16,
    });
  };

  // --- The coin ---
  //
  // A real coin model, not a glyph in a div. It pops out of the kill, spins,
  // then flies to the counter in the corner — which it reaches by having the
  // HUD's own rectangle unprojected into the world each frame, so it tracks
  // the counter rather than a position guessed once at launch.
  //
  // Kept in 3D the whole way. The DOM version worked, but a coin that is an
  // element stops belonging to the scene the moment the camera moves, and a
  // handful of absolutely positioned emoji over a WebGL canvas is a shape this
  // game has already been burned by.
  /** An arrow the HERO fired. Flies straight and hits the first thing it
   *  crosses — same swept test as an enemy bullet, for the same reason. */
  interface Arrow {
    obj: THREE.Object3D; vel: THREE.Vector3; life: number;
    /** What fraction of a hit this arrow carries. A spread splits the shot
     *  rather than multiplying it — see `arrowShare`. Captured when it is
     *  loosed, because the tier can change while it is still in the air. */
    share: number;
  }
  const arrows: Arrow[] = [];
  const ARROW_SPEED = 11;
  /** What the held weapon hits for at its level, plus what the Range bought.
   *  A function, not a constant: the weapon is chosen before the level starts
   *  but the Range bonus and the weapon table both want to be read in one
   *  place, and a constant computed above `setWeapon` would be the wrong one. */
  /** What this weapon has learned THIS RUN. Zero at the door, gone at the end:
   *  nothing here is written to the save. */
  let runTier = 0;
  const weaponHit = (): number => weaponDamage(weapon, weaponLevel) + bonus.heroDamage
    + (kind.cast === 'melee' ? meleeBonusDamage(runTier)
      : kind.cast === 'burst' ? burstBonusDamage(runTier) : 0);
  const ARROW_LIFE = 1.6;
  const ARROW_HIT = 0.42;
  /** How far the bow finds a target on its own. Auto-aim, because picking a
   *  direction with a thumbstick while something circles you is not a skill
   *  anyone wants to practise — and because the lock frame makes the range a
   *  thing you can SEE rather than a number in a file. */
  const BOW_RANGE = 4.6;
  /** The staff hits everything around you at once, so it is on a real
   *  cooldown rather than just the animation's length. */
  const burstRadius = (): number => (kind.radius ?? 2.6) + burstRadiusBonus(runTier);
  /** Drag to place a spell. Built here, where the hero, the camera and the
   *  cast all are; it owns only the gesture and the two rings. */
  const aim = createAim({
    scene: world.scene,
    camera: world.camera,
    from: () => hero.position,
    reach: () => castReach(),
    radius: () => burstRadius(),
    enabled: () => aimsByDrag() && running,
    cast: (at) => heroAttack(at),
  });

  /** The sweep over the attack button while the staff recharges. The wait was
   *  already there and entirely invisible. */
  const dial = createCooldownDial(hudEl);

  /** Whether the weapon in hand is placed rather than pointed. */
  const aimsByDrag = (): boolean => kind.cast === 'burst';
  /** How many spells have actually left the staff. For probes. */
  let casts = 0;
  /** How far from the hero a placed spell may go.
   *
   *  Its own blast radius, twice over. Far enough that choosing a patch of
   *  ground is a real choice and not a nudge; short enough that the staff is
   *  still something you walk into position for rather than a turret. */
  const castReach = (): number => burstRadius() * 2;
  /** The on-screen attack button, found by the picture it is wearing. The SDK
   *  gives its controls no id; this is the same match the tutorial uses. */
  const attackButton = (): HTMLElement | null =>
    [...document.querySelectorAll<HTMLElement>('[data-umicat-touch] div')]
      .filter((d) => d.style.borderRadius === '50%')
      .find((d) => {
        const g = d.querySelector<HTMLElement>('span');
        const m = g ? (g.style.webkitMask || g.style.mask || '') : '';
        return m.includes(`${WEAPON_ICON[weapon] ?? ''}`.replace(/^.*\//, ''));
      }) ?? null;
  let staffCooldown = 0;
  let lockTarget: Enemy | null = null;
  /** Where the mouse is, in clip space, or null on a device without one.
   *
   *  Hovering picks the target on a desktop: the nearest enemy is a fine
   *  default and a poor decision, and a mouse is already an aiming device.
   *  Touch keeps the nearest-in-range default — cycling a lock with a thumb
   *  needs a gesture that is not yet decided, and inventing one badly is worse
   *  than the default. */
  let pointerNdc: THREE.Vector2 | null = null;
  const raycaster = new THREE.Raycaster();

  interface Pickup {
    obj: THREE.Object3D;
    kind: Material | 'health';
    amount: number;
    t: number;
    taken: boolean;
    vel: THREE.Vector3;
  }

  const pickups: Pickup[] = [];
  const POP_SECONDS = 0.55;     // the arc out of whatever dropped it

  /** Repaint a projectile so it cannot be mistaken for money.
   *
   *  Enemy bullets and dropped coins both travel towards the hero, and the
   *  kit's bullet is the same warm yellow as its coin — so the two things you
   *  most need to tell apart at a glance were the two hardest to. Magenta for
   *  the saucers, hot orange for the boss's boulder, and both emissive so they
   *  read against grass, snow and a dirt road alike.
   *
   *  Materials are SHARED between clones cut from one model, so each shot gets
   *  its own or repainting one repaints every bullet in the air — including the
   *  arrows the towers fire. */
  // --- the orb -------------------------------------------------------------
  //
  // A bullet is a SPHERE, and its colour is the only thing in this game the
  // player has to read correctly every single time. A sphere is the right
  // shape for that because it has no orientation: the kit's bullet is a capsule
  // that shows a different silhouette depending on which way it is flying, and
  // "which way is it pointing" is a second thing to decode at the moment there
  // is no time to decode anything.
  //
  // **Lit, like everything else on the board.** The first version was not, and
  // could not be: the poles were dark and light, value contrast is exactly
  // what light destroys, and holding them apart meant taking the lighting off
  // them. The result reads as a sticker laid over the scene — no shading, no
  // highlight, no relationship to the ground it is flying across.
  //
  // With the poles moved to HUE (see `POLE_LOOK`) that constraint is gone. A
  // shaded red ball is still red in shadow, so the material can be a real one.
  // `roughness` is kept low enough for a definite highlight, which is most of
  // what makes a sphere read as a sphere rather than as a circle.
  //
  // The emissive is what carries it through the darkest part of the board
  // without flattening it — a small amount, added to real shading, rather than
  // the flat fill that was there before.
  //
  // The SHELL stays, and is now a darker shade of the orb's own hue rather
  // than the opposite end of a value scale. It is doing a different job: not
  // "whichever half is losing contrast the other is winning it", but a plain
  // dark outline, which is what keeps a lit ball from dissolving into bright
  // grass at the moment it matters.
  // The kit's own cannonball (`weapon-ammo-ball`, a 0.28 sphere of 160
  // triangles), recoloured per pole — not a `SphereGeometry` built here.
  //
  // The generated sphere was smooth, and everything else on this board is
  // faceted: low-poly trees, low-poly tiles, a low-poly hero. A perfectly
  // smooth ball among them reads as something the game imported by accident,
  // which is most of what "the orbs still do not look right" was about. The
  // kit piece shades the same way as the ground it flies over because it is
  // made the same way.
  //
  // TWO prototypes, one per pole, each carrying its own cloned material —
  // every model in this kit points at the same shared `colormap`, so painting
  // one shot red would paint every projectile on the board red. (That exact
  // bug is in this project's history twice.) Each shot is a cheap clone of the
  // prototype it needs and touches no material at all.
  const orbProto: Record<Pole, THREE.Object3D> = { red: null!, blue: null! };
  for (const p of POLES) {
    const proto = cloneOf(ORB_MODEL);
    const look = POLE_LOOK[p];
    proto.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      const src = (Array.isArray(mesh.material) ? mesh.material[0] : mesh.material) as
        THREE.MeshStandardMaterial;
      const m = src.clone();
      // The map comes off: the cannonball's texel is a grey, and multiplying
      // a hue into it gives two muddy balls rather than a red one and a blue
      // one. The FACETS are the geometry, not the texture, so nothing about
      // the look this was chosen for is lost.
      m.map = null;
      m.color.setHex(look.body);
      m.emissive.setHex(look.glow);
      m.emissiveIntensity = 0.3;
      m.roughness = 0.55;
      m.metalness = 0;
      m.needsUpdate = true;
      mesh.material = m;
    });
    orbProto[p] = proto;
  }

  /** One bullet: a clone of the pole's prototype. Nothing is repainted per
   *  shot — the colour lives on the prototype's material. */
  /** The kit's own size, 0.28, and nothing added to it.
   *
   *  It was scaled up on the reasoning that this is the one object in the game
   *  that must be read correctly every time, so it should be a bigger target.
   *  Played, that is wrong in both directions: the generated sphere it
   *  replaced (0.32 with a 0.41 shell) was reported as too big, and a bullet
   *  that takes up more of the board is a board with less space to dodge in.
   *  Legibility here comes from HUE, which costs no area at all. */
  const makeOrb = (pole: Pole, scale = 1): THREE.Object3D => {
    const o = orbProto[pole].clone(true);
    o.scale.setScalar(scale);
    return o;
  };

  /** Put one orb in the air.
   *
   *  Spawned OUT IN FRONT rather than at the hull's centre: from the centre it
   *  could already be past the player, and at close range it crossed the gap
   *  faster than a frame — invisible damage for standing nearby, which is what
   *  the wind-up exists to replace. */
  const fireOrb = (
    from: THREE.Vector3, dir: THREE.Vector3, p: Pole,
    dmg: number, scale: number, speed: number,
  ): void => {
    const obj = makeOrb(p, scale);
    obj.position.copy(from).addScaledVector(dir, BULLET_MUZZLE);
    world.scene.add(obj);
    bullets.push({
      obj, vel: dir.clone().multiplyScalar(speed),
      life: BULLET_LIFE, damage: dmg, pole: p,
    });
  };

  /** Mark an ENEMY with the pole it shoots.
   *
   *  The bullets say it loudest, but a player who can only read the pole once
   *  a shot is in the air is always reacting. Reading it off the thing that is
   *  about to fire is what lets them choose a colour BEFORE the shot — which is
   *  the difference between dodging and collecting.
   *
   *  Emissive rather than base colour, and the emissive is the pole's GLOW
   *  rather than its body: a saucer repainted flat white is a saucer that has
   *  lost its own shading and reads as untextured. */
  const paintPole = (obj: THREE.Object3D, pole: Pole): void => {
    const look = POLE_LOOK[pole];
    obj.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      const paint = (m: THREE.Material): THREE.Material => {
        const c = (m as THREE.MeshStandardMaterial).clone() as THREE.MeshStandardMaterial;
        c.color.lerp(new THREE.Color(look.body), 0.72);
        c.emissive?.setHex(look.glow);
        c.emissiveIntensity = 0.42;
        return c;
      };
      mesh.material = Array.isArray(mesh.material) ? mesh.material.map(paint) : paint(mesh.material);
    });
  };

  const paintShot = (obj: THREE.Object3D, colour: number): void => {
    obj.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      const paint = (m: THREE.Material): THREE.Material => {
        const c = (m as THREE.MeshStandardMaterial).clone() as THREE.MeshStandardMaterial;
        c.color.setHex(colour);
        c.emissive?.setHex(colour);
        c.emissiveIntensity = 0.75;
        return c;
      };
      mesh.material = Array.isArray(mesh.material) ? mesh.material.map(paint) : paint(mesh.material);
    });
  };

  /** Drop something where a thing died. `amount` is the gold it is worth; a
   *  heart ignores it. */
  const dropPickup = (
    from: THREE.Vector3, amount: number, forceKind?: Material | 'health',
  ): void => {
    // Health only when some is missing — the same rule the crates follow, for
    // the same reason: a drop that does nothing is worse than a drop of gold.
    const kind = forceKind ?? rollDrop(heroHp < heroMaxHp);
    // `amount` arrives as the GOLD this kill was worth; the other kinds are
    // worth something else entirely. Wood and stone scale with it so that late
    // waves are worth walking to, but in ones and twos — a village priced in
    // hundreds of gold and dozens of planks needs planks to stay countable.
    const worth = kind === 'gold' ? amount
      : kind === 'health' ? HEAL_DROP
      : Math.max(1, Math.min(4, 1 + Math.floor(amount / 22)));
    const obj = spawnFrom(DROP_MODEL[kind]);
    const tint = DROP_TINT[kind];
    if (tint !== undefined) {
      // Its own copy of the material. Models cut from one file SHARE theirs, so
      // recolouring this one would recolour every crystal on the board,
      // scenery included.
      obj.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (!mesh.isMesh) return;
        const paint = (m: THREE.Material): THREE.Material => {
          const c = (m as THREE.MeshStandardMaterial).clone() as THREE.MeshStandardMaterial;
          c.color.setHex(tint);
          c.emissive?.setHex(0x51101d);
          return c;
        };
        mesh.material = Array.isArray(mesh.material)
          ? mesh.material.map(paint) : paint(mesh.material);
      });
    }
    obj.position.copy(from);
    obj.position.y = Math.max(from.y, 0.2);
    obj.scale.setScalar(kind === 'gold' ? 0.55 : kind === 'health' ? 0.5 : 0.42);
    pickups.push({
      obj, kind, amount: worth, t: 0, taken: false,
      // Up and slightly outward, so several from one kill do not stack.
      vel: new THREE.Vector3((Math.random() - 0.5) * 1.1, 2.2, (Math.random() - 0.5) * 1.1),
    });
  };

  /** Drop a crate somewhere in the back field that is free right now. */
  const dropCrate = (forceRare?: boolean): void => {
    const taken = new Set(crates.map((c) => `${c.cell[0]},${c.cell[1]}`));
    const free = BACKFIELD.filter((c) => !taken.has(`${c[0]},${c[1]}`));
    if (!free.length) return;
    const cell = free[Math.floor(Math.random() * free.length)];
    const rare = forceRare ?? Math.random() < RARE_CRATE_CHANCE;
    // Barrels and crates both, so the field does not look like a warehouse —
    // and something obviously different for the rare one, because "is that
    // worth crossing the board for" has to be answerable from across the board.
    const obj = spawnFrom(rare ? 'td-tower-round-crystals'
      : Math.random() < 0.5 ? 'hub-crate' : 'hub-barrel');
    obj.position.set(cell[0], 0, cell[1]);
    obj.rotation.y = Math.random() * Math.PI * 2;
    if (rare) obj.scale.setScalar(0.85);
    crates.push({ obj, t: 0, hp: rare ? 3 : 2, cell, rare });
    tinted.push(obj);
  };

  /** A ring under the hero for as long as an effect is running.
   *
   *  The banner says what it does, once. This says THAT IT IS STILL ON, for the
   *  whole twenty seconds, in the place the player is already looking — which
   *  the corner badge does not: an icon and a countdown at the top of the
   *  screen is something you have to go and read.
   *
   *  Its own mesh, shown and hidden rather than made and thrown away: it lives
   *  for twenty seconds at a time and `vfx` is for things that are gone in
   *  under one. */
  const buffRing = new THREE.Mesh(
    new THREE.RingGeometry(0.34, 0.44, 40).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({
      color: 0xffffff, transparent: true, opacity: 0.8,
      side: THREE.DoubleSide, depthWrite: false,
    }),
  );
  buffRing.visible = false;
  buffRing.renderOrder = 3;
  world.scene.add(buffRing);

  /** Anything the hero swings at, shoots or blasts also breaks crates. Called
   *  from all three weapons rather than folded into `damage`, because a crate
   *  is not an enemy: towers ignore it, it does not walk, and giving it an
   *  Enemy record would mean every loop over enemies having to say so. */
  /** A rare crate's one-shot effects.
   *
   *  Separate from the timed ones because they are a different KIND of thing
   *  to the player: a buff is something you now have and must spend well
   *  before it runs out, and this is something that has already happened. A
   *  countdown on it would be counting down nothing. */
  const takeInstant = (kind: BuffKind): void => {
    if (kind.id !== 'wipe') return;
    // Killed, not deleted. Going through `damage()` is what pays the mana,
    // counts the kills, scores them and plays each one coming apart — a
    // board that simply stops containing enemies reads as a bug, and pays
    // nothing for the best crate in the game.
    for (const e of [...enemies]) {
      if (!e.alive) continue;
      damage(e, e.hp + 1);
    }
    // And the orbs in the air with them. Leaving a screenful of the wrong
    // colour behind is a "clear the board" that does not clear the board —
    // and the thing the player pressed it to escape is the bullets, not the
    // things that fired them.
    for (const bu of bullets) world.scene.remove(bu.obj);
    bullets.length = 0;
    shake = Math.max(shake, 0.12);
    flashScreen();
  };

  const hitCrates = (x: number, z: number, radius: number, amount: number): boolean => {
    let struck = false;
    for (const c of crates) {
      if (c.hp <= 0) continue;
      if (Math.hypot(c.obj.position.x - x, c.obj.position.z - z) > radius + 0.35) continue;
      struck = true;
      c.hp -= amount;
      flashTint(c.obj, { color: 0xffe08a, ms: 140 });
      if (c.hp > 0) { audio.play('hit-enemy'); continue; }
      if (c.rare) {
        // A rare one always pays an effect, and always a DIFFERENT one from
        // whatever is running — rerolling into the buff you already have is a
        // crate that paid nothing.
        const pool = BUFFS.filter((k) => k.id !== buff?.kind.id);
        const kind = pool[Math.floor(Math.random() * pool.length)];
        if (kind.instant) takeInstant(kind);
        else buff = { kind, left: BUFF_SECONDS };
        flashBanner(kind.label, kind.badge, 2600);
        audio.play(SFX.buffPickup);
        flashTint(hero, { color: 0xffd45e, ms: 500 });
        renderHud();
        c.obj.visible = false;
        continue;
      }
      // What was in it. A heart only when one is missing: a crate that pays
      // nothing is a worse crate than one that pays gold.
      const wantHeart = heroHp < heroMaxHp && Math.random() < CRATE_HEART_CHANCE;
      if (wantHeart) {
        // Dropped, not granted. Nothing in this game pays itself in any more —
        // what a crate holds is on the ground next to it until you take it.
        dropPickup(c.obj.position, HEAL_CRATE, 'health');
      } else {
        const amount = CRATE_GOLD[0] + Math.floor(Math.random() * (CRATE_GOLD[1] - CRATE_GOLD[0] + 1));
        dropPickup(c.obj.position, amount, 'gold');
      }
      audio.play('enemy-die');
      c.obj.visible = false;
    }
    return struck;
  };

  /** Pops, lands, waits, then comes to you if you come near enough.
   *
   *  Nothing is credited until it is TAKEN. That is the whole change: the money
   *  is on the board with you rather than in the corner of the screen, so a
   *  fight in the far lane is a fight you have to walk back through.
   */
  const updatePickups = (dt: number): void => {
    for (let i = pickups.length - 1; i >= 0; i--) {
      const q = pickups[i];
      q.t += dt;
      q.obj.rotation.y += dt * (q.kind === 'gold' ? 7 : 2.4);

      const dx = hero.position.x - q.obj.position.x;
      const dz = hero.position.z - q.obj.position.z;
      const dist = Math.hypot(dx, dz);

      if (q.t < POP_SECONDS) {
        // The pop: a real little arc, under its own gravity.
        q.vel.y -= 6 * dt;
        q.obj.position.addScaledVector(q.vel, dt);
        if (q.obj.position.y < 0.2) { q.obj.position.y = 0.2; q.vel.set(0, 0, 0); }
      } else if (dist < MAGNET_RADIUS) {
        // Pulled in, and faster the closer it gets — a constant speed reads as
        // the coin walking towards you.
        const pull = 3.2 + (1 - dist / MAGNET_RADIUS) * 9;
        q.obj.position.x += (dx / (dist || 1)) * pull * dt;
        q.obj.position.z += (dz / (dist || 1)) * pull * dt;
        q.obj.position.y = 0.2 + Math.sin(q.t * 9) * 0.04;
      } else {
        q.obj.position.y = 0.2 + Math.sin(q.t * 2.6) * 0.06;
      }

      // Taken.
      if (!q.taken && dist < 0.5 && q.t > 0.25) {
        q.taken = true;
        if (q.kind === 'health') {
          heroHp = Math.min(heroMaxHp, heroHp + q.amount);
          pickedUp += 1;
          audio.play('coin');
          flashTint(hero, { color: 0xff5f7a, ms: 260 });
        } else {
          earned[q.kind] += q.amount;
          pickedUp += 1;
          // A gold crate pays MANA now. Gold has no source and no use in this
          // game — the town is gone and nothing sells anything — so a crate
          // that paid it was a crate that paid nothing, which is worse than a
          // crate that is not there. The one resource is the one resource.
          if (q.kind === 'gold') {
            gainMana(q.amount);
            goldEl.style.transform = 'scale(1.22)';
            setTimeout(() => { goldEl.style.transform = 'scale(1)'; }, 120);
          }
          audio.play('coin');
              flashBanner(`+${q.amount}`, MATERIAL_ICON[q.kind]);
        }
        renderHud();
        world.scene.remove(q.obj);
        pickups.splice(i, 1);
        continue;
      }

      // Gone, if nobody came. It flashes first — a drop that simply vanishes
      // looks like a bug, and a board that slowly fills with coins nobody
      // picked up is worse than either.
      if (q.t > PICKUP_LIFE) {
        world.scene.remove(q.obj);
        pickups.splice(i, 1);
      } else if (q.t > PICKUP_LIFE - PICKUP_BLINK) {
        q.obj.visible = Math.floor(q.t * 8) % 2 === 0;
      }
    }
  };

  // --- The hotbar ---
  //
  // A cycle button worked on a phone and left desktop with no way to place
  // anything at all: the on-screen controls only exist on touch devices, so
  // `🔨` and `⇄` simply were not there, and the keyboard bindings were a
  // secret. A row of cells you click is the same control for both, and it
  // shows all four towers and their prices at once instead of one at a time.
  //
  // Number keys too, because on a desktop reaching for the mouse to change
  // weapon is the thing hotbars exist to avoid.
  const hotbar = document.createElement('div');
  hotbar.style.cssText = `
    /* The left offset is set in px by placeHotbar, which centres the bar only
       when centred fits beside the platform's buttons. (No backticks in here:
       this is a template literal, and one closes it.) */
    position: fixed; left: 0; bottom: 14px;
    display: flex; gap: 6px; z-index: 30;
    /* NONE on the row, AUTO on the cells. The row is as wide as the screen and
       mostly empty; taking pointer events on it swallowed everything behind. */
    pointer-events: none;
    /* One row, always. It wrapped when the smithy took it from four cells to
       seven — and a wrapped hotbar on a 390-wide phone is a block in the middle
       of the screen sitting on top of the platform's thumbstick, at which point
       you cannot walk. Fifth time something of this game's has landed on top of
       the control layer; the cells get narrower instead. */
    flex-wrap: nowrap; justify-content: center; max-width: 96vw;
    font: 600 12px/1.25 system-ui, sans-serif; color: #fff;
  `;
  document.body.appendChild(hotbar);

  /** Keep the hotbar out of the platform's buttons, by MEASURING them.
   *
   *  The first attempt was `bottom: calc(50vmin + 12px)` on touch devices,
   *  reasoned from the SDK's own vmin units. On a landscape phone vmin is the
   *  HEIGHT, so that put the hotbar halfway up the screen — and the layout
   *  probe ran in portrait, where the same expression is fine. The game is
   *  played in landscape.
   *
   *  Arithmetic about someone else's CSS is a guess. Their rectangle is a
   *  fact, so: sit at the bottom, and only climb if that actually collides. */
  const CELL_MIN = 40;
  const CELL_MAX = 62;
  const CELL_GAP = 6;
  const EDGE = 8;
  /** The towers, plus the weapon's own cell at the end. */
  const barCells = (): number => KINDS.length + 1;
  const barWidth = (cell: number): number =>
    barCells() * cell + (barCells() - 1) * CELL_GAP;

  /**
   *  MOVE SIDEWAYS, then shrink, and only climb if neither worked.
   *
   *  This used to climb, full stop — and climbing is the wrong first answer,
   *  because the cluster of buttons WRAPS. Clearing the bottom row lands you in
   *  the row above it, so the bar goes from the bottom of the screen to halfway
   *  up in one step. It did exactly that the day the smithy took the hotbar
   *  from four cells to seven: the wider bar overlapped the buttons by about
   *  thirteen pixels, and the remedy was a two-hundred-pixel jump.
   *
   *  Sideways costs nothing. The left half of the screen belongs to the
   *  thumbstick ZONE, which is not a thing a hotbar can collide with — it is
   *  half the screen and it has no edges — so there is almost always room to
   *  slide. The bar stays centred whenever centred FITS, which is the case
   *  this was fine in all along.
   */
  const placeHotbar = (): void => {
    hotbar.style.bottom = '14px';
    hotbar.style.transform = 'none';

    const layer = document.querySelector('[data-umicat-touch]');
    const controls = layer
      ? [...layer.querySelectorAll('div')]
        .filter((d) => getComputedStyle(d).pointerEvents === 'auto')
        .map((d) => d.getBoundingClientRect())
        // The move and look zones are half the screen each; they are not what a
        // hotbar can collide with in any useful sense.
        .filter((r) => r.height < window.innerHeight * 0.5 && r.width > 10)
      : [];
    // The buttons sit bottom-right, so what limits the bar is their left edge.
    const wall = controls.length
      ? Math.min(...controls.map((r) => r.left)) - EDGE
      : window.innerWidth - EDGE;
    const room = Math.max(0, wall - EDGE);

    // Widest cells that fit the room, then the screen, then the cap.
    const n = barCells();
    const cell = Math.max(CELL_MIN, Math.min(CELL_MAX,
      Math.floor((Math.min(room, window.innerWidth * 0.96) - (n - 1) * CELL_GAP) / n)));
    for (const c of hotbar.children) (c as HTMLElement).style.width = `${cell}px`;
    pad?.setCellSize(cell);
    const w = barWidth(cell);

    // Centred if it fits; otherwise slid left until it does.
    let left = Math.round((window.innerWidth - w) / 2);
    if (left + w > wall) left = Math.round(wall - w);
    left = Math.max(EDGE, left);
    hotbar.style.left = `${left}px`;

    // Only now, and only if it STILL overlaps — which means even the narrowest
    // cells do not fit beside the buttons, on a screen that small.
    if (!controls.length) return;
    for (let pass = 0; pass < 4; pass++) {
      const bar = hotbar.getBoundingClientRect();
      const hits = controls.filter((r) =>
        r.left < bar.right && r.right > bar.left && r.top < bar.bottom && r.bottom > bar.top);
      if (!hits.length) return;
      const highest = Math.min(...hits.map((r) => r.top));
      hotbar.style.bottom = `${Math.round(window.innerHeight - highest) + 10}px`;
    }
  };
  // Called after the cells exist, further down — an empty bar measures zero by
  // zero and collides with nothing, which is why the first version of this
  // silently did nothing at all.
  window.addEventListener('resize', placeHotbar);
  // Rotating the phone changes which dimension is which; re-measure rather
  // than hope the first answer still holds.
  window.addEventListener('orientationchange', () => setTimeout(placeHotbar, 250));

  // No weapon picker here. What you walked in carrying is what you fight with:
  // the choice is made in the hub, at the pedestals, and a run you can re-arm
  // halfway through is a run where the choice never cost anything.
  const cells = KINDS.map((kind, i) => {
    const cell = document.createElement('button');
    // Which slot this is, so a probe driving the tutorial can press the one the
    // script is pointing at rather than guessing from the text inside it.
    cell.dataset.slot = String(i);
    // A starting width only. `placeHotbar` sets the real one, from the room
    // that is actually left beside the platform's buttons.
    cell.style.cssText = `
      width: ${CELL_MAX}px; padding: 6px 3px 5px; border-radius: 12px; border: 2px solid transparent;
      pointer-events: auto;
      background: rgba(0,0,0,.42); color: #fff; font: inherit; cursor: pointer;
      display: flex; flex-direction: column; align-items: center; gap: 2px;
      -webkit-tap-highlight-color: transparent;
    `;
    // A PICTURE and a price. Nothing else.
    //
    // No name: the corner prompt already says what you are standing on and
    // what it costs, in full, and repeating it in a 40px cell only clips it.
    // No shortcut number: there is no keyboard on a phone, and this is a
    // casual game that does not ask for fast hands.
    //
    // The picture is the MODEL, rendered at boot — see `src/thumbs.ts`. It was
    // an emoji, which is a different drawing in every platform's font, is never
    // the thing you are about to place (the bastion is a cannon on masonry; the
    // glyph was a Japanese castle), and goes stale in silence when a model
    // changes.
    cell.innerHTML =
      `<img alt="${kind.label}" style="width:76%;aspect-ratio:1;object-fit:contain;display:block">`
      + `<span class="cost" style="opacity:.85">${kind.cost}g</span>`;
    // Tap to choose, tap again to un-choose.
    cell.onclick = () => {
      // While the script is on a step that names one weapon, the others do
      // nothing. Silently, rather than with a refusal: there is an instruction
      // on screen saying which one, and arguing with it is not a conversation
      // worth having.
      if (onlyKind !== null && i !== onlyKind) { audio.play('denied'); return; }
      selected = selected === i ? null : i;
      refreshHotbar(); audio.play('build'); renderHud();
    };
    hotbar.appendChild(cell);
    return cell;
  });

  /** The weapon's own cell, at the end of the hotbar.
   *
   *  The row is already "things you buy with this run's gold, with the price on
   *  the cell" — so the weapon joins it rather than inventing a place to be
   *  upgraded from. Tapping a tower cell CHOOSES; tapping this one SPENDS, and
   *  it is told apart by being the weapon rather than a tower, by its price
   *  being the only thing that changes, and by the pips above it.
   *
   *  It replaces the desktop-only readout that used to sit in the action pad:
   *  one weapon cell, in the same place on both machines, with the recharge
   *  drawn on it.
   *
   *  The walk is missing, and that is known. Upgrading a TOWER costs gold and
   *  POSITION — you have to be standing on it — and this costs gold alone, from
   *  wherever you are. The price carries the whole of that difference, which is
   *  why a tier is several towers' worth.
   */
  const weaponCell = document.createElement('button');
  weaponCell.dataset.weaponCell = '';
  weaponCell.style.cssText = `
    width: ${CELL_MAX}px; padding: 6px 3px 5px; border-radius: 12px;
    border: 2px dashed rgba(255,255,255,.22); pointer-events: auto;
    background: rgba(0,0,0,.42); color: #fff; font: inherit; cursor: pointer;
    display: flex; flex-direction: column; align-items: center; gap: 2px;
    -webkit-tap-highlight-color: transparent; position: relative;
  `;
  hotbar.appendChild(weaponCell);

  const drawWeaponCell = (): void => {
    const cast = kind.cast;
    const cost = nextTierCost(cast, runTier);
    weaponCell.textContent = '';
    const g = icon(weapon as IconName, '52%');
    g.style.aspectRatio = '1';
    weaponCell.append(g);
    // What it has learned, as pips. A number would be a level competing with
    // the weapon's OWN level from the Armory, and they are different things.
    const pips = document.createElement('div');
    pips.style.cssText = 'display:flex; gap:3px; height:4px; align-items:center;';
    for (let i = 0; i < MAX_RUN_TIER; i++) {
      const d = document.createElement('div');
      d.style.cssText = `width:4px; height:4px; border-radius:2px;`
        + `background:${i < runTier ? '#8fe3ff' : 'rgba(255,255,255,.26)'};`;
      pips.append(d);
    }
    weaponCell.append(pips);
    // What a HIT costs, not what the next upgrade costs.
    //
    // It read `34g` — the upgrade price, in gold. Gold has no source and no
    // use in this game, and upgrading is not done here any more: it is in the
    // spend panel, priced in magic. So the cell was quoting a currency that
    // does not exist for an action that happens somewhere else.
    //
    // What belongs on the weapon you are holding is what pressing attack will
    // take off the bar, which is the number the player is deciding on several
    // times a minute.
    const price = document.createElement('span');
    price.style.cssText = 'opacity:.85; font: 600 12px/1.25 system-ui;';
    price.textContent = `${MANA_PER_ATTACK[cast]}`;
    weaponCell.append(price);
    // Dimmed when you cannot afford to swing. The cell is a readout, so this
    // is the one place the refusal can be seen BEFORE pressing.
    weaponCell.style.opacity = mana < MANA_PER_ATTACK[cast] ? '0.45' : '1';
    weaponCell.style.cursor = 'default';
    weaponCell.title = cost === null
      ? 'Nothing left to learn this run'
      : RUN_TIERS[cast][runTier].label;
  };

  weaponCell.onclick = () => {
    // The script locks the bar on its last step; the weapon is part of the bar.
    if (!running || onlyKind !== null) { audio.play('denied'); return; }
    const cost = nextTierCost(kind.cast, runTier);
    if (cost === null || gold < cost) { audio.play('denied'); return; }
    gold -= cost;
    runTier += 1;
    paintBlade();
    const label = tierLabel(kind.cast, runTier);
    if (label) flashBanner(label, 'upgrade');
    audio.play('upgrade');
    drawWeaponCell();
    refreshHotbar();
    renderHud();
  };

  /** The controls a desktop has to be given, because the SDK draws none.
   *
   *  A place button (click it, or hold it to sell) and a weapon readout with
   *  the recharge over it, bottom-right — the corner the platform's own buttons
   *  occupy on a phone, so the two devices share one picture. */
  const pad = touchLikely() ? null : createActionPad({
    key: 'Space',
    // Through the SDK's own latch, so a click, a hold, the dead zone and the
    // sell ring all mean here exactly what they mean for the key and the thumb.
    press: () => input.press(PLACE_KEY),
    release: () => input.release(PLACE_KEY),
  });
  const drawWeaponChip = (): void => drawWeaponCell();
  paintBlade();

  // Photograph each tower once, now that the models are loaded.
  //
  // A MOUNT is photographed on its masonry. The first version rendered the
  // weapon alone, reasoning that at 40px across the stone would be most of the
  // picture and the gun a speck on top — and the result was that the ballista
  // and the watchtower, and the cannon and the bastion, were the same picture
  // at 25g and at 120g. The stone is exactly what tells them apart, which is
  // why it costs four times as much.
  {
    const thumbs = createThumbMaker(renderer);
    KINDS.forEach((kind, i) => {
      const img = cells[i].querySelector('img');
      if (!img) return;
      try {
        const shot = new THREE.Group();
        let y = 0;
        if (kind.mount === 'tower' && kind.stack?.length) {
          // One section, not the whole stack: this is what you are buying, and
          // what you are buying is a level-one tower.
          const base = cloneOf(kind.stack[0]);
          shot.add(base);
          y = pieceHeight(kind.stack[0]);
        }
        const gun = cloneOf(kind.model);
        gun.position.y = y;
        shot.add(gun);
        img.src = thumbs.make(shot);
      } catch {
        // A picture is decoration; a level that will not start is not. If the
        // render fails on some driver, the cells keep their price and their
        // colour and the game is entirely playable.
      }
    });
    thumbs.dispose();
  }

  function refreshHotbar(): void {
    drawWeaponCell();
    cells.forEach((cell, i) => {
      const affordable = gold >= KINDS[i].cost;
      // A rim rather than nothing: the bar reads as a row of chips, and the
      // chosen one differs by the COLOUR of its edge rather than by having one.
      cell.style.borderColor = i === selected ? '#ffd54a' : 'rgba(255,255,255,.22)';
      cell.style.background = i === selected ? 'rgba(0,0,0,.62)' : 'rgba(0,0,0,.42)';
      // Dimmed rather than disabled: you can still select what you are saving
      // up for, and the price is the feedback.
      cell.style.opacity = affordable ? '1' : '0.45';
    });
  }

  placeHotbar();

  window.addEventListener('keydown', (e) => {
    const n = Number(e.key);
    if (n >= 1 && n <= KINDS.length) {
      selected = selected === n - 1 ? null : n - 1;
      refreshHotbar(); renderHud();
    }
  });

  /** The one line of prompt, as a shape and some words. */
  const prompt = (glyph: IconName | null, text: string): void => {
    line3.textContent = '';
    // Collapsed when there is nothing to say. Empty, it was an invisible blank
    // line; inside a panel it is a stripe of padding with nothing in it.
    line3.style.display = glyph || text ? 'block' : 'none';
    if (glyph) {
      // A KEY on a machine that has no on-screen buttons.
      //
      // The SDK mounts its controls only where there is a touch screen, so on a
      // desktop every one of these icons was a picture of a button that is not
      // anywhere — "⟨build⟩ Ballista · 25g" with nothing to press. Reported as
      // "I picked a weapon with the mouse and cannot place it", which is
      // exactly what it looks like.
      // A key cap for a key, the word for a mouse click, and the button's own
      // picture only where there is one. The crate prompt used to draw a sword
      // icon on a desktop, which is a picture of a control that is not there.
      const press = pressFor(glyph);
      if (press.kind === 'key') line3.append(keyCap(press.key));
      else if (press.kind === 'click') line3.append(keyCap('Click'));
      else line3.append(icon(glyph, HUD_ICON));
    }
    line3.append(document.createTextNode(text));
  };

  /** Icons in the HUD run a little larger than the text beside them. A
   *  silhouette needs more room than a letter of the same nominal size. */
  const HUD_ICON = '1.25em';

  const renderHud = (): void => {
    const frac = Math.max(0, heroHp) / heroMaxHp;
    hpFill.style.width = `${(frac * 100).toFixed(1)}%`;
    // Green down to amber down to red: the colour is the warning, because at a
    // glance nobody reads a number on a bar.
    hpFill.style.background = frac > 0.55 ? '#5fd36a' : frac > 0.28 ? '#f0b429' : '#ef4b4b';
    // The LEVEL, not the points. "Six armour" is a tuning figure; what the
    // player set in the village is a level, and that is what they recognise.
    if (armour > 0 && !armourEl.childNodes.length) {
      armourEl.append(icon('shield', '13px'),
        document.createTextNode(String(Math.round(armour / ARMOUR_PER_LEVEL))));
      armourEl.style.display = 'inline-flex';
    }
    // Shapes, and the base's own MAXIMUM alongside it. `10` on its own does not
    // say whether it is climbing or falling, and this is the number the run
    // ends on — it was quieter than the gold beside it.
    // 1.25em, not 1em. A silhouette needs more room than a letter of the same
    // nominal size — at 1em the tower's rook read as a small white square.
    manaFill.style.width = `${(Math.max(0, mana) / MANA_MAX * 100).toFixed(1)}%`;
    {
      const look = POLE_LOOK[pole];
      // The swatch is the pole's BODY colour with its rim around it — the same
      // two colours the orbs wear, so the disc in the corner and the thing
      // flying at you are recognisably the same statement.
      poleDot.style.background = `#${look.body.toString(16).padStart(6, '0')}`;
      poleDot.style.boxShadow = `0 0 0 2.5px #${look.rim.toString(16).padStart(6, '0')}`;
    }
    // The SCORE, where the gold used to be. Same corner, same shape, and the
    // number the run is actually about.
    setIconText(goldEl, 'award', ` ${score}`, HUD_ICON);
    // No tower counter. Nothing is built.
    towerEl.style.display = 'none';
    buffEl.textContent = '';
    buffEl.style.display = buff ? 'flex' : 'none';
    if (buff) {
      // The same colour as the ring under the hero, so the words and the mark
      // on the ground are obviously the same thing.
      buffEl.style.color = `#${buff.kind.color.toString(16).padStart(6, '0')}`;
      buffEl.append(icon(buff.kind.badge, HUD_ICON),
        document.createTextNode(`${buff.kind.label} · ${Math.ceil(buff.left)}s`));
    }
    // A PROMPT, not narration. This line is empty unless the player is standing
    // somewhere the button does something, and then it is three or four words.
    // A sentence explaining the game that is on screen the whole time is a
    // sentence nobody reads twice and everybody looks past.
    if (standingOn) {
      const t = standingOn;
      // ONE line. Selling used to be named here too, on the argument that a
      // hold is invisible until something names it — but the teaching board
      // teaches it now, once, and a permanent second line reminding you of a
      // gesture you already know is the wall of explanatory text this game
      // took off the screen in the first place.
      //
      // The price still appears before you commit to it: it is on the label
      // over the tower, which shows up as soon as the hold arms.
      if (t.level >= MAX_LEVEL) prompt(null, `${t.kind.label} Lv${MAX_LEVEL} · max`);
      else prompt('upgrade', ` Lv${t.level + 1} · ${upgradeCost(t)}g`);
    } else if (atCrate) {
      prompt('sword', ' break open');
    } else if (buildCell) {
      if (selected === null) prompt(null, 'Choose a weapon from the bar');
      else prompt('build', ` ${KINDS[selected].label} · ${KINDS[selected].cost}g`);
    } else {
      prompt(null, '');
    }
    refreshHotbar();
    showActionIcon();
  };

  /** The button says what it will DO, right now.
   *
   *  It is one button doing three things, and which one depends on where you
   *  are standing: an empty square builds, your own weapon upgrades, and
   *  holding it sells. Wearing the same picture for all three makes that
   *  something to be remembered rather than read — and "you cannot place a
   *  second weapon on the one you are standing on" is a rule of the game, not a
   *  tutorial flourish, so this is not scoped to the tutorial board. */
  let actionIcon: string | null = null;
  /** The icon the action button is wearing right now, by name. What the script
   *  needs in order to point at that button whatever it currently looks like. */
  const currentActionIcon = (): string | null =>
    (actionIcon ? (actionIcon.match(/icons\/(\w+)\.svg/) ?? [])[1] ?? null : null);
  const showActionIcon = (): void => {
    const want = sellProgress() > 0 ? ICON.sell
      : standingOn && standingOn.level < MAX_LEVEL ? ICON.upgrade
        : ICON.build;
    if (want === actionIcon) return;
    actionIcon = want;
    input.setActionIcon('build', want);
    // The desktop button wears the same picture. `ICON.*` are URLs; the pad
    // takes icon NAMES, which is the same thing the tutorial's ring matches on.
    pad?.setAction(((want.match(/icons\/(\w+)\.svg/) ?? [])[1] ?? null) as IconName | null);
  };

  /** Whether to say "drag" or "WASD".
   *
   *  The SAME test the SDK uses to decide whether to mount a thumbstick at all
   *  — coarse pointers and no fine one, a phone rather than a laptop with a
   *  touchscreen. Asking a different question than the thing that draws the
   *  control would eventually tell somebody to drag a stick that is not there.
   */
  // (now shared with the village — see `keycap.ts`)

  // --- what the scripted tutorial drives ------------------------------------
  //
  // The tutorial board's enemies arrive because a STEP finished, not because a
  // timer did. These are the handles the script pulls; everything else about
  // the board is the ordinary game.
  /** Called when an enemy walks the whole road on this board. The script's last
   *  step wants exactly that to happen — it is how a player who never swings
   *  gets another chance instead of a dead board. */
  let onScriptLeak: (() => void) | null = null;
  /** The only cell a tower may go on right now, or null for the usual rules.
   *  The script names one square and highlights it; letting the player build
   *  anywhere while an arrow points at one square is an arrow that lies. */
  let onlyBuildAt: [number, number] | null = null;
  /** The only hotbar slot that may be chosen, or null for all of them. */
  let onlyKind: number | null = null;
  /** What the action button is allowed to DO right now.
   *
   *  The button does three things depending on where you stand and how long you
   *  hold it, and a scripted step means exactly one of them. Without this, the
   *  step that says "press to upgrade" can be answered by HOLDING — selling the
   *  weapon the next three steps are about — and the step that says "sell it"
   *  leaves you free to drop a new one on the square the moment it is empty. */
  const allow = { build: true, upgrade: true, sell: true };

  /** An enemy for the script: one, on the road, with its health DERIVED.
   *
   *  The script says "two hits, then one hit after you upgrade". Writing 3 here
   *  would be writing down today's sword damage — the tower does [2, 3, 5], and
   *  the day that table changes the dialog starts lying with nothing to catch
   *  it. So the health IS the upgraded damage, which makes both claims true by
   *  construction as long as one upgrade is worth less than a second hit.
   */
  const scriptEnemyHp = (): number => {
    const k = KINDS[0];
    const lv1 = k.damage * DAMAGE_BY_LEVEL[0];
    const lv2 = k.damage * DAMAGE_BY_LEVEL[1];
    // If this ever stops holding, the script cannot be told truthfully and the
    // board should SAY so rather than quietly teach the wrong number of hits.
    // It needs one upgrade to be worth more than the first shot and less than
    // two of them: that is what makes "twice, then once" true.
    if (!(lv1 < lv2 && lv2 <= lv1 * 2)) {
      console.warn('[tutorial] tower damage no longer fits the script',
                   k.id, lv1, lv2);
    }
    return lv2;
  };
  /** Put ONE enemy of this kind on the road.
   *
   *  Lifted out of the wave loop so the tutorial can spawn its own. Its script
   *  says one enemy, then another, then another, each after a step is done —
   *  that is not a wave table, and expressing it as one would mean a table that
   *  is really a state machine written sideways. */
  /** Where one crosses from, and where it is headed.
   *
   *  It comes in from OUTSIDE one side and leaves OUTSIDE another, so it is
   *  already moving by the time it can be seen and does not pop into being in
   *  front of the player. The exit is a random point on the far side rather
   *  than straight across, which is what makes each crossing a different line
   *  instead of four lanes the player learns to stand off.
   *
   *  The exit spread is deliberately narrower than the board (±4.6 against
   *  ±6.6): a line between two points near the SAME corner clips the edge of
   *  the field and is over before it is a threat. Pulling both ends in aims
   *  every crossing through the part of the board that is actually played. */
  const crossing = (): { from: THREE.Vector3; dir: THREE.Vector3 } => {
    const side = Math.floor(Math.random() * 4);
    // Pulled in from the edge, proportionally: a line between two points near
    // the SAME corner clips the field and is over before it is a threat. The
    // two axes are different lengths now, so each side gets its own.
    const alongX = () => (Math.random() * 2 - 1) * FIELD_X * 0.72;
    const alongZ = () => (Math.random() * 2 - 1) * FIELD_Z * 0.72;
    const from = new THREE.Vector3();
    const to = new THREE.Vector3();
    // 0 north, 1 south, 2 west, 3 east — and the exit is on the opposite one.
    if (side === 0) { from.set(alongX(), 0, -OUTSIDE); to.set(alongX(), 0, OUTSIDE); }
    else if (side === 1) { from.set(alongX(), 0, OUTSIDE); to.set(alongX(), 0, -OUTSIDE); }
    else if (side === 2) { from.set(-OUTSIDE, 0, alongZ()); to.set(OUTSIDE, 0, alongZ()); }
    else { from.set(OUTSIDE, 0, alongZ()); to.set(-OUTSIDE, 0, alongZ()); }
    return { from, dir: to.sub(from).normalize() };
  };

  const spawnOne = (w: Wave): void => {
    const path = crossing();
    const obj = spawnFrom(w.model);
    obj.scale.setScalar(w.scale);
    // Measured before anything is hung off it — a bar inside the box it
    // is being placed from is a number that chases itself.
    const top = localTop(obj);
    const { group: bar, fill: barFill } = makeHealthBar();
    obj.add(bar);
    // The bar is a CHILD, so it inherits the scale — a 2.1x boss would
    // wear a 2.1x health bar, and the tiny scouts an unreadable one.
    // `top` is already in the model's own units; only the MARGIN needs
    // converting. Dividing the whole thing by the scale is how the boss
    // ended up wearing its bar at hip height.
    bar.position.y = top + 0.24 / w.scale;
    // Same world size for everything, so a bar means the same thing
    // wherever it is — except the boss's, which is the run's progress
    // bar and gets to be twice the size of a scout's.
    bar.scale.setScalar((w.boss ? 1.9 : 1) / w.scale);
    const e: Enemy = {
      obj, hp: w.hp, maxHp: w.hp, speed: w.speed, bounty: w.bounty,
      armed: w.armed, bar, barFill, wobble: 0,
      pole: w.pole ?? (Math.random() < 0.5 ? 'red' : 'blue'),
      vel: path.dir.clone().multiplyScalar(w.speed),
      alive: true, shootCooldown: 1, windup: 0,
      ground: w.ground ?? false, facesTravel: w.facesTravel ?? false,
      ammo: w.ammo ?? 'td-bullet', damage: w.damage ?? BULLET_DAMAGE, boss: w.boss ?? false,
    };
    paintPole(obj, e.pole);
    if (w.model === 'boss-orc' && bossClips.length) {
      // A rig needs a mixer or it renders in its bind pose and slides —
      // silently, looking exactly like a model that has no animation.
      e.mixer = new THREE.AnimationMixer(obj);
      e.actions = new Map(bossClips.map((c) => [c.name, e.mixer!.clipAction(c)]));
      playEnemyClip(e, 'walk');
    }
    if (w.boss) {
      flashBanner(w.label ?? 'BOSS');
      audio.play('wave');
      if (bar) bar.visible = true;   // always up: it is the run's clock
    }
    obj.position.copy(path.from);
    obj.position.y = e.ground ? 0 : ENEMY_FLY_HEIGHT;
    enemies.push(e);
    tinted.push(obj);
  };

  const endRun = (didWin: boolean): void => {
    // Once. A run can plausibly end twice in the same breath — the last life
    // going and the hero falling — and the second pass would replay the
    // summary on top of itself.
    if (!running) return;
    running = false; won = didWin;
    // The controls go. There is nowhere left to walk: the run ends into a
    // summary, not into a door at the far end of the board. That door existed
    // so the ending would not be a wall of UI over a paused game — but what the
    // ending is ABOUT is now a level bar and a pile of materials, and those
    // belong on a panel rather than at the end of a walk.
    input.setEnabled(false);
    hotbar.style.display = 'none';
    audio.duck(10);
    audio.play(didWin ? SFX.victory : 'lose');
    const reached = score;
    if (reached > bestWave) bestWave = reached;
    // The shared board. A guest run is not recorded — writing needs a signed-in
    // player — and that is handled inside rather than being a caller's problem.
    void showSummary(didWin, reached);
  };

  /** The `?dev` weapon-cycle key, if this is a sandbox run. Declared here so
   *  `tearDown` can take it off the window — a keydown listener that outlives
   *  its level is one that swaps the weapon of the NEXT one. */
  let devCycle: ((e: KeyboardEvent) => void) | null = null;

  /** Take the level apart. Its scene, its physics and its listeners would
   *  otherwise keep running behind the hub for the rest of the session. */
  const tearDown = (): void => {
    renderer.setAnimationLoop(null);
    window.removeEventListener('resize', resize);
    if (devCycle) { window.removeEventListener('keydown', devCycle); devCycle = null; }
    input.dispose();
    banner.remove(); hotbar.remove(); toast.remove(); hitFlash.remove();
    // An element created and never removed outlives the run and sits over the
    // summary. Every other one on this line learned that the hard way.
    sellTag.remove();
    debug.dispose();
    hudEl.textContent = '';
    vfx.clear();
    aim.dispose();
    dial.dispose();
    spendPanel.dispose();
    coach.dispose();
    // These live on document.body, so they would outlive the level that made
    // them and sit over the hub wired to a disposed input.
    pad?.dispose();
    settings.dispose();
    ringActionButton(null);
    world.dispose();
    world.scene.clear();
    // The handle goes with it. A debug handle that outlives the thing it
    // describes is worse than none: anything asking "am I in the level?" is
    // told yes by the corpse of the last one.
    delete (window as unknown as Record<string, unknown>).__game;
  };

  /** The end of a run: what it was worth, and what it made of you.
   *
   *  An overlay rather than a scene, because it is about NUMBERS — the level
   *  bar filling is the only thing on screen that moves, and a 3D room would
   *  be competing with it.
   */
  const showSummary = async (didWin: boolean, reached: number): Promise<void> => {
    const prev = await readSave(umicat);
    const fromLevel = prev.level ?? 1;
    const fromXp = prev.xp ?? 0;
    const gained = xpFromRun({ kills, wave: reached, won: didWin });
    const after = applyXp(fromLevel, fromXp, gained);
    const store: Materials = {
      gold: (prev.store?.gold ?? prev.coin ?? 0) + gold,
      wood: (prev.store?.wood ?? 0) + earned.wood,
      stone: (prev.store?.stone ?? 0) + earned.stone,
    };
    // Finishing the tutorial has to leave you able to do something in the
    // village. It teaches buying, carrying and placing a building — and the
    // cheapest one is 150 gold, while the whole board hands out 25 and one
    // enemy's worth of drops. Without this the first thing a new player meets
    // after the tutorial is a shop that cannot sell them anything, and the only
    // thing left to do is walk back out of the gate they just came in by.
    if (scripted && didWin) {
      const first = [...TOWN].sort((a, b) => a.costs[0].gold - b.costs[0].gold)[0];
      if (first) {
        store.gold = Math.max(store.gold, first.costs[0].gold);
        store.wood = Math.max(store.wood, first.costs[0].wood);
        store.stone = Math.max(store.stone, first.costs[0].stone);
      }
    }
    await patchSave(umicat, {
      level: after.level, xp: after.xp, store, quality, best: bestWave,
      runs: (prev.runs ?? 0) + 1,
      cleared: didWin ? Math.max(prev.cleared ?? 0, levelIndex + 1) : prev.cleared,
      bests: { ...(prev.bests ?? {}), [level.id]: Math.max(prev.bests?.[level.id] ?? 0, reached) },
    });

    // The shared board. Started BEFORE the panel is built so the round trip
    // overlaps with the player reading their own numbers, and awaited only
    // where its answer is actually drawn.
    const posting = submit(umicat, score, Math.floor(runClock));

    const panel = document.createElement('div');
    panel.style.cssText = `position: fixed; inset: 0; z-index: 80; display: flex;
      align-items: center; justify-content: center; background: rgba(8,12,16,.72);
      pointer-events: auto; font: 600 15px/1.6 system-ui, sans-serif; color: #fff;`;
    const row = (glyph: IconName, label: string, n: number): string =>
      `<div style="display:flex;justify-content:space-between;gap:18px;padding:3px 0">
         <span style="opacity:.8;display:inline-flex;align-items:center;gap:7px">
           ${iconHtml(glyph)} ${label}</span><span style="font-weight:800">+${n}</span></div>`;
    panel.innerHTML = `
      <div style="min-width:290px;max-width:86vw;background:rgba(18,22,28,.96);
                  border-radius:18px;padding:22px 24px">
        <div style="font:800 19px/1.5 system-ui">${didWin ? 'Cleared' : 'Defeated'}</div>
        <div style="opacity:.75;margin-bottom:14px">${level.name} · ${formatTime(runClock)} · ${reached} points</div>
        ${row('award', 'Score', score)}${row('sword', 'Defeated', kills)}
        <div id="sum-rank" style="margin-top:14px;opacity:.75;font-size:13px;min-height:1.6em"></div>
        <button id="sum-go" style="margin-top:18px;width:100%;padding:11px 0;border:0;
          border-radius:999px;font:800 15px system-ui;background:#fff;color:#222;
          cursor:pointer">Back to the village</button>
      </div>`;
    document.body.appendChild(panel);

    // Where the run landed on the shared board — filled in when the round trip
    // comes back, rather than holding the panel up for it.
    //
    // `textContent`, and no player name is shown here at all: this line is
    // about the player reading it. The board itself, which DOES show other
    // people's names, is built in `board.ts` and never goes near innerHTML.
    void (async () => {
      const el = panel.querySelector<HTMLElement>('#sum-rank');
      if (!el) return;
      const r = await posting;
      if (r.ok) {
        el.textContent = r.best
          ? `Your best yet — #${r.rank} on the board`
          : 'Your best still stands on the board';
      } else if (r.why === 'anonymous') {
        // A rule, not a failure. Said plainly, because a score that silently
        // does not count is worse than one that says why.
        el.textContent = 'Sign in to put your score on the board';
      } else {
        el.textContent = 'Could not reach the score board';
      }
    })();


    panel.querySelector<HTMLButtonElement>('#sum-go')!.onclick = () => {
      panel.remove();
      if (leave) { const go = leave; leave = null; tearDown(); go({ won, wave: reached, level: levelIndex, banked: gold }); }
    };
  };

  // --- building ------------------------------------------------------------
  const cellOf = (x: number, z: number): [number, number] =>
    [Math.floor(x) + 0.5, Math.floor(z) + 0.5];
  const occupied = new Map<string, Tower>();

  /** One button, two jobs, decided by where you are standing.
   *
   *  A separate upgrade button would be a third thing on a phone screen that
   *  already has four, to do something you can only ever do in one place —
   *  standing on the tower. Where you are IS the selection in this game; that
   *  is the whole difference from a tower defense you play with a cursor. */
  /** One button, two verbs: tap to build or upgrade, HOLD to sell.
   *
   *  `consume()` fires on the PRESS, so wiring the hold naively means a long
   *  press upgrades the tower on the way to selling it — you pay forty gold and
   *  then get sixty per cent of a bigger number back, which is a net loss
   *  disguised as a feature. So the press is only REMEMBERED here, and what it
   *  meant is decided on release or when the hold fills.
   *
   *  It still has to go through `consume()` rather than reading `held()` alone.
   *  A press that begins and ends between two frames never appears in the held
   *  set at all — that is the whole reason the latch exists — and on a phone
   *  rendering at eight frames a second that is a perfectly ordinary tap. */
  let pressPending = false;
  let pressAt = 0;
  // --- the swap -----------------------------------------------------------

  /** Flip the pole.
   *
   *  Free, instant, and with no cooldown at all. Every instinct says to put a
   *  cost on the most powerful button in the game, and every version of that
   *  is wrong here: a cooldown means a bullet you can SEE is your colour but
   *  may not take, which reads as the game refusing an input rather than as a
   *  rule. The cost of swapping is already paid — it is that the OTHER half of
   *  what is in the air just became lethal. */
  const swapPole = (): void => {
    everSwapped = true;
    pole = other(pole);
    const look = POLE_LOOK[pole];
    audio.play(SFX.uiPress);
    // On the HERO, because the hero is what changed. A player mid-crossing is
    // looking at the board, not at the corner of the screen, so the readout is
    // a confirmation rather than the message.
    flashTint(hero, { color: look.glow, ms: 260 });
    _absorbAt.set(hero.position.x, 0.05, hero.position.z);
    ringVfx(vfx, _absorbAt, {
      color: look.glow, from: 0.3, to: ABSORB_RADIUS * 1.1, life: 0.3, opacity: 0.75,
    });
    paintHero();
    renderHud();
  };

  /** The hero wears the pole, on their BODY.
   *
   *  This is not decoration. The player has to be able to answer "what colour
   *  am I" from the middle of the screen, where they are already looking —
   *  reading it off a bar in the corner costs a glance, and the glance costs
   *  the crossing.
   *
   *  It used to be emissive only, on every mesh, because repainting the base
   *  colour would have taken the face this game spent a session rebuilding and
   *  made it a silhouette. That turned out to be a false choice: **the model
   *  is two meshes** — `body-mesh` and `head-mesh` — so the body can be
   *  painted outright and the head left entirely alone.
   *
   *  They SHARE one material (`colormap`, one texture for the whole
   *  character), so the body's has to be cloned first. This game has been
   *  bitten twice by exactly that — `flashTint` turning five enemies red for
   *  one hit, and fading the Clinic fading the Armory — and here it would have
   *  painted the face the moment it painted the shirt.
   *
   *  **Nothing is cached, and that is the fix for a bug worth remembering.**
   *  The first version held the cloned material in a variable. `flashTint`'s
   *  `isolate()` runs once per object and CLONES every material on it,
   *  replacing `mesh.material` — so the first hit flash orphaned that
   *  variable, and every swap afterwards painted an object nothing renders.
   *  It fails in the most misleading way available: the material really is
   *  being set, a probe reading it back sees a colour, and the colour it sees
   *  is whatever was baked in at the moment the flash cloned it.
   *
   *  So the current material is re-read every time and marked in `userData`,
   *  which `Material.clone()` copies — the tint system's clone comes back
   *  already marked and is written to directly.
   *
   *  **The pole is base COLOUR only, never emissive.** Emissive belongs to the
   *  tint system: `updateTints` restores it to whatever was snapshotted when
   *  the object was isolated, so a pole written there is reverted by the next
   *  hit flash.
   *
   *  **The texture comes OFF the body and the colour replaces it.** Tinting
   *  by multiply was tried first, on the reasoning that it keeps the model's
   *  own shading — and it is too quiet to read. The character's palette is a
   *  mid-toned orange; multiplied by a pale blue it comes out a muddy
   *  grey-orange, which is not "the player is blue", it is "the player looks
   *  slightly off". Measured rather than judged: the hero's pixels barely
   *  moved between the two poles.
   *
   *  Shading is not lost by dropping the map, because the material is still
   *  lit — a solid red body in this scene still has a light side and a dark
   *  side. What is lost is the fold detail of a 0.72-tall character seen from
   *  five units away, which is not what anybody is reading.
   *
   *  The head keeps its texture and its face, untouched. */
  /** Marks a material as ours to paint, and SURVIVES cloning — three copies
   *  `userData` on `Material.clone()`, which is the whole reason this works. */
  const POLE_OWNED = 'polarityBody';
  const paintHero = (): void => {
    const look = POLE_LOOK[pole];
    hero.traverse((o) => {
      const mesh = o as THREE.Mesh;
      // `body-mesh` only. The model is two meshes and the other one is the
      // face this game spent a session rebuilding.
      if (!mesh.isMesh || !mesh.name.startsWith('body')) return;
      const cur = (Array.isArray(mesh.material) ? mesh.material[0] : mesh.material) as
        THREE.MeshStandardMaterial;
      let mat = cur;
      if (!cur.userData?.[POLE_OWNED]) {
        // First time we have seen this one. It is the GLB's shared `colormap`
        // — shared with the HEAD — so it is cloned before anything is written
        // to it, or painting the shirt paints the face.
        mat = cur.clone();
        mat.userData = { ...mat.userData, [POLE_OWNED]: true };
        // The texture comes off: tinting by multiply was tried and is too
        // quiet to read — the palette is a mid-toned orange, and multiplied by
        // a pale blue it comes out a muddy grey-orange. Measured, not judged.
        // Shading is not lost, because the material is still LIT.
        mat.map = null;
        mat.needsUpdate = true;
        mesh.material = mat;
      }
      mat.color.setHex(look.body);
    });
  };

  // --- spending it on something other than a swing -------------------------

  const spendPanel = createSpendPanel({
    pause: (on: boolean) => setPaused(on),
    mana: () => mana,
    manaMax: () => MANA_MAX,
    press: () => audio.play(SFX.uiPress),
    offers: () => {
      const next = nextTierCost(kind.cast, runTier);
      const label = tierLabel(kind.cast, runTier);
      return [
        {
          id: 'heal',
          glyph: 'heart',
          title: 'Heal',
          body: `Back ${HEAL_AMOUNT} health`,
          cost: HEAL_MANA_COST,
          // Offered but refused at full health, rather than hidden. A row that
          // comes and goes is a panel whose shape changes under the thumb
          // that is reaching for it.
          blocked: heroHp >= heroMaxHp ? 'full' : null,
        },
        {
          id: 'upgrade',
          glyph: 'upgrade',
          title: 'Improve your weapon',
          body: label ?? 'Nothing left to improve',
          cost: next ?? 0,
          blocked: next === null ? 'max' : null,
        },
      ];
    },
    take: (id: Offer['id']) => {
      if (id === 'heal') {
        if (!spendMana(HEAL_MANA_COST)) return;
        heroHp = Math.min(heroMaxHp, heroHp + HEAL_AMOUNT);
        audio.play(SFX.buffPickup);
        flashTint(hero, { color: 0x5fd36a, ms: 320 });
      } else {
        const next = nextTierCost(kind.cast, runTier);
        if (next === null || !spendMana(next)) return;
        runTier += 1;
        audio.play(SFX.levelUp);
        // The blade carries its own tier — it thickens and reddens at each
        // step — so this is not cosmetic bookkeeping: skip it and the weapon
        // gets better while looking exactly as it did.
        paintBlade();
        const got = tierLabel(kind.cast, runTier);
        if (got) flashBanner(got, 'upgrade');
      }
      renderHud();
    },
  });

  const openUpgrade = (): void => {
    if (!running || spendPanel.open) return;
    spendPanel.show();
  };

  /** The two buttons that are not the attack.
   *
   *  Both are plain taps. There is no hold-to-do-something-else anywhere in
   *  this game: the tower defense had one because a single button had to carry
   *  three verbs, and the reason it could get away with it was that placing a
   *  tower is a thing done at leisure. Here the swap is pressed in the middle
   *  of a bullet crossing the screen, and a control whose meaning depends on
   *  how long you held it is a control that goes wrong exactly then. */
  const readButtons = (): void => {
    if (input.consume('swap')) swapPole();
    if (input.consume('upgrade')) openUpgrade();
  };

  /** How far through a sell-hold we are, 0 to 1, or 0 when nothing is being
   *  held. The HUD and the tower both read it — the feedback belongs on the
   *  thing being sold, not on the finger doing it. */
  const sellProgress = (): number => {
    // Zero rather than "held but refused", so the ring never even starts. A
    // sweep that fills and then does nothing is a control that lied.
    if (!allow.sell) return 0;
    if (!pressPending || !standingOn || !input.held('build')) return 0;
    const held = performance.now() - pressAt;
    // Nothing at all until the press has outlived a tap. Then 0 to 1 over what
    // is left, so the ring starts empty when it appears rather than jumping in
    // a quarter full.
    if (held < SELL_ARM_MS) return 0;
    return Math.min(1, (held - SELL_ARM_MS) / (SELL_HOLD_MS - SELL_ARM_MS));
  };

  /** Take a tower down and hand back a share of what it cost.
   *
   *  There is no confirmation box. The HOLD is the confirmation: six hundred
   *  milliseconds is not something a thumb does by accident, and letting go
   *  before the ring fills cancels it — which is safer than a dialogue, where
   *  the wrong button is one tap away either way.
   *
   *  A dialogue would also be worst exactly when you want to sell. You sell
   *  late in a board, with a wave already walking, and a modal has to disable
   *  the touch layer and cover the field while the enemies keep coming.
   */
  const sellTower = (t: Tower): void => {
    if (!running) return;
    const paid = sellValue(t);
    gold += paid;
    const ti = tinted.indexOf(t.obj);
    if (ti >= 0) tinted.splice(ti, 1);
    const i = towers.indexOf(t);
    if (i >= 0) towers.splice(i, 1);
    occupied.delete(`${t.cell[0]},${t.cell[1]}`);
    // Standing where it was is now standing on a build spot, and the prompt has
    // to say so on the same frame — otherwise the line still offers an upgrade
    // for a tower that is not there.
    if (standingOn === t) standingOn = null;
    if (sellHeld === t) { sellHeld = null; showSellHold(null, 0); }
    // It comes APART rather than blinking out. Taken out of `towers` above and
    // handed to the effects loop, which owns it now and will remove it; leaving
    // `scene.remove` here as well would take it away before it could dissolve.
    t.obj.scale.setScalar(1);
    dissolve(vfx, t.obj, { life: 0.5 });
    motes(vfx, new THREE.Vector3(t.cell[0], 0.35, t.cell[1]), {
      count: 16, color: 0xffd76a, color2: 0xfff4cf, frame: FRAME.sparkle,
      radius: 0.42, rise: 1.3, spin: 2.2, life: 0.7, size: 0.17,
    });
    ringVfx(vfx, new THREE.Vector3(t.cell[0], 0.05, t.cell[1]),
      { color: 0xffd76a, from: 0.3, to: 0.8, life: 0.45, opacity: 0.8 });
    audio.play('coin');
    flashBanner(`Sold ${t.kind.label} · +${paid}g`, 'coin');
    renderHud();
  };

  const tryBuild = (): void => {
    if (!running) return;

    if (standingOn) {
      const t = standingOn;
      if (!allow.upgrade) { audio.play('denied'); return; }
      if (t.level >= MAX_LEVEL) { audio.play('denied'); flashBanner(`${t.kind.label} is fully upgraded`); return; }
      const cost = upgradeCost(t);
      if (gold < cost) { audio.play('denied'); flashBanner(`Upgrade costs ${cost}g`); return; }
      gold -= cost;
      t.invested += cost;
      t.level += 1;
      // A section of masonry, not a bigger copy of the same thing. Scaling the
      // whole tower up made a levelled one legible across the board, which was
      // the point, but it also made it a large version of a small tower —
      // "this one cost me sixty gold" reads better as a tower that got taller.
      raiseTower(t);
      flashTint(t.obj, { color: 0xffe28a, ms: 320 });
      updraft(t.obj.position);
      audio.play(SFX.upgradeTower);
      flashBanner(`${t.kind.label} → Lv${t.level}`);
      renderHud();
      return;
    }

    if (!allow.build) { audio.play('denied'); return; }
    if (!buildCell) return;
    if (selected === null) {
      // Nothing chosen. Saying so is the whole reason the bar starts empty:
      // the button does nothing, and a button that does nothing in silence is
      // a button that looks broken.
      audio.play('denied');
      flashBanner('Choose a weapon from the bar');
      return;
    }
    const kind = KINDS[selected];
    if (towers.length >= maxTowers) {
      audio.play('denied');
      flashBanner(`${maxTowers} towers is the limit — upgrade instead`);
      return;
    }
    if (gold < kind.cost) { audio.play('denied'); flashBanner(`${kind.label} costs ${kind.cost}g`); return; }
    gold -= kind.cost;
    const obj = new THREE.Group();
    obj.position.set(buildCell[0], 0.02, buildCell[1]);
    world.scene.add(obj);
    const mount = cloneOf(kind.model);
    obj.add(mount);
    const tower: Tower = {
      kind, obj, mount, height: 0,
      cell: [...buildCell] as [number, number], reload: 0, level: 1,
      invested: kind.cost,
    };
    raiseTower(tower);
    towers.push(tower);
    occupied.set(`${buildCell[0]},${buildCell[1]}`, tower);
    tinted.push(obj);
    audio.play(SFX.placeTower);
    renderHud();
  };

  let toastTimer: ReturnType<typeof setTimeout> | undefined;
  const toast = document.createElement('div');
  toast.style.cssText = `
    position: fixed; left: 50%; bottom: 22%; transform: translateX(-50%);
    color: #fff; font: 600 15px system-ui; background: rgba(0,0,0,.45);
    padding: 8px 14px; border-radius: 999px; pointer-events: none; display: none;
  `;
  document.body.appendChild(toast);
  /** `hold` for the ones that are telling you something rather than confirming
   *  it — a crate's effect has to be readable by somebody who was watching the
   *  crate, not the top of the screen. */
  function flashBanner(text: string, glyph?: IconName, hold = 1400): void {
    toast.textContent = '';
    if (glyph) { toast.append(icon(glyph), document.createTextNode(' ')); }
    toast.append(document.createTextNode(text));
    toast.style.display = 'block';
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { toast.style.display = 'none'; }, hold);
  }

  // --- combat --------------------------------------------------------------
  const tmp = new THREE.Vector3();
  const _q = new THREE.Quaternion();
  /** Where a dragged cast wants the blast, or null for "wherever the staff
   *  would have put it". Set for the one call and cleared inside. */
  let placedCast: THREE.Vector3 | null = null;
  /** How many casts were PLACED by dragging rather than aimed by the staff.
   *
   *  The tutorial's last step is satisfied by a kill AND one of these: without
   *  it, walking up and tapping finishes a step whose whole subject is the
   *  drag. */
  let aimedCasts = 0;
  const heroAttack = (at: THREE.Vector3 | null = null): void => {
    placedCast = at;
    if (!running || animator.busy) return;

    // Attacking is paid for. This is the whole economy in one line: the only
    // way to have mana is to have stood in front of something shooting at you
    // wearing the right colour, so every swing is charged against the risk
    // that earned it.
    //
    // The three weapons are priced by how much of the board they answer — a
    // sword reaches one thing beside you, an arrow reaches across the field,
    // and a staff catches a patch of it. That ORDER is the design; the
    // absolute numbers are a first guess and are one table away.
    //
    // Refused rather than silently ignored. A silent cooldown is
    // indistinguishable from a broken button — this game already learned that
    // once, from the staff — and "you are out of mana" is a thing the player
    // can act on the moment they are told it.
    const price = MANA_PER_ATTACK[kind.cast];
    if (mana < price) {
      audio.play('denied');
      flashMana();
      return;
    }

    if (kind.cast === 'burst') {
      if (staffCooldown > 0) return;
      // Charged HERE, past the cooldown check: charging above would take the
      // mana for a cast that then does not happen.
      spendMana(price);
      staffCooldown = (kind.cooldown ?? 1.7) * burstCooldownScale(runTier);
      animator.play('interact');
      // Each staff's own sound, and the generic one only if a weapon has not
      // been given one yet.
      audio.play(kind.sound ?? 'upgrade');
      // Centred on what you have locked, not on yourself. A burst that always
      // goes off underfoot makes the spell about walking into a crowd; one you
      // can place makes it about choosing which crowd.
      // Placed by hand beats the lock, and the lock beats standing on it. A
      // dragged circle is the player saying which patch of ground; overruling
      // that with the nearest enemy would make the drag decorative.
      const at = placedCast
        ?? (lockTarget?.alive ? lockTarget.obj.position : hero.position);
      if (placedCast) aimedCasts += 1;
      // Every cast, placed or not. `aimedCasts` counts only the dragged ones,
      // which cannot tell "the click did nothing" from "the click cast the
      // ordinary way" — and that is the difference a click-vs-hold split has to
      // get right.
      casts += 1;
      placedCast = null;
      spellLamp.position.set(at.x, at.y + 0.9, at.z);
      castBurst(at);
      if (lockTarget?.alive) {
        hero.rotation.y = Math.atan2(at.x - hero.position.x, at.z - hero.position.z);
      }
      const hit = withBuff(weaponHit());
      const r = burstRadius();
      let struck = 0;
      const caught: Enemy[] = [];
      for (const e of enemies) {
        if (!e.alive) continue;
        const d = Math.hypot(e.obj.position.x - at.x, e.obj.position.z - at.z);
        if (d > r) continue;
        struck += 1;
        caught.push(e);
        damage(e, hit);
        applyStatus(e);
      }
      // The storm staff's point: it leaves the burst and goes looking. Each hop
      // is worth less than the last, or it is simply the best weapon on a full
      // board rather than the one that answers a crowd.
      if (kind.status === 'chain' && caught.length) {
        // Start from the one FURTHEST OUT, not from whichever happened to come
        // first in the array.
        //
        // The burst reaches 2.6 and a hop reaches 2.4, so everything within a
        // hop of the middle of the blast is already in the struck set — a chain
        // that sets off from a central enemy has nowhere to go and silently
        // does nothing, which is most casts. Setting off from the edge is the
        // only way the arc ever leaves the blast, and "it leaves the burst and
        // goes looking" is the whole point of this staff.
        let from = caught[0];
        let far = -1;
        for (const c of caught) {
          const d = Math.hypot(c.obj.position.x - at.x, c.obj.position.z - at.z);
          if (d > far) { far = d; from = c; }
        }
        let power = hit;
        const struckSet = new Set<Enemy>(caught);
        const hops = Math.round(weaponEffect(weapon, weaponLevel));
        for (let i = 0; i < hops; i++) {
          let next: Enemy | null = null, best = CHAIN_HOP;
          for (const e of enemies) {
            if (!e.alive || struckSet.has(e)) continue;
            const d = Math.hypot(e.obj.position.x - from.obj.position.x, e.obj.position.z - from.obj.position.z);
            if (d < best) { best = d; next = e; }
          }
          if (!next) break;
          power *= CHAIN_FALLOFF;
          struckSet.add(next);
          arc(from.obj.position, next.obj.position);
          damage(next, power);
          // The hops were the one path that skipped this — so the enemies the
          // arc went LOOKING for were the ones that showed nothing.
          applyStatus(next);
          struck += 1;
          from = next;
        }
      }
      hitCrates(at.x, at.z, r, 2);
      if (struck) audio.play('enemy-die');
      return;
    }

    if (kind.cast === 'arrow') {
      spendMana(price);
      animator.play('holdBothShoot');
      audio.play('enemy-shot');
      // Towards the lock if there is one, otherwise straight ahead. Auto-aim
      // is what makes a bow usable with a thumb; the fallback keeps it from
      // being a button that does nothing when the board is empty.
      let aimX = Math.sin(hero.rotation.y), aimZ = Math.cos(hero.rotation.y);
      if (lockTarget?.alive) {
        const dx = lockTarget.obj.position.x - hero.position.x;
        const dz = lockTarget.obj.position.z - hero.position.z;
        const len = Math.hypot(dx, dz) || 1;
        aimX = dx / len; aimZ = dz / len;
        hero.rotation.y = Math.atan2(aimX, aimZ);
      }
      // One arrow, then a spread. The middle of an odd spread flies straight,
      // so the bow never stops being able to hit the thing you are looking at.
      const shots = arrowShots(runTier);
      const base = Math.atan2(aimX, aimZ);
      const share = arrowShare(runTier);
      for (let i = 0; i < shots; i++) {
        const off = (i - (shots - 1) / 2) * ARROW_SPREAD;
        const a = base + off;
        const dirX = Math.sin(a), dirZ = Math.cos(a);
        const arrow = spawnFrom('td-ammo-arrow');
        arrow.position.set(hero.position.x + dirX * 0.3, hero.position.y + 0.34, hero.position.z + dirZ * 0.3);
        arrow.lookAt(arrow.position.x + dirX, arrow.position.y, arrow.position.z + dirZ);
        arrows.push({
          obj: arrow, life: arrowLife(ARROW_LIFE, runTier), share,
          vel: new THREE.Vector3(dirX * ARROW_SPEED, 0, dirZ * ARROW_SPEED),
        });
      }
      return;
    }

    spendMana(price);
    animator.play('attack');
    swing = SWING_SECONDS;
    trailDone = false;
    // NO WHOOSH, and this is the decision rather than an omission.
    //
    // A swing used to make three sounds in the SAME millisecond — the damage
    // loop below runs synchronously, right here — and two of them were
    // 0.6-0.8s whooshes 290Hz apart in spectral centre, laid over one short
    // impact. Replacing the hit clip changed nothing anyone could hear,
    // because the new one was a second copy of the noise already playing.
    //
    // The cost is real and was accepted knowingly: a swing that MISSES is
    // silent. What is left for it is the blade's smear, which is drawn on a
    // miss for exactly this sort of reason.
    let connected = false;
    const reach = meleeReach(HERO_ATTACK_RANGE, runTier);
    const swingX = Math.sin(hero.rotation.y), swingZ = Math.cos(hero.rotation.y);
    for (const e of enemies) {
      if (!e.alive) continue;
      const d = Math.hypot(e.obj.position.x - hero.position.x, e.obj.position.z - hero.position.z);
      if (d > reach) continue;
      connected = true;
      const alive = e.hp > withBuff(weaponHit());
      damage(e, withBuff(weaponHit()));
      // Sparks at the CONTACT POINT, on every hit and not only the heavy tiers.
      // The base sword had nothing there at all — a red flash on the victim and
      // a sound, which is feedback about the victim rather than about the blow.
      // Skipped on a kill: the saucer's own burst is about to happen in the
      // same place, and two effects on one frame is one effect nobody reads.
      // Halfway to what was hit, at the height the blade is held: that is
      // where the edge actually met it. At the enemy's own centre the sparks
      // sat ON the saucer and read as the saucer changing colour.
      if (alive) {
        const contact = new THREE.Vector3(
          (hero.position.x + e.obj.position.x) / 2,
          hero.position.y + SWING_HEIGHT,
          (hero.position.z + e.obj.position.z) / 2,
        );
        hitSparks(vfx, contact, swingX, swingZ, meleeImpact(runTier) ?? 0);
        // And the LINE the edge went along, which the sparks cannot say: they
        // are omnidirectional, so they report that something happened here and
        // not what shape it was. Drawn on the ENEMY's own position rather than
        // the contact point — it is a mark on what was hit.
        slashFlash(vfx, new THREE.Vector3(
          e.obj.position.x, hero.position.y + SWING_HEIGHT, e.obj.position.z,
        ), tierLook(runTier), meleeImpact(runTier) ?? 0);
      }
    }
    // A swing that connects sounds different from one that whiffs — and with
    // the whoosh off, a whiff makes no sound at all, so this IS the difference
    // rather than half of it.
    if (hitCrates(hero.position.x, hero.position.z, reach, 1)) connected = true;
    if (connected) {
      heroHits += 1;
      audio.play(SFX.swordHit);
      // Longer for the heavier tiers: the freeze is how weight is expressed,
      // and a tier that hits harder should stop the world for longer.
      hitstop = HITSTOP_MS + (meleeImpact(runTier) ?? 0) * HITSTOP_MS * 0.6;
      shake = SHAKE_SECONDS;
    }
    // There is no separate effect for the heavy tiers any more.
    //
    // `swordImpact` used to add a flash, a ground ring and sparks from tier 2 —
    // which taught nothing about tiers zero and one, because it simply was not
    // there for them. The BLADE TRAIL carries the level instead: it thickens
    // and reddens at every step, so the scale is legible from the first swing
    // rather than announced at the top of it.
  };

  const damage = (e: Enemy, amount: number, quiet = false): void => {
    e.hp -= amount;
    // Knocked sideways. A thing in the AIR has nothing to brace against, so a
    // hit that does not kill it should move it — and a flyer rocking is the
    // cheapest possible read of "that landed".
    //
    // Not on a QUIET tick: a burn ticks twice a second for three and a half
    // seconds, and a saucer rocking continuously is a saucer with a motor
    // problem rather than one being hit.
    if (e.hp > 0 && !quiet && !e.ground) e.wobble = WOBBLE_SECONDS;
    // A burn ticks twice a second on every enemy it caught; at the fight's own
    // volume that is a wall of noise, and the flash would hide the hits you
    // actually landed. It still FLASHES — in its own colour, so damage arriving
    // from somewhere you are not is visible.
    if (!quiet || !isTinted(e.obj)) flashTint(e.obj, { color: quiet ? 0xff8a2a : 0xff3020, ms: quiet ? 220 : 160 });
    if (e.hp > 0) { if (!quiet) audio.play('hit-enemy'); return; }
    audio.play('enemy-die');
    e.alive = false;
    if (e.boss) {
      // It does not blink out. A thousand-hit-point fight ending on a frame
      // where the model simply stops existing is the anticlimax of the run, so
      // it falls over, and the payout arrives as a handful of coins rather than
      // one.
      flashBanner('THE WARLORD FALLS');
      playEnemyClip(e, 'die', false);
      corpse(vfx, e.obj, { hold: CORPSE_SECONDS, sink: 1.2, mixer: e.mixer ?? null });
      kills += 1;
      // A boss is worth most of a bar. It has to be: killing one costs a long
      // stretch of attacking, which is a long stretch of SPENDING, and a fight
      // you come out of poorer than you went in is a fight to walk away from.
      gainMana(MANA_PER_BOSS_KILL);
      const share = Math.round(e.bounty * BOUNTY_SCALE * (buff?.kind.id === 'lucky' ? 1.6 : 1) / 6);
      for (let i = 0; i < 6; i++) dropPickup(e.obj.position, share, 'gold');
      return;
    }
    // It comes APART rather than blinking out. The boss already fell over for
    // this reason; everything else vanished on the frame it died.
    saucerBurst(vfx, e.obj.position, e.ground ? 0xffb066 : 0xc08cff);
    e.obj.visible = false;
    e.obj.rotation.z = 0;
    kills += 1;
    // Paid on the spot, and NOTHING is dropped.
    //
    // Everything in this game's ancestry made you walk to your money — that
    // was the tower defense's whole point, since you were somewhere else and
    // the money was here. Here you are already at the kill, because the only
    // weapon is your own, so a coin to collect is a coin lying where you are
    // standing. And the coins paid GOLD, which now has nothing to buy: they
    // were still flying to the hero, still chiming, and moving a counter that
    // is no longer on the screen.
    gainMana(MANA_PER_KILL);
  };

  const hurtHero = (amount = BULLET_DAMAGE): void => {
    // Nor can the hero die on it. The last step is a melee fight, and a new
    // player losing it would be sent back to a village they have not seen yet.
    if (scripted) return;
    if (invincible > 0 || !running) return;
    if (buff?.kind.id === 'shield') { flashTint(hero, { color: 0x6ec8ff, ms: 200 }); return; }
    invincible = HERO_INVINCIBLE_SECONDS;
    // Armour first, then the level's percentage — a block, then a resistance.
    // Never below 1: armour that can zero out a hit is immunity, and a saucer
    // that cannot touch you at all takes the walk between build spots, which is
    // this game's actual cost, and makes it free.
    const through = Math.max(0, amount - armour);
    const took = Math.max(1, Math.round(through * damageTakenMultiplier(playerLevel)));
    heroHp -= took;
    // Totals for the balance bot. A DEFENSIVE change cannot be measured by the
    // wave a run reaches: armour keeps the HERO alive, and the bot's runs end
    // with the BASE falling, so wave 7 against wave 6 was two samples of
    // something else. Damage taken over a whole run is the thing armour acts
    // on, and it accumulates rather than being decided by one bad wave.
    tookDamage += took;
    tookHits += 1;
    audio.play('hero-hurt');
    flashScreen();
    flashTint(hero, { color: 0xff2a1a, ms: 220 });
    renderHud();
    // Down is DOWN. It used to cost a life and carry you back to the door,
    // which made the hero's health a second pool of lives rather than the thing
    // you are looking after — and a bar you can be brought back from is not a
    // bar anyone watches.
    if (heroHp <= 0) { heroHp = 0; renderHud(); endRun(false); }
  };

  // Left click swings. `button`/`pointerType` checked because the right button
  // is the camera and touch already has the ⚔ button — see CLAUDE.md.
  //
  // Unless a STAFF is in hand, in which case the press belongs to the aiming
  // drag and the cast happens when the button comes back up: a click casts the
  // ordinary way from inside the gesture's own release, a hold opens the circle.
  // Attacking here as well would fire once on the way down and again on the way
  // up, which is the bug the touch button had before the drag owned its press.
  canvas.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || e.pointerType === 'touch') return;
    if (aimsByDrag() && aim.canAim()) return;
    heroAttack();
  });
  // The mouse's aiming surface. The thumb aims from the button it is already
  // on; the cursor aims from the canvas it is already over.
  aim.watchSurface(canvas);
  canvas.addEventListener('pointermove', (e) => {
    if (e.pointerType === 'touch') { pointerNdc = null; return; }
    pointerNdc ??= new THREE.Vector2();
    pointerNdc.set(
      (e.clientX / window.innerWidth) * 2 - 1,
      -(e.clientY / window.innerHeight) * 2 + 1);
  });
  canvas.addEventListener('pointerleave', () => { pointerNdc = null; });

  // Whatever was picked up in the hub. Also the only thing that hides the
  // other two: they are all attached, and all visible until told otherwise.
  setWeapon(startWeapon);

  // DEV ONLY: cycle the weapon mid-fight with `\`.
  //
  // A run carries ONE weapon, on purpose — which weapon to take is most of what
  // the Armory is for. But comparing three staves that way means three runs and
  // three walks back to the rack, and what you are trying to judge is how a
  // burn feels against a chill on the SAME wave. `?dev` already unlocks
  // everything and saves nothing, so this belongs there and nowhere near a real
  // run. It also announces itself, or you cannot tell which one you are holding.
  if (DEV) {
    devCycle = (e: KeyboardEvent): void => {
      if (e.code !== 'Backquote' && e.code !== 'Backslash') return;
      const order = WEAPONS.map((w) => w.id);
      setWeapon(order[(order.indexOf(weapon) + 1) % order.length]);
      flashBanner(kind.name.toUpperCase(), kind.icon);
    };
    window.addEventListener('keydown', devCycle);
  }
  renderHud();
  // Everything is loaded, warmed and placed; the next frame is a real one.
  hideLoading();

  const debug = createDebugHud(renderer, hudEl,
    DEV ? DEV_BANNER : undefined, toggleDev);
  const shadowOf = (): string => {
    const d = world.scene.children.find((c) => (c as THREE.DirectionalLight).isDirectionalLight) as THREE.DirectionalLight | undefined;
    return d ? `${d.shadow.mapSize.width}` : 'none';
  };

  let last = performance.now();
  const dir = new THREE.Vector3();
  /** Where the hero is actually going, as opposed to where the stick says. Only
   *  used on slippery levels. */
  const glide = { x: 0, z: 0 };
  const prevPos = new THREE.Vector3();
  const heroHit = new THREE.Vector3();
  /** How the run went, handed back so the hub can unlock the next board. */
  let leave: ((r: LevelResult) => void) | null = null;
  const leaving = new Promise<LevelResult>((res) => { leave = res; });

  /** Freeze the world, keep drawing it.
   *
   *  The board carries on without you otherwise: the wave timer runs, enemies
   *  walk, and reading the settings costs a life. Rendering continues so the
   *  dialog sits over the game rather than over a black rectangle — this is a
   *  pause, not a scene change. */
  const setPaused = (on: boolean): void => {
    if (paused === on) return;
    paused = on;
    if (on) {
      inputWasOn = input.isEnabled;
      input.setEnabled(false);
    } else {
      input.setEnabled(inputWasOn);
      // Whatever was held when the dialog opened is not held now. Without this
      // the sell-hold that opened the settings resumes on close and sells the
      // tower the player was standing on.
      last = performance.now();
    }
  };

  /** Give up on the run. The village, with nothing recorded.
   *
   *  The summary is what writes the save, so a run abandoned here simply never
   *  happened: no wave recorded, no materials banked, no level counted. That is
   *  the honest reading of "leave", and it is also what stops a quit button
   *  from being a way to bank a good first wave and try again. */
  const quitRun = (): void => {
    if (!leave) return;
    const go = leave;
    leave = null;
    setPaused(false);
    tearDown();
    go({ won: false, wave: 0, level: levelIndex, banked: 0 });
  };

  // --- the lessons ---------------------------------------------------------
  //
  // Every one of them is a CONDITION. They are written in the order a player
  // is most likely to meet them, which is a readability convenience and
  // nothing more — the game decides what happens first.
  //
  // Each says what the player should DO, and the ones that can wait until
  // there is something to do it with, do.
  const taught = new Set<string>(saveNow.taught ?? []);
  let sawOwnColour = false;
  let sawWrongColour = false;
  let everSwapped = false;
  const coach = createCoach({
    host: document.body,
    already: saveNow.taught ?? [],
    onFire: (id) => {
      // Written as they fire rather than at the end of the run: a player who
      // closes the tab mid-lesson has still had it, and being taught the same
      // thing again next time is worse than missing the tail of a run's list.
      taught.add(id);
      void patchSave(umicat, { taught: [...taught] });
    },
    lessons: [
      {
        id: 'move',
        when: () => runClock > 1.2,
        title: 'Walk',
        text: `${dragThing()} to move. Everything here is decided by where you are standing.`,
        hold: 4.0,
      },
      {
        // The first thing that crosses, named before it starts shooting.
        id: 'colours',
        when: () => enemies.some((e) => e.alive),
        title: 'Two colours',
        text: 'Enemies are dark or light, and they shoot their own colour.',
        hold: 4.4,
      },
      {
        // The core rule, taught at the first moment it is ABOUT to matter —
        // an orb of the player's own colour, in the air, coming towards them.
        id: 'absorb',
        when: () => sawOwnColour,
        title: 'Take your own colour',
        text: 'Orbs the same colour as you are pulled in and become magic. Stand in them.',
        hold: 5.0,
      },
      {
        // And its other half, taught the first time the player is actually hit.
        id: 'swap',
        when: () => sawWrongColour,
        title: `Change colour with ${pressName('swap')}`,
        text: 'The other colour hurts. Match it and it feeds you instead.',
        hold: 5.4,
      },
      {
        // Only once they have done it. "You can swap" and "swapping worked"
        // are different lessons and the second one only lands after the first
        // has been acted on.
        id: 'attack-costs',
        when: () => everSwapped && mana >= MANA_PER_ATTACK[kind.cast] * 2,
        title: 'Attacking spends magic',
        text: `${pressName(weapon)} to attack. Every swing costs magic, so collect before you fight.`,
        hold: 5.2,
      },
      {
        // The panel, offered at the exact moment it can be used — which is
        // what the whole trigger model is for. Before this it would have been
        // a button that opens a panel where everything is greyed out.
        id: 'spend',
        // Not "you have 30 mana" — "there is something you could buy with it
        // RIGHT NOW". Those came apart at the start of a run: the opening
        // purse used to equal the price of a heal, so the panel was explained
        // on frame one, at full health, where the only thing it offered was
        // greyed out. `score > 0` is the other half: it means this mana was
        // EARNED, so the lesson arrives attached to the thing that earned it.
        when: () => score > 0 && (
          mana >= (nextTierCost(kind.cast, runTier) ?? Infinity)
          || (heroHp < heroMaxHp && mana >= HEAL_MANA_COST)),
        title: `Spend magic with ${pressName('upgrade')}`,
        text: 'Heal, or make your weapon better. It pauses while you choose.',
        hold: 5.6,
      },
      {
        id: 'hurt',
        when: () => heroHp <= heroMaxHp * 0.45,
        title: 'Heal before it is too late',
        text: `Magic buys health back — ${pressName('upgrade')}, then Heal.`,
        hold: 5.0,
      },
      {
        id: 'boss',
        when: () => enemies.some((e) => e.alive && e.boss),
        title: 'The boss fires both',
        text: 'Its fan is dark AND light at once. No colour is safe — move out of it.',
        hold: 5.4,
      },
    ],
  });

  // The hero wears its starting colour before the first frame, not on the
  // first swap — otherwise the opening minute is played by someone who cannot
  // see what they are.
  paintHero();

  const frame = (now: number): void => {
    // `dt` is CLAMPED so a stall cannot tunnel the physics, which means a slow
    // scene runs the world in slow motion. `realDt` is not — anything measured
    // against a person rather than against the world (how long an instruction
    // has been on screen, how long a button has been held) uses this one.
    const realDt = (now - last) / 1000;
    const dt = Math.min(realDt, 0.05);
    last = now;

    // HITSTOP: the same trick as the pause, for sixty milliseconds. Everything
    // holds — the hero mid-swing, the enemy mid-flinch, the bullets in the air
    // — which is what makes the blow land instead of pass through.
    if (hitstop > 0) {
      hitstop -= realDt * 1000;
      renderer.render(world.scene, world.camera);
      return;
    }

    // PAUSED: draw the frame and stop. Everything below advances something —
    // the camera, the hero, the wave clock, the aiming gesture's own timers —
    // and a settings panel the board keeps playing behind is a panel that costs
    // a life to read.
    if (paused) {
      renderer.render(world.scene, world.camera);
      return;
    }

    // NO ORBIT. The camera is the frame: it does not move and it does not
    // turn, so "left" means left for the whole run. A turnable camera is right
    // for a board you walk around inside and wrong for one that IS the screen
    // — it would rotate the playfield under a player who is reading the line a
    // bullet is travelling on.
    //
    // The look input is still CONSUMED, so a drag on the right half of the
    // screen does nothing rather than being handed to something else.
    input.look();

    // Walking is not part of "the game is running" — it is how you leave.
    const move = input.direction(world.cameraYaw);
    // Ice. The controller takes a direction and goes, so slip is the direction
    // LAGGING the stick: you keep going the way you were for a moment after you
    // let go or turn, which is what sliding feels like from the inside. Done
    // here rather than in the SDK because "the ground is slippery" is a rule
    // this game has and not a platform capability.
    if (level.slip > 0) {
      // A time constant, not a per-frame lerp — a per-frame factor makes the
      // ice feel different at 30fps and at 120.
      const k = 1 - Math.exp(-dt / (0.05 + level.slip * 0.2));
      glide.x += (move.x - glide.x) * k;
      glide.z += (move.z - glide.z) * k;
      // The controller NORMALISES whatever direction it is given, so a glide of
      // 0.1 still walks at full speed — the slide is in the heading, not in the
      // pace. That is why this cuts off at a third rather than at a whisker:
      // decaying to 0.02 kept the hero at full tilt for half a second, which is
      // two units on a thirteen-unit board.
      //
      // (Real deceleration needs the controller's speed to be settable at
      // runtime, and it is `private readonly` in the SDK. Worth adding there —
      // slow effects, sprint and heavy characters all want it — but "this level
      // is icy" is a game rule and belongs here either way.)
      // ONLY once the stick is centred. Applied unconditionally it also kills
      // the ramp UP — glide climbs from zero to 0.1, gets cut back to zero, and
      // climbs again, so the hero cannot move on ice at all. Which looks, in a
      // screenshot, exactly like a hero standing still.
      // Cut off at half rather than a third. The fun of ice is that you cannot
      // turn sharply; the overshoot when you STOP is just an obstacle to
      // building, and a slide of 0.63 on a board of 1-unit cells means landing
      // on the wrong cell most times you try. Measured, on a bot that could not
      // place a single tower here.
      const stick = move.x !== 0 || move.z !== 0;
      if (!stick && Math.hypot(glide.x, glide.z) < 0.55) { glide.x = 0; glide.z = 0; }
      move.x = glide.x; move.z = glide.z;
    }
    character.update(dt, move);
    if (character.position.y < RESPAWN_BELOW_Y) character.teleport(SPAWN);
    character.syncTo(hero, HERO_SYNC_OFFSET);
    character.faceTowards(hero, move, dt);
    animator.update(character.state);

    if (running) {
      // Hooked BEFORE the decision below, not after: on the first frame of a
      // session the controller would otherwise be judged on a button it had not
      // been handed yet, and swallow a press it could not act on.
      aim.watch(attackButton());
      // A staff is aimed, not fired. The drag owns the press for those, so the
      // latch is only spent here by weapons that have no aim — otherwise every
      // hold would cast once on the way down and again on release.
      if (aim.aiming() || (aimsByDrag() && aim.canAim() && input.held('attack'))) {
        input.consume('attack');
      }
      else if (input.consume('attack')) heroAttack();
      aim.update(pointerNdc, input.held('attack'));
      // Only the staffs wait; a sword has nothing to show.
      // The button where there is one, the chip where there is not.
      dial.show(aimsByDrag() ? (attackButton() ?? weaponCell) : null,
                aimsByDrag() ? staffCooldown / (kind.cooldown ?? 1.7) : 0);
      readButtons();
      // The effect ring follows the hero and breathes, so it reads as live
      // rather than as a mark left on the grass. It fades over the last two
      // seconds instead of blinking out — an effect that ends without saying so
      // is one you find out about by being hit.
      buffRing.visible = !!buff;
      if (buff) {
        (buffRing.material as THREE.MeshBasicMaterial).color.setHex(buff.kind.color);
        buffRing.position.set(hero.position.x, 0.03, hero.position.z);
        const pulse = 1 + Math.sin(performance.now() / 180) * 0.05;
        buffRing.scale.setScalar(pulse);
        (buffRing.material as THREE.MeshBasicMaterial).opacity =
          0.8 * Math.min(1, buff.left / 2);
      }
      if (invincible > 0) invincible -= dt;
      if (staffCooldown > 0) staffCooldown -= dt;


      // The tower being sold is what shows the hold — not the button, which is
      // on the platform's control layer and under the player's own thumb. It
      // sinks and pales as the hold fills, so letting go is visibly "it came
      // back".
      if (sellHeld && sellHeld !== standingOn) { sellHeld.obj.scale.setScalar(1); sellHeld = null; }
      const k = sellProgress();
      if (standingOn) {
        if (k > 0) { sellHeld = standingOn; standingOn.obj.scale.setScalar(1 - k * 0.22); }
        else if (sellHeld) { sellHeld.obj.scale.setScalar(1); sellHeld = null; }
      }
      // Round the tower, every frame — not in the corner HUD, which is only
      // rebuilt when what is under your feet changes and is the far side of the
      // screen from both the thumb and the thing being sold.
      showSellHold(k > 0 ? standingOn : null, k);
      // The button's own picture follows the hold: `build` becomes `upgrade`
      // when you stand on your weapon and `sell` while you are holding it down.
      // Per frame because the hold is a continuous thing; it returns at once
      // when nothing has changed.
      showActionIcon();

      // --- what the bow and the staff are pointed at ---
      lockTarget = null;
      if (weapon !== 'sword') {
        const inRange = enemies.filter((e) => e.alive
          && Math.hypot(e.obj.position.x - hero.position.x, e.obj.position.z - hero.position.z) <= BOW_RANGE);
        // A mouse hovering an enemy chooses it; otherwise the nearest one.
        if (pointerNdc && inRange.length) {
          raycaster.setFromCamera(pointerNdc, world.camera);
          const hits = raycaster.intersectObjects(inRange.map((e) => e.obj), true);
          if (hits.length) {
            const root = hits[0].object;
            lockTarget = inRange.find((e) => {
              let n: THREE.Object3D | null = root;
              while (n) { if (n === e.obj) return true; n = n.parent; }
              return false;
            }) ?? null;
          }
        }
        if (!lockTarget) {
          let best = Infinity;
          for (const e of inRange) {
            const d = Math.hypot(e.obj.position.x - hero.position.x, e.obj.position.z - hero.position.z);
            if (d < best) { best = d; lockTarget = e; }
          }
        }
      }
      if (lockRing) {
        lockRing.visible = !!lockTarget;
        if (lockTarget) {
          lockRing.position.set(
            lockTarget.obj.position.x, lockTarget.obj.position.y + 0.1, lockTarget.obj.position.z);
          // Stood on its edge to face the camera: on the ground it would read
          // as a build spot, which is a different promise.
          lockRing.quaternion.copy(world.camera.quaternion);
        }
      }

      // Nothing is built any more, so the only thing under the hero's feet
      // worth knowing about is a crate.
      const nearCrate = crates.some((c) =>
        c.hp > 0 && Math.hypot(c.obj.position.x - hero.position.x, c.obj.position.z - hero.position.z) < 1.0);
      if (nearCrate !== atCrate) { atCrate = nearCrate; renderHud(); }

      // --- waves ---
      // A tutorial you can lose while reading it is not a tutorial. The first
      // wave waits until there is something on the board to meet it; after
      // that the lessons run alongside the fight, which is where they mean
      // anything.
      // The run has no waves. It has a CLOCK, and everything is read off it:
      // how often one crosses, how tough it is, and when a boss is due.
      //
      // The old loop waited for the board to be empty before sending the next
      // wave, which is what made a wave a wave. Nothing waits here — a board
      // that empties is a board where the player has run out of bullets to
      // absorb, and mana is the only thing keeping them alive. Going quiet is
      // the one thing this game must never do.
      runClock += dt;
      // `wavesPaused` holds the board still without stopping the world, which
      // is what a probe needs in order to test one orb against one hero. It
      // survived the rewrite as a variable nobody read — set by its handle,
      // doing nothing, so `pauseWaves(true)` reported success and the board
      // kept firing into the middle of the experiment.
      if (!wavesPaused) {
        spawnTimer -= dt;
        if (spawnTimer <= 0) {
          spawnTimer = spawnGapAt(runClock);
          spawnOne(enemyAt(runClock));
        }
        // The boss is DERIVED from the run clock, not counted down beside it.
        //
        // It was its own timer, which is the obvious way to write "one every
        // 68 seconds" and quietly made the schedule un-skippable: winding the
        // clock forward to look at minute four moved the crossings and left
        // the boss timer where it was, so minute four could not be looked at
        // with a boss in it. Anything that is a function of the run's clock
        // should be written as one — then there is a single thing to move.
        const due = Math.floor(runClock / BOSS_EVERY);
        if (due > bossCount) {
          bossCount = due;
          spawnOne(bossAt(bossCount));
        }
      }

      // --- enemies walk the path ---
      // How many are already committed to a shot. Counted before the loop so
      // the cap is about the board, not about who happens to be early in the
      // list.
      /** How much of their own speed everything on the board has right now. */
      const foeScale = buff?.kind.id === 'slow' ? SLOW_MULT : 1;
      let shooters = 0;
      for (const e of enemies) if (e.alive && e.windup > 0 && !e.boss) shooters += 1;
      for (const e of enemies) {
        if (!e.alive) continue;
        // Burn first: something that dies to it should not also get a step.
        if (e.burn) {
          e.burn.left -= dt;
          e.burn.tick -= dt;
          if (e.burn.tick <= 0) {
            e.burn.tick = BURN_TICK;
            // A small flame off the thing itself, every other bite. Every bite
            // would be twice a second per burning enemy, and ten burning
            // enemies is a draw call each — the tint says "this is on fire" for
            // free, and this says it again where you are looking.
            burnPuff(e);
            damage(e, e.burn.dps * BURN_TICK, true);
            if (!e.alive) continue;
          }
          if (e.burn.left <= 0) e.burn = undefined;
        }
        let speed = e.speed;
        if (e.chill) {
          e.chill.left -= dt;
          if (e.chill.left <= 0) e.chill = undefined;
          else speed *= e.chill.mult;
        }
        speed *= foeScale;
        e.mixer?.update(dt);
        const prevX = e.obj.position.x, prevZ = e.obj.position.z;
        // Straight across. `vel` already carries the speed it was made with,
        // so a chill scales the WHOLE step rather than being applied to a
        // separate speed the direction knows nothing about.
        e.obj.position.addScaledVector(e.vel, dt * (speed / e.speed));
        // Out the far side. Nothing is lost when one leaves: there is no gate
        // and no base to reach. What it cost you is whatever it fired on the
        // way through — and what you MISSED is the mana you did not take off
        // it, which is a cost the player feels without being told about it.
        if (Math.abs(e.obj.position.x) > OUTSIDE || Math.abs(e.obj.position.z) > OUTSIDE) {
          e.alive = false;
          e.obj.visible = false;
          continue;
        }
        if (e.facesTravel) {
          // Face where it is going. A walk cycle playing sideways is the kind of
          // wrong that reads as the model being broken rather than the code.
          const dx = e.obj.position.x - prevX, dz = e.obj.position.z - prevZ;
          if (dx * dx + dz * dz > 1e-8) e.obj.rotation.y = Math.atan2(dx, dz);
        } else {
          e.obj.rotation.y += dt * 1.6;   // UFOs spin; it reads as "alive"
        }
        // The rock from a hit, decaying. On Z, which tilts a disc — the spin is
        // on Y and the two do not fight.
        if (e.wobble > 0) {
          e.wobble = Math.max(0, e.wobble - dt);
          const k = e.wobble / WOBBLE_SECONDS;
          e.obj.rotation.z = Math.sin(k * Math.PI * 6) * WOBBLE_TILT * k;
        } else if (e.obj.rotation.z !== 0) {
          e.obj.rotation.z = 0;
        }

        // Shooting the hero. Same shape as the tower's: a wind-up you can see
        // and walk out of, rather than damage for standing nearby.
        const dHero = Math.hypot(e.obj.position.x - hero.position.x, e.obj.position.z - hero.position.z);
        // Their clock, not the world's. `foeDt` is what makes `slow` read as
        // everything slowing down rather than as enemies sliding about at the
        // same rate of fire — same number of orbs a second, just from further
        // away, which is not what a slow looks like from the inside.
        const foeDt = dt * foeScale;
        if (e.windup > 0) {
          e.windup -= foeDt;
          if (e.windup <= 0) {
            // Fire at where the hero IS, and then forget about them. A bullet
            // that steers is a slower contact hit wearing a costume — and here
            // it would be worse than that: a homing bullet cannot be dodged,
            // and dodging is the ONLY answer to the colour you are not.
            const v = new THREE.Vector3(
              hero.position.x - e.obj.position.x,
              (hero.position.y + 0.3) - e.obj.position.y,
              hero.position.z - e.obj.position.z,
            );
            if (v.lengthSq() < 1e-6) v.set(0, 0, 1);
            v.normalize();
            if (e.boss) {
              // A FAN, and in both colours at once.
              //
              // This is the only thing on the board that cannot be answered by
              // picking a side: whichever colour the hero is wearing, half of
              // what is coming will feed them and half will not, so a boss is
              // read with the feet rather than with the swap button. The
              // colours alternate across the fan rather than being rolled per
              // pellet — a random mix sometimes comes out all one colour,
              // which is a boss that accidentally behaves like a saucer.
              const n = BOSS_FAN;
              const flip = Math.random() < 0.5;
              for (let k = 0; k < n; k++) {
                const a = (k - (n - 1) / 2) * BOSS_FAN_SPREAD;
                const dirK = v.clone().applyAxisAngle(UP, a);
                const p: Pole = ((k % 2 === 0) === flip) ? 'red' : 'blue';
                fireOrb(e.obj.position, dirK, p, e.damage, 1.45, BULLET_SPEED * 0.78);
              }
            } else {
              fireOrb(e.obj.position, v, e.pole, e.damage, 1, BULLET_SPEED);
            }
            audio.play(e.boss ? 'cannon-shot' : 'enemy-shot');
            if (e.mixer) playEnemyClip(e, 'walk');
          }
        } else if (e.shootCooldown > 0) {
          e.shootCooldown -= foeDt;
        } else if (e.armed && dHero < ENEMY_SHOOT_RANGE && (e.boss || shooters < MAX_SHOOTERS)) {
          if (!e.boss) shooters += 1;
          e.windup = e.boss ? BOSS_WINDUP_SECONDS : ENEMY_WINDUP_SECONDS;
          e.shootCooldown = e.boss ? BOSS_SHOOT_COOLDOWN : ENEMY_SHOOT_COOLDOWN;
          flashTint(e.obj, { color: 0xffd050, ms: e.windup * 1000 });
          // The boss's tell is its own arm going back. Longer than the saucers'
          // and visible from across the board, because two hearts is most of
          // what the hero has.
          if (e.mixer) playEnemyClip(e, 'attack');
        }
      }

      // --- the running effect ---
      if (buff) {
        buff.left -= dt;
        if (buff.left <= 0) { buff = null; renderHud(); flashBanner('Effect over'); }
        else if (Math.ceil(buff.left) !== Math.ceil(buff.left + dt)) renderHud();
      }

      // --- supply crates ---
      crateTimer -= dt;
      if (crateTimer <= 0) {
        crateTimer = CRATE_EVERY;
        if (crates.length < CRATE_MAX) dropCrate();
      }
      for (let i = crates.length - 1; i >= 0; i--) {
        const c = crates[i];
        c.t += dt;
        // A broken one is gone on the next frame; an untouched one keeps for a
        // while and then goes, so the field does not silently fill up with
        // crates nobody wanted.
        if (c.hp <= 0 || c.t > CRATE_LIFE) {
          if (c.hp > 0) c.obj.visible = false;
          world.scene.remove(c.obj);
          const ti = tinted.indexOf(c.obj);
          if (ti >= 0) tinted.splice(ti, 1);
          crates.splice(i, 1);
          continue;
        }
        // A slow bob, so it reads as something to go and get rather than
        // scenery someone left on the grass.
        c.obj.position.y = Math.sin(c.t * 2.2) * 0.05 + 0.05;
        c.obj.rotation.y += dt * 0.6;
      }

      // --- enemy bullets fly ---
      for (let i = bullets.length - 1; i >= 0; i--) {
        const bu = bullets[i];
        bu.life -= dt;
        prevPos.copy(bu.obj.position);
        // Orbs slow with everything else — they are what a slow is FOR. Their
        // life is not scaled, so a slowed shot expires where it would have
        // rather than hanging about for three times as long.
        bu.obj.position.addScaledVector(bu.vel, dt * foeScale);
        heroHit.set(hero.position.x, hero.position.y + 0.3, hero.position.z);

        // THE RULE. Your own colour is pulled in; the other colour is a hit.
        //
        // Absorption is checked FIRST and at a wider radius, so a same-pole
        // orb can never reach the body — matching a colour is safe, not
        // merely profitable. A player who has to wonder whether the absorb
        // will win the race dodges instead of collecting, which is this game
        // not being played.
        if (bu.pole === pole) {
          const d = Math.hypot(bu.obj.position.x - hero.position.x,
                               bu.obj.position.z - hero.position.z);
          // Armed a little wider than the absorb itself, so the lesson lands
          // as the orb closes rather than after it is already gone.
          if (d <= ABSORB_RADIUS * 2.2) sawOwnColour = true;
          // Pulled in. The velocity is BENT rather than the position moved:
          // the orb is a thing in flight and it should curve, which is what
          // reads as attraction. Moving it directly at the hero — the way a
          // dropped coin is moved — makes it change into a different object
          // that walks towards you.
          if (d > ABSORB_RADIUS && d <= ATTRACT_RADIUS) {
            const k = 1 - d / ATTRACT_RADIUS;
            const speed = Math.min(ATTRACT_MAX_SPEED,
              bu.vel.length() * (1 + ATTRACT_SPEEDUP * k * dt));
            // Aim at the hero's chest, not their feet: an orb steered at
            // ground level dips under a model that is 0.72 tall and is
            // absorbed from somewhere nobody is looking.
            _pull.set(hero.position.x - bu.obj.position.x,
                      (hero.position.y + 0.3) - bu.obj.position.y,
                      hero.position.z - bu.obj.position.z)
              .normalize().multiplyScalar(speed);
            bu.vel.lerp(_pull, Math.min(1, ATTRACT_TURN * k * dt));
          }
          if (d <= ABSORB_RADIUS) {
            absorb(bu.obj.position);
            gainMana(MANA_PER_ABSORB);
            world.scene.remove(bu.obj);
            bullets.splice(i, 1);
            continue;
          }
        }

        // Swept, not sampled. A bullet fired from touching distance covers the
        // whole gap inside one frame, and a point test at each end would find
        // it on neither side of the player it just went through.
        const hit = bu.pole !== pole
          && segmentHitsSphere(prevPos, bu.obj.position, heroHit, BULLET_HIT_RADIUS);
        // Gone at the FIELD edge, not at the board's. They are fired from
        // outside it.
        if (hit || bu.life <= 0
            || Math.abs(bu.obj.position.x) > OUTSIDE || Math.abs(bu.obj.position.z) > OUTSIDE) {
          if (hit) { sawWrongColour = true; hurtHero(bu.damage); }
          world.scene.remove(bu.obj);
          bullets.splice(i, 1);
        }
      }

      // --- the hero's arrows fly ---
      for (let i = arrows.length - 1; i >= 0; i--) {
        const a = arrows[i];
        a.life -= dt;
        prevPos.copy(a.obj.position);
        a.obj.position.addScaledVector(a.vel, dt);
        let hit: Enemy | null = null;
        for (const e of enemies) {
          if (!e.alive) continue;
          if (!segmentHitsSphere(prevPos, a.obj.position, e.obj.position, ARROW_HIT)) continue;
          hit = e; break;
        }
        if (hit) damage(hit, withBuff(weaponHit()) * a.share);
        const brokeCrate = !hit && hitCrates(a.obj.position.x, a.obj.position.z, ARROW_HIT, 1);
        if (hit || brokeCrate || a.life <= 0 || Math.abs(a.obj.position.x) > 7 || Math.abs(a.obj.position.z) > 7) {
          world.scene.remove(a.obj);
          arrows.splice(i, 1);
        }
      }

    }

    // The blade's own arc, on top of whatever the arm is doing. Eased so it
    // leaves fast and settles slow, which is what makes a swing read as a cut
    // rather than as a rotation.
    debug.tick(now, dt, `shadow ${shadowOf()}`);
    // REAL seconds, not `dt`. `dt` is clamped at 0.05 so a struggling phone
    // runs the world in slow motion, and how long a sentence has been readable
    // is measured against a person rather than against the world.
    coach.update(realDt);



    updatePickups(dt);
    updateHealthBars();
    vfx.update(dt);
    if (spellFlash > 0) {
      spellFlash = Math.max(0, spellFlash - dt * 3.4);
      spellLamp.intensity = spellFlash * 9;
    }
    updateTints(tinted);
    world.update(dt);
    // The blade is aimed LAST, after `world.update` — the hero carries a scene
    // mixer of its own (the `animation: { play: 'idle' }` on its entity) and
    // `world.update` steps it, so a pose computed before that is stale by
    // however far the arm moved this frame. Which is a lot, mid-swing: some
    // frames came out right and some pointed at the sky.
    if (swordPivot && weapon === 'sword') {
      // The bone the pivot hangs from moved this frame; read it after that.
      hero.updateMatrixWorld(true);
      if (swing > 0) {
        swing = Math.max(0, swing - dt);
        const k = 1 - swing / SWING_SECONDS;
        const yaw = hero.rotation.y;
        const fx = Math.sin(yaw), fz = Math.cos(yaw);
        const rx = Math.cos(yaw), rz = -Math.sin(yaw);
        // Smoothstep across the CUT part of the swing, so the first frames
        // still show the blade cocked back. An ease that starts fast skipped
        // the wind-up entirely: by the time anything was drawn the sweep was a
        // third done.
        const cut = Math.min(1, k / SWING_CUT);
        const e = cut * cut * (3 - 2 * cut);
        // LEFT to RIGHT, and level. It swept right-to-left before — the
        // forehand a right hand would actually throw — and this is the arc that
        // was asked for. One sign, if it ever wants to be a forehand again.
        const a = -SWING_ARC + 2 * SWING_ARC * e;
        // THE BODY DOES NOT TURN, and the reason is worth keeping.
        //
        // A yaw offset sweeping with the blade was added here to stand in for
        // the shoulder turn the rig has no clip for. It read as the hero
        // SPINNING — reported as "he turns a full circle every attack", and
        // that was literal rather than a matter of taste: `yaw` is read from
        // `hero.rotation.y` at the top of this block and the twist was written
        // back into it, so every frame twisted the already-twisted facing.
        // Measured at 1.45 radians of net turn out of ONE swing.
        //
        // A non-accumulating version would need a separate base to twist from.
        // It is not worth it: the blade is level, centred on the hero and
        // sweeping side to side on its own, which is the arc that was asked for.
        const ca = Math.cos(a), sa = Math.sin(a);
        // PARALLEL TO THE GROUND. It used to dip — `-0.1 - 0.25 * e` — on the
        // theory that a finishing cut drops, and what that actually did was
        // take the one thing a level arc has going for it, which is that it is
        // level. Zero.
        _dir.set(fx * ca + rx * sa, 0, fz * ca + rz * sa).normalize();
        // The tip's direction of travel, which is where the edge should face.
        _edge.set(fx * sa - rx * ca, 0, fz * sa - rz * ca);
        if (k > SWING_CUT) {
          // Back to the carry, over the tail of the swing. Snapping there in a
          // single frame is a sword that teleports.
          const back = (k - SWING_CUT) / (1 - SWING_CUT);
          _rest.set(fx * 0.22, 1, fz * 0.22).normalize();
          _dir.lerp(_rest, back * back * (3 - 2 * back)).normalize();
        }
        aimBlade(_dir, _edge);
        levelBlade(k, _dir.x, _dir.z);
        // The smear the blade leaves, drawn ONCE per swing from the arc itself.
        //
        // A ribbon emitted per frame is a draw call per frame — the same
        // arithmetic that made the staff's specks nineteen draws before they
        // were instanced. And built from the ARC rather than from remembered
        // tip positions, so its resolution does not depend on the frame rate:
        // sampled per frame it was fifteen segments on a device and TWO under
        // the headless renderer, which is a thing that cannot be checked.
        if (!trailDone && cut >= 0.75) {
          trailDone = true;
          bladeTrail(vfx, hero.position, yaw, -SWING_ARC, a,
            SWING_SMEAR, hero.position.y + SWING_HEIGHT, tierLook(runTier));
        }
        if (swing === 0) restSword();
      } else {
        restSword();
      }
    }

    // A PUNCH on the camera, last of all.
    //
    // The most noticeable thing on the melee-feel list and the one I left out,
    // which is why the first round of this work came back as "I cannot really
    // see any of it". Small and short: a few centimetres, decaying over a fifth
    // of a second. Big camera shake in a game where you are trying to stand on
    // a particular square is a game you cannot aim in.
    //
    // Applied AFTER everything and undone at the top of the next frame: the
    // SDK's follow camera recomputes its position from the target each time, so
    // an offset added here is naturally temporary rather than accumulating —
    // which is the trap the hero's shoulder-turn fell into.
    if (shake > 0) {
      shake = Math.max(0, shake - realDt);
      const k = shake / SHAKE_SECONDS;
      const a = performance.now() / 22;
      world.camera.position.x += Math.sin(a) * SHAKE_AMOUNT * k;
      world.camera.position.y += Math.cos(a * 1.3) * SHAKE_AMOUNT * 0.7 * k;
    }

    renderer.render(world.scene, world.camera);
  };
  renderer.setAnimationLoop(frame);

  Object.assign(window as unknown as Record<string, unknown>, {
    __game: {
      umicat, world, character, input, animator, renderer,
      /** The hero's own object. The hub exposes one and the boards did not, so
       *  a probe that works in the village fell over in a level on the same
       *  line. */
      hero,
      /** Freeze the loop and render one frame from wherever you like. For
       *  LOOKING at things — the follow camera overwrites its own transform
       *  every frame, so a probe that moves it sees nothing. */
      /** Stop the loop and redraw from the GAME's own camera — for judging how
       *  a moment reads in play, which a camera I placed by hand cannot. */
      freeze: () => {
        renderer.setAnimationLoop(null);
        renderer.render(world.scene, world.camera);
      },
      /** Start it again. `freeze` is one-way, and a probe that froze to
       *  photograph something then measured anything afterwards was measuring a
       *  dead game — an arrow probe read zero arrows in the air because the
       *  frame loop had been off since the previous check. */
      unfreeze: () => renderer.setAnimationLoop(frame),
      freezeAndRender: (from: [number, number, number], at: [number, number, number], fov = 35) => {
        renderer.setAnimationLoop(null);
        const cam = new THREE.PerspectiveCamera(fov, canvas.width / canvas.height, 0.05, 60);
        cam.position.set(from[0], from[1], from[2]);
        cam.lookAt(at[0], at[1], at[2]);
        renderer.render(world.scene, cam);
      },
      get enemies() { return enemies; },
      get towers() { return towers; },
      get shots() { return shots; },
      get bullets() { return bullets; },
      get arrows() { return arrows; },
      weapon: () => weapon,
      lock: () => (lockTarget ? { hp: lockTarget.hp, visible: lockRing?.visible ?? false } : null),
      setWeapon: (w: Weapon) => setWeapon(w),
      /** How many effects are alive, and how high the highest speck got. The
       *  motes are ONE instanced mesh now, so counting objects counts one — and
       *  instances have no positions of their own to read. */
      effects: () => {
        let top = -Infinity;
        world.scene.traverse((o) => {
          if (typeof o.userData.topY === 'number') top = Math.max(top, o.userData.topY);
        });
        return { live: vfx.count, top: Number.isFinite(top) ? +top.toFixed(2) : null };
      },
      get pickups() { return pickups; },
      earned: () => ({ ...earned }),
      /** Put materials straight in the run's tally, for a probe that is about
       *  what the village COSTS rather than about walking over to collect. */
      stock: (wood: number, stone: number) => { earned.wood += wood; earned.stone += stone; },
      playerLevel: () => playerLevel,
      /** Drop one on demand, for a probe that should not have to wait for a
       *  tower to kill something at the right moment. The real drop. */
      drop: (x: number, z: number, kind?: Material | 'health', amount = 7) =>
        dropPickup(new THREE.Vector3(x, 0.3, z), amount, kind),
      /** What a kill rolls, without a kill. Used to measure how rare a heart
       *  is — counting real drops needs hundreds of kills. */
      rollDrop: () => rollDrop(heroHp < heroMaxHp),
      quality: () => ({ level: quality, name: QUALITY[quality].name,
                        pixelRatio: renderer.getPixelRatio() }),
      corpses: () => vfx.count,
      get crates() { return crates; },
      buff: () => (buff ? { id: buff.kind.id, left: +buff.left.toFixed(1) } : null),
      glide: () => ({ ...glide }),
      /** `rare` forces the kind, for a probe that should not have to roll dice
       *  until they agree — the crate it drops is the real one either way. */
      dropCrate: (rare?: boolean) => dropCrate(rare),
      /** Take every crate off the field. A probe testing what ONE crate does
       *  cannot have three within swing range — a single swing broke two and
       *  the second effect looked like the first one rerolling into itself. */
      clearCrates: () => {
        for (const c of crates) { c.obj.visible = false; c.hp = 0; }
      },
      /** The attack button, and the end of the run. The real ones — a probe
       *  that calls its own copy is testing its own copy. */
      attack: () => heroAttack(),
      /** Put a different weapon in hand, for a probe that wants to check how a
       *  sword behaves without replaying the board with one. */
      equip: (w: string) => setWeapon(w as Weapon),
      /** The drag-to-place gesture: whether it is open and where the blast is
       *  standing. A probe cannot see a circle; it can see where the circle
       *  says it is. */
      casts: () => casts,
      /** What the weapon has learned this run, and what the next step costs.
       *  `buyTier` goes through the CELL, not past it — a probe that called an
       *  internal would pass on a button nobody can press. */
      runTier: () => ({ tier: runTier, next: nextTierCost(kind.cast, runTier),
                        cast: kind.cast, reach: meleeReach(HERO_ATTACK_RANGE, runTier),
                        arrows: arrowShots(runTier), radius: burstRadius(),
                        cooldown: (kind.cooldown ?? 1.7) * burstCooldownScale(runTier),
                        damage: weaponHit(), impact: meleeImpact(runTier) }),
      buyTier: () => weaponCell.click(),
      arrowsInFlight: () => arrows.length,
      /** What the settings dialog has actually done to the mix. A slider that
       *  moves a number on screen and nothing else looks identical to one that
       *  works. */
      audio: () => ({ music: audio.musicLevel, sfx: audio.sfxLevel, muted: audio.isMuted }),
      paused: () => paused,
      aim: () => ({ aiming: aim.aiming(), at: aim.at(),
                    drags: aimsByDrag(), reach: castReach(), radius: burstRadius() }),
      /** Pose the blade by hand, for finding the numbers. The rest pose and the
       *  arc are three angles each and guessing them from a bone's local frame
       *  is how a sword ends up through a shoulder. */
      setSwordPose: (x: number, y: number, z: number) => swordPivot?.rotation.set(x, y, z),
      swingLeft: () => swing,
      /** Ask for a world direction and read back what the blade actually does.
       *  A round trip, because every wrong sword pose so far has been a frame
       *  I reasoned about instead of measuring. */
      aimAt: (x: number, y: number, z: number) => {
        hero.updateMatrixWorld(true);
        aimBlade(_dir.set(x, y, z), _edge.set(0, 0, 1));
        hero.updateMatrixWorld(true);
      },
      heroYaw: () => +hero.rotation.y.toFixed(3),
      swordTip: () => {
        if (!swordPivot) return null;
        const v = new THREE.Vector3(0, 0.348, 0).applyMatrix4(swordPivot.children[0].matrixWorld);
        const gp = new THREE.Vector3(0, -0.1, 0).applyMatrix4(swordPivot.children[0].matrixWorld);
        return { tip: v.toArray().map((n) => +n.toFixed(2)),
                 grip: gp.toArray().map((n) => +n.toFixed(2)) };
      },
      /** Gold, for a probe that needs a board built without playing for it. */
      gift: (n: number) => { gold += n; renderHud(); },
      /** Top the bar back up. For probes that need to watch something SLOW
       *  happen without the hero quietly dying of chip damage halfway. */
      heal: (n = 999) => { heroHp = Math.min(heroMaxHp, heroHp + n); renderHud(); },
      /** Take damage the way a bullet does — invincibility, defence and the
       *  end-of-run check included. `hurt` is a blunt setter; this is the rule. */
      hurtHero: (n?: number) => { invincible = 0; hurtHero(n); },
      hurt: (n: number) => { invincible = 0; heroHp = Math.max(1, heroHp - n); renderHud(); },
      debugEndRun: (won = false) => endRun(won),
      merged: () => folded,
      /** Everything on the board, with the one field that decides the game.
       *
       *  A probe that can only count enemies cannot check a single rule here:
       *  "there are six of them" says nothing about whether the colour rule
       *  works, and the colour rule IS the game. Same for the orbs — an
       *  absorb and a hit happen at the same place a tenth of a second apart,
       *  and telling them apart needs to know what colour arrived. */
      foes: () => enemies.filter((e) => e.alive).map((e) => ({
        pole: e.pole, hp: +e.hp.toFixed(2), boss: e.boss,
        x: +e.obj.position.x.toFixed(3), z: +e.obj.position.z.toFixed(3),
      })),
      orbs: () => bullets.map((b) => ({
        pole: b.pole, damage: b.damage,
        x: +b.obj.position.x.toFixed(3), z: +b.obj.position.z.toFixed(3),
        d: +Math.hypot(b.obj.position.x - hero.position.x,
                       b.obj.position.z - hero.position.z).toFixed(3),
      })),
      /** Drive the two controls a probe cannot press, because the SDK's
       *  buttons only exist on a touch screen. */
      swap: () => swapPole(),
      /** Put the hero somewhere. (`attack` is already declared below — two of
       *  the same key in one object literal is TS1117, which `tsc` reports and
       *  `vite build` does not. Second time this has happened here.) */
      teleport: (x: number, z: number) => character.teleport({ x, y: 0.5, z }),
      /** The board's four corners, in 0..1 screen space, from the REAL camera.
       *  Recomputing the projection beside the game would be checking a copy
       *  of the arithmetic rather than the camera the player is looking
       *  through. */
      /** How big the things you must READ come out, in screen pixels.
       *
       *  The board being on screen says nothing about whether the game can be
       *  played on it: fit the whole world into a phone and every check about
       *  framing passes while the hero is twelve pixels and an orb is six —
       *  and six pixels cannot carry a colour, which is the one thing this
       *  game asks you to read. */
      pixelSizes: () => {
        const cam = world.camera as THREE.PerspectiveCamera;
        cam.updateMatrixWorld(true);
        const h = canvas.clientHeight;
        const at = (x: number, z: number, top: number) => {
          const a = new THREE.Vector3(x, 0, z).project(cam);
          const b = new THREE.Vector3(x, top, z).project(cam);
          return +(Math.abs(b.y - a.y) / 2 * h).toFixed(1);
        };
        return {
          // At the board's centre, which is where they are read.
          hero: at(0, 0, HERO_HALF_HEIGHT * 2),
          orb: at(0, 0, 0.28),
          // And at the far corner, the smallest anything ever gets.
          orbFar: at(FIELD_X * 0.8, -FIELD_Z * 0.8, 0.28),
        };
      },
      /** Where the TOP of a hero standing at each edge of the board lands, in
       *  0..1 screen space.
       *
       *  Headroom is reserved at the far edge only, on the reasoning that a
       *  near-edge head projects INTO the board rather than out of the frame.
       *  That reasoning is worth a check rather than a comment: if it is wrong
       *  the hero is decapitated in the one place a player cannot afford not
       *  to see them, and nothing else in this game would report it. */
      headsOnScreen: () => {
        const cam = world.camera as THREE.PerspectiveCamera;
        cam.updateMatrixWorld(true);
        const top = HERO_HALF_HEIGHT * 2;
        return ([['far', -1], ['near', 1]] as const).map(([where, sz]) => {
          const v = new THREE.Vector3(0, top, sz * FIELD_Z).project(cam);
          return { where, y: +((1 - v.y) / 2).toFixed(4) };
        });
      },
      /** Where the hero actually IS on screen, 0..1, from the real camera.
       *  Inferring it from the board's corners is close and not exact, and a
       *  probe that samples "close to the hero" samples grass. */
      heroOnScreen: () => {
        const cam = world.camera as THREE.PerspectiveCamera;
        cam.updateMatrixWorld(true);
        const v = new THREE.Vector3(hero.position.x, hero.position.y + HERO_HALF_HEIGHT,
                                    hero.position.z).project(cam);
        return { x: +((v.x + 1) / 2).toFixed(4), y: +((1 - v.y) / 2).toFixed(4) };
      },
      cornersOnScreen: () => {
        const cam = world.camera as THREE.PerspectiveCamera;
        cam.updateMatrixWorld(true);
        return ([[-1, -1], [1, -1], [-1, 1], [1, 1]] as const).map(([sx, sz]) => {
          const v = new THREE.Vector3(sx * FIELD_X, 0, sz * FIELD_Z).project(cam);
          return { x: +((v.x + 1) / 2).toFixed(4), y: +((1 - v.y) / 2).toFixed(4) };
        });
      },
      /** What a rare crate can pay, and a way to be handed one. Breaking a
       *  real crate needs a crate to have dropped, on a cell that is free, and
       *  then walking to it — none of which is the thing under test.
       *
       *  There were TWO of these for a while, in one object literal. The later
       *  won, which is why nothing looked wrong; the earlier one knew nothing
       *  about `instant` and would have hung a twenty-second countdown on an
       *  effect that is over the moment it lands. `tsc` says so (TS1117) and
       *  `vite build` does not — it never typechecks. Run both. */
      buffs: () => BUFFS.map((b) => ({ id: b.id, label: b.label, instant: !!b.instant })),
      giveBuff: (id: string | null) => {
        if (id === null) { buff = null; renderHud(); return; }
        const kind = BUFFS.find((b) => b.id === id);
        if (!kind) return;
        if (kind.instant) takeInstant(kind);
        else buff = { kind, left: BUFF_SECONDS };
        renderHud();
      },
      /** One crossing, right now, through the game's own spawn path. Lets a
       *  probe sample what the tide actually produces rather than re-running
       *  the same arithmetic beside it and calling that a test. */
      spawnNow: () => spawnOne(enemyAt(runClock)),
      /** The hero's own meshes, by name, with what material each carries.
       *
       *  Painting the body meant finding it, and "it is called body-mesh in
       *  the GLB" is a fact about the FILE — what survives loading is a
       *  separate question, and the difference between the two is a paint that
       *  silently does nothing. */
      heroMeshes: () => {
        const out: unknown[] = [];
        hero.traverse((o) => {
          const m = o as THREE.Mesh;
          if (!m.isMesh) return;
          const mat = (Array.isArray(m.material) ? m.material[0] : m.material) as
            THREE.MeshStandardMaterial;
          out.push({ name: m.name, type: m.type, mat: mat?.name ?? null,
                     color: mat?.color ? `#${mat.color.getHexString()}` : null,
                     uuid: mat?.uuid ?? null });
        });
        return out;
      },
      /** Take everything off the board, so an experiment has one orb in it. */
      clearBoard: () => {
        for (const e of enemies) if (e.alive) { e.alive = false; e.obj.visible = false; }
        for (const b of bullets) world.scene.remove(b.obj);
        bullets.length = 0;
      },
      setPole: (p: Pole) => { if (p !== pole) swapPole(); },
      giveMana: (n: number) => { mana = Math.max(0, Math.min(MANA_MAX, n)); renderHud(); },
      /** Put one orb of a named colour on a collision course, from `d` away.
       *  The only way to test the rule deterministically: waiting for the board
       *  to fire the colour you want is waiting on a coin flip. */
      /** One orb on an arbitrary line, relative to the hero. `throwOrb` aims
       *  straight at them, which is the one path on which a bend cannot be
       *  seen — it is already pointed at the thing doing the pulling. */
      throwOrbAt: (p: Pole, o: { dx: number; dz: number; vx: number; vz: number }) => {
        const from = new THREE.Vector3(
          hero.position.x + o.dx, hero.position.y + 0.3, hero.position.z + o.dz);
        const dir = new THREE.Vector3(o.vx, 0, o.vz).normalize();
        fireOrb(from, dir, p, 10, 1, BULLET_SPEED);
      },
      throwOrb: (p: Pole, d = 3, dmg = 10) => {
        const dir = new THREE.Vector3(1, 0, 0);
        const from = new THREE.Vector3(
          hero.position.x - dir.x * d, hero.position.y + 0.3, hero.position.z);
        fireOrb(from, dir, p, dmg, 1, BULLET_SPEED);
      },
      /** Pick a tower kind, the same way the number keys do. */
      select: (i: number | null) => {
        selected = i === null ? null : Math.max(0, Math.min(i, KINDS.length - 1));
        refreshHotbar(); renderHud();
      },
      selected: () => selected,
      kinds: () => KINDS.map((k) => ({ id: k.id, mount: k.mount, cost: k.cost, range: k.range })),
      /** three itself, and the tint predicate. Probes need to measure the scene
       *  (where is this, how big is it), and reaching for a Box3 should not mean
       *  bundling a second copy of three into the test. */
      THREE,
      isTinted: (o: THREE.Object3D) => isTinted(o),
      /** Damage something, for a probe that needs a kill without a ten-minute
       *  siege. The real function, not a copy of it. */
      /** `quiet` is FORWARDED. It used to be dropped here, so a burn tick
       *  driven through this seam arrived as a sword hit — and a seam that
       *  behaves differently from the thing it stands in for makes a probe
       *  report on a game nobody is playing. Found by a check asking whether a
       *  burn rocks a saucer: it does not, and through this it did. */
      damage: (e: Enemy, amount: number, quiet = false) => damage(e, amount, quiet),
      /** Jump the wave counter. A SEAM, not a shortcut: it moves only the
       *  *when*, and the enemies it produces come out of the same spawn code as
       *  every other wave — otherwise a probe would be checking a boss that
       *  only exists inside the probe. Reaching wave twelve honestly takes nine
       *  minutes, which is nine minutes nobody spends before shipping. */
      /** Stop the waves where they are. For measurements that need the board
       *  to hold still — a draw-call count taken while enemies are spawning is
       *  a count of the enemies. */
      pauseWaves: (on: boolean) => { wavesPaused = on; },
      /** Wind the run's clock forward. The curve is a function of it, so this
       *  is the only thing a probe needs in order to look at minute four
       *  without playing four minutes of game. */
      skipToWave: (n: number) => {
        for (const e of enemies) { if (e.alive) { e.alive = false; e.obj.visible = false; } }
        runClock = Math.max(0, n);
        spawnTimer = 0;
        // Everything the clock decides moves with it. `bossCount` is caught up
        // rather than reset, so winding forward does not dump one boss per
        // interval skipped onto the board at once.
        bossCount = Math.floor(runClock / BOSS_EVERY);
        waveLaunched = true;
        renderHud();
      },
    state: () => ({ level: level.id, levelIndex, slip: level.slip, kills,
      gold, lives, heroHp, heroMax: heroMaxHp, running, won,
      // What the new game is: which colour you are, what you have banked, and
      // what the run is worth. A probe that cannot read `pole` cannot check a
      // single rule in this game.
      pole, mana, manaMax: MANA_MAX, score, clock: +runClock.toFixed(2),
      /** Always 1. On `state()` so a probe can prove the account does not
       *  change the fight, which is what the shared board rests on. */
      playerLevel,
      // The curve itself, so "does it ramp" is a question about the game
      // rather than about how many enemies a slow headless frame managed to
      // spawn in six seconds of wall clock.
      gap: +spawnGapAt(runClock).toFixed(3),
      /** Which way the tide is running. The one thing that makes the swap
       *  button necessary, and a number a probe can watch swing. */
      redShare: +redShareAt(runClock).toFixed(3),
      nextBossAt: (bossCount + 1) * BOSS_EVERY,
      // A hit that lands during the invincibility window costs nothing, so a
      // probe reading only `heroHp` cannot tell "the rule is broken" from "the
      // hero was already hurt a moment ago". That ambiguity cost a run.
      invincible: +invincible.toFixed(2),
      maxLevel: MAX_LEVEL, armour,
      tookDamage, tookHits,
      // On `state()` rather than only on its own handle, so the balance bot can
      // read it in the poll it already makes. An extra round-trip per decision
      // starves that bot, and a starved bot reports a hard board.
      runTier: { tier: runTier, next: nextTierCost(kind.cast, runTier) },
      /** What is on the board, by pole. The one thing a probe has to be able
       *  to see: this game is unplayable if an enemy's colour is not readable,
       *  and "there are six enemies" cannot tell a board of six dark ones from
       *  a board that is half and half. */
      onBoard: POLES.map((p) => enemies.filter((e) => e.alive && e.pole === p).length),
      orbs: bullets.length,
      boss: (() => {
        const b = enemies.find((e) => e.boss);
        return b ? { alive: b.alive, hp: b.hp, maxHp: b.maxHp, clip: b.clip ?? null,
                     y: +b.obj.position.y.toFixed(3) } : null;
      })(),
                      standingOn: standingOn ? { kind: standingOn.kind.id, level: standingOn.level } : null,
                      towers: towers.map((t) => ({ kind: t.kind.id, level: t.level, cell: t.cell })) }),
      build: () => tryBuild(),
      /** Sell whatever is under the hero, and what it is worth before you do —
       *  so a probe can check the arithmetic without having to hold a button
       *  for six hundred milliseconds of wall-clock. The HOLD is checked
       *  separately, through the real input, because that is the part a player
       *  actually touches. */
      sell: () => { if (standingOn) sellTower(standingOn); },
      sellValue: () => (standingOn ? sellValue(standingOn) : null),
      invested: () => (standingOn ? standingOn.invested : null),
      sellProgress: () => sellProgress(),
      /** What the board is currently teaching, and how far through. `null` on
       *  a board that does not teach, and once the last step is done. */
      locomotion: () => animator.action || character.state,
    } as unknown,
  });
  void tmp;
  return leaving;
}

async function boot(): Promise<void> {
  installLiftStyles();
  showLoading('Waking up', 'boot');
  const umicat = await ThreeUmicat.init();
  await RAPIER.init();
  const canvas = document.getElementById('game') as HTMLCanvasElement;
  const hudEl = document.getElementById('hud')!;
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  const shared: Shared = { umicat, renderer, canvas, hudEl, audio: createAudio() };
  setLiftPressSound(() => shared.audio.play(SFX.uiPress));
  // Fetch and decode the clips NOW, while the loading screen is still up.
  // Left to itself the first gesture does both jobs — create the context and
  // start the downloads — so a sound asked for on that gesture has no buffer
  // and is dropped. That gesture is the title's own button, which is the one
  // press every player makes. Not awaited: the point is to have started.
  void shared.audio.preload();
  // Whatever the player set last time, before anything can be heard. Read here
  // rather than in the level because the audio outlives every scene — set in a
  // level and then not applied in the village is a setting that un-sets itself
  // on the walk home. `??` and not `||`: a deliberate zero is not "unset".
  {
    const saved = await readSave(umicat);
    if (saved.musicVolume !== undefined) shared.audio.setMusicVolume(saved.musicVolume);
    if (saved.sfxVolume !== undefined) shared.audio.setSfxVolume(saved.sfxVolume);
  }

  // The title, once, before any of it. It reads the save and either leaves it
  // alone or wipes it, so everything below can go on reading progress the way
  // it always has and never learn that this screen exists.
  //
  // It is also the session's first TAP, which is what unlocks audio on iOS.
  // Nothing has tried to make a sound before this point.
  // The loading screen stays up until the title is ON SCREEN. Hiding it here
  // and then awaiting a title that loads a scene first left a BLACK SCREEN for
  // however long that took — nothing on the canvas, nothing over it. It was a
  // blink locally and seconds over the CDN, and the probes all waited long
  // enough to miss it entirely.
  if (!DEV) await showTitle(shared);

  // The hub, then the level. `runHub` resolves when the player walks through
  // the door, and tears its own scene down first — one renderer, one context,
  // handed over rather than rebuilt.
  // The loop: hub, door, level, door, hub. Each half tears itself down and
  // hands the renderer back, so this can run all evening without leaking a
  // scene per run.
  for (;;) {
    showLoading('Entering the woods', 'hub');
    const choice = await runHub(shared);
    // `-1` is the tutorial board, which is not in `LEVELS` and so has no entry
    // to take a name from.
    // Keyed by BOARD: they are different sizes, and a shared key would have the
    // bar measuring Meadow against Crossroads.
    showLoading(`Entering ${LEVELS[0].name}`, 'level-arena');
    // The summary writes the save — level, experience, the store, what was
    // cleared and how far. Doing it here as well double-counted the run.
    await startLevel(shared, choice.weapon, choice.level, choice.bonus, choice.weapons);
  }
}

void boot().catch((err) => {
  const hud = document.getElementById('hud');
  if (hud) hud.textContent = `Failed to start: ${String(err)}`;
  console.error('[umicat] game failed to start', err);
});

void GAME_WIDTH; void GAME_HEIGHT;
