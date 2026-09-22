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
/** Thickness of the slab. Marks sit just above it. */
export const TOP_Y = 0.06;
/** The lens. Long enough that foreshortening is a cue rather than a
 *  distortion — see the note above. */
const FOV_DEG = 22;
/** How far from overhead the player may tilt it. Past this the board is more
 *  edge than face. */
const MAX_POLAR_DEG = 58;

export interface Grid {
  cols: number;
  rows: number;
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

  private grid: Required<Grid> = { cols: 15, rows: 15, margin: 0.62 };
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

  private azimuth = 0;
  private polar = THREE.MathUtils.degToRad(13);
  private zoom = 1;
  private readonly defaults = { azimuth: 0, polar: THREE.MathUtils.degToRad(13), zoom: 1 };

  constructor(canvas: HTMLCanvasElement, grid: Grid) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;

    this.scene.background = new THREE.Color('#1b1d22');
    this.camera = new THREE.PerspectiveCamera(FOV_DEG, 1, 0.1, 100);
    this.plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -TOP_Y);

    // Key light from the front-left so the shadow falls away from the hand
    // holding the phone; fill from the other side so pieces are not half black.
    const key = new THREE.DirectionalLight(0xffffff, 1.45);
    key.position.set(-2.2, 4.2, 2.6);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    const cam = key.shadow.camera as THREE.OrthographicCamera;
    cam.left = -1.6; cam.right = 1.6; cam.top = 1.6; cam.bottom = -1.6;
    cam.near = 0.5; cam.far = 12;
    key.shadow.bias = -0.0009;
    this.scene.add(key);
    this.scene.add(new THREE.HemisphereLight(0xdfe6f2, 0x2a2118, 1.05));

    this.setGrid(grid);
    this.resize();
  }

  /** Change the board's shape. The game rebuilds its own meshes after this —
   *  the metrics it places them with have all moved. */
  setGrid(grid: Grid): void {
    this.grid = { margin: 0.62, ...grid };
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

  orbit(dAzimuth: number, dPolar: number): void {
    this.azimuth += dAzimuth;
    this.polar = THREE.MathUtils.clamp(this.polar + dPolar, 0, THREE.MathUtils.degToRad(MAX_POLAR_DEG));
    this.place();
  }

  zoomBy(factor: number): void {
    this.zoom = THREE.MathUtils.clamp(this.zoom * factor, 0.75, 3);
    this.place();
  }

  resetCamera(): void {
    Object.assign(this, this.defaults);
    this.place();
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
    let r = Math.max(need / Math.tan(vFov / 2), need / Math.tan(hFov / 2)) / this.zoom;

    const sp = Math.sin(this.polar), cp = Math.cos(this.polar);
    const put = (dist: number): void => {
      this.camera.position.set(dist * sp * Math.sin(this.azimuth), dist * cp, dist * sp * Math.cos(this.azimuth));
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
      // 0.94 leaves a little air so nothing touches the edge of the screen.
      r *= worst / 0.94;
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
