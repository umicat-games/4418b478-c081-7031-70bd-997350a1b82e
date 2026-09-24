import * as THREE from 'three';

/**
 * 特效管理器：弹道曳光、命中火花、枪口闪光、出生光柱、爆炸、敌方弹丸、
 * 镜头震屏。全部对象池化，避免战斗中频繁分配。
 */
export class Effects {
  private scene: THREE.Scene;
  private time = 0;

  // 曳光弹池
  private tracers: { mesh: THREE.Mesh; life: number }[] = [];
  private tracerGeo = new THREE.BoxGeometry(1, 1, 1);

  // 火花池（Points）
  private sparks: {
    points: THREE.Points; vel: Float32Array; life: number; maxLife: number; n: number;
  }[] = [];
  private sparkGeo = new THREE.BufferGeometry();

  // 枪口闪光（复用）
  private muzzleLight: THREE.PointLight;
  private muzzleSprite: THREE.Sprite;
  private muzzleLife = 0;

  // 出生光柱 / 爆炸（一批短命 mesh）
  private flashes: { mesh: THREE.Object3D; life: number; maxLife: number; grow: number }[] = [];

  // 敌方弹丸
  private bolts: {
    mesh: THREE.Mesh; glow: THREE.Sprite; vel: THREE.Vector3; life: number; damage: number;
  }[] = [];
  private boltGeo = new THREE.SphereGeometry(0.07, 10, 10);
  private boltMat = new THREE.MeshBasicMaterial({ color: 0xff5533 });

  // 震屏
  private trauma = 0;

