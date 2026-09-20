# Vendored: Stockfish 10 (WebAssembly)

`public/stockfish/` is Stockfish, unmodified, as built by
[stockfish.js](https://github.com/nmrugg/stockfish.js) — `npm view stockfish@10.0.2`.

| file | what |
| --- | --- |
| `stockfish.js` | 64KB of emscripten glue. Used as `new Worker(...)`; speaks UCI over `postMessage`. |
| `stockfish.wasm` | 360KB. The engine. |
| `COPYING.txt` | the GPL v3, which is what this is under. |
| `AUTHORS` | who wrote it. |

## Why this version and not a newer one

Stockfish 10 is the last release with a **classical evaluation** — no neural
network, so there is no weights file. Everything after it is NNUE, and the
smallest single-threaded NNUE build still needs `nn-5af11540bbfe.nnue`, which
is **38MB**. Measured, in this browser, on this build: depth 14 on a middlegame
position in 500ms, 1.38M nodes/s. Around 3200 Elo. The problem this game has is
making it play WORSE, not better, so a newer engine buys nothing and costs a
38MB download.

It is also single-threaded (`Threads` is `min 1 max 1` in its own option list),
which is not a limitation here but a match: threaded wasm needs
`SharedArrayBuffer`, which needs cross-origin isolation, which a game iframe
served from the CDN does not have.

## The licence, and what it means here

Stockfish is **GPL-3.0**. It is kept here unmodified, in its own directory,
with its licence beside it, and the game talks to it over UCI across a Worker
message boundary — the same arm's-length arrangement every chess GUI that
bundles Stockfish uses. Do not edit these files; if a newer engine is ever
wanted, replace the directory wholesale and update this note.

## Updating

```sh
npm pack stockfish@10.0.2
tar xzf stockfish-10.0.2.tgz
cp package/src/stockfish.js package/src/stockfish.wasm public/stockfish/
cp package/Copying.txt public/stockfish/COPYING.txt
```
