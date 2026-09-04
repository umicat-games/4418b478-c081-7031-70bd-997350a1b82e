import Phaser from 'phaser';

// A single cow that lives around its pen. Cows are DYNAMICALLY spawned (like chickens),
// never placed by the creator. They graze inside the pen during the day (kept off the fences),
// occasionally trek out through the gate and back, and walk back inside to SLEEP at night.
//
// Movement is A*-pathed (via `nav.planPath`) so a route in/out threads through the gate opening.
// The gate is a real barrier: a cow won't STEP onto a closed gate cell — it waits just short of it
// (which brings it near enough to auto-open the gate), then passes through the OPEN gate. Anims are
// the `cow-<name>` keys registered in BootScene (prefixed so the sheet's generic names can't collide).

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
  /** The safe INSIDE grazing area for a cow's CENTRE — inset half a body from every fence. Used to
   *  seed/place cows; cows now spend the DAY outside (see roamRect). */
  grazeRect(): { x0: number; y0: number; x1: number; y1: number };
  /** The OUTDOOR pasture past the gate — cows graze here all day and only go back inside to sleep. */
  roamRect(): { x0: number; y0: number; x1: number; y1: number };
  /** A graze point clearly OUTSIDE the gate — the pasture centre. */
  outsideSpot(): { x: number; y: number };
  /** True when a world point is a gate-opening cell AND the gate is currently CLOSED — a cow must
   *  wait (not step onto it) until the gate swings open. */
  gateBlocks(wx: number, wy: number): boolean;
}

/** Save shape for one cow — position + its milk colour (cows have no growth stages). */
export interface SavedCow { x: number; y: number; color?: string; }

type CowState = 'idle' | 'walk' | 'eat' | 'sleep';

const WALK_SPEED = 20; // px/sec (a touch slower than a chicken — cows amble)
const rnd = (a: number, b: number): number => a + Math.random() * (b - a);

export class Cow {
  readonly sprite: Phaser.GameObjects.Sprite;
  readonly color: string; // which milk colour this cow gives (blue/brown/purple/red/green)
  private scene: Phaser.Scene;
  private nav: CowNav;
  private state: CowState = 'idle';
  private until = 0; // wall-clock ms the current timed state runs to
  private path: Array<{ x: number; y: number }> = []; // remaining walk waypoints
  private facing: 1 | -1 = 1;
  private goingToSleep = false; // the current walk is a night return-to-pen
  private gateWaitStart = 0; // when the cow began waiting at a closed gate (0 = not waiting)

  constructor(scene: Phaser.Scene, opts: { x: number; y: number; nav: CowNav; color?: string }) {
    this.scene = scene;
    this.nav = opts.nav;
    this.color = opts.color ?? 'brown';
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
    this.state = 'idle'; this.path = []; this.goingToSleep = false; this.gateWaitStart = 0;
    this.play('idle'); this.until = now + rnd(1400, 3600);
  }
  private enterEat(now: number): void {
    this.state = 'eat'; this.play('chew_grass'); this.until = now + rnd(2600, 5200);
  }
  private enterSleep(): void {
    this.state = 'sleep'; this.path = []; this.goingToSleep = false; this.gateWaitStart = 0; this.play('sleep');
  }

  /** Begin an A*-pathed walk to (tx,ty). `toSleep` marks the night return so arrival → sleep. */
  private startWalkTo(tx: number, ty: number, toSleep = false): void {
    const p = this.nav.planPath(this.sprite.x, this.sprite.y, tx, ty);
    if (!p || !p.length) { this.enterIdle(this.scene.time.now); return; }
    this.path = p; this.state = 'walk'; this.goingToSleep = toSleep; this.gateWaitStart = 0; this.play('walk');
  }

  /** A random walkable point in a rect (a cow's centre), or null if 8 tries all hit an obstacle. */
  private pickIn(r: { x0: number; y0: number; x1: number; y1: number }): { x: number; y: number } | null {
    for (let i = 0; i < 8; i++) {
      const t = { x: rnd(r.x0, r.x1), y: rnd(r.y0, r.y1) };
      if (!this.nav.blocked(t.x, t.y)) return t;
    }
    return null;
  }
  /** The next DAY target — cows graze OUT in the pasture past the gate (they only head back inside
   *  to sleep at night). Falls back to the inside rect if the pasture is all blocked. */
  private pickTarget(): { x: number; y: number } | null {
    return this.pickIn(this.nav.roamRect()) ?? this.pickIn(this.nav.grazeRect());
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
      // Gate is a real barrier: don't step onto a CLOSED gate cell. Wait just short of it — that
      // keeps the cow near enough to auto-open the gate; once open, gateBlocks() clears and it goes.
      if (this.nav.gateBlocks(wp.x, wp.y)) {
        if (!this.gateWaitStart) this.gateWaitStart = now;
        if (now - this.gateWaitStart < 2600) { // safety: never wait forever (gate stuck) → just proceed
          this.face(wp.x - this.sprite.x); this.play('idle'); return;
        }
      }
      this.gateWaitStart = 0;
      const dx = wp.x - this.sprite.x, dy = wp.y - this.sprite.y, d = Math.hypot(dx, dy);
      if (d < 2) {
        this.path.shift();
        if (!this.path.length) {
          if (this.goingToSleep) this.enterSleep();
          else if (Math.random() < 0.6) this.enterEat(now);
          else this.enterIdle(now);
        }
      } else {
        this.play('walk');
        this.sprite.x += (dx / d) * WALK_SPEED * dt;
        this.sprite.y += (dy / d) * WALK_SPEED * dt;
        this.face(dx);
      }
      return;
    }

    // Day idle/eat expires → pick the next graze.
    if (!night && (this.state === 'idle' || this.state === 'eat') && now >= this.until) {
      if (Math.random() < 0.72) { const t = this.pickTarget(); if (t) this.startWalkTo(t.x, t.y); else this.enterIdle(now); }
      else this.enterIdle(now);
    }
  }

  /** Distance from this cow to a world point — used to auto-open the gate as it nears. */
  distTo(wx: number, wy: number): number {
    return Math.hypot(this.sprite.x - wx, this.sprite.y - wy);
  }

  serialize(): SavedCow { return { x: Math.round(this.sprite.x), y: Math.round(this.sprite.y), color: this.color }; }
  destroy(): void { this.sprite.destroy(); }
}
