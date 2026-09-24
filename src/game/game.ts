import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import {
  ThreeUmicat, loadScene3D, loadModelAsset, Input3D,
  setupScreenshotListener, setupRecordingListener, updateTints,
  type Manifest3D, type Scene3D, type LoadedScene3D,
} from '@umicat/three-sdk';
import { createGameAudio, SOUNDS, type SoundName } from './audio';
import { HUD } from './hud';
import { Effects } from './effects';
import { Player, type CombatHooks } from './player';
import { EnemyManager, type Enemy, type Obstacle, type SpawnTemplate } from './enemies';
import { WaveDirector } from './waves';
import {
  SAVE_KEY_BEST, FLOOR_TOP, type WeaponDef,
} from './config';

type GameState = 'menu' | 'playing' | 'paused' | 'over';

interface Pickup {
  group: THREE.Group;
  kind: 'health' | 'ammo';
  t: number;
  life: number;
}

const V = new THREE.Vector3();
const V2 = new THREE.Vector3();

export class Game {
  private umicat!: ThreeUmicat;
  private world!: LoadedScene3D;
  private rapierWorld!: RAPIER.World;
  private renderer!: THREE.WebGLRenderer;
  private input!: Input3D;
  private audio = createGameAudio();
  private hud!: HUD;
  private effects!: Effects;
  private player!: Player;
  private enemies!: EnemyManager;
  private waves!: WaveDirector;

  private state: GameState = 'menu';
  private score = 0;
  private best = 0;
  private kills = 0;
  private damageFlash = 0;
  private obstacles: Obstacle[] = [];
  private gates: THREE.Vector3[] = [];
  private spawnPos = { x: 0, y: 0.65, z: 6 };
  private pickups: Pickup[] = [];
  private manifest!: Manifest3D;

  readonly autopilot: boolean;
  private botStrafeT = 0;
  private botStrafeDir = 1;
  private botJumpT = 4;
  private botWeaponT = 18;

  private constructor(autopilot: boolean) {
    this.autopilot = autopilot;
  }

  // ------------------------------------------------------------ 启动 ---

  static async create(canvas: HTMLCanvasElement): Promise<Game> {
    const autopilot = new URLSearchParams(location.search).has('autopilot');
    const game = new Game(autopilot);
    await game.boot(canvas);
    return game;
  }

