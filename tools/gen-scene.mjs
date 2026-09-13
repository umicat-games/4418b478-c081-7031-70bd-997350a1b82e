// Generate the tower-defense boards, and the hub.
//
// A board is DESIGN DATA, but it is regular enough that authoring it by hand
// would be two hundred near-identical JSON objects with a rotation nobody could
// check. A road is a polyline; which tile goes where and which way it faces
// follows from it. So the polylines are the source, this derives the rest, and
// `npm run scene` regenerates all of it.
//
// Everything sits on a 1-unit grid because that is exactly what the kit's
// tiles measure (1 x 0.2 x 1, verified, not assumed).
import { writeFileSync } from 'node:fs';

const TILE_TOP = 0.2;          // the tiles' own height
const GROUND_Y = 0;            // walkable surface
const HALF = 5.5;              // outermost cell centre

// ─────────────────────────────────────────────────────────────────────────────
// Themes
//
// The kit ships a snow copy of every terrain piece, so a level's look is one
// table lookup rather than a second set of code. Anything a level places goes
// through here, which is what keeps a new theme from being a rewrite.

const THEMES = {
  grass: {
    sky: '#8fc9e8', skirt: '#3f6b38', wall: '#4a4036', ground: '#8fa08a',
    sun: '#fff6e0', sunIntensity: 2.2, skyIntensity: 2.0,
    tile: 'td-tile', straight: 'td-tile-straight', dirt: 'td-tile-dirt',
    spawn: 'td-tile-spawn', end: 'td-tile-end',
    // Scenery baked into a tile — a tree standing on its own patch of ground.
    // Cheaper than a tile plus a prop, and it lines up by construction.
    scenery: ['td-tile-tree', 'td-tile-tree-double', 'td-tile-tree-quad',
              'td-tile-rock', 'td-tile-crystal', 'td-tile-hill', 'td-tile-bump'],
    props: ['td-detail-tree-large', 'td-detail-rocks-large', 'td-detail-crystal-large',
            'td-wood-structure', 'td-wood-structure-high', 'td-detail-dirt-large'],
    portal: 'td-spawn-round',
    river: {
      straight: 'td-tile-river-straight',
      bridge: 'td-tile-river-bridge',
    },
  },
  snow: {
    sky: '#c8dcea', skirt: '#9fb3c4', wall: '#5b5a58', ground: '#c6d4e0',
    sun: '#eaf2ff', sunIntensity: 1.9, skyIntensity: 2.3,
    tile: 'td-snow-tile', straight: 'td-snow-tile-straight', dirt: 'td-snow-tile-dirt',
    spawn: 'td-snow-tile-spawn', end: 'td-snow-tile-end',
    scenery: ['td-snow-tile-tree', 'td-snow-tile-tree-double', 'td-snow-tile-tree-quad',
              'td-snow-tile-rock', 'td-snow-tile-crystal', 'td-snow-tile-hill',
              'td-snow-tile-bump'],
    props: ['td-snow-detail-tree-large', 'td-snow-detail-rocks-large',
            'td-snow-detail-crystal-large', 'td-snow-wood-structure',
            'td-snow-wood-structure-high', 'td-snow-detail-dirt-large'],
    portal: 'td-spawn-square',
    river: {
      straight: 'td-snow-tile-river-straight',
      bridge: 'td-snow-tile-river-bridge',
    },
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// The levels
//
// Each is a trunk polyline plus a branch to each gate. The road forks on every
// board: a single lane can be sealed with four good towers and the rest of the
// map is decoration, and with two the question becomes which half you can
// afford to leave thin.
//
// `gates` says which WALL each branch ends at, because the fork does not have
// to be left-and-right.

const LEVELS = [
  {
    id: 'meadow',
    name: 'Meadow',
    theme: 'grass',
    // Long and open. The first board anyone plays: one loop, wide bends,
    // nothing hidden, and more room beside the road than the gold will buy.
    trunk: [[-5.5, -4.5], [3.5, -4.5], [3.5, -1.5], [-3.5, -1.5],
            [-3.5, 1.5], [0.5, 1.5], [0.5, 4.5]],
    branches: [[[0.5, 4.5], [-5.5, 4.5]], [[0.5, 4.5], [5.5, 4.5]]],
    gates: [{ id: 'gate_w', wall: 'w', at: 4.5 }, { id: 'gate_e', wall: 'e', at: 4.5 }],
    scenerySeed: 11,
  },
  {
    id: 'frostfall',
    name: 'Frostfall',
    theme: 'snow',
    // The fork is early and the two gates are on different walls, so a hero who
    // commits to one side has a real walk back. And the ground is ice.
    trunk: [[-5.5, 4.5], [-1.5, 4.5], [-1.5, -0.5], [-4.5, -0.5], [-4.5, -3.5],
            [2.5, -3.5]],
    branches: [[[2.5, -3.5], [2.5, -5.5]], [[2.5, -3.5], [5.5, -3.5]]],
    gates: [{ id: 'gate_n', wall: 'n', at: 2.5 }, { id: 'gate_e', wall: 'e', at: -3.5 }],
    scenerySeed: 29,
  },
  {
    id: 'crossroads',
    name: 'Crossroads',
    theme: 'grass',
    // The two gates are on OPPOSITE walls and the road doubles back through the
    // middle. Whatever you build near one gate is thirteen units from the
    // other, which is the whole level: you cannot cover both with the same guns
    // and you cannot be at both.
    trunk: [[0.5, -5.5], [0.5, -1.5], [-3.5, -1.5], [-3.5, 2.5], [1.5, 2.5]],
    branches: [[[1.5, 2.5], [-5.5, 2.5]], [[1.5, 2.5], [5.5, 2.5]]],
    gates: [{ id: 'gate_w', wall: 'w', at: 2.5 }, { id: 'gate_e', wall: 'e', at: 2.5 }],
    scenerySeed: 47,
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// Geometry helpers

/** Expand a polyline into every cell it passes through, once each. */
function expand(corners) {
  const out = [];
  const push = (x, z) => {
    const last = out[out.length - 1];
    if (!last || last[0] !== x || last[1] !== z) out.push([x, z]);
  };
  for (let i = 0; i < corners.length - 1; i++) {
    const [x0, z0] = corners[i], [x1, z1] = corners[i + 1];
    const dx = Math.sign(x1 - x0), dz = Math.sign(z1 - z0);
    const n = Math.max(Math.abs(x1 - x0), Math.abs(z1 - z0));
    for (let k = 0; k <= n; k++) push(x0 + dx * k, z0 + dz * k);
  }
  return out;
}

/** A quaternion, as the ARRAY the schema wants — an {x,y,z,w} object here is
 *  rejected at load, loudly and by name, which is the loader working. */
const yaw = (a) => [0, Math.sin(a / 2), 0, Math.cos(a / 2)];

/** Yaw that points a tile's +Z along this direction. */
const dirYaw = (d) => Math.atan2(d[0], d[1]);
const dirTo = (a, b) => [Math.sign(b[0] - a[0]), Math.sign(b[1] - a[1])];
const key = (c) => `${c[0]},${c[1]}`;

/** Which model and which way round, from a cell's PATH NEIGHBOURS.
 *
 *  Neighbour counting rather than "the direction in and the direction out",
 *  which cannot describe a fork: that cell has one way in and two ways out. It
 *  also reads off the finished board rather than off the order someone walked
 *  it.
 *
 *  Corners AND forks get a full dirt tile, which is path on all four edges and
 *  therefore cannot be rotated wrong. The kit's corner tile joins two specific
 *  edges and every bend was visibly broken until I stopped trying to get its
 *  lookup table right. Deleting a class of bug beat winning it. */
function tileFor(theme, cell, neighbours, isSpawn, isEnd) {
  const t = THEMES[theme];
  if (isSpawn) return { model: t.spawn, rot: yaw(dirYaw(dirTo(cell, neighbours[0]))) };
  // The end tile's stub faces BACK the way the road came: pointing it along the
  // direction of travel puts the join on the far edge and leaves a cell of bare
  // ground right before the gate.
  if (isEnd) return { model: t.end, rot: yaw(dirYaw(dirTo(cell, neighbours[0])) + Math.PI) };
  if (neighbours.length === 2) {
    const a = dirTo(cell, neighbours[0]), b = dirTo(cell, neighbours[1]);
    if (a[0] === -b[0] && a[1] === -b[1]) return { model: t.straight, rot: yaw(dirYaw(a)) };
  }
  return { model: t.dirt, rot: yaw(0) };
}

/** A repeatable shuffle, so a board looks the same every time it is generated.
 *  Scenery placed with `Math.random()` moves on every `npm run scene`, which
 *  makes yesterday's screenshot a lie. */
function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/** Where a gate sits and which way it faces, from the wall it is set into. */
function gatePlacement(g) {
  const D = 6.6;
  if (g.wall === 'w') return { x: -D, z: g.at, yaw: Math.PI / 2, axis: 'z' };
  if (g.wall === 'e') return { x: D, z: g.at, yaw: -Math.PI / 2, axis: 'z' };
  if (g.wall === 'n') return { x: g.at, z: -D, yaw: 0, axis: 'x' };
  return { x: g.at, z: D, yaw: Math.PI, axis: 'x' };
}

// ─────────────────────────────────────────────────────────────────────────────

function buildLevel(def) {
  const t = THEMES[def.theme];
  const entities = [];
  const add = (e) => entities.push(e);

  // One full walk per gate, trunk included, so the game can follow a route
  // without knowing that it shares its first cells with the other one.
  const trunk = expand(def.trunk);
  const routes = def.branches.map((b) => trunk.concat(expand(b).slice(1)));

  const cells = [];
  const onPath = new Set();
  for (const r of routes) for (const c of r) {
    if (onPath.has(key(c))) continue;
    onPath.add(key(c));
    cells.push(c);
  }
  const SPAWN = key(routes[0][0]);
  const ENDS = new Set(routes.map((r) => key(r[r.length - 1])));

  // --- the board ---
  //
  // The tiles ARE the ground. Laying them ON a ground plane and sinking them
  // flush buries them: the first version left 0.01 of a 0.2-thick tile showing
  // and the road read as a few faint scratches. Raising them instead makes a
  // 0.2 lip the character cannot climb (stepHeight is 0.17). So the whole board
  // is tiles, their tops at y=0, with one collision box underneath.
  add({
    id: 'ground', name: 'ground',
    primitive: { kind: 'box', size: { x: 13, y: 0.4, z: 13 }, color: t.skirt },
    transform: { position: { x: 0, y: GROUND_Y - 0.4, z: 0 } },
    castShadow: false,
    collider: {
      shape: { kind: 'box', halfExtents: { x: 6.5, y: 0.3, z: 6.5 } },
      body: 'fixed', offset: { x: 0, y: 0.1, z: 0 },
    },
  });

  // --- build spots: every cell orthogonally next to the road ---
  const spots = [];
  const spotSet = new Set();
  for (const c of cells) {
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const n = [c[0] + dx, c[1] + dz];
      if (onPath.has(key(n)) || spotSet.has(key(n))) continue;
      if (Math.abs(n[0]) > HALF || Math.abs(n[1]) > HALF) continue;
      spotSet.add(key(n));
      spots.push(n);
    }
  }

  // --- scenery, then plain ground for whatever is left ---
  //
  // Trees and rocks come as TILES in this kit, so a wooded corner costs the
  // same as bare ground. They go on the outer ring only: scenery in the middle
  // of the field is scenery the hero has to walk around on the way to a tower,
  // and a board that reads as rich is not worth a board that fights you.
  const rand = rng(def.scenerySeed);
  const sceneryAt = new Map();
  for (let gx = -HALF; gx <= HALF; gx += 1) {
    for (let gz = -HALF; gz <= HALF; gz += 1) {
      const k = key([gx, gz]);
      if (onPath.has(k) || spotSet.has(k)) continue;
      const onRing = Math.abs(gx) === HALF || Math.abs(gz) === HALF;
      if (!onRing || rand() > 0.5) continue;
      sceneryAt.set(k, t.scenery[Math.floor(rand() * t.scenery.length)]);
    }
  }

  for (let gx = -HALF; gx <= HALF; gx += 1) {
    for (let gz = -HALF; gz <= HALF; gz += 1) {
      const k = key([gx, gz]);
      if (onPath.has(k)) continue;
      const decorated = sceneryAt.has(k);
      const e = {
        id: `ground_${gx}_${gz}`.replace(/[.-]/g, '_'),
        name: decorated ? 'scenery' : 'ground_tile',
        modelAssetId: decorated ? sceneryAt.get(k) : t.tile,
        transform: {
          position: { x: gx, y: GROUND_Y - TILE_TOP, z: gz },
          rotation: yaw(Math.floor(rand() * 4) * (Math.PI / 2)),
        },
        // Flat ground casting onto flat ground draws nothing anyone can see and
        // costs a second full draw of the mesh every frame. Scenery is not flat.
        castShadow: decorated,
      };
      if (decorated) {
        // Solid, or the hero walks through the trunk of a tree. A thin post is
        // enough: the point is that it reads as an obstacle, not that the
        // collider is shaped like one.
        e.collider = {
          shape: { kind: 'box', halfExtents: { x: 0.34, y: 0.5, z: 0.34 } },
          body: 'fixed', offset: { x: 0, y: 0.5, z: 0 },
        };
      }
      add(e);
    }
  }

  // --- where they come from ---
  //
  // The spawn tile is where every wave walks out of, and nothing marked it. A
  // portal on it answers "which end is which" from across the board, which is
  // the first question anyone asks on a board they have not played.
  add({
    id: 'spawn_portal', name: 'spawn_portal', modelAssetId: t.portal,
    transform: { position: { x: routes[0][0][0], y: GROUND_Y + 0.01, z: routes[0][0][1] } },
    castShadow: false,
  });

  // --- props, standing ON the plain ring tiles ---
  //
  // Scenery tiles carry their own tree; these are the loose things beside them.
  // Ring only, same as the scenery, and never where a crate could land.
  {
    const ringPlain = [];
    for (let gx = -HALF; gx <= HALF; gx += 1) {
      for (let gz = -HALF; gz <= HALF; gz += 1) {
        const k = key([gx, gz]);
        if (onPath.has(k) || spotSet.has(k) || sceneryAt.has(k)) continue;
        if (Math.abs(gx) !== HALF && Math.abs(gz) !== HALF) continue;
        ringPlain.push([gx, gz]);
      }
    }
    for (const [gx, gz] of ringPlain) {
      if (rand() > 0.4) continue;
      const model = t.props[Math.floor(rand() * t.props.length)];
      add({
        id: `prop_${gx}_${gz}`.replace(/[.-]/g, '_'), name: 'prop', modelAssetId: model,
        transform: {
          position: { x: gx + (rand() - 0.5) * 0.3, y: GROUND_Y, z: gz + (rand() - 0.5) * 0.3 },
          rotation: yaw(rand() * Math.PI * 2),
        },
      });
    }
  }

  // --- the road ---
  for (let i = 0; i < cells.length; i++) {
    const c = cells[i];
    const nb = [[1, 0], [-1, 0], [0, 1], [0, -1]]
      .map(([dx, dz]) => [c[0] + dx, c[1] + dz])
      .filter((n) => onPath.has(key(n)));
    const { model, rot } = tileFor(def.theme, c, nb, key(c) === SPAWN, ENDS.has(key(c)));
    add({
      id: `path_${i}`, name: `path_${i}`, modelAssetId: model, castShadow: false,
      // Sunk so the tiles' TOP is the walkable surface — laid ON the ground they
      // would be a 0.2 step the character cannot climb (stepHeight is 0.17).
      transform: { position: { x: c[0], y: GROUND_Y - TILE_TOP, z: c[1] }, rotation: rot },
    });
  }

  // --- walls, with a doorway where each gate goes ---
  //
  // A gap exactly one door wide, filled by a SHUT door carrying its own
  // collider. Not a door pasted on a solid wall, and not a hole with an
  // invisible collider across it: the ground is 13x13 and stops, so a real hole
  // is a fall out of the world. A shut gate is honest about all of it — the
  // enemies are trying to break in, and a shut door is shut for everyone.
  //
  // The north wall also carries the player's EXIT, which opens when the run
  // ends, so it always has a gap in the middle whether or not a gate is there.
  const gaps = { n: [[0, 0.6]], s: [], w: [], e: [] };
  for (const g of def.gates) gaps[g.wall].push([g.at, 0.5]);

  /** One wall, minus its doorways. */
  const wallRun = (side) => {
    const holes = [...gaps[side]].sort((a, b) => a[0] - b[0]);
    const pieces = [];
    let from = -6.7;
    for (const [centre, half] of holes) {
      if (centre - half > from) pieces.push([from, centre - half]);
      from = Math.max(from, centre + half);
    }
    if (from < 6.7) pieces.push([from, 6.7]);
    return pieces;
  };
  for (const side of ['n', 's', 'w', 'e']) {
    const along = side === 'n' || side === 's' ? 'x' : 'z';
    const fixed = side === 'n' || side === 'w' ? -6.6 : 6.6;
    wallRun(side).forEach(([a, b], i) => {
      const mid = (a + b) / 2, len = b - a;
      add({
        id: `wall_${side}${i}`, name: `wall_${side}${i}`,
        primitive: {
          kind: 'box',
          size: along === 'x' ? { x: len, y: 1.2, z: 0.4 } : { x: 0.4, y: 1.2, z: len },
          color: t.wall,
        },
        transform: {
          position: along === 'x' ? { x: mid, y: 0.4, z: fixed } : { x: fixed, y: 0.4, z: mid },
        },
        collider: {
          shape: {
            kind: 'box',
            halfExtents: along === 'x'
              ? { x: len / 2, y: 0.6, z: 0.2 } : { x: 0.2, y: 0.6, z: len / 2 },
          },
          body: 'fixed',
        },
      });
    });
  }

  // The exit doorway's own filler, so the gap is not a hole until it opens.
  add({
    id: 'exit_block', name: 'exit_block',
    primitive: { kind: 'box', size: { x: 1.2, y: 1.2, z: 0.4 }, color: t.wall },
    transform: { position: { x: 0, y: 0.4, z: -6.6 } },
    collider: {
      shape: { kind: 'box', halfExtents: { x: 0.6, y: 0.6, z: 0.2 } }, body: 'fixed',
    },
  });

  def.gates.map(gatePlacement).forEach((pl, i) => {
    add({
      id: def.gates[i].id, name: 'gate', modelAssetId: 'hub-door',
      transform: { position: { x: pl.x, y: GROUND_Y, z: pl.z }, rotation: yaw(pl.yaw) },
      collider: {
        shape: {
          kind: 'box',
          halfExtents: pl.axis === 'z'
            ? { x: 0.2, y: 0.6, z: 0.5 } : { x: 0.5, y: 0.6, z: 0.2 },
        },
        body: 'fixed', offset: { x: 0, y: 0.4, z: 0 },
      },
    });
  });

  // ONE selection marker, moved to whatever the player is standing on. Drawing
  // all seventy of them turned the board into a grid of orange brackets with
  // the game somewhere underneath — the kit's selection ring is a cursor, not a
  // legend.
  add({
    id: 'build_marker', name: 'build_marker', modelAssetId: 'td-selection',
    transform: { position: { x: 0, y: GROUND_Y + 0.02, z: 0 } },
  });

  // --- the way out ---
  //
  // Hidden until the run ends: a door standing open the whole time would read
  // as somewhere you could go, and there is nothing behind it yet.
  add({
    id: 'exit_door', name: 'exit_door', modelAssetId: 'hub-door-open',
    transform: { position: { x: 0, y: GROUND_Y, z: -6.6 } },
    visible: false,
  });
  add({
    id: 'exit_frame', name: 'exit_frame',
    primitive: { kind: 'box', size: { x: 1.35, y: 1.4, z: 0.22 }, color: '#6b4f2a' },
    transform: { position: { x: 0, y: 0.5, z: -6.78 } },
    visible: false,
  });

  // --- the hero ---
  //
  // Dropped just inside the exit door, which is where they walked in.
  add({
    id: 'hero', name: 'hero', modelAssetId: 'hero',
    transform: { position: { x: 0, y: GROUND_Y, z: -5.0 } },
    // Declaring a starting clip is what creates the MIXER, and without a mixer
    // there is no CharacterAnimator and the hero never moves a limb — silently,
    // with the model rendering and sliding around exactly as if it were fine.
    animation: { play: 'idle', loop: true },
  });

  const scene = {
    schemaVersion: 1,
    id: def.id,
    name: def.name,
    environment: { background: t.sky },
    gravity: { x: 0, y: -4.1692, z: 0 },
    lights: [
      { id: 'sky', kind: 'hemisphere', color: '#ffffff', groundColor: t.ground,
        intensity: t.skyIntensity },
      { id: 'sun', kind: 'directional', color: t.sun, intensity: t.sunIntensity,
        position: { x: 4, y: 8, z: 5 }, castShadow: true },
    ],
    camera: { kind: 'follow', target: 'hero', fov: 55, offset: { x: 0, y: 5.2, z: 6.4 } },
    entities,
  };

  // The waypoints the game walks enemies along — the same polylines the tiles
  // were laid from, so the road you SEE and the road they FOLLOW cannot drift
  // apart. `scenery` goes with them so the crates know where not to land.
  const path = {
    routes, cells, spots,
    scenery: [...sceneryAt.keys()].map((k) => k.split(',').map(Number)),
    gates: def.gates.map((g) => g.id),
  };
  return { scene, path };
}

for (const def of LEVELS) {
  const { scene, path } = buildLevel(def);
  writeFileSync(new URL(`../public/scenes3d/${def.id}.json`, import.meta.url),
    JSON.stringify(scene, null, 2) + '\n');
  writeFileSync(new URL(`../public/scenes3d/${def.id}-path.json`, import.meta.url),
    JSON.stringify(path, null, 2) + '\n');
  console.log(`${def.id.padEnd(12)} ${String(scene.entities.length).padStart(4)} entities · `
    + `${path.cells.length} road · ${path.spots.length} spots · ${path.scenery.length} scenery · `
    + `routes ${path.routes.map((r) => r.length).join('/')}`);
}

// ─────────────────────────────────────────────────────────────────────────────
// The hub: where a run starts.
//
// Smaller than the board, with a door at the far end, a sign that shows the
// leaderboard, and the game's name built out of cubes. Same generator because
// it is the same kind of data — a grid of tiles and a handful of props.

/** A 5x7 blocky font, in the only letters "BALABOO" needs.
 *
 *  There is no text model anywhere in the asset library and three's
 *  TextGeometry needs a typeface file we do not ship. Cubes are the house
 *  style anyway: every other thing on screen is a low-poly block, and a
 *  smooth extruded serif would look like it wandered in from another game. */
const GLYPHS = {
  B: ['1110', '1001', '1001', '1110', '1001', '1001', '1110'],
  A: ['0110', '1001', '1001', '1111', '1001', '1001', '1001'],
  L: ['1000', '1000', '1000', '1000', '1000', '1000', '1111'],
  O: ['0110', '1001', '1001', '1001', '1001', '1001', '0110'],
};
const TITLE = 'BALABOO';

function titleEntities(originX, originY, originZ, cell = 0.14) {
  const out = [];
  const gap = cell;                       // one blank column between letters
  let width = 0;
  for (const ch of TITLE) width += GLYPHS[ch][0].length * cell + gap;
  let x = originX - (width - gap) / 2;
  for (const [li, ch] of [...TITLE].entries()) {
    const rows = GLYPHS[ch];
    for (let r = 0; r < rows.length; r++) {
      for (let c = 0; c < rows[r].length; c++) {
        if (rows[r][c] !== '1') continue;
        out.push({
          id: `title_${li}_${r}_${c}`,
          name: 'title',
          primitive: { kind: 'box', size: { x: cell, y: cell, z: cell }, color: '#f4b942' },
          transform: {
            position: {
              x: x + c * cell,
              y: originY + (rows.length - 1 - r) * cell,
              z: originZ,
            },
          },
          castShadow: false,
        });
      }
    }
    x += rows[0].length * cell + gap;
  }
  return out;
}

function buildHub() {
  const ents = [];
  const HALF = 4.5;               // a 9x9 board

  ents.push({
    id: 'ground', name: 'ground',
    primitive: { kind: 'box', size: { x: 2 * HALF + 1, y: 0.4, z: 2 * HALF + 1 }, color: '#3f6b38' },
    transform: { position: { x: 0, y: GROUND_Y - 0.4, z: 0 } },
    collider: {
      shape: { kind: 'box', halfExtents: { x: HALF + 0.5, y: 0.3, z: HALF + 0.5 } },
      body: 'fixed', offset: { x: 0, y: 0.1, z: 0 },
    },
    castShadow: false,
  });

  for (let gx = -HALF + 0.5; gx <= HALF - 0.5; gx += 1) {
    for (let gz = -HALF + 0.5; gz <= HALF - 0.5; gz += 1) {
      ents.push({
        id: `hgrass_${gx}_${gz}`.replace(/[.-]/g, '_'), name: 'grass', modelAssetId: 'td-tile',
        transform: { position: { x: gx, y: GROUND_Y - TILE_TOP, z: gz } },
        castShadow: false,
      });
    }
  }

  // One doorway per level, along the front wall.
  //
  // A door you can see from where you spawn is the level select: no menu, no
  // list, walk at the one you want. Locked ones are SHUT and stay shut, which
  // is the same rule the gates on the boards follow — a shut door is shut.
  const DOOR_X = LEVELS.map((_, i) => (i - (LEVELS.length - 1) / 2) * 3.4);
  const gaps = DOOR_X.map((x) => [x - 0.7, x + 0.7]).sort((a, b) => a[0] - b[0]);
  const frontPieces = [];
  {
    let from = -HALF - 0.7;
    for (const [a, b] of gaps) {
      if (a > from) frontPieces.push([from, a]);
      from = Math.max(from, b);
    }
    if (from < HALF + 0.7) frontPieces.push([from, HALF + 0.7]);
  }
  const walls = [
    ['hwall_s', 0, HALF + 0.6, 2 * HALF + 1.4, 0.4],
    ['hwall_w', -HALF - 0.6, 0, 0.4, 2 * HALF + 1.4],
    ['hwall_e', HALF + 0.6, 0, 0.4, 2 * HALF + 1.4],
  ];
  frontPieces.forEach(([a, b], i) => {
    walls.push([`hwall_n${i}`, (a + b) / 2, -HALF - 0.6, b - a, 0.4]);
  });
  for (const [id, x, z, sx, sz] of walls) {
    ents.push({
      id, name: id,
      primitive: { kind: 'box', size: { x: sx, y: 1.2, z: sz }, color: '#4a4036' },
      transform: { position: { x, y: 0.4, z } },
      collider: { shape: { kind: 'box', halfExtents: { x: sx / 2, y: 0.6, z: sz / 2 } }, body: 'fixed' },
    });
  }

  // Two doors per slot, in the same place: the open one and the shut one. The
  // game shows whichever matches your progress — swapping a model at runtime
  // means loading it at runtime, and a door that pops in a second after the
  // hub does reads as a glitch.
  LEVELS.forEach((lv, i) => {
    const x = DOOR_X[i];
    ents.push({
      id: `door_${lv.id}`, name: 'door', modelAssetId: 'hub-door-open',
      transform: { position: { x, y: GROUND_Y, z: -HALF - 0.6 } },
      visible: false,
    });
    ents.push({
      id: `door_${lv.id}_shut`, name: 'door_shut', modelAssetId: 'hub-door',
      transform: { position: { x, y: GROUND_Y, z: -HALF - 0.6 } },
      visible: false,
      collider: {
        shape: { kind: 'box', halfExtents: { x: 0.5, y: 0.6, z: 0.2 } },
        body: 'fixed', offset: { x: 0, y: 0.4, z: 0 },
      },
    });
    ents.push({
      id: `door_${lv.id}_frame`, name: 'door_frame',
      primitive: { kind: 'box', size: { x: 1.35, y: 1.4, z: 0.22 }, color: '#6b4f2a' },
      transform: { position: { x, y: 0.5, z: -HALF - 0.78 } },
    });
    // A signpost beside each, so a door is a PLACE with a name rather than one
    // of three identical holes in a wall.
    ents.push({
      id: `door_${lv.id}_sign`, name: 'door_sign', modelAssetId: 'hub-sign',
      transform: { position: { x: x + 0.95, y: GROUND_Y, z: -HALF + 0.15 } },
    });
  });

  // --- the town ---
  //
  // Four plots. Every level's building is placed and hidden; the hub shows the
  // one you own. Swapping a model at runtime means loading it at runtime, and a
  // building that pops in a second after the hub does reads as a glitch.
  // The hub is a 9x9 board with its walls at +/-5.1 — NOT the 13x13 the levels
  // use. The first layout put these at +/-4.2 with a 1.9 foundation, which ran
  // the plots into the wall and the buildings through it.
  const TOWN = [
    { id: 'smithy', x: -3.5, z: -1.6, yaw: Math.PI / 2,
      models: ['bld-house-a', 'bld-house-b', 'bld-house-c'] },
    { id: 'clinic', x: -3.5, z: 2.2, yaw: Math.PI / 2,
      models: ['town-stall-red', 'bld-house-a', 'bld-house-b'] },
    { id: 'market', x: 3.5, z: -1.6, yaw: -Math.PI / 2,
      models: ['town-stall-green', 'town-cart', 'town-watermill'] },
    { id: 'range', x: 3.5, z: 2.2, yaw: -Math.PI / 2,
      models: ['bld-tower-a', 'bld-tower-b', 'town-windmill'] },
  ];
  for (const b of TOWN) {
    // A foundation, so an empty plot is obviously a PLOT and not a patch of
    // grass someone forgot. It stays under the building once there is one.
    ents.push({
      id: `plot_${b.id}`, name: 'plot',
      primitive: { kind: 'box', size: { x: 1.8, y: 0.14, z: 1.8 }, color: '#9a8f7d' },
      transform: { position: { x: b.x, y: GROUND_Y + 0.07, z: b.z } },
      castShadow: false,
    });
    // A signpost, like the ones beside the doors. A bare rectangle on the grass
    // reads as a mud patch; a rectangle with a sign beside it reads as a plot.
    ents.push({
      id: `plot_${b.id}_sign`, name: 'plot_sign', modelAssetId: 'hub-sign',
      transform: {
        position: { x: b.x + (b.x < 0 ? 1.2 : -1.2), y: GROUND_Y, z: b.z - 0.85 },
        rotation: yaw(b.x < 0 ? -Math.PI / 2 : Math.PI / 2),
      },
    });
    ents.push({
      id: `plot_${b.id}_lantern`, name: 'plot_lantern', modelAssetId: 'town-lantern',
      transform: { position: { x: b.x + (b.x < 0 ? 1.1 : -1.1), y: GROUND_Y + 0.14, z: b.z + 0.85 } },
    });
    ents.push({
      id: `plot_${b.id}_marker`, name: 'plot_marker', modelAssetId: 'td-selection',
      transform: { position: { x: b.x, y: GROUND_Y + 0.14, z: b.z } },
      visible: false,
    });
    b.models.forEach((m, i) => {
      ents.push({
        id: `town_${b.id}_${i + 1}`, name: 'town_building', modelAssetId: m,
        transform: { position: { x: b.x, y: GROUND_Y + 0.12, z: b.z }, rotation: yaw(b.yaw) },
        visible: false,
        // Solid once it is there — a house you can walk through is scenery.
        collider: {
          shape: { kind: 'box', halfExtents: { x: 0.55, y: 0.7, z: 0.55 } },
          body: 'fixed', offset: { x: 0, y: 0.7, z: 0 },
        },
      });
    });
  }

  // The sign, and the ring that says you can do something here.
  ents.push({
    id: 'sign', name: 'sign', modelAssetId: 'hub-sign',
    transform: { position: { x: 0, y: GROUND_Y, z: 3.6 } },
  });
  ents.push({
    id: 'sign_marker', name: 'sign_marker', modelAssetId: 'td-selection',
    transform: { position: { x: 0, y: GROUND_Y + 0.02, z: 3.6 } },
    visible: false,
  });

  ents.push(...titleEntities(0, 1.35, -HALF - 0.3));

  // Scenery, off the walking line between spawn and door.
  const props = [
    ['td-tree', -3.5, -2.5], ['td-tree', 3.5, -2.5], ['td-tree', -3.5, 3.5],
    ['td-rocks', 3.5, 3.5], ['td-crystal', 2.5, -3.5], ['td-rocks', -2.5, -3.5],
    ['hub-crate', 2.5, 1.5], ['hub-crate', 3.2, 1.5], ['hub-crate', 2.85, 1.5],
    ['hub-barrel', 1.6, 2.6], ['hub-barrel', -1.6, -2.6],
  ];
  for (const [i, [m, x, z]] of props.entries()) {
    ents.push({
      id: `hprop_${i}`, name: 'prop', modelAssetId: m,
      transform: { position: { x, y: m === 'hub-crate' ? (i === 8 ? 0.5 : 0) : 0, z } },
    });
  }

  // Three weapons on the ground, each on its own pedestal. Standing at one and
  // pressing the action button takes it — the same verb as building a tower
  // and reading the sign, so the hub teaches the level's only interaction.
  const PICKUPS = [
    ['sword', -1.4, 0.2],
    ['bow', 0, 0.2],
    ['staff', 1.4, 0.2],
  ];
  for (const [id, x, z] of PICKUPS) {
    ents.push({
      id: `pedestal_${id}`, name: 'pedestal',
      primitive: { kind: 'cylinder', size: { x: 0.46, y: 0.22, z: 0.46 }, color: '#6f6a5c' },
      transform: { position: { x, y: GROUND_Y + 0.11, z } },
    });
    ents.push({
      id: `pickup_marker_${id}`, name: 'pickup_marker', modelAssetId: 'td-selection',
      transform: { position: { x, y: GROUND_Y + 0.02, z } },
      visible: false,
    });
  }

  ents.push({
    id: 'hero', name: 'hero', modelAssetId: 'hero',
    transform: { position: { x: 0, y: GROUND_Y, z: 1.9 } },
    animation: { play: 'idle', loop: true },
  });

  return {
    schemaVersion: 1,
    id: 'hub',
    name: 'Balaboo',
    environment: { background: '#9fd4ef' },
    gravity: { x: 0, y: -4.1692, z: 0 },
    lights: [
      { id: 'sky', kind: 'hemisphere', color: '#ffffff', groundColor: '#8fa08a', intensity: 2.1 },
      { id: 'sun', kind: 'directional', color: '#fff6e0', intensity: 2.1,
        position: { x: 3, y: 7, z: 4 }, castShadow: true },
    ],
    camera: { kind: 'follow', target: 'hero', fov: 55, offset: { x: 0, y: 3.6, z: 4.6 } },
    entities: ents,
  };
}

writeFileSync(new URL('../public/scenes3d/hub.json', import.meta.url),
  JSON.stringify(buildHub(), null, 2) + '\n');
console.log(`hub: ${buildHub().entities.length} entities`);
