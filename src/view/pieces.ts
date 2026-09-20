// The pieces, as geometry rather than as files.
//
// Five of the six are surfaces of revolution — that is not a simplification,
// it is what a chess set IS. A woodworker turns a pawn on a lathe from a
// drawn profile, and the profile is the whole design. Writing the profile
// down here and handing it to `LatheGeometry` gives a set with no assets to
// download, no glb to keep in step with the code, recolouring for free (the
// ghost piece, a highlighted piece, a theme) and no resolution to be wrong at.
//
// The knight is not a lathe and cannot be made into one. It is a side profile
// extruded and bevelled, which is a real chess-set style and not a
// compromise — minimalist sets have looked like that for a century. Its
// outline is a spline rather than a polyline, because a 22-sided horse reads
// as a mistake and a curved one reads as a choice.
//
// Everything is authored in units of ONE SQUARE: a piece at scale 1 stands on
// a square of side 1, with its base centred on the origin. The board multiplies
// by its own square size, which is the only place that number lives.
//
// Two things here are faked and it is worth knowing which. three has no CSG,
// so the bishop's slit is a thin darker wedge lying IN the surface rather than
// a cut through it, and the rook's crenellations are blocks standing ON the
// rim rather than notches taken out of it. At board scale both read correctly;
// from six inches away they do not.
import * as THREE from 'three';
import type { Kind } from '../chess/rules';

function lathe(path: THREE.Path, segments = 48, divisions = 12): THREE.BufferGeometry {
  return new THREE.LatheGeometry(path.getPoints(divisions), segments);
}

const start = (): THREE.Path => { const q = new THREE.Path(); q.moveTo(0, 0); return q; };

/** The flared foot every piece stands on. */
function foot(q: THREE.Path, r: number): THREE.Path {
  q.lineTo(r, 0);
  q.lineTo(r, 0.045);
  q.quadraticCurveTo(r, 0.085, r - 0.055, 0.105);
  q.quadraticCurveTo(r - 0.10, 0.125, r - 0.135, 0.165);
  return q;
}

/** The disc under a head: flares out, then tucks back in. */
function collar(q: THREE.Path, r: number, y: number, lip = 0.055): THREE.Path {
  q.lineTo(r, y);
  q.lineTo(r, y + lip);
  q.quadraticCurveTo(r - 0.03, y + lip + 0.02, r - 0.08, y + lip + 0.035);
  return q;
}

