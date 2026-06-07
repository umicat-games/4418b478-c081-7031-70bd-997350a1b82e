import Phaser from 'phaser';
import { GAME_WIDTH, GAME_HEIGHT } from '../config';
import { umicatReady } from '../main';

// ── Tuning constants ──────────────────────────────────────────────────────────
const PLAYER_SPEED      = 380;    // px/s (keyboard movement)
const BULLET_BASE_SPEED = 260;    // px/s at t=0
const BULLET_SPEED_CAP  = 580;    // px/s maximum
const BULLET_SPEED_GAIN = 0.018;  // extra multiplier per second survived
const INITIAL_SPAWN_MS  = 1100;   // ms between spawns at start
const MIN_SPAWN_MS      = 90;     // fastest possible spawn interval
const DIFFICULTY_TICK   = 5000;   // ms — reduce spawn interval this often
const SPAWN_REDUCTION   = 45;     // ms shaved off per difficulty tick
// ─────────────────────────────────────────────────────────────────────────────

type Key = Phaser.Input.Keyboard.Key;

export class GameScene extends Phaser.Scene {
  // physics
  private player!: Phaser.Physics.Arcade.Image;
  private bullets!: Phaser.Physics.Arcade.Group;

  // visuals
  private playerGfx!: Phaser.GameObjects.Graphics;
  private thrusterGfx!: Phaser.GameObjects.Graphics;

  // input
  private cursors!: Phaser.Types.Input.Keyboard.CursorKeys;
  private wasd!: { w: Key; s: Key; a: Key; d: Key };

  // state
  private alive = true;
  private elapsed = 0;           // ms survived this run
  private spawnInterval = INITIAL_SPAWN_MS;
  private bestTime = 0;          // ms — loaded from saves

  // timers
  private spawnEvent!: Phaser.Time.TimerEvent;

  // HUD elements
  private timeText!: Phaser.GameObjects.Text;
  private bestText!: Phaser.GameObjects.Text;
  private bulletText!: Phaser.GameObjects.Text;

  // platform
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private _umicat: any = null;

  constructor() {
    super({ key: 'GameScene' });
  }

  // ── lifecycle ───────────────────────────────────────────────────────────────

  async create(): Promise<void> {
    // Reset state on restart
    this.alive = true;
    this.elapsed = 0;
    this.spawnInterval = INITIAL_SPAWN_MS;
    this.bestTime = 0;

    // Platform save
    try {
      this._umicat = await umicatReady;
      if (this._umicat) {
        const saved = await this._umicat.saves.get<number>('highScore');
        if (typeof saved === 'number' && saved > 0) this.bestTime = saved;
      }
    } catch { /* offline / anonymous — just run */ }

    this.createTextures();
    this.drawBackground();
    this.createPlayer();
    this.createInput();
    this.createHUD();
    this.startSpawner();

    // Difficulty ramp — every DIFFICULTY_TICK ms, tighten spawn rate
    this.time.addEvent({
      delay: DIFFICULTY_TICK,
      loop: true,
      callback: this.escalate,
      callbackScope: this,
    });

    // Collision: bullet touches player → die
    this.physics.add.overlap(
      this.player,
      this.bullets,
      () => this.onHit(),
      undefined,
      this,
    );
  }

  // ── textures ────────────────────────────────────────────────────────────────

  private createTextures(): void {
    // 32×32 near-invisible rect for the player physics body
    if (!this.textures.exists('playerBody')) {
      const g = this.make.graphics({ x: 0, y: 0, add: false });
      g.fillStyle(0xffffff, 0.01);
      g.fillRect(0, 0, 32, 32);
      g.generateTexture('playerBody', 32, 32);
      g.destroy();
    }

    // Neon bullet glow — 32×32 (radius 16 including glow)
    if (!this.textures.exists('bullet')) {
      const R = 16;
      const g = this.make.graphics({ x: 0, y: 0, add: false });
      g.fillStyle(0xff1100, 0.08); g.fillCircle(R, R, R);
      g.fillStyle(0xff3300, 0.20); g.fillCircle(R, R, R - 3);
      g.fillStyle(0xff6600, 0.55); g.fillCircle(R, R, R - 7);
      g.fillStyle(0xffaa00, 0.90); g.fillCircle(R, R, R - 11);
      g.fillStyle(0xffe066, 1.00); g.fillCircle(R, R, R - 13);
      g.fillStyle(0xffffff, 1.00); g.fillCircle(R, R, 2);
      g.generateTexture('bullet', R * 2, R * 2);
      g.destroy();
    }
  }

