import Phaser from 'phaser';
import { loadWorldScene, getEntityRegistry } from '@umicat/phaser-sdk';
import { GAME_WIDTH, GAME_HEIGHT } from '../config';
import { umicatReady } from '../main';
import { fetchLeaderboard, submitScore, LeaderboardEntry } from '../leaderboard';

// ─── Game constants ──────────────────────────────────────────────────────────

const PLAYER_SPEED        = 300;
const BULLET_SPEED        = 650;
const FIRE_RATE_NORMAL    = 220;   // ms between shots (normal)
const FIRE_RATE_RAPID     = 90;    // ms between shots (rapid fire)
const RAPID_FIRE_DURATION = 5000;  // ms
const SHIELD_DURATION     = 3000;  // ms
const COMBO_WINDOW        = 1200;  // ms between kills to maintain combo
const POWERUP_CHANCE      = 0.13;  // probability per kill

const BASE_SPEEDS  = { drone: 120, zigzagger: 95,  tanker: 60 };
const BASE_HP      = { drone: 1,   zigzagger: 1,   tanker: 3  };
const BASE_POINTS  = { drone: 10,  zigzagger: 25,  tanker: 50 };
const ENEMY_COLORS = { drone: 0x00ddff, zigzagger: 0xff44aa, tanker: 0x9966ff };

type EnemyType  = 'drone' | 'tanker' | 'zigzagger';
type PowerUpType = 'rapid' | 'shield' | 'bomb';

// ─── Scene ───────────────────────────────────────────────────────────────────

export class GameScene extends Phaser.Scene {
  private sceneId!: string;
  private ready = false;

  // Player
  private player!: Phaser.GameObjects.Graphics;
  private playerAlive = true;
  private engineTrail!: Phaser.GameObjects.Particles.ParticleEmitter;

  // Input
  private wasd!: Record<'up' | 'down' | 'left' | 'right', Phaser.Input.Keyboard.Key>;
  private cursors!: Phaser.Types.Input.Keyboard.CursorKeys;

  // Bullets
  private bullets!: Phaser.Physics.Arcade.Group;
  private canFire = true;
  private fireRate = FIRE_RATE_NORMAL;
  private rapidFireTimer: Phaser.Time.TimerEvent | null = null;

  // Enemies
  private enemies!: Phaser.Physics.Arcade.Group;
  private difficultyLevel = 1;
  private spawnTimer!: Phaser.Time.TimerEvent;

  // Power-ups
  private powerups!: Phaser.Physics.Arcade.Group;
  private isInvincible = false;
  private shieldRing: Phaser.GameObjects.Arc | null = null;
  private shieldTimer: Phaser.Time.TimerEvent | null = null;

  // Scoring
  private score = 0;
  private highScore = 0;
  private combo = 0;
  private lastKillTime = 0;

  // HUD
  private scoreText!: Phaser.GameObjects.Text;
  private highScoreText!: Phaser.GameObjects.Text;
  private levelText!: Phaser.GameObjects.Text;
  private comboText!: Phaser.GameObjects.Text;
  private powerupText!: Phaser.GameObjects.Text;

  // Game state
  private gameOver = false;
  private powerupTextTimer: Phaser.Time.TimerEvent | null = null;

  // Background asteroids
  private asteroids: Array<{ obj: Phaser.GameObjects.Image; vx: number; vy: number; rotRate: number }> = [];

  constructor() {
    super({ key: 'GameScene' });
  }

  init(data: { sceneId: string }): void {
    this.sceneId = data.sceneId;
    // Reset state on restart
    this.ready        = false;
    this.playerAlive  = true;
    this.gameOver     = false;
    this.score        = 0;
    this.combo        = 0;
    this.lastKillTime = 0;
    this.difficultyLevel = 1;
    this.fireRate     = FIRE_RATE_NORMAL;
    this.canFire      = true;
    this.isInvincible = false;
    this.shieldRing   = null;
    this.shieldTimer  = null;
    this.rapidFireTimer = null;
    this.powerupTextTimer = null;
    this.asteroids = [];
  }

  // ─── Create ───────────────────────────────────────────────────────────────

