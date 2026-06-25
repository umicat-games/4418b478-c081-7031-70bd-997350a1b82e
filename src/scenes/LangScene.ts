import Phaser from 'phaser';
import { GAME_WIDTH, GAME_HEIGHT } from '../config';
import { setLang, fontFor, t, type Lang } from '../i18n';
import { umicatReady } from '../main';

export class LangScene extends Phaser.Scene {
  constructor() {
    super({ key: 'LangScene' });
  }

  async create(): Promise<void> {
    // Priority: saved preference > platform locale > default 'zh-CN'
    const saved = localStorage.getItem('game:lang') as Lang | null;
    if (saved === 'en' || saved === 'zh-CN') {
      setLang(saved);
    } else {
      const umicat = await umicatReady;
      const pl = umicat?.locale;
      if (pl === 'en' || pl === 'zh-CN') setLang(pl as Lang);
      else setLang('zh-CN');
    }

    this.buildUI();
  }

  private buildUI(): void {
    // ─── Pixel-art background image ───
    const bgImg = this.add.image(GAME_WIDTH / 2, GAME_HEIGHT / 2, 'bg_title').setDepth(0);
    const scaleX = GAME_WIDTH / bgImg.width;
    const scaleY = GAME_HEIGHT / bgImg.height;
    bgImg.setScale(Math.max(scaleX, scaleY));

    // Dark overlay so UI pops
    const ov = this.add.graphics().setDepth(1);
    ov.fillStyle(0x000000, 0.48);
    ov.fillRect(0, 0, GAME_WIDTH, GAME_HEIGHT);

    // ─── Pixel scanline texture (horizontal lines every 4px for retro CRT feel) ───
    const scan = this.add.graphics().setDepth(2);
    for (let y = 0; y < GAME_HEIGHT; y += 4) {
      scan.lineStyle(1, 0x000000, 0.08);
      scan.lineBetween(0, y, GAME_WIDTH, y);
    }

    // ─── Title: "Among Wolves" in pixel font ───
    this.add.text(GAME_WIDTH / 2, 148, 'AMONG WOLVES', {
      fontFamily: '"Press Start 2P"',
      fontSize: '42px',
      color: '#f5d060',
      stroke: '#1a0800',
      strokeThickness: 6,
      shadow: { offsetX: 4, offsetY: 4, color: '#8b0000', blur: 0, fill: true },
    }).setOrigin(0.5).setDepth(10);

    // Subtitle in Chinese
    this.add.text(GAME_WIDTH / 2, 215, '狼人杀', {
      fontFamily: 'Noto Sans SC',
      fontSize: '26px',
      color: '#d0b878',
      letterSpacing: 10,
    }).setOrigin(0.5).setDepth(10);

    // Pixel divider — dashes
    const div = this.add.graphics().setDepth(10);
    div.lineStyle(2, 0xf5d060, 0.5);
    for (let dx = GAME_WIDTH / 2 - 240; dx < GAME_WIDTH / 2 + 240; dx += 14) {
      div.lineBetween(dx, 248, dx + 8, 248);
    }

    // ─── START GAME button (primary, big, red) ───
    this.makePixelBtn(
      GAME_WIDTH / 2, 360, 320, 90,
      t('startGame'), 0xaa2020, 0x550000,
      () => this.showConsentDialog(),
    );

    // ─── SELECT LANGUAGE button (secondary, smaller, dark) ───
    this.makePixelBtn(
      GAME_WIDTH / 2, 480, 240, 52,
      t('selectLang'), 0x2a3a2a, 0x141e14,
      () => this.showLangDialog(),
      '#c8d0a0',
      0.55,
    );

    // ─── Info row ───
    this.add.text(GAME_WIDTH / 2, 565, '6 PLAYERS  ·  AI OPPONENTS  ·  SOCIAL DEDUCTION', {
      fontFamily: '"Press Start 2P"',
      fontSize: '9px',
      color: '#7a9a70',
    }).setOrigin(0.5).setDepth(10);

    this.add.text(GAME_WIDTH / 2, 590, '6人局  ·  AI真人级对手  ·  社交推理', {
      fontFamily: 'Noto Sans SC',
      fontSize: '15px',
      color: '#5a8050',
    }).setOrigin(0.5).setDepth(10);

    // ─── Role icons row (decorative) ───
    const roles = [
      { x: GAME_WIDTH / 2 - 120, emoji: '🐺', color: 0xcc2222 },
      { x: GAME_WIDTH / 2,        emoji: '🔮', color: 0x2266cc },
      { x: GAME_WIDTH / 2 + 120, emoji: '🏘️', color: 0x22aa55 },
    ];
    const roleG = this.add.graphics().setDepth(9);
    roles.forEach(({ x, color }) => {
      roleG.fillStyle(color, 0.18);
      roleG.fillRect(x - 28, 628, 56, 68);
      roleG.lineStyle(1, color, 0.5);
      roleG.strokeRect(x - 28, 628, 56, 68);
    });
    roles.forEach(({ x, emoji }) => {
      this.add.text(x, 662, emoji, { fontSize: '28px' }).setOrigin(0.5).setDepth(10);
    });

    // Fade in
    this.cameras.main.fadeIn(600, 0, 0, 0);
  }

