import * as THREE from 'three';
import type { Swarm, Foe } from './swarm';
import type { Sparks } from './sparks';
import { type Vfx, type Quad, quads, FRAME, atlas, setFrameUv } from './vfx';

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
    this.mesh.visible = this.count > 0;
    this.mesh.instanceMatrix.needsUpdate = true;
    return killed;
  }
}


/** 尾迹灼烧：在你走过的路上留下伤害区。
 *
 *  回答的问题是**「追在我身后的那条尾巴」** —— 五把武器里唯一朝后的那个。
 *
 *  它是专门为我们加的，因为无限地图解锁了绕圈放风筝，而放风筝在别的武器下
 *  是纯防御动作：你跑，敌人跟着，你一点输出都没有。有了它，**绕圈跑从保命
 *  动作变成输出动作** —— 同一个操作，意义完全变了，这正是「一把武器是一个
 *  答案」该有的样子。
 *
 *  它也顺手治了一个实测出来的毛病：一直走直线既不挨打也不输出。
 */
export class TrailBurn {
  private mesh!: THREE.InstancedMesh;
  private spots: { x: number; z: number; life: number; spin: number }[] = [];
  private lastX = NaN;
  private lastZ = NaN;

  /** 隔多远留一个。
   *
   *  0.9 配上放大后的符文仍然是一串**断开的圈**（截图看过）。0.7 让相邻两块
   *  稍微叠上，读起来是一条烧过去的路，而不是一排盖下去的印章 —— 而「一条
   *  连续的路」正是这把武器要玩家理解的东西：你跑过的地方在烧。 */
  gap = 0.7;
  /** 一个留多久、多大、每秒多少伤害。`life` 是这把武器的升级轴：
   *  留得久 = 你绕的那个圈更长时间还在生效。 */
  life = 2.6;
  radius = 0.85;
  dps = 9;
  /** 对同一只敌人的再命中间隔。 */
  reHit = 0.35;

  private readonly m = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly pos = new THREE.Vector3();
  private readonly scl = new THREE.Vector3();
  private readonly up = new THREE.Vector3(0, 1, 0);
  private readonly col = new THREE.Color();
  // 普通混合下颜色是直接画上去的，所以这两个就是眼睛看到的颜色本身。
  // 红分量给满、绿蓝压低，这样加到草地上是橙黄而不是白。
  private readonly hot = new THREE.Color(0xffd27a);
  private readonly cold = new THREE.Color(0xff4a08);

