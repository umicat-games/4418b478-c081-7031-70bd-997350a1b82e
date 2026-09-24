import * as THREE from 'three';

/**
 * 主角的血条，**挂在主角头上**。
 *
 * 之前它在左上角。那不是随便挪一下的问题 —— 角落那条是第二版了，第一版是
 * 顶部中间的一行字，玩家的原话是「敌人碰到我也没啥伤害呀」：伤害一直在扣，
 * 而他看不见。改成角落的彩色条之后能看见了，但要**主动去看**。
 *
 * 这个类型里玩家的眼睛整局钉在自己身上（走位是唯一的防御动作），所以血量
 * 应该长在那儿。吸血鬼幸存者把它放在角色**脚下**；这里放头上，因为我们是
 * 俯视 3D，脚下那一圈会被身体本身和地上的掉落物盖住，而头顶上方是空的。
 *
 * 一个 `InstancedMesh`、两个实例（底槽 + 填充）、**一次绘制**。和敌人的血条
 * 走的是同一招：相机朝向每帧只算一次，直接烘进实例矩阵。
 */

/** 头顶多高，和条子多大。 */
const Y = 1.02;
const W = 0.9, H = 0.11;

export class HeroBar {
  private mesh!: THREE.InstancedMesh;
  private readonly m = new THREE.Matrix4();
  private readonly pos = new THREE.Vector3();
  private readonly scl = new THREE.Vector3();
  private readonly col = new THREE.Color();
  /** 显示出来的血量，追着真实血量走。 */
  private shown = 1;

  constructor(scene: THREE.Scene) {
    const g = new THREE.PlaneGeometry(1, 1);
    const m = new THREE.MeshBasicMaterial({
      // **不吃深度**：被敌人挡住的血条等于没有血条，而这个游戏最需要读血量的
      // 时刻正是身边围满了人的时候。
      depthTest: false, depthWrite: false, transparent: true,
      side: THREE.DoubleSide,
    });
    this.mesh = new THREE.InstancedMesh(g, m, 2);
    this.mesh.instanceColor =
      new THREE.InstancedBufferAttribute(new Float32Array(6), 3);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 8;
    this.mesh.count = 0;
    scene.add(this.mesh);
  }

  update(dt: number, x: number, y: number, z: number,
         hp: number, hpMax: number, camQuat: THREE.Quaternion): void {
    const frac = Math.max(0, Math.min(1, hp / hpMax));
    // 追着走，不是瞬间跳。掉血是**连续**发生的（每帧几个点），瞬间跳的话
    // 条子只是在抖；追着走能看出「正在往下掉」这件事本身。
    this.shown += (frac - this.shown) * Math.min(1, 9 * dt);
    if (Math.abs(this.shown - frac) < 0.002) this.shown = frac;

    this.pos.set(x, y + Y, z);
    this.scl.set(W, H, 1);
    this.mesh.setMatrixAt(0, this.m.compose(this.pos, camQuat, this.scl));
    this.col.setRGB(0.05, 0.07, 0.09);
    this.mesh.setColorAt(0, this.col);

    // 左对齐：缩放之后往左挪半个缺口，这样是从右边空的。
    this.pos.set(x - (W * (1 - this.shown)) / 2, y + Y, z);
    this.scl.set(Math.max(0.0001, W * this.shown) * 0.94, H * 0.66, 1);
    this.mesh.setMatrixAt(1, this.m.compose(this.pos, camQuat, this.scl));
    // 绿 → 黄 → 红。一眼读的是颜色，不是数字。
    if (frac > 0.55) this.col.setRGB(0.37, 0.83, 0.42);
    else if (frac > 0.28) this.col.setRGB(0.94, 0.71, 0.16);
    else this.col.setRGB(0.94, 0.29, 0.29);
    this.mesh.setColorAt(1, this.col);

    this.mesh.count = 2;
    this.mesh.visible = true;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }

  hide(): void { this.mesh.count = 0; this.mesh.visible = false; }
}
