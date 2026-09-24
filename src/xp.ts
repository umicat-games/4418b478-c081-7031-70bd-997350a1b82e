import * as THREE from 'three';
import { loadModelAsset, type Manifest3D } from '@umicat/three-sdk';

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
/** 吸取半径。
 *
 *  **3.2 是个 bug，虽然它是"掉落物不见了"的样子报出来的。** 环刃杀敌的范围是
 *  离玩家 0.30~1.80 格，而 3.2 把整个范围罩住了 —— 每一颗宝石掉下来的**那一
 *  帧**就已经在吸取半径里，眨眼就飞进玩家身体。于是掉落**全都在掉**（探针量
 *  到 200/200），但地上从来没有东西，玩家看到的是「打死敌人不掉东西」。
 *
 *  探针那句「每只都掉经验」是真的，也是没用的：它验的是掉落发生了，不是
 *  **掉落看得见**。和击退那次是同一个错。
 *
 *  1.4 比环刃的外沿（1.80）小，所以在刀圈外缘死掉的敌人，宝石会**留在地上**，
 *  你得走过去。吸血鬼幸存者里基础拾取半径也很小 —— 满地的宝石正是那个画面。 */
const MAGNET_BASE = 1.4;
/** 掉出来那一下：飞多久、飞多远。
 *
 *  **这才是真正让掉落看得见的那半。** 只把吸取半径调小，死在你脚边的敌人
 *  掉的东西照样是瞬间消失；而这个类型里大部分敌人正是死在你脚边。
 *
 *  所以掉落先**弹出去**：从尸体上抛一小段弧，这段时间里磁吸完全不生效。
 *  0.42 秒足够眼睛注册到"有东西出来了"，短到不影响手感。 */
const POP_TIME = 0.42;
const POP_DIST = 0.85;

/** 升到下一级要多少。`level` 是当前等级（从 1 开始）。 */
export const xpToNext = (level: number): number => 5 + (level - 1) * 8;

interface Gem {
  x: number; z: number; value: number; t: number;
  /** 弹出去那一下的起点、方向和剩余时间。`pop <= 0` 就是已经落地了。 */
  sx: number; sz: number; tx: number; tz: number; pop: number;
}

/** 地上可以捡的东西，一种一个池子。
 *
 *  经验宝石和金币是**同一件事的两个实例** —— 都掉在尸体上、都被吸过来、都
 *  是一次绘制。所以磁吸那段代码只写一遍：两边各抄一份的话，改吸取手感就得
 *  记得改两处，而漏掉的那一处会变成「金币吸得比经验慢」这种谁也说不清原因
 *  的手感问题。
 *
 *  不同的只有长什么样和捡到之后算什么 —— 那两件事由构造参数和调用方决定。 */
export class Pickups {
  private mesh: THREE.InstancedMesh | null = null;
  private gems: Gem[] = [];
  /** 模型里那个网格的原始尺寸，归一化用，也给探针读。 */
  private size = new THREE.Vector3();

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

  constructor(private readonly scene: THREE.Scene,
              private readonly look: { spin?: number; bob?: number; tall?: number }) {
    this.spin = look.spin ?? 1.6;
    this.bob = look.bob ?? 0.05;
  }

  /**
   * 从 kit 里拿一个模型来当掉落物。
   *
   * **尺寸按包围盒归一化，不写死缩放。** Kenney 的模型各自为自己的场景做的大小
   * （金币是给横版平台游戏用的），写死一个 `scale` 等于在猜，而且换一个模型就
   * 又要重猜一次。这里量出它自己的高，再缩到我们想要的那个高 —— 想要多高是个
   * 设计决定（主角 0.72），模型原本多大不是。
   *
   * 抽几何 + 材质那几行和 `Swarm.load` 是同一套，包括**把节点变换烘进几何**
   * 这个坑：模型里那个 mesh 节点上可能带平移，不烘的话所有实例会整体偏移，
   * 而偏移量恰好等于那个没人注意的节点变换。
   */
  async load(manifest: Manifest3D, modelId: string): Promise<void> {
    const { object } = await loadModelAsset(manifest, modelId, { assetBase: '' });
    object.updateWorldMatrix(true, true);
    let src: THREE.Mesh | null = null;
    object.traverse((o) => { if (!src && (o as THREE.Mesh).isMesh) src = o as THREE.Mesh; });
    if (!src) throw new Error(`${modelId} 里没有 mesh`);
    const mesh = src as THREE.Mesh;

    const geom = mesh.geometry.clone().applyMatrix4(mesh.matrixWorld);
    geom.computeBoundingBox();
    geom.boundingBox!.getSize(this.size);
    // 以自己的中心为原点，否则模型自带的偏心会变成「宝石飘在尸体旁边一点点」。
    geom.center();
    const tall = this.look.tall ?? 0.34;
    const k = tall / Math.max(this.size.x, this.size.y, this.size.z);
    geom.scale(k, k, k);

    const mat = (Array.isArray(mesh.material) ? mesh.material[0] : mesh.material).clone();
    this.mesh = new THREE.InstancedMesh(geom, mat, MAX);
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = false;
    this.mesh.count = 0;
    this.scene.add(this.mesh);
  }

