# Bullet Storm

## Game overview
A bullet-hell survival game. The player pilots a neon fighter jet and must dodge an endless stream of bullets that spawn from all four screen edges — each one aimed directly at the player the moment it appears, then traveling in a straight line forever. No enemies. No levels. Just how long can you survive?

## Visual style
Sleek neon / sci-fi glow. Deep dark-blue/purple gradient background with faint grid lines and atmospheric corner glows. Player ship is a cyan neon fighter jet drawn entirely with the Phaser Graphics API. Bullets are orange/red glowing projectiles with a multi-layer glow texture.

## Controls
- **WASD / Arrow keys** — move in that direction (velocity-based, normalized on diagonal)
- **Mouse** — when no keys are held, the plane smoothly follows the cursor

The plane's nose always rotates to face the mouse cursor.

## Features implemented
- Player fighter jet drawn via Graphics API with wings, tail fins, fuselage, cockpit glow, and engine nozzle
- Engine exhaust flame that responds to movement speed
- Bullets spawning from all 4 edges, aimed at the player's position at spawn time
- Escalating difficulty: spawn interval starts at 1100 ms, reduces by 45 ms every 5 seconds, capped at 90 ms
- Bullet speed also increases over time (base 260 px/s, capped at 580 px/s)
- Survival timer displayed at top center in large neon text
- Best time display (below timer)
- Active bullet count (top right)
- Controls hint that fades after 3.5 s
- Death: explosion particle burst + shockwave ring + screen flash
- Game Over overlay: panel with survived time, best time, "NEW BEST!" with pop tween if applicable, Play Again button with hover state
- `scene.restart()` resets and replays
- High score persisted via `umicat.saves` (key: `highScore`)

## Key implementation details
- `GameScene.ts` — fully code-driven (no scene JSON entities used for gameplay)
- `BootScene.ts` — unchanged scaffold; loads manifest and starts GameScene
- `UIScene.ts` — empty; all HUD is rendered inside GameScene
- `src/visuals.ts` — minimal; exports empty `renderScripts` for main.ts
- `src/main.ts` — exports `umicatReady` (Umicat.init promise) for GameScene to await
- Player body: 32×32 near-invisible texture, circle hitbox radius 10 (offset 6,6 to center)
- Bullet body: 32×32 glow texture (R=16), circle hitbox radius 8 (offset 8,8 to center)
- Plane draw angle convention: angle=0 → nose points up; angle=PI/2 → nose points right
- Mouse-to-plane angle: `Phaser.Math.Angle.Between(player, mouse) + PI/2`
- Bullets created via `this.bullets.create()` (not `add()`) to avoid body-reset bug

## This turn
Built the complete game from scratch: neon fighter jet, bullet spawning system, escalating difficulty, HUD, death effects, game over overlay, save/load best time.