  private async boot(canvas: HTMLCanvasElement): Promise<void> {
    // 1) 平台
    this.umicat = await ThreeUmicat.init();
    // 2) 物理
    await RAPIER.init();
    // 3) 场景（设计数据）
    const [manifest, scene3d] = await Promise.all([
      fetch('scenes3d/manifest.json').then((r) => r.json() as Promise<Manifest3D>),
      fetch('scenes3d/main.json').then((r) => r.json() as Promise<Scene3D>),
    ]);
    this.manifest = manifest;
    this.world = await loadScene3D(scene3d, manifest, { assetBase: '', rapier: RAPIER });
    this.rapierWorld = this.world.world as RAPIER.World;

    // 4) 渲染器
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.15;
    setupScreenshotListener(this.renderer);
    setupRecordingListener(this.renderer);

    const camera = this.world.camera;
    camera.near = 0.05;
    camera.far = 150;
    camera.updateProjectionMatrix();
    this.world.scene.add(camera); // 持枪 rig 是相机的子节点，必须进场景才能渲染
    this.addStarfield();

    const resize = (): void => {
      this.renderer.setSize(window.innerWidth, window.innerHeight, false);
      camera.aspect = window.innerWidth / window.innerHeight;
      camera.updateProjectionMatrix();
    };
    resize();
    window.addEventListener('resize', resize);

    // 5) 输入（shoot/reload 按钮主要给触屏用，桌面走鼠标）
    this.input = new Input3D({
      actions: [
        { id: 'shoot', label: '✦' },
        { id: 'reload', label: '↻', keys: ['KeyR'] },
      ],
    });

    // 6) HUD / 特效
    this.hud = new HUD({
      onStart: () => this.startGame(),
      onResume: () => this.resumeGame(),
      onRestart: () => this.startGame(),
    });
    this.effects = new Effects(this.world.scene);

    // 7) 关卡标记：出生点、四门、掩体（从场景 JSON 派生，避免 hardcode）
    const ent = (id: string): THREE.Object3D => {
      const o = this.world.entities.get(id);
      if (!o) throw new Error(`场景缺少实体 ${id}`);
      return o;
    };
    this.spawnPos = { ...ent('player-spawn').position, y: 0.65 };
    this.gates = ['gate-north', 'gate-south', 'gate-east', 'gate-west']
      .map((id) => ent(id).position.clone());
    for (const e of scene3d.entities) {
      const c = e.collider;
      if (c && c.shape.kind === 'box') {
        const p = e.transform.position;
        // 只收场内的掩体碰撞体（围墙在 |x|=10，不需要）
        if (Math.abs(p.x) < 9.6 && Math.abs(p.z) < 9.6) {
          const off = c.offset ?? { x: 0, y: 0, z: 0 };
          this.obstacles.push({
            x: p.x + off.x, z: p.z + off.z,
            r: Math.max(c.shape.halfExtents.x, c.shape.halfExtents.z) + 0.15,
          });
        }
      }
    }

    // 8) 敌人模板（character.glb，运行时克隆）
    const heroAsset = await loadModelAsset(manifest, 'hero', { assetBase: '' });
    const clipMap = (manifest.models?.find((m) => m.id === 'hero') as
      { animations?: Record<string, string> } | undefined)?.animations ?? {};
    const tpl: SpawnTemplate = { object: heroAsset.object, clips: heroAsset.clips, clipMap };

    // 9) 玩家 / 敌人 / 波次
    const combat: CombatHooks = {
      shoot: (o, d, w) => this.shoot(o, d, w),
      onPlayerDamaged: (amount) => this.onPlayerDamaged(amount),
      onPlayerDeath: () => this.onPlayerDeath(),
      onLockLost: () => this.pauseGame(),
      onLockFailed: () => this.onLockFailed(),
    };
    this.player = new Player({
      canvas, camera, scene: this.world.scene, input: this.input,
      world: this.rapierWorld, RAPIER: RAPIER as never,
      combat, audio: this.audio, effects: this.effects, hud: this.hud,
      spawn: this.spawnPos,
    });
    await this.player.loadGuns(manifest);
    this.enemies = new EnemyManager(this.world.scene, tpl, {
      onMeleeDamage: (dmg) => this.player.damage(dmg),
      onRangedFire: (from, dir, speed, dmg) => {
        this.effects.fireBolt(from, dir, speed, dmg);
        this.playSound('enemy_shoot');
      },
      onDeath: (e) => this.onEnemyDeath(e),
    }, this.effects);
    this.waves = new WaveDirector(this.gates, {
      onWaveStart: (n) => this.onWaveStart(n),
      onWaveClear: (n) => this.onWaveClear(n),
      onIntermission: (s) => this.hud.setIntermission(s),
    });

    // 10) 存档
    this.best = (await this.umicat.saves.get<number>(SAVE_KEY_BEST)) ?? 0;
    this.hud.setStartBest(this.best);
    this.hud.setScore(0, this.best);
    this.hud.setHealth(100, 100);

    // 调试/测试手柄
    const self = this;
    Object.assign(window as unknown as Record<string, unknown>, {
      __game: {
        game: self,
        get state() { return self.state; },
        get score() { return self.score; },
        get kills() { return self.kills; },
        get wave() { return self.waves.wave; },
        player: self.player,
        enemies: self.enemies,
        waves: self.waves,
      },
    });

    document.addEventListener('visibilitychange', () => {
      if (document.hidden && this.state === 'playing') this.pauseGame();
    });

    // 11) 主循环
    let last = performance.now();
    this.renderer.setAnimationLoop((now: number) => {
      const dt = Math.min((now - last) / 1000, 0.05);
      last = now;
      this.tick(dt);
      this.world.update(dt);
      this.renderer.render(this.world.scene, camera);
    });

    if (this.autopilot) {
      // 自动试玩：跳过开始界面，bot 接管
      this.player.botActive = true;
      this.startGame();
    } else {
      this.hud.showStart();
    }
  }

