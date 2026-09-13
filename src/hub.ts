import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import {
  loadScene3D, loadModelAsset, attachToSocket,
  CharacterController3D, CharacterAnimator, Input3D,
  type Scene3D, type Manifest3D,
} from '@umicat/three-sdk';
import type { Shared, Weapon, Progress } from './main';
import { patchSave } from './main';
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
const DOOR_AT = { x: 0, z: -5.1 };
const DOOR_HALF_WIDTH = 0.62;
const SIGN_AT = { x: -2.5, z: 2.5 };
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

export async function runHub(shared: Shared): Promise<Weapon> {
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
    position: { x: 0, y: 0.5, z: 3.0 },
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

  // --- HUD ---
  hudEl.textContent = '';
  const title = document.createElement('div');
  title.style.cssText = 'font: 700 15px/1.5 system-ui, sans-serif;';
  title.textContent = umicat.user ? `Welcome, ${umicat.user.name}` : 'Playing as a guest';
  const hint = document.createElement('div');
  hint.style.cssText = 'font: 600 14px/1.5 system-ui, sans-serif; opacity: .85;';
  hudEl.append(title, hint);

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
  return await new Promise<Weapon>((resolve) => {
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

      hint.textContent = panelOpen ? ''
        : atPickup ? (atPickup.id === weapon ? `${atPickup.label} (equipped)` : `⚔ to take · ${atPickup.label}`)
        : atSign ? '⚔ to read the leaderboard'
        : `walk through the open door to play · carrying ${weapon}`;

      if (!panelOpen && input.consume('use')) {
        if (atPickup) {
          weapon = atPickup.id;
          showWeapon();
          audio.play('build');
          void patchSave(shared.umicat, { weapon });
        } else if (atSign) {
          audio.play('build');
          void openPanel();
        }
      }

      const inDoorway = hero.position.z < DOOR_AT.z
        && Math.abs(hero.position.x - DOOR_AT.x) < DOOR_HALF_WIDTH;
      if (!done && inDoorway) {
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
        resolve(weapon);
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
               runs,
               atDoor: () => hero.position.z < DOOR_AT.z
                 && Math.abs(hero.position.x - DOOR_AT.x) < DOOR_HALF_WIDTH },
    });
  });
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}
