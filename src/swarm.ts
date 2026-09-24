import * as THREE from 'three';
import { loadModelAsset, type Manifest3D } from '@umicat/three-sdk';

/**
 * 一群敌人，两种画法。
 *
 * 幸存者类的敌人是**上百只同时在场**，而这个 3D 栈的一整关绘制预算约 20 次。
 * Balaboo 那套「每只一个克隆」实测是每只 2.88 次绘制（本体 1 + 血条 2），
 * 400 只就是 1161 次。这个文件的全部意义是把它变成常数。
 *
 * 两种模式都实现了，**因为它们要在同一块板子上比**。拿另一个游戏的旧数字
 * 和这里比，比的是两个场景，不是两种画法。
 *
 *   - `clone`：`proto.clone(true)`，每只一个 Object3D。Balaboo 的做法。
 *   - `instanced`：一份几何 + 一份材质 + N 个矩阵 = **1 次绘制**，不论多少只。
 *
 * 实例化不是免费的，代价在这三处，都在下面处理了：
 *
 *   - **受击闪光不能再克隆材质。** 只有一份材质，改它等于全场变红 —— 这个
 *     项目被这个坑咬过两次（`flashTint` 一次染红五只、淡出诊所连带淡出兵工
 *     厂）。走 `instanceColor`，每实例一个颜色。
 *   - **视锥剔除要关掉。** `InstancedMesh` 的包围球来自基准几何体，而实例散
 *     布在整张图上 —— 不关它会在你还看得见的时候整群消失。和 SDK 对蒙皮网格
 *     做的是同一件事、同一个理由。
 *   - **血条要自己面向相机。** 每实例烘进相机朝向，而不是每只做一次四元数
 *     运算 —— 400 只那是 1200 次。
 *
 * **杂兵没有血条**，只有精英和 boss 有。几百条血条是噪音，而且玩家根本不对
 * 单只杂兵做决策 —— 武器是自动的、免费的，「这只还剩多少」不是任何决定的
 * 输入。（Polarity 里每只都有血条是对的，因为那里每次攻击都要花魔法值，
 * 出手前确实要判断划不划算。同一个元素在两个游戏里的答案相反，取决于它
 * 喂给哪个决定。）
 *
 * 机制留着，`elite` 一打开就有。没有精英时两个血条 mesh 的 `count` 是 0，
 * 不花任何代价。
 */

/** 池子上限。超过这个数的生成会被丢掉而不是悄悄扩容：一次分配好，帧里不碰
 *  内存，是这类系统唯一能稳住的形状。 */
const MAX = 1000;

export type SwarmMode = 'instanced' | 'clone';

export interface Foe {
  x: number; z: number;
  hp: number; maxHp: number;
  speed: number;
  /** 受击闪光剩余秒数。 */
  flash: number;
  /** `clone` 模式下这只敌人自己的对象；实例化模式下是 null。 */
  obj: THREE.Object3D | null;
  /** 每把武器上一次打中这只的时间。见 `damageNear`。 */
  lastHit: Record<string, number>;
  /** 精英/boss。只有它们头上有血条。 */
  elite: boolean;
  /** 被打退的速度，每帧衰减。见 `KNOCK_*`。 */
  kx: number; kz: number;
  /** 挨打之后晃一下，剩余秒数。见 `WOBBLE_*`。 */
  wobble: number;
}

/** 飞碟自己的前后轴。晃动绕它滚。 */
const FWD = new THREE.Vector3(0, 0, 1);
const BODY_Y = 0.42;          // 飞碟离地高度
const BAR_Y = 1.02;           // 血条在头顶多高
const BAR_W = 0.62, BAR_H = 0.09;
const FLASH_SECONDS = 0.16;
/** 挨打往后退：**退多远**、用多久退完。
 *
 *  **「稍微」是重点。** 击退是一种反馈，不是一个机制：它要让每一次命中都
 *  看得出落在了谁身上，而不能把敌人推出武器的作用范围 —— 那会变成「打得
 *  越狠越打不到」。环刃的刀刃半径是 0.75，所以位移必须远小于它。
 *
 *  **参数写成「距离 + 时间常数」，不是「速度 + 衰减率」。** 第一版写的是
 *  速度 5.0、每秒衰减到 2%，本以为位移约 0.25 格 —— 实测 **1.738 格**。
 *  指数衰减的总位移是 `v₀ × τ`，而那组参数的 τ 是 1/ln(1/0.02) ≈ 0.26 秒，
 *  位移 1.28 格，比刀刃半径还大：打一下就把敌人推出自己的射程。
 *  两个参数都「看起来合理」，乘出来的那个数却没人看 —— 所以现在直接写想要
 *  的那个数。
 *
 *  精英只吃四成，不然一只该逼你停下来处理的东西会被你推着走。 */
