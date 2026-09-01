# Umicat Game — technical session memory

## What this is
Bright, cartoony **endless space shooter** (portrait, 720×1280). Free 4-directional
movement, auto-fire, escalating endless waves of alien enemies, lives + persisted
high score. See `docs/design.md` for the full design intent (confirmed with the
user before building).

## Data-driven foundation (scene-as-data)
- `public/scenes/manifest.json` — scenes/huds table + `prefabs[]` (5 runtime-spawn
  types: `player_bullet`, `enemy_bullet`, `enemy_drone`, `enemy_weaver`, `enemy_brute`).
- `public/scenes/world/main.json` — world is 720×1280 (matches portrait canvas),
  fixed camera (no scroll). Authored entities: `e-backdrop` (code-rendered gradient
  sky + stars/planets/clouds), `e-player` (code-rendered ship, role `player`,
  physics body declared inline — no manual `physics.add.existing` needed).
- `public/scenes/hud/game-hud.json` — score/best/lives text (dynamic registry
  bindings), a pause `icon-button`, and two role-grouped modal dialogs
  (`pause-dialog`, `gameover-dialog`) each starting `visible:false` and toggled
  via `getHudObjects(scene, role)` in code.
- `public/rules.json` — tunable balance: `balance.lives`, `balance.playerSpeed`,
  `balance.shootCooldownMs`, `balance.invulnerabilityMs`, `balance.enemyBulletSpeed`,
  `difficulty.difficultyStepPerLoop`, `difficulty.maxDifficultyMultiplier`.
- `public/waves/endless.json` — one wave schedule (`id: "endless"`, `loop: true`)
  with 4 stages (drones line → weavers line → mixed → a tougher brute) that
  repeats forever. Difficulty ramps not via the JSON but via a multiplier the
  scene applies at spawn time (see below).
- `src/visuals/*.ts` — render scripts: `backdrop.ts`, `player-ship.ts`,
  `player-bullet.ts`, `enemy-bullet.ts`, `enemy-drone.ts`, `enemy-weaver.ts`,
  `enemy-brute.ts`. All pure/idempotent per the render-script contract.

## Behavior (`src/scenes/GameScene.ts`)
- Movement: keyboard (arrows/WASD) OR touch/mouse drag-to-fly (pointer down +
  move sets a target the ship steers toward). Whole-canvas free movement,
  world-bounds clamped via Arcade physics world bounds (this is a bounded
  single-screen arcade board, not a tilemap world, so physics bounds is the
  correct mechanism here per the camera/world-bounds guidance).
- Auto-fire: `player_bullet` spawned on a cooldown (`balance.shootCooldownMs`).
- Enemies: spawned only through `runWaveSchedule(this, 'endless', {...})` →
  `spawnPrefab`. Movement is physics-velocity-driven (straight fall, or a
  velocity-X sine wave for `moveType: 'weave'` enemies — never hand-set
  `.x`/`.y` directly, always through `body.setVelocity*`, so Arcade physics
  and the collider stay consistent).