  // ─── Reusable pixel button factory ──────────────────────────────────────────
  private makePixelBtn(
    bx: number, by: number, bw: number, bh: number,
    label: string,
    accentColor: number, shadowColor: number,
    onClick: () => void,
    textColor = '#ffffff',
    borderAlpha = 0.7,
  ): void {
    const shadow = this.add.graphics().setDepth(9);
    shadow.fillStyle(shadowColor, 1);
    shadow.fillRect(bx - bw / 2 + 5, by - bh / 2 + 5, bw, bh);

    const btnBg = this.add.graphics().setDepth(10);
    btnBg.fillStyle(accentColor, 1);
    btnBg.fillRect(bx - bw / 2, by - bh / 2, bw, bh);
    btnBg.lineStyle(3, 0xffffff, 0.18);
    btnBg.lineBetween(bx - bw / 2, by - bh / 2, bx + bw / 2, by - bh / 2);
    btnBg.lineBetween(bx - bw / 2, by - bh / 2, bx - bw / 2, by + bh / 2);
    btnBg.lineStyle(2, 0xf5d060, borderAlpha);
    btnBg.strokeRect(bx - bw / 2, by - bh / 2, bw, bh);

    const btnHov = this.add.graphics().setDepth(10);
    btnHov.fillStyle(0xffffff, 0.12);
    btnHov.fillRect(bx - bw / 2, by - bh / 2, bw, bh);
    btnHov.setVisible(false);

    const fontSize = bh >= 80 ? '18px' : '13px';
    this.add.text(bx, by, label, {
      fontFamily: `"Press Start 2P", "Noto Sans SC"`,
      fontSize,
      color: textColor,
    }).setOrigin(0.5).setDepth(11);

    const hit = this.add.rectangle(bx, by, bw, bh, 0, 0)
      .setInteractive({ useHandCursor: true }).setDepth(12);
    hit.on('pointerover', () => btnHov.setVisible(true));
    hit.on('pointerout',  () => btnHov.setVisible(false));
    hit.on('pointerdown', onClick);
  }

