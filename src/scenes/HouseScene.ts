import Phaser from 'phaser';
import { loadWorldScene, getEntityRegistry } from '@umicat/phaser-sdk';
import { finishTransition, coverAndHandoff } from '../transition';
import { DESIGN_ZOOM } from '../config';
import { isDebug } from '../debug';
import type { GameScene } from './GameScene';

const DOOR_CLOSED_FRAME = 5; // `door` sheet: frame 5 = shut (matches GameScene's DOOR_CLOSED_FRAME)
const PAN_SPEED = 260; // world px/sec for keyboard camera panning (a bigger-than-screen room)

/**
 * House INTERIOR scene (Animal Crossing / Stardew style). The island house is a
 * fixed facade; tapping it PAUSES GameScene and launches this scene OVER it
 * (island stays in memory paused, so re-entry never hits the scene-reuse "stuck
 * on loading" trap — see `transition.ts`). It renders ONE authored interior
 * scene-as-data (`home_1` / `home_2` / …), with a FIXED camera framing the whole
 * room and a black backdrop ("outside is black"). Room expansion swaps the whole
 * interior for a bigger authored one (see GameScene.renovateHome).
 *
 * Interactions are HouseScene-owned (GameScene is paused, so its input is off):
 * tap the exit door → back to the island; tap the renovation station (home_1) →
 * buy the next tier + reload. Cato is present but idle (no in-house behaviours yet).
 */
export class HouseScene extends Phaser.Scene {
  private homeSceneId = 'home_1';
  private worldW = 224;
  private worldH = 160;
  private exitDoor?: Phaser.GameObjects.Sprite;
  private exiting = false;
  private cursors?: Phaser.Types.Input.Keyboard.CursorKeys;
  private wasd?: Record<'W' | 'A' | 'S' | 'D', Phaser.Input.Keyboard.Key>;

  constructor() { super({ key: 'HouseScene' }); }

  init(data: { sceneId?: string }): void {
    this.homeSceneId = data?.sceneId ?? 'home_1';
    this.exiting = false;
  }

