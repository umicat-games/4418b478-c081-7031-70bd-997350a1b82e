import * as THREE from 'three';

/**
 * Short-lived visual things, and the one loop that owns them.
 *
 * This exists because the same fifteen lines had been written six times — an
 * array, `t += dt`, a fade, `scene.remove`, `splice` — for updrafts, corpses,
 * coins, shots, bullets and crates. The seventh copy was going to be spell
 * effects.
 *
 * What belongs here is anything PURELY VISUAL and fire-and-forget: nothing in
 * this file is ever asked a question by the rules. Drops, shots and arrows are
 * not effects — they are collected, they collide, they damage — and folding
 * them in would mean the gameplay asking the effects registry what it holds,
 * which is how a tidy system turns into a second copy of the game state.
 *
 * The two constraints that shaped it, both ours rather than general:
 *
 *  - **Draw calls are budgeted.** A level is about twenty, and that took
 *    folding thirteen hundred objects into four meshes. An effect system that
 *    spawns a mesh per particle can undo all of it in one spell, so anything
 *    that comes in a crowd goes through `motes()`, which is ONE instanced draw
 *    however many there are.
 *  - **Phones mind overdraw, not triangles.** Additive blending stacked three
 *    deep over a full screen costs more than the rest of the board put
 *    together. `MAX_LIVE` is a ceiling on how much of that can be on screen at
 *    once; past it the oldest effect goes, so the worst case is a number rather
 *    than however many things happened to die at the same moment.
 */

/** How many effects may be alive at once. Past this the oldest is dropped —
 *  a cap that is reached looks like a busy fight; one that is not reached
 *  looks like a frame-rate cliff. */
const MAX_LIVE = 48;

interface Live {
  obj: THREE.Object3D;
  t: number;
  life: number;
  /** Called each frame with `k` in 0..1. */
  step?: (obj: THREE.Object3D, k: number, dt: number) => void;
  /** Geometry and materials made for this one effect, freed when it ends.
   *  Shared ones must NOT be listed, or the second effect draws nothing. */
  own?: (THREE.BufferGeometry | THREE.Material)[];
  onEnd?: () => void;
}

export class Vfx {
  private live: Live[] = [];

  constructor(
    private readonly scene: THREE.Scene,
    /** Read fresh each frame: billboards face wherever the camera IS, and the
     *  camera in this game turns under the player's thumb. */
    private readonly camera: () => THREE.Camera,
  ) {}

  get count(): number { return this.live.length; }

  /** Hand something over. The registry adds it to the scene, steps it, and
   *  takes it away again. */
  add(entry: Live): void {
    if (this.live.length >= MAX_LIVE) this.retire(0);
    entry.obj.frustumCulled = false;
    this.scene.add(entry.obj);
    this.live.push(entry);
  }

  private retire(i: number): void {
    const e = this.live[i];
    this.scene.remove(e.obj);
    for (const r of e.own ?? []) r.dispose();
    e.onEnd?.();
    this.live.splice(i, 1);
  }

  update(dt: number): void {
    for (let i = this.live.length - 1; i >= 0; i--) {
      const e = this.live[i];
      e.t += dt;
      const k = e.t / e.life;
      if (k >= 1) { this.retire(i); continue; }
      e.step?.(e.obj, k, dt);
    }
  }

  /** Take everything away — a level teardown, so nothing outlives its scene. */
  clear(): void {
    while (this.live.length) this.retire(this.live.length - 1);
  }

  /** The camera, for effects that need to face it. */
  facing(): THREE.Quaternion { return this.camera().quaternion; }
}

// --- primitives -------------------------------------------------------------

/** A flat ring on the ground that grows and thins away.
 *
 *  One mesh, one draw. Its own geometry and material because the radius and the
 *  colour differ per cast — a ring is cheap enough that pooling it would be
 *  more code than it saves. */
export function ring(
  vfx: Vfx,
  at: THREE.Vector3,
  opts: { color: number; from: number; to: number; life: number; opacity?: number },
): void {
  const geom = new THREE.RingGeometry(opts.from, opts.from * 1.18, 40).rotateX(-Math.PI / 2);
  const mat = new THREE.MeshBasicMaterial({
    color: opts.color, transparent: true, opacity: opts.opacity ?? 0.95,
    side: THREE.DoubleSide, depthWrite: false,
  });
  const mesh = new THREE.Mesh(geom, mat);
  mesh.position.set(at.x, at.y + 0.05, at.z);
  mesh.renderOrder = 3;
  const grow = opts.to / opts.from;
  const a0 = opts.opacity ?? 0.95;
  vfx.add({
    obj: mesh, t: 0, life: opts.life, own: [geom, mat],
    step: (o, k) => {
      o.scale.setScalar(1 + k * (grow - 1));
      mat.opacity = a0 * (1 - k);
    },
  });
}

