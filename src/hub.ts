import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import {
  loadScene3D, loadModelAsset, attachToSocket,
  CharacterController3D, CharacterAnimator, Input3D,
  type Scene3D, type Manifest3D,
} from '@umicat/three-sdk';
import type { Shared, Progress } from './main';
import { patchSave, readSave } from './main';
import { DEV, toggleDev } from './dev';
import { skyWithClouds } from './sky';
import { ICON } from './icons';
import { LEVELS } from './levels';
import { mergeStatic } from './merge';
import { createDebugHud } from './debughud';
import { TOWN, TOWN_MAX_LEVEL, bonusesFrom, canAfford, shortfall, townNow, townAfter, type TownBonus } from './town';
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
 * Small, walled, and quiet: a door at the far end, a sign that shows the
 * leaderboard, the game's name in blocks, and some scenery. Walking into the
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
const DOOR_HALF_WIDTH = 0.7;
const SIGN_AT = { x: 0, z: 3.6 };
const NEAR = 0.9;             // how close counts as "standing at" something
const LEADERBOARD_KEY = 'leaderboard';
const LEADERBOARD_MAX = 10;

export interface LeaderboardEntry { name: string; wave: number; at: number; }

/** Read the shared board. Public data — an anonymous player sees it too. */
export async function readLeaderboard(umicat: Shared['umicat']): Promise<LeaderboardEntry[]> {
  const raw = await umicat.gameData.get<LeaderboardEntry[]>(LEADERBOARD_KEY);
  return Array.isArray(raw) ? raw : [];
}

/**
 * Add a result, keeping the top ten.
 *
 * `gameData` stores one opaque value per key and enforces nothing INSIDE it,
 * so the read-modify-write loop is ours: merge, sort, truncate, and write with
 * `ifVersion` so a concurrent finish cannot be silently lost. Writing needs a
 * signed-in player; a guest run simply is not recorded.
 */
export async function submitScore(umicat: Shared['umicat'], wave: number): Promise<void> {
  const name = umicat.user?.name;
  if (!name) return;
  for (let attempt = 0; attempt < 3; attempt++) {
    const current = await umicat.gameData.get<LeaderboardEntry[]>(LEADERBOARD_KEY);
    const list = Array.isArray(current) ? [...current] : [];
    const mine = list.find((e) => e.name === name);
    if (mine) {
      if (mine.wave >= wave) return;         // already better; nothing to write
      mine.wave = wave; mine.at = Date.now();
    } else {
      list.push({ name, wave, at: Date.now() });
    }
    list.sort((a, b) => b.wave - a.wave || a.at - b.at);
    try {
      await umicat.gameData.set(LEADERBOARD_KEY, list.slice(0, LEADERBOARD_MAX));
      return;
    } catch {
      // Someone else finished a run in the same moment. Re-read and redo —
      // last-write-wins would quietly drop their score.
    }
  }
}

