/**
 * The gesture lab. Not part of the game — the instrument the game's recognition
 * gets tuned with, at `/lab.html`.
 *
 * It exists because "识别度够不够" cannot be answered by drawing a few shapes and
 * liking the result. Tuning by feel on a recogniser means every change trades an
 * unmeasured win for an unmeasured loss. So: draw against a prompt, every sample
 * is kept, and Re-run replays the whole stored corpus through the CURRENT
 * recogniser and prints a confusion matrix. That makes a threshold change a
 * before/after number instead of an opinion.
 *
 * Two accuracies are reported side by side, because the game gets a second
 * chance the recogniser does not know about: only the bottom two tiles are
 * live, so at most two glyphs mean anything. `strict` scores all four classes,
 * `expected` scores against the target plus one decoy — what the game will
 * actually run.
 */
import { GestureCapture } from './capture';
import { recognize, GLYPHS, type Glyph, type Result, type Stroke } from './recognize';

interface Sample { target: Glyph; strokes: Stroke[]; ms: number }

const STORE = 'gesture-lab-samples';
const ink = document.getElementById('ink') as HTMLCanvasElement;
const pad = document.getElementById('pad') as HTMLDivElement;
const promptEl = document.getElementById('prompt')!;
const verdictEl = document.getElementById('verdict')!;
const bottom = document.getElementById('bottom')!;
const ctx = ink.getContext('2d')!;

let mode: 'drill' | 'free' = 'drill';
let target: Glyph = pickTarget();
let samples: Sample[] = load();
let last: { r: Result; expected: Result | null } | null = null;
let startedAt = 0;

function load(): Sample[] {
  try { return JSON.parse(localStorage.getItem(STORE) ?? '[]') as Sample[]; } catch { return []; }
}
function save(): void {
  // Round the coordinates: a corpus of raw floats is four times the size for
  // sub-pixel detail no feature here can see, and localStorage has a ceiling.
  const lean = samples.map((s) => ({
    target: s.target, ms: Math.round(s.ms),
    strokes: s.strokes.map((st) => st.map((p) => ({ x: Math.round(p.x), y: Math.round(p.y), t: Math.round(p.t) }))),
  }));
  try { localStorage.setItem(STORE, JSON.stringify(lean)); } catch { /* full — the corpus in memory is still valid */ }
}

function pickTarget(): Glyph {
  return GLYPHS[Math.floor(Math.random() * GLYPHS.length)];
}
/** One decoy, so `expected` measures a 2-candidate decision like the game's. */
function decoyFor(g: Glyph): Glyph[] {
  const others = GLYPHS.filter((x) => x !== g);
  return [g, others[Math.floor(Math.random() * others.length)]];
}

function resize(): void {
  const dpr = Math.min(window.devicePixelRatio, 2);
  ink.width = Math.round(innerWidth * dpr);
  ink.height = Math.round(innerHeight * dpr);
  ink.style.width = `${innerWidth}px`;
  ink.style.height = `${innerHeight}px`;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}
addEventListener('resize', resize);
resize();

function drawTrail(strokes: Stroke[]): void {
  ctx.clearRect(0, 0, innerWidth, innerHeight);
  ctx.lineWidth = 7;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = '#7dd3fc';
  for (const s of strokes) {
    if (s.length < 2) continue;
    ctx.beginPath();
    ctx.moveTo(s[0].x, s[0].y);
    for (const p of s.slice(1)) ctx.lineTo(p.x, p.y);
    ctx.stroke();
  }
}

const ICONS: Record<Glyph, string> = {
  circle: '<circle cx="17" cy="17" r="12" fill="none" stroke="currentColor" stroke-width="3"/>',
  triangle: '<path d="M17 5 L30 29 L4 29 Z" fill="none" stroke="currentColor" stroke-width="3"/>',
  cross: '<path d="M6 6 L28 28 M28 6 L6 28" fill="none" stroke="currentColor" stroke-width="3"/>',
  wave: '<path d="M3 17 q7 -11 14 0 q7 11 14 0" fill="none" stroke="currentColor" stroke-width="3"/>',
};

function renderPrompt(): void {
  promptEl.innerHTML = mode === 'drill'
    ? `<span class="dim">draw</span><svg viewBox="0 0 34 34">${ICONS[target]}</svg><b>${target}</b>`
    : '<span class="dim">free draw</span>';
}

function matrix(rows: Sample[], useExpect: boolean) {
  const m: Record<string, Record<string, number>> = {};
  for (const g of GLYPHS) { m[g] = { circle: 0, triangle: 0, cross: 0, wave: 0, reject: 0 }; }
  let hit = 0, reject = 0;
  for (const s of rows) {
    const r = recognize(s.strokes, useExpect ? { expect: decoyFor(s.target) } : {});
    const got = r.glyph ?? 'reject';
    m[s.target][got]++;
    if (r.glyph === s.target) hit++;
    else if (!r.glyph) reject++;
  }
  return { m, hit, reject, n: rows.length };
}

