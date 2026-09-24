import * as THREE from 'three';

/**
 * 伤害数字：从挨打的那只头上飘起来，然后化掉。
 *
 * **一次绘制，不管屏幕上有多少个数字。**
 *
 * 这是这个仓库里第四次遇到同一道题（敌人、粒子、白光，现在是数字），而数字
 * 这次多一层麻烦：每个实例要显示**不同的字**，而 `InstancedMesh` 共享同一份
 * 几何、也就共享同一套 UV。
 *
 * 三条路，选了第三条：
 *
 *  - **DOM 元素**——后段每秒上百个，直接出局。
 *  - **一个数字一个网格**（0~9 各一个 `InstancedMesh`，UV 烘死在几何里）——
 *    不用写 shader，但满屏数字时十个网格都非空，就是十次绘制。这个游戏的整关
 *    预算是 20，而敌群 + 五把武器 + 粒子已经吃掉 18。
 *  - **一个网格 + 逐实例的字形下标**——要写一点 shader，但它是一次绘制。
 *
 * 字形表是**运行时在 canvas 上画出来的**，不是一张要上传的图：十个数字加一个
 * 减号，用系统字体画一次。省掉一个美术资产，而且字号可以按设备像素比来定，
 * 不会糊。
 */

/** 同时最多几个字形（不是几个数字 —— 一个三位数占三个）。 */
const MAX = 360;
/** 一个数字活多久、往上飘多高。 */
const LIFE = 0.75;
const RISE = 1.15;
/** 字形在世界里多大。 */
const SIZE = 0.42;
/** 字形表里有哪些字，顺序就是下标。 */
const GLYPHS = '0123456789';

