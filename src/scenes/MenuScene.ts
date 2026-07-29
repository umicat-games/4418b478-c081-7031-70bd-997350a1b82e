import Phaser from 'phaser';
import { dialogFont } from '../i18n';
import { renderActionMenu, renderKeypad, applyHover, HOVER_TINT, type ActionMenuModel, type MenuBound, type HoverTarget } from './ItemActionMenu';
import type { MailListEntry } from './MailboxScene';

// The UNIFIED menu (Zelda-style): ONE screen with icon TABS — Mail / For-sale / Chest /
// Settings — replacing the separate mailbox + chest + bag modals. Left = the tab's
// content (mail list, or an item grid); centre-top = the tab's TITLE; right = the
// SELECTED item's big image + name/description. Clicking the mailbox or chest at the
// door opens this on the matching tab; you can switch tabs inside. GameScene owns the
// model (`menu` registry key) + all state; this scene renders + publishes hit-boxes.
//
// Interaction: SELECT an item (hover on desktop, tap on touch) → right-side detail;
// CLICK/tap → the action menu (Take/Sell/Delete) too (they don't overlap spatially).
const RES = Math.min(8, Math.max(3, Math.round((typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1) * 3)));
const INK = '#3a2a12', SUB = '#7a6a45';

const SLOT_FRAME = 'slot-light', SLOT_SLICE = { l: 7, r: 7, t: 8, b: 8 }, SLOT_SCALE = 2; // item cell bg (inventory atlas)
// Frames from the `inventory` atlas: panel = `frame-medium` 9-slice (like ConfirmScene),
// tab chip = `medium-brown-tab` (100×23, plain — no 9-patch; unselected is tinted darker).
const ATLAS = 'inventory';
const PANEL_FRAME = 'frame-medium', PANEL_SLICE = { l: 10, r: 10, t: 11, b: 11 }, PANEL_SCALE = 3;
const TAB_TEX = 'medium-brown-tab', TAB_UNSEL_TINT = 0x9a8467;

// Layout in SCREEN fractions (resize-mode canvas). Tuned against screenshots.
// Left cluster shifted DOWN so the left frame's BOTTOM aligns with the right detail
// box's bottom (both at 0.92H). Frame + tabs + title + grid move together.
const L = { x: 0.03, y: 0.18, w: 0.55, h: 0.74 };         // left content panel (0.18–0.92)
const TABS = { y: 0.045, x: 0.05, w: 0.062, h: 0.05, gap: 0.012 }; // icon tab chips (top-left)
const TITLE_Y = 0.215, RULE_Y = 0.255;
const GRID = { x: 0.06, y: 0.30, w: 0.49, cols: 7, rows: 5, gap: 0.008 };
const DETAIL = { imgCx: 0.79, imgCy: 0.34, imgMax: 0.22, panelX: 0.62, panelY: 0.60, panelW: 0.35, panelH: 0.32 };
// The four tabs: icon (ui-icons frame) + i18n-ish title. (Chest/settings frames picked
// from all_icons; swap freely.) Mail=white-message, For-sale=white-shopping-cart.
const TAB_DEFS = [
  { key: 'mail', frame: 245, title: '邮件' },
  { key: 'sale', frame: 262, title: '代售' },
  { key: 'chest', frame: 199, title: '箱子' },
  { key: 'settings', frame: 0, title: '设置' },
];

export interface MenuItem { id?: string; iconKey: string; iconFrame: number | string; count: number; label?: string; desc?: string; }
export interface MenuModel {
  visible: boolean; rev: number;
  tab: number;               // 0 mail · 1 for-sale · 2 chest · 3 settings
  items?: MenuItem[];        // grid (for-sale / chest)
  mails?: MailListEntry[];   // mail list
  selected?: number;         // selected grid index → right detail
}

