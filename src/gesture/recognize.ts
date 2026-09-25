/**
 * Gesture recognition for the four tile glyphs — circle, chevron, cross, wave.
 *
 * WHY NOT $1 / $P. The classic stroke recognizers (Wobbrock's $1, $P) match a
 * resampled path against templates and return the NEAREST one. Nearest-of-four
 * is the wrong answer shape for this game: a scribble, a tap, or a half-finished
 * shape would still come back as one of the four and delete a tile. Here a false
 * accept costs the player a move; a rejection costs them 300ms. So this is a
 * FEATURE classifier with an explicit reject, and every decision carries the
 * reason that produced it (`reason`) so a miss can be explained instead of
 * re-tuned by feel.
 *
 * The four glyphs differ TOPOLOGICALLY, not just in shape, and that is the whole
 * reason this works:
 *   circle  — one stroke, CLOSED, no corners
 *   chevron — one stroke, open, ONE sharp corner, two straight legs
 *   cross    — TWO straight strokes that intersect
 *   wave    — one stroke, open, SMOOTH, two or more alternating humps
 * No two of them share a row. The set started with a triangle instead of the
 * chevron and that was the one real accuracy problem in it: a triangle is a
 * closed loop with corners, a circle is a closed loop without, and a triangle
 * drawn fast is rounded enough that the distinction stops being measurable —
 * bench said 16% when the two were the only live candidates. A chevron is the
 * same gesture MINUS the closing stroke, which costs nothing to draw and moves
 * it into an empty row of the table.
 */

export type Glyph = 'circle' | 'chevron' | 'cross' | 'wave';
export const GLYPHS: Glyph[] = ['circle', 'chevron', 'cross', 'wave'];

export interface Pt { x: number; y: number; t: number }
export type Stroke = Pt[];

export interface Features {
  strokeCount: number;
  rawPoints: number;
  /** bbox diagonal, in the same px the strokes came in as. */
  size: number;
  /** bbox width / height of everything drawn. A wave is wide, a circle is ~1. */
  aspect: number;
  /** end-to-start gap / path length. ~0 closed, ~1 a straight line. */
  closure: number;
  /** total |turn| / 2π. A single loop is ~1 whichever shape it is. */
  turning: number;
  corners: number;
  cornerAngles: number[];
  /** The sharpest windowed turn found, in degrees. Diagnostic only — see `bend`. */
  cornerAngle: number;
  /**
   * Angle between the leading third of the stroke and the trailing third, in
   * degrees. This is how a chevron's apex is measured, and `cornerAngle` is not,
   * because the corner detector's window ATTENUATES a real corner: a perfectly
   * ordinary ∧ with a 115° interior angle bends by 65° and was being measured at
   * 49°, right on the detection threshold, so a fifth of them were rejected. Two
   * chords far either side of the bend give the true angle and do not care about
   * noise near the apex at all.
   */
  bend: number;
  /**
   * The straighter-is-higher measure of the two halves either side of that
   * corner, worst half. A chevron is two straight legs and a bent wave is not,
   * which is what keeps "one sharp bend" from eating "one gentle hump".
   */
  legStraightness: number;
  /** (p90-p10)/mean of the distance from the centroid. Circle ~0.2, triangle ~0.6. */
  radialVar: number;
  /** alternating significant extrema across the dominant axis. A tilde has 2. */
  humps: number;
  /**
   * net travel / total travel ALONG the dominant axis. A wave goes one way the
   * whole time (~1); anything that comes back round — circle, triangle — spends
   * half its length returning (~0.5). This is the feature that separates "open
   * and wiggly" from "closed but drawn too fast to close", and unlike total
   * turning it does not care how tall the humps are.
   */
  progress: number;
  /** angle of the dominant axis off horizontal, degrees, 0..90. */
  axisTilt: number;
  /** self/mutual intersections. An X has exactly one. */
  crossings: number;
  /** chord/path per stroke, worst stroke. A straight line is 1. */
  straightness: number;
  /** 2-stroke only: angle between the two strokes, folded to 0..90 degrees. */
  strokeAngle: number;
  /** 2-stroke only: shorter/longer stroke length. An X is ~1. */
  lengthRatio: number;
}

