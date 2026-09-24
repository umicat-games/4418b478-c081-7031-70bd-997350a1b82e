# Umicat 3D game

A three.js game on the Umicat platform. This file is what the agent reads first.

## Where things are

| | |
|---|---|
| `src/main.ts` | the whole game loop — start here |
| `src/config.ts` | the design canvas + `ORIENTATION` (set at game creation; do not change it) |
| `public/scenes3d/main.json` | **the scene** — entities, lights, colliders, camera |
| `public/scenes3d/manifest.json` | models, their import scale, and their **animation map** |
| `public/assets/` | `.glb` models, textures, audio |

## The two halves, and why the split matters

**Platform** — `umicat.saves`, `umicat.gameData`, `umicat.rooms`, `umicat.ai`,
`umicat.voice`, `umicat.dialogue`, `umicat.user`. Identical to what a 2D Umicat
game gets, because it is the same package underneath
(`@umicat/platform-sdk`). None of it knows anything is being drawn.

**Engine** — `loadScene3D`, `CharacterController3D`, `Input3D`, three.js and
Rapier. This is the part that differs from a 2D game.

When something goes wrong, knowing which half you are in usually names the bug.

## The scene format

`scenes3d/main.json` is **design data**: what the game looks like before anyone
plays it. No save is loaded when it is read. Rules that are decisions, not
accidents:

- **Rotation is a quaternion** `[x, y, z, w]`, never Euler angles.
- **Ids are authored and stable.** Saves and code refer to entities by id.
- **Transforms are local to `parent`.** World transforms are derived.
- **Colliders are explicit.** Never use a render mesh as a dynamic collider —
  that is the classic way to make a game that is correct and unplayably slow.
- **Animation clips are mapped by meaning** in the manifest
  (`{ "walk": "Walk" }`), never guessed from the clip's name.

`loadScene3D` refuses duplicate ids, dangling parents, entities that would draw
nothing, and trimesh colliders on dynamic bodies — at load, because every one of
them otherwise shows up as a blank screen an hour later.

## 从 Balaboo 搬过来的东西（以及没搬的）

这个游戏是**新建的**，不是 fork —— 所以下面这些是手工搬过来的，不是继承来的。
每一样都有它被选中的理由，而理由基本都是同一个：**幸存者类的瓶颈是每帧提交
多少次绘制，不是三角形数量**。

| 搬了 | 为什么 |
|---|---|
| `src/vfx.ts` | 特效库。关键不在特效多好看，在于 `motes()` 是**一次实例化绘制画任意多个**，`quads()` 是**一个 mesh 画任意多个四边形** —— 这两个正是敌人和血条将来要走的路 |
| `src/merge.ts` | 把上千个静态场景对象折成几个 mesh。一块 2574 实体的空地不这么做就没法跑 |
| `src/audio.ts` + `public/audio/` | 带 throttle 的 clip 表。见下 |
| `src/hud.ts` `src/buttons.ts` `src/icons.ts` `src/sky.ts` | 读数板、按钮浮雕、图标、画进背景的天空 |
| `public/kit/td/` | 敌人（飞碟）和地块。模板只带 platformer kit，里面没有能当敌人的东西 |
| `tools/gen-arena.mjs` | 竞技场生成器 |

**没搬的**：武器表、关卡表、村庄、商店、教程、瞄准、塔的一切。那是另一个
游戏的形状；把它们搬来再注释掉，下一个读代码的人会以为它有用。

`tools/gen-arena.mjs` 只是原 `gen-scene.mjs` 的竞技场那一半。原文件 1200 行，
大部分在铺一条塔防的路（折线展开、拐角选瓦片、大门开口、分叉），这里一行没带。

## 敌群：实例化，量过的

`src/swarm.ts`。两种画法都在里面，`__game.setMode()` 当场切 —— **因为它们要在
同一块板子上比**。拿另一个游戏的旧数字和这里比，比的是两个场景。

同一块板子、同一批敌人、树已关掉（合批后树只有 3 次绘制，但仍是 26.7 万三角
形，会把敌人自己的几何量淹没 —— 实测 274k → 6.8k）：

| 画法 | 敌人 | draw calls | 三角形 | ms/帧 |
|---|---|---|---|---|
| — | 0 | 5 | 7k | 23 |
| 克隆 | 100 | 181 | 39k | 39 |
| 克隆 | 400 | **704** | 132k | 87 |
| 实例化 | 100 | 8 | 38k | 40 |
| 实例化 | 400 | **8** | 134k | 84 |

**每只敌人 1.75 次绘制 → 0.007 次。** 400 只的总绘制回到「空场」的水平。

