import Phaser from 'phaser';
import { dialogFont } from '../i18n';
import { renderActionMenu, renderKeypad, applyHover, type ActionMenuModel, type MenuBound, type HoverTarget } from './ItemActionMenu';

// The mailbox modal: click the mailbox → the big open mailbox (`mail-box.png`)
// SLIDES UP from below; its content window shows ONE PAGE of mail (5×3 = 15 items,
// mail-box-item-bg slot + icon + count), fading in. A close button (icon-buttons
// `close-light-big`) at the mailbox's top-right is the ONLY way to close. Overflow
// PAGES: flip pages with the mouse wheel OR by dragging the right-hand rail (the
// envelope-zipper thumb) — GameScene routes BOTH the close + the rail drag (a
// cross-scene interactive drag on the thumb is unreliable), driving the current
// page via the `mailboxPage` registry value that this scene renders.
const MAILBOX = 'mailbox-v2';
const ITEM_BG = 'mail-box-item-bg';
const SCROLL_THUMB = 'envelope-zipper';

// Native-px, seeded from mailbox-v2.png (1042×1364). Tabs straddle the content
// window's TOP-LEFT; the grid + scroll rail fill the window below them.
const FIT_H = 0.94, FIT_W = 0.6, X_BIAS = 0; // centred on screen
const CONTENT = { x: 130, y: 540, w: 770, h: 500 };
const COLS = 5, ROWS = 3;      // one page = 5×3 = 15 items
const GAP = 16;
const SCROLL = { x: 950, top: 580, bottom: 1010, thumbScale: 1.0 };
// Two tabs at the window top-left: Mail (green) + Items (blue). Selected art is taller
// (154 vs 122). TOP-aligned: every tab's TOP edge sits on the border line (`topY`), so
// the shorter unselected art doesn't drop below it — the selected one just extends lower.
const TAB = { topY: 346, w: 128, selH: 154, unselH: 122, cx: [240, 402] };
// DPI-aware text resolution: the pixel font's thin strokes soften on high-DPI
// tablets when the glyph texture doesn't have enough DEVICE pixels (the mail list
// text at a fractional `fit` size looked fuzzy on iPad). Render at ~3× the screen's
// devicePixelRatio (capped) so the downscale stays crisp everywhere.
const TEXT_RES = Math.min(8, Math.max(3, Math.round((typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1) * 3)));

