# Othello with me

Reversi against an engine, with an AI assistant beside the board.

```bash
npm install
npm run dev
npm run verify   # perft + the referee's own tests
```

`src/shell/` is shared machinery from the board-game template and is not meant
to be edited; `src/game/` is Othello. `CLAUDE.md` is the working memory of this
repo: read it first.
