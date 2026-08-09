import Phaser from 'phaser';

/** Model published by GameScene to the `hover` registry key each frame. Screen-space px. */
export interface HoverModel {
  visible: boolean;
  onObject: boolean;   // true = draw the corner-bracket frame (object OR empty tile)
  x: number; y: number;  // frame centre (screen px)
  w: number; h: number;  // frame size (screen px, already × zoom)
  z: number;             // camera zoom — the bracket corners render at 8×z so they MATCH the world-space tool cursor
  name: string;          // object name ('' = no label, e.g. empty grass / while the wheel is open)
  nameX: number; nameY: number; // label anchor — object top-centre (name only)
}

/** Contextual tool-wheel model, published by GameScene to the `toolPalette` registry key. */
export interface ToolPaletteModel {
  visible: boolean;
  buttons: Array<{ x: number; y: number; size: number; iconKey: string; iconFrame: string | number; kind: string; hovered: boolean }>;
}

const HOVER_KEY = 'hover';
const PALETTE_KEY = 'toolPalette';
const CIRCLE_BG = 'tool-circle-bg';            // the round tool-button background (16×16, scaled)
const CIRCLE_BG_SEL = 'tool-circle-bg-selected'; // the hovered/selected circle (blue ring)
const LABEL_BG = 0x2a1c0c;  // dark brown pill behind the name (reads on any background)
const LABEL_TXT = '#fff3d6';// warm cream text (matches the pixel cursor palette)
// The hover bracket uses the SAME art as the tool tile-cursor (`tile_select_cursor.png`, 24×24 —
// four L-shaped corner marks with ~8px arms). Drawn as a nine-slice (8px corners, stretchy
// transparent edges) so the four corners hug ANY-size object bbox, and SCALED by the camera zoom
// so the corner marks render at exactly `8×zoom` — identical to the world-space tool cursor. This
// makes the empty-hand "inspect" frame and the "holding a tool" frame look the same (the user
// asked for consistent corner size).
const BRACKET_TEX = 'tile-select';
const BRACKET_SLICE = 10;           // corner size in the 24×24 texture (contains each thin L-mark, extent ≤10)
const BRACKET_MIN = BRACKET_SLICE * 2; // don't shrink below the two corners (local units, pre-scale)

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
  private paletteBtns: Array<{ bg: Phaser.GameObjects.Image; icon: Phaser.GameObjects.Image }> = []; // tool-wheel circle pool

  constructor() { super({ key: 'HoverScene' }); }

  create(): void {
    if (this.textures.exists(BRACKET_TEX)) {
      this.bracket = this.add
        .nineslice(0, 0, BRACKET_TEX, undefined, 24, 24, BRACKET_SLICE, BRACKET_SLICE, BRACKET_SLICE, BRACKET_SLICE)
        .setOrigin(0.5, 0.5)
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

    // The corner-bracket 9-slice hugging the object/tile + the name pill above. The nine-slice is
    // SCALED by the camera zoom so its 8px corner marks render at 8×zoom — matching the world-space
    // tool cursor exactly; `setSize` is therefore in PRE-scale (local) units, so divide the screen
    // size by z.
    const z = m.z && m.z > 0 ? m.z : 1;
    const w = Math.max(BRACKET_MIN * z, m.w), h = Math.max(BRACKET_MIN * z, m.h);
    if (this.bracket) this.bracket.setVisible(true).setScale(z).setPosition(m.x, m.y).setSize(w / z, h / z);

    if (!m.name) { label.setVisible(false); return; } // name blanked (e.g. while the wheel is open)
    label.setText(m.name).setVisible(true).setPosition(m.nameX, m.nameY);
    const pad = 6, bw = label.width + pad * 2, bh = label.height + pad;
    pill.fillStyle(LABEL_BG, 0.78).fillRoundedRect(m.nameX - bw / 2, m.nameY - bh, bw, bh, 5);
    label.setPosition(m.nameX, m.nameY - pad / 2); // sit inside the pill
    this.children.bringToTop(label); // text above its pill
  }

  /** Render the contextual tool wheel — a ring of round tool circles around a tapped spot,
   *  each `tool-circle-bg` + the tool icon; the hovered one gets a pale-blue tint (until the
   *  dedicated `-selected` background lands). The centre circle is the mouse (close) button. */
  private renderPalette(): void {
    const m = this.registry.get(PALETTE_KEY) as ToolPaletteModel | undefined;
    const btns = m?.visible ? m.buttons : [];
    while (this.paletteBtns.length < btns.length) {
      const bg = this.add.image(0, 0, CIRCLE_BG);
      const icon = this.add.image(0, 0, CIRCLE_BG);
      this.paletteBtns.push({ bg, icon });
    }
    this.paletteBtns.forEach((p, i) => {
      const b = btns[i];
      if (!b) { p.bg.setVisible(false); p.icon.setVisible(false); return; }
      // empty  = a slot with no owned tool → faded circle, no icon.
      // disabled = an owned tool that doesn't apply here → circle + greyed icon, not tappable.
      const empty = b.kind === 'empty', disabled = b.kind === 'disabled';
      p.bg.setVisible(true).setPosition(b.x, b.y).setDisplaySize(b.size, b.size)
        .setAlpha(empty ? 0.5 : disabled ? 0.85 : 1).setTexture(b.hovered ? CIRCLE_BG_SEL : CIRCLE_BG); // hover → blue-ring bg
      if (empty || !b.iconKey) { p.icon.setVisible(false); return; }
      p.icon.setVisible(true).setPosition(b.x, b.y).setTexture(b.iconKey, b.iconFrame);
      if (disabled) p.icon.setTint(0x555555).setAlpha(0.45); else p.icon.clearTint().setAlpha(1); // grey out inapplicable tools
      const fill = b.kind === 'close' ? 0.56 : 0.72; // bigger tool icons than before
      p.icon.setScale((b.size * fill) / Math.max(p.icon.width, p.icon.height || 1));
      this.children.bringToTop(p.icon);
    });
  }
}
