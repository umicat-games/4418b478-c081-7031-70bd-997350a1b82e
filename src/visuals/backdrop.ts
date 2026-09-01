// Full-canvas backdrop — cheerful gradient sky/space blend with a few soft
// stars, clouds and distant planets. Purely decorative, fully static (no
// per-frame motion — see the no-idle-motion rule).
import type { RenderScriptModule } from '@umicat/phaser-sdk';

export interface BackdropParams {
  width?: number;
  height?: number;
  topColor?: string;
  bottomColor?: string;
}

export const defaultParams: BackdropParams = {
  width: 720,
  height: 1280,
  topColor: '#8ecbff',
  bottomColor: '#241a52',
};

// Deterministic PRNG (mulberry32) — same seed always yields the same
// "random" star field, keeping the render idempotent.
function mulberry32(seed: number): () => number {
  let a = seed;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function parseHex(s: string): number {
  return parseInt(s.replace(/^#/, ''), 16);
}

export const render: RenderScriptModule<BackdropParams>['render'] = (g, params) => {
  g.clear();
  const w = params.width ?? 720;
  const h = params.height ?? 1280;
  const top = parseHex(params.topColor ?? '#8ecbff');
  const bottom = parseHex(params.bottomColor ?? '#241a52');

  // Vertical gradient fill, drawn centered on the entity origin.
  g.fillGradientStyle(top, top, bottom, bottom, 1);
  g.fillRect(-w / 2, -h / 2, w, h);

  const rand = mulberry32(1337);

  // Soft distant planets first (so stars/clouds sit above them).
  const planets = [
    { x: -w * 0.28, y: -h * 0.32, r: 70, color: 0xff9f9f, alpha: 0.22 },
    { x: w * 0.32, y: -h * 0.08, r: 46, color: 0xffe08a, alpha: 0.2 },
    { x: -w * 0.12, y: h * 0.22, r: 90, color: 0x9ad1ff, alpha: 0.14 },
  ];
  for (const p of planets) {
    g.fillStyle(p.color, p.alpha);
    g.fillCircle(p.x, p.y, p.r);
  }

  // Soft cloud-like blobs (overlapping translucent circles).
  g.fillStyle(0xffffff, 0.1);
  const cloudSpots = [
    [-w * 0.2, -h * 0.1],
    [w * 0.1, h * 0.05],
    [-w * 0.05, h * 0.35],
  ];
  for (const [cx, cy] of cloudSpots) {
    g.fillCircle(cx, cy, 60);
    g.fillCircle(cx + 40, cy + 8, 44);
    g.fillCircle(cx - 36, cy + 10, 40);
  }

  // Scattered small stars, seeded for stability.
  for (let i = 0; i < 46; i++) {
    const sx = (rand() - 0.5) * w;
    const sy = (rand() - 0.5) * h;
    const r = 1.2 + rand() * 2.2;
    const bright = 0.35 + rand() * 0.5;
    g.fillStyle(0xffffff, bright);
    g.fillCircle(sx, sy, r);
  }
};
