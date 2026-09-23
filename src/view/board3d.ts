// The board, drawn.
//
// The camera decisions are the Go game's, and they were right for the same
// reasons: a LONG LENS (a narrow perspective, not an orthographic camera)
// because a flat board seen with no near-and-far does not look tilted, it
// looks bent; a small tilt rather than straight down, because from directly
// overhead a piece is a disc and there was no reason to draw it in 3D; and the
// whole board PAINTED INTO ONE TEXTURE, because lines floating a hair above a
// surface z-fight at some angles and vanish at others.
//
// What is different from Go is the board itself, and all of it is visible:
//
//   • the grid is 9 by 10 and pieces stand on the INTERSECTIONS, so the slab
//     is not square and the texture must not be either, or the grid comes out
//     stretched in one direction;
//   • the RIVER splits every file except the two edges — the gap is the board
//     saying where elephants may not go;
//   • each end has a PALACE with its diagonals, which is the only place a king
//     or an advisor ever stands;
//   • the little crosses beside the cannon and soldier points are not
//     decoration, they are where the pieces start, and a board without them
//     reads as a draughts board to anyone who knows the game;
//   • a piece is a disc with a CHARACTER on it, and the character is how you
//     tell a horse from a cannon. That is a texture per piece type per side,
//     painted once at boot.
import * as THREE from 'three';
import { FILES, RANKS, RED, fileOf, rankOf, sideOf, typeOf, type PieceType, type Side, type XiangqiGame } from '../xiangqi/rules';

/** How long a piece takes to be carried, and how long one that has been
 *  taken takes to leave. Taking is FASTER: it is the consequence, and it has
 *  to be out of the way before the other piece lands. */
const MOVE_MS = 260;
const TAKE_MS = 380;
const easeOut = (t: number): number => 1 - (1 - t) * (1 - t);
const easeInOut = (t: number): number => (t < 0.5 ? 2 * t * t : 1 - ((-2 * t + 2) ** 2) / 2);

interface Flight {
  piece: PieceMesh;
  from: THREE.Vector3;
  to: THREE.Vector3;
  lift: number;
  start: number;
  ms: number;
  fade: boolean;
  /** A square `sync()` must leave empty until this lands. */
  hide: number | null;
}

/** Half the longer side of the slab, in world units. */
const HALF = 1;
/** How much wood there is outside the outermost line, in spacings. */
const MARGIN_RATIO = 0.62;
/**
 * How thick the board is.
 *
 * Thicker than it was, because the board is sitting on a table now rather
 * than floating on a flat colour, and what says "sitting on" is the edge you
 * can see and the shadow it drops.
 */
const TOP_Y = 0.1;
/** How far the table stretches past the board, in board half-widths. */
const TABLE = 5;
const FOV_DEG = 22;
/**
 * How far the camera is tilted from overhead. Zero: straight down.
 *
 * FIXED, and that is the whole camera: no orbit, no pinch, nothing to
 * recentre. A board game is not a world to look around — the position is the
 * same information from every angle — so a camera the player can move is a
 * camera they can lose. Straight down is also the one angle at which the
 * board is the shape it actually is: any tilt makes it a trapezoid, the far
 * ranks close up, and on a board of intersections that is the grid the player
 * is reading getting the geometry wrong.
 *
 * What the tilt used to buy was depth. From up here that is the shadows' job,
 * which is why the lamp is low and to one side.
 */
const POLAR_DEG = 0;

/** The grid is 8 spacings wide and 9 tall, so the board is taller than it is
 *  wide and every measurement below follows from that one ratio. */
const GRID_W = FILES - 1;
const GRID_H = RANKS - 1;

function metrics(): { spacing: number; halfX: number; halfZ: number; margin: number } {
  const spacing = (2 * HALF) / (GRID_H + 2 * MARGIN_RATIO);
  const margin = spacing * MARGIN_RATIO;
  return { spacing, halfZ: HALF, halfX: (GRID_W * spacing) / 2 + margin, margin };
}

/** What each piece says. Red and Black use different characters for the same
 *  piece — that is the game, not a style choice, and a board that used one set
 *  for both would be unreadable to anyone who plays. */
