// The board rig: the camera, the hit-testing, and the marks.
//
// This is the half of "drawing a board" that every game in this family got
// letter for letter the same — Go, chess, xiangqi and now gomoku — so it lives
// in the shell and the game supplies only what its board LOOKS like.
//
// Two decisions here are load-bearing and everything else follows:
//
// **The camera is a LONG LENS** — perspective, but a narrow one — not an
// orthographic camera. Orthographic was tried first, for a real reason: a wide
// lens makes the far half of the board smaller and tighter, so the same finger
// lands on a different-sized target depending where it is. But orthographic
// has no near-and-far at all, and a flat board seen from an angle with no
// near-and-far does not look tilted, it looks BENT — opposite edges stay
// exactly parallel, the eye gets no depth cue, and the board reads as a
// squashed rhombus. A long lens gets both: measured on a 19x19, one space at
// the back is 8% tighter than at the front, which is well inside the slack
// `pick()` allows and is the whole cue the eye needs.
//
// **It is tilted a little, not straight down.** From directly overhead a stone
// is a flat disc and the point of drawing it in 3D disappears.
//
// What the GAME owns: the wood, the painted grid, the pieces. It builds them
// into `scene`, placing things with `at(x, y)`, and rebuilds them when
// `setGrid` changes the board. What the rig owns: everything that has to agree
// with the camera — where a cell is on screen, which cell a finger is on, and
// the rings and dots that the assistant and the selection draw.
import * as THREE from 'three';

/** Half the longer side of the board slab, in world units. */
const HALF = 1;
/** Thickness of the slab. Marks sit just above it. Thick enough that the
 *  board's edge and the shadow it drops say it is an object on a table. */
export const TOP_Y = 0.1;
/** How far the table stretches past the board, in board half-widths. */
const TABLE = 5;
/** The lens. Long enough that foreshortening is a cue rather than a
 *  distortion — see the note above. */
const FOV_DEG = 22;
/**
 * How far the camera is tilted from overhead, by default. Zero: straight down.
 *
 * FIXED, whatever the value: no orbit, no pinch, nothing to recentre. A board
 * game is not a world to look around — the position is the same information
 * from every angle — so a camera the player can move is a camera they can
 * lose.
 *
 * Zero is right for a game of flat pieces on a grid, and it is the one angle
 * at which a square board is a SQUARE; any tilt makes it a trapezoid and
 * closes up the far rows. A game whose pieces are three-dimensional wants
 * some tilt instead, and passes it in — see `Grid.tilt`.
 */
const DEFAULT_TILT_DEG = 0;

export interface Grid {
  cols: number;
  rows: number;
  /** Degrees off vertical. Omit for straight down; a game with pieces that
   *  have a silhouette worth seeing passes 15-20. */
  tilt?: number;
  /** How much wood there is outside the outermost line, in spacings. At least
   *  half a spacing, or a corner stone hangs off the board into mid-air. */
  margin?: number;
}

export interface Point { x: number; y: number }

export class BoardRig {
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly raycaster = new THREE.Raycaster();
  private readonly plane: THREE.Plane;

  private grid: Required<Grid> = { cols: 15, rows: 15, margin: 0.62, tilt: DEFAULT_TILT_DEG };
  spacing = 0;
  halfX = 0;
  halfZ = 0;
  margin = 0;

  /**
   * Whether the picture on screen is out of date.
   *
   * A board between moves is a still life. Drawing it sixty times a second
   * costs a core — and on these games that is a core taken from the ENGINE,
   * which is what the player is actually waiting for. Every mutator sets this;
   * `render()` returns whether it drew, so the DOM overlays pinned to cells
   * know when to follow.
   */
  private dirty = true;

  private highlights: THREE.Mesh[] = [];
  private dots: THREE.Mesh[] = [];
  private focusRing: THREE.Mesh | null = null;
  private selectRing: THREE.Mesh | null = null;
  private insetRight = 0;

  private readonly azimuth = 0;
  private polar = THREE.MathUtils.degToRad(DEFAULT_TILT_DEG);

  constructor(canvas: HTMLCanvasElement, grid: Grid) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;

