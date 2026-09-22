# Othello with me

Reversi/Othello against an engine, with an AI assistant sitting beside the
board. Forked from **Gomoku with me** (`work/umicat/gomoku`), which is the
board-game template: everything in `src/shell/` came from there and should go
back there if it is fixed here.

> **Update this file in the same commit as the change.** It arrived describing
> a 3D platformer, which is exactly how a long session gets misled.

Game id `7a3fbb1c-7bbe-4f97-9db6-0eeef4a2d8b6`, fork org `umicat-games` (the
repo holds one branch per game). `./deploy-preview.sh` publishes `dist/`
straight to S3 + CloudFront. **Always commit AND deploy** — a direct deploy is
a temporary override that any workspace rebuild wipes out.

Its siblings: **GO with me** (`work/umicat/go`), **Chess with me**
(`work/umicat/chess`), **Xiangqi with me** (`work/umicat/xiangqi`), **Gomoku
with me** (`work/umicat/gomoku`).

## Where things are

```
src/shell/     the half that is the same in every game.      DO NOT EDIT.
src/game/      the rules, the engine, the board.             THIS GAME.
src/main.ts    the loop that joins them.                     NOT generic.
src/i18n.ts    what the buttons say.
public/playbooks/coach.md   the assistant's persona.
tools/         perft, the rule tests, the search benchmark.
```

The seam to the shell is four things: a grid (`BoardRig({cols, rows})`), a
`Notation` (`a1`…`h8`), an `AssistantSpec`, and a `{share, label}` for the eval
bar. `src/main.ts` is deliberately NOT generic — see gomoku's CLAUDE.md.

## The two brains, and why they are separate

**The ENGINE** (`src/game/engine.ts`) decides moves and reads positions:
alpha-beta over the same referee the player moves through, in a Web Worker in
this browser. No backend, no per-move cost, works signed out.

**The ASSISTANT** (`src/shell/coach.ts` + `src/game/assistant.ts`) talks. It is
the platform's runtime AI (ADR-017), handed the numbers to talk *about*. It
never decides a move and never puts a disc down.

## The referee is tested, not believed

`npm run verify` = perft to depth 6 plus hand-written rule tests.

**Perft is the whole rules argument.** Othello has published node counts from
the opening position and they match to depth 8:

```
1: 4   2: 12   3: 56   4: 244   5: 1396   6: 8200   7: 55092   8: 390216
```

That is not a smoke test. Getting 390216 right means flipping, direction
masks, the pass rule and the end condition are all right, because every one of
them changes the count.

**Legality and flipping are the same question.** `flips()` returns the discs a
move turns over, and a move is legal exactly when that list is non-empty.
Writing them as two functions is writing the rule twice and being wrong once.

**A pass is not a move the player makes.** It is automatic: `make()` hands the
turn back if the opponent has nothing to play, and `outcome()` ends the game
when neither side has. The UI never offers a pass button — it says what
happened (`hud.youPassed` / `hud.theyPassed`) and carries on.

**The game can end with empty squares on the board.** 64 discs is the common
case, not the rule. `outcome()` is "neither side has a move", and the winner is
whoever has more discs, wherever it stops.

## Things that will bite

**Make/unmake, never replay.** `undo()` originally rebuilt the position from
move one; perft(7) took four seconds. Keeping a history of what each move
flipped and putting it back made it 642ms. Any search that gets slow in this
family is usually doing the same thing somewhere.

**Do not negate when the opponent passed.** Negamax flips the sign because the
side to move alternates — and here it sometimes does not:

```ts
const v = g.toPlay === was ? negamax(...) : -negamax(-beta, -alpha, ...);
```

Without that test the engine evaluates its own good fortune as a disaster, and
it only shows up in positions where a pass happens, which is late and rare
enough to look like a strength problem rather than a bug.

**The endgame is EXACT, and that changes what the numbers mean.** Below
`exactFrom` empties (8/11/13 by level) the search runs to the end of the game
and the score is a disc difference, not a heuristic. `Read.exact` says which
kind of number this is; the assistant must not describe a heuristic score as
"you win by 6".

**Counting discs is not a strategy, and the evaluation says so.** Mobility,
frontier discs and corners dominate until the last dozen moves; disc count is
weighted near zero in the opening and takes over at the end. A beginner's
instinct ("take the most") is `gentle`'s `greedy: true` — it exists so the
easiest level plays the way a new player expects, not because it is good.

