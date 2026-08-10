import Phaser from 'phaser';
import { dialogFont } from '../i18n';

// Harvest toast — a cream pill at the bottom-centre naming what you just picked
// ("Star Fruit x 4"), which lingers a moment then fades. GameScene owns the model
// (`harvestToast`) and ACCUMULATES the count while you keep harvesting the SAME
// item (a field of corn ticks up "Corn x1 → x2 → …"); this scene just renders it.
// Background = the `slot-light` 9-slice from the inventory atlas (same cell art as
// the hotbar / bag), so it matches the rest of the UI. Native-px overlay scene.
const ATLAS = 'inventory';
const FRAME = 'slot-light';
const SLICE = { l: 7, r: 7, t: 8, b: 8 }; // slot-light 9-slice insets (Asset Manager tags, per MenuScene)
const CORNER_SCALE = 3;                    // draw the 9-slice at 3× → chunky rounded pill, corners stay crisp
const FS = 26;                             // text size
const PAD_X = 48, PAD_Y = 26;              // text inset inside the pill
const BOTTOM = 150;                        // pill centre y = H - BOTTOM (clears the hotbar above it)
const INK = '#ffffff', STROKE = '#7a5c34';
// DPI-aware text resolution so the pixel font stays crisp on high-DPI tablets.
const RES = Math.min(8, Math.max(3, Math.round((typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1) * 3)));

interface ToastModel { visible: boolean; rev: number; text?: string; }

export class HarvestToastScene extends Phaser.Scene {
  private lastRev = -1;
  private root?: Phaser.GameObjects.Container;
  private box?: Phaser.GameObjects.NineSlice;
  private label?: Phaser.GameObjects.Text;

  constructor() { super({ key: 'HarvestToastScene' }); }

  create(): void {
    this.scale.on(Phaser.Scale.Events.RESIZE, this.reposition, this);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.scale.off(Phaser.Scale.Events.RESIZE, this.reposition, this));
  }

  update(): void {
    const m = this.registry.get('harvestToast') as ToastModel | undefined;
    if (!m || m.rev === this.lastRev) return;
    this.lastRev = m.rev;
    if (m.visible && m.text) this.showOrUpdate(m.text);
    else this.hide();
  }

  /** Recompute the pill centre (bottom-centre); called on RESIZE (not per frame, so it
   *  never fights the pop-in y-tween). */
  private reposition(): void {
    if (this.root) this.root.setPosition(this.scale.width / 2, this.scale.height - BOTTOM);
  }

  /** Size the pill to fit `text` (9-slice stretches; corners keep native size × CORNER_SCALE). */
  private layout(text: string): void {
    if (!this.label || !this.box) return;
    this.label.setText(text);
    const boxW = Math.ceil(this.label.width) + PAD_X * 2;
    const boxH = Math.max(FS + PAD_Y * 2, Math.ceil(this.label.height) + PAD_Y * 2);
    this.box.setSize(boxW / CORNER_SCALE, boxH / CORNER_SCALE);
  }

  private showOrUpdate(text: string): void {
    if (this.root && this.box && this.label) {
      // Already on screen → update the text/count in place + a quick pulse (no re-pop),
      // so a running harvest ("Corn x1 → x2 → …") reads as one growing tally.
      this.layout(text);
      this.tweens.killTweensOf(this.root);
      this.root.setScale(1).setAlpha(1);
      this.tweens.add({ targets: this.root, scale: 1.08, duration: 90, yoyo: true, ease: 'Quad.easeOut' });
      return;
    }
    // Fresh pill.
    this.root?.destroy();
    const cx = this.scale.width / 2, cy = this.scale.height - BOTTOM;
    const c = this.add.container(cx, cy).setDepth(60);
    this.root = c;
    const box = this.add.nineslice(0, 0, ATLAS, FRAME, 10, 10, SLICE.l, SLICE.r, SLICE.t, SLICE.b).setScale(CORNER_SCALE);
    this.box = box;
    c.add(box);
    const label = this.add.text(0, 0, '', { fontFamily: dialogFont(), fontSize: FS + 'px', color: INK, resolution: RES }).setOrigin(0.5);
    label.setStroke(STROKE, 4);
    this.label = label;
    c.add(label);
    this.layout(text);
    // Pop in from just below (fade + rise + slight overshoot).
    c.setAlpha(0).setScale(0.9);
    c.y = cy + 14;
    this.tweens.add({ targets: c, alpha: 1, scale: 1, y: cy, duration: 240, ease: 'Back.easeOut' });
  }

  private hide(): void {
    const root = this.root;
    this.root = undefined; this.box = undefined; this.label = undefined;
    if (!root) return;
    this.tweens.killTweensOf(root);
    this.tweens.add({ targets: root, alpha: 0, y: root.y + 10, duration: 200, ease: 'Quad.easeIn', onComplete: () => root.destroy() });
  }
}
