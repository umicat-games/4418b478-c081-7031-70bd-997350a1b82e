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
// Each is a trunk polyline plus a branch to each gate. A board with TWO
// branches forks: a single lane can be sealed with four good towers and the
// rest of the map is decoration, and with two the question becomes which half
// you can afford to leave thin.
//
// **The first two boards do not fork.** Every board used to, including the
// first one anybody plays — so the game's second-hardest idea arrived before
// its first one had been explained. Each board now introduces exactly one new
// thing: Meadow is the tutorial and has a single lane, Frostfall adds ice and
// keeps the single lane, Rivermeet adds the fork, and Crossroads puts the fork
// on OPPOSITE walls, which is the hardest version of it.
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
    // Shifted a row south of where it started. The top run used to be at
    // z=-4.5 and the door drops the hero in at z=-5.0, which put arrival half a
    // tile from the lane and inside everything's range — the whole north strip
    // was, so no spawn point could fix it. Same shape, one row down.
    // ONE lane, one gate. This is the board the game is learned on, and it
    // used to fork like all the others — which meant the first thing a new
    // player met was the mechanic that exists to make a veteran choose.
    // Longer than it looks it needs to be, on purpose. Dropping the fork took
    // six cells off the road, and road length IS exposure — the same wave table
    // that had been won with eight lives left lost on wave four, because every
    // saucer now spent a sixth less time in front of the guns. Wound back up to
    // 37 cells, which is a shade more than the two branches added together.
    //
    // The top run stays at z=-3.5 and does NOT go to -4.5: the door drops the
    // hero in at z=-5.0, and a lane one tile from the arrival point puts you
    // inside everything's range before you have moved.
    trunk: [[-5.5, -3.5], [4.5, -3.5], [4.5, -0.5], [-4.5, -0.5],
            [-4.5, 2.5], [2.5, 2.5], [2.5, 4.5], [0.5, 4.5]],
    branches: [[[0.5, 4.5], [0.5, 5.5]]],
    gates: [{ id: 'gate_s', wall: 's', at: 0.5 }],
    scenerySeed: 11,
  },
  {
    id: 'frostfall',
    name: 'Frostfall',
    theme: 'snow',
    // Still one lane — the new thing here is the GROUND. It is ice: you cannot
    // turn sharply and you overshoot, and learning that while also being asked
    // which half of a fork to abandon is two lessons at once.
    // Wound out to 38 cells for the same reason Meadow was: losing the fork
    // lost road, and road length is how long a saucer spends in front of a gun.
    //
    // Three measured points, because the obvious next guess was wrong. At 25
    // cells the base fell on wave six. At 38 it reached wave NINE with twelve
    // of twelve lives — which looked like a board that had stopped asking
    // anything of the towers, so the road was pulled back to 33. That made it
    // sharply WORSE: wave six again, and leaking from wave three. Fewer cells
    // is not a gentler version of more cells; it is fewer guns that can see the
    // same saucer, and the falloff is not linear. 38 stands.
    //
    // The hero arrives at (0, -5) on every board. Nothing here runs closer to
    // that than two and a half cells.
    trunk: [[-5.5, 4.5], [3.5, 4.5], [3.5, 1.5], [-4.5, 1.5], [-4.5, -1.5],
            [4.5, -1.5], [4.5, -3.5], [2.5, -3.5]],
    branches: [[[2.5, -3.5], [2.5, -5.5]]],
    gates: [{ id: 'gate_n', wall: 'n', at: 2.5 }],
    scenerySeed: 29,
  },
  {
    id: 'rivermeet',
    name: 'Rivermeet',
    theme: 'grass',
    // Where the road FORKS, and where the river is. The saucers fly, so the
    // river is not in their way at all — it is in yours. Three bridges, and
    // whichever half of the board you are on, getting to the other one costs
    // the walk to a crossing. It is the sharpest version of the thing this
    // game is about, which is why it is the third board and not the first.
    trunk: [[-5.5, -4.5], [3.5, -4.5], [3.5, -2.5], [0.5, -2.5], [0.5, 3.5]],
    branches: [[[0.5, 3.5], [-5.5, 3.5]], [[0.5, 3.5], [5.5, 3.5]]],
    gates: [{ id: 'gate_w', wall: 'w', at: 3.5 }, { id: 'gate_e', wall: 'e', at: 3.5 }],
    river: { z: 0.5, bridges: [-3.5, 0.5, 4.5] },
    scenerySeed: 73,
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

  // The river, if this board has one. `blocked` is what the hero cannot cross;
  // `bridges` is where they can. The saucers ignore both — they fly.
  const river = def.river ?? null;
  const isRiver = (x, z) => river !== null && z === river.z;
  const isBridge = (x, z) => isRiver(x, z) && river.bridges.includes(x);
  const blocked = [];

  // --- the board ---
  //
  // The tiles ARE the ground. Laying them ON a ground plane and sinking them
  // flush buries them: the first version left 0.01 of a 0.2-thick tile showing
  // and the road read as a few faint scratches. Raising them instead makes a
  // 0.2 lip the character cannot climb (stepHeight is 0.17). So the whole board
  // is tiles, their tops at y=0, with one collision box underneath.
  add({
    id: 'ground', name: 'ground',
    // Invisible: `ground_skirt` is the one you see, and it is bigger. This one
    // is here for its COLLIDER — the floor of the playable board.
    primitive: { kind: 'box', size: { x: 13, y: 0.4, z: 13 }, color: t.skirt },
    visible: false,
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
      // Nothing gets built in the water.
      if (isRiver(n[0], n[1])) continue;
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
      if (onPath.has(k) || spotSet.has(k) || isRiver(gx, gz)) continue;
      const onRing = Math.abs(gx) === HALF || Math.abs(gz) === HALF;
      if (!onRing || rand() > 0.5) continue;
      sceneryAt.set(k, t.scenery[Math.floor(rand() * t.scenery.length)]);
    }
  }

  for (let gx = -HALF; gx <= HALF; gx += 1) {
    for (let gz = -HALF; gz <= HALF; gz += 1) {
      const k = key([gx, gz]);
      if (onPath.has(k)) continue;
      if (isRiver(gx, gz)) {
        // Water, or a bridge over it. The river tile is 0.25 deep and the
        // bridge sits on top of it, so both go down at the same height as any
        // other tile and the surface still lines up.
        const bridge = isBridge(gx, gz);
        const e = {
          id: `river_${gx}_${gz}`.replace(/[.-]/g, '_'),
          name: bridge ? 'bridge' : 'river',
          modelAssetId: bridge ? t.river.bridge : t.river.straight,
          transform: {
            position: { x: gx, y: GROUND_Y - TILE_TOP, z: gz },
            // The straight tile's channel runs along Z at yaw 0, same as the
            // road's stripe — read off the model, not guessed.
            rotation: yaw(Math.PI / 2),
          },
          castShadow: false,
        };
        if (!bridge) {
          // A wall you can see the point of. The hero is stopped; the saucers
          // are not, because they were never on the ground.
          e.collider = {
            shape: { kind: 'box', halfExtents: { x: 0.5, y: 0.5, z: 0.5 } },
            body: 'fixed', offset: { x: 0, y: 0.45, z: 0 },
          };
          blocked.push([gx, gz]);
        }
        add(e);
        continue;
      }
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
        if (onPath.has(k) || spotSet.has(k) || sceneryAt.has(k) || isRiver(gx, gz)) continue;
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
    let { model, rot } = tileFor(def.theme, c, nb, key(c) === SPAWN, ENDS.has(key(c)));
    if (isRiver(c[0], c[1])) {
      // Where the road meets the water it is a bridge, whatever the road would
      // otherwise have been.
      model = t.river.bridge;
      rot = yaw(Math.PI / 2);
    }
    add({
      id: `path_${i}`, name: `path_${i}`, modelAssetId: model, castShadow: false,
      // Sunk so the tiles' TOP is the walkable surface — laid ON the ground they
      // would be a 0.2 step the character cannot climb (stepHeight is 0.17).
      transform: { position: { x: c[0], y: GROUND_Y - TILE_TOP, z: c[1] }, rotation: rot },
    });
  }

  // The water itself. The kit's river tile is SOLID — the water is painted into
  // its channel by the colormap — and a 5cm trench catches no light at all, so
  // the river read as a black crack across the board. A slab of blue sitting in
  // the channel is what makes it a river.
  if (river) {
    add({
      id: 'water', name: 'water',
      primitive: { kind: 'box', size: { x: 2 * HALF + 1, y: 0.04, z: 0.72 }, color: '#4fa8d8' },
      transform: { position: { x: 0, y: GROUND_Y - 0.06, z: river.z } },
      castShadow: false,
    });
  }

  // --- the forest, and the air wall inside it ---
  //
  // The board used to end in a chest-high box of a wall with sky behind it,
  // which is what an unfinished level looks like. Now the ground keeps going
  // for five more cells in every direction and fills with trees, and the thing
  // that actually stops you is an invisible collider where the wall used to be
  // — the ordinary way a forest edge is done, because a tree line built to seal
  // perfectly is a fence with leaves on.
  //
  // None of it costs a draw call: it merges into the same one mesh per material
  // as the rest of the board. It does cost TRIANGLES, so the forest casts no
  // shadow — it is outside the play area and nobody is looking at its shadows,
  // and the shadow pass is where a phone actually notices geometry.
  // Seven rings, not five. At five you could see past the tree line to open sky
  // at the corners, which is the same "unfinished level" the wall used to be.
  const FOREST_OUT = 7;
  const OUTER = HALF + FOREST_OUT;

  // The ground goes with it, or the trees stand on nothing.
  add({
    id: 'ground_skirt', name: 'ground_skirt',
    primitive: { kind: 'box', size: { x: 2 * OUTER + 1, y: 0.4, z: 2 * OUTER + 1 }, color: t.skirt },
    transform: { position: { x: 0, y: GROUND_Y - 0.4, z: 0 } },
    castShadow: false,
  });
  for (let gx = -OUTER; gx <= OUTER; gx += 1) {
    for (let gz = -OUTER; gz <= OUTER; gz += 1) {
      if (Math.abs(gx) <= HALF && Math.abs(gz) <= HALF) continue;
      add({
        id: `outer_${gx}_${gz}`.replace(/[.-]/g, '_'), name: 'forest_ground',
        modelAssetId: t.tile,
        transform: {
          position: { x: gx, y: GROUND_Y - TILE_TOP, z: gz },
          rotation: yaw(Math.floor(rand() * 4) * (Math.PI / 2)),
        },
        castShadow: false,
      });
    }
  }

  // Where a gate or the exit stands, leave the tree line open — a door you
  // cannot see from the board is a door nobody finds.
  const openings = [{ x: 0, z: -6.6 }, ...def.gates.map(gatePlacement)];
  const nearOpening = (x, z) => openings.some((o) => Math.hypot(o.x - x, o.z - z) < 2.4);

  for (let gx = -OUTER; gx <= OUTER; gx += 1) {
    for (let gz = -OUTER; gz <= OUTER; gz += 1) {
      const outside = Math.abs(gx) > HALF || Math.abs(gz) > HALF;
      if (!outside) continue;
      if (nearOpening(gx, gz)) continue;
      // Denser further out, so the edge of the board reads as the edge of a
      // clearing rather than as a hedge.
      const depth = Math.max(Math.abs(gx), Math.abs(gz)) - HALF;
      // Thin at the clearing's edge, thick at the horizon — the far rings are
      // what you actually see, and they are the cheapest to fill because
      // nothing about them needs to line up with anything.
      // Thick from the first ring. Thin looked like a scattering of trees on a
      // lawn that happened to stop — the point of a tree line is that it reads
      // as the EDGE of somewhere, and half a dozen trees per side does not. The
      // first ring is the one doing that work, so it is the densest thing here
      // after the horizon.
      const chance = Math.min(0.96, 0.72 + depth * 0.05);
      const r = rand();
      const n = r < chance ? (r < chance * 0.45 ? 2 : 1) : 0;
      for (let k = 0; k < n; k++) {
        add({
          id: `forest_${gx}_${gz}_${k}`.replace(/[.-]/g, '_'),
          // The MIDDLE rings are their own thing so the picture-quality toggle
          // can drop them — half the triangles on the board, and the rings
          // nobody stands next to. The outermost one always stays: it is what
          // hides the edge of the ground against the sky, and dropping it
          // traded a frame for a visible seam.
          name: depth >= 4 && depth < FOREST_OUT ? 'forest_far' : 'forest',
          modelAssetId: rand() < 0.22 ? t.props[1] : t.props[0],
          transform: {
            position: {
              x: gx + (rand() - 0.5) * 0.75,
              y: GROUND_Y,
              z: gz + (rand() - 0.5) * 0.75,
            },
            rotation: yaw(rand() * Math.PI * 2),
            scale: { x: 0.85 + rand() * 0.5, y: 0.85 + rand() * 0.55, z: 0.85 + rand() * 0.5 },
          },
          castShadow: false,
        });
      }
    }
  }

  // The air wall: the same rectangle the wall used to occupy, invisible. A
  // doorway is still a gap in it, because a gate you cannot walk up to is a
  // picture of a gate.
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
          size: along === 'x' ? { x: len, y: 1.6, z: 0.4 } : { x: 0.4, y: 1.6, z: len },
          color: t.wall,
        },
        visible: false,
        transform: {
          position: along === 'x' ? { x: mid, y: 0.6, z: fixed } : { x: fixed, y: 0.6, z: mid },
        },
        collider: {
          shape: {
            kind: 'box',
            halfExtents: along === 'x'
              ? { x: len / 2, y: 0.8, z: 0.2 } : { x: 0.2, y: 0.8, z: len / 2 },
          },
          body: 'fixed',
        },
      });
    });
  }

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

  // --- the hero ---
  //
  // Just inside the exit door, which is where they walked in — but nudged
  // sideways if the road runs past it. On Meadow the top of the road is at
  // z=-4.5 and the door is at z=-5.0, so arriving put the hero half a tile from
  // the lane and inside everything's firing range: standing still on arrival
  // cost six of eight hearts before the first tower was up. A player moves, but
  // being shot for the first second of a run is not a thing a player chose.
  // At the door. Picking a clearer spot instead put the hero in a far corner,
  // which makes the way in and the way out different places — and on Meadow the
  // whole north strip was inside enemy range anyway, so no spawn point fixed
  // it. The road moved a row south and arrival gets a few seconds of grace.
  const spawnZ = -5.0;
  const spawnX = 0;
  add({
    id: 'hero', name: 'hero', modelAssetId: 'hero',
    transform: { position: { x: spawnX, y: GROUND_Y, z: spawnZ } },
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
    routes, cells, spots, blocked,
    scenery: [...sceneryAt.keys()].map((k) => k.split(',').map(Number)),
    gates: def.gates.map((g) => g.id),
  };
  return { scene, path };
}

