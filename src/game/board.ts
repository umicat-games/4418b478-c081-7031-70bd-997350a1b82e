// What an Othello board looks like.
//
// Everything about the camera, the hit-testing and the marks is the shell's
// (`src/shell/boardrig.ts`); this file is the felt, the grid, the discs — and
// the one thing this game has that none of its siblings do: the flip.
//
// **A disc is one object with a black face and a white face.** That is what
// it is in the box, and modelling it that way makes the colour a ROTATION
// rather than a material: black is face up, white is face up the other way
// round. Which in turn makes the flip free — it is the rotation moving — and
// keeps all sixty-four discs in a single instanced mesh, because they differ
// only by their matrix.
//
// The pieces sit in the CENTRE of cells here rather than on intersections, so
// the grid lines are painted half a spacing off the positions the rig hands
// out. That is the whole difference, and it lives in the texture.
import * as THREE from 'three';
import { BoardRig, TOP_Y, type Point } from '../shell/boardrig';
import { BLACK, SIZE, type Othello, type Player } from './rules';
import { letters } from './coords';

/** How long a disc takes to turn over. Long enough to see, short enough that
 *  a flurry of them does not hold the game up. */
const FLIP_MS = 260;

interface Disc { player: Player; /** radians, 0 = black up, π = white up */ angle: number; target: number }

export class Board {
  private wood: THREE.Mesh | null = null;
  private discs: THREE.InstancedMesh | null = null;
  /** One entry per cell, or null. The angle is the animation. */
  private state: Array<Disc | null> = new Array(SIZE * SIZE).fill(null);
  private marker: THREE.Mesh;
  private ghost: THREE.Mesh;
  private flipping = false;
  private lastTick = 0;

  constructor(private rig: BoardRig) {
    // 0.5 would put the outer grid lines exactly on the board's edge, which
    // is where a real board has its border — and leaves nowhere for the
    // coordinates, which were being painted off the texture entirely.
    this.rig.setGrid({ cols: SIZE, rows: SIZE, margin: 0.9 });

    this.ghost = new THREE.Mesh(discGeometry(), ghostMaterials());
    this.ghost.visible = false;
    this.rig.scene.add(this.ghost);

    // Where the last disc went. A ring, not a dot: on a board where most of
    // the discs just changed colour, "which one did they play" is the first
    // question anybody has.
    this.marker = new THREE.Mesh(
      new THREE.TorusGeometry(0.44, 0.06, 8, 28),
      new THREE.MeshBasicMaterial({ color: 0xff5a4d }),
    );
    this.marker.rotation.x = -Math.PI / 2;
    this.marker.visible = false;
    this.rig.scene.add(this.marker);

    this.build();
  }

  private build(): void {
    const top = new THREE.MeshStandardMaterial({ map: feltTexture(this.rig), roughness: 0.92, metalness: 0 });
    const side = new THREE.MeshStandardMaterial({ map: edgeTexture(), roughness: 0.68, metalness: 0 });
    this.wood = new THREE.Mesh(
      new THREE.BoxGeometry(2 * this.rig.halfX, TOP_Y, 2 * this.rig.halfZ),
      [side, side, top, side, side, side],
    );
    this.wood.position.y = TOP_Y / 2;
    this.wood.castShadow = true;
    this.wood.receiveShadow = true;
    this.rig.scene.add(this.wood);

    const mesh = new THREE.InstancedMesh(discGeometry(), discMaterials(), SIZE * SIZE);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.count = 0;
    this.rig.scene.add(mesh);
    this.discs = mesh;

    this.ghost.scale.setScalar(this.rig.spacing);
    this.marker.scale.setScalar(this.rig.spacing);
  }

