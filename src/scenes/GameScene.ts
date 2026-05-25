import Phaser from 'phaser';
import { GAME_WIDTH, GAME_HEIGHT } from '../config';

// ── Constants ────────────────────────────────────────────────────────────────
const PLAYER_SPEED    = 300;
const BULLET_SPEED    = 680;
const SHOOT_COOLDOWN  = 210;   // ms between shots
const SPAWN_START     = 1500;  // ms between enemy spawns at start
const SPAWN_MIN       = 420;   // minimum spawn interval
const INVINCIBLE_MS   = 2200;  // ms of invincibility after hit

type EnemyType = 'scout' | 'fighter' | 'cruiser';

const ECFG: Record<EnemyType, { spd: number; hp: number; pts: number; tex: string }> = {
  scout:   { spd: 145, hp: 1, pts: 10, tex: 'e_scout'   },
  fighter: { spd: 88,  hp: 2, pts: 25, tex: 'e_fighter' },
  cruiser: { spd: 50,  hp: 4, pts: 60, tex: 'e_cruiser' },
};

// ── Scene ────────────────────────────────────────────────────────────────────
export class GameScene extends Phaser.Scene {
  // Player
  private player!: Phaser.Physics.Arcade.Sprite;
  private facingAngle = -Math.PI / 2; // default = up

  // Groups
  private bullets!: Phaser.Physics.Arcade.Group;
  private enemies!: Phaser.Physics.Arcade.Group;

  // Input
  private cursors!: Phaser.Types.Input.Keyboard.CursorKeys;
  private spaceKey!: Phaser.Input.Keyboard.Key;

  // State
  private score       = 0;
  private lives       = 3;
  private isGameOver  = false;
  private lastShot    = 0;
  private spawnTimer  = 0;
  private spawnInterval = SPAWN_START;
  private invincible  = false;
  private invincibleMs = 0;
  private isMoving    = false;

  // Particles
  private thruster!: Phaser.GameObjects.Particles.ParticleEmitter;
  private exploder!:  Phaser.GameObjects.Particles.ParticleEmitter;

  // HUD
  private scoreText!: Phaser.GameObjects.Text;
  private livesText!: Phaser.GameObjects.Text;

  // Game-over overlay
  private goOverlay!:  Phaser.GameObjects.Rectangle;
  private goTitle!:    Phaser.GameObjects.Text;
  private goScore!:    Phaser.GameObjects.Text;
  private goRestart!:  Phaser.GameObjects.Text;

  constructor() {
    super({ key: 'GameScene' });
  }

  // ══════════════════════════════════════════════════════════════════════════
  //  LIFECYCLE
  // ══════════════════════════════════════════════════════════════════════════
  create(): void {
    // Reset all state
    this.score         = 0;
    this.lives         = 3;
    this.isGameOver    = false;
    this.lastShot      = 0;
    this.spawnTimer    = 0;
    this.spawnInterval = SPAWN_START;
    this.invincible    = false;
    this.invincibleMs  = 0;
    this.facingAngle   = -Math.PI / 2;
    this.isMoving      = false;

    this.buildTextures();
    this.drawBackground();
    this.spawnPlayer();
    this.setupParticles();
    this.setupGroups();
    this.setupInput();
    this.setupCollisions();
    this.buildHUD();
    this.buildGameOverScreen();
  }

  update(time: number, delta: number): void {
    if (this.isGameOver) {
      if (Phaser.Input.Keyboard.JustDown(this.spaceKey)) {
        this.scene.restart();
      }
      return;
    }

    this.handleMovement();
    this.handleShooting(time);
    this.updateSpawn(delta);
    this.cleanOffscreen();
    this.tickInvincibility(delta);
  }

