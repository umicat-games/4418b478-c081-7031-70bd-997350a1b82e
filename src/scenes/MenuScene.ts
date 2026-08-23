import Phaser from 'phaser';
import { dialogFont, t } from '../i18n';
import { renderActionMenu, renderKeypad, renderSlotPicker, applyHover, HOVER_TINT, type ActionMenuModel, type MenuBound, type HoverTarget } from './ItemActionMenu';
import { getBgmVolume } from '../bgm';
import { getSfxVolume, playSfx, SFX_HOVER } from '../sfx';
import { DEBUG_FLAGS, DEBUG_PANEL, isDebug } from '../debug';
import type { MailListEntry } from './menu-types';
import type { ReceiptLine } from './ReceiptScene';

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
const WHEEL_MS = 110; // min ms between wheel-scroll rows (tames trackpad event bursts)
const DIM_ALPHA = 0.82; // full-screen mask darkening the game behind the menu (deep)
// Close button — top-right but BELOW the Cato portrait (which lives at the very top-right
// corner; the X was landing on it → clicking it opened the chat).
const CLOSE = { atlas: 'icon-buttons', frame: 'close-light-big', x: 0.525, y: 0.235, size: 0.06 }; // INSIDE the left frame, top-right corner (frame is x 0.03–0.58; content grid/list starts at 0.30, so this sits above it)
const CLOSE_PRESSED = 'close-light-big-pressed-down'; // brief click-flash frame on the X

// Layout in SCREEN fractions (resize-mode canvas). Tuned against screenshots.
// Left cluster shifted DOWN so the left frame's BOTTOM aligns with the right detail
// box's bottom (both at 0.92H). Frame + tabs + title + grid move together.
const L = { x: 0.03, y: 0.18, w: 0.55, h: 0.74 };         // left content panel (0.18–0.92)
const TABS = { y: 0.045, x: 0.05, w: 0.062, h: 0.05, gap: 0.012 }; // icon tab chips (top-left)
const TITLE_Y = 0.238; // a bit lower — was cramped against the frame top
// w leaves a strip on the right (grid ends at 0.52) for the scroll bar.
const GRID = { x: 0.06, y: 0.30, w: 0.46, cols: 7, rows: 5, gap: 0.008 };
const CATOBAG_ROWS = 3; // Cato's bag is small — fewer rows than the chest
const MAIL = { rowH: 0.09, gapPx: 6, bottom: 0.88 }; // mail-list row metrics + viewport bottom
const RAIL_DX = 0.016; // scroll bar x-offset past the grid/list right edge
const DETAIL = { imgCx: 0.79, imgCy: 0.34, imgMax: 0.22, panelX: 0.62, panelY: 0.60, panelW: 0.35, panelH: 0.32 };
// The five tabs: icon + title. Icons are region tags in the `ui-icons` grid
// (all_icons.png, 16×16, 16 cols → frame = (y/16)*16 + x/16). Mail = white-message
// (245), For-sale = whilte-out [sic, backend typo] (294, arrow-out-of-box), Chest =
// white-sprout (229), Shop = white-shopping-cart (262), Settings = white-settings (164,
// gear). `iconKey` can override the texture if a future tab needs a non-ui-icons image.
const TAB_DEFS: Array<{ key: string; iconKey?: string; frame: number | string; title: string }> = [
  { key: 'mail', frame: 245, title: '邮件' },
  { key: 'chest', frame: 229, title: '箱子' },
  { key: 'catobag', frame: 310, title: '猫包' }, // white-cat-claw (all_icons region @96,304)
  { key: 'shop', frame: 262, title: '商店' },
  { key: 'settings', frame: 164, title: '设置' },
  { key: 'calendar', frame: 294, title: '日历' }, // all_icons calendar-page glyph (row18 col6). Placeholder tab.
  { key: 'pickup', frame: 293, title: '取货' },   // mailbox: delivered orders (icon tunable like paw)
  { key: 'forsale', frame: 261, title: '待售' },  // mailbox: shipping bin ($ glyph, tunable)
];
// NB: TAB_DEFS is indexed by position → these ids MUST match. TAB_BACKPACK is a special standalone
// view id kept ABOVE the TAB_DEFS range so appending real tabs never collides with it.
const TAB_MAIL = 0, TAB_CHEST = 1, TAB_CATOBAG = 2, TAB_SHOP = 3, TAB_SETTINGS = 4, TAB_CALENDAR = 5, TAB_PICKUP = 6, TAB_FORSALE = 7, TAB_BACKPACK = 10;

// Shop catalog: a scrollable LIST on the LEFT (icon + name + buy price); the RIGHT shows
// the selected item's detail + a quantity stepper (− N +) + a BUY button. Buying is
// INSTANT — coins out, item into the chest (if it has room), else a warning. A footer
// strip shows the coin balance.
// bottom/footY stay INSIDE the frame — the 9-slice bottom border eats ~0.035H, so the
// panel's inner content ends ~0.885H; the balance sits above that, the list above it.
const SHOP = { rowH: 0.078, gapPx: 5, bottom: 0.81, footY: 0.85 };
// Shop sub-tabs (物品 / 房子): a two-button band just above the content, over the LEFT region.
const SHOP_SUBTAB = { y: 0.30, h: 0.05, x0: 0.06, x1: 0.52, gapPx: 6 };
const SHOP_LIST_Y = 0.365; // the item/house list starts BELOW the sub-tab band (was GRID.y 0.30)
const STEP = { y: 0.72, btn: 0.052, gap: 0.05, buyY: 0.82, msgY: 0.87 }; // right-side qty stepper + buy button (kept clear of the desc above + the frame border below)

export interface MenuItem { id?: string; iconKey: string; iconFrame: number | string; count: number; label?: string; desc?: string; }
export interface MenuCatalogItem { id: string; iconKey: string; iconFrame: number | string; label: string; desc: string; price: number; }
export interface MenuModel {
  visible: boolean; rev: number;
  noTabs?: boolean;          // standalone backpack view → hide the tab bar
  tabSet?: number[];         // the paw menu: which TAB_DEFS indices to show in the bar (subset); absent = all
  tab: number;               // 0 mail · 1 chest · 2 cato-bag · 3 shop · 4 settings · 5 backpack
  items?: MenuItem[];        // grid (chest / cato-bag)
  mails?: MailListEntry[];   // mail list
  selected?: number;         // selected grid index → right detail
  catalog?: MenuCatalogItem[];  // shop tab (物品 sub-tab)
  shopSelected?: string;        // selected catalog id → right detail + buy
  shopTab?: 'items' | 'house';  // shop sub-tab (物品 / 房子)
  houses?: Array<{ id: string; name: string; desc: string; preview?: string; price: number; owned: boolean; pending: boolean }>; // 房子 sub-tab
  houseSelected?: string;       // selected house tier id → right detail + buy
  money?: number;               // coin balance (shop footer)
  buyQty?: number;              // how many to buy (right-side stepper)
  shopMsg?: string;             // transient warning ("金币不够" / "箱子满了")
  mailSelected?: string;        // Mail tab: selected mail id → right-side receipt detail + row highlight
  mailDetail?: { kind: string; sender: string; title: string; lines: ReceiptLine[]; total: number }; // the selected mail's receipt
}

// Mail-tab RIGHT-side receipt panel (screen fractions) — the sales receipt / delivery
// package renders here instead of a separate modal.
const MAIL_DETAIL = { x: 0.61, y: 0.18, w: 0.36, h: 0.74 }; // SAME box as the left frame L (y 0.18–0.92), just to its RIGHT (past L's 0.58 edge → no overlap)