  // ── background ──────────────────────────────────────────────────────────────

  private drawBackground(): void {
    // Deep space gradient
    const bg = this.add.graphics().setDepth(0);
    bg.fillGradientStyle(0x02020e, 0x02020e, 0x09021a, 0x09021a, 1);
    bg.fillRect(0, 0, GAME_WIDTH, GAME_HEIGHT);

    // Perspective grid — faint cyan lines
    const grid = this.add.graphics().setDepth(0);
    grid.lineStyle(1, 0x080830, 1);
    const gs = 80;
    for (let x = 0; x <= GAME_WIDTH; x += gs) grid.lineBetween(x, 0, x, GAME_HEIGHT);
    for (let y = 0; y <= GAME_HEIGHT; y += gs) grid.lineBetween(0, y, GAME_WIDTH, y);

    // Brighter accent grid lines every 5 cells
    const gridAcc = this.add.graphics().setDepth(0);
    gridAcc.lineStyle(1, 0x0a0a44, 1);
    for (let x = 0; x <= GAME_WIDTH; x += gs * 5) gridAcc.lineBetween(x, 0, x, GAME_HEIGHT);
    for (let y = 0; y <= GAME_HEIGHT; y += gs * 5) gridAcc.lineBetween(0, y, GAME_WIDTH, y);

    // Atmospheric corner glows
    const addGlow = (gx: number, gy: number, r: number, col: number, alpha: number) =>
      this.add.graphics().setDepth(0).fillStyle(col, alpha).fillCircle(gx, gy, r);
    addGlow(0,          0,           380, 0x0055ff, 0.07);
    addGlow(GAME_WIDTH, 0,           300, 0x8800ff, 0.06);
    addGlow(GAME_WIDTH, GAME_HEIGHT, 420, 0xff0088, 0.06);
    addGlow(0,          GAME_HEIGHT, 300, 0x00ffcc, 0.05);
  }

  // ── player & bullets ────────────────────────────────────────────────────────

  private createPlayer(): void {
    this.player = this.physics.add.image(
      GAME_WIDTH / 2,
      GAME_HEIGHT / 2,
      'playerBody',
    );
    this.player.setAlpha(0).setDepth(2).setCollideWorldBounds(true);
    // Hitbox: circle of radius 10 centered in the 32×32 body
    // offset = (halfBodyWidth - radius) = 16 - 10 = 6
    (this.player.body as Phaser.Physics.Arcade.Body).setCircle(10, 6, 6);

    this.bullets = this.physics.add.group({ allowGravity: false });
    this.thrusterGfx = this.add.graphics().setDepth(1);
    this.playerGfx   = this.add.graphics().setDepth(3);
  }

  // ── input ───────────────────────────────────────────────────────────────────

  private createInput(): void {
    this.cursors = this.input.keyboard!.createCursorKeys();
    const kb = this.input.keyboard!;
    this.wasd = {
      w: kb.addKey(Phaser.Input.Keyboard.KeyCodes.W),
      s: kb.addKey(Phaser.Input.Keyboard.KeyCodes.S),
      a: kb.addKey(Phaser.Input.Keyboard.KeyCodes.A),
      d: kb.addKey(Phaser.Input.Keyboard.KeyCodes.D),
    };
  }

  // ── HUD ─────────────────────────────────────────────────────────────────────

  private createHUD(): void {
    // Survival timer — center top
    this.timeText = this.add
      .text(GAME_WIDTH / 2, 16, '0.0s', {
        fontFamily: 'monospace',
        fontSize: '44px',
        color: '#00e5ff',
        stroke: '#00111a',
        strokeThickness: 6,
      })
      .setOrigin(0.5, 0)
      .setDepth(10);

    // Best time — below timer
    this.bestText = this.add
      .text(GAME_WIDTH / 2, 72, `BEST: ${this.fmtTime(this.bestTime)}`, {
        fontFamily: 'monospace',
        fontSize: '18px',
        color: '#335566',
      })
      .setOrigin(0.5, 0)
      .setDepth(10);

    // Bullet count — top right
    this.bulletText = this.add
      .text(GAME_WIDTH - 16, 16, 'BULLETS: 0', {
        fontFamily: 'monospace',
        fontSize: '16px',
        color: '#ff5500',
      })
      .setOrigin(1, 0)
      .setDepth(10);

    // Controls hint — fades after 3 s
    const hint = this.add
      .text(16, GAME_HEIGHT - 14,
        'WASD / Arrow Keys  ·  Mouse — follow cursor',
        { fontFamily: 'monospace', fontSize: '13px', color: '#223344' })
      .setOrigin(0, 1)
      .setDepth(10);
    this.tweens.add({
      targets: hint, alpha: 0, delay: 3500, duration: 1200,
      onComplete: () => hint.destroy(),
    });
  }

