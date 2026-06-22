# Neon Void — Game Design Document

## Concept
A top-down space shooter where the player pilots a sleek neon spacecraft and fights off waves of enemy ships attacking from all sides of the screen. Survive as long as possible, defeat bosses, and push for a high score.

## Core Loop
1. Player spawns in the center of a dark space arena.
2. Enemies stream in from all four edges of the screen — individually and in formations.
3. Player moves freely (WASD / Arrow keys) and shoots automatically toward the nearest enemy, or aims with the mouse.
4. Destroying enemies earns score and drops power-ups.
5. Every few waves a Boss appears — a large, heavily armored ship with unique attack patterns.
6. The game ends when an enemy or enemy projectile collides with the player's spacecraft.

## Design Pillars
- **Kinetic & fluid** — movement and shooting feel snappy and responsive; no input lag.
- **Readable at a glance** — the player ship glows one distinct color (cyan/blue); enemies glow another (red/orange); bullets are bright and easy to dodge.
- **Escalating pressure** — each wave is harder (more enemies, faster, shooting back); bosses are a dramatic spike.
- **Neon sci-fi aesthetic** — dark starfield background, glowing outlines and trails, particle explosions, screen-flash on hits.

## Systems

### Player
- Moves freely in all directions (WASD + Arrow keys).
- Fires a continuous stream of bullets in the direction they are moving / facing.
- Has no health bar — one hit = game over (risk/reward tension).
- Gains short invincibility frames (iframes) only during boss fight (debatable; keep as a tuning lever).

### Enemies
| Type | Behaviour |
|------|-----------|
| Scout | Fast, straight-line charge toward the player |
| Gunship | Slower, fires homing bullets back at the player |
| Carrier | Tanky, spawns smaller drones on death |

### Waves
- Waves escalate in enemy count and mix (Scouts early, Gunships from wave 3, Carriers from wave 6).
- Every 5th wave is a Boss Wave.
- A short countdown / dramatic intro before the boss spawns.

### Boss
- Large, multi-phase health bar.
- Phase 1: fires spread-shot patterns.
- Phase 2 (below 50% HP): adds spinning laser sweep.
- Defeating the boss clears the screen and grants a big score bonus.

### Power-ups (dropped randomly from enemy kills)
- **Speed Boost** — brief movement speed increase.
- **Rapid Fire** — doubled fire rate for 10 seconds.
- **Shield** — absorbs ONE hit, then disappears.

### Scoring
- Scouts: 10 pts | Gunships: 25 pts | Carriers: 50 pts | Boss: 500 pts
- Multiplier increases as you clear consecutive waves without being hit.

## Feel & Art Direction
- **Palette**: Near-black background (#0a0a1a), player in electric cyan (#00f0ff), enemies in hot coral/orange (#ff4444 / #ff8800), bosses in deep purple/magenta (#cc00ff).
- **Particle FX**: Bright spark explosions on enemy death; engine trail behind player ship; muzzle flash on bullet fire.
- **Screen effects**: Brief white flash + camera shake on player near-miss (boss bullets passing close); screen darkens dramatically during boss intro.
- **Audio direction**: Pulsing synth BGM that intensifies each wave; crisp laser SFX; heavy impact boom on boss hits.

## Controls
| Input | Action |
|-------|--------|
| WASD / Arrow Keys | Move spacecraft |
| Mouse movement | Aim direction (ship rotates to face cursor) |
| Mouse button / Space | Fire (or auto-fire while moving) |
| P / Esc | Pause |

## Win / Loss Conditions
- **Loss**: Any enemy or enemy bullet contacts the player ship.
- **Win**: There is no true win — it's a survival high-score loop. The goal is to beat your personal best.

## Persistence
- High score saved automatically between sessions.
