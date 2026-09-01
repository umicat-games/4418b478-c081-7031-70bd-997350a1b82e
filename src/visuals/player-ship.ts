// Friendly cartoony player starship — nose points up (toward the enemies).
import type { RenderScriptModule } from '@umicat/phaser-sdk';

export interface PlayerShipParams {
  bodyColor?: string;
  accentColor?: string;
  canopyColor?: string;
  flameColor?: string;
}

export const defaultParams: PlayerShipParams = {
  bodyColor: '#4fd1ff',
  accentColor: '#ffd23f',
  canopyColor: '#eaffff',
  flameColor: '#ff9f43',
};

function parseHex(s: string): number {
  return parseInt(s.replace(/^#/, ''), 16);
}

export const render: RenderScriptModule<PlayerShipParams>['render'] = (g, params) => {
  g.clear();
  const body = parseHex(params.bodyColor ?? '#4fd1ff');
  const accent = parseHex(params.accentColor ?? '#ffd23f');
  const canopy = parseHex(params.canopyColor ?? '#eaffff');
  const flame = parseHex(params.flameColor ?? '#ff9f43');

  // Engine flame (behind the hull), bottom of the ship.
  g.fillStyle(flame, 0.9);
  g.fillTriangle(-10, 30, 10, 30, 0, 48);
  g.fillStyle(0xffe9a3, 0.9);
  g.fillTriangle(-5, 30, 5, 30, 0, 40);

  // Wings.
  g.fillStyle(accent, 1);
  g.fillTriangle(-8, 6, -34, 30, -6, 22);
  g.fillTriangle(8, 6, 34, 30, 6, 22);
  g.lineStyle(2, 0x1c1c2e, 0.5);
  g.strokeTriangle(-8, 6, -34, 30, -6, 22);
  g.strokeTriangle(8, 6, 34, 30, 6, 22);

  // Main fuselage — nose pointing up (negative y).
  g.fillStyle(body, 1);
  g.fillTriangle(0, -38, -16, 20, 16, 20);
  g.fillRoundedRect(-14, 6, 28, 22, 8);
  g.lineStyle(2.5, 0x1c1c2e, 0.8);
  g.strokeTriangle(0, -38, -16, 20, 16, 20);
  g.strokeRoundedRect(-14, 6, 28, 22, 8);

  // Cockpit canopy.
  g.fillStyle(canopy, 1);
  g.fillEllipse(0, -6, 14, 18);
  g.lineStyle(2, 0x1c1c2e, 0.6);
  g.strokeEllipse(0, -6, 14, 18);
  g.fillStyle(0xffffff, 0.6);
  g.fillEllipse(-3, -10, 5, 7);
};
