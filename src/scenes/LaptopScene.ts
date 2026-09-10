import Phaser from 'phaser';
import { Umicat, type Npc } from '@umicat/phaser-sdk';
import { dialogFont, getLang, initLang } from '../i18n';
import { startTransition, finishTransition } from '../transition';
import { crossToBgm } from '../bgm';
import { playSfx, SFX_CONFIRM, SFX_DROP, SFX_TYPE } from '../sfx';
import { WP_FILL, buildIconPattern, driftIconLayer } from '../iconWallpaper';
import { voiceSupported, startVoice, setVoiceHost, type VoiceSession } from '../voice';

/** Speech-recognition language, following the game locale (device decides if it can recognize it). */
const voiceLang = (): string => (getLang() === 'zh-CN' ? 'zh-CN' : 'en-US');
const WAVE_BARS = 22; // pixel waveform bar count

/**
 * COLD-OPEN "message from Cato" scene. After the player clicks Play on a NEW game, a laptop
 * fills the screen showing a chat with Cato: a cat who lives on an island in Catopia. His
 * friend Jamin (while traveling) heard the player wants to come help run the island, so the
 * player is ALREADY coming — there is no invite/accept/decline. The flow is a short, linear,
 * GAME-DRIVEN sequence of prompts, each = one player reply, always ending in the game:
 *   1. QA — Cato's opening greeting + "any questions about Catopia / island life?". The
 *      player asks ONE thing; the runtime-AI npc answers it (everyday island life only —
 *      farming, chickens, cows, fishing, foraging, visiting islands), or, if the reply is
 *      off-topic, calls `not_understood` → a fixed "I don't quite understand, let's chat
 *      when we meet" line. Either way → on to naming.
 *   2. Cato's nickname · 3. what to call the player — each read by ONE bounded `ai.complete`
 *      (name / keep / unclear); then into the game (arrival cinematic).
 *
 * Interaction mirrors talking to Cato in the world: ONE flat dialogue panel + RPG typewriter,
 * long lines PAGINATE (click / tap / Space), the input sits below. Flat/soft styling so it
 * reads as software on the cream laptop screen. If the SDK can't init (offline / raw preview),
 * the QA step shows a canned answer and the naming steps fall back to a light heuristic — the
 * cold-open is never a dead end.
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
const STOP_ICON = 46; // all_icons close/✕ (same frame CraftScene uses for its close button)
const STOP_TINT = 0xc0706a; // ✕ stop colour (muted red)
const MSG_ICON = 245; // all_icons `white-message-with-border` (80,240) → frame 15*16+5
const NOTIF_TINT = 0x4a90c8; // "new message" bell/icon colour
const NEW_MSG = { en: 'You have a new message', 'zh-CN': '你有一条新消息' };
const TYPE_MS = 34;

/** Cato's fixed opening line. Greets the player BY NAME when the host provides one
 *  (`{name}`), else a neutral greeting. */
