import Phaser from 'phaser';
import {
  loadWorldScene,
  getEntityRegistry,
  getRule,
  onRuleChange,
  spawnPrefab,
  getPrefab,
  runWaveSchedule,
  getHudObjects,
  getHudObjectById,
  suspendSceneUpdates,
  type WaveController,
  type SpawnInstance,
  type SpawnPrefabOverrides,
} from '@umicat/phaser-sdk';
import { GAME_WIDTH, GAME_HEIGHT } from '../config';
import { umicatReady } from '../main';

/**
 * GameScene — endless bright-and-cartoony space shooter.
 *
 * Layout (ships, backdrop) lives in `scenes/world/main.json`; enemy/bullet
 * TYPES live in `scenes/manifest.json`'s `prefabs[]`; the spawn cadence
 * lives in `waves/endless.json`; tunable numbers live in `rules.json`;
 * HUD widgets (score/lives/pause/game-over) live in `scenes/hud/game-hud.json`.
 * This file is glue: input, collisions, the update loop, and wiring HUD
 * button presses to game-flow actions.
 */

interface EnemyProps {
  hp: number;
  scoreValue: number;
  fireIntervalMs: number;
  aimed: boolean;
  moveType: 'straight' | 'weave';
  weaveAmplitude?: number;
  weaveSpeed?: number;
}

type DialogRole = 'pause-dialog' | 'gameover-dialog';

function setVisibleSafe(go: Phaser.GameObjects.GameObject | undefined, visible: boolean): void {
  const target = go as unknown as { setVisible?: (v: boolean) => void } | undefined;
  target?.setVisible?.(visible);
}

export class GameScene extends Phaser.Scene {
  private sceneId!: string;

  private player!: Phaser.GameObjects.Graphics;
  private enemyList: Phaser.GameObjects.GameObject[] = [];
  private playerBulletList: Phaser.GameObjects.GameObject[] = [];
  private enemyBulletList: Phaser.GameObjects.GameObject[] = [];
  private sparkEmitter!: Phaser.GameObjects.Particles.ParticleEmitter;

  private score = 0;
  private highScore = 0;
  private lives = 3;

  private playerSpeed = 380;
  private shootCooldownMs = 260;
  private invulnerabilityMs = 1400;
  private enemyBulletSpeed = 260;
  private difficultyStep = 0.14;
  private maxDifficultyMultiplier = 2.4;
  private difficultyMultiplier = 1;
  private loopStarted = false;
  private loopCount = 0;

  private nextPlayerFireAt = 0;
  private invulnerableUntil = 0;
  private isPaused = false;
  private isGameOver = false;
  private canExit = false;
  private umicatInstance: Awaited<typeof umicatReady> = null;

  private waveController?: WaveController;
  private ruleUnsubs: Array<() => void> = [];
  private cursors!: Phaser.Types.Input.Keyboard.CursorKeys;
  private wasdKeys!: {
    W: Phaser.Input.Keyboard.Key;
    A: Phaser.Input.Keyboard.Key;
    S: Phaser.Input.Keyboard.Key;
    D: Phaser.Input.Keyboard.Key;
  };
  private pointerTarget: { x: number; y: number } | null = null;

  constructor() {
    super({ key: 'GameScene' });
  }

  init(data: { sceneId: string }): void {
    this.sceneId = data.sceneId;

    // The same scene instance is reused by `this.scene.restart(...)` —
    // reset all transient run state each time.
    this.enemyList = [];
    this.playerBulletList = [];
    this.enemyBulletList = [];
    this.score = 0;
    this.difficultyMultiplier = 1;
    this.loopStarted = false;
    this.loopCount = 0;
    this.nextPlayerFireAt = 0;
    this.invulnerableUntil = 0;
    this.isPaused = false;
    this.isGameOver = false;
    this.pointerTarget = null;
    this.ruleUnsubs.forEach((u) => u());
    this.ruleUnsubs = [];
  }

