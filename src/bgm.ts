import Phaser from 'phaser';

/**
 * Cross-fade-free BGM switch on the GLOBAL sound manager: STOP any tracks in
 * `stopKeys`, then loop `key`. Reuses an existing instance of `key` (never stacks
 * duplicates). Browsers block audio until a user gesture, so if the context is
 * still locked it defers to the first tap/click/key (`UNLOCKED`).
 *
 * The closure captures the sound manager (`game.sound`, global) — NOT the scene —
 * so a deferred play still works after the calling scene has shut down (e.g. the
 * title → game switch). Catopia uses `bgm-title` on the boot screen and `bgm`
 * in-game, so they play different tracks.
 */
export function crossToBgm(scene: Phaser.Scene, key: string, stopKeys: string[] = [], volume = 0.4): void {
  const mgr = scene.sound;
  if (!scene.cache.audio.exists(key)) return;
  const go = (): void => {
    for (const k of stopKeys) for (const s of mgr.getAll(k)) if (s.isPlaying) s.stop();
    let snd = mgr.getAll(key)[0];
    if (!snd) snd = mgr.add(key, { loop: true, volume });
    if (!snd.isPlaying) snd.play();
  };
  if (mgr.locked) mgr.once(Phaser.Sound.Events.UNLOCKED, go);
  else go();
}
