import Phaser from 'phaser';
import { WP_FILL, buildIconPattern, driftIconLayer } from './iconWallpaper';
import { t } from './i18n';

/**
 * The game's LOADING screen — the cozy cream + drifting-icon wallpaper (shared with the
 * laptop cold-open) with an animated "Loading" text in the centre. Opaque, above
 * everything (depth 1e7, scroll-fixed), so it hides the not-yet-ready world; the paw wipe
 * reveals THIS, and it fades out to the game once the save + world are restored.
 */
const TEXT_COLOR = '#7c5a38'; // dark brown — reads on the cream wallpaper
const DEPTH = 1e7;
const TEXT_DELAY_MS = 800; // only show the "Loading" text if the load is actually this slow

export class LoadingOverlay {
  private scene: Phaser.Scene;
  private root: Phaser.GameObjects.Container;
  private layer: Phaser.GameObjects.Container; // drifting icons
  private label: Phaser.GameObjects.Text;
  private base: string;
  private period = 100;
  private w = 0; private h = 0;
  private dots = 0;
  private dotTimer?: Phaser.Time.TimerEvent;
  private breathe?: Phaser.Tweens.Tween;
  private revealTimer?: Phaser.Time.TimerEvent;

  constructor(scene: Phaser.Scene) {
    this.scene = scene;
    // Oversized cream rect (covers any canvas size, no reflow) + the drifting icon layer.
    const rect = scene.add.rectangle(-2000, -2000, 8000, 8000, WP_FILL, 1).setOrigin(0, 0);
    this.layer = scene.add.container(0, 0);
    this.base = t('loading');
    // Text starts HIDDEN — entering the game is usually fast (world already cached), and a
    // big "Loading" flashing for a frame mid-transition looks bad. Only reveal it if the
    // load is genuinely slow (TEXT_DELAY_MS); a quick enter fades out before it ever shows.
    this.label = scene.add.text(0, 0, this.base, { fontFamily: 'zpix, sans-serif', color: TEXT_COLOR }).setOrigin(0.5).setAlpha(0);
    this.root = scene.add.container(0, 0, [rect, this.layer, this.label]).setScrollFactor(0).setDepth(DEPTH);

    this.layout();
    scene.scale.on(Phaser.Scale.Events.RESIZE, this.layout, this);

    // Trailing dots cycle (harmless while hidden).
    this.dotTimer = scene.time.addEvent({
      delay: 340, loop: true,
      callback: () => { this.dots = (this.dots + 1) % 4; this.label.setText(this.base + '.'.repeat(this.dots)); },
    });
    // Reveal the text only on a slow load: fade it in, then a gentle alpha "breathe".
    this.revealTimer = scene.time.delayedCall(TEXT_DELAY_MS, () => {
      scene.tweens.add({
        targets: this.label, alpha: 1, duration: 220, ease: 'Sine.easeOut',
        onComplete: () => {
          this.breathe = scene.tweens.add({ targets: this.label, alpha: 0.55, duration: 720, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
        },
      });
    });
  }

  private layout = (): void => {
    const W = this.scene.scale.width, H = this.scene.scale.height;
    if (W !== this.w || H !== this.h) { this.w = W; this.h = H; this.period = buildIconPattern(this.scene, this.layer, W, H); }
    this.label.setPosition(W / 2, H / 2).setFontSize(Math.max(20, Math.round(Math.min(W, H) * 0.05)));
  };

  /** Drift the icon wallpaper — call each frame from the host scene's update(). */
  update(delta: number): void {
    driftIconLayer(this.layer, delta, this.period);
  }

  /** Fade the whole screen out (game is ready), then destroy. */
  fadeOut(onDone?: () => void): void {
    this.dotTimer?.remove();
    this.revealTimer?.remove(); // if the load was fast, the text never appears
    this.breathe?.remove();
    this.scene.scale.off(Phaser.Scale.Events.RESIZE, this.layout, this);
    this.scene.tweens.add({
      targets: this.root, alpha: 0, duration: 300,
      onComplete: () => { this.root.destroy(); onDone?.(); },
    });
  }
}