  // ══════════════════════════════════════════════════════════════════════════
  //  TEXTURE GENERATION  (generated once, cached in texture manager)
  // ══════════════════════════════════════════════════════════════════════════
  private buildTextures(): void {
    if (this.textures.exists('p_ship')) return; // already built

    // ── Player ship (48×48) — cyan tri, nose pointing UP ───────────────────
    const p = this.add.graphics();
    // Main hull
    p.fillStyle(0x00d4ff);
    p.fillTriangle(24, 2, 5, 46, 43, 46);
    // Engine block
    p.fillStyle(0x004d6e);
    p.fillRect(12, 38, 24, 10);
    // Cockpit
    p.fillStyle(0x88f8ff, 0.88);
    p.fillTriangle(24, 10, 17, 32, 31, 32);
    // Wings
    p.fillStyle(0x0055aa);
    p.fillTriangle(2, 48, 12, 30, 6, 48);
    p.fillTriangle(46, 48, 36, 30, 42, 48);
    // Engine exhausts
    p.fillStyle(0xff8c00);
    p.fillRect(16, 44, 5, 5);
    p.fillRect(27, 44, 5, 5);
    // Outline
    p.lineStyle(1.5, 0x55ddff, 0.8);
    p.strokeTriangle(24, 2, 5, 46, 43, 46);
    p.generateTexture('p_ship', 48, 48);
    p.destroy();

    // ── Scout enemy (32×32) — red tri, nose pointing UP ────────────────────
    const sc = this.add.graphics();
    sc.fillStyle(0xff1144);
    sc.fillTriangle(16, 1, 1, 31, 31, 31);
    sc.fillStyle(0xff5577, 0.72);
    sc.fillTriangle(16, 7, 7, 25, 25, 25);
    sc.fillStyle(0xff0022);
    sc.fillCircle(16, 20, 5);
    sc.fillStyle(0xffaabb, 0.9);
    sc.fillCircle(16, 20, 2.5);
    sc.lineStyle(1, 0xff4466, 0.55);
    sc.strokeTriangle(16, 1, 1, 31, 31, 31);
    sc.generateTexture('e_scout', 32, 32);
    sc.destroy();

    // ── Fighter enemy (44×44) — orange diamond, narrow end UP ──────────────
    const fi = this.add.graphics();
    fi.fillStyle(0xff6600);
    fi.fillTriangle(22, 1, 1, 22, 22, 43);
    fi.fillTriangle(22, 1, 43, 22, 22, 43);
    fi.fillStyle(0xffaa44, 0.72);
    fi.fillTriangle(22, 8, 9, 22, 22, 36);
    fi.fillTriangle(22, 8, 35, 22, 22, 36);
    fi.fillStyle(0xff3300);
    fi.fillCircle(22, 22, 7);
    fi.fillStyle(0xffa060, 0.9);
    fi.fillCircle(22, 22, 4);
    fi.fillStyle(0xffffff, 0.75);
    fi.fillCircle(22, 22, 2);
    fi.lineStyle(1.5, 0xff8844, 0.55);
    fi.strokeTriangle(22, 1, 1, 22, 22, 43);
    fi.strokeTriangle(22, 1, 43, 22, 22, 43);
    fi.generateTexture('e_fighter', 44, 44);
    fi.destroy();

    // ── Cruiser enemy (60×60) — purple hexagon ─────────────────────────────
    const cr = this.add.graphics();
    const hexPts = (cx: number, cy: number, r: number) => {
      const pts: { x: number; y: number }[] = [];
      for (let i = 0; i < 6; i++) {
        const a = (Math.PI / 3) * i - Math.PI / 6;
        pts.push({ x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) });
      }
      return pts;
    };
    cr.fillStyle(0x7700cc);
    cr.fillPoints(hexPts(30, 30, 27), true);
    cr.fillStyle(0xaa33ff, 0.72);
    cr.fillPoints(hexPts(30, 30, 17), true);
    cr.fillStyle(0xcc00ff);
    cr.fillCircle(30, 30, 9);
    cr.fillStyle(0xffffff, 0.85);
    cr.fillCircle(30, 30, 4);
    cr.lineStyle(1.5, 0xcc66ff, 0.45);
    cr.strokePoints(hexPts(30, 30, 27), true);
    for (let i = 0; i < 6; i++) {
      const a = (Math.PI / 3) * i - Math.PI / 6;
      cr.lineBetween(30, 30, 30 + 27 * Math.cos(a), 30 + 27 * Math.sin(a));
    }
    cr.generateTexture('e_cruiser', 60, 60);
    cr.destroy();

    // ── Bullet (4×14) — yellow bolt, pointing UP ───────────────────────────
    const bu = this.add.graphics();
    bu.fillStyle(0xffff55);
    bu.fillRect(0, 0, 4, 14);
    bu.fillStyle(0xffffff, 0.9);
    bu.fillRect(1, 0, 2, 6);
    bu.generateTexture('bullet', 4, 14);
    bu.destroy();

