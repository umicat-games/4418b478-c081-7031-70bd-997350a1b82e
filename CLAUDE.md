# Gomoku with me — and the board-game template

Two things in one repo, on purpose.

It is a **complete, playable game**: five in a row against an engine, with an
AI assistant beside the board, a title screen, saves, voice, sound and two
languages.

It is also the **template** the next board game in this family forks. Which is
why it is a real game and not a scaffold: a template nobody plays is a
template whose speech bubble, voice input and save path quietly rot, and the
first person to find out is whoever forked it. Everything in `src/shell/` is
exercised every time somebody plays a move here.

Game id `504f2dfc-741f-413f-83a7-0cba981258c0`, fork org `umicat-games` (the
repo holds one branch per game). `./deploy-preview.sh` publishes `dist/`
straight to S3 + CloudFront. **Always commit AND deploy** — a direct deploy is
a temporary override that any workspace rebuild wipes out.

Its siblings, in the order they were built: **GO with me**
(`work/umicat/go`), **Chess with me** (`work/umicat/chess`), **Xiangqi with
me** (`work/umicat/xiangqi`). Most of what is in `src/shell/` was learned the
hard way in those three.

**Othello with me** (`work/umicat/othello`) is the first game forked FROM
here, and its `src/shell/` is still byte-for-byte this one — which is the
evidence that the seam holds. Anything fixed in a shell file there belongs
back here.

## If you have just forked this

```
src/shell/     the half that is the same in every game.      DO NOT EDIT.
src/game/      the rules, the engine, the board.             REPLACE.
src/main.ts    the loop that joins them.                     YOURS.
src/i18n.ts    what the buttons say.                         YOURS.
public/playbooks/coach.md   the assistant's persona.         YOURS.
tools/         the rules test and the search benchmark.      REPLACE THE TESTS.
```

The seam is deliberately narrow, and it is four things:

| the shell needs | the game supplies |
| --- | --- |
| a grid to place things on | `BoardRig({ cols, rows })`, and its own meshes via `rig.at(x, y)` |
| how a cell is named | a `Notation` (`parse`/`format`) — `src/game/coords.ts` |
| what the assistant may do and see | an `AssistantSpec` — `src/game/assistant.ts` |
| a number for the eval bar | `{ share, label }`, in whatever units make sense |

`src/main.ts` is NOT generic and should not be made so. The move flow differs
too much between these games — Go places a stone, chess picks a piece up and
puts it somewhere — and a loop abstract enough to cover both would be harder
to read than four honest loops. It is short, it is commented, and it is meant
to be edited.

## The two brains, and why they are separate

**The ENGINE** (`src/game/engine.ts`) decides moves and reads positions. It is
an alpha-beta search over the same rules the player moves through, in a Web
Worker in this browser — no backend, no per-move cost, works signed out.
Everything factual comes from here or from the referee.

**The ASSISTANT** (`src/shell/coach.ts` + `src/game/assistant.ts`) talks. It is
the platform's runtime AI (ADR-017), handed the numbers to talk *about*. It can
point at the board and it can change settings. It never decides a move and it
never puts a stone down. A game can be played with it switched off, and then
nothing here calls the platform AI at all.

## The referee is tested, not believed

`npm run verify` is the load-bearing test. Chess-likes have perft; gomoku's
move tree is "every empty cell" and counting it proves nothing, so the tests
are about the two things everything else trusts:

- **five in a row**, in every direction, at the edge, and an overline (which
  wins here — this is free-style gomoku, no forbidden moves);
- **`threats()`**, which is what the assistant reports out loud.

`threats()` is defined by consequence rather than by pattern — a *win* cell is
one where playing makes five, an *open four* is one after which there are two
winning cells, an *open three* is one after which an open four is available.
Written that way it is slower than matching `.xxx.` against a string and it is
right about the shapes that matter: **a broken three (`.x.xx.`) is a live
three**, and the first draft of the test said otherwise. A blocked three is
not, and neither is anything with no room against the wall.

**Renju's forbidden moves (三三, 四四, 長連) are the marked extension point**,
in `play()`. Their real definition is recursive and subtle, which is exactly
why they are not in a file whose job is to be readable.

