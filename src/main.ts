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
import { runHub, submitScore } from './hub';
import { showLoading, hideLoading } from './loading';
import { createDebugHud } from './debughud';
import { LEVELS, type LevelDef, type Wave } from './levels';
import { NO_BONUS, type TownBonus } from './town';
import type { GameAudio } from '@umicat/three-sdk';

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
  best?: number;
  quality?: number;
  weapon?: Weapon;
  /** Levels finished — what the hub unlocks weapons from. */
  runs?: number;
  /** How many boards have been WON, in order. Level `i` is open when
   *  `cleared >= i`, so clearing Meadow opens Frostfall. */
  cleared?: number;
  /** Best wave reached on each board, by level id. */
  bests?: Record<string, number>;
  /** Gold carried home from runs, to be spent in the hub. */
  coin?: number;
  /** Which town buildings have been paid for, and to what level. */
  town?: Record<string, number>;
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
  const prev = (await umicat.saves.get<Progress>(SAVE_KEY)) ?? {};
  await umicat.saves.set(SAVE_KEY, { ...prev, ...fields });
}
// The spawn point is read from the scene's own hero entity (see `SPAWN` inside
// `startLevel`), not written down here. The hub had the two separately and they
// disagreed — the controller wins, so editing the scene did nothing at all.
const RESPAWN_BELOW_Y = -5;

// --- the hero -------------------------------------------------------------
const HERO_HALF_HEIGHT = 0.2;
const HERO_RADIUS = 0.16;
const HERO_SYNC_OFFSET = -(HERO_HALF_HEIGHT + HERO_RADIUS);
const HERO_MAX_HP = 8;
const HERO_SPEED = 4.2;
const HERO_ATTACK_RANGE = 1.15;
const HERO_ATTACK_DAMAGE = 2;
const HERO_INVINCIBLE_SECONDS = 1.7;

// --- enemies --------------------------------------------------------------
/** They fly, so they float above the path rather than walking it. */
const ENEMY_FLY_HEIGHT = 0.38;
/** UFOs SHOOT. Nothing about touching one hurts you.
 *
 *  It used to be a wind-up and then a distance check, which is a hitscan with
 *  a delay — and with a 1.7-unit range and nothing visible crossing the gap it
 *  read as "walking near it costs a heart". A bullet you can see leave, cross
 *  the ground and miss is a different game, from exactly the same numbers. */
const ENEMY_SHOOT_RANGE = 3.4;
const ENEMY_SHOOT_COOLDOWN = 2.4;
/** The tell, before the shot leaves. */
const ENEMY_WINDUP_SECONDS = 0.45;
const BULLET_SPEED = 4.2;         // slower than the hero: it can be outrun
const BULLET_HIT_RADIUS = 0.38;
const BULLET_LIFE = 2.6;          // seconds before a miss gives up
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
 *  Two, not three. With the tower count capped, every measured run ended the
 *  same way: the base never lost a life and the hero was shot to death while
 *  walking between build spots. That is the game inverted — walking to a spot
 *  is the mechanic, so being shot for walking is being shot for playing.
 *
 *  Without a cap, danger scales with the size of the wave: twenty saucers each
 *  firing every 2.4s within 3.4 units is a wall of bullets nobody dodges, and
 *  the measured result was a board that never lost a life while the hero was
 *  shot to death on wave eight. A cap keeps each enemy exactly as dangerous as
 *  it was and stops the crowd from being dangerous by arithmetic.
 *
 *  The boss is exempt — it is the one thing that is supposed to be personal. */
const MAX_SHOOTERS = 2;
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
const CRATE_GOLD = [12, 30];    // the range a gold crate pays
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
/** Hearts are rare. A kill that might pay health every time makes the hero's
 *  hit points stop being a resource. */
const HEART_DROP_CHANCE = 0.055;
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
  badge: string;
}
const BUFFS: BuffKind[] = [
  { id: 'strike', label: '⚔ Double strike', badge: '⚔' },
  { id: 'lucky', label: '💰 Lucky — richer bounties', badge: '💰' },
  { id: 'shield', label: '🛡 Shielded', badge: '🛡' },
  { id: 'overdrive', label: '⚡ Overdrive — towers reload faster', badge: '⚡' },
];

// --- towers ---------------------------------------------------------------
interface TowerKind {
  id: string;
  label: string;
  /** Shown in the hotbar. */
  icon: string;
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
  { id: 'ballista', label: 'Ballista', icon: '🏹', model: 'td-ballista', ammo: 'td-ammo-arrow',
    cost: 25, range: 3.0, damage: 2, reload: 1.0, shotSpeed: 9, mount: 'ground' },
  { id: 'cannon', label: 'Cannon', icon: '💣', model: 'td-cannon', ammo: 'td-ammo-ball',
    cost: 45, range: 2.2, damage: 5, reload: 2.0, shotSpeed: 7, mount: 'ground' },
  { id: 'catapult', label: 'Catapult', icon: '🪨', model: 'td-catapult', ammo: 'td-ammo-boulder',
    cost: 60, range: 4.2, damage: 7, reload: 3.0, shotSpeed: 5, mount: 'ground' },
  { id: 'turret', label: 'Turret', icon: '⚙️', model: 'td-turret', ammo: 'td-ammo-arrow',
    cost: 40, range: 2.6, damage: 1, reload: 0.28, shotSpeed: 12, mount: 'ground' },

