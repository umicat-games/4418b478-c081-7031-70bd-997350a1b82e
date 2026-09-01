// Player laser bolt — bright glowing capsule, travels upward.
import type { RenderScriptModule } from '@umicat/phaser-sdk';

export interface BoltParams {
  color?: string;
}

export const defaultParams: BoltParams = {
  color: '#7cffcb',
};

function parseHex(s: string): number {
  return parseInt(s.replace(/^#/, ''), 16);
}

export const render: RenderScriptModule<BoltParams>['render'] = (g, params) => {
  g.clear();
  const color = parseHex(params.color ?? '#7cffcb');

  g.fillStyle(color, 0.35);
  g.fillRoundedRect(-5, -11, 10, 22, 5);
  g.fillStyle(color, 1);
  g.fillRoundedRect(-3, -10, 6, 20, 3);
  g.fillStyle(0xffffff, 0.9);
  g.fillRoundedRect(-1.2, -9, 2.4, 12, 1.2);
};
