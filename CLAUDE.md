# Game: My first game

## Genre / Mechanic
Empty scaffold — no gameplay implemented yet. The scene shows a placeholder title text when no entities are present.

## Features Implemented
- Empty world scene with dark background (#1a1a2e)
- Placeholder text "My first game" displayed when the scene has no entities

## Key Implementation Details
- Uses scene-as-data architecture (`public/scenes/world/main.json`)
- `GameScene.ts` loads the world scene via `loadWorldScene` from the SDK
- No entities, no physics, no behavior wiring yet

## Changes This Turn
- Updated placeholder text from "Describe your game\nin the chat!" to "My first game"
