import Phaser from 'phaser';
import { dialogFont, t } from '../i18n';
import { getBgmVolume, setBgmVolume } from '../bgm';

/**
 * Title-screen SETTINGS overlay — a native-px scene launched ABOVE BootMenuScene
 * (the boot camera is ~3× zoomed; a separate 1:1 scene keeps the UI crisp and
 * un-scrolled). Owns a gear button (top-right) that opens a modal with the
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

export class SettingsScene extends Phaser.Scene {
  private open = false;

  // gear button
  private gear!: Phaser.GameObjects.Container;
  private gearBg!: Phaser.GameObjects.NineSlice;

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
    // ── Gear button (top-right) ──────────────────────────────────────────────
    this.gearBg = this.add.nineslice(0, 0, 'ui_big_play_button', 'button-idle', 44, 44, 18, 18, 8, 10);
    // The no-border gear is cream (same as the button) → tint it dark-brown so it reads.
    const gearIcon = this.add.sprite(0, -1, 'ui-icons', GEAR_ICON_FRAME).setScale(1.7).setTint(0x7a5a3a);
    this.gear = this.add.container(0, 0, [this.gearBg, gearIcon]).setSize(44, 44).setDepth(10);
    this.gear.setInteractive(new Phaser.Geom.Rectangle(-22, -22, 44, 44), Phaser.Geom.Rectangle.Contains, { useHandCursor: true } as Phaser.Types.Input.InputConfiguration);
    let gearPressed = false;
    this.gear.on('pointerdown', () => { gearPressed = true; this.gearBg.setTexture('ui_big_play_button', 'button-pressed-down'); });
    this.gear.on('pointerup', () => { if (gearPressed) { gearPressed = false; this.gearBg.setTexture('ui_big_play_button', 'button-idle'); this.toggle(); } });
    this.gear.on('pointerout', () => { gearPressed = false; this.gearBg.setTexture('ui_big_play_button', 'button-idle'); });

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

    // Gear top-right (a comfortable margin in from the corner).
    this.gear.setPosition(W - 40, 40);

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