  async create(): Promise<void> {
    this.cameras.main.setBackgroundColor('#000000'); // outside the room is black

    const { sceneFile } = await loadWorldScene(this, this.homeSceneId);
    this.worldW = sceneFile.world?.width ?? this.worldW;
    this.worldH = sceneFile.world?.height ?? this.worldH;

    // Camera: render the room at the ISLAND's zoom (tiles look the same size), centred,
    // clamped to the room bounds. NO follow (unlike the island's exact-follow). When the
    // room is BIGGER than the screen you PAN it (WASD/arrows on desktop, drag on touch),
    // like the island; when it fits, it stays centred (bounds clamp = no pan). Re-frame on resize.
    this.frameCamera();
    this.scale.on(Phaser.Scale.Events.RESIZE, this.frameCamera, this);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.scale.off(Phaser.Scale.Events.RESIZE, this.frameCamera, this);
    });
    this.cursors = this.input.keyboard?.createCursorKeys();
    this.wasd = this.input.keyboard?.addKeys('W,A,S,D') as typeof this.wasd;
    this.input.on(Phaser.Input.Events.POINTER_MOVE, this.onPointerMove, this); // touch drag-pan

    // GameScene is PAUSED, so its stale `cursor` registry model would keep the pixel
    // cursor frozen at the last island position. Clear it so CursorScene self-drives from
    // the REAL pointer while we're in the house (GameScene republishes on resume).
    this.registry.remove('cursor');

    const reg = getEntityRegistry(this);

    // Cato inside — stands idle (no wander/collision yet; fixed camera).
    const cato = reg?.byRole('child')[0] as Phaser.GameObjects.Sprite | undefined;
    if (cato && this.anims.exists('idle-down')) cato.play('idle-down');

    // Exit door — force onto the anim sheet at closed; tap to leave.
    const exit = reg?.all().find(
      (go) => go.getData('entityAssetId') === 'door_animation_sprites',
    ) as Phaser.GameObjects.Sprite | undefined;
    if (exit) {
      this.exitDoor = exit;
      if (this.textures.exists('door')) exit.setTexture('door', DOOR_CLOSED_FRAME);
      exit.setInteractive({ useHandCursor: true });
      exit.on(Phaser.Input.Events.GAMEOBJECT_POINTER_DOWN, () => this.exitHouse());
    }

    // Renovate (buy the next tier) is a DEBUG key for now — the work station stays OUTSIDE
    // the house, and the in-house purchase affordance is a later design. R = renovate.
    if (isDebug('devTools') && this.homeSceneId === 'home_1') {
      this.input.keyboard?.on('keydown-R', () => this.tryRenovate('home_2'));
    }

    // Keep the pixel cursor on top (it self-drives from the real pointer when GameScene
    // isn't publishing the cursor model).
    if (this.scene.isActive('CursorScene')) this.scene.bringToTop('CursorScene');

    finishTransition(this); // room is ready → uncover
  }

  private frameCamera = (): void => {
    const cam = this.cameras.main;
    // Match the island's zoom so tiles are the same size; fall back to the design zoom.
    const gs = this.scene.get('GameScene') as Phaser.Scene | undefined;
    const zoom = gs?.cameras?.main?.zoom || DESIGN_ZOOM;
    cam.setZoom(zoom);
    // We need BOTH: tilemap CULLING keys off the camera bounds (remove them and the room's
    // tiles get culled away → black room), AND a room smaller than the view must be CENTRED
    // (plain setBounds(0,0,room) clamps a small room to the top-left corner, not centred).
    // So set the bounds to at least the viewport size, CENTRED on the room: a small
    // dimension centres (black around it, can't pan off), a bigger one keeps its full extent
    // so panning still works. `centerOn` sets the initial view to the room's middle.
    const viewW = this.scale.width / zoom, viewH = this.scale.height / zoom;
    const bw = Math.max(this.worldW, viewW), bh = Math.max(this.worldH, viewH);
    cam.setBounds(this.worldW / 2 - bw / 2, this.worldH / 2 - bh / 2, bw, bh);
    cam.centerOn(this.worldW / 2, this.worldH / 2);
  };

  /** Touch drag pans the room (desktop pans with keys, like the island). setBounds clamps. */
  private onPointerMove = (p: Phaser.Input.Pointer): void => {
    if (!p.isDown || !p.wasTouch) return;
    const cam = this.cameras.main;
    cam.scrollX -= (p.x - p.prevPosition.x) / cam.zoom;
    cam.scrollY -= (p.y - p.prevPosition.y) / cam.zoom;
  };

  update(_t: number, delta: number): void {
    // Keyboard pan (WASD / arrows) — the camera bounds clamp it, so a fits-on-screen
    // room stays put (centred) and a bigger one pans within its edges.
    const c = this.cursors, w = this.wasd;
    if (!c && !w) return;
    let dx = 0, dy = 0;
    if (c?.left.isDown || w?.A.isDown) dx -= 1;
    if (c?.right.isDown || w?.D.isDown) dx += 1;
    if (c?.up.isDown || w?.W.isDown) dy -= 1;
    if (c?.down.isDown || w?.S.isDown) dy += 1;
    if (dx || dy) {
      const step = (PAN_SPEED * delta) / 1000;
      const cam = this.cameras.main;
      cam.scrollX += dx * step;
      cam.scrollY += dy * step;
    }
  }

  /** Buy the next home tier via GameScene, then swap this interior for it. */
  private tryRenovate(nextId: string): void {
    if (this.exiting) return;
    const gs = this.scene.get('GameScene') as GameScene | undefined;
    if (!gs || !gs.renovateHome(nextId)) return; // not enough coins / unknown tier
    coverAndHandoff(this, () => this.scene.restart({ sceneId: nextId }), { effect: 'dissolve', color: 0x000000, ms: 220 });
  }

  /** Tap the exit door → cover, resume the island (GameScene), stop this scene.
   *  GameScene's RESUME handler repositions Cato at the door + reveals. */
  private exitHouse(): void {
    if (this.exiting) return;
    this.exiting = true;
    if (this.exitDoor && this.anims.exists('door-open')) this.exitDoor.play({ key: 'door-open', repeat: 0 });
    // Quick fade to black, then back on the island (matches the enter fade — no iris/loading).
    coverAndHandoff(this, () => {
      this.scene.resume('GameScene');
      this.scene.stop('HouseScene');
    }, { effect: 'dissolve', color: 0x000000, ms: 220 });
  }
}