  async create(): Promise<void> {
    // 0. Generate asteroid textures (needed by createBackground)
    this.generateAsteroidTextures();

    // 1. Draw background (depth 0)
    this.createBackground();

    // 2. Load world scene → spawns player entity
    await loadWorldScene(this, this.sceneId);

    // 3. Grab player from entity registry
    const reg = getEntityRegistry(this)!;
    this.player = reg.byRole('player')[0] as Phaser.GameObjects.Graphics;
    this.player.setDepth(3);

    // 4. Physics for player
    this.physics.add.existing(this.player);
    const body = this.player.body as Phaser.Physics.Arcade.Body;
    body.setCollideWorldBounds(true);
    // Tight cockpit hitbox (28×22) centered in the 48×40 bounding box
    body.setSize(28, 22);
    body.setOffset((48 - 28) / 2, (40 - 22) / 2);

    // 5. Generate textures for enemies / bullets / powerups
    this.generateTextures();

    // 6. Physics groups
    this.bullets  = this.physics.add.group();
    this.enemies  = this.physics.add.group();
    this.powerups = this.physics.add.group();

    // 7. Engine trail particles
    this.engineTrail = this.add.particles(this.player.x, this.player.y, 'particle', {
      speed: { min: 20, max: 50 },
      lifespan: { min: 120, max: 250 },
      scale: { start: 0.55, end: 0 },
      alpha: { start: 0.85, end: 0 },
      tint: [0xff8800, 0xffdd44],
      emitting: false,
    }).setDepth(1);

    // 8. Input
    const kb = this.input.keyboard!;
    this.cursors = kb.createCursorKeys();
    this.wasd = {
      up:    kb.addKey(Phaser.Input.Keyboard.KeyCodes.W),
      down:  kb.addKey(Phaser.Input.Keyboard.KeyCodes.S),
      left:  kb.addKey(Phaser.Input.Keyboard.KeyCodes.A),
      right: kb.addKey(Phaser.Input.Keyboard.KeyCodes.D),
    };

    // 9. Colliders
    this.physics.add.overlap(
      this.bullets, this.enemies,
      (_b, _e) => this.onBulletHitEnemy(
        _b as Phaser.Physics.Arcade.Image,
        _e as Phaser.Physics.Arcade.Image,
      ),
      undefined, this,
    );
    this.physics.add.overlap(
      this.player, this.enemies,
      (_p, _e) => this.onPlayerHitEnemy(_e as Phaser.Physics.Arcade.Image),
      undefined, this,
    );
    this.physics.add.overlap(
      this.player, this.powerups,
      (_p, _pu) => this.onPickupPowerup(_pu as Phaser.Physics.Arcade.Image),
      undefined, this,
    );

    // 10. HUD
    this.createHUD();

    // 11. Load high score
    await this.loadHighScore();

    // 12. Start spawning + difficulty ramp
    this.startSpawning();
    this.time.addEvent({
      delay: 15000,
      loop: true,
      callback: this.rampDifficulty,
      callbackScope: this,
    });

    this.ready = true;
  }

  // ─── Background ───────────────────────────────────────────────────────────

  private generateAsteroidTextures(): void {
    type AstDef = { key: string; w: number; h: number; pts: { x: number; y: number }[]; col: number; hi: number };
    const defs: AstDef[] = [
      {
        key: 'ast-sm', w: 22, h: 18, col: 0x3a3530, hi: 0x504d4a,
        pts: [{x:11,y:1},{x:17,y:3},{x:21,y:8},{x:20,y:14},{x:14,y:17},{x:6,y:17},{x:1,y:12},{x:2,y:5}],
      },
      {
        key: 'ast-md', w: 40, h: 30, col: 0x302e2c, hi: 0x484644,
        pts: [{x:20,y:1},{x:30,y:3},{x:38,y:11},{x:37,y:22},{x:28,y:29},{x:14,y:29},{x:4,y:22},{x:2,y:12},{x:8,y:4}],
      },
      {
        key: 'ast-lg', w: 54, h: 42, col: 0x2c2e30, hi: 0x424446,
        pts: [{x:27,y:1},{x:42,y:4},{x:52,y:16},{x:51,y:29},{x:40,y:40},{x:22,y:41},{x:8,y:34},{x:2,y:20},{x:5,y:9},{x:16,y:3}],
      },
    ];

    for (const d of defs) {
      const g = this.make.graphics({ x: 0, y: 0, add: false });
      // Base fill
      g.fillStyle(d.col, 1);
      g.fillPoints(d.pts, true);
      // Subtle top-left highlight
      g.fillStyle(d.hi, 0.35);
      g.fillPoints(d.pts.slice(0, Math.ceil(d.pts.length / 2)).concat([d.pts[0]]), true);
      // Outline
      g.lineStyle(1, 0x505050, 0.6);
      g.strokePoints(d.pts, true);
      // Craters
      g.fillStyle(0x181716, 0.65);
      g.fillCircle(d.w * 0.38, d.h * 0.42, d.w * 0.09);
      g.fillCircle(d.w * 0.64, d.h * 0.56, d.w * 0.055);
      g.generateTexture(d.key, d.w, d.h);
      g.destroy();
    }
  }

  private createBackground(): void {
    // Deep space gradient
    const bg = this.add.graphics().setDepth(0);
    bg.fillGradientStyle(0x030310, 0x030310, 0x08082a, 0x08082a, 1);
    bg.fillRect(0, 0, GAME_WIDTH, GAME_HEIGHT);

    // Subtle nebula blobs
    const neb = this.add.graphics().setDepth(0);
    neb.fillStyle(0x1a0044, 0.22);
    neb.fillEllipse(220, 160, 340, 200);
    neb.fillStyle(0x001a44, 0.18);
    neb.fillEllipse(1050, 560, 300, 210);
    neb.fillStyle(0x440033, 0.12);
    neb.fillEllipse(700, 80, 260, 120);

    // Starfield (seeded)
    const stars = this.add.graphics().setDepth(0);
    const rng = new Phaser.Math.RandomDataGenerator(['starseed-starsurge']);
    for (let i = 0; i < 200; i++) {
      const x = rng.between(0, GAME_WIDTH);
      const y = rng.between(0, GAME_HEIGHT);
      const r = rng.frac() < 0.12 ? 1.5 : 0.8;
      const a = rng.realInRange(0.35, 1.0);
      stars.fillStyle(0xffffff, a);
      stars.fillCircle(x, y, r);
    }

    // Drifting asteroid debris
    const astRng = new Phaser.Math.RandomDataGenerator(['asteroid-belt-v1']);
    const astKeys = ['ast-sm', 'ast-sm', 'ast-sm', 'ast-md', 'ast-md', 'ast-lg'];
    for (let i = 0; i < 18; i++) {
      const key   = astKeys[astRng.between(0, astKeys.length - 1)];
      const x     = astRng.between(-60, GAME_WIDTH  + 60);
      const y     = astRng.between(-60, GAME_HEIGHT + 60);
      const alpha = astRng.realInRange(0.28, 0.52);
      const rot   = astRng.realInRange(0, Math.PI * 2);
      const obj   = this.add.image(x, y, key)
        .setDepth(0)
        .setAlpha(alpha)
        .setRotation(rot);

      const speed   = astRng.realInRange(6, 26);
      const angle   = astRng.realInRange(0, Math.PI * 2);
      const rotRate = astRng.realInRange(-0.0018, 0.0018);
      this.asteroids.push({ obj, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed, rotRate });
    }
  }

