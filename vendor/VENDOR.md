# Vendored code

## The Go engine — `src/engine/`

KataGo's neural network and search, running in the browser. Taken from
**web-katrain** (<https://github.com/Sir-Teo/web-katrain>, MIT — the licence is
beside this file as `LICENSE.web-katrain`), which is where the hard parts were
already solved: a parser for KataGo's own `.bin` model format (versions 8–16),
the v7 input planes, and a PUCT search ported from KataGo's C++ rather than a
generic MCTS loop.

Copied, not depended on: it is not published as a package, and only the engine
subtree is wanted — none of its React UI.

| taken | from |
| --- | --- |
| `src/engine/katago/` | `src/engine/katago/` |
| `src/engine/utils/` | `src/utils/` (the eight files the engine imports) |
| `src/engine/lib/gtp.ts` | `src/lib/gtp.ts` |
| `src/engine/types.ts` | `src/types.ts` |

**This copy is frozen.** It is not tracked against upstream, and it should not
be edited except for the reasons below. The game talks to it through
`src/go/opponent.ts` and nowhere else, so a future swap has one seam.

### Edits made, and why

Every one is marked in the source with `VENDOR EDIT`.

1. **Import paths** — `../../types` became `../types` etc., because the subtree
   sits one level shallower here than it did upstream.

2. **The WebGPU backend is gone** (`worker.ts`). It was a static import, so it
   was in the bundle whether or not it ran. Measured: single-threaded wasm does
   9x9 at 400 visits in about half a second on a laptop, which is already more
   thinking than this game asks for, and dropping WebGPU removes a whole class
   of device-specific failure (drivers, immature mobile support) along with
   ~40KB gzipped.

3. **The tfjs wasm binaries are resolved by the bundler** (`worker.ts`), through
   `?url` imports, instead of being copied into `public/tfjs/` by a script.
   Vite then gives them hashed filenames, so they can be cached immutably and
   there is no copy step that can be forgotten.

4. **`LegacyGameEncoding`** (`types.ts`) is a local `string` alias. Upstream
   imports it from its SGF/GIB import module, which is not vendored; nothing in
   the engine reads the field.

### Threads

Threaded wasm needs `SharedArrayBuffer`, which needs the page to be
cross-origin isolated (`COOP` + `COEP`). A game runs in an iframe served from
`cdn.umicat.ai` inside `umicat.ai` and the platform sends neither header, so
the engine is single-threaded here. It is fast enough; do not go looking for
`setThreadsCount` to fix a slow board.

## The network — not in this repo

`g170-b6c96-s175395328-d26788732.bin.gz`, 3.7MB, from KataGo's own test models
(the g170 run, CC0). It lives on the CDN at
`https://cdn.umicat.ai/shared/katago/g170-b6c96.bin.gz` and is fetched at
runtime — see `MODEL_URL` in `src/go/opponent.ts`.

**Deliberately not committed.** Every game in this account shares one git
repository, one branch per game, and a multi-megabyte binary would sit in that
history for good and be re-cloned by every workspace rebuild for ever after.
`npm run dev` reads a local copy from `public/models/` (gitignored); fetch it
with:

```sh
curl -Lo public/models/katago-small.bin.gz \
  https://raw.githubusercontent.com/lightvector/KataGo/master/cpp/tests/models/g170-b6c96-s175395328-d26788732.bin.gz
```
