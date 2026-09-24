import * as THREE from 'three';
import {
  CharacterController3D, Input3D, loadModelAsset,
  type Manifest3D,
} from '@umicat/three-sdk';
import {
  WEAPONS, PLAYER_HP, PLAYER_REGEN_DELAY, PLAYER_REGEN_RATE,
  WALK_SPEED, SPRINT_SPEED, LOOK_SENSITIVITY, EYE_ABOVE_FEET,
  type WeaponDef,
} from './config';
import type { GameAudio } from '@umicat/three-sdk';
import { SOUNDS } from './audio';
import type { Effects } from './effects';
import type { HUD } from './hud';

/** 游戏层实现的战斗回调：玩家扣动扳机后，命中判定由游戏层做 */
export interface CombatHooks {
  shoot: (origin: THREE.Vector3, dir: THREE.Vector3, weapon: WeaponDef) => void;
  onPlayerDamaged: (amount: number) => void;
  onPlayerDeath: () => void;
  /** 指针锁定丢失（用户按 ESC）：游戏应暂停 */
  onLockLost: () => void;
  /** 指针锁定不可用：降级为拖拽视角，游戏继续 */
  onLockFailed: () => void;
}

interface WeaponState {
  def: WeaponDef;
  mag: number;      // -1 = 无限
  reserve: number;  // -1 = 无限
  cooldown: number;
  reloading: number; // >0 表示正在换弹（剩余秒数）
}

const EYE_ABOVE_CENTER = EYE_ABOVE_FEET - 0.35; // 胶囊半高 0.2 + 半径 0.15

export class Player {
  private canvas: HTMLCanvasElement;
  private camera: THREE.PerspectiveCamera;
  private input: Input3D;
  private combat: CombatHooks;
  private audio: GameAudio;
  private effects: Effects;
  private hud: HUD;

  controller: CharacterController3D;
  hp = PLAYER_HP;
  alive = true;

  private yaw = 0;
  private pitch = 0;
  private locked = false;
  private dragFallback = false;
  private active = false; // playing 状态且界面允许输入
  readonly isTouch: boolean;

  private weapons: WeaponState[] = [];
  private cur = 0;
  private switching = 0; // >0 切换中
  private pendingWeapon = -1;
  private triggerHeld = false;
  private semiArmed = true; // 半自动：每次扣下只打一发
  private sinceDamage = 99;
  private bobPhase = 0;
  private recoil = 0;
  private recoilPitch = 0; // 视角后座（可恢复）
  private swayX = 0;
  private swayY = 0;
  private baseFov: number;

  // 武器模型
  private gunRig = new THREE.Group();
  private gunObjs: THREE.Object3D[] = [];
  private muzzle = new THREE.Object3D();
  private muzzleWorld = new THREE.Vector3();

  // bot（自动试玩）
  botActive = false;
  private botFiring = false;

  constructor(opts: {
    canvas: HTMLCanvasElement;
    camera: THREE.PerspectiveCamera;
    scene: THREE.Scene;
    input: Input3D;
    world: unknown;
    RAPIER: { ColliderDesc: unknown; RigidBodyDesc: unknown };
    combat: CombatHooks;
    audio: GameAudio;
    effects: Effects;
    hud: HUD;
    spawn: { x: number; y: number; z: number };
  }) {
    this.canvas = opts.canvas;
    this.camera = opts.camera;
    this.input = opts.input;
    this.combat = opts.combat;
    this.audio = opts.audio;
    this.effects = opts.effects;
    this.hud = opts.hud;
    this.baseFov = opts.camera.fov;

    this.controller = new CharacterController3D(opts.world, opts.RAPIER as never, {
      position: opts.spawn,
      halfHeight: 0.2,
      radius: 0.15,
      speed: WALK_SPEED,
      stepHeight: 0.2,
      jumpSpeed: 4.6,
      coyoteTime: 0.12,
      jumpBuffer: 0.12,
      jumpCut: 0.45,
    });

    this.isTouch = 'ontouchstart' in window && !window.matchMedia?.('(pointer: fine)').matches;

    for (const def of WEAPONS) {
      this.weapons.push({ def, mag: def.mag, reserve: def.reserve, cooldown: 0, reloading: 0 });
    }

    // 持枪 rig 挂在相机上
    this.gunRig.position.set(0.25, -0.24, -0.5);
    this.camera.add(this.gunRig);
    this.muzzle.position.set(0, 0.06, -0.62);
    this.gunRig.add(this.muzzle);

    this.camera.rotation.order = 'YXZ';

    this.bindEvents();
  }

