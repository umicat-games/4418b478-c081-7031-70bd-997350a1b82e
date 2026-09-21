# Xiangqi with me

Chinese chess against an engine, with an AI assistant beside the board.

- The rules live in `src/xiangqi/rules.ts` and are verified by `npm run verify`
  (perft against the published counts, plus the rules perft cannot reach).
- The opponent is a small alpha-beta search of our own — see `CLAUDE.md` for
  why it is not Pikafish.
- The assistant talks, points and counts; it never moves a piece.

```bash
npm install
npm run dev
```

`CLAUDE.md` is the working memory of this repo: read it first.
