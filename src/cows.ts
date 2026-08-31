import Phaser from 'phaser';

// A single cow that lives around its pen. Cows are DYNAMICALLY spawned (like chickens),
// never placed by the creator. They graze near the pen during the day — wandering in and
// out through the gate — and walk back inside to SLEEP when night falls, waking at morning.
//
// Movement is A*-pathed (via the injected `nav.planPath`) so a cow correctly routes THROUGH
// the gate opening instead of shoving against the fence — the pen's only gap. Anims are the
// `cow-<name>` keys registered in BootScene (idle / walk / chew_grass / sit_idle / sleep …),
// prefixed so the generic sheet names ('walk'/'idle') can't collide with another asset's.

/** The world/pen queries a Cow needs — supplied by GameScene so this file stays Phaser-only. */
export interface CowNav {
  /** True when a world point sits on a SOLID cell (fence / tree / stone / wall). */
  blocked(wx: number, wy: number): boolean;
  /** A* world-waypoint path from → to (last = the goal cell), or null if unreachable. */
  planPath(fx: number, fy: number, tx: number, ty: number): Array<{ x: number; y: number }> | null;
  /** Nightfall — cows return to the pen and sleep. */
  isNight(): boolean;
  /** A spot INSIDE the pen (near the barn) where cows gather to sleep. */
  sleepSpot(): { x: number; y: number };
  /** Centre of the roam area (the pen) + how far a cow strays. */
  roamCenter(): { x: number; y: number };
  roamRadius(): number;
}

/** Save shape for one cow — just its position (cows have no growth stages). */
export interface SavedCow { x: number; y: number; }

type CowState = 'idle' | 'walk' | 'eat' | 'sit' | 'sleep';

const WALK_SPEED = 20; // px/sec (a touch slower than a chicken — cows amble)
const rnd = (a: number, b: number): number => a + Math.random() * (b - a);

export class Cow {
  readonly sprite: Phaser.GameObjects.Sprite;
  private scene: Phaser.Scene;
  private nav: CowNav;
  private state: CowState = 'idle';
  private until = 0; // wall-clock ms the current timed state runs to
  private path: Array<{ x: number; y: number }> = []; // remaining walk waypoints
  private facing: 1 | -1 = 1;
  private goingToSleep = false; // the current walk is a night return-to-pen

  constructor(scene: Phaser.Scene, opts: { x: number; y: number; nav: CowNav }) {
    this.scene = scene;
    this.nav = opts.nav;
    this.sprite = scene.add.sprite(opts.x, opts.y, 'pink_cow_animation_sprites', 0).setOrigin(0.5, 1);
    this.enterIdle(scene.time.now);
  }

  private play(name: string): void {
    const key = `cow-${name}`;
    if (this.scene.anims.exists(key)) this.sprite.play(key, true);
  }
  private face(dx: number): void {
    if (Math.abs(dx) < 0.5) return;
    this.facing = dx < 0 ? -1 : 1;
    this.sprite.setFlipX(this.facing < 0);
  }

  private enterIdle(now: number): void {
    this.state = 'idle'; this.path = []; this.goingToSleep = false;
    this.play('idle'); this.until = now + rnd(1400, 3600);
  }
  private enterEat(now: number): void {
    this.state = 'eat'; this.play('chew_grass'); this.until = now + rnd(2600, 5200);
  }
  private enterSleep(): void {
    this.state = 'sleep'; this.path = []; this.goingToSleep = false; this.play('sleep');
  }

  /** Begin an A*-pathed walk to (tx,ty). `toSleep` marks the night return so arrival → sleep. */
  private startWalkTo(tx: number, ty: number, toSleep = false): void {
    const p = this.nav.planPath(this.sprite.x, this.sprite.y, tx, ty);
    if (!p || !p.length) { this.enterIdle(this.scene.time.now); return; }
    this.path = p; this.state = 'walk'; this.goingToSleep = toSleep; this.play('walk');
  }

  /** A random graze target within the roam radius of the pen (some inside, some out the gate). */
  private pickRoam(): { x: number; y: number } | null {
    const c = this.nav.roamCenter(), R = this.nav.roamRadius();
    for (let i = 0; i < 8; i++) {
      const a = rnd(0, Math.PI * 2), r = rnd(R * 0.2, R);
      const t = { x: c.x + Math.cos(a) * r, y: c.y + Math.sin(a) * r * 0.75 };
      if (!this.nav.blocked(t.x, t.y)) return t;
    }
    return null;
  }

  /** Per-frame tick. `now` = scene.time.now (wall clock); `dt` seconds. */
  update(now: number, dt: number): void {
    const night = this.nav.isNight();

    // Nightfall interrupts day roaming — head back inside to sleep.
    if (night && this.state !== 'sleep' && !this.goingToSleep) {
      const s = this.nav.sleepSpot();
      this.startWalkTo(s.x + rnd(-10, 10), s.y + rnd(-5, 5), true);
    }
    // Morning — wake and resume grazing.
    if (!night && this.state === 'sleep') { this.enterIdle(now); }

    // Walk along the current path.
    if (this.state === 'walk' && this.path.length) {
      const wp = this.path[0]!;
      const dx = wp.x - this.sprite.x, dy = wp.y - this.sprite.y, d = Math.hypot(dx, dy);
      if (d < 2) {
        this.path.shift();
        if (!this.path.length) {
          if (this.goingToSleep) this.enterSleep();
          else if (Math.random() < 0.6) this.enterEat(now);
          else this.enterIdle(now);
        }
      } else {
        this.sprite.x += (dx / d) * WALK_SPEED * dt;
        this.sprite.y += (dy / d) * WALK_SPEED * dt;
        this.face(dx);
      }
      return;
    }

    // Day idle/eat expires → pick the next graze.
    if (!night && (this.state === 'idle' || this.state === 'eat' || this.state === 'sit') && now >= this.until) {
      if (Math.random() < 0.72) { const t = this.pickRoam(); if (t) this.startWalkTo(t.x, t.y); else this.enterIdle(now); }
      else this.enterIdle(now);
    }
  }

  /** Distance from this cow to a world point — used to auto-open the gate as it nears. */
  distTo(wx: number, wy: number): number {
    return Math.hypot(this.sprite.x - wx, this.sprite.y - wy);
  }

  serialize(): SavedCow { return { x: Math.round(this.sprite.x), y: Math.round(this.sprite.y) }; }
  destroy(): void { this.sprite.destroy(); }
}
