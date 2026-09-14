# Balaboo

A tower defense you walk around in. You are not a cursor over a map — you are
a character on the board, and that is the whole design: **a tower can only be
built where you are standing.** Everything else follows from it. The towers are
the part of the defence that holds a lane while you are somewhere else; you are
the only part that can be somewhere else in time.

Game id `d25d06c2-0ae4-4083-8eff-ded32d3125aa`, fork org `umicat-games`.
`./deploy-preview.sh` publishes `dist/` straight to S3 + CloudFront. **Always
commit AND deploy** — a direct deploy is a temporary override that any
workspace rebuild wipes out.

> This file is the memory of what has been done and why. It used to describe
> "Woodland Brawl", the arena brawler this started as, long after the game had
> become a tower defense — which is exactly how a long session gets misled.
> **Update it in the same commit as the change.**

## The shape of a session

Hub → pick a weapon → walk through the door → **choose a board from the list** →
that board → the run ends into a **summary** → back to the hub. One `WebGLRenderer` and one `ThreeUmicat.init()`
are made at boot and handed between the two; a second renderer on the same
canvas cannot be created at all, and a second `init()` opens a second connection
to the host. Each half tears its own scene down before handing over.

`boot()` in `src/main.ts` is that loop, and it is four lines. Read it first.

## Where things are

| file | what |
| --- | --- |
| `src/levels.ts` | **the three boards**: wave tables, gold, lives, caps, ice |
| `src/town.ts` | the four buildings in the hub and what they are worth |
| `src/progress.ts` | drops, materials, the level curve — all of it arithmetic |
| `src/vfx.ts` | short-lived visual things, and the one loop that owns them |
| `src/main.ts` | the level engine: towers, the hero, crates, the frame loop |
| `src/hub.ts` | the hub: weapons on pedestals, the leaderboard sign, the door |
| `src/audio.ts` | this game's clip table and the two music tracks |
| `src/loading.ts` | the loading screen between scenes |
| `tools/gen-scene.mjs` | **generates** `public/scenes3d/*.json` — `npm run scene` |
| `public/scenes3d/manifest.json` | every model, by id |
| `public/kit/` | the Kenney kits, CC0 — see `ASSETS.md` |

Start with `LEVELS` in `levels.ts`, `TOWERS` in `main.ts`, and the frame loop.

## The boards

Three of them, deliberately different PROBLEMS rather than the same problem with
bigger numbers. `tools/gen-scene.mjs` generates all three plus the hub from a
`LEVELS` table of polylines; `src/levels.ts` holds what walks them.

| board | theme | road | spots | what makes it hard |
| --- | --- | --- | --- | --- |
| Meadow | grass | 36 | 74 | nothing — it is where the game is learned |
| Frostfall | snow | 25 | 49 | ice, and a third less time per tower |
| Rivermeet | grass | 32 | 54 | a river across the middle, three bridges |
| Crossroads | grass | 22 | 43 | gates on opposite walls, shortest road |

**Rivermeet's river is in YOUR way, not theirs.** The saucers fly. Three bridges,
and whichever half you are on, the other one costs the walk to a crossing. The
kit's river tile is solid with the water painted into its channel, and a 5cm
trench catches no light — so there is a slab of blue laid in it, or the river
reads as a black crack across the board.

A board's look is one lookup in `THEMES`: the kit ships a snow copy of every
terrain piece, so a new theme is a table entry rather than a second code path.
Scenery (trees, rocks, crystals) is baked into TILES in this kit, so a wooded
corner costs the same as bare ground — they go on the outer ring only, because
scenery in the middle of the field is scenery the hero walks around on the way
to a tower.

**Ice** is the direction lagging the stick, in `main.ts`, not a controller
feature: you cannot turn sharply and you overshoot. The overshoot has to stay
under ~0.7 of a cell, because you build by standing on a cell — at 0.63 a bot
could not place a single tower on Frostfall. Real deceleration would need the
SDK controller's `speed` to be settable at runtime (it is `private readonly`);
worth adding there one day, but "this level is icy" is a game rule either way.

