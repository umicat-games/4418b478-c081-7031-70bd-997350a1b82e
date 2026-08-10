import Phaser from 'phaser';
import { loadWorldScene, getEntityRegistry, Umicat } from '@umicat/phaser-sdk';
import { crossToBgm } from '../bgm';
import { startTransition, finishTransition } from '../transition';
import { WP_FILL, buildIconPattern, driftIconLayer } from '../iconWallpaper';

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
  // Cream drifting-icon wallpaper (replaces the busy island/water backdrop).
  private bgRect?: Phaser.GameObjects.Rectangle;
  private bgLayer?: Phaser.GameObjects.Container;
  private bgCam?: Phaser.Cameras.Scene2D.Camera; // dedicated 1:1 camera for the wallpaper
  private bgPeriod = 100; private bgW = 0; private bgH = 0;
  private title?: Phaser.GameObjects.Sprite;        // the CATOPIA logo
  private titleShadow?: Phaser.GameObjects.Image;   // its drop shadow (stays on the "ground")
  private titleBaseY = 0;                            // the logo's resting (lowest) y — the shadow's anchor
  private titleBaseScale = 1;
  /** The authored Play button entity + its base (un-hovered) scale — SettingsScene
   *  reads these to place the "Settings" button directly BELOW Play, at Play's size. */
  playButton?: Phaser.GameObjects.Sprite;
  playBaseScale = 1;
  /** Resolves to true when the signed-in account already has a CLOUD save. Kicked
   *  off at scene create so it's (almost always) settled by the time Play is
   *  pressed — lets `startGame` decide new-vs-returning from the real save, not
   *  the per-device localStorage flag (the "fresh device replays the intro" bug). */
  private cloudSaveCheck?: Promise<boolean>;

  constructor() {
    super({ key: 'BootMenuScene' });
  }

  async create(): Promise<void> {
    // Fire the cloud-save probe FIRST (before the async world load) so the SDK
    // handshake + saves.get overlap the title screen the player is looking at.
    this.cloudSaveCheck = this.checkCloudSave();
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

    // Custom triangle cursor on the title screen too (self-drives from the pointer when
    // GameScene isn't publishing the `cursor` model). Launched once; persists into the
    // game, where GameScene takes over driving it.
    if (!this.scene.isActive('CursorScene')) this.scene.launch('CursorScene');

    // Title-screen BGM (its own track; stops the in-game one if it were playing).
    // Swell in from silence — paired with the transition wipe (return-to-title ducks
    // the game track out); also a soft intro on a cold boot.
    crossToBgm(this, 'bgm-title', ['bgm'], 700);

    // Backdrop: HIDE the busy island/water tilemaps and use the calm cream drifting-icon
    // wallpaper instead (shared with the loading screen + laptop) — cleaner, cozier title.
    // Screen-fixed (scrollFactor 0) so it fills the canvas regardless of the zoomed boot
    // camera, at a very low depth so the title / buttons / mascot sit on top. (The old dim
    // mask — needed to make the UI pop over the busy island — is gone; cream needs none.)
    this.children.list
      .filter((o): o is Phaser.Tilemaps.TilemapLayer => o instanceof Phaser.Tilemaps.TilemapLayer)
      .forEach((l) => l.setVisible(false));
    // The island's DECORATIONS (trees / furniture / plants / fences / stones) are entities,
    // not tilemap tiles — hide every boot entity except the title logo.
    reg?.all().forEach((go) => {
      if (go.getData('entityAssetId') !== 'catopia-title') (go as Phaser.GameObjects.Sprite).setVisible(false);
    });
    // The wallpaper renders on its OWN 1:1 camera (bgCam), so the boot camera's ~3× zoom
    // and odd screen aspects can't scale / mis-place it — it fills the screen exactly like
    // the laptop's 1:1 wallpaper (a scrollFactor(0) object in the zoomed camera only covered
    // the top-left on non-16:9 tablets). bgCam is put FIRST so it renders BEHIND the world.
    this.bgRect = this.add.rectangle(0, 0, this.scale.width, this.scale.height, WP_FILL, 1).setOrigin(0, 0).setDepth(-100);
    this.bgLayer = this.add.container(0, 0).setDepth(-99);
    this.bgCam = this.cameras.add(0, 0, this.scale.width, this.scale.height);
    const cams = this.cameras.cameras;
    cams.splice(cams.indexOf(this.bgCam), 1); cams.unshift(this.bgCam); // render behind the world camera
    // The world camera got an opaque backdrop colour from the boot scene data — make it
    // TRANSPARENT so the wallpaper camera behind it shows through.
    this.cameras.main.setBackgroundColor('rgba(0,0,0,0)');
    this.layoutWallpaper();

    // Title: gentle up-and-down float (world px; the boot camera is ~3× so ±5 world
    // reads as ±15 on screen). Loops forever with a soft sine ease.
    const title = reg?.all().find((go) => go.getData('entityAssetId') === 'catopia-title') as
      | Phaser.GameObjects.Sprite
      | undefined;
    if (title) {
      this.title = title;
      this.titleBaseY = title.y;          // resting (lowest) position — the shadow anchors here
      this.titleBaseScale = title.scaleX;
      // Soft DROP SHADOW pinned to the "ground": a deep-green copy under the logo. It stays
      // put while the logo floats, so the GAP (+ a slight shrink/fade) grows as it rises —
      // a real "hovering in space" feel, not a flat attached text-shadow. Driven in update().
      this.titleShadow = this.add.image(title.x, title.y, title.texture.key, title.frame.name)
        .setOrigin(title.originX, title.originY)
        .setScale(title.scaleX, title.scaleY)
        .setTint(0x2f5626).setAlpha(0.32).setDepth(title.depth - 0.5);
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

    // Split the cameras (now that all objects exist): the world camera skips the wallpaper,
    // the wallpaper camera skips everything else. So each renders only its half.
    if (this.bgCam && this.bgRect && this.bgLayer) {
      this.cameras.main.ignore([this.bgRect, this.bgLayer]);
      this.bgCam.ignore(this.children.list.filter((o) => o !== this.bgRect && o !== this.bgLayer));
    }

    // Title is ready — uncover any return-to-title transition (no-op on a cold boot).
    finishTransition(this);
  }

  /** Keep the mascot pinned to the camera's visible bottom-left (22 world px in from the
   *  left, feet on the screen bottom) — recomputed each frame so it survives resizes. */
  update(_time: number, delta: number): void {
    if (this.bgLayer) driftIconLayer(this.bgLayer, delta, this.bgPeriod); // wallpaper is on the 1:1 bgCam, so drift at native speed (matches the laptop)
    if (this.title && this.titleShadow) {
      // Shadow STAYS on the ground (fixed y = resting logo + gap); as the logo floats up the
      // gap widens and the shadow shrinks + fades a touch → it looks like it's lifting in space.
      const lift = Phaser.Math.Clamp((this.titleBaseY - this.title.y) / 5, 0, 1); // 0 (rest) .. 1 (peak)
      this.titleShadow.setPosition(this.title.x + 2.5, this.titleBaseY + 4);
      this.titleShadow.setScale(this.titleBaseScale * (1 - 0.05 * lift));
      this.titleShadow.setAlpha(0.32 - 0.12 * lift);
    }
    if (this.cato) {
      const v = this.cameras.main.worldView;
      this.cato.setPosition(v.left + 80, v.bottom);
    }
  }

  /** (Re)size the wallpaper to the canvas; rebuild the icon pattern on a real resize.
   *  The boot camera is ~3× zoomed, and camera zoom DOES scale scrollFactor(0) objects — so
   *  we build the pattern for the ZOOM-DIVIDED canvas (fewer, smaller icons in local space)
   *  which the zoom then magnifies back to the SAME on-screen size as the laptop's 1:1
   *  wallpaper (so the two backgrounds match). */
  private layoutWallpaper(): void {
    if (!this.bgRect || !this.bgLayer) return;
    const W = this.scale.width, H = this.scale.height;
    this.bgRect.setSize(W, H);
    this.bgCam?.setSize(W, H);
    // bgCam is 1:1 (renderScale 1), so this is identical to the laptop's wallpaper.
    if (W !== this.bgW || H !== this.bgH) { this.bgW = W; this.bgH = H; this.bgPeriod = buildIconPattern(this, this.bgLayer, W, H); }
  }

  private fitCamera = (): void => {
    const cam = this.cameras.main;
    const zoom = Math.min(this.scale.width / this.worldW, this.scale.height / this.worldH);
    cam.setZoom(zoom);
    cam.centerOn(this.worldW / 2, this.worldH / 2);
    this.layoutWallpaper(); // reflow the screen-fixed wallpaper on resize
  };

  /** Does this signed-in player already have a saved game? Probes the SAME store
   *  GameScene loads (`umicat.saves` key `state`) — backed by the backend when
   *  signed in, so it answers "returning player?" on ANY device, not just the one
   *  that first played. Best-effort: any error → treat as new (show the intro). */
  private async checkCloudSave(): Promise<boolean> {
    try {
      const u = await Umicat.init({});
      const s = await u?.saves.get<{ v?: number }>('state');
      const has = !!(s && typeof s.v === 'number' && s.v >= 1);
      // Cache on THIS device too, so the next Play here is the instant fast-path.
      if (has) { try { localStorage.setItem('catopia:laptopDone', '1'); } catch { /* no storage */ } }
      return has;
    } catch { return false; }
  }

  /** Public: SettingsScene's Play button calls this (it owns the visible buttons now). */
  startGame(): void {
    this.scene.stop('SettingsScene'); // the buttons/modal are title-screen only (hidden under the curtain)
    // NEW game (first time) → the "message from Cato" laptop cold-open first; a
    // returning player goes straight into the game. "Returning" = this device
    // already did the intro (localStorage fast-path) OR the account has a CLOUD
    // save (so a phone / fresh computer loads progress instead of replaying the
    // opening — the cross-device "starts over" bug).
    let seenLocal = false;
    try { seenLocal = localStorage.getItem('catopia:laptopDone') === '1'; } catch { /* no storage */ }
    if (seenLocal) { this.toGame(); return; }
    const decide = (hasCloudSave: boolean): void => {
      // Cream paw curtain (DEF_COLOR default) — the title AND the laptop scene are both green, so a
      // green curtain was invisible; cream contrasts both so the paw actually reads on this switch.
      if (hasCloudSave) this.toGame();
      else startTransition(this, 'LaptopScene', {}, { effect: 'paw', ms: 1050 });
    };
    // The probe was kicked off at scene create — almost always settled by now.
    // Await it (fall back to "new game" on any error) so a returning player on a
    // fresh device skips the intro and loads their save.
    (this.cloudSaveCheck ?? Promise.resolve(false)).then(decide, () => decide(false));
  }

  /** Enter the game world (returning-player path). */
  private toGame(): void {
    startTransition(this, 'GameScene', { sceneId: GO_TO }, { effect: 'paw', ms: 1050, loading: true });
  }
}
