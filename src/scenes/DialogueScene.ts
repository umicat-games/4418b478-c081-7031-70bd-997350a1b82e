import Phaser from 'phaser';
import { hudDpr } from '../dpi';

/**
 * Scripted-dialogue SPOTLIGHT overlay (native px). During a cutscene tutorial line
 * (`spotlight` node), GameScene publishes the target's screen rect to registry
 * `dialogueSpotlight` ({x,y,w,h} | null) and this draws a pulsing gold ring around
 * it (e.g. the hoe slot on the hotbar) so Cato can point while he explains.
 *
 * Deliberately NON-INTERACTIVE (no `setInteractive`) — the cutscene advances by
 * tapping ANYWHERE, and those taps must reach GameScene (whose `tutorialTapAllowed`
 * gate is the real input restriction), so this never swallows input.
 *
 * When the published model has `dim:true` (the "tap THIS button/icon" tutorial steps),
 * a semi-transparent dark overlay covers the whole screen with a rounded-rect HOLE
 * punched at the spotlight target (via an inverted geometry mask — same technique as
 * TransitionScene's iris), so the player sees exactly one lit spot to tap. The
 * wheel/till/water steps publish `dim:false` and get the ring only (a static hole
 * would dim the tool wheel that pops up around the target).
 */
export class DialogueScene extends Phaser.Scene {
  private g!: Phaser.GameObjects.Graphics;
  private dim!: Phaser.GameObjects.Graphics;       // full-screen dark overlay
  private hole!: Phaser.GameObjects.Graphics;      // off-list stencil that punches the hole
  private rect: { x: number; y: number; w: number; h: number } | null = null;
  private dimOn = false;
  private phase = 0;

  constructor() {
    super({ key: 'DialogueScene' });
  }

  create(): void {
    // Dim overlay UNDER the ring; its hole is cut by an inverted geometry mask.
    this.dim = this.add.graphics().setDepth(0);
    this.hole = this.make.graphics({}, false); // NOT on the display list — it only feeds the mask
    const mask = this.hole.createGeometryMask();
    mask.invertAlpha = true; // dim shows everywhere EXCEPT where the stencil is drawn (= the hole)
    this.dim.setMask(mask);
    this.g = this.add.graphics().setDepth(1);
    const apply = (): void => {
      const v = this.registry.get('dialogueSpotlight') as { x: number; y: number; w: number; h: number; dim?: boolean } | null;
      this.rect = v ? { x: v.x, y: v.y, w: v.w, h: v.h } : null;
      this.dimOn = !!v?.dim;
      if (!this.rect) { this.g.clear(); this.dim.clear(); }
    };
    this.registry.events.on('changedata-dialogueSpotlight', apply, this);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.registry.events.off('changedata-dialogueSpotlight', apply, this));
    apply();
  }

  update(): void {
    if (!this.rect) return;
    this.phase = (this.phase + 0.06) % (Math.PI * 2);
    const s = Math.sin(this.phase);
    // The spotlight rect is DEVICE-px (projected from device-px hotbar bounds), and this scene
    // draws at zoom 1 — so scale the ring's fixed screen-px widths/pad/radii ×dpr to keep the
    // same apparent thickness/gap on retina (dpr is 1 when not highDpi).
    const dpr = hudDpr(this);
    const pad = (5 + 3 * s) * dpr;
    const { x, y, w, h } = this.rect;

    // Dim-with-cutout: dark everywhere, a breathing rounded hole over the target.
    this.dim.clear();
    if (this.dimOn) {
      this.dim.fillStyle(0x000000, 0.55).fillRect(0, 0, this.scale.width, this.scale.height);
      const hp = pad + 4 * dpr; // hole a touch wider than the ring so the ring sits inside the lit area
      this.hole.clear();
      this.hole.fillStyle(0xffffff, 1).fillRoundedRect(x - hp, y - hp, w + hp * 2, h + hp * 2, 12 * dpr);
    }

    this.g.clear();
    // Soft outer glow + a crisp gold ring, both breathing.
    this.g.lineStyle(7 * dpr, 0xffe08a, 0.18 + 0.12 * s);
    this.g.strokeRoundedRect(x - pad - 3 * dpr, y - pad - 3 * dpr, w + (pad + 3 * dpr) * 2, h + (pad + 3 * dpr) * 2, 12 * dpr);
    this.g.lineStyle(3 * dpr, 0xffd24a, 0.7 + 0.3 * s);
    this.g.strokeRoundedRect(x - pad, y - pad, w + pad * 2, h + pad * 2, 9 * dpr);
  }
}