function table(title: string, res: ReturnType<typeof matrix>): string {
  const pct = (a: number) => `${((a / (res.n || 1)) * 100).toFixed(1)}%`;
  const head = ['', ...GLYPHS, 'reject'].map((h) => `<th>${h}</th>`).join('');
  const body = GLYPHS.map((g) => {
    const n = GLYPHS.reduce((a, c) => a + res.m[g][c], 0) + res.m[g].reject;
    const cells = [...GLYPHS, 'reject'].map((c) => {
      const v = res.m[g][c];
      const cls = v === 0 ? '' : c === g ? 'hit' : c === 'reject' ? '' : 'miss';
      return `<td class="${cls}">${v || ''}</td>`;
    }).join('');
    return `<tr><th>${g} <span class="dim">(${n})</span></th>${cells}</tr>`;
  }).join('');
  return `<h4>${title} — correct ${pct(res.hit)}, rejected ${pct(res.reject)}, wrong ${pct(res.n - res.hit - res.reject)} of ${res.n}</h4>
    <table><tr>${head}</tr>${body}</table>`;
}

function render(): void {
  const parts: string[] = [];
  if (last) {
    const { r, expected } = last;
    const f = r.features;
    parts.push(`<div class="row"><b>${r.glyph ?? '—'}</b> <span class="dim">conf</span> ${r.confidence.toFixed(2)}
      <span class="dim">·</span> ${r.reason}
      ${expected ? `<span class="dim">· with 2 candidates:</span> <b>${expected.glyph ?? '—'}</b> ${expected.confidence.toFixed(2)}` : ''}</div>`);
    parts.push(`<div class="row dim">${GLYPHS.map((g) => `${g} ${r.scores[g].toFixed(2)}`).join(' &nbsp; ')}</div>`);
    const rows: [string, string | number][] = [
      ['strokes', f.strokeCount], ['raw pts', f.rawPoints], ['size', Math.round(f.size)],
      ['aspect', f.aspect.toFixed(2)], ['closure', f.closure.toFixed(2)], ['turning', f.turning.toFixed(2)],
      ['corners', `${f.corners} [${f.cornerAngles.join(',')}]`], ['radialVar', f.radialVar.toFixed(2)],
      ['humps', f.humps], ['axisTilt', Math.round(f.axisTilt)], ['crossings', f.crossings],
      ['straightness', f.straightness.toFixed(2)], ['strokeAngle', Math.round(f.strokeAngle)],
      ['lengthRatio', f.lengthRatio.toFixed(2)],
    ];
    parts.push(`<div class="feat">${rows.map(([k, v]) => `<div><span class="dim">${k}</span> ${v}</div>`).join('')}</div>`);
  } else {
    parts.push('<div class="dim">draw on the page</div>');
  }
  if (samples.length) {
    const ms = samples.map((s) => s.ms).sort((a, b) => a - b);
    const p = (q: number) => Math.round(ms[Math.min(ms.length - 1, Math.floor(q * ms.length))]);
    parts.push(table('strict — all 4 classes', matrix(samples, false)));
    parts.push(table('expected — target + 1 decoy (what the game runs)', matrix(samples, true)));
    parts.push(`<div class="dim" style="margin-top:6px">draw-to-commit latency: median ${p(0.5)}ms, p90 ${p(0.9)}ms, max ${p(1)}ms</div>`);
  }
  bottom.innerHTML = parts.join('');
}

new GestureCapture({
  el: pad,
  minSize: Math.max(40, Math.min(innerWidth, innerHeight) * 0.08),
  onChange: (strokes, live) => {
    if (live && startedAt === 0) startedAt = performance.now();
    drawTrail(strokes);
  },
  onResult: (r, strokes) => {
    const ms = startedAt ? performance.now() - startedAt : 0;
    startedAt = 0;
    const expected = mode === 'drill' ? recognize(strokes, { expect: decoyFor(target) }) : null;
    last = { r, expected };
    if (mode === 'drill' && strokes.length) {
      samples.push({ target, strokes, ms });
      save();
      verdictEl.textContent = r.glyph === target ? '✓' : r.glyph ? '✗' : '–';
      verdictEl.style.color = r.glyph === target ? '#4ade80' : r.glyph ? '#f87171' : '#fbbf24';
      target = pickTarget();
      renderPrompt();
    }
    render();
  },
});

document.getElementById('mode-drill')!.onclick = () => {
  mode = 'drill';
  document.getElementById('mode-drill')!.classList.add('on');
  document.getElementById('mode-free')!.classList.remove('on');
  renderPrompt();
};
document.getElementById('mode-free')!.onclick = () => {
  mode = 'free';
  document.getElementById('mode-free')!.classList.add('on');
  document.getElementById('mode-drill')!.classList.remove('on');
  renderPrompt();
};
document.getElementById('rerun')!.onclick = () => { render(); };
document.getElementById('clear')!.onclick = () => {
  if (!confirm(`discard ${samples.length} samples?`)) return;
  samples = [];
  save();
  last = null;
  render();
};
document.getElementById('export')!.onclick = () => {
  const blob = new Blob([JSON.stringify(samples)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'gesture-samples.json';
  a.click();
  URL.revokeObjectURL(a.href);
};

renderPrompt();
render();
