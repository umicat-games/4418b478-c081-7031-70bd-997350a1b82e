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

/** Take something apart: it sinks, shrinks and fades out where it stood.
 *
 *  For things that are REMOVED rather than killed — a tower you sold. Vanishing
 *  on the frame the button fires reads as a glitch: you cannot tell whether the
 *  thing was sold, fell through the floor, or was never there. Half a second of
 *  it coming apart is the difference between a transaction and a bug.
 *
 *  It takes the object OVER — the caller must already have taken it out of its
 *  own list, or the game will keep shooting with a tower that is dissolving.
 *  The material is cloned per mesh before fading, because a tower's meshes come
 *  from `cloneOf` and share their materials with every other tower of that kind:
 *  fading the original would fade the whole board.
 */
export function dissolve(
  vfx: Vfx,
  obj: THREE.Object3D,
  opts: { life?: number } = {},
): void {
  const life = opts.life ?? 0.5;
  const own: (THREE.Material | THREE.BufferGeometry)[] = [];
  obj.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    const mats = Array.isArray(m.material) ? m.material : [m.material];
    const copies = mats.map((mat) => {
      const c = mat.clone();
      c.transparent = true;
      c.depthWrite = false;
      own.push(c);
      return c;
    });
    m.material = Array.isArray(m.material) ? copies : copies[0];
  });
  const y0 = obj.position.y;
  const s0 = obj.scale.clone();
  vfx.add({
    obj, t: 0, life, own,
    step: (o, k) => {
      o.position.y = y0 - k * 0.45;
      o.scale.set(s0.x * (1 - k * 0.55), s0.y * (1 - k * 0.8), s0.z * (1 - k * 0.55));
      o.traverse((c) => {
        const m = c as THREE.Mesh;
        if (!m.isMesh) return;
        for (const mat of Array.isArray(m.material) ? m.material : [m.material]) {
          (mat as THREE.Material).opacity = 1 - k * k;
        }
      });
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
/** The atlas, by position. `tools/pack-vfx-atlas.py` builds the PNG from this
 *  same order and names each source file — the two must be changed together,
 *  because a frame index is the only thing tying a drawing to a picture. */
export const FRAME = {
  boltA: 0, boltB: 1, strandA: 2, strandB: 3,
  // Cells 4, 5, 14 and 15 held `arcA`/`arcB`/`twirl`/`slash`, which nothing
  // ever drew. Fire and ice needed shapes of their own far more than the atlas
  // needed four unused ones.
  flameA: 4, flameB: 5, glowRing: 6, runeRing: 7,
  runeCircle: 8, flare: 9, sparkle: 10, starBurst: 11,
  scorch: 12, burst: 13, iceShard: 14, frostRing: 15,
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

/** How much of a bolt's life is the strike, and how much is the afterglow. */
const STRIKE_FRACTION = 0.32;

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
/**
 * Fire: tongues that climb, and a scorch that stays behind.
 *
 * The staves had to be as loud as each other. Storm got `lightning` when it was
 * the only magic in the game; fire and ice opened with a ring and a handful of
 * specks, which read — correctly — as the cheap ones. Same budget: ONE `quads`
 * call each, exactly what the bolts cost.
 *
 * The tongues are `flameA`/`flameB` — Kenney's `flame_05`/`flame_06`, actual
 * fire with a curling tip — and they are TALL and never rolled. Two passes got
 * this wrong first: 0.75-square quads spun on their own axis (a pinwheel of
 * orange smudges), then the muzzle flash stretched to twice its height, which
 * reads as a searchlight. The atlas had four cells nothing drew; two of them
 * are flames now.
 *
 * What makes it fire rather than orange lightning is the MOTION. Bolts strike
 * down and vanish; flame climbs, widens and thins, and leaves a mark that
 * outlives it — the mark says something BURNED here, which is what the weapon
 * actually did to everything standing in it.
 */
export function flames(
  vfx: Vfx,
  at: THREE.Vector3,
  opts: {
    radius: number; tongues?: number; color?: number; life?: number;
    /** The scorch and the glow on the floor. TRUE for a cast, which lands on
     *  the ground; FALSE for something burning in mid-air, where a ground decal
     *  is a scorch mark hanging two metres up. The saucers FLY, and this game
     *  has already drawn a burst's rings in the sky once. */
    decals?: boolean;
  },
): void {
  const n = opts.tongues ?? 13;
  const life = opts.life ?? 0.6;
  const list: Quad[] = [];

  if (opts.decals !== false) {
    // The scorch first, so it draws under the rest of the same mesh.
    list.push({ at: new THREE.Vector3(at.x, at.y + 0.03, at.z), frame: FRAME.scorch,
                w: opts.radius * 2.1, h: opts.radius * 2.1, mode: 'ground' });
    list.push({ at: new THREE.Vector3(at.x, at.y + 0.05, at.z), frame: FRAME.glowRing,
                w: opts.radius * 1.3, h: opts.radius * 1.3, mode: 'ground' });
  }

  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + Math.random() * 0.6;
    const r = opts.radius * (0.1 + Math.random() * 0.75);
    const h = 1.3 + Math.random() * 1.0;
    list.push({
      at: new THREE.Vector3(at.x + Math.cos(a) * r, at.y + h * 0.45, at.z + Math.sin(a) * r),
      frame: i % 2 ? FRAME.flameA : FRAME.flameB,
      // Broader than tall-and-thin: a flame is a body of fire, and the pair of
      // source sprites already carry the taper.
      w: h * (0.62 + Math.random() * 0.2), h, mode: 'face',
    });
  }
  list.push({ at: new THREE.Vector3(at.x, at.y + 0.5, at.z), frame: FRAME.flare,
              w: 2.6, h: 2.6, mode: 'face' });

  quads(vfx, list, {
    life,
    // Additive over green grass walks any orange towards yellow-white, so the
    // tint has to start deeper than the fire should look — 0xff8a3c arrived as
    // pale lemon. This lands orange.
    color: opts.color ?? 0xff3606,
    // Hot at once, then guttering. An even fade is a light on a dimmer.
    // 0.62, not 1, and MORE tongues to make up the presence. Measured against a
    // no-cast control: at 0.9 the fire shifted the picture by (+4.6,+3.1,+4.1) —
    // a neutral grey, because an additive white sprite over bright grass clips
    // every channel and takes the hue with it. At 0.62 the same cast shifts it
    // (+28.7,+14.9,+8.8), which is orange. Area at low alpha buys colour; alpha
    // buys white.
    alpha: (k) => (k < 0.12 ? 0.62 : Math.max(0, 0.62 * (1 - ((k - 0.12) / 0.88) ** 0.55))),
    step: (qs, _k, dt) => {
      // The tongues start after the decals, and there are no decals when a
      // caller asked for none. A hard-coded 2 left the first two tongues
      // standing still in exactly the case this option exists for.
      for (let i = opts.decals === false ? 0 : 2; i < qs.length - 1; i++) {
        // Climb, widen, thin. Widening while the alpha drops is what reads as
        // smoke at the end rather than a flame being shrunk.
        qs[i].at.y += dt * 1.9;
        qs[i].w += dt * 0.85;
        qs[i].h += dt * 0.5;
      }
      const flare = qs[qs.length - 1];
      flare.w = Math.max(0.2, flare.w - dt * 3.6);
      flare.h = flare.w;
    },
  });
}

/**
 * Ice: spikes thrown outward along the ground, crystals over them, and a ring
 * that races out and then HOLDS.
 *
 * The opposite motion to fire, deliberately. Flame climbs and widens; frost
 * goes out and stops — it arrives, settles, and sits there, which is what the
 * chill does to the wave standing in it. `strandA`/`strandB` are thin tapered
 * threads, which as flat beams from the middle outward read as spikes of frost
 * that GREW along the ground; `iceShard` is a hard X of spikes standing at the
 * tip of every other one, so the rim ends in something solid instead of a
 * taper. The crescents tried first are swooshes, and a swoosh is a thing that
 * moved past rather than a thing that froze. Same one-draw budget as the
 * other two.
 */
export function frost(
  vfx: Vfx,
  at: THREE.Vector3,
  opts: { radius: number; shards?: number; color?: number; life?: number },
): void {
  const n = opts.shards ?? 14;
  const life = opts.life ?? 0.55;
  const list: Quad[] = [];

  // Two rings: a soft one that carries the colour and a crisp one that draws
  // the EDGE. `frostRing` alone is a hairline once it is stretched to three
  // metres across — a 256px ring at that size is a pencil line, which is how
  // the first pass ended up as a white speck on the grass.
  list.push({ at: new THREE.Vector3(at.x, at.y + 0.04, at.z), frame: FRAME.glowRing,
              w: opts.radius, h: opts.radius, mode: 'ground' });
  list.push({ at: new THREE.Vector3(at.x, at.y + 0.05, at.z), frame: FRAME.frostRing,
              w: opts.radius, h: opts.radius, mode: 'ground' });

  // Crystals lying FLAT around the rim, each turned to point outward. Flat on
  // the ground they read as frost spreading over it; the first pass ran thin
  // `strand` threads out as beams, and a thread stretched across three metres
  // is a hair.
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + Math.random() * 0.2;
    const r = opts.radius * (0.45 + Math.random() * 0.5);
    const size = 1.5 + Math.random() * 0.9;
    list.push({
      at: new THREE.Vector3(at.x + Math.cos(a) * r, at.y + 0.06, at.z + Math.sin(a) * r),
      frame: FRAME.iceShard, w: size, h: size, mode: 'ground', roll: -a,
    });
  }
  // A few standing up, so it has height as well as a footprint.
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + 0.4;
    const r = opts.radius * (0.35 + Math.random() * 0.4);
    const size = 1.3 + Math.random() * 0.7;
    list.push({
      at: new THREE.Vector3(at.x + Math.cos(a) * r, at.y + 0.5, at.z + Math.sin(a) * r),
      frame: FRAME.iceShard, w: size, h: size, mode: 'face',
    });
  }
  list.push({ at: new THREE.Vector3(at.x, at.y + 0.45, at.z), frame: FRAME.starBurst,
              w: 2.4, h: 2.4, mode: 'face' });

  quads(vfx, list, {
    life,
    // Deeper than the ice it tints. Additive over grass walks everything
    // towards white, so a pale blue arrives as a white smudge — the colour has
    // to start further from white than it should end.
    color: opts.color ?? 0x3fb0ff,
    // Holds, THEN goes. Frost that starts fading on the first frame never
    // looks like it settled on anything.
    alpha: (k) => (k < 0.5 ? 0.92 : Math.max(0, 0.92 * (1 - (k - 0.5) / 0.5))),
    step: (qs, k, dt) => {
      // Both rings race out to where the chill actually reaches, and stop
      // there — the edge of the ring IS the edge of the effect.
      const grow = opts.radius * 2 * (0.3 + 0.7 * Math.min(1, k / 0.28));
      qs[0].w = grow; qs[0].h = grow;
      qs[1].w = grow; qs[1].h = grow;
      qs[1].roll = (qs[1].roll ?? 0) + dt * 0.5;
      const flash = qs[qs.length - 1];
      flash.w = Math.max(0.2, flash.w - dt * 3.4);
      flash.h = flash.w;
    },
  });
}

/** A live arc between two MOVING points.
 *
 *  The bolt is a `beam` quad whose ends are the two Vector3s it was handed —
 *  the enemies' own position vectors, not copies — so the arc stays connected
 *  while both ends keep flying. That is the thing a beam primitive buys: the
 *  chain used to flash at each enemy in turn and leave the connection to be
 *  inferred, with a comment saying a connected beam "needs a primitive this
 *  game does not have".
 *
 *  Kept to three quads (the bolt, and a small burst at each end) because a
 *  level-three storm staff draws three of these at once.
 */
export function arcBetween(
  vfx: Vfx,
  from: THREE.Vector3,
  to: THREE.Vector3,
  opts: { color?: number; life?: number; width?: number } = {},
): void {
  const life = opts.life ?? 0.3;
  const frames = [FRAME.boltA, FRAME.boltB, FRAME.strandA, FRAME.strandB];
  const list: Quad[] = [
    { at: from, to, frame: frames[0], w: opts.width ?? 0.85, h: 1, mode: 'beam' },
    { at: from, frame: FRAME.flare, w: 0.7, h: 0.7, mode: 'face' },
    { at: to, frame: FRAME.starBurst, w: 0.9, h: 0.9, mode: 'face' },
  ];
  let flick = 0;
  quads(vfx, list, {
    life,
    color: opts.color ?? 0xa8d4ff,
    alpha: (k) => (k < 0.2 ? 1 : Math.max(0, 1 - ((k - 0.2) / 0.8) ** 0.6)),
    step: (qs, _k, dt) => {
      flick += dt;
      if (flick > 0.04) {
        flick = 0;
        qs[0].frame = frames[Math.floor(Math.random() * frames.length)];
        qs[0].w = 0.7 + Math.random() * 0.5;
      }
      qs[2].w = qs[2].h = qs[2].w + dt * 1.4;
    },
  });
}

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
      // Flicker only while it is STRIKING. Lengthening the effect by raising
      // `life` alone turned a strike into a strobe — twenty-five re-jitters
      // instead of eight, at the same rate, which reads as a broken light
      // rather than a longer bolt. So the first third crackles and the rest
      // holds still and fades, which is what a strike actually looks like.
      flick += dt;
      if (k < STRIKE_FRACTION && flick > 0.045) {
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
