import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import RAPIER from '@dimforge/rapier3d-compat';
import {
  ThreeUmicat, loadScene3D, loadModelAsset, attachToSocket, flashTint, updateTints,
  CharacterController3D, CharacterAnimator, Input3D,
  type Scene3D, type Manifest3D,
} from '@umicat/three-sdk';
import { GAME_WIDTH, GAME_HEIGHT } from './config';
import { createAudio, MUSIC } from './audio';
import { runHub, submitScore } from './hub';
import { showLoading, hideLoading } from './loading';
import type { GameAudio } from '@umicat/three-sdk';

/**
 * Woodland Defense — a tower defense you can walk around in.
 *
 * The two halves have to earn each other. Towers alone is a tower defense with
 * a camera; a hero alone is the brawler this used to be. So: towers are the
 * only thing that holds a lane while you are somewhere else, and the hero is
 * the only thing that can be somewhere else in time.
 *
 * Start here: `WAVES`, `TOWERS`, and the frame loop in `start()`.
 */

const SAVE_KEY = 'td-progress';
const SPAWN = { x: 0, y: 0.5, z: 3.5 };
const RESPAWN_BELOW_Y = -5;

// --- the hero -------------------------------------------------------------
const HERO_HALF_HEIGHT = 0.2;
const HERO_RADIUS = 0.16;
const HERO_SYNC_OFFSET = -(HERO_HALF_HEIGHT + HERO_RADIUS);
const HERO_MAX_HP = 6;
const HERO_SPEED = 4.2;
const HERO_ATTACK_RANGE = 1.15;
const HERO_ATTACK_DAMAGE = 2;
const HERO_INVINCIBLE_SECONDS = 1.4;

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
}
/** Four, and each one is a different answer to "what is walking past me".
 *  Cheap-and-quick, slow-and-hard, long-and-lobbing, fast-and-weak. A second
 *  tower that is just the first with bigger numbers is a longer menu, not a
 *  decision. */
const TOWERS: TowerKind[] = [
  { id: 'ballista', label: 'Ballista', icon: '🏹', model: 'td-ballista', ammo: 'td-ammo-arrow',
    cost: 25, range: 3.0, damage: 2, reload: 1.0, shotSpeed: 9 },
  { id: 'cannon', label: 'Cannon', icon: '💣', model: 'td-cannon', ammo: 'td-ammo-ball',
    cost: 45, range: 2.2, damage: 5, reload: 2.0, shotSpeed: 7 },
  { id: 'catapult', label: 'Catapult', icon: '🪨', model: 'td-catapult', ammo: 'td-ammo-boulder',
    cost: 60, range: 4.2, damage: 7, reload: 3.0, shotSpeed: 5 },
  { id: 'turret', label: 'Turret', icon: '⚙️', model: 'td-turret', ammo: 'td-ammo-arrow',
    cost: 40, range: 2.6, damage: 1, reload: 0.28, shotSpeed: 12 },
];

interface Wave {
  count: number; hp: number; speed: number; model: string; bounty: number;
  /** Whether this kind shoots back. */
  armed: boolean;
  /** The kit's UFOs are a full tile wide; this is how big they read next to
   *  a 0.72-tall hero. */
  scale: number;
}
/** Eight waves, six kinds of thing to shoot at.
 *
 *  Every one of them shoots back. The ramp is hit points, speed and count —
 *  the scouts are fast and fragile, the heavies slow and thick, which is a
 *  different problem each time rather than a larger one.
 *
 *  `armed` stays as a field because it is per-KIND, not a global: the moment
 *  one enemy should be harmless, that is a data change and not a rewrite. */