  // ─── Language selection dialog (pixel-style popup) ───────────────────────
  private showLangDialog(): void {
    const cx = GAME_WIDTH / 2, cy = GAME_HEIGHT / 2;
    const pw = 560, ph = 330;

    const modal: Phaser.GameObjects.GameObject[] = [];
    const track = <T extends Phaser.GameObjects.GameObject>(o: T): T => { modal.push(o); return o; };
    const dismiss = () => modal.forEach(o => o.destroy());

    // Fullscreen block overlay
    const ov = track(this.add.rectangle(cx, cy, GAME_WIDTH, GAME_HEIGHT, 0x000000, 0.72).setDepth(200));
    ov.setInteractive();
    ov.on('pointerdown', dismiss);

    // Panel — sharp corners (pixel style)
    const panel = track(this.add.graphics().setDepth(201));
    panel.fillStyle(0x0e1a0e, 1);
    panel.fillRect(cx - pw / 2, cy - ph / 2, pw, ph);
    // Top accent bar
    panel.fillStyle(0xd9a021, 1);
    panel.fillRect(cx - pw / 2 + 2, cy - ph / 2 + 2, pw - 4, 7);
    // Gold pixel border
    panel.lineStyle(3, 0xf5d060, 0.85);
    panel.strokeRect(cx - pw / 2, cy - ph / 2, pw, ph);
    // Inner inset border (classic pixel dialog double-border)
    panel.lineStyle(1, 0xf5d060, 0.25);
    panel.strokeRect(cx - pw / 2 + 6, cy - ph / 2 + 12, pw - 12, ph - 18);

    // Title
    track(this.add.text(cx, cy - ph / 2 + 48, '— SELECT LANGUAGE —', {
      fontFamily: '"Press Start 2P"',
      fontSize: '11px',
      color: '#f5d060',
    }).setOrigin(0.5).setDepth(202));

    // Dashed divider
    const divG = track(this.add.graphics().setDepth(202));
    divG.lineStyle(2, 0xf5d060, 0.35);
    for (let dx = cx - 200; dx < cx + 200; dx += 14) {
      divG.lineBetween(dx, cy - ph / 2 + 70, dx + 8, cy - ph / 2 + 70);
    }

    // Language buttons — side by side
    const langs: Array<{ code: Lang; label: string; sub: string; ac: number; sc: number }> = [
      { code: 'zh-CN', label: '中文',    sub: '简体中文', ac: 0xaa2020, sc: 0x550000 },
      { code: 'en',    label: 'ENGLISH', sub: 'English', ac: 0x1a5c99, sc: 0x0a2a4a },
    ];

    langs.forEach(({ code, label, sub, ac, sc }, i) => {
      const bx = cx + (i === 0 ? -130 : 130);
      const by = cy + 30;
      const bw = 210;
      const bh = 84;

      const sh = track(this.add.graphics().setDepth(201));
      sh.fillStyle(sc, 1);
      sh.fillRect(bx - bw / 2 + 5, by - bh / 2 + 5, bw, bh);

      const bg = track(this.add.graphics().setDepth(202));
      bg.fillStyle(ac, 1);
      bg.fillRect(bx - bw / 2, by - bh / 2, bw, bh);
      bg.lineStyle(3, 0xffffff, 0.2);
      bg.lineBetween(bx - bw / 2, by - bh / 2, bx + bw / 2, by - bh / 2);
      bg.lineBetween(bx - bw / 2, by - bh / 2, bx - bw / 2, by + bh / 2);
      bg.lineStyle(2, 0xf5d060, 0.7);
      bg.strokeRect(bx - bw / 2, by - bh / 2, bw, bh);

      const hov = track(this.add.graphics().setDepth(202));
      hov.fillStyle(0xffffff, 0.12);
      hov.fillRect(bx - bw / 2, by - bh / 2, bw, bh);
      hov.setVisible(false);

      const lf = code === 'zh-CN' ? 'Noto Sans SC' : '"Press Start 2P"';
      const ls = code === 'zh-CN' ? '26px' : '18px';
      track(this.add.text(bx, by - 10, label, {
        fontFamily: lf, fontSize: ls, color: '#ffffff', fontStyle: 'bold',
      }).setOrigin(0.5).setDepth(203));
      track(this.add.text(bx, by + 22, sub, {
        fontFamily: 'Noto Sans SC', fontSize: '13px', color: 'rgba(255,255,255,0.6)',
      }).setOrigin(0.5).setDepth(203));

      const hit = track(
        this.add.rectangle(bx, by, bw, bh, 0, 0).setDepth(204).setInteractive({ useHandCursor: true }),
      );
      hit.on('pointerover',  () => hov.setVisible(true));
      hit.on('pointerout',   () => hov.setVisible(false));
      hit.on('pointerdown', () => {
        setLang(code);
        dismiss();
        // Rebuild UI so button labels reflect new language
        this.children.removeAll(true);
        this.buildUI();
      });
    });

    // Close hint
    track(this.add.text(cx, cy + ph / 2 - 24, '[ ESC / click outside to close ]', {
      fontFamily: '"Press Start 2P"',
      fontSize: '8px',
      color: '#607060',
    }).setOrigin(0.5).setDepth(203));

    // ESC key to close
    const esc = this.input.keyboard?.addKey(Phaser.Input.Keyboard.KeyCodes.ESCAPE);
    const escHandler = () => { esc?.removeListener('down', escHandler); dismiss(); };
    esc?.on('down', escHandler);
  }

