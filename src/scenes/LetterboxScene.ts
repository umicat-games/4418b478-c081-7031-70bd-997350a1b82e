import Phaser from 'phaser';

/**
 * Cinematic letterbox — two black bars that slide in from the top and bottom of the
 * screen (movie "crop"), used to frame a scripted cutscene (the new-game intro). A
 * screen-fixed overlay scene at native resolution (unzoomed / unscrolled by the world
 * camera), like CursorScene. Driven by GameScene: `show()` on a cutscene start,
 * `hide()` when it ends. Reusable for any future cutscene.
 *
 * Each bar is a full-height rectangle anchored to its screen edge and revealed via
 * `scaleY` (0 = hidden → 1 = fully in): the top grows DOWN from y=0, the bottom grows
 * UP from y=H. scaleY is a Transform prop, so it tweens reliably (unlike a Shape's
 * geometry height).
 */
const BAR_FRAC = 0.11; // each bar = this fraction of the screen height when fully in

export class LetterboxScene extends Phaser.Scene {
  private top!: Phaser.GameObjects.Rectangle;
  private bottom!: Phaser.GameObjects.Rectangle;
  private shown = false;

  constructor() { super({ key: 'LetterboxScene' }); }

  create(): void {
    const W = this.scale.width, H = this.scale.height, h = H * BAR_FRAC;
    this.top = this.add.rectangle(0, 0, W, h, 0x000000, 1).setOrigin(0, 0).setDepth(10).setScale(1, 0);
    this.bottom = this.add.rectangle(0, H, W, h, 0x000000, 1).setOrigin(0, 1).setDepth(10).setScale(1, 0);
    this.scale.on(Phaser.Scale.Events.RESIZE, this.onResize, this);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.scale.off(Phaser.Scale.Events.RESIZE, this.onResize, this));
  }

  private onResize = (): void => {
    const W = this.scale.width, H = this.scale.height, h = H * BAR_FRAC;
    this.top.setSize(W, h).setPosition(0, 0);
    this.bottom.setSize(W, h).setPosition(0, H);
  };

  /** Slide the bars IN over `ms`. */
  show(ms = 500): void {
    this.shown = true;
    this.tweens.killTweensOf([this.top, this.bottom]);
    this.tweens.add({ targets: [this.top, this.bottom], scaleY: 1, duration: ms, ease: 'Cubic.easeInOut' });
  }

  /** Slide the bars OUT (retract to nothing) over `ms`. */
  hide(ms = 600): void {
    this.shown = false;
    this.tweens.killTweensOf([this.top, this.bottom]);
    this.tweens.add({ targets: [this.top, this.bottom], scaleY: 0, duration: ms, ease: 'Cubic.easeInOut' });
  }
}