  // ── spawning ────────────────────────────────────────────────────────────────

  private startSpawner(): void {
    this.spawnEvent?.remove();
    this.spawnEvent = this.time.addEvent({
      delay: this.spawnInterval,
      loop: true,
      callback: this.spawnBullet,
      callbackScope: this,
    });
  }

  private escalate(): void {
    if (!this.alive) return;
    this.spawnInterval = Math.max(MIN_SPAWN_MS, this.spawnInterval - SPAWN_REDUCTION);
    this.startSpawner();
  }

  private spawnBullet(): void {
    if (!this.alive) return;

    // Random point on any of the four screen edges
    let bx: number, by: number;
    const pad = 28;
    switch (Phaser.Math.Between(0, 3)) {
      case 0: bx = Phaser.Math.FloatBetween(0, GAME_WIDTH); by = -pad; break;
      case 1: bx = GAME_WIDTH + pad; by = Phaser.Math.FloatBetween(0, GAME_HEIGHT); break;
      case 2: bx = Phaser.Math.FloatBetween(0, GAME_WIDTH); by = GAME_HEIGHT + pad; break;
      default: bx = -pad; by = Phaser.Math.FloatBetween(0, GAME_HEIGHT); break;
    }

    // Aim directly at the player's current position, then travel straight
    const angle = Phaser.Math.Angle.Between(bx, by, this.player.x, this.player.y);
    const speedMult = 1 + (this.elapsed / 1000) * BULLET_SPEED_GAIN;
    const speed = Math.min(BULLET_BASE_SPEED * speedMult, BULLET_SPEED_CAP);

    // Create inside group (avoids body-reset bug on group.add())
    const b = this.bullets.create(bx, by, 'bullet') as Phaser.Physics.Arcade.Image;
    b.setDepth(2);
    const body = b.body as Phaser.Physics.Arcade.Body;
    // Collision circle radius 8, centered in 32×32 texture: offset = 16-8 = 8
    body.setCircle(8, 8, 8);
    body.setAllowGravity(false);
    body.setVelocity(Math.cos(angle) * speed, Math.sin(angle) * speed);
  }

  // ── death ───────────────────────────────────────────────────────────────────

  private onHit(): void {
    if (!this.alive) return;
    this.alive = false;

    const px = this.player.x;
    const py = this.player.y;

    // Explosion particle burst
    this.add.particles(px, py, 'bullet', {
      speed: { min: 60, max: 340 },
      scale: { start: 0.9, end: 0 },
      alpha: { start: 1, end: 0 },
      lifespan: { min: 250, max: 650 },
      quantity: 22,
      emitting: false,
    }).setDepth(20).explode(22);

    // Orange shockwave ring
    const ring = this.add.graphics().setDepth(21);
    ring.lineStyle(4, 0xff6600, 0.9);
    ring.strokeCircle(px, py, 8);
    this.tweens.add({
      targets: ring,
      scaleX: 8, scaleY: 8,
      alpha: 0,
      duration: 450,
      ease: 'Sine.easeOut',
      onComplete: () => ring.destroy(),
    });

    // White screen flash
    const flash = this.add.graphics().setDepth(25);
    flash.fillStyle(0xff6600, 0.55);
    flash.fillRect(0, 0, GAME_WIDTH, GAME_HEIGHT);
    this.tweens.add({
      targets: flash, alpha: 0, duration: 400,
      onComplete: () => flash.destroy(),
    });

    this.playerGfx.setVisible(false);
    this.thrusterGfx.setVisible(false);
    this.spawnEvent.paused = true;

    // Save best time
    const isNewBest = this.elapsed > this.bestTime;
    if (isNewBest) {
      this.bestTime = this.elapsed;
      try { this._umicat?.saves.set('highScore', this.bestTime); } catch { /* ignore */ }
    }

    this.time.delayedCall(550, () => this.showGameOver(isNewBest));
  }

  // ── game-over overlay ────────────────────────────────────────────────────────