  // ─── Consent dialog ──────────────────────────────────────────────────────
  private showConsentDialog(): void {
    const cx = GAME_WIDTH / 2, cy = GAME_HEIGHT / 2;
    const pw = 620, ph = 420;

    // Collect every object for bulk cleanup
    const modal: Phaser.GameObjects.GameObject[] = [];
    const track = <T extends Phaser.GameObjects.GameObject>(o: T): T => { modal.push(o); return o; };
    const dismiss = () => modal.forEach(o => o.destroy());

    // Full-screen dark overlay — also blocks clicks through to buttons below
    const ov = track(this.add.rectangle(cx, cy, GAME_WIDTH, GAME_HEIGHT, 0x000000, 0.78).setDepth(200));
    ov.setInteractive();

    // Dialog panel
    const panel = track(this.add.graphics().setDepth(201));
    panel.fillStyle(0x0f1f0f, 1);
    panel.fillRoundedRect(cx - pw / 2, cy - ph / 2, pw, ph, 22);
    panel.lineStyle(3, 0xf5d060, 0.85);
    panel.strokeRoundedRect(cx - pw / 2, cy - ph / 2, pw, ph, 22);
    // Subtle top accent bar
    panel.fillStyle(0xd9a021, 1);
    panel.fillRoundedRect(cx - pw / 2 + 3, cy - ph / 2 + 3, pw - 6, 8, { tl: 20, tr: 20, bl: 0, br: 0 });

    // Warning icon + title
    track(this.add.text(cx, cy - ph / 2 + 56, '⚠️', { fontSize: '38px' }).setOrigin(0.5).setDepth(202));
    track(this.add.text(cx, cy - ph / 2 + 102, t('consent_title'), {
      fontFamily: fontFor(), fontSize: '24px', color: '#f5d060', fontStyle: 'bold',
    }).setOrigin(0.5).setDepth(202));

    // Divider
    const div = track(this.add.graphics().setDepth(202));
    div.lineStyle(1, 0xf5d060, 0.25);
    div.lineBetween(cx - 220, cy - ph / 2 + 128, cx + 220, cy - ph / 2 + 128);

    // Message — top-anchored so multi-line text grows downward, not into the title
    track(this.add.text(cx, cy - ph / 2 + 146, t('consent_msg'), {
      fontFamily: fontFor(), fontSize: '17px', color: '#d0c8a0',
      wordWrap: { width: 530, useAdvancedWrap: true }, align: 'center', lineSpacing: 8,
    }).setOrigin(0.5, 0).setDepth(202));

    // Helper to make a dialog button
    const makeBtn = (bx: number, label: string, bgColor: number, onClick: () => void) => {
      const bw = 220, bh = 52;
      const by = cy + ph / 2 - 60;

      const bg = track(this.add.graphics().setDepth(202));
      bg.fillStyle(bgColor, 1);
      bg.fillRoundedRect(bx - bw / 2, by - bh / 2, bw, bh, 12);

      const hovG = track(this.add.graphics().setDepth(202));
      hovG.fillStyle(0xffffff, 0.15);
      hovG.fillRoundedRect(bx - bw / 2, by - bh / 2, bw, bh, 12);
      hovG.setVisible(false);

      track(this.add.text(bx, by, label, {
        fontFamily: fontFor(), fontSize: '16px', color: '#ffffff', fontStyle: 'bold',
      }).setOrigin(0.5).setDepth(203));

      const hit = track(
        this.add.rectangle(bx, by, bw, bh, 0, 0).setDepth(204).setInteractive({ useHandCursor: true }),
      );
      hit.on('pointerover', () => hovG.setVisible(true));
      hit.on('pointerout', () => hovG.setVisible(false));
      hit.on('pointerdown', onClick);
    };

    makeBtn(cx - 125, t('consent_agree'), 0x1a7a44, () => {
      dismiss();
      this.cameras.main.fadeOut(350, 0, 0, 0);
      this.time.delayedCall(360, () => this.scene.start('WerewolfScene'));
    });

    makeBtn(cx + 125, t('consent_back'), 0x5a3a10, () => {
      dismiss();
    });
  }
}
