import Phaser from 'phaser';
import { dialogFont } from '../i18n';

// The mailbox modal: click the mailbox → the big open mailbox (`mail-box.png`)
// SLIDES UP from below; its content window fills with mail items (mail-box-item-bg
// slots + icon + count), fading in. A close button (icon-buttons `close-light-big`)
// at the mailbox's top-right is the ONLY way to close (GameScene routes it; the
// hotbar slides down while open). If the items overflow, the content SCROLLS —
// drag the envelope-zipper thumb down the right-hand rail (or mouse-wheel).
const MAILBOX = 'mail-box';        // 1096×1426 open mailbox
const ITEM_BG = 'mail-box-item-bg';
const SCROLL_THUMB = 'envelope-zipper';
const CLOSE_ATLAS = 'icon-buttons';
const CLOSE_FRAME = 'close-light-big';

const FIT_H = 0.94, FIT_W = 0.6, X_BIAS = 0.19; // mailbox size on screen + right bias
// The item-grid window + scroll rail INSIDE the mailbox, in the art's NATIVE px.
const CONTENT = { x: 105, y: 490, w: 845, h: 620 };
const COLS = 5;
const GAP = 16;
const SCROLL = { x: 972, top: 575, bottom: 1030, thumbScale: 1.0 }; // rail: thumb centre native x + y range
const CLOSE = { insetX: 120, insetY: 210, scale: 2 }; // native offset from the mailbox top-RIGHT corner

export interface MailItem { iconKey: string; iconFrame: number | string; count: number; }
export interface MailboxModel { visible: boolean; rev: number; items?: MailItem[]; }

export class MailboxScene extends Phaser.Scene {
  private lastRev = -1;
  private shown = false;
  private root?: Phaser.GameObjects.Container;
  private scroller?: Phaser.GameObjects.Container;
  private thumb?: Phaser.GameObjects.Image;
  private scrollV = 0;
  private maxScroll = 0;
  private thumbTop = 0;
  private thumbBot = 0;