export interface Result {
  glyph: Glyph | null;
  confidence: number;
  scores: Record<Glyph, number>;
  features: Features;
  reason: string;
  /**
   * "This could be the first stroke of a cross — do not commit yet." The only
   * multi-stroke glyph is the cross, so this is the ONLY case where waiting for
   * a second stroke is worth the latency. Everything else commits on pen-up.
   */
  pending: boolean;
}

export interface RecognizeOptions {
  /**
   * The glyphs that would actually mean something right now — in this game, the
   * types of the bottom two tiles. Narrowing 4 classes to 1-2 is the cheapest
   * accuracy win available, so the argmax is taken within this set and the
   * accept thresholds relax. Omit to score all four (what the lab calls strict).
   */
  expect?: Glyph[];
  /** Below this bbox diagonal it is a tap or a twitch, not a glyph. */
  minSize?: number;
}

const N = 64;                 // resampled points per stroke
const CORNER_ANGLE = 48;      // degrees of turn that counts as a corner
const ACCEPT = 0.42;          // 4-class accept floor
const MARGIN = 0.10;          // best must beat second by this
const ACCEPT_EXPECTED = 0.28; // relaxed, because the candidate set is tiny
const MARGIN_EXPECTED = 0.06;

const DEG = 180 / Math.PI;
const ramp = (x: number, lo: number, hi: number) =>
  hi === lo ? (x >= hi ? 1 : 0) : Math.min(1, Math.max(0, (x - lo) / (hi - lo)));
const fall = (x: number, lo: number, hi: number) => 1 - ramp(x, lo, hi);

const dist = (a: Pt, b: Pt) => Math.hypot(b.x - a.x, b.y - a.y);

function pathLength(s: Stroke): number {
  let L = 0;
  for (let i = 1; i < s.length; i++) L += dist(s[i - 1], s[i]);
  return L;
}

/** Equidistant along arc length. Every feature below assumes this, because a
 *  fast flick and a slow careful drag otherwise produce different point
 *  densities and the same shape reads as two different ones. */
function resample(s: Stroke, n: number): Pt[] {
  const L = pathLength(s);
  if (s.length < 2 || L === 0) return s.slice();
  const step = L / (n - 1);
  const out: Pt[] = [s[0]];
  let cur = s[0];
  let acc = 0;
  let i = 1;
  while (i < s.length) {
    const seg = dist(cur, s[i]);
    if (acc + seg >= step && seg > 0) {
      const t = (step - acc) / seg;
      const np: Pt = {
        x: cur.x + t * (s[i].x - cur.x),
        y: cur.y + t * (s[i].y - cur.y),
        t: cur.t + t * (s[i].t - cur.t),
      };
      out.push(np);
      cur = np;
      acc = 0;
    } else {
      acc += seg;
      cur = s[i];
      i++;
    }
  }
  const last = s[s.length - 1];
  while (out.length < n) out.push({ ...last });
  return out.slice(0, n);
}

/**
 * Centripetal Catmull-Rom through the raw points, used only when the stroke is
 * sparse.
 *
 * This is not cosmetic. Resampling 12 raw points up to 64 with straight lines
 * makes a POLYGON, and a polygon has a corner at every original sample — so a
 * circle flicked in 150ms arrived with three detected corners and came back as a
 * triangle 12% of the time. The curve interpolates through the samples instead of
 * between them, which removes the artefact without rounding off the corners that
 * are really there (centripetal parameterisation is the variant that will not
 * loop or cusp on unevenly spaced input, which finger data always is).
 */
function densify(s: Stroke, per = 5): Pt[] {
  if (s.length < 3) return s.slice();
  const at = (i: number) => s[Math.max(0, Math.min(s.length - 1, i))];
  const out: Pt[] = [];
  for (let i = 0; i < s.length - 1; i++) {
    const p0 = at(i - 1), p1 = at(i), p2 = at(i + 1), p3 = at(i + 2);
    const knot = (a: Pt, b: Pt) => Math.sqrt(Math.hypot(b.x - a.x, b.y - a.y)) || 1e-6;
    const t0 = 0, t1 = t0 + knot(p0, p1), t2 = t1 + knot(p1, p2), t3 = t2 + knot(p2, p3);
    const mix = (a: Pt, b: Pt, ta: number, tb: number, t: number): Pt => {
      const w = (t - ta) / (tb - ta || 1e-6);
      return { x: a.x + (b.x - a.x) * w, y: a.y + (b.y - a.y) * w, t: a.t + (b.t - a.t) * w };
    };
    for (let k = 0; k < per; k++) {
      const t = t1 + (t2 - t1) * (k / per);
      const a1 = mix(p0, p1, t0, t1, t), a2 = mix(p1, p2, t1, t2, t), a3 = mix(p2, p3, t2, t3, t);
      const b1 = mix(a1, a2, t0, t2, t), b2 = mix(a2, a3, t1, t3, t);
      out.push(mix(b1, b2, t1, t2, t));
    }
  }
  out.push(s[s.length - 1]);
  return out;
}

