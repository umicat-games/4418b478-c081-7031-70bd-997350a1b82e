import Phaser from 'phaser';
import { preloadManifest, getManifest } from '@umicat/phaser-sdk';
import { startTransition } from '../transition';
import { applyCropData } from '../data/crops';
import { applyForagableData, applyBigStoneData } from '../data/foragables';
import { applyItemData } from '../data/items';
import { applyRecipeData } from '../data/recipes';

/**
 * BootScene — loads the scene-as-data manifest, then hands off to
 * GameScene with the manifest's initialScene.
 *
 * Per-scene assets are loaded lazily inside `loadWorldScene` (called
 * from GameScene), so this BootScene only loads the manifest itself.
 *
 * If the agent generates or imports image/audio assets, they are
 * declared in `scenes/manifest.json`'s `assets[]` table — NOT here.
 * The scene loader queues them via `this.load.*` on demand based on
 * which assetIds the active scene's entities reference.
 */
/** Keep the cozy loading screen up at least this long before wiping into the first scene,
 *  so a fast / cached boot doesn't just blink past. */
const MIN_LOADER_MS = 1300;

export class BootScene extends Phaser.Scene {
  constructor() {
    super({ key: 'BootScene' });
  }

  preload(): void {
    // The boot LOADING screen is a pure CSS overlay (#boot in index.html) — it paints on
    // the first frame with NO dependency on any asset (font/icon), so there's no flash of
    // cream-then-icons while the bundle + assets load. This scene just loads; `#boot` is
    // removed when we wipe into the first scene (see create()).
    preloadManifest(this);
    // The icon sheet (16×16 grid) — used by the confirm dialog / build palette / HUD and
    // the in-game loading overlay (NOT the boot loader anymore, but still preloaded early).
    this.load.spritesheet('ui-icons', 'uploaded/all_icons.png', { frameWidth: 16, frameHeight: 16 });
    // Custom pointer-lock cursor — key must match CURSOR_KEY in GameScene.
    this.load.image('cursor', 'uploaded/triangle_mouse_icon_1.png');
    // Radial tool-wheel circle backgrounds (24×24) — one per tool button in the
    // contextual wheel that pops around a tapped object/tile.
    this.load.image('tool-circle-bg', 'uploaded/tool-circle-bg-16-16.png');
    this.load.image('tool-circle-bg-selected', 'uploaded/tool-circle-bg-selected-16-16.png');
    this.load.image('tool-circle-bg-2', 'uploaded/tool-circle-bg-2-16-16.png'); // the wheel slot background (creator's warm circle)
    // Tile-selection bracket cursor (24×24, frames a 16px cell) — the "you can
    // till here" highlight that snaps to the hovered grass tile when the hoe is
    // the active tool.
    this.load.image('tile-select', 'uploaded/tile_select_cursor.png');
    // Rounded-square UI button sheet (96×192, 8 buttons) — region-tagged
    // `white-button` in the Asset Manager (26×28 @ 11,11, nine-patch L6/R6/T7/B7).
    // Used as the pixel background frame behind the build-palette orientation cells
    // (registered as a frame in create() so a nine-slice can reference it).
    this.load.image('square-buttons', 'uploaded/square_buttons_26x26.png');
    this.load.image('house-kitchen-preview', 'uploaded/house-kitchen-preview.png'); // shop 房子 tab house preview
    // (ui-icons — the 16×16 grid used by the confirm dialog / build palette / HUD — is
    //  loaded FIRST, above, so the cozy loading screen can use it.)
    // Title-screen SETTINGS menu: the rounded panel (SETTINGS baked in) + the volume
    // slider pieces (a green "filled" tick, a brown "empty" tick, and the <> drag knob).
    this.load.atlas('settings-menu', 'uploaded/setting_menu.png', 'uploaded/setting_menu.json');
    this.load.atlas('settings-buttons', 'uploaded/ui_settings_buttons.png', 'uploaded/ui_settings_buttons.json');
    // Cato's emote system: the grey speech bubble + the 32×32 emoji face sheet
    // (frame = row*10 + col; regions tagged in the Asset Manager). See src/emote.ts.
    this.load.image('speech-bubble', 'uploaded/speech-bubble.png');
    this.load.spritesheet('emoji', 'uploaded/emoji_spritesheet.png', { frameWidth: 32, frameHeight: 32 });
    // The title-screen Cato mascot (Teemo premium emote pack — 32×32, 13-col grid). The
    // boot menu plays `teemo-appear` once, then loops random blink/love/think. See below.
    this.load.spritesheet('teemo', 'uploaded/teemo_premium_emote_animations_sprite_sheet-export.png', { frameWidth: 32, frameHeight: 32 });
    // Looping background music — a SEPARATE track for the title vs the game. MP3 for
    // universal browser support. `bgm-title` plays on the boot screen (BootMenuScene).
    // The in-game `bgm` (4.1MB — over HALF the boot payload) is DEFERRED to `GameScene`'s
    // own preload, so the title screen appears fast and we don't pay for it until the
    // player actually enters the game. crossToBgm swaps them on the title→game switch,
    // and is safe if `bgm` isn't loaded yet (it early-returns; the stop-key no-ops).
    this.load.audio('bgm-title', 'uploaded/catopia-title-screen-background-music.mp3');
    // UI SFX (see src/sfx.ts): `sfx-switch` = button/open click; `sfx-scroll` = the
    // scrub tick when dragging a settings volume slider.
    this.load.audio('sfx-switch', 'uploaded/switch_006.ogg');
    this.load.audio('sfx-scroll', 'uploaded/scroll_short.mp3');
    this.load.audio('sfx-hoe', 'uploaded/shovle.mp3'); // dig thunk on the player's hoe strike
    this.load.audio('sfx-chop', 'uploaded/chop-wood-new.mp3'); // short axe thunk on each tree strike
    this.load.audio('sfx-hover', 'uploaded/click_003.ogg'); // soft blip when the mouse highlights an item cell
    this.load.audio('sfx-confirm', 'uploaded/confirmation_001.ogg'); // laptop "new message" chime
    this.load.audio('sfx-drop', 'uploaded/drop_002.ogg'); // laptop: player sends a message
    this.load.audio('sfx-collect', 'uploaded/drop_004.ogg'); // a harvested item lands in the collector (Cato / cursor)
    this.load.audio('sfx-nibble', 'uploaded/phaserup2.ogg'); // a fish tests/nibbles the fishing float
    this.load.audio('sfx-splash', 'uploaded/fish-splash-water.mp3'); // reeling the hooked fish in (water splash)
    this.load.audio('sfx-swing', 'uploaded/swing-fishing-rod.mp3'); // casting the fishing rod (the swing)
    this.load.audio('sfx-getitem', 'uploaded/get-item-sound.mp3'); // the "new item!" catch-reveal jingle
    this.load.audio('sfx-type', 'uploaded/click_002.ogg'); // laptop: per-character typewriter tick
    // Cato's stamina gauge: a 16×16 radial pie (37 frames, empty→full; colour purple→
    // orange→green). frame = round(fraction*36). Shown over his head while he works.
    this.load.spritesheet('stamina', 'uploaded/stamina_circle_with_white_outline_sprite_sheet.png', { frameWidth: 16, frameHeight: 16 });
    // Cato's proactive small-talk box (top-right, left of his portrait) — a 128×48
    // 9-slice speech box (insets L20/R20/T12/B12). Used via add.nineslice in ChatterScene.
    this.load.image('chatter-box', 'uploaded/dialog_box_medium.png');
    // Tools spritesheet (16×16) — the hoe swing (`hoe-swing` anim, frames
    // 29→28→27, registered from the manifest) + the hotbar icons. Not a scene
    // entity, so it's loaded here rather than on-demand by the scene loader.
    this.load.spritesheet('tools', 'uploaded/tools.png', {
      frameWidth: 16,
      frameHeight: 16,
    });
    // Tilled-soil AUTOTILE sheet (16 frames, 16×16 — a 4-bit cardinal blob
    // composed from Sprout Lands Tilled_Dirt). Frame index = neighbour bitmask
    // N=1/E=2/S=4/W=8, so hoed cells connect into smooth plots (rounded edges,
    // seamless interior). Set per cell in GameScene.refreshSoil.
    this.load.spritesheet('tilled-soil', 'uploaded/tilled_autotile.png', {
      frameWidth: 16,
      frameHeight: 16,
    });
    // Grass-edge dirt tileset (Sprout Lands Tilled_Dirt_v2), imported via the Asset
    // Manager. We don't paint it directly — at boot we CUT its green grass tufts into
    // the `soil-grass` overlay sheet (see create/buildSoilGrassSheet), which the farm
    // lays over tilled-soil borders. Kept as the source so the whole flow is
    // reproducible in-platform (upload → load → process in game code), not an offline
    // script.
    this.load.spritesheet('tilled-dirt', 'uploaded/tilled_dirt_wide_v2.png', {
      frameWidth: 16,
      frameHeight: 16,
    });
    // Tool ITEM icons atlas (Sprout Lands "tools and meterials", region-tagged in
    // the Asset Manager's Region Editor — `hoe` / `axe` / `watering-can`). The
    // held-tool icon in the bracket cursor uses the `hoe` region.
    this.load.atlas(
      'tools_and_meterials',
      'uploaded/tools_and_meterials.png',
      'uploaded/tools_and_meterials.json',
    );
    // Inventory / hotbar UI atlas (region-tagged in the Asset Manager) — the
    // `frame-medium` outer panel + `slot-light` item cells the bottom hotbar
    // (HotbarScene) is built from. 9-slice insets live in the region JSON.
    this.load.atlas(
      'inventory',
      'uploaded/inventory_spritesheet.png',
      'uploaded/inventory_spritesheet.json',
    );
    // Farming: crop GROWTH stages (grid-sliced; corn is 16×32, others 16×16) and
    // the seed-bag / harvested-crop ITEM icons (region-tagged in the Asset
    // Manager). Frame keys: growth `grow-<crop>-<stage>`; items `<crop>-seed-bag`
    // / `crop-<crop>` / `empty-seed-bag`.
    this.load.atlas(
      'farming_plants',
      'uploaded/farming_plants.png',
      'uploaded/farming_plants.json',
    );
    this.load.atlas(
      'farming_plants_items',
      'uploaded/farming_plants_items.png',
      'uploaded/farming_plants_items.json',
    );
    // Watering splash effect (Sprout Lands "water from wateringcan frames") — a
    // 9×3 grid of 48×48 frames (NOT 32×32). One row = one splash cycle; played on
    // a tile when it's watered.
    this.load.spritesheet('watering-splash', 'uploaded/watering_splash.png', {
      frameWidth: 48,
      frameHeight: 48,
    });

    // ── House-building tilesets (Sprout Lands premium "Building parts", via the
    //    Asset Manager). The player places these from the backpack (see GameScene
    //    building system). All 16px cells except the door (16×32).
    // Walls: 5×3 grid. The cols 0-2 block is a 3×3 wall autotile (corners+edges+
    // window centre); extra wide pieces in cols 3-4. Frame = row*5 + col.
    this.load.spritesheet('house-walls', 'uploaded/wooden_house_walls_tilset.png', {
      frameWidth: 16,
      frameHeight: 16,
    });
    // Furniture: 9×6 grid of 16×16 pieces (paintings, plants, lamps, chairs,
    // tables, clocks, rugs; beds span 2 tall). Frame = row*9 + col.
    this.load.spritesheet('furniture', 'uploaded/basic_furniture.png', {
      frameWidth: 16,
      frameHeight: 16,
    });
    // Door: 16×16 frames (288×32 = 18 cols × 2 rows). The DOOR + its swing anim is
    // the TOP row (frames 0-5: 0=open … 5=closed); the bottom row is separate wall
    // blocks (NOT part of the door — slicing it as 16×32 stacked a block below it).
    this.load.spritesheet('door', 'uploaded/door_animation_sprites.png', {
      frameWidth: 16,
      frameHeight: 16,
    });

    // The desk PAD (iPad) — a 5-frame 16×16 sheet. Frame 0 = resting (screen on,
    // matches the static ipad_qkzld placed in the scene); 0→4 = the screen wiping to
    // the shop. Clicking the pad plays `pad-open` then opens the Shop menu.
    this.load.spritesheet('pad', 'uploaded/ipad-animation.png', {
      frameWidth: 16,
      frameHeight: 16,
    });

    // ── Trees (48×48 frames). Placed from the backpack; chopped with the AXE. Each
    //    sheet: row0 = idle, then shake animations of 4 / 6 / 12 frames (= shake-1/2/3;
    //    frame = row*12 + col). Fruit sheets (12×5) drop their fruit during shake-3
    //    and settle to a bare frame (row4); the plain sheet is 12×4. When a bare tree
    //    is felled, the separate 17-frame fall sheet plays.
    for (const t of ['plain', 'apple', 'pear', 'peach'] as const) {
      const file = t === 'plain' ? 'tree_sprites' : `tree_${t}_sprites`;
      this.load.spritesheet(`tree-${t}`, `uploaded/${file}.png`, { frameWidth: 48, frameHeight: 48 });
    }
    // Fall sheet is 64 WIDE (not 48 like the standing trees) — 13 frames × 64. The
    // tree tips LEFT; its trunk sits at x≈40 in the 64px frame, so the placer must
    // re-anchor the origin when it swaps to this texture (see fellTree).
    this.load.spritesheet('tree-fall', 'uploaded/tree_fall_animation_sprite_sheet.png', { frameWidth: 64, frameHeight: 48 });
    // Harvested-fruit item icons (4×2 grid of 16×16): apple=0, orange=1, pear=2,
    // peach=3 (row 2 = berries/grapes). Used for the drop pop + the backpack item.
    this.load.spritesheet('fruit-items', 'uploaded/fruit_and_berries_items.png', { frameWidth: 16, frameHeight: 16 });
    // Berry BUSHES (Sprout Lands "Trees, stumps and bushes") — region-tagged (not a
    // uniform grid), so loaded as an image + the named frames registered in create():
    // grow stages `empty-bush-small`/`empty-bush` + one berry overlay per type
    // (`<berry>-in-bush`, dropped 3× on a ripe bush).
    this.load.image('bushes', 'uploaded/trees_stumps_and_bushes.png');
    // Wild foragables + big-stones sheet (atlas-json: `<type>-<stage>`, `big-stone-<tier>`).
    this.load.atlas('forage', 'uploaded/mushrooms_flowers_stones.png', 'uploaded/mushrooms_flowers_stones.json');
    // Pickaxe tool icon (knocks big-stones).
    this.load.image('pickaxe', 'uploaded/pickaxe.png');
    // Decorative fish (16×16, 15-frame top-down swim/turn) — swim in circles in the water.
    this.load.spritesheet('fish', 'uploaded/fish-spritesheet.png', { frameWidth: 16, frameHeight: 16 });
    // Fishing: rod segment + float bobber (16×16 each) + the 2-frame fish-bite (nibble) sheet.
    this.load.image('fishing-rod', 'uploaded/fishing-rod.png');
    this.load.image('fishing-float', 'uploaded/fishing-rode-float.png');
    this.load.image('sea-bream', 'uploaded/sea-bream.png'); // the caught fish (32×32) shown on the catch
    this.load.spritesheet('fish-bite', 'uploaded/fish-bite-spritesheet.png', { frameWidth: 16, frameHeight: 16 });
    // "New item!" starburst bg for a catch reveal (16×16 frames): appear (3), hold/pulse (11), disappear (3).
    this.load.spritesheet('newitem-appear', 'uploaded/new-item-appear.png', { frameWidth: 16, frameHeight: 16 });
    this.load.spritesheet('newitem-bg', 'uploaded/new-item-bg-sprite-sheet.png', { frameWidth: 16, frameHeight: 16 });
    this.load.spritesheet('newitem-disappear', 'uploaded/new-item-bg-disappear.png', { frameWidth: 16, frameHeight: 16 });
    // Cato's own fishing body anims (48×48, 8 cols × 4 rows = right/left/up/down): cast (throw out)
    // + swing-back (reel in). Same frame size as his character sheet so his foot-origin carries over.
    this.load.spritesheet('cato-fish-cast', 'uploaded/cato-fishing-all-directions.png', { frameWidth: 48, frameHeight: 48 });
    this.load.spritesheet('cato-fish-reel', 'uploaded/cato-fishing-swing-back-fishing-rod.png', { frameWidth: 48, frameHeight: 48 });
    // Tool-WHEEL icons: bordered 16×16 art (item-*-with-border), one per wheel tool. Used only
    // in the contextual wheel (not the held-tool bracket / HUD indicator). fishing-rod is loaded
    // for the reserved 6-o'clock slot (no fishing mechanic yet).
    this.load.image('wheel-hoe', 'uploaded/item-hoe-with-border.png');
    this.load.image('wheel-water-can', 'uploaded/item-water-can-with-border.png');
    this.load.image('wheel-axe', 'uploaded/item-axe-with-border.png');
    this.load.image('wheel-pickaxe', 'uploaded/item-pixaxe-with-border.png');
    this.load.image('wheel-fishing-rod', 'uploaded/item-fishing-rod-with-border.png');
    // Top-left weather / time / money HUD (atlas frames: `weather-frame-big`,
    // `balance-frame-big`, `time-bg`, `arrow-big-1..5`; icons `sunny`/…; `coin-…`).
    this.load.atlas('weather-ui', 'uploaded/weather_ui.png', 'uploaded/weather_ui.json');
    this.load.atlas('weather-icons', 'uploaded/weather_icons_big.png', 'uploaded/weather_icons_big.json');
    this.load.atlas('coins', 'uploaded/coins.png', 'uploaded/coins.json');
    // Mailbox UI — click the placed mailbox to open this big-mailbox modal.
    // `mail-box` = the big open mailbox frame; `mail-box-item-bg` = a mail-slot bg,
    // `envelope-zipper` = a piece of mail (both used when mail items are wired in).
    this.load.image('mail-box', 'uploaded/mail-box.png');
    this.load.image('mailbox-v2', 'uploaded/mailbox-v2.png'); // v2 mailbox frame (with tabs)
    this.load.image('blue-laptop', 'uploaded/blue-laptop.png'); // cold-open "message from Cato" laptop
    this.load.image('mail-box-item-bg', 'uploaded/mail-box-item-bg.png');
    this.load.image('envelope-zipper', 'uploaded/envelope-zipper.png');
    // Mailbox tab buttons (selected = taller, unselected = shorter). Green = Mail tab,
    // Blue = Items tab.
    this.load.image('tab-green', 'uploaded/tab-green.png');
    this.load.image('tab-green-unselected', 'uploaded/tab-green-unselected.png');
    this.load.image('tab-blue', 'uploaded/tab-blue.png');
    this.load.image('tab-blue-unselected', 'uploaded/tab-blue-unselected.png');
    // Chest UI — click the placed chest to open this big-chest modal (mirror of the
    // mailbox). `chest-full` = the big open chest frame; `chest-full-zipper` = the
    // scroll thumb. (Item slot bg + close button reuse the mailbox's.)
    this.load.image('chest-full', 'uploaded/chest-full-size.png');
    this.load.image('chest-full-zipper', 'uploaded/chest-full-scroll-zipper.png');
    // Order book UI — the order button (bottom-right) opens this two-page book: a
    // catalog of orderable seeds/seedlings on the left, an order summary on the right.
    this.load.image('order-book', 'uploaded/order-book.png');
    // Backpack (bag) UI — the hotbar's backpack button opens this bag ABOVE the hotbar
    // (so items can be dragged/placed onto the hotbar). `bag` = the backpack graphic;
    // `bag-item-bg` = a slot; `bag-zipper` = the scroll thumb.
    this.load.image('bag', 'uploaded/bag.png');
    this.load.image('bag-item-bg', 'uploaded/bag-item-bg.png');
    this.load.image('bag-zipper', 'uploaded/bag-zipper.png');
    // Shared UI sheet (region-tagged) — the order book's catalog SCROLL BAR
    // (`vertical-scroll-bar-background` track + `vertical-scroll-bar-dark` thumb).
    this.load.atlas('ui-sheet', 'uploaded/all_ui_assets_on_one_sheet.png', 'uploaded/all_ui_assets_on_one_sheet.json');
    // Icon buttons atlas (region-tagged) — the mailbox + chest modals' close button
    // (`close-light-big`).
    this.load.atlas('icon-buttons', 'uploaded/icon_buttons_spritesheet.png', 'uploaded/icon_buttons_spritesheet.json');
    // Game DATA tables (config as data, not code) — crops: which crops exist + their
    // stats/grow-times. Applied in create(). See src/data/crops.ts.
    this.load.json('data-crops', 'data/crops.json');
    // Foragables + big-stones data tables (see src/data/foragables.ts).
    this.load.json('data-foragables', 'data/foragables.json');
    this.load.json('data-big-stones', 'data/big-stones.json');
    // Item property table (buy/sell/food). Applied in create(). See src/data/items.ts.
    this.load.json('data-items', 'data/items.json');
    this.load.json('data-recipes', 'data/recipes.json');
    // Scripted-dialogue graphs (authored, non-AI): the new-game intro cutscene.
    this.load.json('dialogue-intro', 'dialogue/intro.json');
  }