Generated, not authored. A path is a polyline; which tile goes where and which
way it faces follows from it, and `npm run scene` regenerates the lot. Authoring
40 near-identical JSON objects with a rotation nobody can check is how the board
ends up visibly broken at every bend.

**The road forks.** The trunk comes down the middle and T's left and right into
a shut gate set into each side wall. Enemies alternate between the two branches,
so both lanes are always live and the question the board asks is which half you
can afford to leave thin. A leak reddens the gate it came through — with two
lanes, "you lost a life" leaves out the half you would act on.

The gate **is** the wall there: the wall pieces leave a gap exactly one door
wide, and the door fills it carrying its own collider. Not a door pasted on a
solid wall, and not a hole with an invisible collider across it — the ground is
13×13 and stops, so a real hole is a fall out of the world.

Tile choice comes from a cell's **path neighbours**, not from "the direction in
and the direction out" — the latter cannot describe the fork, which has one way
in and two ways out. Corners and the fork are full dirt tiles: a tile that is
path on all four edges cannot be rotated wrong, and deleting a class of bug beat
getting the kit's corner-tile lookup table right.

**There are no walls.** The board is a clearing: the ground keeps going for
seven more cells in every direction and fills with trees — thick from the first
ring, because thin read as a scattering of trees on a lawn that happened to stop
— and what stops you is an invisible collider where the wall used to be. That is the ordinary way a
forest edge is done — a tree line built to seal perfectly is a fence with leaves
on — and the boards went from "a green square in a brown box with sky behind it"
to somewhere.

It costs about eleven hundred objects per board, and `src/merge.ts` folds all of
them into **four to ten meshes**. Three groups, differing only in what they do
with light: the board receives shadows and casts none (flat ground casting onto
flat ground draws nothing anyone can see), scenery inside the play area does
both, and the forest does NEITHER — it is outside the board, nobody looks at its
shadows, and receiving costs shader work on every pixel of four hundred trees.
Keeping it out of the shadow pass is most of what makes it free.

The **middle rings are a separate mesh** (`forest_far`) so the picture-quality
toggle can drop them: half the triangles on a board, and the rings nobody stands
next to. Smooth takes a level from ~150k triangles to ~97k. The OUTERMOST ring
always stays — it is what hides the edge of the ground against the sky, and
dropping it traded a frame for a visible seam.

Merging is keyed by the **kit directory**, not by material. Every model in a kit
points at the same colormap, but each GLB embeds its own copy — so the loaded
textures are distinct objects wrapping identical pixels, with no URL to compare
and an ImageBitmap for an image. Keying by material, by texture uuid, or by
image source all gave the same answer: one mesh per source FILE, nineteen of
them. After the fix the whole level is 20 draws, which is fewer than it was
before the forest existed.

The trees keep their COLLIDERS through the merge — a collider is a rigid body in
the physics world keyed by entity id, and taking the mesh out of the scene does
not touch it. There is a probe check for that, because "works because" is a
thing to verify rather than assert.

After the merge the individual tiles no longer exist and are gone from
`world.entities` — anything that needs to know where the road is must ask the
path data, not the scene.

## A run

Eight to twelve waves depending on the board. Every enemy shoots back; the ramp is hit points, speed and count,
so each wave is a different problem rather than a larger one. The last wave is
**one orc** — it walks, on the ground, with a walk cycle, throwing boulders
worth two hearts with a tell you can see from across the board. It is the only
enemy in the game that is not a saucer.

**Health is a BAR of 100, not hearts.** Eight hearts meant a hit was always an
eighth of what you had and the run ended in eight touches; a bullet takes 10 and
a boulder 22, so a hit can be a scratch. **Running out ends the run** — it used
to cost a life and carry you back to the door, which made health a second pool
of lives rather than the thing you are looking after.

**At most two things may be shooting at the hero at once** (`MAX_SHOOTERS`; the
boss is exempt). Without the cap, danger scales with the size of the wave and
twenty saucers firing every 2.4s is a wall of bullets nobody dodges.

**Clearing a wave gives 25 health back**, of 100. Six hearts and no way to
heal was survivable over eight waves and a slow death over twelve.

