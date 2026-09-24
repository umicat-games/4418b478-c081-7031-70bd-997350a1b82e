import { GameAudio } from '@umicat/three-sdk';

/**
 * 语义音效名 -> 实际文件名（public/audio/*.ogg）。
 * GameAudio 按 `${base}${name}${extension}` 拼 URL。
 */
export const SOUNDS = {
  shoot_pistol: 'laserSmall_000',
  shoot_rifle: 'laserRetro_000',
  shoot_heavy: 'laserLarge_000',
  hit: 'impactMetal_000',
  hurt: 'impactMetal_000',
  kill: 'explosionCrunch_000',
  pickup: 'forceField_000',
  reload: 'impactMetal_000',
  wave: 'forceField_000',
  enemy_shoot: 'laserSmall_000',
} as const;

export type SoundName = keyof typeof SOUNDS;

export function createGameAudio(): GameAudio {
  const clips: Record<string, { volume?: number; throttle?: number }> = {};
  const spec: Record<SoundName, { volume: number; throttle: number }> = {
    shoot_pistol: { volume: 0.5, throttle: 60 },
    shoot_rifle: { volume: 0.42, throttle: 70 },
    shoot_heavy: { volume: 0.7, throttle: 250 },
    hit: { volume: 0.4, throttle: 50 },
    hurt: { volume: 0.5, throttle: 250 },
    kill: { volume: 0.6, throttle: 120 },
    pickup: { volume: 0.55, throttle: 200 },
    reload: { volume: 0.3, throttle: 300 },
    wave: { volume: 0.5, throttle: 500 },
    enemy_shoot: { volume: 0.28, throttle: 120 },
  };
  for (const [name, file] of Object.entries(SOUNDS)) {
    clips[file] = spec[name as SoundName];
  }
  const audio = new GameAudio({ base: 'audio/', extension: '.ogg', clips });
  // 开机就预加载：第一个手势（点击"进入战场"）到来时 buffer 已经就绪，
  // 否则那次点击的开火音会被静默丢掉。
  void audio.preload();
  return audio;
}
