import Phaser from 'phaser';

/**
 * The cozy "cream + drifting grey icons" wallpaper — a tiled `ui-icons` pattern that
 * scrolls diagonally, wrapping seamlessly. Shared so the laptop cold-open (LaptopScene)
 * and the game's loading screen (LoadingOverlay) look identical. Pure helpers over a
 * caller-owned `Container` layer, so the caller controls depth / scrollFactor / fading.
 */
export const WP_FILL = 0xaed499;          // soft light-green backdrop
export const WP_ICONS = [64, 65, 66, 2];  // all_icons white: heart / sprout-up / sprout-down / star
export const WP_TINT = 0xffffff;          // soft white icons — read as gentle floating motifs on the green
export const WP_ALPHA = 0.42;

const P = 4; // diagonal repeat period (in cells) — the drift wraps every P*spacing px

/** (Re)fill `layer` with the tiled icon pattern sized for a W×H viewport. Returns the
 *  wrap PERIOD (px) for {@link driftIconLayer}. Uses the `ui-icons` texture. */
export function buildIconPattern(scene: Phaser.Scene, layer: Phaser.GameObjects.Container, W: number, H: number): number {
  layer.removeAll(true);
  const spacing = Math.max(26, Math.round(Math.min(W, H) * 0.055)); // halved → smaller icons, denser pattern
  const iconS = spacing * 0.46;
  const cols = Math.ceil(W / spacing), rows = Math.ceil(H / spacing);
  for (let r = -P; r <= rows + P; r++) {
    for (let c = -P; c <= cols + P; c++) {
      const frame = WP_ICONS[(((c + r) % 4) + 4) % 4];
      const ic = scene.add.image(c * spacing, r * spacing, 'ui-icons', frame).setTint(WP_TINT).setAlpha(WP_ALPHA);
      ic.setDisplaySize(iconS, iconS);
      layer.add(ic);
    }
  }
  layer.setPosition(0, 0);
  return P * spacing;
}

/** Drift `layer` diagonally up-right by `delta` ms, wrapping by one `period` (seamless). */
export function driftIconLayer(layer: Phaser.GameObjects.Container, delta: number, period: number): void {
  layer.x += (10 * delta) / 1000;  // rightward
  layer.y -= (14 * delta) / 1000;  // upward
  if (layer.x >= period) layer.x -= period;
  if (layer.y <= -period) layer.y += period;
}
