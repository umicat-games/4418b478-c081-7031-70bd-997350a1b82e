import Phaser from 'phaser';

/** Model published by GameScene to the `backpackBtn` registry key. */
export interface BackpackBtnModel {
  visible: boolean;
  bagPressed: boolean;
  settingsPressed: boolean;
}

const KEY = 'backpackBtn';
const ATLAS = 'icon-buttons';
const SIZE = 68;      // on-screen button size (px) — a bit bigger than before
const GAP = 10;       // gap between the two buttons
const MARGIN = 16;    // gap from the canvas bottom-right corner

/**
 * The bottom-right corner HUD buttons: BACKPACK (`sprout-up`) on the left + SETTINGS (`settings`)
 * on the right (each shows its `-pressed-down` frame while pressed). Native-px overlay like
 * CursorScene so it's unzoomed. GameScene owns the model + tap routing (this scene publishes each
 * button's hit rect); tapping the sprout opens the backpack, the gear opens Settings.
 */
export class BackpackButtonScene extends Phaser.Scene {
  private bag?: Phaser.GameObjects.Image;
  private settings?: Phaser.GameObjects.Image;

  constructor() { super({ key: 'BackpackButtonScene' }); }

  create(): void {
    this.bag = this.add.image(0, 0, ATLAS, 'sprout-up').setVisible(false);
    this.settings = this.add.image(0, 0, ATLAS, 'settings').setVisible(false);
    this.layout();
    this.scale.on('resize', () => this.layout());
    this.scene.bringToTop();
  }

  update(): void {
    const m = this.registry.get(KEY) as BackpackBtnModel | undefined;
    if (!this.bag || !this.settings) return;
    if (!m || !m.visible) { this.bag.setVisible(false); this.settings.setVisible(false); return; }
    this.bag.setVisible(true).setFrame(m.bagPressed ? 'sprout-up-pressed-down' : 'sprout-up');
    this.settings.setVisible(true).setFrame(m.settingsPressed ? 'settings-pressed-down' : 'settings');
  }

  /** Place both buttons at the bottom-right (settings in the corner, backpack to its left) +
   *  publish their screen hit rects for GameScene routing. */
  private layout(): void {
    if (!this.bag || !this.settings) return;
    const setCx = this.scale.width - MARGIN - SIZE / 2;         // settings = rightmost (corner)
    const bagCx = setCx - SIZE - GAP;                            // backpack to its left
    const cy = this.scale.height - MARGIN - SIZE / 2;
    this.bag.setPosition(bagCx, cy).setScale(SIZE / Math.max(this.bag.width, this.bag.height));
    this.settings.setPosition(setCx, cy).setScale(SIZE / Math.max(this.settings.width, this.settings.height));
    this.registry.set('backpackBtnBounds', { x: bagCx - SIZE / 2, y: cy - SIZE / 2, w: SIZE, h: SIZE });
    this.registry.set('settingsBtnBounds', { x: setCx - SIZE / 2, y: cy - SIZE / 2, w: SIZE, h: SIZE });
  }
}
