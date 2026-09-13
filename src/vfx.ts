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
    /** An atlas cell to wear. Without one a mote is a flat square, which at
     *  0.13 across reads as a scrap of white PAPER rather than a spark — very
     *  obviously so beside textured lightning. */
    frame?: number;
  },
): void {
  const n = Math.max(1, opts.count);
  const geom = new THREE.PlaneGeometry(opts.size ?? 0.09, opts.size ?? 0.09);
  if (opts.frame != null) setFrameUv(geom, opts.frame);
  const mat = new THREE.MeshBasicMaterial({
    map: opts.frame != null ? atlas() : null,
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

// --- textured quads ---------------------------------------------------------

/** The atlas, 4×4. One texture for every billboard in the game, which is what
 *  lets a whole spell be ONE draw: same material, different UVs. */
export const ATLAS_COLS = 4;

/** Point a whole geometry's UVs at one atlas cell. Shared by `motes`, whose
 *  instances all wear the same frame, and cheaper than `quads`'s per-frame
 *  rewrite. */
export function setFrameUv(geom: THREE.BufferGeometry, frame: number): void {
  const fx = frame % ATLAS_COLS;
  const fy = Math.floor(frame / ATLAS_COLS);
  const e = 0.002;
  const u0 = (fx + e) / ATLAS_COLS;
  const u1 = (fx + 1 - e) / ATLAS_COLS;
  const v1 = 1 - (fy + e) / ATLAS_COLS;
  const v0 = 1 - (fy + 1 - e) / ATLAS_COLS;
  const uv = geom.attributes.uv.array as Float32Array;
  // PlaneGeometry's four corners, top-left first.
  uv[0] = u0; uv[1] = v1;
  uv[2] = u1; uv[3] = v1;
  uv[4] = u0; uv[5] = v0;
  uv[6] = u1; uv[7] = v0;
  geom.attributes.uv.needsUpdate = true;
}
export const FRAME = {
  boltA: 0, boltB: 1, strandA: 2, strandB: 3,
  arcA: 4, arcB: 5, glowRing: 6, runeRing: 7,
  runeCircle: 8, flare: 9, sparkle: 10, starBurst: 11,
  scorch: 12, burst: 13, twirl: 14, slash: 15,
} as const;

/** One textured rectangle inside an effect. */
export interface Quad {
  /** Where its middle sits. For a `beam` this is the START. */
  at: THREE.Vector3;
  /** A `beam` runs from `at` to here. */
  to?: THREE.Vector3;
  frame: number;
  w: number;
  h: number;
  /** `face` turns to the camera; `ground` lies flat; `beam` stretches from
   *  `at` to `to` and rolls about its own length to face the camera. */
  mode?: 'face' | 'ground' | 'beam';
  /** Radians, about the quad's own normal. */
  roll?: number;
}

let atlasTexture: THREE.Texture | null = null;

/** Fetch it during loading, not on the first spell.
 *
 *  `TextureLoader.load` is asynchronous, so a material made before the image
 *  arrives has a map with nothing in it — which under ADDITIVE blending samples
 *  black, and black added to the screen is invisible. The first cast of every
 *  run drew ten perfectly correct triangles that nobody could see. */
export async function preloadAtlas(url = 'vfx/particles.png'): Promise<void> {
  await new Promise<void>((res) => {
    const t = atlas(url);
    if (t.image) { res(); return; }
    const done = (): void => res();
    t.addEventListener?.('dispose', done);
    const poll = setInterval(() => { if (t.image) { clearInterval(poll); res(); } }, 30);
    setTimeout(() => { clearInterval(poll); res(); }, 5000);
  });
}

/** Loaded once and shared. A texture per effect would be a texture per cast. */
export function atlas(url = 'vfx/particles.png'): THREE.Texture {
  if (!atlasTexture) {
    atlasTexture = new THREE.TextureLoader().load(url);
    atlasTexture.colorSpace = THREE.SRGBColorSpace;
    // No wrapping: a bolt bleeding into the cell beside it is a bolt with a
    // rune stuck to its tip.
    atlasTexture.wrapS = THREE.ClampToEdgeWrapping;
    atlasTexture.wrapT = THREE.ClampToEdgeWrapping;
  }
  return atlasTexture;
}

/**
 * A sheet of textured quads that live and die together — a whole spell in ONE
 * draw call.
 *
 * This is the primitive the 2D games do their magic with: the effect IS a
 * picture, played on a rectangle. The difference here is that the camera turns,
 * so a quad drawn for one viewing angle would show its edge — `face` and `beam`
 * re-orient every frame, which is the whole reason this is geometry rather than
 * a sprite pasted on the screen.
 *
 * The geometry is rebuilt each frame from the quad list, which sounds wasteful
 * and is four vertices times a handful of quads. Rebuilding is what lets a bolt
 * jitter, a beam follow a moving target, and a ring grow, without a shader.
 */
export function quads(
  vfx: Vfx,
  list: Quad[],
  opts: {
    life: number;
    color?: number;
    /** Called each frame; mutate `list` to animate. `k` runs 0..1. */
    step?: (list: Quad[], k: number, dt: number) => void;
    /** Opacity over the effect's life. Defaults to a fade out. */
    alpha?: (k: number) => number;
    /** Drawn over everything, for flashes that must not be hidden by a tower. */
    onTop?: boolean;
  },
): void {
  const n = list.length;
  const geom = new THREE.BufferGeometry();
  const pos = new Float32Array(n * 4 * 3);
  const uv = new Float32Array(n * 4 * 2);
  const idx = new Uint16Array(n * 6);
  for (let i = 0; i < n; i++) {
    idx.set([i * 4, i * 4 + 1, i * 4 + 2, i * 4, i * 4 + 2, i * 4 + 3], i * 6);
  }
  geom.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geom.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geom.setIndex(new THREE.BufferAttribute(idx, 1));
  geom.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e3);

  const mat = new THREE.MeshBasicMaterial({
    map: atlas(), color: opts.color ?? 0xffffff, transparent: true,
    depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(geom, mat);
  mesh.renderOrder = opts.onTop ? 9 : 5;
  if (opts.onTop) mat.depthTest = false;

  const right = new THREE.Vector3();
  const up = new THREE.Vector3();
  const axis = new THREE.Vector3();
  const camRight = new THREE.Vector3();
  const camUp = new THREE.Vector3();
  const toCam = new THREE.Vector3();
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  const d = new THREE.Vector3();

  const write = (): void => {
    const q = vfx.facing();
    camRight.set(1, 0, 0).applyQuaternion(q);
    camUp.set(0, 1, 0).applyQuaternion(q);
    toCam.set(0, 0, 1).applyQuaternion(q);
    for (let i = 0; i < n; i++) {
      const s = list[i];
      const mode = s.mode ?? 'face';
      if (mode === 'beam' && s.to) {
        // Along the beam, rolled so its flat side faces the camera. A beam that
        // keeps a fixed roll vanishes to a line when you walk round it.
        axis.copy(s.to).sub(s.at);
        const len = axis.length() || 1e-4;
        axis.divideScalar(len);
        right.copy(axis).cross(toCam);
        if (right.lengthSq() < 1e-6) right.copy(camRight);
        right.normalize().multiplyScalar(s.w / 2);
        up.copy(axis).multiplyScalar(len / 2);
        c.copy(s.at).add(s.to).multiplyScalar(0.5);
      } else if (mode === 'ground') {
        right.set(s.w / 2, 0, 0);
        up.set(0, 0, s.h / 2);
        if (s.roll) {
          right.applyAxisAngle(UP_AXIS, s.roll);
          up.applyAxisAngle(UP_AXIS, s.roll);
        }
        c.copy(s.at);
      } else {
        right.copy(camRight).multiplyScalar(s.w / 2);
        up.copy(camUp).multiplyScalar(s.h / 2);
        if (s.roll) {
          right.applyAxisAngle(toCam, s.roll);
          up.applyAxisAngle(toCam, s.roll);
        }
        c.copy(s.at);
      }
      a.copy(c).sub(right).sub(up);
      b.copy(c).add(right).sub(up);
      d.copy(c).sub(right).add(up);
      const o = i * 12;
      pos[o] = a.x; pos[o + 1] = a.y; pos[o + 2] = a.z;
      pos[o + 3] = b.x; pos[o + 4] = b.y; pos[o + 5] = b.z;
      pos[o + 6] = c.x + right.x + up.x; pos[o + 7] = c.y + right.y + up.y;
      pos[o + 8] = c.z + right.z + up.z;
      pos[o + 9] = d.x; pos[o + 10] = d.y; pos[o + 11] = d.z;

      const fx = s.frame % ATLAS_COLS;
      const fy = Math.floor(s.frame / ATLAS_COLS);
      // A hair inside the cell, or bilinear filtering samples the neighbour.
      const e = 0.002;
      const u0 = (fx + e) / ATLAS_COLS;
      const u1 = (fx + 1 - e) / ATLAS_COLS;
      const v1 = 1 - (fy + e) / ATLAS_COLS;
      const v0 = 1 - (fy + 1 - e) / ATLAS_COLS;
      const t = i * 8;
      uv[t] = u0; uv[t + 1] = v0;
      uv[t + 2] = u1; uv[t + 3] = v0;
      uv[t + 4] = u1; uv[t + 5] = v1;
      uv[t + 6] = u0; uv[t + 7] = v1;
    }
    geom.attributes.position.needsUpdate = true;
    geom.attributes.uv.needsUpdate = true;
  };
  write();

  const fade = opts.alpha ?? ((k: number) => 1 - k * k);
  vfx.add({
    obj: mesh, t: 0, life: opts.life, own: [geom, mat],
    step: (_o, k, dt) => {
      opts.step?.(list, k, dt);
      mat.opacity = fade(k);
      write();
    },
  });
}

const UP_AXIS = new THREE.Vector3(0, 1, 0);

/**
 * A lightning strike: bolts out of the sky, a rune ring on the ground, a flash.
 *
 * This is the effect the 2D games do with a sprite sequence played at the
 * character's feet, and it is worth naming what is different here. A frame
 * sequence draws whatever the artist drew; these bolts are geometry, so they
 * have to be given the things a sequence gets for free — flicker (the frames
 * are swapped and the feet re-jittered several times a second, because a bolt
 * that holds still for a third of a second reads as a lamp post), and a ring
 * that ends exactly where the damage does, which teaches the spell's radius
 * better than any number in the HUD.
 *
 * One draw call for all of it.
 */
export function lightning(
  vfx: Vfx,
  at: THREE.Vector3,
  opts: { radius: number; bolts?: number; color?: number; life?: number; height?: number },
): void {
  const n = opts.bolts ?? 5;
  const h = opts.height ?? 2.9;
  const life = opts.life ?? 0.42;
  const frames = [FRAME.boltA, FRAME.boltB, FRAME.strandA, FRAME.strandB];
  const list: Quad[] = [];

  // The bolts. `beam` rather than `face` so each one runs sky-to-ground and
  // rolls to keep its flat side towards the camera.
  //
  // WIDE. The bolt in the atlas is a thread down the middle of a mostly empty
  // 256px square, so a quad a world unit across draws a third of a unit of
  // lightning — the first pass asked for 0.75 and got three pencil lines.
  const feet: THREE.Vector3[] = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + Math.random();
    const r = opts.radius * (0.2 + Math.random() * 0.55);
    const foot = new THREE.Vector3(at.x + Math.cos(a) * r, at.y + 0.02, at.z + Math.sin(a) * r);
    feet.push(foot);
    list.push({
      at: foot.clone(),
      to: new THREE.Vector3(foot.x + (Math.random() - 0.5) * 0.5, at.y + h, foot.z + (Math.random() - 0.5) * 0.5),
      frame: frames[i % frames.length], w: 1.3 + Math.random() * 0.7, h: 1, mode: 'beam',
    });
  }
  // Two rings on the ground: a glow that races out to where the damage ends,
  // and a rune that holds a fixed size and turns. One ring read as a puff of
  // smoke; the rune is what says "a spell went off here".
  list.push({ at: new THREE.Vector3(at.x, at.y + 0.04, at.z), frame: FRAME.glowRing,
              w: 0.8, h: 0.8, mode: 'ground' });
  list.push({ at: new THREE.Vector3(at.x, at.y + 0.05, at.z), frame: FRAME.runeCircle,
              w: opts.radius * 1.5, h: opts.radius * 1.5, mode: 'ground', roll: 0 });
  // And the flash at the middle of it.
  list.push({ at: new THREE.Vector3(at.x, at.y + 0.3, at.z), frame: FRAME.flare,
              w: 2.2, h: 2.2, mode: 'face' });
  list.push({ at: new THREE.Vector3(at.x, at.y + 0.35, at.z), frame: FRAME.starBurst,
              w: 1.4, h: 1.4, mode: 'face' });

  let flick = 0;
  quads(vfx, list, {
    life,
    color: opts.color ?? 0x9ec6ff,
    // Bright, then gone. A linear fade reads as a light being turned down.
    alpha: (k) => (k < 0.12 ? 1 : Math.max(0, 1 - ((k - 0.12) / 0.88) ** 0.7)),
    step: (qs, k, dt) => {
      flick += dt;
      if (flick > 0.045) {
        flick = 0;
        for (let i = 0; i < n; i++) {
          const q = qs[i];
          q.frame = frames[Math.floor(Math.random() * frames.length)];
          // Re-jitter the head, not the foot: the strike stays where it hit.
          q.to!.x = feet[i].x + (Math.random() - 0.5) * 0.6;
          q.to!.z = feet[i].z + (Math.random() - 0.5) * 0.6;
          q.w = 1.2 + Math.random() * 0.8;
        }
      }
      // The glow races out to the radius in the first third and stays.
      const grow = Math.min(1, k * 3);
      const glow = qs[n];
      glow.w = glow.h = 0.8 + (opts.radius * 2 - 0.8) * grow;
      const rune = qs[n + 1];
      rune.roll = k * 1.2;
      const flare = qs[n + 2];
      flare.w = flare.h = 2.2 * (1 + k * 1.6);
      const star = qs[n + 3];
      star.w = star.h = 1.4 * (1 + k * 3);
    },
  });
}
