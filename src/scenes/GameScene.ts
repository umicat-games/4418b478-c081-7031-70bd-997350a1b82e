import Phaser from 'phaser';
import {
  loadWorldScene,
  getEntityRegistry,
  getManifest,
  applyAssetHitbox,
  addTilemapCollider,
  getHudObjects,
} from '@umicat/phaser-sdk';
import { GAME_WIDTH, GAME_HEIGHT } from '../config';
// Rex gesture helpers — no plugin registration needed
// @ts-ignore – rex has no bundled TS declarations for this path
import { Pan, Tap } from 'phaser3-rex-plugins/plugins/gestures.js';

// --- Wander tuning ---
// Set to `false` to PIN the cat at its spawn position (no roaming) — useful
// for verifying entity world coordinates against the editor rulers. Flip back
// to `true` to restore the wandering behaviour.
const CHILD_WANDER = false;
const CHILD_SPEED = 55;               // world-px per second
const WANDER_MIN_MS = 1500;
const WANDER_MAX_MS = 3500;

// --- Edge-scroll tuning (desktop / mouse, RTS / theme-park style) ---
const EDGE_MARGIN = 48;   // px from a canvas edge where scrolling kicks in
const EDGE_SPEED  = 900;  // scroll speed in SCREEN px/s (zoom-independent feel)

// Custom pointer-lock cursor: the texture key + hotspot live in CursorScene
// (which renders it above the HUD); GameScene only drives its position.

const GRASS_ISLAND_ENTITY_ID = 'e-mqveju7y-sk2r';
// The water tilemap is the world's outer edge — the camera is clamped to it.
const WATER_ENTITY_ID = 'e-mqvdaooj-fzpk';

type FaceDir = 'down' | 'up' | 'left' | 'right';

export class GameScene extends Phaser.Scene {
  private sceneId!: string;

  // Child spirit
  private child?: Phaser.GameObjects.Sprite;
  private wanderTimer = 0;
  private wanderInterval = 2000;
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

  // Click-to-talk dialog (role 'cat-dialog' HUD widgets, authored visible:false).
  // Opened by clicking the cat; an HTML <input> overlays the canvas for typing.
  private dialogOpen = false;
  private dialogInput?: HTMLInputElement;

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

    // Expand the camera bounds to enclose ALL painted content. The scene's
    // default bounds are just (0,0,worldW,worldH) = the positive quadrant, so
    // content placed at negative coords (up-left of the origin) was unreachable
    // — the camera clamped at the origin. Then open at the map's top-left
    // corner so the whole map is pannable.
    this.fitCameraBoundsToContent();
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

