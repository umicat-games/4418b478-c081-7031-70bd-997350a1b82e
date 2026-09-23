# GO with me

A game of Go against a real engine, with an AI assistant sitting beside the
board. This file is the memory of what has been built and why; the design
questions that are still open live in `docs/`.

> **Update this file in the same commit as the change.** It used to describe
> the 3D character template this was forked from, long after none of that was
> true, which is exactly how a long session gets misled.

Game id `f60d9eec-40ae-42fd-be1d-2c1f2cf428db`, fork org `umicat-games`
(the repo holds one branch per game). `./deploy-preview.sh` publishes `dist/`
straight to S3 + CloudFront. **Always commit AND deploy** — a direct deploy is
a temporary override that any workspace rebuild wipes out.

## The two brains, and why they are separate

**The ENGINE** (`src/go/opponent.ts`) decides moves and reads positions. It is
KataGo's own network and search, vendored from web-katrain (MIT) and running in
a Web Worker in this browser — no backend, no per-move cost, works signed out.
Everything factual comes from here: who is ahead, by how many points, what the
better move was, which points a group's liberties are on.

**The ASSISTANT** (`src/coach/coach.ts`) talks. It is the platform's runtime AI
(ADR-017), handed the engine's numbers to talk *about*. It can point at the
board — mark points, show liberties, offer a move — and it can change settings.
It never decides a move and it never puts a stone down. A game can be played
without it at all (the switch in the new-game panel), and then nothing here
calls the platform AI and none of the buttons that would are on screen.

This split is the whole trust model. **A language model cannot play Go**: it
loses track of the board, miscounts liberties, and proposes illegal moves with
complete confidence. Ask it to *explain* the engine's numbers and it is doing
what it is good at. If you are ever tempted to let the model decide something
factual, that is the line being crossed.

## Where things are

| file | what |
| --- | --- |
| `src/main.ts` | the loop that joins everything. Start here. |
| `src/go/rules.ts` | the board: legality, captures, ko, superko, scoring rules |
| `src/go/opponent.ts` | the engine wrapper, **and the one place strength is decided** |
| `src/go/scoring.ts` | counting the board from the network's ownership head |
| `src/go/coords.ts` | `D4` ⇄ `{x,y}` — three conventions disagree, see the file |
| `src/coach/coach.ts` | the assistant: actions, observation, memory |
| `public/playbooks/coach.md` | **its persona and rules, as editable prose** |
| `src/view/board3d.ts` | the board drawn, the camera, hit-testing |
| `src/view/controls.ts` | pointer handling: which point was tapped |
| `src/ui/speech.ts` | what it says, on the board, with the reply field |
| `src/ui/askhere.ts` | asking about a point, at the point |
| `src/ui/pointactions.ts` | confirm / cancel / ask, beside the stone |
| `src/ui/dictation.ts` | voice + level meter, shared by every field |
| `src/ui/chat.ts` | the log, opened from the corner |
| `src/ui/menu.ts` | the one panel: new game AND settings |
| `src/ui/buttons.css` | **how a button looks** — `lift` and `chip` |
| `src/audio.ts` | which clips, how loud |
| `src/save.ts` | what survives leaving, and the quotas that shape it |
| `src/engine/` | **vendored KataGo** — frozen, see `vendor/VENDOR.md` |
| `src/teach/` | **parked tutorial** — data and checkers, not wired in |

## Things that will bite

**The network is not in this repo.** 3.7MB of weights that never change,
fetched at runtime from the game's own CDN prefix. `npm run dev` needs a local
copy in `public/models/` — `vendor/VENDOR.md` has the one-line curl. A missing
model looks like a broken engine, not a missing file.

**The engine is single-threaded and always will be here.** Threaded wasm needs
`SharedArrayBuffer`, which needs cross-origin isolation, which a game iframe
served from the CDN does not have. It is fast enough (9x9 at 400 visits is
under a second on a laptop). Do not go looking for `setThreadsCount`.

**Strength is visits plus temperature over the engine's OWN candidates.** Never
inject random moves: a random move on a Go board is not "a weaker player", it
is a move no human would consider, and a beginner shown one learns something
false.

**The board enforces the rules for the AI exactly as for the player.** Both go
through the same helpers the engine searches with, so there is one
implementation of a capture and not two.

**The camera is FIXED, and it looks STRAIGHT DOWN.** No orbit, no pinch,
nothing to recentre — a board game is not a world to look around, the position
is the same information from every angle, and a camera the player can move is
a camera they can lose. Straight down is the one angle at which a square board
is a square: measured, all four sides are 524px and the line spacing is 65px
everywhere, front to back. Any tilt costs that twice over, because the far
rows close up AND the shape being read is not the shape the game is played on.

