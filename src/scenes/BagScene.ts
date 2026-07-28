import Phaser from 'phaser';
import { dialogFont } from '../i18n';
import type { MailItem } from './MailboxScene';
import { renderActionMenu, renderKeypad, renderSlotPicker, applyHover, type ActionMenuModel, type MenuBound, type HoverTarget } from './ItemActionMenu';

// The BACKPACK (bag) modal — a near-clone of ChestScene, but positioned ABOVE the
// hotbar (so items can be dragged / placed onto the hotbar) instead of centred, and
// it does NOT hide the hotbar. Shows the backpack's items compactly in the bag's
// content window (`bag-item-bg` slots, `bag-zipper` scroll). GameScene owns the model
// (`bag` registry key) + the item→hotbar logic; this scene renders + publishes bounds.
const BAG = 'bag';
const ITEM_BG = 'bag-item-bg';
const SCROLL_THUMB = 'bag-zipper';

// Native-px layout, seeded from bag.png (1706×1426): CONTENT = the inner window;
// SCROLL rail = the right edge. Tuned against screenshots (headless renders black).
const HOTBAR_RESERVE = 140; // px kept clear at the bottom for the hotbar
const FIT_H = 0.98, FIT_W = 0.62;
const X_BIAS = -0.05; // shift the whole bag LEFT so it sits over the (centred) hotbar
// CONTENT ≈ the inner window bounds, so the (shorter) 5×3 grid centres inside it.
const CONTENT = { x: 615, y: 620, w: 780, h: 670 };
const COLS = 5, ROWS = 3;      // 5 cols (6 spilled past the window), 3 rows
const GAP = 16;
const BG_H_MULT = 1.15; // slot bg a bit TALLER than wide → icon + count aren't cramped
// SCROLL rail = the RIGHT dashed zipper line of the window.
const SCROLL = { x: 1440, top: 690, bottom: 1220, thumbScale: 1.0 };

interface BagModel { visible: boolean; rev: number; items?: MailItem[]; }

export class BagScene extends Phaser.Scene {
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
  private gx0 = 0; private gy0 = 0; private cellW = 0; private cellH = 0; private gap = 0;
  private restX = 0; private restY = 0;
  private menuRev = -1;
  private menuRoot?: Phaser.GameObjects.Container;
  private slotTargets: HoverTarget[] = [];
  private menuTargets: HoverTarget[] = [];
  private hovered: HoverTarget | null = null;
  private heldGhost?: Phaser.GameObjects.Container; // dragged item following the cursor
  private heldSig = '';

  constructor() { super({ key: 'BagScene' }); }

  create(): void {
    this.input.on('wheel', (_p: Phaser.Input.Pointer, _o: unknown, _dx: number, dy: number) => {
      if (this.shown && this.pages > 1) {
        this.registry.set('bagPage', Phaser.Math.Clamp(this.page + (dy > 0 ? 1 : -1), 0, this.pages - 1));
      }
    });
  }

  update(): void {
    const m = this.registry.get('bag') as BagModel | undefined;
    if (m && m.rev !== this.lastRev) {
      this.lastRev = m.rev;
      if (m.visible && !this.shown) this.open(m);
      else if (m.visible && this.shown) this.refreshItems(m);
      else this.close();
    } else if (this.shown) {
      const p = (this.registry.get('bagPage') as number) ?? 0;
      if (p !== this.page) this.renderPage(p);
    }
    const menu = this.registry.get('bagMenu') as ActionMenuModel | undefined;
    if (menu && menu.rev !== this.menuRev) { this.menuRev = menu.rev; this.renderMenu(menu); }
    this.updateHover();
    this.renderHeld();
  }