（ms/帧 是无头**软件渲染器**的数字，绝对值没有意义 —— 那里的成本在三角形不在
提交次数。它在这里只用来确认实例化没有把 CPU 侧搞砸；真正的收益要在有 GPU 的
设备上才看得到。）

### 三件不是白拿的事

**受击闪光不能再克隆材质。** 只有一份材质，改它等于全场变红 —— 这个项目被这个
坑咬过两次（`flashTint` 一次染红五只、淡出诊所连带淡出兵工厂）。走
`instanceColor`，每实例一个颜色。

**视锥剔除要自己做，而且这一步差点被漏掉。** `InstancedMesh` 的包围球来自基准
几何体，实例散布在整张图上，所以 three 的剔除必须关 —— 不关它会在你还看得见
的时候整群消失。但**关掉不等于不做**：第一版就是这样，屏幕外的敌人照画，400 只
多出 65% 的三角形（132k → 216k），在软件渲染器里实例化反而更慢（87ms → 112ms）。
现在每帧在 CPU 侧把可见的排到前面、`count` 只数到它们，三角形回到 ×1.01。

**血条的朝向每帧只算一次。** 克隆那条路是每只做一次四元数求逆，400 只就是 400
次；实例化把相机朝向直接烘进实例矩阵。

### 测量本身踩的两个坑

**忘了调 `mergeStatic`，空场就是 1618 次绘制。** 一块 2574 实体的空地，一棵树
一次。它不报错、画面也对，只是把整关预算在第一帧花光，而且大到足以淹没任何
关于敌人的测量。

**部署完立刻跑探针，量到的是上一个 bundle。** CDN 失效要一会儿。出现「这个改动
明明生效了但探针说没有」时，先确认量的是哪一版。

## 量过的两件事

**敌人是按只算绘制的，这是要改的那件事。** 在 Balaboo 的分支上实测：

| 敌人数 | draw calls | 三角形 |
|---|---|---|
| 0 | 11 | 358k |
| 100 | 283 | 441k |
| 400 | **1161** | 688k |

**每只 2.88 个 draw call**（本体 1 个 + 血条 2 个），825 个三角形。三角形不是
问题；draw call 是 —— 一整关的预算是 ~20 个。

飞碟是 **1 mesh、0 蒙皮、0 动画**的静态网格，所以可以直接上 `InstancedMesh`：
一份几何 + 一份材质 + N 个矩阵 = **1 个 draw call**。血条走 `quads()`。按这个
改完 400 只应该回到十几个 draw call。

跟着要改的三处：受击闪光现在靠**克隆材质**改自发光，实例化后只有一份材质，
得换成 `instanceColor`；boss 若是蒙皮网格不能实例化（单独画）；每帧对每只敌人
做四元数运算的血条朝向要并进 `quads()` 一次性重建。

**音效不是瓶颈，前提是每个 clip 都有 throttle。** 实测「一次性杀死全场」：

| 同时死亡 | 实际播放的音效 |
|---|---|
| 25 | 1 |
| 100 | 1 |
| 400 | **1** |

`enemy-die` 的 `throttle: 40` 就把它挡住了。`GameAudio` 每次 `play()` 建一个
`BufferSource` + 一个 `GainNode`，**除了按 clip 的节流之外没有任何总量上限** ——
所以在这个类型里，**一个没有 throttle 的 clip 就是 bug**。真正的历史杀手是
`HTMLAudioElement`（iPhone 上 11fps，静音 60fps），而 `GameAudio` 已经绕开了。

## 搬相机时踩的坑

搬过来的生成器原本声明 `kind: 'fixed'` —— 那是 Balaboo 分支的用法，相机由游戏
代码里的 `fitCamera()` 摆位并对准。模板里没有那段代码，于是相机停在偏移点上
平视前方，拍到的全是天：**没有报错、没有 404、canvas 也在**，就是什么都没有。

这是本文件下面「Things that will bite」里说的那种失败的标准形状。现在生成的是
跟随相机 —— 幸存者类绕着场地跑，相机跟着人本来就对。

## Building

```bash
npm run dev      # local dev server
npm run build    # what the platform runs
```

## Things that will bite

**A `SkinnedMesh`'s bounding sphere comes from the bind pose** and does not
follow its bones, so three.js culls a character against a stale volume and it
vanishes the moment it moves. `loadScene3D` already sets `frustumCulled = false`
on skinned meshes; if you add a character by hand, do the same.

