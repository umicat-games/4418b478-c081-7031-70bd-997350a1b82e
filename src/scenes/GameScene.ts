import Phaser from 'phaser';
import { loadWorldScene } from '@umicat/phaser-sdk';
import { GAME_WIDTH, GAME_HEIGHT } from '../config';

const CX = GAME_WIDTH / 2;
const CY = GAME_HEIGHT / 2;

// ── Tuning constants ──────────────────────────────────────────────────────────
const PLAYER_SPEED      = 220;
const BULLET_SPEED      = 540;
const FIRE_RATE         = 210;   // ms between 4-way volleys
const SPAWN_RATE_BASE   = 1100;  // ms between enemy spawns (decreases per wave)
const SPAWN_RATE_MIN    = 320;
const ENEMIES_PER_WAVE  = 12;    // killed to advance wave (+4 per wave)
const ENEMY_SPEED_BASE  = 88;
const ENEMY_SPEED_INC   = 14;    // speed added per wave
const INVINCIBLE_MS     = 1600;  // invincibility after hit

interface StarDot { x: number; y: number; r: number; a: number; }

export class GameScene extends Phaser.Scene {
  private sceneId!: string;

  // Game objects
  private player!: Phaser.Physics.Arcade.Sprite;
  private playerGlow!: Phaser.GameObjects.Graphics;
  private bullets!: Phaser.Physics.Arcade.Group;
  private enemies!: Phaser.Physics.Arcade.Group;
  private explosionEmitter!: Phaser.GameObjects.Particles.ParticleEmitter;

  // Input
  private cursors!: Phaser.Types.Input.Keyboard.CursorKeys;
  private wasd!: Record<'up' | 'down' | 'left' | 'right', Phaser.Input.Keyboard.Key>;

  // Game state
  private score       = 0;
  private lives       = 3;
  private wave        = 1;
  private killed      = 0;
  private isGameOver  = false;
  private isInvincible = false;
  private invTimer    = 0;
  private lastFired   = 0;
  private lastSpawned = 0;

  // HUD
  private scoreText!: Phaser.GameObjects.Text;
  private livesText!: Phaser.GameObjects.Text;
  private waveLabel!: Phaser.GameObjects.Text;

  // Background
  private stars: StarDot[] = [];
  private starGfx!: Phaser.GameObjects.Graphics;

  constructor() { super({ key: 'GameScene' }); }

  init(data: { sceneId: string }): void { this.sceneId = data.sceneId; }

  async create(): Promise<void> {
    await loadWorldScene(this, this.sceneId);

    // Reset on restart
    this.score = 0; this.lives = 3; this.wave = 1; this.killed = 0;
    this.isGameOver = false; this.isInvincible = false; this.invTimer = 0;
    this.lastFired = 0; this.lastSpawned = 0; this.stars = [];

    this.buildBackground();
    this.makeTextures();
    this.createPlayer();
    this.createBullets();
    this.createEnemies();
    this.createExplosionEmitter();
    this.createInput();
    this.buildHUD();
    this.setupColliders();
  }

  // ── BACKGROUND ───────────────────────────────────────────────────────────────
  private buildBackground(): void {
    // Deep space gradient
    const bg = this.add.graphics().setDepth(0);
    bg.fillGradientStyle(0x04040f, 0x04040f, 0x0b0b25, 0x0b0b25, 1);
    bg.fillRect(0, 0, GAME_WIDTH, GAME_HEIGHT);

    // Nebula blobs
    const neb = this.add.graphics().setDepth(0);
    neb.fillStyle(0x2200bb, 0.07); neb.fillEllipse(280, 190, 520, 320);
    neb.fillStyle(0xcc0055, 0.05); neb.fillEllipse(930, 530, 580, 360);
    neb.fillStyle(0x005577, 0.07); neb.fillEllipse(1100, 140, 400, 260);
    neb.fillStyle(0x004400, 0.05); neb.fillEllipse(600, 600, 350, 220);

    // Stars
    this.starGfx = this.add.graphics().setDepth(0);
    for (let i = 0; i < 210; i++) {
      this.stars.push({
        x: Phaser.Math.Between(0, GAME_WIDTH),
        y: Phaser.Math.Between(0, GAME_HEIGHT),
        r: Phaser.Math.FloatBetween(0.4, 2.3),
        a: Phaser.Math.FloatBetween(0.2, 1.0),
      });
    }
    this.drawStars();
  }

