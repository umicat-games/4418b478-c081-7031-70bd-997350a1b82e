# Sky Squadron — Game Design Doc

## Concept
A classic vertical-scrolling arcade air-combat game. The player pilots a
plane at the bottom of the screen, flying "up" into an endless stream of
enemy aircraft. Cartoony, colorful, upbeat — think Saturday-morning-cartoon
skies rather than gritty war.

## Core Loop
1. The player's plane sits near the bottom of the screen and moves freely
   left/right/up/down within the play area.
2. The plane auto-fires (or fires on hold) a stream of bullets upward.
3. Enemy planes fly in from the top in patterned waves, some weaving,
   some diving toward the player, occasionally firing back.
4. Destroying enemies scores points and occasionally drops a pickup
   (extra life, weapon power-up).
5. Taking enemy fire or colliding with an enemy costs a life; losing all
   lives ends the run and shows the final score.
6. Waves escalate in number/speed/aggression as the score climbs, building
   toward a boss encounter every so many waves.

## Design Pillars
- **Readable at a glance** — every plane type has a distinct silhouette
  and color so the player can instantly tell friend, grunt, and threat
  apart even in a busy screen.
- **Always feels fair** — hitboxes are generous for the player and telegraphed
  for enemies; deaths should feel like "I could've dodged that," never cheap.
- **Momentum & juice** — explosions, screen flashes, score pop-ups, and
  satisfying pickup feedback make every kill feel good, without ever
  slowing the pace down.

## Systems

### Player
- Free 2D movement within the visible play area (arrow keys / WASD, and
  touch drag on mobile).
- Continuous forward-firing weapon; power-ups temporarily widen or
  strengthen the shot.
- Lives-based: a small number of lives shown in the HUD; briefly
  invulnerable + flashing after taking a hit.

### Enemies
- Several grunt types with different movement patterns (straight dive,
  side-to-side weave, formation flyers) and a tougher "elite" type that
  shoots back.
- Periodic boss planes with multi-stage attacks and a visible health bar.

### Waves & Difficulty
- Enemies spawn in scripted waves that ramp in size and speed over time.
- Difficulty is data-driven so it can be tuned without touching code.

### Scoring & Progression
- Score increases per enemy destroyed (bigger/tougher enemies worth more).
- High score is remembered between play sessions.
- Pickups: extra life (rare) and weapon power-up (common).

## Feel
- Punchy, arcade-y — snappy plane movement, immediate visual feedback on
  every hit, kill, and pickup. Screen shake and particle bursts on
  explosions and boss hits.

## Art & Audio Direction
- Cartoony & colorful — bright blue sky background, fluffy cloud silhouettes
  drifting by, saturated primary colors for the player plane and varied
  hues per enemy type.
- Sound: light, arcade-style blips/pops for shots, a satisfying crunch for
  explosions, upbeat chiptune-ish background music.
