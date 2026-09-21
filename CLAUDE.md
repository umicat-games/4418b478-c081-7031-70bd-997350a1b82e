# Blokus

Four colours, one twenty-by-twenty board, in three dimensions — against bots or
against people in a room. This file is the memory of what has been built and
why.

> **Update this file in the same commit as the change.** The Go game's copy
> described the 3D character template it was forked from long after none of it
> was true, which is exactly how a long session gets misled.

Game id `629fd8aa-4e90-4b1a-97e5-d04358b000cf`, fork org `umicat-games` (the
repo holds one branch per game). `./deploy-preview.sh` publishes `dist/`
straight to S3 + CloudFront. **Always commit AND deploy** — a direct deploy is
a temporary override that any workspace rebuild wipes out.

This is a 3D remake of the 2D Blokus
(`c4fb5fa2-0d10-46ed-860a-d1bc76111532`, Phaser, in the `unboxy-games` fork of
the same repo). Every feature that game had is here: the rules, the four-handed
game with bots filling the empty seats, three bot levels, create / join by code
/ browse / quick match, in-game chat, and the saved settings. The interface is
**Chess with me** and **GO with me**'s, ported — the camera rig, the card, the
aim-then-confirm step, the settings panel and the chat panel are theirs. When
something here looks odd, one of those two repos probably explains why.

## Where things are

| file | what |
| --- | --- |
| `src/main.ts` | the loop that joins everything. Start here. |
| `src/blokus/pieces.ts` | the 21 shapes, their orientations, **and `canPlace`** |
| `src/blokus/game.ts` | the state machine: hands, turns, skipping, the result |
| `src/blokus/bot.ts` | the one-ply search, and what the three levels mean |
| `src/net/table.ts` | the four seats, and the ONE key the state travels under |
| `src/view/board3d.ts` | the board drawn, the camera, hit-testing |
| `src/view/controls.ts` | pointer handling: aim a piece vs move the camera |
| `src/ui/screen.ts` | the card every non-game screen is made of |
| `src/ui/front.ts` | title, how-to-play, bot level |
| `src/ui/lobby.ts` | rooms: create, join, browse, quick match, the waiting room |
| `src/ui/tray.ts` | the hand along the bottom, and the piece glyphs |
| `src/ui/actions.ts` | the tick and the cross, beside the piece |
| `src/ui/hud.ts` | whose turn, the scoreboard, the two round buttons |
| `src/ui/chat.ts`, `menu.ts`, `over.ts` | table talk, settings, the result |
| `src/ui/confirm.ts` | **the only way to ask a yes/no question here** |
| `src/ui/buttons.css` | **how a button looks** — `lift` and `chip` |
| `src/save.ts` | settings, best score, and the unfinished solo game |
| `src/i18n.ts` | every fixed string, English and Chinese |

## Things that will bite

**`canPlace` is the only thing allowed to decide a move is legal**, and
`BlokusGame.legal` is the only thing allowed to decide it is your turn. The
view asks, the bot asks, and a move arriving from another machine is checked
the same way — a client that plays out of turn, by racing or on purpose, is
refused rather than obeyed.

**The whole game state crosses the network as ONE value under one key**
(`state` in `room.data`). The 2D game sent the board, the turn, the scores and
each hand as separate keys, and that is where its bugs lived: a client could
read a board from after a move and a hand from before it. One key is ~3KB of
JSON, which over a websocket is nothing, and it is never half-applied.
**Only the player on turn writes it**; for a bot's seat, the host does.

**An empty seat is a bot — so a solo table has to NAME its own seat.** It did
not at first, and the bots cheerfully played the human's turn while the player
watched. `Table.solo()` puts `'me'` in seat 0 for exactly this.

**A bot's timer that finds the turn has moved must ask again, not return.**
Returning leaves `botTimer` null with nothing scheduled and the board simply
stops — which is what happened, and it looks like the bots crashed.

**The camera fit is measured in SCREEN PIXELS against the visible rectangle**,
not in normalised coordinates against the whole window. With a view offset
those are different things, and the version that mixed them backed the camera
off by nearly half for a tray a seventh of the screen tall.

**The camera sits at the SIDE next to your corner, not on the diagonal.** Down
a diagonal a square board is a diamond, and a diamond needs its 28-cell
diagonal to fit in a window with 20 cells' worth of height — forty per cent of
the board thrown away. It is also how people sit at a real one.

**Never `window.confirm` / `alert` / `prompt`.** The game runs in an iframe
sandboxed `allow-scripts allow-same-origin allow-popups allow-forms` — note
what is missing. Without `allow-modals` the browser IGNORES `confirm()`: no
dialog, no exception, and a return value of `false`. So "Leave the game" and
"Pass" were buttons that did nothing at all, silently, for days. `ui/confirm.ts`
is the replacement and it is made of the same DOM as everything else.

**The canvas needs `touch-action: none`, and nothing else will set it.** A 3D
game that mounts `Input3D` gets this from the SDK; this one does not mount it,
so `index.html` says it. Without it the browser claims two fingers for its own
page zoom and a drag for a scroll, `pointermove` stops arriving, and
pinch-to-zoom and drag-to-aim both do nothing on a phone while working
perfectly on a desktop.

**Zoom and pan are one feature.** Zooming with the look-at point nailed to the
middle of the board is zooming into the one place you are not playing. The
camera's distance is `fitDistance / zoom`, where `fitDistance` is re-measured on
every frame with the pan and zoom taken out — that is why the fit loop runs with
the target at the origin and the real shot is placed afterwards.

**The gestures, and why each is where it is:**

