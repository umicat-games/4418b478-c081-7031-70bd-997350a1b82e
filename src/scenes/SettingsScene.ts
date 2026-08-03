import Phaser from 'phaser';
import { dialogFont, t } from '../i18n';
import { getBgmVolume, setBgmVolume } from '../bgm';
import type { BootMenuScene } from './BootMenuScene';

/**
 * Title-screen SETTINGS overlay — a native-px scene launched ABOVE BootMenuScene
 * (the boot camera is ~3× zoomed; a separate 1:1 scene keeps the UI crisp and
 * un-scrolled). Owns a **"Settings" button styled like Play** (the EMPTY
 * `button-idle` variant of the same `ui_big_play_button` sheet, with a gear icon +
 * "Settings" text), placed directly BELOW the Play button (aligned by projecting
 * BootMenuScene's Play entity to screen). Clicking it opens a modal with the
 * `setting_menu` panel + a Music volume slider (the `ui_settings_buttons` tick
 * segments + `<>` knob). The boot screen never pointer-locks, so this handles its
 * own pointer input directly (no GameScene-style cross-scene routing).
 *
 * Volume is global + persisted in `src/bgm.ts` (localStorage), so it survives the
 * title→game switch and applies live to whichever BGM track is playing.
 *
 * Assets (BootScene): `settings-menu` atlas (`settings-panel` = the SETTINGS-baked
 * rounded panel), `settings-buttons` atlas (`slider-tick-on`/`-off`/`slider-knob`),
 * `ui_big_play_button` atlas (`button-idle`/`button-pressed-down` nine-slice, loaded
 * by BootMenuScene's world scene — textures are global), `ui-icons` sheet (frame 4
 * = the border-less gear icon).
 */
const PANEL_W = 106;
const PANEL_H = 122;
const GEAR_ICON_FRAME = 4; // all_icons `setting-icon-no-border` (64,0,16,16) → 16px-grid frame 4
const SLIDER_N = 10; // number of tick segments
const PLAY_FRAME_W = 90; // `play-light-bg` native size — the on-screen ref for matching Play
const PLAY_FRAME_H = 27;

export class SettingsScene extends Phaser.Scene {
  private open = false;

  // "Settings" button (styled like Play, below it). btnBg is a PLAIN IMAGE scaled by
  // the same factor as Play (not a nine-slice) so its border pixels are the same
  // chunky size as Play's — a nine-slice keeps corners at 1:1 → a thinner border.
  private btn!: Phaser.GameObjects.Container;
  private btnBg!: Phaser.GameObjects.Image;
  private btnIcon!: Phaser.GameObjects.Sprite;
  private btnText!: Phaser.GameObjects.Text;

  // modal
  private modal!: Phaser.GameObjects.Container;
  private dim!: Phaser.GameObjects.Rectangle;
  private panel!: Phaser.GameObjects.Image;
  private label!: Phaser.GameObjects.Text;
  private ticks: Phaser.GameObjects.Image[] = [];
  private knob!: Phaser.GameObjects.Image;
  private sliderHit!: Phaser.GameObjects.Rectangle;

  // slider geometry (screen px), recomputed in layout()
  private trackLeft = 0;
  private trackW = 0;
  private dragging = false;

  constructor() {
    super({ key: 'SettingsScene' });
  }

