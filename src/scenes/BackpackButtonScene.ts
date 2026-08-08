import Phaser from 'phaser';

/** Model published by GameScene to the `backpackBtn` registry key. */
export interface BackpackBtnModel {
  visible: boolean;
  pressed: boolean;
}

const KEY = 'backpackBtn';
const ATLAS = 'icon-buttons';
const FRAME = 'sprout-up';
const FRAME_PRESSED = 'sprout-up-pressed-down';
const SIZE = 52;      // on-screen button size (px)
const MARGIN = 16;    // gap from the canvas bottom-right corner

/**
 * The bottom-right BACKPACK button (a `sprout-up` icon; `sprout-up-pressed-down` while pressed).
 * Native-px overlay like CursorScene so it's unzoomed. GameScene owns the model + tap routing
 * (it publishes `backpackBtnBounds` isn't needed — this scene publishes its own hit rect); tapping
 * it opens the backpack. Replaces the old hotbar backpack cell now that the hotbar is gone.
 */
export class BackpackButtonScene extends Phaser.Scene {
  private img?: Phaser.GameObjects.Image;

  constructor() { super({ key: 'BackpackButtonScene' }); }

  create(): void {
    this.img = this.add.image(0, 0, ATLAS, FRAME).setVisible(false);
    this.layout();
    this.scale.on('resize', () => this.layout());
    this.scene.bringToTop();
  }

  update(): void {
    const m = this.registry.get(KEY) as BackpackBtnModel | undefined;
    const img = this.img;
    if (!img) return;
    if (!m || !m.visible) { img.setVisible(false); return; }
    img.setVisible(true).setFrame(m.pressed ? FRAME_PRESSED : FRAME);
  }

  /** Place the button at the bottom-right + publish its screen hit rect for GameScene routing. */
  private layout(): void {
    const img = this.img;
    if (!img) return;
    const cx = this.scale.width - MARGIN - SIZE / 2;
    const cy = this.scale.height - MARGIN - SIZE / 2;
    img.setPosition(cx, cy).setScale(SIZE / Math.max(img.width, img.height));
    this.registry.set('backpackBtnBounds', { x: cx - SIZE / 2, y: cy - SIZE / 2, w: SIZE, h: SIZE });
  }
}
