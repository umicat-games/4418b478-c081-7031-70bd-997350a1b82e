// 竞技场生成器 —— 从 Balaboo 的 `gen-scene.mjs` 里只搬了竞技场这一半。
//
// 原文件有 1200 行，其中大部分在铺一条塔防的路：折线展开、拐角选瓦片、
// 大门开口、分叉。这个游戏里没有路，所以那些一行都没带过来 —— 把它们搬来
// 再注释掉，等于把一个别的游戏的形状留在这里，下一个读代码的人会以为它有用。
//
// `npm run scene` 生成 `public/scenes3d/main.json`（模板加载的就是这个名字）。

import { writeFileSync } from 'node:fs';

const TILE_TOP = 0.2;          // the tiles' own height
const GROUND_Y = 0;            // walkable surface
const HALF = 5.5;              // outermost cell centre

// ─────────────────────────────────────────────────────────────────────────────
// Themes
//
// The kit ships a snow copy of every terrain piece, so a level's look is one
// table lookup rather than a second set of code. Anything a level places goes
// through here, which is what keeps a new theme from being a rewrite.

const THEMES = {
  grass: {
    sky: '#8fc9e8', skirt: '#3f6b38', wall: '#4a4036', ground: '#8fa08a',
    sun: '#fff6e0', sunIntensity: 2.2, skyIntensity: 2.0,
    tile: 'td-tile', straight: 'td-tile-straight', dirt: 'td-tile-dirt',
    spawn: 'td-tile-spawn', end: 'td-tile-end',
    // Scenery baked into a tile — a tree standing on its own patch of ground.
    // Cheaper than a tile plus a prop, and it lines up by construction.
    scenery: ['td-tile-tree', 'td-tile-tree-double', 'td-tile-tree-quad',
              'td-tile-rock', 'td-tile-crystal', 'td-tile-hill', 'td-tile-bump'],
    props: ['td-detail-tree-large', 'td-detail-rocks-large', 'td-detail-crystal-large',
            'td-wood-structure', 'td-wood-structure-high', 'td-detail-dirt-large'],
    portal: 'td-spawn-round',
    river: {
      straight: 'td-tile-river-straight',
      bridge: 'td-tile-river-bridge',
    },
  },
  snow: {
    sky: '#c8dcea', skirt: '#9fb3c4', wall: '#5b5a58', ground: '#c6d4e0',
    sun: '#eaf2ff', sunIntensity: 1.9, skyIntensity: 2.3,
    tile: 'td-snow-tile', straight: 'td-snow-tile-straight', dirt: 'td-snow-tile-dirt',
    spawn: 'td-snow-tile-spawn', end: 'td-snow-tile-end',
    scenery: ['td-snow-tile-tree', 'td-snow-tile-tree-double', 'td-snow-tile-tree-quad',
              'td-snow-tile-rock', 'td-snow-tile-crystal', 'td-snow-tile-hill',
              'td-snow-tile-bump'],
    props: ['td-snow-detail-tree-large', 'td-snow-detail-rocks-large',
            'td-snow-detail-crystal-large', 'td-snow-wood-structure',
            'td-snow-wood-structure-high', 'td-snow-detail-dirt-large'],
    portal: 'td-spawn-square',
    river: {
      straight: 'td-snow-tile-river-straight',
      bridge: 'td-snow-tile-river-bridge',
    },
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// The levels
//
// Each is a trunk polyline plus a branch to each gate. A board with TWO
// branches forks: a single lane can be sealed with four good towers and the
// rest of the map is decoration, and with two the question becomes which half
// you can afford to leave thin.
//
// **The first two boards do not fork.** Every board used to, including the
// first one anybody plays — so the game's second-hardest idea arrived before
// its first one had been explained. Each board now introduces exactly one new
// thing: Meadow is the tutorial and has a single lane, Frostfall adds ice and
// keeps the single lane, Rivermeet adds the fork, and Crossroads puts the fork
// on OPPOSITE walls, which is the hardest version of it.
//
// `gates` says which WALL each branch ends at, because the fork does not have
// to be left-and-right.


/** A repeatable shuffle, so a board looks the same every time it is generated.
 *  Scenery placed with `Math.random()` moves on every `npm run scene`, which
 *  makes yesterday's screenshot a lie. */
function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/** A quaternion, as the ARRAY the schema wants — an {x,y,z,w} object here is
 *  rejected at load, loudly and by name, which is the loader working. */
const yaw = (a) => [0, Math.sin(a / 2), 0, Math.cos(a / 2)];

/** Yaw that points a tile's +Z along this direction. */
const dirYaw = (d) => Math.atan2(d[0], d[1]);
const dirTo = (a, b) => [Math.sign(b[0] - a[0]), Math.sign(b[1] - a[1])];
const key = (c) => `${c[0]},${c[1]}`;

/** Which model and which way round, from a cell's PATH NEIGHBOURS.
 *
 *  Neighbour counting rather than "the direction in and the direction out",
 *  which cannot describe a fork: that cell has one way in and two ways out. It
 *  also reads off the finished board rather than off the order someone walked
 *  it.
 *
 *  Corners AND forks get a full dirt tile, which is path on all four edges and
 *  therefore cannot be rotated wrong. The kit's corner tile joins two specific
 *  edges and every bend was visibly broken until I stopped trying to get its
 *  lookup table right. Deleting a class of bug beat winning it. */
function tileFor(theme, cell, neighbours, isSpawn, isEnd) {
  const t = THEMES[theme];
  if (isSpawn) return { model: t.spawn, rot: yaw(dirYaw(dirTo(cell, neighbours[0]))) };
  // The end tile's stub faces BACK the way the road came: pointing it along the
  // direction of travel puts the join on the far edge and leaves a cell of bare
  // ground right before the gate.
  if (isEnd) return { model: t.end, rot: yaw(dirYaw(dirTo(cell, neighbours[0])) + Math.PI) };
  if (neighbours.length === 2) {
    const a = dirTo(cell, neighbours[0]), b = dirTo(cell, neighbours[1]);
    if (a[0] === -b[0] && a[1] === -b[1]) return { model: t.straight, rot: yaw(dirYaw(a)) };
  }
  return { model: t.dirt, rot: yaw(0) };
}

/** The arena.
 *
 *  Not a board in the tower-defense sense: there is no road, because nothing
 *  follows one. Enemies come in over the tree line on a straight line and
 *  leave over the other side, so every cell is a place the fight can happen
 *  and none of them is a lane.
 *
 *  **Nothing inside the air wall has a collider.** The whole game is walking
 *  out of the way of a bullet, and a tree at the edge of the field is a snag
 *  at exactly the moment a snag costs the most. `buildLevel` scatters scenery
 *  on the outer ring because a tower-defense hero walks between build spots at
 *  their own pace; this one is running. Everything with a trunk on it lives
 *  OUTSIDE the wall, where it is scenery and cannot be bumped into.
 */
function buildArena(def) {
  const t = THEMES[def.theme];
  const entities = [];
  const add = (e) => entities.push(e);

  // 这个场景**不再包含地面**。
  //
  // 地是 `src/ground.ts` 在运行时铺的，无限、跟着玩家、一次绘制。原来这里
  // 生成 2568 个实体（225 块地砖 + 1000 块外圈 + 1342 棵树）和四面空气墙 ——
  // 墙和这个类型的核心动作直接冲突（唯一的防御是跑，有墙就意味着被逼到角落
  // 必死，而且不是玩家判断失误，是地图不让他执行那个唯一的答案）。
  //
  // 留下来的只有三样：光、天空、和主角。它们是无限地图上仍然成立的东西。

  // 一块很薄、很大的碰撞地板。看不见 —— 看得见的地是实例化铺的那层 ——
  // 它在这里只为了给角色控制器一个站的地方。
  //
  // 它有多大就限制了玩家能跑多远：400 格边长，按角色速度约四分钟跑到头，
  // 而一局只有 15 分钟且玩家是被追着绕圈的，不是直线逃跑。真要彻底无限，
  // 这块板子也要跟着玩家移动 —— 那是下一步，不是现在。
  add({
    id: 'ground', name: 'ground',
    primitive: { kind: 'box', size: { x: 400, y: 0.4, z: 400 }, color: t.skirt },
    visible: false,
    transform: { position: { x: 0, y: GROUND_Y - 0.4, z: 0 } },
    castShadow: false,
    collider: {
      shape: { kind: 'box', halfExtents: { x: 200, y: 0.3, z: 200 } },
      body: 'fixed', offset: { x: 0, y: 0.1, z: 0 },
    },
  });

  add({
    id: 'hero', name: 'hero', modelAssetId: 'hero',
    transform: { position: { x: 0, y: GROUND_Y, z: 0 } },
    // 声明一个起始 clip 才会创建 mixer，没有 mixer 的角色会一动不动地滑行 ——
    // 而且不报错。
    animation: { play: 'idle', loop: true },
  });

  return {
    schemaVersion: 1,
    id: def.id,
    name: def.name,
    environment: { background: t.sky },
    gravity: { x: 0, y: -4.1692, z: 0 },
    lights: [
      { id: 'sky', kind: 'hemisphere', color: '#ffffff', groundColor: t.ground,
        intensity: t.skyIntensity },
      { id: 'sun', kind: 'directional', color: t.sun, intensity: t.sunIntensity,
        position: { x: 4, y: 8, z: 5 }, castShadow: true },
    ],
    // 相机由游戏代码摆位（`CAM` in main.ts）。这里的值只是个起始姿态。
    camera: { kind: 'follow', target: 'hero', fov: 55, offset: { x: 0, y: 6.3, z: 7.8 } },
    entities,
  };
}

const ARENA = {
  id: 'main',
  name: 'The Clearing',
  theme: 'grass',
  // 幸存者类要的是一块能绕圈跑的空地。先给一个方形，之后按相机和敌人密度调。
};

const scene = buildArena(ARENA);
writeFileSync(new URL('../public/scenes3d/main.json', import.meta.url),
  JSON.stringify(scene, null, 2) + '\n');
console.log(`arena: ${scene.entities.length} entities`);