Two things follow. `camera.up` has to be set to −z by hand: from directly
overhead the default up is the direction the camera is looking along, `lookAt`
cannot resolve it, and the board arrives rotated arbitrarily or as NaN. And
the depth that the tilt used to provide is now entirely the SHADOWS — which is
why the lamp is low (about 30°) and comes from the top left, so they fall down
and to the right the way an overhead photograph reads. `controls.ts` still tells a second finger apart from a
first (a second finger is never a move), it just has nothing to do with it.

**The board is on a TABLE, and that is what the lighting is for.** A plane
drawn rather than photographed, so it costs nothing to ship and is lit by the
same lamp as everything else (what it is MADE of is the note below); the board is a slab with real
thickness standing on it, casting a real shadow. Two settings do most of the
work and both fight the instinct to add light: the key is LOW (about 25° above
the table, not 45°, or the shadow falls straight down and there is nothing to
see) and the fill is weak (0.55 — fill is the enemy of the shadow that makes
the board sit on the table). The framing pulls back to 0.84 of the screen so
some table is always in frame: a table you cannot see is a backdrop.

**The table is NOT wood, and that came from measuring it** (2026-09-23). It
was dark walnut, then pale wood, and the pale wood was sampled off the canvas:
the board and the table came out at the SAME luminance — 1.08:1 here, and the
same story in every game in the family. What separated board from table was
hue and nothing else, which is what "the whole screen is one brown photograph"
actually is.

So it became a matte pale stone — `TABLE_TONE` at `roughness: 0.95`, with **no
grain**, because a texture on the table competes with the grid, which is the
only texture anybody is meant to be reading. Measured after: the board against the table at 1.58:1, and a white stone against the board at 1.62:1 (was 1.27:1). Four
things go with it and each one is a separate decision:

- **The board went one step DARKER, in LINEAR light rather than in hex digits (×0.72). On a pale table a light board is a lighter patch of the same thing — and the board is also what a white stone sits on, which was the second-weakest pair on the screen.**
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

**The camera is a long lens, not orthographic.** Orthographic was tried: a
square board seen from an angle with no near-and-far does not look tilted, it
looks *bent*. 22° of perspective costs 8% foreshortening on 19x19 (measured)
and buys the depth cue that makes it read as a board lying down.

**The grid is painted into the board's texture**, not laid over it as geometry.
Lines sitting a hair above a surface z-fight at some angles and vanish at
others.

**`let` that the render loop reads must be declared before the loop starts.**
The loop runs from the first frame, long before the rest of `start()` exists,
and a `const`/`let` it touches too early is a `ReferenceError` that takes the
whole game down at boot with a blank screen. This has happened twice.

**Nothing is played by pointing at it.** Choosing a point shows a ghost and
three buttons beside it — confirm, cancel, ask. Both devices work this way:
one-tap placement on a 19x19 is a game that loses itself to a fat finger, and
two rules (tap-to-place on a mouse, aim-and-confirm on touch) is one rule too
many to describe.

**The conversation happens ON the board.** The assistant's reply is a bubble
beside the point it is about, with a reply field on its last page; asking about
a stone opens a composer at that stone. The panel on the right is for reading
back through what was said, and it opens from the corner. Anything that makes
the player open the panel to continue a conversation is a regression.

**Marks and focus are different things.** `setHighlights` is the assistant's
own marking (cyan); `setFocus` is the point the current sentence is about
(gold), and the bubble sets it on every page. They shared one list once, and a
sentence with no coordinate in it cleared the rings the assistant had just
drawn — so `highlight` worked and was invisible.

**Never report a mark that did not happen.** `highlight` returns how many
points it actually marked; zero says so, to the player and to the model. "I've
marked it" over an unchanged board sends the player looking for something that
is not there.

**The assistant's `[C3]` markers aim the speech bubble.** A sentence it opens
with `[C3]` is shown beside C3 with the point lit; without a marker, a
coordinate in the text is used; with neither, the middle of the board. Strip
them anywhere the line is shown as prose (`stripAnchors`).

**Counting liberties is the game's job.** `show_liberties` exists because a
model asked to count them off a text board answers confidently and wrongly.
The same rule applies to anything else that must be *correct* rather than
*fluent*.

**The board draws only when it changes.** A Go board between moves is a still
life, and redrawing it sixty times a second costs the core the ENGINE wants.
Every mutator sets `dirty`; `render()` returns whether it drew, and the DOM
overlays pinned to board points follow that signal. If something on the board
stops updating, look for a mutator that forgot to invalidate — and note that
panels using `backdrop-filter` need the canvas to repaint too, which is what
`repaintSoon()` in main.ts is for.

