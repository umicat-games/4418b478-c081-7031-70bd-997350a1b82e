import * as THREE from 'three';

/**
 * Clouds, painted into the sky rather than hung in the world.
 *
 * The obvious version — squashed spheres placed high and far out — was built
 * first and was wrong twice over.
 *
 * **This camera shows almost no sky.** It sits 3.6 above the hero and looks
 * down, and the TOP EDGE of the frame points two degrees BELOW horizontal. The
 * blue at the top of a screenshot is not sky overhead; it is the background
 * showing past the last row of trees, in a band eight degrees deep between the
 * treetops and the top of the frame. Every cloud placed at a sensible height
 * was in the scene, merged, drawn, and entirely off screen.
 *
 * **And a distant object wrecks the shadows.** The SDK fits each directional
 * light's shadow camera to the bounds of everything loaded, so a ring of clouds
 * thirty units out took the hub's shadow radius from 8 to 37 with the same
 * 1024 map — one twentieth of the resolution, which showed up as a soft grey
 * smear across the grass that nothing in the scene explained.
 *
 * A background texture has neither problem: no geometry, no bounds, no draw
 * call of its own, and it is visible in whatever sliver of sky the camera
 * happens to show. Drawn once into a canvas and mapped equirectangularly.
 */

/** Where the visible band actually is, in this game, as a fraction up the
 *  equirectangular image (0.5 is the horizon). Clouds go mostly here, and
 *  thinning above, so that a later change of camera angle still finds some. */
const HORIZON = 0.5;

export function skyWithClouds(
  opts: { horizon?: string; top?: string; seed?: number } = {},
): THREE.Texture {
  const W = 2048;
  const H = 1024;
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const g = cv.getContext('2d')!;

  // The sky itself: a little deeper overhead than at the horizon, which is what
  // makes it read as depth rather than as a painted wall.
  const grad = g.createLinearGradient(0, 0, 0, H);
  grad.addColorStop(0, opts.top ?? '#6fb6e4');
  grad.addColorStop(0.44, opts.horizon ?? '#9fd4ef');
  grad.addColorStop(1, opts.horizon ?? '#9fd4ef');
  g.fillStyle = grad;
  g.fillRect(0, 0, W, H);

  // A tiny deterministic PRNG, so the sky is the same every load — a cloud that
  // moves when you walk back through a door is a cloud you notice.
  let s = opts.seed ?? 7;
  const rand = (): number => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };

  /** One cloud: a handful of overlapping soft discs, flattened, with a brighter
   *  crown and a greyer underside. A single blob reads as a smudge. */
  const cloud = (cx: number, cy: number, scale: number, alpha: number): void => {
    const puffs = 5 + Math.floor(rand() * 4);
    for (let i = 0; i < puffs; i++) {
      const t = i / (puffs - 1) - 0.5;
      const r = scale * (0.55 + 0.75 * (1 - Math.abs(t) * 1.6)) * (0.7 + rand() * 0.6);
      if (r <= 1) continue;
      const px = cx + t * scale * 2.4 + (rand() - 0.5) * scale * 0.3;
      const py = cy + (rand() - 0.5) * scale * 0.35 - Math.abs(t) * scale * 0.1;
      // Transform FIRST, then build the gradient in the local space it will be
      // filled in. A canvas gradient is resolved in whatever user space is
      // current when the fill happens — so a gradient built at (px, py) and
      // then translated by (px, py) lands at twice the distance, entirely
      // outside the circle being filled, and every blob paints its outermost
      // stop. Which is transparent. The whole sky drew, without error, and
      // produced a clean gradient with nothing in it.
      g.save();
      g.translate(px, py);
      g.scale(1, 0.62);            // clouds are wider than they are tall
      const rg = g.createRadialGradient(0, -r * 0.15, r * 0.1, 0, 0, r);
      rg.addColorStop(0, `rgba(255,255,255,${alpha})`);
      rg.addColorStop(0.55, `rgba(248,251,255,${alpha * 0.82})`);
      rg.addColorStop(1, 'rgba(226,238,248,0)');
      g.fillStyle = rg;
      g.beginPath();
      g.arc(0, 0, r, 0, Math.PI * 2);
      g.fill();
      g.restore();
    }
  };

  // Dense across the band this camera can actually see, thinning away from it.
  //
  // `y` here is DOWN the canvas, and a CanvasTexture is flipped on load, so a
  // larger y is a LOWER elevation. The band on screen runs from two degrees
  // below horizontal (the top of the frame) to about ten (the treetops) —
  // BELOW the horizon, because this camera is looking down past the trees at
  // the background rather than up at the sky. Putting the clouds above the
  // horizon line, which is where clouds obviously go, is how the first version
  // of this painted them all into the part of the texture nothing renders.
  //
  // A degree is 1/180 of the image, so the visible slice is y 0.511 to 0.556.
  // They spread well past it in both directions, because a decoration that only
  // works at exactly one camera pitch is a decoration waiting to vanish.
  const bands: [number, number, number, number][] = [
    // [centre y down the canvas, spread, count, scale]
    [0.533, 0.05, 18, 24],
    [0.500, 0.04, 13, 32],
    [0.448, 0.06, 10, 42],
    [0.360, 0.08, 7, 52],
  ];
  for (const [v, spread, count, scale] of bands) {
    for (let i = 0; i < count; i++) {
      const x = ((i + rand() * 0.7) / count) * W;
      const y = (v + (rand() - 0.5) * spread) * H;
      cloud(x, y, scale * (0.7 + rand() * 0.6), 0.78 + rand() * 0.2);
    }
  }

  const tex = new THREE.CanvasTexture(cv);
  tex.mapping = THREE.EquirectangularReflectionMapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
