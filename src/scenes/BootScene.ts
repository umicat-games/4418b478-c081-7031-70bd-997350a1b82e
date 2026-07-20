import Phaser from 'phaser';
import { preloadManifest, getManifest } from '@umicat/phaser-sdk';
import { GAME_WIDTH, GAME_HEIGHT } from '../config';

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
export class BootScene extends Phaser.Scene {
  constructor() {
    super({ key: 'BootScene' });
  }

  preload(): void {
    drawLoadingBar(this);
    preloadManifest(this);
    // Custom pointer-lock cursor — key must match CURSOR_KEY in GameScene.
    this.load.image('cursor', 'uploaded/triangle_mouse_icon_1.png');
    // Tile-selection bracket cursor (24×24, frames a 16px cell) — the "you can
    // till here" highlight that snaps to the hovered grass tile when the hoe is
    // the active tool.
    this.load.image('tile-select', 'uploaded/tile_select_cursor.png');
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
    buildSoilGrassSheet(this);
    const manifest = getManifest(this);
    this.scene.start('GameScene', { sceneId: manifest.initialScene });
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

function drawLoadingBar(scene: Phaser.Scene): void {
  const cx = GAME_WIDTH / 2;
  const cy = GAME_HEIGHT / 2;
  const barW = Math.min(480, GAME_WIDTH * 0.6);
  const barH = 24;

  const label = scene.add
    .text(cx, cy - 40, 'Loading...', {
      fontFamily: 'sans-serif',
      fontSize: '20px',
      color: '#ffffff',
    })
    .setOrigin(0.5);

  const track = scene.add
    .rectangle(cx, cy, barW, barH, 0x222222)
    .setStrokeStyle(2, 0xffffff);
  const fill = scene.add
    .rectangle(cx - barW / 2 + 2, cy, 0, barH - 4, 0xffffff)
    .setOrigin(0, 0.5);

  scene.load.on('progress', (value: number) => {
    fill.width = (barW - 4) * value;
  });
  scene.load.on('complete', () => {
    label.destroy();
    track.destroy();
    fill.destroy();
  });
}
