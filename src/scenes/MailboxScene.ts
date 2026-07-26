import Phaser from 'phaser';

// Modal shown when the player clicks the mailbox at the house door: the big open
// mailbox (`mail-box.png`) centred on a dim backdrop, popping in. GameScene owns
// the model (`mailbox` registry key) + plays the PLACED mailbox's open animation;
// this scene just renders the modal. Any tap closes it (GameScene routes that —
// no buttons, no search). Mail-item slots (mail-box-item-bg + envelope-zipper)
// are a follow-up once the layout's dialed in.
const MAILBOX = 'mail-box';

export interface MailboxModel {
  visible: boolean;
  rev: number;
}

export class MailboxScene extends Phaser.Scene {
  private lastRev = -1;
  private shown = false;
  private root?: Phaser.GameObjects.Container;

  constructor() {
    super({ key: 'MailboxScene' });
  }

  update(): void {
    const m = this.registry.get('mailbox') as MailboxModel | undefined;
    if (!m || m.rev === this.lastRev) return;
    this.lastRev = m.rev;
    if (m.visible) this.open();
    else this.close();
  }

  private open(): void {
    this.root?.destroy();
    this.tweens.killAll();
    this.shown = true;
    const W = this.scale.width, H = this.scale.height;

    const c = this.add.container(0, 0);
    this.root = c;

    // Dim modal backdrop (fades in).
    const dim = this.add.rectangle(0, 0, W, H, 0x000000, 0).setOrigin(0, 0);
    this.tweens.add({ targets: dim, alpha: 0.55, duration: 150 });
    c.add(dim);

    // The big open mailbox, centred + fit to ~92% of the screen (portrait art),
    // never upscaled past native. Pops in.
    if (this.textures.exists(MAILBOX)) {
      const img = this.add.image(W / 2, H / 2, MAILBOX);
      const fit = Math.min((H * 0.92) / img.height, (W * 0.92) / img.width, 1);
      img.setScale(fit * 0.85);
      c.add(img);
      this.tweens.add({ targets: img, scaleX: fit, scaleY: fit, duration: 190, ease: 'Back.easeOut' });
    }
  }

  private close(): void {
    if (!this.shown) { this.root?.destroy(); this.root = undefined; return; }
    this.shown = false;
    const root = this.root;
    this.root = undefined;
    if (!root) return;
    this.tweens.add({ targets: root, alpha: 0, duration: 130, onComplete: () => root.destroy() });
  }
}