  /** 原始模型的尺寸 —— 探针读它来确认拿到的是哪个模型、朝向对不对。 */
  get modelSize(): { x: number; y: number; z: number } {
    return { x: +this.size.x.toFixed(3), y: +this.size.y.toFixed(3), z: +this.size.z.toFixed(3) };
  }

  drop(x: number, z: number, value = 1): void {
    if (this.gems.length >= MAX) return;
    const a = Math.random() * Math.PI * 2;
    const r = POP_DIST * (0.55 + Math.random() * 0.7);
    this.gems.push({
      x, z, value, t: 0,
      sx: x, sz: z, tx: x + Math.cos(a) * r, tz: z + Math.sin(a) * r,
      pop: POP_TIME,
    });
  }

  get count(): number { return this.gems.length; }

  /** 走一帧。返回这一帧捡到多少经验。 */
  update(dt: number, px: number, pz: number, now: number): number {
    // 动画循环比 `load()` 先起来。没有这道门就是头几帧每帧一条
    // `Cannot read properties of null` —— 游戏照跑，控制台在刷屏。
    const mesh = this.mesh;
    if (!mesh) return 0;
    let got = 0;
    let n = 0;
    for (let i = this.gems.length - 1; i >= 0; i--) {
      const g = this.gems[i];
      g.t += dt;

      // 还在弹出去的路上：走自己的弧，**不理磁吸，也捡不起来**。
      if (g.pop > 0) {
        g.pop = Math.max(0, g.pop - dt);
        const k = 1 - g.pop / POP_TIME;
        // 缓出 —— 弹出去是被炸飞的，该是快出慢停，不是匀速平移。
        const e = 1 - (1 - k) * (1 - k);
        g.x = g.sx + (g.tx - g.sx) * e;
        g.z = g.sz + (g.tz - g.sz) * e;
        // 抛物线：中途最高。
        const hop = Math.sin(Math.PI * k) * 0.55;
        this.pos.set(g.x, 0.24 + hop, g.z);
        this.q.setFromAxisAngle(this.up, now * this.spin + g.t);
        mesh.setMatrixAt(n++, this.m.compose(this.pos, this.q, this.scl));
        continue;
      }

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
      mesh.setMatrixAt(n++, this.m.compose(this.pos, this.q, this.scl));
    }
    mesh.count = n;
    mesh.visible = n > 0;        // 空的实例化网格仍然要一次绘制，见 `sparks.ts`
    mesh.instanceMatrix.needsUpdate = true;
    return got;
  }

  clear(): void { this.gems.length = 0; if (this.mesh) this.mesh.count = 0; }
}

/**
 * 两种掉落物，都来自 **Kenney 的 Platformer Kit**（`public/kit/platformer/`，
 * CC0），和场景里的树、箱子是同一套 —— 这本身就是选它的理由之一：同一个美术
 * 包里的东西放在一起自然是对的，自己搓的几何体再怎么调色都像是外来的。
 *
 * 那个 kit 里有一整个 `pickup` 分类（`public/kit/index.json` 可查）：
 * `coin-gold` / `coin-silver` / `coin-bronze` / `jewel` / `heart` / `star` /
 * `key`。金币用 `coin-gold`（Balaboo 用的就是这一个），经验用 `jewel`。
 * 三色金币留着给将来的面值分级，`heart` 留给回血掉落。
 */

/** 经验宝石：Kenney 的 `jewel`，慢慢转。 */
export const makeGems = (scene: THREE.Scene): Pickups =>
  new Pickups(scene, { spin: 1.6, bob: 0.05, tall: 0.34 });

/** 金币：Kenney 的 `coin-gold`，转得快一点。
 *
 *  金币比宝石稍大一点点，因为它更稀有（9%）—— 稀有的东西值得更显眼，
 *  而且这样两种掉落物在余光里也分得开。 */
export const makeCoins = (scene: THREE.Scene): Pickups =>
  new Pickups(scene, { spin: 4.2, bob: 0.07, tall: 0.4 });
