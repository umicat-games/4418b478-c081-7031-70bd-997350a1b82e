import Phaser from 'phaser';
import { GAME_WIDTH, GAME_HEIGHT } from '../config';
import { umicatReady } from '../main';

/**
 * Overlay scene launched on top of a paused GameScene. Resume / Restart /
 * Quit-to-Umicat. Runs as its own scene (rather than UI drawn inside
 * GameScene) because a paused scene stops processing its own input.
 */
export class PauseScene extends Phaser.Scene {
  private gameSceneKey!: string;
  private sceneId!: string;

  constructor() {
    super({ key: 'PauseScene' });
  }

  init(data: { gameSceneKey: string; sceneId: string }): void {
    this.gameSceneKey = data.gameSceneKey;
    this.sceneId = data.sceneId;
  }

  create(): void {
    const cx = GAME_WIDTH / 2;
    const cy = GAME_HEIGHT / 2;

    // Dim overlay
    const overlay = this.add.rectangle(cx, cy, GAME_WIDTH, GAME_HEIGHT, 0x000000, 0).setDepth(1000);
    this.tweens.add({ targets: overlay, fillAlpha: 0.78, duration: 220 });

    // Panel
    const PW = 380, PH = 380;
    const panel = this.add.graphics().setDepth(1001).setAlpha(0);
    panel.fillStyle(0x060618, 0.97);
    panel.lineStyle(2, 0x00ccff, 0.85);
    panel.fillRoundedRect(cx - PW / 2, cy - PH / 2, PW, PH, 14);
    panel.strokeRoundedRect(cx - PW / 2, cy - PH / 2, PW, PH, 14);
    this.tweens.add({ targets: panel, alpha: 1, duration: 260 });

    // Title
    const title = this.add.text(cx, cy - PH / 2 + 56, 'PAUSED', {
      fontFamily: 'Orbitron', fontSize: '36px', color: '#00ffcc',
      stroke: '#000000', strokeThickness: 4,
    }).setOrigin(0.5).setDepth(1002).setAlpha(0);
    this.tweens.add({ targets: title, alpha: 1, delay: 100, duration: 220 });

    // Buttons
    this.createButton(cx, cy - 16, 'RESUME', 0x00aacc, 0x00ccee, () => this.resume());
    this.createButton(cx, cy + 58, 'RESTART', 0x994400, 0xcc6600, () => this.restart());

    // Quit — only offered when the host actually has somewhere to send the
    // player back to (hidden entirely when running standalone).
    umicatReady.then((umicat) => {
      if (umicat?.platform?.canExit) {
        this.createButton(cx, cy + 132, 'QUIT TO UMICAT', 0x661111, 0xaa2222, () => this.quit());
      }
    });

    // ESC resumes, matching how it was opened.
    const escKey = this.input.keyboard?.addKey(Phaser.Input.Keyboard.KeyCodes.ESC);
    escKey?.once('down', () => this.resume());

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => escKey?.destroy());
  }

  // ── Button helper ─────────────────────────────────────────────────────────

  private createButton(
    cx: number, cy: number, label: string,
    colOff: number, colOn: number, onClick: () => void,
  ): void {
    const BW = 280, BH = 54;

    const bg = this.add.graphics().setDepth(1002).setAlpha(0);
    const text = this.add.text(cx, cy, label, {
      fontFamily: 'Orbitron', fontSize: '19px', color: '#ffffff',
      stroke: '#000000', strokeThickness: 2,
    }).setOrigin(0.5).setDepth(1003).setAlpha(0);

    const hitZone = this.add.zone(cx, cy, BW, BH)
      .setInteractive({ useHandCursor: true })
      .setDepth(1004);

    const draw = (hover: boolean): void => {
      bg.clear();
      bg.fillStyle(hover ? colOn : colOff, 1);
      bg.fillRoundedRect(cx - BW / 2, cy - BH / 2, BW, BH, 10);
      bg.lineStyle(2, 0x00eeff, hover ? 1 : 0.6);
      bg.strokeRoundedRect(cx - BW / 2, cy - BH / 2, BW, BH, 10);
    };
    draw(false);

    this.tweens.add({ targets: [bg, text], alpha: 1, delay: 160, duration: 220 });

    hitZone.on('pointerover', () => {
      draw(true);
      this.tweens.add({ targets: text, scaleX: 1.05, scaleY: 1.05, duration: 100 });
    });
    hitZone.on('pointerout', () => {
      draw(false);
      this.tweens.add({ targets: text, scaleX: 1, scaleY: 1, duration: 100 });
    });
    hitZone.on('pointerdown', () => {
      this.tweens.add({
        targets: text, alpha: 0.4, duration: 60, yoyo: true,
        onComplete: onClick,
      });
    });
  }

  // ── Actions ────────────────────────────────────────────────────────────────

  private resume(): void {
    this.scene.resume(this.gameSceneKey);
    this.scene.stop();
  }

  private restart(): void {
    this.scene.stop(this.gameSceneKey);
    this.scene.stop();
    this.scene.start(this.gameSceneKey, { sceneId: this.sceneId });
  }

  private quit(): void {
    umicatReady.then((umicat) => umicat?.platform?.exit());
  }
}
