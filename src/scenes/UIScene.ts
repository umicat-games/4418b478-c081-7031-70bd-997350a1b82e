import Phaser from 'phaser';

/**
 * UIScene — HUD overlay.
 * All HUD for Bullet Storm is rendered directly in GameScene.
 */
export class UIScene extends Phaser.Scene {
  constructor() {
    super({ key: 'UIScene' });
  }

  create(): void {
    // No HUD widgets here — GameScene owns the HUD for this game.
  }
}
