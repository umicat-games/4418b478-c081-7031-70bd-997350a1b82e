import Phaser from 'phaser';
import { GAME_WIDTH, GAME_HEIGHT } from '../config';

// ─── Tuning constants ───────────────────────────────────────────────────────
const PLAYER_SPEED    = 230;
const BULLET_SPEED    = 560;
const EBULLET_SPEED   = 200;
const FIRE_COOLDOWN   = 220;   // ms between player shots
const ENEMY_ROWS      = 3;
const ENEMY_COLS      = 6;
const ENEMY_H_GAP     = 110;
const ENEMY_V_GAP     = 72;
const ENEMY_START_X   = 920;
const ENEMY_TOP_Y     = 110;
const FIRE_INTERVAL_BASE = 1200; // ms between enemy volleys

// ─── Types ──────────────────────────────────────────────────────────────────
interface Star { x: number; y: number; speed: number; size: number; alpha: number }
interface Beam { rect: Phaser.GameObjects.Rectangle; vx: number; vy: number; alive: boolean }
interface Enemy {
  row: number; col: number;
  baseX: number; baseY: number;
  sx: number; sy: number;  // computed screen pos each frame
  hp: number; scoreValue: number;
  alive: boolean;
}

// ─── Scene ──────────────────────────────────────────────────────────────────
export class GameScene extends Phaser.Scene {

  // State
  private score   = 0;
  private lives   = 3;
  private wave    = 1;
  private gameOver = false;
  private waveClearPending = false;
  private waveClearCountdown = 0;

  // Player
  private px = 120;
  private py = GAME_HEIGHT / 2;
  private playerAlive = true;
  private invincible  = false;
  private invTimer    = 0;
  private fireCd      = 0;

  // Graphics layers
  private bgGfx!:     Phaser.GameObjects.Graphics;
  private starGfx!:   Phaser.GameObjects.Graphics;
  private enemyGfx!:  Phaser.GameObjects.Graphics;
  private playerGfx!: Phaser.GameObjects.Graphics;
  private fxGfx!:     Phaser.GameObjects.Graphics;  // flashes & rings

  // Data
  private stars:   Star[]  = [];
  private enemies: Enemy[] = [];
  private pBeams:  Beam[]  = [];  // player bullets
  private eBeams:  Beam[]  = [];  // enemy bullets

  // Formation
  private fmX  = 0;   // horizontal drift applied to all enemies
  private fmT  = 0;   // time accumulator for sine wave

  // Enemy fire timer
  private eFireTimer = 0;

  // Input
  private cursors!: Phaser.Types.Input.Keyboard.CursorKeys;
  private wKey!: Phaser.Input.Keyboard.Key;
  private sKey!: Phaser.Input.Keyboard.Key;
  private spaceKey!: Phaser.Input.Keyboard.Key;

  // HUD
  private scoreTxt!: Phaser.GameObjects.Text;
  private livesTxt!: Phaser.GameObjects.Text;
  private waveTxt!:  Phaser.GameObjects.Text;

  constructor() { super({ key: 'GameScene' }); }

  init(_data?: object): void {
    this.score   = 0; this.lives = 3; this.wave = 1;
    this.gameOver = false; this.waveClearPending = false; this.waveClearCountdown = 0;
    this.px = 120; this.py = GAME_HEIGHT / 2;
    this.playerAlive = true; this.invincible = false; this.invTimer = 0; this.fireCd = 0;
    this.stars = []; this.enemies = []; this.pBeams = []; this.eBeams = [];
    this.fmX = 0; this.fmT = 0; this.eFireTimer = 0;
  }

