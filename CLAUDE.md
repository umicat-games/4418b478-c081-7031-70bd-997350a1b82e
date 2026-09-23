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

**The title screen is a wordmark on a table, and the art ships in
`public/art/`.** `logo.webp` is this game's own; `table-bg.webp` is the same
photograph in every game in the family. Both are derived from the originals in
the platform's Asset Manager (`cdn.umicat.ai/uploads/<game id>/`), which are
1–3MB each — and **a title screen cannot appear until its title has arrived**,
so shipping the originals means shipping a loading screen. There is no `cwebp`
on the machine this was done on; Chromium encodes WebP perfectly well, alpha
included, so the recipe is: draw the PNG into a canvas at the size it is
actually drawn and `canvas.toDataURL('image/webp', q)`. 1000px wide at 0.9 for
a wordmark (~90KB), 1400px at 0.72 for the table (133KB).

Three rules the screen is built on, all of them learned in the Go game:

- **The fallback must not be what you see first.** The words and the flat
  background are what happens when the art does not load — so they stay hidden
  until both images have either arrived or timed out, and the boot screen
  stays up for exactly that long. Showing them first and painting over them is
  a title screen that visibly assembles itself.
- **Wait for BOTH.** A wordmark landing a second before its background is the
  same flash in two parts.
- **A relative `url()` that reaches CSS through a custom property resolves
  against the STYLESHEET**, which in a build lives in `assets/` — so it 403s
  there and works in dev. `asUrl()` makes it absolute against `document.baseURI`.
  Check a `vite preview` of `dist/`, not just `npm run dev`, whenever a path
  is involved.

The grey veil over the photograph is a RADIAL, spreading from the middle
outwards: the centre stays open enough to read the grain, the edges close down
far enough to hold small text. A flat wash takes the wood with it.

**The platform decides the language.** `umicat.locale` arrives at handshake.
Chat is the exception and belongs to the assistant. Square names are never
translated.

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

**Voice input listens in ONE language, and it is the platform's.** Nothing
auto-detects: the web `SpeechRecognition`, iOS `SFSpeechRecognizer(locale:)`
and Android's `EXTRA_LANGUAGE` each listen for exactly the language they are
handed, and a wrong one comes back as confident nonsense rather than as an
error. `speechLang()` derives it from `umicat.locale` — which is the platform
language setting on the web and the DEVICE's system language in both apps,
where there is no language setting at all.

**Match the tag, never compare it.** iOS sends
`Locale.preferredLanguages.first`, which carries the script — `zh-Hans-CN` —
so `locale === 'zh-CN'` was true on the web and on Android and false on a
Chinese iPhone, which came up with a Chinese UI (the string table falls back
to the base language) and an English microphone. Only a real device could
show it.

**Following the conversation instead was considered and turned down**
(2026-09-22): a microphone that silently changes language under the player
reads as broken, and a separate mic-language setting is one more thing nobody
else's app asks for. The system language is what every other dictation on the
phone follows. Keep it static.

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

**The camera is FIXED and looks STRAIGHT DOWN.** No orbit, no pinch, nothing
to recentre: a board game is not a world to look around — the position is the
same information from every angle — so a camera the player can move is a
camera they can lose. Straight down is also the one angle at which the board
is the shape it actually is; any tilt makes it a trapezoid and closes up the
far rows. `camera.up` has to be set to −z by hand, because from directly
overhead the default up is the direction the camera is looking along and
`lookAt` cannot resolve it.

**The table is NOT wood, and that came from measuring it** (2026-09-23). It
was dark walnut, then pale wood, and the pale wood was sampled off the canvas:
the board and the table came out at the SAME luminance — 1.01:1 here, and the
same story in every game in the family. What separated board from table was
hue and nothing else, which is what "the whole screen is one brown photograph"
actually is.

So it became a matte pale stone — `TABLE_TONE` at `roughness: 0.95`, with **no
grain**, because a texture on the table competes with the grid, which is the
only texture anybody is meant to be reading. Measured after: the board against the table at 1.71:1, and an ivory disc against the board at 1.52:1 (was 1.19:1). Four
things go with it and each one is a separate decision:

- **The board went one step DARKER, in LINEAR light rather than in hex digits (×0.72). Every piece here is an ivory disc, so the board is what they are read against, and at 1.19:1 they were not being read against it at all.**
- **The scene background followed the table.** It was near-black, to sit near
  the table's own darkest tone; on a pale table that is a hole cut in it.
