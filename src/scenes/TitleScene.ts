import Phaser from 'phaser';
import { GAME_WIDTH, GAME_HEIGHT } from '../config';
import { umicatReady } from '../main';

const CX = GAME_WIDTH / 2;
const CY = GAME_HEIGHT / 2;

export interface ScoreEntry { score: number; wave: number; }

export class TitleScene extends Phaser.Scene {
  private sceneId!: string;

  constructor() { super({ key: 'TitleScene' }); }

  init(data: { sceneId: string }): void { this.sceneId = data.sceneId; }

  async create(): Promise<void> {
    this.buildBackground();
    this.buildTitle();
    this.buildStartPrompt();

    // Load leaderboard scores
    const scores = await this.loadScores();
    this.buildLeaderboard(scores);

    // Start game on any key or click
    this.input.once('pointerdown', () => this.startGame());
    this.input.keyboard?.once('keydown', () => this.startGame());
  }

  private buildBackground(): void {
    // Gradient deep space
    const bg = this.add.graphics().setDepth(0);
    bg.fillGradientStyle(0x04040f, 0x04040f, 0x0b0b25, 0x0b0b25, 1);
    bg.fillRect(0, 0, GAME_WIDTH, GAME_HEIGHT);

    // Nebula blobs
    const neb = this.add.graphics().setDepth(0);
    neb.fillStyle(0x2200bb, 0.07); neb.fillEllipse(280, 190, 520, 320);
    neb.fillStyle(0xcc0055, 0.05); neb.fillEllipse(930, 530, 580, 360);
    neb.fillStyle(0x005577, 0.07); neb.fillEllipse(1100, 140, 400, 260);

    // Stars
    const sg = this.add.graphics().setDepth(0);
    for (let i = 0; i < 210; i++) {
      const x = Phaser.Math.Between(0, GAME_WIDTH);
      const y = Phaser.Math.Between(0, GAME_HEIGHT);
      const r = Phaser.Math.FloatBetween(0.4, 2.3);
      const a = Phaser.Math.FloatBetween(0.2, 1.0);
      sg.fillStyle(0xddeeff, a);
      sg.fillCircle(x, y, r);
    }

    // Player ship preview — center bottom, static
    const ship = this.add.sprite(CX, CY + 160, 'player_ship_tilt').setDepth(2).setFrame(7).setScale(2.5).setAlpha(0.18);
    void ship; // decorative only
  }

  private buildTitle(): void {
    // Outer glow
    const glow = this.add.graphics().setDepth(3);
    glow.fillStyle(0xff3300, 0.06);
    glow.fillEllipse(CX, CY - 130, 700, 160);

    // Title text
    const title = this.add.text(CX, CY - 135, 'STAR SIEGE', {
      fontFamily: 'monospace',
      fontSize: '82px',
      color: '#ff5533',
      stroke: '#880011',
      strokeThickness: 6,
    }).setOrigin(0.5).setDepth(4).setAlpha(0);

    // Sub-title
    const sub = this.add.text(CX, CY - 62, 'TOP-DOWN SPACE SHOOTER', {
      fontFamily: 'monospace',
      fontSize: '18px',
      color: '#5599cc',
      letterSpacing: 4,
    }).setOrigin(0.5).setDepth(4).setAlpha(0);

    // Entry animation (one-shot fade-in)
    this.tweens.add({ targets: title, alpha: 1, y: CY - 142, duration: 700, ease: 'Cubic.Out', delay: 100 });
    this.tweens.add({ targets: sub, alpha: 1, duration: 500, ease: 'Cubic.Out', delay: 500 });
  }

  private buildStartPrompt(): void {
    const prompt = this.add.text(CX, CY + 270, '— PRESS ANY KEY OR CLICK TO START —', {
      fontFamily: 'monospace',
      fontSize: '16px',
      color: '#44ffcc',
    }).setOrigin(0.5).setDepth(4).setAlpha(0);

    this.tweens.add({ targets: prompt, alpha: 1, duration: 600, ease: 'Cubic.Out', delay: 800 });
  }

  private buildLeaderboard(scores: ScoreEntry[]): void {
    const panelX = CX;
    const panelY = CY + 50;
    const panelW = 420;
    const panelH = scores.length > 0 ? 54 + scores.length * 38 + 20 : 100;

    const panel = this.add.graphics().setDepth(3).setAlpha(0);
    panel.fillStyle(0x080820, 0.82);
    panel.fillRoundedRect(panelX - panelW / 2, panelY - 30, panelW, panelH, 18);
    panel.lineStyle(1, 0x334466, 0.8);
    panel.strokeRoundedRect(panelX - panelW / 2, panelY - 30, panelW, panelH, 18);

    const header = this.add.text(panelX, panelY - 8, '🏆  LEADERBOARD', {
      fontFamily: 'monospace', fontSize: '16px', color: '#ffdd55',
    }).setOrigin(0.5).setDepth(4).setAlpha(0);

    this.tweens.add({ targets: [panel, header], alpha: 1, duration: 500, delay: 600 });

    if (scores.length === 0) {
      const noScore = this.add.text(panelX, panelY + 30, 'No scores yet — play your first game!', {
        fontFamily: 'monospace', fontSize: '13px', color: '#556677',
      }).setOrigin(0.5).setDepth(4).setAlpha(0);
      this.tweens.add({ targets: noScore, alpha: 1, duration: 500, delay: 700 });
      return;
    }

    scores.slice(0, 5).forEach((entry, i) => {
      const rowY = panelY + 26 + i * 38;
      const medal = ['🥇', '🥈', '🥉', ' 4.', ' 5.'][i];
      const rankColor = ['#ffd700', '#c0c0c0', '#cd7f32', '#8899aa', '#8899aa'][i];

      const row = this.add.text(panelX, rowY, `${medal}   SCORE ${String(entry.score).padStart(7, ' ')}   WAVE ${entry.wave}`, {
        fontFamily: 'monospace', fontSize: '16px', color: i === 0 ? rankColor : '#aabbcc',
      }).setOrigin(0.5).setDepth(4).setAlpha(0);

      this.tweens.add({ targets: row, alpha: 1, duration: 400, delay: 700 + i * 80 });
    });
  }

  private async loadScores(): Promise<ScoreEntry[]> {
    try {
      const umicat = await umicatReady;
      if (!umicat) return [];
      const raw = await umicat.saves.get<ScoreEntry[]>('highScores');
      if (!Array.isArray(raw)) return [];
      return raw;
    } catch {
      return [];
    }
  }

  private startGame(): void {
    this.cameras.main.fade(300, 0, 0, 0);
    this.time.delayedCall(300, () => {
      this.scene.start('GameScene', { sceneId: this.sceneId });
    });
  }
}
