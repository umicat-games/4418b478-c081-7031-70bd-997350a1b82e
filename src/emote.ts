import Phaser from 'phaser';

// Cato's EMOTE system — a little grey speech bubble that pops up over his head with
// an emoji reacting to what's happening (you harvested! it's night! he finished a
// task!). MOSTLY ALGORITHMIC: game events → an `Emotion` → a random emoji from that
// emotion's set. (A future AI path can show a short text line in the same bubble for
// special moments — see GameScene.maybeAiEmote; not wired yet.)
//
// Assets: `speech-bubble` (42×47 single bubble, tail pointing down) + `emoji` (the
// 32×32 `emoji_spritesheet`, frame = row*10 + col; regions tagged in the Asset Manager).

/** The emoji frame indices per emotion (a random one is picked each play → variety).
 *  Frame = row*10 + col on the 10-wide 32px sheet. Names from the Asset Manager tags. */
const EMOJI: Record<string, number[]> = {
  love: [52, 53, 54],          // love-face / big / huge  (harvest, gifts, high bond)
  happy: [55, 40, 30],         // happy-tears / smile-with-tears / big-smile
  content: [20, 24, 25, 23],   // idle-face / small-smile / open-mouth / eyes-closed
  plant: [21, 24, 26],         // sweet / small-smile / smile-with-check
  effort: [41, 42, 37],        // sweating / sweating-silent / silence  (chop, mine)
  sleepy: [38, 39],            // sleepy / very-sleepy  (night)
  wake: [30, 25, 20],          // big-smile / open-mouth / idle  (morning)
  surprise: [34, 35],          // small / big surprise
  think: [57, 28],             // thinking / question
  sad: [48, 43],               // sad / cry  (rain, tool break, failure)
  cool: [32, 33],              // cool-glasses / shining-glasses
  idle: [20, 24, 23],          // ambient "he's just vibing" — clean neutral/smile only
};
export type Emotion = keyof typeof EMOJI;

// Higher wins: a new emote only interrupts a showing one of LOWER priority (once the
// min-show has elapsed). Reaction to a player action beats ambient idle chatter.
const PRIORITY: Record<string, number> = {
  idle: 0, content: 1, plant: 1, wake: 1, sleepy: 1, think: 1, cool: 1,
  effort: 2, surprise: 2, happy: 3, love: 3, sad: 3,
};

const BUBBLE = 'speech-bubble';
const EMOJI_KEY = 'emoji';
// "Cato is saying something" alert bubble (a message glyph over his head) shown while he chatters
// in the bottom-left box — the box is easy to miss, so this draws the eye. Sits up-and-right of the
// emoji bubble so both can show at once. `ui-icons` (all_icons) frame 245 = the white-message glyph.
const MSG_KEY = 'ui-icons';
const MSG_FRAME = 245;
const TALK_SCALE = 0.46;
const TALK_DX = 0;    // centred DIRECTLY above Cato's head (same anchor as the emoji bubble)
const TALK_DY = 0;    // same height as the emoji bubble's tail
const MSG_ICON_SCALE = 1.7;  // the message glyph fills most of the bubble body
const MSG_BODY_FRAC = 0.6;   // its Y (from the tail-tip origin) → centred in the rounded body, above the tail
const FULL_SCALE = 0.52;       // the bubble's native 42×47 is too big over Cato → shrink
const EMOJI_BODY_FRAC = 0.62;  // emoji Y = -height*this → centred in the rounded BODY (above the tail)
const EMOJI_SCALE = 30 / 32;   // fit the 32px emoji into the bubble body (within the container)
const HEAD_OFFSET = 20;        // bubble tail tip this many px above Cato's origin (tuck it near his head)
const IDLE_MIN_MS = 120000, IDLE_JITTER_MS = 60000; // ambient "vibing" emote every 2–3 min (rare)
// Stamina gauge (16×16 radial): sits UPPER-LEFT of Cato's head; frame = round(frac*36).
const STAMINA_KEY = 'stamina';
const STAMINA_DX = -13, STAMINA_DY = -30; // px from Cato's origin (up + left of his head)
const STAMINA_SCALE = 1;
const STAMINA_LINGER_MS = 1800; // keep it up this long after the last update (then it hides)
// The PERSISTENT top-right "mood" emoji (near the portrait) mirrors the head bubble's
// emoji, but LINGERS after the bubble fades — so his state feels ongoing even though
// the bubble can't stay forever. Falls back to `sweet` (frame 21) after this timeout.
const SWEET_FRAME = 21;
const MOOD_LINGER_MS = 14000;
const DEPTH = 600000;          // above the night mask (500000), below the HUD scenes

