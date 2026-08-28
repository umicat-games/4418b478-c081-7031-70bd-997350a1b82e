import Phaser from 'phaser';

/**
 * Top-left weather / time-of-day / money HUD, rendered in its OWN scene (like
 * HotbarScene) so it sits at native canvas resolution — unzoomed + unscrolled by
 * the world camera. GameScene owns the MODEL (which weather icon, the time-of-day
 * pointer step, the coin balance) and publishes it to the registry under
 * `weatherHud`; this scene just draws it.
 *
 * Uses the BIG frame set (nicer + a finer 5-step pointer) at the hotbar's ×2 scale
 * (×3 read too large): `weather-frame-big`, `time-bg`, `arrow-big-1..5` (morning ↗
 * → midday → → evening ↘), `balance-frame-big` — plus `weather-icons` (`sunny`…)
 * and `coins` (`coin-…`). All loaded as atlases in BootScene. (The `*-small` set is
 * also tagged in the atlas if a smaller look is wanted; just swap the frames + S.)
 */
export interface WeatherModel {
  visible: boolean;
  bgFrame: string; // time-tinted window background (`background-morning|noon|night`)
  weatherFrame: string; // transparent weather icon drawn on top (`*-no-bg`)
  pointerStep: number; // 1..5 → arrow-big-1..5
  money: number; // coin balance (formatted with thousands separators here)
  timeLabel: string; // current wall-clock time, e.g. "09:30am" (ADR-029)
  rev: number; // bumped by GameScene on any change → re-render
}

const S = 1.5; // HUD scale (frame 92×50 → 138×75). NB non-integer → slightly soft pixels.
const AX = 16, AY = 14; // frame top-left (canvas px)
const cx = (nx: number) => AX + nx * S;
const cy = (ny: number) => AY + ny * S;
const WEATHER_C = { x: cx(25), y: cy(25) }; // left window centre (native 8,8,34×34)
const TIME_C = { x: cx(62), y: cy(25) }; // right window centre
const BAR_X = AX + 86 * S; // tucked a few px behind the frame's right edge → they connect
const BAR_CY = AY + 12 * S; // bar's vertical centre when TOP-aligned to the frame (24 tall)
const BAR_TEX_W = 110; // nine-slice texture width (× S = final bar width)
// The pointer rotates around the raised BUMP on the divider (frame native 53,25), NOT
// the window centre. Each arrow frame is cropped tight so its knob (tail) sits at a
// different spot — anchor each by its knob (normalised) so the tail stays on the bump
// as it sweeps (else the tail wanders for the up/down arrows).
const PIVOT = { x: cx(53), y: cy(25) };
const ARROW_ORIGINS = [
  { x: 0.154, y: 0.692 }, // arrow-big-1 (morning ↗)
  { x: 0.133, y: 0.667 }, // arrow-big-2
  { x: 0.188, y: 0.417 }, // arrow-big-3 (midday →)
  { x: 0.133, y: 0.25 }, // arrow-big-4
  { x: 0.231, y: 0.154 }, // arrow-big-5 (evening ↘)
];

export class WeatherScene extends Phaser.Scene {
  private container?: Phaser.GameObjects.Container;
  private lastRev = -1;

  constructor() {
    super({ key: 'WeatherScene' });
  }

  create(): void {
    this.container = this.add.container(0, 0);
    this.render();
    this.registry.events.on('changedata-weatherHud', () => this.render());
    this.scale.on('resize', () => this.render());
  }

  private render(): void {
    const m = this.registry.get('weatherHud') as WeatherModel | undefined;
    if (!m || !this.container) return;
    if (m.rev === this.lastRev) return;
    this.lastRev = m.rev;
    this.container.removeAll(true);
    this.container.setVisible(m.visible);
    if (!m.visible) return;

    // Coin bar — TOP-aligned to the frame + tucked behind its right edge (drawn before
    // the frame so the frame's border/leaf overlaps the bar's left → they read connected).
    const bar = this.add
      .nineslice(BAR_X, AY, 'weather-ui', 'balance-frame-big', BAR_TEX_W, 24, 14, 14, 11, 11)
      .setOrigin(0, 0)
      .setScale(S);
    // Coin: sized so the whole 16px region (incl. its white border) fits inside the
    // 24×S-tall bar with a small margin — 28×S overflowed the bar (the border poked out).
    const coin = this.add
      .image(BAR_X + 20 * S, BAR_CY, 'coins', 'coin-white-border-shadow-below')
      .setOrigin(0.5)
      .setDisplaySize(20 * S, 20 * S);
    const money = this.add
      .text(BAR_X + (BAR_TEX_W - 8) * S, BAR_CY, m.money.toLocaleString('en-US'), {
        fontFamily: 'zpix, monospace',
        fontSize: `${12 * S}px`,
        color: '#ffffff',
      })
      .setOrigin(1, 0.5) // RIGHT-aligned to the bar's right end (minus a small margin)
      .setStroke('#5a4632', 2 * S);
    // Current wall-clock time, RIGHT-aligned just BELOW the coin bar (floats over the world → white
    // text + a dark stroke for legibility, like the money).
    const clock = this.add
      .text(BAR_X + (BAR_TEX_W - 8) * S, AY + 24 * S + 9 * S, m.timeLabel ?? '', {
        fontFamily: 'zpix, monospace',
        fontSize: `${11 * S}px`,
        color: '#ffffff',
      })
      .setOrigin(1, 0.5)
      .setStroke('#5a4632', 2 * S);

    // Weather window (left): a time-tinted background FILLS the window (frame border
    // drawn last covers its square corners), with the transparent weather icon centred
    // on top (a touch smaller so a margin of sky shows around it). NB the art has a big
    // transparent margin — its content is only 34×34 inside the 48×48 frame — so the
    // display size is scaled UP by 48/34 to make the visible content fill the ~34px
    // window (else it'd sit small with a gap, which is what happened at 36).
    const weatherBg = this.add
      .image(WEATHER_C.x, WEATHER_C.y, 'weather-icons', m.bgFrame)
      .setOrigin(0.5)
      .setDisplaySize(50 * S, 50 * S); // content ≈ 35×S → slight overflow, no gap
    const weather = this.add
      .image(WEATHER_C.x, WEATHER_C.y, 'weather-icons', m.weatherFrame)
      .setOrigin(0.5)
      .setDisplaySize(40 * S, 40 * S); // content ≈ 28×S → sun fills most of the window

    // Time window (right): the sky dial + the sun-arc pointer for the current step.
    const dial = this.add.image(TIME_C.x, TIME_C.y, 'weather-ui', 'time-bg').setOrigin(0.5).setScale(S);
    const step = Phaser.Math.Clamp(Math.round(m.pointerStep), 1, 5);
    const o = ARROW_ORIGINS[step - 1];
    const pointer = this.add
      .image(PIVOT.x, PIVOT.y, 'weather-ui', `arrow-big-${step}`)
      .setOrigin(o.x, o.y) // anchor the KNOB on the bump so the tail stays put
      .setScale(S);

    // Frame LAST so its border sits over the window contents' edges.
    const frame = this.add.image(AX, AY, 'weather-ui', 'weather-frame-big').setOrigin(0, 0).setScale(S);

    this.container.add([bar, coin, money, clock, weatherBg, weather, dial, pointer, frame]);
  }
}
