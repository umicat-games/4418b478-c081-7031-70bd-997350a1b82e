// The board, drawn.
//
// The camera rig is the Go game's, for the Go game's reasons, and they hold
// here too:
//
// **The camera is a LONG LENS** — perspective, but a narrow one (FOV_DEG).
// Orthographic has no near-and-far at all, and a square board seen from an
// angle with no near-and-far does not look tilted, it looks BENT: opposite
// edges stay exactly parallel and exactly equal and the brain gets no depth
// cue to explain the shape. A long lens keeps the far rank nearly the same
// size as the near one while still giving the eye something to read.
//
// **It is tilted further than the Go board is.** Go is stones on a plane and
// wants to be seen nearly from above; chess pieces are UPRIGHT, and from
// overhead a bishop and a pawn are two circles. Forty-odd degrees is where
// the silhouettes — which are the only thing telling the pieces apart — are
// actually visible, and it is also roughly where a person sitting at a board
// sees them from.
//
// The squares are PAINTED INTO THE BOARD'S TEXTURE rather than laid over it
// as geometry, and so are the file and rank labels. Surfaces sitting a hair
// above another surface z-fight at some camera angles and vanish at others.
// The labels matter more here than they look: the companion talks in
// coordinates, and a beginner who cannot find e4 cannot use a word it says.
import * as THREE from 'three';
import type { ChessGame, Kind, Side } from '../chess/rules';
import { pieceGeometry, bishopSlit, HEIGHT } from './pieces';
import type { Sq } from '../chess/coords';

/** Half-width of the board slab in world units, border included. */
const HALF = 1;
/** The frame around the squares, in squares. Wide enough for the labels. */
const BORDER = 0.38;
const SQUARE = (2 * HALF) / (8 + 2 * BORDER);
/** How much of a square a piece fills. Under 1 so neighbours do not touch. */
const PIECE_SCALE = SQUARE * 0.92;
/** How thick the board is. Thicker than it was, because it is sitting on a
 *  table now and what says "sitting on" is the edge and the shadow. */
const TOP_Y = 0.11;
/** How far the table stretches past the board, in board half-widths. At this
 *  tilt the far edge has to be well outside the frame. */
const TABLE = 7;

/** The lens. Long enough that foreshortening is a cue, not a distortion. */
const FOV_DEG = 22;
/**
 * How far from overhead the camera sits. FIXED.
 *
 * No orbit, no pinch, nothing to recentre: a board game is not a world to
 * look around, and a camera the player can move is a camera they can lose.
 *
 * Unlike the games with flat pieces, this one keeps its tilt. Chess pieces
 * are silhouettes — a knight is a knight because of its profile — and from
 * straight overhead they are all circles. Forty-four degrees is enough to
 * read every piece by shape and not so much that the back rank hides behind
 * the front one.
 *
 * Turning the board around when the player takes Black is a different thing
 * and stays: that is a rule of the game, not a camera control.
 */
const POLAR_DEG = 44;

const KINDS: Kind[] = ['pawn', 'knight', 'bishop', 'rook', 'queen', 'king'];
const SIDES: Side[] = ['white', 'black'];

/** How many of one kind one side can have: two knights plus eight promoted
 *  pawns. Every instanced mesh is built to that, and `sync` will not write
 *  past it — going over is not a visual glitch, it is a GPU buffer overrun. */
const MAX_PER_KIND = 10;

const LIGHT_SQ = '#e9d3ab';
const DARK_SQ = '#9c6a41';
const FRAME = '#5d3a20';

export class BoardView {
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly raycaster = new THREE.Raycaster();
  private readonly plane: THREE.Plane;

  /**
   * Whether the picture on screen is out of date.
   *
   * A chess board does not move between moves. Drawing it sixty times a
   * second anyway costs a whole core — and here that is a core taken from the
   * ENGINE, which is the thing the player is waiting for. So the loop draws
   * when something changed and otherwise does nothing.
   */
  private dirty = true;

