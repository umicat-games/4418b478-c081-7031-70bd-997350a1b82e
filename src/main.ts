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
 * Glyph Drop — a gesture-driven match-3 in a Tetris well.
 *
 * Draw the mark on one of the two ringed tiles at the bottom; it goes, the stack
 * falls, three-in-a-row goes on its own, and the well refills from above.
 *
 * Three structural decisions worth knowing before changing anything here:
 *
 * **`Input3D` is never constructed.** On touch it claims the left half of the
 * screen for a thumbstick and the right half for the camera; this game needs the
 * whole screen as paper. Not constructing it means no platform control layer
 * exists at all, which is why the z-indexes in `index.html` start at 1 instead
 * of stepping around 10.
 *
 * **The recogniser is told what the board expects.** Only the two ringed tiles
 * are live, so at most two glyphs mean anything, and `recognize()` takes that as
 * `expect` — a 4-class decision becomes a 2-class one and the accept threshold
 * relaxes with it. Measured, not assumed: see `tools/gesture-bench.mjs`.
 *
 * **A gesture drawn mid-cascade is queued, not dropped, and never punished.**
 * Chains take a few hundred ms and a player in rhythm draws through them. The
 * queued glyph is applied if it matches the NEW bottom two and silently
 * discarded if it does not — charging a miss for tiles that were not on screen
 * when the stroke started would be punishing the player for the animation.
 */

const PITCH = 1.0;
const TILE = 0.93;
const FALL_G = -44;            // units/s^2, in tiles — snappy, not floaty
const CLEAR_MS = 165;
const START_ROWS = 5;
const SAVE_KEY = 'progress';

const VIEW_W = B.COLS * PITCH + 1.5;
const VIEW_H = B.ROWS * PITCH + 1.8;
const CENTER_Y = (B.ROWS * PITCH) / 2;

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
  z: number;
  dying: number;
}

