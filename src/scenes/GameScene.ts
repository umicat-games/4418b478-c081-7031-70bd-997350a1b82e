import Phaser from 'phaser';
import {
  loadWorldScene,
  getEntityRegistry,
  getManifest,
  applyAssetHitbox,
  addTilemapCollider,
} from '@umicat/phaser-sdk';
import { GAME_WIDTH, GAME_HEIGHT } from '../config';
// Rex gesture helpers — no plugin registration needed
// @ts-ignore – rex has no bundled TS declarations for this path
import { Pan, Tap } from 'phaser3-rex-plugins/plugins/gestures.js';

// --- Wander tuning ---
const CHILD_SPEED = 55;               // world-px per second
const WANDER_MIN_MS = 1500;
const WANDER_MAX_MS = 3500;

const GRASS_ISLAND_ENTITY_ID = 'e-mqveju7y-sk2r';

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
    // Set zoom + pre-position BEFORE awaiting scene load so the camera
    // never shows the top-left corner during the loading frames.
    this.cameras.main.setZoom(3);
    this.cameras.main.roundPixels = true;
    // Pre-center on the island (child's authored position) while loading
    this.cameras.main.setScroll(
      496 - GAME_WIDTH  / (2 * 3),
      302 - GAME_HEIGHT / (2 * 3),
    );

    const { sceneFile } = await loadWorldScene(this, this.sceneId);

    const reg = getEntityRegistry(this)!;
    const childGO = reg.byRole('child')[0] as Phaser.GameObjects.Sprite | undefined;

    if (childGO) {
      this.child = childGO;

      // Physics body
      this.physics.add.existing(this.child);
      const body = this.child.body as Phaser.Physics.Arcade.Body;
      body.setCollideWorldBounds(false);

      // Vision-authored foot-area hitbox
      const manifest = getManifest(this);
      const assetId = this.child.getData('assetId') as string;
      const asset = manifest?.assets.find((a: { id: string }) => a.id === assetId);
      if (asset?.hitbox) applyAssetHitbox(this.child, asset);

      // Tilemap collision
      addTilemapCollider(this, GRASS_ISLAND_ENTITY_ID, this.child);

      // ── Camera: starts on the cat, then player drives it ──────────────
      const cam = this.cameras.main;
      cam.setScroll(
        this.child.x - GAME_WIDTH  / (2 * cam.zoom),
        this.child.y - GAME_HEIGHT / (2 * cam.zoom),
      );
      // No startFollow — the player controls the camera manually.

      // Allow two simultaneous pointers (pan + button tap at the same time)
      this.input.addPointer(1);

      // ── Drag-to-pan ────────────────────────────────────────────────────
      // threshold=10 px: tiny movements (taps) don't pan the camera
      const panGesture = new Pan(this, { threshold: 10 }) as Phaser.Events.EventEmitter;
      panGesture.on('panstart', () => {
        // Interrupt any running "find-cat" smooth-pan tween
        this.tweens.killTweensOf(cam);
      });
      panGesture.on('pan', (p: { dx: number; dy: number }) => {
        // dx/dy are screen pixels → divide by zoom to get world delta
        cam.scrollX -= p.dx / cam.zoom;
        cam.scrollY -= p.dy / cam.zoom;
        // Camera bounds (set by loadWorldScene) auto-clamp on preRender
      });

      // ── Double-tap / double-click on empty space → find cat ────────────
      const tapGesture = new Tap(this, {
        tapInterval: 400,      // max ms between the two taps
        maxMovingDistance: 20, // threshold: larger moves = drag, not tap
      }) as Phaser.Events.EventEmitter;
      tapGesture.on('2tap', () => this.snapToChild());

      // ── "Find cat" button ──────────────────────────────────────────────
      this.buildFindCatButton();

      this.pickNewWanderDirection();
    }

    if (sceneFile.entities.length === 0) {
      this.add.text(GAME_WIDTH / 2, GAME_HEIGHT / 2, 'Describe your game\nin the chat!', {
        fontSize: '28px', color: '#ffffff', align: 'center',
      }).setOrigin(0.5);
    }
  }

  // ── "Find cat" — smooth tween back to the child ───────────────────────

  private snapToChild(): void {
    if (!this.child) return;
    const cam = this.cameras.main;
    // Kill any previous snap tween so they don't stack
    this.tweens.killTweensOf(cam);
    this.tweens.add({
      targets: cam,
      scrollX: this.child.x - GAME_WIDTH  / (2 * cam.zoom),
      scrollY: this.child.y - GAME_HEIGHT / (2 * cam.zoom),
      duration: 520,
      ease: 'Quad.easeOut',
    });
  }

  // ── "Find cat" button — warm cozy pill, fixed to top-right ───────────

  private buildFindCatButton(): void {
    const BW = 104; const BH = 32; const R = 10;
    const bx = GAME_WIDTH - 14 - BW / 2;
    const by = 14 + BH / 2;

    const bg = this.add.graphics().setDepth(1000).setScrollFactor(0);

    const draw = (hover: boolean) => {
      bg.clear();
      bg.fillStyle(hover ? 0xa07840 : 0x5c3e18, 0.90);
      bg.fillRoundedRect(bx - BW / 2, by - BH / 2, BW, BH, R);
      bg.lineStyle(1.5, 0xe8c87a, 0.80);
      bg.strokeRoundedRect(bx - BW / 2, by - BH / 2, BW, BH, R);
    };
    draw(false);

    this.add.text(bx, by, 'Find cat  \u25cf', {
      fontSize: '12px', color: '#f5dfa0', fontFamily: 'sans-serif',
    }).setOrigin(0.5).setDepth(1001).setScrollFactor(0);

    // Transparent hit-rectangle layered on top for clean touch target
    this.add.rectangle(bx, by, BW, BH, 0x000000, 0)
      .setDepth(1002).setScrollFactor(0)
      .setInteractive({ useHandCursor: true })
      .on('pointerover',  () => draw(true))
      .on('pointerout',   () => draw(false))
      .on('pointerdown',  () => this.snapToChild());
  }

  // ── Wandering AI helpers ──────────────────────────────────────────────

  private velToDir(vx: number, vy: number): FaceDir {
    if (Math.abs(vx) >= Math.abs(vy)) return vx >= 0 ? 'right' : 'left';
    return vy >= 0 ? 'down' : 'up';
  }

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

    if (body.blocked.left || body.blocked.right || body.blocked.up || body.blocked.down) {
      this.pickNewWanderDirection();
      return;
    }

    this.wanderTimer += delta;
    if (this.wanderTimer >= this.wanderInterval) {
      this.pickNewWanderDirection();
    }
  }
}
