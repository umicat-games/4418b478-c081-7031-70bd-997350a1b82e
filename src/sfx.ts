import Phaser from 'phaser';

/** Persisted SFX volume (0..1) — one-shot UI blips (button clicks, open bag /
 *  mailbox / chest). localStorage so it survives reloads. Default 0.6.
 *  Separate bus from the BGM (`src/bgm.ts`); the Settings tab has a slider each. */
const VOL_KEY = 'catopia:sfxVolume';
/** The default UI click/switch sound (loaded in BootScene as `sfx-switch`). */
export const SFX_CLICK = 'sfx-switch';
/** A short scrub tick for dragging a slider (loaded as `sfx-scroll`). */
export const SFX_SCROLL = 'sfx-scroll';
/** The hoe/shovel dig thunk, played when the player's hoe strikes (loaded as `sfx-hoe`). */
export const SFX_HOE = 'sfx-hoe';
/** The axe chop thunk, played on each axe strike against a tree (loaded as `sfx-chop`). */
export const SFX_CHOP = 'sfx-chop';
/** A soft blip when the mouse highlights an item cell (loaded as `sfx-hover`). */
export const SFX_HOVER = 'sfx-hover';
/** Laptop cold-open: the "new message" arrival chime (confirmation_001). */
export const SFX_CONFIRM = 'sfx-confirm';
/** Laptop cold-open: the player sends a message (drop_002). */
export const SFX_DROP = 'sfx-drop';
/** Laptop cold-open: per-character typewriter tick (click_002). */
export const SFX_TYPE = 'sfx-type';
/** A harvested item lands in the collector (Cato / the player's cursor) — drop_004. */
export const SFX_COLLECT = 'sfx-collect';
/** A fish nibbles / tests the fishing float — phaserup2. */
export const SFX_NIBBLE = 'sfx-nibble';
/** The fish is hooked and the line reeled in — fish-splash-water. */
export const SFX_SPLASH = 'sfx-splash';
/** Casting the fishing rod (the swing) — swing-fishing-rod. */
export const SFX_SWING = 'sfx-swing';
/** The "new item!" catch-reveal jingle — get-item-sound. */
export const SFX_GETITEM = 'sfx-getitem';

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

/**
 * One REUSABLE Sound per key. Re-triggering the SAME effect RESTARTS that one
 * instance (its previous playback stops immediately) instead of stacking
 * overlapping copies — the rule for ALL sfx, and essential when a clip outlasts
 * the gap between triggers (e.g. rapid chops). Different keys still overlap
 * freely (hoe + chop can play together). `game.sound` is a single global manager
 * for the game's lifetime, so the pool is safe to hold module-wide.
 */
const pool = new Map<string, Phaser.Sound.BaseSound>();

/** Play a one-shot UI/game sound effect at the current SFX volume. No-op when
 *  muted, the clip isn't loaded, or the audio context is still locked (pre first
 *  gesture — we don't queue blips). Safe to call from any scene. */
export function playSfx(scene: Phaser.Scene, key: string = SFX_CLICK): void {
  if (sfxVolume <= 0) return;
  const mgr = scene.sound;
  if (mgr.locked || !scene.cache.audio.exists(key)) return;
  let s = pool.get(key);
  if (!s) { s = mgr.add(key); pool.set(key, s); }
  if (s.isPlaying) s.stop();               // cut the previous instance of THIS sound
  s.play({ volume: sfxVolume });
}

/** Set the SFX volume live: clamp 0..1 + persist. Audible feedback is the caller's
 *  job — the slider plays `SFX_SCROLL` as it moves (at the new level, so the SFX
 *  slider is heard getting louder/quieter). */
export function setSfxVolume(_scene: Phaser.Scene, v: number): void {
  sfxVolume = Phaser.Math.Clamp(v, 0, 1);
  try { localStorage.setItem(VOL_KEY, String(sfxVolume)); } catch { /* ignore */ }
}
