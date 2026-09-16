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
| `src/hub.ts` | the hub: the weapon rack, the town plots, the door |
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

| board | theme | road | lanes | what it introduces |
| --- | --- | --- | --- | --- |
| Meadow | grass | 38 | 1 | the game — this is the board that teaches |
| Frostfall | snow | 38 | 1 | ice: you cannot turn sharply and you overshoot |
| Rivermeet | grass | 32 | 2 | the fork, and a river in YOUR way |
| Crossroads | grass | 22 | 2 | the fork on OPPOSITE walls |

**One new thing per board, and the first two do not fork.** Every board used to,
including the first one anybody plays — so the game's second-hardest idea
arrived before its first one had been explained.

Taking the fork off a board takes ROAD off it, and road length is exposure: the
same wave table that Meadow had been winning with eight lives left lost on wave
four, because every saucer spent a sixth less time in front of the guns. Both
single-lane boards were wound back out to 38 cells. A board's difficulty lives
in its polyline at least as much as in its wave table.

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

**The first waves of the first two boards do not shoot back.** Learning where a
tower goes and learning to dodge are two lessons, and they were arriving on the
same wave: a measured run on Meadow reached wave seven with SEVEN of ten lives
still up — the base was never in trouble, the hero was being shot to death while
walking between build spots.

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

**A tower can be taken down again**, for 60% of everything put into it — build
price and every upgrade. Not 60% of the base cost: refunding only that would
make selling a levelled tower a punishment nobody takes, and then "sell it and
put something better here" is a feature that exists and never gets used, which
is the exact thing it was added for.

**Hold the build button to sell. There is no confirmation box.** The HOLD is
the confirmation — six hundred milliseconds is not something a thumb does by
accident, and letting go before the bar fills cancels, which is safer than a
dialogue where the wrong answer is one tap away either way. A dialogue would
also be worst exactly when you sell: late in a board, with a wave already
walking, and a modal has to disable the touch layer and cover the field while
the enemies keep coming. It would also be a THIRD button on a control layer
this game has already drawn over five times.

**A release past the dead zone does NOTHING.** On a tower the button has three
outcomes, not two: under the dead zone is an upgrade, past it but before full is
a CANCEL, and full is a sale. An early release used to fall through to the
upgrade — "just a slow tap" — so holding halfway, thinking better of it and
letting go bought an upgrade nobody asked for, which puts the two gestures back
on top of each other. Off a tower there is no hold to cancel, so a slow press
there really is just a slow tap and still builds.

**There is a DEAD ZONE at the start of the press.** The same button upgrades on
a tap and sells on a hold, and the sell ring and the word appeared from the
first frame of any press — so every upgrade flashed the destructive reading of
the button on the way through, and upgrading felt like a cancelled sale.
Nothing is drawn for the first 200ms; after that the ring appears empty and
fills over the remaining 600. A press shorter than the dead zone is an upgrade
and looks like nothing else.

Four things it has to get right:

- **`consume()` fires on the PRESS.** Wiring a hold onto it naively means a
  long press upgrades the tower on the way to selling it — you pay the upgrade
  and get 60% of a bigger number back, a net loss dressed up as a feature. The
  press is only REMEMBERED; what it meant is decided on release, or when the
  hold fills.
- **It still has to go through `consume()` rather than `held()` alone.** A press
  that begins and ends between two frames never appears in the held set — that
  is what the latch is for — and on a phone at eight frames a second that is an
  ordinary tap.
- **The hold is measured in REAL time, not game time.** `dt` is clamped at 0.05,
  so a struggling phone would otherwise want the button held for a second and a
  half. A hold is a thing a finger does, not a thing happening in the world.
- **A probe's page must be the one in FRONT, and its run must still be running.**
Chromium throttles a background tab's `requestAnimationFrame` almost to a stop,
so a probe that opens a second page and then measures the first is reading a
frame loop that has barely run — stale positions, a frozen ring, a `buildCell`
from minutes ago. And a page left alone while another one works has had waves
arriving unattended the whole time: its run is over, and everything computed
only while `running` reads as absent rather than as finished. `verify-3d-td`
opens a fresh page for the placement-ring checks rather than reusing its first.

**A probe cannot TIME a tap on a slow scene.** At eight frames a second every
  timer is late by up to a whole frame, so neither `rAF` nor `setTimeout` can
  produce a press shorter than the 200ms dead zone — a "140ms tap" measured as
  315ms, which is a cancel, and the probe reported the upgrade broken. A real
  fast tap is press and release in the SAME TICK, and the latch is what makes
  that work: a press that begins and ends between two frames is still seen.
- **And it must sample cheaply.** The first version walked the scene looking for
  the ring on every sample, and 1400 objects a sample took long enough that the
  tap being measured became a hold — it sold the tower and then reported the
  dead zone missing. It reads `sellProgress()` and one `data-sell-tag` query.

**The feedback is ON THE TOWER**, all of it. A ring sweeps clockwise round the
cell as the hold fills, with the unfilled part behind it, and the word and the
price sit over the tower on a translucent pill.

**The ring is DEEP RED**, and it is the only red in the interface. Selling is
the one destructive thing a player can do on a board — the only action that
takes something away — so it gets a colour nothing else uses. Deep rather than
bright: a signal-red ring on a cartoon green board reads as an error message,
and this is a choice, not a mistake. The sparks AFTERWARDS are still gold: red
while you can still let go, gold once you have been paid.

Two things about drawing it that are only obvious once it is wrong. It sweeps
from the NEAR edge, because twelve o'clock on a ring lying on the ground is the
far side — directly behind the hero, who is standing on the tower, so the first
third of the sweep happened where nobody could see it. And the unfilled part has
to be carried at a fairly high opacity to stay red at all: under about a half,
green grass pulls a dark red olive and the two halves stop looking like one
ring. Selling it makes it come
APART — it sinks, shrinks and fades while sparks lift off the cell — because a
thing that blinks out on the frame a button fires reads as a glitch rather than
as a transaction.

The progress was six block characters in the prompt line at the TOP LEFT first,
which is the far corner of the screen from both the thumb doing the holding and
the thing being sold. A progress bar nobody looks at is a progress bar that does
not exist.

Two sizes that are not arbitrary. The ring is 0.56–0.72 of a cell: at 0.42 it
was completely hidden by the tower's own base and the hero standing on top of
it, and a tile is one unit across so this is as wide as it can be and still
belong to that square. And `RingGeometry`'s fourth argument is `phiSegments`,
not the start angle — dropping it type-checks perfectly, because every
parameter is a number.

**The corner prompt says nothing about selling.** It named the gesture on a
second row for a while, on the argument that a hold is invisible until
something names it — and then the teaching board started teaching it, once, at
which point a permanent reminder of a gesture you already know is the wall of
explanatory text this game took off the screen in the first place. The price is
still shown before you commit: it is on the label over the tower, which appears
the moment the hold arms.

Desktop gets `X`, because holding a KEY reads as a stuck key rather than a
gesture.

`dissolve()` in `src/vfx.ts` takes the object OVER — the caller must already
have taken it out of its own list, or the game keeps shooting with a tower that
is dissolving. It clones each material first: a tower's meshes come from
`cloneOf` and SHARE their materials with every other tower of that kind, so
fading the original fades the whole board.

What actually binds on a board is the tower CAP, not the gold — so selling is
mostly about freeing a slot and a position, which is another reason it has to
be quick.

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

