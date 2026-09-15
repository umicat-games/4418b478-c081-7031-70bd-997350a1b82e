import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { loadScene3D, type Manifest3D, type Scene3D } from '@umicat/three-sdk';
import type { Shared } from './main';
import type { Progress } from './main';
import { mergeStatic } from './merge';
import { skyWithClouds } from './sky';
import { hideLoading } from './loading';

/**
 * The title screen: Continue, or start again.
 *
 * ONE save, written as you play. That is the shape for a game that autosaves —
 * slots exist so that a player who saves by hand can keep more than one run,
 * and a game that never asks them to save has nothing to put in a second slot.
 *
 * So the whole screen is two questions: is there something to come back to, and
 * do you want to keep it.
 *
 * Plain DOM, like the loading screen, and for the same reason: it has to be up
 * before there is a scene, and it must not care whether one exists. It is also
 * where the first TAP of the session happens, which is what unlocks audio on
 * iOS — a title screen is the one moment in a game where a press is guaranteed.
 */

/** Where the title stays if the clearing never loads. Dark, like the wash over
 *  the clearing, so the fallback is a dimmer version of the same screen rather
 *  than a different one with differently-coloured words on it. */
const BACKDROP = 'linear-gradient(#26414f 0%, #233a44 48%, #1d3327 48%, #182a1e 100%)';
/** Over the clearing. A wash rather than a colour instead of it: the words have
 *  to stay legible against trees, and trees are busy. */
const WASH = 'linear-gradient(rgba(12,22,30,.10) 0%, rgba(12,22,30,.34) 52%, rgba(12,22,30,.62) 100%)';

/** What the save has to contain before Continue means anything.
 *
 *  Not "does the key exist": every session writes something, and a save holding
 *  nothing but defaults would light up Continue and drop the player into a
 *  village they have never seen, having been told they were resuming. */
function hasProgress(p: Progress | null): boolean {
  if (!p) return false;
  return (p.runs ?? 0) > 0
    || (p.cleared ?? 0) > 0
    || Object.keys(p.town ?? {}).length > 0
    || (p.level ?? 1) > 1
    || (p.store?.gold ?? 0) > 0;
}

/**
 * Put the title up and wait for a choice.
 *
 * Resolves once the player has picked. If they chose to start again the save
 * has already been wiped by then, so the caller does not have to know which
 * happened — it just reads progress as it always does.
 */
export async function showTitle(shared: Shared): Promise<void> {
  const saves = shared.umicat.saves;
  const save = (await saves.get<Progress>('td-progress')) ?? null;
  const resume = hasProgress(save);
  // Behind the loading screen, which is already up and stays up. The title
  // appears COMPLETE — there is no moment where it is a flat panel waiting for
  // its background, because the background is what it was waiting for.
  const scene = await titleScene(shared);

  const el = document.createElement('div');
  el.dataset.title = '';
  el.style.cssText = `
    position: fixed; inset: 0; z-index: 95; display: flex;
    align-items: center; justify-content: center; flex-direction: column;
    gap: 18px; padding: 24px; box-sizing: border-box;
    color: #fff; font: 600 15px/1.5 system-ui, sans-serif; text-align: center;
    background: ${scene ? WASH : BACKDROP};
  `;

  // What a button DOES is passed in, not derived from how it looks. Deriving it
  // from `primary` tagged "Start" on a fresh save as a Continue, because it is
  // the primary button when there is nothing to continue.
  const btn = (act: string, label: string, primary: boolean, note?: string): string => `
    <button data-act="${act}" style="
      display:block; width:min(280px, 74vw); margin:0 auto; padding:14px 22px;
      border:0; border-radius:999px; cursor:pointer; font:800 16px/1.2 system-ui;
      background:${primary ? '#ffd76a' : 'rgba(255,255,255,.18)'};
      color:${primary ? '#241b00' : '#fff'};
      backdrop-filter:${primary ? 'none' : 'blur(2px)'};">
      ${label}${note ? `<div style="font:600 12px/1.6 system-ui;opacity:.72">${note}</div>` : ''}
    </button>`;

  el.innerHTML = `
    <div style="font:800 min(13vw, 54px)/1 system-ui; letter-spacing:.2em;
                color:#ffd76a; text-shadow:0 3px 0 #b8892b, 0 6px 14px rgba(0,0,0,.28)">BALABOO</div>
    <div style="opacity:.92; letter-spacing:.06em; margin-top:-4px;
                text-shadow:0 1px 6px rgba(0,0,0,.55)">Defend the village</div>
    <div style="display:flex; flex-direction:column; gap:10px; margin-top:10px">
      ${resume ? btn('go', 'Continue', true) : ''}
      ${btn('new', resume ? 'New game' : 'Start', !resume)}
    </div>
    <div data-confirm style="
      position:fixed; inset:0; display:none; align-items:center; justify-content:center;
      background:rgba(12,18,24,.62); padding:24px; box-sizing:border-box">
      <div style="background:#fff; color:#23313c; border-radius:18px; padding:22px 24px;
                  width:min(360px, 86vw); box-shadow:0 12px 40px rgba(0,0,0,.3)">
        <div style="font:800 17px/1.4 system-ui">Start again?</div>
        <div style="margin-top:8px; opacity:.8">
          This erases the village you have now. There is only one save.</div>
        <div style="display:flex; gap:10px; margin-top:18px">
          <button data-act="cancel" style="flex:1; padding:12px; border:0; border-radius:999px;
            cursor:pointer; font:800 15px system-ui; background:rgba(35,49,60,.12); color:#23313c">
            Keep it</button>
          <button data-act="wipe" style="flex:1; padding:12px; border:0; border-radius:999px;
            cursor:pointer; font:800 15px system-ui; background:#d0453a; color:#fff">
            Erase</button>
        </div>
      </div>
    </div>
  `;
  document.body.appendChild(el);
  // UNDER the loading screen — z 95 against its 100 — so hiding it DISSOLVES
  // into a finished title instead of cutting to one. And only from here: hiding
  // it in `boot()` and then awaiting the scene left a black canvas with nothing
  // over it for as long as the load took.
  hideLoading();

  await new Promise<void>((resolve) => {
    const confirm = el.querySelector<HTMLElement>('[data-confirm]')!;
    const done = async (wipe: boolean): Promise<void> => {
      // Straight through `saves`, not `patchSave`: patching merges over what is
      // there, and the one thing this must do is leave nothing behind.
      if (wipe) await saves.set('td-progress', {});
      el.remove();
      scene?.dispose();
      resolve();
    };
    el.onclick = (e) => {
      const act = (e.target as HTMLElement).closest<HTMLElement>('[data-act]')?.dataset.act;
      if (!act) return;
      // Starting again is the one irreversible thing on this screen, and there
      // is only one save for it to destroy. It asks — but only when there is
      // something to lose, because a confirmation over an empty save is a
      // question about nothing.
      // Toggled through `style.display`, not the `hidden` attribute: `hidden`
      // is a user-agent `display: none` rule, and the inline `display: flex`
      // this element carries outranks it. It sat open over the whole title.
      if (act === 'new' && resume) { confirm.style.display = 'flex'; return; }
      if (act === 'cancel') { confirm.style.display = 'none'; return; }
      void done(act === 'new' || act === 'wipe');
    };
  });
}

