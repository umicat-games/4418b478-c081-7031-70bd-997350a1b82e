import * as THREE from 'three';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';
import { CharacterAnimator, flashTint } from '@umicat/three-sdk';
import { ENEMIES, FLOOR_TOP, type EnemyDef } from './config';
import type { Effects } from './effects';

export interface Obstacle { x: number; z: number; r: number }

export interface EnemyHooks {
  /** 近战命中玩家 */
  onMeleeDamage: (damage: number) => void;
  /** 远程敌人开火 */
  onRangedFire: (from: THREE.Vector3, dir: THREE.Vector3, speed: number, damage: number) => void;
  /** 敌人死亡（计分/掉落由游戏层处理） */
  onDeath: (enemy: Enemy) => void;
}

export interface SpawnTemplate {
  object: THREE.Object3D;
  clips: THREE.AnimationClip[];
  clipMap: Record<string, string>;
}

type EnemyState = 'spawning' | 'seek' | 'windup' | 'recover' | 'dying' | 'dead';

const V = new THREE.Vector3();
const V2 = new THREE.Vector3();

/** 射线与球求交，返回 t（<0 或 >maxDist 视为 miss，用 null） */
function raySphere(o: THREE.Vector3, d: THREE.Vector3, c: THREE.Vector3, r: number, maxDist: number): number | null {
  V.copy(o).sub(c);
  const b = V.dot(d);
  const cc = V.lengthSq() - r * r;
  if (cc <= 0) return 0; // 起点在球内
  const disc = b * b - cc;
  if (disc < 0) return null;
  const t = -b - Math.sqrt(disc);
  return t >= 0 && t <= maxDist ? t : null;
}

export class Enemy {
  readonly def: EnemyDef;
  readonly obj: THREE.Object3D;
  private mixer: THREE.AnimationMixer;
  private animator: CharacterAnimator;
  hp: number;
  state: EnemyState = 'spawning';
  private stateT = 0;
  private attackCd = 0;
  private rangedCd = 2;
  private fadeT = -1;
  private hooks: EnemyHooks;
  private effects: Effects;
  private yaw = 0;