**The storm's chain sets off from the enemy FURTHEST from the blast**, not from
whichever came first in the array. The burst reaches 2.6 and a hop reaches 2.4,
so everything within a hop of the middle is already in the struck set — a chain
starting from a central enemy has nowhere to go and silently does nothing, which
was most casts. `verify-3d-elements` found it by arranging a line of enemies
wide enough to need a hop; the probe had to be arranged CORRECTLY twice first,
because a tight knot inside the blast radius is also a cast with nothing to hop
to, and that looks identical.

**Nothing is selected when a run starts, and the placement ring belongs to the
selection.** Tap a weapon in the bar to choose it, tap it again to un-choose;
the gold ring on the ground is drawn exactly while something is chosen.

The ring used to be drawn whenever the cell under you was buildable, which on a
board with sixty build spots is ALWAYS — a circle trailing the hero everywhere
with nothing on screen tying it to anything, and read by more than one person as
the staff's blast radius. The first fix was "show it only once you stand still",
which removed the trail and explained nothing: a circle that appears when you
stop still never says what it is ABOUT. Tying it to the hotbar does, in both
directions — it appears because you chose that, and it goes when you un-choose
it — and it needs no timer, no fade and no frame-rate reasoning.

Starting empty is the other half. A default is a decision the game makes for
you and then charges you for, and with one pre-selected there was a ring on the
grass from the first frame of every run with nothing to connect it to. Pressing
build with nothing chosen says so out loud, because a button that does nothing
in silence is a button that looks broken.

The corner brackets still mark every buildable cell the whole time. That is the
division: the brackets say "you can build here", which is cheap and always
wanted; the ring says "and THIS is how far the thing you picked reaches".

**A tower you are standing ON keeps its green ring at all times.** That is a
real object's real reach rather than a hypothetical, and nobody mistakes it for
a spell.

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

## The village wall, and the sky

**The boards have no wall and the village does**, and that is not an
inconsistency. A board is a CLEARING — what stops you there is an invisible
collider inside a tree line, because a forest edge built to seal perfectly is a
fence with leaves on. The village has a GATE in it, and a gate standing in a gap
between two trees guards nothing; the door read as scenery somebody had left on
the grass.

It is the same box that stops you, made visible: thin, brown, 1.2 high, the
same family as the door frame beside it. A modular STONE wall from Kenney's
Castle Kit was tried first and was wrong — correct, tileable, and a fortress
rampart around a cartoon village with a little wooden arch in it. **The version
this game already had, before the walls came down, was the right answer**; it
was in the commit before `7813086`.

All five sides share the NAME `village_wall` so `merge.ts` folds them into the
mesh the rest of the village furniture is in. Five boxes is five draw calls
otherwise, and the hub measured 42 instead of 34.

### Clouds are painted into the sky, not hung in the world

`src/sky.ts` builds a canvas and hands it to `scene.background` as an
equirectangular texture. Geometry was tried first and is wrong twice over:

- **This camera shows almost no sky.** It sits 3.6 above the hero and looks
  down, and the TOP EDGE of the frame points two degrees BELOW horizontal. The
  blue at the top of a screenshot is not sky overhead — it is the background
  showing past the last row of trees, in a band eight degrees deep between the
  treetops and the top of the frame. Clouds placed at any sensible height were
  in the scene, merged, drawn, and entirely off screen.
- **A distant object wrecks the shadows.** The SDK fits every directional
  light's shadow camera to the bounds of everything it LOADED, `castShadow`
  or not. A ring of clouds thirty units out took the hub's shadow radius from 8
  to 37 with the same 1024 map — a twentieth of the resolution, which showed up
  as a soft grey smear across the grass that nothing in the scene explained.
  Anything decorative and far away belongs outside the scene file.

The same trap appears once more inside the texture: the visible band is BELOW
the horizon line, so the clouds are painted just under the middle of the
equirect image. Painting them where clouds obviously go put them all in the part
of the texture nothing renders.

**And a canvas gradient is resolved in the user space current at FILL time.** A
radial gradient built at `(px, py)` and then `translate(px, py)`-ed lands at
twice the distance, outside the circle being filled, so every blob painted its
outermost stop — which was transparent. The whole sky drew, without error, and
produced a clean gradient with nothing in it.

## What the hub no longer has

**No leaderboard.** It ranked runs by the wave reached — one number out of a
game that has four boards, five weapons, a village and a player level, and no
honest way to say which run was better. It cost a sign to walk to, a panel, a
`gameData` key, a submit on every run and a section of `verify-3d-hub`, and
paid for none of it. The probe checks it is GONE rather than that it works.

**No greeting.** "Welcome, <name>" was the first thing on screen every single
time. A line that tells you something you already knew is a line you stop
reading, and it takes the line beside it — the purse — down with it.

## The card over a building

One shape, CENTRED, with a rule under the name — the same for a town plot and a
weapon on the rack:

```
              NAME
    ─────────────────────────
           what level it is

        what it does for you

    what the next level costs
       the button that does it
```

It was a left-aligned stack of `Now: …` / `Lv2: …` / `Cost: …`, which reads as
a form rather than as a sign over a building: three colons down the left edge
and the actual numbers never in the same place twice.

The body says what the NEXT level gives you, not what this one already does —
standing at a building you are deciding whether to pay, and what you are paying
for is the step. The weapon card keeps its blurb and its blocker in different
slots: "Locks on at range · The Armory has not been built" was one sentence
made of two unrelated thoughts.

## The shop

A stall you WALK TO, in the middle of the village. Standing at a thing and
pressing the action button is this game's one verb — it builds a tower, takes a
weapon, upgrades a building — and a shop reaching for a different one would be
a second interface to learn. It cannot be one of the things it sells, so it is
always there.

**It sells the FIRST level of a thing and nothing else.** Upgrading stays where
it was: walk to the building and press the button in front of it. Buying is a
one-off choice between things you do not have, which is what a list is for;
upgrading is a repeated decision about a thing you can SEE, which is what
standing in front of it is for.

The panel is a page — a list on the left, what that one is on the right — at
`min(860px, 86vw)`. A catalogue wants room for two columns, and a catalogue
inside a card over someone's head is a card with a scrollbar in it. The board
list beside it is a short menu and keeps its own width, which is why
`closePanel` puts the width back.

It also goes in the same direction as everything else the hub stopped showing:
a bought thing leaves the list, so the shop never offers what you already own.

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

## Teaching

The first board teaches itself, in `src/tutorial.ts` plus the steps built in
`startLevel`. `teaches: true` on Meadow is the whole switch, and it runs while
Meadow is UNCLEARED rather than on a first visit — losing your first run and
coming back to no help is the moment help was for.

Not a paragraph. This game's rule is that explanation happens WHERE the thing
is, and a tutorial is that rule with an order imposed on it: one line at a time,
above the hotbar, gone the moment it is true. There is no "next" button —
pressing a button to dismiss an instruction about pressing buttons teaches the
wrong button.

Two things hold it up:

- **The first wave does not start until you have built something.** A tutorial
  you can lose while reading it is not a tutorial. `gateWaves` on those steps.
- **Steps that name an OPTIONAL thing expire.** "Upgrade a tower" waits for
  something a player may reasonably not do for two minutes, and a step that
  waits forever is not an instruction, it is a permanent banner. A probe found
  this by doing everything except the optional thing, which is also what a
  player does. A step that gates the waves may never expire.