export class MenuScene extends Phaser.Scene {
  private lastRev = -1;
  private shown = false;
  private prevTab = -1; // last-rendered tab → animate only on a real tab switch
  private root?: Phaser.GameObjects.Container;
  private m?: MenuModel;
  private slotTargets: HoverTarget[] = [];
  private menuTargets: HoverTarget[] = [];
  private hovered: HoverTarget | null = null;
  private menuRoot?: Phaser.GameObjects.Container;
  private menuRev = -1;

  constructor() { super({ key: 'MenuScene' }); }

  update(): void {
    const m = this.registry.get('menu') as MenuModel | undefined;
    if (m && m.rev !== this.lastRev) {
      this.lastRev = m.rev;
      if (m.visible && !this.shown) this.build(m, true);
      else if (m.visible && this.shown) this.build(m, false);
      else this.close();
    }
    const menu = this.registry.get('menuAction') as ActionMenuModel | undefined;
    if (menu && menu.rev !== this.menuRev) { this.menuRev = menu.rev; this.renderMenu(menu); }
    this.updateHover();
  }

  private T(x: number, y: number, s: string, size: number, color: string, origin = 0.5) {
    return this.add.text(x, y, s, { fontFamily: dialogFont(), fontSize: Math.round(size) + 'px', color, resolution: RES }).setOrigin(origin, 0.5);
  }