/** A puff of specks that rise, spiral and fade.
 *
 *  ONE InstancedMesh however many there are. It was a mesh and a material per
 *  speck, which is twelve to eighteen draw calls per cast on a board budgeted
 *  at twenty — the single most expensive thing in the game, for the smallest.
 *
 *  Additive blending is what makes the fade free: there is no per-instance
 *  opacity in three, but fading an additive instance's COLOUR to black is the
 *  same picture, and `instanceColor` is per-instance. */
export function motes(
  vfx: Vfx,
  at: THREE.Vector3,
  opts: {
    count: number; color: number; color2?: number;
    radius: number; rise: number; spin: number; life: number; size?: number;
  },
): void {
  const n = Math.max(1, opts.count);
  const geom = new THREE.PlaneGeometry(opts.size ?? 0.09, opts.size ?? 0.09);
  const mat = new THREE.MeshBasicMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  });
  const mesh = new THREE.InstancedMesh(geom, mat, n);
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  mesh.renderOrder = 4;

  const a0: number[] = [];
  const r0: number[] = [];
  const rise: number[] = [];
  const spin: number[] = [];
  const base = new THREE.Color();
  const c1 = new THREE.Color(opts.color);
  const c2 = new THREE.Color(opts.color2 ?? opts.color);
  const cols = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    a0.push((i / n) * Math.PI * 2);
    r0.push(opts.radius * (0.55 + Math.random() * 0.65));
    rise.push(opts.rise * (0.75 + Math.random() * 0.6));
    spin.push(opts.spin * (0.7 + Math.random() * 0.8));
    base.copy(i % 3 === 0 ? c2 : c1);
    cols[i * 3] = base.r; cols[i * 3 + 1] = base.g; cols[i * 3 + 2] = base.b;
  }
  mesh.instanceColor = new THREE.InstancedBufferAttribute(cols.slice(), 3);

  const m = new THREE.Matrix4();
  const pos = new THREE.Vector3();
  const scl = new THREE.Vector3();
  vfx.add({
    obj: mesh, t: 0, life: opts.life, own: [geom, mat],
    step: (o, k) => {
      const q = vfx.facing();
      const fade = 1 - k * k;
      let top = -Infinity;
      for (let i = 0; i < n; i++) {
        const a = a0[i] + k * spin[i];
        const r = r0[i] * (1 + k * 0.5);
        pos.set(at.x + Math.cos(a) * r, at.y + 0.06 + rise[i] * k, at.z + Math.sin(a) * r);
        scl.setScalar(1 - k * 0.55);
        if (pos.y > top) top = pos.y;
        m.compose(pos, q, scl);
        mesh.setMatrixAt(i, m);
        // Fading an ADDITIVE colour towards black is the same picture as fading
        // its alpha, and colour is the thing that can be per-instance.
        for (let c = 0; c < 3; c++) {
          mesh.instanceColor!.array[i * 3 + c] = cols[i * 3 + c] * fade;
        }
      }
      mesh.instanceMatrix.needsUpdate = true;
      mesh.instanceColor!.needsUpdate = true;
      // Where the highest speck got to. Instanced specks have no positions of
      // their own to read, and "do they rise" is a thing worth being able to
      // ask.
      o.userData.topY = top;
    },
  });
}

/** Something that has stopped moving and should sink away rather than blink
 *  out. The mixer keeps playing so a death animation finishes. */
export function corpse(
  vfx: Vfx,
  obj: THREE.Object3D,
  opts: { hold: number; sink: number; mixer?: THREE.AnimationMixer | null },
): void {
  const y0 = obj.position.y;
  vfx.add({
    obj, t: 0, life: opts.hold + opts.sink,
    step: (o, k, dt) => {
      opts.mixer?.update(dt);
      const into = k * (opts.hold + opts.sink) - opts.hold;
      if (into > 0) o.position.y = y0 - (into / opts.sink) * 0.9;
    },
  });
}