      if (CHILD_WANDER) {
        this.pickNewWanderDirection();
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

  /**
   * Set the camera bounds = the WATER tilemap's extent. Water is the world's
   * outer edge (the player's design), so the camera can never pan past it — no
   * void beyond the ocean. Phaser clamps the camera's VIEW inside these bounds.
   * Falls back to the tight union of all world content if the water layer can't
   * be measured (so the bounds still cover everything, just without the
   * water-is-canonical guarantee).
   */
  private fitCameraBoundsToContent(): void {
    const cam = this.cameras.main;

    // Preferred: clamp to the water tilemap exactly.
    const waterGO = getEntityRegistry(this)?.byId(WATER_ENTITY_ID) as
      | (Phaser.GameObjects.GameObject & { getBounds?: () => Phaser.Geom.Rectangle })
      | undefined;
    const wb = waterGO?.getBounds?.();
    if (wb && isFinite(wb.width) && wb.width > 0 && wb.height > 0) {
      cam.setBounds(wb.x, wb.y, wb.width, wb.height);
      return;
    }

    // Fallback: tight union of all world content (no padding → flush to edge).
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const obj of this.children.list) {
      const go = obj as Phaser.GameObjects.GameObject & {
        getBounds?: () => Phaser.Geom.Rectangle;
        scrollFactorX?: number;
      };
      if (typeof go.getBounds !== 'function') continue;
      if (go.scrollFactorX === 0) continue; // screen-fixed HUD — not world content
      const b = go.getBounds();
      if (!isFinite(b.width) || !isFinite(b.height) || (b.width === 0 && b.height === 0)) continue;
      minX = Math.min(minX, b.x);
      minY = Math.min(minY, b.y);
      maxX = Math.max(maxX, b.right);
      maxY = Math.max(maxY, b.bottom);
    }
    if (!isFinite(minX)) return; // nothing to measure — keep the loader's bounds
    cam.setBounds(minX, minY, maxX - minX, maxY - minY);
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
    const BW = 104; const BH = 32; const R = 10;
    const bx = GAME_WIDTH - 14 - BW / 2;
    const by = 14 + BH / 2;
    // Remember bounds so the virtual cursor can hit-test the button under lock.
    this.findCatBounds.setTo(bx - BW / 2, by - BH / 2, BW, BH);

    const bg = this.add.graphics().setDepth(1000).setScrollFactor(0);

    const draw = (hover: boolean) => {
      bg.clear();
      bg.fillStyle(hover ? 0xa07840 : 0x5c3e18, 0.90);
      bg.fillRoundedRect(bx - BW / 2, by - BH / 2, BW, BH, R);
      bg.lineStyle(1.5, 0xe8c87a, 0.80);
      bg.strokeRoundedRect(bx - BW / 2, by - BH / 2, BW, BH, R);
    };
    draw(false);

    this.add.text(bx, by, 'Find cat  \u25cf', {
      fontSize: '12px', color: '#f5dfa0', fontFamily: 'sans-serif',
    }).setOrigin(0.5).setDepth(1001).setScrollFactor(0);

    // Transparent hit-rectangle layered on top for clean touch target
    this.add.rectangle(bx, by, BW, BH, 0x000000, 0)
      .setDepth(1002).setScrollFactor(0)
      .setInteractive({ useHandCursor: true })
      .on('pointerover',  () => { this.overUi = true;  draw(true); })
      .on('pointerout',   () => { this.overUi = false; draw(false); })
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
      this.dialogInput?.remove();
      this.dialogInput = undefined;
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

  /** Reveal the 'cat-dialog' HUD widgets (fade in) + overlay a typing input. */
  private openDialog(): void {
    if (this.dialogOpen || !this.child) return;
    this.dialogOpen = true;
    // Free the OS cursor so the user can type into the HTML input (the custom
    // cursor hides itself since `cursorState.visible` follows `locked`).
    if (this.locked) document.exitPointerLock();
    // Seed the body text (the NPC's line). The brain (umicat.ai.npc) wires in
    // later — for now it's a static prompt the player answers.
    this.registry.set('catDialogBody', 'Do you want me to travel to another island?');
    for (const go of getHudObjects(this, 'cat-dialog')) {
      const w = go as unknown as { setVisible?: (v: boolean) => void; setAlpha?: (a: number) => void };
      w.setVisible?.(true);
      w.setAlpha?.(0);
      this.tweens.add({ targets: go, alpha: 1, duration: 200, ease: 'Quad.easeOut' });
    }
    this.showDialogInput();
  }

  /** Hide the dialog (fade out) + tear down the typing input. */
  private closeDialog(): void {
    if (!this.dialogOpen) return;
    this.dialogOpen = false;
    for (const go of getHudObjects(this, 'cat-dialog')) {
      this.tweens.add({
        targets: go,
        alpha: 0,
        duration: 150,
        onComplete: () => (go as unknown as { setVisible?: (v: boolean) => void }).setVisible?.(false),
      });
    }
    this.dialogInput?.remove();
    this.dialogInput = undefined;
  }

  /** Create + position the HTML <input> over the dialog and focus it. */
  private showDialogInput(): void {
    if (this.dialogInput) return;
    const input = document.createElement('input');
    input.type = 'text';
    input.placeholder = 'Say something to Nico…';
    input.style.cssText =
      'position:fixed; z-index:99999; box-sizing:border-box;' +
      'padding:8px 12px; border-radius:8px; border:2px solid #e8c87a;' +
      'background:#3a2a14; color:#fff; font-size:15px; outline:none;' +
      'font-family:sans-serif;';
    this.positionDialogInput(input);
    input.addEventListener('keydown', (e) => {
      e.stopPropagation(); // don't let game shortcuts swallow typing
      if (e.key === 'Enter') this.submitDialog(input.value);
      else if (e.key === 'Escape') this.closeDialog();
    });
    document.body.appendChild(input);
    this.dialogInput = input;
    setTimeout(() => input.focus(), 0);
  }

  /** Place the input over the dialog (bottom-centre of the canvas). */
  private positionDialogInput(input: HTMLInputElement): void {
    const r = this.game.canvas.getBoundingClientRect();
    const w = Math.min(520, r.width * 0.8);
    input.style.width = `${w}px`;
    input.style.left = `${r.left + r.width / 2 - w / 2}px`;
    input.style.top = `${r.bottom - r.height * 0.13}px`;
  }

  /** Player submitted a line. Echo it for now; umicat.ai.npc replaces this. */
  private submitDialog(text: string): void {
    const t = text.trim();
    if (!t) return;
    this.registry.set('catDialogBody', `You: ${t}`);
    if (this.dialogInput) this.dialogInput.value = '';
  }

  // ── Wandering AI helpers ──────────────────────────────────────────────

  private velToDir(vx: number, vy: number): FaceDir {
    if (Math.abs(vx) >= Math.abs(vy)) return vx >= 0 ? 'right' : 'left';
    return vy >= 0 ? 'down' : 'up';
  }

  private pickNewWanderDirection(): void {
    if (!this.child?.body) return;
    const body = this.child.body as Phaser.Physics.Arcade.Body;
    const angle = Phaser.Math.FloatBetween(0, Math.PI * 2);
    const vx = Math.cos(angle) * CHILD_SPEED;
    const vy = Math.sin(angle) * CHILD_SPEED;
    body.setVelocity(vx, vy);
    this.faceDir = this.velToDir(vx, vy);
    this.child.play(`walk-${this.faceDir}`, true);
    this.wanderInterval = Phaser.Math.Between(WANDER_MIN_MS, WANDER_MAX_MS);
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

    if (body.blocked.left || body.blocked.right || body.blocked.up || body.blocked.down) {
      this.pickNewWanderDirection();
      return;
    }

    this.wanderTimer += delta;
    if (this.wanderTimer >= this.wanderInterval) {
      this.pickNewWanderDirection();
    }
  }
}