  private build(m: MenuModel, slide: boolean): void {
    if (this.root) this.tweens.killTweensOf(this.root);
    this.root?.destroy();
    this.shown = true;
    this.m = m;
    this.slotTargets = []; this.hovered = null;
    const tabSwitch = !slide && m.tab !== this.prevTab; // animate content only on a real tab change
    this.prevTab = m.tab;
    const W = this.scale.width, H = this.scale.height;
    const c = this.add.container(0, 0);
    this.root = c;

    // Dim backdrop → tap outside closes (GameScene routes via menuPanel = full screen minus… actually the whole thing is the modal).
    const dim = this.add.rectangle(0, 0, W, H, 0x000000, 0.28).setOrigin(0, 0);
    c.add(dim);

    // Tabs sit ON the frame's TOP-LEFT edge (bottom overlaps into the frame so the
    // brown tab + brown frame border MERGE into one piece — like the reference). Drawn
    // BEFORE the frame so the frame's top border covers the tab's bottom seam.
    const lx = L.x * W, ly = L.y * H, lw = L.w * W, lh = L.h * H;
    // Tabs TOUCH (no gap) + the ACTIVE tab is a bit wider + drawn ON TOP so it covers its
    // neighbours' edges (browser/Zelda tab look). `medium-brown-tab` (100×23) is stretched
    // non-uniformly (width fills the slot, height set taller so the icon isn't cramped).
    const N = TAB_DEFS.length, INSET = lw * 0.02;
    const tabW = (lw - INSET * 2) / N;
    const tabH = H * 0.062;
    const OVERLAP = tabH * 0.22; // the tab's bottom dips a LITTLE into the frame top (merge the border)
    const ACTIVE_OVER = tabW * 0.08; // active tab grows this much on EACH side, over its neighbours
    const ACTIVE_TALLER = 1.14;      // active tab is this much taller (grows UPWARD, bottom stays merged)
    const BOTTOM = ly + OVERLAP;     // every tab's bottom edge (merged into the frame)
    const slotCx = (i: number) => lx + INSET + i * tabW + tabW / 2;
    const tabBounds: Array<{ x: number; y: number; w: number; h: number; tab: number }> = [];
    const tabIcons: Phaser.GameObjects.Image[] = [];
    let activeChip: Phaser.GameObjects.Image | undefined, activeIcon: Phaser.GameObjects.Image | undefined, activeCy = 0, activeH = tabH;
    const drawTab = (i: number) => {
      const active = i === m.tab;
      const w = active ? tabW + ACTIVE_OVER * 2 : tabW;
      const h = active ? tabH * ACTIVE_TALLER : tabH;
      const cy = BOTTOM - h / 2; // bottom pinned → taller tab rises upward
      const chip = this.add.image(slotCx(i), cy, ATLAS, TAB_TEX).setScale(w / 100, h / 23);
      if (!active) chip.setTint(TAB_UNSEL_TINT); else { activeChip = chip; activeCy = cy; activeH = h; }
      c.add(chip);
      let ic: Phaser.GameObjects.Image | undefined;
      if (this.textures.exists('ui-icons')) {
        ic = this.add.image(slotCx(i), cy - OVERLAP / 2, 'ui-icons', TAB_DEFS[i]!.frame).setScale(((tabH - OVERLAP) * 0.7) / 16);
        tabIcons.push(ic);
      }
      if (active) activeIcon = ic;
    };
    TAB_DEFS.forEach((_, i) => { if (i !== m.tab) drawTab(i); }); // inactive first
    if (m.tab >= 0 && m.tab < N) drawTab(m.tab);                  // active LAST → on top
    TAB_DEFS.forEach((_, i) => tabBounds.push({ x: slotCx(i) - tabW / 2, y: BOTTOM - tabH, w: tabW, h: tabH, tab: i })); // hit = base slots
    this.registry.set('menuTabs', tabBounds);

    // Left content panel — `frame-medium` 9-slice ON TOP of the tabs' bottom seam.
    c.add(this.add.nineslice(lx + lw / 2, ly + lh / 2, ATLAS, PANEL_FRAME, lw / PANEL_SCALE, lh / PANEL_SCALE, PANEL_SLICE.l, PANEL_SLICE.r, PANEL_SLICE.t, PANEL_SLICE.b).setScale(PANEL_SCALE));
    tabIcons.forEach((ic) => c.add(ic)); // icons back on top of the frame border

    // Title + rule.
    c.add(this.T(lx + lw / 2, TITLE_Y * H, TAB_DEFS[m.tab]?.title ?? '', H * 0.03, INK));
    const rule = this.add.graphics();
    rule.lineStyle(2, 0x9a9a9a, 1);
    rule.lineBetween(lx + lw * 0.06, RULE_Y * H, lx + lw * 0.94, RULE_Y * H);
    c.add(rule);

    // Content per tab — in its OWN container so a tab SWITCH can animate it independently
    // of the frame/tabs (which stay put).
    const content = this.add.container(0, 0); c.add(content);
    if (m.tab === 3) this.renderSettings(content, lx, lw);
    else if (m.tab === 0) this.renderMailList(content, m.mails ?? []);
    else this.renderGrid(content, m.items ?? [], m.selected);
    if (m.tab === 1 || m.tab === 2) this.renderDetail(content, (m.items ?? [])[m.selected ?? -1]);

    // The whole menu is the modal; tap anywhere OUTSIDE the left panel + right detail
    // + tabs closes it (GameScene checks menuPanel = the union, simplified to "not on a
    // hit target" → we publish the left panel rect; GameScene treats a tap that hits no
    // tab/slot/menu as close).
    this.registry.set('menuPanel', { x: lx, y: TABS.y * H, w: (DETAIL.panelX + DETAIL.panelW) * W - lx, h: lh + (ly - TABS.y * H) });

    if (slide) {
      c.setAlpha(0); this.tweens.add({ targets: c, alpha: 1, duration: 160 });
    } else if (tabSwitch) {
      // Content cross-fades + slides up; the newly-active tab POPS up (rises from a
      // slightly shorter state, bottom pinned so it stays merged with the frame).
      content.setAlpha(0); content.y = H * 0.02;
      this.tweens.add({ targets: content, alpha: 1, y: 0, duration: 190, ease: 'Cubic.easeOut' });
      if (activeChip) {
        const fullSY = activeH / 23, startH = activeH * 0.78;
        activeChip.scaleY = startH / 23; activeChip.y = BOTTOM - startH / 2;
        this.tweens.add({ targets: activeChip, scaleY: fullSY, y: activeCy, duration: 240, ease: 'Back.easeOut' });
      }
      if (activeIcon) {
        const iy = activeCy - OVERLAP / 2;
        activeIcon.y = iy + activeH * 0.14;
        this.tweens.add({ targets: activeIcon, y: iy, duration: 240, ease: 'Back.easeOut' });
      }
    }
  }

