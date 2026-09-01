# Space Shooter — Game Design Doc

## Concept
A bright, cartoony top-down space shooter. The player pilots a friendly
starship, freely flying around the lower portion of the screen, blasting
an endless stream of alien invaders. There is no ending level — the game
is about surviving as long as possible and posting the highest score.

## Core Loop
1. Enemies stream in from the top of the screen in waves.
2. The player moves freely (up/down/left/right) to dodge enemy fire and
   position for shots.
3. The player fires forward automatically or on input, destroying enemies
   for points.
4. Waves escalate over time — more enemies, new enemy types, faster
   patterns — raising the tension gradually rather than through discrete
   levels.
5. The player has a limited number of lives/hits. Losing them all ends the
   run and shows the final score (with a high score comparison).
6. The player restarts to try to beat their best score.

## Design Pillars
- **Friendly, not grim.** Bright saturated colors, rounded silhouettes,
  bouncy feedback. Even "danger" reads as fun, not scary — appropriate for
  a broad, casual audience.
- **Always in control.** Free 4-directional movement (not rail-locked) so
  the player always feels they can dodge into an opening.
- **Endless tension curve.** No fixed levels — difficulty is a dial that
  turns up smoothly the longer a run goes, keeping "one more try" appeal.
- **Readable chaos.** Even as waves get busy, enemy and bullet silhouettes
  stay simple and distinct so the screen never becomes unreadable noise.

## Systems

### Movement
- Free-move in all four directions (up/down/left/right), not lane-locked
  and not auto-scrolling forward. The player ship stays roughly in the
  lower-to-mid portion of the screen, matching classic vertical shmup
  framing.

### Combat
- Player fires a forward projectile stream (auto-fire while playing, to
  keep the free-move controls simple with no extra fire button needed —
  can revisit if a fire button is preferred later).
- Enemies vary in silhouette/color to telegraph behavior (a straight-line
  drone, a side-to-side weaver, maybe a tougher armored type later).
- Enemies fire back with clearly telegraphed, dodgeable projectiles.

### Waves & Difficulty
- Enemies spawn in an endless, escalating sequence rather than fixed
  levels: spawn rate, enemy speed, and enemy variety all creep upward
  the longer the run lasts.
- Occasional stronger/bigger enemies act as mini-milestones within the
  endless flow.

### Scoring & Progression
- Score increments per enemy destroyed (tougher enemies worth more).
- A running score display during play.
- Best score persists between runs (high score), so players have
  something to chase run over run.

### Lives / Failure
- Player has a small number of lives (hits before game over). Getting hit
  costs a life and gives a brief moment of safety (invulnerability) before
  play continues, so hits don't feel unfair.
- Game over on zero lives → show final score vs. high score → restart.

## Feel
- Punchy, immediate feedback on every hit: flashes, screen shake on player
  hits, particle bursts on enemy destruction, satisfying pickup pops.
- Motion stays purposeful — no idle bobbing/pulsing decoration; movement
  reads as either player input or a gameplay signal.

## Art & Audio Direction
- **Visual style:** bright & cartoony — saturated primary/secondary
  colors, friendly rounded shapes, thick clean silhouettes rather than
  gritty/realistic sci-fi detail.
- **Palette:** cheerful sky/space gradient background (not flat black),
  candy-colored ships and enemies, warm explosion colors (orange/yellow)
  for contrast against a cooler background.
- **Audio (future pass):** upbeat, energetic — laser zaps, cheerful
  explosion pops, a driving background track. Not implemented yet.

## Open Questions / Future Ideas
- Power-ups (spread shot, shield, speed boost)?
- A manual fire button vs. auto-fire?
- Boss enemies as periodic endless-run milestones?