  private showGameOver(isNewBest: boolean): void {
    const cx = GAME_WIDTH / 2;
    const cy = GAME_HEIGHT / 2;

    // Dim overlay
    const overlay = this.add.graphics().setDepth(100).setAlpha(0);
    overlay.fillStyle(0x000000, 0.78).fillRect(0, 0, GAME_WIDTH, GAME_HEIGHT);
    this.tweens.add({ targets: overlay, alpha: 1, duration: 280 });

    // Panel
    const pw = 540, ph = 340;
    const px = cx - pw / 2, py = cy - ph / 2;
    const panel = this.add.graphics().setDepth(101);
    panel.fillStyle(0x060618, 1).fillRoundedRect(px, py, pw, ph, 18);
    panel.lineStyle(2, 0x00e5ff, 0.7).strokeRoundedRect(px, py, pw, ph, 18);
    panel.lineStyle(1, 0x003355, 0.4).strokeRoundedRect(px + 5, py + 5, pw - 10, ph - 10, 14);

    // Title
    this.add.text(cx, cy - 130, 'GAME OVER', {
      fontFamily: 'monospace',
      fontSize: '40px',
      color: '#ff3300',
      stroke: '#000',
      strokeThickness: 6,
    }).setOrigin(0.5).setDepth(102);

    // Divider
    const div = this.add.graphics().setDepth(102);
    div.lineStyle(1, 0x223344, 1).lineBetween(cx - 200, cy - 90, cx + 200, cy - 90);

    // Survival time
    this.add.text(cx, cy - 58, `SURVIVED`, {
      fontFamily: 'monospace', fontSize: '14px', color: '#446677',
    }).setOrigin(0.5).setDepth(102);
    this.add.text(cx, cy - 30, this.fmtTime(this.elapsed), {
      fontFamily: 'monospace',
      fontSize: '36px',
      color: '#00e5ff',
      stroke: '#001a2a',
      strokeThickness: 4,
    }).setOrigin(0.5).setDepth(102);

    // Best / new best
    if (isNewBest) {
      const nb = this.add.text(cx, cy + 24, '★  NEW BEST!  ★', {
        fontFamily: 'monospace', fontSize: '24px', color: '#ffdd00',
        stroke: '#332200', strokeThickness: 4,
      }).setOrigin(0.5).setDepth(102);
      // One-shot pop
      this.tweens.add({ targets: nb, scaleX: 1.18, scaleY: 1.18, duration: 160, yoyo: true });
    } else {
      this.add.text(cx, cy + 24, `BEST: ${this.fmtTime(this.bestTime)}`, {
        fontFamily: 'monospace', fontSize: '18px', color: '#335566',
      }).setOrigin(0.5).setDepth(102);
    }

    // Restart button
    const bw = 210, bh = 52;
    const bx = cx - bw / 2, by = cy + 76;
    const btnGfx = this.add.graphics().setDepth(102);
    const drawBtn = (hover: boolean) => {
      btnGfx.clear();
      btnGfx.fillStyle(hover ? 0x00ccff : 0x0088cc, 1).fillRoundedRect(bx, by, bw, bh, 10);
      btnGfx.lineStyle(2, hover ? 0xffffff : 0x00e5ff, 1).strokeRoundedRect(bx, by, bw, bh, 10);
    };
    drawBtn(false);

    const btnLabel = this.add
      .text(cx, by + bh / 2, 'PLAY AGAIN', {
        fontFamily: 'monospace', fontSize: '22px', color: '#ffffff',
      })
      .setOrigin(0.5)
      .setDepth(103);

    // Click zone
    const zone = this.add.zone(cx, by + bh / 2, bw, bh).setInteractive({ useHandCursor: true }).setDepth(103);
    zone.on('pointerover',  () => drawBtn(true));
    zone.on('pointerout',   () => drawBtn(false));
    zone.on('pointerdown',  () => {
      this.tweens.add({
        targets: btnLabel, scaleX: 0.92, scaleY: 0.92,
        duration: 70, yoyo: true,
        onComplete: () => this.scene.restart(),
      });
    });
  }

  // ── plane drawing ────────────────────────────────────────────────────────────

