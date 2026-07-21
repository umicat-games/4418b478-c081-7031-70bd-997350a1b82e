import Phaser from 'phaser';

// The build palette for choosing a WALL facing — a contextual 3×3 grid that pops
// up AROUND the cell you clicked to build on (the 8 cells mirror the nine-slice:
// tap the top cell = top wall, a corner = that corner, etc.; the centre is the
// target cell = place the DEFAULT). Pure UI, so it works on touch and is
// discoverable. GameScene owns the model (`buildPalette` registry key) and this
// scene renders it + writes cell hit-boxes to `buildPaletteBounds`.
//
// The ring cells EXPAND out from the centre on open. On a PICK the chosen cell
// flashes (highlight + pop), holds a beat, then everything SHRINKS back into the
// centre; a cancel skips the flash and shrinks straight away.
const ATLAS = 'inventory';
const FRAME_SLOT = 'slot-dark';
const FRAME_SLOT_SELECTED = 'slot-light';

const CELL = 46;      // ring cell size (px)
const RING_MIN = 58;  // min distance from centre to a ring cell's centre
const GAP = 6;        // clearance between the centre bracket and the ring cells
const OPEN_MS = 200;  // ring expand duration
const CLOSE_MS = 140; // ring shrink duration
const FLASH_MS = 110; // chosen-cell pop duration
const HOLD_MS = 200;  // pause after the pick flash, before the shrink
const HILITE = 0xffd98a; // warm tint for the selected / chosen cell
const HOVER = 0xa8e063;  // green tint for the cell under the cursor
const NO_TINT = 0xffffff; // identity tint (base cell look)

/** One palette cell: the wall orientation it selects + the sheet frame to show.
 *  `center` = the middle cell (the DEFAULT / last-used facing), drawn with the tile
 *  bracket (圆角框) so tapping it = "place the default here". */
export interface PaletteCell {
  orient: string;
  iconKey: string;
  frame: number;
  center?: boolean;
}
const BRACKET = 'tile-select'; // the rounded tile bracket (圆角框)
const BUTTON = 'square-buttons';   // rounded-square UI button sheet
const BUTTON_FRAME = 'white-button'; // the region-tagged frame (nine-patch)

export interface PaletteModel {
  visible: boolean;
  screenX: number; // centre (canvas px) — the target cell on screen
  screenY: number;
  selected: string; // last-used facing (highlighted as the default)
  cells: (PaletteCell | null)[]; // 9, row-major; null = the centre (target cell)
  bracketPx?: number; // on-screen size of the centre 圆角框 (= the hover bracket size)
  chosen?: number; // on close: the picked cell index (flash it), or undefined = cancel
  rev: number;
}

interface CellObj {
  idx: number;
  center: boolean;
  cont: Phaser.GameObjects.Container;
  bg?: Phaser.GameObjects.GameObject & { setTint?: (c: number) => unknown };
  baseTint: number; // the cell's resting tint (HILITE if it's the selected facing)
}

export class PaletteScene extends Phaser.Scene {
  private lastRev = -1;
  private shown = false;
  private dim?: Phaser.GameObjects.Rectangle;
  private cells: CellObj[] = [];
  private cxC = 0;
  private cyC = 0;
  private hoverIdx = -1;
  private centreIcon?: Phaser.GameObjects.Image;
  private centreDefaultFrame: number | string = 0;

  constructor() {
    super({ key: 'PaletteScene' });
  }

  update(): void {
    const m = this.model();
    if (!m) return;
    if (m.rev !== this.lastRev) {
      this.lastRev = m.rev;
      if (m.visible) this.open(m);
      else this.close(m.chosen);
    }
    if (this.shown) this.updateHover(m);
  }