**Two kinds of emplacement.** A `ground` weapon stands on the grass: cheap,
there from the first run, and upgrading makes it BIGGER. A `tower` mount is the
same sort of weapon on a stack of masonry — further, harder, three or four times
the price — and each level of the **smithy** unlocks one (Watchtower, Bastion,
Spire). The reason to want one is reach: the corner two ground weapons cannot
cover between them. A mount you have not unlocked is not a greyed-out cell, it
is not in the hotbar at all.

**Towers are capped** per board (`maxTowers`, 12–14) and go to **level 4**.
Without a cap the game had exactly one strategy: buy the cheapest tower forever.
A ballista is 25g for 2 damage a second and its first upgrade is 20g for 1.4
more, so another tower beats a better tower right up until the ground runs
out — a measured run put FIFTY level-one ballistas on Meadow and lost nothing.
With a cap the gold has somewhere else to go and the question becomes which
stretch of road you are covering.

An upgrade adds a **section of masonry** and lifts the weapon onto it, so a
levelled tower is taller rather than a bigger copy of a small one. Level four
has no more masonry — a tower tall enough to hide the road behind it is a worse
tower — so it adds the kit's crystal cluster and a bigger weapon instead.

`DAMAGE_BY_LEVEL` is a TABLE, not `1.7 ** (level - 1)`. Adding a fourth level to
the exponent handed out a 4.9x tower and turned the hardest board from "lost on
wave ten" into "won with ten of twelve lives up".

**Being knocked out costs a life, not the run.** It used to end it, and that was
the loudest thing in every measurement: the base untouched at ten of ten while
the run ended because the hero was shot walking between build spots. Walking to
a spot IS the mechanic. Now you are carried back to the door, and that walk is
the punishment.

**Nothing pays itself in.** A kill leaves GOLD, WOOD, STONE or health on the
ground where it died (50/22/18/10, and health only when some is missing), and the counter does not move until you take it. Walk
within `MAGNET_RADIUS` (3.5 tiles) and it comes to you; leave it fourteen
seconds and it flashes and is gone. That is the point of being a character on
the board rather than a cursor over it: the money is somewhere, and you are
somewhere else.

`BOUNTY_SCALE` exists because of it. With the same wave tables as the
fly-to-the-counter version, Meadow went from a comfortable win to losing on wave
seven with thirteen upgrades instead of sixty-nine — you simply do not collect
what dies on the far side of the board. One lever rather than forty edited
numbers, so the wave tables stay readable as "how hard is this wave".

Only GOLD is spendable during a run. Wood and stone have nothing to buy on a
board, which is what makes them come home in full while the gold is a choice
between a tower now and a building later.

**Crates** drop on the back field — cells that are neither road nor a place to
build — and pay gold or a heart when broken with any weapon. A heart only when
one is missing: a crate that pays nothing is a worse crate than one that pays
gold. They land away from everything on purpose; walking to one is the cost.

**One crate in four is rare** and pays a twenty-second effect instead: double
strike, richer bounties, a shield, or towers that reload faster. Gold and hearts
are the same decision every time; a timed effect is only worth anything if you
are near something to use it on, so the same crate is a different offer in a
quiet moment and in a busy one. It never rerolls into the effect already
running. `withBuff()` is the one place damage passes through, because a buff
that reaches three weapons of four looks broken to whoever notices.

## Progression

`td-progress` in `umicat.saves`:
`{ best, quality, weapon, runs, cleared, bests, store, level, xp, town }`.

A run ends into a **summary panel**: the level bar filling (one level at a time,
so the moment it wraps is visible), and what the run earned by material. The
summary is what WRITES the save — level, experience, the store, what was cleared
and how far. Nothing else may, or the run gets counted twice.

**Level decides how hard you hit and how hard you are hit**: +8% attack a level,
−3.5% damage taken a level capped at half. `xpToNext(n) = 300 + (n-1)·220`, and
a run is worth `kills·3 + wave·15 + (won ? 100 : 0)` — waves count for more than
kills so that pushing deeper beats farming wave one.

