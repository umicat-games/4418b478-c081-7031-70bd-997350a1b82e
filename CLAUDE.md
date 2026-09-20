# Chess with me

A game of chess against a real engine, with an AI companion sitting beside the
board. This file is the memory of what has been built and why.

> **Update this file in the same commit as the change.** The Go game's copy
> described the 3D character template it was forked from long after none of
> that was true, which is exactly how a long session gets misled.

Game id `2a991d0a-30ae-47a8-b04c-a726e5eb2fbe`, fork org `umicat-games` (the
repo holds one branch per game). `./deploy-preview.sh` publishes `dist/`
straight to S3 + CloudFront. **Always commit AND deploy** — a direct deploy is
a temporary override that any workspace rebuild wipes out.

This game is a deliberate sibling of **GO with me**
(`f60d9eec-40ae-42fd-be1d-2c1f2cf428db`, `work/umicat/go`). The chat panel, the
speech bubble, the title screen, the settings panel, the save shape, the
camera rig and the coach's architecture are that game's, ported. When
something here looks odd, the Go repo probably explains why it is like that.

## The two brains, and why they are separate

**The ENGINE** (`src/chess/opponent.ts`) decides moves and reads positions. It
is Stockfish 10, vendored and running in a Web Worker in this browser — no
backend, no per-move cost, works signed out. Everything factual comes from
here: who is better, by how much, whether there is a mate, what the move
would have been.

**The ASSISTANT** (`src/coach/coach.ts`) talks. It is the platform's runtime
AI (ADR-017), handed the engine's numbers to talk *about*. It can point at the
board — mark squares, show what attacks what, offer a move — and it can change
the level and start a game. It never decides a move and it never moves a
piece. A game can be played without it at all (the switch in the new-game
panel), and then nothing here calls the platform AI and none of the buttons
that would are on screen.

This split is the whole trust model, and **chess makes it more dangerous than
Go does, not less**. A language model has read an enormous amount of chess
writing. It will describe a position it has misread in exactly the right
vocabulary — "the knight is pinned", "that square is weak" — and sound like a
coach while doing it. Go at least made the model *sound* lost. Here it does
not, so every factual claim has to come from the engine or from the board, and
the playbook says so at length.

## Where things are

| file | what |
| --- | --- |
| `src/main.ts` | the loop that joins everything. Start here. |
| `src/chess/rules.ts` | the board — a thin shell over `chess.js`, and why |
| `src/chess/opponent.ts` | the engine wrapper, **and the one place strength is decided** |
| `src/chess/coords.ts` | `e4` ⇄ `{x,y}`, and which way `y` runs |
| `src/chess/openings.ts` | opening names, as a table and not as a guess |
| `src/coach/coach.ts` | the companion: actions, observation, memory |
| `public/playbooks/coach.md` | **its persona and rules, as editable prose** |
| `src/view/pieces.ts` | **the pieces, as lathe profiles** — no models anywhere |
| `src/view/board3d.ts` | the board drawn, the camera, hit-testing |
| `src/view/controls.ts` | pointer handling: choose a square vs move the camera |
| `src/ui/speech.ts` | what it says, on the board, with the reply field |
| `src/ui/askhere.ts` | asking about a square, at the square |
| `src/ui/squareactions.ts` | confirm / cancel / ask, beside the piece |
| `src/ui/dictation.ts` | voice + level meter, shared by every field |
| `src/ui/chat.ts` | the log, opened from the corner |
| `src/ui/menu.ts` | the one panel: new game AND settings |
| `src/ui/evalbar.ts`, `promotion.ts`, `title.ts`, `curtain.ts` | the rest |
| `src/ui/buttons.css` | **how a button looks** — `lift` and `chip` |
| `src/audio.ts` | which clips, how loud |
| `src/save.ts` | what survives leaving, and the quotas that shape it |
| `public/stockfish/` | **vendored Stockfish** — frozen, see `vendor/VENDOR.md` |

## Things that will bite

**The engine is Stockfish 10 on purpose, and it is 360KB.** Stockfish 10 is
the last release with a classical evaluation, so there is no weights file at
all — every newer build needs a 38MB NNUE net. It is also single-threaded
(`Threads` is `min 1 max 1`), which matches the fact that threaded wasm needs
`SharedArrayBuffer`, which needs cross-origin isolation, which a game iframe
served from the CDN does not have. Measured here: depth 14 in 500ms, 1.38M
nodes/s. Do not "upgrade" it without reading `vendor/VENDOR.md`.

**Stockfish is GPL-3.** It is vendored unmodified, in its own directory, with
its licence beside it, and spoken to over UCI across a Worker boundary. Do not
edit those files and do not merge them into the bundle.

**Strength is movetime plus slack over the engine's OWN candidates.** Never
inject random moves: a random chess move is not "a weaker player", it is
hanging a queen on move four, and a beginner shown one learns something false.
Stockfish's built-in `Skill Level` is deliberately unused — it is opaque, and
owning the choice is what lets each level be described in a sentence a player
can check.

