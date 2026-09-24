#!/usr/bin/env node
/**
 * 生成《星港防线》的竞技场场景：public/scenes3d/main.json + manifest.json。
 *
 * 空间站停机坪主题的 20x20 竞技场：地板砖、四周双层围墙（每面留 2 格宽的
 * 敌人出生门）、掩体（集装箱/弹药箱）、墙边装饰（电脑终端、立柱）。
 *
 * 用法：node tools/gen-arena.mjs   （在工程根目录执行）
 *
 * 设计数据与游戏逻辑分离（ADR-021）：这里只摆静态世界，敌人/武器/拾取物
 * 全部由游戏代码在运行时生成。
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'public', 'scenes3d');
mkdirSync(OUT, { recursive: true });

// ---------------------------------------------------------------------------
// 小工具
// ---------------------------------------------------------------------------

const IDENTITY_QUAT = [0, 0, 0, 1];
/** 绕 Y 轴旋转 90° 的四元数（东西向墙体用） */
const ROT_Y_90 = [0, Math.SQRT1_2, 0, Math.SQRT1_2];

let seq = 0;
const eid = (prefix) => `${prefix}-${seq++}`;

const entities = [];
function addEntity(e) {
  entities.push(e);
  return e;
}

function prop(modelAssetId, x, y, z, opts = {}) {
  return addEntity({
    id: opts.id ?? eid(modelAssetId),
    name: opts.name,
    transform: {
      position: { x, y, z },
      ...(opts.rotation ? { rotation: opts.rotation } : {}),
      ...(opts.scale ? { scale: opts.scale } : {}),
    },
    modelAssetId,
    ...(opts.collider ? { collider: opts.collider } : {}),
    ...(opts.castShadow === false ? { castShadow: false } : {}),
    ...(opts.visible === false ? { visible: false } : {}),
  });
}

/** 不可见的纯碰撞体（地板/墙段用大盒子一次覆盖，避免几百个小碰撞体） */
function solidBox(id, cx, cy, cz, hx, hy, hz) {
  return addEntity({
    id,
    transform: { position: { x: cx, y: cy, z: cz } },
    primitive: { kind: 'box', size: { x: hx * 2, y: hy * 2, z: hz * 2 } },
    visible: false,
    collider: { shape: { kind: 'box', halfExtents: { x: hx, y: hy, z: hz } }, body: 'fixed' },
  });
}

/** 命名空实体：出生点、敌人门，供游戏代码读取位置 */
function marker(id, x, y, z) {
  // 占位小方块 + visible:false：只给游戏代码读位置，不渲染
  return addEntity({
    id,
    transform: { position: { x, y, z } },
    primitive: { kind: 'box', size: { x: 0.01, y: 0.01, z: 0.01 } },
    visible: false,
  });
}

// ---------------------------------------------------------------------------
// 地板：20x20 的 floor.glb（每块 1x1，顶部在 y=0.3）
// ---------------------------------------------------------------------------

const HALF = 10;
for (let ix = -HALF; ix < HALF; ix++) {
  for (let iz = -HALF; iz < HALF; iz++) {
    prop('floor', ix + 0.5, 0, iz + 0.5, { castShadow: false });
  }
}
// 整块地板碰撞体（y 0..0.3）
solidBox('floor-collider', 0, 0.15, 0, HALF, 0.15, HALF);

// ---------------------------------------------------------------------------
// 围墙：wall.glb（1 宽 x 1 高 x 0.3 厚），叠两层，四面各留 2 格宽的门
// ---------------------------------------------------------------------------

const WALL_BASE = 0.3;   // 墙坐在地板顶部
const GATE_HALF = 1;     // 门洞半宽

