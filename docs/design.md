# Game Design Document — Geometry-Style Auto-Runner

## Concept

A side-scrolling auto-runner in the spirit of Geometry Dash. The player controls a cube that sprints rightward automatically; tapping jumps the cube over obstacles. Hit anything deadly and the run restarts from the beginning — attempt count climbing as a badge of honor. Reach the end portal to complete the level.

All levels and visual art are hand-crafted by the game's author using 64 × 64 px tiles drawn in the built-in Pixel Artist tool, then painted into levels with the Tilemap Editor.

---

## Core Loop

1. Level loads → cube auto-runs right
2. Player taps (space / click / touch) to jump
3. Cube rotates as it moves (visual feedback of speed)
4. Hit a solid block or spike → instant death → restart level from beginning, attempts + 1
5. Reach the **end portal** → level complete → next level (or back to menu)

---

## Design Pillars

- **Feel first** — the jump arc must feel tight and snappy, like the original GD. Jump height and gravity are tunable.
- **Author-made levels** — no procedural generation. Every obstacle, every gap, every spike is intentional. The game engine loads levels built in the Tilemap Editor.
- **Clean visual reading** — tiles must be instantly readable: solid blocks (safe to stand on), spikes/hazards (deadly), end portal (goal). The author controls all visual design.
- **Merciless but fair** — death resets to the start of the level. The attempts counter is always visible.

---

## Controls

| Input | Action |
|-------|--------|
| Space | Jump |
| Left click / tap | Jump |

Hold the input for a slightly higher arc (sustained gravity suppression for ~200 ms).

---

## Player — Cube Mode

- Auto-runs right at a fixed speed (tunable via rules.json)
- One-jump only (no double-jump in v1)
- Rotates clockwise as it moves (45° per grounded block-length)
- Physics: arcade gravity, lands on top surface of solid tiles

---

## Level Architecture

- Each level is a **64 × 64 px tileset** painted in the Tilemap Editor
- Tile types:
  - **Solid block** — player stands on top, dies on side/bottom
  - **Spike / hazard** — any contact = death
  - **End portal** — any contact = level complete
  - **Decorative** — no collision, purely visual
- The ground line sits 2 tile-rows from the bottom of the canvas
- Levels scroll horizontally; camera follows the cube on the X axis only, Y is fixed

---

## HUD

- **Attempts** counter (top-left, always visible)
- **Progress bar** (top) — shows how far through the level the cube is
- On death: brief flash, "Attempts: N" updates
- On completion: "Level Complete!" with the attempt count

---

## Art & Audio Direction

- All art created by the game author at **64 × 64 px** per tile / player sprite
- Visual style: author's choice (neon geometric, pixel art, etc.)
- Cube rotation and particle trail on death are engine-provided polish
- Background: solid colour or gradient chosen by the author per level
- Audio: jump SFX, death SFX, level-complete jingle, optional BGM per level

---

## V1 Scope

- [ ] One playable level (expandable to more)
- [ ] Cube player mode only
- [ ] Tilemap-based collision (solid + spike + portal tile types)
- [ ] Attempts counter persisted across sessions (umicat.saves)
- [ ] Basic HUD (attempts + progress bar)
- [ ] Jump SFX + death particle burst