  create(): void {
    // Register the water-splash animation (row 0 = frames 0-8) once, globally.
    if (!this.anims.exists('water-splash')) {
      this.anims.create({
        key: 'water-splash',
        frames: this.anims.generateFrameNumbers('watering-splash', { start: 0, end: 8 }),
        frameRate: 14,
        repeat: 0,
      });
    }
    // Decorative fish swim-turn (13 frames 0-12, loops) — played IN PLACE; the turn is baked
    // into the sheet, so a stationary fish reads as swimming/turning in a little circle.
    if (!this.anims.exists('fish-swimming')) {
      this.anims.create({ key: 'fish-swimming', frames: this.anims.generateFrameNumbers('fish', { start: 0, end: 12 }), frameRate: 8, repeat: -1 });
    }
    // Fish nibbling the float (2 frames, loops).
    if (!this.anims.exists('fish-bite')) {
      this.anims.create({ key: 'fish-bite', frames: this.anims.generateFrameNumbers('fish-bite', { start: 0, end: 1 }), frameRate: 6, repeat: -1 });
    }
    // "New item!" catch-reveal burst: appear + disappear play FAST, the middle hold plays SLOW.
    if (!this.anims.exists('newitem-appear')) {
      this.anims.create({ key: 'newitem-appear', frames: this.anims.generateFrameNumbers('newitem-appear', { start: 0, end: 2 }), frameRate: 20, repeat: 0 });
      this.anims.create({ key: 'newitem-hold', frames: this.anims.generateFrameNumbers('newitem-bg', { start: 0, end: 10 }), frameRate: 8, repeat: 0 });
      this.anims.create({ key: 'newitem-disappear', frames: this.anims.generateFrameNumbers('newitem-disappear', { start: 0, end: 2 }), frameRate: 20, repeat: 0 });
    }
    // Cato casting / reeling the rod — rows: right(0) / left(1) / up(2, back view) / down(3, front),
    // 8 frames each, played ONCE (holds the last frame = the fishing pose / rod-back pose).
    if (!this.anims.exists('cato-fish-cast-right')) {
      ['right', 'left', 'up', 'down'].forEach((d, row) => {
        this.anims.create({ key: `cato-fish-cast-${d}`, frames: this.anims.generateFrameNumbers('cato-fish-cast', { start: row * 8, end: row * 8 + 7 }), frameRate: 14, repeat: 0 });
        this.anims.create({ key: `cato-fish-reel-${d}`, frames: this.anims.generateFrameNumbers('cato-fish-reel', { start: row * 8, end: row * 8 + 7 }), frameRate: 16, repeat: 0 });
      });
    }
    // God-hand watering-can pour (tools.png row 0-1: can upright→tilt→pour). The
    // player's watering analogue of the hoe swing (`hoe-swing`).
    if (!this.anims.exists('water-pour')) {
      this.anims.create({
        key: 'water-pour',
        frames: this.anims.generateFrameNumbers('tools', { frames: [0, 0, 1, 1, 1, 0] }),
        frameRate: 8,
        repeat: 0,
      });
    }
    // God-hand HOE swing (till / harvest) + AXE swing (chop) — raise → hold → strike,
    // one-shot (strike fires on ANIMATION_COMPLETE). REGISTERED IN CODE, not the
    // manifest: the editor's region-tagging regenerates the `tools` asset animations
    // as `hoe-swing-right` / `axe-swing-left` (loop:true) on every Build, clobbering
    // the custom one-shot keys the game plays — so define them here where a Build
    // can't touch them (the "锄头动画没有了" regression). Frames per tools.png: hoe
    // = 27–29, axe = 12–14.
    if (!this.anims.exists('hoe-swing')) {
      this.anims.create({
        key: 'hoe-swing',
        frames: this.anims.generateFrameNumbers('tools', { frames: [28, 29, 29, 29, 28, 27] }),
        frameRate: 8,
        repeat: 0,
      });
    }
    if (!this.anims.exists('axe-swing')) {
      this.anims.create({
        key: 'axe-swing',
        frames: this.anims.generateFrameNumbers('tools', { frames: [13, 14, 14, 14, 13, 12] }),
        frameRate: 8,
        repeat: 0,
      });
    }
    // Door open/close swing (16×32 door sheet). The `door-open` sequence runs the
    // closed→open frames; `door-close` is the reverse. Frame list is a first pass —
    // refine after seeing it in-game (see GameScene DOOR_* constants).
    if (!this.anims.exists('door-open')) {
      this.anims.create({
        key: 'door-open',
        frames: this.anims.generateFrameNumbers('door', { frames: [5, 4, 3, 2, 1, 0] }),
        frameRate: 14,
        repeat: 0,
      });
    }
    if (!this.anims.exists('door-close')) {
      this.anims.create({
        key: 'door-close',
        frames: this.anims.generateFrameNumbers('door', { frames: [0, 1, 2, 3, 4, 5] }),
        frameRate: 14,
        repeat: 0,
      });
    }
    // Pad open/close: 0→4 turns the screen on + wipes to the shop, holding on frame 4;
    // `pad-close` reverses back to the resting frame 0.
    if (!this.anims.exists('pad-open')) {
      this.anims.create({
        key: 'pad-open',
        frames: this.anims.generateFrameNumbers('pad', { frames: [0, 1, 2, 3, 4] }),
        frameRate: 16,
        repeat: 0,
      });
    }
    if (!this.anims.exists('pad-close')) {
      this.anims.create({
        key: 'pad-close',
        frames: this.anims.generateFrameNumbers('pad', { frames: [4, 3, 2, 1, 0] }),
        frameRate: 16,
        repeat: 0,
      });
    }
    // Title-screen Cato mascot emotes (frame ranges segmented from the untagged Teemo
    // sheet). `appear` plays once on load; the rest are randomly looped by BootMenuScene.
    const teemoAnims: Array<[string, number, number, number]> = [
      ['teemo-appear', 0, 20, 16],
      ['teemo-blink', 65, 68, 8],
      ['teemo-love', 117, 121, 8],
      ['teemo-think', 195, 201, 12],
    ];
    for (const [key, from, to, fps] of teemoAnims) {
      if (this.anims.exists(key)) continue;
      const frames = [];
      for (let f = from; f <= to; f++) frames.push(f);
      this.anims.create({ key, frames: this.anims.generateFrameNumbers('teemo', { frames }), frameRate: fps, repeat: 0 });
    }
    // Register the `white-button` region of the square-buttons sheet as a frame so
    // the build palette can nine-slice it (26×28 @ 11,11, per the Asset Manager tag).
    const btnTex = this.textures.get('square-buttons');
    if (btnTex && !btnTex.has('white-button')) btnTex.add('white-button', 0, 11, 11, 26, 28);
    // `grey-button` (26×26 @ 59,11, nine-patch L6/R6/T6/B6) — the order book's item
    // icon background frame.
    if (btnTex && !btnTex.has('grey-button')) btnTex.add('grey-button', 0, 59, 11, 26, 26);
    // Hotbar item-slot backgrounds (per the Asset Manager tags): `light-brown-button`
    // (26×28 @ 11,59) = a resting cell, `white-button-pressed-down` (26×26 @ 59,11) = a
    // selected cell (a clearer highlight than the brown pressed variant). Hover reuses
    // `white-button`.
    if (btnTex && !btnTex.has('light-brown-button')) btnTex.add('light-brown-button', 0, 11, 59, 26, 28);
    if (btnTex && !btnTex.has('white-button-pressed-down')) btnTex.add('white-button-pressed-down', 0, 59, 11, 26, 26);
    // `light-brown-button-pressed-down` (26×26 @ 59,59) = the pressed/flat variant of the
    // light-brown cell (row-2 col-2 of the 2×4 sheet) — the harvest-toast pill background.
    if (btnTex && !btnTex.has('light-brown-button-pressed-down')) btnTex.add('light-brown-button-pressed-down', 0, 59, 59, 26, 26);
    // Dark-brown button (26×26 @ 59,155) — the LaptopScene dialogue/input box bg (white
    // text reads clearly on it, unlike the pale square-button-26_26-* frames).
    if (btnTex && !btnTex.has('dialog-brown')) btnTex.add('dialog-brown', 0, 59, 155, 26, 26);
    // Menu close-button pressed frame (icon-buttons sheet, 32×32 @ 32,320, per the Asset
    // Manager tag) — shown as a brief click flash on the X.
    const iconTex = this.textures.get('icon-buttons');
    if (iconTex && !iconTex.has('close-light-big-pressed-down')) iconTex.add('close-light-big-pressed-down', 0, 32, 320, 32, 32);
    // Tree chop animations: each type has 3 shake sequences (rows 1/2/3 = 4/6/12
    // frames) played on successive axe strikes; fruit sheets drop fruit during shake3.
    // The bare-tree fall is a separate 17-frame sheet. Registered once, globally.
    for (const t of ['plain', 'apple', 'pear', 'peach']) {
      const mk = (n: number, s: number, e: number) => {
        const key = `tree-${t}-shake${n}`;
        if (!this.anims.exists(key)) {
          this.anims.create({ key, frames: this.anims.generateFrameNumbers(`tree-${t}`, { start: s, end: e }), frameRate: 16, repeat: 0 });
        }
      };
      mk(1, 12, 15);
      mk(2, 24, 29);
      mk(3, 36, 47);
    }
    if (!this.anims.exists('tree-fall')) {
      this.anims.create({ key: 'tree-fall', frames: this.anims.generateFrameNumbers('tree-fall', { start: 0, end: 12 }), frameRate: 16, repeat: 0 });
    }
    // Register the region-tagged bush frames (16×16) on the `bushes` texture.
    const bt = this.textures.get('bushes');
    if (bt) {
      const BUSH_FRAMES: Array<[string, number, number]> = [
        ['empty-bush-small', 0, 48], ['empty-bush', 16, 48],
        ['strawberry-in-bush', 0, 64], ['grape-in-bush', 32, 64], ['blueberry-in-bush', 64, 64],
        // Full berry-bush sprites — used as the backpack planting-item icon (distinct
        // from the single harvested berry from fruit-items).
        ['bush-with-strawberry', 32, 48], ['bush-with-grape', 48, 48], ['bush-with-blueberry', 64, 48],
      ];
      for (const [n, x, y] of BUSH_FRAMES) if (!bt.has(n)) bt.add(n, 0, x, y, 16, 16);
    }
    // Apply the loaded crop data table (falls back to the built-in if absent).
    applyCropData(this.cache.json.get('data-crops'));
    applyForagableData(this.cache.json.get('data-foragables'));
    applyItemData(this.cache.json.get('data-items'));
    applyRecipeData(this.cache.json.get('data-recipes'));
    applyBigStoneData(this.cache.json.get('data-big-stones'));
    buildSoilGrassSheet(this);
    // BGM is started per-scene now (title vs game use different tracks): BootMenuScene
    // plays `bgm-title`, GameScene plays `bgm` — each via crossToBgm.

    // The scene-switch transition overlay (circle/slide/dissolve) — launch it once,
    // globally, so it's above everything and survives scene switches (incl. return-to-title,
    // which re-enters BootScene → guard against a double launch).
    if (!this.scene.isActive('TransitionScene')) this.scene.launch('TransitionScene');

    const manifest = getManifest(this);
    // Route by initial scene: the `boot` data scene → BootMenuScene (renders the
    // boot screen + wires Play → game); any other scene (incl. a Play-Scene
    // `?umicatScene=` override, which skips the boot screen) → GameScene.
    const sid = manifest.initialScene;
    const next = sid === 'boot' ? 'BootMenuScene' : 'GameScene';
    // Keep the CSS loader up a MINIMUM beat from page-load (so a fast/cached boot doesn't
    // blink), THEN remove it + PAW-wipe into the first scene. performance.now() here ≈ time
    // since navigation, and #boot has been showing that whole time.
    const wait = Math.max(0, MIN_LOADER_MS - performance.now());
    this.time.delayedCall(wait, () => {
      document.getElementById('boot')?.remove(); // hand off from the CSS loader to the paw wipe
      // Cream paw curtain (the DEF_COLOR default) — CONTRASTS the green scenes so the paw reads.
      // When going straight to the GAME, HOLD the closed paw (showing "Loading") until the world
      // is ready, so the game only reveals once it's loaded (no reveal-time overlay flash).
      startTransition(this, next, { sceneId: sid }, { effect: 'paw', ms: 800, loading: next === 'GameScene' });
    });
  }
}