for (const layer of [0, 1]) {
  const y = WALL_BASE + 0.5 + layer; // 每块中心高度
  for (let i = -HALF + 0.5; i < HALF; i += 1) {
    if (Math.abs(i) < GATE_HALF) continue; // 门洞
    // 北 / 南（沿 X 排布）
    prop('wall', i, y, -HALF, { castShadow: layer === 1 });
    prop('wall', i, y, HALF, { castShadow: layer === 1 });
    // 东 / 西（沿 Z 排布，转 90°）
    prop('wall', HALF, y, i, { rotation: ROT_Y_90, castShadow: layer === 1 });
    prop('wall', -HALF, y, i, { rotation: ROT_Y_90, castShadow: layer === 1 });
  }
}
// 每面墙两个大碰撞盒（门洞左右各一段），覆盖两层高度 y 0.3..2.3
for (const side of ['n', 's', 'e', 'w']) {
  for (const sgn of [-1, 1]) {
    const segLen = HALF - GATE_HALF;          // 9
    const center = sgn * (GATE_HALF + segLen / 2); // ±5.5
    const cy = WALL_BASE + 1;                 // 1.3
    if (side === 'n') solidBox(`wall-${side}-${sgn < 0 ? 'w' : 'e'}`, center, cy, -HALF, segLen / 2, 1, 0.3);
    if (side === 's') solidBox(`wall-${side}-${sgn < 0 ? 'w' : 'e'}`, center, cy, HALF, segLen / 2, 1, 0.3);
    if (side === 'e') solidBox(`wall-${side}-${sgn < 0 ? 'n' : 's'}`, HALF, cy, center, 0.3, 1, segLen / 2);
    if (side === 'w') solidBox(`wall-${side}-${sgn < 0 ? 'n' : 's'}`, -HALF, cy, center, 0.3, 1, segLen / 2);
  }
}

// ---------------------------------------------------------------------------
// 门柱：wall-pillar.glb（1x1x0.5），夹在每个门洞两侧，叠两层
// ---------------------------------------------------------------------------

for (const [gx, gz, alongX] of [
  [0, -HALF, true], [0, HALF, true], [HALF, 0, false], [-HALF, 0, false],
]) {
  for (const sgn of [-1, 1]) {
    const px = alongX ? sgn * (GATE_HALF + 0.5) : gx;
    const pz = alongX ? gz : sgn * (GATE_HALF + 0.5);
    for (const layer of [0, 1]) {
      prop('pillar', px, WALL_BASE + 0.5 + layer, pz, {
        rotation: alongX ? IDENTITY_QUAT : ROT_Y_90,
        collider: layer === 0
          ? { shape: { kind: 'box', halfExtents: { x: 0.5, y: 0.5, z: 0.25 } }, body: 'fixed' }
          : undefined,
      });
    }
  }
}

// ---------------------------------------------------------------------------
// 掩体（对称布局，保证出生点视野开阔、中场有周旋空间）
// ---------------------------------------------------------------------------

const FLOOR_TOP = 0.3;

// 四个高集装箱（0.8x0.9x0.8）：中场四角
for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
  prop('container-tall', sx * 4, FLOOR_TOP, sz * 4, {
    collider: { shape: { kind: 'box', halfExtents: { x: 0.4, y: 0.45, z: 0.4 } }, body: 'fixed', offset: { x: 0, y: 0.45, z: 0 } },
  });
}
// 四个宽集装箱（0.6x0.7x0.6）：菱形中点
for (const [x, z] of [[6.5, 0], [-6.5, 0], [0, 6.5], [0, -6.5]]) {
  prop('container-wide', x, FLOOR_TOP, z, {
    collider: { shape: { kind: 'box', halfExtents: { x: 0.3, y: 0.35, z: 0.3 } }, body: 'fixed', offset: { x: 0, y: 0.35, z: 0 } },
  });
}
// 四个小集装箱（0.575x0.6x0.575）：靠近四门，给玩家进门后的第一掩体
for (const [x, z, rot] of [[2.8, -7, 0.4], [-2.8, 7, -0.3], [7, 2.8, 0.2], [-7, -2.8, -0.5]]) {
  const q = rot
    ? [0, Math.sin(rot / 2), 0, Math.cos(rot / 2)]
    : IDENTITY_QUAT;
  prop('container', x, FLOOR_TOP, z, {
    rotation: q,
    collider: { shape: { kind: 'box', halfExtents: { x: 0.29, y: 0.3, z: 0.29 } }, body: 'fixed', offset: { x: 0, y: 0.3, z: 0 } },
  });
}
// 弹药箱 crate-medium：散放几个当矮掩体（实测若太扁就当装饰）
for (const [x, z] of [[-3, 1.5], [3, -1.5], [1.5, 5.5], [-1.5, -5.5]]) {
  prop('crate', x, FLOOR_TOP, z, {
    collider: { shape: { kind: 'box', halfExtents: { x: 0.4, y: 0.15, z: 0.5 } }, body: 'fixed', offset: { x: 0, y: 0.15, z: 0 } },
  });
}

// ---------------------------------------------------------------------------
// 装饰：电脑终端靠墙一排
// ---------------------------------------------------------------------------

for (const x of [-6, -2, 2, 6]) {
  prop('computer', x, FLOOR_TOP, -9.2, {
    collider: { shape: { kind: 'box', halfExtents: { x: 0.2, y: 0.33, z: 0.22 } }, body: 'fixed', offset: { x: 0, y: 0.33, z: 0 } },
  });
  prop('computer', x + 1, FLOOR_TOP, 9.2, {
    rotation: [0, 1, 0, 0], // 转 180° 面向场内
  });
}