  async create(): Promise<void> {
    await loadWorldScene(this, this.sceneId);

    const registry = getEntityRegistry(this)!;
    this.player = registry.byRole('player')[0] as Phaser.GameObjects.Graphics;

    // --- Rules (tunable balance) ---------------------------------------
    this.lives = getRule(this, 'balance.lives', 3);
    this.playerSpeed = getRule(this, 'balance.playerSpeed', 380);
    this.shootCooldownMs = getRule(this, 'balance.shootCooldownMs', 260);
    this.invulnerabilityMs = getRule(this, 'balance.invulnerabilityMs', 1400);
    this.enemyBulletSpeed = getRule(this, 'balance.enemyBulletSpeed', 260);
    this.difficultyStep = getRule(this, 'difficulty.difficultyStepPerLoop', 0.14);
    this.maxDifficultyMultiplier = getRule(this, 'difficulty.maxDifficultyMultiplier', 2.4);

    this.ruleUnsubs.push(
      onRuleChange<number>(this, 'balance.playerSpeed', (v) => (this.playerSpeed = v)),
      onRuleChange<number>(this, 'balance.shootCooldownMs', (v) => (this.shootCooldownMs = v)),
      onRuleChange<number>(this, 'balance.invulnerabilityMs', (v) => (this.invulnerabilityMs = v)),
      onRuleChange<number>(this, 'balance.enemyBulletSpeed', (v) => (this.enemyBulletSpeed = v)),
    );
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.ruleUnsubs.forEach((u) => u());
      this.ruleUnsubs = [];
    });

    // --- HUD initial values ---------------------------------------------
    this.registry.set('score', 0);
    this.registry.set('lives', this.lives);
    this.registry.set('highScore', 0);
    this.registry.set('newBestLabel', '');

    // --- Platform services: load the saved high score. This is an extra
    // await after loadWorldScene resolved, so suspend the scene's update
    // loop for its duration per the SDK's async-create-safety guidance. ---
    const release = suspendSceneUpdates(this);
    try {
      const umicat = await umicatReady;
      this.umicatInstance = umicat;
      this.canExit = umicat?.platform.canExit ?? false;
      if (umicat) {
        const saved = await umicat.saves.get<number>('highScore').catch(() => null);
        this.highScore = typeof saved === 'number' ? saved : 0;
      }
    } finally {
      release();
    }
    this.registry.set('highScore', this.highScore);
    if (!this.canExit) {
      setVisibleSafe(getHudObjectById(this, 'exit-button'), false);
      setVisibleSafe(getHudObjectById(this, 'exit-button-2'), false);
    }

    // --- Physics world + input ------------------------------------------
    this.physics.world.setBounds(0, 0, GAME_WIDTH, GAME_HEIGHT);

    this.cursors = this.input.keyboard!.createCursorKeys();
    this.wasdKeys = this.input.keyboard!.addKeys('W,S,A,D') as unknown as {
      W: Phaser.Input.Keyboard.Key;
      A: Phaser.Input.Keyboard.Key;
      S: Phaser.Input.Keyboard.Key;
      D: Phaser.Input.Keyboard.Key;
    };

    this.input.on('pointerdown', (p: Phaser.Input.Pointer) => {
      if (!this.isPaused && !this.isGameOver) this.pointerTarget = { x: p.x, y: p.y };
    });
    this.input.on('pointermove', (p: Phaser.Input.Pointer) => {
      if (p.isDown && !this.isPaused && !this.isGameOver) this.pointerTarget = { x: p.x, y: p.y };
    });
    this.input.on('pointerup', () => {
      this.pointerTarget = null;
    });

    // --- Shared spark texture + particle emitter for hit/explosion juice.
    if (!this.textures.exists('spark')) {
      const gfx = this.make.graphics({ x: 0, y: 0 }, false);
      gfx.fillStyle(0xffffff, 1).fillCircle(4, 4, 4);
      gfx.generateTexture('spark', 8, 8);
      gfx.destroy();
    }
    this.sparkEmitter = this.add.particles(0, 0, 'spark', {
      speed: { min: 60, max: 220 },
      lifespan: 420,
      scale: { start: 1, end: 0 },
      emitting: false,
      tint: [0xffe066, 0xff8fa3, 0xffffff, 0x7cffcb],
    });
    this.sparkEmitter.setDepth(4);

    // --- Collisions. Lists are plain arrays mutated in place (push/splice)
    // so the collider keeps seeing new spawns / removed entries via the
    // same array reference. -----------------------------------------------
    this.physics.add.overlap(this.playerBulletList, this.enemyList, this.handleBulletHitEnemy, undefined, this);
    this.physics.add.overlap(this.enemyBulletList, this.player, this.handleEnemyBulletHitPlayer, undefined, this);
    this.physics.add.overlap(this.enemyList, this.player, this.handleEnemyCollidePlayer, undefined, this);

    // --- Endless wave schedule -------------------------------------------
    this.waveController = runWaveSchedule(this, 'endless', {
      onSpawn: (instance) => this.handleWaveSpawn(instance),
      onWaveStart: (waveIndex) => this.handleWaveStart(waveIndex),
    });

    // --- HUD button wiring ------------------------------------------------
    this.events.on('hud:press', this.handleHudPress, this);
  }

  update(time: number, _delta: number): void {
    if (this.isPaused || this.isGameOver) return;

    this.updatePlayerMovement();
    this.updatePlayerFire(time);
    this.updateEnemies(time);
    this.cleanupOffscreen();
  }

  // --- Player -------------------------------------------------------------

  private updatePlayerMovement(): void {
    const body = this.player.body as Phaser.Physics.Arcade.Body;
    let vx = 0;
    let vy = 0;

    if (this.pointerTarget) {
      const dx = this.pointerTarget.x - this.player.x;
      const dy = this.pointerTarget.y - this.player.y;
      const dist = Math.hypot(dx, dy);
      if (dist > 6) {
        vx = (dx / dist) * this.playerSpeed;
        vy = (dy / dist) * this.playerSpeed;
      }
    } else {
      if (this.cursors.left?.isDown || this.wasdKeys.A.isDown) vx -= 1;
      if (this.cursors.right?.isDown || this.wasdKeys.D.isDown) vx += 1;
      if (this.cursors.up?.isDown || this.wasdKeys.W.isDown) vy -= 1;
      if (this.cursors.down?.isDown || this.wasdKeys.S.isDown) vy += 1;
      if (vx !== 0 && vy !== 0) {
        const inv = Math.SQRT1_2;
        vx *= inv;
        vy *= inv;
      }
      vx *= this.playerSpeed;
      vy *= this.playerSpeed;
    }

    body.setVelocity(vx, vy);
  }

  private updatePlayerFire(time: number): void {
    if (time < this.nextPlayerFireAt) return;
    this.nextPlayerFireAt = time + this.shootCooldownMs;
    const bullet = spawnPrefab(this, 'player_bullet', this.player.x, this.player.y - 40);
    this.playerBulletList.push(bullet);
    this.sparkEmitter.explode(3, this.player.x, this.player.y - 44);
  }

  // --- Enemies --------------------------------------------------------------

  private handleWaveSpawn(instance: SpawnInstance): Phaser.GameObjects.GameObject {
    const { prefabId, x, y } = instance;
    const base = getPrefab(this, prefabId);
    const baseVelY = base.physics?.velocityY ?? 0;
    const baseFireMs = (base.properties?.fireIntervalMs as number | undefined) ?? 2000;
    const mult = this.difficultyMultiplier;

    // Scale each spawn's fall speed + fire rate by the current endless-loop
    // difficulty multiplier (see handleWaveStart). No per-spawn overrides
    // are authored in waves/endless.json, so this is the only override.
    const merged: SpawnPrefabOverrides = {
      physics: { velocityY: baseVelY * mult },
      properties: { fireIntervalMs: Math.max(500, baseFireMs / mult) },
    };

    const go = spawnPrefab(this, prefabId, x, y, merged);
    go.setData('nextFireAt', this.time.now + Phaser.Math.Between(400, 1300));
    go.setData('weavePhase', Math.random() * Math.PI * 2);
    this.enemyList.push(go);
    return go;
  }

  private handleWaveStart(waveIndex: number): void {
    if (waveIndex !== 0) return;
    if (this.loopStarted) {
      this.loopCount += 1;
      this.difficultyMultiplier = Math.min(1 + this.loopCount * this.difficultyStep, this.maxDifficultyMultiplier);
    } else {
      this.loopStarted = true;
    }
  }

  private updateEnemies(time: number): void {
    for (const enemy of this.enemyList) {
      if (!enemy.active) continue;
      const props = enemy.getData('entityProperties') as EnemyProps;
      const graphic = enemy as Phaser.GameObjects.Graphics;
      const body = graphic.body as Phaser.Physics.Arcade.Body;

      if (props.moveType === 'weave') {
        const phase = (enemy.getData('weavePhase') as number) ?? 0;
        const amp = props.weaveAmplitude ?? 80;
        const wSpeed = props.weaveSpeed ?? 2;
        const t = time / 1000;
        body.setVelocityX(Math.cos(t * wSpeed + phase) * amp * wSpeed);
      }

      const nextFireAt = (enemy.getData('nextFireAt') as number) ?? 0;
      if (time >= nextFireAt) {
        this.enemyFire(graphic, props);
        enemy.setData('nextFireAt', time + props.fireIntervalMs);
      }
    }
    this.pruneInPlace(this.enemyList);
  }

  private enemyFire(enemy: Phaser.GameObjects.Graphics, props: EnemyProps): void {
    const speed = this.enemyBulletSpeed * Math.min(this.difficultyMultiplier, 1.6);
    let vx = 0;
    let vy = speed;
    if (props.aimed) {
      const dx = this.player.x - enemy.x;
      const dy = this.player.y - enemy.y;
      const dist = Math.max(1, Math.hypot(dx, dy));
      vx = (dx / dist) * speed;
      vy = (dy / dist) * speed;
    }
    const bullet = spawnPrefab(this, 'enemy_bullet', enemy.x, enemy.y + 24, {
      physics: { velocityX: vx, velocityY: vy },
    });
    this.enemyBulletList.push(bullet);

    // Quick telegraph pop so a fire event is readable amid the chaos.
    this.tweens.add({ targets: enemy, scale: { from: 1.18, to: 1 }, duration: 150, ease: 'Quad.easeOut' });
  }

  private cleanupOffscreen(): void {
    const margin = 100;
    for (const list of [this.enemyList, this.playerBulletList, this.enemyBulletList]) {
      for (const go of list) {
        if (!go.active) continue;
        const g = go as Phaser.GameObjects.Graphics;
        if (g.y < -margin || g.y > GAME_HEIGHT + margin || g.x < -margin || g.x > GAME_WIDTH + margin) {
          go.destroy();
        }
      }
      this.pruneInPlace(list);
    }
  }

  private pruneInPlace(arr: Phaser.GameObjects.GameObject[]): void {
    for (let i = arr.length - 1; i >= 0; i--) {
      if (!arr[i].active) arr.splice(i, 1);
    }
  }

  // --- Collisions -------------------------------------------------------------

  private handleBulletHitEnemy: Phaser.Types.Physics.Arcade.ArcadePhysicsCallback = (bulletObj, enemyObj) => {
    const bullet = bulletObj as unknown as Phaser.GameObjects.GameObject;
    const enemy = enemyObj as unknown as Phaser.GameObjects.Graphics;
    if (!bullet.active || !enemy.active) return;
    bullet.destroy();

    const props = enemy.getData('entityProperties') as EnemyProps;
    props.hp -= 1;
    if (props.hp <= 0) {
      this.score += props.scoreValue;
      this.registry.set('score', this.score);
      this.spawnScorePopup(enemy.x, enemy.y, props.scoreValue);
      this.sparkEmitter.explode(16, enemy.x, enemy.y);
      this.cameras.main.shake(60, 0.003);
      enemy.destroy();
    } else {
      this.tweens.add({ targets: enemy, alpha: { from: 0.3, to: 1 }, duration: 120 });
    }
  };

  private handleEnemyBulletHitPlayer: Phaser.Types.Physics.Arcade.ArcadePhysicsCallback = (bulletObj) => {
    const bullet = bulletObj as unknown as Phaser.GameObjects.GameObject;
    if (!bullet.active) return;
    bullet.destroy();
    this.damagePlayer();
  };

  private handleEnemyCollidePlayer: Phaser.Types.Physics.Arcade.ArcadePhysicsCallback = (enemyObj) => {
    const enemy = enemyObj as unknown as Phaser.GameObjects.Graphics;
    if (!enemy.active) return;
    this.sparkEmitter.explode(16, enemy.x, enemy.y);
    enemy.destroy();
    this.damagePlayer();
  };

  private spawnScorePopup(x: number, y: number, value: number): void {
    const label = this.add
      .text(x, y, `+${value}`, { fontSize: '20px', color: '#ffe066', fontFamily: 'sans-serif' })
      .setOrigin(0.5)
      .setDepth(5);
    this.tweens.add({
      targets: label,
      y: y - 46,
      alpha: 0,
      duration: 550,
      ease: 'Quad.easeOut',
      onComplete: () => label.destroy(),
    });
  }

  // --- Player damage / life cycle --------------------------------------------

  private damagePlayer(): void {
    if (this.time.now < this.invulnerableUntil) return;
    this.lives -= 1;
    this.registry.set('lives', this.lives);
    this.cameras.main.shake(150, 0.01);
    this.cameras.main.flash(120, 255, 90, 110);

    if (this.lives <= 0) {
      this.gameOver();
      return;
    }
    this.startInvulnerability();
  }

  private startInvulnerability(): void {
    this.invulnerableUntil = this.time.now + this.invulnerabilityMs;
    const blink = this.tweens.add({
      targets: this.player,
      alpha: { from: 1, to: 0.25 },
      duration: 100,
      yoyo: true,
      repeat: Math.max(1, Math.floor(this.invulnerabilityMs / 200)),
    });
    this.time.delayedCall(this.invulnerabilityMs, () => {
      blink.stop();
      this.player.setAlpha(1);
    });
  }

  private gameOver(): void {
    this.isGameOver = true;
    this.physics.pause();
    this.waveController?.stop();

    const newBest = this.score > this.highScore;
    if (newBest) {
      this.highScore = this.score;
      this.registry.set('highScore', this.highScore);
      this.registry.set('newBestLabel', 'New Best!');
    } else {
      this.registry.set('newBestLabel', '');
    }
    void this.persistHighScore();
    this.showDialog('gameover-dialog');
  }

  private async persistHighScore(): Promise<void> {
    if (!this.umicatInstance) return;
    try {
      await this.umicatInstance.saves.set('highScore', this.highScore);
    } catch (err) {
      console.warn('[space-shooter] failed to save high score', err);
    }
  }

  // --- Pause / restart / exit --------------------------------------------------

  private handleHudPress(id: string): void {
    switch (id) {
      case 'pause-button':
        this.pauseGame();
        break;
      case 'resume-button':
        this.resumeGame();
        break;
      case 'restart-button':
      case 'play-again-button':
        this.restartGame();
        break;
      case 'exit-button':
      case 'exit-button-2':
        this.exitGame();
        break;
      default:
        break;
    }
  }

  private pauseGame(): void {
    if (this.isPaused || this.isGameOver) return;
    this.isPaused = true;
    this.pointerTarget = null;
    this.physics.pause();
    this.waveController?.pause();
    this.showDialog('pause-dialog');
  }

  private resumeGame(): void {
    if (!this.isPaused) return;
    this.isPaused = false;
    this.physics.resume();
    this.waveController?.resume();
    this.hideDialog('pause-dialog');
  }

  private restartGame(): void {
    this.scene.restart({ sceneId: this.sceneId });
  }

  private exitGame(): void {
    if (!this.canExit || !this.umicatInstance) return;
    void (async () => {
      await this.persistHighScore();
      try {
        await this.umicatInstance!.platform.exit();
      } catch {
        /* host rejected or torn down already — nothing more to do */
      }
    })();
  }

  private showDialog(role: DialogRole): void {
    for (const go of getHudObjects(this, role)) setVisibleSafe(go, true);
    if (!this.canExit) {
      setVisibleSafe(getHudObjectById(this, role === 'pause-dialog' ? 'exit-button' : 'exit-button-2'), false);
    }
  }

  private hideDialog(role: DialogRole): void {
    for (const go of getHudObjects(this, role)) setVisibleSafe(go, false);
  }
}