const WAVES: Wave[] = [
  { count: 5, hp: 6, speed: 1.1, model: 'td-ufo-a', bounty: 8, armed: true, scale: 0.62 },
  { count: 7, hp: 9, speed: 1.25, model: 'td-ufo-b', bounty: 10, armed: true, scale: 0.62 },
  { count: 8, hp: 8, speed: 2.1, model: 'td-ufo-c', bounty: 11, armed: true, scale: 0.5 },
  { count: 9, hp: 16, speed: 1.2, model: 'td-ufo-a2', bounty: 14, armed: true, scale: 0.68 },
  { count: 10, hp: 22, speed: 1.3, model: 'td-ufo-d', bounty: 16, armed: true, scale: 0.72 },
  { count: 12, hp: 20, speed: 1.9, model: 'td-ufo-b2', bounty: 18, armed: true, scale: 0.6 },
  { count: 14, hp: 34, speed: 1.2, model: 'td-ufo-c2', bounty: 22, armed: true, scale: 0.78 },
  { count: 16, hp: 48, speed: 1.45, model: 'td-ufo-d2', bounty: 28, armed: true, scale: 0.85 },
];
const SPAWN_GAP = 1.1;          // seconds between enemies in a wave
const WAVE_GAP = 6;             // breathing room between waves
const START_GOLD = 60;
const BASE_LIVES = 10;

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
  alive: boolean;
  shootCooldown: number;
  windup: number;
}

interface Tower {
  kind: TowerKind;
  obj: THREE.Object3D;
  cell: [number, number];
  reload: number;
  level: number;
}

/** Levels 1-3. Everything about a tower scales off its level rather than being
 *  stored per upgrade, so there is one place to change how upgrading feels. */