/** **第二次调这个数，这次按「看不看得见」调。**
 *
 *  0.22 格是量得到、看不见：这个取景下主角本人只有 21 像素高，0.22 格在屏幕上
 *  是个位数像素，而且 0.09 秒就走完 —— 探针说「打了会往后退（0.281 格）」全绿，
 *  玩家说「往后退一下的效果没做么」。**两句话都是对的**，因为我验的是它动了，
 *  没验有人看得见它动。
 *
 *  上限不是环刃（它覆盖离玩家 0.30–1.80 格，敌人贴到 0.7 就停，推到 1.15 还
 *  绰绰有余），是尾迹和冲击那两个 0.85 的半径。0.45 格离它们还有一半余量，
 *  而它已经超过敌人自己的宽度 —— 一次位移大于自身宽度的移动才读得出来。
 *
 *  时间也拉长了一点：0.12 秒比 0.09 秒多几帧，而「看得见」一半是位移、
 *  一半是**它花了几帧走完**。 */
const KNOCK_DIST = 0.45;
const KNOCK_TAU = 0.12;
const KNOCK_SPEED = KNOCK_DIST / KNOCK_TAU;
const KNOCK_ELITE = 0.4;
/** 挨打晃一下：多久、最大倾多少弧度。
 *
 *  **照搬 Balaboo 的两个数**（0.34 秒 / 0.30 弧度 / 三个来回），包括它的理由：
 *  再长就「不再读作被打了一下，而是读作这东西本来就在晃」。
 *
 *  晃和击退是**两件不同的事**，都要有：击退说的是「这一下有力」，晃说的是
 *  「挨打的是它」。只有击退的话，一群挤在一起的敌人被推开时你分不清是哪几只
 *  挨了打；只有晃的话，打击没有重量。 */
const WOBBLE_SECONDS = 0.34;
const WOBBLE_TILT = 0.30;
/** 敌人贴到多近就停。 */
export const CONTACT = 0.7;
/** 多大比例生成在移动方向上，以及那个扇形有多宽。 */
const AHEAD_SHARE = 0.55;
const AHEAD_CONE = Math.PI * 0.8;

export class Swarm {
  readonly foes: Foe[] = [];
  /** 这一帧有几只贴在玩家身上。接触伤害按这个算 —— 一只和十只贴着你，
   *  代价不该一样。 */
  touching = 0;
  /** 死在哪里。
   *
   *  经验宝石要掉在**尸体的位置**上，而 `damageNear` 只返回「死了几只」——
   *  那个数字足够记分，但捡东西是个空间动作：掉在你脚下的经验不构成任何
   *  决定，掉在远处的才逼你走过去。所以死亡要带坐标出来，回调是最便宜的
   *  办法（不必为此每帧分配一个数组）。 */
  onDeath: ((x: number, z: number, elite: boolean) => void) | null = null;
  /** 挨了一下（不管死没死）。
   *
   *  和 `onDeath` 分开，因为它们喂的是两个不同的反馈：死亡是爆裂 + 掉落，
   *  命中是那道白光 + 往后退一下。一次命中同时触发两个的情况（被打死）是
   *  对的 —— 你既看见了这一刀落在哪儿，也看见了它死。 */
  onDamage: ((x: number, z: number, killed: boolean, elite: boolean) => void) | null = null;
  private mode: SwarmMode = 'instanced';

  private geom!: THREE.BufferGeometry;
  private mat!: THREE.Material;
  private proto!: THREE.Object3D;

  private bodies!: THREE.InstancedMesh;
  private barBack!: THREE.InstancedMesh;
  private barFill!: THREE.InstancedMesh;
  /** `clone` 模式下挂所有克隆体的容器，方便整组隐藏/清空。 */
  private clones = new THREE.Group();

