# Umicat 3D game

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
| Layers | a full-screen control layer at **`z-index: 10`** | anything above or below it |

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

**UI is DOM.** There is no reason to draw a score with triangles on the web;
`index.html` has a `#hud` div for exactly this.
