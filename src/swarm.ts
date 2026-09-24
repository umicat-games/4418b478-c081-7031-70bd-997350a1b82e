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

interface Foe {
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
}

const BODY_Y = 0.42;          // 飞碟离地高度
const BAR_Y = 1.02;           // 血条在头顶多高
const BAR_W = 0.62, BAR_H = 0.09;
const FLASH_SECONDS = 0.16;
/** 敌人贴到多近就停。 */
export const CONTACT = 0.7;

export class Swarm {
  readonly foes: Foe[] = [];
  /** 这一帧有几只贴在玩家身上。接触伤害按这个算 —— 一只和十只贴着你，
   *  代价不该一样。 */
  touching = 0;
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
  private readonly qInv = new THREE.Quaternion();
  private readonly pos = new THREE.Vector3();
  private readonly scl = new THREE.Vector3();
  private readonly col = new THREE.Color();
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

  spawn(n: number, ringMin: number, ringMax: number, cx: number, cz: number, hp: number, speed: number): void {
    for (let i = 0; i < n && this.foes.length < MAX; i++) {
      // 在玩家周围的一个环上 —— 幸存者类的敌人是从四面八方围过来的，
      // 生成在视野外、走进来。
      const a = Math.random() * Math.PI * 2;
      const r = ringMin + Math.random() * (ringMax - ringMin);
      const f: Foe = {
        x: cx + Math.cos(a) * r, z: cz + Math.sin(a) * r,
        hp, maxHp: hp, speed: speed * (0.85 + Math.random() * 0.3),
        flash: 0, lastHit: {}, elite: false,
        obj: this.mode === 'clone' ? this.makeClone(false) : null,
      };
      this.foes.push(f);
    }
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
      if (this.hit(i, amount)) killed += 1;
    }
    return killed;
  }

  /** 伤害一只。返回它是否死了。 */
  hit(i: number, amount: number): boolean {
    const f = this.foes[i];
    if (!f) return false;
    f.hp -= amount;
    f.flash = FLASH_SECONDS;
    if (f.hp > 0) return false;
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

      const dx = px - f.x, dz = pz - f.z;
      const d = Math.hypot(dx, dz) || 1;
      // 贴身就停下，不然会挤成一个点。这个距离和武器的射程是**一对**数字 ——
      // 见 `weapons.ts` 里环刃半径的注释。
      if (d > CONTACT) { f.x += (dx / d) * f.speed * dt; f.z += (dz / d) * f.speed * dt; }
      else this.touching += 1;

      if (instanced) {
        // 看不见就不占槽。走位照常算过了 —— 剔除的是绘制，不是行为。
        if (camera) {
          this.sphere.center.set(f.x, BODY_Y, f.z);
          if (!this.frustum.intersectsSphere(this.sphere)) continue;
        }
        this.pos.set(f.x, BODY_Y, f.z);
        this.q.setFromAxisAngle(UP, Math.atan2(dx, dz));
        this.scl.set(0.62, 0.62, 0.62);
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
        this.pos.set(f.x, BODY_Y + BAR_Y, f.z);
        this.scl.set(BAR_W, BAR_H, 1);
        this.barBack.setMatrixAt(bn, this.m.compose(this.pos, camQuat, this.scl));
        // 左对齐：缩放后往左挪半个缺口，这样是从右边空的。
        this.pos.set(f.x - (BAR_W * (1 - frac)) / 2, BODY_Y + BAR_Y, f.z);
        this.scl.set(BAR_W * frac, BAR_H * 0.74, 1);
        this.barFill.setMatrixAt(bn, this.m.compose(this.pos, camQuat, this.scl));
        this.col.setRGB(frac > 0.5 ? 0.29 : 1, frac > 0.25 ? 0.87 : 0.29, 0.35);
        this.barFill.setColorAt(bn, this.col);
        bn += 1;
      } else if (f.obj) {
        f.obj.position.set(f.x, BODY_Y, f.z);
        f.obj.rotation.y = Math.atan2(dx, dz);
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
