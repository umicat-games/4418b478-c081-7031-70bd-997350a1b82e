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
    this.load.spritesheet('player_ship_tilt', 'uploaded/player_ship_tilt_fl0kn_sheet.png', { frameWidth: 64, frameHeight: 64 });
    this.load.image('space_craft_enemy_1', 'uploaded/space_craft_enemy_1.png');
    this.load.audio('bgm_space_siege', 'uploaded/bgm_space_siege_ggac4.mp3');
    this.load.audio('sfx_explosion', 'uploaded/sfx_explosion_glgpn.mp3');
  }

  create(): void {
    // Apply nearest-neighbour filter for crisp pixel art
    this.textures.get('player_ship_tilt').setFilter(Phaser.Textures.FilterMode.NEAREST);
    this.textures.get('space_craft_enemy_1').setFilter(Phaser.Textures.FilterMode.NEAREST);
    // Register directional tilt frames as animations (no looping — frames are selected manually)
    this.anims.create({
      key: 'ship_tilt_left',
      frames: [{ key: 'player_ship_tilt', frame: 2 }],
      frameRate: 1,
    });
    this.anims.create({
      key: 'ship_tilt_right',
      frames: [{ key: 'player_ship_tilt', frame: 13 }],
      frameRate: 1,
    });
    this.anims.create({
      key: 'ship_straight',
      frames: [{ key: 'player_ship_tilt', frame: 7 }],
      frameRate: 1,
    });
    const manifest = getManifest(this);
    this.scene.start('TitleScene', { sceneId: manifest.initialScene });
  }
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