    // Near the table's darkest tone, so any sliver beyond it is not a hole.
    this.scene.background = new THREE.Color('#d5cec0');
    this.camera = new THREE.PerspectiveCamera(FOV_DEG, 1, 0.1, 100);
    this.plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -TOP_Y);

    // Low (about thirty degrees above the table, not forty-five: a high lamp
    // drops the board's shadow straight down and there is nothing to see —
    // and from overhead that shadow is the only thing left saying the board
    // has any thickness) and from the top left, so shadows fall down and to
    // the right the way a photograph of a table reads.
    const key = new THREE.DirectionalLight(0xfff1dc, 1.82);
    key.position.set(-3.1, 2.3, -2.1);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    const cam = key.shadow.camera as THREE.OrthographicCamera;
    cam.left = -2.6; cam.right = 2.6; cam.top = 2.6; cam.bottom = -2.6;
    cam.near = 0.5; cam.far = 12;
    key.shadow.bias = -0.0008;
    key.shadow.normalBias = 0.02;
    this.scene.add(key);
    // Enough fill that a piece is not half black, and no more: fill is the
    // enemy of the shadow that makes the board sit on the table.
    this.scene.add(new THREE.HemisphereLight(0xcfd8e6, 0xb8b2a6, 0.84));
    // A little warmth bouncing back off the table.
    const bounce = new THREE.DirectionalLight(0xffeeda, 0.34);
    bounce.position.set(2.4, 1.2, 1.8);
    this.scene.add(bounce);

    // The table. Every game in this family is a board put down on something;
    // the table is what makes it an object rather than a texture floating in
    // the dark, and it is what the board's shadow falls on.
    const table = new THREE.Mesh(
      new THREE.PlaneGeometry(2 * HALF * TABLE, 2 * HALF * TABLE).rotateX(-Math.PI / 2),
      new THREE.MeshStandardMaterial({ map: tableTexture(), roughness: 0.95, metalness: 0 }),
    );
    table.position.y = -0.002;  // a hair under the board, so they never z-fight
    table.receiveShadow = true;
    this.scene.add(table);

    this.setGrid(grid);
    this.resize();
  }

  /** Change the board's shape. The game rebuilds its own meshes after this —
   *  the metrics it places them with have all moved. */
  setGrid(grid: Grid): void {
    this.grid = { margin: 0.62, tilt: DEFAULT_TILT_DEG, ...grid };
    this.polar = THREE.MathUtils.degToRad(this.grid.tilt);
    const { cols, rows, margin } = this.grid;
    const longer = Math.max(cols, rows);
    this.spacing = (2 * HALF) / (longer - 1 + 2 * margin);
    this.margin = this.spacing * margin;
    this.halfX = (this.spacing * (cols - 1)) / 2 + this.margin;
    this.halfZ = (this.spacing * (rows - 1)) / 2 + this.margin;
    this.dirty = true;
    this.place();
  }

  get cols(): number { return this.grid.cols; }
  get rows(): number { return this.grid.rows; }

  /** World position of a cell. Everything the game draws is placed through
   *  this, which is what keeps the picture and the hit-testing in step. */
  at(x: number, y: number): THREE.Vector3 {
    return new THREE.Vector3(
      -(this.halfX - this.margin) + x * this.spacing,
      TOP_Y,
      -(this.halfZ - this.margin) + y * this.spacing,
    );
  }

  // ── screen and pointer ──────────────────────────────────────────────────

  /** Where a cell is on screen, in CSS pixels — the inverse of `pick`. This is
   *  what lets the assistant point at things: a bubble anchored to H8 has to
   *  follow H8 when the camera turns. */
  screenOf(x: number, y: number): Point {
    const p = this.at(x, y).project(this.camera);
    const rect = this.renderer.domElement.getBoundingClientRect();
    return {
      x: rect.left + ((p.x + 1) / 2) * rect.width,
      y: rect.top + ((1 - p.y) / 2) * rect.height,
    };
  }

  /** One spacing, in screen pixels — how far a bubble has to sit from the cell
   *  it belongs to in order to clear the piece on it. */
  get screenSpacing(): number {
    const a = this.screenOf(0, 0);
    const b = this.screenOf(1, 0);
    return Math.hypot(a.x - b.x, a.y - b.y);
  }

  /** Which cell is under this screen point, if any is close enough. */
  pick(clientX: number, clientY: number, slack = 0.55): Point | null {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1,
    );
    this.raycaster.setFromCamera(ndc, this.camera);
    const hit = new THREE.Vector3();
    if (!this.raycaster.ray.intersectPlane(this.plane, hit)) return null;

    const x = Math.round((hit.x + (this.halfX - this.margin)) / this.spacing);
    const y = Math.round((hit.z + (this.halfZ - this.margin)) / this.spacing);
    if (x < 0 || y < 0 || x >= this.grid.cols || y >= this.grid.rows) return null;
    const p = this.at(x, y);
    // Past the slack the player is pointing at a different cell and would
    // rather be told nothing than be given the wrong one.
    if (Math.hypot(hit.x - p.x, hit.z - p.z) > this.spacing * slack) return null;
    return { x, y };
  }

  // ── marks ───────────────────────────────────────────────────────────────

  /**
   * Cells the assistant is talking about (cyan rings).
   *
   * Kept apart from `setFocus`, and that separation is load-bearing: they
   * shared one list in the Go game, and a sentence with no coordinate in it
   * cleared the rings the assistant had just drawn — so marking worked and was
   * invisible.
   */
  setHighlights(points: Point[]): void {
    this.dirty = true;
    while (this.highlights.length < points.length) {
      this.highlights.push(this.addRing(0x4fd2ff, 0.46, 0.07));
    }
    this.highlights.forEach((ring, i) => this.putRing(ring, points[i], 0.44));
  }

  /** The cell the sentence on screen is about (gold ring). */
  setFocus(at: Point | null): void {
    this.dirty = true;
    if (!this.focusRing) this.focusRing = this.addRing(0xffd76a, 0.50, 0.055);
    this.putRing(this.focusRing, at, 0.46);
  }

  /** The cell the player has chosen (gold ring, fatter). */
  setSelection(at: Point | null): void {
    this.dirty = true;
    if (!this.selectRing) this.selectRing = this.addRing(0xffd76a, 0.54, 0.06);
    this.putRing(this.selectRing, at, 0.46);
  }

  /** Where a move could go (dots, not rings — rings are the assistant's, and a
   *  board where everything is a ring says nothing). */
  setDestinations(points: Point[]): void {
    this.dirty = true;
    while (this.dots.length < points.length) {
      const dot = new THREE.Mesh(
        new THREE.CircleGeometry(0.16, 20).rotateX(-Math.PI / 2),
        new THREE.MeshBasicMaterial({ color: 0x53d7b6, transparent: true, opacity: 0.85, depthWrite: false }),
      );
      dot.renderOrder = 2;
      this.scene.add(dot);
      this.dots.push(dot);
    }
    this.dots.forEach((dot, i) => {
      const p = points[i];
      dot.visible = !!p;
      if (!p) return;
      dot.scale.setScalar(this.spacing);
      const at = this.at(p.x, p.y);
      dot.position.set(at.x, TOP_Y + this.spacing * 0.30, at.z);
    });
  }

  private addRing(color: number, radius: number, tube: number): THREE.Mesh {
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(radius, tube, 8, 28),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.92 }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.renderOrder = 3;
    this.scene.add(ring);
    return ring;
  }

  private putRing(ring: THREE.Mesh, at: Point | null | undefined, lift: number): void {
    ring.visible = !!at;
    if (!at) return;
    ring.scale.setScalar(this.spacing);
    const p = this.at(at.x, at.y);
    ring.position.set(p.x, TOP_Y + this.spacing * lift, p.z);
  }

  // ── camera ──────────────────────────────────────────────────────────────

  /** Keep this many pixels on the right clear — the chat panel opens there,
   *  and a board that stays centred in the window ends up half behind it. */
  reserveRight(px: number): void {
    this.insetRight = Math.max(0, px);
    this.resize();
  }




  /**
   * Re-derive the camera from azimuth/polar/zoom and the viewport.
   *
   * With a perspective camera the framing is the DISTANCE, not a frustum: back
   * off until the board fits, then divide by the zoom. Then fit for real by
   * asking where the corners actually land — the alternative, backing off far
   * enough for the bounding SPHERE, is correct at every angle and wasteful at
   * all but one of them, and leaves a third of the screen empty.
   */
  private place(): void {
    this.dirty = true;
    const w = window.innerWidth, h = window.innerHeight;
    const vFov = THREE.MathUtils.degToRad(FOV_DEG);
    const need = Math.hypot(this.halfX, this.halfZ) * 1.06;
    const usable = Math.max(1, w - this.insetRight);
    const hFov = 2 * Math.atan(Math.tan(vFov / 2) * (usable / h));
    let r = Math.max(need / Math.tan(vFov / 2), need / Math.tan(hFov / 2));

    const sp = Math.sin(this.polar), cp = Math.cos(this.polar);
    const put = (dist: number): void => {
      this.camera.position.set(dist * sp * Math.sin(this.azimuth), dist * cp, dist * sp * Math.cos(this.azimuth));
      // Which way is up, on screen. It has to be said out loud for a camera
      // looking straight down: the default up is the direction it is looking
      // along, `lookAt` cannot resolve that, and the board arrives rotated
      // arbitrarily or as NaN.
      this.camera.up.set(0, 0, -1);
      this.camera.lookAt(0, 0, 0);
      // Slide the picture left by half the covered strip, so the board sits in
      // the middle of what is VISIBLE rather than of the window.
      if (this.insetRight > 0) this.camera.setViewOffset(w, h, this.insetRight / 2, 0, w, h);
      else this.camera.clearViewOffset();
      this.camera.updateProjectionMatrix();
      this.camera.updateMatrixWorld();
    };
    put(r);

    const v = new THREE.Vector3();
    for (let i = 0; i < 4; i++) {
      let worst = 0;
      for (const cx of [-this.halfX, this.halfX]) {
        for (const cz of [-this.halfZ, this.halfZ]) {
          for (const cy of [0, TOP_Y]) {
            v.set(cx, cy, cz).project(this.camera);
            worst = Math.max(worst, Math.abs(v.x), Math.abs(v.y));
          }
        }
      }
      if (!Number.isFinite(worst) || worst <= 0) break;
      // 0.84, not 0.94: the board is on a table, and some of the table has to
      // be in frame or it is not a table, it is a backdrop.
      r *= worst / 0.84;
      put(r);
    }
  }

  resize(): void {
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.place();
  }

  /** Draw, if there is anything new to draw. */
  render(): boolean {
    if (!this.dirty) return false;
    this.dirty = false;
    this.renderer.render(this.scene, this.camera);
    return true;
  }

  /** Something changed; draw on the next frame. */
  invalidate(): void { this.dirty = true; }
}

