# Star Siege — Technical Notes

## What the game is
**Star Siege** — a top-down space shooter.  
The player's spaceship is positioned at the centre of the screen and automatically fires energy bolts in all 4 directions (up, down, left, right). Enemies spawn from beyond all 4 edges and home in on the player. The game escalates through waves.

## Current features
- **4-way auto-fire** — volleys every 210 ms, bullet speed 540 px/s
- **Homing enemies** — re-aim every frame; 4 colour-coded types (red / orange / purple / cyan) one per spawn side
- **Wave system** — every ENEMIES_PER_WAVE + wave×4 kills advances the wave; spawn rate and enemy speed increase
- **Player movement** — WASD or arrow keys, diagonal movement normalised
- **Lives / invincibility** — 3 lives; 1.6 s invincibility window after hit; blink tween feedback
- **Particle explosions** — ADD-blend spark burst on enemy death and player hit
- **HUD** — score (top-left), lives hearts (left), wave counter (top-right)
- **Wave banner** — centred text pops up on wave advance then fades
- **Game over screen** — panel with final score / wave, PLAY AGAIN button restarts scene
- **Visual polish** — gradient deep-space background, nebula blobs, 210-star field, glow under player, crosshair grid lines, border decoration

## Key implementation details

### Files changed
- `src/scenes/GameScene.ts` — full game rewrite; scene-as-data `loadWorldScene` is called but no entities are spawned from JSON (the scene is purely procedural)
- `public/scenes/world/main.json` — background set to `#04040f`
- `public/scenes/manifest.json` — title updated to "Star Siege"

### Architecture
- All textures are generated at runtime using `this.make.graphics()` + `generateTexture()`
- Bullets use a `Phaser.Physics.Arcade.Group` with `maxSize: 80`; culled when off-screen
- Enemies use `group.create()` directly; destroyed after pop tween
- Particle system uses Phaser 3.60+ new API: `this.add.particles(x, y, key, config)` → `ParticleEmitter`
- Player glow is a `Graphics` object redrawn each frame in `drawPlayerGlow()`

### Controls
- Move: WASD or arrow keys
- Shoot: automatic (4-way volley)

## What was changed this turn
- Built the entire game from scratch (new game — fresh project).