const GLYPHS: Record<Side, Record<PieceType, string>> = {
  0: { 1: '帅', 2: '仕', 3: '相', 4: '马', 5: '车', 6: '炮', 7: '兵' },
  1: { 1: '将', 2: '士', 3: '象', 4: '马', 5: '车', 6: '砲', 7: '卒' },
};

const RED_INK = '#b0342c';
const BLACK_INK = '#20242c';

export interface Picked { x: number; y: number }

export class BoardView {
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly raycaster = new THREE.Raycaster();
  private readonly plane: THREE.Plane;

  private spacing = 0;
  private halfX = 0;
  private margin = 0;
  /** Whether the picture on screen is out of date. A board between moves is a
   *  still life; drawing it sixty times a second is a core spent on nothing. */
  private dirty = true;

  private board: THREE.Mesh | null = null;
  /** One pooled piece — a disc and the character on it — per square it could
   *  ever occupy. Thirty-two exist at most, and pooling means a capture is a
   *  `visible = false` rather than a rebuild. */
  private readonly pool: PieceMesh[] = [];
  private readonly glyphTextures = new Map<string, THREE.Texture>();
  private ghost: PieceMesh | null = null;
  /**
   * Pieces in the air, and the squares `sync()` must leave empty while they
   * fly — a piece cannot be on its square and on its way there at once.
   *
   * They come out of their own pool: a flight is a piece that is not in the
   * position, so it cannot borrow one of the pieces that are.
   */
  private flights: Flight[] = [];
  private readonly flightPool: PieceMesh[] = [];
  private readonly fadePool: PieceMesh[] = [];
  private hidden = new Set<number>();
  /** The position last laid out, so a landing flight can put it back. */
  private shown: XiangqiGame | null = null;
  /** Where a piece may go, if the player has picked one up. */
  private dots: THREE.Mesh[] = [];
  private highlights: THREE.Mesh[] = [];
  private focusRing: THREE.Mesh | null = null;
  private selectRing: THREE.Mesh | null = null;
  private checkRing: THREE.Mesh | null = null;
  private fromMark: THREE.Mesh | null = null;
  private toMark: THREE.Mesh | null = null;
  private insetRight = 0;

  private readonly azimuth = 0;
  private readonly polar = THREE.MathUtils.degToRad(POLAR_DEG);

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;

