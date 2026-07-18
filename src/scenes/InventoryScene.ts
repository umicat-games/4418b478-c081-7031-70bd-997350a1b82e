import Phaser from 'phaser';

// Shares the inventory atlas + slot art with HotbarScene. `frame-medium` is the
// outer panel; slot-dark / slot-light are the empty / selected cell shades.
const ATLAS = 'inventory';
const FRAME_PANEL = 'frame-medium';
const FRAME_SLOT = 'slot-dark';
const FRAME_SLOT_SELECTED = 'slot-light';

const SLOT = 30; // native cell art px
const SLOT_H = 32;
const SLOT_SCALE = 2;
const GAP = 8; // px between cells (canvas space)
const PAD = 18; // panel padding around the grid
const PANEL_SCALE = 2; // 9-slice corner scale

interface CellView {
  iconKey?: string;
  iconFrame?: string;
  count?: number;
}

interface InventoryModel {
  open: boolean;
  cols: number;
  rows: number;
  cells: (CellView | null)[];
  selected: number; // selected row-0 cell (highlighted), or -1
  held: CellView | null; // stack picked up, follows the cursor
  rev: number;
}

interface CellBounds {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * The full backpack grid (Stardew-style), opened with E. Rendered in its own
 * scene at native canvas resolution (like HotbarScene / CursorScene) so it's
 * unzoomed. GameScene owns the item model + click logic; this scene draws the
 * grid + the held stack (which follows the cursor) and writes each cell's
 * canvas-px hit-box to `inventoryBounds` for click routing.
 */
export class InventoryScene extends Phaser.Scene {
  private grid?: Phaser.GameObjects.Container;
  private held?: Phaser.GameObjects.Container;
  private lastRev = -1;
  private lastW = -1;
  private lastH = -1;

  constructor() {
    super({ key: 'InventoryScene' });
  }

  create(): void {
    this.grid = this.add.container(0, 0);
    this.held = this.add.container(0, 0);
    this.render();
  }

  update(): void {
    const model = this.model();
    if (
      (model?.rev ?? -1) !== this.lastRev ||
      this.scale.width !== this.lastW ||
      this.scale.height !== this.lastH
    ) {
      this.render();
    }
    // The held stack follows the cursor every frame (no full re-render).
    if (this.held && model?.open && model.held) {
      const c = this.registry.get('cursor') as { x: number; y: number } | undefined;
      // Show the held stack ABOVE the pointer so a finger doesn't cover it.
      if (c) this.held.setPosition(c.x, c.y - 30);
    }
  }

  private model(): InventoryModel | undefined {
    return this.registry.get('inventory') as InventoryModel | undefined;
  }

  private render(): void {
    const model = this.model();
    if (!this.grid || !this.held) return;
    this.grid.removeAll(true);
    this.held.removeAll(true);
    this.lastRev = model?.rev ?? -1;
    this.lastW = this.scale.width;
    this.lastH = this.scale.height;

    if (!model || !model.open) {
      this.registry.set('inventoryBounds', { cells: [] });
      return;
    }

    const { cols, rows } = model;
    const slotW = SLOT * SLOT_SCALE;
    const slotH = SLOT_H * SLOT_SCALE;
    const gridW = cols * slotW + (cols - 1) * GAP;
    const gridH = rows * slotH + (rows - 1) * GAP;
    const cx = this.scale.width / 2;
    const cy = this.scale.height / 2;
    const startX = Math.round(cx - gridW / 2);
    const startY = Math.round(cy - gridH / 2);

    // Dim backdrop → the grid reads as a modal.
    const scrim = this.add
      .rectangle(0, 0, this.scale.width, this.scale.height, 0x000000, 0.45)
      .setOrigin(0, 0);
    this.grid.add(scrim);

    // Outer panel (frame-medium, 9-sliced behind the whole grid).
    const panelW = gridW + PAD * 2;
    const panelH = gridH + PAD * 2;
    const panel = this.add.nineslice(
      cx,
      cy,
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
    this.grid.add(panel);

    // Cells + icons + counts.
    const bounds: CellBounds[] = [];
    for (let i = 0; i < model.cells.length; i++) {
      const col = i % cols;
      const row = Math.floor(i / cols);
      const px = Math.round(startX + col * (slotW + GAP) + slotW / 2);
      const py = Math.round(startY + row * (slotH + GAP) + slotH / 2);
      const selected = i === model.selected;

      const cell = this.add
        .image(px, py, ATLAS, selected ? FRAME_SLOT_SELECTED : FRAME_SLOT)
        .setScale(SLOT_SCALE);
      this.grid.add(cell);
      this.drawStack(this.grid, px, py, slotW, slotH, model.cells[i]);

      bounds.push({ x: px - slotW / 2, y: py - slotH / 2, w: slotW, h: slotH });
    }

    // A small hint above the grid.
    const hint = this.add
      .text(cx, startY - PAD - 14, 'Backpack — E / Esc to close', {
        fontFamily: 'monospace',
        fontSize: '16px',
        color: '#f4e4c1',
      })
      .setOrigin(0.5, 1);
    hint.setAlpha(0.85);
    this.grid.add(hint);

    // Held stack (built here, positioned each frame in update()).
    if (model.held) {
      this.drawStack(this.held, 0, 0, slotW, slotH, model.held);
    }

    this.registry.set('inventoryBounds', { cells: bounds });
  }

  /** Draw an item icon + count badge centred at (px,py) into `container`. */
  private drawStack(
    container: Phaser.GameObjects.Container,
    px: number,
    py: number,
    slotW: number,
    slotH: number,
    view: CellView | null,
  ): void {
    if (!view) return;
    if (view.iconKey && this.textures.exists(view.iconKey)) {
      const icon = this.add.image(px, py, view.iconKey, view.iconFrame);
      icon.setScale((slotW * 0.62) / Math.max(icon.width, icon.height));
      container.add(icon);
    }
    if (view.count && view.count > 1) {
      const badge = this.add
        .text(px + slotW / 2 - 4, py + slotH / 2 - 4, String(view.count), {
          fontFamily: 'monospace',
          fontSize: '20px',
          color: '#ffffff',
          stroke: '#000000',
          strokeThickness: 4,
        })
        .setOrigin(1, 1);
      container.add(badge);
    }
  }
}
