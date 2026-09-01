// Big armored alien brute — the tougher, mini-milestone enemy.
import type { RenderScriptModule } from '@umicat/phaser-sdk';

export interface BruteParams {
  bodyColor?: string;
  plateColor?: string;
  coreColor?: string;
}

export const defaultParams: BruteParams = {
  bodyColor: '#b06bff',
  plateColor: '#7a3fd6',
  coreColor: '#ff4d6d',
};

function parseHex(s: string): number {
  return parseInt(s.replace(/^#/, ''), 16);
}

export const render: RenderScriptModule<BruteParams>['render'] = (g, params) => {
  g.clear();
  const body = parseHex(params.bodyColor ?? '#b06bff');
  const plate = parseHex(params.plateColor ?? '#7a3fd6');
  const core = parseHex(params.coreColor ?? '#ff4d6d');

  // Wide hull.
  g.fillStyle(body, 1);
  g.fillRoundedRect(-42, -18, 84, 46, 16);
  g.lineStyle(3, 0x1c1c2e, 0.75);
  g.strokeRoundedRect(-42, -18, 84, 46, 16);

  // Armor plates.
  g.fillStyle(plate, 1);
  g.fillRoundedRect(-36, -12, 24, 20, 6);
  g.fillRoundedRect(12, -12, 24, 20, 6);
  g.lineStyle(2, 0x1c1c2e, 0.6);
  g.strokeRoundedRect(-36, -12, 24, 20, 6);
  g.strokeRoundedRect(12, -12, 24, 20, 6);

  // Spikes on the sides.
  g.fillStyle(plate, 1);
  g.fillTriangle(-42, -6, -54, 0, -42, 8);
  g.fillTriangle(42, -6, 54, 0, 42, 8);

  // Lower fin / thruster housing.
  g.fillStyle(plate, 1);
  g.fillTriangle(-16, 28, 16, 28, 0, 42);
  g.lineStyle(2, 0x1c1c2e, 0.6);
  g.strokeTriangle(-16, 28, 16, 28, 0, 42);

  // Glowing core eye.
  g.fillStyle(0x1c1c2e, 1);
  g.fillCircle(0, 0, 14);
  g.fillStyle(core, 1);
  g.fillCircle(0, 0, 10);
  g.fillStyle(0xffffff, 0.85);
  g.fillCircle(-3, -3, 3);
};