  private drawStars(): void {
    this.starGfx.clear();
    for (const s of this.stars) {
      this.starGfx.fillStyle(0xddeeff, s.a);
      this.starGfx.fillCircle(s.x, s.y, s.r);
    }
    // A few bright blue-white stars
    for (let i = 0; i < 12; i++) {
      const s = this.stars[i * 17 % this.stars.length];
      if (!s) continue;
      this.starGfx.fillStyle(0xaaccff, 0.9);
      this.starGfx.fillCircle(s.x, s.y, s.r + 0.8);
    }
  }

  // ── TEXTURES ─────────────────────────────────────────────────────────────────
  private makeTextures(): void {
    // Energy bolt (bullet)
    if (!this.textures.exists('bolt')) {
      const g = this.make.graphics();
      g.fillStyle(0xaaffff, 0.5); g.fillRect(0, 1, 8, 14);
      g.fillStyle(0x00eeff, 1);   g.fillRect(1, 0, 6, 16);
      g.fillStyle(0xffffff, 1);   g.fillRect(3, 2, 2, 12);
      g.generateTexture('bolt', 8, 16);
      g.destroy();
    }

    // 4 enemy types (one per spawn side, distinct colours)
    // e_top uses the pixel-art sprite loaded in BootScene — skip generating it
    const enemies = [
      { key: 'e_bottom', c: 0xff8800, hi: 0xffcc44, accent: 0xffaa22 },
      { key: 'e_left',   c: 0x9933ff, hi: 0xcc99ff, accent: 0xbb66ff },
      { key: 'e_right',  c: 0x22ffaa, hi: 0x88ffdd, accent: 0x55ffcc },
    ];
    for (const e of enemies) {
      if (!this.textures.exists(e.key)) {
        const g = this.make.graphics();
        // Outer body
        g.fillStyle(e.c, 1); g.fillCircle(22, 22, 19);
        // Rings
        g.fillStyle(0x111133, 0.6); g.fillCircle(22, 22, 15);
        g.fillStyle(e.hi, 0.5);    g.fillCircle(22, 22, 13);
        // Core
        g.fillStyle(0x080820, 1);  g.fillCircle(22, 22, 8);
        g.fillStyle(e.accent, 1);  g.fillCircle(22, 22, 4);
        g.fillStyle(0xffffff, 0.7); g.fillCircle(20, 20, 2);
        // 4 spikes
        g.fillStyle(e.c, 1);
        g.fillTriangle(22, 0,  16, 11, 28, 11);
        g.fillTriangle(22, 44, 16, 33, 28, 33);
        g.fillTriangle(0,  22, 11, 16, 11, 28);
        g.fillTriangle(44, 22, 33, 16, 33, 28);
        g.generateTexture(e.key, 44, 44);
        g.destroy();
      }
    }

    // Particle spark
    if (!this.textures.exists('spark')) {
      const g = this.make.graphics();
      g.fillStyle(0xffffff, 1); g.fillCircle(4, 4, 4);
      g.generateTexture('spark', 8, 8);
      g.destroy();
    }
  }

  // ── PLAYER ───────────────────────────────────────────────────────────────────
  private createPlayer(): void {
    // Glow under ship
    this.playerGlow = this.add.graphics().setDepth(2);

    this.player = this.physics.add.sprite(CX, CY, 'player_ship_tilt').setDepth(3);
    this.player.setCollideWorldBounds(true);
    // Shrink physics body to match ship silhouette
    this.player.body.setSize(32, 40);
    this.player.body.setOffset(16, 12);
    this.player.setFrame(7); // start straight
  }

