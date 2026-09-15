import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import {
  loadScene3D, loadModelAsset, attachToSocket,
  CharacterController3D, CharacterAnimator, Input3D,
  type Scene3D, type Manifest3D,
} from '@umicat/three-sdk';
import type { Shared, Progress } from './main';
import { patchSave, readSave } from './main';
import { DEV, DEV_BANNER, toggleDev } from './dev';
import { skyWithClouds } from './sky';
import { readoutPlate } from './hud';
import { createThumbMaker } from './thumbs';
import { iconHtml, type IconName } from './icons';
import { ICON } from './icons';
import { LEVELS } from './levels';
import { mergeStatic } from './merge';
import { createDebugHud } from './debughud';
import { TOWN, TOWN_MAX_LEVEL, bonusesFrom, canAfford, shortfall, townNow, townAfter,
  type TownBonus, type TownBuilding } from './town';
import {
  WEAPON_BY_ID, WEAPON_MAX_LEVEL, levelOf, nextCost, migrateWeapons,
  weaponDamage, effectText, type Weapon, type WeaponLevels,
} from './weapons';
import type { Materials } from './progress';
import { MUSIC, SFX } from './audio';
import { hideLoading } from './loading';

/**
 * The hub — where a run starts, and where it is scored.
 *
 * Small, walled, and quiet: a door at the far end, the game's name in blocks,
 * and some scenery. Walking into the
 * door resolves, and the level takes over the same renderer.
 *
 * It shares the character, the controls and the camera with the level — the
 * platform owns all three (ADR-034) — so this file is a scene and two
 * triggers, not a second game.
 */

/** The doorway, as a place rather than a line.
 *
 *  It was `z < -4.6` — anywhere along the front wall started the level, which
 *  taught that the door was decoration. A door you can miss by walking beside
 *  it is a door; a line across the room is a trigger. */
/** The doorway. One of them, in the middle of the front wall.
 *
 *  It was a door per board for a while. That read well and chose badly: it
 *  asked which board you wanted before you had any reason to care, and it had
 *  no room to say how far you had got on each. Walking through now opens the
 *  list, and the choosing happens there. */
const DOOR_AT = { x: 0, z: -5.1 };
/** The stall, by the gate.
 *
 *  Two things pin it there. It has to be inside the SMALLEST village, because
 *  it sells the land that makes the village bigger and a shop you cannot reach
 *  until you have bought more room is a lock with its key inside it. And it has
 *  to be at the FRONT, because the camera follows from behind: standing at a
 *  stall near the back wall puts the camera outside that wall, which then fills
 *  a third of the screen. Must match `tools/gen-scene.mjs`. */
const SHOP_AT = { x: -2.9, z: -3.9 };
const DOOR_HALF_WIDTH = 0.7;
const NEAR = 0.9;             // how close counts as "standing at" something
/** The rack in front of the Armory. Five pedestals, in the order they cost.
 *
 *  They used to arrive on a schedule — sword at zero finished levels, bow at
 *  one, staff at two — so the whole rack was visible from the first visit and
 *  none of it was a choice. Now every pedestal is always there and most of them
 *  are empty, which asks the same question the town does: what is this run for?
 *
 *  Positions must match `PICKUPS` in `tools/gen-scene.mjs`, which stands the
 *  pedestals and the rings. */
const RACK: { id: Weapon; x: number; z: number }[] = [
  { id: 'sword', x: -2.5, z: 0.2 },
  { id: 'bow', x: -1.25, z: 0.2 },
  { id: 'fire', x: 0, z: 0.2 },
  { id: 'ice', x: 1.25, z: 0.2 },
  { id: 'bolt', x: 2.5, z: 0.2 },
];

/** What the player chose on the way out of the hub. */
export interface HubChoice {
  weapon: Weapon; level: number; bonus: TownBonus;
  /** How far each weapon is made — the level needs the equipped one's level to
   *  know what it hits for. */
  weapons: WeaponLevels;
}

