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

**The board is on a TABLE, and that is what the lighting is for.** A plane of
dark walnut, drawn rather than photographed so it costs nothing to ship and is
lit by the same lamp as everything else; the board is a slab with real
thickness standing on it, casting a real shadow. Two settings do most of the
work and both fight the instinct to add light: the key is LOW (about 25° above
the table, not 45°, or the shadow falls straight down and there is nothing to
see) and the fill is weak (0.55 — fill is the enemy of the shadow that makes
the board sit on the table). The framing pulls back to 0.84 of the screen so
some table is always in frame: a table you cannot see is a backdrop.

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
be on screen before the bundle has parsed, so it cannot be built by it. It is
black and a bar — no words, because the player's language arrives at the
handshake this is waiting for, and no artwork, because the title screen is
where the artwork belongs. `window.__boot` is what `src/ui/boot.ts` drives it
with, and it removes itself after nine seconds whatever happens, because
nobody should ever be stuck behind a progress bar. The title's own art does
not fade in, so the hand-over is one fade (the boot screen's) rather than two
crossfades of the same moment.

**A relative `url()` that reaches CSS through a custom property is resolved
against the STYLESHEET, not the page.** `--art` was set to
`url("art/title-bg.webp")` from JavaScript, which works in dev and 403s in a
build, because the built CSS lives in `assets/` and the path became
`assets/art/…`. The wordmark beside it was fine the whole time — it is an
`<img src>`, resolved against the document. Two rules for the same string, and
only one of them shows up before deploying. `asUrl()` in `title.ts` makes the
path absolute against `document.baseURI`; anything else handed to CSS from
code should do the same. **Check a `vite preview` of `dist/`, not just
`npm run dev`, whenever a path is involved.**

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
