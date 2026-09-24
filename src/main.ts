import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import {
  ThreeUmicat, loadScene3D, CharacterController3D, CharacterAnimator, Input3D,
  setupScreenshotListener, setupRecordingListener, runEditorDesignPlayer3D,
  type Scene3D, type Manifest3D, type LoadedScene3D,
} from '@umicat/three-sdk';
import { GAME_WIDTH, GAME_HEIGHT } from './config';

/**
 * A 3D Umicat game.
 *
 * Everything host-facing — who the player is, their cloud save, shared game
 * data, multiplayer, runtime AI, voice — comes from `umicat.*` and is identical
 * to what a 2D game gets, because it is literally the same package underneath.
 * What differs is only how the world is drawn.
 *
 * Start here: `SAVE_KEY`, the scene JSON in `public/scenes3d/`, and `update()`.
 */

const SAVE_KEY = 'progress';

// Where the character starts, and where it is put back if it ever leaves the
// world. Falling out is not hypothetical: before the arena was enclosed, a few
// seconds of walking dropped the player through the edge and kept going, and
// because the position was being saved they were restored mid-plunge on the
// next load. A world without a floor under its floor strands people.
const SPAWN = { x: 0, y: 0.4, z: 1.7 };
const RESPAWN_BELOW_Y = -5;

