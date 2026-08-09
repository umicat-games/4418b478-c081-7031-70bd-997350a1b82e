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
import type { MailListEntry, OrderCatalogEntry } from './menu-types';
import type { ReceiptLine } from './ReceiptScene';
import type { LetterboxScene } from './LetterboxScene';
import type { HoverModel } from './HoverScene';
import { ORDERABLE_IDS, buyPrice, sellPrice, foodValue, isFood } from '../data/items';
import { RECIPES, type Recipe } from '../data/recipes';
import { t, initLang, getLang } from '../i18n';
import { CROPS, CROP_NAMES, type CropName } from '../data/crops';
import { EmoteController, type Emotion } from '../emote';
import { crossToBgm, setBgmVolume } from '../bgm';
import { playSfx, setSfxVolume, SFX_SCROLL, SFX_HOE, SFX_CHOP, SFX_HOVER } from '../sfx';
import { coverAndReload, finishTransition } from '../transition';
import { LoadingOverlay } from '../LoadingOverlay';
import { DialogueRunner, trDialogue, type DialogueScript, type DialogueHost } from '../dialogue';
import { isDebug, toggleDebug } from '../debug';
import {
  FORAGABLES, FORAGABLE_NAMES, BIG_STONES, BIG_STONE_TIERS,
  FORAGE_SPAWN_INTERVAL_MS, FORAGE_MAX_ON_MAP, BIG_STONE_SPAWN_CHANCE,
  type ForagableName,
} from '../data/foragables';
// Rex gesture helpers — no plugin registration needed
// @ts-ignore – rex has no bundled TS declarations for this path
import { Pan, Tap } from 'phaser3-rex-plugins/plugins/gestures.js';

// --- Wander tuning ---
// Set to `false` to PIN the cat at its spawn position (no roaming) — useful
// for verifying entity world coordinates against the editor rulers.
const CHILD_WANDER = true;
const CHILD_SPEED = 50;               // world-px per second (leisurely stroll)
// PLAYER CONTROL: when true, WASD / arrow keys drive Cato directly (the camera
// follows him) instead of panning the camera + autonomous wander. Cato's
// chat-commanded tasks still run. This is now RUNTIME-TOGGLEABLE via an on-screen
// TEST button (`this.playerControl` / `createControlToggle`) — the const below is
// only the STARTING mode. Default false = AI companion (roam + leash).
const PLAYER_CONTROL_DEFAULT = false;
const PLAYER_SPEED = 80;              // world-px/s when the player drives Cato
// Cato is a calm companion: he mostly RESTS, and every so often ambles over to a
// nearby point of interest (a crop or a prop that's in view) and lingers there —
// "rest in front of something, occasionally wander" rather than constant random
// walking. These tune how long he lingers and how often he decides to move.
const REST_MIN_MS = 3000;     // min time Cato lingers before considering a move
const REST_MAX_MS = 7000;     // max linger time
const WANDER_MOVE_CHANCE = 0.65; // after a rest, chance he strolls to a real POI (else lingers)
const WANDER_STROLL_CHANCE = 0.3; // when nothing's in reach, chance of an aimless amble
const WANDER_ARRIVE = 16;     // stop ~a tile short of the POI ("in front of it")
const WANDER_MIN_TRIP = 24;   // a POI must be at least this far to be worth walking to

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
const CATO_STUCK_MS = 2200; // no progress toward a target this long → it's unreachable, skip it
const CATO_ESCAPE_MS = 3500; // trying to walk out of the house this long (on foot) → warp him out
// Cato's STAMINA — a limited energy pool drained by doing tasks, regained by resting.
// The MAX is a saved per-Cato value (`staminaMax`), NOT this const, so a future upgrade
// can RAISE the cap; this is just the starting cap. Rates are per-second.
const STAMINA_MAX_DEFAULT = 100;
const STAMINA_DRAIN_PER_SEC = 5;    // ~20s of continuous work drains a full bar
const STAMINA_REGEN_PER_SEC = 3.5;  // ~29s to fully recover from empty
const STAMINA_LOW_FRAC = 0.3;       // below this WHILE WORKING → a sweat emote
const STAMINA_RECOVER_FRAC = 0.5;   // once exhausted, must regen to this before working again
const CATO_EAT_ANNOUNCE_MS = 1900;  // beat between "found a snack" remark and the first bite (sit & rest)
const CHATTER_MS = 5000;            // how long Cato's proactive small-talk chip lingers before it auto-hides
const CATO_PLOT_SEARCH_R = 10; // tiles around Cato to search for an open plot
const CATO_PLOT_MAX = 4;      // clamp the requested plot side (N×N)
// Day/time HUD: one full day loops in this many ms of play; the sun-arc pointer
// steps through 5 frames (morning ↗ → evening ↘) across it, then wraps.
const DAY_LEN_MS = 10 * 60 * 1000; // ~10 min per in-game day
// Day/night MASK: a full-screen colour tint over the WORLD (below the HUD scenes, so
// UI stays readable) that darkens toward evening + night. Keyframes = [dayFraction t,
// hexColour, alpha], smoothly lerped; CYCLIC (t=1 must equal t=0 so midnight→dawn
// doesn't pop). Morning/noon = clear; warm at dusk → deep navy at night → fades back
// to clear by dawn. Tune these freely (colours/alpha/timing) — press U to fast-forward.
const NIGHT_KEYS: Array<[number, number, number]> = [
  [0.00, 0x0c1636, 0.00], // dawn — clear
  [0.52, 0x0c1636, 0.00], // full day — clear
  [0.62, 0xe8763c, 0.16], // early evening — warm orange
  [0.72, 0x8a4e74, 0.30], // dusk — purple
  [0.82, 0x24306a, 0.44], // nightfall — blue
  [0.93, 0x0c1636, 0.54], // deep night — navy
  [1.00, 0x0c1636, 0.00], // dawn breaking — back to clear (wraps to t=0)
];
const NIGHT_MASK_DEPTH = 500000; // above every world sprite, below the loading cover (1e7) + HUD scenes
// TEMP (restore to true): random wild spawning (grass/foragables + big-stones) is
// OFF while the creator arranges the default layout, so it doesn't clutter the map.
const SPAWN_WILD = false;
// Weather = a TIME-tinted background (fills the window) + a transparent weather icon
// on top. Sunny only for now (decorative); the icon cycles per day for variety.
const WEATHER_ICONS = ['sunny-no-bg', 'partial-sunny-no-bg', 'sunny-with-cloud-no-bg'];
const WEATHER_BGS = ['background-morning', 'background-noon', 'background-night']; // by time of day
// Leash: Cato stays near the CAMERA CENTRE (in view) instead of roaming the whole
// map. The radius ADAPTS to the visible area (`wanderLeashRadius`) so he keeps in
// frame at any zoom; if he strays past it he heads back until within half of it.
// Debug switches now live in the central registry `src/debug.ts` (toggleable from
// Settings → Debug). `devTools` = the T/P/O/H/M/X dev keys + test tools; read once at
// scene-create so a toggle applies on the next reload. `replayIntro` (intro on load)
// + `clearMailbox` are read at load; `coinFloor` (5000 floor) is read live per-frame.
const CATO_DEBUG_TILL = isDebug('devTools');
const DEBUG_CLEAR_MAILBOX = isDebug('clearMailbox');

// Un-till: hoeing EMPTY tilled soil once "loosens" it (furrow-lines mark); a
// SECOND hoe within this window digs it back up to grass, otherwise it settles
// back to plain dirt. Frame 47 = tile (3,4) in tilled_dirt_wide_v2 (the furrow
// mark, transparent elsewhere — overlaid straight from the 'tilled-dirt' sheet).
const LOOSEN_WINDOW_MS = 3000;
const SOIL_LOOSEN_FRAME = 47;

// Custom pointer-lock cursor: the texture key + hotspot live in CursorScene
// (which renders it above the HUD); GameScene only drives its position.

// Fallback id for the grass-island tilemap. Re-dragging a tilemap in the editor
// CHANGES its entity id, so we resolve it by the stable NAME ('island') at
// runtime (see create()) and only fall back to this if the name lookup fails.
const GRASS_ISLAND_ENTITY_ID = 'e-mr1hfmhm-totv';
const GRASS_ISLAND_NAME = 'island';

type FaceDir = 'down' | 'up' | 'left' | 'right';

type ToolId = 'hand' | 'hoe' | 'watering-can' | 'axe' | 'pickaxe';
// Actions on an item in the backpack / chest / Cato-bag menu. `use` = hold it; `store` = backpack→
// chest; `take` = chest→backpack.
type MenuItemAction = 'use' | 'store' | 'take' | 'hotbar' | 'sell' | 'give' | 'feed' | 'tochest' | 'delete';
const TAB_BACKPACK = 5; // the standalone backpack view (no tab bar) — distinct from the 0-4 menu tabs

// Inventory grid (Stardew-style): a backpack of INV_ROWS × INV_COLS cells. Row 0
// IS the hotbar (always visible); pressing E opens the full grid. Growing the
// backpack later = bump INV_ROWS. Stackable items merge up to MAX_STACK per cell.
const INV_COLS = 8;
const INV_ROWS = 5; // 1 hotbar row + 4 backpack rows (bumped 4→5 for foragables/stones)
const CHEST_SLOTS = 60; // chest capacity (distinct stacks) — buying a NEW item type needs a free slot
const CATO_BAG_SLOTS = 12; // Cato's bag is SMALL (distinct stacks) — a new item type needs a free slot
const BACKPACK_SLOTS = 24; // the player's carried backpack (distinct stacks) — full → can't harvest/buy
const MAX_STACK = 99;

/** One stack of items in a single inventory/hotbar cell. Tools are
 *  non-stackable (count 1, carry a `toolId` they equip on select); seeds /
 *  materials / crops stack up to MAX_STACK. `id` is the merge key. Empty = null. */
interface ItemStack {
  id: string;
  label?: string;
  iconKey?: string;
  iconFrame?: string | number;
  count: number;
  stackable: boolean;
  toolId?: ToolId;
  plants?: CropName; // a seed bag: selecting it lets you plant this crop on soil
  place?: PlaceKind; // a building material: selecting it enters placement mode
  variant?: string; // furniture piece id (for place==='furniture')
}

/** One mail in the mailbox's Mail tab. `iconFrame` = the list icon (ui-icons);
 *  a sales receipt opens the ReceiptScene from its `lines` + `total`. */
interface MailEntry {
  id: string;
  kind: 'sell-receipt';
  sender: string;
  title: string;
  iconFrame: number;
  read: boolean;
  lines: ReceiptLine[];
  total: number;
}

// --- House building (Sprout Lands premium "Building parts") ---
// The player places wooden walls, a door, and furniture from the backpack to
// build Cato a house. Walls block Cato (static bodies); furniture is decorative;
// the door opens (animation) when Cato is near.
// Placement KINDS. Only WALL needs an orientation (the 3×3 build palette); floor /
// window / door / furniture are single-orientation items (each its own backpack item).
type PlaceKind = 'wall' | 'floor' | 'window' | 'door' | 'furniture' | 'tree' | 'bush';
// Wall orientation → frame in the `house-walls` sheet (5×3, frame = row*5 + col).
// The cols 0-2 block is the 3×3 nine-slice; walls are the 8 EDGES + CORNERS (the
// centre frame 6 is the brick FLOOR, a separate item — not a wall orientation).
type WallOrient = 'top' | 'bottom' | 'left' | 'right' | 'tl' | 'tr' | 'bl' | 'br' | 'window';
const WALL_FRAME: Record<WallOrient, number> = {
  tl: 0,  top: 1,    tr: 2,
  left: 5, right: 7,
  bl: 10, bottom: 11, br: 12,
  window: 6, // legacy: old saves stored the brick FLOOR as orient 'window'; migrated
};
// The 8 wall orientations, laid out as the 3×3 build palette (row-major; centre is
// empty — the brick floor is its own item). Used by the palette + the R shortcut.
const WALL_PALETTE: Array<WallOrient | null> = [
  'tl', 'top', 'tr',
  'left', null, 'right',
  'bl', 'bottom', 'br',
];
const WALL_ORIENTS: WallOrient[] = WALL_PALETTE.filter((o): o is WallOrient => o !== null);
const FLOOR_FRAME = 6;  // brick floor (a ground-layer, non-solid item)
const WINDOW_FRAME = 13; // a wall segment with a window (solid; future item)
// Door: 16×16 top-row frames (0=open … 5=closed); the swing is the `door-open` anim.
const DOOR_CLOSED_FRAME = 5;
// Editor-authored furniture sprites use the `basic_furniture` atlas REGION names
// (bed-pink / table / …). These regions are NOT solid: rugs lie flat (Cato walks
// on them) and wall pictures/clocks sit on the wall row (the wall already
// collides). Everything else (beds, tables, drawers, chairs, pot-flowers, lamps)
// gets a collider + blocks pathfinding. Tell me to move a piece across the line.
const NON_SOLID_FURNITURE = new Set<string>([
  'rug-green', 'rug-pink', 'rug-blue', 'rug-small-green', 'rug-small-pink', 'rug-small-blue',
  'picture-1', 'picture-2', 'picture-3', 'clock-1', 'clock-2', 'clock-3',
]);
// Beds Cato can climb ONTO (walkable, no collider) but y-sorted by their TOP edge
// (ysortBias) so he draws over them when on/in front — see wireHouseFurniture.
const BED_FRAMES = new Set<string>(['bed-green', 'bed-blue', 'bed-pink']);
// Furniture pieces the `furniture` material cycles through (R key). Single 16×16
// tiles from the `furniture` sheet (frame = row*9 + col). Frames refined visually.
interface FurnPiece { id: string; label: string; frame: number }
const FURNITURE: FurnPiece[] = [
  { id: 'plant',   label: 'Potted plant', frame: 3 },
  { id: 'flower',  label: 'Flowers',      frame: 5 },
  { id: 'lamp',    label: 'Lamp',         frame: 13 },
  { id: 'dresser', label: 'Dresser',      frame: 21 },
  { id: 'chair',   label: 'Chair',        frame: 22 },
  { id: 'stool',   label: 'Stool',        frame: 24 },
  { id: 'clock',   label: 'Clock',        frame: 33 },
  { id: 'rug',     label: 'Rug',          frame: 46 },
];
const FURN_BY_ID = new Map(FURNITURE.map((f) => [f.id, f]));

// --- Trees (placed from the backpack, chopped with the AXE) ---
// Fruit trees drop 3 fruits when chopped (3 axe strikes, shakes 1→2→3) then become a
// plain tree; a plain tree is felled (fall animation) on 3 strikes. Textures/anims
// are registered in BootScene (`tree-<type>`, `tree-<type>-shake1..3`, `tree-fall`).
type TreeType = 'apple' | 'pear' | 'peach' | 'plain';
interface TreeDef { id: TreeType; label: string; fruit: boolean }
const TREE_TYPES: TreeDef[] = [
  { id: 'apple', label: 'Apple tree', fruit: true },
  { id: 'pear', label: 'Pear tree', fruit: true },
  { id: 'peach', label: 'Peach tree', fruit: true },
  { id: 'plain', label: 'Tree', fruit: false },
];
const TREE_BY_ID = new Map(TREE_TYPES.map((t) => [t.id, t]));
const TREE_CHOP_WINDOW_MS = 2000; // chop again within this to advance the shake combo
const FRUIT_LABEL: Record<string, string> = {
  apple: 'Apple', pear: 'Pear', peach: 'Peach',
  strawberry: 'Strawberry', grape: 'Grape', blueberry: 'Blueberry',
};
// Frame in the `fruit-items` sheet (4×2 of 16×16): apple=0, orange=1, pear=2, peach=3;
// row 2 (region-tagged) = strawberry=4, grape=5, blueberry=6.
const FRUIT_FRAME: Record<string, number> = {
  apple: 0, pear: 2, peach: 3, strawberry: 4, grape: 5, blueberry: 6,
};

// Where the 3 harvested fruits sit on the ground, in world px offset from the tree FOOT
// (`w.x+TILE/2`, `w.y+TILE`). Measured from the tree shake sheet's LAST frame (48px frame,
// foot at pixel 24,48, scale 1): 1 left + 2 right of the trunk — so the collected fruit
// lands exactly where the sheet dropped it. Same layout across apple/pear/peach.
const FRUIT_DROP_OFFSETS: ReadonlyArray<{ dx: number; dy: number }> = [
  { dx: 20, dy: -13 },  // far right
  { dx: -19, dy: -17 }, // left, higher
  { dx: -16, dy: -9 },  // left, lower
];

// --- Berry bushes (planted from the backpack, grow, harvested by hand/hoe) ---
// A bush grows empty-bush-small (stage 0) → empty-bush (1) → empty-bush + 3 berries
// (stage 2, ripe). Harvest drops 3 berries + reverts to stage 1; it regrows to 2.
type BerryType = 'strawberry' | 'grape' | 'blueberry';
const BERRY_TYPES: BerryType[] = ['strawberry', 'grape', 'blueberry'];
const BUSH_STAGE_MS = 9000; // time per grow stage (0→1→2) + regrow (1→2)
// The 3 berry overlays' offsets (px from the bush foot-centre). Matched to the
// `bush-with-<type>` reference art: a triangle (upper-right / mid-left / lower-centre)
// sitting a bit LOWER on the bush than a naive top placement.
const BERRY_OFFSETS: ReadonlyArray<{ x: number; y: number }> = [
  { x: 3, y: -1 }, { x: -3, y: 1 }, { x: 1, y: 5 },
];
// A non-solid (floor) wall tile renders as a GROUND layer — a low fixed depth so it
// sits above the grass tilemap but always BEHIND Cato / walls / furniture (he walks
// ON it). Solid walls + furniture y-sort by footY as usual.
const FLOOR_DEPTH = 1.2;
// Rugs are flat ground decor: pinned just above the floor + PULLED OUT of the
// foot-Y y-sort, so a chair/table placed over a rug always draws on top (and Cato
// walks over it). Reordering entities in the editor can't fix this — the game
// re-sorts every sprite's depth by foot Y each frame; a rug's low foot made it
// cover furniture. Below FLOOR_DEPTH-adjacent floor tiles? No — just above them.
const RUG_DEPTH = 1.5;

// --- Crops (Sprout Lands "Farming Plants") ---
// Each crop grows through N stages (frames `grow-<name>-<stage>` in the
// farming_plants atlas). Corn is TALL (16×32); the rest are 16×16. The seed bag +
// harvested crop item icons live in the farming_plants_items atlas.
// Crop config is DATA-DRIVEN — the table lives in `public/data/crops.json` (loaded
// in BootScene → applyCropData); `CROPS`/`CROP_NAMES` are the live references + a
// built-in fallback. Per-crop grow times (`growWateredMs`/`growDryMs`) replace the
// old global constant, so each crop can mature at its own rate.
// How long a watering stays wet (soil tint + fast growth), independent of stage
// advances, so the damp look persists and re-watering isn't instantly consumed.
const WET_DURATION_MS = 9000;
// Watered soil looks darker/damp — the dirt tileset has no wet variant, so we
// multiply-tint the soil sprite (cleared when it dries at the next stage-up).
const WET_SOIL_TINT = 0xb0946a;
// Grass on tilled-soil BORDERS: each exposed edge of a soil cell (side facing
// un-tilled ground) grows a grass tuft with this probability — scattered, not
// every edge. Deterministic per cell+edge (see `cellHash`) so it's stable across
// saves/reloads and never flickers.
const GRASS_EDGE_CHANCE = 0.55;

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

/** A building-material inventory item. Only WALL carries an orientation (picked via
 *  the 3×3 build palette); floor / window / door / each furniture piece are their
 *  own single-orientation item. Stackable so placing/removing decrements/refunds. */
function makePlaceable(kind: PlaceKind, count: number, variant?: string): ItemStack {
  if (kind === 'wall') {
    return { id: 'wall', label: 'Wooden wall', iconKey: 'house-walls', iconFrame: WALL_FRAME.bottom, count, stackable: true, place: 'wall' };
  }
  if (kind === 'floor') {
    return { id: 'floor', label: 'Brick floor', iconKey: 'house-walls', iconFrame: FLOOR_FRAME, count, stackable: true, place: 'floor' };
  }
  if (kind === 'window') {
    return { id: 'window', label: 'Window', iconKey: 'house-walls', iconFrame: WINDOW_FRAME, count, stackable: true, place: 'window' };
  }
  if (kind === 'door') {
    return { id: 'door-item', label: 'Door', iconKey: 'door', iconFrame: DOOR_CLOSED_FRAME, count, stackable: true, place: 'door' };
  }
  if (kind === 'tree') {
    const t = TREE_BY_ID.get((variant ?? '') as TreeType) ?? TREE_TYPES[0]!;
    return { id: `tree-${t.id}`, label: t.label, iconKey: `tree-${t.id}`, iconFrame: 0, count, stackable: true, place: 'tree', variant: t.id };
  }
  if (kind === 'bush') {
    const b = (BERRY_TYPES.includes(variant as BerryType) ? variant : BERRY_TYPES[0]) as BerryType;
    // Icon = the full berry-bush sprite (so the PLANTING item looks different from
    // the single harvested berry it yields).
    return { id: `bush-${b}`, label: `${FRUIT_LABEL[b]} bush`, iconKey: 'bushes', iconFrame: `bush-with-${b}`, count, stackable: true, place: 'bush', variant: b };
  }
  const piece = FURN_BY_ID.get(variant ?? '') ?? FURNITURE[0]!;
  return { id: `furn-${piece.id}`, label: piece.label, iconKey: 'furniture', iconFrame: piece.frame, count, stackable: true, place: 'furniture', variant: piece.id };
}

/** Rebuild a full ItemStack from its saved `id` + count (the single source of
 *  truth for tools too — setupInventory + save-load both go through it). */
function itemFromId(id: string, count: number): ItemStack {
  if (id === 'hoe') return { id, label: 'Hoe', iconKey: 'tools_and_meterials', iconFrame: 'hoe', count: 1, stackable: false, toolId: 'hoe' };
  if (id === 'watering-can') return { id, label: 'Watering can', iconKey: 'tools_and_meterials', iconFrame: 'watering-can', count: 1, stackable: false, toolId: 'watering-can' };
  if (id === 'axe') return { id, label: 'Axe', iconKey: 'tools_and_meterials', iconFrame: 'axe', count: 1, stackable: false, toolId: 'axe' };
  if (id === 'pickaxe') return { id, label: 'Pickaxe', iconKey: 'pickaxe', count: 1, stackable: false, toolId: 'pickaxe' };
  if (id === 'stone') return makeStone(count);
  if (id === 'wall') return makePlaceable('wall', count);
  if (id === 'floor') return makePlaceable('floor', count);
  if (id === 'window') return makePlaceable('window', count);
  if (id === 'door-item') return makePlaceable('door', count);
  const furn = /^furn-(\w+)$/.exec(id);
  if (furn) return makePlaceable('furniture', count, furn[1]);
  const seed = /^(\w+)-seed$/.exec(id);
  if (seed && (seed[1] in CROPS)) return makeSeed(seed[1] as CropName, count);
  const crop = /^crop-(\w+)$/.exec(id);
  if (crop && (crop[1] in CROPS)) return makeCrop(crop[1] as CropName, count);
  const tree = /^tree-(\w+)$/.exec(id);
  if (tree && TREE_BY_ID.has(tree[1] as TreeType)) return makePlaceable('tree', count, tree[1]);
  const bush = /^bush-(\w+)$/.exec(id);
  if (bush && BERRY_TYPES.includes(bush[1] as BerryType)) return makePlaceable('bush', count, bush[1]);
  const fruit = /^fruit-(\w+)$/.exec(id);
  if (fruit) return makeFruit(fruit[1], count);
  const forage = /^forage-([\w-]+)$/.exec(id);
  if (forage) return makeForage(forage[1] as ForagableName, count);
  return { id, count, stackable: true }; // unknown → generic stack
}

/** A harvested tree fruit (apple / pear / peach) as a backpack item. Icon = the
 *  matching frame of the `fruit-items` sheet (fruit_and_berries_items.png). */
function makeFruit(type: string, count: number): ItemStack {
  return { id: `fruit-${type}`, label: FRUIT_LABEL[type] ?? type, iconKey: 'fruit-items', iconFrame: FRUIT_FRAME[type] ?? 0, count, stackable: true };
}

/** A harvested wild foragable (grass / sunflower / mushroom / …) as a backpack item.
 *  Icon = the MATURE frame of the `forage` atlas (`<type>-<stages>`). small-stone
 *  yields the generic `stone` item instead (banked via makeStone). */
function makeForage(type: ForagableName, count: number): ItemStack {
  if (type === 'small-stone') return makeStone(count);
  const def = FORAGABLES[type];
  return {
    id: `forage-${type}`,
    label: def?.label ?? type,
    iconKey: 'forage',
    iconFrame: `${type}-${def ? def.stages : 1}`,
    count,
    stackable: true,
  };
}

/** A stone resource — from mining a big-stone OR harvesting a mature small-stone.
 *  Icon = the largest small-stone frame. */
function makeStone(count: number): ItemStack {
  return { id: 'stone', label: 'Stone', iconKey: 'forage', iconFrame: 'small-stone-6', count, stackable: true };
}

/** Can this item DO something when selected on the hotbar? True for tools, seed
 *  bags, and placeable materials (the three fields `equipSelected` reads). Harvested
 *  goods (crops / fruit / forage / stone) have none → inert, so they're kept OFF the
 *  hotbar (the bag's "To Hotbar" option is hidden for them). This IS the single source
 *  of truth for usability — no separate data table (it would only drift from these). */
function isHotbarUsable(item: ItemStack): boolean {
  return !!(item.toolId || item.plants || item.place);
}

/** A wild foragable at a cell: `type` + growth `stage` (1-based; frames `<type>-1`..
 *  `<type>-<stages>`, mature = last) + a `timer` counting ms toward the next stage. */
interface ForagObj {
  type: ForagableName;
  stage: number;
  timer: number;
  sprite: Phaser.GameObjects.Image;
  body?: Phaser.GameObjects.Sprite; // solid collider — ONLY small-stones block Cato (rocks); the rest are passable
  swayUntil?: number; // this.time.now until which a rustle sway is playing (debounce)
  sceneWired?: boolean; // placed in the editor (scene data) → NOT saved; re-wired each load
}

/** Foragable types that rustle (a sway tween) when Cato brushes past / harvests them —
 *  the leafy ground plants + flowers. Mushrooms (rigid caps) and small-stones (rocks)
 *  don't. Sunflower is tall (16×32) but pivots about its base (origin 0.5,1) just fine. */
const SWAY_FORAGABLES = new Set<string>(['grass', 'wild-flower', 'sunflower']);

/** A minable big-stone at a cell. `ready` = stones available to knock out right now;
 *  `regen` holds the remaining-ms timers of stones currently regrowing (each pops
 *  back a `ready` when it hits 0). `emptyKnocks` counts knocks while empty (2 → break). */
interface BigStoneObj {
  tier: number;
  ready: number;
  regen: number[];
  emptyKnocks: number;
  sprite: Phaser.GameObjects.Image;
  body?: Phaser.GameObjects.Sprite; // invisible solid collider (Cato can't walk through)
  sceneWired?: boolean; // placed in the editor (scene data) → NOT saved; re-wired each load
}

/** A planted berry bush at a cell. `stage` 0=small / 1=full / 2=ripe (bears 3
 *  berries — `berries` holds the 3 overlay sprites, empty otherwise). `timer` counts
 *  growth ms toward the next stage (0→1→2) and the regrow (1→2 after a harvest). */
interface BushObj {
  type: BerryType;
  stage: number;
  timer: number;
  base: Phaser.GameObjects.Image;
  berries: Phaser.GameObjects.Image[];
  swayUntil?: number; // this.time.now until which a sway is playing (debounce re-triggers)
  sceneWired?: boolean; // placed in the editor (scene data) → NOT saved; re-wired each load
}

/** A placed tree at a cell. Fruit trees carry `hasFruit`; `stage` is the current
 *  chop-combo count (0-3, reset if you don't strike again within the window);
 *  `busy` locks it while the final shake / fall animation resolves. */
interface TreeObj {
  type: TreeType;
  hasFruit: boolean;
  sprite: Phaser.GameObjects.Sprite;
  body?: Phaser.GameObjects.Sprite; // small invisible trunk collider
  stage: number;
  timer?: Phaser.Time.TimerEvent;
  busy: boolean;
  sceneWired?: boolean; // placed in the editor (scene data) → NOT saved; re-wired each load
}

/** A placed building structure at a cell (wall / door / furniture). */
interface PlacedObj {
  kind: PlaceKind;
  variant?: string;       // furniture piece id
  orient: WallOrient;     // wall facing chosen at placement ('auto' = follow neighbours)
  frame: number;          // the sprite frame currently shown
  sprite: Phaser.GameObjects.Sprite;
  bodies?: Phaser.Physics.Arcade.Sprite[]; // invisible solid colliders (walls + closed door); N per authored collisionRect
  open?: boolean;         // door state
  animating?: boolean;    // door swing in flight
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
  placed?: Array<{ key: string; kind: PlaceKind; variant?: string; orient: WallOrient }>; // v2: house
  floors?: Array<{ key: string; frame: number }>; // v2: floor tiles (a ground layer, can overlap walls)
  trees?: Array<{ key: string; type: TreeType; hasFruit: boolean }>; // v3: placed trees
  bushes?: Array<{ key: string; type: BerryType; stage: number }>; // v4: berry bushes
  foragables?: Array<{ key: string; type: ForagableName; stage: number; timer: number }>; // v5: wild foragables
  bigStones?: Array<{ key: string; tier: number; ready: number }>; // v5: minable big stones
  money?: number; // v6: coin balance (HUD)
  dayTimeMs?: number; // v6: position in the in-game day loop (HUD sun-arc pointer)
  dayCount?: number; // v6: whole days elapsed (weather pick)
  mailbox?: Array<{ id: string; count: number }>; // v7: mailbox contents (vestigial)
  chest?: Array<{ id: string; count: number }>; // v7: chest contents
  // v8 (`order`/`orderDeliverDay`) is retired — the order book was replaced by the instant
  // shop; old v8 saves just ignore those keys.
  mail?: MailEntry[]; // v9: the Mail-tab list (sales receipts, …)
  autonomy?: { harvest: boolean; water: boolean }; // v10: Cato's standing auto-farm prefs
  staminaMax?: number; // v11: Cato's energy cap (raisable by future upgrades)
  stamina?: number; // v11: current energy
  chestSeeded?: boolean; // v12: the one-time starter-seed grant into the chest has run
  catoBag?: Array<{ id: string; count: number }>; // v13: Cato's backpack contents
  backpack?: Array<{ id: string; count: number }>; // v15: the player's portable backpack
  dialogueSeen?: string[]; // v14: scripted dialogues already played (once-only, e.g. the intro)
  dialogueFlags?: string[]; // v14: dialogue flags set by choices (branch memory)
}

export class GameScene extends Phaser.Scene {
  private sceneId!: string;

  // Cato (your friend on the island)
  private child?: Phaser.GameObjects.Sprite;
  private emote?: EmoteController; // Cato's reactive speech-bubble emoji
  private wanderTimer = 0;
  private wanderInterval = 2000;
  private wanderState: 'walk' | 'idle' = 'idle';
  private wanderTarget: { x: number; y: number } | null = null; // the POI he's ambling to
  // Curiosity: the player harvested something → Cato ambles OVER to look at it
  // (overrides wander/leash until he arrives or the deadline lapses).
  private catoCurious: { x: number; y: number; deadline: number } | null = null;
  // Cato's STANDING autonomous behaviour — he tends the farm on his own (harvest ripe
  // crops, water dry ones) instead of just wandering. This is NOT a settings toggle:
  // the friend changes it by TALKING to Cato ("don't harvest on your own") → the AI
  // calls `set_behavior` → `setAutonomy`. Default ON (Cato offers to help at the intro,
  // which is future work; until then he helps by default). Saved (v10).
  private autonomy = { harvest: true, water: true };
  // Stamina: drained while working, regained while idle. `staminaMax` is saved + can be
  // RAISED by a future upgrade. `exhausted` = drained to 0 → he rests in place, can't work
  // until he regens to STAMINA_RECOVER_FRAC. Saved (v11).
  private staminaMax = STAMINA_MAX_DEFAULT;
  private stamina = STAMINA_MAX_DEFAULT;
  private exhausted = false;
  private staminaSleepyAt = 0; // throttle the drowsy emote while resting exhausted
  private catoEatAt = 0;       // cooldown between auto-eats from Cato's bag while exhausted
  // Stuck-escape: no progress while walking (wedged between tree trunks) → sidestep out.
  private wanderStuckMs = 0;
  private wanderPrev: { x: number; y: number } | null = null;
  private wanderEscapeUntil = 0;
  private wanderEscapeDir: FaceDir = 'down';
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
  // RUNTIME control mode (toggled by the on-screen TEST button): true = WASD/arrows
  // drive Cato + camera follows; false = arrows/drag pan the camera + Cato wanders.
  private playerControl = PLAYER_CONTROL_DEFAULT;
  private controlToggleBtn?: HTMLButtonElement; // the test-only DOM toggle button
  private timeSkipBtn?: HTMLButtonElement; // the test-only DOM fast-forward-time button
  // Shared cursor state read by CursorScene (which renders it above the HUD).
  private cursorState = { x: GAME_WIDTH / 2, y: GAME_HEIGHT / 2, visible: false };
  // Empty-hand inspect overlay (HoverScene) — a white ring hugging the hovered object + its name.
  private hoverModel: HoverModel = { visible: false, onObject: false, x: 0, y: 0, w: 0, h: 0, z: 1, name: '', nameX: 0, nameY: 0 };

  // ── Farming (hoe → till grass) ──────────────────────────────────────────
  // Minecraft-style: pick the hoe (key 2; 1 = empty hand), a bracket cursor
  // snaps to the grass tile under the mouse, click tills it. `islandLayer` is
  // the grass-island TilemapLayer (for world↔tile snapping + "is this grass?").
  private activeTool: ToolId = 'hand';
  // When a seed bag is the selected hotbar item, planting mode is on: the tile
  // cursor snaps to empty tilled soil and a click plants this crop there.
  private activeSeed?: CropName;
  private islandLayer?: Phaser.Tilemaps.TilemapLayer;
  private tileCursor?: Phaser.GameObjects.NineSlice | Phaser.GameObjects.Image; // bracket that frames the target cell
  private hoeIcon?: Phaser.GameObjects.Image; // the held-tool icon shown inside the bracket
  private waterCan?: Phaser.GameObjects.Sprite; // the god-hand watering-can pour (one at a time)
  private hoeSwing?: Phaser.GameObjects.GameObject; // the god-hand tool swing (hoe / axe) — suppresses the tile cursor
  private tilledCells = new Set<string>(); // "cx,cy" already tilled (idempotent)
  private tilledSoil = new Map<string, Phaser.GameObjects.Image>(); // cell → soil sprite (autotile frame)
  private tilledGrass = new Map<string, Phaser.GameObjects.Image[]>(); // cell → grass-tuft edge overlays
  private loosenedCells = new Map<string, { overlay: Phaser.GameObjects.Image; timer: Phaser.Time.TimerEvent }>(); // cell → transient "hoed once" state
  private hoverCell: { cx: number; cy: number } | null = null; // actionable cell under cursor (till or plant)

  // ── House building ──────────────────────────────────────────────────────
  private activePlace?: PlaceKind; // a building material is selected → placement mode
  private activeFurn = FURNITURE[0]!.id; // current furniture piece (R cycles through FURNITURE)
  private activeTreeType: TreeType = 'apple'; // current tree kind to plant (from the held item)
  private trees = new Map<string, TreeObj>(); // "cx,cy" → a placed tree (chop with the axe)
  private activeBushType: BerryType = 'strawberry'; // current berry bush to plant
  private bushes = new Map<string, BushObj>(); // "cx,cy" → a planted berry bush
  // Wild foragables (auto-spawn on the grass, grow, harvest at max) + minable
  // big-stones (knock with the pickaxe). Both spawn passively via the spawn ticker.
  private foragables = new Map<string, ForagObj>(); // "cx,cy" → a wild foragable
  private bigStones = new Map<string, BigStoneObj>(); // "cx,cy" → a minable big stone
  private spawnTimer = 0; // ms accumulated toward the next spawn attempt
  private wallOrient: WallOrient = 'bottom'; // current wall facing (R cycles through all 9)
  private placed = new Map<string, PlacedObj>(); // "cx,cy" → placed wall/door/furniture
  private floors = new Map<string, { sprite: Phaser.GameObjects.Sprite; frame: number }>(); // "cx,cy" → floor tile (ground layer; can overlap a wall so it tucks under it)
  private wallGroup?: Phaser.Physics.Arcade.StaticGroup; // invisible solid colliders (walls + closed doors)
  // Editor-authored house: the `wooden_house` tilemap layer (walls painted by the
  // creator — solid via the tileset) + a set of cells occupied by SOLID furniture
  // sprites. Both feed pathfinding (isWalkableCell) so Cato routes around the house
  // interior, and the furniture also gets real colliders in wallGroup.
  private wallLayer?: Phaser.Tilemaps.TilemapLayer;
  private houseBlocked = new Set<string>(); // "cx,cy" of solid furniture (pathfinding)
  // The editor-placed door sprite (door_animation_sprites). Swings open as Cato
  // nears + closes when he leaves — cosmetic only (the doorway is a walkable floor
  // tile, and Cato is the only physics body, so no collider to toggle).
  private houseDoor?: Phaser.GameObjects.Sprite;
  private houseDoorOpen = false;
  private houseDoorAnimating = false;
  // The editor-placed mailbox / chest sprites (door objects). Clicking one plays its
  // open animation, THEN opens the unified menu (openMenuViaObject); closing plays close.
  private mailbox?: Phaser.GameObjects.Sprite;
  private mailboxHasMail = false; // drives which mailbox open anim plays (mail vs empty)
  private chest?: Phaser.GameObjects.Sprite;
  // The editor-placed desk PAD (iPad). Clicking it plays `pad-open` then opens the Shop
  // tab — it replaces the old bottom-right shop button. Resting on the animation sheet's
  // frame 0 (identical to the static ipad_qkzld the creator dropped in the scene).
  private pad?: Phaser.GameObjects.Sprite;
  // The editor-placed work station (right side of the house). Clicking it opens the
  // crafting modal (CraftScene). Recipes come from the data table (src/data/recipes).
  private craftStation?: Phaser.GameObjects.Sprite;
  private craftOpen = false;
  private craftSel = 0;   // selected recipe index
  private craftMsg = '';  // transient warning / "Crafted!" flash
  private craftRev = 0;
  // Persistent CONTENTS of the chest (real ItemStacks) — the unified menu Chest tab; the
  // player's only storage. `mailboxStore` is vestigial (kept for save compat / DEBUG clear).
  private mailboxStore: ItemStack[] = [];
  private chestStore: ItemStack[] = [];
  private chestSeeded = false; // one-time starter-seed grant into the chest (saved v12)
  // Cato's own small backpack (v13) — the player gives Cato items here (future: food he
  // eats to recover stamina). Its own menu tab; items flow chest ↔ cato-bag.
  private catoBagStore: ItemStack[] = [];
  // The player's BACKPACK (what they carry): the portable store you Use items from + harvest
  // into. Separate from the chest (fixed storage) — opening the backpack can't reach the chest.
  // A dynamic store like chestStore, rendered in a NO-TAB MenuScene view via the sprout button.
  private backpackStore: ItemStack[] = [];
  // The UNIFIED menu (Zelda-style tabs: 0 mail · 1 for-sale · 2 chest · 3 settings) —
  // one screen replacing the mailbox/chest/bag modals (MenuScene). Door mailbox opens
  // it on Mail; door chest on Chest. `menuSelected` = the grid item shown in the right
  // detail. WIP: phase 1 (layout + tabs + item detail); actions/mail-receipt next.
  private menuOpen = false;
  private menuTab = 2;
  private menuSelected = -1;
  private menuRev = 0;
  private menuActionRev = 0;
  private menuDragging = false; // dragging the unified menu's scroll rail
  private menuSliderDrag: 'bgm' | 'sfx' | null = null; // dragging a Settings-tab volume slider
  private menuShopSel?: string; // selected catalog id on the Shop tab (→ right detail + stepper)
  // When the menu was opened by clicking a physical door object (mailbox / chest), the
  // object plays its OPEN anim first; closing the menu plays its CLOSE anim.
  private menuSourceSprite?: Phaser.GameObjects.Sprite;
  private menuCloseAnim?: string;
  private menuCloseFlashRev = 0; // bumps to tell MenuScene to flash the X pressed
  private menuClosing = false;   // X pressed → flashing → about to close (blocks double-trigger)
  private menuBuyQty = 1;       // how many to buy (Shop right-side stepper; instant purchase)
  private shopMsg = '';         // transient Shop warning ("金币不够" / "箱子满了")
  // The unified menu's item ACTION menu + quantity keypad (its own state, mirrors the
  // mailbox/chest itemMenu but rendered by MenuScene via the `menuAction` registry key).
  private menuItemMenu: { index: number; x: number; y: number } | null = null;
  private menuItemQty: { action: 'sell' | 'give' | 'tochest' | 'store' | 'take'; index: number; x: number; y: number; value: number; max: number; entering: boolean } | null = null;
  private menuSlotPick: { index: number; x: number; y: number } | null = null; // chest → "进 Hotbar" slot picker
  // The MAIL list (Mail tab of the unified menu). Future: AI-notification / narrative
  // inbox; a receipt opens the ReceiptScene. Saved (v9).
  private mailList: MailEntry[] = [];
  private mailIdSeq = 0;
  private openMailId: string | null = null; // which receipt is open (over the menu)
  private receiptRev = 0;
  private placePreview?: Phaser.GameObjects.Sprite; // semi-transparent placement ghost
  private placeCell: { cx: number; cy: number } | null = null; // the valid cell the ghost is over

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
  private hotbarSelected = -1; // selected cell in row 0 (-1 = empty hand OR an external held item)
  // The "held" item can also come from OUTSIDE the hotbar — a tool/seed selected straight from
  // the chest / Cato-bag ("使用"), or a tool grabbed from the contextual object palette. When set,
  // it (not the hotbar slot) is the active item; the hotbar shows nothing selected. `store` is a
  // live ref to the source array so consuming a seed can splice it when the stack empties.
  private heldExternal: { store: ItemStack[]; item: ItemStack; label: string } | null = null;
  // Contextual tool WHEEL: empty-hand tap on a tool-usable spot → the 4 tools laid out at fixed
  // cardinal positions AROUND the object (hugging its pixel bbox edges) + a mouse (close) circle
  // at the centre. A position shows its tool icon only where that tool APPLIES here + is owned;
  // otherwise an empty circle. `bbox` = the object's tight world bbox (opaque-pixel, like the
  // hover bracket). `applicable` = the owned tools that act on this spot.
  private toolPaletteOpen: { bbox: { wl: number; wt: number; wr: number; wb: number }; applicable: Set<ToolId> } | null = null;
  private toolPaletteHover = -2; // wheel circle under the cursor: -2 none, -1 close, ≥0 WHEEL_TOOLS idx
  private wheelOpenAt = 0;        // time the wheel opened (drives the spring-out appear anim)
  private wheelClose: { at: number; chosen: number } | null = null; // closing anim: chosen ≥0 tool / -1 cancel / -2 miss
  private toolHudExpanded = false; // the tool-HUD fly-out row (tap the HUD slot to open/close)
  private hotbarHover = -1; // hotbar cell the mouse cursor is over (-1 = none; backpack = INV_COLS)
  private inventoryOpen = false;
  private heldStack: ItemStack | null = null; // picked-up stack following the cursor
  private invRev = 0;
  private invDragFrom: number | null = null; // touch: cell a backpack drag started on

  // ── Weather / time-of-day / money HUD (WeatherScene renders; GameScene owns
  //    the MODEL, published to registry `weatherHud`) ───────────────────────
  private money = 0; // coin balance (display-only for now — no economy yet)
  private dayTimeMs = 0; // position within the current in-game day loop [0, DAY_LEN_MS)
  private dayCount = 0; // whole days elapsed (drives the per-day weather pick)
  private weatherHudRev = 0; // bumped on any HUD-visible change → WeatherScene re-renders
  private lastPointerStep = -1; // last published pointer frame (1..5); republish only on change
  private lastBgIndex = -1; // last published time-of-day background (0..2)
  private nightMask?: Phaser.GameObjects.Rectangle; // full-screen day/night colour tint

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
  // True when loadGame found NO existing save → this is a brand-new game: run the
  // opening flow (Cato at the house door, camera framing the house, intro dialogue).
  // Once the game auto-saves, the next entry loads progress + skips the flow.
  private isNewGame = false;
  // Hide the world + hotbar until the save is restored, so there's no flash of
  // the empty/default farm before the saved crops+soil pop in.
  private gameReady = false;
  private loadingOverlay?: LoadingOverlay;

  // Click-to-talk dialog: the chat-message / chat-input / chat-text HUD widgets
  // (authored visible:false) slide up on cat-click; an HTML <input> overlays the
  // chat-input box for typing; replies come from Cato (umicat.ai + playbook).
  private dialogOpen = false;
  private cato?: Npc;
  private aiBusy = false;
  // Cato's proactive small-talk chip (top-right, left of the portrait) — see ChatterScene.
  private chatterRev = 0;
  private chatterText: string | null = null;   // the live remark (seeds the dialog if tapped)
  private lastChatter: string | null = null;    // last remark, sent to the AI as context
  private chatterTimer?: Phaser.Time.TimerEvent; // auto-hide countdown
  // An autonomous WORK SESSION (a run of chained chores) — Cato announces the START
  // once when it begins + the DONE once when there's no work left, NOT per task (else
  // "all done!" is instantly clobbered by the next task's "going to pick the X!").
  private choreSession: 'harvest' | 'water' | null = null;
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

  // ── RPG typewriter + pagination (Cato's reply reveals char-by-char; text that
  //    overflows the box is split into pages, a "more" icon prompts to advance) ──
  private dialogPages: string[] = []; // the reply split into box-fitting pages
  private dialogPageIdx = 0; // which page is showing
  private dialogCharIdx = 0; // chars revealed of the current page
  private dialogTyping = false; // mid-typewriter on the current page
  private dialogTypeTimer?: Phaser.Time.TimerEvent; // per-char reveal tick
  private dialogMeasureEl?: HTMLDivElement; // hidden design-sized wrap-measurer
  private moreIconTween?: Phaser.Tweens.Tween; // the "more" icon bob

  // ── Cato behaviours (runtime-AI `do` actions) ───────────────────────────
  // When the friend asks Cato (in chat) to prepare a plot, the AI returns a
  // `till_plot` action; we find an open grass patch near Cato, queue its cells,
  // and Cato walks over + hoes each one (reusing the farming tillCell mechanic).
  // A single active task at a time; it overrides the autonomous wander.
  private catoTask: {
    // Single-strike (one hit per cell → advance): till/plant/water/harvest/bush/forage.
    // Multi-strike (keep hitting the SAME target until it's gone): chop/fruit/mine.
    type: 'till' | 'plant' | 'water' | 'harvest' | 'chop' | 'fruit' | 'mine' | 'bush' | 'forage';
    queue: Array<{ cx: number; cy: number }>;
    crop: string; // flavour label ('corn', 'crops', 'trees', 'stones', …)
    plantName?: CropName; // for a plant task: what to sow
    cooldown: number;
    // Multi-strike safety: hits landed on the CURRENT target (reset when it drops).
    // chop/mine targets self-invalidate (felled / broken) via taskCellValid; this just
    // backstops a target that somehow never clears so Cato can't flail forever.
    strikes: number;
    // Stall detector backstop: if Cato makes no progress toward the next path waypoint
    // for a while (a wall placed mid-walk, a physics wedge), drop the stale path and
    // re-plan; if that keeps failing the target is abandoned.
    walkMs: number;
    walkDist: number;
    // Where Cato stands to work the CURRENT target (an adjacent cell) + which way he
    // faces to swing/tend it. Computed once per target; null = recompute.
    stand: { x: number; y: number; dir: FaceDir } | null;
    // A* route to `stand` as world-centre waypoints (last = the stand cell). Cato walks
    // them one tile at a time (cardinal). null = (re)plan on the next tick.
    path: Array<{ x: number; y: number }> | null;
  } | null = null;
  private catoReturning = false; // walking back toward the camera centre (leash)
  // Escape-to-door: when Cato's task target is unreachable by A* AND he's stuck INSIDE
  // the house (a furniture-sealed pocket A* can't route out of — he can physically
  // squeeze into a diagonal gap his 4-connected pathfinder treats as walled), walk him
  // cardinally toward the doorway until he's outside; then A* re-plans and succeeds.
  private catoEscapeMs = 0;

  constructor() {
    super({ key: 'GameScene' });
  }

  init(data: { sceneId: string }): void {
    this.sceneId = data.sceneId;
  }

  /** Deferred game-only load: the 4.1MB in-game BGM (NOT loaded at boot so the title
   *  appears fast — see BootScene). Phaser runs preload() → create(), so it's in the
   *  cache before create()'s crossToBgm. Loads behind the scene-transition cover; guarded
   *  so a scene-instance reuse (title→game→title→game) doesn't re-queue it. */
  preload(): void {
    if (!this.cache.audio.exists('bgm')) {
      this.load.audio('bgm', 'uploaded/catopia-background-music-1.mp3');
    }
  }

  async create(): Promise<void> {
    // In-game BGM (its own track): stop the title track and swell the game one in
    // (fade paired with the scene-transition wipe — see TransitionScene / src/bgm.ts).
    crossToBgm(this, 'bgm', ['bgm-title'], 700);
    // Set zoom BEFORE awaiting scene load so the first frame is already correct.
    this.cameras.main.setZoom(this.computeZoom());
    // Kept ON for crisp pixel-art. The trade: the world scroll snaps to whole pixels,
    // leaving a hair-thin ±1px scroll rhythm (the last residual "shake"). Turning it
    // OFF makes the scroll sub-pixel-smooth but at fractional camera positions nearest
    // sampling then makes texels "crawl" (grow/shrink 1px) on textured tiles during
    // motion — a worse trade than the crisp look. (A true fix would be an integer-zoom
    // render-to-texture camera — deferred; the residual is barely visible.)
    this.cameras.main.roundPixels = true;
    // Follow Cato in POST_UPDATE — i.e. AFTER Arcade physics has synced his new
    // position for the frame (doing it in update(), before the sync, left the camera
    // a physics-step behind → extra jitter). See updateCameraFollow for the lerp.
    this.events.on(Phaser.Scenes.Events.POST_UPDATE, this.updateCameraFollow, this);
    // Advance physics by the REAL frame time each frame (not Phaser's default fixed
    // 1/60 accumulator). The accumulator does 0/1/2 steps per render frame → Cato's
    // per-frame movement is uneven → a visible micro-stutter while walking that no
    // camera smoothing can hide. Variable step moves him exactly the right distance
    // for each frame's elapsed time → smooth. (He's slow — no tunnelling risk.)
    if (this.physics?.world) this.physics.world.fixedStep = false;
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
      // Cato's emote bubble follows his position (world-space, above his head).
      this.emote = new EmoteController(this, () => (this.child ? { x: this.child.x, y: this.child.y } : undefined));

      // Physics body
      this.physics.add.existing(this.child);
      const body = this.child.body as Phaser.Physics.Arcade.Body;
      body.setCollideWorldBounds(false);

      // Vision-authored foot-area hitbox
      const manifest = getManifest(this);
      const assetId = this.child.getData('assetId') as string;
      const asset = manifest?.assets.find((a: { id: string }) => a.id === assetId);
      if (asset?.hitbox) applyAssetHitbox(this.child, asset);
      // FOOT collision box — the default body is the full 48×48 frame, which spans
      // ~3 tiles and wedges Cato against opposite walls inside a small room (arcade
      // physics can't separate a body touching solids on both sides → he tunnels
      // through). A SMALL box at his feet collides cleanly with the walls AND fits
      // comfortably through the 1-tile (16px) door — 10px wide leaves ~3px slack each
      // side so entering is easy. (applyAssetHitbox above no-ops here — the asset-id
      // lookup misses on Cato — so we set it directly.)
      body.setSize(10, 7, false);
      body.setOffset(19, 25);

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
      // Placed walls (+ closed doors) block Cato: invisible static bodies in one
      // group, a single collider with Cato. Bodies are added/removed as the player
      // builds (see addSolid / placeObject / removeObject).
      this.wallGroup = this.physics.add.staticGroup();
      this.physics.add.collider(this.child, this.wallGroup);
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
        if (this.menuOpen || this.dialogOpen || this.inventoryOpen || this.craftOpen) return; // don't pan behind a modal
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

      // ── Runtime AI: Cato, your friend on the island ──
      // umicat.ai + the `cato` playbook (public/playbooks/cato.md). Fire-and-
      // forget — the npc is ready well before the player opens the dialog +
      // types. Inline role/style is a fallback if the playbook can't be loaded.
      void Umicat.init({})
        .then(async (u) => {
          this.umicat = u;
          initLang(u?.locale); // default game UI text to the player's language
          // The host gives us the signed-in player's display name — let Cato call
          // them by it (instead of the generic "friend"). Absent when anonymous /
          // standalone → fall back to the friend wording from the playbook.
          const playerName = u?.user?.name?.trim();
          this.cato = u?.ai.npc({
            playbook: 'cato',
            role:
              'Cato — a small, curious cat who lives on an island in Catopia. The player is your FRIEND and your equal: you live on the island together, farming, exploring, and building it up side by side. They are NOT your owner, trainer, keeper, or parent, and you are not their pet or servant.' +
              (playerName ? ` Your friend's name is ${playerName}.` : ''),
            style: "warm, whimsical, 1-3 short sentences; reply in the player's language",
            rules: [
              ...(playerName ? [`Address the player by their name, "${playerName}", when it feels natural — they are your friend.`] : []),
              'You have LIMITED ENERGY (see observation.cato.energyPct). If observation.cato.exhausted is true you are TOO TIRED to do any chore — warmly tell your friend you need to rest and get your energy back first, and do NOT call any task action (till/plant/water/harvest/chop/mine/forage). When your energy is low but not empty you can still work, though you may mention you\'re getting a bit tired.',
            ],
            // The vocabulary of things Cato can DO in the world. The AI picks one
            // when the friend's request fits; GameScene validates + executes it.
            actions: [
              {
                name: 'till_plot',
                description:
                  'Walk to a nearby open patch of grass and hoe it into tilled soil so the friend can plant crops. Use whenever the friend asks you to clear / prepare / till ground, or make a plot / field / garden / patch for planting something (e.g. corn).',
                args: {
                  crop: 'string', // what the friend wants to plant (flavour, e.g. "corn")
                  size: 'integer', // side of the square plot in tiles (2-4); default 3
                },
              },
              {
                name: 'plant_crop',
                description:
                  'Walk to nearby tilled soil and sow seeds there. Use when the friend asks you to plant / sow / seed a specific crop (corn, carrot, tomato, eggplant, or pumpkin). Requires tilled soil to already exist — if there is none, till first (or say so). Fills the open soil with the crop.',
                args: {
                  crop: 'string', // one of: corn, carrot, tomato, eggplant, pumpkin
                  count: 'integer', // how many to plant; 0 / omitted = fill all open soil
                },
              },
              {
                name: 'water_crops',
                description:
                  'Walk to the planted crops and water them with the watering can so they grow fast (un-watered crops grow very slowly). Use when the friend asks you to water / hydrate the crops or plants. Waters crops that still need it.',
                args: {
                  count: 'integer', // how many to water; 0 / omitted = water all that need it
                },
              },
              {
                name: 'harvest_crops',
                description:
                  'Walk to the crops that are fully grown (ripe) and harvest them — the produce goes into the friend\'s backpack. Use when the friend asks you to harvest / pick / collect / gather the ripe crops. Only fully-grown crops are harvested.',
                args: {
                  count: 'integer', // how many to harvest; 0 / omitted = all ripe crops
                },
              },
              {
                name: 'chop_trees',
                description:
                  'Walk to the nearby trees and chop them down for wood. Use when the friend asks you to chop / cut down / fell / clear the trees (or get wood / lumber / logs). A fruit tree drops its fruit on the way down, then falls as a plain tree. Use harvest_fruit instead if they only want the fruit and the trees left standing.',
                args: {
                  count: 'integer', // how many trees to fell; 0 / omitted = all nearby trees
                },
              },
              {
                name: 'harvest_fruit',
                description:
                  'Walk to the trees that are bearing fruit and shake the fruit loose into the backpack, leaving the trees standing. Use when the friend asks you to harvest / pick / gather the fruit from the trees. Only trees that currently have fruit are picked. If they name a SPECIFIC fruit, pass it as `fruit` so you pick only that kind (else you pick every fruit).',
                args: {
                  fruit: 'string', // apple, pear, or peach; omit to pick ALL fruit trees
                  count: 'integer', // how many fruit trees to pick; 0 / omitted = all with fruit
                },
              },
              {
                name: 'mine_stones',
                description:
                  'Walk to the big rocks / boulders and mine them for stone — each knock chips off a stone, and once mined out the rock breaks apart for a bonus. Use when the friend asks you to mine / dig / break / knock the rocks or big stones, or get stone / ore.',
                args: {
                  count: 'integer', // how many big stones to mine; 0 / omitted = all nearby
                },
              },
              {
                name: 'harvest_bushes',
                description:
                  'Walk to the berry bushes that are ripe and pick their berries into the backpack (the bush regrows afterwards). Use when the friend asks you to pick / harvest / collect the berries or bushes. Only ripe bushes are picked. If they name a SPECIFIC berry, pass it as `berry` so you pick only that kind — otherwise you pick EVERY ripe bush (e.g. "pick the strawberries" must set berry:"strawberry", or you\'d grab the blueberries too).',
                args: {
                  berry: 'string', // strawberry, grape, or blueberry; omit to pick ALL ripe bushes
                  count: 'integer', // how many bushes to pick; 0 / omitted = all ripe bushes
                },
              },
              {
                name: 'forage',
                description:
                  'Walk around and gather the wild growth scattered on the grass once it is fully grown — mushrooms, wild flowers, tall grass, small stones, etc. Use when the friend asks you to forage / gather / collect / pick up / clear the wild things. If they name a SPECIFIC kind, pass it as `kind` so you gather ONLY that — otherwise you gather EVERYTHING (e.g. "clear the weeds" must set kind:"grass", or you\'d also take the mushrooms and flowers). Use "grass" for weeds/grass, "mushroom" for either mushroom, "flower" for the flowers, "stone" for loose small stones.',
                args: {
                  kind: 'string', // grass, mushroom, flower, or stone (or a specific name); omit to gather ALL
                  count: 'integer', // how many to gather; 0 / omitted = all mature of that kind
                },
              },
              {
                name: 'set_behavior',
                description:
                  'Change your STANDING autonomous behaviour — whether you tend the farm ON YOUR OWN (without being asked each time). Use when the friend tells you to (or NOT to) do chores automatically. Examples: "don\'t harvest on your own" → harvest:false; "you can water the crops yourself again" → water:true; "stop doing things on your own" / "just relax and keep me company" → harvest:false, water:false; "help me farm automatically" / "take care of the crops for me" → harvest:true, water:true. Only include the field(s) the friend actually changed; omit the rest. This sets a lasting preference — it is NOT a one-time chore (still use harvest_crops / water_crops for a one-off "go harvest now").',
                args: {
                  harvest: 'boolean', // auto-GATHER on your own: ripe crops, tree fruit, AND berry bushes (omit = leave as-is)
                  water: 'boolean', // whether to auto-water dry crops on your own (omit = leave as-is)
                },
              },
              // NB: emotes are NOT a tool — Haiku returned the tool call WITHOUT any
              // spoken text (empty replies). Cato instead prefixes his reply with a
              // [mood] marker (see the playbook), parsed in submitDialog.
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
        this.input.keyboard?.on('keydown-C', () => { if (canAct()) this.startChopTask({}); });    // C = chop down trees
        this.input.keyboard?.on('keydown-F', () => { if (canAct()) this.startFruitTask({}); });   // F = harvest tree fruit
        this.input.keyboard?.on('keydown-N', () => { if (canAct()) this.startMineTask({}); });    // N = mine big stones
        this.input.keyboard?.on('keydown-J', () => { if (canAct()) this.startBushTask({}); });    // J = pick berry bushes
        this.input.keyboard?.on('keydown-K', () => { if (canAct()) this.startForageTask({}); });  // K = gather foragables
        this.input.keyboard?.on('keydown-X', () => this.debugReplayIntro());                       // X = replay the intro dialogue
        // M = open the dialog with a long multi-page reply to exercise the RPG
        // typewriter + pagination + "more" icon without the AI.
        this.input.keyboard?.on('keydown-M', () => {
          if (!this.dialogOpen) this.openDialog();
          this.time.delayedCall(60, () => this.showDialogText(
            "Oh! You're back — I missed you! I was just sitting by the water, " +
            "watching the light dance on the waves, and I got to wondering about all the " +
            "little islands out past the mist. Do you think there are other little ones like me " +
            "over there? Maybe one day we could build a tiny boat and sail out together to " +
            "meet them. I'd bring snacks. And I'd hold your hand the whole way, I promise!"));
        });
        // B = build a test house (wall ring + door + furniture) around the camera
        // centre, without the inventory/cursor — for visual + collision testing.
        this.input.keyboard?.on('keydown-B', () => this.debugBuildHouse());
        // G = force-spawn a ring of foragables + a big-stone of each tier near the
        // camera centre (for testing the forage/mining systems without waiting).
        this.input.keyboard?.on('keydown-G', () => this.debugSpawnForage());
        // Y = give coins, U = fast-forward the day clock by one pointer step — to
        // exercise the weather/time/money HUD without waiting / an economy.
        this.input.keyboard?.on('keydown-Y', () => this.addMoney(12345));
        this.input.keyboard?.on('keydown-U', () => this.fastForwardTime());
        // L = stuff the CHEST with a pile of varied test items + open the menu on the
        // Chest tab, so the SCROLL bar has enough to scroll (real saves rarely have 35+
        // items). Debug only — Take/Delete them, or Restart workspace, to clear.
        this.input.keyboard?.on('keydown-L', () => this.debugFillChest());
        // Shift+Delete (or Shift+Backspace — the Mac "delete" key is Backspace) =
        // WIPE this game's save + reload to a fresh EMPTY map. Shift-guarded so it's
        // deliberate; preventDefault stops any browser back-nav on Shift+Backspace.
        const wipeOnShift = (e: KeyboardEvent) => {
          console.warn('[catopia] wipe key:', e.key, 'shift=', e.shiftKey);
          if (e.shiftKey) { e.preventDefault?.(); this.debugWipeSave(); }
        };
        this.input.keyboard?.on('keydown-DELETE', wipeOnShift);
        this.input.keyboard?.on('keydown-BACKSPACE', wipeOnShift);
        // V = teleport Cato right at the built door (to verify it opens on proximity).
        this.input.keyboard?.on('keydown-V', () => {
          const door = [...this.placed.values()].find((o) => o.kind === 'door');
          if (door && this.child) this.child.setPosition(door.sprite.x, door.sprite.y);
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
    // During the cinematic intro the camera is a fixed Cato framing — keep it there
    // (a normal re-fit would zoom back out to gameplay mid-cutscene).
    if (this.cinematic) { this.snapCameraToCato(); this.layoutFindCatButton(); return; }
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

  /** Keep Cato centred while following. Runs in POST_UPDATE (child.x is the frame's
   *  final, physics-synced position — see the note in create()). A gentle lerp is
   *  DELIBERATE: it low-passes the uneven per-frame motion from Arcade's fixed-step
   *  accumulator + frame-timing jitter, so the WORLD scrolls smoothly. (Exact follow
   *  pixel-locks Cato but scrolls the world at that raw jittery rate → the background
   *  stutters, worst in the scroll direction — felt WORSE than a tiny character
   *  wobble.) POST_UPDATE timing keeps the lerp's lag small. Smooth RE-CENTRING
   *  (portrait double-tap) is the one-shot snapToChild() tween — skip the follow while
   *  it runs so it isn't fought. Bounds clamp this on preRender. */
  private updateCameraFollow(): void {
    if (this.cinematic) { this.stepCinematicCamera(); return; } // cutscene owns the camera
    if (!this.cameraFollow || !this.child) return;
    if (this.tweens.getTweensOf(this.cameras.main).length) return;
    const cam = this.cameras.main;
    cam.scrollX = this.child.x - this.scale.width / 2;
    cam.scrollY = this.child.y - this.scale.height / 2;
  }

  /** Per-frame glide of the cinematic camera toward `cineCamTarget` (an exponential lerp,
   *  like the follow — driven directly each frame, so it survives headless + can't be
   *  fought by tween/effect quirks). On the exit glide, reveal the game once it arrives. */
  private stepCinematicCamera(): void {
    const t = this.cineCamTarget; if (!t) return;
    const cam = this.cameras.main;
    const tsx = t.x - this.scale.width / 2, tsy = t.y - this.scale.height / 2;
    const k = 0.14; // smoothing per frame
    cam.scrollX += (tsx - cam.scrollX) * k;
    cam.scrollY += (tsy - cam.scrollY) * k;
    cam.setZoom(cam.zoom + (t.zoom - cam.zoom) * k);
    if (this.cineExiting && Math.abs(cam.zoom - t.zoom) < 0.02 && Math.abs(cam.scrollX - tsx) < 1.5 && Math.abs(cam.scrollY - tsy) < 1.5) {
      cam.setZoom(t.zoom); cam.setScroll(tsx, tsy); // settle exactly
      this.cineExiting = false;
      this.finishCinematic();
    }
  }

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

  /** Clicking Cato's top-right portrait: aim the camera at him (follow) AND open
   *  the chat dialog — one gesture to "go find Cato and talk". The camera-follow
   *  lerp (update) slides onto the now-frozen Cato; openDialog is guarded so a
   *  re-click while already chatting is a no-op. */
  private focusCato(): void {
    this.closeOpenModal(); // close the unified menu first → chat replaces it
    this.followCato();
    this.openDialog();
  }

  /** Close the unified menu / crafting modal if open (chat replaces it). */
  private closeOpenModal(): void {
    if (this.menuOpen) this.closeMenu();
    if (this.craftOpen) this.closeCraft();
  }

  // ── "Find cat" button — warm cozy pill, fixed to top-right ───────────

  private buildFindCatButton(): void {
    // Cato's portrait in the top-right photo-frame (a HUD widget) IS the
    // "find cat" button \u2014 clicking it recenters the camera on Cato. The
    // transparent hit-rect handles NON-locked clicks (under pointer lock,
    // handleLockedClick reads findCatBounds instead). Created once; position +
    // findCatBounds are set by layoutFindCatButton (also re-run on resize).
    // Interactive only for the `overUi` hover flag + hand cursor. The CLICK is NOT
    // handled here: the portrait is a HUD icon-button in the SEPARATE `UmicatHud`
    // scene (rendered ABOVE GameScene), which swallows the pointer before any
    // GameScene object — incl. this rect — can see it. So the click is wired via the
    // HUD scene's `hud:press` event (below) for the unlocked mouse / touch case, and
    // via actAt's findCatBounds check for the pointer-LOCKED-mouse case.
    this.findCatHit = this.add.rectangle(0, 0, 64, 64, 0x000000, 0)
      .setDepth(1002).setScrollFactor(0)
      .setInteractive({ useHandCursor: true })
      .on('pointerover',  () => { this.overUi = true; })
      .on('pointerout',   () => { this.overUi = false; });

    // Clicking Cato's top-right portrait (the HUD `photo-frame` icon-button) → aim
    // the camera at him + open the chat. The icon-button emits `hud:press` on the
    // HUD scene's OWN event bus on pointer-up (mouse + touch) when not pointer-locked.
    const hud = this.game.scene.getScene('UmicatHud');
    if (hud) {
      const onHudPress = (_id: string, entity?: { name?: string }): void => {
        if (entity?.name === 'photo-frame') this.focusCato();
      };
      hud.events.on('hud:press', onHudPress);
      this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => hud.events.off('hud:press', onHudPress));
    }
    // Pre-seed the dialog-text binding so the FIRST greeting renders. Phaser's
    // DataManager emits `setdata` (not `changedata`) on a key's first set, and the
    // SDK text-area only listens for `changedata-catoDialogText` — so without this
    // the very first line (the open greeting) would silently stay on the "…"
    // fallback until a second set. The HUD text-area already did its initial render
    // (still hidden), so seeding "" here just makes the key exist.
    this.registry.set('catoDialogText', '');
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

  /** Set the canvas CSS cursor to the game's pixel triangle at the SAME 2× size CursorScene draws
   *  it (a CSS `url()` cursor uses the PNG's native 16px → too small; upscale nearest to 32px via a
   *  data URL so the unlocked cursor matches the in-game one). Hotspot at 0,0. */
  private setGameCursorCss(): void {
    const canvas = this.game.canvas;
    try {
      const src = this.textures.get('cursor')?.getSourceImage() as CanvasImageSource | undefined;
      if (!src) throw 0;
      const S = 2, w = 16 * S, h = 16 * S;
      const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
      const ctx = cv.getContext('2d'); if (!ctx) throw 0;
      ctx.imageSmoothingEnabled = false; // nearest → crisp pixels
      ctx.drawImage(src, 0, 0, 16, 16, 0, 0, w, h);
      canvas.style.cursor = `url(${cv.toDataURL()}) 0 0, default`;
    } catch { canvas.style.cursor = "url('uploaded/triangle_mouse_icon_1.png') 0 0, default"; }
  }

  private setupPointerLock(): void {
    // Publish cursor state for CursorScene (renders it above the HUD), then
    // launch that overlay on top — AFTER loadWorldScene, so it sits above the
    // HUD scene the SDK created during the world load.
    this.registry.set('cursor', this.cursorState);
    this.registry.set('hover', this.hoverModel);
    // Overlays, back-to-front. NB: the HOTBAR is gone — tools/seeds/materials live in the backpack
    // (opened by the bottom-right sprout button + used via the wheel / backpack "Use").
    if (!this.scene.isActive('BackpackButtonScene')) this.scene.launch('BackpackButtonScene');
    if (!this.scene.isActive('WeatherScene')) this.scene.launch('WeatherScene');
    if (!this.scene.isActive('PaletteScene')) this.scene.launch('PaletteScene');
    if (!this.scene.isActive('ConfirmScene')) this.scene.launch('ConfirmScene');
    if (!this.scene.isActive('ReceiptScene')) this.scene.launch('ReceiptScene');
    if (!this.scene.isActive('ChatterScene')) this.scene.launch('ChatterScene');
    if (!this.scene.isActive('MenuScene')) this.scene.launch('MenuScene');
    if (!this.scene.isActive('CraftScene')) this.scene.launch('CraftScene');
    if (!this.scene.isActive('DialogueScene')) this.scene.launch('DialogueScene');
    if (!this.scene.isActive('LetterboxScene')) this.scene.launch('LetterboxScene');
    if (!this.scene.isActive('ToolHudScene')) this.scene.launch('ToolHudScene');
    if (!this.scene.isActive('HoverScene')) this.scene.launch('HoverScene');
    if (!this.scene.isActive('CursorScene')) this.scene.launch('CursorScene');
    this.scene.bringToTop('BackpackButtonScene');
    this.scene.bringToTop('WeatherScene');
    this.scene.bringToTop('PaletteScene');
    this.scene.bringToTop('ChatterScene'); // above UmicatHud so the mood emoji shows IN the portrait
    this.scene.bringToTop('MenuScene');     // the unified menu sits above the HUD too
    this.scene.bringToTop('CraftScene');    // the crafting modal sits above the HUD too
    this.scene.bringToTop('LetterboxScene'); // cinematic bars ABOVE the world/HUD, BELOW the dialog box
    this.scene.bringToTop('DialogueScene'); // spotlight ring above the hotbar during a cutscene
    this.scene.bringToTop('ToolHudScene');  // current-tool indicator + fly-out switcher
    this.scene.bringToTop('HoverScene');    // empty-hand inspect ring/name above the HUD…
    this.scene.bringToTop('CursorScene');   // …but the pixel cursor stays topmost
    this.publishBuildPalette();
    this.publishWeatherHud();
    this.publishToolHud();
    this.publishBackpackBtn();
    // Use the game's own pixel cursor as the canvas cursor GLOBALLY, so whenever pointer lock is
    // released (a menu / the backpack / a dialog is open) the OS cursor is the game triangle — not
    // the host arrow. Under lock the OS cursor is hidden and CursorScene draws it instead.
    this.setGameCursorCss();

    // MOUSE: click the canvas → capture the mouse. If already locked, the click
    // is a game/HUD action routed through the virtual cursor (the OS pointer is
    // frozen under lock, so Phaser's own hit-testing can't see the cursor).
    // Touch is handled separately (pointerup tap below) — it never locks.
    this.input.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
      if (pointer.wasTouch) return;
      // Dialog open: a canvas click (outside the HTML input, which sits on top
      // and swallows its own clicks) ADVANCES the RPG text (reveal the rest / next
      // page); once everything's shown, the same click dismisses it.
      if (this.dialogOpen) { if (this.cutscene) { this.advanceCutscene(); } else if (!this.advanceDialog()) this.closeDialog(); return; }
      if (this.craftOpen) { this.handleCraftClick(pointer.x, pointer.y); return; } // crafting modal (unlocked)
      if (this.menuOpen) {
        // Press on a Settings volume slider → start a DRAG (held pointer scrubs it).
        const sl = this.menuSliderAt(pointer.x, pointer.y);
        if (sl) { this.menuSliderDrag = sl; this.menuApplySliderVol(sl, pointer.x); return; }
        // Dragging the scroll rail scrolls the list; an item slot / shop row wins over
        // the rail's wide hit zone, and the rail is off while a sub-popup is up.
        const overItem = this.itemSlotAt('menuSlots', pointer.x, pointer.y) !== null || this.menuShopRowAt(pointer.x, pointer.y) !== null;
        if (!this.menuItemMenu && !this.menuItemQty && this.openMailId === null && !overItem && this.menuRailAt(pointer.x, pointer.y)) { this.menuDragging = true; this.menuDragTo(pointer.y); return; }
        this.handleMenuClick(pointer.x, pointer.y); return;
      }
      if (this.locked) { this.handleLockedClick(); return; }
      // Not locked yet: clicking the cat opens the dialog; anything else captures
      // the pointer (the normal edge-scroll / camera mode). NOTE: Cato's top-right
      // portrait is handled by the findCatHit GameObject's own pointerdown (the
      // HUD photo-frame icon-button stopPropagation()'s here, aborting this
      // scene-level handler, so the portrait can't be routed through it).
      if (this.chatterAt(pointer.x, pointer.y)) { this.openChatterDialog(); return; } // proactive chip (screen-space)
      const wp = this.cameras.main.getWorldPoint(pointer.x, pointer.y);
      if (this.catContains(wp.x, wp.y)) { this.openDialog(); return; }
      if (this.mailboxContains(wp.x, wp.y)) { this.openMailboxViaDoor(); return; } // door mailbox → open anim → menu (Mail)
      if (this.chestContains(wp.x, wp.y)) { this.openChestViaDoor(); return; }      // door chest → open anim → menu (Chest)
      if (this.padContains(wp.x, wp.y)) { this.openShopViaPad(); return; }          // desk pad → screen-on anim → menu (Shop)
      if (this.craftStationContains(wp.x, wp.y)) { this.openCraft(); return; }        // work station → crafting modal
      this.input.manager.mouse?.requestPointerLock();
    });

    // TOUCH: no pointer lock / virtual cursor. Two gestures:
    //  • In the open backpack → PRESS a cell to pick a stack up, DRAG, RELEASE on
    //    a cell to drop/merge/swap (the natural touch move; the held stack follows
    //    the finger). Release outside a cell returns it / (empty tap) closes.
    //  • Elsewhere → a TAP (pointerup, <12px move; a bigger drag is the Rex-Pan
    //    camera pan) acts at the touched point via the SAME `actAt(x,y)` as mouse.
    this.input.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
      if (!pointer.wasTouch) return;
      // Unified menu: touch scrolls via a SWIPE (handled in MenuScene) — no rail drag here.
      // A finger on a Settings volume slider starts a drag (pointermove scrubs it).
      if (this.menuOpen) {
        const sl = this.menuSliderAt(pointer.x, pointer.y);
        if (sl) { this.menuSliderDrag = sl; this.menuApplySliderVol(sl, pointer.x); }
        return;
      }
    });
    this.input.on('pointermove', (pointer: Phaser.Input.Pointer) => {
      if (this.menuSliderDrag) { this.menuApplySliderVol(this.menuSliderDrag, pointer.x); return; } // scrub a volume slider
      if (this.menuDragging) { this.menuDragTo(pointer.y); return; } // drag the unified menu scroll rail
    });
    this.input.on('pointerup', () => {
      this.menuDragging = false; // end a rail drag
      this.menuSliderDrag = null; // end a slider drag
    });
    this.input.on('pointerup', (pointer: Phaser.Input.Pointer) => {
      if (!pointer.wasTouch) return;
      if (pointer.getDistance() > 12) return; // a drag → pan, not a tap
      // Dialog open: tap advances the RPG text; a final tap (all shown) closes.
      if (this.dialogOpen) { if (this.cutscene) { this.advanceCutscene(); } else if (!this.advanceDialog()) this.closeDialog(); return; }
      if (this.menuOpen) { this.handleMenuClick(pointer.x, pointer.y); return; }
      this.actAt(pointer.x, pointer.y);
    });

    // Esc closes the dialog (also releases pointer lock — browser-enforced).
    this.input.keyboard?.on('keydown-ESC', () => {
      if (this.confirmOpen) { this.closeConfirm(); return; } // Esc = cancel the confirm
      if (this.craftOpen) { this.closeCraft(); return; }     // Esc = close the crafting modal
      if (this.dialogOpen && !this.cutscene) this.closeDialog(); // a cutscene can't be Esc'd out of
    });
    // Enter confirms the modal dialog (✓); Esc above cancels it.
    this.input.keyboard?.on('keydown-ENTER', () => {
      if (!this.confirmOpen) return;
      const run = this.pendingConfirm;
      this.closeConfirm();
      run?.();
    });
    // Space advances the RPG text (reveal the rest / next page) — but ONLY when the
    // chat input isn't focused, so typing a space in your message doesn't skip ahead.
    this.input.keyboard?.on('keydown-SPACE', (e: KeyboardEvent) => {
      if (!this.dialogOpen) return;
      const el = document.activeElement;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA')) return;
      e.preventDefault?.();
      if (this.cutscene) this.advanceCutscene(); else this.advanceDialog();
    });

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
    // Cato's proactive chatter chip (top-right) → open the real dialog seeded with it.
    if (this.chatterAt(x, y)) { this.openChatterDialog(); return; }
    // Modal confirm dialog (demolish, …) captures everything while open.
    if (this.handleConfirmClick(x, y)) return;
    if (this.handleCraftClick(x, y)) return; // the crafting modal (work station)
    if (this.handleMenuClick(x, y)) return; // the unified menu (tabs / item detail)
    // Tool HUD (current-tool slot + fly-out switcher) — works even while holding a tool.
    if (this.handleToolHudClick(x, y)) return;
    // Contextual tool palette open → a button equips that tool, a miss dismisses it.
    if (this.handleToolPaletteClick(x, y)) return;
    // Build palette (wall facing) → pick that orientation.
    if (this.handlePaletteClick(x, y)) return;
    // Bottom-right corner buttons: sprout → backpack, gear → Settings.
    if (this.overBackpackButton(x, y)) { this.pressBackpackThenOpen(); return; }
    if (this.overSettingsButton(x, y)) { this.pressSettingsThenOpen(); return; }
    // Hotbar slot → select that tool; elsewhere over the bar → swallow.
    const slot = this.hotbarSlotAt(x, y);
    if (slot !== null) { this.selectHotbarSlot(slot); return; }
    if (this.overHotbarAt(x, y)) return;

    // World-tile actions (validity computed here, so touch works without a hover
    // cursor). Harvest takes priority; only the hoe / empty hand harvests.
    const wp = this.cameras.main.getWorldPoint(x, y);
    const tile = this.islandLayer?.getTileAtWorldXY(wp.x, wp.y);
    // AXE chops any tree the click lands on. A tree sprite is ~3 tiles tall (its
    // canopy sits ABOVE the trunk tile), so match by sprite bounds — clicking the
    // leaves would otherwise map to an empty tile above the trunk and do nothing.
    if (this.activeTool === 'axe' && !this.activePlace) {
      const treeKey = this.treeAtPoint(wp.x, wp.y);
      if (treeKey) { const [tx, ty] = treeKey.split(',').map(Number); this.chopTree(tx!, ty!); return; }
    }
    // PICKAXE knocks any big-stone the click lands on (sprite bounds — the rock is
    // ~2 tiles, taller than its foot cell).
    if (this.activeTool === 'pickaxe' && !this.activePlace) {
      const sk = this.stoneAtPoint(wp.x, wp.y);
      if (sk) { const [sx, sy] = sk.split(',').map(Number); this.knockStone(sx!, sy!); return; }
    }
    // EMPTY HAND on any tool-usable spot → pop the radial tool wheel; tap a tool to grab+equip it
    // (from the hotbar / backpack / chest). UNIFIED: tree→axe, stone→pickaxe, grass/bush/berries/
    // crop/foragable→hoe, tilled→hoe/watering-can — no more empty-hand direct harvest; you pick the
    // tool from the wheel, then use it. (Once a tool IS held, the branches below act directly.)
    if (this.activeTool === 'hand' && !this.activeSeed && !this.activePlace) {
      if (this.openToolWheelAt(wp.x, wp.y)) return;
    }
    // The HOE harvests a MATURE wild foragable (sprite bounds — tall sunflower). Empty hand does
    // NOT — it pops the wheel above (pick the hoe first); harvesting is a tool action, uniformly.
    if (this.activeTool === 'hoe') {
      const fk = this.foragAtPoint(wp.x, wp.y);
      if (fk) {
        const f = this.foragables.get(fk)!;
        if (f.stage >= (FORAGABLES[f.type]?.stages ?? 1)) { const [fx, fy] = fk.split(',').map(Number); this.harvestForagable(fx!, fy!); return; }
      }
    }
    // The mailbox at the door → open the mail modal (empty hand or any tool, but
    // not while placing). Checked before the tile actions so it wins over tilling
    // the grass under it.
    if (!this.activePlace && this.mailboxContains(wp.x, wp.y)) { this.openMailboxViaDoor(); return; }
    if (!this.activePlace && this.chestContains(wp.x, wp.y)) { this.openChestViaDoor(); return; }
    if (!this.activePlace && this.padContains(wp.x, wp.y)) { this.openShopViaPad(); return; }
    if (!this.activePlace && this.craftStationContains(wp.x, wp.y)) { this.openCraft(); return; }
    if (tile) {
      const key = `${tile.x},${tile.y}`;
      // Holding a building material: FLOOR overlaps walls (ground layer); WALL opens
      // a contextual orientation palette at the clicked cell (pick → place); door /
      // window / furniture (single orientation) place directly on empty grass.
      // Removal is done with the HOE, not here.
      if (this.activePlace) {
        if (this.activePlace === 'tree') { if (this.canPlaceTree(tile.x, tile.y)) this.placeTree(tile.x, tile.y, this.activeTreeType); }
        else if (this.activePlace === 'bush') { if (this.canPlaceBush(tile.x, tile.y)) this.plantBush(tile.x, tile.y, this.activeBushType); }
        else if (this.isPlacingFloor()) { if (this.canPlaceFloor(tile.x, tile.y)) this.placeFloor(tile.x, tile.y); }
        else if (this.activePlace === 'wall') { if (this.canPlaceAt(tile.x, tile.y)) this.openWallPalette(tile.x, tile.y); }
        else if (this.canPlaceAt(tile.x, tile.y)) this.placeObject(tile.x, tile.y);
        return;
      }
      // HOE on a placed tile (floor first, then wall/door/furniture) → dig it out:
      // hit twice (like un-tilling soil), the piece pops out + returns to the backpack.
      if (this.activeTool === 'hoe' && (this.floors.has(key) || this.placed.has(key))) {
        this.hoePlacedTile(tile.x, tile.y); return;
      }
      const crop = this.crops.get(key);
      // Harvest a mature crop / ripe bush with the HOE (empty hand pops the wheel instead —
      // uniform "pick the tool, then use it"). Not the seed / watering-can.
      const canHarvest = this.activeTool === 'hoe';
      if (canHarvest && crop && crop.stage >= CROPS[crop.name].stages - 1) {
        this.harvestCrop(tile.x, tile.y); return;
      }
      const bush = this.bushes.get(key);
      if (canHarvest && bush && bush.stage >= 2) { this.harvestBush(tile.x, tile.y); return; }
      if (this.activeTool === 'hoe' && !this.tilledCells.has(key) && !this.cellBlocksTill(key)
          && !this.treeAtPoint(wp.x, wp.y) && !this.stoneAtPoint(wp.x, wp.y)) {
        this.tillCell(tile.x, tile.y); return;
      }
      // Hoe on EMPTY tilled soil → loosen it (furrows); a 2nd hoe within the
      // window digs it back up to grass (see hoeEmptySoil).
      if (this.activeTool === 'hoe' && this.tilledCells.has(key) && !this.crops.has(key)) {
        this.hoeEmptySoil(tile.x, tile.y); return;
      }
      if (this.activeSeed && this.tilledCells.has(key) && !this.crops.has(key)) {
        this.playerPlant(tile.x, tile.y); return;
      }
      if (this.activeTool === 'watering-can' && this.tilledCells.has(key)) {
        this.playerWater(tile.x, tile.y); return;
      }
    }
    // Cato's portrait (top-right) → aim camera at him + open chat; Cato himself →
    // talk; else release follow.
    if (Phaser.Geom.Rectangle.Contains(this.findCatBounds, x, y)) { this.focusCato(); return; }
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
    // The creator paints the house walls into a SECOND tilemap layer ('wooden_house').
    // Its solid tiles already collide (SDK arms them from the tileset), but Cato's
    // pathfinding (isWalkableCell) reads only the grass layer — so grab this layer
    // to also block those cells, and wire up the editor-placed furniture colliders.
    // NOTE: the SDK builds each layer via `createLayer(0,…)` and does NOT preserve
    // the JSON layer NAME — so match on the tileset id it DOES stash
    // (`tilemapTilesetId`), else the layer is never found (silently disabling the
    // wall pathfinding + the floor-collider strip below). Name is a fallback.
    this.wallLayer =
      layers?.find((l) => l.getData('tilemapTilesetId') === 'wooden_house_walls_tilset') ??
      layers?.find((l) => l.layer?.name === 'wooden_house');
    if (!this.wallLayer) console.warn('[catopia] wooden_house wall layer not found — wall pathfinding + floor strip disabled');
    this.stripFloorColliders();
    this.wireHouseFurniture();
    this.wireHouseDoor();
    this.wireMailbox();
    this.wireChest();
    this.wirePad();
    this.wireCraftStation();
    this.wireSceneTrees();
    this.wireSceneBushes();
    this.wireSceneForageAndStones();
    this.createControlToggle(); // on-screen TEST button: drive Cato ↔ pan camera

    // Bracket cursor (frames a 16px cell) + the held-tool icon inside it. Hidden until a tool is out
    // + hovering a farmable tile. High depth so they read over tiles + Cato. When shown, the bracket
    // IS the cursor (the normal mouse pointer hides — see updateTileCursor).
    // It's the SAME `white-corner-bracket` the empty-hand hover-inspect uses, at the SAME on-screen
    // corner size (~5×zoom): a WORLD-space nine-slice (camera applies the zoom) scaled by 0.625 so
    // its ~8px mark renders at ~5×zoom — matching HoverScene's CORNER_SCALE. Sized so the frame is
    // ~28 world px (frames the 16px tile like the hover bracket). Falls back to the tile-select image
    // if the atlas frame is somehow missing.
    const TILE_BR = 0.625; // == HoverScene CORNER_SCALE (5×zoom); keep the two in sync
    if (this.textures.exists('ui-sheet') && this.textures.get('ui-sheet').has('white-corner-bracket')) {
      this.tileCursor = this.add
        .nineslice(0, 0, 'ui-sheet', 'white-corner-bracket', 28 / TILE_BR, 28 / TILE_BR, 14, 14, 14, 14)
        .setScale(TILE_BR)
        .setOrigin(0.5, 0.5)
        .setDepth(1e6)
        .setVisible(false);
    } else {
      this.tileCursor = this.add.image(0, 0, 'tile-select').setOrigin(0.5, 0.5).setDepth(1e6).setVisible(false);
    }
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
    // White "chip" particle for the pickaxe knock on big-stones (like dirtBurst).
    if (!this.textures.exists('white-particle')) {
      const g = this.add.graphics();
      g.fillStyle(0xffffff, 1).fillRect(0, 0, 3, 3);
      g.generateTexture('white-particle', 3, 3);
      g.destroy();
    }

    this.setupInventory();
  }

  // ── Inventory + hotbar (GameScene owns the model; the scenes render it) ──

  /** Seed the backpack, publish the model, and bind keys: number keys 1..N
   *  select the matching hotbar (row-0) slot; E / I toggle the full backpack.
   *  You start bare-handed (nothing selected). */
  private setupInventory(): void {
    this.inventory = new Array<ItemStack | null>(INV_ROWS * INV_COLS).fill(null); // vestigial (no hotbar) — save compat
    // The BACKPACK is the portable store you carry + Use things from: everyday tools, seeds, a wall.
    this.backpackStore = [
      itemFromId('hoe', 1), itemFromId('watering-can', 1), itemFromId('axe', 1), itemFromId('pickaxe', 1),
      ...CROP_NAMES.map((c) => makeSeed(c, 10)),
      makePlaceable('wall', 99),
    ];
    // The bulk starter kit lives in the CHEST (storage) — Take what you need into the backpack:
    // spare seed stacks, building materials, plantables.
    this.mailboxStore = [];
    this.chestStore = [
      ...CROP_NAMES.map((c) => makeSeed(c, 20)),
      makePlaceable('floor', 99), makePlaceable('window', 99), makePlaceable('door', 10),
      ...FURNITURE.map((piece) => makePlaceable('furniture', 10, piece.id)),
      ...TREE_TYPES.map((t) => makePlaceable('tree', 10, t.id)),
      ...BERRY_TYPES.map((b) => makePlaceable('bush', 10, b)),
    ];
    this.chestSeeded = true; // fresh game already has the seeds

    this.hotbarSelected = -1;
    this.publishInventory();

    // No hotbar / number keys anymore. The bottom-right sprout button opens the BACKPACK (things you
    // carry + Use); E/I open the CHEST (storage).
    this.input.keyboard?.on('keydown-E', () => (this.menuOpen ? this.closeMenu() : this.openMenu(1)));
    this.input.keyboard?.on('keydown-I', () => (this.menuOpen ? this.closeMenu() : this.openMenu(1)));
    // R: rotate the wall facing / cycle the furniture piece while building.
    this.input.keyboard?.on('keydown-R', () => this.rotatePlaceable());
    // TAB: open the tool wheel at the cursor — works EVEN while holding a tool, so it's the desktop
    // way to switch/cancel (pick the mouse circle) without conflicting with click-to-use. Capture
    // it so the browser doesn't move focus. A second Tab closes it.
    this.input.keyboard?.addCapture('TAB');
    this.input.keyboard?.on('keydown-TAB', () => this.toggleToolWheelAtCursor());
  }

  /** Tab / tool-HUD entry point: open the tool wheel at the cursor (forced — even with no applicable
   *  tool here, so you can always cancel), or close it if already open. */
  private toggleToolWheelAtCursor(): void {
    if (!this.gameReady || this.dialogOpen || this.menuOpen || this.craftOpen || this.inventoryOpen || this.confirmOpen) return;
    if (this.toolPaletteOpen) { this.closeToolPalette(); return; } // Tab again → dismiss instantly (no tool picked)
    const sx = this.locked ? this.vcursor.x : this.input.activePointer.x;
    const sy = this.locked ? this.vcursor.y : this.input.activePointer.y;
    const wp = this.cameras.main.getWorldPoint(sx, sy);
    this.openToolWheelAt(wp.x, wp.y, true);
  }

  /** Map a stack → the compact view the scenes render (icon + count). */
  private stackView(s: ItemStack | null): { iconKey?: string; iconFrame?: string | number; count: number } | null {
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
      hovered: this.hotbarHover,
      visible: this.gameReady && (!this.dialogOpen || this.cutscene) && !this.inventoryOpen && !this.cinematic, // cutscene keeps it (tool spotlights); the cinematic intro HIDES it until the game officially starts
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
    this.publishToolHud(); // the current-tool indicator tracks the held item
    this.scheduleSave(); // inventory / selection changed → persist
  }

  /** Pointer step (1..5) for the current time of day: morning ↗ … evening ↘. */
  private pointerStep(): number {
    const t = (this.dayTimeMs % DAY_LEN_MS) / DAY_LEN_MS; // 0..1 through the day
    return Phaser.Math.Clamp(Math.floor(t * 5) + 1, 1, 5);
  }

  /** Background index (0..2) for the current time of day: morning / noon / night. */
  private bgIndex(): number {
    const t = (this.dayTimeMs % DAY_LEN_MS) / DAY_LEN_MS;
    return Phaser.Math.Clamp(Math.floor(t * WEATHER_BGS.length), 0, WEATHER_BGS.length - 1);
  }

  /** Push the weather / time / money model to WeatherScene (re-renders on rev bump). */
  private publishWeatherHud(): void {
    this.registry.set('weatherHud', {
      visible: this.gameReady && !this.inventoryOpen,
      bgFrame: WEATHER_BGS[this.bgIndex()], // time-tinted window background
      weatherFrame: WEATHER_ICONS[this.dayCount % WEATHER_ICONS.length], // transparent icon on top
      pointerStep: this.pointerStep(),
      money: this.money,
      rev: ++this.weatherHudRev,
    });
    this.lastPointerStep = this.pointerStep();
    this.lastBgIndex = this.bgIndex();
  }

  /** Give / take coins + refresh the HUD (single choke-point for the balance). */
  private addMoney(delta: number): void {
    this.money = Math.max(0, this.money + delta);
    this.publishWeatherHud();
    this.scheduleSave();
  }

  /** Advance the in-game day clock; re-publish only when the pointer step or day
   *  flips (cheap — the pointer changes ~5×/day, not every frame). */
  private updateDayClock(delta: number): void {
    this.dayTimeMs += delta;
    if (this.dayTimeMs >= DAY_LEN_MS) {
      this.dayTimeMs %= DAY_LEN_MS;
      this.dayCount += 1; // new day → new weather pick
      this.settleDay(); // sell whatever's in the mailbox, then deliver any pending order
    }
    const bg = this.bgIndex();
    if (this.pointerStep() !== this.lastPointerStep || bg !== this.lastBgIndex) {
      // Cato reacts to the day turning: nightfall → sleepy, a new morning → cheerful.
      if (bg !== this.lastBgIndex) {
        const night = bg === WEATHER_BGS.length - 1;
        this.emote?.setAmbient(night ? 'sleepy' : 'idle'); // his "just vibing" mood tracks the scene
        if (this.gameReady && this.lastBgIndex >= 0) {
          if (night) this.catoReact('sleepy', { duration: 3200 });
          else if (bg === 0) this.catoReact('wake', { duration: 3200 });
        }
      }
      this.publishWeatherHud(); // pointer / background changed → redraw + persist the clock
      this.scheduleSave();
    }
  }

  /** Fast-forward the day clock one step (1/5 day). On crossing a full day, ROLL OVER
   *  (dayCount++ + settleDay) — the old `% DAY_LEN_MS` wrapped without ever crossing the
   *  boundary, so the mailbox never settled. Driven by the U key AND the on-screen ⏩ button. */
  private fastForwardTime(): void {
    this.dayTimeMs += DAY_LEN_MS / 5;
    if (this.dayTimeMs >= DAY_LEN_MS) { this.dayTimeMs -= DAY_LEN_MS; this.dayCount += 1; this.settleDay(); }
    this.publishWeatherHud();
  }

  /** Drive the full-screen day/night mask from the clock (created lazily). A single
   *  oversized scrollFactor-0 rect at NIGHT_MASK_DEPTH → covers the world at any
   *  camera position / canvas size, always UNDER the HUD scenes. Non-interactive, so
   *  it never eats a click. */
  private updateNightMask(): void {
    if (!this.gameReady) return;
    if (!this.nightMask) {
      this.nightMask = this.add.rectangle(-4000, -4000, 16000, 16000, 0x0c1636, 0)
        .setOrigin(0, 0).setScrollFactor(0).setDepth(NIGHT_MASK_DEPTH);
    }
    const t = (this.dayTimeMs % DAY_LEN_MS) / DAY_LEN_MS;
    const { color, alpha } = this.nightTint(t);
    this.nightMask.setFillStyle(color, alpha);
  }

  /** Interpolate the NIGHT_KEYS keyframes for day-fraction `t` → {colour, alpha}. */
  private nightTint(t: number): { color: number; alpha: number } {
    const keys = NIGHT_KEYS;
    for (let i = 0; i < keys.length - 1; i++) {
      const [t0, c0, a0] = keys[i]!;
      const [t1, c1, a1] = keys[i + 1]!;
      if (t >= t0 && t <= t1) {
        const f = t1 === t0 ? 0 : (t - t0) / (t1 - t0);
        const col = Phaser.Display.Color.Interpolate.ColorWithColor(
          Phaser.Display.Color.IntegerToColor(c0), Phaser.Display.Color.IntegerToColor(c1), 100, Math.round(f * 100),
        );
        return { color: Phaser.Display.Color.GetColor(col.r, col.g, col.b), alpha: Phaser.Math.Linear(a0, a1, f) };
      }
    }
    return { color: 0x0c1636, alpha: 0 };
  }

  /** Trigger Cato's reactive emote bubble (algorithmic). Skipped while chatting (the
   *  dialog sits over him). The AI-text path for special moments is future work. */
  private catoReact(emotion: Emotion, opts?: { duration?: number; force?: boolean }): void {
    if (this.dialogOpen) return;
    this.emote?.play(emotion, this.time.now, opts);
  }

  /** Drain stamina while Cato works, regen while he rests; drive the gauge + the tired
   *  emotes. Called each frame. */
  private updateStamina(delta: number): void {
    if (!this.child) return;
    const dt = delta / 1000;
    const now = this.time.now;
    if (this.catoTask && !this.menuOpen && !this.craftOpen) {
      // catoTask still drives the drain — but while a menu is open Cato is PAUSED
      // (frozen in the update loop), so he shouldn't lose energy standing still.
      const before = this.stamina;
      this.stamina = Math.max(0, this.stamina - STAMINA_DRAIN_PER_SEC * dt);
      const lowT = this.staminaMax * STAMINA_LOW_FRAC;
      if (before > lowT && this.stamina <= lowT) this.catoReact('effort', { duration: 2600 }); // getting tired → sweat
      if (this.stamina <= 0 && !this.exhausted) this.onExhausted();
      this.emote?.setStamina(this.stamina / this.staminaMax, now);
    } else {
      this.stamina = Math.min(this.staminaMax, this.stamina + STAMINA_REGEN_PER_SEC * dt);
      if (this.exhausted) {
        this.emote?.setStamina(this.stamina / this.staminaMax, now); // show it filling back up while he rests
        if (this.stamina >= this.staminaMax * STAMINA_RECOVER_FRAC) this.exhausted = false; // rested enough → back to work
      }
    }
  }

  /** Stamina hit 0 → Cato is too tired to continue: drop the current job and rest in
   *  place (the wander loop keeps him idle + drowsy until he's recovered). */
  private onExhausted(): void {
    this.exhausted = true;
    this.catoTask = null;
    this.choreSession = null; // session interrupted → no "all done"; the tired remark speaks instead
    this.cameraFollow = false;
    (this.child?.body as Phaser.Physics.Arcade.Body | undefined)?.setVelocity(0, 0);
    this.startWanderIdle();
    // If he's carrying food, ANNOUNCE first — he notices the snack, sits down to rest, and
    // only takes the first bite after a beat (CATO_EAT_ANNOUNCE_MS via catoEatAt); the rest
    // branch keeps eating on a cooldown until he's recovered or out of food. No food → drowse.
    if (this.backpackStore.some((it) => isFood(it.id))) {
      this.catoReact('sleepy', { duration: 2400, force: true });
      this.catoSay('chatter_found_food');
      this.catoEatAt = this.time.now + CATO_EAT_ANNOUNCE_MS; // first bite lands after the remark
    } else {
      this.catoReact('sleepy', { duration: 3200, force: true });
      this.catoSay('chatter_tired');
    }
    this.scheduleSave();
  }

  /** Cato eats one unit of the first FOOD item in the SHARED backpack (data-table `food` value),
   *  restoring stamina; clears `exhausted` once he's recovered enough. Returns false when
   *  there's nothing edible. */
  private catoEatFood(): boolean {
    const idx = this.backpackStore.findIndex((it) => isFood(it.id));
    if (idx < 0) return false;
    this.consumeFood(idx);
    return true;
  }

  /** Eat ONE unit of the food stack at `idx` in the shared backpack: restore stamina (clamped),
   *  decrement, happy emote + "munch" remark, clear `exhausted` once recovered enough, then
   *  refresh the open backpack + save. Shared by the auto-eat and the manual Feed action. */
  private consumeFood(idx: number): void {
    const it = this.backpackStore[idx];
    if (!it) return;
    this.stamina = Math.min(this.staminaMax, this.stamina + foodValue(it.id));
    it.count -= 1;
    if (it.count <= 0) this.backpackStore.splice(idx, 1);
    this.emote?.setStamina(this.stamina / this.staminaMax, this.time.now);
    this.catoReact('happy', { duration: 2200, force: true });
    this.catoSay('chatter_ate');
    if (this.stamina >= this.staminaMax * STAMINA_RECOVER_FRAC) this.exhausted = false; // fed enough → back to work
    if (this.menuOpen && this.menuTab === TAB_BACKPACK) this.publishMenu(); // refresh the backpack if it's open
    this.scheduleSave();
  }

  /** Manual Feed (from the backpack, food items): hand-feed Cato one unit of the picked food NOW
   *  — works even when he isn't exhausted, to top him up before a long chore run. If he's
   *  already at full stamina he politely declines (no waste). */
  private menuFeed(index: number): void {
    const it = this.backpackStore[index];
    if (!it || !isFood(it.id)) return;
    if (this.stamina >= this.staminaMax) { this.catoSay('chatter_full'); return; }
    this.consumeFood(index);
  }

  /** Cato says a little proactive remark (i18n key) in the top-right chip — NOT the main
   *  chat. Auto-hides after CHATTER_MS; tapping it opens the real dialog seeded with it. */
  private catoSay(key: string, cropName?: string): void {
    if (this.dialogOpen) return; // don't chatter over an open conversation
    let text = t(key);
    if (text.includes('{crop}')) text = text.replace('{crop}', t(cropName ? `crop_${cropName}` : 'crop_generic'));
    this.chatterText = text;
    this.lastChatter = text; // the AI sees this as Cato's most recent remark
    this.registry.set('catoChatter', { visible: true, rev: ++this.chatterRev, text });
    this.chatterTimer?.remove();
    this.chatterTimer = this.time.delayedCall(CHATTER_MS, () => this.clearChatter());
  }

  private clearChatter(): void {
    this.chatterTimer?.remove(); this.chatterTimer = undefined;
    this.chatterText = null;
    this.registry.set('catoChatter', { visible: false, rev: ++this.chatterRev });
  }

  /** Is (x,y) on the chatter chip? (Reads the bounds ChatterScene published.) */
  private chatterAt(x: number, y: number): boolean {
    const r = this.registry.get('catoChatterBounds') as { x: number; y: number; w: number; h: number } | null;
    return !!r && x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;
  }

  /** Tap on the chatter chip → open the real dialog, seeded with what Cato just said. */
  private openChatterDialog(): void {
    const seed = this.chatterText;
    this.clearChatter();
    this.closeOpenModal();
    this.followCato();
    this.openDialog(seed ?? undefined);
  }

  /** Cato ambles over to a tile to "have a look" (e.g. you harvested there). Skipped
   *  while he's on a commanded task; skipped if it's so far he'd walk off-screen (then
   *  he just emotes in place). Cleared on arrival / deadline in `updateWander`. */
  private catoLookAtTile(cx: number, cy: number): void {
    if (this.catoTask || !this.child || !this.islandLayer) return;
    const w = this.islandLayer.tileToWorldXY(cx, cy);
    if (!w) return;
    const wx = w.x + TILE / 2, wy = w.y + TILE / 2;
    const cam = this.cameras.main;
    const far = Math.hypot(cam.worldView.centerX - wx, cam.worldView.centerY - wy);
    if (far > this.wanderLeashRadius() * 1.4) return; // too far → don't run off-screen, just emote
    this.catoCurious = { x: wx, y: wy, deadline: this.time.now + 4500 };
    this.catoReturning = false;
    this.wanderTarget = null;
    this.wanderState = 'walk';
    this.wanderTimer = 0;
  }

  /** Select hotbar (row-0) slot `i`: equip its tool + highlight it. Re-selecting
   *  the active slot TOGGLES it off → empty hand, no highlight. */
  private selectHotbarSlot(i: number): void {
    if (this.dialogOpen || this.inventoryOpen) return;
    if (i < 0 || i >= INV_COLS) return;
    playSfx(this); // button click blip on select / deselect
    this.closeToolPalette(); // picking from the hotbar closes any open tool wheel
    this.heldExternal = null; // picking a hotbar slot cancels any external (chest/palette) held item
    this.hotbarSelected = this.hotbarSelected === i ? -1 : i;
    this.equipSelected();
    this.publishInventory();
  }

  /** The currently HELD item stack, whatever its source: an external (chest/palette) item wins,
   *  else the selected hotbar cell (null = empty hand). The single read every equip/consume uses. */
  private heldCell(): ItemStack | null {
    if (this.heldExternal) return this.heldExternal.item;
    return this.hotbarSelected >= 0 ? this.inventory[this.hotbarSelected] : null;
  }

  /** Hold an item that lives OUTSIDE the hotbar (a chest/Cato-bag stack, or a palette tool):
   *  it becomes the active tool/seed/material, the hotbar shows nothing selected. */
  private holdExternal(store: ItemStack[], item: ItemStack): void {
    this.heldExternal = { store, item, label: item.label ?? item.id };
    this.hotbarSelected = -1;
    this.equipSelected();
    this.publishInventory();
  }

  /** Drop whatever is held → empty hand (Esc / palette cancel / a held external stack emptied). */
  private clearHeld(): void {
    if (!this.heldExternal && this.hotbarSelected < 0) return;
    this.heldExternal = null;
    this.hotbarSelected = -1;
    this.equipSelected();
    this.publishInventory();
  }

  /** Equip whatever tool the selected hotbar cell holds (empty / non-tool =
   *  empty hand). Called after selection changes AND after the inventory is
   *  rearranged (a cell's tool may have moved). */
  private equipSelected(): void {
    const cell = this.heldCell();
    this.setTool(cell?.toolId ?? 'hand');
    this.activeSeed = cell?.plants; // seed bag selected → planting mode
    this.activePlace = cell?.place; // building material → placement mode
    if (cell?.place === 'furniture' && cell.variant) this.activeFurn = cell.variant;
    if (cell?.place === 'tree' && cell.variant) this.activeTreeType = cell.variant as TreeType;
    if (cell?.place === 'bush' && cell.variant) this.activeBushType = cell.variant as BerryType;
    this.closeWallPalette(); // cancel any pending wall-orientation choice on tool change
  }

  /** Is the virtual cursor over a hotbar slot? Returns the slot index or null. */
  /** Track which hotbar cell the mouse cursor is over → the highlight (white) frame.
   *  Mouse-only (pointer-locked virtual cursor); touch has no hover. Updates the hotbar
   *  registry entry directly (no save) when it changes so HotbarScene re-renders. */
  private updateHotbarHover(): void {
    let idx = -1;
    if (this.locked && this.gameReady && (!this.dialogOpen || this.cutscene) && !this.inventoryOpen) {
      const slot = this.hotbarSlotAt(this.vcursor.x, this.vcursor.y);
      if (slot !== null) idx = slot;
      else if (this.overBackpackButton(this.vcursor.x, this.vcursor.y)) idx = INV_COLS; // backpack cell
    }
    if (idx === this.hotbarHover) return;
    this.hotbarHover = idx;
    if (idx >= 0) playSfx(this, SFX_HOVER); // soft blip as the cursor highlights a cell
    const m = this.registry.get('hotbar') as Record<string, unknown> | undefined;
    if (m) this.registry.set('hotbar', { ...m, hovered: idx }); // hover change → re-render (no save)
  }

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
    const r = this.registry.get('backpackBtnBounds') as { x: number; y: number; w: number; h: number } | undefined;
    if (!r) return false;
    return x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;
  }

  private bagBtnPressed = false;
  private settingsBtnPressed = false;
  /** Publish the bottom-right corner buttons (backpack sprout + settings gear) visibility + press. */
  private publishBackpackBtn(): void {
    const hidden = !this.gameReady || this.cutscene || (this.dialogOpen && !this.cutscene) || this.menuOpen || this.craftOpen || this.inventoryOpen || this.confirmOpen;
    this.registry.set('backpackBtn', { visible: !hidden, bagPressed: this.bagBtnPressed, settingsPressed: this.settingsBtnPressed });
  }

  private overSettingsButton(x: number, y: number): boolean {
    const r = this.registry.get('settingsBtnBounds') as { x: number; y: number; w: number; h: number } | undefined;
    return !!r && x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;
  }

  /** Settings gear tapped → flash pressed, THEN open the Settings menu tab. */
  private pressSettingsThenOpen(): void {
    if (this.menuOpen) return;
    this.settingsBtnPressed = true; this.publishBackpackBtn();
    this.time.delayedCall(120, () => {
      this.settingsBtnPressed = false; this.publishBackpackBtn();
      this.openMenu(4); // TAB_SETTINGS
    });
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

  /** Is the virtual cursor over a build-palette cell? (Suppress the placement ghost
   *  there so hovering the palette doesn't preview a tile behind it.) */
  private pointerOverBuildPalette(): boolean {
    const bounds = this.registry.get('buildPaletteBounds') as Array<{ x: number; y: number; w: number; h: number }> | undefined;
    if (!bounds) return false;
    const x = this.vcursor.x, y = this.vcursor.y;
    return bounds.some((b) => x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h);
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
    if (!this.activePlace) this.hidePlacePreview(); // drop the build ghost when not building
    const showMouse = () => {
      cursor.setVisible(false);
      icon.setVisible(false);
      this.hoverCell = null;
      this.cursorState.visible = this.locked;
    };
    // While the tool wheel is open, hide the held-tool bracket/icon (+ its build ghost) — the
    // wheel is the focus, so the tool shouldn't keep following the cursor. Keep the plain cursor.
    if (this.toolPaletteOpen) { this.hidePlacePreview(); showMouse(); return; }
    // PLACEMENT MODE: a building material is held → show the tile bracket (圆角框,
    // like the tools) snapped to the target cell + a ghost of the object inside it
    // (bright/clear when it fits, dimmed/red when it can't go there).
    if (this.activePlace) {
      icon.setVisible(false); // the ghost IS the icon here
      this.hoverCell = null;
      this.cursorState.visible = this.locked;
      if (this.buildPaletteCell || !this.locked || this.dialogOpen || this.inventoryOpen || this.confirmOpen || this.pointerOverHotbar() || this.pointerOverBuildPalette() || this.hoeSwing || this.waterCan) {
        cursor.setVisible(false);
        this.hidePlacePreview();
      } else {
        this.updatePlacePreview();
      }
      return;
    }
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
    const chopping = this.activeTool === 'axe';
    const mining = this.activeTool === 'pickaxe';
    const holdingTool = tilling || planting || watering || chopping || mining;
    // No tool held / not locked / over UI / dialog / backpack → real mouse.
    if (!holdingTool || !this.locked || this.dialogOpen || this.inventoryOpen || this.confirmOpen || this.pointerOverHotbar()) {
      showMouse();
      return;
    }

    // The held tool's icon, always shown (dimmed when the spot is invalid).
    if (tilling) icon.setTexture('tools_and_meterials', 'hoe');
    else if (watering) icon.setTexture('tools_and_meterials', 'watering-can');
    else if (chopping) icon.setTexture('tools_and_meterials', 'axe');
    else if (mining) icon.setTexture('pickaxe');
    else if (this.activeSeed) icon.setTexture('farming_plants_items', `${this.activeSeed}-seed-bag`);

    const wp = this.cameras.main.getWorldPoint(this.vcursor.x, this.vcursor.y);
    const tile = this.islandLayer.getTileAtWorldXY(wp.x, wp.y);
    // Axe targets a TREE, pickaxe a BIG-STONE (both by sprite bounds), not a tile.
    const treeKey = chopping ? this.treeAtPoint(wp.x, wp.y) : null;
    const stoneKey = mining ? this.stoneAtPoint(wp.x, wp.y) : null;

    // Is this spot a valid target for the held tool?
    let valid = false;
    if (chopping) valid = !!treeKey;
    else if (mining) valid = !!stoneKey;
    else if (tile) {
      const key = `${tile.x},${tile.y}`;
      if (tilling) {
        // Hoe: bright over tillable grass, EMPTY tilled soil (loosen/un-till), a
        // MATURE crop / RIPE bush / mature foragable (harvest), OR a placed house tile
        // (dig it out). DIM over a still-growing crop and over anything the hoe can't
        // touch — a tree, big stone, or an immature bush/foragable (can't till under them).
        const crop = this.crops.get(key);
        const cropHarvest = !!crop && crop.stage >= CROPS[crop.name].stages - 1;
        const bush = this.bushes.get(key);
        const forag = this.foragables.get(key);
        const foragMature = !!forag && forag.stage >= (FORAGABLES[forag.type]?.stages ?? 1);
        if (this.treeAtPoint(wp.x, wp.y) || this.stoneAtPoint(wp.x, wp.y)) valid = false; // over a tree/stone sprite
        else if (this.isDefaultHouseCell(key)) valid = false; // the fixed starter house — not tillable/diggable
        else if (this.treeOrStoneOverCell(tile.x, tile.y)) valid = false; // a tree/stone footprint covers this cell
        else if (this.placed.has(key) || this.floors.has(key)) valid = true;
        else if (this.trees.has(key) || this.bigStones.has(key)) valid = false;
        else if (bush) valid = bush.stage >= 2;
        else if (forag) valid = foragMature;
        else if (!this.tilledCells.has(key)) valid = true;
        else valid = !crop || cropHarvest;
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
    // Axe over a tree: snap the bracket to the tree's BASE (trunk tile), not the
    // canopy tile the cursor happens to be over, so it clearly frames the target.
    if (chopping && treeKey) {
      const [tx, ty] = treeKey.split(',').map(Number);
      const w = this.islandLayer.tileToWorldXY(tx!, ty!);
      if (w) { px = w.x + TILE / 2; py = w.y + TILE / 2; }
    }
    // Pickaxe over a big-stone: snap the bracket to the stone's base cell.
    if (mining && stoneKey) {
      const [tx, ty] = stoneKey.split(',').map(Number);
      const w = this.islandLayer.tileToWorldXY(tx!, ty!);
      if (w) { px = w.x + TILE / 2; py = w.y + TILE / 2; }
    }
    cursor.setPosition(px, py).setVisible(true);
    icon.setPosition(px, py).setVisible(true);
    // Keep the mouse cursor visible too (it follows the exact pointer); the
    // bracket just snaps to the tile the mouse is over — so movement reads clearly.
    this.cursorState.visible = this.locked;

    if (valid) {
      cursor.setAlpha(1).clearTint();
      icon.setAlpha(1);
      this.hoverCell = tile ? { cx: tile.x, cy: tile.y } : null;
    } else {
      // Disabled look: light-gray bracket + semi-transparent tool, no action.
      cursor.setAlpha(0.55).setTint(0xbbbbbb);
      icon.setAlpha(0.4);
      this.hoverCell = null;
    }
  }

  /** Empty-hand "inspect" hover (HoverScene): with NO tool held and the mouse over an object,
   *  show a corner-bracket hugging it + the object's NAME above it. It ADDS to the normal
   *  triangle mouse cursor (never hides it); over empty ground there's no bracket, just the
   *  usual cursor. Mouse-only. Runs after updateTileCursor each frame. */
  private updateHoverInspect(): void {
    // While the tool wheel is open, FREEZE the focus on the spot the wheel opened on (its bbox) —
    // don't let mouse movement over the wheel circles re-target it. No name (the wheel is the focus).
    if (this.toolPaletteOpen) {
      const cam = this.cameras.main, z = cam.zoom, bb = this.toolPaletteOpen.bbox, pad = 5;
      this.hoverModel = {
        visible: true, onObject: true, z,
        x: ((bb.wl + bb.wr) / 2 - cam.worldView.x) * z, y: ((bb.wt + bb.wb) / 2 - cam.worldView.y) * z,
        w: (bb.wr - bb.wl) * z + pad * 2, h: (bb.wb - bb.wt) * z + pad * 2, name: '', nameX: 0, nameY: 0,
      };
      this.registry.set('hover', this.hoverModel);
      return;
    }
    const emptyHand = this.activeTool === 'hand' && !this.activeSeed && !this.activePlace;
    const blocked = !this.gameReady || this.dialogOpen || this.menuOpen || this.craftOpen
      || this.inventoryOpen || this.confirmOpen || this.buildPaletteCell !== null || this.hoeSwing || this.waterCan;
    if (!emptyHand || blocked) { this.setHover(false); return; }

    // Source point: the frozen virtual cursor under pointer-lock, else the real OS pointer.
    const sx = this.locked ? this.vcursor.x : this.input.activePointer.x;
    const sy = this.locked ? this.vcursor.y : this.input.activePointer.y;
    if (this.overHotbarAt(sx, sy)) { this.setHover(false); return; } // let the hotbar own its band

    const cam = this.cameras.main;
    const wp = cam.getWorldPoint(sx, sy);
    const target = this.hoverTargetAt(wp.x, wp.y);

    if (target) {
      // TIGHT box = the sprite's opaque-pixel bbox (not the padded frame), so the bracket hugs
      // the actual art regardless of how much transparent margin the asset has.
      const b = this.spriteWorldSolidRect(target.sprite);
      const cx = b.x + b.w / 2, cy = b.y + b.h / 2;
      const pad = 5;
      this.hoverModel = {
        visible: true, onObject: true, z: cam.zoom,
        x: (cx - cam.worldView.x) * cam.zoom,
        y: (cy - cam.worldView.y) * cam.zoom,
        w: b.w * cam.zoom + pad * 2,
        h: b.h * cam.zoom + pad * 2,
        name: this.toolPaletteOpen ? '' : target.name, // hide the name while the tool wheel is open
        nameX: (cx - cam.worldView.x) * cam.zoom,
        nameY: (b.y - cam.worldView.y) * cam.zoom - 3, // pill just above the art's top
      };
      this.registry.set('hover', this.hoverModel);
      return; // the triangle mouse cursor stays visible — the bracket just ADDS a highlight
    }

    // Empty ground: over a grass/island TILE (not water / off-map) → still show the corner bracket,
    // framing that tile exactly like the tool cursor does (same art, size, and 4px margin). No name.
    // This keeps a highlight visible at all times, even empty-handed on grass.
    const tile = this.islandLayer?.getTileAtWorldXY(wp.x, wp.y);
    if (tile) {
      const w = this.islandLayer!.tileToWorldXY(tile.x, tile.y);
      if (w) {
        const cxw = w.x + TILE / 2, cyw = w.y + TILE / 2, z = cam.zoom;
        this.hoverModel = {
          visible: true, onObject: true, z,
          x: (cxw - cam.worldView.x) * z, y: (cyw - cam.worldView.y) * z,
          w: 28 * z, h: 28 * z, // frame the 16px tile — 28 local clears the white-corner-bracket nine-slice min (2×14)
          name: '', nameX: 0, nameY: 0,
        };
        this.registry.set('hover', this.hoverModel);
        return;
      }
    }
    this.setHover(false); // over water / off the island → no bracket; just the normal triangle cursor
  }

  private setHover(visible: boolean): void {
    if (!visible && !this.hoverModel.visible) return; // already hidden — don't thrash the registry
    this.hoverModel = { ...this.hoverModel, visible };
    this.registry.set('hover', this.hoverModel);
  }

  /** The topmost nameable object under a world point, for the inspect hover (name + the sprite
   *  whose bounds the ring hugs). Priority: Cato → interactables → trees/stones/forage (tall,
   *  by sprite bounds) → cell props (bushes/crops). */
  private hoverTargetAt(wx: number, wy: number): { name: string; sprite: Phaser.GameObjects.Sprite | Phaser.GameObjects.Image } | null {
    if (this.child && this.catContains(wx, wy)) return { name: t('hover_cato'), sprite: this.child };
    if (this.mailbox && this.mailboxContains(wx, wy)) return { name: t('hover_mailbox'), sprite: this.mailbox };
    if (this.chest && this.chestContains(wx, wy)) return { name: t('hover_chest'), sprite: this.chest };
    if (this.pad && this.padContains(wx, wy)) return { name: t('hover_shop'), sprite: this.pad };
    if (this.craftStation && this.craftStationContains(wx, wy)) return { name: t('hover_workstation'), sprite: this.craftStation };
    const tk = this.treeAtPoint(wx, wy);
    if (tk) { const o = this.trees.get(tk); if (o) return { name: t(`hover_tree_${o.type}`), sprite: o.sprite }; }
    const sk = this.stoneAtPoint(wx, wy);
    if (sk) { const o = this.bigStones.get(sk); if (o) return { name: t('hover_stone'), sprite: o.sprite }; }
    const fk = this.foragAtPoint(wx, wy);
    if (fk) { const o = this.foragables.get(fk); if (o) return { name: t(`hover_forage_${o.type.replace(/-/g, '_')}`), sprite: o.sprite }; }
    const tile = this.islandLayer?.getTileAtWorldXY(wx, wy);
    if (tile) {
      const key = `${tile.x},${tile.y}`;
      const bush = this.bushes.get(key);
      if (bush) return { name: t(`hover_bush_${bush.type}`), sprite: bush.base };
      const crop = this.crops.get(key);
      if (crop) return { name: t(`item_crop_${crop.name}`), sprite: crop.sprite };
    }
    return null;
  }

  // ── Contextual tool WHEEL (tap a tool-usable spot → a radial of tools around it) ──────
  //  Fixed cardinal position per tool so the same tool always sits in the same place (muscle
  //  memory); only the tools APPLICABLE to the tapped spot + OWNED by the player are shown, plus
  //  a mouse (close) circle at the centre.

  /** The tool's inventory-icon texture/frame (same art the hotbar + tool cursor use). */
  private toolIcon(toolId: ToolId): { key: string; frame: string | number } {
    if (toolId === 'pickaxe') return { key: 'pickaxe', frame: 0 };
    return { key: 'tools_and_meterials', frame: toolId }; // 'hoe' / 'watering-can' / 'axe'
  }

  /** Where the player owns a tool: a hotbar slot (row 0) → select it; else a backpack / chest /
   *  Cato-bag stack → hold it as an external item. null = not owned anywhere. */
  private findOwnedTool(toolId: ToolId): { hotbar: number } | { store: ItemStack[]; item: ItemStack } | null {
    for (const store of [this.backpackStore, this.chestStore, this.catoBagStore]) {
      const it = store.find((s) => s.toolId === toolId);
      if (it) return { store, item: it };
    }
    return null;
  }

  /** The wheel's fixed RING slots (unit screen vectors from the object centre, clockwise from 2
   *  o'clock). Cancel (mouse) sits at the top (0,-1), handled separately. A slot with a null tool
   *  (the 6-o'clock reserved spot) or an unowned tool just shows the empty circle base. Fixed
   *  positions = muscle memory. Mirrors the reference: pickaxe↗ axe↘ (reserved)↓ hoe↙ can↖. */
  // Wheel sizing + appear/disappear animation.
  private static WHEEL_D = 54;          // circle diameter (screen px) — a touch bigger than the old 48
  private static WHEEL_OPEN_MS = 220;   // spring-out from centre (Back.easeOut) on open; the select-close plays this REVERSED
  private static WHEEL_OVERSHOOT = 3.0; // Back.easeOut overshoot — higher = more pronounced bounce
  private static WHEEL_RING: Array<{ toolId: ToolId | null; ux: number; uy: number }> = [
    { toolId: 'pickaxe', ux: 0.866, uy: -0.5 },       // 2 o'clock
    { toolId: 'axe', ux: 0.866, uy: 0.5 },            // 4 o'clock
    { toolId: null, ux: 0, uy: 1 },                   // 6 o'clock — reserved (empty)
    { toolId: 'hoe', ux: -0.866, uy: 0.5 },           // 8 o'clock
    { toolId: 'watering-can', ux: -0.866, uy: -0.5 }, // 10 o'clock
  ];

  /** Compute the tool wheel for a tapped spot: the object's tight world bbox to hug + which tools
   *  APPLY there (owned only). null = no tool works here (don't pop the wheel). */
  private toolWheelAt(wx: number, wy: number): { bbox: { wl: number; wt: number; wr: number; wb: number }; applicable: Set<ToolId> } | null {
    let bbox: { wl: number; wt: number; wr: number; wb: number } | null = null;
    const applicable = new Set<ToolId>();
    const boxOf = (r: { x: number; y: number; w: number; h: number }) => ({ wl: r.x, wt: r.y, wr: r.x + r.w, wb: r.y + r.h });
    const tk = this.treeAtPoint(wx, wy);
    const sk = this.stoneAtPoint(wx, wy);
    const fk = this.foragAtPoint(wx, wy);
    // Sprite-bounds objects first (they sit above their tile). The HOE is the harvest tool for
    // foragables / bushes / crops — so clicking grass/berries/etc pops the wheel with the hoe,
    // unified with trees→axe / stones→pickaxe (no more empty-hand direct harvest).
    if (tk) { const o = this.trees.get(tk); if (o) { applicable.add('axe'); bbox = boxOf(this.spriteWorldSolidRect(o.sprite)); } }
    else if (sk) { const o = this.bigStones.get(sk); if (o) { applicable.add('pickaxe'); bbox = boxOf(this.spriteWorldSolidRect(o.sprite)); } }
    else if (fk) { const f = this.foragables.get(fk); if (f) { if (f.stage >= (FORAGABLES[f.type]?.stages ?? 1)) applicable.add('hoe'); bbox = boxOf(this.spriteWorldSolidRect(f.sprite)); } }
    else {
      const tile = this.islandLayer?.getTileAtWorldXY(wx, wy);
      if (tile && !tile.collides) {
        const key = `${tile.x},${tile.y}`;
        const bush = this.bushes.get(key);
        const crop = this.crops.get(key);
        if (bush) { if (bush.stage >= 2) applicable.add('hoe'); bbox = boxOf(this.spriteWorldSolidRect(bush.base)); } // ripe bush → pick with the hoe
        else if (crop) { if (crop.stage >= CROPS[crop.name].stages - 1) applicable.add('hoe'); else applicable.add('watering-can'); bbox = boxOf(this.spriteWorldSolidRect(crop.sprite)); } // mature → harvest, growing → water
        else if (this.tilledCells.has(key)) { applicable.add('hoe'); applicable.add('watering-can'); const w = this.islandLayer!.tileToWorldXY(tile.x, tile.y)!; bbox = { wl: w.x, wt: w.y, wr: w.x + TILE, wb: w.y + TILE }; } // un-till, and water
        else { if (!this.cellBlocksTill(key) && !this.isDefaultHouseCell(key)) applicable.add('hoe'); const w = this.islandLayer!.tileToWorldXY(tile.x, tile.y)!; bbox = { wl: w.x, wt: w.y, wr: w.x + TILE, wb: w.y + TILE }; } // bare grass → till (any walkable tile anchors a wheel so Tab can cancel)
      }
    }
    if (!bbox) return null;
    const owned = new Set([...applicable].filter((tid) => this.findOwnedTool(tid) !== null));
    return { bbox, applicable: owned }; // applicable may be empty (Tab still opens it so you can cancel)
  }

  /** Open the radial tool wheel at a tapped spot. `force` (Tab / the tool-HUD button) opens it even
   *  with no applicable tool here — so you can switch/cancel anytime, even holding a tool; a plain
   *  empty-hand CLICK only opens when at least one tool applies (else it falls through). */
  private openToolWheelAt(wx: number, wy: number, force = false): boolean {
    const w = this.toolWheelAt(wx, wy);
    if (!w || (!force && w.applicable.size === 0)) return false;
    this.toolPaletteOpen = w;
    this.toolPaletteHover = -2;
    this.wheelOpenAt = this.time.now; // start the spring-out
    this.wheelClose = null;
    playSfx(this);
    this.publishToolPalette();
    return true;
  }

  /** Instant close (forced dismissals — a modal opened, hotbar pick, etc.). For user-initiated
   *  select/cancel use `beginCloseWheel` so it plays the pop-and-shrink exit. */
  private closeToolPalette(): void {
    if (!this.toolPaletteOpen) return;
    this.toolPaletteOpen = null;
    this.toolPaletteHover = -2;
    this.wheelClose = null;
    this.registry.set('toolPalette', { visible: false, buttons: [] });
    this.registry.set('toolPaletteBounds', []);
  }

  /** Start the animated exit on a TOOL-SELECT — plays the open spring in reverse (retract inward +
   *  shrink away). Cancel/miss/forced dismissals use `closeToolPalette` (instant, no animation).
   *  `publishToolPalette` advances the tween each frame + finalizes when done. */
  private beginCloseWheel(chosen: number): void {
    if (!this.toolPaletteOpen || this.wheelClose) return;
    this.wheelClose = { at: this.time.now, chosen };
  }

  /** Project the wheel to screen each frame: 4 tool circles hugging the object's pixel-bbox EDGES
   *  (up/down/left/right) + a centre close circle; only applicable+owned tools get an icon. */
  private publishToolPalette(): void {
    const pal = this.toolPaletteOpen;
    if (!pal) return;

    // --- Appear / disappear tween (uniform across the wheel). `f` = radial position factor (0 = at
    //     the centre, 1 = at rest, >1 = popped outward); `s` = circle size factor. Icons follow
    //     because HoverScene scales each icon by the button `size` and draws it at the button pos.
    //     OPEN = spring out from the centre (Back.easeOut). SELECT-CLOSE = that SAME spring played in
    //     REVERSE (retract inward + shrink away). Cancel/miss don't animate (they call
    //     closeToolPalette directly), so a live `wheelClose` here always means a tool was picked. ---
    const spring = (p: number) => Phaser.Math.Easing.Back.Out(Phaser.Math.Clamp(p, 0, 1), GameScene.WHEEL_OVERSHOOT);
    let f = 1, s = 1;
    const now = this.time.now;
    if (this.wheelClose) {
      const e = now - this.wheelClose.at;
      if (e >= GameScene.WHEEL_OPEN_MS) { this.closeToolPalette(); return; } // exit finished → clear + stop
      const be = spring(1 - e / GameScene.WHEEL_OPEN_MS); // reverse of the open curve: 1 → 0
      f = be; s = be;
    } else {
      const e = now - this.wheelOpenAt;
      if (e < GameScene.WHEEL_OPEN_MS) { const be = spring(e / GameScene.WHEEL_OPEN_MS); f = be; s = be; } // spring out from centre
    }

    const cam = this.cameras.main, z = cam.zoom;
    const D = GameScene.WHEEL_D * s; // animated circle diameter
    const GAP = 6;
    const sl = (pal.bbox.wl - cam.worldView.x) * z, sr = (pal.bbox.wr - cam.worldView.x) * z;
    const st = (pal.bbox.wt - cam.worldView.y) * z, sb = (pal.bbox.wb - cam.worldView.y) * z;
    const cx = (sl + sr) / 2, cy = (st + sb) / 2;
    const R = (Math.max((sr - sl) / 2, (sb - st) / 2, 18) + GameScene.WHEEL_D / 2 + GAP) * f; // ring radius (animated)
    const buttons: Array<{ x: number; y: number; size: number; iconKey: string; iconFrame: string | number; kind: string; hovered: boolean }> = [];
    const bounds: Array<{ x: number; y: number; r: number; idx: number }> = [];
    // Hit-boxes use the RESTING geometry (WHEEL_D / full R) so a fast tap mid-anim still lands; the
    // rendered buttons use the animated D / R. Bounds are ignored anyway once `wheelClose` is set.
    const RB = Math.max((sr - sl) / 2, (sb - st) / 2, 18) + GameScene.WHEEL_D / 2 + GAP;
    // Cancel (mouse) at the TOP of the ring (12 o'clock); the tools sit around it, evenly spaced.
    buttons.push({ x: cx, y: cy - R, size: D, iconKey: 'cursor', iconFrame: 0, kind: 'close', hovered: this.toolPaletteHover === -1 });
    bounds.push({ x: cx, y: cy - RB, r: GameScene.WHEEL_D / 2, idx: -1 });
    GameScene.WHEEL_RING.forEach((slot, i) => {
      const x = cx + slot.ux * R, y = cy + slot.uy * R;
      const owned = slot.toolId !== null && this.findOwnedTool(slot.toolId) !== null;
      const active = owned && pal.applicable.has(slot.toolId!);
      const kind = !owned ? 'empty' : active ? 'tool' : 'disabled'; // empty = reserved/unowned → just the circle base
      const ic = owned ? this.toolIcon(slot.toolId!) : { key: '', frame: 0 };
      buttons.push({ x, y, size: D, iconKey: ic.key, iconFrame: ic.frame, kind, hovered: active && this.toolPaletteHover === i });
      if (active) bounds.push({ x: cx + slot.ux * RB, y: cy + slot.uy * RB, r: GameScene.WHEEL_D / 2, idx: i }); // only ENABLED circles are tappable
    });
    this.registry.set('toolPalette', { visible: true, buttons });
    this.registry.set('toolPaletteBounds', bounds);
  }

  /** Which wheel circle is the cursor over (idx, -1=close, -2=none) → tint highlight. */
  private updateToolPaletteHover(): void {
    if (!this.toolPaletteOpen) return;
    const sx = this.locked ? this.vcursor.x : this.input.activePointer.x;
    const sy = this.locked ? this.vcursor.y : this.input.activePointer.y;
    const bounds = this.registry.get('toolPaletteBounds') as Array<{ x: number; y: number; r: number; idx: number }> | undefined;
    let hov = -2;
    for (const b of bounds ?? []) { if ((sx - b.x) ** 2 + (sy - b.y) ** 2 <= b.r * b.r) { hov = b.idx; break; } }
    if (hov !== this.toolPaletteHover) { this.toolPaletteHover = hov; this.publishToolPalette(); }
  }

  /** Route a click while the wheel is open: an applicable tool circle → equip it (from wherever
   *  owned) + keep using it; the top mouse circle → CANCEL (empty hand); a miss → dismiss. */
  private handleToolPaletteClick(x: number, y: number): boolean {
    const pal = this.toolPaletteOpen;
    if (!pal) return false;
    if (this.wheelClose) return true; // already playing its exit — swallow further clicks
    const bounds = this.registry.get('toolPaletteBounds') as Array<{ x: number; y: number; r: number; idx: number }> | undefined;
    const hit = bounds?.find((b) => (x - b.x) ** 2 + (y - b.y) ** 2 <= b.r * b.r);
    if (hit && hit.idx >= 0) {
      const loc = this.findOwnedTool(GameScene.WHEEL_RING[hit.idx]!.toolId!)!;
      if ('hotbar' in loc) { this.heldExternal = null; this.hotbarSelected = loc.hotbar; this.equipSelected(); this.publishInventory(); }
      else this.holdExternal(loc.store, loc.item);
      // Snap the cursor back onto the ITEM the wheel opened on, so the newly-picked tool is ready
      // to use right there (else it'd sit off at the tool circle's ring position). Mouse-locked only.
      if (this.locked) this.snapCursorToWorld((pal.bbox.wl + pal.bbox.wr) / 2, (pal.bbox.wt + pal.bbox.wb) / 2);
      this.beginCloseWheel(hit.idx); // tool picked → play the open anim in reverse (retract + shrink)
    } else if (hit && hit.idx === -1) {
      this.clearHeld(); // the mouse circle = cancel → drop the held tool, empty hand
      this.closeToolPalette(); // no tool picked → no exit animation, just vanish
    } else {
      this.closeToolPalette(); // miss → dismiss instantly (no animation)
    }
    return true;
  }

  // ── Tool HUD (current-tool indicator under the weather + tap-to-fly-out switcher) ──────
  private static HUD_X = 16;  private static HUD_Y = 100; private static HUD_SLOT = 42; private static HUD_GAP = 6;

  /** The row items for the fly-out: a mouse (cancel) + every OWNED tool, left→right. */
  private toolHudItems(): Array<{ key: string; frame: string | number; toolId: ToolId | null }> {
    const items: Array<{ key: string; frame: string | number; toolId: ToolId | null }> = [{ key: 'cursor', frame: 0, toolId: null }];
    for (const slot of GameScene.WHEEL_RING) {
      if (slot.toolId && this.findOwnedTool(slot.toolId)) { const ic = this.toolIcon(slot.toolId); items.push({ key: ic.key, frame: ic.frame, toolId: slot.toolId }); }
    }
    return items;
  }

  /** Publish the tool-HUD model + tap hit-boxes (called on load + whenever the held item changes). */
  private publishToolHud(): void {
    const S = GameScene.HUD_SLOT, G = GameScene.HUD_GAP, HX = GameScene.HUD_X, HY = GameScene.HUD_Y;
    const held = this.heldCell();
    const cur = held?.toolId ? this.toolIcon(held.toolId) : { key: 'cursor', frame: 0 };
    const items = this.toolHudItems();
    const rendered = items.map((it, i) => ({ x: HX + S / 2 + (i + 1) * (S + G), y: HY + S / 2, key: it.key, frame: it.frame, selected: it.toolId === (held?.toolId ?? null) }));
    const hidden = !this.gameReady || this.cutscene || (this.dialogOpen && !this.cutscene) || this.menuOpen || this.craftOpen || this.inventoryOpen;
    if (hidden && this.toolHudExpanded) { this.toolHudExpanded = false; } // collapse the fly-out when hidden
    this.registry.set('toolHud', {
      visible: !hidden,
      slot: S, hx: HX + S / 2, hy: HY + S / 2,
      currentKey: cur.key, currentFrame: cur.frame,
      expanded: this.toolHudExpanded, items: rendered,
    });
    const bounds: Array<{ x: number; y: number; w: number; h: number; action: string; idx: number }> = [{ x: HX, y: HY, w: S, h: S, action: 'toggle', idx: -1 }];
    if (this.toolHudExpanded) items.forEach((_it, i) => bounds.push({ x: HX + (i + 1) * (S + G), y: HY, w: S, h: S, action: 'pick', idx: i }));
    this.registry.set('toolHudBounds', bounds);
  }

  private toggleToolHud(): void {
    this.toolHudExpanded = !this.toolHudExpanded;
    playSfx(this);
    this.publishToolHud();
  }

  /** Route a click on the tool-HUD: the slot toggles the fly-out; a row item equips that tool (or
   *  the mouse = cancel) + collapses. Returns true if it consumed the click. */
  private handleToolHudClick(x: number, y: number): boolean {
    const bounds = this.registry.get('toolHudBounds') as Array<{ x: number; y: number; w: number; h: number; action: string; idx: number }> | undefined;
    if (!bounds) return false;
    const hit = bounds.find((b) => x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h);
    if (!hit) { if (this.toolHudExpanded) { this.toolHudExpanded = false; this.publishToolHud(); return true; } return false; }
    if (hit.action === 'toggle') { this.toggleToolHud(); return true; }
    // pick: equip the row item (or cancel), collapse.
    const it = this.toolHudItems()[hit.idx];
    if (it?.toolId) { const loc = this.findOwnedTool(it.toolId); if (loc) { if ('hotbar' in loc) { this.heldExternal = null; this.hotbarSelected = loc.hotbar; this.equipSelected(); this.publishInventory(); } else this.holdExternal(loc.store, loc.item); } }
    else this.clearHeld(); // the mouse item = empty hand
    this.toolHudExpanded = false;
    this.publishToolHud();
    playSfx(this);
    return true;
  }

  // ── House building: placement cursor + rotate ─────────────────────────

  private ensurePlacePreview(): Phaser.GameObjects.Sprite {
    if (!this.placePreview) {
      this.placePreview = this.add.sprite(0, 0, 'house-walls', 0).setOrigin(0.5, 1).setDepth(1e6 - 2);
    }
    return this.placePreview;
  }
  private hidePlacePreview(): void { this.placePreview?.setVisible(false); this.placeCell = null; }

  /** Texture + frame for a placeable of `kind` (walls use the palette-chosen
   *  `wallOrient`; furniture the selected piece `activeFurn`). */
  private placeAppearance(kind: PlaceKind): { texture: string; frame: string | number } {
    if (kind === 'wall') return { texture: 'house-walls', frame: WALL_FRAME[this.wallOrient] };
    if (kind === 'floor') return { texture: 'house-walls', frame: FLOOR_FRAME };
    if (kind === 'window') return { texture: 'house-walls', frame: WINDOW_FRAME };
    if (kind === 'door') return { texture: 'door', frame: DOOR_CLOSED_FRAME };
    if (kind === 'tree') return { texture: `tree-${this.activeTreeType}`, frame: 0 };
    if (kind === 'bush') return { texture: 'bushes', frame: 'empty-bush-small' };
    return { texture: 'furniture', frame: (FURN_BY_ID.get(this.activeFurn) ?? FURNITURE[0]!).frame };
  }

  /** Can a building piece go on this cell? On-island grass, not on farm tiles (crop
   *  / tilled soil), not under Cato. An EXISTING placed piece is allowed — placing
   *  OVER it replaces it (the old one is refunded, so fixing a mis-placement is free). */
  private canPlaceAt(cx: number, cy: number): boolean {
    if (!this.islandLayer) return false;
    const w = this.islandLayer.tileToWorldXY(cx, cy);
    if (!w) return false;
    if (!this.islandLayer.getTileAtWorldXY(w.x + TILE / 2, w.y + TILE / 2)) return false; // off-island / water
    const key = `${cx},${cy}`;
    if (this.crops.has(key) || this.tilledCells.has(key)) return false; // farm tile — not buildable
    if (this.child) {
      const ct = this.islandLayer.worldToTileXY(this.child.x, this.child.y);
      if (ct && Math.floor(ct.x) === cx && Math.floor(ct.y) === cy) return false; // don't build on Cato
    }
    return true;
  }

  /** Is the currently-held material the FLOOR item? Floors are a ground layer that
   *  can overlap walls, so they have their own placement rules. */
  private isPlacingFloor(): boolean {
    return this.activePlace === 'floor';
  }

  /** Can a FLOOR tile go on this cell? On-island, no floor there yet, and not on a
   *  crop or tilled soil — but it CAN overlap a wall/door/furniture (it tucks under
   *  as a ground layer), which is how the floor meets/overlaps the walls seamlessly. */
  private canPlaceFloor(cx: number, cy: number): boolean {
    if (!this.islandLayer) return false;
    const w = this.islandLayer.tileToWorldXY(cx, cy);
    if (!w) return false;
    if (!this.islandLayer.getTileAtWorldXY(w.x + TILE / 2, w.y + TILE / 2)) return false; // off-island / water
    const key = `${cx},${cy}`;
    return !this.floors.has(key) && !this.crops.has(key) && !this.tilledCells.has(key);
  }

  /** Update the tile bracket + build ghost to the cell under the cursor (valid =
   *  clear bracket + white ghost, else gray bracket + red ghost). */
  private updatePlacePreview(): void {
    const cursor = this.tileCursor;
    if (!this.islandLayer || !this.activePlace || !cursor) { cursor?.setVisible(false); this.hidePlacePreview(); return; }
    const wp = this.cameras.main.getWorldPoint(this.vcursor.x, this.vcursor.y);
    const tile = this.islandLayer.getTileAtWorldXY(wp.x, wp.y);
    if (!tile) { cursor.setVisible(false); this.hidePlacePreview(); return; }
    const cx = tile.x, cy = tile.y;
    const w = this.islandLayer.tileToWorldXY(cx, cy)!;
    const valid = this.activePlace === 'tree' ? this.canPlaceTree(cx, cy)
      : this.activePlace === 'bush' ? this.canPlaceBush(cx, cy)
      : this.isPlacingFloor() ? this.canPlaceFloor(cx, cy)
      : this.canPlaceAt(cx, cy);
    // The rounded tile bracket (圆角框), snapped to the cell centre — same as the tools.
    cursor.setPosition(w.x + TILE / 2, w.y + TILE / 2).setVisible(true);
    if (valid) cursor.setAlpha(1).clearTint();
    else cursor.setAlpha(0.55).setTint(0xbbbbbb);
    // The object ghost inside the bracket.
    const look = this.placeAppearance(this.activePlace);
    const ghost = this.ensurePlacePreview();
    ghost.setTexture(look.texture, look.frame).setVisible(true);
    ghost.setPosition(w.x + TILE / 2, w.y + TILE); // origin bottom → sits in the cell
    ghost.setAlpha(0.55).setTint(valid ? 0xffffff : 0xff6666);
    this.placeCell = valid ? { cx, cy } : null;
  }

  /** R (optional keyboard shortcut) cycles the wall facing used for the hover
   *  preview / default. The main way to choose is the contextual build palette. */
  private rotatePlaceable(): void {
    if (this.dialogOpen || this.inventoryOpen || this.activePlace !== 'wall') return;
    this.setWallOrient(WALL_ORIENTS[(WALL_ORIENTS.indexOf(this.wallOrient) + 1) % WALL_ORIENTS.length]!);
  }

  /** Set the wall facing (last-used / default) + reflect it on the held item icon. */
  private setWallOrient(orient: WallOrient): void {
    this.wallOrient = orient;
    const cell = this.heldCell();
    if (cell?.place === 'wall') { cell.iconFrame = WALL_FRAME[orient]; this.publishInventory(); }
  }

  // The cell awaiting a wall-orientation choice (non-null = the contextual palette
  // is open, floating around that cell).
  private buildPaletteCell: { cx: number; cy: number } | null = null;
  private buildPaletteRev = 0;

  /** Open the contextual 3×3 wall palette AROUND a clicked cell — the player taps an
   *  orientation to place the wall there (or taps away to cancel). */
  private openWallPalette(cx: number, cy: number): void {
    if (!this.islandLayer) return;
    const cam = this.cameras.main;
    const w = this.islandLayer.tileToWorldXY(cx, cy)!;
    // world → screen: use worldView (correct under center-zoom; scrollX is not).
    const screenX = (w.x + TILE / 2 - cam.worldView.x) * cam.zoom;
    const screenY = (w.y + TILE / 2 - cam.worldView.y) * cam.zoom;
    this.buildPaletteCell = { cx, cy };
    this.publishBuildPalette(screenX, screenY);
  }

  private closeWallPalette(chosen?: number): void {
    if (!this.buildPaletteCell) return;
    this.buildPaletteCell = null;
    this.publishBuildPalette(0, 0, chosen);
  }

  private publishBuildPalette(screenX = 0, screenY = 0, chosen?: number): void {
    // The CENTRE cell shows the DEFAULT / last-used facing (in the 圆角框) so a tap
    // there places it straight away; the 8 ring cells are the alternative facings.
    const cells = WALL_PALETTE.map((o, i) =>
      i === 4
        ? { orient: this.wallOrient, iconKey: 'house-walls', frame: WALL_FRAME[this.wallOrient], center: true }
        : (o ? { orient: o, iconKey: 'house-walls', frame: WALL_FRAME[o] } : null),
    );
    // The centre 圆角框 keeps the SAME on-screen size as the hover bracket (24px tile
    // frame at world scale) so it doesn't visibly shrink when the palette opens; the
    // ring cells spread out around it (PaletteScene sizes RING from this).
    const bracketPx = 24 * this.cameras.main.zoom;
    this.registry.set('buildPalette', {
      visible: !!this.buildPaletteCell, screenX, screenY, selected: this.wallOrient, cells, bracketPx,
      chosen, rev: ++this.buildPaletteRev,
    });
  }

  /** While the palette is open, a tap either picks an orientation (→ place the wall
   *  at the pending cell) or misses (→ cancel). Consumes the tap either way. On a
   *  pick we pass the chosen cell index so the palette can flash it before closing. */
  private handlePaletteClick(x: number, y: number): boolean {
    if (!this.buildPaletteCell) return false;
    const bounds = this.registry.get('buildPaletteBounds') as
      | Array<{ orient: string; idx: number; x: number; y: number; w: number; h: number }>
      | undefined;
    const hit = bounds?.find((b) => x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h);
    const cell = this.buildPaletteCell;
    this.closeWallPalette(hit?.idx);
    if (hit && cell) {
      this.setWallOrient(hit.orient as WallOrient); // remember as the default facing
      if (this.canPlaceAt(cell.cx, cell.cy)) this.placeObject(cell.cx, cell.cy);
      // The tap landed on a RING cell (offset from the build spot), so the virtual
      // cursor is now over the ring — snap it back onto the cell we just built on so
      // the bracket stays there and the next placement continues from the same tile.
      this.snapCursorToCell(cell.cx, cell.cy);
    }
    return true;
  }

  // ── Modal confirm dialog (e.g. demolish a house piece) ─────────────────────
  private confirmOpen = false;
  private confirmRev = 0;
  private pendingConfirm?: () => void;

  /** Pop a modal yes/no dialog (ConfirmScene renders it). `onOk` runs on confirm. */
  private promptConfirm(title: string, onOk: () => void): void {
    this.pendingConfirm = onOk;
    this.confirmOpen = true;
    this.registry.set('confirm', { visible: true, title, rev: ++this.confirmRev });
  }

  private closeConfirm(): void {
    if (!this.confirmOpen) return;
    this.confirmOpen = false;
    this.pendingConfirm = undefined;
    this.registry.set('confirm', { visible: false, title: '', rev: ++this.confirmRev });
  }

  /** Modal: while the confirm dialog is open, a tap hits ✓ (run + close), ⊘ / outside
   *  (just close). Consumes the tap either way so nothing behind it fires. */
  private handleConfirmClick(x: number, y: number): boolean {
    if (!this.confirmOpen) return false;
    const bounds = this.registry.get('confirmBounds') as
      | Array<{ action: string; x: number; y: number; w: number; h: number }>
      | undefined;
    const hit = bounds?.find((b) => x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h);
    const ok = hit?.action === 'ok';
    const run = ok ? this.pendingConfirm : undefined;
    this.closeConfirm();
    run?.();
    return true;
  }

  private lastHoverIdx = -1;

  /** Publish which palette cell the cursor is over (or -1) so PaletteScene can hover
   *  it — highlight its button + preview that facing in the centre bracket. */
  private updatePaletteHover(): void {
    const open = !!this.buildPaletteCell;
    let idx = -1;
    if (open) {
      const bounds = this.registry.get('buildPaletteBounds') as
        | Array<{ idx: number; x: number; y: number; w: number; h: number }>
        | undefined;
      const x = this.vcursor.x, y = this.vcursor.y;
      const hit = bounds?.find((b) => x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h);
      idx = hit ? hit.idx : -1;
    }
    if (idx !== this.lastHoverIdx) {
      this.lastHoverIdx = idx;
      this.registry.set('buildPaletteHover', idx);
    }
  }

  /** Move the virtual (pointer-locked) cursor to a cell's on-screen centre. Used
   *  after a ring-cell tap so the cursor returns to the build spot, not the ring. */
  private snapCursorToCell(cx: number, cy: number): void {
    if (!this.islandLayer) return;
    const cam = this.cameras.main;
    const w = this.islandLayer.tileToWorldXY(cx, cy);
    if (!w) return;
    this.vcursor.x = Phaser.Math.Clamp((w.x + TILE / 2 - cam.worldView.x) * cam.zoom, 0, cam.width);
    this.vcursor.y = Phaser.Math.Clamp((w.y + TILE / 2 - cam.worldView.y) * cam.zoom, 0, cam.height);
  }

  /** Move the virtual cursor to a WORLD point (screen-projected + clamped). Mouse-locked only. */
  private snapCursorToWorld(wx: number, wy: number): void {
    const cam = this.cameras.main;
    this.vcursor.x = Phaser.Math.Clamp((wx - cam.worldView.x) * cam.zoom, 0, cam.width);
    this.vcursor.y = Phaser.Math.Clamp((wy - cam.worldView.y) * cam.zoom, 0, cam.height);
  }

  /** Place the held building material at a cell (assumes canPlaceAt is true).
   *  Creates the sprite (+ a solid collider for walls/doors), consumes 1 from the
   *  held stack, re-autotiles neighbour walls, and saves. */
  private placeObject(cx: number, cy: number): void {
    if (!this.islandLayer || !this.activePlace) return;
    const cell = this.heldCell();
    if (!cell || cell.count <= 0) return;
    const kind = this.activePlace;
    const key = `${cx},${cy}`;
    // OVERWRITE: replacing an existing piece refunds it first (so a swap costs nothing
    // net; fixing a mis-placement is free). removeObject saves/publishes; we place after.
    if (this.placed.has(key)) this.removeObject(cx, cy);
    const w = this.islandLayer.tileToWorldXY(cx, cy)!;
    const footX = w.x + TILE / 2;
    const footY = w.y + TILE; // origin bottom sits the tile in its cell
    const orient: WallOrient = this.wallOrient; // stored for walls; ignored otherwise
    const variant = kind === 'furniture' ? this.activeFurn : undefined;
    const look = this.placeAppearance(kind);
    const sprite = this.add.sprite(footX, footY, look.texture, look.frame).setOrigin(0.5, 1).setDepth(footY);
    const obj: PlacedObj = { kind, variant, orient, frame: look.frame, sprite };
    // Walls + windows are solid (block Cato); door is solid-until-open; furniture is decorative.
    if (kind === 'wall' || kind === 'window') obj.bodies = this.addSolid(cx, cy, look.texture, look.frame);
    else if (kind === 'door') { obj.open = false; obj.bodies = this.addSolid(cx, cy, look.texture, look.frame); }
    this.placed.set(key, obj);
    this.consumeHeldMaterial();
    this.scheduleSave();
  }

  /** Place a FLOOR tile — a non-solid brick/window tile stored in the `floors`
   *  ground layer (`FLOOR_DEPTH`, below Cato/walls). It can overlap a wall, so the
   *  wall draws over its opaque parts while its transparent edges reveal the brick —
   *  the floor tucks under the wall seamlessly (no grass gap). */
  private placeFloor(cx: number, cy: number): void {
    if (!this.islandLayer) return;
    const cell = this.heldCell();
    if (!cell || cell.count <= 0) return;
    const key = `${cx},${cy}`;
    // OVERWRITE: a floor dropped on a mis-placed component (wall/window/door/furniture)
    // removes it (refunded) and leaves just the floor — same "fix a mistake" convenience
    // as the components have. (So the seamless floor-UNDER-wall look now needs the floor
    // laid FIRST, then walls placed over it — wall-over-floor still coexists.)
    if (this.placed.has(key)) this.removeObject(cx, cy);
    this.restoreFloor(key, FLOOR_FRAME);
    this.consumeHeldMaterial();
    this.scheduleSave();
  }

  /** (Re)create a floor tile sprite at a cell → the `floors` map. Used by placeFloor,
   *  save restore, and the debug builder. */
  private restoreFloor(key: string, frame: number): void {
    if (!this.islandLayer) return;
    const [cx, cy] = key.split(',').map(Number);
    const w = this.islandLayer.tileToWorldXY(cx!, cy!);
    if (!w) return;
    this.floors.get(key)?.sprite.destroy();
    const sprite = this.add.sprite(w.x + TILE / 2, w.y + TILE, 'house-walls', frame).setOrigin(0.5, 1).setDepth(FLOOR_DEPTH);
    this.floors.set(key, { sprite, frame });
  }

  /** Consume one of the held building material; drop out of placement mode if the
   *  stack empties. */
  private consumeHeldMaterial(): void {
    const ext = this.heldExternal;
    const cell = this.heldCell();
    if (!cell) return;
    cell.count -= 1;
    if (cell.count <= 0) {
      if (ext) {
        // A chest / Cato-bag seed selected via "使用" emptied → drop it from that store + hand.
        const i = ext.store.indexOf(ext.item);
        if (i >= 0) ext.store.splice(i, 1);
        this.heldExternal = null;
        if (this.menuOpen) this.publishMenu(); // reflect the emptied stack in the open modal
      } else if (this.hotbarSelected >= 0) {
        this.inventory[this.hotbarSelected] = null;
      }
    }
    this.equipSelected();
    this.publishInventory();
  }

  /** Pick a placed piece back up (destroy it + refund the material). */
  private removeObject(cx: number, cy: number): void {
    const key = `${cx},${cy}`;
    const o = this.placed.get(key);
    if (!o) return;
    o.sprite.destroy();
    o.bodies?.forEach((b) => b.destroy());
    this.placed.delete(key);
    this.placedHoedOnce.get(key)?.remove();
    this.placedHoedOnce.delete(key);
    const id = o.kind === 'wall' ? 'wall' : o.kind === 'window' ? 'window' : o.kind === 'door' ? 'door-item' : `furn-${o.variant}`;
    this.addToHotbarOrChest(itemFromId(id, 1));
    this.publishInventory();
    this.scheduleSave();
  }

  // ── Trees: place → chop (shake combo) → drop fruit / fell ──────────────────

  private canPlaceTree(cx: number, cy: number): boolean {
    if (!this.islandLayer) return false;
    const w = this.islandLayer.tileToWorldXY(cx, cy);
    if (!w) return false;
    if (!this.islandLayer.getTileAtWorldXY(w.x + TILE / 2, w.y + TILE / 2)) return false; // water / off-island
    const key = `${cx},${cy}`;
    if (this.trees.has(key) || this.crops.has(key) || this.tilledCells.has(key) || this.placed.has(key)) return false;
    if (this.child) {
      const ct = this.islandLayer.worldToTileXY(this.child.x, this.child.y);
      if (ct && Math.floor(ct.x) === cx && Math.floor(ct.y) === cy) return false; // not on Cato
    }
    return true;
  }

  /** Place a full-grown tree at a cell (from the held tree item) + consume one. */
  private placeTree(cx: number, cy: number, type: TreeType): void {
    const cell = this.heldCell();
    if (!cell || cell.count <= 0) return;
    this.restoreTree(`${cx},${cy}`, type, TREE_BY_ID.get(type)?.fruit ?? false);
    this.consumeHeldMaterial();
    this.scheduleSave();
  }

  /** (Re)create a tree sprite (+ a small trunk collider) at a cell → the `trees`
   *  map. Used by placeTree + save restore. */
  private restoreTree(key: string, type: TreeType, hasFruit: boolean): void {
    if (!this.islandLayer) return;
    const [cx, cy] = key.split(',').map(Number);
    const w = this.islandLayer.tileToWorldXY(cx!, cy!);
    if (!w) return;
    this.removeTree(cx!, cy!); // clear any existing tree at this cell first
    const footX = w.x + TILE / 2, footY = w.y + TILE;
    const sprite = this.add.sprite(footX, footY, `tree-${type}`, 0).setOrigin(0.5, 1).setDepth(footY);
    this.ySortSprites.push(sprite); // y-sorted by foot → Cato passes in front / behind
    // Small invisible trunk collider (the canopy stays passable) so Cato bumps trunks.
    let body: Phaser.GameObjects.Sprite | undefined;
    if (this.wallGroup) {
      const b = this.wallGroup.create(footX, footY - 3, '__WHITE') as Phaser.Physics.Arcade.Sprite;
      b.setVisible(false).setDisplaySize(10, 6).refreshBody();
      body = b;
    }
    this.trees.set(key, { type, hasFruit, sprite, body, stage: 0, busy: false });
  }

  /** Wire the trees placed in the visual EDITOR (scene-data sprites) into the live
   *  tree system — collision + chop + fruit — so they behave exactly like planted
   *  trees. Each editor tree's render sprite is replaced by a real `restoreTree`
   *  at its cell (the runtime uses the `tree-<type>` texture + shake/fall anims,
   *  which the raw manifest sprite doesn't have). Fruit trees (apple/pear/peach)
   *  start bearing fruit; plain trees don't. (Same as planted trees — there's no
   *  regrow yet, for either.) */
  private wireSceneTrees(): void {
    const reg = getEntityRegistry(this);
    const layer = this.islandLayer;
    if (!reg || !layer) return;
    const ASSET_TYPE: Record<string, TreeType> = {
      tree_sprites: 'plain',
      tree_apple_sprites: 'apple',
      tree_pear_sprites: 'pear',
      tree_peach_sprites: 'peach',
    };
    const editorTrees = reg.all().filter(
      (go) => !!ASSET_TYPE[(go.getData('entityAssetId') as string) ?? ''],
    ) as Phaser.GameObjects.Sprite[];
    if (!editorTrees.length) return;
    // Drop the editor render sprites from the y-sort list before replacing them.
    const drop = new Set(editorTrees);
    this.ySortSprites = this.ySortSprites.filter((g) => !drop.has(g));
    for (const s of editorTrees) {
      const type = ASSET_TYPE[(s.getData('entityAssetId') as string) ?? '']!;
      const b = s.getBounds();
      const foot = layer.worldToTileXY((b.left + b.right) / 2, b.bottom - 2); // trunk cell from the sprite's foot
      s.destroy();
      if (!foot) continue;
      const key = `${Math.floor(foot.x)},${Math.floor(foot.y)}`;
      if (this.trees.has(key)) continue; // one tree per cell — keep the first
      this.restoreTree(key, type, TREE_BY_ID.get(type)?.fruit ?? false);
      const t = this.trees.get(key);
      if (t) t.sceneWired = true; // mark: comes from the scene, not the save
    }
  }

  /** Wire the berry bushes placed in the visual EDITOR (`trees_stumps_and_bushes`
   *  sprites) into the live bush system — so they grow, bear berries, are harvestable,
   *  AND block tilling. `bush-with-<berry>` → that berry, ripe now (stage 2);
   *  `empty-bush`/`empty-bush-small` → a deterministic berry, growing (stage 1/0). Like
   *  `wireSceneTrees`, the editor sprite is replaced by a real `restoreBush` and marked
   *  `sceneWired` (excluded from the save; re-derived from the scene each load). */
  private wireSceneBushes(): void {
    const reg = getEntityRegistry(this);
    const layer = this.islandLayer;
    if (!reg || !layer) return;
    const editorBushes = reg.all().filter(
      (go) => (go.getData('entityAssetId') as string) === 'trees_stumps_and_bushes',
    ) as Phaser.GameObjects.Sprite[];
    if (!editorBushes.length) return;
    const drop = new Set(editorBushes);
    this.ySortSprites = this.ySortSprites.filter((g) => !drop.has(g));
    for (const s of editorBushes) {
      const frame = String(s.frame?.name ?? '');
      const b = s.getBounds();
      const foot = layer.worldToTileXY((b.left + b.right) / 2, b.bottom - 2);
      s.destroy();
      if (!foot) continue;
      const cx = Math.floor(foot.x), cy = Math.floor(foot.y);
      const key = `${cx},${cy}`;
      if (this.bushes.has(key)) continue;
      // `bush-with-<berry>` names the berry + is ripe; an empty bush gets a stable
      // berry (cell-hashed) and starts growing (empty → will ripen).
      const named = BERRY_TYPES.find((t) => frame.includes(t));
      const type = named ?? BERRY_TYPES[(Math.abs(cx * 7 + cy * 13)) % BERRY_TYPES.length]!;
      const stage = named ? 2 : (frame === 'empty-bush' ? 1 : 0);
      this.restoreBush(key, type, stage);
      const bush = this.bushes.get(key);
      if (bush) bush.sceneWired = true;
    }
  }

  /** Wire the mushrooms/flowers/stones placed in the visual EDITOR (the
   *  `mushrooms_flowers_stones` atlas) into the live systems: `big-stone-<tier>` →
   *  a minable big-stone WITH A COLLIDER (Cato bumps it), everything else
   *  (`<type>-<stage>`: grass / sunflower / flower / mushroom / small-stone) → a wild
   *  foragable that grows + is harvestable. Editor sprite replaced by a real
   *  restore*, marked `sceneWired` (excluded from the save; re-derived each load). */
  private wireSceneForageAndStones(): void {
    const reg = getEntityRegistry(this);
    const layer = this.islandLayer;
    if (!reg || !layer) return;
    const editor = reg.all().filter(
      (go) => (go.getData('entityAssetId') as string) === 'mushrooms_flowers_stones',
    ) as Phaser.GameObjects.Sprite[];
    if (!editor.length) return;
    const drop = new Set(editor);
    this.ySortSprites = this.ySortSprites.filter((g) => !drop.has(g));
    for (const s of editor) {
      const frame = String(s.frame?.name ?? '');
      const b = s.getBounds();
      const foot = layer.worldToTileXY((b.left + b.right) / 2, b.bottom - 2);
      s.destroy();
      if (!foot) continue;
      const key = `${Math.floor(foot.x)},${Math.floor(foot.y)}`;
      if (this.bigStones.has(key) || this.foragables.has(key)) continue;
      if (frame.startsWith('big-stone-')) {
        const tier = parseInt(frame.slice('big-stone-'.length), 10) || 1;
        this.restoreBigStone(key, tier, BIG_STONES[tier]?.readyStones ?? 0);
        const st = this.bigStones.get(key);
        if (st) st.sceneWired = true;
      } else {
        const type = FORAGABLE_NAMES.find((n) => frame.startsWith(`${n}-`));
        if (!type) continue;
        const def = FORAGABLES[type];
        const stage = Phaser.Math.Clamp(parseInt(frame.slice(type.length + 1), 10) || 1, 1, def?.stages ?? 1);
        this.restoreForagable(key, type, stage, 0);
        const f = this.foragables.get(key);
        if (f) f.sceneWired = true;
      }
    }
  }

  /** The tree whose sprite the world-point (x,y) lands on — canopy included, since
   *  the sprite spans ~3 tiles up from the trunk. Prefers the frontmost (lowest foot)
   *  when canopies overlap. Returns its "cx,cy" key or null. */
  private treeAtPoint(x: number, y: number): string | null {
    let best: string | null = null;
    let bestFoot = -Infinity;
    for (const [key, t] of this.trees) {
      if (t.sprite.active && this.spritePixelHit(t.sprite, x, y) && t.sprite.y > bestFoot) {
        best = key;
        bestFoot = t.sprite.y;
      }
    }
    return best;
  }

  /** Chop a tree with the axe: an axe swing, then advance the shake combo. */
  private chopTree(cx: number, cy: number): void {
    if (!this.islandLayer) return;
    const tree = this.trees.get(`${cx},${cy}`);
    if (!tree || tree.busy) return;
    const w = this.islandLayer.tileToWorldXY(cx, cy)!;
    this.axeSwingAt(w.x + TILE / 2, w.y + TILE / 2, () => this.onChopStrike(cx, cy));
  }

  /** One landed axe strike: play shake-1/2/3 (resets to 1 if the previous strike's
   *  2s window lapsed). The 3rd strike drops fruit (fruit tree → becomes plain) or
   *  fells a plain tree. */
  private onChopStrike(cx: number, cy: number): void {
    const key = `${cx},${cy}`;
    const tree = this.trees.get(key);
    if (!tree || tree.busy) return;
    playSfx(this, SFX_CHOP); // axe thunk (player + Cato) on each real tree strike
    tree.stage = tree.timer ? Math.min(tree.stage + 1, 3) : 1; // advance within the window, else restart
    tree.timer?.remove();
    tree.timer = this.time.delayedCall(TREE_CHOP_WINDOW_MS, () => { tree.stage = 0; tree.timer = undefined; });
    tree.sprite.off(Phaser.Animations.Events.ANIMATION_COMPLETE); // clear any prior settle/finish handler
    tree.sprite.play(`tree-${tree.type}-shake${tree.stage}`);
    if (tree.stage >= 3) {
      tree.busy = true;
      tree.timer.remove(); tree.timer = undefined;
      tree.sprite.once(Phaser.Animations.Events.ANIMATION_COMPLETE, () => {
        if (tree.hasFruit) this.harvestTree(cx, cy);
        else this.fellTree(cx, cy);
      });
    } else {
      // Settle back to idle so the tree is ready for the next strike.
      tree.sprite.once(Phaser.Animations.Events.ANIMATION_COMPLETE, () => {
        if (this.trees.get(key) === tree && !tree.busy) tree.sprite.setFrame(0);
      });
    }
  }

  /** Fruit tree, final chop: 3 fruits pop out beside it + bank to the backpack; the
   *  tree loses its fruit and becomes a plain tree (which can then be felled). */
  private harvestTree(cx: number, cy: number): void {
    const key = `${cx},${cy}`;
    const tree = this.trees.get(key);
    if (!tree || !this.islandLayer) return;
    const type = tree.type;
    if (!this.backpackHasSpaceFor(`fruit-${type}`)) { this.notifyBagFull(); return; } // full → leave the fruit on the tree
    const w = this.islandLayer.tileToWorldXY(cx, cy)!;
    // The tree's own shake sheet drops the 3 fruits to FIXED, uneven spots (measured from
    // its last frame: 1 left + 2 right of the trunk). Show the collected fruits at those
    // exact spots — where they fell — so it reads as picking up what fell, not a fresh pop.
    // Offsets are from the tree FOOT (frame 24,48 @ scale 1) — see FRUIT_DROP_OFFSETS.
    const footX = w.x + TILE / 2, footY = w.y + TILE;
    for (let i = 0; i < FRUIT_DROP_OFFSETS.length; i++) {
      const d = FRUIT_DROP_OFFSETS[i];
      this.time.delayedCall(i * 70, () => this.playFruitCollect(footX + d.dx, footY + d.dy, 'fruit-items', FRUIT_FRAME[type] ?? 0));
    }
    this.collect(makeFruit(type, 3));
    this.catoReact('love'); // Cato loves a fruit harvest
    this.catoLookAtTile(cx, cy); // ...and comes over to look
    this.publishInventory();
    tree.type = 'plain';
    tree.hasFruit = false;
    tree.stage = 0;
    tree.busy = false;
    tree.sprite.setTexture('tree-plain', 0);
    this.scheduleSave();
  }

  /** Plain tree, final chop: play the fall animation, then remove it entirely. */
  private fellTree(cx: number, cy: number): void {
    const tree = this.trees.get(`${cx},${cy}`);
    if (!tree) return;
    tree.body?.destroy(); tree.body = undefined; // coming down → stop blocking Cato
    // The fall sheet is 64px wide (standing trees are 48) with the trunk at x≈39.5,
    // so re-anchor the origin to keep the trunk base pinned to the same spot.
    tree.sprite.setOrigin(39.5 / 64, 1).setTexture('tree-fall', 0).play('tree-fall');
    tree.sprite.once(Phaser.Animations.Events.ANIMATION_COMPLETE, () => this.removeTree(cx, cy));
  }

  private removeTree(cx: number, cy: number): void {
    const key = `${cx},${cy}`;
    const tree = this.trees.get(key);
    if (!tree) return;
    const i = this.ySortSprites.indexOf(tree.sprite);
    if (i >= 0) this.ySortSprites.splice(i, 1);
    tree.sprite.destroy();
    tree.body?.destroy();
    tree.timer?.remove();
    this.trees.delete(key);
    this.scheduleSave();
  }

  /** God-hand AXE chop: the axe rears UP, holds a beat, then swings DOWN onto the
   *  tree — the `axe-swing` anim (tools frames 12–14, `[13,14,14,14,13,12]`, mirrors
   *  `hoe-swing`). The strike fires when it lands (animation complete). */
  private axeSwingAt(centerX: number, centerY: number, onStrike: () => void): void {
    const axe = this.add
      .sprite(centerX + 6, centerY - TILE / 2, 'tools', 12)
      .setScale(1.5)
      .setDepth(1e6 + 1);
    axe.play('axe-swing');
    this.hoeSwing = axe; // suppress the tile cursor while it swings
    let struck = false;
    const strike = () => {
      if (struck) return;
      struck = true;
      if (this.hoeSwing === axe) this.hoeSwing = undefined;
      axe.destroy();
      onStrike();
    };
    axe.once(Phaser.Animations.Events.ANIMATION_COMPLETE, strike);
    this.time.delayedCall(1200, strike);
  }

  // ── Berry bushes: plant → grow → harvest (3 berries) → regrow ──────────────

  private canPlaceBush(cx: number, cy: number): boolean {
    if (!this.islandLayer) return false;
    const w = this.islandLayer.tileToWorldXY(cx, cy);
    if (!w) return false;
    if (!this.islandLayer.getTileAtWorldXY(w.x + TILE / 2, w.y + TILE / 2)) return false; // water / off-island
    const key = `${cx},${cy}`;
    if (this.bushes.has(key) || this.trees.has(key) || this.crops.has(key) || this.tilledCells.has(key) || this.placed.has(key)) return false;
    if (this.child) {
      const ct = this.islandLayer.worldToTileXY(this.child.x, this.child.y);
      if (ct && Math.floor(ct.x) === cx && Math.floor(ct.y) === cy) return false; // not on Cato
    }
    return true;
  }

  /** Plant a berry bush at a cell (stage 0) from the held bush item + consume one. */
  private plantBush(cx: number, cy: number, type: BerryType): void {
    const cell = this.heldCell();
    if (!cell || cell.count <= 0) return;
    this.restoreBush(`${cx},${cy}`, type, 0);
    this.consumeHeldMaterial();
    this.scheduleSave();
  }

  /** (Re)create a bush at a cell at a given stage → the `bushes` map. Used by
   *  plantBush + save restore. */
  private restoreBush(key: string, type: BerryType, stage: number): void {
    if (!this.islandLayer) return;
    const [cx, cy] = key.split(',').map(Number);
    const w = this.islandLayer.tileToWorldXY(cx!, cy!);
    if (!w) return;
    this.removeBush(cx!, cy!); // clear any existing bush at this cell first
    const footX = w.x + TILE / 2, footY = w.y + TILE;
    const base = this.add.image(footX, footY, 'bushes', 'empty-bush-small').setOrigin(0.5, 1).setDepth(footY);
    const bush: BushObj = { type, stage: 0, timer: 0, base, berries: [] };
    this.bushes.set(key, bush);
    this.setBushStage(bush, stage);
  }

  /** Apply a grow stage: swap the base frame (0=small, 1/2=full) and add/remove the
   *  3 berry overlays (only at stage 2). */
  private setBushStage(bush: BushObj, stage: number): void {
    bush.stage = stage;
    bush.timer = 0;
    bush.base.setFrame(stage === 0 ? 'empty-bush-small' : 'empty-bush');
    // Berries only at stage 2.
    for (const b of bush.berries) { this.tweens.killTweensOf(b); b.destroy(); } // kill sway first (harvest removes berries mid-sway)
    bush.berries = [];
    if (stage >= 2) {
      const fx = bush.base.x, fy = bush.base.y;
      for (const o of BERRY_OFFSETS) {
        const berry = this.add.image(fx + o.x, fy + o.y, 'bushes', `${bush.type}-in-bush`).setOrigin(0.5, 1).setDepth(bush.base.depth + 1);
        bush.berries.push(berry);
      }
    }
  }

  /** Rustle sprite(s): rock them left-right around their base (origin 0.5,1) and settle
   *  — a cheap procedural "someone brushed past" instead of a hand-drawn sway animation.
   *  `holder.swayUntil` debounces so a pass-through + harvest don't double-fire. Each
   *  target gets ITS OWN chain (not a shared multi-target one) so destroying one mid-sway
   *  (e.g. a bush's berries on harvest) doesn't freeze the others. */
  private playSway(targets: Phaser.GameObjects.Image[], holder: { swayUntil?: number }, amp = 8): void {
    if (holder.swayUntil && this.time.now < holder.swayUntil) return;
    if (!targets.length) return;
    holder.swayUntil = this.time.now + 520; // ~animation length; also the re-trigger cooldown
    for (const t of targets) {
      this.tweens.killTweensOf(t);
      t.setAngle(0);
      this.tweens.chain({
        targets: t,
        onComplete: () => { if (t.active) t.setAngle(0); },
        tweens: [
          { angle: -amp, duration: 70, ease: 'Sine.easeOut' },
          { angle: amp * 0.7, duration: 110, ease: 'Sine.easeInOut' },
          { angle: -amp * 0.3, duration: 100, ease: 'Sine.easeInOut' },
          { angle: 0, duration: 90, ease: 'Sine.easeIn' },
        ],
      });
    }
  }

  private swayBush(bush: BushObj): void { this.playSway([bush.base, ...bush.berries], bush); }
  /** Grass rustles a touch livelier than a bush (thin blades) → a bit more amplitude. */
  private swayForagable(f: ForagObj): void { this.playSway([f.sprite], f, 11); }

  /** Cato brushing through vegetation: when his foot cell CHANGES onto a bush or a
   *  swayable foragable (grass), rustle it (once per entry — the sway's own debounce
   *  guards a lingering stand). */
  private updateBushBrush(): void {
    if (!this.child || !this.islandLayer || (!this.bushes.size && !this.foragables.size)) return;
    const t = this.islandLayer.worldToTileXY(this.child.x, this.child.y);
    if (!t) return;
    const key = `${Math.floor(t.x)},${Math.floor(t.y)}`;
    if (key === this.catoBushCell) return; // same cell as last frame → don't re-trigger
    this.catoBushCell = key;
    const bush = this.bushes.get(key);
    if (bush) { this.swayBush(bush); return; }
    const f = this.foragables.get(key);
    if (f && SWAY_FORAGABLES.has(f.type)) this.swayForagable(f);
  }
  private catoBushCell = '';

  /** Grow bushes toward the next stage (0→1→2) + regrow (1→2) after a harvest. */
  private updateBushes(delta: number): void {
    for (const bush of this.bushes.values()) {
      if (bush.stage >= 2) continue;
      bush.timer += delta;
      if (bush.timer >= BUSH_STAGE_MS) {
        this.setBushStage(bush, bush.stage + 1);
        this.scheduleSave();
      }
    }
  }

  /** Pick a ripe bush — swing the hoe first (like crop harvest), then reap on the
   *  strike. */
  private harvestBush(cx: number, cy: number): void {
    const bush = this.bushes.get(`${cx},${cy}`);
    if (!bush || bush.stage < 2) return;
    this.hideTileCursor();
    const w = this.islandLayer?.tileToWorldXY(cx, cy);
    if (!w) { this.reapBush(cx, cy); return; }
    this.hoeSwingAt(w.x + TILE / 2, w.y + TILE / 2, () => this.reapBush(cx, cy));
  }

  /** The actual pick: the 3 berries pop out (→ the ripe item) + bank, and the bush
   *  drops back to stage 1 (full, no berries) to regrow. */
  private reapBush(cx: number, cy: number): void {
    const bush = this.bushes.get(`${cx},${cy}`);
    if (!bush || bush.stage < 2) return;
    if (!this.backpackHasSpaceFor(`fruit-${bush.type}`)) { this.notifyBagFull(); return; } // backpack full → leave the berries
    this.swayBush(bush); // rustle as the berries are picked
    for (const b of bush.berries) this.playPopOut(b.x, b.y, 'fruit-items', FRUIT_FRAME[bush.type]);
    this.collect(makeFruit(bush.type, 3));
    this.catoReact('love'); // berry harvest
    this.catoLookAtTile(cx, cy);
    this.publishInventory();
    this.setBushStage(bush, 1); // back to full + no berries; regrows to ripe
    this.scheduleSave();
  }

  private removeBush(cx: number, cy: number): void {
    const key = `${cx},${cy}`;
    const bush = this.bushes.get(key);
    if (!bush) return;
    this.tweens.killTweensOf([bush.base, ...bush.berries]); // stop any in-flight sway
    bush.base.destroy();
    for (const b of bush.berries) b.destroy();
    this.bushes.delete(key);
  }

  // ── Wild foragables: auto-spawn → grow → harvest at max ────────────────────

  /** (Re)create a foragable sprite at a cell for a given growth stage (1-based).
   *  Frame = `<type>-<stage>` in the `forage` atlas. Used by the spawner + save
   *  restore. Depth = foot Y so Cato passes in front / behind (tall sunflower). */
  private restoreForagable(key: string, type: ForagableName, stage: number, timer: number): void {
    if (!this.islandLayer) return;
    const [cx, cy] = key.split(',').map(Number);
    const w = this.islandLayer.tileToWorldXY(cx!, cy!);
    if (!w) return;
    this.removeForagable(cx!, cy!);
    const footX = w.x + TILE / 2, footY = w.y + TILE;
    const sprite = this.add.image(footX, footY, 'forage', `${type}-${stage}`).setOrigin(0.5, 1).setDepth(footY);
    // Small-stones are ROCKS — solid, like the big-stones (Cato bumps them + routes
    // around them). Grass / flowers / mushrooms stay passable (no body). isWalkableCell
    // reads `type === 'small-stone'` so pathfinding matches the physics.
    let body: Phaser.GameObjects.Sprite | undefined;
    if (type === 'small-stone' && this.wallGroup) {
      const b = this.wallGroup.create(footX, footY - 4, '__WHITE') as Phaser.Physics.Arcade.Sprite;
      b.setVisible(false).setDisplaySize(12, 8).refreshBody();
      body = b;
    }
    this.foragables.set(key, { type, stage, timer, sprite, body });
  }

  /** Grow every foragable toward its max stage; the max stage stops (harvestable). */
  private updateForagables(delta: number): void {
    for (const [key, f] of this.foragables) {
      const def = FORAGABLES[f.type];
      if (!def || f.stage >= def.stages) continue;
      f.timer += delta;
      if (f.timer >= def.growMs) {
        f.timer = 0;
        f.stage += 1;
        f.sprite.setFrame(`${f.type}-${f.stage}`);
        this.scheduleSave();
      }
    }
  }

  /** The mature foragable whose sprite the world-point lands on (sprite bounds, so a
   *  tall sunflower is clickable up top), or null. */
  private foragAtPoint(x: number, y: number): string | null {
    let best: string | null = null, bestFoot = -Infinity;
    for (const [key, f] of this.foragables) {
      if (f.sprite.active && this.spritePixelHit(f.sprite, x, y) && f.sprite.y > bestFoot) { best = key; bestFoot = f.sprite.y; }
    }
    return best;
  }

  /** Harvest a MATURE foragable (empty hand / hoe): hoe-swing, then reap on the strike. */
  private harvestForagable(cx: number, cy: number): void {
    const f = this.foragables.get(`${cx},${cy}`);
    if (!f || f.stage < (FORAGABLES[f.type]?.stages ?? 1)) return;
    this.hideTileCursor();
    const w = this.islandLayer?.tileToWorldXY(cx, cy);
    if (!w) { this.reapForagable(cx, cy); return; }
    this.hoeSwingAt(w.x + TILE / 2, w.y + TILE / 2, () => this.reapForagable(cx, cy));
  }

  private reapForagable(cx: number, cy: number): void {
    const key = `${cx},${cy}`;
    const f = this.foragables.get(key);
    const def = f && FORAGABLES[f.type];
    if (!f || !def || f.stage < def.stages) return;
    if (!this.backpackHasSpaceFor(makeForage(f.type, 1).id)) { this.notifyBagFull(); return; } // full → leave it
    const w = this.islandLayer?.tileToWorldXY(cx, cy);
    this.foragables.delete(key);
    if (w) this.playPopOut(w.x + TILE / 2, w.y + TILE / 2, 'forage', `${f.type}-${def.stages}`);
    this.tweens.killTweensOf(f.sprite); // stop any in-flight rustle before destroy
    f.body?.destroy();
    f.sprite.destroy();
    this.collect(makeForage(f.type, def.yieldCount));
    this.catoReact('happy'); // gathered a wild foragable
    this.catoLookAtTile(cx, cy);
    this.publishInventory();
    this.scheduleSave();
  }

  private removeForagable(cx: number, cy: number): void {
    const key = `${cx},${cy}`;
    const f = this.foragables.get(key);
    if (!f) return;
    this.tweens.killTweensOf(f.sprite); // stop any in-flight rustle before destroy
    f.body?.destroy();
    f.sprite.destroy();
    this.foragables.delete(key);
  }

  // ── Big stones: knock with the PICKAXE → +1 (regenerates); empty → break for +N ──

  /** (Re)create a big-stone sprite (+ solid collider) at a cell. Frame = `big-stone-<tier>`. */
  private restoreBigStone(key: string, tier: number, ready: number): void {
    if (!this.islandLayer) return;
    const [cx, cy] = key.split(',').map(Number);
    const w = this.islandLayer.tileToWorldXY(cx!, cy!);
    if (!w) return;
    this.removeBigStone(cx!, cy!);
    const def = BIG_STONES[tier] ?? BIG_STONES[1]!;
    const footX = w.x + TILE / 2, footY = w.y + TILE;
    const sprite = this.add.image(footX, footY, 'forage', `big-stone-${def.tier}`).setOrigin(0.5, 1).setDepth(footY);
    let body: Phaser.GameObjects.Sprite | undefined;
    if (this.wallGroup) {
      const b = this.wallGroup.create(footX, footY - 5, '__WHITE') as Phaser.Physics.Arcade.Sprite;
      b.setVisible(false).setDisplaySize(22, 10).refreshBody();
      body = b;
    }
    this.bigStones.set(key, { tier: def.tier, ready: Math.max(0, Math.min(ready, def.readyStones)), regen: [], emptyKnocks: 0, sprite, body });
  }

  /** The big-stone whose sprite the world-point lands on (sprite bounds), or null. */
  private stoneAtPoint(x: number, y: number): string | null {
    let best: string | null = null, bestFoot = -Infinity;
    for (const [key, s] of this.bigStones) {
      if (s.sprite.active && this.spritePixelHit(s.sprite, x, y) && s.sprite.y > bestFoot) { best = key; bestFoot = s.sprite.y; }
    }
    return best;
  }

  /** Knock a big-stone with the pickaxe: swing the pick (raise → strike DOWN), then
   *  apply the hit on the strike. */
  private knockStone(cx: number, cy: number): void {
    const stone = this.bigStones.get(`${cx},${cy}`);
    if (!stone) return;
    const w = this.islandLayer?.tileToWorldXY(cx, cy);
    const cxw = w ? w.x + TILE / 2 : stone.sprite.x;
    const cyw = w ? w.y + TILE / 2 : stone.sprite.y;
    this.pickSwingAt(cxw, cyw, () => this.onKnockStrike(cx, cy));
  }

  /** God-hand PICKAXE swing — the pick rears back, holds a beat, then swings DOWN
   *  onto the stone. No swing SHEET: it's the single `pickaxe` image rotated around
   *  its grip (raise −55° → strike +18°), the hoe/axe analogue. Strike fires at the
   *  bottom of the swing. */
  private pickSwingAt(centerX: number, centerY: number, onStrike: () => void): void {
    // The pickaxe art (public/uploaded/pickaxe.png) has its wooden GRIP at the
    // bottom-left and the metal head up-right, so pivot on the grip and swing the
    // head down onto the stone (rear back → strike), like the hoe.
    const pick = this.add
      .sprite(centerX - 3, centerY - TILE / 2 - 2, 'pickaxe')
      .setOrigin(0.2, 0.82) // pivot at the bottom-left grip
      // 1.3, not the hoe's 1.5: the pickaxe art fills its 16×16 frame edge-to-edge
      // (the hoe frame has padding), so a smaller scale matches the hoe's on-screen size.
      .setScale(1.3)
      .setDepth(1e6 + 1)
      .setAngle(-35); // reared back (head up)
    this.hoeSwing = pick; // suppress the tile cursor while it swings (shared flag)
    let struck = false;
    const strike = () => {
      if (struck) return;
      struck = true;
      if (this.hoeSwing === pick) this.hoeSwing = undefined;
      onStrike();
      this.tweens.add({ targets: pick, alpha: 0, duration: 110, delay: 50, onComplete: () => pick.destroy() });
    };
    // hold reared-back for a beat, then swing the head DOWN onto the stone.
    this.tweens.add({ targets: pick, angle: 42, duration: 130, delay: 150, ease: 'Quad.easeIn', onComplete: strike });
    this.time.delayedCall(1200, strike); // safety
  }

  /** The landed knock: white dust + shake. If a stone is ready → collect one (it
   *  regenerates after regenSec). If empty → 1st knock does nothing, a 2nd empty
   *  knock breaks the rock apart for the +breakBonus. */
  private onKnockStrike(cx: number, cy: number): void {
    const key = `${cx},${cy}`;
    const stone = this.bigStones.get(key);
    if (!stone) return;
    if (!this.backpackHasSpaceFor('stone')) { this.notifyBagFull(); return; } // full → can't mine (stone stays)
    const def = BIG_STONES[stone.tier] ?? BIG_STONES[1]!;
    const sx = stone.sprite.x, topY = stone.sprite.y - stone.sprite.displayHeight * 0.55;
    this.whiteBurst(sx, topY);
    // a quick left-right jitter to sell the impact
    this.tweens.add({ targets: stone.sprite, x: sx + 1.5, duration: 45, yoyo: true, repeat: 1, onComplete: () => { stone.sprite.x = sx; } });
    if (stone.ready > 0) {
      stone.ready -= 1;
      stone.emptyKnocks = 0;
      stone.regen.push(def.regenMs);
      this.playPopOut(sx, topY, 'forage', 'small-stone-6');
      this.collect(makeStone(1));
      this.publishInventory();
      this.scheduleSave();
    } else {
      stone.emptyKnocks += 1;
      if (stone.emptyKnocks >= 2) this.breakBigStone(cx, cy);
    }
  }

  /** The rock is knocked apart: pop the +breakBonus stones, bank them, remove it. */
  private breakBigStone(cx: number, cy: number): void {
    const key = `${cx},${cy}`;
    const stone = this.bigStones.get(key);
    if (!stone) return;
    const def = BIG_STONES[stone.tier] ?? BIG_STONES[1]!;
    const sx = stone.sprite.x, topY = stone.sprite.y - stone.sprite.displayHeight * 0.55;
    for (let i = 0; i < def.breakBonus; i++) {
      this.time.delayedCall(i * 110, () => this.playPopOut(sx, topY, 'forage', 'small-stone-6'));
    }
    if (def.breakBonus > 0) { this.collect(makeStone(def.breakBonus)); }
    this.removeBigStone(cx, cy);
    this.scheduleSave();
  }

  /** Regenerate collected stones back into `ready` after their regen time elapses. */
  private updateBigStones(delta: number): void {
    for (const stone of this.bigStones.values()) {
      if (stone.regen.length === 0) continue;
      const def = BIG_STONES[stone.tier] ?? BIG_STONES[1]!;
      for (let i = stone.regen.length - 1; i >= 0; i--) {
        stone.regen[i]! -= delta;
        if (stone.regen[i]! <= 0) {
          stone.regen.splice(i, 1);
          stone.ready = Math.min(stone.ready + 1, def.readyStones);
        }
      }
    }
  }

  private removeBigStone(cx: number, cy: number): void {
    const key = `${cx},${cy}`;
    const stone = this.bigStones.get(key);
    if (!stone) return;
    stone.sprite.destroy();
    stone.body?.destroy();
    this.bigStones.delete(key);
  }

  // ── Passive spawner: drop foragables + big-stones onto empty grass over time ──

  /** Is this cell on-island grass AND empty (nothing planted / built / standing here)? */
  /** A cell where you can't till the ground — something occupies it (a tree, big
   *  stone, bush, or wild foragable). The hoe must not till under these. */
  private cellBlocksTill(key: string): boolean {
    if (this.trees.has(key) || this.bigStones.has(key) || this.bushes.has(key) || this.foragables.has(key)) return true;
    if (this.isDefaultHouseCell(key)) return true; // the fixed starter house (painted walls/floor + solid furniture)
    const [cx, cy] = key.split(',').map(Number);
    return this.treeOrStoneOverCell(cx!, cy!); // footprint UNDER a tree/stone (editor trees may straddle cells)
  }

  /** A cell belonging to the fixed starter house — its painted `wooden_house`
   *  tilemap tiles (walls AND floor) or a solid furniture footprint. Non-tillable
   *  and non-demolishable (unlike the player's own placed pieces). */
  private isDefaultHouseCell(key: string): boolean {
    if (this.houseBlocked.has(key)) return true;
    const [cx, cy] = key.split(',').map(Number);
    return !!this.wallLayer?.getTileAt(cx!, cy!);
  }

  /** A tree / big-stone sprite covering this cell's CENTRE (canopy included). Blocks
   *  tilling even when the registered trunk cell isn't this one — an editor-placed
   *  tree can sit off-grid and straddle two cells. */
  private treeOrStoneOverCell(cx: number, cy: number): boolean {
    const w = this.islandLayer?.tileToWorldXY(cx, cy);
    if (!w) return false;
    const mx = w.x + TILE / 2, my = w.y + TILE / 2;
    return !!this.treeAtPoint(mx, my) || !!this.stoneAtPoint(mx, my);
  }

  private cellSpawnable(cx: number, cy: number): boolean {
    if (!this.islandLayer) return false;
    const w = this.islandLayer.tileToWorldXY(cx, cy);
    if (!w) return false;
    if (!this.islandLayer.getTileAtWorldXY(w.x + TILE / 2, w.y + TILE / 2)) return false; // water / off-island
    const key = `${cx},${cy}`;
    if (this.crops.has(key) || this.trees.has(key) || this.bushes.has(key) || this.placed.has(key) ||
        this.floors.has(key) || this.tilledCells.has(key) || this.foragables.has(key) || this.bigStones.has(key)) return false;
    if (this.child) {
      const ct = this.islandLayer.worldToTileXY(this.child.x, this.child.y);
      if (ct && Math.floor(ct.x) === cx && Math.floor(ct.y) === cy) return false; // not on Cato
    }
    return true;
  }

  /** Pick a random empty grass cell (a few tries), or null if the map's crowded. */
  private randomSpawnCell(): { cx: number; cy: number } | null {
    const layer = this.islandLayer?.layer;
    if (!layer) return null;
    for (let i = 0; i < 16; i++) {
      const cx = Phaser.Math.Between(0, layer.width - 1);
      const cy = Phaser.Math.Between(0, layer.height - 1);
      if (this.cellSpawnable(cx, cy)) return { cx, cy };
    }
    return null;
  }

  private weightedPick<T>(items: T[], weight: (t: T) => number): T | null {
    const total = items.reduce((s, it) => s + Math.max(0, weight(it)), 0);
    if (total <= 0) return null;
    let r = Math.random() * total;
    for (const it of items) { r -= Math.max(0, weight(it)); if (r <= 0) return it; }
    return items[items.length - 1] ?? null;
  }

  /** Every FORAGE_SPAWN_INTERVAL_MS, drop one foragable (at stage 1) or a big-stone
   *  (at a weighted tier) onto a random empty grass cell, up to the map cap. */
  private trySpawn(delta: number): void {
    if (!this.saveArmed) return; // don't spawn until the save has loaded (avoids dupes)
    this.spawnTimer += delta;
    if (this.spawnTimer < FORAGE_SPAWN_INTERVAL_MS) return;
    this.spawnTimer = 0;
    if (this.foragables.size + this.bigStones.size >= FORAGE_MAX_ON_MAP) return;
    const cell = this.randomSpawnCell();
    if (!cell) return;
    const key = `${cell.cx},${cell.cy}`;
    if (Math.random() < BIG_STONE_SPAWN_CHANCE && BIG_STONE_TIERS.length) {
      const tier = this.weightedPick(BIG_STONE_TIERS, (t) => BIG_STONES[t]?.spawnWeight ?? 1);
      if (tier != null) { this.restoreBigStone(key, tier, BIG_STONES[tier]!.readyStones); this.scheduleSave(); }
    } else {
      const type = this.weightedPick(FORAGABLE_NAMES, (n) => FORAGABLES[n]?.spawnWeight ?? 1) as ForagableName | null;
      if (type) { this.restoreForagable(key, type, 1, 0); this.scheduleSave(); }
    }
  }

  /** A small white dust burst — the "knock" feedback on a big-stone (the stone
   *  analogue of the hoe's `dirtBurst`). */
  private whiteBurst(x: number, y: number): void {
    const p = this.add.particles(x, y, 'white-particle', {
      speed: { min: 22, max: 58 },
      angle: { min: 200, max: 340 },
      gravityY: 150,
      lifespan: { min: 260, max: 440 },
      scale: { start: 1.3, end: 0.2 },
      emitting: false,
    });
    p.setDepth(1e6 - 1);
    p.explode(7);
    this.time.delayedCall(650, () => p.destroy());
  }

  // Placed house tiles that have been HOED ONCE (armed for removal on the 2nd hit
  // within the window); the timer clears the mark if the 2nd hit doesn't come.
  private placedHoedOnce = new Map<string, Phaser.Time.TimerEvent>();

  /** Hoe a placed house tile to DIG IT OUT. Like un-tilling soil: the 1st strike
   *  loosens it (a dirt puff + arms a short window); a 2nd strike within the window
   *  pops the piece out (harvest-style arc) and returns it to the backpack. */
  private hoePlacedTile(cx: number, cy: number): void {
    if (!this.islandLayer) return;
    const key = `${cx},${cy}`;
    if (!this.placed.has(key) && !this.floors.has(key)) return;
    const w = this.islandLayer.tileToWorldXY(cx, cy);
    if (!w) return;
    const centerX = w.x + TILE / 2;
    const centerY = w.y + TILE / 2;
    this.hoeSwingAt(centerX, centerY, () => {
      // One strike loosens it + asks to confirm (the old "hoe twice" was undiscoverable
      // — players didn't know a 2nd hit was needed). Confirm → pop it out + refund. The
      // prompt names the ACTUAL thing being removed (floor-first, matching the pop).
      this.dirtBurst(centerX, centerY);
      this.promptConfirm(t(this.demolishTargetKey(cx, cy)), () => this.removePlacedWithPop(cx, cy));
    });
  }

  /** The i18n key for whatever a hoe strike would remove at this cell — floor FIRST
   *  (it's the top layer, matching removePlacedWithPop), else the placed piece. */
  private demolishTargetKey(cx: number, cy: number): string {
    const key = `${cx},${cy}`;
    if (this.floors.has(key)) return 'demolish_floor';
    const o = this.placed.get(key);
    if (!o) return 'demolish_generic';
    if (o.kind === 'wall') return 'demolish_wall';
    if (o.kind === 'window') return 'demolish_window';
    if (o.kind === 'door') return 'demolish_door';
    if (o.kind === 'furniture') return `demolish_furn_${o.variant ?? ''}`;
    return 'demolish_generic';
  }

  /** Remove a house tile with a pop-out (its icon jumps out like a harvested crop),
   *  then refund it. A FLOOR overlapping a wall is removed FIRST (it's the top layer
   *  the player just added); a 2nd hoe-session then digs out the wall underneath. */
  private removePlacedWithPop(cx: number, cy: number): void {
    const key = `${cx},${cy}`;
    const w = this.islandLayer?.tileToWorldXY(cx, cy);
    const pop = (texture: string, frame: number) => { if (w) this.playPopOut(w.x + TILE / 2, w.y + TILE / 2, texture, frame); };
    const floor = this.floors.get(key);
    if (floor) {
      floor.sprite.destroy();
      this.floors.delete(key);
      this.addToHotbarOrChest(itemFromId('floor', 1));
      this.publishInventory();
      this.scheduleSave();
      pop('house-walls', floor.frame);
      return;
    }
    const o = this.placed.get(key);
    if (!o) return;
    const texture = o.kind === 'wall' ? 'house-walls' : o.kind === 'door' ? 'door' : 'furniture';
    const frame = o.frame;
    this.removeObject(cx, cy); // destroy + refund + save
    pop(texture, frame);
  }

  /** DEV: build a 5×5 hollow wall ring (door in the bottom edge) + a plant inside,
   *  around the camera centre — for testing without the inventory/cursor flow. */
  private debugBuildHouse(): void {
    if (!this.islandLayer) return;
    const cam = this.cameras.main;
    const c = this.islandLayer.worldToTileXY(cam.worldView.centerX, cam.worldView.centerY);
    if (!c) return;
    const ccx = Math.floor(c.x), ccy = Math.floor(c.y), R = 2;
    const doorCx = ccx, doorCy = ccy + R;
    for (let dx = -R; dx <= R; dx++) for (let dy = -R; dy <= R; dy++) {
      if (Math.abs(dx) !== R && Math.abs(dy) !== R) continue; // edge only
      const cx = ccx + dx, cy = ccy + dy, key = `${cx},${cy}`;
      if ((cx === doorCx && cy === doorCy) || this.placed.has(key)) continue;
      // Explicit per-cell facing (fully manual now): corners + edges.
      const orient: WallOrient =
        dx === -R && dy === -R ? 'tl' : dx === R && dy === -R ? 'tr' :
        dx === -R && dy === R ? 'bl' : dx === R && dy === R ? 'br' :
        dy === -R ? 'top' : dy === R ? 'bottom' : dx === -R ? 'left' : 'right';
      this.restorePlaced(key, 'wall', orient);
    }
    // Brick FLOOR (window frame): fill the interior AND overlap the bottom wall row
    // (dy=R) so it tucks under the wall — demonstrates the floor-over-wall overlap.
    for (let dx = -(R - 1); dx <= R - 1; dx++) for (let dy = -(R - 1); dy <= R; dy++) {
      this.restoreFloor(`${ccx + dx},${ccy + dy}`, FLOOR_FRAME);
    }
    this.restorePlaced(`${doorCx},${doorCy}`, 'door', 'bottom');
    this.restorePlaced(`${ccx},${ccy - 1}`, 'furniture', 'bottom', 'plant');
    this.scheduleSave();
  }

  /** DEV: force-spawn one MATURE foragable of each type + a big-stone of each tier
   *  around the camera centre (bypasses the slow passive spawner for testing). */
  /** DEBUG (L): fill the chest with ~50 varied items so the unified menu's scroll bar
   *  has something to scroll, then open it on the Chest tab. Take/Delete or Restart to clear. */
  private debugFillChest(): void {
    const fruits = ['apple', 'pear', 'peach', 'strawberry', 'grape', 'blueberry'];
    const crops: CropName[] = ['corn', 'carrot', 'tomato', 'eggplant', 'pumpkin'];
    const forage: ForagableName[] = ['red-mushroom', 'purple-mushroom', 'wild-flower', 'sunflower', 'grass'];
    const pile: ItemStack[] = [];
    for (let r = 0; r < 3; r++) { // 3 rounds → ~48 stacks (2+ pages of the 7×5 grid)
      fruits.forEach((f, i) => pile.push(makeFruit(f, r * 6 + i + 1)));
      crops.forEach((cn, i) => pile.push(makeCrop(cn, r * 4 + i + 1)));
      forage.forEach((fn, i) => pile.push(makeForage(fn, r * 3 + i + 1)));
      pile.push(makeStone(r * 5 + 3));
    }
    this.chestStore = pile;
    this.openMenu(1);
    this.scheduleSave();
  }

  private debugSpawnForage(): void {
    if (!this.islandLayer) return;
    const cam = this.cameras.main;
    const c = this.islandLayer.worldToTileXY(cam.worldView.centerX, cam.worldView.centerY);
    if (!c) return;
    const ccx = Math.floor(c.x), ccy = Math.floor(c.y);
    // Foragables (at MAX stage → immediately harvestable) along a couple of rows.
    let i = 0;
    for (const type of FORAGABLE_NAMES) {
      const cx = ccx - 3 + (i % 6), cy = ccy - 2 + Math.floor(i / 6);
      if (this.cellSpawnable(cx, cy)) this.restoreForagable(`${cx},${cy}`, type, FORAGABLES[type]!.stages, 0);
      i++;
    }
    // A big-stone of each tier a row below.
    let j = 0;
    for (const tier of BIG_STONE_TIERS) {
      const cx = ccx - 2 + j * 2, cy = ccy + 2;
      if (this.cellSpawnable(cx, cy)) this.restoreBigStone(`${cx},${cy}`, tier, BIG_STONES[tier]!.readyStones);
      j++;
    }
    // A couple of fruit trees + a ripe berry bush a few rows down, so the
    // chop / harvest_fruit / harvest_bushes tasks are testable too.
    const treeSpots: Array<[number, TreeType]> = [[ccx - 3, 'apple'], [ccx + 3, 'peach']];
    for (const [cx, t] of treeSpots) if (this.cellSpawnable(cx, ccy + 4)) this.restoreTree(`${cx},${ccy + 4}`, t, true);
    if (this.cellSpawnable(ccx, ccy + 4)) this.restoreBush(`${ccx},${ccy + 4}`, 'strawberry', 2); // stage 2 = ripe
    this.scheduleSave();
  }

  /** Open placed doors as Cato nears (plays the swing + drops the collider so he
   *  can pass); close them again when he's clear (hysteresis avoids flicker). No
   *  pathfinding — since walls box Cato in, he only nears a door when entering. */
  /** Find the editor-placed door sprite and force it onto BootScene's `door`
   *  sheet (which carries the door-open/close anims) at the closed frame. The
   *  manifest asset is the SAME 16×16-sliced PNG, so the frames line up. */
  private wireHouseDoor(): void {
    const reg = getEntityRegistry(this);
    if (!reg) return;
    const door = reg.all().find(
      (go) => go.getData('entityAssetId') === 'door_animation_sprites',
    ) as Phaser.GameObjects.Sprite | undefined;
    if (!door) return;
    this.houseDoor = door;
    door.stop();
    door.setTexture('door', DOOR_CLOSED_FRAME); // start closed, on the anim-bearing sheet
  }

  /** Swing the editor door open as Cato approaches, close when he leaves
   *  (hysteresis so it never shuts on him). Cosmetic — no collider, the doorway
   *  cell is already a walkable floor tile. */
  private updateHouseDoor(): void {
    const door = this.houseDoor;
    if (!door || !this.child || this.houseDoorAnimating) return;
    const OPEN_R = TILE * 1.5;
    const CLOSE_R = TILE * 2.2;
    const d = Math.hypot(door.x - this.child.x, door.y - this.child.y);
    if (!this.houseDoorOpen && d < OPEN_R) this.setHouseDoorOpen(true);
    else if (this.houseDoorOpen && d > CLOSE_R) this.setHouseDoorOpen(false);
  }

  private setHouseDoorOpen(open: boolean): void {
    const door = this.houseDoor!;
    this.houseDoorOpen = open;
    this.houseDoorAnimating = true;
    door.play(open ? 'door-open' : 'door-close');
    door.once(Phaser.Animations.Events.ANIMATION_COMPLETE, () => { this.houseDoorAnimating = false; });
  }

  /** Find the editor-placed mailbox sprite so clicking it opens the mail modal. */
  private wireMailbox(): void {
    const reg = getEntityRegistry(this);
    if (!reg) return;
    this.mailbox = reg.all().find(
      (go) => go.getData('entityAssetId') === 'mailbox_animation_frames',
    ) as Phaser.GameObjects.Sprite | undefined;
  }

  /** Is a world point on the mailbox sprite? (Bounds + a little touch padding.) */
  private mailboxContains(wx: number, wy: number): boolean {
    if (!this.mailbox) return false;
    const b = this.mailbox.getBounds();
    return wx >= b.x - 4 && wx <= b.right + 4 && wy >= b.y - 4 && wy <= b.bottom + 4;
  }

  /** Is (x,y) inside a modal's panel rect (the scene published it)? Tap outside → close. */
  private overPanel(key: string, x: number, y: number): boolean {
    const r = this.registry.get(key) as { x: number; y: number; w: number; h: number } | null;
    return !!r && x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;
  }

  /** Slide the tool hotbar down off-screen (open) / back up (close), so the unified
   *  menu owns the screen. Moves the HotbarScene camera viewport. */
  private hideHotbar(hide: boolean): void {
    const hb = this.scene.get('HotbarScene');
    if (!hb) return;
    this.tweens.add({ targets: hb.cameras.main, y: hide ? this.scale.height : 0, duration: 240, ease: 'Cubic.easeInOut' });
  }

  // ── Chest modal — the mirror of the mailbox (ChestScene) ───────────────────
  private wireChest(): void {
    const reg = getEntityRegistry(this);
    if (!reg) return;
    this.chest = reg.all().find(
      (go) => go.getData('entityAssetId') === 'chest',
    ) as Phaser.GameObjects.Sprite | undefined;
  }

  private chestContains(wx: number, wy: number): boolean {
    if (!this.chest) return false;
    const b = this.chest.getBounds();
    return wx >= b.x - 4 && wx <= b.right + 4 && wy >= b.y - 4 && wy <= b.bottom + 4;
  }

  /** Find the editor-placed desk pad (static `ipad_qkzld` sprite) and force it onto the
   *  animation sheet at its resting frame, so `pad-open`/`pad-close` apply (mirrors the
   *  door). Frame 0 of the sheet matches the static pad, so the resting look is unchanged. */
  private wirePad(): void {
    const reg = getEntityRegistry(this);
    if (!reg) return;
    this.pad = reg.all().find(
      (go) => go.getData('entityAssetId') === 'ipad_qkzld',
    ) as Phaser.GameObjects.Sprite | undefined;
    if (!this.pad) return;
    if (this.textures.exists('pad')) this.pad.setTexture('pad', 0);
    // Depth is handled per-frame in sortPadOnDesk() (it sits ON the desk → must draw
    // above the furniture it overlaps, but still under Cato when he's in front).
  }

  private padContains(wx: number, wy: number): boolean {
    if (!this.pad) return false;
    const b = this.pad.getBounds();
    return wx >= b.x - 4 && wx <= b.right + 4 && wy >= b.y - 4 && wy <= b.bottom + 4;
  }

  // ── Unified menu (MenuScene) — tabs: mail / chest / cato-bag / shop / settings ──

  /** Door mailbox clicked → play its open swing, THEN open the menu on Mail; closing the
   *  menu plays its close swing. (mailbox-mail-open vs -empty-open per mail state.) */
  private openMailboxViaDoor(): void {
    this.mailboxHasMail = this.mailList.length > 0;
    this.openMenuViaObject(this.mailbox, this.mailboxHasMail ? 'mailbox-mail-open' : 'mailbox-empty-open', 'mailbox-close', 0);
  }

  /** Door chest clicked → play its open swing, THEN open the menu on Chest; closing plays close. */
  private openChestViaDoor(): void {
    this.openMenuViaObject(this.chest, 'chest-open-front', 'chest-close-front', 1);
  }

  /** Desk pad clicked → play its screen-on swing, THEN open the menu on the Shop tab;
   *  closing the menu plays the screen-off swing. (Replaces the bottom-right shop button.) */
  private openShopViaPad(): void {
    this.openMenuViaObject(this.pad, 'pad-open', 'pad-close', 3);
  }

  /** Play `sprite`'s open animation, then open the unified menu on `tab`; remember the
   *  close animation to play when the menu closes. Falls back to opening immediately if
   *  the sprite / anim is missing, and has a safety timer so a missing COMPLETE event
   *  can't strand the menu closed. */
  private openMenuViaObject(sprite: Phaser.GameObjects.Sprite | undefined, openAnim: string, closeAnim: string, tab: number): void {
    if (this.menuOpen || !sprite) { this.openMenu(tab); return; } // already open, or no sprite → just open (no anim)
    sprite.play({ key: openAnim, repeat: 0 }); // authored loop:true → repeat:0 plays once + holds open
    let done = false;
    const go = (): void => {
      if (done || this.menuOpen) return;
      done = true;
      this.openMenu(tab); // this clears the source on a fresh open; set it right after so close plays the swing
      this.menuSourceSprite = sprite;
      this.menuCloseAnim = closeAnim;
    };
    sprite.once(Phaser.Animations.Events.ANIMATION_COMPLETE, go); // open the menu when the swing finishes
    this.time.delayedCall(700, go); // safety: open anyway if COMPLETE never fires
  }

  /** Open the unified menu on `tab` (0 mail · 1 chest · 2 cato-bag · 3 shop · 4 settings). */
  private openMenu(tab: number): void {
    playSfx(this); // click blip — covers open (bag/mailbox/chest/shop/settings) + tab switch
    this.menuTab = tab;
    this.menuSelected = -1;
    if (tab === 3) { this.menuBuyQty = 1; this.shopMsg = ''; if (!this.menuShopSel) this.menuShopSel = this.orderCatalog()[0]?.id; } // Shop defaults
    if (!this.menuOpen) {
      // Fresh open → no source object by default (E/I / order button / backpack button).
      // openMenuViaObject sets the source AFTER this so a door-open still animates on close.
      this.menuSourceSprite = undefined;
      this.menuCloseAnim = undefined;
      this.menuOpen = true;
      if (this.locked) this.input.manager.mouse?.releasePointerLock();
      this.hideHotbar(true);
    }
    this.publishMenu(true);
  }

  /** Bottom-right sprout button tapped → flash its pressed frame, THEN open the backpack (so the
   *  button reads as physically pressed before the modal appears). Chest = door / E-I. */
  private pressBackpackThenOpen(): void {
    if (this.menuOpen) return;
    this.bagBtnPressed = true; this.publishBackpackBtn();
    this.time.delayedCall(120, () => {
      this.bagBtnPressed = false; this.publishBackpackBtn();
      this.openBackpack();
    });
  }

  /** Close via the X button: flash its pressed frame (a momentary click, not a latched
   *  state), then run the normal close a beat later so the flash is seen first. */
  private closeMenuViaX(): void {
    if (!this.menuOpen || this.menuClosing) return;
    this.menuClosing = true;
    this.registry.set('menuCloseFlash', ++this.menuCloseFlashRev); // MenuScene shows close-light-big-pressed-down
    this.time.delayedCall(120, () => { this.menuClosing = false; this.closeMenu(); });
  }

  private closeMenu(): void {
    if (!this.menuOpen) return;
    playSfx(this); // close blip
    this.menuOpen = false;
    this.closeMenuItemMenu();
    this.closeReceipt();
    this.hideHotbar(false);
    this.registry.set('menu', { visible: false, rev: ++this.menuRev });
    // If opened by a door object, play its CLOSE swing — a touch after the menu's own
    // slide-out so it reads as "menu closes, then the box shuts".
    const sprite = this.menuSourceSprite, closeAnim = this.menuCloseAnim;
    this.menuSourceSprite = undefined; this.menuCloseAnim = undefined;
    if (sprite && closeAnim) this.time.delayedCall(180, () => sprite.play({ key: closeAnim, repeat: 0 }));
  }

  /** The item grid backing the active tab — only the Chest (tab 1) is a grid now. */
  private menuStore(): ItemStack[] {
    return this.menuTab === TAB_BACKPACK ? this.backpackStore : this.menuTab === 1 ? this.chestStore : this.menuTab === 2 ? this.catoBagStore : [];
  }

  /** Open the BACKPACK — a standalone MenuScene view (left grid / right detail) with NO tab bar,
   *  so it can't reach the chest (portable ≠ storage). Sprout-up button / a future key. */
  private openBackpack(): void {
    if (this.menuOpen) { this.closeMenu(); return; }
    this.openMenu(TAB_BACKPACK);
  }

  private publishMenu(_open = false): void {
    // Shop catalog (only built for the Shop tab — orderCatalog() isn't free).
    const catalog = this.menuTab === 3
      ? this.orderCatalog().map((e) => ({ id: e.id, iconKey: e.iconKey, iconFrame: e.iconFrame, label: this.itemName(e.id), price: e.price, desc: this.itemDesc(e.id) }))
      : undefined;
    this.registry.set('menu', {
      visible: true, rev: ++this.menuRev, tab: this.menuTab, noTabs: true, // ALL menu views are standalone now (no tab bar) — Cato shares the backpack, so there's no Cato-bag tab
      items: this.menuStore().map((it) => ({
        id: it.id, iconKey: it.iconKey ?? 'fruit-items', iconFrame: it.iconFrame ?? 0, count: it.count,
        label: this.itemName(it.id), desc: this.itemDesc(it.id),
      })),
      mails: this.mailListModel(),
      selected: this.menuSelected,
      catalog, shopSelected: this.menuShopSel, money: this.money, buyQty: this.menuBuyQty, shopMsg: this.shopMsg,
    });
  }

  /** Shop catalog row under (x,y) → its id. */
  private menuShopRowAt(x: number, y: number): string | null {
    const rows = this.registry.get('menuShopRows') as Array<{ x: number; y: number; w: number; h: number; id: string }> | null;
    const hit = rows?.find((r) => x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h);
    return hit ? hit.id : null;
  }

  /** Shop qty-stepper button under (x,y) → 'inc' | 'dec'. */
  private menuStepperAt(x: number, y: number): string | null {
    const b = this.registry.get('menuStepper') as Array<{ x: number; y: number; w: number; h: number; key: string }> | null;
    const hit = b?.find((s) => x >= s.x && x <= s.x + s.w && y >= s.y && y <= s.y + s.h);
    return hit ? hit.key : null;
  }

  /** Shop stepper / buy: `inc`/`dec` change the buy quantity; `buy` commits an INSTANT
   *  purchase — coins out, item into the chest (if it has room), else a warning. */
  private menuShopStep(dir: string): void {
    const id = this.menuShopSel;
    if (!id) return;
    if (dir === 'inc') this.menuBuyQty = Math.min(99, this.menuBuyQty + 1);
    else if (dir === 'dec') this.menuBuyQty = Math.max(1, this.menuBuyQty - 1);
    else if (dir === 'buy') { this.menuBuy(); return; }
    this.shopMsg = '';
    this.publishMenu();
  }

  /** Instant purchase of `menuBuyQty` of the selected item into the chest. */
  private menuBuy(): void {
    playSfx(this); // buy-button click
    const id = this.menuShopSel;
    if (!id) return;
    const n = this.menuBuyQty, cost = this.priceOf(id) * n;
    if (cost > this.money) { this.flashShopMsg(t('shop_no_coins')); return; }
    if (!this.backpackHasSpaceFor(id)) { this.flashShopMsg(t('bag_full')); return; } // bought items → backpack
    this.addMoney(-cost);
    this.addToBackpack(itemFromId(id, n));
    this.menuBuyQty = 1;
    this.shopMsg = '';
    this.publishMenu();
    this.scheduleSave();
  }

  /** Show a transient Shop warning, then clear it. */
  private flashShopMsg(msg: string): void {
    this.shopMsg = msg;
    this.publishMenu();
    this.time.delayedCall(1600, () => { if (this.shopMsg === msg) { this.shopMsg = ''; if (this.menuOpen && this.menuTab === 2) this.publishMenu(); } });
  }

  /** Does the chest have room for `id`? A stackable item that already has a stack merges
   *  (always fits); a new item needs a free slot (chest capped at CHEST_SLOTS). */
  private chestHasSpaceFor(id: string): boolean {
    if (this.chestStore.some((s) => s.id === id)) return true;
    return this.chestStore.length < CHEST_SLOTS;
  }

  /** Does Cato's (small) bag have room for `id`? Merges into an existing stack, else needs
   *  a free slot (capped at CATO_BAG_SLOTS). */
  private catoBagHasSpaceFor(id: string): boolean {
    if (this.catoBagStore.some((s) => s.id === id)) return true;
    return this.catoBagStore.length < CATO_BAG_SLOTS;
  }

  /** Does the player's backpack have room for `id`? Merges into an existing stack, else a free
   *  slot (capped at BACKPACK_SLOTS). */
  private backpackHasSpaceFor(id: string): boolean {
    if (this.backpackStore.some((s) => s.id === id)) return true;
    return this.backpackStore.length < BACKPACK_SLOTS;
  }

  /** Add to the player's backpack (merges same-id). Returns false if it can't fit (full). */
  private addToBackpack(item: ItemStack): boolean {
    if (!this.backpackHasSpaceFor(item.id)) return false;
    this.addToStore(this.backpackStore, item);
    return true;
  }

  /** COLLECT a harvested / gathered item → the backpack. Animal-Crossing style: if the backpack is
   *  full the item is NOT collected (it stays where it is — you must make room; nothing auto-goes to
   *  the chest, since you'll leave home with only the backpack) and Cato says so. Harvest fns guard
   *  with backpackHasSpaceFor BEFORE acting, so this rarely returns false. Refreshes an open bag. */
  private collect(item: ItemStack): boolean {
    if (!this.addToBackpack(item)) { this.notifyBagFull(); return false; }
    if (this.menuOpen && this.menuTab === TAB_BACKPACK) this.publishMenu();
    this.scheduleSave();
    return true;
  }

  /** Transient "背包满了" notice (throttled) — Cato says it in his voice; the player sees a flash. */
  private notifyBagFull(): void {
    const now = this.time.now;
    if (now - this.bagFullMsgAt < 4000) return; // don't spam
    this.bagFullMsgAt = now;
    this.catoSay('chatter_pack_full');
  }
  private bagFullMsgAt = 0;
  private bagFullNotified = false; // Cato said "pack full" for this fill (cleared when it has room)

  /** Add an item stack to `store`, merging into an existing same-id stack if present. */
  private addToStore(store: ItemStack[], item: ItemStack): void {
    const existing = store.find((s) => s.id === item.id && s.stackable);
    if (existing) existing.count += item.count;
    else store.push(item);
  }

  /** Add to the chest (harvested goods land here — there's no backpack, the chest IS storage). */
  private addToChest(item: ItemStack): void { this.addToStore(this.chestStore, item); }

  /** For a REFUNDED hotbar-usable item (demolished wall / dug-up floor / …): top up the
   *  matching HOTBAR stack if one's equipped, else drop it in the chest. */
  private addToHotbarOrChest(item: ItemStack): void {
    if (item.stackable) {
      for (let i = 0; i < INV_COLS; i++) { // hotbar row only
        const c = this.inventory[i];
        if (c && c.id === item.id && c.stackable) { c.count += item.count; this.publishInventory(); return; }
      }
    }
    this.addToChest(item);
  }

  /** Flavor description for the right-side detail panel. Keyed by item id in i18n
   *  (`desc_<id>`, hyphens→underscores, en+zh); '' when there's no entry. */
  private itemDesc(id: string): string {
    const key = 'desc_' + id.replace(/-/g, '_');
    const s = t(key);
    return s === key ? '' : s; // t() echoes the key back when it's missing
  }

  /** Localized display name for an item id (`item_<id>`, hyphens→underscores, en+zh).
   *  Falls back to the factory's (English) label so an untranslated id still shows. */
  private itemName(id: string): string {
    const key = 'item_' + id.replace(/-/g, '_');
    const s = t(key);
    return s === key ? (itemFromId(id, 1).label ?? id) : s;
  }

  // ── Crafting (work station modal) ──────────────────────────────────────────
  /** Total count of item `id` sitting in the chest (materials are pulled from there). */
  private chestCountOf(id: string): number {
    let n = 0;
    for (const s of this.chestStore) if (s.id === id) n += s.count;
    return n;
  }

  /** Can every material of `r` be paid AND does the output have chest room? */
  private canCraftRecipe(r: Recipe): boolean {
    if (!r.materials.every((m) => this.chestCountOf(m.id) >= m.count)) return false;
    return this.chestHasSpaceFor(r.output);
  }

  /** Find the editor-placed work station; it opens the crafting modal on click. Add it
   *  to the y-sort so Cato passes in front/behind by foot line (it sits on the floor). */
  private wireCraftStation(): void {
    const reg = getEntityRegistry(this);
    if (!reg) return;
    this.craftStation = reg.all().find(
      (go) => go.getData('entityAssetId') === 'work_station',
    ) as Phaser.GameObjects.Sprite | undefined;
    if (!this.craftStation) return;
    if (!this.ySortSprites.includes(this.craftStation)) this.ySortSprites.push(this.craftStation);
    // Solid, like the house furniture: Cato bumps it and routes around it. The station
    // is a ~2-tile-tall sprite, so collide only its BOTTOM row (base footprint) — the
    // upper part is walk-behind (y-sorted), so he can stand behind it, not through it.
    const layer = this.islandLayer;
    if (!layer || !this.wallGroup) return;
    const b = this.craftStation.getBounds();
    const inset = 2;
    const bw = Math.max(4, b.width - inset * 2);
    const bh = Math.min(TILE, Math.max(4, b.height - inset * 2)); // base row only
    const cxWorld = b.centerX;
    const cyWorld = b.bottom - inset - bh / 2; // sit the body on the base
    const body = this.wallGroup.create(cxWorld, cyWorld, '__WHITE') as Phaser.Physics.Arcade.Sprite;
    body.setVisible(false).setDisplaySize(bw, bh).refreshBody();
    // Block the base cell(s) for pathfinding (cell whose centre falls in the base box).
    const t0 = layer.worldToTileXY(b.left + inset, cyWorld - bh / 2);
    const t1 = layer.worldToTileXY(b.right - inset, b.bottom - inset);
    if (t0 && t1) {
      for (let cy = Math.floor(t0.y); cy <= Math.floor(t1.y); cy++) {
        for (let cx = Math.floor(t0.x); cx <= Math.floor(t1.x); cx++) {
          const c = layer.tileToWorldXY(cx, cy);
          if (!c) continue;
          const ccx = c.x + TILE / 2, ccy = c.y + TILE / 2;
          if (ccx >= b.left + inset && ccx <= b.right - inset && ccy >= cyWorld - bh / 2 && ccy <= b.bottom - inset)
            this.houseBlocked.add(`${cx},${cy}`);
        }
      }
    }
  }

  private craftStationContains(wx: number, wy: number): boolean {
    if (!this.craftStation) return false;
    const b = this.craftStation.getBounds();
    return wx >= b.x - 4 && wx <= b.right + 4 && wy >= b.y - 4 && wy <= b.bottom + 4;
  }

  private openCraft(): void {
    if (this.craftOpen) return;
    playSfx(this); // click blip
    this.craftOpen = true;
    this.craftSel = 0;
    this.craftMsg = '';
    if (this.locked) this.input.manager.mouse?.releasePointerLock();
    this.publishCraft();
  }

  private closeCraft(): void {
    if (!this.craftOpen) return;
    this.craftOpen = false;
    this.registry.set('craft', { visible: false, rev: ++this.craftRev });
  }

  /** Build the crafting model from RECIPES + current chest counts and publish it. */
  private publishCraft(): void {
    const recipes = RECIPES.map((r) => ({
      id: r.id,
      iconKey: itemFromId(r.output, 1).iconKey ?? 'fruit-items',
      iconFrame: itemFromId(r.output, 1).iconFrame ?? 0,
      name: this.itemName(r.output),
      count: r.count,
      ok: this.canCraftRecipe(r),
    }));
    const sel = RECIPES[this.craftSel];
    const detail = sel
      ? {
          name: sel.count > 1 ? `${this.itemName(sel.output)} ×${sel.count}` : this.itemName(sel.output),
          desc: this.itemDesc(sel.output),
          iconKey: itemFromId(sel.output, 1).iconKey ?? 'fruit-items',
          iconFrame: itemFromId(sel.output, 1).iconFrame ?? 0,
          outCount: sel.count,
          materials: sel.materials.map((m) => {
            const have = this.chestCountOf(m.id);
            return {
              iconKey: itemFromId(m.id, 1).iconKey ?? 'fruit-items',
              iconFrame: itemFromId(m.id, 1).iconFrame ?? 0,
              need: m.count,
              have,
              ok: have >= m.count,
            };
          }),
          canCraft: this.canCraftRecipe(sel),
        }
      : undefined;
    this.registry.set('craft', { visible: true, rev: ++this.craftRev, recipes, selected: this.craftSel, detail, msg: this.craftMsg });
  }

  /** Craft the selected recipe: deduct materials from the chest, add the output to it. */
  private doCraft(): void {
    playSfx(this); // craft-button click
    const r = RECIPES[this.craftSel];
    if (!r) return;
    if (!r.materials.every((m) => this.chestCountOf(m.id) >= m.count)) { this.flashCraftMsg(t('craft_need')); return; }
    if (!this.chestHasSpaceFor(r.output)) { this.flashCraftMsg(t('craft_full')); return; }
    for (const m of r.materials) this.takeFromChest(m.id, m.count);
    this.addToChest(itemFromId(r.output, r.count));
    this.catoReact('happy', { duration: 1400 });
    this.flashCraftMsg(t('craft_done'));
    this.scheduleSave();
  }

  /** Remove `n` of item `id` from the chest (across stacks). */
  private takeFromChest(id: string, n: number): void {
    let left = n;
    for (let i = this.chestStore.length - 1; i >= 0 && left > 0; i--) {
      const s = this.chestStore[i];
      if (s.id !== id) continue;
      const take = Math.min(s.count, left);
      s.count -= take; left -= take;
      if (s.count <= 0) this.chestStore.splice(i, 1);
    }
  }

  private flashCraftMsg(msg: string): void {
    this.craftMsg = msg;
    this.publishCraft();
    this.time.delayedCall(1400, () => { if (this.craftMsg === msg) { this.craftMsg = ''; if (this.craftOpen) this.publishCraft(); } });
  }

  /** Route a tap while the crafting modal is open (modal — always consumes). */
  private handleCraftClick(x: number, y: number): boolean {
    if (!this.craftOpen) return false;
    const b = this.registry.get('craftBounds') as { rows: Array<{ x: number; y: number; w: number; h: number; idx: number }>; craft: { x: number; y: number; w: number; h: number }; close: { x: number; y: number; w: number; h: number }; panel: { x: number; y: number; w: number; h: number } } | null;
    if (!b) return true;
    const hit = (r: { x: number; y: number; w: number; h: number }) => x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;
    if (hit(b.close)) { this.closeCraft(); return true; }
    const row = b.rows.find((r) => hit(r));
    if (row) { this.craftSel = row.idx; this.craftMsg = ''; this.publishCraft(); return true; }
    if (hit(b.craft)) { this.doCraft(); return true; }
    if (!hit(b.panel)) this.closeCraft(); // tap outside → close
    return true; // modal — swallow everything else
  }

  /** Route a tap while the unified menu is open. Priority (topmost first): receipt →
   *  quantity keypad → item action menu → close button → tabs → item/mail row →
   *  tap-away close. */
  private handleMenuClick(x: number, y: number): boolean {
    if (!this.menuOpen) return false;
    // A receipt (opened from the Mail tab) sits ON TOP — the ✓ or a tap outside closes.
    if (this.openMailId !== null) {
      const rc = this.registry.get('receiptClose') as { x: number; y: number; w: number; h: number } | null;
      const onOk = !!rc && x >= rc.x && x <= rc.x + rc.w && y >= rc.y && y <= rc.y + rc.h;
      if (onOk || !this.overPanel('receiptPanel', x, y)) this.closeReceipt();
      return true;
    }
    // "Sell how many?" keypad.
    if (this.menuItemQty) { const k = this.menuKeypadKeyAt(x, y); if (k) this.handleMenuKeypadKey(k); else this.closeMenuItemMenu(); return true; }
    // Hotbar slot picker ("进 Hotbar" → pick a slot).
    if (this.menuSlotPick) {
      const key = this.menuKeypadKeyAt(x, y); // slot picker buttons are tagged 'slot<i>'
      if (key && key.startsWith('slot')) this.placeChestToHotbar(this.menuSlotPick.index, parseInt(key.slice(4), 10));
      else this.closeMenuItemMenu();
      return true;
    }
    // Item action menu (进 Hotbar / Sell / 给 Cato / 放回箱子 / Delete).
    if (this.menuItemMenu) {
      const opt = this.menuActionOptionAt(x, y);
      const it = this.menuStore()[this.menuItemMenu.index];
      if (opt === 'use') { const idx = this.menuItemMenu.index; this.closeMenuItemMenu(); this.menuUse(idx); }
      else if (opt === 'store' && it && !this.chestHasSpaceFor(it.id)) { this.closeMenuItemMenu(); this.flashShopMsg(t('bag_chest_full')); } // chest full → decline
      else if (opt === 'take' && it && !this.backpackHasSpaceFor(it.id)) { this.closeMenuItemMenu(); this.flashShopMsg(t('bag_full')); } // backpack full → decline
      else if (opt === 'give' && it && !this.catoBagHasSpaceFor(it.id)) { this.closeMenuItemMenu(); this.catoSay('chatter_bag_full'); } // Cato's bag is full → decline
      else if (opt === 'sell' || opt === 'give' || opt === 'tochest' || opt === 'store' || opt === 'take') this.openMenuKeypad(opt);
      else if (opt === 'feed') { const idx = this.menuItemMenu.index; this.closeMenuItemMenu(); this.menuFeed(idx); }
      else if (opt === 'delete') { const idx = this.menuItemMenu.index; this.closeMenuItemMenu(); this.menuPerformAction('delete', idx); }
      else this.closeMenuItemMenu();
      return true;
    }
    // Close button (top-right).
    const cb = this.registry.get('menuCloseBtn') as { x: number; y: number; w: number; h: number } | null;
    if (cb && x >= cb.x && x <= cb.x + cb.w && y >= cb.y && y <= cb.y + cb.h) { this.closeMenuViaX(); return true; }
    // Tab switch.
    const tabs = this.registry.get('menuTabs') as Array<{ x: number; y: number; w: number; h: number; tab: number }> | null;
    const tabHit = tabs?.find((t) => x >= t.x && x <= t.x + t.w && y >= t.y && y <= t.y + t.h);
    if (tabHit) { if (tabHit.tab !== this.menuTab) this.openMenu(tabHit.tab); return true; }
    // Backpack / Chest / Cato-bag: tap an item → select it (right detail) AND open its action menu.
    if (this.menuTab === TAB_BACKPACK || this.menuTab === 1 || this.menuTab === 2) {
      const idx = this.itemSlotAt('menuSlots', x, y);
      if (idx !== null && idx < this.menuStore().length) { this.menuSelected = idx; this.publishMenu(); this.openMenuItemMenu(idx, x, y); return true; }
    } else if (this.menuTab === 0) {
      // Mail: tap a row → open its receipt.
      const mid = this.menuMailRowAt(x, y);
      if (mid) { this.openReceipt(mid); return true; }
    } else if (this.menuTab === 3) {
      // Shop: a stepper (−/+/buy) acts on the selected item; a catalog row selects it.
      const sk = this.menuStepperAt(x, y);
      if (sk) { this.menuShopStep(sk); return true; }
      const rid = this.menuShopRowAt(x, y);
      if (rid) { this.menuShopSel = rid; this.shopMsg = ''; this.publishMenu(); return true; }
    } else if (this.menuTab === 4) {
      // Settings: tap/drag the volume bar to set the level; tap 返回标题 to go back.
      const slider = this.menuSliderAt(x, y);
      if (slider) { this.menuApplySliderVol(slider, x); return true; }
      const back = this.registry.get('menuSettingsBack') as { x: number; y: number; w: number; h: number } | null;
      if (back && x >= back.x && x <= back.x + back.w && y >= back.y && y <= back.y + back.h) { this.returnToTitle(); return true; }
      const clr = this.registry.get('menuClearData') as { x: number; y: number; w: number; h: number } | null;
      if (clr && x >= clr.x && x <= clr.x + clr.w && y >= clr.y && y <= clr.y + clr.h) { void this.clearDataAndReturnToTitle(); return true; }
      // Debug toggles: flip the flag (persists to localStorage) + re-render the checkbox.
      const dbg = this.registry.get('menuDebugRows') as Array<{ x: number; y: number; w: number; h: number; key: string }> | null;
      const row = dbg?.find((r) => x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h);
      if (row) { toggleDebug(row.key); this.publishMenu(); return true; }
    }
    // Tap outside the panel → close.
    if (!this.overPanel('menuPanel', x, y)) this.closeMenu();
    return true;
  }

  /** Which Settings-tab volume slider (if any) the point is over — its published
   *  track rect. Used for BOTH a tap and the start of a drag. */
  private menuSliderAt(x: number, y: number): 'bgm' | 'sfx' | null {
    const hit = (key: string): boolean => {
      const r = this.registry.get(key) as { x: number; y: number; w: number; h: number } | null;
      return !!r && x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;
    };
    if (this.menuTab !== 4) return null;
    if (hit('menuSettingsTrack')) return 'bgm';
    if (hit('menuSfxTrack')) return 'sfx';
    return null;
  }

  /** Set a Settings-tab volume from the pointer x over its track (tap or drag). */
  private menuApplySliderVol(which: 'bgm' | 'sfx', x: number): void {
    const key = which === 'bgm' ? 'menuSettingsTrack' : 'menuSfxTrack';
    const r = this.registry.get(key) as { x: number; y: number; w: number; h: number } | null;
    if (!r || !(r.w > 0)) return; // no track / not laid out yet → nothing to scrub
    const v = Phaser.Math.Clamp((x - r.x) / r.w, 0, 1);
    if (which === 'bgm') setBgmVolume(this, v); else setSfxVolume(this, v);
    this.publishMenu();          // re-render the slider fill/knob
    playSfx(this, SFX_SCROLL);   // scrub tick at the new level
  }

  /** Return to the title screen from the in-game SETTINGS tab: flush the save (so Play
   *  reloads this state), tear down the game's HUD/overlay scenes, and re-enter BootScene
   *  (which routes to the boot/title screen). */
  /** Settings → wipe THIS user's save, then return to the title (a fresh reload) so
   *  the next Play runs the full new-game opening flow. Disarms + cancels any pending
   *  save first so nothing re-writes the delete. */
  private clearDataAndReturnToTitle(): void {
    this.saveArmed = false;
    this.pendingSave?.remove();
    try { localStorage.removeItem('catopia:laptopDone'); } catch { /* no storage */ } // replay the laptop cold-open on a fresh start
    coverAndReload(this, 'paw', async () => {
      try { await this.umicat?.saves.delete('state'); }
      catch (e) { console.warn('[catopia] clear save failed', e); }
      if (typeof window !== 'undefined') window.location.reload();
    }, 800); // the paw close is the last thing shown before the hard reload
  }

  /** Return to the title. Dissolve to white, flush the save, then HARD-RELOAD — a
   *  reload (not a Phaser scene restart) because GameScene holds heavy state the
   *  scene manager would NOT reset on a restart (the instance is reused), which hung
   *  the second entry on "loading" (gameReady stayed true → markReady bailed). */
  private returnToTitle(): void {
    coverAndReload(this, 'paw', async () => {
      try { if (this.umicat && this.saveArmed && !this.loadingSave) await this.umicat.saves.set('state', this.buildSave()); }
      catch (e) { console.warn('[catopia] save flush before title failed', e); }
      if (typeof window !== 'undefined') window.location.reload();
    }, 800);
  }

  // ── Unified-menu item action menu + keypad (mirrors the mailbox/chest flow, but
  //    rendered by MenuScene via the `menuAction` registry key) ───────────────────

  /** Item actions for the active grid. CHEST (tab 1): 进 Hotbar (usable items only) / Sell
   *  (if it has a sell price) / 给 Cato (into Cato's bag) / Delete. CATO-BAG (tab 2): 放回箱子
   *  (back to the chest) / Delete. (Future: a "喂 Cato" action when he's tired + it's food.) */
  private menuItemOptions(index: number): Array<{ action: MenuItemAction; label: string }> {
    const it = this.menuStore()[index];
    const opts: Array<{ action: MenuItemAction; label: string }> = [];
    // USE = hold this item straight from the store as the active tool / seed / material.
    if (it && isHotbarUsable(it)) opts.push({ action: 'use', label: t('action_use') });
    if (this.menuTab === TAB_BACKPACK) { // Backpack (shared w/ Cato): use / feed / store→chest / delete
      if (it && isFood(it.id)) opts.push({ action: 'feed', label: t('action_feed') }); // hand-feed Cato from the shared bag
      opts.push({ action: 'store', label: t('action_store') });
      opts.push({ action: 'delete', label: t('action_delete') });
      return opts;
    }
    // Chest (pure storage): Take → backpack, Sell, Delete. (No 'give' — Cato shares the backpack now.)
    opts.push({ action: 'take', label: t('action_take') });
    if (it && sellPrice(it.id) > 0) opts.push({ action: 'sell', label: t('action_sell') });
    opts.push({ action: 'delete', label: t('action_delete') });
    return opts;
  }

  private openMenuItemMenu(index: number, sx: number, sy: number): void {
    this.menuItemMenu = { index, x: sx, y: sy };
    this.registry.set('menuAction', {
      visible: true, rev: ++this.menuActionRev, x: sx, y: sy,
      options: this.menuItemOptions(index).map((o) => ({ label: o.label })),
    });
  }

  private closeMenuItemMenu(): void {
    if (!this.menuItemMenu && !this.menuItemQty && !this.menuSlotPick) return;
    this.menuItemMenu = null; this.menuItemQty = null; this.menuSlotPick = null;
    this.registry.set('menuAction', { visible: false, rev: ++this.menuActionRev });
  }

  /** Swap the action menu for the "how many?" keypad (Sell / 给 Cato / 放回箱子 → pick a quantity). */
  private openMenuKeypad(action: 'sell' | 'give' | 'tochest' | 'store' | 'take'): void {
    const m = this.menuItemMenu;
    if (!m) return;
    const it = this.menuStore()[m.index];
    if (!it) { this.closeMenuItemMenu(); return; }
    this.menuItemMenu = null;
    this.menuItemQty = { action, index: m.index, x: m.x, y: m.y, value: it.count, max: it.count, entering: false };
    this.publishMenuKeypad();
  }

  /** "进 Hotbar" → show the 8 hotbar slots (number + current icon) to pick a target. */
  private openMenuSlotPick(index: number, sx: number, sy: number): void {
    this.menuSlotPick = { index, x: sx, y: sy };
    this.menuItemMenu = null;
    const slots = [];
    for (let i = 0; i < INV_COLS; i++) {
      const it = this.inventory[i];
      slots.push({ label: String(i + 1), iconKey: it?.iconKey, iconFrame: it?.iconFrame });
    }
    this.registry.set('menuAction', { visible: true, rev: ++this.menuActionRev, x: sx, y: sy, slotpick: { slots } });
  }

  /** Move a chest item into hotbar slot `hotbarSlot`; the displaced hotbar item (if any)
   *  goes back into the chest. */
  private placeChestToHotbar(chestIndex: number, hotbarSlot: number): void {
    const it = this.chestStore[chestIndex];
    if (!it || hotbarSlot < 0 || hotbarSlot >= INV_COLS) { this.closeMenuItemMenu(); return; }
    this.chestStore.splice(chestIndex, 1);
    const displaced = this.inventory[hotbarSlot];
    this.inventory[hotbarSlot] = it;
    if (displaced) this.addToChest(displaced);
    this.closeMenuItemMenu();
    this.publishInventory();
    const len = this.menuStore().length;
    if (this.menuSelected >= len) this.menuSelected = len - 1;
    this.publishMenu();
    this.scheduleSave();
  }

  private publishMenuKeypad(): void {
    const q = this.menuItemQty;
    if (!q) return;
    this.registry.set('menuAction', { visible: true, rev: ++this.menuActionRev, x: q.x, y: q.y, keypad: { value: q.value, max: q.max } });
  }

  private handleMenuKeypadKey(k: string): void {
    const q = this.menuItemQty;
    if (!q) return;
    if (k === 'cancel') { this.closeMenuItemMenu(); return; }
    if (k === 'ok') { const n = Phaser.Math.Clamp(q.value, 1, q.max); this.menuPerformAction(q.action, q.index, n); this.closeMenuItemMenu(); return; }
    if (k === 'inc') { q.value = Math.min(q.max, q.value + 1); q.entering = true; }
    else if (k === 'dec') { q.value = Math.max(1, q.value - 1); q.entering = true; }
    else {
      const d = parseInt(k, 10);
      if (Number.isNaN(d)) return;
      q.value = q.entering ? Math.min(q.max, q.value * 10 + d) : d;
      q.entering = true;
      if (q.value < 1) q.value = 1;
    }
    this.publishMenuKeypad();
  }

  /** Run an action on the ACTIVE grid store (chest or Cato-bag) for `qty`, then refresh
   *  the menu + save. Sell → instant coins; give → into Cato's bag; tochest → into the
   *  chest; delete → discard. (进 Hotbar is a separate slot-picker path, not here.) */
  private menuPerformAction(action: 'sell' | 'give' | 'tochest' | 'store' | 'take' | 'delete', index: number, qty?: number): void {
    const src = this.menuStore();
    const it = src[index];
    if (!it) return;
    const n = Math.min(qty ?? it.count, it.count);
    if (n <= 0) return;
    if (action === 'sell') this.addMoney(sellPrice(it.id) * n);
    else if (action === 'give') {
      if (!this.catoBagHasSpaceFor(it.id)) { this.catoSay('chatter_bag_full'); return; } // safety: bag filled since the menu opened
      this.addToStore(this.catoBagStore, { ...it, count: n }); // chest → Cato's bag
    }
    else if (action === 'tochest') this.addToStore(this.chestStore, { ...it, count: n }); // Cato's bag → chest
    else if (action === 'store') { // backpack → chest
      if (!this.chestHasSpaceFor(it.id)) { this.flashShopMsg(t('bag_chest_full')); return; }
      this.addToStore(this.chestStore, { ...it, count: n });
    }
    else if (action === 'take') { // chest → backpack
      if (!this.backpackHasSpaceFor(it.id)) { this.flashShopMsg(t('bag_full')); return; }
      this.addToStore(this.backpackStore, { ...it, count: n });
    }
    it.count -= n;
    if (it.count <= 0) src.splice(index, 1);
    const len = this.menuStore().length;
    if (this.menuSelected >= len) this.menuSelected = len - 1; // stack emptied → clamp selection
    this.publishMenu();
    this.scheduleSave();
  }

  /** USE: hold the item straight from the chest / Cato-bag as the active tool / seed / material
   *  (via heldExternal — a seed decrements that stack when planted) + close the menu so you can
   *  use it right away. No moving it to the hotbar first. */
  private menuUse(index: number): void {
    const store = this.menuStore();
    const it = store[index];
    if (!it || !isHotbarUsable(it)) return;
    this.holdExternal(store, it);
    this.closeMenu();
    playSfx(this);
    // openMenu released pointer lock; re-capture it (desktop) so the very next click USES the item
    // (plants / places) instead of just re-locking. Touch never locks — taps route directly.
    if (!this.input.activePointer.wasTouch) this.input.manager.mouse?.requestPointerLock();
  }

  /** Which action (if any) is under a tap on the unified menu's action menu. */
  private menuActionOptionAt(x: number, y: number): MenuItemAction | null {
    const bounds = this.registry.get('menuActionBounds') as Array<{ x: number; y: number; w: number; h: number; idx?: number }> | undefined;
    if (!bounds || !this.menuItemMenu) return null;
    const hit = bounds.find((b) => x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h);
    if (!hit || hit.idx == null) return null;
    return this.menuItemOptions(this.menuItemMenu.index)[hit.idx]?.action ?? null;
  }

  /** Which keypad key (if any) is under a tap on the unified menu's keypad. */
  private menuKeypadKeyAt(x: number, y: number): string | null {
    const bounds = this.registry.get('menuActionBounds') as Array<{ x: number; y: number; w: number; h: number; key?: string }> | undefined;
    if (!bounds) return null;
    const hit = bounds.find((b) => b.key != null && x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h);
    return hit?.key ?? null;
  }

  /** Is (x,y) on a unified-menu Mail row? Reads the bounds MenuScene published. */
  private menuMailRowAt(x: number, y: number): string | null {
    const rows = this.registry.get('menuMailRows') as Array<{ x: number; y: number; w: number; h: number; id: string }> | null;
    const hit = rows?.find((r) => x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h);
    return hit ? hit.id : null;
  }

  /** Is (x,y) on the unified menu's scroll rail? (Reads the rail MenuScene published.) */
  private menuRailAt(x: number, y: number): boolean {
    const r = this.registry.get('menuRail') as { x: number; top: number; bottom: number; max: number } | null;
    return !!r && r.max > 0 && Math.abs(x - r.x) < 40 && y >= r.top - 30 && y <= r.bottom + 30;
  }

  /** Drag the rail → 0..1 scroll fraction (MenuScene owns the row offset + reads this). */
  private menuDragTo(y: number): void {
    const r = this.registry.get('menuRail') as { x: number; top: number; bottom: number; max: number } | null;
    if (!r || r.max <= 0) return;
    this.registry.set('menuScrollFrac', Phaser.Math.Clamp((y - r.top) / (r.bottom - r.top), 0, 1));
  }
  /** Which store index (if any) is under a tap on the unified menu's item grid. */
  private itemSlotAt(key: 'menuSlots', x: number, y: number): number | null {
    const slots = this.registry.get(key) as Array<{ x: number; y: number; w: number; h: number; index: number }> | undefined;
    if (!slots) return null;
    const hit = slots.find((s) => x >= s.x && x <= s.x + s.w && y >= s.y && y <= s.y + s.h);
    return hit ? hit.index : null;
  }

  // ── Shop catalog (unified menu Shop tab) ─────────────────────────────────────

  /** The orderable catalog — every item with a `buy` price in the prices data table.
   *  Label + icon come from `itemFromId(id)`; the price from the table. */
  private orderCatalog(): OrderCatalogEntry[] {
    return ORDERABLE_IDS.map((id) => {
      const it = itemFromId(id, 1);
      return { id, label: this.orderLabel(id, it), iconKey: it.iconKey ?? 'fruit-items', iconFrame: it.iconFrame ?? 0, price: buyPrice(id) ?? 0 };
    });
  }

  /** Nicer catalog label: tree items read "<name> seedling". */
  private orderLabel(id: string, it: ItemStack): string {
    const base = it.label ?? id;
    return id.startsWith('tree-') ? `${base} seedling` : base;
  }

  private priceOf(id: string): number { return buyPrice(id) ?? 0; }

  /** Day rollover hook. Buying + selling are now INSTANT (into/out of the chest), so
   *  there's no overnight shipping-bin settlement or order delivery any more — this is a
   *  no-op kept as the seam for any future daily event (weather, growth, AI, …). */
  private settleDay(): void {
    /* instant economy — nothing to settle at the day boundary */
  }

  /** Add a new mail (newest first) + refresh the unified menu if it's open on the Mail tab. */
  private addMail(mail: Omit<MailEntry, 'id' | 'read'>): void {
    this.mailList.unshift({ ...mail, id: `mail-${++this.mailIdSeq}`, read: false });
    if (this.menuOpen) this.publishMenu();
  }

  /** The Mail-tab list model (icon + sender + read state) for the unified menu. */
  private mailListModel(): MailListEntry[] {
    return this.mailList.map((m) => ({ id: m.id, sender: m.sender, title: m.title, iconFrame: m.iconFrame, read: m.read }));
  }

  /** Open a mail → its receipt (over the menu); mark it read. */
  private openReceipt(id: string): void {
    const mail = this.mailList.find((m) => m.id === id);
    if (!mail) return;
    this.openMailId = id;
    if (!mail.read) { mail.read = true; if (this.menuOpen) this.publishMenu(); this.scheduleSave(); }
    // Render ABOVE whatever modal opened it (the unified MenuScene is brought to top,
    // so the receipt must jump above it too); keep the cursor topmost.
    this.scene.bringToTop('ReceiptScene');
    this.scene.bringToTop('CursorScene');
    this.registry.set('receipt', { visible: true, rev: ++this.receiptRev, sender: mail.sender, title: mail.title, lines: mail.lines, total: mail.total });
  }

  private closeReceipt(): void {
    if (this.openMailId === null) return;
    this.openMailId = null;
    this.registry.set('receipt', { visible: false, rev: ++this.receiptRev });
  }

  /** Per-frame: swing each PLACED door open when Cato is within OPEN_R and shut it
   *  again beyond CLOSE_R (hysteresis so it never closes on him). */
  private updateDoors(): void {
    if (!this.child) return;
    const OPEN_R = TILE * 1.5;   // Cato this close (world px) → open
    const CLOSE_R = TILE * 2.2;  // ... this far → close
    for (const o of this.placed.values()) {
      if (o.kind !== 'door' || o.animating) continue;
      const bx = o.sprite.x;            // base-cell centre X
      const by = o.sprite.y - TILE / 2; // base-cell centre Y (sprite is origin-bottom)
      const d = Math.hypot(bx - this.child.x, by - this.child.y);
      if (!o.open && d < OPEN_R) this.setDoorOpen(o, true);
      else if (o.open && d > CLOSE_R) this.setDoorOpen(o, false);
    }
  }

  /** Toggle a door: play the swing, and enable/disable its collider so Cato can (or
   *  can't) pass. The collider drops immediately on open; it re-arms only after the
   *  close swing finishes (and only fires when Cato is already clear). */
  private setDoorOpen(o: PlacedObj, open: boolean): void {
    o.open = open;
    o.animating = true;
    const setEnabled = (on: boolean) => o.bodies?.forEach((b) => { (b.body as Phaser.Physics.Arcade.StaticBody).enable = on; });
    if (open) setEnabled(false);
    o.sprite.play(open ? 'door-open' : 'door-close');
    o.sprite.once(Phaser.Animations.Events.ANIMATION_COMPLETE, () => {
      o.animating = false;
      o.frame = o.sprite.frame.name as unknown as number; // remember the resting frame
      if (!open) setEnabled(true);
    });
  }

  /** Invisible static collider(s) at a cell, matching the SOLID region of the given
   *  texture frame — so a thin side-wall strip only blocks Cato where the wall is.
   *  For walls, the collision shape is **authored in the Tileset Editor** (per-tile
   *  `collisionRects`, read from the manifest) — one body per rect (supports L/U
   *  corner shapes). Falls back to the opaque-pixel bounding box when a frame has no
   *  authored collision (and always for the door, which isn't a tileset). */
  /** SDK-bug workaround: the tilemap sub-tile collider (`syncSubTileBodies`)
   *  builds a static body for EVERY tile that has `collisionRects`, IGNORING the
   *  tile's `solid` flag. Our floor (frame 6, authored `solid:false`) keeps a
   *  leftover seed rect that the manifest metadata-sync KEEPS re-adding from the
   *  asset record on each Build — so clearing it in the manifest doesn't stick and
   *  the floor collides again after every save. Strip the sub-tile bodies sitting
   *  on frame-6 (floor) cells so Cato can always walk into the house. Runs every
   *  load, so it's immune to the manifest/record round-trip. (Real fix belongs in
   *  the SDK: skip a tile's collisionRects when `solid === false`.) */
  private stripFloorColliders(): void {
    const layer = this.wallLayer;
    if (!layer) return;
    const grp = layer.getData('unboxySubTileStaticGroup') as
      | Phaser.Physics.Arcade.StaticGroup
      | undefined;
    if (!grp) return;
    let stripped = 0;
    for (const body of grp.getChildren().slice()) {
      const go = body as Phaser.GameObjects.GameObject & { x: number; y: number };
      const t = layer.worldToTileXY(go.x, go.y);
      if (!t) continue;
      const tile = layer.getTileAt(Math.floor(t.x), Math.floor(t.y));
      if (tile?.index === FLOOR_FRAME) { grp.remove(body, true, true); stripped++; }
    }
    if (stripped) console.warn(`[catopia] stripped ${stripped} floor collider(s) (SDK solid:false bug workaround)`);
  }

  /** Give the editor-authored FURNITURE sprites (the `basic_furniture` atlas,
   *  frame = region name) real collision + block their cells for pathfinding.
   *  Each SOLID piece (see NON_SOLID_FURNITURE for the exceptions) gets one
   *  invisible static body in `wallGroup` sized to its footprint, so Cato bumps
   *  it and routes around it. Called once after the tilemap layers resolve;
   *  these are fixed decor, so there's no teardown/refund. */
  private wireHouseFurniture(): void {
    const reg = getEntityRegistry(this);
    const layer = this.islandLayer;
    if (!reg || !layer || !this.wallGroup) return;
    const sprites = reg.all().filter(
      (go) => go.getData('entityAssetId') === 'basic_furniture', // SDK's key (NOT 'assetId')
    ) as Phaser.GameObjects.Sprite[];
    for (const s of sprites) {
      const frameName = String(s.frame?.name ?? s.getData('frame') ?? '');
      // Rugs lie flat: fixed low depth + out of the y-sort so furniture drops on
      // top of them and Cato walks over them (never occluded by a rug).
      if (frameName.startsWith('rug')) {
        s.setDepth(RUG_DEPTH);
        this.ySortSprites = this.ySortSprites.filter((g) => g !== s);
        continue;
      }
      if (BED_FRAMES.has(frameName)) {
        // Walkable (no collider) + y-sort by the bed's TOP edge, so Cato lying on
        // the bed draws OVER it (his feet sit below the top) while a north-side
        // approach still gets occluded by the headboard.
        s.setData('ysortBias', -s.displayHeight);
        continue;
      }
      if (NON_SOLID_FURNITURE.has(frameName)) continue;
      const b = s.getBounds();
      const inset = 2; // pull the box in from the art edge so Cato can nuzzle up
      const bw = Math.max(4, b.width - inset * 2);
      const bh = Math.max(4, b.height - inset * 2);
      const body = this.wallGroup.create(b.centerX, b.centerY, '__WHITE') as Phaser.Physics.Arcade.Sprite;
      body.setVisible(false).setDisplaySize(bw, bh).refreshBody();
      // Block every cell whose centre falls inside the footprint (tight — a hair
      // of padding won't sacrifice a neighbouring walkable cell).
      const t0 = layer.worldToTileXY(b.left + inset, b.top + inset);
      const t1 = layer.worldToTileXY(b.right - inset, b.bottom - inset);
      if (t0 && t1) {
        for (let cy = Math.floor(t0.y); cy <= Math.floor(t1.y); cy++) {
          for (let cx = Math.floor(t0.x); cx <= Math.floor(t1.x); cx++) {
            const c = layer.tileToWorldXY(cx, cy);
            if (!c) continue;
            const ccx = c.x + 8, ccy = c.y + 8; // cell centre (16px tiles)
            if (ccx >= b.left + inset && ccx <= b.right - inset && ccy >= b.top + inset && ccy <= b.bottom - inset)
              this.houseBlocked.add(`${cx},${cy}`);
          }
        }
      }
    }
  }

  private addSolid(cx: number, cy: number, texture: string, frame: number): Phaser.Physics.Arcade.Sprite[] {
    const w = this.islandLayer!.tileToWorldXY(cx, cy)!;
    let rects: Array<{ x: number; y: number; w: number; h: number }>;
    if (texture === 'house-walls') {
      const tile = this.wallTile(frame);
      // FLOOR tiles are authored NON-solid in the Tileset Editor (`solid:false`) →
      // no collider, so Cato can walk on them. Walls are solid → collide.
      if (tile?.solid === false) return [];
      rects = tile?.collisionRects?.length ? tile.collisionRects : [this.frameSolidRect(texture, frame)];
    } else {
      rects = [this.frameSolidRect(texture, frame)];
    }
    return rects.map((r) => {
      const body = this.wallGroup!.create(w.x + r.x + r.w / 2, w.y + r.y + r.h / 2, '__WHITE') as Phaser.Physics.Arcade.Sprite;
      body.setVisible(false).setDisplaySize(r.w, r.h).refreshBody();
      return body;
    });
  }

  /** The wall tileset's per-tile metadata for a frame (`solid` + `collisionRects`),
   *  authored in the Tileset Editor UI (`asset.tileset.tiles[frame]`, carried in the
   *  manifest). Cached. `solid:false` = a walkable floor tile. */
  private wallTiles?: Record<number, { solid?: boolean; collisionRects?: Array<{ x: number; y: number; w: number; h: number }> }> | null;
  private wallTile(frame: number): { solid?: boolean; collisionRects?: Array<{ x: number; y: number; w: number; h: number }> } | undefined {
    if (this.wallTiles === undefined) {
      const asset = getManifest(this)?.assets?.find((a: { textureKey?: string }) => a.textureKey === 'house-walls') as
        | { tileset?: { tiles?: Record<number, { solid?: boolean; collisionRects?: Array<{ x: number; y: number; w: number; h: number }> }> } }
        | undefined;
      this.wallTiles = asset?.tileset?.tiles ?? null;
    }
    return this.wallTiles?.[frame];
  }

  /** The opaque bounding box (local px within the frame) of a texture frame —
   *  computed once by reading its pixels (CDN uploads are CORS-clean, so no taint;
   *  same read as buildSoilGrassSheet). Used to size wall/door colliders to the art. */
  private solidRectCache = new Map<string, { x: number; y: number; w: number; h: number }>();
  private frameSolidRect(key: string, frame: number | string): { x: number; y: number; w: number; h: number } {
    const ck = `${key}:${frame}`;
    const hit = this.solidRectCache.get(ck);
    if (hit) return hit;
    const tex = this.textures.get(key);
    const f = tex.get(frame);
    const cw = f.cutWidth, ch = f.cutHeight;
    const full = { x: 0, y: 0, w: cw, h: ch };
    try {
      const src = tex.getSourceImage() as CanvasImageSource;
      const cv = document.createElement('canvas'); cv.width = cw; cv.height = ch;
      const ctx = cv.getContext('2d'); if (!ctx) throw 0;
      ctx.drawImage(src, f.cutX, f.cutY, cw, ch, 0, 0, cw, ch);
      const d = ctx.getImageData(0, 0, cw, ch).data;
      let minx = cw, miny = ch, maxx = -1, maxy = -1;
      for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) {
        if (d[(y * cw + x) * 4 + 3]! > 20) { if (x < minx) minx = x; if (x > maxx) maxx = x; if (y < miny) miny = y; if (y > maxy) maxy = y; }
      }
      const rect = maxx < 0 ? full : { x: minx, y: miny, w: maxx - minx + 1, h: maxy - miny + 1 };
      this.solidRectCache.set(ck, rect);
      return rect;
    } catch {
      this.solidRectCache.set(ck, full); // pixel read failed → fall back to the full tile
      return full;
    }
  }

  /** A sprite's TIGHT world bounding box — the opaque-pixel bbox of its current frame mapped to
   *  world coords (via getBounds for the full frame + origin/scale, then inset to the solid
   *  region; flip-aware). Used by the hover frame so the bracket hugs the ART, not the frame's
   *  transparent padding (a 48×48 sprite whose cat/tree fills a small patch). Cached per frame. */
  private spriteWorldSolidRect(s: Phaser.GameObjects.Sprite | Phaser.GameObjects.Image): { x: number; y: number; w: number; h: number } {
    const f = s.frame;
    const b = s.getBounds(); // full-frame world rect (handles origin/scale/rotation)
    const fw = f.cutWidth, fh = f.cutHeight;
    if (!fw || !fh) return { x: b.x, y: b.y, w: b.width, h: b.height };
    const local = this.frameSolidRect(s.texture.key, f.name);
    const kx = b.width / fw, ky = b.height / fh; // world px per frame px
    const lx = s.flipX ? fw - local.x - local.w : local.x; // mirror the solid x under flipX
    const ly = s.flipY ? fh - local.y - local.h : local.y;
    return { x: b.x + lx * kx, y: b.y + ly * ky, w: local.w * kx, h: local.h * ky };
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
    this.settleLoosened(cx, cy); // planting cancels any pending "hoed once" furrows
    this.dirtBurst(footX, footY); // little poof as the seed goes in
    this.scheduleSave();
    return true;
  }

  /** Player plants with the selected seed bag: plant + consume one seed (empties
   *  the slot when the bag runs out). */
  private playerPlant(cx: number, cy: number): void {
    const bag = this.heldCell(); // the held seed — hotbar slot OR an external chest/Cato-bag stack
    if (!bag?.plants) return;
    if (!this.plantCropAt(cx, cy, bag.plants)) return;
    this.consumeHeldMaterial(); // decrement the held stack (handles hotbar null-out AND external splice)
  }

  /** PLAYER harvest of a MATURE crop → god-hand hoe swing, then (at the strike)
   *  the produce pops out + is banked (`reapCrop`). */
  private harvestCrop(cx: number, cy: number): void {
    const key = `${cx},${cy}`;
    const crop = this.crops.get(key);
    if (!crop || crop.stage < CROPS[crop.name].stages - 1) return;
    if (!this.backpackHasSpaceFor(`crop-${crop.name}`)) { this.notifyBagFull(); return; } // full → don't swing
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
    if (!this.backpackHasSpaceFor(`crop-${crop.name}`)) { this.notifyBagFull(); return false; } // full → leave it ripe
    this.crops.delete(key);
    crop.sprite.destroy();
    this.collect(makeCrop(crop.name, 1));
    this.catoReact('love'); // crop harvest
    this.catoLookAtTile(cx, cy);
    this.publishInventory();
    const w = this.islandLayer?.tileToWorldXY(cx, cy);
    if (w) this.playPopOut(w.x + TILE / 2, w.y + TILE / 2, 'farming_plants_items', `crop-${crop.name}`);
    return true;
  }

  /** An item icon jumps OUT of the ground in a semicircular arc to one side,
   *  bounces once, wobbles its size for cuteness, then vanishes. Pure flair —
   *  the item is already banked in the inventory. Shared by crop harvest + house
   *  tile removal. */
  /** Fruit-harvest flourish: a fruit appears ON THE GROUND at (x,y) with a little landing
   *  pop, holds a beat, then floats up + fades (collected). Used for tree fruit, whose sheet
   *  already animates the fall — so this reads as picking up what fell, not a fresh pop. */
  private playFruitCollect(x: number, y: number, texture: string, frame: string | number): void {
    const item = this.add.image(x, y, texture, frame).setOrigin(0.5, 0.5).setDepth(1e6 + 2).setScale(0);
    this.tweens.add({
      targets: item, scale: 1, duration: 160, ease: 'Back.easeOut',
      onComplete: () => this.tweens.add({
        targets: item, y: y - 14, alpha: 0, duration: 300, delay: 220, ease: 'Quad.easeIn',
        onComplete: () => item.destroy(),
      }),
    });
  }

  private playPopOut(centerX: number, centerY: number, texture: string, frame: string | number): void {
    const item = this.add
      .image(centerX, centerY, texture, frame)
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
  /** Deposit `item` into the backpack (merge into stacks, then a free slot). Returns
   *  the LEFTOVER count that didn't fit (0 = all deposited) — callers that split a
   *  known quantity need this to know how much was actually taken. */
  private addToInventory(item: ItemStack): number {
    if (item.stackable) {
      for (const cell of this.inventory) {
        if (cell && cell.id === item.id && cell.stackable && cell.count < MAX_STACK) {
          const moved = Math.min(MAX_STACK - cell.count, item.count);
          cell.count += moved;
          item.count -= moved;
          if (item.count <= 0) return 0;
        }
      }
    }
    const free = this.inventory.findIndex((c) => c === null);
    if (free >= 0) { this.inventory[free] = item; return 0; }
    return item.count; // no room → this many dropped
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
      const def = CROPS[crop.name];
      const need = wet ? def.growWateredMs : def.growDryMs;
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

  /** Hoe an EMPTY tilled cell. The hoe swings; at the strike we decide by the
   *  cell's state: first hit "loosens" it (furrow-lines mark + a short revert
   *  timer); a second hit while still loosened DIGS IT UP back to grass. If the
   *  timer lapses first, `settleLoosened` clears the furrows and it stays dirt. */
  private hoeEmptySoil(cx: number, cy: number): void {
    if (!this.islandLayer) return;
    const w = this.islandLayer.tileToWorldXY(cx, cy);
    if (!w) return;
    const centerX = w.x + TILE / 2;
    const centerY = w.y + TILE / 2;
    const key = `${cx},${cy}`;
    this.hoeSwingAt(centerX, centerY, () => {
      if (this.loosenedCells.has(key)) this.untillCell(cx, cy); // 2nd strike → grass
      else this.loosenCell(cx, cy);                             // 1st strike → furrows + timer
    });
  }

  /** Mark a tilled cell "loosened": show the furrow-lines overlay + start the
   *  revert timer. Hoe it again before the timer fires to dig it back to grass. */
  private loosenCell(cx: number, cy: number): void {
    if (!this.islandLayer) return;
    const key = `${cx},${cy}`;
    if (!this.tilledCells.has(key) || this.crops.has(key)) return;
    const prev = this.loosenedCells.get(key);
    if (prev) { prev.overlay.destroy(); prev.timer.remove(); }
    const w = this.islandLayer.tileToWorldXY(cx, cy);
    if (!w) return;
    // The furrow mark is baked into the LOWER part of tile (3,4) (rows ~10-11 of 16),
    // so nudge the overlay UP ~3px to sit it in the cell's visual centre.
    const overlay = this.add
      .image(w.x + TILE / 2, w.y + TILE / 2 - 3, 'tilled-dirt', SOIL_LOOSEN_FRAME)
      .setDepth(1.55);
    const timer = this.time.delayedCall(LOOSEN_WINDOW_MS, () => this.settleLoosened(cx, cy));
    this.loosenedCells.set(key, { overlay, timer });
  }

  /** The loosen window lapsed → drop the furrows; the cell stays plain tilled dirt. */
  private settleLoosened(cx: number, cy: number): void {
    const key = `${cx},${cy}`;
    const l = this.loosenedCells.get(key);
    if (!l) return;
    l.overlay.destroy();
    this.loosenedCells.delete(key);
  }

  /** Dig a tilled cell back UP to grass: remove its soil + border grass + wetness,
   *  and re-autotile the 4 neighbours (their edges/masks change). */
  private untillCell(cx: number, cy: number): void {
    const key = `${cx},${cy}`;
    const l = this.loosenedCells.get(key);
    if (l) { l.overlay.destroy(); l.timer.remove(); this.loosenedCells.delete(key); }
    if (!this.tilledCells.has(key)) return;
    const w = this.islandLayer?.tileToWorldXY(cx, cy);
    this.tilledCells.delete(key);
    this.tilledSoil.get(key)?.destroy();
    this.tilledSoil.delete(key);
    const grass = this.tilledGrass.get(key);
    if (grass) { for (const g of grass) g.destroy(); this.tilledGrass.delete(key); }
    this.soilWet.delete(key);
    if (w) this.dirtBurst(w.x + TILE / 2, w.y + TILE / 2); // clods fly as it's dug up
    this.refreshSoil(cx, cy - 1);
    this.refreshSoil(cx + 1, cy);
    this.refreshSoil(cx, cy + 1);
    this.refreshSoil(cx - 1, cy);
    this.scheduleSave();
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
      playSfx(this, SFX_HOE); // dig thunk as the hoe lands
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

  /** Create-or-update the soil sprite at a tilled cell with its autotile frame,
   *  then refresh its border grass tufts. */
  private refreshSoil(cx: number, cy: number): void {
    if (!this.islandLayer) return;
    const key = `${cx},${cy}`;
    if (!this.tilledCells.has(key)) return; // only tilled cells get soil
    const frame = this.tilledMask(cx, cy);
    const existing = this.tilledSoil.get(key);
    if (existing) {
      existing.setFrame(frame);
    } else {
      const w = this.islandLayer.tileToWorldXY(cx, cy);
      if (!w) return;
      const soil = this.add
        .image(w.x + TILE / 2, w.y + TILE / 2, 'tilled-soil', frame)
        .setDepth(1.5);
      this.tilledSoil.set(key, soil);
    }
    this.refreshSoilGrass(cx, cy);
  }

  // Grass-tuft overlay frames by the edge they decorate (indices into the
  // `soil-grass` sheet; some vertical variants reuse the other side FLIPPED).
  private static readonly SOIL_EDGES: ReadonlyArray<{
    dx: number; dy: number; variants: ReadonlyArray<{ f: number; flip: boolean }>;
  }> = [
    { dx: 0,  dy: -1, variants: [{ f: 0, flip: false }, { f: 1, flip: false }, { f: 2, flip: false }] }, // top
    { dx: 0,  dy: 1,  variants: [{ f: 3, flip: false }, { f: 4, flip: false }] },              // bottom
    { dx: -1, dy: 0,  variants: [{ f: 5, flip: false }, { f: 6, flip: false }] },              // left (side tiles)
    { dx: 1,  dy: 0,  variants: [{ f: 5, flip: true }, { f: 6, flip: true }] },                // right (side tiles, flipped)
  ];

  /** A stable [0,1) value from a cell + a salt — deterministic, so the border grass
   *  is the same every load (no save needed, no per-frame flicker). */
  private cellHash(cx: number, cy: number, salt: number): number {
    let h = Math.imul(cx | 0, 0x27d4eb2d) ^ Math.imul(cy | 0, 0x165667b1) ^ Math.imul(salt | 0, 0x9e3779b1);
    h ^= h >>> 15; h = Math.imul(h, 0x2c1b3c6d); h ^= h >>> 12;
    return ((h >>> 0) % 100000) / 100000;
  }

  /** Rebuild a tilled cell's border grass: a scattered tuft on each EXPOSED edge
   *  (side facing un-tilled ground), chosen deterministically so it's stable. */
  private refreshSoilGrass(cx: number, cy: number): void {
    const key = `${cx},${cy}`;
    const old = this.tilledGrass.get(key);
    if (old) { for (const g of old) g.destroy(); this.tilledGrass.delete(key); }
    if (!this.islandLayer || !this.tilledCells.has(key)) return;
    const w = this.islandLayer.tileToWorldXY(cx, cy);
    if (!w) return;
    const sprites: Phaser.GameObjects.Image[] = [];
    GameScene.SOIL_EDGES.forEach((e, ei) => {
      if (this.tilledCells.has(`${cx + e.dx},${cy + e.dy}`)) return; // interior edge → no border grass
      if (this.cellHash(cx, cy, ei + 1) >= GRASS_EDGE_CHANCE) return; // this edge rolled "bare"
      const v = e.variants[Math.floor(this.cellHash(cx, cy, (ei + 1) * 97) * e.variants.length)] ?? e.variants[0]!;
      const g = this.add.image(w.x + TILE / 2, w.y + TILE / 2, 'soil-grass', v.f).setDepth(1.6);
      if (v.flip) g.setFlipX(true);
      sprites.push(g);
    });
    if (sprites.length) this.tilledGrass.set(key, sprites);
  }

  // ── Cato behaviours (executing the AI's `do` actions) ─────────────────

  /** Dispatch the actions the AI chose this turn. Unknown actions are ignored
   *  (the AI can only propose from the declared vocabulary anyway). */
  private runCatoActions(actions: Array<{ name: string; args: unknown }>): void {
    // Out of energy → he can't do chores. Still honour a `set_behavior` pref, but refuse
    // the physical tasks + say he needs to rest first (safety net; the AI is also told via
    // the observation + a rule, so it usually says this itself without even calling one).
    if (this.exhausted && actions.some((a) => a.name !== 'set_behavior')) {
      for (const a of actions) if (a.name === 'set_behavior') this.setAutonomy(a.args);
      this.setImmediateDialog('Cato flops down with a tired little sigh — he needs to rest and get some energy back before he can do that.');
      return;
    }
    let acted = false;
    for (const a of actions) {
      if (a.name === 'till_plot') { this.startTillTask(a.args); acted = true; }
      else if (a.name === 'plant_crop') { this.startPlantTask(a.args); acted = true; }
      else if (a.name === 'water_crops') { this.startWaterTask(a.args); acted = true; }
      else if (a.name === 'harvest_crops') { this.startHarvestTask(a.args); acted = true; }
      else if (a.name === 'chop_trees') { this.startChopTask(a.args); acted = true; }
      else if (a.name === 'harvest_fruit') { this.startFruitTask(a.args); acted = true; }
      else if (a.name === 'mine_stones') { this.startMineTask(a.args); acted = true; }
      else if (a.name === 'harvest_bushes') { this.startBushTask(a.args); acted = true; }
      else if (a.name === 'forage') { this.startForageTask(a.args); acted = true; }
      else if (a.name === 'set_behavior') { this.setAutonomy(a.args); } // standing pref, not a walk-off task
    }
    // Let the friend read Cato's reply, then close the chat so he walks off to
    // do it (he already starts moving; this just gets the box out of the way).
    if (acted) {
      this.time.delayedCall(1300, () => { if (this.dialogOpen) this.closeDialog(); });
    }
  }

  /** Apply an AI `set_behavior` call — the friend told Cato (in chat) whether to tend
   *  the farm on his own. Only the provided fields change; persists as a standing pref. */
  private setAutonomy(rawArgs: unknown): void {
    const a = (rawArgs ?? {}) as { harvest?: boolean; water?: boolean };
    if (typeof a.harvest === 'boolean') this.autonomy.harvest = a.harvest;
    if (typeof a.water === 'boolean') this.autonomy.water = a.water;
    this.scheduleSave();
  }

  /** Autonomous chores: when Cato is free + it's enabled, quietly go tend the farm
   *  (harvest ripe crops, else water dry ones) instead of aimless wandering. No camera
   *  snap (unlike a friend-commanded task) — he just ambles over on his own. Returns
   *  true if a chore was started. */
  private tryAutoChore(): boolean {
    if (this.exhausted || this.catoTask || this.catoCurious || this.dialogOpen || !this.islandLayer || !this.child) return false;
    const layer = this.islandLayer;
    const task = (type: string, queue: Array<{ cx: number; cy: number }>, crop: string) => {
      this.catoTask = { type, queue, crop, cooldown: 0, strikes: 0, walkMs: 0, walkDist: Infinity, stand: null, path: null } as typeof this.catoTask;
    };
    // Announce EACH task's start ("apples are ripe → going to pick them"), but track
    // the session so the "all done" fires only ONCE at the end (below) — where nothing
    // can clobber it. Between chained tasks there's an idle gap, so starts don't overlap.
    const begin = (kind: 'harvest' | 'water', startKey: string, cropName?: string) => {
      this.catoSay(startKey, cropName);
      this.choreSession = kind;
    };
    // NEARBY-ONLY: only tend targets roughly IN VIEW (within the leash radius of the
    // camera centre). Otherwise Cato roams the whole map off-screen after the 20-odd
    // scenery fruit trees — reads as aimless "oscillating, doing nothing". He stays on
    // screen doing visible work; pan the camera and he tends whatever you're looking at.
    const cam = this.cameras.main;
    const ccx = cam.worldView.centerX, ccy = cam.worldView.centerY;
    const R = this.wanderLeashRadius() * 1.15;
    const near = (cells: Array<{ cx: number; cy: number }>) => cells.filter((c) => {
      const w = layer.tileToWorldXY(c.cx, c.cy);
      return !!w && Math.hypot(w.x + TILE / 2 - ccx, w.y + TILE / 2 - ccy) <= R;
    });
    // Backpack full → Cato STOPS auto-harvesting (nowhere to put what he'd gather); he says so
    // ONCE (until it has room again) so you know why he paused. Watering yields no items → still ok.
    const bagFull = this.backpackStore.length >= BACKPACK_SLOTS;
    if (!bagFull) this.bagFullNotified = false;
    else if (this.autonomy.harvest && !this.bagFullNotified) { this.bagFullNotified = true; this.catoSay('chatter_pack_full'); }
    if (this.autonomy.harvest && !bagFull) {
      // 1. ripe CROPS
      const crops = near(this.findHarvestTargets(Infinity));
      if (crops.length) { task('harvest', crops, 'crops'); begin('harvest', 'chatter_harvest_start', this.crops.get(`${crops[0]!.cx},${crops[0]!.cy}`)?.name); return true; }
      // 2. tree FRUIT (ripe/bearing trees)
      const fruitCells = near(this.nearestCells([...this.trees].filter(([, tr]) => tr.hasFruit).map(([k]) => k), Infinity));
      if (fruitCells.length) { task('fruit', fruitCells, 'fruit'); begin('harvest', 'chatter_harvest_start', this.trees.get(`${fruitCells[0]!.cx},${fruitCells[0]!.cy}`)?.type); return true; }
      // 3. ripe BUSHES (berries)
      const bushCells = near(this.nearestCells([...this.bushes].filter(([, b]) => b.stage >= 2).map(([k]) => k), Infinity));
      if (bushCells.length) { task('bush', bushCells, 'berries'); begin('harvest', 'chatter_harvest_start', this.bushes.get(`${bushCells[0]!.cx},${bushCells[0]!.cy}`)?.type); return true; }
    }
    if (this.autonomy.water) {
      const cells = near(this.findWaterTargets(Infinity));
      if (cells.length) { task('water', cells, 'crops'); begin('water', 'chatter_water_start', this.crops.get(`${cells[0]!.cx},${cells[0]!.cy}`)?.name); return true; }
    }
    return false;
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
      this.setImmediateDialog("Cato pads around, but there's no clear ground nearby to dig.");
      return;
    }
    // A single active task; camera follows Cato so the friend watches him work.
    this.catoTask = { type: 'till', queue: cells, crop, cooldown: 0, strikes: 0, walkMs: 0, walkDist: Infinity, stand: null, path: null };
    this.cameraFollow = true;
  }

  /** Begin the "plant a crop" behaviour: sow `count` (0 = all) nearest empty
   *  tilled cells with the crop. Needs tilled soil to exist. */
  private startPlantTask(rawArgs: unknown): void {
    if (!this.islandLayer || !this.child) return;
    const args = (rawArgs ?? {}) as { crop?: string; count?: number };
    const crop = this.parseCrop(args.crop);
    if (!crop) {
      this.setImmediateDialog("Cato blinks — it doesn't have seeds for that. Try corn, carrot, tomato, eggplant, or pumpkin.");
      return;
    }
    const max = args.count && args.count > 0 ? Math.round(args.count) : Infinity;
    const cells = this.findEmptySoil(max);
    if (cells.length === 0) {
      this.setImmediateDialog('Cato looks for tilled soil to plant in — there’s none ready yet. Ask it to till a plot first!');
      return;
    }
    this.catoTask = { type: 'plant', queue: cells, crop: CROPS[crop].label, plantName: crop, cooldown: 0, strikes: 0, walkMs: 0, walkDist: Infinity, stand: null, path: null };
    this.cameraFollow = true;
  }

  /** Loose crop-name match against the (data-driven) crop list, or null. */
  private parseCrop(s: string | undefined): CropName | null {
    const t = (s ?? '').toLowerCase();
    return CROP_NAMES.find((n) => t.includes(n)) ?? null;
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
      this.setImmediateDialog("Cato peers around — nothing needs watering right now.");
      return;
    }
    this.catoTask = { type: 'water', queue: cells, crop: 'crops', cooldown: 0, strikes: 0, walkMs: 0, walkDist: Infinity, stand: null, path: null };
    this.cameraFollow = true;
  }

  /** Begin the "harvest crops" behaviour: reap `count` (0 = all) nearest RIPE
   *  crops (produce → the friend's backpack). */
  private startHarvestTask(rawArgs: unknown): void {
    if (!this.islandLayer || !this.child) return;
    const args = (rawArgs ?? {}) as { count?: number };
    const max = args.count && args.count > 0 ? Math.round(args.count) : Infinity;
    const cells = this.findHarvestTargets(max);
    if (cells.length === 0) {
      this.setImmediateDialog("Cato looks over the plants — nothing's ripe to pick yet.");
      return;
    }
    this.catoTask = { type: 'harvest', queue: cells, crop: 'crops', cooldown: 0, strikes: 0, walkMs: 0, walkDist: Infinity, stand: null, path: null };
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

  // ── Cato world-object tasks: chop trees / harvest fruit / mine stones / pick
  //    bushes / gather wild foragables ──────────────────────────────────────────
  //
  // These reuse the SAME task state machine + Cato's OWN attack (hoe) swing — Cato
  // has no pickaxe/axe animation, so mining & chopping play the hoe swing too. The
  // strike fires the DIRECT effect (onChopStrike / onKnockStrike / reapBush /
  // reapForagable), NOT the player's god-hand-tool wrapper. Trees & stones are
  // MULTI-STRIKE: Cato keeps hitting the same target until it's felled / broken
  // (taskCellValid then drops it); bushes & foragables are a single hit.

  /** The nearest `max` cells among `keys`, sorted by distance to Cato. */
  private nearestCells(keys: string[], max: number): Array<{ cx: number; cy: number }> {
    const layer = this.islandLayer;
    if (!layer || !this.child) return [];
    const origin = layer.worldToTileXY(this.child.x, this.child.y);
    const ocx = origin ? Math.floor(origin.x) : 0;
    const ocy = origin ? Math.floor(origin.y) : 0;
    const cells = keys.map((k) => { const [cx, cy] = k.split(',').map(Number); return { cx, cy }; });
    cells.sort((a, b) => (a.cx - ocx) ** 2 + (a.cy - ocy) ** 2 - ((b.cx - ocx) ** 2 + (b.cy - ocy) ** 2));
    return Number.isFinite(max) ? cells.slice(0, max) : cells;
  }

  /** `count` arg → a max, 0 / omitted = all. */
  private taskCount(rawArgs: unknown): number {
    const args = (rawArgs ?? {}) as { count?: number };
    return args.count && args.count > 0 ? Math.round(args.count) : Infinity;
  }

  /** "Chop down the trees": fell nearby trees. A fruit tree shakes its fruit loose
   *  first, then fells as a plain tree. Multi-strike per tree until it's gone. */
  private startChopTask(rawArgs: unknown): void {
    if (!this.islandLayer || !this.child) return;
    const cells = this.nearestCells([...this.trees.keys()], this.taskCount(rawArgs));
    if (cells.length === 0) { this.setImmediateDialog('Cato looks around — there are no trees nearby to chop.'); return; }
    this.catoTask = { type: 'chop', queue: cells, crop: 'trees', cooldown: 0, strikes: 0, walkMs: 0, walkDist: Infinity, stand: null, path: null };
    this.cameraFollow = true;
  }

  /** "Harvest the fruit": chop only FRUIT trees to shake their fruit loose (each
   *  becomes a plain tree, left standing). Multi-strike per tree until de-fruited. */
  private startFruitTask(rawArgs: unknown): void {
    if (!this.islandLayer || !this.child) return;
    const args = (rawArgs ?? {}) as { count?: number; fruit?: string };
    const fruit = this.parseFruit(args.fruit); // null = any fruit tree
    const keys = [...this.trees].filter(([, t]) => t.hasFruit && (!fruit || t.type === fruit)).map(([k]) => k);
    const cells = this.nearestCells(keys, this.taskCount(rawArgs));
    if (cells.length === 0) {
      this.setImmediateDialog(fruit
        ? `Cato peers up at the trees — there's no ripe ${FRUIT_LABEL[fruit]?.toLowerCase() ?? fruit} to pick right now.`
        : 'Cato peers up at the trees — none have ripe fruit right now.');
      return;
    }
    this.catoTask = { type: 'fruit', queue: cells, crop: fruit ?? 'fruit', cooldown: 0, strikes: 0, walkMs: 0, walkDist: Infinity, stand: null, path: null };
    this.cameraFollow = true;
  }

  /** Loose fruit-tree-type match (apple / pear / peach) against the AI's arg, or null. */
  private parseFruit(s: string | undefined): TreeType | null {
    const t = (s ?? '').toLowerCase();
    return (['apple', 'pear', 'peach'] as TreeType[]).find((n) => t.includes(n)) ?? null;
  }

  /** "Mine the big stones": knock each big stone until it's mined out & breaks apart
   *  (every knock chips off a stone; when empty it shatters for the bonus). */
  private startMineTask(rawArgs: unknown): void {
    if (!this.islandLayer || !this.child) return;
    const cells = this.nearestCells([...this.bigStones.keys()], this.taskCount(rawArgs));
    if (cells.length === 0) { this.setImmediateDialog('Cato sniffs about — there are no big stones nearby to mine.'); return; }
    this.catoTask = { type: 'mine', queue: cells, crop: 'stones', cooldown: 0, strikes: 0, walkMs: 0, walkDist: Infinity, stand: null, path: null };
    this.cameraFollow = true;
  }

  /** "Pick the berry bushes": harvest every RIPE bush (stage ≥ 2). One hit each.
   *  A `berry` arg (strawberry/grape/blueberry) restricts it to that kind — else Cato
   *  would grab every ripe bush (the "asked for strawberries, got blueberries too" bug). */
  private startBushTask(rawArgs: unknown): void {
    if (!this.islandLayer || !this.child) return;
    const args = (rawArgs ?? {}) as { count?: number; berry?: string };
    const berry = this.parseBerry(args.berry); // null = any ripe bush
    const keys = [...this.bushes].filter(([, b]) => b.stage >= 2 && (!berry || b.type === berry)).map(([k]) => k);
    const cells = this.nearestCells(keys, this.taskCount(rawArgs));
    if (cells.length === 0) {
      this.setImmediateDialog(berry
        ? `Cato checks the bushes — no ripe ${FRUIT_LABEL[berry]?.toLowerCase() ?? berry} bushes right now.`
        : 'Cato checks the bushes — none are ripe with berries yet.');
      return;
    }
    this.catoTask = { type: 'bush', queue: cells, crop: berry ? `${FRUIT_LABEL[berry]?.toLowerCase() ?? berry}` : 'berries', cooldown: 0, strikes: 0, walkMs: 0, walkDist: Infinity, stand: null, path: null };
    this.cameraFollow = true;
  }

  /** Loose berry-type match (strawberry / grape / blueberry) against the AI's arg, or null. */
  private parseBerry(s: string | undefined): BerryType | null {
    const t = (s ?? '').toLowerCase();
    return BERRY_TYPES.find((n) => t.includes(n)) ?? null;
  }

  /** "Gather the wild growth": harvest MATURE foragables — mushrooms, flowers, grass,
   *  small stones (each at its max stage). One hit each. A `kind` arg restricts it to
   *  one category (grass/weeds, mushrooms, flowers, stones, or a specific name) — else
   *  Cato grabs EVERYTHING (the "asked to clear the weeds, he took the mushrooms" bug). */
  private startForageTask(rawArgs: unknown): void {
    if (!this.islandLayer || !this.child) return;
    const args = (rawArgs ?? {}) as { count?: number; kind?: string };
    const kind = (args.kind ?? '').trim();
    const keys = [...this.foragables]
      .filter(([, f]) => f.stage >= (FORAGABLES[f.type]?.stages ?? 1) && (!kind || this.foragMatches(f.type, kind)))
      .map(([k]) => k);
    const cells = this.nearestCells(keys, this.taskCount(rawArgs));
    if (cells.length === 0) {
      this.setImmediateDialog(kind
        ? `Cato pokes around the grass — no ripe ${kind} to gather right now.`
        : "Cato pokes around the grass — nothing's grown enough to gather yet.");
      return;
    }
    this.catoTask = { type: 'forage', queue: cells, crop: kind || 'wild growth', cooldown: 0, strikes: 0, walkMs: 0, walkDist: Infinity, stand: null, path: null };
    this.cameraFollow = true;
  }

  /** Does a foragable of `type` fall under the friend's requested `kind`? Matches the
   *  kind keyword (singular-ised) against the type's id + label — "mushroom(s)" → red &
   *  purple mushroom, "flower(s)" → wild-flower & sunflower, "grass"/"weed(s)" → grass,
   *  "stone(s)"/"rock(s)" → small-stone — plus a few synonyms. */
  private foragMatches(type: ForagableName, kind: string): boolean {
    const ks = kind.toLowerCase().trim().replace(/s$/, ''); // drop a trailing plural 's'
    if (!ks) return true;
    const name = type.toLowerCase();
    const label = (FORAGABLES[type]?.label ?? '').toLowerCase();
    if (name.includes(ks) || label.includes(ks)) return true; // grass/mushroom/flower/stone + specific names
    if (ks === 'weed' && name === 'grass') return true;
    if ((ks === 'rock' || ks === 'pebble') && name.includes('stone')) return true;
    if ((ks === 'fungu' || ks === 'toadstool') && name.includes('mushroom')) return true;
    if (ks === 'bloom' && name.includes('flower')) return true;
    return false;
  }

  /** Walk Cato toward (tx,ty) along ONE cardinal axis at a time (the dominant
   *  remaining one) — the character sheet has no diagonal walk, so we never move
   *  diagonally; the path is L-shaped. Sets velocity + facing + walk anim. */
  /** Drive Cato one cardinal direction (velocity + walk anim). Used by the stuck-escape. */
  private moveDir(dir: FaceDir, speed: number): void {
    if (!this.child?.body) return;
    const body = this.child.body as Phaser.Physics.Arcade.Body;
    body.setVelocity(dir === 'left' ? -speed : dir === 'right' ? speed : 0, dir === 'up' ? -speed : dir === 'down' ? speed : 0);
    this.faceDir = dir;
    this.child.play(`walk-${dir}`, true);
  }

  private walkCardinalToward(tx: number, ty: number, speed: number): void {
    if (!this.child?.body) return;
    const body = this.child.body as Phaser.Physics.Arcade.Body;
    const dx = tx - this.child.x;
    const dy = ty - this.child.y;
    const DZ = 1.5; // per-axis deadzone so we don't jitter when nearly aligned
    // AXIS HYSTERESIS: keep finishing the axis we're ALREADY walking before we
    // switch to the other one. Without this, when dx≈dy the "dominant axis" flips
    // every frame as movement shaves one down past the other → a fast left/right
    // (or up/down) WOBBLE. Committing to the current axis until it's aligned makes
    // the path a clean L-shape and removes the shimmer.
    const onX = this.faceDir === 'left' || this.faceDir === 'right';
    const onY = this.faceDir === 'up' || this.faceDir === 'down';
    let axis: 'x' | 'y' | null = null;
    if (onX && Math.abs(dx) > DZ) axis = 'x';
    else if (onY && Math.abs(dy) > DZ) axis = 'y';
    else if (Math.abs(dx) > DZ && Math.abs(dx) >= Math.abs(dy)) axis = 'x';
    else if (Math.abs(dy) > DZ) axis = 'y';
    else if (Math.abs(dx) > DZ) axis = 'x';
    // WALL-SLIDE: if the chosen axis is blocked by a collider, take the OTHER axis so
    // Cato slides ALONG the obstacle (around a tree trunk) instead of grinding into it.
    const blockedOnX = (dx < 0 && body.blocked.left) || (dx > 0 && body.blocked.right);
    const blockedOnY = (dy < 0 && body.blocked.up) || (dy > 0 && body.blocked.down);
    if (axis === 'x' && blockedOnX && Math.abs(dy) > DZ) axis = 'y';
    else if (axis === 'y' && blockedOnY && Math.abs(dx) > DZ) axis = 'x';
    if (axis === 'x') {
      body.setVelocity(Math.sign(dx) * speed, 0);
      this.faceDir = dx < 0 ? 'left' : 'right';
    } else if (axis === 'y') {
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
    if (!tile) return false;
    const key = `${cx},${cy}`;
    if (this.tilledCells.has(key)) return false;
    // Same "can't till here" rule as the player's hoe: NOT the fixed house (walls +
    // FLOOR), trees, stones, bushes, foragables, or furniture. Cato was tilling the
    // house floor because he skipped this check.
    if (this.cellBlocksTill(key)) return false;
    return true;
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

    // NB: Cato keeps working even while the chat box is still up (the friend
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

    // GET OUT OF THE HOUSE FIRST. Every task target is OUTSIDE (farm plots / trees /
    // stones / bushes — the interior is non-farmable floor), so if Cato is inside the
    // house he's in the wrong place: drive him straight to the doorway instead of
    // trying to work from in here. Pathfinding can't always route him out — the
    // interior may be split by furniture into rooms and only one has the door, or the
    // leash may have wedged him into a furniture cell — so walk him toward the door on
    // foot, and if he still can't get out after CATO_ESCAPE_MS, warp him just outside
    // (better an instant reposition than freezing on "梨熟了，我去收" forever).
    if (this.catoInsideHouse()) {
      this.catoEscapeMs += delta;
      if (this.catoEscapeMs > CATO_ESCAPE_MS) { this.catoEscapeMs = 0; this.warpCatoOutsideDoor(); return; }
      const exit = this.doorExitPoint();
      if (exit) { this.walkCardinalToward(exit.x, exit.y, CATO_TILL_SPEED); return; }
    } else {
      this.catoEscapeMs = 0;
    }

    // Skip a cell that's no longer a valid target for this task type — idempotent
    // / robust to concurrent edits (the player may have acted on it meanwhile).
    if (!this.taskCellValid(task.type, next.cx, next.cy)) { task.queue.shift(); task.stand = null; task.strikes = 0; return; }

    // Plan a route: pick a reachable adjacent "stand" cell (facing the target) and an
    // A* path to it (around walls / trees / stones / water). Computed once per target.
    // If NO side is reachable, skip the target instead of shoving into a wall forever.
    if (!task.stand) {
      const planned = this.planStand(next);
      if (!planned) { task.queue.shift(); task.stand = null; task.strikes = 0; return; }
      task.stand = planned.stand;
      task.path = planned.path;
      task.walkMs = 0; task.walkDist = Infinity;
    }
    const s = task.stand;

    // Follow the A* path one tile at a time. Consecutive path cells are always walkable
    // with nothing between them, so walkCardinalToward reaches each without wedging.
    if (task.path && task.path.length > 0) {
      const wp = task.path[0];
      const d = Math.hypot(wp.x - this.child.x, wp.y - this.child.y);
      if (d <= CATO_ARRIVE_DIST) { task.path.shift(); task.walkMs = 0; task.walkDist = Infinity; return; }
      // Stall backstop for a DYNAMIC block (wall placed mid-walk / physics wedge): no
      // progress for a while → abandon this target (A* already routed around all the
      // static obstacles up front).
      if (d < task.walkDist - 2) { task.walkDist = d; task.walkMs = 0; }
      else {
        task.walkMs += delta;
        if (task.walkMs > CATO_STUCK_MS) { task.queue.shift(); task.stand = null; task.path = null; task.strikes = 0; return; }
      }
      this.walkCardinalToward(wp.x, wp.y, CATO_TILL_SPEED); // cardinal step to the next tile
      return;
    }

    // Arrived beside the target: face it and work with Cato's OWN attack anim.
    // Till → flip to soil; plant → drop a seedling. The effect lands partway
    // through the swing (commitCatoTill / delayed plant).
    body.setVelocity(0, 0);
    this.faceDir = s.dir;
    // Pick Cato's body animation for this task: water can, axe (chop/fruit — he has a
    // real axe-swing sheet), else the generic attack (hoe) swing for till/plant/harvest/
    // mine/bush/forage.
    const animKind =
      task.type === 'water' ? 'water'
      : (task.type === 'chop' || task.type === 'fruit') ? 'axe'
      : 'attack';
    this.child.play(`${animKind}-${s.dir}`, true);
    const tx = next.cx, ty = next.cy;
    const K = CATO_TILL_STRIKE_MS;
    if (task.type === 'till') {
      this.commitCatoTill(tx, ty);
    } else if (task.type === 'plant' && task.plantName) {
      const name = task.plantName;
      this.time.delayedCall(K, () => this.plantCropAt(tx, ty, name));
    } else if (task.type === 'water') {
      this.time.delayedCall(K, () => this.waterCropAt(tx, ty));
    } else if (task.type === 'harvest') {
      this.time.delayedCall(K, () => this.reapCrop(tx, ty));
    } else if (task.type === 'bush') {
      this.time.delayedCall(K, () => this.reapBush(tx, ty));
    } else if (task.type === 'forage') {
      this.time.delayedCall(K, () => this.reapForagable(tx, ty));
    } else if (task.type === 'chop' || task.type === 'fruit') {
      this.time.delayedCall(K, () => this.onChopStrike(tx, ty)); // combo → fell / de-fruit on the 3rd
    } else if (task.type === 'mine') {
      this.time.delayedCall(K, () => this.onKnockStrike(tx, ty)); // chip a stone off / break it
    }
    task.cooldown = CATO_TILL_STEP_MS;
    // Multi-strike (chop/fruit/mine): stay beside the target and hit again next tick.
    // It self-invalidates (felled / de-fruited / broken) and taskCellValid then drops
    // it; a strike cap backstops any target that somehow never clears. Everything else
    // finishes in one hit → advance to the next cell.
    if (task.type === 'chop' || task.type === 'fruit' || task.type === 'mine') {
      task.strikes += 1;
      if (task.strikes >= 20) { task.queue.shift(); task.stand = null; task.strikes = 0; }
    } else {
      task.queue.shift();
      task.stand = null;
    }
  }

  /** Is (cx,cy) still a valid target for a task of this type? */
  private taskCellValid(
    type: 'till' | 'plant' | 'water' | 'harvest' | 'chop' | 'fruit' | 'mine' | 'bush' | 'forage',
    cx: number,
    cy: number,
  ): boolean {
    const key = `${cx},${cy}`;
    if (type === 'till') return !this.tilledCells.has(key) && this.isFarmable(cx, cy);
    if (type === 'plant') return this.tilledCells.has(key) && !this.crops.has(key);
    if (type === 'chop') return this.trees.has(key); // any tree — chop until it's felled
    if (type === 'fruit') return this.trees.get(key)?.hasFruit === true; // only while it still has fruit
    if (type === 'mine') return this.bigStones.has(key); // knock until it breaks apart
    if (type === 'bush') { const b = this.bushes.get(key); return !!b && b.stage >= 2; } // ripe with berries
    if (type === 'forage') { const f = this.foragables.get(key); return !!f && f.stage >= (FORAGABLES[f.type]?.stages ?? 1); } // mature
    const crop = this.crops.get(key);
    if (type === 'harvest') return !!crop && crop.stage >= CROPS[crop.name].stages - 1; // ripe
    // water: a growing crop on DRY soil is here (Cato waters what needs it).
    return !!crop && crop.stage < CROPS[crop.name].stages - 1 && (this.soilWet.get(key) ?? 0) <= 0;
  }

  /** True if Cato can stand on / walk through this tile: on the island, no solid
   *  tilemap tile, and nothing solid placed on it (wall / window / CLOSED door, a tree
   *  trunk, a big stone, or a small-stone rock). Bushes / crops / other foragables
   *  (grass / flowers / mushrooms) are passable. Mirrors exactly
   *  what physically blocks him (the wallGroup colliders + off-island water). */
  private isWalkableCell(cx: number, cy: number): boolean {
    const layer = this.islandLayer;
    if (!layer) return false;
    const grass = layer.getTileAt(cx, cy);
    const house = this.wallLayer?.getTileAt(cx, cy);
    const houseTile = house && house.index !== -1 ? house : null;
    if (houseTile) {
      // A SOLID wooden_house tile (wall/window) blocks; only the FLOOR is walkable.
      // The walls collide via SUB-TILE bodies, so the tile's `collides` flag is NOT
      // set — reading it (the old check) let A* route THROUGH walls, so Cato couldn't
      // path out of the house. Use the tileset metadata (`solid`) / floor frame instead.
      const meta = this.wallTile(houseTile.index);
      const isFloor = meta ? meta.solid === false : houseTile.index === FLOOR_FRAME;
      if (!isFloor) return false;
    }
    // Ground: non-colliding grass OR a house FLOOR (the interior/doorway floor sits on
    // the wallLayer and may have no grass under it).
    const onGrass = !!grass && !grass.collides;
    if (!onGrass && !houseTile) return false; // off-island water and no house floor
    const key = `${cx},${cy}`;
    if (this.houseBlocked.has(key)) return false; // solid furniture (bed/table/…)
    if (this.trees.has(key) || this.bigStones.has(key)) return false;
    if (this.foragables.get(key)?.type === 'small-stone') return false; // small-stones are solid rocks
    const p = this.placed.get(key);
    if (p && (p.kind === 'wall' || p.kind === 'window' || (p.kind === 'door' && !p.open))) return false;
    return true;
  }

  /** The walkable adjacent tiles Cato could stand on to work `target` (facing it:
   *  below→up, above→down, left→right, right→left), nearest to him first. */
  private standCandidates(target: { cx: number; cy: number }): Array<{ cx: number; cy: number; dir: FaceDir }> {
    const layer = this.islandLayer!;
    const cur = layer.worldToTileXY(this.child!.x, this.child!.y);
    const ocx = cur ? Math.floor(cur.x) : target.cx;
    const ocy = cur ? Math.floor(cur.y) : target.cy;
    const cands: Array<{ cx: number; cy: number; dir: FaceDir }> = [
      { cx: target.cx, cy: target.cy + 1, dir: 'up' },
      { cx: target.cx, cy: target.cy - 1, dir: 'down' },
      { cx: target.cx - 1, cy: target.cy, dir: 'right' },
      { cx: target.cx + 1, cy: target.cy, dir: 'left' },
    ];
    return cands
      .filter((c) => this.isWalkableCell(c.cx, c.cy))
      .sort((a, b) => (a.cx - ocx) ** 2 + (a.cy - ocy) ** 2 - ((b.cx - ocx) ** 2 + (b.cy - ocy) ** 2));
  }

  /** Pick the nearest REACHABLE stand cell for `target` + the A* route to it (world-
   *  centre waypoints, last = the stand cell). Tries each walkable side nearest-first
   *  and returns the first that A* can reach; null if the target can't be worked. */
  private planStand(target: { cx: number; cy: number }):
    | { stand: { x: number; y: number; dir: FaceDir }; path: Array<{ x: number; y: number }> }
    | null {
    const layer = this.islandLayer;
    if (!layer || !this.child) return null;
    const cur = layer.worldToTileXY(this.child.x, this.child.y);
    if (!cur) return null;
    const scx = Math.floor(cur.x), scy = Math.floor(cur.y);
    const toWorld = (cx: number, cy: number) => { const w = layer.tileToWorldXY(cx, cy)!; return { x: w.x + TILE / 2, y: w.y + TILE / 2 }; };
    for (const cand of this.standCandidates(target)) {
      const steps = this.findPath(scx, scy, cand.cx, cand.cy);
      if (!steps) continue; // this side is walled off from Cato — try the next
      return { stand: { ...toWorld(cand.cx, cand.cy), dir: cand.dir }, path: steps.map((s) => toWorld(s.cx, s.cy)) };
    }
    return null;
  }

  /** True if Cato is currently standing ON a `wooden_house` tile (inside the house
   *  footprint — interior floor / doorway). Used to trigger the escape-to-door walk. */
  private catoInsideHouse(): boolean {
    const layer = this.islandLayer;
    if (!layer || !this.child) return false;
    const cur = layer.worldToTileXY(this.child.x, this.child.y);
    if (!cur) return false;
    const ht = this.wallLayer?.getTileAt(Math.floor(cur.x), Math.floor(cur.y));
    return !!ht && ht.index !== -1;
  }

  /** World point just OUTSIDE the doorway (a couple tiles below the door) — the target
   *  Cato walks toward to leave the house. Null if there's no door. */
  private doorExitPoint(): { x: number; y: number } | null {
    const door = this.houseDoor;
    if (!door) return null;
    return { x: door.x, y: door.y + TILE * 2 };
  }

  /** Last-resort un-stick: place Cato on the first walkable grass cell below the door
   *  (OUTSIDE the house footprint). Used when he's boxed into a furniture-sealed room
   *  with no floor route to the door — better a quick reposition than freezing forever.
   *  Mirrors frameNewGameStart's door-exit search. */
  private warpCatoOutsideDoor(): void {
    const door = this.houseDoor;
    const layer = this.islandLayer;
    if (!door || !this.child || !layer) return;
    const dt = layer.worldToTileXY(door.x, door.y);
    let out: { cx: number; cy: number } | null = null;
    if (dt) {
      for (let dy = 1; dy <= 6 && !out; dy++) {
        const cx = dt.x, cy = dt.y + dy;
        const ht = this.wallLayer?.getTileAt(cx, cy);
        const insideHouse = !!ht && ht.index !== -1;
        if (!insideHouse && this.isWalkableCell(cx, cy)) out = { cx, cy };
      }
    }
    const w = out ? layer.tileToWorldXY(out.cx, out.cy) : null;
    if (w) this.child.setPosition(w.x + TILE / 2, w.y + TILE / 2);
    else this.child.setPosition(door.x, door.y + TILE * 2);
    (this.child.body as Phaser.Physics.Arcade.Body | undefined)?.reset(this.child.x, this.child.y);
  }

  /** 4-connected A* over walkable tiles from (sx,sy) to (gx,gy). Returns the tile steps
   *  AFTER the start (last = goal), [] if already there, or null if unreachable. Four-
   *  connected (no diagonals) because Cato's sheet has no diagonal walk — the path is
   *  naturally the L-shaped/staircase route walkCardinalToward can follow. */
  private findPath(sx: number, sy: number, gx: number, gy: number): Array<{ cx: number; cy: number }> | null {
    if (sx === gx && sy === gy) return [];
    if (!this.isWalkableCell(gx, gy)) return null;
    const K = (x: number, y: number) => `${x},${y}`;
    const start = K(sx, sy), goal = K(gx, gy);
    const h = (x: number, y: number) => Math.abs(x - gx) + Math.abs(y - gy);
    const g = new Map<string, number>([[start, 0]]);
    const f = new Map<string, number>([[start, h(sx, sy)]]);
    const came = new Map<string, string>();
    const open = new Set<string>([start]);
    let guard = 0;
    while (open.size) {
      if (++guard > 4000) return null; // safety cap — the island is small; never trips in practice
      let cur = '', best = Infinity; // lowest-f node (linear scan; paths are short)
      for (const n of open) { const fn = f.get(n) ?? Infinity; if (fn < best) { best = fn; cur = n; } }
      if (cur === goal) {
        const path: Array<{ cx: number; cy: number }> = [];
        for (let c = cur; c !== start; c = came.get(c)!) { const [x, y] = c.split(',').map(Number); path.push({ cx: x!, cy: y! }); }
        return path.reverse();
      }
      open.delete(cur);
      const [cx, cy] = cur.split(',').map(Number);
      for (const [nx, ny] of [[cx! + 1, cy!], [cx! - 1, cy!], [cx!, cy! + 1], [cx!, cy! - 1]] as Array<[number, number]>) {
        if (!this.isWalkableCell(nx, ny)) continue;
        const tentative = (g.get(cur) ?? Infinity) + 1;
        const nk = K(nx, ny);
        if (tentative < (g.get(nk) ?? Infinity)) {
          came.set(nk, cur);
          g.set(nk, tentative);
          f.set(nk, tentative + h(nx, ny));
          open.add(nk);
        }
      }
    }
    return null;
  }

  /** Cato hoes a cell himself (no god-hand hoe sprite): reserve it now, then flip
   *  it to soil + kick up dirt partway through his attack swing. */
  private commitCatoTill(cx: number, cy: number): void {
    const key = `${cx},${cy}`;
    if (this.tilledCells.has(key)) return;
    this.tilledCells.add(key); // reserve so it won't be re-queued mid-swing
    // Fire slightly into the swing so dirt + soil appear as the hoe strikes. A
    // delayedCall (not the anim's COMPLETE) so it still lands if the swing gets
    // interrupted (e.g. the friend opens the chat mid-till).
    this.time.delayedCall(CATO_TILL_STRIKE_MS, () => {
      if (!this.islandLayer) return;
      const w = this.islandLayer.tileToWorldXY(cx, cy);
      if (w) this.dirtBurst(w.x + TILE / 2, w.y + TILE / 2);
      playSfx(this, SFX_HOE); // Cato's hoe thunk (matches the player's)
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
    // Cato's happy he finished the job you asked for (force past the per-strike emotes).
    if (task) this.catoReact('happy', { duration: 3000, force: true });
    // NB: the "all done" chatter fires when the whole SESSION ends (no work left) —
    // see the wander resting branch — not per task, so it isn't clobbered by the next.
    if (task?.type === 'plant') {
      this.cato?.note(`You planted ${task.crop} in the tilled soil; it will grow over time.`);
    } else if (task?.type === 'water') {
      this.cato?.note('You watered the crops; they will grow faster now.');
    } else if (task?.type === 'harvest') {
      this.cato?.note("You harvested the ripe crops; the produce is in the friend's backpack now.");
    } else if (task?.type === 'chop') {
      this.cato?.note("You chopped down the trees; the wood (and any fruit) is in the friend's backpack now.");
    } else if (task?.type === 'fruit') {
      this.cato?.note("You picked the fruit from the trees and left them standing; it's in the friend's backpack now.");
    } else if (task?.type === 'mine') {
      this.cato?.note("You mined the big stones; the stone is in the friend's backpack now.");
    } else if (task?.type === 'bush') {
      this.cato?.note("You picked the ripe berry bushes; the berries are in the friend's backpack now.");
    } else if (task?.type === 'forage') {
      this.cato?.note("You gathered the wild mushrooms, flowers and other growth; it's in the friend's backpack now.");
    } else {
      this.cato?.note(`You finished tilling a plot of soil, ready for the friend to plant ${task?.crop ?? 'crops'}.`);
    }
    if (CHILD_WANDER) this.startWanderIdle();
  }

  // ── Click-to-talk dialog ──────────────────────────────────────────────

  /** True if a world point lands on the VISIBLE cat — an OPAQUE pixel of the current
   *  frame, not just the 48×48 frame box (Cato fills only a small patch of it, so
   *  getBounds alone triggered the chat from far away over the transparent padding). */
  private catContains(worldX: number, worldY: number): boolean {
    return this.child ? this.spritePixelHit(this.child, worldX, worldY) : false;
  }

  /** PER-PIXEL hit test: is the world point over an OPAQUE pixel of this sprite's current frame
   *  (honouring origin / scale / flip)? Cheap frame-box reject first. Used by the tree / stone /
   *  foragable / Cato pickers so a far click on the sprite's TRANSPARENT padding — or on a
   *  neighbour whose padded frame overlaps — doesn't count as a hit (the "focus is a region, not
   *  the art" bug). Falls back to the frame box only if the texture can't be read. */
  private spritePixelHit(s: Phaser.GameObjects.Sprite | Phaser.GameObjects.Image, worldX: number, worldY: number): boolean {
    if (!s.getBounds().contains(worldX, worldY)) return false; // cheap reject on the frame box
    const frame = s.frame;
    const fw = frame.width, fh = frame.height;
    let fx = (worldX - s.x) / s.scaleX + s.originX * fw;
    let fy = (worldY - s.y) / s.scaleY + s.originY * fh;
    if (s.flipX) fx = fw - fx;
    if (s.flipY) fy = fh - fy;
    const alpha = this.textures.getPixelAlpha(Math.floor(fx), Math.floor(fy), s.texture.key, frame.name);
    if (alpha == null) return true; // texture unreadable → the frame-box hit (already passed) stands
    return alpha > 16; // opaque enough to count as "on the art"
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

  // ── Typewriter reveal + pagination ──────────────────────────────────────
  // Cato's reply is shown RPG-style: revealed one character at a time, and if it
  // overflows the box it's split into pages. A "more" icon (bottom-right) prompts
  // the player to advance (click anywhere / Space / tap) to the rest — no scroll.
  // Fit target < the real 200px box: leaves a safety row so font-load rounding
  // can't trip a scrollbar and the last line clears the bottom-right "more" icon.
  private static DIALOG_FIT_H = 118;
  private static TYPE_MS = 50; // per-character reveal interval (cozy RPG pace)

  /** A hidden div sized EXACTLY like the runtime text-area at design scale (700
   *  wide, font 24, line-height 34, padding 22, border-box, same wrap rules) but
   *  with auto height — so its measured height predicts whether a string fits the
   *  box without scrolling. Wrapping is scale-invariant, so design-scale measuring
   *  is accurate at any canvas size. */
  private measureEl(): HTMLDivElement {
    if (!this.dialogMeasureEl) {
      const d = document.createElement('div');
      d.style.cssText =
        'position:fixed; left:-9999px; top:0; visibility:hidden; box-sizing:border-box;' +
        'overflow-wrap:break-word; white-space:pre-wrap; word-break:break-word;' +
        'width:700px; padding:22px; font-size:24px; line-height:34px;' +
        "font-family:zpix, sans-serif; text-align:start;";
      document.body.appendChild(d);
      this.dialogMeasureEl = d;
      this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => { d.remove(); });
    }
    return this.dialogMeasureEl;
  }

  /** Does `s` fit the chat box (design height) without scrolling? */
  private textFits(s: string): boolean {
    const el = this.measureEl();
    el.textContent = s;
    return el.offsetHeight <= GameScene.DIALOG_FIT_H;
  }

  /** Split a reply into pages that each fill the box without overflowing. Grows a
   *  prefix by binary search, then backs up to the last word break so words aren't
   *  cut (CJK has no spaces → falls back to the char boundary). */
  private paginate(text: string): string[] {
    const pages: string[] = [];
    let rest = text.trim();
    // Safety cap so a pathological input can never loop forever.
    for (let guard = 0; rest && guard < 64; guard++) {
      if (this.textFits(rest)) { pages.push(rest); break; }
      let lo = 1;
      let hi = rest.length;
      let best = 1;
      while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        if (this.textFits(rest.slice(0, mid))) { best = mid; lo = mid + 1; }
        else hi = mid - 1;
      }
      let cut = best;
      const sp = rest.lastIndexOf(' ', best);
      if (sp > best * 0.5) cut = sp; // prefer a word boundary if not too far back
      pages.push(rest.slice(0, cut).trim());
      rest = rest.slice(cut).trim();
    }
    return pages.length ? pages : [''];
  }

  /** Show a full reply with the RPG typewriter: paginate, then type out page 0.
   *  (Replaces a bare registry.set of the whole line.) */
  private showDialogText(fullText: string): void {
    this.stopTyping();
    this.dialogPages = this.paginate(fullText);
    this.dialogPageIdx = 0;
    this.startTypingPage(0);
  }

  private stopTyping(): void {
    this.dialogTypeTimer?.remove();
    this.dialogTypeTimer = undefined;
    this.dialogTyping = false;
  }

  /** Set a short line INSTANTLY (no typewriter) — greetings / "thinking…" beats /
   *  error lines that are always one page. Resets the pagination state so a stale
   *  "more" icon or half-typed page can't linger. */
  private setImmediateDialog(text: string): void {
    this.stopTyping();
    this.dialogPages = [text];
    this.dialogPageIdx = 0;
    this.dialogCharIdx = text.length;
    this.setMoreIcon(false);
    this.registry.set('catoDialogText', text);
  }

  /** Begin revealing page `idx` one character at a time. */
  private startTypingPage(idx: number): void {
    this.stopTyping();
    this.dialogPageIdx = idx;
    this.dialogCharIdx = 0;
    this.dialogTyping = true;
    this.setMoreIcon(false); // hidden until this page finishes
    const page = this.dialogPages[idx] ?? '';
    this.registry.set('catoDialogText', '');
    this.dialogTypeTimer = this.time.addEvent({
      delay: GameScene.TYPE_MS,
      loop: true,
      callback: () => {
        this.dialogCharIdx = Math.min(this.dialogCharIdx + 1, page.length);
        this.registry.set('catoDialogText', page.slice(0, this.dialogCharIdx));
        if (this.dialogCharIdx >= page.length) this.finishPage();
      },
    });
  }

  /** The current page is fully shown — stop typing + reveal the "more" icon when
   *  there are still pages left. */
  private finishPage(): void {
    this.stopTyping();
    const page = this.dialogPages[this.dialogPageIdx] ?? '';
    this.dialogCharIdx = page.length;
    this.registry.set('catoDialogText', page);
    this.setMoreIcon(this.dialogPageIdx < this.dialogPages.length - 1);
  }

  /** Player pressed advance (click / Space / tap) while the dialog is open. If
   *  the current page is still typing → snap it complete; else if more pages
   *  remain → go to the next one. Returns true if it consumed the input (there
   *  was something to reveal), false when everything is already shown (so the
   *  caller can then close the dialog). */
  private advanceDialog(): boolean {
    if (this.dialogTyping) { this.finishPage(); return true; }
    if (this.dialogPageIdx < this.dialogPages.length - 1) {
      this.startTypingPage(this.dialogPageIdx + 1);
      return true;
    }
    return false;
  }

  /** Show/hide the "more" pagination icon (a gentle alpha pulse while visible so
   *  it reads as "there's more — tap to continue"). Alpha-only so it never fights
   *  the HUD's anchored position. */
  private setMoreIcon(show: boolean): void {
    const go = getHudObject(this, 'cato-more-icon') as unknown as
      | { y: number; setVisible?: (v: boolean) => void; setAlpha?: (a: number) => void }
      | undefined;
    if (!go) return;
    this.moreIconTween?.remove();
    this.moreIconTween = undefined;
    const on = show && this.dialogOpen;
    // Keep the "more" arrow glued to the box, which is RAISED in a cutscene.
    if (this.moreIconRestY === undefined) this.moreIconRestY = go.y;
    go.y = this.moreIconRestY - this.cutsceneLift;
    go.setAlpha?.(1);
    go.setVisible?.(on);
    if (on) {
      this.moreIconTween = this.tweens.add({
        targets: go, alpha: 0.35, duration: 560,
        yoyo: true, repeat: -1, ease: 'Sine.easeInOut',
      });
    }
  }

  /** Strip *italic stage-direction* asides ("*tilts head*") from a reply — the
   *  portrait carries the mood now, so the text stays clean spoken dialogue. */
  private stripAsides(text: string): string {
    return text.replace(/\*[^*]*\*/g, '').replace(/\s{2,}/g, ' ').trim();
  }

  /** A varied warm filler for when the AI returned no spoken text (only a tool
   *  call, or an aside-only reply). ALWAYS Cato's OWN words/sounds (the box shows
   *  what Cato SAYS — never a third-person description of him). Contextual when
   *  he's off doing a task. */
  private fallbackSay(doingTask: boolean): string {
    const lines = doingTask
      ? ['Okay — on it!', 'Right away!', 'Mmhm, doing it now!', 'Hehe, okay!']
      : ['Hehe.', 'Mm?', 'Hi hi!', 'Mrrp?', 'Yeah?'];
    return Phaser.Utils.Array.GetRandom(lines);
  }

  /** Cato prefixes his reply with a [mood] marker (emotes are NOT a tool — that
   *  made Haiku drop the spoken text). Pull the mood → teemo anim and strip the
   *  marker from the text. */
  private parseEmoteMarker(text: string): { anim: string | null; text: string } {
    const m = /^\s*[[(]\s*([a-z_ -]+?)\s*[\])]\s*/i.exec(text);
    if (!m) return { anim: null, text };
    const mood = m[1].trim().toLowerCase();
    return { anim: GameScene.EMOTE_ANIM[mood] ?? null, text: text.slice(m[0].length) };
  }

  /** Reveal the chat HUD widgets (slide UP from the bottom) + a typing input. */
  private openDialog(seed?: string, cutscene = false): void {
    if (this.dialogOpen || !this.child) return;
    this.dialogOpen = true;
    this.cutscene = cutscene; // scripted cutscene: keeps the hotbar VISIBLE (for spotlights), no input field
    this.clearChatter(); // any proactive chip is replaced by the real conversation
    this.publishInventory(); // AI chat hides the hotbar; a cutscene keeps it (publishInventory reads this.cutscene)
    this.closeWallPalette(); // cancel a pending wall-orientation choice
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
    this.setGameCursorCss(); // the 2×-sized game cursor (set globally too, but ensure it's applied)
    this.setImmediateDialog(seed ?? this.fallbackSay(false)); // seeded (from a chatter tap) or a greeting
    // Cutscene: hide only the text-INPUT widgets (`chat-input` panel + `chat-input-field`
    // DOM input) — Cato is speaking, the player just taps to continue. KEEP `chat-text`
    // (the text-area that shows Cato's spoken line) + `chat-message` + portrait + name.
    const roles = cutscene ? GameScene.DIALOG_ROLES.filter((r) => !r.startsWith('chat-input')) : GameScene.DIALOG_ROLES;
    // Cutscene keeps the hotbar visible (for spotlights), so LIFT the box group up to
    // clear it (both are bottom-anchored → they'd overlap). Lift = the hotbar's occupied
    // height + a gap (from hotbarBounds.bar), fallback ~96.
    // ...and the cinematic intro hides the hotbar but adds a bottom LETTERBOX bar, so the
    // box must clear THAT instead (LetterboxScene BAR_FRAC = 0.11 of the screen height).
    const bar = this.registry.get('hotbarBounds') as { bar?: { h?: number } } | undefined;
    this.cutsceneLift = this.cinematic
      ? Math.round(this.scale.height * 0.11) + 16 // sit just above the bottom letterbox bar
      : cutscene ? (bar?.bar?.h ?? 90) + 10 : 0;
    for (const role of roles) {
      const go = getHudObject(this, role) as unknown as
        | { x: number; y: number; setVisible?: (v: boolean) => void; setAlpha?: (a: number) => void }
        | undefined;
      if (!go) continue;
      // Remember the anchored resting y the first time (the tween moves y).
      if (this.dialogY[role] === undefined) this.dialogY[role] = go.y;
      const restY = this.dialogY[role] - this.cutsceneLift; // raised in a cutscene, at rest otherwise
      go.setVisible?.(true);
      go.setAlpha?.(0);
      go.y = restY + 140; // start below → slides up
      this.tweens.add({ targets: go, y: restY, alpha: 1, duration: 300, ease: 'Back.easeOut' });
    }
    // The chat-input-field text-input widget shows + focuses its own DOM input
    // (SDK 1.0.28) the moment it goes visible above — no manual input to create.
    this.catoEmote = 'blink-eye'; // reset the resting expression
    this.setCatoEmote('blink-eye'); // idle until Cato replies
    this.makeDialogTextClickThrough();
  }

  /** The SDK renders `text-area` widgets (Cato's dialogue text + name) as DOM
   *  <div> overlays with `pointer-events:auto` (z-index 99980), so they SWALLOW
   *  clicks landing ON the box — advancing the RPG text only worked when you
   *  clicked OUTSIDE the box (where the click reaches the canvas). These divs are
   *  display-only, so make them click-through; clicks then fall to the canvas and
   *  `advanceDialog` fires. The chat-input-field (text-input, z-index 99990) keeps
   *  its pointer events so the player can still click it to type. Idempotent; the
   *  SDK's per-frame sync doesn't touch pointer-events, so it sticks. */
  private makeDialogTextClickThrough(): void {
    document.querySelectorAll<HTMLDivElement>('body > div').forEach((d) => {
      if (d.style.zIndex === '99980') d.style.pointerEvents = 'none';
    });
  }

  /** Hide the dialog (slide back down) + tear down the typing input. */
  private closeDialog(): void {
    if (!this.dialogOpen) return;
    this.dialogOpen = false;
    this.cutscene = false;
    this.catoTalkTimer?.remove(); // stop the talk→blink settle timer
    this.stopTyping(); // stop any in-progress typewriter
    this.setMoreIcon(false); // hide the pagination "more" icon
    this.publishInventory(); // restore the hotbar after chatting
    // Keep the game's pixel cursor as the canvas cursor (set globally in setupPointerLock) — don't
    // revert to the host arrow. Clicking the canvas re-captures the pointer and CursorScene takes over.
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

  // ── Scripted dialogue (authored cutscenes/intro — NON-AI) ─────────────────────
  //    Plays a `public/dialogue/*.json` node graph (see src/dialogue.ts) through the
  //    SAME chat box, in CUTSCENE mode (no text input): Cato speaks pre-written,
  //    i18n lines; a `spotlight` line highlights a hotbar tool via DialogueScene.
  //    `dialogueSeen` (saved) gates once-only scripts like the new-game intro.

  private dialogueRunner?: DialogueRunner;
  private dialogueFlags = new Set<string>();
  private dialogueSeen = new Set<string>();
  private cutscene = false;
  private cinematic = false; // cinematic intro: letterbox bars + zoomed camera + hidden hotbar
  private preCineCenter?: { x: number; y: number }; // camera framing to restore when the intro ends
  private preCineZoom = 1;
  private cineCamTarget?: { x: number; y: number; zoom: number }; // where the cinematic camera glides toward
  private cineExiting = false; // exit glide in progress → reveal the game on arrival
  private cutsceneLift = 0; // px the dialog box is raised in a cutscene (to clear the visible hotbar)
  private moreIconRestY?: number; // captured anchored y of the "more" arrow (lifted with the box)

  /** After the save loads, play the intro ONCE on a brand-new save. */
  /** Whether the new-game scripted intro should play: only a brand-new game (no save) — or the
   *  `replayIntro` debug flag, which forces it every load for iterating on the script. */
  private shouldPlayIntro(): boolean {
    if (!isDebug('replayIntro') && !this.isNewGame) return false;
    return this.cache.json.exists('dialogue-intro');
  }

  /** Start Cato's scripted intro AFTER the scene-in transition has FULLY revealed (called from
   *  markReady's finishTransition onRevealed). A small extra beat so the dialogue box settles in
   *  gently rather than snapping up the instant the paw finishes opening. */
  private playIntroDialogue(): void {
    this.time.delayedCall(700, () => { if (!this.menuOpen) this.startDialogue('intro'); });
  }

  /** Begin the cinematic intro: remember the gameplay framing (the zoom-OUT target),
   *  slide the letterbox bars in, hide the hotbar, and SNAP the camera onto Cato. We snap
   *  (not pan/zoom-in) because the game is meant to OPEN already on Cato — the movie's end
   *  zoom-OUT is what reveals the real game. */
  private enterCinematic(): void {
    if (this.cinematic) return;
    this.cinematic = true;
    const cam = this.cameras.main;
    // Zoom-OUT target = the CURRENT (gameplay) framing. Derive the centre from scroll
    // (valid synchronously; worldView lags a render). NB: Phaser zooms around the screen
    // CENTRE, so the centred world point is scroll + size/2 — NOT /zoom (the classic
    // center-zoom-origin quirk); exit pans back to exactly this scroll at any zoom.
    this.preCineZoom = cam.zoom;
    this.preCineCenter = { x: cam.scrollX + this.scale.width / 2, y: cam.scrollY + this.scale.height / 2 };
    this.cameraFollow = false; // manual camera during the cutscene (no leash fight)
    this.cineExiting = false;
    this.publishInventory();   // hotbar hidden while cinematic (publishInventory reads this.cinematic)
    (this.scene.get('LetterboxScene') as LetterboxScene | undefined)?.show(500);
    this.snapCameraToCato();   // open ALREADY zoomed on Cato
  }

  /** The cinematic zoom = 1.7× the gameplay zoom (clamped). */
  private cineZoom(): number { return Math.min(MAX_ZOOM, this.preCineZoom * 1.7); }

  /** A camera target that frames `sprite` at screen ratio (rx,ry) at `zoom` (rx>0.5 =
   *  right-of-centre, ry<0.5 = higher). Phaser zooms around the screen centre, so the
   *  screen offset (rx-0.5)*W maps to a world offset (rx-0.5)*W/zoom. */
  private cineFrame(sprite: { x: number; y: number }, rx: number, ry: number, zoom: number): { x: number; y: number; zoom: number } {
    const viewW = this.scale.width / zoom, viewH = this.scale.height / zoom;
    return { x: sprite.x - (rx - 0.5) * viewW, y: sprite.y - (ry - 0.5) * viewH, zoom };
  }

  /** Instantly frame Cato (right-of-centre, a bit high), zoomed in. Opens the cinematic +
   *  handles a cinematic resize. Also sets the glide target so the per-frame step holds it. */
  private snapCameraToCato(): void {
    if (!this.child) return;
    const cam = this.cameras.main;
    const t = this.cineFrame(this.child, 0.66, 0.42, this.cineZoom());
    this.cineCamTarget = t;
    cam.setZoom(t.zoom);
    cam.setScroll(t.x - this.scale.width / 2, t.y - this.scale.height / 2);
  }

  /** Cinematic tool-tour: glide the camera to an in-world object Cato is introducing
   *  ('mailbox'|'chest'|'pad'|'workstation'), or back to Cato ('cato'/unknown). Same
   *  zoom — just a glide (the per-frame step lerps to it). No-op outside the cinematic. */
  private focusCameraOn(target: string | null): void {
    if (!this.cinematic) return;
    const cato = target === 'cato' || target == null;
    const sprite = cato ? this.child : (this.focusTarget(target) ?? this.child);
    if (!sprite) return;
    this.cineCamTarget = this.cineFrame(sprite, cato ? 0.66 : 0.6, cato ? 0.42 : 0.44, this.cineZoom());
    this.cinePlayObjectAnim(cato ? null : target); // loop the tool's animation while it's in focus
  }

  /** Map a `data.focus` name to its in-world sprite. */
  private focusTarget(name: string | null): Phaser.GameObjects.Sprite | undefined {
    switch (name) {
      case 'mailbox': return this.mailbox;
      case 'chest': return this.chest;
      case 'pad': case 'tablet': case 'ipad': return this.pad;
      case 'workstation': case 'work-station': case 'craft': return this.craftStation;
      default: return undefined;
    }
  }

  /** The open/close animation pair for a focusable tool (null = no open/close anim). */
  private objectAnimPair(name: string | null): { open: string; close: string } | null {
    switch (name) {
      case 'mailbox': return { open: this.mailboxHasMail ? 'mailbox-mail-open' : 'mailbox-empty-open', close: 'mailbox-close' };
      case 'chest': return { open: 'chest-open-front', close: 'chest-close-front' };
      case 'pad': case 'tablet': case 'ipad': return { open: 'pad-open', close: 'pad-close' };
      default: return null;
    }
  }

  private cineAnimStop?: () => void; // tears down the current focused-tool animation loop

  /** While a tool is in focus during the intro, LOOP its open↔close animation so the
   *  player clearly sees what Cato is talking about. Stops the previous tool's loop first
   *  (settling it closed). Static tools (work station) get a gentle scale pulse instead. */
  private cinePlayObjectAnim(name: string | null): void {
    if (this.cineAnimStop) { this.cineAnimStop(); this.cineAnimStop = undefined; }
    const sprite = this.focusTarget(name);
    if (!sprite) return; // Cato / unknown → nothing to animate

    const pair = this.objectAnimPair(name);
    if (!pair) {
      // No open/close anim (work station) → a soft scale pulse so it still "reacts".
      const bx = sprite.scaleX, by = sprite.scaleY;
      const tw = this.tweens.add({ targets: sprite, scaleX: bx * 1.08, scaleY: by * 1.08, duration: 480, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
      this.cineAnimStop = () => { tw.stop(); sprite.setScale(bx, by); };
      return;
    }
    if (!this.anims.exists(pair.open) || !this.anims.exists(pair.close)) return;
    let cancelled = false;
    const onComplete = (a: Phaser.Animations.Animation): void => {
      if (cancelled) return;
      if (a.key === pair.open) this.time.delayedCall(550, () => { if (!cancelled) sprite.play(pair.close); }); // hold open, then close
      else this.time.delayedCall(400, () => { if (!cancelled) sprite.play(pair.open); });                     // pause closed, then reopen
    };
    sprite.on(Phaser.Animations.Events.ANIMATION_COMPLETE, onComplete);
    sprite.play(pair.open);
    this.cineAnimStop = () => {
      cancelled = true;
      sprite.off(Phaser.Animations.Events.ANIMATION_COMPLETE, onComplete);
      sprite.stop(); // HALT immediately — don't keep animating after the camera has moved on
      const rest = this.anims.get(pair.open)?.frames?.[0]?.frame?.name; // open anim starts closed
      if (rest != null) sprite.setFrame(rest); // snap to the resting/closed frame
    };
  }

  /** End the cinematic intro: retract the bars, glide the camera back to the pre-intro
   *  framing/zoom (the per-frame step reveals the game on arrival). */
  private exitCinematic(): void {
    if (!this.cinematic) return;
    (this.scene.get('LetterboxScene') as LetterboxScene | undefined)?.hide(650);
    const c = this.preCineCenter ?? { x: this.child?.x ?? 0, y: this.child?.y ?? 0 };
    this.cineCamTarget = { x: c.x, y: c.y, zoom: this.preCineZoom };
    this.cineExiting = true;
    this.time.delayedCall(1400, () => this.finishCinematic()); // safety if the glide never settles
  }

  /** The zoom-OUT finished → hand control back to gameplay + reveal the hotbar. */
  private finishCinematic(): void {
    if (!this.cinematic) return;
    this.cinematic = false;
    this.cineExiting = false;
    this.cineCamTarget = undefined;
    if (this.cineAnimStop) { this.cineAnimStop(); this.cineAnimStop = undefined; } // settle the last tool closed
    this.publishInventory(); // reveal the hotbar — game officially begins
  }

  /** DEBUG: force-replay the intro now — end any open dialogue, clear its seen flag,
   *  and restart it (bypasses the once-only gate). Bound to X under CATO_DEBUG_TILL. */
  private debugReplayIntro(): void {
    if (this.dialogueRunner) this.endDialogue();
    this.dialogueSeen.delete('intro');
    this.enterCinematic();
    this.startDialogue('intro');
  }

  /** Start a scripted dialogue by id (loads its graph from the JSON cache). */
  private startDialogue(scriptId: string): void {
    const script = this.cache.json.get('dialogue-' + scriptId) as DialogueScript | undefined;
    if (!script || this.dialogueRunner) return;
    this.dialogueSeen.add(scriptId); // once-only: mark seen up front so a reload can't replay
    this.scheduleSave();
    const host: DialogueHost = {
      showLine: (text, opts) => this.dialogueShowLine(text, opts),
      showChoices: (_prompt, _options, pick) => { pick(0); }, // P1: linear scripts only (no choice UI yet)
      getFlag: (f) => this.dialogueFlags.has(f),
      setFlag: (f, v) => { v ? this.dialogueFlags.add(f) : this.dialogueFlags.delete(f); },
      finish: () => this.endDialogue(),
    };
    this.dialogueRunner = new DialogueRunner(script, host, (tx) => this.dialogueSubstitute(trDialogue(tx, getLang())));
    this.dialogueRunner.start();
  }

  /** Fill {name} with the signed-in player's name (or a friendly fallback). */
  private dialogueSubstitute(text: string): string {
    const name = this.umicat?.user?.name?.trim() || (getLang() === 'zh-CN' ? '朋友' : 'friend');
    return text.replace(/\{name\}/g, name);
  }

  /** Host: show a cutscene line (opens the box in cutscene mode on the first line),
   *  set the spotlight, play the mood, type it out. */
  private dialogueShowLine(text: string, opts: { emote?: string; spotlight?: string | null; focus?: string | null }): void {
    if (!this.dialogOpen) this.openDialog(undefined, true); // cutscene: box + portrait, NO input
    this.cutscene = true;
    this.setDialogueSpotlight(opts.spotlight ?? null);
    if (this.cinematic) this.focusCameraOn(opts.focus ?? 'cato'); // fly to the tool being introduced (else back to Cato)
    if (opts.emote) this.catoReact(opts.emote as never, { force: true }); // bubble emote over Cato's head
    this.catoTalkFor(text);
    this.showDialogText(text);
  }

  /** Player advanced (tap/space) during a cutscene — reveal/next page, else next node,
   *  else the script's `finish` closes it. Returns true if it consumed the input. */
  private advanceCutscene(): boolean {
    if (this.advanceDialog()) return true; // still typing / more pages of this line
    if (this.dialogueRunner && !this.dialogueRunner.isDone) { this.dialogueRunner.advance(); return true; }
    return false;
  }

  /** Host: script ended → close the box + clear the spotlight. */
  private endDialogue(): void {
    this.dialogueRunner = undefined;
    this.cutscene = false;
    this.setDialogueSpotlight(null);
    if (this.dialogOpen) this.closeDialog();
    if (this.cinematic) this.exitCinematic(); // intro over → retract bars, zoom back, show hotbar
  }

  /** Point DialogueScene at a named UI target ('hotbar:<toolId>' | 'hotbar:seed' | null). */
  private setDialogueSpotlight(target: string | null): void {
    const rect = target ? this.spotlightRect(target) : null;
    this.registry.set('dialogueSpotlight', rect ? { ...rect, rev: (this.registry.get('dialogueSpotlight')?.rev ?? 0) + 1 } : null);
  }

  /** Resolve a spotlight target to a screen rect (P1: hotbar slots by tool). */
  private spotlightRect(target: string): { x: number; y: number; w: number; h: number } | null {
    const bounds = this.registry.get('hotbarBounds') as
      | { slots?: Array<{ x: number; y: number; w: number; h: number }> }
      | undefined;
    const slots = bounds?.slots;
    if (!slots) return null;
    if (target.startsWith('hotbar:')) {
      const want = target.slice(7); // toolId, or 'seed' = any seed bag
      const idx = this.inventory.findIndex((it, i) => i < INV_COLS && it != null && (
        want === 'seed' ? !!it.plants : it.toolId === want
      ));
      if (idx >= 0 && slots[idx]) return slots[idx];
    }
    return null;
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

    // Wild world: what's out there for Cato to chop / mine / pick / forage.
    let treesWithFruit = 0;
    for (const t of this.trees.values()) if (t.hasFruit) treesWithFruit += 1;
    let ripeBushes = 0;
    for (const b of this.bushes.values()) if (b.stage >= 2) ripeBushes += 1;
    let matureForageables = 0;
    for (const f of this.foragables.values()) if (f.stage >= (FORAGABLES[f.type]?.stages ?? 1)) matureForageables += 1;

    return {
      island: 'home',
      timeOfDay: ['morning', 'morning', 'midday', 'afternoon', 'evening'][this.pointerStep() - 1],
      cato: {
        // Cato's own energy. exhausted → he CAN'T do chores; see the energy rule.
        energyPct: Math.round((this.stamina / this.staminaMax) * 100),
        exhausted: this.exhausted,
        autoFarming: { harvest: this.autonomy.harvest, water: this.autonomy.water },
        // The last little thing Cato said on his own (the friend may be replying to it).
        ...(this.lastChatter ? { lastRemark: this.lastChatter } : {}),
      },
      backpack, // e.g. [{item:'Corn seeds', count:10}, {item:'Hoe', count:1}]
      farm: {
        plantedByCrop: byType, // {corn:3, carrot:2}
        ripe, // ready to harvest
        growing, // still growing
        thirsty, // growing on dry soil (would grow faster if watered)
        tilledEmpty, // tilled soil with nothing planted yet
      },
      wild: {
        trees: this.trees.size, // trees you can chop down (chop_trees)
        treesWithFruit, // of those, how many are bearing fruit right now (harvest_fruit)
        bigStones: this.bigStones.size, // big rocks you can mine (mine_stones)
        ripeBushes, // berry bushes ready to pick (harvest_bushes)
        matureForageables, // wild mushrooms/flowers/grass/stones grown enough to gather (forage)
      },
    };
  }

  // ── Loading gate (hide content until the save is restored) ────────────

  /** Cover the whole viewport (backstop behind the paw wipe) so the empty/default world is
   *  never shown before the save is applied. NB: the paw HOLDS closed (showing "Loading")
   *  until the world is ready — markReady() uncovers it — so this overlay stays behind the
   *  paw and is only seen in the rare no-transition path. */
  private showLoadingCover(): void {
    if (this.loadingOverlay) return;
    this.loadingOverlay = new LoadingOverlay(this);
  }

  /** Reveal the game once the save is restored (or a fallback fires): fade the
   *  cover out + let the hotbar show. */
  private markReady(): void {
    if (this.gameReady) return;
    this.gameReady = true;
    this.publishInventory(); // hotbar was suppressed until now
    this.publishWeatherHud(); // reveal the weather HUD now that gameReady is true
    this.emote?.setAmbient(this.bgIndex() === WEATHER_BGS.length - 1 ? 'sleepy' : 'idle'); // seed his mood (handles load-at-night)
    this.loadingOverlay?.fadeOut();
    this.loadingOverlay = undefined;
    // Framing: a brand-new game opens on the house (Cato at the door); a returning
    // save centres the camera on the restored Cato.
    if (this.isNewGame) this.frameNewGameStart();
    else if (this.child) this.cameras.main.setScroll(this.child.x - this.scale.width / 2, this.child.y - this.scale.height / 2);
    // New-game intro: snap into the cinematic framing NOW (camera on Cato + letterbox) so the
    // paw opens onto the already-composed shot — but HOLD Cato's dialogue box until the paw has
    // FULLY opened (finishTransition's onRevealed), so the box doesn't rush in mid-transition.
    const playIntro = this.shouldPlayIntro();
    if (playIntro) this.enterCinematic();
    // World + save are ready and the camera is framed → NOW uncover: the paw (which held
    // closed showing "Loading") reveals the ready game directly (no reveal-time overlay).
    finishTransition(this, () => { if (playIntro) this.playIntroDialogue(); });
  }

  /** New-game opening: put Cato at the doorway OUTSIDE the house (so he doesn't get
   *  trapped wandering the interior) and frame the house in the centre. */
  private frameNewGameStart(): void {
    const door = this.houseDoor;
    const layer = this.islandLayer;
    if (door && this.child && layer) {
      const dt = layer.worldToTileXY(door.x, door.y);
      // Step DOWN from the door tile past the house FOOTPRINT (cells with a
      // `wooden_house` tile) to the first walkable grass; then one more tile so his
      // (tall) body clears the wall — he stands clearly OUTSIDE, in front of the door.
      let out: { cx: number; cy: number } | null = null;
      if (dt) {
        for (let dy = 1; dy <= 6 && !out; dy++) {
          const cx = dt.x, cy = dt.y + dy;
          const ht = this.wallLayer?.getTileAt(cx, cy);
          const insideHouse = !!ht && ht.index !== -1;
          if (!insideHouse && this.isWalkableCell(cx, cy)) out = { cx, cy };
        }
      }
      if (out && this.isWalkableCell(out.cx, out.cy + 1)) out.cy += 1; // one tile clear of the wall
      const w = out ? layer.tileToWorldXY(out.cx, out.cy) : null;
      if (w) this.child.setPosition(w.x + TILE / 2, w.y + TILE / 2);
      else this.child.setPosition(door.x, door.y + TILE * 2.5); // fallback: clearly below
      (this.child.body as Phaser.Physics.Arcade.Body | undefined)?.reset(this.child.x, this.child.y);
    }
    // Frame the house, but centre VERTICALLY on the doorway (not the house middle) so
    // the leash — which pulls Cato toward the camera centre — keeps him at the door
    // OUTSIDE, instead of dragging him into the interior (where he'd get stuck).
    const hc = this.houseCenter();
    const camY = door ? door.y : (hc ? hc.y : this.child?.y ?? 0);
    if (hc) this.cameras.main.setScroll(hc.x - this.scale.width / 2, camY - this.scale.height / 2);
    this.cameraFollow = false; // hold the framing; the player/tasks re-enable follow later
  }

  /** World centre of the default house = the bounds centre of the `wooden_house`
   *  painted tiles; falls back to the door, then null. */
  private houseCenter(): { x: number; y: number } | null {
    const layer = this.wallLayer;
    if (layer) {
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity, found = false;
      layer.forEachTile((t) => {
        if (t && t.index !== -1) {
          found = true;
          const cx = t.getCenterX(), cy = t.getCenterY();
          minX = Math.min(minX, cx); minY = Math.min(minY, cy);
          maxX = Math.max(maxX, cx); maxY = Math.max(maxY, cy);
        }
      });
      if (found) return { x: (minX + maxX) / 2, y: (minY + maxY) / 2 };
    }
    return this.houseDoor ? { x: this.houseDoor.x, y: this.houseDoor.y } : null;
  }

  // ── Save data (auto-save + restore) ───────────────────────────────────

  /** Serialize the whole game state into the save blob. */
  private buildSave(): SaveBlob {
    return {
      v: 14,
      inventory: this.inventory.map((c) => (c ? { id: c.id, count: c.count } : null)),
      selected: this.hotbarSelected,
      tilled: [...this.tilledCells],
      soilWet: [...this.soilWet],
      crops: [...this.crops].map(([key, c]) => ({ key, name: c.name, stage: c.stage, timer: c.timer })),
      cato: this.child ? { x: Math.round(this.child.x), y: Math.round(this.child.y) } : null,
      placed: [...this.placed].map(([key, o]) => ({ key, kind: o.kind, variant: o.variant, orient: o.orient })),
      floors: [...this.floors].map(([key, f]) => ({ key, frame: f.frame })),
      trees: [...this.trees].filter(([, t]) => !t.sceneWired).map(([key, t]) => ({ key, type: t.type, hasFruit: t.hasFruit })),
      bushes: [...this.bushes].filter(([, b]) => !b.sceneWired).map(([key, b]) => ({ key, type: b.type, stage: b.stage })),
      foragables: [...this.foragables].filter(([, f]) => !f.sceneWired).map(([key, f]) => ({ key, type: f.type, stage: f.stage, timer: f.timer })),
      bigStones: [...this.bigStones].filter(([, s]) => !s.sceneWired).map(([key, s]) => ({ key, tier: s.tier, ready: s.ready })),
      money: this.money,
      dayTimeMs: Math.round(this.dayTimeMs),
      dayCount: this.dayCount,
      mailbox: this.mailboxStore.map((it) => ({ id: it.id, count: it.count })),
      chest: this.chestStore.map((it) => ({ id: it.id, count: it.count })),
      mail: this.mailList.map((m) => ({ ...m })),
      autonomy: { ...this.autonomy },
      staminaMax: this.staminaMax,
      stamina: Math.round(this.stamina),
      chestSeeded: this.chestSeeded,
      catoBag: this.catoBagStore.map((it) => ({ id: it.id, count: it.count })),
      backpack: this.backpackStore.map((it) => ({ id: it.id, count: it.count })),
      dialogueSeen: [...this.dialogueSeen],
      dialogueFlags: [...this.dialogueFlags],
    };
  }

  /** Persist now (fire-and-forget; anonymous → localStorage, signed-in → backend). */
  private saveGame(): void {
    if (!this.umicat || this.loadingSave || !this.saveArmed) return;
    this.umicat.saves.set('state', this.buildSave()).catch((e) => console.warn('[catopia][save] set failed', e));
  }

  /** DEV (Shift+Delete): wipe this game's save + reload to a fresh EMPTY map, so a
   *  default layout can be arranged from scratch. Disarms saving + cancels the
   *  pending debounced save FIRST so the current in-memory state can't re-save over
   *  the delete before the reload lands. */
  private async debugWipeSave(): Promise<void> {
    if (!this.umicat) return;
    this.saveArmed = false;
    this.pendingSave?.remove();
    try {
      await this.umicat.saves.delete('state');
      console.warn('[catopia] save WIPED — reloading to an empty map');
    } catch (e) {
      console.warn('[catopia] save wipe failed', e);
    }
    if (typeof window !== 'undefined') window.location.reload();
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
      // Apply ANY valid save (applySave defaults each field, so newer/older blobs
      // load cleanly). NO save at all → this is a brand-new game (opening flow).
      if (s && typeof s.v === 'number' && s.v >= 1) this.applySave(s);
      else this.isNewGame = true;
      // The store was read (found or empty) → NOW it's safe to overwrite it.
      this.saveArmed = true;
      // TEST-PHASE: keep a coin floor so testers (esp. on touch, no Y key) can always
      // afford to order. Gated on the debug flag → removed for release. Only tops up.
      if (isDebug('coinFloor') && this.money < 5000) { this.money = 5000; this.publishWeatherHud(); this.scheduleSave(); }
      if (CATO_DEBUG_TILL && DEBUG_CLEAR_MAILBOX) { this.mailboxStore = []; this.mailboxHasMail = false; this.scheduleSave(); }
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
      for (const arr of this.tilledGrass.values()) for (const g of arr) g.destroy();
      this.tilledGrass.clear();
      for (const l of this.loosenedCells.values()) { l.overlay.destroy(); l.timer.remove(); }
      this.loosenedCells.clear();
      for (const c of this.crops.values()) c.sprite.destroy();
      this.crops.clear();
      this.tilledCells.clear();
      this.soilWet.clear();
      // House: tear down placed structures + their colliders, then rebuild.
      for (const o of this.placed.values()) { o.sprite.destroy(); o.bodies?.forEach((b) => b.destroy()); }
      this.placed.clear();
      for (const f of this.floors.values()) f.sprite.destroy();
      this.floors.clear();
      for (const t of this.placedHoedOnce.values()) t.remove();
      this.placedHoedOnce.clear();
      // Trees: tear down sprites + trunk colliders (+ drop them from the y-sort list).
      // EXCEPT scene-wired (editor-placed) trees — they come from the SCENE data, not
      // the save (buildSave excludes them), so they must SURVIVE a save-load or they'd
      // vanish (the "树都不见了" bug).
      for (const [key, t] of this.trees) {
        if (t.sceneWired) continue;
        const i = this.ySortSprites.indexOf(t.sprite);
        if (i >= 0) this.ySortSprites.splice(i, 1);
        t.sprite.destroy();
        t.body?.destroy();
        t.timer?.remove();
        this.trees.delete(key);
      }
      // Bushes: tear down base + berry overlays — EXCEPT scene-wired (editor-placed)
      // bushes (re-derived from the scene each load, not the save; must survive it).
      for (const [key, b] of this.bushes) {
        if (b.sceneWired) continue;
        b.base.destroy();
        for (const berry of b.berries) berry.destroy();
        this.bushes.delete(key);
      }
      // Foragables + big-stones: tear down sprites (+ stone colliders) — EXCEPT
      // scene-wired (editor-placed) ones (re-derived from the scene each load, not the
      // save; must survive it, like the trees/bushes).
      for (const [key, f] of this.foragables) {
        if (f.sceneWired) continue;
        this.tweens.killTweensOf(f.sprite); // stop any in-flight rustle before destroy
        f.body?.destroy();
        f.sprite.destroy();
        this.foragables.delete(key);
      }
      for (const [key, s] of this.bigStones) {
        if (s.sceneWired) continue;
        s.sprite.destroy();
        s.body?.destroy();
        this.bigStones.delete(key);
      }
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
        for (const f of s.floors ?? []) this.restoreFloor(f.key, f.frame);
        for (const p of s.placed ?? []) this.restorePlaced(p.key, p.kind, p.orient, p.variant);
        for (const t of s.trees ?? []) this.restoreTree(t.key, t.type, t.hasFruit);
        for (const b of s.bushes ?? []) this.restoreBush(b.key, b.type, b.stage);
        for (const f of s.foragables ?? []) this.restoreForagable(f.key, f.type, f.stage, f.timer);
        for (const st of s.bigStones ?? []) this.restoreBigStone(st.key, st.tier, st.ready);
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
      // Money + day clock (v6; older saves default to 0 = fresh morning, no coins).
      this.money = s.money ?? 0;
      this.dayTimeMs = s.dayTimeMs ?? 0;
      this.dayCount = s.dayCount ?? 0;
      // Mailbox + chest contents (v7). Older saves (no field) keep the seeded test
      // stores — restore ONLY when the save actually carries them.
      if (s.mailbox) this.mailboxStore = s.mailbox.map((it) => itemFromId(it.id, it.count));
      if (s.chest) this.chestStore = s.chest.map((it) => itemFromId(it.id, it.count));
      // Cato shares the player's backpack now — fold any old Cato-bag items into it, then drop it.
      if (s.catoBag) for (const it of s.catoBag) this.addToStore(this.backpackStore, itemFromId(it.id, it.count));
      this.catoBagStore = [];
      if (s.backpack) this.backpackStore = s.backpack.map((it) => itemFromId(it.id, it.count));
      // Ensure the everyday tools live in the backpack. Recovers mid-rework saves where the
      // hoe/watering-can/axe/pickaxe ended up on the old hotbar / vestigial `inventory` (never
      // persisted in SaveBlob) → `findOwnedTool` returned null → the tool wheel wouldn't open on
      // grass/stone/berries. Idempotent (skips a tool already present).
      for (const t of ['hoe', 'watering-can', 'axe', 'pickaxe'] as ToolId[]) {
        if (!this.backpackStore.some((s2) => s2.toolId === t)) this.addToStore(this.backpackStore, itemFromId(t, 1));
      }
      // Grant missing starter items INTO THE CHEST — AFTER it's restored (else the
      // restore above would wipe the grants). Building materials are idempotent; the
      // spare seeds are one-time (chestSeeded flag) so they don't refill after use.
      this.chestSeeded = s.chestSeeded ?? false;
      this.dialogueSeen = new Set(s.dialogueSeen ?? []);
      this.dialogueFlags = new Set(s.dialogueFlags ?? []);
      this.ensureBuildingMaterials();
      this.grantStarterSeedsOnce();
      if (s.mail) {
        this.mailList = s.mail.map((m) => ({ ...m }));
        // Keep the id sequence ahead of any restored ids so new mail can't collide.
        this.mailIdSeq = this.mailList.reduce((mx, m) => Math.max(mx, parseInt(m.id.replace(/\D/g, ''), 10) || 0), 0);
      }
      if (s.autonomy) this.autonomy = { harvest: !!s.autonomy.harvest, water: !!s.autonomy.water };
      if (typeof s.staminaMax === 'number' && s.staminaMax > 0) this.staminaMax = s.staminaMax;
      if (typeof s.stamina === 'number') this.stamina = Phaser.Math.Clamp(s.stamina, 0, this.staminaMax);
      this.exhausted = this.stamina <= 0; // if he was saved drained, he's still resting
      this.equipSelected();
      this.publishInventory();
      this.publishWeatherHud();
    } finally {
      this.loadingSave = false;
    }
  }

  private hasMaterial(id: string): boolean {
    return this.inventory.some((c) => c?.id === id) || this.chestStore.some((s) => s.id === id);
  }

  /** One-time: drop a spare stack of every crop seed into the chest (so there are seeds
   *  to 进 Hotbar / plant beyond the starting hotbar). Guarded by `chestSeeded` so it
   *  runs once per save and never refills after the player uses/sells them. */
  private grantStarterSeedsOnce(): void {
    if (this.chestSeeded) return;
    for (const c of CROP_NAMES) if (!this.chestStore.some((s) => s.id === `${c}-seed`)) this.addToChest(makeSeed(c, 20));
    this.chestSeeded = true;
    this.scheduleSave();
  }

  /** Grant the building materials to anyone who doesn't have them yet. There's no
   *  backpack, so extras go into the CHEST (drag them 进 Hotbar to build). Idempotent —
   *  checks the hotbar AND the chest so it only adds what's genuinely missing. */
  private ensureBuildingMaterials(): void {
    if (!this.hasMaterial('wall')) this.addToChest(makePlaceable('wall', 99));
    if (!this.hasMaterial('floor')) this.addToChest(makePlaceable('floor', 99));
    if (!this.hasMaterial('window')) this.addToChest(makePlaceable('window', 99));
    if (!this.hasMaterial('door-item')) this.addToChest(makePlaceable('door', 10));
    for (const piece of FURNITURE) {
      if (!this.hasMaterial(`furn-${piece.id}`)) this.addToChest(makePlaceable('furniture', 10, piece.id));
    }
    if (!this.hasMaterial('axe')) this.addToChest(itemFromId('axe', 1));
    if (!this.hasMaterial('pickaxe')) this.addToChest(itemFromId('pickaxe', 1));
    for (const t of TREE_TYPES) {
      if (!this.hasMaterial(`tree-${t.id}`)) this.addToChest(makePlaceable('tree', 10, t.id));
    }
    for (const b of BERRY_TYPES) {
      if (!this.hasMaterial(`bush-${b}`)) this.addToChest(makePlaceable('bush', 10, b));
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

  /** Recreate a placed building piece (+ its collider) from a save / the debug
   *  builder. Mirrors placeObject but doesn't touch the inventory. */
  private restorePlaced(key: string, kind: PlaceKind, orient: WallOrient, variant?: string): void {
    if (!this.islandLayer) return;
    // MIGRATION: a non-solid wall tile is a FLOOR — older saves stored floors in
    // `placed` (as 'window' walls), which would restore at footY depth and cover
    // Cato. Route them to the `floors` ground layer instead.
    if (kind === 'wall' && this.wallTile(WALL_FRAME[orient])?.solid === false) {
      this.restoreFloor(key, WALL_FRAME[orient]);
      return;
    }
    const [cx, cy] = key.split(',').map(Number);
    const w = this.islandLayer.tileToWorldXY(cx!, cy!);
    if (!w) return;
    const footX = w.x + TILE / 2;
    const footY = w.y + TILE;
    const frame = kind === 'wall' ? WALL_FRAME[orient]
      : kind === 'window' ? WINDOW_FRAME
      : kind === 'door' ? DOOR_CLOSED_FRAME
      : (FURN_BY_ID.get(variant ?? '') ?? FURNITURE[0]!).frame;
    const texture = kind === 'wall' || kind === 'window' ? 'house-walls' : kind === 'door' ? 'door' : 'furniture';
    const sprite = this.add.sprite(footX, footY, texture, frame).setOrigin(0.5, 1).setDepth(footY);
    const obj: PlacedObj = { kind, variant, orient, frame, sprite };
    if (kind === 'wall' || kind === 'window' || kind === 'door') obj.bodies = this.addSolid(cx!, cy!, texture, frame);
    if (kind === 'door') obj.open = false;
    this.placed.set(key, obj);
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
    this.setImmediateDialog('Hmm…'); // Cato's own "thinking" beat, not a description
    try {
      if (!this.cato) {
        this.setImmediateDialog("Cato tilts its head — it can't quite hear you right now.");
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
        const parsed = this.parseEmoteMarker(r.say || '');
        const say = this.stripAsides(parsed.text) || this.fallbackSay(!!r.do?.length);
        this.showDialogText(say); // RPG typewriter + pagination
        // The [mood] marker becomes the resting expression (held until the next
        // reply); no marker → a plain blink.
        this.catoEmote = parsed.anim ?? 'blink-eye';
        this.catoTalkFor(say); // talk a beat, then settle onto catoEmote + hold
        if (r.do?.length) this.runCatoActions(r.do);
      } else if (r.reason === 'SIGN_IN_REQUIRED') {
        this.setImmediateDialog("Cato peers past you — sign in and we can really talk.");
      } else if (r.reason === 'INSUFFICIENT_CREDITS') {
        this.setImmediateDialog('Cato yawns — out of energy for now.');
      } else {
        this.setImmediateDialog("Cato's ears droop — it couldn't find the words just now.");
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
      // `ysortBias` lets a "stand-on" piece (a bed) sort by its TOP edge instead
      // of its foot, so Cato lying on it draws in front instead of under it.
      const foot = this.footLine(s) + ((s.getData('ysortBias') as number) ?? 0);
      s.setDepth(Math.round(foot));
      // Debug: draw the foot line so the flip point is visible on screen.
      if (g) g.lineBetween(s.x - 24, foot, s.x + 24, foot);
    }
    this.sortPadOnDesk();
  }

  /** The desk pad sits ON a table, so its own foot line is HIGHER on screen than the
   *  table's → plain foot-sort hides it under the desk. Keep it one above the deepest
   *  FURNITURE piece it overlaps (NOT above Cato — so he still occludes it when he walks
   *  in front). Runs after the main pass so the furniture depths are already set. */
  private sortPadOnDesk(): void {
    if (!this.pad?.active) return;
    const pb = this.pad.getBounds();
    let d = Math.round(this.footLine(this.pad));
    for (const s of this.ySortSprites) {
      if (s === this.pad || !s.active || s.getData('entityAssetId') !== 'basic_furniture') continue;
      if (Phaser.Geom.Intersects.RectangleToRectangle(pb, s.getBounds())) d = Math.max(d, s.depth);
    }
    this.pad.setDepth(d + 1);
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

  /** PLAYER CONTROL: WASD / arrow keys drive Cato directly (velocity + walk anim);
   *  the camera follows him and arcade collision stops him at walls. 8-directional
   *  movement, facing by the dominant axis (the sheet has no diagonal walk). Frozen
   *  while chatting / in the backpack. */
  // ── TEST control-mode toggle (on-screen button) ─────────────────────────────

  /** Create the on-screen TEST button that flips between "drive Cato" and "pan the
   *  camera" so you don't have to change the code to switch. It's a plain DOM button
   *  over the canvas (works on touch without pointer lock; on desktop under pointer
   *  lock press Esc first). Removed on scene shutdown so a restart won't stack it. */
  private createControlToggle(): void {
    if (typeof document === 'undefined' || this.controlToggleBtn) return;
    const btn = document.createElement('button');
    Object.assign(btn.style, {
      position: 'fixed', top: '10px', left: '50%', transform: 'translateX(-50%)',
      zIndex: '2147483647', padding: '7px 13px', font: '600 13px system-ui, sans-serif',
      color: '#3f2c18', background: 'rgba(242,226,196,0.95)', border: '2px solid #5b3a1e',
      borderRadius: '10px', cursor: 'pointer', boxShadow: '0 2px 6px rgba(0,0,0,0.25)',
      userSelect: 'none', touchAction: 'manipulation',
    } as Partial<CSSStyleDeclaration>);
    const onClick = (e: Event) => { e.preventDefault(); e.stopPropagation(); this.setControlMode(!this.playerControl); };
    btn.addEventListener('click', onClick);
    (this.game.canvas?.parentElement ?? document.body).appendChild(btn);
    this.controlToggleBtn = btn;
    this.setControlMode(this.playerControl); // set the initial label
    const cleanup = () => { btn.remove(); this.controlToggleBtn = undefined; };
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, cleanup);
    this.events.once(Phaser.Scenes.Events.DESTROY, cleanup);
    this.createTimeSkipButton();
  }

  /** On-screen ⏩ button (bottom-left) that fast-forwards the day clock a step per tap
   *  — the touch equivalent of the U key (tablets have no keyboard). Test-only DOM
   *  button, removed on scene shutdown. */
  private createTimeSkipButton(): void {
    if (typeof document === 'undefined' || this.timeSkipBtn) return;
    const btn = document.createElement('button');
    btn.textContent = '⏩ 时间';
    Object.assign(btn.style, {
      position: 'fixed', bottom: '14px', left: '14px',
      zIndex: '2147483647', padding: '9px 15px', font: '600 15px system-ui, sans-serif',
      color: '#3f2c18', background: 'rgba(242,226,196,0.95)', border: '2px solid #5b3a1e',
      borderRadius: '10px', cursor: 'pointer', boxShadow: '0 2px 6px rgba(0,0,0,0.25)',
      userSelect: 'none', touchAction: 'manipulation',
    } as Partial<CSSStyleDeclaration>);
    const onClick = (e: Event) => { e.preventDefault(); e.stopPropagation(); this.fastForwardTime(); };
    btn.addEventListener('click', onClick);
    (this.game.canvas?.parentElement ?? document.body).appendChild(btn);
    this.timeSkipBtn = btn;
    const cleanup = () => { btn.remove(); this.timeSkipBtn = undefined; };
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, cleanup);
    this.events.once(Phaser.Scenes.Events.DESTROY, cleanup);
  }

  /** Switch control mode + reflect it on the button. Cato mode → camera follows him;
   *  camera mode → free pan + Cato resumes wandering (stop his residual velocity). */
  private setControlMode(on: boolean): void {
    this.playerControl = on;
    this.cameraFollow = on;
    if (!on && this.child?.body) (this.child.body as Phaser.Physics.Arcade.Body).setVelocity(0, 0);
    if (this.controlToggleBtn) this.controlToggleBtn.textContent = on ? '控制: 猫 (点击切到相机)' : '控制: 相机 (点击切到猫)';
  }

  private updatePlayerMovement(): void {
    if (!this.child?.body) return;
    this.cameraFollow = true; // keep Cato centred while the player drives him
    // A chat-commanded task OWNS Cato (walk + tool swing). Bail so we don't stamp
    // `idle-<dir>` over his strike animation every frame during the per-hit cooldown
    // (updateCatoTask holds the swing's last frame; this used to clobber it → he
    // looked like he was just standing there while chopping/tilling).
    if (this.catoTask) return;
    const body = this.child.body as Phaser.Physics.Arcade.Body;
    if (this.dialogOpen || this.inventoryOpen) { body.setVelocity(0, 0); return; }
    const k = this.keys;
    let dx = 0, dy = 0;
    if (k) {
      if (k.left.isDown || k.a.isDown) dx -= 1;
      if (k.right.isDown || k.d.isDown) dx += 1;
      if (k.up.isDown || k.w.isDown) dy -= 1;
      if (k.down.isDown || k.s.isDown) dy += 1;
    }
    if (dx === 0 && dy === 0) {
      body.setVelocity(0, 0);
      this.child.play(`idle-${this.faceDir}`, true);
      return;
    }
    const len = Math.hypot(dx, dy);
    body.setVelocity((dx / len) * PLAYER_SPEED, (dy / len) * PLAYER_SPEED);
    if (Math.abs(dx) >= Math.abs(dy)) this.faceDir = dx < 0 ? 'left' : 'right';
    else this.faceDir = dy < 0 ? 'up' : 'down';
    this.child.play(`walk-${this.faceDir}`, true);
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

  /** Begin a REST phase: stop and idle, facing the last way, for a good while.
   *  (Cato lingers far more than he strolls — this is his default state.) */
  private startWanderIdle(): void {
    if (!this.child?.body) return;
    const body = this.child.body as Phaser.Physics.Arcade.Body;
    body.setVelocity(0, 0);
    this.child.play(`idle-${this.faceDir}`, true);
    this.wanderState = 'idle';
    this.wanderTarget = null;
    this.wanderInterval = Phaser.Math.Between(REST_MIN_MS, REST_MAX_MS);
    this.wanderTimer = 0;
  }

  /** Radius (world px) Cato is allowed to stray from the camera centre — sized to
   *  the visible area so he keeps in frame at any zoom. */
  private wanderLeashRadius(): number {
    const v = this.cameras.main.worldView;
    return Math.max(64, Math.min(v.width, v.height) / 2 - 28);
  }

  /** Turn Cato to face a point (used when he arrives at a POI so he "looks at" it). */
  private faceTargetPoint(x: number, y: number): void {
    if (!this.child) return;
    const dx = x - this.child.x;
    const dy = y - this.child.y;
    if (Math.abs(dx) >= Math.abs(dy)) this.faceDir = dx < 0 ? 'left' : 'right';
    else this.faceDir = dy < 0 ? 'up' : 'down';
  }

  /** A nearby thing worth ambling over to inspect — a planted CROP or a world PROP
   *  (decoration sprite) that's within reach (inside the leash) and far enough to
   *  be worth the trip. Returns one at random, or null if nothing qualifies. */
  private pickWanderTarget(leashR: number): { x: number; y: number } | null {
    if (!this.child) return null;
    const cam = this.cameras.main;
    const ccx = cam.worldView.centerX;
    const ccy = cam.worldView.centerY;
    const cx = this.child.x;
    const cy = this.child.y;
    const ok = (x: number, y: number): boolean =>
      Math.hypot(x - ccx, y - ccy) < leashR - 8 &&      // reachable without tripping the leash
      Math.hypot(x - cx, y - cy) > WANDER_MIN_TRIP;      // far enough to be worth moving
    const cands: { x: number; y: number }[] = [];
    for (const c of this.crops.values()) {
      const s = c.sprite;
      if (s && ok(s.x, s.y)) cands.push({ x: s.x, y: s.y });
    }
    for (const s of this.ySortSprites) {
      if (s !== this.child && s.active && ok(s.x, s.y)) cands.push({ x: s.x, y: s.y });
    }
    return cands.length ? Phaser.Utils.Array.GetRandom(cands) : null;
  }

  /** A random spot near the camera centre for an aimless amble when nothing
   *  interesting is in reach (kept inside the leash so he stays in view). */
  private randomStrollPoint(leashR: number): { x: number; y: number } {
    const v = this.cameras.main.worldView;
    const ang = Phaser.Math.FloatBetween(0, Math.PI * 2);
    const r = Phaser.Math.Between(Math.round(WANDER_MIN_TRIP + 8), Math.round(leashR - 12));
    return { x: v.centerX + Math.cos(ang) * r, y: v.centerY + Math.sin(ang) * r };
  }

  /** A rest just ended: mostly he ambles to a nearby point of interest and lingers
   *  there; sometimes (nothing in reach, or by chance) he just rests again. */
  private beginNextWanderMove(): void {
    const leashR = this.wanderLeashRadius();
    const poi = this.pickWanderTarget(leashR);
    if (poi && Phaser.Math.FloatBetween(0, 1) < WANDER_MOVE_CHANCE) {
      this.wanderTarget = poi;
      this.wanderState = 'walk';
      return;
    }
    if (!poi && Phaser.Math.FloatBetween(0, 1) < WANDER_STROLL_CHANCE) {
      this.wanderTarget = this.randomStrollPoint(leashR);
      this.wanderState = 'walk';
      return;
    }
    this.startWanderIdle(); // linger a while longer
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
    this.loadingOverlay?.update(delta); // drift the loading-screen wallpaper while it's up
    this.updateEdgeScroll(delta);
    this.updateSoil(delta); // count down soil wetness (dry out over time)
    this.updateCrops(delta); // grow planted crops through their stages
    this.updateBushes(delta); // grow berry bushes (+ regrow after harvest)
    this.updateBushBrush(); // rustle a bush as Cato walks onto its cell
    this.updateForagables(delta); // grow wild foragables toward their max stage
    this.updateBigStones(delta); // regenerate mined stones back into big-stones
    if (SPAWN_WILD) this.trySpawn(delta); // drop new foragables / big-stones onto empty grass (TEMP off while authoring)
    this.updateDoors(); // open placed doors as Cato approaches, close when he leaves
    this.updateHouseDoor(); // the editor-authored default-house door
    this.updateDayClock(delta); // advance the time-of-day clock → HUD sun-arc pointer
    this.updateNightMask(); // tint the world toward evening / night
    this.updateStamina(delta); // drain while working / regen while resting → gauge + tired emotes
    this.emote?.update(_time); // Cato's reactive emote bubble (follow + expire + idle)
    this.applyYSort(); // depth = foot Y, so Cato passes before/behind props

    // Camera follow runs in POST_UPDATE (updateCameraFollow) so it sees Cato's
    // FINAL position for the frame — see the note where it's registered in create().

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
    this.updateHoverInspect(); // empty hand → white ring + name over the hovered object
    if (this.toolPaletteOpen) {
      // Close the tool palette if the context changed (a modal opened, or something got equipped);
      // else keep its buttons tracking the camera.
      // NB: don't auto-close just because a tool is held — Tab / the tool-HUD button open the wheel
      // WHILE holding a tool (to switch or cancel). It closes on a modal, or explicit pick/dismiss.
      if (this.menuOpen || this.craftOpen || this.dialogOpen || this.inventoryOpen || this.confirmOpen) this.closeToolPalette();
      else { if (!this.wheelClose) this.updateToolPaletteHover(); this.publishToolPalette(); } // freeze hover while the exit plays
    }
    this.publishToolHud(); // keep the current-tool indicator + its visibility in sync each frame
    this.publishBackpackBtn(); // keep the sprout button's visibility in sync
    this.updateHotbarHover(); // highlight the hotbar cell under the mouse cursor
    // While the build palette is open, tell it which cell the cursor is over (hover).
    this.updatePaletteHover();

    // Movement: WASD / arrows either DRIVE Cato (player control) or pan the camera
    // (AI-companion mode). Player mode keeps the camera following Cato.
    if (this.playerControl) this.updatePlayerMovement();
    else this.updateCameraKeys(delta);

    if (!this.child?.body) return;

    // The unified menu (mailbox / chest / for-sale / settings) is open → PAUSE Cato:
    // freeze him in place (idle) so he doesn't wander/work behind the modal. His
    // catoTask (if any) is PRESERVED — untouched here — so he picks it right back up
    // when the menu closes. Stamina is gated in updateStamina (no drain while paused).
    if (this.menuOpen || this.craftOpen) {
      (this.child.body as Phaser.Physics.Arcade.Body).setVelocity(0, 0);
      this.child.play(`idle-${this.faceDir}`, true);
      return;
    }

    // A commanded behaviour (e.g. Cato tilling a plot via chat) takes over.
    if (this.catoTask) {
      this.updateCatoTask(delta);
      return;
    }

    if (this.playerControl) return; // the player drives Cato → no autonomous wander
    if (!CHILD_WANDER) return; // pinned — skip wander (edge-scroll already ran)
    const body = this.child.body as Phaser.Physics.Arcade.Body;

    // Cato stops to talk — freeze the stroll while the chat dialog is open.
    if (this.dialogOpen) {
      if (this.wanderState !== 'idle') this.startWanderIdle();
      this.wanderStuckMs = 0; this.wanderPrev = null;
      return;
    }

    // EXHAUSTED → rest in place until recovered (no wander, no chores, no leash chase);
    // a drowsy emote now and then while the stamina gauge slowly refills.
    if (this.exhausted) {
      body.setVelocity(0, 0);
      if (this.wanderState !== 'idle') this.startWanderIdle();
      this.child.play(`idle-${this.faceDir}`, true);
      this.wanderStuckMs = 0; this.wanderPrev = null;
      // Keep eating food from his bag (on a cooldown) to recover faster; else drowse.
      if (this.time.now >= this.catoEatAt && this.catoEatFood()) this.catoEatAt = this.time.now + 1500;
      else if (this.time.now >= this.staminaSleepyAt) { this.staminaSleepyAt = this.time.now + 3200; this.catoReact('sleepy', { duration: 2600 }); }
      return;
    }

    // STUCK-ESCAPE: `walkCardinalToward` has no path-finding, so between two tree
    // trunks (or against a wall) Cato can push into the obstacle forever. If he makes
    // no progress while walking, SIDESTEP perpendicular for a beat so he clears the
    // pinch and can go around, then resume normal wander.
    if (this.time.now < this.wanderEscapeUntil) { this.moveDir(this.wanderEscapeDir, CHILD_SPEED); return; }
    const prev = this.wanderPrev;
    this.wanderPrev = { x: this.child.x, y: this.child.y };
    if (this.wanderState === 'walk' && prev) {
      const moved = Math.hypot(this.child.x - prev.x, this.child.y - prev.y);
      this.wanderStuckMs = moved < 0.4 ? this.wanderStuckMs + delta : 0;
      if (this.wanderStuckMs > 1100) {
        this.wanderStuckMs = 0;
        this.catoCurious = null; this.wanderTarget = null; this.catoReturning = false;
        const horiz = this.faceDir === 'left' || this.faceDir === 'right';
        this.wanderEscapeDir = horiz ? (body.blocked.up ? 'down' : 'up') : (body.blocked.left ? 'right' : 'left');
        this.wanderEscapeUntil = this.time.now + 650;
        this.moveDir(this.wanderEscapeDir, CHILD_SPEED);
        return;
      }
    }

    // Curiosity: the player harvested something → Cato heads over to look, OVERRIDING
    // the leash/wander. On arrival (or a bump / deadline) he faces it + lingers longer.
    if (this.catoCurious) {
      const { x: tx, y: ty } = this.catoCurious;
      const d = Math.hypot(tx - this.child.x, ty - this.child.y);
      const bumped = body.blocked.left || body.blocked.right || body.blocked.up || body.blocked.down;
      if (d <= WANDER_ARRIVE || bumped || this.time.now > this.catoCurious.deadline) {
        this.faceTargetPoint(tx, ty);
        this.catoCurious = null;
        this.startWanderIdle();
        this.wanderTimer = -1800; // linger ~1.8s extra having a look before ambling off
        return;
      }
      this.walkCardinalToward(tx, ty, CHILD_SPEED);
      this.wanderState = 'walk';
      return;
    }

    // Leash: Cato stays near the CAMERA CENTRE (in view). If he strays past the
    // (view-sized) radius he heads back until within half of it, THEN rests. This
    // also brings him home after a task (he ends wherever the plot was).
    const cam = this.cameras.main;
    const ccx = cam.worldView.centerX;
    const ccy = cam.worldView.centerY;
    const leashR = this.wanderLeashRadius();
    const dist = Math.hypot(ccx - this.child.x, ccy - this.child.y);
    if (dist > leashR || (this.catoReturning && dist > leashR * 0.5)) {
      this.catoReturning = true;
      this.walkCardinalToward(ccx, ccy, CHILD_SPEED); // cardinal only (no diagonal anim)
      this.wanderState = 'walk';
      this.wanderTarget = null;
      this.wanderTimer = 0;
      return;
    }
    if (this.catoReturning) { this.catoReturning = false; this.startWanderIdle(); return; }

    // Ambling to a point of interest → head there, then rest FACING it ("stops in
    // front of a crop and has a look"). A boundary bump also just ends the trip.
    if (this.wanderState === 'walk' && this.wanderTarget) {
      const tx = this.wanderTarget.x;
      const ty = this.wanderTarget.y;
      const d = Math.hypot(tx - this.child.x, ty - this.child.y);
      const blocked = body.blocked.left || body.blocked.right || body.blocked.up || body.blocked.down;
      if (d <= WANDER_ARRIVE || blocked) {
        this.faceTargetPoint(tx, ty);
        this.startWanderIdle();
        return;
      }
      this.walkCardinalToward(tx, ty, CHILD_SPEED);
      return;
    }

    // Resting: linger, then — if there's farm work + it's enabled — go DO a chore on
    // his own; otherwise amble off to inspect a nearby thing.
    this.wanderTimer += delta;
    if (this.wanderTimer >= this.wanderInterval) {
      if (this.tryAutoChore()) this.wanderTimer = 0; // catoTask now drives him (next frame)
      else {
        // No more chores → the work session (if any) just ended: say "all done" ONCE.
        if (this.choreSession) { this.catoSay(this.choreSession === 'water' ? 'chatter_water_done' : 'chatter_harvest_done'); this.choreSession = null; }
        this.beginNextWanderMove();
      }
    }
  }
}
