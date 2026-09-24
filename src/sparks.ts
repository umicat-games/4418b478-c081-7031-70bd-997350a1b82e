import * as THREE from 'three';
import { atlas, setFrameUv, FRAME } from './vfx';

/**
 * 粒子。**一个池子、一次绘制、帧里不分配内存。**
 *
 * 搬过来的 `vfx.ts` 里已经有 `motes()`，而它在这里是错的 —— 这件事值得写下来，
 * 因为两边的代码都没问题，是**场景变了**：
 *
 *   `motes()` 每次调用**新建**一份几何、一份材质、一个 `InstancedMesh`，然后
 *   交给 `Vfx` 注册表管生命周期。塔防里一次爆炸、一发炮弹，一秒钟有个位数的
 *   特效，这个形状非常合适。
 *
 *   这个游戏后段**每秒死三十只**。那就是每秒三十次分配、三十次绘制，而 `Vfx`
 *   的 `MAX_LIVE = 48` 会在一秒半内塞满，然后开始丢最老的 —— 结果是特效
 *   **互相挤掉**：你刚打死的那只没有火花，因为一秒前的那批还占着位置。
 *
 * 所以这里和敌群走同一条路：**一个常驻的 `InstancedMesh`，粒子是一个环形
 * 缓冲区里的槽位**。爆一次就是往池子里写几十个槽，没有 `new`，没有新的绘制
 * 调用。池子满了就覆盖最老的粒子 —— 覆盖一颗火星，而不是丢掉一整次爆炸。
 *
 * 这是这个项目反复出现的同一个形状：**按只算的东西要变成按批算的。**
 */

/** 池子有多大。3000 颗 × 一次爆 14 颗 ≈ 同时能有两百多次爆炸在空中。 */
const MAX = 3000;
/** 重力。粒子往上飞再落下来 —— 匀速直线飞出去读起来像碎纸片。 */
const GRAV = 5.2;

export interface BurstOpts {
  /** 几颗。 */
  count?: number;
  color: number;
  /** 三分之一的粒子用这个颜色。两色的爆炸比单色的有层次得多。 */
  color2?: number;
  /** 初速度，和它的随机范围。 */
  speed?: number;
  /** 往上偏多少 —— 0 是平着炸开，1 是喷泉。 */
  up?: number;
  life?: number;
  size?: number;
  /** 贴图里的哪一格。不给就是个方块 —— 0.09 大小的白方块读起来像纸屑，
   *  不像火星（这是 `vfx.ts` 里记下来的教训，照搬）。 */
  frame?: number;
}

export class Sparks {
  private mesh!: THREE.InstancedMesh;
  /** 环形缓冲区的写指针。 */
  private head = 0;

  // 每颗粒子的状态，全部平铺在类型化数组里。一颗粒子一个对象的话，三千个
  // 对象每帧都要被 GC 扫一遍 —— 这类系统的代价从来不在数学上。
  private readonly px = new Float32Array(MAX);
  private readonly py = new Float32Array(MAX);
  private readonly pz = new Float32Array(MAX);
  private readonly vx = new Float32Array(MAX);
  private readonly vy = new Float32Array(MAX);
  private readonly vz = new Float32Array(MAX);
  /** 剩余寿命和总寿命。`life <= 0` 就是这个槽是空的。 */
  private readonly life = new Float32Array(MAX);
  private readonly born = new Float32Array(MAX);
  private readonly size = new Float32Array(MAX);
  private readonly cr = new Float32Array(MAX);
  private readonly cg = new Float32Array(MAX);
  private readonly cb = new Float32Array(MAX);

  private readonly m = new THREE.Matrix4();
  private readonly pos = new THREE.Vector3();
  private readonly scl = new THREE.Vector3();
  private readonly col = new THREE.Color();
  private readonly c1 = new THREE.Color();
  private readonly c2 = new THREE.Color();