const MAX_LEVEL = 3;
const levelDamage = (t: Tower): number => t.kind.damage * Math.pow(1.7, t.level - 1);
const levelRange = (t: Tower): number => t.kind.range * Math.pow(1.15, t.level - 1);
const levelReload = (t: Tower): number => t.kind.reload * Math.pow(0.82, t.level - 1);
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
export async function startLevel(shared: Shared, startWeapon: Weapon = 'sword'): Promise<void> {
  const { umicat, renderer, canvas, hudEl, audio } = shared;

  const [manifest, scene3d, pathData] = await Promise.all([
    fetch('scenes3d/manifest.json').then((r) => r.json() as Promise<Manifest3D>),
    fetch('scenes3d/main.json').then((r) => r.json() as Promise<Scene3D>),
    fetch('scenes3d/path.json').then((r) => r.json() as Promise<{ cells: [number, number][]; spots: [number, number][] }>),
  ]);
  const world = await loadScene3D(scene3d, manifest, { assetBase: '', rapier: RAPIER });
  audio.setMusic(MUSIC.level);

  // --- Fold the board into a handful of draws ---
  //
  // The board is 144 grass tiles plus 38 path tiles, and every one of them was
  // a separate mesh: 182 draw calls for a picture that never changes. They are
  // static, they share a few materials, and nothing looks them up by id, so
  // they can be merged into one mesh per material. A desktop does not notice
  // 182 draws; a phone very much does.
  const staticTiles: THREE.Object3D[] = [];
  for (const [id, obj] of world.entities) {
    if (id.startsWith('grass_') || id.startsWith('path_')) staticTiles.push(obj);
  }
  {
    const byMaterial = new Map<string, { mat: THREE.Material; geos: THREE.BufferGeometry[] }>();
    for (const obj of staticTiles) {
      obj.updateWorldMatrix(true, true);
      obj.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (!mesh.isMesh) return;
        const mat = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
        const key = mat.uuid;
        // Bake each tile's world transform into its vertices — after merging
        // there is one object, so the individual transforms have nowhere left
        // to live.
        const g = mesh.geometry.clone();
        g.applyMatrix4(mesh.matrixWorld);
        // Merging requires identical attribute sets; drop anything unshared
        // rather than letting mergeGeometries return null and silently lose
        // the entire board.
        for (const name of Object.keys(g.attributes)) {
          if (!['position', 'normal', 'uv'].includes(name)) g.deleteAttribute(name);
        }
        const slot = byMaterial.get(key) ?? { mat, geos: [] };
        slot.geos.push(g);
        byMaterial.set(key, slot);
      });
    }
    let merged = 0;
    for (const { mat, geos } of byMaterial.values()) {
      const combined = mergeGeometries(geos, false);
      if (!combined) continue;   // mismatched attributes: leave those tiles be
      const mesh = new THREE.Mesh(combined, mat);
      mesh.castShadow = false;
      mesh.receiveShadow = true;
      mesh.matrixAutoUpdate = false;
      world.scene.add(mesh);
      merged += geos.length;
      for (const g of geos) g.dispose();
    }
    if (merged > 0) {
      for (const obj of staticTiles) { obj.removeFromParent(); world.entities.delete(obj.userData.entityId as string); }
    }
  }

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
  const PATH = pathData.cells;
  const BUILDABLE = new Set(pathData.spots.map(([x, z]) => `${x},${z}`));

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
  for (const id of [...TOWERS.map((t) => t.model), ...TOWERS.map((t) => t.ammo),
                    ...WAVES.map((w) => w.model), 'td-bullet', 'td-coin']) {
    if (protos.has(id)) continue;
    const { object } = await loadModelAsset(manifest, id, { assetBase: '' });
    object.traverse((o) => { if ((o as THREE.Mesh).isMesh) { (o as THREE.Mesh).castShadow = true; } });
    protos.set(id, object);
  }
  const spawnFrom = (id: string): THREE.Object3D => {
    const o = protos.get(id)!.clone(true);
    world.scene.add(o);
    return o;
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
  let gold = START_GOLD;
  let lives = BASE_LIVES;
  let heroHp = HERO_MAX_HP;
  let waveIndex = 0;
  let waveTimer = 3;            // countdown to the next wave
  /** Whether the wave at `waveIndex` has actually been sent out yet. */
  let waveLaunched = false;
  let spawnTimer = 0;
  let toSpawn = 0;
  let running = true;
  let won = false;
  let invincible = 1.5;
  let selected = 0;             // which tower kind the build button places
  let buildCell: [number, number] | null = null;
  /** The tower under the player's feet, if any — the thing `build` upgrades. */
  let standingOn: Tower | null = null;

  const enemies: Enemy[] = [];
  const towers: Tower[] = [];
  const shots: Shot[] = [];
  const bullets: Bullet[] = [];
  const tinted: THREE.Object3D[] = [hero];

  // --- HUD ---
  const line1 = document.createElement('div');
  const line2 = document.createElement('div');
  const line3 = document.createElement('div');
  line3.style.opacity = '0.85';
  // Gold lives in its own element because a coin flying to the counter needs a
  // rectangle to aim at, and "somewhere in that line of text" is not one.
  const livesEl = document.createElement('span');
  const goldEl = document.createElement('span');
  const waveEl = document.createElement('span');
  goldEl.style.transition = 'transform 120ms ease-out';
  line2.append(livesEl, goldEl, waveEl);
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
    void umicat.saves.set(SAVE_KEY, { best: bestWave, quality });
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
      if (frac >= 1) { e.bar.visible = false; continue; }
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
  const ARROW_DAMAGE = 3;
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
  const STAFF_DAMAGE = 4;
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

  interface Coin { obj: THREE.Object3D; vel: THREE.Vector3; t: number; amount: number; paid: boolean; }
  const coins: Coin[] = [];
  const COIN_POP = 0.55;        // seconds of arc before it heads for the corner
  const COIN_FLY = 0.5;         // seconds to cross the screen

  const flyCoin = (from: THREE.Vector3, amount: number): void => {
    const obj = spawnFrom('td-coin');
    obj.position.copy(from);
    obj.scale.setScalar(0.55);
    coins.push({
      obj, amount, t: 0, paid: false,
      // Up and slightly outward, so several from one kill do not stack.
      vel: new THREE.Vector3((Math.random() - 0.5) * 0.9, 2.2, (Math.random() - 0.5) * 0.9),
    });
  };

  const _coinTarget = new THREE.Vector3();
  const counterInWorld = (out: THREE.Vector3): THREE.Vector3 => {
    const r = goldEl.getBoundingClientRect();
    const ndcX = ((r.left + r.width * 0.4) / window.innerWidth) * 2 - 1;
    const ndcY = -((r.top + r.height * 0.5) / window.innerHeight) * 2 + 1;
    // Just in front of the camera: far enough not to clip, near enough that
    // the coin is still large when it arrives.
    return out.set(ndcX, ndcY, 0.82).unproject(world.camera);
  };

  const updateCoins = (dt: number): void => {
    for (let i = coins.length - 1; i >= 0; i--) {
      const c = coins[i];
      c.t += dt;
      c.obj.rotation.y += dt * 7;
      if (c.t < COIN_POP) {
        // The pop: a real little arc, under the scene's own gravity.
        c.vel.y -= 6 * dt;
        c.obj.position.addScaledVector(c.vel, dt);
        continue;
      }
      const k = Math.min(1, (c.t - COIN_POP) / COIN_FLY);
      counterInWorld(_coinTarget);
      // Ease in: it hangs for a moment and then goes, which reads as being
      // pulled rather than sliding.
      c.obj.position.lerp(_coinTarget, 1 - Math.pow(1 - k, 3) * 0.85);
      c.obj.scale.setScalar(0.55 * (1 - k * 0.45));
      if (k >= 1) {
        if (!c.paid) { gold += c.amount; audio.play('coin'); renderHud(); c.paid = true; }
        goldEl.style.transform = 'scale(1.22)';
        setTimeout(() => { goldEl.style.transform = 'scale(1)'; }, 120);
        world.scene.remove(c.obj);
        coins.splice(i, 1);
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
    display: flex; gap: 8px; z-index: 30; pointer-events: auto;
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
  const placeHotbar = (): void => {
    hotbar.style.bottom = '14px';
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
  const cells = TOWERS.map((kind, i) => {
    const cell = document.createElement('button');
    cell.style.cssText = `
      width: 62px; padding: 6px 4px 5px; border-radius: 12px; border: 2px solid transparent;
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
      const affordable = gold >= TOWERS[i].cost;
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
    if (n >= 1 && n <= TOWERS.length) { selected = n - 1; refreshHotbar(); renderHud(); }
  });

  const renderHud = (): void => {
    line1.textContent = `${'❤️'.repeat(Math.max(heroHp, 0))}${'🤍'.repeat(Math.max(HERO_MAX_HP - heroHp, 0))}`;
    const w = Math.min(waveIndex + 1, WAVES.length);
    livesEl.textContent = `🏰 ${lives}\u2003`;
    goldEl.textContent = `💰 ${gold}`;
    waveEl.textContent = `\u2003Wave ${w}/${WAVES.length}`;
    if (standingOn) {
      const t = standingOn;
      line3.textContent = t.level >= MAX_LEVEL
        ? `${t.kind.label} Lv${t.level} — fully upgraded`
        : `🔨 upgrade ${t.kind.label} to Lv${t.level + 1} · ${upgradeCost(t)}g`;
    } else {
      const kind = TOWERS[selected];
      line3.textContent = buildCell
        ? `🔨 build ${kind.label} · ${kind.cost}g`
        : `walk to a spot beside the path to build · ${
            weapon === 'bow' ? '🏹 bow' : weapon === 'staff' ? '🔮 staff' : '🗡 sword'}`;
    }
    refreshHotbar();
  };

  const endRun = (didWin: boolean): void => {
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
      void umicat.saves.set(SAVE_KEY, { best: bestWave, quality });
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
    // And take the wall out of the way. A door you can see and cannot reach
    // is worse than no door: the wall's collider is what stops you, and it
    // does not care that something was drawn in front of it.
    const wall = world.bodies.get('wall_n');
    if (wall) world.world.removeRigidBody(wall);
    const wallMesh = world.entities.get('wall_n');
    if (wallMesh) wallMesh.visible = false;
  };

  // --- the path, as a position lookup -------------------------------------
  const posAt = (t: number, out: THREE.Vector3): THREE.Vector3 => {
    const i = Math.floor(t);
    if (i >= PATH.length - 1) {
      const last = PATH[PATH.length - 1];
      return out.set(last[0], ENEMY_FLY_HEIGHT, last[1]);
    }
    const a = PATH[i], b = PATH[i + 1], f = t - i;
    return out.set(a[0] + (b[0] - a[0]) * f, ENEMY_FLY_HEIGHT, a[1] + (b[1] - a[1]) * f);
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
      // Bigger, so a levelled tower is legible from across the board without
      // reading a number.
      t.obj.scale.setScalar(1 + (t.level - 1) * 0.18);
      flashTint(t.obj, { color: 0xffe28a, ms: 320 });
      updraft(t.obj.position);
      audio.play('upgrade');
      flashBanner(`${t.kind.label} → Lv${t.level}`);
      renderHud();
      return;
    }

    if (!buildCell) return;
    const kind = TOWERS[selected];
    if (gold < kind.cost) { audio.play('denied'); flashBanner(`${kind.label} costs ${kind.cost}g`); return; }
    gold -= kind.cost;
    const obj = spawnFrom(kind.model);
    obj.position.set(buildCell[0], 0.02, buildCell[1]);
    const tower: Tower = { kind, obj, cell: [...buildCell] as [number, number], reload: 0, level: 1 };
    towers.push(tower);
    occupied.set(`${buildCell[0]},${buildCell[1]}`, tower);
    tinted.push(obj);
    audio.play('build');
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
        damage(e, STAFF_DAMAGE);
      }
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
      damage(e, HERO_ATTACK_DAMAGE);
    }
    // A swing that connects sounds different from one that whiffs. Without
    // that, melee is a noise you make rather than a thing you do.
    if (connected) audio.play('sword-hit');
  };

  const damage = (e: Enemy, amount: number): void => {
    e.hp -= amount;
    flashTint(e.obj, { color: 0xff3020, ms: 160 });
    if (e.hp > 0) { audio.play('hit-enemy'); return; }
    audio.play('enemy-die');
    e.alive = false;
    e.obj.visible = false;
    flyCoin(e.obj.position, e.bounty);
  };

  const hurtHero = (): void => {
    if (invincible > 0 || !running) return;
    invincible = HERO_INVINCIBLE_SECONDS;
    heroHp -= 1;
    audio.play('hero-hurt');
    flashScreen();
    flashTint(hero, { color: 0xff2a1a, ms: 220 });
    renderHud();
    if (heroHp <= 0) endRun(false);
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

  // A frame counter, on the device that matters.
  //
  // `?debug=1` — because the numbers that decide performance questions have to
  // come from the phone. A laptop renders this board without noticing 182 draw
  // calls; an iPhone draws at 3x into a 2048 shadow map and very much does, and
  // nothing about a screenshot from either machine shows the difference.
  // `?debug=1`, or three taps on the HUD — the app plays games in a webview
  // with no address bar, so a URL flag is unreachable exactly where the
  // numbers matter most.
  const debugHud = (() => {
        const d = document.createElement('div');
        // TOP CENTRE, and never interactive. It started bottom-right, which is
        // where the jump and attack buttons are — a readout added to diagnose
        // performance covered the two controls a player needs most, and made
        // itself the fourth thing this session to be perfectly visible and
        // quietly in the way. The HUD owns the top left; this takes the gap.
        d.style.cssText = `position: fixed; left: 50%; top: 8px; transform: translateX(-50%);
          z-index: 60; font: 600 11px/1.4 ui-monospace, monospace; color: #fff;
          text-align: center; background: rgba(0,0,0,.45); padding: 5px 9px;
          border-radius: 8px; pointer-events: none; white-space: pre;`;
        // Visible by default while performance is the open question. A hidden
        // gesture is the wrong default for a number someone has to read out to
        // me: `?debug=1` is unreachable in the app (no address bar) and three
        // quick taps turned out to be fiddly enough that it looked broken.
        // `?debug=0` turns it off; so does tapping it.
        d.style.display = new URLSearchParams(location.search).get('debug') === '0' ? 'none' : 'block';
        // No tap-to-dismiss: making it tappable is what put it in front of the
        // buttons. `?debug=0` turns it off.
        document.body.appendChild(d);
        let taps = 0, tapAt = 0;
        hudEl.style.pointerEvents = 'auto';
        hudEl.addEventListener('pointerdown', (e) => {
          if ((e.target as HTMLElement).tagName === 'BUTTON') return;
          const t = performance.now();
          taps = t - tapAt < 600 ? taps + 1 : 1;
          tapAt = t;
          if (taps >= 3) { taps = 0; d.style.display = d.style.display === 'none' ? 'block' : 'none'; }
        });
        return d;
      })();
  let fpsFrames = 0, fpsSince = performance.now(), fpsWorst = 0;
  const shadowOf = (): string => {
    const d = world.scene.children.find((c) => (c as THREE.DirectionalLight).isDirectionalLight) as THREE.DirectionalLight | undefined;
    return d ? `${d.shadow.mapSize.width}` : 'none';
  };

  const EXIT_Z = -6.15;
  let last = performance.now();
  const dir = new THREE.Vector3();
  const prevPos = new THREE.Vector3();
  const heroHit = new THREE.Vector3();
  let leave: (() => void) | null = null;
  const leaving = new Promise<void>((res) => { leave = res; });

  renderer.setAnimationLoop((now: number) => {
    const dt = Math.min((now - last) / 1000, 0.05);
    last = now;

    const turn = input.look();
    if (turn.x || turn.y) world.orbit(turn.x, turn.y);

    // Walking is not part of "the game is running" — it is how you leave.
    const move = input.direction(world.cameraYaw);
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
      if (before !== `${standingOn ? standingOn.cell.join(',') : ''}|${buildCell ? key : ''}`) renderHud();

      // --- waves ---
      if (toSpawn > 0) {
        spawnTimer -= dt;
        if (spawnTimer <= 0) {
          spawnTimer = SPAWN_GAP;
          toSpawn -= 1;
          const w = WAVES[waveIndex];
          const obj = spawnFrom(w.model);
          obj.scale.setScalar(w.scale);
          const { group: bar, fill: barFill } = makeHealthBar();
          obj.add(bar);
          bar.position.y = 0.62 / w.scale;   // the bar is a child, so it inherits the scale
          bar.scale.setScalar(1 / w.scale);
          const e: Enemy = {
            obj, hp: w.hp, maxHp: w.hp, speed: w.speed, bounty: w.bounty,
            armed: w.armed, bar, barFill,
            t: 0, alive: true, shootCooldown: 1, windup: 0,
          };
          posAt(0, obj.position);
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
          if (waveLaunched) { waveIndex += 1; waveLaunched = false; }
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
      for (const e of enemies) {
        if (!e.alive) continue;
        e.t += (e.speed * dt);
        if (e.t >= PATH.length - 1) {
          // It got through. That is what the towers were for.
          e.alive = false;
          e.obj.visible = false;
          lives -= 1;
          audio.play('leak');
          flashScreen();
          renderHud();
          if (lives <= 0) { endRun(false); break; }
          continue;
        }
        posAt(e.t, e.obj.position);
        e.obj.rotation.y += dt * 1.6;   // UFOs spin; it reads as "alive"

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
            const bullet = spawnFrom('td-bullet');
            // Out in front, not from inside the hull. Spawned at the centre it
            // could already be past the player, and at close range it crossed
            // the gap faster than a frame — invisible damage for being nearby,
            // which is the thing this was supposed to replace.
            bullet.position.copy(e.obj.position).addScaledVector(v, BULLET_MUZZLE);
            bullet.lookAt(bullet.position.clone().add(v));
            bullets.push({ obj: bullet, vel: v.multiplyScalar(BULLET_SPEED), life: BULLET_LIFE });
            audio.play('enemy-shot');
          }
        } else if (e.shootCooldown > 0) {
          e.shootCooldown -= dt;
        } else if (e.armed && dHero < ENEMY_SHOOT_RANGE) {
          e.windup = ENEMY_WINDUP_SECONDS;
          e.shootCooldown = ENEMY_SHOOT_COOLDOWN;
          flashTint(e.obj, { color: 0xffd050, ms: ENEMY_WINDUP_SECONDS * 1000 });
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
          t.obj.rotation.y = Math.atan2(
            target.obj.position.x - t.cell[0], target.obj.position.z - t.cell[1]);
        }
        if (target && t.reload <= 0) {
          t.reload = levelReload(t);
          const shot = spawnFrom(t.kind.ammo);
          shot.position.set(t.cell[0], 0.35, t.cell[1]);
          shots.push({ obj: shot, target, damage: levelDamage(t), speed: t.kind.shotSpeed });
          audio.play(t.kind.id === 'cannon' ? 'cannon-shot' : 'tower-shot');
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
          if (hit) hurtHero();
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
        if (hit) damage(hit, ARROW_DAMAGE);
        if (hit || a.life <= 0 || Math.abs(a.obj.position.x) > 7 || Math.abs(a.obj.position.z) > 7) {
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

    if (debugHud.style.display !== 'none') {
      fpsFrames += 1;
      fpsWorst = Math.max(fpsWorst, dt * 1000);
      if (now - fpsSince > 500) {
        const fps = (fpsFrames * 1000) / (now - fpsSince);
        const info = renderer.info.render;
        debugHud.textContent =
          `${fps.toFixed(0)} fps   worst ${fpsWorst.toFixed(0)}ms\n` +
          `${info.calls} draws  ${(info.triangles / 1000).toFixed(0)}k tris\n` +
          `dpr ${window.devicePixelRatio} → ${renderer.getPixelRatio()}  ${renderer.domElement.width}×${renderer.domElement.height}\n` +
          `shadow ${shadowOf()}`;
        fpsFrames = 0; fpsSince = now; fpsWorst = 0;
      }
    }

    // Out through the door, back to the hub. Only once the run is over — the
    // wall is solid until then, and the door is not even drawn.
    if (!running && hero.position.z < EXIT_Z && leave) {
      const go = leave; leave = null;
      audio.play('wave');
      renderer.setAnimationLoop(null);
      window.removeEventListener('resize', resize);
      input.dispose();
      banner.remove(); hotbar.remove(); toast.remove(); hitFlash.remove();
      hudEl.textContent = '';
      world.dispose();
      world.scene.clear();
      // The handle goes with it. A debug handle that outlives the thing it
      // describes is worse than none: anything asking "am I in the level?" is
      // told yes by the corpse of the last one.
      delete (window as unknown as Record<string, unknown>).__game;
      go();
      return;
    }

    updateCoins(dt);
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
      get coins() { return coins; },
      quality: () => ({ level: quality, name: QUALITY[quality].name,
                        pixelRatio: renderer.getPixelRatio() }),
      state: () => ({ gold, lives, heroHp, waveIndex, running, won, buildCell, selected,
                      standingOn: standingOn ? { kind: standingOn.kind.id, level: standingOn.level } : null,
                      towers: towers.map((t) => ({ kind: t.kind.id, level: t.level, cell: t.cell })) }),
      build: () => tryBuild(),
      locomotion: () => animator.action || character.state,
    } as unknown,
  });
  void tmp;
  await leaving;
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
    const weapon = await runHub(shared);
    showLoading('Raising the defences');
    await startLevel(shared, weapon);
  }
}

void boot().catch((err) => {
  const hud = document.getElementById('hud');
  if (hud) hud.textContent = `Failed to start: ${String(err)}`;
  console.error('[umicat] game failed to start', err);
});

void GAME_WIDTH; void GAME_HEIGHT;
