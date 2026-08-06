import Phaser from 'phaser';
import { dialogFont, getLang } from '../i18n';
import { startTransition, finishTransition } from '../transition';
import { crossToBgm } from '../bgm';

/**
 * COLD-OPEN "message from Cato" scene. After the player clicks Play on a NEW game, a
 * laptop fills the screen showing a CHAT APP: Cato has messaged the player, asking them
 * to come to Catopia and help look after the island (he's a small spirit, can't do much
 * alone, and wants to explore). The player chats back; when they AGREE, we transition
 * into the game (which plays the arrival cinematic); if they DECLINE, back to the title.
 *
 * The chat is styled like a real messaging app (bubbles: Cato left, player right; a
 * header; a bottom input bar) rather than the game's RPG box — so it reads as software
 * ON the laptop screen. New messages type out; long ones just grow + the log scrolls
 * (no RPG pagination). The cream laptop screen is the wallpaper.
 *
 * P1: ONE fixed opening line + PLACEHOLDER canned replies + keyword accept/decline. P2
 * swaps the canned replies for the runtime-AI npc (u.ai.npc) with a recruiting persona +
 * accept_help / decline_help actions.
 */

const SCREEN = { x0: 0.155, y0: 0.06, x1: 0.845, y1: 0.57 }; // cream screen inside blue-laptop.png
const LAPTOP = 'blue-laptop';
const CATO_BUBBLE = 0xeaf1fb, CATO_TEXT = '#26384a';
const ME_BUBBLE = 0x8fce9f, ME_TEXT = '#14361f';
const PILL_FILL = 0xfffdf6, PILL_LINE = 0xcdbf9a;
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

interface Msg { who: 'cato' | 'me'; text: string }

export class LaptopScene extends Phaser.Scene {
  private laptop!: Phaser.GameObjects.Image;
  private avatar?: Phaser.GameObjects.Image;
  private nameText!: Phaser.GameObjects.Text;
  private msgLayer!: Phaser.GameObjects.Container; // scrolling bubble log
  private maskG!: Phaser.GameObjects.Graphics;     // clips the log to the message area
  private measure!: Phaser.GameObjects.Text;
  private pillG!: Phaser.GameObjects.Graphics;
  private sendBtn!: Phaser.GameObjects.Text;
  private inputEl?: HTMLInputElement;

  private messages: Msg[] = [];
  private typing = false;
  private typeTimer?: Phaser.Time.TimerEvent;
  private typingText?: Phaser.GameObjects.Text; // the bubble being revealed (rebuilt by reflow)
  private typingFull = '';
  private typeIdx = 0;
  private onLineDone?: () => void;
  private busy = false;

  // screen-rect geometry, set in layout()
  private area = { x: 0, y: 0, w: 0, h: 0, pad: 8, fs: 16 };

  constructor() { super({ key: 'LaptopScene' }); }

