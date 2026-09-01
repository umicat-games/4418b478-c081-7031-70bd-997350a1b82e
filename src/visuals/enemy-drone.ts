// Cute round alien saucer — the basic, straight-falling enemy.
import type { RenderScriptModule } from '@umicat/phaser-sdk';

export interface DroneParams {
  bodyColor?: string;
  domeColor?: string;
}

export const defaultParams: DroneParams = {
  bodyColor: '#7ee787',
  domeColor: '#ffe066',
};

function parseHex(s: string): number {
  return parseInt(s.replace(/^#/, ''), 16);
}

export const render: RenderScriptModule<DroneParams>['render'] = (g, params) => {
  g.clear();
  const body = parseHex(params.bodyColor ?? '#7ee787');
  const dome = parseHex(params.domeColor ?? '#ffe066');

  // Saucer base.
  g.fillStyle(body, 1);
  g.fillEllipse(0, 6, 26, 12);
  g.lineStyle(2.5, 0x1c1c2e, 0.7);
  g.strokeEllipse(0, 6, 26, 12);

  // Little side fins.
  g.fillStyle(body, 1);
  g.fillTriangle(-24, 6, -14, -2, -14, 12);
  g.fillTriangle(24, 6, 14, -2, 14, 12);
  g.lineStyle(2, 0x1c1c2e, 0.6);
  g.strokeTriangle(-24, 6, -14, -2, -14, 12);
  g.strokeTriangle(24, 6, 14, -2, 14, 12);

  // Dome.
  g.fillStyle(dome, 1);
  g.fillEllipse(0, -6, 16, 14);
  g.lineStyle(2.5, 0x1c1c2e, 0.7);
  g.strokeEllipse(0, -6, 16, 14);

  // Cute eyes.
  g.fillStyle(0x1c1c2e, 1);
  g.fillCircle(-5, -6, 2.4);
  g.fillCircle(5, -6, 2.4);

  // Under-lights.
  g.fillStyle(0xffffff, 0.8);
  g.fillCircle(-14, 8, 2);
  g.fillCircle(0, 11, 2);
  g.fillCircle(14, 8, 2);
};
