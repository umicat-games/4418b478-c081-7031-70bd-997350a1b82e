# Where everything in `public/` comes from

| path | what | licence |
| --- | --- | --- |
| `stockfish/` | the chess engine, vendored unmodified — see `vendor/VENDOR.md` | **GPL-3.0** |
| `audio/piece-1..3.ogg` | a piece being set down. Kenney, Casino Audio | CC0 |
| `audio/capture.ogg` | a piece coming off the board. Kenney | CC0 |
| `audio/ui-press.ogg` | the click under every button. Kenney, Interface Sounds | CC0 |
| `audio/denied.ogg` | a move the rules will not take. Kenney | CC0 |
| `audio/win.ogg` | the end of a game. Kenney | CC0 |
| `audio/bgm.mp3` | the music | see `audio/CREDITS.md` |
| `playbooks/coach.md` | the companion's persona, as editable prose | ours |

**There are no piece models and there is no board texture file.** The pieces
are lathe profiles in `src/view/pieces.ts` and the board is painted into a
canvas at runtime in `src/view/board3d.ts`. That is deliberate — see the note
at the top of `pieces.ts`.

The 3D template this game was forked from shipped a platformer kit
(`public/kit/`, a character model, three example scenes). None of it was ever
used here and all of it is gone; if you are looking for it, it is in
`template-3d`.
