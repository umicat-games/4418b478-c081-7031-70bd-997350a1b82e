// Enemy laser bolt — warm danger color, travels downward.
import type { RenderScriptModule } from '@umicat/phaser-sdk';

export interface BoltParams {
  color?: string;
}

export const defaultParams: BoltParams = {
  color: '#ff5566',
};

function parseHex(s: string): number {
  return parseInt(s.replace(/^#/, ''), 16);
}

export const render: RenderScriptModule<BoltParams>['render'] = (g, params) => {
  g.clear();
  const color = parseHex(params.color ?? '#ff5566');

  g.fillStyle(color, 0.35);
  g.fillRoundedRect(-5, -10, 10, 20, 5);
  g.fillStyle(color, 1);
  g.fillRoundedRect(-3, -9, 6, 18, 3);
  g.fillStyle(0xfff3d6, 0.9);
  g.fillRoundedRect(-1.2, -8, 2.4, 10, 1.2);
};