  private readonly m = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  /** 晃动那一下的滚转，单独一个 —— `q` 每帧被朝向覆写。 */
  private readonly qRoll = new THREE.Quaternion();
  private readonly qInv = new THREE.Quaternion();
  private readonly pos = new THREE.Vector3();
  private readonly scl = new THREE.Vector3();
  private readonly col = new THREE.Color();
  /** 玩家上一帧在哪。击退要按「远离玩家」推，而伤害是从各把武器里进来的，
   *  它们不一定知道玩家的位置。 */
  private px = 0;
  private pz = 0;
  /** 自己做剔除用的。每帧重建一次，比每只敌人一次投影便宜得多。 */
  private readonly frustum = new THREE.Frustum();
  private readonly viewProj = new THREE.Matrix4();
  private readonly sphere = new THREE.Sphere(new THREE.Vector3(), 0.9);

  constructor(private scene: THREE.Scene) {}

  async load(manifest: Manifest3D, modelId: string): Promise<void> {
    const { object } = await loadModelAsset(manifest, modelId, { assetBase: '' });
    this.proto = object;

    // 取出几何体和材质。模型是单节点单 mesh（查过了），但节点上可能带变换，
    // 所以几何体要先把世界矩阵烘进去 —— 否则实例化之后全体偏移，而且偏移量
    // 恰好等于那个没人注意的节点变换。
    let src: THREE.Mesh | null = null;
    object.updateWorldMatrix(true, true);
    object.traverse((o) => { if (!src && (o as THREE.Mesh).isMesh) src = o as THREE.Mesh; });
    if (!src) throw new Error(`${modelId} 里没有 mesh`);
    const mesh = src as THREE.Mesh;
    this.geom = mesh.geometry.clone().applyMatrix4(mesh.matrixWorld);
    this.mat = (Array.isArray(mesh.material) ? mesh.material[0] : mesh.material).clone();

    this.bodies = new THREE.InstancedMesh(this.geom, this.mat, MAX);
    this.bodies.instanceColor =
      new THREE.InstancedBufferAttribute(new Float32Array(MAX * 3).fill(1), 3);
    this.bodies.castShadow = false;   // 几百个投影体是这里最贵的一件事
    this.bodies.count = 0;
    // 包围球来自基准几何体，而实例散在整张图上。不关掉剔除，整群会在还看得
    // 见的时候消失 —— 和 SDK 对蒙皮网格做的是同一件事。
    this.bodies.frustumCulled = false;
    this.scene.add(this.bodies);

    const quad = new THREE.PlaneGeometry(1, 1);
    const flat = (color: number) => new THREE.MeshBasicMaterial({ color, depthWrite: false });
    this.barBack = new THREE.InstancedMesh(quad, flat(0x121820), MAX);
    this.barFill = new THREE.InstancedMesh(quad, flat(0xffffff), MAX);
    this.barFill.instanceColor =
      new THREE.InstancedBufferAttribute(new Float32Array(MAX * 3).fill(1), 3);
    for (const b of [this.barBack, this.barFill]) {
      b.count = 0; b.frustumCulled = false; b.renderOrder = 4;
      this.scene.add(b);
    }

    this.scene.add(this.clones);
  }

  /** 换画法。会把现有的敌人原地转过去，这样 A/B 比的是同一批敌人。 */
  setMode(mode: SwarmMode): void {
    if (mode === this.mode) return;
    this.mode = mode;
    for (const f of this.foes) {
      if (f.obj) { this.clones.remove(f.obj); f.obj = null; }
      if (mode === 'clone') f.obj = this.makeClone(f.elite);
    }
    this.bodies.count = mode === 'instanced' ? this.foes.length : 0;
    this.barBack.count = this.barFill.count = mode === 'instanced' ? this.foes.length : 0;
  }

  getMode(): SwarmMode { return this.mode; }

  private makeClone(withBar: boolean): THREE.Object3D {
    // `clone(true)` 共享材质 —— 这正是「每只一个克隆」这条路上受击闪光必须
    // 先克隆材质的原因，也正是它贵的地方。这里只为对比，不做闪光。
    const o = this.proto.clone(true);
    // 血条只有精英有 —— 两种模式用同一条规则，否则 A/B 比的是两件不同的事：
    // 一边画了血条另一边没画，差距里就掺了「少画了东西」。
    if (!withBar) { this.clones.add(o); return o; }
    const quad = new THREE.PlaneGeometry(1, 1);
    const back = new THREE.Mesh(quad, new THREE.MeshBasicMaterial({ color: 0x121820, depthWrite: false }));
    const fill = new THREE.Mesh(quad, new THREE.MeshBasicMaterial({ color: 0x4ade5b, depthWrite: false }));
    back.scale.set(BAR_W, BAR_H, 1);
    fill.scale.set(BAR_W, BAR_H * 0.74, 1);
    back.position.y = fill.position.y = BAR_Y / 0.62;   // 抵消整体 0.62 的缩放
    fill.position.z = 0.004;
    o.add(back, fill);
    this.clones.add(o);
    return o;
  }

