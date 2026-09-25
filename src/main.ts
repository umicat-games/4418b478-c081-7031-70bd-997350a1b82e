import * as THREE from 'three';
import {
  ThreeUmicat, loadScene3D, GameAudio,
  setupScreenshotListener, setupRecordingListener, runEditorDesignPlayer3D,
  type Scene3D, type Manifest3D,
} from '@umicat/three-sdk';
import type { Glyph, Result } from './gesture/recognize';
import { GestureCapture } from './gesture/capture';
import * as B from './board';
import { GLYPH_COLOR, glyphSvg, glyphTexture } from './glyphs';

/**
 * Glyph Drop — a gesture match-3 in a Tetris well.
 *
 * Draw any of the four marks. It clears every tile of that glyph in the lowest
 * row holding one; the stack falls; three-or-more of a kind clears itself and
 * cascades. The run ends when the well has no room left.
 *
 * **Every clear owes the rain a few tiles back, and the number rises as the run
 * goes.** That is the whole economy, and it is tuned in `tools/sim.mjs` rather
 * than by taste, because it has a feedback loop nobody would guess at: a fuller
 * board gives wider matches and more chains, so removal rises with fill and the
 * well fights being filled. A clock drip on top of it means standing still also
 * loses.
 *
 * What makes it a game rather than a copying exercise is that the player picks
 * the glyph. Scoring is `n²` for how many came out at once, divided by how far
 * up the row was, so a gesture is never wasted but the row on the floor is the
 * one worth having — and the second-order read, which is where the depth is, is
 * what the columns above will land on once that row drops out.
 *
 * It also balances itself. Spam the mark you draw most reliably and the board
 * runs out of that mark, so your clears shrink until you use the others.
 *
 * Structural notes that are decisions, not accidents:
 *
 * **`Input3D` is never constructed.** On touch it claims the left half of the
 * screen for a thumbstick and the right half for the camera; this game needs the
 * whole screen as paper. Nothing constructs the platform control layer, which is
 * why `index.html`'s z-indexes start at 1 instead of stepping around 10.
 *
 * **Nothing the rain drops completes a match.** The player's clear is the only
 * thing that starts a cascade. A dealer that hands out chains both takes the
 * credit and runs away with itself — a smoke run once scored 67,000 and filled
 * the well without a single gesture.
 *
 * **A gesture drawn mid-cascade is queued, and a queued gesture that no longer
 * matches is dropped silently.** Chains take a few hundred ms and a player in
 * rhythm draws through them; charging a miss for a board that changed under the
 * stroke is punishing the player for the animation.
 */

const PITCH = 1.0;
const TILE = 0.93;
const FALL_G = -44;             // units/s², in tiles — snappy, not floaty
const CLEAR_MS = 165;
const OPENING_ROWS = 4;
const RAIN_MS = 110;            // gap between tiles while the well is owed some
const RAIN_CATCHUP_MS = 450;    // ...and how long the whole backlog may take
const RAIN_PER_MOVE = 5.2;      // tiles the rain owes for every clear made
const RAIN_GROWTH = 0.03;       // ...and how much that rises per move
const RAIN_FLOOR = 10;          // below this the well is topped up regardless
const DRIP_MS = 4500;           // first gap between free tiles, on the clock
const DRIP_MIN_MS = 1300;
const DRIP_DECAY = 0.985;       // per successful move
const FLOW_MS = 2500;           // how long a combo stays alive
const SAVE_KEY = 'progress';

const VIEW_W = B.COLS * PITCH + 1.5;
const VIEW_H = B.ROWS * PITCH + 2.8;
const CENTER_Y = (B.ROWS * PITCH) / 2 + 0.45;

const xOf = (col: number) => (col - (B.COLS - 1) / 2) * PITCH;
const yOf = (row: number) => row * PITCH + PITCH / 2;
const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

interface View {
  tile: B.Tile;
  mesh: THREE.Mesh;
  col: number;
  row: number;
  y: number;
  vy: number;
  squash: number;
  dying: number;
}