  /** The dragged item's ghost follows the cursor (`bagHeld` from GameScene). */
  private renderHeld(): void {
    const h = this.registry.get('bagHeld') as { iconKey: string; iconFrame: string | number; count: number; x: number; y: number } | null | undefined;
    if (!h || !this.shown) { this.heldGhost?.destroy(); this.heldGhost = undefined; this.heldSig = ''; return; }
    const sig = `${h.iconKey}:${h.iconFrame}:${h.count}`;
    if (sig !== this.heldSig) {
      this.heldGhost?.destroy();
      const g = this.add.container(0, 0).setDepth(2000);
      if (this.textures.exists(h.iconKey)) {
        const icon = this.add.image(0, 0, h.iconKey, h.iconFrame);
        icon.setScale((this.cellW * 0.62) / Math.max(icon.width, icon.height)).setAlpha(0.92);
        g.add(icon);
      }
      if (h.count > 1) g.add(this.add.text(this.cellW * 0.28, this.cellH * 0.22, String(h.count), { fontFamily: dialogFont(), fontSize: Math.round(this.cellW * 0.24) + 'px', color: '#ffffff' }).setOrigin(0.5));
      this.heldGhost = g;
      this.heldSig = sig;
    }
    this.heldGhost?.setPosition(h.x, h.y - 30); // above the finger
  }

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

  private refreshItems(m: BagModel): void {
    this.items = m.items ?? [];
    const per = COLS * ROWS;
    this.pages = Math.max(1, Math.ceil(this.items.length / per));
    this.page = Phaser.Math.Clamp(this.page, 0, this.pages - 1);
    this.registry.set('bagPage', this.page);
    this.registry.set('bagRail', { x: this.restX + (this.thumb?.x ?? 0), top: this.restY + this.thumbTop, bottom: this.restY + this.thumbBot, pages: this.pages });
    this.renderPage(this.page);
  }

  private renderMenu(m: ActionMenuModel): void {
    this.menuRoot?.destroy();
    this.menuRoot = undefined;
    this.menuTargets = []; this.hovered = null;
    this.registry.set('bagMenuBounds', [] as MenuBound[]);
    if (!m.visible || !this.shown) return;
    const root = this.add.container(0, 0).setDepth(1000);
    this.menuRoot = root;
    const bounds = m.slotpick
      ? renderSlotPicker(this, root, { x: m.x, y: m.y, slots: m.slotpick.slots })
      : m.keypad
        ? renderKeypad(this, root, { x: m.x, y: m.y, value: m.keypad.value, max: m.keypad.max })
        : renderActionMenu(this, root, m);
    this.menuTargets = bounds.filter((b) => b.bg || b.text).map((b) => ({ x: b.x, y: b.y, w: b.w, h: b.h, bg: b.bg, text: b.text, base: b.base, hoverColor: b.hoverColor }));
    this.registry.set('bagMenuBounds', bounds);
  }

  private open(m: BagModel): void {
    this.root?.destroy();
    this.tweens.killAll();
    this.shown = true;
    this.page = 0;
    const W = this.scale.width, H = this.scale.height;

    const c = this.add.container(0, 0);
    this.root = c;

    const img = this.add.image(0, 0, BAG);
    const fit = Math.min(((H - HOTBAR_RESERVE) * FIT_H) / img.height, (W * FIT_W) / img.width, 1);
    img.setScale(fit);
    // Anchor ABOVE the hotbar: the bag's bottom sits at H − HOTBAR_RESERVE.
    const bagW = img.width * fit, bagH = img.height * fit;
    const restX = W / 2 + W * X_BIAS, restY = (H - HOTBAR_RESERVE) - bagH / 2;
    this.restX = restX; this.restY = restY;
    img.setPosition(restX, restY);
    c.add(img);
    this.registry.set('bagPanel', { x: restX - bagW / 2, y: restY - bagH / 2, w: bagW, h: bagH }); // for tap-outside-to-close
    const cx = (nx: number) => (nx - img.width / 2) * fit;
    const cy = (ny: number) => (ny - img.height / 2) * fit;

    const content = this.add.container(restX, restY);
    c.add(content);
    const slots = this.add.container(0, 0);
    content.add(slots);
    this.slots = slots;

    this.items = m.items ?? [];
    const per = COLS * ROWS;
    this.pages = Math.max(1, Math.ceil(this.items.length / per));
    this.gap = GAP * fit;
    // Column width fills the window; slot HEIGHT is a bit taller (BG_H_MULT). Grid centred.
    this.cellW = (CONTENT.w * fit - this.gap * (COLS - 1)) / COLS;
    this.cellH = this.cellW * BG_H_MULT;
    const blockW = COLS * this.cellW + (COLS - 1) * this.gap;
    const blockH = ROWS * this.cellH + (ROWS - 1) * this.gap;
    this.gx0 = cx(CONTENT.x) + (CONTENT.w * fit - blockW) / 2;
    this.gy0 = cy(CONTENT.y) + (CONTENT.h * fit - blockH) / 2;

    this.thumbTop = cy(SCROLL.top);
    this.thumbBot = cy(SCROLL.bottom);
    this.thumb = this.add.image(cx(SCROLL.x), this.thumbTop, SCROLL_THUMB).setScale(SCROLL.thumbScale * fit);
    content.add(this.thumb);

    this.registry.set('bagPage', 0);
    this.registry.set('bagRail', { x: restX + cx(SCROLL.x), top: restY + this.thumbTop, bottom: restY + this.thumbBot, pages: this.pages });

    this.renderPage(0);
    // Slide up from below to its resting spot above the hotbar.
    c.setY(H);
    this.tweens.add({ targets: c, y: 0, duration: 300, ease: 'Back.easeOut' });
  }

