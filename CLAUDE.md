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
  - Physics body with vision-authored hitbox (tiny foot-rect from `applyAssetHitbox`)
  - World bounds collision
- **24 animations** registered in manifest for the spritesheet (idle/walk/run/attack/hurt/die × 4 directions, fps: 8)

---

## Key Implementation Details

- **Scene data:** `public/scenes/world/main.json` — sprite entity has `role: "player"`
- **Manifest:** `public/scenes/manifest.json` — `premium_character_spritesheet` asset has `fps: 8` and full `animations[]` array (SDK auto-registers them)
- **GameScene.ts** — behavior code:
  - `create()`: looks up player by `byRole('player')[0]`, adds physics, applies hitbox via `applyAssetHitbox`, plays `idle-down`
  - `update()`: reads WASD, sets velocity, switches `walk-{dir}` / `idle-{dir}` animations based on movement; `lastDir` tracks facing when stopped
- **Hitbox:** from asset metadata (x:19, y:28, w:8, h:4) — tiny foot-rect for top-down feel
- **Animation priority:** horizontal direction wins over vertical when moving diagonally

---

## This Turn
- Added `role: "player"` to the sprite entity in main.json
- Added `fps: 8` and 12 looping animations (idle + walk + run × 4 dirs) to manifest
- Rewrote GameScene.ts with WASD movement + directional walk/idle animation switching