  constructor(scene: THREE.Scene) {
    this.scene = scene;
    this.muzzleLight = new THREE.PointLight(0x88ccff, 0, 6, 1.6);
    scene.add(this.muzzleLight);
    const tex = Effects.glowTexture();
    this.muzzleSprite = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: tex, color: 0xaaddff, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }),
    );
    this.muzzleSprite.scale.setScalar(0.001);
    scene.add(this.muzzleSprite);
  }

  // ------------------------------------------------------------ 基础 ---

  private static glowTexture(): THREE.Texture {
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const g = c.getContext('2d')!;
    const grad = g.createRadialGradient(32, 32, 2, 32, 32, 32);
    grad.addColorStop(0, 'rgba(255,255,255,1)');
    grad.addColorStop(0.4, 'rgba(255,255,255,0.5)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 64, 64);
    const t = new THREE.CanvasTexture(c);
    return t;
  }

  addShake(amount: number): void {
    this.trauma = Math.min(1, this.trauma + amount);
  }

  /** 震屏偏移（游戏每帧加到相机位置/旋转上），返回 {x, y, roll} */
  shakeOffset(): { x: number; y: number; roll: number } {
    const s = this.trauma * this.trauma;
    const t = this.time * 61;
    return {
      x: s * 0.06 * Math.sin(t * 1.1),
      y: s * 0.06 * Math.sin(t * 1.7 + 2),
      roll: s * 0.02 * Math.sin(t * 1.3 + 4),
    };
  }

  // ------------------------------------------------------------ 弹道 ---

  /** 从枪口到命中点的曳光 */
  tracer(from: THREE.Vector3, to: THREE.Vector3, color: number): void {
    let tr = this.tracers.find((t) => t.life <= 0);
    if (!tr) {
      if (this.tracers.length >= 24) return;
      const mesh = new THREE.Mesh(
        this.tracerGeo,
        new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false }),
      );
      mesh.frustumCulled = false;
      this.scene.add(mesh);
      tr = { mesh, life: 0 };
      this.tracers.push(tr);
    }
    const len = from.distanceTo(to);
    if (len < 0.05) return;
    (tr.mesh.material as THREE.MeshBasicMaterial).color.setHex(color);
    tr.mesh.position.copy(from).add(to).multiplyScalar(0.5);
    tr.mesh.lookAt(to);
    tr.mesh.scale.set(0.025, 0.025, len);
    tr.life = 0.07;
    tr.mesh.visible = true;
  }

  /** 命中火花 */
  spark(pos: THREE.Vector3, color: number, n = 14, speed = 3.5): void {
    let sp = this.sparks.find((s) => s.life <= 0);
    if (!sp) {
      if (this.sparks.length >= 10) return;
      const max = 24;
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(max * 3), 3));
      const mat = new THREE.PointsMaterial({ color: 0xffffff, size: 0.05, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
      const points = new THREE.Points(geo, mat);
      points.frustumCulled = false;
      this.scene.add(points);
      sp = { points, vel: new Float32Array(max * 3), life: 0, maxLife: 0.5, n: max };
      this.sparks.push(sp);
    }
    const p = sp.points.geometry.getAttribute('position') as THREE.BufferAttribute;
    (sp.points.material as THREE.PointsMaterial).color.setHex(color);
    for (let i = 0; i < sp.n; i++) {
      p.setXYZ(i, pos.x, pos.y, pos.z);
      const th = Math.random() * Math.PI * 2;
      const ph = Math.acos(2 * Math.random() - 1);
      const v = speed * (0.4 + Math.random() * 0.8);
      sp.vel[i * 3] = Math.sin(ph) * Math.cos(th) * v;
      sp.vel[i * 3 + 1] = Math.abs(Math.cos(ph)) * v * 0.9;
      sp.vel[i * 3 + 2] = Math.sin(ph) * Math.sin(th) * v;
    }
    p.needsUpdate = true;
    (sp.points.material as THREE.PointsMaterial).opacity = 1;
    sp.life = sp.maxLife = 0.45 + Math.random() * 0.15;
    sp.points.visible = true;
    void n;
  }

  /** 枪口闪光 */
  muzzle(pos: THREE.Vector3): void {
    this.muzzleLight.position.copy(pos);
    this.muzzleLight.intensity = 26;
    this.muzzleSprite.position.copy(pos);
    this.muzzleSprite.scale.setScalar(0.32 + Math.random() * 0.12);
    (this.muzzleSprite.material as THREE.SpriteMaterial).rotation = Math.random() * Math.PI;
    this.muzzleLife = 0.055;
  }

  // ------------------------------------------------------------ 场景 ---

  /** 敌人出生光柱 */
  spawnBeam(pos: THREE.Vector3, color = 0xe879f9): void {
    const geo = new THREE.CylinderGeometry(0.35, 0.5, 2.4, 12, 1, true);
    const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(pos.x, pos.y + 1.2, pos.z);
    this.scene.add(mesh);
    this.flashes.push({ mesh, life: 0.9, maxLife: 0.9, grow: 0 });
  }

  /** 爆炸：扩散光球 + 强光 + 火花 */
  explosion(pos: THREE.Vector3, radius: number, color = 0xffa040): void {
    const geo = new THREE.SphereGeometry(1, 16, 12);
    const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.75, blending: THREE.AdditiveBlending, depthWrite: false });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.copy(pos);
    mesh.scale.setScalar(0.2);
    this.scene.add(mesh);
    this.flashes.push({ mesh, life: 0.35, maxLife: 0.35, grow: radius / 0.35 });
    this.spark(pos, 0xffcc66, 20, 6);
    this.spark(pos, color, 12, 4);
    this.addShake(0.25);
  }

  // ------------------------------------------------------------ 弹丸 ---

  /** 敌人发射的能量弹 */
  fireBolt(from: THREE.Vector3, dir: THREE.Vector3, speed: number, damage: number): void {
    const mesh = new THREE.Mesh(this.boltGeo, this.boltMat);
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({
      map: Effects.glowTexture(), color: 0xff6633, transparent: true,
      blending: THREE.AdditiveBlending, depthWrite: false,
    }));
    glow.scale.setScalar(0.5);
    mesh.add(glow);
    mesh.position.copy(from);
    this.scene.add(mesh);
    this.bolts.push({ mesh, glow, vel: dir.clone().multiplyScalar(speed), life: 4, damage });
  }

  /**
   * 推进弹丸；命中玩家时调 onHit(damage)。返回命中的弹丸伤害列表
   * （游戏据此扣血，避免 effects 直接碰玩家逻辑）。
   */
  updateBolts(dt: number, playerPos: THREE.Vector3, playerRadius: number): number[] {
    const hits: number[] = [];
    for (let i = this.bolts.length - 1; i >= 0; i--) {
      const b = this.bolts[i];
      b.life -= dt;
      b.mesh.position.addScaledVector(b.vel, dt);
      const p = b.mesh.position;
      let dead = b.life <= 0;
      // 打中玩家（胸口高度附近的球体近似）
      const dx = p.x - playerPos.x, dy = p.y - (playerPos.y + 0.1), dz = p.z - playerPos.z;
      if (dx * dx + dy * dy + dz * dz < playerRadius * playerRadius) {
        hits.push(b.damage);
        this.spark(p, 0xff6633, 10, 3);
        dead = true;
      }
      // 打中地板/墙
      if (!dead && (p.y < 0.3 || Math.abs(p.x) > 9.9 || Math.abs(p.z) > 9.9)) {
        this.spark(p, 0xff8855, 8, 2.5);
        dead = true;
      }
      if (dead) {
        this.scene.remove(b.mesh);
        (b.glow.material as THREE.SpriteMaterial).dispose();
        this.bolts.splice(i, 1);
      }
    }
    return hits;
  }

  clearBolts(): void {
    for (const b of this.bolts) {
      this.scene.remove(b.mesh);
      (b.glow.material as THREE.SpriteMaterial).dispose();
    }
    this.bolts.length = 0;
  }

  // ------------------------------------------------------------ 主循环 ---

  update(dt: number): void {
    this.time += dt;
    this.trauma = Math.max(0, this.trauma - dt * 1.4);

    for (const t of this.tracers) {
      if (t.life <= 0) continue;
      t.life -= dt;
      if (t.life <= 0) t.mesh.visible = false;
      else (t.mesh.material as THREE.MeshBasicMaterial).opacity = Math.min(0.9, t.life / 0.07);
    }
    for (const s of this.sparks) {
      if (s.life <= 0) continue;
      s.life -= dt;
      if (s.life <= 0) { s.points.visible = false; continue; }
      const p = s.points.geometry.getAttribute('position') as THREE.BufferAttribute;
      for (let i = 0; i < s.n; i++) {
        s.vel[i * 3 + 1] -= 9 * dt;
        p.setXYZ(i,
          p.getX(i) + s.vel[i * 3] * dt,
          Math.max(0.32, p.getY(i) + s.vel[i * 3 + 1] * dt),
          p.getZ(i) + s.vel[i * 3 + 2] * dt);
      }
      p.needsUpdate = true;
      (s.points.material as THREE.PointsMaterial).opacity = s.life / s.maxLife;
    }
    if (this.muzzleLife > 0) {
      this.muzzleLife -= dt;
      if (this.muzzleLife <= 0) {
        this.muzzleLight.intensity = 0;
        this.muzzleSprite.scale.setScalar(0.001);
      } else {
        this.muzzleLight.intensity *= 0.7;
      }
    }
    for (let i = this.flashes.length - 1; i >= 0; i--) {
      const f = this.flashes[i];
      f.life -= dt;
      if (f.life <= 0) {
        this.scene.remove(f.mesh);
        const m = f.mesh as THREE.Mesh;
        if (m.geometry) m.geometry.dispose();
        if (m.material) (m.material as THREE.Material).dispose();
        this.flashes.splice(i, 1);
        continue;
      }
      const k = f.life / f.maxLife;
      const mat = (f.mesh as THREE.Mesh).material as THREE.MeshBasicMaterial;
      mat.opacity = 0.75 * k;
      if (f.grow) (f.mesh as THREE.Mesh).scale.addScalar(f.grow * dt);
    }
  }

  dispose(): void {
    this.scene.remove(this.muzzleLight, this.muzzleSprite);
  }
}