  create(): void {
    const W = this.scale.width, H = this.scale.height;
    crossToBgm(this, 'bgm-title', ['bgm'], 500);
    this.add.rectangle(0, 0, W, H, 0x14212e, 1).setOrigin(0, 0);
    this.laptop = this.add.image(0, 0, LAPTOP).setOrigin(0.5);

    if (this.textures.exists('teemo')) this.avatar = this.add.image(0, 0, 'teemo', 0).setOrigin(0.5);
    this.nameText = this.add.text(0, 0, 'Cato', { fontFamily: dialogFont(), color: NAME_COLOR, fontStyle: 'bold' }).setOrigin(0, 0.5);

    this.msgLayer = this.add.container(0, 0);
    this.maskG = this.add.graphics().setVisible(false);
    this.msgLayer.setMask(this.maskG.createGeometryMask());
    this.measure = this.add.text(-9999, 0, '', { fontFamily: dialogFont() }).setVisible(false);

    this.pillG = this.add.graphics();
    this.sendBtn = this.add.text(0, 0, '▶', { fontFamily: dialogFont(), color: '#5a8a6a' }).setOrigin(0.5).setInteractive({ useHandCursor: true });
    this.sendBtn.on('pointerdown', () => { if (this.inputEl) this.onSend(this.inputEl.value.trim()); });

    this.layout();
    this.scale.on(Phaser.Scale.Events.RESIZE, this.layout, this);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.scale.off(Phaser.Scale.Events.RESIZE, this.layout, this);
      this.removeInput();
    });

    // Tap / Space while a message is typing → reveal the rest instantly (no pagination).
    this.input.on('pointerdown', () => this.finishTyping());
    this.input.keyboard?.on('keydown-SPACE', () => this.finishTyping());

    finishTransition(this); // uncover the Play→laptop wipe
    this.catoSay(tr(OPENING), () => this.makeInput());
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
    const fs = Math.max(11, Math.round(sh * 0.072));
    const headerH = fs * 2.4, inputH = fs * 2.4, gap = fs * 0.5;

    // Header: just the avatar + name, sitting directly on the laptop's cream screen (no
    // background frame — the screen art already provides one; no online status).
    const av = headerH * 0.72, hy = sy0 + headerH / 2;
    if (this.avatar) this.avatar.setDisplaySize(av, av).setPosition(sx0 + pad + av / 2, hy);
    this.nameText.setFontSize(Math.round(fs * 1.05)).setPosition(sx0 + pad + av + fs * 0.5, hy);

    // Message area (masked, scrolling).
    const ax = sx0 + pad, ay = sy0 + headerH + gap;
    const aw = sw - pad * 2, ah = sy0 + sh - inputH - gap - ay;
    this.area = { x: ax, y: ay, w: aw, h: ah, pad, fs };
    this.maskG.clear().fillStyle(0xffffff).fillRect(ax, ay, aw, ah);
    this.measure.setFontSize(fs).setWordWrapWidth(aw * 0.72 - fs * 1.4);

    // Input pill + send button.
    const iy = sy0 + sh - inputH, iw2 = sw - pad * 2, btnR = inputH * 0.44;
    this.pillG.clear();
    this.pillG.fillStyle(PILL_FILL, 1).fillRoundedRect(sx0 + pad, iy, iw2, inputH, inputH / 2);
    this.pillG.lineStyle(Math.max(1, fs * 0.09), PILL_LINE, 1).strokeRoundedRect(sx0 + pad, iy, iw2, inputH, inputH / 2);
    this.sendBtn.setFontSize(Math.round(fs * 1.1)).setPosition(sx0 + sw - pad - btnR, iy + inputH / 2);

    this.reflow();
    if (this.inputEl) this.positionInput(sx0 + pad, iy, iw2 - btnR * 2, inputH);
  };

  // ── Bubbles ────────────────────────────────────────────────────────────────
  /** Re-render all bubbles at the current size (called on resize + after each add). The
   *  bubble is measured/sized from the FULL text, so a typing message just fills in. */
  private reflow(): void {
    this.msgLayer.removeAll(true);
    this.typingText = undefined;
    const { w, fs } = this.area;
    const padX = fs * 0.7, padY = fs * 0.5, gap = fs * 0.7;
    const wrapW = w * 0.74 - padX * 2;
    this.measure.setFontSize(fs).setWordWrapWidth(wrapW);
    const last = this.messages.length - 1;
    let y = 0;
    for (let idx = 0; idx < this.messages.length; idx++) {
      const m = this.messages[idx]!;
      this.measure.setText(m.text);
      const tw = Math.min(wrapW, this.measure.width);
      const bw = tw + padX * 2, bh = this.measure.height + padY * 2;
      const bx = m.who === 'me' ? w - bw : 0;
      const g = this.add.graphics();
      g.fillStyle(m.who === 'me' ? ME_BUBBLE : CATO_BUBBLE, 1).fillRoundedRect(bx, y, bw, bh, fs * 0.5);
      const revealing = this.typing && idx === last && m.who === 'cato';
      const shown = revealing ? m.text.slice(0, this.typeIdx) : m.text;
      const t = this.add.text(bx + padX, y + padY, shown, {
        fontFamily: dialogFont(), color: m.who === 'me' ? ME_TEXT : CATO_TEXT,
        fontSize: `${fs}px`, wordWrap: { width: tw + 1 },
      }).setOrigin(0, 0);
      this.msgLayer.add([g, t]);
      if (revealing) this.typingText = t;
      y += bh + gap;
    }
    // Scroll so the newest sits at the bottom of the area.
    this.msgLayer.setPosition(this.area.x, this.area.y - Math.max(0, y - this.area.h));
  }

  private addMsg(who: 'cato' | 'me', text: string): void { this.messages.push({ who, text }); this.reflow(); }

  /** Cato sends a message that types out; onDone fires when it's fully shown. */
  private catoSay(text: string, onDone?: () => void): void {
    this.removeInput();
    this.typeTimer?.remove();
    this.messages.push({ who: 'cato', text });
    this.typing = true; this.typingFull = text; this.typeIdx = 0; this.onLineDone = onDone;
    this.reflow(); // creates the (full-size) bubble; the text fills in
    this.typeTimer = this.time.addEvent({
      delay: TYPE_MS, loop: true, callback: () => {
        if (this.typeIdx >= text.length) { this.typing = false; this.typeTimer?.remove(); this.onLineDone?.(); return; }
        this.typeIdx++; this.typingText?.setText(text.slice(0, this.typeIdx));
      },
    });
  }

  /** Tap / Space: finish the currently-typing message instantly. */
  private finishTyping(): void {
    if (!this.typing) return;
    this.typeTimer?.remove(); this.typing = false; this.typeIdx = this.typingFull.length;
    this.typingText?.setText(this.typingFull);
    this.onLineDone?.();
  }

  // ── Input ───────────────────────────────────────────────────────────────────
  private makeInput(): void {
    if (this.inputEl || this.busy) return;
    const el = document.createElement('input');
    el.type = 'text'; el.maxLength = 120;
    el.placeholder = getLang() === 'zh-CN' ? '输入消息…' : 'Message…';
    el.style.cssText = 'position:fixed;z-index:30;border:none;outline:none;background:transparent;color:#3a2a1a;font-family:inherit;';
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
    const pad = this.area.fs;
    el.style.left = `${rect.left + (inX + pad) * scaleX}px`;
    el.style.top = `${rect.top + inY * scaleY}px`;
    el.style.width = `${(inW - pad) * scaleX}px`;
    el.style.height = `${inH * scaleY}px`;
    el.style.fontSize = `${Math.round(this.area.fs * scaleY)}px`;
  }

  private removeInput(): void { this.inputEl?.remove(); this.inputEl = undefined; }

  private onSend(text: string): void {
    if (this.busy || this.typing || !text) return;
    if (this.inputEl) this.inputEl.value = '';
    this.addMsg('me', text);
    const t = text.toLowerCase();
    const yes = /(愿意|好的|好呀|好啊|我来|帮|当然|可以|答应|yes|sure|ok|okay|i will|i'?ll help|help you|of course)/.test(t) || t === '好' || t === '来';
    const no = /(不愿意|不想|拒绝|算了|不去|不行|no thanks|no\b|nope|not really|decline)/.test(t);
    if (yes) { this.finish(true); return; }
    if (no) { this.finish(false); return; }
    this.catoSay(tr(FILLER), () => this.makeInput()); // placeholder — AI replies here in P2
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
    this.catoSay(tr(accepted ? ACCEPT : DECLINE), () => this.time.delayedCall(1100, go));
    this.time.delayedCall(8000, go); // safety: never strand the player
  }
}
