# Flappy Bird

**Genre:** Arcade / skill-based endless runner  
**Core mechanic:** Tap (or press Space) to flap upward; gravity pulls the bird down. Navigate through gaps between green pipe pairs. Score a point each time you pass a pair. Collide with a pipe or the ground → Game Over.

## Features Implemented

- **Bird** — Physics sprite with arcade gravity. Custom texture drawn with Phaser Graphics (golden body, orange wing, beak, eye with shine). Shrunk hitbox for fair play. Nose-down rotation when falling; pitches up on flap.
- **Pipes** — Container-based (no physics); drawn with Phaser Graphics each spawn. Green body + darker right shadow + lighter left highlight + wider cap facing the gap. Moved manually each `update()` frame.
- **Bat enemies** — Dart across the screen from right to left with a sine-wave vertical wobble. Dark purple with red glowing eyes, veined wings, and fangs drawn with Phaser Graphics (`generateTexture('bat')`). First bat appears after 3 s of play; subsequent bats spawn every 3.2–5.8 s. Circle collision (26 px radius). Freeze on death.
- **Collision detection** — Manual AABB check: bird hitbox (26×20) vs pipe half-width (body + cap extension). Ground and ceiling kill check.
- **Scoring** — Point awarded when pipe centre passes bird X. Score text pops with a tween + golden particle burst.
- **Background** — 5-band sky gradient (cyan→light blue), white 3-puff clouds, grass + dirt ground strip with texture marks.
- **Game states** — `idle` (no gravity, "FLAPPY BIRD" + "TAP or SPACE" shown), `playing`, `dead`.
- **Game-over screen** — Bird tumbles and squashes on ground; white flash; modal panel scales in showing score, best score, and restart prompt.
- **Best score persistence** — Stored in `this.registry` (survives scene restarts within the same session).
- **Font** — "Bangers" (Google Font) declared in `public/webfonts.json`.

## Key Implementation Details

| Thing | Detail |
|---|---|
| Bird texture | Generated once with `make.graphics().generateTexture('bird', 48, 36)`, cached after first create |
| Pipe pairs | `PipePair[]` — each has a `Container` + `gapTop`/`gapBottom` Y values; destroyed when x < -200 |
| Gravity | World gravity 1400 px/s²; idle bird has `setGravityY(-GRAVITY)` to cancel it |
| Score trigger | `pair.container.x < BIRD_X` (pipe centre passes bird) |
| Best score | `this.registry.get/set('bestScore')` — persists across `scene.restart()` calls |

## Controls

- **Tap / click** — Flap
- **Spacebar** — Flap

## Constants (in GameScene.ts)

`GRAVITY=1400`, `FLAP_VEL=-440`, `PIPE_SPEED=240 px/s`, `PIPE_SPAWN_MS=1750`, `PIPE_GAP=190`, `GROUND_H=76`

## Changed This Turn

- Added flying bat enemies with sine-wave darting motion, glowing red eyes, and veined wings
- Bats spawn after a 3 s grace period; new bat every 3.2–5.8 s at random height and speed
