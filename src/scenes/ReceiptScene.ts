import Phaser from 'phaser';
import { dialogFont } from '../i18n';

// The RECEIPT modal — opens when you tap a mail in the mailbox's Mail tab. The
// first mail kind is a SALES RECEIPT (sender "Market Manager"): a wooden panel
// listing every item that sold at the last day-settlement (icon + count + name +
// subtotal), with the grand TOTAL bottom-left and a ✓ button bottom-right. It
// sits ON TOP of the open mailbox; GameScene owns the model (`receipt` registry
// key) and routes taps (✓ / tap-outside → close) — same split as the other modals.
const PANEL = 'inventory';
const PANEL_FRAME = 'frame-medium';
const PANEL_SCALE = 3; // 9-slice corner scale → crisp thick border at this size
const BTN = 'square-buttons';
const BTN_FRAME = 'white-button';
const ICONS = 'ui-icons';
const ICON_OK = 44;       // ✓ dark-brown check
const AVATAR_FRAME = 245; // white-message (placeholder for the Market Manager avatar)
// DPI-aware text resolution → the pixel font stays crisp on high-DPI tablets
// (a flat 3× softened on iPad). Render at ~3× devicePixelRatio, capped.
const RES = Math.min(8, Math.max(3, Math.round((typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1) * 3)));
const SELECT = 0x4aa3df;  // blue selection ring on the ✓ button
const INK = '#5b4327';    // body text
const BAR_FILL = 0xefe4c8;// the cream row bar
const BAR_STROKE = 0xd8c69e;

export interface ReceiptLine { iconKey: string; iconFrame: number | string; label: string; count: number; subtotal: number; }
export interface ReceiptModel { visible: boolean; rev: number; sender: string; title: string; lines: ReceiptLine[]; total: number; claim?: boolean; }

export class ReceiptScene extends Phaser.Scene {
  private lastRev = -1;
  private shown = false;
  private root?: Phaser.GameObjects.Container;
  private box?: Phaser.GameObjects.Container; // the panel group (slides up/down)

  constructor() { super({ key: 'ReceiptScene' }); }

  update(): void {
    const m = this.registry.get('receipt') as ReceiptModel | undefined;
    if (!m || m.rev === this.lastRev) return;
    this.lastRev = m.rev;
    if (m.visible) this.open(m);
    else this.close();
  }

