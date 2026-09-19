// The board, drawn.
//
// Two decisions here are load-bearing and everything else follows from them.
//
// **The camera is orthographic.** A perspective camera looking down at a board
// turns the far half into a smaller, tighter grid: the same finger lands on a
// different-sized target depending on where it is, and on 19x19 the back rows
// become genuinely hard to hit. Orthographic keeps every intersection the same
// size no matter where it is or how the camera is turned.
//
// **It is tilted a little, not straight down.** From directly overhead a stone
// is a flat disc and the whole point of drawing this in 3D disappears. Ten-odd
// degrees plus a light off to one side gives the stones thickness and a small
// shadow, while the grid stays square because of the line above.
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
const TOP_Y = 0.06;

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
  readonly camera: THREE.OrthographicCamera;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly raycaster = new THREE.Raycaster();
  private readonly plane: THREE.Plane;

  private size = 9;
  private spacing = 0;
  private margin = 0;
  private board: THREE.Mesh | null = null;
  private stones: Record<'black' | 'white', THREE.InstancedMesh> | null = null;
  private marker: THREE.Mesh;
  private ghostMesh: THREE.Mesh;
  /** Rings the coach points with. One mesh per marked point, pooled. */
  private highlights: THREE.Mesh[] = [];
  /** Screen width, in pixels, the chat panel is occupying on the right. */
  private insetRight = 0;

  // Camera state as spherical coordinates around the board's centre. Kept as
  // numbers rather than read back off the camera so "reset" is exact and the
  // limits are enforced in one place.
  private azimuth = 0;
  private polar = THREE.MathUtils.degToRad(13);
  private zoom = 1;
  private readonly defaults = { azimuth: 0, polar: THREE.MathUtils.degToRad(13), zoom: 1 };

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    // PCFSoft was removed in three 0.186; PCF is what it falls back to anyway.
    this.renderer.shadowMap.type = THREE.PCFShadowMap;

    this.scene.background = new THREE.Color('#1b1d22');
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 100);
    this.plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -TOP_Y);

    // Key light from the front-left so the shadow falls away from the player's
    // own hand on a phone; fill from the other side so stones are not half black.
    const key = new THREE.DirectionalLight(0xffffff, 1.5);
    key.position.set(-2.2, 4.2, 2.6);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    const cam = key.shadow.camera as THREE.OrthographicCamera;
    cam.left = -1.6; cam.right = 1.6; cam.top = 1.6; cam.bottom = -1.6;
    cam.near = 0.5; cam.far = 12;
    key.shadow.bias = -0.0009;
    this.scene.add(key);
    this.scene.add(new THREE.HemisphereLight(0xdfe6f2, 0x2a2118, 1.1));

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
    this.size = size;
    ({ spacing: this.spacing, margin: this.margin } = metrics(size));

    if (this.board) {
      this.scene.remove(this.board);
      (this.board.material as THREE.Material[]).forEach((m) => m.dispose());
      this.board.geometry.dispose();
    }
    const top = new THREE.MeshStandardMaterial({ map: boardTexture(size), roughness: 0.62, metalness: 0 });
    const side = new THREE.MeshStandardMaterial({ color: 0xd8a860, roughness: 0.7 });
    // BoxGeometry's material slots are +x, −x, +y, −y, +z, −z: only the top
    // (+y) carries the grid.
    this.board = new THREE.Mesh(
      new THREE.BoxGeometry(2 * HALF, TOP_Y, 2 * HALF),
      [side, side, top, side, side, side],
    );
    this.board.position.y = TOP_Y / 2;
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
    if (game.size !== this.size) this.setBoardSize(game.size);

    const m = new THREE.Matrix4();
    const counts = { black: 0, white: 0 };
    const scale = new THREE.Vector3(this.spacing, this.spacing, this.spacing);
    for (const stone of game.stones()) {
      const mesh = this.stones[stone.player];
      m.compose(this.at(stone.x, stone.y), new THREE.Quaternion(), scale);
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
    this.ghostMesh.visible = !!at;
    if (!at) return;
    const mat = this.ghostMesh.material as THREE.MeshStandardMaterial;
    mat.color.set(player === 'black' ? 0x14161a : 0xf2efe6);
    this.ghostMesh.position.copy(this.at(at.x, at.y));
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

  /** Mark points the coach is talking about. Empty clears. */
  setHighlights(points: Array<{ x: number; y: number }>): void {
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

  orbit(dAzimuth: number, dPolar: number): void {
    this.azimuth += dAzimuth;
    // Never below the board (you would be looking at its underside) and never
    // so far over that the grid stops reading as a grid.
    this.polar = THREE.MathUtils.clamp(this.polar + dPolar, 0, THREE.MathUtils.degToRad(62));
    this.place();
  }

  zoomBy(factor: number): void {
    this.zoom = THREE.MathUtils.clamp(this.zoom * factor, 0.75, 3);
    this.place();
  }

  /** Back to the view the game opens on. */
  resetCamera(): void {
    Object.assign(this, this.defaults);
    this.place();
  }

  /** Re-derive the camera from azimuth/polar/zoom and the viewport. */
  private place(): void {
    const r = 6;
    const sp = Math.sin(this.polar), cp = Math.cos(this.polar);
    this.camera.position.set(r * sp * Math.sin(this.azimuth), r * cp, r * sp * Math.cos(this.azimuth));
    this.camera.lookAt(0, 0, 0);
    this.camera.zoom = this.zoom;
    this.camera.updateProjectionMatrix();
  }

  resize(): void {
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    const aspect = w / h;
    // 1.12 = the board plus a tenth of itself in air, so nothing touches an edge.
    const pad = HALF * 1.12;
    const usable = Math.max(1, w - this.insetRight);
    // Wide enough for the board vertically, and wide enough for it to fit in
    // the part of the window that is not covered — whichever is the bigger ask.
    const extentX = Math.max(pad * aspect, (pad * w) / usable);
    const extentY = extentX / aspect;
    // Pushing the frustum right moves the board left, into the free space.
    const shift = (this.insetRight / w) * extentX;
    this.camera.left = -extentX + shift;
    this.camera.right = extentX + shift;
    this.camera.top = extentY;
    this.camera.bottom = -extentY;
    this.place();
  }

  render(): void {
    this.renderer.render(this.scene, this.camera);
  }
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

  ctx.fillStyle = '#e3b878';
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