  // On a tower. Bought at the smithy, one per level of it, and priced so that
  // one of these is three or four of the things above — the reason to want one
  // is REACH, for a corner two ground weapons cannot cover between them.
  { id: 'watchtower', label: 'Watchtower', icon: '🗼', model: 'td-ballista', ammo: 'td-ammo-arrow',
    cost: 120, range: 5.0, damage: 4, reload: 0.9, shotSpeed: 11,
    mount: 'tower', needsSmithy: 1,
    stack: ['td-tower-square-bottom-a', 'td-tower-square-middle-a', 'td-tower-square-top-a'] },
  { id: 'bastion', label: 'Bastion', icon: '🏰', model: 'td-cannon', ammo: 'td-ammo-ball',
    cost: 190, range: 4.0, damage: 12, reload: 1.9, shotSpeed: 8,
    mount: 'tower', needsSmithy: 2,
    stack: ['td-tower-square-bottom-b', 'td-tower-square-middle-b', 'td-tower-square-top-b'] },
  { id: 'spire', label: 'Spire', icon: '🔮', model: 'td-turret', ammo: 'td-ammo-arrow',
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
  /** How far along the path, in cells. Fractional between waypoints. */
  t: number;
  /** Which fork it took, chosen at spawn. Both gates are always live, so the
   *  question the board asks is no longer "where is the path" but "which half
   *  of it can I afford to leave thin". */
  route: number;
  alive: boolean;
  shootCooldown: number;
  windup: number;
  /** Bosses only: the rig's mixer, and the clip currently playing. */
  mixer?: THREE.AnimationMixer;
  actions?: Map<string, THREE.AnimationAction>;
  clip?: string;
  ground: boolean;
  facesTravel: boolean;
  ammo: string;
  damage: number;
  boss: boolean;
}

interface Tower {
  kind: TowerKind;
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
  /** Hearts on contact. The boss's boulder is worth two. */
  damage: number;
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

export type Weapon = 'sword' | 'bow' | 'staff';

/** Runs one level. Resolves when the player walks back out through the exit
 *  door — so the caller can hand control to the hub and start the loop again. */
/** What a finished run reports back. */
export interface LevelResult { won: boolean; wave: number; level: number; banked: number; }

export async function startLevel(
  shared: Shared, startWeapon: Weapon = 'sword', levelIndex = 0,
  bonus: TownBonus = NO_BONUS,
): Promise<LevelResult> {
  const level: LevelDef = LEVELS[Math.max(0, Math.min(levelIndex, LEVELS.length - 1))];
  const WAVES = level.waves;
  const SPAWN_GAP = level.spawnGap;
  const WAVE_GAP = level.waveGap;
  const { umicat, renderer, canvas, hudEl, audio } = shared;

  const [manifest, scene3d, pathData] = await Promise.all([
    fetch('scenes3d/manifest.json').then((r) => r.json() as Promise<Manifest3D>),
    fetch(`scenes3d/${level.id}.json`).then((r) => r.json() as Promise<Scene3D>),
    fetch(`scenes3d/${level.id}-path.json`).then((r) => r.json() as Promise<{
      routes: [number, number][][]; cells: [number, number][]; spots: [number, number][];
      scenery: [number, number][]; gates: string[]; blocked?: [number, number][];
    }>),
  ]);
  const world = await loadScene3D(scene3d, manifest, { assetBase: '', rapier: RAPIER });
  audio.setMusic(MUSIC.level);

  // --- Fold the board into a handful of draws ---
  //
  const folded = mergeStatic(world, scene3d, manifest);

  const hero = world.entities.get('hero')!;
  const marker = world.entities.get('build_marker')!;
  const saved = await umicat.saves.get<{ best: number; quality?: number }>(SAVE_KEY);
  let bestWave = saved?.best ?? 0;
  /** 0 = smooth, 1 = sharp. Persisted, because a setting you have to find
   *  again every run is a setting nobody uses. */
  // Sharp by default: measured at a steady 60 on an iPhone 14 Pro, which is
  // the machine that decides this. Smooth stays one tap away.
  let quality = saved?.quality ?? 1;

  // The path the enemies walk is the same polyline the tiles were laid from,
  // so what you see and what they follow cannot drift apart.
  // One list of waypoints per gate, each a complete walk from the spawn tile.
  // They share their first thirty cells; nothing here needs to know that.
  const ROUTES = pathData.routes;
  const BUILDABLE = new Set(pathData.spots.map(([x, z]) => `${x},${z}`));
  const ON_PATH = new Set(pathData.cells.map(([x, z]) => `${x},${z}`));
  /** The back field: cells that are neither road nor a place to build. Nothing
   *  else ever wants them, which is exactly why the crates go there. */
  const SCENERY = new Set((pathData.scenery ?? []).map(([x, z]) => `${x},${z}`));
  /** Water. Nothing is built there and nothing lands there. */
  const BLOCKED = new Set((pathData.blocked ?? []).map(([x, z]) => `${x},${z}`));
  const BACKFIELD: [number, number][] = [];
  for (let x = -5.5; x <= 5.5; x += 1) {
    for (let z = -5.5; z <= 5.5; z += 1) {
      const k = `${x},${z}`;
      // Not on the road, not on a build spot, and not inside a tree.
      if (!ON_PATH.has(k) && !BUILDABLE.has(k) && !SCENERY.has(k) && !BLOCKED.has(k)) {
        BACKFIELD.push([x, z]);
      }
    }
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
    speed: HERO_SPEED, stepHeight: 0.17, jumpSpeed: 2.8,
  });
  const input = new Input3D({
    actions: [
      { id: 'attack', label: '⚔', keys: ['KeyJ'] },
      { id: 'build', label: '🔨', keys: ['KeyB', 'KeyE'] },
    ],
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
  let bow: THREE.Object3D | null = null;
  let staff: THREE.Object3D | null = null;

  /** A staff, also built rather than loaded — a shaft and the kit's own
   *  crystal, which is already the right art for "this thing is magic". */
  const makeStaff = (): THREE.Object3D => {
    const g = new THREE.Object3D();
    const shaft = new THREE.Mesh(
      new THREE.CylinderGeometry(0.016, 0.02, 0.42, 6),
      new THREE.MeshStandardMaterial({ color: 0x6d4a2f, roughness: 0.9 }));
    const gem = new THREE.Mesh(
      new THREE.OctahedronGeometry(0.055),
      new THREE.MeshStandardMaterial({
        color: 0x9b6cff, emissive: 0x6a3fd6, emissiveIntensity: 0.9, roughness: 0.3 }));
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
    sword = loaded.object;
    sword.traverse((o) => { if ((o as THREE.Mesh).isMesh) (o as THREE.Mesh).castShadow = true; });
    attachToSocket(hero, handRight, sword);
    bow = makeBow();
    attachToSocket(hero, handRight, bow);
    staff = makeStaff();
    attachToSocket(hero, handRight, staff);
  }

  /** The hero carries all three and shows one. */
  let weapon: Weapon = startWeapon;
  /** Called once, with whatever came through the door. Not a control. */
  const setWeapon = (w: Weapon): void => {
    weapon = w;
    if (sword) sword.visible = w === 'sword';
    if (bow) bow.visible = w === 'bow';
    if (staff) staff.visible = w === 'staff';
    if (lockRing) lockRing.visible = false;
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
                    ...WAVES.map((w) => w.model), ...WAVES.map((w) => w.ammo ?? 'td-bullet'),
                    // Everything `dropPickup`, `dropCrate` and the tower
                    // levels can ask for. A model that is not here is not a
                    // missing texture — it is `undefined.type` thrown out of
                    // the clone, from whichever frame first needed it.
                    'td-bullet', 'td-coin', 'td-crystal',
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
  // --- Picture quality, as a button rather than a URL flag ---
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
  const resize = (): void => {
    renderer.setSize(window.innerWidth, window.innerHeight, false);
    world.camera.aspect = window.innerWidth / window.innerHeight;
    world.camera.updateProjectionMatrix();
  };
  resize();
  window.addEventListener('resize', resize);
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
  const maxTowers = level.maxTowers + bonus.towerCap;
  /** What the hotbar offers on this run. A tower mount you have not unlocked
   *  is not a greyed-out cell — it is not there, because a row of things you
   *  cannot buy is a row you learn to look past. */
  const KINDS = TOWERS.filter((k) => (k.needsSmithy ?? 0) <= bonus.smithy);
  const heroMaxHp = HERO_MAX_HP + bonus.hearts;
  // Every weapon, not just the sword. The Range says "+1 to your own attacks",
  // and a bonus that silently applied to one of three would be a lie told by
  // the only line of text the player ever reads about it.
  const baseHeroDamage = HERO_ATTACK_DAMAGE + bonus.heroDamage;
  /** What a swing is worth right now, effect included. A function rather than a
   *  constant, because "double strike" has to reach every weapon and every call
   *  site — a buff that reaches three of four looks broken to whoever notices.
   *  (`heroHit` is taken: it is the sphere a bullet is tested against.) */
  const withBuff = (base: number): number => base * (buff?.kind.id === 'strike' ? 2 : 1);
  const heroDamage = baseHeroDamage;
  let gold = level.startGold + bonus.gold;
  let lives = level.lives;
  let heroHp = heroMaxHp;
  let waveIndex = 0;
  // Countdown to the next wave. The FIRST one is longer than the rest: a board
  // with a short road gives the towers less time with everything that walks it,
  // and the answer to that is more time to build before it starts, not a
  // gentler wave one. Measured — Frostfall's opening cost eight of ten lives.
  let waveTimer = level.firstWaveDelay;
  /** Whether the wave at `waveIndex` has actually been sent out yet. */
  let waveLaunched = false;
  let spawnTimer = 0;
  let toSpawn = 0;
  let running = true;
  let won = false;
  // Long enough to walk out of the doorway. A board's road can pass close to
  // the door — on Meadow the whole north strip is inside enemy range — so
  // arriving used to mean taking fire before the first tower was up, which is
  // damage for nothing the player did.
  let invincible = 4;
  let selected = 0;             // which tower kind the build button places
  /** The fork alternates, so both gates stay under pressure all wave. */
  let nextRoute = 0;
  let buildCell: [number, number] | null = null;
  /** The tower under the player's feet, if any — the thing `build` upgrades. */
  let standingOn: Tower | null = null;

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
  const showRange = (at: [number, number] | null, radius: number, colour: number): void => {
    const on = at !== null;
    rangeRing.visible = on;
    rangeFill.visible = on;
    if (!on) return;
    rangeRing.position.set(at[0], 0.035, at[1]);
    rangeFill.position.set(at[0], 0.03, at[1]);
    rangeRing.scale.setScalar(radius);
    rangeFill.scale.setScalar(radius);
    (rangeRing.material as THREE.MeshBasicMaterial).color.setHex(colour);
    (rangeFill.material as THREE.MeshBasicMaterial).color.setHex(colour);
  };

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
  const corpses: { obj: THREE.Object3D; t: number; mixer: THREE.AnimationMixer | null }[] = [];
  const towers: Tower[] = [];
  const shots: Shot[] = [];
  const bullets: Bullet[] = [];
  // Everything that can flash has to be LISTED here, because `updateTints` only
  // restores what it is given. Flashing something that is not on this list
  // leaves it that colour for the rest of the run — the gates went red on the
  // first leak and stayed red, which reads as damage you cannot repair.
  const tinted: THREE.Object3D[] = [hero];
  for (const id of pathData.gates) {
    const g = world.entities.get(id);
    if (g) tinted.push(g);
  }

  // --- HUD ---
  const line1 = document.createElement('div');
  const line2 = document.createElement('div');
  const line3 = document.createElement('div');
  line3.style.opacity = '0.85';
  // Gold lives in its own element because a coin flying to the counter needs a
  // rectangle to aim at, and "somewhere in that line of text" is not one.
  const buffEl = document.createElement('span');
  buffEl.style.cssText = 'color:#ffd45e';
  const towerEl = document.createElement('span');
  const livesEl = document.createElement('span');
  const goldEl = document.createElement('span');
  const waveEl = document.createElement('span');
  goldEl.style.transition = 'transform 120ms ease-out';
  // ALL of them. The tower counter and the effect readout were created, had
  // their text set every frame, and were never put in the document — the same
  // shape of bug as a button rendered under the control layer, and just as
  // invisible from the code.
  line2.append(livesEl, goldEl, waveEl, towerEl, buffEl);
  const muteBtn = document.createElement('button');
  muteBtn.textContent = '🔊';
  muteBtn.style.cssText = `
    margin-top: 8px; width: 34px; height: 34px; border-radius: 17px; border: 0;
    background: rgba(0,0,0,.35); color: #fff; font-size: 15px; cursor: pointer;
    pointer-events: auto;   /* the HUD itself is click-through */
  `;
  muteBtn.onclick = () => {
    audio.setMuted(!audio.isMuted);
    muteBtn.textContent = audio.isMuted ? '🔇' : '🔊';
  };
  const qualityBtn = document.createElement('button');
  qualityBtn.style.cssText = muteBtn.style.cssText + 'width: auto; padding: 0 11px; margin-left: 6px;';
  const labelQuality = (): void => { qualityBtn.textContent = QUALITY[quality].name; };
  qualityBtn.onclick = () => {
    quality = (quality + 1) % QUALITY.length;
    applyQuality();
    labelQuality();
    void patchSave(umicat, { quality });
  };
  labelQuality();

  const buttons = document.createElement('div');
  buttons.style.cssText = 'display: flex; align-items: center; pointer-events: auto;';
  buttons.append(muteBtn, qualityBtn);
  hudEl.append(line1, line2, line3, buttons);

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
      // Full bars everywhere are noise and the interesting information is which
      // things are nearly dead — except for the boss, whose bar IS the fight's
      // progress bar and has to be there from the first hit to the last.
      if (frac >= 1 && !e.boss) { e.bar.visible = false; continue; }
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
  const castBurst = (at: THREE.Vector3): void => {
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.3, 0.44, 40),
      new THREE.MeshBasicMaterial({ color: 0xb58cff, transparent: true, opacity: 0.95,
        side: THREE.DoubleSide, depthWrite: false }));
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(at.x, at.y + 0.06, at.z);
    ring.userData.grow = STAFF_RADIUS / 0.37;
    world.scene.add(ring);
    updrafts.push({ obj: ring, t: 0, life: 0.42, spin: 0, rise: 0, r0: 0, a0: 0.95 });

    for (let i = 0; i < 18; i++) {
      const a0 = (i / 18) * Math.PI * 2;
      const mote = new THREE.Mesh(moteGeom, new THREE.MeshBasicMaterial({
        color: i % 2 ? 0xd9c2ff : 0x8b5cf6, transparent: true, opacity: 1, depthWrite: false }));
      const r0 = 0.4 + Math.random() * 0.5;
      mote.position.set(at.x + Math.cos(a0) * r0, at.y + 0.1, at.z + Math.sin(a0) * r0);
      mote.userData.cx = at.x; mote.userData.cz = at.z;
      mote.scale.setScalar(1.6);
      world.scene.add(mote);
      updrafts.push({ obj: mote, t: 0, life: 0.5 + Math.random() * 0.3,
                      spin: 3.4 + Math.random() * 2, rise: 1.6 + Math.random(), r0, a0 });
    }
  };

  /** Motes lifting off an upgraded tower — the updraft.
   *
   *  In the scene rather than in the DOM, because it has to sit in the world
   *  next to the tower it belongs to: a DOM flourish over the same pixels
   *  stops being attached to anything the moment the camera turns.
   *
   *  Deliberately cheap: a dozen unlit quads, no texture, no particle system.
   *  They rise, spiral a little, shrink and fade, and are gone in under a
   *  second — long enough to see, short enough that upgrading three towers in
   *  a row does not become a light show. */
  const updrafts: { obj: THREE.Mesh; t: number; life: number; spin: number; rise: number; r0: number; a0: number }[] = [];
  const moteGeom = new THREE.PlaneGeometry(0.09, 0.09);

  const updraft = (at: THREE.Vector3): void => {
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.18, 0.34, 24),
      new THREE.MeshBasicMaterial({ color: 0xffe08a, transparent: true, opacity: 0.9,
        side: THREE.DoubleSide, depthWrite: false }));
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(at.x, at.y + 0.05, at.z);
    world.scene.add(ring);
    updrafts.push({ obj: ring, t: 0, life: 0.55, spin: 0, rise: 0.55, r0: 0, a0: 0.9 });