  /** 在玩家周围的环上放 `n` 只。
   *
   *  `heading` 是玩家正在移动的方向（弧度），给了就**偏向那一侧生成**。
   *
   *  这条是「有没有压力」的关键，不是刷怪数量。玩家速度 4.6、敌人 2.8，
   *  所以往任何方向跑都能制造一个真空 —— **跑是免费的**，再怎么加量也只是
   *  让身后的尾巴更长。偏向移动方向生成之后，跑意味着**撞进新的一批里**，
   *  于是「往哪跑」重新变成一个选择。吸血鬼幸存者不需要专门做这件事，因为
   *  它在屏幕四周生成而玩家总在移动，效果是一样的。 */
  spawn(n: number, ringMin: number, ringMax: number, cx: number, cz: number,
        hp: number, speed: number, heading?: number): void {
    for (let i = 0; i < n && this.foes.length < MAX; i++) {
      // 在玩家周围的一个环上 —— 幸存者类的敌人是从四面八方围过来的，
      // 生成在视野外、走进来。
      //
      // 一部分偏向前方，一部分仍然是四面八方：全放前面会变成「往回跑就没事」，
      // 那只是把同一个漏洞换了个方向。
      const a = heading !== undefined && Math.random() < AHEAD_SHARE
        ? heading + (Math.random() - 0.5) * AHEAD_CONE
        : Math.random() * Math.PI * 2;
      const r = ringMin + Math.random() * (ringMax - ringMin);
      const f: Foe = {
        x: cx + Math.cos(a) * r, z: cz + Math.sin(a) * r,
        // 速度**有分布**，不是人人一个数。快的那些能咬住你、逼你改方向，
        // 慢的堆成墙 —— 一群速度完全一样的敌人会保持队形，那读起来像一堵
        // 平移的墙，而不是一群在追你的东西。
        hp, maxHp: hp, speed: speed * (0.78 + Math.random() * 0.5),
        flash: 0, lastHit: {}, elite: false, kx: 0, kz: 0, wobble: 0,
        obj: this.mode === 'clone' ? this.makeClone(false) : null,
      };
      this.foes.push(f);
    }
    this.sync();
  }

  /** 放一只精英。
   *
   *  和一批杂兵是同一段生成逻辑，只是**一只、血厚、有血条、走得慢**。
   *  慢是刻意的：精英的作用是逼你停下来处理它，而一个既厚又追得上你的
   *  东西只会把「绕圈跑」这唯一的答案也删掉。 */
  spawnElite(ringMin: number, ringMax: number, cx: number, cz: number,
             hp: number, speed: number): void {
    if (this.foes.length >= MAX) return;
    const a = Math.random() * Math.PI * 2;
    const r = ringMin + Math.random() * (ringMax - ringMin);
    this.foes.push({
      x: cx + Math.cos(a) * r, z: cz + Math.sin(a) * r,
      hp, maxHp: hp, speed, flash: 0, lastHit: {}, elite: true, kx: 0, kz: 0, wobble: 0,
      obj: this.mode === 'clone' ? this.makeClone(false) : null,
    });
    this.sync();
  }

  /** 打一片区域里的所有敌人。返回杀掉几只。
   *
   *  `tag` 是**每把武器各自的命中节流**，不是全局的。吸血鬼幸存者里每把武器
   *  对同一个目标都有自己的再命中间隔 —— 没有它，一把环刃在贴身的那一帧里
   *  会把敌人打成碎末，伤害数值也就失去意义了。
   *
   *  从后往前遍历：`remove` 是交换删除，会把最后一只挪到当前位置，正着走
   *  会漏掉那一只。 */
  damageNear(x: number, z: number, radius: number, amount: number,
             tag: string, cooldown: number, now: number): number {
    let killed = 0;
    const r2 = radius * radius;
    for (let i = this.foes.length - 1; i >= 0; i--) {
      const f = this.foes[i];
      const dx = f.x - x, dz = f.z - z;
      if (dx * dx + dz * dz > r2) continue;
      const last = f.lastHit[tag] ?? -1e9;
      if (now - last < cooldown) continue;
      f.lastHit[tag] = now;
      const fx = f.x, fz = f.z, elite = f.elite;
      this.knock(f, x, z);
      const died = this.hit(i, amount);
      if (died) killed += 1;
      this.onDamage?.(fx, fz, died, elite);
    }
    return killed;
  }

