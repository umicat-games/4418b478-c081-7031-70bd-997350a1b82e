import Phaser from 'phaser';
import {
  loadWorldScene,
  getEntityRegistry,
  getManifest,
  addTilemapCollider,
  applyAssetHitbox,
} from '@umicat/phaser-sdk';
import { GAME_WIDTH, GAME_HEIGHT } from '../config';

const RUN_SPEED = 300;     // px / second — forward speed
const JUMP_VELOCITY = -680; // px / second — upward burst

export class GameScene extends Phaser.Scene {
  private sceneId!: string;

  private player!: Phaser.GameObjects.Sprite;
  private isOnGround = false;

  constructor() {
    super({ key: 'GameScene' });
  }

  init(data: { sceneId: string }): void {
    this.sceneId = data.sceneId;
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

    // Add Arcade physics body to the player sprite
    this.physics.add.existing(this.player);
    const body = this.player.body as Phaser.Physics.Arcade.Body;

    // Apply hitbox from asset metadata if the user authored one in the editor.
    // applyAssetHitbox is a safe no-op when asset.hitbox is unset — it covers
    // both paths: authored hitbox → metadata wins; no metadata → body already
    // defaults to the full texture dimensions (correct for a cube).
    const asset = manifest.assets.find((a) => a.id === this.player.getData('assetId'));
    if (asset) {
      applyAssetHitbox(this.player, asset);
    }

    // Cap fall speed so the cube doesn't phase through thin tiles
    body.setMaxVelocityY(1000);

    // ── Tilemap collision ────────────────────────────────────────────────────
    // Entity 'e-mr2him35-9l8w' is the tilemap-ref for the platform.
    // SDK auto-armed solid:true tile collision; addTilemapCollider wires
    // both the layer collider AND any sub-tile static bodies.
    addTilemapCollider(this, 'e-mr2him35-9l8w', this.player);

    // ── Camera — GD style: follow X instantly, lock Y ───────────────────────
    this.cameras.main.setBounds(0, 0, 1600, GAME_HEIGHT);
    // lerpX = 1 → instant X follow; lerpY = 0 → Y is locked (never moves)
    this.cameras.main.startFollow(this.player, false, 1, 0);
    // Offset so the player sits in the left-third of screen (classic GD feel)
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
    if (!this.player?.body || !this.isOnGround) return;
    const body = this.player.body as Phaser.Physics.Arcade.Body;
    body.setVelocityY(JUMP_VELOCITY);
    this.isOnGround = false;
  }

  // ── Update loop ────────────────────────────────────────────────────────────
  update(_time: number, delta: number): void {
    if (!this.player?.body) return;

    const body = this.player.body as Phaser.Physics.Arcade.Body;
    const wasOnGround = this.isOnGround;

    // Always run forward at constant speed
    body.setVelocityX(RUN_SPEED);

    // Ground state
    this.isOnGround = body.blocked.down;

    // Landing event → dust puff
    if (!wasOnGround && this.isOnGround) {
      this.events.emit('player-land');
    }

    // Cube rolls clockwise proportional to forward speed (one full revolution ~1 s)
    const rotSpeed = (body.velocity.x / RUN_SPEED) * (Math.PI * 2) / 1000; // rad/ms
    this.player.setRotation(this.player.rotation + rotSpeed * delta);
  }
}
