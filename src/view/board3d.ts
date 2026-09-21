// The board, drawn.
//
// The camera rig is GO with me's and Chess with me's, for their reasons, and
// they hold here too:
//
// **It is a LONG LENS** — perspective, but a narrow one. Orthographic has no
// near-and-far at all, and a square board seen from an angle with no
// near-and-far does not look tilted, it looks BENT: opposite edges stay
// exactly parallel and the eye gets no cue to explain the shape. A long lens
// keeps the far row nearly the size of the near one while still giving depth.
//
// **It is tilted less than the chess board is.** Chess pieces are upright and
// need to be seen from the side; a Blokus piece is a flat tile and the thing a
// player reads is its SHAPE, which is only legible from close to overhead.
// Thirty-odd degrees is where a twenty-square row still reads as a grid and
// the tiles still have enough side on them to look like objects.
//
// The grid is PAINTED INTO THE BOARD'S TEXTURE rather than laid over it as
// geometry: surfaces sitting a hair above another surface z-fight at some
// camera angles and vanish at others, and this board has four hundred cells
// worth of lines to get wrong that way.
//
// Every placed square is its own tile, with a gap around it. A Blokus piece is
// made of squares and a player has to be able to count them — a pentomino
// drawn as one smooth slab is a shape you cannot check against the piece you
// think you are holding.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { COLOURS, CORNERS, EMPTY, PERFECT, SIZE } from '../blokus/pieces';
import type { Cell, Cells } from '../blokus/pieces';
import { PLAYERS } from '../blokus/game';

/** Half-width of the board slab in world units, frame included. */
const HALF = 1;
/** The frame around the grid, in cells. Wide enough to read as a rim. */
const BORDER = 0.7;
const CELL = (2 * HALF) / (SIZE + 2 * BORDER);
/** How much of a cell a tile fills. Under 1 so the squares stay countable. */
const TILE = CELL * 0.9;
const SLAB = 0.055;
const TILE_H = CELL * 0.55;

/** The lens, and how far from overhead it may be pushed. */
const FOV_DEG = 26;
const MIN_POLAR_DEG = 6;
const MAX_POLAR_DEG = 58;
const DEFAULT_POLAR_DEG = 34;

/** How long a piece takes to land, and from how high. */
const DROP_MS = 260;
const DROP_FROM = CELL * 6;
/** How long the mark over the last move stays up. Long enough to find it
 *  after looking away, short enough not to become furniture. */
const LAST_MS = 2200;

const FELT = '#171a24';
const GRID = 'rgba(255,255,255,0.075)';
const RIM = '#2a2f40';

export class BoardView {
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly raycaster = new THREE.Raycaster();
  private readonly plane: THREE.Plane;

  /**
   * Whether the picture on screen is out of date.
   *
   * A Blokus board is still between moves, and on a phone drawing four hundred
   * cells sixty times a second for no reason is a battery and a fan. The loop
   * draws when something changed and otherwise does nothing — the bot's search
   * runs on the same thread and is the thing the player is actually waiting on.
   */
  private dirty = true;

  private tiles: THREE.InstancedMesh[] = [];
  /** Where each placed square lives in its player's instance buffer, so a
   *  landing animation can move exactly those and nothing else. */
  private slot = new Map<string, number>();
  private ghost: THREE.InstancedMesh;
  private ghostOk = true;
  private anchorDots: THREE.InstancedMesh;
  private lastMark: THREE.InstancedMesh;

  private dropping: { cells: Cells; player: number; started: number } | null = null;
  private lastAt = 0;

  private insetRight = 0;
  private insetBottom = 0;
  private azimuth = 0;
  private polar = THREE.MathUtils.degToRad(DEFAULT_POLAR_DEG);
  private zoom = 1;
  /** Which corner of the board is nearest the camera — the player's own. */
  private seat = 0;

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;

