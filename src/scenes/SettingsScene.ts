import Phaser from 'phaser';
import { dialogFont, t, getLang, setLang, supportedLangs, langDisplayName, type Lang } from '../i18n';
import { getBgmVolume, setBgmVolume } from '../bgm';
import { playSfx, getSfxVolume, setSfxVolume, SFX_SCROLL } from '../sfx';
import type { BootMenuScene } from './BootMenuScene';

/** One volume slider in the title modal (Music or SFX). */
interface Slider {
  panelY: number;                                   // panel-local y (of 122)
  labelKey: string;                                 // i18n key (re-fetched on a language switch)
  get: () => number;                                // current volume
  set: (scene: Phaser.Scene, v: number) => void;    // setBgmVolume / setSfxVolume
  labelText: Phaser.GameObjects.Text;
  ticks: Phaser.GameObjects.Image[];
  knob: Phaser.GameObjects.Image;
  hit: Phaser.GameObjects.Rectangle;
  trackLeft: number;
  trackW: number;
  step: number;                                     // last tick-step (for the scrub sound)
}

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
const LANG_ARROW_FRAME = 217; // all_icons `play-brown-with-border` (144,208) → 16px-grid frame 13*16+9
const LABEL_COLOR = '#9a6a3f'; // dark-brown, reads on the cream button (matches Play's art)
const LABEL_TINT = 0x9a6a3f;
const ROW_TEXT_COLOR = '#ffffff'; // slider/row labels — white on the panel's inset
const SLIDER_N = 10; // number of tick segments
// Three stacked rows in the panel (below the baked SETTINGS title), panel-local Y of 122.
const LANG_ROW_Y = 50;
const MUSIC_ROW_Y = 78;
const SFX_ROW_Y = 106;

interface UiButton {
  container: Phaser.GameObjects.Container;
  bg: Phaser.GameObjects.Image;
  icon: Phaser.GameObjects.Sprite;
  text: Phaser.GameObjects.Text;
  pressed: boolean;   // held down right now (icon+text drop with the pressed-face art)
  faceY: number;      // idle face-centre y (container-local); set in styleButton
  pressDepth: number; // px the face sinks when pressed — icon+text drop by this so they track the art
}

export class SettingsScene extends Phaser.Scene {
  private open = false;

  private playBtn!: UiButton;
  private setBtn!: UiButton;

  // modal
  private modal!: Phaser.GameObjects.Container;
  private dim!: Phaser.GameObjects.Rectangle;
  private panel!: Phaser.GameObjects.Image;
  // Two volume sliders (Music + SFX); geometry recomputed in layout().
  private sliders: Slider[] = [];
  private dragSlider: Slider | null = null;

  // Language selector row: "Language"  ◄ [中文/English] ►
  private langLabelText!: Phaser.GameObjects.Text;
  private langValueText!: Phaser.GameObjects.Text;
  private langLeft!: Phaser.GameObjects.Image;   // ◄ = the arrow icon flipped
  private langRight!: Phaser.GameObjects.Image;  // ►

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

    // Language row (top), then two sliders stacked below (Music above, SFX below).
    this.buildLangRow();
    this.sliders = [
      this.makeSlider('settings_music', MUSIC_ROW_Y, getBgmVolume, (sc, v) => setBgmVolume(sc, v)),
      this.makeSlider('settings_sfx', SFX_ROW_Y, getSfxVolume, (sc, v) => setSfxVolume(sc, v)),
    ];
    this.input.on(Phaser.Input.Events.POINTER_MOVE, (p: Phaser.Input.Pointer) => { if (this.dragSlider) this.setVolFromX(this.dragSlider, p.x); });
    this.input.on(Phaser.Input.Events.POINTER_UP, () => { this.dragSlider = null; });

