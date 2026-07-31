import Phaser from 'phaser';
import { dialogFont, t } from '../i18n';

// The CRAFTING modal (opened by the in-world work station). A standalone overlay like
// ConfirmScene: GameScene owns the model (`craft` registry key) + all logic; this scene
// renders it and publishes hit-boxes to `craftBounds` (recipe rows + Craft button +
// close) which GameScene routes. Layout mirrors the reference: title, LEFT = scrollable
// recipe list (icon + name), RIGHT = required materials (have/need) + description + a
// Craft button. The list scrolls in-scene (wheel + touch swipe); selection/craft route
// through GameScene.
const ATLAS = 'inventory';
const PANEL_FRAME = 'frame-medium', PANEL_SLICE = { l: 10, r: 10, t: 11, b: 11 }, PANEL_SCALE = 3;
const SLOT_FRAME = 'slot-light', SLOT_SLICE = { l: 7, r: 7, t: 8, b: 8 }, SLOT_SCALE = 2;
const ROW_FRAME = 'slot-light';
const BTN = 'square-buttons', BTN_FRAME = 'white-button';
const ICONS = 'ui-icons', ICON_CLOSE = 46;
const INK = '#5b3a1e', SUB = '#8a6a44', BAD = '#b5533a';
const SEL_TINT = 0xffe6a8, DIM_TINT = 0x9a8467;
const DIM_ALPHA = 0.82; // full-screen mask darkening the game (matches MenuScene)
const WHEEL_MS = 110;

export interface CraftMat { iconKey: string; iconFrame: string | number; need: number; have: number; ok: boolean }
export interface CraftRow { id: string; iconKey: string; iconFrame: string | number; name: string; count: number; ok: boolean }
export interface CraftModel {
  visible: boolean;
  rev: number;
  recipes: CraftRow[];
  selected: number;
  detail?: { name: string; desc: string; iconKey: string; iconFrame: string | number; outCount: number; materials: CraftMat[]; canCraft: boolean };
  msg?: string;
}

export class CraftScene extends Phaser.Scene {
  private lastRev = -1;
  private shown = false;
  private root?: Phaser.GameObjects.Container;
  private scroll = 0;
  private visibleRows = 8;
  private totalRows = 0;
  private lastWheelMs = 0;
  private swiping = false;
  private swipeY = 0;
  private swipeAccum = 0;

  constructor() {
    super({ key: 'CraftScene' });
  }

  create(): void {
    // Wheel scrolls the recipe list one row (throttled so trackpad bursts don't fly).
    this.input.on('wheel', (_p: Phaser.Input.Pointer, _o: unknown, _dx: number, dy: number) => {
      if (!this.shown) return;
      const now = this.time.now;
      if (now - this.lastWheelMs < WHEEL_MS) return;
      this.lastWheelMs = now;
      this.setScroll(this.scroll + (dy > 0 ? 1 : -1));
    });
    // Touch swipe scrolls (no wheel on touch).
    this.input.on('pointerdown', (p: Phaser.Input.Pointer) => { if (this.shown && p.wasTouch) { this.swiping = true; this.swipeY = p.y; this.swipeAccum = 0; } });
    this.input.on('pointermove', (p: Phaser.Input.Pointer) => {
      if (!this.swiping) return;
      this.swipeAccum += p.y - this.swipeY;
      this.swipeY = p.y;
      const step = 46;
      while (this.swipeAccum >= step) { this.swipeAccum -= step; this.setScroll(this.scroll - 1); }
      while (this.swipeAccum <= -step) { this.swipeAccum += step; this.setScroll(this.scroll + 1); }
    });
    this.input.on('pointerup', () => { this.swiping = false; });
  }

  update(): void {
    const m = this.model();
    if (!m || m.rev === this.lastRev) return;
    this.lastRev = m.rev;
    // Pop the panel in only on the FIRST open; re-renders (selecting a recipe / crafting)
    // rebuild in place with no animation.
    if (m.visible) this.render(m, !this.shown);
    else this.close();
  }

  private model(): CraftModel | undefined {
    return this.registry.get('craft') as CraftModel | undefined;
  }

  private setScroll(v: number): void {
    const max = Math.max(0, this.totalRows - this.visibleRows);
    const next = Phaser.Math.Clamp(v, 0, max);
    if (next === this.scroll) return;
    this.scroll = next;
    const m = this.model();
    if (m?.visible) this.render(m, false);
  }

