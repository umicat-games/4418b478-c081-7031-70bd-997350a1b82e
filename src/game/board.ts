// What a gomoku board looks like.
//
// Everything about the camera, the hit-testing and the marks is the shell's
// (`src/shell/boardrig.ts`); this file is only the wood, the grid, the stones
// and the two things that are particular to this game: the marker on the last
// stone, and the line that won.
//
// The grid is PAINTED INTO THE BOARD'S TEXTURE rather than laid over it as
// geometry. Lines sitting a hair above a surface z-fight at some camera angles
// and vanish at others, and the fix people reach for (polygon offset) trades
// one artefact for another. A texture is also where the star points, the
// coordinates and the wood grain live, so the board is one material and one
// draw call.
import * as THREE from 'three';
import { BoardRig, TOP_Y, type Point } from '../shell/boardrig';
import { BLACK, type Gomoku, type Player } from './rules';
import { letters } from './coords';

/** Star points, by board size. On 15 they are the tournament marks; on 19 they
 *  are a Go board's, because that is what a 19 line board is. */
const STARS: Record<number, Array<[number, number]>> = {
  13: [[3, 3], [9, 3], [6, 6], [3, 9], [9, 9]],
  15: [[3, 3], [11, 3], [7, 7], [3, 11], [11, 11]],
  19: [[3, 3], [9, 3], [15, 3], [3, 9], [9, 9], [15, 9], [3, 15], [9, 15], [15, 15]],
};

export class Board {
  private wood: THREE.Mesh | null = null;
  private stones: Record<'black' | 'white', THREE.InstancedMesh> | null = null;
  private marker: THREE.Mesh;
  private ghost: THREE.Mesh;
  private winLine: THREE.Mesh[] = [];

  constructor(private rig: BoardRig, size: number) {
    // The stone the player has aimed at but not committed to.
    this.ghost = new THREE.Mesh(stoneGeometry(), new THREE.MeshStandardMaterial({
      color: 0x111111, roughness: 0.35, transparent: true, opacity: 0.5,
    }));
    this.ghost.visible = false;
    this.rig.scene.add(this.ghost);

    // Where the last stone went. A ring, not a dot: a dot on a black stone is
    // invisible and a dot on a white one covers the stone.
    this.marker = new THREE.Mesh(
      new THREE.TorusGeometry(0.5, 0.09, 8, 28),
      new THREE.MeshBasicMaterial({ color: 0xff5a4d }),
    );
    this.marker.rotation.x = -Math.PI / 2;
    this.marker.visible = false;
    this.rig.scene.add(this.marker);

    this.build(size);
  }

  /** Build (or rebuild) the board for a size. Cheap enough to call on a size
   *  change; there is nothing to reuse between a 13 and a 19 line grid. */
  build(size: number): void {
    this.rig.setGrid({ cols: size, rows: size });

    if (this.wood) {
      this.rig.scene.remove(this.wood);
      (this.wood.material as THREE.Material[]).forEach((m) => m.dispose());
      this.wood.geometry.dispose();
    }
    const top = new THREE.MeshStandardMaterial({ map: boardTexture(this.rig, size), roughness: 0.62, metalness: 0 });
    const side = new THREE.MeshStandardMaterial({ color: 0xd8a860, roughness: 0.7 });
    // BoxGeometry's material slots are +x, −x, +y, −y, +z, −z: only the top
    // (+y) carries the grid.
    this.wood = new THREE.Mesh(
      new THREE.BoxGeometry(2 * this.rig.halfX, TOP_Y, 2 * this.rig.halfZ),
      [side, side, top, side, side, side],
    );
    this.wood.position.y = TOP_Y / 2;
    this.wood.receiveShadow = true;
    this.rig.scene.add(this.wood);

    if (this.stones) for (const m of Object.values(this.stones)) { this.rig.scene.remove(m); m.dispose(); }
    const capacity = size * size;
    const geo = stoneGeometry();
    const mk = (color: number, roughness: number): THREE.InstancedMesh => {
      const mesh = new THREE.InstancedMesh(geo, new THREE.MeshStandardMaterial({ color, roughness, metalness: 0.02 }), capacity);
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.count = 0;
      this.rig.scene.add(mesh);
      return mesh;
    };
    // Slate is nearly black and glossy; clamshell is warm white and softer.
    this.stones = { black: mk(0x14161a, 0.28), white: mk(0xf2efe6, 0.44) };

    this.ghost.scale.setScalar(this.rig.spacing);
    this.marker.scale.setScalar(this.rig.spacing * 0.48);
    this.rig.invalidate();
  }

  /** Put the board on screen in the state the game is in. */
  sync(game: Gomoku): void {
    if (!this.stones) return;
    this.rig.invalidate();
    if (game.size !== this.rig.cols) this.build(game.size);

    const m = new THREE.Matrix4();
    const counts = { black: 0, white: 0 };
    const scale = new THREE.Vector3(this.rig.spacing, this.rig.spacing, this.rig.spacing);
    for (let i = 0; i < game.board.length; i++) {
      const cell = game.board[i];
      if (!cell) continue;
      const key = cell === 1 ? 'black' : 'white';
      m.compose(this.rig.at(game.xOf(i), game.yOf(i)), new THREE.Quaternion(), scale);
      this.stones[key].setMatrixAt(counts[key]++, m);
    }
    for (const key of ['black', 'white'] as const) {
      this.stones[key].count = counts[key];
      this.stones[key].instanceMatrix.needsUpdate = true;
      // Without this the mesh is culled against whatever volume the first
      // frame's instances happened to occupy, and stones near the edge blink
      // out as the camera turns.
      this.stones[key].computeBoundingSphere();
    }

    const last = game.last;
    this.marker.visible = last !== null;
    if (last !== null) {
      const p = this.rig.at(game.xOf(last), game.yOf(last));
      this.marker.position.set(p.x, TOP_Y + this.rig.spacing * 0.38, p.z);
    }

    const out = game.outcome();
    this.setWinLine(out.kind === 'win' ? out.line : []);
  }

