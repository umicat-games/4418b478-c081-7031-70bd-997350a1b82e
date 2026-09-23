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
    this.scene.background = new THREE.Color('#140e09');
    this.camera = new THREE.PerspectiveCamera(FOV_DEG, 1, 0.1, 100);
    this.plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -TOP_Y);

    // Low (about thirty degrees above the table, not forty-five: a high lamp
    // drops the board's shadow straight down and there is nothing to see —
    // and from overhead that shadow is the only thing left saying the board
    // has any thickness) and from the top left, so shadows fall down and to
    // the right the way a photograph of a table reads.
    // Brighter than the other games in the family: this board is dark green
    // felt, and a white disc on it came out grey at 2.0. Measured rather than
    // eyeballed — see the note in board.ts.
    const key = new THREE.DirectionalLight(0xfff1dc, 2.6);
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
    this.scene.add(new THREE.HemisphereLight(0xdde6f2, 0x140c06, 0.95));
    // A little warmth bouncing back off the table.
    const bounce = new THREE.DirectionalLight(0xffd9a8, 0.28);
    bounce.position.set(2.4, 1.2, 1.8);
    this.scene.add(bounce);

    // The table. Every game in this family is a board put down on something;
    // the table is what makes it an object rather than a texture floating in
    // the dark, and it is what the board's shadow falls on.
    const table = new THREE.Mesh(
      new THREE.PlaneGeometry(2 * HALF * TABLE, 2 * HALF * TABLE).rotateX(-Math.PI / 2),
      new THREE.MeshStandardMaterial({ map: tableTexture(), roughness: 0.78, metalness: 0 }),
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
 * The table the board sits on.
 *
 * Dark walnut, drawn rather than photographed so it costs nothing to ship and
 * can be lit by the same lamp as everything else. Three things make it read
 * as wood rather than as brown: long grain that runs one way, a few darker
 * streaks that do not, and a vignette so the corners of the room fall away.
 */
function tableTexture(): THREE.CanvasTexture {
  const px = 1024;
  const c = document.createElement('canvas');
  c.width = c.height = px;
  const ctx = c.getContext('2d')!;

  // The table's wood.
  //
  // It used to be `#3b2a1d`, which is a dark walnut — and with a low key and
  // a weak fill (both of which the shadow needs) that came out at a measured
  // luminance of 38 out of 255 across most of the screen. The board reads at
  // 135; the room around it was the dark part, and the game looked dim
  // because two thirds of it was.
  //
  // Lifted twice: first to a mid walnut, then further, because at 47 the
  // black pieces standing above the far edge of a chess board were still
  // being read against it. Measured after: the table goes 38 -> 73 and the
  // shadow beside the board goes 20 -> 31, so the difference that makes the
  // board an object sitting on something is unchanged (18 -> 19). The
  // brightness was never paying for the shadow.
  ctx.fillStyle = '#6b5238';
  ctx.fillRect(0, 0, px, px);

  // Grain: many fine lines along one axis, with slow waves, so the eye reads a
  // direction. Dark board, dark table — the contrast between them is the
  // board's edge and its shadow, not their colours.
  for (let i = 0; i < 520; i++) {
    const y = Math.random() * px;
    const dark = Math.random() < 0.55;
    ctx.strokeStyle = dark
      ? `rgba(26,17,10,${0.10 + Math.random() * 0.16})`
      : `rgba(150,114,78,${0.05 + Math.random() * 0.10})`;
    ctx.lineWidth = 0.6 + Math.random() * 2.6;
    ctx.beginPath();
    ctx.moveTo(-10, y);
    ctx.bezierCurveTo(px * 0.3, y + (Math.random() - 0.5) * 40, px * 0.7, y + (Math.random() - 0.5) * 40, px + 10, y + (Math.random() - 0.5) * 18);
    ctx.stroke();
  }
  // A few knots' worth of darker cloud, so the grain is not a barcode.
  for (let i = 0; i < 14; i++) {
    const x = Math.random() * px, y = Math.random() * px;
    const r = px * (0.06 + Math.random() * 0.12);
    const blob = ctx.createRadialGradient(x, y, 0, x, y, r);
    blob.addColorStop(0, 'rgba(22,14,8,0.22)');
    blob.addColorStop(1, 'rgba(22,14,8,0)');
    ctx.fillStyle = blob;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }

  // The room falling away at the edges. Baked in rather than lit, because a
  // light that did this would also darken the board.
  const vignette = ctx.createRadialGradient(px / 2, px / 2, px * 0.18, px / 2, px / 2, px * 0.62);
  vignette.addColorStop(0, 'rgba(0,0,0,0)');
  vignette.addColorStop(1, 'rgba(0,0,0,0.72)');
  ctx.fillStyle = vignette;
  ctx.fillRect(0, 0, px, px);

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}