    this.scene.background = new THREE.Color('#0d0f16');
    this.camera = new THREE.PerspectiveCamera(FOV_DEG, 1, 0.1, 100);
    this.plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -SLAB);

    const key = new THREE.DirectionalLight(0xffffff, 2.0);
    key.position.set(-2.0, 4.4, 2.2);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    const cam = key.shadow.camera as THREE.OrthographicCamera;
    cam.left = -1.6; cam.right = 1.6; cam.top = 1.6; cam.bottom = -1.6;
    cam.near = 0.5; cam.far = 12;
    key.shadow.bias = -0.0009;
    this.scene.add(key);
    this.scene.add(new THREE.HemisphereLight(0xcfd8ff, 0x191520, 1.0));
    // A cool rim from behind, so tiles on the far side of the board have an
    // edge instead of dissolving into the felt they are lying on.
    const rim = new THREE.DirectionalLight(0x9bb4ff, 0.5);
    rim.position.set(2.4, 2.0, -2.8);
    this.scene.add(rim);

    this.buildBoard();

    const tileGeo = new RoundedBoxGeometry(TILE, TILE_H, TILE, 2, TILE * 0.16);
    for (let p = 0; p < PLAYERS; p++) {
      const mesh = new THREE.InstancedMesh(
        tileGeo,
        new THREE.MeshStandardMaterial({ color: COLOURS[p], roughness: 0.38, metalness: 0.06 }),
        PERFECT,
      );
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.count = 0;
      this.scene.add(mesh);
      this.tiles.push(mesh);
    }

    // The piece in hand. Five is the largest piece there is; a sixth square
    // would be a bug, and writing past an InstancedMesh is silent until it is
    // not, so the capacity says five.
    this.ghost = new THREE.InstancedMesh(
      tileGeo,
      new THREE.MeshStandardMaterial({
        color: 0xffffff, roughness: 0.3, transparent: true, opacity: 0.58, depthWrite: false,
      }),
      5,
    );
    this.ghost.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.ghost.renderOrder = 3;
    this.ghost.count = 0;
    this.scene.add(this.ghost);

    // Where this player could still build from. The corner rule is the rule
    // beginners get wrong, and a rule you can see is one you stop getting
    // wrong — so these appear whenever a piece is in hand.
    const dot = new THREE.CircleGeometry(CELL * 0.2, 18).rotateX(-Math.PI / 2);
    this.anchorDots = new THREE.InstancedMesh(
      dot,
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.55, depthWrite: false }),
      140,
    );
    this.anchorDots.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.anchorDots.renderOrder = 2;
    this.anchorDots.count = 0;
    this.scene.add(this.anchorDots);

    // The move that just happened, marked for a couple of seconds. In a
    // four-handed game three things happen between your turns, and "what
    // changed?" is otherwise a puzzle played against a twenty by twenty grid.
    const ring = new THREE.RingGeometry(CELL * 0.42, CELL * 0.5, 4)
      .rotateX(-Math.PI / 2).rotateY(Math.PI / 4);
    this.lastMark = new THREE.InstancedMesh(
      ring,
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9, depthWrite: false }),
      5,
    );
    this.lastMark.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.lastMark.renderOrder = 4;
    this.lastMark.count = 0;
    this.scene.add(this.lastMark);

    this.resize();
  }

  // ── the slab ─────────────────────────────────────────────────────────────
  private buildBoard(): void {
    const top = new THREE.MeshStandardMaterial({ map: boardTexture(), roughness: 0.82, metalness: 0 });
    const side = new THREE.MeshStandardMaterial({ color: 0x1b1f2b, roughness: 0.8 });
    // BoxGeometry's material slots are +x, −x, +y, −y, +z, −z: only the top
    // (+y) carries the grid.
    const slab = new THREE.Mesh(
      new THREE.BoxGeometry(2 * HALF, SLAB, 2 * HALF),
      [side, side, top, side, side, side],
    );
    slab.position.y = SLAB / 2;
    slab.receiveShadow = true;
    this.scene.add(slab);
  }

  // ── where things are ─────────────────────────────────────────────────────
  /** The centre of a cell, on the board's surface. */
  private at(x: number, y: number): THREE.Vector3 {
    const o = -(HALF - BORDER * CELL) + CELL / 2;
    return new THREE.Vector3(o + x * CELL, SLAB, o + y * CELL);
  }

  /** Which cell is under this screen point, if any. */
  pick(clientX: number, clientY: number): Cell | null {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1,
    );
    this.raycaster.setFromCamera(ndc, this.camera);
    const hit = new THREE.Vector3();
    if (!this.raycaster.ray.intersectPlane(this.plane, hit)) return null;
    const o = -(HALF - BORDER * CELL);
    const x = Math.floor((hit.x - o) / CELL);
    const y = Math.floor((hit.z - o) / CELL);
    if (x < 0 || y < 0 || x >= SIZE || y >= SIZE) return null;
    return [x, y];
  }

  /** Where a cell is on screen, in CSS pixels — the inverse of `pick`, and
   *  what lets the confirm buttons stand beside the piece they belong to. */
  screenOf(x: number, y: number): { x: number; y: number } {
    const p = this.at(x, y).project(this.camera);
    const rect = this.renderer.domElement.getBoundingClientRect();
    return {
      x: rect.left + ((p.x + 1) / 2) * rect.width,
      y: rect.top + ((1 - p.y) / 2) * rect.height,
    };
  }

  /** One cell, in screen pixels — how far a button has to sit from the piece
   *  it belongs to in order to clear it. */
  get screenSpacing(): number {
    const a = this.screenOf(0, 0);
    const b = this.screenOf(1, 0);
    return Math.hypot(a.x - b.x, a.y - b.y);
  }

  // ── what is on it ────────────────────────────────────────────────────────
  /** Put every placed square where the board says it is. */
  sync(board: readonly number[]): void {
    this.dirty = true;
    const counts = new Array(PLAYERS).fill(0);
    this.slot.clear();
    const m = new THREE.Matrix4();
    for (let y = 0; y < SIZE; y++) {
      for (let x = 0; x < SIZE; x++) {
        const p = board[y * SIZE + x];
        if (p === EMPTY) continue;
        const mesh = this.tiles[p];
        const i = counts[p];
        // The capacity, not the previous frame's count: a player cannot own
        // more squares than they have, but an out-of-range write is a GPU
        // buffer overrun rather than a visible mistake.
        if (!mesh || i >= PERFECT) continue;
        const c = this.at(x, y);
        m.makeTranslation(c.x, SLAB + TILE_H / 2, c.z);
        mesh.setMatrixAt(i, m);
        this.slot.set(`${p}:${x},${y}`, i);
        counts[p] = i + 1;
      }
    }
    for (let p = 0; p < PLAYERS; p++) {
      const mesh = this.tiles[p];
      mesh.count = counts[p];
      mesh.instanceMatrix.needsUpdate = true;
      // Without this the mesh is culled against whatever volume the first
      // frame's instances happened to occupy, and tiles near the edge blink
      // out as the camera turns.
      mesh.computeBoundingSphere();
    }
  }

  /**
   * Land a piece: these squares fall the last few millimetres and the mark
   * goes over them. Call after `sync`, which is what decided where they are.
   */
  drop(cells: Cells, player: number): void {
    this.dropping = { cells, player, started: performance.now() };
    this.lastAt = performance.now();
    const m = new THREE.Matrix4();
    cells.slice(0, 5).forEach((c, i) => {
      const p = this.at(c[0], c[1]);
      m.makeTranslation(p.x, SLAB + TILE_H + 0.004, p.z);
      this.lastMark.setMatrixAt(i, m);
    });
    this.lastMark.count = Math.min(cells.length, 5);
    this.lastMark.instanceMatrix.needsUpdate = true;
    (this.lastMark.material as THREE.MeshBasicMaterial).color.setHex(COLOURS[player]);
    this.dirty = true;
  }

  /** The piece in hand, at the position being aimed at. `null` clears it. */
  setGhost(cells: Cells | null, player: number, ok: boolean): void {
    this.dirty = true;
    if (!cells || cells.length === 0) { this.ghost.count = 0; return; }
    const mat = this.ghost.material as THREE.MeshStandardMaterial;
    // The player's own colour when the move is legal, red when it is not.
    // Not green-for-yes: green is one of the four colours in play, and a
    // green player would be told their every move was fine.
    mat.color.setHex(ok ? COLOURS[player] : 0xff5a5a);
    mat.opacity = ok ? 0.72 : 0.42;
    this.ghostOk = ok;
    const m = new THREE.Matrix4();
    cells.slice(0, 5).forEach((c, i) => {
      const p = this.at(c[0], c[1]);
      m.makeTranslation(p.x, SLAB + TILE_H * 0.62, p.z);
      this.ghost.setMatrixAt(i, m);
    });
    this.ghost.count = Math.min(cells.length, 5);
    this.ghost.instanceMatrix.needsUpdate = true;
    this.ghost.computeBoundingSphere();
  }

  get ghostLegal(): boolean { return this.ghostOk; }

  /** The free corners this player could build from. Empty clears them. */
  setAnchors(cells: Cells, player: number): void {
    this.dirty = true;
    const mesh = this.anchorDots;
    (mesh.material as THREE.MeshBasicMaterial).color.setHex(COLOURS[player]);
    const m = new THREE.Matrix4();
    const n = Math.min(cells.length, 140);
    for (let i = 0; i < n; i++) {
      const p = this.at(cells[i][0], cells[i][1]);
      m.makeTranslation(p.x, SLAB + 0.003, p.z);
      mesh.setMatrixAt(i, m);
    }
    mesh.count = n;
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
  }

  // ── the camera ───────────────────────────────────────────────────────────
  /**
   * Sit the player at their own corner.
   *
   * Blokus is played from a corner, not from a side: your first piece goes on
   * the corner nearest you and the game grows diagonally away from it. Facing
   * the board square-on would leave every player but one reading their own
   * territory upside down.
   */
  setSeat(player: number): void {
    this.seat = player;
    this.frame();
  }

  /**
   * Which way the camera looks from, before the player has turned it.
   *
   * From the SIDE next to the player's corner, not from the corner itself.
   * Straight down a diagonal the board is a diamond, and a diamond needs its
   * full 28-cell diagonal to fit in a window that only has 20 cells' worth of
   * height — forty per cent of the board's size on screen, thrown away for a
   * symmetry nobody asked for. Sitting at a side is also how people sit at a
   * real one: the board square in front of you, your own corner to hand.
   */
  private get baseAzimuth(): number {
    const [cx, cy] = CORNERS[this.seat] ?? CORNERS[0];
    const dx = cx < SIZE / 2 ? -1 : 1;
    const dz = cy < SIZE / 2 ? -1 : 1;
    return Math.atan2(dx, dz) + Math.PI / 4;
  }

  orbit(dAzimuth: number, dPolar: number): void {
    this.azimuth += dAzimuth;
    this.polar = THREE.MathUtils.clamp(
      this.polar + dPolar,
      THREE.MathUtils.degToRad(MIN_POLAR_DEG),
      THREE.MathUtils.degToRad(MAX_POLAR_DEG),
    );
    this.frame();
  }

  zoomBy(factor: number): void {
    this.zoom = THREE.MathUtils.clamp(this.zoom * factor, 0.85, 3.2);
    this.frame();
  }

  /** Back to the view the game opens on, for whichever corner it is. */
  recentre(): void {
    this.azimuth = 0;
    this.polar = THREE.MathUtils.degToRad(DEFAULT_POLAR_DEG);
    this.zoom = 1;
    this.frame();
  }

  /**
   * Keep this much of the window clear.
   *
   * The tray of pieces lies across the bottom and the chat opens down the
   * right, and a board centred in the WINDOW ends up half underneath them. The
   * camera reframes to centre the board in what is left, which on a wide
   * screen costs nothing at all.
   */
  reserve(right: number, bottom: number): void {
    this.insetRight = Math.max(0, right);
    this.insetBottom = Math.max(0, bottom);
    this.frame();
  }

  /**
   * Re-derive the camera from azimuth / polar / zoom and the viewport.
   *
   * With a perspective camera the framing is the DISTANCE, not a frustum: back
   * off until the board fits, then divide by the zoom. The fit measures where
   * the board's CORNERS actually land rather than backing off far enough for
   * its bounding sphere — a board seen from above covers a square, not a
   * circle, and a sphere fit leaves a third of the screen empty.
   */
  private frame(): void {
    this.dirty = true;
    const w = window.innerWidth, h = window.innerHeight;
    const vFov = THREE.MathUtils.degToRad(FOV_DEG);
    // A first guess, close enough that the measured fit below converges in a
    // couple of passes. The fit is what actually decides the distance.
    let r = (HALF * Math.SQRT2 * 1.1) / Math.tan(vFov / 2) / this.zoom;

    const az = this.baseAzimuth + this.azimuth;
    const sp = Math.sin(this.polar), cp = Math.cos(this.polar);
    const put = (dist: number): void => {
      this.camera.position.set(dist * sp * Math.sin(az), dist * cp, dist * sp * Math.cos(az));
      this.camera.lookAt(0, 0, 0);
      // Slide the whole picture away from the strips the tray and the chat
      // cover, so the board sits in the middle of what is VISIBLE rather than
      // of the window. A POSITIVE offset moves the picture left and up, which
      // is the direction the reserved edges are not.
      if (this.insetRight > 0 || this.insetBottom > 0) {
        this.camera.setViewOffset(w, h, this.insetRight / 2, this.insetBottom / 2, w, h);
      } else {
        this.camera.clearViewOffset();
      }
      this.camera.updateProjectionMatrix();
      this.camera.updateMatrixWorld();
    };
    put(r);

    /**
     * Fit the board to the part of the window nothing is standing on.
     *
     * Measured in SCREEN PIXELS against that rectangle, rather than in
     * normalised coordinates against the whole window: with a view offset the
     * two are not the same thing, and the version that mixed them backed the
     * camera off by nearly half for a tray a seventh of the screen tall.
     *
     * The corners are measured rather than a bounding sphere: a board seen
     * from above covers a square, not a circle, and a sphere fit leaves a
     * third of the screen empty. The tile height is in the measurement too,
     * so a piece on the near edge is not sliced off by the bottom.
     */
    const v = new THREE.Vector3();
    const top = SLAB + TILE_H;
    const cx = (w - this.insetRight) / 2;
    const cy = (h - this.insetBottom) / 2;
    // 0.94 leaves a little air so nothing touches an edge of the screen.
    const halfW = Math.max(60, cx * 0.94);
    const halfH = Math.max(60, cy * 0.94);
    for (let i = 0; i < 4; i++) {
      let worst = 0;
      for (const bx of [-HALF, HALF]) {
        for (const bz of [-HALF, HALF]) {
          for (const by of [0, top]) {
            v.set(bx, by, bz).project(this.camera);
            const sx = ((v.x + 1) / 2) * w;
            const sy = ((1 - v.y) / 2) * h;
            worst = Math.max(worst, Math.abs(sx - cx) / halfW, Math.abs(sy - cy) / halfH);
          }
        }
      }
      if (!Number.isFinite(worst) || worst <= 0) break;
      r *= worst;
      put(r);
      if (Math.abs(worst - 1) < 0.005) break;
    }
  }

  resize(): void {
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.frame();
  }

  /** Move whatever is mid-flight. Called every frame; cheap when nothing is. */
  private animate(now: number): void {
    if (this.dropping) {
      const { cells, player, started } = this.dropping;
      const k = Math.min(1, (now - started) / DROP_MS);
      // Ease out cubic, and a touch of overshoot at the end so it lands with
      // a knock rather than settling like a feather.
      const e = 1 - Math.pow(1 - k, 3);
      const lift = DROP_FROM * (1 - e);
      const mesh = this.tiles[player];
      const m = new THREE.Matrix4();
      for (const [x, y] of cells) {
        const i = this.slot.get(`${player}:${x},${y}`);
        if (i === undefined || i >= mesh.count) continue;
        const p = this.at(x, y);
        m.makeTranslation(p.x, SLAB + TILE_H / 2 + lift, p.z);
        mesh.setMatrixAt(i, m);
      }
      mesh.instanceMatrix.needsUpdate = true;
      this.dirty = true;
      if (k >= 1) this.dropping = null;
    }
    if (this.lastMark.count > 0) {
      const k = (now - this.lastAt) / LAST_MS;
      if (k >= 1) {
        this.lastMark.count = 0;
      } else {
        // Two slow pulses, fading out. A mark that simply sits there stops
        // being a mark after the third turn.
        const mat = this.lastMark.material as THREE.MeshBasicMaterial;
        mat.opacity = (1 - k) * (0.55 + 0.45 * Math.cos(k * Math.PI * 4));
      }
      this.dirty = true;
    }
  }

  /** Draw, if there is anything new to draw. Returns whether it did, so the
   *  DOM overlays pinned to cells know when to follow. */
  render(): boolean {
    this.animate(performance.now());
    if (!this.dirty) return false;
    this.dirty = false;
    this.renderer.render(this.scene, this.camera);
    return true;
  }

  invalidate(): void { this.dirty = true; }
}