interface Active { emotion: string; priority: number; until: number; minShow: number; }

export class EmoteController {
  private scene: Phaser.Scene;
  private target: () => { x: number; y: number } | undefined;
  private root?: Phaser.GameObjects.Container;
  private emoji?: Phaser.GameObjects.Image;
  private active: Active | null = null;
  private lastPlay = 0;         // ms — global anti-strobe cooldown
  private nextIdle = 0;         // ms — when the next ambient idle emote may fire
  private ambient: Emotion = 'idle'; // which emotion the ambient tick uses (scene-driven)
  private staminaImg?: Phaser.GameObjects.Image; // the stamina gauge over Cato's head
  private staminaHideAt = 0;
  private talkRoot?: Phaser.GameObjects.Container; // the "he's talking" message bubble over his head
  private talking = false; // while true, the message bubble owns the head-spot → suppress the emoji bubble
  private moodFrame = SWEET_FRAME;   // the persistent top-right mood emoji (published to registry)
  private moodExpireAt = 0;          // after this, the mood falls back to `sweet`
  private rngSeed = 1;

  constructor(scene: Phaser.Scene, target: () => { x: number; y: number } | undefined) {
    this.scene = scene;
    this.target = target;
  }

  /** Deterministic-ish RNG (Math.random is banned in some contexts; also keeps it cheap). */
  private pick(arr: number[]): number {
    this.rngSeed = (this.rngSeed * 1103515245 + 12345) & 0x7fffffff;
    return arr[this.rngSeed % arr.length]!;
  }

  private ensure(): void {
    if (this.root) return;
    const bubble = this.scene.add.image(0, 0, BUBBLE).setOrigin(0.5, 1); // tail tip = anchor (container 0,0)
    this.emoji = this.scene.add.image(0, Math.round(-bubble.height * EMOJI_BODY_FRAC), EMOJI_KEY, 0)
      .setOrigin(0.5, 0.5).setScale(EMOJI_SCALE);
    this.root = this.scene.add.container(0, 0, [bubble, this.emoji]).setDepth(DEPTH).setVisible(false);
  }

  /** Show an emote. Ignored if a higher/equal-priority one is still in its min-show, or
   *  within the global cooldown (so rapid harvests don't strobe). `now` = scene time ms. */
  play(emotion: Emotion, now: number, opts?: { duration?: number; minShow?: number; force?: boolean }): void {
    if (!EMOJI[emotion]) return;
    const prio = PRIORITY[emotion] ?? 1;
    if (!opts?.force) {
      if (now - this.lastPlay < 500) return;                                  // anti-strobe
      if (this.active && now < this.active.minShow && prio <= this.active.priority) return; // don't cut a higher one short
    }
    this.ensure();
    const frame = this.pick(EMOJI[emotion]!);
    this.emoji!.setFrame(frame);
    // The top-right mood mirrors this same emoji, and lingers past the bubble.
    this.moodFrame = frame;
    this.moodExpireAt = now + MOOD_LINGER_MS;
    const duration = opts?.duration ?? 2600;
    this.active = { emotion, priority: prio, until: now + duration, minShow: now + Math.min(900, duration) };
    this.lastPlay = now;
    this.nextIdle = now + IDLE_MIN_MS + (this.rngSeed % IDLE_JITTER_MS); // push ambient idle out after any real emote
    // While the message bubble owns the head-spot, only the mood (top-right portrait) updates — don't
    // pop the emoji bubble too (they share the exact spot now; the message bubble is the priority cue).
    if (this.talking) return;
    // Pop IN from the tail (scale 0 → FULL_SCALE, tiny overshoot).
    const root = this.root!;
    this.scene.tweens.killTweensOf(root);
    root.setVisible(true).setScale(0);
    this.scene.tweens.add({ targets: root, scale: FULL_SCALE, duration: 220, ease: 'Back.easeOut' });
  }