  /** Put the board on screen in the state the game is in, turning over
   *  whatever changed since last time. */
  sync(game: Othello): void {
    for (let i = 0; i < SIZE * SIZE; i++) {
      const cell = game.board[i];
      const was = this.state[i];
      if (!cell) { this.state[i] = null; continue; }
      const player: Player = (cell - 1) as Player;
      const target = player === BLACK ? 0 : Math.PI;
      if (!was) {
        // A disc that has just been placed does not flip: it arrives the way
        // it was played. Only discs that were already there turn over.
        this.state[i] = { player, angle: target, target };
      } else if (was.player !== player) {
        this.state[i] = { player, angle: was.angle, target };
        this.flipping = true;
      }
    }
    const last = game.last;
    this.marker.visible = last !== null;
    if (last !== null) {
      const p = this.rig.at(game.xOf(last), game.yOf(last));
      this.marker.position.set(p.x, TOP_Y + this.rig.spacing * 0.2, p.z);
    }
    this.lastTick = 0;
    this.draw();
  }

  /**
   * Advance the flip, if one is running. Returns whether anything moved, so
   * the loop knows to keep drawing a board that is otherwise a still life.
   */
  animate(): boolean {
    if (!this.flipping) return false;
    const now = performance.now();
    const dt = this.lastTick ? now - this.lastTick : 16;
    this.lastTick = now;
    const step = (Math.PI * dt) / FLIP_MS;
    let moving = false;
    for (const disc of this.state) {
      if (!disc || Math.abs(disc.angle - disc.target) < 1e-3) continue;
      const dir = Math.sign(disc.target - disc.angle);
      disc.angle += dir * step;
      if ((dir > 0 && disc.angle > disc.target) || (dir < 0 && disc.angle < disc.target)) disc.angle = disc.target;
      moving = true;
    }
    this.flipping = moving;
    if (moving) this.draw();
    return moving;
  }

  private draw(): void {
    if (!this.discs) return;
    this.rig.invalidate();
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const scale = new THREE.Vector3(this.rig.spacing, this.rig.spacing, this.rig.spacing);
    let n = 0;
    for (let i = 0; i < this.state.length; i++) {
      const disc = this.state[i];
      if (!disc) continue;
      const at = this.rig.at(i % SIZE, (i / SIZE) | 0);
      // Rotating about x, so a flip tips the disc over towards the player —
      // the way a hand does it.
      q.setFromAxisAngle(new THREE.Vector3(1, 0, 0), disc.angle);
      // Lifted by half its own thickness as it turns, so it pivots on its
      // rim rather than sinking through the board.
      const lift = Math.sin(disc.angle) * this.rig.spacing * 0.06;
      m.compose(new THREE.Vector3(at.x, at.y + Math.abs(lift), at.z), q, scale);
      this.discs.setMatrixAt(n++, m);
    }
    this.discs.count = n;
    this.discs.instanceMatrix.needsUpdate = true;
    this.discs.computeBoundingSphere();
  }

  /** The disc the player has aimed at but not committed to. */
  setGhost(at: Point | null, player: Player = BLACK): void {
    this.rig.invalidate();
    this.ghost.visible = !!at;
    if (!at) return;
    this.ghost.rotation.x = player === BLACK ? 0 : Math.PI;
    this.ghost.position.copy(this.rig.at(at.x, at.y));
  }
}

/** One disc: a flat cylinder. The faces are separate materials, which is what
 *  makes the colour a rotation. */
function discGeometry(): THREE.BufferGeometry {
  const g = new THREE.CylinderGeometry(0.42, 0.42, 0.1, 36);
  g.translate(0, 0.05, 0);
  return g;
}

/** Side, top, bottom — in that order, which is how a cylinder's groups are
 *  laid out. Black up, white down. */
function discMaterials(): THREE.Material[] {
  return [
    // The rim is the seam between the two faces — halfway between them, which
    // is also what it looks like in the box.
    new THREE.MeshStandardMaterial({ color: 0x9a9890, roughness: 0.55 }),
    new THREE.MeshStandardMaterial({ color: 0x14161a, roughness: 0.3 }),
    // Brighter than it looks it should be: this board is dark green felt lit
    // by a low lamp, and a "white" disc at 0xf3f0e7 came out grey against it.
    // Emissive as well as bright. The two faces of a disc are the whole game
    // — a "white" that reads as grey next to a black one is the board saying
    // something it does not mean. Measured off the render: 233 against 22.
    new THREE.MeshStandardMaterial({ color: 0xfdfbf5, roughness: 0.34, emissive: 0x2b2a26 }),
  ];
}