async function start(): Promise<void> {
  const umicat = await ThreeUmicat.init();

  const canvas = document.getElementById('game') as HTMLCanvasElement;
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  // No shadows on purpose. Every tile is a flat face on a flat wall lit from the
  // front, so a shadow map would double the draw count for a picture nobody can
  // see — the exact trade CLAUDE.md warns about for a board of tiles.
  renderer.shadowMap.enabled = false;
  setupScreenshotListener(renderer);
  setupRecordingListener(renderer);

  const params = new URLSearchParams(location.search);
  if (params.has('umicatEdit')) {
    await runEditorDesignPlayer3D(renderer, { sceneId: params.get('umicatScene') ?? undefined });
    return;
  }

  // The well — back panel, floor, rails — is authored design data, so the
  // editor's Edit tab renders exactly the set the game plays in. The tiles are
  // the part that is not design data and never could be, so they are built here.
  // No `rapier` is passed: nothing in this game is simulated, tiles are animated
  // toward grid cells, and a physics world would only be a 2MB liability.
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

  // ---- tile look -----------------------------------------------------------
  const geo = new THREE.BoxGeometry(TILE, TILE, TILE);
  const matCache = new Map<Glyph, THREE.Material[]>();
  const matsFor = (g: Glyph): THREE.Material[] => {
    const hit = matCache.get(g);
    if (hit) return hit;
    const side = new THREE.MeshStandardMaterial({
      color: new THREE.Color(GLYPH_COLOR[g]).multiplyScalar(0.52), roughness: 0.75, metalness: 0,
    });
    const front = new THREE.MeshStandardMaterial({ map: glyphTexture(g), roughness: 0.62, metalness: 0 });
    // BoxGeometry material order is +X −X +Y −Y +Z −Z, so index 4 is the face
    // turned towards the camera — the only one the player ever reads.
    const mats = [side, side, side, side, front, side];
    matCache.set(g, mats);
    return mats;
  };
  const dyingMat = new THREE.MeshBasicMaterial({ color: 0xffffff });

  // An outline around the tile, not a ring in front of it. A torus wide enough
  // to read had to be wider than the tile, so two adjacent targets — which is
  // the normal case — drew two overlapping circles over each other's glyph, and
  // the mark the player is supposed to copy was the thing being covered up.
  const ringGeo = new THREE.EdgesGeometry(new THREE.BoxGeometry(PITCH * 0.99, PITCH * 0.99, TILE * 1.03));
  const rings = [0, 1].map(() => {
    const m = new THREE.LineSegments(ringGeo, new THREE.LineBasicMaterial({
      color: 0xffffff, transparent: true, opacity: 0.95,
    }));
    m.visible = false;
    scene.add(m);
    return m;
  });

  // ---- state --------------------------------------------------------------
  const grid = B.emptyGrid();
  const views = new Map<number, View>();
  let targetIds = new Set<number>();
  /** Which column the sweeping pair starts at — see `board.targets`. */
  let cursor = 0;
  let score = 0;
  let best = 0;
  let cleared = 0;
  let moves = 0;
  let misses = 0;
  let busy = false;
  let over = false;
  let queued: Glyph | null = null;
  let shake = 0;
  const rng = () => Math.random();

  const saved = await umicat.saves.get<{ best: number }>(SAVE_KEY);
  best = saved?.best ?? 0;

  /**
   * How full the well is kept — and, since the well is always exactly this full,
   * the whole difficulty curve and the loss condition in one number.
   *
   * Counted in MOVES, not in tiles cleared. Tiles cleared was the first attempt
   * and it made a good chain punish the player: one lucky cascade could clear
   * thirty tiles and jump the floor four rows, so playing well ended the run
   * faster than playing badly. A miss costs about eight moves' worth.
   */
  const baseHeight = () => Math.min(B.ROWS, START_ROWS + Math.floor((moves + misses * 8) / 25));

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

  function updateHud(targets: { tile: B.Tile }[]): void {
    scoreNum.textContent = String(score);
    bestEl.textContent = `最高 ${Math.max(best, score)}`;
    // Rebuild only when the pair actually changes: this runs on every settle and
    // innerHTML on every one of them throws away the DOM the CSS transition on
    // the chips is animating.
    const key = targets.map((t) => t.tile.glyph).join(',');
    if (chipsEl.dataset.key === key) return;
    chipsEl.dataset.key = key;
    chipsEl.innerHTML = targets
      .map(({ tile }) => `<span class="chip" style="border-color:${GLYPH_COLOR[tile.glyph]}">${glyphSvg(tile.glyph, GLYPH_COLOR[tile.glyph], 10)}</span>`)
      .join('');
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
  function makeView(tile: B.Tile, col: number, row: number, dropFrom: number): View {
    const mesh = new THREE.Mesh(geo, matsFor(tile.glyph));
    scene.add(mesh);
    return { tile, mesh, col, row, y: dropFrom, vy: 0, squash: 0, z: 0, dying: 0 };
  }

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
          v = makeView(t, c, r, t.fresh ? above : yOf(r));
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

    const targets = B.targets(grid, cursor);
    targetIds = new Set(targets.map((t) => t.tile.id));
    updateHud(targets);
  }

  function kill(ids: Set<number>): void {
    for (const id of ids) {
      const v = views.get(id);
      if (!v) continue;
      v.dying = CLEAR_MS / 1000;
      v.mesh.material = dyingMat;
    }
  }

  /** Resolves when nothing is falling and nothing is mid-death. The guard is
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

  // ---- the loop that resolves a move --------------------------------------
  async function cascade(): Promise<number> {
    let chain = 0;
    for (let guard = 0; guard < 60; guard++) {
      await settled();
      const groups = B.findGroups(grid);
      if (groups.length) {
        chain++;
        const ids = new Set(groups.flat().map((t) => t.id));
        score += ids.size * (10 + 8 * chain);
        cleared += ids.size;
        audio.play(chain > 1 ? 'upgrade' : 'coin');
        if (chain > 1) flash(`连锁 ×${chain}`, '#ffd76a');
        kill(ids);
        await wait(CLEAR_MS);
        B.remove(grid, ids);
        B.applyGravity(grid);
        sync();
        continue;
      }
      // Topped up so that it lands no match of its own. Random refill was tried
      // first and the board played itself: 54 cells of four glyphs throws up
      // three-in-a-row constantly, so every clear set off a cascade that set off
      // a refill that set off another cascade — a smoke run scored 67,000 and
      // filled the well without the player doing anything. Chains are supposed
      // to come from the FALL after a clear, which is the mechanic; chains that
      // come from the dealer are just the game playing itself.
      if (B.refill(grid, baseHeight(), rng, true).length) { sync(); continue; }
      return chain;
    }
    return chain;
  }

  async function apply(matched: B.Tile[], furthest: number): Promise<void> {
    busy = true;
    cursor = B.advance(cursor, furthest);
    moves++;
    score += matched.length * 12;
    cleared += matched.length;
    audio.play('coin');
    if (matched.length > 1) flash('双消', '#9be7ff');
    const ids = new Set(matched.map((t) => t.id));
    kill(ids);
    await wait(CLEAR_MS);
    B.remove(grid, ids);
    B.applyGravity(grid);
    sync();
    await cascade();
    busy = false;

    if (B.isLost(grid)) { finish(); return; }
    const q = queued;
    queued = null;
    // Silently, if it no longer fits: the player aimed at tiles that have since
    // been cleared out from under them.
    if (q) commit(q, true);
  }

  function commit(glyph: Glyph, fromQueue = false): void {
    const pair = B.targets(grid, cursor);
    const hits = pair.map((t, k) => ({ ...t, k })).filter((t) => t.tile.glyph === glyph);
    if (!hits.length) {
      if (fromQueue) return;
      misses++;
      shake = 0.22;
      audio.play('denied');
      updateHud(pair);
      return;
    }
    void apply(hits.map((h) => h.tile), hits[hits.length - 1].k);
  }

  function onGesture(r: Result): void {
    if (over) return;
    hintEl.style.opacity = '0';
    if (!r.glyph) {
      shake = 0.12;
      audio.play('ui-press');
      return;
    }
    if (busy) { queued = r.glyph; return; }
    commit(r.glyph);
  }

  async function finish(): Promise<void> {
    over = true;
    capture.setEnabled(false);
    best = Math.max(best, score);
    document.getElementById('over-score')!.textContent = String(score);
    document.getElementById('over-best')!.textContent = `最高 ${best}`;
    overEl.style.display = 'flex';
    await umicat.saves.set(SAVE_KEY, { best });
  }

  function reset(): void {
    for (const v of views.values()) scene.remove(v.mesh);
    views.clear();
    for (let r = 0; r < B.ROWS; r++) for (let c = 0; c < B.COLS; c++) grid[r][c] = null;
    score = 0; cleared = 0; moves = 0; misses = 0; queued = null; over = false; busy = false; cursor = 0;
    B.refill(grid, START_ROWS, rng, true);
    sync();
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
    expect: () => B.targets(grid, cursor).map((t) => t.tile.glyph),
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

    // Frame the whole well, whichever of the two dimensions runs out first. A
    // fixed camera distance is what makes a portrait phone show a board with
    // its sides cut off, and the sides are where the columns are.
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

    for (const [id, v] of views) {
      if (v.dying > 0) {
        v.dying -= dt;
        const k = Math.max(0, v.dying / (CLEAR_MS / 1000));
        v.mesh.scale.setScalar(0.15 + 0.95 * k);
        v.mesh.rotation.z += dt * 7 * (1 - k);
        v.mesh.position.set(xOf(v.col), v.y, v.z);
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

      // A ringed tile stands forward out of the wall. Depth is the one cue a
      // flat-on camera still has, and it survives being colour-blind.
      const wantZ = targetIds.has(id) ? 0.26 : 0;
      v.z += (wantZ - v.z) * Math.min(1, dt * 12);

      const sq = v.squash;
      v.mesh.scale.set(1 + sq * 0.7, 1 - sq * 1.5, 1 + sq * 0.7);
      v.mesh.rotation.z = 0;
      v.mesh.position.set(xOf(v.col), v.y - sq * 0.75 * PITCH * 0.5, v.z);
    }

    const targets = [...targetIds].map((id) => views.get(id)).filter(Boolean) as View[];
    rings.forEach((ring, i) => {
      const v = targets[i];
      ring.visible = !!v && !over;
      if (!v) return;
      const pulse = 1 + Math.sin(clock * 5.5 + i * 1.2) * 0.05;
      ring.scale.setScalar(pulse);
      ring.position.set(xOf(v.col), v.y, v.z + 0.62);
    });

    if (shake > 0) {
      shake = Math.max(0, shake - dt);
      camera.position.x = Math.sin(clock * 70) * 0.16 * (shake / 0.22);
    } else if (camera.position.x !== 0) {
      camera.position.x = 0;
    }

    renderer.render(scene, camera);
  });

  B.refill(grid, START_ROWS, rng, true);
  sync();
  setTimeout(() => { hintEl.style.opacity = '0'; }, 7000);

  // The probe every Umicat game exposes, so a headless run can assert on game
  // state instead of on pixels. `tools/pw-smoke.mjs` reads it.
  (window as unknown as Record<string, unknown>).__game = {
    targets: () => B.targets(grid, cursor).map((t) => t.tile.glyph),
    score: () => score,
    misses: () => misses,
    cleared: () => cleared,
    moves: () => moves,
    busy: () => busy,
    over: () => over,
    tiles: () => views.size,
    height: () => Math.max(...Array.from({ length: B.COLS }, (_, c) => B.height(grid, c))),
    cursor: () => cursor,
  };
}

void start();
