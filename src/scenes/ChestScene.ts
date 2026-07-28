import Phaser from 'phaser';
import { dialogFont } from '../i18n';
import type { MailItem } from './MailboxScene';
import { renderActionMenu, renderKeypad, applyHover, type ActionMenuModel, type MenuBound, type HoverTarget } from './ItemActionMenu';

// The chest modal — the mirror of MailboxScene. Click the placed chest → the big
// open chest (`chest-full-size.png`) SLIDES UP from below; its content window shows
// ONE PAGE of items (5×3 = 15, mail-box-item-bg slot + icon + count). A close button
// (icon-buttons `close-light-big`, reused) at the top-right is the ONLY way to close.
// Overflow PAGES: wheel here, or drag the right-rail zipper (`chest-full-zipper`) —
// GameScene routes the close + rail drag, driving `chestPage` which this scene renders.
const CHEST = 'chest-full';
const ITEM_BG = 'mail-box-item-bg';       // reuse the mailbox item slot bg
const SCROLL_THUMB = 'chest-full-zipper';
const CLOSE_ATLAS = 'icon-buttons';        // reuse the mailbox close button
const CLOSE_FRAME = 'close-light-big';

// Seeded from chest-full-size.png (1290×1393): content window = the lower brown
// area; SCROLL rail = the right zipper (gold caps ~y595–1095); CLOSE = top-right.
// All native-px; tuned against screenshots (headless renders black).
const FIT_H = 0.94, FIT_W = 0.6, X_BIAS = 0; // centred on screen
const CONTENT = { x: 195, y: 510, w: 850, h: 610 };
const COLS = 5, ROWS = 3;      // one page = 5×3 = 15 items
const GAP = 16;
const SCROLL = { x: 1095, top: 630, bottom: 1075, thumbScale: 1.0 };
const CLOSE = { insetX: 130, insetY: 120, scale: 2 };

interface ChestModel { visible: boolean; rev: number; items?: MailItem[]; }

export class ChestScene extends Phaser.Scene {
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
  private menuRoot?: Phaser.GameObjects.Container; // the item action menu (Take/Sell/Delete)
  // Mouse-hover: tint the bg TEXTURE of the slot / keypad button under the pointer.
  private slotTargets: HoverTarget[] = [];
  private menuTargets: HoverTarget[] = [];
  private hovered: HoverTarget | null = null;

  constructor() {
    super({ key: 'ChestScene' });
  }

  create(): void {
    this.input.on('wheel', (_p: Phaser.Input.Pointer, _o: unknown, _dx: number, dy: number) => {
      if (this.shown && this.pages > 1) {
        this.registry.set('chestPage', Phaser.Math.Clamp(this.page + (dy > 0 ? 1 : -1), 0, this.pages - 1));
      }
    });
  }

  update(): void {
    const m = this.registry.get('chest') as ChestModel | undefined;
    if (m && m.rev !== this.lastRev) {
      this.lastRev = m.rev;
      if (m.visible && !this.shown) this.open(m);
      else if (m.visible && this.shown) this.refreshItems(m);
      else this.close();
    } else if (this.shown) {
      const p = (this.registry.get('chestPage') as number) ?? 0;
      if (p !== this.page) this.renderPage(p);
    }
    const menu = this.registry.get('chestMenu') as ActionMenuModel | undefined;
    if (menu && menu.rev !== this.menuRev) { this.menuRev = menu.rev; this.renderMenu(menu); }
    this.updateHover();
  }

  /** Mouse-hover: tint the bg TEXTURE of the slot / keypad button under the pointer
   *  (touch has no hover). Popup buttons are the target when open, else item slots. */
  private updateHover(): void {
    const p = this.input.activePointer;
    const targets = this.menuRoot ? this.menuTargets : this.slotTargets;
    const hit = (!this.shown || p.wasTouch) ? null
      : (targets.find((t) => p.x >= t.x && p.x <= t.x + t.w && p.y >= t.y && p.y <= t.y + t.h) ?? null);
    if (hit === this.hovered) return;
    applyHover(this.hovered, false);
    this.hovered = hit;
    applyHover(hit, true);
  }

  /** Rebuild the item grid IN PLACE (no re-slide) after an action changed the store. */
  private refreshItems(m: ChestModel): void {
    this.items = m.items ?? [];
    const per = COLS * ROWS;
    this.pages = Math.max(1, Math.ceil(this.items.length / per));
    this.page = Phaser.Math.Clamp(this.page, 0, this.pages - 1);
    this.registry.set('chestPage', this.page);
    this.registry.set('chestRail', { x: this.restX + (this.thumb?.x ?? 0), top: this.restY + this.thumbTop, bottom: this.restY + this.thumbBot, pages: this.pages });
    this.renderPage(this.page);
  }