  private boardMesh: THREE.Mesh | null = null;
  private pieces: Record<Side, Partial<Record<Kind, THREE.InstancedMesh>>> = { white: {}, black: {} };
  private slits: Record<Side, THREE.InstancedMesh | null> = { white: null, black: null };
  private ghost: THREE.Mesh;
  private ghostKind: Kind | null = null;

  /** Flat overlays, one pooled mesh list per job. Kept apart on purpose: the
   *  bubble sets its focus on every page, and when focus shared the coach's
   *  marks, a sentence with no square in it cleared the mark the coach had
   *  just drawn — so `highlight` appeared to do nothing at all. */
  private tints: Record<'last' | 'select' | 'mark' | 'check', THREE.Mesh[]> = {
    last: [], select: [], mark: [], check: [],
  };
  private focusRing: THREE.Mesh | null = null;
  /** Where the selected piece may go: a dot on an empty square, a ring on a
   *  square with something to take. The universal chess-board language, and
   *  worth following rather than inventing one. */
  private dots: THREE.InstancedMesh | null = null;
  private rings: THREE.InstancedMesh | null = null;

  private insetRight = 0;
  /** Which side of the board the camera sits on. */
  private seat: Side = 'white';

  private azimuth = 0;
  private readonly polar = THREE.MathUtils.degToRad(POLAR_DEG);

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    // PCFSoft was removed in three 0.186; PCF is what it falls back to anyway.
    this.renderer.shadowMap.type = THREE.PCFShadowMap;