    for (let i = 0; i < 12; i++) {
      const a0 = (i / 12) * Math.PI * 2;
      const r0 = 0.16 + Math.random() * 0.16;
      const mote = new THREE.Mesh(moteGeom, new THREE.MeshBasicMaterial({
        color: i % 3 === 0 ? 0xfff2c4 : 0xffc94d, transparent: true, opacity: 1, depthWrite: false,
      }));
      mote.position.set(at.x + Math.cos(a0) * r0, at.y + 0.04, at.z + Math.sin(a0) * r0);
      mote.userData.cx = at.x; mote.userData.cz = at.z;
      world.scene.add(mote);
      updrafts.push({ obj: mote, t: 0, life: 0.7 + Math.random() * 0.35,
                      spin: 2.2 + Math.random() * 1.6, rise: 0.95 + Math.random() * 0.7, r0, a0 });
    }
  };

  const updateUpdrafts = (dt: number): void => {
    for (let i = updrafts.length - 1; i >= 0; i--) {
      const u = updrafts[i];
      u.t += dt;
      const k = u.t / u.life;
      if (k >= 1) {
        world.scene.remove(u.obj);
        (u.obj.material as THREE.Material).dispose();
        if (u.obj.geometry !== moteGeom) u.obj.geometry.dispose();
        updrafts.splice(i, 1);
        continue;
      }
      const mat = u.obj.material as THREE.MeshBasicMaterial;
      if (u.spin === 0) {
        // The ring: expands outward and thins away. A cast ring grows all the
        // way to the spell's radius, so the effect and the rule are the same
        // shape.
        const g = 1 + k * ((u.obj.userData.grow as number) ?? 1.5);
        u.obj.scale.setScalar(g);
        mat.opacity = u.a0 * (1 - k);
      } else {
        // A mote: rises, drifts round, and always faces the camera so a flat
        // quad never shows its edge.
        const a = u.a0 + k * u.spin;
        const r = u.r0 * (1 + k * 0.5);
        u.obj.position.y += u.rise * dt;
        u.obj.position.x = (u.obj.userData.cx as number) + Math.cos(a) * r;
        u.obj.position.z = (u.obj.userData.cz as number) + Math.sin(a) * r;
        u.obj.scale.setScalar(1 - k * 0.55);
        mat.opacity = 1 - k * k;
        u.obj.quaternion.copy(world.camera.quaternion);
      }
    }
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
  interface Arrow { obj: THREE.Object3D; vel: THREE.Vector3; life: number; }
  const arrows: Arrow[] = [];
  const ARROW_SPEED = 11;
  const ARROW_DAMAGE = 3 + bonus.heroDamage;
  const ARROW_LIFE = 1.6;
  const ARROW_HIT = 0.42;
  /** How far the bow finds a target on its own. Auto-aim, because picking a
   *  direction with a thumbstick while something circles you is not a skill
   *  anyone wants to practise — and because the lock frame makes the range a
   *  thing you can SEE rather than a number in a file. */
  const BOW_RANGE = 4.6;
  /** The staff hits everything around you at once, so it is on a real
   *  cooldown rather than just the animation's length. */
  const STAFF_RADIUS = 2.6;
  const STAFF_DAMAGE = 4 + bonus.heroDamage;
  const STAFF_COOLDOWN = 1.7;
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
    kind: 'coin' | 'heart';
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
  const dropPickup = (from: THREE.Vector3, amount: number, forceKind?: 'coin' | 'heart'): void => {
    // A heart only when one is missing — the same rule the crates follow, for
    // the same reason: a drop that does nothing is worse than a drop of gold.
    const kind = forceKind
      ?? (heroHp < heroMaxHp && Math.random() < HEART_DROP_CHANCE ? 'heart' : 'coin');
    const obj = spawnFrom(kind === 'heart' ? 'td-crystal' : 'td-coin');
    if (kind === 'heart') {
      // The kit has no heart, and the crystal is purple. Its own copy of the
      // material, red — cloning matters because models cut from one file SHARE
      // materials, and recolouring this one would recolour every crystal on the
      // board including the scenery.
      obj.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (!mesh.isMesh) return;
        const paint = (m: THREE.Material): THREE.Material => {
          const c = (m as THREE.MeshStandardMaterial).clone() as THREE.MeshStandardMaterial;
          c.color.setHex(0xff4f6e);
          c.emissive?.setHex(0x51101d);
          return c;
        };
        mesh.material = Array.isArray(mesh.material)
          ? mesh.material.map(paint) : paint(mesh.material);
      });
    }
    obj.position.copy(from);
    obj.position.y = Math.max(from.y, 0.2);
    obj.scale.setScalar(kind === 'heart' ? 0.5 : 0.55);
    pickups.push({
      obj, kind, amount, t: 0, taken: false,
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

  /** Anything the hero swings at, shoots or blasts also breaks crates. Called
   *  from all three weapons rather than folded into `damage`, because a crate
   *  is not an enemy: towers ignore it, it does not walk, and giving it an
   *  Enemy record would mean every loop over enemies having to say so. */
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
        buff = { kind, left: BUFF_SECONDS };
        flashBanner(kind.label);
        audio.play('win');
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
        dropPickup(c.obj.position, 0, 'heart');
      } else {
        const amount = CRATE_GOLD[0] + Math.floor(Math.random() * (CRATE_GOLD[1] - CRATE_GOLD[0] + 1));
        dropPickup(c.obj.position, amount, 'coin');
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
      q.obj.rotation.y += dt * (q.kind === 'heart' ? 2.4 : 7);

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
        if (q.kind === 'heart') {
          heroHp = Math.min(heroMaxHp, heroHp + 1);
          audio.play('coin');
          flashTint(hero, { color: 0xff5f7a, ms: 260 });
        } else {
          gold += q.amount;
          audio.play('coin');
          goldEl.style.transform = 'scale(1.22)';
          setTimeout(() => { goldEl.style.transform = 'scale(1)'; }, 120);
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
    position: fixed; left: 50%; bottom: 14px; transform: translateX(-50%);
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
  /** How wide a cell can be and still leave all of them on one row. */
  const cellWidthNow = (): number =>
    Math.max(40, Math.min(62,
      Math.floor((window.innerWidth * 0.96 - 6 * KINDS.length) / KINDS.length)));

  const placeHotbar = (): void => {
    hotbar.style.bottom = '14px';
    // Re-measured, because rotating the phone changes how much room there is —
    // the same reason the bar's POSITION is re-measured rather than computed
    // once from vmin.
    const w = cellWidthNow();
    for (const c of hotbar.children) (c as HTMLElement).style.width = `${w}px`;
    const layer = document.querySelector('[data-umicat-touch]');
    if (!layer) return;
    const controls = [...layer.querySelectorAll('div')]
      .filter((d) => getComputedStyle(d).pointerEvents === 'auto')
      .map((d) => d.getBoundingClientRect())
      // The move and look zones are half the screen each; they are not what a
      // hotbar can collide with in any useful sense.
      .filter((r) => r.height < window.innerHeight * 0.5 && r.width > 10);
    if (!controls.length) return;
    // Climb until it is clear, re-measuring each time. One lift is not enough:
    // clearing the bottom row of buttons lands the bar in the row above it,
    // because the cluster wraps. Four passes is more than any layout needs and
    // still terminates.
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
    // Narrow enough that all of them fit one row on the narrowest phone.
    cell.style.cssText = `
      width: ${cellWidthNow()}px; padding: 6px 3px 5px; border-radius: 12px; border: 2px solid transparent;
      pointer-events: auto;
      background: rgba(0,0,0,.42); color: #fff; font: inherit; cursor: pointer;
      display: flex; flex-direction: column; align-items: center; gap: 2px;
      -webkit-tap-highlight-color: transparent;
    `;
    cell.innerHTML =
      `<span style="font-size:19px;line-height:1">${kind.icon}</span>` +
      `<span>${kind.label}</span>` +
      `<span class="cost" style="opacity:.85">${kind.cost}g</span>` +
      `<span style="opacity:.45;font-size:10px">${i + 1}</span>`;
    cell.onclick = () => { selected = i; refreshHotbar(); audio.play('build'); renderHud(); };
    hotbar.appendChild(cell);
    return cell;
  });

  function refreshHotbar(): void {
    cells.forEach((cell, i) => {
      const affordable = gold >= KINDS[i].cost;
      cell.style.borderColor = i === selected ? '#ffd54a' : 'transparent';
      cell.style.background = i === selected ? 'rgba(0,0,0,.62)' : 'rgba(0,0,0,.42)';
      // Dimmed rather than disabled: you can still select what you are saving
      // up for, and the price is the feedback.
      cell.style.opacity = affordable ? '1' : '0.45';
    });
  }

  placeHotbar();

  window.addEventListener('keydown', (e) => {
    const n = Number(e.key);
    if (n >= 1 && n <= KINDS.length) { selected = n - 1; refreshHotbar(); renderHud(); }
  });

  const renderHud = (): void => {
    line1.textContent = `${'❤️'.repeat(Math.max(heroHp, 0))}${'🤍'.repeat(Math.max(heroMaxHp - heroHp, 0))}`;
    const w = Math.min(waveIndex + 1, WAVES.length);
    livesEl.textContent = `🏰 ${lives}\u2003`;
    goldEl.textContent = `💰 ${gold}`;
    waveEl.textContent = `\u2003Wave ${w}/${WAVES.length}`;
    towerEl.textContent = `\u2003🗼 ${towers.length}/${maxTowers}`;
    buffEl.textContent = buff ? `\u2003${buff.kind.badge} ${Math.ceil(buff.left)}s` : '';
    // A PROMPT, not narration. This line is empty unless the player is standing
    // somewhere the button does something, and then it is three or four words.
    // A sentence explaining the game that is on screen the whole time is a
    // sentence nobody reads twice and everybody looks past.
    if (standingOn) {
      const t = standingOn;
      line3.textContent = t.level >= MAX_LEVEL
        ? `${t.kind.label} Lv${MAX_LEVEL} · max`
        : `🔨 Lv${t.level + 1} · ${upgradeCost(t)}g`;
    } else if (atCrate) {
      line3.textContent = '⚔ break open';
    } else if (buildCell) {
      const kind = KINDS[selected];
      line3.textContent = `🔨 ${kind.label} · ${kind.cost}g`;
    } else {
      line3.textContent = '';
    }
    refreshHotbar();
  };

  const endRun = (didWin: boolean): void => {
    // Once. A second call re-opens the exit, which means removing a rigid body
    // that is already gone — and Rapier answers that with an unrecoverable
    // `unreachable` trap out of the wasm, not an exception anyone can catch.
    // Two things can plausibly end the same run in the same breath: the last
    // life going and the hero falling.
    if (!running) return;
    running = false; won = didWin;
    // Stop taking input and take the on-screen controls away. Both halves
    // matter: the thumbstick would otherwise keep walking the character behind
    // the dialog, and its full-screen layer would swallow the taps meant for
    // the button on top of it.
    // Input stays ON. The run is over, but walking to the door is the last
    // thing the player does, and taking the controls away would strand them.
    hotbar.style.display = 'none';
    // The ending gets the room to itself.
    audio.duck(10);
    audio.play(didWin ? 'win' : 'lose');
    const reached = Math.min(waveIndex + 1, WAVES.length);
    if (reached > bestWave) {
      bestWave = reached;
      void patchSave(umicat, { quality });
    }
    // The shared board. A guest run is not recorded — writing needs a signed-in
    // player — and that is handled inside rather than being a caller's problem.
    void submitScore(umicat, reached);
    banner.style.display = 'block';
    banner.innerHTML = didWin
      ? `<div>All waves cleared</div><div style="font:600 15px/1.6 system-ui;opacity:.85">The woods are safe.</div>`
      : `<div>${lives <= 0 ? 'The base fell' : 'You were knocked out'}</div>` +
        `<div style="font:600 15px/1.6 system-ui;opacity:.85">Reached wave ${Math.min(waveIndex + 1, WAVES.length)} of ${WAVES.length}.</div>`;
    banner.innerHTML += `<div style="margin-top:12px;font:600 14px/1.6 system-ui;opacity:.8">
      A door has opened at the far end — walk through it to go back.</div>`;

    // The way out is a door in the world, not a button on top of it. The
    // banner stops being a wall you have to dismiss and becomes a caption on
    // something you are already standing in.
    for (const id of ['exit_door', 'exit_frame']) {
      const o = world.entities.get(id);
      if (o) o.visible = true;
    }
    // And take out the block filling the doorway — the door's width, not the
    // whole side. A door you can see and cannot reach is worse than no door,
    // because the collider is what stops you and it does not care that
    // something was drawn in front of it; but removing the whole wall turns the
    // entire top of the board into the exit.
    const wall = world.bodies.get('exit_block');
    if (wall) world.world.removeRigidBody(wall);
    const wallMesh = world.entities.get('exit_block');
    if (wallMesh) wallMesh.visible = false;
  };

  // --- the path, as a position lookup -------------------------------------
  const posAt = (route: number, t: number, y: number, out: THREE.Vector3): THREE.Vector3 => {
    const path = ROUTES[route];
    const i = Math.floor(t);
    if (i >= path.length - 1) {
      const last = path[path.length - 1];
      return out.set(last[0], y, last[1]);
    }
    const a = path[i], b = path[i + 1], f = t - i;
    return out.set(a[0] + (b[0] - a[0]) * f, y, a[1] + (b[1] - a[1]) * f);
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
  const tryBuild = (): void => {
    if (!running) return;

    if (standingOn) {
      const t = standingOn;
      if (t.level >= MAX_LEVEL) { audio.play('denied'); flashBanner(`${t.kind.label} is fully upgraded`); return; }
      const cost = upgradeCost(t);
      if (gold < cost) { audio.play('denied'); flashBanner(`Upgrade costs ${cost}g`); return; }
      gold -= cost;
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

    if (!buildCell) return;
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
  function flashBanner(text: string): void {
    toast.textContent = text;
    toast.style.display = 'block';
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { toast.style.display = 'none'; }, 1400);
  }

  // --- combat --------------------------------------------------------------
  const tmp = new THREE.Vector3();
  const _q = new THREE.Quaternion();
  const heroAttack = (): void => {
    if (!running || animator.busy) return;

    if (weapon === 'staff') {
      if (staffCooldown > 0) return;
      staffCooldown = STAFF_COOLDOWN;
      animator.play('interact');
      audio.play('upgrade');
      // Centred on what you have locked, not on yourself. A burst that always
      // goes off underfoot makes the spell about walking into a crowd; one you
      // can place makes it about choosing which crowd.
      const at = lockTarget?.alive ? lockTarget.obj.position : hero.position;
      castBurst(at);
      if (lockTarget?.alive) {
        hero.rotation.y = Math.atan2(at.x - hero.position.x, at.z - hero.position.z);
      }
      let struck = 0;
      for (const e of enemies) {
        if (!e.alive) continue;
        const d = Math.hypot(e.obj.position.x - at.x, e.obj.position.z - at.z);
        if (d > STAFF_RADIUS) continue;
        struck += 1;
        damage(e, withBuff(STAFF_DAMAGE));
      }
      hitCrates(at.x, at.z, STAFF_RADIUS, 2);
      if (struck) audio.play('enemy-die');
      return;
    }

    if (weapon === 'bow') {
      animator.play('holdBothShoot');
      audio.play('enemy-shot');
      const arrow = spawnFrom('td-ammo-arrow');
      // Towards the lock if there is one, otherwise straight ahead. Auto-aim
      // is what makes a bow usable with a thumb; the fallback keeps it from
      // being a button that does nothing when the board is empty.
      let dirX = Math.sin(hero.rotation.y), dirZ = Math.cos(hero.rotation.y);
      if (lockTarget?.alive) {
        const dx = lockTarget.obj.position.x - hero.position.x;
        const dz = lockTarget.obj.position.z - hero.position.z;
        const len = Math.hypot(dx, dz) || 1;
        dirX = dx / len; dirZ = dz / len;
        hero.rotation.y = Math.atan2(dirX, dirZ);
      }
      arrow.position.set(hero.position.x + dirX * 0.3, hero.position.y + 0.34, hero.position.z + dirZ * 0.3);
      arrow.lookAt(arrow.position.x + dirX, arrow.position.y, arrow.position.z + dirZ);
      arrows.push({
        obj: arrow, life: ARROW_LIFE,
        vel: new THREE.Vector3(dirX * ARROW_SPEED, 0, dirZ * ARROW_SPEED),
      });
      return;
    }

    animator.play('attack');
    audio.play('swing');
    let connected = false;
    for (const e of enemies) {
      if (!e.alive) continue;
      const d = Math.hypot(e.obj.position.x - hero.position.x, e.obj.position.z - hero.position.z);
      if (d > HERO_ATTACK_RANGE) continue;
      connected = true;
      damage(e, withBuff(heroDamage));
    }
    // A swing that connects sounds different from one that whiffs. Without
    // that, melee is a noise you make rather than a thing you do.
    if (hitCrates(hero.position.x, hero.position.z, HERO_ATTACK_RANGE, 1)) connected = true;
    if (connected) audio.play('sword-hit');
  };

  const damage = (e: Enemy, amount: number): void => {
    e.hp -= amount;
    flashTint(e.obj, { color: 0xff3020, ms: 160 });
    if (e.hp > 0) { audio.play('hit-enemy'); return; }
    audio.play('enemy-die');
    e.alive = false;
    if (e.boss) {
      // It does not blink out. A thousand-hit-point fight ending on a frame
      // where the model simply stops existing is the anticlimax of the run, so
      // it falls over, and the payout arrives as a handful of coins rather than
      // one.
      flashBanner('THE WARLORD FALLS');
      playEnemyClip(e, 'die', false);
      corpses.push({ obj: e.obj, t: 0, mixer: e.mixer ?? null });
      const share = Math.round(e.bounty * BOUNTY_SCALE * (buff?.kind.id === 'lucky' ? 1.6 : 1) / 6);
      for (let i = 0; i < 6; i++) dropPickup(e.obj.position, share, 'coin');
      return;
    }
    e.obj.visible = false;
    dropPickup(e.obj.position,
      Math.round(e.bounty * BOUNTY_SCALE * (buff?.kind.id === 'lucky' ? 1.6 : 1)));
  };

  const hurtHero = (amount = 1): void => {
    if (invincible > 0 || !running) return;
    if (buff?.kind.id === 'shield') { flashTint(hero, { color: 0x6ec8ff, ms: 200 }); return; }
    invincible = HERO_INVINCIBLE_SECONDS;
    heroHp -= amount;
    audio.play('hero-hurt');
    flashScreen();
    flashTint(hero, { color: 0xff2a1a, ms: 220 });
    renderHud();
    if (heroHp <= 0) knockOut();
  };

  /** The hero falls — and gets back up.
   *
   *  Losing the whole run to it was the single loudest thing in every measured
   *  game: the base would be untouched at ten of ten lives and the run would end
   *  because the hero had been shot while walking between build spots. Walking
   *  to a spot IS the mechanic, so dying for walking is dying for playing.
   *
   *  So it costs a life off the base instead — the two failure conditions were
   *  already there, and this makes them one resource rather than two ways to
   *  lose. You are carried back to the door, which is the far end of the board
   *  from wherever the trouble was, and that walk back is the real punishment.
   */
  const knockOut = (): void => {
    if (!running) return;
    lives -= 1;
    heroHp = Math.max(3, Math.ceil(heroMaxHp / 2));
    invincible = 3.2;
    audio.play('lose');
    flashScreen();
    flashBanner('Knocked out · a life lost');
    character.teleport(SPAWN);
    glide.x = 0; glide.z = 0;
    renderHud();
    if (lives <= 0) endRun(false);
  };

  // Left click swings. `button`/`pointerType` checked because the right button
  // is the camera and touch already has the ⚔ button — see CLAUDE.md.
  canvas.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || e.pointerType === 'touch') return;
    heroAttack();
  });
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
  renderHud();
  // Everything is loaded, warmed and placed; the next frame is a real one.
  hideLoading();

  const debug = createDebugHud(renderer, hudEl);
  const shadowOf = (): string => {
    const d = world.scene.children.find((c) => (c as THREE.DirectionalLight).isDirectionalLight) as THREE.DirectionalLight | undefined;
    return d ? `${d.shadow.mapSize.width}` : 'none';
  };

  /** Same shape as the hub's: a doorway, not a line across the top of the
   *  board. Taking the whole north wall out made every step along the top an
   *  exit. */
  const EXIT_AT = { x: 0, z: -6.2 };
  const EXIT_HALF_WIDTH = 0.62;
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

  renderer.setAnimationLoop((now: number) => {
    const dt = Math.min((now - last) / 1000, 0.05);
    last = now;

    const turn = input.look();
    if (turn.x || turn.y) world.orbit(turn.x, turn.y);

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
    character.update(dt, move, { jump: input.jump });
    if (character.position.y < RESPAWN_BELOW_Y) character.teleport(SPAWN);
    character.syncTo(hero, HERO_SYNC_OFFSET);
    character.faceTowards(hero, move, dt);
    animator.update(character.state);

    if (running) {
      if (input.consume('attack')) heroAttack();
      if (input.consume('build')) tryBuild();
      if (invincible > 0) invincible -= dt;
      if (staffCooldown > 0) staffCooldown -= dt;

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

      // Where the player could build right now. Recomputed every frame because
      // it is a function of where they are standing — a cached answer is one
      // that is wrong the moment they walk.
      const cell = cellOf(hero.position.x, hero.position.z);
      const key = `${cell[0]},${cell[1]}`;
      const here = occupied.get(key) ?? null;
      const canBuild = !here && BUILDABLE.has(key);
      const before = `${standingOn ? standingOn.cell.join(',') : ''}|${buildCell ? key : ''}`;
      standingOn = here;
      buildCell = canBuild ? cell : null;
      // The ring marks anywhere the button will DO something, built or not —
      // otherwise standing on your own tower looks like standing on grass.
      marker.visible = canBuild || !!here;
      if (marker.visible) marker.position.set(cell[0], 0.03, cell[1]);
      // What the thing under your feet can reach. Green for a tower that is
      // already there, white for the one you are about to put down.
      if (here) showRange(here.cell, levelRange(here), 0x8effa0);
      else if (canBuild) showRange(cell, KINDS[selected].range, 0xffffff);
      else showRange(null, 0, 0);
      const nearCrate = crates.some((c) =>
        c.hp > 0 && Math.hypot(c.obj.position.x - hero.position.x, c.obj.position.z - hero.position.z) < 1.0);
      const changed = before !== `${standingOn ? standingOn.cell.join(',') : ''}|${buildCell ? key : ''}`
        || nearCrate !== atCrate;
      atCrate = nearCrate;
      if (changed) renderHud();

      // --- waves ---
      if (toSpawn > 0) {
        spawnTimer -= dt;
        if (spawnTimer <= 0) {
          spawnTimer = SPAWN_GAP;
          toSpawn -= 1;
          const w = WAVES[waveIndex];
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
            armed: w.armed, bar, barFill,
            // Alternate, rather than choose at random. Both lanes stay live all
            // wave, which is the point of the fork; randomness would sometimes
            // send fifteen of sixteen down one side and read as a bug.
            t: 0, route: nextRoute, alive: true, shootCooldown: 1, windup: 0,
            ground: w.ground ?? false, facesTravel: w.facesTravel ?? false,
            ammo: w.ammo ?? 'td-bullet', damage: w.damage ?? 1, boss: w.boss ?? false,
          };
          nextRoute = (nextRoute + 1) % ROUTES.length;
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
          posAt(e.route, 0, e.ground ? 0 : ENEMY_FLY_HEIGHT, obj.position);
          enemies.push(e);
          tinted.push(obj);
        }
      } else if (enemies.every((e) => !e.alive)) {
        waveTimer -= dt;
        if (waveTimer <= 0) {
          // Advance FIRST, then launch. Without the increment this re-launched
          // wave one forever: every mechanic worked, the HUD read "Wave 1/4"
          // the whole time, and the game could not be won or lost to anything
          // but the first five critters.
          if (waveLaunched) {
            waveIndex += 1;
            waveLaunched = false;
            // Surviving a wave gives a heart back. Six hearts and no way to
            // heal was survivable over eight waves and a slow death over
            // twelve: with no recovery a long run is lost to accumulated
            // carelessness rather than to any particular wave, and the lull
            // between waves is the natural place to hand it back.
            if (heroHp < heroMaxHp && waveIndex < WAVES.length) {
              heroHp = Math.min(heroMaxHp, heroHp + 2);
              flashBanner('Wave cleared · +2 ❤️');
            }
          }
          if (waveIndex >= WAVES.length) { endRun(true); }
          else {
            toSpawn = WAVES[waveIndex].count;
            spawnTimer = 0;
            waveTimer = WAVE_GAP;
            waveLaunched = true;
            audio.play('wave');
            renderHud();
          }
        }
      }

      // --- enemies walk the path ---
      // How many are already committed to a shot. Counted before the loop so
      // the cap is about the board, not about who happens to be early in the
      // list.
      let shooters = 0;
      for (const e of enemies) if (e.alive && e.windup > 0 && !e.boss) shooters += 1;
      for (const e of enemies) {
        if (!e.alive) continue;
        e.t += (e.speed * dt);
        e.mixer?.update(dt);
        if (e.t >= ROUTES[e.route].length - 1) {
          // It reached the gate. That is what the towers were for.
          e.alive = false;
          e.obj.visible = false;
          lives -= 1;
          audio.play('leak');
          flashScreen();
          // WHICH gate, not just "a life gone". With one lane the screen flash
          // told you everything; with two it tells you half of it, and the half
          // it leaves out is the one you would act on.
          const gate = world.entities.get(pathData.gates[e.route]);
          if (gate) flashTint(gate, { color: 0xff2a1a, ms: 420 });
          renderHud();
          if (lives <= 0) { endRun(false); break; }
          continue;
        }
        const prevX = e.obj.position.x, prevZ = e.obj.position.z;
        posAt(e.route, e.t, e.ground ? 0 : ENEMY_FLY_HEIGHT, e.obj.position);
        if (e.facesTravel) {
          // Face where it is going. A walk cycle playing sideways is the kind of
          // wrong that reads as the model being broken rather than the code.
          const dx = e.obj.position.x - prevX, dz = e.obj.position.z - prevZ;
          if (dx * dx + dz * dz > 1e-8) e.obj.rotation.y = Math.atan2(dx, dz);
        } else {
          e.obj.rotation.y += dt * 1.6;   // UFOs spin; it reads as "alive"
        }

        // Shooting the hero. Same shape as the tower's: a wind-up you can see
        // and walk out of, rather than damage for standing nearby.
        const dHero = Math.hypot(e.obj.position.x - hero.position.x, e.obj.position.z - hero.position.z);
        if (e.windup > 0) {
          e.windup -= dt;
          if (e.windup <= 0) {
            // Fire at where the hero IS, and then forget about them. A bullet
            // that steers is a slower contact hit wearing a costume.
            const v = new THREE.Vector3(
              hero.position.x - e.obj.position.x,
              (hero.position.y + 0.3) - e.obj.position.y,
              hero.position.z - e.obj.position.z,
            );
            if (v.lengthSq() < 1e-6) v.set(0, 0, 1);
            v.normalize();
            const bullet = spawnFrom(e.ammo);
            // Out in front, not from inside the hull. Spawned at the centre it
            // could already be past the player, and at close range it crossed
            // the gap faster than a frame — invisible damage for being nearby,
            // which is the thing this was supposed to replace.
            bullet.position.copy(e.obj.position).addScaledVector(v, BULLET_MUZZLE);
            bullet.lookAt(bullet.position.clone().add(v));
            paintShot(bullet, e.boss ? 0xff3a1e : 0xff2d6b);
            if (e.boss) bullet.scale.setScalar(1.6);
            bullets.push({
              obj: bullet, vel: v.multiplyScalar(e.boss ? BULLET_SPEED * 0.85 : BULLET_SPEED),
              life: BULLET_LIFE, damage: e.damage,
            });
            audio.play(e.boss ? 'cannon-shot' : 'enemy-shot');
            if (e.mixer) playEnemyClip(e, 'walk');
          }
        } else if (e.shootCooldown > 0) {
          e.shootCooldown -= dt;
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

      // --- towers shoot ---
      for (const t of towers) {
        t.reload -= dt;
        // Nearest FIRST, not nearest overall: in a tower defense the one
        // closest to the end is the one about to cost you a life.
        let target: Enemy | null = null;
        for (const e of enemies) {
          if (!e.alive) continue;
          const d = Math.hypot(e.obj.position.x - t.cell[0], e.obj.position.z - t.cell[1]);
          if (d > levelRange(t)) continue;
          if (!target || e.t > target.t) target = e;
        }
        if (target) {
          // Face it even while reloading — a turret tracking its target is how
          // a player reads "this one is covering that corner".
          t.mount.rotation.y = Math.atan2(
            target.obj.position.x - t.cell[0], target.obj.position.z - t.cell[1]);
        }
        if (target && t.reload <= 0) {
          t.reload = levelReload(t) * (buff?.kind.id === 'overdrive' ? 0.55 : 1);
          const shot = spawnFrom(t.kind.ammo);
          // From the weapon, which is now somewhere up a tower — a level-three
          // catapult firing out of the grass at its feet looks like a bug.
          shot.position.copy(t.mount.getWorldPosition(_muzzle));
          shots.push({ obj: shot, target, damage: levelDamage(t), speed: t.kind.shotSpeed });
          audio.play(t.kind.id === 'cannon' ? 'cannon-shot' : 'tower-shot');
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

      // --- things finishing their death animation ---
      for (let i = corpses.length - 1; i >= 0; i--) {
        const c = corpses[i];
        c.t += dt;
        c.mixer?.update(dt);
        if (c.t > CORPSE_SECONDS) {
          // Sink it rather than snapping it out of existence.
          c.obj.position.y -= dt * 0.9;
          if (c.t > CORPSE_SECONDS + 1.2) { world.scene.remove(c.obj); corpses.splice(i, 1); }
        }
      }

      // --- enemy bullets fly ---
      for (let i = bullets.length - 1; i >= 0; i--) {
        const bu = bullets[i];
        bu.life -= dt;
        prevPos.copy(bu.obj.position);
        bu.obj.position.addScaledVector(bu.vel, dt);
        // Swept, not sampled. A bullet fired from touching distance covers the
        // whole gap inside one frame, and a point test at each end would find
        // it on neither side of the player it just went through.
        const hit = segmentHitsSphere(prevPos, bu.obj.position,
          heroHit.set(hero.position.x, hero.position.y + 0.3, hero.position.z), BULLET_HIT_RADIUS);
        if (hit || bu.life <= 0 || Math.abs(bu.obj.position.x) > 7 || Math.abs(bu.obj.position.z) > 7) {
          if (hit) hurtHero(bu.damage);
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
        if (hit) damage(hit, withBuff(ARROW_DAMAGE));
        const brokeCrate = !hit && hitCrates(a.obj.position.x, a.obj.position.z, ARROW_HIT, 1);
        if (hit || brokeCrate || a.life <= 0 || Math.abs(a.obj.position.x) > 7 || Math.abs(a.obj.position.z) > 7) {
          world.scene.remove(a.obj);
          arrows.splice(i, 1);
        }
      }

      // --- tower shots fly ---
      for (let i = shots.length - 1; i >= 0; i--) {
        const s = shots[i];
        if (!s.target.alive) { world.scene.remove(s.obj); shots.splice(i, 1); continue; }
        dir.copy(s.target.obj.position).sub(s.obj.position);
        const dist = dir.length();
        if (dist < 0.25) {
          damage(s.target, s.damage);
          world.scene.remove(s.obj);
          shots.splice(i, 1);
          continue;
        }
        dir.normalize();
        s.obj.position.addScaledVector(dir, Math.min(dist, s.speed * dt));
        s.obj.lookAt(s.target.obj.position);
      }
    }

    debug.tick(now, dt, `shadow ${shadowOf()}`);

    // Out through the door, back to the hub. Only once the run is over — the
    // wall is solid until then, and the door is not even drawn.
    const inExit = hero.position.z < EXIT_AT.z
      && Math.abs(hero.position.x - EXIT_AT.x) < EXIT_HALF_WIDTH;
    if (!running && inExit && leave) {
      const go = leave; leave = null;
      audio.play(SFX.door);
      renderer.setAnimationLoop(null);
      window.removeEventListener('resize', resize);
      input.dispose();
      banner.remove(); hotbar.remove(); toast.remove(); hitFlash.remove();
      debug.dispose();
      hudEl.textContent = '';
      world.dispose();
      world.scene.clear();
      // The handle goes with it. A debug handle that outlives the thing it
      // describes is worse than none: anything asking "am I in the level?" is
      // told yes by the corpse of the last one.
      delete (window as unknown as Record<string, unknown>).__game;
      go({
        won, wave: Math.min(waveIndex + 1, WAVES.length), level: levelIndex,
        // Whatever is left over comes home. Measured runs were sitting on 1600
        // unspendable gold by wave seven — a currency with nowhere to go stops
        // being a decision, and the hub is where it can become one.
        banked: gold,
      });
      return;
    }

    updatePickups(dt);
    updateHealthBars();
    updateUpdrafts(dt);
    updateTints(tinted);
    world.update(dt);
    renderer.render(world.scene, world.camera);
  });

  Object.assign(window as unknown as Record<string, unknown>, {
    __game: {
      umicat, world, character, input, animator,
      get enemies() { return enemies; },
      get towers() { return towers; },
      get shots() { return shots; },
      get bullets() { return bullets; },
      get arrows() { return arrows; },
      weapon: () => weapon,
      lock: () => (lockTarget ? { hp: lockTarget.hp, visible: lockRing?.visible ?? false } : null),
      setWeapon: (w: Weapon) => setWeapon(w),
      get updrafts() { return updrafts; },
      get pickups() { return pickups; },
      /** Drop one on demand, for a probe that should not have to wait for a
       *  tower to kill something at the right moment. The real drop. */
      drop: (x: number, z: number, kind?: 'coin' | 'heart', amount = 7) =>
        dropPickup(new THREE.Vector3(x, 0.3, z), amount, kind),
      /** What a kill rolls, without a kill. Used to measure how rare a heart
       *  is — counting real drops needs hundreds of kills. */
      rollDrop: () => (heroHp < heroMaxHp && Math.random() < HEART_DROP_CHANCE ? 'heart' : 'coin'),
      quality: () => ({ level: quality, name: QUALITY[quality].name,
                        pixelRatio: renderer.getPixelRatio() }),
      get corpses() { return corpses; },
      get crates() { return crates; },
      buff: () => (buff ? { id: buff.kind.id, left: +buff.left.toFixed(1) } : null),
      /** Force one, for a probe that should not have to break crates until the
       *  dice agree. The real effect, applied the real way. */
      giveBuff: (id: string) => {
        const kind = BUFFS.find((k) => k.id === id);
        if (kind) { buff = { kind, left: BUFF_SECONDS }; renderHud(); }
      },
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
      /** Gold, for a probe that needs a board built without playing for it. */
      gift: (n: number) => { gold += n; renderHud(); },
      hurt: (n: number) => { invincible = 0; heroHp = Math.max(1, heroHp - n); renderHud(); },
      debugEndRun: (won = false) => endRun(won),
      /** The waypoints of one branch, and whether a cell is free to build on.
       *  For the balance probe, which has to find its own places to stand —
       *  hard-coded coordinates would turn "is the game too easy" into "is this
       *  one layout too easy". */
      pathOf: (r: number) => ROUTES[r],
      scenery: () => [...SCENERY].map((k) => k.split(',').map(Number)),
      blocked: () => [...BLOCKED].map((k) => k.split(',').map(Number)),
      /** Where a tower may go, from the board's own data. Probes carrying a
       *  coordinate break the day a road moves one row, and then report that
       *  the game is broken rather than that they are. */
      spots: () => pathData.spots,
      merged: () => folded,
      canBuildAt: (x: number, z: number) => {
        const k = `${x},${z}`;
        return BUILDABLE.has(k) && !occupied.has(k);
      },
      /** Pick a tower kind, the same way the number keys do. */
      select: (i: number) => { selected = Math.max(0, Math.min(i, KINDS.length - 1)); renderHud(); },
      kinds: () => KINDS.map((k) => ({ id: k.id, mount: k.mount, cost: k.cost, range: k.range })),
      /** three itself, and the tint predicate. Probes need to measure the scene
       *  (where is this, how big is it), and reaching for a Box3 should not mean
       *  bundling a second copy of three into the test. */
      THREE,
      isTinted: (o: THREE.Object3D) => isTinted(o),
      /** Damage something, for a probe that needs a kill without a ten-minute
       *  siege. The real function, not a copy of it. */
      damage: (e: Enemy, amount: number) => damage(e, amount),
      /** Jump the wave counter. A SEAM, not a shortcut: it moves only the
       *  *when*, and the enemies it produces come out of the same spawn code as
       *  every other wave — otherwise a probe would be checking a boss that
       *  only exists inside the probe. Reaching wave twelve honestly takes nine
       *  minutes, which is nine minutes nobody spends before shipping. */
      skipToWave: (n: number) => {
        for (const e of enemies) { if (e.alive) { e.alive = false; e.obj.visible = false; } }
        waveIndex = Math.max(0, Math.min(n, WAVES.length - 1));
        toSpawn = WAVES[waveIndex].count;
        spawnTimer = 0;
        waveTimer = WAVE_GAP;
        waveLaunched = true;
        renderHud();
      },
    state: () => ({ level: level.id, levelIndex, slip: level.slip,
      gold, lives, heroHp, heroMax: heroMaxHp, waveIndex, waveCount: WAVES.length, running, won,
      buildCell, selected, maxTowers, maxLevel: MAX_LEVEL,
      routes: ROUTES.length,
      /** Where each branch ends. The tiles get merged into one mesh for the
       *  sake of the phone's frame rate, so this is the only thing left that
       *  can answer "where does the road go". */
      routeEnds: ROUTES.map((r) => r[r.length - 1]),
      lanes: ROUTES.map((_, r) => enemies.filter((e) => e.alive && e.route === r).length),
      boss: (() => {
        const b = enemies.find((e) => e.boss);
        return b ? { alive: b.alive, hp: b.hp, maxHp: b.maxHp, clip: b.clip ?? null,
                     y: +b.obj.position.y.toFixed(3) } : null;
      })(),
                      standingOn: standingOn ? { kind: standingOn.kind.id, level: standingOn.level } : null,
                      towers: towers.map((t) => ({ kind: t.kind.id, level: t.level, cell: t.cell })) }),
      build: () => tryBuild(),
      locomotion: () => animator.action || character.state,
    } as unknown,
  });
  void tmp;
  return leaving;
}

async function boot(): Promise<void> {
  showLoading('Waking up');
  const umicat = await ThreeUmicat.init();
  await RAPIER.init();
  const canvas = document.getElementById('game') as HTMLCanvasElement;
  const hudEl = document.getElementById('hud')!;
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  const shared: Shared = { umicat, renderer, canvas, hudEl, audio: createAudio() };

  // The hub, then the level. `runHub` resolves when the player walks through
  // the door, and tears its own scene down first — one renderer, one context,
  // handed over rather than rebuilt.
  // The loop: hub, door, level, door, hub. Each half tears itself down and
  // hands the renderer back, so this can run all evening without leaking a
  // scene per run.
  for (;;) {
    showLoading('Entering the woods');
    const choice = await runHub(shared);
    showLoading(`Entering ${LEVELS[choice.level].name}`);
    const result = await startLevel(shared, choice.weapon, choice.level, choice.bonus);
    // Finishing a level — won or lost — is what unlocks the next weapon back
    // in the hub. Counted HERE rather than in `endRun` because "finished" means
    // walking back out through the door, not the moment the last life went.
    // Clearing one is what opens the NEXT board, which is a different question
    // and a different counter.
    const prev = (await umicat.saves.get<Progress>(SAVE_KEY)) ?? {};
    await patchSave(umicat, {
      runs: (prev.runs ?? 0) + 1,
      cleared: result.won ? Math.max(prev.cleared ?? 0, result.level + 1) : prev.cleared,
      bests: { ...(prev.bests ?? {}), [LEVELS[result.level].id]:
        Math.max(prev.bests?.[LEVELS[result.level].id] ?? 0, result.wave) },
      coin: (prev.coin ?? 0) + result.banked,
    });
  }
}

void boot().catch((err) => {
  const hud = document.getElementById('hud');
  if (hud) hud.textContent = `Failed to start: ${String(err)}`;
  console.error('[umicat] game failed to start', err);
});

void GAME_WIDTH; void GAME_HEIGHT;