    // Near the table's darkest tone, so any sliver beyond it is not a hole.
    this.scene.background = new THREE.Color('#d5cec0');
    this.camera = new THREE.PerspectiveCamera(FOV_DEG, 1, 0.1, 100);
    this.plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -TOP_Y);

    // Low (about thirty degrees above the table, not forty-five: a high lamp
    // drops the board's shadow straight down and there is nothing to see) and
    // from the top left, so shadows fall down and to the right the way a
    // photograph of a table reads.
    const key = new THREE.DirectionalLight(0xfff1dc, 1.82);
    key.position.set(-3.1, 2.3, -2.1);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    const cam = key.shadow.camera as THREE.OrthographicCamera;
    cam.left = -2.6; cam.right = 2.6; cam.top = 2.6; cam.bottom = -2.6;
    cam.near = 0.5; cam.far = 12;
    key.shadow.bias = -0.0009;
    this.scene.add(key);
    // Enough fill that a piece is not half black, and no more: fill is the
    // enemy of the shadow that makes the board sit on the table.
    this.scene.add(new THREE.HemisphereLight(0xcfd8e6, 0xb8b2a6, 0.84));
    // A little warmth bouncing back off the table.
    const bounce = new THREE.DirectionalLight(0xffeeda, 0.34);
    bounce.position.set(2.4, 1.2, 1.8);
    this.scene.add(bounce);

    // The table. One big plane of dark wood, which is what makes the board
    // read as an object put down somewhere rather than a texture floating in
    // the dark — and it is what the board's shadow falls on.
    const table = new THREE.Mesh(
      new THREE.PlaneGeometry(2 * HALF * TABLE, 2 * HALF * TABLE).rotateX(-Math.PI / 2),
      new THREE.MeshStandardMaterial({ map: tableTexture(), roughness: 0.95, metalness: 0 }),
    );
    table.position.y = -0.002;  // a hair under the board, so they never z-fight
    table.receiveShadow = true;
    this.scene.add(table);

    this.build();
    this.resize();
  }

  // ── the wood ────────────────────────────────────────────────────────────

  private build(): void {
    const m = metrics();
    this.spacing = m.spacing;
    this.halfX = m.halfX;
    this.margin = m.margin;

    const top = new THREE.MeshStandardMaterial({ map: boardTexture(m), roughness: 0.62, metalness: 0 });
    // The edge of the board, with its own end grain. A flat colour was fine
    // when the board was too thin to see.
    const side = new THREE.MeshStandardMaterial({ map: edgeTexture(), roughness: 0.68, metalness: 0 });
    this.board = new THREE.Mesh(
      new THREE.BoxGeometry(2 * m.halfX, TOP_Y, 2 * m.halfZ),
      [side, side, top, side, side, side],
    );
    this.board.position.y = TOP_Y / 2;
    this.board.castShadow = true;
    this.board.receiveShadow = true;
    this.scene.add(this.board);
  }

  /** World position of an intersection. */
  private at(x: number, y: number): THREE.Vector3 {
    return new THREE.Vector3(
      -(this.halfX - this.margin) + x * this.spacing,
      TOP_Y,
      -(HALF - this.margin) + y * this.spacing,
    );
  }

  // ── the pieces ──────────────────────────────────────────────────────────

  private glyphTexture(side: Side, type: PieceType): THREE.Texture {
    const key = `${side}${type}`;
    const cached = this.glyphTextures.get(key);
    if (cached) return cached;
    const tex = pieceTexture(GLYPHS[side][type], side === RED ? RED_INK : BLACK_INK);
    this.glyphTextures.set(key, tex);
    return tex;
  }

  private takeFromPool(index: number): PieceMesh {
    while (this.pool.length <= index) {
      const piece = makePiece(this.spacing);
      this.scene.add(piece.group);
      this.pool.push(piece);
    }
    return this.pool[index];
  }

  /** Put the board on screen in the state the game is in. */
  sync(game: XiangqiGame): void {
    this.dirty = true;
    this.shown = game;
    const pieces = game.position.pieces();
    let n = 0;
    for (const p of pieces) {
      // A square with a piece in the air above it is drawn by the flight, not
      // by the layout, or the piece is in two places at once.
      if (this.hidden.has(p.square)) continue;
      const mesh = this.takeFromPool(n++);
      mesh.group.visible = true;
      mesh.group.position.copy(this.at(fileOf(p.square), rankOf(p.square)));
      mesh.setFace(this.glyphTexture(p.side, p.type), p.side);
    }
    for (let i = n; i < this.pool.length; i++) this.pool[i].group.visible = false;

    const last = game.lastMove;
    this.fromMark = this.markAt(this.fromMark, last ? { x: fileOf(last.from), y: rankOf(last.from) } : null, 0xff5a4d, 0.30);
    this.toMark = this.markAt(this.toMark, last ? { x: fileOf(last.to), y: rankOf(last.to) } : null, 0xff5a4d, 0.52);

    // The king in check, ringed. It is the one piece of information a player
    // must not miss, and "you are in check" in a status line at the bottom of
    // the screen is information they will miss.
    const inCheck = !game.over && game.position.inCheck();
    const king = inCheck ? game.position.kings[game.toPlay] : -1;
    this.checkRing = this.ringAt(this.checkRing, king >= 0 ? { x: fileOf(king), y: rankOf(king) } : null, 0xff4d3d, 0.58, 0.075);
  }

  /** The move the player has chosen but not committed to: the piece, half
   *  there. A ghost is how they see what the move DOES before it is a move. */
  setGhost(at: Picked | null, side?: Side, type?: PieceType): void {
    this.dirty = true;
    if (!this.ghost) {
      // Solid enough to read the character on it. At 0.5 the disc and the word
      // both washed out into the wood, and the whole point of the ghost is
      // that the player can see WHICH piece is about to be somewhere else.
      this.ghost = makePiece(this.spacing, 0.66);
      this.scene.add(this.ghost.group);
    }
    this.ghost.group.visible = !!at;
    if (!at || side === undefined || type === undefined) return;
    this.ghost.setFace(this.glyphTexture(side, type), side);
    this.ghost.group.position.copy(this.at(at.x, at.y));
  }

  /** Where the piece in hand may go. Dots, not rings: rings are what the
   *  assistant points with, and a board where everything is a ring says
   *  nothing. */
  setDestinations(points: Picked[]): void {
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

  /** The piece the player has picked up. */
  setSelection(at: Picked | null): void {
    this.dirty = true;
    this.selectRing = this.ringAt(this.selectRing, at, 0xffd76a, 0.54, 0.06);
  }

  /** The point the sentence on screen is about. Kept apart from the
   *  assistant's own marks: they shared one list in the Go game, and a
   *  sentence with no coordinate in it wiped the rings it had just drawn. */
  setFocus(at: Picked | null): void {
    this.dirty = true;
    this.focusRing = this.ringAt(this.focusRing, at, 0xffd76a, 0.50, 0.055);
  }

  /** Points the assistant is talking about. Empty clears. */
  setHighlights(points: Picked[]): void {
    this.dirty = true;
    while (this.highlights.length < points.length) {
      const ring = new THREE.Mesh(
        new THREE.TorusGeometry(0.46, 0.07, 8, 28),
        new THREE.MeshBasicMaterial({ color: 0x4fd2ff, transparent: true, opacity: 0.95 }),
      );
      ring.rotation.x = -Math.PI / 2;
      this.scene.add(ring);
      this.highlights.push(ring);
    }
    this.highlights.forEach((ring, i) => {
      const p = points[i];
      ring.visible = !!p;
      if (!p) return;
      ring.scale.setScalar(this.spacing);
      const at = this.at(p.x, p.y);
      ring.position.set(at.x, TOP_Y + this.spacing * 0.44, at.z);
    });
  }

  private ringAt(mesh: THREE.Mesh | null, at: Picked | null, color: number, radius: number, tube: number): THREE.Mesh {
    let ring = mesh;
    if (!ring) {
      ring = new THREE.Mesh(
        new THREE.TorusGeometry(radius, tube, 8, 28),
        new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.92 }),
      );
      ring.rotation.x = -Math.PI / 2;
      ring.renderOrder = 3;
      this.scene.add(ring);
    }
    ring.visible = !!at;
    if (at) {
      ring.scale.setScalar(this.spacing);
      const p = this.at(at.x, at.y);
      ring.position.set(p.x, TOP_Y + this.spacing * 0.46, p.z);
    }
    return ring;
  }

  private markAt(mesh: THREE.Mesh | null, at: Picked | null, color: number, size: number): THREE.Mesh {
    let mark = mesh;
    if (!mark) {
      mark = new THREE.Mesh(
        new THREE.RingGeometry(size, size + 0.06, 4, 1, Math.PI / 4).rotateX(-Math.PI / 2),
        new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.8, depthWrite: false }),
      );
      mark.renderOrder = 2;
      this.scene.add(mark);
    }
    mark.visible = !!at;
    if (at) {
      mark.scale.setScalar(this.spacing);
      const p = this.at(at.x, at.y);
      mark.position.set(p.x, TOP_Y + this.spacing * 0.04, p.z);
    }
    return mark;
  }

  // ── screen and pointer ──────────────────────────────────────────────────

  screenOf(x: number, y: number): { x: number; y: number } {
    const p = this.at(x, y).project(this.camera);
    const rect = this.renderer.domElement.getBoundingClientRect();
    return {
      x: rect.left + ((p.x + 1) / 2) * rect.width,
      y: rect.top + ((1 - p.y) / 2) * rect.height,
    };
  }

  get screenSpacing(): number {
    const a = this.screenOf(0, 0);
    const b = this.screenOf(1, 0);
    return Math.hypot(a.x - b.x, a.y - b.y);
  }

  pick(clientX: number, clientY: number): Picked | null {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1,
    );
    this.raycaster.setFromCamera(ndc, this.camera);
    const hit = new THREE.Vector3();
    if (!this.raycaster.ray.intersectPlane(this.plane, hit)) return null;

    const x = Math.round((hit.x + (this.halfX - this.margin)) / this.spacing);
    const y = Math.round((hit.z + (HALF - this.margin)) / this.spacing);
    if (x < 0 || y < 0 || x >= FILES || y >= RANKS) return null;
    const p = this.at(x, y);
    // Two thirds of a space of slack. More than Go's half, because a xiangqi
    // piece is nearly a whole space wide and the player is aiming at the PIECE
    // rather than at the line crossing under it.
    if (Math.hypot(hit.x - p.x, hit.z - p.z) > this.spacing * 0.65) return null;
    return { x, y };
  }

  // ── camera ──────────────────────────────────────────────────────────────

  reserveRight(px: number): void {
    this.insetRight = Math.max(0, px);
    this.resize();
  }




  private place(): void {
    this.dirty = true;
    const w = window.innerWidth, h = window.innerHeight;
    const vFov = THREE.MathUtils.degToRad(FOV_DEG);
    const need = Math.hypot(this.halfX, HALF) * 1.06;
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
      if (this.insetRight > 0) this.camera.setViewOffset(w, h, this.insetRight / 2, 0, w, h);
      else this.camera.clearViewOffset();
      this.camera.updateProjectionMatrix();
      this.camera.updateMatrixWorld();
    };
    put(r);

    // Fit by asking where the corners actually land — a bounding-sphere fit is
    // correct at every angle and wasteful at all of them.
    const v = new THREE.Vector3();
    for (let i = 0; i < 4; i++) {
      let worst = 0;
      for (const cx of [-this.halfX, this.halfX]) {
        for (const cz of [-HALF, HALF]) {
          for (const cy of [0, TOP_Y]) {
            v.set(cx, cy, cz).project(this.camera);
            worst = Math.max(worst, Math.abs(v.x), Math.abs(v.y));
          }
        }
      }
      if (!Number.isFinite(worst) || worst <= 0) break;
      r *= worst / 0.94;
      put(r);
    }
  }

  // ── pieces in the air ───────────────────────────────────────────────────

  /**
   * Show a move happening: lift, travel, set down — and anything it took off
   * the side of the board first, the way a hand clears the square before
   * putting the other piece on it.
   *
   * Called with the move the referee has just accepted, so the position is
   * already the one AFTER it; every argument here is about what the player
   * did not get to see. Squares are board indices and pieces are codes,
   * which is what the rules deal in.
   */
  animateMove(from: number, to: number, mover: number, taken = 0): void {
    if (!mover) return;
    const now = performance.now();
    if (taken) {
      // Off towards whoever TOOK it, which is the other side from the piece
      // that was taken: a black horse leaves towards Red's end of the table.
      const by = sideOf(mover);
      const home = by === RED ? RANKS - 1 : 0;
      const edge = this.at(fileOf(to), home);
      edge.z += (by === RED ? 1 : -1) * this.spacing * 2.2;
      edge.y += this.spacing * 1.4;
      this.launch({
        side: sideOf(taken), type: typeOf(taken),
        from: this.at(fileOf(to), rankOf(to)), to: edge,
        lift: this.spacing * 0.8, ms: TAKE_MS, start: now, fade: true, hide: null,
      });
    }
    this.launch({
      side: sideOf(mover), type: typeOf(mover),
      from: this.at(fileOf(from), rankOf(from)),
      to: this.at(fileOf(to), rankOf(to)),
      lift: this.spacing * 0.5, ms: MOVE_MS,
      // A beat after the capture starts, so the two read as one act in order
      // — clear the square, then land on it — rather than as a collision.
      start: now + (taken ? 60 : 0), fade: false, hide: to,
    });
    this.dirty = true;
  }

  private launch(spec: {
    side: Side; type: PieceType; from: THREE.Vector3; to: THREE.Vector3;
    lift: number; ms: number; start: number; fade: boolean; hide: number | null;
  }): void {
    const pool = spec.fade ? this.fadePool : this.flightPool;
    let piece = pool.find((m) => !m.group.visible);
    if (!piece) {
      piece = makePiece(this.spacing, 1, spec.fade);
      this.scene.add(piece.group);
      pool.push(piece);
    }
    piece.group.scale.setScalar(this.spacing);
    piece.group.visible = true;
    piece.setOpacity(1);
    piece.setFace(this.glyphTexture(spec.side, spec.type), spec.side);
    piece.group.position.copy(spec.from);
    if (spec.hide !== null) this.hidden.add(spec.hide);
    this.flights.push({ piece, ...spec });
  }

  /** Move everything in the air on. Returns whether anything is still
   *  flying, which is what keeps the frame loop awake. */
  animate(): boolean {
    if (!this.flights.length) return false;
    const now = performance.now();
    let moving = false;
    let relay = false;
    for (const f of [...this.flights]) {
      const t = (now - f.start) / f.ms;
      if (t < 0) { moving = true; continue; }
      if (t >= 1) {
        f.piece.group.visible = false;
        // The square goes back to the layout — and the layout has to be
        // RE-RUN to put the piece there. Clearing the flag alone leaves a
        // hole where the piece landed until the next move happens to sync.
        if (f.hide !== null) { this.hidden.delete(f.hide); relay = true; }
        this.flights.splice(this.flights.indexOf(f), 1);
        this.dirty = true;
        continue;
      }
      moving = true;
      const k = f.fade ? easeOut(t) : easeInOut(t);
      f.piece.group.position.lerpVectors(f.from, f.to, k);
      // The arc: up and down again, so it reads as picked up rather than slid.
      f.piece.group.position.y += Math.sin(Math.PI * t) * f.lift;
      if (f.fade) {
        f.piece.setOpacity(1 - easeOut(Math.max(0, (t - 0.45) / 0.55)));
        f.piece.group.scale.setScalar(this.spacing * (1 - 0.35 * t));
      }
      this.dirty = true;
    }
    if (relay && this.shown) this.sync(this.shown);
    return moving;
  }

  /** Put everything down where it is. For anything that rewrites the board
   *  under a flight — a new game — because a flight that outlives its move
   *  is a piece flying to a square that no longer wants it, while holding
   *  that square empty. */
  clearFlights(): void {
    for (const f of this.flights) f.piece.group.visible = false;
    this.flights.length = 0;
    this.hidden.clear();
    this.dirty = true;
  }

  resize(): void {
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.place();
  }

  render(): boolean {
    if (!this.dirty) return false;
    this.dirty = false;
    this.renderer.render(this.scene, this.camera);
    return true;
  }

  invalidate(): void { this.dirty = true; }
}

