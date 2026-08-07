import Phaser from 'phaser';

/** Model published by GameScene to the `hover` registry key each frame. Screen-space px. */
export interface HoverModel {
  visible: boolean;
  onObject: boolean;   // true = hugging a nameable object (framed + named); false = a small cursor dot
  x: number; y: number;  // frame centre (onObject) OR cursor point (dot)
  w: number; h: number;  // frame size (onObject only)
  name: string;          // object name (onObject only)
  nameX: number; nameY: number; // label anchor — object top-centre (onObject only)
}

const HOVER_KEY = 'hover';
const RING = 0xffffff;      // the white inspect frame / dot
const LABEL_BG = 0x2a1c0c;  // dark brown pill behind the name (reads on any background)
const LABEL_TXT = '#fff3d6';// warm cream text (matches the pixel cursor palette)

/**
 * Empty-hand "inspect" overlay: a white rounded frame that hugs whatever world object the
 * mouse is over, with the object's NAME on a little pill above it — and a small white ring
 * at the cursor when hovering empty ground. Screen-space (like CursorScene) so the text stays
 * crisp and the same size at any camera zoom; GameScene computes the projected screen geometry
 * + name and publishes it to the `hover` registry key. Mouse-only (touch has no hover).
 */
export class HoverScene extends Phaser.Scene {
  private frame?: Phaser.GameObjects.Graphics;   // the ring / dot
  private pill?: Phaser.GameObjects.Graphics;    // the name-label background
  private label?: Phaser.GameObjects.Text;

  constructor() { super({ key: 'HoverScene' }); }

  create(): void {
    this.frame = this.add.graphics();
    this.pill = this.add.graphics();
    const dpr = typeof devicePixelRatio === 'number' ? devicePixelRatio : 1;
    this.label = this.add.text(0, 0, '', {
      fontFamily: 'zpix, sans-serif', fontSize: '15px', color: LABEL_TXT,
    }).setOrigin(0.5, 1).setResolution(Math.min(4, Math.max(2, Math.round(dpr * 2)))).setVisible(false);
    this.scene.bringToTop();
  }

  update(): void {
    const m = this.registry.get(HOVER_KEY) as HoverModel | undefined;
    const frame = this.frame, pill = this.pill, label = this.label;
    if (!frame || !pill || !label) return;
    frame.clear(); pill.clear();
    if (!m || !m.visible) { label.setVisible(false); return; }

    if (!m.onObject) {
      // Empty ground → a small white ring at the cursor (the empty-hand pointer).
      label.setVisible(false);
      frame.lineStyle(2, RING, 0.9).strokeCircle(m.x, m.y, 5);
      frame.fillStyle(RING, 0.9).fillCircle(m.x, m.y, 1.2);
      return;
    }

    // Over an object → a rounded frame hugging it + the name pill above.
    const x = m.x - m.w / 2, y = m.y - m.h / 2;
    const r = Math.min(10, m.w / 2, m.h / 2);
    frame.lineStyle(2.5, RING, 0.95).strokeRoundedRect(x, y, m.w, m.h, r);

    label.setText(m.name).setVisible(true).setPosition(m.nameX, m.nameY);
    const pad = 6, bw = label.width + pad * 2, bh = label.height + pad;
    pill.fillStyle(LABEL_BG, 0.78).fillRoundedRect(m.nameX - bw / 2, m.nameY - bh, bw, bh, 5);
    label.setPosition(m.nameX, m.nameY - pad / 2); // sit inside the pill
    this.children.bringToTop(label); // text above its pill
  }
}