  // ─── Texture generation ───────────────────────────────────────────────────

  private generateTextures(): void {
    // Bullet 16×8
    {
      const g = this.make.graphics({ x: 0, y: 0, add: false });
      g.fillStyle(0xffdd00, 1);
      g.fillEllipse(8, 4, 16, 8);
      g.fillStyle(0xff8800, 1);
      g.fillEllipse(8, 4, 9, 5);
      g.generateTexture('bullet', 16, 8);
      g.destroy();
    }
    // Particle 8×8
    {
      const g = this.make.graphics({ x: 0, y: 0, add: false });
      g.fillStyle(0xffffff, 1);
      g.fillCircle(4, 4, 4);
      g.generateTexture('particle', 8, 8);
      g.destroy();
    }
    // Drone 32×32
    {
      const g = this.make.graphics({ x: 0, y: 0, add: false });
      g.fillStyle(0x00ddff, 1);
      g.fillCircle(16, 16, 13);
      g.lineStyle(2, 0x0099bb, 1);
      g.strokeCircle(16, 16, 13);
      g.fillStyle(0x0099bb, 1);
      g.fillRect(1, 13, 5, 6);
      g.fillRect(26, 13, 5, 6);
      g.fillStyle(0x001a2e, 1);
      g.fillCircle(16, 16, 5);
      g.fillStyle(0xff1100, 1);
      g.fillCircle(16, 16, 2.5);
      g.generateTexture('drone', 32, 32);
      g.destroy();
    }
    // Tanker 56×36
    {
      const g = this.make.graphics({ x: 0, y: 0, add: false });
      g.fillStyle(0x4422aa, 1);
      g.fillRoundedRect(2, 4, 52, 28, 4);
      g.fillStyle(0x6644cc, 1);
      g.fillRoundedRect(2, 4, 18, 28, 4);
      g.lineStyle(1, 0x8866ee, 0.5);
      g.lineBetween(20, 4, 54, 4);
      g.lineBetween(20, 32, 54, 32);
      g.lineBetween(38, 4, 38, 32);
      g.fillStyle(0xff2200, 1);
      g.fillRect(20, 14, 26, 8);
      g.fillStyle(0xff6655, 0.55);
      g.fillRect(20, 14, 26, 4);
      g.fillStyle(0xaaaacc, 1);
      for (const [rx, ry] of [[6, 8], [6, 28], [48, 8], [48, 28]] as [number, number][]) {
        g.fillCircle(rx, ry, 2);
      }
      g.generateTexture('tanker', 56, 36);
      g.destroy();
    }
    // Zigzagger 34×34
    {
      const g = this.make.graphics({ x: 0, y: 0, add: false });
      const [cx, cy, r] = [17, 17, 15];
      g.fillStyle(0xff44aa, 1);
      g.fillTriangle(cx, cy - r,  cx + r, cy,  cx - r, cy);
      g.fillTriangle(cx, cy + r,  cx + r, cy,  cx - r, cy);
      const r2 = Math.round(r * 0.55);
      g.fillStyle(0xff88dd, 0.7);
      g.fillTriangle(cx, cy - r2,  cx + r2, cy,  cx - r2, cy);
      g.fillTriangle(cx, cy + r2,  cx + r2, cy,  cx - r2, cy);
      g.lineStyle(1.5, 0xcc0077, 1);
      g.beginPath();
      g.moveTo(cx, cy - r);
      g.lineTo(cx + r, cy);
      g.lineTo(cx, cy + r);
      g.lineTo(cx - r, cy);
      g.closePath();
      g.strokePath();
      g.fillStyle(0xffffff, 1);
      g.fillCircle(cx, cy, 3);
      g.generateTexture('zigzagger', 34, 34);
      g.destroy();
    }
    // Power-up: rapid fire 28×28
    {
      const g = this.make.graphics({ x: 0, y: 0, add: false });
      g.fillStyle(0x00ff88, 1);
      g.fillCircle(14, 14, 13);
      g.fillStyle(0x00cc66, 1);
      g.fillCircle(14, 14, 10);
      g.fillStyle(0xffffff, 1);
      g.fillTriangle(18, 4, 12, 15, 17, 15);
      g.fillTriangle(9, 24, 16, 13, 11, 13);
      g.generateTexture('powerup-rapid', 28, 28);
      g.destroy();
    }
    // Power-up: shield 28×28
    {
      const g = this.make.graphics({ x: 0, y: 0, add: false });
      g.fillStyle(0x4488ff, 1);
      g.fillCircle(14, 14, 13);
      g.fillStyle(0x2255cc, 1);
      g.fillCircle(14, 14, 10);
      g.fillStyle(0xaaddff, 1);
      g.fillRoundedRect(9, 5, 10, 12, 2);
      g.fillTriangle(14, 21, 9, 15, 19, 15);
      g.generateTexture('powerup-shield', 28, 28);
      g.destroy();
    }
    // Power-up: bomb 28×28
    {
      const g = this.make.graphics({ x: 0, y: 0, add: false });
      g.fillStyle(0xff4400, 1);
      g.fillCircle(14, 14, 13);
      g.fillStyle(0xcc2200, 1);
      g.fillCircle(14, 14, 10);
      g.fillStyle(0xffcc00, 1);
      for (let i = 0; i < 4; i++) {
        const a = i * (Math.PI / 2);
        g.fillTriangle(
          14, 14,
          14 + Math.cos(a) * 9, 14 + Math.sin(a) * 9,
          14 + Math.cos(a + 0.45) * 6, 14 + Math.sin(a + 0.45) * 6,
        );
        g.fillTriangle(
          14, 14,
          14 + Math.cos(a) * 9, 14 + Math.sin(a) * 9,
          14 + Math.cos(a - 0.45) * 6, 14 + Math.sin(a - 0.45) * 6,
        );
      }
      g.fillStyle(0xffffff, 0.9);
      g.fillCircle(14, 14, 3.5);
      g.generateTexture('powerup-bomb', 28, 28);
      g.destroy();
    }
  }

