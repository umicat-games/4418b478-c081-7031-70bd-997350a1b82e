import Phaser from 'phaser';
import { loadWorldScene, getEntityRegistry } from '@umicat/phaser-sdk';
import { crossToBgm } from '../bgm';
import { startTransition, finishTransition } from '../transition';

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
  /** The authored Play button entity + its base (un-hovered) scale — SettingsScene
   *  reads these to place the "Settings" button directly BELOW Play, at Play's size. */
  playButton?: Phaser.GameObjects.Sprite;
  playBaseScale = 1;

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

    // Title-screen BGM (its own track; stops the in-game one if it were playing).
    // Swell in from silence — paired with the transition wipe (return-to-title ducks
    // the game track out); also a soft intro on a cold boot.
    crossToBgm(this, 'bgm-title', ['bgm'], 700);

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

    // The authored `play-button` entity is now a POSITION ANCHOR only — SettingsScene
    // draws the real Play + Settings buttons (unified: empty button-idle + icon + text)
    // at its projected screen position. Hide the baked "▶ PLAY" sprite so it doesn't
    // show under them; keep the entity + its scale exposed for SettingsScene to read.
    const btn = reg?.byRole('play-button')[0] as Phaser.GameObjects.Sprite | undefined;
    if (btn) {
      this.playButton = btn;
      this.playBaseScale = btn.scaleX; // authored scale (1 at game-scale)
      btn.setVisible(false);
    } else {
      // No anchor (boot scene emptied in the editor) — SettingsScene falls back to a
      // bottom-centre Play button, so the game is never un-startable.
      // eslint-disable-next-line no-console
      console.warn('[catopia] boot: no play-button entity; SettingsScene uses a fallback');
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

    // Native-px SETTINGS overlay (gear button top-right → volume modal). Above this
    // scene so its 1:1 camera isn't zoomed by the boot camera; stopped on Play.
    this.scene.launch('SettingsScene');
    this.scene.bringToTop('SettingsScene');

    // Title is ready — uncover any return-to-title transition (no-op on a cold boot).
    finishTransition(this);
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

  /** Public: SettingsScene's Play button calls this (it owns the visible buttons now). */
  startGame(): void {
    this.scene.stop('SettingsScene'); // the buttons/modal are title-screen only (hidden under the curtain)
    // NEW game (first time) → the "message from Cato" laptop cold-open first; a returning
    // player goes straight into the game. (P1 gate: a localStorage flag set once the
    // laptop is accepted; later this aligns with the real save-based new-game check.)
    let seen = false;
    try { seen = localStorage.getItem('catopia:laptopDone') === '1'; } catch { /* no storage */ }
    if (seen) startTransition(this, 'GameScene', { sceneId: GO_TO }, { effect: 'paw', ms: 560 });
    else startTransition(this, 'LaptopScene', {}, { effect: 'paw', ms: 560 });
  }
}
