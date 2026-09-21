# Where everything in `public/` comes from

| path | what | licence |
| --- | --- | --- |
| `audio/piece-1..3.ogg` | a tile being set down. Kenney, *Casino Audio* (`chip-lay-1/2/3`) | CC0 |
| `audio/ui-press.ogg` | the click under every button. Kenney, *Interface Sounds* (`click_001`) | CC0 |
| `audio/denied.ogg` | a square the rules will not take. Kenney, *Interface Sounds* (`error_002`) | CC0 |
| `audio/win.ogg` | the end of a game. Kenney, *Interface Sounds* (`confirmation_002`) | CC0 |
| `audio/bgm.mp3` | the music — the track commissioned for GO with me, shared by the three board games | ours |

**There are no models and there is no board texture file.** A piece is a
rounded box per square (`RoundedBoxGeometry`), and the board's grid, rim and
four coloured starting corners are painted into a canvas at runtime in
`src/view/board3d.ts`. That is deliberate: the board is a grid and the pieces
are cubes, so a modelling tool would add a pipeline and a download without
adding anything you could see.

The 3D template this game was forked from shipped a platformer kit
(`public/kit/`, a character model, three example scenes). None of it was ever
used here and all of it is gone; if you are looking for it, it is in
`template-3d`.