  // ─── HUD ──────────────────────────────────────────────────────────────────

  private createHUD(): void {
    const s = (size: string, color = '#ffffff'): Phaser.Types.GameObjects.Text.TextStyle => ({
      fontFamily: 'Orbitron',
      fontSize: size,
      color,
      stroke: '#000000',
      strokeThickness: 3,
    });

    this.scoreText     = this.add.text(20, 16, 'SCORE  0', s('22px', '#00ffcc')).setDepth(10);
    this.highScoreText = this.add.text(20, 46, `BEST  ${this.highScore}`, s('16px', '#ffaa00')).setDepth(10);
    this.levelText     = this.add.text(GAME_WIDTH - 20, 16, 'LV 1', s('22px', '#ff88ff'))
      .setOrigin(1, 0).setDepth(10);
    this.comboText = this.add.text(GAME_WIDTH / 2, 70, '', s('30px', '#ffff44'))
      .setOrigin(0.5, 0).setAlpha(0).setDepth(10);
    this.powerupText = this.add.text(GAME_WIDTH / 2, GAME_HEIGHT - 36, '', s('19px', '#88ffaa'))
      .setOrigin(0.5, 1).setAlpha(0).setDepth(10);
  }

  // ─── Spawning ─────────────────────────────────────────────────────────────

  private startSpawning(): void {
    const interval = Math.max(400, 1500 - (this.difficultyLevel - 1) * 120);
    this.spawnTimer = this.time.addEvent({
      delay: interval,
      loop: true,
      callback: this.spawnNextEnemy,
      callbackScope: this,
    });
  }

  private spawnNextEnemy(): void {
    if (this.gameOver) return;
    const roll = Phaser.Math.Between(0, 99);
    let type: EnemyType;
    if (this.difficultyLevel < 3) {
      type = 'drone';
    } else if (this.difficultyLevel < 5) {
      type = roll < 70 ? 'drone' : roll < 90 ? 'zigzagger' : 'tanker';
    } else {
      type = roll < 45 ? 'drone' : roll < 78 ? 'zigzagger' : 'tanker';
    }
    this.spawnEnemy(type);
  }

  private spawnEnemy(type: EnemyType): void {
    const pad  = 44;
    const edge = Phaser.Math.Between(0, 3);
    let x = 0, y = 0;
    switch (edge) {
      case 0: x = Phaser.Math.Between(0, GAME_WIDTH); y = -pad;            break;
      case 1: x = GAME_WIDTH + pad;                   y = Phaser.Math.Between(0, GAME_HEIGHT); break;
      case 2: x = Phaser.Math.Between(0, GAME_WIDTH); y = GAME_HEIGHT + pad; break;
      default: x = -pad;                              y = Phaser.Math.Between(0, GAME_HEIGHT); break;
    }
    const enemy = this.enemies.create(x, y, type) as Phaser.Physics.Arcade.Image;
    enemy.setDepth(2);
    enemy.setData('type', type);
    enemy.setData('hp', BASE_HP[type]);
    enemy.setData('points', BASE_POINTS[type]);
    enemy.setData('zt', 0);   // zigzag timer
    enemy.setData('zd', 1);   // zigzag direction
  }

  private rampDifficulty(): void {
    if (this.gameOver) return;
    this.difficultyLevel++;
    this.levelText.setText(`LV ${this.difficultyLevel}`);
    this.tweens.add({
      targets: this.levelText,
      scaleX: 1.5, scaleY: 1.5,
      duration: 180,
      yoyo: true,
      ease: 'Power2',
    });
    // Restart timer with shorter interval
    this.spawnTimer.destroy();
    this.startSpawning();
  }

  // ─── Shooting ─────────────────────────────────────────────────────────────

