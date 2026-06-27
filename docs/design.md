# Star Siege — Game Design Document

## Concept
A top-down space shooter where the player's craft is surrounded on all sides. Enemies pour in from every edge of the screen, and the ship blasts outward in all 4 directions simultaneously. The challenge is positioning: dodge the closing swarm and stay alive long enough to rack up a high score.

## Core Loop
1. **Survive** — move around the arena to avoid enemies homing in on you
2. **Destroy** — auto-fire takes out enemies; each kill scores points (×wave multiplier)
3. **Escalate** — every wave raises enemy speed and spawn rate, increasing pressure
4. **Compete** — when you die the game shows your score and wave, then offers replay

## Design Pillars
- **Tension from all angles** — threats come from every direction equally; no safe corner
- **Simple controls, high mastery ceiling** — one stick to move, no aiming needed; skill is in positioning
- **Clear escalation** — each wave feels meaningfully harder through faster, denser enemies
- **Instant retry** — game over to back in action in one click

## Systems

### Shooting
- Ship fires 4 simultaneous energy bolts every ~210 ms: up, down, left, right
- Bullets travel at fixed speed and despawn off-screen
- No player aiming required — strategic positioning creates natural focus fire

### Enemies
- Four visually distinct enemy types spawn from the corresponding edge:
  - Red from the top
  - Orange from the bottom
  - Purple from the left
  - Cyan from the right
- All enemies home in on the player's position each frame
- Speed scales with wave; spawn interval decreases (capped at a minimum)

### Waves
- Wave advances after killing ENEMIES_PER_WAVE + (wave−1)×4 enemies
- A wave banner announces each new wave
- Score per kill: 10 × current wave

### Lives & Invincibility
- 3 lives; losing a life gives ~1.6 s of invincibility (indicated by player blink)
- Enemy contact destroys the enemy and costs a life

## Feel & Art Direction
- **Palette**: deep space — dark navy/black background, nebula purples/reds, electric cyan/white for the player
- **Player**: sleek angular ship silhouette, blue-white energy glow underneath
- **Enemies**: spiky circular drones, each tinted to match their spawn side
- **Feedback**: particle spark bursts on every kill; screen flash red on hit; wave banner pop
- **Background**: gradient void, soft nebula blobs, 200-dot star field

## Controls
| Action | Keys |
|--------|------|
| Move   | WASD or Arrow Keys |
| Shoot  | Automatic (4-way) |