**Corners are the teaching, and X-squares are the trap.** `X_SQUARES` maps the
four diagonal neighbours to the corner they hand over (`{9:0, 14:7, 49:56,
54:63}`); the assistant mentions it when the player is about to play one. The
engine's own `NEAR_CORNER` correction stops it valuing those squares as if the
corner were still contested when it is already taken.

**A disc's colour is its ROTATION.** All 64 are one `InstancedMesh` of a
two-sided cylinder — black face up at 0, white face up at π. Flipping is then
an animation the board already knows how to do, and there is nothing to create
or destroy mid-game. Turning it over IS the game, so it had better not be a
material swap.

**Legal moves are always shown.** Small dots on every playable square, not a
hint the player has to ask for. Othello without them is a game of finding your
own moves, which is a different and worse game for anybody learning.

**The felt is dark, so this board wants more light than its siblings.** Key
2.6, hemisphere 0.95 — measured against the green (35,89,57), not guessed. The
discs carry `emissive: 0x2b2a26` so white reads as white (208) against black
(18) from directly overhead, where there is no rim light to separate them.

**`margin: 0.9`** on the grid, because the coordinate labels live in the margin
and an 8×8 board is small enough that the default crops them.

**A WebGL canvas must be RE-RENDERED in the same frame you read pixels from
it.** The board draws only when it changes (`dirty`/`invalidate`) and there is
no `preserveDrawingBuffer`, so a probe that samples the canvas gets black —
which cost an afternoon chasing a "the board goes black after a few moves" bug
that did not exist. Force a render immediately before the read or the
screenshot. Everything else in this family's probe lore applies too: a
screenshot is not a measurement unless you know what frame it is of.

**The camera is FIXED and looks STRAIGHT DOWN**, the board is a slab on a dark
walnut TABLE with a real shadow, and the **boot screen is in `index.html`**,
not in the bundle. All three are the family's decisions and gomoku's CLAUDE.md
explains each at length; the only Othello-specific note is that `camera.up`
must be set to −z by hand or `lookAt` cannot resolve straight down.

**The end of a game is a DIALOG**, not a line in the corner: what happened, the
one line the game can prove (here, the disc count), and the two things anybody
wants next. The assistant's closing line lands inside it.

**Scores are flipped to the player's point of view exactly once**, in
`opponent.toRead`. A second flip anywhere is an assistant cheerfully telling
the player they are winning while they are being beaten.

**Saves are quota'd** (100KB/value, 1MB/player, 64 keys) and hold the MOVES,
replayed through the referee — so a save can never contain a position the rules
cannot reach.

**A new game is a new conversation; Continue keeps the old one.** And
`startGame` REFUSES while a game is in progress: an AI that can restart a live
board will eventually do it, and no amount of playbook prose is a substitute
for the game saying no.

**The platform decides the language** (`umicat.locale` at handshake). Chat is
the exception and belongs to the assistant.

**Two rules decide what language the assistant speaks, and the second one is
the one that goes wrong.** A REPLY follows the student's own sentence. Anything
the assistant starts — the greeting, a remark after a blunder, the closing line
— follows `umicat.locale`, which is the platform's language setting
(`localStorage.language` in home-ui, else the browser's). So a player whose
Umicat is in English and who types Chinese gets both, correctly, and it reads
like the assistant cannot make up its mind.

**And every unprompted remark is an English sentence delivered as if the
STUDENT had typed it** — `remark()` goes out through the same `say()` the chat
box uses, and the protocol's history has no third kind of turn. Measured
against the live model: one remark in three came back in English mid-Chinese
conversation. Remarks are therefore tagged `[the game] `, and both the
observation's language rule and the playbook say what the tag means. Three in
three afterwards. **If you add a new kind of unprompted line, it goes through
`remark()` — never straight into `say()`.**

**`ai` and `microphone` must be declared** in the game's Settings on the
platform, or the backend rejects AI calls and the iframe blocks the mic. Both
are declared for this game (2026-09-22). If the assistant ever goes silent
here, check that first: a missing declaration is a **403** from the backend,
which is not the same thing as a 401 and does not mean anybody is signed out.

## Building and checking

```bash
npm run dev        # local dev server
npm run build      # what the platform runs
npm run verify     # perft 1-6 + the rule tests — before every commit touching rules.ts
npm run typecheck  # tsc --noEmit
npm run bench      # depth vs time, and a game against itself
node tools/perft.mjs 8   # the full published table, ~10s
```

Playwright probes live in the session scratchpad; they drive the game through
`window.__game`, which exists only once a game has started — the title screen
is awaited before it is assigned.
