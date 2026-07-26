import Phaser from 'phaser';
import { dialogFont } from '../i18n';

// The mailbox modal: click the mailbox → the big open mailbox (`mail-box.png`)
// SLIDES UP from below; its content window shows ONE PAGE of mail (5×3 = 15 items,
// mail-box-item-bg slot + icon + count), fading in. A close button (icon-buttons
// `close-light-big`) at the mailbox's top-right is the ONLY way to close. Overflow
// PAGES: flip pages with the mouse wheel OR by dragging the right-hand rail (the
// envelope-zipper thumb) — GameScene routes BOTH the close + the rail drag (a
// cross-scene interactive drag on the thumb is unreliable), driving the current
// page via the `mailboxPage` registry value that this scene renders.
const MAILBOX = 'mail-box';
const ITEM_BG = 'mail-box-item-bg';
const SCROLL_THUMB = 'envelope-zipper';
const CLOSE_ATLAS = 'icon-buttons';
const CLOSE_FRAME = 'close-light-big';

const FIT_H = 0.94, FIT_W = 0.6, X_BIAS = 0.19;
const CONTENT = { x: 105, y: 490, w: 845, h: 620 };
const COLS = 5, ROWS = 3;      // one page = 5×3 = 15 items
const GAP = 16;
// x = thumb-CENTRE native x; top/bottom = thumb-CENTRE native y at page 0 / last
// page. Nudged right + down so the zipper's white tab lines up with the rail's cap.
const SCROLL = { x: 981, top: 574, bottom: 1036, thumbScale: 1.0 };
const CLOSE = { insetX: 120, insetY: 210, scale: 2 };

export interface MailItem { iconKey: string; iconFrame: number | string; count: number; }
export interface MailboxModel { visible: boolean; rev: number; items?: MailItem[]; }

export class MailboxScene extends Phaser.Scene {
  private lastRev = -1;
  private shown = false;
  private root?: Phaser.GameObjects.Container;
  private page = 0;
  private pages = 1;
  private items: MailItem[] = [];
  private slots?: Phaser.GameObjects.Container;
  private thumb?: Phaser.GameObjects.Image;
  private thumbTop = 0;
  private thumbBot = 0;
  private gx0 = 0; private gy0 = 0; private cell = 0; private gap = 0;

  constructor() {
    super({ key: 'MailboxScene' });
  }

  create(): void {
    // Mouse-wheel flips pages (touch uses the rail drag, routed by GameScene).
    this.input.on('wheel', (_p: Phaser.Input.Pointer, _o: unknown, _dx: number, dy: number) => {
      if (this.shown && this.pages > 1) {
        this.registry.set('mailboxPage', Phaser.Math.Clamp(this.page + (dy > 0 ? 1 : -1), 0, this.pages - 1));
      }
    });
  }

  update(): void {
    const m = this.registry.get('mailbox') as MailboxModel | undefined;
    if (m && m.rev !== this.lastRev) {
      this.lastRev = m.rev;
      if (m.visible) this.open(m); else this.close();
      return;
    }
    // Page changes (wheel here, rail-drag from GameScene) arrive via `mailboxPage`.
    if (this.shown) {
      const p = (this.registry.get('mailboxPage') as number) ?? 0;
      if (p !== this.page) this.renderPage(p);
    }
  }

