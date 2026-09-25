/**
 * Synthetic bench for the glyph recogniser.
 *
 * Synthetic strokes are NOT a substitute for the lab's human corpus — a real
 * finger is sloppy in ways no generator guesses. What this catches is the other
 * failure: a feature that is simply wrong (corner counting that wraps badly, a
 * hump filter that never fires), which shows up as a whole class collapsing and
 * needs no humans to find. Run it on every recogniser change; read the lab for
 * whether players can actually play.
 *
 *   node tools/gesture-bench.mjs [path-to-bundled-recognize.mjs]
 */
const mod = process.argv[2] ?? '/tmp/recognize.mjs';
const { recognize, GLYPHS } = await import(mod);

// Deterministic, so a regression is a regression and not a bad roll.
let seed = 20260924;
const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
const rng = (a, b) => a + (b - a) * rnd();
const gauss = (s) => (rnd() + rnd() + rnd() + rnd() - 2) * s;

const P = (x, y, i) => ({ x, y, t: i * 8 });
const jitter = (pts, s) => pts.map((p, i) => P(p.x + gauss(s), p.y + gauss(s), i));
const smooth = (pts, w) => pts.map((p, i) => {
  let x = 0, y = 0, n = 0;
  for (let k = -w; k <= w; k++) { const q = pts[i + k]; if (q) { x += q.x; y += q.y; n++; } }
  return P(x / n, y / n, i);
});

function circle({ n, noise, sloppy }) {
  const R = rng(60, 140), cx = rng(150, 250), cy = rng(150, 250);
  const a0 = rng(0, 6.28), dir = rnd() < 0.5 ? 1 : -1;
  const gap = rng(-0.35, 0.55) * sloppy;           // over/under-shooting the join
  const wob = rng(0, 0.18) * sloppy, wf = Math.floor(rng(2, 4));
  const pts = [];
  for (let i = 0; i < n; i++) {
    const u = i / (n - 1), a = a0 + dir * (6.283 + gap) * u;
    const r = R * (1 + wob * Math.sin(a * wf));
    pts.push(P(cx + r * Math.cos(a), cy + r * Math.sin(a), i));
  }
  return [jitter(pts, noise)];
}

function chevron({ n, noise, sloppy }) {
  const L = rng(70, 150), ax = rng(150, 250), ay = rng(140, 220);
  // Interior angle 50deg-115deg. Wider than that and the apex deviates by less
  // than the corner threshold, which is the honest answer: a 150deg "chevron" is
  // a wobbly line and should be refused rather than guessed at.
  const half = rng(0.44, 1.0);
  const flip = rnd() < 0.5 ? 1 : -1;          // caret or V
  const rot = rng(-0.45, 0.45) * sloppy;      // drawn tilted
  const dir = rnd() < 0.5;                    // left leg first or right leg first
  const rotate = (x, y) => ({
    x: ax + x * Math.cos(rot) - y * Math.sin(rot),
    y: ay + x * Math.sin(rot) + y * Math.cos(rot),
  });
  const leg = (sign) => rotate(sign * L * Math.sin(half), flip * L * Math.cos(half));
  const a = leg(dir ? -1 : 1), b = leg(dir ? 1 : -1);
  const apex = rotate(0, 0);
  const pts = [];
  const per = Math.max(3, Math.floor(n / 2));
  for (let i = 0; i < per; i++) {
    const u = i / per;
    pts.push(P(a.x + (apex.x - a.x) * u, a.y + (apex.y - a.y) * u, pts.length));
  }
  for (let i = 0; i <= per; i++) {
    const u = i / per;
    pts.push(P(apex.x + (b.x - apex.x) * u, apex.y + (b.y - apex.y) * u, pts.length));
  }
  const w = Math.max(1, Math.min(3, Math.floor(pts.length / 6), Math.round(sloppy * 2)));
  return [jitter(smooth(pts, w), noise)];
}

function cross({ n, noise, sloppy }) {
  const R = rng(60, 130), cx = rng(150, 250), cy = rng(150, 250);
  const base = rng(-0.4, 0.4) + 0.785;
  const leg = (a, lenK, offx, offy) => {
    const pts = [];
    const m = Math.max(4, Math.floor(n / 2));
    for (let i = 0; i < m; i++) {
      const u = i / (m - 1) - 0.5;
      pts.push(P(cx + offx + Math.cos(a) * R * 2 * u * lenK,
                 cy + offy + Math.sin(a) * R * 2 * u * lenK, i));
    }
    return jitter(pts, noise);
  };
  const off = () => gauss(R * 0.14 * sloppy);
  const skew = () => rng(-0.26, 0.26) * sloppy;
  return [
    leg(base + skew(), rng(0.85, 1.0), off(), off()),
    leg(base + 1.571 + skew(), rng(0.8, 1.0), off(), off()),
  ];
}