  private fireBullet(): void {
    if (!this.canFire || !this.playerAlive || this.gameOver) return;

    const angle = this.player.rotation;
    const tip   = 24;
    const bx    = this.player.x + Math.cos(angle) * tip;
    const by    = this.player.y + Math.sin(angle) * tip;

    const bullet = this.bullets.create(bx, by, 'bullet') as Phaser.Physics.Arcade.Image;
    bullet.setDepth(2);
    bullet.setRotation(angle);
    (bullet.body as Phaser.Physics.Arcade.Body).setVelocity(
      Math.cos(angle) * BULLET_SPEED,
      Math.sin(angle) * BULLET_SPEED,
    );

    // Shoot SFX
    this.sound.play('shoot', { volume: 0.35 });

    // Muzzle flash — Graphics must be positioned at (bx,by) so the tween
    // scales it around the flash centre rather than the canvas corner.
    const flash = this.add.graphics({ x: bx, y: by }).setDepth(4);
    flash.fillStyle(0xffff88, 0.9);
    flash.fillCircle(0, 0, 7);
    this.tweens.add({
      targets: flash,
      alpha: 0,
      scaleX: 2, scaleY: 2,
      duration: 80,
      onComplete: () => flash.destroy(),
    });

    this.canFire = false;
    this.time.delayedCall(this.fireRate, () => { this.canFire = true; });
  }

  // ─── Collisions ───────────────────────────────────────────────────────────

  private onBulletHitEnemy(
    bullet: Phaser.Physics.Arcade.Image,
    enemy:  Phaser.Physics.Arcade.Image,
  ): void {
    if (!bullet.active || !enemy.active) return;
    bullet.destroy();

    const hp = (enemy.getData('hp') as number) - 1;
    enemy.setData('hp', hp);

    this.tweens.add({
      targets: enemy,
      alpha: 0.15,
      duration: 55,
      yoyo: true,
    });

    if (hp <= 0) {
      this.killEnemy(enemy);
    } else {
      // Enemy survived — play armour-hit sound
      this.sound.play('hit', { volume: 0.5 });
    }
  }

  private killEnemy(enemy: Phaser.Physics.Arcade.Image): void {
    if (!enemy.active) return;

    const points = enemy.getData('points') as number;
    const type   = enemy.getData('type')   as EnemyType;

    const now = this.time.now;
    this.combo = (now - this.lastKillTime < COMBO_WINDOW) ? this.combo + 1 : 1;
    this.lastKillTime = now;

    const multiplier = this.combo >= 3 ? Math.floor(this.combo / 3) + 1 : 1;
    const earned     = points * multiplier;
    this.score      += earned;
    this.scoreText.setText(`SCORE  ${this.score}`);

    this.showFloatingText(enemy.x, enemy.y, `+${earned}`, '#ffff44');
    this.explodeAt(enemy.x, enemy.y, type);

    if (Math.random() < POWERUP_CHANCE) this.spawnPowerup(enemy.x, enemy.y);
    enemy.destroy();

    if (this.combo >= 3) this.showComboUI();
  }

  private onPlayerHitEnemy(enemy: Phaser.Physics.Arcade.Image): void {
    if (!this.playerAlive || this.isInvincible || this.gameOver) return;
    if (enemy.active) enemy.destroy();
    this.triggerGameOver();
  }

  // ─── Power-ups ────────────────────────────────────────────────────────────

  private spawnPowerup(x: number, y: number): void {
    const roll = Math.random();
    const type: PowerUpType = roll < 0.50 ? 'rapid' : roll < 0.80 ? 'shield' : 'bomb';
    const pu = this.powerups.create(x, y, `powerup-${type}`) as Phaser.Physics.Arcade.Image;
    pu.setDepth(1);
    pu.setData('type', type);
    const body = pu.body as Phaser.Physics.Arcade.Body;
    body.setVelocity(Phaser.Math.Between(-35, 35), Phaser.Math.Between(-35, 35));
    this.time.delayedCall(8000, () => { if (pu.active) pu.destroy(); });
  }

  private onPickupPowerup(pu: Phaser.Physics.Arcade.Image): void {
    if (!pu.active || !this.playerAlive) return;
    const type = pu.getData('type') as PowerUpType;
    pu.destroy();
    this.sound.play(`pickup-${type}`, { volume: 0.6 });
    if (type === 'rapid')  this.activateRapidFire();
    if (type === 'shield') this.activateShield();
    if (type === 'bomb')   this.activateBomb();
  }

  private activateRapidFire(): void {
    this.fireRate = FIRE_RATE_RAPID;
    this.rapidFireTimer?.destroy();
    this.rapidFireTimer = this.time.delayedCall(RAPID_FIRE_DURATION, () => {
      this.fireRate = FIRE_RATE_NORMAL;
      this.rapidFireTimer = null;
      this.hidePowerupText();
    });
    this.showPowerupText('RAPID FIRE!', '#44ff88');
  }

  private activateShield(): void {
    this.isInvincible = true;
    if (this.shieldRing) this.shieldRing.destroy();
    this.shieldRing = this.add.arc(
      this.player.x, this.player.y, 32, 0, 360, false, 0x4488ff, 0.18,
    );
    this.shieldRing.setDepth(3);
    this.shieldRing.setStrokeStyle(3, 0x88ddff, 0.9);

    this.shieldTimer?.destroy();
    this.shieldTimer = this.time.delayedCall(SHIELD_DURATION, () => {
      this.isInvincible = false;
      if (this.shieldRing) {
        this.tweens.add({
          targets: this.shieldRing, alpha: 0, duration: 300,
          onComplete: () => { this.shieldRing?.destroy(); this.shieldRing = null; },
        });
      }
      this.shieldTimer = null;
      this.hidePowerupText();
    });
    this.showPowerupText('SHIELD ACTIVE!', '#44aaff');
  }

