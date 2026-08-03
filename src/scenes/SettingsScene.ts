import Phaser from 'phaser';
import { dialogFont, t } from '../i18n';
import { getBgmVolume, setBgmVolume } from '../bgm';
import type { BootMenuScene } from './BootMenuScene';

/**
 * Title-screen menu overlay — a native-px scene launched ABOVE BootMenuScene (the
 * boot camera is ~3× zoomed; a separate 1:1 scene keeps the UI + text crisp and
 * un-scrolled). Owns BOTH title buttons, built the SAME way (`buildButton`): the
 * EMPTY `button-idle` frame of `ui_big_play_button` as a plain scaled image (so the
 * border pixels match at Play's density) + a `ui-icons` icon + a zpix text label —
 * **Play** (triangle + "PLAY" → starts the game) and **Settings** (gear + "Settings"
 * → opens the volume modal), stacked. Unifying their construction keeps the icon +
 * font identical (the old Play used baked "▶ PLAY" art in a different pixel font).
 *
 * Both are positioned off BootMenuScene's authored `play-button` entity (kept as an
 * invisible position ANCHOR so the creator can still move it in the editor): its
 * world rect is projected to screen and Play is drawn there, Settings just below.
 *
 * The boot screen never pointer-locks, so this handles its own pointer input
 * directly. The volume modal (`setting_menu` panel + a Music slider — the
 * `ui_settings_buttons` tick segments + `<>` knob) sits above the buttons; its dim
 * (same scene, higher depth) blocks them while open. Volume is global + persisted in
 * `src/bgm.ts` (localStorage), so it survives the title→game switch and applies live.
 */
const PANEL_W = 106;
const PANEL_H = 122;
const ICON_KEY = 'ui-icons';
const GEAR_ICON_FRAME = 4; // all_icons `setting-icon-no-border` (64,0,16,16) → 16px-grid frame 4
const PLAY_ICON_FRAME = 57; // all_icons `play-brown` triangle (144,48) → 16px-grid frame 3*16+9
const LABEL_COLOR = '#9a6a3f'; // dark-brown, reads on the cream button (matches Play's art)
const LABEL_TINT = 0x9a6a3f;
const SLIDER_N = 10; // number of tick segments

interface UiButton {
  container: Phaser.GameObjects.Container;
  bg: Phaser.GameObjects.Image;
  icon: Phaser.GameObjects.Sprite;
  text: Phaser.GameObjects.Text;
}

export class SettingsScene extends Phaser.Scene {
  private open = false;

  private playBtn!: UiButton;
  private setBtn!: UiButton;

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
    // ── The two title buttons (same construction) ────────────────────────────
    this.playBtn = this.buildButton(PLAY_ICON_FRAME, t('start_play'), () => this.startGame());
    this.setBtn = this.buildButton(GEAR_ICON_FRAME, t('tab_settings'), () => this.toggle());

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

  /** One title button: the EMPTY `button-idle` bg (plain scaled image) + an icon + a
   *  zpix label, with hover-grow + press (pressed-down frame + shrink) feedback. Sized
   *  and positioned in `styleButton`/`layout`. */
  private buildButton(iconFrame: number, label: string, onTap: () => void): UiButton {
    const bg = this.add.image(0, 0, 'ui_big_play_button', 'button-idle');
    const icon = this.add.sprite(0, 0, ICON_KEY, iconFrame).setTint(LABEL_TINT);
    const text = this.add.text(0, 0, label, { fontFamily: dialogFont(), color: LABEL_COLOR, fontStyle: 'bold' }).setOrigin(0, 0.5);
    const container = this.add.container(0, 0, [bg, icon, text]).setDepth(10);
    let pressed = false;
    const setFrame = (on: boolean): void => bg.setTexture('ui_big_play_button', on ? 'button-pressed-down' : 'button-idle');
    container.on('pointerover', () => { if (!pressed) container.setScale(1.05); });
    container.on('pointerout', () => { pressed = false; setFrame(false); container.setScale(1); });
    container.on('pointerdown', () => { pressed = true; setFrame(true); container.setScale(0.97); });
    container.on('pointerup', () => { if (pressed) { pressed = false; setFrame(false); container.setScale(1); onTap(); } });
    return { container, bg, icon, text };
  }

  /** Draw a button at scale `s` (== Play's on-screen density) with its icon+text
   *  centred on the button FACE, and refresh its hit area. Returns the on-screen size. */
  private styleButton(b: UiButton, s: number): { bw: number; bh: number } {
    b.bg.setScale(s);
    const bw = b.bg.displayWidth; // 96 * s
    const bh = b.bg.displayHeight; // 32 * s
    // `button-idle` is opaque rows 2..28 of 32 (a thin bottom shadow) — the face
    // centre is row ~15, so the label sits ~2 native px above the image centre.
    const faceY = -(2 / 32) * bh;
    const iconH = bh * 0.42;
    b.icon.setScale(iconH / 16);
    b.text.setFontSize(Math.round(bh * 0.34));
    // zpix has no real bold weight (faux-bold barely renders), so thicken the glyphs
    // with a matching-colour stroke sized to the font — a crisp "bold" for pixel text.
    b.text.setStroke(LABEL_COLOR, Math.max(1, bh * 0.028));
    const iconW = 16 * b.icon.scaleX;
    const gap = bh * 0.1;
    const totalW = iconW + gap + b.text.width;
    const startX = -totalW / 2;
    b.icon.setPosition(startX + iconW / 2, faceY);
    b.text.setPosition(startX + iconW + gap, faceY);
    b.container.setSize(bw, bh);
    b.container.setInteractive(new Phaser.Geom.Rectangle(-bw / 2, -bh / 2, bw, bh), Phaser.Geom.Rectangle.Contains, { useHandCursor: true } as Phaser.Types.Input.InputConfiguration);
    return { bw, bh };
  }

  private layout = (): void => {
    const W = this.scale.width;
    const H = this.scale.height;

    this.positionButtons(W, H);

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

  /** Place Play at the authored anchor's projected screen position + Settings just
   *  below, both at the anchor's on-screen scale. Falls back to bottom-centre. */
  private positionButtons(W: number, H: number): void {
    let cx = W / 2;
    let s: number; // the on-screen scale to draw the empty buttons at (== the anchor's)
    let playCY: number; // Play button centre Y (screen)

    const boot = this.scene.get('BootMenuScene') as BootMenuScene | undefined;
    const play = boot?.playButton;
    if (boot && play) {
      const cam = boot.cameras.main;
      const z = cam.zoom;
      s = z * boot.playBaseScale;
      cx = (play.x - cam.worldView.x) * z;
      playCY = (play.y - cam.worldView.y) * z;
    } else {
      s = Math.min((W * 0.26) / 96, (H * 0.1) / 32);
      playCY = H * 0.62;
    }

    const { bh } = this.styleButton(this.playBtn, s);
    this.playBtn.container.setPosition(cx, playCY);

    this.styleButton(this.setBtn, s);
    this.setBtn.container.setPosition(cx, playCY + bh + bh * 0.28); // Play below-edge + gap + Settings half
  }

  private startGame(): void {
    const boot = this.scene.get('BootMenuScene') as BootMenuScene | undefined;
    boot?.startGame();
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
  }

  private close(): void {
    if (!this.open) return;
    this.open = false;
    this.dragging = false;
    this.modal.setVisible(false);
  }
}
