import Phaser from 'phaser';
import { GAME_WIDTH, GAME_HEIGHT } from '../config';
import { fetchLeaderboard, LeaderboardEntry } from '../leaderboard';

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

    // --- Leaderboard panel (right side) ---
    this.createLeaderboardPanel();

    // --- START button ---
    this.createStartButton(GAME_WIDTH / 2, GAME_HEIGHT - 108);
  }

  private createLeaderboardPanel(): void {
    const px = 875, py = 88, pw = 375, ph = 516;
    const cx = px + pw / 2;

    // Panel background
    const panel = this.add.graphics().setDepth(2);
    panel.fillStyle(0x000820, 0.82);
    panel.lineStyle(1, 0x0055aa, 0.7);
    panel.fillRoundedRect(px, py, pw, ph, 10);
    panel.strokeRoundedRect(px, py, pw, ph, 10);

    // Header
    this.add.text(cx, py + 30, 'LEADERBOARD', {
      fontFamily: 'Orbitron', fontSize: '18px', color: '#00ccff',
      stroke: '#000000', strokeThickness: 2,
    }).setOrigin(0.5, 0.5).setDepth(3);

    // Divider
    const div = this.add.graphics().setDepth(3);
    div.lineStyle(1, 0x0055aa, 0.6);
    div.lineBetween(px + 16, py + 50, px + pw - 16, py + 50);

    // Loading placeholder rows
    const rows: Phaser.GameObjects.Text[] = [];
    for (let i = 0; i < 8; i++) {
      const ry = py + 68 + i * 54;
      // Rank number
      this.add.text(px + 22, ry, `${i + 1}`, {
        fontFamily: 'Orbitron', fontSize: '13px', color: '#556677',
        stroke: '#000', strokeThickness: 1,
      }).setOrigin(0, 0.5).setDepth(3);
      // Name + score placeholder
      const row = this.add.text(px + 50, ry, '—', {
        fontFamily: 'Orbitron', fontSize: '14px', color: '#334455',
      }).setOrigin(0, 0.5).setDepth(3);
      rows.push(row);
    }

    // Fetch and populate
    fetchLeaderboard(8).then((entries: LeaderboardEntry[]) => {
      if (!this.scene.isActive()) return;
      const rankColors = ['#ffd700', '#c0c0c0', '#cd7f32'];
      entries.forEach((e, i) => {
        if (i >= rows.length) return;
        const color = rankColors[i] ?? '#aabbcc';
        const scoreStr = e.score.toString().padStart(6, ' ');
        rows[i].setText(`${e.name.slice(0, 14).padEnd(14, ' ')}  ${scoreStr}`);
        rows[i].setColor(color);
        rows[i].setStyle({ fontFamily: 'Orbitron', fontSize: '14px', color });
      });
    });
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

    // Start BGM on first interaction (browser autoplay policy requires a user gesture)
    const startBgm = (): void => {
      if (!this.sound.get('bgm')?.isPlaying) {
        this.sound.play('bgm', { loop: true, volume: 0.5 });
      }
    };
    this.input.once('pointerdown', startBgm);
    this.input.keyboard?.once('keydown', startBgm);

    hitZone.on('pointerover', () => {
      drawBtn(true);
      this.tweens.add({ targets: label, scaleX: 1.08, scaleY: 1.08, duration: 100, ease: 'Quad.Out' });
    });
    hitZone.on('pointerout', () => {
      drawBtn(false);
      this.tweens.add({ targets: label, scaleX: 1, scaleY: 1, duration: 100, ease: 'Quad.Out' });
    });
    hitZone.on('pointerdown', () => {
      startBgm(); // ensure music started even if keyboard listener fired first
      // Flash the button, then launch the game
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
