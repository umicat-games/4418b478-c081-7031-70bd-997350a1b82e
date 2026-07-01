# Geometry Dash–style Runner

## Game overview
- **Genre:** Auto-runner / rhythm platformer (Geometry Dash–style)
- **Core mechanic:** The cube moves forward automatically at constant speed; the player taps Space or clicks/taps to jump over obstacles. The cube should never fall through the platform.

## Current features
- **Auto-forward movement:** Constant 300 px/s right via `body.setVelocityX(RUN_SPEED)` each frame.
- **Jump:** Space key or mouse/touch click. Only fires when `body.blocked.down` is true (grounded). Upward burst of −680 px/s.
- **Gravity:** 800 px/s² set via `world.physics.gravity` in the scene JSON — no code needed.
- **Tilemap collision:** `addTilemapCollider` wires the platform tilemap entity (`e-mr2him35-9l8w`) against the player. Tile 0 is marked `solid: true` in the tileset metadata.
- **Camera:** Follows player's X instantly (lerp = 1); Y is locked (lerp = 0). Player offset to left-third of screen (`setFollowOffset(-256, 0)`). World bounds 1600 × 720.
- **Cube rotation:** Rolls clockwise at one full revolution per second of running — proportional to forward velocity × delta.
- **Landing dust:** Small particle puff emitted via `events.emit('player-land')` when the player touches down.
- **Asset hitbox:** Uses `applyAssetHitbox(player, asset)` conditionally — no-op if hitbox metadata not yet in manifest; body defaults to full texture size.

## Key implementation details

### Scene data (`public/scenes/world/main.json`)
- World: 1600 × 720, gravity `{ x: 0, y: 800 }`
- Camera bounds: 1600 × 720; camera.follow = null (handled in code)
- Player entity: `e-mr2hj2ka-kqvr`, `kind: "sprite"`, `role: "player"`, assetId `geometry_dash_player_square_hfav1`
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
- Added `role: "player"` to player entity in scene JSON
- Added `world.physics.gravity: { x:0, y:800 }` to scene JSON
- Updated world + camera bounds width to 1600 to match tilemap extent
- Implemented full GD-style behavior in GameScene.ts: auto-run, jump, tilemap collision, X-only camera follow, cube rotation, landing dust