  private activateBomb(): void {
    let bonus = 0;
    const all = this.enemies.getChildren().slice() as Phaser.Physics.Arcade.Image[];
    for (const e of all) {
      bonus += e.getData('points') as number;
      this.explodeAt(e.x, e.y, e.getData('type') as EnemyType);
      e.destroy();
    }
    this.score += bonus;
    this.scoreText.setText(`SCORE  ${this.score}`);

    // Full-screen white flash
    const flash = this.add.rectangle(
      GAME_WIDTH / 2, GAME_HEIGHT / 2, GAME_WIDTH, GAME_HEIGHT, 0xffffff, 0.65,
    ).setDepth(100);
    this.tweens.add({
      targets: flash, alpha: 0, duration: 380,
      onComplete: () => flash.destroy(),
    });

    this.showPowerupText('BOMB!', '#ff8800');
    this.time.delayedCall(1400, () => this.hidePowerupText());
  }

  // ─── Effects ──────────────────────────────────────────────────────────────

  private explodeAt(x: number, y: number, type: EnemyType): void {
    // Explosion SFX — tanker gets a louder hit
    this.sound.play('explosion', { volume: type === 'tanker' ? 0.7 : 0.45 });

    const count  = type === 'tanker' ? 16 : 9;
    const maxSpd = type === 'tanker' ? 220 : 150;
    const emitter = this.add.particles(x, y, 'particle', {
      speed:    { min: 40, max: maxSpd },
      lifespan: { min: 180, max: 520 },
      scale:    { start: type === 'tanker' ? 1.1 : 0.8, end: 0 },
      tint:     ENEMY_COLORS[type],
      emitting: false,
    }).setDepth(4);
    emitter.explode(count);
    this.time.delayedCall(700, () => { emitter.destroy(); });
  }

  private showFloatingText(x: number, y: number, msg: string, color: string): void {
    const t = this.add.text(x, y, msg, {
      fontFamily: 'Orbitron',
      fontSize: '18px',
      color,
      stroke: '#000000',
      strokeThickness: 2,
    }).setOrigin(0.5).setDepth(10);
    this.tweens.add({
      targets: t,
      y: y - 55,
      alpha: 0,
      duration: 820,
      ease: 'Power1',
      onComplete: () => t.destroy(),
    });
  }

  private showComboUI(): void {
    this.comboText.setText(`x${this.combo} COMBO!`);
    this.comboText.setAlpha(1).setScale(1);
    this.tweens.add({
      targets: this.comboText,
      scaleX: 1.22, scaleY: 1.22,
      duration: 140,
      yoyo: true,
      ease: 'Power2',
    });
    this.tweens.add({
      targets: this.comboText,
      alpha: 0,
      delay: 900,
      duration: 300,
    });
  }

  private showPowerupText(msg: string, color: string): void {
    this.powerupTextTimer?.destroy();
    this.powerupText.setText(msg).setColor(color).setAlpha(1).setScale(1);
    this.tweens.add({
      targets: this.powerupText,
      scaleX: 1.15, scaleY: 1.15,
      duration: 120,
      yoyo: true,
    });
  }

  private hidePowerupText(): void {
    this.tweens.add({ targets: this.powerupText, alpha: 0, duration: 250 });
  }

  // ─── Persistence ──────────────────────────────────────────────────────────

  private async loadHighScore(): Promise<void> {
    try {
      const umicat = await umicatReady;
      if (!umicat) return;
      const val = await umicat.saves.get<number>('highScore');
      this.highScore = val ?? 0;
      this.highScoreText.setText(`BEST  ${this.highScore}`);
    } catch (e) {
      console.warn('[star-siege] load high score failed:', e);
    }
  }

  private async saveHighScore(): Promise<void> {
    try {
      const umicat = await umicatReady;
      if (!umicat) return;
      await umicat.saves.set('highScore', this.highScore);
    } catch (e) {
      console.warn('[star-siege] save high score failed:', e);
    }
  }

  // ─── Game Over ────────────────────────────────────────────────────────────

  private triggerGameOver(): void {
    if (this.gameOver) return;
    this.gameOver    = true;
    this.playerAlive = false;

    this.spawnTimer?.destroy();
    this.cameras.main.shake(360, 0.018);

    // Explode player
    this.explodeAt(this.player.x, this.player.y, 'tanker');

    // Freeze enemies
    (this.enemies.getChildren() as Phaser.Physics.Arcade.Image[]).forEach(e => {
      (e.body as Phaser.Physics.Arcade.Body).setVelocity(0, 0);
    });

    this.tweens.add({ targets: this.player, alpha: 0, duration: 380 });
    if (this.shieldRing) { this.shieldRing.destroy(); this.shieldRing = null; }

    if (this.score > this.highScore) {
      this.highScore = this.score;
      this.saveHighScore();
    }

    // Submit to global leaderboard (fire-and-forget, won't block game over UI)
    submitScore(this.score);

    this.time.delayedCall(650, () => this.showGameOverScreen());
  }

