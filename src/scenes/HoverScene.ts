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

/** Contextual tool-palette model, published by GameScene to the `toolPalette` registry key. */
export interface ToolPaletteModel {
  visible: boolean;
  buttons: Array<{ x: number; y: number; size: number; iconKey: string; iconFrame: string | number }>;
}

const HOVER_KEY = 'hover';
const PALETTE_KEY = 'toolPalette';
const BTN_ATLAS = 'square-buttons';      // same slot art the hotbar uses
const BTN_FRAME = 'light-brown-button';
const BTN_NINE: [number, number, number, number] = [6, 6, 7, 7];
const LABEL_BG = 0x2a1c0c;  // dark brown pill behind the name (reads on any background)
const LABEL_TXT = '#fff3d6';// warm cream text (matches the pixel cursor palette)
// The `white-corner-bracket` region in the `ui-sheet` atlas (all_ui_assets_on_one_sheet),
// tagged as a nine-slice in the Asset Manager — 32×32 frame, 14px corners (thin stretchy edges).
const BRACKET_ATLAS = 'ui-sheet';
const BRACKET_FRAME = 'white-corner-bracket';
const BRACKET_SLICE = 14;
const BRACKET_MIN = BRACKET_SLICE * 2; // don't shrink below the two corners (would distort)

/**
 * Empty-hand "inspect" overlay: a white corner-bracket that hugs whatever world object the
 * mouse is over, with the object's NAME on a little pill above it. It ADDS to the normal
 * triangle mouse cursor (CursorScene) — it never replaces or hides it. Screen-space (like
 * CursorScene) so the text + bracket corners stay crisp and the same size at any camera zoom;
 * GameScene computes the projected screen geometry + name and publishes it to `hover`. Mouse-only.
 */
export class HoverScene extends Phaser.Scene {
  private bracket?: Phaser.GameObjects.NineSlice; // the corner frame around a hovered object
  private pill?: Phaser.GameObjects.Graphics;     // the name-label background
  private label?: Phaser.GameObjects.Text;
  private paletteBtns: Array<{ bg: Phaser.GameObjects.NineSlice; icon: Phaser.GameObjects.Image }> = []; // tool-palette button pool

  constructor() { super({ key: 'HoverScene' }); }

  create(): void {
    if (this.textures.exists(BRACKET_ATLAS) && this.textures.get(BRACKET_ATLAS).has(BRACKET_FRAME)) {
      this.bracket = this.add
        .nineslice(0, 0, BRACKET_ATLAS, BRACKET_FRAME, 32, 32, BRACKET_SLICE, BRACKET_SLICE, BRACKET_SLICE, BRACKET_SLICE)
        .setVisible(false);
    }
    this.pill = this.add.graphics();
    const dpr = typeof devicePixelRatio === 'number' ? devicePixelRatio : 1;
    this.label = this.add.text(0, 0, '', {
      fontFamily: 'zpix, sans-serif', fontSize: '15px', color: LABEL_TXT,
    }).setOrigin(0.5, 1).setResolution(Math.min(4, Math.max(2, Math.round(dpr * 2)))).setVisible(false);
    this.scene.bringToTop();
  }

  update(): void {
    this.renderPalette(); // contextual tool palette (independent of the hover bracket)
    const m = this.registry.get(HOVER_KEY) as HoverModel | undefined;
    const pill = this.pill, label = this.label;
    if (!pill || !label) return;
    pill.clear();
    if (!m || !m.visible || !m.onObject) { this.bracket?.setVisible(false); label.setVisible(false); return; }

    // Over an object → the corner-bracket 9-slice hugging it + the name pill above.
    const w = Math.max(BRACKET_MIN, m.w), h = Math.max(BRACKET_MIN, m.h);
    if (this.bracket) this.bracket.setVisible(true).setPosition(m.x, m.y).setSize(w, h);

    label.setText(m.name).setVisible(true).setPosition(m.nameX, m.nameY);
    const pad = 6, bw = label.width + pad * 2, bh = label.height + pad;
    pill.fillStyle(LABEL_BG, 0.78).fillRoundedRect(m.nameX - bw / 2, m.nameY - bh, bw, bh, 5);
    label.setPosition(m.nameX, m.nameY - pad / 2); // sit inside the pill
    this.children.bringToTop(label); // text above its pill
  }

  /** Render the contextual tool palette (a row of slot buttons under a tapped object). */
  private renderPalette(): void {
    const m = this.registry.get(PALETTE_KEY) as ToolPaletteModel | undefined;
    const btns = m?.visible ? m.buttons : [];
    while (this.paletteBtns.length < btns.length) {
      const bg = this.add.nineslice(0, 0, BTN_ATLAS, BTN_FRAME, 30, 30, ...BTN_NINE);
      const icon = this.add.image(0, 0, BTN_ATLAS).setScale(1);
      this.paletteBtns.push({ bg, icon });
    }
    this.paletteBtns.forEach((p, i) => {
      const b = btns[i];
      if (!b) { p.bg.setVisible(false); p.icon.setVisible(false); return; }
      p.bg.setVisible(true).setPosition(b.x, b.y).setSize(b.size, b.size);
      p.icon.setVisible(true).setPosition(b.x, b.y).setTexture(b.iconKey, b.iconFrame);
      const s = (b.size * 0.62) / Math.max(p.icon.width, p.icon.height || 1); // fit the icon in the slot
      p.icon.setScale(s);
      this.children.bringToTop(p.icon);
    });
  }
}
