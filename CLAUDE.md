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
that board → the exit door opens when the run ends → back to the hub. One `WebGLRenderer` and one `ThreeUmicat.init()`
are made at boot and handed between the two; a second renderer on the same
canvas cannot be created at all, and a second `init()` opens a second connection
to the host. Each half tears its own scene down before handing over.

`boot()` in `src/main.ts` is that loop, and it is four lines. Read it first.

## Where things are

| file | what |
| --- | --- |
| `src/levels.ts` | **the three boards**: wave tables, gold, lives, caps, ice |
| `src/town.ts` | the four buildings in the hub and what they are worth |
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

Everything static is **merged into one mesh per material** at load, in two
groups: flat ground (which casts no shadow anyone can see) and scenery and props
(which very much do). That is ~200 draw calls down to a handful for a picture
that never changes; a desktop does not notice, a phone very much does.

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

**At most two things may be shooting at the hero at once** (`MAX_SHOOTERS`; the
boss is exempt). Without the cap, danger scales with the size of the wave and
twenty saucers firing every 2.4s is a wall of bullets nobody dodges.

**Clearing a wave gives two hearts back**, of eight. Six hearts and no way to
heal was survivable over eight waves and a slow death over twelve.

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

**Nothing pays itself in.** A kill leaves a coin — or, rarely, a heart — on the
ground where it died, and the counter does not move until you take it. Walk
within `MAGNET_RADIUS` (3.5 tiles) and it comes to you; leave it fourteen
seconds and it flashes and is gone. That is the point of being a character on
the board rather than a cursor over it: the money is somewhere, and you are
somewhere else.

`BOUNTY_SCALE` exists because of it. With the same wave tables as the
fly-to-the-counter version, Meadow went from a comfortable win to losing on wave
seven with thirteen upgrades instead of sixty-nine — you simply do not collect
what dies on the far side of the board. One lever rather than forty edited
numbers, so the wave tables stay readable as "how hard is this wave".

Hearts are ~5% of drops, and only when one is missing. A kill that might pay
health every time makes hit points stop being a resource, which is what the
crates, the wave bonus and the knock-out rule are all built around.

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
`{ best, quality, weapon, runs, cleared, bests, coin }`.

- `runs` — levels FINISHED, win or lose. Unlocks weapons: sword at 0, bow at 1,
  staff at 2. Being handed a bow for losing is kind.
- `cleared` — boards WON, in order. Board `i` is open when `cleared >= i`.
  Otherwise the order means nothing.
- `coin` — gold carried home from runs, spent in the town.
- `town` — which buildings are paid for, and to what level.

## The town

Four plots in the hub, bought with `coin` the same way as everything else in
this game: walk to it, press the action button. No menu. Each is three levels,
and each level is a bigger building, so the hub visibly grows as you play.

| building | what it is worth per level |
| --- | --- |
| Smithy ⚒ | +1 tower you may have standing |
| Clinic ❤ | +2 hearts |
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
- **The platform's touch layer is full-screen at z-index 10.** Anything the game
  draws on top of it needs to say so, and `input.setEnabled(false)` before a
  modal. This has bitten four times: the attack button under the jump button,
  Play Again, the HUD under the controls, the leaderboard panel.
- **Never copy one kit's `Textures/` over another's.** `cmp` first. Doing it
  once turned the grass orange and every check still passed.
- **An element created, updated and never appended is invisible and silent.**
  The tower counter and the effect readout had their text set every frame for a
  day before anyone noticed they were not in the document. Same shape as a
  button rendered under the control layer.
- **A spawn point written down twice disagrees with itself.** The hub placed its
  hero at z=1.9 in the scene and spawned the controller at z=3.0 in code; the
  controller wins, so editing the scene did nothing. Both now read the scene.
- **The game runs in WebKit on phones.** `pw-engines.mjs` tests both engines;
  the Web Audio unlock bug was invisible in Chromium.

## Building

```
npm run scene     # regenerate the board and the hub from the polylines
npx tsc --noEmit  # types
npx vite build    # dist/
./deploy-preview.sh
```

Probes live in `umicat-infra/playwright/`: `verify-3d-levels` (three boards, the
doors, the ice), `verify-3d-lanes` (the fork, the gates, the boss),
`verify-3d-crates-unlocks`, `verify-3d-hub`, `verify-3d-td`,
`verify-3d-feedback`, `verify-3d-endscreen`, `verify-3d-audio`,
`verify-3d-audio-engines`, `verify-3d-jump-touch`, `verify-3d-balance`,
`verify-3d-town`.

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
