import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import {
  loadScene3D, loadModelAsset, attachToSocket,
  CharacterController3D, CharacterAnimator, Input3D,
  type Scene3D, type Manifest3D,
} from '@umicat/three-sdk';
import type { Shared, Weapon, Progress } from './main';
import { patchSave } from './main';
import { LEVELS } from './levels';
import { TOWN, TOWN_MAX_LEVEL, bonusesFrom, type TownBonus } from './town';
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
/** The doorways, in the order `LEVELS` lists them — the same spacing the scene
 *  generator used. A door you can see from the spawn point IS the level select:
 *  no menu, no list, walk at the one you want. */
const DOOR_Z = -5.1;
const DOOR_HALF_WIDTH = 0.62;
/** Spread across the front wall — the same rule `gen-scene.mjs` lays them by.
 *  At a fixed 3.4 apart, a fourth board put the outer doors through the
 *  corners. */
const DOOR_SPACING = Math.min(3.4, 9.0 / LEVELS.length);
const doorX = (i: number): number => (i - (LEVELS.length - 1) / 2) * DOOR_SPACING;
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
/** The weapons on the ground, and how many finished levels each one takes.
 *
 *  You start with the sword and nothing else. A hub with all three laid out on
 *  the first visit asks a new player to choose between three things they have
 *  never used; one weapon at a time makes each arrival back from a level the
 *  moment something new is waiting. */
const PICKUPS: { id: Weapon; x: number; z: number; label: string; runs: number }[] = [
  { id: 'sword', x: -1.4, z: 0.2, label: '🗡 Sword — hits everything close', runs: 0 },
  { id: 'bow', x: 0, z: 0.2, label: '🏹 Bow — locks on at range', runs: 1 },
  { id: 'staff', x: 1.4, z: 0.2, label: '🔮 Staff — bursts a whole group', runs: 2 },
];

/** What the player chose on the way out of the hub. */
export interface HubChoice { weapon: Weapon; level: number; bonus: TownBonus; }

