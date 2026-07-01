import Phaser from 'phaser';
import { loadWorldScene, getEntityRegistry, addTilemapCollider } from '@umicat/phaser-sdk';
import { GAME_WIDTH, GAME_HEIGHT } from '../config';

/**
 * GameScene — Geometry Dash-style runner.
 *
 * GD physics mapped to a 40 px tile grid (1280 × 720 canvas):
 *   Horizontal speed : 320 px/s  (~8 tiles/s, GD "normal" speed)
 *   Jump velocity    : -900 px/s upward
 *   Gravity          : 2 200 px/s² downward  (declared in world/main.json)
 *   Jump height      : v²/2g ≈ 184 px / 4.6 tiles
 *   Jump duration    : 2v/g  ≈ 0.82 s
 *   Cube rotation    : 440°/s → ≈ 360° per flat-ground jump; snaps to 90° on land
 */
export class GameScene extends Phaser.Scene {
  private sceneId!: string;

  // Player reference — set after loadWorldScene resolves
  private player?: Phaser.GameObjects.Sprite;

  // State flags
  private isGrounded = false;
  private gameOver = false;
  private levelCompleted = false;

  // ── GD-calibrated constants ──────────────────────────────────────────────
  /** Constant rightward speed (px/s). */
  private readonly PLAYER_SPEED = 320;
  /** Initial upward impulse when jumping (px/s, negative = up). */
  private readonly JUMP_VELOCITY = -900;
  /** Clockwise rotation speed while airborne (degrees/s). */
  private readonly ROTATION_SPD = 440;
  /** World-X coordinate that triggers the level-complete screen. */
  private readonly LEVEL_END_X = 3155;

  constructor() {
    super({ key: 'GameScene' });
  }

  init(data: { sceneId: string }): void {
    this.sceneId = data.sceneId;
    // Reset all state on each (re)start
    this.isGrounded = false;
    this.gameOver = false;
    this.levelCompleted = false;
    this.player = undefined;
  }

  async create(): Promise<void> {
    const { sceneFile } = await loadWorldScene(this, this.sceneId);

    // Empty scene placeholder
    if (sceneFile.entities.length === 0) {
      this.add
        .text(GAME_WIDTH / 2, GAME_HEIGHT / 2, 'Describe your game\nin the chat!', {
          fontSize: '28px',
          color: '#ffffff',
          align: 'center',
        })
        .setOrigin(0.5);
      return;
    }

    // ── Entity lookup ──────────────────────────────────────────────────────
    const registry = getEntityRegistry(this)!;
    this.player = registry.byRole('player')[0] as Phaser.GameObjects.Sprite;
    if (!this.player) return;

    // ── Tilemap collision ──────────────────────────────────────────────────
    // 'e-mr2mi1gy-w2w0' is the tilemap-ref entity id for the platform.
    // addTilemapCollider auto-arms setCollisionByProperty({solid:true}) and
    // also wires up any sub-tile collision rects authored in the Tile Editor.
    addTilemapCollider(this, 'e-mr2mi1gy-w2w0', this.player);

    // ── Input ──────────────────────────────────────────────────────────────
    // SPACE key
    const spaceKey = this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.SPACE);
    spaceKey.on('down', this.handleJump, this);
    // Mouse click / touch tap
    this.input.on('pointerdown', this.handleJump, this);

