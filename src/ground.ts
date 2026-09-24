import * as THREE from 'three';
import { loadModelAsset, type Manifest3D } from '@umicat/three-sdk';

/**
 * 没有边界的地面。
 *
 * **为什么必须这样。** 幸存者类唯一的防御动作是跑 —— 把一团敌人拉成尾巴、
 * 绕个大圈、从缝里穿回去。有墙就意味着被逼到角落必死，而且不是因为玩家判断
 * 失误，是因为地图不让他执行那个唯一的答案。吸血鬼幸存者的起始图就是无限
 * 重复的瓦片，没有边。
 *
 * 顺带解决另一件事：「敌人在屏幕外生成、玩家走远就消失」这条规则只在无限
 * 地图上成立 —— 在盒子里，「走远」等于撞墙。
 *
 * **怎么做的。** 一块跟着玩家走的格子，格子数固定，走出去的瓦片被搬到另一
 * 边来（取模），所以内存和绘制都是常数：
 *
 *   - 地砖一个 `InstancedMesh`，**1 次绘制**，不论铺多大
 *   - 景物（树、石头）另一个，同样 1 次
 *
 * 这是刚给敌人用过的同一招。对比一下代价就知道为什么非用不可：这块地在
 * 静态版本里是 2568 个实体，合批之前要 1618 次绘制。
 *
 * **世界是确定性的。** 哪个格子上长树、长哪棵、转多少度，全部由格子坐标
 * 哈希出来，不存任何东西。所以你跑出去再跑回来，看到的是同一片林子 ——
 * 随机生成一次然后忘掉的地图，回头一看全变了，那不是无限地图，那是失忆。
 */

/** 格子边长（以瓦片为单位）。要盖住最远的可见距离还留一圈余量 —— 相机半径
 *  10、俯角 39° 时大约能看到 25 格，所以这个数要明显大于它的两倍。 */
const GRID = 64;
/** 一格多大。和 kit 的瓦片尺寸一致。 */
const CELL = 1;
const TILE_TOP = 0.2;

/** 景物的密度。
 *
 *  0.055 试过，太密了 —— 视野里两百多棵。这个类型要看得见包围圈，一棵挡住
 *  三只敌人的树就是一次看不见的死亡；而且满屏的树会让「我在往哪跑」这件事
 *  变得难读，而跑位是这个游戏的全部。
 *
 *  0.016 大约是视野里六十棵，够让地面不空，又不至于挡路。 */
const SCENERY_CHANCE = 0.016;

/** 确定性哈希：同一个格子永远得到同一个数。
 *
 *  用整数位运算而不是 `Math.sin` 那类技巧 —— 后者在不同浏览器上末位可能不同，
 *  于是同一个世界在两台机器上长得不一样。这里要的是「回头还是那片林子」。 */
