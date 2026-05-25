import Phaser from 'phaser';

/**
 * UIScene — runs in parallel with GameScene.
 * HUD (score + lives) is rendered directly inside GameScene for this game,
 * so this scene intentionally stays empty.
 */
export class UIScene extends Phaser.Scene {
  constructor() {
    super({ key: 'UIScene' });
  }

  create(): void {
    // HUD handled by GameScene at depth 10
  }
}
