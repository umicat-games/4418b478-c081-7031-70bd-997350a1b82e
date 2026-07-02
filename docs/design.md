# Geometry Dash-Style Runner — Design Document

## Concept
A single-player auto-runner in the spirit of Geometry Dash. The player's cube moves forward automatically; the only control is jumping. The challenge comes entirely from level design — where spikes are placed, and how the rhythm of obstacles demands precise timing.

## Core Loop
1. The cube auto-moves right from the moment the level starts
2. The player taps/clicks to jump — there is exactly one control
3. Navigate over spikes and reach the end of the level
4. Fail → instant restart (no lives, no countdown)
5. Win → celebration screen, option to replay

## Design Pillars
- **One input, infinite depth**: A single jump button is the complete control surface. Mastery comes from timing, not mechanics.
- **Creator-first**: All maps and player skins are hand-authored by the creator in the visual editor. No procedural generation.
- **Unforgiving but fair**: Death is instant on any spike contact. Restart is equally instant. The feedback loop is tight and satisfying.

## Physics Feel
Modelled on Geometry Dash's default cube speed with tile sizes scaled to 64 px:
- **Speed**: ~5 tiles per second (brisk, readable, not frantic)
- **Jump arc**: peaks at ~2.5 tiles high, ~0.9 s air time — enough to clear a single spike with a well-timed jump
- **Gravity**: heavy enough that mistimed jumps are punished; light enough that the arc is readable

## Controls
| Input | Action |
|---|---|
| Space bar | Jump |
| Mouse click / screen tap | Jump |

The cube only jumps when grounded. Holding the button does not chain-jump.

## Rotation
The cube rotates exactly one full clockwise turn (360°) during each jump. On landing it snaps to 0° (face always upright at rest). This visual feedback confirms the jump arc without adding complexity.

## Camera
The camera tracks the player horizontally with a slight lag (feels more cinematic than a locked viewport). Vertically the view is fixed — the full 720 px height is always visible so the player can see obstacles ahead.

## Win / Lose Conditions
- **Death**: Any contact with a spike tile → instant game over → try again prompt
- **Level complete**: Player reaches the right end of the map → celebration overlay → play again

## Art Direction
All art is pixel-style, authored at 64 × 64 px. The creator draws and places every element. The dark background (`#1a1a2e`) gives the neon-on-dark aesthetic common to rhythm runners.

## Audio Direction
_(To be added — jump SFX, death SFX, background music track)_

## Level Structure
Each level is a single continuous strip:
- **Width**: defined by the platform tilemap (currently 50 tiles = 3200 px)
- **Ground height**: bottom quarter of screen (platform covers y 528–720)
- **Obstacle layer**: spikes placed on the platform surface, authored in Tilemap Studio
