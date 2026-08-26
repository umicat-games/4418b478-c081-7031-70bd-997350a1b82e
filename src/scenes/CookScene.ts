import Phaser from 'phaser';
import { dialogFont, t } from '../i18n';
import { playSfx } from '../sfx';
import type { GameScene } from './GameScene';

// The COOKING modal — opened by the kitchen STOVE inside the house. It looks like the
// crafting modal (CraftScene), but it is SELF-CONTAINED: inside the house GameScene is
// PAUSED, so (unlike CraftScene, which GameScene renders + routes) this scene owns its own
// rendering AND pointer input, and calls GameScene's PUBLIC cook methods (`buildCookModel` /
// `tryCook`) synchronously — the paused scene's state is intact, so its chest logic still
// runs. HouseScene launches it (and lights the stove); on close it emits `cook-closed` so
// HouseScene can turn the stove off.
const ATLAS = 'inventory';
const PANEL_FRAME = 'frame-medium', PANEL_SLICE = { l: 10, r: 10, t: 11, b: 11 }, PANEL_SCALE = 3;
const SLOT_FRAME = 'slot-light', SLOT_SLICE = { l: 7, r: 7, t: 8, b: 8 }, SLOT_SCALE = 2;
const BTN = 'square-buttons', BTN_FRAME = 'white-button';
// Close button — the SAME `icon-buttons` graphic the chest/mail/shop modals use (a complete
// button image, not a nineslice + icon), with a pressed-down frame for the click feedback.
const CLOSE_ATLAS = 'icon-buttons', CLOSE_FRAME = 'close-light-big', CLOSE_PRESSED = 'close-light-big-pressed-down';
const INK = '#5b3a1e', SUB = '#8a6a44', BAD = '#b5533a';
const SEL_TINT = 0xffe6a8, DIM_TINT = 0x9a8467;
const DIM_ALPHA = 0.82;
const WHEEL_MS = 110;

export interface CookMatView { iconKey: string; iconFrame: string | number; need: number; have: number; ok: boolean }
export interface CookRowView { id: string; iconKey: string; iconFrame: string | number; name: string; count: number; ok: boolean }
export interface CookModel {
  recipes: CookRowView[];
  detail?: { name: string; desc: string; iconKey: string; iconFrame: string | number; outCount: number; materials: CookMatView[]; canCook: boolean };
}

export class CookScene extends Phaser.Scene {
  private gsKey = 'GameScene';
  private sel = 0;
  private msg = '';
  private root?: Phaser.GameObjects.Container;
  private scroll = 0;
  private visibleRows = 8;
  private totalRows = 0;
  private lastWheelMs = 0;
  private swiping = false;
  private swipeY = 0;
  private swipeAccum = 0;
  private closing = false;
  private closeImg?: Phaser.GameObjects.Image; // the X (frame-swapped for the press flash)

  constructor() { super({ key: 'CookScene' }); }

  init(data: { gameScene?: string }): void {
    this.gsKey = data?.gameScene ?? 'GameScene';
    this.sel = 0;
    this.msg = '';
    this.scroll = 0;
    this.closing = false;
  }

  private gs(): GameScene | undefined {
    return this.scene.get(this.gsKey) as GameScene | undefined;
  }

  create(): void {
    // This scene is modal + owns its input (HouseScene input is disabled while we're open).
    this.input.on('wheel', (_p: Phaser.Input.Pointer, _o: unknown, _dx: number, dy: number) => {
      const now = this.time.now;
      if (now - this.lastWheelMs < WHEEL_MS) return;
      this.lastWheelMs = now;
      this.setScroll(this.scroll + (dy > 0 ? 1 : -1));
    });
    this.input.on('pointerdown', (p: Phaser.Input.Pointer) => {
      if (p.wasTouch) { this.swiping = true; this.swipeY = p.y; this.swipeAccum = 0; }
    });
    this.input.on('pointermove', (p: Phaser.Input.Pointer) => {
      if (!this.swiping) return;
      this.swipeAccum += p.y - this.swipeY;
      this.swipeY = p.y;
      const step = 46;
      while (this.swipeAccum >= step) { this.swipeAccum -= step; this.setScroll(this.scroll - 1); }
      while (this.swipeAccum <= -step) { this.swipeAccum += step; this.setScroll(this.scroll + 1); }
    });
    this.input.on('pointerup', (p: Phaser.Input.Pointer) => {
      this.swiping = false;
      // A tap (not a swipe) routes to the modal hit-boxes.
      if (Math.abs(this.swipeAccum) < 20) this.handleClick(p.x, p.y);
    });
    this.input.keyboard?.on('keydown-ESC', () => this.close());
    this.render(true);
  }

  private setScroll(v: number): void {
    const max = Math.max(0, this.totalRows - this.visibleRows);
    const next = Phaser.Math.Clamp(v, 0, max);
    if (next === this.scroll) return;
    this.scroll = next;
    this.render(false);
  }