  /** 头顶的星空：空间站露天停机坪，星星是最便宜的浪漫 */
  private addStarfield(): void {
    const c = document.createElement('canvas');
    c.width = 1024; c.height = 512;
    const g = c.getContext('2d')!;
    const grad = g.createLinearGradient(0, 0, 0, 512);
    grad.addColorStop(0, '#02040c');
    grad.addColorStop(0.55, '#060a18');
    grad.addColorStop(1, '#030510');
    g.fillStyle = grad;
    g.fillRect(0, 0, 1024, 512);
    // 随机星点：亮度/大小/色温都有变化
    for (let i = 0; i < 900; i++) {
      const x = Math.random() * 1024;
      const y = Math.random() * 512;
      const r = Math.random();
      const size = r < 0.92 ? 1 : r < 0.99 ? 1.8 : 2.6;
      const a = 0.35 + Math.random() * 0.65;
      const tint = Math.random();
      g.fillStyle = tint < 0.7 ? `rgba(255,255,255,${a})`
        : tint < 0.85 ? `rgba(170,210,255,${a})` : `rgba(255,220,180,${a})`;
      g.beginPath();
      g.arc(x, y, size, 0, Math.PI * 2);
      g.fill();
      if (size > 1.8) { // 亮星加十字光
        g.strokeStyle = `rgba(255,255,255,${a * 0.5})`;
        g.lineWidth = 1;
        g.beginPath();
        g.moveTo(x - size * 3, y); g.lineTo(x + size * 3, y);
        g.moveTo(x, y - size * 3); g.lineTo(x, y + size * 3);
        g.stroke();
      }
    }
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    const sky = new THREE.Mesh(
      new THREE.SphereGeometry(120, 24, 16),
      new THREE.MeshBasicMaterial({ map: tex, side: THREE.BackSide, fog: false, depthWrite: false }),
    );
    sky.renderOrder = -10;
    this.world.scene.add(sky);
  }

  // ------------------------------------------------------------ 流程 ---

  private startGame(): void {
    this.hud.hideStart();
    this.hud.hideGameOver();
    this.hud.hidePause();
    this.score = 0;
    this.kills = 0;
    this.damageFlash = 0;
    this.enemies.clear();
    this.effects.clearBolts();
    this.clearPickups();
    this.player.spawn(this.spawnPos);
    this.waves.start();
    this.state = 'playing';
    this.player.setActive(true);
    this.input.setEnabled(true);
    this.hud.setScore(0, this.best);
    if (this.autopilot) {
      this.input.press('KeyW');
    } else {
      this.player.requestLock();
      this.hud.setLockHint(this.player.isTouch ? '左侧摇杆移动 · 右侧滑动旋转视角' : '');
    }
  }

  private pauseGame(): void {
    if (this.state !== 'playing' || this.autopilot) return;
    this.state = 'paused';
    this.player.setActive(false);
    this.player.exitLock();
    this.input.setEnabled(false);
    this.hud.showPause();
  }

  private resumeGame(): void {
    if (this.state !== 'paused') return;
    this.hud.hidePause();
    this.state = 'playing';
    this.player.setActive(true);
    this.input.setEnabled(true);
    this.player.requestLock(); // 在按钮点击手势里调用，合法
  }

  private onLockFailed(): void {
    // 指针锁定不可用（iframe 没授权等）：降级为右键拖拽视角，游戏继续
    if (this.state === 'playing') {
      this.hud.setLockHint('鼠标锁定不可用：按住右键拖拽旋转视角');
    }
  }

  private onPlayerDeath(): void {
    if (this.state !== 'playing') return;
    this.state = 'over';
    this.player.setActive(false);
    this.player.exitLock();
    this.input.setEnabled(false);
    const isNewBest = this.score > this.best;
    if (isNewBest) {
      this.best = this.score;
      void this.umicat.saves.set(SAVE_KEY_BEST, this.best);
    }
    this.hud.setScore(this.score, this.best);
    this.hud.showGameOver(this.score, this.best, isNewBest);
  }

  // ------------------------------------------------------------ 战斗 ---

  private playSound(name: SoundName): void {
    this.audio.play(SOUNDS[name]);
  }

  /** 玩家开火：物理射线（墙） vs 敌人胶囊，取最近者 */
  private shoot(origin: THREE.Vector3, dir: THREE.Vector3, weapon: WeaponDef): void {
    const ray = new RAPIER.Ray(
      { x: origin.x, y: origin.y, z: origin.z },
      { x: dir.x, y: dir.y, z: dir.z },
    );
    const wallHit = this.rapierWorld.castRay(
      ray, 60, true, undefined, undefined,
      this.player.controller.collider as RAPIER.Collider,
    );
    const wallDist = wallHit ? wallHit.timeOfImpact : 60;

    const eHit = this.enemies.raycast(origin, dir, Math.min(wallDist, 60));
    const tracerFrom = V.copy(origin).addScaledVector(dir, 0.55).clone();

    if (eHit && eHit.dist <= wallDist) {
      const hitPoint = V2.copy(origin).addScaledVector(dir, eHit.dist).clone();
      const dmg = weapon.damage * (eHit.head ? weapon.headshotMult : 1);
      const killed = eHit.enemy.hit(dmg, eHit.head, hitPoint);
      this.effects.tracer(tracerFrom, hitPoint, weapon.tracerColor);
      this.playSound('hit');
      this.hud.showHitmarker(killed);
      if (weapon.splash) {
        this.explode(hitPoint, weapon.splash.radius, weapon.splash.damage, eHit.enemy);
      }
    } else if (wallHit) {
      const hitPoint = V2.copy(origin).addScaledVector(dir, wallDist).clone();
      this.effects.tracer(tracerFrom, hitPoint, weapon.tracerColor);
      this.effects.spark(hitPoint, 0x88aaff, 8, 2.5);
      if (weapon.splash) {
        this.explode(hitPoint, weapon.splash.radius, weapon.splash.damage, null);
      }
    } else {
      const far = V2.copy(origin).addScaledVector(dir, 60).clone();
      this.effects.tracer(tracerFrom, far, weapon.tracerColor);
    }
  }