Timed in `realDt`, not `dt`. `dt` is clamped at 0.05 so a slow scene runs the
world in slow motion — anything measured against a PERSON rather than against
the world (how long a line has been readable, how long a button has been held)
uses the unclamped one.

## What the hub does not show

**A board you cannot play is not in the list, and a weapon you cannot make is
not on the rack.** Both used to be shown greyed out, on the argument that an
empty plinth is the thing you are saving for. That reads well with five and
badly with twelve: it tells a new player exactly how long this game is, and this
game is meant to keep getting boards and weapons. Four rows with three padlocks
is a progress bar with a known end, and adding a fifth board later would visibly
move the finish line.

What IS shown is everything you have, plus one step past it. For boards that is
the next one you can play, and a line at the bottom saying which board opens the
next; for weapons it is **as many empty plinths as the Armory has earned** —
one before you build it, one more per level after.

The first version showed exactly the NEXT unforged weapon, which quietly turned
the rack into a QUEUE: you could no longer save for the storm staff and skip the
bow, and choosing what a run is for is the entire point of the Armory. It also
broke forging outright for anything but the next one, and `verify-3d-armory`
caught it. Tying the count to the building keeps the choice, gives the upgrade
something visible to do, and a sixth weapon added later appears at a higher
Armory level rather than lengthening a catalogue.

`pedestal` is deliberately **not** in `merge.ts`'s `CASTS` set. An entity folded
into a merged mesh has no visibility left to turn off, and plinths now appear
one at a time. Five cylinders is five draw calls at the very most.

## Balance is measured, not chosen

`umicat-infra/playwright/verify-3d-balance.mjs <url> <level>` plays a real run
with a fixed competent strategy — **walk** to a spot, build, upgrade when it can
afford to, open crates, keep out of the shooting — and reports where it gets to.

Where the boards stand, as measured — **after** the bot was taught to break off
when hurt. Everything measured before that was measured by a bot that would
stand on a build spot at fifteen health, so those numbers are not comparable and
are not kept here.

| board | result | which way it ended |
| --- | --- | --- |
| Meadow | wave 7 of 8, 9 of 10 lives | the HERO fell |
| Frostfall | wave 9 of 10, 12 of 12 lives | the HERO fell |

**Both boards end the same way, and it is not the towers.** The base is all but
untouched in each — the hero dies on the last wave or two. That is what raised
the wave-clear heal from 25 to 40 and health drops from a tenth to a seventh:
you are a character on the board, you spend every wave walking through the fire
to reach the next build spot, and no wave table fixes that.

**Fewer road cells is not a gentler version of more.** Frostfall at 25 cells lost
the base on wave six; at 38 it reached wave nine with every life; pulled back to
33 — the obvious middle — it was sharply worse than either, leaking from wave
three. Road length is how many guns can see the same saucer, and the falloff is
not linear. Measure the guess; do not interpolate it.

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
- **The bot has to look after itself, or it measures a board nobody plays.** Its
  retreat lived under `if (!acted)` — it only ran on a turn with nothing else to
  do, and this bot always has something else to do, so it would walk to a build
  spot beside the road at fifteen health and stand on it. That was survivable
  while every board forked and there was a quiet half to be accidentally
  standing in. On a single lane it showed up every run: four Frostfalls in a row
  ended with the hero dead and the base on eleven or twelve of twelve lives. It
  breaks off below 42% now and waits for the wave-clear heal — the same run went
  from wave six to wave nine, which means every board conclusion drawn before
  the fix was drawn from a broken instrument.
- **Say WHICH loss it was.** The result line printed "the base fell" whatever
  happened, including a run that ended with seven of ten lives still up. The
  base falling is a tower problem and the hero falling is a survivability one,
  and they want opposite fixes.

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
- **Nothing in this game's own UI is an emoji.** `src/icons.ts` and
  `public/icons/` (`npm run icons`), drawn as CSS MASKS — `mask-image` plus
  `background: currentColor` — so one file is a white button glyph, a gold coin
  counter and a red warning, fetched once for all three. Three reasons, all of
  which only show on a device: an emoji is a different drawing in every
  platform's font (`🗼` is Tokyo Tower), it is TEXT and text can be SELECTED
  (long-pressing the attack button is how the iOS Copy / Look Up / Translate
  callout came up mid-fight), and it ignores `color`, so a disabled row and an
  affordable one had the same bright glyph in them.

  Two of the set are PNG rather than SVG: the Game Icons pack ships its vectors
  as one sheet, and a mask reads the ALPHA channel, so a white-on-transparent
  PNG serves exactly as well.

  **HUD icons run at 1.25em, not 1em.** A silhouette needs more room than a
  letter of the same nominal size — at 1em the tower's rook read as a small
  white square.

  A `showX()` that only runs on click leaves its button EMPTY until the first
  press, which is exactly as visible as a button that does not work. The mute
  button spent a build like that.

  **An icon is an ELEMENT, so a string carrying one is HTML — and nothing types
  that.** `iconHtml(...)` into a `textContent` sink prints four hundred
  characters of `<span style=...>` where a coin should be. It shipped: the
  hub's purse went out reading its own markup across the top of the screen,
  with nothing thrown and every probe green, because no check read that
  particular element. `rawMarkup(page)` in `pw-level.mjs` asks the WHOLE page
  instead, and the hub and town probes call it.
- **The right-hand buttons are SHAPES, not emoji** (`src/icons.ts`,
  `public/icons/`, `npm run icons`). Three reasons, all of which only show up on
  a device: an emoji is a different picture in every platform's font, it is TEXT
  and text can be SELECTED (long-pressing the attack button is how the iOS Copy
  / Look Up / Translate callout came up mid-fight), and it ignores `color`, so a
  glyph could never match the controls beside it. They go to `Input3D` as URLs
  and are drawn as CSS masks. **The attack button follows the weapon** — one
  control, five meanings, and a sword on a button that fires arrows is a lie.
  The bottom weapon hotbar is a separate design and is not part of this.
- **The platform's touch layer is full-screen at z-index 10.** Anything the game
  draws on top of it needs to say so, and `input.setEnabled(false)` before a
  modal. This has bitten FIVE times: the attack button under the jump button, Play
  Again, the HUD under the controls, the board-list panel, and the hotbar —
  which wrapped to two rows when the smithy took it from four cells to seven,
  became a block over the left half of a portrait phone, and made the game
  unplayable because the thumbstick was underneath it. The row is
  `pointer-events: none` with `auto` on the cells, never wraps, and
  `verify-3d-jump-touch` now checks that the stick is reachable.
- **A hotbar cell is a PICTURE OF THE MODEL and a price.** Nothing else — the
  corner prompt already names what you are standing on and what it costs, in
  full, and repeating that in a 40px cell only clips it. The picture is rendered
  at boot from the tower's own model (`src/thumbs.ts`), with the game's
  renderer into an offscreen target — a second WebGL context is a second set of
  every shader, and browsers cap how many can exist. Change a model and the icon
  changes, because there is nothing else to change.

  It was an emoji: a different drawing in every platform's font, never the thing
  you are about to place (the bastion is a cannon on masonry; the glyph was a
  Japanese castle), and stale in silence whenever a model changed.

  **A mount is photographed ON its masonry.** The first version rendered the
  weapon alone, reasoning that at 40px the stone would be most of the picture —
  and the result was that the ballista and the watchtower were the same picture
  at 25g and at 120g. The stone is exactly what tells them apart, which is why
  it costs four times as much. `verify-3d-hotbar` checks no two cells share a
  picture, on the FULL rack: the mounts need a smithy, so four cells cannot see
  this at all.