// ── building blocks ───────────────────────────────────────────────────────

interface PieceMesh {
  group: THREE.Group;
  setFace(texture: THREE.Texture, side: Side): void;
  /** For a piece on its way off the board. Only pieces built with `fades`
   *  can do this — a material's transparency is part of its shader, and
   *  switching it mid-game recompiles one. */
  setOpacity(o: number): void;
}

/** A disc with a character on it. The character is a separate plane sitting a
 *  hair above the disc rather than a texture on the cylinder's cap, because a
 *  cylinder cap's UVs are a circle mapped from the side and the glyph comes
 *  out rotated by whatever the geometry felt like. */
function makePiece(spacing: number, opacity = 1, fades = false): PieceMesh {
  const group = new THREE.Group();
  const r = 0.46, h = 0.22;
  const disc = new THREE.Mesh(
    new THREE.CylinderGeometry(r, r * 0.96, h, 28),
    new THREE.MeshStandardMaterial({
      color: 0xf0dcb4, roughness: 0.55, metalness: 0.02,
      transparent: opacity < 1 || fades, opacity,
    }),
  );
  disc.position.y = h / 2;
  // A piece that fades casts no shadow: a shadow does not fade with it (the
  // depth pass does not read opacity), so a piece that has gone leaves a
  // full-strength shadow behind on the wood.
  disc.castShadow = opacity === 1 && !fades;
  disc.receiveShadow = true;
  group.add(disc);

  const face = new THREE.Mesh(
    new THREE.PlaneGeometry(r * 1.9, r * 1.9).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ transparent: true, opacity, depthWrite: false }),
  );
  face.position.y = h + 0.002;
  face.renderOrder = 1;
  group.add(face);

  group.scale.setScalar(spacing);
  group.visible = false;
  return {
    group,
    setOpacity(o): void {
      (disc.material as THREE.MeshStandardMaterial).opacity = o;
      (face.material as THREE.MeshBasicMaterial).opacity = o;
    },
    setFace(texture, side): void {
      const mat = face.material as THREE.MeshBasicMaterial;
      mat.map = texture;
      mat.needsUpdate = true;
      // Red's pieces are a shade warmer than Black's, the way a real set is —
      // the ink is the difference, but the wood usually is too.
      (disc.material as THREE.MeshStandardMaterial).color.set(side === RED ? 0xf3ddb0 : 0xe8dcc4);
    },
  };
}