  /** 画出来的那三个网格。**探针要能读真正被画的东西，不是读状态。**
   *
   *  「晃了没有」从 `f.wobble` 反推只能证明那个数在变，证明不了它到了画面上 ——
   *  而这两件事之间正好隔着整个渲染分支（剔除、矩阵合成、实例打包）。 */
  get meshes(): { bodies: THREE.InstancedMesh; barBack: THREE.InstancedMesh;
                  barFill: THREE.InstancedMesh } {
    return { bodies: this.bodies, barBack: this.barBack, barFill: this.barFill };
  }

  /** 离某处最近的一只，找不到就是 `null`。
   *
   *  **瞄准规则是武器设计的一半。** 环刃和尾迹不需要它（它们的形状就是答案），
   *  但追踪弹、冲击、闪电都要挑目标，而挑法不同它们就是不同的武器：最近的
   *  那只、正前方那只、还没被这次闪电打过的那只。
   *
   *  `skip` 让链式闪电能跳过已经打过的 —— 没有它，闪电会在两只之间来回弹，
   *  「链」就退化成「对一只打六次」。 */
  nearest(x: number, z: number, maxR: number, skip?: Set<Foe>): Foe | null {
    let best: Foe | null = null;
    let bestD = maxR * maxR;
    for (const f of this.foes) {
      if (skip?.has(f)) continue;
      const dx = f.x - x, dz = f.z - z;
      const d = dx * dx + dz * dz;
      if (d < bestD) { bestD = d; best = f; }
    }
    return best;
  }

  /** 打指定的一只。返回它是否死了。
   *
   *  索引会变（删除是交换删除），所以拿着一只敌人跨帧的武器必须按**对象**
   *  指名，不能按下标 —— 按下标的话，前面死了一只，你的追踪弹就换了个目标。 */
  hitFoe(f: Foe, amount: number, fromX?: number, fromZ?: number): boolean {
    const i = this.foes.indexOf(f);
    if (i < 0) return false;
    const fx = f.x, fz = f.z, elite = f.elite;
    this.knock(f, fromX ?? this.px, fromZ ?? this.pz);
    const died = this.hit(i, amount);
    this.onDamage?.(fx, fz, died, elite);
    return died;
  }

  /** 推一下。方向是**远离玩家**，不是远离伤害来源。
   *
   *  第一版用的是远离来源，量出来击退是 **0** —— 而且它不报错，因为它在
   *  数学上是对的：环刃的刀刃就绕在敌人身上，命中那一刻刀和敌人的距离接近
   *  零，于是「远离来源」的方向是一个长度为零的向量，归一化之后推力也是零。
   *  五把武器里有两把（环刃、尾迹）的来源天然压在目标身上。
   *
   *  远离玩家才是这个类型里击退的意思：被打的东西从你身上弹开。它对五把
   *  武器一致，而且恰好也是玩家会预期的方向 —— 打中的反应该指向「我」，
   *  不是指向某个玩家根本不知道位置的内部坐标。
   *
   *  `fromX/fromZ` 只在敌人正好站在玩家身上时兜底。 */
  private knock(f: Foe, fromX: number, fromZ: number): void {
    let dx = f.x - this.px, dz = f.z - this.pz;
    let d = Math.hypot(dx, dz);
    if (d < 1e-3) { dx = f.x - fromX; dz = f.z - fromZ; d = Math.hypot(dx, dz); }
    if (d < 1e-3) { dx = Math.random() - 0.5; dz = Math.random() - 0.5; d = Math.hypot(dx, dz); }
    const s = KNOCK_SPEED * (f.elite ? KNOCK_ELITE : 1);
    f.kx = (dx / d) * s;
    f.kz = (dz / d) * s;
    // 晃和退是同一下的两半，所以在同一处点起来。
    f.wobble = WOBBLE_SECONDS;
  }

