import Phaser from 'phaser';
import { Umicat, type Npc } from '@umicat/phaser-sdk';
import { dialogFont, getLang, initLang } from '../i18n';
import { startTransition, finishTransition } from '../transition';
import { crossToBgm } from '../bgm';
import { playSfx, SFX_CONFIRM, SFX_DROP, SFX_TYPE } from '../sfx';
import { WP_FILL, buildIconPattern, driftIconLayer } from '../iconWallpaper';

/**
 * COLD-OPEN "message from Cato" scene. After the player clicks Play on a NEW game, a
 * laptop fills the screen showing a chat with Cato: a cat who lives on an island in Catopia
 * and invites the player to come live there WITH him — two friends, as equals, building up
 * the island and exploring the world together. The player chats back; when they AGREE, we
 * transition into the game (which plays the arrival cinematic); if they DECLINE, back to the title.
 *
 * Interaction is the SAME as talking to Cato in the world: ONE flat dialogue panel shows
 * his current line with the RPG typewriter, and if a line is long it PAGINATES — click /
 * tap / Space reveals the rest or advances to the next page (no scrolling log). The input
 * sits below. Styled flat/soft (not the game's wooden box) so it reads as software on the
 * cream laptop screen (which already frames it).
 *
 * The opening line is ONE fixed (i18n) message; every reply after that is the runtime-AI
 * npc (`u.ai.npc`) — a recruiting-Cato persona that answers questions about Catopia and
 * decides, via the `accept_help` / `decline_help` actions, when the player has actually
 * agreed or declined. If the SDK can't init (offline / raw standalone preview with no AI)
 * we fall back to a simple keyword accept/decline so the cold-open is never a dead end.
 */

const SCREEN = { x0: 0.155, y0: 0.06, x1: 0.845, y1: 0.57 }; // cream screen inside blue-laptop.png
const LAPTOP = 'blue-laptop';
const PANEL_FILL = 0xffffff, PANEL_LINE = 0xcdd8e6, PANEL_TEXT = '#26384a';
const NAME_COLOR = '#1f3a55';
const CATO_ICON = 20; // emoji_spritesheet `cato-idle` (0,64) → 32px-grid frame 2*10+0
// The cream + drifting-icon wallpaper is the shared `iconWallpaper` (also the game's
// loading screen) — see WP_FILL / buildIconPattern / driftIconLayer.
const SEND_ICON = 49; // all_icons `play-white` (16,48) → 16px-grid frame 3*16+1
const SEND_TINT = 0x5a8a6a; // send-arrow colour (tint the white icon)
const MSG_ICON = 245; // all_icons `white-message-with-border` (80,240) → frame 15*16+5
const NOTIF_TINT = 0x4a90c8; // "new message" bell/icon colour
const NEW_MSG = { en: 'You have a new message', 'zh-CN': '你有一条新消息' };
const TYPE_MS = 34;

/** Cato's fixed opening line. Greets the player BY NAME when the host provides one
 *  (`{name}`), else a neutral greeting. */
const opening = (name: string): string => {
  const n = name.trim();
  return getLang() === 'zh-CN'
    ? `你好${n ? '，' + n : '呀'}！最近过得好吗？我叫 Cato，住在 Catopia 的一座小岛上。我在想呀——你愿不愿意来这儿和我一起生活？我们可以一起种地、把这座小岛变得越来越好，甚至一起揭开 Catopia 所有的秘密。在你决定要不要来之前，关于 Catopia 的任何问题，只要我知道，我都很乐意回答你哦！`
    : `Hi${n ? ' ' + n : ' there'}! How are you? My name is Cato, and I live on a little island here in Catopia. I was wondering — would you like to come and live here with me? We could farm together, make this island even lovelier, and maybe even uncover all the mysteries of Catopia. And before you decide, I'd be happy to answer anything you'd like to know about it!`;
};
// Sign-off fallbacks — used only when the AI is offline or returns the accept/decline
// action with no words of its own (normally Cato writes his own closing line).
const ACCEPT = { en: "Really?! Thank you so much — I'll be waiting for you on the island! 💛", 'zh-CN': '真的吗？！太谢谢你了——我在小岛上等你！💛' };
const DECLINE = { en: "Oh... that's alright, I understand. If you ever change your mind, just message me — I'll be right here. Take care! 🐾", 'zh-CN': '这样啊……没关系的，我明白。要是你哪天改变主意了，随时来找我就好——我一直都在。你也保重呀！🐾' };
const FILLER = { en: "I haven't seen everything out there yet either — but I'd love to find out together in Catopia! So... will you come?", 'zh-CN': '外面的世界我也还没都见过呢——不过好想和你一起在 Catopia 里探索呀！所以……你会来吗？' };

