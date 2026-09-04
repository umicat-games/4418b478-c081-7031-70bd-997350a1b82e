import Phaser from 'phaser';

/** Persisted BGM volume (0..1). localStorage so it survives reloads AND is shared
 *  across the title/game scene switch. Default 0.4 (the old hardcoded level). */
const VOL_KEY = 'catopia:bgmVolume';
const BGM_KEYS = ['bgm', 'bgm-title'];
// A BGM track starting fresh eases in over at least this long, so the music the player
// hears when a screen/the game begins swells up gently instead of popping on. Used both as
// the unlock-path floor AND passed explicitly at the game-start call site — the platform
// often unlocks audio (an earlier click in the editor chrome) BEFORE the game boots, so the
// locked-path floor alone would miss it and start the in-game track at a short fade.
export const BGM_START_FADE_MS = 5000;

function readVolume(): number {
  try {
    const raw = localStorage.getItem(VOL_KEY);
    if (raw != null) return Phaser.Math.Clamp(parseFloat(raw), 0, 1);
  } catch {
    /* private mode / no storage — fall through to default */
  }
  return 0.4;
}

let bgmVolume = readVolume();

export function getBgmVolume(): number {
  return bgmVolume;
}

/**
 * Set the BGM volume live: clamps 0..1, persists, and applies to every currently
 * playing BGM track on the GLOBAL sound manager (so dragging the slider is audible
 * immediately, on whichever track is playing — title or game).
 */
export function setBgmVolume(scene: Phaser.Scene, v: number): void {
  bgmVolume = Phaser.Math.Clamp(v, 0, 1);
  try {
    localStorage.setItem(VOL_KEY, String(bgmVolume));
  } catch {
    /* ignore */
  }
  const mgr = scene.sound;
  for (const k of BGM_KEYS) {
    for (const s of mgr.getAll(k)) {
      (s as Phaser.Sound.WebAudioSound).setVolume?.(bgmVolume);
    }
  }
}

/**
 * Cross-fade-free BGM switch on the GLOBAL sound manager: STOP any tracks in
 * `stopKeys`, then loop `key`. Reuses an existing instance of `key` (never stacks
 * duplicates). Browsers block audio until a user gesture, so if the context is
 * still locked it defers to the first tap/click/key (`UNLOCKED`).
 *
 * The closure captures the sound manager (`game.sound`, global) — NOT the scene —
 * so a deferred play still works after the calling scene has shut down (e.g. the
 * title → game switch). Catopia uses `bgm-title` on the boot screen and `bgm`
 * in-game, so they play different tracks. Volume comes from the persisted
 * `bgmVolume` (the settings slider) so the level survives the switch.
 */
export function crossToBgm(scene: Phaser.Scene, key: string, stopKeys: string[] = [], fadeInMs = 0): void {
  const mgr = scene.sound;
  if (!scene.cache.audio.exists(key)) return;
  const go = (fade: number): void => {
    for (const k of stopKeys) for (const s of mgr.getAll(k)) if (s.isPlaying) s.stop();
    let snd = mgr.getAll(key)[0];
    if (!snd) snd = mgr.add(key, { loop: true, volume: fade > 0 ? 0 : bgmVolume });
    const sw = snd as Phaser.Sound.WebAudioSound;
    if (fade > 0) {
      // Swell in from silence with an EXPLICIT `from: 0` tween — do NOT let Phaser read the
      // current volume as the start. On the locked→unlock path the gain is STUCK at its 1.0
      // default and a SYNCHRONOUS set (`mgr.add({volume:0})` / `setVolume(0)` / `.volume = 0`)
      // is ignored by the just-resumed context until a later frame — so a plain
      // `volume: bgmVolume` tween captured 1.0 as its start and faded DOWNWARD: the music
      // popped in at full volume then quietly dropped ("instant full volume", user-reported).
      // `{ from: 0 }` forces volume to 0 on the tween's first update (when the setter DOES
      // apply) and ramps up. Sine.easeIn eases slowly at first for a soft entry.
      if (!snd.isPlaying) snd.play();
      scene.tweens.killTweensOf(snd);
      scene.tweens.add({ targets: snd, volume: { from: 0, to: bgmVolume }, duration: fade, ease: 'Sine.easeIn' });
    } else {
      if (!snd.isPlaying) snd.play();
      sw.setVolume?.(bgmVolume);
    }
  };
  if (mgr.locked) {
    // Phaser (browser policy) can't start audio until the first user gesture. When the context
    // unlocks on that tap/click, swell the first track in from silence over a GENTLE ramp — this
    // is the moment the player first hears music, so make the entry smooth, not an abrupt pop.
    mgr.once(Phaser.Sound.Events.UNLOCKED, () => go(Math.max(fadeInMs, BGM_START_FADE_MS)));
  } else {
    go(fadeInMs);
  }
}

/**
 * Fade every currently-playing BGM track to `toVol` over `ms`, using `scene`'s
 * tweens. Pass a PERSISTENT scene (the TransitionScene) so the fade survives the
 * scene switch — this is the transition's "duck the outgoing music to silence as
 * the screen covers" half. No-op if nothing is playing.
 */
export function fadeBgmTo(scene: Phaser.Scene, toVol: number, ms: number): void {
  const mgr = scene.sound;
  const sounds: Phaser.Sound.BaseSound[] = [];
  for (const k of BGM_KEYS) for (const s of mgr.getAll(k)) if (s.isPlaying) sounds.push(s);
  if (!sounds.length) return;
  scene.tweens.killTweensOf(sounds);
  scene.tweens.add({ targets: sounds, volume: toVol, duration: ms });
}
