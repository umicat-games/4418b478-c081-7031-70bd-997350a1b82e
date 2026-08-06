import Phaser from 'phaser';
import { dialogFont, getLang } from '../i18n';
import { startTransition, finishTransition } from '../transition';
import { crossToBgm } from '../bgm';

/**
 * COLD-OPEN "message from Cato" scene. After the player clicks Play on a NEW game, a
 * laptop fills the screen showing a chat with Cato: he asks the player to come to Catopia
 * and help look after the island (he's a small spirit, can't do much alone, and wants to
 * explore). The player chats back; when they AGREE, we transition into the game (which
 * plays the arrival cinematic); if they DECLINE, back to the title.
 *
 * Interaction is the SAME as talking to Cato in the world: ONE flat dialogue panel shows
 * his current line with the RPG typewriter, and if a line is long it PAGINATES — click /
 * tap / Space reveals the rest or advances to the next page (no scrolling log). The input
 * sits below. Styled flat/soft (not the game's wooden box) so it reads as software on the
 * cream laptop screen (which already frames it).
 *
 * P1: ONE fixed opening line + PLACEHOLDER canned replies + keyword accept/decline. P2
 * swaps the canned replies for the runtime-AI npc (u.ai.npc) with a recruiting persona +
 * accept_help / decline_help actions.
 */

const SCREEN = { x0: 0.155, y0: 0.06, x1: 0.845, y1: 0.57 }; // cream screen inside blue-laptop.png
const LAPTOP = 'blue-laptop';
const PANEL_FILL = 0xffffff, PANEL_LINE = 0xcdd8e6, PANEL_TEXT = '#26384a';
const NAME_COLOR = '#3a2a1a';
const TYPE_MS = 34;

const OPENING = {
  en: "Hi... is this thing on? Oh! Hello! I'm Cato, the little spirit of Catopia. I'm reaching out because... well, I could really use your help looking after our island. I can't do much on my own, and I so want to explore this world with someone. Would you come help me?",
  'zh-CN': '嗨……这个能收到吗？哦！你好呀！我是 Cato，Catopia 小岛的精灵。我冒昧联系你，是因为……我一个人实在照看不过来这座岛，而且好想有人能陪我一起去探索这个世界。你愿意来 Catopia 帮帮我吗？',
};
const ACCEPT = { en: "Really?! Thank you so much — I'll be waiting for you on the island! 💛", 'zh-CN': '真的吗？！太谢谢你了——我在小岛上等你！💛' };
const DECLINE = { en: "Oh... that's alright. I'll go ask around, then. Take care!", 'zh-CN': '这样啊……没关系的。那我再去问问别人吧。你也保重！' };
const FILLER = { en: "I'm only a little spirit, so I don't know much yet — but I'd love to find out together in Catopia! So... will you come?", 'zh-CN': '我只是个小精灵，懂的还不多——不过好想和你一起在 Catopia 里探索呀！所以……你会来吗？' };

const tr = (m: { en: string; 'zh-CN': string }): string => (getLang() === 'zh-CN' ? m['zh-CN'] : m.en);

export class LaptopScene extends Phaser.Scene {
  private laptop!: Phaser.GameObjects.Image;
  private avatar?: Phaser.GameObjects.Image;
  private nameText!: Phaser.GameObjects.Text;
  private panelG!: Phaser.GameObjects.Graphics; // the single flat message box
  private msgText!: Phaser.GameObjects.Text;
  private measure!: Phaser.GameObjects.Text;    // hidden — pagination height probe
  private more!: Phaser.GameObjects.Text;       // ▼ "more" prompt
  private pillG!: Phaser.GameObjects.Graphics;
  private sendBtn!: Phaser.GameObjects.Text;
  private inputEl?: HTMLInputElement;

  // typewriter + pagination state
  private pages: string[] = [];
  private pageIdx = 0;
  private charIdx = 0;
  private typing = false;
  private typeTimer?: Phaser.Time.TimerEvent;
  private onLineDone?: () => void;
  private busy = false;

  private panelH = 10; private fs = 16; // set in layout()

  constructor() { super({ key: 'LaptopScene' }); }