- **The hotbar cells show no shortcut number.** They carried `1`-`7` under the
  price, and on a phone — which is where this is played — there is no keyboard
  for that to mean anything about: a line of digits nobody can act on, in the
  most crowded strip of the screen, at a size where the labels are already
  clipping. The KEYS still work; only the caption is gone, until the hotbar gets
  a design of its own. This is a casual game and it does not ask for fast hands.
- **The hotbar dodges the buttons SIDEWAYS, and only climbs as a last resort.**
  Climbing is the wrong first move because the button cluster WRAPS: clearing
  the bottom row lands you in the row above it. The same seven cells that caused
  the wrap above then caused this — a thirteen-pixel horizontal overlap sent the
  bar two hundred pixels up the screen, into the middle of the board, and it
  looked for all the world like a layout that changed its mind about where the
  hotbar goes. Sideways costs nothing: the left half of the screen belongs to
  the thumbstick ZONE, which is half the screen and has no edges to collide
  with. It stays centred whenever centred fits.
- **Never copy one kit's `Textures/` over another's.** `cmp` first. Doing it
  once turned the grass orange and every check still passed.
- **The readout sits on a PLATE** (`src/hud.ts`, shared by the hub and the
  levels). White text on a white cloud is not text: the HUD had a shadow, which
  is enough over grass and snow and nothing like enough over the clouds that
  arrived in the sky — the top-left corner, which is where the lives, the gold
  and the wave are, went unreadable at certain camera angles. No
  `backdrop-filter`: a blur is a read-modify-write of every pixel under it, and
  this game is drawn on phones.

  A plate turns two things that used to be invisible into visible holes.
  `opacity: 0` still occupies its row — the hub's greeting fades after five
  seconds and left a permanent blank stripe — and an empty prompt line is a
  stripe of padding with nothing in it. Both collapse now.
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
`verify-3d-staff-audio`, `verify-3d-elements`, `verify-3d-sell`.

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

**Run a probe with the machine to itself.** The warning below is written under
the balance bot, but it is not about the bot: anything measured in GAME time
gets slower when the box is busy, because `dt` is clamped. Running a second
browser alongside `verify-3d-elements` took an effect's life from "still on
screen at 0.8s" to "nothing there", and the storm's arcs from eight effects to
two — three red checks describing a machine, not a game. The same run alone was
green.

**A probe that never builds now waits for ever.** The teaching board holds its
first wave until a tower is up, and five probes walked straight into it: the
town probe reported that the Range bonus did nothing (there was nothing to hit),
the crates probe reported that double-strike did nothing (same), and the tower
probe reported that a leak does not cost a life — on a board where, with nothing
built, nothing spawns. Build one, or use a later board. `verify-3d-td` uses the
second board for exactly this, because "with NOTHING built" is the whole point
of that check.

**A probe outlives the mechanic it tests.** `available()` went when weapons
stopped arriving on a schedule and started being forged, and three probes were
still calling it; `'staff'` went when the one magic weapon split into fire, ice
and storm, and `setWeapon('staff')` does not throw — it leaves the hero holding
what it had, so the check read as "the buff does not reach the staff". Grep for
a removed name across `playwright/` in the same commit that removes it.

**Warning about a trap is not the same as not falling into it.** The town probe
carried a comment saying `undefined` damage would read as "the bonus does not
work" when the truth was "there was nothing to hit" — and then reported exactly
that, because the guard was prose rather than a check. It exits loudly now.

They ask about **effect**, not existence. "Is there a health bar" passed for a
bar worn at hip height; "is there a wave counter" passed for a game that could
never reach wave two.

### Pictures in the shop, and what they exposed

The detail pane photographs the building with `createThumbMaker` — the same
maker the hotbar uses, so the picture IS the model and changing the model
changes the picture. Two things about that:

- **Clone it and force `visible` on the clone.** The `town_<id>_<n>` models are
  hidden until owned, and an invisible object renders as a fully transparent
  image — no error, no warning, an `<img>` that is there and empty. Handing the
  live entity to the maker is worse: it leaves the hub's scene and comes back
  with its transform reset.
- **Photograph level ONE.** That is what the Buy button gives you. The level
  three model is a better picture of something you are not buying.

Checking `<img>` tags would have passed on both failures. `verify-3d-shop`
decodes the image and counts pixels with alpha, and separately asserts that the
five buildings produce five DIFFERENT pictures.

That last check is what found the real bug: the clinic and the armory both used
`town-stall-red` at level one, so two rows of the shop showed the same photo —
and the two buildings were indistinguishable standing in the village. **Model
collisions at the same level are bugs; collisions across levels are fine** (a
village repeats its architecture). There are 10 usable models for 15 slots, so
reuse is forced; the constraint is only that the five level-ones differ.

Measuring the GLBs to pick replacements — bounds come straight out of the JSON
chunk, no loader needed — turned up a second one: `bld-tower-a` is 2.5 tall and
`bld-tower-b` is 1.89, so the Range got SHORTER when you upgraded it to level
two. Chains are now ordered by measured size, not by the letter in the filename.

### Panels close in the top-LEFT corner, and must fit a 393px screen

Every panel that uses the hub's `panel` element (the shop, the board list) has
one persistent `[data-panel-close]` button pinned to its top-left, outside the
scrolling body so the `innerHTML` each panel rewrites cannot destroy it.

**Left, not right, and the reason is not taste.** umicat frames the running game
with its own pill for quitting it, top-right. A close button there sits a few
pixels from it — two round buttons, one dismissing a panel and one leaving the
game, and only one of them is undoable. The top-right corner of the screen is
the platform's; build into the corner that is ours.

This started as a report that the shop had no close button on a phone. It had
one — under the content, which on a landscape phone (**852x393 CSS pixels**) put
it below the screen edge with no scrollbar to hint at it. The panel was a trap.
Height is now `92svh` with a `92vh` line above it as the fallback, so the
browser chrome sliding in and out does not resize the panel under the player.

Fixing it moved the problem one element down: the **Buy** button, the entire
point of the panel, was then the thing hanging off the bottom. Whatever is at
the end of a panel is what a short screen eats — check the control you came to
press, not just the exit.

**And check it with `elementFromPoint`, not `getBoundingClientRect`.** The rect
version PASSED while a screenshot showed the button sliced in half by the panel
edge: a rect is where an element would be, and knows nothing about an ancestor
with `overflow: auto` having scrolled it out of sight. Hit-test both the top and
the bottom edge — half a button is not a button.

## Buildings are placed by the player

There are no plots. Four patches of dirt announced how many buildings the game
would ever have, and pinned every village to the same shape. You buy a building
from the shop, it goes into your HANDS, and you walk it to wherever you want it.

The save has `spots: { smithy: {x, z} }`. **A building that is paid for but has
no spot is one you are carrying** — which is also exactly what a game closed
halfway through placing one looks like when it comes back, so the interrupted
case needs no code of its own.

The gesture is the one the levels already use: **tap** the action button to act
on the thing you are standing at, **hold** it to take that thing away. Tap is
resolved on RELEASE, because otherwise a hold would fire the tap first.

