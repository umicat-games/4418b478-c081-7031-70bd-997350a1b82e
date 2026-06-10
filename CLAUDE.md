# Game: Retro Space Shooter

## Genre & Mechanic
Horizontal-scrolling space shooter. Player ship flies left-side; formations of alien enemies scroll in from the right. Shoot enemies, survive, clear waves.

## Visual Style
Retro arcade / pixel — all drawn with the Graphics API. Dark gradient starfield background with parallax scrolling stars.

## Features Implemented
- **Player ship** — moves up/down (arrow keys or W/S); auto-fires with SPACE held; drawn with layered polygons (cockpit, wings, engine flame flicker)
- **3 enemy types** (one per row):
  - Row 0: Red crab-invaders (2 HP)
  - Row 1: Purple saucer aliens (1 HP)
  - Row 2: Green bug aliens (1 HP)
- **Enemy formation** — 6 cols × 3 rows; scrolls left with sine-wave vertical drift; loops back when it passes the left edge
- **Player bullets** — fast teal beams with muzzle-flash + spark particles on fire
- **Enemy bullets** — aimed at player, speed scales with wave number
- **Collision** — pixel-distance checks between beams and enemy screen positions
- **Explosions** — particle burst + shockwave ring tween on kill
- **Hit flash** — white rectangle overlay on enemy damage without kill
- **3 lives** — diamond HUD icons; respawn centre with 2.2s invincibility (blinking) on death
- **Camera shake** on player death
- **Waves** — formation speeds up per wave; enemy fire rate increases; wave-clear bonus (+wave×100); wave banner on start
- **Score** with bounce tween on change
- **Game Over screen** — dimmed overlay, final score, blinking "SPACE TO PLAY AGAIN" prompt; SPACE restarts
- **Persistent high score** — not yet implemented (future feature)

## Key Implementation Details
- All visuals: `Phaser.GameObjects.Graphics` layers (bgGfx, starGfx, enemyGfx, playerGfx)
- Particle texture: 4×4 white square generated via `make.graphics().generateTexture('px', 4, 4)`
- Enemy positions use `sx`/`sy` computed each frame in `drawEnemies()` (sine wave + formationX drift)
- Bullets stored as `{ rect: Phaser.GameObjects.Rectangle, vx, vy, alive }` arrays; pruned each frame
- No scene-as-data / loadWorldScene used — pure scene-as-code GameScene

## Controls
- **W / ↑** — move up
- **S / ↓** — move down
- **SPACE** — shoot (auto-fire while held)

## Changed This Turn
- Initial build: full horizontal space shooter from scratch
