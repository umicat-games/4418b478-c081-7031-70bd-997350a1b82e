import Phaser from 'phaser';
import { dialogFont, t } from '../i18n';
import { applyHudDpr, hudDpr, hudLogicalW, hudLogicalH } from '../dpi';

// The island-travel picker: click the boat → a modal list of the OTHER islands (name + icon). It
// matches the other popup dialogs — a top-right CLOSE button (only it closes; tapping around does
// NOT), and press-down feedback on every button (the rows + the close). GameScene owns the model
// (`travel` registry key) + routes taps via `travelBounds`, holding a button on press and acting on
// release (mirrors ConfirmScene's `confirmHeld`/`confirmBounds`).
const ATLAS = 'inventory';
const FRAME_PANEL = 'frame-medium';
const PANEL_SCALE = 2;
const BTN = 'square-buttons', BTN_FRAME = 'white-button', BTN_PRESSED = 'white-button-pressed-down';
const CLOSE_ATLAS = 'icon-buttons', CLOSE_FRAME = 'close-light-big', CLOSE_PRESSED = 'close-light-big-pressed-down';
const ICONS = 'ui-icons';
const ICON_ISLAND = 229; // green-sprout glyph as a placeholder island icon (swappable)
const INK = '#5b3a1e';
export const TRAVEL_CLOSE = '__close';

export interface TravelIsland { id: string; name: string; }
export interface TravelModel {
  visible: boolean;
  rev: number;
  islands: TravelIsland[];
}

export class TravelScene extends Phaser.Scene {
  private lastRev = -1;
  private shown = false;
  private root?: Phaser.GameObjects.Container;
  private rowBgs = new Map<string, Phaser.GameObjects.NineSlice>(); // id → its button bg (frame-swapped while held)
  private closeBg?: Phaser.GameObjects.NineSlice;

  constructor() { super({ key: 'TravelScene' }); }