  private showGameOverScreen(): void {
    const cx = GAME_WIDTH / 2;
    const cy = GAME_HEIGHT / 2;

    // Dark overlay
    const overlay = this.add.rectangle(
      cx, cy, GAME_WIDTH, GAME_HEIGHT, 0x000000, 0.75,
    ).setDepth(1000).setAlpha(0);
    this.tweens.add({ targets: overlay, alpha: 1, duration: 380 });

    // Expanded panel (taller to fit leaderboard)
    const PW = 520, PH = 508;
    const panel = this.add.graphics().setDepth(1001);
    panel.fillStyle(0x060618, 0.97);
    panel.lineStyle(2, 0x00ccff, 0.85);
    panel.fillRoundedRect(cx - PW / 2, cy - PH / 2, PW, PH, 14);
    panel.strokeRoundedRect(cx - PW / 2, cy - PH / 2, PW, PH, 14);
    panel.setAlpha(0);
    this.tweens.add({ targets: panel, alpha: 1, delay: 220, duration: 300 });

    // GAME OVER title
    const title = this.add.text(cx, cy - 220, 'GAME OVER', {
      fontFamily: 'Orbitron', fontSize: '42px', color: '#ff4444',
      stroke: '#660000', strokeThickness: 5,
    }).setOrigin(0.5).setDepth(1002).setAlpha(0);
    this.tweens.add({ targets: title, alpha: 1, delay: 320, duration: 280 });

    // Score
    const scoreTxt = this.add.text(cx, cy - 152, `SCORE  ${this.score}`, {
      fontFamily: 'Orbitron', fontSize: '30px', color: '#00ffcc',
      stroke: '#000', strokeThickness: 3,
    }).setOrigin(0.5).setDepth(1002).setAlpha(0);
    this.tweens.add({ targets: scoreTxt, alpha: 1, scaleX: 1.08, scaleY: 1.08, duration: 200,
      delay: 420, yoyo: true, repeat: 0 });

    // Best
    const bestTxt = this.add.text(cx, cy - 105, `BEST SCORE  ${this.highScore}`, {
      fontFamily: 'Orbitron', fontSize: '18px', color: '#ffaa00',
      stroke: '#000', strokeThickness: 2,
    }).setOrigin(0.5).setDepth(1002).setAlpha(0);
    this.tweens.add({ targets: bestTxt, alpha: 1, delay: 480, duration: 280 });

    // New best badge
    if (this.score >= this.highScore && this.score > 0) {
      const nb = this.add.text(cx, cy - 75, '★  NEW BEST  ★', {
        fontFamily: 'Orbitron', fontSize: '15px', color: '#ffff00',
        stroke: '#000', strokeThickness: 2,
      }).setOrigin(0.5).setDepth(1002).setAlpha(0);
      this.tweens.add({ targets: nb, alpha: 1, delay: 560, duration: 280 });
    }

    // Leaderboard divider + heading
    const divGfx = this.add.graphics().setDepth(1002).setAlpha(0);
    divGfx.lineStyle(1, 0x00ccff, 0.35);
    divGfx.lineBetween(cx - 220, cy - 52, cx + 220, cy - 52);
    this.tweens.add({ targets: divGfx, alpha: 1, delay: 580, duration: 200 });

    const lbHead = this.add.text(cx, cy - 36, 'TOP SCORES', {
      fontFamily: 'Orbitron', fontSize: '14px', color: '#00ccff',
      stroke: '#000', strokeThickness: 2,
    }).setOrigin(0.5).setDepth(1002).setAlpha(0);
    this.tweens.add({ targets: lbHead, alpha: 1, delay: 580, duration: 280 });

    // Leaderboard rows (populated async)
    const rankColors = ['#ffd700', '#c0c0c0', '#cd7f32', '#aabbcc', '#8899aa'];
    const rowObjs: Array<{ rank: Phaser.GameObjects.Text; name: Phaser.GameObjects.Text }> = [];
    for (let i = 0; i < 5; i++) {
      const ry = cy - 14 + i * 34;
      const rankTxt = this.add.text(cx - 218, ry, `${i + 1}`, {
        fontFamily: 'Orbitron', fontSize: '12px', color: rankColors[i],
        stroke: '#000', strokeThickness: 1,
      }).setOrigin(0, 0.5).setDepth(1002).setAlpha(0);

      const nameTxt = this.add.text(cx - 192, ry, '—', {
        fontFamily: 'Orbitron', fontSize: '13px', color: '#334455',
      }).setOrigin(0, 0.5).setDepth(1002).setAlpha(0);
      rowObjs.push({ rank: rankTxt, name: nameTxt });
    }

    // Fetch leaderboard and fill rows, then fade everything in
    fetchLeaderboard(5).then((entries: LeaderboardEntry[]) => {
      if (!this.scene.isActive('GameScene')) return;
      entries.forEach((e, i) => {
        if (i >= rowObjs.length) return;
        const color = rankColors[i] ?? '#8899aa';
        const nameStr = e.name.slice(0, 15).padEnd(15, ' ');
        rowObjs[i].name.setText(`${nameStr}  ${e.score}`);
        rowObjs[i].name.setStyle({ fontFamily: 'Orbitron', fontSize: '13px', color });
      });
      rowObjs.forEach(r => {
        this.tweens.add({ targets: r.rank, alpha: 1, duration: 250 });
        this.tweens.add({ targets: r.name, alpha: 1, duration: 250 });
      });
    });

    // PLAY AGAIN button
    const btnY = cy + 192;
    const btnBg = this.add.graphics().setDepth(1002).setAlpha(0);
    const drawBtn = (col: number) => {
      btnBg.clear();
      btnBg.fillStyle(col, 1);
      btnBg.fillRoundedRect(cx - 108, btnY - 26, 216, 52, 10);
      btnBg.lineStyle(2, 0x00eeff, 1);
      btnBg.strokeRoundedRect(cx - 108, btnY - 26, 216, 52, 10);
    };
    drawBtn(0x00aacc);
    this.tweens.add({ targets: btnBg, alpha: 1, delay: 640, duration: 280 });

    const btnTxt = this.add.text(cx, btnY, 'PLAY AGAIN', {
      fontFamily: 'Orbitron', fontSize: '21px', color: '#ffffff',
      stroke: '#002233', strokeThickness: 2,
    }).setOrigin(0.5).setDepth(1003).setAlpha(0).setInteractive({ useHandCursor: true });
    this.tweens.add({ targets: btnTxt, alpha: 1, delay: 640, duration: 280 });

    btnTxt.on('pointerover',  () => drawBtn(0x00ccee));
    btnTxt.on('pointerout',   () => drawBtn(0x00aacc));
    btnTxt.on('pointerdown',  () => {
      this.scene.start('GameScene', { sceneId: this.sceneId });
    });
  }