/** 画一张一行十格的数字表。 */
function glyphAtlas(): THREE.CanvasTexture {
  const CELL = 64;
  const c = document.createElement('canvas');
  c.width = CELL * GLYPHS.length;
  c.height = CELL;
  const g = c.getContext('2d')!;
  g.font = `900 ${Math.round(CELL * 0.78)}px system-ui, sans-serif`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  // 先描一圈深色边再填白。**这一步不是装饰**：数字要飘在草地、泥地、敌人和
  // 特效上面，纯白字在浅色地面上会直接消失，而描边让它在任何底色上都读得出来。
  g.lineWidth = CELL * 0.17;
  g.lineJoin = 'round';
  g.strokeStyle = '#000';
  g.fillStyle = '#fff';
  for (let i = 0; i < GLYPHS.length; i++) {
    const x = i * CELL + CELL / 2;
    g.strokeText(GLYPHS[i], x, CELL * 0.54);
    g.fillText(GLYPHS[i], x, CELL * 0.54);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export class DamageNumbers {
  private mesh!: THREE.InstancedMesh;
  private head = 0;
  private readonly digit: THREE.InstancedBufferAttribute;

  private readonly px = new Float32Array(MAX);
  private readonly py = new Float32Array(MAX);
  private readonly pz = new Float32Array(MAX);
  /** 这个字形相对整串的横向偏移（字符数），用来把一串数字排开。 */
  private readonly off = new Float32Array(MAX);
  private readonly life = new Float32Array(MAX);
  private readonly scale = new Float32Array(MAX);
  private readonly cr = new Float32Array(MAX);
  private readonly cg = new Float32Array(MAX);
  private readonly cb = new Float32Array(MAX);

  private readonly m = new THREE.Matrix4();
  private readonly pos = new THREE.Vector3();
  private readonly scl = new THREE.Vector3();
  private readonly right = new THREE.Vector3();
  private readonly col = new THREE.Color();
  private readonly tmp = new THREE.Color();

  /** 攒着还没显示的伤害，按敌人位置合并 —— 见 `add`。 */
  private pending = 0;
  private pendX = 0;
  private pendZ = 0;
  private pendT = 0;

  constructor(scene: THREE.Scene) {
    const geom = new THREE.PlaneGeometry(1, 1);
    const map = glyphAtlas();
    // 逐实例的字形下标。`InstancedBufferAttribute` 是这条路上唯一需要的新东西。
    this.digit = new THREE.InstancedBufferAttribute(new Float32Array(MAX), 1);
    geom.setAttribute('aDigit', this.digit);

    const mat = new THREE.ShaderMaterial({
      uniforms: { uMap: { value: map }, uCols: { value: GLYPHS.length } },
      vertexShader: `
        attribute float aDigit;
        varying vec2 vUv;
        varying vec3 vTint;
        void main() {
          // 把这个实例的 UV 挪到字形表里属于它的那一格。
          vUv = vec2((uv.x + aDigit) / ${GLYPHS.length}.0, uv.y);
          #ifdef USE_INSTANCING_COLOR
            vTint = instanceColor;
          #else
            vTint = vec3(1.0);
          #endif
          #include <begin_vertex>
          #include <project_vertex>
        }`,
      fragmentShader: `
        uniform sampler2D uMap;
        varying vec2 vUv;
        varying vec3 vTint;
        void main() {
          vec4 t = texture2D(uMap, vUv);
          // 颜色带着淡出（instanceColor 是逐实例的，透明度不是），所以
          // 亮度乘进 alpha 里一起走。注意这段注释里不能出现反引号 ——
          // 它整个活在一个 JS 模板字符串里面。
          float a = t.a * max(max(vTint.r, vTint.g), vTint.b);
          if (a < 0.01) discard;
          gl_FragColor = vec4(t.rgb * vTint, a);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
      transparent: true,
      depthWrite: false,
      // 数字被敌人挡住就没用了 —— 最密的时候正是最想读它的时候。
      depthTest: false,
    });

    this.mesh = new THREE.InstancedMesh(geom, mat, MAX);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.instanceColor =
      new THREE.InstancedBufferAttribute(new Float32Array(MAX * 3), 3);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 10;
    this.mesh.count = 0;
    scene.add(this.mesh);
  }

  /**
   * 记一次伤害。
   *
   * **会合并。** 后段每秒上百次命中，一命中一个数字的话屏幕会变成一面数字墙，
   * 而那既读不了也画不起。所以近处、短时间内的伤害攒成一个数 —— 玩家想知道的
   * 本来就是「我这一下打了多少」，不是「第七把刀的第三次判定打了多少」。
   */
  add(x: number, z: number, amount: number): void {
    // 离上一笔很近就并进去；否则把上一笔结掉，开新的。
    if (this.pending > 0 &&
        Math.hypot(x - this.pendX, z - this.pendZ) < 1.6 && this.pendT < 0.14) {
      this.pending += amount;
      return;
    }
    this.flush();
    this.pending = amount;
    this.pendX = x; this.pendZ = z; this.pendT = 0;
  }

  /** 把攒着的那笔画出来。 */
  private flush(): void {
    if (this.pending <= 0) return;
    const n = Math.max(1, Math.round(this.pending));
    const text = String(n);
    // 伤害越大字越大。一眼读的是**大小**，数值是第二层信息 —— 满屏数字的时候
    // 没人会去比较 14 和 17，但谁都看得出哪一下特别重。
    const big = Math.min(1.75, 0.85 + Math.log10(n + 1) * 0.42);
    // 小伤害偏白、大伤害偏金，同样是给余光看的。
    this.tmp.setHex(n >= 100 ? 0xffd45c : n >= 40 ? 0xffe9b0 : 0xffffff);
    for (let i = 0; i < text.length; i++) {
      const s = this.head;
      this.head = (this.head + 1) % MAX;
      this.px[s] = this.pendX; this.py[s] = 0.85; this.pz[s] = this.pendZ;
      // 整串居中：第 i 个字相对串心偏 (i - (len-1)/2) 个字宽。
      this.off[s] = (i - (text.length - 1) / 2) * 0.62;
      this.life[s] = LIFE;
      this.scale[s] = big;
      this.cr[s] = this.tmp.r; this.cg[s] = this.tmp.g; this.cb[s] = this.tmp.b;
      this.digit.array[s] = GLYPHS.indexOf(text[i]);
    }
    this.pending = 0;
  }

  update(dt: number, camQuat: THREE.Quaternion): void {
    // 攒着的那笔超时就结掉 —— 不然打完最后一下之后它会一直挂着不出来。
    if (this.pending > 0) {
      this.pendT += dt;
      if (this.pendT >= 0.14) this.flush();
    }

    // 字要横着排在**相机的右方向**上，不是世界 X —— 相机能转，写死世界轴的话
    // 转过去数字就变成竖着的一串。
    this.right.set(1, 0, 0).applyQuaternion(camQuat);

    let n = 0;
    for (let i = 0; i < MAX; i++) {
      const l = this.life[i];
      if (l <= 0) continue;
      const left = l - dt;
      this.life[i] = left;
      if (left <= 0) continue;

      const k = 1 - left / LIFE;
      // 起得快、停得慢：一下命中是个事件，该「蹦」出来而不是匀速升上去。
      const rise = RISE * (1 - (1 - k) * (1 - k));
      // 冒出来的那一瞬间放大一下再收回去。
      const pop = k < 0.16 ? 0.55 + (k / 0.16) * 0.55 : 1.1 - (k - 0.16) * 0.12;
      const s = this.scale[i] * SIZE * pop;

      this.pos.set(this.px[i], this.py[i] + rise, this.pz[i])
        .addScaledVector(this.right, this.off[i] * s);
      this.scl.set(s, s, 1);
      this.mesh.setMatrixAt(n, this.m.compose(this.pos, camQuat, this.scl));
      // 后三分之一才开始淡出 —— 一出来就在变淡的数字读不完。
      const fade = k < 0.66 ? 1 : 1 - (k - 0.66) / 0.34;
      this.col.setRGB(this.cr[i] * fade, this.cg[i] * fade, this.cb[i] * fade);
      this.mesh.setColorAt(n, this.col);
      // 字形下标要跟着**打包后的位置**走，不是原来的槽位 —— 矩阵和颜色都按
      // `n` 写，字形留在 `i` 的话，数字会串到别的位置上去。
      if (n !== i) this.digit.array[n] = this.digit.array[i];
      n += 1;
    }
    this.mesh.count = n;
    this.mesh.visible = n > 0;
    this.mesh.instanceMatrix.needsUpdate = true;
    this.digit.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }

  get live(): number { return this.mesh.count; }
  clear(): void { this.life.fill(0); this.pending = 0; this.mesh.count = 0; }
}