  create(): void {
    applyHudDpr(this);
    this.scale.on(Phaser.Scale.Events.RESIZE, this.onResize, this);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.scale.off(Phaser.Scale.Events.RESIZE, this.onResize, this));
  }

  private onResize = (): void => {
    applyHudDpr(this);
    if (this.shown) { const m = this.model(); if (m?.visible) this.open(m); }
  };

  update(): void {
    this.updatePressed(); // hold the pressed frame while GameScene reports a held button
    const m = this.model();
    if (!m || m.rev === this.lastRev) return;
    this.lastRev = m.rev;
    if (m.visible) this.open(m);
    else this.close();
  }

  /** Swap the held button (a row, or the close X) to its pressed frame; revert the rest. */
  private updatePressed(): void {
    const held = this.registry.get('travelHeld') as string | null | undefined;
    const set = (bg: Phaser.GameObjects.NineSlice | undefined, on: boolean, base: string, pressed: string): void => {
      if (!bg || !bg.active) return;
      const f = on ? pressed : base;
      if (bg.frame.name !== f) bg.setFrame(f);
    };
    for (const [id, bg] of this.rowBgs) set(bg, held === id, BTN_FRAME, BTN_PRESSED);
    set(this.closeBg, held === TRAVEL_CLOSE, CLOSE_FRAME, CLOSE_PRESSED);
  }

  private model(): TravelModel | undefined {
    return this.registry.get('travel') as TravelModel | undefined;
  }

  private open(m: TravelModel): void {
    this.root?.destroy();
    this.tweens.killAll();
    this.rowBgs.clear(); this.closeBg = undefined;
    this.shown = true;
    const W = hudLogicalW(this), H = hudLogicalH(this);
    const cx = W / 2, cy = H / 2;
    const c = this.add.container(0, 0);
    this.root = c;

    // Dim backdrop (blocks the world; tapping it does NOT close — only the X does).
    const dim = this.add.rectangle(0, 0, W, H, 0x000000, 0.5).setOrigin(0, 0).setAlpha(0);
    this.tweens.add({ targets: dim, alpha: 1, duration: 140 });
    c.add(dim);

    const panelW = 440; // a touch wider than a plain confirm
    const TITLE_H = 30, BAR_GAP = 12, HEAD_BOT = 18, ROW_H = 54, ROW_GAP = 10, TOP = 26, BOT = 26;
    const rows = m.islands.length;
    const headH = TOP + TITLE_H + BAR_GAP + HEAD_BOT; // title + underline block
    const panelH = Math.round(headH + rows * ROW_H + (rows - 1) * ROW_GAP + BOT);
    const box = this.add.container(cx, cy);
    c.add(box);

    const panel = this.add.nineslice(0, 0, ATLAS, FRAME_PANEL, panelW / PANEL_SCALE, panelH / PANEL_SCALE, 10, 10, 11, 11);
    panel.setScale(PANEL_SCALE);
    box.add(panel);

    const d = hudDpr(this);
    const bounds: Array<{ id: string; x: number; y: number; w: number; h: number }> = [];

    // Title — white bold with a warm-brown stroke (the chest/mailbox header style) + a title-bar
    // underline below it.
    const titleY = -panelH / 2 + TOP + TITLE_H / 2;
    const title = this.add.text(0, titleY, t('travel_title'), { fontFamily: dialogFont(), fontSize: '24px', color: '#ffffff', fontStyle: 'bold' }).setOrigin(0.5);
    title.setStroke('#5b4327', 4);
    box.add(title);
    if (this.textures.exists('title-bar')) {
      const s = 6 / 4;                          // 4px-tall texture → ~6px on-screen
      const barW = title.width + 64;            // text width + padding each side
      box.add(this.add.nineslice(0, titleY + TITLE_H / 2 + BAR_GAP, 'title-bar', undefined, barW / s, 4, 2, 2, 1, 1).setScale(s));
    }

    // Close button — INSIDE the panel's top-right corner (like the other modals), press-swaps.
    const CLOSE = 42, CM = 16;
    const closeX = panelW / 2 - CLOSE / 2 - CM, closeY = -panelH / 2 + CLOSE / 2 + CM;
    const closeC = this.add.container(closeX, closeY);
    if (this.textures.exists(CLOSE_ATLAS) && this.textures.get(CLOSE_ATLAS).has(CLOSE_FRAME)) {
      this.closeBg = this.add.nineslice(0, 0, CLOSE_ATLAS, CLOSE_FRAME, CLOSE, CLOSE, 8, 8, 8, 8);
      closeC.add(this.closeBg);
    }
    box.add(closeC);
    bounds.push({ id: TRAVEL_CLOSE, x: (cx + closeX - CLOSE / 2) * d, y: (cy + closeY - CLOSE / 2) * d, w: CLOSE * d, h: CLOSE * d });

    // Island rows — each a wide button (white-button 9-slice, press-swaps to the pressed frame).
    let y = -panelH / 2 + headH;
    const rowW = panelW - 44, rowX = 0;
    for (const isl of m.islands) {
      const ry = y + ROW_H / 2;
      const rc = this.add.container(rowX, ry);
      const bg = this.add.nineslice(0, 0, BTN, BTN_FRAME, rowW, ROW_H, 6, 6, 7, 7);
      this.rowBgs.set(isl.id, bg);
      rc.add(bg);
      if (this.textures.exists(ICONS)) {
        const icon = this.add.image(-rowW / 2 + ROW_H * 0.55, 0, ICONS, ICON_ISLAND);
        icon.setScale((ROW_H * 0.46) / 16); rc.add(icon);
      }
      rc.add(this.add.text(-rowW / 2 + ROW_H * 1.05, 0, isl.name, { fontFamily: dialogFont(), fontSize: '21px', color: INK }).setOrigin(0, 0.5));
      box.add(rc);
      bounds.push({ id: isl.id, x: (cx + rowX - rowW / 2) * d, y: (cy + ry - ROW_H / 2) * d, w: rowW * d, h: ROW_H * d });
      y += ROW_H + ROW_GAP;
    }
    this.registry.set('travelBounds', bounds);

    box.setScale(0.85);
    this.tweens.add({ targets: box, scale: 1, duration: 160, ease: 'Back.easeOut' });
  }

  private close(): void {
    this.registry.set('travelBounds', []);
    this.rowBgs.clear(); this.closeBg = undefined;
    if (!this.shown) { this.root?.destroy(); this.root = undefined; return; }
    this.shown = false;
    const root = this.root; this.root = undefined;
    if (!root) return;
    this.tweens.add({ targets: root, alpha: 0, duration: 120, onComplete: () => root.destroy() });
  }
}