export class MenuScene extends Phaser.Scene {
  private lastRev = -1;
  private shown = false;
  private prevTab = -1; // last-rendered tab → animate only on a real tab switch
  private root?: Phaser.GameObjects.Container;
  private panel?: Phaser.GameObjects.Container; // everything except the dim → pops/scales as a unit
  private dim?: Phaser.GameObjects.Rectangle;   // full-screen mask (fades, never scales)
  private closeImg?: Phaser.GameObjects.Image;  // the X button (frame-swapped for the press flash)
  private closeFlashRev = -1;                   // last `menuCloseFlash` rev handled
  private detailBox?: Phaser.GameObjects.Container; // right-side detail (re-drawn live on hover)
  private m?: MenuModel;
  private slotTargets: HoverTarget[] = [];
  private menuTargets: HoverTarget[] = [];
  private hovered: HoverTarget | null = null;
  private menuRoot?: Phaser.GameObjects.Container;
  private menuRev = -1;
  // Continuous scroll (order-book style): `scroll` = the top ROW offset of the grid /
  // mail list; the bar's thumb reflects scroll/maxScrollRows. Wheel scrolls in-scene;
  // touch/mouse rail DRAG is routed by GameScene as a 0..1 `menuScrollFrac`.
  private scroll = 0;
  private maxScrollRows = 0;
  private lastFrac: number | null = -1;
  private lastWheelMs = 0;
  private scrollStepPx = 60;         // px per row (set by the active render — for swipe/wheel feel)
  private swipeY: number | null = null; // touch swipe anchor (null = not swiping)
  private swipeAccum = 0;

  constructor() { super({ key: 'MenuScene' }); }

  create(): void {
    // Mouse-wheel scrolls the active grid / mail list by ONE row. Trackpads/hi-res
    // wheels fire a BURST of events per gesture, so a naive 1-row-per-event flew to the
    // bottom on a tiny flick — THROTTLE to one row per WHEEL_MS (the first tick fires
    // immediately, the rest of the burst is dropped). Rail drag stays for fast jumps.
    this.input.on('wheel', (_p: Phaser.Input.Pointer, _o: unknown, _dx: number, dy: number) => {
      if (!this.shown || dy === 0) return;
      const now = this.time.now;
      if (now - this.lastWheelMs < WHEEL_MS) return;
      this.lastWheelMs = now;
      this.setScroll(this.scroll + (dy > 0 ? 1 : -1));
    });
    // TOUCH swipe-to-scroll (mouse uses the wheel / rail; touch has neither, and dragging
    // the thin rail is fiddly). A vertical drag anywhere over the list scrolls it: finger
    // UP → later rows. Suppressed while a sub-popup (action menu / keypad / picker) is open.
    this.input.on('pointerdown', (p: Phaser.Input.Pointer) => {
      if (p.wasTouch && this.shown && !this.menuRoot) { this.swipeY = p.y; this.swipeAccum = 0; }
    });
    this.input.on('pointermove', (p: Phaser.Input.Pointer) => {
      if (!p.wasTouch || !p.isDown || !this.shown || this.menuRoot || this.swipeY == null || this.maxScrollRows === 0) return;
      this.swipeAccum += this.swipeY - p.y; // finger up (y decreases) → positive → scroll toward later rows
      this.swipeY = p.y;
      const step = Math.max(24, this.scrollStepPx);
      while (this.swipeAccum >= step) { this.swipeAccum -= step; this.setScroll(this.scroll + 1); }
      while (this.swipeAccum <= -step) { this.swipeAccum += step; this.setScroll(this.scroll - 1); }
    });
    this.input.on('pointerup', (p: Phaser.Input.Pointer) => { if (p.wasTouch) this.swipeY = null; });
  }

  update(): void {
    const m = this.registry.get('menu') as MenuModel | undefined;
    if (m && m.rev !== this.lastRev) {
      this.lastRev = m.rev;
      if (m.visible && !this.shown) this.build(m, true);
      else if (m.visible && this.shown) this.build(m, false);
      else this.close();
    }
    // Close-button press flash (fired by GameScene just before it closes the menu).
    const flash = this.registry.get('menuCloseFlash') as number | undefined;
    if (flash !== undefined && flash !== this.closeFlashRev) { this.closeFlashRev = flash; this.flashCloseButton(); }
    const menu = this.registry.get('menuAction') as ActionMenuModel | undefined;
    if (menu && menu.rev !== this.menuRev) { this.menuRev = menu.rev; this.renderMenu(menu); }
    // Rail drag arrives as a 0..1 fraction from GameScene (touch has no wheel).
    if (this.shown && this.m) {
      const frac = this.registry.get('menuScrollFrac') as number | null | undefined;
      if (frac != null && frac !== this.lastFrac) {
        this.lastFrac = frac;
        this.setScroll(Math.round(frac * this.maxScrollRows));
      }
    }
    this.updateHover();
  }

  /** Scroll the active list to row `v` (clamped) + re-render at the new offset. */
  private setScroll(v: number): void {
    const clamped = Phaser.Math.Clamp(v, 0, this.maxScrollRows);
    if (clamped === this.scroll || !this.m) return;
    this.scroll = clamped;
    this.build(this.m, false); // instant re-render (no open/tab animation)
  }

  /** Draw the scroll bar at `barX` spanning top→bottom, and publish the rail rect
   *  (`menuRail`) so GameScene can drag it. `null` rail when nothing to scroll.
   *  Custom GRAPHICS (a rounded trough + a solid brown thumb) — the tiny 4px/7px
   *  `ui-sheet` pixel-art frames scaled up to a faint, unreadable stick. */
  private drawScrollbar(c: Phaser.GameObjects.Container, barX: number, top: number, bottom: number, visibleRows: number, totalRows: number): void {
    if (totalRows <= visibleRows) { this.registry.set('menuRail', null); return; }
    const H = this.scale.height;
    const trackH = bottom - top;
    const w = Math.max(11, H * 0.016);   // bar width (clearly grabbable)
    const r = w / 2;
    const left = barX - w / 2;
    const g = this.add.graphics();
    // Trough: a subtle recessed track.
    g.fillStyle(0x3a2a12, 0.20); g.fillRoundedRect(left, top, w, trackH, r);
    // Thumb: proportional to the visible fraction, positioned by scroll.
    const thumbH = Math.max(w * 2.4, trackH * (visibleRows / totalRows));
    const frac = this.maxScrollRows ? this.scroll / this.maxScrollRows : 0;
    const thumbY = top + frac * (trackH - thumbH);
    g.fillStyle(0x9a7b4f, 1); g.fillRoundedRect(left, thumbY, w, thumbH, r);           // brown thumb
    g.fillStyle(0xbf9d63, 1); g.fillRoundedRect(left + 2, thumbY + 2, w - 4, w - 4, r * 0.7); // top highlight cap
    c.add(g);
    this.registry.set('menuRail', { x: barX, top, bottom, max: this.maxScrollRows });
  }

  private T(x: number, y: number, s: string, size: number, color: string, origin = 0.5) {
    return this.add.text(x, y, s, { fontFamily: dialogFont(), fontSize: Math.round(size) + 'px', color, resolution: RES }).setOrigin(origin, 0.5);
  }

