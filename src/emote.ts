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
const FULL_SCALE = 0.52;       // the bubble's native 42×47 is too big over Cato → shrink
const EMOJI_BODY_FRAC = 0.62;  // emoji Y = -height*this → centred in the rounded BODY (above the tail)
const EMOJI_SCALE = 30 / 32;   // fit the 32px emoji into the bubble body (within the container)
const HEAD_OFFSET = 20;        // bubble tail tip this many px above Cato's origin (tuck it near his head)
const IDLE_MIN_MS = 120000, IDLE_JITTER_MS = 60000; // ambient "vibing" emote every 2–3 min (rare)
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
    const duration = opts?.duration ?? 2600;
    this.active = { emotion, priority: prio, until: now + duration, minShow: now + Math.min(900, duration) };
    this.lastPlay = now;
    this.nextIdle = now + IDLE_MIN_MS + (this.rngSeed % IDLE_JITTER_MS); // push ambient idle out after any real emote
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

  /** Force-clear (e.g. on a modal / dialog opening over Cato). */
  hide(): void {
    this.active = null;
    if (this.root) { this.scene.tweens.killTweensOf(this.root); this.root.setVisible(false); }
  }
}