export interface MailItem { id?: string; iconKey: string; iconFrame: number | string; count: number; }
// One row in the Mail tab: a list icon (ui-icons frame) + the sender's name.
export interface MailListEntry { id: string; sender: string; title: string; iconFrame: number; read: boolean; }
export interface MailboxModel { visible: boolean; rev: number; items?: MailItem[]; mails?: MailListEntry[]; tab?: number; }

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
  // Mouse-hover: tint the bg TEXTURE of the slot / keypad button under the pointer.
  private slotTargets: HoverTarget[] = [];
  private menuTargets: HoverTarget[] = [];
  private hovered: HoverTarget | null = null;
  private tab = 1; // 0 = Mail list, 1 = Items
  private prevTab = -1; // last-rendered tab → detect a real switch (for the select anim)

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
      if (m.visible && !this.shown) this.build(m, true);       // first open → slide up
      else if (m.visible && this.shown) this.build(m, false);  // in-place (tab switch / item change)
      else this.close();
    } else if (this.shown && this.tab === 1) {
      // Page changes (wheel here, rail-drag from GameScene) arrive via `mailboxPage`.
      const p = (this.registry.get('mailboxPage') as number) ?? 0;
      if (p !== this.page) this.renderPage(p);
    }
    // The item action menu (GameScene sets `mailboxMenu`; we render + publish bounds).
    const menu = this.registry.get('mailboxMenu') as ActionMenuModel | undefined;
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

  /** Render / clear the contextual item action menu. */
  private renderMenu(m: ActionMenuModel): void {
    this.menuRoot?.destroy();
    this.menuRoot = undefined;
    this.menuTargets = []; this.hovered = null;
    this.registry.set('mailboxMenuBounds', [] as MenuBound[]);
    if (!m.visible || !this.shown) return;
    const root = this.add.container(0, 0).setDepth(1000);
    this.menuRoot = root;
    const bounds = m.keypad
      ? renderKeypad(this, root, { x: m.x, y: m.y, value: m.keypad.value, max: m.keypad.max })
      : renderActionMenu(this, root, m);
    this.menuTargets = bounds.filter((b) => b.bg || b.text).map((b) => ({ x: b.x, y: b.y, w: b.w, h: b.h, bg: b.bg, text: b.text, base: b.base, hoverColor: b.hoverColor }));
    this.registry.set('mailboxMenuBounds', bounds);
  }

  /** Build the whole modal (frame + tabs + the active tab's view). `slide` = first
   *  open (slide up); false = in-place rebuild (tab switch / item change). */
  private build(m: MailboxModel, slide: boolean): void {
    if (this.root) this.tweens.killTweensOf(this.root);
    this.root?.destroy();
    this.shown = true;
    this.tab = m.tab ?? this.tab;
    const W = this.scale.width, H = this.scale.height;

    const c = this.add.container(0, 0);
    this.root = c;

    const img = this.add.image(0, 0, MAILBOX);
    const fit = Math.min((H * FIT_H) / img.height, (W * FIT_W) / img.width, 1);
    img.setScale(fit);
    const restX = W / 2 + W * X_BIAS, restY = H / 2;
    this.restX = restX; this.restY = restY;
    img.setPosition(restX, restY);
    c.add(img);
    const cx = (nx: number) => (nx - img.width / 2) * fit;
    const cy = (ny: number) => (ny - img.height / 2) * fit;
    this.registry.set('mailboxPanel', { x: restX - (img.width * fit) / 2, y: restY - (img.height * fit) / 2, w: img.width * fit, h: img.height * fit });

    // Animate the selected tab ONLY on a real switch (not first open / item refresh).
    const animateSelected = !slide && this.tab !== this.prevTab;
    this.prevTab = this.tab;
    this.renderTabs(c, restX, restY, cx, cy, fit, animateSelected);

    const content = this.add.container(restX, restY);
    c.add(content);

    if (this.tab === 1) {
      // ── ITEMS view ──
      this.registry.set('mailboxMailRows', []);
      const slots = this.add.container(0, 0);
      content.add(slots);
      this.slots = slots;
      this.items = m.items ?? [];
      const per = COLS * ROWS;
      this.pages = Math.max(1, Math.ceil(this.items.length / per));
      this.page = Phaser.Math.Clamp(this.page, 0, this.pages - 1);
      this.gap = GAP * fit;
      this.cell = (CONTENT.w * fit - this.gap * (COLS - 1)) / COLS;
      const blockH = ROWS * this.cell + (ROWS - 1) * this.gap;
      this.gx0 = cx(CONTENT.x);
      this.gy0 = cy(CONTENT.y) + (CONTENT.h * fit - blockH) / 2;
      this.thumbTop = cy(SCROLL.top);
      this.thumbBot = cy(SCROLL.bottom);
      this.thumb = this.add.image(cx(SCROLL.x), this.thumbTop, SCROLL_THUMB).setScale(SCROLL.thumbScale * fit);
      content.add(this.thumb);
      this.registry.set('mailboxRail', { x: restX + cx(SCROLL.x), top: restY + this.thumbTop, bottom: restY + this.thumbBot, pages: this.pages });
      this.renderPage(this.page);
    } else {
      // ── MAIL view — a list of mails (icon + sender), newest first ──
      this.slots = undefined; this.thumb = undefined;
      this.slotTargets = []; this.hovered = null;
      this.registry.set('mailboxRail', null);
      this.registry.set('mailboxSlots', []);
      const mails = m.mails ?? [];
      if (!mails.length) {
        content.add(this.add.text(cx(CONTENT.x + CONTENT.w / 2), cy(CONTENT.y + CONTENT.h / 2), 'No mail yet', {
          fontFamily: dialogFont(), fontSize: Math.round(44 * fit) + 'px', color: '#8a7a52', resolution: TEXT_RES,
        }).setOrigin(0.5));
        this.registry.set('mailboxMailRows', []);
      } else {
        content.add(this.renderMailList(mails, restX, restY, cx, cy, fit));
      }
    }

    if (slide) { c.setY(H * 1.15); this.tweens.add({ targets: c, y: 0, duration: 300, ease: 'Back.easeOut' }); }
    else c.setY(0);
  }

  /** Two tabs at the window top-left (Mail / Items). Active = the taller art. Publishes
   *  `mailboxTabs` (screen bounds + tab index) for GameScene to route taps. */
  private renderTabs(c: Phaser.GameObjects.Container, restX: number, restY: number, cx: (n: number) => number, cy: (n: number) => number, fit: number, animateSelected: boolean): void {
    // Icons live in `all_icons.png` (loaded as the 16×16 `ui-icons` spritesheet):
    // white-message = frame 245 (Mail), white-shopping-cart = frame 262 (Items).
    const defs = [
      { tab: 0, sel: 'tab-green', unsel: 'tab-green-unselected', icon: 245 }, // Mail
      { tab: 1, sel: 'tab-blue', unsel: 'tab-blue-unselected', icon: 262 },   // Items
    ];
    const bounds: Array<{ x: number; y: number; w: number; h: number; tab: number }> = [];
    defs.forEach((d, i) => {
      const selected = this.tab === d.tab;
      const key = selected ? d.sel : d.unsel;
      const tx = restX + cx(TAB.cx[i]!);
      const ty = restY + cy(TAB.topY); // TOP edge on the border line
      // Tab art + icon share ONE container (origin = its x/y = the top-centre), so the
      // select anim scales BOTH together — the icon unfolds with the tab, no split.
      const box = this.add.container(tx, ty);
      c.add(box);
      const img = this.add.image(0, 0, key).setOrigin(0.5, 0).setScale(fit);
      const icon = this.add.image(0, TAB.unselH * 0.5 * fit, 'ui-icons', d.icon).setScale(fit * 4.6);
      box.add([img, icon]);
      // Select anim: the whole tab "unfolds" DOWNWARD (top pinned) with a little
      // overshoot, preceded by a quick upward lift — the "抽一下再向下展开" feel.
      if (selected && animateSelected) {
        box.setScale(1, 0.45);
        box.y = ty - 14 * fit;
        this.tweens.add({ targets: box, y: ty, scaleY: 1, duration: 300, ease: 'Back.easeOut' });
      }
      // Bounds off the FULL size (not the animated scaleY) so the hit-box stays correct.
      const bw = img.width * fit, bh = img.height * fit;
      bounds.push({ x: tx - bw / 2, y: ty, w: bw, h: bh, tab: d.tab });
    });
    this.registry.set('mailboxTabs', bounds);
  }

  /** Render the Mail-tab list (icon + sender + subtitle, unread dot) and publish the
   *  per-row screen bounds (`mailboxMailRows`) so GameScene routes a tap → its receipt. */
  private renderMailList(mails: MailListEntry[], restX: number, restY: number, cx: (n: number) => number, cy: (n: number) => number, fit: number): Phaser.GameObjects.Container {
    const list = this.add.container(0, 0);
    const rowH = 96;            // native px per row
    const y0 = CONTENT.y + 20;  // first row top (native)
    const iconX = CONTENT.x + 46;
    const textX = CONTENT.x + 96;
    const bounds: Array<{ x: number; y: number; w: number; h: number; id: string }> = [];
    mails.forEach((mail, i) => {
      const rowTopN = y0 + i * rowH;
      const rowCyN = rowTopN + rowH / 2;
      // A light cream bar behind each row → text always reads, whatever the panel colour.
      const barTopN = rowTopN + 6, barBotN = rowTopN + rowH - 6;
      const barX = cx(CONTENT.x + 6), barY = cy(barTopN);
      const barW = (CONTENT.w - 12) * fit, barH = (barBotN - barTopN) * fit;
      const bar = this.add.graphics();
      bar.fillStyle(mail.read ? 0xe7dcc2 : 0xf3ead1, 1); // unread slightly brighter
      bar.fillRoundedRect(barX, barY, barW, barH, Math.max(4, 10 * fit));
      bar.lineStyle(Math.max(1, 2 * fit), 0xd2be95, 1);
      bar.strokeRoundedRect(barX, barY, barW, barH, Math.max(4, 10 * fit));
      list.add(bar);
      // Message icon.
      const icon = this.add.image(cx(iconX), cy(rowCyN), 'ui-icons', mail.iconFrame).setScale(fit * 3.4);
      list.add(icon);
      // Sender (dark, high-contrast) + the mail title as a subtitle.
      list.add(this.add.text(cx(textX), cy(rowCyN - 16), mail.sender, {
        fontFamily: dialogFont(), fontSize: Math.round(34 * fit) + 'px', color: mail.read ? '#5b4327' : '#3a2a12', resolution: TEXT_RES,
      }).setOrigin(0, 0.5));
      list.add(this.add.text(cx(textX), cy(rowCyN + 20), mail.title, {
        fontFamily: dialogFont(), fontSize: Math.round(24 * fit) + 'px', color: '#7a6034', resolution: TEXT_RES,
      }).setOrigin(0, 0.5));
      // Unread dot on the right.
      if (!mail.read) {
        const dot = this.add.graphics();
        dot.fillStyle(0x4aa3df, 1);
        dot.fillCircle(cx(CONTENT.x + CONTENT.w - 40), cy(rowCyN), Math.max(4, 10 * fit));
        list.add(dot);
      }
      bounds.push({ x: restX + cx(CONTENT.x), y: restY + cy(rowTopN), w: CONTENT.w * fit, h: rowH * fit, id: mail.id });
    });
    this.registry.set('mailboxMailRows', bounds);
    return list;
  }

  /** Rebuild the item slots for page `p` + move the thumb to match. */
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
      // SCREEN-space hit-box (slots live inside `content` at restX/restY) → GameScene
      // routes a tap on it to the item action menu.
      const sb = { x: this.restX + sx - this.cell / 2, y: this.restY + sy - this.cell / 2, w: this.cell, h: this.cell };
      slotBounds.push({ ...sb, index: this.page * per + i });
      this.slotTargets.push({ ...sb, bg }); // hover tints this bg
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
    this.registry.set('mailboxMailRows', []);
    this.registry.set('mailboxTabs', []);
    this.registry.set('mailboxPanel', null);
    this.menuRoot?.destroy(); this.menuRoot = undefined; this.menuRev = -1;
    this.registry.set('mailboxMenuBounds', []);
    this.slotTargets = []; this.menuTargets = []; this.hovered = null;
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
