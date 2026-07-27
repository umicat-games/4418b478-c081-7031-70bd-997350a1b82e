import Phaser from 'phaser';

// The inventory atlas (region-tagged in the Asset Manager). `frame-medium` is the
// outer panel (9-slice 10/10/11/11), `slot-light` is one item cell (9-slice
// 7/7/8/8). Loaded in BootScene as the `inventory` atlas.
const ATLAS = 'inventory';
const FRAME_PANEL = 'frame-medium';
// Selection is shown by SHADE, not an overlay: unselected cells use the dark
// slot, the selected cell the light one so it reads as lit-up / active.
const FRAME_SLOT = 'slot-dark';
const FRAME_SLOT_SELECTED = 'slot-light';

// Slot art native size (px) and how big we draw it. Integer SLOT_SCALE keeps the
// pixel art crisp; layout() drops below 2 only when the bar wouldn't fit a narrow
// canvas.
const SLOT_W = 30;
const SLOT_H = 32;
const SLOT_SCALE = 2;
const GAP = 8; // px between slots (canvas space)
const PAD_X = 14; // panel padding around the slot row
const PAD_Y = 12;
const MARGIN_BOTTOM = 22; // gap from the canvas bottom edge
const PANEL_SCALE = 2; // 9-slice corner scale for the frame panel


export interface HotbarSlotView {
  /** Atlas key for the tool icon (e.g. 'tools_and_meterials'), omitted = empty. */
  iconKey?: string;
  /** Frame within iconKey (e.g. 'hoe'). */
  iconFrame?: string | number;
  /** Stack size — a count badge shows when > 1. */
  count?: number;
}

export interface HotbarModel {
  slots: (HotbarSlotView | null)[];
  selected: number;
  visible: boolean;
  /** Bumped by GameScene whenever the model changes so we re-render. */
  rev: number;
}

interface SlotBounds {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Bottom-anchored tool hotbar, rendered in its OWN scene (like CursorScene) so it
 * sits at native canvas resolution — unzoomed and unscrolled by the world camera.
 * GameScene owns the MODEL (which slots hold which tools + the selection) and
 * publishes it to the registry under `hotbar`; this scene just draws it and
 * writes each slot's canvas-px hit-box back to `hotbarBounds` so GameScene's
 * pointer-lock click handler can hit-test against the virtual cursor.
 */
export class HotbarScene extends Phaser.Scene {
  private container?: Phaser.GameObjects.Container;
  private lastRev = -1;
  private lastW = -1;
  private lastH = -1;

  constructor() {
    super({ key: 'HotbarScene' });
  }

  create(): void {
    this.container = this.add.container(0, 0);
    this.render();
  }

  update(): void {
    const model = this.model();
    if (!model) return;
    // Re-render when the model changes (select / tool set) or the canvas resizes.
    if (
      model.rev !== this.lastRev ||
      this.scale.width !== this.lastW ||
      this.scale.height !== this.lastH
    ) {
      this.render();
    }
  }

  private model(): HotbarModel | undefined {
    return this.registry.get('hotbar') as HotbarModel | undefined;
  }

