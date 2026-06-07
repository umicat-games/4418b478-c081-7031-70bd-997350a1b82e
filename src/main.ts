import { createUmicatGame, Umicat } from '@umicat/phaser-sdk';
import { BootScene } from './scenes/BootScene';
import { GameScene } from './scenes/GameScene';
import { UIScene } from './scenes/UIScene';
import { GAME_WIDTH, GAME_HEIGHT } from './config';
import { renderScripts } from './visuals';

// Initialize platform services once at startup — scenes await this promise.
export const umicatReady = Umicat.init({ standaloneGameId: 'bullet-storm' }).catch(() => null);

createUmicatGame({
  width: GAME_WIDTH,
  height: GAME_HEIGHT,
  scenes: [BootScene, GameScene, UIScene],
  renderScripts,
});