const PROFILES: Record<string, () => THREE.Path> = {
  pawn() {
    const q = foot(start(), 0.30);
    q.quadraticCurveTo(0.135, 0.22, 0.125, 0.34);
    q.lineTo(0.135, 0.42);
    collar(q, 0.205, 0.44, 0.045);
    q.quadraticCurveTo(0.125, 0.53, 0.135, 0.565);
    q.quadraticCurveTo(0.215, 0.60, 0.213, 0.695);
    q.quadraticCurveTo(0.208, 0.79, 0.105, 0.845);
    q.quadraticCurveTo(0.055, 0.868, 0, 0.872);
    return q;
  },
  rook() {
    const q = foot(start(), 0.345);
    q.quadraticCurveTo(0.185, 0.24, 0.185, 0.40);
    q.lineTo(0.205, 0.66);
    collar(q, 0.275, 0.70, 0.05);
    q.lineTo(0.25, 0.80);
    q.lineTo(0.25, 0.86);
    q.lineTo(0.175, 0.86);   // hollow, so the tower is not a solid plug
    q.lineTo(0.175, 0.80);
    q.lineTo(0, 0.80);
    return q;
  },
  bishop() {
    const q = foot(start(), 0.315);
    q.quadraticCurveTo(0.14, 0.26, 0.13, 0.42);
    q.lineTo(0.145, 0.52);
    collar(q, 0.235, 0.545, 0.05);
    q.quadraticCurveTo(0.125, 0.63, 0.185, 0.70);
    q.quadraticCurveTo(0.222, 0.76, 0.215, 0.88);
    q.quadraticCurveTo(0.205, 1.00, 0.105, 1.10);
    q.quadraticCurveTo(0.055, 1.145, 0.062, 1.175);
    q.quadraticCurveTo(0.098, 1.20, 0.075, 1.245);
    q.quadraticCurveTo(0.045, 1.272, 0, 1.275);
    return q;
  },
  queen() {
    const q = foot(start(), 0.355);
    q.quadraticCurveTo(0.155, 0.30, 0.145, 0.52);
    q.lineTo(0.16, 0.66);
    collar(q, 0.265, 0.69, 0.05);
    q.quadraticCurveTo(0.17, 0.80, 0.235, 0.88);
    q.lineTo(0.29, 1.02);
    q.lineTo(0.255, 1.06);
    q.lineTo(0.15, 1.05);
    q.quadraticCurveTo(0.085, 1.07, 0.09, 1.12);
    q.quadraticCurveTo(0.125, 1.16, 0.075, 1.205);
    q.quadraticCurveTo(0.03, 1.23, 0, 1.232);
    return q;
  },
  king() {
    const q = foot(start(), 0.365);
    q.quadraticCurveTo(0.16, 0.32, 0.15, 0.56);
    q.lineTo(0.165, 0.72);
    collar(q, 0.275, 0.75, 0.05);
    q.quadraticCurveTo(0.175, 0.86, 0.245, 0.95);
    q.lineTo(0.275, 1.08);
    q.lineTo(0.235, 1.13);
    q.lineTo(0.13, 1.12);
    q.quadraticCurveTo(0.075, 1.14, 0.08, 1.20);
    q.lineTo(0.075, 1.24);
    q.lineTo(0, 1.24);
    return q;
  },
  knightBase() {
    const q = foot(start(), 0.33);
    q.quadraticCurveTo(0.175, 0.24, 0.175, 0.30);
    collar(q, 0.235, 0.33, 0.045);
    q.lineTo(0.16, 0.42);
    q.lineTo(0, 0.42);
    return q;
  },
};

/** The horse, in profile. Traced once; nudge it here and nowhere else. */
const KNIGHT: Array<[number, number]> = [
  [-0.235, 0.000], [-0.255, 0.130], [-0.250, 0.300], [-0.215, 0.430],
  [-0.150, 0.535], [-0.120, 0.600],
  [-0.145, 0.660], [-0.075, 0.690],
  [-0.060, 0.635], [-0.010, 0.690],
  [0.045, 0.640], [0.115, 0.585],
  [0.195, 0.520], [0.255, 0.470],
  [0.300, 0.430], [0.305, 0.380],
  [0.245, 0.345], [0.170, 0.360],
  [0.105, 0.300], [0.070, 0.180],
  [0.085, 0.060], [0.120, 0.000],
];

function knightHead(): THREE.BufferGeometry {
  const s = new THREE.Shape();
  s.moveTo(KNIGHT[0][0], KNIGHT[0][1]);
  s.splineThru(KNIGHT.slice(1).map(([x, y]) => new THREE.Vector2(x, y)));
  s.closePath();
  const g = new THREE.ExtrudeGeometry(s, {
    depth: 0.26, bevelEnabled: true, bevelSize: 0.035, bevelThickness: 0.035,
    bevelSegments: 3, curveSegments: 10,
  });
  // Centred across its thickness, and lifted onto its own base. No rotation:
  // the silhouette must face the player, because it is the only angle a
  // knight reads from. Turned edge-on it is a slab.
  g.translate(0, 0.40, -0.13);
  return g;
}

/**
 * One geometry per piece, built once.
 *
 * Merged into a single BufferGeometry per kind rather than kept as a group,
 * because the board draws pieces with `InstancedMesh` — thirty-two pieces in
 * six draw calls instead of thirty-two — and an instance is one geometry.
 */