  private drawPlayerGlow(): void {
    this.playerGlow.clear();
    this.playerGlow.fillStyle(0xff3300, 0.18);
    this.playerGlow.fillCircle(this.player.x, this.player.y, 38);
    this.playerGlow.fillStyle(0xff6600, 0.10);
    this.playerGlow.fillCircle(this.player.x, this.player.y, 56);
  }

  // ── BULLETS ──────────────────────────────────────────────────────────────────
  private createBullets(): void {
    this.bullets = this.physics.add.group({ defaultKey: 'bolt', maxSize: 80 });
  }

  private fireBullet(vx: number, vy: number, angleDeg: number): void {
    const b = this.bullets.get(
      this.player.x, this.player.y, 'bolt',
    ) as Phaser.Physics.Arcade.Sprite | null;
    if (!b) return;
    b.setActive(true).setVisible(true).setDepth(3).setAngle(angleDeg);
    b.setPosition(this.player.x, this.player.y);
    const body = b.body as Phaser.Physics.Arcade.Body;
    body.reset(this.player.x, this.player.y);
    body.setVelocity(vx, vy);
  }

  // ── ENEMIES ──────────────────────────────────────────────────────────────────
  private createEnemies(): void {
    this.enemies = this.physics.add.group();
  }

  private spawnEnemy(side: 'top' | 'bottom' | 'left' | 'right'): void {
    const texKey: Record<string, string> = {
      top: 'space_craft_enemy_1', bottom: 'e_bottom', left: 'e_left', right: 'e_right',
    };
    const pad = 44;
    let ex = 0, ey = 0;
    switch (side) {
      case 'top':    ex = Phaser.Math.Between(pad, GAME_WIDTH - pad);  ey = -pad; break;
      case 'bottom': ex = Phaser.Math.Between(pad, GAME_WIDTH - pad);  ey = GAME_HEIGHT + pad; break;
      case 'left':   ex = -pad; ey = Phaser.Math.Between(pad, GAME_HEIGHT - pad); break;
      case 'right':  ex = GAME_WIDTH + pad; ey = Phaser.Math.Between(pad, GAME_HEIGHT - pad); break;
    }
    const enemy = this.enemies.create(ex, ey, texKey[side]) as Phaser.Physics.Arcade.Sprite;
    enemy.setDepth(2);
    this.aimEnemyAtPlayer(enemy);
  }

  private aimEnemyAtPlayer(enemy: Phaser.Physics.Arcade.Sprite): void {
    const speed = ENEMY_SPEED_BASE + (this.wave - 1) * ENEMY_SPEED_INC;
    const angle = Phaser.Math.Angle.Between(enemy.x, enemy.y, this.player.x, this.player.y);
    (enemy.body as Phaser.Physics.Arcade.Body).setVelocity(
      Math.cos(angle) * speed,
      Math.sin(angle) * speed,
    );
    enemy.setRotation(angle + Math.PI / 2);
  }

  // ── PARTICLES ─────────────────────────────────────────────────────────────────
  private createExplosionEmitter(): void {
    this.explosionEmitter = this.add.particles(0, 0, 'spark', {
      lifespan: 600,
      speed: { min: 60, max: 280 },
      scale: { start: 1.2, end: 0 },
      alpha: { start: 1, end: 0 },
      tint: [0xff8800, 0xff3300, 0xffee00, 0xffffff, 0x88ffff],
      blendMode: 'ADD',
      emitting: false,
    }).setDepth(5);
  }

