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

**A new game is a new conversation; Continue keeps the old one.** The summary
is written first, so nothing is lost.

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
of dark walnut, drawn rather than photographed; the board is a slab with real
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
Ten minutes each plus five seconds a move (`CLOCK`).

**The flag is claimed by the player who is NOT on the clock**, with two
seconds of grace — they are the one with time to notice, but they are reading
a stamp written by a machine whose idea of "now" is not the same, and a claim
that fires a second early takes a game off somebody who was still moving.

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

**Testing it without a platform.** `umicat.rooms` is unavailable standalone
(`npm run dev`, or the CDN preview opened directly), and the lobby says so in
a sentence rather than failing one button at a time. The probes in the session
scratchpad drive two tabs against a stand-in room over a `BroadcastChannel`
(`fakeroom.js`) — that covers seating, the snapshot exchange, the clocks,
resignation, draws, rematches, flags and disconnects, but NOT Colyseus itself.
One thing the stand-in taught: it has to hydrate a late joiner the way a real
join is hydrated with `room.state`, or every test of the second player is a
test of the stand-in.

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
