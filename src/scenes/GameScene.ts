import Phaser from 'phaser';
import { loadWorldScene } from '@umicat/phaser-sdk';
import { GAME_WIDTH, GAME_HEIGHT } from '../config';

// ─── Tuning constants ──────────────────────────────────────────────────────────
const GRAVITY       = 1400;   // px / s²
const FLAP_VEL      = -440;   // px / s  (upward, negative)
const PIPE_SPEED    = 240;    // px / s  (rightward, subtracted each frame)
const PIPE_SPAWN_MS = 1750;   // ms between pipe pairs
const PIPE_GAP      = 190;    // px between top and bottom pipe opening
const GROUND_H      = 76;     // height of the ground strip
const PIPE_W        = 68;     // visual pipe body width
const PIPE_CAP_EXT  = 10;     // how much cap extends each side beyond body
const PIPE_CAP_H    = 28;     // cap height
const BIRD_X        = 200;    // fixed horizontal position of bird
// ──────────────────────────────────────────────────────────────────────────────

type GameState = 'idle' | 'playing' | 'dead';

interface PipePair {
  container: Phaser.GameObjects.Container;
  gapTop: number;     // y where the gap opens
  gapBottom: number;  // y where the gap closes
  scored: boolean;
}

export class GameScene extends Phaser.Scene {
  private sceneId!: string;

  // Core objects
  private bird!: Phaser.Physics.Arcade.Sprite;
  private birdBody!: Phaser.Physics.Arcade.Body;

  // Pipe tracking (non-physics, moved manually)
  private pipePairs: PipePair[] = [];

  // Game state
  private state: GameState = 'idle';
  private score = 0;
  private bestScore = 0;
  private groundY!: number;

  // HUD
  private scoreText!: Phaser.GameObjects.Text;
  private tapText!: Phaser.GameObjects.Text;
  private hintText!: Phaser.GameObjects.Text;
  private gameOverGroup!: Phaser.GameObjects.Container;

  private pipeTimer?: Phaser.Time.TimerEvent;

  constructor() {
    super({ key: 'GameScene' });
  }

  init(data: { sceneId: string }): void {
    this.sceneId = data.sceneId;
  }