/** The arena.
 *
 *  Not a board in the tower-defense sense: there is no road, because nothing
 *  follows one. Enemies come in over the tree line on a straight line and
 *  leave over the other side, so every cell is a place the fight can happen
 *  and none of them is a lane.
 *
 *  **Nothing inside the air wall has a collider.** The whole game is walking
 *  out of the way of a bullet, and a tree at the edge of the field is a snag
 *  at exactly the moment a snag costs the most. `buildLevel` scatters scenery
 *  on the outer ring because a tower-defense hero walks between build spots at
 *  their own pace; this one is running. Everything with a trunk on it lives
 *  OUTSIDE the wall, where it is scenery and cannot be bumped into.
 */
function buildArena(def) {
  const t = THEMES[def.theme];
  const entities = [];
  const add = (e) => entities.push(e);
  const rand = rng(def.scenerySeed);
  // The arena is SMALLER than a tower-defense board, and has its own half-size
  // rather than borrowing the module's `HALF`.
  //
  // A tower defense board is big because the road has to be long: road length
  // is how much time a gun gets with what walks past it. Nothing walks a road
  // here. What the size decides instead is how long it takes to get out of the
  // way of something, and at 5.5 the far corner was four seconds away — long
  // enough that half the board was somewhere nothing was ever happening.
  // The playfield is a RECTANGLE, wider than it is deep.
  //
  // It was square, inherited from boards that were square because a road had
  // to wander around inside them. Nothing wanders here, and the screen this is
  // played on is landscape — so a square board is a board whose left and right
  // thirds are trees, and those thirds are paid for in ZOOM: the camera has to
  // sit back far enough to fit the width it is not using, and everything on
  // the board gets smaller for it.
  //
  // Matching the board's shape to the screen's is most of what makes the
  // pieces readable on a phone. It also takes the tree line off the sides,
  // where it was eating a third of the frame.
  const HX = def.half.x;
  const HZ = def.half.z;
  const WALL_X = HX + 1.1;   // same relation the generated boards use
  const WALL_Z = HZ + 1.1;
  const GROUND_X = 2 * HX + 2;
  const GROUND_Z = 2 * HZ + 2;

  // The floor of the playable field — invisible, here for its collider. Same
  // as every board: the tiles ARE the ground, with one box underneath them.
  add({
    id: 'ground', name: 'ground',
    primitive: { kind: 'box', size: { x: GROUND_X, y: 0.4, z: GROUND_Z }, color: t.skirt },
    visible: false,
    transform: { position: { x: 0, y: GROUND_Y - 0.4, z: 0 } },
    castShadow: false,
    collider: {
      shape: { kind: 'box', halfExtents: { x: GROUND_X / 2, y: 0.3, z: GROUND_Z / 2 } },
      body: 'fixed', offset: { x: 0, y: 0.1, z: 0 },
    },
  });

  // The field. Plain tiles, every cell, rotated at random so the texture does
  // not tile visibly. No scenery: see the note above.
  for (let gx = -HX; gx <= HX; gx += 1) {
    for (let gz = -HZ; gz <= HZ; gz += 1) {
      add({
        id: `ground_${gx}_${gz}`.replace(/[.-]/g, '_'), name: 'ground_tile',
        modelAssetId: t.tile,
        transform: {
          position: { x: gx, y: GROUND_Y - TILE_TOP, z: gz },
          rotation: yaw(Math.floor(rand() * 4) * (Math.PI / 2)),
        },
        castShadow: false,
      });
    }
  }

  // The forest, and the ground it stands on — the same treatment every board
  // gets, minus the openings. There is no door in this one: a run ends when the
  // health bar does, so a gap in the tree line would be a way out that is not
  // there.
  // The forest has to reach past the widest screen the fixed camera can show.
  //
  // The camera fits the BOARD to the viewport's height, so a wide screen shows
  // more to the left and right — which is the whole point, that is where the
  // trees go — and a very wide one shows a lot more. At 21:9 the visible
  // half-width at the board's depth is about `field × 2.3`, and past the
  // board's far edge it is wider still. Seven rings was enough for a camera
  // that sat close behind the hero and is not enough for this one: the ground
  // simply stopped, with sky under it.
  //
  // It is not free — this is the outermost ring of a 33×33 field of tiles —
  // but almost all of it is `forest_far`, which is the group the cheap picture
  // setting drops, and none of it is in the shadow pass.
  const FOREST_OUT = def.forest ?? 14;
  const OUTER_X = HX + FOREST_OUT;
  const OUTER_Z = HZ + FOREST_OUT;
  add({
    id: 'ground_skirt', name: 'ground_skirt',
    primitive: { kind: 'box', size: { x: 2 * OUTER_X + 1, y: 0.4, z: 2 * OUTER_Z + 1 }, color: t.skirt },
    transform: { position: { x: 0, y: GROUND_Y - 0.4, z: 0 } },
    castShadow: false,
  });
  for (let gx = -OUTER_X; gx <= OUTER_X; gx += 1) {
    for (let gz = -OUTER_Z; gz <= OUTER_Z; gz += 1) {
      if (Math.abs(gx) <= HX && Math.abs(gz) <= HZ) continue;
      add({
        id: `outer_${gx}_${gz}`.replace(/[.-]/g, '_'), name: 'forest_ground',
        modelAssetId: t.tile,
        transform: {
          position: { x: gx, y: GROUND_Y - TILE_TOP, z: gz },
          rotation: yaw(Math.floor(rand() * 4) * (Math.PI / 2)),
        },
        castShadow: false,
      });
      const depth = Math.max(Math.abs(gx) - HX, Math.abs(gz) - HZ);
      const chance = Math.min(0.96, 0.72 + depth * 0.05);
      const r = rand();
      const n = r < chance ? (r < chance * 0.45 ? 2 : 1) : 0;
      for (let k = 0; k < n; k++) {
        add({
          id: `forest_${gx}_${gz}_${k}`.replace(/[.-]/g, '_'),
          // `forest_far` is what the picture-quality toggle drops. The
          // outermost ring keeps its own name and always stays: it is what
          // hides the edge of the ground against the sky.
          name: depth >= 4 && depth < FOREST_OUT ? 'forest_far' : 'forest',
          modelAssetId: rand() < 0.22 ? t.props[1] : t.props[0],
          transform: {
            position: {
              x: gx + (rand() - 0.5) * 0.75,
              y: GROUND_Y,
              z: gz + (rand() - 0.5) * 0.75,
            },
            rotation: yaw(rand() * Math.PI * 2),
          },
          castShadow: false,
        });
      }
    }
  }

  // The air wall, unbroken on all four sides. The hero is held inside ±6.6;
  // the enemies fly, and were never touching it.
  for (const side of ['n', 's', 'w', 'e']) {
    const along = side === 'n' || side === 's' ? 'x' : 'z';
    const fixed = side === 'n' || side === 'w'
      ? -(along === 'x' ? WALL_Z : WALL_X) : (along === 'x' ? WALL_Z : WALL_X);
    const len = 2 * (along === 'x' ? WALL_X : WALL_Z) + 0.2;
    add({
      id: `wall_${side}`, name: `wall_${side}`,
      primitive: {
        kind: 'box',
        size: along === 'x' ? { x: len, y: 1.6, z: 0.4 } : { x: 0.4, y: 1.6, z: len },
        color: t.wall,
      },
      visible: false,
      transform: {
        position: along === 'x' ? { x: 0, y: 0.6, z: fixed } : { x: fixed, y: 0.6, z: 0 },
      },
      collider: {
        shape: {
          kind: 'box',
          halfExtents: along === 'x'
            ? { x: len / 2, y: 0.8, z: 0.2 } : { x: 0.2, y: 0.8, z: len / 2 },
        },
        body: 'fixed',
      },
    });
  }

  // Dead centre, because every side is a side they can come from. A hero who
  // starts against one wall starts with a quarter of the board behind them.
  add({
    id: 'hero', name: 'hero', modelAssetId: 'hero',
    transform: { position: { x: 0, y: GROUND_Y, z: 0 } },
    // Declaring a starting clip is what creates the MIXER, and without one
    // there is no CharacterAnimator and the hero never moves a limb.
    animation: { play: 'idle', loop: true },
  });

  return {
    schemaVersion: 1,
    id: def.id,
    name: def.name,
    /** How big the board is, written down ONCE and read by the game.
     *
     *  The alternative is the same constant in two files that must be kept in
     *  step by hand, which this project already has one of (`LAND`) and has
     *  the scars to prove it. `field` is where the air wall stands — what the
     *  hero is held inside — and `outside` is where enemies are made and
     *  where they are gone, comfortably past anything the camera shows. */
    arena: { field: { x: WALL_X, z: WALL_Z }, outside: Math.max(WALL_X, WALL_Z) + 2.0 },
    environment: { background: t.sky },
    gravity: { x: 0, y: -4.1692, z: 0 },
    lights: [
      { id: 'sky', kind: 'hemisphere', color: '#ffffff', groundColor: t.ground,
        intensity: t.skyIntensity },
      { id: 'sun', kind: 'directional', color: t.sun, intensity: t.sunIntensity,
        position: { x: 4, y: 8, z: 5 }, castShadow: true },
    ],
    // FIXED, and the game places it.
    //
    // A follow camera is right for a board you walk around and wrong for one
    // that IS the screen: it moves, so the edges of the world drift in and out
    // of frame, and it can be turned, so "left" stops meaning left. Here the
    // whole board is visible at all times and the player is a thing inside a
    // frame, which is what makes a bullet's line readable before it arrives.
    //
    // The offset below is only a sensible default — where the camera would sit
    // on a square viewport. `fitCamera` in `main.ts` replaces it on load and on
    // every resize, because where it BELONGS depends on the aspect ratio, and
    // the generator has no idea what screen this will be played on.
    camera: { kind: 'fixed', fov: 50, offset: { x: 0, y: 13, z: 10 } },
    entities,
  };
}

