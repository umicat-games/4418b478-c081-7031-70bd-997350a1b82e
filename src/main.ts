import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import {
  ThreeUmicat, loadScene3D, CharacterController3D, CharacterAnimator, Input3D,
  setupScreenshotListener, setupRecordingListener, runEditorDesignPlayer3D,
  flashTint, updateTints, isTinted,
  type Scene3D, type Manifest3D, type LoadedScene3D,
} from '@umicat/three-sdk';
import { GAME_WIDTH, GAME_HEIGHT } from './config';
import { readSave, writeSave, type SaveRow } from './save';
import { Swarm } from './swarm';
import { InfiniteGround } from './ground';
import { OrbitBlades, TrailBurn, HomingBolt, ShockLance, ChainLightning } from './weapons';
import { Sparks, Slashes } from './sparks';
import { DamageNumbers } from './damagenums';
import { Vfx, ring, preloadAtlas } from './vfx';
import { createAudio, SFX } from './audio';
import { readoutPlate } from './hud';
import { mergeStatic } from './merge';
import {
  RUN_SECONDS, spawnGapAt, batchAt, hpAt, hpLevelScale, speedAt,
  ELITE_EVERY, eliteHp,
} from './curve';
import { makeGems, makeCoins, xpToNext } from './xp';
import { HeroBar } from './herobar';
import { createLevelUp, type Offer } from './levelup';
import { createGameOver } from './gameover';
import { Crates, BUFF_SECONDS, type BuffKind } from './crates';

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
/** 敌人的基准速度 —— **只剩调试用的那个生成器在读它**。
 *
 *  正式的生成走 `curve.speedAt(t)`，这个数是它的起点。留在这里是因为下面
 *  那段推导（为什么是 3.5 而不是 2.8）解释了整条曲线的上下界从哪来。
 *
 *  **比值决定一切，而 1.64 倍太大了。** 先前定 2.8 的理由是「把一团敌人拉成
 *  一条尾巴」—— 实测那个比值拉出来的不是尾巴，是彻底甩掉：直线跑三十秒，
 *  身边只剩三只，血满的、击杀零，全程没交手。
 *
 *  算一下就清楚：被超过之后敌人以 4.6 − 2.8 = **1.8 格/秒**掉队，尾巴一瞬间
 *  就散了。3.5 的话只掉 1.1，尾巴跟得住；迎面来的以 8.1 逼近而不是 7.4。
 *
 *  吸血鬼幸存者里敌人只比玩家稍慢（快的品种还能追上），所以你没法一走了之，
 *  只能穿插走位 —— 那才是这个类型要玩家做的事。 */
const FOE_SPEED = 3.5;

/** 敌人生成在**屏幕外的一个环上**（内径大于可见距离），所以它们是走进来的，
 *  不是凭空出现在你旁边。这条是这个类型的硬规则：在你看得见的地方生成，
 *  玩家会觉得是游戏在作弊而不是自己站错了位置。
 *
 *  「多久一批、一批几只、多少血、多快」现在全在 `src/curve.ts` 里按时间读。 */
const SPAWN_RING = [26, 34] as const;

/** 玩家的血，和贴身挨打的代价。
 *
 *  伤害跟着**贴身的敌人数量**走，但**有上限**。
 *
 *  两件事都要成立，而第一版只做对了一件：一只和十只代价一样的话，「被包围」
 *  就不值得躲，而被包围是这个类型唯一的输法；但**线性叠加在高端是错的** ——
 *  4/秒/只 × 十只 = 40 HP/秒，满血 2.5 秒清空。实测站着不动 **19 秒就倒**，
 *  而一直走直线永远不掉血：游戏只奖励一种打法，另一种直接处决。
 *
 *  吸血鬼幸存者给受伤设了上限（无尽模式的描述里提到「玩家的单次受伤上限每轮
 *  −1」），所以被五十只围住不会瞬间蒸发 —— 围住你的是**压力**，不是处决。
 *
 *  **这两个数往上调过一次，因为「玩家太强了」。** 2/秒 × 上限 3 只 = 6/秒，
 *  满血能在人堆里站 17 秒 —— 而这个游戏唯一的输法就是被围住，17 秒长到足以
 *  让「被围住」不构成威胁。再加上击退一直在把贴身的那圈往外推（那是我加的，
 *  也是玩家变强的一个来源），实际挨打还要更少。
 *
 *  现在 3.2/秒、上限 4 只：一只贴着仍然可以忽略，四只以上是 12.8/秒，满血
 *  约 **8 秒**。够长到能反应过来往外挤，够短到站着不动一定会死。 */