**The numbers in `progress.ts` are ARITHMETIC, not measurement.** Worked out
from how many things a board has and how many a run kills: Meadow pays about
550 gold / 20 wood / 16 stone, Crossroads about 2150 / 63 / 51, and a fully
built village is 4500 / 660 / 490 — eight to twelve runs, weighted to the later
boards. `verify-3d-balance` measures the FIGHT; measuring the economy the same
way would cost hours per tweak, and this is a thing to tune by playing.

- `runs` — levels FINISHED, win or lose. Unlocks weapons: sword at 0, bow at 1,
  staff at 2. Being handed a bow for losing is kind.
- `cleared` — boards WON, in order. Board `i` is open when `cleared >= i`.
  Otherwise the order means nothing.
- `store` — gold, wood and stone carried home, spent in the town.
- `town` — which buildings are paid for, and to what level.
- `coin` — the old gold-only store. Read once so a save from before wood and
  stone existed is not thrown away.

## The sandbox — `?dev`

`?dev` unlocks everything; `?dev=staff` (or `sword`/`bow`) also puts that weapon
in your hand. **On a phone, three taps on the frame counter** does the same and
reloads. All three weapons on the pedestals, all four boards in the list,
every village building at level three — so the tower mounts exist — and a store
with enough in it to buy anything.

**It never writes.** `patchSave` returns immediately while it is on, so a
sandbox session cannot put `cleared: 4` into a real save. Open it on the same
browser as your real game, win a run in it, close it, and nothing has changed —
there is a probe that does exactly that and compares the save byte for byte.

It exists because the parts of this game that most need looking at are the ones
furthest from the start: a lightning spell you cannot see until you have won two
boards is a lightning spell nobody checks, and "play three levels first" is a
tax on every change to the staff, the mounts, the later boards and the village.

`src/dev.ts` is the whole of it, and everything that reads progress goes through
`readSave()` — a second reader that talks to `saves.get` directly is half the
game still locked.

**LEVEL and XP are deliberately NOT granted.** They decide how hard you hit and
how hard you are hit, so a sandbox at level 20 would make every impression of
the balance wrong, and looking at a spell is not a reason to stop being able to
judge a fight.

It says `★ DEV` in the frame counter. A build quietly in god mode is a build
whose every measurement is wrong.

**The tap route is the only way in on a phone, and the only way in at all
inside the iOS app.** The app builds the game's URL itself — `Game.previewURL`
in umicat-ios, which appends `?v=<stamp>` and nothing else — so no query
parameter reaches the game there without shipping a new build. The gesture goes
through Safari, the app's WebView and the editor's preview pane alike, and
typing a CDN URL on a phone keyboard was never the answer anyway.

It is SESSION storage, so it dies with the tab. A cheat that outlives the tab
it was turned on in is a cheat you forget is on.

Three taps on the READOUT toggles the sandbox; three taps on the HUD BEHIND it
still hides the readout. Different targets — the readout is `pointer-events:
auto` and stops the event, so the HUD's listener never sees a tap that landed on
it. Making the readout tappable at all is the sixth thing this game has drawn
over the platform's touch layer, so `verify-3d-jump-touch` was re-run and
`verify-3d-dev` checks with `elementFromPoint` that the readout is what is
actually under its own middle — "is it there" has passed for a button nothing
could reach before.

## The town

Four plots in the hub, bought with gold, wood and stone the same way as everything else in
this game: walk to it, press the action button. No menu. Each is three levels,
and each level is a bigger building, so the hub visibly grows as you play.

| building | what it is worth per level |
| --- | --- |
| Smithy ⚒ | +1 tower you may have standing, and one tower mount unlocked |
| Clinic ❤ | +25 max health |
| Market 💰 | +50 starting gold |
| Range 🏹 | +1 damage on **every** weapon, not just the sword |

They are things you can plan a run around rather than percentages you take on
faith — "+1 tower" changes what you build, "+8% damage" changes nothing you can
see. `bonusesFrom()` turns the saved levels into the four numbers a run reads,
in one place, so a bonus cannot reach the HUD and miss the rule.

The doorway is ONE door in the middle of the front wall, and walking through it
opens the list of boards rather than starting one. A door per board read well
and chose badly: it asked which board you wanted before you had a reason to
care, and had nowhere to say how far you had got on each.

