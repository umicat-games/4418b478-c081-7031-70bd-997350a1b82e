import Phaser from 'phaser';
import type { CoopColor } from './data/coops';

// A single chicken that lives near its coop and roams with a little animation state machine.
// Lifecycle: egg → chick → adult (each stage lasts a "while" of GAME time, so the debug time-skip
// advances it). The AI wanders on WALL-CLOCK time so it stays smooth regardless of the game clock.
//
// Frame-range anims are registered per colour in BootScene as `chick-<color>-<name>` /
// `chicken-<color>-<name>` / `egg-<name>`. The user's sequencing rules are honoured: sit_down is
// always followed by a sit_idle loop then stand_up; walk / fly actually move the sprite.

export type ChickenStage = 'egg' | 'chick' | 'adult';

/** Save shape for one chicken. `remain` = game-ms left in the current stage (−1 = adult, no maturation). */
export interface SavedChicken { stage: ChickenStage; color: CoopColor; x: number; y: number; remain: number; }

// Stage durations in GAME ms (scene.nowMs(), which the +6h debug time-skip advances).
export const EGG_HATCH_MS = 3 * 3600 * 1000; // egg → chick after ~3 in-game hours
export const CHICK_GROW_MS = 9 * 3600 * 1000; // chick → adult after ~9 in-game hours

const ROAM_RADIUS = 42; // px the chicken wanders from its coop
const WALK_SPEED = 20; // px/sec while walking
const FLY_SPEED = 46; // px/sec during a hop-fly (adults)

type AiState = 'idle' | 'walk' | 'eat' | 'fly' | 'sit-down' | 'sit-idle' | 'stand-up' | 'hatch' | 'grow';

const rnd = (a: number, b: number): number => a + Math.random() * (b - a);
const pick = <T>(arr: T[]): T => arr[Math.floor(Math.random() * arr.length)]!;

export class Chicken {
  stage: ChickenStage;
  readonly color: CoopColor;
  readonly sprite: Phaser.GameObjects.Sprite;
  private scene: Phaser.Scene;
  private home: { x: number; y: number };
  private stageEndsAt: number; // game ms when the current stage matures
  private state: AiState = 'idle';
  private until = 0; // wall-clock ms the current AI state runs to
  private target?: { x: number; y: number };
  private facing: 1 | -1 = 1;
  private busyAnim = false; // a one-shot transition anim is playing (don't interrupt)
  private blocked?: (wx: number, wy: number) => boolean; // world-point collision test (trees/coops/stones/walls)

  constructor(scene: Phaser.Scene, opts: { stage: ChickenStage; color: CoopColor; x: number; y: number; home: { x: number; y: number }; gameNow: number; stageEndsAt?: number; blocked?: (wx: number, wy: number) => boolean }) {
    this.scene = scene;
    this.stage = opts.stage;
    this.color = opts.color;
    this.home = opts.home;
    this.blocked = opts.blocked;
    this.stageEndsAt = opts.stageEndsAt ?? opts.gameNow + (opts.stage === 'egg' ? EGG_HATCH_MS : opts.stage === 'chick' ? CHICK_GROW_MS : Infinity);
    this.sprite = scene.add.sprite(opts.x, opts.y, this.tex(), 0).setOrigin(0.5, 1);
    if (this.stage === 'egg') this.playLoop('egg-still');
    else this.enterIdle(scene.time.now);
  }

