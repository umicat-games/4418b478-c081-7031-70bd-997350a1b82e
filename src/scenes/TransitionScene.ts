import Phaser from 'phaser';
import { fadeBgmTo } from '../bgm';

export type TransitionEffect = 'circle' | 'slide' | 'dissolve' | 'paw';

const DEF_MS = 420;
const DEF_COLOR = 0xffffff; // white curtain (per-call `color` can override)
const HOLE_BASE = 100;      // unit circle radius, scaled for the iris wipe
// Paw-print iris (Catopia's signature wipe): the mask hole is a paw (pad + 4 toe beans)
// drawn at unit size around the pad centre, then scaled like the circle. PAW_CORE = the
// guaranteed-solid radius around the origin — a bit under the pad's short axis so scaling
// to `maxRadius / PAW_CORE` guarantees the pad covers the screen corners (toes/gaps land
// off-screen at full cover). Kept conservative so no curtain sliver shows fully-open.
const PAW_CORE = 40;

/** Draw a paw (pad + 4 toe beans) into `g` at unit size, origin ≈ the pad centre. */
function drawPaw(g: Phaser.GameObjects.Graphics): void {
  g.clear();
  g.fillStyle(0xffffff, 1);
  g.fillEllipse(0, 10, 122, 106);   // main pad (rx61 ry53), just below the origin
  g.fillEllipse(-31, -60, 48, 56);  // inner toe beans
  g.fillEllipse(31, -60, 48, 56);
  g.fillEllipse(-70, -16, 44, 52);  // outer toe beans
  g.fillEllipse(70, -16, 44, 52);
}

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
  private holeG!: Phaser.GameObjects.Graphics; // circle iris mask stencil (not on the display list)
  private mask!: Phaser.Display.Masks.GeometryMask;
  private pawG!: Phaser.GameObjects.Graphics;   // paw iris mask stencil
  private pawMask!: Phaser.Display.Masks.GeometryMask;
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
    this.pawG = this.make.graphics({});
    drawPaw(this.pawG);
    this.pawMask = this.pawG.createGeometryMask();
    this.pawMask.invertAlpha = true;
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

  /** The stencil + mask + unit-radius for the active iris effect (circle or paw). */
  private iris(): { g: Phaser.GameObjects.Graphics; mask: Phaser.Display.Masks.GeometryMask; unit: number } {
    return this.effect === 'paw'
      ? { g: this.pawG, mask: this.pawMask, unit: PAW_CORE }
      : { g: this.holeG, mask: this.mask, unit: HOLE_BASE };
  }

  /**
   * TWO-PHASE iris scale so the shape is clearly VISIBLE (a plain easeOut just dwells on
   * a tiny dot near 0). The paw/circle spends most of the time at the readable size and
   * only a short burst on the huge, off-screen part:
   *  - cover  : big → readable (fast) → 0 (slow, watch it close)
   *  - reveal : 0 → readable (slow, watch it open) → big (fast flood)
   * `readS` = the scale at which the whole paw sits nicely on screen.
   */
  private irisScale(cover: boolean, onDone: () => void): void {
    const W = this.scale.width, H = this.scale.height;
    const fx = this.focus?.x ?? W / 2, fy = this.focus?.y ?? H / 2;
    const { g, mask, unit } = this.iris();
    g.setPosition(fx, fy).setRotation(0);
    this.curtain.setMask(mask);
    const bigS = this.maxRadius(fx, fy) / unit;
    const readS = Math.min(3, bigS * 0.6);
    const t = this.ms;
    g.setScale(cover ? bigS : 0);
    this.tweens.chain({
      targets: g,
      onComplete: onDone,
      tweens: cover
        ? [ { scale: readS, duration: t * 0.24, ease: 'Sine.easeOut' },  // snap the huge, off-screen part in (no dead time at full size)
            { scale: 0,     duration: t * 0.76, ease: 'Sine.easeInOut' } ] // then slowly close the visible paw (the lingering beat)
        : [ { scale: readS, duration: t * 0.76, ease: 'Sine.easeInOut' }, // slowly open the visible paw
            { scale: bigS,  duration: t * 0.24, ease: 'Sine.easeIn' } ],   // then flood the rest out fast
    });
  }

  /** The `effect`-specific cover tween (curtain already set up). */
  private animateCover(onComplete: () => void): void {
    const W = this.scale.width, H = this.scale.height;
    if (this.effect === 'circle' || this.effect === 'paw') {
      this.irisScale(true, onComplete);
    } else if (this.effect === 'slide') {
      this.tweens.add({ targets: this.curtain, x: { from: -W, to: 0 }, duration: this.ms, ease: 'Cubic.easeInOut', onComplete });
    } else {
      this.tweens.add({ targets: this.curtain, alpha: { from: 0, to: 1 }, duration: this.ms, ease: 'Sine.easeInOut', onComplete });
    }
  }

  /** True while a transition is covering/covered (before the reveal completes). */
  isBusy(): boolean { return this.busy; }

  /** The incoming scene is ready — uncover (reverse the effect), idempotent.
   *  `onRevealed` (optional) fires once the reveal fully completes. */
  done(onRevealed?: () => void): void {
    if (!this.busy) return;
    this.safety?.remove(); this.safety = undefined;
    const W = this.scale.width, H = this.scale.height;
    const finish = (): void => { this.busy = false; this.curtain.setVisible(false).clearMask(); onRevealed?.(); };

    if (this.effect === 'circle' || this.effect === 'paw') {
      this.irisScale(false, finish);
    } else if (this.effect === 'slide') {
      this.tweens.add({ targets: this.curtain, x: { from: 0, to: W }, duration: this.ms, ease: 'Cubic.easeInOut', onComplete: finish });
    } else {
      this.tweens.add({ targets: this.curtain, alpha: { from: 1, to: 0 }, duration: this.ms, ease: 'Sine.easeInOut', onComplete: finish });
    }
  }
}