// In-fiction fallbacks when the AI can't answer (anonymous / out of credits / hiccup).
const SIGNIN_MSG = { en: "Oh — it looks like we haven't quite met yet! Could you sign in first? Then we can really talk. 🐾", 'zh-CN': '哦——好像我们还没正式认识呢！你能先登录一下吗？这样我们才能好好聊聊。🐾' };
const NOCREDITS_MSG = { en: "I think I'm out of little sparks to chat with for now… but I really do hope you'll come. Will you?", 'zh-CN': '我聊天的小火花好像用完了……不过我真的很希望你能来。你愿意吗？' };
const UNAVAILABLE_MSG = { en: 'Hmm, my words got a little tangled just now — could you say that again?', 'zh-CN': '嗯……我刚刚有点语无伦次，你能再说一遍吗？' };

const tr = (m: { en: string; 'zh-CN': string }): string => (getLang() === 'zh-CN' ? m['zh-CN'] : m.en);

export class LaptopScene extends Phaser.Scene {
  private laptop!: Phaser.GameObjects.Image;
  private laptopShadow!: Phaser.GameObjects.Image; // drop shadow behind the laptop
  private bgRect!: Phaser.GameObjects.Rectangle;      // cream wallpaper
  private bgLayer!: Phaser.GameObjects.Container;     // drifting icon pattern behind the laptop
  private bgPeriod = 100; private bgW = 0; private bgH = 0;
  private panelG!: Phaser.GameObjects.Graphics; // the single flat message box
  private catoIcon?: Phaser.GameObjects.Image;  // cato-idle, top-left INSIDE the box
  private nameText!: Phaser.GameObjects.Text;   // "Cato", beside the icon
  private msgAreaH = 10;                         // message-text height budget (box minus the header row)
  private msgText!: Phaser.GameObjects.Text;
  private measure!: Phaser.GameObjects.Text;    // hidden — pagination height probe
  private more!: Phaser.GameObjects.Text;       // ▼ "more" prompt
  private pillG!: Phaser.GameObjects.Graphics;
  private sendBtn!: Phaser.GameObjects.Image;
  private inputEl?: HTMLInputElement;

  // "You have a new message" teaser (shown first; click opens the chat)
  private notif?: Phaser.GameObjects.Container;
  private notifG!: Phaser.GameObjects.Graphics;
  private notifIcon!: Phaser.GameObjects.Image;
  private notifText!: Phaser.GameObjects.Text;
  private notifying = false;
  private breatheTween?: Phaser.Tweens.Tween;

  // typewriter + pagination state
  private pages: string[] = [];
  private pageIdx = 0;
  private charIdx = 0;
  private typing = false;
  private typeTimer?: Phaser.Time.TimerEvent;
  private onLineDone?: () => void;
  private busy = false;

  // Runtime AI — the recruiting-Cato npc that drives every reply after the opening line.
  private recruiter?: Npc;
  private playerName = ''; // host-provided display name, for a personalised greeting
  private aiThinking = false;      // a say() is in flight (input hidden, taps ignored)
  private thinkTimer?: Phaser.Time.TimerEvent; // animated "…" while waiting

  private panelH = 10; private fs = 16; // set in layout()

  constructor() { super({ key: 'LaptopScene' }); }