**The hub is a 9×9 board with its walls at ±5.1** — not the 13×13 the levels
use. The first town layout put the plots at ±4.2 and ran them through the wall.
`fitToPlot` scales and centres each building on its foundation, because Kenney's
building models are not centred on their origins (`bld-house-c` measures 2×2.2
from a corner) and a windmill is 3.1 tall.

`runs` counts **finished levels** — incremented in `boot()` after `startLevel`
resolves, because "finished" means walking back out through the exit door.
The hub puts one more weapon on the ground per finished level: sword at 0, bow
at 1, staff at 2. The empty pedestals stay visible, which is the point.

**Everything that writes the save must go through `patchSave`.** The level used
to write `{best, quality}` wholesale and erase the weapon the hub had just
written — a field written by one screen and deleted by the next, with nothing
anywhere reporting a problem.

## Balance is measured, not chosen

`umicat-infra/playwright/verify-3d-balance.mjs <url> <level>` plays a real run
with a fixed competent strategy — **walk** to a spot, build, upgrade when it can
afford to, open crates, keep out of the shooting — and reports where it gets to.

Where the boards stand, as measured:

| board | result |
| --- | --- |
| Meadow | won, 8 of 10 lives left |
| Frostfall | won, 12 of 12 |
| Rivermeet | won, 6 of 12 |
| Crossroads | lost on wave 11 of 12 |

**The run-to-run spread is wider than most of the changes worth making.** Two
runs of the same build on Rivermeet reached waves 8 and 10. Tune on a difference
that survives that, or you are fitting noise — and the counter that made those
two look like different strategies was itself wrong: it counted upgrade
ATTEMPTS, and printed 145 on a board where fourteen towers of four levels can
absorb forty-two.

**Run it alone.** The bot acts in wall-clock while the game advances on real
elapsed time, so a busy machine starves the bot and the result comes back as
"too hard" — two runs beside the regression suite reported a loss on wave four
with eleven towers and no upgrades; the same build alone reached wave twelve
with twenty. The actions-per-wave column exists so that failure announces
itself.

**The bot must not cheat the mechanic it is measuring.** It teleported between
build spots at first, which is exactly the thing this game is built on: what a
defence costs is not gold, it is the walk. A teleporting bot put 53 towers on
Meadow and called it an easy board.

What it has found, none of it visible by reading the wave table:

- A full board of upgraded towers out-scales hit points far faster than a wave
  table does. The first twelve-wave curve lost all five lives before wave seven
  and not one after it, sitting on 1500 unspendable gold.
- With the tower count capped, DPS is capped too, and the curve gets a CLIFF:
  Frostfall lost nothing for nine waves and then eleven lives at once.
- The board can be perfectly safe while the hero is being shot to death — two
  different losses calling for opposite fixes, so the result line says which.
- A bot that ignores crates measures a game nobody plays.
- Boards whose road starts far from the door need a much longer opening: the
  hero arrives at the top of every board, Meadow's spawn tile is a few steps
  away and Frostfall's is in the opposite corner. Eight of ten lives, wave one.
- The bot has to do everything a player does. It did not collect drops when
  drops arrived, and reported a board with no income.
- Check what the bot is allowed to do before believing it. It had `level < 3`
  hard-coded after the game grew a fourth tower level, so it sat on 1700 gold
  reporting that a board could not be held — by a defence it had declined to
  finish.

## The sword

Half again as long as the kit's (0.67 against a 0.72 hero — at 0.45 it read as a
knife), and it **slashes**. The arm is still playing Kenney's
`attack-melee-right`, which is a vertical chop; the blade rides on a pivot of
its own between the hand socket and the model, and sweeps level across the body
while the arm does whatever it does. Carried upright between swings.

Three things that matter, all of them learned the hard way:

- **Aim it in WORLD space.** The socket hangs off a bone whose frame is whatever
  the animation says this frame, so posing the pivot in its own Euler angles is
  guesswork — that is how it ended up carried horizontally at hip height, which
  is what "hitting things with a scabbard" looks like. `aimBlade(dir, edge)`
  builds the world quaternion and converts back through the parent.
