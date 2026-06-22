# Stellar Assault — Game Design Doc

## Concept
A top-down space shooter where the player pilots a sleek neon spaceship against endless waves of enemies that attack from all four edges of the screen. Survival is the goal; your score is the story.

## Core Loop
1. **Fly** — move freely around the arena with WASD / arrow keys
2. **Shoot** — auto-aim or manual fire at enemies closing in from every direction
3. **Survive** — dodge enemy fire and ramming; a single collision or enough hits ends the run
4. **Power up** — enemies occasionally drop weapon upgrades on death; grab them to turn the tide
5. **Score** — each kill earns points; score multipliers reward unbroken kill streaks

## Design Pillars
- **360° pressure** — enemies arrive from all edges, so no corner is safe; the player must keep moving
- **Readable chaos** — neon color-coding (player = cyan, enemies = red/orange, bullets = yellow, power-ups = green) keeps every element legible at high speed
- **Escalating intensity** — spawn rate, enemy speed, and bullet density ramp up over time so each run has a natural arc from calm to frantic

## Systems

### Player
- Free movement across the full 1280×720 arena
- Shoots toward the nearest enemy (or in the direction of movement if none nearby)
- Health: one hit = game over (initially); could expand to 3 lives as a stretch goal
- Visual: glowing cyan ship with an engine trail particle effect

### Enemies
- **Drone** (common): small, fast, flies straight toward the player, no bullets
- **Gunship** (uncommon): medium speed, fires a slow projectile at the player
- **Bomber** (rare): slow but large; explodes on death with a blast radius
- Spawned in waves from the four screen edges; wave interval decreases over time

### Weapons & Power-ups
Dropped randomly from defeated enemies (~20% drop chance):
- **Spread Shot** — fires 3 bullets in a cone instead of 1
- **Rapid Fire** — doubles fire rate for 8 seconds
- **Missiles** — homing projectiles that seek the nearest enemy
- **Shield** — absorbs one hit before breaking
- Only one weapon upgrade active at a time; picking a new one replaces the old

### Scoring
- Drone kill = 10 pts, Gunship = 25 pts, Bomber = 50 pts
- Kill streak multiplier: ×1 → ×2 → ×3 → ×4 (resets on taking damage)
- High score persisted across sessions

## Feel & Art Direction
- **Color palette**: deep space black/navy background, cyan player, red/orange enemies, yellow bullets, green power-up orbs
- **Visual effects**: glowing ships, bullet trails, particle explosions, engine exhaust particles, screen shake on big hits
- **Audio direction**: punchy SFX (laser pew, explosion, power-up chime); pulsing electronic BGM that speeds up as difficulty rises
- **Typography**: sleek futuristic font; large glowing score display at top center

## Controls
| Input | Action |
|---|---|
| WASD / Arrow keys | Move spaceship |
| Space / Left click | Fire (or auto-fire) |
| (future) Esc | Pause |