  private renderGrid(c: Phaser.GameObjects.Container, items: MenuItem[], selected?: number): void {
    const W = this.scale.width, H = this.scale.height;
    const gx = GRID.x * W, gy = GRID.y * H, gw = GRID.w * W, gap = GRID.gap * W;
    const cell = (gw - gap * (GRID.cols - 1)) / GRID.cols;
    const bounds: Array<{ x: number; y: number; w: number; h: number; index: number }> = [];
    const per = GRID.cols * GRID.rows;
    for (let i = 0; i < per; i++) {
      const col = i % GRID.cols, row = Math.floor(i / GRID.cols);
      const sx = gx + col * (cell + gap), sy = gy + row * (cell + gap);
      const bg = this.add.nineslice(sx + cell / 2, sy + cell / 2, ATLAS, SLOT_FRAME, cell / SLOT_SCALE, cell / SLOT_SCALE, SLOT_SLICE.l, SLOT_SLICE.r, SLOT_SLICE.t, SLOT_SLICE.b).setScale(SLOT_SCALE);
      c.add(bg);
      const it = items[i];
      // Selected = the SAME tinted bg as a hover (no white frame). It's NOT added to the
      // hover targets, so moving the mouse away doesn't clear its highlight.
      if (i === selected && it) bg.setTint(HOVER_TINT);
      if (!it) continue;
      if (this.textures.exists(it.iconKey)) {
        const icon = this.add.image(sx + cell / 2, sy + cell / 2, it.iconKey, it.iconFrame);
        icon.setScale((cell * 0.62) / Math.max(icon.width, icon.height)); c.add(icon);
      }
      c.add(this.T(sx + cell * 0.82, sy + cell * 0.78, String(it.count), cell * 0.26, '#ffffff', 1));
      const sb = { x: sx, y: sy, w: cell, h: cell };
      bounds.push({ ...sb, index: i });
      if (i !== selected) this.slotTargets.push({ ...sb, bg }); // selected stays tinted; others hover-tint
    }
    this.registry.set('menuSlots', bounds);
  }

  private renderDetail(c: Phaser.GameObjects.Container, it?: MenuItem): void {
    const W = this.scale.width, H = this.scale.height;
    // Detail panel (name + description) — `frame-medium`; always drawn, empty when nothing selected.
    const px = DETAIL.panelX * W, py = DETAIL.panelY * H, pw = DETAIL.panelW * W, ph = DETAIL.panelH * H;
    c.add(this.add.nineslice(px + pw / 2, py + ph / 2, ATLAS, PANEL_FRAME, pw / PANEL_SCALE, ph / PANEL_SCALE, PANEL_SLICE.l, PANEL_SLICE.r, PANEL_SLICE.t, PANEL_SLICE.b).setScale(PANEL_SCALE));
    if (!it) return;
    // Big image.
    if (this.textures.exists(it.iconKey)) {
      const img = this.add.image(DETAIL.imgCx * W, DETAIL.imgCy * H, it.iconKey, it.iconFrame);
      img.setScale((DETAIL.imgMax * W) / Math.max(img.width, img.height));
      c.add(img);
    }
    c.add(this.T(px + pw * 0.05, py + ph * 0.16, it.label ?? it.id ?? '', H * 0.028, INK, 0));
    const desc = this.add.text(px + pw * 0.05, py + ph * 0.34, it.desc ?? '', {
      fontFamily: dialogFont(), fontSize: Math.round(H * 0.022) + 'px', color: SUB, resolution: RES, wordWrap: { width: pw * 0.9 },
    }).setOrigin(0, 0);
    c.add(desc);
  }