**An action is a one-shot, not a state.** The character ships 32 clips —
`attack`, `kick`, `pick-up`, `interact`, `holding-*` (including shooting),
`die`, `emote-yes/no` — and `CharacterAnimator.play('attack')` runs one once and
hands control back. Gate on `animator.busy` so one press is one swing, and use
an edge check if you do not want holding the key to chain them. Locomotion keeps
following `character.state` underneath.

**Use the prop kit before you draw scenery out of boxes.** `public/kit/` ships
86 real models with a catalogue at `public/kit/index.json`. A coloured box named
`crystal` is still a box, and a scene of them reads as a prototype.

**The world's unit is Kenney's, not the metre.** A character is 0.72 units tall,
so ~4,700 CC0 props drop in at `importScale: 1`. Anything length-shaped you add —
sizes, positions, collider extents, camera offsets, speeds, **and gravity** —
lives in that unit. See ASSETS.md. The character takes its gravity from the
world's, so there is one gravity in the scene and not two; the scene's own
`gravity` in `main.json` is where it is set.

**Rotate geometry, not objects, when orienting a primitive.** An object's
rotation is overwritten by the entity's authored transform. Getting this wrong
once left every "ground" standing upright as a wall, which renders convincingly
until the camera crosses to the other side.

**Jump and the on-screen controls belong to the SDK, not to your game.**
`update(dt, dir, { jump })` takes the button's current state; coyote time,
input buffering and the release-cut live in `CharacterController3D` because
every 3D game shares this character (ADR-034). `Input3D` adds a thumbstick and
jump button on touch devices and merges them into the same `direction()` and
`jump`, so nothing here branches on input source.

**A jump is a range, not a number — author platforms against the SHORT one.**
Releasing the button early cuts the jump deliberately, so this character clears
`character.maxJumpRise` held and only `character.minJumpRise` tapped — roughly a
fifth as far. Read those off the controller rather than deriving them; a course
laid out against the held height has a first step that tapping players cannot
clear, and that reads as "the platform up there is unreachable", not as a bug.
Leave headroom on top: both numbers are ballistics, and a real jump is stepped
at frame rate.

**The thumbstick is invisible until a thumb lands on the left half of the
screen, and then it is exactly there.** That is the default; `stick: 'fixed'`
brings back an always-drawn pad at the bottom left. Nothing in a game changes
either way — `direction()` reads the same.

**The right half of the screen turns the camera, and the stick follows it.**
On desktop the same `look()` is fed by holding the RIGHT mouse button and
dragging — the left button stays the game's, for selecting and aiming.
`input.look()` returns a delta and clears on read; hand it to `world.orbit()`,
then pass `world.cameraYaw` to `input.direction()`. Those two go together: a
camera that turns while movement stays on world axes is worse than a camera
that cannot turn, because the player looks at something, pushes towards it, and
walks somewhere else. Read the look BEFORE moving, or every turn lags a frame.

**What the platform has already taken, and what is left for you.** The controls
are shared between the SDK and your game, and the SDK went first — so before
wiring an input, check it is still free:

| | Taken by the platform | Yours |
|---|---|---|
| Touch | left half (thumbstick), right half (camera), the button cluster bottom-right | extra buttons, via `actions` |
| Mouse | **right button + drag** (camera), and the context menu | **left button** |
| Keys | `WASD` / arrows, `Space` | everything else |
| Layers | a full-screen control layer at **`z-index: 10`**, kept clear of the top `max(64px, 12%)` | anything above or below it; `#hud` is already at 20 |

**Any dialog you put up must call `input.setEnabled(false)`.** The controls are
a full-screen layer above your DOM, so a button in a modal renders perfectly
and cannot be pressed — the taps go to the move zone behind it. Disabling also
stops the character walking behind the dialog, and clears what was held so a
thumb mid-push does not resume when it closes. Re-enable when the dialog goes.
Give the dialog a `z-index` above 10 as well, so it is visible over the layer
while it is still fading out.

The one that bites: **do not wire an action to "the mouse went down."** The
right button is the camera now, so a game that attacks on any pointerdown
swings every time the player turns round to look at something — and it looks
like a combat bug, not an input one. Check `e.button === 0`. Check
`e.pointerType !== 'touch'` too, or a phone fires both your handler and the
on-screen button and you get two swings per tap.

Text selection and the iOS long-press callout are already suppressed page-wide,
with form fields exempted — you do not need to repeat it, and you should not
blanket `user-select: none` yourself, because that is what breaks typing in a
name field.