  /**
   * Draw the neon fighter jet.
   * angle = 0 → nose points up; angle = PI/2 → nose points right.
   * Uses the Phaser local-to-world rotation: r(lx,ly) = (x + lx·cos(a) − ly·sin(a), y + lx·sin(a) + ly·cos(a))
   */
  private drawPlane(x: number, y: number, angle: number): void {
    const g = this.playerGfx;
    g.clear();

    const r = (lx: number, ly: number) => ({
      x: x + lx * Math.cos(angle) - ly * Math.sin(angle),
      y: y + lx * Math.sin(angle) + ly * Math.cos(angle),
    });

    // Soft ambient glow behind ship
    g.fillStyle(0x0099cc, 0.07); g.fillCircle(x, y, 34);
    g.fillStyle(0x00ccff, 0.10); g.fillCircle(x, y, 22);

    // ── Wings ──
    const drawWing = (side: number) => {
      const pts = [r(side * 7, -2), r(side * 22, 8), r(side * 17, 20), r(side * 5, 14)];
      g.fillStyle(0x004466, 1);
      g.beginPath(); g.moveTo(pts[0].x, pts[0].y);
      pts.slice(1).forEach(p => g.lineTo(p.x, p.y));
      g.closePath(); g.fillPath();
      g.lineStyle(1.2, 0x0077aa, 0.85);
      g.beginPath(); g.moveTo(pts[0].x, pts[0].y);
      pts.slice(1).forEach(p => g.lineTo(p.x, p.y));
      g.closePath(); g.strokePath();
      // Wing stripe
      const s1 = r(side * 10, 6), s2 = r(side * 18, 12);
      g.lineStyle(1, 0x00aacc, 0.4).lineBetween(s1.x, s1.y, s2.x, s2.y);
    };
    drawWing(-1); drawWing(1);

    // ── Tail fins ──
    const drawFin = (side: number) => {
      const pts = [r(side * 5, 10), r(side * 12, 22), r(side * 6, 19)];
      g.fillStyle(0x002233, 1);
      g.beginPath(); g.moveTo(pts[0].x, pts[0].y);
      pts.slice(1).forEach(p => g.lineTo(p.x, p.y));
      g.closePath(); g.fillPath();
      g.lineStyle(1, 0x005577, 0.6);
      g.beginPath(); g.moveTo(pts[0].x, pts[0].y);
      pts.slice(1).forEach(p => g.lineTo(p.x, p.y));
      g.closePath(); g.strokePath();
    };
    drawFin(-1); drawFin(1);

    // ── Main fuselage ──
    const body = [
      r(0, -26), r(5, -15), r(7, -2), r(5, 16), r(2, 24), r(0, 26),
      r(-2, 24), r(-5, 16), r(-7, -2), r(-5, -15),
    ];
    g.fillStyle(0x007799, 1);
    g.beginPath(); g.moveTo(body[0].x, body[0].y);
    body.slice(1).forEach(p => g.lineTo(p.x, p.y));
    g.closePath(); g.fillPath();

    // Fuselage highlight
    g.fillStyle(0x00bbdd, 0.45);
    const hl = [r(-1.5, -24), r(1.5, -24), r(2.5, 8), r(0, 22), r(-2.5, 8)];
    g.beginPath(); g.moveTo(hl[0].x, hl[0].y);
    hl.slice(1).forEach(p => g.lineTo(p.x, p.y));
    g.closePath(); g.fillPath();

    // Fuselage outline (neon glow)
    g.lineStyle(1.8, 0x00e5ff, 0.95);
    g.beginPath(); g.moveTo(body[0].x, body[0].y);
    body.slice(1).forEach(p => g.lineTo(p.x, p.y));
    g.closePath(); g.strokePath();

    // ── Cockpit ──
    const ckp = [r(0, -24), r(3.5, -16), r(2.5, -9), r(0, -6), r(-2.5, -9), r(-3.5, -16)];
    g.fillStyle(0x00ffff, 0.88);
    g.beginPath(); g.moveTo(ckp[0].x, ckp[0].y);
    ckp.slice(1).forEach(p => g.lineTo(p.x, p.y));
    g.closePath(); g.fillPath();
    // Cockpit glint
    const glint = r(-1, -20);
    g.fillStyle(0xffffff, 0.65).fillCircle(glint.x, glint.y, 1.5);

    // ── Engine nozzle at back ──
    const nozzle = r(0, 24);
    g.fillStyle(0x001122, 1).fillCircle(nozzle.x, nozzle.y, 5);
    g.lineStyle(1.5, 0x00e5ff, 0.5).strokeCircle(nozzle.x, nozzle.y, 5);
  }

