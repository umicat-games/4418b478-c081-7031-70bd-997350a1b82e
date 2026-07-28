import Phaser from 'phaser';
import { dialogFont } from '../i18n';

// The ORDER BOOK modal (opened by the bottom-right order button): a two-page book
// (`order-book.png`) — LEFT page = a scrollable catalog of orderable seeds/seedlings
// (icon + name + dotted leader + price), RIGHT page = the order SUMMARY (the items
// you've picked, your coin balance, the TOTAL, and an "arrives next morning" note).
// There's NO confirm button — editing the order IS the order; the coins are charged
// when it's delivered the next morning. GameScene owns the model (`orderBook` key) +
// the economy; this scene renders it and publishes hit-boxes (catalog rows, summary
// rows, the scroll rail) that GameScene routes taps to — same split as the mailbox.
const BOOK = 'order-book';
const COIN = 'coins';
const COIN_FRAME = 'coin-white-border-shadow-below';
const UI = 'ui-sheet';
// NOTE: the background region is spelled `vertial-` (typo) in the Asset Manager —
// match the backend's frame name so a real Build (which resyncs the canonical atlas)
// keeps working. Rename the region upstream + fix this if you clean it up.
const BAR_BG = 'vertial-scroll-bar-background';
const BAR_THUMB = 'vertical-scroll-bar-dark';
// 9-slice insets (authored in the Asset Manager) → the vertical caps stay crisp
// while the middle stretches to any bar height (`add.nineslice`, not a stretched image).
const BG_SLICE = { l: 1, r: 2, t: 9, b: 9 };
const THUMB_SLICE = { l: 2, r: 3, t: 4, b: 6 };
// Item icon background frame (square-buttons `grey-button`, 9-slice L6/R6/T6/B6).
const BTN = 'square-buttons';
const BTN_GREY = 'grey-button';

// Fill the screen with the book, then place content by FRACTION of the book image
// (native-px independent). All tuned against screenshots (headless renders black).
const FILL = 0.97;
const RES = 3; // text render resolution → crisp pixel numbers (no AA blur)
// Left page — the catalog. Rows are TALL + start high so the list fills the page down
// toward the bottom binding. `visible` ≥ the current catalog size → all rows show (the
// scroll bar only appears once the catalog outgrows the page).
const L = { x0: 0.082, xName: 0.118, x1: 0.432, y0: 0.135, rowH: 0.066, icon: 0.042, visible: 12, barX: 0.455 };
// Right page — the summary. Same row format as the catalog (icon frame + name + dots
// + price), but smaller icons + tighter rows so a full 11-item order clears the footer.
const R = { title: { x: 0.735, y: 0.13 }, x0: 0.565, xName: 0.605, x1: 0.905, y0: 0.185, rowH: 0.05, icon: 0.032, empty: { x: 0.735, y: 0.23 } };
const FOOT = { balX: 0.565, totalX: 0.905, y: 0.775, noteX: 0.735, noteY: 0.82 };
const SELECT = 0x4aa3df;

export interface OrderCatalogEntry { id: string; label: string; iconKey: string; iconFrame: string | number; price: number; }
export interface OrderDraftLine { id: string; label: string; count: number; price: number; iconKey: string; iconFrame: string | number; }
export interface OrderBookModel {
  visible: boolean;
  rev: number;
  catalog: OrderCatalogEntry[];
  draft: OrderDraftLine[];
  selectedId?: string;
  money: number;
  total: number;
  affordable: boolean;
}
interface Bound { x: number; y: number; w: number; h: number; id?: string }

export class OrderBookScene extends Phaser.Scene {
  private lastRev = -1;
  private shown = false;
  private root?: Phaser.GameObjects.Container;
  private m?: OrderBookModel;
  private scroll = 0;      // catalog row offset
  private lastFrac = -1;   // last drag fraction applied (from GameScene)

  constructor() { super({ key: 'OrderBookScene' }); }

  create(): void {
    // Mouse-wheel scrolls the catalog (touch uses the rail drag, routed by GameScene).
    this.input.on('wheel', (_p: Phaser.Input.Pointer, _o: unknown, _dx: number, dy: number) => {
      if (this.shown) this.setScroll(this.scroll + (dy > 0 ? 1 : -1));
    });
  }

  update(): void {
    const m = this.registry.get('orderBook') as OrderBookModel | undefined;
    if (m && m.rev !== this.lastRev) {
      this.lastRev = m.rev;
      if (m.visible && !this.shown) { this.scroll = 0; this.open(m); }
      else if (m.visible && this.shown) this.render(m);
      else this.close();
    }
    // Rail drag arrives as a 0..1 fraction from GameScene.
    if (this.shown && this.m) {
      const frac = this.registry.get('orderScrollFrac') as number | undefined;
      if (frac != null && frac !== this.lastFrac) {
        this.lastFrac = frac;
        this.setScroll(Math.round(frac * this.maxScroll()));
      }
    }
  }