/** The board the tutorial happens on.
 *
 *  Its own board, not Meadow with hand-holding on top. The tutorial is scripted
 *  down to how many hits an enemy takes, and a board that also has to be a
 *  playable level is a board where every balance change is a script change.
 *
 *  Short and straight, one gate, no fork, and wide margins: every step of the
 *  script names a place to stand, and a player who cannot find it is stuck.
 */
const TUTORIAL_SCENE = {
  id: 'tutorial',
  name: 'The Path',
  theme: 'grass',
  // A single lane across the middle. Enemies come out of the west gate and
  // walk east, which puts the whole road in front of a hero arriving from the
  // south door.
  // The last leg is a BRANCH, not part of the trunk: a route is a trunk plus a
  // branch, and a board with no branches generates no route at all.
  trunk: [[-5.5, -0.5], [4.5, -0.5]],
  branches: [[[4.5, -0.5], [5.5, -0.5]]],
  gates: [{ id: 'gate_w', wall: 'w', at: -0.5 }],
  scenerySeed: 23,
};

/** The one board this game has. */
const ARENA = {
  id: 'arena',
  name: 'The Clearing',
  theme: 'grass',
  scenerySeed: 47,
  // Outermost cell centre.
  //
  // 5.5 is what the tower-defense boards use and was simply inherited; at that
  // size the far corner is four seconds away and most of the board is
  // somewhere nothing happens. 4 fixed that for a camera that followed the
  // hero — and then the camera became the FRAME, which changes what this
  // number is for.
  //
  // With the whole board on screen at once, the board's size IS the zoom: a
  // wider board is the same screen divided among more of it, so everything on
  // it is smaller. At 4 the hero came out about twelve pixels tall on a
  // landscape phone and an orb about six, and six pixels cannot carry the one
  // thing this game asks you to read. The number is set by legibility now,
  // not by walking distance.
  // Wider than deep, because the screen is. See `buildArena`.
  half: { x: 5, z: 3.2 },
};

