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
    this.createStartButton(GAME_WIDTH / 2, GAME_HEIGHT - 148);

    // --- LEADERBOARD button ---
    this.createLeaderboardButton(GAME_WIDTH / 2, GAME_HEIGHT - 74);
  }

  // ── START button ────────────────────────────────────────────────────────────

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
      this.sound.play('hover', { volume: 0.5 });
    });
    hitZone.on('pointerout', () => {
      drawBtn(false);
      this.tweens.add({ targets: label, scaleX: 1, scaleY: 1, duration: 100, ease: 'Quad.Out' });
    });
    hitZone.on('pointerdown', () => {
      startBgm();
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

  // ── LEADERBOARD button + modal ───────────────────────────────────────────────

  private createLeaderboardButton(cx: number, cy: number): void {
    const BW = 220;
    const BH = 44;

    const bg = this.add.graphics().setDepth(3);
    const label = this.add
      .text(cx, cy, '🏆  LEADERBOARD', {
        fontFamily: 'Orbitron',
        fontSize: '17px',
        color: '#ffdd44',
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
      bg.fillStyle(hover ? 0x443300 : 0x221a00, hover ? 0.95 : 0.85);
      bg.fillRoundedRect(cx - BW / 2, cy - BH / 2, BW, BH, 8);
      bg.lineStyle(1, hover ? 0xffdd44 : 0x887722, 1);
      bg.strokeRoundedRect(cx - BW / 2, cy - BH / 2, BW, BH, 8);
    };

    drawBtn(false);

    hitZone.on('pointerover', () => { drawBtn(true); this.sound.play('hover', { volume: 0.5 }); });
    hitZone.on('pointerout',  () => drawBtn(false));
    hitZone.on('pointerdown', () => {
      this.tweens.add({
        targets: label, alpha: 0.4, duration: 55, yoyo: true,
        onComplete: () => this.showLeaderboardModal(),
      });
    });
  }

  private showLeaderboardModal(): void {
    const cx = GAME_WIDTH / 2;
    const cy = GAME_HEIGHT / 2;
    const PW = 520, PH = 580;

    // ── Container so we can destroy everything at once ──
    const container = this.add.container(0, 0).setDepth(100);

    // Dim overlay (click outside to close)
    const dimmer = this.add.rectangle(cx, cy, GAME_WIDTH, GAME_HEIGHT, 0x000000, 0)
      .setDepth(100).setInteractive();
    container.add(dimmer);
    this.tweens.add({ targets: dimmer, fillAlpha: 0.78, duration: 240 });

    // Panel
    const panel = this.add.graphics().setDepth(101);
    panel.fillStyle(0x060618, 0.97);
    panel.lineStyle(2, 0x00ccff, 0.9);
    panel.fillRoundedRect(cx - PW / 2, cy - PH / 2, PW, PH, 14);
    panel.strokeRoundedRect(cx - PW / 2, cy - PH / 2, PW, PH, 14);
    panel.setAlpha(0);
    container.add(panel);
    this.tweens.add({ targets: panel, alpha: 1, duration: 220 });

    // Header
    const header = this.add.text(cx, cy - PH / 2 + 38, '🏆  LEADERBOARD', {
      fontFamily: 'Orbitron', fontSize: '26px', color: '#ffdd44',
      stroke: '#000', strokeThickness: 3,
    }).setOrigin(0.5).setDepth(102).setAlpha(0);
    container.add(header);
    this.tweens.add({ targets: header, alpha: 1, delay: 100, duration: 200 });

    // Divider
    const div = this.add.graphics().setDepth(102).setAlpha(0);
    div.lineStyle(1, 0x00ccff, 0.4);
    div.lineBetween(cx - PW / 2 + 24, cy - PH / 2 + 72, cx + PW / 2 - 24, cy - PH / 2 + 72);
    container.add(div);
    this.tweens.add({ targets: div, alpha: 1, delay: 120, duration: 180 });

    // Column labels
    const colLabel = this.add.text(cx - PW / 2 + 28, cy - PH / 2 + 90, '#    PLAYER                   SCORE', {
      fontFamily: 'Orbitron', fontSize: '11px', color: '#446688',
    }).setDepth(102).setAlpha(0);
    container.add(colLabel);
    this.tweens.add({ targets: colLabel, alpha: 1, delay: 140, duration: 180 });

    // Row placeholders
    const rankColors = ['#ffd700', '#c0c0c0', '#cd7f32', '#aabbcc', '#8899aa',
                        '#7788aa', '#6677aa', '#5566aa', '#445588', '#334477'];
    const rowObjs: Array<{ rank: Phaser.GameObjects.Text; name: Phaser.GameObjects.Text; score: Phaser.GameObjects.Text }> = [];

    for (let i = 0; i < 10; i++) {
      const ry = cy - PH / 2 + 120 + i * 40;
      const color = rankColors[i];

      // Row background (subtle alternating)
      if (i % 2 === 0) {
        const rowBg = this.add.rectangle(cx, ry, PW - 24, 34, 0xffffff, 0.03).setDepth(101);
        container.add(rowBg);
      }

      const rankTxt = this.add.text(cx - PW / 2 + 28, ry, `${i + 1}`, {
        fontFamily: 'Orbitron', fontSize: '14px', color,
        stroke: '#000', strokeThickness: 1,
      }).setOrigin(0, 0.5).setDepth(102).setAlpha(0);

      const nameTxt = this.add.text(cx - PW / 2 + 68, ry, '—', {
        fontFamily: 'Orbitron', fontSize: '14px', color: '#334455',
      }).setOrigin(0, 0.5).setDepth(102).setAlpha(0);

      const scoreTxt = this.add.text(cx + PW / 2 - 28, ry, '', {
        fontFamily: 'Orbitron', fontSize: '14px', color: '#334455',
      }).setOrigin(1, 0.5).setDepth(102).setAlpha(0);

      container.add([rankTxt, nameTxt, scoreTxt]);
      rowObjs.push({ rank: rankTxt, name: nameTxt, score: scoreTxt });
    }

    // Fetch and populate rows
    fetchLeaderboard(10).then((entries: LeaderboardEntry[]) => {
      if (!this.scene.isActive('TitleScene')) return;
      entries.forEach((e, i) => {
        if (i >= rowObjs.length) return;
        const color = rankColors[i];
        rowObjs[i].name.setText(e.name.slice(0, 22));
        rowObjs[i].name.setStyle({ fontFamily: 'Orbitron', fontSize: '14px', color });
        rowObjs[i].score.setText(e.score.toLocaleString());
        rowObjs[i].score.setStyle({ fontFamily: 'Orbitron', fontSize: '14px', color });
      });
      rowObjs.forEach((r, i) => {
        const delay = i * 40;
        this.tweens.add({ targets: r.rank,  alpha: 1, delay, duration: 180 });
        this.tweens.add({ targets: r.name,  alpha: 1, delay, duration: 180 });
        this.tweens.add({ targets: r.score, alpha: 1, delay, duration: 180 });
      });
    });

    // ── Close button ──
    const closeBg = this.add.graphics().setDepth(102);
    const closeLabel = this.add.text(cx, cy + PH / 2 - 34, 'CLOSE', {
      fontFamily: 'Orbitron', fontSize: '16px', color: '#88aacc',
      stroke: '#000', strokeThickness: 2,
    }).setOrigin(0.5).setDepth(103).setAlpha(0).setInteractive({ useHandCursor: true });
    container.add([closeBg, closeLabel]);
    this.tweens.add({ targets: closeLabel, alpha: 1, delay: 200, duration: 200 });

    const drawClose = (hover: boolean): void => {
      closeBg.clear();
      closeBg.fillStyle(hover ? 0x113355 : 0x0a1a2a, 0.9);
      closeBg.fillRoundedRect(cx - 80, cy + PH / 2 - 54, 160, 40, 8);
      closeBg.lineStyle(1, hover ? 0x88aacc : 0x334455, 1);
      closeBg.strokeRoundedRect(cx - 80, cy + PH / 2 - 54, 160, 40, 8);
    };
    drawClose(false);

    const closeModal = (): void => {
      this.tweens.add({
        targets: [dimmer, panel, header, div, colLabel, closeBg, closeLabel],
        alpha: 0, duration: 180,
        onComplete: () => container.destroy(),
      });
    };

    closeLabel.on('pointerover', () => drawClose(true));
    closeLabel.on('pointerout',  () => drawClose(false));
    closeLabel.on('pointerdown', closeModal);

    // Also close on clicking the dimmer outside the panel
    dimmer.on('pointerdown', (_ptr: Phaser.Input.Pointer) => {
      const px = cx - PW / 2, py = cy - PH / 2;
      if (_ptr.x < px || _ptr.x > px + PW || _ptr.y < py || _ptr.y > py + PH) {
        closeModal();
      }
    });
  }
}
