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
// Leash: Cato wanders near the CAMERA CENTRE instead of roaming the whole map.
// Past LEASH_RADIUS (world px) he heads back until within LEASH_RETURN.
const CATO_LEASH_RADIUS = 88;
const CATO_LEASH_RETURN = 40;
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

type ToolId = 'hand' | 'hoe' | 'watering-can';

// Inventory grid (Stardew-style): a backpack of INV_ROWS × INV_COLS cells. Row 0
// IS the hotbar (always visible); pressing E opens the full grid. Growing the
// backpack later = bump INV_ROWS. Stackable items merge up to MAX_STACK per cell.
const INV_COLS = 8;
const INV_ROWS = 3;
const MAX_STACK = 99;

/** One stack of items in a single inventory/hotbar cell. Tools are
 *  non-stackable (count 1, carry a `toolId` they equip on select); seeds /
 *  materials / crops stack up to MAX_STACK. `id` is the merge key. Empty = null. */
interface ItemStack {
  id: string;
  label?: string;
  iconKey?: string;
  iconFrame?: string;
  count: number;
  stackable: boolean;
  toolId?: ToolId;
  plants?: CropName; // a seed bag: selecting it lets you plant this crop on soil
}

// --- Crops (Sprout Lands "Farming Plants") ---
// Each crop grows through N stages (frames `grow-<name>-<stage>` in the
// farming_plants atlas). Corn is TALL (16×32); the rest are 16×16. The seed bag +
// harvested crop item icons live in the farming_plants_items atlas.
type CropName = 'corn' | 'carrot' | 'tomato' | 'eggplant' | 'pumpkin';
interface CropDef { stages: number; tall: boolean; label: string }
const CROPS: Record<CropName, CropDef> = {
  corn:     { stages: 5, tall: true,  label: 'Corn' },
  carrot:   { stages: 4, tall: false, label: 'Carrot' },
  tomato:   { stages: 4, tall: false, label: 'Tomato' },
  eggplant: { stages: 4, tall: false, label: 'Eggplant' },
  pumpkin:  { stages: 4, tall: false, label: 'Pumpkin' },
};
// Growth per stage: watered crops advance fast, dry ones crawl. Watering wears
// off when a crop advances a stage (re-water it to keep it fast). Demo timings.
const CROP_STAGE_MS_WATERED = 3500;
const CROP_STAGE_MS_DRY = 12000;
// How long a watering stays wet (soil tint + fast growth), independent of stage
// advances, so the damp look persists and re-watering isn't instantly consumed.
const WET_DURATION_MS = 9000;
// Watered soil looks darker/damp — the dirt tileset has no wet variant, so we
// multiply-tint the soil sprite (cleared when it dries at the next stage-up).
const WET_SOIL_TINT = 0xb0946a;

/** A seed-bag inventory item for a crop (stackable, `plants` set). */
function makeSeed(crop: CropName, count: number): ItemStack {
  return {
    id: `${crop}-seed`,
    label: `${CROPS[crop].label} seeds`,
    iconKey: 'farming_plants_items',
    iconFrame: `${crop}-seed-bag`,
    count,
    stackable: true,
    plants: crop,
  };
}

/** A harvested-crop inventory item (stackable). */
function makeCrop(crop: CropName, count: number): ItemStack {
  return {
    id: `crop-${crop}`,
    label: CROPS[crop].label,
    iconKey: 'farming_plants_items',
    iconFrame: `crop-${crop}`,
    count,
    stackable: true,
  };
}

/** Rebuild a full ItemStack from its saved `id` + count (the single source of
 *  truth for tools too — setupInventory + save-load both go through it). */
function itemFromId(id: string, count: number): ItemStack {
  if (id === 'hoe') return { id, label: 'Hoe', iconKey: 'tools_and_meterials', iconFrame: 'hoe', count: 1, stackable: false, toolId: 'hoe' };
  if (id === 'watering-can') return { id, label: 'Watering can', iconKey: 'tools_and_meterials', iconFrame: 'watering-can', count: 1, stackable: false, toolId: 'watering-can' };
  if (id === 'axe') return { id, label: 'Axe', iconKey: 'tools_and_meterials', iconFrame: 'axe', count: 1, stackable: false };
  const seed = /^(\w+)-seed$/.exec(id);
  if (seed && (seed[1] in CROPS)) return makeSeed(seed[1] as CropName, count);
  const crop = /^crop-(\w+)$/.exec(id);
  if (crop && (crop[1] in CROPS)) return makeCrop(crop[1] as CropName, count);
  return { id, count, stackable: true }; // unknown → generic stack
}

/** The persisted save blob (`umicat.saves` key `state`). */
interface SaveBlob {
  v: number;
  inventory: Array<{ id: string; count: number } | null>;
  selected: number;
  tilled: string[]; // "cx,cy"
  soilWet: Array<[string, number]>; // [key, remaining ms]
  crops: Array<{ key: string; name: CropName; stage: number; timer: number }>;
  cato: { x: number; y: number } | null;
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
  // When a seed bag is the selected hotbar item, planting mode is on: the tile
  // cursor snaps to empty tilled soil and a click plants this crop there.
  private activeSeed?: CropName;
  private islandLayer?: Phaser.Tilemaps.TilemapLayer;
  private tileCursor?: Phaser.GameObjects.Image; // bracket that frames the target cell
  private hoeIcon?: Phaser.GameObjects.Image; // the held-tool icon shown inside the bracket
  private waterCan?: Phaser.GameObjects.Sprite; // the god-hand watering-can pour (one at a time)
  private hoeSwing?: Phaser.GameObjects.Sprite; // the god-hand hoe swing (till / harvest)
  private tilledCells = new Set<string>(); // "cx,cy" already tilled (idempotent)
  private tilledSoil = new Map<string, Phaser.GameObjects.Image>(); // cell → soil sprite (autotile frame)
  private hoverCell: { cx: number; cy: number } | null = null; // actionable cell under cursor (till or plant)

  // Planted crops: cell "cx,cy" → its growth state + sprite. Grows a stage every
  // CROP_STAGE_MS; a mature crop can be harvested (→ crop item, soil stays).
  private crops = new Map<string, { name: CropName; stage: number; timer: number; sprite: Phaser.GameObjects.Image }>();
  // Wetness lives on the SOIL cell (not the crop): key → remaining wet ms. Wet
  // soil is tinted + makes any crop on it grow fast. Watering any tilled cell
  // sets this; empty cells can be wet too (it just wets the ground).
  private soilWet = new Map<string, number>();

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
  private invDragFrom: number | null = null; // touch: cell a backpack drag started on

