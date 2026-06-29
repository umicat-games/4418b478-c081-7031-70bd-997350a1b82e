import { createUmicatGame, Umicat } from '@umicat/phaser-sdk';
import { BootScene } from './scenes/BootScene';
import { GameScene } from './scenes/GameScene';
import { TitleScene } from './scenes/TitleScene';
import { GAME_WIDTH, GAME_HEIGHT } from './config';
import { renderScripts } from './visuals';

// Platform services — available across all scenes
export const umicatReady = Umicat.init({ standaloneGameId: 'star-siege' }).catch(() => null);

function startGame(): void {
  createUmicatGame({
    width: GAME_WIDTH,
    height: GAME_HEIGHT,
    scenes: [BootScene, TitleScene, GameScene],
    renderScripts,
  });
}

// Why fonts load BEFORE boot: Phaser bakes text into a canvas texture at
// creation time — if a font isn't loaded yet it renders the fallback and never
// refreshes. So both loaders below resolve their fonts, THEN startGame().

/**
 * User-IMPORTED fonts (uploaded .ttf/.otf/.woff/.woff2). Declared in
 * `public/uploaded/fonts.json` (written by the asset import flow) and loaded
 * via the FontFace API. Usable as `fontFamily: '<family>'`.
 *
 * fonts.json shape: [{ "family": "my_font", "file": "my_font.ttf" }]
 */
async function loadUploadedFonts(): Promise<void> {
  let entries: Array<{ family: string; file: string }> = [];
  try {
    const res = await fetch('uploaded/fonts.json', { cache: 'no-store' });
    if (res.ok) {
      const parsed: unknown = await res.json();
      if (Array.isArray(parsed)) entries = parsed as Array<{ family: string; file: string }>;
    }
  } catch {
    /* no fonts.json — the common case, nothing to load */
  }

  await Promise.all(
    entries.map(async ({ family, file }) => {
      try {
        const face = new FontFace(family, `url(uploaded/${file})`);
        await face.load();
        (document.fonts as FontFaceSet).add(face);
      } catch (e) {
        console.warn(`[umicat] failed to load font "${family}" (${file})`, e);
      }
    }),
  );
}

/**
 * GOOGLE web fonts. Declared in `public/webfonts.json` — a JSON array of
 * family names, e.g. ["Bangers", "Press Start 2P"]. We inject the Google Fonts
 * stylesheet, then force the actual font files to fetch with
 * `document.fonts.load()` and await them (document.fonts.ready alone wouldn't,
 * since nothing uses the family yet at boot). Usable as `fontFamily: '<family>'`.
 * Network / parse failures are non-fatal.
 */
async function loadWebFonts(): Promise<void> {
  let families: string[] = [];
  try {
    const res = await fetch('webfonts.json', { cache: 'no-store' });
    if (res.ok) {
      const parsed: unknown = await res.json();
      if (Array.isArray(parsed)) families = parsed.filter((f): f is string => typeof f === 'string');
    }
  } catch {
    /* no webfonts.json — the common case */
  }
  if (families.length === 0) return;

  const href =
    'https://fonts.googleapis.com/css2?' +
    families.map((f) => 'family=' + encodeURIComponent(f).replace(/%20/g, '+')).join('&') +
    '&display=swap';
  await new Promise<void>((resolve) => {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = href;
    link.onload = () => resolve();
    link.onerror = () => resolve(); // non-fatal — boot with the system font
    document.head.appendChild(link);
  });

  await Promise.all(
    families.map((f) =>
      (document.fonts as FontFaceSet).load(`1em "${f}"`).catch((e) => {
        console.warn(`[umicat] failed to load web font "${f}"`, e);
      }),
    ),
  );
}

Promise.allSettled([loadUploadedFonts(), loadWebFonts()]).finally(startGame);
