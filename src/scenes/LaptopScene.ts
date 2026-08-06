import Phaser from 'phaser';
import { dialogFont } from '../i18n';
import { getLang } from '../i18n';
import { startTransition } from '../transition';
import { crossToBgm } from '../bgm';

/**
 * COLD-OPEN "message from Cato" scene. After the player clicks Play on a NEW game, a
 * laptop fills the screen and Cato messages the player — asking them to come to Catopia
 * and help look after the island (he's a small spirit, can't do much alone, and wants to
 * explore). The player can chat with him; when they AGREE, we transition into the game
 * (which plays the arrival cinematic); if they DECLINE, back to the title.
 *
 * P1 SKELETON: a self-contained typewriter chat (Cato line + an HTML input) inside the
 * laptop's screen, with the ONE fixed opening line + PLACEHOLDER canned replies and a
 * keyword accept/decline. P2 swaps the canned replies for the runtime-AI npc (u.ai.npc)
 * with a recruiting persona + accept_help / decline_help actions.
 */

// The cream screen region inside blue-laptop.png, as fractions of the laptop image.
const SCREEN = { x0: 0.155, y0: 0.06, x1: 0.845, y1: 0.57 };
const LAPTOP_KEY = 'blue-laptop';
const INK = '#3a2a1a';
const CATO_INK = '#2f5d7c';
const TYPE_MS = 32;

// Placeholder (P1) — replaced by AI in P2.
const OPENING = {
  en: "Hi... is this thing on? Oh! Hello! I'm Cato, the little spirit of Catopia. I'm reaching out because... well, I could really use your help looking after our island. I can't do much on my own. Would you come help me?",
  'zh-CN': '嗨……这个能收到吗？哦！你好呀！我是 Cato，Catopia 小岛的精灵。我冒昧联系你，是因为……我一个人实在照看不过来这座岛，好想有人能来帮帮我。你愿意来 Catopia 和我一起吗？',
};
const ACCEPT = { en: "Really?! Thank you so much — I'll be waiting for you on the island! 💛", 'zh-CN': '真的吗？！太谢谢你了——我在小岛上等你！💛' };
const DECLINE = { en: "Oh... that's alright. I'll go ask around, then. Take care!", 'zh-CN': '这样啊……没关系的。那我再去问问别人吧。你也保重！' };
const FILLER = { en: "I'm only a little spirit, so I don't know much yet — but I'd love to find out together in Catopia! So... will you come?", 'zh-CN': '我只是个小精灵，懂的还不多——不过好想和你一起在 Catopia 里探索呀！所以……你会来吗？' };

const tr = (m: { en: string; 'zh-CN': string }): string => (getLang() === 'zh-CN' ? m['zh-CN'] : m.en);

export class LaptopScene extends Phaser.Scene {
  private laptop!: Phaser.GameObjects.Image;
  private catoLabel!: Phaser.GameObjects.Text;
  private catoText!: Phaser.GameObjects.Text;
  private hint!: Phaser.GameObjects.Text;
  private inputEl?: HTMLInputElement;
  private full = '';
  private idx = 0;
  private typing = false;
  private typeTimer?: Phaser.Time.TimerEvent;
  private busy = false; // mid-transition (accept/decline) → ignore input

  constructor() { super({ key: 'LaptopScene' }); }

