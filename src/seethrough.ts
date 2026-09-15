import * as THREE from 'three';

/**
 * Anything standing between the camera and the player turns to glass.
 *
 * The camera follows from BEHIND, so walking up to something near a wall puts
 * the wall between the two — and a village wall is 1.2m of solid masonry
 * filling a third of a phone screen. Moving the one thing a player has to keep
 * returning to (the shop) out of the corners only dodged it; every building
 * they choose to put at the back has the same problem, and they place those
 * themselves.
 *
 * The test is in the GROUND PLANE, not a ray through the world, and that is the
 * whole of what makes it work. A ray from the camera to the hero's chest sails
 * clean over a 1.2m wall — measured: the camera sits at y 3.6 and the ray was
 * passing the wall's top edge with 90cm to spare, so nothing ever faded. The
 * wall is not hiding the HERO. It is standing between the camera and the
 * village, taking the bottom third of the screen with it.
 *
 * So: does the line from where the camera is standing to where the player is
 * standing cross this wall's footprint? That is exactly "the camera ended up on
 * the far side of it", which is the thing that goes wrong.
 */

/** How solid a wall is while it is in the way. Low enough to read the hero
 *  through it, high enough that the wall is still obviously there — a wall you
 *  cannot see at all reads as a hole in the village. */
const FADED = 0.22;
/** Seconds to cross most of the gap between solid and faded. Fast enough not to
 *  lag behind the camera, slow enough not to flicker when a ray clips a corner
 *  for one frame. */
const EASE = 0.07;

interface Watched {
  mesh: THREE.Mesh;
  mat: THREE.MeshStandardMaterial;
  /** What it was before any of this, to put back. */
  was: { transparent: boolean; opacity: number; depthWrite: boolean };
  /** Its footprint, in world x/z. Merged geometry is already baked into world
   *  space, so this is read once and never moves. */
  box: { x0: number; x1: number; z0: number; z1: number };
  k: number;
}

/** Does the segment a→b cross this footprint? Slab method, in two dimensions.
 *
 *  The box is grown a little first: a wall the line passes a hand's width from
 *  is still filling the screen, and a test that flips on and off as the player
 *  walks along it would flicker. */
function crosses(
  box: Watched['box'], ax: number, az: number, bx: number, bz: number,
): boolean {
  const PAD = 0.35;
  const dx = bx - ax, dz = bz - az;
  let lo = 0, hi = 1;
  for (const [p, d, min, max] of [
    [ax, dx, box.x0 - PAD, box.x1 + PAD],
    [az, dz, box.z0 - PAD, box.z1 + PAD],
  ] as const) {
    if (Math.abs(d) < 1e-6) {
      if (p < min || p > max) return false;   // parallel and outside the slab
      continue;
    }
    const t0 = (min - p) / d;
    const t1 = (max - p) / d;
    lo = Math.max(lo, Math.min(t0, t1));
    hi = Math.min(hi, Math.max(t0, t1));
    if (lo > hi) return false;
  }
  return true;
}

export interface SeeThrough {
  /** The meshes that may need to get out of the way. Safe to call whenever the
   *  set changes — a wall ring is swapped for a bigger one when land is bought. */
  watch(meshes: THREE.Mesh[]): void;
  update(camera: THREE.Camera, target: THREE.Vector3, dt: number): void;
  /** Turn the whole thing off, for an A/B. Proving the wall fades is only half
   *  the claim; the other half is that it was in the way to begin with. */
  setEnabled(on: boolean): void;
  enabled(): boolean;
  dispose(): void;
}

export function createSeeThrough(): SeeThrough {
  const from = new THREE.Vector3();
  const bounds = new THREE.Box3();
  let watched: Watched[] = [];
  let on = true;

  /** Setting `transparent` on a material that has already been drawn needs the
   *  program rebuilt — without `needsUpdate` the wall keeps its opaque shader
   *  and the opacity is simply ignored. Which is silent: the material reports
   *  0.22 when you ask it, and contributes nothing whatever to the pixels. */
  const setBlend = (mat: THREE.Material, on: boolean): void => {
    if (mat.transparent === on) return;
    mat.transparent = on;
    mat.needsUpdate = true;
  };

  const restore = (w: Watched): void => {
    setBlend(w.mat, w.was.transparent);
    w.mat.opacity = w.was.opacity;
    w.mat.depthWrite = w.was.depthWrite;
  };

  return {
    watch(meshes) {
      for (const w of watched) restore(w);
      watched = meshes.map((mesh) => {
        const raw = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
        const mat = raw as THREE.MeshStandardMaterial;
        bounds.setFromObject(mesh);
        return {
          mesh,
          mat,
          was: { transparent: mat.transparent, opacity: mat.opacity, depthWrite: mat.depthWrite },
          box: { x0: bounds.min.x, x1: bounds.max.x, z0: bounds.min.z, z1: bounds.max.z },
          k: 0,
        };
      });
    },

    setEnabled(next) {
      on = next;
      if (!on) for (const w of watched) { w.k = 0; restore(w); }
    },
    enabled: () => on,

    update(camera, target, dt) {
      if (!on || !watched.length) return;
      camera.getWorldPosition(from);
      // Exponential, so it is frame-rate independent. A fixed step per frame
      // fades twice as fast at 120fps as at 60.
      const step = 1 - Math.exp(-dt / EASE);
      for (const w of watched) {
        const want = crosses(w.box, from.x, from.z, target.x, target.z) ? 1 : 0;
        w.k += (want - w.k) * step;
        if (w.k < 0.01) { restore(w); continue; }
        setBlend(w.mat, true);
        w.mat.opacity = w.was.opacity * (1 - w.k) + FADED * w.k;
        // A faded wall that still writes depth hides whatever is behind it just
        // as well as a solid one — the hero would be a hole in the masonry.
        w.mat.depthWrite = w.k < 0.05;
      }
    },

    dispose() {
      for (const w of watched) restore(w);
      watched = [];
    },
  };
}
