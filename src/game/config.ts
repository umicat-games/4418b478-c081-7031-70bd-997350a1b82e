/**
 * 《星港防线 STARHOLD》数值配置。
 *
 * 注意：掩体/出生点等关卡布局常量不在这里 —— 它们由 tools/gen-arena.mjs
 * 生成进 public/scenes3d/main.json，游戏运行时从场景实体（player-spawn、
 * gate-* 等命名实体）读取，避免两处 hardcode 不一致。
 */

export const FLOOR_TOP = 0.3;       // 地板顶部高度（floor.glb 顶部）
export const ARENA_HALF = 10;       // 竞技场半宽（敌人钳制范围用）
export const EYE_ABOVE_FEET = 0.62; // 眼睛离脚的高度
export const SAVE_KEY_BEST = 'starhold-best';

// ---------------------------------------------------------------- 武器 ---

export interface SplashDef { radius: number; damage: number }

export interface WeaponDef {
  id: 'pistol' | 'rifle' | 'heavy';
  /** 显示名 */
  name: string;
  /** manifest 里的模型 id */
  modelId: 'gun-pistol' | 'gun-rifle' | 'gun-heavy';
  damage: number;
  headshotMult: number;
  /** 两次射击的最短间隔（秒） */
  interval: number;
  /** true = 按住连发 */
  auto: boolean;
  /** 弹匣容量，-1 = 无限 */
  mag: number;
  /** 开局备弹，-1 = 无限 */
  reserve: number;
  reloadTime: number;
  /** 散布（弧度） */
  spread: number;
  /** 视角上跳（弧度） */
  kick: number;
  tracerColor: number;
  /** 音效名（见 audio.ts 的 SOUNDS） */
  sound: 'shoot_pistol' | 'shoot_rifle' | 'shoot_heavy';
  splash?: SplashDef;
}

export const WEAPONS: WeaponDef[] = [
  {
    id: 'pistol', name: '脉冲手枪', modelId: 'gun-pistol',
    damage: 30, headshotMult: 2, interval: 0.32, auto: false,
    mag: -1, reserve: -1, reloadTime: 0, spread: 0.006, kick: 0.014,
    tracerColor: 0x66eeff, sound: 'shoot_pistol',
  },
  {
    id: 'rifle', name: '突击步枪', modelId: 'gun-rifle',
    damage: 13, headshotMult: 2, interval: 0.105, auto: true,
    mag: 30, reserve: 150, reloadTime: 1.5, spread: 0.022, kick: 0.02,
    tracerColor: 0xffd34d, sound: 'shoot_rifle',
  },
  {
    id: 'heavy', name: '重型爆能炮', modelId: 'gun-heavy',
    damage: 85, headshotMult: 1.5, interval: 1.0, auto: false,
    mag: 5, reserve: 20, reloadTime: 2.3, spread: 0.008, kick: 0.05,
    tracerColor: 0xff7b33, sound: 'shoot_heavy',
    splash: { radius: 2.4, damage: 40 },
  },
];

// ---------------------------------------------------------------- 敌人 ---

export interface RangedDef {
  damage: number;
  /** 两次远程攻击间隔 */
  interval: number;
  /** 开火距离区间 */
  range: [number, number];
  /** 弹丸速度 */
  speed: number;
}

export interface EnemyDef {
  id: 'scout' | 'trooper' | 'brute';
  name: string;
  hp: number;
  /** 移动速度（米/秒） */
  speed: number;
  /** 相对 character.glb 的缩放 */
  scale: number;
  meleeDamage: number;
  meleeRange: number;
  attackInterval: number;
  ranged?: RangedDef;
  score: number;
  /** 受击闪光颜色 */
  tint: number;
  /** 基础染色（区分种类） */
  baseTint: number;
}

export const ENEMIES: Record<EnemyDef['id'], EnemyDef> = {
  scout: {
    id: 'scout', name: '突击者', hp: 30, speed: 3.6, scale: 0.85,
    meleeDamage: 8, meleeRange: 0.95, attackInterval: 1.1,
    score: 100, tint: 0xff4433, baseTint: 0xffb3a0,
  },
  trooper: {
    id: 'trooper', name: '士兵', hp: 65, speed: 2.7, scale: 1.0,
    meleeDamage: 12, meleeRange: 1.05, attackInterval: 1.4,
    ranged: { damage: 9, interval: 2.8, range: [5, 15], speed: 11 },
    score: 150, tint: 0xff6633, baseTint: 0xffc890,
  },
  brute: {
    id: 'brute', name: '重装', hp: 170, speed: 1.8, scale: 1.32,
    meleeDamage: 24, meleeRange: 1.25, attackInterval: 2.0,
    score: 300, tint: 0xff2222, baseTint: 0xd08080,
  },
};

// ---------------------------------------------------------------- 波次 ---

/** 第 n 波的敌人总数 */
export function waveSize(n: number): number {
  return 5 + 3 * n;
}

/** 第 n 波的种类配比（返回要生成的 id 列表，打乱后按顺序刷出） */
export function waveComposition(n: number): EnemyDef['id'][] {
  const total = waveSize(n);
  const list: EnemyDef['id'][] = [];
  let brutes = 0;
  let troopers = 0;
  if (n >= 3) brutes = Math.min(1 + Math.floor((n - 3) / 2), Math.floor(total / 4));
  if (n >= 2) troopers = Math.floor(total * 0.3);
  for (let i = 0; i < brutes; i++) list.push('brute');
  for (let i = 0; i < troopers; i++) list.push('trooper');
  while (list.length < total) list.push('scout');
  // 洗牌：重装/士兵分散在波次中，而不是扎堆
  for (let i = list.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [list[i], list[j]] = [list[j], list[i]];
  }
  return list;
}

/** 同屏敌人上限（性能 + 公平） */
export const MAX_ALIVE_ENEMIES = 14;
/** 刷怪间隔（秒） */
export const SPAWN_INTERVAL = 0.8;
/** 波间休整（秒） */
export const INTERMISSION_TIME = 8;

// ---------------------------------------------------------------- 玩家 ---

export const PLAYER_HP = 100;
export const PLAYER_REGEN_DELAY = 4;   // 受伤后多久开始回血
export const PLAYER_REGEN_RATE = 10;   // 每秒回血
export const WALK_SPEED = 4.3;
export const SPRINT_SPEED = 6.2;
export const LOOK_SENSITIVITY = 0.0023;
