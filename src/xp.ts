import * as THREE from 'three';

/**
 * 经验宝石，和升级的门槛。
 *
 * **门槛压得很低，尤其是开头 —— 这是这个类型最容易被做坏的地方。**
 * 吸血鬼幸存者第一级只要 **5 点**经验，之后每级 +10。开局十几秒就能连升几级。
 * 很多模仿者把曲线做得「合理」（前几级也要几十点），结果开头十分钟毫无起伏，
 * 而这个回路靠的是**反馈密度**，不是单次奖励的大小。
 *
 * 我们一局 15 分钟（它最短的图也是 15），所以每级 +8 而不是 +10 —— 稍陡一点，
 * 因为总时长短、等级总数要少。
 *
 * 宝石走 `InstancedMesh`：一局下来地上可能同时有几百颗，而它们和敌人是同一个
 * 问题 —— 每颗一个对象就是每颗一次绘制。
 */

const MAX = 600;
/** 捡起来的距离，和「开始被吸过去」的距离。
 *
 *  吸取半径远大于捡取半径，这样走过附近就会有一串宝石飞过来 —— 那个动作本身
 *  就是奖励的一部分。不做吸取的话，玩家得精确踩在每一颗上面，于是「走位」这件
 *  本来属于躲避的事，被捡东西占用了。 */
const PICK = 0.6;
const MAGNET_BASE = 3.2;

/** 升到下一级要多少。`level` 是当前等级（从 1 开始）。 */
export const xpToNext = (level: number): number => 5 + (level - 1) * 8;

interface Gem { x: number; z: number; value: number; t: number; }

/** 地上可以捡的东西，一种一个池子。
 *
 *  经验宝石和金币是**同一件事的两个实例** —— 都掉在尸体上、都被吸过来、都
 *  是一次绘制。所以磁吸那段代码只写一遍：两边各抄一份的话，改吸取手感就得
 *  记得改两处，而漏掉的那一处会变成「金币吸得比经验慢」这种谁也说不清原因
 *  的手感问题。
 *
 *  不同的只有长什么样和捡到之后算什么 —— 那两件事由构造参数和调用方决定。 */
export class Pickups {
  private mesh!: THREE.InstancedMesh;
  private gems: Gem[] = [];

  /** 吸取半径。升级可以加它 —— 加吸取半径改变的是**你能走多险**，
   *  而不是某个数字变大。 */
  magnet = MAGNET_BASE;
  /** 转多快、上下浮多少。金币立着转，宝石慢慢旋 —— 两者要**一眼分得清**，
   *  因为它们喂的是两个完全不同的决定（升级 vs 存钱）。 */
  private readonly spin: number;
  private readonly bob: number;

  private readonly m = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly pos = new THREE.Vector3();
  private readonly scl = new THREE.Vector3(1, 1, 1);
  private readonly up = new THREE.Vector3(0, 1, 0);

  constructor(scene: THREE.Scene, look: {
    geometry: THREE.BufferGeometry; material: THREE.Material;
    spin?: number; bob?: number;
  }) {
    this.spin = look.spin ?? 1.6;
    this.bob = look.bob ?? 0.05;
    this.mesh = new THREE.InstancedMesh(look.geometry, look.material, MAX);
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = false;
    this.mesh.count = 0;
    scene.add(this.mesh);
  }

  drop(x: number, z: number, value = 1): void {
    if (this.gems.length >= MAX) return;
    this.gems.push({ x, z, value, t: 0 });
  }

  get count(): number { return this.gems.length; }

  /** 走一帧。返回这一帧捡到多少经验。 */
  update(dt: number, px: number, pz: number, now: number): number {
    let got = 0;
    let n = 0;
    for (let i = this.gems.length - 1; i >= 0; i--) {
      const g = this.gems[i];
      g.t += dt;
      const dx = px - g.x, dz = pz - g.z;
      const d = Math.hypot(dx, dz) || 1;

      if (d < this.magnet) {
        // 越近吸得越快。等速飞过来读起来像宝石自己在走路，加速才像被吸住。
        const pull = 3 + (1 - d / this.magnet) * 14;
        g.x += (dx / d) * pull * dt;
        g.z += (dz / d) * pull * dt;
      }
      if (d < PICK) {
        got += g.value;
        const last = this.gems.pop()!;
        if (i < this.gems.length) this.gems[i] = last;
        continue;
      }

      this.pos.set(g.x, 0.28 + Math.sin(now * 2.4 + g.t) * this.bob, g.z);
      this.q.setFromAxisAngle(this.up, now * this.spin + g.t);
      this.mesh.setMatrixAt(n++, this.m.compose(this.pos, this.q, this.scl));
    }
    this.mesh.count = n;
    this.mesh.visible = n > 0;   // 空的实例化网格仍然要一次绘制，见 `sparks.ts`
    this.mesh.instanceMatrix.needsUpdate = true;
    return got;
  }

  clear(): void { this.gems.length = 0; this.mesh.count = 0; }
}

/** 经验宝石：蓝的，八面体，慢慢转。 */
export const makeGems = (scene: THREE.Scene): Pickups => new Pickups(scene, {
  geometry: new THREE.OctahedronGeometry(0.16),
  material: new THREE.MeshStandardMaterial({
    color: 0x5fe0ff, emissive: 0x1a6fa8, emissiveIntensity: 0.9,
    roughness: 0.2, metalness: 0,
  }),
  spin: 1.6, bob: 0.05,
});

/** 金币：金的，**立着**的薄圆片，转得快。
 *
 *  立着是关键 —— 一枚平躺在地上的圆片从这个俯角看过去就是一个圆点，和宝石
 *  在缩略图尺寸上分不出来。立着转，它每转半圈会闪一次宽窄变化，那个节奏本身
 *  就是「这是一枚硬币」。 */
export const makeCoins = (scene: THREE.Scene): Pickups => {
  const g = new THREE.CylinderGeometry(0.17, 0.17, 0.045, 14).rotateX(Math.PI / 2);
  return new Pickups(scene, {
    geometry: g,
    material: new THREE.MeshStandardMaterial({
      color: 0xffc843, emissive: 0x8a5a05, emissiveIntensity: 0.55,
      roughness: 0.28, metalness: 0.75,
    }),
    spin: 4.2, bob: 0.07,
  });
};
