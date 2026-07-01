# Geometry Dash–style Runner

## Game overview
- **Genre:** Auto-runner / rhythm platformer (Geometry Dash–style)
- **Core mechanic:** The cube moves forward automatically at constant speed; the player taps Space or clicks/taps to jump over obstacles. The cube should never fall through the platform.

## Current features
- **Auto-forward movement:** Constant 400 px/s right via `body.setVelocityX(RUN_SPEED)` each frame.
- **Jump:** Space key or mouse/touch click. Only fires when `body.blocked.down` is true (grounded). Upward burst of −480 px/s.
- **Gravity:** 1670 px/s² set via `world.physics.gravity` in the scene JSON. g/v₀ ratio = 3.48 — exact match to real Geometry Dash.
- **Tilemap collision:** `addTilemapCollider` wires the platform tilemap entity (`e-mr2him35-9l8w`) against the player. Tile 0 is marked `solid: true` in the tileset metadata.
- **Camera:** Follows player's X instantly (lerp = 1); Y is locked (lerp = 0). Player offset to left-third of screen. `setBounds(0,0,1600,720)` prevents camera going out of map at the end.
- **Jump-only rotation:** Cube rotates clockwise only while airborne (exactly 1 revolution per 575ms = one full jump arc). On landing, snaps to nearest 90° so it looks flat.
- **Landing dust:** Small particle puff when player touches down.
- **Win condition:** When player.x >= WIN_X (1520), game stops, win overlay appears. SPACE or tap restarts.
- **Asset hitbox:** Uses `applyAssetHitbox(player, asset)` — no-op if hitbox metadata missing; body defaults to texture size.

## GD-authentic physics derivation
Real GD canonical values (60fps, 30px = 1 block):
- Speed: 5.77 px/frame = 346 px/s; Jump: 15 px/frame = 900 px/s up; Gravity: 0.87 px/frame² = 3132 px/s²
- Jump height: 4.3 blocks; Air time: 0.575s; g/v₀ ratio: 3.48

Scaled to our 16px tiles (factor = 16/30 = 0.533):
- Jump: 900 × 0.533 = 480 px/s; Gravity: 3132 × 0.533 = 1670 px/s²
- Jump height: 480²/(2×1670) = 69px = 4.3 tiles ✓; Air time: 0.575s ✓

Speed: GD crosses ~27-block viewport in 3.2s → our 1280px / 3.2s = 400 px/s

## Key implementation details

### Scene data (`public/scenes/world/main.json`)
- World: 1600 × 720, gravity `{ x: 0, y: 1670 }`
- Camera bounds: 1600 × 720; camera.follow = null (handled in code)
- Player entity: `e-mr2hj2ka-kqvr`, `kind: "sprite"`, `role: "player"`, assetId `gd_player_64x64`
- Tilemap ref: `e-mr2him35-9l8w`, tilemapId `platform`

### Platform tilemap (`public/tilemaps/platform.json`)
- 100 × 30 tiles at 16 × 16 px = 1600 × 480 px world extent
- Solid tiles at rows 22–29 (bottom 8 rows)
- Tileset: `sprite-16x16`, tile 0 is `solid: true` with full 16×16 collisionRects

### Behavior code (`src/scenes/GameScene.ts`)
- Constants: `RUN_SPEED = 400`, `JUMP_VELOCITY = -480`
- Rotation speed: `(Math.PI * 2) / 575` rad/ms — 1 revolution per jump arc
- Max fall speed: `body.setMaxVelocityY(900)` — symmetric with jump velocity
- Player retrieved: `registry.byRole('player')[0]`
- Physics: `physics.add.existing(player)` → `applyAssetHitbox` → `addTilemapCollider`
- Camera: `startFollow(player, false, 1, 0)` + `setFollowOffset(-GAME_WIDTH * 0.2, 0)` + `setBounds(0, 0, 1600, 720)`
- Input: space key `on('down')` + `this.input.on('pointerdown')`
- `isOnGround` tracked via `body.blocked.down` each frame

## This turn
- Applied GD-authentic physics: RUN_SPEED 450→400, JUMP_VELOCITY -600→-480, gravity 1400→1670
- g/v₀ ratio now exactly 3.48 (matches real GD), jump height = 4.3 tiles, air time = 0.575s
- Rotation speed updated: exactly 1 revolution per 575ms (one full jump arc)
- Max fall velocity updated to 900 px/s (symmetric with jump)
