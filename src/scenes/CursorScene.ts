import Phaser from 'phaser';

// Must match GameScene's CURSOR_KEY / CURSOR_HOTSPOT.
const CURSOR_KEY = 'cursor';
const CURSOR_HOTSPOT = { x: 0, y: 0 };
const CURSOR_SCALE = 2; // 16px art → 32px on screen (NEAREST keeps it crisp)

/**
 * Top-most overlay that draws the custom pointer-lock cursor ABOVE everything,
 * including the SDK-rendered HUD scene. GameScene owns the lock + virtual-cursor
 * logic and publishes `{ x, y, visible }` to the game registry under `cursor`;
 * this scene just renders it. Lives in its own scene because the HUD is a
 * separate scene rendered on top of GameScene — a cursor drawn in GameScene
 * gets occluded by the HUD.
 */
export class CursorScene extends Phaser.Scene {
  private sprite?: Phaser.GameObjects.Image;

  constructor() {
    super({ key: 'CursorScene' });
  }

  create(): void {
    this.sprite = this.add
      .image(0, 0, this.cursorTexture())
      .setOrigin(CURSOR_HOTSPOT.x, CURSOR_HOTSPOT.y)
      .setScale(CURSOR_SCALE)
      .setVisible(false);
    this.scene.bringToTop();
  }

  update(): void {
    // Stay above the HUD even if it launched after us (loadWorldScene order).
    this.scene.bringToTop();

    const c = this.registry.get('cursor') as
      | { x: number; y: number; visible: boolean }
      | undefined;
    if (!c || !this.sprite) return;

    // Re-assert the hidden OS cursor every frame while we're drawing our own triangle.
    // Interactive HUD controls (e.g. the SDK HUD photo-frame button under Cato's
    // portrait) set `canvas.style.cursor = 'pointer'` on hover via useHandCursor, which
    // would otherwise pop the OS arrow back over our triangle. Cheap — only writes on change.
    const canvas = this.game.canvas;
    if (canvas && c.visible && canvas.style.cursor !== 'none') canvas.style.cursor = 'none';

    this.sprite.setVisible(c.visible);
    if (!c.visible) return;

    // Clamp the SPRITE so the whole cursor stays on-screen (it would clip off
    // the canvas at the far right/bottom edges). The hotspot the GAME reads for
    // edge-scroll/hit-testing is the un-clamped value — the few-px visual
    // difference at the extreme corner is imperceptible.
    const sw = this.sprite.displayWidth;
    const sh = this.sprite.displayHeight;
    const w = this.scale.width;
    const h = this.scale.height;
    const x = Phaser.Math.Clamp(c.x, CURSOR_HOTSPOT.x * sw, w - (1 - CURSOR_HOTSPOT.x) * sw);
    const y = Phaser.Math.Clamp(c.y, CURSOR_HOTSPOT.y * sh, h - (1 - CURSOR_HOTSPOT.y) * sh);
    this.sprite.setPosition(x, y);
  }

  /** Real cursor asset if loaded, else a placeholder arrow. */
  private cursorTexture(): string {
    if (this.textures.exists(CURSOR_KEY)) return CURSOR_KEY;
    if (!this.textures.exists('__cursor_placeholder')) {
      const g = this.add.graphics();
      g.fillStyle(0x2a1c0c, 1).fillTriangle(0, 0, 0, 21, 15, 12);
      g.fillStyle(0xfff3d6, 1).fillTriangle(2.5, 4, 2.5, 16, 11, 11);
      g.generateTexture('__cursor_placeholder', 18, 24);
      g.destroy();
    }
    return '__cursor_placeholder';
  }
}
