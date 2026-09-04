import Phaser from 'phaser';
import { applyHudDpr, hudDpr, hudLogicalW, hudLogicalH } from '../dpi';

/** Model published by GameScene to the `backpackBtn` registry key. */
export interface BackpackBtnModel {
  visible: boolean;
  bagPressed: boolean;
  settingsPressed: boolean;
  shopPressed: boolean;
}

const KEY = 'backpackBtn';
const ATLAS = 'icon-buttons';
const SIZE = 68;      // on-screen button size (px) — a bit bigger than before
const GAP = 10;       // gap between the two buttons
const MARGIN = 16;    // gap from the canvas bottom-right corner

/**
 * The bottom-right corner HUD buttons (right→left): MENU (`paw`) in the corner, BACKPACK
 * (`sprout-up`), and SHOP (`order` tablet). Native-px overlay like CursorScene so it's unzoomed.
 * GameScene owns the model + tap routing (this scene publishes each button's hit rect); the paw
 * opens the tabbed menu, the sprout opens the backpack, the tablet opens the Shop (so shopping is
 * always reachable outside — the mailbox/chest stay at the house door).
 */
export class BackpackButtonScene extends Phaser.Scene {
  private bag?: Phaser.GameObjects.Image;
  private settings?: Phaser.GameObjects.Image;
  private shop?: Phaser.GameObjects.Image;

  constructor() { super({ key: 'BackpackButtonScene' }); }

  create(): void {
    applyHudDpr(this); // high-DPI: render in logical space via a dpr camera
    this.bag = this.add.image(0, 0, ATLAS, 'sprout-up').setVisible(false);
    this.settings = this.add.image(0, 0, ATLAS, 'paw').setVisible(false);
    this.shop = this.add.image(0, 0, ATLAS, 'order').setVisible(false); // the shop/order tablet
    this.layout();
    this.scale.on('resize', () => { applyHudDpr(this); this.layout(); });
    this.scene.bringToTop();
  }

  update(): void {
    const m = this.registry.get(KEY) as BackpackBtnModel | undefined;
    if (!this.bag || !this.settings || !this.shop) return;
    if (!m || !m.visible) { this.bag.setVisible(false); this.settings.setVisible(false); this.shop.setVisible(false); return; }
    this.bag.setVisible(true).setFrame(m.bagPressed ? 'sprout-up-pressed-down' : 'sprout-up');
    this.settings.setVisible(true).setFrame(m.settingsPressed ? 'paw-pressed' : 'paw');
    // `order` has no pressed frame → a brief dim tint is the press feedback.
    this.shop.setVisible(true).setTint(m.shopPressed ? 0xbbbbbb : 0xffffff);
  }

  /** Place the three buttons at the bottom-right (paw in the corner, backpack, then shop to its
   *  left) + publish each screen hit rect for GameScene routing. */
  private layout(): void {
    if (!this.bag || !this.settings || !this.shop) return;
    // Render in LOGICAL space (dpr camera); anchor to the logical viewport.
    const LW = hudLogicalW(this), LH = hudLogicalH(this);
    const setCx = LW - MARGIN - SIZE / 2;         // paw menu = rightmost (corner)
    const bagCx = setCx - SIZE - GAP;             // backpack to its left
    const shopCx = bagCx - SIZE - GAP;            // shop tablet to the backpack's left
    const cy = LH - MARGIN - SIZE / 2;
    this.bag.setPosition(bagCx, cy).setScale(SIZE / Math.max(this.bag.width, this.bag.height));
    this.settings.setPosition(setCx, cy).setScale(SIZE / Math.max(this.settings.width, this.settings.height));
    this.shop.setPosition(shopCx, cy).setScale(SIZE / Math.max(this.shop.width, this.shop.height));
    // GameScene hit-tests DEVICE-px pointer coords against these rects, so publish in
    // device px (logical × dpr) — the rendering stays logical, the routing stays device.
    const d = hudDpr(this);
    const rect = (cx: number) => ({ x: (cx - SIZE / 2) * d, y: (cy - SIZE / 2) * d, w: SIZE * d, h: SIZE * d });
    this.registry.set('backpackBtnBounds', rect(bagCx));
    this.registry.set('settingsBtnBounds', rect(setCx));
    this.registry.set('shopBtnBounds', rect(shopCx));
  }
}