  // ── Save data (umicat.saves, per (game, user)) ──────────────────────────
  // Auto-save the whole game state (farm + backpack) so it restores next login.
  // `umicat` is the SDK facade; `loadingSave` suppresses saves while restoring;
  // `pendingSave` debounces action-triggered saves.
  private umicat?: Umicat;
  private loadingSave = false;
  private pendingSave?: Phaser.Time.TimerEvent;
  // Saving is ARMED only after loadGame has actually READ the store — so a slow
  // load (or a read error) can never let the default state overwrite the real
  // save before it's restored.
  private saveArmed = false;
  // Hide the world + hotbar until the save is restored, so there's no flash of
  // the empty/default farm before the saved crops+soil pop in.
  private gameReady = false;
  private loadingCover?: Phaser.GameObjects.Container;

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
  private catoTask: {
    type: 'till' | 'plant' | 'water' | 'harvest';
    queue: Array<{ cx: number; cy: number }>;
    crop: string; // flavour label ('corn', 'crops', …)
    plantName?: CropName; // for a plant task: what to sow
    cooldown: number;
    // Where Cato stands to work the CURRENT target (an adjacent cell) + which way
    // he faces to swing/tend it. Computed once per target; null = recompute.
    stand: { x: number; y: number; dir: FaceDir } | null;
  } | null = null;
  private catoReturning = false; // walking back toward the camera centre (leash)

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
    // Cover the world until the save is restored (avoids the empty-farm flash).
    // A fallback reveals it even if Umicat.init never resolves (saving stays
    // disarmed until the real load, so revealing can't clobber the save).
    this.showLoadingCover();
    this.time.delayedCall(8000, () => this.markReady());
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
        if (this.dialogOpen || this.inventoryOpen) return; // don't pan behind a modal
        this.cameraFollow = false; // manual pan wins over follow-Cato
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
        .then(async (u) => {
          this.umicat = u;
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
              {
                name: 'plant_crop',
                description:
                  'Walk to nearby tilled soil and sow seeds there. Use when the guardian asks you to plant / sow / seed a specific crop (corn, carrot, tomato, eggplant, or pumpkin). Requires tilled soil to already exist — if there is none, till first (or say so). Fills the open soil with the crop.',
                args: {
                  crop: 'string', // one of: corn, carrot, tomato, eggplant, pumpkin
                  count: 'integer', // how many to plant; 0 / omitted = fill all open soil
                },
              },
              {
                name: 'water_crops',
                description:
                  'Walk to the planted crops and water them with the watering can so they grow fast (un-watered crops grow very slowly). Use when the guardian asks you to water / hydrate the crops or plants. Waters crops that still need it.',
                args: {
                  count: 'integer', // how many to water; 0 / omitted = water all that need it
                },
              },
              {
                name: 'harvest_crops',
                description:
                  'Walk to the crops that are fully grown (ripe) and harvest them — the produce goes into the guardian\'s backpack. Use when the guardian asks you to harvest / pick / collect / gather the ripe crops. Only fully-grown crops are harvested.',
                args: {
                  count: 'integer', // how many to harvest; 0 / omitted = all ripe crops
                },
              },
              {
                name: 'set_emote',
                description:
                  'Show a facial expression on your portrait matching your mood this turn. `mood` MUST be exactly one of: happy, surprised, thinking, playful, sad, excited. Pick the ONE that genuinely fits what you are saying right now — DO NOT default to the same mood every time; vary it with the conversation (e.g. sad when scolded, surprised at news, thinking when unsure). Pair it with your reply.',
                args: {
                  mood: 'string', // exactly one of: happy | surprised | thinking | playful | sad | excited
                },
              },
            ],
          });
          // Restore the saved game (overrides the fresh-start defaults), reveal
          // the world, then start auto-saving.
          await this.loadGame();
          this.markReady();
          this.setupAutosave();
        })
        .catch(() => {
          /* leave this.cato undefined; submitDialog handles a missing npc */
          this.markReady(); // still reveal the game if init/AI failed
        });

      // The chat-input-field text-input (SDK 1.0.28) emits these on the global
      // game bus: hud:submit (Enter) → ask Cato, hud:cancel (Esc) → close.
      this.game.events.on('hud:submit', this.onHudSubmit);
      this.game.events.on('hud:cancel', this.onHudCancel);

      // WASD / arrow keys pan the CAMERA (Cato roams on his own).
      this.setupPlayerKeys();
      // DEV: T = Cato test-tills, P = Cato test-plants corn, both without the AI
      // (see CATO_DEBUG_TILL).
      if (CATO_DEBUG_TILL) {
        const canAct = () => !this.dialogOpen && !this.inventoryOpen && !this.catoTask;
        this.input.keyboard?.on('keydown-T', () => { if (canAct()) this.startTillTask({ crop: 'corn', size: 3 }); });
        this.input.keyboard?.on('keydown-P', () => { if (canAct()) this.startPlantTask({ crop: 'corn' }); });
        this.input.keyboard?.on('keydown-O', () => { if (canAct()) this.startWaterTask({}); }); // O = water crops
        this.input.keyboard?.on('keydown-H', () => { if (canAct()) this.startHarvestTask({}); }); // H = harvest ripe crops
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

    // MOUSE: click the canvas → capture the mouse. If already locked, the click
    // is a game/HUD action routed through the virtual cursor (the OS pointer is
    // frozen under lock, so Phaser's own hit-testing can't see the cursor).
    // Touch is handled separately (pointerup tap below) — it never locks.
    this.input.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
      if (pointer.wasTouch) return;
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

    // TOUCH: no pointer lock / virtual cursor. Two gestures:
    //  • In the open backpack → PRESS a cell to pick a stack up, DRAG, RELEASE on
    //    a cell to drop/merge/swap (the natural touch move; the held stack follows
    //    the finger). Release outside a cell returns it / (empty tap) closes.
    //  • Elsewhere → a TAP (pointerup, <12px move; a bigger drag is the Rex-Pan
    //    camera pan) acts at the touched point via the SAME `actAt(x,y)` as mouse.
    this.input.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
      if (!pointer.wasTouch || !this.inventoryOpen) return;
      const c = this.inventoryCellAt(pointer.x, pointer.y);
      this.invDragFrom = c;
      if (c !== null && !this.heldStack && this.inventory[c]) this.clickInventoryCell(c); // pick up
      this.cursorState.x = pointer.x; // the held stack renders at the cursor pos
      this.cursorState.y = pointer.y;
    });
    this.input.on('pointermove', (pointer: Phaser.Input.Pointer) => {
      if (pointer.wasTouch && this.inventoryOpen && this.heldStack) {
        this.cursorState.x = pointer.x; // held stack follows the finger
        this.cursorState.y = pointer.y;
      }
    });
    this.input.on('pointerup', (pointer: Phaser.Input.Pointer) => {
      if (!pointer.wasTouch) return;
      if (this.inventoryOpen) { this.endInventoryTouch(pointer.x, pointer.y); return; }
      if (pointer.getDistance() > 12) return; // a drag → pan, not a tap
      if (this.dialogOpen) { this.closeDialog(); return; }
      this.actAt(pointer.x, pointer.y);
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

  /** Route a click while pointer-locked (mouse) via the virtual cursor. */
  private handleLockedClick(): void {
    this.actAt(this.vcursor.x, this.vcursor.y);
  }

  /** Route an action at canvas-px (x,y). Shared by the pointer-locked mouse
   *  (virtual cursor) AND touch taps — so it computes the target tile straight
   *  from (x,y) rather than the hover cursor (which only exists under lock). */
  private actAt(x: number, y: number): void {
    // Backpack open: tap a cell to pick/drop/merge/swap; tap outside → close.
    if (this.inventoryOpen) {
      const c = this.inventoryCellAt(x, y);
      if (c !== null) this.clickInventoryCell(c);
      else this.toggleInventory();
      return;
    }
    // Backpack button → open the full grid (mainly for touch — no E key).
    if (this.overBackpackButton(x, y)) { this.toggleInventory(); return; }
    // Hotbar slot → select that tool; elsewhere over the bar → swallow.
    const slot = this.hotbarSlotAt(x, y);
    if (slot !== null) { this.selectHotbarSlot(slot); return; }
    if (this.overHotbarAt(x, y)) return;

    // World-tile actions (validity computed here, so touch works without a hover
    // cursor). Harvest takes priority; only the hoe / empty hand harvests.
    const wp = this.cameras.main.getWorldPoint(x, y);
    const tile = this.islandLayer?.getTileAtWorldXY(wp.x, wp.y);
    if (tile) {
      const key = `${tile.x},${tile.y}`;
      const crop = this.crops.get(key);
      const canHarvest = !this.activeSeed && this.activeTool !== 'watering-can';
      if (canHarvest && crop && crop.stage >= CROPS[crop.name].stages - 1) {
        this.harvestCrop(tile.x, tile.y); return;
      }
      if (this.activeTool === 'hoe' && !this.tilledCells.has(key)) {
        this.tillCell(tile.x, tile.y); return;
      }
      if (this.activeSeed && this.tilledCells.has(key) && !this.crops.has(key)) {
        this.playerPlant(tile.x, tile.y); return;
      }
      if (this.activeTool === 'watering-can' && this.tilledCells.has(key)) {
        this.playerWater(tile.x, tile.y); return;
      }
    }
    // Cato's portrait (top-right) → follow; Cato himself → talk; else release follow.
    if (Phaser.Geom.Rectangle.Contains(this.findCatBounds, x, y)) { this.followCato(); return; }
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
    this.inventory = new Array<ItemStack | null>(INV_ROWS * INV_COLS).fill(null);
    // Row 0 (the hotbar) holds ALL the tools + seeds (8 slots) so touch players —
    // who can't open the backpack as easily — reach everything from the bar.
    // Harvested crops land in the backpack rows below.
    this.inventory[0] = itemFromId('hoe', 1);
    this.inventory[1] = itemFromId('watering-can', 1);
    this.inventory[2] = makeSeed('corn', 10);
    this.inventory[3] = makeSeed('carrot', 10);
    this.inventory[4] = makeSeed('tomato', 10);
    this.inventory[5] = makeSeed('eggplant', 10);
    this.inventory[6] = makeSeed('pumpkin', 10);
    this.inventory[7] = itemFromId('axe', 1);

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
      visible: this.gameReady && !this.dialogOpen && !this.inventoryOpen,
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
    this.scheduleSave(); // inventory / selection changed → persist
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
    this.activeSeed = cell?.plants; // seed bag selected → planting mode
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

  /** Pick up / drop / merge / swap the stack in backpack cell `c` (Minecraft
   *  click-to-pick, click-to-place). */
  private clickInventoryCell(c: number): void {
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

  /** End a touch drag in the open backpack: drop the held stack onto the cell
   *  under the finger (or return it if released off-grid); a plain tap on empty
   *  space (nothing picked up) closes the backpack. */
  private endInventoryTouch(x: number, y: number): void {
    const target = this.inventoryCellAt(x, y);
    if (this.heldStack) {
      if (target !== null) {
        this.clickInventoryCell(target); // drop / merge / swap (+ publishes)
      } else {
        this.returnHeldToFreeCell(); // released off the grid → put it back safely
        this.publishInventory();
      }
    } else if (target === null && this.invDragFrom === null) {
      this.toggleInventory(); // tapped empty space with nothing held → close
    }
    this.invDragFrom = null;
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

  /** Is (x,y) over the backpack button (right of the hotbar)? */
  private overBackpackButton(x: number, y: number): boolean {
    const b = this.registry.get('hotbarBounds') as
      | { backpack?: { x: number; y: number; w: number; h: number } }
      | undefined;
    const r = b?.backpack;
    if (!r) return false;
    return x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;
  }

  /** Is (x,y) over the hotbar area (panel + slots)? */
  private overHotbarAt(x: number, y: number): boolean {
    const b = this.registry.get('hotbarBounds') as
      | { bar: { x: number; y: number; w: number; h: number } | null }
      | undefined;
    const r = b?.bar;
    if (!r) return false;
    return x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;
  }

  /** Is the virtual (mouse) cursor over the hotbar? Used to suppress the hoe
   *  tile-cursor so a hover near the bar targets the UI. */
  private pointerOverHotbar(): boolean {
    return this.overHotbarAt(this.vcursor.x, this.vcursor.y);
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
    // Visibility is managed each frame by updateTileCursor (hoe OR seed mode).
  }

  /** Per-frame tool cursor. While a tool/seed is held the mouse cursor stays
   *  visible (it follows the exact pointer) AND a tile bracket + held-tool icon
   *  snaps to the tile it's over: BRIGHT when you can act there, DIMMED
   *  (semi-transparent icon + light-gray bracket) when you can't — so the held
   *  tool never just "vanishes". With an empty hand / over the UI / in a dialog or
   *  the backpack it's just the plain mouse cursor (no bracket). */
  private updateTileCursor(): void {
    const cursor = this.tileCursor;
    const icon = this.hoeIcon;
    if (!cursor || !icon || !this.islandLayer) return;
    const showMouse = () => {
      cursor.setVisible(false);
      icon.setVisible(false);
      this.hoverCell = null;
      this.cursorState.visible = this.locked;
    };
    // While a tool-action animation plays (hoe swing / watering pour), hide the
    // bracket + tool icon (the swinging/pouring tool is the feedback) but KEEP the
    // mouse cursor so the pointer never vanishes.
    if (this.hoeSwing || this.waterCan) {
      cursor.setVisible(false);
      icon.setVisible(false);
      this.hoverCell = null;
      this.cursorState.visible = this.locked;
      return;
    }
    const planting = !!this.activeSeed;
    const tilling = this.activeTool === 'hoe';
    const watering = this.activeTool === 'watering-can';
    const holdingTool = tilling || planting || watering;
    // No tool held / not locked / over UI / dialog / backpack → real mouse.
    if (!holdingTool || !this.locked || this.dialogOpen || this.inventoryOpen || this.pointerOverHotbar()) {
      showMouse();
      return;
    }

    // The held tool's icon, always shown (dimmed when the spot is invalid).
    if (tilling) icon.setTexture('tools_and_meterials', 'hoe');
    else if (watering) icon.setTexture('tools_and_meterials', 'watering-can');
    else if (this.activeSeed) icon.setTexture('farming_plants_items', `${this.activeSeed}-seed-bag`);

    const wp = this.cameras.main.getWorldPoint(this.vcursor.x, this.vcursor.y);
    const tile = this.islandLayer.getTileAtWorldXY(wp.x, wp.y);

    // Is this spot a valid target for the held tool?
    let valid = false;
    if (tile) {
      const key = `${tile.x},${tile.y}`;
      if (tilling) {
        // Hoe: bright over tillable grass OR a MATURE crop (the hoe harvests it).
        const crop = this.crops.get(key);
        const harvestable = !!crop && crop.stage >= CROPS[crop.name].stages - 1;
        valid = !this.tilledCells.has(key) || harvestable;
      }
      else if (planting) valid = this.tilledCells.has(key) && !this.crops.has(key);
      // Water: any tilled soil (crop or not, wet or not) — it just wets the ground.
      else if (watering) valid = this.tilledCells.has(key);
    }

    // Snap to the tile centre when there's a tile; else follow the free cursor.
    let px = wp.x;
    let py = wp.y;
    if (tile) {
      const w = this.islandLayer.tileToWorldXY(tile.x, tile.y);
      if (w) { px = w.x + TILE / 2; py = w.y + TILE / 2; }
    }
    cursor.setPosition(px, py).setVisible(true);
    icon.setPosition(px, py).setVisible(true);
    // Keep the mouse cursor visible too (it follows the exact pointer); the
    // bracket just snaps to the tile the mouse is over — so movement reads clearly.
    this.cursorState.visible = this.locked;

    if (valid && tile) {
      cursor.setAlpha(1).clearTint();
      icon.setAlpha(1);
      this.hoverCell = { cx: tile.x, cy: tile.y };
    } else {
      // Disabled look: light-gray bracket + semi-transparent tool, no action.
      cursor.setAlpha(0.55).setTint(0xbbbbbb);
      icon.setAlpha(0.4);
      this.hoverCell = null;
    }
  }

  // ── Crops: plant → grow → harvest ─────────────────────────────────────

  /** Plant a crop on a tilled, empty soil cell (stage 0). Shared by the player
   *  and by Cato. Returns true if it planted. */
  private plantCropAt(cx: number, cy: number, name: CropName): boolean {
    if (!this.islandLayer) return false;
    const key = `${cx},${cy}`;
    if (!this.tilledCells.has(key) || this.crops.has(key)) return false;
    const w = this.islandLayer.tileToWorldXY(cx, cy);
    if (!w) return false;
    const footX = w.x + TILE / 2;
    // Plant BASE sits at the MIDDLE of the soil tile (not the bottom edge) so the
    // stalk looks rooted IN the soil with dirt showing below it.
    const footY = w.y + TILE / 2;
    const sprite = this.add
      .image(footX, footY, 'farming_plants', `grow-${name}-0`)
      .setOrigin(0.5, 1)
      .setDepth(footY); // y-sorted like Cato so he passes in front/behind
    this.crops.set(key, { name, stage: 0, timer: 0, sprite });
    this.dirtBurst(footX, footY); // little poof as the seed goes in
    this.scheduleSave();
    return true;
  }

  /** Player plants with the selected seed bag: plant + consume one seed (empties
   *  the slot when the bag runs out). */
  private playerPlant(cx: number, cy: number): void {
    const sel = this.hotbarSelected;
    const bag = sel >= 0 ? this.inventory[sel] : null;
    if (!bag?.plants) return;
    if (!this.plantCropAt(cx, cy, bag.plants)) return;
    bag.count -= 1;
    if (bag.count <= 0) {
      this.inventory[sel] = null;
      this.equipSelected(); // bag empty → back to empty hand
    }
    this.publishInventory();
  }

  /** PLAYER harvest of a MATURE crop → god-hand hoe swing, then (at the strike)
   *  the produce pops out + is banked (`reapCrop`). */
  private harvestCrop(cx: number, cy: number): void {
    const key = `${cx},${cy}`;
    const crop = this.crops.get(key);
    if (!crop || crop.stage < CROPS[crop.name].stages - 1) return;
    this.hideTileCursor();
    const w = this.islandLayer?.tileToWorldXY(cx, cy);
    if (!w) { this.reapCrop(cx, cy); return; }
    const centerX = w.x + TILE / 2;
    const centerY = w.y + TILE / 2;
    this.hoeSwingAt(centerX, centerY, () => this.reapCrop(cx, cy));
  }

  /** Uproot a MATURE crop: remove it, bank the produce, pop it out of the ground
   *  in a cute arc. Shared by the player (at the hoe strike) and by Cato (at his
   *  attack strike). Returns true if it harvested. The soil keeps its wetness. */
  private reapCrop(cx: number, cy: number): boolean {
    const key = `${cx},${cy}`;
    const crop = this.crops.get(key);
    if (!crop || crop.stage < CROPS[crop.name].stages - 1) return false;
    this.crops.delete(key);
    crop.sprite.destroy();
    this.addToInventory(makeCrop(crop.name, 1));
    this.publishInventory();
    const w = this.islandLayer?.tileToWorldXY(cx, cy);
    if (w) this.playHarvestPop(w.x + TILE / 2, w.y + TILE / 2, crop.name);
    return true;
  }

  /** The produce jumps OUT of the ground in a semicircular arc to one side,
   *  bounces once, wobbles its size for cuteness, then vanishes. Pure flair —
   *  the item is already banked in the inventory. */
  private playHarvestPop(centerX: number, centerY: number, name: CropName): void {
    const item = this.add
      .image(centerX, centerY, 'farming_plants_items', `crop-${name}`)
      .setOrigin(0.5, 0.5)
      .setDepth(1e6 + 2);
    const dir = Phaser.Math.Between(0, 1) === 0 ? -1 : 1; // fly left or right
    const dist = 20; // how far to the side
    const arcH = 22; // arc (jump) height
    const p = { t: 0 };
    this.tweens.add({
      targets: p,
      t: 1,
      duration: 520,
      ease: 'Sine.easeOut',
      onUpdate: () => {
        const t = p.t;
        item.x = centerX + dir * dist * t;
        item.y = centerY - arcH * Math.sin(Math.PI * t); // up then down (semicircle)
        item.setScale(0.85 + 0.3 * Math.sin(Math.PI * t)); // grows at the apex — cute
      },
      onComplete: () => {
        // A little landing bounce, then a squash + fade out.
        this.tweens.add({
          targets: item,
          y: item.y - 6,
          duration: 120,
          yoyo: true,
          ease: 'Sine.easeOut',
          onComplete: () => {
            this.tweens.add({
              targets: item,
              alpha: 0,
              scaleX: 1.15,
              scaleY: 0.65,
              duration: 200,
              ease: 'Quad.easeIn',
              onComplete: () => item.destroy(),
            });
          },
        });
      },
    });
  }

  /** Add a stack to the inventory: merge into a same-id stackable cell with room,
   *  else drop into the first empty cell. (Silently discards if totally full.) */
  private addToInventory(item: ItemStack): void {
    if (item.stackable) {
      for (const cell of this.inventory) {
        if (cell && cell.id === item.id && cell.stackable && cell.count < MAX_STACK) {
          const moved = Math.min(MAX_STACK - cell.count, item.count);
          cell.count += moved;
          item.count -= moved;
          if (item.count <= 0) return;
        }
      }
    }
    const free = this.inventory.findIndex((c) => c === null);
    if (free >= 0) this.inventory[free] = item;
  }

  /** Count down soil wetness; when a cell dries, un-tint it. */
  private updateSoil(delta: number): void {
    for (const [key, ms] of this.soilWet) {
      const left = ms - delta;
      if (left <= 0) { this.soilWet.delete(key); this.setSoilWet(key, false); }
      else this.soilWet.set(key, left);
    }
  }

  /** Advance every growing crop; on WET soil it grows fast, on dry soil it crawls
   *  (water it to speed it up). Mature crops stop. */
  private updateCrops(delta: number): void {
    for (const [key, crop] of this.crops) {
      const max = CROPS[crop.name].stages - 1;
      if (crop.stage >= max) continue;
      crop.timer += delta;
      const wet = (this.soilWet.get(key) ?? 0) > 0;
      const need = wet ? CROP_STAGE_MS_WATERED : CROP_STAGE_MS_DRY;
      if (crop.timer >= need) {
        crop.timer = 0;
        crop.stage += 1;
        crop.sprite.setFrame(`grow-${crop.name}-${crop.stage}`);
        this.scheduleSave(); // a crop advanced a stage → persist
      }
    }
  }

  /** Tint / un-tint the soil sprite at a cell to show the damp watered look. */
  private setSoilWet(key: string, wet: boolean): void {
    const soil = this.tilledSoil.get(key);
    if (!soil) return;
    if (wet) soil.setTint(WET_SOIL_TINT);
    else soil.clearTint();
  }

  /** Water any TILLED soil cell → wet the ground (tint) for WET_DURATION_MS + play
   *  the splash. Any crop on it then grows fast. Crop or not, wet or not, you can
   *  always water (re-watering just refreshes it). Shared by the player and Cato.
   *  Returns true if it wet a tilled cell. */
  private waterCropAt(cx: number, cy: number): boolean {
    if (!this.islandLayer) return false;
    const key = `${cx},${cy}`;
    if (!this.tilledCells.has(key)) return false; // only tilled soil holds water
    this.soilWet.set(key, WET_DURATION_MS);
    this.setSoilWet(key, true); // damp soil look for WET_DURATION_MS
    this.scheduleSave();
    const w = this.islandLayer.tileToWorldXY(cx, cy);
    if (w) {
      // The splash art is NOT centred in its 48px frame — its content sits at
      // ~(18,29) not (24,24) — so a plain tile-centre placement landed the water
      // low-left of the tile. Offset it so the splash lands ON the tile centre.
      const splash = this.add
        .sprite(w.x + TILE / 2 + 6, w.y + TILE / 2 - 8, 'watering-splash')
        .setDepth(1e6)
        .play('water-splash');
      splash.once(Phaser.Animations.Events.ANIMATION_COMPLETE, () => splash.destroy());
      this.time.delayedCall(1200, () => splash.destroy()); // safety if COMPLETE misses
    }
    return true;
  }

  /** Player waters a crop: the state change + splash + a god-hand watering-can
   *  pour (the watering analogue of the hoe swing in tillCell). */
  private playerWater(cx: number, cy: number): void {
    if (!this.waterCropAt(cx, cy) || !this.islandLayer) return;
    this.hideTileCursor(); // the crop is now watered → drop the bracket/icon at once
    const w = this.islandLayer.tileToWorldXY(cx, cy);
    if (!w) return;
    const centerX = w.x + TILE / 2;
    const centerY = w.y + TILE / 2;
    // God-hand watering can: its SPOUT is on the LEFT of the sprite, so hold the
    // can to the RIGHT of the crop and up a bit — the left spout then sits over
    // the crop and the (centred) splash reads as pouring out of it. One at a time.
    this.waterCan?.destroy();
    const can = this.add
      .sprite(centerX + 11, centerY - 10, 'tools', 0)
      .setScale(1.5)
      .setDepth(1e6 + 1);
    can.play('water-pour');
    this.waterCan = can;
    const clearCan = () => { if (this.waterCan === can) this.waterCan = undefined; can.destroy(); };
    can.once(Phaser.Animations.Events.ANIMATION_COMPLETE, clearCan);
    this.time.delayedCall(950, clearCan); // safety if COMPLETE misses
  }

  /** Hide the tile bracket + held icon immediately (updateTileCursor re-shows it
   *  next frame if still over a valid target). Prevents a stale bracket lingering
   *  after an action changes the cell out from under it. */
  private hideTileCursor(): void {
    this.tileCursor?.setVisible(false);
    this.hoeIcon?.setVisible(false);
    this.hoverCell = null;
    this.cursorState.visible = this.locked;
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

    // God-hand hoe swing; when it lands, flip the cell to soil + re-autotile this
    // cell and its 4 neighbours (a new tilled cell changes their edges).
    this.hoeSwingAt(centerX, centerY, () => {
      this.dirtBurst(centerX, centerY); // dirt clods fly out as the hoe hits
      this.refreshSoil(cx, cy);
      this.refreshSoil(cx, cy - 1);
      this.refreshSoil(cx + 1, cy);
      this.refreshSoil(cx, cy + 1);
      this.refreshSoil(cx - 1, cy);
      this.scheduleSave();
    });
  }

  /** Spawn the god-hand hoe swing at a cell centre (raise → chop). `onStrike`
   *  fires ONCE when the hoe lands (ANIMATION_COMPLETE, with a delayedCall
   *  safety). Shared by tilling and harvesting. */
  private hoeSwingAt(centerX: number, centerY: number, onStrike: () => void): void {
    // Scaled 1.5× + nudged left so the hoe HEAD lands on the cell centre, sitting
    // a bit above so the strike comes DOWN onto the tile.
    const hoe = this.add
      .sprite(centerX - 6, centerY - TILE / 2, 'tools', 28)
      .setScale(1.5)
      .setDepth(1e6 + 1);
    hoe.play('hoe-swing');
    this.hoeSwing = hoe; // suppress the tile cursor while it swings
    let struck = false;
    const strike = () => {
      if (struck) return;
      struck = true;
      if (this.hoeSwing === hoe) this.hoeSwing = undefined;
      hoe.destroy();
      onStrike();
    };
    hoe.once(Phaser.Animations.Events.ANIMATION_COMPLETE, strike);
    this.time.delayedCall(1200, strike);
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
    let acted = false;
    for (const a of actions) {
      if (a.name === 'set_emote') continue; // handled in submitDialog (resting expression); not a task
      if (a.name === 'till_plot') { this.startTillTask(a.args); acted = true; }
      else if (a.name === 'plant_crop') { this.startPlantTask(a.args); acted = true; }
      else if (a.name === 'water_crops') { this.startWaterTask(a.args); acted = true; }
      else if (a.name === 'harvest_crops') { this.startHarvestTask(a.args); acted = true; }
    }
    // Let the guardian read Cato's reply, then close the chat so he walks off to
    // do it (he already starts moving; this just gets the box out of the way).
    if (acted) {
      this.time.delayedCall(1300, () => { if (this.dialogOpen) this.closeDialog(); });
    }
  }

  /** AI mood → teemo portrait animation (the tags on the emote sheet). Note the
   *  surprised tag is spelled "supprised" in the sheet. */
  private static EMOTE_ANIM: Record<string, string> = {
    happy: 'love', joyful: 'love', love: 'love',
    surprised: 'supprised', shocked: 'supprised',
    thinking: 'think', curious: 'think', unsure: 'think',
    playful: 'wink', cheeky: 'wink', teasing: 'wink',
    sad: 'sad', upset: 'sad',
    excited: 'dance', happy_excited: 'dance',
  };

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
    this.catoTask = { type: 'till', queue: cells, crop, cooldown: 0, stand: null };
    this.cameraFollow = true;
  }

  /** Begin the "plant a crop" behaviour: sow `count` (0 = all) nearest empty
   *  tilled cells with the crop. Needs tilled soil to exist. */
  private startPlantTask(rawArgs: unknown): void {
    if (!this.islandLayer || !this.child) return;
    const args = (rawArgs ?? {}) as { crop?: string; count?: number };
    const crop = this.parseCrop(args.crop);
    if (!crop) {
      this.registry.set('catoDialogText', "Cato blinks — it doesn't have seeds for that. Try corn, carrot, tomato, eggplant, or pumpkin.");
      return;
    }
    const max = args.count && args.count > 0 ? Math.round(args.count) : Infinity;
    const cells = this.findEmptySoil(max);
    if (cells.length === 0) {
      this.registry.set('catoDialogText', 'Cato looks for tilled soil to plant in — there’s none ready yet. Ask it to till a plot first!');
      return;
    }
    this.catoTask = { type: 'plant', queue: cells, crop: CROPS[crop].label, plantName: crop, cooldown: 0, stand: null };
    this.cameraFollow = true;
  }

  /** Loose crop-name match (corn/carrot/tomato/eggplant/pumpkin), or null. */
  private parseCrop(s: string | undefined): CropName | null {
    const t = (s ?? '').toLowerCase();
    const names: CropName[] = ['corn', 'carrot', 'tomato', 'eggplant', 'pumpkin'];
    return names.find((n) => t.includes(n)) ?? null;
  }

  /** The nearest `max` empty tilled-soil cells to Cato (for a plant task). */
  private findEmptySoil(max: number): Array<{ cx: number; cy: number }> {
    const layer = this.islandLayer;
    if (!layer || !this.child) return [];
    const origin = layer.worldToTileXY(this.child.x, this.child.y);
    const ocx = origin ? Math.floor(origin.x) : 0;
    const ocy = origin ? Math.floor(origin.y) : 0;
    const cells = [...this.tilledCells]
      .filter((k) => !this.crops.has(k))
      .map((k) => { const [cx, cy] = k.split(',').map(Number); return { cx, cy }; });
    cells.sort(
      (a, b) =>
        (a.cx - ocx) ** 2 + (a.cy - ocy) ** 2 - ((b.cx - ocx) ** 2 + (b.cy - ocy) ** 2),
    );
    return Number.isFinite(max) ? cells.slice(0, max) : cells;
  }

  /** Begin the "water crops" behaviour: water `count` (0 = all) nearest growing,
   *  un-watered crops. Needs planted crops that still need water. */
  private startWaterTask(rawArgs: unknown): void {
    if (!this.islandLayer || !this.child) return;
    const args = (rawArgs ?? {}) as { count?: number };
    const max = args.count && args.count > 0 ? Math.round(args.count) : Infinity;
    const cells = this.findWaterTargets(max);
    if (cells.length === 0) {
      this.registry.set('catoDialogText', "Cato peers around — nothing needs watering right now.");
      return;
    }
    this.catoTask = { type: 'water', queue: cells, crop: 'crops', cooldown: 0, stand: null };
    this.cameraFollow = true;
  }

  /** Begin the "harvest crops" behaviour: reap `count` (0 = all) nearest RIPE
   *  crops (produce → the guardian's backpack). */
  private startHarvestTask(rawArgs: unknown): void {
    if (!this.islandLayer || !this.child) return;
    const args = (rawArgs ?? {}) as { count?: number };
    const max = args.count && args.count > 0 ? Math.round(args.count) : Infinity;
    const cells = this.findHarvestTargets(max);
    if (cells.length === 0) {
      this.registry.set('catoDialogText', "Cato looks over the plants — nothing's ripe to pick yet.");
      return;
    }
    this.catoTask = { type: 'harvest', queue: cells, crop: 'crops', cooldown: 0, stand: null };
    this.cameraFollow = true;
  }

  /** The nearest `max` RIPE (fully grown) crop cells to Cato (for a harvest task). */
  private findHarvestTargets(max: number): Array<{ cx: number; cy: number }> {
    const layer = this.islandLayer;
    if (!layer || !this.child) return [];
    const origin = layer.worldToTileXY(this.child.x, this.child.y);
    const ocx = origin ? Math.floor(origin.x) : 0;
    const ocy = origin ? Math.floor(origin.y) : 0;
    const cells: Array<{ cx: number; cy: number }> = [];
    for (const [k, crop] of this.crops) {
      if (crop.stage < CROPS[crop.name].stages - 1) continue; // only ripe
      const [cx, cy] = k.split(',').map(Number);
      cells.push({ cx, cy });
    }
    cells.sort(
      (a, b) =>
        (a.cx - ocx) ** 2 + (a.cy - ocy) ** 2 - ((b.cx - ocx) ** 2 + (b.cy - ocy) ** 2),
    );
    return Number.isFinite(max) ? cells.slice(0, max) : cells;
  }

  /** The nearest `max` growing, un-watered crop cells to Cato (for a water task). */
  private findWaterTargets(max: number): Array<{ cx: number; cy: number }> {
    const layer = this.islandLayer;
    if (!layer || !this.child) return [];
    const origin = layer.worldToTileXY(this.child.x, this.child.y);
    const ocx = origin ? Math.floor(origin.x) : 0;
    const ocy = origin ? Math.floor(origin.y) : 0;
    const cells: Array<{ cx: number; cy: number }> = [];
    for (const [k, crop] of this.crops) {
      if (crop.stage >= CROPS[crop.name].stages - 1 || (this.soilWet.get(k) ?? 0) > 0) continue;
      const [cx, cy] = k.split(',').map(Number);
      cells.push({ cx, cy });
    }
    cells.sort(
      (a, b) =>
        (a.cx - ocx) ** 2 + (a.cy - ocy) ** 2 - ((b.cx - ocx) ** 2 + (b.cy - ocy) ** 2),
    );
    return Number.isFinite(max) ? cells.slice(0, max) : cells;
  }

  /** Walk Cato toward (tx,ty) along ONE cardinal axis at a time (the dominant
   *  remaining one) — the character sheet has no diagonal walk, so we never move
   *  diagonally; the path is L-shaped. Sets velocity + facing + walk anim. */
  private walkCardinalToward(tx: number, ty: number, speed: number): void {
    if (!this.child?.body) return;
    const body = this.child.body as Phaser.Physics.Arcade.Body;
    const dx = tx - this.child.x;
    const dy = ty - this.child.y;
    const DZ = 1.5; // per-axis deadzone so we don't jitter when nearly aligned
    if (Math.abs(dx) > DZ && Math.abs(dx) >= Math.abs(dy)) {
      body.setVelocity(Math.sign(dx) * speed, 0);
      this.faceDir = dx < 0 ? 'left' : 'right';
    } else if (Math.abs(dy) > DZ) {
      body.setVelocity(0, Math.sign(dy) * speed);
      this.faceDir = dy < 0 ? 'up' : 'down';
    } else {
      body.setVelocity(0, 0);
    }
    this.child.play(`walk-${this.faceDir}`, true);
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

    // NB: Cato keeps working even while the chat box is still up (the guardian
    // just gave the order) — the dialog auto-closes shortly after (runCatoActions).

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

    // Skip a cell that's no longer a valid target for this task type — idempotent
    // / robust to concurrent edits (the player may have acted on it meanwhile).
    if (!this.taskCellValid(task.type, next.cx, next.cy)) { task.queue.shift(); task.stand = null; return; }

    // Stand on a cell ADJACENT to the target and face it, so the swing/tend lands
    // ON the target (not under Cato's feet). Computed once per target.
    if (!task.stand) task.stand = this.computeStand(next);
    const s = task.stand;
    const dx = s.x - this.child.x;
    const dy = s.y - this.child.y;
    const dist = Math.hypot(dx, dy);

    if (dist > CATO_ARRIVE_DIST) {
      this.walkCardinalToward(s.x, s.y, CATO_TILL_SPEED); // cardinal only (no diagonal anim)
      return;
    }

    // Arrived beside the target: face it and work with Cato's OWN attack anim.
    // Till → flip to soil; plant → drop a seedling. The effect lands partway
    // through the swing (commitCatoTill / delayed plant).
    body.setVelocity(0, 0);
    this.faceDir = s.dir;
    // Water uses Cato's watering animation; till/plant use his attack (hoe) swing.
    this.child.play(`${task.type === 'water' ? 'water' : 'attack'}-${s.dir}`, true);
    const tx = next.cx, ty = next.cy;
    if (task.type === 'till') {
      this.commitCatoTill(tx, ty);
    } else if (task.type === 'plant' && task.plantName) {
      const name = task.plantName;
      this.time.delayedCall(CATO_TILL_STRIKE_MS, () => this.plantCropAt(tx, ty, name));
    } else if (task.type === 'water') {
      this.time.delayedCall(CATO_TILL_STRIKE_MS, () => this.waterCropAt(tx, ty));
    } else if (task.type === 'harvest') {
      this.time.delayedCall(CATO_TILL_STRIKE_MS, () => this.reapCrop(tx, ty));
    }
    task.queue.shift();
    task.stand = null;
    task.cooldown = CATO_TILL_STEP_MS;
  }

  /** Is (cx,cy) still a valid target for a task of this type? */
  private taskCellValid(type: 'till' | 'plant' | 'water' | 'harvest', cx: number, cy: number): boolean {
    const key = `${cx},${cy}`;
    if (type === 'till') return !this.tilledCells.has(key) && this.isFarmable(cx, cy);
    if (type === 'plant') return this.tilledCells.has(key) && !this.crops.has(key);
    const crop = this.crops.get(key);
    if (type === 'harvest') return !!crop && crop.stage >= CROPS[crop.name].stages - 1; // ripe
    // water: a growing crop on DRY soil is here (Cato waters what needs it).
    return !!crop && crop.stage < CROPS[crop.name].stages - 1 && (this.soilWet.get(key) ?? 0) <= 0;
  }

  /** Pick the cell Cato stands on to hoe `target`: an adjacent tile (preferring
   *  ones on the island so he doesn't stand on water) nearest to where he is now,
   *  plus the direction he faces to swing at the target. */
  private computeStand(target: { cx: number; cy: number }): { x: number; y: number; dir: FaceDir } {
    const layer = this.islandLayer!;
    const cur = layer.worldToTileXY(this.child!.x, this.child!.y);
    const ocx = cur ? Math.floor(cur.x) : target.cx;
    const ocy = cur ? Math.floor(cur.y) : target.cy;
    // Stand on each side, facing the target: below→up, above→down, left→right, right→left.
    const cands: Array<{ cx: number; cy: number; dir: FaceDir }> = [
      { cx: target.cx, cy: target.cy + 1, dir: 'up' },
      { cx: target.cx, cy: target.cy - 1, dir: 'down' },
      { cx: target.cx - 1, cy: target.cy, dir: 'right' },
      { cx: target.cx + 1, cy: target.cy, dir: 'left' },
    ];
    const onIsland = cands.filter((c) => layer.getTileAt(c.cx, c.cy) != null);
    const pool = onIsland.length ? onIsland : cands;
    pool.sort(
      (a, b) =>
        (a.cx - ocx) ** 2 + (a.cy - ocy) ** 2 - ((b.cx - ocx) ** 2 + (b.cy - ocy) ** 2),
    );
    const best = pool[0];
    const w = layer.tileToWorldXY(best.cx, best.cy);
    return { x: (w?.x ?? 0) + TILE / 2, y: (w?.y ?? 0) + TILE / 2, dir: best.dir };
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
      this.scheduleSave();
    });
  }

  /** Task finished: clear it, tell Cato so he remembers, resume wander. */
  private finishCatoTask(): void {
    const task = this.catoTask;
    this.catoTask = null;
    this.cameraFollow = false;
    if (task?.type === 'plant') {
      this.cato?.note(`You planted ${task.crop} in the tilled soil; it will grow over time.`);
    } else if (task?.type === 'water') {
      this.cato?.note('You watered the crops; they will grow faster now.');
    } else if (task?.type === 'harvest') {
      this.cato?.note("You harvested the ripe crops; the produce is in the guardian's backpack now.");
    } else {
      this.cato?.note(`You finished tilling a plot of soil, ready for the guardian to plant ${task?.crop ?? 'crops'}.`);
    }
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
  private static DIALOG_ROLES = ['chat-message', 'chat-input', 'chat-text', 'chat-input-field', 'cato-portrait', 'cato-name-frame', 'cato-name-text'];

  /** Play an emote animation on Cato's dialog portrait (the teemo sprite). Talking
   *  → 'idle-talk'; idle → 'blink-eye'. (More emotes per mood later.) */
  private setCatoEmote(anim: string): void {
    const go = getHudObject(this, 'cato-portrait') as unknown as
      | { play?: (key: string, ignoreIfPlaying?: boolean) => void }
      | undefined;
    go?.play?.(anim, true);
  }

  /** Play the talking anim for a beat (scaled to reply length), then settle onto
   *  the turn's resting expression (`catoEmote` — the mood the AI set, or a plain
   *  blink) and HOLD it there until the next message. */
  private catoTalkFor(text: string): void {
    if (!this.dialogOpen) return;
    this.setCatoEmote('idle-talk');
    this.catoTalkTimer?.remove();
    const ms = Phaser.Math.Clamp(900 + text.length * 55, 1200, 5000);
    this.catoTalkTimer = this.time.delayedCall(ms, () => {
      if (this.dialogOpen) this.setCatoEmote(this.catoEmote);
    });
  }
  private catoTalkTimer?: Phaser.Time.TimerEvent;
  private catoEmote = 'blink-eye'; // resting expression, held until the next reply

  /** Strip *italic stage-direction* asides ("*tilts head*") from a reply — the
   *  portrait carries the mood now, so the text stays clean spoken dialogue. */
  private stripAsides(text: string): string {
    return text.replace(/\*[^*]*\*/g, '').replace(/\s{2,}/g, ' ').trim();
  }

  /** A varied warm filler for when the AI returned no spoken text (only a tool
   *  call, or an aside-only reply). Contextual when Cato is off doing a task. */
  private fallbackSay(doingTask: boolean): string {
    const lines = doingTask
      ? ['Okay — on it!', 'Right away!', 'Mmhm, doing it now!', 'Hehe, okay!']
      : ['Hehe.', 'Mm?', 'Cato peeks up at you.', 'Cato wiggles happily.'];
    return Phaser.Utils.Array.GetRandom(lines);
  }

  /** The teemo animation for a set_emote action in this turn's `do` list, or null. */
  private emoteAnimFor(actions: Array<{ name: string; args: unknown }> | undefined): string | null {
    const e = actions?.find((a) => a.name === 'set_emote');
    if (!e) return null;
    const mood = String((e.args as { mood?: string })?.mood ?? '').toLowerCase();
    return GameScene.EMOTE_ANIM[mood] ?? null;
  }

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
    this.catoEmote = 'blink-eye'; // reset the resting expression
    this.setCatoEmote('blink-eye'); // idle until Cato replies
  }

  /** Hide the dialog (slide back down) + tear down the typing input. */
  private closeDialog(): void {
    if (!this.dialogOpen) return;
    this.dialogOpen = false;
    this.catoTalkTimer?.remove(); // stop the talk→blink settle timer
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

  /** A compact snapshot of the current game state, sent to Cato as `observation`
   *  each turn so he can SEE the backpack + farm and answer / act on them (what do
   *  we have, what's growing, anything ripe / thirsty, room to plant). Cheap layer
   *  before a real tool-agent: the game holds all this state locally already. */
  private buildObservation(): Record<string, unknown> {
    // Backpack: aggregate stacks by item name → one line each.
    const bag = new Map<string, number>();
    for (const c of this.inventory) {
      if (c) bag.set(c.label ?? c.id, (bag.get(c.label ?? c.id) ?? 0) + c.count);
    }
    const backpack = [...bag].map(([item, count]) => ({ item, count }));

    // Farm: crop counts by type + how many are ripe / still growing / thirsty,
    // plus empty tilled soil ready to plant.
    const byType: Record<string, number> = {};
    let ripe = 0;
    let growing = 0;
    let thirsty = 0;
    for (const [key, crop] of this.crops) {
      byType[crop.name] = (byType[crop.name] ?? 0) + 1;
      if (crop.stage >= CROPS[crop.name].stages - 1) ripe += 1;
      else {
        growing += 1;
        if ((this.soilWet.get(key) ?? 0) <= 0) thirsty += 1;
      }
    }
    let tilledEmpty = 0;
    for (const key of this.tilledCells) if (!this.crops.has(key)) tilledEmpty += 1;

    return {
      island: 'home',
      timeOfDay: 'day',
      backpack, // e.g. [{item:'Corn seeds', count:10}, {item:'Hoe', count:1}]
      farm: {
        plantedByCrop: byType, // {corn:3, carrot:2}
        ripe, // ready to harvest
        growing, // still growing
        thirsty, // growing on dry soil (would grow faster if watered)
        tilledEmpty, // tilled soil with nothing planted yet
      },
    };
  }

  // ── Loading gate (hide content until the save is restored) ────────────

  /** Cover the whole viewport with an opaque "Loading…" panel (above everything)
   *  so the empty/default world isn't shown before the save is applied. */
  private showLoadingCover(): void {
    if (this.loadingCover) return;
    const w = this.scale.width;
    const h = this.scale.height;
    // Oversized so it covers any canvas size during the brief load (no reflow).
    const rect = this.add.rectangle(-2000, -2000, 8000, 8000, 0x2e2a24, 1).setOrigin(0, 0);
    const txt = this.add
      .text(w / 2, h / 2, 'Loading…', { fontFamily: 'zpix, sans-serif', fontSize: '28px', color: '#f4e4c1' })
      .setOrigin(0.5);
    this.loadingCover = this.add.container(0, 0, [rect, txt]).setScrollFactor(0).setDepth(1e7);
  }

  /** Reveal the game once the save is restored (or a fallback fires): fade the
   *  cover out + let the hotbar show. */
  private markReady(): void {
    if (this.gameReady) return;
    this.gameReady = true;
    this.publishInventory(); // hotbar was suppressed until now
    const c = this.loadingCover;
    this.loadingCover = undefined;
    if (c) {
      this.tweens.add({ targets: c, alpha: 0, duration: 250, onComplete: () => c.destroy() });
    }
  }

  // ── Save data (auto-save + restore) ───────────────────────────────────

  /** Serialize the whole game state into the save blob. */
  private buildSave(): SaveBlob {
    return {
      v: 1,
      inventory: this.inventory.map((c) => (c ? { id: c.id, count: c.count } : null)),
      selected: this.hotbarSelected,
      tilled: [...this.tilledCells],
      soilWet: [...this.soilWet],
      crops: [...this.crops].map(([key, c]) => ({ key, name: c.name, stage: c.stage, timer: c.timer })),
      cato: this.child ? { x: Math.round(this.child.x), y: Math.round(this.child.y) } : null,
    };
  }

  /** Persist now (fire-and-forget; anonymous → localStorage, signed-in → backend). */
  private saveGame(): void {
    if (!this.umicat || this.loadingSave || !this.saveArmed) return;
    this.umicat.saves.set('state', this.buildSave()).catch((e) => console.warn('[catopia][save] set failed', e));
  }

  /** Debounced save after a state change (rapid actions coalesce). Short delay so
   *  the state reaches the backend while the tab is still open — a save-on-close
   *  is unreliable (the async backend write can't finish as the page tears down). */
  private scheduleSave(): void {
    if (!this.umicat || this.loadingSave || !this.saveArmed) return;
    this.pendingSave?.remove();
    this.pendingSave = this.time.delayedCall(700, () => this.saveGame());
  }

  /** Load + apply the saved state on boot (no-op if none / wrong version). */
  private async loadGame(): Promise<void> {
    if (!this.umicat) { console.warn('[catopia][save] load skipped — no umicat'); return; }
    try {
      const s = await this.umicat.saves.get<SaveBlob>('state');
      if (s && s.v === 1) this.applySave(s);
      // The store was read (found or empty) → NOW it's safe to overwrite it.
      this.saveArmed = true;
    } catch (e) {
      // Read failed — do NOT arm saving, so we can't clobber a save that exists
      // but momentarily failed to load. (Saving stays off for this session.)
      console.warn('[catopia][save] load failed — saving disabled this session', e);
    }
  }

  /** Restore state from a save blob (overrides the fresh-start defaults). */
  private applySave(s: SaveBlob): void {
    this.loadingSave = true;
    try {
      // Farm: tear down the current soil/crops, then rebuild from the save.
      for (const soil of this.tilledSoil.values()) soil.destroy();
      this.tilledSoil.clear();
      for (const c of this.crops.values()) c.sprite.destroy();
      this.crops.clear();
      this.tilledCells.clear();
      this.soilWet.clear();
      if (this.islandLayer) {
        for (const key of s.tilled ?? []) this.tilledCells.add(key);
        for (const key of this.tilledCells) {
          const [cx, cy] = key.split(',').map(Number);
          this.refreshSoil(cx, cy); // autotile now sees all neighbours
        }
        for (const [key, ms] of s.soilWet ?? []) {
          this.soilWet.set(key, ms);
          this.setSoilWet(key, true);
        }
        for (const c of s.crops ?? []) this.restoreCrop(c.key, c.name, c.stage, c.timer);
      }
      // Backpack (rebuild full stacks from ids) + selection + Cato position. Build
      // a DENSE array (fill(null)) — a sparse array would have holes that .map skips.
      const cells = new Array<ItemStack | null>(INV_ROWS * INV_COLS).fill(null);
      const saved = s.inventory ?? [];
      for (let i = 0; i < Math.min(saved.length, cells.length); i++) {
        const c = saved[i];
        cells[i] = c ? itemFromId(c.id, c.count) : null;
      }
      this.inventory = cells;
      this.hotbarSelected = s.selected ?? -1;
      if (s.cato && this.child) this.child.setPosition(s.cato.x, s.cato.y);
      this.equipSelected();
      this.publishInventory();
    } finally {
      this.loadingSave = false;
    }
  }

  /** Recreate a crop sprite at (key) for a given growth stage (save restore). */
  private restoreCrop(key: string, name: CropName, stage: number, timer: number): void {
    if (!this.islandLayer) return;
    const [cx, cy] = key.split(',').map(Number);
    const w = this.islandLayer.tileToWorldXY(cx, cy);
    if (!w) return;
    const footX = w.x + TILE / 2;
    const footY = w.y + TILE / 2;
    const sprite = this.add
      .image(footX, footY, 'farming_plants', `grow-${name}-${stage}`)
      .setOrigin(0.5, 1)
      .setDepth(footY);
    this.crops.set(key, { name, stage, timer, sprite });
  }

  /** Periodic backstop save + save when the tab is hidden / closed. */
  private setupAutosave(): void {
    this.time.addEvent({ delay: 15000, loop: true, callback: () => this.saveGame() });
    const onVis = () => { if (document.visibilityState === 'hidden') this.saveGame(); };
    document.addEventListener('visibilitychange', onVis);
    const onHide = () => this.saveGame();
    window.addEventListener('pagehide', onHide);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      document.removeEventListener('visibilitychange', onVis);
      window.removeEventListener('pagehide', onHide);
    });
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
        observation: this.buildObservation(),
      });
      if (r.ok) {
        // Cato's feelings show on the portrait now, so strip any *stage-direction*
        // asides the AI still writes ("*tilts head*") — display clean speech only.
        // Haiku sometimes returns no spoken text (only a tool call / an aside), so
        // fall back to a varied warm filler (contextual if it's doing something).
        const say = this.stripAsides(r.say || '') || this.fallbackSay(!!r.do?.some((a) => a.name !== 'set_emote'));
        this.registry.set('catoDialogText', say);
        // The mood the AI set this turn becomes the resting expression (held until
        // the next reply); no set_emote → a plain blink.
        this.catoEmote = this.emoteAnimFor(r.do) ?? 'blink-eye';
        this.catoTalkFor(say); // talk a beat, then settle onto catoEmote + hold
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
    this.updateSoil(delta); // count down soil wetness (dry out over time)
    this.updateCrops(delta); // grow planted crops through their stages
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

    // Publish the virtual cursor to CursorScene (renders it above the HUD). ONLY
    // drive it from the virtual cursor while pointer-LOCKED (mouse); on TOUCH the
    // position is set by the touch handlers (e.g. the dragged backpack stack), so
    // overwriting it here each frame would fight them → a flickering "ghost".
    if (this.locked) {
      this.cursorState.x = this.vcursor.x;
      this.cursorState.y = this.vcursor.y;
    }
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

    // Leash: Cato hangs around the CAMERA CENTRE (like a companion staying in
    // view) rather than roaming the whole island. If he strays past the leash
    // radius (or is on his way back), walk him toward the centre; once he's back
    // inside the inner radius, resume the local walk/idle wander. This also brings
    // him home after a task (he ends wherever the plot was).
    const cam = this.cameras.main;
    const ccx = cam.worldView.centerX;
    const ccy = cam.worldView.centerY;
    const dx = ccx - this.child.x;
    const dy = ccy - this.child.y;
    const dist = Math.hypot(dx, dy);
    if (dist > CATO_LEASH_RADIUS || (this.catoReturning && dist > CATO_LEASH_RETURN)) {
      this.catoReturning = true;
      this.walkCardinalToward(ccx, ccy, CHILD_SPEED); // cardinal only (no diagonal anim)
      this.wanderState = 'walk';
      this.wanderTimer = 0;
      return;
    }
    this.catoReturning = false;

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
