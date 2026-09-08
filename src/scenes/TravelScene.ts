import Phaser from 'phaser';
import { dialogFont, t } from '../i18n';
import { applyHudDpr, hudDpr, hudLogicalW, hudLogicalH } from '../dpi';

// The island-travel picker: click the boat → a small modal list of the OTHER islands (name + icon).
// Tapping a row sails there; tapping outside closes. GameScene owns the model (`travel` registry key)
// + routes taps (it's modal, checked first in actAt via `travelBounds`); this scene just renders +
// publishes the row hit-boxes. Mirrors ConfirmScene's panel/dim/dpr conventions and the mail-list rows.
const ATLAS = 'inventory';
const FRAME_PANEL = 'frame-medium';
const PANEL_SCALE = 2;
const ICONS = 'ui-icons';
const ICON_ISLAND = 229; // green-sprout glyph as a placeholder island icon (swappable)
const ROW_BG = 0xefe4c8, ROW_BORDER = 0xd8c69e;
const INK = '#5b3a1e';

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
    const m = this.model();
    if (!m || m.rev === this.lastRev) return;
    this.lastRev = m.rev;
    if (m.visible) this.open(m);
    else this.close();
  }

  private model(): TravelModel | undefined {
    return this.registry.get('travel') as TravelModel | undefined;
  }

  private open(m: TravelModel): void {
    this.root?.destroy();
    this.tweens.killAll();
    this.shown = true;
    const W = hudLogicalW(this), H = hudLogicalH(this);
    const cx = W / 2, cy = H / 2;
    const c = this.add.container(0, 0);
    this.root = c;

    // Dim backdrop (fades in) — blocks the world while the picker is up.
    const dim = this.add.rectangle(0, 0, W, H, 0x000000, 0.5).setOrigin(0, 0).setAlpha(0);
    this.tweens.add({ targets: dim, alpha: 1, duration: 140 });
    c.add(dim);

    // Panel sized to the row count.
    const panelW = 360;
    const TITLE_H = 34, ROW_H = 52, ROW_GAP = 10, TOP = 26, BOT = 24;
    const rows = m.islands.length;
    const panelH = Math.round(TOP + TITLE_H + rows * (ROW_H + ROW_GAP) + BOT);
    const box = this.add.container(cx, cy);
    c.add(box);

    const panel = this.add.nineslice(0, 0, ATLAS, FRAME_PANEL, panelW / PANEL_SCALE, panelH / PANEL_SCALE, 10, 10, 11, 11);
    panel.setScale(PANEL_SCALE);
    box.add(panel);

    let y = -panelH / 2 + TOP;
    box.add(this.add.text(0, y + TITLE_H / 2, t('travel_title'), { fontFamily: dialogFont(), fontSize: '24px', color: '#4a2e12', fontStyle: 'bold' }).setOrigin(0.5));
    y += TITLE_H + ROW_GAP;

    const d = hudDpr(this);
    const bounds: Array<{ id: string; x: number; y: number; w: number; h: number }> = [];
    const rowW = panelW - 40, rowX = -rowW / 2;
    for (const isl of m.islands) {
      const ry = y;
      const g = this.add.graphics();
      g.fillStyle(ROW_BG, 1); g.fillRoundedRect(rowX, ry, rowW, ROW_H, 10);
      g.lineStyle(2, ROW_BORDER, 1); g.strokeRoundedRect(rowX, ry, rowW, ROW_H, 10);
      box.add(g);
      if (this.textures.exists(ICONS)) {
        const icon = this.add.image(rowX + ROW_H * 0.6, ry + ROW_H / 2, ICONS, ICON_ISLAND);
        icon.setScale((ROW_H * 0.5) / 16); box.add(icon);
      }
      box.add(this.add.text(rowX + ROW_H * 1.15, ry + ROW_H / 2, isl.name, { fontFamily: dialogFont(), fontSize: '21px', color: INK }).setOrigin(0, 0.5));
      // Hit-box in DEVICE-px screen space (GameScene routes the tap).
      bounds.push({ id: isl.id, x: (cx + rowX) * d, y: (cy + ry) * d, w: rowW * d, h: ROW_H * d });
      y += ROW_H + ROW_GAP;
    }
    this.registry.set('travelBounds', bounds);
    // Panel screen rect (tap OUTSIDE closes) — device px.
    this.registry.set('travelPanel', { x: (cx - panelW / 2) * d, y: (cy - panelH / 2) * d, w: panelW * d, h: panelH * d });

    box.setScale(0.85);
    this.tweens.add({ targets: box, scale: 1, duration: 160, ease: 'Back.easeOut' });
  }

  private close(): void {
    this.registry.set('travelBounds', []);
    this.registry.set('travelPanel', null);
    if (!this.shown) { this.root?.destroy(); this.root = undefined; return; }
    this.shown = false;
    const root = this.root; this.root = undefined;
    if (!root) return;
    this.tweens.add({ targets: root, alpha: 0, duration: 120, onComplete: () => root.destroy() });
  }
}