// ---------------------------------------------------------------------------
// 标记点：玩家出生 + 四个敌人门
// ---------------------------------------------------------------------------

marker('player-spawn', 0, 0.65, 6);
marker('gate-north', 0, FLOOR_TOP, -8.2);
marker('gate-south', 0, FLOOR_TOP, 8.2);
marker('gate-east', 8.2, FLOOR_TOP, 0);
marker('gate-west', -8.2, FLOOR_TOP, 0);

// ---------------------------------------------------------------------------
// 灯光 / 环境 / 相机
// ---------------------------------------------------------------------------

const scene = {
  schemaVersion: 1,
  id: 'main',
  name: '空间站停机坪',
  environment: {
    background: '#04060d',
    fog: { color: '#04060d', near: 20, far: 48 },
  },
  gravity: { x: 0, y: -9.81, z: 0 },
  lights: [
    { id: 'hemi', kind: 'hemisphere', color: '#5a7fb5', groundColor: '#11141f', intensity: 0.75 },
    {
      id: 'sun', kind: 'directional', color: '#d8ecff', intensity: 2.0,
      position: { x: 9, y: 16, z: 7 }, castShadow: true,
    },
    { id: 'core-cyan', kind: 'point', color: '#22d3ee', intensity: 40, position: { x: 0, y: 4.5, z: 0 } },
    { id: 'gate-magenta-n', kind: 'point', color: '#e879f9', intensity: 18, position: { x: 0, y: 2.5, z: -9 } },
    { id: 'gate-magenta-s', kind: 'point', color: '#e879f9', intensity: 18, position: { x: 0, y: 2.5, z: 9 } },
  ],
  entities,
  camera: { kind: 'fixed', fov: 75 },
};

const manifest = {
  schemaVersion: 1,
  initialScene: 'main',
  scenes: [{ id: 'main', file: 'main.json' }],
  models: [
    {
      id: 'hero',
      path: 'assets/character.glb',
      importScale: 1,
      animations: {
        idle: 'idle', walk: 'walk', run: 'sprint', jump: 'jump', fall: 'fall',
        crouch: 'crouch', sit: 'sit', drive: 'drive', die: 'die',
        pickUp: 'pick-up', interact: 'interact-right',
        holdRight: 'holding-right', holdBoth: 'holding-both',
        attack: 'attack-melee-right', kick: 'attack-kick-right',
        yes: 'emote-yes', no: 'emote-no',
      },
    },
    { id: 'gun-pistol', path: 'assets/weapons/blaster-h.glb', importScale: 1 },
    { id: 'gun-rifle', path: 'assets/weapons/blaster-a.glb', importScale: 1 },
    { id: 'gun-heavy', path: 'assets/weapons/blaster-p.glb', importScale: 1 },
    { id: 'crate', path: 'assets/weapons/crate-medium.glb', importScale: 1 },
    { id: 'floor', path: 'assets/env/floor.glb', importScale: 1 },
    { id: 'wall', path: 'assets/env/wall.glb', importScale: 1 },
    { id: 'pillar', path: 'assets/env/wall-pillar.glb', importScale: 1 },
    { id: 'container', path: 'assets/env/container.glb', importScale: 1 },
    { id: 'container-wide', path: 'assets/env/container-wide.glb', importScale: 1 },
    { id: 'container-tall', path: 'assets/env/container-tall.glb', importScale: 1 },
    { id: 'computer', path: 'assets/env/computer.glb', importScale: 1 },
  ],
};

// ---------------------------------------------------------------------------
// 写盘 + 校验
// ---------------------------------------------------------------------------

writeFileSync(join(OUT, 'main.json'), JSON.stringify(scene, null, 2) + '\n');
writeFileSync(join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');

try {
  const { validateScene } = await import('@umicat/three-sdk');
  const problems = validateScene(scene);
  if (problems.length) {
    console.error('场景校验发现问题：');
    for (const p of problems) console.error(' -', p);
    process.exit(1);
  }
} catch (e) {
  console.warn('跳过 SDK 校验（', String(e).slice(0, 120), '）');
}

const ids = new Set();
for (const e of entities) {
  if (ids.has(e.id)) { console.error('重复 id:', e.id); process.exit(1); }
  ids.add(e.id);
}
console.log(`OK: ${entities.length} 个实体 -> public/scenes3d/{main,manifest}.json`);