function ghostMaterials(): THREE.Material[] {
  return discMaterials().map((m) => {
    const c = (m as THREE.MeshStandardMaterial).clone();
    c.transparent = true;
    c.opacity = 0.55;
    return c;
  });
}

/** Green felt, its grid, the four dots and the coordinates. */
function feltTexture(rig: BoardRig): THREE.CanvasTexture {
  const px = 1024;
  const c = document.createElement('canvas');
  c.width = c.height = px;
  const ctx = c.getContext('2d')!;

  ctx.fillStyle = '#1d6b46';
  ctx.fillRect(0, 0, px, px);
  // Felt: fine noise rather than grain. A flat green rectangle reads as
  // plastic, and this board is most of the screen.
  for (let i = 0; i < 24000; i++) {
    const x = Math.random() * px, y = Math.random() * px;
    const shade = Math.random() < 0.5 ? 0 : 255;
    ctx.fillStyle = `rgba(${shade},${shade},${shade},0.035)`;
    ctx.fillRect(x, y, 2, 2);
  }

  const step = (rig.spacing / (2 * rig.halfX)) * px;
  const margin = (rig.margin / (2 * rig.halfX)) * px;
  // The rig hands out CELL CENTRES; the lines go half a cell either side.
  const line = (i: number): number => margin + (i - 0.5) * step;

  ctx.strokeStyle = 'rgba(8,28,18,0.85)';
  ctx.lineWidth = Math.max(1.6, px / 760);
  ctx.beginPath();
  for (let i = 0; i <= SIZE; i++) {
    ctx.moveTo(line(0), line(i)); ctx.lineTo(line(SIZE), line(i));
    ctx.moveTo(line(i), line(0)); ctx.lineTo(line(i), line(SIZE));
  }
  ctx.stroke();

  // The four dots, where a real board has them: the corners of the inner
  // square, at c3, f3, c6 and f6.
  ctx.fillStyle = 'rgba(8,28,18,0.9)';
  for (const [x, y] of [[2, 2], [6, 2], [2, 6], [6, 6]]) {
    ctx.beginPath();
    ctx.arc(line(x), line(y), Math.max(3, step * 0.07), 0, Math.PI * 2);
    ctx.fill();
  }

  // The coordinates the assistant points with, in the margin.
  ctx.fillStyle = 'rgba(232,242,236,0.62)';
  ctx.font = `600 ${step * 0.34}px system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (let i = 0; i < SIZE; i++) {
    const at = margin + i * step;
    ctx.fillText(letters[i], at, line(0) - step * 0.34);
    ctx.fillText(letters[i], at, line(SIZE) + step * 0.34);
    ctx.fillText(String(i + 1), line(0) - step * 0.34, at);
    ctx.fillText(String(i + 1), line(SIZE) + step * 0.34, at);
  }

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

/** The board's edge: dark wood around the felt. */
function edgeTexture(): THREE.CanvasTexture {
  const px = 256;
  const c = document.createElement('canvas');
  c.width = px;
  c.height = 64;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#4b3521';
  ctx.fillRect(0, 0, px, 64);
  for (let i = 0; i < 80; i++) {
    const y = Math.random() * 64;
    ctx.strokeStyle = `rgba(${40 + Math.random() * 40},${26 + Math.random() * 26},${12 + Math.random() * 16},${0.1 + Math.random() * 0.16})`;
    ctx.lineWidth = 0.5 + Math.random() * 1.6;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(px, y + (Math.random() - 0.5) * 6);
    ctx.stroke();
  }
  const shade = ctx.createLinearGradient(0, 0, 0, 64);
  shade.addColorStop(0, 'rgba(255,238,210,0.16)');
  shade.addColorStop(1, 'rgba(12,8,4,0.45)');
  ctx.fillStyle = shade;
  ctx.fillRect(0, 0, px, 64);

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}