  private tex(): string {
    if (this.stage === 'egg') return 'egg-hatch';
    return `${this.stage === 'chick' ? 'chick' : 'chicken'}-${this.color}`;
  }
  private animKey(name: string): string {
    return this.stage === 'egg' ? `egg-${name}` : `${this.tex()}-${name}`;
  }
  private playLoop(key: string): void {
    if (this.scene.anims.exists(key)) this.sprite.play(key, true);
  }
  /** Play a one-shot anim; when it finishes, run `then` EXACTLY once. A safety timer force-completes
   *  if ANIMATION_COMPLETE never fires (e.g. an interrupted/short anim), so `busyAnim` can't stick
   *  and freeze the chicken. */
  private playOnce(key: string, then: () => void): void {
    const anim = this.scene.anims.get(key);
    if (!anim) { then(); return; }
    this.busyAnim = true;
    let done = false;
    const finish = (): void => { if (done) return; done = true; this.busyAnim = false; then(); };
    this.sprite.play(key, true);
    this.sprite.once(Phaser.Animations.Events.ANIMATION_COMPLETE_KEY + key, finish);
    // Fallback: the anim's own duration + a small buffer (frames × ms/frame).
    const ms = (anim.frames.length || 8) * (1000 / (anim.frameRate || 10)) + 400;
    this.scene.time.delayedCall(ms, finish);
  }

  // ── AI states ──────────────────────────────────────────────────────────────
  private enterIdle(now: number): void {
    this.state = 'idle';
    this.target = undefined;
    this.playLoop(this.animKey(Math.random() < 0.5 ? 'idle' : 'idle1'));
    this.until = now + rnd(1600, 4200);
  }
  /** A random roam point near home that ISN'T on a solid cell (tree/coop/stone/wall); null if none found. */
  private pickRoamTarget(minR: number): { x: number; y: number } | null {
    for (let i = 0; i < 6; i++) {
      const a = rnd(0, Math.PI * 2), r = rnd(minR, ROAM_RADIUS);
      const t = { x: this.home.x + Math.cos(a) * r, y: this.home.y + Math.sin(a) * r * 0.6 };
      if (!this.blocked || !this.blocked(t.x, t.y)) return t;
    }
    return null;
  }
  private enterWalk(now: number): void {
    const t = this.pickRoamTarget(10);
    if (!t) { this.enterIdle(now); return; } // boxed in → just idle
    this.state = 'walk';
    this.target = t;
    this.face(t.x - this.sprite.x);
    this.playLoop(this.animKey('walk'));
    this.until = now + rnd(2500, 5000); // safety cap if it can't reach
  }
  private enterFly(now: number): void {
    // A hop that carries the adult to a nearby spot (movement happens during the one-shot fly anim).
    const t = this.pickRoamTarget(16);
    if (!t) { this.enterIdle(now); return; }
    this.state = 'fly';
    this.target = t;
    this.face(t.x - this.sprite.x);
    this.until = now + 6000; // safety
    this.playOnce(this.animKey('fly'), () => { this.target = undefined; this.enterIdle(this.scene.time.now); });
  }
  private enterSit(): void {
    this.state = 'sit-down';
    this.playOnce(this.animKey('sitdown'), () => {
      this.state = 'sit-idle';
      this.playLoop(this.animKey(pick(['sitidle', 'sitidle1', 'sitidle2', 'sitidle3'])));
      this.until = this.scene.time.now + rnd(2500, 6000);
    });
  }
  private enterStandUp(): void {
    this.state = 'stand-up';
    this.playOnce(this.animKey('standup'), () => {
      // After standing, sometimes peck (eat) then idle, else straight to idle.
      if (Math.random() < 0.5) this.enterEat(); else this.enterIdle(this.scene.time.now);
    });
  }
  private enterEat(): void {
    this.state = 'eat';
    this.playOnce(this.animKey('eat'), () => this.enterIdle(this.scene.time.now));
  }

  private face(dx: number): void {
    if (Math.abs(dx) < 0.5) return;
    this.facing = dx < 0 ? -1 : 1;
    this.sprite.setFlipX(this.facing < 0);
  }

  /** Pick the next thing to do after an idle beat. */
  private wander(now: number): void {
    const r = Math.random();
    if (this.stage === 'adult' && r < 0.18) this.enterFly(now);
    else if (r < 0.5) this.enterWalk(now);
    else if (r < 0.72) this.enterSit();
    else if (r < 0.86) this.enterEat();
    else this.enterIdle(now);
  }