  // ── INPUT ────────────────────────────────────────────────────────────────────
  private createInput(): void {
    this.cursors = this.input.keyboard!.createCursorKeys();
    this.wasd = {
      up:    this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.W),
      down:  this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.S),
      left:  this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.A),
      right: this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.D),
    };
  }

  // ── HUD ──────────────────────────────────────────────────────────────────────
  private buildHUD(): void {
    const mono = { fontFamily: 'monospace', fontSize: '20px', color: '#aaeeff' };

    // Background pill for score
    const scoreBg = this.add.graphics().setDepth(9);
    scoreBg.fillStyle(0x000022, 0.6);
    scoreBg.fillRoundedRect(12, 10, 200, 30, 6);

    this.scoreText = this.add.text(20, 17, 'SCORE: 0', mono).setDepth(10);
    this.livesText = this.add.text(20, 48, '♥ ♥ ♥', {
      ...mono, color: '#ff6677', fontSize: '22px',
    }).setDepth(10);
    this.waveLabel = this.add.text(GAME_WIDTH - 20, 17, 'WAVE 1', {
      ...mono, color: '#ffdd88',
    }).setOrigin(1, 0).setDepth(10);

    // Soft crosshair grid lines
    const grid = this.add.graphics().setDepth(1);
    grid.lineStyle(1, 0x3366bb, 0.18);
    grid.lineBetween(CX, 0, CX, GAME_HEIGHT);
    grid.lineBetween(0, CY, GAME_WIDTH, CY);

    // Corner decorations
    const corner = this.add.graphics().setDepth(1);
    corner.lineStyle(2, 0x224466, 0.5);
    // Top-left
    corner.strokeRect(16, 8, GAME_WIDTH - 32, GAME_HEIGHT - 16);
  }

  // ── COLLISIONS ───────────────────────────────────────────────────────────────
  private setupColliders(): void {
    this.physics.add.overlap(this.bullets, this.enemies, (blt, enm) => {
      this.onBulletHit(
        blt as Phaser.Physics.Arcade.Sprite,
        enm as Phaser.Physics.Arcade.Sprite,
      );
    });
    this.physics.add.overlap(this.player, this.enemies, (_p, enm) => {
      if (!this.isInvincible && !this.isGameOver) {
        this.onPlayerHit(enm as Phaser.Physics.Arcade.Sprite);
      }
    });
  }

  // ── UPDATE LOOP ───────────────────────────────────────────────────────────────
  update(time: number, delta: number): void {
    if (this.isGameOver) return;

    this.handleMovement();
    this.handleAutoFire(time);
    this.handleEnemySpawn(time);
    this.trackEnemies();
    this.tickInvincibility(delta);
    this.cullOffscreen();
    this.drawPlayerGlow();
  }

  private handleMovement(): void {
    let vx = 0, vy = 0;
    if (this.cursors.left.isDown  || this.wasd.left.isDown)  vx = -PLAYER_SPEED;
    if (this.cursors.right.isDown || this.wasd.right.isDown) vx =  PLAYER_SPEED;
    if (this.cursors.up.isDown    || this.wasd.up.isDown)    vy = -PLAYER_SPEED;
    if (this.cursors.down.isDown  || this.wasd.down.isDown)  vy =  PLAYER_SPEED;
    if (vx !== 0 && vy !== 0) { vx *= 0.707; vy *= 0.707; }
    this.player.setVelocity(vx, vy);

    // Directional tilt: pick frame based on horizontal movement
    if (vx < 0) {
      this.player.setFrame(2);  // banking left
    } else if (vx > 0) {
      this.player.setFrame(13); // banking right
    } else {
      this.player.setFrame(7);  // straight
    }
  }

  private handleAutoFire(time: number): void {
    if (time - this.lastFired < FIRE_RATE) return;
    this.lastFired = time;
    this.fireBullet(0,            -BULLET_SPEED, -90);
    this.fireBullet(0,             BULLET_SPEED,  90);
    this.fireBullet(-BULLET_SPEED, 0,            180);
    this.fireBullet( BULLET_SPEED, 0,              0);
  }

  private handleEnemySpawn(time: number): void {
    const rate = Math.max(SPAWN_RATE_MIN, SPAWN_RATE_BASE - (this.wave - 1) * 75);
    if (time - this.lastSpawned < rate) return;
    this.lastSpawned = time;
    const sides = ['top', 'bottom', 'left', 'right'] as const;
    this.spawnEnemy(sides[Phaser.Math.Between(0, 3)]);
  }

  private trackEnemies(): void {
    this.enemies.getChildren().forEach((child) => {
      const e = child as Phaser.Physics.Arcade.Sprite;
      if (e.active) this.aimEnemyAtPlayer(e);
    });
  }

  private tickInvincibility(delta: number): void {
    if (!this.isInvincible) return;
    this.invTimer -= delta;
    if (this.invTimer <= 0) { this.isInvincible = false; this.player.setAlpha(1); }
  }

  private cullOffscreen(): void {
    const pad = 90;
    for (const child of this.bullets.getChildren()) {
      const b = child as Phaser.Physics.Arcade.Sprite;
      if (b.active && (b.x < -pad || b.x > GAME_WIDTH + pad || b.y < -pad || b.y > GAME_HEIGHT + pad)) {
        b.setActive(false).setVisible(false);
        (b.body as Phaser.Physics.Arcade.Body).setVelocity(0, 0);
      }
    }
    for (const child of this.enemies.getChildren()) {
      const e = child as Phaser.Physics.Arcade.Sprite;
      if (e.active && (e.x < -300 || e.x > GAME_WIDTH + 300 || e.y < -300 || e.y > GAME_HEIGHT + 300)) {
        e.destroy();
      }
    }
  }

  // ── HIT HANDLERS ─────────────────────────────────────────────────────────────
  private onBulletHit(
    bullet: Phaser.Physics.Arcade.Sprite,
    enemy: Phaser.Physics.Arcade.Sprite,
  ): void {
    if (!bullet.active || !enemy.active) return;

    bullet.setActive(false).setVisible(false);
    (bullet.body as Phaser.Physics.Arcade.Body).setVelocity(0, 0);

    // Explosion burst
    this.explosionEmitter.setPosition(enemy.x, enemy.y);
    this.explosionEmitter.explode(16);

    // Pop tween before destroy
    this.tweens.add({
      targets: enemy,
      alpha: 0,
      scaleX: 1.6,
      scaleY: 1.6,
      duration: 130,
      ease: 'Cubic.Out',
      onComplete: () => { if (enemy.active) enemy.destroy(); },
    });

    // Score
    this.score += 10 * this.wave;
    this.scoreText.setText(`SCORE: ${this.score}`);
    this.tweens.add({ targets: this.scoreText, scaleX: 1.22, scaleY: 1.22, duration: 80, yoyo: true });

    // Wave progress
    this.killed++;
    const threshold = ENEMIES_PER_WAVE + (this.wave - 1) * 4;
    if (this.killed >= threshold) {
      this.killed = 0;
      this.wave++;
      this.waveLabel.setText(`WAVE ${this.wave}`);
      this.tweens.add({ targets: this.waveLabel, scaleX: 1.45, scaleY: 1.45, duration: 200, yoyo: true });
      this.showWaveBanner();
    }
  }

  private onPlayerHit(enemy: Phaser.Physics.Arcade.Sprite): void {
    this.isInvincible = true;
    this.invTimer = INVINCIBLE_MS;

    // Explosion at player
    this.explosionEmitter.setPosition(this.player.x, this.player.y);
    this.explosionEmitter.explode(22);

    if (enemy.active) enemy.destroy();
    this.lives--;
    this.refreshLivesText();

    // Red screen flash
    const flash = this.add.rectangle(CX, CY, GAME_WIDTH, GAME_HEIGHT, 0xff2200, 0.42).setDepth(900);
    this.tweens.add({ targets: flash, alpha: 0, duration: 380, onComplete: () => flash.destroy() });

    // Player blink
    this.tweens.add({
      targets: [this.player, this.playerGlow],
      alpha: 0.15,
      duration: 110,
      yoyo: true,
      repeat: 7,
    });

    if (this.lives <= 0) this.doGameOver();
  }

  private refreshLivesText(): void {
    const h = this.lives > 0 ? Array(Math.max(0, this.lives)).fill('♥').join(' ') : '—';
    this.livesText.setText(h);
  }

  private showWaveBanner(): void {
    const txt = this.add.text(CX, CY, `WAVE ${this.wave}`, {
      fontFamily: 'monospace', fontSize: '54px', color: '#ffee44',
      stroke: '#885500', strokeThickness: 4,
    }).setOrigin(0.5).setDepth(50).setAlpha(0);

    this.tweens.add({
      targets: txt,
      alpha: 1,
      y: CY - 50,
      duration: 350,
      ease: 'Cubic.Out',
      yoyo: true,
      hold: 700,
      onComplete: () => txt.destroy(),
    });
  }

  // ── GAME OVER ─────────────────────────────────────────────────────────────────
  private doGameOver(): void {
    this.isGameOver = true;
    this.tweens.killTweensOf(this.player);
    this.player.setVisible(false).setActive(false);
    this.playerGlow.setVisible(false);

    // Chain explosions
    for (let i = 0; i < 6; i++) {
      this.time.delayedCall(i * 140, () => {
        this.explosionEmitter.setPosition(
          CX + Phaser.Math.Between(-50, 50),
          CY + Phaser.Math.Between(-50, 50),
        );
        this.explosionEmitter.explode(22);
      });
    }
    this.time.delayedCall(1000, () => this.showGameOverScreen());
  }

  private showGameOverScreen(): void {
    // Dim overlay
    this.add.graphics().setDepth(950)
      .fillStyle(0x000011, 0.78)
      .fillRect(0, 0, GAME_WIDTH, GAME_HEIGHT);

    // Panel
    const panel = this.add.graphics().setDepth(960);
    panel.fillStyle(0x080820, 0.96);
    panel.fillRoundedRect(CX - 250, CY - 155, 500, 310, 30);
    panel.lineStyle(2, 0x4466ff, 1);
    panel.strokeRoundedRect(CX - 250, CY - 155, 500, 310, 30);
    panel.lineStyle(1, 0x334488, 0.6);
    panel.strokeRoundedRect(CX - 242, CY - 147, 484, 294, 26);

    this.add.text(CX, CY - 98, 'GAME OVER', {
      fontFamily: 'monospace', fontSize: '46px', color: '#ff3355',
      stroke: '#881122', strokeThickness: 4,
    }).setOrigin(0.5).setDepth(970);

    this.add.text(CX, CY - 28, `FINAL SCORE  ${this.score}`, {
      fontFamily: 'monospace', fontSize: '26px', color: '#aaeeff',
    }).setOrigin(0.5).setDepth(970);

    this.add.text(CX, CY + 22, `REACHED WAVE  ${this.wave}`, {
      fontFamily: 'monospace', fontSize: '20px', color: '#ffdd88',
    }).setOrigin(0.5).setDepth(970);

    const btn = this.add.text(CX, CY + 98, '[ PLAY AGAIN ]', {
      fontFamily: 'monospace', fontSize: '24px', color: '#44ffcc',
      backgroundColor: '#0d2e22',
      padding: { x: 20, y: 10 },
    }).setOrigin(0.5).setDepth(970).setInteractive({ useHandCursor: true });

    btn.on('pointerover', () => { btn.setColor('#ffffff'); btn.setBackgroundColor('#1a5544'); });
    btn.on('pointerout',  () => { btn.setColor('#44ffcc'); btn.setBackgroundColor('#0d2e22'); });
    btn.on('pointerdown', () => { this.scene.restart({ sceneId: this.sceneId }); });

    // Entrance animation for panel
    panel.setAlpha(0);
    btn.setAlpha(0);
    this.tweens.add({ targets: [panel, btn], alpha: 1, duration: 400, ease: 'Cubic.Out' });
  }
}