    // Near the table's darkest tone, so anything beyond it is not a hole.
    this.scene.background = new THREE.Color('#140e09');
    this.camera = new THREE.PerspectiveCamera(FOV_DEG, 1, 0.1, 100);
    this.plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -TOP_Y);

    const key = new THREE.DirectionalLight(0xfff3e4, 1.9);
    key.position.set(-2.4, 4.6, 2.4);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    const cam = key.shadow.camera as THREE.OrthographicCamera;
    cam.left = -2.8; cam.right = 2.8; cam.top = 2.8; cam.bottom = -2.8;
    cam.near = 0.5; cam.far = 12;
    key.shadow.bias = -0.0008;
    this.scene.add(key);
    // Weaker than it was: fill is the enemy of the shadow that makes the
    // board sit on the table rather than float over it.
    this.scene.add(new THREE.HemisphereLight(0xcfd8e6, 0x170e07, 0.72));

    // The table. The board is an object put down on something now, and this
    // is what its shadow falls on.
    const table = new THREE.Mesh(
      new THREE.PlaneGeometry(2 * HALF * TABLE, 2 * HALF * TABLE).rotateX(-Math.PI / 2),
      new THREE.MeshStandardMaterial({ map: tableTexture(), roughness: 0.78, metalness: 0 }),
    );
    table.position.y = -0.002;  // a hair under the board, so they never z-fight
    table.receiveShadow = true;
    this.scene.add(table);
    // A second, dimmer light from behind. Without it the dark pieces on the
    // near rank are a black hole: their lit side faces away from the camera.
    const rim = new THREE.DirectionalLight(0xbcd2ff, 0.55);
    rim.position.set(2.6, 2.4, -3.0);
    this.scene.add(rim);

    this.ghost = new THREE.Mesh(pieceGeometry('pawn'), new THREE.MeshStandardMaterial({
      color: 0xffffff, roughness: 0.4, transparent: true, opacity: 0.42, depthWrite: false,
    }));
    this.ghost.visible = false;
    this.ghost.renderOrder = 3;
    this.scene.add(this.ghost);

    this.buildBoard();
    this.buildPieces();
    this.buildOverlays();
    this.resize();
  }

  // ── geometry that lives for the whole session ───────────────────────────
  private buildBoard(): void {
    if (this.boardMesh) {
      this.scene.remove(this.boardMesh);
      (this.boardMesh.material as THREE.Material[]).forEach((m) => {
        const mm = m as THREE.MeshStandardMaterial;
        mm.map?.dispose();
        mm.dispose();
      });
      this.boardMesh.geometry.dispose();
    }
    const top = new THREE.MeshStandardMaterial({ map: boardTexture(this.seat), roughness: 0.66, metalness: 0 });
    // The edge of the board, with its own grain — visible now that the slab
    // is thick enough to see.
    const side = new THREE.MeshStandardMaterial({ map: edgeTexture(0x6a3f1e), roughness: 0.7, metalness: 0 });
    // BoxGeometry's material slots are +x, −x, +y, −y, +z, −z: only the top
    // (+y) carries the squares.
    this.boardMesh = new THREE.Mesh(
      new THREE.BoxGeometry(2 * HALF, TOP_Y, 2 * HALF),
      [side, side, top, side, side, side],
    );
    this.boardMesh.position.y = TOP_Y / 2;
    this.boardMesh.castShadow = true;
    this.boardMesh.receiveShadow = true;
    this.scene.add(this.boardMesh);
    this.dirty = true;
  }

  private buildPieces(): void {
    // Ivory and a warm near-black. Not pure black: a black piece in shadow on
    // a dark square is a silhouette with no shape in it, and the near rank is
    // exactly where the light does not reach.
    const skin: Record<Side, THREE.MeshStandardMaterial> = {
      white: new THREE.MeshStandardMaterial({ color: 0xe8dcc6, roughness: 0.42, metalness: 0.02 }),
      black: new THREE.MeshStandardMaterial({ color: 0x35281f, roughness: 0.38, metalness: 0.04 }),
    };
    for (const s of SIDES) {
      for (const k of KINDS) {
        const mesh = new THREE.InstancedMesh(pieceGeometry(k), skin[s], MAX_PER_KIND);
        mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        mesh.count = 0;
        this.scene.add(mesh);
        this.pieces[s][k] = mesh;
      }
      const slitMat = skin[s].clone();
      slitMat.color = skin[s].color.clone().multiplyScalar(0.34);
      const slit = new THREE.InstancedMesh(bishopSlit(), slitMat, MAX_PER_KIND);
      slit.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      slit.castShadow = true;
      slit.count = 0;
      this.scene.add(slit);
      this.slits[s] = slit;
    }
  }

  private buildOverlays(): void {
    const tile = new THREE.PlaneGeometry(SQUARE, SQUARE).rotateX(-Math.PI / 2);
    const mk = (color: number, opacity: number): THREE.Mesh => {
      const m = new THREE.Mesh(tile, new THREE.MeshBasicMaterial({
        color, transparent: true, opacity, depthWrite: false,
      }));
      m.renderOrder = 1;
      m.visible = false;
      this.scene.add(m);
      return m;
    };
    // Two for the last move, one for the piece in hand, eight for the coach's
    // marks, one for a king in check. Pooled rather than made on demand: a
    // material allocated per move is a material leaked per move.
    this.tints.last = [mk(0xf2d24b, 0.34), mk(0xf2d24b, 0.34)];
    this.tints.select = [mk(0x7fe08a, 0.38)];
    this.tints.mark = Array.from({ length: 8 }, () => mk(0x4fd2ff, 0.4));
    this.tints.check = [mk(0xff4b3e, 0.48)];

    // Dots and rings for where a picked-up piece can go.
    const dot = new THREE.CircleGeometry(SQUARE * 0.19, 20).rotateX(-Math.PI / 2);
    const ring = new THREE.RingGeometry(SQUARE * 0.38, SQUARE * 0.48, 28).rotateX(-Math.PI / 2);
    // The same green as the square the piece is standing on, so the whole
    // thing reads as one sentence: this piece, these squares. A neutral dark
    // dot was tried and it disappears on the dark squares, which is half the
    // board — the exact half a beginner most needs the help on.
    const target = (geo: THREE.BufferGeometry): THREE.InstancedMesh => {
      const mesh = new THREE.InstancedMesh(geo, new THREE.MeshBasicMaterial({
        color: 0x7fe08a, transparent: true, opacity: 0.62, depthWrite: false,
      }), 32);
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.renderOrder = 2;
      mesh.count = 0;
      this.scene.add(mesh);
      return mesh;
    };
    this.dots = target(dot);
    this.rings = target(ring);

    // GOLD, where the assistant's own marks are cyan. They are different
    // things and they appear together: the marks are what it chose to ring,
    // the focus is the square the sentence on screen is about. In one colour
    // a player cannot tell which ring the words belong to.
    this.focusRing = new THREE.Mesh(
      new THREE.RingGeometry(SQUARE * 0.42, SQUARE * 0.5, 32).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: 0xffd76a, transparent: true, opacity: 0.9, depthWrite: false }),
    );
    this.focusRing.renderOrder = 4;
    this.focusRing.visible = false;
    this.scene.add(this.focusRing);
  }

  // ── where things are ────────────────────────────────────────────────────
  /** The centre of a square, on the board's surface. */
  private at(x: number, y: number): THREE.Vector3 {
    const o = -(HALF - BORDER * SQUARE) + SQUARE / 2;
    return new THREE.Vector3(o + x * SQUARE, TOP_Y, o + y * SQUARE);
  }

  /** Which square is under this screen point, if any. */
  pick(clientX: number, clientY: number): Sq | null {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1,
    );
    this.raycaster.setFromCamera(ndc, this.camera);
    const hit = new THREE.Vector3();
    if (!this.raycaster.ray.intersectPlane(this.plane, hit)) return null;
    const o = -(HALF - BORDER * SQUARE);
    const x = Math.floor((hit.x - o) / SQUARE);
    const y = Math.floor((hit.z - o) / SQUARE);
    if (x < 0 || y < 0 || x > 7 || y > 7) return null;
    return { x, y };
  }

  /**
   * Where a square is on screen, in CSS pixels — the inverse of `pick`.
   *
   * This is what lets the companion point at things: a bubble anchored to e4
   * has to follow e4 when the camera turns, and "e4" in a chat log is a
   * coordinate a beginner has to work out for themselves.
   */
  screenOf(x: number, y: number): { x: number; y: number } {
    const p = this.at(x, y).project(this.camera);
    const rect = this.renderer.domElement.getBoundingClientRect();
    return {
      x: rect.left + ((p.x + 1) / 2) * rect.width,
      y: rect.top + ((1 - p.y) / 2) * rect.height,
    };
  }

  /** One square, in screen pixels — how far a bubble has to sit from the
   *  square it belongs to in order to clear the piece on it. */
  get screenSpacing(): number {
    const a = this.screenOf(0, 0);
    const b = this.screenOf(1, 0);
    return Math.hypot(a.x - b.x, a.y - b.y);
  }

  // ── what is on it ───────────────────────────────────────────────────────
  /** Put the board on screen in the state the game is in. */
  sync(game: ChessGame): void {
    this.dirty = true;
    const counts: Record<Side, Partial<Record<Kind, number>>> = { white: {}, black: {} };
    const slitCount: Record<Side, number> = { white: 0, black: 0 };
    const m = new THREE.Matrix4();
    const scale = new THREE.Vector3(PIECE_SCALE, PIECE_SCALE, PIECE_SCALE);
    const upright = new THREE.Quaternion();
    // Black's pieces face the other way, which only shows on the knight — and
    // on the knight it is the difference between a set and two of the same
    // horse. Real sets face them at each other.
    const turned = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI);

    for (const p of game.pieces()) {
      const mesh = this.pieces[p.side][p.kind];
      if (!mesh) continue;
      const i = counts[p.side][p.kind] ?? 0;
      // The capacity, not the previous frame's count. Writing past the end of
      // an InstancedMesh's buffer is silent until it is not.
      if (i >= MAX_PER_KIND) continue;
      m.compose(this.at(p.x, p.y), p.side === 'white' ? upright : turned, scale);
      mesh.setMatrixAt(i, m);
      counts[p.side][p.kind] = i + 1;
      if (p.kind === 'bishop' && slitCount[p.side] < MAX_PER_KIND) {
        this.slits[p.side]!.setMatrixAt(slitCount[p.side]++, m);
      }
    }

    for (const s of SIDES) {
      for (const k of KINDS) {
        const mesh = this.pieces[s][k]!;
        mesh.count = counts[s][k] ?? 0;
        mesh.instanceMatrix.needsUpdate = true;
        // Without this the mesh is culled against whatever volume the first
        // frame's instances happened to occupy, and pieces near the edge
        // blink out as the camera turns.
        mesh.computeBoundingSphere();
      }
      const slit = this.slits[s]!;
      slit.count = slitCount[s];
      slit.instanceMatrix.needsUpdate = true;
      slit.computeBoundingSphere();
    }

    const last = game.lastMove;
    this.place(this.tints.last, last ? [last.from, last.to] : []);
    const king = game.inCheck
      ? game.pieces().find((p) => p.kind === 'king' && p.side === game.toPlay)
      : null;
    this.place(this.tints.check, king ? [{ x: king.x, y: king.y }] : []);
  }

  /** The piece the player has picked up, and where it may go. */
  setSelection(at: Sq | null, quiet: Sq[] = [], captures: Sq[] = []): void {
    this.dirty = true;
    this.place(this.tints.select, at ? [at] : []);
    const fill = (mesh: THREE.InstancedMesh | null, squares: Sq[], lift: number): void => {
      if (!mesh) return;
      const m = new THREE.Matrix4();
      squares.forEach((s, i) => {
        if (i >= 32) return;
        const p = this.at(s.x, s.y);
        m.makeTranslation(p.x, TOP_Y + lift, p.z);
        mesh.setMatrixAt(i, m);
      });
      mesh.count = Math.min(squares.length, 32);
      mesh.instanceMatrix.needsUpdate = true;
      mesh.computeBoundingSphere();
    };
    fill(this.dots, quiet, 0.004);
    fill(this.rings, captures, 0.004);
  }

  /** Show (or hide) the move the player has chosen but not confirmed. */
  setGhost(at: Sq | null, kind: Kind | null, side: Side): void {
    this.dirty = true;
    this.ghost.visible = !!at && !!kind;
    if (!at || !kind) return;
    if (kind !== this.ghostKind) {
      this.ghost.geometry = pieceGeometry(kind);
      this.ghostKind = kind;
    }
    const mat = this.ghost.material as THREE.MeshStandardMaterial;
    mat.color.set(side === 'white' ? 0xe8dcc6 : 0x35281f);
    const p = this.at(at.x, at.y);
    this.ghost.position.copy(p);
    this.ghost.scale.setScalar(PIECE_SCALE);
    this.ghost.rotation.y = side === 'white' ? 0 : Math.PI;
  }

  /** Squares the companion is talking about. Empty clears. */
  setHighlights(squares: Sq[]): void {
    this.dirty = true;
    this.place(this.tints.mark, squares.slice(0, this.tints.mark.length));
  }

  /** The one square the sentence on screen is about. Kept apart from the
   *  marks above — see the note on `tints`. */
  setFocus(at: Sq | null): void {
    this.dirty = true;
    if (!this.focusRing) return;
    this.focusRing.visible = !!at;
    if (!at) return;
    const p = this.at(at.x, at.y);
    this.focusRing.position.set(p.x, TOP_Y + 0.006, p.z);
  }

  private place(pool: THREE.Mesh[], squares: Sq[]): void {
    pool.forEach((mesh, i) => {
      const s = squares[i];
      mesh.visible = !!s;
      if (!s) return;
      const p = this.at(s.x, s.y);
      mesh.position.set(p.x, TOP_Y + 0.002, p.z);
    });
  }

  // ── the camera ──────────────────────────────────────────────────────────
  /**
   * Which side of the board the player sits on.
   *
   * Two things change, and forgetting either one is the bug: the camera goes
   * round to the other side, and the labels are repainted the right way up
   * for the new seat. A board with a1 in the far corner and the "1" printed
   * upside down is worse than no labels.
   */
  setSeat(side: Side): void {
    if (side === this.seat) return;
    this.seat = side;
    this.buildBoard();
    // The camera moves to the other end of the table with the player. This is
    // the one thing that moves it, and it is a rule of the game rather than a
    // control: see POLAR_DEG.
    this.frame();
  }

  private get baseAzimuth(): number { return this.seat === 'white' ? 0 : Math.PI; }




  /**
   * Keep this many pixels on the right clear.
   *
   * The chat panel opens over the right-hand side, and a board that stays
   * centred in the window ends up half behind it. The camera is reframed to
   * centre the board in what is LEFT, which on a wide screen costs nothing.
   */
  reserveRight(px: number): void {
    this.insetRight = Math.max(0, px);
    this.resize();
  }

  /**
   * Re-derive the camera from the seat and the viewport.
   *
   * With a perspective camera the framing is the DISTANCE, not a frustum: back
   * off until the board fits. The fit measures where
   * the CORNERS actually land, rather than backing off far enough for the
   * bounding sphere — a board seen from above covers a square, not a circle,
   * and a sphere fit leaves a third of the screen empty.
   *
   * Unlike the Go board, the corners are not the whole story: a king on the
   * back rank is 1.5 squares tall and pokes out above the board's own box, so
   * the fit measures a volume that includes it. Without that the tallest piece
   * on the far rank is guillotined by the top of the screen.
   */
  private frame(): void {
    this.dirty = true;
    const w = window.innerWidth, h = window.innerHeight;
    const vFov = THREE.MathUtils.degToRad(FOV_DEG);
    const usable = Math.max(1, w - this.insetRight);
    const hFov = 2 * Math.atan(Math.tan(vFov / 2) * (usable / h));
    const need = HALF * Math.SQRT2 * 1.06;
    let r = Math.max(need / Math.tan(vFov / 2), need / Math.tan(hFov / 2));

    const az = this.baseAzimuth + this.azimuth;
    const sp = Math.sin(this.polar), cp = Math.cos(this.polar);
    const put = (dist: number): void => {
      this.camera.position.set(dist * sp * Math.sin(az), dist * cp, dist * sp * Math.cos(az));
      this.camera.lookAt(0, 0, 0);
      // Slide the whole picture left by half the covered strip, so the board
      // sits in the middle of what is VISIBLE rather than of the window.
      if (this.insetRight > 0) this.camera.setViewOffset(w, h, this.insetRight / 2, 0, w, h);
      else this.camera.clearViewOffset();
      this.camera.updateProjectionMatrix();
      this.camera.updateMatrixWorld();
    };
    put(r);

    const top = TOP_Y + HEIGHT.king * PIECE_SCALE;
    const v = new THREE.Vector3();
    for (let i = 0; i < 4; i++) {
      let worst = 0;
      for (const cx of [-HALF, HALF]) {
        for (const cz of [-HALF, HALF]) {
          for (const cy of [0, top]) {
            v.set(cx, cy, cz).project(this.camera);
            worst = Math.max(worst, Math.abs(v.x), Math.abs(v.y));
          }
        }
      }
      if (!Number.isFinite(worst) || worst <= 0) break;
      // 0.94 leaves a little air so nothing touches an edge of the screen.
      // 0.86: the board is on a table, and some of the table has to be in
      // frame or it is not a table, it is a backdrop.
      r *= worst / 0.86;
      put(r);
    }
  }

  resize(): void {
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.frame();
  }

  /** Draw, if there is anything new to draw. Returns whether it did, so the
   *  DOM overlays pinned to squares know when to follow. */
  render(): boolean {
    if (!this.dirty) return false;
    this.dirty = false;
    this.renderer.render(this.scene, this.camera);
    return true;
  }

  invalidate(): void { this.dirty = true; }
}