  private maxScroll(): number { return Math.max(0, (this.m?.catalog.length ?? 0) - L.visible); }

  private setScroll(v: number): void {
    const clamped = Phaser.Math.Clamp(v, 0, this.maxScroll());
    if (clamped === this.scroll || !this.m) return;
    this.scroll = clamped;
    this.render(this.m);
  }

  private open(m: OrderBookModel): void {
    this.root?.destroy();
    this.tweens.killAll();
    this.shown = true;
    this.render(m);
    if (this.root) {
      // Slide the whole book UP from below (mirror of the close), like the mailbox.
      const restY = this.scale.height / 2;
      this.root.setY(restY + this.scale.height * 1.2);
      this.tweens.add({ targets: this.root, y: restY, duration: 320, ease: 'Back.easeOut' });
    }
  }

  /** Rebuild the whole book from the model (bg + both pages) at the current scroll. */
  private render(m: OrderBookModel): void {
    this.m = m;
    if (this.root) this.tweens.killTweensOf(this.root);
    this.root?.destroy();
    const W = this.scale.width, H = this.scale.height;
    const c = this.add.container(W / 2, H / 2);
    this.root = c;

    const img = this.add.image(0, 0, BOOK);
    const fit = Math.min((W * FILL) / img.width, (H * FILL) / img.height);
    img.setScale(fit);
    c.add(img);
    const bw = img.width * fit, bh = img.height * fit;
    this.registry.set('orderPanel', { x: W / 2 - bw / 2, y: H / 2 - bh / 2, w: bw, h: bh }); // tap-outside-to-close
    const px = (fx: number) => (fx - 0.5) * bw;
    const py = (fy: number) => (fy - 0.5) * bh;
    const fs = Math.max(12, Math.round(bh * 0.032));
    // Text helper — high `resolution` so the pixel font renders crisp (no AA blur).
    const T = (x: number, y: number, s: string, size: number, color: string) =>
      this.add.text(x, y, s, { fontFamily: dialogFont(), fontSize: size + 'px', color, resolution: RES });

    // Shared row drawer (catalog + summary share the format): grey-button icon frame +
    // icon, name on the left, a dotted leader, a coin + number on the right.
    type Lay = { x0: number; xName: number; x1: number; icon: number };
    const drawRow = (lay: Lay, y: number, iconKey: string, iconFrame: string | number, label: string, num: number) => {
      const iconCx = px(lay.x0) + lay.icon * bh * 0.5;
      if (this.textures.exists(BTN) && this.textures.get(BTN).has(BTN_GREY)) {
        const bgSize = lay.icon * bh * 1.15; // < rowH → a clear vertical gap between frames
        c.add(this.add.nineslice(iconCx, y, BTN, BTN_GREY, bgSize, bgSize, 6, 6, 6, 6));
      }
      if (this.textures.exists(iconKey)) {
        const icon = this.add.image(iconCx, y, iconKey, iconFrame);
        icon.setScale((lay.icon * bh) / Math.max(icon.width, icon.height));
        c.add(icon);
      }
      const name = T(px(lay.xName), y, label, fs, '#5b4327').setOrigin(0, 0.5);
      c.add(name);
      const priceText = T(px(lay.x1), y, String(num), fs, '#5b4327').setOrigin(1, 0.5);
      c.add(priceText);
      const coin = this.coin(px(lay.x1) - priceText.width - fs * 0.5, y, fs);
      if (coin) c.add(coin);
      const dotL = px(lay.xName) + name.width + fs * 0.4;
      const dotR = px(lay.x1) - priceText.width - fs * 1.5;
      if (dotR > dotL) {
        const dg = this.add.graphics();
        dg.fillStyle(0x9a8763, 1);
        for (let x = dotL; x < dotR; x += fs * 0.55) dg.fillCircle(x, y, Math.max(1, fs * 0.07));
        c.add(dg);
      }
    };

    const rowBounds: Bound[] = [];
    const sumBounds: Bound[] = [];

    // ── LEFT: the catalog (scrolled window of `visible` rows) ────────────────
    const scrollable = m.catalog.length > L.visible;
    const view = m.catalog.slice(this.scroll, this.scroll + L.visible);
    view.forEach((e, vi) => {
      const y = py(L.y0 + vi * L.rowH);
      const rowScreenY = H / 2 + y;
      if (m.selectedId === e.id) {
        const g = this.add.graphics();
        g.lineStyle(Math.max(2, fs * 0.14), SELECT, 1);
        g.strokeRoundedRect(px(L.x0) - bh * 0.012, y - L.rowH * bh * 0.46, (L.x1 - L.x0) * bw + bh * 0.024, L.rowH * bh * 0.92, 6);
        c.add(g);
      }
      drawRow(L, y, e.iconKey, e.iconFrame, e.label, e.price);
      rowBounds.push({ x: W / 2 + px(L.x0) - 8, y: rowScreenY - (L.rowH * bh) / 2, w: (L.x1 - L.x0) * bw + 16, h: L.rowH * bh, id: e.id });
    });

    // Scroll bar (track + thumb) when the catalog overflows — publish the rail so
    // GameScene can DRAG it (touch has no wheel).
    if (scrollable) {
      const barX = px(L.barX);
      const top = py(L.y0) - L.rowH * bh * 0.5;
      const bottom = py(L.y0 + (L.visible - 1) * L.rowH) + L.rowH * bh * 0.5;
      const trackH = bottom - top;
      if (this.textures.exists(UI)) {
        const trackW = Math.max(4, bh * 0.008);
        c.add(this.add.nineslice(barX, (top + bottom) / 2, UI, BAR_BG, trackW, trackH, BG_SLICE.l, BG_SLICE.r, BG_SLICE.t, BG_SLICE.b));
        const thumbH = Math.max(trackH * 0.18, trackH * (L.visible / m.catalog.length));
        const t = this.maxScroll() ? this.scroll / this.maxScroll() : 0;
        const thumbY = top + thumbH / 2 + t * (trackH - thumbH);
        const thumbW = Math.max(6, bh * 0.014);
        c.add(this.add.nineslice(barX, thumbY, UI, BAR_THUMB, thumbW, thumbH, THUMB_SLICE.l, THUMB_SLICE.r, THUMB_SLICE.t, THUMB_SLICE.b));
      }
      this.registry.set('orderRail', { x: W / 2 + barX, top: H / 2 + top, bottom: H / 2 + bottom, max: this.maxScroll() });
    } else {
      this.registry.set('orderRail', null);
    }

    // ── RIGHT: the summary ─────────────────────────────────────────────────
    c.add(T(px(R.title.x), py(R.title.y), 'SUMMARY', Math.round(fs * 1.15), '#5b4327').setOrigin(0.5));
    if (!m.draft.length) {
      c.add(T(px(R.empty.x), py(R.empty.y), 'No items ordered', fs, '#9a8763').setOrigin(0.5));
    } else {
      m.draft.forEach((d, i) => {
        const y = py(R.y0 + i * R.rowH);
        const rowScreenY = H / 2 + y;
        drawRow(R, y, d.iconKey, d.iconFrame, `${d.label} ×${d.count}`, d.price * d.count);
        sumBounds.push({ x: W / 2 + px(R.x0) - 6, y: rowScreenY - (R.rowH * bh) / 2, w: (R.x1 - R.x0) * bw + 12, h: R.rowH * bh, id: d.id });
      });
    }

    // Balance (bottom-left) + TOTAL (bottom-right) + the arrival note, all INSIDE
    // the page (note sits below, centred).
    const bal = T(px(FOOT.balX), py(FOOT.y), String(m.money.toLocaleString()), fs, '#5b4327').setOrigin(0, 0.5);
    const balCoin = this.coin(px(FOOT.balX) - fs * 0.1, py(FOOT.y), fs);
    if (balCoin) { c.add(balCoin); bal.setX(px(FOOT.balX) + fs * 0.8); }
    c.add(bal);
    c.add(T(px(FOOT.totalX), py(FOOT.y), `TOTAL: ${m.total}`, fs, m.affordable ? '#5b4327' : '#b5533a').setOrigin(1, 0.5));
    c.add(T(px(FOOT.noteX), py(FOOT.noteY), '* Items will arrive the next morning', Math.round(fs * 0.82), '#9a8763').setOrigin(0.5));

    this.registry.set('orderRows', rowBounds);
    this.registry.set('orderSummaryRows', sumBounds);
  }

  private coin(x: number, y: number, fs: number): Phaser.GameObjects.Image | null {
    if (!this.textures.exists(COIN)) return null;
    const coin = this.add.image(x, y, COIN, COIN_FRAME);
    coin.setScale((fs * 1.0) / Math.max(coin.width, coin.height)).setOrigin(0.5);
    return coin;
  }

  private close(): void {
    this.registry.set('orderRows', []);
    this.registry.set('orderSummaryRows', []);
    this.registry.set('orderRail', null);
    this.registry.set('orderPanel', null);
    this.lastFrac = -1;
    if (!this.shown) { this.root?.destroy(); this.root = undefined; return; }
    this.shown = false;
    const root = this.root;
    this.root = undefined;
    if (!root) return;
    // Slide the whole book back DOWN off the bottom (mirror of the open).
    this.tweens.add({ targets: root, y: this.scale.height / 2 + this.scale.height * 1.2, duration: 320, ease: 'Back.easeIn', onComplete: () => root.destroy() });
  }
}
