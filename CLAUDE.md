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
| `src/town.ts` | the five buildings in the hub and what they are worth |
| `src/weapons.ts` | **the five weapons**: what they cost, what they hit for, what they leave behind |
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
`{ best, quality, weapon, weapons, runs, cleared, bests, store, level, xp, town }`.

`weapons` is `{ [id]: level }` — which are forged and how far, `weapon` being
whichever is in hand. A save from before the Armory has no such field, and
`migrateWeapons` rebuilds one from `runs` (bow at one finished level, storm
staff at two) rather than charging anyone again for what they had earned. The
old `staff` becomes `bolt`, because the staff was already a lightning spell —
mapping it to fire would have handed someone a different weapon and called it
theirs.

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

- `runs` — levels FINISHED, win or lose. It used to unlock weapons on a
  schedule; they are forged at the Armory now, and this is the run counter and
  the input to the one-time migration above.
- `cleared` — boards WON, in order. Board `i` is open when `cleared >= i`.
  Otherwise the order means nothing.
- `store` — gold, wood and stone carried home, spent in the town.
- `town` — which buildings are paid for, and to what level.
- `coin` — the old gold-only store. Read once so a save from before wood and
  stone existed is not thrown away.

## The sandbox — `?dev`

`?dev` unlocks everything; `?dev=fire` (or `sword`/`bow`/`ice`/`bolt`, and
`staff` still works and means `bolt`) also puts that weapon in your hand. **On a
phone, three taps on the frame counter** does the same and reloads. The whole
weapon rack forged and improved to Lv3, all four boards in the list, every
village building at level three — so the tower mounts and the Armory's cap both
exist — and a store with enough in it to buy anything.