  create(): void {
    // Generate a tiny white pixel texture for particles
    const pg = this.make.graphics({ x: 0, y: 0, add: false });
    pg.fillStyle(0xffffff, 1);
    pg.fillRect(0, 0, 4, 4);
    pg.generateTexture('px', 4, 4);
    pg.destroy();

    // Graphics layers (depth order)
    this.bgGfx     = this.add.graphics().setDepth(0);
    this.starGfx   = this.add.graphics().setDepth(1);
    this.enemyGfx  = this.add.graphics().setDepth(2);
    this.playerGfx = this.add.graphics().setDepth(3);
    this.fxGfx     = this.add.graphics().setDepth(6);

    // Draw static background gradient
    this.bgGfx.fillGradientStyle(0x00000a, 0x00000a, 0x0a0020, 0x0a0020, 1);
    this.bgGfx.fillRect(0, 0, GAME_WIDTH, GAME_HEIGHT);

    // Stars
    for (let i = 0; i < 130; i++) {
      this.stars.push({
        x:     Phaser.Math.Between(0, GAME_WIDTH),
        y:     Phaser.Math.Between(0, GAME_HEIGHT),
        speed: Phaser.Math.FloatBetween(0.25, 1.4),
        size:  Phaser.Math.Between(1, 2),
        alpha: Phaser.Math.FloatBetween(0.3, 1.0),
      });
    }

    // Input
    this.cursors  = this.input.keyboard!.createCursorKeys();
    this.wKey     = this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.W);
    this.sKey     = this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.S);
    this.spaceKey = this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.SPACE);

    // HUD
    this.livesTxt = this.add.text(20, 18, '♦ ♦ ♦', {
      fontFamily: 'monospace', fontSize: '22px', color: '#44aaff',
    }).setDepth(10);

    this.waveTxt = this.add.text(GAME_WIDTH / 2, 18, 'WAVE  1', {
      fontFamily: 'monospace', fontSize: '22px', color: '#ffee44',
    }).setOrigin(0.5, 0).setDepth(10);

    this.scoreTxt = this.add.text(GAME_WIDTH - 20, 18, 'SCORE  0', {
      fontFamily: 'monospace', fontSize: '22px', color: '#00ffcc',
    }).setOrigin(1, 0).setDepth(10);

    // Divider line below HUD
    const divider = this.add.graphics().setDepth(10);
    divider.lineStyle(1, 0x334466, 0.6);
    divider.lineBetween(0, 50, GAME_WIDTH, 50);

    // Spawn first wave
    this.spawnWave();
    this.showWaveBanner();
  }

  // ── Wave management ────────────────────────────────────────────────────────

  private spawnWave(): void {
    this.enemies = [];
    for (let row = 0; row < ENEMY_ROWS; row++) {
      for (let col = 0; col < ENEMY_COLS; col++) {
        this.enemies.push({
          row, col,
          baseX: ENEMY_START_X + col * ENEMY_H_GAP,
          baseY: ENEMY_TOP_Y  + row * ENEMY_V_GAP,
          sx: 0, sy: 0,
          hp: row === 0 ? 2 : 1,
          scoreValue: row === 0 ? 30 : row === 1 ? 20 : 10,
          alive: true,
        });
      }
    }
    this.fmX = 0;
  }

  private showWaveBanner(): void {
    const txt = this.add.text(GAME_WIDTH / 2, GAME_HEIGHT / 2, `— WAVE ${this.wave} —`, {
      fontFamily: 'monospace', fontSize: '46px', color: '#ffee44',
      stroke: '#664400', strokeThickness: 5,
    }).setOrigin(0.5).setDepth(100).setAlpha(0);

    this.tweens.add({ targets: txt, alpha: 1, duration: 280, onComplete: () => {
      this.time.delayedCall(800, () => {
        this.tweens.add({ targets: txt, alpha: 0, duration: 380, onComplete: () => txt.destroy() });
      });
    }});
  }

  // ── Drawing helpers ────────────────────────────────────────────────────────

  private drawStars(dt: number): void {
    const g = this.starGfx;
    g.clear();
    for (const s of this.stars) {
      s.x -= s.speed * (dt / 16);
      if (s.x < 0) { s.x = GAME_WIDTH; s.y = Phaser.Math.Between(0, GAME_HEIGHT); }
      g.fillStyle(0xffffff, s.alpha);
      g.fillRect(s.x, s.y, s.size, s.size);
    }
  }

  private drawPlayer(): void {
    const g = this.playerGfx;
    g.clear();
    if (!this.playerAlive) return;
    // Blink when invincible
    if (this.invincible && Math.floor(this.invTimer / 90) % 2 === 0) return;

    const x = this.px, y = this.py;

    // Engine exhaust glow
    g.fillStyle(0x0033aa, 0.45);
    g.fillEllipse(x - 24, y, 20, 12);

    // Engine nozzle
    g.fillStyle(0x002277);
    g.fillRect(x - 26, y - 6, 10, 12);

    // Engine flame (flicker)
    const fc = Math.random() > 0.5 ? 0xff9900 : 0xffdd00;
    g.fillStyle(fc, 0.95);
    g.fillTriangle(x - 26, y - 5, x - 26, y + 5, x - 42, y);

    // Hull - main fuselage
    g.fillStyle(0x1155bb);
    g.fillTriangle(x + 32, y, x - 20, y - 12, x - 20, y + 12);

    // Upper wing
    g.fillStyle(0x1e77ee);
    g.fillTriangle(x - 2, y - 8, x - 20, y - 12, x - 12, y - 28);

    // Lower wing
    g.fillStyle(0x1e77ee);
    g.fillTriangle(x - 2, y + 8, x - 20, y + 12, x - 12, y + 28);

    // Wing accent stripe
    g.fillStyle(0x44aaff, 0.7);
    g.fillRect(x - 18, y - 2, 26, 4);

    // Cockpit canopy
    g.fillStyle(0x77ddff);
    g.fillEllipse(x + 6, y, 20, 10);
    g.fillStyle(0xaaeeff, 0.5);
    g.fillEllipse(x + 8, y - 1, 10, 5);

    // Cannon tip
    g.fillStyle(0x88ccff);
    g.fillRect(x + 28, y - 2, 10, 4);
  }

  private drawEnemies(): void {
    const g = this.enemyGfx;
    g.clear();
    for (const e of this.enemies) {
      if (!e.alive) continue;
      // Sine wave vertical drift
      const sineOffset = Math.sin(this.fmT * 0.0018 + e.col * 0.55) * 22;
      e.sx = e.baseX + this.fmX;
      e.sy = e.baseY + sineOffset;

      if (e.row === 0) this.drawEnemyRed(g, e.sx, e.sy);
      else if (e.row === 1) this.drawEnemyPurple(g, e.sx, e.sy);
      else                  this.drawEnemyGreen(g, e.sx, e.sy);
    }
  }

  private drawEnemyRed(g: Phaser.GameObjects.Graphics, x: number, y: number): void {
    // Crab-like alien — red
    g.fillStyle(0xcc2222);
    g.fillRect(x - 18, y - 10, 36, 20);
    g.fillStyle(0xee4444);
    g.fillRect(x - 10, y - 16, 20, 8);
    // Antennae
    g.fillStyle(0xff6666);
    g.fillRect(x - 13, y - 24, 4, 10);
    g.fillRect(x + 9,  y - 24, 4, 10);
    // Eyes
    g.fillStyle(0xffdddd);
    g.fillRect(x - 10, y - 6,  7, 7);
    g.fillRect(x + 3,  y - 6,  7, 7);
    g.fillStyle(0xff0000);
    g.fillRect(x - 8,  y - 4,  3, 3);
    g.fillRect(x + 5,  y - 4,  3, 3);
    // Claws (horizontal shooter style — point left)
    g.fillStyle(0xcc2222);
    g.fillRect(x - 24, y + 8,  8, 5);
    g.fillRect(x - 4,  y + 8,  8, 5);
    g.fillRect(x + 14, y + 8,  8, 5);
  }

  private drawEnemyPurple(g: Phaser.GameObjects.Graphics, x: number, y: number): void {
    // Saucer — purple
    g.fillStyle(0x8833cc);
    g.fillRect(x - 16, y - 10, 32, 20);
    g.fillStyle(0xaa55ff);
    g.fillEllipse(x, y - 6, 24, 14);
    // Portholes
    g.fillStyle(0x220033);
    g.fillCircle(x - 7, y - 4, 4);
    g.fillCircle(x + 7, y - 4, 4);
    g.fillStyle(0xddaaff, 0.7);
    g.fillCircle(x - 6, y - 5, 2);
    g.fillCircle(x + 8, y - 5, 2);
    // Side fins
    g.fillStyle(0x6622aa);
    g.fillTriangle(x - 22, y + 10, x - 14, y - 2, x - 6,  y + 10);
    g.fillTriangle(x + 22, y + 10, x + 14, y - 2, x + 6,  y + 10);
  }

  private drawEnemyGreen(g: Phaser.GameObjects.Graphics, x: number, y: number): void {
    // Bug — green
    g.fillStyle(0x229922);
    g.fillEllipse(x, y, 36, 26);
    g.fillStyle(0x55ee55);
    g.fillEllipse(x, y - 6, 22, 14);
    // Eye stalks
    g.fillStyle(0x115511);
    g.fillRect(x - 8, y - 18, 4, 8);
    g.fillRect(x + 4, y - 18, 4, 8);
    g.fillStyle(0xff2222);
    g.fillCircle(x - 6, y - 20, 4);
    g.fillCircle(x + 6, y - 20, 4);
    g.fillStyle(0xffff00, 0.8);
    g.fillCircle(x - 5, y - 21, 2);
    g.fillCircle(x + 7, y - 21, 2);
    // Legs
    g.fillStyle(0x229922);
    g.fillRect(x - 20, y + 10, 6, 10);
    g.fillRect(x - 4,  y + 10, 6, 10);
    g.fillRect(x + 12, y + 10, 6, 10);
  }

  // ── Weapons ────────────────────────────────────────────────────────────────

  private shoot(): void {
    if (this.fireCd > 0 || !this.playerAlive) return;
    this.fireCd = FIRE_COOLDOWN;

    const rect = this.add.rectangle(this.px + 36, this.py, 22, 5, 0x00ffcc).setDepth(4);
    this.pBeams.push({ rect, vx: BULLET_SPEED, vy: 0, alive: true });

    // Muzzle flash
    const flash = this.add.rectangle(this.px + 46, this.py, 12, 12, 0xffffff).setDepth(5);
    this.tweens.add({ targets: flash, alpha: 0, scaleX: 2.5, scaleY: 2.5, duration: 70, onComplete: () => flash.destroy() });

    // Tiny spark burst
    const sparks = this.add.particles(this.px + 46, this.py, 'px', {
      speed: { min: 30, max: 80 }, angle: { min: -25, max: 25 },
      lifespan: 100, quantity: 5, scale: { start: 0.8, end: 0 },
      tint: [0x00ffcc, 0xaaffee, 0xffffff],
    });
    this.time.delayedCall(120, () => { if (sparks.active) sparks.destroy(); });
  }

  private enemyShoot(): void {
    const alive = this.enemies.filter(e => e.alive);
    if (!alive.length || !this.playerAlive) return;
    const shooter = alive[Phaser.Math.Between(0, alive.length - 1)];
    const ex = shooter.sx, ey = shooter.sy;

    // Aimed at player
    const dx = this.px - ex, dy = this.py - ey;
    const len = Math.sqrt(dx * dx + dy * dy) || 1;
    const spd = EBULLET_SPEED + this.wave * 10;

    const rect = this.add.rectangle(ex, ey, 16, 5, 0xff3333).setDepth(4);
    this.eBeams.push({ rect, vx: dx / len * spd, vy: dy / len * spd, alive: true });
  }

  // ── Effects ────────────────────────────────────────────────────────────────

  private explode(x: number, y: number, color: number): void {
    // Particles
    const ps = this.add.particles(x, y, 'px', {
      speed: { min: 50, max: 160 }, angle: { min: 0, max: 360 },
      lifespan: { min: 200, max: 520 }, quantity: 14,
      scale: { start: 0.9, end: 0 },
      tint: [color, 0xffffff, 0xffff00],
      gravityY: 30,
    });
    this.time.delayedCall(600, () => { if (ps.active) ps.destroy(); });

    // Shockwave ring
    const ring = this.add.graphics().setDepth(5);
    ring.lineStyle(3, color, 1);
    ring.strokeCircle(x, y, 8);
    this.tweens.add({
      targets: ring, scaleX: 4, scaleY: 4, alpha: 0, duration: 280,
      onComplete: () => ring.destroy(),
    });
  }

  private hitFlash(x: number, y: number): void {
    const f = this.add.rectangle(x, y, 46, 38, 0xffffff, 0.75).setDepth(6);
    this.tweens.add({ targets: f, alpha: 0, duration: 100, onComplete: () => f.destroy() });
  }

  // ── HUD helpers ────────────────────────────────────────────────────────────

  private refreshScore(): void {
    this.scoreTxt.setText(`SCORE  ${this.score}`);
    this.tweens.add({ targets: this.scoreTxt, scaleX: 1.15, scaleY: 1.15, duration: 70, yoyo: true });
  }

  private refreshLives(): void {
    const sym = Array(Math.max(0, this.lives)).fill('♦').join(' ') || '--';
    this.livesTxt.setText(sym);
  }

  // ── Player death ───────────────────────────────────────────────────────────

  private killPlayer(): void {
    if (this.invincible || !this.playerAlive) return;
    this.lives--;
    this.refreshLives();
    this.explode(this.px, this.py, 0x4499ff);
    // Camera shake
    this.cameras.main.shake(280, 0.012);

    if (this.lives <= 0) {
      this.playerAlive = false;
      this.playerGfx.clear();
      this.time.delayedCall(900, () => this.showGameOver());
    } else {
      // Respawn centre with invincibility
      this.py = GAME_HEIGHT / 2;
      this.invincible = true;
      this.invTimer   = 0;
      this.time.delayedCall(2200, () => {
        this.invincible = false;
        this.invTimer   = 0;
      });
    }
  }

  private showGameOver(): void {
    this.gameOver = true;

    // Dim overlay
    this.add.rectangle(GAME_WIDTH / 2, GAME_HEIGHT / 2, GAME_WIDTH, GAME_HEIGHT, 0x000000, 0.62).setDepth(200);

    this.add.text(GAME_WIDTH / 2, GAME_HEIGHT / 2 - 70, 'GAME OVER', {
      fontFamily: 'monospace', fontSize: '58px', color: '#ff3333',
      stroke: '#770000', strokeThickness: 7,
    }).setOrigin(0.5).setDepth(201);

    this.add.text(GAME_WIDTH / 2, GAME_HEIGHT / 2 + 10, `SCORE  ${this.score}`, {
      fontFamily: 'monospace', fontSize: '30px', color: '#00ffcc',
    }).setOrigin(0.5).setDepth(201);

    const prompt = this.add.text(GAME_WIDTH / 2, GAME_HEIGHT / 2 + 72, '[ SPACE  TO  PLAY  AGAIN ]', {
      fontFamily: 'monospace', fontSize: '20px', color: '#ffffff',
    }).setOrigin(0.5).setDepth(201).setAlpha(0);

    this.tweens.add({ targets: prompt, alpha: 1, duration: 500, onComplete: () => {
      this.tweens.add({ targets: prompt, alpha: 0.15, duration: 600, yoyo: true, repeat: -1 });
    }});

    this.input.keyboard!.once('keydown-SPACE', () => this.scene.restart());
  }

  // ── Main loop ──────────────────────────────────────────────────────────────

  update(_time: number, delta: number): void {
    if (this.gameOver) return;

    // Stars
    this.drawStars(delta);

    // Player movement
    if (this.playerAlive) {
      const up   = this.cursors.up.isDown   || this.wKey.isDown;
      const down = this.cursors.down.isDown || this.sKey.isDown;
      if (up   && this.py > 58)               this.py -= PLAYER_SPEED * (delta / 1000);
      if (down && this.py < GAME_HEIGHT - 30) this.py += PLAYER_SPEED * (delta / 1000);

      // Fire (auto-fire while held)
      this.fireCd -= delta;
      if (this.spaceKey.isDown) this.shoot();

      // Invincibility countdown
      if (this.invincible) this.invTimer += delta;
    }
    this.drawPlayer();

    // Formation drift (left)
    const waveSpd = 32 + this.wave * 9;
    this.fmT += delta;
    this.fmX -= waveSpd * (delta / 1000);

    // Loop formation when it scrolls off the left
    const alive = this.enemies.filter(e => e.alive);
    if (alive.length) {
      const leftEdge = Math.min(...alive.map(e => e.baseX)) + this.fmX;
      if (leftEdge < -90) this.fmX += GAME_WIDTH + 180;
    }

    // Enemy fire
    this.eFireTimer -= delta;
    const interval = Math.max(480, FIRE_INTERVAL_BASE - this.wave * 70);
    if (this.eFireTimer <= 0) {
      this.eFireTimer = interval;
      this.enemyShoot();
    }

    // Draw enemies (sets sx/sy)
    this.drawEnemies();

    // Player bullets
    for (const b of this.pBeams) {
      if (!b.alive) continue;
      b.rect.x += b.vx * (delta / 1000);
      if (b.rect.x > GAME_WIDTH + 30) { b.rect.destroy(); b.alive = false; continue; }

      for (const e of this.enemies) {
        if (!e.alive) continue;
        if (Math.abs(b.rect.x - e.sx) < 22 && Math.abs(b.rect.y - e.sy) < 18) {
          b.rect.destroy(); b.alive = false;
          e.hp--;
          if (e.hp <= 0) {
            e.alive = false;
            this.score += e.scoreValue;
            this.refreshScore();
            const colors = [0xff4444, 0xaa44ff, 0x44cc44];
            this.explode(e.sx, e.sy, colors[e.row]);
          } else {
            this.hitFlash(e.sx, e.sy);
          }
          break;
        }
      }
    }

    // Enemy bullets
    for (const b of this.eBeams) {
      if (!b.alive) continue;
      b.rect.x += b.vx * (delta / 1000);
      b.rect.y += b.vy * (delta / 1000);
      if (b.rect.x < -20 || b.rect.y < -20 || b.rect.y > GAME_HEIGHT + 20) {
        b.rect.destroy(); b.alive = false; continue;
      }
      if (this.playerAlive && !this.invincible) {
        if (Math.abs(b.rect.x - this.px) < 24 && Math.abs(b.rect.y - this.py) < 18) {
          b.rect.destroy(); b.alive = false;
          this.killPlayer();
        }
      }
    }

    // Prune dead beams
    this.pBeams = this.pBeams.filter(b => b.alive);
    this.eBeams = this.eBeams.filter(b => b.alive);

    // Wave-clear check
    if (!this.waveClearPending && alive.length === 0) {
      this.waveClearPending = true;
      this.waveClearCountdown = 1600;

      const bonus = this.wave * 100;
      this.score += bonus;
      this.refreshScore();

      const banner = this.add.text(GAME_WIDTH / 2, GAME_HEIGHT / 2,
        `WAVE  CLEAR!\n+${bonus}  BONUS`, {
          fontFamily: 'monospace', fontSize: '36px', color: '#ffee44',
          stroke: '#664400', strokeThickness: 4, align: 'center',
        }).setOrigin(0.5).setDepth(100).setAlpha(0);

      this.tweens.add({ targets: banner, alpha: 1, duration: 250, onComplete: () => {
        this.time.delayedCall(1000, () => {
          this.tweens.add({ targets: banner, alpha: 0, duration: 350, onComplete: () => banner.destroy() });
        });
      }});
    }

    if (this.waveClearPending) {
      this.waveClearCountdown -= delta;
      if (this.waveClearCountdown <= 0) {
        this.waveClearPending = false;
        this.wave++;
        this.waveTxt.setText(`WAVE  ${this.wave}`);
        this.spawnWave();
        this.showWaveBanner();
      }
    }
  }
}