function wave({ n, noise, sloppy }) {
  const W = rng(140, 260), A = rng(22, 55), cx = rng(120, 200), cy = rng(180, 260);
  const tilt = rng(-0.30, 0.30) * sloppy;
  const phase = rnd() < 0.5 ? 0 : Math.PI;
  const cycles = rnd() < 0.3 ? 1.5 : 1;            // some people draw three humps
  const pts = [];
  for (let i = 0; i < n; i++) {
    const u = i / (n - 1);
    const x = W * (u - 0.5), y = A * Math.sin(phase + 6.283 * cycles * u);
    pts.push(P(cx + x * Math.cos(tilt) - y * Math.sin(tilt),
               cy + x * Math.sin(tilt) + y * Math.cos(tilt), i));
  }
  return [jitter(pts, noise)];
}

const GEN = { circle, chevron, cross, wave };
const CASES = [
  { name: 'careful  (40 pts, low noise)', n: 40, noise: 1.2, sloppy: 0.5 },
  { name: 'normal   (28 pts, mid noise)', n: 28, noise: 2.6, sloppy: 1.0 },
  { name: 'fast     (12 pts, high noise)', n: 12, noise: 4.5, sloppy: 1.4 },
];
const PER = 250;

/**
 * The number that actually decides the game's feel: if the two live tiles are
 * THESE two glyphs, how often does a stroke aimed at one land on the other?
 * Narrowing to two candidates only helps when the two are separable — pairing a
 * circle against a triangle keeps the exact confusion the narrowing was supposed
 * to remove, and the board is what chooses the pairing.
 */
function pairTable(c) {
  console.log(`   2-candidate accuracy by pairing (row = drawn, col = the other live tile)`);
  for (const g of GLYPHS) {
    const cells = GLYPHS.filter((d) => d !== g).map((d) => {
      let ok = 0;
      for (let i = 0; i < 200; i++) if (recognize(GEN[g](c), { expect: [g, d] }).glyph === g) ok++;
      return `vs ${d} ${((ok / 200) * 100).toFixed(0)}%`;
    });
    console.log(`     ${g.padEnd(9)} ${cells.join('   ')}`);
  }
}

for (const c of CASES) {
  const m = {}, tot = {};
  for (const g of GLYPHS) { m[g] = {}; tot[g] = 0; }
  let hit = 0, rej = 0, wrong = 0, hitE = 0, rejE = 0, wrongE = 0;
  for (const g of GLYPHS) {
    for (let i = 0; i < PER; i++) {
      const strokes = GEN[g](c);
      const r = recognize(strokes, {});
      const got = r.glyph ?? 'reject';
      m[g][got] = (m[g][got] ?? 0) + 1;
      tot[g]++;
      if (r.glyph === g) hit++; else if (!r.glyph) rej++; else wrong++;
      // What the game runs: the target plus one decoy.
      const others = GLYPHS.filter((x) => x !== g);
      const e = recognize(strokes, { expect: [g, others[Math.floor(rnd() * 3)]] });
      if (e.glyph === g) hitE++; else if (!e.glyph) rejE++; else wrongE++;
    }
  }
  const N = PER * GLYPHS.length;
  const pc = (x) => `${((x / N) * 100).toFixed(1)}%`;
  console.log(`\n== ${c.name}`);
  console.log(`   strict   correct ${pc(hit)}  rejected ${pc(rej)}  WRONG ${pc(wrong)}`);
  console.log(`   2-cand   correct ${pc(hitE)}  rejected ${pc(rejE)}  WRONG ${pc(wrongE)}`);
  for (const g of GLYPHS) {
    const row = Object.entries(m[g]).sort((a, b) => b[1] - a[1])
      .map(([k, v]) => `${k} ${((v / tot[g]) * 100).toFixed(0)}%`).join('  ');
    console.log(`     ${g.padEnd(9)} ${row}`);
    // Mean features, so a bad class can be read as "the recogniser threw the
    // information away" vs "the information was never in the stroke".
    const fs = [];
    for (let i = 0; i < 60; i++) fs.push(recognize(GEN[g](c), {}).features);
    const avg = (k) => (fs.reduce((a, f) => a + f[k], 0) / fs.length).toFixed(2);
    console.log(`       ${['closure','turning','corners','bend','legStraightness','radialVar','humps','progress','aspect','straightness']
      .map((k) => `${k}=${avg(k)}`).join(' ')}`);
  }
  pairTable(c);
}