  create(): void {
    // ── "Settings" button — the EMPTY `button-idle` from ui_big_play_button (the
    //    user-tagged empty twin of Play), a plain scaled image + gear icon + text,
    //    placed below the Play button (positioned in layout()). ─────────────────
    this.btnBg = this.add.image(0, 0, 'ui_big_play_button', 'button-idle');
    // The no-border gear + the label are both dark-brown to match Play's "PLAY" art.
    this.btnIcon = this.add.sprite(0, 0, 'ui-icons', GEAR_ICON_FRAME).setTint(0x9a6a3f);
    this.btnText = this.add.text(0, 0, t('tab_settings'), { fontFamily: dialogFont(), color: '#9a6a3f' }).setOrigin(0, 0.5);
    this.btn = this.add.container(0, 0, [this.btnBg, this.btnIcon, this.btnText]).setDepth(10);
    let btnPressed = false;
    const setBtnFrame = (on: boolean): void => this.btnBg.setTexture('ui_big_play_button', on ? 'button-pressed-down' : 'button-idle');
    // hit area set in layout() (depends on the button's on-screen size)
    this.btn.on('pointerover', () => { if (!btnPressed) this.btn.setScale(1.05); });
    this.btn.on('pointerout', () => { btnPressed = false; setBtnFrame(false); this.btn.setScale(1); });
    this.btn.on('pointerdown', () => { btnPressed = true; setBtnFrame(true); });
    this.btn.on('pointerup', () => { if (btnPressed) { btnPressed = false; setBtnFrame(false); this.btn.setScale(1); this.toggle(); } });

    // ── Modal (dim + panel + slider), hidden until opened ────────────────────
    this.dim = this.add.rectangle(0, 0, 10, 10, 0x14212e, 0.55).setOrigin(0, 0).setInteractive();
    this.dim.on('pointerdown', () => this.close()); // tap outside the panel closes
    this.panel = this.add.image(0, 0, 'settings-menu', 'settings-panel').setInteractive(); // swallow taps on the panel
    this.panel.on('pointerdown', (p: Phaser.Input.Pointer, _lx: number, _ly: number, ev: Phaser.Types.Input.EventData) => ev.stopPropagation());
    this.label = this.add.text(0, 0, t('settings_music'), { fontFamily: dialogFont(), color: '#ffffff' }).setOrigin(0, 0.5);

    this.ticks = [];
    for (let i = 0; i < SLIDER_N; i++) {
      this.ticks.push(this.add.image(0, 0, 'settings-buttons', 'slider-tick-off').setOrigin(0.5, 0.5));
    }
    this.knob = this.add.image(0, 0, 'settings-buttons', 'slider-knob').setOrigin(0.5, 0.5);
    this.sliderHit = this.add.rectangle(0, 0, 10, 10, 0xffffff, 0).setOrigin(0.5, 0.5).setInteractive({ useHandCursor: true });
    this.sliderHit.on('pointerdown', (p: Phaser.Input.Pointer, _lx: number, _ly: number, ev: Phaser.Types.Input.EventData) => {
      ev.stopPropagation();
      this.dragging = true;
      this.setVolFromX(p.x);
    });
    this.input.on(Phaser.Input.Events.POINTER_MOVE, (p: Phaser.Input.Pointer) => { if (this.dragging) this.setVolFromX(p.x); });
    this.input.on(Phaser.Input.Events.POINTER_UP, () => { this.dragging = false; });

    this.modal = this.add.container(0, 0, [this.dim, this.panel, this.label, ...this.ticks, this.knob, this.sliderHit]).setDepth(20).setVisible(false);

    this.input.keyboard?.on('keydown-ESC', () => { if (this.open) this.close(); });

    this.layout();
    this.scale.on(Phaser.Scale.Events.RESIZE, this.layout, this);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.scale.off(Phaser.Scale.Events.RESIZE, this.layout, this);
    });
  }

  private layout = (): void => {
    const W = this.scale.width;
    const H = this.scale.height;

    this.positionButton(W, H);

    // Panel scale to fit the screen, min 2× so it never renders sub-native.
    const ps = Math.max(2, Math.min((W * 0.5) / PANEL_W, (H * 0.62) / PANEL_H));
    const panelW = PANEL_W * ps;
    const panelH = PANEL_H * ps;
    const panelLeft = W / 2 - panelW / 2;
    const panelTop = H / 2 - panelH / 2;

    this.dim.setPosition(0, 0).setSize(W, H);
    this.panel.setPosition(W / 2, H / 2).setDisplaySize(panelW, panelH);

    // Music row — panel-local y≈82 of 122 (below the baked SETTINGS title + underline).
    const rowY = panelTop + 82 * ps;
    this.label.setPosition(panelLeft + 14 * ps, rowY).setFontSize(Math.round(11 * ps));

    // Slider track: from x≈50 (right of the label, clear of the knob at vol 0) to
    // x≈96 (panel-local, of 106 — a hair of clearance from the rounded edge).
    this.trackLeft = panelLeft + 50 * ps;
    const trackRight = panelLeft + 96 * ps;
    this.trackW = trackRight - this.trackLeft;
    const pitch = this.trackW / SLIDER_N;
    const tickScale = (pitch * 0.62) / 4; // tick native w=4
    for (let i = 0; i < SLIDER_N; i++) {
      this.ticks[i].setScale(tickScale).setPosition(this.trackLeft + (i + 0.5) * pitch, rowY);
    }
    this.knob.setScale(tickScale * 1.2).setPosition(this.trackLeft, rowY);
    this.sliderHit.setPosition((this.trackLeft + trackRight) / 2, rowY).setSize(this.trackW + pitch, 30 * ps);
    this.sliderHit.input && (this.sliderHit.input.hitArea = new Phaser.Geom.Rectangle(0, 0, this.trackW + pitch, 30 * ps));

    this.renderVol(getBgmVolume());
  };

  /** Place the "Settings" button directly BELOW the Play button, at Play's on-screen
   *  size (Play lives in BootMenuScene's ~3× world → project it to screen px). Falls
   *  back to bottom-centre if the Play entity is missing. */
  private positionButton(W: number, H: number): void {
    let cx = W / 2;
    let s: number; // the on-screen scale to draw the empty button at (== Play's)
    let topY: number; // top edge of where the settings button should sit

    const boot = this.scene.get('BootMenuScene') as BootMenuScene | undefined;
    const play = boot?.playButton;
    if (boot && play && play.active) {
      const cam = boot.cameras.main;
      const z = cam.zoom;
      // SAME on-screen pixel density as Play → the button borders look identical.
      s = z * boot.playBaseScale;
      const wH = (play.frame?.realHeight ?? PLAY_FRAME_H) * boot.playBaseScale;
      cx = (play.x - cam.worldView.x) * z;
      const playBottomWorld = play.y + wH * (1 - play.originY);
      topY = (playBottomWorld - cam.worldView.y) * z + wH * 0.28 * z; // Play bottom + a gap
    } else {
      s = Math.min((W * 0.26) / 96, (H * 0.1) / 32);
      topY = H * 0.74;
    }

    // The empty button drawn exactly like Play: a plain image at Play's scale.
    this.btnBg.setScale(s);
    const bw = this.btnBg.displayWidth; // 96 * s
    const bh = this.btnBg.displayHeight; // 32 * s
    const cy = topY + bh / 2;
    this.btn.setPosition(cx, cy);

    // Centre the icon+text on the button FACE. The `button-idle` art is opaque rows
    // 2..28 of 32 (a thin bottom shadow), so the face centre is row ~15 — and matching
    // Play's "PLAY" baked at row ~14/32 lands the label ~2 native px above image centre.
    const faceY = -(2 / 32) * bh;
    const iconH = bh * 0.42;
    this.btnIcon.setScale(iconH / 16);
    this.btnText.setFontSize(Math.round(bh * 0.34));
    const iconW = 16 * this.btnIcon.scaleX;
    const gap = bh * 0.1;
    const totalW = iconW + gap + this.btnText.width;
    const startX = -totalW / 2;
    this.btnIcon.setPosition(startX + iconW / 2, faceY);
    this.btnText.setPosition(startX + iconW + gap, faceY);

    this.btn.setSize(bw, bh);
    this.btn.setInteractive(new Phaser.Geom.Rectangle(-bw / 2, -bh / 2, bw, bh), Phaser.Geom.Rectangle.Contains, { useHandCursor: true } as Phaser.Types.Input.InputConfiguration);
  }

  private setVolFromX(px: number): void {
    const vol = Phaser.Math.Clamp((px - this.trackLeft) / this.trackW, 0, 1);
    setBgmVolume(this, vol);
    this.renderVol(vol);
  }

  /** Update the tick fill + knob position for a volume (no side effects). */
  private renderVol(vol: number): void {
    const knobX = this.trackLeft + vol * this.trackW;
    this.knob.setX(knobX);
    for (let i = 0; i < SLIDER_N; i++) {
      const on = this.ticks[i].x <= knobX + 0.5;
      this.ticks[i].setFrame(on ? 'slider-tick-on' : 'slider-tick-off');
    }
  }

  private toggle(): void { this.open ? this.close() : this.openModal(); }

  private openModal(): void {
    this.open = true;
    this.renderVol(getBgmVolume());
    this.modal.setVisible(true);
    // Block the boot screen below (its Play button lives in BootMenuScene, a
    // separate scene whose input would otherwise still fire under the dim).
    const boot = this.scene.get('BootMenuScene');
    if (boot) boot.input.enabled = false;
  }

  private close(): void {
    if (!this.open) return;
    this.open = false;
    this.dragging = false;
    this.modal.setVisible(false);
    const boot = this.scene.get('BootMenuScene');
    if (boot) boot.input.enabled = true;
  }
}