- **The EDGE has to lead.** The blade is a plate, 0.23 across its edges and 0.11
  thick, so a swing with the flat leading is a swing with a plank. The roll
  follows the tip's direction of travel.
- **Aim it LAST, after `world.update`.** The hero carries a scene mixer of its
  own (the `animation: { play: 'idle' }` on its entity) and `world.update` steps
  it, so a pose computed earlier is stale by however far the arm moved that
  frame — which mid-swing meant some frames were right and some pointed at the
  sky.

## Effects

`src/vfx.ts` owns anything PURELY VISUAL and fire-and-forget. It exists because
the same fifteen lines — an array, `t += dt`, a fade, `remove`, `splice` — had
been written six times, and spell effects were going to be the seventh. Drops,
shots and arrows are NOT effects: they are collected, they collide, they damage,
and folding them in would mean the rules asking the effects registry what it
holds.

Two constraints shaped it, both ours rather than general:

- **Draw calls are budgeted.** A level is about twenty, and that took folding
  1300 objects into four meshes. Anything that comes in a crowd goes through
  `motes()`, which is ONE instanced draw however many there are — it used to be
  a mesh and a material EACH, so a single staff cast cost nineteen draws.
  `verify-3d-feedback` holds the line at six.
- **Phones mind overdraw, not triangles.** Additive blending stacked three deep
  costs more than the rest of the board. `MAX_LIVE` caps how much can be on
  screen, so the worst case is a number rather than however many things happened
  to die at once.

Additive blending is also what makes fading free: three has no per-instance
opacity, but fading an additive instance's COLOUR to black is the same picture,
and `instanceColor` is per-instance.

### The atlas

`public/vfx/particles.png` is a 4×4 sheet of 256px cells cut from Kenney's
Particle Pack (CC0): four lightning bolts, two arcs, two rings, a rune circle,
a flare, a sparkle, a star burst, a scorch, a burst, a twirl and a slash.
`FRAME` names them. **One texture, loaded once** — a texture per effect is a
texture per cast, and the whole point of one sheet is that every spell in the
game can share a single material.

`quads(vfx, list, opts)` draws any number of textured quads as ONE mesh: one
`BufferGeometry` of four verts and two triangles per quad, rewritten every frame
from the quad list. Three modes, which is the whole vocabulary:

- `face` — always square to the camera. Flares, bursts, sparks.
- `ground` — flat on the floor, optional `roll`. Runes and scorch marks.
- `beam` — stretched from `at` to `to` and rolled to keep its flat side towards
  the camera. Bolts, and anything that runs between two points.

`lightning(vfx, at, opts)` composes them into the staff's strike: five `beam`
bolts scattered inside the damage radius, a `ground` glow that races out to
exactly where the damage ends, a turning rune, and a flare and star at the
centre. The bolts re-pick their frame and re-jitter their heads every 45ms,
because a bolt that holds still for half a second is a drawn line rather than
lightning. Five draw calls for the lot, measured.

Two things this got wrong first, both of them invisible as errors:

- **`TextureLoader.load` is asynchronous, and an additive material with an empty
  map samples BLACK** — which added to the screen is nothing at all. The first
  cast of every run drew ten perfectly correct triangles that could not be seen,
  while the draw-call counter said it was working. `preloadAtlas()` is awaited
  beside `loadScene3D`.
- **The bolt in the atlas is a thread down the middle of a mostly empty square.**
  A quad 0.75 across draws about 0.25 of lightning, so the first strike was
  three white pencil lines. They are 1.2–2.0 wide now.

A mote with no `frame` is an untextured square, and at 0.13 across next to
textured lightning it reads as a scrap of white paper. Give sparks a frame.

## Things that will bite

- **`Box3.setFromObject` lies about skinned meshes.** It reports the space the
  bones could reach (3.44 for the boss) rather than the model anyone can see
  (1.64). Measure from `geometry.boundingBox`, and for a skinned mesh do **not**
  apply the node transform — its vertices bypass it entirely, going through the
  bind matrix and the bones.
- **A plain `.clone(true)` of a skinned mesh shares its skeleton.** Two of them
  animate as one. `SkeletonUtils.clone` for anything rigged.