  private explode(center: THREE.Vector3, radius: number, damage: number, exclude: Enemy | null): void {
    this.effects.explosion(center, radius);
    this.playSound('kill');
    this.effects.addShake(0.3);
    for (const e of this.enemies.splash(center, radius, damage)) {
      if (e === exclude || !e.alive) continue;
      const killed = e.hit(damage, false, e.position.clone().setY(center.y));
      if (killed) this.hud.showHitmarker(true);
    }
  }

  private onEnemyDeath(e: Enemy): void {
    this.kills++;
    const pts = e.def.score;
    this.score += pts;
    this.hud.setScore(this.score, this.best);
    this.playSound('kill');
    // 飘字
    V.copy(e.position); V.y += 1.1; V.project(this.world.camera);
    if (V.z < 1) {
      this.hud.floatText(`+${pts}`,
        (V.x * 0.5 + 0.5) * window.innerWidth,
        (-V.y * 0.5 + 0.5) * window.innerHeight);
    }
    // 掉落
    const roll = Math.random();
    if (roll < 0.12) this.spawnPickup(e.position, 'health');
    else if (roll < 0.22) this.spawnPickup(e.position, 'ammo');
  }

  private onPlayerDamaged(amount: number): void {
    this.damageFlash = Math.min(1, this.damageFlash + 0.35 + amount * 0.012);
    this.effects.addShake(0.3);
    this.playSound('hurt');
  }

  private onWaveStart(n: number): void {
    this.hud.showBanner(`第 ${n} 波`, n === 1 ? '守住停机坪！' : `${this.waves.waveSizeCurrent} 个敌人正在接近`);
    this.playSound('wave');
    if (n > 1) {
      this.player.heal(25);
      this.hud.floatText('+25', window.innerWidth / 2, window.innerHeight * 0.42, 'sh-heal');
    }
  }

  private onWaveClear(n: number): void {
    const bonus = 40 * n;
    this.score += bonus;
    this.hud.setScore(this.score, this.best);
    this.hud.showBanner('区域已清空', `波次奖励 +${bonus}`);
    if (this.score > this.best) {
      this.best = this.score;
      void this.umicat.saves.set(SAVE_KEY_BEST, this.best);
    }
  }

  // ------------------------------------------------------------ 拾取 ---

