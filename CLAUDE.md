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
Chat is the exception and belongs to the companion. Move notation is never
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
- **The action buttons move out of the way of the board.** A button standing
  on a square is a square that cannot be tapped, and pressing it only put the
  piece down — pick it up again and the button is back in the same place, so
  the move could not be played at all. Measured before: with the king castled
  on g1, the cross sat 33px from h1 on a 77px square; the queen on d1 could
  not be sent to e1. `SquareActions.place()` is now handed the squares that
  must stay tappable and turns the cluster until it is off them, and picking a
  piece up offers only "ask" — tapping the piece again is what puts it down.
  Measured after, over every white piece at both stages, in two positions: 0
  covered, tightest gap 47px. (Found in Xiangqi with me, which has a whole
  board of pieces that move sideways one square.)
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

**The camera is FIXED, and it KEEPS its tilt.** No orbit, no pinch, nothing to
recentre — a camera the player can move is a camera they can lose. But unlike
the games with flat pieces, this one stays at 44°: a chess piece is a
silhouette, a knight is a knight because of its profile, and from straight
overhead they are all circles. Turning the board around when the player takes
Black is a different thing and stays — that is a rule of the game, not a
camera control.

**The board sits on a TABLE, and that is what the lighting is for.** The board
is a slab with real thickness standing on it, casting a real shadow. The key
is LOW (about 30° above the table, not 45°, or the shadow falls straight down
and there is nothing to see — and from overhead that shadow is the only thing
left saying the board has thickness). The framing pulls back to 0.84 of the
screen so some table is always in frame.

**The table is NOT wood, and that came from measuring it** (2026-09-23). It
was dark walnut, then pale wood, and the pale wood was sampled off the canvas:
the board and the table came out at the SAME luminance — 1.00:1 on the Go
board, 1.01:1 on the Xiangqi one, and here 2.4:1 only because a chess board
has a dark frame round it. What separated board from table was hue and nothing
else, which is what "the whole screen is one brown photograph" actually is.

So it became a matte pale stone: `#e9e5dc`, `roughness: 0.95`, and **no
grain** — a texture on the table competes with the grid, which is the only
texture anybody is meant to be reading. The measured result is the table at
L=0.49 against L=0.34 before, the light squares at 3.9:1 against it, and the
board as a whole an object put down on a surface. Two things go with it:

- **The board went one step DARKER** (`LIGHT_SQ`, `DARK_SQ`, `FRAME`, and the
  edge grain). On a pale table a light board is a lighter patch of the same
  thing. The light square is also what a white piece stands on, and that was
  the weakest pair on the screen after the table itself.
- **The scene background followed the table.** It was near-black, to be the
  table's own darkest tone; on a pale table that is a hole cut in it.
- **The fill went UP, not down** (hemisphere 0.72 → 0.84, and its ground
  colour from near-black to a pale bounce), and the key came down a little.
  Fill is still the enemy of the shadow, but a room whose floor is pale stone
  bounces, and this is not the dark-brown room any more.

**Softening a shadow with a blurred shadow map softens the wrong thing.** VSM
with `shadow.radius = 6` was tried, to take the shadow down a step now that a
pale table shows it harder: the board's contact shadow washed out to 1.02:1
against the table — gone — while every PIECE's shadow spread into a smear two
squares wide. A shadow is taken down with LIGHT (a weaker key, a stronger
bounce), which lifts the inside of it without touching the edge, and the edge
is the part doing the work.

**The board's own shadow is thin, and that is geometry, not a setting.** The
slab is 0.1 deep and the key is 4.6 up and 2.4 across, so the shadow beside
the board is about 0.05 world units — a quarter of a square. A probe that
samples "just outside the board" at one square out is sampling bare table and
will report, wrongly, that there is no shadow at all. Walk a profile outwards
instead of picking a distance.

**The boot screen is in `index.html`, not in the bundle.** Its job is to be on
screen before the bundle has parsed, so it cannot be built by it. Black and a
bar — no words, because the player's language arrives at the platform
handshake, which is one of the things it is waiting for. `window.__boot` is
what `boot.ts` drives it with; it removes itself after nine seconds whatever
happens. Watch the removal: holding the element in a local before nulling the
reference is not style, it is the difference between the screen going away and
it sitting there invisible for ever with one line in the console.

**A move is a piece being CARRIED, and the board has to be told what the move
was.** `animateMove(played)` is handed the move the referee just returned,
because by then the position is already the one after it. Three things it does
that a naive lift-and-drop does not:

- **The square the piece lands on is held EMPTY while it flies** (`hidden`),
  or the piece is in two places at once — and when the flight ends the
  layout is RE-RUN, not just unflagged. `sync()` is what puts a piece on a
  square; clearing the flag without calling it leaves a hole where the piece
  landed until the next move happens to sync. That is `this.shown`.
- **A captured piece leaves towards whoever TOOK it**, which reads backwards
  in the code: a black pawn goes to White's end of the table. It starts from
  `move.took`, which is the square it was STANDING on — not `move.to`, which
  is a different square when it was taken en passant.
- **Castling is one move with two pieces in it.** `move.rook` carries the
  rook's own two squares; it goes 110ms after the king, because the king is
  the move and the rook is the consequence.

**Never clone a material per flight.** A new material is a new shader program,
compiled the first time it is drawn: profiled, cloning one per move added
about 150ms of main-thread work to the exact frame the piece was supposed to
start moving on. The two fading materials are built once, with the skins.

**Anything that rewrites the board mid-flight must `clearFlights()`** — a new
game and a takeback both do. A flight outliving its move is a piece flying to
a square that no longer wants it, while holding that square empty.

**Sampling an animation needs the page's clock FROZEN.** A screenshot takes
longer than a 260ms arc, so a probe that sets up a flight and then asks for a
picture "at 100ms" gets a picture of the board after it finished — which looks
exactly like the animation not rendering at all, and was read that way for an
hour. Override `performance.now` to a value the probe advances by hand, call
`animate()` and `render()`, and only then take the shot. Note also that the
local preview is `vite preview` of `dist/`: a source edit is not on screen
until `npm run build`.

**A new game gets a new NPC, not `npc.reset()`** — and the difference is a
bug that shipped with the NPC itself (2026-09-10 to 2026-09-23). Reset points the NPC's history at a fresh array;
a `say()` already in flight still pushes its answer into `this.npc.history`
when it lands, which by then is the NEW array. The last game's sentence became
the first thing in the next game's model context — invisible in the panel,
because the generation fence drops a stale answer from the screen, and fully
present to the model, which carried on from it. What the player saw was a
brand new board being told "that g4 push left the pawn hanging", about a move
nobody had played, with the assistant ringing the square.

The fence and the fresh NPC are two different guarantees and both are needed:
the fence is about what is SHOWN, the new NPC is about what is REMEMBERED. It
was fixed in `@umicat/platform-sdk` as well (`say()` binds the array it
started with), but the games do not wait for a version to be safe.

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
npm run dev     # local dev server; the engine works offline, the coach does not
npm run build   # what the platform runs
```

Playwright probes live in the session scratchpad rather than here; they drive
the game through `window.__game`, which exposes the board, the engine, the
companion, the menu and `move('e2','e4')`. Driving it through pixels means
testing whether you can click a square on a tilted board, which is a test of
the test.