  constructor() {
    super({ key: 'MailboxScene' });
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
    this.scrollV = 0;
    const W = this.scale.width, H = this.scale.height;

    const c = this.add.container(0, 0);
    this.root = c;

    // Mailbox frame + close button — slides UP from below the screen.
    const box = this.add.container(0, 0);
    c.add(box);
    const img = this.add.image(0, 0, MAILBOX);
    const fit = Math.min((H * FIT_H) / img.height, (W * FIT_W) / img.width, 1);
    img.setScale(fit);
    box.add(img);
    const restX = W / 2 + W * X_BIAS, restY = H / 2;
    const cx = (nx: number) => (nx - img.width / 2) * fit;  // native x → local (box centre)
    const cy = (ny: number) => (ny - img.height / 2) * fit; // native y → local

    if (this.textures.exists(CLOSE_ATLAS)) {
      const lx = cx(img.width - CLOSE.insetX), ly = cy(CLOSE.insetY);
      box.add(this.add.image(lx, ly, CLOSE_ATLAS, CLOSE_FRAME).setScale(CLOSE.scale));
      const half = (32 * CLOSE.scale) / 2;
      this.registry.set('mailboxCloseBounds', { x: restX + lx - half, y: restY + ly - half, w: half * 2, h: half * 2 });
    }

    box.setPosition(restX, H + img.displayHeight);
    this.tweens.add({ targets: box, x: restX, y: restY, duration: 300, ease: 'Back.easeOut' });

    // Item layer — at the REST content window, masked, scrollable, fades in (so it
    // doesn't smear during the slide). Positioned in the SAME local frame as `box`.
    const content = this.add.container(restX, restY).setAlpha(0);
    c.add(content);
    const scroller = this.add.container(0, 0);
    content.add(scroller);
    this.scroller = scroller;

    const items = m.items ?? [];
    const gap = GAP * fit;
    const cell = (CONTENT.w * fit - gap * (COLS - 1)) / COLS;
    const rows = Math.max(1, Math.ceil(items.length / COLS));
    const gridH = rows * cell + (rows - 1) * gap;
    const winH = CONTENT.h * fit;
    this.maxScroll = Math.max(0, gridH - winH);
    const offY = this.maxScroll > 0 ? 0 : (winH - gridH) / 2; // centre only when it fits
    const gx0 = cx(CONTENT.x), gy0 = cy(CONTENT.y);
    items.forEach((it, i) => {
      const col = i % COLS, row = Math.floor(i / COLS);
      const sx = gx0 + cell / 2 + col * (cell + gap);
      const sy = gy0 + offY + cell / 2 + row * (cell + gap);
      scroller.add(this.add.image(sx, sy, ITEM_BG).setDisplaySize(cell, cell));
      if (this.textures.exists(it.iconKey)) {
        const icon = this.add.image(sx, sy, it.iconKey, it.iconFrame);
        icon.setScale((cell * 0.62) / Math.max(icon.width, icon.height));
        scroller.add(icon);
      }
      scroller.add(
        this.add
          .text(sx + cell * 0.34, sy + cell * 0.30, String(it.count), {
            fontFamily: dialogFont(), fontSize: Math.round(cell * 0.24) + 'px', color: '#ffffff',
          })
          .setOrigin(0.5),
      );
    });

    // Clip the item layer to the content window (world rect at rest).
    const maskG = this.add.graphics().setVisible(false);
    maskG.fillStyle(0xffffff).fillRect(restX + gx0, restY + gy0, CONTENT.w * fit, CONTENT.h * fit);
    c.add(maskG);
    scroller.setMask(maskG.createGeometryMask());

    // Scroll thumb (envelope-zipper) on the right rail — draggable + wheel.
    this.thumbTop = cy(SCROLL.top);
    this.thumbBot = cy(SCROLL.bottom);
    const thumb = this.add.image(cx(SCROLL.x), this.thumbTop, SCROLL_THUMB).setScale(SCROLL.thumbScale * fit);
    content.add(thumb);
    this.thumb = thumb;
    if (this.maxScroll > 0) {
      thumb.setInteractive({ draggable: true, useHandCursor: true });
      this.input.setDraggable(thumb);
      thumb.on('drag', (_p: Phaser.Input.Pointer, _dx: number, dy: number) => {
        const ly = Phaser.Math.Clamp(dy, this.thumbTop, this.thumbBot);
        this.setScroll((this.maxScroll * (ly - this.thumbTop)) / (this.thumbBot - this.thumbTop));
      });
    }

    content.setAlpha(0);
    this.tweens.add({ targets: content, alpha: 1, duration: 220, delay: 120 });
    this.setScroll(0);
  }

  private setScroll(v: number): void {
    this.scrollV = Phaser.Math.Clamp(v, 0, this.maxScroll);
    this.scroller?.setY(-this.scrollV);
    if (this.thumb) {
      const t = this.maxScroll > 0 ? this.scrollV / this.maxScroll : 0;
      this.thumb.setY(this.thumbTop + t * (this.thumbBot - this.thumbTop));
    }
  }

  create(): void {
    // Mouse-wheel scrolls the open mailbox.
    this.input.on('wheel', (_p: Phaser.Input.Pointer, _o: unknown, _dx: number, dy: number) => {
      if (this.shown && this.maxScroll > 0) this.setScroll(this.scrollV + dy * 0.6);
    });
  }

  private close(): void {
    this.registry.set('mailboxCloseBounds', null);
    if (!this.shown) { this.root?.destroy(); this.root = undefined; return; }
    this.shown = false;
    const root = this.root;
    this.root = undefined;
    this.thumb = undefined;
    this.scroller = undefined;
    if (!root) return;
    this.tweens.add({ targets: root, alpha: 0, duration: 140, onComplete: () => root.destroy() });
  }
}