  /** 伤害一只。返回它是否死了。 */
  hit(i: number, amount: number): boolean {
    const f = this.foes[i];
    if (!f) return false;
    f.hp -= amount;
    f.flash = FLASH_SECONDS;
    if (f.hp > 0) return false;
    this.onDeath?.(f.x, f.z, f.elite);
    this.remove(i);
    return true;
  }

  private remove(i: number): void {
    const f = this.foes[i];
    if (f.obj) this.clones.remove(f.obj);
    // 交换删除：把最后一只挪到空位。实例化的矩阵是按下标存的，从中间
    // splice 会让每一只之后的都要重写。
    const last = this.foes.pop()!;
    if (i < this.foes.length) this.foes[i] = last;
    this.sync();
  }

  clear(): void {
    for (const f of this.foes) if (f.obj) this.clones.remove(f.obj);
    this.foes.length = 0;
    this.sync();
  }

  private sync(): void {
    const n = this.mode === 'instanced' ? this.foes.length : 0;
    this.bodies.count = n;
    this.barBack.count = n;
    this.barFill.count = n;
  }

  /** 每帧：朝玩家走，然后把位置写进实例矩阵（或克隆体）。 */
  update(dt: number, px: number, pz: number, camQuat: THREE.Quaternion,
         camera?: THREE.Camera): void {
    // 动画循环比 `load()` 先起来，所以头几帧这些还不存在。没有这道门就是
    // 每帧一条 `Cannot read properties of undefined` —— 游戏照跑，控制台在
    // 刷屏，而这正是「错误多到没人看」的起点。
    if (!this.bodies) return;
    this.px = px; this.pz = pz;
    this.touching = 0;
    const instanced = this.mode === 'instanced';
    if (instanced && camera) {
      camera.updateMatrixWorld();
      this.viewProj.multiplyMatrices(
        (camera as THREE.PerspectiveCamera).projectionMatrix, camera.matrixWorldInverse);
      this.frustum.setFromProjectionMatrix(this.viewProj);
    }
    // `n` 是写进去的实例数，和敌人下标是两回事 —— 屏幕外的敌人照样要走位，
    // 只是不占实例槽。
    let n = 0, bn = 0;
    for (let i = 0; i < this.foes.length; i++) {
      const f = this.foes[i];
      if (f.flash > 0) f.flash = Math.max(0, f.flash - dt);
      // **衰减在剔除之前**。写在下面的绘制分支里的话，屏幕外挨了打的敌人会
      // 把这一下攒着，等走进画面再晃 —— 一个迟到半秒的反馈比没有更糟。
      if (f.wobble > 0) f.wobble = Math.max(0, f.wobble - dt);

      const dx = px - f.x, dz = pz - f.z;
      const d = Math.hypot(dx, dz) || 1;
      // 贴身就停下，不然会挤成一个点。这个距离和武器的射程是**一对**数字 ——
      // 见 `weapons.ts` 里环刃半径的注释。
      if (d > CONTACT) { f.x += (dx / d) * f.speed * dt; f.z += (dz / d) * f.speed * dt; }
      else this.touching += 1;

      // 击退。**加在走位之后**，所以贴身的那只也会被推开 —— 上面那个分支在
      // `d <= CONTACT` 时根本不动它，写在前面的话被围住时的每一次命中都毫无
      // 反应，而那正是最需要看见反馈的时刻。
      if (f.kx || f.kz) {
        f.x += f.kx * dt; f.z += f.kz * dt;
        const keep = Math.exp(-dt / KNOCK_TAU);
        f.kx *= keep; f.kz *= keep;
        if (Math.abs(f.kx) + Math.abs(f.kz) < 0.08) { f.kx = 0; f.kz = 0; }
      }

      if (instanced) {
        // 看不见就不占槽。走位照常算过了 —— 剔除的是绘制，不是行为。
        if (camera) {
          this.sphere.center.set(f.x, BODY_Y, f.z);
          if (!this.frustum.intersectsSphere(this.sphere)) continue;
        }
        this.pos.set(f.x, BODY_Y, f.z);
        this.q.setFromAxisAngle(UP, Math.atan2(dx, dz));
        // 挨打晃一下。**乘在朝向后面**，所以它是绕飞碟自己的前后轴滚 ——
        // 直接写世界 Z 轴的话，朝着不同方向的敌人晃的方向不一样，那读起来
        // 像一阵风刮过去，不像各自挨了一下。
        //
        // 实例化让这件事是免费的：晃动只改这一个矩阵，不新增任何绘制。克隆
        // 那条路上 Balaboo 是写 `obj.rotation.z`，效果一样，代价是每只一个对象。
        if (f.wobble > 0) {
          const w = f.wobble / WOBBLE_SECONDS;
          // 在 k 从 1 走到 0 的过程里来回三次，幅度跟着 k 收 —— 照搬 Balaboo。
          this.q.multiply(this.qRoll.setFromAxisAngle(
            FWD, Math.sin(w * Math.PI * 6) * WOBBLE_TILT * w));
        }
        // 精英大一圈。血条能告诉你它还剩多少，但**得先看见它**才会去读 ——
        // 一个和杂兵长得一样的东西，玩家不会知道自己面对的是另一种问题。
        const sc = f.elite ? 1.15 : 0.62;
        this.scl.set(sc, sc, sc);
        this.bodies.setMatrixAt(n, this.m.compose(this.pos, this.q, this.scl));
        // 受击闪光走 instanceColor：一份材质喂所有实例，改材质等于全场变红。
        const k = f.flash / FLASH_SECONDS;
        this.col.setRGB(1, 1 - k * 0.75, 1 - k * 0.75);
        this.bodies.setColorAt(n, this.col);

        n += 1;
        // 血条只给精英。`bn` 和 `n` 是两个计数 —— 杂兵占敌人槽但不占血条槽。
        if (!f.elite) continue;
        // 相机朝向直接烘进实例矩阵 —— 每只单独做一次四元数运算，400 只就是
        // 1200 次，而这里每帧只有一个朝向。
        const frac = Math.max(0, f.hp / f.maxHp);
        this.pos.set(f.x, BODY_Y + BAR_Y * 1.5, f.z);
        this.scl.set(BAR_W, BAR_H, 1);
        this.barBack.setMatrixAt(bn, this.m.compose(this.pos, camQuat, this.scl));
        // 左对齐：缩放后往左挪半个缺口，这样是从右边空的。
        this.pos.set(f.x - (BAR_W * (1 - frac)) / 2, BODY_Y + BAR_Y * 1.5, f.z);
        this.scl.set(BAR_W * frac, BAR_H * 0.74, 1);
        this.barFill.setMatrixAt(bn, this.m.compose(this.pos, camQuat, this.scl));
        this.col.setRGB(frac > 0.5 ? 0.29 : 1, frac > 0.25 ? 0.87 : 0.29, 0.35);
        this.barFill.setColorAt(bn, this.col);
        bn += 1;
      } else if (f.obj) {
        f.obj.position.set(f.x, BODY_Y, f.z);
        f.obj.rotation.y = Math.atan2(dx, dz);
        // 克隆这条路只用来和实例化对比，所以它必须画出**一样**的东西 ——
        // 两条路长得不一样的话，A/B 比的就不再是同一个画面了。
        f.obj.rotation.z = f.wobble > 0
          ? Math.sin((f.wobble / WOBBLE_SECONDS) * Math.PI * 6)
            * WOBBLE_TILT * (f.wobble / WOBBLE_SECONDS)
          : 0;
        f.obj.scale.setScalar(0.62);
        // 血条面向相机，每只单独算一次 —— 这是克隆那条路上每帧的 CPU 开销，
        // 400 只就是 400 次四元数求逆。实例化那边这件事每帧只做一次。
        this.q.copy(camQuat);
        f.obj.getWorldQuaternion(this.qInv).invert();
        this.q.premultiply(this.qInv);
        for (const c of f.obj.children) c.quaternion.copy(this.q);
      }
    }
    if (instanced) {
      // `count` 是这一帧真正画的数量，不是敌人总数。
      this.bodies.count = n;
      this.barBack.count = bn;
      this.barFill.count = bn;
      this.bodies.instanceMatrix.needsUpdate = true;
      this.barBack.instanceMatrix.needsUpdate = true;
      this.barFill.instanceMatrix.needsUpdate = true;
      if (this.bodies.instanceColor) this.bodies.instanceColor.needsUpdate = true;
      if (this.barFill.instanceColor) this.barFill.instanceColor.needsUpdate = true;
    }
  }
}

const UP = new THREE.Vector3(0, 1, 0);