  private renderPage(p: number): void {
    this.page = Phaser.Math.Clamp(p, 0, this.pages - 1);
    const slots = this.slots;
    if (!slots) return;
    slots.removeAll(true);
    this.slotTargets = []; this.hovered = null;
    const per = COLS * ROWS;
    const pageItems = this.items.slice(this.page * per, this.page * per + per);
    const slotBounds: Array<{ x: number; y: number; w: number; h: number; index: number }> = [];
    for (let i = 0; i < per; i++) {
      const col = i % COLS, row = Math.floor(i / COLS);
      const sx = this.gx0 + this.cellW / 2 + col * (this.cellW + this.gap);
      const sy = this.gy0 + this.cellH / 2 + row * (this.cellH + this.gap);
      // Plain scaled image (NOT 9-slice): the slot renders near the texture's native
      // size, so 9-slice would keep the 36×43 corners at native px → the rounding looks
      // huge. A scaled image keeps the corner proportional to the slot.
      const bg = this.add.image(sx, sy, ITEM_BG).setDisplaySize(this.cellW, this.cellH);
      slots.add(bg);
      const it = pageItems[i];
      if (!it) continue;
      if (this.textures.exists(it.iconKey)) {
        const icon = this.add.image(sx, sy - this.cellH * 0.06, it.iconKey, it.iconFrame);
        icon.setScale((this.cellW * 0.58) / Math.max(icon.width, icon.height));
        slots.add(icon);
      }
      slots.add(
        this.add
          .text(sx + this.cellW * 0.32, sy + this.cellH * 0.30, String(it.count), {
            fontFamily: dialogFont(), fontSize: Math.round(this.cellW * 0.24) + 'px', color: '#ffffff',
          })
          .setOrigin(0.5),
      );
      const sb = { x: this.restX + sx - this.cellW / 2, y: this.restY + sy - this.cellH / 2, w: this.cellW, h: this.cellH };
      slotBounds.push({ ...sb, index: this.page * per + i });
      this.slotTargets.push({ ...sb, bg });
    }
    this.registry.set('bagSlots', slotBounds);
    if (this.thumb) {
      const t = this.pages > 1 ? this.page / (this.pages - 1) : 0;
      this.thumb.setY(this.thumbTop + t * (this.thumbBot - this.thumbTop));
    }
  }

  private close(): void {
    this.registry.set('bagRail', null);
    this.registry.set('bagSlots', []);
    this.registry.set('bagPanel', null);
    this.menuRoot?.destroy(); this.menuRoot = undefined; this.menuRev = -1;
    this.registry.set('bagMenuBounds', []);
    this.slotTargets = []; this.menuTargets = []; this.hovered = null;
    this.heldGhost?.destroy(); this.heldGhost = undefined; this.heldSig = '';
    this.thumb = undefined;
    this.slots = undefined;
    if (!this.shown) { this.root?.destroy(); this.root = undefined; return; }
    this.shown = false;
    const root = this.root;
    this.root = undefined;
    if (!root) return;
    this.tweens.add({ targets: root, y: this.scale.height, duration: 300, ease: 'Back.easeIn', onComplete: () => root.destroy() });
  }
}
