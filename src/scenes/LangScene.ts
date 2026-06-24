import Phaser from 'phaser';
import { GAME_WIDTH, GAME_HEIGHT } from '../config';
import { setLang, fontFor, type Lang } from '../i18n';

export class LangScene extends Phaser.Scene {
  constructor() {
    super({ key: 'LangScene' });
  }

  create(): void {
    // Restore saved language preference
    const saved = localStorage.getItem('game:lang') as Lang | null;
    if (saved === 'en' || saved === 'zh-CN') setLang(saved);

    // ─── Background ───
    const bg = this.add.graphics();
    bg.fillGradientStyle(0x050d05, 0x050d05, 0x0d200a, 0x0d200a, 1);
    bg.fillRect(0, 0, GAME_WIDTH, GAME_HEIGHT);

    // Wood table rim
    bg.fillStyle(0x3a1f08, 1);
    bg.fillEllipse(GAME_WIDTH / 2, GAME_HEIGHT / 2 + 60, 1100, 530);
    // Felt surface
    bg.fillStyle(0x1d5212, 1);
    bg.fillEllipse(GAME_WIDTH / 2, GAME_HEIGHT / 2 + 60, 1040, 490);
    bg.lineStyle(5, 0x2d8a20, 0.7);
    bg.strokeEllipse(GAME_WIDTH / 2, GAME_HEIGHT / 2 + 60, 1040, 490);

    // ─── Moon & stars ───
    const deco = this.add.graphics();
    // Moon crescent
    deco.fillStyle(0xfffacd, 0.95);
    deco.fillCircle(160, 100, 46);
    deco.fillStyle(0x050d05, 1);
    deco.fillCircle(178, 88, 40);
    // Stars
    const stars = [
      [80, 60], [260, 50], [120, 180], [320, 90],
      [1050, 55], [1180, 100], [1240, 50], [1110, 175],
    ];
    stars.forEach(([sx, sy]) => {
      deco.fillStyle(0xffffcc, Math.random() * 0.5 + 0.5);
      deco.fillCircle(sx, sy, 2.5);
    });

    // ─── Decorative role cards at sides ───
    const cardDeco = this.add.graphics();
    const sideCards = [
      { x: 160, y: 490, color: 0xcc2222, label: '🐺' },
      { x: 1120, y: 490, color: 0x2266bb, label: '🔮' },
    ];
    sideCards.forEach(({ x, y, color }) => {
      cardDeco.fillStyle(color, 0.25);
      cardDeco.fillRoundedRect(x - 52, y - 75, 104, 150, 10);
      cardDeco.lineStyle(2, color, 0.5);
      cardDeco.strokeRoundedRect(x - 52, y - 75, 104, 150, 10);
    });

    // ─── Title ───
    this.add
      .text(GAME_WIDTH / 2, 165, '狼人杀   WEREWOLF', {
        fontFamily: 'Noto Sans SC',
        fontSize: '58px',
        color: '#f5d060',
        stroke: '#2a1205',
        strokeThickness: 7,
        shadow: { offsetX: 4, offsetY: 4, color: '#000', blur: 12, fill: true },
      })
      .setOrigin(0.5)
      .setDepth(2);

    // Divider
    const divider = this.add.graphics().setDepth(2);
    divider.lineStyle(2, 0xf5d060, 0.4);
    divider.lineBetween(GAME_WIDTH / 2 - 280, 225, GAME_WIDTH / 2 + 280, 225);

    this.add
      .text(GAME_WIDTH / 2, 255, '选择语言  /  Select Language', {
        fontFamily: 'Noto Sans SC',
        fontSize: '22px',
        color: '#d0c4a0',
      })
      .setOrigin(0.5)
      .setDepth(2);

    // ─── Language buttons ───
    const langs: Array<{ code: Lang; label: string; sub: string; accentColor: number }> = [
      { code: 'zh-CN', label: '中文', sub: '简体中文', accentColor: 0xe03a3a },
      { code: 'en', label: 'English', sub: 'English', accentColor: 0x3a7ae0 },
    ];

    langs.forEach(({ code, label, sub, accentColor }, i) => {
      const bx = GAME_WIDTH / 2 + (i === 0 ? -160 : 160);
      const by = 390;
      const bw = 240;
      const bh = 90;

      const btnBg = this.add.graphics().setDepth(3);
      const drawBtn = (hovered: boolean) => {
        btnBg.clear();
        btnBg.fillStyle(accentColor, hovered ? 1 : 0.85);
        btnBg.fillRoundedRect(bx - bw / 2, by - bh / 2, bw, bh, 18);
        btnBg.lineStyle(hovered ? 4 : 2, 0xffffff, hovered ? 0.8 : 0.4);
        btnBg.strokeRoundedRect(bx - bw / 2, by - bh / 2, bw, bh, 18);
        if (hovered) {
          btnBg.fillStyle(0xffffff, 0.1);
          btnBg.fillRoundedRect(bx - bw / 2, by - bh / 2, bw, 36, { tl: 18, tr: 18, bl: 0, br: 0 });
        }
      };
      drawBtn(false);

      this.add
        .text(bx, by - 12, label, {
          fontFamily: fontFor(code),
          fontSize: '34px',
          color: '#ffffff',
          fontStyle: 'bold',
        })
        .setOrigin(0.5)
        .setDepth(4);

      this.add
        .text(bx, by + 22, sub, {
          fontFamily: fontFor(code),
          fontSize: '15px',
          color: 'rgba(255,255,255,0.75)',
        })
        .setOrigin(0.5)
        .setDepth(4);

      const hit = this.add
        .rectangle(bx, by, bw, bh, 0, 0)
        .setInteractive({ useHandCursor: true })
        .setDepth(5);

      hit.on('pointerover', () => drawBtn(true));
      hit.on('pointerout', () => drawBtn(false));
      hit.on('pointerdown', () => {
        setLang(code);
        this.cameras.main.fadeOut(350, 0, 0, 0);
        this.time.delayedCall(360, () => this.scene.start('WerewolfScene'));
      });
    });

    // ─── Info row ───
    this.add
      .text(GAME_WIDTH / 2, 510, '6人局  ·  AI真人级对手  ·  社交推理', {
        fontFamily: 'Noto Sans SC',
        fontSize: '17px',
        color: '#8aaf80',
      })
      .setOrigin(0.5)
      .setDepth(2);

    this.add
      .text(GAME_WIDTH / 2, 540, '6 Players  ·  AI-Powered Opponents  ·  Social Deduction', {
        fontFamily: 'Noto Sans',
        fontSize: '15px',
        color: '#6a8f60',
      })
      .setOrigin(0.5)
      .setDepth(2);

    // ─── Role mini-cards (decorative) ───
    const roleCards = [
      { x: 250, y: 390, emoji: '🐺', label: '狼人', color: 0xcc2222 },
      { x: 640, y: 390, emoji: '🔮', label: '预言家', color: 0x2266cc },
      { x: 1030, y: 390, emoji: '🏘️', label: '平民', color: 0x22aa55 },
    ];
    const cardG = this.add.graphics().setDepth(1);
    roleCards.forEach(({ x, y, color }) => {
      cardG.fillStyle(color, 0.12);
      cardG.fillRoundedRect(x - 40, y - 55, 80, 110, 8);
      cardG.lineStyle(1, color, 0.3);
      cardG.strokeRoundedRect(x - 40, y - 55, 80, 110, 8);
    });

    // Fade in
    this.cameras.main.fadeIn(500, 0, 0, 0);
  }
}
