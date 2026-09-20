# Teaching Go — what was built, why it was taken out, and what to keep

**Status: parked, 2026-09-20.** The course was built and played, and it was not
good enough to keep in front of a player. The material survives in `src/teach/`
(five lessons, their goals, and the checkers that prove every exercise
solvable, run by `npm run verify`); the flow does not. This is the record of
what it was, what it got right, and what has to be answered before it comes
back.

## What was there

Five lessons, each one a level, in this order:

1. **Liberties and capture** — a stone lives by the empty points beside it
2. **Atari, and getting out** — attack and escape are one idea from two sides
3. **Connect and cut** — the single point that decides one group or two
4. **Two eyes** — the idea that makes Go a game rather than a race
5. **Territory and counting** — play a whole game and understand the result

Each ran **teach → practice → test → passed**:

- **teach** — the game showed a card (what this lesson is, what you will be
  able to do at the end), then the companion explained it in its own words on
  the board and called `begin_exercise` when it judged the explanation had
  landed.
- **practice** — an authored position with help available; failing reset the
  position and the companion nudged.
- **test** — a *different* position, hints disabled, the companion told to stay
  silent. Passing moved the student on; two failures went back to practice.
- **passed** — one line worth remembering, then the next lesson unlocked.

A course screen listed all five with locks, ticks and "in progress"; passed
lessons could be replayed.

## What was right, and should survive any redesign

**Goals are code, not prompts.** "Did they capture it", "do these two stones
share a group", "does this group have two separate eyes" are questions the
board can answer. A model asked to mark the exercise will tell a beginner they
passed for saying the right thing.

**Positions are authored, and verified.** `npm run verify` builds every
exercise, tries every legal move, and asserts a solving move exists — and, for
a test, that not every move passes. It caught a real bug immediately: the `cut`
goal was satisfied before the student moved, because two white stones with a
gap between them are already in different groups. That would have shipped as
"the AI marks anything correct".

**A lesson is a session.** Opening one starts a new conversation, summarising
the old one into the companion's note first. Without it, lesson 2 began in the
middle of lesson 1's thread and paid to ship it on every turn.

**The test is what makes it a level.** No hints, no coach, and passing is what
moves you on. Without that, a lesson is a chat that trails off — which is
exactly what it was before the phases existed.

**The game owns the structure; the model owns the words.** Which lesson, which
phase, whether the exercise was solved, where the stones go: all the game's.
When the model was given any of it, it drifted.

## Why it came out

The flow was wrong in ways that are not bug-shaped:

- **Too much furniture.** A card, a banner, a goal line, a status line, a tip
  and six buttons, all on screen at once, around a 9x9 board with four stones
  on it.
- **Two openings in a row.** The card said what the lesson was; the companion
  then said it again in its own words, because it had been told to explain.
- **The exercises are one move long and the lesson is four screens long.** The
  ratio of reading to playing was wrong for a game whose whole pleasure is
  putting stones down.
- **Nothing connected the lessons to the game.** Passing all five left the
  player where they started: a blank 9x9 against an engine, with none of it
  referenced again.

None of those are fixed by editing the lesson text.

## What has to be answered before it comes back

1. **Does the teaching live inside a game, rather than beside one?** The
   strongest version of this product might be: play a real game from move one,
   and the companion teaches what the position in front of you is about. The
   course then becomes a *syllabus it works through* rather than a place you go.
2. **What is the smallest a lesson can be?** One position, one idea, one move,
   thirty seconds. If a lesson needs a card, it is too big.
3. **What does passing change?** A lesson the player never sees the consequence
   of is a lesson they will not remember. Unlocking the next one is not a
   consequence.
4. **Who decides they have understood?** The checkers answer "did they do it".
   Nothing yet answers "do they know why", and the model should not be trusted
   with it alone.
5. **How does a lesson end on a phone?** Everything above was designed at 1280
   wide with a mouse.

## What the game has become since

The redesign starts from a different game than the one the course was built
into, and the parts it should use are already there:

- **The conversation happens on the board.** The assistant answers beside the
  point it is talking about, with a reply field under it; the player asks about
  a stone by tapping it. A lesson does not need a panel any more.
- **The assistant can point and count.** `highlight` rings points and
  `show_liberties` counts them, with the game — not the model — supplying the
  number. Most of what the first three lessons explained by hand is now one
  action away.
- **A game can have no assistant at all.** Whatever the course becomes, it has
  to say what happens when the player has turned it off.

## Where the pieces are

| file | what |
| --- | --- |
| `src/teach/curriculum.ts` | the five lessons, their briefs, positions and goals |
| `src/teach/course.ts` | the phase machine (teach → practice → quiz → done) |
| `src/teach/verify.ts` | the solvability checker behind `npm run verify` |
| `tools/verify-curriculum.mjs` | bundles it for node and runs it |

Deleted, and in the history if wanted: `src/ui/coursemenu.*` (the lesson list
with locks), `src/ui/lessoncard.*` (the intro card), and the course wiring in
`src/main.ts` — see the commit "Free play with an AI companion; the course is
parked".