  constructor(scene: THREE.Scene) {
    // **符文圈，不是一块橙色的圆片。**
    //
    // 第一版是 `CircleGeometry` + 半透明纯橙，玩家的评价是「太丑了」，而且
    // 说得对：一块均匀的半透明色块在草地上既不像火也不像痕迹，它只像一个
    // 没做完的占位图形。
    //
    // 现在用 Balaboo 那道闪电**落地那一半**的贴图（`FRAME.runeCircle`）——
    // `lightning()` 里的原注释说得很准：「一个圈读起来像一团烟；符文才是在说
    // 『这里有法术生效过』」。加色混合让它在深色地面上发光，而不是糊上一层。
    //
    // 只取符文这一层，不要那道 `glowRing`：多一层就要第二个网格、第二次
    // 绘制，而整关预算 20、最坏情况已经用到 19。形状上符文是主角，光环是陪衬。
    //
    // 不投影、不写深度 —— 它是地上的一块痕迹，不该和地面 z-fighting，
    // 也不该挡住站在上面的敌人。
    const g = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
    setFrameUv(g, FRAME.runeCircle);
    // **加色混合，而且没得选。**
    //
    // 中间试过普通混合，想让橙色在亮草地上不被洗白 —— 结果是一条**泥巴路**。
    // 原因去看一眼贴图就明白了（`public/vfx/particles.png`）：这张图是
    // **黑底灰度、没有 alpha 通道**，黑的地方 alpha 仍然是 1。加色混合下黑
    // 等于透明，普通混合下黑就是黑 —— 我等于在草地上刷了一块黑方片。
    //
    // 这类图只能加色。代价是颜色会被草地洗淡（草大约 0.35/0.78/0.45，绿通道
    // 先饱和，所以加什么都偏黄白）—— 但 Balaboo 那道闪电落地的圈本来就是这个
    // 样子，而这正是要的那个效果。**身份靠形状给，不靠颜色。**
    const m = new THREE.MeshBasicMaterial({
      map: atlas(), transparent: true, depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.mesh = new THREE.InstancedMesh(g, m, 96);
    this.mesh.instanceColor =
      new THREE.InstancedBufferAttribute(new Float32Array(96 * 3), 3);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 2;
    this.mesh.count = 0;
    scene.add(this.mesh);
  }

  update(dt: number, px: number, pz: number, swarm: Swarm, now: number): number {
    // 走够一段才留一个 —— 站着不动不该堆出一个越来越浓的池子。
    if (!(Math.hypot(px - this.lastX, pz - this.lastZ) < this.gap)) {
      this.lastX = px; this.lastZ = pz;
      if (this.spots.length < 96) {
        this.spots.push({ x: px, z: pz, life: this.life, spin: Math.random() * Math.PI * 2 });
      }
    }

    let killed = 0, n = 0;
    for (let i = this.spots.length - 1; i >= 0; i--) {
      const s = this.spots[i];
      s.life -= dt;
      if (s.life <= 0) {
        const last = this.spots.pop()!;
        if (i < this.spots.length) this.spots[i] = last;
        continue;
      }
      killed += swarm.damageNear(s.x, s.z, this.radius, this.dps * this.reHit,
                                 'trail', this.reHit, now);
      // 快烧完的时候暗下去、也小下去，这样「还剩多久」是看得出来的 ——
      // 一块突然消失的伤害区会让玩家以为自己记错了它在哪。
      const left = s.life / this.life;                     // 1 → 0
      const born = Math.min(1, (this.life - s.life) * 7);  // 落地那 0.14 秒长出来
      const k = Math.min(1, left * 2.2);
      this.pos.set(s.x, 0.03, s.z);
      // 每块符文**自己转**，起始角度还各不相同。步调一致的话，一条尾迹读起来
      // 像一排盖下去的印章，不像一串还在烧的东西。
      this.q.setFromAxisAngle(this.up, s.spin + now * 0.5);
      // **贴图里的符文只占方片的约 3/4**，所以方片要比想画的圈大一圈。
      // 截图量过：方片 1.6 的时候画出来的圈只有 1.2，而伤害直径是 1.7 ——
      // 看得见的火比打得到的范围小 30%，玩家会以为自己站位错了。
      // 2.6 × 0.85 = 2.21 的方片 → 画出来约 1.65，和伤害直径基本齐平。
      const r = this.radius * 2.6 * born * (0.62 + 0.38 * k);
      this.scl.set(r, 1, r);
      this.mesh.setMatrixAt(n, this.m.compose(this.pos, this.q, this.scl));
      // 刚落地偏白热，烧到最后是暗红。加色混合下「压向黑」就是淡出，
      // 所以「还剩多亮」和「什么颜色」是同一个乘法。
      // 加色混合下「压向黑」就是淡出，所以「还剩多亮」和「什么颜色」是同一个
      // 乘法。系数敢超过 1：加色是往上加的，只是让它更接近纯亮橙。
      //
      // 热度用 `left` 而不是 `left²`：平方让白热只在最开始零点几秒出现，
      // 整条尾迹绝大部分时间都停在暗的那一端。
      this.col.copy(this.cold).lerp(this.hot, left)
        .multiplyScalar(0.35 + 1.15 * k);
      this.mesh.setColorAt(n, this.col);
      n += 1;
    }
    this.mesh.count = n;
    this.mesh.visible = n > 0;   // 见 `sparks.ts`：空的实例化网格也要一次绘制
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
    return killed;
  }
}


/** 追踪弹：飞出去找一只打。
 *
 *  回答的问题是**「那只我还够不到的」** —— 前两把武器的射程都是「贴着我」
 *  和「我走过的地方」，都以玩家自己为中心。这是第一把能伸出去的。
 *
 *  **瞄准规则就是这把武器的设计。** 它优先打精英，没有精英才打最近的 ——
 *  于是它是全场唯一一把**单体**武器：伤害高、频率低、一发只解决一个问题。
 *  精英那种「必须处理掉的目标」正好是它的答案，而它对一团杂兵几乎没用，
 *  那是链式闪电的活。
 */
export class HomingBolt {
  private mesh!: THREE.InstancedMesh;
  private bolts: { x: number; z: number; vx: number; vz: number;
                   target: Foe | null; life: number }[] = [];

  /** 一次发几发。**这把的升级轴** —— 多一发意味着一次齐射能覆盖更多目标
   *  （同一次齐射里每发挑不同的目标，见下），不是同一只挨两下。 */
  shots = 1;
  private _interval = 1.15;
  /** 隔多久开一次火。
   *
   *  **写成 getter/setter，因为改它必须同时收住正在倒数的冷却。** 直接改字段
   *  的话，冷却是上一次开火时按**旧**间隔设下的：把间隔从 1.6 调到 0.5，玩家
   *  还得等完那 1.6 秒。现在没有升级项动它，但探针动它 —— 而且那正是这个 bug
   *  被发现的方式：「把间隔调小再等一会儿」什么都不会发生，探针于是时红时绿，
   *  读起来像武器本身不稳定。 */
  get interval(): number { return this._interval; }
  set interval(v: number) { this._interval = v; this.timer = Math.min(this.timer, v); }

  damage = 34;
  speed = 11;
  /** 找多远以内的目标，和飞多久没打到就消失。 */
  range = 17;
  maxLife = 2.4;
  /** 多近算打中。 */
  hitAt = 0.55;
  /** 每秒转多少弧度。**不是无限转** —— 追得太死就没有「它会不会脱靶」这回事，
   *  而看着它拐弯追上去正是这把武器好看的地方。 */
  turn = 6.5;

  /** 开火时响一声。**回调，不是让武器自己拿着 `GameAudio`** —— 武器不该知道
   *  声音是怎么放的，那是平台那一半的事（见 CLAUDE.md 的两半分界）。 */
  onFire: (() => void) | null = null;

  private timer = 0.35;
  private readonly m = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly pos = new THREE.Vector3();
  private readonly scl = new THREE.Vector3(1, 1, 1);
  private readonly up = new THREE.Vector3(0, 1, 0);
  /** 一次齐射里已经被认领的目标。复用同一个 Set，免得每次开火都分配一个。 */
  private readonly claimed = new Set<Foe>();

  constructor(scene: THREE.Scene, private readonly sparks: Sparks) {
    const g = new THREE.ConeGeometry(0.1, 0.34, 6).rotateX(Math.PI / 2);
    const m = new THREE.MeshStandardMaterial({
      color: 0xfff0b0, emissive: 0xffb43c, emissiveIntensity: 1.4,
      roughness: 0.4, metalness: 0,
    });
    this.mesh = new THREE.InstancedMesh(g, m, 64);
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    scene.add(this.mesh);
  }

  /** 挑一个目标：先精英，再最近的，且跳过这次齐射已经认领的。 */
  private pick(swarm: Swarm, x: number, z: number): Foe | null {
    let elite: Foe | null = null;
    let eliteD = this.range * this.range;
    for (const f of swarm.foes) {
      if (!f.elite || this.claimed.has(f)) continue;
      const dx = f.x - x, dz = f.z - z;
      const d = dx * dx + dz * dz;
      if (d < eliteD) { eliteD = d; elite = f; }
    }
    return elite ?? swarm.nearest(x, z, this.range, this.claimed);
  }

  update(dt: number, px: number, pz: number, swarm: Swarm, now: number): number {
    this.timer -= dt;
    if (this.timer <= 0) {
      this.timer = this.interval;
      let fired = false;
      // 一次齐射里每发挑**不同的**目标。少了这一句，三发全扎在最近那一只
      // 身上，「三发」就只是「伤害 ×3」—— 又是一档数值，不是一个答案。
      this.claimed.clear();
      for (let i = 0; i < this.shots && this.bolts.length < 64; i++) {
        const t = this.pick(swarm, px, pz);
        if (!t) break;
        this.claimed.add(t);
        const dx = t.x - px, dz = t.z - pz;
        const d = Math.hypot(dx, dz) || 1;
        this.bolts.push({ x: px, z: pz, vx: (dx / d) * this.speed,
                          vz: (dz / d) * this.speed, target: t, life: this.maxLife });
        fired = true;
      }
      if (fired) this.onFire?.();
    }

    let killed = 0, n = 0;
    for (let i = this.bolts.length - 1; i >= 0; i--) {
      const b = this.bolts[i];
      b.life -= dt;
      // 目标死了就**当场换一个**。没有这一句，清场的时候半空中全是飞向空气的
      // 弹（`hp <= 0` 是死亡的标记 —— 敌人从数组里被交换删除了，但对象还在，
      // 所以拿着引用的武器能自己发现）。
      if (b.target && b.target.hp <= 0) b.target = this.pick(swarm, b.x, b.z);
      if (b.target) {
        const dx = b.target.x - b.x, dz = b.target.z - b.z;
        const d = Math.hypot(dx, dz) || 1;
        const k = Math.min(1, this.turn * dt);
        b.vx += ((dx / d) * this.speed - b.vx) * k;
        b.vz += ((dz / d) * this.speed - b.vz) * k;
        if (d < this.hitAt) {
          if (swarm.hitFoe(b.target, this.damage)) killed += 1;
          // 命中的那一下要看得见。这是**唯一**一把要玩家读「打中了没有」的
          // 武器 —— 环刃和尾迹是持续的，看不出单次命中也无所谓。
          this.sparks.burst(b.target.x, 0.5, b.target.z,
            { count: 10, color: 0xffd36e, color2: 0xff7a2f, speed: 3.4, life: 0.4 });
          const last = this.bolts.pop()!;
          if (i < this.bolts.length) this.bolts[i] = last;
          continue;
        }
      }
      b.x += b.vx * dt; b.z += b.vz * dt;
      if (b.life <= 0) {
        const last = this.bolts.pop()!;
        if (i < this.bolts.length) this.bolts[i] = last;
        continue;
      }
      this.pos.set(b.x, 0.55, b.z);
      this.q.setFromAxisAngle(this.up, Math.atan2(b.vx, b.vz));
      this.mesh.setMatrixAt(n++, this.m.compose(this.pos, this.q, this.scl));
      // 一条细细的尾迹。每发每帧一颗，不是每帧一把 —— 三千颗的池子经得起
      // 这个，但经不起一发一把。
      if (Math.random() < 0.6) {
        this.sparks.burst(b.x, 0.55, b.z,
          { count: 1, color: 0xffc247, speed: 0.5, up: 0.2, life: 0.26, size: 0.11 });
      }
      void now;
    }
    this.mesh.count = n;
    this.mesh.visible = n > 0;
    this.mesh.instanceMatrix.needsUpdate = true;
    return killed;
  }
}


/** 前向冲击：朝你跑的方向推出去一道波。
 *
 *  回答的问题是**「我要往哪儿突围」**。
 *
 *  它和生成偏向是**一对**：敌人有一半是朝着你移动的方向生成的（`Swarm.spawn`
 *  里为什么要这样，写在那儿），所以「前面」永远是最挤的那一侧 —— 这把武器就是
 *  那件事的解药。而且它的方向**由走位决定**，于是这是全场唯一一把玩家能"瞄"的
 *  武器：想清路就朝那边跑。
 *
 *  没在动的时候用最后一次的朝向。站着不动仍然能开火，但你放弃了选方向这件事。
 */
export class ShockLance {
  private mesh!: THREE.InstancedMesh;
  private waves: { x: number; z: number; dx: number; dz: number; travelled: number }[] = [];
  private heading = 0;

  /** 波有多宽（弧长的一半，弧度）。**这把的升级轴** —— 更宽的波清掉更大的
   *  一片正面，而这正是它存在的理由。看得见，也改变你敢往多密的地方冲。 */
  half = 0.55;
  private _interval = 1.6;
  /** 隔多久开一次火。
   *
   *  **写成 getter/setter，因为改它必须同时收住正在倒数的冷却。** 直接改字段
   *  的话，冷却是上一次开火时按**旧**间隔设下的：把间隔从 1.6 调到 0.5，玩家
   *  还得等完那 1.6 秒。现在没有升级项动它，但探针动它 —— 而且那正是这个 bug
   *  被发现的方式：「把间隔调小再等一会儿」什么都不会发生，探针于是时红时绿，
   *  读起来像武器本身不稳定。 */
  get interval(): number { return this._interval; }
  set interval(v: number) { this._interval = v; this.timer = Math.min(this.timer, v); }

  damage = 22;
  /** 往前推多远、多快，和波自己有多厚。 */
  reach = 7.5;
  speed = 13;
  thick = 0.85;
  /** 弧上取几个采样点算伤害。点太少波会漏人，太多只是白费 —— 相邻采样点
   *  的间距要小于 `thick`，否则两点之间有缝。 */
  private get segs(): number {
    return Math.max(3, Math.ceil((this.half * 2 * 2.6) / (this.thick * 0.9)) + 1);
  }

  onFire: (() => void) | null = null;

  private timer = 0.8;
  private readonly m = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly pos = new THREE.Vector3();
  private readonly scl = new THREE.Vector3();
  private readonly up = new THREE.Vector3(0, 1, 0);

  constructor(scene: THREE.Scene, private readonly sparks: Sparks) {
    // 一片贴地的扇形碎片。整道波是同一个 `InstancedMesh` 上的十几个实例 ——
    // 一道波一次绘制，八道波还是一次绘制。
    const g = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
    const m = new THREE.MeshBasicMaterial({
      color: 0x8fe3ff, transparent: true, opacity: 0.8,
      depthWrite: false, blending: THREE.AdditiveBlending,
    });
    this.mesh = new THREE.InstancedMesh(g, m, 160);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 3;
    this.mesh.count = 0;
    scene.add(this.mesh);
  }

  update(dt: number, px: number, pz: number, dirX: number, dirZ: number,
         swarm: Swarm, now: number): number {
    if (Math.hypot(dirX, dirZ) > 0.1) this.heading = Math.atan2(dirX, dirZ);

    this.timer -= dt;
    if (this.timer <= 0) {
      this.timer = this.interval;
      this.waves.push({ x: px, z: pz, dx: Math.sin(this.heading),
                        dz: Math.cos(this.heading), travelled: 0 });
      this.onFire?.();
    }

    let killed = 0, n = 0;
    const segs = this.segs;
    for (let i = this.waves.length - 1; i >= 0; i--) {
      const w = this.waves[i];
      w.travelled += this.speed * dt;
      if (w.travelled > this.reach) {
        const last = this.waves.pop()!;
        if (i < this.waves.length) this.waves[i] = last;
        continue;
      }
      const base = Math.atan2(w.dx, w.dz);
      // 波越往前推，弧越长 —— 它是从玩家身上扩散出去的一段圆弧，不是一根
      // 平移的棍子。扩散读起来是「推开」，平移读起来是「飞过去」。
      const r = w.travelled;
      const k = 1 - w.travelled / this.reach;
      for (let s = 0; s < segs && n < 160; s++) {
        const a = base + (s / (segs - 1) - 0.5) * this.half * 2;
        const x = w.x + Math.sin(a) * r;
        const z = w.z + Math.cos(a) * r;
        // 每个采样点是一次独立的命中判定，但共用一个节流 tag —— 否则一道波
        // 上相邻的两片会各打一次，"更宽"就变成了"伤害更高"。
        killed += swarm.damageNear(x, z, this.thick, this.damage, 'shock', 0.6, now);
        this.pos.set(x, 0.06, z);
        this.q.setFromAxisAngle(this.up, -a);
        this.scl.set(this.thick * 1.7, 1, this.thick * 1.5 * k + 0.3);
        this.mesh.setMatrixAt(n++, this.m.compose(this.pos, this.q, this.scl));
      }
      // 波前沿上撒几颗火星，这样它在草地上也读得出来 —— 一片半透明的蓝
      // 在浅色地面上几乎看不见，而这是一把靠"我知道它清了哪儿"工作的武器。
      if (Math.random() < 0.7) {
        const a = base + (Math.random() - 0.5) * this.half * 2;
        this.sparks.burst(w.x + Math.sin(a) * r, 0.25, w.z + Math.cos(a) * r,
          { count: 2, color: 0x9fefff, color2: 0x4fa8ff, speed: 2.2, up: 1.1, life: 0.42 });
      }
    }
    this.mesh.count = n;
    this.mesh.visible = n > 0;
    this.mesh.instanceMatrix.needsUpdate = true;
    return killed;
  }
}


/** 链式闪电：打一只，再跳到旁边那只。
 *
 *  回答的问题是**「挤成一团的那些」**。
 *
 *  它是追踪弹的反面，而这正是它该在的位置：追踪弹对一只落单的精英最强、
 *  对一团杂兵几乎没用；闪电对一团最强、对落单的那只只是一次普通伤害。
 *  **一把武器在什么地方没用，和它在什么地方好用一样重要** —— 两把都强的
 *  武器不构成选择。
 *
 *  跳的距离是固定的，所以它**随敌人密度变强**：后段那条曲线越往上走，它
 *  越好用。这是刻意的，也是它和前面四把在时间轴上的分工。
 */
export class ChainLightning {
  /** 跳几次。**这把的升级轴** —— 看得见（弧一条一条连出去），而且它改变的
   *  是"这一团我能吃掉多少"，不是一个数字。 */
  jumps = 3;
  private _interval = 1.3;
  /** 隔多久开一次火。
   *
   *  **写成 getter/setter，因为改它必须同时收住正在倒数的冷却。** 直接改字段
   *  的话，冷却是上一次开火时按**旧**间隔设下的：把间隔从 1.6 调到 0.5，玩家
   *  还得等完那 1.6 秒。现在没有升级项动它，但探针动它 —— 而且那正是这个 bug
   *  被发现的方式：「把间隔调小再等一会儿」什么都不会发生，探针于是时红时绿，
   *  读起来像武器本身不稳定。 */
  get interval(): number { return this._interval; }
  set interval(v: number) { this._interval = v; this.timer = Math.min(this.timer, v); }

  damage = 26;
  /** 第一跳找多远，之后每跳能跨多远。 */
  range = 12;
  jumpRange = 3.4;
  /** 每跳衰减。不衰减的话它就是一把没有代价的群体武器。 */
  falloff = 0.86;

  onFire: (() => void) | null = null;

  private timer = 0.6;
  /** 这一次链里已经打过谁。复用，免得每次开火分配一个 Set。 */
  private readonly hit = new Set<Foe>();

  constructor(private readonly vfx: Vfx, private readonly sparks: Sparks) {}

  update(dt: number, px: number, pz: number, swarm: Swarm): number {
    this.timer -= dt;
    if (this.timer > 0) return 0;
    this.timer = this.interval;

    let f = swarm.nearest(px, pz, this.range);
    if (!f) return 0;

    this.onFire?.();
    this.hit.clear();
    let killed = 0;
    let dmg = this.damage;
    // 从玩家身上起第一条弧，这样"是我放的"读得出来。
    let fx = px, fz = pz, fy = 0.7;
    // **整条链画成一个网格，不是一段一条。**
    //
    // 原来每一跳调一次 `arcBetween`，而它内部一次 `quads()` = 一份几何 +
    // 一份材质 + 一个网格 = **一次绘制**。满级七跳就是八次绘制，实测把
    // 「五把全开 + 400 只」从 16 次顶到了 **40 次**，预算是 20。
    //
    // 这个数之前一直没被看见，因为在那个测量里闪电根本没开过火（冷却被探针
    // 顶到了 999）—— 一个沉默的系统让预算看起来很宽裕。
    //
    // `quads()` 本来就吃一个列表，所以把整条链的所有片段攒进同一个列表再调
    // 一次，八次绘制变一次，画面一模一样。
    const list: Quad[] = [];
    const bolt = [FRAME.boltA, FRAME.boltB, FRAME.strandA, FRAME.strandB];
    for (let j = 0; j <= this.jumps && f; j++) {
      this.hit.add(f);
      const tx = f.x, tz = f.z;
      list.push(
        { at: new THREE.Vector3(fx, fy, fz), to: new THREE.Vector3(tx, 0.55, tz),
          frame: bolt[j % bolt.length], w: 0.75, h: 1, mode: 'beam' },
        { at: new THREE.Vector3(tx, 0.55, tz), frame: FRAME.starBurst,
          w: 0.85, h: 0.85, mode: 'face' },
      );
      this.sparks.burst(tx, 0.55, tz,
        { count: 7, color: 0xd6f0ff, color2: 0x6fb6ff, speed: 3, life: 0.36 });
      if (swarm.hitFoe(f, dmg)) killed += 1;
      dmg *= this.falloff;
      fx = tx; fz = tz; fy = 0.55;
      // 跳过已经打过的 —— 没有这个，闪电会在最近的两只之间来回弹，
      // "链"就退化成"对一只打好几次"。
      f = swarm.nearest(tx, tz, this.jumpRange, this.hit);
    }
    if (list.length) {
      let flick = 0;
      quads(this.vfx, list, {
        life: 0.26, color: 0xbfe4ff,
        alpha: (k) => (k < 0.2 ? 1 : Math.max(0, 1 - ((k - 0.2) / 0.8) ** 0.6)),
        step: (qs, _k, dt) => {
          // 闪一下。照搬 `arcBetween` 里的做法：每 40ms 换一张 bolt 贴图，
          // 不换的话它是一根静止的光棍，不是电。
          flick += dt;
          if (flick < 0.04) return;
          flick = 0;
          for (let i = 0; i < qs.length; i += 2) {
            qs[i].frame = bolt[Math.floor(Math.random() * bolt.length)];
            qs[i].w = 0.62 + Math.random() * 0.45;
          }
        },
      });
    }
    return killed;
  }
}
