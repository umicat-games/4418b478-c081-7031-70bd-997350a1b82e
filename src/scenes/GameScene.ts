import Phaser from 'phaser';
import {
  loadWorldScene,
  getEntityRegistry,
  getManifest,
  applyAssetHitbox,
  addTilemapCollider,
  getHudObject,
  Umicat,
  type Npc,
} from '@umicat/phaser-sdk';
import { GAME_WIDTH, GAME_HEIGHT } from '../config';
// Rex gesture helpers — no plugin registration needed
// @ts-ignore – rex has no bundled TS declarations for this path
import { Pan, Tap } from 'phaser3-rex-plugins/plugins/gestures.js';

// --- Wander tuning ---
// Set to `false` to PIN the cat at its spawn position (no roaming) — useful
// for verifying entity world coordinates against the editor rulers.
const CHILD_WANDER = true;
const CHILD_SPEED = 50;               // world-px per second (leisurely stroll)
// Cato strolls, then pauses (走走停停): alternate WALK phases and IDLE phases,
// each a random duration in these ranges.
const WALK_MIN_MS = 1200;
const WALK_MAX_MS = 2800;
const IDLE_MIN_MS = 900;
const IDLE_MAX_MS = 2600;

// --- Edge-scroll tuning (desktop / mouse, RTS / theme-park style) ---
const EDGE_MARGIN = 48;   // px from a canvas edge where scrolling kicks in
const EDGE_SPEED  = 900;  // scroll speed in SCREEN px/s (zoom-independent feel)

// Custom pointer-lock cursor: the texture key + hotspot live in CursorScene
// (which renders it above the HUD); GameScene only drives its position.

const GRASS_ISLAND_ENTITY_ID = 'e-mqveju7y-sk2r';

type FaceDir = 'down' | 'up' | 'left' | 'right';

export class GameScene extends Phaser.Scene {
  private sceneId!: string;

  // Child spirit
  private child?: Phaser.GameObjects.Sprite;
  private wanderTimer = 0;
  private wanderInterval = 2000;
  private wanderState: 'walk' | 'idle' = 'idle';
  private faceDir: FaceDir = 'down';

  // Edge-scroll: last mouse position over the canvas (game-resolution coords),
  // whether it's inside the canvas, and whether the last input was a mouse
  // (touch pans by drag instead). `overUi` suppresses edge-scroll while the
  // cursor is over a HUD control near an edge (e.g. the Find-cat button).
  private edgePointer = { x: 0, y: 0, inside: false, isMouse: false };
  private overUi = false;

  // Pointer lock (web-game standard: click to capture, Esc to release). While
  // locked we drive a VIRTUAL cursor from relative mouse deltas, clamped to the
  // canvas so it can't leave; edge-scroll + HUD clicks read it, not the OS
  // pointer (which is frozen under lock). `cursorSprite` is our drawn cursor.
  private locked = false;
  private vcursor = { x: GAME_WIDTH / 2, y: GAME_HEIGHT / 2 };
  private findCatBounds = new Phaser.Geom.Rectangle();
  // Shared cursor state read by CursorScene (which renders it above the HUD).
  private cursorState = { x: GAME_WIDTH / 2, y: GAME_HEIGHT / 2, visible: false };

  // Click-to-talk dialog: the chat-message / chat-input / chat-text HUD widgets
  // (authored visible:false) slide up on cat-click; an HTML <input> overlays the
  // chat-input box for typing; replies come from Cato (umicat.ai + playbook).
  private dialogOpen = false;
  private cato?: Npc;
  private aiBusy = false;
  // hud:submit (Enter) / hud:cancel (Esc) from the chat-input-field text-input.
  private onHudSubmit = (_id: string, value: string): void => {
    if (this.dialogOpen) void this.submitDialog(value);
  };
  private onHudCancel = (): void => {
    if (this.dialogOpen) this.closeDialog();
  };
  // Resting (anchored) y per dialog role — the open/close tween moves y, so we
  // remember where to slide back to.
  private dialogY: Record<string, number> = {};

  constructor() {
    super({ key: 'GameScene' });
  }

  init(data: { sceneId: string }): void {
    this.sceneId = data.sceneId;
  }