  private T(x: number, y: number, s: string, size: number, color: string, origin = 0.5): Phaser.GameObjects.Text {
    return this.add.text(x, y, s, { fontFamily: dialogFont(), fontSize: `${Math.round(size)}px`, color }).setOrigin(origin, 0.5);
  }

  private render(popIn: boolean): void {
    this.root?.destroy();
    if (popIn) this.tweens.killAll();
    const m = this.gs()?.buildCookModel(this.sel) ?? { recipes: [] as CookRowView[] };
    const W = this.scale.width, H = this.scale.height;
    const cx = W / 2, cy = H / 2;
    const c = this.add.container(0, 0);
    this.root = c;

    const dim = this.add.rectangle(0, 0, W, H, 0x000000, DIM_ALPHA).setOrigin(0, 0);
    if (popIn) { dim.setAlpha(0); this.tweens.add({ targets: dim, alpha: 1, duration: 160 }); }
    c.add(dim);

    const box = this.add.container(cx, cy);
    c.add(box);

    const pw = Math.min(W * 0.82, 960), ph = Math.min(H * 0.8, 660);
    box.add(this.add.nineslice(0, 0, ATLAS, PANEL_FRAME, pw / PANEL_SCALE, ph / PANEL_SCALE, PANEL_SLICE.l, PANEL_SLICE.r, PANEL_SLICE.t, PANEL_SLICE.b).setScale(PANEL_SCALE));

    const left = -pw / 2, top = -ph / 2;
    box.add(this.T(0, top + ph * 0.07, t('cook_title'), ph * 0.05, '#fff8e6'));

    // Close button (top-right) — the shared `close-light-big` graphic (like chest/mail/shop).
    const closeSz = ph * 0.1, closeX = pw / 2 - closeSz * 0.7, closeY = top + closeSz * 0.7;
    this.closeImg = undefined;
    if (this.textures.exists(CLOSE_ATLAS) && this.textures.get(CLOSE_ATLAS).has(CLOSE_FRAME)) {
      this.closeImg = this.add.image(closeX, closeY, CLOSE_ATLAS, CLOSE_FRAME).setDisplaySize(closeSz, closeSz);
      box.add(this.closeImg);
    } else {
      const cb = this.add.container(closeX, closeY);
      cb.add(this.add.nineslice(0, 0, BTN, BTN_FRAME, closeSz, closeSz, 6, 6, 7, 7));
      box.add(cb);
    }

    // Empty state — no recipes defined yet.
    if (m.recipes.length === 0) {
      box.add(this.T(0, 0, t('cook_empty'), ph * 0.034, SUB));
      this.finishRender(popIn, box, cx, cy, pw, ph, closeX, closeY, closeSz, [], undefined);
      return;
    }

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
      const bg = this.add.nineslice(listX + listW / 2, ry + rowH / 2, ATLAS, SLOT_FRAME, listW / SLOT_SCALE, rowH / SLOT_SCALE, SLOT_SLICE.l, SLOT_SLICE.r, SLOT_SLICE.t, SLOT_SLICE.b).setScale(SLOT_SCALE);
      if (idx === this.sel) bg.setTint(SEL_TINT);
      box.add(bg);
      if (this.textures.exists(e.iconKey)) { const ic = this.add.image(listX + rowH * 0.6, ry + rowH / 2, e.iconKey, e.iconFrame); ic.setScale((rowH * 0.62) / Math.max(ic.width, ic.height)); if (!e.ok) ic.setAlpha(0.45); box.add(ic); }
      box.add(this.T(listX + rowH * 1.15, ry + rowH / 2, e.count > 1 ? `${e.name} ×${e.count}` : e.name, ph * 0.032, e.ok ? INK : SUB, 0));
      rowBounds.push({ x: cx + listX, y: cy + ry, w: listW, h: rowH, idx });
    }
    if (this.totalRows > this.visibleRows) {
      const railX = listX + listW + pw * 0.02, railTop = listY, railH = this.visibleRows * (rowH + gap) - gap;
      box.add(this.add.rectangle(railX, railTop + railH / 2, 6, railH, 0x3a2a12, 0.2).setOrigin(0.5));
      const thumbH = Math.max(24, railH * (this.visibleRows / this.totalRows));
      const thumbY = railTop + (railH - thumbH) * (this.scroll / Math.max(1, this.totalRows - this.visibleRows));
      box.add(this.add.rectangle(railX, thumbY + thumbH / 2, 6, thumbH, 0x9a7b4f, 1).setOrigin(0.5));
    }

