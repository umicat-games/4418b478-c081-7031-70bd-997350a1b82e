import Phaser from 'phaser';
import { loadWorldScene, getEntityRegistry, addTilemapCollider } from '@umicat/phaser-sdk';
import { GAME_WIDTH, GAME_HEIGHT } from '../config';

const SPEED = 120;

export class GameScene extends Phaser.Scene {
  private sceneId!: string;

  private player: Phaser.GameObjects.Sprite | null = null;
  private lastDir: 'down' | 'up' | 'left' | 'right' = 'down';

  private keyW!: Phaser.Input.Keyboard.Key;
  private keyA!: Phaser.Input.Keyboard.Key;
  private keyS!: Phaser.Input.Keyboard.Key;
  private keyD!: Phaser.Input.Keyboard.Key;

  constructor() {
    super({ key: 'GameScene' });
  }

  init(data: { sceneId: string }): void {
    this.sceneId = data.sceneId;
  }

  async create(): Promise<void> {
    const { sceneFile } = await loadWorldScene(this, this.sceneId);

    if (sceneFile.entities.length === 0) {
      this.add
        .text(GAME_WIDTH / 2, GAME_HEIGHT / 2, 'Describe your game\nin the chat!', {
          fontSize: '28px',
          color: '#ffffff',
          align: 'center',
        })
        .setOrigin(0.5);
    }

    // WASD keys
    const kb = this.input.keyboard!;
    this.keyW = kb.addKey(Phaser.Input.Keyboard.KeyCodes.W);
    this.keyA = kb.addKey(Phaser.Input.Keyboard.KeyCodes.A);
    this.keyS = kb.addKey(Phaser.Input.Keyboard.KeyCodes.S);
    this.keyD = kb.addKey(Phaser.Input.Keyboard.KeyCodes.D);

    // The entity's `physics` block in main.json already gave the sprite an
    // Arcade body (collideWorldBounds + hitbox offset from asset metadata).
    // Just look it up by role and play the default idle animation.
    const registry = getEntityRegistry(this);
    const playerGO = registry?.byRole('player')[0] as Phaser.GameObjects.Sprite | undefined;
    if (playerGO) {
      playerGO.play('idle-down', true);
      this.player = playerGO;

      // Camera follows the player with a gentle lerp, zoomed in 3×
      this.cameras.main.setZoom(3);
      this.cameras.main.startFollow(playerGO, true, 0.1, 0.1);
      this.cameras.main.setDeadzone(80, 60);

      // Wire solid-tile collision — grass tileset has collision zones authored
      // in the Tileset Editor. SDK auto-armed setCollisionByProperty at load;
      // addTilemapCollider just connects the player body to those solid tiles.
      addTilemapCollider(this, 'e-mqyhplcx-udfj', playerGO);
    }
  }

  update(_time: number, _delta: number): void {
    const player = this.player;
    if (!player) return;

    const body = player.body as Phaser.Physics.Arcade.Body;

    let vx = 0;
    let vy = 0;

    if (this.keyA.isDown) vx = -SPEED;
    else if (this.keyD.isDown) vx = SPEED;

    if (this.keyW.isDown) vy = -SPEED;
    else if (this.keyS.isDown) vy = SPEED;

    // Normalize diagonal movement
    if (vx !== 0 && vy !== 0) {
      vx *= Math.SQRT1_2;
      vy *= Math.SQRT1_2;
    }

    body.setVelocity(vx, vy);

    const moving = vx !== 0 || vy !== 0;

    if (moving) {
      // Horizontal direction takes priority when moving diagonally
      if (Math.abs(vx) >= Math.abs(vy)) {
        this.lastDir = vx > 0 ? 'right' : 'left';
      } else {
        this.lastDir = vy > 0 ? 'down' : 'up';
      }
      player.play(`walk-${this.lastDir}`, true);
    } else {
      player.play(`idle-${this.lastDir}`, true);
    }
  }
}
