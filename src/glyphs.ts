import * as THREE from 'three';
import type { Glyph } from './gesture/recognize';

/**
 * How each glyph looks — one definition, used by the tile faces, the HUD chips
 * and the lab.
 *
 * The face of a tile shows the exact mark the player has to draw. That is the
 * whole tutorial: nothing has to explain which gesture belongs to which tile
 * because the tile is wearing it, which is also why the marks are drawn from the
 * same path data rather than reproduced by hand per surface — a HUD chip that
 * disagrees with the tile face by even a little teaches the wrong stroke.
 */

export const GLYPH_COLOR: Record<Glyph, string> = {
  circle: '#3fa2f5',
  chevron: '#f5c03f',
  cross: '#f56a4a',
  wave: '#48d391',
};

const INK = '#141922';

/** Stroked on a 100×100 box, so one set of numbers drives canvas and SVG. */
type Draw = (p: {
  move: (x: number, y: number) => void;
  line: (x: number, y: number) => void;
  arc: (cx: number, cy: number, r: number) => void;
  curve: (c1x: number, c1y: number, c2x: number, c2y: number, x: number, y: number) => void;
}) => void;

const SHAPE: Record<Glyph, Draw> = {
  circle: (p) => p.arc(50, 50, 31),
  chevron: (p) => { p.move(19, 66); p.line(50, 30); p.line(81, 66); },
  cross: (p) => { p.move(24, 24); p.line(76, 76); p.move(76, 24); p.line(24, 76); },
  wave: (p) => {
    p.move(16, 50);
    p.curve(27, 26, 39, 26, 50, 50);
    p.curve(61, 74, 73, 74, 84, 50);
  },
};

export function glyphSvg(g: Glyph, stroke = INK, width = 9): string {
  let d = '';
  SHAPE[g]({
    move: (x, y) => { d += `M${x} ${y} `; },
    line: (x, y) => { d += `L${x} ${y} `; },
    arc: (cx, cy, r) => { d += `M${cx - r} ${cy} a${r} ${r} 0 1 0 ${r * 2} 0 a${r} ${r} 0 1 0 ${-r * 2} 0 `; },
    curve: (a, b, c, e, x, y) => { d += `C${a} ${b} ${c} ${e} ${x} ${y} `; },
  });
  return `<svg viewBox="0 0 100 100" aria-label="${g}"><path d="${d}" fill="none" stroke="${stroke}"
    stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
}

const cache = new Map<Glyph, THREE.CanvasTexture>();

/** The front face of a tile. */
export function glyphTexture(g: Glyph): THREE.CanvasTexture {
  const hit = cache.get(g);
  if (hit) return hit;
  const S = 256;
  const cv = document.createElement('canvas');
  cv.width = cv.height = S;
  const c = cv.getContext('2d')!;
  const k = S / 100;

  c.fillStyle = GLYPH_COLOR[g];
  c.fillRect(0, 0, S, S);
  // A lit top edge and a shaded bottom one. The board is lit from the front, so
  // without this every face is one flat colour and the grid reads as a texture
  // rather than as a wall of separate objects.
  const grad = c.createLinearGradient(0, 0, 0, S);
  grad.addColorStop(0, 'rgba(255,255,255,0.20)');
  grad.addColorStop(0.55, 'rgba(255,255,255,0)');
  grad.addColorStop(1, 'rgba(0,0,0,0.18)');
  c.fillStyle = grad;
  c.fillRect(0, 0, S, S);

  c.strokeStyle = INK;
  c.lineWidth = 9 * k;
  c.lineCap = 'round';
  c.lineJoin = 'round';
  c.beginPath();
  SHAPE[g]({
    move: (x, y) => c.moveTo(x * k, y * k),
    line: (x, y) => c.lineTo(x * k, y * k),
    arc: (cx, cy, r) => c.arc(cx * k, cy * k, r * k, 0, Math.PI * 2),
    curve: (a, b, d, e, x, y) => c.bezierCurveTo(a * k, b * k, d * k, e * k, x * k, y * k),
  });
  c.stroke();

  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  cache.set(g, tex);
  return tex;
}

export function darker(hex: string, k: number): THREE.Color {
  return new THREE.Color(hex).multiplyScalar(k);
}
