import * as THREE from 'three';
import {
  waveSize, waveComposition, MAX_ALIVE_ENEMIES, SPAWN_INTERVAL, INTERMISSION_TIME,
  type EnemyDef,
} from './config';
import type { EnemyManager } from './enemies';

export interface WaveHooks {
  onWaveStart: (n: number) => void;
  onWaveClear: (n: number) => void;
  onIntermission: (secondsLeft: number) => void;
}

type WaveState = 'idle' | 'intermission' | 'active';

/**
 * 波次导演：刷怪队列、波间休整、难度曲线。
 * 只管"什么时候刷什么"，刷怪动作本身调 enemies.spawn。
 */
export class WaveDirector {
  wave = 0;
  private state: WaveState = 'idle';
  private queue: EnemyDef['id'][] = [];
  private spawnTimer = 0;
  private intermissionT = 0;
  private gates: THREE.Vector3[];
  private hooks: WaveHooks;
  private clearedAnnounced = false;

  constructor(gates: THREE.Vector3[], hooks: WaveHooks) {
    this.gates = gates;
    this.hooks = hooks;
  }

  get active(): boolean {
    return this.state === 'active';
  }

  /** 剩余敌人 = 待刷 + 场上存活 */
  remaining(enemies: EnemyManager): number {
    return this.queue.length + enemies.aliveCount;
  }

  start(): void {
    this.wave = 0;
    this.state = 'intermission';
    this.intermissionT = 2.5; // 开局短休整，给玩家适应时间
    this.queue = [];
    this.clearedAnnounced = false;
  }

  stop(): void {
    this.state = 'idle';
    this.queue = [];
  }

  private beginWave(n: number): void {
    this.wave = n;
    this.queue = waveComposition(n);
    this.state = 'active';
    this.spawnTimer = 0.5;
    this.clearedAnnounced = false;
    this.hooks.onWaveStart(n);
  }

  update(dt: number, enemies: EnemyManager): void {
    if (this.state === 'idle') return;

    if (this.state === 'intermission') {
      this.intermissionT -= dt;
      this.hooks.onIntermission(Math.max(0, this.intermissionT));
      if (this.intermissionT <= 0) this.beginWave(this.wave + 1);
      return;
    }

    // active：按间隔从随机门刷怪（同屏上限保护性能）
    if (this.queue.length > 0) {
      this.spawnTimer -= dt;
      if (this.spawnTimer <= 0 && enemies.aliveCount < MAX_ALIVE_ENEMIES) {
        this.spawnTimer = SPAWN_INTERVAL;
        const id = this.queue.shift()!;
        const gate = this.gates[Math.floor(Math.random() * this.gates.length)];
        enemies.spawn(id, gate);
      }
    } else if (enemies.aliveCount === 0 && !this.clearedAnnounced) {
      this.clearedAnnounced = true;
      this.hooks.onWaveClear(this.wave);
      this.state = 'intermission';
      this.intermissionT = INTERMISSION_TIME;
    }
  }

  get intermissionLeft(): number {
    return this.intermissionT;
  }

  get waveSizeCurrent(): number {
    return waveSize(this.wave);
  }
}
