// The board, drawn.
//
// Two decisions here are load-bearing and everything else follows from them.
//
// **The camera is a LONG LENS** — perspective, but a narrow one (FOV_DEG),
// which is not the same thing as a normal 3D camera and not the same thing as
// an orthographic one either.
//
// This started orthographic, for a real reason: a wide perspective lens makes
// the far half of the board smaller and tighter, so the same finger lands on a
// different-sized target depending where it is, and on 19x19 the back rows get
// genuinely hard to hit. But orthographic has no near-and-far at all, and a
// square board seen from an angle with no near-and-far does not look tilted —
// it looks BENT. Opposite edges stay exactly parallel and exactly equal, the
// brain gets no depth cue to explain the shape, and the board reads as a
// squashed rhombus. Which is what it was doing, and it looked broken.
//
// A long lens gets both. Measured, on 19x19 at the default tilt: one space at
// the back row is 33.7 screen pixels against 36.4 at the front — 8%, well
// inside the slack `pick()` already allows, and it is the whole cue the eye
// needs to read the board as a flat thing lying down. Cameras solved this a
// century ago; it is why a telephoto shot of a table looks flat but not bent.
//
// **It is tilted a little, not straight down.** From directly overhead a stone
// is a flat disc and the whole point of drawing this in 3D disappears. Ten-odd
// degrees plus a light off to one side gives the stones thickness and a small
// shadow.
//
// The grid is PAINTED INTO THE BOARD'S TEXTURE rather than drawn as geometry.
// Lines sitting a hair above a surface z-fight at some camera angles and vanish
// at others, and the fix people reach for (polygon offset) trades one artefact
// for another. A texture is also where the star points and the wood grain live,
// so the board is one material and one draw call.
import * as THREE from 'three';
import type { GoGame } from '../go/rules';

/** Half-width of the board slab in world units. The playing grid is inset. */
const HALF = 1;
/**
 * How far the outermost line sits from the edge of the wood, in units of one
 * line spacing. It has to be at least half a spacing or a corner stone — which
 * is nearly a full spacing wide — hangs off the board into mid-air. Real boards
 * leave about this much.
 */
const MARGIN_RATIO = 0.62;
/**
 * How thick the board is.
 *
 * Thicker than it was (0.06), because the board is now sitting on a table
 * rather than floating on a flat colour, and the thing that says "sitting on"
 * is the edge you can see and the shadow it drops. A real table goban is a
 * couple of centimetres on a forty-centimetre board; this is a little more
 * than that, because at this camera angle the edge is foreshortened.
 */
const TOP_Y = 0.1;
/** How far the table stretches past the board, in board half-widths. Big
 *  enough to fill the frame at every aspect this game is played at. */
const TABLE = 5;
/** The lens. Long enough that foreshortening is a cue rather than a distortion
 *  — see the note at the top of this file. */
const FOV_DEG = 22;
/**
 * How far the camera is tilted from overhead. Zero: straight down.
 *
 * FIXED, and that is the whole camera: no orbit, no pinch, nothing to
 * recentre. A board game is not a world to look around — the position is the
 * same information from every angle, so a camera the player can move is a
 * camera they can lose.
 *
 * Straight down is the one angle at which a square board is a SQUARE. Any
 * tilt at all makes it a trapezoid, and on a grid of intersections that costs
 * twice: the far rows close up, and the shape the player is reading is not
 * the shape the game is played on.
 *
 * What the tilt was buying was depth — the board's edge and the shadow it
 * drops. The edge is gone from up here; the shadows are not. The lamp is
 * still low and to one side, so the board throws a shadow on the table beside
 * it and every stone throws one on the board, which is exactly how a
 * photograph taken from above reads as objects rather than as a diagram.
 */
const POLAR_DEG = 0;

/** Line spacing, and the inset that follows from it, for a board size. */
function metrics(size: number): { spacing: number; margin: number } {
  const spacing = (2 * HALF) / (size - 1 + 2 * MARGIN_RATIO);
  return { spacing, margin: spacing * MARGIN_RATIO };
}