/** A finger is noisy at the scale corner detection cares about. */
function smooth(pts: Pt[], w = 2): Pt[] {
  if (pts.length < 2 * w + 1) return pts.slice();
  return pts.map((p, i) => {
    if (i < w || i >= pts.length - w) return { ...p };
    let x = 0, y = 0;
    for (let k = -w; k <= w; k++) { x += pts[i + k].x; y += pts[i + k].y; }
    const n = 2 * w + 1;
    return { x: x / n, y: y / n, t: p.t };
  });
}

function bbox(pts: Pt[]) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of pts) {
    if (p.x < x0) x0 = p.x; if (p.x > x1) x1 = p.x;
    if (p.y < y0) y0 = p.y; if (p.y > y1) y1 = p.y;
  }
  return { x0, y0, x1, y1, w: x1 - x0, h: y1 - y0 };
}

function angleBetween(ax: number, ay: number, bx: number, by: number): number {
  const dot = ax * bx + ay * by;
  const crs = ax * by - ay * bx;
  return Math.abs(Math.atan2(crs, dot));
}

/** Corners as local maxima of turn-over-a-window. A window, not a per-point
 *  derivative: a single-point angle is dominated by sampling noise, and a
 *  hand-drawn corner is rounded over several points anyway. */
function findCorners(pts: Pt[], cyclic: boolean): { count: number; angles: number[]; indices: number[]; peak: number } {
  const n = pts.length;
  const k = Math.max(2, Math.round(n / 14));
  const turn = new Array<number>(n).fill(0);
  for (let i = 0; i < n; i++) {
    let a: number, b: number;
    if (cyclic) { a = (i - k + n) % n; b = (i + k) % n; }
    else { if (i < k || i >= n - k) continue; a = i - k; b = i + k; }
    const ax = pts[i].x - pts[a].x, ay = pts[i].y - pts[a].y;
    const bx = pts[b].x - pts[i].x, by = pts[b].y - pts[i].y;
    if ((ax === 0 && ay === 0) || (bx === 0 && by === 0)) continue;
    turn[i] = angleBetween(ax, ay, bx, by) * DEG;
  }
  // Non-maximum suppression, or one rounded corner reads as four.
  const span = Math.round(k * 1.6);
  const angles: number[] = [];
  const indices: number[] = [];
  for (let i = 0; i < n; i++) {
    if (turn[i] < CORNER_ANGLE) continue;
    let best = true;
    for (let j = i - span; j <= i + span; j++) {
      const idx = cyclic ? (j + n * 2) % n : j;
      if (idx < 0 || idx >= n || idx === i) continue;
      if (turn[idx] > turn[i]) { best = false; break; }
    }
    if (best) { angles.push(turn[i]); indices.push(i); }
  }
  let peak = 0;
  for (let i = 0; i < n; i++) if (turn[i] > turn[peak]) peak = i;
  return { count: angles.length, angles, indices, peak };
}

/** chord/path of each half either side of `at`, worst half. A corner too close
 *  to an end is not a bend in the stroke, it is a hook on the end of one, so it
 *  scores 0 rather than reporting a leg three points long as perfectly straight. */
function legs(pts: Pt[], at: number): number {
  const n = pts.length;
  if (at < n * 0.2 || at > n * 0.8) return 0;
  const a = pts.slice(0, at + 1), b = pts.slice(at);
  const q = (seg: Pt[]) => (seg.length > 1 ? dist(seg[0], seg[seg.length - 1]) / (pathLength(seg) || 1) : 0);
  return Math.min(q(a), q(b));
}

