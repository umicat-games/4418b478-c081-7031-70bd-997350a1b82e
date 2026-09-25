# Glyph Drop — a gesture match-3

Draw any of the four marks. It clears every tile of that glyph in the lowest row
holding one; the stack falls; three-or-more of a kind clears itself and cascades;
tiles rain in from above. The run ends when the well has no room left. A three.js
game on the Umicat platform; this file is what the agent reads first.

| | |
|---|---|
| `src/main.ts` | scene, loop, input, the move/cascade sequence, the rain |
| `src/board.ts` | the rules, with no three.js in them |
| `src/gesture/` | the recogniser and the pointer layer — see "The gesture recogniser" |
| `src/glyphs.ts` | one definition of each mark, used by tile faces and HUD chips alike |
| `public/scenes3d/main.json` | the well (back panel, floor, rails) as authored design data |

```bash
npm run dev                            # play it
npm run build && npx vite preview --port 5199 &
node tools/pw-smoke.mjs                # headless: does drawing actually clear tiles
node tools/board-test.mjs <bundle>     # the rules
node tools/sim.mjs <bundle>            # the economy, 400 moves at a time
node tools/gesture-bench.mjs <bundle>  # the recogniser
```

## Things this game learned the hard way

**The economy has a feedback loop nobody guesses at, so it is simulated rather
than tuned by taste.** A fuller board gives wider matches and more chains, so
removal rises with fill and the well actively resists topping out. Three designs
died to this before `tools/sim.mjs` existed: one where the well drained to
nothing in half a minute, one where it filled regardless of how well it was
played, and one where "replace what you clear by hand, chains are free" sat flat
forever because chains fire on only 9% of moves — a tenth of what intuition says.
The numbers in `main.ts` (5.2 tiles owed per move, +0.03 per move after) come
from that simulator. **Change one of them and re-run it.**

**Measure a steady state with `RAIN_FLOOR` switched off.** The rate was set to
3.2 on a simulator run that said "held", and the floor was doing the holding: the
true equilibrium was below it, so the well sat at exactly the emergency minimum
— 15 tiles, two and a half rows, nothing to read. A safety net will always report
the number you wanted to hear. At 5.2 the well genuinely settles around 27 tiles.

**One seed is a coin flip.** The same sweep put one setting at a 3.0× skill gap
on seed 12345 and 1.35× averaged over seven. Anything used to choose a number
runs multi-seed.

**The economy is how many tiles; `RAIN_CATCHUP_MS` is how fast they arrive, and
they are not the same knob.** At a fixed 110ms gap, a move owing five tiles needs
570ms to deliver them — longer than a player in rhythm leaves between strokes. The
debt built up, the well LOOKED drained while the economy was perfectly fine, and
then the whole backlog arrived at once. The delivery gap shortens with the
backlog now. When the board looks wrong, check `owed` before touching a rate.

**Nothing the rain drops completes a match.** The player's clear is the only
thing that starts a cascade. A dealer that hands out chains both takes the credit
and runs away with itself — a smoke run once scored 67,000 and filled the well
without a single gesture being drawn.

**Telling the player what to draw is not a game.** The first version ringed two
target tiles and asked the player to copy them, which is a reaction test wearing
a puzzle's clothes. Free choice of glyph is what created a decision; clearing the
whole row's worth at once, scored `n²` and divided by depth, is what made the
decision worth making.

**Survival differentiates play only about 1.6× (seven-seed mean); the score is
where skill lives.**
Worth knowing before adding anything meant to reward good play — the honest
place to put it is scoring and chains, not the stack.

**A gesture drawn mid-cascade is queued, and a queued gesture that no longer
matches is dropped silently.** Chains take a few hundred ms and a player in
rhythm draws through them; charging a miss for a board that changed under the
stroke is punishing the player for the animation.

**"Nothing happened" is the one response a player cannot learn from.** A board of
twenty tiles genuinely runs out of a mark sometimes, so drawing one that is not
there says so.

