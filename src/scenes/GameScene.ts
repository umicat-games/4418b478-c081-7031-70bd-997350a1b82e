import Phaser from 'phaser';
import {
  loadWorldScene,
  getEntityRegistry,
  getManifest,
  addTilemapCollider,
  applyAssetHitbox,
} from '@umicat/phaser-sdk';
import { GAME_WIDTH, GAME_HEIGHT } from '../config';

// ── Geometry Dash physics — mapped to our 64 px-tile world ────────────────
//
// Real GD runs at 60 fps with ~30 px tiles. Our tiles are 64 px so we
// scale all values by 64/30 ≈ 2.13. The numbers below give:
//   • horizontal speed  ≈ 5 tiles/s  (matches GD's default cube speed)
//   • jump height       ≈ 2.5 tiles  (classic single-block hop)
//   • air time          ≈ 0.9 s      (feels snappy, not floaty)
const PLAYER_SPEED   = 320;                        // px/s — horizontal auto-move
const JUMP_VELOCITY  = -710;                       // px/s — initial upward burst
const ROTATION_SPEED = (Math.PI * 2) / 0.88;      // rad/s — one full turn per ~0.88 s

// Level end threshold — trigger "complete" a little before the last cell
const LEVEL_END_X = 3100;

export class GameScene extends Phaser.Scene {
  private sceneId!: string;

  private player!: Phaser.Physics.Arcade.Sprite;
  private jumpKey!: Phaser.Input.Keyboard.Key;

  // State flags — reset in init() so scene.restart() is clean
  private isDead         = false;
  private isLevelComplete = false;
  private jumpPressed    = false;   // pointer-tap buffer

  // Rotation tracking
  private isInAir          = false;
  private rotationProgress = 0;     // radians since last takeoff (0 → 2π)

  constructor() {
    super({ key: 'GameScene' });
  }

