# Xiangqi with me

A game of Chinese chess against a real engine, with an AI assistant sitting
beside the board. This file is the memory of what has been built and why.

> **Update this file in the same commit as the change.** The Go game's copy
> described the 3D character template it was forked from long after none of
> that was true, which is exactly how a long session gets misled.

Game id `cb51a5b1-7c95-40e0-9e21-63c9d44ef8e7`, fork org `umicat-games` (the
repo holds one branch per game). `./deploy-preview.sh` publishes `dist/`
straight to S3 + CloudFront. **Always commit AND deploy** — a direct deploy is
a temporary override that any workspace rebuild wipes out.

This game is the third of a family: **GO with me**
(`f60d9eec-…`, `work/umicat/go`) and **Chess with me**
(`2a991d0a-…`, `work/umicat/chess`). The chat panel, the speech bubble, the
title screen, the settings panel, the save shape, the camera rig and the
assistant's architecture are theirs, ported. When something here looks odd,
one of those two repos probably explains why it is like that.

## The two brains, and why they are separate

**The ENGINE** (`src/xiangqi/engine.ts`) decides moves and reads positions. It
is an alpha-beta search written here, running in a Web Worker in this browser
— no backend, no per-move cost, works signed out. Everything factual comes
from here: who is better, by how much, whether there is a mate, what the move
would have been.

**The ASSISTANT** (`src/coach/coach.ts`) talks. It is the platform's runtime
AI (ADR-017), handed the engine's numbers to talk *about*. It can point at the
board — ring squares, show where a piece may go, show what is hanging — and it
can change the level and start a game. It never decides a move and it never
moves a piece. A game can be played without it at all (the switch in the
new-game panel), and then nothing here calls the platform AI and none of the
buttons that would are on screen.

The split is the whole trust model, and xiangqi sits between its two siblings
in how dangerous it is. A model loses track of a xiangqi position the way it
loses track of a Go one — but unlike Go it will *sound* certain, because it
has read a lot of chess-shaped writing. So every factual claim comes from the
engine or from the board, and the playbook says so at length.

## Why the engine is ours, and not Pikafish

**Every strong open-source xiangqi engine is copyleft.** Pikafish is GPL-3,
ElephantEye and XQWLight are GPL-2. Vendoring one would put this game under
GPL. Go was lucky — KataGo is MIT and its network CC0 — and chess accepted the
trade deliberately (Stockfish, vendored unmodified behind a worker). Here the
trade was not worth it, because xiangqi does not need a strong engine to be a
good game to learn on, and a hand-written one is a few hundred lines.

What that buys: no download at all, a move in well under a second, and levels
that can be described in a sentence. What it costs: it will not beat anyone
who studies the game. That was the explicit ask — *"只要能下棋就行"*.

## The rules are tested, not believed

`npm run verify` is the load-bearing test in this repo.

**`tools/perft.mjs`** walks the whole move tree from the opening position and
compares the leaf counts against the published ones: **44 / 1920 / 79666 /
3290240 / 133312995**. Every one of them matches. A single rule implemented
wrongly — a horse ignoring its blocked leg, an elephant crossing the river, a
cannon taking without a screen, a king allowed onto the file facing the other
king — changes those numbers, and nothing plausible-looking hides it.

**`tools/rules-test.mjs`** covers what perft cannot reach in five plies: a
soldier that has crossed moving sideways and never back, the two kings, mate,
困毙 (no legal move is a LOSS, not the draw western chess would call it), and
repetition. Watch out when writing a test position: **two kings on the same
open file is an illegal board**, and every move from it looks broken. That
mistake failed nine true rules at once in the first draft of that file.

Repetition is the one place the rules simplify, and it is documented where it
happens (`XiangqiGame.outcome`): perpetual check loses for the checker, and
everything else that repeats three times is a draw. Full Chinese rules judge a
repetition by *why* it repeats (长将、长捉、长拦) and that is case law rather
than a rule.

## Where things are