**`Input3D` is never constructed here**, so there is no platform control layer at
all and the z-indexes in `index.html` start at 1 instead of stepping around 10.
On touch that class claims the left half of the screen for a thumbstick and the
right half for the camera; this game needs the whole screen as paper.

## The platform underneath

A three.js game on the Umicat platform. This file is what the agent reads first.

## Where things are

| | |
|---|---|
| `src/main.ts` | the whole game loop — start here |
| `src/config.ts` | the design canvas + `ORIENTATION` (set at game creation; do not change it) |
| `public/scenes3d/main.json` | **the scene** — entities, lights, colliders, camera |
| `public/scenes3d/manifest.json` | models, their import scale, and their **animation map** |
| `public/assets/` | `.glb` models, textures, audio |

## The two halves, and why the split matters

**Platform** — `umicat.saves`, `umicat.gameData`, `umicat.rooms`, `umicat.ai`,
`umicat.voice`, `umicat.dialogue`, `umicat.user`. Identical to what a 2D Umicat
game gets, because it is the same package underneath
(`@umicat/platform-sdk`). None of it knows anything is being drawn.

**Engine** — `loadScene3D`, `CharacterController3D`, `Input3D`, three.js and
Rapier. This is the part that differs from a 2D game.

When something goes wrong, knowing which half you are in usually names the bug.

## The scene format

`scenes3d/main.json` is **design data**: what the game looks like before anyone
plays it. No save is loaded when it is read. Rules that are decisions, not
accidents:

- **Rotation is a quaternion** `[x, y, z, w]`, never Euler angles.
- **Ids are authored and stable.** Saves and code refer to entities by id.
- **Transforms are local to `parent`.** World transforms are derived.
- **Colliders are explicit.** Never use a render mesh as a dynamic collider —
  that is the classic way to make a game that is correct and unplayably slow.
- **Animation clips are mapped by meaning** in the manifest
  (`{ "walk": "Walk" }`), never guessed from the clip's name.

`loadScene3D` refuses duplicate ids, dangling parents, entities that would draw
nothing, and trimesh colliders on dynamic bodies — at load, because every one of
them otherwise shows up as a blank screen an hour later.

## Building

```bash
npm run dev      # local dev server
npm run build    # what the platform runs
```

## Things that will bite

**A `SkinnedMesh`'s bounding sphere comes from the bind pose** and does not
follow its bones, so three.js culls a character against a stale volume and it
vanishes the moment it moves. `loadScene3D` already sets `frustumCulled = false`
on skinned meshes; if you add a character by hand, do the same.

**An action is a one-shot, not a state.** The character ships 32 clips —
`attack`, `kick`, `pick-up`, `interact`, `holding-*` (including shooting),
`die`, `emote-yes/no` — and `CharacterAnimator.play('attack')` runs one once and
hands control back. Gate on `animator.busy` so one press is one swing, and use
an edge check if you do not want holding the key to chain them. Locomotion keeps
following `character.state` underneath.

**Use the prop kit before you draw scenery out of boxes.** `public/kit/` ships
86 real models with a catalogue at `public/kit/index.json`. A coloured box named
`crystal` is still a box, and a scene of them reads as a prototype.

**The world's unit is Kenney's, not the metre.** A character is 0.72 units tall,
so ~4,700 CC0 props drop in at `importScale: 1`. Anything length-shaped you add —
sizes, positions, collider extents, camera offsets, speeds, **and gravity** —
lives in that unit. See ASSETS.md. The character takes its gravity from the
world's, so there is one gravity in the scene and not two; the scene's own
`gravity` in `main.json` is where it is set.

**Rotate geometry, not objects, when orienting a primitive.** An object's
rotation is overwritten by the entity's authored transform. Getting this wrong
once left every "ground" standing upright as a wall, which renders convincingly
until the camera crosses to the other side.

**Jump and the on-screen controls belong to the SDK, not to your game.**
`update(dt, dir, { jump })` takes the button's current state; coyote time,
input buffering and the release-cut live in `CharacterController3D` because
every 3D game shares this character (ADR-034). `Input3D` adds a thumbstick and
jump button on touch devices and merges them into the same `direction()` and
`jump`, so nothing here branches on input source.

