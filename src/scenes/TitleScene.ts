import Phaser from 'phaser';
import { GAME_WIDTH, GAME_HEIGHT } from '../config';

export class TitleScene extends Phaser.Scene {
  private sceneId!: string;

  constructor() {
    super({ key: 'TitleScene' });
  }

  init(data: { sceneId: string }): void {
    this.sceneId = data.sceneId;
  }

  create(): void {
    // --- Cover image (fit to canvas, centred) ---
    const cover = this.add.image(GAME_WIDTH / 2, GAME_HEIGHT / 2, 'star_siege_cover');
    const scaleX = GAME_WIDTH / cover.width;
    const scaleY = GAME_HEIGHT / cover.height;
    cover.setScale(Math.max(scaleX, scaleY)).setDepth(0);

    // --- Dark gradient overlay for legibility ---
    const overlay = this.add.graphics().setDepth(1);
    overlay.fillGradientStyle(0x000000, 0x000000, 0x000000, 0x000000, 0.15, 0.15, 0.75, 0.75);
    overlay.fillRect(0, 0, GAME_WIDTH, GAME_HEIGHT);

    // --- Bottom dark band to ground the UI ---
    const band = this.add.graphics().setDepth(1);
    band.fillStyle(0x000010, 0.65);
    band.fillRect(0, GAME_HEIGHT - 220, GAME_WIDTH, 220);

    // --- Title ---
    this.add
      .text(GAME_WIDTH / 2, GAME_HEIGHT / 2 - 60, 'STAR SIEGE', {
        fontFamily: 'Orbitron',
        fontSize: '72px',
        color: '#ffffff',
        stroke: '#0088ff',
        strokeThickness: 6,
        shadow: { offsetX: 0, offsetY: 0, color: '#0044cc', blur: 32, fill: true },
      })
      .setOrigin(0.5)
      .setDepth(2);

    // --- Slogan ---
    this.add
      .text(GAME_WIDTH / 2, GAME_HEIGHT / 2 + 20, 'Survive the siege. Rule the stars.', {
        fontFamily: 'Orbitron',
        fontSize: '22px',
        color: '#aaddff',
        stroke: '#000000',
        strokeThickness: 3,
      })
      .setOrigin(0.5)
      .setDepth(2);

    // --- START button ---
    this.createStartButton(GAME_WIDTH / 2, GAME_HEIGHT - 108);
  }

  private createStartButton(cx: number, cy: number): void {
    const BW = 280;
    const BH = 60;

    const bg = this.add.graphics().setDepth(3);
    const label = this.add
      .text(cx, cy, 'START', {
        fontFamily: 'Orbitron',
        fontSize: '28px',
        color: '#ffffff',
        stroke: '#000000',
        strokeThickness: 2,
      })
      .setOrigin(0.5)
      .setDepth(4);

    const hitZone = this.add
      .zone(cx, cy, BW, BH)
      .setInteractive({ useHandCursor: true })
      .setDepth(5);

    const drawBtn = (hover: boolean): void => {
      bg.clear();
      if (hover) {
        bg.fillStyle(0x0066ff, 1);
        bg.fillRoundedRect(cx - BW / 2, cy - BH / 2, BW, BH, 10);
        bg.lineStyle(2, 0x88ccff, 1);
        bg.strokeRoundedRect(cx - BW / 2, cy - BH / 2, BW, BH, 10);
        label.setColor('#ffffff');
      } else {
        bg.fillStyle(0x003399, 1);
        bg.fillRoundedRect(cx - BW / 2, cy - BH / 2, BW, BH, 10);
        bg.lineStyle(2, 0x4488cc, 1);
        bg.strokeRoundedRect(cx - BW / 2, cy - BH / 2, BW, BH, 10);
        label.setColor('#aaddff');
      }
    };

    drawBtn(false);

    hitZone.on('pointerover', () => {
      drawBtn(true);
      this.tweens.add({ targets: label, scaleX: 1.08, scaleY: 1.08, duration: 100, ease: 'Quad.Out' });
    });
    hitZone.on('pointerout', () => {
      drawBtn(false);
      this.tweens.add({ targets: label, scaleX: 1, scaleY: 1, duration: 100, ease: 'Quad.Out' });
    });
    hitZone.on('pointerdown', () => {
      // Flash the button white, then launch the game
      this.tweens.add({
        targets: label,
        alpha: 0.3,
        duration: 60,
        yoyo: true,
        onComplete: () => {
          this.cameras.main.fadeOut(350, 0, 0, 20);
          this.cameras.main.once('camerafadeoutcomplete', () => {
            this.scene.start('GameScene', { sceneId: this.sceneId });
          });
        },
      });
    });

    // Entry fade-in
    this.cameras.main.fadeIn(500, 0, 0, 0);
  }
}
