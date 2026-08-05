import Phaser from 'phaser';

/** Persisted SFX volume (0..1) — one-shot UI blips (button clicks, open bag /
 *  mailbox / chest). localStorage so it survives reloads. Default 0.6.
 *  Separate bus from the BGM (`src/bgm.ts`); the Settings tab has a slider each. */
const VOL_KEY = 'catopia:sfxVolume';
/** The default UI click/switch sound (loaded in BootScene as `sfx-switch`). */
export const SFX_CLICK = 'sfx-switch';

function readVolume(): number {
  try {
    const raw = localStorage.getItem(VOL_KEY);
    if (raw != null) return Phaser.Math.Clamp(parseFloat(raw), 0, 1);
  } catch { /* private mode / no storage */ }
  return 0.6;
}

let sfxVolume = readVolume();

export function getSfxVolume(): number {
  return sfxVolume;
}

/** Play a one-shot UI sound effect at the current SFX volume. No-op when muted,
 *  the clip isn't loaded, or the audio context is still locked (pre first gesture
 *  — we don't queue UI blips). Safe to call from any scene. */
export function playSfx(scene: Phaser.Scene, key: string = SFX_CLICK): void {
  if (sfxVolume <= 0) return;
  const mgr = scene.sound;
  if (mgr.locked || !scene.cache.audio.exists(key)) return;
  mgr.play(key, { volume: sfxVolume });
}

/** Set the SFX volume live: clamp 0..1, persist, and play a preview blip at the
 *  new level (so the slider is audible — a one-shot bus has no running track to
 *  re-level like the BGM does). */
export function setSfxVolume(scene: Phaser.Scene, v: number): void {
  sfxVolume = Phaser.Math.Clamp(v, 0, 1);
  try { localStorage.setItem(VOL_KEY, String(sfxVolume)); } catch { /* ignore */ }
  playSfx(scene); // audible feedback at the chosen level
}