**A jump is a range, not a number — author platforms against the SHORT one.**
Releasing the button early cuts the jump deliberately, so this character clears
`character.maxJumpRise` held and only `character.minJumpRise` tapped — roughly a
fifth as far. Read those off the controller rather than deriving them; a course
laid out against the held height has a first step that tapping players cannot
clear, and that reads as "the platform up there is unreachable", not as a bug.
Leave headroom on top: both numbers are ballistics, and a real jump is stepped
at frame rate.

**The thumbstick is invisible until a thumb lands on the left half of the
screen, and then it is exactly there.** That is the default; `stick: 'fixed'`
brings back an always-drawn pad at the bottom left. Nothing in a game changes
either way — `direction()` reads the same.

**The right half of the screen turns the camera, and the stick follows it.**
On desktop the same `look()` is fed by holding the RIGHT mouse button and
dragging — the left button stays the game's, for selecting and aiming.
`input.look()` returns a delta and clears on read; hand it to `world.orbit()`,
then pass `world.cameraYaw` to `input.direction()`. Those two go together: a
camera that turns while movement stays on world axes is worse than a camera
that cannot turn, because the player looks at something, pushes towards it, and
walks somewhere else. Read the look BEFORE moving, or every turn lags a frame.

**What the platform has already taken, and what is left for you.** The controls
are shared between the SDK and your game, and the SDK went first — so before
wiring an input, check it is still free:

| | Taken by the platform | Yours |
|---|---|---|
| Touch | left half (thumbstick), right half (camera), the button cluster bottom-right | extra buttons, via `actions` |
| Mouse | **right button + drag** (camera), and the context menu | **left button** |
| Keys | `WASD` / arrows, `Space` | everything else |
| Layers | a full-screen control layer at **`z-index: 10`**, kept clear of the top `max(64px, 12%)` | anything above or below it; `#hud` is already at 20 |

**Any dialog you put up must call `input.setEnabled(false)`.** The controls are
a full-screen layer above your DOM, so a button in a modal renders perfectly
and cannot be pressed — the taps go to the move zone behind it. Disabling also
stops the character walking behind the dialog, and clears what was held so a
thumb mid-push does not resume when it closes. Re-enable when the dialog goes.
Give the dialog a `z-index` above 10 as well, so it is visible over the layer
while it is still fading out.

The one that bites: **do not wire an action to "the mouse went down."** The
right button is the camera now, so a game that attacks on any pointerdown
swings every time the player turns round to look at something — and it looks
like a combat bug, not an input one. Check `e.button === 0`. Check
`e.pointerType !== 'touch'` too, or a phone fires both your handler and the
on-screen button and you get two swings per tap.

Text selection and the iOS long-press callout are already suppressed page-wide,
with form fields exempted — you do not need to repeat it, and you should not
blanket `user-select: none` yourself, because that is what breaks typing in a
name field.

**Declare action buttons; never mount your own.**
`new Input3D({ actions: [{ id: 'attack', label: '⚔', keys: ['KeyJ'] }] })`, then
`input.consume('attack')` for one-press-one-action or `input.held('attack')` for
hold-to-act. A game that builds its own button cannot know where the platform's
jump button is, and the first one to try landed exactly on top of it: same
corner, platform layer above, so on a phone the attack button could not be
pressed at all — and it mounted perfectly, with no error. `consume` also catches
a tap that starts and ends between two frames, which a state comparison against
last frame cannot see.

**Never write `hud.textContent`.** It wipes every child the HUD has. Append a
child element instead. The platform's touch controls mount to `<body>` for
exactly this reason, but anything YOU put in the HUD is still yours to lose.

**A camera limit that is an angle is usually meant to be a distance.** The
follow camera's pitch floor is expressed as "stay this far above what you are
looking at", not as a number of radians — at an orbit radius of 5.4 a −0.25rad
floor puts the camera almost a unit underground, because how low an angle takes
you depends on how far out you are.