/** Where each weapon sits, and what it looks like. The bow and the staff have
 *  no models anywhere in the asset library, so both are built — see
 *  `makeBow`/`makeStaff` in the level, which this mirrors deliberately: the
 *  thing on the pedestal has to be the thing you end up holding. */
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
  const marker = world.entities.get('sign_marker')!;
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

  const showTown = (): void => {
    for (const b of TOWN) {
      const lv = town[b.id] ?? 0;
      for (let i = 1; i <= TOWN_MAX_LEVEL; i++) {
        const o = world.entities.get(`town_${b.id}_${i}`);
        if (o && !o.userData.fitted) { fitToPlot(o, 1.7); o.userData.fitted = true; }
        if (o) o.visible = i === lv;
        const body = world.bodies.get(`town_${b.id}_${i}`);
        // A collider on a hidden building is a wall in the middle of a field.
        if (body) body.setEnabled(i === lv);
      }
    }
  };
  showTown();

  // --- HUD ---
  hudEl.textContent = '';
  const title = document.createElement('div');
  title.style.cssText = 'font: 700 15px/1.5 system-ui, sans-serif;';
  title.textContent = umicat.user ? `Welcome, ${umicat.user.name}` : 'Playing as a guest';
  // A greeting, not a readout. It goes away.
  title.style.transition = 'opacity .8s';
  setTimeout(() => { title.style.opacity = '0'; }, 5000);
  const purse = document.createElement('div');
  purse.style.cssText = 'font: 700 15px/1.5 system-ui, sans-serif;';
  const renderPurse = (): void => {
    purse.textContent = [
      `Lv ${level}`,
      store.gold > 0 && `🪙 ${store.gold}`,
      store.wood > 0 && `🪵 ${store.wood}`,
      store.stone > 0 && `🪨 ${store.stone}`,
    ].filter(Boolean).join('   ');
  };
  renderPurse();
  hudEl.append(title, purse); // the prompt is a card over the building now, not a line up here

  // There is no "NEW ·" banner any more. It announced the weapon the finished
  // level had handed over, and nothing is handed over now — what is waiting on
  // the rack is what you decide to pay for.

  // The leaderboard panel. Above the controls layer, for the reason every
  // other panel in this game is: they are a full-screen layer at z-index 10.
  const panel = document.createElement('div');
  panel.style.cssText = `
    position: fixed; left: 50%; top: 50%; transform: translate(-50%, -50%);
    z-index: 40; display: none; min-width: 260px; max-width: 82vw;
    background: rgba(18,22,28,.92); color: #fff; border-radius: 16px; padding: 18px 22px;
    font: 600 14px/1.7 system-ui, sans-serif; pointer-events: auto;
  `;
  document.body.appendChild(panel);
  let panelOpen = false;

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
  const showCard = (title: string, lines: string[], action?: string): void => {
    card.innerHTML = '';
    const t = document.createElement('div');
    t.style.cssText = 'font: 700 15px/1.4 system-ui, sans-serif; margin-bottom: 2px;';
    t.textContent = title;
    card.append(t);
    for (const line of lines) {
      if (!line) continue;
      const d = document.createElement('div');
      d.style.cssText = 'opacity: .82;';
      d.textContent = line;
      card.append(d);
    }
    if (action) {
      const a = document.createElement('div');
      a.style.cssText = 'margin-top: 7px; font: 700 13px/1.4 system-ui, sans-serif; color: #ffd76a;';
      a.textContent = action;
      card.append(a);
    }
    card.style.display = 'block';
  };

  const closePanel = (): void => {
    panelOpen = false;
    panel.style.display = 'none';
    input.setEnabled(true);
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
    panel.style.display = 'block';
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
    panel.innerHTML =
      '<div style="font:700 17px/1.8 system-ui">Where to?</div>' + rows + more
      + `<button data-back="1" style="margin-top:10px;padding:8px 18px;border:0;border-radius:999px;
          font:700 14px system-ui;background:rgba(255,255,255,.18);color:#fff;cursor:pointer">Back</button>`;
    for (const el of panel.querySelectorAll<HTMLButtonElement>('button')) {
      el.onclick = () => {
        if (el.dataset.back) { closePanel(); return; }
        const i = Number(el.dataset.level);
        if (!levelOpen(i)) return;
        closePanel();
        onPick(i);
      };
    }
  };

  const openPanel = async (): Promise<void> => {
    panelOpen = true;
    input.setEnabled(false);
    panel.style.display = 'block';
    panel.innerHTML = '<div style="font:700 17px/1.6 system-ui">Leaderboard</div><div>Loading…</div>';
    let rows: LeaderboardEntry[] = [];
    try { rows = await readLeaderboard(umicat); } catch { /* offline is not a crash */ }
    const body = rows.length
      ? rows.map((e, i) => `<div style="display:flex;gap:12px;justify-content:space-between">
           <span style="opacity:.6;width:1.4em">${i + 1}</span>
           <span style="flex:1;overflow:hidden;text-overflow:ellipsis">${escapeHtml(e.name)}</span>
           <span>wave ${e.wave}</span></div>`).join('')
      : '<div style="opacity:.7">Nobody has finished a run yet.</div>';
    panel.innerHTML =
      `<div style="font:700 17px/1.6 system-ui">Leaderboard</div>${body}` +
      `<button style="margin-top:14px;padding:8px 18px;border:0;border-radius:999px;
        font:700 14px system-ui;background:#fff;color:#222;cursor:pointer">Close</button>`;
    panel.querySelector('button')!.onclick = closePanel;
  };

  // Built, placed and about to render: the next frame is a real one.
  hideLoading();

  // The same readout the levels have. The hub is eleven hundred objects of
  // forest now and it was the one place with no way to see what that cost.
  const debug = createDebugHud(renderer, hudEl,
    DEV ? '\u2605 DEV \u2014 all unlocked, nothing saved' : undefined, toggleDev);

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

      // The sign: the same ring the level uses for a build spot, because it
      // means the same thing — stand here and the action button does something.
      const atSign = Math.hypot(hero.position.x - SIGN_AT.x, hero.position.z - SIGN_AT.z) < NEAR;
      // Close to a doorway, not through it: the prompt is what tells a new
      // player the door is a door before they walk into it, and which board is
      // behind it.
      // Which plot you are standing at, if any.
      let atPlot: typeof TOWN[number] | null = null;
      for (const b of TOWN) {
        const near = Math.hypot(hero.position.x - b.x, hero.position.z - b.z) < 1.9;
        const ring = world.entities.get(`plot_${b.id}_marker`);
        if (ring) ring.visible = near && !panelOpen;
        if (near) atPlot = b;
      }

      const nearDoor = hero.position.z < DOOR_AT.z + 1.7
        && Math.abs(hero.position.x - DOOR_AT.x) < 1.6;
      marker.visible = atSign && !panelOpen;

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
      const priceOf = (c: Materials): string =>
        [c.gold && `🪙 ${c.gold}`, c.wood && `🪵 ${c.wood}`, c.stone && `🪨 ${c.stone}`]
          .filter(Boolean).join('  ');
      // What the card says about a plot: where it is now, what the next level
      // changes, and what that costs — or, when it cannot be paid for, what is
      // MISSING, which is a thing you can go and do something about.
      const plotCard = (b: typeof TOWN[number]): void => {
        const lv = town[b.id] ?? 0;
        const now = townNow(b.id, town);
        if (lv >= TOWN_MAX_LEVEL) {
          showCard(`${b.icon} ${b.name} · Lv${lv}`, [now, 'Fully built']);
          return;
        }
        const cost = b.costs[lv];
        const next = townAfter(b.id, town, lv + 1);
        const lines = [
          lv ? `Now: ${now}` : b.effect,
          `Lv${lv + 1}: ${next}`,
          `Cost: ${priceOf(cost)}`,
        ];
        showCard(`${b.icon} ${b.name}${lv ? ` · Lv${lv}` : ''}`, lines,
          canAfford(store, cost) ? `⚔ build Lv${lv + 1}` : `needs ${shortfall(store, cost)}`);
      };

      /** A weapon, at whatever stage it is in. The lines change with the stage
       *  because what you want to know changes with it: an empty pedestal is a
       *  price, a made weapon is a number you are about to take into a fight. */
      const rackCard = (id: Weapon): void => {
        const k = WEAPON_BY_ID.get(id)!;
        const lvl = levelOf(weapons, id);
        const cap = Math.min(WEAPON_MAX_LEVEL, weaponCap());
        const lines: string[] = [k.blurb];
        if (lvl > 0) {
          lines.push(`Now: ${weaponDamage(id, lvl)} damage${effectText(id, lvl) ? ` · ${effectText(id, lvl)}` : ''}`);
        }
        const cost = nextCost(id, lvl);
        const canStep = lvl < cap && cost;
        if (canStep) {
          const step = lvl + 1;
          lines.push(`Lv${step}: ${weaponDamage(id, step)} damage${effectText(id, step) ? ` · ${effectText(id, step)}` : ''}`);
          lines.push(`Cost: ${priceOf(cost)}`);
        } else if (lvl === 0) {
          // The one dead end worth explaining: the weapon exists, the money may
          // even be there, and the reason nothing happens is a building.
          lines.push(weaponCap() === 0 ? 'The Armory has not been built' : `Needs Armory Lv${lvl + 1}`);
        } else if (lvl >= WEAPON_MAX_LEVEL) {
          lines.push('Fully forged');
        } else {
          lines.push(`Improving needs Armory Lv${lvl + 1}`);
        }

        const act = rackAction(id);
        let action: string | undefined;
        if (act === 'take') action = '⚔ take';
        else if (act === 'forge' || act === 'improve') {
          if (!canStep) action = undefined;
          else action = canAfford(store, cost!)
            ? (act === 'forge' ? '⚔ forge' : `⚔ improve to Lv${lvl + 1}`)
            : `needs ${shortfall(store, cost!)}`;
        } else if (id === weapon) action = 'equipped';
        showCard(`${k.icon} ${k.name}${lvl ? ` · Lv${lvl}` : ''}`, lines, action);
      };

      if (panelOpen) {
        card.style.display = 'none';
      } else if (atPlot) {
        plotCard(atPlot);
        placeCard(atPlot.x, PLOT_CARD_Y, atPlot.z);
      } else if (atPickup) {
        rackCard(atPickup.id);
        placeCard(atPickup.x, 1.1, atPickup.z);
      } else if (atSign) {
        showCard('🏆 Leaderboard', ['Best runs, by board'], '⚔ read');
        placeCard(SIGN_AT.x, 1.6, SIGN_AT.z);
      } else if (nearDoor) {
        showCard('▶ The road out', ['Choose which board to take'], 'walk through');
        placeCard(DOOR_AT.x, 2.0, DOOR_AT.z);
      } else {
        card.style.display = 'none';
      }

      if (!panelOpen && input.consume('use')) {
        if (atPlot) {
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
        } else if (atSign) {
          audio.play('build');
          void openPanel();
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
      __hub: { world, character, input, hero, openPanel, weapon: () => weapon,
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
               /** Where the leaderboard sign is. A probe should ask rather than
                *  carry a coordinate that moves when the hub is re-laid. */
               signAt: () => ({ ...SIGN_AT }),
               coin: () => store.gold,
               store: () => ({ ...store }),
               level: () => level,
               town: () => ({ ...town }),
               plots: () => TOWN.map((b) => ({ id: b.id, x: b.x, z: b.z, level: town[b.id] ?? 0 })),
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