### What placing one on your own feet does

You place a building on the cell you are STANDING on — the same rule as building
a tower. Switching its collider on at that moment shuts a solid box around the
hero: measured, not guessed, the character then could not move a single
centimetre. A placed building's body is held disabled until the player is 1.4m
clear of it (`settling`), and the frame loop clears that by looking at where the
hero IS, not by waiting a second.

Two more that only showed up when run:

- **Remember the ground height before anything lifts it.** Carrying raises the
  model; putting it back down by reusing whatever `y` it happens to have leaves
  the building placed, solid, and hovering a metre off the grass.
- **The nearest building, not the last one in the table.** Buildings can be two
  cells apart and the reach is 1.9, so the zones overlap — the old loop assigned
  `atPlot` to whichever match came later in `TOWN`, which meant standing between
  the Smithy and the Clinic upgraded the Clinic.

`blockedAt` returns the REASON, not a boolean, and the card prints it. A refusal
the player cannot read is a button that does nothing.

### Room to choose

An empty village has **42 of 81 cells** free. That number is asserted, because
keep-out zones are easy to add one at a time until there are six legal cells
left and choosing where a building goes is a formality.

### The handle says where you are

`__hub.standingAt()` names the building the hero can act on, and
`__hub.blockedHere()` returns `'nothing in hand'` — not null — when you are
carrying nothing. Both exist because probes got this wrong: one walked "1.2m
north of the Smithy" and pressed, which with buildings two cells apart landed
nearer the Range and upgraded that instead; another mapped the whole village as
buildable because `null` meant both "this cell is fine" and "there is nothing to
place".

## The village is bought, a ring at a time

It starts small and grows. `LAND` in `src/hub.ts` and in `tools/gen-scene.mjs`
are the same three sizes and **must stay in step** — the generator builds a wall
set and tags the trees for each one, and the hub decides which is up.

**The gate does not move.** Its frame and its sign are folded into a merged
mesh, so they could not — but it is the better design regardless: the way out is
the one landmark that should still be where you left it. The village grows
sideways and backwards, away from the gate, and `FRONT` is a constant.

### Switching a size on is two things, and half of it is silent

Each wall set is its own merged mesh (`ownMesh` in `merge.ts` matches `wall_\d+`
and `forest_claim_\d+` **by prefix** — a hardcoded list quietly folds a new one
in with the permanent forest). So showing a size is one `visible` per mesh, and
separately `setEnabled` on the five bodies that belong to it: merging leaves
colliders alone, keyed by entity id. Get one right and not the other and you
have a wall you walk through, or a wall that is not there. Nothing reports
either. `verify-3d-land` checks the mesh and the physics as two separate lists,
and then walks into the wall.

### Trees are tagged by the size that swallows them, not by ring

A tree carries the index of the first village big enough to enclose it, and
vanishes when that land is bought. Tagging by distance-from-centre looked
identical until the last expansion, when a bald strip appeared OUTSIDE the wall
where trees that were never going to be enclosed had been cleared anyway.

### Two things that would have trapped the player

- **The stall had to move inside the smallest village.** It sells the land that
  makes the village bigger; a shop you cannot reach until you have bought more
  room is a lock with its key inside it. `SHOP_AT` and the generator must agree,
  and probes should read `__hub.shopAt()` rather than write it down.
  **Then it had to move again, to the front.** Being inside the wall fixed
  reachability and left the real problem: the camera follows from BEHIND, so
  standing at anything near the back wall puts the camera OUTSIDE that wall and
  the masonry fills a third of the screen. By the gate the camera is always over
  open village. This applies to any building placed at the back too — the stall
  is just the one place a player has to keep going back to.
- **The stall wins over what is in your hands.** Its keep-out radius is wider
  than the distance at which you count as standing at it, so a building can
  never be placed there — and a player holding a building with nowhere to put
  it, who walks to the shop to buy the land that would make room, was told
  "Too close to the shop" and left holding it for good.

Walls only ever move OUTWARD, and the player is always inside the current one,
so a new wall can never close on them. That is why land needs no equivalent of
the `settling` dance that placing a building does.

### Room: count what fits, not what is free

The smallest village has **10 free cells but room for 5 buildings** — each one
placed takes a 3x3 of its neighbours with it. The assertion is on buildings that
fit, because the free-cell count says more about which size of village you are
looking at than about whether there is a choice. Land has to be breathing room,
not a toll: everything the shop sells must fit in the village it starts with.

## Two sandboxes, because unlocking everything hides the shop

`?dev` unlocks: every board, every weapon, a full store, and **every building at
max level** — which is exactly what the shop cannot be looked at with. Nothing
left to buy, no building to carry and put down, no land to expand into.

`?dev=shop` is the other half: the materials and the weapons, and the village
taken AWAY — empty, at its starting size, everything still for sale. It writes
`town: {}`, `spots: {}`, `land: 0` explicitly rather than leaving them alone,
because it has to override a REAL save; the whole point is to look at buying
things on an account that already bought them.

The rule they share: **the grind goes, the thing under test stays.** A sandbox
that skips the feature you opened it to look at is worse than no sandbox,
because it looks like it worked.

