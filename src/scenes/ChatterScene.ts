import Phaser from 'phaser';
import { applyHudDpr, hudDpr, hudLogicalW } from '../dpi';
import { dialogFont } from '../i18n';

// Cato's PROACTIVE small-talk chip — a little cream speech box that pops up at the
// TOP-RIGHT, just LEFT of his portrait, with a short remark about what he's doing
// ("something's ripe — going to pick it!"). NOT the main chat: it's ambient flavour.
// Tapping it opens the real dialog seeded with this line (routed by GameScene); left
// alone it auto-hides. GameScene owns the model (`catoChatter`); this scene renders it
// + publishes the tap hit-box (`catoChatterBounds`).
const BOX = 'chatter-box';                 // 128×48 9-slice, insets L20/R20/T12/B12
const SLICE = { l: 20, r: 20, t: 12, b: 12 };
const PORTRAIT = { size: 64, inset: 16 };  // matches layoutFindCatButton (top-right)
// The persistent MOOD emoji REPLACES the rabbit inside the portrait frame: an opaque
// backing (the frame's interior colour) hides the rabbit, the emoji sits on top.
const MOOD_SCALE = 1.15, MOOD_INNER = 40, MOOD_BG = 0x90625d;
const GAP = 10;                            // px between the box's right edge and the portrait
const MAXW = 300, MINW = 120;              // box width bounds
const PAD_X = 22, PAD_Y = 16;              // text inset inside the box
const INK = '#5b4327';
const RES = Math.min(8, Math.max(3, Math.round((typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1) * 3)));
const TYPE_MS = 38; // per-character reveal (typewriter), like the main dialog

interface ChatterModel { visible: boolean; rev: number; text?: string; }

export class ChatterScene extends Phaser.Scene {
  private lastRev = -1;
  private root?: Phaser.GameObjects.Container;
  private moodImg?: Phaser.GameObjects.Image; // persistent top-right mood emoji (in the portrait)
  private moodBg?: Phaser.GameObjects.Rectangle; // opaque backing hiding the rabbit
  private typeTimer?: Phaser.Time.TimerEvent; // typewriter reveal of the chatter text

  constructor() { super({ key: 'ChatterScene' }); }

  create(): void {
    applyHudDpr(this); // high-DPI: render this fixed-pixel HUD in logical space
    this.scale.on('resize', () => applyHudDpr(this));
  }

  update(): void {
    this.updateMood();
    const m = this.registry.get('catoChatter') as ChatterModel | undefined;
    if (!m || m.rev === this.lastRev) return;
    this.lastRev = m.rev;
    if (m.visible && m.text) this.show(m.text);
    else this.hide();
  }

  /** The persistent mood emoji below the portrait — mirrors the head bubble's emoji
   *  but lingers (falls back to `sweet`); frame is driven by `catoMoodFrame`. */
  private updateMood(): void {
    const frame = this.registry.get('catoMoodFrame') as number | undefined;
    if (typeof frame !== 'number') return;
    const W = hudLogicalW(this);
    const x = W - PORTRAIT.inset - PORTRAIT.size / 2; // portrait frame centre
    const y = PORTRAIT.inset + PORTRAIT.size / 2;
    if (!this.moodBg) this.moodBg = this.add.rectangle(x, y, MOOD_INNER, MOOD_INNER, MOOD_BG).setDepth(39);
    if (!this.moodImg) this.moodImg = this.add.image(x, y, 'emoji', frame).setScale(MOOD_SCALE).setDepth(40);
    this.moodBg.setPosition(x, y);
    this.moodImg.setPosition(x, y).setFrame(frame);
  }

  private show(text: string): void {
    this.root?.destroy();
    this.typeTimer?.remove(); this.typeTimer = undefined;
    this.tweens.killTweensOf(this.root ?? {});
    const W = hudLogicalW(this);
    // The box hugs the LEFT of the portrait, vertically centred on it.
    const portraitCx = W - PORTRAIT.inset - PORTRAIT.size / 2;
    const portraitLeft = W - PORTRAIT.inset - PORTRAIT.size;
    const cy = PORTRAIT.inset + PORTRAIT.size / 2;

    // Measure the text wrapped to the max inner width, then size the box to fit.
    const fs = 18;
    const innerMax = MAXW - PAD_X * 2;
    const label = this.add.text(0, 0, text, {
      fontFamily: dialogFont(), fontSize: fs + 'px', color: INK, resolution: RES,
      wordWrap: { width: innerMax }, align: 'left',
    }).setOrigin(0, 0.5);
    const boxW = Phaser.Math.Clamp(Math.ceil(label.width) + PAD_X * 2, MINW, MAXW);
    const boxH = Math.max(48, Math.ceil(label.height) + PAD_Y * 2);
    const boxRight = portraitLeft - GAP;
    const boxCx = boxRight - boxW / 2;

    const c = this.add.container(0, 0).setDepth(50);
    this.root = c;
    // Mirror (negative scaleX — NineSlice has no setFlipX) so the box's tail (native
    // left) points RIGHT, toward the portrait.
    const box = this.add.nineslice(boxCx, cy, BOX, undefined, boxW, boxH, SLICE.l, SLICE.r, SLICE.t, SLICE.b);
    box.scaleX = -1;
    c.add(box);
    label.setPosition(boxCx - boxW / 2 + PAD_X, cy);
    c.add(label);

    // Publish the tap hit-box (a touch of padding) for GameScene to route. GameScene
    // tests DEVICE-px pointer coords, so publish in device px (logical × dpr).
    const d = hudDpr(this);
    this.registry.set('catoChatterBounds', { x: (boxCx - boxW / 2 - 4) * d, y: (cy - boxH / 2 - 4) * d, w: (boxW + 8) * d, h: (boxH + 8) * d });

    // Pop in (fade + slight rise), anchored near the portrait.
    c.setAlpha(0); box.y = cy + 8; label.y = cy + 8;
    this.tweens.add({ targets: [box, label], y: cy, duration: 240, ease: 'Back.easeOut' });
    this.tweens.add({ targets: c, alpha: 1, duration: 180, onComplete: () => this.startTyping(label, text) });
  }

  /** Reveal `text` one char at a time (the box was already sized for the full text, so
   *  it doesn't grow). Starts after the pop-in so the typing reads clearly. */
  private startTyping(label: Phaser.GameObjects.Text, text: string): void {
    if (!label.active) return;
    let i = 0;
    label.setText('');
    this.typeTimer = this.time.addEvent({
      delay: TYPE_MS,
      loop: true,
      callback: () => {
        if (!label.active) { this.typeTimer?.remove(); this.typeTimer = undefined; return; }
        i += 1;
        label.setText(text.slice(0, i));
        if (i >= text.length) { this.typeTimer?.remove(); this.typeTimer = undefined; }
      },
    });
  }

  private hide(): void {
    this.registry.set('catoChatterBounds', null);
    this.typeTimer?.remove(); this.typeTimer = undefined;
    const root = this.root;
    this.root = undefined;
    if (!root) return;
    this.tweens.killTweensOf(root);
    this.tweens.add({ targets: root, alpha: 0, duration: 180, onComplete: () => root.destroy() });
  }
}