async function start(): Promise<void> {
  // 1) The platform. Do this first: reading the save before the first frame is
  //    what makes a reload resume instead of restart.
  const umicat = await ThreeUmicat.init();

  // 2) Render setup, hoisted ahead of physics/scene-load so the Edit-mode
  //    branch below can use it without booting anything else. The canvas is
  //    in index.html; the game owns the loop.
  // preserveDrawingBuffer: true — required for the editor's screenshot
  // capture (canvas.toDataURL right after a render can otherwise come back
  // blank on WebGL). Same setting umicat-phaser-sdk's UmicatGame sets for
  // every 2D game; here the game owns renderer construction, so the SDK
  // can't set it for us.
  const canvas = document.getElementById('game') as HTMLCanvasElement;
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  // Screenshot + video capture for the editor's Capture menu — same
  // postMessage protocol umicat-phaser-sdk speaks, so the host never needs
  // to know which engine is running.
  setupScreenshotListener(renderer);
  setupRecordingListener(renderer);

  // Edit mode (ADR-021's `?umicatEdit=1`, mirrored from 2D): the platform's
  // Edit tab wants a read-only render of the scene's AUTHORED data, no game
  // code, no save — never the real game. `runEditorDesignPlayer3D` owns the
  // renderer from here on; the rest of `start()` (physics, character, saves)
  // must never run alongside it.
  const params = new URLSearchParams(location.search);
  if (params.has('umicatEdit')) {
    await runEditorDesignPlayer3D(renderer, { sceneId: params.get('umicatScene') ?? undefined });
    return;
  }

  // 3) Physics. Rapier is WASM and must be initialised before use.
  await RAPIER.init();

  // 4) The world, from design data on disk. Nothing here runs game logic —
  //    same separation the 2D editor relies on (ADR-021).
  const [manifest, scene3d] = await Promise.all([
    fetch('scenes3d/manifest.json').then((r) => r.json() as Promise<Manifest3D>),
    fetch('scenes3d/main.json').then((r) => r.json() as Promise<Scene3D>),
  ]);
  const world = await loadScene3D(scene3d, manifest, { assetBase: '', rapier: RAPIER });

  const hero = world.entities.get('hero')!;
  const saved = (await umicat.saves.get<{ x: number; y: number; z: number }>(SAVE_KEY)) ?? null;

  // Sized for THIS character and this world's unit. The capsule's total height
  // is 2*halfHeight + 2*radius = 0.72, which is the character's own height —
  // a collider that does not match the model is how a character ends up
  // floating, sunk, or catching on things that are not there.
  const character = new CharacterController3D(world.world, RAPIER, {
    position: saved ?? SPAWN,
    halfHeight: 0.2,
    radius: 0.16,
    speed: 1.9,        // ~2.6 character-heights per second
    stepHeight: 0.17,  // a quarter of the character's height
    // ~0.94 units at full height, a bit over one character height. The SDK owns
    // how a jump FEELS — coyote time, buffering, variable height — because
    // every 3D game shares this character (ADR-034); this is just how high.
    //
    // Full height is not the number you build platforms against: releasing
    // early cuts the jump on purpose, so a TAPPED jump rises about a fifth as
    // far. Ask the controller (`character.minJumpRise`) instead of doing the
    // algebra — see CLAUDE.md.
    jumpSpeed: 2.8,
  });
  // Action buttons are DECLARED, not built. Mounting your own is how one game
  // put its attack button exactly on top of the jump button on a phone — same
  // corner, platform layer on top, so the attack button could not be tapped at
  // all and nothing errored. The SDK places every button, so they cannot
  // collide, and the same declaration gives you the key binding.
  const input = new Input3D({ actions: [{ id: 'attack', label: '⚔', keys: ['KeyJ'] }] });

  // Animation. The SDK owns both halves — locomotion follows the controller's
  // state, and an action is a one-shot that interrupts and returns. Neither is
  // game logic: once every game shares one character, they are the character's
  // behaviour (ADR-034).
  const heroMixer = world.mixerFor.get('hero');
  const clipMap: Record<string, string> =
    (manifest.models?.find((m) => m.id === 'hero') as { animations?: Record<string, string> } | undefined)?.animations ?? {};
  const animator = heroMixer
    ? new CharacterAnimator(heroMixer, world.clips.get('hero') ?? [], clipMap)
    : null;

  // 5) The rest of render setup. `canvas`/`renderer` already exist (step 2,
  //    above the Edit-mode branch) — this game is definitely the real one now.
  const hud = document.getElementById('hud')!;

  const resize = (): void => {
    renderer.setSize(window.innerWidth, window.innerHeight, false);
    world.camera.aspect = window.innerWidth / window.innerHeight;
    world.camera.updateProjectionMatrix();
  };
  resize();
  window.addEventListener('resize', resize);

  // Write into a CHILD, never `hud.textContent` — that wipes every child the
  // HUD has, which is how the on-screen touch controls used to disappear.
  const greeting = document.createElement('div');
  greeting.textContent = umicat.user ? `Hello, ${umicat.user.name}` : 'Playing as a guest';
  hud.appendChild(greeting);

  // Saving every frame would hammer the host; coalesce instead.
  let pending: ReturnType<typeof setTimeout> | undefined;
  const save = (): void => {
    clearTimeout(pending);
    pending = setTimeout(() => {
      const p = character.position;
      void umicat.saves.set(SAVE_KEY, { x: p.x, y: p.y, z: p.z });
    }, 500);
  };

  // three.js deprecated Clock, and setAnimationLoop already hands us the
  // timestamp, so there is nothing to replace it with.
  let last = performance.now();
  renderer.setAnimationLoop((now: number) => {
    // Clamped: a backgrounded tab returns with a multi-second delta and
    // everything tunnels through the floor in one step.
    const dt = Math.min((now - last) / 1000, 0.05);
    last = now;
    // Turn the camera from the right half of the screen, then walk relative to
    // where it now points. The order matters: reading `look` first means this
    // frame's movement already accounts for this frame's turn, rather than
    // lagging one frame behind every time you swing the camera round.
    //
    // Passing `cameraYaw` is not optional once the camera can turn. Without
    // it, "up" on the stick always walks north — so the player looks at
    // something, pushes towards it, and goes somewhere else. That is worse
    // than a camera that does not turn at all.
    const turn = input.look();
    if (turn.x || turn.y) world.orbit(turn.x, turn.y);
    const dir = input.direction(world.cameraYaw);

    character.update(dt, dir, { jump: input.jump });

    // The floor under the floor. Rapier's character controller resolves against
    // contacts rather than integrating through them, so putting the body back
    // is enough — the next frame lands and clears the fall speed.
    if (character.position.y < RESPAWN_BELOW_Y) {
      character.teleport(SPAWN);
    }

    character.syncTo(hero, -0.36);          // capsule centre → the model's feet (halfHeight + radius)
    character.faceTowards(hero, dir, dt);

    // One press is one swing. Two guards, doing different jobs: the edge check
    // means holding the key does not chain swings (drop it and you get
    // hold-to-attack, which is a game's decision), and the animator's `busy`
    // means a second press mid-swing is ignored rather than restarting it.
    // One press is one swing. `consume` latches at the event and clears on
    // read, so holding does not chain — and, unlike comparing this frame's
    // state to last frame's, it cannot miss a tap that began and ended between
    // two frames. `busy` is the separate question of whether a swing is
    // already playing.
    if (input.consume('attack') && animator && !animator.busy) animator.play('attack');
    animator?.update(character.state);
    // Save only while STANDING on something. A position saved mid-air restores
    // you mid-air, which turns one fall into a permanently broken save.
    if (Math.hypot(dir.x, dir.z) > 0 && character.grounded) save();

    world.update(dt);                        // animation + physics + follow camera
    renderer.render(world.scene, world.camera);
  });

  // Handy while developing; harmless in a published build.
  Object.assign(window as unknown as Record<string, unknown>,
    { __game: { umicat, world, character, input, animator, locomotion: () => animator?.action || character.state } as unknown });
}

void start().catch((err) => {
  // A 3D game that fails to boot should say so rather than show a black canvas.
  const hud = document.getElementById('hud');
  if (hud) hud.textContent = `Failed to start: ${String(err)}`;
  console.error('[umicat] game failed to start', err);
});

// Referenced so the design canvas is not silently unused; a game that letterboxes
// itself will want these.
void GAME_WIDTH; void GAME_HEIGHT;