  constructor(scene: THREE.Scene) {
    const geom = new THREE.PlaneGeometry(1, 1);
    setFrameUv(geom, FRAME.sparkle);
    const mat = new THREE.MeshBasicMaterial({
      map: atlas(), transparent: true, depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.mesh = new THREE.InstancedMesh(geom, mat, MAX);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.instanceColor =
      new THREE.InstancedBufferAttribute(new Float32Array(MAX * 3), 3);
    this.mesh.frustumCulled = false;   // 实例散在全图上，包围球来自单个四边形
    this.mesh.renderOrder = 4;
    this.mesh.count = 0;
    scene.add(this.mesh);
  }

  /** 在某处炸一把火星。 */
  burst(x: number, y: number, z: number, o: BurstOpts): void {
    const n = o.count ?? 12;
    const speed = o.speed ?? 3.2;
    const up = o.up ?? 0.8;
    const life = o.life ?? 0.5;
    const size = o.size ?? 0.16;
    this.c1.set(o.color);
    this.c2.set(o.color2 ?? o.color);
    for (let k = 0; k < n; k++) {
      const i = this.head;
      this.head = (this.head + 1) % MAX;   // 满了就覆盖最老的一颗
      const a = Math.random() * Math.PI * 2;
      const s = speed * (0.45 + Math.random() * 0.9);
      // `Math.sqrt(random)` 而不是 `random`：均匀取半径会让粒子挤在中心，
      // 因为外圈的面积大得多。爆炸看起来该是空心的。
      const flat = Math.sqrt(Math.random());
      this.px[i] = x; this.py[i] = y; this.pz[i] = z;
      this.vx[i] = Math.cos(a) * s * flat;
      this.vz[i] = Math.sin(a) * s * flat;
      this.vy[i] = s * up * (0.4 + Math.random() * 0.9);
      this.life[i] = this.born[i] = life * (0.7 + Math.random() * 0.6);
      this.size[i] = size * (0.7 + Math.random() * 0.7);
      const c = k % 3 === 0 ? this.c2 : this.c1;
      this.cr[i] = c.r; this.cg[i] = c.g; this.cb[i] = c.b;
    }
  }

  /** 一条从 a 到 b 的火星流。链式闪电和冲击波用它把「打到了哪几只」画出来。 */
  streak(ax: number, ay: number, az: number,
         bx: number, by: number, bz: number, o: BurstOpts): void {
    const n = o.count ?? 10;
    for (let k = 0; k < n; k++) {
      const t = (k + Math.random()) / n;
      this.burst(ax + (bx - ax) * t, ay + (by - ay) * t, az + (bz - az) * t,
                 { ...o, count: 1, speed: (o.speed ?? 1.4) * 0.5 });
    }
  }

  /** 走一帧。`camQuat` 是相机朝向 —— **每帧只读一次**，直接烘进实例矩阵，
   *  而不是每颗粒子做一次四元数运算（三千颗就是三千次）。 */
  update(dt: number, camQuat: THREE.Quaternion): void {
    let n = 0;
    for (let i = 0; i < MAX; i++) {
      const l = this.life[i];
      if (l <= 0) continue;
      const left = l - dt;
      this.life[i] = left;
      if (left <= 0) continue;

      this.vy[i] -= GRAV * dt;
      this.px[i] += this.vx[i] * dt;
      this.py[i] += this.vy[i] * dt;
      this.pz[i] += this.vz[i] * dt;
      // 落地就停住往下掉，别穿到地板底下去。
      if (this.py[i] < 0.04) { this.py[i] = 0.04; this.vy[i] = 0; this.vx[i] *= 0.82; this.vz[i] *= 0.82; }

      const k = 1 - left / this.born[i];
      const fade = 1 - k * k;
      this.pos.set(this.px[i], this.py[i], this.pz[i]);
      this.scl.setScalar(this.size[i] * (1 - k * 0.5));
      this.mesh.setMatrixAt(n, this.m.compose(this.pos, camQuat, this.scl));
      // 加色混合里，把颜色压向黑就等于淡出 —— 而颜色是能按实例给的，
      // 透明度不是。
      this.col.setRGB(this.cr[i] * fade, this.cg[i] * fade, this.cb[i] * fade);
      this.mesh.setColorAt(n, this.col);
      n += 1;
    }
    this.mesh.count = n;
    // **空的就藏起来。** `count === 0` 的 `InstancedMesh` 照样会被提交一次
    // 绘制（渲染器仍然调 `drawElementsInstanced`，只是实例数是 0）。空场因此
    // 从 9 次涨到了 13 次 —— 五个常驻的池子，一个一次，全是白付的。
    this.mesh.visible = n > 0;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }

  /** 现在有几颗活着 —— 探针读它。 */
  get live(): number { return this.mesh.count; }

  clear(): void { this.life.fill(0); this.mesh.count = 0; }
}


/**
 * 击中的那道白光：**两头尖、中间宽**的一片，横在被打的那只身上。
 *
 * 形状是从 Balaboo 的 `slashFlash` 搬来的（`vfx.ts` 里那份），连同它调出来的
 * 那个指数：`sin(πt)^0.62`。低于 0.5 左右它就不再有尖，变成一根胶囊 —— 那条
 * 注释是原作者试出来的，照抄。
 *
 * **但实现必须换掉。** 原版一次命中新建一份几何、一份 `ShaderMaterial`、一个
 * `Mesh`，交给 `Vfx` 注册表。塔防里一次挥砍一次，这里后段**每秒上百次命中**
 * —— 那就是每秒上百次分配、上百次绘制，而 `Vfx` 的 48 个槽会在半秒内被塞满
 * 然后开始互相挤掉。
 *
 * 所以：一个常驻 `InstancedMesh`，池化，一次绘制。
 *
 * 代价是没有那个 shader 了（实例化 + `ShaderMaterial` 要自己处理实例矩阵
 * 注入）。原 shader 做的两件事 —— 中线发白、两端收暗 —— 改成**烘进顶点色**：
 * 几何是程序生成的，把 `body × taper` 直接写进颜色属性，再用 `instanceColor`
 * 乘上「这一下的颜色 × 还剩多亮」。加色混合下，亮度就是不透明度，所以这两层
 * 相乘出来的画面和原来那个 shader 几乎一样，而且不用写一行 GLSL。
 */

/** 同时最多有几道。上限到了就覆盖最老的一道。 */
const SLASH_MAX = 96;

export class Slashes {
  private mesh!: THREE.InstancedMesh;
  private head = 0;
  private readonly px = new Float32Array(SLASH_MAX);
  private readonly py = new Float32Array(SLASH_MAX);
  private readonly pz = new Float32Array(SLASH_MAX);
  private readonly roll = new Float32Array(SLASH_MAX);
  private readonly scale = new Float32Array(SLASH_MAX);
  private readonly life = new Float32Array(SLASH_MAX);
  private readonly born = new Float32Array(SLASH_MAX);
  private readonly cr = new Float32Array(SLASH_MAX);
  private readonly cg = new Float32Array(SLASH_MAX);
  private readonly cb = new Float32Array(SLASH_MAX);

  private readonly m = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly qz = new THREE.Quaternion();
  private readonly fwd = new THREE.Vector3(0, 0, 1);
  private readonly pos = new THREE.Vector3();
  private readonly scl = new THREE.Vector3();
  private readonly col = new THREE.Color();
  private readonly tmp = new THREE.Color();

  constructor(scene: THREE.Scene) {
    const SEG = 24;
    const LEN = 1.0, THICK = 0.13;
    const n = (SEG + 1) * 2;
    const pos = new Float32Array(n * 3);
    const col = new Float32Array(n * 3);
    for (let i = 0; i <= SEG; i++) {
      const t = i / SEG;
      // 0.62 这个指数是 Balaboo 那边试出来的：再低就没有尖了。
      const h = THICK * Math.pow(Math.sin(Math.PI * t), 0.62);
      const x = (t - 0.5) * LEN;
      // 两端收暗，否则尖是被硬切断的。
      const taper = Math.pow(Math.sin(Math.PI * t), 0.45);
      const o = i * 2;
      pos[o * 3] = x; pos[o * 3 + 1] = -h; pos[o * 3 + 2] = 0;
      pos[o * 3 + 3] = x; pos[o * 3 + 4] = h; pos[o * 3 + 5] = 0;
      // 边缘是 0、中线是 1（原 shader 里的 `core²`）。顶点只有上下两排，
      // 中线靠的是这两排都压暗、让三角形内部插值出中间亮 —— 所以边缘写
      // `taper * 0.12` 而不是 0，不然整片会暗成一条线。
      const edge = taper * 0.12;
      for (let c = 0; c < 3; c++) { col[o * 3 + c] = edge; col[o * 3 + 3 + c] = edge; }
    }
    // 再补一排**中线**顶点，亮度拉满 —— 中间宽、中线最亮，这才是那道光。
    const mid = new Float32Array((SEG + 1) * 3);
    const midCol = new Float32Array((SEG + 1) * 3);
    for (let i = 0; i <= SEG; i++) {
      const t = i / SEG;
      const taper = Math.pow(Math.sin(Math.PI * t), 0.45);
      mid[i * 3] = (t - 0.5) * LEN; mid[i * 3 + 1] = 0; mid[i * 3 + 2] = 0;
      for (let c = 0; c < 3; c++) midCol[i * 3 + c] = taper;
    }
    const allPos = new Float32Array(pos.length + mid.length);
    allPos.set(pos); allPos.set(mid, pos.length);
    const allCol = new Float32Array(col.length + midCol.length);
    allCol.set(col); allCol.set(midCol, col.length);
    const midBase = n;
    // 上半片和下半片各自和中线缝起来。
    const tri: number[] = [];
    for (let i = 0; i < SEG; i++) {
      const a = i * 2, b = (i + 1) * 2;          // 下沿
      const a2 = a + 1, b2 = b + 1;              // 上沿
      const mA = midBase + i, mB = midBase + i + 1;
      tri.push(a, mA, b, mA, mB, b);
      tri.push(mA, a2, mB, a2, b2, mB);
    }

    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.BufferAttribute(allPos, 3));
    geom.setAttribute('color', new THREE.BufferAttribute(allCol, 3));
    geom.setIndex(tri);

    const mat = new THREE.MeshBasicMaterial({
      vertexColors: true, transparent: true, depthWrite: false,
      depthTest: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
    });
    this.mesh = new THREE.InstancedMesh(geom, mat, SLASH_MAX);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.instanceColor =
      new THREE.InstancedBufferAttribute(new Float32Array(SLASH_MAX * 3), 3);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 9;
    this.mesh.count = 0;
    scene.add(this.mesh);
  }

  /** 在某处划一道。 */
  cut(x: number, y: number, z: number, color = 0xffd9c2, power = 0): void {
    const i = this.head;
    this.head = (this.head + 1) % SLASH_MAX;
    this.px[i] = x; this.py[i] = y; this.pz[i] = z;
    // 每道角度都不一样。每次都落在同一个角度上，读起来像盖章，不像划了一刀。
    this.roll[i] = (Math.random() - 0.5) * 0.9;
    this.scale[i] = 0.7 + power * 0.5;
    this.life[i] = this.born[i] = 0.16;
    this.tmp.set(color);
    this.cr[i] = this.tmp.r; this.cg[i] = this.tmp.g; this.cb[i] = this.tmp.b;
  }

  update(dt: number, camQuat: THREE.Quaternion): void {
    let n = 0;
    for (let i = 0; i < SLASH_MAX; i++) {
      const l = this.life[i];
      if (l <= 0) continue;
      const left = l - dt;
      this.life[i] = left;
      if (left <= 0) continue;
      const k = 1 - left / this.born[i];
      // 起得快、落得慢 —— 一次冲击是攻击，不是淡入。原作者的原话。
      const bright = k < 0.18 ? k / 0.18 : 1 - (k - 0.18) / 0.82;
      this.pos.set(this.px[i], this.py[i], this.pz[i]);
      // 面向相机，再绕自己的法线转一点。
      this.q.copy(camQuat).multiply(this.qz.setFromAxisAngle(this.fwd, this.roll[i]));
      // 沿自己的长度长出去 —— 这是让它读起来像「穿过去」而不是「出现在上面」。
      this.scl.set(this.scale[i] * (0.82 + k * 0.5), this.scale[i], 1);
      this.mesh.setMatrixAt(n, this.m.compose(this.pos, this.q, this.scl));
      this.col.setRGB(this.cr[i] * bright, this.cg[i] * bright, this.cb[i] * bright);
      this.mesh.setColorAt(n, this.col);
      n += 1;
    }
    this.mesh.count = n;
    this.mesh.visible = n > 0;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }

  get live(): number { return this.mesh.count; }
  clear(): void { this.life.fill(0); this.mesh.count = 0; }
}