  // ── Per-frame update ─────────────────────────────────────────────────────────
  /** `timeNow` = wall clock (scene.time.now); `gameNow` = scene.nowMs() (game clock); `dt` seconds.
   *  Returns 'hatched' / 'grown' on a stage change so the caller can react (e.g. re-sort). */
  update(timeNow: number, gameNow: number, dt: number): 'hatched' | 'grown' | null {
    // Movement during walk / fly.
    if ((this.state === 'walk' || this.state === 'fly') && this.target) {
      const dx = this.target.x - this.sprite.x, dy = this.target.y - this.sprite.y;
      const d = Math.hypot(dx, dy);
      const spd = this.state === 'fly' ? FLY_SPEED : WALK_SPEED;
      if (d < 2) {
        if (this.state === 'walk') { this.target = undefined; this.enterIdle(timeNow); }
      } else {
        const nx = this.sprite.x + (dx / d) * spd * dt, ny = this.sprite.y + (dy / d) * spd * dt;
        if (this.blocked && this.blocked(nx, ny)) {
          // Bumped a prop (tree/coop/stone/wall) → stop; a walk re-picks a target next idle, a hop
          // just halts here and lets its one-shot anim finish.
          this.target = undefined;
          if (this.state === 'walk') this.enterIdle(timeNow);
        } else {
          this.sprite.x = nx;
          this.sprite.y = ny;
          this.face(dx);
        }
      }
    }

    // Stage maturation — only at a safe resting point (not mid one-shot transition).
    if (!this.busyAnim && gameNow >= this.stageEndsAt) {
      if (this.stage === 'egg' && this.state !== 'hatch') {
        this.state = 'hatch';
        this.playOnce('egg-hatch', () => this.becomeChick(gameNow));
      } else if (this.stage === 'chick' && this.state !== 'grow') {
        // Any safe (non-transition) point: stop wandering + play the grow anim → adult.
        this.state = 'grow';
        this.target = undefined;
        this.playOnce(this.animKey('grow'), () => this.becomeAdult());
      }
    }

    // Egg idle: occasional shake.
    if (this.stage === 'egg') {
      if (this.state !== 'hatch' && timeNow >= this.until) {
        const shaking = this.sprite.anims.currentAnim?.key === 'egg-shake';
        this.playLoop(shaking ? 'egg-still' : 'egg-shake');
        this.until = timeNow + (shaking ? rnd(2000, 4000) : rnd(600, 1000));
      }
      return null;
    }

    // Chick / adult AI: when the current timed state expires (and no one-shot is mid-play), pick next.
    if (!this.busyAnim && (this.state === 'idle' || this.state === 'sit-idle') && timeNow >= this.until) {
      if (this.state === 'sit-idle') this.enterStandUp();
      else this.wander(timeNow);
    }
    return null;
  }

  private becomeChick(gameNow: number): void {
    this.stage = 'chick';
    this.stageEndsAt = gameNow + CHICK_GROW_MS;
    this.sprite.setTexture(this.tex(), 0).setOrigin(0.5, 1);
    this.enterIdle(this.scene.time.now);
  }
  private becomeAdult(): void {
    this.stage = 'adult';
    this.stageEndsAt = Infinity;
    this.sprite.setTexture(this.tex(), 0).setOrigin(0.5, 1);
    this.enterIdle(this.scene.time.now);
  }

  /** Save shape: stage + colour + position + how much game-time is left in the current stage
   *  (−1 for an adult, which never matures). */
  serialize(gameNow: number): SavedChicken {
    const remain = this.stage === 'adult' ? -1 : Math.max(0, Math.round(this.stageEndsAt - gameNow));
    return { stage: this.stage, color: this.color, x: Math.round(this.sprite.x), y: Math.round(this.sprite.y), remain };
  }

  destroy(): void {
    this.sprite.destroy();
  }
}
