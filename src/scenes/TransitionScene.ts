import Phaser from 'phaser';
import { fadeBgmTo } from '../bgm';

export type TransitionEffect = 'circle' | 'slide' | 'dissolve';

const DEF_MS = 420;
const DEF_COLOR = 0xffffff; // white curtain (per-call `color` can override)
const HOLE_BASE = 100;      // unit circle radius, scaled for the iris wipe

interface BeginOpts {
  effect?: TransitionEffect;
  color?: number;
  ms?: number;
  focus?: { x: number; y: number }; // circle-iris centre (default screen centre)
  onCovered?: () => void;           // run at full cover, BEFORE the scene switch
}

/**
 * Full-screen scene-switch transition overlay — a circle iris, a slide, or a
 * dissolve. Always rendered ON TOP (brought to top per transition). Driven by
 * `src/transition.ts`: the OUTGOING scene calls `startTransition` (→ `begin`),
 * which covers the screen, switches scenes underneath, then waits for the INCOMING
 * scene's `finishTransition` (→ `done`) — or an 8s safety — to uncover.
 */
export class TransitionScene extends Phaser.Scene {
  private curtain!: Phaser.GameObjects.Rectangle;
  private holeG!: Phaser.GameObjects.Graphics; // iris mask stencil (not on the display list)
  private mask!: Phaser.Display.Masks.GeometryMask;
  private busy = false;
  private effect: TransitionEffect = 'dissolve';
  private ms = DEF_MS;
  private focus?: { x: number; y: number };
  private safety?: Phaser.Time.TimerEvent;

  constructor() { super({ key: 'TransitionScene' }); }

  create(): void {
    const W = this.scale.width, H = this.scale.height;
    this.curtain = this.add.rectangle(0, 0, W, H, DEF_COLOR, 1).setOrigin(0, 0).setDepth(10).setVisible(false);
    this.holeG = this.make.graphics({}); // add:false → used only as a mask stencil
    this.holeG.fillStyle(0xffffff, 1).fillCircle(0, 0, HOLE_BASE);
    this.mask = this.holeG.createGeometryMask();
    this.mask.invertAlpha = true; // curtain shows OUTSIDE the hole (so a shrinking hole covers)
    this.scale.on(Phaser.Scale.Events.RESIZE, this.onResize, this);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.scale.off(Phaser.Scale.Events.RESIZE, this.onResize, this));
  }

  private onResize = (): void => { this.curtain.setSize(this.scale.width, this.scale.height); };

  private maxRadius(fx: number, fy: number): number {
    const W = this.scale.width, H = this.scale.height;
    return Math.hypot(Math.max(fx, W - fx), Math.max(fy, H - fy)) + 4;
  }

  /** Cover with `effect`, run `onCovered` + switch to `toKey`, then await `done()`. */
  begin(from: Phaser.Scene, toKey: string, data: object, opts: BeginOpts): void {
    if (this.busy) return;
    this.busy = true;
    this.effect = opts.effect ?? 'dissolve';
    this.ms = opts.ms ?? DEF_MS;
    this.focus = opts.focus;
    const W = this.scale.width, H = this.scale.height;
    this.scene.bringToTop();
    this.curtain.clearMask();
    this.curtain.setFillStyle(opts.color ?? DEF_COLOR, 1).setSize(W, H).setPosition(0, 0).setAlpha(1).setVisible(true);
    // Duck the outgoing music to silence as the screen covers (this scene persists,
    // so the fade survives the switch). The new scene's crossToBgm swells its track in.
    fadeBgmTo(this, 0, this.ms);

    this.animateCover(() => {
      opts.onCovered?.();
      from.scene.start(toKey, data);
      this.safety = this.time.delayedCall(8000, () => this.done()); // backstop if the scene never calls finish
    });
  }

  /** Cover the screen with `effect`, then run `onCovered` — and STOP (no scene
   *  switch / no reveal). For a caller that hard-reloads or navigates away
   *  (return-to-title reloads to guarantee a clean slate). */
  coverAndHold(effect: TransitionEffect, onCovered: () => void, opts: { color?: number; ms?: number } = {}): void {
    if (this.busy) return;
    this.busy = true;
    this.effect = effect;
    this.ms = opts.ms ?? DEF_MS;
    this.focus = undefined;
    const W = this.scale.width, H = this.scale.height;
    this.scene.bringToTop();
    this.curtain.clearMask();
    this.curtain.setFillStyle(opts.color ?? DEF_COLOR, 1).setSize(W, H).setPosition(0, 0).setAlpha(1).setVisible(true);
    fadeBgmTo(this, 0, this.ms);
    this.animateCover(onCovered);
  }

  /** The `effect`-specific cover tween (curtain already set up). */
  private animateCover(onComplete: () => void): void {
    const W = this.scale.width, H = this.scale.height;
    if (this.effect === 'circle') {
      const fx = this.focus?.x ?? W / 2, fy = this.focus?.y ?? H / 2;
      this.holeG.setPosition(fx, fy);
      this.curtain.setMask(this.mask);
      this.tweens.add({ targets: this.holeG, scale: { from: this.maxRadius(fx, fy) / HOLE_BASE, to: 0 }, duration: this.ms, ease: 'Sine.easeIn', onComplete });
    } else if (this.effect === 'slide') {
      this.tweens.add({ targets: this.curtain, x: { from: -W, to: 0 }, duration: this.ms, ease: 'Cubic.easeInOut', onComplete });
    } else {
      this.tweens.add({ targets: this.curtain, alpha: { from: 0, to: 1 }, duration: this.ms, ease: 'Sine.easeInOut', onComplete });
    }
  }

  /** The incoming scene is ready — uncover (reverse the effect), idempotent. */
  done(): void {
    if (!this.busy) return;
    this.safety?.remove(); this.safety = undefined;
    const W = this.scale.width, H = this.scale.height;
    const finish = (): void => { this.busy = false; this.curtain.setVisible(false).clearMask(); };

    if (this.effect === 'circle') {
      const fx = this.focus?.x ?? W / 2, fy = this.focus?.y ?? H / 2;
      this.holeG.setPosition(fx, fy);
      this.curtain.setMask(this.mask);
      this.tweens.add({ targets: this.holeG, scale: { from: 0, to: this.maxRadius(fx, fy) / HOLE_BASE }, duration: this.ms, ease: 'Sine.easeOut', onComplete: finish });
    } else if (this.effect === 'slide') {
      this.tweens.add({ targets: this.curtain, x: { from: 0, to: W }, duration: this.ms, ease: 'Cubic.easeInOut', onComplete: finish });
    } else {
      this.tweens.add({ targets: this.curtain, alpha: { from: 1, to: 0 }, duration: this.ms, ease: 'Sine.easeInOut', onComplete: finish });
    }
  }
}