/** Dominant axis by PCA. The bbox major axis lies about a tilted wave. */
function dominantAxis(pts: Pt[]): { ux: number; uy: number } {
  let mx = 0, my = 0;
  for (const p of pts) { mx += p.x; my += p.y; }
  mx /= pts.length; my /= pts.length;
  let sxx = 0, syy = 0, sxy = 0;
  for (const p of pts) {
    const dx = p.x - mx, dy = p.y - my;
    sxx += dx * dx; syy += dy * dy; sxy += dx * dy;
  }
  const theta = 0.5 * Math.atan2(2 * sxy, sxx - syy);
  return { ux: Math.cos(theta), uy: Math.sin(theta) };
}

/** Alternating extrema of the across-axis offset, with an amplitude floor so a
 *  wobble in a straight line is not a wave. */
function countHumps(v: number[], minAmp: number): number {
  if (v.length < 5) return 0;
  let count = 0;
  let dir = 0;
  let ref = v[0];
  for (let i = 1; i < v.length; i++) {
    const d = Math.sign(v[i] - v[i - 1]);
    if (d === 0) continue;
    if (dir !== 0 && d !== dir && Math.abs(v[i - 1] - ref) > minAmp) {
      count++;
      ref = v[i - 1];
    }
    dir = d;
  }
  return count;
}

function segmentsCross(a: Pt, b: Pt, c: Pt, d: Pt): boolean {
  const s = (p: Pt, q: Pt, r: Pt) =>
    Math.sign((q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x));
  const d1 = s(a, b, c), d2 = s(a, b, d), d3 = s(c, d, a), d4 = s(c, d, b);
  return d1 !== d2 && d3 !== d4;
}

function countCrossings(strokes: Pt[][]): number {
  let n = 0;
  const segs: [Pt, Pt, number][] = [];
  strokes.forEach((s, si) => {
    for (let i = 1; i < s.length; i++) segs.push([s[i - 1], s[i], si]);
  });
  for (let i = 0; i < segs.length; i++) {
    for (let j = i + 2; j < segs.length; j++) {
      // Adjacent segments of the same stroke always "touch"; skip them.
      if (segs[i][2] === segs[j][2] && j - i < 3) continue;
      if (segmentsCross(segs[i][0], segs[i][1], segs[j][0], segs[j][1])) n++;
    }
  }
  return n;
}