**Animate from `character.state`, not from input.** `idle`/`walk`/`jump`/`fall`
describe what the character is doing; a clip chosen from the key that is held
leaves it walking in mid-air.

**Gravity is an acceleration, not a displacement.** Feeding a character
controller a constant downward offset each frame passes a wall test and fails a
step test. `CharacterController3D` already handles this.

**A character that moves is not a character that is animating.**
`CharacterAnimator` now owns this — it follows `character.state` and cross-fades
— but the failure is worth knowing, because it is what a test misses rather than
what it catches: before the animator existed, the character slid around playing
its idle clip, and a test asking "are bones moving?" said yes, because idle moves
bones too. If you ever drive the mixer yourself, the question to ask is *which*
clip is playing, never *whether* something is.

**Feedback beats numbers.** `flashTint(object, { color, ms })` plus
`updateTints(objects)` once a frame is the hit flash. It is in the SDK for one
reason worth knowing even if you never call it: `gltf.scene.clone(true)` SHARES
MATERIALS, so tinting one of five cloned enemies turns all five red — a
graphics bug wearing a gameplay bug's clothes. `flashTint` clones per object.

**Sound goes through `GameAudio`, never through `<audio>`.**
```ts
const audio = new GameAudio({
  clips: { coin: { volume: 0.5, throttle: 40 }, hit: { volume: 0.4 } },
  music: 'bgm',                       // public/audio/bgm.ogg
});
audio.play('coin');
```
`HTMLAudioElement` is the trap: iOS gives each one a real audio pipeline, caps
how many may exist, and charges for every `play()`. A game pooling forty of them
ran at **11fps on an iPhone and a locked 60 with sound muted** — and a desktop
A/B showed no difference at all, which is why this belongs to the platform
rather than to whoever is unlucky. The gesture unlock, the asynchronous
`resume()`, and iOS suspending the context when the app goes away are all
handled; `audio.play()` before the first tap is simply a no-op.

**UI is DOM.** There is no reason to draw a score with triangles on the web;
`index.html` has a `#hud` div for exactly this.

**The editor's screenshot/record buttons need three specific lines you did not
write for gameplay reasons.** `new THREE.WebGLRenderer({ canvas, antialias:
true, preserveDrawingBuffer: true })` plus `setupScreenshotListener(renderer)`
and `setupRecordingListener(renderer)` right after — drop any of the three
("cleaning up" renderer construction is the usual way this happens) and the
Game Editor's Capture menu goes back to silently doing nothing on this game,
same as every 3D game before 0.16.0. `preserveDrawingBuffer` is what actually
matters for screenshots — without it `canvas.toDataURL()` can come back
blank depending on exactly when the browser clears the drawing buffer.