  create(): void {
    const W = this.scale.width, H = this.scale.height;
    crossToBgm(this, 'bgm-title', ['bgm'], 500);
    this.add.rectangle(0, 0, W, H, 0x14212e, 1).setOrigin(0, 0);
    this.laptop = this.add.image(0, 0, LAPTOP).setOrigin(0.5);

    if (this.textures.exists('teemo')) this.avatar = this.add.image(0, 0, 'teemo', 0).setOrigin(0.5);
    this.nameText = this.add.text(0, 0, 'Cato', { fontFamily: dialogFont(), color: NAME_COLOR, fontStyle: 'bold' }).setOrigin(0, 0.5);

    this.panelG = this.add.graphics();
    this.msgText = this.add.text(0, 0, '', { fontFamily: dialogFont(), color: PANEL_TEXT }).setOrigin(0, 0);
    this.measure = this.add.text(-9999, 0, '', { fontFamily: dialogFont() }).setVisible(false);
    this.more = this.add.text(0, 0, '▼', { fontFamily: dialogFont(), color: '#9bb0c4' }).setOrigin(1, 1).setVisible(false);

    this.pillG = this.add.graphics();
    this.sendBtn = this.add.text(0, 0, '▶', { fontFamily: dialogFont(), color: '#5a8a6a' }).setOrigin(0.5).setInteractive({ useHandCursor: true });
    this.sendBtn.on('pointerdown', () => { if (this.inputEl) this.onSend(this.inputEl.value.trim()); });

    this.layout();
    this.scale.on(Phaser.Scale.Events.RESIZE, this.layout, this);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.scale.off(Phaser.Scale.Events.RESIZE, this.layout, this);
      this.removeInput();
    });

    // Click / tap / Space advances the text (reveal rest / next page) while Cato speaks.
    this.input.on('pointerdown', () => this.advance());
    this.input.keyboard?.on('keydown-SPACE', () => this.advance());

    finishTransition(this); // uncover the Play→laptop wipe
    this.showLine(tr(OPENING), () => this.makeInput());
  }

  // ── Layout ────────────────────────────────────────────────────────────────
  private layout = (): void => {
    const W = this.scale.width, H = this.scale.height;
    const tex = this.textures.get(LAPTOP).getSourceImage();
    const iw = tex.width, ih = tex.height;
    const s = Math.min((W * 0.94) / iw, (H * 0.94) / ih);
    this.laptop.setScale(s).setPosition(W / 2, H / 2);
    const lx = W / 2 - (iw * s) / 2, ly = H / 2 - (ih * s) / 2;
    const sx0 = lx + SCREEN.x0 * iw * s, sy0 = ly + SCREEN.y0 * ih * s;
    const sw = (SCREEN.x1 - SCREEN.x0) * iw * s, sh = (SCREEN.y1 - SCREEN.y0) * ih * s;
    const pad = Math.round(sw * 0.03);
    const fs = Math.max(11, Math.round(sh * 0.078)); this.fs = fs;
    const headerH = fs * 2.2, inputH = fs * 2.4, gap = fs * 0.5;

    // Header: avatar + name directly on the screen (the screen art frames it).
    const av = headerH * 0.72, hy = sy0 + headerH / 2;
    if (this.avatar) this.avatar.setDisplaySize(av, av).setPosition(sx0 + pad + av / 2, hy);
    this.nameText.setFontSize(Math.round(fs * 1.05)).setPosition(sx0 + pad + av + fs * 0.5, hy);

    // Single flat message panel.
    const px = sx0 + pad, py = sy0 + headerH + gap;
    const pw = sw - pad * 2, ph = sy0 + sh - inputH - gap - py; this.panelH = ph;
    this.panelG.clear();
    this.panelG.fillStyle(PANEL_FILL, 0.94).fillRoundedRect(px, py, pw, ph, fs * 0.6);
    this.panelG.lineStyle(Math.max(1, fs * 0.08), PANEL_LINE, 1).strokeRoundedRect(px, py, pw, ph, fs * 0.6);
    const tpad = fs * 0.9;
    this.msgText.setFontSize(fs).setPosition(px + tpad, py + tpad).setWordWrapWidth(pw - tpad * 2);
    this.measure.setFontSize(fs).setWordWrapWidth(pw - tpad * 2);
    this.more.setFontSize(fs).setPosition(px + pw - tpad, py + ph - tpad * 0.5);

    // Input box + send button — SAME rounded panel style as Cato's message box.
    const iy = sy0 + sh - inputH, btnR = inputH * 0.44;
    this.pillG.clear();
    this.pillG.fillStyle(PANEL_FILL, 0.94).fillRoundedRect(px, iy, pw, inputH, fs * 0.6);
    this.pillG.lineStyle(Math.max(1, fs * 0.08), PANEL_LINE, 1).strokeRoundedRect(px, iy, pw, inputH, fs * 0.6);
    this.sendBtn.setFontSize(Math.round(fs * 1.1)).setPosition(sx0 + sw - pad - btnR, iy + inputH / 2);
    if (this.inputEl) this.positionInput(px, iy, pw - btnR * 2, inputH);
  };

  /** Height budget for one page in the panel. */
  private msgFitH(): number { return this.panelH - this.fs * 2.4; }
  private fits(str: string): boolean { this.measure.setText(str); return this.measure.height <= this.msgFitH(); }

  private paginate(text: string): string[] {
    const pages: string[] = []; let rest = text.trim();
    for (let g = 0; rest && g < 64; g++) {
      if (this.fits(rest)) { pages.push(rest); break; }
      let lo = 1, hi = rest.length, best = 1;
      while (lo <= hi) { const mid = (lo + hi) >> 1; if (this.fits(rest.slice(0, mid))) { best = mid; lo = mid + 1; } else hi = mid - 1; }
      let cut = best; const sp = rest.lastIndexOf(' ', best); if (sp > best * 0.5) cut = sp;
      pages.push(rest.slice(0, cut).trim()); rest = rest.slice(cut).trim();
    }
    return pages.length ? pages : [''];
  }

  // ── Typewriter + pagination ──────────────────────────────────────────────
  private showLine(fullText: string, onDone?: () => void): void {
    this.removeInput();
    this.typeTimer?.remove();
    this.pages = this.paginate(fullText);
    this.pageIdx = 0; this.onLineDone = onDone;
    this.typePage();
  }

  private typePage(): void {
    this.charIdx = 0; this.typing = true;
    this.more.setVisible(false);
    this.msgText.setText('');
    const page = this.pages[this.pageIdx] ?? '';
    this.typeTimer?.remove();
    this.typeTimer = this.time.addEvent({
      delay: TYPE_MS, loop: true, callback: () => {
        if (this.charIdx >= page.length) { this.typing = false; this.typeTimer?.remove(); this.onPageShown(); return; }
        this.charIdx++; this.msgText.setText(page.slice(0, this.charIdx));
      },
    });
  }

  private onPageShown(): void {
    if (this.pageIdx < this.pages.length - 1) this.more.setVisible(true);
    else this.onLineDone?.();
  }

  private advance(): void {
    if (this.busy) return;
    if (this.typing) { this.typeTimer?.remove(); this.typing = false; this.msgText.setText(this.pages[this.pageIdx] ?? ''); this.onPageShown(); return; }
    if (this.pageIdx < this.pages.length - 1) { this.pageIdx++; this.typePage(); }
  }

  // ── Input ───────────────────────────────────────────────────────────────────
  private makeInput(): void {
    if (this.inputEl || this.busy) return;
    const el = document.createElement('input');
    el.type = 'text'; el.maxLength = 120;
    el.placeholder = getLang() === 'zh-CN' ? '输入消息…' : 'Message…';
    el.style.cssText = 'position:fixed;z-index:30;border:none;outline:none;background:transparent;color:#26384a;font-family:zpix, sans-serif;';
    (this.game.canvas.parentElement ?? document.body).appendChild(el);
    el.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); this.onSend(el.value.trim()); } });
    this.inputEl = el;
    this.layout();
    setTimeout(() => el.focus(), 50);
  }

  private positionInput(inX: number, inY: number, inW: number, inH: number): void {
    const el = this.inputEl!;
    const rect = this.game.canvas.getBoundingClientRect();
    const scaleX = rect.width / this.scale.width, scaleY = rect.height / this.scale.height;
    const pad = this.fs;
    el.style.left = `${rect.left + (inX + pad) * scaleX}px`;
    el.style.top = `${rect.top + inY * scaleY}px`;
    el.style.width = `${(inW - pad) * scaleX}px`;
    el.style.height = `${inH * scaleY}px`;
    el.style.fontSize = `${Math.round(this.fs * scaleY)}px`;
  }

  private removeInput(): void { this.inputEl?.remove(); this.inputEl = undefined; }

  private onSend(text: string): void {
    if (this.busy || this.typing || !text) return;
    if (this.inputEl) this.inputEl.value = '';
    const t = text.toLowerCase();
    const yes = /(愿意|好的|好呀|好啊|我来|帮|当然|可以|答应|yes|sure|ok|okay|i will|i'?ll help|help you|of course)/.test(t) || t === '好' || t === '来';
    const no = /(不愿意|不想|拒绝|算了|不去|不行|no thanks|no\b|nope|not really|decline)/.test(t);
    if (yes) { this.finish(true); return; }
    if (no) { this.finish(false); return; }
    this.showLine(tr(FILLER), () => this.makeInput()); // placeholder — AI replies here in P2
  }

  private finish(accepted: boolean): void {
    if (this.busy) return;
    this.busy = true; this.removeInput();
    if (accepted) { try { localStorage.setItem('catopia:laptopDone', '1'); } catch { /* no storage */ } }
    let gone = false;
    const go = (): void => {
      if (gone) return; gone = true;
      if (accepted) startTransition(this, 'GameScene', { sceneId: 'main' }, { effect: 'dissolve' });
      else startTransition(this, 'BootMenuScene', {}, { effect: 'dissolve' });
    };
    this.showLine(tr(accepted ? ACCEPT : DECLINE), () => this.time.delayedCall(1100, go));
    this.time.delayedCall(8000, go); // safety: never strand the player
  }
}