  private open(m: ReceiptModel): void {
    this.root?.destroy();
    this.tweens.killAll();
    this.shown = true;
    const W = this.scale.width, H = this.scale.height;
    const cx = W / 2, cy = H / 2;

    const c = this.add.container(0, 0);
    this.root = c;

    // Dim backdrop (fades in) so the mailbox behind recedes.
    const dim = this.add.rectangle(0, 0, W, H, 0x000000, 0).setOrigin(0, 0);
    this.tweens.add({ targets: dim, alpha: 0.4, duration: 140 });
    c.add(dim);

    // Panel + contents grouped so they slide up as one unit.
    const box = this.add.container(cx, cy);
    this.box = box;
    c.add(box);
    const pw = Math.min(W * 0.66, 980), ph = Math.min(H * 0.72, 780);
    const panel = this.add.nineslice(0, 0, PANEL, PANEL_FRAME, pw / PANEL_SCALE, ph / PANEL_SCALE, 10, 10, 11, 11).setScale(PANEL_SCALE);
    box.add(panel);
    this.registry.set('receiptPanel', { x: cx - pw / 2, y: cy - ph / 2, w: pw, h: ph }); // tap-outside → close

    const fs = Math.max(16, Math.round(ph * 0.04));
    const T = (x: number, y: number, s: string, size: number, color: string) =>
      this.add.text(x, y, s, { fontFamily: dialogFont(), fontSize: size + 'px', color, resolution: RES });

    // Title + underline.
    const title = T(0, -ph / 2 + ph * 0.085, m.title.toUpperCase(), Math.round(fs * 1.35), '#ffffff').setOrigin(0.5);
    box.add(title);
    const rule = this.add.graphics();
    rule.fillStyle(0xa98d63, 1);
    rule.fillRect(-pw * 0.24, -ph / 2 + ph * 0.15, pw * 0.48, Math.max(3, ph * 0.006));
    box.add(rule);

    // Sender avatar (placeholder message icon until a Market Manager avatar exists).
    if (this.textures.exists(ICONS)) {
      const av = this.add.image(0, -ph / 2 + ph * 0.235, ICONS, AVATAR_FRAME);
      av.setScale((ph * 0.11) / Math.max(av.width, av.height));
      box.add(av);
    }

    // Item rows: cream bars, icon + count subscript on the left, name, subtotal right.
    const listTop = -ph / 2 + ph * 0.34;
    const listBot = ph / 2 - ph * 0.16;
    const rowH = Math.min(ph * 0.1, (listBot - listTop) / Math.max(1, m.lines.length));
    const barW = pw * 0.9, barX = -barW / 2;
    m.lines.forEach((ln, i) => {
      const y = listTop + rowH * (i + 0.5);
      const bh = rowH * 0.86;
      const g = this.add.graphics();
      g.fillStyle(BAR_FILL, 1);
      g.fillRoundedRect(barX, y - bh / 2, barW, bh, Math.max(4, bh * 0.22));
      g.lineStyle(Math.max(1, bh * 0.03), BAR_STROKE, 1);
      g.strokeRoundedRect(barX, y - bh / 2, barW, bh, Math.max(4, bh * 0.22));
      box.add(g);
      const iconCx = barX + bh * 0.7;
      if (this.textures.exists(ln.iconKey)) {
        const icon = this.add.image(iconCx, y, ln.iconKey, ln.iconFrame);
        icon.setScale((bh * 0.62) / Math.max(icon.width, icon.height));
        box.add(icon);
        box.add(T(iconCx + bh * 0.24, y + bh * 0.2, String(ln.count), Math.round(fs * 0.72), '#ffffff').setOrigin(0.5));
      }
      box.add(T(barX + bh * 1.25, y, ln.label, fs, INK).setOrigin(0, 0.5));
      box.add(T(barX + barW - bh * 0.35, y, ln.subtotal.toLocaleString(), fs, INK).setOrigin(1, 0.5));
    });

    // TOTAL (bottom-left, sales receipts only — a delivery package has no total) + ✓ button
    // (bottom-right; on a delivery it means 领取/Claim, routed by GameScene).
    if (!m.claim) box.add(T(-pw / 2 + pw * 0.05, ph / 2 - ph * 0.075, `TOTAL: ${m.total.toLocaleString()}`, Math.round(fs * 1.1), '#ffffff').setOrigin(0, 0.5));
    const btnSize = Math.round(ph * 0.11);
    const bx = pw / 2 - pw * 0.08, by = ph / 2 - ph * 0.125;
    const btn = this.add.container(bx, by);
    btn.add(this.add.nineslice(0, 0, BTN, BTN_FRAME, btnSize, btnSize, 6, 6, 7, 7));
    if (this.textures.exists(ICONS)) {
      const ok = this.add.image(0, 0, ICONS, ICON_OK);
      ok.setScale((btnSize * 0.5) / Math.max(ok.width, ok.height));
      btn.add(ok);
    }
    const ring = this.add.graphics();
    ring.lineStyle(Math.max(2, btnSize * 0.06), SELECT, 1);
    ring.strokeRoundedRect(-btnSize / 2 - 3, -btnSize / 2 - 3, btnSize + 6, btnSize + 6, 8);
    btn.add(ring);
    box.add(btn);
    this.registry.set('receiptClose', { x: cx + bx - btnSize / 2, y: cy + by - btnSize / 2, w: btnSize, h: btnSize });

    // Slide the whole thing up from below (mirror of the close).
    box.setY(cy + H * 1.2);
    this.tweens.add({ targets: box, y: cy, duration: 300, ease: 'Back.easeOut' });
  }

  private close(): void {
    this.registry.set('receiptPanel', null);
    this.registry.set('receiptClose', null);
    if (!this.shown) { this.root?.destroy(); this.root = undefined; this.box = undefined; return; }
    this.shown = false;
    const root = this.root;
    const box = this.box;
    this.root = undefined; this.box = undefined;
    if (!root) return;
    this.tweens.killTweensOf(root);
    // Slide the panel back DOWN off the bottom (mirror of the open) while the dim fades.
    if (box) {
      this.tweens.killTweensOf(box);
      this.tweens.add({ targets: box, y: this.scale.height / 2 + this.scale.height * 1.2, duration: 280, ease: 'Back.easeIn' });
    }
    this.tweens.add({ targets: root, alpha: 0, duration: 280, onComplete: () => root.destroy() });
  }
}