**Every score is flipped to the STUDENT's point of view exactly once**, inside
`opponent.read`. UCI scores are from the side to move, so a second flip
anywhere downstream is a coach telling you that you are winning while you are
being mated. Nothing outside that function should touch the sign.

**A blunder is judged against the position the move PRODUCED**, not the one
after the engine has replied — an evaluation that moved because of the reply
is not the player's mistake. `engineTurn()` returns the read it decided from
for exactly this reason; do not go back to reading it off `read`, which
`observePosition` overwrites a moment later.

**The pieces are code, not models.** Five of the six are surfaces of
revolution and the profile is the design; the knight is an extruded spline
silhouette. Two things are faked because three has no CSG: the bishop's slit
is a darker wedge lying in the surface, and the rook's crenellations are
blocks on the rim rather than notches out of it.

**`y = 0` is rank 8.** So `board[y][x]` printed top to bottom is a chess
diagram as a book prints one, and the far side of the board is the far side in
world space. The board texture is painted in the same order — and the file and
rank labels are the only thing that would ever reveal a mirror, which is why
they are worth having.

**The board's labels are repainted when the seat changes.** Playing Black
turns the camera to the other end AND turns the text over with it. Doing one
without the other gives you a board with the "1" upside down.

**Counting is the board's job.** `show_attacks` and `show_moves` exist because
a model asked to read attackers off a text diagram answers confidently and
wrongly. The same rule applies to anything that must be *correct* rather than
*fluent* — which is also why opening names are a lookup table.

**Saves are quota'd**: 100KB per value, 1MB per player, 64 keys. The chat log
is trimmed to its tail and the rest lives in the companion's summary — which
is also what stops each turn getting more expensive, since every turn ships
the history. A game is saved as its starting FEN plus the moves, never as the
final FEN: a FEN alone loses the repetition history.

**A new game is a new conversation; Continue keeps the old one.** The summary
is written first, so nothing is lost.

**The platform decides the language.** `umicat.locale` arrives at handshake.
Chat is the exception and belongs to the companion. Move notation is never
translated.

**Marks and focus are different things.** `setHighlights` is the assistant's
own marking (cyan squares); `setFocus` is the square the current sentence is
about (a gold ring), and the bubble sets it on every page. They shared one
list once, and a sentence with no coordinate in it cleared the marks the
assistant had just drawn — so `highlight` worked and was invisible.

**Never report a mark that did not happen.** `highlight` returns how many
squares it actually marked; zero says so, to the player and to the model.
"I've marked it" over an unchanged board sends the player looking for
something that is not there. The same rule makes `show_attacks` and
`show_moves` state their answer OUT LOUD, as the game, rather than leaving
the player with some marked squares and no number.

**The board draws only when it changes** — and the panels standing on it use
`backdrop-filter`, which samples a canvas that is not redrawing. That is what
`repaintSoon()` in main.ts is for. If a panel leaves a ghost of itself behind,
this is why.

**`ai` and `microphone` must be declared** in the game's Settings on the
platform, or the backend rejects AI calls and the iframe blocks the mic.

**`let` that the render loop reads must be declared before the loop starts.**
The loop runs from the first frame, long before the rest of `start()` exists,
and a `const`/`let` it touches too early is a `ReferenceError` that takes the
whole game down at boot with a blank screen. It happened twice in the Go game.

## Decisions worth not relitigating

- **The eval bar is on by default**, and can be turned off in Settings. The Go
  game shows the player nothing about who is ahead, on the grounds that a
  running score turns every move into a verdict. Chess is different in one
  way: the number is already on every board the player has seen online, so
  hiding it reads as the game not knowing it rather than as tact.
- **Two taps, never a drag.** On a phone the finger covers the square it is
  over, and a mis-drop in chess costs a piece.
- **The conversation happens ON the board.** The assistant's reply is a bubble
  beside the square it is about, with a reply field on its last page; asking
  about a piece opens a composer at that piece. The panel on the right is for
  reading back through what was said, and it opens from the corner. Anything
  that makes the player open the panel to continue a conversation is a
  regression. (Ported from GO with me, which learned it the hard way.)
- **Odds instead of a Go handicap.** Taking the engine's queen off is an old
  and honest way to make a game fair, and it maps onto the same slot in the
  settings panel.
- **Promotion is asked, not assumed.** Auto-queening is right almost every
  time, and the exception — queen is stalemate, rook is mate — is the one a
  beginner needs to meet.
- **The assistant is per GAME, not a remembered preference.** Every new game
  offers it; only the player turning it off turns it off. "I did not want to
  be talked to during that game" is not "never talk to me".
- **Speech goes into the field, never straight out.** Recognition mishears,
  and these sentences are full of coordinates. The field is either words or
  the level meter, never both.

## Building and checking

```bash
npm run dev     # local dev server; the engine works offline, the coach does not
npm run build   # what the platform runs
```

Playwright probes live in the session scratchpad rather than here; they drive
the game through `window.__game`, which exposes the board, the engine, the
companion, the menu and `move('e2','e4')`. Driving it through pixels means
testing whether you can click a square on a tilted board, which is a test of
the test.