Three taps on the frame counter **cycles** — off, everything, rich-and-empty,
off. Two modes and one gesture, because inside the iOS app that gesture is the
only way in (the app builds the game's URL itself and passes nothing through),
and a mode you cannot reach from it does not exist on a phone. The banner says
which one is on: they hand you opposite villages.

## A building you cannot put down is a trap, not a purchase

The village fills up. At its smallest, **three badly-placed buildings can leave
no legal cell at all** — so "buy a building, then find nowhere to put it" is
reachable, and before this it meant holding it for good.

**Stopped at the shop.** A building is refused when there is nowhere to put it
(`roomForOne`, which scans rather than reasons — the answer depends on the size
of the village, where the other buildings ended up, and where the stall and rack
are, and all of those move), and also when something is already in your hands.
One at a time means there is never a queue of bought-but-unplaced buildings, so
"is there room for one more" stays a question about one building.

The refusal is shown **instead of the price**. "You cannot afford it" and "you
have nowhere to put it" are different problems and a run only fixes one of them.

**Land is exempt from both refusals.** It is the thing that fixes having nowhere
to put something, so it has to stay buyable in exactly the state where
everything else is not.

**And a save already in the corner can still get out.** Holding the action
button with something in your hands puts it back:

- picked up → back where it stood. Lifting a building frees its own cell and
  `blockedAt` ignores the building being asked about, so its old spot is always
  somewhere it may go. This is why picking one up can never strand you, and why
  only BUYING needed guarding.
- just bought → back on the shelf, materials returned **in full**. Nothing was
  spent on it, and charging for undoing a corner the game walked you into is
  charging for our own mistake.

The card offers "hold to put it back" only while the cell is refused — a player
standing somewhere legal does not need it, and a permanent version of that line
is the corner hint we already took off the screen once.

## The trail to the gate

A first-time player spawned in the village with a sword, an empty purse and a
shop that could not sell them anything yet, and **nothing said the gate was the
whole of what there is to do** — the village has no tutorial; `src/tutorial.ts`
is the first board's.

`src/wayfinder.ts` lays a line of chevrons along the ground from the hero to the
target. Along the ground rather than an arrow over the hero's head, because a
floating arrow says which way and nothing else — a trail says which way **and
how far**, and is read without being looked at.

- **Drawn from the hero's live position every frame**, not baked as a route at
  spawn, so it survives the player wandering off. No pathfinding: the village is
  open ground inside a wall, so the straight line IS the route.
- **A dark chevron under a white one.** White alone is legible on grass in a
  screenshot and much less so on a phone outdoors, and this village is almost
  entirely bright green.
- **A material per chevron**, because they fade in at the near end and out at
  the far one; one shared material fades all five together and the trail blinks
  instead of flowing.
- It shortens rather than overshoots when the target is close — a trail running
  past what it points at reads as pointing at something further away.

It runs **only before the first run**, and not while a panel is open or a
building is in your hands. An arrow that never leaves is the game not trusting
the player, and one that interrupts someone mid-placement is worse than none.

`verify-3d-wayfinder` checks the chevrons' world positions PROJECT onto the
hero→gate line: "is there a trail" passes on one pointing the wrong way, and
`group.visible` passes on five meshes at zero opacity.

## The title screen

One save, written as you play, and two questions: is there something to come
back to, and do you want to keep it. **Slots exist so a player who saves by hand
can keep more than one run; a game that never asks them to save has nothing to
put in a second slot.**

- **Continue says what you are going back TO** — `Lv 6 · Frostfall cleared · 2
  buildings`. "Continue" alone is a button you press to find out what it does.
- **It only appears when there is progress.** Not "does the save key exist":
  every session writes something, and a save holding nothing but defaults would
  light up Continue and drop the player into a village they have never seen
  having been told they were resuming.
- **New game asks first, and only when there is something to lose.** It destroys
  the only save there is. A confirmation over an empty save is a question about
  nothing.
- It wipes through `saves.set`, not `patchSave` — patching MERGES over what is
  there, and the one thing this must do is leave nothing behind.
- Skipped entirely under `?dev`, which overrides the save anyway.

It is also the session's first TAP, which is what unlocks audio on iOS. Nothing
tries to make a sound before it.

### One loading screen, and the title appears finished

**The clearing loads behind the loading screen**, which is already up and stays
up — the same loader the hub and the boards hand each other. The title then
appears COMPLETE. There is no moment where it is a flat panel waiting for a
background, because the background is what it was waiting for.

Reported as "a flash of a flat title, then a black gap, then the real one", and
all three were one bug. Three things came out of fixing it:

- **`hideLoading()` belongs to the title**, called right after it appends
  itself. Hiding it in `boot()` and then awaiting a scene left a black canvas
  with nothing over it for as long as the load took. It was a blink on localhost
  and seconds over a CDN — **and every probe here waited long enough to miss
  it**, which is why the check is throttled to a phone's bandwidth and samples
  every 250ms.
- **The title sits UNDER the loader** (z 95 against 100), so hiding it dissolves
  into a finished title rather than cutting to one.
- **The loading screen wears the same gold BALABOO, in the same place.** It was
  flat blue with dark letters, so the handover read as two title screens. Both
  stacks are centred, so the taller one pushes its heading up: the title's
  buttons were worth 29 pixels, and the loader carries a 44px spacer to match.
  Measured, not guessed — the flex `gap` applies to the spacer too, so the
  heading moves by `(spacer + gap) / 2`, and 58 overshot before 44 landed.

### It stands in a clearing

`title.json` is its OWN scene, not the hub from a nice angle. The hub is a
village with the player's buildings in it, wherever they put them, at whatever
size they bought — showing that before asking "Continue?" is showing the answer
before the question. The models are the ones the hub uses, so loading the hub
afterwards comes out of the browser's cache.

It falls back to the flat gradient if anything about it fails, silently on
purpose: **a title screen that cannot start because its BACKGROUND did not load
is a game that cannot start.** `verify-3d-title` is what stops that fallback
quietly becoming the thing everyone sees.

Two things this exposed:

- **You cannot `readPixels` the canvas to ask whether it drew.** WebGL clears
  the drawing buffer once a frame is presented, so a read from outside the loop
  returns transparent black for a scene that is plainly there in a screenshot.
  The title publishes `window.__title()` — meshes loaded, frames drawn, where
  the camera is — and the probe reads that.
- **The sky texture had a seam.** Clouds near the canvas edge were clipped, and
  an equirectangular map's two edges are the same meridian, so the cut showed as
  a vertical band. Each cloud now builds its shape first and paints it a second
  time a full width across when it is near an edge — calling the draw function
  again would consume more random numbers and paint a DIFFERENT cloud, leaving
  half of one on each side. It only ever showed because the title orbits the
  camera the whole way round; the hub never turns far enough to look at it.

Two bugs it was born with, both worth remembering:

- **`hidden` loses to an inline `display`.** The confirm dialog carried
  `display: flex` inline and `hidden` is a user-agent `display: none` rule, so
  it sat open over the whole title from the first frame. Toggle `style.display`.
- **A button's action must not be derived from how it looks.** `data-act` was
  `primary ? 'go' : 'new'`, which tagged "Start" on a fresh save as a Continue,
  because it is the primary button when there is nothing to continue.

### It broke every other probe, and the fix is in the harness

`window.__hub` does not exist until somebody presses something, so all 41 probes
hung. `pw-title.mjs` wraps an engine so every page gets an init script that
presses through the title — **an init script, because it also covers the reloads
in the MIDDLE of a probe**, which a line after `goto` does not. It presses
CONTINUE where there is one: pressing New game would wipe the save the probe had
just written, and the probe would then test a fresh village while reporting on a
prepared one.

Both harnesses wrap it — `pw-engines.mjs` AND `pw-prod.mjs`. Doing only the
first left `verify-3d-td` hanging, because game probes import their engine from
the platform harness too (28 of them do). `verify-3d-title` imports `chromiumRaw`
instead, being the one probe the screen is the subject of.

## Walls between the camera and the player turn to glass

`src/seethrough.ts`. The camera follows from BEHIND, so walking up to anything
near a wall puts the wall between the two — 1.2m of masonry across the bottom
third of a phone screen with the hero behind it. Moving the shop to the gate
dodged it for the one place a player must keep returning to; **every building
they put at the back has the same problem, and they place those themselves.**

### The test is in the ground plane, and that is the whole trick

A ray from the camera to the hero's chest **sails clean over** a 1.2m wall —
measured: the camera sits at y 3.6 and the ray cleared the wall's top edge by
90cm, so nothing ever faded and the first version looked like it did nothing.
The wall is not hiding the HERO. It is standing between the camera and the
village.

So the question is: does the line from where the camera is standing to where the
player is standing cross this wall's footprint, in x/z? That is exactly "the
camera ended up on the far side of it". Slab method, box padded by 0.35 so a
wall the line passes a hand's width from still counts and the test does not
flicker as the player walks along it.

### Three things that had to be true first

- **A mesh per SIDE, not per ring** (`wall_<level>_<side>`). Fading the ring
  ghosts the far side too, and you end up looking at the forest through the
  whole enclosure.
- **A material per own-mesh group.** `byLook` in `merge.ts` keys on how a thing
  LOOKS, so all fifteen wall boxes arrived pointing at one material object —
  fading one side faded the lot. Own-mesh groups now get `mat.clone()`.
- **Nothing special when `transparent` flips.** There was a `needsUpdate = true`
  here for a while on the theory that a drawn material needs its program
  rebuilt. It does not, and the line is gone — three.js reads `transparent` when
  it buckets the object and when it sets blending, both per draw. Removing it
  changes nothing at the same pixel: 84,72,59 solid and 152,92,64 faded either
  way.

  It is worth recording because of how it got written: the wall looked like it
  was not drawing, so a plausible fix went in and **a lesson was written down
  that had never been tested.** The wall was drawing fine; the pixels being
  sampled were BELOW its projection. The bug was in the measurement, and a
  speculative fix that survives next to the real one is worse than no fix — it
  reads as knowledge.

Opacity eases exponentially (`1 - exp(-dt/EASE)`) so it is frame-rate
independent; a fixed step per frame fades twice as fast at 120fps.

`__hub.glass(false)` turns the pass off, which is how `verify-3d-glass` proves
the other half of the claim: that the wall **was in the way**. It samples the
pixel where the hero's FEET are — his head shows over the top of a 1.2m wall, so
a chest sample comes back skin-coloured for a hero buried to the neck — through
a screenshot decoded in the page, because `readPixels` returns transparent black
once a frame has been presented.

### Buildings too

They are taller than the wall and the player puts them where they like, so
walking past one buries you behind it. `blockers()` hands the pass the wall that
is up plus every building that is STANDING — not the one in your hands, which
rides above your head, moves every frame, and never has the camera behind it.

`ownMaterials()` clones a material per object once. A GLB loaded twice hands
back two objects pointing at ONE material — the same thing that made `flashTint`
turn five enemies red for one hit — and the Clinic and the Armory are built from
the same stall, so fading one would fade the other.

**Footprints are re-read in `showTown`**, not once at startup: buildings move.

### What it costs

Measured, not asserted. Draw calls **46 → 47** with a wall faded, **57 → 58**
with a full village; the per-frame work is ten box-versus-line tests. Fading
moves an object into the transparent pass, which is the extra call.

The merged-mesh count went 18 → 24, because a wall ring had to become five
meshes to fade one side at a time. Two thirds of those are rings you have not
bought — hidden, never drawn.

## Materials are photographed; actions stay silhouettes

A silhouette is right for a BUTTON: it has to read at a glance, at one colour,
over whatever the camera is pointing at. It is wrong for gold, wood and stone,
which are things you are carrying rather than actions — a white outline of a
coin is a worse picture of a coin than a coin is.

`src/resicons.ts` renders them once per session and registers them with
`setPhotoIcon`. **The registry is keyed by the same `IconName`s**, so the purse,
the prices in the shop, the cards over buildings and the run summary all turned
colour without a single call site knowing it happened, and the action buttons
kept their silhouettes because they ask for different names.

### Only the coin comes from a model

The kits have nothing for "wood" or "stone" that survives being sixteen pixels
across. `td-rocks` is a flat scatter and photographs as a pale smudge;
`td-detail-rocks-large` is **mossy** — bright green, a fine boulder at the edge
of a board and a nonsense icon for stone; the trees and crates read as scenery
and cargo, not timber. So wood is three cut logs and stone is three blocks,
built from primitives in the game's palette and shaped to be legible small,
which is the one thing an icon has to be.

Cut faces get their own material — a log is just a brown cylinder until you can
see it has been sawn — and the stone is flat-topped and angular so it cannot be
mistaken for the logs next to it at a glance.

### Photos get more room than glyphs

`iconStyle` adds `scale: 1.22` to a photo. A silhouette is a solid shape filling
its box; a rendered object is lit, shaded and surrounded by its own air, so at
the same em it reads smaller and fainter. Done in `iconStyle` so no call site
has to know which kind it asked for.

`verify-3d-icons` checks how each one is PAINTED — a photo draws a background
image, a silhouette masks `currentColor` — and that the three are three
different pictures, since one shared render would satisfy everything else.

## The scripted tutorial

Its own board (`TUTORIAL` in `levels.ts`, `tutorial.json`), deliberately **not
in `LEVELS`**: it is not a board you choose, replay or place in the order — it
is the first two minutes of the game, once. A list entry would leave it sitting
there for good. It is entered as `levelIndex === -1`, which is why `scripted` is
`levelIndex < 0` rather than an id comparison.

**A brand new player is not shown the board list.** Walking out of the village
with `runs === 0` goes straight in: there is one place to go, so asking is a
question with one answer, and the first thing they would otherwise meet is a
menu of four boards with three padlocks.

### It cannot be lost, and that is load-bearing

Leaks do not cost a life here and the hero takes no damage. The script
**deliberately lets an enemy walk the whole road** — that is the step that
teaches you to swing at it — and a board that punishes you for following its own
instructions is not a tutorial. Both loss paths are live in the ordinary game
(`lives -= 1` on a leak, `endRun(false)` at zero hero health), so both are
guarded by `scripted`.

### Every step has to be completable

The rule the whole board exists for. Two places it nearly was not:

- **The upgrade step tops up gold if it has to.** The board hands out exactly
  the price of the weapon, the upgrade costs 20 more, and what the first enemy
  drops is a ROLL. A bad roll turns an instruction into a wall. Measured, not
  imagined: the first run through it sat on 0g under a step saying "press again
  to upgrade".
- **While a step names one square, the button does nothing anywhere else**
  (`onlyBuildAt`), and while it names one weapon the other slots are dead
  (`onlyKind`). An arrow pointing at one square, over a button that works on
  every square, is an arrow that lies.

### Two hits, then one — derived, not typed

The script says an enemy takes two hits and one after the upgrade. Writing `3`
would be writing down today's ballista: `DAMAGE_BY_LEVEL` makes it 2 and 3.4, and
the day that changes the dialog starts lying with nothing to catch it. So
`scriptEnemyHp()` returns the UPGRADED damage, which makes both claims true by
construction, and warns if `lv1 < lv2 <= lv1 * 2` ever stops holding.

The board's one wave entry exists only so the model is **preloaded** — a board
loads the models its wave table names, and an empty table made the first
scripted spawn throw. `firstWaveDelay: 999` keeps the wave loop from ever
reaching it.

### The instruction is a panel you dismiss, not a line in a gap

It sat at the bottom first, over the hero and the square it was pointing at.
Moved to the top, it sat over the health bar and the purse. **There is no gap on
a phone in landscape.** So it takes the middle, is READ, and is then not there
at all — and what is left is the highlights, which is what the player is meant
to be looking at.

The step's own `enter` fires **on the dismiss**, not when the step becomes
current: that is where enemies are spawned and where the gates below are opened,
and none of it should be happening behind a panel someone is still reading. The
highlights are null while the panel is up for the same reason.

### What the button is allowed to DO, per step

`allow = { build, upgrade, sell }`. Without it the script can be answered the
wrong way, and both ways were reachable:

- the step that says "press to upgrade" could be answered with a HOLD, selling
  the weapon the next three steps are about;
- the step that says "sell it" left the square free the instant it was sold, so
  a fresh weapon could go straight back on it — while the next instruction says
  nothing is guarding the road.

`sellProgress()` returns 0 when selling is not allowed, so the ring never even
starts: a sweep that fills and then does nothing is a control that lied.

### The tutorial points in CYAN, and it breathes

The trail points too, and in the same colour. `createWayfinder` takes a colour;
the village's stays white — it is the only thing pointing at anything there, so
it only has to be legible — and the tutorial's is the pointing cyan. **The
trail, the ring on the ground and the ring on the button are ONE instruction**,
and three colours make them three things that happen to be on screen together.

The upgrade step already had the trail; it was simply white, so it did not read
as part of what the panel had just said.


**Not gold.** Gold already means "chosen" in this game — the selected hotbar
cell wears a `#ffd54a` border — so a gold ring around the button the tutorial
was pointing at read as a second selection, and the two were indistinguishable
sitting beside each other. `POINT` is `#4fd2ff`, used nowhere else, and it holds
up on green grass and on the dark grey of the controls.

The breathing is **one stylesheet and a class**, not a per-frame write: sixty
`boxShadow` assignments a second is sixty style recalculations, and the browser
animates a keyframe off the main thread. The ring on the ground breathes on the
same 1.25s, so the mark on the floor and the mark on the button read as one
instruction rather than two.

A ring that sits there is furniture. A ring that breathes is asking to be
pressed.

### Everything but the thing to press goes grey

A full-screen scrim with a **hole** in it, `clip-path: path(evenodd, …)`.

Not a z-index sandwich: the action buttons belong to the SDK's touch layer and
the hotbar to the game's, each its own stacking context, and lifting a child out
of one of those above a full-screen overlay is not something a child can do. A
hole needs no cooperation from either.

`clip-path` clips **hit-testing**, not just paint, so the hole is the only live
part of the screen — everything else is dimmed AND dead. A scrim that only dims
still lets a lost player press the wrong thing, so the probe checks both: that
the button is reachable through the hole, and that the middle of the board is
not.

**Only for steps that name a CONTROL.** "Stand on the marked square" points at
the world, and the trail and the ring doing the pointing are IN it — a sheet
over the board would cover the only two things the player is meant to look at.

### A step with no text

`text` is optional. A step without it is pure staging — spawn something, open a
gate, wait for a result — and runs with nothing on screen.

Two of the nine are silent, and both were panels before: an enemy walks out of
the gate and the weapon shoots it, and the coin flies to the hero. **A box
saying "it shoots on its own" states the obvious and covers the thing it is
describing.** The player is not stupid; they can see a weapon shooting. The
steps still exist — they are what spawn the enemy and what give the coin's
flight a second and a half with nobody talking over it.

Six panels survive, and every one of them is an instruction:

    Tap the weapon in the bar below
    Stand on the marked square / Enemies come out of the gate beside it
    Press the ⟨build⟩ button on the right to put it down
    Stand on your weapon, then press the ⟨upgrade⟩ button on the right
    Hold the ⟨upgrade⟩ button on the right until it turns to ⟨sell⟩…
    Nothing is guarding the road. Chase it down and press the ⟨sword⟩ button…

### A beat after each result

`after` on a step: seconds to wait once it is done, before the next instruction.
**What a step teaches is usually the RESULT** — the weapon landing, the enemy
falling, the gold flying to you — and all of that happens in the second after
the step completes. A panel that opens the instant it is satisfied covers its
own lesson.

And no counting. "Two hits" was a number to verify rather than a thing to watch,
and it goes stale the day the weapon is rebalanced. The pacing still depends on
`scriptEnemyHp` deriving it — the pacing is felt, not read.

### An instruction names the button, where it is, and what it will look like

"Put it down" with an icon in front of it is a puzzle: the player has not met
that picture yet and has to work out which of the four circles on the right it
matches. Every step now says **"press the ⟨icon⟩ button on the right"**.

And the icon in the text is the one the button will be **WEARING** when they
press it. The upgrade step showed the `build` hand — the picture that button
stops wearing the very moment you stand on your own weapon, which is what the
same instruction told you to do. An instruction pointing at nothing.

The sell step carries BOTH: *hold the ⟨upgrade⟩ button until it turns to
⟨sell⟩*. The change is the gesture, so the change is what it shows. That is also
why `withIcon` is gone — a helper that puts one icon in front of a sentence
could not say it.

### The ring follows what the button is WEARING

The on-screen buttons are found by their icon, and that icon now changes with
where you stand. The sell step asked for `build` and rang **nothing at all**,
because by then the button said `upgrade`. Steps ask for `'action'` and the
level resolves it to whatever the button currently shows.

### What testing it on a phone found

Four things, and three of them were the same mistake: the board was telling the
player where to look and then standing in front of it.

- **The box belongs at the TOP.** Above the hotbar put it across the middle of
  the play area — over the hero, over the square the step pointed at, and over
  the enemy the step said to watch. Translucent did not save it.
- **The square a step names is ringed in the world.** The trail shows the WAY
  there and goes out once you arrive, which left the arrival unmarked.
- **So is the on-screen button.** Half the script is about that one button doing
  three different things. The SDK gives its buttons no id, so they are found by
  the icon they are wearing — worth replacing with a `data-action` attribute
  next time the SDK is published.
- **The enemy was invisible.** Put beside the gate, the tower had it in range on
  its first frame: it spawned already at 1.4 of 3.4 health, moved half a tile
  and died — the whole "it shoots on its own, two hits" lesson over in a second
  and a half, behind the box. The build square is now a third of the way along
  the road, so it comes out, walks into range, and is shot in front of you.

And "walk over what it dropped" became a statement rather than an instruction:
the magnet fetches it from three tiles away, so the step completed in a second
and read as one being skipped.

**The button glow only exists on a phone.** The SDK mounts the on-screen
controls only where there is a touch screen, so a desktop probe checking for it
passes by finding nothing — `verify-3d-tutorial-script` boots a second, touch
context for exactly that check.

### It broke every level probe

`enterLevel` boots a fresh save, so all of them walked out and landed on the
tutorial while reporting its numbers as Meadow's — `maxTowers: 1` surfaced as
"a defence goes up — 1 towers". It now bumps `runs` to 1 first.

**And it has to wait for the hub before asking.** `window.__hub?.runs === 0` on
a page whose hub has not started is `undefined === 0`, which is false — so the
guard silently skipped on exactly the pages that needed it.

## The action button says what it will DO

One button, three jobs: an empty square builds, your own weapon upgrades, and
holding it sells. It wore the `build` picture for all three, which made that
something to be remembered rather than read — and **"you cannot place a second
weapon on the one you are standing on" is a rule of the game, not a tutorial
flourish**, so `showActionIcon` runs on every board, not just the scripted one.

Called per frame during a hold (it returns at once when nothing changed),
because the hold is continuous and the icon has to follow it.

`upgrade` and `sell` are drawn by hand in `tools/pack-icons.mjs`. Kenney's
library has no bin anywhere in it, and `upgrade` is two chevrons rather than one
arrow because `jump` is already an arrow pointing up and the two buttons sit a
thumb-width apart.

**Checked in `verify-3d-sell`, in a touch context.** The SDK mounts the
on-screen controls only where there is a touch screen, so a desktop check for
the right icon passes by finding no buttons at all.

## What the tutorial leaves you with

The village's first lesson is buying a building. The cheapest is **120 gold**
and the tutorial board hands out 25, so without a grant the first thing a new
player meets after it is a shop that cannot sell them anything and a gate they
just came in by. Finishing — or skipping — floors the store at the cheapest
building's cost, taken from `TOWN` rather than typed, so it stays true if the
prices move.

And there is a **Skip**, offered after 45 seconds rather than immediately: shown
at once it reads as the game expecting you to want out, and it is the first
thing a skimming player presses. It ends the board as a WIN, so it comes with
the same grant — a skip into an empty purse is a skip into the dead end the
grant exists to prevent.