## Things that will bite

**The engine may approximate; the assistant may not.** The search uses fast
pattern counting; anything said out loud comes from `threats()`. Mixing the two
is how a game tells a beginner something false in a confident voice.

**Ask the referee for the cheap answer, not the whole one.** `winningCells` is
one poke per cell; `openThreeCells` walks the reply tree. The search calls the
first and never the second — when it called `threats()` the engine spent a
quarter of a second per move doing work it did not need.

**Threat functions are line-local, and that is exact, not a shortcut.** A five
containing a cell lies in a line through it, so `lineCells()` is the whole
answer space. It is the difference between milliseconds and seconds on a
crowded board.

**Candidates are cells near stones.** All 225 of them, four deep, is 2.5
billion positions; twelve of them is thirty thousand. `relevant(2)` in the
search is a heuristic and is marked as one; `relevant(4)` in the threat
functions is exact.

**Move ordering must stay LOCAL.** It once asked the whole board what it was
worth before and after each candidate — three full scans per candidate, sixty
candidates a node — and the engine took 600ms for a move it now makes in 8.

**Scores are flipped to the player's point of view exactly once**, in
`opponent.read`. A second flip anywhere is an assistant saying you are winning
while you are being beaten.

**A blunder is judged against the position the move PRODUCED**, not the one
after the engine has replied. `engineTurn()` hands back the read it decided
from for exactly this reason. Better still, the sharpest remarks in this game
are not scores at all: "you had five at K11" and "he can make five at G7 and
you did not block" come from the referee.

**The action buttons move out of the way of the board.** A button standing on
a point is a point the player cannot tap, and on a board of intersections
every neighbour of the aimed-at point is a legal move. `PointActions.place()`
searches rotations AND radii: on a lattice the only free places are the middles
of the cells, at 0.707 and 1.581 spacings. It also uses the LOCAL spacing —
the nearest keep-clear point — because perspective makes a cell at the front
of the board wider than one at the back, and a single figure is out by enough
to put a button back on a point.

**Pointer bookkeeping is defensive, and the comments in `controls.ts` say why.**
A few quick multi-finger taps used to wedge the board forever: `pointerdown`
recorded the finger and then threw on `setPointerCapture`, and two stale
entries meant every later tap looked like a second finger. Never let anything
throw in that handler before the mode is decided.

**The board draws only when it changes** — and the panels on it use
`backdrop-filter`, which samples a canvas that is not redrawing. That is what
`repaintSoon()` is for. A panel leaving a ghost of itself behind is this.

**`let` that the render loop reads must be declared before the loop starts.**
A `const` it touches too early is a `ReferenceError` that takes the whole game
down at boot with a blank screen. It has happened twice in this family.

**Saves are quota'd**: 100KB per value, 1MB per player, 64 keys. A game is
saved as its moves and replayed through the referee, so a save can never hold
a position the rules cannot reach.

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

**The table is NOT wood, and that came from measuring it** (2026-09-23). It
was dark walnut, then pale wood, and the pale wood was sampled off the canvas:
the board and the table came out at the SAME luminance — 1.02:1 here, and the
same story in every game in the family. What separated board from table was
hue and nothing else, which is what "the whole screen is one brown photograph"
actually is.

So it became a matte pale stone — `TABLE_TONE` at `roughness: 0.95`, with **no
grain**, because a texture on the table competes with the grid, which is the
only texture anybody is meant to be reading. Measured after: the board against the table at 1.66:1, and a white stone against the board at 1.68:1. Four
things go with it and each one is a separate decision:

- **The board went one step DARKER, in LINEAR light rather than in hex digits (×0.72). The wood is the GAME's (`src/game/board.ts`); the table is the SHELL's — which is the seam working: every game in the family sits on the same table and brings its own board.**
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

**The platform decides the language.** `umicat.locale` arrives at handshake.
Chat is the exception and belongs to the assistant.

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