export async function runHub(shared: Shared): Promise<HubChoice> {
  const { umicat, renderer, canvas, hudEl, audio } = shared;

  const [manifest, scene3d] = await Promise.all([
    fetch('scenes3d/manifest.json').then((r) => r.json() as Promise<Manifest3D>),
    fetch('scenes3d/hub.json').then((r) => r.json() as Promise<Scene3D>),
  ]);
  const world = await loadScene3D(scene3d, manifest, { assetBase: '', rapier: RAPIER });

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
  const input = new Input3D({ actions: [{ id: 'use', label: '⚔', keys: ['KeyJ'] }] });

  const heroMixer = world.mixerFor.get('hero');
  if (!heroMixer) throw new Error('the hub hero has no animation mixer');
  const clipMap: Record<string, string> =
    (manifest.models?.find((m) => m.id === 'hero') as { animations?: Record<string, string> } | undefined)?.animations ?? {};
  const animator = new CharacterAnimator(heroMixer, world.clips.get('hero') ?? [], clipMap);

  const heroAsset = manifest.models?.find((m) => m.id === 'hero');
  const handRight = heroAsset?.sockets?.['hand-right'];

  const held: Partial<Record<Weapon, THREE.Object3D>> = {};
  const progress = (await shared.umicat.saves.get<Progress>('td-progress')) ?? {};
  const runs = progress.runs ?? 0;
  /** What is on the ground this visit. */
  const available = PICKUPS.filter((p) => p.runs <= runs);
  /** Anything unlocked by the level just finished — worth saying out loud. */
  const justUnlocked = PICKUPS.find((p) => p.runs === runs && p.runs > 0) ?? null;
  /** How many boards have been WON. Weapons come from finishing a level either
   *  way, because being handed a bow for losing is kind; a new board comes from
   *  clearing the one before it, because otherwise the order means nothing. */
  const cleared = progress.cleared ?? 0;
  const levelOpen = (i: number): boolean => i <= cleared;
  /** Coin carried home from runs, and what it has been spent on. */
  let coin = progress.coin ?? 0;
  const town: Record<string, number> = { ...(progress.town ?? {}) };
  const saved = progress.weapon;
  // Never hand back a weapon that is no longer on the ground — a save from a
  // future version, or a cleared progress, should not leave you carrying
  // something the hub cannot show you putting down.
  let weapon: Weapon = available.some((p) => p.id === saved) ? saved! : 'sword';

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
  const makeStaff = (): THREE.Object3D => {
    const g = new THREE.Object3D();
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.02, 0.42, 6),
      new THREE.MeshStandardMaterial({ color: 0x6d4a2f, roughness: 0.9 }));
    const gem = new THREE.Mesh(new THREE.OctahedronGeometry(0.055),
      new THREE.MeshStandardMaterial({ color: 0x9b6cff, emissive: 0x6a3fd6,
        emissiveIntensity: 0.9, roughness: 0.3 }));
    gem.position.y = 0.24;
    g.add(shaft, gem);
    return g;
  };

  if (handRight) {
    const loaded = await loadModelAsset(manifest, 'sword', { assetBase: '' });
    held.sword = loaded.object;
    held.bow = makeBow();
    held.staff = makeStaff();
    for (const w of ['sword', 'bow', 'staff'] as const) {
      held[w]!.traverse((o) => { if ((o as THREE.Mesh).isMesh) (o as THREE.Mesh).castShadow = true; });
      attachToSocket(hero, handRight, held[w]!);
    }
  }
  const showWeapon = (): void => {
    for (const w of ['sword', 'bow', 'staff'] as const) {
      if (held[w]) held[w]!.visible = w === weapon;
    }
  };
  showWeapon();

  // The same three things again, standing on the pedestals. Built twice rather
  // than cloned from the held ones: cloning would make the display copy share
  // a transform with something parented to a bone, which is a bug waiting for
  // the first time anyone rotates one.
  // Only the ones that have been earned. The empty pedestals stay: a bare
  // plinth beside the sword says something goes there, which is the point of
  // unlocking them one at a time. The ring under an empty one never lights.
  for (const pick of PICKUPS) {
    const ring = world.entities.get(`pickup_marker_${pick.id}`);
    if (!available.includes(pick)) { if (ring) ring.visible = false; continue; }
    const display = pick.id === 'sword'
      ? (await loadModelAsset(manifest, 'sword', { assetBase: '' })).object
      : pick.id === 'bow' ? makeBow() : makeStaff();
    display.position.set(pick.x, 0.42, pick.z);
    display.rotation.z = Math.PI * 0.12;
    display.traverse((o) => { if ((o as THREE.Mesh).isMesh) (o as THREE.Mesh).castShadow = true; });
    display.userData.spin = true;
    world.scene.add(display);
  }

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
  const hint = document.createElement('div');
  hint.style.cssText = 'font: 600 14px/1.5 system-ui, sans-serif; opacity: .85;';
  const purse = document.createElement('div');
  purse.style.cssText = 'font: 700 15px/1.5 system-ui, sans-serif;';
  const renderPurse = (): void => { purse.textContent = coin > 0 ? `🪙 ${coin}` : ''; };
  renderPurse();
  hudEl.append(title, purse, hint);

  // Something new on the ground is the reward for the level just finished, and
  // it is easy to miss: it appears while the screen is still fading in, two
  // metres from where you were already standing. So it says so.
  if (justUnlocked) {
    const news = document.createElement('div');
    news.style.cssText = 'font: 700 16px/1.6 system-ui, sans-serif; color: #ffd45e;'
      + 'text-shadow: 0 1px 2px rgba(0,0,0,.55); transition: opacity .6s;';
    news.textContent = `NEW · ${justUnlocked.label}`;
    hudEl.append(news);
    audio.play('coin');
    setTimeout(() => { news.style.opacity = '0'; }, 7000);
    setTimeout(() => news.remove(), 7800);
  }

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

  const closePanel = (): void => {
    panelOpen = false;
    panel.style.display = 'none';
    input.setEnabled(true);
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

      let nearDoor = -1;
      for (let i = 0; i < LEVELS.length; i++) {
        if (hero.position.z < DOOR_Z + 1.7
            && Math.abs(hero.position.x - doorX(i)) < DOOR_SPACING / 2) {
          nearDoor = i;
          break;
        }
      }
      marker.visible = atSign && !panelOpen;

      // Which weapon you are standing at, if any.
      let atPickup: typeof PICKUPS[number] | null = null;
      for (const pick of available) {
        const near = Math.hypot(hero.position.x - pick.x, hero.position.z - pick.z) < NEAR;
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
      const plotLine = (b: typeof TOWN[number]): string => {
        const lv = town[b.id] ?? 0;
        if (lv >= TOWN_MAX_LEVEL) return `${b.icon} ${b.name} Lv${lv} · ${b.effect}`;
        const cost = b.costs[lv];
        return coin >= cost
          ? `${b.icon} ⚔ build ${b.name} Lv${lv + 1} · ${cost} 🪙 · ${b.effect}`
          : `${b.icon} ${b.name} Lv${lv + 1} needs ${cost} 🪙 · ${b.effect}`;
      };
      hint.textContent = panelOpen ? ''
        : atPlot ? plotLine(atPlot)
        : atPickup ? (atPickup.id === weapon ? `${atPickup.label} · equipped` : `⚔ take · ${atPickup.label}`)
        : atSign ? '⚔ leaderboard'
        : nearDoor >= 0
          ? (levelOpen(nearDoor)
              ? `▶ ${LEVELS[nearDoor].name} · ${LEVELS[nearDoor].blurb}`
              : `🔒 clear ${LEVELS[nearDoor - 1].name} first`)
          : '';

      if (!panelOpen && input.consume('use')) {
        if (atPlot) {
          const lv = town[atPlot.id] ?? 0;
          if (lv >= TOWN_MAX_LEVEL) { audio.play('denied'); }
          else if (coin < atPlot.costs[lv]) { audio.play('denied'); }
          else {
            coin -= atPlot.costs[lv];
            town[atPlot.id] = lv + 1;
            showTown();
            renderPurse();
            audio.play(SFX.upgradeTower);
            void patchSave(shared.umicat, { coin, town });
          }
        } else if (atPickup) {
          weapon = atPickup.id;
          showWeapon();
          audio.play('build');
          void patchSave(shared.umicat, { weapon });
        } else if (atSign) {
          audio.play('build');
          void openPanel();
        }
      }

      let through = -1;
      for (let i = 0; i < LEVELS.length; i++) {
        if (!levelOpen(i)) continue;
        if (hero.position.z < DOOR_Z && Math.abs(hero.position.x - doorX(i)) < DOOR_HALF_WIDTH) {
          through = i;
          break;
        }
      }
      if (!done && through >= 0) {
        done = true;
        audio.play(SFX.door);
        // Tear the hub down before handing the renderer over: its scene, its
        // physics and its listeners would otherwise keep running behind the
        // level, invisibly, for the rest of the session.
        renderer.setAnimationLoop(null);
        window.removeEventListener('resize', resize);
        input.dispose();
        panel.remove();
        hudEl.textContent = '';
        world.dispose();
        // `dispose()` frees the GPU resources; it does not empty the graph.
        // Clearing it as well is what makes "the hub is gone" true rather than
        // merely invisible — and it is the difference a probe can see.
        world.scene.clear();
        delete (window as unknown as Record<string, unknown>).__hub;
        resolve({ weapon, level: through, bonus: bonusesFrom(town) });
        return;
      }

      world.update(dt);
      renderer.render(world.scene, world.camera);
    });

    Object.assign(window as unknown as Record<string, unknown>, {
      __hub: { world, character, input, hero, openPanel, weapon: () => weapon,
               /** Which weapons are on the ground this visit — the question the
                *  unlock is really about. Reading the scene for models would
                *  answer "is something drawn there", which is not the same. */
               available: () => available.map((p) => p.id),
               runs, cleared,
               THREE,
               /** Where the leaderboard sign is. A probe should ask rather than
                *  carry a coordinate that moves when the hub is re-laid. */
               signAt: () => ({ ...SIGN_AT }),
               coin: () => coin,
               town: () => ({ ...town }),
               plots: () => TOWN.map((b) => ({ id: b.id, x: b.x, z: b.z, level: town[b.id] ?? 0 })),
               /** Which boards are open, and where their doors are — a probe
                *  should walk to one rather than be told a coordinate. */
               levels: () => LEVELS.map((lv, i) => ({
                 id: lv.id, name: lv.name, open: levelOpen(i), x: doorX(i), z: DOOR_Z,
               })) },
    });
  });
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}
