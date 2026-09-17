# Balaboo

A tower defence you **walk around in**. You are not a cursor over a map — you
are a character on the board, and a tower can only be built where you are
standing. Everything else follows from that: what a defence costs is not gold,
it is the walk.

Game id `d25d06c2-0ae4-4083-8eff-ded32d3125aa`. Built on `@umicat/three-sdk`.

```
@umicat/platform-sdk     identity · saves · gameData · rooms · ai · voice · dialogue
        ▲
@umicat/three-sdk        scene3d · loader · physics · character · input · audio
        ▲
     Balaboo             the village, the boards, and the run between them
```

```
npm install
npm run scene        # regenerate the boards and the village from their polylines
npx tsc --noEmit
npx vite build
./deploy-preview.sh  # dist/ → S3 + CloudFront, as this game's in-editor preview
```

`./deploy-preview.sh` is a **temporary override** of the preview: any workspace
rebuild wipes it out, so always commit as well as deploy.

**`CLAUDE.md` is the one to read.** It is the memory of what has been built and
why — every decision here was made against something measured, and the reasons
are the part that does not survive in the code. Start with *The shape of a
session*, *The controls, as they stand*, and *Where things are*.

`ASSETS.md` covers where the art comes from and what may be done with it.

> This file used to be the 3D TEMPLATE's README, inherited when the game was
> forked from it — it described this repo as "the starter a 3D game is forked
> from", with a status section about work that had since shipped. A README that
> describes a different repository is worse than none: it is the first thing
> read and the last thing updated. The same thing happened to `CLAUDE.md`, which
> described the arena brawler this game started as long after it had become a
> tower defence.