**The camera is FIXED and looks STRAIGHT DOWN.** No orbit, no pinch, nothing
to recentre: a board game is not a world to look around — the position is the
same information from every angle — so a camera the player can move is a
camera they can lose. Straight down is also the one angle at which the board
is the shape it actually is; any tilt makes it a trapezoid and closes up the
far rows. `camera.up` has to be set to −z by hand, because from directly
overhead the default up is the direction the camera is looking along and
`lookAt` cannot resolve it.

**The board sits on a TABLE, and that is what the lighting is for.** A plane
drawn rather than photographed (what it is MADE of is the note above); the board is a slab with real
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

## Playing a person

The third door on the title screen. `src/shell/lobby.ts` gets two people to
the same table; `src/shell/net/table.ts` is what the game talks to afterwards,
and `src/shell/net/clock.ts` is the two clocks. All three are SHELL — the next
game in this family should get online play by filling in the same four
contracts, not by writing this again.

**Against a person there is no assistant, no eval bar and no hint.** All three
are the engine talking, and an engine talking to one player in a game between
two is called cheating. `startOnline()` turns them off and the gear hides the
hint button; the chat panel stays, because it is now a conversation with the
opponent rather than with a coach (`chat.setPeer(name)` is what makes it say
so — a panel headed "Assistant" in a game against a person is the game telling
somebody their opponent is a robot).

**The whole game crosses the network as ONE value under one key, and only the
player on turn writes it.** That is what makes a last-writer-wins map safe:
one writer at any moment, and the rules say who it is. The value is the MOVE
LIST, replayed through the referee — the same thing a save is, so there is one
format and not two. Blokus learned the separate-keys lesson the expensive way:
a client could read a board from after a move and a hand from before it.

**A move arriving from the other machine is checked exactly like a local one.**
`applyRemote()` replays into a fresh `Gomoku` and refuses anything the referee
refuses. A client that plays out of turn, by racing or on purpose, is ignored
rather than obeyed.

**Nothing ever sends a clock tick.** The snapshot says what each side had left
when `at` was stamped, and the side to move has been spending since; a running
clock would be sixty messages a minute saying what arithmetic already knows.

**The table-maker chooses the clock, and the game supplies the choices.**
`CLOCKS` in `main.ts` is this game's three (3+2, 10+5, 20+15); the control
rides in the snapshot, so whoever joins plays the same game rather than their
own default. `net/clock.ts` knows two shapes: an INCREMENT, which is a budget,
and BYO-YOMI, which is permission — a period RESETS if you move inside it, so
a Go game ends when somebody can no longer think for thirty seconds rather
than when they have thought for ten minutes. Go is the reason byo-yomi is
there; it is tested (`npm run verify`) and waiting for Go to get a table.

**The flag is claimed by the player who is NOT on the clock**, with two
seconds of grace — they are the one with time to notice, but they are reading
a stamp written by a machine whose idea of "now" is not the same, and a claim
that fires a second early takes a game off somebody who was still moving.

**Saying something about a point is ONE act, whoever is listening.** The tap,
the message button beside the point, the composer that opens there — all of it
is the same flow as asking the assistant; at a table the sentence goes to the
other player instead. The point travels as the `[H8]` marker the assistant
already uses to aim its own sentences, so the chat relay only ever carries
text and `segment()` at the far end already knows how to read it. Both sides
see it on the board, in that place, with the sender's name on the box — and
the box's reply field answers the person, in the same place, because a
conversation about a point belongs at the point.

**A line with no point in it stands over the head of whoever said it**, one at
a time, and only while the log is closed (the seats hide when the panel
opens). That is a glance, not a log: a stack of them is a second panel growing
out of somebody's head, and whatever it pushes up is the part you had already
read.

**The "play here" shortcut belongs to the assistant's sentences only.** An
opponent saying "this corner is yours" is not offering you a button, and one
that appears under their words reads as the game taking their side.

**Leaving loses, but not for fifteen seconds.** The rule is that quitting
costs you the game (that is what will make a ranking worth having). A phone in
a tunnel, a closed laptop lid and iOS suspending a backgrounded WebView all
look exactly like quitting for a few seconds, so the seat says "they have gone
quiet" first and only then is it a loss. `LEAVE_GRACE_MS`.

