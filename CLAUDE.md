# Star Siege — Technical Session Notes

## Game
- **Title**: Star Siege
- **Genre**: Top-down arena space shooter
- **Core mechanic**: Player ship moves freely (WASD/arrows), aims at mouse, fires on left-click (hold = auto-fire). Enemies swarm from all screen edges. One hit = game over. Score + combo system.

## Features Implemented
- **Player ship**: Code-rendered modern triangle spacecraft (pointing right at angle 0, matching atan2). Rotates to face mouse. Arcade physics, tight cockpit hitbox (28×22).
- **Enemy types**:
  - Drone (32×32, cyan) — fast, 1 HP, 10pts
  - Tanker (56×36, purple) — slow, 3 HP, 50pts
  - Zigzagger (34×34, pink) — zigzag movement, 1 HP, 25pts
- **Bullets**: Physics group, despawn off-screen. Muzzle flash tween on fire.
- **Engine trail**: Particle emitter tracks behind the ship (two exhaust positions), only emits when moving.
- **Explosions**: Tinted particle bursts per enemy type, larger for tanker.
- **Power-ups** (random 13% drop on kill):
  - Rapid Fire (green lightning) — 5s, tightens fire rate to 90ms
  - Shield (blue) — 3s invincibility ring + arc visual around player
  - Bomb (red/orange) — clears all enemies, screen flash
- **Scoring**: Points per kill × combo multiplier (combo grows with ≤1.2s between kills). Floating score text on kills.
- **Difficulty ramp**: Every 15s a new level unlocks. Faster spawn, faster enemies. Tougher enemy mix from LV3+.
- **HUD**: Score (top-left), Best (top-left below score), Level (top-right), Combo text (upper center), Power-up status (lower center).
- **Game Over screen**: Overlay + panel, score, best, NEW BEST badge, PLAY AGAIN button. Restarts the scene.
- **High score persistence**: Saved to `umicat.saves` key `'highScore'` between sessions.
- **Background**: Gradient deep space, seeded starfield (200 stars), nebula blobs.
- **Font**: Orbitron (Google Font via `public/webfonts.json`).

## Key Files
- `src/visuals/player.ts` — render script for player ship
- `src/scenes/GameScene.ts` — all game logic (movement, spawning, collisions, HUD, game over)
- `src/main.ts` — exports `umicatReady` (Umicat platform promise)
- `public/scenes/world/main.json` — player entity (`e-player`, role `player`, code-rendered)
- `public/scenes/manifest.json` — title "Star Siege"
- `public/webfonts.json` — ["Orbitron"]
- `docs/design.md` — full game design document

## Controls
| Action | Input |
|---|---|
| Move | WASD or Arrow keys |
| Aim | Mouse cursor |
| Fire / Auto-fire | Left mouse button (hold) |

## Architecture Notes
- Player entity from scene JSON (`code-rendered`, script `src/visuals/player.ts`, width=48, height=40).
- All enemies/bullets/powerups spawned at runtime via `physics.add.group().create()` with generated textures.
- Textures generated in `generateTextures()` at scene start using `this.make.graphics().generateTexture()`.
- `umicatReady` imported from `main.ts` for high score persistence.
- `engineTrail` is a persistent particle emitter; `explode(1)` called per frame per engine when moving.

## Last Turn
- Initial complete build: full game from scratch.
