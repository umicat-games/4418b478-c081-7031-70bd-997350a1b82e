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
| `src/view/controls.ts` | pointer handling: choose a point vs move the camera |
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

**A new game is a new conversation; Continue keeps the old one.** The summary
is written first, so nothing is lost.

**The platform decides the language.** `umicat.locale` arrives at handshake;
the game switches to it and nothing else does. Chat is the exception and
belongs to the assistant: it replies in whatever it is written to.

**`ai` and `microphone` must be declared** in the game's Settings on the
platform, or the backend rejects AI calls and the iframe blocks the mic.

**The title art ships in `public/art/`, derived from the Asset Manager
originals.** The originals — `go-with-me-title.png` and
`go-with-me-title-bg.png`, uploaded through the platform and served from
`cdn.umicat.ai/uploads/<game id>/` — are 2.6MB between them, and the game
cannot show a title screen until its title has arrived: on a throttled load
the boot bar was still crawling two seconds in. The shipped copies are the
same pictures at the size they are drawn, as WebP: **181KB**, visually
identical at 520px and 1600px respectively.

If the originals are re-exported, re-derive them. There is no `cwebp` on the
machine this was done on; Chromium encodes WebP perfectly well, alpha
included, so the recipe was: load the PNG into a canvas at the target width
(1100px for the wordmark, 1600px for the background) and
`canvas.toDataURL('image/webp', 0.92 / 0.82)`.

Both are decoration and both have a fallback: the wordmark reverts to text,
the photograph to the gradient that used to be the whole background. The scrim
over the photo is deliberately light (0.22 in the middle) — at 0.40 the sunlit
wood went brown, and the two lines of small text it was protecting now carry
their own shadow instead.

**The boot screen is in `index.html`, not in the bundle.** Its whole job is to
be on screen before the bundle has parsed, so it cannot be built by it. It
wears the title screen's art at the title screen's size, which makes the
hand-over the buttons arriving rather than the screen being replaced — and for
the same reason the title's own art does NOT fade in: two crossfades of the
same picture is the flash again, in slow motion. Balaboo's loading screen is
the model for how it looks; `window.__boot` is what `src/ui/boot.ts` drives it
with, and it removes itself after nine seconds whatever happens, because
nobody should ever be stuck behind a progress bar.

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