**In a sandbox run, `` ` `` or `\` cycles the weapon mid-fight** and names what
you are now holding. A real run carries ONE weapon on purpose — which to take is
most of what the Armory is for — but comparing three staves that way is three
runs and three walks back to the rack, and what you are judging is how a burn
feels against a chill on the SAME wave.

**It never writes.** `patchSave` returns immediately while it is on, so a
sandbox session cannot put `cleared: 4` into a real save. Open it on the same
browser as your real game, win a run in it, close it, and nothing has changed —
there is a probe that does exactly that and compares the save byte for byte.

It exists because the parts of this game that most need looking at are the ones
furthest from the start: a lightning spell you cannot see until you have won two
boards is a lightning spell nobody checks, and "play three levels first" is a
tax on every change to the staves, the mounts, the later boards and the village.

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

Five plots in the hub, bought with gold, wood and stone the same way as everything else in
this game: walk to it, press the action button. No menu. Each is three levels,
and each level is a bigger building, so the hub visibly grows as you play.

| building | what it is worth per level |
| --- | --- |
| Smithy ⚒ | +1 tower you may have standing, and one tower mount unlocked |
| Clinic ❤ | +25 max health |
| Market 💰 | +50 starting gold |
| Range 🏹 | +1 damage on **every** weapon, not just the sword |
| Armory ⚔ | weapons can be forged and improved to this level |

They are things you can plan a run around rather than percentages you take on
faith — "+1 tower" changes what you build, "+8% damage" changes nothing you can
see. `bonusesFrom()` turns the saved levels into the four numbers a run reads,
in one place, so a bonus cannot reach the HUD and miss the rule.

**What a plot says, it says OVER the plot.** The prompt used to be one line in
the top-left corner — as far from the building as the screen allows, with room
for a price but not for what the price buys. It is a card now, projected from
the building's own world position each frame so it follows the camera: what the
building gives at its current level, what the next level would give, what that
costs, and either the action or what is still MISSING. `townNow` / `townAfter`
derive both numbers from `bonusesFrom`, so what the card promises cannot drift
from what a run applies.

**Anchor it low.** The camera sits at y 3.6 looking down, so two metres of world
is most of the screen: at y 2.6 the card projected off the top edge and was
clamped there, which put it back in the corner it was meant to escape. 1.8.

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

## Where the weapons work was left (2026-09-13)

Built and verified: the Armory, the rack, forging and improving, the three
elements and their statuses, the effects, and the card that hangs over a
building. `verify-3d-armory` and `verify-3d-town` pass, as do `-hub`, `-td`,
`-feedback` and `-levels`; `npx tsc --noEmit` is clean.

**Not playtested.** Every number in `weapons.ts` is arithmetic against what a
run pays — Meadow ~550 gold, Crossroads ~2150 — so the rack is a second sink
beside the town rather than a second grind. Whether a burn is worth giving up a
chill for is a question nobody has answered by playing yet. The table is one
file; tune it there.

Other things left open, in the order they will be noticed:

- **The elements have no sound of their own.** All three cast on `upgrade`.
- **A chill's tint and a burn's flash share one emissive slot.** `flashTint`
  writes the material's emissive outright, so an enemy that is both burning and
  chilled shows whichever fired last. The burn's quiet path yields on purpose
  (`!quiet || !isTinted`) rather than strobing orange over a blue enemy twice a
  second — which means a chilled enemy gives no visual sign that it is also
  burning. A real status system would need its own colour channel, or to blend
  them; this picks the cheaper wrong answer knowingly.
- **A dish of numbers nobody has checked against the fight:** `CHAIN_FALLOFF`
  and `CHAIN_HOP` were picked so that the storm staff is worst against one
  enemy and best against a crowd. That is the intent, not a measurement.

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

## The weapons

Five, made at the Armory: sword, bow, and three staves — fire, ice and storm.
Each levels on its own to 3, and the **Armory's level is the cap**, so improving
the building opens the next tier of everything at once rather than unlocking one
more thing from a list.

They used to arrive on a timer — sword at zero finished levels, bow at one,
staff at two. That is a schedule, not a decision: it happens TO you, in the same
order, whatever you did with the run. Now the whole rack is visible from the
first visit and most of it is empty, which asks the question the town asks —
what is this run for?

**The three staves share a cast and differ in what they leave behind.** One
"magic" that bursts a group is a delivery method; these are three answers to a
board:

| staff | what it leaves |
| --- | --- |
| Fire 🔥 | a **burn** — the only damage in the game that lands while you are somewhere else |
| Ice ❄ | a **chill**, and the widest burst: a wave that arrives late arrives into towers that have reloaded |
| Storm ⚡ | an **arc** to nearby enemies, each hop worth `CHAIN_FALLOFF` of the last |

**The storm staff is not new.** The staff was already a lightning spell before
the rack existed, so it keeps the reach, the damage and the bolts it had — Lv1 is
exactly what it always did, and what it gains is the arc. Mapping the old
`staff` to fire would have handed someone a different weapon and called it
theirs; `migrateWeapons` maps it to storm.

Three rules the combat code holds to:

- **A status REFRESHES, it does not stack.** Two casts on one enemy should mean
  it burns for longer, not twice as fast — stacking makes "cast it again" the
  only tactic there is. The stronger chill wins, so a levelled staff is never
  worse than the cast before it.
- **A burn is QUIET.** It ticks every `BURN_TICK` on everything it caught; at the
  fight's own volume ten burning enemies are a wall of noise, and the hit flash
  would hide the hits you actually landed. It still flashes, in its own colour,
  because damage arriving from somewhere you are not has to be visible.
- **Chilled things LOOK chilled.** A slow that is only visible in the arithmetic
  is a slow nobody believes in, so the tint lasts as long as the effect does.

Forging is the same verb as everything else: walk to the pedestal, press the
button. One button, in the order you would want it — **make it, pick it up, make
it better** — which is what lets the Armory have no menu. Forging also equips,
because making a weapon and then being asked to pick it up is a second press for
nothing.

### Making one, exactly

You always have the sword, and it is the only one with no forge cost — you are
never weaponless, so the Armory is somewhere to GO rather than something you
must visit before the game will start. Everything else is bought out of the same
`store` of gold, wood and stone the town is bought with, and the purchase writes
the save on the spot.

**Nothing can be forged until the Armory is built.** Its level is the ceiling:
`min(WEAPON_MAX_LEVEL, town.armory)`, so a Lv2 Armory makes and improves every
weapon to Lv2 and refuses the third for all of them together.

`rackAction(id)` is the whole rule, and the order matters more than it looks:

| you are standing at | it offers |
| --- | --- |
| a weapon not yet made | **forge** — and forging equips it too |
| a made weapon you are NOT holding | **take** |
| the weapon you ARE holding, under the cap | **improve** |
| anything else | nothing; the button denies |

The consequence worth knowing: **you improve the weapon you are carrying.** Walk
to a staff you do not hold and the first press takes it; the second improves it.
That is what makes one button enough, and it is also why forging equips — a
freshly made weapon is already the one the next press improves.

Costs live in `weapons.ts`: `forge` for the first step, `upgrades[0]` and
`upgrades[1]` for the two after it. `nextCost(id, level)` is the one function
that answers for both, because from the player's side making and improving are
the same act — walk up and pay.

The card is the only place the game explains a button that will not work, so it
names the reason rather than going quiet: *The Armory has not been built* ·
*Needs Armory LvN* · *Fully forged* · or what materials are still missing.

**The rack's positions live in two files** (`RACK` in `hub.ts`, `PICKUPS` in
`tools/gen-scene.mjs`) and must agree — one stands the pedestals, the other
decides what you are standing at. Spacing is 1.25 against a 0.9 "standing at"
radius: at 1.0 you are at two pedestals at once and the prompt flickers between
them as you breathe.

**The Armory is off the hub's centre line.** At x 0 its Lv3 building stood
squarely in front of the exit door and hid it, and the one thing in the hub a
player has to be able to find is the way out.

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
Particle Pack (CC0), and **`tools/pack-vfx.py` (`npm run vfx`) is what
cuts it** — the mapping from cell to source file lives in that script's table
and nowhere else. It exists because the first packing script was not kept, and
recovering which cell was which meant comparing all sixteen against ninety-odd
source files pixel by pixel. That is an afternoon to answer what a table
answers.

`FRAME` indexes the sheet BY POSITION, so the table and `FRAME` change together
or every effect in the game silently draws something else.

Four cells originally held `arcA`/`arcB`/`twirl`/`slash` and nothing ever drew
one. They are `flameA`, `flameB`, `iceShard` and `frostRing` now: fire and ice
needed shapes of their own far more than the atlas needed four unused ones.
Regenerating reproduced the twelve surviving cells pixel-for-pixel (measured —
mean difference 0.00), so nothing that was already drawn changed.

**One texture, loaded once** — a texture per effect is a texture per cast, and
the whole point of one sheet is that every spell in the game can share a single
material.

`quads(vfx, list, opts)` draws any number of textured quads as ONE mesh: one
`BufferGeometry` of four verts and two triangles per quad, rewritten every frame
from the quad list. Three modes, which is the whole vocabulary:

- `face` — always square to the camera. Flares, bursts, sparks.
- `ground` — flat on the floor, optional `roll`. Runes and scorch marks.
- `beam` — stretched from `at` to `to` and rolled to keep its flat side towards
  the camera. Bolts, and anything that runs between two points.

Three composites, one per element, each ONE `quads` call — `flames`, `frost` and
`lightning`. They differ in MOTION, which is most of what an element is: flame
climbs and widens and leaves a scorch that outlives it, frost races out and
holds, lightning strikes and is gone.

**Additive over bright grass eats colour, and area is the answer, not alpha.**
Measured against a no-cast control (the scene animates either way, so a bare
before/after measures enemies walking): fire at alpha 0.9 shifted the picture by
(+4.6,+3.1,+4.1) — a neutral grey, because an additive white sprite clips every
channel and takes the hue with it. The same cast at 0.62, with more tongues to
make up the presence, shifts it (+30,+15,+8), which is orange. Ice reads
(+25,+42,+75) and the bolts (+20,+26,+38).

**A burst is a GROUND effect and is cast at y 0**, not at the target's own
height. Casting it on a flying enemy put the scorch, the rings and the crystals
two metres up where nothing could see them; the bolts never showed this because
they run sky-to-ground and reach the floor whatever height they start from.

`lightning(vfx, at, opts)` composes them into the storm staff's strike: five `beam`
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

`arcBetween(vfx, from, to)` is a live arc between two MOVING points — it holds
the enemies' own position vectors, not copies, so the bolt stays joined while
both ends keep flying. The storm's hops used to flash at each enemy in turn and
leave the connection to be inferred, under a comment saying a connected beam
"needs a primitive this game does not have". It does now; that is what `beam`
is.

**A cast lasts about 1.2 seconds, not half of one.** Half a second is long
enough to SEE and too short to watch — and the lightning's own uploaded sound
does not reach its loudest point until 1.2s in, so the bang was landing on an
empty patch of grass. Lengthening is not just a bigger `life`: the bolts flicker
only through the first third (`STRIKE_FRACTION`) and hold still for the rest,
because re-jittering at the same rate for three times as long turns a strike
into a strobe.

### What an element leaves on what it hits

Every element marks its victims, and for a while only one did.

| element | mark | for |
| --- | --- | --- |
| fire | orange tint, and a flame off the body every second bite | the burn, 3.5s |
| ice | blue tint | the chill, 3s |
| storm | pale flash | 0.8s — struck, not a status |

The storm's mark started at 0.26s, which is a mark you find in a frame grab and
miss while playing: a probe reading the state 300ms after the cast already found
it gone, and that is the same question an eye asks.

**A wave starting has a sound of its own** (`enemy-spawn.mp3`, uploaded), in
place of the jingle. It was one per ARRIVAL first, which is a real cue — the
gates are at the far end of the board and you spend the wave somewhere else —
but fourteen a wave is the board talking over the player, and two announcements
on the same frame is one announcement nobody hears.

**Fire is the one this mattered most for, and it was the one with nothing.** Its
whole identity is damage that happens while you are somewhere else, and it said
so in the arithmetic only. It also killed on contact: direct damage of 3/4/5
plus the Range bonus is 6/7/8 against a wave-one saucer's 10, so the burn never
got a chance to be seen. The tap is 1/1/2 now and what came off it went into the
burn, which is where fire's damage is supposed to live.

**Everything the player grows has to reach the burn.** The Range bonus and the
level multiplier and the double-strike crate all landed on the direct hit, which
on a burn weapon is the part that is not the point — so the more you grew, the
more fire played like a weapon that kills on contact. The bonus arrives as +1
TOTAL spread across the burn (`+heroDamage / effectSeconds`), which is exactly
what every other weapon gets for the same building, delivered the way fire
delivers.

**A per-enemy effect is not a per-cast effect.** The burn's flame runs once per
BURNING ENEMY, so a wave caught in one burst is ten of them at once against a
whole-level budget of about twenty draws. It fires on alternate bites and uses
three tongues instead of thirteen. `MAX_LIVE` is the backstop, but a backstop
that is hit every fight is a design whose effects get eaten at random.

**`flames()` draws a scorch and a glow on the FLOOR, and the saucers fly.** Pass
`decals: false` for anything burning in mid-air, or the scorch mark hangs two
metres up — the same bug the burst itself already had once. Its `step` used to
skip `i < 2` to get past those two decals, which left the first two tongues
standing still in exactly the case the option exists for.

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
`verify-3d-town`, `verify-3d-armory` (forging, the Armory cap, and that a save
from before it keeps the weapons it had earned), `verify-3d-dev`,
`verify-3d-staff-audio`, `verify-3d-elements`.

`verify-3d-staff-audio` does not ask whether `play()` was called — that passes
for a clip that 404s, and a missing audio file is silent with no error at all.
It patches `AudioBufferSourceNode.start` and reads the DURATION of the buffer
that actually reaches the speaker: the three uploaded casts are 2.0s, 3.0s and
4.0s, so the length of what started is proof of which FILE played. Both engines
(`… <url> webkit`), because audio is where they have differed before.

`verify-3d-elements` asks what each element leaves ON what it hits, which is
the half of an element that no damage number shows. It ARRANGES the crowd it
needs — the storm only hops when there is somewhere to hop to, and measuring
that against whatever the wave happened to look like passed locally and failed
on the deployed build running identical code, because that board was thinner
that run.

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