  /**
   * Draw engine exhaust flame behind the ship.
   * angle = same convention as drawPlane.
   */
  private drawThruster(x: number, y: number, angle: number, speed: number): void {
    this.thrusterGfx.clear();
    if (speed < 25) return;

    // Engine nozzle position: local (0, 24) rotated
    const eng = {
      x: x + 0 * Math.cos(angle) - 24 * Math.sin(angle),
      y: y + 0 * Math.sin(angle) + 24 * Math.cos(angle),
    };
    // Exhaust direction = "downward in local space" = (-sin(a), cos(a)) in world
    const ex = -Math.sin(angle);
    const ey =  Math.cos(angle);
    const perp = { x: ey, y: -ex };  // perpendicular

    const len = Math.min(speed * 0.10, 32);
    const tip = { x: eng.x + ex * len, y: eng.y + ey * len };

    // Outer flame (orange)
    this.thrusterGfx.fillStyle(0xff7700, 0.70);
    this.thrusterGfx.fillTriangle(
      eng.x + perp.x * 5, eng.y + perp.y * 5,
      eng.x - perp.x * 5, eng.y - perp.y * 5,
      tip.x, tip.y,
    );
    // Inner flame (yellow-white)
    this.thrusterGfx.fillStyle(0xffee44, 0.55);
    this.thrusterGfx.fillTriangle(
      eng.x + perp.x * 2.5, eng.y + perp.y * 2.5,
      eng.x - perp.x * 2.5, eng.y - perp.y * 2.5,
      tip.x, tip.y,
    );
  }

  // ── helpers ──────────────────────────────────────────────────────────────────

  private fmtTime(ms: number): string {
    const s = ms / 1000;
    if (s < 60) return `${s.toFixed(1)}s`;
    const m = Math.floor(s / 60);
    return `${m}m ${(s % 60).toFixed(0)}s`;
  }

  // ── update loop ──────────────────────────────────────────────────────────────

  update(_time: number, delta: number): void {
    if (!this.alive) return;

    this.elapsed += delta;

    // ── HUD update ──
    this.timeText.setText(this.fmtTime(this.elapsed));
    const activeBullets = this.bullets.getChildren().filter(
      b => (b as Phaser.GameObjects.Image).active,
    ).length;
    this.bulletText.setText(`BULLETS: ${activeBullets}`);

    // ── Player movement ──
    const body = this.player.body as Phaser.Physics.Arcade.Body;
    const { left, right, up, down } = this.cursors;
    const { w, s, a, d } = this.wasd;

    let vx = 0, vy = 0;
    const keyHeld = left.isDown || right.isDown || up.isDown || down.isDown
                  || w.isDown || s.isDown || a.isDown || d.isDown;

    if (left.isDown  || a.isDown) vx -= PLAYER_SPEED;
    if (right.isDown || d.isDown) vx += PLAYER_SPEED;
    if (up.isDown    || w.isDown) vy -= PLAYER_SPEED;
    if (down.isDown  || s.isDown) vy += PLAYER_SPEED;

    // Normalise diagonal
    if (vx !== 0 && vy !== 0) { vx *= 0.7071; vy *= 0.7071; }

    // Mouse follow — active when no keys held
    const mx = this.input.mousePointer.x;
    const my = this.input.mousePointer.y;
    if (!keyHeld) {
      const dist = Phaser.Math.Distance.Between(this.player.x, this.player.y, mx, my);
      if (dist > 8) {
        const mAng = Phaser.Math.Angle.Between(this.player.x, this.player.y, mx, my);
        const mSpd = Math.min(dist * 4, PLAYER_SPEED);
        vx = Math.cos(mAng) * mSpd;
        vy = Math.sin(mAng) * mSpd;
      }
    }

    body.setVelocity(vx, vy);

    // ── Plane orientation — nose points toward mouse cursor ──
    // Phaser.Math.Angle.Between returns standard angle (right=0, CCW positive in math, CW on screen).
    // Our draw convention: angle=0 → nose up. Add PI/2 to convert.
    const drawAngle = Phaser.Math.Angle.Between(this.player.x, this.player.y, mx, my) + Math.PI / 2;
    const spd = Math.sqrt(vx * vx + vy * vy);

    this.drawPlane(this.player.x, this.player.y, drawAngle);
    this.drawThruster(this.player.x, this.player.y, drawAngle, spd);

    // ── Cull off-screen bullets ──
    const margin = 120;
    for (const b of this.bullets.getChildren()) {
      const bi = b as Phaser.Physics.Arcade.Image;
      if (!bi.active) continue;
      if (bi.x < -margin || bi.x > GAME_WIDTH + margin ||
          bi.y < -margin || bi.y > GAME_HEIGHT + margin) {
        bi.destroy();
      }
    }
  }
}
