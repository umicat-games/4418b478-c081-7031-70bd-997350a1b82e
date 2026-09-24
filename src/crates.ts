import * as THREE from 'three';
import { loadModelAsset, type Manifest3D } from '@umicat/three-sdk';

/**
 * 地图上偶尔出现的箱子，和它给的那一下。
 *
 * 从 Balaboo（Polarity 分支）搬过来的，连同那边试出来的两条规矩 —— 它们
 * **不是关于箱子的，是关于「玩家怎么知道自己拿到了什么」的**：
 *
 *  1. **标签写它做什么，不写它叫什么。** 「敌人全部定住」而不是「时停」。
 *     名字只对已经懂这个游戏的人有意义；那边的原始反馈是「我打开了它，没有
 *     任何东西告诉我发生了什么变化」。
 *  2. **颜色是另一半。** 字只在屏幕上待一瞬，而脚下那个圈要陪你走完整段时间，
 *     它得在不重复那句话的前提下说清**是哪一个**。
 *
 * 改动的地方是**箱子摆在哪**。Balaboo 是塔防，箱子掉在后场、你走过去砸开；
 * 这里箱子出现在**离玩家有一段距离**的空地上，去拿它是一个决定 —— 那段路
 * 上有什么、值不值得为它改变走位，正是这个类型里唯一一直在做的判断。
 * 吸血鬼幸存者的宝箱也是这个形状。
 */

/** 多久出一个，和同时最多几个。
 *
 *  稀。一个每隔几秒就冒出来的箱子不构成「要不要去拿」——它会变成路过顺手
 *  捡的东西，而那就退化成经验宝石了。 */
const EVERY = 26;
const MAX_LIVE = 3;
/** 出现在离玩家多远的地方。
 *
 *  **要够远。** 近到顺路就能捡等于没有决定；远到看不见等于没有这个功能。
 *  这个取景往前能看到约 25 格，所以 9~17 格是「看得见、但要专门跑一趟」。 */
const RING: readonly [number, number] = [9, 17];
/** 走多近算拿到。比掉落物的拾取半径大——箱子不该需要精确踩中。 */
const PICK = 1.1;
/** 箱子在地上待多久没人拿就消失。
 *
 *  有期限，否则整张图会慢慢铺满没人要的箱子，而且「现在去还是待会儿去」
 *  这个判断也就不存在了。 */
const LIFE = 30;

export interface BuffKind {
  id: string;
  /** **写它做什么，不写它叫什么。** 见文件头。 */
  label: string;
  /** 脚下那个圈的颜色，也是箱子本身的颜色。 */
  color: number;
  /** 立刻发生、然后就结束的那种。不戴圈、不倒计时。 */
  instant?: boolean;
}

export const BUFFS: BuffKind[] = [
  // 玩家点名要的那一个。
  { id: 'freeze', label: '敌人全部定住', color: 0x7fd4ff },
  { id: 'shield', label: '什么都伤不到你', color: 0x6ec8ff },
  { id: 'haste', label: '你跑得飞快', color: 0xa8ff8a },
  // 立刻结算的两个。它们没有「一段时间」可以用 —— 效果在落地那一帧就完成了。
  { id: 'wipe', label: '场上一扫而空', color: 0xffe08a, instant: true },
  { id: 'vacuum', label: '全图掉落飞向你', color: 0xff9ad2, instant: true },
];

/** 一段 buff 持续多久。 */
export const BUFF_SECONDS = 9;

interface Crate { x: number; z: number; life: number; kind: BuffKind; }

export class Crates {
  private mesh: THREE.InstancedMesh | null = null;
  private crates: Crate[] = [];
  private timer = EVERY * 0.45;

  private readonly m = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly pos = new THREE.Vector3();
  private readonly scl = new THREE.Vector3();
  private readonly up = new THREE.Vector3(0, 1, 0);
  private readonly col = new THREE.Color();

  constructor(private readonly scene: THREE.Scene) {}