  create(): void {
    const W = this.scale.width, H = this.scale.height;
    crossToBgm(this, 'bgm-title', ['bgm'], 500); // keep the calm title track under the message

    this.add.rectangle(0, 0, W, H, 0x14212e, 1).setOrigin(0, 0); // dark backdrop → laptop pops
    this.laptop = this.add.image(0, 0, LAPTOP_KEY).setOrigin(0.5);

    this.catoLabel = this.add.text(0, 0, 'Cato', { fontFamily: dialogFont(), color: CATO_INK, fontStyle: 'bold' }).setOrigin(0, 0.5);
    this.catoText = this.add.text(0, 0, '', { fontFamily: dialogFont(), color: INK }).setOrigin(0, 0);
    this.hint = this.add.text(0, 0, '', { fontFamily: dialogFont(), color: '#8a7a5a' }).setOrigin(0.5, 1).setAlpha(0.8);

    this.layout();
    this.scale.on(Phaser.Scale.Events.RESIZE, this.layout, this);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.scale.off(Phaser.Scale.Events.RESIZE, this.layout, this);
      this.removeInput();
    });

    // Cato's opening line types out; then the input appears for the player to reply.
    this.showCato(tr(OPENING), () => this.makeInput());
  }

  /** Position the laptop + chat inside its screen region (recomputed on resize). */
  private layout = (): void => {
    const W = this.scale.width, H = this.scale.height;
    const tex = this.textures.get(LAPTOP_KEY).getSourceImage();
    const iw = tex.width, ih = tex.height;
    const s = Math.min((W * 0.94) / iw, (H * 0.94) / ih);
    this.laptop.setScale(s).setPosition(W / 2, H / 2);
    // Screen rect in world px.
    const lx = W / 2 - (iw * s) / 2, ly = H / 2 - (ih * s) / 2;
    const sx0 = lx + SCREEN.x0 * iw * s, sy0 = ly + SCREEN.y0 * ih * s;
    const sw = (SCREEN.x1 - SCREEN.x0) * iw * s, sh = (SCREEN.y1 - SCREEN.y0) * ih * s;
    const pad = sw * 0.04;
    const fs = Math.max(13, Math.round(sh * 0.075));
    this.catoLabel.setFontSize(fs).setPosition(sx0 + pad, sy0 + pad + fs * 0.5);
    this.catoText.setFontSize(fs).setPosition(sx0 + pad, sy0 + pad + fs * 1.4).setWordWrapWidth(sw - pad * 2);
    this.hint.setFontSize(Math.round(fs * 0.8)).setPosition(sx0 + sw / 2, sy0 + sh - pad * 0.4);
    if (this.inputEl) this.positionInput(sx0, sy0, sw, sh, pad, fs);
  };

  /** Type out a Cato line char-by-char, then call `done`. */
  private showCato(text: string, done?: () => void): void {
    this.typeTimer?.remove();
    this.full = text; this.idx = 0; this.typing = true;
    this.catoText.setText('');
    this.typeTimer = this.time.addEvent({
      delay: TYPE_MS, loop: true, callback: () => {
        if (this.idx >= this.full.length) { this.typing = false; this.typeTimer?.remove(); done?.(); return; }
        this.idx++; this.catoText.setText(this.full.slice(0, this.idx));
      },
    });
  }

  // ── Player input (HTML overlay over the laptop screen) ───────────────────
  private makeInput(): void {
    if (this.inputEl || this.busy) return;
    const el = document.createElement('input');
    el.type = 'text';
    el.maxLength = 120;
    el.placeholder = getLang() === 'zh-CN' ? '回复 Cato…（回车发送）' : 'Reply to Cato… (Enter)';
    el.style.cssText = 'position:fixed;z-index:30;border:none;outline:none;border-radius:8px;padding:0 12px;background:#fffdf5;color:#3a2a1a;box-shadow:0 2px 0 #cdbf9a inset;font-family:inherit;';
    (this.game.canvas.parentElement ?? document.body).appendChild(el);
    el.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); this.onSend(el.value.trim()); } });
    this.inputEl = el;
    this.layout();
    setTimeout(() => el.focus(), 50);
    this.hint.setText(getLang() === 'zh-CN' ? '和 Cato 聊聊，或者直接答应他' : "Chat with Cato — or just say yes");
  }

  private positionInput(sx0: number, sy0: number, sw: number, sh: number, pad: number, fs: number): void {
    const el = this.inputEl!;
    const rect = this.game.canvas.getBoundingClientRect();
    const scaleX = rect.width / this.scale.width, scaleY = rect.height / this.scale.height;
    const h = fs * 2.0;
    el.style.left = `${rect.left + (sx0 + pad) * scaleX}px`;
    el.style.top = `${rect.top + (sy0 + sh - pad - h) * scaleY}px`;
    el.style.width = `${(sw - pad * 2) * scaleX}px`;
    el.style.height = `${h * scaleY}px`;
    el.style.fontSize = `${Math.round(fs * scaleY)}px`;
  }

  private removeInput(): void { this.inputEl?.remove(); this.inputEl = undefined; }

  /** Player pressed Enter. P1: keyword accept/decline, else a placeholder line. */
  private onSend(text: string): void {
    if (this.busy || this.typing || !text) return;
    if (this.inputEl) this.inputEl.value = '';
    const t = text.toLowerCase();
    const yes = /(愿意|好的|好呀|好啊|我来|帮|当然|可以|答应|yes|sure|ok|okay|i will|i'?ll help|help you|of course)/.test(t) || t === '好' || t === '来';
    const no = /(不愿意|不想|拒绝|算了|不去|不行|no thanks|no\b|nope|not really|decline)/.test(t);
    if (yes) { this.finish(true); return; }
    if (no) { this.finish(false); return; }
    this.removeInput();
    this.showCato(tr(FILLER), () => this.makeInput()); // placeholder — AI replies here in P2
  }

  /** Accept → into the game (plays the arrival cinematic). Decline → back to the title. */
  private finish(accepted: boolean): void {
    if (this.busy) return;
    this.busy = true;
    this.removeInput();
    this.hint.setText('');
    if (accepted) { try { localStorage.setItem('catopia:laptopDone', '1'); } catch { /* no storage */ } }
    this.showCato(tr(accepted ? ACCEPT : DECLINE), () => {
      this.time.delayedCall(1100, () => {
        if (accepted) startTransition(this, 'GameScene', { sceneId: 'main' }, { effect: 'dissolve' });
        else startTransition(this, 'BootMenuScene', {}, { effect: 'dissolve' });
      });
    });
  }
}