  /** 异步加载三把枪的模型（开局时调用一次） */
  async loadGuns(manifest: Manifest3D): Promise<void> {
    for (const w of this.weapons) {
      const { object } = await loadModelAsset(manifest, w.def.modelId, { assetBase: '' });
      const holder = new THREE.Group();
      // Kenney blaster 朝 +z，持枪视角需要朝 -z（相机前方）
      object.rotation.y = Math.PI;
      object.scale.setScalar(0.9);
      holder.add(object);
      holder.visible = false;
      this.gunRig.add(holder);
      this.gunObjs.push(holder);
    }
    this.gunObjs[0].visible = true;
  }

  // ------------------------------------------------------------ 输入 ---

  private bindEvents(): void {
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === this.canvas;
      if (!this.locked && this.active && !this.isTouch && !this.botActive) {
        this.triggerHeld = false;
        this.combat.onLockLost(); // 用户按 ESC 或锁定意外丢失 -> 暂停游戏
      }
    });
    document.addEventListener('pointerlockerror', () => this.enableDragFallback());
    document.addEventListener('mousemove', (e) => {
      if (!this.locked || !this.active) return;
      this.yaw -= e.movementX * LOOK_SENSITIVITY;
      this.pitch = THREE.MathUtils.clamp(
        this.pitch - e.movementY * LOOK_SENSITIVITY, -1.45, 1.45);
      this.swayX = THREE.MathUtils.clamp(this.swayX - e.movementX * 0.0004, -0.03, 0.03);
      this.swayY = THREE.MathUtils.clamp(this.swayY - e.movementY * 0.0004, -0.03, 0.03);
    });
    this.canvas.addEventListener('mousedown', (e) => {
      if (!this.active || !this.alive) return;
      if (e.button === 0) {
        // 未锁定时的降级：左键点击 = 射击（右键拖拽由 SDK 的 input.look 处理）
        this.triggerHeld = true;
        this.semiArmed = true;
      }
    });
    window.addEventListener('mouseup', (e) => {
      if (e.button === 0) { this.triggerHeld = false; this.semiArmed = true; }
    });
    this.canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    window.addEventListener('blur', () => { this.triggerHeld = false; });
    window.addEventListener('keydown', (e) => {
      if (!this.active || !this.alive) return;
      if (e.code === 'Digit1') this.switchTo(0);
      else if (e.code === 'Digit2') this.switchTo(1);
      else if (e.code === 'Digit3') this.switchTo(2);
      else if (e.code === 'KeyQ') this.switchTo((this.cur + 1) % this.weapons.length);
    });
    this.canvas.addEventListener('wheel', (e) => {
      if (!this.active || !this.alive) return;
      const d = e.deltaY > 0 ? 1 : -1;
      this.switchTo((this.cur + d + this.weapons.length) % this.weapons.length);
    }, { passive: true });
  }

  requestLock(): void {
    if (this.isTouch || this.botActive) return;
    try {
      const r = this.canvas.requestPointerLock() as unknown as Promise<void> | void;
      if (r instanceof Promise) r.catch(() => this.enableDragFallback());
    } catch {
      this.enableDragFallback();
    }
  }

  exitLock(): void {
    if (document.pointerLockElement) document.exitPointerLock();
  }

  private enableDragFallback(): void {
    if (this.dragFallback) return;
    this.dragFallback = true;
    this.combat.onLockFailed();
  }

  get useDragLook(): boolean {
    return this.dragFallback && !this.locked;
  }

  setActive(on: boolean): void {
    this.active = on;
    if (!on) this.triggerHeld = false;
  }

  /** bot 接口 */
  setBotLook(yaw: number, pitch: number): void {
    this.yaw = yaw;
    this.pitch = THREE.MathUtils.clamp(pitch, -1.45, 1.45);
  }
  setBotFiring(on: boolean): void {
    this.botFiring = on;
  }
  get lookYaw(): number { return this.yaw; }
  get lookPitch(): number { return this.pitch; }
  get curWeapon(): number { return this.cur; }
  switchWeaponPublic(i: number): void { this.switchTo(i); }

  eyePosition(out: THREE.Vector3): THREE.Vector3 {
    const p = this.controller.position;
    return out.set(p.x, p.y + EYE_ABOVE_CENTER, p.z);
  }

  aimDir(out: THREE.Vector3): THREE.Vector3 {
    const p = this.pitch + this.recoilPitch;
    const cp = Math.cos(p);
    return out.set(-Math.sin(this.yaw) * cp, Math.sin(p), -Math.cos(this.yaw) * cp);
  }

  // ------------------------------------------------------------ 战斗 ---

  private get weapon(): WeaponState {
    return this.weapons[this.cur];
  }

  private switchTo(i: number): void {
    if (i === this.cur || this.switching > 0) return;
    this.pendingWeapon = i;
    this.switching = 0.16; // 先下枪
    this.weapon.reloading = 0;
  }

  private startReload(): void {
    const w = this.weapon;
    if (w.def.mag < 0 || w.reloading > 0 || w.mag >= w.def.mag || w.reserve === 0) return;
    w.reloading = w.def.reloadTime;
    this.audio.play(SOUNDS.reload);
  }

  private tryFire(): void {
    const w = this.weapon;
    if (w.cooldown > 0 || w.reloading > 0 || this.switching > 0 || !this.alive) return;
    if (w.mag === 0) {
      // 空枪：咔哒 + 自动换弹
      this.audio.play(SOUNDS.reload);
      w.cooldown = 0.3;
      this.startReload();
      return;
    }
    // 开火
    const origin = this.eyePosition(new THREE.Vector3());
    const dir = this.aimDir(new THREE.Vector3());
    // 散布
    dir.x += (Math.random() - 0.5) * w.def.spread * 2;
    dir.y += (Math.random() - 0.5) * w.def.spread * 2;
    dir.z += (Math.random() - 0.5) * w.def.spread * 2;
    dir.normalize();
    this.combat.shoot(origin, dir, w.def);

    if (w.mag > 0) w.mag--;
    w.cooldown = w.def.interval;
    this.audio.play(SOUNDS[w.def.sound]);
    this.muzzle.getWorldPosition(this.muzzleWorld);
    this.effects.muzzle(this.muzzleWorld);
    this.effects.addShake(w.def.id === 'heavy' ? 0.22 : 0.06);
    // 后座：枪上跳（动画）+ 视角上跳（可恢复，不会永久漂移）
    this.recoil = Math.min(1, this.recoil + (w.def.id === 'heavy' ? 0.9 : 0.45));
    this.recoilPitch = Math.min(0.14, this.recoilPitch + w.def.kick);
    this.hud.setFiring(true);
  }

  damage(amount: number): void {
    if (!this.alive) return;
    this.hp -= amount;
    this.sinceDamage = 0;
    this.combat.onPlayerDamaged(amount);
    if (this.hp <= 0) {
      this.hp = 0;
      this.alive = false;
      this.triggerHeld = false;
      this.combat.onPlayerDeath();
    }
  }

  heal(amount: number): void {
    if (!this.alive) return;
    this.hp = Math.min(PLAYER_HP, this.hp + amount);
  }

  /** 拾取弹药：给步枪/重炮补备弹 */
  addReserveAmmo(): void {
    for (const w of this.weapons) {
      if (w.def.id === 'rifle' && w.reserve >= 0) w.reserve = Math.min(240, w.reserve + 60);
      if (w.def.id === 'heavy' && w.reserve >= 0) w.reserve = Math.min(40, w.reserve + 8);
    }
  }

  spawn(p: { x: number; y: number; z: number }): void {
    this.controller.teleport(p);
    this.yaw = 0;
    this.pitch = 0;
    this.hp = PLAYER_HP;
    this.alive = true;
    this.sinceDamage = 99;
    for (const w of this.weapons) {
      w.mag = w.def.mag;
      w.reserve = w.def.reserve;
      w.cooldown = 0;
      w.reloading = 0;
    }
    this.cur = 0;
    this.gunObjs.forEach((g, i) => { g.visible = i === 0; });
  }

  // ------------------------------------------------------------ 主循环 ---

  update(dt: number): void {
    const w = this.weapon;

    // 视角：锁定模式走 mousemove 累计；降级模式走 SDK 右键拖拽
    if (this.active && !this.locked && !this.botActive && !this.isTouch) {
      const turn = this.input.look();
      if (turn.x || turn.y) {
        this.yaw -= turn.x;
        this.pitch = THREE.MathUtils.clamp(this.pitch - turn.y, -1.45, 1.45);
      }
    }

    // 移动
    let mx = 0, mz = 0;
    if (this.active && this.alive) {
      const d = this.input.direction(this.yaw);
      mx = d.x; mz = d.z;
    }
    const sprinting = this.input.isDown('ShiftLeft', 'ShiftRight') && Math.hypot(mx, mz) > 0.1;
    // CharacterController3D 的速度在构造参数里，疾跑时直接改（内部字段，无 setter）
    (this.controller as unknown as { opts: { speed: number } }).opts.speed =
      sprinting ? SPRINT_SPEED : WALK_SPEED;
    this.controller.update(dt, { x: mx, z: mz }, { jump: this.active && this.input.jump });

    // 掉出世界保护（理论上不会发生，围墙封死了）
    if (this.controller.position.y < -5) {
      this.controller.teleport({ x: 0, y: 0.65, z: 6 });
    }

    // 相机跟随
    const p = this.controller.position;
    const shake = this.effects.shakeOffset();
    this.camera.position.set(p.x + shake.x, p.y + EYE_ABOVE_CENTER + shake.y, p.z);
    this.camera.rotation.set(this.pitch + this.recoilPitch, this.yaw, shake.roll);
    const targetFov = this.baseFov + (sprinting ? 7 : 0);
    if (Math.abs(this.camera.fov - targetFov) > 0.1) {
      this.camera.fov += (targetFov - this.camera.fov) * Math.min(1, dt * 8);
      this.camera.updateProjectionMatrix();
    }

    // 武器冷却 / 换弹 / 切换
    w.cooldown = Math.max(0, w.cooldown - dt);
    if (w.reloading > 0) {
      w.reloading -= dt;
      if (w.reloading <= 0) {
        const need = w.def.mag - w.mag;
        const take = w.reserve < 0 ? need : Math.min(need, w.reserve);
        w.mag += take;
        if (w.reserve > 0) w.reserve -= take;
        w.reloading = 0;
      }
    }
    if (this.switching > 0) {
      this.switching -= dt;
      if (this.switching <= 0 && this.pendingWeapon >= 0) {
        this.gunObjs[this.cur].visible = false;
        this.cur = this.pendingWeapon;
        this.pendingWeapon = -1;
        this.gunObjs[this.cur].visible = true;
        this.switching = -0.14; // 抬枪
      }
    } else if (this.switching < 0) {
      this.switching += dt;
      if (this.switching >= 0) this.switching = 0;
    }

    // 触屏开火按钮 / 键盘 R
    if (this.active && this.alive) {
      if (this.input.consume('shoot')) { this.triggerHeld = true; this.semiArmed = true; }
      if (!this.input.held('shoot') && !this.botActive && this.isTouch) this.triggerHeld = false;
      if (this.input.consume('reload')) this.startReload();
    }

    // 开火逻辑
    const wantFire = this.botActive ? this.botFiring : this.triggerHeld;
    if (this.active && this.alive && wantFire) {
      if (w.def.auto) {
        this.tryFire();
      } else if (this.semiArmed || this.botActive) {
        // bot 用半自动武器时视为连续扣扳机
        this.semiArmed = false;
        this.tryFire();
      }
    } else {
      this.hud.setFiring(false);
    }

    // 回血
    this.sinceDamage += dt;
    if (this.alive && this.sinceDamage > PLAYER_REGEN_DELAY && this.hp < PLAYER_HP) {
      this.hp = Math.min(PLAYER_HP, this.hp + PLAYER_REGEN_RATE * dt);
    }

    // 持枪动画：行走摆动 + 视角 sway + 后座
    this.recoil = Math.max(0, this.recoil - dt * 6);
    this.recoilPitch *= 1 - Math.min(1, dt * 7); // 视角后座回落
    this.swayX *= 1 - Math.min(1, dt * 10);
    this.swayY *= 1 - Math.min(1, dt * 10);
    const moving = Math.hypot(mx, mz);
    this.bobPhase += dt * (4 + moving * 2.2);
    const bobA = Math.min(1, moving) * 0.014;
    const switchDip = this.switching !== 0 ? -0.18 * Math.min(1, Math.abs(this.switching) / 0.16) : 0;
    this.gunRig.position.set(
      0.25 + this.swayX + Math.cos(this.bobPhase * 0.5) * bobA * 0.6,
      -0.24 + this.swayY + Math.abs(Math.sin(this.bobPhase)) * bobA + switchDip,
      -0.5 + this.recoil * 0.07,
    );
    this.gunRig.rotation.x = this.recoil * 0.12;

    // HUD
    this.hud.setHealth(this.hp, PLAYER_HP);
    this.hud.setAmmo(
      w.def.name,
      w.def.mag < 0 ? null : w.mag,
      w.def.reserve < 0 ? null : w.reserve,
    );
    this.hud.setReloading(w.reloading > 0, w.def.mag >= 0 && w.mag === 0 && w.reloading <= 0);
  }
}