const STAR_POINTS: Record<number, Array<[number, number]>> = {
  9: [[2, 2], [6, 2], [4, 4], [2, 6], [6, 6]],
  13: [[3, 3], [9, 3], [6, 6], [3, 9], [9, 9]],
  19: [[3, 3], [9, 3], [15, 3], [3, 9], [9, 9], [15, 9], [3, 15], [9, 15], [15, 15]],
};

export interface Picked { x: number; y: number }

export class BoardView {
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly raycaster = new THREE.Raycaster();
  private readonly plane: THREE.Plane;

  private size = 9;
  private spacing = 0;
  private margin = 0;
  /**
   * Whether the picture on screen is out of date.
   *
   * A Go board does not move between moves. Drawing it sixty times a second
   * anyway costs a whole core — and on this game that is a core taken away
   * from the ENGINE, which is the thing the player is actually waiting for. So
   * the loop draws when something has changed and otherwise does nothing.
   */
  private dirty = true;
  private board: THREE.Mesh | null = null;
  private stones: Record<'black' | 'white', THREE.InstancedMesh> | null = null;
  private marker: THREE.Mesh;
  private ghostMesh: THREE.Mesh;
  /** Rings the companion points with. One mesh per marked point, pooled. */
  private highlights: THREE.Mesh[] = [];
  /**
   * The point the sentence on screen is about.
   *
   * Kept apart from the marks above, and that separation is the whole reason
   * this exists: the bubble sets its anchor on every page, and when it shared
   * the marks, a sentence with no coordinate in it cleared the ring the
   * companion had just drawn — so `highlight` appeared to do nothing at all.
   */
  private focusRing: THREE.Mesh | null = null;
  /** Territory marks, shown only once the game is counted. */
  private territory: Record<'black' | 'white', THREE.InstancedMesh> | null = null;
  /** Keys of stones the count found dead, so they can be drawn as removed. */
  private dead = new Set<string>();
  /** Screen width, in pixels, the chat panel is occupying on the right. */
  private insetRight = 0;

  // Where the camera is, as spherical coordinates around the board's centre.
  // Constants: see POLAR_DEG.
  private readonly azimuth = 0;
  private readonly polar = THREE.MathUtils.degToRad(POLAR_DEG);

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    // PCFSoft was removed in three 0.186; PCF is what it falls back to anyway.
    this.renderer.shadowMap.type = THREE.PCFShadowMap;

