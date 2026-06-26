# Catopia — Technical Session Notes

## What game is this?
**Title**: Catopia
**Genre**: Nurturing / Social / Simulation
**Core mechanic**: Player cares for an AI-driven child spirit on a pixel-art island. The child has autonomous daily behavior (algorithmic layer) and AI-powered conversation (AI layer). Player farms, gathers, builds, and shops to provide for the child.

## Features currently implemented
- Scene-as-data world with two tilemap layers: `water` and `grass-island`
- Scene JSON defines world (1280×720), camera bounds, and tilemap-ref entities
- **3× camera zoom** — each 16×16 source tile renders as 48×48 px on screen; `roundPixels = true` for crisp pixel art (no sub-pixel blur)

## Key implementation details
- `GameScene.ts`: loads world scene via SDK, sets camera zoom to 3 + roundPixels after load
- `BootScene.ts`: loads manifest, starts GameScene with initialScene
- Scene file: `public/scenes/world/main.json`
- Tilemaps: `public/tilemaps/water.json`, `public/tilemaps/grass-island.json` (assumed)
- Design doc: `docs/design.md`

## What was changed this turn
- Added `this.cameras.main.setZoom(3)` and `this.cameras.main.roundPixels = true` to `GameScene.create()` after `loadWorldScene` — implements the 3× integer zoom from the design spec
- Day/night tint system was intentionally NOT added (deferred by user)