- **No `Phaser.Physics.Arcade.Group` is used for bullets/enemies** — plain JS
  arrays (`enemyList`, `playerBulletList`, `enemyBulletList`) mutated in place
  (`push`/`splice`, never reassigned) are passed straight to
  `physics.add.overlap`, sidestepping the group-`add()`-resets-the-body pitfall
  entirely (Phaser's `ArcadeColliderType` accepts `GameObject[]` directly).
- Difficulty: a multiplier (`difficultyMultiplier`) increases by
  `difficulty.difficultyStepPerLoop` every time the wave schedule loops back to
  wave 0 (tracked in `handleWaveStart`), capped at `difficulty.maxDifficultyMultiplier`.
  Applied per-spawn in `handleWaveSpawn` as `spawnPrefab` overrides
  (`physics.velocityY`, `properties.fireIntervalMs`) — the prefab JSON itself
  stays at "loop 1" baseline values.
- Enemy fire: each enemy tracks its own `nextFireAt` (GameObject data). Drones
  fire straight down (max readability); weavers/brutes fire aimed at the
  player's current position (`properties.aimed`). A quick scale-pop tweens the
  enemy at the moment it fires as a telegraph.
- Collisions: bullets↔enemies (HP down, particle burst + score popup + score
  registry write on kill), enemy bullets↔player, and direct enemy↔player
  contact — all funnel through `damagePlayer()` (life loss + brief blinking
  invulnerability window, sized by `balance.invulnerabilityMs`).
- HUD wiring: `this.events.on('hud:press', ...)` handles `pause-button`,
  `resume-button`, `restart-button` / `play-again-button`, `exit-button` /
  `exit-button-2`. Pause = `physics.pause()` + wave controller pause + show the
  `pause-dialog` role group (does NOT call `scene.pause()`, so HUD button
  presses keep arriving during pause). Restart = `scene.restart({sceneId})`
  (all transient state reset in `init()`, since the same scene instance is
  reused). Exit = save high score, then `umicat.platform.exit()` — the exit
  buttons are hidden at runtime (`getHudObjectById(...).setVisible(false)`)
  whenever `umicat.platform.canExit` is false (standalone).
- High score: read once via `umicat.saves.get('highScore')` after
  `loadWorldScene` resolves (wrapped in `suspendSceneUpdates` per the SDK's
  async-create-safety note), written on game over when the run beats it, and
  again defensively on exit. Registry key `highScore` drives the HUD; `score` /
  `lives` / `newBestLabel` are the other live registry bindings.
- `src/main.ts` now also exports `umicatReady = Umicat.init(...).catch(() => null)`
  (non-blocking); `src/scenes/BootScene.ts` additionally calls `preloadRules(this)`.

## Mobile performance (object pooling)
`GameScene.ts` recycles instead of allocating on the two hottest per-event
paths (per the mobile-performance guidance: text allocation is the #1 phone
stutter cause, per-shot object churn is the #2):
- **Score popups**: a fixed ring of 10 pre-created `Text` objects
  (`popupPool`/`popupNext`), reused via `setText`/`setPosition` in
  `spawnScorePopup` instead of a fresh `this.add.text(...)` per kill (each
  `add.text` call rasterizes glyphs + uploads a new GPU texture — the
  single biggest phone-stutter cause when done every kill).
- **Bullets** (`player_bullet` / `enemy_bullet`): `acquireBullet(...)` /
  `recycleBullet(...)` maintain a per-type free-list
  (`playerBulletPool` / `enemyBulletPool`). Recycling reuses the existing
  Graphics + Arcade body (`body.reset()` + `setVelocity()` +
  `setEnable(true)`) instead of `destroy()` + `spawnPrefab()` on every
  shot/impact/off-screen despawn. `handleBulletHitEnemy`,
  `handleEnemyBulletHitPlayer`, and `cleanupOffscreen` all recycle instead
  of destroying bullets now (enemies still `destroy()` as before — they
  carry varied hp/behavior per type so pooling them wasn't worth the
  added risk). Pools are cleared in `init()` on `scene.restart()` since the
  Graphics objects they reference are torn down with the rest of the scene.

## Known environment note
The sandbox's Bash tool was unavailable this session (no POSIX shell), so
`npx tsc --noEmit` could not be run to verify this turn's TypeScript (same
issue as a previous session). Every SDK/Phaser API used (`Body.reset`,
`Body.setEnable`, `getPrefab(...).physics?.velocityY`) was cross-checked
directly against the installed `.d.ts` files and against the exact patterns
already used elsewhere in this file. Worth running `npx tsc --noEmit` next
session if the shell is back, just to be safe.

## What changed this turn
Built the whole game from the fresh scaffold: design doc, data-driven
world/HUD/prefabs/rules/waves, all render-script art, and the full
`GameScene.ts` gameplay (movement, auto-fire, endless escalating waves,
scoring, lives, pause/restart/exit, persisted high score).

Follow-up turn: optimized for mobile stutter — pooled score-popup text and
bullet objects (see "Mobile performance" above) instead of allocating a new
one on every kill/shot/impact.