/**
 * The clearing behind the words.
 *
 * Its own scene, not the hub from an angle: the hub is a village with the
 * player's buildings in it, wherever they put them, at whatever size they
 * bought — and showing that before asking "Continue?" is showing the answer
 * before the question. The models are the ones the hub uses, so loading the
 * hub afterwards is the browser's cache rather than the network.
 *
 * Returns null rather than throwing if anything about it fails. A title screen
 * that cannot start because its BACKGROUND did not load is a game that cannot
 * start; the flat gradient is a fine second best.
 */
async function titleScene(
  shared: Shared,
): Promise<{ dispose: () => void } | null> {
  try {
    const [manifest, scene3d] = await Promise.all([
      fetch('scenes3d/manifest.json').then((r) => r.json() as Promise<Manifest3D>),
      fetch('scenes3d/title.json').then((r) => r.json() as Promise<Scene3D>),
    ]);
    const world = await loadScene3D(scene3d, manifest, { assetBase: '', rapier: RAPIER });
    mergeStatic(world, scene3d, manifest);
    world.scene.background = skyWithClouds({ horizon: '#9fd4ef' });

    const { renderer } = shared;
    renderer.shadowMap.enabled = false;
    const dpr = window.devicePixelRatio ?? 1;
    renderer.setPixelRatio(Math.min(dpr, 2));
    const resize = (): void => {
      renderer.setSize(window.innerWidth, window.innerHeight, false);
      world.camera.aspect = window.innerWidth / window.innerHeight;
      world.camera.updateProjectionMatrix();
    };
    resize();
    window.addEventListener('resize', resize);

    // A slow drift around the clearing. Not a spin: a title that moves fast
    // enough to notice is a title you wait for rather than read.
    const look = new THREE.Vector3(0, 0.2, 0);
    const t0 = performance.now();
    let frames = 0;
    let meshes = 0;
    world.scene.traverse((o) => { if ((o as THREE.Mesh).isMesh) meshes += 1; });
    // What the clearing IS, for probes. Reading the canvas back cannot answer
    // this: WebGL clears the drawing buffer once the frame is presented, so
    // `readPixels` from outside the loop returns transparent black on a scene
    // that is plainly on screen in a screenshot.
    (window as unknown as Record<string, unknown>).__title =
      () => ({ meshes, frames, camera: world.camera.position.toArray().map((n) => +n.toFixed(2)) });
    renderer.setAnimationLoop(() => {
      frames += 1;
      const t = (performance.now() - t0) / 1000;
      const a = 0.5 + t * 0.028;
      // Higher, and looking further down: at eye level the treeline sat across
      // the middle of the frame and the title had to be read against it. From
      // up here the horizon drops, the words are over sky and the clearing is
      // the thing you see rather than a strip of grass under the buttons.
      world.camera.position.set(Math.sin(a) * 7.0, 3.9 + Math.sin(t * 0.21) * 0.3, Math.cos(a) * 7.0);
      world.camera.lookAt(look);
      renderer.render(world.scene, world.camera);
    });

    return {
      dispose: () => {
        // Stop the loop BEFORE the scene goes: the hub sets its own loop a
        // moment later, and a frame rendered in between would be drawing a
        // scene that had just been emptied.
        renderer.setAnimationLoop(null);
        delete (window as unknown as Record<string, unknown>).__title;
        window.removeEventListener('resize', resize);
        world.dispose();
        world.scene.clear();
      },
    };
  } catch (err) {
    console.warn('[title] no 3d background', err);
    return null;
  }
}
