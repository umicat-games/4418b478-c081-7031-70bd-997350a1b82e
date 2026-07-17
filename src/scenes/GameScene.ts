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
import { GAME_WIDTH, GAME_HEIGHT, DESIGN_ZOOM } from '../config';
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

// --- Camera keys (WASD / arrow keys pan the camera) ---
// Cato roams on his own (CHILD_WANDER); the PLAYER pans the camera with WASD /
// arrow keys (in addition to mouse edge-scroll). Holding a key scrolls that way.
const KEY_PAN_SPEED = 700; // screen px/s (÷ zoom → same on-screen feel at any zoom)

// --- Y-sort debug ---
// Draws a magenta horizontal line at each sprite's FOOT line (the value used for
// depth sorting) so you can SEE where the front/behind flip happens. Set true
// again if the layering ever needs re-checking.
const YSORT_DEBUG = false;

// --- Edge-scroll tuning (desktop / mouse, RTS / theme-park style) ---
const EDGE_MARGIN = 48;   // px from a canvas edge where scrolling kicks in
const EDGE_SPEED  = 900;  // scroll speed in SCREEN px/s (zoom-independent feel)

// --- Adaptive zoom (RESIZE mode) ---
// The canvas fills the screen (any size), so instead of a fixed zoom we pick an
// INTEGER zoom that keeps ~the same amount of world visible across devices —
// crisp pixels (integer only) + consistent framing. DESIGN_ZOOM (in config.ts,
// also handed to the SDK via createUmicatGame's referenceZoom) is the reference:
// at the design canvas the zoom is DESIGN_ZOOM, targeting
// ~ (GAME_WIDTH/DESIGN_ZOOM) × (GAME_HEIGHT/DESIGN_ZOOM) world px everywhere.
const MIN_ZOOM = 1;
const MAX_ZOOM = 8;

// Tilemap cell size (px) — all Catopia tilesets are 16×16.
const TILE = 16;

// --- Cato "till a plot" behaviour ---
const CATO_TILL_SPEED = 60;   // world-px/s Cato walks toward each plot cell
const CATO_ARRIVE_DIST = 3;   // px from a cell centre that counts as "arrived"
// The attack (hoe) anim is 8 frames at the SDK's default 8fps ≈ 1000ms. Hold Cato
// for the whole swing, and flip the cell to soil near the end (as the hoe lands).
const CATO_TILL_STEP_MS = 1000; // pause on each cell = one full attack swing
const CATO_TILL_STRIKE_MS = 720; // when in the swing the hoe strikes → soil + dirt
const CATO_PLOT_SEARCH_R = 10; // tiles around Cato to search for an open plot
const CATO_PLOT_MAX = 4;      // clamp the requested plot side (N×N)
// DEV: press T to trigger a test 3×3 till near Cato WITHOUT the AI (no sign-in /
// no credits) — for iterating on the tilling visuals. Set false before release.
const CATO_DEBUG_TILL = true;

// Custom pointer-lock cursor: the texture key + hotspot live in CursorScene
// (which renders it above the HUD); GameScene only drives its position.

// Fallback id for the grass-island tilemap. Re-dragging a tilemap in the editor
// CHANGES its entity id, so we resolve it by the stable NAME ('island') at
// runtime (see create()) and only fall back to this if the name lookup fails.
const GRASS_ISLAND_ENTITY_ID = 'e-mr1hfmhm-totv';
const GRASS_ISLAND_NAME = 'island';

type FaceDir = 'down' | 'up' | 'left' | 'right';

type ToolId = 'hand' | 'hoe';

// Inventory grid (Stardew-style): a backpack of INV_ROWS × INV_COLS cells. Row 0
// IS the hotbar (always visible); pressing E opens the full grid. Growing the
// backpack later = bump INV_ROWS. Stackable items merge up to MAX_STACK per cell.
const INV_COLS = 8;
const INV_ROWS = 3;
const MAX_STACK = 99;

/** One stack of items in a single inventory/hotbar cell. Tools are
 *  non-stackable (count 1, carry a `toolId` they equip on select); seeds /
 *  materials stack up to MAX_STACK. `id` is the merge key. An empty cell = null. */
interface ItemStack {
  id: string;
  label?: string;
  iconKey?: string;
  iconFrame?: string;
  count: number;
  stackable: boolean;
  toolId?: ToolId;
}

export class GameScene extends Phaser.Scene {
  private sceneId!: string;

  // Child spirit
  private child?: Phaser.GameObjects.Sprite;
  private wanderTimer = 0;
  private wanderInterval = 2000;
  private wanderState: 'walk' | 'idle' = 'idle';
  private faceDir: FaceDir = 'down';

  // WASD / arrow keys — pan the camera (Cato roams on his own).
  private keys?: Record<'up' | 'down' | 'left' | 'right' | 'w' | 'a' | 's' | 'd', Phaser.Input.Keyboard.Key>;
  // Every world sprite (Cato + decoration props like the sunflower). Depth-
  // sorted by foot Y each frame so Cato passes IN FRONT OF / BEHIND them.
  private ySortSprites: Phaser.GameObjects.Sprite[] = [];
  private ysortDebug?: Phaser.GameObjects.Graphics;

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
  private findCatHit?: Phaser.GameObjects.Rectangle;
  // Camera lock: clicking Cato's portrait makes the camera FOLLOW him around;
  // clicking elsewhere on the map releases it (back to manual edge-scroll pan).
  private cameraFollow = false;
  // Shared cursor state read by CursorScene (which renders it above the HUD).
  private cursorState = { x: GAME_WIDTH / 2, y: GAME_HEIGHT / 2, visible: false };

  // ── Farming (hoe → till grass) ──────────────────────────────────────────
  // Minecraft-style: pick the hoe (key 2; 1 = empty hand), a bracket cursor
  // snaps to the grass tile under the mouse, click tills it. `islandLayer` is
  // the grass-island TilemapLayer (for world↔tile snapping + "is this grass?").
  private activeTool: ToolId = 'hand';
  private islandLayer?: Phaser.Tilemaps.TilemapLayer;
  private tileCursor?: Phaser.GameObjects.Image; // bracket that frames the target cell
  private hoeIcon?: Phaser.GameObjects.Image; // the held-tool icon shown inside the bracket
  private tilledCells = new Set<string>(); // "cx,cy" already tilled (idempotent)
  private tilledSoil = new Map<string, Phaser.GameObjects.Image>(); // cell → soil sprite (autotile frame)
  private hoverCell: { cx: number; cy: number } | null = null; // farmable cell under cursor