  private render(): void {
    const c = this.container;
    const model = this.model();
    if (!c) return;
    c.removeAll(true);
    this.lastRev = model?.rev ?? -1;
    this.lastW = this.scale.width;
    this.lastH = this.scale.height;

    if (!model || !model.visible || model.slots.length === 0) {
      this.registry.set('hotbarBounds', { slots: [], bar: null });
      return;
    }

    const n = model.slots.length;
    // Fit-to-canvas: prefer the crisp integer scale, shrink only if too wide. The
    // row now holds the N tool slots PLUS a backpack cell on the far right (a gap +
    // one more slot), so budget the width for n+1 cells.
    let s = SLOT_SCALE;
    const maxBarW = this.scale.width * 0.94 - PAD_X * 2;
    const wantBarW = (n + 1) * SLOT_W * s + n * GAP;
    if (wantBarW > maxBarW) {
      s = Math.max(1, (maxBarW - n * GAP) / ((n + 1) * SLOT_W));
    }
    const slotW = SLOT_W * s;
    const slotH = SLOT_H * s;
    const barW = n * slotW + (n - 1) * GAP;         // just the tool slots
    const rowW = barW + GAP + slotW;                 // + the backpack cell on the right
    const startX = Math.round((this.scale.width - rowW) / 2);
    const rowY = Math.round(this.scale.height - slotH / 2 - MARGIN_BOTTOM);

    // --- Outer panel (frame-medium, 9-slice-stretched behind the whole row) ---
    const panelW = rowW + PAD_X * 2;
    const panelH = slotH + PAD_Y * 2;
    const panel = this.add.nineslice(
      this.scale.width / 2,
      rowY,
      ATLAS,
      FRAME_PANEL,
      panelW / PANEL_SCALE,
      panelH / PANEL_SCALE,
      10,
      10,
      11,
      11,
    );
    panel.setScale(PANEL_SCALE);
    c.add(panel);

    // --- Slot cells + tool icons + selection marker ---
    const bounds: SlotBounds[] = [];
    for (let i = 0; i < n; i++) {
      const cx = Math.round(startX + i * (slotW + GAP) + slotW / 2);
      const selected = i === model.selected;
      const cy = rowY;

      const cell = this.add
        .image(cx, cy, ATLAS, selected ? FRAME_SLOT_SELECTED : FRAME_SLOT)
        .setScale(s);
      c.add(cell);

      const slot = model.slots[i];
      if (slot?.iconKey && this.textures.exists(slot.iconKey)) {
        const icon = this.add.image(cx, cy, slot.iconKey, slot.iconFrame);
        // Fit the 16px tool icon to ~62% of the cell.
        const iconScale = (slotW * 0.62) / Math.max(icon.width, icon.height);
        icon.setScale(iconScale);
        c.add(icon);
      }

      // Stack count (bottom-right) for stackable items (> 1).
      if (slot?.count && slot.count > 1) {
        const badge = this.add
          .text(cx + slotW / 2 - 4, cy + slotH / 2 - 4, String(slot.count), {
            fontFamily: 'monospace',
            fontSize: `${Math.round(10 * s)}px`,
            color: '#ffffff',
            stroke: '#000000',
            strokeThickness: Math.max(2, Math.round(2 * s)),
          })
          .setOrigin(1, 1);
        c.add(badge);
      }

      // A subtle "1".."9" key hint in each slot's top-left corner.
      const label = this.add
        .text(cx - slotW / 2 + 4, cy - slotH / 2 + 3, String(i + 1), {
          fontFamily: 'monospace',
          fontSize: `${Math.round(9 * s)}px`,
          color: '#f4e4c1',
        })
        .setOrigin(0, 0);
      label.setAlpha(0.75);
      c.add(label);

      bounds.push({ x: cx - slotW / 2, y: cy - slotH / 2, w: slotW, h: slotH });
    }

    // Backpack button — now the RIGHTMOST cell OF the hotbar row (was floating at the
    // screen edge). Opens the full grid (touch has no E key; mouse works too). A
    // `slot-light` cell + a small 2×2 "pouch" glyph.
    const bx = Math.round(startX + barW + GAP + slotW / 2);
    const backpackBtn = this.add.image(bx, rowY, ATLAS, FRAME_SLOT_SELECTED).setScale(s);
    c.add(backpackBtn);
    const g = this.add.graphics();
    g.fillStyle(0x3a2a1a, 0.9);
    const d = Math.round(4 * s); // dot size
    const gap = Math.round(3 * s);
    for (let r = 0; r < 2; r++) {
      for (let col = 0; col < 2; col++) {
        g.fillRect(bx - d - gap / 2 + col * (d + gap), rowY - d - gap / 2 + r * (d + gap), d, d);
      }
    }
    c.add(g);
    const backpack = { x: bx - slotW / 2, y: rowY - slotH / 2, w: slotW, h: slotH };

    // Order button — the `order` frame of the icon-buttons sheet, in the screen's
    // BOTTOM-RIGHT corner (opens the order book). Separate from the hotbar so it
    // stays put as a fixed corner affordance.
    let order: { x: number; y: number; w: number; h: number } | undefined;
    if (this.textures.exists('icon-buttons')) {
      const oSize = 56, om = 18;
      const ox = Math.round(this.scale.width - om - oSize / 2);
      const oy = Math.round(this.scale.height - om - oSize / 2);
      const orderBtn = this.add.image(ox, oy, 'icon-buttons', 'order').setDisplaySize(oSize, oSize);
      c.add(orderBtn);
      order = { x: ox - oSize / 2, y: oy - oSize / 2, w: oSize, h: oSize };
    }

    // Publish hit-boxes (canvas px) for GameScene's click routing. The `bar` rect
    // is the whole hotbar (used to suppress the hoe tile-cursor over the UI).
    const barTop = Math.min(...bounds.map((b) => b.y)) - PAD_Y;
    this.registry.set('hotbarBounds', {
      slots: bounds,
      backpack,
      order,
      bar: {
        x: startX - PAD_X,
        y: barTop,
        w: rowW + PAD_X * 2,
        h: this.scale.height - barTop,
      },
    });
  }
}