- **The fill's GROUND colour is the table**, so it went from near-black to a
  pale bounce, and the warm bounce light with it. Fill is still the enemy of
  the shadow, but this is not the dark brown room any more.
- **The key came down a little**, because a pale floor does some of its work.

**Warmth cannot be picked by eye.** Pushing a colour warmer at the same
numbers also makes it DARKER — green carries 71% of luminance and warming is
mostly taking green down — so a hand-picked warm hex is a table that is
quietly warmer AND dimmer, and the gap this was all for comes back in. Fix red
and blue where the warmth wants them and binary-search green against a target
luminance. Four warmths were rendered that way and compared; `TABLE_TONE` is
the second of them.

**Softening a shadow with a blurred shadow map softens the wrong thing.** VSM
with `shadow.radius = 6` was tried on the chess board: its contact shadow
washed out to 1.02:1 against the table — gone — while every PIECE's shadow
spread into a smear two squares wide. A shadow comes down with LIGHT, which
lifts the inside of it without touching the edge, and the edge does the work.

**Sampling a board of INTERSECTIONS: measure the middle of a cell.** A patch
centred on a point is centred on two crossing black lines, and reports the
wood as near-black. That cost a wrong baseline before it was spotted.

**The board sits on a TABLE, and that is what the lighting is for.** A plane
drawn rather than photographed (what it is MADE of is the note below); the board is a slab with real
thickness standing on it, casting a real shadow. Two settings do the work and
both fight the instinct to add light: the key is LOW (about 30° above the
table, not 45°, or the shadow falls straight down and there is nothing to see
— and from overhead that shadow is the only thing left saying the board has
thickness) and the fill is weak, because fill is the enemy of that shadow. The
framing pulls back to 0.84 of the screen so some table is always in frame.

**The boot screen is in `index.html`, not in the bundle.** Its job is to be on
screen before the bundle has parsed, so it cannot be built by it. Black and a
bar — no words, because the player's language arrives at the platform
handshake, which is one of the things it is waiting for. `window.__boot` is
what `boot.ts` drives it with; it removes itself after nine seconds whatever
happens. Watch the removal: holding the element in a local before nulling the
reference is not style, it is the difference between the screen going away and
it sitting there invisible for ever with one line in the console.

**A move is a piece being CARRIED.** `animateMove(from, to, mover, taken)` is
called with the move the referee has just accepted, so the position is already
the one after it — everything the view is told is about what the player did
not get to see. Three things hold it up:

- **The square the piece lands on is held EMPTY while it flies** (`hidden`),
  or the piece is on its square and on its way to it at the same time. When
  the flight ends the layout is RE-RUN (`this.shown`), not just unflagged:
  `sync()` is what puts a piece on a square, so clearing the flag alone leaves
  a hole where the piece landed until the next move happens to sync.
- **A taken piece leaves towards whoever TOOK it**, which reads backwards in
  the code: a black horse goes to Red's end of the table.
- **Flights come out of their OWN pool.** A piece in the air is not in the
  position, so it cannot borrow one of the pooled discs `sync()` is handing
  out. The fading pool is separate again, because transparency is part of a
  material's shader and switching it at runtime recompiles one — which, on
  the frame a piece starts moving, is the one frame that must not stall.
  A fading piece also casts NO shadow: the depth pass does not read opacity,
  so a piece that has gone would leave its shadow behind on the wood.

**Sampling an animation needs the page's clock FROZEN.** A screenshot takes
longer than a 260ms arc, so a probe that starts a flight and asks for a
picture "at 100ms" gets the board after it finished — which looks exactly like
the animation not rendering at all. Override `performance.now` with a value
the probe advances by hand, call `animate()` then `render()`, and only then
shoot. And the local preview is `vite preview` of `dist/`: a source edit is
not on screen until `npm run build`.

**The end of a game is a DIALOG, not a line in the corner.** The status line
is where "your move" lives, and a result printed in the same place in the same
type reads as one more turn rather than as the end of something. The card
carries three things and nothing else: what happened, one factual line the
GAME can prove (the count, the mate, the move number), and the two things
anybody wants next. It can be dismissed, because the board underneath has the
result drawn on it and a dialog that will not get out of the way of the thing
it is describing is one people learn to close before reading. The assistant's
closing line lands INSIDE it when it arrives — a speech bubble behind that
card is the assistant talking to a screen the player cannot see.

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
