import Phaser from 'phaser';
import { loadWorldScene, getEntityRegistry } from '@umicat/phaser-sdk';
import { finishTransition, coverAndHandoff } from '../transition';
import { crossToBgm } from '../bgm';
import { playSfx, SFX_DOOR } from '../sfx';
import { DESIGN_ZOOM } from '../config';
import { isDebug } from '../debug';
import { t } from '../i18n';
import type { GameScene } from './GameScene';

const DOOR_CLOSED_FRAME = 5; // `door` sheet: frame 5 = shut (matches GameScene's DOOR_CLOSED_FRAME)
const PAN_SPEED = 260; // world px/sec for keyboard camera panning (a bigger-than-screen room)
const BRACKET_BR = 0.625; // corner-bracket scale — matches the island's white-corner-bracket (~5×zoom)
const HOVER_PAD = 6;      // world-px gap around the framed object (== GameScene.HOVER_PAD_WORLD)
const SLEEPY_EMOJI_FRAME = 39; // `emoji` sheet (row*10+col): the sleeping-with-Z cat face for the sleep bubble

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
  private hoverPill?: Phaser.GameObjects.Graphics;     // dark pill behind the hover name label
  private hoverLabel?: Phaser.GameObjects.Text;        // the interactable's NAME (like the island's hover-inspect)
  private stove?: Phaser.GameObjects.Sprite;           // kitchen stove — click to cook (lights up via stove-on anim)
  private stoveRect?: Phaser.Geom.Rectangle;           // world bbox of the stove + pot (the clickable / hover group)
  private cooking = false;                             // the cooking modal (CookScene) is open
  private stoveBusy = false;                           // stove turn-on / turn-off anim is playing (block re-trigger)
  private exiting = false;
  private cursors?: Phaser.Types.Input.Keyboard.CursorKeys;
  private wasd?: Record<'W' | 'A' | 'S' | 'D', Phaser.Input.Keyboard.Key>;
  private nightMask?: Phaser.GameObjects.Rectangle;      // full-screen day/night tint (darkens the room like the island)
  private lampGlow: Phaser.GameObjects.Image[] = [];     // the table lamp's layered warm glow (fades in at night)
  private lampGlowBaseAlpha: number[] = [];              // each glow layer's full-night alpha (scaled by darkness)
  private bed?: Phaser.GameObjects.Sprite;               // the room's bed — swapped to a sleeping-Cato sprite at night
  private sleepCato?: Phaser.GameObjects.Sprite;         // the "Cato asleep in bed" sprite shown over the bed at night
  private sleepBubble?: Phaser.GameObjects.Container;     // the drowsy Zzz bubble above the sleeping Cato
  private catoAsleep = false;                            // is the room currently showing sleeping Cato?

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
    // Name label above the bracket (like the island's hover-inspect pill) — so an interactable
    // shows its title on hover. World-space (the camera zooms it); a small font renders crisp at
    // the room's zoom. Dark pill so it reads on any wall/floor.
    this.hoverPill = this.add.graphics().setDepth(1e6 + 1).setVisible(false);
    this.hoverLabel = this.add.text(0, 0, '', { fontFamily: 'zpix, sans-serif', fontSize: '6px', color: '#fff3d6', resolution: 6 })
      .setOrigin(0.5, 1).setDepth(1e6 + 2).setVisible(false);

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

    // Day/night: darken the room in lockstep with the island + light the table lamp at night.
    this.setupRoomLighting(reg);

    // Nightly sleep: at bedtime the room's bed is swapped for a "Cato asleep in bed" sprite
    // (he's come home to sleep — the island shows him gone) with a drowsy Zzz bubble.
    this.setupSleepBed(reg);
    this.refreshSleep(); // apply immediately (entering the house at night shows him already asleep)

    // Keep the pixel cursor on top (it self-drives from the real pointer when GameScene
    // isn't publishing the cursor model).
    if (this.scene.isActive('CursorScene')) this.scene.bringToTop('CursorScene');

    // Restore the game BGM: the enter-transition ducks it to 0 (TransitionScene.begin), and
    // only the OUTGOING scene's create swells it back — GameScene stays paused, so the house
    // must do it or the music is silent inside. Same `bgm` track keeps playing (global mgr).
    crossToBgm(this, 'bgm', [], 700);

    finishTransition(this); // room is ready → uncover
  }

  private static ROOM_MASK_DEPTH = 500000; // above every room sprite, below the hover bracket (1e6) + cursor

  /** Room day/night: a full-screen tint that darkens toward night (same NIGHT_KEYS the island uses,
   *  read from the PAUSED GameScene's wall clock), plus a layered, breathing warm GLOW on the table
   *  lamp that FADES IN with the darkness — so at night the room dims and the lamp lights it. */
  private setupRoomLighting(reg: ReturnType<typeof getEntityRegistry>): void {
    // Screen-space oversized rect (mirrors the island's night mask) → covers the room at any camera
    // scroll / canvas size. Starts clear; update() drives its colour + alpha from the clock.
    this.nightMask = this.add.rectangle(-4000, -4000, 16000, 16000, 0x0c1636, 0)
      .setOrigin(0, 0).setScrollFactor(0).setDepth(HouseScene.ROOM_MASK_DEPTH);

    // The table lamp → a 3-layer warm glow that cuts through the night tint. Find the lamp sprite
    // (basic_furniture, a `lamp-*` frame); no lamp / no texture → no glow.
    if (!this.textures.exists('light-beam')) return;
    // The glow is a 32px blob scaled up — sample it LINEAR (not the game's global nearest) so the
    // halo stays SMOOTH instead of turning into blocky rings when enlarged.
    this.textures.get('light-beam').setFilter(Phaser.Textures.FilterMode.LINEAR);
    const lamp = reg?.all().find((go) => {
      if (go.getData('entityAssetId') !== 'basic_furniture') return false;
      const fn = (go as Phaser.GameObjects.Sprite).frame?.name;
      return typeof fn === 'string' && fn.startsWith('lamp');
    }) as Phaser.GameObjects.Sprite | undefined;
    if (!lamp) return;
    const lx = lamp.x, ly = lamp.y - lamp.displayHeight * 0.18; // nudge up toward the shade / bulb
    // Soft wide halo → warm mid → bright core. Warm tints + ADD blend so they BRIGHTEN the darkened
    // room (kept modest so it lights the lamp's corner, not the whole room). Alpha is set per-frame
    // from the darkness (update); the scale gently BREATHES here. (No clip mask: additive draws
    // ignore Phaser's geometry/bitmap masks, so we just keep the halo small enough that its faint
    // edge barely reaches past the wall.)
    const layers: Array<{ scale: number; tint: number; alpha: number }> = [
      { scale: 2.4, tint: 0xffca7a, alpha: 0.13 },
      { scale: 1.6, tint: 0xffda92, alpha: 0.20 },
      { scale: 1.0, tint: 0xffe6b0, alpha: 0.30 },
    ];
    const BREATHE_MS = 2000;
    layers.forEach((L, i) => {
      const g = this.add.image(lx, ly, 'light-beam')
        .setTint(L.tint).setBlendMode(Phaser.BlendModes.ADD)
        .setDepth(HouseScene.ROOM_MASK_DEPTH + 1 + i).setScale(L.scale).setAlpha(0);
      this.lampGlow.push(g);
      this.lampGlowBaseAlpha.push(L.alpha);
    });
    // Breathing: pulse ALL three layers together (one shared period + phase) so the whole glow
    // swells/settles as ONE coherent light — each layer scales by the same 0.94→1.06 factor around
    // its own base, so they stay proportional.
    this.tweens.addCounter({
      from: 0.94, to: 1.06, duration: BREATHE_MS, yoyo: true, repeat: -1, ease: 'Sine.easeInOut',
      onUpdate: (tw) => { const f = tw.getValue() ?? 1; this.lampGlow.forEach((g, i) => g.setScale(layers[i]!.scale * f)); },
    });
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

  /** Frame the interactable under the mouse with the corner bracket + its NAME (exit door OR the
   *  kitchen stove group), like the island's hover-inspect; else hide it. */
  private updateHover(p: Phaser.Input.Pointer): void {
    const br = this.hoverBracket;
    if (!br || this.exiting || this.cooking || this.stoveBusy) { this.hideHover(); return; }
    const wp = this.cameras.main.getWorldPoint(p.x, p.y);
    // Priority: exit door, then the stove+pot group. Whichever contains the point wins.
    const door = this.exitDoor?.getBounds();
    const [target, name] = (door && door.contains(wp.x, wp.y)) ? [door, t('hover_exit')] as const
      : (this.stoveRect && this.stoveRect.contains(wp.x, wp.y)) ? [this.stoveRect, t('hover_stove')] as const
        : [undefined, ''] as const;
    if (!target) { this.hideHover(); return; }
    br.setSize((target.width + HOVER_PAD * 2) / BRACKET_BR, (target.height + HOVER_PAD * 2) / BRACKET_BR)
      .setPosition(target.centerX, target.centerY).setVisible(true);
    // Name pill just above the bracket top (world-space; a dark pill so it reads on any wall).
    const label = this.hoverLabel, pill = this.hoverPill;
    if (label && pill) {
      const topY = target.centerY - target.height / 2 - HOVER_PAD - 2;
      label.setText(name).setPosition(target.centerX, topY).setVisible(!!name);
      pill.clear();
      if (name) {
        const padX = 2, padY = 1, bw = label.width + padX * 2, bh = label.height + padY * 2;
        pill.fillStyle(0x2a1c0c, 0.8).fillRoundedRect(target.centerX - bw / 2, topY - bh, bw, bh, 2).setVisible(true);
      } else { pill.setVisible(false); }
    }
  }

  private hideHover(): void {
    this.hoverBracket?.setVisible(false);
    this.hoverLabel?.setVisible(false);
    this.hoverPill?.setVisible(false);
  }

  /** Click the stove/pot → play the turn-on animation to COMPLETION, THEN open the cooking modal
   *  (CookScene). CookScene owns its own input; HouseScene input is disabled while it's open. */
  private openCooking(): void {
    if (this.cooking || this.exiting || this.stoveBusy) return;
    this.hideHover();
    this.input.enabled = false; // lock input through the light-up + the modal
    const launch = (): void => {
      this.stoveBusy = false;
      this.cooking = true;
      const cook = this.scene.get('CookScene');
      cook.events.once('cook-closed', this.onCookClosed, this);
      this.scene.launch('CookScene', { gameScene: 'GameScene' });
      this.scene.bringToTop('CookScene');
      if (this.scene.isActive('CursorScene')) this.scene.bringToTop('CursorScene'); // keep the pixel cursor above the modal
    };
    // Light the stove (swap onto the turn-on sheet), play ONCE, and open cooking only when the
    // burner has finished lighting. A safety timer opens it even if COMPLETE is missed.
    if (this.stove && this.anims.exists('stove-on')) {
      this.stoveBusy = true;
      let opened = false;
      const openOnce = (): void => { if (opened) return; opened = true; launch(); };
      this.stove.setTexture('stove-turn-on', 0);
      this.stove.once(Phaser.Animations.Events.ANIMATION_COMPLETE, openOnce);
      this.stove.play({ key: 'stove-on', repeat: 0 });
      this.time.delayedCall(1400, openOnce);
    } else {
      launch();
    }
  }

  /** Cooking modal closed → re-enable input, THEN play the turn-off animation and revert to the
   *  static stove (the burner cools down after you step away). */
  private onCookClosed(): void {
    this.cooking = false;
    this.input.enabled = true;
    const stove = this.stove;
    if (stove && this.anims.exists('stove-off')) {
      this.stoveBusy = true; // block a re-open while it cools down
      let done = false;
      const finish = (): void => {
        if (done) return;
        done = true;
        this.stoveBusy = false;
        if (this.textures.exists('stove')) stove.setTexture('stove', 0);
      };
      stove.once(Phaser.Animations.Events.ANIMATION_COMPLETE, finish);
      stove.play({ key: 'stove-off', repeat: 0 });
      this.time.delayedCall(1400, finish);
    } else if (stove && this.textures.exists('stove')) {
      stove.setTexture('stove', 0);
    }
  }

  /** Find the room's bed + build the (hidden) "Cato asleep in bed" sprite that replaces it at
   *  night, plus a drowsy Zzz bubble above it. */
  private setupSleepBed(reg: ReturnType<typeof getEntityRegistry>): void {
    const bed = reg?.all().find(
      (go) => go.getData('entityAssetId') === 'basic_furniture'
        && String((go as Phaser.GameObjects.Sprite).frame?.name ?? '').startsWith('bed'),
    ) as Phaser.GameObjects.Sprite | undefined;
    if (!bed || !this.textures.exists('cato-sleep')) return;
    this.bed = bed;
    const b = bed.getBounds();
    const cx = b.centerX, bottom = b.bottom;
    // The sleep sprite (16×32) sits where the bed was, matched to its footprint width so it
    // replaces the bed cleanly. Origin bottom-centre → it stands on the bed's floor line.
    const scale = Math.max(0.5, b.width / 16);
    this.sleepCato = this.add.sprite(cx, bottom, 'cato-sleep', 0)
      .setOrigin(0.5, 1).setScale(scale).setDepth(bed.depth + 1).setVisible(false);

    // Drowsy Zzz bubble just above Cato's HEAD (mirrors the island emote bubble: speech-bubble +
    // the sleepy emoji frame). Small + close — the tail sits right over his head (~0.7 up the
    // sprite), NOT above the whole bed (which floated it into the money HUD). Built only if the
    // textures exist.
    if (this.textures.exists('speech-bubble') && this.textures.exists('emoji')) {
      const bubble = this.add.image(0, 0, 'speech-bubble').setOrigin(0.5, 1);
      const face = this.add.image(0, Math.round(-bubble.height * 0.62), 'emoji', SLEEPY_EMOJI_FRAME).setOrigin(0.5, 0.5);
      const by = bottom - this.sleepCato.displayHeight * 0.7; // tail hovers over his head
      this.sleepBubble = this.add.container(cx, by, [bubble, face])
        .setScale(scale * 0.3).setDepth(bed.depth + 2).setVisible(false);
      // Gentle breathing bob so the bubble reads as "sleeping", not a static decal.
      this.tweens.add({ targets: this.sleepBubble, y: by - 2, duration: 1600, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
    }
  }

  /** Toggle the room between its normal bed (day) and the sleeping-Cato sprite + bubble (night),
   *  reading the paused island's wall clock so inside/outside stay in sync. */
  private refreshSleep(): void {
    if (!this.bed || !this.sleepCato) return;
    const gs = this.scene.get('GameScene') as GameScene | undefined;
    const asleep = !!gs?.isSleepTime?.();
    if (asleep === this.catoAsleep) return;
    this.catoAsleep = asleep;
    this.bed.setVisible(!asleep);
    this.sleepCato.setVisible(asleep);
    this.sleepBubble?.setVisible(asleep);
  }

  update(_t: number, delta: number): void {
    // Day/night: darken the room + fade the lamp glow in with the darkness, both read live from the
    // PAUSED island's wall clock so inside and outside stay in sync.
    const gs = this.scene.get('GameScene') as GameScene | undefined;
    if (this.nightMask && gs?.currentNightTint) {
      const { color, alpha } = gs.currentNightTint();
      this.nightMask.setFillStyle(color, alpha);
      const darkness = Phaser.Math.Clamp(alpha / 0.5, 0, 1); // 0 = day (glow off) → ~1 = deep night (glow full)
      for (let i = 0; i < this.lampGlow.length; i++) this.lampGlow[i]!.setAlpha(this.lampGlowBaseAlpha[i]! * darkness);
    }
    this.refreshSleep(); // show/hide the sleeping Cato as bedtime starts/ends while inside

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
    this.hideHover(); // drop the hover frame + name while leaving
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
      playSfx(this, SFX_DOOR); // the exit door creaks open
      this.exitDoor.once(Phaser.Animations.Events.ANIMATION_COMPLETE, fadeOut);
      this.exitDoor.play({ key: 'door-open', repeat: 0 });
      this.time.delayedCall(2000, fadeOut); // safety: a missed COMPLETE event can't strand the exit
    } else {
      fadeOut();
    }
  }
}
