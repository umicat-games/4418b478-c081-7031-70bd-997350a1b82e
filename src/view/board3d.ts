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

/** Half the longer side of the slab, in world units. */
const HALF = 1;
/** How much wood there is outside the outermost line, in spacings. */
const MARGIN_RATIO = 0.62;
const TOP_Y = 0.06;
const FOV_DEG = 22;
const MAX_POLAR_DEG = 58;

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
  /** Where a piece may go, if the player has picked one up. */
  private dots: THREE.Mesh[] = [];
  private highlights: THREE.Mesh[] = [];
  private focusRing: THREE.Mesh | null = null;
  private selectRing: THREE.Mesh | null = null;
  private checkRing: THREE.Mesh | null = null;
  private fromMark: THREE.Mesh | null = null;
  private toMark: THREE.Mesh | null = null;
  private insetRight = 0;

  private azimuth = 0;
  private polar = THREE.MathUtils.degToRad(13);
  private zoom = 1;
  private readonly defaults = { azimuth: 0, polar: THREE.MathUtils.degToRad(13), zoom: 1 };

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;

    this.scene.background = new THREE.Color('#1b1d22');
    this.camera = new THREE.PerspectiveCamera(FOV_DEG, 1, 0.1, 100);
    this.plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -TOP_Y);

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
    const side = new THREE.MeshStandardMaterial({ color: 0xd8a860, roughness: 0.7 });
    this.board = new THREE.Mesh(
      new THREE.BoxGeometry(2 * m.halfX, TOP_Y, 2 * m.halfZ),
      [side, side, top, side, side, side],
    );
    this.board.position.y = TOP_Y / 2;
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
    const pieces = game.position.pieces();
    pieces.forEach((p, i) => {
      const mesh = this.takeFromPool(i);
      mesh.group.visible = true;
      mesh.group.position.copy(this.at(fileOf(p.square), rankOf(p.square)));
      mesh.setFace(this.glyphTexture(p.side, p.type), p.side);
    });
    for (let i = pieces.length; i < this.pool.length; i++) this.pool[i].group.visible = false;

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

  private place(): void {
    this.dirty = true;
    const w = window.innerWidth, h = window.innerHeight;
    const vFov = THREE.MathUtils.degToRad(FOV_DEG);
    const need = Math.hypot(this.halfX, HALF) * 1.06;
    const usable = Math.max(1, w - this.insetRight);
    const hFov = 2 * Math.atan(Math.tan(vFov / 2) * (usable / h));
    let r = Math.max(need / Math.tan(vFov / 2), need / Math.tan(hFov / 2)) / this.zoom;

    const sp = Math.sin(this.polar), cp = Math.cos(this.polar);
    const put = (dist: number): void => {
      this.camera.position.set(dist * sp * Math.sin(this.azimuth), dist * cp, dist * sp * Math.cos(this.azimuth));
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
}

/** A disc with a character on it. The character is a separate plane sitting a
 *  hair above the disc rather than a texture on the cylinder's cap, because a
 *  cylinder cap's UVs are a circle mapped from the side and the glyph comes
 *  out rotated by whatever the geometry felt like. */
function makePiece(spacing: number, opacity = 1): PieceMesh {
  const group = new THREE.Group();
  const r = 0.46, h = 0.22;
  const disc = new THREE.Mesh(
    new THREE.CylinderGeometry(r, r * 0.96, h, 28),
    new THREE.MeshStandardMaterial({
      color: 0xf0dcb4, roughness: 0.55, metalness: 0.02,
      transparent: opacity < 1, opacity,
    }),
  );
  disc.position.y = h / 2;
  disc.castShadow = opacity === 1;
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

  ctx.fillStyle = '#e8c48c';
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