  create(): void {
    // Phaser REUSES the scene instance across restarts (title → laptop → decline →
    // title → Play → laptop again). Reset every per-run field, or a declined run leaves
    // busy=true and the reopened chat can't be advanced (stuck on page 1). Also start a
    // FRESH conversation (drop the old recruiter + its history — initRecruiter rebuilds it).
    this.busy = false;
    this.aiThinking = false;
    this.typing = false;
    this.notifying = false; // set true once the teaser is built below
    this.pages = []; this.pageIdx = 0; this.charIdx = 0;
    this.onLineDone = undefined;
    this.recruiter = undefined;
    this.bgW = 0; this.bgH = 0; // force the (recreated, empty) wallpaper layer to rebuild
    this.removeInput();

    const W = this.scale.width, H = this.scale.height;
    crossToBgm(this, 'bgm-title', ['bgm'], 500);
    this.bgRect = this.add.rectangle(0, 0, W, H, WP_FILL, 1).setOrigin(0, 0);
    this.bgLayer = this.add.container(0, 0); // drifting icon wallpaper (behind the laptop)
    // Soft DROP SHADOW: a dark, down-right-offset copy of the laptop behind it, so it lifts
    // off the green wallpaper. Tracks the laptop's position/scale/alpha in update().
    this.laptopShadow = this.add.image(0, 0, LAPTOP).setOrigin(0.5).setTint(0x203020).setVisible(false);
    this.laptop = this.add.image(0, 0, LAPTOP).setOrigin(0.5);

    this.panelG = this.add.graphics();
    if (this.textures.exists('emoji')) this.catoIcon = this.add.image(0, 0, 'emoji', CATO_ICON).setOrigin(0.5); // cato-idle
    this.nameText = this.add.text(0, 0, 'Cato', { fontFamily: dialogFont(), color: NAME_COLOR, fontStyle: 'bold' }).setOrigin(0, 0.5);
    this.msgText = this.add.text(0, 0, '', { fontFamily: dialogFont(), color: PANEL_TEXT }).setOrigin(0, 0);
    this.measure = this.add.text(-9999, 0, '', { fontFamily: dialogFont() }).setVisible(false);
    this.more = this.add.text(0, 0, '▼', { fontFamily: dialogFont(), color: '#9bb0c4' }).setOrigin(0.5, 1).setVisible(false);

    this.pillG = this.add.graphics();
    this.sendBtn = this.add.image(0, 0, 'ui-icons', SEND_ICON).setOrigin(0.5).setTint(SEND_TINT).setInteractive({ useHandCursor: true });
    this.sendBtn.on('pointerdown', () => { if (this.inputEl) this.onSend(this.inputEl.value.trim()); });

    // Hide the chat until the "new message" teaser is opened.
    for (const o of [this.panelG, this.catoIcon, this.nameText, this.msgText, this.pillG, this.sendBtn]) o?.setVisible(false);
    this.notif = this.add.container(0, 0);
    this.notifG = this.add.graphics();
    this.notifIcon = this.add.image(0, 0, 'ui-icons', MSG_ICON).setOrigin(0.5).setTint(NOTIF_TINT);
    this.notifText = this.add.text(0, 0, tr(NEW_MSG), { fontFamily: dialogFont(), color: PANEL_TEXT }).setOrigin(0, 0.5);
    this.notif.add([this.notifG, this.notifIcon, this.notifText]);
    this.notif.setScale(0.5).setAlpha(0); // hidden until the laptop has animated in

    this.layout();
    this.scale.on(Phaser.Scale.Events.RESIZE, this.layout, this);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.scale.off(Phaser.Scale.Events.RESIZE, this.layout, this);
      this.thinkTimer?.remove();
      this.removeInput();
    });

    // While the teaser is up, a click opens it; afterwards a click advances the text.
    this.input.on('pointerdown', () => (this.notifying ? this.dismissNotification() : this.advance()));
    this.input.keyboard?.on('keydown-SPACE', () => (this.notifying ? this.dismissNotification() : this.advance()));

    this.laptop.setVisible(false); // the wipe reveals the empty desk; the laptop rises in next
    this.initRecruiter(); // spin up the AI while the teaser + opening line play out
    // Sequence: the paw wipe finishes revealing the (empty) desk → the laptop ANIMATES
    // onto it → then the "new message" teaser pops in. (Fallback: no transition → the
    // callback runs immediately, so the laptop still animates in.)
    finishTransition(this, () => this.enterLaptop());
  }

  /** After the wipe reveals the desk, the laptop rises + pops onto it; once it settles,
   *  the "new message" teaser arrives. */
  private enterLaptop(): void {
    const rx = this.laptop.x, ry = this.laptop.y, rs = this.laptop.scaleX;
    const drop = this.scale.height * 0.14;
    this.laptop.setVisible(true).setAlpha(0).setScale(rs * 0.78).setPosition(rx, ry + drop);
    this.tweens.add({
      targets: this.laptop,
      y: ry, scaleX: rs, scaleY: rs, alpha: 1,
      duration: 520, ease: 'Back.easeOut',
      onComplete: () => this.time.delayedCall(280, () => this.popNotifIn()),
    });
  }

  /** Build the recruiting-Cato npc (fire-and-forget). Ready well before the player
   *  finishes reading the opening line and types a reply; if init fails we simply fall
   *  back to the keyword accept/decline in `onSend`. */
  private initRecruiter(): void {
    void Umicat.init({})
      .then((u) => {
        initLang(u?.locale); // match the platform-provided player language
        const name = u?.user?.name?.trim();
        this.playerName = name ?? ''; // greet the player by name in the opening line
        this.notifText.setText(tr(NEW_MSG)); // in case locale changed after first draw
        if (this.inputEl) this.inputEl.placeholder = getLang() === 'zh-CN' ? '输入消息…' : 'Message…';
        this.recruiter = u?.ai.npc({
          role:
            'You are Cato, a small, curious, warm-hearted cat who lives on a tiny island in Catopia — a cozy place that would really come alive with a friend around. You are messaging a stranger (the player) through a laptop chat app because you want to invite them to come to Catopia and live there WITH you: two friends, side by side, building up the little island, farming, and exploring the world together. This is a friendship between EQUALS — you are NOT looking for an owner, a boss, a trainer, or a protector, and they would not be your keeper; you just want a friend to share the island and the adventure with. You are earnest, warm, a touch shy, and hopeful.' +
            (name ? ` The person you are messaging is called ${name}.` : ''),
          style: "warm, whimsical, gentle; 1-3 short sentences, like casual chat messages; reply in the player's language",
          rules: [
            ...(name ? [`Address the player by their name, "${name}", when it feels natural.`] : []),
            'Your ONE goal every turn is to get an answer to a single question: "Will you come to Catopia and build this little island with me?" No matter what the player says, ALWAYS gently bring the conversation back to that question and END your reply with it (or a warm variation of it). Never let the topic drift away for more than one short reply.',
            'Players will very often reply with random, silly, off-topic, rude, or testing messages (gibberish, jokes, "who are you", one-word replies, unrelated questions). Do NOT get derailed, argue, or go down a rabbit hole. Acknowledge it briefly and warmly in ONE short line, then pivot straight back to asking whether they will come.',
            'Answer honestly about Catopia when asked: it is a cozy farming / nurturing island — together you plant and harvest crops, grow fruit trees and berry bushes, forage mushrooms and flowers, mine stones, and build the place up. You are Cato, a cat who lives there, and it is much more fun with a friend than on your own. Keep the answer short, then circle back to the invitation.',
            "If asked about something you are not sure Catopia has yet but that is RELATED (some feature or activity), do NOT over-promise — say you have not seen everything out there yet and are still figuring the island out, but you would love to find out together — then ask again if they will come.",
            'If asked about something clearly UNRELATED to Catopia or to the invitation (real-world facts, coding, math, etc.), gently say you do not really know about that — you are just a cat living on a quiet little island — and bring it right back to the invitation.',
            'Stay patient, kind, and hopeful, never pushy or annoyed, even if the player keeps dodging. Vary how you phrase the invitation so it does not feel like a broken record.',
            'When the player clearly AGREES to come (yes, sure, ok, I am in, I will join you, etc.), call the accept_help action AND write your OWN happy sign-off: thank them warmly and say you will be waiting for them on the island / see you there. This is your LAST message and it is complete on its own — do NOT ask another question, and do NOT expect a further reply.',
            'When the player clearly REFUSES / declines (no, not interested, maybe later, I cannot), call the decline_help action AND write your OWN gentle sign-off: say that is okay and you understand, that it is a little sad but you get it, and that if they ever change their mind they can reach out / message you anytime. This is your LAST message and it is complete on its own — do NOT ask another question.',
            'Only call accept_help or decline_help once the player has actually made that choice. Random / off-topic / joking messages are NOT a yes or a no — while they are just messing around, asking questions, or thinking it over, keep chatting and do NOT call either action.',
          ],
          actions: [
            { name: 'accept_help', description: 'The player has agreed to come to Catopia and live / build the island with you. Call this the moment they clearly say yes / agree / accept the invitation.' },
            { name: 'decline_help', description: 'The player has declined the invitation (not now / not interested / cannot). Call this when they clearly refuse.' },
          ],
        });
      })
      .catch(() => { /* no SDK / offline → onSend keyword fallback */ });
  }

  private popNotifIn(): void {
    if (!this.notif) return;
    this.notifying = true; // teaser is now on screen → a click dismisses it (opens the chat)
    playSfx(this, SFX_CONFIRM); // "new message" arrival chime
    this.tweens.add({ targets: this.notif, scaleX: 1, scaleY: 1, alpha: 1, duration: 360, ease: 'Back.easeOut', onComplete: () => this.startBreathe() });
  }

  /** Fill the wallpaper layer with a tiled grey icon pattern (heart/sprout/star), one
   *  per grid cell chosen by (col+row)%4 — a diagonal repeat with a 4-tile period so the
   *  drift can wrap SEAMLESSLY. Rebuilt only when the canvas size changes. */
  private buildPattern(W: number, H: number): void {
    this.bgPeriod = buildIconPattern(this, this.bgLayer, W, H);
  }

  /** Drift the wallpaper diagonally up-right, wrapping by one pattern period (seamless). */
  update(_time: number, delta: number): void {
    if (this.bgLayer) driftIconLayer(this.bgLayer, delta, this.bgPeriod);
    // Drop shadow tracks the laptop (position/scale/alpha) with a down-right offset, so it
    // rises + fades in with the entrance and sits behind the laptop at rest.
    if (this.laptop && this.laptopShadow) {
      const off = this.laptop.displayWidth * 0.012;
      this.laptopShadow.setVisible(this.laptop.visible).setScale(this.laptop.scaleX)
        .setPosition(this.laptop.x + off, this.laptop.y + off * 1.5)
        .setAlpha(this.laptop.alpha * 0.24);
    }
  }

  // ── Layout ────────────────────────────────────────────────────────────────
  private layout = (): void => {
    const W = this.scale.width, H = this.scale.height;
    const tex = this.textures.get(LAPTOP).getSourceImage();
    const iw = tex.width, ih = tex.height;
    this.bgRect.setSize(W, H);
    if (W !== this.bgW || H !== this.bgH) { this.bgW = W; this.bgH = H; this.buildPattern(W, H); } // rebuild only on a real resize
    const s = Math.min((W * 0.94) / iw, (H * 0.94) / ih);
    this.laptop.setScale(s).setPosition(W / 2, H / 2);
    const lx = W / 2 - (iw * s) / 2, ly = H / 2 - (ih * s) / 2;
    const sx0 = lx + SCREEN.x0 * iw * s, sy0 = ly + SCREEN.y0 * ih * s;
    const sw = (SCREEN.x1 - SCREEN.x0) * iw * s, sh = (SCREEN.y1 - SCREEN.y0) * ih * s;
    const pad = Math.round(sw * 0.03);
    const fs = Math.max(11, Math.round(sh * 0.078)); this.fs = fs;
    const inputH = fs * 2.4, gap = fs * 0.5;

    // Single flat message panel — fills the screen (no external header); the Cato icon +
    // name live INSIDE it, top-left, and the message flows below them.
    const px = sx0 + pad, py = sy0 + pad;
    const pw = sw - pad * 2, ph = sy0 + sh - inputH - gap - py; this.panelH = ph;
    this.panelG.clear();
    this.panelG.fillStyle(PANEL_FILL, 0.94).fillRoundedRect(px, py, pw, ph, fs * 0.6);
    this.panelG.lineStyle(Math.max(1, fs * 0.08), PANEL_LINE, 1).strokeRoundedRect(px, py, pw, ph, fs * 0.6);
    const tpad = fs * 0.9;
    // Header row inside the box: cato-idle icon + name (fixed when the message updates).
    // Icon a touch smaller, and the row nudged up toward the box top.
    const iconS = fs * 1.7, hrY = py + fs * 0.5 + iconS / 2;
    if (this.catoIcon) this.catoIcon.setDisplaySize(iconS, iconS).setPosition(px + tpad + iconS / 2, hrY);
    this.nameText.setFontSize(Math.round(fs * 1.05)).setPosition(px + tpad + iconS + fs * 0.5, hrY);
    // Message text below the header row.
    const msgY = hrY + iconS / 2 + fs * 0.45;
    // advanced wrap (2nd arg) breaks BETWEEN characters — CJK has no spaces, so plain
    // whitespace wrap let long Chinese runs overflow the panel.
    this.msgText.setFontSize(fs).setPosition(px + tpad, msgY).setWordWrapWidth(pw - tpad * 2, true);
    this.msgAreaH = py + ph - tpad - msgY;
    this.measure.setFontSize(fs).setWordWrapWidth(pw - tpad * 2, true); // must match msgText for pagination height
    this.more.setFontSize(fs).setPosition(px + pw / 2, py + ph - tpad * 0.5);

    // Input box + send button — SAME rounded panel style as Cato's message box.
    const iy = sy0 + sh - inputH, btnR = inputH * 0.44;
    this.pillG.clear();
    this.pillG.fillStyle(PANEL_FILL, 0.94).fillRoundedRect(px, iy, pw, inputH, fs * 0.6);
    this.pillG.lineStyle(Math.max(1, fs * 0.08), PANEL_LINE, 1).strokeRoundedRect(px, iy, pw, inputH, fs * 0.6);
    this.sendBtn.setDisplaySize(inputH * 0.5, inputH * 0.5).setPosition(sx0 + sw - pad - btnR, iy + inputH / 2);
    if (this.inputEl) this.positionInput(px, iy, pw - btnR * 2, inputH);

    // "New message" teaser — a centred pill (icon + text), drawn about its own centre.
    if (this.notif) {
      const nh = fs * 3, iconS = nh * 0.56, npad = fs * 1.1, gap = fs * 0.7;
      this.notifText.setFontSize(Math.round(fs * 1.05));
      const nw = npad + iconS + gap + this.notifText.width + npad;
      this.notifG.clear();
      this.notifG.fillStyle(PANEL_FILL, 0.97).fillRoundedRect(-nw / 2, -nh / 2, nw, nh, nh / 2);
      this.notifG.lineStyle(Math.max(1, fs * 0.09), PANEL_LINE, 1).strokeRoundedRect(-nw / 2, -nh / 2, nw, nh, nh / 2);
      this.notifIcon.setScale(iconS / 16).setPosition(-nw / 2 + npad + iconS / 2, 0);
      this.notifText.setPosition(-nw / 2 + npad + iconS + gap, 0);
      this.notif.setPosition(sx0 + sw / 2, sy0 + sh / 2);
    }
  };

  // ── "New message" teaser ────────────────────────────────────────────────────
  /** Gently pulse the message icon so the player knows to click the teaser. */
  private startBreathe(): void {
    const base = this.notifIcon.scaleX || 1;
    this.breatheTween?.remove();
    this.breatheTween = this.tweens.add({ targets: this.notifIcon, scaleX: base * 1.15, scaleY: base * 1.15, duration: 720, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
  }

  /** Click on the teaser → pop it, shrink it away, then open the chat. */
  private dismissNotification(): void {
    if (!this.notifying || !this.notif) return;
    this.notifying = false;
    this.breatheTween?.remove(); this.breatheTween = undefined;
    const c = this.notif;
    this.tweens.killTweensOf(c); // in case it's still popping/breathing in
    this.tweens.chain({
      targets: c,
      onComplete: () => { c.destroy(); if (this.notif === c) this.notif = undefined; this.revealChat(); },
      tweens: [
        { scaleX: 1.15, scaleY: 1.15, duration: 130, ease: 'Sine.easeOut' },       // pop
        { scaleX: 0, scaleY: 0, alpha: 0, duration: 200, ease: 'Back.easeIn' },     // shrink away
      ],
    });
  }

  /** Show the chat, then (after a beat) Cato's opening line. */
  private revealChat(): void {
    for (const o of [this.panelG, this.catoIcon, this.nameText, this.msgText, this.pillG, this.sendBtn]) o?.setVisible(true);
    this.time.delayedCall(450, () => this.showLine(opening(this.playerName), () => this.makeInput()));
  }

  /** Height budget for one page (box minus the icon/name header row). */
  private msgFitH(): number { return this.msgAreaH; }
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
    this.thinkTimer?.remove();
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
        this.charIdx++;
        const ch = page[this.charIdx - 1];
        if (ch && ch.trim()) playSfx(this, SFX_TYPE); // tick per visible character
        this.msgText.setText(page.slice(0, this.charIdx));
      },
    });
  }

  private onPageShown(): void {
    if (this.pageIdx < this.pages.length - 1) this.more.setVisible(true);
    else this.onLineDone?.();
  }

  private advance(): void {
    if (this.busy || this.aiThinking) return;
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
    if (this.busy || this.typing || this.aiThinking || !text) return;
    playSfx(this, SFX_DROP); // whoosh — the player sent a message
    if (this.inputEl) this.inputEl.value = '';
    if (this.recruiter) this.askRecruiter(text); // AI drives the reply + accept/decline
    else this.offlineReply(text);                // no SDK → keyword fallback
  }

  /** Ask the recruiting-Cato npc. It answers in-character and, when the player has
   *  clearly agreed / declined, calls accept_help / decline_help → finish(). */
  private async askRecruiter(text: string): Promise<void> {
    this.aiThinking = true;
    this.showThinking();
    let r;
    try {
      r = await this.recruiter!.say(text, { observation: {} });
    } catch {
      this.aiThinking = false;
      this.showLine(tr(UNAVAILABLE_MSG), () => this.makeInput());
      return;
    }
    this.aiThinking = false;
    if (this.busy) return; // finished/left mid-flight
    if (!r.ok) { this.onAiUnavailable(r.reason); return; }
    const did = (r.do ?? []).map((d) => d.name);
    const say = (r.say ?? '').trim();
    // Cato's OWN say IS the sign-off (the persona is told how to close). Fall back to a
    // fixed line only if the AI somehow returned the action with no words.
    if (did.includes('accept_help')) { this.showLine(say || tr(ACCEPT), () => this.finish(true)); return; }
    if (did.includes('decline_help')) { this.showLine(say || tr(DECLINE), () => this.finish(false)); return; }
    this.showLine(say || tr(FILLER), () => this.makeInput());
  }

  /** The AI couldn't reply — tell the player in-fiction and keep the chat open. */
  private onAiUnavailable(reason: string): void {
    const msg = reason === 'SIGN_IN_REQUIRED' ? SIGNIN_MSG : reason === 'INSUFFICIENT_CREDITS' ? NOCREDITS_MSG : UNAVAILABLE_MSG;
    this.showLine(tr(msg), () => this.makeInput());
  }

  /** Show an animated "…" in the message box while a say() is in flight. */
  private showThinking(): void {
    this.removeInput();
    this.typeTimer?.remove(); this.typing = false;
    this.thinkTimer?.remove();
    this.more.setVisible(false);
    this.pages = ['']; this.pageIdx = 0;
    let n = 0;
    const tick = (): void => { n = (n % 3) + 1; this.msgText.setText('.'.repeat(n)); };
    tick();
    this.thinkTimer = this.time.addEvent({ delay: 420, loop: true, callback: tick });
  }

  /** Keyword accept/decline — only when the AI isn't available (offline / raw preview). */
  private offlineReply(text: string): void {
    const t = text.toLowerCase();
    const yes = /(愿意|好的|好呀|好啊|我来|帮|当然|可以|答应|yes|sure|ok|okay|i will|i'?ll help|help you|of course)/.test(t) || t === '好' || t === '来';
    const no = /(不愿意|不想|拒绝|算了|不去|不行|no thanks|no\b|nope|not really|decline)/.test(t);
    if (yes) { this.showLine(tr(ACCEPT), () => this.finish(true)); return; } // offline → the fixed sign-off
    if (no) { this.showLine(tr(DECLINE), () => this.finish(false)); return; }
    this.showLine(tr(FILLER), () => this.makeInput());
  }

  /** Wrap up + leave. Cato's OWN reply (accept/decline) is already the closing line — this
   *  just gives a beat to read it, then runs the transition. NO extra hardcoded line here,
   *  or it would double up with what Cato just said. */
  private finish(accepted: boolean): void {
    if (this.busy) return;
    this.busy = true; this.removeInput();
    if (accepted) { try { localStorage.setItem('catopia:laptopDone', '1'); } catch { /* no storage */ } }
    let gone = false;
    const go = (): void => {
      if (gone) return; gone = true;
      if (accepted) startTransition(this, 'GameScene', { sceneId: 'main' }, { effect: 'paw', ms: 1050, color: WP_FILL, loading: true });
      else startTransition(this, 'BootMenuScene', {}, { effect: 'paw', ms: 1050, color: WP_FILL });
    };
    this.time.delayedCall(1400, go); // read Cato's sign-off, then go
    this.time.delayedCall(8000, go); // safety: never strand the player
  }
}