  private T(x: number, y: number, s: string, size: number, color: string, origin = 0.5): Phaser.GameObjects.Text {
    return this.add.text(x, y, s, { fontFamily: dialogFont(), fontSize: `${Math.round(size)}px`, color }).setOrigin(origin, 0.5);
  }

  private render(m: CraftModel, popIn = true): void {
    this.root?.destroy();
    if (popIn) this.tweens.killAll();
    this.shown = true;
    const W = this.scale.width, H = this.scale.height;
    const cx = W / 2, cy = H / 2;
    const c = this.add.container(0, 0);
    this.root = c;

    // Full-screen MASK darkening the game behind the modal (same as the menu's). NOTE:
    // the FILL alpha must stay DIM_ALPHA — fade in via the object `alpha` (0→1), not the
    // fill alpha, or the mask renders fully transparent (the "no mask" bug).
    const dim = this.add.rectangle(0, 0, W, H, 0x000000, DIM_ALPHA).setOrigin(0, 0);
    if (popIn) { dim.setAlpha(0); this.tweens.add({ targets: dim, alpha: 1, duration: 160 }); }
    c.add(dim);

    const box = this.add.container(cx, cy);
    c.add(box);

    const pw = Math.min(W * 0.82, 960), ph = Math.min(H * 0.8, 660);
    box.add(this.add.nineslice(0, 0, ATLAS, PANEL_FRAME, pw / PANEL_SCALE, ph / PANEL_SCALE, PANEL_SLICE.l, PANEL_SLICE.r, PANEL_SLICE.t, PANEL_SLICE.b).setScale(PANEL_SCALE));

    const left = -pw / 2, top = -ph / 2;
    box.add(this.T(0, top + ph * 0.07, t('craft_title'), ph * 0.05, '#fff8e6'));

    // Close button (top-right).
    const closeSz = ph * 0.09, closeX = pw / 2 - closeSz * 0.75, closeY = top + closeSz * 0.75;
    const closeBtn = this.add.container(closeX, closeY);
    closeBtn.add(this.add.nineslice(0, 0, BTN, BTN_FRAME, closeSz, closeSz, 6, 6, 7, 7));
    if (this.textures.exists(ICONS)) { const ic = this.add.image(0, 0, ICONS, ICON_CLOSE); ic.setScale((closeSz * 0.5) / Math.max(ic.width, ic.height)); closeBtn.add(ic); }
    box.add(closeBtn);

    // ── LEFT: recipe list ──
    const listX = left + pw * 0.05, listY = top + ph * 0.17, listW = pw * 0.42, rowH = ph * 0.088, gap = ph * 0.014;
    this.visibleRows = Math.max(1, Math.floor((ph * 0.74) / (rowH + gap)));
    this.totalRows = m.recipes.length;
    this.scroll = Math.min(this.scroll, Math.max(0, this.totalRows - this.visibleRows));
    const rowBounds: Array<{ x: number; y: number; w: number; h: number; idx: number }> = [];
    for (let r = 0; r < this.visibleRows; r++) {
      const idx = this.scroll + r;
      if (idx >= m.recipes.length) break;
      const e = m.recipes[idx];
      const ry = listY + r * (rowH + gap);
      // Keep the row bg readable — only the SELECTED row is tinted (gold). Un-craftable
      // is shown by a dimmed ICON + muted name, NOT a dark bg (that hid the text).
      const bg = this.add.nineslice(listX + listW / 2, ry + rowH / 2, ATLAS, ROW_FRAME, listW / SLOT_SCALE, rowH / SLOT_SCALE, SLOT_SLICE.l, SLOT_SLICE.r, SLOT_SLICE.t, SLOT_SLICE.b).setScale(SLOT_SCALE);
      if (idx === m.selected) bg.setTint(SEL_TINT);
      box.add(bg);
      if (this.textures.exists(e.iconKey)) { const ic = this.add.image(listX + rowH * 0.6, ry + rowH / 2, e.iconKey, e.iconFrame); ic.setScale((rowH * 0.62) / Math.max(ic.width, ic.height)); if (!e.ok) ic.setAlpha(0.45); box.add(ic); }
      box.add(this.T(listX + rowH * 1.15, ry + rowH / 2, e.count > 1 ? `${e.name} ×${e.count}` : e.name, ph * 0.032, e.ok ? INK : SUB, 0));
      rowBounds.push({ x: cx + listX, y: cy + ry, w: listW, h: rowH, idx });
    }
    // Scrollbar.
    if (this.totalRows > this.visibleRows) {
      const railX = listX + listW + pw * 0.02, railTop = listY, railH = this.visibleRows * (rowH + gap) - gap;
      box.add(this.add.rectangle(railX, railTop + railH / 2, 6, railH, 0x3a2a12, 0.2).setOrigin(0.5));
      const thumbH = Math.max(24, railH * (this.visibleRows / this.totalRows));
      const thumbY = railTop + (railH - thumbH) * (this.scroll / Math.max(1, this.totalRows - this.visibleRows));
      box.add(this.add.rectangle(railX, thumbY + thumbH / 2, 6, thumbH, 0x9a7b4f, 1).setOrigin(0.5));
    }

    // ── RIGHT: materials + description + Craft button ──
    const rx = left + pw * 0.52, rw = pw * 0.43;
    const d = m.detail;
    // Materials box.
    const matY = top + ph * 0.17, matH = ph * 0.26;
    box.add(this.add.nineslice(rx + rw / 2, matY + matH / 2, ATLAS, PANEL_FRAME, rw / PANEL_SCALE, matH / PANEL_SCALE, PANEL_SLICE.l, PANEL_SLICE.r, PANEL_SLICE.t, PANEL_SLICE.b).setScale(PANEL_SCALE));
    if (!d) {
      box.add(this.T(rx + rw / 2, cy - cy + matY + matH / 2, t('craft_pick'), ph * 0.03, SUB));
    } else {
      box.add(this.T(rx + rw * 0.06, matY + matH * 0.16, t('craft_materials'), ph * 0.026, SUB, 0));
      const per = rw / Math.max(3, d.materials.length);
      const iconY = matY + matH * 0.58;
      d.materials.forEach((mat, i) => {
        const mxc = rx + per * (i + 0.5);
        if (this.textures.exists(mat.iconKey)) { const ic = this.add.image(mxc, iconY - ph * 0.02, mat.iconKey, mat.iconFrame); ic.setScale((matH * 0.4) / Math.max(ic.width, ic.height)); box.add(ic); }
        box.add(this.T(mxc, iconY + matH * 0.24, `${mat.have}/${mat.need}`, ph * 0.028, mat.ok ? INK : BAD));
      });
    }
    // Description.
    const descY = matY + matH + ph * 0.04;
    if (d) {
      box.add(this.T(rx, descY, d.name, ph * 0.036, INK, 0));
      box.add(this.add.text(rx, descY + ph * 0.05, d.desc, { fontFamily: dialogFont(), fontSize: `${Math.round(ph * 0.028)}px`, color: SUB, wordWrap: { width: rw }, lineSpacing: 4 }).setOrigin(0, 0));
    }
    // Craft button.
    const cbW = rw * 0.6, cbH = ph * 0.1, cbX = rx + rw / 2, cbY = top + ph * 0.86;
    const cbTintOk = !!d?.canCraft;
    const cbg = this.add.nineslice(cbX, cbY, BTN, BTN_FRAME, cbW, cbH, 6, 6, 7, 7);
    if (!cbTintOk) cbg.setTint(DIM_TINT);
    box.add(cbg);
    box.add(this.T(cbX, cbY, m.msg || t('craft_button'), ph * 0.036, m.msg ? BAD : '#5b4327'));
    const craftB = { x: cx + cbX - cbW / 2, y: cy + cbY - cbH / 2, w: cbW, h: cbH };

    if (popIn) { box.setScale(0.85); this.tweens.add({ targets: box, scale: 1, duration: 160, ease: 'Back.easeOut' }); }

    this.registry.set('craftBounds', {
      rows: rowBounds,
      craft: craftB,
      close: { x: cx + closeX - closeSz / 2, y: cy + closeY - closeSz / 2, w: closeSz, h: closeSz },
      panel: { x: cx - pw / 2, y: cy - ph / 2, w: pw, h: ph },
    });
  }

  private close(): void {
    this.registry.set('craftBounds', null);
    this.scroll = 0;
    if (!this.shown) { this.root?.destroy(); this.root = undefined; return; }
    this.shown = false;
    const root = this.root;
    this.root = undefined;
    if (!root) return;
    this.tweens.add({ targets: root, alpha: 0, duration: 120, onComplete: () => root.destroy() });
  }
}
