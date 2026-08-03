import Phaser from 'phaser';

/**
 * Scripted-dialogue SPOTLIGHT overlay (native px). During a cutscene tutorial line
 * (`spotlight` node), GameScene publishes the target's screen rect to registry
 * `dialogueSpotlight` ({x,y,w,h} | null) and this draws a pulsing gold ring around
 * it (e.g. the hoe slot on the hotbar) so Cato can point while he explains.
 *
 * Deliberately NON-INTERACTIVE (no `setInteractive`, no full-screen dim) — the
 * cutscene advances by tapping ANYWHERE, and those taps must reach GameScene, so
 * this must never swallow input. A ring (not a dim-with-cutout) is also lighter and
 * won't fight the dialogue box.
 */
export class DialogueScene extends Phaser.Scene {
  private g!: Phaser.GameObjects.Graphics;
  private rect: { x: number; y: number; w: number; h: number } | null = null;
  private phase = 0;

  constructor() {
    super({ key: 'DialogueScene' });
  }

  create(): void {
    this.g = this.add.graphics().setDepth(1);
    const apply = (): void => {
      const v = this.registry.get('dialogueSpotlight') as { x: number; y: number; w: number; h: number } | null;
      this.rect = v ? { x: v.x, y: v.y, w: v.w, h: v.h } : null;
      if (!this.rect) this.g.clear();
    };
    this.registry.events.on('changedata-dialogueSpotlight', apply, this);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.registry.events.off('changedata-dialogueSpotlight', apply, this));
    apply();
  }

  update(): void {
    if (!this.rect) return;
    this.phase = (this.phase + 0.06) % (Math.PI * 2);
    const s = Math.sin(this.phase);
    const pad = 5 + 3 * s;
    const { x, y, w, h } = this.rect;
    this.g.clear();
    // Soft outer glow + a crisp gold ring, both breathing.
    this.g.lineStyle(7, 0xffe08a, 0.18 + 0.12 * s);
    this.g.strokeRoundedRect(x - pad - 3, y - pad - 3, w + (pad + 3) * 2, h + (pad + 3) * 2, 12);
    this.g.lineStyle(3, 0xffd24a, 0.7 + 0.3 * s);
    this.g.strokeRoundedRect(x - pad, y - pad, w + pad * 2, h + pad * 2, 9);
  }
}