  private open(m: MailboxModel): void {
    this.root?.destroy();
    this.tweens.killAll();
    this.shown = true;
    this.page = 0;
    const W = this.scale.width, H = this.scale.height;

    const c = this.add.container(0, 0);
    this.root = c;

    // Mailbox frame + close button — slides UP from below.
    const box = this.add.container(0, 0);
    c.add(box);
    const img = this.add.image(0, 0, MAILBOX);
    const fit = Math.min((H * FIT_H) / img.height, (W * FIT_W) / img.width, 1);
    img.setScale(fit);
    box.add(img);
    const restX = W / 2 + W * X_BIAS, restY = H / 2;
    const cx = (nx: number) => (nx - img.width / 2) * fit;
    const cy = (ny: number) => (ny - img.height / 2) * fit;

    if (this.textures.exists(CLOSE_ATLAS)) {
      const lx = cx(img.width - CLOSE.insetX), ly = cy(CLOSE.insetY);
      box.add(this.add.image(lx, ly, CLOSE_ATLAS, CLOSE_FRAME).setScale(CLOSE.scale));
      const half = (32 * CLOSE.scale) / 2;
      this.registry.set('mailboxCloseBounds', { x: restX + lx - half, y: restY + ly - half, w: half * 2, h: half * 2 });
    }
    box.setPosition(restX, H + img.displayHeight);
    this.tweens.add({ targets: box, x: restX, y: restY, duration: 300, ease: 'Back.easeOut' });

    // Item layer (fades in at rest, same local frame as `box`).
    const content = this.add.container(restX, restY).setAlpha(0);
    c.add(content);
    const slots = this.add.container(0, 0);
    content.add(slots);
    this.slots = slots;

    this.items = m.items ?? [];
    const per = COLS * ROWS;
    this.pages = Math.max(1, Math.ceil(this.items.length / per));
    this.gap = GAP * fit;
    this.cell = (CONTENT.w * fit - this.gap * (COLS - 1)) / COLS;
    const blockH = ROWS * this.cell + (ROWS - 1) * this.gap;
    this.gx0 = cx(CONTENT.x);
    this.gy0 = cy(CONTENT.y) + (CONTENT.h * fit - blockH) / 2; // 3-row block, centred

    // Scroll thumb (display-only; GameScene drags the rail).
    this.thumbTop = cy(SCROLL.top);
    this.thumbBot = cy(SCROLL.bottom);
    this.thumb = this.add.image(cx(SCROLL.x), this.thumbTop, SCROLL_THUMB).setScale(SCROLL.thumbScale * fit);
    content.add(this.thumb);

    // Publish the rail (SCREEN coords) so GameScene can drag it — reliable for
    // mouse AND touch (no wheel on touch).
    this.registry.set('mailboxPage', 0);
    this.registry.set('mailboxRail', { x: restX + cx(SCROLL.x), top: restY + this.thumbTop, bottom: restY + this.thumbBot, pages: this.pages });

    this.renderPage(0);
    this.tweens.add({ targets: content, alpha: 1, duration: 220, delay: 120 });
  }

  /** Rebuild the item slots for page `p` + move the thumb to match. */
  private renderPage(p: number): void {
    this.page = Phaser.Math.Clamp(p, 0, this.pages - 1);
    const slots = this.slots;
    if (!slots) return;
    slots.removeAll(true);
    const per = COLS * ROWS;
    const pageItems = this.items.slice(this.page * per, this.page * per + per);
    pageItems.forEach((it, i) => {
      const col = i % COLS, row = Math.floor(i / COLS);
      const sx = this.gx0 + this.cell / 2 + col * (this.cell + this.gap);
      const sy = this.gy0 + this.cell / 2 + row * (this.cell + this.gap);
      slots.add(this.add.image(sx, sy, ITEM_BG).setDisplaySize(this.cell, this.cell));
      if (this.textures.exists(it.iconKey)) {
        const icon = this.add.image(sx, sy, it.iconKey, it.iconFrame);
        icon.setScale((this.cell * 0.62) / Math.max(icon.width, icon.height));
        slots.add(icon);
      }
      slots.add(
        this.add
          .text(sx + this.cell * 0.34, sy + this.cell * 0.30, String(it.count), {
            fontFamily: dialogFont(), fontSize: Math.round(this.cell * 0.24) + 'px', color: '#ffffff',
          })
          .setOrigin(0.5),
      );
    });
    if (this.thumb) {
      const t = this.pages > 1 ? this.page / (this.pages - 1) : 0;
      this.thumb.setY(this.thumbTop + t * (this.thumbBot - this.thumbTop));
    }
  }

  private close(): void {
    this.registry.set('mailboxCloseBounds', null);
    this.registry.set('mailboxRail', null);
    this.thumb = undefined;
    this.slots = undefined;
    if (!this.shown) { this.root?.destroy(); this.root = undefined; return; }
    this.shown = false;
    const root = this.root;
    this.root = undefined;
    if (!root) return;
    this.tweens.add({ targets: root, alpha: 0, duration: 140, onComplete: () => root.destroy() });
  }
}