**A rematch swaps the colours**, so nobody has the first move twice running,
and whoever now has Black publishes the opening snapshot — one writer, one
stamp, same rule as at the start.

**Online games are not saved.** An online game belongs to the room and to the
two people in it; restoring one from this side would put a board on screen
that nobody else is sitting at.

**What a ranking would need, and does not have yet.** The realtime service is
a RELAY: `room.data` is a shared map any client may write, and the clock is
stamped by the machine that moved. Between friends that is fine. A leaderboard
that costs people points cannot be settled by "the other client said I won" —
that needs the result decided somewhere neither player controls.

## The table's life, which is longer than a game

Four bugs, one cause: the first version decided the seats ONCE, when the
second player arrived, and never looked again. Every one of them appeared the
first time two real people used it.

**Seats are derived from presence, every time, and written by one client.**
`Table.seats()` reads the room's map and drops anybody who has gone;
`maintainSeats()` fills the empty chairs and is a no-op for everyone except
the longest-standing connection. **Nobody is seated alone** — a client that
joins, looks around before the room has told it about anybody else, and writes
itself into the first chair is a write that lands after the real maintainer's
and clobbers it. That is how the table-maker ended up in the second seat.

**A snapshot says which game it is (`gen`) and whose it is (`for`).** Without
that, the finished game left in the room is handed to whoever sits down next,
who is shown a result they had no part in — which is exactly what happened.
When two people are seated and the state does not belong to THEM, the
maintainer deals a new one; every client treats a changed `gen` as a new game
and drops the old board, the old result and the old card.

**A live game is not interrupted by an empty chair.** A dropped connection
shows up as an empty seat first, and the waiting screen used to go straight up
— which stopped the clock, which is where the fifteen seconds of grace are
counted, so the game never ended and the player sat in front of a waiting
screen holding a result nobody had declared.

**The card at the end follows the room.** "Play again" stops being true the
moment the other player gets up, so the buttons become "wait for someone" and
"leave" and the player is ASKED rather than left in a room with a dead board.

**Every way out has to go through `Table.close()`** — the gear's "back to the
title", starting a game against the engine, and `pagehide`/`beforeunload`.
A client that stays connected while its player is somewhere else is a table on
the list of open tables with nobody at it. That was the fourth bug.

## Testing it

`umicat.rooms` is unavailable standalone (`npm run dev`, or the CDN preview
opened directly), and the lobby says so in a sentence rather than failing one
button at a time. There are two ways to drive it, and they cover different
things:

- **A stand-in room** (`fakeroom.js` in the session scratchpad): two tabs over
  a `BroadcastChannel`. Fast, no accounts, covers seating, the snapshot
  exchange, the clocks, resignation, draws, rematches, flags and disconnects.
  It must hydrate a late joiner the way a real join is hydrated with
  `room.state`, or every test of the second player is a test of the stand-in.
- **The real service**, which is what actually settles a question about
  Colyseus: `tools/host/index.html` is a stand-in for home-ui — it does the
  init handshake WITH a `realtimeUrl`, which is the thing that turns
  multiplayer on. Serve it (`python3 -m http.server 4190 --directory
  tools/host`) and open
  `?game=<id>&src=<encoded preview url>&name=Ann&uid=ann`. Two browser
  contexts signed into the SAME account are two different players, because a
  seat is a session and not a user. The one wrinkle: `POST /games/{id}/rt-token`
  refuses a localhost origin (CORS), so the harness calls a
  `window.__rtToken` binding when one exists and the probe mints the token in
  node. **The rt-token endpoint checks that you are signed in, not that you are
  a member of the game** — which is why this works at all.

## Building and checking

```bash
npm run dev        # local dev server
npm run build      # what the platform runs
npm run verify     # the referee's tests — run before every commit that touches rules.ts
npm run typecheck  # tsc --noEmit
npm run bench      # depth vs time, a game against itself, and what threats() costs
```

Playwright probes live in the session scratchpad rather than here; they drive
the game through `window.__game`, which exposes the board, the engine, the
assistant, the menu and `play('H8')`. Note that `window.__game` only exists
once a game has started — the title screen is awaited before it is assigned.
