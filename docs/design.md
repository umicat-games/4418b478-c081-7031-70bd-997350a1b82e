# Star Siege — Game Design Document

## Concept

A colorful, cartoon-style space shooter where the player pilots a spaceship in an open arena. Enemies swarm in from all sides of the screen. Survive as long as possible and rack up the highest score.

* * *

## Core Loop

1.  Player spawns at the center of the arena.
    
2.  Enemies spawn continuously from the edges of the screen — all four sides.
    
3.  Player moves freely (WASD / Arrow keys), aims with the mouse, and fires on click.
    
4.  Destroyed enemies award points and occasionally drop power-ups.
    
5.  If any enemy touches the player's ship, the game ends.
    
6.  The game gets progressively harder: enemies spawn faster and move quicker over time.
    
7.  High score is saved between sessions.
    

* * *

## Design Pillars

-   **Kinetic & reactive** — every shot, hit, and explosion should feel satisfying with visual feedback (particle bursts, flashes, screen shake on near-misses).
    
-   **Easy to learn, hard to master** — pick up and play in seconds; depth comes from kiting, positioning, and crowd control.
    
-   **Colorful chaos** — bright neon-tinged cartoon palette; distinct enemy silhouettes so the player reads the battlefield at a glance.
    
-   Player Space Craft - It's a tranagle shape, morden one.
    

* * *

## Systems

### Player Ship

-   Moves in all 8 directions (WASD / Arrow keys), constant speed.
    
-   Rotates to face the mouse cursor at all times.
    
-   Fires a bullet toward the mouse cursor on left-click (or held for auto-fire).
    
-   Has no health — one hit = game over (classic arcade feel).
    

### Enemies

-   **Drone** — small, fast, straight-line approach. Low points.
    
-   **Tanker** — larger, slower, takes 2–3 hits. More points.
    
-   **Zigzagger** — medium speed, zigzags toward the player. Medium points.
    
-   All enemies spawn off-screen on a random edge and home toward the player.
    
-   Spawn rate and speed increase on a difficulty ramp every 15 seconds.
    

### Scoring

-   Drone: 10 pts
    
-   Zigzagger: 25 pts
    
-   Tanker: 50 pts
    
-   Bonus multiplier: consecutive kills without taking damage (≤ 1 second between kills) grow a combo counter.
    

### Progression / Difficulty

-   Waves are time-based. Every 15 s a new tier unlocks, spawning more enemies at higher speed.
    
-   No upper cap — the game runs until the player dies.
    

### Power-ups (occasional drops)

-   **Rapid Fire** — faster fire rate for 5 s.
    
-   **Shield Pulse** — brief invincibility flash (3 s).
    
-   **Bomb** — clears all enemies on screen.
    

* * *

## Controls

ActionInputMoveWASD or Arrow keysAimMouse cursorFireLeft mouse button (hold for auto-fire)

* * *

## Art & Audio Direction

-   **Style**: Colorful cartoon — bold outlines, bright saturated colors, chunky shapes.
    
-   **Player ship**: sleek triangular silhouette, glowing engine trail.
    
-   **Enemies**: each type has a distinct color + shape (circle drone, rectangular tanker, diamond zigzagger).
    
-   **Background**: deep space with a subtle starfield and a soft color gradient.
    
-   **Audio**: punchy SFX for shooting, explosion pops for kills, game-over sting. Upbeat looping BGM.
    

* * *

## Persistence

-   High score saved between sessions.
    
-   Settings (volume) optionally saved.