    // ── Camera offset — player at ~33% from the left (GD-style) ───────────
    // A positive offsetX shifts the camera's mid-point rightward, so the
    // player sits to the LEFT of screen centre, showing more level ahead.
    this.cameras.main.setFollowOffset(220, 0);
  }

  // ── Jump ─────────────────────────────────────────────────────────────────
  private handleJump(): void {
    if (this.gameOver || this.levelCompleted || !this.player) return;
    if (!this.isGrounded) return;

    const body = this.player.body as Phaser.Physics.Arcade.Body;
    body.setVelocityY(this.JUMP_VELOCITY);
  }

  // ── Update loop ───────────────────────────────────────────────────────────
  update(_time: number, delta: number): void {
    if (!this.player || this.gameOver || this.levelCompleted) return;

    const body = this.player.body as Phaser.Physics.Arcade.Body;
    if (!body) return;

    // ── Ground state ───────────────────────────────────────────────────────
    const wasGrounded = this.isGrounded;
    this.isGrounded = body.blocked.down;

    // ── Constant horizontal velocity ───────────────────────────────────────
    // Override every frame so nothing can stop the cube horizontally.
    body.setVelocityX(this.PLAYER_SPEED);

    // ── Cube rotation ──────────────────────────────────────────────────────
    if (this.isGrounded) {
      if (!wasGrounded) {
        // Just landed → snap to nearest 90° for a clean look
        const snap = Math.round(this.player.rotation / (Math.PI / 2)) * (Math.PI / 2);
        this.player.setRotation(snap);
      }
      // No rotation while rolling on the ground
    } else {
      // Spin clockwise while airborne (~one full turn per flat jump)
      this.player.rotation += Phaser.Math.DegToRad(this.ROTATION_SPD) * (delta / 1000);
    }

    // ── Death: fell below the screen ──────────────────────────────────────
    if (this.player.y > GAME_HEIGHT + 80) {
      this.handleDeath();
      return;
    }

    // ── Death: hit a ceiling tile ─────────────────────────────────────────
    if (body.blocked.up) {
      this.handleDeath();
      return;
    }

    // ── Level complete ────────────────────────────────────────────────────
    if (this.player.x >= this.LEVEL_END_X) {
      this.handleLevelComplete();
    }
  }

  // ── Death ────────────────────────────────────────────────────────────────
  private handleDeath(): void {
    if (this.gameOver) return;
    this.gameOver = true;

    if (this.player?.body) {
      const body = this.player.body as Phaser.Physics.Arcade.Body;
      body.setVelocity(0, 0);
    }

    // Red flash + camera shake feedback
    this.cameras.main.shake(200, 0.015);
    this.cameras.main.flash(500, 220, 30, 30);

    // Brief pause then restart
    this.time.delayedCall(700, () => {
      this.scene.restart();
    });
  }

  // ── Level Complete ────────────────────────────────────────────────────────
  private handleLevelComplete(): void {
    if (this.levelCompleted) return;
    this.levelCompleted = true;

    // Freeze the player
    if (this.player?.body) {
      const body = this.player.body as Phaser.Physics.Arcade.Body;
      body.setVelocity(0, 0);
      body.setAllowGravity(false);
    }

    // Snap cube rotation to 0° for a clean final frame
    if (this.player) this.player.setRotation(0);

    // ── Overlay (fixed to camera via setScrollFactor(0)) ──────────────────
    const cx = GAME_WIDTH / 2;
    const cy = GAME_HEIGHT / 2;

    // Dark background dim
    this.add
      .rectangle(cx, cy, GAME_WIDTH, GAME_HEIGHT, 0x000000, 0.65)
      .setScrollFactor(0)
      .setDepth(1000);

    // Gold trophy icon + title
    const title = this.add
      .text(cx, cy - 90, '★  Level Complete!  ★', {
        fontSize: '42px',
        color: '#ffe066',
        fontStyle: 'bold',
        stroke: '#000000',
        strokeThickness: 5,
      })
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setDepth(1001)
      .setScale(0);

    // Bounce-in animation
    this.tweens.add({
      targets: title,
      scale: 1,
      ease: 'Back.Out',
      duration: 500,
    });

    // Sub-text — fades in after the title bounces in
    const sub = this.add
      .text(cx, cy - 20, 'You reached the end of the map!', {
        fontSize: '20px',
        color: '#aaddff',
      })
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setDepth(1001)
      .setAlpha(0);

    this.tweens.add({ targets: sub, alpha: 1, delay: 350, duration: 400 });

    // ── Play Again button ─────────────────────────────────────────────────
    const btn = this.add
      .text(cx, cy + 65, '  Play Again  ', {
        fontSize: '28px',
        color: '#ffffff',
        backgroundColor: '#2563eb',
        padding: { x: 24, y: 14 },
      })
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setDepth(1001)
      .setInteractive({ useHandCursor: true });

    btn.on('pointerover', () => btn.setStyle({ backgroundColor: '#1d4ed8' }));
    btn.on('pointerout', () => btn.setStyle({ backgroundColor: '#2563eb' }));
    btn.on('pointerdown', () => {
      this.scene.restart();
    });

    // Fade-in for button
    btn.setAlpha(0);
    this.tweens.add({
      targets: btn,
      alpha: 1,
      delay: 450,
      duration: 350,
    });
  }
}