    // ── Glow particle (8×8) ────────────────────────────────────────────────
    const gl = this.add.graphics();
    gl.fillStyle(0xffffff);
    gl.fillCircle(4, 4, 4);
    gl.generateTexture('glow', 8, 8);
    gl.destroy();
  }

  // ══════════════════════════════════════════════════════════════════════════
  //  BACKGROUND
  // ══════════════════════════════════════════════════════════════════════════
  private drawBackground(): void {
    // Deep space gradient
    const bg = this.add.graphics().setDepth(0);
    bg.fillGradientStyle(0x000008, 0x00000d, 0x000018, 0x00000d, 1);
    bg.fillRect(0, 0, GAME_WIDTH, GAME_HEIGHT);

    // Faint nebula wisps
    const neb = this.add.graphics().setDepth(0);
    const nebCols = [0x110044, 0x001133, 0x220033, 0x001122, 0x002211];
    for (let i = 0; i < 5; i++) {
      neb.fillStyle(nebCols[i], 0.2);
      neb.fillEllipse(
        Phaser.Math.Between(80, GAME_WIDTH - 80),
        Phaser.Math.Between(80, GAME_HEIGHT - 80),
        160 + Math.random() * 210,
        65  + Math.random() * 100,
      );
    }

    // Stars
    const stars = this.add.graphics().setDepth(0);
    for (let i = 0; i < 170; i++) {
      const a   = 0.25 + Math.random() * 0.75;
      const big = Math.random() < 0.07;
      const v   = Math.floor(180 + Math.random() * 75);
      const col = Math.random() < 0.3 ? 0xaaaaff : ((v << 16) | (v << 8) | v);
      stars.fillStyle(col, a);
      stars.fillRect(
        Phaser.Math.Between(0, GAME_WIDTH),
        Phaser.Math.Between(0, GAME_HEIGHT),
        big ? 2 : 1,
        big ? 2 : 1,
      );
    }
  }

  // ══════════════════════════════════════════════════════════════════════════
  //  PLAYER
  // ══════════════════════════════════════════════════════════════════════════
  private spawnPlayer(): void {
    this.player = this.physics.add.sprite(GAME_WIDTH / 2, GAME_HEIGHT / 2, 'p_ship');
    this.player.setDepth(3).setCollideWorldBounds(true);
    const body = this.player.body as Phaser.Physics.Arcade.Body;
    body.setSize(30, 30);
    body.setOffset(9, 9);
    // Start with a pop-in tween
    this.player.setScale(0);
    this.tweens.add({ targets: this.player, scale: 1, duration: 350, ease: 'Back.Out' });
  }

  // ══════════════════════════════════════════════════════════════════════════
  //  PARTICLES
  // ══════════════════════════════════════════════════════════════════════════
  private setupParticles(): void {
    this.thruster = this.add.particles(0, 0, 'glow', {
      speed:    { min: 55, max: 130 },
      scale:    { start: 0.5, end: 0 },
      alpha:    { start: 0.85, end: 0 },
      lifespan: 260,
      quantity: 0,
      tint:     [0xff6600, 0xff9900, 0xff3300],
      emitting: false,
    }).setDepth(2);

    this.exploder = this.add.particles(0, 0, 'glow', {
      speed:    { min: 80, max: 260 },
      scale:    { start: 0.9, end: 0 },
      alpha:    { start: 1, end: 0 },
      lifespan: 520,
      quantity: 0,
      tint:     [0xff6600, 0xffaa00, 0xff2200, 0xffffff, 0xffff00],
      emitting: false,
    }).setDepth(5);
  }

  // ══════════════════════════════════════════════════════════════════════════
  //  GROUPS
  // ══════════════════════════════════════════════════════════════════════════
  private setupGroups(): void {
    this.bullets = this.physics.add.group({ runChildUpdate: false });
    this.enemies = this.physics.add.group({ runChildUpdate: false });
  }

  // ══════════════════════════════════════════════════════════════════════════
  //  INPUT
  // ══════════════════════════════════════════════════════════════════════════
  private setupInput(): void {
    this.cursors  = this.input.keyboard!.createCursorKeys();
    this.spaceKey = this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.SPACE);
  }

  // ══════════════════════════════════════════════════════════════════════════
  //  COLLISIONS
  // ══════════════════════════════════════════════════════════════════════════
  private setupCollisions(): void {
    this.physics.add.overlap(
      this.bullets,
      this.enemies,
      this.onBulletHit as Phaser.Types.Physics.Arcade.ArcadePhysicsCallback,
      undefined,
      this,
    );
    this.physics.add.overlap(
      this.player,
      this.enemies,
      this.onPlayerHit as Phaser.Types.Physics.Arcade.ArcadePhysicsCallback,
      undefined,
      this,
    );
  }

  // ══════════════════════════════════════════════════════════════════════════
  //  HUD
  // ══════════════════════════════════════════════════════════════════════════
  private buildHUD(): void {
    this.scoreText = this.add.text(20, 16, 'SCORE  0', {
      fontSize:        '22px',
      fontStyle:       'bold',
      color:           '#00e5ff',
      stroke:          '#002233',
      strokeThickness: 3,
    }).setDepth(10).setScrollFactor(0);

    this.livesText = this.add.text(GAME_WIDTH - 20, 16, '♥ ♥ ♥', {
      fontSize:        '22px',
      color:           '#ff4466',
      stroke:          '#440011',
      strokeThickness: 3,
    }).setOrigin(1, 0).setDepth(10).setScrollFactor(0);
  }

  private refreshHUD(): void {
    this.scoreText.setText(`SCORE  ${this.score}`);
    const hearts = Array(Math.max(0, this.lives)).fill('♥').join(' ');
    this.livesText.setText(hearts);
  }

  // ══════════════════════════════════════════════════════════════════════════
  //  GAME-OVER SCREEN
  // ══════════════════════════════════════════════════════════════════════════
  private buildGameOverScreen(): void {
    this.goOverlay = this.add
      .rectangle(GAME_WIDTH / 2, GAME_HEIGHT / 2, GAME_WIDTH, GAME_HEIGHT, 0x000000, 0.72)
      .setDepth(998).setVisible(false);

    this.goTitle = this.add
      .text(GAME_WIDTH / 2, GAME_HEIGHT / 2 - 90, 'GAME OVER', {
        fontSize: '72px', fontStyle: 'bold', color: '#ff2244',
        stroke: '#880011', strokeThickness: 6,
      })
      .setOrigin(0.5).setDepth(999).setVisible(false);

    this.goScore = this.add
      .text(GAME_WIDTH / 2, GAME_HEIGHT / 2 - 5, 'Score: 0', {
        fontSize: '36px', color: '#ffffff',
      })
      .setOrigin(0.5).setDepth(999).setVisible(false);

    this.goRestart = this.add
      .text(GAME_WIDTH / 2, GAME_HEIGHT / 2 + 72, '[ PRESS SPACE TO RESTART ]', {
        fontSize: '24px', color: '#00e5ff',
      })
      .setOrigin(0.5).setDepth(999).setVisible(false);

  }

  private triggerGameOver(): void {
    this.isGameOver = true;
    this.exploder.explode(22, this.player.x, this.player.y);
    this.player.setVisible(false);
    (this.player.body as Phaser.Physics.Arcade.Body).setVelocity(0, 0);

    this.goScore.setText(`Score: ${this.score}`);
    this.goOverlay.setVisible(true);
    this.goTitle.setVisible(true).setAlpha(0).setY(GAME_HEIGHT / 2 - 130);
    this.goScore.setVisible(true).setAlpha(0);
    this.goRestart.setVisible(true).setAlpha(0);

    this.tweens.add({
      targets: this.goTitle,
      y: GAME_HEIGHT / 2 - 90,
      alpha: 1,
      duration: 400,
      ease: 'Quad.Out',
    });
    this.tweens.add({
      targets: [this.goScore, this.goRestart],
      alpha: 1,
      duration: 500,
      delay: 300,
      onComplete: () => {
        // Start blink after fade-in
        this.tweens.add({
          targets: this.goRestart,
          alpha: { from: 1, to: 0.2 },
          duration: 650,
          yoyo: true,
          repeat: -1,
        });
      },
    });
  }

  // ══════════════════════════════════════════════════════════════════════════
  //  SHOOTING
  // ══════════════════════════════════════════════════════════════════════════
  private tryShoot(time: number): void {
    if (time - this.lastShot < SHOOT_COOLDOWN) return;
    this.lastShot = time;

    // Spawn bullet offset ahead of the ship nose
    const nx = this.player.x + Math.cos(this.facingAngle) * 26;
    const ny = this.player.y + Math.sin(this.facingAngle) * 26;

    const bullet = this.physics.add.image(nx, ny, 'bullet') as Phaser.Physics.Arcade.Image;
    bullet.setDepth(3).setRotation(this.facingAngle + Math.PI / 2);
    (bullet.body as Phaser.Physics.Arcade.Body).setVelocity(
      Math.cos(this.facingAngle) * BULLET_SPEED,
      Math.sin(this.facingAngle) * BULLET_SPEED,
    );
    this.bullets.add(bullet);

    // Muzzle flash
    this.exploder.explode(4, nx, ny);
  }

  // ══════════════════════════════════════════════════════════════════════════
  //  ENEMY SPAWNING
  // ══════════════════════════════════════════════════════════════════════════
  private spawnEnemy(): void {
    // Difficulty-weighted random type
    let type: EnemyType;
    const r = Math.random();
    if (this.score < 100) {
      type = 'scout';
    } else if (this.score < 300) {
      type = r < 0.65 ? 'scout' : 'fighter';
    } else {
      type = r < 0.45 ? 'scout' : r < 0.78 ? 'fighter' : 'cruiser';
    }

    const cfg = ECFG[type];
    const side = Math.floor(Math.random() * 4); // 0=top 1=right 2=bottom 3=left
    const pad  = 40;
    let sx = 0, sy = 0;
    switch (side) {
      case 0: sx = Phaser.Math.Between(pad, GAME_WIDTH - pad); sy = -pad;             break;
      case 1: sx = GAME_WIDTH + pad;  sy = Phaser.Math.Between(pad, GAME_HEIGHT - pad); break;
      case 2: sx = Phaser.Math.Between(pad, GAME_WIDTH - pad); sy = GAME_HEIGHT + pad; break;
      case 3: sx = -pad;              sy = Phaser.Math.Between(pad, GAME_HEIGHT - pad); break;
    }

    const enemy = this.physics.add.sprite(sx, sy, cfg.tex) as Phaser.Physics.Arcade.Sprite;
    enemy.setDepth(2);
    enemy.setData('type', type);
    enemy.setData('hp', cfg.hp);

    // Rotate toward player (all textures nose-up, so +π/2)
    const angle = Phaser.Math.Angle.Between(sx, sy, this.player.x, this.player.y);
    enemy.setRotation(angle + Math.PI / 2);

    // Velocity straight toward player position at spawn
    (enemy.body as Phaser.Physics.Arcade.Body).setVelocity(
      Math.cos(angle) * cfg.spd,
      Math.sin(angle) * cfg.spd,
    );

    // Hitbox
    const hitSizes: Record<EnemyType, [number, number, number, number]> = {
      scout:   [22, 22, 5, 5],
      fighter: [28, 28, 8, 8],
      cruiser: [36, 36, 12, 12],
    };
    const [hw, hh, hox, hoy] = hitSizes[type];
    (enemy.body as Phaser.Physics.Arcade.Body).setSize(hw, hh);
    (enemy.body as Phaser.Physics.Arcade.Body).setOffset(hox, hoy);

    this.enemies.add(enemy);
  }

  // ══════════════════════════════════════════════════════════════════════════
  //  COLLISION CALLBACKS
  // ══════════════════════════════════════════════════════════════════════════
  private onBulletHit(
    bulletObj: Phaser.GameObjects.GameObject,
    enemyObj:  Phaser.GameObjects.GameObject,
  ): void {
    const bullet = bulletObj as Phaser.Physics.Arcade.Image;
    const enemy  = enemyObj  as Phaser.Physics.Arcade.Sprite;

    bullet.destroy();

    const hp   = (enemy.getData('hp') as number) - 1;
    const type = enemy.getData('type') as EnemyType;

    if (hp <= 0) {
      // Kill enemy — capture position before destroy
      const ex  = enemy.x;
      const ey  = enemy.y;
      const pts = ECFG[type].pts;
      this.score += pts;
      this.refreshHUD();

      const count = type === 'cruiser' ? 18 : type === 'fighter' ? 12 : 8;
      this.exploder.explode(count, ex, ey);
      enemy.destroy();

      // Floating score popup
      const popup = this.add.text(ex, ey - 8, `+${pts}`, {
        fontSize: '18px', fontStyle: 'bold',
        color: '#ffff00', stroke: '#554400', strokeThickness: 2,
      }).setOrigin(0.5).setDepth(6);
      this.tweens.add({
        targets: popup,
        y: ey - 55,
        alpha: 0,
        duration: 700,
        ease: 'Quad.Out',
        onComplete: () => popup.destroy(),
      });

      // Difficulty ramp
      this.spawnInterval = Math.max(
        SPAWN_MIN,
        SPAWN_START - Math.floor(this.score / 40) * 55,
      );
    } else {
      enemy.setData('hp', hp);
      // Hit flash
      this.tweens.add({ targets: enemy, alpha: 0.25, duration: 70, yoyo: true });
    }
  }

  private onPlayerHit(
    _playerObj: Phaser.GameObjects.GameObject,
    enemyObj:   Phaser.GameObjects.GameObject,
  ): void {
    if (this.invincible) return;

    const enemy = enemyObj as Phaser.Physics.Arcade.Sprite;
    this.exploder.explode(8, enemy.x, enemy.y);
    enemy.destroy();

    this.lives -= 1;
    this.refreshHUD();

    if (this.lives <= 0) {
      this.triggerGameOver();
      return;
    }

    // Brief invincibility + flash
    this.invincible   = true;
    this.invincibleMs = INVINCIBLE_MS;
    this.tweens.add({
      targets:  this.player,
      alpha:    { from: 0.25, to: 1 },
      duration: 160,
      repeat:   10,
      yoyo:     true,
      onComplete: () => this.player.setAlpha(1),
    });
  }

  // ══════════════════════════════════════════════════════════════════════════
  //  UPDATE HELPERS
  // ══════════════════════════════════════════════════════════════════════════
  private handleMovement(): void {
    const body = this.player.body as Phaser.Physics.Arcade.Body;
    let vx = 0, vy = 0;
    this.isMoving = false;

    if      (this.cursors.left.isDown)  { vx = -PLAYER_SPEED; this.facingAngle = Math.PI;       this.isMoving = true; }
    else if (this.cursors.right.isDown) { vx =  PLAYER_SPEED; this.facingAngle = 0;             this.isMoving = true; }

    if      (this.cursors.up.isDown)    { vy = -PLAYER_SPEED; this.facingAngle = -Math.PI / 2;  this.isMoving = true; }
    else if (this.cursors.down.isDown)  { vy =  PLAYER_SPEED; this.facingAngle =  Math.PI / 2;  this.isMoving = true; }

    // Diagonal: normalise + face diagonal
    if (vx !== 0 && vy !== 0) {
      const n = 1 / Math.SQRT2;
      vx *= n; vy *= n;
      this.facingAngle = Math.atan2(vy, vx);
    }

    body.setVelocity(vx, vy);

    // Rotate ship visually to face direction (texture nose points UP at rot=0)
    this.player.setRotation(this.facingAngle + Math.PI / 2);

    // Engine thrust trail
    if (this.isMoving) {
      const backAngle = this.facingAngle + Math.PI;
      this.thruster.explode(
        2,
        this.player.x + Math.cos(backAngle) * 18,
        this.player.y + Math.sin(backAngle) * 18,
      );
    }
  }

  private handleShooting(time: number): void {
    if (this.spaceKey.isDown) {
      this.tryShoot(time);
    }
  }

  private updateSpawn(delta: number): void {
    this.spawnTimer += delta;
    if (this.spawnTimer >= this.spawnInterval) {
      this.spawnTimer = 0;
      this.spawnEnemy();
    }
  }

  private cleanOffscreen(): void {
    const margin = 150;
    for (const child of this.bullets.getChildren()) {
      const b = child as Phaser.Physics.Arcade.Image;
      if (
        b.x < -margin || b.x > GAME_WIDTH + margin ||
        b.y < -margin || b.y > GAME_HEIGHT + margin
      ) {
        b.destroy();
      }
    }

    for (const child of this.enemies.getChildren()) {
      const e = child as Phaser.Physics.Arcade.Sprite;
      if (
        e.x < -200 || e.x > GAME_WIDTH + 200 ||
        e.y < -200 || e.y > GAME_HEIGHT + 200
      ) {
        e.destroy();
      }
    }
  }

  private tickInvincibility(delta: number): void {
    if (!this.invincible) return;
    this.invincibleMs -= delta;
    if (this.invincibleMs <= 0) {
      this.invincible = false;
      this.player.setAlpha(1);
    }
  }
}
