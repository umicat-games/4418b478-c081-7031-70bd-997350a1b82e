import Phaser from 'phaser';
import { applyHudDpr } from '../dpi';

/** Tool-HUD model published by GameScene to the `toolHud` registry key each frame (screen px). */
export interface ToolHudModel {
  visible: boolean;
  slot: number;                 // slot size (px)
  hx: number; hy: number;        // the current-tool slot centre
  currentKey: string; currentFrame: string | number; // the held tool's icon (or the mouse icon)
  expanded: boolean;
  items: Array<{ x: number; y: number; key: string; frame: string | number; selected: boolean }>; // the fly-out row
}

const HUD_KEY = 'toolHud';
const SLOT_ATLAS = 'square-buttons';
const SLOT_FRAME = 'light-brown-button';
const SLOT_SEL = 'white-button-pressed-down';
const NINE: [number, number, number, number] = [6, 6, 7, 7];

/**
 * The current-tool indicator under the weather HUD (Sprout-Valley style): a slot showing the tool
 * you're holding (or the mouse icon when empty-handed). TAP it to fly a row of the tools out to the
 * right (+ a mouse = cancel); tap one to equip/cancel and the row collapses. This is the unified
 * (touch AND desktop) way to switch/cancel a tool without overloading the world tap. GameScene owns
 * the model + tap routing; this scene renders + animates the fly-out.
 */
export class ToolHudScene extends Phaser.Scene {
  private slotBg?: Phaser.GameObjects.NineSlice;
  private slotIcon?: Phaser.GameObjects.Image;
  private row: Array<{ bg: Phaser.GameObjects.NineSlice; icon: Phaser.GameObjects.Image }> = [];
  private shown = false; // is the fly-out currently expanded (drives the open/close tween)

  constructor() { super({ key: 'ToolHudScene' }); }

  create(): void {
    applyHudDpr(this); // high-DPI: fixed-pixel HUD → logical space via dpr camera
    this.scale.on('resize', () => applyHudDpr(this));
    this.slotBg = this.add.nineslice(0, 0, SLOT_ATLAS, SLOT_FRAME, 42, 42, ...NINE).setVisible(false);
    this.slotIcon = this.add.image(0, 0, 'cursor').setVisible(false);
    this.scene.bringToTop();
  }

  update(): void {
    const m = this.registry.get(HUD_KEY) as ToolHudModel | undefined;
    const bg = this.slotBg, icon = this.slotIcon;
    if (!bg || !icon) return;
    if (!m || !m.visible) { bg.setVisible(false); icon.setVisible(false); this.row.forEach((r) => { r.bg.setVisible(false); r.icon.setVisible(false); }); return; }

    // Current-tool slot.
    bg.setVisible(true).setPosition(m.hx, m.hy).setSize(m.slot, m.slot);
    this.fitIcon(icon.setVisible(true).setPosition(m.hx, m.hy).setTexture(m.currentKey, m.currentFrame), m.slot);

    // Fly-out row: grow/shrink the pool, render each item, animate x from the HUD slot on open.
    while (this.row.length < m.items.length) {
      this.row.push({ bg: this.add.nineslice(0, 0, SLOT_ATLAS, SLOT_FRAME, 42, 42, ...NINE), icon: this.add.image(0, 0, 'cursor') });
    }
    const opening = m.expanded && !this.shown, closing = !m.expanded && this.shown;
    this.shown = m.expanded;
    this.row.forEach((r, i) => {
      const it = m.items[i];
      if (!it || !m.expanded) {
        if (closing) { this.tweens.add({ targets: [r.bg, r.icon], x: m.hx, alpha: 0, duration: 130, onComplete: () => { r.bg.setVisible(false); r.icon.setVisible(false); } }); }
        else if (!m.expanded) { r.bg.setVisible(false); r.icon.setVisible(false); }
        return;
      }
      r.bg.setVisible(true).setSize(m.slot, m.slot).setTexture(SLOT_ATLAS, it.selected ? SLOT_SEL : SLOT_FRAME);
      r.icon.setVisible(true).setTexture(it.key, it.frame);
      this.fitIcon(r.icon, m.slot);
      if (opening) {
        r.bg.setPosition(m.hx, it.y).setAlpha(0); r.icon.setPosition(m.hx, it.y).setAlpha(0);
        this.tweens.add({ targets: [r.bg, r.icon], x: it.x, alpha: 1, duration: 150, delay: i * 24, ease: 'Back.easeOut' });
      } else {
        r.bg.setPosition(it.x, it.y).setAlpha(1); r.icon.setPosition(it.x, it.y).setAlpha(1);
      }
      this.children.bringToTop(r.icon);
    });
  }

  private fitIcon(icon: Phaser.GameObjects.Image, slot: number): void {
    icon.setScale((slot * 0.6) / Math.max(icon.width, icon.height || 1));
  }
}