| | touch | mouse |
| --- | --- | --- |
| put the piece down | one finger, tap — it lands ABOVE the fingertip | left button, drag or hover |
| move it again | drag from ANYWHERE; the finger is a trackpad | left button, drag |
| turn the piece | Turn button / `R` | **right CLICK**, Turn button, `R` |
| move the camera | — | right button, DRAG |
| pan | two fingers, drag | middle button, or shift + right |
| zoom | pinch, or the + / − buttons | wheel, or the + / − buttons |

Two fingers PAN rather than orbit because panning is what zooming needs: at
four times the zoom most of the board is off screen and there is no other way
to reach it. The right mouse button carries both turn and orbit, told apart by
whether it moved more than a few pixels before coming up.

**On a finger, the piece is put down once and then NUDGED.** The first touch
after picking a piece aims where it lands, held `TOUCH_LIFT` (44px, about a
fingertip) above the finger — a finger covers roughly a centimetre of board,
and that centimetre is the part you are trying to look at. Every touch after
that is RELATIVE: touching elsewhere does not fling the piece there, and a
drag moves it by however far the finger moved, from wherever on the screen the
hand is out of the way. Tapping to re-place it would mean tapping exactly
where the confirm buttons are now standing, which is where you want to tap.

The relative drag moves a VIRTUAL POINTER that starts at the piece's own
screen position and is then picked against the board like any other point
(`virtual` in main.ts). Perspective, the tilt and the zoom all come out right
for free, and nothing accumulates rounding the way a cells-per-pixel
conversion would. A nudge that would take the piece off the board is refused —
which is why `pick` grew a `clamp` argument: the lifted aim point lands off
the grid near the far edge, and without the clamp the ghost vanished for the
last two rows, which are somebody's home corner.

A mouse keeps aiming absolutely, with no lift: a cursor is one pixel and
covers nothing. Hovering stops when the piece settles (see below); a
held-button drag never does.

**The ghost freezes when you choose a square.** Without that, a mouse moving
towards the tick keeps re-aiming, and the piece lands where the BUTTON was
rather than where the player pointed. Aim → freeze → confirm, on both mouse
and touch, which is GO with me's rule and for the same reason.

**An icon is read by its silhouette.** The settings gear was a small circle
with eight spokes around it, which is a SUN — that is what every brightness
control looks like, and that is what players called it. A cog needs a toothed
outline and a hole.

**A piece is aimed by its CENTRE** (`originFor`). Hanging it off its top-left
corner means aiming with a square that, for an L or a V, is not part of the
piece — and it drifts under the finger when the piece is turned.

**The tray tells the camera how tall it is, and the chat how wide it is.**
`view.reserve(right, bottom)` is what stops the board being drawn underneath
them. It is measured from the DOM, not assumed: the strip changes with the
safe-area inset and with the screen's height.

**Orientation indices are part of the shared vocabulary.** The bot picks one
and the board draws it, so `ORIENTATIONS` must be built identically on every
client — it is derived from `BASE`, never authored, and the duplicates a
symmetric piece produces are dropped (a rotate button that cycles four
identical pictures looks broken).

**Every piece square is its own tile with a gap around it.** A pentomino drawn
as one smooth slab is a shape you cannot count, and counting it against the
piece in your hand is the whole game.

**The board draws only when it changes** — and the panels over it use
`backdrop-filter`, which samples a canvas that is not redrawing. That is what
`repaintSoon()` in main.ts is for. If a panel leaves a ghost of itself behind,
this is why.

**`let` that the render loop reads must be declared before the loop starts.**
The loop runs from the first frame, long before the rest of `start()` exists,
and a binding it touches too early is a `ReferenceError` that takes the whole
game down at boot with a blank screen. It happened twice in the Go game.

**Nothing here declares the `ai` capability** and nothing calls the platform's
runtime AI: the opponents are the local search in `bot.ts`. Multiplayer needs
no capability either, but it does need the host to have handed over a realtime
URL — signed out, or outside the platform, `umicat.rooms.available` is false
and the lobby says so instead of failing one button at a time.

## Decisions worth not relitigating

- **Scoring is squares placed**, as the 2D game counted. The official Blokus
  score is its mirror (minus one per square left, plus a bonus for going out);
  `squaresLeft` is already on screen, so it can be added without moving
  anything.
- **A skipped turn is silent.** Being told "you have no moves" once a round for
  the rest of a long game is the game nagging you about something you cannot do
  anything about. The scoreboard shows what everyone has left instead.
- **Passing asks first; placing does not** (the tick is already the asking).
- **Empty seats are bots, and the host runs them.** One machine, chosen by a
  rule every client works out the same way (first seat), because two clients
  each playing a bot's move would play two different ones.
- **A seat whose player has left becomes a bot.** The 2D game left the turn
  with them and the table stopped.
- **The bot level is a setting, not a property of the game**, and it can be
  changed mid-game: it is the position on the board that is already there, not
  the opponent.
- **Only solo games are saved.** An online game belongs to the room and to the
  people in it; restoring one from this side would put a board on screen that
  nobody else is sitting at.
- **Violet is the interface's colour** because blue, red, green and yellow are
  the players. A green button on this board would read as somebody's.

## Building and checking

```bash
npm run dev        # local dev server (no platform: rooms are unavailable)
npm run build      # what the platform runs
npm run typecheck
```

Probes drive the game through `window.__blokus`, which exposes the game, the
table, the view and the same functions the buttons call — `play(move)` goes
through the real aiming maths, so it tests that too. Driving it through pixels
would mean testing whether a click lands on a cell of a tilted board, which is
a test of the test. The probe scripts live in the session scratchpad.
