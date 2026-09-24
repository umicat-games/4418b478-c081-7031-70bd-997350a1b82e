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
  const rand = rng(def.scenerySeed);
  // The arena is SMALLER than a tower-defense board, and has its own half-size
  // rather than borrowing the module's `HALF`.
  //
  // A tower defense board is big because the road has to be long: road length
  // is how much time a gun gets with what walks past it. Nothing walks a road
  // here. What the size decides instead is how long it takes to get out of the
  // way of something, and at 5.5 the far corner was four seconds away — long
  // enough that half the board was somewhere nothing was ever happening.
  // The playfield is a RECTANGLE, wider than it is deep.
  //
  // It was square, inherited from boards that were square because a road had
  // to wander around inside them. Nothing wanders here, and the screen this is
  // played on is landscape — so a square board is a board whose left and right
  // thirds are trees, and those thirds are paid for in ZOOM: the camera has to
  // sit back far enough to fit the width it is not using, and everything on
  // the board gets smaller for it.
  //
  // Matching the board's shape to the screen's is most of what makes the
  // pieces readable on a phone. It also takes the tree line off the sides,
  // where it was eating a third of the frame.
  const HX = def.half.x;
  const HZ = def.half.z;
  const WALL_X = HX + 1.1;   // same relation the generated boards use
  const WALL_Z = HZ + 1.1;
  const GROUND_X = 2 * HX + 2;
  const GROUND_Z = 2 * HZ + 2;

  // The floor of the playable field — invisible, here for its collider. Same
  // as every board: the tiles ARE the ground, with one box underneath them.
  add({
    id: 'ground', name: 'ground',
    primitive: { kind: 'box', size: { x: GROUND_X, y: 0.4, z: GROUND_Z }, color: t.skirt },
    visible: false,
    transform: { position: { x: 0, y: GROUND_Y - 0.4, z: 0 } },
    castShadow: false,
    collider: {
      shape: { kind: 'box', halfExtents: { x: GROUND_X / 2, y: 0.3, z: GROUND_Z / 2 } },
      body: 'fixed', offset: { x: 0, y: 0.1, z: 0 },
    },
  });

  // The field. Plain tiles, every cell, rotated at random so the texture does
  // not tile visibly. No scenery: see the note above.
  for (let gx = -HX; gx <= HX; gx += 1) {
    for (let gz = -HZ; gz <= HZ; gz += 1) {
      add({
        id: `ground_${gx}_${gz}`.replace(/[.-]/g, '_'), name: 'ground_tile',
        modelAssetId: t.tile,
        transform: {
          position: { x: gx, y: GROUND_Y - TILE_TOP, z: gz },
          rotation: yaw(Math.floor(rand() * 4) * (Math.PI / 2)),
        },
        castShadow: false,
      });
    }
  }

  // The forest, and the ground it stands on — the same treatment every board
  // gets, minus the openings. There is no door in this one: a run ends when the
  // health bar does, so a gap in the tree line would be a way out that is not
  // there.
  // The forest has to reach past the widest screen the fixed camera can show.
  //
  // The camera fits the BOARD to the viewport's height, so a wide screen shows
  // more to the left and right — which is the whole point, that is where the
  // trees go — and a very wide one shows a lot more. At 21:9 the visible
  // half-width at the board's depth is about `field × 2.3`, and past the
  // board's far edge it is wider still. Seven rings was enough for a camera
  // that sat close behind the hero and is not enough for this one: the ground
  // simply stopped, with sky under it.
  //
  // It is not free — this is the outermost ring of a 33×33 field of tiles —
  // but almost all of it is `forest_far`, which is the group the cheap picture
  // setting drops, and none of it is in the shadow pass.
  const FOREST_OUT = def.forest ?? 14;
  const OUTER_X = HX + FOREST_OUT;
  const OUTER_Z = HZ + FOREST_OUT;
  add({
    id: 'ground_skirt', name: 'ground_skirt',
    primitive: { kind: 'box', size: { x: 2 * OUTER_X + 1, y: 0.4, z: 2 * OUTER_Z + 1 }, color: t.skirt },
    transform: { position: { x: 0, y: GROUND_Y - 0.4, z: 0 } },
    castShadow: false,
  });
  for (let gx = -OUTER_X; gx <= OUTER_X; gx += 1) {
    for (let gz = -OUTER_Z; gz <= OUTER_Z; gz += 1) {
      if (Math.abs(gx) <= HX && Math.abs(gz) <= HZ) continue;
      add({
        id: `outer_${gx}_${gz}`.replace(/[.-]/g, '_'), name: 'forest_ground',
        modelAssetId: t.tile,
        transform: {
          position: { x: gx, y: GROUND_Y - TILE_TOP, z: gz },
          rotation: yaw(Math.floor(rand() * 4) * (Math.PI / 2)),
        },
        castShadow: false,
      });
      const depth = Math.max(Math.abs(gx) - HX, Math.abs(gz) - HZ);
      const chance = Math.min(0.96, 0.72 + depth * 0.05);
      const r = rand();
      const n = r < chance ? (r < chance * 0.45 ? 2 : 1) : 0;
      for (let k = 0; k < n; k++) {
        add({
          id: `forest_${gx}_${gz}_${k}`.replace(/[.-]/g, '_'),
          // `forest_far` is what the picture-quality toggle drops. The
          // outermost ring keeps its own name and always stays: it is what
          // hides the edge of the ground against the sky.
          name: depth >= 4 && depth < FOREST_OUT ? 'forest_far' : 'forest',
          modelAssetId: rand() < 0.22 ? t.props[1] : t.props[0],
          transform: {
            position: {
              x: gx + (rand() - 0.5) * 0.75,
              y: GROUND_Y,
              z: gz + (rand() - 0.5) * 0.75,
            },
            rotation: yaw(rand() * Math.PI * 2),
          },
          castShadow: false,
        });
      }
    }
  }

  // The air wall, unbroken on all four sides. The hero is held inside ±6.6;
  // the enemies fly, and were never touching it.
  for (const side of ['n', 's', 'w', 'e']) {
    const along = side === 'n' || side === 's' ? 'x' : 'z';
    const fixed = side === 'n' || side === 'w'
      ? -(along === 'x' ? WALL_Z : WALL_X) : (along === 'x' ? WALL_Z : WALL_X);
    const len = 2 * (along === 'x' ? WALL_X : WALL_Z) + 0.2;
    add({
      id: `wall_${side}`, name: `wall_${side}`,
      primitive: {
        kind: 'box',
        size: along === 'x' ? { x: len, y: 1.6, z: 0.4 } : { x: 0.4, y: 1.6, z: len },
        color: t.wall,
      },
      visible: false,
      transform: {
        position: along === 'x' ? { x: 0, y: 0.6, z: fixed } : { x: fixed, y: 0.6, z: 0 },
      },
      collider: {
        shape: {
          kind: 'box',
          halfExtents: along === 'x'
            ? { x: len / 2, y: 0.8, z: 0.2 } : { x: 0.2, y: 0.8, z: len / 2 },
        },
        body: 'fixed',
      },
    });
  }

  // Dead centre, because every side is a side they can come from. A hero who
  // starts against one wall starts with a quarter of the board behind them.
  add({
    id: 'hero', name: 'hero', modelAssetId: 'hero',
    transform: { position: { x: 0, y: GROUND_Y, z: 0 } },
    // Declaring a starting clip is what creates the MIXER, and without one
    // there is no CharacterAnimator and the hero never moves a limb.
    animation: { play: 'idle', loop: true },
  });

  return {
    schemaVersion: 1,
    id: def.id,
    name: def.name,
    /** How big the board is, written down ONCE and read by the game.
     *
     *  The alternative is the same constant in two files that must be kept in
     *  step by hand, which this project already has one of (`LAND`) and has
     *  the scars to prove it. `field` is where the air wall stands — what the
     *  hero is held inside — and `outside` is where enemies are made and
     *  where they are gone, comfortably past anything the camera shows. */
    arena: { field: { x: WALL_X, z: WALL_Z }, outside: Math.max(WALL_X, WALL_Z) + 2.0 },
    environment: { background: t.sky },
    gravity: { x: 0, y: -4.1692, z: 0 },
    lights: [
      { id: 'sky', kind: 'hemisphere', color: '#ffffff', groundColor: t.ground,
        intensity: t.skyIntensity },
      { id: 'sun', kind: 'directional', color: t.sun, intensity: t.sunIntensity,
        position: { x: 4, y: 8, z: 5 }, castShadow: true },
    ],
    // FIXED, and the game places it.
    //
    // A follow camera is right for a board you walk around and wrong for one
    // that IS the screen: it moves, so the edges of the world drift in and out
    // of frame, and it can be turned, so "left" stops meaning left. Here the
    // whole board is visible at all times and the player is a thing inside a
    // frame, which is what makes a bullet's line readable before it arrives.
    //
    // **A LONG LENS.** 32°, not the 50 a third-person camera wants.
    //
    // A rectangle seen at an angle projects as a TRAPEZOID — near edge wide,
    // far edge narrow — and a trapezoid cannot fill a rectangular screen. The
    // gap is the tree line, and at 50° it was most of the top of the frame.
    // Narrowing the lens and moving the camera back keeps the board the same
    // size on screen while flattening the perspective, so the far edge comes
    // out nearly as wide as the near one and the board fills the frame instead
    // of tapering away from it.
    //
    // The offset below is only a sensible default — where the camera would sit
    // on a square viewport. `fitCamera` in `main.ts` replaces it on load and on
    // every resize, because where it BELONGS depends on the aspect ratio, and
    // the generator has no idea what screen this will be played on.
    // 跟随相机，俯视。
    //
    // 搬过来时这里是 `kind: 'fixed'` —— 那是 Balaboo 分支的用法，它的相机由
    // 游戏代码里的 `fitCamera()` 摆位并对准。模板里没有那段代码，于是相机停
    // 在偏移点上平视前方，拍到的全是天：**没有报错、没有 404、canvas 也在**，
    // 就是什么都没有。这是本项目文档里说的「一小时后才发现的黑屏」的标准形状。
    //
    // 幸存者类是绕着一大片场地跑，相机跟着人走本来就是对的；等玩法定型后
    // 若要改成固定取景，那时再连着 `fitCamera` 一起搬。
    camera: { kind: 'follow', target: 'hero', fov: 45, offset: { x: 0, y: 9, z: 7 } },
    entities,
  };
}


const ARENA = {
  id: 'main',
  name: 'The Clearing',
  theme: 'grass',
  // 幸存者类要的是一块能绕圈跑的空地。先给一个方形，之后按相机和敌人密度调。
  half: { x: 7, z: 7 },
  scenerySeed: 7,
  forest: 10,
};

const scene = buildArena(ARENA);
writeFileSync(new URL('../public/scenes3d/main.json', import.meta.url),
  JSON.stringify(scene, null, 2) + '\n');
console.log(`arena: ${scene.entities.length} entities`);