function hash2(x: number, z: number): number {
  let h = (x * 374761393 + z * 668265263) | 0;
  h = (h ^ (h >>> 13)) * 1274126177 | 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

export class InfiniteGround {
  private tiles!: THREE.InstancedMesh;
  private scenery!: THREE.InstancedMesh;
  /** 上一次铺的中心格。只有它变了才重铺 —— 玩家在一格内走动不该引发任何工作。 */
  private cx = Number.NaN;
  private cz = Number.NaN;

  private readonly m = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly pos = new THREE.Vector3();
  private readonly scl = new THREE.Vector3(1, 1, 1);
  private readonly up = new THREE.Vector3(0, 1, 0);

  constructor(private scene: THREE.Scene) {}

  async load(manifest: Manifest3D, tileId: string, sceneryId: string): Promise<void> {
    const grab = async (id: string) => {
      const { object } = await loadModelAsset(manifest, id, { assetBase: '' });
      object.updateWorldMatrix(true, true);
      let found: THREE.Mesh | null = null;
      object.traverse((o) => { if (!found && (o as THREE.Mesh).isMesh) found = o as THREE.Mesh; });
      if (!found) throw new Error(`${id} 里没有 mesh`);
      const mesh = found as THREE.Mesh;
      // 几何体先把节点的世界矩阵烘进去。不烘的话实例化之后整片偏移，而偏移量
      // 恰好等于那个没人注意的节点变换。
      return {
        geom: mesh.geometry.clone().applyMatrix4(mesh.matrixWorld),
        mat: (Array.isArray(mesh.material) ? mesh.material[0] : mesh.material).clone(),
      };
    };

    // 两个模型一起取，取完再一起装上。
    //
    // 原来是取一个装一个，于是两次 `await` 之间存在一个瞬间：`tiles` 有了、
    // `scenery` 还没有 —— 而 `update()` 只挡了前者，每帧抛一条
    // `Cannot read properties of undefined`。「加载好了没有」应该是**一个**
    // 状态，不是两个。
    const [t, s] = await Promise.all([grab(tileId), grab(sceneryId)]);

    const tiles = new THREE.InstancedMesh(t.geom, t.mat, GRID * GRID);
    tiles.receiveShadow = true;
    // 包围球来自单块瓦片，而实例铺满整片地 —— 不关掉剔除，整片地会在还看得
    // 见的时候消失。和敌群、和 SDK 对蒙皮网格做的是同一件事。
    tiles.frustumCulled = false;

    const scenery = new THREE.InstancedMesh(s.geom, s.mat, GRID * GRID);
    // 景物不投影。几百棵树的阴影 pass 是这块地最贵的一件事，而它们在
    // 俯视角下几乎看不见 —— Balaboo 对林带也是这么决定的。
    scenery.castShadow = false;
    scenery.frustumCulled = false;

    this.scene.add(tiles, scenery);
    this.tiles = tiles;
    this.scenery = scenery;
  }

  /** 把地铺到玩家脚下。每帧调用，但只有跨格时才真正干活。 */
  update(px: number, pz: number): void {
    // 加载是异步的，而循环比它先开始 —— 见 `main.ts` 里为什么这两件事要
    // 分开处理。
    if (!this.tiles) return;
    const cx = Math.round(px / CELL);
    const cz = Math.round(pz / CELL);
    if (cx === this.cx && cz === this.cz) return;
    this.cx = cx; this.cz = cz;

    const half = GRID >> 1;
    let n = 0, sn = 0;
    for (let ix = -half; ix < half; ix++) {
      for (let iz = -half; iz < half; iz++) {
        const gx = cx + ix, gz = cz + iz;
        const r = hash2(gx, gz);

        this.pos.set(gx * CELL, -TILE_TOP, gz * CELL);
        // 随机转 90° 的倍数，让瓦片的纹理不会连成一条明显的线。
        this.q.setFromAxisAngle(this.up, Math.floor(r * 4) * (Math.PI / 2));
        this.tiles.setMatrixAt(n++, this.m.compose(this.pos, this.q, this.scl));

        // 景物按同一个哈希的另一段决定 —— 同一格永远长同一棵树，转同样的角度。
        const r2 = hash2(gx + 9173, gz - 4271);
        if (r2 < SCENERY_CHANCE) {
          this.pos.set(gx * CELL + (r - 0.5) * 0.5, 0, gz * CELL + (r2 - 0.5) * 6);
          this.q.setFromAxisAngle(this.up, r2 * 200);
          this.scenery.setMatrixAt(sn++, this.m.compose(this.pos, this.q, this.scl));
        }
      }
    }
    this.tiles.count = n;
    this.tiles.instanceMatrix.needsUpdate = true;
    this.scenery.count = sn;
    this.scenery.instanceMatrix.needsUpdate = true;
  }

  /** 供探针问：铺了多少、画几次。 */
  stats(): { tiles: number; scenery: number; centre: [number, number] } {
    return { tiles: this.tiles?.count ?? 0, scenery: this.scenery?.count ?? 0,
             centre: [this.cx, this.cz] };
  }
}
