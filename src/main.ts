import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import {
  ThreeUmicat, loadScene3D, CharacterController3D, CharacterAnimator, Input3D,
  setupScreenshotListener, setupRecordingListener, runEditorDesignPlayer3D,
  type Scene3D, type Manifest3D, type LoadedScene3D,
} from '@umicat/three-sdk';
import { GAME_WIDTH, GAME_HEIGHT } from './config';
import { Swarm } from './swarm';
import { InfiniteGround } from './ground';
import { mergeStatic } from './merge';

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
/**
 * 相机。**Balaboo 的角度和镜头，只是站得更远。**
 *
 * 三个数写在一处，而且在游戏代码里不在场景 JSON 里：场景的 `camera` 只是
 * 个起始值，SDK 把它当「起始角度和距离」读，调它要改 JSON、重跑生成器、
 * 重新部署。这里改一个常量就行。
 *
 * - `PITCH` 39° 和 `FOV` 55 都是 Balaboo 的原值（它的 offset 是 y5.2/z6.4）。
 * - `RADIUS` 从 8.25 拉到 12，这是唯一动的一个。
 *
 * **为什么只动半径。** 想看得更宽有两条路，量过之后它们差别很大：
 *
 *   - 放宽 FOV：视野确实大（fov 85 能看到 40 格），但透视畸变跟着放大，
 *     远处敌人掉到 **5.6 像素**，而且边缘和身边的距离读数不一致 —— 这个
 *     类型整局都在判断「能不能从两只之间钻过去」。
 *   - 拉远：视野和半径近似成正比，物体大小成反比，透视不变。
 *
 * 实测（横屏手机 852×393，同角度同 FOV）：
 *
 *     半径 8.25 → 看见 20.5 格，主角 25.5px，远处敌人 14.1px   ← Balaboo
 *     半径 10   → 看见 25 格，  主角 21.1px，远处敌人 11.6px   ← 这里
 *     半径 12   → 看见 29.5 格，主角 17.6px，远处敌人  9.8px
 *     半径 14   → 看见 34 格，  主角 15.1px，远处敌人  8.4px
 *
 * 12 试过，回来说太宽了；10 是 Balaboo 的 1.22 倍，主角还有 21px。
 *
 * 一次失败的尝试留在这里当记录：先前试过「拉远 + 收窄 FOV」，以为能又宽又
 * 压平透视 —— 结果 FOV 收得比半径加得还快，**反而更窄了**（15 格）。在这个
 * 尺度上「看多远」主要由 FOV 决定，两件事不能一起动还指望只有好处。
 *
 * 这些数字都是「一只敌人」的。真正要判断的是**一群**敌人读不读得出来，那要
 * 等场上真有几百只才能定 —— 所以 12 是起点不是结论，14 就在旁边。
 */
const CAM = { pitchDeg: 39, radius: 10, fov: 55 };

/** 玩家和敌人的速度。比值比绝对值重要 —— 见 `CharacterController3D` 那里
 *  的注释。 */