  private build(m: MenuModel, slide: boolean): void {
    if (this.root) { this.tweens.killTweensOf(this.root); if (this.panel) this.tweens.killTweensOf(this.panel); if (this.dim) this.tweens.killTweensOf(this.dim); }
    this.root?.destroy();
    this.shown = true;
    this.m = m;
    this.slotTargets = []; this.hovered = null;
    const tabSwitch = !slide && m.tab !== this.prevTab; // animate content only on a real tab change
    this.prevTab = m.tab;
    // Reset the scroll offset when the menu OPENS or the tab CHANGES (a plain re-render
    // — item select / action / wheel-scroll — keeps the current offset).
    if (slide || tabSwitch) { this.scroll = 0; this.lastFrac = -1; this.registry.set('menuScrollFrac', null); }
    this.maxScrollRows = 0; this.registry.set('menuRail', null); // grid/mail override below
    const W = this.scale.width, H = this.scale.height;
    const c = this.add.container(0, 0);
    this.root = c;

    // Full-screen MASK behind the whole menu — dims the game so the UI reads as a
    // separate layer. (Tap outside the panels still closes — routed by GameScene.)
    // It lives on the ROOT (not the panel) so it stays full-screen while the panel
    // pops/scales on open/close.
    const dim = this.add.rectangle(0, 0, W, H, 0x000000, DIM_ALPHA).setOrigin(0, 0);
    c.add(dim);
    this.dim = dim;

    // Everything else (tabs, frame, title, content, detail, close) goes in `panel` so
    // it can scale-pop as ONE unit on open/close without dragging the dim with it.
    const panel = this.add.container(0, 0);
    c.add(panel);
    this.panel = panel;

    // Tabs sit ON the frame's TOP-LEFT edge (bottom overlaps into the frame so the
    // brown tab + brown frame border MERGE into one piece — like the reference). Drawn
    // BEFORE the frame so the frame's top border covers the tab's bottom seam.
    // Tabs with a left content grid/list AND a right detail (chest / mailbox / bags / pickup /
    // for-sale / SHOP) share ONE full-width frame, split by a dashed divider — instead of two
    // frames. Settings / Calendar are full-width too (no right detail).
    const hasDetail = m.tab === TAB_CHEST || m.tab === TAB_CATOBAG || m.tab === TAB_BACKPACK
      || m.tab === TAB_PICKUP || m.tab === TAB_FORSALE || m.tab === TAB_MAIL || m.tab === TAB_SHOP;
    const wideFrame = hasDetail || m.tab === TAB_SETTINGS || m.tab === TAB_CALENDAR;
    const frameWFrac = wideFrame ? 1 - 2 * L.x : L.w;
    const lx = L.x * W, ly = L.y * H, lw = frameWFrac * W, lh = L.h * H;
    const DIVIDER_X = 0.555; // screen-fraction x of the dashed divider (left content | right detail)
    // Tabs TOUCH (no gap) + the ACTIVE tab is a bit wider + drawn ON TOP so it covers its
    // neighbours' edges (browser/Zelda tab look). `medium-brown-tab` (100×23) is stretched
    // non-uniformly (width fills the slot, height set taller so the icon isn't cramped).
    // Which tabs to show in the bar: the paw menu passes a SUBSET (`tabSet`); default = all.
    const tabsToShow = (m.tabSet && m.tabSet.length ? m.tabSet : TAB_DEFS.map((_, i) => i)).filter((i) => i >= 0 && i < TAB_DEFS.length);
    const N = tabsToShow.length, INSET = lw * 0.02;
    // Tabs FILL the bar width (no blank on the sides) for 2+ tabs; a lone tab is capped at half
    // width so it isn't absurdly wide. Centre the group either way.
    const tabW = Math.min((lw - INSET * 2) / N, (lw - INSET * 2) / 2);
    const startX = lx + (lw - N * tabW) / 2;
    const tabH = H * 0.07; // a touch taller so the icon isn't cramped near the top edge
    const OVERLAP = tabH * 0.22; // the tab's bottom dips a LITTLE into the frame top (merge the border)
    // The active tab is distinguished by being TALLER + lighter + drawn on top — NOT wider. (A
    // horizontal grow would push the edge tabs PAST the panel when the tabs already fill the width.)
    const ACTIVE_TALLER = 1.14;      // active tab is this much taller (grows UPWARD, bottom stays merged)
    const BOTTOM = ly + OVERLAP;     // every tab's bottom edge (merged into the frame)
    const slotCx = (pos: number) => startX + pos * tabW + tabW / 2; // pos = index WITHIN tabsToShow
    const tabBounds: Array<{ x: number; y: number; w: number; h: number; tab: number }> = [];
    const tabIcons: Phaser.GameObjects.Image[] = [];
    let activeChip: Phaser.GameObjects.Image | undefined, activeIcon: Phaser.GameObjects.Image | undefined, activeCy = 0, activeH = tabH;
    const drawTab = (tabIdx: number, pos: number) => {
      const active = tabIdx === m.tab;
      const w = tabW; // same width for all (no horizontal grow → edge tabs never overflow the panel)
      const h = active ? tabH * ACTIVE_TALLER : tabH;
      const cy = BOTTOM - h / 2; // bottom pinned → taller tab rises upward
      const chip = this.add.image(slotCx(pos), cy, ATLAS, TAB_TEX).setScale(w / 100, h / 23);
      if (!active) chip.setTint(TAB_UNSEL_TINT); else { activeChip = chip; activeCy = cy; activeH = h; }
      panel.add(chip);
      let ic: Phaser.GameObjects.Image | undefined;
      const iconTex = TAB_DEFS[tabIdx]!.iconKey ?? 'ui-icons';
      if (this.textures.exists(iconTex)) {
        // Scale by the frame's real size (ui-icons 16px vs the chest sprite 48px) so
        // every tab icon lands at the same on-screen height.
        ic = this.add.image(slotCx(pos), cy - OVERLAP / 2, iconTex, TAB_DEFS[tabIdx]!.frame);
        ic.setScale(((tabH - OVERLAP) * 0.7) / Math.max(ic.width, ic.height));
        tabIcons.push(ic);
      }
      if (active) activeIcon = ic;
    };
    if (!m.noTabs) { // the standalone backpack view has NO tab bar
      tabsToShow.forEach((ti, pos) => { if (ti !== m.tab) drawTab(ti, pos); }); // inactive first
      const activePos = tabsToShow.indexOf(m.tab);
      if (activePos >= 0) drawTab(m.tab, activePos);                              // active LAST → on top
      tabsToShow.forEach((ti, pos) => tabBounds.push({ x: slotCx(pos) - tabW / 2, y: BOTTOM - tabH, w: tabW, h: tabH, tab: ti })); // hit = base slots
    }
    this.registry.set('menuTabs', tabBounds);

    // Left content panel — `frame-medium` 9-slice ON TOP of the tabs' bottom seam.
    panel.add(this.add.nineslice(lx + lw / 2, ly + lh / 2, ATLAS, PANEL_FRAME, lw / PANEL_SCALE, lh / PANEL_SCALE, PANEL_SLICE.l, PANEL_SLICE.r, PANEL_SLICE.t, PANEL_SLICE.b).setScale(PANEL_SCALE));
    if (hasDetail) this.drawDivider(panel, DIVIDER_X); // dashed line between the left content + the right detail
    tabIcons.forEach((ic) => panel.add(ic)); // icons back on top of the frame border

    // Title (no underline rule — the user didn't want it). Localized via i18n `tab_<key>`.
    const tkey = TAB_DEFS[m.tab]?.key;
    const title = tkey ? t('tab_' + tkey) : m.tab === TAB_BACKPACK ? t('tab_backpack') : '';
    const titleCx = hasDetail ? ((L.x + DIVIDER_X) / 2) * W : lx + lw / 2; // over the LEFT content for split tabs
    panel.add(this.T(titleCx, TITLE_Y * H, title, H * 0.03, INK));

    // Content per tab — in its OWN container so a tab SWITCH can animate it independently
    // of the frame/tabs (which stay put).
    const content = this.add.container(0, 0); panel.add(content);
    this.detailBox = undefined;
    // Settings/Calendar: centre content on the (now full-width) frame, but keep the content
    // sized as before (the original L.w) so the sliders/buttons don't stretch out.
    if (m.tab === TAB_SETTINGS) this.renderSettings(content, lx + lw / 2, L.w * W);
    else if (m.tab === TAB_CALENDAR) this.renderCalendar(content, lx + lw / 2); // placeholder (empty) tab
    else if (m.tab === TAB_MAIL) {
      this.renderMailList(content, m.mails ?? [], m.mailSelected);
      this.renderMailDetail(content, m.mailDetail); // right-side receipt (was a separate modal)
    }
    else if (m.tab === TAB_SHOP) this.renderShop(content, m);
    else this.renderGrid(content, m.items ?? [], m.selected, m.tab === TAB_CATOBAG ? CATOBAG_ROWS : GRID.rows); // chest / cato-bag / backpack / 取货 / 待售
    if (m.tab === TAB_CHEST || m.tab === TAB_CATOBAG || m.tab === TAB_BACKPACK || m.tab === TAB_PICKUP || m.tab === TAB_FORSALE) {
      // Detail in its OWN container so hover can re-draw JUST the detail (no grid rebuild).
      const detail = this.add.container(0, 0); content.add(detail); this.detailBox = detail;
      this.renderDetail(detail, (m.items ?? [])[m.selected ?? -1]);
    }

    // Close button — INSIDE the left frame's top-right corner, with the gap to the RIGHT
    // border equal (in px) to the gap above (a symmetric corner). CLOSE.y fixes the vertical
    // position; the right x is derived from that same margin so it holds at any aspect ratio
    // (fixed x/y fractions can't — the px margins would differ once W/H changes).
    const cs = CLOSE.size * H;
    const cm = Math.max(0, (CLOSE.y - CLOSE.size / 2 - L.y) * H); // top-edge gap in px → mirror on the right
    const cbx = lx + lw - cm - cs / 2;   // lx+lw = left frame's right edge
    const cby = CLOSE.y * H;
    this.closeImg = undefined;
    if (this.textures.exists(CLOSE.atlas)) {
      this.closeImg = this.add.image(cbx, cby, CLOSE.atlas, CLOSE.frame).setDisplaySize(cs, cs);
      panel.add(this.closeImg);
    }
    this.registry.set('menuCloseBtn', { x: cbx - cs / 2, y: cby - cs / 2, w: cs, h: cs });

    // The whole menu is the modal; tap anywhere OUTSIDE the left panel + right detail
    // + tabs closes it (GameScene checks menuPanel = the union, simplified to "not on a
    // hit target" → we publish the left panel rect; GameScene treats a tap that hits no
    // tab/slot/menu as close).
    this.registry.set('menuPanel', { x: lx, y: TABS.y * H, w: (DETAIL.panelX + DETAIL.panelW) * W - lx, h: lh + (ly - TABS.y * H) });

    if (slide) {
      // OPEN: the dim fades in while the panel SLIDES UP from below and bounces once — a
      // Back.easeOut overshoot past its resting spot (cute spring), then settles.
      dim.setAlpha(0);
      this.tweens.add({ targets: dim, alpha: DIM_ALPHA, duration: 200 });
      panel.setAlpha(0);
      panel.y = H * 0.14; // start below the resting position
      this.tweens.add({ targets: panel, alpha: 1, duration: 160 });
      this.tweens.add({ targets: panel, y: 0, duration: 340, ease: 'Back.easeOut' });
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

  /** Flash the close button's pressed frame briefly (a click blip on the X — it's a
   *  momentary press, not a latched state), then revert. Driven by GameScene's
   *  `menuCloseFlash` signal just before it triggers the close. */
  private flashCloseButton(): void {
    const img = this.closeImg;
    if (!img || !img.active) return;
    img.setFrame(CLOSE_PRESSED);
    this.time.delayedCall(110, () => { if (img.active) img.setFrame(CLOSE.frame); });
  }

  private renderGrid(c: Phaser.GameObjects.Container, items: MenuItem[], selected?: number, rows: number = GRID.rows): void {
    const W = this.scale.width, H = this.scale.height;
    const gx = GRID.x * W, gy = GRID.y * H, gw = GRID.w * W, gap = GRID.gap * W;
    const cols = GRID.cols;
    const cell = (gw - gap * (cols - 1)) / cols;
    this.scrollStepPx = cell + gap;
    // Window by ROW: show `rows` rows starting at `scroll`; overflow drives the bar.
    const totalRows = Math.ceil(items.length / cols);
    this.maxScrollRows = Math.max(0, totalRows - rows);
    if (this.scroll > this.maxScrollRows) this.scroll = this.maxScrollRows;
    const startIdx = this.scroll * cols;
    const bounds: Array<{ x: number; y: number; w: number; h: number; index: number }> = [];
    for (let j = 0; j < cols * rows; j++) {
      const i = startIdx + j;                       // real store index
      const col = j % cols, row = Math.floor(j / cols);
      const sx = gx + col * (cell + gap), sy = gy + row * (cell + gap);
      const bg = this.add.nineslice(sx + cell / 2, sy + cell / 2, ATLAS, SLOT_FRAME, cell / SLOT_SCALE, cell / SLOT_SCALE, SLOT_SLICE.l, SLOT_SLICE.r, SLOT_SLICE.t, SLOT_SLICE.b).setScale(SLOT_SCALE);
      c.add(bg);
      const it = items[i];
      // Selected = the SAME tinted bg as a hover (no white frame). It's NOT added to the
      // hover targets, so moving the mouse away doesn't clear its highlight.
      if (i === selected && it) bg.setTint(HOVER_TINT);
      if (!it) continue;
      if (this.textures.exists(it.iconKey)) {
        const icon = this.add.image(sx + cell / 2, sy + cell / 2, it.iconKey, this.fitFrame(it.iconKey, it.iconFrame));
        icon.setScale((cell * 0.62) / Math.max(icon.width, icon.height)); c.add(icon);
      }
      // Count: white with a dark outline so it reads on the light-tan slot (plain white was too low-contrast).
      const cnt = this.T(sx + cell * 0.82, sy + cell * 0.8, String(it.count), cell * 0.28, '#ffffff', 1);
      cnt.setStroke('#2b1d0e', Math.max(3, cell * 0.06));
      c.add(cnt);
      const sb = { x: sx, y: sy, w: cell, h: cell };
      bounds.push({ ...sb, index: i });
      if (i !== selected) this.slotTargets.push({ ...sb, bg, index: i }); // selected stays tinted; others hover-tint + drive detail
    }
    this.registry.set('menuSlots', bounds);
    // Scroll bar just right of the grid, spanning the visible rows.
    this.drawScrollbar(c, gx + gw + RAIL_DX * W, gy, gy + rows * (cell + gap) - gap, rows, totalRows);
  }

  /** Content-fit frame for an item icon. Many item images are drawn on a canvas BIGGER than the art
   *  (transparent padding all round), so scaling by the full frame makes the icon look tiny in a slot.
   *  This registers ONCE (cached on the texture) a tight sub-frame `<frame>__fit` = the opaque-pixel
   *  bbox of `frame`, and returns its name — so the icon scales to the ART, not the padding. Works for
   *  plain images AND atlas/sheet frames; every item icon flows through here, so ANY padded item image
   *  (now or future) auto-fits with zero per-asset work. Falls back to the original frame if the
   *  texture is unreadable (tainted) or fully transparent. */
  private fitFrame(key: string, frame: number | string): number | string {
    const tex = this.textures.get(key);
    if (!tex) return frame;
    const src = tex.get(frame ?? 0); // resolves to __BASE if the frame is missing (plain images)
    const fitName = `${src.name}__fit`;
    if (tex.has(fitName)) return fitName; // already computed for this frame
    const img = tex.getSourceImage(src.sourceIndex) as CanvasImageSource & { width: number; height: number };
    const fw = src.cutWidth, fh = src.cutHeight;
    if (!img || fw <= 0 || fh <= 0) return frame;
    const cnv = document.createElement('canvas'); cnv.width = img.width; cnv.height = img.height;
    const ctx = cnv.getContext('2d'); if (!ctx) return frame;
    ctx.drawImage(img, 0, 0);
    let data: Uint8ClampedArray;
    try { data = ctx.getImageData(src.cutX, src.cutY, fw, fh).data; } catch { return frame; } // tainted → leave as-is
    let minX = fw, minY = fh, maxX = -1, maxY = -1;
    for (let y = 0; y < fh; y++) for (let x = 0; x < fw; x++) {
      if (data[(y * fw + x) * 4 + 3]! > 8) { if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y; }
    }
    if (maxX < minX) return frame; // fully transparent
    tex.add(fitName, src.sourceIndex, src.cutX + minX, src.cutY + minY, maxX - minX + 1, maxY - minY + 1);
    return fitName;
  }

  /** Vertical DASHED divider — a column of the `brown-dot` sprite (ui-sheet atlas) at screen-
   *  fraction `xFrac`, splitting the merged frame's left content from its right detail. */
  private drawDivider(c: Phaser.GameObjects.Container, xFrac: number): void {
    const W = this.scale.width, H = this.scale.height;
    const x = xFrac * W;
    const y0 = (L.y + 0.055) * H, y1 = (L.y + L.h - 0.05) * H;
    const hasDot = this.textures.exists('ui-sheet') && this.textures.get('ui-sheet').has('brown-dot');
    const size = Math.max(9, H * 0.03);   // on-screen dot size (bigger)
    const step = size * 1.2;              // centre-to-centre spacing (tighter)
    for (let y = y0; y <= y1; y += step) {
      if (hasDot) c.add(this.add.image(x, y, 'ui-sheet', 'brown-dot').setDisplaySize(size, size));
      else { const g = this.add.graphics(); g.fillStyle(0x9a7247, 1); g.fillCircle(x, y, size / 2.6); c.add(g); }
    }
  }

  private renderDetail(c: Phaser.GameObjects.Container, it?: MenuItem): void {
    const W = this.scale.width, H = this.scale.height;
    // Right detail region (right of the divider): NAME on top (centred, white + black outline like
    // the slot count numbers), the IMAGE below it, then the DESCRIPTION below that. No inner box.
    const cx = 0.76 * W;           // centre of the right region (divider 0.555 → frame edge 0.97)
    const yName = 0.28 * H, yImg = 0.47 * H, yDesc = 0.64 * H;
    if (!it) return;
    // Name — white with a dark outline (mirrors the grid slot count style). No animation.
    const name = this.T(cx, yName, it.label ?? it.id ?? '', H * 0.032, '#ffffff', 0.5);
    name.setStroke('#2b1d0e', Math.max(2, H * 0.005));
    c.add(name);
    // Image (centred, below the name) — POPS in (scale from small around its centre).
    if (this.textures.exists(it.iconKey)) {
      const img = this.add.image(cx, yImg, it.iconKey, this.fitFrame(it.iconKey, it.iconFrame));
      const s = (0.18 * W) / Math.max(img.width, img.height);
      c.add(img);
      img.setScale(s * 0.2);
      this.tweens.add({ targets: img, scale: s, duration: 240, ease: 'Back.easeOut' });
    }
    // Description (centred, below the image). No animation.
    if (it.desc) {
      const desc = this.add.text(cx, yDesc, it.desc, {
        fontFamily: dialogFont(), fontSize: Math.round(H * 0.022) + 'px', color: SUB, resolution: RES, align: 'center', wordWrap: { width: 0.36 * W },
      }).setOrigin(0.5, 0);
      c.add(desc);
    }
  }

  private renderMailList(c: Phaser.GameObjects.Container, mails: MailListEntry[], selectedId?: string): void {
    const W = this.scale.width, H = this.scale.height;
    const gx = GRID.x * W, gy = GRID.y * H, gw = GRID.w * W;
    const rowH = MAIL.rowH * H, step = rowH + MAIL.gapPx;
    this.scrollStepPx = step;
    const bounds: Array<{ x: number; y: number; w: number; h: number; id: string }> = [];
    if (!mails.length) { c.add(this.T(gx + gw / 2, gy + H * 0.1, t('menu_no_mail'), H * 0.03, SUB)); }
    // Window by ROW: how many rows fit between gy and the viewport bottom.
    const visible = Math.max(1, Math.floor((MAIL.bottom * H - gy) / step));
    this.maxScrollRows = Math.max(0, mails.length - visible);
    if (this.scroll > this.maxScrollRows) this.scroll = this.maxScrollRows;
    mails.slice(this.scroll, this.scroll + visible).forEach((mail, k) => {
      const ry = gy + k * step;
      const sel = mail.id === selectedId;
      const bar = this.add.graphics();
      bar.fillStyle(sel ? 0xfff6de : mail.read ? 0xe7dcc2 : 0xf3ead1, 1); bar.fillRoundedRect(gx, ry, gw, rowH, 8);
      bar.lineStyle(sel ? 3 : 2, sel ? 0x4aa3df : 0xd2be95, 1); bar.strokeRoundedRect(gx, ry, gw, rowH, 8); c.add(bar);
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
    this.drawScrollbar(c, gx + gw + RAIL_DX * W, gy, gy + visible * step - MAIL.gapPx, visible, mails.length);
  }

  /** RIGHT-side receipt panel for the selected mail (sales receipt lines + total, or a
   *  delivery package + a 领取/Claim button). Replaces the old separate ReceiptScene modal —
   *  GameScene publishes `mailDetail`; the Claim hit-rect is `menuMailClaim`. */
  private renderMailDetail(c: Phaser.GameObjects.Container, d?: MenuModel['mailDetail']): void {
    const W = this.scale.width, H = this.scale.height;
    const rx = MAIL_DETAIL.x * W, ry = MAIL_DETAIL.y * H, rw = MAIL_DETAIL.w * W, rh = MAIL_DETAIL.h * H;
    // Renders straight onto the SHARED frame (right of the divider) — no inner box.
    this.registry.set('menuMailClaim', null); // cleared unless a delivery draws the button
    if (!d) { c.add(this.T(rx + rw / 2, ry + rh * 0.5, t('menu_select_mail'), H * 0.024, SUB).setAlpha(0.6)); return; }
    const fs = Math.max(14, Math.round(H * 0.026));
    const isDelivery = d.kind === 'delivery';
    // Title + underline + sender.
    c.add(this.T(rx + rw / 2, ry + rh * 0.08, d.title.toUpperCase(), Math.round(fs * 1.15), '#ffffff'));
    const rule = this.add.graphics(); rule.fillStyle(0xa98d63, 1); rule.fillRect(rx + rw * 0.16, ry + rh * 0.145, rw * 0.68, Math.max(2, rh * 0.006)); c.add(rule);
    c.add(this.T(rx + rw / 2, ry + rh * 0.205, d.sender, Math.round(fs * 0.8), SUB));
    // Item rows: cream bars (icon + count subscript + name + subtotal / ×count).
    const listTop = ry + rh * 0.28, listBot = ry + rh * (isDelivery ? 0.80 : 0.85);
    const rowH = Math.min(rh * 0.13, (listBot - listTop) / Math.max(1, d.lines.length));
    const barW = rw * 0.9, barX = rx + rw * 0.05;
    d.lines.forEach((ln, i) => {
      const yy = listTop + rowH * (i + 0.5);
      const bh = rowH * 0.82;
      const g = this.add.graphics();
      g.fillStyle(0xefe4c8, 1); g.fillRoundedRect(barX, yy - bh / 2, barW, bh, Math.max(4, bh * 0.22));
      g.lineStyle(Math.max(1, bh * 0.04), 0xd8c69e, 1); g.strokeRoundedRect(barX, yy - bh / 2, barW, bh, Math.max(4, bh * 0.22));
      c.add(g);
      const iconCx = barX + bh * 0.7;
      if (this.textures.exists(ln.iconKey)) {
        const icon = this.add.image(iconCx, yy, ln.iconKey, this.fitFrame(ln.iconKey, ln.iconFrame));
        icon.setScale((bh * 0.62) / Math.max(icon.width, icon.height)); c.add(icon);
        c.add(this.T(iconCx + bh * 0.24, yy + bh * 0.22, String(ln.count), Math.round(fs * 0.7), '#ffffff'));
      }
      c.add(this.T(barX + bh * 1.2, yy, ln.label, fs, INK, 0));
      c.add(this.T(barX + barW - bh * 0.35, yy, isDelivery ? '×' + ln.count : ln.subtotal.toLocaleString(), fs, INK, 1));
    });
    // Total (sales receipt) OR a Claim button (delivery package).
    if (!isDelivery) {
      c.add(this.T(rx + rw * 0.07, ry + rh * 0.93, `${t('receipt_total')}: ${d.total.toLocaleString()}`, Math.round(fs * 1.05), '#ffffff', 0));
    } else {
      const bw = rw * 0.42, bh = rh * 0.11, bcx = rx + rw / 2, bcy = ry + rh * 0.9;
      const has = this.textures.exists('square-buttons') && this.textures.get('square-buttons').has('grey-button');
      c.add(has ? this.add.nineslice(bcx, bcy, 'square-buttons', 'grey-button', bw, bh, 6, 6, 6, 6)
               : this.add.rectangle(bcx, bcy, bw, bh, 0xd8c39a).setStrokeStyle(2, 0x5b3a1e));
      c.add(this.T(bcx, bcy, t('mail_claim'), Math.round(fs), '#5b4327'));
      this.registry.set('menuMailClaim', { x: bcx - bw / 2, y: bcy - bh / 2, w: bw, h: bh });
    }
  }

  /** CALENDAR tab — placeholder for now (a centred "coming soon"): lets the user test that tab
   *  switching works + reads like a real tabbed menu. Fill in the real calendar UI here later. */
  private renderCalendar(c: Phaser.GameObjects.Container, cx: number): void {
    const H = this.scale.height;
    c.add(this.T(cx, H * 0.46, t('menu_coming_soon'), H * 0.03, INK).setAlpha(0.65));
  }

  /** SETTINGS tab: a Music volume slider (tap the bar to set — mirrors the title
   *  screen's slider, same `settings-buttons` tick/knob art) + a "Title screen" button
   *  (empty `button-idle` + text, like the title buttons) that returns to the menu.
   *  GameScene routes taps via the published `menuSettingsTrack` / `menuSettingsBack`. */
  private renderSettings(c: Phaser.GameObjects.Container, cx: number, lw: number): void {
    const W = this.scale.width, H = this.scale.height;
    // cx = frame centre (passed in); lw = content sizing width (kept at the original L.w so the
    // sliders/buttons stay their size even though the Settings frame now spans full width).

    // ── Volume sliders: Music (BGM) + SFX ────────────────────────────────────
    this.renderVolumeSlider(c, cx, lw, 0.26 * H, 0.335 * H, t('settings_music'), getBgmVolume(), 'menuSettingsTrack');
    this.renderVolumeSlider(c, cx, lw, 0.43 * H, 0.505 * H, t('settings_sfx'), getSfxVolume(), 'menuSfxTrack');

    // ── "Title screen" button (styled like the title buttons) ────────────────
    const bw = lw * 0.42, bh = bw * (32 / 96), by = 0.595 * H;
    if (this.textures.exists('ui_big_play_button')) {
      c.add(this.add.image(cx, by, 'ui_big_play_button', 'button-idle').setDisplaySize(bw, bh));
    }
    c.add(this.add.text(cx, by - bh * (2 / 32), t('menu_return_title'), { fontFamily: dialogFont(), color: '#9a6a3f', fontStyle: 'bold', fontSize: Math.round(bh * 0.34) + 'px', resolution: RES }).setOrigin(0.5, 0.5));
    this.registry.set('menuSettingsBack', { x: cx - bw / 2, y: by - bh / 2, w: bw, h: bh });

    // ── "Clear data & new game" — wipes THIS user's save + returns to title so the
    //    opening flow replays (red = destructive). ────────────────────────────
    const cbw = lw * 0.52, cbh = H * 0.048, cby = 0.685 * H;
    const cg = this.add.graphics();
    cg.fillStyle(0xc85a54, 1); cg.fillRoundedRect(cx - cbw / 2, cby - cbh / 2, cbw, cbh, 8);
    cg.lineStyle(2, 0xa2433f, 1); cg.strokeRoundedRect(cx - cbw / 2, cby - cbh / 2, cbw, cbh, 8);
    c.add(cg);
    c.add(this.add.text(cx, cby, t('settings_clear_data'), { fontFamily: dialogFont(), color: '#ffffff', fontStyle: 'bold', fontSize: Math.round(H * 0.022) + 'px', resolution: RES }).setOrigin(0.5, 0.5));
    this.registry.set('menuClearData', { x: cx - cbw / 2, y: cby - cbh / 2, w: cbw, h: cbh });

    // ── Debug toggles (dev-only; DEBUG_PANEL=false hides before release) ──────
    if (!DEBUG_PANEL) { this.registry.set('menuDebugRows', []); return; }
    c.add(this.T(cx, 0.755 * H, t('settings_debug'), H * 0.024, INK));
    c.add(this.T(cx, 0.782 * H, t('settings_debug_note'), H * 0.015, SUB));
    const rowW = lw * 0.66, rowLeft = cx - rowW / 2, rowH = H * 0.033, gap = H * 0.009;
    const box = H * 0.022;
    const rows: Array<{ x: number; y: number; w: number; h: number; key: string }> = [];
    DEBUG_FLAGS.forEach((f, i) => {
      const ry = 0.803 * H + i * (rowH + gap), on = isDebug(f.key);
      const g = this.add.graphics();
      g.fillStyle(0x000000, 0.05); g.fillRoundedRect(rowLeft, ry, rowW, rowH, 6); c.add(g);
      const label = (f.reloadOnly ? '★ ' : '') + t(f.labelKey);
      c.add(this.T(rowLeft + box * 0.6, ry + rowH / 2, label, H * 0.02, INK, 0));
      const bx = rowLeft + rowW - box * 1.1, by2 = ry + (rowH - box) / 2;
      const cb = this.add.graphics();
      cb.fillStyle(on ? 0x6bbf59 : 0xd8cbb0, 1); cb.fillRoundedRect(bx, by2, box, box, 4);
      cb.lineStyle(2, on ? 0x4f9a41 : 0xb8a678, 1); cb.strokeRoundedRect(bx, by2, box, box, 4);
      if (on) { cb.lineStyle(Math.max(2, box * 0.14), 0xffffff, 1); cb.beginPath(); cb.moveTo(bx + box * 0.24, by2 + box * 0.52); cb.lineTo(bx + box * 0.44, by2 + box * 0.72); cb.lineTo(bx + box * 0.78, by2 + box * 0.28); cb.strokePath(); }
      c.add(cb);
      rows.push({ x: rowLeft, y: ry, w: rowW, h: rowH, key: f.key });
    });
    this.registry.set('menuDebugRows', rows);
  }

  /** One labelled tick-and-knob volume slider centred on the left panel. Publishes
   *  its tap-track rect under `trackKey`; GameScene sets the volume from a tap. */
  private renderVolumeSlider(
    c: Phaser.GameObjects.Container, cx: number, lw: number,
    labelY: number, rowY: number, label: string, vol: number, trackKey: string,
  ): void {
    const H = this.scale.height;
    c.add(this.T(cx, labelY, label, H * 0.028, INK));
    const N = 10, trackW = lw * 0.5, trackLeft = cx - trackW / 2, pitch = trackW / N;
    const knobX = trackLeft + vol * trackW;
    if (this.textures.exists('settings-buttons')) {
      const tickScale = (pitch * 0.6) / 4; // tick native w=4
      for (let i = 0; i < N; i++) {
        const x = trackLeft + (i + 0.5) * pitch;
        c.add(this.add.image(x, rowY, 'settings-buttons', x <= knobX + 0.5 ? 'slider-tick-on' : 'slider-tick-off').setScale(tickScale));
      }
      // Knob native is 14×21 (much bigger than a 4×12 tick) — scale it DOWN to a modest
      // grab handle (~1.3× tick height) instead of tickScale×1.2 (which read as ~2× tick
      // height = an oversized knob).
      const knobScale = (pitch * 0.6) / 4 * 0.75;
      c.add(this.add.image(knobX, rowY, 'settings-buttons', 'slider-knob').setScale(knobScale));
    }
    this.registry.set(trackKey, { x: trackLeft, y: rowY - pitch, w: trackW, h: pitch * 2 });
  }

  /** SHOP tab: LEFT = scrollable catalog list (icon + name + buy price); footer = coin
   *  balance; RIGHT = the selected item's detail + a qty stepper (− N +) + a BUY button.
   *  Buying is INSTANT (coins out → item into the chest, or a warning). */
  private renderShop(c: Phaser.GameObjects.Container, m: MenuModel): void {
    const W = this.scale.width, H = this.scale.height;
    const shopTab = m.shopTab ?? 'items';
    // Sub-tab bar (物品 / 房子) above the content; pushes the list down a touch.
    this.renderShopSubtabs(c, shopTab);
    if (shopTab === 'house') {
      this.renderHouseList(c, m);
      this.renderHouseDetail(c, (m.houses ?? []).find((h) => h.id === m.houseSelected), m.money ?? 0, m.shopMsg ?? '');
      return;
    }
    const catalog = m.catalog ?? [];
    const selId = m.shopSelected;
    const gx = GRID.x * W, gy = SHOP_LIST_Y * H, gw = GRID.w * W;
    const rowH = SHOP.rowH * H, step = rowH + SHOP.gapPx;
    this.scrollStepPx = step;
    const visible = Math.max(1, Math.floor((SHOP.bottom * H - gy) / step));
    this.maxScrollRows = Math.max(0, catalog.length - visible);
    if (this.scroll > this.maxScrollRows) this.scroll = this.maxScrollRows;
    const rowBounds: Array<{ x: number; y: number; w: number; h: number; id: string }> = [];
    catalog.slice(this.scroll, this.scroll + visible).forEach((e, k) => {
      const ry = gy + k * step, sel = e.id === selId;
      const bar = this.add.graphics();
      bar.fillStyle(sel ? 0xf3ead1 : 0xe7dcc2, 1); bar.fillRoundedRect(gx, ry, gw, rowH, 8);
      bar.lineStyle(sel ? 3 : 2, sel ? 0xb89a5e : 0xd2be95, 1); bar.strokeRoundedRect(gx, ry, gw, rowH, 8); c.add(bar);
      if (this.textures.exists(e.iconKey)) {
        const icon = this.add.image(gx + rowH * 0.62, ry + rowH / 2, e.iconKey, this.fitFrame(e.iconKey, e.iconFrame));
        icon.setScale((rowH * 0.62) / Math.max(icon.width, icon.height)); c.add(icon);
      }
      c.add(this.T(gx + rowH * 1.2, ry + rowH * 0.5, e.label, H * 0.024, INK, 0));
      c.add(this.T(gx + gw - rowH * 0.35, ry + rowH * 0.5, String(e.price), H * 0.024, '#7a5a34', 1));
      rowBounds.push({ x: gx, y: ry, w: gw, h: rowH, id: e.id });
    });
    this.registry.set('menuShopRows', rowBounds);
    this.drawScrollbar(c, gx + gw + RAIL_DX * W, gy, gy + visible * step - SHOP.gapPx, visible, catalog.length);

    // Footer: coin balance.
    c.add(this.T(gx, SHOP.footY * H, `${t('shop_balance')} ${m.money ?? 0}`, H * 0.026, INK, 0));

    // RIGHT: the selected item's detail + qty stepper + BUY button.
    this.renderShopDetail(c, catalog.find((e) => e.id === selId), m.buyQty ?? 1, m.money ?? 0, m.shopMsg ?? '');
  }

  private renderShopDetail(c: Phaser.GameObjects.Container, e: MenuCatalogItem | undefined, qty: number, money: number, msg: string): void {
    const W = this.scale.width, H = this.scale.height;
    // Draws straight onto the SHARED main frame, right of the dashed divider — NO second frame.
    // `cx` = the right-region centre (matches renderDetail); `regionW` sizes wordwrap + the buy button.
    const cx = 0.76 * W, regionW = 0.40 * W;
    this.registry.set('menuStepper', []);
    if (!e) { c.add(this.T(cx, 0.6 * H, t('shop_pick_item'), H * 0.024, SUB)); return; }
    if (this.textures.exists(e.iconKey)) {
      const img = this.add.image(cx, 0.40 * H, e.iconKey, this.fitFrame(e.iconKey, e.iconFrame));
      img.setScale((H * 0.14) / Math.max(img.width, img.height)); c.add(img); // ~0.14H tall, not the huge 0.22W
    }
    c.add(this.T(cx, 0.52 * H, e.label, H * 0.028, INK));
    c.add(this.T(cx, 0.565 * H, `${t('shop_unit_price')} ${e.price}`, H * 0.023, '#7a5a34'));
    const desc = this.add.text(cx, 0.60 * H, e.desc, {
      fontFamily: dialogFont(), fontSize: Math.round(H * 0.02) + 'px', color: SUB, resolution: RES, align: 'center', wordWrap: { width: regionW * 0.84 },
    }).setOrigin(0.5, 0); c.add(desc);
    // Quantity stepper: [−]  N  [+]
    const cy = STEP.y * H, btn = STEP.btn * H, dx = STEP.gap * W;
    const cxN = cx, cxMinus = cxN - dx, cxPlus = cxN + dx;
    const bounds: Array<{ x: number; y: number; w: number; h: number; key: string }> = [];
    const mkBtn = (cx: number, label: string, key: string, w = btn, h = btn) => {
      const has = this.textures.exists('square-buttons') && this.textures.get('square-buttons').has('grey-button');
      const bg = has ? this.add.nineslice(cx, cy2(key), 'square-buttons', 'grey-button', w, h, 6, 6, 6, 6)
        : this.add.rectangle(cx, cy2(key), w, h, 0xd8c39a).setStrokeStyle(2, 0x5b3a1e);
      // The pixel-font − / + glyphs render HIGH in the line box (descent space below),
      // so nudge them DOWN to visually centre; the wide 购买 label centres fine as-is.
      const labelDy = key === 'buy' ? 0 : H * 0.008;
      c.add(bg); c.add(this.T(cx, cy2(key) + labelDy, label, key === 'buy' ? H * 0.026 : H * 0.036, '#5b4327'));
      bounds.push({ x: cx - w / 2, y: cy2(key) - h / 2, w, h, key });
    };
    const buyCy = STEP.buyY * H;
    const cy2 = (key: string) => (key === 'buy' ? buyCy : cy);
    mkBtn(cxMinus, '−', 'dec');
    c.add(this.T(cxN, cy, String(qty), H * 0.038, INK));
    mkBtn(cxPlus, '+', 'inc');
    // BUY button — wide, shows the subtotal; greyed intent when unaffordable (still tappable → warns).
    const sub = e.price * qty;
    mkBtn(cxN, `${t('shop_buy')} ${sub}`, 'buy', regionW * 0.62, btn * 1.05);
    this.registry.set('menuStepper', bounds);
    // Transient warning (金币不够 / 箱子满了).
    if (msg) c.add(this.T(cxN, STEP.msgY * H, msg, H * 0.022, '#b5533a'));
    else if (sub > money) c.add(this.T(cxN, STEP.msgY * H, t('shop_no_coins'), H * 0.02, '#b5896a'));
  }

  /** Shop sub-tab bar (物品 / 房子) — two buttons over the LEFT content region. Registers hit bounds. */
  private renderShopSubtabs(c: Phaser.GameObjects.Container, active: 'items' | 'house'): void {
    const W = this.scale.width, H = this.scale.height;
    const y = SHOP_SUBTAB.y * H, h = SHOP_SUBTAB.h * H;
    const x0 = SHOP_SUBTAB.x0 * W, x1 = SHOP_SUBTAB.x1 * W;
    const bw = (x1 - x0 - SHOP_SUBTAB.gapPx) / 2;
    const bounds: Array<{ x: number; y: number; w: number; h: number; key: 'items' | 'house' }> = [];
    // Icons are ui-icons (all_icons.png) frames: 229 = white-sprout (物品 placeholder), 254 = white-home (房子).
    const tabs: Array<{ key: 'items' | 'house'; label: string; frame: number }> = [
      { key: 'items', label: t('shop_tab_items'), frame: 229 },
      { key: 'house', label: t('shop_tab_house'), frame: 254 },
    ];
    tabs.forEach((tb, i) => {
      const bx = x0 + i * (bw + SHOP_SUBTAB.gapPx), sel = tb.key === active;
      const g = this.add.graphics();
      g.fillStyle(sel ? 0xf3ead1 : 0xe1d4b6, 1); g.fillRoundedRect(bx, y, bw, h, 8);
      g.lineStyle(sel ? 3 : 2, sel ? 0xb89a5e : 0xcdb88f, 1); g.strokeRoundedRect(bx, y, bw, h, 8); c.add(g);
      if (this.textures.exists('ui-icons')) c.add(this.add.image(bx + h * 0.55, y + h / 2, 'ui-icons', tb.frame).setScale((h * 0.6) / 16));
      c.add(this.T(bx + h * 1.05, y + h / 2, tb.label, H * 0.026, sel ? INK : SUB, 0));
      bounds.push({ x: bx, y, w: bw, h, key: tb.key });
    });
    this.registry.set('menuShopSubtabs', bounds);
  }

  /** House catalog LIST (房子 sub-tab): a row per purchasable house — name + price / state badge. */
  private renderHouseList(c: Phaser.GameObjects.Container, m: MenuModel): void {
    const W = this.scale.width, H = this.scale.height;
    const houses = m.houses ?? [];
    const selId = m.houseSelected;
    const gx = GRID.x * W, gy = SHOP_LIST_Y * H, gw = GRID.w * W;
    const rowH = 0.10 * H, step = rowH + SHOP.gapPx; // houses are few → taller rows
    const rowBounds: Array<{ x: number; y: number; w: number; h: number; id: string }> = [];
    houses.forEach((hh, k) => {
      const ry = gy + k * step, sel = hh.id === selId;
      const bar = this.add.graphics();
      bar.fillStyle(sel ? 0xf3ead1 : 0xe7dcc2, 1); bar.fillRoundedRect(gx, ry, gw, rowH, 8);
      bar.lineStyle(sel ? 3 : 2, sel ? 0xb89a5e : 0xd2be95, 1); bar.strokeRoundedRect(gx, ry, gw, rowH, 8); c.add(bar);
      c.add(this.T(gx + rowH * 0.3, ry + rowH * 0.5, hh.name, H * 0.026, INK, 0));
      const badge = hh.owned ? t('house_owned') : hh.pending ? t('house_pending') : String(hh.price);
      const bcol = hh.owned ? '#6f8f4e' : hh.pending ? '#a9791f' : '#7a5a34';
      c.add(this.T(gx + gw - rowH * 0.3, ry + rowH * 0.5, badge, H * 0.024, bcol, 1));
      rowBounds.push({ x: gx, y: ry, w: gw, h: rowH, id: hh.id });
    });
    this.registry.set('menuHouseRows', rowBounds);
    c.add(this.T(gx, SHOP.footY * H, `${t('shop_balance')} ${m.money ?? 0}`, H * 0.026, INK, 0));
  }

  /** House DETAIL (房子 sub-tab, right pane): big preview image on top, name + desc below, BUY button
   *  (or 当前的家 / 明天入住 state). Buying pays now + moves in tomorrow — see GameScene.buyHouse. */
  private renderHouseDetail(c: Phaser.GameObjects.Container, h: NonNullable<MenuModel['houses']>[number] | undefined, money: number, msg: string): void {
    const W = this.scale.width, H = this.scale.height;
    const cx = 0.76 * W, regionW = 0.40 * W;
    this.registry.set('menuHouseBuy', null);
    if (!h) { c.add(this.T(cx, 0.6 * H, t('house_pick'), H * 0.024, SUB)); return; }
    if (h.preview && this.textures.exists(h.preview)) {
      const img = this.add.image(cx, 0.32 * H, h.preview);
      img.setScale(Math.min((regionW * 0.92) / img.width, (0.28 * H) / img.height)); c.add(img);
    }
    c.add(this.T(cx, 0.52 * H, h.name, H * 0.028, INK));
    c.add(this.T(cx, 0.565 * H, `${t('shop_unit_price')} ${h.price}`, H * 0.023, '#7a5a34'));
    const desc = this.add.text(cx, 0.60 * H, h.desc, {
      fontFamily: dialogFont(), fontSize: Math.round(H * 0.02) + 'px', color: SUB, resolution: RES, align: 'center', wordWrap: { width: regionW * 0.84 },
    }).setOrigin(0.5, 0); c.add(desc);
    const buyCy = STEP.buyY * H, btnH = STEP.btn * H * 1.05, btnW = regionW * 0.62;
    if (h.owned) { c.add(this.T(cx, buyCy, t('house_owned'), H * 0.028, '#6f8f4e')); return; }
    if (h.pending) { c.add(this.T(cx, buyCy, t('house_pending'), H * 0.028, '#a9791f')); return; }
    const has = this.textures.exists('square-buttons') && this.textures.get('square-buttons').has('grey-button');
    const bg = has ? this.add.nineslice(cx, buyCy, 'square-buttons', 'grey-button', btnW, btnH, 6, 6, 6, 6)
      : this.add.rectangle(cx, buyCy, btnW, btnH, 0xd8c39a).setStrokeStyle(2, 0x5b3a1e);
    c.add(bg); c.add(this.T(cx, buyCy, `${t('house_buy')} ${h.price}`, H * 0.026, '#5b4327'));
    this.registry.set('menuHouseBuy', { x: cx - btnW / 2, y: buyCy - btnH / 2, w: btnW, h: btnH });
    if (msg) c.add(this.T(cx, STEP.msgY * H, msg, H * 0.022, '#b5533a'));
    else if (h.price > money) c.add(this.T(cx, STEP.msgY * H, t('shop_no_coins'), H * 0.02, '#b5896a'));
  }

  private renderMenu(m: ActionMenuModel): void {
    this.menuRoot?.destroy(); this.menuRoot = undefined;
    this.menuTargets = []; this.hovered = null;
    this.registry.set('menuActionBounds', [] as MenuBound[]);
    if (!m.visible || !this.shown) return;
    const root = this.add.container(0, 0).setDepth(1000);
    this.menuRoot = root;
    const bounds = m.slotpick
      ? renderSlotPicker(this, root, { x: m.x, y: m.y, slots: m.slotpick.slots })
      : m.keypad
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
    if (hit) playSfx(this, SFX_HOVER); // soft blip as the cursor highlights an item cell
    // Desktop: hovering a grid slot live-updates the right detail (no grid rebuild).
    if (!this.menuRoot && hit && hit.index != null) this.showDetailFor(hit.index);
  }

  /** Re-draw JUST the right detail box for the item at store `index` (hover on desktop). */
  private showDetailFor(index: number): void {
    if (!this.detailBox || !this.detailBox.active) return;
    this.detailBox.removeAll(true);
    this.renderDetail(this.detailBox, (this.m?.items ?? [])[index]);
  }

  private close(): void {
    this.registry.set('menuTabs', []); this.registry.set('menuSlots', []); this.registry.set('menuMailRows', []);
    this.registry.set('menuPanel', null); this.registry.set('menuActionBounds', []); this.registry.set('menuCloseBtn', null);
    this.registry.set('menuRail', null); this.registry.set('menuShopRows', []); this.registry.set('menuStepper', []);
    this.registry.set('menuShopSubtabs', []); this.registry.set('menuHouseRows', []); this.registry.set('menuHouseBuy', null);
    this.menuRoot?.destroy(); this.menuRoot = undefined; this.menuRev = -1;
    this.slotTargets = []; this.menuTargets = []; this.hovered = null;
    if (!this.shown) { this.root?.destroy(); this.root = undefined; this.panel = undefined; this.dim = undefined; return; }
    this.shown = false;
    const root = this.root, panel = this.panel, dim = this.dim;
    this.root = undefined; this.panel = undefined; this.dim = undefined;
    if (!root) return;
    this.tweens.killTweensOf(root);
    if (panel) this.tweens.killTweensOf(panel);
    if (dim) this.tweens.killTweensOf(dim);
    // CLOSE: a little hop UP first (anticipation), then the panel slides DOWN off-screen
    // and fades — cute "boing, drop away". The dim fades out with the drop.
    const H = this.scale.height;
    if (panel) {
      if (dim) this.tweens.add({ targets: dim, alpha: 0, duration: 260, delay: 130 });
      this.tweens.chain({
        targets: panel,
        onComplete: () => root.destroy(),
        tweens: [
          { y: -H * 0.035, duration: 130, ease: 'Sine.easeOut' }, // hop up
          { y: H * 0.18, duration: 240, ease: 'Back.easeIn' },    // slide down off-screen
        ],
      });
      this.tweens.add({ targets: panel, alpha: 0, duration: 200, delay: 150 }); // fade during the drop
    } else {
      if (dim) this.tweens.add({ targets: dim, alpha: 0, duration: 180 });
      this.tweens.add({ targets: root, alpha: 0, duration: 160, onComplete: () => root.destroy() });
    }
  }
}
