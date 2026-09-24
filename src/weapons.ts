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

  /** 几把刀。升级加的是这个，不是伤害 —— 多一把刀改变的是**覆盖**，
   *  多一点伤害只是改变数字。 */
  count = 2;
  /** 刀转的半径。
   *
   *  **要盖住敌人实际待的那一圈。** 第一版是 1.5、刀刃 0.5，覆盖 1.0–2.0；
   *  而敌人贴到 0.7 就停下 —— 正好停在刀够不到的内圈里，二十四秒零击杀。
   *  武器的射程和敌人的停步距离是**一对**数字，改一个就要看另一个。 */
  radius = 1.05;
  /** 每秒转多少弧度。转速也是覆盖：转得快 = 同一个缺口关得更快。 */
  spin = 2.6;
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