/**
 * The squares, the frame and the labels, painted once into a canvas.
 *
 * Canvas row 0 is the FAR side of the board, which is `y = 0`, which is rank
 * 8 — so this function draws a printed diagram and the world agrees with it.
 * (Verified by rendering: `flipY` on a CanvasTexture puts the canvas's top row
 * at v = 1, and on the box's +y face v = 1 is −z.) The labels are the only
 * thing that would ever reveal a mirror, which is exactly why they are worth
 * having.
 */
function boardTexture(seat: Side): THREE.CanvasTexture {
  const px = 1024;
  const c = document.createElement('canvas');
  c.width = c.height = px;
  const ctx = c.getContext('2d')!;
  const unit = px / (8 + 2 * BORDER);
  const edge = BORDER * unit;

  ctx.fillStyle = FRAME;
  ctx.fillRect(0, 0, px, px);
  // Grain on the frame: enough to stop it reading as a flat brown border.
  for (let i = 0; i < 160; i++) {
    const y = Math.random() * px;
    ctx.strokeStyle = `rgba(${120 + Math.random() * 50},${75 + Math.random() * 30},${40 + Math.random() * 25},${0.06 + Math.random() * 0.08})`;
    ctx.lineWidth = 1 + Math.random() * 3;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.bezierCurveTo(px * 0.3, y + (Math.random() - 0.5) * 20, px * 0.7, y + (Math.random() - 0.5) * 20, px, y + (Math.random() - 0.5) * 10);
    ctx.stroke();
  }

  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      // a1 is dark, and a1 is x = 0, y = 7. `(x + y) % 2 === 0` is light.
      ctx.fillStyle = (x + y) % 2 === 0 ? LIGHT_SQ : DARK_SQ;
      ctx.fillRect(edge + x * unit, edge + y * unit, unit + 0.5, unit + 0.5);
    }
  }

  // The labels, the right way up for whoever is sitting there. From Black's
  // seat the whole board is seen from the other end, so the text has to be
  // turned over with it.
  ctx.fillStyle = 'rgba(244,228,205,0.82)';
  ctx.font = `600 ${Math.round(edge * 0.56)}px system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const label = (text: string, cx: number, cy: number): void => {
    ctx.save();
    ctx.translate(cx, cy);
    if (seat === 'black') ctx.rotate(Math.PI);
    ctx.fillText(text, 0, 0);
    ctx.restore();
  };
  for (let x = 0; x < 8; x++) {
    const file = 'abcdefgh'[x];
    const cx = edge + (x + 0.5) * unit;
    label(file, cx, edge * 0.5);
    label(file, cx, px - edge * 0.5);
  }
  for (let y = 0; y < 8; y++) {
    const rank = String(8 - y);
    const cy = edge + (y + 0.5) * unit;
    label(rank, edge * 0.5, cy);
    label(rank, px - edge * 0.5, cy);
  }

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
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

  ctx.fillStyle = '#3b2a1d';
  ctx.fillRect(0, 0, px, px);

  // Grain: many fine lines along one axis, with slow waves, so the eye reads a
  // direction. Dark board, dark table — the contrast between them is the
  // board's edge and its shadow, not their colours.
  for (let i = 0; i < 520; i++) {
    const y = Math.random() * px;
    const dark = Math.random() < 0.55;
    ctx.strokeStyle = dark
      ? `rgba(26,17,10,${0.10 + Math.random() * 0.16})`
      : `rgba(120,86,56,${0.05 + Math.random() * 0.10})`;
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

/** The board's own edge: end grain, lighter than the table it stands on. */
function edgeTexture(base = 0xc99a5d): THREE.CanvasTexture {
  const px = 256;
  const c = document.createElement('canvas');
  c.width = px;
  c.height = 64;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = `#${base.toString(16).padStart(6, '0')}`;
  ctx.fillRect(0, 0, px, 64);
  for (let i = 0; i < 90; i++) {
    const y = Math.random() * 64;
    ctx.strokeStyle = `rgba(${90 + Math.random() * 40},${60 + Math.random() * 30},${30 + Math.random() * 20},${0.06 + Math.random() * 0.12})`;
    ctx.lineWidth = 0.5 + Math.random() * 1.6;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(px, y + (Math.random() - 0.5) * 6);
    ctx.stroke();
  }
  // The underside of the board is in its own shadow; the top edge catches the
  // lamp. A vertical gradient is the cheapest way to say both.
  const shade = ctx.createLinearGradient(0, 0, 0, 64);
  shade.addColorStop(0, 'rgba(255,240,215,0.18)');
  shade.addColorStop(1, 'rgba(20,12,6,0.42)');
  ctx.fillStyle = shade;
  ctx.fillRect(0, 0, px, 64);

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}