/**
 * Build the `soil-grass` overlay sheet AT RUNTIME from the imported Tilled_Dirt_v2
 * tileset: copy its 7 grass-edge tiles onto a canvas texture, then chroma-key so
 * ONLY the green grass survives (dirt + background → transparent). This is the
 * in-game equivalent of the offline cut we prototyped — the tileset lives in the
 * Asset Manager and the game processes it itself, so a real user's path works.
 *
 * Frames (16×16): [top×3, bottom×2, side×2] — order MUST match GameScene's
 * `SOIL_EDGES` frame indices. Source-tile coords are in the 176×112 sheet.
 */
function buildSoilGrassSheet(scene: Phaser.Scene): void {
  const KEY = 'soil-grass';
  if (scene.textures.exists(KEY)) return;
  const src = scene.textures.get('tilled-dirt').getSourceImage() as CanvasImageSource;
  // [x, y] top-left of each grass tile in Tilled_Dirt_Wide_v2 (see CLAUDE.md farming).
  const TILES: ReadonlyArray<[number, number]> = [
    [80, 80], [96, 80], [112, 80], // 0,1,2 grass on TOP edge     (cols 5,6,7 row 5)
    [80, 96], [96, 96],            // 3,4   grass on BOTTOM edge   (cols 5,6 row 6)
    [128, 80], [128, 96],          // 5,6   grass on a SIDE edge   (col 8 rows 5,6) — flipped for the other side
  ];
  const T = 16;
  const W = TILES.length * T;
  const tex = scene.textures.createCanvas(KEY, W, T);
  if (!tex) return;
  const ctx = tex.getContext();
  TILES.forEach(([sx, sy], i) => ctx.drawImage(src, sx, sy, T, T, i * T, 0, T, T));
  // Chroma-key: keep only grass-green pixels (dirt is tan → r>g; bg is transparent).
  const img = ctx.getImageData(0, 0, W, T);
  const d = img.data;
  for (let p = 0; p < d.length; p += 4) {
    const r = d[p], g = d[p + 1], b = d[p + 2], a = d[p + 3];
    if (!(a > 10 && g >= r - 6 && g > b + 8 && g > 90)) d[p + 3] = 0;
  }
  ctx.putImageData(img, 0, 0);
  // Register the 7 sub-frames so `add.image(x, y, 'soil-grass', i)` works.
  for (let i = 0; i < TILES.length; i++) tex.add(i, 0, i * T, 0, T, T);
  tex.refresh();
}

