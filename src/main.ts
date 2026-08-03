import { createUmicatGame } from '@umicat/phaser-sdk';
import { BootScene } from './scenes/BootScene';
import { BootMenuScene } from './scenes/BootMenuScene';
import { SettingsScene } from './scenes/SettingsScene';
import { GameScene } from './scenes/GameScene';
import { CursorScene } from './scenes/CursorScene';
import { HotbarScene } from './scenes/HotbarScene';
import { WeatherScene } from './scenes/WeatherScene';
import { PaletteScene } from './scenes/PaletteScene';
import { ConfirmScene } from './scenes/ConfirmScene';
import { ReceiptScene } from './scenes/ReceiptScene';
import { CraftScene } from './scenes/CraftScene';
import { ChatterScene } from './scenes/ChatterScene';
import { MenuScene } from './scenes/MenuScene';
import { DialogueScene } from './scenes/DialogueScene';
import { GAME_WIDTH, GAME_HEIGHT, DESIGN_ZOOM } from './config';
import { renderScripts } from './visuals';

function startGame(): void {
  createUmicatGame({
    width: GAME_WIDTH,
    height: GAME_HEIGHT,
    // RESIZE: the canvas fills the screen edge-to-edge (no letterbox) — Catopia's
    // world is bigger than the camera and you pan around it, so there's no fixed
    // viewport; the camera just shows whatever fits, and the HUD is anchor-based.
    // GameScene reflows on scale 'resize' (adaptive integer zoom + re-centre).
    // width/height stay the DESIGN reference for the zoom baseline.
    scaleMode: 'resize',
    // The adaptive-zoom reference (GameScene.computeZoom targets it). Tells the
    // editor's "Camera screen" rect to show the DESIGN view (1280/3 × 720/3 =
    // 427×240) instead of the arbitrary editor-canvas size at the drifted zoom.
    referenceZoom: DESIGN_ZOOM,
    // Pixel-art rendering: NEAREST texture sampling (antialias off). REQUIRED for
    // a tile-based pixel game — without it Phaser uses LINEAR sampling, which
    // bleeds neighbouring/transparent texels at tile edges whenever the camera
    // sits on a sub-pixel scroll (e.g. mid edge-scroll), drawing a 1px seam line
    // across a whole tile row. roundPixels alone can't fix it (it aligns vertices,
    // not UV sampling). pixelArt:true also crisps up the sprites at integer zoom.
    pixelArt: true,
    // CursorScene is registered but not auto-started (only the first scene is);
    // GameScene launches it after the HUD exists so it sits on top.
    // HotbarScene (bottom tool hotbar) + CursorScene are registered but not
    // auto-started; GameScene launches them after the HUD exists so they layer
    // above it (cursor stays topmost — see CursorScene.update bringToTop).
    scenes: [BootScene, BootMenuScene, SettingsScene, GameScene, HotbarScene, WeatherScene, PaletteScene, ConfirmScene, ReceiptScene, ChatterScene, MenuScene, CraftScene, DialogueScene, CursorScene],
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