  /** React to the cursor moving over a ring cell (published by GameScene as
   *  `buildPaletteHover`): tint that button green + show its facing in the centre. */
  private updateHover(model: PaletteModel): void {
    const hov = (this.registry.get('buildPaletteHover') as number | undefined) ?? -1;
    if (hov === this.hoverIdx) return;
    // Restore the previously-hovered ring cell to its resting tint.
    const prev = this.cells.find((c) => c.idx === this.hoverIdx && !c.center);
    prev?.bg?.setTint?.(prev.baseTint);
    this.hoverIdx = hov;
    // Highlight the newly-hovered ring cell (centre isn't a button → no tint).
    const cur = this.cells.find((c) => c.idx === hov && !c.center);
    cur?.bg?.setTint?.(HOVER);
    // Preview the hovered facing in the centre bracket (revert to default when the
    // cursor is off the ring or over the centre).
    const cell = cur ? model.cells[hov] : undefined;
    this.centreIcon?.setFrame(cell ? cell.frame : this.centreDefaultFrame);
  }

  private model(): PaletteModel | undefined {
    return this.registry.get('buildPalette') as PaletteModel | undefined;
  }

  /** Tear everything down immediately (used when re-opening mid-animation). */
  private clearNow(): void {
    this.tweens.killAll();
    this.time.removeAllEvents(); // cancel a pending hold→shrink
    this.cells.forEach((o) => o.cont.destroy());
    this.cells = [];
    this.dim?.destroy();
    this.dim = undefined;
  }

  private open(model: PaletteModel): void {
    this.clearNow();
    this.shown = true;
    this.hoverIdx = -1;
    this.centreIcon = undefined;
    this.registry.set('buildPaletteHover', -1);

    // The centre bracket keeps its natural size; the ring spreads out far enough to
    // clear it (so a big bracket doesn't get overlapped by the ring cells).
    const bracketPx = model.bracketPx ?? CELL + 4;
    const RING = Math.max(RING_MIN, bracketPx / 2 + GAP + CELL / 2);

    // Clamp the centre so the whole 3×3 stays on-screen.
    const half = RING + CELL / 2 + 4;
    const cxC = Phaser.Math.Clamp(model.screenX, half, this.scale.width - half);
    const cyC = Phaser.Math.Clamp(model.screenY, half, this.scale.height - half);
    this.cxC = cxC;
    this.cyC = cyC;

    // A faint dim backdrop so the palette reads as a focused menu (fade in).
    this.dim = this.add.rectangle(0, 0, this.scale.width, this.scale.height, 0x000000, 0).setOrigin(0, 0);
    this.tweens.add({ targets: this.dim, alpha: 0.28, duration: OPEN_MS });

    // Centre hit-area is the bracket, capped so it never overlaps a ring cell.
    const chit = Math.min(bracketPx, 2 * (RING - CELL / 2) - 4);

    const bounds: Array<{ orient: string; idx: number; x: number; y: number; w: number; h: number }> = [];
    model.cells.forEach((cell, i) => {
      if (!cell) return;
      const col = (i % 3) - 1; // -1,0,1
      const row = Math.floor(i / 3) - 1;
      const fx = Math.round(cxC + col * RING);
      const fy = Math.round(cyC + row * RING);
      const built = this.buildCell(cell, model, bracketPx);
      const baseTint = !cell.center && cell.orient === model.selected ? HILITE : NO_TINT;
      this.cells.push({ idx: i, center: !!cell.center, cont: built.cont, bg: built.bg, baseTint });

      if (cell.center) {
        // The anchor — no expand tween. Tapping it places the default. Its icon is
        // swapped to preview whatever ring cell the cursor hovers.
        this.centreIcon = built.icon;
        this.centreDefaultFrame = cell.frame;
        built.cont.setPosition(fx, fy);
        bounds.push({ orient: cell.orient, idx: i, x: fx - chit / 2, y: fy - chit / 2, w: chit, h: chit });
      } else {
        // A ring cell starts collapsed AT the centre and springs out to its slot.
        built.cont.setPosition(cxC, cyC).setScale(0);
        this.tweens.add({
          targets: built.cont, x: fx, y: fy, scale: 1, duration: OPEN_MS, ease: 'Back.easeOut', delay: i * 10,
        });
        // Hit-box uses the FINAL slot position so a fast tap lands even mid-expand.
        bounds.push({ orient: cell.orient, idx: i, x: fx - CELL / 2, y: fy - CELL / 2, w: CELL, h: CELL });
      }
    });

    this.registry.set('buildPaletteBounds', bounds);
  }