  init(data: { sceneId: string }): void {
    this.sceneId         = data.sceneId;
    this.isDead          = false;
    this.isLevelComplete = false;
    this.jumpPressed     = false;
    this.isInAir         = false;
    this.rotationProgress = 0;
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
    const manifest  = getManifest(this);

    // ── Player ──────────────────────────────────────────────────────────
    const playerGO = registry.byRole('player')[0] as Phaser.GameObjects.Sprite;
    if (!playerGO) return;

    // Give the player sprite a dynamic Arcade body
    this.physics.add.existing(playerGO);
    this.player = playerGO as Phaser.Physics.Arcade.Sprite;

    // Apply the user-authored hitbox from the manifest (set in the Hitbox Editor)
    const playerAsset = manifest.assets.find(
      (a) => a.id === playerGO.getData('assetId'),
    );
    if (playerAsset?.hitbox) {
      applyAssetHitbox(this.player, playerAsset);
    }

    const playerBody = this.player.body as Phaser.Physics.Arcade.Body;
    // Don't clamp to world bounds — the tilemap floor + ceiling provide the limit
    playerBody.setCollideWorldBounds(false);

    // ── Platform collision ───────────────────────────────────────────────
    // Walk all entities with role "platform" and wire solid tile collision.
    // The SDK already called setCollisionByProperty({ solid: true }) on every
    // layer that has tile metadata flagging tiles as solid.
    for (const go of registry.byRole('platform')) {
      const eid = go.getData('entityId') as string | undefined;
      if (eid) addTilemapCollider(this, eid, this.player);
    }

    // ── Spike collision → death ──────────────────────────────────────────
    // addTilemapCollider handles the sub-tile collision rects authored via the
    // Tile Metadata Editor automatically (no extra setCollisionByIndex needed).
    for (const go of registry.byRole('spikes')) {
      const eid = go.getData('entityId') as string | undefined;
      if (eid) {
        addTilemapCollider(this, eid, this.player, () => this.triggerDeath());
      }
    }

    // ── Camera — smooth horizontal follow; Y bounded to scene ───────────
    // lerpX=0.12 gives GD-style smooth horizontal tracking.
    // lerpY=1 (instant) lets the camera bounds lock Y to 0 naturally.
    this.cameras.main.startFollow(this.player, false, 0.12, 1);
    this.cameras.main.setBounds(0, 0, 3200, GAME_HEIGHT);

    // ── Input ────────────────────────────────────────────────────────────
    this.jumpKey = this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.SPACE);
    // Also accept mouse click / screen tap
    this.input.on('pointerdown', () => { this.jumpPressed = true; });
  }

  // ── Jump ─────────────────────────────────────────────────────────────────
  private doJump(): void {
    if (!this.player) return;
    const body = this.player.body as Phaser.Physics.Arcade.Body;
    // Only jump when feet are on a surface
    if (!body.blocked.down) return;

    body.setVelocityY(JUMP_VELOCITY);
    this.isInAir         = true;
    this.rotationProgress = 0;
  }

  // ── Death (spike hit or fell off the world) ───────────────────────────────
  private triggerDeath(): void {
    if (this.isDead || this.isLevelComplete) return;
    this.isDead = true;

    const body = this.player.body as Phaser.Physics.Arcade.Body;
    body.setVelocity(0, 0);
    body.setAllowGravity(false);

    // Brief flash before showing the restart overlay
    this.tweens.add({
      targets: this.player,
      alpha: 0,
      duration: 80,
      yoyo: true,
      repeat: 2,
      onComplete: () => this.showOverlay('You hit a spike!', '#ff4040', 'TRY AGAIN'),
    });
  }

  // ── Level complete ────────────────────────────────────────────────────────
  private triggerLevelComplete(): void {
    if (this.isDead || this.isLevelComplete) return;
    this.isLevelComplete = true;

    const body = this.player.body as Phaser.Physics.Arcade.Body;
    body.setVelocity(0, 0);
    body.setAllowGravity(false);

    // Celebratory scale-pop on the player
    this.tweens.add({
      targets: this.player,
      scaleX: 1.4,
      scaleY: 1.4,
      duration: 180,
      yoyo: true,
      ease: 'Back.easeOut',
      onComplete: () => this.showOverlay('Level Complete! 🎉', '#44ff88', 'PLAY AGAIN'),
    });
  }

  // ── Shared overlay (game-over / win) ─────────────────────────────────────
  private showOverlay(
    message: string,
    color: string,
    buttonLabel: string,
  ): void {
    // Use screen-space positioning with scrollFactor(0) so the overlay is
    // fixed on screen regardless of where the camera ended up.
    const cx = GAME_WIDTH  / 2;
    const cy = GAME_HEIGHT / 2;

    // Semi-transparent dark backdrop
    const overlay = this.add
      .rectangle(cx, cy, GAME_WIDTH, GAME_HEIGHT, 0x000000, 0.65)
      .setScrollFactor(0)
      .setDepth(1000)
      .setAlpha(0);

    // Message text
    const msg = this.add
      .text(cx, cy - 60, message, {
        fontSize: '44px',
        color,
        fontFamily: 'sans-serif',
        fontStyle: 'bold',
        stroke: '#000000',
        strokeThickness: 5,
      })
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setDepth(1001)
      .setAlpha(0);

    // Restart / play-again button
    const btn = this.add
      .text(cx, cy + 30, `▶  ${buttonLabel}`, {
        fontSize: '30px',
        color: '#ffffff',
        fontFamily: 'sans-serif',
        backgroundColor: '#1a44bb',
        padding: { x: 28, y: 14 },
      })
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setDepth(1001)
      .setAlpha(0)
      .setInteractive({ useHandCursor: true });

    btn.on('pointerover', () => btn.setStyle({ backgroundColor: '#3366ee' }));
    btn.on('pointerout',  () => btn.setStyle({ backgroundColor: '#1a44bb' }));
    btn.on('pointerdown', () => {
      this.scene.restart({ sceneId: this.sceneId });
    });

    // Fade everything in together
    this.tweens.add({
      targets: [overlay, msg, btn],
      alpha: 1,
      duration: 350,
      ease: 'Quad.easeOut',
    });
  }

  // ── Game loop ─────────────────────────────────────────────────────────────
  update(_time: number, delta: number): void {
    if (!this.player || this.isDead || this.isLevelComplete) return;

    const body     = this.player.body as Phaser.Physics.Arcade.Body;
    const onGround = body.blocked.down;

    // ── Auto-move right (constant horizontal velocity) ───────────────────
    body.setVelocityX(PLAYER_SPEED);

    // ── Jump input ───────────────────────────────────────────────────────
    const wantsJump = Phaser.Input.Keyboard.JustDown(this.jumpKey) || this.jumpPressed;
    if (wantsJump) this.doJump();
    this.jumpPressed = false;   // consume pointer-tap after one frame

    // ── Rotation — exactly one 360° turn per jump ────────────────────────
    //
    // While the player is airborne AND still has rotation budget left,
    // advance clockwise. Once they've completed one full turn (2π rad)
    // the rotation freezes until they land.
    // On landing, snap instantly to 0° so the cube face is always upright.
    if (!onGround && this.isInAir && this.rotationProgress < Math.PI * 2) {
      const rotDelta  = ROTATION_SPEED * (delta / 1000);
      const remaining = Math.PI * 2 - this.rotationProgress;
      const actual    = Math.min(rotDelta, remaining);
      this.player.rotation += actual;
      this.rotationProgress += actual;
    }

    if (onGround && this.isInAir) {
      // Landed — snap to upright and clear jump state
      this.player.rotation = 0;
      this.isInAir          = false;
      this.rotationProgress = 0;
    }

    // ── Level-end detection ──────────────────────────────────────────────
    // The platform is 50 × 64 px = 3200 px wide. Trigger a little before
    // the last cell so the player doesn't step off empty air.
    if (this.player.x > LEVEL_END_X) {
      this.triggerLevelComplete();
      return;
    }

    // ── Fell off the bottom of the world ────────────────────────────────
    if (this.player.y > GAME_HEIGHT + 120) {
      this.triggerDeath();
    }
  }
}