  async create(): Promise<void> {
    // Set zoom BEFORE awaiting scene load so the first frame is already correct.
    this.cameras.main.setZoom(3);
    this.cameras.main.roundPixels = true;
    // Pin the world origin (0,0) to the screen's TOP-LEFT corner. Phaser zooms
    // around the camera CENTER (default origin 0.5), so a raw setScroll(0,0) at
    // zoom>1 would start the view at +426/+240, not the origin. We offset the
    // scroll instead of changing the camera origin — setOrigin(0,0) breaks
    // tilemap-layer culling (tiles vanish). See originTopLeftScroll().
    const o = this.originTopLeftScroll();
    this.cameras.main.setScroll(o.x, o.y);

    const { sceneFile } = await loadWorldScene(this, this.sceneId);

    // Camera bounds = the water tilemap's extent (the world's outer edge) — set
    // DECLARATIVELY via `camera.bounds: { fitTo: "<water id>" }` in main.json, so
    // the SDK resolves it inside loadWorldScene AND the visual editor draws the
    // same boundary. (Was a hand-written fitCameraBoundsToContent() pass; SDK
    // 1.0.54's camera-bounds primitive replaces it.)
    // Default initial view = centre of the map (overridden to the cat below if
    // there is one). Starting at the bounds CORNER opened on empty water, since
    // the water tilemap's corner is blank.
    const cb = this.cameras.main.getBounds();
    this.cameras.main.setScroll(cb.centerX - GAME_WIDTH / 2, cb.centerY - GAME_HEIGHT / 2);

    const reg = getEntityRegistry(this)!;
    const childGO = reg.byRole('child')[0] as Phaser.GameObjects.Sprite | undefined;

    if (childGO) {
      this.child = childGO;

      // Physics body
      this.physics.add.existing(this.child);
      const body = this.child.body as Phaser.Physics.Arcade.Body;
      body.setCollideWorldBounds(false);

      // Vision-authored foot-area hitbox
      const manifest = getManifest(this);
      const assetId = this.child.getData('assetId') as string;
      const asset = manifest?.assets.find((a: { id: string }) => a.id === assetId);
      if (asset?.hitbox) applyAssetHitbox(this.child, asset);

      // Tilemap collision
      addTilemapCollider(this, GRASS_ISLAND_ENTITY_ID, this.child);

      // ── Camera: open CENTRED on the cat (the game's focus). Bounds were set
      // above; Phaser clamps this scroll into them. Player drives it after. ──
      const cam = this.cameras.main;
      cam.setScroll(this.child.x - GAME_WIDTH / 2, this.child.y - GAME_HEIGHT / 2);
      // No startFollow — the player controls the camera manually.

      // Allow two simultaneous pointers (pan + button tap at the same time)
      this.input.addPointer(1);

      // ── Drag-to-pan (TOUCH only) ───────────────────────────────────────
      // Dragging is the right gesture on a touchscreen; on desktop it felt
      // bad, so mouse uses edge-scroll instead (see updateEdgeScroll). We gate
      // the pan to touch input. threshold=10px so taps don't pan.
      const panGesture = new Pan(this, { threshold: 10 }) as Phaser.Events.EventEmitter;
      panGesture.on('panstart', () => {
        // Interrupt any running "find-cat" smooth-pan tween
        this.tweens.killTweensOf(cam);
      });
      panGesture.on('pan', (p: { dx: number; dy: number; pointer?: Phaser.Input.Pointer }) => {
        const pointer = p.pointer ?? this.input.activePointer;
        if (!pointer.wasTouch) return; // mouse → edge-scroll, not drag
        // dx/dy are screen pixels → divide by zoom to get world delta
        cam.scrollX -= p.dx / cam.zoom;
        cam.scrollY -= p.dy / cam.zoom;
        // Camera bounds (set by loadWorldScene) auto-clamp on preRender
      });

      // ── Edge-scroll (DESKTOP / mouse) ──────────────────────────────────
      // Track the mouse over the canvas; updateEdgeScroll() does the scrolling
      // per-frame so holding the cursor at an edge keeps moving (RTS feel).
      this.input.on('pointermove', (pointer: Phaser.Input.Pointer) => {
        this.edgePointer.x = pointer.x;
        this.edgePointer.y = pointer.y;
        this.edgePointer.inside = true;
        this.edgePointer.isMouse = !pointer.wasTouch;
      });
      this.input.on('gameout',  () => { this.edgePointer.inside = false; });
      this.input.on('gameover', () => { this.edgePointer.inside = true; });

      // ── Double-tap / double-click on empty space → find cat ────────────
      const tapGesture = new Tap(this, {
        tapInterval: 400,      // max ms between the two taps
        maxMovingDistance: 20, // threshold: larger moves = drag, not tap
      }) as Phaser.Events.EventEmitter;
      tapGesture.on('2tap', () => this.snapToChild());

      // ── "Find cat" button ──────────────────────────────────────────────
      this.buildFindCatButton();

      // ── Pointer lock + custom cursor (click to capture, Esc to release) ──
      this.setupPointerLock();

      // ── Runtime AI: Cato, the island spirit you guard ──
      // umicat.ai + the `cato` playbook (public/playbooks/cato.md). Fire-and-
      // forget — the npc is ready well before the player opens the dialog +
      // types. Inline role/style is a fallback if the playbook can't be loaded.
      void Umicat.init({})
        .then((u) => {
          this.cato = u?.ai.npc({
            playbook: 'cato',
            role: 'Cato — a small curious island spirit in Catopia; the player is your GUARDIAN (like a Pokémon and its trainer), never a parent.',
            style: "warm, whimsical, 1-3 short sentences; reply in the guardian's language",
          });
        })
        .catch(() => {
          /* leave this.cato undefined; submitDialog handles a missing npc */
        });

      // The chat-input-field text-input (SDK 1.0.28) emits these on the global
      // game bus: hud:submit (Enter) → ask Cato, hud:cancel (Esc) → close.
      this.game.events.on('hud:submit', this.onHudSubmit);
      this.game.events.on('hud:cancel', this.onHudCancel);

      if (CHILD_WANDER) {
        this.startWanderIdle(); // stands a beat, then strolls off
      } else {
        // Pinned: no velocity, no walk animation — cat stands at spawn.
        (this.child.body as Phaser.Physics.Arcade.Body).setVelocity(0, 0);
        this.child.anims?.stop();
      }
    }

    if (sceneFile.entities.length === 0) {
      this.add.text(GAME_WIDTH / 2, GAME_HEIGHT / 2, 'Describe your game\nin the chat!', {
        fontSize: '28px', color: '#ffffff', align: 'center',
      }).setOrigin(0.5);
    }
  }

