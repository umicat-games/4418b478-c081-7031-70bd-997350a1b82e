#!/usr/bin/env python3
"""Pack the effect atlas from Kenney's Particle Pack.

`public/vfx/particles.png` was hand-assembled once and the recipe was not
written down, which meant the only way to find out what was in it was to match
every cell back against 96 source files pixel by pixel. So: this script IS the
recipe, and the order below is the `FRAME` table in `src/vfx.ts`. Change one
and change the other.

    python3 tools/pack-vfx.py        # or: npm run vfx

Source: Kenney Game Assets All-in-1, "2D assets/Particle Pack/PNG
(Transparent)" — CC0. The TRANSPARENT set, not the black-background one: these
are drawn with additive blending, where a black background is invisible anyway
but the alpha is what stops a quad's corners from glowing.

Needs Pillow (`pip3 install pillow`). It is a build-time tool run by hand when
the sheet changes, not part of `vite build`.
"""
import os
import sys

from PIL import Image

KIT = os.environ.get(
    'KENNEY',
    os.path.expanduser(
        '~/work/game-assets/Kenney Game Assets All-in-1 3.4.0'
        '/2D assets/Particle Pack/PNG (Transparent)'),
)
OUT = os.path.join(os.path.dirname(__file__), '..', 'public', 'vfx', 'particles.png')
CELL = 256
COLS = 4

# Reading order, left to right and top to bottom — the `FRAME` table.
FRAMES = [
    ('boltA',      'spark_05.png'),   # forked lightning, the main bolt
    ('boltB',      'spark_06.png'),   # ditto, a different fork
    ('strandA',    'trace_03.png'),   # a thin strand, for the in-between frames
    ('strandB',    'trace_04.png'),
    ('arcA',       'spark_01.png'),   # a ragged sheet of discharge
    ('arcB',       'spark_02.png'),
    ('glowRing',   'light_02.png'),   # soft ring — the shockwave on the ground
    ('runeRing',   'magic_01.png'),   # pentagon with nodes
    ('runeCircle', 'magic_02.png'),   # circle with nodes — the spell circle
    ('flare',      'flare_01.png'),   # the flash at the centre
    ('sparkle',    'star_04.png'),    # four-point star — sparks and motes
    ('starBurst',  'magic_05.png'),
    ('scorch',     'scorch_01.png'),  # a mark left behind
    ('burst',      'muzzle_01.png'),  # a short cone, for muzzles and impacts
    ('twirl',      'twirl_01.png'),
    ('slash',      'slash_01.png'),   # a crescent, for melee arcs
]


def main() -> int:
    if not os.path.isdir(KIT):
        print(f'not found: {KIT}\nset KENNEY=<path to PNG (Transparent)>', file=sys.stderr)
        return 1
    rows = (len(FRAMES) + COLS - 1) // COLS
    sheet = Image.new('RGBA', (COLS * CELL, rows * CELL), (0, 0, 0, 0))
    for i, (name, src) in enumerate(FRAMES):
        path = os.path.join(KIT, src)
        if not os.path.exists(path):
            print(f'missing {src} for frame {i} ({name})', file=sys.stderr)
            return 1
        im = Image.open(path).convert('RGBA')
        if im.size != (CELL, CELL):
            im = im.resize((CELL, CELL), Image.LANCZOS)
        sheet.paste(im, ((i % COLS) * CELL, (i // COLS) * CELL))
    sheet.save(OUT, optimize=True)
    print(f'{OUT} — {COLS}x{rows} of {CELL}px, {os.path.getsize(OUT) // 1024}KB')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