/** One character, painted onto a disc face: the ring, the inner circle, and
 *  the word. */
function pieceTexture(glyph: string, ink: string): THREE.CanvasTexture {
  const px = 256;
  const c = document.createElement('canvas');
  c.width = c.height = px;
  const ctx = c.getContext('2d')!;
  const mid = px / 2;

  ctx.strokeStyle = ink;
  ctx.lineWidth = px * 0.035;
  ctx.beginPath();
  ctx.arc(mid, mid, px * 0.40, 0, Math.PI * 2);
  ctx.stroke();
  ctx.lineWidth = px * 0.012;
  ctx.beginPath();
  ctx.arc(mid, mid, px * 0.335, 0, Math.PI * 2);
  ctx.stroke();

  ctx.fillStyle = ink;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  // A serif face, because that is what is carved into a real piece. Whatever
  // the device actually has for CJK is what this resolves to; the fallback
  // chain ends at the system UI font rather than at a box.
  ctx.font = `600 ${px * 0.5}px "Songti SC", "SimSun", "Noto Serif CJK SC", serif`;
  ctx.fillText(glyph, mid, mid + px * 0.02);

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

/** Wood, grid, river and palaces, painted once. */
function boardTexture(m: { spacing: number; halfX: number; margin: number }): THREE.CanvasTexture {
  // The slab is taller than it is wide, so the canvas is too: a square canvas
  // on a rectangular face stretches the grid in one direction, which on a
  // board of intersections is instantly visible.
  const pxZ = 1024;
  const pxX = Math.round(pxZ * (m.halfX / HALF));
  const c = document.createElement('canvas');
  c.width = pxX;
  c.height = pxZ;
  const ctx = c.getContext('2d')!;

  ctx.fillStyle = '#c9a978';
  ctx.fillRect(0, 0, pxX, pxZ);
  for (let i = 0; i < 240; i++) {
    const y = Math.random() * pxZ;
    ctx.strokeStyle = `rgba(${150 + Math.random() * 40},${105 + Math.random() * 30},${55 + Math.random() * 25},${0.04 + Math.random() * 0.06})`;
    ctx.lineWidth = 1 + Math.random() * 3;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.bezierCurveTo(pxX * 0.3, y + (Math.random() - 0.5) * 24, pxX * 0.7, y + (Math.random() - 0.5) * 24, pxX, y + (Math.random() - 0.5) * 12);
    ctx.stroke();
  }

  // World units to canvas pixels. Both axes share one scale, which is the
  // whole point of the non-square canvas.
  const step = (m.spacing / (2 * HALF)) * pxZ;
  const marginZ = (m.margin / (2 * HALF)) * pxZ;
  const marginX = (m.margin / (2 * HALF)) * pxZ;
  const X = (x: number): number => marginX + x * step;
  const Y = (y: number): number => marginZ + y * step;

  ctx.strokeStyle = 'rgba(32,24,14,0.85)';
  ctx.lineWidth = Math.max(1.6, pxZ / 820);
  ctx.beginPath();
  // Ranks run the full width.
  for (let y = 0; y < RANKS; y++) { ctx.moveTo(X(0), Y(y)); ctx.lineTo(X(GRID_W), Y(y)); }
  // Files stop at the river, except the two at the edges — which is what makes
  // the middle of the board read as water rather than as a missing line.
  for (let x = 0; x < FILES; x++) {
    if (x === 0 || x === GRID_W) { ctx.moveTo(X(x), Y(0)); ctx.lineTo(X(x), Y(GRID_H)); continue; }
    ctx.moveTo(X(x), Y(0)); ctx.lineTo(X(x), Y(4));
    ctx.moveTo(X(x), Y(5)); ctx.lineTo(X(x), Y(GRID_H));
  }
  // The palaces.
  for (const top of [0, 7]) {
    ctx.moveTo(X(3), Y(top)); ctx.lineTo(X(5), Y(top + 2));
    ctx.moveTo(X(5), Y(top)); ctx.lineTo(X(3), Y(top + 2));
  }
  ctx.stroke();

  // A border a little outside the grid, as every wooden board has.
  ctx.lineWidth = Math.max(2.4, pxZ / 500);
  ctx.strokeRect(X(0) - step * 0.22, Y(0) - step * 0.22, X(GRID_W) - X(0) + step * 0.44, Y(GRID_H) - Y(0) + step * 0.44);

  // The starting points of the cannons and soldiers, in the half-brackets a
  // real board uses. Not decoration: they are how a player finds the opening
  // position without counting squares.
  const tick = step * 0.14, gap = step * 0.09;
  ctx.lineWidth = Math.max(1.4, pxZ / 900);
  ctx.beginPath();
  const bracket = (x: number, y: number): void => {
    for (const sx of [-1, 1]) {
      for (const sy of [-1, 1]) {
        if ((x === 0 && sx < 0) || (x === GRID_W && sx > 0)) continue;
        const px0 = X(x) + sx * gap, py0 = Y(y) + sy * gap;
        ctx.moveTo(px0, py0 + sy * tick); ctx.lineTo(px0, py0); ctx.lineTo(px0 + sx * tick, py0);
      }
    }
  };
  for (const y of [2, 7]) { bracket(1, y); bracket(7, y); }
  for (const y of [3, 6]) for (const x of [0, 2, 4, 6, 8]) bracket(x, y);
  ctx.stroke();

  // The coordinates the assistant points with, small and in the margin.
  //
  // A wooden board has none of these, and a purist would leave them off. They
  // are here because the assistant says "e4" — and a player who cannot find
  // e4 without counting has to take its word for everything it points at,
  // which is the one thing this game is trying not to ask of them.
  ctx.fillStyle = 'rgba(40,28,16,0.42)';
  ctx.font = `600 ${step * 0.26}px system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (let x = 0; x < FILES; x++) {
    ctx.fillText('abcdefghi'[x], X(x), Y(GRID_H) + step * 0.45);
    ctx.fillText('abcdefghi'[x], X(x), Y(0) - step * 0.45);
  }
  for (let y = 0; y < RANKS; y++) {
    ctx.fillText(String(9 - y), X(0) - step * 0.45, Y(y));
    ctx.fillText(String(9 - y), X(GRID_W) + step * 0.45, Y(y));
  }

  // 楚河 漢界 — the river says whose side is whose, and a board without it
  // looks like a diagram rather than a board.
  ctx.fillStyle = 'rgba(40,28,16,0.62)';
  ctx.textBaseline = 'middle';
  ctx.font = `500 ${step * 0.62}px "Songti SC", "SimSun", "Noto Serif CJK SC", serif`;
  const river = (Y(4) + Y(5)) / 2;
  ctx.textAlign = 'center';
  ctx.fillText('楚　河', X(2), river);
  ctx.fillText('漢　界', X(6), river);

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

/** Re-exported so `main.ts` can talk about squares without importing the rules
 *  twice over. */
export { fileOf, rankOf, sideOf, typeOf };

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

/** The board's own edge: end grain, lighter than the table it stands on. */
function edgeTexture(): THREE.CanvasTexture {
  const px = 256;
  const c = document.createElement('canvas');
  c.width = px;
  c.height = 64;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#ad854f';
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
