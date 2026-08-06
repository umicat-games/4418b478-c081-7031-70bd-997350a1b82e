import Phaser from 'phaser';
import { dialogFont, getLang } from '../i18n';
import { startTransition, finishTransition } from '../transition';
import { crossToBgm } from '../bgm';

/**
 * COLD-OPEN "message from Cato" scene. After the player clicks Play on a NEW game, a
 * laptop fills the screen and Cato messages the player — asking them to come to Catopia
 * and help look after the island (he's a small spirit, can't do much alone, and wants to
 * explore). The player can chat with him; when they AGREE, we transition into the game
 * (which plays the arrival cinematic); if they DECLINE, back to the title.
 *
 * The chat REUSES the in-game look: the same square-buttons nine-slice boxes the game HUD
 * uses for Cato's message + the input, the same white zpix text, and the same RPG
 * typewriter + PAGINATION — click / tap / Space reveals the rest of a line or the next
 * page, exactly like talking to Cato in the world.
 *
 * P1: ONE fixed opening line + PLACEHOLDER canned replies + keyword accept/decline. P2
 * swaps the canned replies for the runtime-AI npc (u.ai.npc) with a recruiting persona +
 * accept_help / decline_help actions.
 */

const SCREEN = { x0: 0.155, y0: 0.06, x1: 0.845, y1: 0.57 }; // cream screen inside blue-laptop.png
const LAPTOP = 'blue-laptop';
const BTN = 'square-buttons';
const MSG_FRAME = 'square-button-26_26-6', MSG_NINE: [number, number, number, number] = [4, 5, 4, 5];
const INPUT_FRAME = 'square-button-26_26-5', INPUT_NINE: [number, number, number, number] = [5, 5, 5, 7];
const TEXT_COLOR = '#ffffff', NAME_COLOR = '#f4e4c1';
const TYPE_MS = 42;

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
  private msgBox!: Phaser.GameObjects.NineSlice;
  private msgText!: Phaser.GameObjects.Text;
  private measure!: Phaser.GameObjects.Text; // hidden — pagination height probe
  private more!: Phaser.GameObjects.Text;     // ▼ "more" prompt
  private nameBox!: Phaser.GameObjects.NineSlice;
  private nameText!: Phaser.GameObjects.Text;
  private portrait?: Phaser.GameObjects.Image;
  private inputBox!: Phaser.GameObjects.NineSlice;
  private inputEl?: HTMLInputElement;

  // typewriter + pagination state
  private pages: string[] = [];
  private pageIdx = 0;
  private charIdx = 0;
  private typing = false;
  private typeTimer?: Phaser.Time.TimerEvent;
  private onLineDone?: () => void;
  private busy = false;

  private fs = 16; // set in layout()

  constructor() { super({ key: 'LaptopScene' }); }

  create(): void {
    const W = this.scale.width, H = this.scale.height;
    crossToBgm(this, 'bgm-title', ['bgm'], 500);
    this.add.rectangle(0, 0, W, H, 0x14212e, 1).setOrigin(0, 0);
    this.laptop = this.add.image(0, 0, LAPTOP).setOrigin(0.5);

    this.msgBox = this.add.nineslice(0, 0, BTN, MSG_FRAME, 10, 10, ...MSG_NINE).setOrigin(0, 0);
    this.msgText = this.add.text(0, 0, '', { fontFamily: dialogFont(), color: TEXT_COLOR }).setOrigin(0, 0);
    this.measure = this.add.text(-9999, 0, '', { fontFamily: dialogFont(), color: TEXT_COLOR }).setVisible(false);
    this.more = this.add.text(0, 0, '▼', { fontFamily: dialogFont(), color: TEXT_COLOR }).setOrigin(1, 1).setVisible(false);
    if (this.textures.exists('teemo')) this.portrait = this.add.image(0, 0, 'teemo', 0).setOrigin(0.5, 0.5);
    this.nameBox = this.add.nineslice(0, 0, BTN, MSG_FRAME, 10, 10, ...MSG_NINE).setOrigin(0, 0.5);
    this.nameText = this.add.text(0, 0, 'Cato', { fontFamily: dialogFont(), color: NAME_COLOR }).setOrigin(0.5, 0.5);
    this.inputBox = this.add.nineslice(0, 0, BTN, INPUT_FRAME, 10, 10, ...INPUT_NINE).setOrigin(0, 0).setVisible(false);

    this.layout();
    this.scale.on(Phaser.Scale.Events.RESIZE, this.layout, this);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.scale.off(Phaser.Scale.Events.RESIZE, this.layout, this);
      this.removeInput();
    });

    // Click / tap / Space advances the RPG text (reveal rest / next page) — only while
    // Cato is speaking; once his line is fully shown the HTML input takes the keyboard.
    this.input.on('pointerdown', () => this.advance());
    this.input.keyboard?.on('keydown-SPACE', () => this.advance());

    finishTransition(this); // uncover the Play→laptop wipe (else the curtain stays up + blocks the next transition)
    this.showLine(tr(OPENING), () => this.makeInput());
  }

  // ── Layout (laptop + boxes inside its screen) ────────────────────────────
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
    const fs = Math.max(12, Math.round(sh * 0.085)); this.fs = fs;

    const nameH = fs * 1.9, nameW = sw * 0.24;
    const inputH = fs * 2.4;
    const msgX = sx0 + pad, msgY = sy0 + pad + nameH * 0.5;
    const msgW = sw - pad * 2, msgH = sy0 + sh - pad - inputH - pad - msgY;
    // Cato portrait sits on the message box's top-left, name frame beside it.
    const portR = nameH * 0.95;
    if (this.portrait) this.portrait.setDisplaySize(portR, portR).setPosition(msgX + portR * 0.55, msgY);
    const nameX = msgX + (this.portrait ? portR * 1.15 : 0);
    this.nameBox.setSize(nameW, nameH).setPosition(nameX, msgY);
    this.nameText.setFontSize(Math.round(fs * 0.95)).setPosition(nameX + nameW / 2, msgY);

    this.msgBox.setSize(msgW, msgH).setPosition(msgX, msgY);
    const tpad = fs * 0.9;
    this.msgText.setFontSize(fs).setPosition(msgX + tpad, msgY + tpad + nameH * 0.4).setWordWrapWidth(msgW - tpad * 2);
    this.measure.setFontSize(fs).setWordWrapWidth(msgW - tpad * 2);
    this.more.setFontSize(fs).setPosition(msgX + msgW - tpad, msgY + msgH - tpad * 0.5);

    const inY = sy0 + sh - pad - inputH;
    this.inputBox.setSize(msgW, inputH).setPosition(msgX, inY);
    if (this.inputEl) this.positionInput(msgX, inY, msgW, inputH);
  };

  /** Height budget for one page of Cato's message (box minus paddings + name overlap). */
  private msgFitH(): number { return this.msgBox.height - this.fs * 2.6 - this.fs * 0.4; }
  private fits(s: string): boolean { this.measure.setText(s); return this.measure.height <= this.msgFitH(); }

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
    if (this.pageIdx < this.pages.length - 1) this.more.setVisible(true); // more pages → ▼ prompt
    else this.onLineDone?.();                                            // last page → let the player reply
  }

  /** Click / tap / Space: reveal the rest of the page, else go to the next page. */
  private advance(): void {
    if (this.busy) return;
    if (this.typing) { // finish typing this page instantly
      this.typeTimer?.remove(); this.typing = false;
      this.msgText.setText(this.pages[this.pageIdx] ?? '');
      this.onPageShown();
      return;
    }
    if (this.pageIdx < this.pages.length - 1) { this.pageIdx++; this.typePage(); }
  }

  // ── Player input (HTML overlay inside the input box) ─────────────────────
  private makeInput(): void {
    if (this.inputEl || this.busy) return;
    this.inputBox.setVisible(true);
    const el = document.createElement('input');
    el.type = 'text'; el.maxLength = 120;
    el.placeholder = getLang() === 'zh-CN' ? '回复 Cato…（回车发送）' : 'Reply to Cato… (Enter)';
    el.style.cssText = 'position:fixed;z-index:30;border:none;outline:none;background:transparent;color:#fff8e8;font-family:inherit;';
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
    el.style.width = `${(inW - pad * 2) * scaleX}px`;
    el.style.height = `${inH * scaleY}px`;
    el.style.fontSize = `${Math.round(this.fs * scaleY)}px`;
  }

  private removeInput(): void { this.inputEl?.remove(); this.inputEl = undefined; this.inputBox?.setVisible(false); }

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
      if (accepted) startTransition(this, 'GameScene', { sceneId: 'main' }, { effect: 'dissolve' }); // → the arrival cinematic
      else startTransition(this, 'BootMenuScene', {}, { effect: 'dissolve' });
    };
    this.showLine(tr(accepted ? ACCEPT : DECLINE), () => this.time.delayedCall(1100, go)); // after the closing line reads
    this.time.delayedCall(8000, go); // safety: never strand the player on the laptop
  }
}