/**
 * The grid and the frame, painted once into a canvas.
 *
 * Canvas row 0 is the far side of the board, which is `y = 0`, so a board
 * printed in array order is the board as it is drawn. The four starting cells
 * are painted in their owners' colours: that is where each player's first
 * piece must go, and a rule stated in the corner of the board is one nobody
 * has to be told twice.
 */
function boardTexture(): THREE.CanvasTexture {
  const px = 2048;
  const c = document.createElement('canvas');
  c.width = c.height = px;
  const ctx = c.getContext('2d')!;
  const unit = px / (SIZE + 2 * BORDER);
  const edge = BORDER * unit;

  ctx.fillStyle = RIM;
  ctx.fillRect(0, 0, px, px);
  ctx.fillStyle = FELT;
  ctx.fillRect(edge, edge, px - 2 * edge, px - 2 * edge);

  // A faint cast across the felt, so a twenty by twenty field of one colour
  // is not a flat rectangle of paint.
  const wash = ctx.createLinearGradient(edge, edge, px - edge, px - edge);
  wash.addColorStop(0, 'rgba(255,255,255,0.045)');
  wash.addColorStop(0.5, 'rgba(255,255,255,0.01)');
  wash.addColorStop(1, 'rgba(0,0,0,0.12)');
  ctx.fillStyle = wash;
  ctx.fillRect(edge, edge, px - 2 * edge, px - 2 * edge);

  // The starting corners, in their owners' colours.
  for (let p = 0; p < PLAYERS; p++) {
    const [cx, cy] = CORNERS[p];
    const hex = `#${COLOURS[p].toString(16).padStart(6, '0')}`;
    ctx.fillStyle = hex;
    ctx.globalAlpha = 0.22;
    ctx.fillRect(edge + cx * unit, edge + cy * unit, unit, unit);
    ctx.globalAlpha = 1;
    ctx.strokeStyle = hex;
    ctx.lineWidth = Math.max(2, unit * 0.09);
    ctx.strokeRect(edge + cx * unit + 2, edge + cy * unit + 2, unit - 4, unit - 4);
  }

  ctx.strokeStyle = GRID;
  ctx.lineWidth = Math.max(1, unit * 0.035);
  ctx.beginPath();
  for (let i = 0; i <= SIZE; i++) {
    const at = edge + i * unit;
    ctx.moveTo(at, edge); ctx.lineTo(at, px - edge);
    ctx.moveTo(edge, at); ctx.lineTo(px - edge, at);
  }
  ctx.stroke();

  // A brighter line every five cells: counting to twenty across a board is
  // how a player works out whether a piece reaches, and nobody counts to
  // twenty one square at a time.
  ctx.strokeStyle = 'rgba(255,255,255,0.16)';
  ctx.lineWidth = Math.max(1.5, unit * 0.05);
  ctx.beginPath();
  for (let i = 0; i <= SIZE; i += 5) {
    const at = edge + i * unit;
    ctx.moveTo(at, edge); ctx.lineTo(at, px - edge);
    ctx.moveTo(edge, at); ctx.lineTo(px - edge, at);
  }
  ctx.stroke();

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}