{
  const scene = buildArena(ARENA);
  writeFileSync(new URL(`../public/scenes3d/${ARENA.id}.json`, import.meta.url),
    JSON.stringify(scene, null, 2) + '\n');
  console.log(`${ARENA.id.padEnd(12)} ${String(scene.entities.length).padStart(4)} entities · arena`);
}

for (const def of [...LEVELS, TUTORIAL_SCENE]) {
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
// the game's name built out of cubes. Same generator because
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

  // The same forest the boards have. The hub is the first thing anyone sees,
  // and it was a green square in a brown box with sky behind it.
  const HUB_OUT = 7;

  // --- how big the village is, and how big it can get ------------------------
  //
  // The gate does not move. Its frame and its sign are folded into a merged
  // mesh, so they cannot — but it is the better design anyway: the way out is
  // the one landmark that should be where you left it. The village grows AWAY
  // from the gate, sideways and backwards.
  //
  // `LAND[0]` is where a new village starts and `LAND[2]` is the most it can
  // ever be; the middle one is the size the hub was before any of this.
  const FRONT = -HALF - 0.6;       // the gate wall, fixed
  const LAND = [
    { x: 4.1, back: 3.1 },
    { x: 5.1, back: 5.1 },
    { x: 6.1, back: 7.1 },
  ];
  const LAND_MAX = Math.max(...LAND.map((l) => Math.max(l.x, l.back)));
  const OUTER = HALF + HUB_OUT;
  const rand = rng(5);

  ents.push({
    id: 'ground', name: 'ground',
    // The collider is the playable 9x9; the ground you can SEE goes further.
    primitive: { kind: 'box', size: { x: 2 * HALF + 1, y: 0.4, z: 2 * HALF + 1 }, color: '#3f6b38' },
    visible: false,
    transform: { position: { x: 0, y: GROUND_Y - 0.4, z: 0 } },
    collider: {
      // Sized for the BIGGEST the village can get, not for its starting size.
      // The walls are what stop you; a floor that ends at the first wall would
      // drop the player into nothing the moment they bought more land.
      shape: { kind: 'box', halfExtents: { x: LAND_MAX + 1, y: 0.3, z: LAND_MAX + 1 } },
      body: 'fixed', offset: { x: 0, y: 0.1, z: 0 },
    },
    castShadow: false,
  });
  ents.push({
    id: 'ground_skirt', name: 'ground_skirt',
    primitive: { kind: 'box', size: { x: 2 * OUTER + 1, y: 0.4, z: 2 * OUTER + 1 }, color: '#3f6b38' },
    transform: { position: { x: 0, y: GROUND_Y - 0.4, z: 0 } },
    castShadow: false,
  });

  for (let gx = -OUTER; gx <= OUTER; gx += 1) {
    for (let gz = -OUTER; gz <= OUTER; gz += 1) {
      const inside = Math.abs(gx) <= HALF && Math.abs(gz) <= HALF;
      ents.push({
        id: `hgrass_${gx}_${gz}`.replace(/[.-]/g, '_'),
        name: inside ? 'grass' : 'forest_ground',
        modelAssetId: 'td-tile',
        transform: {
          position: { x: gx, y: GROUND_Y - TILE_TOP, z: gz },
          rotation: yaw(Math.floor(rand() * 4) * (Math.PI / 2)),
        },
        castShadow: false,
      });
      if (inside) continue;
      // Open in front of the door, so the way out is visible from the middle.
      if (Math.abs(gx) < 2 && gz < -HALF) continue;
      const depth = Math.max(Math.abs(gx), Math.abs(gz)) - HALF;
      // Which expansion, if any, puts this tile inside the walls. -1 is forest
      // for good. The front is fixed, so nothing in front of the gate is ever
      // claimed however much land is bought.
      const claim = LAND.findIndex(
        (l) => Math.abs(gx) <= l.x && gz <= l.back && gz >= FRONT,
      );
      // Denser still than a board's: the hub is small, so its clearing has to
      // read as a clearing from the middle of it.
      const chance = Math.min(0.97, 0.8 + depth * 0.04);
      const r = rand();
      const n = r < chance ? (r < chance * 0.5 ? 2 : 1) : 0;
      for (let k = 0; k < n; k++) {
        ents.push({
          id: `hforest_${gx}_${gz}_${k}`.replace(/[.-]/g, '_'),
          // A tree is tagged with the size of village that would swallow it,
          // and vanishes when that land is bought. Tagging by RING instead
          // looked the same until you bought the last expansion and a bald
          // strip appeared outside the wall, where trees that were never going
          // to be enclosed had been cleared anyway.
          name: claim > 0
            ? `forest_claim_${claim}`
            : (depth >= 4 && depth < HUB_OUT ? 'forest_far' : 'forest'),
          modelAssetId: rand() < 0.22 ? 'td-detail-tree-large' : 'td-tree',
          transform: {
            position: {
              x: gx + (rand() - 0.5) * 0.75, y: GROUND_Y, z: gz + (rand() - 0.5) * 0.75,
            },
            rotation: yaw(rand() * Math.PI * 2),
            scale: { x: 0.85 + rand() * 0.5, y: 0.85 + rand() * 0.55, z: 0.85 + rand() * 0.5 },
          },
          castShadow: false,
        });
      }
    }
  }

  // ONE doorway, in the middle of the front wall.
  //
  // It was a door per board for a while, which read well but made the choice
  // before the player had any reason to care which board was which. Walking
  // through this one opens a list of what has been played, and the choosing
  // happens there.
  const DOOR_X = 0;
  // A wall set per size. Each set has its OWN name, so `merge.ts` folds it into
  // a mesh of its own that the hub can switch on or off in one go — and the
  // colliders survive merging, keyed by entity id, so the hub enables the five
  // bodies that belong to the size it is showing.
  //
  // The gap in the front wall is the door's width, not a doorway-sized hole:
  // you used to be able to walk in anywhere along the front and the level would
  // start, which taught that the door was decoration.
  const GAP = 0.7;
  for (const [li, land] of LAND.entries()) {
    const depth = land.back - FRONT;
    const walls = [
      [`w${li}_west`, -land.x, (FRONT + land.back) / 2, 0.4, depth + 0.4],
      [`w${li}_east`, land.x, (FRONT + land.back) / 2, 0.4, depth + 0.4],
      [`w${li}_back`, 0, land.back, 2 * land.x + 0.4, 0.4],
      [`w${li}_front_l`, -(GAP + land.x) / 2, FRONT, land.x - GAP, 0.4],
      [`w${li}_front_r`, (GAP + land.x) / 2, FRONT, land.x - GAP, 0.4],
    ];
    for (const [id, x, z, sx, sz] of walls) {
      ents.push({
        // A name per SIDE, not per ring: each side becomes its own mesh so the
        // one standing between the camera and the player can be faded on its
        // own. Fading the ring would ghost the far side too, and you would be
        // looking at the forest through the whole enclosure.
        id, name: `wall_${li}_${id.split('_').slice(1).join('_')}`,
        primitive: { kind: 'box', size: { x: sx, y: 1.2, z: sz }, color: '#4a4036' },
        transform: { position: { x, y: 0.4, z } },
        collider: { shape: { kind: 'box', halfExtents: { x: sx / 2, y: 0.6, z: sz / 2 } }, body: 'fixed' },
        // Only the size you have bought is up. The hub turns the right one on.
        visible: li === 0,
      });
    }
  }

  ents.push({
    id: 'door', name: 'door', modelAssetId: 'hub-door-open',
    transform: { position: { x: DOOR_X, y: GROUND_Y, z: -HALF - 0.6 } },
  });
  ents.push({
    id: 'door_frame', name: 'door_frame',
    primitive: { kind: 'box', size: { x: 1.35, y: 1.4, z: 0.22 }, color: '#6b4f2a' },
    transform: { position: { x: DOOR_X, y: 0.5, z: -HALF - 0.78 } },
  });
  ents.push({
    id: 'door_sign', name: 'door_sign', modelAssetId: 'hub-sign',
    transform: { position: { x: DOOR_X + 1.15, y: GROUND_Y, z: -HALF + 0.15 } },
  });

  // --- the town ---
  //
  // Every level of every building is placed and hidden; the hub shows the one
  // you own, at the spot the player chose for it. Swapping a model at runtime
  // means loading it at runtime, and a building that pops in a second after the
  // hub does reads as a glitch — so all fifteen are here from the start and the
  // hub moves the right one.
  //
  // The x/z below are only a parking space. What the player sees is whatever
  // `spots` in the save says, and an unplaced building is not visible at all.
  // The hub is a 9x9 board with its walls at +/-5.1 — NOT the 13x13 the levels
  // use.
  const TOWN = [
    { id: 'smithy', x: -3.5, z: -1.6, yaw: Math.PI / 2,
      models: ['bld-house-a', 'bld-house-b', 'bld-house-c'] },
    { id: 'clinic', x: -3.5, z: 2.2, yaw: Math.PI / 2,
      models: ['town-stall-red', 'town-watermill', 'bld-house-b'] },
    { id: 'market', x: 3.5, z: -1.6, yaw: -Math.PI / 2,
      models: ['town-stall-green', 'bld-house-a', 'town-watermill'] },
    { id: 'range', x: 3.5, z: 2.2, yaw: -Math.PI / 2,
      models: ['bld-tower-b', 'bld-tower-a', 'town-windmill'] },
    // The armory stands behind the weapon rack, facing the room. It is the only
    // plot off the corners, because the rack in front of it is what it is for.
    { id: 'armory', x: -2.0, z: -3.0, yaw: 0,
      models: ['town-cart', 'town-stall-red', 'bld-tower-a'] },
  ];
  // --- the shop ---------------------------------------------------------
  //
  // A stall you WALK TO, not a button in the corner. Standing at a thing and
  // pressing the action button is this game's one verb — it builds a tower,
  // takes a weapon, upgrades a building — and the shop reaching for a different
  // one would be a second interface to learn.
  //
  // It cannot be one of the things it sells, so it is always there.
  ents.push({
    id: 'shop', name: 'shop', modelAssetId: 'town-cart',
    // By the GATE, at the front.
    //
    // It has to be inside the smallest village — it sells the land that makes
    // the village bigger, and a stall you cannot reach until you have bought
    // more room is a lock with its key inside it. At (1.6, 3.0) it was outside
    // the starting back wall entirely.
    //
    // Moving it just inside that wall fixed the reachability and left the real
    // problem: the camera follows from BEHIND, so standing at a stall near the
    // back wall puts the camera outside it and the wall fills a third of the
    // screen. At the front the camera is always over open village. Must match
    // `SHOP_AT` in `src/hub.ts`.
    transform: { position: { x: -2.9, y: GROUND_Y, z: -3.9 }, rotation: yaw(Math.PI) },
    collider: {
      shape: { kind: 'box', halfExtents: { x: 0.5, y: 0.5, z: 0.7 } },
      body: 'fixed', offset: { x: 0, y: 0.5, z: 0 },
    },
  });
  ents.push({
    id: 'shop_marker', name: 'shop_marker', modelAssetId: 'td-selection',
    transform: { position: { x: -2.9, y: GROUND_Y + 0.02, z: -3.9 } },
    visible: false,
  });

  // No plots. Four rectangles of bare dirt told a new player exactly how many
  // buildings this game will ever have, which is the same objection as five
  // weapon plinths with four empty — and the shop replaced the counting with a
  // list. Buildings now stand wherever the player puts them; the models are
  // parked here and moved into place at runtime from the save.
  for (const b of TOWN) {
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


  ents.push(...titleEntities(0, 1.35, -HALF - 0.3));

  // Scenery, off the walking line between spawn and door.
  const props = [
    ['td-tree', -3.5, -2.5], ['td-tree', 3.5, -2.5], ['td-tree', -3.5, 3.5],
    ['td-rocks', 3.5, 3.5], ['td-crystal', 2.5, -3.5], ['td-rocks', -2.6, 1.9],
    ['hub-crate', 2.5, 1.5], ['hub-crate', 3.2, 1.5], ['hub-crate', 2.85, 1.5],
    ['hub-barrel', 1.6, 2.6], ['hub-barrel', -1.6, -2.6],
  ];
  for (const [i, [m, x, z]] of props.entries()) {
    ents.push({
      id: `hprop_${i}`, name: 'prop', modelAssetId: m,
      transform: { position: { x, y: m === 'hub-crate' ? (i === 8 ? 0.5 : 0) : 0, z } },
    });
  }

  // The weapon rack: five pedestals in a row, in front of the armory. Standing
  // at one and pressing the action button forges it, takes it, or improves it —
  // the same verb as building a tower and reading the sign, so the hub teaches
  // the level's only interaction and the armory needs no menu.
  //
  // Spacing is 1.25, which is more than the 0.9 that counts as "standing at"
  // something: at 1.0 you are at two pedestals at once and the prompt flickers
  // between them as you breathe.
  const PICKUPS = [
    ['sword', -2.5, 0.2],
    ['bow', -1.25, 0.2],
    ['fire', 0, 0.2],
    ['ice', 1.25, 0.2],
    ['bolt', 2.5, 0.2],
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

/**
 * The clearing behind the title screen.
 *
 * Its own scene, not the hub seen from an angle. The hub is a village with a
 * player's things in it — their buildings, wherever they put them, at whatever
 * size they bought — and a title screen that shows a save it has not asked
 * about yet is showing the answer before the question. A clearing is the same
 * world with nothing of theirs in it.
 *
 * No hero, no walls, no colliders: nothing here is stood on or walked into. It
 * is a picture, and the camera drifts across it.
 *
 * The models are the ones the hub already uses, so the second load is the
 * browser's cache rather than the network.
 */
function buildTitle() {
  const ents = [];
  const HALF = 5;
  const OUT = 13;
  const rand = rng(91);

  ents.push({
    id: 'ground_skirt', name: 'ground_skirt',
    primitive: { kind: 'box', size: { x: 2 * OUT + 2, y: 0.4, z: 2 * OUT + 2 }, color: '#3f6b38' },
    transform: { position: { x: 0, y: GROUND_Y - 0.4, z: 0 } },
    castShadow: false,
  });
  for (let gx = -OUT; gx <= OUT; gx += 1) {
    for (let gz = -OUT; gz <= OUT; gz += 1) {
      ents.push({
        id: `tgrass_${gx}_${gz}`.replace(/[.-]/g, '_'),
        name: 'forest_ground', modelAssetId: 'td-tile',
        transform: {
          position: { x: gx, y: GROUND_Y - TILE_TOP, z: gz },
          rotation: yaw(Math.floor(rand() * 4) * (Math.PI / 2)),
        },
        castShadow: false,
      });
      // The clearing itself, and a gap on one side so the eye has somewhere to
      // go. A ring of trees with no way out of it reads as a wall.
      const r = Math.hypot(gx, gz);
      if (r < HALF) continue;
      if (gx > HALF * 0.4 && Math.abs(gz) < 2.4) continue;
      const depth = r - HALF;
      const chance = Math.min(0.95, 0.55 + depth * 0.11);
      const roll = rand();
      const n = roll < chance ? (roll < chance * 0.45 ? 2 : 1) : 0;
      for (let k = 0; k < n; k++) {
        ents.push({
          id: `tforest_${gx}_${gz}_${k}`.replace(/[.-]/g, '_'),
          name: depth > 3 ? 'forest_far' : 'forest',
          modelAssetId: rand() < 0.26 ? 'td-detail-tree-large' : 'td-tree',
          transform: {
            position: {
              x: gx + (rand() - 0.5) * 0.8, y: GROUND_Y, z: gz + (rand() - 0.5) * 0.8,
            },
            rotation: yaw(rand() * Math.PI * 2),
            scale: { x: 0.9 + rand() * 0.6, y: 0.9 + rand() * 0.7, z: 0.9 + rand() * 0.6 },
          },
          castShadow: false,
        });
      }
    }
  }

  // A few things in the clearing so it is a place rather than a lawn.
  const props = [
    ['td-rocks', -2.4, 1.6], ['td-crystal', 2.2, -1.9], ['td-tree', -3.4, -2.8],
    ['hub-barrel', 1.4, 2.2], ['hub-crate', 2.9, 1.4], ['td-rocks', 3.1, -3.2],
  ];
  for (const [i, [m, x, z]] of props.entries()) {
    ents.push({
      id: `tprop_${i}`, name: 'scenery', modelAssetId: m,
      transform: { position: { x, y: GROUND_Y, z }, rotation: yaw(rand() * Math.PI * 2) },
    });
  }

  return {
    schemaVersion: 1,
    id: 'title',
    name: 'Balaboo',
    environment: { background: '#9fd4ef' },
    gravity: { x: 0, y: -4.1692, z: 0 },
    lights: [
      { id: 'sky', kind: 'hemisphere', color: '#ffffff', groundColor: '#8fa08a', intensity: 2.1 },
      { id: 'sun', kind: 'directional', color: '#fff6e0', intensity: 2.0,
        position: { x: 3, y: 7, z: 4 }, castShadow: false },
    ],
    // `fixed` so the SDK leaves it alone — the schema has no place to put a
    // position or a look-at, and the title aims it every frame anyway.
    camera: { kind: 'fixed', fov: 50 },
    entities: ents,
  };
}

writeFileSync(new URL('../public/scenes3d/hub.json', import.meta.url),
  JSON.stringify(buildHub(), null, 2) + '\n');
console.log(`hub: ${buildHub().entities.length} entities`);
writeFileSync(new URL('../public/scenes3d/title.json', import.meta.url),
  JSON.stringify(buildTitle(), null, 2) + '\n');
console.log(`title: ${buildTitle().entities.length} entities`);