    const parts: Phaser.GameObjects.GameObject[] = [this.dim, this.panel, this.langLabelText, this.langLeft, this.langRight, this.langValueText];
    for (const s of this.sliders) parts.push(s.labelText, ...s.ticks, s.knob, s.hit);
    this.modal = this.add.container(0, 0, parts).setDepth(20).setVisible(false);

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
    // The BG image is the interactive object (its frame gives a reliable auto hit area
    // = the whole button). A manual hitArea on the CONTAINER was subtly broken — Phaser
    // only registered the LEFT half (the right half read as no-hit), so the button was
    // "hard to click". Icon/text are non-interactive children on top; clicks fall
    // through them to the bg underneath, so the WHOLE button responds.
    const bg = this.add.image(0, 0, 'ui_big_play_button', 'button-idle').setInteractive({ useHandCursor: true });
    const icon = this.add.sprite(0, 0, ICON_KEY, iconFrame).setTint(LABEL_TINT);
    const text = this.add.text(0, 0, label, { fontFamily: dialogFont(), color: LABEL_COLOR, fontStyle: 'bold' }).setOrigin(0, 0.5);
    const container = this.add.container(0, 0, [bg, icon, text]).setDepth(10);
    const b: UiButton = { container, bg, icon, text, pressed: false, faceY: 0, pressDepth: 0 };
    // Press feedback = the pressed-down FRAME + drop the icon+text by the SAME amount the
    // art's face sinks (pressDepth), so the label looks pressed WITH the button instead of
    // floating on the old face. (No press-shrink — scaling would shrink the hit area and
    // drop edge taps.) Hover grows the container (enlarges the hit area, fine).
    const setPressed = (on: boolean): void => {
      b.pressed = on;
      bg.setTexture('ui_big_play_button', on ? 'button-pressed-down' : 'button-idle');
      this.positionContent(b);
    };
    const release = (over: boolean): void => { if (!b.pressed) return; setPressed(false); container.setScale(1); if (over) { playSfx(this); onTap(); } };
    bg.on('pointerover', () => { if (!b.pressed) container.setScale(1.05); });
    bg.on('pointerout', () => { if (b.pressed) setPressed(false); container.setScale(1); });
    bg.on('pointerdown', () => setPressed(true));
    bg.on('pointerup', () => release(true));
    bg.on('pointerupoutside', () => release(true));
    return b;
  }

  /** Drop the icon+text to the current face line (down by pressDepth while held). X is
   *  fixed by styleButton; only the vertical face-tracking changes on press. */
  private positionContent(b: UiButton): void {
    const dy = b.faceY + (b.pressed ? b.pressDepth : 0);
    b.icon.setY(dy);
    b.text.setY(dy);
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
    // The pressed-down art's face centre sits 2 native px LOWER than idle (idle face
    // row 14 → pressed row 16; ninePatch topHeight 8→10). Drop icon+text by that so the
    // label presses WITH the button instead of floating on the idle face.
    b.faceY = faceY;
    b.pressDepth = (2 / 32) * bh;
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
    const dy = faceY + (b.pressed ? b.pressDepth : 0);
    b.icon.setPosition(startX + iconW / 2, dy);
    b.text.setPosition(startX + iconW + gap, dy);
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

    // Each slider row: label at panel-local x≈14, track x≈50→96 (of 106), at its
    // own panel-local y (below the baked SETTINGS title + underline).
    for (const s of this.sliders) {
      const rowY = panelTop + s.panelY * ps;
      s.labelText.setPosition(panelLeft + 14 * ps, rowY).setFontSize(Math.round(10 * ps));
      s.trackLeft = panelLeft + 50 * ps;
      const trackRight = panelLeft + 96 * ps;
      s.trackW = trackRight - s.trackLeft;
      const pitch = s.trackW / SLIDER_N;
      const tickScale = (pitch * 0.62) / 4; // tick native w=4
      s.ticks.forEach((tk, i) => tk.setScale(tickScale).setPosition(s.trackLeft + (i + 0.5) * pitch, rowY));
      s.knob.setScale(tickScale * 0.75).setPosition(s.trackLeft, rowY); // 14×21 knob → ~1.3× tick height (was ×1.2 = oversized)
      const hitH = 26 * ps;
      s.hit.setPosition((s.trackLeft + trackRight) / 2, rowY).setSize(s.trackW + pitch, hitH);
      s.hit.input && (s.hit.input.hitArea = new Phaser.Geom.Rectangle(0, 0, s.trackW + pitch, hitH));
      this.renderVol(s);
    }

    // Language row — label on the left, a ◄ value ► stepper on the right. The panel is
    // only 106 native wide and "Language" is a long word, so the row uses a smaller font
    // and the arrows HUG the value text (gap from its measured width) so nothing overlaps
    // whatever the language name's length.
    const lrY = panelTop + LANG_ROW_Y * ps;
    this.langLabelText.setPosition(panelLeft + 11 * ps, lrY).setFontSize(Math.round(7 * ps));
    // Stepper anchored to the panel's RIGHT edge and grown leftward, so the wide English
    // value never pushes its left arrow back into the (long) "Language" label.
    const arrowScale = (8 * ps) / 16;
    const aHalf = (16 * arrowScale) / 2;
    const gap = 3 * ps;
    const rightX = panelLeft + 98 * ps; // ► near the panel's right edge
    this.langRight.setScale(arrowScale).setPosition(rightX, lrY);
    this.langValueText.setFontSize(Math.round(7 * ps)).setOrigin(1, 0.5).setPosition(rightX - aHalf - gap, lrY);
    this.langLeft.setScale(arrowScale).setPosition(this.langValueText.x - this.langValueText.displayWidth - gap - aHalf, lrY);
  };

  /** Build one slider (label + N ticks + knob + a transparent drag hit-rect). */
  private makeSlider(labelKey: string, panelY: number, get: () => number, set: (scene: Phaser.Scene, v: number) => void): Slider {
    const labelText = this.add.text(0, 0, t(labelKey), { fontFamily: dialogFont(), color: '#ffffff' }).setOrigin(0, 0.5);
    const ticks: Phaser.GameObjects.Image[] = [];
    for (let i = 0; i < SLIDER_N; i++) ticks.push(this.add.image(0, 0, 'settings-buttons', 'slider-tick-off').setOrigin(0.5, 0.5));
    const knob = this.add.image(0, 0, 'settings-buttons', 'slider-knob').setOrigin(0.5, 0.5);
    const hit = this.add.rectangle(0, 0, 10, 10, 0xffffff, 0).setOrigin(0.5, 0.5).setInteractive({ useHandCursor: true });
    const s: Slider = { panelY, labelKey, get, set, labelText, ticks, knob, hit, trackLeft: 0, trackW: 0, step: -1 };
    hit.on('pointerdown', (p: Phaser.Input.Pointer, _lx: number, _ly: number, ev: Phaser.Types.Input.EventData) => {
      ev.stopPropagation();
      this.dragSlider = s;
      s.step = -1;
      this.setVolFromX(s, p.x);
    });
    return s;
  }

  /** Build the language row: a "Language" label + a ◄ value ► stepper. The arrows are
   *  the `play-brown-with-border` icon (► as-is, ◄ = flipped); tapping either cycles
   *  through the shipped languages, switching live + persisting. */
  private buildLangRow(): void {
    this.langLabelText = this.add.text(0, 0, t('settings_language'), { fontFamily: dialogFont(), color: ROW_TEXT_COLOR }).setOrigin(0, 0.5);
    this.langValueText = this.add.text(0, 0, langDisplayName(getLang()), { fontFamily: dialogFont(), color: ROW_TEXT_COLOR }).setOrigin(0.5, 0.5);
    this.langLeft = this.add.image(0, 0, ICON_KEY, LANG_ARROW_FRAME).setOrigin(0.5, 0.5).setFlipX(true).setInteractive({ useHandCursor: true });
    this.langRight = this.add.image(0, 0, ICON_KEY, LANG_ARROW_FRAME).setOrigin(0.5, 0.5).setInteractive({ useHandCursor: true });
    const stop = (ev: Phaser.Types.Input.EventData): void => ev.stopPropagation(); // don't close the modal
    this.langLeft.on('pointerdown', (_p: Phaser.Input.Pointer, _x: number, _y: number, ev: Phaser.Types.Input.EventData) => { stop(ev); this.cycleLang(-1); });
    this.langRight.on('pointerdown', (_p: Phaser.Input.Pointer, _x: number, _y: number, ev: Phaser.Types.Input.EventData) => { stop(ev); this.cycleLang(1); });
  }

  /** Step the language by `dir` (wraps), switch live + persist, refresh all visible text. */
  private cycleLang(dir: number): void {
    const langs = supportedLangs();
    const cur = langs.indexOf(getLang());
    const next = langs[(cur + dir + langs.length) % langs.length] as Lang;
    if (next === getLang()) return;
    setLang(next);
    playSfx(this);
    this.refreshTexts();
  }

  /** Re-fetch every visible label in the (new) language + reflow (widths changed). */
  private refreshTexts(): void {
    this.playBtn.text.setText(t('start_play'));
    this.setBtn.text.setText(t('tab_settings'));
    this.langLabelText.setText(t('settings_language'));
    this.langValueText.setText(langDisplayName(getLang()));
    for (const s of this.sliders) s.labelText.setText(t(s.labelKey));
    this.layout();
  }

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

  private setVolFromX(s: Slider, px: number): void {
    const vol = Phaser.Math.Clamp((px - s.trackLeft) / s.trackW, 0, 1);
    s.set(this, vol);       // setBgmVolume / setSfxVolume (updates the live level first)
    this.renderVol(s);
    // Scrub tick — play `sfx-scroll` once per tick-step crossed while dragging (so a
    // full sweep plays ~N blips, a ratchet feel; the SFX slider is heard at its new level).
    const step = Math.round(vol * SLIDER_N);
    if (step !== s.step) { s.step = step; playSfx(this, SFX_SCROLL); }
  }

  /** Update a slider's tick fill + knob position from its current value (no side effects). */
  private renderVol(s: Slider): void {
    const vol = s.get();
    const knobX = s.trackLeft + vol * s.trackW;
    s.knob.setX(knobX);
    for (const tk of s.ticks) tk.setFrame(tk.x <= knobX + 0.5 ? 'slider-tick-on' : 'slider-tick-off');
  }

  private toggle(): void { this.open ? this.close() : this.openModal(); }

  private openModal(): void {
    this.open = true;
    for (const s of this.sliders) this.renderVol(s);
    this.langValueText.setText(langDisplayName(getLang())); // reflect any external change
    this.modal.setVisible(true);
  }

  private close(): void {
    if (!this.open) return;
    this.open = false;
    this.dragSlider = null;
    this.modal.setVisible(false);
  }
}