  // ── Inventory + hotbar (HotbarScene + InventoryScene render; GameScene owns
  //    the MODEL) ─────────────────────────────────────────────────────────
  // `inventory` is the full INV_ROWS×INV_COLS backpack; row 0 (the first
  // INV_COLS cells) is the hotbar. HotbarScene draws row 0 + writes each slot's
  // canvas-px hit-box to `hotbarBounds`; InventoryScene draws the whole grid
  // when `inventoryOpen` + writes `inventoryBounds`. Number keys 1..N and
  // clicking a hotbar slot select it; E opens the backpack; clicking cells there
  // picks up / drops / merges stacks (heldStack follows the cursor). `*Rev` is
  // bumped on change so the scenes re-render.
  private inventory: (ItemStack | null)[] = [];
  private hotbarSelected = -1; // selected cell in row 0 (-1 = empty hand)
  private inventoryOpen = false;
  private heldStack: ItemStack | null = null; // picked-up stack following the cursor
  private invRev = 0;

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

  // ── Cato behaviours (runtime-AI `do` actions) ───────────────────────────
  // When the guardian asks Cato (in chat) to prepare a plot, the AI returns a
  // `till_plot` action; we find an open grass patch near Cato, queue its cells,
  // and Cato walks over + hoes each one (reusing the farming tillCell mechanic).
  // A single active task at a time; it overrides the autonomous wander.
  private catoTask: { type: 'till'; queue: Array<{ cx: number; cy: number }>; crop: string; cooldown: number } | null = null;

  constructor() {
    super({ key: 'GameScene' });
  }

  init(data: { sceneId: string }): void {
    this.sceneId = data.sceneId;
  }

  async create(): Promise<void> {
    // Set zoom BEFORE awaiting scene load so the first frame is already correct.
    this.cameras.main.setZoom(this.computeZoom());
    this.cameras.main.roundPixels = true;
    // RESIZE mode: recompute zoom + re-centre + re-layout screen UI on any
    // canvas resize (device rotation, window change, phone vs desktop).
    this.scale.on(Phaser.Scale.Events.RESIZE, this.onResize, this);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () =>
      this.scale.off(Phaser.Scale.Events.RESIZE, this.onResize, this),
    );
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
    this.cameras.main.setScroll(cb.centerX - this.scale.width / 2, cb.centerY - this.scale.height / 2);

    const reg = getEntityRegistry(this)!;
    const childGO = reg.byRole('child')[0] as Phaser.GameObjects.Sprite | undefined;

    // Y-sort: collect every world sprite (Cato + decoration sprites like the
    // sunflower). `applyYSort` (in update) sets each one's depth = its foot Y so
    // whoever stands lower on the map draws IN FRONT — Cato walks before/behind
    // props instead of always over/under them.
    this.ySortSprites = reg.all().filter(
      (go) => go.getData('entityKind') === 'sprite',
    ) as Phaser.GameObjects.Sprite[];
    if (YSORT_DEBUG) this.ysortDebug = this.add.graphics().setDepth(1e9);

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

      // Tilemap collision — resolve the grass-island tilemap by its stable NAME
      // ('island'); re-dragging it in the editor changes the entity id, which
      // silently dropped collision (Cato wandered off the island). Fall back to
      // the last-known id if the name isn't found.
      const islandEntity = (sceneFile.entities as Array<{ kind: string; id: string; name?: string }>)
        .find((e) => (e.kind === 'tilemap-ref' || e.kind === 'tilemap') && e.name === GRASS_ISLAND_NAME);
      const islandId = islandEntity?.id ?? GRASS_ISLAND_ENTITY_ID;
      if (!islandEntity) {
        console.warn(`[catopia] grass-island tilemap named '${GRASS_ISLAND_NAME}' not found; collision may be off. Falling back to id '${GRASS_ISLAND_ENTITY_ID}'.`);
      }
      addTilemapCollider(this, islandId, this.child);
      this.setupFarming(islandId);