  /** Show (or hide) the uncommitted stone. */
  setGhost(at: Point | null, player: Player = BLACK): void {
    this.rig.invalidate();
    this.ghost.visible = !!at;
    if (!at) return;
    (this.ghost.material as THREE.MeshStandardMaterial).color.set(player === BLACK ? 0x14161a : 0xf2efe6);
    this.ghost.position.copy(this.rig.at(at.x, at.y));
  }

  /** The five that ended it, lit. The one moment this game has a result worth
   *  looking at rather than reading. */
  private setWinLine(points: Point[]): void {
    while (this.winLine.length < points.length) {
      const disc = new THREE.Mesh(
        new THREE.CircleGeometry(0.34, 22).rotateX(-Math.PI / 2),
        new THREE.MeshBasicMaterial({ color: 0xffd76a, transparent: true, opacity: 0.55, depthWrite: false }),
      );
      disc.renderOrder = 4;
      this.rig.scene.add(disc);
      this.winLine.push(disc);
    }
    this.winLine.forEach((disc, i) => {
      const p = points[i];
      disc.visible = !!p;
      if (!p) return;
      disc.scale.setScalar(this.rig.spacing);
      const at = this.rig.at(p.x, p.y);
      disc.position.set(at.x, TOP_Y + this.rig.spacing * 0.5, at.z);
    });
  }
}

/** One squashed sphere, shared by every stone on the board. */
function stoneGeometry(): THREE.BufferGeometry {
  const g = new THREE.SphereGeometry(0.47, 24, 16);
  g.scale(1, 0.42, 1);
  g.translate(0, 0.47 * 0.42, 0);
  return g;
}

/** Wood, grid, star points and the coordinates, painted once into a canvas. */
function boardTexture(rig: BoardRig, size: number): THREE.CanvasTexture {
  const px = 1024;
  const c = document.createElement('canvas');
  c.width = c.height = px;
  const ctx = c.getContext('2d')!;

  ctx.fillStyle = '#e8c48c';
  ctx.fillRect(0, 0, px, px);
  // Grain: long, low-contrast strokes. Enough to stop the board reading as a
  // flat orange rectangle, not enough to compete with the lines.
  for (let i = 0; i < 240; i++) {
    const y = Math.random() * px;
    ctx.strokeStyle = `rgba(${150 + Math.random() * 40},${105 + Math.random() * 30},${55 + Math.random() * 25},${0.04 + Math.random() * 0.06})`;
    ctx.lineWidth = 1 + Math.random() * 3;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.bezierCurveTo(px * 0.3, y + (Math.random() - 0.5) * 24, px * 0.7, y + (Math.random() - 0.5) * 24, px, y + (Math.random() - 0.5) * 12);
    ctx.stroke();
  }

  // The canvas spans the whole slab, so a world distance is that fraction of
  // `px`. Both come from the rig, which is what keeps the painted grid and the
  // world positions from drifting apart.
  const step = (rig.spacing / (2 * rig.halfX)) * px;
  const margin = (rig.margin / (2 * rig.halfX)) * px;
  const X = (x: number): number => margin + x * step;

  ctx.strokeStyle = 'rgba(32,24,14,0.85)';
  ctx.lineWidth = Math.max(1.4, px / 900);
  ctx.beginPath();
  for (let i = 0; i < size; i++) {
    ctx.moveTo(X(0), X(i)); ctx.lineTo(X(size - 1), X(i));
    ctx.moveTo(X(i), X(0)); ctx.lineTo(X(i), X(size - 1));
  }
  ctx.stroke();

  ctx.fillStyle = 'rgba(32,24,14,0.9)';
  for (const [sx, sy] of STARS[size] ?? []) {
    ctx.beginPath();
    ctx.arc(X(sx), X(sy), Math.max(3, step * 0.1), 0, Math.PI * 2);
    ctx.fill();
  }

  // The coordinates the assistant points with, small and in the margin.
  //
  // A wooden board has none of these. They are here because the assistant says
  // "H8", and a player who cannot find H8 without counting has to take its
  // word for everything it points at — which is the one thing this game is
  // trying not to ask of them.
  ctx.fillStyle = 'rgba(40,28,16,0.42)';
  ctx.font = `600 ${step * 0.34}px system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (let i = 0; i < size; i++) {
    ctx.fillText(letters[i], X(i), X(0) - step * 0.5);
    ctx.fillText(letters[i], X(i), X(size - 1) + step * 0.5);
    ctx.fillText(String(size - i), X(0) - step * 0.5, X(i));
    ctx.fillText(String(size - i), X(size - 1) + step * 0.5, X(i));
  }

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}
