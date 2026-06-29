# Game: Top-Down Explorer

**Genre:** Top-down RPG / adventure  
**Core mechanic:** Player explores a tile-based world with WASD movement and directional walking animations.

---

## Features Implemented

- **Tilemap world** — two tilemap layers in the main scene:
  - `water` tilemap (animated water tiles)
  - `grass` tilemap — five separate grass islands connected by paths of varying widths (painted in Tilemap Editor)
- **Player sprite** (`premium_character_spritesheet`, 48×48 frames) with:
  - **WASD movement** at 120 px/s, diagonal movement normalized
  - **4-direction walk animations**: `walk-down`, `walk-up`, `walk-left`, `walk-right`
  - **4-direction idle animations**: `idle-down`, `idle-up`, `idle-left`, `idle-right` (plays when stopped, keeps last-faced direction)
  - Physics body via entity `physics` block in main.json (SDK auto-wires at load)
  - Hitbox: bodyW=8, bodyH=4, offsetX=19, offsetY=28 (tiny foot-rect for top-down feel)
  - World bounds collision
- **Camera follow** — camera smoothly follows the player (lerp 0.1, deadzone 80×60)
- **Tilemap collision** — player cannot walk into grass tiles marked as solid in the Tileset Editor
  - Uses `addTilemapCollider(scene, 'e-mqyhplcx-udfj', player)` (grass entity ID)
  - SDK auto-arms `setCollisionByProperty({ solid: true })` at scene load
- **24 animations** registered in manifest for the spritesheet (idle/walk/run/attack/hurt/die × 4 directions, fps: 8)

---

## Key Implementation Details

- **Scene data:** `public/scenes/world/main.json` — sprite entity has `role: "player"` and `physics` block (SDK auto-adds Arcade body at `loadWorldScene` time — no `physics.add.existing` in code)
- **World size:** 1088×1088px (matches 68×68 tile × 16px tilemap)
- **Manifest:** `public/scenes/manifest.json` — `premium_character_spritesheet` asset has `fps: 8` and full `animations[]` array (SDK auto-registers them)
- **GameScene.ts** — behavior code:
  - `create()`: calls `loadWorldScene`, sets up WASD keys, looks up player by `byRole('player')[0]`, plays `idle-down`, starts camera follow, wires tilemap collider
  - `update()`: reads WASD, sets velocity on the pre-existing Arcade body, switches `walk-{dir}` / `idle-{dir}` animations; `lastDir` tracks facing when stopped
- **Animation priority:** horizontal direction wins over vertical when moving diagonally
- **Grass tilemap entity ID:** `e-mqyhplcx-udfj` (used in addTilemapCollider)