export async function runHub(shared: Shared): Promise<HubChoice> {
  const { umicat, renderer, canvas, hudEl, audio } = shared;

  const [manifest, scene3d] = await Promise.all([
    fetch('scenes3d/manifest.json').then((r) => r.json() as Promise<Manifest3D>),
    fetch('scenes3d/hub.json').then((r) => r.json() as Promise<Scene3D>),
  ]);
  const world = await loadScene3D(scene3d, manifest, { assetBase: '', rapier: RAPIER });
  // The hub is eleven hundred objects now that its wall is a forest. Same fold
  // as the boards, same module — a thousand draw calls in the first thing
  // anyone sees would be a worse first impression than the wall was.
  const folded = mergeStatic(world, scene3d, manifest);
  // Clouds. AFTER the scene is loaded, and not as entities: the SDK fits every
  // shadow camera to the bounds of what it loaded, so anything far away costs
  // the whole board its shadow resolution. A background has no bounds.
  world.scene.background = skyWithClouds({
    horizon: `#${(world.scene.background as THREE.Color | null)?.getHexString?.() ?? '9fd4ef'}`,
  });

  const hero = world.entities.get('hero')!;
  shared.audio.setMusic(MUSIC.lobby);

  // No prefetching the level here. It would mean naming, from the hub, which
  // level the player is about to enter — and the moment there is progress to
  // save and more than one of them, that name is a guess. A loading screen is
  // the ordinary answer and it stays correct.

  renderer.shadowMap.enabled = true;
  const dpr = window.devicePixelRatio ?? 1;
  renderer.setPixelRatio(Math.min(dpr, dpr > 2 ? 2 : 2));
  const resize = (): void => {
    renderer.setSize(window.innerWidth, window.innerHeight, false);
    world.camera.aspect = window.innerWidth / window.innerHeight;
    world.camera.updateProjectionMatrix();
  };
  resize();
  window.addEventListener('resize', resize);

  const character = new CharacterController3D(world.world, RAPIER, {
    // From the SCENE, not a number typed here. The two disagreed — the hero
    // model was placed at 1.9 and the controller spawned it at 3.0 — and since
    // the controller wins, moving the hero in the scene did nothing at all.
    position: {
      x: hero.position.x,
      y: hero.position.y + 0.5,
      z: hero.position.z,
    },
    halfHeight: 0.2, radius: 0.16, speed: 4.2, stepHeight: 0.17, jumpSpeed: 2.8,
  });
  // The hub's one button is "use what you are standing at" — forge, take,
  // build, read the sign. A hand, not a sword: nothing here is a fight.
  const input = new Input3D({
    actions: [{ id: 'use', icon: ICON.build, keys: ['KeyJ'] }],
    jumpIcon: ICON.jump,
  });

  const heroMixer = world.mixerFor.get('hero');
  if (!heroMixer) throw new Error('the hub hero has no animation mixer');
  const clipMap: Record<string, string> =
    (manifest.models?.find((m) => m.id === 'hero') as { animations?: Record<string, string> } | undefined)?.animations ?? {};
  const animator = new CharacterAnimator(heroMixer, world.clips.get('hero') ?? [], clipMap);

  const heroAsset = manifest.models?.find((m) => m.id === 'hero');
  const handRight = heroAsset?.sockets?.['hand-right'];

  const held: Partial<Record<Weapon, THREE.Object3D>> = {};
  const progress = await readSave(shared.umicat);
  const runs = progress.runs ?? 0;
  /** How many boards have been WON. A new board comes from clearing the one
   *  before it, because otherwise the order means nothing. */
  const cleared = progress.cleared ?? 0;
  const levelOpen = (i: number): boolean => i <= cleared;
  /** What is in the store, and what it has been spent on. */
  const store: Materials = {
    gold: progress.store?.gold ?? progress.coin ?? 0,
    wood: progress.store?.wood ?? 0,
    stone: progress.store?.stone ?? 0,
  };
  const level = progress.level ?? 1;
  const town: Record<string, number> = { ...(progress.town ?? {}) };
  // A save from before the Armory has no rack — reconstruct one from the
  // finished-level count, so nobody is charged again for a weapon they earned.
  const migrated = migrateWeapons(progress.weapons, runs, progress.weapon);
  const weapons: WeaponLevels = migrated.weapons;
  let weapon: Weapon = migrated.weapon;
  /** How far the Armory can make a weapon. Its level IS the cap. */
  const weaponCap = (): number => town.armory ?? 0;

  // --- where the buildings stand -------------------------------------------
  //
  // Nowhere, until the player says. There are no plots any more: four patches
  // of dirt announced how many buildings the game would ever have, and pinned
  // every village to the same shape.
  //
  // A building that is paid for but has no spot is one you are CARRYING. That
  // is also what a game closed halfway through placing one looks like when it
  // comes back, so the interrupted case needs no special handling.
  // --- how big the village is ------------------------------------------------
  //
  // It grows. These MUST match `LAND` in `tools/gen-scene.mjs`, which builds a
  // wall set per size and tags the trees that each size swallows.
  //
  // The gate does not move — its frame and sign are folded into a merged mesh
  // and could not — so the village grows sideways and backwards, away from it.
  // Which is the better design regardless: the way out is the one landmark that
  // should still be where you left it.
  const FRONT = -5.1;
  const LAND: { x: number; back: number }[] = [
    { x: 4.1, back: 3.1 },
    { x: 5.1, back: 5.1 },
    { x: 6.1, back: 7.1 },
  ];
  /** What the NEXT expansion costs, indexed by the size you are at now. */
  const LAND_COST: Materials[] = [
    { gold: 300, wood: 60, stone: 40 },
    { gold: 700, wood: 140, stone: 90 },
  ];
  // A save from before land could be bought has a village the size the hub used
  // to be, with buildings standing where that size allowed. Starting it at the
  // smallest would put its walls straight through them.
  let land = progress.land ?? (Object.keys(progress.town ?? {}).length ? 1 : 0);

  const spots: Record<string, { x: number; z: number }> = { ...(progress.spots ?? {}) };
  // A save from before the player could choose has buildings but no spots, and
  // handing somebody their whole finished village back in their arms is not a
  // migration. Seed those from the plots they used to stand on — the `x`/`z`
  // still on each TOWN entry are kept for exactly this.
  if (!progress.spots) {
    for (const b of TOWN) if ((town[b.id] ?? 0) > 0) spots[b.id] = { x: b.x, z: b.z };
  }
  const unplaced = (): TownBuilding[] =>
    TOWN.filter((b) => (town[b.id] ?? 0) > 0 && !spots[b.id]);
  let carrying: TownBuilding | null = unplaced()[0] ?? null;

  /** Whole-metre cells, like the levels. Free placement looks like a mistake
   *  the moment two buildings are a hand's width out of line with each other. */
  const cell = (v: number): number => Math.round(v);
  /** How far a building's centre has to stay from a wall. The model is fitted
   *  to 1.7 wide, so 1.1 leaves its roof a quarter-metre clear of the masonry. */
  const WALL_GAP = 1.1;
  /** Cells between two buildings. At 1 they touch; 2 leaves a path. */
  const APART = 2;

  /** The places a building may not go, because something else is there and
   *  moving it is not on offer. Radii, not boxes — a building near the door is
   *  not wrong because of geometry, it is wrong because you walk through there. */
  const KEEPOUT: { x: number; z: number; r: number; what: string }[] = [
    { x: DOOR_AT.x, z: DOOR_AT.z, r: 2.6, what: 'the road out' },
    { x: SHOP_AT.x, z: SHOP_AT.z, r: 1.8, what: 'the shop' },
    ...RACK.map((r) => ({ x: r.x, z: r.z, r: 1.4, what: 'the weapon rack' })),
  ];

  /** Why this cell will not do, or null if it will.
   *
   *  Returns the REASON, not a boolean. A refusal the player cannot read is a
   *  button that does nothing, and the only thing more annoying than being told
   *  no is not being told why. */
  const blockedAt = (x: number, z: number, me: string): string | null => {
    // Read off the CURRENT size of the village, not a constant. The whole point
    // of buying land is that the edge moves.
    const l = LAND[land];
    if (Math.abs(x) > l.x - WALL_GAP || z > l.back - WALL_GAP || z < FRONT + WALL_GAP) {
      return 'Too close to the wall';
    }
    for (const k of KEEPOUT) {
      if (Math.hypot(x - k.x, z - k.z) < k.r) return `Too close to ${k.what}`;
    }
    for (const b of TOWN) {
      if (b.id === me) continue;
      const at = spots[b.id];
      if (at && Math.max(Math.abs(at.x - x), Math.abs(at.z - z)) < APART) {
        return `Too close to the ${b.name}`;
      }
    }
    return null;
  };

  /** Is there anywhere at all to put one more building?
   *
   *  Scanned rather than reasoned about: the answer depends on the size of the
   *  village, where the other buildings ended up and where the stall and the
   *  rack are, and every one of those moves. Nineteen squared integer tests
   *  once per shop render is nothing. */
  const roomForOne = (): boolean => {
    for (let z = -9; z <= 9; z++) {
      for (let x = -9; x <= 9; x++) if (blockedAt(x, z, '') === null) return true;
    }
    return false;
  };

  /** Where the thing in your hands would land: the cell you are standing on.
   *  The same rule as building a tower — stand where you want it. */
  const ghostAt = { x: 0, z: 0 };
  /** Where the thing in your hands was STANDING before you picked it up, or
   *  null if you have just bought it and it has never stood anywhere.
   *
   *  This is what makes "put it back" always possible. Lifting a building frees
   *  its own cell and `blockedAt` ignores the building being asked about, so
   *  the place you took it from is always somewhere it may go. */
  let cameFrom: { x: number; z: number } | null = null;
  /** A building just put down, whose collider is held off until the player has
   *  stepped out of it. Cleared by the frame loop, not by a timer — what makes
   *  it safe to turn on is the hero being elsewhere, not a second having passed. */
  let settling: string | null = null;
  /** Which building the hero is close enough to act on, republished every
   *  frame. Exposed because "walk 1.2m north of it" is not the same question as
   *  "am I at it" — with buildings two cells apart, an offset that clears one
   *  building can land nearer to its neighbour. */
  let standingAt: string | null = null;

  /** Hold a building to pick it up. Same numbers as selling a tower — one
   *  gesture, one duration, wherever you are in the game.
   *
   *  `MOVE_ARM_MS` is the dead zone: nothing at all happens for the first fifth
   *  of a second, so a tap that runs slightly long does not flash the ring and
   *  make a plain press look like it nearly did something else. */
  const MOVE_HOLD_MS = 800;
  const MOVE_ARM_MS = 200;
  let pressAt = 0;
  /** A press is in progress that has not been resolved into a tap or a hold. */
  let pressLive = false;
  /** The hold already fired, so releasing must NOT also count as a tap. */
  let holdDone = false;

  const makeBow = (): THREE.Object3D => {
    const g = new THREE.Object3D();
    const wood = new THREE.MeshStandardMaterial({ color: 0x8a5a2b, roughness: 0.8 });
    const limb = new THREE.Mesh(new THREE.TorusGeometry(0.17, 0.018, 6, 16, Math.PI * 1.15), wood);
    limb.rotation.z = Math.PI * 0.42;
    const string = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.004, 0.3, 4),
      new THREE.MeshStandardMaterial({ color: 0xe8e2d0, roughness: 1 }));
    string.position.x = 0.055;
    g.add(limb, string);
    return g;
  };
  /** One carved stick, three gems — the same staff the level builds, so what is
   *  on the pedestal is what ends up in your hand. */
  const makeStaff = (gem = 0x9b6cff, glow = 0x6a3fd6): THREE.Object3D => {
    const g = new THREE.Object3D();
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.02, 0.42, 6),
      new THREE.MeshStandardMaterial({ color: 0x6d4a2f, roughness: 0.9 }));
    const head = new THREE.Mesh(new THREE.OctahedronGeometry(0.055),
      new THREE.MeshStandardMaterial({ color: gem, emissive: glow,
        emissiveIntensity: 0.9, roughness: 0.3 }));
    head.position.y = 0.24;
    g.add(shaft, head);
    return g;
  };

  /** The display and the held copy are built the same way. Built TWICE rather
   *  than cloned: a clone would share a transform with something parented to a
   *  bone, which breaks the first time anyone rotates one. */
  const buildWeapon = async (id: Weapon): Promise<THREE.Object3D> => {
    const k = WEAPON_BY_ID.get(id)!;
    if (k.cast === 'melee') return (await loadModelAsset(manifest, 'sword', { assetBase: '' })).object;
    if (k.cast === 'arrow') return makeBow();
    return makeStaff(k.tint?.gem, k.tint?.glow);
  };

  if (handRight) {
    for (const r of RACK) {
      held[r.id] = await buildWeapon(r.id);
      held[r.id]!.traverse((o) => { if ((o as THREE.Mesh).isMesh) (o as THREE.Mesh).castShadow = true; });
      attachToSocket(hero, handRight, held[r.id]!);
    }
  }
  const showWeapon = (): void => {
    for (const r of RACK) if (held[r.id]) held[r.id]!.visible = r.id === weapon;
  };
  showWeapon();

  /** Which plinths exist at all: everything MADE, plus what the ARMORY opens.
   *
   *  All five used to stand there from the first visit, on the argument that an
   *  empty plinth is the thing you are saving for. That reads well with five
   *  and badly with twelve — it tells a new player exactly how many weapons
   *  this game will ever have, and this game is meant to keep getting weapons.
   *  One empty plinth is still something to save for; four of them is a
   *  catalogue with a known end, and adding a sixth later would visibly move
   *  it.
   *
   *  How many is the Armory's business: one empty plinth before you have built
   *  it, and one more per level after. A first version showed exactly the NEXT
   *  unforged weapon, which quietly turned the rack into a QUEUE — you could no
   *  longer save for the storm staff and skip the bow, and choosing what a run
   *  is for is the whole point of the Armory. Tying it to the building keeps
   *  the choice, gives the upgrade something visible to do, and a sixth weapon
   *  added later just appears at a higher level rather than lengthening a
   *  catalogue.
   *
   *  Declared BEFORE `showRack`, which reads it. A `const` reached by a
   *  function called earlier than the line that defines it is the temporal dead
   *  zone, and inside an async boot that shows up as a loading screen that
   *  never ends rather than as an error anybody sees. This game has had that
   *  once already.
   */
  const visibleRack = new Map<Weapon, boolean>();
  const rackShown = (id: Weapon): boolean => visibleRack.get(id) ?? false;

  // A weapon stands on its pedestal once it has been made.
  const displays = new Map<Weapon, THREE.Object3D>();
  for (const r of RACK) {
    const display = await buildWeapon(r.id);
    display.position.set(r.x, 0.42, r.z);
    display.rotation.z = Math.PI * 0.12;
    display.traverse((o) => { if ((o as THREE.Mesh).isMesh) (o as THREE.Mesh).castShadow = true; });
    display.userData.spin = true;
    world.scene.add(display);
    displays.set(r.id, display);
  }
  const showRack = (): void => {
    // Recomputed every time, not captured once: forging a weapon and upgrading
    // the Armory both change this, and the point is that it happens while you
    // are standing there watching.
    const offers = weaponCap() === 0 ? 1 : 1 + weaponCap();
    let offered = 0;
    for (const r of RACK) {
      const made = levelOf(weapons, r.id) > 0;
      const shown = made || offered < offers;
      if (!made && shown) offered += 1;
      visibleRack.set(r.id, shown);
      const d = displays.get(r.id);
      if (d) d.visible = made;
      // The plinth is a scene entity and deliberately NOT merged — see the
      // note in `merge.ts`. A folded entity has no visibility left to turn off.
      const plinth = world.entities.get(`pedestal_${r.id}`);
      if (plinth) plinth.visible = shown;
    }
  };
  showRack();

  // Open doors where you may go, shut ones where you may not. Both are in the
  // scene already: swapping a model at runtime means loading it at runtime, and
  // a door that pops in a second after the hub does reads as a glitch.
  LEVELS.forEach((lv, i) => {
    const open = world.entities.get(`door_${lv.id}`);
    const shut = world.entities.get(`door_${lv.id}_shut`);
    if (open) open.visible = levelOpen(i);
    if (shut) shut.visible = !levelOpen(i);
    // A shut door keeps its collider either way — it is only in the way when it
    // is the one being shown, and a locked doorway you can walk through is not
    // locked.
    if (!levelOpen(i)) {
      // Locked doors are the brightest thing on the wall otherwise: the kit's
      // shut door is a cheerful yellow arch and the open one is a dark opening,
      // so the eye goes straight to the two you cannot use. Muted, they read as
      // "not yet" and the way in reads as the way in. Only muted, though —
      // taking them to 0.42 made them vanish into the wall behind, and three
      // openings where two of them are solid is worse than three bright doors.
      shut?.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (!mesh.isMesh) return;
        // Clone before touching it: models cloned from one file SHARE their
        // materials, so dimming this door dims every door cut from the same
        // one — including the level's gates.
        const dim = (m: THREE.Material): THREE.Material => {
          const c = (m as THREE.MeshStandardMaterial).clone() as THREE.MeshStandardMaterial;
          c.color.multiplyScalar(0.72);
          return c;
        };
        mesh.material = Array.isArray(mesh.material)
          ? mesh.material.map(dim)
          : dim(mesh.material);
      });
      return;
    }
    const body = world.bodies.get(`door_${lv.id}_shut`);
    if (body) world.world.removeRigidBody(body);
  });

  // Show whichever building each plot has been paid for, and nothing on the
  // ones that have not. The foundation stays either way: an empty plot that
  // looks like grass is not an invitation.
  /** Sit a building ON its plot, whatever the model's origin happens to be.
   *
   *  Kenney's building models are not centred — `bld-house-c` measures 2 x 2.2
   *  from a corner — so placing one at the plot's coordinates put it half off
   *  the foundation and, on the far plots, straight through the hub wall. And
   *  the windmill is 3.1 tall, which is taller than the wall it stands beside.
   *  So: measure the geometry, scale it to the plot, and move it so its middle
   *  is the plot's middle and its feet are on the ground. */
  const fitToPlot = (obj: THREE.Object3D, plotSize: number): void => {
    obj.updateWorldMatrix(true, true);
    const box = new THREE.Box3();
    const one = new THREE.Box3();
    const rel = new THREE.Matrix4();
    const inv = new THREE.Matrix4().copy(obj.matrixWorld).invert();
    obj.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh || !mesh.geometry) return;
      if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
      one.copy(mesh.geometry.boundingBox!).applyMatrix4(rel.multiplyMatrices(inv, mesh.matrixWorld));
      box.union(one);
    });
    if (box.isEmpty()) return;
    const size = new THREE.Vector3();
    box.getSize(size);
    const wide = Math.max(size.x, size.z);
    const scale = wide > plotSize ? plotSize / wide : 1;
    obj.scale.setScalar(scale);
    const mid = new THREE.Vector3();
    box.getCenter(mid);
    // The offset is applied to the CHILD, so the plot's own position and
    // rotation stay exactly what the scene said they were.
    for (const child of [...obj.children]) {
      child.position.x -= mid.x;
      child.position.z -= mid.z;
      child.position.y -= box.min.y;
    }
  };

  /** A photograph of each building, made from the building.
   *
   *  A shop detail that is three lines of text does not look like a game — you
   *  are buying a THING and the panel never shows it. Same maker the hotbar
   *  cells use (`src/thumbs.ts`), so the picture is the model and changing the
   *  model changes the picture.
   *
   *  The LEVEL ONE model, which is what the Buy button gives you. Photographing
   *  the level-three one would be a nicer picture of something you are not
   *  buying.
   *
   *  CLONED, and made visible on the clone. The originals are hidden until the
   *  building is owned, and an invisible object renders as nothing at all —
   *  and handing the live entity to the thumb maker would take it out of the
   *  hub's scene and reset its transform on the way. */
  const shopShot = new Map<string, string>();
  {
    const thumbs = createThumbMaker(renderer);
    for (const b of TOWN) {
      const src = world.entities.get(`town_${b.id}_1`);
      if (!src) continue;
      try {
        const shot = src.clone(true);
        shot.traverse((o) => { o.visible = true; });
        shopShot.set(b.id, thumbs.make(shot));
      } catch { /* a picture is decoration; a hub that will not start is not */ }
    }
    thumbs.dispose();
  }

  /** Put every building where the save says it is, at the level it is.
   *
   *  Called on every change rather than every frame — the carried one moves
   *  each frame, and that is handled separately, because moving fifteen rigid
   *  bodies sixty times a second to set them back where they already were is
   *  work for nothing. */
  /** Put down what you are carrying, whatever the village looks like.
   *
   *  This is the guarantee that you cannot be stuck. Two cases, one gesture:
   *
   *   - you picked it up, so it goes back where it stood. Lifting a building
   *     frees its own cell and `blockedAt` ignores the building being asked
   *     about, so its old spot is always somewhere it may go.
   *   - you just bought it and it has never stood anywhere, so it goes back on
   *     the shelf and you get the materials back. In FULL: nothing was spent on
   *     it, and charging for undoing a corner the game walked you into is
   *     charging for our own mistake.
   *
   *  The shop refuses to sell into either corner in the first place. This is
   *  for the save that is already in one. */
  const undoCarry = (): void => {
    const b = carrying;
    if (!b) return;
    if (cameFrom) {
      spots[b.id] = { ...cameFrom };
      settling = b.id;
      cameFrom = null;
      carrying = null;
      showTown();
      audio.play(SFX.upgradeTower);
      void patchSave(shared.umicat, { spots });
    } else {
      const c = b.costs[0];
      store.gold += c.gold; store.wood += c.wood; store.stone += c.stone;
      delete town[b.id];
      carrying = null;
      showTown();
      renderPurse();
      audio.play('build');
      void patchSave(shared.umicat, { store, town, spots });
    }
  };

  /** The ring under whatever you are carrying.
   *
   *  Green where it may go, red where it may not. The ring is the answer to
   *  "can it go here", asked continuously while you walk — a card that only
   *  says no after you press is a guessing game.
   *
   *  Built in code rather than taken from the kit because it has to change
   *  colour, and `td-selection` is one shared material: tinting it would tint
   *  the shop's marker too. */
  const placeRing = new THREE.Mesh(
    new THREE.RingGeometry(0.62, 0.86, 48).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({
      color: 0x57c463, transparent: true, opacity: 0.85,
      depthWrite: false, side: THREE.DoubleSide,
    }),
  );
  placeRing.visible = false;
  placeRing.renderOrder = 4;
  world.scene.add(placeRing);

  /** Show the village at the size it has been paid for.
   *
   *  Each wall set is its own merged mesh (see `OWN_MESH` in `merge.ts`), so
   *  the picture is one `visible` per size. The COLLIDERS are separate: merging
   *  leaves bodies alone, keyed by entity id, so the five that belong to the
   *  wall being shown are the five that are enabled. Getting only half of this
   *  right gives you either a wall you walk through or a wall that is not
   *  there — both silent. */
  const showLand = (): void => {
    for (let i = 0; i < LAND.length; i++) {
      const mesh = world.scene.getObjectByName(`wall_${i}`);
      if (mesh) mesh.visible = i === land;
      for (const part of ['west', 'east', 'back', 'front_l', 'front_r']) {
        const body = world.bodies.get(`w${i}_${part}`);
        if (body) body.setEnabled(i === land);
      }
      // Trees standing on ground this size of village covers. Tagged by the
      // expansion that swallows them, so buying land clears exactly the ones
      // that would otherwise end up inside your own wall.
      const trees = world.scene.getObjectByName(`forest_claim_${i}`);
      if (trees) trees.visible = land < i;
    }
  };
  showLand();

  const showTown = (): void => {
    for (const b of TOWN) {
      const lv = town[b.id] ?? 0;
      const at = spots[b.id];
      for (let i = 1; i <= TOWN_MAX_LEVEL; i++) {
        const o = world.entities.get(`town_${b.id}_${i}`);
        const body = world.bodies.get(`town_${b.id}_${i}`);
        // Owned at this level AND standing somewhere. A building in your hands
        // is drawn by the carry code, not here.
        const up = i === lv && !!at;
        if (o) {
          if (!o.userData.fitted) {
            fitToPlot(o, 1.7);
            o.userData.fitted = true;
            // Before anything lifts it. Carrying raises the model, and putting
            // it down by reusing whatever y it happens to have would leave the
            // building hovering a metre off the grass — placed, solid, and
            // floating.
            o.userData.groundY = o.position.y;
          }
          o.visible = up;
          if (up) o.position.set(at.x, o.userData.groundY as number, at.z);
        }
        // A collider on a hidden building is a wall in the middle of a field.
        // The body has to be MOVED as well as enabled: leaving it at the scene's
        // parking spot would put an invisible house wherever the model used to
        // be, and the player would walk into nothing.
        if (body) {
          // Not solid while you are still inside it. You place a building on
          // the cell you are STANDING on, so switching its collider on at that
          // moment shuts a box around the hero — measured, not guessed: the
          // character could not move a single centimetre afterwards.
          body.setEnabled(up && settling !== b.id);
          if (up) {
            const t = body.translation();
            body.setTranslation({ x: at.x, y: t.y, z: at.z }, true);
          }
        }
      }
    }
  };
  showTown();

  // --- HUD ---
  hudEl.textContent = '';
  const purse = document.createElement('div');
  purse.style.cssText = 'font: 700 15px/1.5 system-ui, sans-serif;';
  const renderPurse = (): void => {
    // innerHTML, because the entries carry ICONS and an icon is an element.
    // This said `textContent` and printed four hundred characters of `<span
    // style=...>` across the top of the hub — the markup was correct, the sink
    // was not, and nothing typed anywhere says which of these a string is.
    purse.innerHTML = [
      `Lv ${level}`,
      store.gold > 0 && `${iconHtml('coin')} ${store.gold}`,
      store.wood > 0 && `${iconHtml('wood')} ${store.wood}`,
      store.stone > 0 && `${iconHtml('stone')} ${store.stone}`,
    ].filter(Boolean).join('   ');
  };
  renderPurse();
  // Same plate as a level's readout: this is the same white text in the same
  // corner over the same sky.
  //
  // No greeting. "Welcome, <name>" was the first thing on screen every single
  // time, and a line that says nothing you did not know is a line you stop
  // reading — which makes the one beside it, the purse, easier to miss too.
  hudEl.append(readoutPlate(purse));

  // There is no "NEW ·" banner any more. It announced the weapon the finished
  // level had handed over, and nothing is handed over now — what is waiting on
  // the rack is what you decide to pay for.

  // The board list. Above the controls layer, for the reason every
  // other panel in this game is: they are a full-screen layer at z-index 10.
  const panel = document.createElement('div');
  panel.dataset.hubPanel = '';
  panel.style.cssText = `
    position: fixed; left: 50%; top: 50%; transform: translate(-50%, -50%);
    z-index: 40; display: none; min-width: 260px; max-width: 82vw;
    background: rgba(18,22,28,.92); color: #fff; border-radius: 16px; padding: 18px 22px;
    font: 600 14px/1.7 system-ui, sans-serif; pointer-events: auto;
    flex-direction: column; max-height: 92vh; max-height: 92svh;
  `;

  /** Close is a corner, not a row at the bottom.
   *
   *  A phone in landscape is 393 CSS pixels tall. The shop is taller than that,
   *  so a Close button below the content sat BELOW THE SCREEN — no scrollbar to
   *  hint at it, no way to dismiss the panel except the hardware back gesture.
   *  A corner button cannot be pushed off by content.
   *
   *  The LEFT corner, macOS-style. The right one is not ours: umicat frames the
   *  game with its own pill for leaving it, and two round buttons a few pixels
   *  apart — one closing a panel, one quitting to the platform — is a misfire
   *  waiting to happen, and the expensive one is not ours to undo.
   *
   *  Outside the body, so it survives the innerHTML the panels rewrite on every
   *  render, and stays put while the body scrolls under it. `svh` (with a `vh`
   *  fallback line above it) so the browser chrome sliding in and out does not
   *  change the panel's height under the player. */
  const panelClose = document.createElement('button');
  panelClose.type = 'button';
  panelClose.setAttribute('aria-label', 'Close');
  panelClose.dataset.panelClose = '';
  panelClose.style.cssText = `
    position: absolute; top: 10px; left: 10px; width: 32px; height: 32px;
    border: 0; border-radius: 999px; background: rgba(255,255,255,.14);
    color: #fff; font: 700 17px/1 system-ui; cursor: pointer; padding: 0;
    display: flex; align-items: center; justify-content: center;
  `;
  panelClose.textContent = '\u00d7';

  /** Everything the panels render. It scrolls; the close button does not.
   *
   *  Indented past the button — every panel here starts with a heading on the
   *  left, and it would otherwise sit under it. */
  const panelBody = document.createElement('div');
  panelBody.style.cssText = 'overflow: auto; min-height: 0; padding-left: 30px;';
  panel.append(panelClose, panelBody);
  document.body.appendChild(panel);
  let panelOpen = false;
  panelClose.onclick = () => closePanel();

  // --- the sign that hangs over whatever you are standing at ---------------
  //
  // A one-line hint in the top-left corner is a line nobody reads: it is as far
  // from the building as the screen allows, and it had room for a price but not
  // for what the price BUYS. This is a card, and it is anchored to the thing
  // itself — projected from the building's own world position each frame, so it
  // follows as the camera moves and is never somewhere you have to go looking.
  //
  // `pointer-events: none` throughout: the action is the action button, the same
  // verb as everything else in the hub. Z-index sits above the platform's
  // on-screen controls (10) and the HUD (20), below the modal panel (40).
  const card = document.createElement('div');
  card.style.cssText = `
    position: fixed; z-index: 30; display: none; pointer-events: none;
    transform: translate(-50%, -100%);
    min-width: 210px; max-width: min(340px, 86vw);
    background: rgba(18,22,28,.92); color: #fff;
    border-radius: 14px; padding: 11px 14px;
    font: 600 13px/1.55 system-ui, sans-serif;
    text-shadow: none; box-shadow: 0 10px 28px rgba(0,0,0,.45);
  `;
  document.body.appendChild(card);

  // How high above a plot the card hangs. The camera sits at y 3.6 looking down,
  // so a couple of metres of world is most of the screen: at 2.6 the card
  // projected off the top edge and was clamped there, which put it as far from
  // the building as the corner it replaced.
  const PLOT_CARD_Y = 1.8;
  /** The single thing the action button does at this pedestal, if anything.
   *
   *  One button, in the order you would want it: make it, pick it up, make it
   *  better. That ordering is what lets the armory have no menu — "press again
   *  to improve it" is a rule you learn once. */
  const rackAction = (id: Weapon): 'forge' | 'take' | 'improve' | null => {
    const lvl = levelOf(weapons, id);
    if (lvl === 0) return 'forge';
    if (weapon !== id) return 'take';
    return lvl < Math.min(WEAPON_MAX_LEVEL, weaponCap()) ? 'improve' : null;
  };

  const cardAnchor = new THREE.Vector3();
  /** Put the card over a world point, clamped so it never hangs off the screen. */
  const placeCard = (x: number, y: number, z: number): void => {
    cardAnchor.set(x, y, z).project(world.camera);
    const sx = (cardAnchor.x * 0.5 + 0.5) * window.innerWidth;
    const sy = (-cardAnchor.y * 0.5 + 0.5) * window.innerHeight;
    const w = card.offsetWidth || 240, h = card.offsetHeight || 90;
    card.style.left = `${Math.max(w / 2 + 8, Math.min(window.innerWidth - w / 2 - 8, sx))}px`;
    // Behind the camera projects to a nonsense point; keep it on screen rather
    // than letting it fly off, since you can only be near what you can see.
    card.style.top = `${Math.max(h + 8, Math.min(window.innerHeight - 8, sy))}px`;
  };

  /** Rows, not a sentence: a title line, then whatever applies. */
  /** `lines` and `action` are HTML, because prices and materials carry ICONS
   *  now and an icon is an element. Everything that reaches this is authored
   *  here — building names, weapon names, prices — and player text must never
   *  be routed through it — nothing in this hub shows player text at all now
   *  that the leaderboard is gone, and that is the reason this is safe. */
  /** What the card over a building or a weapon says.
   *
   *  One shape, CENTRED, with a rule under the name:
   *
   *      NAME
   *      ────────────────
   *      what level it is
   *
   *      what it does for you
   *
   *      what the next level costs
   *      the button that does it
   *
   *  It was a left-aligned stack of `Now: …` / `Lv2: …` / `Cost: …` lines,
   *  which reads as a form rather than as a sign over a building, and put the
   *  label before the thing in every row — three colons down the left edge and
   *  the actual numbers never in the same place twice.
   *
   *  `level`, `body` and `cost` are HTML, because prices carry icons and an
   *  icon is an element. Everything reaching this is authored here; nothing in
   *  this hub shows player text at all, which is the only reason that is safe.
   */
  interface Card {
    title: string;
    glyph?: IconName;
    /** "Lv2", or "Not built yet". */
    level?: string;
    /** What it does. One line, in plain words. */
    body?: string;
    /** What the next level costs, or what is missing. */
    cost?: string;
    /** The button, in gold. */
    action?: string;
  }
  const showCard = (c: Card): void => {
    card.innerHTML = '';
    const add = (html: string, css: string): void => {
      if (!html) return;
      const d = document.createElement('div');
      d.style.cssText = css;
      d.innerHTML = html;
      card.append(d);
    };
    add((c.glyph ? `${iconHtml(c.glyph)} ` : '') + escapeHtml(c.title),
      'font: 800 17px/1.35 system-ui, sans-serif; text-align: center;'
      + 'display: flex; align-items: center; justify-content: center; gap: 8px;'
      + 'padding-bottom: 7px; border-bottom: 1px solid rgba(255,255,255,.22);');
    add(c.level ?? '', 'text-align: center; opacity: .66; margin-top: 6px; font-size: 12px;');
    add(c.body ?? '', 'text-align: center; margin-top: 10px; opacity: .92;');
    add(c.cost ?? '', 'text-align: center; margin-top: 10px; opacity: .92;');
    add(c.action ?? '',
      'text-align: center; margin-top: 8px; color: #ffd76a;'
      + 'font: 700 13px/1.4 system-ui, sans-serif;');
    card.style.display = 'block';
  };

  const closePanel = (): void => {
    panelOpen = false;
    panel.style.display = 'none';
    // The shop widens it; the board list must not inherit that.
    panel.style.width = '';
    panel.style.maxWidth = '82vw';
    input.setEnabled(true);
  };

  /** The shop, opened at the stall.
   *
   *  A full panel rather than another floating card: it is a CATALOGUE — a
   *  list on the left, what that one is on the right — and a catalogue in a
   *  card over someone's head is a card with a scrollbar in it.
   *
   *  It sells the FIRST level of a thing and nothing else. Upgrading stays
   *  where it was: you walk to the building and press the button in front of
   *  it. Buying is a one-off choice between things you do not have, which is
   *  what a list is for; upgrading is a repeated decision about a thing you can
   *  see, which is what standing in front of it is for.
   *
   *  The four empty plots are gone with it. They told a new player exactly how
   *  many buildings this game has — the same objection as four board rows with
   *  three padlocks and five weapon plinths — and this game is meant to keep
   *  getting buildings.
   */
  /** A price, as icons and numbers. Shared by the shop and the cards over the
   *  buildings — the same three materials should not be written twice. */
  const priceOf = (c: Materials): string =>
    [c.gold && `${iconHtml('coin')} ${c.gold}`,
     c.wood && `${iconHtml('wood')} ${c.wood}`,
     c.stone && `${iconHtml('stone')} ${c.stone}`]
      .filter(Boolean).join('  ');

  let shopPick = 0;
  /** Anything the stall sells. Buildings are one kind of thing it sells, not
   *  the shape of the shop — the village's SIZE is for sale too, and the user
   *  expects more kinds later. Each item knows its own price, its own picture
   *  and what buying it does. */
  interface ShopItem {
    id: string;
    name: string;
    icon: IconName;
    effect: string;
    cost: Materials;
    shot?: string;
    /** Why this cannot be bought right now, whatever the price. Shown in place
     *  of the price, because "you cannot afford it" and "you have nowhere to
     *  put it" are different problems and only one of them is fixed by a run. */
    refuse?: string;
    buy: () => void;
  }

  /** A picture of what more land buys: the village you have, and the one you
   *  would have, drawn to scale from the same numbers the walls are built from.
   *
   *  Drawn rather than photographed. A thumbnail of a wall is a picture of a
   *  wall; what is actually for sale is the SHAPE getting bigger, and that is
   *  a diagram. */
  const landShot = (from: number): string => {
    const S = 128;
    const c = document.createElement('canvas');
    c.width = S; c.height = S;
    const g = c.getContext('2d');
    if (!g) return '';
    const now = LAND[from];
    const next = LAND[from + 1];
    const pad = 10;
    // Both villages share their FRONT edge, because that is what happens: the
    // gate does not move and the village grows backwards and sideways from it.
    // Drawing them concentric made the two look almost the same size and said
    // the wrong thing about where the new ground appears.
    const span = Math.max(next.x * 2, next.back - FRONT);
    const k = (S - pad * 2) / span;
    const xOf = (x: number): number => S / 2 + x * k;
    const yOf = (z: number): number => pad + (z - FRONT) * k;
    const plot = (l: { x: number; back: number }, stroke: string, fill: string): void => {
      g.beginPath();
      g.roundRect(xOf(-l.x), yOf(FRONT), l.x * 2 * k, (l.back - FRONT) * k, 6);
      g.fillStyle = fill; g.fill();
      g.strokeStyle = stroke; g.lineWidth = 3; g.stroke();
    };
    plot(next, 'rgba(255,215,106,.95)', 'rgba(255,215,106,.18)');
    plot(now, 'rgba(255,255,255,.7)', 'rgba(255,255,255,.12)');
    // The gate, so the picture has a front and you can see which way it grew.
    g.strokeStyle = '#1b2026'; g.lineWidth = 4;
    g.beginPath(); g.moveTo(xOf(-0.7), yOf(FRONT)); g.lineTo(xOf(0.7), yOf(FRONT)); g.stroke();
    g.strokeStyle = 'rgba(255,215,106,.95)'; g.lineWidth = 2.5;
    g.beginPath(); g.arc(xOf(0), yOf(FRONT), 0.7 * k, Math.PI, 0); g.stroke();
    return c.toDataURL('image/png');
  };

  const shopStock = (): ShopItem[] => {
    const items: ShopItem[] = [];
    // Land first. It is the thing that makes room for everything under it, and
    // the only item whose price the player can already feel.
    if (land < LAND.length - 1) {
      items.push({
        id: 'land',
        name: 'More land',
        icon: 'gate',
        effect: 'Pushes the village wall out, and clears the trees behind it',
        cost: LAND_COST[land],
        shot: landShot(land),
        buy: () => {
          land += 1;
          showLand();
          void patchSave(shared.umicat, { land });
          showShop();
        },
      });
    }
    // A building you cannot put down is not a purchase, it is a trap. Two
    // things stop one being sold:
    //
    //  - nowhere to put it. The village fills up, and at its smallest three
    //    badly-placed buildings can leave no legal cell at all.
    //  - something already in your hands. One at a time keeps the whole thing
    //    analysable: there is never a queue of bought-but-unplaced buildings,
    //    and "is there room for one more" is a question about one building.
    //
    // Land is exempt from both. It is the thing that FIXES having nowhere to
    // put something, so it must stay buyable in exactly the state where
    // everything else is refused.
    const noRoom = !roomForOne();
    for (const b of TOWN) {
      if ((town[b.id] ?? 0) !== 0) continue;
      items.push({
        id: b.id, name: b.name, icon: b.icon, effect: b.effect,
        cost: b.costs[0], shot: shopShot.get(b.id),
        refuse: carrying
          ? `Put down the ${carrying.name} first`
          : (noRoom ? 'Nowhere left to put it — buy more land' : undefined),
        buy: () => {
          town[b.id] = 1;
          cameFrom = null;
          void patchSave(shared.umicat, { store, town });
          // It goes straight into your hands and the shop gets out of the way.
          // Buying a building and then being told to find somewhere to press
          // again is a second errand for one decision.
          carrying = b;
          closePanel();
        },
      });
    }
    return items;
  };

  const showShop = (): void => {
    panelOpen = true;
    input.setEnabled(false);
    panel.style.display = 'flex';
    // A real page, not a tooltip that grew. A catalogue has two columns and
    // wants room for both; the board-list panel beside it is a short menu and
    // should stay the size of its own contents.
    panel.style.width = 'min(860px, 86vw)';
    panel.style.maxWidth = '86vw';
    const stock = shopStock();
    shopPick = Math.min(shopPick, Math.max(0, stock.length - 1));
    const sel = stock[shopPick];

    const rows = stock.length
      ? stock.map((b, i) => {
        const on = i === shopPick;
        const afford = canAfford(store, b.cost);
        return `<button data-pick="${i}" style="
            display:flex; align-items:center; gap:10px; width:100%; margin:4px 0;
            padding:9px 12px; border:0; border-radius:11px; cursor:pointer;
            font:700 14px/1.4 system-ui; text-align:left;
            background:${on ? 'rgba(255,255,255,.92)' : 'rgba(255,255,255,.10)'};
            color:${on ? '#1b2026' : '#fff'}; opacity:${afford || on ? 1 : 0.55}">
            ${iconHtml(b.icon, '1.3em')}<span style="flex:1">${escapeHtml(b.name)}</span>
          </button>`;
      }).join('')
      : '<div style="opacity:.7;padding:10px 2px">Nothing left to buy.</div>';

    const shot = sel?.shot;
    const detail = sel
      ? `<div style="font:800 19px/1.4 system-ui; display:flex; align-items:center;
                     justify-content:center; gap:9px; padding-bottom:9px;
                     border-bottom:1px solid rgba(255,255,255,.22)">
           ${iconHtml(sel.icon, '1.2em')}${escapeHtml(sel.name)}</div>
         ${shot ? `<img alt="${escapeHtml(sel.name)}" src="${shot}" style="
             display:block; margin:10px auto 0; width:min(190px, 28vh); width:min(190px, 28svh);
             aspect-ratio:1; object-fit:contain;
             background:rgba(255,255,255,.06); border-radius:16px">` : ''}
         <div style="margin-top:10px; opacity:.92">${escapeHtml(sel.effect)}</div>
         <div style="margin-top:16px">${priceOf(sel.cost)}</div>
         ${(() => {
    // Three states, and the refusal outranks the price: being told what it
    // costs when the problem is that you have nowhere to put it sends you off
    // to earn materials that will not help.
    const can = !sel.refuse && canAfford(store, sel.cost);
    const label = sel.refuse ?? (can ? 'Buy' : `needs ${shortfall(store, sel.cost)}`);
    return `<button id="shop-buy" ${can ? '' : 'disabled'} style="
             margin-top:18px; padding:11px 26px; border:0; border-radius:999px;
             cursor:${can ? 'pointer' : 'default'}; font:800 15px system-ui;
             max-width:100%; white-space:normal;
             background:${can ? '#ffd76a' : 'rgba(255,255,255,.16)'};
             color:${can ? '#241b00' : 'rgba(255,255,255,.55)'}">${label}</button>`;
  })()}`
      : '<div style="opacity:.7">Nothing left to buy.</div>';

    panelBody.innerHTML =
      `<div style="font:800 18px/1.6 system-ui; margin-bottom:10px">Shop</div>
       <div style="display:flex; gap:20px; align-items:stretch">
         <div style="width:180px; max-height:52vh; overflow:auto">${rows}</div>
         <div style="flex:1; min-width:210px; text-align:center;
                     border-left:1px solid rgba(255,255,255,.14); padding-left:20px">
           ${detail}</div>
       </div>`;

    for (const el of panelBody.querySelectorAll<HTMLButtonElement>('button')) {
      el.onclick = () => {
        if (el.dataset.pick) { shopPick = Number(el.dataset.pick); showShop(); return; }
        if (el.id === 'shop-buy' && sel && !sel.refuse && canAfford(store, sel.cost)) {
          // Paying is the same for everything on the shelf; what the purchase
          // DOES belongs to the item.
          const c = sel.cost;
          store.gold -= c.gold; store.wood -= c.wood; store.stone -= c.stone;
          renderPurse();
          audio.play(SFX.placeTower);
          sel.buy();
        }
      };
    }
  };

  /** The list of boards, opened by walking through the door.
   *
   *  Everything you have unlocked, with how far you got on each — a menu that
   *  only offers the next board is a corridor, and the point of finishing one
   *  is partly being able to go back to it. Resolves the hub with whichever is
   *  chosen; closing it puts you back in front of the door.
   *
   *  **A board you have not reached is not in the list at all.** It used to be
   *  a greyed row saying "clear Meadow", which tells a new player the game is
   *  four boards long — and this game is meant to keep getting boards. A list
   *  that ends where you are ends nowhere in particular; a list of four with
   *  three padlocks is a progress bar with a known end, and adding a fifth
   *  board later would visibly move the finish line.
   */
  const chooseLevel = (onPick: (i: number) => void): void => {
    panelOpen = true;
    input.setEnabled(false);
    panel.style.display = 'flex';
    const rows = LEVELS.map((lv, i) => ({ lv, i })).filter(({ i }) => levelOpen(i)).map(({ lv, i }) => {
      const best = progress.bests?.[lv.id] ?? 0;
      const note = best
        ? `<span style="opacity:.6">best wave ${best}/${lv.waves.length}</span>`
        : '<span style="opacity:.6">not played</span>';
      return `<button data-level="${i}" style="
          display:flex; gap:12px; align-items:baseline; justify-content:space-between;
          width:100%; margin:6px 0; padding:10px 14px; border:0; border-radius:12px;
          font:600 14px/1.5 system-ui; text-align:left; cursor:pointer;
          background:#fff; color:#222">
          <span style="font-weight:800">${escapeHtml(lv.name)}</span>
          <span style="flex:1;opacity:.7;font-weight:600">${escapeHtml(lv.blurb)}</span>
          ${note}</button>`;
    }).join('');
    // Said once, at the bottom, instead of listed as padlocks. It promises
    // there is more without promising HOW MUCH more.
    const more = cleared + 1 < LEVELS.length
      ? `<div style="opacity:.55;font:600 12px/2 system-ui">Clear ${escapeHtml(LEVELS[cleared].name)} to find the next one.</div>`
      : '';
    panelBody.innerHTML =
      '<div style="font:700 17px/1.8 system-ui">Where to?</div>' + rows + more;
    for (const el of panelBody.querySelectorAll<HTMLButtonElement>('button')) {
      el.onclick = () => {
        const i = Number(el.dataset.level);
        if (!levelOpen(i)) return;
        closePanel();
        onPick(i);
      };
    }
  };


  // Built, placed and about to render: the next frame is a real one.
  hideLoading();

  // The same readout the levels have. The hub is eleven hundred objects of
  // forest now and it was the one place with no way to see what that cost.
  const debug = createDebugHud(renderer, hudEl,
    DEV ? DEV_BANNER : undefined, toggleDev);

  // --- the loop ---
  return await new Promise<HubChoice>((resolve) => {
    let last = performance.now();
    let done = false;
    renderer.setAnimationLoop((now: number) => {
      const dt = Math.min((now - last) / 1000, 0.05);
      last = now;

      const turn = input.look();
      if (turn.x || turn.y) world.orbit(turn.x, turn.y);
      const dir = input.direction(world.cameraYaw);
      character.update(dt, dir, { jump: input.jump });
      character.syncTo(hero, -0.36);
      character.faceTowards(hero, dir, dt);
      animator.update(character.state);

      // Close to a doorway, not through it: the prompt is what tells a new
      // player the door is a door before they walk into it, and which board is
      // behind it.
      // Which plot you are standing at, if any.
      const shopAt = SHOP_AT;
      const atShop = Math.hypot(hero.position.x - shopAt.x, hero.position.z - shopAt.z) < NEAR + 0.3;
      const shopRing = world.entities.get('shop_marker');
      if (shopRing) shopRing.visible = atShop && !panelOpen;

      // --- what you are carrying, and where it would land ------------------
      //
      // Follows the cell you are standing on, lifted clear of your head so it
      // reads as held rather than built. The ring underneath answers "can it go
      // here" while you walk, instead of after you press.
      ghostAt.x = cell(hero.position.x);
      ghostAt.z = cell(hero.position.z);
      const blocked = carrying ? blockedAt(ghostAt.x, ghostAt.z, carrying.id) : null;
      placeRing.visible = !!carrying && !panelOpen;
      if (carrying && panelOpen) {
        // The carry code below is what draws it. Skipping that while a panel is
        // up would leave the building frozen in mid-air over the last cell.
        const lv = town[carrying.id] ?? 1;
        const o = world.entities.get(`town_${carrying.id}_${lv}`);
        if (o) o.visible = false;
      }
      if (carrying && !panelOpen) {
        placeRing.position.set(ghostAt.x, 0.03, ghostAt.z);
        (placeRing.material as THREE.MeshBasicMaterial).color.setHex(blocked ? 0xd0453a : 0x57c463);
        const lv = town[carrying.id] ?? 1;
        for (const b of TOWN) {
          for (let i = 1; i <= TOWN_MAX_LEVEL; i++) {
            const o = world.entities.get(`town_${b.id}_${i}`);
            if (!o) continue;
            const isGhost = b.id === carrying.id && i === lv;
            if (!isGhost) continue;
            if (!o.userData.fitted) { fitToPlot(o, 1.7); o.userData.fitted = true; }
            o.visible = true;
            o.position.set(ghostAt.x, 1.15 + Math.sin(now / 320) * 0.06, ghostAt.z);
          }
        }
      }

      // Turn a just-placed building solid as soon as the player is out of it.
      if (settling) {
        const at = spots[settling];
        if (!at || Math.hypot(hero.position.x - at.x, hero.position.z - at.z) > 1.4) {
          settling = null;
          showTown();
        }
      }

      // The NEAREST building you are standing at, not the last one in the table.
      // Buildings may now be two cells apart and the reach is 1.9, so the zones
      // overlap — and with the old loop, standing between the Smithy and the
      // Clinic upgraded whichever happened to come later in `TOWN`. Which one
      // you are at has to be a fact about where you are standing.
      let atPlot: typeof TOWN[number] | null = null;
      if (!carrying) {
        let best = 1.9;
        for (const b of TOWN) {
          const at = spots[b.id];
          if (!at) continue;
          const d = Math.hypot(hero.position.x - at.x, hero.position.z - at.z);
          if (d < best) { best = d; atPlot = b; }
        }
      }
      standingAt = atPlot?.id ?? null;

      const nearDoor = hero.position.z < DOOR_AT.z + 1.7
        && Math.abs(hero.position.x - DOOR_AT.x) < 1.6;

      // Which weapon you are standing at, if any.
      let atPickup: typeof RACK[number] | null = null;
      for (const pick of RACK) {
        // Only a plinth that is THERE. Standing on the spot where a hidden one
        // would be and being offered a weapon to forge is the rack leaking the
        // catalogue it was just made to stop showing.
        const near = rackShown(pick.id)
          && Math.hypot(hero.position.x - pick.x, hero.position.z - pick.z) < NEAR;
        const ring = world.entities.get(`pickup_marker_${pick.id}`);
        if (ring) ring.visible = near && !panelOpen;
        if (near) atPickup = pick;
      }

      // The displays turn, so they read as things to take rather than scenery.
      for (const o of world.scene.children) {
        if (o.userData.spin) o.rotation.y += dt * 1.2;
      }

      // Only when there is something to say, and then briefly. A line of
      // narration that is always on screen is one nobody reads.
      // What the card says about a plot: where it is now, what the next level
      // changes, and what that costs — or, when it cannot be paid for, what is
      // MISSING, which is a thing you can go and do something about.
      const plotCard = (b: typeof TOWN[number]): void => {
        const lv = town[b.id] ?? 0;
        if (lv >= TOWN_MAX_LEVEL) {
          showCard({
            title: b.name, glyph: b.icon,
            level: `Lv${lv} · fully built`,
            body: townNow(b.id, town),
          });
          return;
        }
        const cost = b.costs[lv];
        showCard({
          title: b.name,
          glyph: b.icon,
          level: lv ? `Lv${lv}` : 'Not built yet',
          // What the NEXT level gives you, not what this one already does.
          // Standing at a building you are deciding whether to pay, and what
          // you are paying for is the step, not the state.
          body: lv ? townAfter(b.id, town, lv + 1) : b.effect,
          cost: canAfford(store, cost)
            ? priceOf(cost)
            : `needs ${shortfall(store, cost)}`,
          action: canAfford(store, cost)
            ? `${iconHtml('build')} build Lv${lv + 1}`
            : undefined,
        });
      };

      /** A weapon, at whatever stage it is in. The lines change with the stage
       *  because what you want to know changes with it: an empty pedestal is a
       *  price, a made weapon is a number you are about to take into a fight. */
      const rackCard = (id: Weapon): void => {
        const k = WEAPON_BY_ID.get(id)!;
        const lvl = levelOf(weapons, id);
        const cap = Math.min(WEAPON_MAX_LEVEL, weaponCap());
        const cost = nextCost(id, lvl);
        const canStep = lvl < cap && cost;
        const at = (n: number): string =>
          `${weaponDamage(id, n)} damage${effectText(id, n) ? ` · ${effectText(id, n)}` : ''}`;
        // WHAT IT DOES, in one line — the blurb until it is made, its numbers
        // once it is. Not both, and never glued to why you cannot buy it: those
        // are two different thoughts and the `·` between them read as one.
        const body = lvl > 0 ? at(lvl) : k.blurb;
        // WHAT STANDS BETWEEN YOU AND THE NEXT LEVEL: a price, or the building
        // that has to exist first. The one dead end worth explaining is that
        // the weapon exists, the money may even be there, and the reason
        // nothing happens is a building.
        let gate: string | undefined;
        if (canStep) {
          gate = canAfford(store, cost!)
            ? `Lv${lvl + 1} · ${at(lvl + 1)}<br>${priceOf(cost!)}`
            : `needs ${shortfall(store, cost!)}`;
        } else if (lvl === 0) {
          gate = weaponCap() === 0 ? 'The Armory has not been built' : `Needs Armory Lv${lvl + 1}`;
        } else if (lvl >= WEAPON_MAX_LEVEL) {
          gate = 'Fully forged';
        } else {
          gate = `Improving needs Armory Lv${lvl + 1}`;
        }

        const act = rackAction(id);
        let action: string | undefined;
        if (act === 'take') action = `${iconHtml('build')} take`;
        else if (act === 'forge' || act === 'improve') {
          if (canStep) {
            action = canAfford(store, cost!)
              ? (act === 'forge'
                ? `${iconHtml('build')} forge`
                : `${iconHtml('build')} improve to Lv${lvl + 1}`)
              : undefined;
          }
        } else if (id === weapon) action = 'equipped';
        // Same shape as a building: name, rule, level, what it does, what the
        // step costs.
        showCard({
          title: k.name,
          glyph: k.icon,
          level: lvl ? `Lv${lvl}` : 'Not forged yet',
          body,
          cost: gate,
          action,
        });
      };

      if (panelOpen) {
        card.style.display = 'none';
      } else if (carrying) {
        showCard({
          title: carrying.name,
          glyph: carrying.icon,
          level: 'In your hands',
          // The reason, when there is one. "You cannot put it here" without
          // saying why is a button that does nothing.
          body: blocked ?? 'Stand where you want it',
          // The way out is offered exactly when it is needed. A permanent
          // "hold to put it back" is the corner hint we already took off the
          // screen once; a player standing somewhere legal does not need it,
          // and a player who cannot put it down anywhere does.
          action: blocked
            ? `${iconHtml('build')} hold to put it back`
            : `${iconHtml('build')} put it down`,
        });
        placeCard(ghostAt.x, 2.1, ghostAt.z);
      } else if (atPlot) {
        plotCard(atPlot);
        placeCard(spots[atPlot.id]!.x, PLOT_CARD_Y, spots[atPlot.id]!.z);
      } else if (atPickup) {
        rackCard(atPickup.id);
        placeCard(atPickup.x, 1.1, atPickup.z);
      } else if (atShop) {
        const left = shopStock().length;
        showCard({
          title: 'Shop', glyph: 'coin',
          body: left ? `${left} thing${left > 1 ? 's' : ''} to buy` : 'Nothing left to buy',
          action: left ? `${iconHtml('build')} open` : undefined,
        });
        placeCard(shopAt.x, 1.5, shopAt.z);
      } else if (nearDoor) {
        showCard({ title: 'The road out', glyph: 'gate',
          body: 'Choose which board to take', action: 'walk through' });
        placeCard(DOOR_AT.x, 2.0, DOOR_AT.z);
      } else {
        card.style.display = 'none';
      }

      // --- the action button ------------------------------------------------
      //
      // A tap resolves on RELEASE, not on press, because a HOLD on a building
      // means something else — pick it up and move it. Same shape as selling a
      // tower in a level, so it is one gesture to learn rather than two.
      const useDown = input.held('use');
      if (!panelOpen && input.consume('use')) { pressAt = now; pressLive = true; holdDone = false; }
      if (panelOpen) { pressLive = false; }

      // A hold means "undo whatever this is": at a building, pick it up; with
      // something in your hands, PUT IT BACK. The second is what guarantees you
      // can never be stuck holding a building — see `undoCarry`.
      const holdOn: 'plot' | 'carry' | null = carrying ? 'carry' : (atPlot ? 'plot' : null);
      /** How far through a hold, 0 until it has outlived a tap. */
      const holdK = pressLive && useDown && holdOn && !holdDone
        ? Math.max(0, Math.min(1, (now - pressAt - MOVE_ARM_MS) / (MOVE_HOLD_MS - MOVE_ARM_MS)))
        : 0;
      if (holdK > 0 && holdOn === 'carry') {
        placeRing.position.set(ghostAt.x, 0.03, ghostAt.z);
        (placeRing.material as THREE.MeshBasicMaterial).color.setHex(0xe0a53a);
        placeRing.geometry.dispose();
        placeRing.geometry = new THREE.RingGeometry(
          0.62, 0.86, 48, 1, -Math.PI / 2 - holdK * Math.PI * 2, holdK * Math.PI * 2,
        ).rotateX(-Math.PI / 2);
      } else if (holdK > 0 && atPlot) {
        // The sweep rides the same ring the carried building uses — you cannot
        // be carrying one and standing at another at the same time.
        const at = spots[atPlot.id]!;
        placeRing.visible = true;
        placeRing.position.set(at.x, 0.03, at.z);
        (placeRing.material as THREE.MeshBasicMaterial).color.setHex(0xe0a53a);
        placeRing.geometry.dispose();
        placeRing.geometry = new THREE.RingGeometry(
          0.62, 0.86, 48, 1, -Math.PI / 2 - holdK * Math.PI * 2, holdK * Math.PI * 2,
        ).rotateX(-Math.PI / 2);
      } else if (placeRing.userData.swept) {
        // Back to a whole ring. The sweep is baked into the geometry, so there
        // is nothing to reset but the geometry itself.
        placeRing.geometry.dispose();
        placeRing.geometry = new THREE.RingGeometry(0.62, 0.86, 48).rotateX(-Math.PI / 2);
        if (!carrying) placeRing.visible = false;
      } else if (!carrying) {
        placeRing.visible = false;
      }
      placeRing.userData.swept = holdK > 0;

      // Held long enough. On a building, lift it; holding what you are already
      // carrying puts it back.
      if (pressLive && useDown && !holdDone && holdOn && now - pressAt >= MOVE_HOLD_MS) {
        holdDone = true;
        if (holdOn === 'carry') undoCarry();
        else if (atPlot) {
          const b = atPlot;
          cameFrom = { ...spots[b.id]! };
          delete spots[b.id];
          carrying = b;
          showTown();
          audio.play('build');
          void patchSave(shared.umicat, { spots });
        }
      }

      const tapped = pressLive && !useDown && !holdDone;
      if (pressLive && !useDown) { pressLive = false; }

      if (!panelOpen && tapped) {
        // The stall wins over what is in your hands, and that is not a detail.
        // The shop's own keep-out radius is wider than the distance at which
        // you count as standing at it, so a building can NEVER be placed here —
        // and a player holding a building they have nowhere to put, who walks
        // to the shop to buy the land that would make room, would be told
        // "Too close to the shop" and left holding it for good.
        if (atShop) {
          if (shopStock().length) { audio.play('build'); showShop(); }
          else audio.play('denied');
        } else if (carrying) {
          // Putting it down. `blocked` was computed this frame from the same
          // cell the ring is drawn on, so what you see is what is checked.
          if (blocked) { audio.play('denied'); }
          else {
            spots[carrying.id] = { x: ghostAt.x, z: ghostAt.z };
            settling = carrying.id;
            carrying = unplaced()[0] ?? null;
            showTown();
            audio.play(SFX.upgradeTower);
            void patchSave(shared.umicat, { spots });
          }
        } else if (atPlot) {
          const lv = town[atPlot.id] ?? 0;
          const cost = lv < TOWN_MAX_LEVEL ? atPlot.costs[lv] : null;
          if (!cost || !canAfford(store, cost)) { audio.play('denied'); }
          else {
            store.gold -= cost.gold;
            store.wood -= cost.wood;
            store.stone -= cost.stone;
            town[atPlot.id] = lv + 1;
            showTown();
            renderPurse();
            audio.play(SFX.upgradeTower);
            void patchSave(shared.umicat, { store, town });
          }
        } else if (atPickup) {
          const id = atPickup.id;
          const act = rackAction(id);
          const lvl = levelOf(weapons, id);
          if (act === 'take') {
            weapon = id;
            showWeapon();
            audio.play('build');
            void patchSave(shared.umicat, { weapon });
          } else if (act === 'forge' || act === 'improve') {
            const cost = lvl < Math.min(WEAPON_MAX_LEVEL, weaponCap()) ? nextCost(id, lvl) : null;
            if (!cost || !canAfford(store, cost)) { audio.play('denied'); }
            else {
              store.gold -= cost.gold; store.wood -= cost.wood; store.stone -= cost.stone;
              weapons[id] = lvl + 1;
              showRack();
              renderPurse();
              audio.play(SFX.upgradeTower);
              // Forging it also puts it in your hand. Making a weapon and then
              // being asked to pick it up is a second press for nothing.
              if (lvl === 0) { weapon = id; showWeapon(); }
              void patchSave(shared.umicat, { store, weapons, weapon });
            }
          } else {
            audio.play('denied');
          }
        }
      }

      // Through the doorway opens the list. It does not start anything by
      // itself — the last step of leaving is choosing where to go, and a door
      // that commits you the moment you touch it is a door you cannot approach.
      const inDoorway = hero.position.z < DOOR_AT.z
        && Math.abs(hero.position.x - DOOR_AT.x) < DOOR_HALF_WIDTH;
      if (!done && !panelOpen && inDoorway) {
        audio.play(SFX.door);
        chooseLevel((pick) => {
          done = true;
          // Tear the hub down before handing the renderer over: its scene, its
          // physics and its listeners would otherwise keep running behind the
          // level, invisibly, for the rest of the session.
          renderer.setAnimationLoop(null);
          window.removeEventListener('resize', resize);
          input.dispose();
          panel.remove();
          card.remove();
          hudEl.textContent = '';
          world.dispose();
          // `dispose()` frees the GPU resources; it does not empty the graph.
          // Clearing it as well is what makes "the hub is gone" true rather
          // than merely invisible — and it is the difference a probe can see.
          world.scene.clear();
          delete (window as unknown as Record<string, unknown>).__hub;
          resolve({ weapon, level: pick, bonus: bonusesFrom(town), weapons });
        });
        // Step back out of the doorway, so closing the list does not
        // immediately reopen it.
        character.teleport({ x: hero.position.x, y: 0.5, z: DOOR_AT.z + 0.9 });
      }

      debug.tick(now, dt);
      world.update(dt);
      renderer.render(world.scene, world.camera);
    });

    Object.assign(window as unknown as Record<string, unknown>, {
      __hub: { world, character, input, hero, weapon: () => weapon,
               /** The save API itself, so a probe can put the game into a state
                *  a player would take several runs to reach — through the same
                *  door the game uses, rather than by guessing at how the SDK
                *  spells a localStorage key. */
               umicat,
               /** Which weapons have been MADE, and how far. Reading the scene
                *  for models would answer "is something drawn there", which is
                *  not the same question. */
               weapons: () => ({ ...weapons }),
               weaponCap: () => weaponCap(),
               rackAction: (id: string) => rackAction(id as Weapon),
               runs, cleared,
               THREE,
               /** How much of the scene got folded into how few meshes. The
                *  thing worth asserting about a merge is its RESULT — counting
                *  objects by name finds nothing once they are merged, which is
                *  the merge working. */
               merged: () => folded,
               coin: () => store.gold,
               store: () => ({ ...store }),
               level: () => level,
               town: () => ({ ...town }),
               /** Where each building actually stands — the save's answer, not
                *  the table's. `x`/`z` on a TOWN entry are now only the place a
                *  pre-placement save gets migrated to. */
               plots: () => TOWN.map((b) => ({
                 id: b.id, level: town[b.id] ?? 0,
                 x: spots[b.id]?.x ?? null, z: spots[b.id]?.z ?? null,
               })),
               carrying: () => carrying?.id ?? null,
               standingAt: () => standingAt,
               /** How much of the village has been bought, and the bounds that
                *  buys — so a probe walks to the wall rather than to a number
                *  copied out of the scene generator. */
               land: () => ({ level: land, ...LAND[land], front: FRONT }),
               /** Where the stall is. It has moved once already; a probe that
                *  hardcodes it finds an empty patch of grass and reports that
                *  the shop does not open. */
               shopAt: () => ({ ...SHOP_AT }),
               /** Why the cell under the hero will not take what is being
                *  carried, or null. The same call the ring and the card use.
                *
                *  Returns `'nothing in hand'` rather than null when you are not
                *  carrying anything: null has to mean "this cell is fine", and a
                *  probe reading it while empty-handed would map the whole
                *  village as free. */
               blockedHere: () => (carrying
                 ? blockedAt(cell(hero.position.x), cell(hero.position.z), carrying.id)
                 : 'nothing in hand'),
               /** Whether a given cell would take a given building — asked
                *  without having to walk there and without holding anything. */
               blockedAt: (x: number, z: number, id: string) => blockedAt(cell(x), cell(z), id),
               /** Which boards are open, and where their doors are — a probe
                *  should walk to one rather than be told a coordinate. */
               levels: () => LEVELS.map((lv, i) => ({
                 id: lv.id, name: lv.name, open: levelOpen(i),
                 x: DOOR_AT.x, z: DOOR_AT.z,
               })),
               /** Open the list and pick a board, the way a tap does. A probe
                *  that resolved the hub directly would not be testing the one
                *  screen between the hub and a run. */
               pick: (i: number) => {
                 const btn = panel.querySelector<HTMLButtonElement>(`button[data-level="${i}"]`);
                 btn?.click();
               },
               listOpen: () => panelOpen && !!panel.querySelector('button[data-level]') },
    });
  });
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}
