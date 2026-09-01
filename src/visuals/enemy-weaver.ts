// Bug-eyed diamond ship — the side-to-side weaving enemy.
import type { RenderScriptModule } from '@umicat/phaser-sdk';

export interface WeaverParams {
  bodyColor?: string;
  eyeColor?: string;
}

export const defaultParams: WeaverParams = {
  bodyColor: '#ff9f43',
  eyeColor: '#2d3436',
};

function parseHex(s: string): number {
  return parseInt(s.replace(/^#/, ''), 16);
}

export const render: RenderScriptModule<WeaverParams>['render'] = (g, params) => {
  g.clear();
  const body = parseHex(params.bodyColor ?? '#ff9f43');
  const eye = parseHex(params.eyeColor ?? '#2d3436');

  // Sweeping side fins (suggest lateral motion).
  g.fillStyle(0xffc776, 1);
  g.fillTriangle(-10, -4, -30, 10, -8, 16);
  g.fillTriangle(10, -4, 30, 10, 8, 16);
  g.lineStyle(2, 0x1c1c2e, 0.6);
  g.strokeTriangle(-10, -4, -30, 10, -8, 16);
  g.strokeTriangle(10, -4, 30, 10, 8, 16);

  // Diamond body.
  g.fillStyle(body, 1);
  g.fillTriangle(0, -22, -20, 6, 20, 6);
  g.fillTriangle(-20, 6, 20, 6, 0, 24);
  g.lineStyle(2.5, 0x1c1c2e, 0.75);
  g.strokeTriangle(0, -22, -20, 6, 20, 6);
  g.strokeTriangle(-20, 6, 20, 6, 0, 24);

  // Big single bug eye.
  g.fillStyle(0xffffff, 1);
  g.fillCircle(0, 0, 10);
  g.lineStyle(2, 0x1c1c2e, 0.6);
  g.strokeCircle(0, 0, 10);
  g.fillStyle(eye, 1);
  g.fillCircle(0, 1, 5.5);
  g.fillStyle(0xffffff, 0.9);
  g.fillCircle(-2, -1, 1.8);
};
