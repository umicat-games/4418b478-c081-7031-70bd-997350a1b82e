import type { RenderScriptModule } from '@umicat/phaser-sdk';

export interface PlayerParams {
  color?: string;
  accent?: string;
  engineColor?: string;
}

export const defaultParams: PlayerParams = {
  color: '#00ccff',
  accent: '#ff6600',
  engineColor: '#ff8800',
};

function hex(s: string): number {
  return parseInt(s.replace(/^#/, ''), 16);
}

/**
 * Modern triangle spacecraft pointing RIGHT (positive X).
 * Rotation 0 = facing right, which matches Math.atan2 naturally.
 * Bounding box: width=48, height=40 (coords span ~-20..+22 × -17..+17).
 */
export const render: RenderScriptModule<PlayerParams>['render'] = (g, params) => {
  g.clear();

  const mainCol    = hex(params.color       ?? '#00ccff');
  const accentCol  = hex(params.accent      ?? '#ff6600');
  const engineCol  = hex(params.engineColor ?? '#ff8800');

  // ── Engine exhausts (behind hull so hull renders on top) ──────────────
  g.fillStyle(engineCol, 0.95);
  g.fillEllipse(-20, -9, 10, 7);
  g.fillEllipse(-20,  9, 10, 7);

  g.fillStyle(0xffee44, 1);
  g.fillEllipse(-20, -9, 5, 4);
  g.fillEllipse(-20,  9, 5, 4);

  // ── Main hull (triangle, tip pointing right) ──────────────────────────
  g.fillStyle(mainCol, 1);
  g.fillTriangle(22, 0,  -12, -17,  -12, 17);

  // ── Wing accent panels ────────────────────────────────────────────────
  g.fillStyle(accentCol, 1);
  g.fillTriangle(-12, -17,  -4, -17,  -14, -8);
  g.fillTriangle(-12,  17,  -4,  17,  -14,  8);

  // ── Hull centre stripe ────────────────────────────────────────────────
  g.lineStyle(1, 0x66ddff, 0.45);
  g.beginPath();
  g.moveTo(-10, 0);
  g.lineTo(15, 0);
  g.strokePath();

  // ── Cockpit canopy (dark) ─────────────────────────────────────────────
  g.fillStyle(0x001133, 1);
  g.fillEllipse(8, 0, 16, 11);

  // ── Cockpit window (glow) ─────────────────────────────────────────────
  g.fillStyle(0x44eeff, 0.9);
  g.fillEllipse(7, -1, 9, 6);
};