**The Game Editor's "Edit" tab now works on this game too (0.17.0 /
`EditorDesignPlayer3D`).** Same reason renderer construction can't move: the
platform boots this game with `?umicatEdit=1` on the URL when the user opens
Edit, and `main.ts` checks for it **right after `canvas`/`renderer` exist, before
`RAPIER.init()`** — `if (params.has('umicatEdit')) { await
runEditorDesignPlayer3D(renderer, {...}); return; }`. That call takes over the
renderer's animation loop for the rest of the page's life and renders ONLY the
scene named by `?umicatScene=<id>` (a filename under `scenes3d/`, chosen by
the platform's scene list — never guessed here) — no physics, no character, no
save, same "authored design data only" rule the scene JSON format itself
already follows. **Don't move this branch below `RAPIER.init()` or the scene
fetch** — Edit mode must never pay for or trigger either. Mirrors 2D's
`?umicatEdit=1` (ADR-021); the 3D SDK has no central game-boot wrapper the way
`createUmicatGame` is for Phaser, so every 3D game's own `main.ts` has to carry
this branch by hand, same as the screenshot/recording lines above it.

## The gesture recogniser

This game is played by drawing glyphs, not by walking around, so two things in
the table above are inverted for it: **the platform's touch zones have to be
turned off** (`new Input3D({ touch: false, jump: false, look: false })`) because
the left half of the screen is a thumbstick by default and here the whole screen
is a drawing surface, and the drawing itself is read from raw pointer events.

| | |
|---|---|
| `src/gesture/recognize.ts` | features → glyph, pure, no DOM |
| `src/gesture/capture.ts` | pointer events → committed gestures |
| `src/gesture/lab.ts`, `lab.html` | the tuning instrument, at `/lab.html` |
| `tools/gesture-bench.mjs` | synthetic regression, `node tools/gesture-bench.mjs <bundle>` |

**A recogniser tuned by feel is a recogniser nobody can change.** Every
threshold trades accuracy on one glyph for accuracy on another, and neither side
of that trade is visible from drawing a few shapes and liking the result. The
lab keeps every sample it is given and Re-run replays the whole corpus through
the current code, so a threshold change is a before/after confusion matrix. The
bench does the same against synthetic strokes and catches the other failure —
a feature that is simply wrong, which shows up as a whole class collapsing.

**Reject, never guess.** The classic stroke recognisers ($1, $P) return the
NEAREST template, so a tap or a scribble still deletes a tile. Here a false
accept costs the player a move and a rejection costs them 300ms, so the
classifier has an accept floor and a margin, and `Result.reason` says which one
turned the answer down.

**Only the cross waits.** It is the one glyph drawn in two strokes, so it is the
only reason to hold a finished stroke on a timer. Everything else commits on
pen-up. Putting the multi-stroke window on every gesture would add a dead spot
between every move in a game made of tempo.

**Resampling a sparse stroke to 64 points with straight lines makes a polygon,
and a polygon has corners.** A circle flicked in 150ms arrives as ~12 raw
samples, and linear up-resampling put a detected corner at every one of them —
12% of fast circles came back as triangles. `densify()` runs a centripetal
Catmull-Rom through the raw points first, for sparse strokes only. Fixing this
alone took the mid-noise bench from 84.5% to 97%.

**Corner count and radius swing are the same evidence twice, so they are added,
not multiplied.** Both measure "does this closed shape have vertices". A fast
triangle is rounded enough that corner detection finds two instead of three; as
a product that zeroed the score and the shape was rejected even though its
radius still swung like a triangle's. Closure and turning DO multiply — those
are independent conditions that all have to hold.

**Circle and triangle are the only real confusion, and speed is what causes
it.** Careful and normal strokes classify at ~99% and ~96%; a small fast rounded
triangle and a lumpy fast circle are the same stroke, and `radialVar`
distributions overlap (0.30 vs 0.25). Narrowing the candidates to the two live
tiles fixes most pairings and does nothing for this one — `tools/gesture-bench.mjs`
prints accuracy per pairing for exactly that reason.

**A ∧ read as a ~ was a gate I deleted, not a bad glyph.** `bend` — the angle
between the leading third of the stroke and the trailing third — measures 2-6°
on a wave and 96-99° on a chevron, which is about as separated as two features
get. It was in the wave score once as `cornerAngle` (the WINDOWED corner
measure), that version cost a quarter of all waves, and removing it was the
right removal of the wrong thing: the chord-based `bend` has none of the
window's attenuation. Without it the two classes were separated only by `humps`,
one noisy integer, and a ∧ with slightly unequal legs registers two excursions
across its own axis. Chevron-read-as-wave is 0% on the bench in all three noise
conditions now.

**Whatever `RAIN_FLOOR` guarantees is the most any test may assert.** The floor
was 10 tiles while the smoke run demanded 12, so the run failed on the game
behaving exactly as specified. The floor is now 14, far below the measured
equilibrium of 27, so it stays an emergency net and the assertion is something
the game actually promises.

**A test assertion on a fluctuating quantity needs a band, not a knife edge.**
"the well never dips by a single tile" failed on a big cascade, which is the
game working.
