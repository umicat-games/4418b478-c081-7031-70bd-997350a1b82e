import Phaser from 'phaser';
import { dialogFont } from '../i18n';

// The mailbox modal: click the mailbox → the big open mailbox (`mail-box.png`)
// SLIDES UP from below; its content window shows ONE PAGE of mail (5×3 = 15 items,
// mail-box-item-bg slot + icon + count), fading in. A close button (icon-buttons
// `close-light-big`) at the mailbox's top-right is the ONLY way to close (GameScene
// routes it; the hotbar slides down while open). Overflow PAGES: dragging the
// envelope-zipper thumb down the right rail (or wheeling) flips to the next page.
const MAILBOX = 'mail-box';
const ITEM_BG = 'mail-box-item-bg';
const SCROLL_THUMB = 'envelope-zipper';
const CLOSE_ATLAS = 'icon-buttons';
const CLOSE_FRAME = 'close-light-big';

const FIT_H = 0.94, FIT_W = 0.6, X_BIAS = 0.19;
// Item window + scroll rail INSIDE the mailbox, in the art's NATIVE px (1096×1426).
const CONTENT = { x: 105, y: 490, w: 845, h: 620 };
const COLS = 5, ROWS = 3;      // one page = 5×3 = 15 items
const GAP = 16;
const SCROLL = { x: 972, top: 575, bottom: 1030, thumbScale: 1.0 };
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
  // grid geometry for the current open (local to the item layer)
  private gx0 = 0; private gy0 = 0; private cell = 0; private gap = 0;

  constructor() {
    super({ key: 'MailboxScene' });
  }

  create(): void {
    // Mouse-wheel flips pages while the mailbox is open.
    this.input.on('wheel', (_p: Phaser.Input.Pointer, _o: unknown, _dx: number, dy: number) => {
      if (this.shown && this.pages > 1) this.setPage(this.page + (dy > 0 ? 1 : -1));
    });
  }

  update(): void {
    const m = this.registry.get('mailbox') as MailboxModel | undefined;
    if (!m || m.rev === this.lastRev) return;
    this.lastRev = m.rev;
    if (m.visible) this.open(m);
    else this.close();
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

    // Grid geometry: a 3-row block, vertically centred in the window; items fill it
    // from the top row (so the last page's items start at the same place).
    this.items = m.items ?? [];
    const per = COLS * ROWS;
    this.pages = Math.max(1, Math.ceil(this.items.length / per));
    this.gap = GAP * fit;
    this.cell = (CONTENT.w * fit - this.gap * (COLS - 1)) / COLS;
    const blockH = ROWS * this.cell + (ROWS - 1) * this.gap;
    const offY = (CONTENT.h * fit - blockH) / 2;
    this.gx0 = cx(CONTENT.x);
    this.gy0 = cy(CONTENT.y) + offY;

    // Scroll thumb on the right rail (drag flips pages; snaps to the nearest page).
    this.thumbTop = cy(SCROLL.top);
    this.thumbBot = cy(SCROLL.bottom);
    const thumb = this.add.image(cx(SCROLL.x), this.thumbTop, SCROLL_THUMB).setScale(SCROLL.thumbScale * fit);
    content.add(thumb);
    this.thumb = thumb;
    if (this.pages > 1) {
      thumb.setInteractive({ draggable: true, useHandCursor: true });
      this.input.setDraggable(thumb);
      thumb.on('drag', (_p: Phaser.Input.Pointer, _dx: number, dy: number) => {
        const t = Phaser.Math.Clamp((dy - this.thumbTop) / (this.thumbBot - this.thumbTop), 0, 1);
        this.setPage(Math.round(t * (this.pages - 1)));
      });
    }

    this.renderPage(0);
    this.tweens.add({ targets: content, alpha: 1, duration: 220, delay: 120 });
  }

  private setPage(p: number): void {
    const np = Phaser.Math.Clamp(p, 0, this.pages - 1);
    if (np === this.page && this.slots && this.slots.length) return;
    this.renderPage(np);
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