  /**
   * Scroll values that put world (0,0) at the screen's TOP-LEFT corner.
   * Phaser's camera zooms around its CENTER (default origin 0.5), so the world
   * coord at the left edge is `scrollX + (w/2)(1 - 1/zoom)`, not `scrollX`.
   * Solving that = 0 gives the offset below.
   */
  private originTopLeftScroll(): { x: number; y: number } {
    const z = this.cameras.main.zoom;
    return {
      x: -(GAME_WIDTH  / 2) * (1 - 1 / z),
      y: -(GAME_HEIGHT / 2) * (1 - 1 / z),
    };
  }

  // ── "Find cat" — smooth tween back to the child ───────────────────────

  private snapToChild(): void {
    if (!this.child) return;
    const cam = this.cameras.main;
    // Kill any previous snap tween so they don't stack
    this.tweens.killTweensOf(cam);
    // Centre the child: with origin 0.5 the world coord at screen-centre is
    // `scrollX + w/2`, so scrollX = child.x - w/2 (NOT /zoom — that was the
    // origin-0 form and left the cat off-centre).
    this.tweens.add({
      targets: cam,
      scrollX: this.child.x - GAME_WIDTH  / 2,
      scrollY: this.child.y - GAME_HEIGHT / 2,
      duration: 520,
      ease: 'Quad.easeOut',
    });
  }

  // ── "Find cat" button — warm cozy pill, fixed to top-right ───────────