export function extract(strokes: Stroke[]): Features {
  const raw = strokes.reduce((a, s) => a + s.length, 0);
  // Sparse strokes go through the curve first; dense ones do not need it and
  // would only pay for it.
  const rs = strokes.map((s) => smooth(resample(s.length < 24 ? densify(s) : s, N)));
  const all = rs.flat();
  const bb = bbox(all);
  const size = Math.hypot(bb.w, bb.h) || 1;

  const first = rs[0] ?? [];
  const flatLen = rs.reduce((a, s) => a + pathLength(s), 0) || 1;
  const closure = first.length > 1
    ? dist(first[0], first[first.length - 1]) / (pathLength(first) || 1)
    : 1;
  const closed = strokes.length === 1 && closure < 0.30;

  // A closed shape is measured cyclically, so a triangle started ON a vertex
  // still shows three corners instead of two-and-a-half.
  const closing = closed ? [...strokes[0], strokes[0][0]] : [];
  const loop = closed
    ? smooth(resample(closing.length < 24 ? densify(closing) : closing, N))
    : first;
  const { count: corners, angles: cornerAngles, indices: cornerAt, peak } = findCorners(loop, closed);
  let cornerAngle = 0;
  cornerAngles.forEach((a) => { if (a > cornerAngle) cornerAngle = a; });

  // Where the stroke bends most, WITHOUT asking whether it bends enough to be a
  // corner. Gating the split on the corner threshold meant a chevron too wide to
  // register a corner also reported perfectly-unstraight legs, so two terms
  // failed together on one measurement — the same mistake as multiplying corner
  // count by radius swing, in a different place.
  const legStraightness = closed ? 0 : legs(loop, peak);

  const third = Math.max(2, Math.round(first.length * 0.35));
  let bend = 0;
  if (first.length > 2 * third) {
    const ax = first[third].x - first[0].x, ay = first[third].y - first[0].y;
    const n1 = first.length - 1;
    const bx = first[n1].x - first[n1 - third].x, by = first[n1].y - first[n1 - third].y;
    if ((ax || ay) && (bx || by)) bend = angleBetween(ax, ay, bx, by) * DEG;
  }

  let turning = 0;
  for (const s of rs) {
    for (let i = 2; i < s.length; i++) {
      const ax = s[i - 1].x - s[i - 2].x, ay = s[i - 1].y - s[i - 2].y;
      const bx = s[i].x - s[i - 1].x, by = s[i].y - s[i - 1].y;
      if ((ax || ay) && (bx || by)) turning += angleBetween(ax, ay, bx, by);
    }
  }
  turning /= Math.PI * 2;

  let cx = 0, cy = 0;
  for (const p of all) { cx += p.x; cy += p.y; }
  cx /= all.length; cy /= all.length;
  const radii = all.map((p) => Math.hypot(p.x - cx, p.y - cy)).sort((a, b) => a - b);
  const pick = (q: number) => radii[Math.min(radii.length - 1, Math.floor(q * radii.length))];
  const rMean = radii.reduce((a, b) => a + b, 0) / radii.length || 1;
  const radialVar = (pick(0.9) - pick(0.1)) / rMean;

  const { ux, uy } = dominantAxis(all);
  const across = first.map((p) => (p.x - cx) * -uy + (p.y - cy) * ux);
  const humps = countHumps(across, size * 0.07);
  const along = first.map((p) => (p.x - cx) * ux + (p.y - cy) * uy);
  let travel = 0;
  for (let i = 1; i < along.length; i++) travel += Math.abs(along[i] - along[i - 1]);
  const progress = travel > 0 ? Math.abs(along[along.length - 1] - along[0]) / travel : 0;
  const tilt = Math.abs(Math.atan2(uy, ux) * DEG) % 180;
  const axisTilt = tilt > 90 ? 180 - tilt : tilt;

  const straightness = Math.min(
    ...rs.map((s) => (s.length > 1 ? dist(s[0], s[s.length - 1]) / (pathLength(s) || 1) : 0)),
  );

  let strokeAngle = 0, lengthRatio = 0;
  if (rs.length === 2) {
    const [a, b] = rs;
    const av = { x: a[a.length - 1].x - a[0].x, y: a[a.length - 1].y - a[0].y };
    const bv = { x: b[b.length - 1].x - b[0].x, y: b[b.length - 1].y - b[0].y };
    const ang = angleBetween(av.x, av.y, bv.x, bv.y) * DEG;
    strokeAngle = ang > 90 ? 180 - ang : ang;
    const la = pathLength(a), lb = pathLength(b);
    lengthRatio = Math.min(la, lb) / (Math.max(la, lb) || 1);
  }

  return {
    strokeCount: strokes.length,
    rawPoints: raw,
    size,
    aspect: bb.h > 0 ? bb.w / bb.h : 99,
    closure,
    turning,
    corners,
    cornerAngles: cornerAngles.map((a) => Math.round(a)),
    cornerAngle: Math.round(cornerAngle),
    bend: Math.round(bend),
    legStraightness,
    radialVar,
    humps,
    progress,
    axisTilt,
    crossings: countCrossings(rs),
    straightness,
    strokeAngle,
    lengthRatio,
  };
}

