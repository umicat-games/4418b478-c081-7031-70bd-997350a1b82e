# Geometry Dash Clone

## What this game is
A Geometry Dash–style auto-runner. The player cube moves right automatically; the player taps/clicks to jump over obstacles and reach the end of each level.

## Features implemented
- **Auto-movement**: Player moves right at 320 px/s from the moment the game starts.
- **Jump mechanics**: SPACE or mouse/touch click jumps when grounded. No mid-air jumps.
- **Cube rotation**: Rotates at 440°/s clockwise while airborne (~360° per flat-ground jump). Snaps to the nearest 90° on landing. No rotation while on the ground.
- **Platform collision**: Player collides with the tilemap platform via `addTilemapCollider`.
- **Camera follow**: Camera tracks the player with the cube sitting at ~33% from the left edge (GD-style), clamped to world bounds (3200×720).
- **Death conditions**: Player falls below screen → red flash + camera shake → auto-restart after 700ms. Player hits a ceiling tile → same.
- **Level complete**: Player reaches x=3155 → overlay shows "★ Level Complete! ★" with a bounce-in tween, sub-text, and a "Play Again" button that restarts the scene.

## GD physics (mapped to 40px grid)
| Value | Number |
|---|---|
| Horizontal speed | 320 px/s |
| Jump velocity (upward) | −900 px/s |
| Gravity | 2 200 px/s² (set in world/main.json) |
| Jump height | ≈ 184 px / 4.6 tiles |
| Jump duration (flat) | ≈ 0.82 s |
| Rotation speed | 440 °/s |

## Key implementation details

### Scene JSON (`public/scenes/world/main.json`)
- World size: 3200 × 720
- Gravity declared via `world.physics.gravity.y = 2200`
- `camera.follow` = player entity id `"e-mr2mk93q-kwj9"`
- `camera.bounds` = `{ x:0, y:0, width:3200, height:720 }`
- Player entity (`e-mr2mk93q-kwj9`): role `"player"`, physics `{ bodyW:36, bodyH:36 }`
- Tilemap entity (`e-mr2mi1gy-w2w0`): role `"terrain"`, tilemapId `"platform"`

### Tilemap (`public/tilemaps/platform.json`)
- 80 × 5 cells, 40px each = 3200 × 200px total
- Centered at world (1600, 620) → top of tilemap at y=520
- `humanCurated: true` — do NOT overwrite layer data without asking the user

### GameScene.ts
- `addTilemapCollider(this, 'e-mr2mi1gy-w2w0', player)` — wires platform collision
- `body.blocked.down` — ground detection
- `body.blocked.up` — ceiling death
- `body.setVelocityX(320)` every frame — constant speed
- Rotation snaps on landing: `Math.round(rotation / (π/2)) * (π/2)`
- Level end at `LEVEL_END_X = 3155`

## What was changed this turn
- Added `role`, `physics` block, and `camera.follow` to the world scene JSON
- Set world width to 3200 and gravity to 2200 px/s²
- Implemented all six core mechanics in GameScene.ts (auto-move, collision, jump, rotation, camera, win screen)