  constructor(def: EnemyDef, tpl: SpawnTemplate, pos: THREE.Vector3, hooks: EnemyHooks, effects: Effects) {
    this.def = def;
    this.hooks = hooks;
    this.effects = effects;
    this.hp = def.hp;

    this.obj = cloneSkinned(tpl.object);
    this.obj.scale.setScalar(def.scale);
    this.obj.position.set(pos.x, FLOOR_TOP, pos.z);
    // 种类染色：把贴图颜色往种族色偏，远处也能一眼区分
    this.obj.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (mesh.isMesh) {
        const m = (mesh.material as THREE.MeshStandardMaterial).clone();
        m.color = new THREE.Color(def.baseTint);
        m.transparent = true;
        mesh.material = m;
        mesh.castShadow = true;
      }
    });

    this.mixer = new THREE.AnimationMixer(this.obj);
    this.animator = new CharacterAnimator(this.mixer, tpl.clips, tpl.clipMap);
    this.animator.update('idle');
  }

  get alive(): boolean {
    return this.state !== 'dying' && this.state !== 'dead';
  }

  get position(): THREE.Vector3 {
    return this.obj.position;
  }

  /** 命中胶囊：脚到头的一段（世界坐标） */
  private capsule(): { y0: number; y1: number; r: number } {
    const s = this.def.scale;
    return { y0: FLOOR_TOP + 0.1 * s, y1: FLOOR_TOP + 0.58 * s, r: 0.24 * s };
  }

  /** 射线命中测试：沿胶囊取 4 个球近似。返回 {dist, head} */
  rayHit(o: THREE.Vector3, d: THREE.Vector3, maxDist: number): { dist: number; head: boolean } | null {
    if (!this.alive) return null;
    const { y0, y1, r } = this.capsule();
    let best: number | null = null;
    let head = false;
    for (let i = 0; i < 4; i++) {
      const t = i / 3;
      V2.set(this.obj.position.x, y0 + (y1 - y0) * t, this.obj.position.z);
      const hit = raySphere(o, d, V2, r, maxDist);
      if (hit !== null && (best === null || hit < best)) {
        best = hit;
        head = t >= 0.66;
      }
    }
    return best === null ? null : { dist: best, head };
  }

  /** 是否在爆炸半径内（用胶囊中心点近似） */
  withinRadius(c: THREE.Vector3, radius: number): boolean {
    const { y0, y1 } = this.capsule();
    const dx = this.obj.position.x - c.x;
    const dz = this.obj.position.z - c.z;
    const dy = Math.max(y0 - c.y, 0, c.y - y1);
    return dx * dx + dz * dz + dy * dy < radius * radius;
  }

  hit(damage: number, head: boolean, hitPoint: THREE.Vector3): boolean {
    if (!this.alive) return false;
    this.hp -= damage;
    flashTint(this.obj, { color: this.def.tint, ms: 120, intensity: 0.9 });
    this.effects.spark(hitPoint, head ? 0xffd34d : 0xff6644, head ? 16 : 10, 4);
    if (this.hp <= 0) {
      this.state = 'dying';
      this.stateT = 0;
      this.animator.play('die', { interrupt: true });
      this.hooks.onDeath(this);
      return true;
    }
    return false;
  }

  private faceTowards(x: number, z: number, dt: number): void {
    const target = Math.atan2(x - this.obj.position.x, z - this.obj.position.z);
    let d = target - this.yaw;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    this.yaw += THREE.MathUtils.clamp(d, -6 * dt, 6 * dt);
    this.obj.rotation.y = this.yaw;
  }

  update(dt: number, playerPos: THREE.Vector3, obstacles: Obstacle[], neighbors: Enemy[]): void {
    this.mixer.update(dt);
    this.stateT += dt;
    this.attackCd -= dt;
    this.rangedCd -= dt;

    if (this.state === 'dead') return;

    if (this.state === 'dying') {
      // 倒地 1.1s 后淡出
      if (this.stateT > 1.1 && this.fadeT < 0) this.fadeT = 0;
      if (this.fadeT >= 0) {
        this.fadeT += dt;
        const k = Math.max(0, 1 - this.fadeT / 0.45);
        this.obj.traverse((o) => {
          const mesh = o as THREE.Mesh;
          if (mesh.isMesh) (mesh.material as THREE.Material).opacity = k;
        });
        if (k <= 0) this.state = 'dead';
      }
      return;
    }

    const dx = playerPos.x - this.obj.position.x;
    const dz = playerPos.z - this.obj.position.z;
    const dist = Math.hypot(dx, dz);

    if (this.state === 'spawning') {
      this.faceTowards(playerPos.x, playerPos.z, dt);
      // 出生 1 秒：从光柱里"长"出来
      const k = Math.min(1, this.stateT / 1);
      this.obj.scale.setScalar(this.def.scale * (0.3 + 0.7 * k));
      if (this.stateT >= 1) {
        this.state = 'seek';
        this.obj.scale.setScalar(this.def.scale);
      }
      return;
    }

    // ---- 远程攻击：距离合适就停下射击 ----
    const ranged = this.def.ranged;
    if (ranged && this.state === 'seek' && this.rangedCd <= 0 &&
        dist >= ranged.range[0] && dist <= ranged.range[1]) {
      this.state = 'windup';
      this.stateT = 0;
      this.animator.play('attack', { interrupt: true });
      this.faceTowards(playerPos.x, playerPos.z, dt);
      return;
    }

    // ---- 近战 ----
    if (this.state === 'seek' && dist < this.def.meleeRange && this.attackCd <= 0) {
      this.state = 'windup';
      this.stateT = 0;
      this.animator.play('attack', { interrupt: true });
      return;
    }

    if (this.state === 'windup') {
      this.faceTowards(playerPos.x, playerPos.z, dt);
      const strikeAt = ranged && dist >= ranged.range[0] ? 0.45 : 0.38;
      if (this.stateT >= strikeAt) {
        if (ranged && dist >= ranged.range[0] * 0.8) {
          // 发射能量弹
          V.set(playerPos.x - this.obj.position.x, 0, playerPos.z - this.obj.position.z).normalize();
          const from = new THREE.Vector3(
            this.obj.position.x, FLOOR_TOP + 0.5 * this.def.scale, this.obj.position.z,
          );
          const dir = new THREE.Vector3(
            playerPos.x - from.x,
            (playerPos.y + 0.15) - from.y,
            playerPos.z - from.z,
          ).normalize();
          this.hooks.onRangedFire(from, dir, ranged.speed, ranged.damage);
          this.rangedCd = ranged.interval * (0.85 + Math.random() * 0.3);
        } else if (dist < this.def.meleeRange + 0.45) {
          this.hooks.onMeleeDamage(this.def.meleeDamage);
        }
        this.state = 'recover';
        this.stateT = 0;
        this.attackCd = this.def.attackInterval;
      }
      return;
    }

    if (this.state === 'recover') {
      if (this.stateT > 0.35) this.state = 'seek';
      return;
    }

    // ---- seek：追击 ----
    let mx = dx / (dist || 1);
    let mz = dz / (dist || 1);

    // 分离：别挤成一团
    for (const o of neighbors) {
      if (o === this || !o.alive) continue;
      const sx = this.obj.position.x - o.obj.position.x;
      const sz = this.obj.position.z - o.obj.position.z;
      const sd = Math.hypot(sx, sz);
      if (sd > 0.001 && sd < 1.1) {
        const push = (1.1 - sd) * 1.6;
        mx += (sx / sd) * push;
        mz += (sz / sd) * push;
      }
    }
    // 绕障：前方有掩体就斜着走
    for (const ob of obstacles) {
      const ox = this.obj.position.x - ob.x;
      const oz = this.obj.position.z - ob.z;
      const od = Math.hypot(ox, oz);
      const rr = ob.r + 0.55;
      if (od < rr && od > 0.001) {
        // 障碍在前进方向上才绕
        const dot = (ox / od) * mx + (oz / od) * mz;
        if (dot < -0.25) {
          const side = (ox / od) * mz - (oz / od) * mx > 0 ? 1 : -1;
          mx += -mz * side * 1.4;
          mz += mx * side * 1.4;
        }
      }
    }

    const ml = Math.hypot(mx, mz) || 1;
    const sp = this.def.speed * (dist < 6 ? 1 : 0.92);
    this.obj.position.x = THREE.MathUtils.clamp(
      this.obj.position.x + (mx / ml) * sp * dt, -9.3, 9.3);
    this.obj.position.z = THREE.MathUtils.clamp(
      this.obj.position.z + (mz / ml) * sp * dt, -9.3, 9.3);
    this.faceTowards(playerPos.x, playerPos.z, dt);
    this.animator.update(dist > 0.4 ? 'run' : 'idle');
  }

  dispose(scene: THREE.Scene): void {
    scene.remove(this.obj);
    this.mixer.uncacheRoot(this.obj);
  }
}

