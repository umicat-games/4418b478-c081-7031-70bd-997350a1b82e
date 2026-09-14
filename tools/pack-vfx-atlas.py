#!/usr/bin/env python3
"""
Build `public/vfx/particles.png` from Kenney's Particle Pack.

WHY THIS FILE EXISTS. The atlas was packed once by a script nobody kept, and
recovering the mapping meant comparing all sixteen cells pixel-by-pixel against
ninety-odd source files to work out which was which. That is an afternoon to
answer a question a table answers. The table is below; this script is what
turns it back into the PNG.

Python rather than `.mjs` like the rest of `tools/`: the project has no image
library, and adding a native one to a game repo for a tool that runs twice a
year is the worse trade. Needs Pillow (`pip install pillow`).

    npm run atlas

THE TRANSPARENT SET, not the black-background one. Additive blending hides a
black background anyway, but alpha is what stops the CORNERS of a quad glowing —
with the opaque set every particle is a faintly lit square.

Frame order is the atlas's contract: `FRAME` in `src/vfx.ts` indexes these by
position, so REORDERING THIS LIST SILENTLY CHANGES EVERY EFFECT IN THE GAME.
Append, or swap deliberately, and update `FRAME` in the same commit.
"""
import os
import sys

try:
    from PIL import Image
except ImportError:
    sys.exit('needs Pillow:  pip install pillow')

SRC = os.environ.get(
    'KENNEY_PARTICLES',
    '/Users/yuantaoliu/work/game-assets/Kenney Game Assets All-in-1 3.4.0'
    '/2D assets/Particle Pack/PNG (Transparent)',
)
OUT = os.path.join(os.path.dirname(__file__), '..', 'public', 'vfx', 'particles.png')

COLS = 4
CELL = 256

# index -> (FRAME name, source file). The name is documentation: the code reads
# `FRAME.flameA`, and this is the only place that says what flameA actually is.
FRAMES = [
    ('boltA',      'spark_05.png'),    # forked lightning — the strike itself
    ('boltB',      'spark_06.png'),
    ('strandA',    'trace_03.png'),    # thin electric threads, the flicker frames
    ('strandB',    'trace_04.png'),
    ('flameA',     'flame_05.png'),    # a real tongue of fire, tip curling
    ('flameB',     'flame_06.png'),
    ('glowRing',   'light_02.png'),    # soft ring racing out along the ground
    ('runeRing',   'magic_01.png'),    # pentagon of nodes
    ('runeCircle', 'magic_02.png'),    # circle of nodes
    ('flare',      'flare_01.png'),    # the flash at the middle
    ('sparkle',    'star_04.png'),     # what `motes` wears
    ('starBurst',  'magic_05.png'),
    ('scorch',     'scorch_01.png'),   # the mark fire leaves behind
    ('burst',      'muzzle_01.png'),   # a cone of flame — a muzzle flash, used as one
    ('iceShard',   'star_08.png'),     # a hard X of spikes: frost, not a sparkle
    ('frostRing',  'circle_03.png'),   # a CRISP ring, where glowRing is a soft one
]

# `arcA`/`arcB` (spark_01/02, sheet discharge) and `twirl`/`slash` sat in cells
# 4, 5, 14 and 15 and were never drawn once. Fire and ice needed shapes of their
# own far more than the atlas needed four unused ones — three elements that all
# throw lightning are one element in three colours.

def main() -> None:
    if not os.path.isdir(SRC):
        sys.exit(f'source pack not found: {SRC}\nset KENNEY_PARTICLES to its PNG (Transparent) folder')
    rows = (len(FRAMES) + COLS - 1) // COLS
    out = Image.new('RGBA', (COLS * CELL, rows * CELL), (0, 0, 0, 0))
    for i, (name, fname) in enumerate(FRAMES):
        path = os.path.join(SRC, fname)
        if not os.path.isfile(path):
            sys.exit(f'missing {fname} (for FRAME.{name})')
        im = Image.open(path).convert('RGBA')
        if im.size != (CELL, CELL):
            im = im.resize((CELL, CELL), Image.LANCZOS)
        out.paste(im, ((i % COLS) * CELL, (i // COLS) * CELL))
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    out.save(OUT)
    print(f'{os.path.relpath(OUT)}: {COLS}x{rows} of {CELL}px, {len(FRAMES)} frames')
    for i, (name, fname) in enumerate(FRAMES):
        print(f'  {i:2d}  {name:<11} {fname}')


if __name__ == '__main__':
    main()