  // ─── Update ───────────────────────────────────────────────────────────────

  update(_time: number, delta: number): void {
    // ── Background asteroid drift (always runs) ───────────────────────────
    const dt = delta / 1000;
    const M  = 80;
    for (const ast of this.asteroids) {
      ast.obj.x        += ast.vx  * dt;
      ast.obj.y        += ast.vy  * dt;
      ast.obj.rotation += ast.rotRate * delta;
      if (ast.obj.x < -M)              ast.obj.x = GAME_WIDTH  + M;
      if (ast.obj.x > GAME_WIDTH  + M) ast.obj.x = -M;
      if (ast.obj.y < -M)              ast.obj.y = GAME_HEIGHT + M;
      if (ast.obj.y > GAME_HEIGHT + M) ast.obj.y = -M;
    }

    if (!this.ready || this.gameOver || !this.playerAlive) return;

    // ── Player movement ──────────────────────────────────────────────────
    const left  = this.cursors.left.isDown  || this.wasd.left.isDown;
    const right = this.cursors.right.isDown || this.wasd.right.isDown;
    const up    = this.cursors.up.isDown    || this.wasd.up.isDown;
    const down  = this.cursors.down.isDown  || this.wasd.down.isDown;

    let vx = 0, vy = 0;
    if (left)  vx -= PLAYER_SPEED;
    if (right) vx += PLAYER_SPEED;
    if (up)    vy -= PLAYER_SPEED;
    if (down)  vy += PLAYER_SPEED;

    // Normalise diagonal movement
    if (vx !== 0 && vy !== 0) {
      vx *= 0.7071;
      vy *= 0.7071;
    }

    (this.player.body as Phaser.Physics.Arcade.Body).setVelocity(vx, vy);

    // ── Rotation: always face mouse ──────────────────────────────────────
    const ptr   = this.input.activePointer;
    const angle = Math.atan2(ptr.y - this.player.y, ptr.x - this.player.x);
    this.player.setRotation(angle);

    // ── Auto-fire continuously toward mouse ──────────────────────────────
    this.fireBullet();

    // ── Engine trail (emits when moving) ─────────────────────────────────
    if (vx !== 0 || vy !== 0) {
      const r = angle;
      // Two engine positions in local space: (-20, ±9)
      for (const [lx, ly] of [[-20, -9], [-20, 9]] as [number, number][]) {
        const wx = this.player.x + Math.cos(r) * lx - Math.sin(r) * ly;
        const wy = this.player.y + Math.sin(r) * lx + Math.cos(r) * ly;
        this.engineTrail.setPosition(wx, wy);
        this.engineTrail.explode(1);
      }
    }

    // ── Despawn out-of-bounds bullets ─────────────────────────────────────
    const margin = 70;
    (this.bullets.getChildren() as Phaser.Physics.Arcade.Image[]).forEach(b => {
      if (b.x < -margin || b.x > GAME_WIDTH + margin ||
          b.y < -margin || b.y > GAME_HEIGHT + margin) {
        b.destroy();
      }
    });

    // ── Enemy movement ───────────────────────────────────────────────────
    (this.enemies.getChildren() as Phaser.Physics.Arcade.Image[]).forEach(e => {
      const type  = e.getData('type')  as EnemyType;
      const dx    = this.player.x - e.x;
      const dy    = this.player.y - e.y;
      const dist  = Math.sqrt(dx * dx + dy * dy) || 1;
      const nx    = dx / dist;
      const ny    = dy / dist;
      const speed = BASE_SPEEDS[type] + (this.difficultyLevel - 1) * 12;
      const ebody = e.body as Phaser.Physics.Arcade.Body;

      if (type === 'zigzagger') {
        let zt = (e.getData('zt') as number) + delta;
        let zd = e.getData('zd') as number;
        if (zt > 380) { zt = 0; zd = -zd; e.setData('zd', zd); }
        e.setData('zt', zt);
        ebody.setVelocity(nx * speed + (-ny * zd * speed * 0.55),
                          ny * speed + ( nx * zd * speed * 0.55));
      } else {
        ebody.setVelocity(nx * speed, ny * speed);
      }

      e.setRotation(Math.atan2(dy, dx));
    });

    // ── Shield ring follows player ────────────────────────────────────────
    if (this.shieldRing) {
      this.shieldRing.setPosition(this.player.x, this.player.y);
    }
  }
}
