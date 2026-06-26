import Phaser from 'phaser';
import {
  loadWorldScene,
  getEntityRegistry,
  getManifest,
  applyAssetHitbox,
  addTilemapCollider,
} from '@umicat/phaser-sdk';
import { GAME_WIDTH, GAME_HEIGHT } from '../config';

// --- Wander tuning ---
const CHILD_SPEED = 55;               // world-px per second
const WANDER_MIN_MS = 1500;
const WANDER_MAX_MS = 3500;

// Tilemap entity id for the grass island (from scene JSON)
const GRASS_ISLAND_ENTITY_ID = 'e-mqveju7y-sk2r';

// 4-directional facing, used to pick walk/idle animation
type FaceDir = 'down' | 'up' | 'left' | 'right';

export class GameScene extends Phaser.Scene {
  private sceneId!: string;

  // Child spirit
  private child?: Phaser.GameObjects.Sprite;
  private wanderTimer = 0;
  private wanderInterval = 2000;
  private faceDir: FaceDir = 'down';

  constructor() {
    super({ key: 'GameScene' });
  }

  init(data: { sceneId: string }): void {
    this.sceneId = data.sceneId;
  }

  async create(): Promise<void> {
    const { sceneFile } = await loadWorldScene(this, this.sceneId);

    // 3× integer zoom: each 16-px source tile renders as 48-px on screen.
    // roundPixels prevents sub-pixel blur on camera pan.
    this.cameras.main.setZoom(3);
    this.cameras.main.roundPixels = true;

    const reg = getEntityRegistry(this)!;
    const childGO = reg.byRole('child')[0] as Phaser.GameObjects.Sprite | undefined;

    if (childGO) {
      this.child = childGO;

      // Give the child an Arcade physics body (must come before applyAssetHitbox)
      this.physics.add.existing(this.child);
      const body = this.child.body as Phaser.Physics.Arcade.Body;
      // Island tiles are the boundary — no need for world-bounds clamping
      body.setCollideWorldBounds(false);

      // Apply the vision-authored foot-area hitbox from the asset record
      const manifest = getManifest(this);
      const assetId = this.child.getData('assetId') as string;
      const asset = manifest?.assets.find((a: { id: string }) => a.id === assetId);
      if (asset?.hitbox) {
        applyAssetHitbox(this.child, asset);
      }

      // Wire solid-tile collision with the grass-island tilemap.
      // grass_tiles_v2 has detailed sub-tile collisionRects on boundary tiles;
      // addTilemapCollider handles both cell-rect and sub-tile groups in one call.
      addTilemapCollider(this, GRASS_ISLAND_ENTITY_ID, this.child);

      // Camera follows the child, clamped to the scene bounds
      this.cameras.main.startFollow(this.child, true);

      // Start wandering (first direction pick also starts the walk animation)
      this.pickNewWanderDirection();
    }

    if (sceneFile.entities.length === 0) {
      this.add
        .text(GAME_WIDTH / 2, GAME_HEIGHT / 2, 'Describe your game\nin the chat!', {
          fontSize: '28px',
          color: '#ffffff',
          align: 'center',
        })
        .setOrigin(0.5);
    }
  }

  /**
   * Derive a FaceDir from a velocity vector.
   * Uses the dominant axis (largest absolute component).
   */
  private velToDir(vx: number, vy: number): FaceDir {
    if (Math.abs(vx) >= Math.abs(vy)) {
      return vx >= 0 ? 'right' : 'left';
    }
    return vy >= 0 ? 'down' : 'up';
  }

  /** Pick a fresh random movement direction, update facing, start walk anim. */
  private pickNewWanderDirection(): void {
    if (!this.child?.body) return;
    const body = this.child.body as Phaser.Physics.Arcade.Body;
    const angle = Phaser.Math.FloatBetween(0, Math.PI * 2);
    const vx = Math.cos(angle) * CHILD_SPEED;
    const vy = Math.sin(angle) * CHILD_SPEED;
    body.setVelocity(vx, vy);

    this.faceDir = this.velToDir(vx, vy);
    this.child.play(`walk-${this.faceDir}`, true);

    this.wanderInterval = Phaser.Math.Between(WANDER_MIN_MS, WANDER_MAX_MS);
    this.wanderTimer = 0;
  }

  update(_time: number, delta: number): void {
    if (!this.child?.body) return;
    const body = this.child.body as Phaser.Physics.Arcade.Body;

    // If the child hits an island boundary tile, immediately pick a new
    // direction so they don't get stuck sliding along a wall.
    if (body.blocked.left || body.blocked.right || body.blocked.up || body.blocked.down) {
      this.pickNewWanderDirection();
      return;
    }

    // Otherwise, change direction on a random interval
    this.wanderTimer += delta;
    if (this.wanderTimer >= this.wanderInterval) {
      this.pickNewWanderDirection();
    }
  }
}