function score(f: Features): Record<Glyph, number> {
  const s: Record<Glyph, number> = { circle: 0, chevron: 0, cross: 0, wave: 0 };
  const one = f.strokeCount === 1;

  if (one) {
    const closedS = fall(f.closure, 0.16, 0.40);
    const turnS = fall(Math.abs(f.turning - 1), 0.22, 0.60);

    // Corner COUNT and radius SWING measure the same thing two ways, so they are
    // added, not multiplied: a gate that can only be satisfied one way fails
    // whenever that one way is the noisy one. Closure and turning DO multiply —
    // those are independent conditions that all have to hold.
    const cornerlessS = f.corners === 0 ? 1 : f.corners === 1 ? 0.8 : f.corners === 2 ? 0.35 : 0.1;

    s.circle = closedS * turnS
      * (0.45 * cornerlessS + 0.55 * fall(f.radialVar, 0.30, 0.55));

    // One bend, sharp, with a straight leg either side of it. No orientation
    // term on purpose: nothing else in the set occupies "open with exactly one
    // sharp corner", so a chevron drawn tilted, upside down (∨) or on its side
    // (<) is still unambiguous, and refusing those would only invent a failure.
    s.chevron = ramp(f.closure, 0.38, 0.62)
      // Bent, but not folded in half. The lower bound is what a ∧ is; the upper
      // one is what it is not — a stroke that comes back on itself at 170° is a
      // hairpin or a circle that failed to close, and both of those have two
      // fairly straight halves meeting at a sharp angle, which is otherwise
      // exactly the chevron description.
      * ramp(f.bend, 36, 58) * fall(f.bend, 140, 168)
      // Loose, because `bend` now carries the separation. It was 0.78-0.93 and
      // that threw out 30% of fast chevrons: a finger bows its legs, and a bowed
      // leg drawn in twelve samples measures 0.68 straight.
      * ramp(f.legStraightness, 0.62, 0.85)
      // A chevron is ONE bend, not a run of them — but this used to be the ONLY
      // thing keeping a chevron from scoring as a wave, and `humps` is one
      // noisy integer: a ∧ with slightly unequal legs registers two excursions
      // across its own axis and lost 85% of its score for it. Now that `bend`
      // separates the two classes properly, this can go back to being a hint.
      * (f.humps <= 1 ? 1 : 0.5)
      // More than two detected corners means a zigzag, not a chevron. One or
      // none is fine — the bend is already measured, this only rules out extra
      // bends the other terms cannot see.
      * (f.corners <= 1 ? 1 : f.corners === 2 ? 0.5 : 0.1);

    s.wave = ramp(f.closure, 0.32, 0.58)
      * (f.humps >= 3 ? 1 : f.humps === 2 ? 0.95 : 0.10)
      * ramp(f.aspect, 1.10, 1.75)
      * fall(f.axisTilt, 25, 50)
      // A wave never comes back on itself. Total turning was tried here first
      // and cost a quarter of all waves: a tall three-humped tilde turns through
      // more than a full circle's worth of angle, so "turning < 1" throws out
      // exactly the waves people draw most emphatically. Net-over-total travel
      // along the axis says the same thing about shape without saying anything
      // about amplitude.
      * ramp(f.progress, 0.62, 0.84)
      // A wave is SMOOTH; a chevron turns a corner. This gate was here once as
      // `cornerAngle` — the windowed corner measure — and it cost a quarter of
      // all waves, so it came out. That was the right removal of the wrong
      // thing: `bend` measures the same idea from two chords far either side of
      // the middle, and on the bench a wave bends 2-6° where a chevron bends
      // 96-99°. Taking it out left the two classes separated only by a noisy
      // integer (`humps`), which is exactly how a ∧ ends up scoring as a ~.
      * fall(f.bend, 34, 62);

    // One-stroke X: the player never lifted, so the path crosses itself and
    // still has two long straight legs. It must be OPEN — this term was `fall`
    // (which scores 1 for a CLOSED shape), and that one inverted comparison sent
    // up to 15% of circles back as crosses, because a circle that overshoots its
    // own start crosses itself exactly once. Capped, so it only wins when clear.
    s.cross = 0.75 * (f.crossings >= 1 ? 1 : 0)
      * ramp(f.closure, 0.50, 0.85)
      * ramp(f.corners, 0, 2)
      * fall(Math.abs(f.aspect - 1), 0.35, 0.9);
  } else if (f.strokeCount === 2) {
    s.cross = ramp(f.straightness, 0.78, 0.92)
      * ramp(f.strokeAngle, 22, 45)
      * ramp(f.lengthRatio, 0.35, 0.65)
      * (f.crossings >= 1 ? 1 : 0.30);
  }
  return s;
}