  /** Per-frame: follow Cato + expire the active emote + fire ambient idle chatter. */
  update(now: number): void {
    if (this.nextIdle === 0) this.nextIdle = now + IDLE_MIN_MS; // don't fire an idle emote at t=0
    const t = this.target();
    if (this.root && t) this.root.setPosition(Math.round(t.x), Math.round(t.y - HEAD_OFFSET));
    if (this.talkRoot?.visible && t) this.talkRoot.setPosition(Math.round(t.x + TALK_DX), Math.round(t.y - HEAD_OFFSET + TALK_DY));
    // Stamina gauge: follow Cato's upper-left; hide once its linger lapses.
    if (this.staminaImg) {
      if (t) this.staminaImg.setPosition(Math.round(t.x + STAMINA_DX), Math.round(t.y + STAMINA_DY));
      if (now > this.staminaHideAt) this.staminaImg.setVisible(false);
    }
    // Publish the PERSISTENT mood frame (falls back to `sweet` after the linger) for the
    // top-right indicator (rendered by ChatterScene, which sits above the HUD portrait).
    this.scene.registry.set('catoMoodFrame', now > this.moodExpireAt ? SWEET_FRAME : this.moodFrame);
    if (this.active && now >= this.active.until) {
      const root = this.root!;
      this.active = null;
      this.scene.tweens.killTweensOf(root);
      this.scene.tweens.add({ targets: root, scale: 0, duration: 160, ease: 'Back.easeIn', onComplete: () => root.setVisible(false) });
    }
    // Ambient: rarely (every few min), if nothing else is showing, a low-key emote that
    // MATCHES the scene (sleepy at night, content by day — set via setAmbient).
    if (!this.active && now >= this.nextIdle) {
      this.nextIdle = now + IDLE_MIN_MS + (this.rngSeed % IDLE_JITTER_MS);
      if (t) this.play(this.ambient, now, { duration: 2000 });
    }
  }

  /** Set the emotion the ambient tick uses — GameScene drives this from the time of
   *  day (night → sleepy, day → idle/content) so "he's just vibing" fits the scene. */
  setAmbient(emotion: Emotion): void {
    if (EMOJI[emotion]) this.ambient = emotion;
  }

  /** Show / hide the "Cato is saying something" message bubble over his head (driven by
   *  catoSay / clearChatter) — an attention cue for the easy-to-miss bottom-left chatter box. */
  setTalking(on: boolean, _now: number): void {
    this.talking = on;
    if (on && this.root?.visible) { // the message bubble takes the head-spot → clear the emoji bubble
      this.active = null;
      this.scene.tweens.killTweensOf(this.root);
      this.root.setVisible(false);
    }
    if (on) {
      if (!this.talkRoot) {
        const bubble = this.scene.add.image(0, 0, BUBBLE).setOrigin(0.5, 1);
        // frame 245 (all_icons "white-message") is a full-colour cream+tan message glyph — do NOT
        // tint it (a tint multiplies EVERY pixel, so it turns the cream fill into a dark blob).
        const icon = this.scene.add.image(0, Math.round(-bubble.height * MSG_BODY_FRAC), MSG_KEY, MSG_FRAME)
          .setOrigin(0.5, 0.5).setScale(MSG_ICON_SCALE); // bigger + centred in the bubble body
        this.talkRoot = this.scene.add.container(0, 0, [bubble, icon]).setDepth(DEPTH).setVisible(false);
      }
      const r = this.talkRoot;
      if (!r.visible) {
        const t = this.target(); // position at Cato's head NOW so it never flashes at world (0,0)
        if (t) r.setPosition(Math.round(t.x + TALK_DX), Math.round(t.y - HEAD_OFFSET + TALK_DY));
        this.scene.tweens.killTweensOf(r);
        r.setVisible(true).setScale(0);
        this.scene.tweens.add({ targets: r, scale: TALK_SCALE, duration: 220, ease: 'Back.easeOut' });
      }
    } else if (this.talkRoot?.visible) {
      const r = this.talkRoot;
      this.scene.tweens.killTweensOf(r);
      this.scene.tweens.add({ targets: r, scale: 0, duration: 160, ease: 'Back.easeIn', onComplete: () => r.setVisible(false) });
    }
  }

  /** Show/refresh the stamina gauge for `frac` (0..1). Call it every frame while Cato
   *  works or recovers; it auto-hides STAMINA_LINGER_MS after the last call ("做完后
   *  等一会儿就消失"). Positioned each frame in update(). */
  setStamina(frac: number, now: number): void {
    if (!this.staminaImg) {
      this.staminaImg = this.scene.add.image(0, 0, STAMINA_KEY, 0).setDepth(DEPTH).setScale(STAMINA_SCALE).setVisible(false);
    }
    const frame = Math.max(0, Math.min(36, Math.round(frac * 36)));
    this.staminaImg.setFrame(frame).setVisible(true);
    this.staminaHideAt = now + STAMINA_LINGER_MS;
  }

  /** Force-clear (e.g. on a modal / dialog opening over Cato). */
  hide(): void {
    this.active = null;
    if (this.root) { this.scene.tweens.killTweensOf(this.root); this.root.setVisible(false); }
    if (this.talkRoot) { this.scene.tweens.killTweensOf(this.talkRoot); this.talkRoot.setVisible(false); }
  }
}