  private buildFindCatButton(): void {
    // Cato's portrait in the top-right photo-frame (a HUD widget) IS the
    // "find cat" button \u2014 clicking it recenters the camera on Cato. Match the
    // frame's screen rect (top-right anchor, 64x64, 16px safe-area) so the
    // hit-test lands exactly on the frame. No extra chrome is drawn here \u2014 the
    // frame + animated portrait ARE the button.
    const BW = 64; const BH = 64;
    const bx = GAME_WIDTH - 16 - BW / 2;
    const by = 16 + BH / 2;
    // Remember bounds so the virtual cursor can hit-test the frame under lock.
    this.findCatBounds.setTo(bx - BW / 2, by - BH / 2, BW, BH);

    // Transparent hit-rect for NON-locked clicks (under pointer lock,
    // handleLockedClick reads findCatBounds instead).
    this.add.rectangle(bx, by, BW, BH, 0x000000, 0)
      .setDepth(1002).setScrollFactor(0)
      .setInteractive({ useHandCursor: true })
      .on('pointerover',  () => { this.overUi = true; })
      .on('pointerout',   () => { this.overUi = false; })
      .on('pointerdown',  () => this.snapToChild());
  }

  // ── Pointer lock + custom cursor ──────────────────────────────────────

  private setupPointerLock(): void {
    // Publish cursor state for CursorScene (renders it above the HUD), then
    // launch that overlay on top — AFTER loadWorldScene, so it sits above the
    // HUD scene the SDK created during the world load.
    this.registry.set('cursor', this.cursorState);
    if (!this.scene.isActive('CursorScene')) this.scene.launch('CursorScene');
    this.scene.bringToTop('CursorScene');

    // Click the canvas → capture the mouse. If already locked, the click is a
    // game/HUD action routed through the virtual cursor (the OS pointer is
    // frozen under lock, so Phaser's own hit-testing can't see the cursor).
    this.input.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
      // Dialog open: a canvas click (outside the HTML input, which sits on top
      // and swallows its own clicks) dismisses it.
      if (this.dialogOpen) { this.closeDialog(); return; }
      if (this.locked) { this.handleLockedClick(); return; }
      // Not locked yet: clicking the cat opens the dialog; anything else
      // captures the pointer (the normal edge-scroll / camera mode).
      const wp = this.cameras.main.getWorldPoint(pointer.x, pointer.y);
      if (this.catContains(wp.x, wp.y)) { this.openDialog(); return; }
      this.input.manager.mouse?.requestPointerLock();
    });

    // Esc closes the dialog (also releases pointer lock — browser-enforced).
    this.input.keyboard?.on('keydown-ESC', () => { if (this.dialogOpen) this.closeDialog(); });

    // While locked, accumulate RELATIVE mouse movement into the virtual cursor,
    // clamped to the canvas so it can never leave.
    this.input.on('pointermove', (pointer: Phaser.Input.Pointer) => {
      if (!this.locked) return;
      const cam = this.cameras.main;
      this.vcursor.x = Phaser.Math.Clamp(this.vcursor.x + pointer.movementX, 0, cam.width);
      this.vcursor.y = Phaser.Math.Clamp(this.vcursor.y + pointer.movementY, 0, cam.height);
    });

    // Lock state via the native event (most reliable; browser Esc unlocks).
    const onLockChange = () => {
      this.locked = document.pointerLockElement === this.game.canvas;
      this.cursorState.visible = this.locked;
      if (this.locked) {
        // Start the virtual cursor where the OS cursor was.
        this.vcursor.x = Phaser.Math.Clamp(this.input.activePointer.x, 0, this.cameras.main.width);
        this.vcursor.y = Phaser.Math.Clamp(this.input.activePointer.y, 0, this.cameras.main.height);
      }
    };
    document.addEventListener('pointerlockchange', onLockChange);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      document.removeEventListener('pointerlockchange', onLockChange);
      this.game.events.off('hud:submit', this.onHudSubmit);
      this.game.events.off('hud:cancel', this.onHudCancel);
    });
  }

  /** Route a click (while pointer-locked) to HUD via the virtual cursor. */
  private handleLockedClick(): void {
    if (Phaser.Geom.Rectangle.Contains(this.findCatBounds, this.vcursor.x, this.vcursor.y)) {
      this.snapToChild();
      return;
    }
    // The virtual cursor is in canvas px; convert to world to hit-test the cat.
    const wp = this.cameras.main.getWorldPoint(this.vcursor.x, this.vcursor.y);
    if (this.catContains(wp.x, wp.y)) this.openDialog();
  }

  // ── Click-to-talk dialog ──────────────────────────────────────────────

  /** True if a world point lands on the cat sprite. */
  private catContains(worldX: number, worldY: number): boolean {
    if (!this.child) return false;
    return this.child.getBounds().contains(worldX, worldY);
  }

  /** The chat widgets, by role, that slide up together (the `chat-input-field`
   *  text-input widget drives its own synced DOM <input> + emits hud:submit). */
  private static DIALOG_ROLES = ['chat-message', 'chat-input', 'chat-text', 'chat-input-field'];

  /** Reveal the chat HUD widgets (slide UP from the bottom) + a typing input. */
  private openDialog(): void {
    if (this.dialogOpen || !this.child) return;
    this.dialogOpen = true;
    // Release pointer lock so the DOM <input> reliably takes keyboard focus (and
    // a dialog WANTS a free cursor to click the field / scroll the message). To
    // avoid the jarring jump to the host arrow, swap the canvas cursor to the
    // game's own pixel cursor via CSS — visually seamless. Restored on close.
    if (this.locked) document.exitPointerLock();
    this.game.canvas.style.cursor = "url('uploaded/triangle_mouse_icon_1.png') 0 0, default";
    this.registry.set('catoDialogText', 'Cato perks up, watching you.');
    for (const role of GameScene.DIALOG_ROLES) {
      const go = getHudObject(this, role) as unknown as
        | { x: number; y: number; setVisible?: (v: boolean) => void; setAlpha?: (a: number) => void }
        | undefined;
      if (!go) continue;
      // Remember the anchored resting y the first time (the tween moves y).
      if (this.dialogY[role] === undefined) this.dialogY[role] = go.y;
      const restY = this.dialogY[role];
      go.setVisible?.(true);
      go.setAlpha?.(0);
      go.y = restY + 140; // start below → slides up
      this.tweens.add({ targets: go, y: restY, alpha: 1, duration: 300, ease: 'Back.easeOut' });
    }
    // The chat-input-field text-input widget shows + focuses its own DOM input
    // (SDK 1.0.28) the moment it goes visible above — no manual input to create.
  }

  /** Hide the dialog (slide back down) + tear down the typing input. */
  private closeDialog(): void {
    if (!this.dialogOpen) return;
    this.dialogOpen = false;
    // Drop the CSS game-cursor; clicking the canvas re-captures the pointer and
    // the CursorScene's custom cursor takes over again.
    this.game.canvas.style.cursor = '';
    for (const role of GameScene.DIALOG_ROLES) {
      const go = getHudObject(this, role) as unknown as
        | { y: number; setVisible?: (v: boolean) => void }
        | undefined;
      if (!go) continue;
      const restY = this.dialogY[role] ?? go.y;
      this.tweens.add({
        targets: go,
        y: restY + 140,
        alpha: 0,
        duration: 180,
        ease: 'Quad.easeIn',
        onComplete: () => {
          go.setVisible?.(false);
          go.y = restY; // reset for the next open
        },
      });
    }
  }

  /** Player submitted a line (from the chat-input-field's `hud:submit` event)
   *  → ask Cato (umicat.ai + the cato playbook). The widget clears itself. */
  private async submitDialog(text: string): Promise<void> {
    const t = text.trim();
    if (!t || this.aiBusy || !this.dialogOpen) return;
    this.aiBusy = true;
    this.registry.set('catoDialogText', 'Cato is thinking…');
    try {
      if (!this.cato) {
        this.registry.set('catoDialogText', "Cato tilts its head — it can't quite hear you right now.");
        return;
      }
      const r = await this.cato.say(t, {
        observation: { island: 'home', timeOfDay: 'day' },
      });
      if (r.ok) {
        this.registry.set('catoDialogText', r.say || 'Cato just blinks at you.');
      } else if (r.reason === 'SIGN_IN_REQUIRED') {
        this.registry.set('catoDialogText', "Cato peers past you — sign in and we can really talk.");
      } else if (r.reason === 'INSUFFICIENT_CREDITS') {
        this.registry.set('catoDialogText', 'Cato yawns — out of energy for now.');
      } else {
        this.registry.set('catoDialogText', "Cato's ears droop — it couldn't find the words just now.");
      }
    } finally {
      this.aiBusy = false;
    }
  }

  // ── Wandering AI helpers ──────────────────────────────────────────────

  private velToDir(vx: number, vy: number): FaceDir {
    if (Math.abs(vx) >= Math.abs(vy)) return vx >= 0 ? 'right' : 'left';
    return vy >= 0 ? 'down' : 'up';
  }

  /** Begin a WALK phase: pick a random heading, face + play the walk anim. */
  private startWanderWalk(): void {
    if (!this.child?.body) return;
    const body = this.child.body as Phaser.Physics.Arcade.Body;
    const angle = Phaser.Math.FloatBetween(0, Math.PI * 2);
    const vx = Math.cos(angle) * CHILD_SPEED;
    const vy = Math.sin(angle) * CHILD_SPEED;
    body.setVelocity(vx, vy);
    this.faceDir = this.velToDir(vx, vy);
    this.child.play(`walk-${this.faceDir}`, true);
    this.wanderState = 'walk';
    this.wanderInterval = Phaser.Math.Between(WALK_MIN_MS, WALK_MAX_MS);
    this.wanderTimer = 0;
  }

  /** Begin an IDLE phase: stop and play the idle anim facing the last way. */
  private startWanderIdle(): void {
    if (!this.child?.body) return;
    const body = this.child.body as Phaser.Physics.Arcade.Body;
    body.setVelocity(0, 0);
    this.child.play(`idle-${this.faceDir}`, true);
    this.wanderState = 'idle';
    this.wanderInterval = Phaser.Math.Between(IDLE_MIN_MS, IDLE_MAX_MS);
    this.wanderTimer = 0;
  }

  /**
   * RTS / theme-park edge scrolling (desktop): when the cursor rests within
   * EDGE_MARGIN of a canvas edge, scroll the camera that way at EDGE_SPEED
   * (screen px/s, divided by zoom so the on-screen speed is the same at any
   * zoom). Holding the cursor at the edge keeps scrolling because we read the
   * position every frame.
   *
   * Gated on pointer-lock: edge-scroll ONLY runs while the mouse is CAPTURED,
   * driven by the virtual cursor (always clamped inside the canvas). When NOT
   * locked the OS cursor can sit at — or leave through — the window edge, which
   * used to keep pushing the camera even with the mouse off-screen. Click to
   * capture first; touch pans by drag (and never locks), so it's unaffected.
   */
  private updateEdgeScroll(delta: number): void {
    if (this.dialogOpen) return; // typing — don't pan when the mouse moves
    if (!this.locked) return;
    const cam = this.cameras.main;
    const px = this.vcursor.x;
    const py = this.vcursor.y;
    // Don't scroll while the cursor is over the Find-cat button.
    if (Phaser.Geom.Rectangle.Contains(this.findCatBounds, px, py)) return;
    let dx = 0;
    let dy = 0;
    if (px < EDGE_MARGIN) dx = -1;
    else if (px > cam.width - EDGE_MARGIN) dx = 1;
    if (py < EDGE_MARGIN) dy = -1;
    else if (py > cam.height - EDGE_MARGIN) dy = 1;
    if (dx === 0 && dy === 0) return;
    const step = (EDGE_SPEED * delta) / 1000 / cam.zoom; // screen px/s → world
    cam.scrollX += dx * step;
    cam.scrollY += dy * step;
    // Camera bounds (set by loadWorldScene) auto-clamp on preRender.
  }

  update(_time: number, delta: number): void {
    this.updateEdgeScroll(delta);

    // Publish the virtual cursor to CursorScene (renders it above the HUD).
    this.cursorState.x = this.vcursor.x;
    this.cursorState.y = this.vcursor.y;
    this.cursorState.visible = this.locked;

    if (!this.child?.body) return;
    if (!CHILD_WANDER) return; // pinned — skip wander (edge-scroll already ran)
    const body = this.child.body as Phaser.Physics.Arcade.Body;

    // Cato stops to talk — freeze the stroll while the chat dialog is open.
    if (this.dialogOpen) {
      if (this.wanderState !== 'idle') this.startWanderIdle();
      return;
    }

    // Bumped into a boundary mid-stroll → turn and head off a fresh way.
    if (
      this.wanderState === 'walk' &&
      (body.blocked.left || body.blocked.right || body.blocked.up || body.blocked.down)
    ) {
      this.startWanderWalk();
      return;
    }

    // Alternate WALK ⇄ IDLE so Cato wanders, then pauses (走走停停).
    this.wanderTimer += delta;
    if (this.wanderTimer >= this.wanderInterval) {
      if (this.wanderState === 'walk') this.startWanderIdle();
      else this.startWanderWalk();
    }
  }
}
