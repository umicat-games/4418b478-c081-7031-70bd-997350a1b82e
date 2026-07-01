# Geometry Dash–style Runner

## Game overview
- **Genre:** Auto-runner / rhythm platformer (Geometry Dash–style)
- **Core mechanic:** The cube moves forward automatically at constant speed; the player taps Space or clicks/taps to jump over obstacles. The cube should never fall through the platform.

## Current features
- **Auto-forward movement:** Constant 450 px/s right via `body.setVelocityX(RUN_SPEED)` each frame.
- **Jump:** Space key or mouse/touch click. Only fires when `body.blocked.down` is true (grounded). Upward burst of −600 px/s.
- **Gravity:** 1400 px/s² set via `world.physics.gravity` in the scene JSON — snappy arc, short peak.
- **Tilemap collision:** `addTilemapCollider` wires the platform tilemap entity (`e-mr2him35-9l8w`) against the player. Tile 0 is marked `solid: true` in the tileset metadata.
- **Camera:** Follows player's X instantly (lerp = 1); Y is locked (lerp = 0). Player offset to left-third of screen. `setBounds(0,0,1600,720)` prevents camera going out of map at the end.
- **Jump-only rotation:** Cube rotates clockwise only while airborne (~1 full revolution per 0.9 s). On landing, snaps to nearest 90° so it looks flat.
- **Landing dust:** Small particle puff when player touches down.
- **Win condition:** When player.x >= WIN_X (1520), game stops, win overlay appears. SPACE or tap restarts.
- **Asset hitbox:** Uses `applyAssetHitbox(player, asset)` — no-op if hitbox metadata missing; body defaults to texture size.

## Key implementation details

### Scene data (`public/scenes/world/main.json`)
- World: 1600 × 720, gravity `{ x: 0, y: 800 }`
- Camera bounds: 1600 × 720; camera.follow = null (handled in code)
- Player entity: `e-mr2hj2ka-kqvr`, `kind: "sprite"`, `role: "player"`, assetId `gd_player_64x64`
- Tilemap ref: `e-mr2him35-9l8w`, tilemapId `platform`

### Platform tilemap (`public/tilemaps/platform.json`)
- 100 × 30 tiles at 16 × 16 px = 1600 × 480 px world extent
- Solid tiles at rows 22–29 (bottom 8 rows)
- Tileset: `sprite-16x16`, tile 0 is `solid: true` with full 16×16 collisionRects

### Behavior code (`src/scenes/GameScene.ts`)
- Constants: `RUN_SPEED = 300`, `JUMP_VELOCITY = -680`
- Player retrieved: `registry.byRole('player')[0]`
- Physics: `physics.add.existing(player)` → `applyAssetHitbox` → `addTilemapCollider`
- Camera: `startFollow(player, false, 1, 0)` + `setFollowOffset(-256, 0)` + `setBounds(0, 0, 1600, 720)`
- Input: space key `on('down')` + `this.input.on('pointerdown')`
- `isOnGround` tracked via `body.blocked.down` each frame

## This turn
- Swapped player sprite to `gd_player_64x64` (gd-player-64x64.png, 64×64, has hitbox metadata)
- Rotation is now jump-only — cube only spins in the air; snaps to nearest 90° on landing
- Added win condition: when player.x >= 1520, movement stops and "LEVEL COMPLETE!" overlay appears
- Camera `setBounds` already clamps to map width so it never overshoots the right edge