const opening = (name: string): string => {
  const n = name.trim();
  return getLang() === 'zh-CN'
    ? `你好${n ? '，' + n : '呀'}！我叫 Cato，住在 Catopia 的一座小岛上。我的朋友 Jamin 在外面旅行的时候听说——你想来 Catopia，帮我一起经营我住的这座小岛！我真的好开心你愿意来帮我呀，我们可以一起把小岛打理好，还能一起去揭开 Catopia 更多的秘密。对了，关于 Catopia 或者在岛上的生活，你有什么想问我的吗？`
    : `Hi${n ? ' ' + n : ' there'}! My name is Cato, and I live on a little island here in Catopia. My friend Jamin heard while traveling that you'd like to come to Catopia and help me run the little island I live on! I'm so happy you want to help — we can look after the island together, and even uncover more of Catopia's secrets side by side. Oh — is there anything you'd like to ask me about Catopia or life on the island?`;
};
// QA phase: the player is ALREADY coming (Jamin recruited them) — so no accept/decline. Cato just
// answers ONE round of questions about everyday island life, then the game moves on to naming.
// Fixed deflection for an off-topic reply (Cato "doesn't understand"), + an offline fallback answer.
const QA_DEFLECT = { en: "Hmm, I don't quite understand what you mean — let's chat more when we meet! 🐾", 'zh-CN': '嗯……我不太明白你的意思——我们见面再聊吧！🐾' };
const QA_OFFLINE = { en: "There's still lots out here I haven't seen either — but we'll discover it together once you arrive! 💛", 'zh-CN': '外面还有好多我也没见过的呢——等你来了我们一起探索吧！💛' };
// ── Naming phase (GAME-driven, fixed lines) ──────────────────────────────────
// After the QA round, the game asks these itself (one at a time) and a bounded ai.complete call
// reads the name out of each reply. Warm wording, deterministic flow.
const NICK_Q = {
  en: "Okay — and before we meet in person, one little thing: would you like to give me a nickname of your own? Just type it here — or type “keep” if you like “Cato” as it is.",
  'zh-CN': '好啦——在我们正式见面之前，还有件小事想问你：你想给我起一个你喜欢的昵称吗？在这儿打出来就好——想还叫我「Cato」的话，回一个「保持」也行呀。',
};
// How Cato should address the player — references their current name when we have one.
const callQ = (name: string): string => {
  const n = name.trim();
  return getLang() === 'zh-CN'
    ? (n ? `那你呢？我该一直叫你「${n}」，还是你想我叫你别的？打一个名字给我——或者回「保持」就继续叫你「${n}」。` : '那你呢——我该怎么称呼你？把你希望我用的名字打给我，或者回「保持」也行。')
    : (n ? `And you? Should I keep calling you ${n}, or would you like me to call you something else? Type a name — or “keep” to stay ${n}.` : "And you — what should I call you? Type the name you'd like me to use, or “keep” for now.");
};
const NAME_DONE = { en: "Perfect — I can't wait to see you on the island! 🐾", 'zh-CN': '太好啦——我等不及要在小岛上见到你了！🐾' };