async function start(): Promise<void> {
  const umicat = await ThreeUmicat.init();

  const canvas = document.getElementById('game') as HTMLCanvasElement;
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  // No shadows. Every tile is a flat face on a flat wall lit from the front, so
  // a shadow map would double the draw count for a picture nobody can see.
  renderer.shadowMap.enabled = false;
  setupScreenshotListener(renderer);
  setupRecordingListener(renderer);

  const params = new URLSearchParams(location.search);
  if (params.has('umicatEdit')) {
    await runEditorDesignPlayer3D(renderer, { sceneId: params.get('umicatScene') ?? undefined });
    return;
  }

  // The well — back panel, floor, rails — is authored design data, so the Edit
  // tab renders exactly the set the game plays in. The tiles are the part that
  // is not design data and never could be. No `rapier`: nothing is simulated
  // here, tiles are animated toward grid cells.
  const [manifest, scene3d] = await Promise.all([
    fetch('scenes3d/manifest.json').then((r) => r.json() as Promise<Manifest3D>),
    fetch('scenes3d/main.json').then((r) => r.json() as Promise<Scene3D>),
  ]);
  const world = await loadScene3D(scene3d, manifest, { assetBase: '' });
  const { scene, camera } = world;

  const audio = new GameAudio({
    clips: {
      coin: { volume: 0.42, throttle: 30 },
      upgrade: { volume: 0.5 },
      denied: { volume: 0.4 },
      build: { volume: 0.22, throttle: 45 },
      'ui-press': { volume: 0.3 },
    },
    base: 'audio/',
    extension: '.ogg',
  });

  // ---- tile look ----------------------------------------------------------
  const geo = new THREE.BoxGeometry(TILE, TILE, TILE);
  const matCache = new Map<string, THREE.Material[]>();
  function matsFor(g: Glyph, ghost = false): THREE.Material[] {
    const key = `${g}${ghost ? ':ghost' : ''}`;
    const hit = matCache.get(key);
    if (hit) return hit;
    const side = new THREE.MeshStandardMaterial({
      color: new THREE.Color(GLYPH_COLOR[g]).multiplyScalar(0.52),
      roughness: 0.75, metalness: 0,
      transparent: ghost, opacity: ghost ? 0.2 : 1,
    });
    const front = new THREE.MeshStandardMaterial({
      map: glyphTexture(g), roughness: 0.62, metalness: 0,
      transparent: ghost, opacity: ghost ? 0.45 : 1,
    });
    // BoxGeometry material order is +X −X +Y −Y +Z −Z, so index 4 is the face
    // turned towards the camera — the only one the player ever reads.
    const mats = [side, side, side, side, front, side];
    matCache.set(key, mats);
    return mats;
  }
  const dyingMat = new THREE.MeshBasicMaterial({ color: 0xffffff });

  // The tile that is about to fall, hanging over the column it will fall into.
  // Half the planning in this game is "what is coming", and without this the
  // rain is something that happens to the player rather than something they can
  // play around.
  const ghost = new THREE.Mesh(geo, matsFor('circle', true));
  ghost.visible = false;
  scene.add(ghost);

  // The line the well fills to. A loss the player cannot see coming is a loss
  // they read as unfair, even when the board was in plain view the whole time.
  const dangerGeo = new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(-B.COLS / 2, B.ROWS * PITCH, 0.5),
    new THREE.Vector3(B.COLS / 2, B.ROWS * PITCH, 0.5),
  ]);
  scene.add(new THREE.Line(dangerGeo, new THREE.LineBasicMaterial({
    color: 0xff6b5a, transparent: true, opacity: 0.55,
  })));

  // ---- state --------------------------------------------------------------
  const grid = B.emptyGrid();
  const views = new Map<number, View>();
  let score = 0;
  let best = 0;
  let cleared = 0;
  let moves = 0;
  let misses = 0;
  let busy = false;
  let over = false;
  let queued: Glyph | null = null;
  let shake = 0;
  let flow = 0;
  let flowUntil = 0;
  let dripTimer = 0;
  let rainTimer = 0;
  /**
   * Tiles the rain still has to deliver, carried as a fraction.
   *
   * Two things put tiles here: every clear owes `RAIN_PER_MOVE`, rising as the
   * run goes, and the clock drips one in on its own. The first is the pressure
   * you can play against — the second is the pressure you cannot, which is what
   * stops the game becoming a turn-based puzzle with no reason to hurry.
   *
   * The numbers come from `tools/sim.mjs`, not from taste, and they have been
   * wrong twice. The economy has a strong negative feedback nobody would guess
   * at: a fuller board gives wider matches and more chains, so removal rises
   * with fill and the well resists ever topping out. Earlier attempts drained
   * the well to nothing in half a minute, or filled it regardless of how well it
   * was played.
   *
   * The second mistake is the one worth remembering. At 3.2 the simulator said
   * "held" and it was `RAIN_FLOOR` doing the holding: the true equilibrium was
   * BELOW the floor, so the well sat at exactly the emergency minimum — 15
   * tiles, two and a half rows, nothing to read — and it took the headless smoke
   * run to notice. Measure a steady state with the floor switched OFF, or the
   * safety net reports the number you wanted to hear.
   *
   * At 5.2 the well settles around 27 tiles (4.4 rows). Growth of 0.03 ends a
   * run at ~210 moves played well and ~130 played carelessly, averaged over
   * seven seeds — one seed is a coin flip and said 3.0x where seven say 1.6x.
   */
  let owed = 0;
  let upcoming: { col: number; glyph: Glyph } | null = null;
  const rng = () => Math.random();

  // A save is untrusted input the moment it is read back, and `??` checks the
  // wrong thing: it catches a MISSING save, never a malformed one. The sibling
  // 3D games learned this the expensive way — a debounced write can serialise a
  // field as `undefined`, which `JSON.stringify` DROPS rather than writing
  // `null`, and a `NaN` survives `??` entirely. There it reached Rapier and
  // killed the boot on every load until the row was cleared by hand; here there
  // is no physics to crash, so it would instead show `最高 NaN` forever and
  // poison every high score after it, which is quieter and no easier to
  // diagnose. Guarded on BOTH ends because they fix different halves: the read
  // self-heals a row that is already bad, the write stops a new one being made.
  const saved = await umicat.saves.get<{ best?: number }>(SAVE_KEY);
  best = Number.isFinite(saved?.best) ? (saved!.best as number) : 0;

  const dripInterval = () => Math.max(DRIP_MIN_MS, DRIP_MS * DRIP_DECAY ** moves);
  const rainPerMove = () => RAIN_PER_MOVE + RAIN_GROWTH * moves;
  const multiplier = () => Math.min(4, 1 + Math.max(0, flow - 1) * 0.25);

  // ---- DOM ----------------------------------------------------------------
  const scoreEl = document.getElementById('score')!;
  const scoreNum = document.createTextNode('0');
  const bestEl = document.createElement('small');
  scoreEl.textContent = '';
  scoreEl.append(scoreNum, bestEl);
  const chipsEl = document.getElementById('chips')!;
  const flashEl = document.getElementById('flash')!;
  const hintEl = document.getElementById('hint')!;
  const overEl = document.getElementById('over')!;

  function updateHud(): void {
    scoreNum.textContent = String(score);
    bestEl.textContent = flow > 1
      ? `连击 ×${multiplier().toFixed(2).replace(/0+$/, '').replace(/\.$/, '')}`
      : `最高 ${Math.max(best, score)}`;
    const key = upcoming ? upcoming.glyph : '';
    if (chipsEl.dataset.key === key) return;
    chipsEl.dataset.key = key;
    chipsEl.innerHTML = upcoming
      ? `<span class="chip" style="border-color:${GLYPH_COLOR[upcoming.glyph]}">${glyphSvg(upcoming.glyph, GLYPH_COLOR[upcoming.glyph], 10)}</span>`
      : '';
  }

  let flashTimer = 0;
  function flash(text: string, color = '#fff'): void {
    flashEl.textContent = text;
    flashEl.style.color = color;
    flashEl.style.opacity = '1';
    clearTimeout(flashTimer);
    flashTimer = window.setTimeout(() => { flashEl.style.opacity = '0'; }, 520);
  }

  // ---- view sync ----------------------------------------------------------
  function sync(): void {
    // Fresh tiles enter from above the well, stacked in the order they will
    // land, so a column being topped up looks like a column being topped up
    // rather than three tiles materialising at three heights.
    const lowestFresh = new Array<number>(B.COLS).fill(Infinity);
    for (let r = 0; r < B.ROWS; r++) {
      for (let c = 0; c < B.COLS; c++) {
        const t = grid[r][c];
        if (t?.fresh && r < lowestFresh[c]) lowestFresh[c] = r;
      }
    }

    const live = new Set<number>();
    for (let r = 0; r < B.ROWS; r++) {
      for (let c = 0; c < B.COLS; c++) {
        const t = grid[r][c];
        if (!t) continue;
        live.add(t.id);
        let v = views.get(t.id);
        if (!v) {
          const above = yOf(B.ROWS) + 1.1 + (r - lowestFresh[c]) * PITCH;
          const mesh = new THREE.Mesh(geo, matsFor(t.glyph));
          scene.add(mesh);
          v = { tile: t, mesh, col: c, row: r, y: t.fresh ? above : yOf(r), vy: 0, squash: 0, dying: 0 };
          views.set(t.id, v);
          t.fresh = false;
        }
        v.col = c;
        v.row = r;
      }
    }
    for (const [id, v] of views) {
      if (!live.has(id) && v.dying <= 0) { scene.remove(v.mesh); views.delete(id); }
    }
    updateHud();
  }

  function kill(ids: Set<number>): void {
    for (const id of ids) {
      const v = views.get(id);
      if (!v) continue;
      v.dying = CLEAR_MS / 1000;
      v.mesh.material = dyingMat;
    }
  }

  /** Resolves when nothing is falling and nothing is mid-death. The deadline is
   *  there so a rule bug can only make the game feel odd, never hang it. */
  function settled(): Promise<void> {
    return new Promise((res) => {
      const deadline = performance.now() + 2500;
      const check = () => {
        const quiet = [...views.values()].every(
          (v) => v.dying <= 0 && v.vy === 0 && Math.abs(v.y - yOf(v.row)) < 1e-3,
        );
        if (quiet || performance.now() > deadline) res();
        else requestAnimationFrame(check);
      };
      check();
    });
  }

  // ---- the rain -----------------------------------------------------------
  function queueNext(): void {
    upcoming = B.nextDrop(grid, rng);
    updateHud();
  }

  function rain(): void {
    // Re-checked rather than trusted: the column the ghost has been hanging over
    // may have filled up since it was chosen.
    if (!upcoming || B.height(grid, upcoming.col) >= B.ROWS) queueNext();
    if (!upcoming) { void finish(); return; }
    B.drop(grid, upcoming.col, upcoming.glyph);
    sync();
    queueNext();
    if (!upcoming) void finish();
  }

  // ---- resolving a move ---------------------------------------------------
  async function cascade(): Promise<number> {
    let chain = 0;
    for (let guard = 0; guard < 40; guard++) {
      await settled();
      const groups = B.findGroups(grid);
      if (!groups.length) return chain;
      chain++;
      const ids = new Set(groups.flat().map((t) => t.id));
      score += Math.round(ids.size * (10 + 8 * chain) * multiplier());
      cleared += ids.size;
      audio.play(chain > 1 ? 'upgrade' : 'coin');
      flash(chain > 1 ? `连锁 ×${chain}` : `${ids.size} 连`, '#ffd76a');
      kill(ids);
      await wait(CLEAR_MS);
      B.remove(grid, ids);
      B.applyGravity(grid);
      sync();
    }
    return chain;
  }

  async function apply(match: { row: number; tiles: B.Tile[] }): Promise<void> {
    busy = true;
    moves++;
    const now = performance.now();
    flow = now < flowUntil ? flow + 1 : 1;
    flowUntil = now + FLOW_MS;

    const n = match.tiles.length;
    // Width squared, depth divided. Never wasted, rarely equal.
    const points = Math.round((10 * n * n * multiplier()) / (1 + match.row));
    score += points;
    cleared += n;
    owed += rainPerMove();
    audio.play('coin');
    if (n > 1) flash(`${n} 连 +${points}`, '#9be7ff');

    kill(new Set(match.tiles.map((t) => t.id)));
    await wait(CLEAR_MS);
    B.remove(grid, new Set(match.tiles.map((t) => t.id)));
    B.applyGravity(grid);
    sync();
    await cascade();
    busy = false;

    const q = queued;
    queued = null;
    if (q) commit(q, true);
  }

  function commit(glyph: Glyph, fromQueue = false): void {
    const match = B.lowestMatch(grid, glyph);
    if (!match) {
      // The board holds none of that glyph. Say so: "nothing happened" is the
      // one response a player cannot learn from, and a board of twenty tiles
      // genuinely can run out of a mark without anyone noticing.
      if (fromQueue) return;
      misses++;
      flow = 0;
      shake = 0.22;
      audio.play('denied');
      flash('场上没有这个', '#ff9b8a');
      updateHud();
      return;
    }
    void apply(match);
  }

  function onGesture(r: Result): void {
    if (over) return;
    hintEl.style.opacity = '0';
    if (!r.glyph) {
      // A refused stroke costs nothing but the moment it took. It is not a
      // wrong answer, and sounding like one teaches players to distrust the
      // recogniser for something they did not do.
      shake = 0.12;
      audio.play('ui-press');
      return;
    }
    if (busy) { queued = r.glyph; return; }
    commit(r.glyph);
  }

  async function finish(): Promise<void> {
    if (over) return;
    over = true;
    capture.setEnabled(false);
    ghost.visible = false;
    best = Math.max(best, score);
    document.getElementById('over-score')!.textContent = String(score);
    document.getElementById('over-best')!.textContent = `最高 ${best}`;
    overEl.style.display = 'flex';
    if (Number.isFinite(best)) await umicat.saves.set(SAVE_KEY, { best });
  }

  function reset(): void {
    for (const v of views.values()) scene.remove(v.mesh);
    views.clear();
    for (let r = 0; r < B.ROWS; r++) for (let c = 0; c < B.COLS; c++) grid[r][c] = null;
    score = 0; cleared = 0; moves = 0; misses = 0; queued = null;
    over = false; busy = false; flow = 0; dripTimer = 0; rainTimer = 0; owed = 0;
    B.refill(grid, OPENING_ROWS, rng, true);
    sync();
    queueNext();
    overEl.style.display = 'none';
    capture.setEnabled(true);
  }
  document.getElementById('again')!.onclick = reset;

  // ---- drawing ------------------------------------------------------------
  const inkCanvas = document.getElementById('ink') as HTMLCanvasElement;
  const ink = inkCanvas.getContext('2d')!;
  const capture = new GestureCapture({
    el: document.getElementById('draw') as HTMLElement,
    minSize: Math.max(38, Math.min(innerWidth, innerHeight) * 0.07),
    expect: () => B.present(grid),
    onChange: (strokes) => {
      ink.clearRect(0, 0, innerWidth, innerHeight);
      ink.lineWidth = 9;
      ink.lineCap = 'round';
      ink.lineJoin = 'round';
      ink.strokeStyle = '#ffffff';
      ink.shadowColor = '#7fd4ff';
      ink.shadowBlur = 14;
      for (const s of strokes) {
        if (s.length < 2) continue;
        ink.beginPath();
        ink.moveTo(s[0].x, s[0].y);
        for (const p of s.slice(1)) ink.lineTo(p.x, p.y);
        ink.stroke();
      }
    },
    onResult: onGesture,
  });

  // ---- framing ------------------------------------------------------------
  function fit(): void {
    const w = window.innerWidth, h = window.innerHeight;
    renderer.setSize(w, h, false);
    const dpr = Math.min(window.devicePixelRatio, 2);
    inkCanvas.width = Math.round(w * dpr);
    inkCanvas.height = Math.round(h * dpr);
    inkCanvas.style.width = `${w}px`;
    inkCanvas.style.height = `${h}px`;
    ink.setTransform(dpr, 0, 0, dpr, 0, 0);

    // Frame the whole well, whichever dimension runs out first. A fixed camera
    // distance is what makes a portrait phone show a board with its sides cut
    // off, and the sides are where the columns are.
    camera.aspect = w / h;
    const half = THREE.MathUtils.degToRad(camera.fov) / 2;
    const forHeight = VIEW_H / 2 / Math.tan(half);
    const forWidth = VIEW_W / 2 / (Math.tan(half) * camera.aspect);
    camera.position.set(0, CENTER_Y, Math.max(forHeight, forWidth));
    camera.lookAt(0, CENTER_Y, 0);
    camera.updateProjectionMatrix();
  }
  window.addEventListener('resize', fit);
  fit();

  // ---- frame --------------------------------------------------------------
  let last = performance.now();
  let clock = 0;
  renderer.setAnimationLoop(() => {
    const now = performance.now();
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    clock += dt;

    // The rain holds its breath during a cascade. Tiles arriving in the middle
    // of one are unreadable, and worse, they land on a board that is still
    // rearranging itself.
    if (!over && !busy) {
      // A well this empty has nothing left to read, so it is topped up whatever
      // the rate says. It engages near zero and never at playing heights: a
      // floor under the board, not a hand on the scales.
      const short = RAIN_FLOOR - B.count(grid);
      if (short > 0 && owed < short) owed = short;

      if (owed >= 1) {
        // The gap shortens with the backlog, so the board on screen keeps up
        // with the board in the model. At a fixed 110ms a move owing five tiles
        // needs 570ms to deliver them, which is longer than a player in rhythm
        // leaves between strokes — the debt built up, the well LOOKED drained
        // while the economy was fine, and then it all arrived at once. The
        // economy is untouched by this; only how fast the rain catches up is.
        rainTimer += dt * 1000;
        if (rainTimer >= Math.min(RAIN_MS, RAIN_CATCHUP_MS / owed)) {
          rainTimer = 0;
          owed -= 1;
          rain();
        }
      } else {
        rainTimer = 0;
        dripTimer += dt * 1000;
        if (dripTimer >= dripInterval()) { dripTimer = 0; owed += 1; }
      }
    }
    if (flow > 0 && now > flowUntil) { flow = 0; updateHud(); }

    for (const [id, v] of views) {
      if (v.dying > 0) {
        v.dying -= dt;
        const k = Math.max(0, v.dying / (CLEAR_MS / 1000));
        v.mesh.scale.setScalar(0.15 + 0.95 * k);
        v.mesh.rotation.z += dt * 7 * (1 - k);
        v.mesh.position.set(xOf(v.col), v.y, 0);
        if (v.dying <= 0) { scene.remove(v.mesh); views.delete(id); }
        continue;
      }

      const ty = yOf(v.row);
      if (v.y > ty + 1e-4 || v.vy < 0) {
        v.vy += FALL_G * dt;
        v.y += v.vy * dt;
        if (v.y <= ty) {
          v.y = ty;
          v.vy = 0;
          v.squash = 0.14;
          audio.play('build');
        }
      }
      if (v.squash > 0) v.squash = Math.max(0, v.squash - dt * 0.85);

      const sq = v.squash;
      v.mesh.scale.set(1 + sq * 0.7, 1 - sq * 1.5, 1 + sq * 0.7);
      v.mesh.rotation.z = 0;
      v.mesh.position.set(xOf(v.col), v.y - sq * 0.375 * PITCH, 0);
    }

    if (upcoming && !over) {
      ghost.visible = true;
      ghost.material = matsFor(upcoming.glyph, true);
      const ready = owed >= 1 ? 1 : Math.min(1, dripTimer / dripInterval());
      ghost.position.set(xOf(upcoming.col), yOf(B.ROWS) + 0.95, 0);
      // Tightening as its moment approaches, so "something is about to land
      // there" is legible without reading a timer.
      ghost.scale.setScalar(0.78 + ready * 0.22);
    } else {
      ghost.visible = false;
    }

    if (shake > 0) {
      shake = Math.max(0, shake - dt);
      camera.position.x = Math.sin(clock * 70) * 0.16 * (shake / 0.22);
    } else if (camera.position.x !== 0) {
      camera.position.x = 0;
    }

    renderer.render(scene, camera);
  });

  B.refill(grid, OPENING_ROWS, rng, true);
  sync();
  queueNext();
  setTimeout(() => { hintEl.style.opacity = '0'; }, 7000);

  // The probe every Umicat game exposes, so a headless run can assert on game
  // state instead of on pixels. `tools/pw-smoke.mjs` reads it.
  (window as unknown as Record<string, unknown>).__game = {
    present: () => B.present(grid),
    score: () => score,
    misses: () => misses,
    cleared: () => cleared,
    moves: () => moves,
    busy: () => busy,
    over: () => over,
    tiles: () => views.size,
    height: () => Math.max(...Array.from({ length: B.COLS }, (_, c) => B.height(grid, c))),
    upcoming: () => (upcoming ? upcoming.glyph : null),
    owed: () => owed,
  };
}

void start();
