# Space Shooter

**Genre**: Arcade shoot-em-up  
**Core mechanic**: Player pilots a spaceship with arrow keys and fires bullets with Space. Enemies spawn from all four screen edges and fly toward the player. Destroy enemies for points; avoid being hit.

## Features implemented

- **Player ship** — procedurally drawn cyan triangle with cockpit, wings, engine exhaust glow; rotates to face the last movement direction; engine thrust particles when moving
- **4-directional movement** — arrow keys; diagonal movement is normalised to consistent speed; ship visual rotates to match facing direction
- **Shooting** — Space fires a bullet in the ship's facing direction; 210 ms cooldown; muzzle flash particle burst
- **Enemy types** (all textures nose-up, rotated toward player at spawn)
  - **Scout** (red tri): fast, 1 HP, 10 pts
  - **Fighter** (orange diamond): medium speed, 2 HP, 25 pts
  - **Cruiser** (purple hexagon): slow, 4 HP, 60 pts
- **Difficulty ramp** — spawn interval decreases with score; enemy type weighting shifts toward harder enemies above score 100/300
- **Lives system** — 3 lives; 2.2 s invincibility after being hit (player flashes); game over at 0 lives
- **Particle effects** — orange thrust trail, coloured explosion bursts on kill/hit, muzzle flash
- **HUD** — score (top-left, cyan bold) + heart icons for lives (top-right, pink) rendered inside GameScene at depth 10
- **Score popups** — floating "+pts" text fades upward on each kill
- **Game Over screen** — dark overlay, "GAME OVER" title slides in, final score, blinking "PRESS SPACE TO RESTART" prompt; Space key restarts via `scene.restart()`
- **Background** — deep-space gradient, five random nebula ellipses, 170 procedural stars (varying brightness, some blue-tinted)

## Key implementation details

- **GameScene.ts** — self-contained; generates all textures once via `generateTexture()` (guarded by `textures.exists('p_ship')`); uses `physics.add.group()` for bullets and enemies; overlaps for bullet↔enemy and player↔enemy collisions; `scene.restart()` reinitialises all state in `create()`
- **UIScene.ts** — intentionally empty; HUD lives in GameScene
- **Texture orientation** — all sprites drawn with nose pointing UP at rotation=0; rotation formula for all objects: `direction_angle + Math.PI/2`
- **Enemy AI** — velocity set once at spawn toward player position; no homing (allows dodging)
- **Invincibility** — `invincible` boolean + `invincibleMs` countdown in `tickInvincibility(delta)`

## Controls

| Key        | Action                          |
|------------|---------------------------------|
| Arrow keys | Move ship (8 directions)        |
| Space      | Shoot in facing direction       |
| Space      | Restart after game over         |

## Changed this turn

- Full initial implementation — game built from scratch replacing the empty scaffold