- **No mixer, no animation** — and a rigged model with no mixer renders
  perfectly and slides, silently.
- **`updateTints` only restores what it is GIVEN.** Flashing something that is
  not in the `tinted` list leaves it that colour for the rest of the run.
- **`endRun` must stay idempotent.** The second call removes a rigid body that
  is already gone, and Rapier answers that with an unrecoverable `unreachable`
  trap out of the wasm, not an exception anyone can catch.
- **`dt` is clamped at 0.05, so a slow scene runs in SLOW MOTION.** That is
  deliberate (a stall must not tunnel the physics), but it means a probe that
  sleeps in wall-clock is measuring something else: under the headless software
  renderer at eight frames a second, game time advances at forty per cent of
  real. Poll for the state you want; do not sleep for it.
- **The platform's touch layer is full-screen at z-index 10.** Anything the game
  draws on top of it needs to say so, and `input.setEnabled(false)` before a
  modal. This has bitten FIVE times: the attack button under the jump button, Play
  Again, the HUD under the controls, the leaderboard panel, and the hotbar —
  which wrapped to two rows when the smithy took it from four cells to seven,
  became a block over the left half of a portrait phone, and made the game
  unplayable because the thumbstick was underneath it. The row is
  `pointer-events: none` with `auto` on the cells, never wraps, and
  `verify-3d-jump-touch` now checks that the stick is reachable.
- **Never copy one kit's `Textures/` over another's.** `cmp` first. Doing it
  once turned the grass orange and every check still passed.
- **An element created, updated and never appended is invisible and silent.**
  The tower counter and the effect readout had their text set every frame for a
  day before anyone noticed they were not in the document. Same shape as a
  button rendered under the control layer.
- **A `const` used by a hoisted function is not ready when that function is
  called early.** `restSword()` ran at attach time and reached into the temporal
  dead zone; inside an async boot that shows up as a loading screen that never
  ends, not as an error anyone sees.
- **A spawn point written down twice disagrees with itself.** The hub placed its
  hero at z=1.9 in the scene and spawned the controller at z=3.0 in code; the
  controller wins, so editing the scene did nothing. Both now read the scene.
- **Enemy bullets are magenta on purpose.** They and dropped coins both travel
  towards the hero, and the kit's bullet is the same warm yellow as its coin —
  the two things you most need to tell apart were the two hardest to. Each shot
  gets its OWN material: clones cut from one model share theirs, so repainting
  one would repaint every arrow in the air.
- **The game runs in WebKit on phones.** `pw-engines.mjs` tests both engines;
  the Web Audio unlock bug was invisible in Chromium.

## Building

```
npm run scene     # regenerate the board and the hub from the polylines
npx tsc --noEmit  # types
npx vite build    # dist/
./deploy-preview.sh
```

The frame counter (`src/debughud.ts`) is on by DEFAULT, in the hub and in every
level — `?debug=0` turns it off, and so do three quick taps on the HUD. The
numbers that decide performance questions have to come from the phone, and the
hub was the one place with no way to see what eleven hundred trees cost.

Probes live in `umicat-infra/playwright/`: `verify-3d-levels` (three boards, the
doors, the ice), `verify-3d-lanes` (the fork, the gates, the boss),
`verify-3d-crates-unlocks`, `verify-3d-hub`, `verify-3d-td`,
`verify-3d-feedback`, `verify-3d-endscreen`, `verify-3d-audio`,
`verify-3d-audio-engines`, `verify-3d-jump-touch`, `verify-3d-balance`,
`verify-3d-town`, `verify-3d-dev`.

Getting from the hub into a board lives in **`pw-level.mjs`**, once. It was
copied into every probe with a comment saying it was shared "so that when the
hub changes there is one place to fix, not seventeen" — the hub then grew a door
per board and there were seventeen.

A probe must not hard-code a tuning number. Several asserted `heroHp === 6` and
`lives === 10`, so raising either broke them without saying anything about the
game; they read the board's own numbers now.

They ask about **effect**, not existence. "Is there a health bar" passed for a
bar worn at hip height; "is there a wave counter" passed for a game that could
never reach wave two.