  /** 箱子用 kit 里的 `crate`（和场景里的箱子同一个模型）。
   *
   *  一个实例化网格 —— 同时最多三个，本来也可以三个 `Mesh`，但那是三次绘制，
   *  而这个游戏的预算按个位数在算。 */
  async load(manifest: Manifest3D, modelId = 'crate'): Promise<void> {
    const { object } = await loadModelAsset(manifest, modelId, { assetBase: '' });
    object.updateWorldMatrix(true, true);
    let src: THREE.Mesh | null = null;
    object.traverse((o) => { if (!src && (o as THREE.Mesh).isMesh) src = o as THREE.Mesh; });
    if (!src) throw new Error(`${modelId} 里没有 mesh`);
    const mesh = src as THREE.Mesh;
    const geom = mesh.geometry.clone().applyMatrix4(mesh.matrixWorld);
    geom.computeBoundingBox();
    const size = new THREE.Vector3();
    geom.boundingBox!.getSize(size);
    geom.center();
    // 归一化到 0.62 高 —— 和敌人差不多大，比掉落物大得多。它要在一屏几百只
    // 敌人里被一眼认出来，所以不能和宝石一个量级。
    const k = 0.62 / Math.max(size.x, size.y, size.z);
    geom.scale(k, k, k);

    const mat = (Array.isArray(mesh.material) ? mesh.material[0] : mesh.material).clone();
    // 逐实例染色：箱子的颜色就是它里面那个 buff 的颜色。**开之前就知道是什么**
    // ——这样「去不去拿」才是个有信息的决定，而不是一次抽奖。
    (mat as THREE.MeshStandardMaterial).color?.setHex(0xffffff);
    this.mesh = new THREE.InstancedMesh(geom, mat, MAX_LIVE);
    this.mesh.instanceColor =
      new THREE.InstancedBufferAttribute(new Float32Array(MAX_LIVE * 3).fill(1), 3);
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    this.scene.add(this.mesh);
  }

  get count(): number { return this.crates.length; }

  /** 走一帧。返回这一帧被捡到的 buff（没有就是 `null`）。 */
  update(dt: number, px: number, pz: number, now: number): BuffKind | null {
    const mesh = this.mesh;
    if (!mesh) return null;

    this.timer -= dt;
    if (this.timer <= 0) {
      this.timer = EVERY;
      if (this.crates.length < MAX_LIVE) {
        const a = Math.random() * Math.PI * 2;
        const r = RING[0] + Math.random() * (RING[1] - RING[0]);
        this.crates.push({
          x: px + Math.cos(a) * r, z: pz + Math.sin(a) * r,
          life: LIFE, kind: BUFFS[Math.floor(Math.random() * BUFFS.length)],
        });
      }
    }

    let got: BuffKind | null = null;
    let n = 0;
    for (let i = this.crates.length - 1; i >= 0; i--) {
      const c = this.crates[i];
      c.life -= dt;
      const took = Math.hypot(px - c.x, pz - c.z) < PICK;
      if (took || c.life <= 0) {
        if (took) got = c.kind;
        const last = this.crates.pop()!;
        if (i < this.crates.length) this.crates[i] = last;
        continue;
      }
      // 上下浮 + 慢慢转。**静止的箱子在一屏乱动的东西里是看不见的** ——
      // 动起来才会被余光抓住，而这正是它要的：你得先注意到它。
      this.pos.set(c.x, 0.42 + Math.sin(now * 2 + c.x) * 0.09, c.z);
      this.q.setFromAxisAngle(this.up, now * 0.9 + c.x);
      // 快过期的时候缩一下，这样「还来得及吗」是看得出来的。
      const s = c.life < 3 ? 0.55 + 0.45 * (c.life / 3) : 1;
      this.scl.setScalar(s);
      mesh.setMatrixAt(n, this.m.compose(this.pos, this.q, this.scl));
      this.col.setHex(c.kind.color);
      mesh.setColorAt(n, this.col);
      n += 1;
    }
    mesh.count = n;
    mesh.visible = n > 0;    // 空的实例化网格也要一次绘制，见 `sparks.ts`
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    return got;
  }

  /** 探针读：现在地上有哪些箱子。 */
  get list(): { x: number; z: number; id: string; life: number }[] {
    return this.crates.map((c) => ({ x: c.x, z: c.z, id: c.kind.id, life: c.life }));
  }

  /** 立刻放一个，指定里面是什么 —— 探针用。 */
  put(x: number, z: number, id: string): void {
    const kind = BUFFS.find((k) => k.id === id);
    if (kind && this.crates.length < MAX_LIVE) {
      this.crates.push({ x, z, life: LIFE, kind });
    }
  }

  clear(): void {
    this.crates.length = 0;
    this.timer = EVERY * 0.45;
    if (this.mesh) { this.mesh.count = 0; this.mesh.visible = false; }
  }
}
