# Starfire: 4-Way Space Shooter

## Concept
A retro-style top-down space shooter where the player pilots a spaceship in a star-filled arena. Enemies swarm in from all four edges of the screen and the player must survive as long as possible while racking up points.

---

## Core Loop
1. Player spawns in the center of the arena
2. Enemies continuously stream in from all 4 sides (top, bottom, left, right)
3. Player moves freely with WASD/arrow keys and aims with the mouse cursor
4. Clicking fires bullets toward the cursor — destroy enemies before they reach you
5. Each enemy destroyed = points; game ends when the player's health reaches zero
6. High score persists between sessions

---

## Design Pillars
- **Constant pressure** — enemies come from every direction, no safe corner
- **Skill expression** — accurate mouse aim rewards precision; movement rewards spatial awareness
- **Escalation** — wave after wave gets faster and more numerous; the game ends when the player runs out of health
- **Retro feel** — pixel-art aesthetic, chunky shapes, bright neon-on-black palette, classic arcade scoring

---

## Systems

### Player
- Moves with WASD / arrow keys at a fixed speed
- Rotates to face the mouse cursor at all times
- Shoots a bullet toward the cursor on left-click (or held down for auto-fire)
- 3 health points; flashes on hit; brief invincibility window after taking damage
- Stays within the arena bounds (cannot leave the screen)

### Enemies
- 3 types:
  - **Drone** (basic): small, fast, low HP, low score value
  - **Bruiser** (medium): larger, slower, more HP, higher score value
  - **Missile** (fast): thin, very fast, one HP, high score value — hard to hit
- Spawn from beyond all 4 edges; home in on the player
- Colliding with the player deals 1 damage

### Waves / Escalation
- Enemies spawn on a continuous schedule that ramps up over time
- Every 30 seconds a "surge" happens: a burst of extra enemies from one random side
- Enemy speed and spawn rate both increase gradually

### Scoring
- Drone: 10 pts, Bruiser: 30 pts, Missile: 20 pts
- Score multiplier: consecutive kills without taking damage × 1.5 (resets on hit)
- Personal best (high score) saved between sessions

### HUD
- Health (hearts) — top-left
- Current score — top-center
- High score — top-right
- Wave / time survived — bottom-left

---

## Controls
| Action | Input |
|---|---|
| Move | WASD / Arrow Keys |
| Aim | Mouse cursor |
| Shoot | Left mouse button (hold to auto-fire) |

---

## Art & Audio Direction
- **Style**: retro pixel-art feel — drawn with sharp geometric shapes, limited neon palette
- **Colors**: dark space background with star field, player ship in cyan/white, enemies in red/orange/yellow
- **Effects**: particle sparks on destroy, screen flash on hit, muzzle flash on shoot
- **Audio**: (future) chiptune-style BGM, 8-bit SFX
