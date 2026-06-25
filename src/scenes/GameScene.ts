import Phaser from 'phaser';
import { loadWorldScene, getEntityRegistry } from '@umicat/phaser-sdk';
import { GAME_WIDTH, GAME_HEIGHT } from '../config';

const SPEED = 160; // pixels per second

/**
 * GameScene — generic loader for world scene files (`scenes/world/*.json`).
 *
 * Takes a `sceneId` via init data and asks the SDK to spawn its entities,
 * configure the camera, and register them. Behavior code lives in
 * `update()` and per-role helpers; it looks entities up via the entity
 * registry rather than holding direct references to objects created here.
 *
 * Example (the agent writes this kind of thing in update or pointer
 * handlers, NOT in create — entities come from the scene file now):
 *
 * ```ts
 * const player = getEntityRegistry(this)?.byRole('player')[0];
 * if (player && this.input.keyboard?.checkDown(this.cursors.up)) {
 *   (player as Phaser.GameObjects.Sprite).y -= 4;
 * }
 * ```
 */
export class GameScene extends Phaser.Scene {
  private sceneId!: string;
  private cursors!: Phaser.Types.Input.Keyboard.CursorKeys;
  private moveTarget: Phaser.Math.Vector2 | null = null;

  constructor() {
    super({ key: 'GameScene' });
  }

  init(data: { sceneId: string }): void {
    this.sceneId = data.sceneId;
    this.moveTarget = null;
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

    // Set up arrow key input
    this.cursors = this.input.keyboard!.createCursorKeys();

    // Click / tap to move
    this.input.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
      this.moveTarget = new Phaser.Math.Vector2(pointer.x, pointer.y);
    });
  }

  update(_time: number, delta: number): void {
    const registry = getEntityRegistry(this);
    const player = registry?.byRole('player')[0] as Phaser.GameObjects.Sprite | undefined;
    if (!player) return;

    const dt = delta / 1000;
    let vx = 0;
    let vy = 0;

    // Arrow key input takes priority over click-to-move
    const left  = this.cursors.left?.isDown;
    const right = this.cursors.right?.isDown;
    const up    = this.cursors.up?.isDown;
    const down  = this.cursors.down?.isDown;

    if (left || right || up || down) {
      this.moveTarget = null; // cancel mouse target when keys are pressed
      if (left)  vx -= 1;
      if (right) vx += 1;
      if (up)    vy -= 1;
      if (down)  vy += 1;

      // Normalise diagonal movement
      if (vx !== 0 && vy !== 0) {
        vx *= 0.707;
        vy *= 0.707;
      }
    } else if (this.moveTarget) {
      // Click-to-move: steer toward target
      const dx = this.moveTarget.x - player.x;
      const dy = this.moveTarget.y - player.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < 4) {
        this.moveTarget = null; // arrived
      } else {
        vx = dx / dist;
        vy = dy / dist;
      }
    }

    // Apply movement
    player.x += vx * SPEED * dt;
    player.y += vy * SPEED * dt;

    // Clamp to world bounds
    player.x = Phaser.Math.Clamp(player.x, 0, GAME_WIDTH);
    player.y = Phaser.Math.Clamp(player.y, 0, GAME_HEIGHT);

    // Play the correct walk animation
    if (vx !== 0 || vy !== 0) {
      if (Math.abs(vx) >= Math.abs(vy)) {
        player.play(vx > 0 ? 'walk-right' : 'walk-left', true);
      } else {
        player.play(vy > 0 ? 'walk-down' : 'walk-up', true);
      }
    } else {
      player.stop();
      player.setFrame(0); // idle: first frame of walk-down
    }
  }
}
