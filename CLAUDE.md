# Catopia — Technical Session Notes

## What game is this?
**Title**: Catopia
**Genre**: Nurturing / Social / Simulation
**Core mechanic**: Player cares for an AI-driven child spirit on a pixel-art island. The child has autonomous daily behavior (algorithmic layer) and AI-powered conversation (AI layer). Player farms, gathers, builds, and shops to provide for the child.

## Features currently implemented
- Scene-as-data world with two tilemap layers: `water` and `grass-island`
- Scene JSON defines world (1280×720), camera bounds, and tilemap-ref entities
- **3× camera zoom** — each 16×16 source tile renders as 48×48 px on screen; `roundPixels = true` for crisp pixel art
- **Child spirit sprite** (`premium_character_spritesheet`, role=`child`) placed at island center (496, 302)
- **Wandering AI** — child walks automatically in random directions (55 px/s), changing direction every 1.5–3.5s; plays the matching `walk-down/up/left/right` animation based on the dominant velocity axis
- **Player-controlled camera** — drag to pan (mouse + touch, Rex Pan gesture threshold=10px); double-tap/double-click → smooth snap to cat (Quad.easeOut 520ms); "Find cat" pill button top-right corner
- **Camera centered on cat at startup** — `setZoom(3)` + pre-position scroll set BEFORE `await loadWorldScene()` so first frame is already centered on cat; no top-left flash
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
- Moved `setZoom(3)` + `roundPixels = true` + initial `setScroll` to BEFORE `await loadWorldScene()` in `GameScene.ts`
  - Camera is pre-centered on island center (496, 302) from the very first frame — no top-left corner flash
