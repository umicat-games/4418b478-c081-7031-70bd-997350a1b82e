import Phaser from 'phaser';
import { loadWorldScene, getEntityRegistry } from '@umicat/phaser-sdk';
import { finishTransition, coverAndHandoff } from '../transition';
import { DESIGN_ZOOM } from '../config';
import { isDebug } from '../debug';
import type { GameScene } from './GameScene';

const DOOR_CLOSED_FRAME = 5; // `door` sheet: frame 5 = shut (matches GameScene's DOOR_CLOSED_FRAME)
const PAN_SPEED = 260; // world px/sec for keyboard camera panning (a bigger-than-screen room)
const BRACKET_BR = 0.625; // corner-bracket scale — matches the island's white-corner-bracket (~5×zoom)
const HOVER_PAD = 6;      // world-px gap around the framed object (== GameScene.HOVER_PAD_WORLD)

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
  private hoverBracket?: Phaser.GameObjects.NineSlice; // corner frame shown when the mouse is over an interactable (exit door / stove)
  private stove?: Phaser.GameObjects.Sprite;           // kitchen stove — click to cook (lights up via stove-on anim)
  private stoveRect?: Phaser.Geom.Rectangle;           // world bbox of the stove + pot (the clickable / hover group)
  private cooking = false;                             // the cooking modal (CookScene) is open
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

    // Cato inside — hidden for now. Making him auto-appear in the room felt odd (he's a
    // separate instance from the paused island Cato, not one who "walks in"), so we keep the
    // authored child entity in the scene data but don't show it. Re-enable (play idle / add
    // in-house behaviours) here later.
    const cato = reg?.byRole('child')[0] as Phaser.GameObjects.Sprite | undefined;
    cato?.setVisible(false);

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

    // Hover affordance: a white corner-bracket around the exit door (the SAME frame the island's
    // hover-inspect uses) so the player sees the door is clickable to leave. World-space nine-slice
    // (the camera applies the zoom) scaled 0.625 → ~5×zoom corners, matching the island brackets.
    if (this.textures.exists('ui-sheet') && this.textures.get('ui-sheet').has('white-corner-bracket')) {
      this.hoverBracket = this.add
        .nineslice(0, 0, 'ui-sheet', 'white-corner-bracket', 32, 32, 14, 14, 14, 14)
        .setScale(BRACKET_BR).setOrigin(0.5, 0.5).setDepth(1e6).setVisible(false);
    }

    // Kitchen STOVE + POT — click to open the cooking modal (the stove counterpart of the
    // island work station's crafting). The pot sits just above the stove; together they're ONE
    // interactable (a single hover bracket frames both, a click on either opens cooking). The
    // stove sprite is swapped to the `stove-turn-on` sheet + lit while cooking (turned off on close).
    const stove = reg?.all().find((go) => go.getData('entityAssetId') === 'stove') as Phaser.GameObjects.Sprite | undefined;
    const pot = reg?.all().find((go) => go.getData('entityAssetId') === 'pot') as Phaser.GameObjects.Sprite | undefined;
    if (stove) {
      this.stove = stove;
      const sb = stove.getBounds();
      this.stoveRect = pot ? Phaser.Geom.Rectangle.Union(sb, pot.getBounds()) : sb;
      for (const go of [stove, pot]) {
        go?.setInteractive({ useHandCursor: true });
        go?.on(Phaser.Input.Events.GAMEOBJECT_POINTER_DOWN, () => this.openCooking());
      }
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

  /** Touch drag pans the room (desktop pans with keys, like the island). setBounds clamps.
   *  Also drives the hover bracket over the interactables (desktop mouse). */
  private onPointerMove = (p: Phaser.Input.Pointer): void => {
    this.updateHover(p);
    if (!p.isDown || !p.wasTouch) return;
    const cam = this.cameras.main;
    cam.scrollX -= (p.x - p.prevPosition.x) / cam.zoom;
    cam.scrollY -= (p.y - p.prevPosition.y) / cam.zoom;
  };

  /** Frame the interactable under the mouse with the corner bracket (exit door OR the kitchen
   *  stove group), like the island's hover-inspect; else hide it. */
  private updateHover(p: Phaser.Input.Pointer): void {
    const br = this.hoverBracket;
    if (!br || this.exiting || this.cooking) { br?.setVisible(false); return; }
    const wp = this.cameras.main.getWorldPoint(p.x, p.y);
    // Priority: exit door, then the stove+pot group. Whichever contains the point wins.
    const door = this.exitDoor?.getBounds();
    const target = (door && door.contains(wp.x, wp.y)) ? door
      : (this.stoveRect && this.stoveRect.contains(wp.x, wp.y)) ? this.stoveRect
        : undefined;
    if (target) {
      br.setSize((target.width + HOVER_PAD * 2) / BRACKET_BR, (target.height + HOVER_PAD * 2) / BRACKET_BR)
        .setPosition(target.centerX, target.centerY).setVisible(true);
    } else {
      br.setVisible(false);
    }
  }

  /** Click the stove/pot → light the burner + open the cooking modal (CookScene). CookScene owns
   *  its own input; HouseScene input is disabled while it's open (modal), re-enabled on close. */
  private openCooking(): void {
    if (this.cooking || this.exiting) return;
    this.cooking = true;
    this.hoverBracket?.setVisible(false);
    // Light the stove (swap the static `stove` sprite onto the turn-on sheet, loop the flame).
    if (this.stove && this.anims.exists('stove-on')) {
      this.stove.setTexture('stove-turn-on', 0);
      this.stove.play('stove-on');
    }
    this.input.enabled = false; // modal: only CookScene handles input while cooking
    const cook = this.scene.get('CookScene');
    cook.events.once('cook-closed', this.onCookClosed, this);
    this.scene.launch('CookScene', { gameScene: 'GameScene' });
    this.scene.bringToTop('CookScene');
    if (this.scene.isActive('CursorScene')) this.scene.bringToTop('CursorScene'); // keep the pixel cursor above the modal
  }

  /** Cooking modal closed → turn the stove off (reverse anim → static) + re-enable input. */
  private onCookClosed(): void {
    this.cooking = false;
    this.input.enabled = true;
    const stove = this.stove;
    if (stove && this.anims.exists('stove-off')) {
      stove.once(Phaser.Animations.Events.ANIMATION_COMPLETE, () => {
        if (this.textures.exists('stove')) stove.setTexture('stove', 0);
      });
      stove.play('stove-off');
    } else if (stove && this.textures.exists('stove')) {
      stove.setTexture('stove', 0);
    }
  }

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
    this.hoverBracket?.setVisible(false); // drop the hover frame while leaving
    // Play the door-open swing FIRST, THEN fade to black + back to the island (matches the enter
    // fade — no iris/loading). Guarded so the ANIMATION_COMPLETE + the safety timer can't both fire.
    let started = false;
    const fadeOut = (): void => {
      if (started) return;
      started = true;
      coverAndHandoff(this, () => {
        this.scene.resume('GameScene');
        this.scene.stop('HouseScene');
      }, { effect: 'dissolve', color: 0x000000, ms: 220 });
    };
    if (this.exitDoor && this.anims.exists('door-open')) {
      this.exitDoor.once(Phaser.Animations.Events.ANIMATION_COMPLETE, fadeOut);
      this.exitDoor.play({ key: 'door-open', repeat: 0 });
      this.time.delayedCall(2000, fadeOut); // safety: a missed COMPLETE event can't strand the exit
    } else {
      fadeOut();
    }
  }
}
