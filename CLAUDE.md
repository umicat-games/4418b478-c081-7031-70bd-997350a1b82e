# Catopia — Technical Session Notes

## What game is this?
**Title**: Catopia
**Genre**: Nurturing / Social / Simulation
**Core mechanic**: Player cares for an AI-driven child spirit on a pixel-art island. The child has autonomous daily behavior (algorithmic layer) and AI-powered conversation (AI layer). Player farms, gathers, builds, and shops to provide for the child.

## Features currently implemented
- Scene-as-data world with two tilemap layers: `water` and `grass-island`
- Scene JSON defines world (1280×720), camera bounds, and tilemap-ref entities
- **3× camera zoom** — each 16×16 source tile renders as 48×48 px on screen; `roundPixels = true` for crisp pixel art
- **Child spirit sprite** (`premium_character_spritesheet`, role=`child`) placed on the island
- **Wandering AI** — child walks automatically in random directions (55 px/s), changing direction every 1.5–3.5s
- **Camera follows child** — `cameras.main.startFollow` keeps the child centred; camera is clamped to world bounds
- **Tilemap collision** — child is blocked by grass island boundary tiles (`grass_tiles_v2` solid tiles with sub-tile collisionRects); uses `addTilemapCollider` + `applyAssetHitbox` from SDK
- Immediate direction change when child hits a boundary (via `body.blocked.*` check in `update()`)

## Key implementation details
- `GameScene.ts`: loads world scene via SDK, sets 3× zoom + roundPixels, wires wandering behavior
- Entity lookup by role (`byRole('child')`) — never by entity ID
- Asset hitbox applied via `applyAssetHitbox` (asset has vision-authored foot-area hitbox: x=19,y=28,w=8,h=4)
- Grass-island tilemap entity ID: `e-mqveju7y-sk2r` (used in `addTilemapCollider`)
- Sprite entity: `e-mqvfwxir-fuj2`, role=`child`, assetId=`premium_character_spritesheet`
- `BootScene.ts`: loads manifest, starts GameScene
- Scene file: `public/scenes/world/main.json`
- Design doc: `docs/design.md`

## What was changed this turn
- Added `"role": "child"` to the sprite entity in `public/scenes/world/main.json`
- Rewrote `GameScene.ts` to:
  - Import `getManifest`, `applyAssetHitbox`, `addTilemapCollider` from SDK
  - Add Arcade physics body to the child sprite after scene load
  - Apply hitbox from asset metadata via `applyAssetHitbox`
  - Wire tilemap collision with grass-island via `addTilemapCollider`
  - Implement wandering AI with blocked-wall detection for smooth direction changes