      // ── Camera: open CENTRED on the cat (the game's focus). Bounds were set
      // above; Phaser clamps this scroll into them. Player drives it after. ──
      const cam = this.cameras.main;
      cam.setScroll(this.child.x - this.scale.width / 2, this.child.y - this.scale.height / 2);
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
            // The vocabulary of things Cato can DO in the world. The AI picks one
            // when the guardian's request fits; GameScene validates + executes it.
            actions: [
              {
                name: 'till_plot',
                description:
                  'Walk to a nearby open patch of grass and hoe it into tilled soil so the guardian can plant crops. Use whenever the guardian asks you to clear / prepare / till ground, or make a plot / field / garden / patch for planting something (e.g. corn).',
                args: {
                  crop: 'string', // what the guardian wants to plant (flavour, e.g. "corn")
                  size: 'integer', // side of the square plot in tiles (2-4); default 3
                },
              },
            ],
          });
        })
        .catch(() => {
          /* leave this.cato undefined; submitDialog handles a missing npc */
        });

      // The chat-input-field text-input (SDK 1.0.28) emits these on the global
      // game bus: hud:submit (Enter) → ask Cato, hud:cancel (Esc) → close.
      this.game.events.on('hud:submit', this.onHudSubmit);
      this.game.events.on('hud:cancel', this.onHudCancel);

      // WASD / arrow keys pan the CAMERA (Cato roams on his own).
      this.setupPlayerKeys();
      // DEV: T = test-till near Cato without the AI (see CATO_DEBUG_TILL).
      if (CATO_DEBUG_TILL) {
        this.input.keyboard?.on('keydown-T', () => {
          if (!this.dialogOpen && !this.inventoryOpen && !this.catoTask) {
            this.startTillTask({ crop: 'corn', size: 3 });
          }
        });
      }
      if (CHILD_WANDER) {
        this.startWanderIdle(); // stands a beat, then strolls off
      } else {
        // Pinned: no velocity, no walk animation — cat stands at spawn.
        (this.child.body as Phaser.Physics.Arcade.Body).setVelocity(0, 0);
        this.child.anims?.stop();
      }
    }

    if (sceneFile.entities.length === 0) {
      this.add.text(this.scale.width / 2, this.scale.height / 2, 'Describe your game\nin the chat!', {
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
      x: -(this.scale.width  / 2) * (1 - 1 / z),
      y: -(this.scale.height / 2) * (1 - 1 / z),
    };
  }

  /** Integer zoom that keeps ~the design's visible world area on any screen. */
  private computeZoom(): number {
    const targetW = GAME_WIDTH / DESIGN_ZOOM;
    const targetH = GAME_HEIGHT / DESIGN_ZOOM;
    const ideal = Math.min(this.scale.width / targetW, this.scale.height / targetH);
    return Phaser.Math.Clamp(Math.round(ideal), MIN_ZOOM, MAX_ZOOM);
  }

  /** Canvas resized (RESIZE mode) — re-pick the integer zoom, keep the same world
   *  point centred, re-clamp to bounds, and re-lay-out the screen-fixed UI. */
  private onResize(): void {
    const cam = this.cameras.main;
    // World point currently at screen centre (from the last render).
    const cx = cam.worldView.centerX;
    const cy = cam.worldView.centerY;
    cam.setZoom(this.computeZoom());
    cam.setScroll(cx - this.scale.width / 2, cy - this.scale.height / 2);
    // (Camera bounds re-clamp the scroll on the next preRender.)
    this.layoutFindCatButton();
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
      scrollX: this.child.x - this.scale.width  / 2,
      scrollY: this.child.y - this.scale.height / 2,
      duration: 520,
      ease: 'Quad.easeOut',
    });
  }

  // ── Camera lock: follow Cato ──────────────────────────────────────────

  /** Lock the camera onto Cato — it follows him around the island until the
   *  player clicks elsewhere on the map. The smooth follow runs in update(). */
  private followCato(): void {
    if (!this.child) return;
    this.tweens.killTweensOf(this.cameras.main); // stop any in-flight snap tween
    this.cameraFollow = true;
  }

  /** Release the camera lock — back to manual edge-scroll panning. */
  private unfollowCato(): void {
    this.cameraFollow = false;
  }

  // ── "Find cat" button — warm cozy pill, fixed to top-right ───────────

  private buildFindCatButton(): void {
    // Cato's portrait in the top-right photo-frame (a HUD widget) IS the
    // "find cat" button \u2014 clicking it recenters the camera on Cato. The
    // transparent hit-rect handles NON-locked clicks (under pointer lock,
    // handleLockedClick reads findCatBounds instead). Created once; position +
    // findCatBounds are set by layoutFindCatButton (also re-run on resize).
    this.findCatHit = this.add.rectangle(0, 0, 64, 64, 0x000000, 0)
      .setDepth(1002).setScrollFactor(0)
      .setInteractive({ useHandCursor: true })
      .on('pointerover',  () => { this.overUi = true; })
      .on('pointerout',   () => { this.overUi = false; })
      .on('pointerdown',  () => this.followCato());
    this.layoutFindCatButton();
  }

  /** Position the find-cat hit-rect + bounds at the top-right, matching the HUD
   *  photo-frame (top-right anchor, 64x64, 16px safe-area). Live screen dims so
   *  it tracks the frame when the canvas resizes (RESIZE mode). */
  private layoutFindCatButton(): void {
    const BW = 64; const BH = 64;
    const bx = this.scale.width - 16 - BW / 2;
    const by = 16 + BH / 2;
    this.findCatBounds.setTo(bx - BW / 2, by - BH / 2, BW, BH);
    this.findCatHit?.setPosition(bx, by);
  }

  // ── Pointer lock + custom cursor ──────────────────────────────────────

  private setupPointerLock(): void {
    // Publish cursor state for CursorScene (renders it above the HUD), then
    // launch that overlay on top — AFTER loadWorldScene, so it sits above the
    // HUD scene the SDK created during the world load.
    this.registry.set('cursor', this.cursorState);
    // Overlays, back-to-front: hotbar → full backpack → cursor (always topmost).
    if (!this.scene.isActive('HotbarScene')) this.scene.launch('HotbarScene');
    if (!this.scene.isActive('InventoryScene')) this.scene.launch('InventoryScene');
    if (!this.scene.isActive('CursorScene')) this.scene.launch('CursorScene');
    this.scene.bringToTop('HotbarScene');
    this.scene.bringToTop('InventoryScene');
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
    // Backpack open: clicks pick up / drop / merge stacks; nothing else fires.
    if (this.inventoryOpen) { this.handleInventoryClick(); return; }

    // Hotbar first: a click on a slot selects that tool (never falls through to
    // tilling / portrait / camera-release).
    const slot = this.hotbarSlotAt(this.vcursor.x, this.vcursor.y);
    if (slot !== null) { this.selectHotbarSlot(slot); return; }
    // A click anywhere else over the bar (padding/gaps) is swallowed too.
    if (this.pointerOverHotbar()) return;

    // Hoe out + hovering a farmable tile → till it. Takes priority: a farming
    // click is neither a portrait click nor a camera-release click.
    if (this.activeTool === 'hoe' && this.hoverCell) {
      this.tillCell(this.hoverCell.cx, this.hoverCell.cy);
      return;
    }
    // Click Cato's portrait (top-right frame) → lock the camera onto Cato.
    if (Phaser.Geom.Rectangle.Contains(this.findCatBounds, this.vcursor.x, this.vcursor.y)) {
      this.followCato();
      return;
    }
    // The virtual cursor is in canvas px; convert to world to hit-test the cat.
    const wp = this.cameras.main.getWorldPoint(this.vcursor.x, this.vcursor.y);
    // Click Cato himself → talk. Click anywhere else on the map → release the
    // camera lock (back to manual panning).
    if (this.catContains(wp.x, wp.y)) this.openDialog();
    else if (this.cameraFollow) this.unfollowCato();
  }

  // ── Farming: hoe → till grass ─────────────────────────────────────────

  /** Wire up the hoe tool: resolve the grass-island layer, spawn the bracket
   *  cursor, bind the tool-select keys (1 = hand, 2 = hoe). */
  private setupFarming(islandId: string): void {
    // The SDK keeps a tilemap's Phaser layers under its Container's data; grab
    // the first so world↔tile snapping + tile lookup handle the map's centred
    // position for us (no manual origin math).
    const container = getEntityRegistry(this)?.byId(islandId) as
      | Phaser.GameObjects.Container
      | undefined;
    const layers = container?.getData('tilemapLayers') as
      | Phaser.Tilemaps.TilemapLayer[]
      | undefined;
    this.islandLayer = layers?.[0];
    if (!this.islandLayer) {
      console.warn('[catopia] farming: grass-island layer not found; hoe cursor disabled.');
    }

    // Bracket cursor (24×24, frames a 16px cell) + the held-tool icon inside it.
    // Hidden until the hoe is out + hovering a farmable tile. High depth so they
    // read over tiles + Cato. When shown, the bracket IS the cursor (the normal
    // mouse pointer hides — see updateTileCursor).
    this.tileCursor = this.add
      .image(0, 0, 'tile-select')
      .setOrigin(0.5, 0.5)
      .setDepth(1e6)
      .setVisible(false);
    this.hoeIcon = this.add
      .image(0, 0, 'tools_and_meterials', 'hoe') // held-hoe icon = the `hoe` region
      .setOrigin(0.5, 0.5)
      // Clearly ABOVE the bracket so the whole hoe shows on top of it (a small
      // +0.5 wasn't enough — the bracket was covering the hoe, which is why a
      // BIGGER hoe looked like LESS was visible).
      .setDepth(1e6 + 100)
      .setVisible(false);

    // A small brown "dirt clod" texture for the till particle burst (pixelArt
    // NEAREST keeps the blocks crisp).
    if (!this.textures.exists('dirt-particle')) {
      const g = this.add.graphics();
      g.fillStyle(0x7a5230, 1).fillRect(0, 0, 4, 4);
      g.generateTexture('dirt-particle', 4, 4);
      g.destroy();
    }

    this.setupInventory();
  }

  // ── Inventory + hotbar (GameScene owns the model; the scenes render it) ──

  /** Seed the backpack, publish the model, and bind keys: number keys 1..N
   *  select the matching hotbar (row-0) slot; E / I toggle the full backpack.
   *  You start bare-handed (nothing selected). */
  private setupInventory(): void {
    // A tiny placeholder "seeds" icon so stacking / merging is testable before
    // real seed art exists (two partial stacks in row 1 — merge them to test).
    this.ensureSeedTexture();

    this.inventory = new Array<ItemStack | null>(INV_ROWS * INV_COLS).fill(null);
    // Row 0 (the hotbar): the hoe + the other two tools we have icons for.
    this.inventory[0] = { id: 'hoe', label: 'Hoe', iconKey: 'tools_and_meterials', iconFrame: 'hoe', count: 1, stackable: false, toolId: 'hoe' };
    this.inventory[1] = { id: 'axe', label: 'Axe', iconKey: 'tools_and_meterials', iconFrame: 'axe', count: 1, stackable: false };
    this.inventory[2] = { id: 'watering-can', label: 'Watering can', iconKey: 'tools_and_meterials', iconFrame: 'watering-can', count: 1, stackable: false };
    // Row 1: two demo seed stacks (placeholders) to exercise stacking + merge.
    this.inventory[INV_COLS + 0] = { id: 'seeds', label: 'Seeds', iconKey: 'seeds', count: 40, stackable: true };
    this.inventory[INV_COLS + 1] = { id: 'seeds', label: 'Seeds', iconKey: 'seeds', count: 20, stackable: true };

    this.hotbarSelected = -1;
    this.publishInventory();

    const codes = [
      'keydown-ONE', 'keydown-TWO', 'keydown-THREE', 'keydown-FOUR',
      'keydown-FIVE', 'keydown-SIX', 'keydown-SEVEN', 'keydown-EIGHT', 'keydown-NINE',
    ];
    codes.slice(0, INV_COLS).forEach((code, i) => {
      this.input.keyboard?.on(code, () => this.selectHotbarSlot(i));
    });
    this.input.keyboard?.on('keydown-E', () => this.toggleInventory());
    this.input.keyboard?.on('keydown-I', () => this.toggleInventory());
    this.input.keyboard?.on('keydown-ESC', () => { if (this.inventoryOpen) this.toggleInventory(); });
  }

  /** Generate a small pixel "seeds" pouch texture (placeholder item art). */
  private ensureSeedTexture(): void {
    if (this.textures.exists('seeds')) return;
    const g = this.add.graphics();
    g.fillStyle(0x8a5a2b, 1).fillRoundedRect(3, 4, 10, 9, 3); // little brown pouch
    g.fillStyle(0x6bbf59, 1); // green seeds spilling from the top
    g.fillRect(5, 2, 2, 2); g.fillRect(8, 1, 2, 2); g.fillRect(10, 3, 2, 2);
    g.generateTexture('seeds', 16, 16);
    g.destroy();
  }

  /** Map a stack → the compact view the scenes render (icon + count). */
  private stackView(s: ItemStack | null): { iconKey?: string; iconFrame?: string; count: number } | null {
    if (!s) return null;
    return { iconKey: s.iconKey, iconFrame: s.iconFrame, count: s.count };
  }

  /** Push the current inventory to the registry so both scenes re-render. */
  private publishInventory(): void {
    const rev = ++this.invRev;
    // Hotbar = row 0 (hidden while chatting or while the full backpack is open —
    // the backpack draws row 0 itself).
    this.registry.set('hotbar', {
      slots: this.inventory.slice(0, INV_COLS).map((s) => this.stackView(s)),
      selected: this.hotbarSelected,
      visible: !this.dialogOpen && !this.inventoryOpen,
      rev,
    });
    this.registry.set('inventory', {
      open: this.inventoryOpen,
      cols: INV_COLS,
      rows: INV_ROWS,
      cells: this.inventory.map((s) => this.stackView(s)),
      selected: this.hotbarSelected,
      held: this.stackView(this.heldStack),
      rev,
    });
  }

  /** Select hotbar (row-0) slot `i`: equip its tool + highlight it. Re-selecting
   *  the active slot TOGGLES it off → empty hand, no highlight. */
  private selectHotbarSlot(i: number): void {
    if (this.dialogOpen || this.inventoryOpen) return;
    if (i < 0 || i >= INV_COLS) return;
    this.hotbarSelected = this.hotbarSelected === i ? -1 : i;
    this.equipSelected();
    this.publishInventory();
  }

  /** Equip whatever tool the selected hotbar cell holds (empty / non-tool =
   *  empty hand). Called after selection changes AND after the inventory is
   *  rearranged (a cell's tool may have moved). */
  private equipSelected(): void {
    const cell = this.hotbarSelected >= 0 ? this.inventory[this.hotbarSelected] : null;
    this.setTool(cell?.toolId ?? 'hand');
  }

  /** Open / close the full backpack grid (E / I / Esc). On close, a still-held
   *  stack is returned to a free cell so nothing is lost. */
  private toggleInventory(): void {
    if (this.dialogOpen) return;
    this.inventoryOpen = !this.inventoryOpen;
    if (!this.inventoryOpen && this.heldStack) {
      this.returnHeldToFreeCell();
    }
    this.publishInventory();
  }

  /** Put the held stack back into the first empty cell (fallback on close). */
  private returnHeldToFreeCell(): void {
    if (!this.heldStack) return;
    const free = this.inventory.findIndex((c) => c === null);
    if (free >= 0) this.inventory[free] = this.heldStack;
    this.heldStack = null;
    this.equipSelected();
  }

  /** A click inside the open backpack: pick up / drop / merge / swap the stack
   *  under the cursor (Minecraft click-to-pick, click-to-place). */
  private handleInventoryClick(): void {
    const c = this.inventoryCellAt(this.vcursor.x, this.vcursor.y);
    if (c === null) return; // clicked off the grid — keep holding
    const target = this.inventory[c];
    if (!this.heldStack) {
      // Pick up the whole stack.
      if (target) { this.heldStack = target; this.inventory[c] = null; }
    } else if (!target) {
      // Drop into an empty cell.
      this.inventory[c] = this.heldStack; this.heldStack = null;
    } else if (target.id === this.heldStack.id && target.stackable && this.heldStack.stackable) {
      // Merge same-id stacks (overflow stays in hand).
      const room = MAX_STACK - target.count;
      const moved = Math.min(room, this.heldStack.count);
      target.count += moved;
      this.heldStack.count -= moved;
      if (this.heldStack.count <= 0) this.heldStack = null;
    } else {
      // Swap held ↔ cell.
      this.inventory[c] = this.heldStack; this.heldStack = target;
    }
    this.equipSelected(); // the selected hotbar cell may have changed tool
    this.publishInventory();
  }

  /** Which backpack cell is under (x,y)? Reads InventoryScene's hit-boxes. */
  private inventoryCellAt(x: number, y: number): number | null {
    const b = this.registry.get('inventoryBounds') as
      | { cells: Array<{ x: number; y: number; w: number; h: number }> }
      | undefined;
    if (!b) return null;
    for (let i = 0; i < b.cells.length; i++) {
      const s = b.cells[i];
      if (x >= s.x && x <= s.x + s.w && y >= s.y && y <= s.y + s.h) return i;
    }
    return null;
  }

  /** Is the virtual cursor over a hotbar slot? Returns the slot index or null. */
  private hotbarSlotAt(x: number, y: number): number | null {
    const b = this.registry.get('hotbarBounds') as
      | { slots: Array<{ x: number; y: number; w: number; h: number }> }
      | undefined;
    if (!b) return null;
    for (let i = 0; i < b.slots.length; i++) {
      const s = b.slots[i];
      if (x >= s.x && x <= s.x + s.w && y >= s.y && y <= s.y + s.h) return i;
    }
    return null;
  }

  /** Is the virtual cursor over the hotbar area at all (panel + slots)? Used to
   *  suppress the hoe tile-cursor so a click near the bar targets the UI. */
  private pointerOverHotbar(): boolean {
    const b = this.registry.get('hotbarBounds') as
      | { bar: { x: number; y: number; w: number; h: number } | null }
      | undefined;
    const r = b?.bar;
    if (!r) return false;
    return (
      this.vcursor.x >= r.x && this.vcursor.x <= r.x + r.w &&
      this.vcursor.y >= r.y && this.vcursor.y <= r.y + r.h
    );
  }

  /** A short burst of pixel dirt clods flying up + out to both sides — played
   *  when the hoe strikes a cell. */
  private dirtBurst(x: number, y: number): void {
    const p = this.add.particles(x, y, 'dirt-particle', {
      speed: { min: 22, max: 58 }, // slower → the clods stay close to the strike
      angle: { min: 200, max: 340 }, // wide fan UP + out to both sides (nothing downward)
      gravityY: 170, // gentle fall so they mostly go up/out, not straight down
      lifespan: { min: 280, max: 470 },
      scale: { start: 1.4, end: 0.3 },
      emitting: false,
    });
    p.setDepth(1e6 - 1);
    p.explode(6); // a few clods, not a shower
    this.time.delayedCall(700, () => p.destroy());
  }

  private setTool(tool: ToolId): void {
    if (this.dialogOpen) return; // don't switch tools while typing in chat
    this.activeTool = tool;
    if (tool !== 'hoe') {
      this.tileCursor?.setVisible(false);
      this.hoeIcon?.setVisible(false);
      this.hoverCell = null;
    }
  }

  /** Per-frame: when the hoe is out, snap the bracket + hoe icon onto the grass
   *  tile under the cursor and hide the normal mouse pointer (the bracket IS the
   *  cursor there); over non-farmable ground / HUD, hide the bracket and restore
   *  the mouse pointer so the player is never left without a cursor. */
  private updateTileCursor(): void {
    const cursor = this.tileCursor;
    const icon = this.hoeIcon;
    if (!cursor || !icon || !this.islandLayer) return;
    // Fall back to the normal mouse cursor: hoe not out, or not over a tillable tile.
    const showMouse = () => {
      cursor.setVisible(false);
      icon.setVisible(false);
      this.hoverCell = null;
      this.cursorState.visible = this.locked;
    };
    if (this.activeTool !== 'hoe' || !this.locked || this.dialogOpen || this.inventoryOpen || this.pointerOverHotbar()) {
      showMouse();
      return;
    }
    const wp = this.cameras.main.getWorldPoint(this.vcursor.x, this.vcursor.y);
    const tile = this.islandLayer.getTileAtWorldXY(wp.x, wp.y);
    // Farmable = a grass tile is here AND it isn't already tilled.
    if (!tile || this.tilledCells.has(`${tile.x},${tile.y}`)) {
      showMouse();
      return;
    }
    const w = this.islandLayer.tileToWorldXY(tile.x, tile.y);
    if (!w) {
      showMouse();
      return;
    }
    const px = w.x + TILE / 2;
    const py = w.y + TILE / 2;
    cursor.setPosition(px, py).setVisible(true);
    icon.setPosition(px, py).setVisible(true);
    this.hoverCell = { cx: tile.x, cy: tile.y };
    // The bracket+hoe IS the cursor here → hide the triangle mouse pointer.
    this.cursorState.visible = false;
  }

  /** Till one grass cell: play the hoe swing at it, then flip it to soil. */
  private tillCell(cx: number, cy: number): void {
    if (!this.islandLayer) return;
    const key = `${cx},${cy}`;
    if (this.tilledCells.has(key)) return;
    const w = this.islandLayer.tileToWorldXY(cx, cy);
    if (!w) return;
    const centerX = w.x + TILE / 2;
    const centerY = w.y + TILE / 2;

    // Mark it tilled NOW so the cursor leaves this cell + a double-click can't
    // re-till it mid-swing.
    this.tilledCells.add(key);

    // The god-hand hoe swing: raise up then chop down (hoe-swing frames). Scaled
    // 1.5× and nudged left so the hoe HEAD lands on the cell centre, sitting a
    // bit above so the strike comes DOWN onto the tile.
    const hoe = this.add
      .sprite(centerX - 6, centerY - TILE / 2, 'tools', 28)
      .setScale(1.5)
      .setDepth(1e6 + 1);
    hoe.play('hoe-swing');

    // Flip the cell to soil when the swing lands (on the last frame / strike),
    // then clean up the hoe. Tied to ANIMATION_COMPLETE so it stays in sync with
    // the swing's speed + raised-hold; a delayedCall safety net covers the case
    // where the animation somehow didn't register. Re-autotile this cell + its 4
    // neighbours (a new tilled cell changes their edges).
    let flipped = false;
    const flip = () => {
      if (flipped) return;
      flipped = true;
      this.dirtBurst(centerX, centerY); // dirt clods fly out as the hoe hits
      this.refreshSoil(cx, cy);
      this.refreshSoil(cx, cy - 1);
      this.refreshSoil(cx + 1, cy);
      this.refreshSoil(cx, cy + 1);
      this.refreshSoil(cx - 1, cy);
      hoe.destroy();
    };
    hoe.once(Phaser.Animations.Events.ANIMATION_COMPLETE, flip);
    this.time.delayedCall(1200, flip);
  }

  /** Neighbour bitmask for a tilled cell — N=1, E=2, S=4, W=8 (bit set when the
   *  neighbour is also tilled). Matches the composed autotile sheet's frame order. */
  private tilledMask(cx: number, cy: number): number {
    let m = 0;
    if (this.tilledCells.has(`${cx},${cy - 1}`)) m |= 1;
    if (this.tilledCells.has(`${cx + 1},${cy}`)) m |= 2;
    if (this.tilledCells.has(`${cx},${cy + 1}`)) m |= 4;
    if (this.tilledCells.has(`${cx - 1},${cy}`)) m |= 8;
    return m;
  }

  /** Create-or-update the soil sprite at a tilled cell with its autotile frame. */
  private refreshSoil(cx: number, cy: number): void {
    if (!this.islandLayer) return;
    const key = `${cx},${cy}`;
    if (!this.tilledCells.has(key)) return; // only tilled cells get soil
    const frame = this.tilledMask(cx, cy);
    const existing = this.tilledSoil.get(key);
    if (existing) {
      existing.setFrame(frame);
      return;
    }
    const w = this.islandLayer.tileToWorldXY(cx, cy);
    if (!w) return;
    const soil = this.add
      .image(w.x + TILE / 2, w.y + TILE / 2, 'tilled-soil', frame)
      .setDepth(1.5);
    this.tilledSoil.set(key, soil);
  }

  // ── Cato behaviours (executing the AI's `do` actions) ─────────────────

  /** Dispatch the actions the AI chose this turn. Unknown actions are ignored
   *  (the AI can only propose from the declared vocabulary anyway). */
  private runCatoActions(actions: Array<{ name: string; args: unknown }>): void {
    for (const a of actions) {
      if (a.name === 'till_plot') this.startTillTask(a.args);
    }
  }

  /** Begin the "till a plot" behaviour: find an open grass patch near Cato and
   *  queue its cells for hoeing. Cato walks the queue in update (updateCatoTask). */
  private startTillTask(rawArgs: unknown): void {
    if (!this.islandLayer || !this.child) return;
    const args = (rawArgs ?? {}) as { crop?: string; size?: number };
    const size = Phaser.Math.Clamp(Math.round(args.size ?? 3), 1, CATO_PLOT_MAX);
    const crop = (args.crop ?? 'crops').toString();
    const cells = this.findPlot(size);
    if (!cells || cells.length === 0) {
      // No room — let Cato explain in-fiction (overrides the AI's say line).
      this.registry.set('catoDialogText', "Cato pads around, but there's no clear ground nearby to dig.");
      return;
    }
    // A single active task; camera follows Cato so the guardian watches him work.
    this.catoTask = { type: 'till', queue: cells, crop, cooldown: 0 };
    this.cameraFollow = true;
  }

  /** Is (cx,cy) a grass tile that can still be tilled? (Grass present + not yet
   *  tilled.) Mirrors the hoe tool's farmable test. */
  private isFarmable(cx: number, cy: number): boolean {
    const layer = this.islandLayer;
    if (!layer) return false;
    const tile = layer.getTileAt(cx, cy);
    return !!tile && !this.tilledCells.has(`${cx},${cy}`);
  }

  /** Find the nearest `size`×`size` block of farmable grass around Cato. Returns
   *  its cells ordered nearest-first (natural walking order), or null if none. */
  private findPlot(size: number): Array<{ cx: number; cy: number }> | null {
    const layer = this.islandLayer;
    if (!layer || !this.child) return null;
    const origin = layer.worldToTileXY(this.child.x, this.child.y);
    if (!origin) return null;
    const ocx = Math.floor(origin.x);
    const ocy = Math.floor(origin.y);
    let best: { tx: number; ty: number } | null = null;
    let bestD = Infinity;
    const R = CATO_PLOT_SEARCH_R;
    for (let ty = ocy - R; ty <= ocy + R; ty++) {
      for (let tx = ocx - R; tx <= ocx + R; tx++) {
        let ok = true;
        for (let j = 0; j < size && ok; j++) {
          for (let i = 0; i < size && ok; i++) {
            if (!this.isFarmable(tx + i, ty + j)) ok = false;
          }
        }
        if (!ok) continue;
        const dcx = tx + size / 2 - origin.x;
        const dcy = ty + size / 2 - origin.y;
        const d = dcx * dcx + dcy * dcy;
        if (d < bestD) { bestD = d; best = { tx, ty }; }
      }
    }
    if (!best) return null;
    const cells: Array<{ cx: number; cy: number }> = [];
    for (let j = 0; j < size; j++) {
      for (let i = 0; i < size; i++) cells.push({ cx: best.tx + i, cy: best.ty + j });
    }
    cells.sort(
      (a, b) =>
        (a.cx - ocx) ** 2 + (a.cy - ocy) ** 2 - ((b.cx - ocx) ** 2 + (b.cy - ocy) ** 2),
    );
    return cells;
  }

  /** Drive the active till task: walk Cato to the next cell, hoe it, repeat.
   *  Frozen while chatting. Resumes the wander when the plot is done. */
  private updateCatoTask(delta: number): void {
    const task = this.catoTask;
    const layer = this.islandLayer;
    if (!task || !layer || !this.child?.body) return;
    const body = this.child.body as Phaser.Physics.Arcade.Body;

    // Hold still while the guardian is chatting (resume after).
    if (this.dialogOpen) { body.setVelocity(0, 0); return; }

    // Pause on the cell being tilled so Cato's attack (hoe) animation plays out.
    // Don't replay idle here — that would interrupt the attack; loop:false holds
    // its last frame until the cooldown ends and he walks to the next cell.
    if (task.cooldown > 0) {
      task.cooldown -= delta;
      body.setVelocity(0, 0);
      return;
    }

    const next = task.queue[0];
    if (!next) { this.finishCatoTask(); return; }

    // Skip a cell that got tilled some other way (idempotent).
    if (this.tilledCells.has(`${next.cx},${next.cy}`)) { task.queue.shift(); return; }

    const w = layer.tileToWorldXY(next.cx, next.cy);
    if (!w) { task.queue.shift(); return; }
    const tx = w.x + TILE / 2;
    const ty = w.y + TILE / 2;
    const dx = tx - this.child.x;
    const dy = ty - this.child.y;
    const dist = Math.hypot(dx, dy);

    if (dist > CATO_ARRIVE_DIST) {
      // Walk toward the cell; face + animate along the dominant axis.
      body.setVelocity((dx / dist) * CATO_TILL_SPEED, (dy / dist) * CATO_TILL_SPEED);
      if (Math.abs(dx) >= Math.abs(dy)) this.faceDir = dx < 0 ? 'left' : 'right';
      else this.faceDir = dy < 0 ? 'up' : 'down';
      this.child.play(`walk-${this.faceDir}`, true);
      return;
    }

    // Arrived: stop and hoe this cell with Cato's OWN attack animation (in the
    // direction he approached), then pause before the next. No god-hand hoe —
    // Cato swings his own. The soil flips partway through the swing (commitCatoTill).
    body.setVelocity(0, 0);
    this.child.play(`attack-${this.faceDir}`, true);
    this.commitCatoTill(next.cx, next.cy);
    task.queue.shift();
    task.cooldown = CATO_TILL_STEP_MS;
  }

  /** Cato hoes a cell himself (no god-hand hoe sprite): reserve it now, then flip
   *  it to soil + kick up dirt partway through his attack swing. */
  private commitCatoTill(cx: number, cy: number): void {
    const key = `${cx},${cy}`;
    if (this.tilledCells.has(key)) return;
    this.tilledCells.add(key); // reserve so it won't be re-queued mid-swing
    // Fire slightly into the swing so dirt + soil appear as the hoe strikes. A
    // delayedCall (not the anim's COMPLETE) so it still lands if the swing gets
    // interrupted (e.g. the guardian opens the chat mid-till).
    this.time.delayedCall(CATO_TILL_STRIKE_MS, () => {
      if (!this.islandLayer) return;
      const w = this.islandLayer.tileToWorldXY(cx, cy);
      if (w) this.dirtBurst(w.x + TILE / 2, w.y + TILE / 2);
      this.refreshSoil(cx, cy);
      this.refreshSoil(cx, cy - 1);
      this.refreshSoil(cx + 1, cy);
      this.refreshSoil(cx, cy + 1);
      this.refreshSoil(cx - 1, cy);
    });
  }

  /** Plot finished: clear the task, tell Cato so he remembers, resume wander. */
  private finishCatoTask(): void {
    const crop = this.catoTask?.crop ?? 'crops';
    this.catoTask = null;
    this.cameraFollow = false;
    this.cato?.note(`You finished tilling a plot of soil, ready for the guardian to plant ${crop}.`);
    if (CHILD_WANDER) this.startWanderIdle();
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
    this.publishInventory(); // hide the hotbar while chatting
    // Cato turns to FACE THE PLAYER (front) while chatting: stop + play the
    // front idle. faceDir='down' so the wander-freeze in update() (which plays
    // idle-{faceDir}) keeps him facing front for the whole conversation.
    this.faceDir = 'down';
    (this.child.body as Phaser.Physics.Arcade.Body).setVelocity(0, 0);
    this.child.play('idle-down', true);
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
    this.publishInventory(); // restore the hotbar after chatting
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
        if (r.do?.length) this.runCatoActions(r.do);
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

  // ── Y-sort (depth by foot / base line) ────────────────────────────────

  /** The world-Y of a sprite's ground contact (feet for a character, base for a
   *  prop). A sprite authored with a `depthAnchor` has its ORIGIN set at the
   *  foot by the SDK, so `s.y` already IS the foot line — Cato's 48×48 frame has
   *  ~17px of empty space below the feet, so his frame BOTTOM is NOT his feet;
   *  the anchor is. A plain center-origin sprite (the sunflower region) has its
   *  base half its height below `s.y`. Detect the anchored case via `originY`. */
  private footLine(s: Phaser.GameObjects.Sprite): number {
    return s.originY > 0.5 ? s.y : s.y + s.displayHeight * (1 - s.originY);
  }

  /** Depth-sort every world sprite by its foot line: whoever's feet/base is LOWER
   *  on the map draws in front. So Cato is in front of the sunflower exactly when
   *  his feet are BELOW the flower's base, behind when above — the standard
   *  top-down feet-line rule. Tilemaps keep their own (low) depth, so sprites
   *  always sit above the ground. */
  private applyYSort(): void {
    const g = this.ysortDebug;
    g?.clear();
    g?.lineStyle(1, 0xff2d78, 0.9);
    for (const s of this.ySortSprites) {
      if (!s.active) continue;
      const foot = this.footLine(s);
      s.setDepth(Math.round(foot));
      // Debug: draw the foot line so the flip point is visible on screen.
      if (g) g.lineBetween(s.x - 24, foot, s.x + 24, foot);
    }
  }

  // ── Camera keys (WASD / arrow keys pan the camera) ────────────────────

  /** Register WASD + arrow keys for camera panning. */
  private setupPlayerKeys(): void {
    const kb = this.input.keyboard;
    if (!kb) return;
    // Capture so arrow keys don't scroll the host page (editor iframe / browser).
    kb.addCapture(['UP', 'DOWN', 'LEFT', 'RIGHT', 'W', 'A', 'S', 'D']);
    this.keys = kb.addKeys({
      up: Phaser.Input.Keyboard.KeyCodes.UP,
      down: Phaser.Input.Keyboard.KeyCodes.DOWN,
      left: Phaser.Input.Keyboard.KeyCodes.LEFT,
      right: Phaser.Input.Keyboard.KeyCodes.RIGHT,
      w: Phaser.Input.Keyboard.KeyCodes.W,
      a: Phaser.Input.Keyboard.KeyCodes.A,
      s: Phaser.Input.Keyboard.KeyCodes.S,
      d: Phaser.Input.Keyboard.KeyCodes.D,
    }) as Record<'up' | 'down' | 'left' | 'right' | 'w' | 'a' | 's' | 'd', Phaser.Input.Keyboard.Key>;
  }

  /** WASD / arrow keys pan the camera (screen-space, zoom-compensated). Holding
   *  a key keeps scrolling; pressing one releases any Cato camera-follow so the
   *  player takes manual control. Frozen while chatting / in the backpack. */
  private updateCameraKeys(delta: number): void {
    if (this.dialogOpen || this.inventoryOpen) return;
    const k = this.keys;
    if (!k) return;
    let dx = 0;
    let dy = 0;
    if (k.left.isDown || k.a.isDown) dx -= 1;
    if (k.right.isDown || k.d.isDown) dx += 1;
    if (k.up.isDown || k.w.isDown) dy -= 1;
    if (k.down.isDown || k.s.isDown) dy += 1;
    if (dx === 0 && dy === 0) return;
    this.cameraFollow = false; // manual pan wins over follow-Cato
    const cam = this.cameras.main;
    const step = (KEY_PAN_SPEED * delta) / 1000 / cam.zoom;
    const len = Math.hypot(dx, dy);
    cam.scrollX += (dx / len) * step;
    cam.scrollY += (dy / len) * step;
    // Camera bounds (set by loadWorldScene) auto-clamp on preRender.
  }

  // ── Wandering AI helpers ──────────────────────────────────────────────

  // 4-directional headings only — the character sheet has walk anims for
  // down/up/left/right but NO diagonal, so Cato moves along one axis at a time.
  private static readonly WALK_DIRS: ReadonlyArray<{ dir: FaceDir; vx: number; vy: number }> = [
    { dir: 'down',  vx: 0,  vy: 1 },
    { dir: 'up',    vx: 0,  vy: -1 },
    { dir: 'left',  vx: -1, vy: 0 },
    { dir: 'right', vx: 1,  vy: 0 },
  ];

  /** Begin a WALK phase: pick a random CARDINAL heading, face + play the anim.
   *  Prefers a direction that isn't currently blocked so a boundary bump turns
   *  Cato a fresh way instead of re-walking into the same wall. */
  private startWanderWalk(): void {
    if (!this.child?.body) return;
    const body = this.child.body as Phaser.Physics.Arcade.Body;
    const free = GameScene.WALK_DIRS.filter(
      (d) =>
        !((d.dir === 'left' && body.blocked.left) ||
          (d.dir === 'right' && body.blocked.right) ||
          (d.dir === 'up' && body.blocked.up) ||
          (d.dir === 'down' && body.blocked.down)),
    );
    const choices = free.length > 0 ? free : GameScene.WALK_DIRS;
    const pick = choices[Phaser.Math.Between(0, choices.length - 1)]!;
    body.setVelocity(pick.vx * CHILD_SPEED, pick.vy * CHILD_SPEED);
    this.faceDir = pick.dir;
    this.child.play(`walk-${pick.dir}`, true);
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
    if (this.dialogOpen || this.inventoryOpen) return; // typing / backpack — don't pan
    if (this.cameraFollow) return; // camera is locked onto Cato — no manual pan
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
    this.applyYSort(); // depth = foot Y, so Cato passes before/behind props

    // Camera lock: smoothly keep Cato centred while following. Uses the proven
    // origin-0.5 centring form (child.x − w/2, NOT /zoom — see snapToChild); a
    // frame-rate-independent lerp eases the camera along as Cato strolls. The
    // camera bounds clamp this on preRender, so it never pans past the ocean.
    if (this.cameraFollow && this.child) {
      const cam = this.cameras.main;
      const t = 1 - Math.pow(1 - 0.15, delta / 16.6667);
      cam.scrollX = Phaser.Math.Linear(cam.scrollX, this.child.x - this.scale.width / 2, t);
      cam.scrollY = Phaser.Math.Linear(cam.scrollY, this.child.y - this.scale.height / 2, t);
    }

    // Publish the virtual cursor to CursorScene (renders it above the HUD).
    this.cursorState.x = this.vcursor.x;
    this.cursorState.y = this.vcursor.y;
    this.cursorState.visible = this.locked;

    // Snap the hoe's tile-selection cursor to the grass tile under the mouse.
    this.updateTileCursor();

    // WASD / arrows pan the camera (Cato roams on his own).
    this.updateCameraKeys(delta);

    if (!this.child?.body) return;

    // A commanded behaviour (e.g. Cato tilling a plot) takes over the wander.
    if (this.catoTask) {
      this.updateCatoTask(delta);
      return;
    }

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