| file | what |
| --- | --- |
| `src/main.ts` | the loop that joins everything. Start here. |
| `src/xiangqi/rules.ts` | **the referee** — moves, legality, check, endings |
| `src/xiangqi/engine.ts` | the search and the evaluation |
| `src/xiangqi/worker.ts` | the search, off the main thread |
| `src/xiangqi/opponent.ts` | the engine wrapper, **and the one place strength is decided** |
| `src/xiangqi/coords.ts` | `e4` ⇄ `{x,y}`, and which way the ranks run |
| `src/xiangqi/openings.ts` | opening names, as a table and not as a guess |
| `src/coach/coach.ts` | the assistant: actions, observation, memory |
| `public/playbooks/coach.md` | **its persona and rules, as editable prose** |
| `src/view/board3d.ts` | the board drawn, the pieces, the camera, hit-testing |
| `src/view/controls.ts` | pointer handling: choose a square vs move the camera |
| `src/ui/speech.ts` | what it says, on the board, with the reply field |
| `src/ui/askhere.ts` | asking about a square, at the square |
| `src/ui/pointactions.ts` | confirm / cancel / ask, beside the piece |
| `src/ui/evalbar.ts` | the engine's opinion, where the player can see it |
| `src/ui/chat.ts` | the log, opened from the corner |
| `src/ui/menu.ts` | the one panel: new game AND settings |
| `src/ui/buttons.css` | **how a button looks** — `lift` and `chip` |
| `src/save.ts` | what survives leaving, and the quotas that shape it |
| `tools/` | perft, the rule tests, and a search benchmark |

## Things that will bite

**Squares are ICCS, not the notation players speak.** Files `a`–`i` from Red's
left, ranks `0`–`9` up from Red's back line; Red's general starts on e0. The
traditional 炮二平五 names a file by counting from the moving side's own right,
so the same square has two names depending on whose turn it is — impossible to
anchor a speech bubble to. The assistant is told to SAY 炮二平五 and to POINT
with `[e2]`. The board's margins carry the letters and digits so the player can
follow it.

**`y = 0` is Black's back line.** So `diagram()` printed top to bottom is the
board as a book prints it, and the far side of the board is the far side in
world space. `coords.ts` owns the flip between `y` and the rank spoken aloud,
and it is the one conversion everybody writes twice.

**Strength is depth plus temperature over the engine's OWN candidates.** Never
inject random moves: a random xiangqi move is not "a weaker player", it is a
horse walking into a corner, and a beginner shown one learns something false.
The `window` on each level is what stops a warm temperature giving a chariot
away for nothing.

**Every score is flipped to RED's point of view exactly once**, inside
`opponent.read`/`decide`. The search returns scores for the side to move, so a
second flip anywhere downstream is an assistant telling the player they are
winning while they are being mated.

**A blunder is judged against the position the move PRODUCED**, not the one
after the engine has replied — an evaluation that moved because of Black's
reply is not the player's mistake. `engineTurn()` hands back the read it
decided from for exactly this reason; do not go back to reading `read`, which
`observePosition` overwrites a moment later. (The Go game measured the wrong
position; Chess with me found it.)

**A button standing on a square is a square the player cannot tap** — and on
this board the squares around the piece in hand are exactly where it is
allowed to GO, so a fixed cluster eventually makes a legal move unplayable.
`PointActions.place()` is handed the points that must stay reachable (the
destinations, and the piece itself) and turns the whole cluster around the
square in fifteen-degree steps until it is off them; the default arrangement
wins ties, so the tick stays on the left unless staying there would cost the
player a move. Measured over every Red piece at both stages of a move, in the
opening and ten plies in: nothing within 37px of a dot, against 29px at which
a button would actually be on top of one.

That is also why **picking a piece up offers no cancel button**: tapping the
same piece again puts it down, and one fewer button is one fewer square
standing under one. With the assistant off, picking a piece up puts nothing on
the screen at all.

