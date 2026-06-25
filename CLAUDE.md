# Umicat Game

## Game
- Genre: top-down / sandbox starter
- Core mechanic: player moves around the canvas with arrow keys or mouse click

## Features Implemented
- Player character using `basic_character_spritesheet.png` (48×48, 4-directional walk animations)
- Arrow key movement (up/down/left/right, diagonal normalised)
- Click-to-move: click anywhere on the canvas and the character walks to that point
- Directional walk animations: walk-down / walk-up / walk-left / walk-right; idle stops on frame 0
- World bounds clamping so the player can't leave the canvas

## Key Implementation Details
- Scene-as-data architecture: `public/scenes/manifest.json` + `public/scenes/world/main.json`
- Player entity: role `player`, assetId `basic_character_spritesheet`, placed at (640, 360)
- Manifest asset entry has `spriteSheetConfig`, `fps: 8`, and four animation definitions
- Movement + animation logic in `GameScene.ts` `update()` — velocity 160 px/s
- Arrow keys cancel the mouse move-target; arrival threshold is 4 px

## Changed This Turn
- Added `basic_character_spritesheet` to manifest assets with spritesheet config + 4 walk animations
- Added `e-player` entity (role: player) to `world/main.json`
- Wired arrow key + click-to-move + directional animation in `GameScene.ts`
