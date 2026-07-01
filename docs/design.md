# Geometry Dash Clone — Game Design Document

## Concept
A side-scrolling auto-runner where the player controls a cube that moves forward automatically. The only input is a jump. The challenge is entirely in obstacle timing and level design.

## Core Loop
1. Level starts — cube auto-runs rightward.
2. Player taps/clicks to jump over obstacles.
3. If the cube hits a spike, falls, or touches a ceiling → instant death, restart from the beginning.
4. Reach the end of the map → Level Complete screen.
5. Player retries or the designer builds the next map.

## Design Pillars
- **One-button simplicity** — the entire game is a single jump input. Mastery comes from timing, not complex controls.
- **Fair challenge** — obstacles are authored by the human designer; the physics are transparent and consistent.
- **Rhythm-ready** — the 40px grid and constant speed make it possible to sync obstacles to a beat.

## Systems

### Movement
- Constant horizontal speed (GD normal speed).
- Jump height is fixed — no variable-height jump. The only control is WHEN you press.

### Rotation
- The cube spins exactly once per flat jump (clockwise).
- On landing it snaps to the nearest right-angle, making it look deliberate.
- No rotation while on the ground — it only moves when it "rolls" through the air.

### Obstacle Types (to be added by the designer)
- Spikes / sharp tiles — kill on contact.
- Raised platforms — force a jump or die.
- Gaps — fall into them and die.
- Ceiling sections — don't jump too high.

### Level Design
- All maps are 40 px grid-based tilemap files, paintable in the Tilemap Editor.
- The player designs their own levels — the game engine handles physics, collision and camera.

## Controls
- **SPACE** or **mouse click / screen tap** → jump (only while grounded)

## Art & Audio Direction
- Player cube: custom sprite created by the designer (40 × 40 px on a 40px grid).
- Platform tiles: custom tileset created by the designer.
- Background: dark navy `#1a1a2e`.
- Music and SFX: to be added by the designer.

## Win / Lose Conditions
- **Win**: reach the end-of-map trigger → animated overlay + Play Again button.
- **Lose**: hit spike / fall below screen / hit ceiling → red flash, camera shake, auto-restart after 700ms.