  private spawnPickup(pos: THREE.Vector3, kind: 'health' | 'ammo'): void {
    const group = new THREE.Group();
    const color = kind === 'health' ? 0x2dff7a : 0xffd34d;
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(0.22, 0.22, 0.22),
      new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.9 }),
    );
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({
      map: this.glowTexture(), color, transparent: true,
      blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0.6,
    }));
    glow.scale.setScalar(0.7);
    group.add(mesh, glow);
    group.position.set(
      THREE.MathUtils.clamp(pos.x, -9, 9), FLOOR_TOP + 0.35,
      THREE.MathUtils.clamp(pos.z, -9, 9));
    this.world.scene.add(group);
    this.pickups.push({ group, kind, t: Math.random() * 5, life: 25 });
  }

  private glowTexture(): THREE.Texture {
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const g = c.getContext('2d')!;
    const grad = g.createRadialGradient(32, 32, 2, 32, 32, 32);
    grad.addColorStop(0, 'rgba(255,255,255,1)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 64, 64);
    return new THREE.CanvasTexture(c);
  }

  private updatePickups(dt: number): void {
    const pp = this.player.controller.position;
    for (let i = this.pickups.length - 1; i >= 0; i--) {
      const p = this.pickups[i];
      p.t += dt;
      p.life -= dt;
      p.group.position.y = FLOOR_TOP + 0.35 + Math.sin(p.t * 3) * 0.08;
      p.group.rotation.y += dt * 2.2;
      const dx = p.group.position.x - pp.x;
      const dz = p.group.position.z - pp.z;
      const d = Math.hypot(dx, dz);
      if (d < 2.2 && d > 0.01) {
        // 磁吸
        p.group.position.x -= (dx / d) * dt * 3;
        p.group.position.z -= (dz / d) * dt * 3;
      }
      let take = false;
      if (d < 0.75) take = true;
      if (p.life <= 0) take = true; // 消失也移除
      if (take && d < 0.75) {
        if (p.kind === 'health') {
          this.player.heal(30);
          this.hud.floatText('+30', window.innerWidth / 2, window.innerHeight * 0.55, 'sh-heal');
        } else {
          this.player.addReserveAmmo();
          this.hud.floatText('弹药补充', window.innerWidth / 2, window.innerHeight * 0.55, 'sh-heal');
        }
        this.playSound('pickup');
      }
      if (take || p.life <= 0) {
        this.world.scene.remove(p.group);
        this.pickups.splice(i, 1);
        continue;
      }
      // 最后 5 秒闪烁
      p.group.visible = p.life > 5 || Math.sin(p.t * 12) > -0.2;
    }
  }

  private clearPickups(): void {
    for (const p of this.pickups) this.world.scene.remove(p.group);
    this.pickups.length = 0;
  }

  // ------------------------------------------------------------ 主循环 ---

  private tick(dt: number): void {
    if (this.state === 'playing') {
      this.player.update(dt);
      const pp = this.player.controller.position;
      V2.set(pp.x, pp.y, pp.z);

      this.enemies.update(dt, V2, this.obstacles);
      updateTints(this.enemies.objects);
      this.waves.update(dt, this.enemies);

      // 敌方弹丸
      for (const dmg of this.effects.updateBolts(dt, V2, 0.55)) {
        this.player.damage(dmg);
      }

      this.updatePickups(dt);
      this.effects.update(dt);

      // 受伤红屏衰减
      this.damageFlash = Math.max(0, this.damageFlash - dt * 1.6);
      this.hud.setDamageFlash(this.damageFlash);

      this.hud.setWave(this.waves.wave, this.waves.remaining(this.enemies));

      if (this.autopilot) this.botUpdate(dt);
    }
  }

  // ------------------------------------------------------------ 自动试玩 ---

  private botUpdate(dt: number): void {
    const pp = this.player.controller.position;
    let best: Enemy | null = null;
    let bestD = 1e9;
    for (const e of this.enemies.list) {
      if (!e.alive) continue;
      const d = Math.hypot(e.position.x - pp.x, e.position.z - pp.z);
      if (d < bestD) { bestD = d; best = e; }
    }
    if (best) {
      const dx = best.position.x - pp.x;
      const dz = best.position.z - pp.z;
      const desYaw = Math.atan2(-dx, -dz);
      const eyeY = pp.y + 0.27;
      const targetY = 0.3 + 0.35 * best.def.scale;
      const desPitch = Math.atan2(targetY - eyeY, Math.hypot(dx, dz));
      let dyaw = desYaw - this.player.lookYaw;
      while (dyaw > Math.PI) dyaw -= Math.PI * 2;
      while (dyaw < -Math.PI) dyaw += Math.PI * 2;
      const k = Math.min(1, dt * 7);
      this.player.setBotLook(
        this.player.lookYaw + dyaw * k,
        this.player.lookPitch + (desPitch - this.player.lookPitch) * k,
      );
      this.player.setBotFiring(Math.abs(dyaw) < 0.12 && bestD < 30);
    } else {
      this.player.setBotFiring(false);
    }
    // 走位：左右横移
    this.botStrafeT -= dt;
    if (this.botStrafeT <= 0) {
      this.botStrafeT = 1.6 + Math.random();
      this.botStrafeDir *= -1;
      this.input.release('KeyA');
      this.input.release('KeyD');
      this.input.press(this.botStrafeDir > 0 ? 'KeyD' : 'KeyA');
    }
    // 偶尔跳
    this.botJumpT -= dt;
    if (this.botJumpT <= 0) {
      this.botJumpT = 5 + Math.random() * 5;
      this.input.press('Space');
      window.setTimeout(() => this.input.release('Space'), 200);
    }
    // 轮换武器，覆盖全部武器代码路径
    this.botWeaponT -= dt;
    if (this.botWeaponT <= 0) {
      this.botWeaponT = 18;
      const cur = this.player.curWeapon;
      this.player.switchWeaponPublic((cur + 1) % 3);
    }
  }
}