    // Near the table's own darkest tone, so the sliver beyond the table at a
    // wide aspect ratio does not read as a hole.
    this.scene.background = new THREE.Color('#140e09');
    this.camera = new THREE.PerspectiveCamera(FOV_DEG, 1, 0.1, 100);
    this.plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -TOP_Y);

    // Key light from the front-left so the shadow falls away from the player's
    // own hand on a phone; fill from the other side so stones are not half
    // black. Warm, and warmer than it was: this is a lamp over a table now,
    // not a light box.
    // Low, and from the top left. Two separate decisions:
    //
    // LOW (about thirty degrees above the table, not forty-five) because a
    // high lamp drops the board's shadow almost straight down and there is
    // nothing to see — and from directly overhead that shadow is the only
    // thing left saying the board has any thickness at all.
    //
    // TOP LEFT because the camera looks straight down now, and a picture seen
    // from above reads as lit when the shadows fall down and to the right. It
    // used to come from the front so the shadow fell away from the hand
    // holding a phone, which was the right call for a tilted view and is not
    // a consideration from up here.
    const key = new THREE.DirectionalLight(0xfff1dc, 2.0);
    key.position.set(-3.1, 2.3, -2.1);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    const cam = key.shadow.camera as THREE.OrthographicCamera;
    // Wide enough for the board's shadow to land on the table beside it.
    cam.left = -2.6; cam.right = 2.6; cam.top = 2.6; cam.bottom = -2.6;
    cam.near = 0.5; cam.far = 12;
    key.shadow.bias = -0.0008;
    key.shadow.normalBias = 0.02;
    this.scene.add(key);
    // Enough fill that a stone is not half black, and no more: fill is the
    // enemy of the shadow that makes the board sit on the table.
    this.scene.add(new THREE.HemisphereLight(0xcfd8e6, 0x140c06, 0.62));
    // A little warmth bouncing back off the table, so the board's near edge
    // is not the darkest thing on screen.
    const bounce = new THREE.DirectionalLight(0xffd9a8, 0.28);
    bounce.position.set(2.4, 1.2, 1.8);
    this.scene.add(bounce);

    // The table. One big plane in dark wood, which is what makes the board
    // read as an object put down somewhere rather than a texture floating in
    // the dark — and it is what the board's shadow falls on.
    const table = new THREE.Mesh(
      new THREE.PlaneGeometry(2 * HALF * TABLE, 2 * HALF * TABLE).rotateX(-Math.PI / 2),
      new THREE.MeshStandardMaterial({ map: tableTexture(), roughness: 0.78, metalness: 0 }),
    );
    table.position.y = -0.002;  // a hair under the board, so they never z-fight
    table.receiveShadow = true;
    this.scene.add(table);

    // The stone the player has put down but not committed to yet.
    this.ghostMesh = new THREE.Mesh(stoneGeometry(), new THREE.MeshStandardMaterial({
      color: 0x111111, roughness: 0.35, transparent: true, opacity: 0.45,
    }));
    this.ghostMesh.visible = false;
    this.scene.add(this.ghostMesh);

    // Where the last stone went. A ring, not a dot: a dot on a black stone is
    // invisible and a dot on a white one covers the stone.
    this.marker = new THREE.Mesh(
      new THREE.TorusGeometry(0.5, 0.09, 8, 28),
      new THREE.MeshBasicMaterial({ color: 0xff5a4d }),
    );
    this.marker.rotation.x = -Math.PI / 2;
    this.marker.visible = false;
    this.scene.add(this.marker);

    this.setBoardSize(9);
    this.resize();
  }

  /** Build (or rebuild) the board for a size. Cheap enough to call on a size
   *  change; there is nothing to reuse between a 9x9 and a 19x19 grid. */
  setBoardSize(size: number): void {
    // Already this size: do nothing at all. Rebuilding is not free and it is
    // not invisible — the grain is drawn with random strokes, so a rebuild
    // gives the board a DIFFERENT piece of wood, and it takes the ghost stone
    // and anything pinned to a point with it. "Set it to what it already is"
    // arrives from the companion, which will happily agree to play on the
    // board that is already in front of it.
    if (size === this.size && this.board) return;
    this.size = size;
    this.dirty = true;
    ({ spacing: this.spacing, margin: this.margin } = metrics(size));

    if (this.board) {
      this.scene.remove(this.board);
      (this.board.material as THREE.Material[]).forEach((m) => m.dispose());
      this.board.geometry.dispose();
    }
    const top = new THREE.MeshStandardMaterial({ map: boardTexture(size), roughness: 0.62, metalness: 0 });
    // The edge of the board, with its own end grain. Flat colour was fine
    // when the board was 0.06 thick and nobody could see it.
    const side = new THREE.MeshStandardMaterial({ map: edgeTexture(), roughness: 0.68, metalness: 0 });
    // BoxGeometry's material slots are +x, −x, +y, −y, +z, −z: only the top
    // (+y) carries the grid.
    this.board = new THREE.Mesh(
      new THREE.BoxGeometry(2 * HALF, TOP_Y, 2 * HALF),
      [side, side, top, side, side, side],
    );
    this.board.position.y = TOP_Y / 2;
    this.board.castShadow = true;
    this.board.receiveShadow = true;
    this.scene.add(this.board);

    if (this.stones) {
      for (const m of Object.values(this.stones)) { this.scene.remove(m); m.dispose(); }
    }
    const capacity = size * size;
    const geo = stoneGeometry();
    const mk = (color: number, roughness: number): THREE.InstancedMesh => {
      const mesh = new THREE.InstancedMesh(geo, new THREE.MeshStandardMaterial({ color, roughness, metalness: 0.02 }), capacity);
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.count = 0;
      this.scene.add(mesh);
      return mesh;
    };
    // Slate is nearly black and glossy; clamshell is warm white and softer.
    this.stones = { black: mk(0x14161a, 0.28), white: mk(0xf2efe6, 0.44) };

    if (this.territory) {
      for (const m of Object.values(this.territory)) { this.scene.remove(m); m.dispose(); }
    }
    // Flat, unlit squares: territory is information, not an object on the
    // board, and shading it would make it read as another kind of stone.
    const tile = new THREE.PlaneGeometry(0.34, 0.34).rotateX(-Math.PI / 2);
    const tmk = (color: number): THREE.InstancedMesh => {
      const mesh = new THREE.InstancedMesh(tile, new THREE.MeshBasicMaterial({
        color, transparent: true, opacity: 0.85, depthWrite: false,
      }), capacity);
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.count = 0;
      mesh.renderOrder = 2;
      this.scene.add(mesh);
      return mesh;
    };
    this.territory = { black: tmk(0x0b0d10), white: tmk(0xfbf8f0) };

    const s = this.spacing;
    this.ghostMesh.scale.setScalar(s);
    this.marker.scale.setScalar(s * 0.48);
  }

  /** World position of an intersection. */
  private at(x: number, y: number): THREE.Vector3 {
    const o = -(HALF - this.margin);
    return new THREE.Vector3(o + x * this.spacing, TOP_Y, o + y * this.spacing);
  }

  /** Put the board on screen in the state the game is in. */
  sync(game: GoGame): void {
    if (!this.stones) return;
    this.dirty = true;
    if (game.size !== this.size) this.setBoardSize(game.size);

    const m = new THREE.Matrix4();
    const counts = { black: 0, white: 0 };
    const scale = new THREE.Vector3(this.spacing, this.spacing, this.spacing);
    const dead = new THREE.Vector3(this.spacing * 0.5, this.spacing * 0.3, this.spacing * 0.5);
    for (const stone of game.stones()) {
      const mesh = this.stones[stone.player];
      // A stone the count found dead is drawn small — it is off the board in
      // the arithmetic, and leaving it full size is how a player ends up
      // certain they were robbed.
      const isDead = this.dead.has(`${stone.x},${stone.y}`);
      m.compose(this.at(stone.x, stone.y), new THREE.Quaternion(), isDead ? dead : scale);
      mesh.setMatrixAt(counts[stone.player]++, m);
    }
    for (const key of ['black', 'white'] as const) {
      this.stones[key].count = counts[key];
      this.stones[key].instanceMatrix.needsUpdate = true;
      // Without this the mesh is culled against whatever volume the first
      // frame's instances happened to occupy, and stones near the edge blink
      // out as the camera turns.
      this.stones[key].computeBoundingSphere();
    }

    const last = game.lastStone;
    this.marker.visible = !!last;
    if (last) {
      const p = this.at(last.x, last.y);
      this.marker.position.set(p.x, TOP_Y + this.spacing * 0.38, p.z);
    }
  }

  /** Show (or hide) the uncommitted stone. */
  setGhost(at: Picked | null, player: 'black' | 'white'): void {
    this.dirty = true;
    this.ghostMesh.visible = !!at;
    if (!at) return;
    const mat = this.ghostMesh.material as THREE.MeshStandardMaterial;
    mat.color.set(player === 'black' ? 0x14161a : 0xf2efe6);
    this.ghostMesh.position.copy(this.at(at.x, at.y));
  }

  /**
   * Where an intersection is on screen, in CSS pixels — the inverse of `pick`.
   *
   * This is what lets the coach point at things: a speech bubble anchored to
   * D4 has to follow D4 when the camera turns, and "D4" in a chat log is a
   * coordinate the player has to translate for themselves, which on a board
   * with thirty stones on it they will get wrong.
   */
  screenOf(x: number, y: number): { x: number; y: number } {
    const p = this.at(x, y).project(this.camera);
    const rect = this.renderer.domElement.getBoundingClientRect();
    return {
      x: rect.left + ((p.x + 1) / 2) * rect.width,
      y: rect.top + ((1 - p.y) / 2) * rect.height,
    };
  }

  /** One line spacing, in screen pixels — how far a bubble has to sit from the
   *  point it belongs to in order to clear the stone on it. */
  get screenSpacing(): number {
    const a = this.screenOf(0, 0);
    const b = this.screenOf(1, 0);
    return Math.hypot(a.x - b.x, a.y - b.y);
  }

  /** Which intersection is under this screen point, if any is close enough. */
  pick(clientX: number, clientY: number): Picked | null {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1,
    );
    this.raycaster.setFromCamera(ndc, this.camera);
    const hit = new THREE.Vector3();
    if (!this.raycaster.ray.intersectPlane(this.plane, hit)) return null;

    const o = -(HALF - this.margin);
    const x = Math.round((hit.x - o) / this.spacing);
    const y = Math.round((hit.z - o) / this.spacing);
    if (x < 0 || y < 0 || x >= this.size || y >= this.size) return null;
    // Half a space of slack, no more: past that the player is pointing at a
    // different intersection and would rather be told nothing than be given
    // the wrong one.
    const p = this.at(x, y);
    if (Math.hypot(hit.x - p.x, hit.z - p.z) > this.spacing * 0.55) return null;
    return { x, y };
  }

  /** The point the current sentence is about. Null clears it, and clears only
   *  it — the companion's own marks are untouched. */
  setFocus(at: { x: number; y: number } | null): void {
    this.dirty = true;
    if (!this.focusRing) {
      const ring = new THREE.Mesh(
        new THREE.TorusGeometry(0.52, 0.055, 8, 28),
        new THREE.MeshBasicMaterial({ color: 0xffd76a, transparent: true, opacity: 0.9 }),
      );
      ring.rotation.x = -Math.PI / 2;
      this.scene.add(ring);
      this.focusRing = ring;
    }
    this.focusRing.visible = !!at;
    if (!at) return;
    this.focusRing.scale.setScalar(this.spacing);
    const p = this.at(at.x, at.y);
    this.focusRing.position.set(p.x, TOP_Y + this.spacing * 0.44, p.z);
  }

  /** Mark points the companion is talking about. Empty clears. */
  setHighlights(points: Array<{ x: number; y: number }>): void {
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
      // Above a stone if there is one there, so pointing at a played stone
      // reads as "this one" rather than being hidden underneath it.
      ring.position.set(at.x, TOP_Y + this.spacing * 0.42, at.z);
    });
  }

  /**
   * Show (or clear) the count.
   *
   * `owner` is one entry per intersection — 1 black, −1 white, 0 nobody — and
   * `dead` the stones standing on ground the other side owns. Pass null to put
   * the board back to how it plays.
   */
  setTerritory(owner: number[] | null, dead: Array<{ x: number; y: number }> = [], game?: GoGame): void {
    this.dirty = true;
    this.dead = new Set(dead.map((d) => `${d.x},${d.y}`));
    if (game) this.sync(game);
    if (!this.territory) return;

    const counts = { black: 0, white: 0 };
    if (owner) {
      const m = new THREE.Matrix4();
      const scale = new THREE.Vector3(this.spacing, this.spacing, this.spacing);
      const q = new THREE.Quaternion();
      for (let y = 0; y < this.size; y++) {
        for (let x = 0; x < this.size; x++) {
          const side = owner[y * this.size + x] ?? 0;
          if (side === 0) continue;
          const key = side === 1 ? 'black' : 'white';
          const at = this.at(x, y);
          // Just clear of the wood, and clear of a dead stone's shrunken dome.
          m.compose(new THREE.Vector3(at.x, TOP_Y + this.spacing * 0.02, at.z), q, scale);
          this.territory[key].setMatrixAt(counts[key]++, m);
        }
      }
    }
    for (const key of ['black', 'white'] as const) {
      this.territory[key].count = counts[key];
      this.territory[key].instanceMatrix.needsUpdate = true;
      this.territory[key].computeBoundingSphere();
    }
  }

  /**
   * Keep this many pixels on the right clear.
   *
   * The chat panel opens over the right-hand side, and a board that stays
   * centred in the window ends up half behind it. Rather than shrink the board
   * on a fixed guess, the camera is reframed to centre it in what is left —
   * which on a wide screen costs nothing at all, because the board was never
   * that wide to begin with.
   */
  reserveRight(px: number): void {
    this.insetRight = Math.max(0, px);
    this.resize();
  }

  /**
   * Re-derive the camera from the viewport.
   *
   * With a perspective camera the framing is the DISTANCE, not a frustum: back
   * off until the board fits the narrower of the two screen axes. Doing it
   * here rather than in `resize` means the one thing that can still change it
   * — the window, and the chat panel opening — goes through one piece of
   * arithmetic.
   */
  private place(): void {
    this.dirty = true;
    const w = window.innerWidth, h = window.innerHeight;
    const vFov = THREE.MathUtils.degToRad(FOV_DEG);
    // A first guess from the board's bounding sphere: always far enough, often
    // too far. The fit below pulls it in.
    const need = HALF * Math.SQRT2 * 1.06;
    const usable = Math.max(1, w - this.insetRight);
    const hFov = 2 * Math.atan(Math.tan(vFov / 2) * (usable / h));
    let r = Math.max(need / Math.tan(vFov / 2), need / Math.tan(hFov / 2));

    const sp = Math.sin(this.polar), cp = Math.cos(this.polar);
    const put = (dist: number): void => {
      this.camera.position.set(dist * sp * Math.sin(this.azimuth), dist * cp, dist * sp * Math.cos(this.azimuth));
      // Which way is up, on screen. It has to be said out loud from straight
      // overhead: the default up (+y) is the direction the camera is looking
      // along, `lookAt` has no way to resolve that, and the board arrives at
      // an arbitrary rotation or as NaN. −z is the far side of the board, so
      // row 1 stays at the top where it has always been.
      this.camera.up.set(0, 0, -1);
      this.camera.lookAt(0, 0, 0);
      // Slide the whole picture left by half the covered strip, so the board
      // sits in the middle of what is VISIBLE rather than of the window.
      if (this.insetRight > 0) this.camera.setViewOffset(w, h, this.insetRight / 2, 0, w, h);
      else this.camera.clearViewOffset();
      this.camera.updateProjectionMatrix();
      this.camera.updateMatrixWorld();
    };
    put(r);

    // Then fit for real, by asking where the corners actually land.
    //
    // The alternative — backing off far enough for the bounding SPHERE — is
    // correct at every angle and wasteful at all but one of them: a board seen
    // from above covers a square, not a circle, so a sphere fit leaves a third
    // of the screen empty and the board looks small for no reason. Four rounds
    // of measure-and-scale converge well inside a pixel, and it costs eight
    // matrix multiplies on a camera move.
    const v = new THREE.Vector3();
    for (let i = 0; i < 4; i++) {
      let worst = 0;
      for (const cx of [-HALF, HALF]) {
        for (const cz of [-HALF, HALF]) {
          for (const cy of [0, TOP_Y]) {
            v.set(cx, cy, cz).project(this.camera);
            worst = Math.max(worst, Math.abs(v.x), Math.abs(v.y));
          }
        }
      }
      if (!Number.isFinite(worst) || worst <= 0) break;
      // 0.84, not 0.94: the board is on a table now, and some of the table
      // has to be in frame or it is not a table, it is a backdrop.
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

  /** Draw, if there is anything new to draw. Returns whether it did, so the
   *  DOM overlays pinned to board points know when to follow. */
  render(): boolean {
    if (!this.dirty) return false;
    this.dirty = false;
    this.renderer.render(this.scene, this.camera);
    return true;
  }

  /** Something changed; draw on the next frame. */
  invalidate(): void { this.dirty = true; }
}

/** One squashed sphere, shared by every stone on the board. */
function stoneGeometry(): THREE.BufferGeometry {
  const g = new THREE.SphereGeometry(0.47, 24, 16);
  g.scale(1, 0.42, 1);
  g.translate(0, 0.47 * 0.42, 0);
  return g;
}

/** Wood, grid and star points, painted once into a canvas. */
function boardTexture(size: number): THREE.CanvasTexture {
  const px = 1024;
  const c = document.createElement('canvas');
  c.width = c.height = px;
  const ctx = c.getContext('2d')!;

  // Brighter than the table by a good margin, and that gap is doing work: it
  // is what makes the board read as an object put down on the wood rather
  // than as a lighter patch of it.
  ctx.fillStyle = '#edc389';
  ctx.fillRect(0, 0, px, px);
  // Grain: long, low-contrast strokes. Enough to stop the board reading as a
  // flat orange rectangle, not enough to compete with the lines.
  for (let i = 0; i < 260; i++) {
    const y = Math.random() * px;
    ctx.strokeStyle = `rgba(${150 + Math.random() * 40},${100 + Math.random() * 30},${50 + Math.random() * 25},${0.05 + Math.random() * 0.07})`;
    ctx.lineWidth = 1 + Math.random() * 3;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.bezierCurveTo(px * 0.3, y + (Math.random() - 0.5) * 26, px * 0.7, y + (Math.random() - 0.5) * 26, px, y + (Math.random() - 0.5) * 12);
    ctx.stroke();
  }

  // The canvas spans the whole slab (2 * HALF), so a world distance is that
  // fraction of `px`. Deriving both from `metrics` is what keeps the painted
  // grid and the world positions from drifting apart.
  const { spacing, margin: worldMargin } = metrics(size);
  const margin = (worldMargin / (2 * HALF)) * px;
  const step = (spacing / (2 * HALF)) * px;
  ctx.strokeStyle = 'rgba(28,20,12,0.85)';
  ctx.lineWidth = Math.max(1.5, px / 900);
  ctx.beginPath();
  for (let i = 0; i < size; i++) {
    const p = margin + i * step;
    ctx.moveTo(margin, p); ctx.lineTo(px - margin, p);
    ctx.moveTo(p, margin); ctx.lineTo(p, px - margin);
  }
  ctx.stroke();

  // A soft falloff towards the edges of the board itself. Real wood under a
  // lamp is never one flat tone, and without this the board reads as printed
  // paper the moment it stopped being the only thing on screen.
  const shade = ctx.createRadialGradient(px * 0.42, px * 0.38, px * 0.1, px * 0.5, px * 0.5, px * 0.82);
  shade.addColorStop(0, 'rgba(255,244,222,0.12)');
  shade.addColorStop(0.6, 'rgba(0,0,0,0)');
  // Light: enough to round the board off, not enough to make the far corners
  // look unlit. This was 0.20 and the board read as dim.
  shade.addColorStop(1, 'rgba(60,36,14,0.10)');
  ctx.fillStyle = shade;
  ctx.fillRect(0, 0, px, px);

  ctx.fillStyle = 'rgba(28,20,12,0.9)';
  for (const [sx, sy] of STAR_POINTS[size] ?? []) {
    ctx.beginPath();
    ctx.arc(margin + sx * step, margin + sy * step, Math.max(3, step * 0.09), 0, Math.PI * 2);
    ctx.fill();
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
function edgeTexture(): THREE.CanvasTexture {
  const px = 256;
  const c = document.createElement('canvas');
  c.width = px;
  c.height = 64;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#c99a5d';
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