/**
 * The table's own tone.
 *
 * Its LUMINANCE is the load-bearing part — that is what holds the board off
 * the background — and the hue is taste. **Warmth is not free to choose by
 * eye**: pushing a colour warmer at the same numbers makes it DARKER, because
 * green carries 71% of luminance and warming is mostly taking green down. A
 * hand-picked warm hex is a table that is quietly warmer AND dimmer, and the
 * gap this was all for comes back in. Solve for green instead: fix red and
 * blue where the warmth wants them, then binary-search green until the
 * relative luminance matches. Four warmths were rendered that way and
 * compared; this is the second, which is as warm as it goes before two things
 * start to cost. The table joins the board's own hue family, which is what it
 * was moved away from; and light pieces, being neutral ivory, read grey
 * against a cream surface.
 */
const TABLE_TONE = '#ede5d0';

/**
 * The table the board sits on.
 *
 * **Not wood.** It was dark walnut, then pale wood, and the pale wood was
 * measured off the canvas: the board and the table came out at the SAME
 * luminance — 1.01:1 here, 1.08:1 on the Go board, 1.02:1 on the Gomoku one.
 * What separated board from table was hue and nothing else, which is what
 * "the whole screen is one brown photograph" actually is.
 *
 * So the table stopped being wood. It is a matte pale stone: flat, quiet, a
 * good deal lighter than anything on the board, and with **no grain** — a
 * texture on the table competes with the grid, which is the only texture
 * anybody is meant to be reading.
 *
 * The only thing painted into it is a very faint noise. A flat fill is not
 * cleaner: an 8-bit gradient across a plane this size bands, and the banding
 * is far more visible than the grain it replaced. Two per cent of noise is
 * what a frosted surface looks like anyway.
 */
function tableTexture(): THREE.CanvasTexture {
  const px = 512;
  const c = document.createElement('canvas');
  c.width = c.height = px;
  const ctx = c.getContext('2d')!;

  ctx.fillStyle = TABLE_TONE;
  ctx.fillRect(0, 0, px, px);

  // The frost. Per-pixel, monochrome, and small — it exists to break up the
  // gradient, not to be seen.
  const img = ctx.getImageData(0, 0, px, px);
  for (let i = 0; i < img.data.length; i += 4) {
    const n = (Math.random() - 0.5) * 11;
    img.data[i] += n; img.data[i + 1] += n; img.data[i + 2] += n;
  }
  ctx.putImageData(img, 0, 0);

  // The room falling away at the edges. Baked rather than lit, because a
  // light that did this would also darken the board — and NEUTRAL, because a
  // warm vignette on a pale surface reads as a stain rather than as distance.
  const vignette = ctx.createRadialGradient(px / 2, px / 2, px * 0.18, px / 2, px / 2, px * 0.62);
  vignette.addColorStop(0, 'rgba(0,0,0,0)');
  vignette.addColorStop(1, 'rgba(64,66,72,0.20)');
  ctx.fillStyle = vignette;
  ctx.fillRect(0, 0, px, px);

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}