**Three taps for a move, not two and never a drag.** Pick the piece up, choose
the square, confirm on the tick. On a phone a piece is about four millimetres
wide and a xiangqi move cannot be taken back; the ghost in between is also what
shows a beginner what the move does.

**The pieces are discs with a character painted on a plane above them**, not a
texture on the cylinder's cap: a cap's UVs are a circle mapped from the side,
and the glyph comes out rotated by whatever the geometry felt like.

**The board texture is not square.** The grid is 9 by 10 and the slab follows;
a square canvas on a rectangular face stretches the grid in one direction,
which on a board of intersections is instantly visible.

**Counting is the board's job.** `show_moves` and `show_danger` exist because a
model asked to list a horse's moves off a text diagram answers confidently and
wrongly — it will forget the blocked leg. The same rule makes opening names a
lookup table.

**Marks and focus are different things.** `setHighlights` is the assistant's
own marking (cyan rings); `setFocus` is the square the current sentence is
about (a gold ring), and the bubble sets it on every page. They shared one list
in the Go game, and a sentence with no coordinate in it cleared the rings the
assistant had just drawn — so `highlight` worked and was invisible.

**Never report a mark that did not happen.** `highlight` returns how many
squares it actually marked; zero says so, to the player and to the model. The
same rule makes `show_moves` and `show_danger` state their answer OUT LOUD, as
the game, rather than leaving the player with some rings and no sentence.

**The board draws only when it changes** — and the panels standing on it use
`backdrop-filter`, which samples a canvas that is not redrawing. That is what
`repaintSoon()` in main.ts is for. If a panel leaves a ghost of itself behind,
this is why.

**`let` that the render loop reads must be declared before the loop starts.**
The loop runs from the first frame, long before the rest of `start()` exists,
and a `const`/`let` it touches too early is a `ReferenceError` that takes the
whole game down at boot with a blank screen. It happened twice in the Go game.

**Saves are quota'd**: 100KB per value, 1MB per player, 64 keys. A game is
saved as its handicap plus its moves and replayed through the referee on the
way back in, so a save can never hold a position the rules cannot reach.

**A new game is a new conversation; Continue keeps the old one.** The summary
is written first, so nothing is lost.

**The platform decides the language.** `umicat.locale` arrives at handshake.
Chat is the exception and belongs to the assistant. Square names are never
translated.

**`ai` and `microphone` must be declared** in the game's Settings on the
platform, or the backend rejects AI calls and the iframe blocks the mic.

## Decisions worth not relitigating

- **The eval bar is on by default**, and can be turned off in Settings — the
  same call Chess with me made, for the same reason: the number is what the
  assistant is talking *from*, and hiding it reads as the game not knowing it.
- **Odds instead of a Go handicap.** Xiangqi has no extra-stones equivalent —
  Red already moves first — so a head start is material: Black gives up a
  horse, both horses, or a chariot.
- **The assistant is per GAME, not a remembered preference.** Every new game
  offers it; only the player turning it off turns it off.
- **Speech goes into the field, never straight out.** Recognition mishears,
  and these sentences are full of coordinates.
- **The conversation happens ON the board.** The reply is a bubble beside the
  square it is about, with a reply field on its last page; asking about a piece
  opens a composer at that piece. The panel on the right is for reading back.

## Building and checking

```bash
npm run dev        # local dev server; the engine works offline, the assistant does not
npm run build      # what the platform runs
npm run verify     # perft + the rule tests. Run this before every commit that
                   # touches src/xiangqi/rules.ts.
npm run typecheck  # tsc --noEmit
node tools/perft.mjs 5     # the 133-million-node one, ~20s
node tools/bench.mjs       # depth vs time, and a game against itself
```

Playwright probes live in the session scratchpad rather than here; they drive
the game through `window.__game`, which exposes the board, the engine, the
assistant, the menu and `play('h2e2')`. Driving it through pixels means testing
whether you can click a four-millimetre piece, which is a test of the test.
Note that `window.__game` only exists once a game has started — the title
screen is awaited before it is assigned, exactly as in the Go game.