const PLAYER_HP = 100;
const CONTACT_DPS = 3.2;
const CONTACT_CAP = 4;

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
  // `?? SPAWN` used to be the only guard here and it checked the wrong thing —
  // see src/save.ts. A row that is truthy but missing `x` crashed the boot on
  // every load until it was cleared by hand.
  const saved = readSave(await umicat.saves.get<SaveRow>(SAVE_KEY), SPAWN);

  // Sized for THIS character and this world's unit. The capsule's total height
  // is 2*halfHeight + 2*radius = 0.72, which is the character's own height —
  // a collider that does not match the model is how a character ends up
  // floating, sunk, or catching on things that are not there.
  const character = new CharacterController3D(world.world, RAPIER, {
    position: { x: saved.x, y: saved.y, z: saved.z },
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
      // The progress goes in either way; the position only if every axis is
      // really a number. Writing one that is not is how the save that would
      // not boot got written in the first place.
      void umicat.saves.set(SAVE_KEY,
        writeSave(character.position, { gold, bestClock, bestKills }));
    }, 500);
  };

  /** 读数：一条血条，加时间和击杀。
   *
   *  **血量是一条看得见的血条，不是一个数字。** 第一版是顶部中间挤成三行的
   *  一行字，还被平台自己的「Playing as a guest」压着 —— 结果是伤害一直在扣
   *  而玩家**看不见自己在掉血**，于是「碰到我也没伤害呀」。一个读不到的读数
   *  等于没有读数，而且它骗的不只是眼睛：玩家会据此得出错误的结论去调数值。
   *
   *  一眼能读的是**颜色和长度**，不是位数 —— 这也是本项目一直的结论：
   *  「血条本身就是那个数字」。
   *
   *  放在左上角、平台那块 chip 下面。DOM，不画进场景。
   *  **绝不写 `hud.textContent`** —— 那会清空平台挂在里面的触屏控件层。 */
  const readout = (() => {
    const wrap = document.createElement('div');
    wrap.style.cssText = 'position:absolute; top:44px; left:12px; pointer-events:none;';

    // **血条不在这里了** —— 它搬到主角头顶（`herobar.ts`），因为这个类型里
    // 玩家的眼睛整局钉在自己身上。角落这块牌子现在只放「慢」的信息：时间、
    // 等级、经验、击杀、金币。血是快信息，快信息要长在眼睛已经在看的地方。
    const xpTrack = document.createElement('div');
    xpTrack.style.cssText = `position:relative; margin-top:3px; width:172px; height:7px;
      border-radius:4px; background:rgba(0,0,0,.42);
      box-shadow:inset 0 0 0 2px rgba(255,255,255,.22); overflow:hidden;`;
    const xpFill = document.createElement('div');
    xpFill.style.cssText = 'height:100%; width:0%; border-radius:4px; background:#5fe0ff;';
    xpTrack.appendChild(xpFill);

    const line = document.createElement('div');
    line.style.cssText = `margin-top:5px; font:700 13px/1.4 system-ui,sans-serif; color:#fff;
      font-variant-numeric:tabular-nums;`;

    wrap.appendChild(readoutPlate(xpTrack, line));
    hud.appendChild(wrap);   // 追加子元素，绝不写 hud.textContent

    const mmss = (t: number) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;
    return {
      set(clock: number, kills: number, alive: number, hp: number,
          level: number, xp: number, need: number, gold: number, over: boolean) {
        xpFill.style.width = `${(Math.min(1, xp / need) * 100).toFixed(1)}%`;
        line.textContent = over
          ? (hp <= 0 ? `倒下了 · ${mmss(clock)} · ${level} 级 · 击杀 ${kills} · 金币 ${gold}`
                     : `撑满 15 分钟 · ${level} 级 · 击杀 ${kills} · 金币 ${gold}`)
          : `${mmss(clock)}   Lv${level}   击杀 ${kills}   金币 ${gold}   场上 ${alive}`;
      },
    };
  })();

  /** 一句话横幅。**写它做什么，不写它叫什么。**
   *
   *  Balaboo 那边的原始反馈是「我打开了它，没有任何东西告诉我发生了什么变化」
   *  —— 一个只在屏幕上待一秒半的**名字**，等于没说。 */
  const banner = (() => {
    const el = document.createElement('div');
    el.dataset.banner = '';
    el.style.cssText = `position:absolute; left:50%; top:24%; transform:translate(-50%,-50%);
      pointer-events:none; opacity:0; transition:opacity .18s; white-space:nowrap;
      font:800 22px/1.3 system-ui,sans-serif; color:#fff; text-align:center;
      text-shadow:0 2px 10px rgba(0,0,0,.7), 0 0 3px rgba(0,0,0,.95);`;
    hud.appendChild(el);            // 追加子元素，绝不写 hud.textContent
    let hide: ReturnType<typeof setTimeout> | undefined;
    return (text: string, color: number): void => {
      el.textContent = text;
      el.style.color = `#${color.toString(16).padStart(6, '0')}`;
      el.style.opacity = '1';
      clearTimeout(hide);
      hide = setTimeout(() => { el.style.opacity = '0'; }, 1600);
    };
  })();

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
  const gems = makeGems(world.scene);
  // 金币。掉落**比经验稀得多**，而且走同一套磁吸 —— 走过去就飞过来那件事
  // 本身是奖励的一部分，两种掉落物都该有。
  const coins = makeCoins(world.scene);
  const heroBar = new HeroBar(world.scene);
  const crates = new Crates(world.scene);

  /** 正在生效的那个增益，和还剩多久。 */
  let buff: { kind: BuffKind; left: number } | null = null;
  /** 「全图掉落飞向你」是靠**临时**把吸取半径拉到全图实现的，这个数是还要
   *  维持多少**秒**。
   *
   *  第一版写的是「维持 2 帧」，实测**一颗都没收到**：掉落物是按帧朝玩家飞的，
   *  而磁吸的最大速度是 17 格/秒 —— 两帧（约 0.03 秒）只够挪半格，十四格外的
   *  东西根本没动。这东西要的是**一段飞行时间**，不是一个瞬间的开关，而「几帧」
   *  这个单位把这件事问错了。
   *
   *  1.6 秒：17 格/秒 足够把这个取景里看得见的掉落全都收回来，而且**看得见
   *  它们飞过来** —— 那一下本身就是奖励的一部分。 */
  let vacuumLeft = 0;

  /** 脚下那个圈 —— **它才是「我现在带着什么」的主要渠道**。
   *
   *  从 Balaboo 搬的判断，原话很准：「字只在屏幕上待一瞬，而脚下那个圈要陪你
   *  走完整段时间。」角落里挂一个图标加倒计时是**要你专门去读**的东西，而这个
   *  类型整局的眼睛都在主角身上。
   *
   *  自己一个 mesh，显示/隐藏而不是建了再扔：它一次活好几秒，而 `vfx` 装的是
   *  一秒内就没的东西。 */
  const buffRing = new THREE.Mesh(
    new THREE.RingGeometry(0.42, 0.55, 36).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({
      color: 0xffffff, transparent: true, opacity: 0.85,
      side: THREE.DoubleSide, depthWrite: false,
    }),
  );
  buffRing.visible = false;
  buffRing.renderOrder = 3;
  world.scene.add(buffRing);

  // 反馈层。**两套，而且分工是按频率分的，不是按好看程度分的。**
  //
  //  - `Sparks` 是常驻粒子池：一次绘制、帧里不分配内存，装的是**每秒几十次**
  //    的东西（每一次命中、每一只死亡、每一发弹的尾迹）。
  //  - `Vfx` 是搬过来的特效注册表，一次施放新建一份网格，上限 48 个。装的是
  //    **偶尔一次**的东西（闪电的弧、升级的光环）。
  //
  // 搞反了就是这个游戏最容易踩的坑：把死亡爆裂交给 `Vfx`，后段一秒三十次，
  // 一秒半就把 48 个槽塞满，然后特效开始**互相挤掉** —— 你刚打死的那只没有
  // 火花，因为一秒前的那批还占着位置。细节写在 `sparks.ts` 开头。
  const sparks = new Sparks(world.scene);
  // 每次命中的那道白光。形状是 Balaboo 那道「两边窄中间宽」的线，实现换成了
  // 实例化池 —— 理由写在 `sparks.ts` 的 `Slashes` 上：后段每秒上百次命中。
  const slashes = new Slashes(world.scene);
  // 伤害数字。也是一个池子、一次绘制 —— 每个字形一个实例，字形下标逐实例给。
  const dmgNums = new DamageNumbers(world.scene);
  const vfx = new Vfx(world.scene, () => world.camera);
  const audio = createAudio();

  const blades = new OrbitBlades(world.scene);
  const trail = new TrailBurn(world.scene);
  const bolt = new HomingBolt(world.scene, sparks);
  const shock = new ShockLance(world.scene, sparks);
  const chain = new ChainLightning(vfx, sparks);
  // 三把要「开火」的武器各有自己的一声。**这是玩家分辨自己拿了什么的主要
  // 渠道** —— 环刃和尾迹是持续的、没有开火这回事，而这三把是有节奏的，
  // 听得出来就知道哪把在工作、什么时候该往前冲。
  bolt.onFire = () => audio.play(SFX.bolt);
  shock.onFire = () => audio.play(SFX.shock);
  chain.onFire = () => audio.play(SFX.chain);
  // 追踪弹的命中不再单独出声 —— 现在**所有**没打死的命中都走
  // `swarm.onDamage` 里那一条，它已经把追踪弹盖住了。留着的话这一把武器
  // 的每次命中会响两声。

  // 一局的状态。**初值在 `resetRun()` 里，不在这里** —— 见那个函数的注释。
  let runClock = 0;
  let kills = 0;
  let spawnTimer = 0;
  let eliteTimer = 0;
  let elites = 0;
  let over = false;
  let paused = false;
  /** 距离下一次「挨打」的提示还有多久。见接触伤害那段。 */
  let hurtCue = 0;
  /** 金币。**跨局累计**，存在云存档里。
   *
   *  它现在**还没有地方花** —— 这件事必须说清楚，因为一个看得见、涨得动、
   *  却什么都换不到的数字，正是这个项目一直在反对的那种「升级了但没变化」。
   *  金币在吸血鬼幸存者里是**局外**货币（买永久强化），所以它的去处是一个
   *  局间商店，那是下一步，不是这一步。 */
  let gold = saved.gold;
  /** 这一局捡了多少（`gold` 是跨局总数）。 */
  let runGold = 0;
  let bestClock = saved.bestClock;
  let bestKills = saved.bestKills;
  let hp = PLAYER_HP;
  let hpMax = PLAYER_HP;
  let level = 1;
  let xp = 0;
  let xpNeed = xpToNext(1);
  /** 还欠玩家几次三选一。见循环里为什么这是个队列。 */
  let pendingLevels = 0;
  /** 探针用：别弹升级面板。
   *
   *  这不是「方便」，是一次真实的误诊换来的：量五把武器的时候，第一把杀够了
   *  人就弹出三选一，面板**暂停整局**，于是后面四把全量到 0 击杀 —— 读起来
   *  像四把武器都坏了。测单个系统的探针必须能把别的系统按住。 */
  let levelsOff = false;
  /** 探针用：不掉血。
   *
   *  加它的直接原因：贴身伤害从 6/秒提到 12.8/秒之后，**探针在开场等待期间
   *  就被打死了** —— 主角站在出生点不动，十秒足够死一次，于是后面所有测量都
   *  在结束对话框后面冻着，读出来是「场上 0 只、速度平均 NaN」。
   *
   *  量别的东西的探针不该同时在打一局游戏。 */
  let god = false;
  /** 探针用：别让箱子自己出现。
   *
   *  **箱子会污染所有别的测量**，而且是以最难看出来的方式：一个 `wipe` 在你
   *  量「400 只敌人的绘制开销」时刚好刷出来，场上瞬间清空，量到的数字比空场
   *  还低；一个 `freeze` 会让「敌人走多快」量到 0。这不是探针之间互相污染，
   *  是**游戏系统在污染探针**，所以关掉它的开关得在游戏这边。 */
  let cratesOff = false;
  /** 尾迹武器要**选到了才有**。这是升级池里唯一一个「开一样新东西」的选项，
   *  也是这个游戏现在唯一的第二把武器。 */
  let hasTrail = false;
  let hasBolt = false;
  let hasShock = false;
  let hasChain = false;
  let speedMult = 1;

  /** 五把武器出厂时的那几个数。
   *
   *  **要在这里抄一份，因为升级是直接改武器对象上的字段的。** 重开一局如果不
   *  还原，玩家会带着上一局的六把刀和七跳闪电开局 —— 而这种 bug 不报错、不
   *  崩溃，只是让第二局变成另一个游戏。 */
  /** 吸取半径**该**是多少。
   *
   *  和 `gems.magnet` 分开，因为「全图吸取」会临时把 `gems.magnet` 顶到 400
   *  再还原 —— 还原成什么，得有个地方记着，不能从被改过的那个字段反推。
   *  （升级项的 `level` 也是从这个数算的，否则道具生效的那两帧里，
   *  「吸引」会显示成满级。） */
  let magnetBase = gems.magnet;

  const WEAPON_BASE = {
    blades: blades.count, trail: trail.life, bolt: bolt.shots,
    shock: shock.half, chain: chain.jumps, magnet: gems.magnet,
  };

  // 敌人死在哪，经验就掉在哪 —— 顺手在那儿炸一把。
  //
  // **死亡反馈必须在这里，不能在各把武器里。** 五把武器都会杀人，写在武器里
  // 就是五份同样的代码，而且漏掉一把的话"某些死法没有爆炸"会像个玄学 bug。
  // 这里是唯一一个知道"有东西死了"的地方。
  swarm.onDeath = (x, z, elite) => {
    gems.drop(x, z, elite ? 12 : 1);
    // 金币是**偶尔**掉的，精英必掉一把。天天掉的东西不构成一件值得绕路去捡
    // 的事 —— 而绕路正是掉落物在这个类型里的全部作用。
    if (elite) coins.drop(x, z, 25);
    else if (Math.random() < 0.09) coins.drop(x, z, 1);
    sparks.burst(x, 0.45, z, elite
      ? { count: 40, color: 0xffe08a, color2: 0xff5a2a, speed: 6, life: 0.8, size: 0.26 }
      : { count: 9, color: 0xffc98a, color2: 0xff6a3c, speed: 2.8, life: 0.42 });
    if (elite) ring(vfx, new THREE.Vector3(x, 0.05, z),
      { color: 0xffb057, from: 0.5, to: 3.4, life: 0.5 });
    audio.play(SFX.kill);
  };

  // 每挨一下：白光 + 往后退一下（退势在 `Swarm` 里，见 `knock`）。
  //
  // **挂在敌群上，不挂在各把武器里。** 五把武器都会打人，写在武器里就是五份
  // 同样的代码，而漏掉一把会变成「某些武器打上去没反应」这种玄学。这里是唯一
  // 一个知道「有东西挨打了」的地方 —— 和 `onDeath` 同一个道理。
  swarm.onDamage = (x, z, amount, killed, elite) => {
    // 打死的那一下不划白光、也不放命中声：紧接着就是爆裂、掉落和死亡音，
    // 再叠一层只是糊在一起。
    //
    // **「活下来才响」是 Balaboo 的规则，照搬。** 这不是「一次事件两个声音」，
    // 是**一次事件一个声音，按结果选**：没死 → `hit-enemy`，死了 → `enemy-die`
    // （在 `onDeath` 里）。
    //
    // 上一版我把 `hit` 挂在「这一帧杀掉了谁」上，于是每次死亡**同时**放命中声
    // 和死亡声 —— 乱战里每秒 11.1 声，一半是这个重复。当时的修法是把命中声几乎
    // 全关掉，那是把症状连着功能一起切了：真正错的只是挂错了地方。
    if (!killed) {
      slashes.cut(x, 0.55, z, elite ? 0xffe2b0 : 0xffd9c2, elite ? 0.7 : 0);
      audio.play(SFX.hit);
    }
    // 伤害数字。`add` 自己会把近处、同一瞬间的几下并成一个数 —— 后段每秒
    // 上百次命中，一命中一个数字是一面读不了的数字墙。
    dmgNums.add(x, z, amount);
  };

  void Promise.all([
    ground.load(manifest, 'td-tile', 'td-tree').then(() => ground.update(SPAWN.x, SPAWN.z)),
    swarm.load(manifest, 'td-ufo-a'),
    // 掉落物用 Kenney Platformer Kit 里的现成模型（和场景里的树、箱子同一套）。
    gems.load(manifest, 'jewel'),
    coins.load(manifest, 'coin-gold'),
    crates.load(manifest, 'crate'),
    // 追踪弹用 kit 里的箭（Balaboo 用的那一个），不再是程序生成的圆锥。
    bolt.load(manifest, 'td-ammo-arrow'),
    // 贴图要在第一次放特效**之前**到位。`TextureLoader.load` 是异步的，材质
    // 建好时图还没来 —— 而在加色混合下，空贴图采样出来是黑的，黑加到屏幕上
    // 就是看不见。这条是 `vfx.ts` 里记着的：第一次施放画了十个完全正确、
    // 谁也看不见的三角形。
    preloadAtlas(),
  ]);

  /** 升级面板。暂停整局 —— 理由写在 `levelup.ts` 里。 */
  const levelUp = createLevelUp({
    pause: (on) => {
      paused = on;
      // 平台的触屏控件是盖在上面的一整层，不关掉的话面板上的按钮点不到 ——
      // 点下去的是它背后的移动区，而且人物还会在面板后面走。
      input.setEnabled(!on);
      if (on) {
        audio.play(SFX.levelUp);
        const c = character.position;
        ring(vfx, new THREE.Vector3(c.x, 0.05, c.z),
          { color: 0x8fe3ff, from: 0.6, to: 4.2, life: 0.7 });
        sparks.burst(c.x, 0.5, c.z,
          { count: 34, color: 0xbfe9ff, color2: 0x5fe0ff, speed: 4, up: 1.4, life: 0.9 });
      }
    },
    press: () => audio.play(SFX.uiPress),
  });

  /**
   * 开一局。
   *
   * **开局和重开走的是同一段代码，这是刻意的。** 如果「重开」另写一份，漏掉
   * 一个字段的代价是第二局悄悄变成另一个游戏（还带着上一局的六把刀）；而共用
   * 一段之后，漏掉的那个字段**第一局就是错的**，五秒钟就能发现。
   *
   * 这也是为什么上面那些 `let` 的初值都不重要 —— 真正的初值在这里。
   */
  function resetRun(): void {
    runClock = 0;
    kills = 0;
    spawnTimer = 1.5;
    eliteTimer = ELITE_EVERY;
    elites = 0;
    over = false;
    hurtCue = 0;
    hp = hpMax = PLAYER_HP;
    level = 1;
    xp = 0;
    xpNeed = xpToNext(1);
    pendingLevels = 0;
    runGold = 0;
    hasTrail = hasBolt = hasShock = hasChain = false;
    speedMult = 1;
    applySpeed();

    blades.count = WEAPON_BASE.blades;
    trail.life = WEAPON_BASE.trail;
    bolt.shots = WEAPON_BASE.bolt;
    shock.half = WEAPON_BASE.shock;
    chain.jumps = WEAPON_BASE.chain;
    magnetBase = WEAPON_BASE.magnet;
    gems.magnet = coins.magnet = magnetBase;
    vacuumLeft = 0;

    buff = null;
    buffRing.visible = false;
    swarm.clear();
    gems.clear();
    coins.clear();
    crates.clear();
    sparks.clear();
    slashes.clear();
    dmgNums.clear();
    vfx.clear();
    character.teleport(SPAWN);
    ground.update(SPAWN.x, SPAWN.z);
  }

  /** 一局结束时的对话框。
   *
   *  **结束必须是一个事件，不是一个状态。** 在这之前，一局结束只是角落那行字
   *  换了措辞，然后世界停住 —— 没有任何东西说这局完了，也没有任何办法再来
   *  一局，除非重新加载页面。 */
  const gameOver = createGameOver({
    pause: (on) => { paused = on; input.setEnabled(!on); },
    press: () => audio.play(SFX.uiPress),
    restart: () => resetRun(),
    // 独立打开（没有 Umicat 宿主）时没有「返回」可言，SDK 说得很明白：
    // 与其给一个按了没反应的控件，不如不给。
    exit: umicat.platform.canExit ? () => { void umicat.platform.exit(); } : null,
  });

  /** 一局结束。存成绩，弹对话框。 */
  function endRun(won: boolean): void {
    over = true;
    audio.play(won ? SFX.victory : SFX.lose);
    const s = {
      clock: runClock, level, kills, gold: runGold, totalGold: gold, won,
      bestClock, bestKills,
    };
    // 纪录在**弹面板之前**存、但在**读进面板之后**更新 —— 面板要显示的是
    // 「上次的纪录」，不是刚刚被自己覆盖掉的那个。
    bestClock = Math.max(bestClock, runClock);
    bestKills = Math.max(bestKills, kills);
    save();
    gameOver.show(s);
  }

  /** 升级池。
   *
   *  **每一项都要改变你怎么玩，不是改变一个数字。** 所以这里没有「伤害
   *  +10%」—— 那种项在三选一里永远是安全牌，而安全牌多了，三选一就退化成
   *  一道算术题。
   *
   *  三选一每次从**还没满级**的项里抽。抽不满三个就用「回血」补位 ——
   *  它可以无限拿，所以池子永远不会空；而且到了后期，什么都满级的时候，
   *  能换血才是真正稀缺的东西。 */
  const heal = (): Offer => ({
    id: 'heal', title: '补给', body: `立刻回 40 点血（现在 ${Math.ceil(hp)}/${hpMax}）`,
    level: 0, max: Infinity,
    take: () => { hp = Math.min(hpMax, hp + 40); },
  });
  const pool: Offer[] = [
    { id: 'blades', title: '环刃', body: '多一把刀绕着你转 —— 覆盖更满，不是伤害更高',
      get level() { return blades.count - 2; }, max: 4,
      take: () => { blades.count += 1; } },
    { id: 'trail', title: '尾迹灼烧', body: '走过的地方留下火，跑起来就是输出',
      isNew: true,
      get level() { return hasTrail ? Math.round((trail.life - 2.6) / 0.8) + 1 : 0; }, max: 4,
      take: () => { if (hasTrail) trail.life += 0.8; else hasTrail = true; } },
    { id: 'bolt', title: '追踪弹', body: '飞出去找一只打 —— 优先招呼精英',
      isNew: true,
      get level() { return hasBolt ? bolt.shots : 0; }, max: 4,
      take: () => { if (hasBolt) bolt.shots += 1; else hasBolt = true; } },
    { id: 'shock', title: '前向冲击', body: '朝你跑的方向推出一道波 —— 想清哪边就朝哪边跑',
      isNew: true,
      get level() { return hasShock ? Math.round((shock.half - 0.55) / 0.22) + 1 : 0; }, max: 4,
      take: () => { if (hasShock) shock.half += 0.22; else hasShock = true; } },
    { id: 'chain', title: '链式闪电', body: '打一只再跳到旁边那只 —— 越挤越强',
      isNew: true,
      get level() { return hasChain ? chain.jumps - 2 : 0; }, max: 4,
      take: () => { if (hasChain) chain.jumps += 1; else hasChain = true; } },
    { id: 'magnet', title: '吸引', body: '经验从更远的地方飞过来 —— 你能少走几趟险路',
      get level() { return Math.round((magnetBase - WEAPON_BASE.magnet) / 1.3); }, max: 3,
      take: () => { magnetBase += 1.3; gems.magnet = coins.magnet = magnetBase; } },
    { id: 'boots', title: '疾行', body: '跑得快 8% —— 跑是这个游戏唯一的防御',
      get level() { return Math.round((speedMult - 1) / 0.08); }, max: 4,
      take: () => { speedMult += 0.08; applySpeed(); } },
    { id: 'vigor', title: '体魄', body: '血上限 +25，并且补满',
      get level() { return Math.round((hpMax - PLAYER_HP) / 25); }, max: 3,
      take: () => { hpMax += 25; hp = hpMax; } },
  ];
  /** 改移动速度。
   *
   *  **这是一个 SDK 的缺口，写在这里而不是藏起来。** `CharacterController3D`
   *  在构造时吃一个 `speed`，之后没有任何接口能改它 —— 而「跑得更快」是这个
   *  类型最基本的成长项之一（吸血鬼幸存者的翅膀就是它）。合适的修法是 SDK
   *  开一个可写的 `speed`，那要发版，得先问过。
   *
   *  在那之前走内部字段。关键是**够不到就让这个选项根本不出现**，而不是让它
   *  出现了却什么也不做 —— 一个点下去没有变化的升级，比少一个选项坏得多：
   *  玩家会以为自己看错了，然后继续拿它。 */
  const speedField = (character as unknown as { opts?: { speed?: number } }).opts;
  const canSetSpeed = typeof speedField?.speed === 'number';
  const setSpeed = (v: number): void => { if (speedField) speedField.speed = v; };
  /** 把「升级买来的速度」和「道具临时给的速度」乘在一起，写回控制器。
   *
   *  **一处计算，两个来源。** 各自直接写 `speed` 的话，道具结束时把速度「还原」
   *  成 `PLAYER_SPEED` 会顺手抹掉玩家升级买来的那几级 —— 而那种 bug 不报错，
   *  只是玩家某一刻突然变慢了，说不清为什么。 */
  const HASTE = 1.6;
  const applySpeed = (): void => {
    setSpeed(PLAYER_SPEED * speedMult * (buff?.kind.id === 'haste' ? HASTE : 1));
  };
  if (!canSetSpeed) {
    console.warn('[survivor] 控制器没有可写的 speed，「疾行」不进升级池');
    pool.splice(pool.findIndex((o) => o.id === 'boots'), 1);
  }

  const offerThree = (): Offer[] => {
    const live = pool.filter((o) => o.level < o.max);
    const out: Offer[] = [];
    while (out.length < 3 && live.length) {
      out.push(...live.splice(Math.floor(Math.random() * live.length), 1));
    }
    while (out.length < 3) out.push(heal());
    return out;
  };

  // 第一局也走 `resetRun()`。见那个函数的注释：开局和重开共用一段，是为了让
  // 漏掉的字段在第一局就暴露出来，而不是等到玩家重开时才变成一个怪现象。
  resetRun();

  // three.js deprecated Clock, and setAnimationLoop already hands us the
  // timestamp, so there is nothing to replace it with.
  let last = performance.now();
  renderer.setAnimationLoop((now: number) => {
    // Clamped: a backgrounded tab returns with a multi-second delta and
    // everything tunnels through the floor in one step.
    const dt = Math.min((now - last) / 1000, 0.05);
    last = now;
    // 暂停时整个世界停住，只继续画。面板开着的时候还在走的敌人，会让「停下
    // 来选一个」变成「一边选一边被咬」，那就等于没暂停。
    if (paused) { renderer.render(world.scene, world.camera); return; }
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
    // 受击闪光要每帧收尾，否则主角会一直红着。`flashTint` 是按对象克隆材质的
    // （共享材质上改自发光会把场上所有同模型的东西一起染红，这个坑本项目踩过
    // 两次），所以这里传的就是主角自己。
    updateTints([hero]);
    // Save only while STANDING on something. A position saved mid-air restores
    // you mid-air, which turns one fall into a permanently broken save.
    if (Math.hypot(dir.x, dir.z) > 0 && character.grounded) save();

    {
      const p = character.position;
      ground.update(p.x, p.z);

      if (!over) {
        runClock += dt;
        if (runClock >= RUN_SECONDS) endRun(true);

        // 难度全部按时钟读 —— 见 `src/curve.ts`。
        spawnTimer -= dt;
        if (spawnTimer <= 0) {
          spawnTimer = spawnGapAt(runClock);
          // 朝玩家正在跑的方向偏着生成 —— 见 `Swarm.spawn`：不这样的话
          // 「跑」是免费的，加多少怪都只是让身后的尾巴更长。
          const moving = Math.hypot(dir.x, dir.z) > 0.1;
          // 血量同时看**时间**和**玩家等级**：升得快的人遇到的敌人也更硬，
          // 这条自平衡是从吸血鬼幸存者抄来的（`curve.ts` 里写了为什么）。
          swarm.spawn(batchAt(runClock), SPAWN_RING[0], SPAWN_RING[1], p.x, p.z,
            hpAt(runClock) * hpLevelScale(level), speedAt(runClock),
            moving ? Math.atan2(dir.x, dir.z) : undefined);
        }

        eliteTimer -= dt;
        if (eliteTimer <= 0) {
          eliteTimer = ELITE_EVERY;
          elites += 1;
          swarm.spawnElite(SPAWN_RING[0], SPAWN_RING[1], p.x, p.z,
            eliteHp(elites) * hpLevelScale(level), speedAt(runClock) * 0.72);
        }

        // 五把武器。**没拿到的那把连 `update` 都不跑** —— 不是跑了但伤害为 0：
        // 一把"存在但不生效"的武器迟早会因为某个字段没归零而偷偷开火，而那种
        // bug 在一屏几百只敌人里根本看不出来。
        // 「打中」**没有**自己的声音，而这是量出来的：第一版在"这一帧杀掉了
        // 谁"上放 `hit`，同时 `onDeath` 在放 `kill` —— 一次死亡两声。乱战里
        // 每秒 11.1 声，其中一半是这个重复。现在只有追踪弹的命中有声（见
        // `bolt.onHit`），因为它是唯一一把单次命中算一个事件的武器。
        const killsBefore = kills;
        kills += blades.update(dt, p.x, p.z, swarm, now / 1000);
        if (hasTrail) kills += trail.update(dt, p.x, p.z, swarm, now / 1000);
        if (hasBolt) kills += bolt.update(dt, p.x, p.z, swarm, now / 1000);
        if (hasShock) kills += shock.update(dt, p.x, p.z, dir.x, dir.z, swarm, now / 1000);
        if (hasChain) kills += chain.update(dt, p.x, p.z, swarm);
        void killsBefore;

        // 捡经验。够了就升级 —— **`while` 不是 `if`**：清掉一堆精英时一帧内
        // 能跨两级，用 `if` 的话多出来的那一级会被默默吞掉。
        const got = gems.update(dt, p.x, p.z, now / 1000);
        xp += got;
        const picked = coins.update(dt, p.x, p.z, now / 1000);
        // 捡到金币就存 —— `save()` 自己会合并 500ms 内的多次调用，所以一把
        // 金币同时飞进来只写一次。
        if (picked > 0) { gold += picked; runGold += picked; save(); }

        // 箱子。**立刻结算的和持续一段的，是给玩家的两种不同东西**：前者是
        // 一次已经发生完的事，后者是你现在握着、要花掉的一段时间。所以只有
        // 后者戴圈、有倒计时。
        const took = cratesOff ? null : crates.update(dt, p.x, p.z, now / 1000);
        if (took) {
          banner(took.label, took.color);
          audio.play(SFX.levelUp);
          ring(vfx, new THREE.Vector3(p.x, 0.05, p.z),
            { color: took.color, from: 0.6, to: 4.4, life: 0.6 });
          sparks.burst(p.x, 0.6, p.z,
            { count: 30, color: took.color, color2: 0xffffff, speed: 4.2, up: 1.2, life: 0.8 });
          if (took.id === 'wipe') {
            // 一扫而空要**走正常的死亡流程**，不是把数组清掉 —— 掉落、爆裂、
            // 击杀计数、经验全都挂在 `onDeath` 上，绕过它等于一次什么都不给的
            // 清屏，而那是这张表里最像奖励的一项。
            for (let i = swarm.foes.length - 1; i >= 0; i--) {
              if (swarm.hit(i, 1e9)) kills += 1;
            }
          } else if (took.id === 'vacuum') {
            // 把全图掉落一次性吸过来：临时把吸取半径拉到很大，下一帧还原。
            gems.magnet = coins.magnet = 400;
            vacuumLeft = 1.6;
          } else {
            buff = { kind: took, left: BUFF_SECONDS };
            applySpeed();     // `haste` 靠它生效
          }
        }
        if (vacuumLeft > 0) {
          vacuumLeft -= dt;
          if (vacuumLeft <= 0) gems.magnet = coins.magnet = magnetBase;
        }

        // buff 倒计时。
        if (buff) {
          buff.left -= dt;
          if (buff.left <= 0) {
            banner('效果结束', 0xcfd6dd);
            buff = null;
            applySpeed();     // 还原时要带上升级买来的那几级，见 `applySpeed`
          }
        }
        if (got > 0 || picked > 0) audio.play(SFX.gem);
        while (xp >= xpNeed) {
          xp -= xpNeed;
          level += 1;
          xpNeed = xpToNext(level);
          // **排队，不是直接弹。** 一帧内跨两级是常事（清掉一只精英就够了），
          // 而连弹两次的第二次会盖掉第一次 —— 玩家升了两级，只选到一个。
          pendingLevels += 1;
        }
        if (pendingLevels > 0 && !levelUp.open && !levelsOff) {
          pendingLevels -= 1;
          levelUp.show(level - pendingLevels, offerThree());
        }

        // 接触伤害。贴着你的每一只都在扣血。
        if (swarm.touching > 0 && !god && buff?.kind.id !== 'shield') {
          hp -= Math.min(swarm.touching, CONTACT_CAP) * CONTACT_DPS * dt;
          // 挨打要有反馈，而**这是唯一一个玩家在被围着时还看得见的**：血条在
          // 左上角，而屏幕中间全是敌人。所以受伤在脚底下炸一圈红的，就在眼睛
          // 正在看的地方。节流靠声音那边的 420ms，视觉这边按时间自己卡。
          hurtCue -= dt;
          if (hurtCue <= 0) {
            hurtCue = 0.34;
            audio.play(SFX.hurt);
            // **主角整个人闪红。** 这是挨打反馈里唯一一个在玩家眼睛正落着的
            // 地方发生的事 —— 上一版只在脚下炸一圈粒子，而粒子从脚下冒出来
            // 会被主角自己的身体挡住大半，玩家的原话是「被攻击到之后没效果」。
            //
            // 敌人挨打有白光 + 晃 + 退三层，主角挨打却什么都没有，这个不对称
            // 本身就是答案。
            if (!isTinted(hero)) flashTint(hero, { color: 0xff2a18, ms: 240, intensity: 0.85 });
            // 粒子从**胸口高度往外炸**，不是从脚下往上冒：脚下那一圈的下半截
            // 在身体后面，而且和地上的掉落物、尾迹混在一起。
            sparks.burst(p.x, 0.62, p.z,
              { count: 26, color: 0xff7a68, color2: 0xd81414,
                speed: 4.2, up: 0.55, life: 0.5, size: 0.2 });
            // 再补一圈贴地的红环 —— 余光里「我挨打了」比「掉了几点血」重要，
            // 而环是唯一一个不会被身体挡住的形状。
            ring(vfx, new THREE.Vector3(p.x, 0.05, p.z),
              { color: 0xff3a2a, from: 0.5, to: 1.9, life: 0.32, opacity: 0.8 });
          }
          if (hp <= 0) {
            hp = 0;
            ring(vfx, new THREE.Vector3(p.x, 0.05, p.z),
              { color: 0xff4b4b, from: 0.6, to: 6, life: 0.9 });
            endRun(false);
          }
        }
      }

      // `freeze` 就是**把敌群的那一帧 dt 设成 0**：它们不走、不贴身，但照样
      // 挨打、照样死。定住的敌人仍然是靶子，这正是这个道具的用法。
      swarm.update(buff?.kind.id === 'freeze' ? 0 : dt,
                   p.x, p.z, world.camera.quaternion, world.camera);
      // 粒子和特效**不受 `over` 影响**：倒下那一刻的爆炸要放完，不然死亡
      // 反馈自己被死亡掐掉了。
      sparks.update(dt, world.camera.quaternion);
      slashes.update(dt, world.camera.quaternion);
      dmgNums.update(dt, world.camera.quaternion);
      vfx.update(dt);
      readout.set(runClock, kills, swarm.foes.length, hp, level, xp, xpNeed, gold, over);
      // 血条跟着人走。**倒下之后收起来** —— 一条挂在尸体上的空血条是在报告
      // 一个已经结束的状态。
      if (over && hp <= 0) heroBar.hide();
      else heroBar.update(dt, p.x, p.y, p.z, hp, hpMax, world.camera.quaternion);

      // 脚下那个圈：颜色说是哪一个，**闪烁的频率说还剩多久**。最后两秒开始
      // 急闪 —— 「快没了」是个要在余光里收到的信号，不是一个要去读的数字。
      buffRing.visible = !!buff;
      if (buff) {
        buffRing.position.set(p.x, p.y + 0.04, p.z);
        (buffRing.material as THREE.MeshBasicMaterial).color.setHex(buff.kind.color);
        const urgent = buff.left < 2;
        (buffRing.material as THREE.MeshBasicMaterial).opacity =
          urgent ? 0.35 + 0.55 * Math.abs(Math.sin(now / 90)) : 0.85;
      }
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
      /** 五把武器，和反馈层 —— 探针要能单独打开某一把来量它。 */
      weapons: { blades, trail, bolt, shock, chain },
      give: (id: string) => {
        const o = pool.find((x) => x.id === id);
        if (!o) return null;
        o.take();
        return { id, level: o.level };
      },
      /** 掉落物模型的原始尺寸 —— 确认拿到的是哪个模型、朝向对不对。 */
      dropSizes: () => ({ gem: gems.modelSize, coin: coins.modelSize }),
      fx: () => ({ sparks: sparks.live, slashes: slashes.live,
                   nums: dmgNums.live, vfx: vfx.count }),
      /** 真正被画出来的那几个实例化网格 —— 探针要读画面，不读状态。 */
      swarmMeshes: () => swarm.meshes,
      /** 敌人被打退了多少 —— 「稍微退一下」只能量，不能看。 */
      knock: () => swarm.foes.map((f) => Math.hypot(f.kx, f.kz)),
      /** 敌群，和量它的东西。 */
      swarm,
      spawn: (n: number) => swarm.spawn(n, 8, 18, character.position.x, character.position.z, 30, FOE_SPEED),
      /** 一局的状态，探针读它。 */
      /** 箱子和增益 —— 探针读它。 */
      crates: () => crates.list,
      putCrate: (x: number, z: number, id: string) => crates.put(x, z, id),
      buff: () => (buff ? { id: buff.kind.id, left: +buff.left.toFixed(2) } : null),
      buffRingOn: () => buffRing.visible,
      run: () => ({ clock: runClock, kills, level, xp, xpNeed, hp, hpMax, over, paused,
                    alive: swarm.foes.length, gems: gems.count, coins: coins.count,
                    gold, elites, hasTrail, blades: blades.count,
                    magnet: gems.magnet, speedMult }),
      /** 曲线在任意时刻读出来是什么样 —— 不用玩到那儿就能问。 */
      curveAt: (t: number) => ({
        gap: +spawnGapAt(t).toFixed(3), batch: batchAt(t),
        perSec: +(batchAt(t) / spawnGapAt(t)).toFixed(2),
        hp: +hpAt(t).toFixed(1), speed: +speedAt(t).toFixed(2),
      }),
      /** 把时钟拨到某一秒。难度曲线只能这样测 —— 真跑到第十二分钟要十二分钟。 */
      setClock: (t: number) => { runClock = t; },
      giveXp: (n: number) => { xp += n; },
      levelPanel: () => levelUp.open,
      overPanel: () => gameOver.open,
      /** 直接把人打死 —— 探针不用真等十五分钟或者真被围死。 */
      kill: () => { hp = 0; endRun(false); },
      restart: () => resetRun(),
      /** 量单个系统时把三选一按住 —— 它会暂停整局。 */
      setLevelsOff: (on: boolean) => { levelsOff = on; },
      /** 量别的东西时别被打死 —— 见 `god`。 */
      setGod: (on: boolean) => { god = on; },
      /** 量别的东西时别让箱子自己刷出来 —— 见 `cratesOff`。 */
      setCratesOff: (on: boolean) => { cratesOff = on; if (on) crates.clear(); },
      clearFoes: () => swarm.clear(),
      /** 清掉地上的掉落物。**探针必须有这个** —— 「刚掉的那颗在不在」不能靠
       *  总数的增减去推：上一轮留在地上的宝石这会儿正被吸走，一加一减，
       *  刚掉的那颗看起来就像从没存在过。 */
      clearDrops: () => { gems.clear(); coins.clear(); },
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
