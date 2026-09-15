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
  object: THREE.Object3D;
  /** Every material under it. A wall is one box; a building is a GLB with a
   *  handful of parts, and all of them have to fade together or it turns into
   *  a roof floating over a solid wall. */
  mats: THREE.Material[];
  /** What they were before any of this, to put back. */
  was: { transparent: boolean; opacity: number; depthWrite: boolean }[];
  /** Its footprint, in world x/z. Read when `watch` is called, which is also
   *  when anything that can move has just moved. */
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
  /** The things that may need to get out of the way, and where they are now.
   *  Call it whenever the set OR their positions change — a wall ring is swapped
   *  for a bigger one when land is bought, and buildings are carried around. */
  watch(objects: THREE.Object3D[]): void;
  update(camera: THREE.Camera, target: THREE.Vector3, dt: number): void;
  /** Turn the whole thing off, for an A/B. Proving the wall fades is only half
   *  the claim; the other half is that it was in the way to begin with. */
  setEnabled(on: boolean): void;
  enabled(): boolean;
  /** What is being watched and how faded each one is. Reported from HERE rather
   *  than from the caller's list: the first version of the handle printed the
   *  walls the hub had collected, which stayed five items after buildings were
   *  added and hid the fact that nothing had changed. */
  state(): { name: string; opacity: number }[];
  dispose(): void;
}

export function createSeeThrough(): SeeThrough {
  const from = new THREE.Vector3();
  const bounds = new THREE.Box3();
  let watched: Watched[] = [];
  let on = true;

  /** Flipping `transparent` is enough on its own.
   *
   *  There was a `needsUpdate = true` here for a while, on the theory that a
   *  material already drawn needs its program rebuilt. It does not — three.js
   *  reads `transparent` when it buckets the object and sets blending, both per
   *  draw. Taking the line out changes nothing about what reaches the screen,
   *  measured at the same pixel: 84,72,59 solid and 152,92,64 faded either way.
   *
   *  It went in because the wall looked like it was not drawing at all. It was:
   *  the pixels being sampled were BELOW the wall's projection, and the fix
   *  belonged in the measurement rather than in here. */
  const setBlend = (mat: THREE.Material, on: boolean): void => {
    if (mat.transparent === on) return;
    mat.transparent = on;
  };

  const restore = (w: Watched): void => {
    w.mats.forEach((mat, i) => {
      setBlend(mat, w.was[i].transparent);
      mat.opacity = w.was[i].opacity;
      mat.depthWrite = w.was[i].depthWrite;
    });
  };

  /** Give an object materials of its own, once.
   *
   *  A GLB loaded twice hands back two objects pointing at ONE material — the
   *  same thing that made `flashTint` turn five enemies red for one hit. Fading
   *  the Clinic would fade the Armory, which is built from the same stall. */
  const ownMaterials = (object: THREE.Object3D): THREE.Material[] => {
    const out: THREE.Material[] = [];
    object.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh || !mesh.material) return;
      if (!mesh.userData.ownMat) {
        mesh.material = Array.isArray(mesh.material)
          ? mesh.material.map((m) => m.clone())
          : mesh.material.clone();
        mesh.userData.ownMat = true;
      }
      if (Array.isArray(mesh.material)) out.push(...mesh.material);
      else out.push(mesh.material);
    });
    return out;
  };

  return {
    watch(objects) {
      for (const w of watched) restore(w);
      watched = objects.map((object) => {
        const mats = ownMaterials(object);
        bounds.setFromObject(object);
        return {
          object,
          mats,
          was: mats.map((m) => ({
            transparent: m.transparent, opacity: m.opacity, depthWrite: m.depthWrite,
          })),
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
    state: () => watched.map((w) => ({
      // The entity id first: every building's scene NAME is `town_building`.
      name: (w.object.userData.entityId as string) || w.object.name || '?',
      opacity: +((w.mats[0] as THREE.Material & { opacity: number })?.opacity ?? 1).toFixed(2),
    })),

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
        w.mats.forEach((mat, i) => {
          setBlend(mat, true);
          mat.opacity = w.was[i].opacity * (1 - w.k) + FADED * w.k;
          // Something faded that still writes depth hides what is behind it as
          // well as a solid thing would — the hero would be a hole in it.
          mat.depthWrite = w.k < 0.05;
        });
      }
    },

    dispose() {
      for (const w of watched) restore(w);
      watched = [];
    },
  };
}