    // ── RIGHT: ingredients + description + Cook button ──
    const rx = left + pw * 0.52, rw = pw * 0.43;
    const d = m.detail;
    const matY = top + ph * 0.17, matH = ph * 0.26;
    box.add(this.add.nineslice(rx + rw / 2, matY + matH / 2, ATLAS, PANEL_FRAME, rw / PANEL_SCALE, matH / PANEL_SCALE, PANEL_SLICE.l, PANEL_SLICE.r, PANEL_SLICE.t, PANEL_SLICE.b).setScale(PANEL_SCALE));
    if (!d) {
      box.add(this.T(rx + rw / 2, matY + matH / 2, t('cook_pick'), ph * 0.03, SUB));
    } else {
      box.add(this.T(rx + rw * 0.06, matY + matH * 0.16, t('cook_ingredients'), ph * 0.026, SUB, 0));
      const per = rw / Math.max(3, d.materials.length);
      const iconY = matY + matH * 0.58;
      d.materials.forEach((mat, i) => {
        const mxc = rx + per * (i + 0.5);
        if (this.textures.exists(mat.iconKey)) { const ic = this.add.image(mxc, iconY - ph * 0.02, mat.iconKey, mat.iconFrame); ic.setScale((matH * 0.4) / Math.max(ic.width, ic.height)); box.add(ic); }
        box.add(this.T(mxc, iconY + matH * 0.24, `${mat.have}/${mat.need}`, ph * 0.028, mat.ok ? INK : BAD));
      });
    }
    const descY = matY + matH + ph * 0.04;
    if (d) {
      box.add(this.T(rx, descY, d.name, ph * 0.036, INK, 0));
      box.add(this.add.text(rx, descY + ph * 0.05, d.desc, { fontFamily: dialogFont(), fontSize: `${Math.round(ph * 0.028)}px`, color: SUB, wordWrap: { width: rw }, lineSpacing: 4 }).setOrigin(0, 0));
    }
    const cbW = rw * 0.6, cbH = ph * 0.1, cbX = rx + rw / 2, cbY = top + ph * 0.86;
    const cbOk = !!d?.canCook;
    const cbg = this.add.nineslice(cbX, cbY, BTN, BTN_FRAME, cbW, cbH, 6, 6, 7, 7);
    if (!cbOk) cbg.setTint(DIM_TINT);
    box.add(cbg);
    box.add(this.T(cbX, cbY, this.msg || t('cook_button'), ph * 0.036, this.msg ? BAD : '#5b4327'));
    const cookB = { x: cx + cbX - cbW / 2, y: cy + cbY - cbH / 2, w: cbW, h: cbH };

    this.finishRender(popIn, box, cx, cy, pw, ph, closeX, closeY, closeSz, rowBounds, cookB);
  }

  private lastBounds?: { rows: Array<{ x: number; y: number; w: number; h: number; idx: number }>; cook?: { x: number; y: number; w: number; h: number }; close: { x: number; y: number; w: number; h: number }; panel: { x: number; y: number; w: number; h: number } };

  private finishRender(
    popIn: boolean, box: Phaser.GameObjects.Container, cx: number, cy: number, pw: number, ph: number,
    closeX: number, closeY: number, closeSz: number,
    rows: Array<{ x: number; y: number; w: number; h: number; idx: number }>,
    cook?: { x: number; y: number; w: number; h: number },
  ): void {
    if (popIn) { box.setScale(0.85); this.tweens.add({ targets: box, scale: 1, duration: 160, ease: 'Back.easeOut' }); }
    this.lastBounds = {
      rows, cook,
      close: { x: cx + closeX - closeSz / 2, y: cy + closeY - closeSz / 2, w: closeSz, h: closeSz },
      panel: { x: cx - pw / 2, y: cy - ph / 2, w: pw, h: ph },
    };
  }

  /** Route a tap while the modal is open (modal — always consumes). */
  private handleClick(x: number, y: number): void {
    const b = this.lastBounds;
    if (!b || this.closing) return;
    const hit = (r: { x: number; y: number; w: number; h: number }) => x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;
    if (hit(b.close)) {
      // Press feedback: swap to the pressed-down frame, then close a beat later.
      const img = this.closeImg;
      if (img?.active && this.textures.get(CLOSE_ATLAS).has(CLOSE_PRESSED)) {
        img.setFrame(CLOSE_PRESSED);
        this.closing = true; // swallow further taps during the flash
        this.time.delayedCall(110, () => { this.closing = false; this.close(); });
      } else {
        this.close();
      }
      return;
    }
    const row = b.rows.find((r) => hit(r));
    if (row) { this.sel = row.idx; this.msg = ''; this.render(false); return; }
    if (b.cook && hit(b.cook)) { this.cook(); return; }
    if (!hit(b.panel)) this.close(); // tap outside → close
  }

  private cook(): void {
    const res = this.gs()?.tryCook(this.sel);
    if (!res) return;
    this.msg = res.key ? t(res.key) : '';
    this.render(false);
    if (this.msg) this.time.delayedCall(1400, () => { this.msg = ''; if (!this.closing) this.render(false); });
  }

  private close(): void {
    if (this.closing) return;
    this.closing = true;
    playSfx(this); // close blip (same UI click as the chest/menu close)
    const root = this.root;
    this.events.emit('cook-closed'); // HouseScene turns the stove off + re-enables input
    if (!root) { this.scene.stop(); return; }
    this.tweens.add({ targets: root, alpha: 0, duration: 120, onComplete: () => { root.destroy(); this.scene.stop(); } });
  }
}
