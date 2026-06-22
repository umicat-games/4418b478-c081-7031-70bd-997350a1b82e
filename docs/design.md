# Neon Void — Game Design Document

## Concept
A top-down space shooter where the player pilots a lone spacecraft at the center of a dark neon void. Enemies swarm in from every edge of the screen. Survive as long as possible, racking up a high score before one of them reaches the ship.

## Core Loop
1. Player spawns at the center of the screen
2. Enemies continuously stream in from all four edges
3. Player moves freely with WASD/arrows and aims with the mouse — left-click or auto-fire shoots bullets toward the cursor
4. Destroyed enemies award points; surviving longer multiplies the score
5. One enemy touch = game over → show final score → offer restart

## Design Pillars
- **Omnidirectional threat** — enemies spawn from all sides so the player is never safe facing one direction
- **Neon synthwave aesthetic** — dark starfield background, glowing ships outlined in vivid neon (cyan for the player, red/orange/purple for enemies), light bloom implied by gradient fills
- **Readable at a glance** — distinct silhouettes and colors; the player ship is always easy to spot
- **Escalating pressure** — spawn rate gradually increases over time, keeping difficulty fair early but intense late

## Systems

### Player
- Moves with WASD or arrow keys at a steady speed
- Aims with the mouse cursor; bullets always travel toward the cursor direction
- Auto-fires at a steady rate while the game is active (no manual shoot needed, or hold mouse button — TBD)
- Constrained to the playfield (cannot fly off-screen)

### Enemies
- Spawn at random positions along the four screen edges
- Fly in a straight line directly toward the player's current position at spawn time (simple homing at spawn, no continuous tracking)
- Single hit destroys an enemy; touching the player ends the game
- Spawn rate starts slow and ramps up every 10 seconds

### Scoring
- +10 points per enemy destroyed
- Score displayed live in the HUD (top-left)
- High score persisted across sessions

### Visual Style
- Background: deep black with subtle scrolling star particles
- Player ship: sleek pointed triangle, glowing cyan outline + bright core
- Enemies: smaller angular shapes in red/orange tones with a purple glow variant
- Bullet: small glowing white/yellow dart
- Explosions: brief burst of colored particles matching the enemy's hue
- Font: bold synthwave-style (e.g. Orbitron from Google Fonts)

## Feel
Fast-paced but learnable. The player should feel like they're in the eye of a storm — bullets flying outward, enemies collapsing inward. Death should feel fair (visible threat, not random). Restarting must be instant.

## Audio Direction
- Punchy shoot SFX, satisfying explosion bursts
- Driving synthwave BGM loop
- No speech
