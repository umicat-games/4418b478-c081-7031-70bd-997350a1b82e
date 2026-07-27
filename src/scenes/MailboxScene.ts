import Phaser from 'phaser';
import { dialogFont } from '../i18n';
import { renderActionMenu, renderKeypad, type ActionMenuModel, type MenuBound } from './ItemActionMenu';

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
const SCROLL = { x: 976, top: 570, bottom: 1032, thumbScale: 1.0 };
const CLOSE = { insetX: 120, insetY: 210, scale: 2 };

export interface MailItem { id?: string; iconKey: string; iconFrame: number | string; count: number; }
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
  private restX = 0; private restY = 0; // modal centre (screen px) → slot-bounds mapping
  private menuRev = -1;
  private menuRoot?: Phaser.GameObjects.Container; // the item action menu (Take/Delete/…)

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
      if (m.visible && !this.shown) this.open(m);       // first open → slide up
      else if (m.visible && this.shown) this.refreshItems(m); // in-place (after an action)
      else this.close();
    } else if (this.shown) {
      // Page changes (wheel here, rail-drag from GameScene) arrive via `mailboxPage`.
      const p = (this.registry.get('mailboxPage') as number) ?? 0;
      if (p !== this.page) this.renderPage(p);
    }
    // The item action menu (GameScene sets `mailboxMenu`; we render + publish bounds).
    const menu = this.registry.get('mailboxMenu') as ActionMenuModel | undefined;
    if (menu && menu.rev !== this.menuRev) { this.menuRev = menu.rev; this.renderMenu(menu); }
  }

  /** Rebuild the item grid IN PLACE (no re-slide) after an action changed the store. */
  private refreshItems(m: MailboxModel): void {
    this.items = m.items ?? [];
    const per = COLS * ROWS;
    this.pages = Math.max(1, Math.ceil(this.items.length / per));
    this.page = Phaser.Math.Clamp(this.page, 0, this.pages - 1);
    this.registry.set('mailboxPage', this.page);
    this.registry.set('mailboxRail', { x: this.restX + (this.thumb?.x ?? 0), top: this.restY + this.thumbTop, bottom: this.restY + this.thumbBot, pages: this.pages });
    this.renderPage(this.page);
  }

  /** Render / clear the contextual item action menu. */
  private renderMenu(m: ActionMenuModel): void {
    this.menuRoot?.destroy();
    this.menuRoot = undefined;
    this.registry.set('mailboxMenuBounds', [] as MenuBound[]);
    if (!m.visible || !this.shown) return;
    const root = this.add.container(0, 0).setDepth(1000);
    this.menuRoot = root;
    const bounds = m.keypad
      ? renderKeypad(this, root, { x: m.x, y: m.y, value: m.keypad.value, max: m.keypad.max })
      : renderActionMenu(this, root, m);
    this.registry.set('mailboxMenuBounds', bounds);
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
    this.restX = restX; this.restY = restY; // slots publish screen bounds off this
    const cx = (nx: number) => (nx - img.width / 2) * fit;
    const cy = (ny: number) => (ny - img.height / 2) * fit;

    // Close is the top-right HUD button that swaps in for the Cato photo-frame
    // (GameScene.setModalChrome) — the modal no longer draws its own X.
    box.setPosition(restX, restY);

    // Item layer (same local frame as `box`; slides up WITH it as one unit).
    const content = this.add.container(restX, restY);
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
    // Slide the WHOLE modal (frame + items + thumb) up from below as ONE unit —
    // the mirror of the close slide, so it reads as a single object.
    c.setY(H * 1.15);
    this.tweens.add({ targets: c, y: 0, duration: 300, ease: 'Back.easeOut' });
  }

  /** Rebuild the item slots for page `p` + move the thumb to match. */
  private renderPage(p: number): void {
    this.page = Phaser.Math.Clamp(p, 0, this.pages - 1);
    const slots = this.slots;
    if (!slots) return;
    slots.removeAll(true);
    const per = COLS * ROWS;
    const pageItems = this.items.slice(this.page * per, this.page * per + per);
    const slotBounds: Array<{ x: number; y: number; w: number; h: number; index: number }> = [];
    // ALWAYS draw the full COLS×ROWS grid of slot backgrounds (empty cells keep their
    // bg) — only the filled cells get an icon + count + a clickable hit-box.
    for (let i = 0; i < per; i++) {
      const col = i % COLS, row = Math.floor(i / COLS);
      const sx = this.gx0 + this.cell / 2 + col * (this.cell + this.gap);
      const sy = this.gy0 + this.cell / 2 + row * (this.cell + this.gap);
      slots.add(this.add.image(sx, sy, ITEM_BG).setDisplaySize(this.cell, this.cell));
      const it = pageItems[i];
      if (!it) continue;
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
      // SCREEN-space hit-box (slots live inside `content` at restX/restY) → GameScene
      // routes a tap on it to the item action menu.
      slotBounds.push({ x: this.restX + sx - this.cell / 2, y: this.restY + sy - this.cell / 2, w: this.cell, h: this.cell, index: this.page * per + i });
    }
    this.registry.set('mailboxSlots', slotBounds);
    if (this.thumb) {
      const t = this.pages > 1 ? this.page / (this.pages - 1) : 0;
      this.thumb.setY(this.thumbTop + t * (this.thumbBot - this.thumbTop));
    }
  }

  private close(): void {
    this.registry.set('mailboxRail', null);
    this.registry.set('mailboxSlots', []);
    this.menuRoot?.destroy(); this.menuRoot = undefined; this.menuRev = -1;
    this.registry.set('mailboxMenuBounds', []);
    this.thumb = undefined;
    this.slots = undefined;
    if (!this.shown) { this.root?.destroy(); this.root = undefined; return; }
    this.shown = false;
    const root = this.root;
    this.root = undefined;
    if (!root) return;
    this.tweens.killTweensOf(root);
    // Reverse of the open — the whole modal SLIDES back DOWN off the bottom.
    this.tweens.add({
      targets: root,
      y: this.scale.height * 1.15,
      duration: 300,
      ease: 'Back.easeIn',
      onComplete: () => root.destroy(),
    });
  }
}
