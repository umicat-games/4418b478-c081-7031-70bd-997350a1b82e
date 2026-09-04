import Phaser from 'phaser';
import { hudDpr, applyHudDpr } from '@umicat/phaser-sdk';

// High-DPI helpers (ADR-023). The game runs `highDpi: true`, so the canvas backing
// store is CSS×devicePixelRatio (crisp) and `scale.width/height` are DEVICE pixels.
// A fixed-pixel HUD scene keeps authoring in CSS-LOGICAL pixels and renders through
// a camera zoomed by dpr (`applyHudDpr` — zoom=dpr, origin top-left), so its absolute
// sizes look right AND get the extra pixels. Anywhere such a scene read `scale.width`
// as a CSS-px viewport dimension, it must read the LOGICAL width (÷dpr) instead.
//
// `hudDpr`/`applyHudDpr` come from the SDK (it applies the same to UmicatHud); these
// wrappers add the logical viewport dims a Catopia HUD scene positions against.

export { hudDpr, applyHudDpr };

/** Logical (CSS-px) viewport width for a HUD scene rendered through a dpr camera. */
export function hudLogicalW(scene: Phaser.Scene): number {
  return scene.scale.width / hudDpr(scene);
}

/** Logical (CSS-px) viewport height for a HUD scene rendered through a dpr camera. */
export function hudLogicalH(scene: Phaser.Scene): number {
  return scene.scale.height / hudDpr(scene);
}