  private renderMailList(c: Phaser.GameObjects.Container, mails: MailListEntry[]): void {
    const W = this.scale.width, H = this.scale.height;
    const gx = GRID.x * W, gy = GRID.y * H, gw = GRID.w * W;
    const bounds: Array<{ x: number; y: number; w: number; h: number; id: string }> = [];
    if (!mails.length) { c.add(this.T(gx + gw / 2, gy + H * 0.1, '还没有邮件', H * 0.03, SUB)); }
    const rowH = H * 0.09;
    mails.forEach((mail, i) => {
      const ry = gy + i * (rowH + 6);
      const bar = this.add.graphics();
      bar.fillStyle(mail.read ? 0xe7dcc2 : 0xf3ead1, 1); bar.fillRoundedRect(gx, ry, gw, rowH, 8);
      bar.lineStyle(2, 0xd2be95, 1); bar.strokeRoundedRect(gx, ry, gw, rowH, 8); c.add(bar);
      if (this.textures.exists('ui-icons')) {
        const icon = this.add.image(gx + rowH * 0.6, ry + rowH / 2, 'ui-icons', mail.iconFrame);
        icon.setScale((rowH * 0.5) / 16); c.add(icon);
      }
      c.add(this.T(gx + rowH * 1.15, ry + rowH * 0.36, mail.sender, H * 0.026, mail.read ? '#5b4327' : '#3a2a12', 0));
      c.add(this.T(gx + rowH * 1.15, ry + rowH * 0.66, mail.title, H * 0.02, SUB, 0));
      if (!mail.read) { const d = this.add.graphics(); d.fillStyle(0x4aa3df, 1); d.fillCircle(gx + gw - rowH * 0.5, ry + rowH / 2, 6); c.add(d); }
      bounds.push({ x: gx, y: ry, w: gw, h: rowH, id: mail.id });
    });
    this.registry.set('menuMailRows', bounds);
  }

  private renderSettings(c: Phaser.GameObjects.Container, lx: number, lw: number): void {
    const H = this.scale.height;
    c.add(this.T(lx + lw / 2, 0.5 * H, '设置（待补充）', H * 0.03, SUB));
  }

  private renderMenu(m: ActionMenuModel): void {
    this.menuRoot?.destroy(); this.menuRoot = undefined;
    this.menuTargets = []; this.hovered = null;
    this.registry.set('menuActionBounds', [] as MenuBound[]);
    if (!m.visible || !this.shown) return;
    const root = this.add.container(0, 0).setDepth(1000);
    this.menuRoot = root;
    const bounds = m.keypad
      ? renderKeypad(this, root, { x: m.x, y: m.y, value: m.keypad.value, max: m.keypad.max })
      : renderActionMenu(this, root, m);
    this.menuTargets = bounds.filter((b) => b.bg || b.text).map((b) => ({ x: b.x, y: b.y, w: b.w, h: b.h, bg: b.bg, text: b.text, base: b.base, hoverColor: b.hoverColor }));
    this.registry.set('menuActionBounds', bounds);
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

  private close(): void {
    this.registry.set('menuTabs', []); this.registry.set('menuSlots', []); this.registry.set('menuMailRows', []);
    this.registry.set('menuPanel', null); this.registry.set('menuActionBounds', []);
    this.menuRoot?.destroy(); this.menuRoot = undefined; this.menuRev = -1;
    this.slotTargets = []; this.menuTargets = []; this.hovered = null;
    if (!this.shown) { this.root?.destroy(); this.root = undefined; return; }
    this.shown = false;
    const root = this.root; this.root = undefined;
    if (!root) return;
    this.tweens.killTweensOf(root);
    this.tweens.add({ targets: root, alpha: 0, duration: 160, onComplete: () => root.destroy() });
  }
}
