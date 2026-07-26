import Phaser from 'phaser';
import { dialogFont } from '../i18n';

// The mailbox modal: click the mailbox → the big open mailbox (`mail-box.png`)
// SLIDES UP from below on a dim backdrop, its content window filled with mail
// items (mail-box-item-bg slots + an icon + count). A close button (icon-buttons
// `close-light-big`) sits at the screen top-right; ONLY it closes the modal
// (GameScene routes that — the hotbar slides down while it's open). Scroll (the
// envelope-zipper thumb) is a follow-up.
const MAILBOX = 'mail-box';        // 1096×1426 open mailbox
const ITEM_BG = 'mail-box-item-bg';
const CLOSE_ATLAS = 'icon-buttons';
const CLOSE_FRAME = 'close-light-big';

// The mailbox art fills this fraction of the screen; biased right like the ref.
const FIT_H = 0.94, FIT_W = 0.6, X_BIAS = 0.19;
// The item-grid area INSIDE the mailbox, in the art's NATIVE px (1096×1426).
// Everything scales together by `fit`, so tune these against a screenshot.
const CONTENT = { x: 105, y: 490, w: 845, h: 620 };
const COLS = 5;
const GAP = 16;              // native px between slots
// Close button anchored to the mailbox's TOP-RIGHT corner, inset (native px) so it
// clears the Cato portrait that lives at the screen's top-right corner.
const CLOSE = { insetX: 120, insetY: 210, scale: 2 };

export interface MailItem { iconKey: string; iconFrame: number | string; count: number; }
export interface MailboxModel { visible: boolean; rev: number; items?: MailItem[]; }

export class MailboxScene extends Phaser.Scene {
  private lastRev = -1;
  private shown = false;
  private root?: Phaser.GameObjects.Container;

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
    const W = this.scale.width, H = this.scale.height;

    const c = this.add.container(0, 0);
    this.root = c;

    // Mailbox + items, grouped so they SLIDE UP together from below the screen.
    const box = this.add.container(0, 0);
    c.add(box);

    const img = this.add.image(0, 0, MAILBOX);
    const fit = Math.min((H * FIT_H) / img.height, (W * FIT_W) / img.width, 1);
    img.setScale(fit);
    box.add(img);
    const restX = W / 2 + W * X_BIAS, restY = H / 2;

    // Item grid inside the content window (coords relative to the image centre).
    const items = m.items ?? [];
    const cx0 = (CONTENT.x - img.width / 2) * fit;
    const cy0 = (CONTENT.y - img.height / 2) * fit;
    const gap = GAP * fit;
    const cell = (CONTENT.w * fit - gap * (COLS - 1)) / COLS;
    const rows = Math.max(1, Math.ceil(items.length / COLS));
    const gridH = rows * cell + (rows - 1) * gap;
    const offY = Math.max(0, (CONTENT.h * fit - gridH) / 2); // vertically centre the grid in the window
    items.forEach((it, i) => {
      const col = i % COLS, row = Math.floor(i / COLS);
      const sx = cx0 + cell / 2 + col * (cell + gap);
      const sy = cy0 + offY + cell / 2 + row * (cell + gap);
      box.add(this.add.image(sx, sy, ITEM_BG).setDisplaySize(cell, cell));
      if (this.textures.exists(it.iconKey)) {
        const icon = this.add.image(sx, sy, it.iconKey, it.iconFrame);
        icon.setScale((cell * 0.62) / Math.max(icon.width, icon.height));
        box.add(icon);
      }
      box.add(
        this.add
          .text(sx + cell * 0.34, sy + cell * 0.30, String(it.count), {
            fontFamily: dialogFont(),
            fontSize: Math.round(cell * 0.24) + 'px',
            color: '#ffffff',
          })
          .setOrigin(0.5),
      );
    });

    // Slide up into place.
    box.setPosition(restX, H + img.displayHeight);
    this.tweens.add({ targets: box, x: restX, y: restY, duration: 300, ease: 'Back.easeOut' });

    // Close button — anchored to the mailbox's TOP-RIGHT corner (inset down so it
    // clears the Cato portrait at the screen corner); slides up with the box.
    // GameScene reads its REST hit-box (mailboxCloseBounds) and closes ONLY on a hit.
    if (this.textures.exists(CLOSE_ATLAS)) {
      const lx = (img.width / 2 - CLOSE.insetX) * fit;
      const ly = (-img.height / 2 + CLOSE.insetY) * fit;
      box.add(this.add.image(lx, ly, CLOSE_ATLAS, CLOSE_FRAME).setScale(CLOSE.scale));
      const half = (32 * CLOSE.scale) / 2;
      this.registry.set('mailboxCloseBounds', { x: restX + lx - half, y: restY + ly - half, w: half * 2, h: half * 2 });
    }
  }

  private close(): void {
    this.registry.set('mailboxCloseBounds', null);
    if (!this.shown) { this.root?.destroy(); this.root = undefined; return; }
    this.shown = false;
    const root = this.root;
    this.root = undefined;
    if (!root) return;
    this.tweens.add({ targets: root, alpha: 0, duration: 140, onComplete: () => root.destroy() });
  }
}