  async create(): Promise<void> {
    await loadWorldScene(this, this.sceneId);

    this.groundY     = GAME_HEIGHT - GROUND_H;
    this.score       = 0;
    this.state       = 'idle';
    this.pipePairs   = [];
    this.bestScore   = (this.registry.get('bestScore') as number) ?? 0;

    // Physics world gravity
    this.physics.world.gravity.y = GRAVITY;

    this.buildTextures();
    this.drawBackground();
    this.createBird();
    this.buildHUD();
    this.setupInput();
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Texture generation (runs once; cached by Phaser's texture manager)
  // ──────────────────────────────────────────────────────────────────────────

  private buildTextures(): void {
    this.makeBirdTexture();
  }

  private makeBirdTexture(): void {
    if (this.textures.exists('bird')) return;

    const g = this.make.graphics({ add: false });

    // Body — golden yellow
    g.fillStyle(0xFFD700);
    g.fillEllipse(22, 18, 38, 30);

    // Wing
    g.fillStyle(0xFFA500);
    g.fillEllipse(11, 21, 20, 13);

    // Belly highlight
    g.fillStyle(0xFFF07A);
    g.fillEllipse(24, 21, 17, 12);

    // Beak
    g.fillStyle(0xFF6B00);
    g.fillTriangle(35, 14, 46, 19, 35, 24);

    // Eye white
    g.fillStyle(0xFFFFFF);
    g.fillCircle(27, 12, 7);

    // Eye pupil
    g.fillStyle(0x111111);
    g.fillCircle(29, 12, 4);

    // Eye shine
    g.fillStyle(0xFFFFFF);
    g.fillCircle(30, 10, 2);

    g.generateTexture('bird', 48, 36);
    g.destroy();
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Background & Ground
  // ──────────────────────────────────────────────────────────────────────────

  private drawBackground(): void {
    // Sky — banded gradient
    const sky = this.add.graphics().setDepth(0);
    const bands: number[] = [0x5BB8CE, 0x6ECFDF, 0x88DFF0, 0xAAEDFF, 0xC8F5FF];
    const bh = GAME_HEIGHT / bands.length;
    bands.forEach((c, i) => {
      sky.fillStyle(c);
      sky.fillRect(0, i * bh, GAME_WIDTH, bh + 2);
    });

    // Clouds
    const cloudDefs = [
      { x: 130, y: 75,  w: 110, h: 50 },
      { x: 390, y: 120, w: 95,  h: 43 },
      { x: 710, y: 60,  w: 125, h: 52 },
      { x: 980, y: 105, w: 100, h: 45 },
      { x: 1220, y: 70, w: 90,  h: 40 },
      { x: 280, y: 200, w: 80,  h: 36 },
      { x: 600, y: 175, w: 95,  h: 40 },
      { x: 880, y: 195, w: 85,  h: 38 },
      { x: 1100, y: 185, w: 75, h: 34 },
    ];
    cloudDefs.forEach(d => this.drawCloud(d.x, d.y, d.w, d.h));

    // Ground
    const gnd = this.add.graphics().setDepth(5);
    // Grass stripe
    gnd.fillStyle(0x5DBB52);
    gnd.fillRect(0, this.groundY, GAME_WIDTH, 18);
    gnd.fillStyle(0x3FA034);
    gnd.fillRect(0, this.groundY, GAME_WIDTH, 6);
    // Dirt body
    gnd.fillStyle(0xD4A96A);
    gnd.fillRect(0, this.groundY + 18, GAME_WIDTH, GROUND_H - 18);
    // Dirt texture marks
    gnd.fillStyle(0xBF9055);
    for (let x = 0; x < GAME_WIDTH; x += 68) {
      gnd.fillRect(x + 6,  this.groundY + 28, 30, 4);
      gnd.fillRect(x + 18, this.groundY + 46, 20, 3);
    }
  }

  private drawCloud(cx: number, cy: number, w: number, h: number): void {
    const g = this.add.graphics().setDepth(1);
    g.fillStyle(0xFFFFFF, 0.88);
    g.fillEllipse(cx,           cy,           w,       h);
    g.fillEllipse(cx - w * 0.3, cy + h * 0.2, w * 0.55, h * 0.65);
    g.fillEllipse(cx + w * 0.28, cy + h * 0.2, w * 0.58, h * 0.62);
    g.fillEllipse(cx - w * 0.1, cy - h * 0.18, w * 0.62, h * 0.65);
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Bird
  // ──────────────────────────────────────────────────────────────────────────

  private createBird(): void {
    this.bird     = this.physics.add.sprite(BIRD_X, GAME_HEIGHT / 2 - 20, 'bird');
    this.birdBody = this.bird.body as Phaser.Physics.Arcade.Body;

    // Smaller hitbox for fair play
    this.birdBody.setSize(26, 20, true);
    this.bird.setDepth(10);

    // Suspend gravity while idle
    this.birdBody.setGravityY(-GRAVITY);
    this.birdBody.setVelocity(0, 0);
  }

  // ──────────────────────────────────────────────────────────────────────────
  // HUD
  // ──────────────────────────────────────────────────────────────────────────

  private buildHUD(): void {
    // Score counter (top-centre)
    this.scoreText = this.add
      .text(GAME_WIDTH / 2, 28, '0', {
        fontFamily: 'Bangers, Impact, sans-serif',
        fontSize:   '72px',
        color:      '#ffffff',
        stroke:     '#444444',
        strokeThickness: 7,
      })
      .setOrigin(0.5, 0)
      .setDepth(100);

    // Tap-to-start overlay
    this.tapText = this.add
      .text(GAME_WIDTH / 2, GAME_HEIGHT / 2 - 70, 'FLAPPY BIRD', {
        fontFamily: 'Bangers, Impact, sans-serif',
        fontSize:   '72px',
        color:      '#FFD700',
        stroke:     '#333333',
        strokeThickness: 8,
      })
      .setOrigin(0.5)
      .setDepth(100);

    this.hintText = this.add
      .text(GAME_WIDTH / 2, GAME_HEIGHT / 2 + 10, 'TAP or SPACE to flap', {
        fontFamily: 'Bangers, Impact, sans-serif',
        fontSize:   '34px',
        color:      '#ffffff',
        stroke:     '#333333',
        strokeThickness: 5,
      })
      .setOrigin(0.5)
      .setDepth(100)
      .setName('hint');

    // Arrow pointing at bird in idle
    const arrow = this.add
      .text(BIRD_X + 36, GAME_HEIGHT / 2 - 20, '◀ YOU', {
        fontFamily: 'Bangers, Impact, sans-serif',
        fontSize:   '22px',
        color:      '#ffffff',
        stroke:     '#333',
        strokeThickness: 3,
      })
      .setOrigin(0, 0.5)
      .setDepth(100)
      .setName('arrow');

    // Game-over panel (hidden until death)
    this.gameOverGroup = this.add.container(GAME_WIDTH / 2, GAME_HEIGHT / 2).setDepth(200).setVisible(false);

    const panel = this.add.graphics();
    panel.fillStyle(0x000000, 0.68);
    panel.fillRoundedRect(-220, -130, 440, 280, 22);
    panel.lineStyle(3, 0xFFFFFF, 0.35);
    panel.strokeRoundedRect(-220, -130, 440, 280, 22);

    const goTitle = this.add
      .text(0, -95, 'GAME OVER', {
        fontFamily: 'Bangers, Impact, sans-serif',
        fontSize:   '54px',
        color:      '#FF4444',
        stroke:     '#000000',
        strokeThickness: 6,
      })
      .setOrigin(0.5);

    this.gameOverGroup.add([panel, goTitle]);
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Input
  // ──────────────────────────────────────────────────────────────────────────

  private setupInput(): void {
    this.input.keyboard?.on('keydown-SPACE', () => this.onTap());
    this.input.on('pointerdown', () => this.onTap());
  }

  private onTap(): void {
    if (this.state === 'dead') return;
    if (this.state === 'idle') this.beginPlaying();
    this.flap();
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Game-state transitions
  // ──────────────────────────────────────────────────────────────────────────

  private beginPlaying(): void {
    this.state = 'playing';

    // Hide idle UI
    this.tapText.setVisible(false);
    this.hintText.setVisible(false);
    this.children.getByName('arrow')?.destroy();

    // Enable world gravity on bird
    this.birdBody.setGravityY(0);

    // Start pipe spawning
    this.spawnPipe();
    this.pipeTimer = this.time.addEvent({
      delay:          PIPE_SPAWN_MS,
      callback:       this.spawnPipe,
      callbackScope:  this,
      loop:           true,
    });
  }

  private flap(): void {
    this.birdBody.setVelocityY(FLAP_VEL);
    // Pitch up on flap
    this.bird.angle = -28;
  }

  private die(): void {
    if (this.state === 'dead') return;
    this.state = 'dead';
    this.pipeTimer?.destroy();

    // Stop all pipe containers
    this.pipePairs.forEach(p => p.container.setActive(false));

    // White flash
    const flash = this.add
      .rectangle(GAME_WIDTH / 2, GAME_HEIGHT / 2, GAME_WIDTH, GAME_HEIGHT, 0xFFFFFF, 1)
      .setDepth(900);
    this.tweens.add({
      targets:  flash,
      alpha:    0,
      duration: 180,
      onComplete: () => flash.destroy(),
    });

    // Bird tumbles and falls
    this.birdBody.setVelocity(0, -80);
    this.tweens.add({
      targets:  this.bird,
      angle:    90,
      duration: 350,
      ease:     'Power2',
    });
    this.tweens.add({
      targets:  this.bird,
      y:        this.groundY - 12,
      duration: 500,
      ease:     'Power2.In',
      onComplete: () => {
        // Small squash on landing
        this.tweens.add({
          targets:  this.bird,
          scaleX:   1.5,
          scaleY:   0.4,
          duration: 80,
          yoyo:     true,
          onComplete: () => {
            // Update best score
            if (this.score > this.bestScore) {
              this.bestScore = this.score;
              this.registry.set('bestScore', this.bestScore);
            }
            this.showGameOver();
          },
        });
      },
    });
  }

  private showGameOver(): void {
    this.gameOverGroup.setVisible(true).setScale(0.5);

    // Dynamic text added each time (scene restarts clear them anyway)
    const scoreLine = this.add
      .text(0, -20, `Score: ${this.score}`, {
        fontFamily: 'Bangers, Impact, sans-serif',
        fontSize:   '42px',
        color:      '#ffffff',
        stroke:     '#000',
        strokeThickness: 5,
      })
      .setOrigin(0.5);

    const bestLine = this.add
      .text(0, 38, `Best: ${this.bestScore}`, {
        fontFamily: 'Bangers, Impact, sans-serif',
        fontSize:   '34px',
        color:      '#FFD700',
        stroke:     '#000',
        strokeThickness: 4,
      })
      .setOrigin(0.5);

    const restartLine = this.add
      .text(0, 100, 'TAP TO PLAY AGAIN', {
        fontFamily: 'Bangers, Impact, sans-serif',
        fontSize:   '28px',
        color:      '#AAFFAA',
        stroke:     '#000',
        strokeThickness: 3,
      })
      .setOrigin(0.5);

    this.gameOverGroup.add([scoreLine, bestLine, restartLine]);

    this.tweens.add({
      targets:  this.gameOverGroup,
      scaleX:   1,
      scaleY:   1,
      duration: 250,
      ease:     'Back.Out',
    });

    // Re-enable tap → restart after short grace period
    this.time.delayedCall(350, () => {
      this.input.once('pointerdown', () =>
        this.scene.restart({ sceneId: this.sceneId })
      );
      this.input.keyboard?.once('keydown-SPACE', () =>
        this.scene.restart({ sceneId: this.sceneId })
      );
    });
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Pipe spawning
  // ──────────────────────────────────────────────────────────────────────────

  private spawnPipe(): void {
    const minGapTop = 90;
    const maxGapTop = this.groundY - PIPE_GAP - 70;
    const gapTop    = Phaser.Math.Between(minGapTop, maxGapTop);
    const gapBottom = gapTop + PIPE_GAP;

    const startX  = GAME_WIDTH + 80;
    const container = this.add.container(startX, 0).setDepth(3);

    const g = this.add.graphics();
    this.drawPipe(g, gapTop, gapBottom);
    container.add(g);

    this.pipePairs.push({ container, gapTop, gapBottom, scored: false });
  }

  private drawPipe(g: Phaser.GameObjects.Graphics, gapTop: number, gapBottom: number): void {
    const hw   = PIPE_W / 2;
    const capX = -(hw + PIPE_CAP_EXT);
    const capW = PIPE_W + PIPE_CAP_EXT * 2;

    // Helper: draw a pipe segment (body + optional cap on one end)
    const body  = 0x2ECC40;
    const dark  = 0x1AAA2A;
    const light = 0x5AE05A;

    // ── TOP PIPE ──────────────────────────────────────────────────────────
    const topBodyH = gapTop - PIPE_CAP_H;
    if (topBodyH > 0) {
      // Body
      g.fillStyle(body);
      g.fillRect(-hw, 0, PIPE_W, topBodyH);
      // Right shadow
      g.fillStyle(dark);
      g.fillRect(hw - 9, 0, 9, topBodyH);
      // Left highlight
      g.fillStyle(light);
      g.fillRect(-hw, 0, 9, topBodyH);
    }
    // Cap (bottom of top pipe)
    g.fillStyle(body);
    g.fillRect(capX, gapTop - PIPE_CAP_H, capW, PIPE_CAP_H);
    g.fillStyle(dark);
    g.fillRect(capX + capW - 9, gapTop - PIPE_CAP_H, 9, PIPE_CAP_H);
    g.fillStyle(light);
    g.fillRect(capX, gapTop - PIPE_CAP_H, 9, PIPE_CAP_H);
    // Cap top highlight
    g.fillStyle(0x88FF88, 0.3);
    g.fillRect(capX, gapTop - PIPE_CAP_H, capW, 5);

    // ── BOTTOM PIPE ────────────────────────────────────────────────────────
    // Cap (top of bottom pipe)
    g.fillStyle(body);
    g.fillRect(capX, gapBottom, capW, PIPE_CAP_H);
    g.fillStyle(dark);
    g.fillRect(capX + capW - 9, gapBottom, 9, PIPE_CAP_H);
    g.fillStyle(light);
    g.fillRect(capX, gapBottom, 9, PIPE_CAP_H);
    // Cap bottom highlight
    g.fillStyle(0x88FF88, 0.3);
    g.fillRect(capX, gapBottom, capW, 5);

    const botBodyStart = gapBottom + PIPE_CAP_H;
    const botBodyH     = this.groundY - botBodyStart;
    if (botBodyH > 0) {
      // Body
      g.fillStyle(body);
      g.fillRect(-hw, botBodyStart, PIPE_W, botBodyH);
      // Right shadow
      g.fillStyle(dark);
      g.fillRect(hw - 9, botBodyStart, 9, botBodyH);
      // Left highlight
      g.fillStyle(light);
      g.fillRect(-hw, botBodyStart, 9, botBodyH);
    }
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Score
  // ──────────────────────────────────────────────────────────────────────────

  private addScore(): void {
    this.score++;
    this.scoreText.setText(String(this.score));

    // One-shot scale pop
    this.tweens.add({
      targets:  this.scoreText,
      scaleX:   1.4,
      scaleY:   1.4,
      duration: 80,
      yoyo:     true,
      ease:     'Power1',
    });

    // Tiny particle burst at the score text
    const emitter = this.add.particles(GAME_WIDTH / 2, 80, '__DEFAULT', {
      speed:    { min: 60, max: 120 },
      scale:    { start: 0.6, end: 0 },
      tint:     [0xFFD700, 0xFFFFFF, 0xFF8800],
      alpha:    { start: 1, end: 0 },
      angle:    { min: -150, max: -30 },
      lifespan: 350,
      quantity: 8,
    });
    emitter.setDepth(101);
    this.time.delayedCall(400, () => emitter.destroy());
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Collision detection (manual AABB)
  // ──────────────────────────────────────────────────────────────────────────

  private birdHitsPipe(pair: PipePair): boolean {
    // Bird AABB (using the shrunk hitbox size)
    const bx = this.bird.x;
    const by = this.bird.y;
    const bHW = 13;  // half of 26
    const bHH = 10;  // half of 20

    const px = pair.container.x;
    // Pipe horizontal extent (cap is widest)
    const pHW = PIPE_W / 2 + PIPE_CAP_EXT + 2;

    // No horizontal overlap → safe
    if (bx + bHW < px - pHW || bx - bHW > px + pHW) return false;

    // Vertical: safe only when fully inside the gap
    if (by - bHH >= pair.gapTop && by + bHH <= pair.gapBottom) return false;

    return true;
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Main update loop
  // ──────────────────────────────────────────────────────────────────────────

  update(_time: number, delta: number): void {
    if (this.state === 'idle') return;
    if (this.state === 'dead') return;

    // ── Bird rotation (nose-down when falling) ────────────────────────────
    const vy          = this.birdBody.velocity.y;
    const targetAngle = Phaser.Math.Clamp(vy * 0.065, -25, 90);
    this.bird.angle   = Phaser.Math.Linear(this.bird.angle, targetAngle, 0.2);

    // ── Kill if out of bounds ─────────────────────────────────────────────
    if (this.bird.y <= 0 || this.bird.y >= this.groundY + 4) {
      this.die();
      return;
    }

    // ── Move pipes & check collisions ─────────────────────────────────────
    const moveX = PIPE_SPEED * (delta / 1000);

    for (let i = this.pipePairs.length - 1; i >= 0; i--) {
      const pair = this.pipePairs[i];
      if (!pair.container.active) continue;

      pair.container.x -= moveX;

      // Score: pipe centre passes the bird
      if (!pair.scored && pair.container.x < BIRD_X) {
        pair.scored = true;
        this.addScore();
      }

      // Collision
      if (this.birdHitsPipe(pair)) {
        this.die();
        return;
      }

      // Cull off-screen pipes
      if (pair.container.x < -200) {
        pair.container.destroy();
        this.pipePairs.splice(i, 1);
      }
    }
  }
}