  /** Render / clear the contextual item action menu. */
  private renderMenu(m: ActionMenuModel): void {
    this.menuRoot?.destroy();
    this.menuRoot = undefined;
    this.menuTargets = []; this.hovered = null;
    this.registry.set('chestMenuBounds', [] as MenuBound[]);
    if (!m.visible || !this.shown) return;
    const root = this.add.container(0, 0).setDepth(1000);
    this.menuRoot = root;
    const bounds = m.keypad
      ? renderKeypad(this, root, { x: m.x, y: m.y, value: m.keypad.value, max: m.keypad.max })
      : renderActionMenu(this, root, m);
    this.menuTargets = bounds.filter((b) => b.bg || b.text).map((b) => ({ x: b.x, y: b.y, w: b.w, h: b.h, bg: b.bg, text: b.text, base: b.base, hoverColor: b.hoverColor }));
    this.registry.set('chestMenuBounds', bounds);
  }

  private open(m: ChestModel): void {
    this.root?.destroy();
    this.tweens.killAll();
    this.shown = true;
    this.page = 0;
    const W = this.scale.width, H = this.scale.height;

    const c = this.add.container(0, 0);
    this.root = c;

    const box = this.add.container(0, 0);
    c.add(box);
    const img = this.add.image(0, 0, CHEST);
    const fit = Math.min((H * FIT_H) / img.height, (W * FIT_W) / img.width, 1);
    img.setScale(fit);
    box.add(img);
    const restX = W / 2 + W * X_BIAS, restY = H / 2;
    this.restX = restX; this.restY = restY; // slots publish screen bounds off this
    const cx = (nx: number) => (nx - img.width / 2) * fit;
    const cy = (ny: number) => (ny - img.height / 2) * fit;

    box.setPosition(restX, restY);
    this.registry.set('chestPanel', { x: restX - (img.width * fit) / 2, y: restY - (img.height * fit) / 2, w: img.width * fit, h: img.height * fit }); // tap-outside-to-close

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
    this.gy0 = cy(CONTENT.y) + (CONTENT.h * fit - blockH) / 2;

    this.thumbTop = cy(SCROLL.top);
    this.thumbBot = cy(SCROLL.bottom);
    this.thumb = this.add.image(cx(SCROLL.x), this.thumbTop, SCROLL_THUMB).setScale(SCROLL.thumbScale * fit);
    content.add(this.thumb);

    this.registry.set('chestPage', 0);
    this.registry.set('chestRail', { x: restX + cx(SCROLL.x), top: restY + this.thumbTop, bottom: restY + this.thumbBot, pages: this.pages });

    this.renderPage(0);
    c.setY(H * 1.15);
    this.tweens.add({ targets: c, y: 0, duration: 300, ease: 'Back.easeOut' });
  }

  private renderPage(p: number): void {
    this.page = Phaser.Math.Clamp(p, 0, this.pages - 1);
    const slots = this.slots;
    if (!slots) return;
    slots.removeAll(true);
    this.slotTargets = []; this.hovered = null; // bg refs are recreated below
    const per = COLS * ROWS;
    const pageItems = this.items.slice(this.page * per, this.page * per + per);
    const slotBounds: Array<{ x: number; y: number; w: number; h: number; index: number }> = [];
    // ALWAYS draw the full COLS×ROWS grid of slot backgrounds (empty cells keep their
    // bg) — only the filled cells get an icon + count + a clickable hit-box.
    for (let i = 0; i < per; i++) {
      const col = i % COLS, row = Math.floor(i / COLS);
      const sx = this.gx0 + this.cell / 2 + col * (this.cell + this.gap);
      const sy = this.gy0 + this.cell / 2 + row * (this.cell + this.gap);
      const bg = this.add.image(sx, sy, ITEM_BG).setDisplaySize(this.cell, this.cell);
      slots.add(bg);
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
      const sb = { x: this.restX + sx - this.cell / 2, y: this.restY + sy - this.cell / 2, w: this.cell, h: this.cell };
      slotBounds.push({ ...sb, index: this.page * per + i });
      this.slotTargets.push({ ...sb, bg }); // hover tints this bg
    }
    this.registry.set('chestSlots', slotBounds);
    if (this.thumb) {
      const t = this.pages > 1 ? this.page / (this.pages - 1) : 0;
      this.thumb.setY(this.thumbTop + t * (this.thumbBot - this.thumbTop));
    }
  }

  private close(): void {
    this.registry.set('chestRail', null);
    this.registry.set('chestSlots', []);
    this.registry.set('chestPanel', null);
    this.menuRoot?.destroy(); this.menuRoot = undefined; this.menuRev = -1;
    this.registry.set('chestMenuBounds', []);
    this.slotTargets = []; this.menuTargets = []; this.hovered = null;
    this.thumb = undefined;
    this.slots = undefined;
    if (!this.shown) { this.root?.destroy(); this.root = undefined; return; }
    this.shown = false;
    const root = this.root;
    this.root = undefined;
    if (!root) return;
    this.tweens.killTweensOf(root);
    this.tweens.add({
      targets: root,
      y: this.scale.height * 1.15,
      duration: 300,
      ease: 'Back.easeIn',
      onComplete: () => root.destroy(),
    });
  }
}
