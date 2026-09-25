/**
 * Headless smoke test: does the game boot, and does drawing actually clear tiles?
 *
 * The interesting half is the gestures. A game whose only input is a drawn shape
 * cannot be tested by clicking, so this synthesises the four strokes as real
 * pointer movement and asserts on `window.__game` — the score went up, the miss
 * count did not, the console stayed clean. Half of what this catches is not
 * gameplay at all: a bad asset path, a material built before its texture, a
 * `fit()` that divides by a zero aspect. None of those throw anywhere a human
 * would look.
 *
 *   npx vite preview --port 5199 &
 *   node tools/pw-smoke.mjs
 */
import { chromium } from '/Users/yuantaoliu/work/umicat/umicat-admin/node_modules/playwright/index.mjs';

const BASE = process.env.BASE ?? 'http://localhost:5199';
let fails = 0;
const ok = (name, cond, extra = '') => {
  if (!cond) { fails++; console.log(`  FAIL ${name}${extra ? ' — ' + extra : ''}`); }
  else console.log(`  ok   ${name}`);
};

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 430, height: 932 } });

const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));

await page.goto(`${BASE}/index.html`, { waitUntil: 'load' });
await page.waitForFunction('window.__game !== undefined', { timeout: 15000 });

const g = () => page.evaluate('Object.fromEntries(Object.entries(window.__game).map(([k,f])=>[k,f()]))');

let st = await g();
ok('the board is populated', st.tiles > 0, `tiles=${st.tiles}`);
ok('it starts at the opening height', st.height === 5, `height=${st.height}`);
ok('two glyphs are live', st.targets.length === 2, JSON.stringify(st.targets));

// ---- gesture synthesis, in screen pixels ---------------------------------
const CX = 215, CY = 520, R = 95;
const STROKES = {
  circle: [Array.from({ length: 34 }, (_, i) => {
    const a = (i / 33) * Math.PI * 2.04;
    return [CX + Math.cos(a) * R, CY + Math.sin(a) * R];
  })],
  chevron: [[[CX - R, CY + R * 0.6], [CX - R / 2, CY], [CX, CY - R * 0.6], [CX + R / 2, CY], [CX + R, CY + R * 0.6]]],
  cross: [
    [[CX - R, CY - R], [CX, CY], [CX + R, CY + R]],
    [[CX + R, CY - R], [CX, CY], [CX - R, CY + R]],
  ],
  wave: [Array.from({ length: 30 }, (_, i) => {
    const u = i / 29;
    return [CX - R * 1.5 + u * R * 3, CY + Math.sin(u * Math.PI * 2) * R * 0.42];
  })],
};

async function draw(glyph) {
  for (const stroke of STROKES[glyph]) {
    // Interpolated, not jumped: a two-point drag is one pointermove and the
    // recogniser would be fed a straight line whatever shape was intended.
    await page.mouse.move(stroke[0][0], stroke[0][1]);
    await page.mouse.down();
    for (let i = 1; i < stroke.length; i++) {
      const [ax, ay] = stroke[i - 1], [bx, by] = stroke[i];
      for (let k = 1; k <= 4; k++) {
        await page.mouse.move(ax + (bx - ax) * (k / 4), ay + (by - ay) * (k / 4));
      }
    }
    await page.mouse.up();
  }
  // The cross waits up to 300ms for a partner stroke; everything else commits on
  // pen-up. Then the cascade has to finish before state is comparable.
  await page.waitForTimeout(420);
  await page.waitForFunction('window.__game.busy() === false', { timeout: 8000 }).catch(() => {});
}

console.log('each glyph is recognised when it is the live one');
for (const glyph of ['circle', 'chevron', 'cross', 'wave']) {
  let tries = 0;
  while (!(await g()).targets.includes(glyph) && tries++ < 14) {
    const s0 = await g();
    await draw(s0.targets[0]);
    if (process.env.VERBOSE) {
      const s1 = await g();
      console.log(`      drew ${s0.targets[0]}: score ${s0.score}→${s1.score} miss ${s0.misses}→${s1.misses} targets ${s1.targets}`);
    }
  }
  if (!(await g()).targets.includes(glyph)) {
    ok(`${glyph} became live`, false, 'never reached the bottom two');
    continue;
  }
  const before = await g();
  await draw(glyph);
  const after = await g();
  ok(`${glyph} clears`, after.score > before.score,
    `score ${before.score}→${after.score}, misses ${before.misses}→${after.misses}`);
  ok(`${glyph} is not a miss`, after.misses === before.misses);
}

console.log('a scribble is rejected, not guessed');
{
  const before = await g();
  ok('the run has not ended on its own', before.over === false,
    `score=${before.score} moves=${before.moves} — a board that finishes itself is a board playing itself`);
  await page.mouse.move(CX, CY);
  await page.mouse.down();
  for (let i = 0; i < 24; i++) {
    await page.mouse.move(CX + Math.sin(i * 2.7) * 40 + i, CY + Math.cos(i * 1.9) * 34);
  }
  await page.mouse.up();
  await page.waitForTimeout(700);
  const after = await g();
  ok('a scribble changes nothing', after.score === before.score && after.misses === before.misses,
    `score ${before.score}→${after.score}, misses ${before.misses}→${after.misses}`);
}

const end = await g();
ok('the well refills after clearing', end.height >= 5, `height=${end.height}`);
ok('console is clean', errors.length === 0, errors.slice(0, 4).join(' | '));

await page.screenshot({ path: process.env.SHOT ?? '/tmp/glyph-drop.png' });
await browser.close();
console.log(fails ? `\n${fails} FAILED` : '\nall passed');
process.exit(fails ? 1 : 0);