export class EnemyManager {
  private scene: THREE.Scene;
  private tpl: SpawnTemplate;
  private hooks: EnemyHooks;
  private effects: Effects;
  list: Enemy[] = [];

  constructor(scene: THREE.Scene, tpl: SpawnTemplate, hooks: EnemyHooks, effects: Effects) {
    this.scene = scene;
    this.tpl = tpl;
    this.hooks = hooks;
    this.effects = effects;
  }

  spawn(id: EnemyDef['id'], pos: THREE.Vector3): Enemy {
    const e = new Enemy(ENEMIES[id], this.tpl, pos, this.hooks, this.effects);
    this.scene.add(e.obj);
    this.list.push(e);
    this.effects.spawnBeam(pos);
    return e;
  }

  update(dt: number, playerPos: THREE.Vector3, obstacles: Obstacle[]): void {
    for (const e of this.list) e.update(dt, playerPos, obstacles, this.list);
    // 清理 dead
    for (let i = this.list.length - 1; i >= 0; i--) {
      if (this.list[i].state === 'dead') {
        this.list[i].dispose(this.scene);
        this.list.splice(i, 1);
      }
    }
  }

  /** 射线打敌人：返回最近的 {enemy, dist, head} */
  raycast(o: THREE.Vector3, d: THREE.Vector3, maxDist: number)
    : { enemy: Enemy; dist: number; head: boolean } | null {
    let best: { enemy: Enemy; dist: number; head: boolean } | null = null;
    for (const e of this.list) {
      const hit = e.rayHit(o, d, maxDist);
      if (hit && (!best || hit.dist < best.dist)) {
        best = { enemy: e, dist: hit.dist, head: hit.head };
      }
    }
    return best;
  }

  /** 范围伤害，返回命中的敌人（用于计分/特效） */
  splash(center: THREE.Vector3, radius: number, damage: number): Enemy[] {
    const hit: Enemy[] = [];
    for (const e of this.list) {
      if (e.alive && e.withinRadius(center, radius)) hit.push(e);
    }
    return hit;
  }

  get aliveCount(): number {
    let n = 0;
    for (const e of this.list) if (e.alive) n++;
    return n;
  }

  get objects(): THREE.Object3D[] {
    return this.list.map((e) => e.obj);
  }

  clear(): void {
    for (const e of this.list) e.dispose(this.scene);
    this.list.length = 0;
  }
}
