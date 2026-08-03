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
  private cato?: Phaser.GameObjects.Sprite;

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

    const reg = getEntityRegistry(this);

    // Dim MASK between the busy island scene (depth 0–10) and the UI, so the title /
    // mascot / Play button (all above depth 50) pop instead of fighting the background.
    // A big world-space rect (the boot camera is zoomed, so oversize it to cover any view).
    this.add.rectangle(this.worldW / 2, this.worldH / 2, 4000, 4000, 0x14212e, 0.4).setDepth(50);

    // Title: gentle up-and-down float (world px; the boot camera is ~3× so ±5 world
    // reads as ±15 on screen). Loops forever with a soft sine ease.
    const title = reg?.all().find((go) => go.getData('entityAssetId') === 'catopia-title') as
      | Phaser.GameObjects.Sprite
      | undefined;
    if (title) {
      this.tweens.add({ targets: title, y: title.y - 5, duration: 1600, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
    }

    // Wire the authored Play button entity → start the game, with hover + press feedback.
    const btn = reg?.byRole('play-button')[0] as Phaser.GameObjects.Sprite | undefined;
    if (btn) {
      btn.setInteractive({ useHandCursor: true });
      const base = btn.scaleX; // authored scale (1 at game-scale)
      let pressed = false;
      const scaleTo = (s: number, ms = 90): void => { this.tweens.add({ targets: btn, scaleX: base * s, scaleY: base * s, duration: ms, ease: 'Quad.easeOut' }); };
      btn.on('pointerover', () => { if (!pressed) scaleTo(1.07); });          // hover → grow (highlight)
      btn.on('pointerout', () => { pressed = false; btn.clearTint(); scaleTo(1); });
      btn.on('pointerdown', () => { pressed = true; btn.setTint(0xcbb48f); scaleTo(0.9, 60); }); // press → shrink + darken
      btn.on('pointerup', () => { pressed = false; btn.clearTint(); scaleTo(1); this.startGame(); });
    } else {
      // Button missing (e.g. the boot scene was emptied in the editor) — don't
      // trap the player: any click starts the game.
      // eslint-disable-next-line no-console
      console.warn('[catopia] boot: no play-button entity; click anywhere to start');
      this.input.once('pointerdown', () => this.startGame());
    }

    // Cato mascot, bottom-left, sitting on the SCREEN bottom. It's a WORLD sprite at
    // scale 1 — the ~3× boot camera renders it at 3× (game scale, matching the tiles).
    // Pinned to the camera's VISIBLE bottom-left each frame (`update`) via cam.worldView
    // (Phaser zooms around the camera CENTRE, so the visible edge ISN'T worldH/2 ± h/2z —
    // use worldView, not a hand-rolled formula), so it hugs the screen edge on ANY aspect.
    // Plays `teemo-appear` once on load, then loops random blink/love/think with a pause.
    if (this.textures.exists('teemo')) {
      const cato = this.add.sprite(0, 0, 'teemo', 0).setOrigin(0.5, 1).setScale(2).setDepth(200); // 2× (→ 6× on screen)
      this.cato = cato;
      const EMOTES = ['teemo-blink', 'teemo-love', 'teemo-think'];
      const playNext = (): void => { cato.play(EMOTES[Math.floor(Math.random() * EMOTES.length)]); };
      cato.on(Phaser.Animations.Events.ANIMATION_COMPLETE, () => {
        this.time.delayedCall(500 + Math.random() * 900, playNext);
      });
      cato.play('teemo-appear');
    }
  }

  /** Keep the mascot pinned to the camera's visible bottom-left (22 world px in from the
   *  left, feet on the screen bottom) — recomputed each frame so it survives resizes. */
  update(): void {
    if (!this.cato) return;
    const v = this.cameras.main.worldView;
    this.cato.setPosition(v.left + 80, v.bottom);
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
