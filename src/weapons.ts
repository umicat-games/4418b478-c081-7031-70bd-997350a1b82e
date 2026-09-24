import * as THREE from 'three';
import type { Swarm } from './swarm';

/**
 * 武器。现在只有一把 —— 这是个能上手试手感的切片，不是最终的五把。
 *
 * 设计原则写在 `docs/DESIGN.md` 里，一句话：**一把武器要是一个答案，不是一档
 * 数值**。它得解决一个别的武器解决不了的处境，所以每把武器有自己的**空间形状**
 * 和**索敌规则**，而不是同一件事换个伤害数字。
 *
 * 先做环刃，因为它是五把里最能立刻说明「自动攻击」是什么感觉的那把：不用瞄、
 * 不用按，站位就是输出。
 */

/** 环刃：绕着你转。回答的问题是「我被包围了 / 有东西贴上来了」。 */
export class OrbitBlades {
  private mesh!: THREE.InstancedMesh;
  private angle = 0;

  /** 几把刀。**这把武器唯一的升级轴。**
   *
   *  多一把刀改变的是覆盖，多一点伤害只是改变数字。但更要紧的是它和转速的
   *  关系：覆盖间隔是 `2π / (转速 × 刀数)`，所以**转速和刀数在数学上是同一个
   *  杠杆** —— 两把刀转 2.6 等于一把刀转 5.2。两个都做成升级项，其中一个就是
   *  冗余的，而玩家在三选一里面对它们时做的是算术，正是「一档数值」那种失败。
   *
   *  选刀数而不是转速，因为**刀数看得见**：两把变四把一眼就知道，转速快 20%
   *  几乎感知不到 —— 看不见的升级等于没升级。刀数还多一层转速给不了的东西：
   *  两把刀能**同时**打到相对的两侧。 */
  count = 2;
  /** 刀转的半径。
   *
   *  **要盖住敌人实际待的那一圈。** 第一版是 1.5、刀刃 0.5，覆盖 1.0–2.0；
   *  而敌人贴到 0.7 就停下 —— 正好停在刀够不到的内圈里，二十四秒零击杀。
   *  武器的射程和敌人的停步距离是**一对**数字，改一个就要看另一个。 */
  radius = 1.05;
  /** 每秒转多少弧度。**调一次就不动了**，见上面为什么它不是升级项。
   *
   *  2.6 试出来「太慢」，算一下就知道为什么：一圈 2.42 秒，两把刀 → 同一个
   *  位置每 **1.21 秒**才被扫一次，敌人能在缝里站着不挨打。
   *
   *  5.0 是每 0.63 秒扫一次。这个数的上界由 `reHit`（0.45 秒）定：扫得比
   *  再命中间隔还快的部分不会变成伤害，只剩覆盖。所以 5.0 仍在「提速就是
   *  提伤害」的区间里，再快就只是好看了。 */
  spin = 5.0;
  damage = 8;
  /** 刀刃自己的半径，和它对同一只敌人的再命中间隔（秒）。 */
  hitRadius = 0.75;
  reHit = 0.45;

  private readonly m = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly pos = new THREE.Vector3();
  private readonly scl = new THREE.Vector3(1, 1, 1);
  private readonly up = new THREE.Vector3(0, 1, 0);

  constructor(scene: THREE.Scene) {
    // 一个 `InstancedMesh`，所以「刀多了」不等于「绘制多了」—— 升到八把刀
    // 仍然是一次绘制。这正是敌群那边刚验过的同一招。
    const g = new THREE.BoxGeometry(0.5, 0.1, 0.14);
    const m = new THREE.MeshStandardMaterial({
      color: 0x9fe8ff, emissive: 0x2f7ad8, emissiveIntensity: 0.6,
      roughness: 0.3, metalness: 0,
    });
    this.mesh = new THREE.InstancedMesh(g, m, 12);
    this.mesh.frustumCulled = false;   // 实例散在玩家四周，包围球来自单把刀
    this.mesh.castShadow = false;
    scene.add(this.mesh);
  }

  update(dt: number, px: number, pz: number, swarm: Swarm, now: number): number {
    this.angle += this.spin * dt;
    let killed = 0;
    for (let i = 0; i < this.count; i++) {
      const a = this.angle + (i / this.count) * Math.PI * 2;
      const x = px + Math.cos(a) * this.radius;
      const z = pz + Math.sin(a) * this.radius;
      this.pos.set(x, 0.5, z);
      this.q.setFromAxisAngle(this.up, -a);
      this.mesh.setMatrixAt(i, this.m.compose(this.pos, this.q, this.scl));
      // 每把刀是独立的命中来源，但共用一个节流 tag —— 否则两把刀擦过同一只
      // 敌人时会各打一次，「两把刀」就变成了「双倍伤害」而不是「双倍覆盖」。
      killed += swarm.damageNear(x, z, this.hitRadius, this.damage, 'orbit', this.reHit, now);
    }
    this.mesh.count = this.count;
    this.mesh.instanceMatrix.needsUpdate = true;
    return killed;
  }
}
