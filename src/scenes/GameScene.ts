import Phaser from 'phaser';
import {
  loadWorldScene,
  getEntityRegistry,
  getManifest,
  addTilemapCollider,
  applyAssetHitbox,
} from '@umicat/phaser-sdk';
import { GAME_WIDTH, GAME_HEIGHT } from '../config';

const RUN_SPEED = 300;       // px / second — forward speed
const JUMP_VELOCITY = -680;  // px / second — upward burst
const WORLD_WIDTH = 1600;    // must match world.width in main.json
// Trigger win when the player reaches this world X (just before the right edge)
const WIN_X = WORLD_WIDTH - 80;

export class GameScene extends Phaser.Scene {
  private sceneId!: string;

  private player!: Phaser.GameObjects.Sprite;
  private isOnGround = false;
  private gameOver = false;    // true once win/lose is triggered

  constructor() {
    super({ key: 'GameScene' });
  }

  init(data: { sceneId: string }): void {
    this.sceneId = data.sceneId;
    this.gameOver = false;
  }

  async create(): Promise<void> {
    const { sceneFile } = await loadWorldScene(this, this.sceneId);

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

    const registry = getEntityRegistry(this)!;
    const manifest = getManifest(this)!;

    // ── Player ──────────────────────────────────────────────────────────────
    const playerGO = registry.byRole('player')[0];
    if (!playerGO) return;
    this.player = playerGO as Phaser.GameObjects.Sprite;

    // Add Arcade physics body
    this.physics.add.existing(this.player);
    const body = this.player.body as Phaser.Physics.Arcade.Body;

    // Apply hitbox metadata from the editor if available; no-op otherwise.
    const asset = manifest.assets.find((a) => a.id === this.player.getData('assetId'));
    if (asset) {
      applyAssetHitbox(this.player, asset);
    }

    // Cap fall speed so the cube doesn't phase through tiles
    body.setMaxVelocityY(1000);

    // ── Platform collision ────────────────────────────────────────────────────
    addTilemapCollider(this, 'e-mr2him35-9l8w', this.player);

    // ── Camera ────────────────────────────────────────────────────────────────
    // Clamp to world bounds — camera will never scroll past the map edges,
    // so the right boundary is respected even as the player nears the end.
    this.cameras.main.setBounds(0, 0, WORLD_WIDTH, GAME_HEIGHT);
    // lerpX = 1 → instant X follow; lerpY = 0 → Y is locked (never moves)
    this.cameras.main.startFollow(this.player, false, 1, 0);
    // Keep player in the left-third of screen (classic GD feel)
    this.cameras.main.setFollowOffset(-GAME_WIDTH * 0.2, 0);

    // ── Input ────────────────────────────────────────────────────────────────
    const spaceKey = this.input.keyboard!.addKey(
      Phaser.Input.Keyboard.KeyCodes.SPACE,
    );
    spaceKey.on('down', () => this.doJump());
    this.input.on('pointerdown', () => this.doJump());

    // ── Landing dust puff ────────────────────────────────────────────────────
    this.events.on('player-land', () => {
      if (!this.player) return;
      const px = this.player.x;
      const py = this.player.y + this.player.displayHeight * 0.5;
      const dust = this.add.particles(px, py, '__DEFAULT', {
        lifespan: 220,
        speed: { min: 30, max: 80 },
        angle: { min: 195, max: 345 },
        scale: { start: 0.35, end: 0 },
        alpha: { start: 0.65, end: 0 },
        tint: [0xffffff, 0xaad4ff],
        quantity: 7,
      });
      dust.setDepth(9);
      this.time.delayedCall(280, () => dust.destroy());
    });
  }

  // ── Jump ───────────────────────────────────────────────────────────────────
  private doJump(): void {
    if (this.gameOver || !this.player?.body || !this.isOnGround) return;
    const body = this.player.body as Phaser.Physics.Arcade.Body;
    body.setVelocityY(JUMP_VELOCITY);
    this.isOnGround = false;
  }

  // ── Win ────────────────────────────────────────────────────────────────────
  private triggerWin(): void {
    if (this.gameOver) return;
    this.gameOver = true;

    const body = this.player.body as Phaser.Physics.Arcade.Body;
    body.setVelocity(0, 0);
    body.setAllowGravity(false);

    // Pop the cube up slightly then freeze
    this.tweens.add({
      targets: this.player,
      y: this.player.y - 40,
      rotation: this.player.rotation + Math.PI * 2,
      duration: 500,
      ease: 'Cubic.easeOut',
    });

    // Dark overlay (fixed to camera)
    const overlay = this.add.rectangle(
      this.cameras.main.scrollX + GAME_WIDTH / 2,
      GAME_HEIGHT / 2,
      GAME_WIDTH, GAME_HEIGHT,
      0x000000, 0,
    ).setDepth(1000);

    // "LEVEL COMPLETE!" text
    const msg = this.add
      .text(
        this.cameras.main.scrollX + GAME_WIDTH / 2,
        GAME_HEIGHT / 2,
        'LEVEL COMPLETE!',
        {
          fontSize: '64px',
          color: '#ffe84d',
          fontStyle: 'bold',
          stroke: '#000000',
          strokeThickness: 6,
          shadow: { color: '#ffaa00', blur: 20, fill: true },
        },
      )
      .setOrigin(0.5)
      .setDepth(1001)
      .setScale(0);

    // Sub-text
    const sub = this.add
      .text(
        this.cameras.main.scrollX + GAME_WIDTH / 2,
        GAME_HEIGHT / 2 + 70,
        'Press SPACE or tap to play again',
        { fontSize: '24px', color: '#ffffff', alpha: 0 },
      )
      .setOrigin(0.5)
      .setDepth(1001)
      .setAlpha(0);

    // Fade overlay in
    this.tweens.add({
      targets: overlay,
      fillAlpha: 0.55,
      duration: 600,
      ease: 'Sine.easeIn',
    });

    // Pop text in after a short delay
    this.time.delayedCall(400, () => {
      this.tweens.add({
        targets: msg,
        scale: 1,
        duration: 400,
        ease: 'Back.easeOut',
      });
      this.tweens.add({
        targets: sub,
        alpha: 1,
        duration: 500,
        delay: 300,
      });

      // Restart on Space or tap
      this.input.once('pointerdown', () => this.scene.restart());
      this.input.keyboard?.once('keydown-SPACE', () => this.scene.restart());
    });
  }

  // ── Update loop ────────────────────────────────────────────────────────────
  update(_time: number, delta: number): void {
    if (!this.player?.body || this.gameOver) return;

    const body = this.player.body as Phaser.Physics.Arcade.Body;
    const wasOnGround = this.isOnGround;

    // Always run forward at constant speed
    body.setVelocityX(RUN_SPEED);

    // Ground state
    this.isOnGround = body.blocked.down;

    // Landing event → dust puff + snap rotation to nearest 90°
    if (!wasOnGround && this.isOnGround) {
      this.events.emit('player-land');
      // Snap to nearest quarter-turn so the cube looks flat on landing
      const snapped = Math.round(this.player.rotation / (Math.PI / 2)) * (Math.PI / 2);
      this.player.setRotation(snapped);
    }

    // Rotation: only while airborne (GD rule — cube rolls in the air)
    if (!this.isOnGround) {
      // One full clockwise revolution per ~0.9 s in the air
      const rotSpeed = (Math.PI * 2) / 900; // rad/ms
      this.player.setRotation(this.player.rotation + rotSpeed * delta);
    }

    // Win condition — player reached the end of the map
    if (this.player.x >= WIN_X) {
      this.triggerWin();
    }
  }
}
