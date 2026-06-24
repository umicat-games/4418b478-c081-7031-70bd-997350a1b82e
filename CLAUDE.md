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
- **Game Over screen**: Overlay + panel, score, best, NEW BEST badge, PLAY AGAIN button, top-5 global leaderboard. Restarts the scene.
- **High score persistence**: Saved to `umicat.saves` key `'highScore'` between sessions.
- **Global leaderboard**: Stored in `umicat.gameData` key `'leaderboard'` (top 100, sorted by score desc). Submit on game over (auth required), fetch is public. Displayed: top 10 via modal (opened by 🏆 LEADERBOARD button on title screen), top 5 on game over screen.
- **Background**: Gradient deep space, nebula blobs, seeded starfield (200 stars), 18 drifting asteroid rocks (3 sizes: sm 22×18, md 40×30, lg 54×42). Asteroids drift slowly, rotate, wrap edges. Alpha 0.28–0.52 to stay clearly behind gameplay.
- **Font**: Orbitron (Google Font via `public/webfonts.json`).
- **Background music**: AI-generated synthwave space combat track (`star_siege_bgm_rgqa5.mp3`). Starts on first user interaction (browser autoplay rule), loops through TitleScene → GameScene.
- **Shoot SFX**: AI-generated sci-fi laser zap (`shoot_sfx_tqeon.mp3`). Plays at volume 0.35 on every bullet fired.
- **Explosion SFX**: AI-generated electronic burst (`explosion_sfx_txq85.mp3`). Plays on every enemy kill — vol 0.45 for drones/zigzaggers, 0.7 for tankers.
- **Hit SFX**: AI-generated metallic impact sound (`hit_sfx_v96l2.mp3`, key `hit`, vol 0.5). Plays when a bullet damages but doesn't kill an enemy (tanker taking hits).
- **Hover SFX**: AI-generated soft sci-fi UI blip (`hover_sfx_c1h2p.mp3`, key `hover`, vol 0.5). Plays on pointerover for START and LEADERBOARD buttons on the title screen.
- **Pickup SFX**: Three distinct AI-generated sounds, one per power-up type (vol 0.6 each):
  - Rapid Fire → `pickup_rapid_v5raz.mp3` (snappy electric zap)
  - Shield → `pickup_shield_v5tdh.mp3` (warm rising hum)
  - Bomb → `pickup_bomb_v5uw3.mp3` (heavy low-pitched charge)

## Key Files
- `src/leaderboard.ts` — `fetchLeaderboard(limit)` + `submitScore(score)` shared leaderboard utilities
- `src/visuals/player.ts` — render script for player ship
- `src/scenes/TitleScene.ts` — title/start screen (cover image, title, slogan, START button, LEADERBOARD button + modal)
- `src/scenes/GameScene.ts` — all game logic (movement, spawning, collisions, HUD, game over)
- `src/main.ts` — exports `umicatReady` (Umicat platform promise)
- `public/scenes/world/main.json` — player entity (`e-player`, role `player`, code-rendered)
- `public/scenes/manifest.json` — title "Star Siege"
- `public/webfonts.json` — ["Orbitron"]
- `public/uploaded/star_siege_cover.jpg` — game cover image (used on title screen)
- `public/uploaded/star_siege_bgm_rgqa5.mp3` — background music (looping, loaded via BootScene, key `bgm`)
- `public/uploaded/shoot_sfx_tqeon.mp3` — shoot sound effect (key `shoot`, played in fireBullet)
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
- Added hover SFX (soft sci-fi UI blip) to START and LEADERBOARD buttons on the title screen.