const PLAYER_SPEED = 4.6;
const FOE_SPEED = 2.8;

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
    // 跑得过大部分敌人，因为跑就是这个类型唯一的防御动作。
    //
    // 模板给的是 1.9，试出来「很慢」—— Balaboo 那个要走位去摆塔的游戏都用
    // 4.2，而这里视野还更宽（相机半径 10 对它的 8.25），同样的速度在屏幕上
    // 读起来更慢。
    //
    // 真正决定手感的是它和 `FOE_SPEED` 的**比值**，不是这个数本身：追不上
    // 的敌人不是威胁，追得上的敌人让「跑」这个答案失效。4.6 : 2.8 大约是
    // 1.64 倍，意味着一团敌人会被拉成一条尾巴而不是散开或贴上来。
    speed: PLAYER_SPEED,
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

  // 这两个系统必须在**动画循环开始之前**就存在。
  //
  // 它们原本声明在循环后面，于是头几帧里 `swarm.update(...)` 访问的是一个
  // 还在暂时性死区里的 `const` —— 每帧一条 `Cannot access 'H' before
  // initialization`，而游戏照常运行。这个项目记过这个形状（「被提升的函数
  // 用到还没初始化的 const」），它的恶劣之处是**看起来没事**：画面对、玩法
  // 对，只有控制台在刷屏，而错误多到没人看就等于没有错误报告。
  //
  // 注意这和「加载完没完」是两回事：`load()` 是异步的，两个 `update()` 里
  // 各有一道门挡住还没加载好的情况。这里要的只是变量**存在**。
  const ground = new InfiniteGround(world.scene);
  const swarm = new Swarm(world.scene);
  void Promise.all([
    ground.load(manifest, 'td-tile', 'td-tree').then(() => ground.update(SPAWN.x, SPAWN.z)),
    swarm.load(manifest, 'td-ufo-a'),
  ]);

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

    {
      const p = character.position;
      ground.update(p.x, p.z);
      swarm.update(dt, p.x, p.z, world.camera.quaternion, world.camera);
    }

    world.update(dt);                        // animation + physics + follow camera
    // 相机放在 `world.update` **之后**，因为 SDK 的跟随相机每帧都会重写
    // `camera.position` —— 在它之前摆位等于没摆。
    placeCamera();
    renderer.render(world.scene, world.camera);
  });

  /** 把相机摆到 `CAM` 说的地方，盯住主角。
   *
   *  SDK 的跟随相机是从场景的 offset 推出半径和俯角的，而它没有在运行时改
   *  半径的接口（`orbit` 只动偏航和俯角）。与其为了调一个数就去改 JSON、
   *  重跑生成器、重新部署，不如在这里接管 —— 幸存者类本来也要自己的相机。 */
  const camPitch = CAM.pitchDeg * (Math.PI / 180);
  function placeCamera(): void {
    const cam = world.camera as THREE.PerspectiveCamera;
    if (cam.fov !== CAM.fov) { cam.fov = CAM.fov; cam.updateProjectionMatrix(); }
    const p = character.position;
    cam.position.set(p.x, p.y + Math.sin(camPitch) * CAM.radius,
                     p.z + Math.cos(camPitch) * CAM.radius);
    cam.lookAt(p.x, p.y, p.z);
  }

  // 把静态场景折成几个 mesh。
  //
  // 这一步忘了调的代价是**空场 1618 次绘制** —— 这块空地有 2574 个实体，
  // 一棵树一次。它不报错、画面也对，只是把整关的预算在第一帧就花光了，
  // 而且大到足以淹没任何关于敌人的测量。
  // 场景里只剩光、天空、碰撞地板和主角了（见 `tools/gen-arena.mjs`），
  // 所以合批没什么可折的 —— 留着是因为它是免费的，而且以后场景里再放任何
  // 静态东西时，忘了调它的代价是「空场 1618 次绘制」。
  const folded = mergeStatic(world, scene3d, manifest);



  /** 把景物（树、外圈地面）开关掉。
   *
   *  量敌人开销时要关掉：合批之后它们只有几次绘制，但仍然是 27 万三角形，
   *  足以把敌人自己的几何量淹没 —— 一个基线里混着别的东西的测量，读出来
   *  的每一个数都掺着水。 */
  const setScenery = (on: boolean): void => {
    // `mergeStatic` 返回的是计数不是网格 —— 合批后的东西要到场景里按名字找。
    world.scene.traverse((o) => {
      if ((o as THREE.Mesh).isMesh && /forest|scenery|prop/i.test(o.name)) o.visible = on;
    });
  };



  // Handy while developing; harmless in a published build.
  Object.assign(window as unknown as Record<string, unknown>,
    { __game: { umicat, world, character, input, animator,
      locomotion: () => animator?.action || character.state,
      /** 调相机用：改完立刻生效，不用重新部署。 */
      cam: CAM,
      setCam: (o: Partial<typeof CAM>) => Object.assign(CAM, o),
      /** 这个取景下，要读的东西有多大、看得见多远 —— 「更宽」的代价只能
       *  这样量，不能靠看。 */
      ground: () => ground.stats(),
      /** 景物开关 —— 量敌人时关掉。 */
      setScenery,
      merged: () => {
        const out: string[] = [];
        world.scene.traverse((o) => { if ((o as THREE.Mesh).isMesh) out.push(o.name || '(无名)'); });
        return { counts: folded, meshes: out };
      },
      /** 敌群，和量它的东西。 */
      swarm,
      spawn: (n: number) => swarm.spawn(n, 8, 18, character.position.x, character.position.z, 30, FOE_SPEED),
      clearFoes: () => swarm.clear(),
      setMode: (m: 'instanced' | 'clone') => swarm.setMode(m),
      foeCount: () => swarm.foes.length,
      /** 渲染器自己的统计。「这套架构能画多少」只能问它，不能算。 */
      renderStats: () => {
        const i = renderer.info;
        return { calls: i.render.calls, triangles: i.render.triangles,
                 geometries: i.memory.geometries, textures: i.memory.textures };
      },
      view: () => {
        const cam = world.camera as THREE.PerspectiveCamera;
        cam.updateMatrixWorld(true);
        const h = (document.getElementById('game') as HTMLCanvasElement).clientHeight;
        const px = (x: number, z: number, top: number) => {
          const a = new THREE.Vector3(x, 0, z).project(cam);
          const b = new THREE.Vector3(x, top, z).project(cam);
          return +(Math.abs(b.y - a.y) / 2 * h).toFixed(1);
        };
        const p = character.position;
        // 从主角往外找，最远还有多少格落在画面内 —— 也就是能看见多远的敌人。
        let reach = 0;
        for (let d = 1; d <= 40; d += 0.5) {
          const v = new THREE.Vector3(p.x, 0, p.z - d).project(cam);
          if (Math.abs(v.x) > 1 || Math.abs(v.y) > 1) break;
          reach = d;
        }
        return { ...CAM, heroPx: px(p.x, p.z, 0.72),
                 foePx: px(p.x, p.z - reach * 0.7, 0.68), reachAhead: reach };
      },
    } as unknown });
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