**Saves are quota'd**: 100KB per value, 1MB per player, 64 keys. The chat log
is trimmed to its tail and the rest lives in the assistant's summary — which is
also what stops each turn getting more expensive, since every turn ships the
history.

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

**The platform decides the language.** `umicat.locale` arrives at handshake;
the game switches to it and nothing else does. Chat is the exception and
belongs to the assistant: it replies in whatever it is written to.

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

**The title art ships in `public/art/`, derived from the Asset Manager
originals.** `logo.webp` is this game's wordmark; `table-bg.webp` is the
photograph of the table, and it is the SAME picture in every game in this
family — the five of them now share one title screen design, so a player who
has seen one knows where they are in the next.

The originals are 1–3MB each and **a title screen cannot appear until its
title has arrived**: at that weight the boot bar was still crawling two
seconds into a throttled load. There is no `cwebp` here; Chromium encodes WebP
perfectly well, alpha included, so the recipe is to draw the PNG into a canvas
at the size it is actually drawn and `canvas.toDataURL('image/webp', q)` —
1000px at 0.9 for a wordmark, 1400px at 0.72 for the table.

Both are decoration and both have a fallback, and **the fallback must not be
what you see first**: the words stay hidden until the art has either arrived
or given up, and the boot screen stays up for exactly that long. Wait for
BOTH — a wordmark landing a second before its background is the same flash in
two parts.

**A relative `url()` that reaches CSS through a custom property is resolved
against the STYLESHEET, not the page.** `--table` set from JavaScript works in
dev and 403s in a build, because the built CSS lives in `assets/` and the path
becomes `assets/art/…`. The wordmark beside it was fine the whole time — it is
an `<img src>`, resolved against the document. `asUrl()` makes the path
absolute against `document.baseURI`. **Check a `vite preview` of `dist/`, not
just `npm run dev`, whenever a path is involved.**

**A capture is a handful of stones picked up ONE AT A TIME.** The rules take
them off in the same instant — by the time anything can ask, the points are
empty — so `GoGame.lastCaptured` keeps where they were standing (the turn log
keeps only the COUNT, because that is all a replay needs) and the view draws
them for as long as they are leaving. Three things it is built on:

- **They go in order, nearest the played stone first.** All at once is a group
  blinking out; one after another is a hand, and the order says which move
  did it. The stagger is by DISTANCE from the move, not by array index — the
  list comes out of a flood fill and its order means nothing on the board. A
  big capture staggers tighter rather than taking proportionally longer.
- **They RISE in place before they go anywhere.** A single curve from the
  board to the bowl reads as being flicked off the edge; the lift is the part
  that reads as being picked up.
- **They fly to the seat that counts them** — the player's plate is on the
  left, the engine's on the right — **and the count waits for them.** The
  plates read `counted`, not `game.captures`: a number that goes up while
  five stones are still visibly sitting on the wood is the HUD contradicting
  the board. `settleCounts()` is what puts them level again, and it must be
  called anywhere the board is rewritten without a cascade — a new game, a
  restored one, a cascade cut short (`clearFlights` reports too, or the count
  stays one capture behind for the rest of the game).

**A flight that has not started yet still has to be SOMEWHERE**, and a mesh
nobody has positioned is at the world origin — the middle of the board. The
stones waiting their turn stand on their own points, which is also what they
are: stones nobody has picked up yet.

**Each pooled flying stone owns its material.** They are a stagger apart, so a
shared material fades them all at whatever the last one written says. Made
once and reused: identical materials share a compiled program, so the first
capture pays for one shader and none after it pays for any. Building one per
flight is what made the chess board stutter — a new program, compiled on the
frame the stone was supposed to start moving.

**Sampling an animation needs the page's clock FROZEN.** A screenshot takes
longer than the cascade does, so a probe that captures a group and asks for a
picture "at 100ms" gets the board after it finished — which looks exactly like
nothing rendering. Override `performance.now` with a value the probe advances
by hand, call `animate()` then `render()`, and only then shoot. Stub
`opponent.decide` to a promise that never settles while doing it, or the
engine's reply lands between two frames. And the local preview is `vite
preview` of `dist/`: a source edit is not on screen until `npm run build`.

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

Sound is Kenney CC0 except the music; `public/audio/CREDITS.md` says which
clip is which and why poker chips are the closest thing to slate on wood.

```bash
npm run dev       # local dev server (needs public/models/, see above)
npm run build     # what the platform runs
npm run verify    # the parked lesson data: every exercise still solvable
```

Playwright probes live in the session scratchpad rather than here; they drive
the game through `window.__game`, which exposes the board, the assistant, the
menu and the actions. Driving it through pixels means testing whether you can
click a three-millimetre intersection, which is a test of the test.
