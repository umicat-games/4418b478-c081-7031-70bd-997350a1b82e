import Phaser from 'phaser';
import { loadWorldScene, getEntityRegistry } from '@umicat/phaser-sdk';

/**
 * Boot / title screen — a DATA scene. Renders the `boot` scene-as-data (its
 * entities, incl. the Play button, live in `public/scenes/world/boot.json` and
 * are editable in the visual editor) and adds the runtime behaviour: clicking
 * the `play-button` entity starts the game. The editor's design player renders
 * the SAME `boot` data in Edit; this is its Play-time counterpart.
 *
 * BootScene routes here when the initial scene is `boot` (the default). Play
 * Scene('main') (`?umicatScene=main`) overrides the initial scene, so it boots
 * straight into the game (BootScene → GameScene), skipping this — exactly the
 * point of Play Scene.
 */
const GO_TO = 'main'; // the scene the Play button launches

export class BootMenuScene extends Phaser.Scene {
  private worldW = 960;
  private worldH = 540;

  constructor() {
    super({ key: 'BootMenuScene' });
  }

  async create(): Promise<void> {
    const { sceneFile } = await loadWorldScene(this, 'boot');
    this.worldW = sceneFile.world?.width ?? this.worldW;
    this.worldH = sceneFile.world?.height ?? this.worldH;

    // Fit the boot world into the canvas (Catopia is scaleMode:'resize'), centered.
    this.fitCamera();
    this.scale.on(Phaser.Scale.Events.RESIZE, this.fitCamera, this);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.scale.off(Phaser.Scale.Events.RESIZE, this.fitCamera, this);
    });

    // Wire the authored Play button entity → start the game.
    const btn = getEntityRegistry(this)?.byRole('play-button')[0] as
      | Phaser.GameObjects.Sprite
      | undefined;
    if (btn) {
      btn.setInteractive({ useHandCursor: true });
      btn.on('pointerup', () => this.startGame());
    } else {
      // Button missing (e.g. the boot scene was emptied in the editor) — don't
      // trap the player: any click starts the game.
      // eslint-disable-next-line no-console
      console.warn('[catopia] boot: no play-button entity; click anywhere to start');
      this.input.once('pointerdown', () => this.startGame());
    }
  }

  private fitCamera = (): void => {
    const cam = this.cameras.main;
    const zoom = Math.min(this.scale.width / this.worldW, this.scale.height / this.worldH);
    cam.setZoom(zoom);
    cam.centerOn(this.worldW / 2, this.worldH / 2);
  };

  private startGame(): void {
    this.scene.start('GameScene', { sceneId: GO_TO });
  }
}