**Declare action buttons; never mount your own.**
`new Input3D({ actions: [{ id: 'attack', label: '⚔', keys: ['KeyJ'] }] })`, then
`input.consume('attack')` for one-press-one-action or `input.held('attack')` for
hold-to-act. A game that builds its own button cannot know where the platform's
jump button is, and the first one to try landed exactly on top of it: same
corner, platform layer above, so on a phone the attack button could not be
pressed at all — and it mounted perfectly, with no error. `consume` also catches
a tap that starts and ends between two frames, which a state comparison against
last frame cannot see.

**Never write `hud.textContent`.** It wipes every child the HUD has. Append a
child element instead. The platform's touch controls mount to `<body>` for
exactly this reason, but anything YOU put in the HUD is still yours to lose.

**A camera limit that is an angle is usually meant to be a distance.** The
follow camera's pitch floor is expressed as "stay this far above what you are
looking at", not as a number of radians — at an orbit radius of 5.4 a −0.25rad
floor puts the camera almost a unit underground, because how low an angle takes
you depends on how far out you are.

**Animate from `character.state`, not from input.** `idle`/`walk`/`jump`/`fall`
describe what the character is doing; a clip chosen from the key that is held
leaves it walking in mid-air.

**Gravity is an acceleration, not a displacement.** Feeding a character
controller a constant downward offset each frame passes a wall test and fails a
step test. `CharacterController3D` already handles this.

**A character that moves is not a character that is animating.**
`CharacterAnimator` now owns this — it follows `character.state` and cross-fades
— but the failure is worth knowing, because it is what a test misses rather than
what it catches: before the animator existed, the character slid around playing
its idle clip, and a test asking "are bones moving?" said yes, because idle moves
bones too. If you ever drive the mixer yourself, the question to ask is *which*
clip is playing, never *whether* something is.

**Feedback beats numbers.** `flashTint(object, { color, ms })` plus
`updateTints(objects)` once a frame is the hit flash. It is in the SDK for one
reason worth knowing even if you never call it: `gltf.scene.clone(true)` SHARES
MATERIALS, so tinting one of five cloned enemies turns all five red — a
graphics bug wearing a gameplay bug's clothes. `flashTint` clones per object.

**Sound goes through `GameAudio`, never through `<audio>`.**
```ts
const audio = new GameAudio({
  clips: { coin: { volume: 0.5, throttle: 40 }, hit: { volume: 0.4 } },
  music: 'bgm',                       // public/audio/bgm.ogg
});
audio.play('coin');
```
`HTMLAudioElement` is the trap: iOS gives each one a real audio pipeline, caps
how many may exist, and charges for every `play()`. A game pooling forty of them
ran at **11fps on an iPhone and a locked 60 with sound muted** — and a desktop
A/B showed no difference at all, which is why this belongs to the platform
rather than to whoever is unlucky. The gesture unlock, the asynchronous
`resume()`, and iOS suspending the context when the app goes away are all
handled; `audio.play()` before the first tap is simply a no-op.

**UI is DOM.** There is no reason to draw a score with triangles on the web;
`index.html` has a `#hud` div for exactly this.

**The editor's screenshot/record buttons need three specific lines you did not
write for gameplay reasons.** `new THREE.WebGLRenderer({ canvas, antialias:
true, preserveDrawingBuffer: true })` plus `setupScreenshotListener(renderer)`
and `setupRecordingListener(renderer)` right after — drop any of the three
("cleaning up" renderer construction is the usual way this happens) and the
Game Editor's Capture menu goes back to silently doing nothing on this game,
same as every 3D game before 0.16.0. `preserveDrawingBuffer` is what actually
matters for screenshots — without it `canvas.toDataURL()` can come back
blank depending on exactly when the browser clears the drawing buffer.

**The Game Editor's "Edit" tab now works on this game too (0.17.0 /
`EditorDesignPlayer3D`).** Same reason renderer construction can't move: the
platform boots this game with `?umicatEdit=1` on the URL when the user opens
Edit, and `main.ts` checks for it **right after `canvas`/`renderer` exist, before
`RAPIER.init()`** — `if (params.has('umicatEdit')) { await
runEditorDesignPlayer3D(renderer, {...}); return; }`. That call takes over the
renderer's animation loop for the rest of the page's life and renders ONLY the
scene named by `?umicatScene=<id>` (a filename under `scenes3d/`, chosen by
the platform's scene list — never guessed here) — no physics, no character, no
save, same "authored design data only" rule the scene JSON format itself
already follows. **Don't move this branch below `RAPIER.init()` or the scene
fetch** — Edit mode must never pay for or trigger either. Mirrors 2D's
`?umicatEdit=1` (ADR-021); the 3D SDK has no central game-boot wrapper the way
`createUmicatGame` is for Phaser, so every 3D game's own `main.ts` has to carry
this branch by hand, same as the screenshot/recording lines above it.
