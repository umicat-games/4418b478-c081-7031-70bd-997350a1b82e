# Geometry Dash-Style Runner

## What this game is
A Geometry Dash-inspired auto-runner platformer. The player cube moves right automatically; the player taps to jump over spikes. All maps and player skins are authored by the user in the visual editor.

## Features implemented
- **Auto-move**: Player moves right at 320 px/s from the moment the scene loads
- **GD-calibrated physics**:
  - Horizontal speed: 320 px/s (≈5 tiles/s, matches GD default cube)
  - Jump velocity: −710 px/s upward burst
  - World gravity: 1575 px/s² (set via `world.physics.gravity` in scene JSON)
- **Jump input**: Space bar OR pointer click/tap
- **360° rotation on jump only**: Exactly one clockwise turn (2π rad) per jump; freezes if completed mid-air; snaps to 0° on landing
- **Platform collision**: `addTilemapCollider` on all entities with `role: "platform"`; hitbox read from user-authored manifest metadata
- **Spike collision → death**: `addTilemapCollider` with callback on all `role: "spikes"` entities; sub-tile collision rects from Tile Metadata Editor respected automatically
- **Camera follow**: Smooth horizontal follow (lerpX=0.12), clamped to 3200×720 world bounds
- **Level complete**: Triggers when player.x > 3100 (near right edge of 3200 px map); shows green overlay with Play Again button
- **Death / restart**: Spike hit or fell off bottom → red overlay with Try Again button; scene.restart() resets everything cleanly
- **Restart**: Both overlays have a button that calls `scene.restart({ sceneId })`

## Key implementation details
- **World size**: 3200×720 (50 tiles × 64 px wide, 720 px tall)
- **Tile / entity size**: 64×64 px for player, platform tiles, and spike tiles
- **Player entity**: `role: "player"` in world/main.json; physics body added in GameScene.ts via `physics.add.existing`; hitbox from `applyAssetHitbox` (manifest: x=11, y=16, w=43, h=35)
- **Platform tilemap**: `role: "platform"`, centered at (1600, 624); top surface at y=528; tiles flagged `solid: true`
- **Spikes tilemap**: `role: "spikes"`, centered at (1600, 432); bottom row spikes at y=464–528; sub-tile collision rects (x:18, y:38, w:27, h:26)
- **Camera follow**: `startFollow(player, false, 0.12, 1)` + `setBounds(0, 0, 3200, GAME_HEIGHT)` in code (not scene JSON) to control lerpX only
- **State flags**: `isDead`, `isLevelComplete`, `jumpPressed`, `isInAir`, `rotationProgress` — all reset in `init()` for clean restarts
- **Overlay**: scrollFactor(0) + depth 1000/1001, positioned at screen-center (GAME_WIDTH/2, GAME_HEIGHT/2)

## Assets in manifest
- `player-64x64`: Player cube sprite, hitbox {x:11, y:16, w:43, h:35}
- `pf-top-64x64`: Platform top tile, solid, full cell collision
- `pf-body-64x64`: Platform body tile, solid
- `spike-64x64`: Spike tile, solid, sub-tile collision {x:18, y:38, w:27, h:26}

## Changed this turn
- Updated world/main.json: world width 3200, gravity 1575, camera bounds 3200×720, added role fields to all three entities
- Rewrote GameScene.ts: full GD physics loop, jump + rotation mechanic, platform/spike collision, camera follow, death and level-complete overlays
