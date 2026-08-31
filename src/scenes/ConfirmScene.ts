import Phaser from 'phaser';
import { dialogFont } from '../i18n';

// A small modal YES/NO dialog — a wooden panel with a title and two rounded pixel
// buttons (✓ confirm, ⊘ cancel). Used to confirm demolishing a placed house piece
// (hoe it once → "你想拆除这座建筑吗？"). GameScene owns the model (`confirm` registry
// key) and routes taps: this scene just renders + publishes the button hit-boxes to
// `confirmBounds`, which GameScene checks first (it's modal) in actAt.
const ATLAS = 'inventory';
const FRAME_PANEL = 'frame-medium';
const PANEL_SCALE = 2; // 9-slice corner scale (matches HotbarScene) → crisp border

const BUTTON = 'square-buttons';
const BUTTON_FRAME = 'white-button';
const BUTTON_FRAME_PRESSED = 'white-button-pressed-down';
const ICONS = 'ui-icons';
const ICON_OK = 44;     // ✓ dark-brown check
const ICON_CANCEL = 46; // ⊘ dark-brown cancel

const BTN = 56;         // button size (px)
const OK_TINT = 0xffffff;

export interface ConfirmModel {
  visible: boolean;
  title: string;   // body text (may contain \n\n paragraph breaks)
  heading?: string; // optional bold top-centred title
  rev: number;
}

export class ConfirmScene extends Phaser.Scene {
  private lastRev = -1;
  private shown = false;
  private root?: Phaser.GameObjects.Container;
  private okBg?: Phaser.GameObjects.NineSlice;     // ✓ button bg (frame-swapped while held)
  private cancelBg?: Phaser.GameObjects.NineSlice; // ⊘ button bg

  constructor() {
    super({ key: 'ConfirmScene' });
  }

  update(): void {
    this.updatePressed(); // hold the pressed frame while GameScene reports a held button
    const m = this.model();
    if (!m || m.rev === this.lastRev) return;
    this.lastRev = m.rev;
    if (m.visible) this.open(m);
    else this.close();
  }

  /** Swap ✓/⊘ to their pressed frame while held down (GameScene sets `confirmHeld`), revert on release. */
  private updatePressed(): void {
    const held = this.registry.get('confirmHeld') as string | null | undefined;
    const set = (bg: Phaser.GameObjects.NineSlice | undefined, on: boolean): void => {
      if (!bg || !bg.active) return;
      const f = on ? BUTTON_FRAME_PRESSED : BUTTON_FRAME;
      if (bg.frame.name !== f) bg.setFrame(f);
    };
    set(this.okBg, held === 'ok');
    set(this.cancelBg, held === 'cancel');
  }

  private model(): ConfirmModel | undefined {
    return this.registry.get('confirm') as ConfirmModel | undefined;
  }

  private open(model: ConfirmModel): void {
    this.root?.destroy();
    this.tweens.killAll();
    this.shown = true;
    const W = this.scale.width, H = this.scale.height;
    const cx = W / 2, cy = H / 2;

    const c = this.add.container(0, 0);
    this.root = c;

    // Modal dim backdrop (fades in) — blocks the game visually while the dialog is up. NB: the
    // fill alpha must be the target (0.5); tweening the GameObject `alpha` from 0→1 fades it in
    // (a `fillAlpha:0` rect stays invisible no matter the GO alpha — the old "no mask" bug).
    const dim = this.add.rectangle(0, 0, W, H, 0x000000, 0.5).setOrigin(0, 0).setAlpha(0);
    this.tweens.add({ targets: dim, alpha: 1, duration: 140 });
    c.add(dim);

    // A grouped panel + contents that pops in as one unit.
    const box = this.add.container(cx, cy);
    c.add(box);

    // Panel height ADAPTS to the (wrapped) heading + body so buttons never overlap a longer message
    // (a one-line "Remove?" stays compact; the multi-paragraph upgrade prompt grows taller).
    const panelW = 340;
    // Optional bold top-centred TITLE (heading), a touch larger + darker than the body.
    const heading = model.heading
      ? this.add.text(0, 0, model.heading, { fontFamily: dialogFont(), fontSize: '27px', color: '#4a2e12', align: 'center', fontStyle: 'bold', wordWrap: { width: panelW - 52 } }).setOrigin(0.5)
      : null;
    // Body — supports \n\n paragraph breaks (Phaser honours the newlines; wordWrap wraps within each).
    const title = this.add
      .text(0, 0, model.title, {
        fontFamily: dialogFont(),
        fontSize: '21px',
        color: '#5b3a1e',
        align: 'center',
        lineSpacing: 4,
        wordWrap: { width: panelW - 52 },
      })
      .setOrigin(0.5);
    const TOP = 28, HEAD_GAP = 16, GAP = 24, BOT = 28;
    const headBlock = heading ? heading.height + HEAD_GAP : 0;
    const panelH = Math.round(TOP + headBlock + title.height + GAP + BTN + BOT);

    const panel = this.add.nineslice(0, 0, ATLAS, FRAME_PANEL, panelW / PANEL_SCALE, panelH / PANEL_SCALE, 10, 10, 11, 11);
    panel.setScale(PANEL_SCALE);
    box.add(panel);

    let y = -panelH / 2 + TOP;
    if (heading) { heading.setPosition(0, y + heading.height / 2); box.add(heading); y += heading.height + HEAD_GAP; }
    title.setPosition(0, y + title.height / 2);
    box.add(title);

    // Two buttons, side by side below the body.
    const okX = -58, cancelX = 58, btnY = panelH / 2 - BOT - BTN / 2;
    box.add(this.button(okX, btnY, ICON_OK, 'ok'));
    box.add(this.button(cancelX, btnY, ICON_CANCEL, 'cancel'));

    // Pop-in.
    box.setScale(0.8);
    this.tweens.add({ targets: box, scale: 1, duration: 160, ease: 'Back.easeOut' });

    // Hit-boxes in SCREEN space (GameScene routes the tap).
    this.registry.set('confirmBounds', [
      { action: 'ok', x: cx + okX - BTN / 2, y: cy + btnY - BTN / 2, w: BTN, h: BTN },
      { action: 'cancel', x: cx + cancelX - BTN / 2, y: cy + btnY - BTN / 2, w: BTN, h: BTN },
    ]);
  }

  private button(x: number, y: number, iconFrame: number, action: 'ok' | 'cancel'): Phaser.GameObjects.Container {
    const b = this.add.container(x, y);
    const bg = this.add.nineslice(0, 0, BUTTON, BUTTON_FRAME, BTN, BTN, 6, 6, 7, 7).setTint(OK_TINT);
    if (action === 'ok') this.okBg = bg; else this.cancelBg = bg;
    b.add(bg);
    if (this.textures.exists(ICONS)) {
      const icon = this.add.image(0, 0, ICONS, iconFrame);
      icon.setScale((BTN * 0.5) / Math.max(icon.width, icon.height));
      b.add(icon);
    }
    return b;
  }

  private close(): void {
    this.okBg = undefined; this.cancelBg = undefined; // dropped with the root container
    this.registry.set('confirmBounds', []);
    if (!this.shown) { this.root?.destroy(); this.root = undefined; return; }
    this.shown = false;
    const root = this.root;
    this.root = undefined;
    if (!root) return;
    this.tweens.add({ targets: root, alpha: 0, duration: 120, onComplete: () => root.destroy() });
  }
}