  private close(chosen?: number): void {
    // Cancel taps right away.
    this.registry.set('buildPaletteBounds', []);
    if (!this.shown) {
      this.clearNow();
      return;
    }
    this.shown = false;

    const picked = chosen != null ? this.cells.find((c) => c.idx === chosen) : undefined;
    if (!picked) {
      this.shrink();
      return;
    }
    // Confirm feedback: flash the chosen cell (highlight tint + pop), bring it above
    // its neighbours, hold a beat, THEN shrink everything.
    picked.bg?.setTint?.(HILITE);
    this.children.bringToTop(picked.cont);
    this.tweens.add({ targets: picked.cont, scale: 1.28, duration: FLASH_MS, ease: 'Back.easeOut' });
    this.time.delayedCall(FLASH_MS + HOLD_MS, () => this.shrink());
  }

  /** Collapse every cell back into the centre + fade the backdrop, then destroy. */
  private shrink(): void {
    const { cxC, cyC } = this;
    this.cells.forEach((c, i) => {
      this.tweens.add({
        targets: c.cont, x: cxC, y: cyC, scale: 0, duration: CLOSE_MS, ease: 'Back.easeIn', delay: i * 4,
        onComplete: () => c.cont.destroy(),
      });
    });
    this.cells = [];
    if (this.dim) {
      this.tweens.add({
        targets: this.dim, alpha: 0, duration: CLOSE_MS + 20,
        onComplete: () => {
          this.dim?.destroy();
          this.dim = undefined;
        },
      });
    }
  }

  /** Build one cell (background frame + orientation icon) as a container centred on
   *  its own origin, so it can be positioned/scaled/tweened/tinted as a unit. */
  private buildCell(
    cell: PaletteCell,
    model: PaletteModel,
    bracketPx: number,
  ): { cont: Phaser.GameObjects.Container; bg?: CellObj['bg']; icon?: Phaser.GameObjects.Image } {
    const cont = this.add.container(0, 0);
    let bg: CellObj['bg'] | undefined;
    if (cell.center && this.textures.exists(BRACKET)) {
      bg = this.add.image(0, 0, BRACKET).setDisplaySize(bracketPx, bracketPx);
      cont.add(bg);
    } else if (this.textures.get(BUTTON).has(BUTTON_FRAME)) {
      // Rounded-square pixel button (nine-slice → crisp corners at any size). The
      // current facing is highlighted with a warm tint.
      const ns = this.add.nineslice(0, 0, BUTTON, BUTTON_FRAME, CELL, CELL, 6, 6, 7, 7);
      if (cell.orient === model.selected) ns.setTint(HILITE);
      bg = ns;
      cont.add(ns);
    } else {
      bg = this.add
        .image(0, 0, ATLAS, cell.orient === model.selected ? FRAME_SLOT_SELECTED : FRAME_SLOT)
        .setDisplaySize(CELL, CELL);
      cont.add(bg);
    }
    let icon: Phaser.GameObjects.Image | undefined;
    if (this.textures.exists(cell.iconKey)) {
      icon = this.add.image(0, 0, cell.iconKey, cell.frame);
      // Centre icon fills the bracket's inner tile (24px frame holds a 16px cell →
      // 16/24); ring icons fit their button.
      const box = cell.center ? bracketPx * (16 / 24) : CELL * 0.62;
      icon.setScale(box / Math.max(icon.width, icon.height));
      cont.add(icon);
    }
    return { cont, bg, icon };
  }
}