function build(kind: Kind): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const put = (g: THREE.BufferGeometry, fn?: (m: THREE.Matrix4) => void): void => {
    if (fn) { const m = new THREE.Matrix4(); fn(m); g.applyMatrix4(m); }
    parts.push(g);
  };

  if (kind === 'knight') {
    put(lathe(PROFILES.knightBase()));
    put(knightHead());
  } else {
    put(lathe(PROFILES[kind]()));
  }

  if (kind === 'rook') {
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2 + Math.PI / 12;
      put(new THREE.BoxGeometry(0.14, 0.135, 0.105), (m) => {
        m.makeRotationY(-a).setPosition(Math.cos(a) * 0.205, 0.925, Math.sin(a) * 0.205);
      });
    }
  }
  if (kind === 'queen') {
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * Math.PI * 2;
      put(new THREE.SphereGeometry(0.052, 12, 8), (m) => {
        m.makeTranslation(Math.cos(a) * 0.268, 1.075, Math.sin(a) * 0.268);
      });
    }
  }
  if (kind === 'king') {
    // The cross is the king; the coronet is the queen. Give the king a
    // coronet too and the two tallest pieces become one silhouette.
    put(new THREE.BoxGeometry(0.068, 0.26, 0.068), (m) => m.makeTranslation(0, 1.36, 0));
    put(new THREE.BoxGeometry(0.185, 0.068, 0.068), (m) => m.makeTranslation(0, 1.40, 0));
  }

  return mergeAll(parts);
}

/** The bishop's slit, as its own geometry — it is the one part drawn in a
 *  different colour, so it cannot be merged into the body. */
export function bishopSlit(): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(0.022, 0.34, 0.46);
  const m = new THREE.Matrix4().makeRotationX(-0.30).setPosition(0, 0.90, 0.005);
  g.applyMatrix4(m);
  return g;
}

/**
 * Concatenate geometries.
 *
 * three ships `BufferGeometryUtils.mergeGeometries` in its examples rather
 * than its core, and pulling an examples module in for forty lines of index
 * arithmetic is a dependency on a path that moves between releases. Only
 * position and normal are needed — none of these pieces is textured.
 */
function mergeAll(geos: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const out = new THREE.BufferGeometry();
  let vertexCount = 0;
  let indexCount = 0;
  for (const g of geos) {
    const pos = g.getAttribute('position');
    vertexCount += pos.count;
    indexCount += g.index ? g.index.count : pos.count;
  }
  const position = new Float32Array(vertexCount * 3);
  const normal = new Float32Array(vertexCount * 3);
  const index = new Uint32Array(indexCount);
  let vo = 0, io = 0;
  for (const g of geos) {
    if (!g.getAttribute('normal')) g.computeVertexNormals();
    const p = g.getAttribute('position');
    const n = g.getAttribute('normal');
    position.set(p.array as Float32Array, vo * 3);
    normal.set(n.array as Float32Array, vo * 3);
    if (g.index) {
      for (let i = 0; i < g.index.count; i++) index[io + i] = g.index.getX(i) + vo;
      io += g.index.count;
    } else {
      for (let i = 0; i < p.count; i++) index[io + i] = i + vo;
      io += p.count;
    }
    vo += p.count;
    g.dispose();
  }
  out.setAttribute('position', new THREE.BufferAttribute(position, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(normal, 3));
  out.setIndex(new THREE.BufferAttribute(index, 1));
  out.computeBoundingSphere();
  return out;
}

const CACHE = new Map<Kind, THREE.BufferGeometry>();

/** The geometry for a kind of piece. Built on first ask, then shared — every
 *  pawn on the board is the same buffer. */
export function pieceGeometry(kind: Kind): THREE.BufferGeometry {
  let g = CACHE.get(kind);
  if (!g) { g = build(kind); CACHE.set(kind, g); }
  return g;
}

/** How tall each kind stands, in squares. The board uses it to park the
 *  camera and to place a label above a piece. */
export const HEIGHT: Record<Kind, number> = {
  pawn: 0.87, rook: 0.99, knight: 1.09, bishop: 1.28, queen: 1.23, king: 1.49,
};