export function recognize(strokes: Stroke[], opts: RecognizeOptions = {}): Result {
  const minSize = opts.minSize ?? 40;
  const usable = strokes.filter((s) => s.length >= 2);
  const blank: Features = extract(usable.length ? usable : [[{ x: 0, y: 0, t: 0 }, { x: 0, y: 0, t: 0 }]]);

  if (!usable.length) {
    return { glyph: null, confidence: 0, scores: { circle: 0, chevron: 0, cross: 0, wave: 0 }, features: blank, reason: 'nothing drawn', pending: false };
  }

  const f = extract(usable);
  const scores = score(f);

  if (f.size < minSize) {
    return { glyph: null, confidence: 0, scores, features: f, reason: `too small (${Math.round(f.size)}px < ${minSize})`, pending: false };
  }
  if (f.strokeCount > 2) {
    return { glyph: null, confidence: 0, scores, features: f, reason: `${f.strokeCount} strokes — no glyph has more than 2`, pending: false };
  }

  // A lone straight stroke is either half of a cross or nothing at all. It is
  // the one input worth holding, and holding it is why every OTHER glyph can
  // commit the instant the finger leaves the glass.
  const pending = f.strokeCount === 1 && f.straightness > 0.88 && f.crossings === 0;

  // Strict first, relaxed second, and that order is the whole trick.
  //
  // A stroke that is unmistakably a circle is reported as a circle even when no
  // circle is live — the player gets told what they drew, and the game can
  // answer with a miss. Only when the four-class decision is genuinely unsure
  // does the board's expectation get to break the tie, which is where narrowing
  // to the live tiles belongs: as the benefit of the doubt, not as a filter that
  // relabels clear input.
  const strict = pick(scores, GLYPHS, ACCEPT, MARGIN);
  if (strict.glyph) {
    return { glyph: strict.glyph, confidence: strict.score, scores, features: f, reason: explain(strict.glyph, f), pending: false };
  }

  // Deduplicated, because the two live tiles are frequently the SAME glyph and a
  // duplicated candidate made the margin check compare a glyph against itself:
  // best minus second was exactly 0, every margin failed, and the game stopped
  // accepting any gesture at all whenever the bottom pair matched. Nothing
  // errored; it just went dead, which is the worst way for a rule to be wrong.
  const pool = opts.expect ? [...new Set(opts.expect)] : [];
  // Only when the board has genuinely narrowed the field. A pool holding all
  // four glyphs carries no prior, so running the relaxed pass over it would not
  // be "the benefit of the doubt" — it would just be a lower bar, trading
  // rejections (which cost the player a moment) for wrong glyphs (which clear a
  // tile they did not choose).
  if (pool.length && pool.length < GLYPHS.length) {
    const relaxed = pick(scores, pool, ACCEPT_EXPECTED, pool.length > 1 ? MARGIN_EXPECTED : 0);
    if (relaxed.glyph) {
      return { glyph: relaxed.glyph, confidence: relaxed.score, scores, features: f, reason: explain(relaxed.glyph, f), pending: false };
    }
    return { glyph: null, confidence: relaxed.score, scores, features: f, reason: relaxed.reason, pending };
  }
  return { glyph: null, confidence: strict.score, scores, features: f, reason: strict.reason, pending };
}

/** Argmax within `pool`, subject to an accept floor and a margin over the
 *  runner-up. A single-candidate pool has no runner-up, so pass margin 0. */
function pick(scores: Record<Glyph, number>, pool: Glyph[], accept: number, margin: number) {
  const ranked = [...pool].sort((a, b) => scores[b] - scores[a]);
  const best = ranked[0];
  const second = ranked[1];
  const score = scores[best] ?? 0;
  const runnerUp = second ? scores[second] : 0;
  if (score < accept) {
    return { glyph: null, score, reason: `best ${best}=${score.toFixed(2)} under ${accept}` };
  }
  if (score - runnerUp < margin) {
    return { glyph: null, score, reason: `${best} ${score.toFixed(2)} vs ${second} ${runnerUp.toFixed(2)} — too close` };
  }
  return { glyph: best as Glyph, score, reason: '' };
}

function explain(g: Glyph, f: Features): string {
  switch (g) {
    case 'circle': return `closed (gap ${f.closure.toFixed(2)}), ${f.corners} corners, even radius (${f.radialVar.toFixed(2)})`;
    case 'chevron': return `open (gap ${f.closure.toFixed(2)}), bends ${f.bend}°, legs ${f.legStraightness.toFixed(2)} straight`;
    case 'cross': return f.strokeCount === 2
      ? `2 straight strokes (${f.straightness.toFixed(2)}) crossing at ${Math.round(f.strokeAngle)}°`
      : `one stroke crossing itself ${f.crossings}×`;
    case 'wave': return `open (gap ${f.closure.toFixed(2)}), ${f.humps} humps, ${f.aspect.toFixed(2)}:1 wide, ${Math.round(f.axisTilt)}° off flat`;
  }
}