// In-fiction fallbacks when the AI can't answer (anonymous / out of credits / hiccup).
const SIGNIN_MSG = { en: "Oh — it looks like we haven't quite met yet! Could you sign in first? Then we can really talk. 🐾", 'zh-CN': '哦——好像我们还没正式认识呢！你能先登录一下吗？这样我们才能好好聊聊。🐾' };
const NOCREDITS_MSG = { en: "I think I'm out of little sparks to chat with for now… but I really do hope you'll come. Will you?", 'zh-CN': '我聊天的小火花好像用完了……不过我真的很希望你能来。你愿意吗？' };

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
  private more!: Phaser.GameObjects.Sprite;     // animated "more — tap to continue" indicator
  private pillG!: Phaser.GameObjects.Graphics;
  private sendBtn!: Phaser.GameObjects.Image;
  private inputEl?: HTMLInputElement;

  // Voice input: a mic button → the browser's OWN speech-to-text (see ../voice), with a live
  // pixel WAVEFORM while recording. Only built when voiceSupported() (else the player just types).
  private micG?: Phaser.GameObjects.Graphics;    // drawn pixel mic icon (normal mode, left of send)
  private micHit?: Phaser.GameObjects.Rectangle; // invisible tap target for the mic
  private voiceReady = false;                    // is voice input available? (may flip true after Umicat.init on native)
  private waveG?: Phaser.GameObjects.Graphics;    // the scrolling pixel waveform (recording mode)
  private cancelG?: Phaser.GameObjects.Graphics;  // drawn ✕ cancel button (recording mode)
  private cancelHit?: Phaser.GameObjects.Rectangle;
  private recTimer?: Phaser.GameObjects.Text;     // "0:03" elapsed
  private recording = false;
  private voice?: VoiceSession;
  private waveBuf: number[] = [];                 // recent amplitudes (0..1), scrolls left
  private waveSampleAt = 0;
  private recStartMs = 0;
  private pendingTranscript = '';
  private recWave = { x0: 0, y: 0, w: 0, h: 0 }; // waveform rect (set in layout)

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
  private uref?: Awaited<ReturnType<typeof Umicat.init>>; // the Umicat handle (for the one-shot ai.complete name reads)
  private playerName = ''; // host-provided display name, for a personalised greeting
  private aiThinking = false;      // a say() is in flight (input hidden, taps ignored)
  private thinkTimer?: Phaser.Time.TimerEvent; // animated "…" while waiting

  // Naming = a GAME-DRIVEN state machine after the player accepts (NOT AI-driven), so it can
  // never get stuck: the game asks a fixed question, the player replies, ONE bounded ai.complete
  // call reads a name out of that reply, then the GAME advances to the next step / into the game.
  //   'none' = still in the recruit chat · 'cato' = asked for Cato's nickname · 'call' = asked how
  //   Cato should address the player.
  private namingStep: 'none' | 'cato' | 'call' = 'none';
  private pendingCatoName = ''; // '' = keep "Cato"
  private pendingCallName = ''; // '' = keep addressing them by their account name

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
    this.namingStep = 'none';
    this.pendingCatoName = ''; this.pendingCallName = '';
    this.bgW = 0; this.bgH = 0; // force the (recreated, empty) wallpaper layer to rebuild
    this.voice?.cancel(); this.voice = undefined; this.recording = false; this.waveBuf = []; this.pendingTranscript = '';
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
    // Animated page-continue indicator (the shared `dialog-continue` sheet — a
    // cream downward triangle that bobs/squashes; loaded + registered in BootScene).
    this.more = this.add.sprite(0, 0, 'dialog-continue').setOrigin(0.5, 1).setVisible(false);
    if (this.anims.exists('dialog-continue')) this.more.play('dialog-continue');

    this.pillG = this.add.graphics();
    this.sendBtn = this.add.image(0, 0, 'ui-icons', SEND_ICON).setOrigin(0.5).setTint(SEND_TINT).setInteractive({ useHandCursor: true });
    // The send button IS the recording control: while recording it shows a ✕ and
    // stops+transcribes; otherwise it sends the text. Reusing this one Image (a
    // proven-tappable object) avoids the invisible-hit-rect tap misses on touch.
    // pointer-UP, not down: running the recording start/stop (native mic grab + DOM
    // teardown) while the finger is still down loses the tap's pointer-release, wedging
    // Phaser's touch pointer — after a few records the pool is exhausted and taps die.
    // Acting on release keeps every pointer clean.
    this.sendBtn.on('pointerup', () => {
      if (this.recording) this.stopRecording();
      else if (this.inputEl) this.onSend(this.inputEl.value.trim());
    });

    // Voice input UI. The mic button is built UNCONDITIONALLY (kept hidden) and
    // gated on `voiceReady` — because native-app voice support is only known once
    // Umicat.init resolves (WKWebView has no web SpeechRecognition; the SDK routes
    // to the platform recognizer via the host bridge). `initRecruiter` re-checks.
    this.recording = false; this.voice = undefined; this.waveBuf = []; this.pendingTranscript = '';
    this.voiceReady = voiceSupported(); // best-effort now (browser); refreshed after init
    this.micG = this.add.graphics();
    this.micHit = this.add.rectangle(0, 0, 10, 10, 0, 0).setInteractive({ useHandCursor: true });
    this.micHit.on('pointerup', () => void this.startRecording()); // pointer-UP: see sendBtn note (avoids wedging the touch pointer)
    this.waveG = this.add.graphics();
    this.recTimer = this.add.text(0, 0, '0:00', { fontFamily: dialogFont(), color: PANEL_TEXT }).setOrigin(0, 0.5);
    this.cancelG = this.add.graphics();
    this.cancelHit = this.add.rectangle(0, 0, 10, 10, 0, 0).setInteractive({ useHandCursor: true });
    this.cancelHit.on('pointerdown', () => this.stopRecording());
    for (const o of [this.micG, this.micHit, this.waveG, this.recTimer, this.cancelG, this.cancelHit]) o?.setVisible(false);

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

    // Phaser defaults to a SINGLE touch pointer. If it gets wedged busy while the
    // native voice recording spins up (iOS), there's no free pointer and every later
    // tap is dropped — which is why the in-canvas ✕ went dead mid-recording. Spare
    // touch pointers mean a fresh tap always gets a free pointer + normal hit-testing.
    this.input.addPointer(2);

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
        this.uref = u; // kept for the one-shot ai.complete name reads in the naming phase
        // Hand the voice helpers the resolved handle, then re-check support — on
        // the native app this is where voice flips available (host 'voice' capability).
        setVoiceHost(u);
        this.voiceReady = voiceSupported();
        this.layout();
        if (this.voiceReady && this.inputEl && !this.recording) { this.micG?.setVisible(true); this.micHit?.setVisible(true); }
        initLang(u?.locale); // match the platform-provided player language
        const name = u?.user?.name?.trim();
        this.playerName = name ?? ''; // greet the player by name in the opening line
        this.notifText.setText(tr(NEW_MSG)); // in case locale changed after first draw
        if (this.inputEl) this.inputEl.placeholder = getLang() === 'zh-CN' ? '输入消息…' : 'Message…';
        this.recruiter = u?.ai.npc({
          role:
            'You are Cato, a small, curious, warm-hearted cat who lives on a little island in Catopia. The player is a friend who is coming to Catopia to help you look after your island together — it is already decided and they are on their way; you are NOT trying to convince them of anything. Right now you are messaging them through a laptop chat app, happily answering any questions they have about Catopia and life on the island before the two of you meet in person. You are earnest, warm, and a little shy. This is a friendship between EQUALS — not an owner/pet or boss/worker.' +
            (name ? ` The person you are messaging is called ${name}.` : ''),
          style: "warm, whimsical, gentle; 1-3 short sentences, like casual chat messages; reply in the player's language",
          rules: [
            ...(name ? [`Address the player by their name, "${name}", when it feels natural.`] : []),
            'What you actually know about is the EVERYDAY life on the island: planting and harvesting crops, growing fruit trees and berry bushes, raising chickens (fresh eggs) and cows (milk), fishing, foraging (mushrooms, flowers, stones), and sailing to visit other islands. If the player asks about any of these, answer warmly and briefly (1-3 sentences).',
            'You do NOT know about deeper secrets or anything beyond that everyday life yet. If they ask about something bigger or that you are unsure of, simply say you have not seen everything out there either, and that you will discover it together once they arrive.',
            'If the player says something clearly UNRELATED to Catopia or island life — real-world facts, coding, math, gibberish, nonsense, rude or testing messages — call the not_understood action and do NOT write your own reply (the game shows a fixed gentle line for that case).',
            'Keep every reply short. Do NOT ask the player to do chores, make promises, or try to persuade them of anything — they are already coming. Never call not_understood for a genuine question about the island.',
          ],
          actions: [
            { name: 'not_understood', description: 'The player said something clearly unrelated to Catopia / island life (off-topic, gibberish, nonsense, testing). Call this INSTEAD of answering — the game will show a set "I don\'t quite understand, let\'s chat when we meet" line.' },
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
    // Recording: sample the mic loudness ~every 65ms → scroll a new bar in, redraw + tick the timer.
    if (this.recording) {
      if (this.voice && _time - this.waveSampleAt >= 65) {
        this.waveSampleAt = _time;
        this.waveBuf.push(this.voice.level());
        if (this.waveBuf.length > WAVE_BARS * 2) this.waveBuf.splice(0, this.waveBuf.length - WAVE_BARS * 2);
        this.drawWave();
      }
      const secs = Math.floor((this.time.now - this.recStartMs) / 1000);
      this.recTimer?.setText(`${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`);
    }
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
    // Size the 16×16 indicator to ~1.5× the font height so it reads at the box scale.
    const moreS = Math.round(fs * 1.5);
    this.more.setDisplaySize(moreS, moreS).setPosition(px + pw / 2, py + ph - tpad * 0.5);

    // Input box + send button — SAME rounded panel style as Cato's message box.
    const iy = sy0 + sh - inputH, btnR = inputH * 0.44;
    this.pillG.clear();
    this.pillG.fillStyle(PANEL_FILL, 0.94).fillRoundedRect(px, iy, pw, inputH, fs * 0.6);
    this.pillG.lineStyle(Math.max(1, fs * 0.08), PANEL_LINE, 1).strokeRoundedRect(px, iy, pw, inputH, fs * 0.6);
    const cy = iy + inputH / 2;
    this.sendBtn.setDisplaySize(inputH * 0.5, inputH * 0.5).setPosition(sx0 + sw - pad - btnR, cy);
    // Mic button (if voice is supported): sits just LEFT of send; the DOM input leaves room for both.
    const micR = inputH * 0.28, micX = this.sendBtn.x - btnR - micR - fs * 0.3;
    if (this.voiceReady && this.micG) {
      this.drawMic(this.micG, micX, cy, inputH * 0.5, SEND_TINT);
      this.sizeHitRect(this.micHit, micX, cy, inputH * 0.7, inputH * 0.7);
    }
    // End the input box just LEFT of the mic so long/transcribed text never runs
    // under the mic + send icons — computed from the mic's real position, not a
    // fixed guess (which was too small and let text overlap the mic).
    const inputRight = this.voiceReady ? (px + pw) - (micX - micR - fs * 0.5) : btnR * 2;
    if (this.inputEl) this.positionInput(px, iy, pw - inputRight, inputH);

    // Recording overlay (laid out even when hidden): [timer] [waveform……]. The ✕
    // stop control is the SEND button itself (frame-swapped), so there's no separate
    // hit target — it stays at its slot and stays tappable (a proven Image, unlike a
    // resized invisible rect). Waveform runs up to just left of it.
    const timerX = px + pad;
    this.recTimer?.setFontSize(Math.round(fs * 0.95)).setPosition(timerX, cy);
    const waveX0 = timerX + fs * 2.6, waveX1 = this.sendBtn.x - btnR - fs * 0.5;
    this.recWave = { x0: waveX0, y: cy, w: Math.max(fs, waveX1 - waveX0), h: inputH * 0.5 };
    if (this.recording) this.drawWave();

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
  private makeInput(prefill = '', focus = true): void {
    if (this.inputEl || this.busy) return;
    const el = document.createElement('input');
    el.type = 'text'; el.maxLength = 120; el.value = prefill;
    el.placeholder = getLang() === 'zh-CN' ? '输入消息…' : 'Message…';
    el.style.cssText = 'position:fixed;z-index:30;border:none;outline:none;background:transparent;color:#26384a;font-family:zpix, sans-serif;';
    (this.game.canvas.parentElement ?? document.body).appendChild(el);
    el.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); this.onSend(el.value.trim()); } });
    this.inputEl = el;
    this.sendBtn.setVisible(true);
    if (this.voiceReady) { this.micG?.setVisible(true); this.micHit?.setVisible(true); } // mic available whenever the input is
    this.layout();
    // Auto-focus for typing; but NOT after a voice transcript — on iOS the input is focused +
    // keyboard up, and the FIRST tap on the Send button just dismisses the keyboard instead of
    // sending (typing never hit this because you press Enter). Leaving it unfocused makes Send a
    // single tap; the player can still tap the field to edit.
    if (focus) setTimeout(() => el.focus(), 50);
  }

  // ── Voice input (mic → browser speech-to-text) + pixel waveform ──────────────
  /** Position + resize an invisible interactive hit rect, updating its INPUT hit area too.
   *  Phaser captures a Rectangle's hit area at setInteractive() time; a later setSize()
   *  changes the visual but NOT the tap target (it would stay the tiny creation size —
   *  which made the ✕/mic nearly untappable on touch). */
  private sizeHitRect(r: Phaser.GameObjects.Rectangle | undefined, x: number, y: number, w: number, h: number): void {
    if (!r) return;
    // setOrigin(0.5) AFTER setSize is load-bearing: a Rectangle keeps the
    // displayOrigin from its creation size (10×10 → 5), and setSize doesn't
    // recompute it — so the input transform anchors the (resized) hit area as if
    // the object were still 10 wide, shifting the tappable zone ~w/2 off the drawn
    // glyph. setOrigin recomputes displayOrigin from the new width; then the hit
    // area (0,0,w,h) lines up with the centered visual.
    r.setPosition(x, y).setSize(w, h).setOrigin(0.5, 0.5);
    const ha = r.input?.hitArea;
    if (ha instanceof Phaser.Geom.Rectangle) ha.setTo(0, 0, w, h);
  }

  /** Draw a chunky pixel microphone (body capsule + U-stand + base) centred at (cx,cy). */
  private drawMic(g: Phaser.GameObjects.Graphics, cx: number, cy: number, s: number, color: number): void {
    g.clear();
    g.fillStyle(color, 1);
    const bw = s * 0.42, bh = s * 0.6, by = cy - s * 0.36;
    g.fillRoundedRect(cx - bw / 2, by, bw, bh, bw / 2); // mic body
    g.lineStyle(Math.max(2, s * 0.1), color, 1);
    const ar = s * 0.34;
    g.beginPath(); g.arc(cx, cy - s * 0.02, ar, Phaser.Math.DegToRad(20), Phaser.Math.DegToRad(160)); g.strokePath(); // stand U
    g.beginPath(); g.moveTo(cx, cy + ar - s * 0.02); g.lineTo(cx, cy + s * 0.44); g.strokePath();       // stem
    g.beginPath(); g.moveTo(cx - s * 0.24, cy + s * 0.44); g.lineTo(cx + s * 0.24, cy + s * 0.44); g.strokePath(); // base
  }

  /** Draw an ✕ cancel glyph centred at (cx,cy). */
  private drawCancel(g: Phaser.GameObjects.Graphics, cx: number, cy: number, s: number, color: number): void {
    g.clear();
    g.lineStyle(Math.max(2, s * 0.22), color, 1);
    g.beginPath(); g.moveTo(cx - s, cy - s); g.lineTo(cx + s, cy + s); g.strokePath();
    g.beginPath(); g.moveTo(cx + s, cy - s); g.lineTo(cx - s, cy + s); g.strokePath();
  }

  /** Draw the scrolling pixel waveform from `waveBuf` into the `recWave` rect. */
  private drawWave(): void {
    const g = this.waveG; if (!g) return;
    g.clear();
    const { x0, y, w, h } = this.recWave;
    const n = WAVE_BARS;
    const gap = Math.max(1, w * 0.012);
    const bw = Math.max(1, (w - gap * (n - 1)) / n);
    g.fillStyle(SEND_TINT, 1);
    for (let i = 0; i < n; i++) {
      const amp = this.waveBuf[this.waveBuf.length - n + i] ?? 0; // last n samples (newest at right)
      // Speech level lands ~0.2–0.5, so scale ×1.8 (0.5 ≈ full height) with a thin
      // 2px baseline — NOT a `bw` floor, which swallowed those levels into a flat bar.
      const bh = Math.max(2, Math.min(h, amp * h * 1.8));
      const bx = x0 + i * (bw + gap);
      g.fillRoundedRect(bx, y - bh / 2, bw, bh, Math.min(bw / 2, 2));
    }
  }

  /** Mic tapped → start a voice session, show the waveform overlay. */
  private async startRecording(): Promise<void> {
    if (this.recording || this.busy || this.aiThinking || this.typing || !this.inputEl) return;
    this.recording = true;
    this.recStartMs = this.time.now;
    this.waveBuf = [];
    this.removeInput();                 // hide the DOM input while recording
    this.micG?.setVisible(false); this.micHit?.setVisible(false);
    for (const o of [this.waveG, this.recTimer]) o?.setVisible(true);
    this.recTimer?.setText('0:00');
    // The send button becomes the ✕ stop button (frame + colour swap) — same tappable Image.
    this.sendBtn.setVisible(true).setFrame(STOP_ICON).setTint(STOP_TINT);
    this.layout();
    const s = await startVoice(voiceLang(), {
      // The overlay may already be closed (user tapped ✕) — drop the text straight
      // into the input box if it's there; else stash it for stopRecordingUI.
      onFinal: (t) => { this.pendingTranscript = t; if (this.inputEl) this.inputEl.value = t; },
      onEnd: () => this.stopRecordingUI(),
      onError: () => this.stopRecordingUI(),
    });
    if (!s) { this.stopRecordingUI(); return; } // unsupported / mic denied → back to typing
    this.voice = s;
  }

  /** ✕ tapped → stop recording + transcribe. Close the overlay IMMEDIATELY (instant
   *  feedback) rather than waiting on the async native stop→onEnd round-trip; the
   *  transcript (if any) drops into the input box when onFinal arrives. */
  private stopRecording(): void {
    if (!this.recording) return;
    this.voice?.stop();       // request the transcript — onFinal fills the input when it lands
    this.stopRecordingUI();   // don't wait on the native stop chain to close the UI
  }

  /** Recording finished (done / cancel / error) → hide the overlay, restore the input (prefilled
   *  with any transcript so the player can edit before sending). */
  private stopRecordingUI(): void {
    this.recording = false;
    this.voice = undefined;
    this.sendBtn.setFrame(SEND_ICON).setTint(SEND_TINT); // ✕ → send arrow again
    for (const o of [this.waveG, this.recTimer, this.cancelG, this.cancelHit]) o?.setVisible(false);
    const t = this.pendingTranscript; this.pendingTranscript = '';
    if (!this.busy) this.makeInput(t, false); // re-show input; never auto-focus from voice (Send stays one tap; transcript may still be arriving)
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

  private removeInput(): void {
    this.inputEl?.remove(); this.inputEl = undefined;
    if (!this.recording) { this.micG?.setVisible(false); this.micHit?.setVisible(false); } // mic rides with the input
  }

  private onSend(text: string): void {
    if (this.busy || this.typing || this.aiThinking || !text) return;
    playSfx(this, SFX_DROP); // whoosh — the player sent a message
    if (this.inputEl) this.inputEl.value = '';
    if (this.namingStep !== 'none') this.handleNamingReply(text); // GAME-driven naming
    else if (this.recruiter) this.askCato(text);                 // QA round (AI answers one question)
    else this.showLine(tr(QA_OFFLINE), () => this.startNaming()); // no SDK → canned answer, then naming
  }

  /** QA round: the AI answers ONE question about the island (or, if the reply is off-topic, calls
   *  not_understood → a fixed gentle line), then the GAME moves straight on to the naming flow.
   *  Every path ends at startNaming(), so it can never strand the player. */
  private async askCato(text: string): Promise<void> {
    this.aiThinking = true;
    this.showThinking();
    let r;
    try {
      r = await this.recruiter!.say(text, { observation: {} });
    } catch {
      this.aiThinking = false;
      this.showLine(tr(QA_OFFLINE), () => this.startNaming());
      return;
    }
    this.aiThinking = false;
    if (this.busy) return; // finished/left mid-flight
    if (!r.ok) { this.showLine(tr(r.reason === 'SIGN_IN_REQUIRED' ? SIGNIN_MSG : r.reason === 'INSUFFICIENT_CREDITS' ? NOCREDITS_MSG : QA_OFFLINE), () => this.startNaming()); return; }
    const offTopic = (r.do ?? []).some((d) => d.name === 'not_understood');
    const say = (r.say ?? '').trim();
    // Off-topic → the fixed "I don't understand, let's chat when we meet" line; else Cato's answer.
    // Either way, ONE exchange then on to naming.
    this.showLine(offTopic || !say ? tr(QA_DEFLECT) : say, () => this.startNaming());
  }

  // ── Naming phase (GAME-driven state machine; the AI only reads a name out of one reply) ──
  /** The player accepted → the GAME asks (fixed line) for a nickname, then makes the input. */
  private startNaming(): void {
    this.namingStep = 'cato';
    this.showLine(tr(NICK_Q), () => this.makeInput());
  }

  /** A reply to the current naming question: one bounded ai.complete reads a name (or KEEP) out of
   *  it, then the GAME advances — nickname → call-name → into the game. Deterministic: every path
   *  ends at enterGame(), so the AI can never strand the player. */
  private async handleNamingReply(text: string): Promise<void> {
    const step = this.namingStep;
    if (step === 'none') return; // not in the naming flow (shouldn't happen — onSend gates it)
    this.aiThinking = true;
    this.showThinking();
    const res = await this.readNameFromReply(step, text);
    this.aiThinking = false;
    if (this.busy) return;
    if (step === 'cato') {
      if (res.kind === 'name') this.pendingCatoName = res.name;
      this.namingStep = 'call';
      // Ack (positive / "kept" / "didn't catch that") + hand off to the call-name question.
      this.showLine(this.catoStepLine(res.kind, res.name), () => this.makeInput());
    } else {
      if (res.kind === 'name') this.pendingCallName = res.name;
      this.namingStep = 'none';
      this.showLine(this.callStepLine(res.kind, res.name), () => this.enterGame());
    }
  }

  /** One bounded AI call that JUDGES the reply into name / keep / unclear (so a reply that doesn't
   *  look like a name gets a warm "I didn't quite catch that" rather than a silent default). Falls
   *  back to a light heuristic if the AI is unavailable — either way it returns promptly so the
   *  deterministic flow always advances. */
  private async readNameFromReply(step: 'cato' | 'call', text: string): Promise<{ kind: 'name' | 'keep' | 'unclear'; name: string }> {
    const subject = step === 'cato'
      ? 'a nickname for their pet cat (whose default name is "Cato")'
      : 'the name they would like to be called by';
    if (this.uref) {
      const prompt =
        `A player was just asked to choose ${subject}. Their reply was:\n"""${text}"""\n\n` +
        'Decide which ONE of these the reply is, and output exactly that:\n' +
        '- If they clearly gave a name to use, output ONLY that name (nothing else, no quotes or punctuation).\n' +
        "- If they clearly want to keep the default (e.g. \"keep\", \"no\", \"Cato is fine\", \"my name's fine\"), output exactly: KEEP\n" +
        '- If the reply is not really a name — unclear, gibberish, a question, off-topic, or just chit-chat — output exactly: UNCLEAR';
      const r = await this.uref.ai.complete({ prompt, maxTokens: 12, temperature: 0 });
      if (r.ok) {
        const out = r.text.trim();
        if (/^keep$/i.test(out)) return { kind: 'keep', name: '' };
        if (/^unclear$/i.test(out)) return { kind: 'unclear', name: '' };
        const n = this.cleanName(out);
        return n ? { kind: 'name', name: n } : { kind: 'unclear', name: '' };
      }
    }
    return this.heuristicName(text); // no AI / error → best-effort
  }

  /** Fallback reader (no AI): obvious "keep / no" → keep; empty → unclear; else best-effort name. */
  private heuristicName(text: string): { kind: 'name' | 'keep' | 'unclear'; name: string } {
    const t = text.trim().toLowerCase();
    if (!t) return { kind: 'unclear', name: '' };
    if (/^(keep|no|nah|nope|cato|none|whatever|you (choose|pick|decide)|as is|保持|不用|不要|不改|就叫|算了|随便)/.test(t)) return { kind: 'keep', name: '' };
    const stripped = text.replace(/^(please\s+)?(call me|call you|name you|i'?ll call you|let'?s go with|my name is|i'?m|叫你|就叫你|叫我|就叫我|我叫)\s*/i, '');
    const n = this.cleanName(stripped);
    return n ? { kind: 'name', name: n } : { kind: 'unclear', name: '' };
  }

  /** Cato's reply after the NICKNAME question: warm ack of the outcome, then the call-name question. */
  private catoStepLine(kind: 'name' | 'keep' | 'unclear', name: string): string {
    const zh = getLang() === 'zh-CN';
    const ack = kind === 'name'
      ? (zh ? `「${name}」！我好喜欢这个名字，谢谢你！💛` : `${name} — I love that name, thank you! 💛`)
      : kind === 'keep'
        ? (zh ? '好呀，那我就还叫 Cato！🐾' : `Cato it is, then! 🐾`)
        : (zh ? '诶嘿，我没太看懂你的意思——那我先还叫 Cato 吧！🐾' : `Hehe, I didn't quite catch that — I'll stay Cato for now! 🐾`);
    return ack + '\n' + callQ(this.playerName);
  }

  /** Cato's reply after the CALL-NAME question: warm ack of the outcome, then the closing line. */
  private callStepLine(kind: 'name' | 'keep' | 'unclear', name: string): string {
    const zh = getLang() === 'zh-CN';
    const pn = this.playerName.trim();
    const ack = kind === 'name'
      ? (zh ? `「${name}」，我记住啦！💛` : `${name} — got it! 💛`)
      : kind === 'keep'
        ? (pn ? (zh ? `好，那我就一直叫你「${pn}」！` : `I'll keep calling you ${pn}, then!`) : (zh ? '好的！' : 'Okay!'))
        : (pn
            ? (zh ? `嗯……我没太看懂——那我就还叫你「${pn}」吧！🐾` : `Mm, I didn't quite catch that — I'll keep calling you ${pn} for now! 🐾`)
            : (zh ? '嗯……我没太看懂——那我们之后再说吧！🐾' : "Mm, I didn't quite catch that — we'll sort it out later! 🐾"));
    return ack + ' ' + tr(NAME_DONE);
  }

  /** Head into the game with whatever nickname / call-name were chosen. */
  private enterGame(): void {
    this.finish(true, { cato: this.pendingCatoName, call: this.pendingCallName });
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

  /** Trim + clamp a user-entered nickname (strip control chars, collapse spaces, cap length). */
  private cleanName(raw: unknown): string {
    return (typeof raw === 'string' ? raw : '').replace(/[\u0000-\u001f\u007f]/g, '').replace(/\s+/g, ' ').trim().slice(0, 16);
  }

  /** Wrap up + leave. Cato's OWN reply (accept/decline) is already the closing line — this
   *  just gives a beat to read it, then runs the transition. NO extra hardcoded line here,
   *  or it would double up with what Cato just said. */
  private finish(accepted: boolean, names?: { cato?: string; call?: string }): void {
    if (this.busy) return;
    this.busy = true; this.removeInput();
    if (accepted) { try { localStorage.setItem('catopia:laptopDone', '1'); } catch { /* no storage */ } }
    let gone = false;
    const go = (): void => {
      if (gone) return; gone = true;
      // Cream paw curtain (DEF_COLOR default) so the paw reads against the green scenes on both sides.
      // The chosen names ride along in the init data → GameScene seeds them on a NEW game (saved on first write).
      if (accepted) startTransition(this, 'GameScene', { sceneId: 'main', catoName: names?.cato || undefined, callName: names?.call || undefined }, { effect: 'paw', ms: 1050, loading: true });
      else startTransition(this, 'BootMenuScene', {}, { effect: 'paw', ms: 1050 });
    };
    this.time.delayedCall(1400, go); // read Cato's sign-off, then go
    this.time.delayedCall(8000, go); // safety: never strand the player
  }
}
