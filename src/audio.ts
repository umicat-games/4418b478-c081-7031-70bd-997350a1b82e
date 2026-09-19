/**
 * This game's sound: which clips, how loud, and how often each may retrigger.
 *
 * Everything hard about web audio — Web Audio instead of `<audio>` elements
 * (forty of those took this game to 11fps on an iPhone), the gesture unlock,
 * the asynchronous `resume()`, iOS suspending the context when the app goes
 * away — lives in `GameAudio` in the SDK now. Every 3D game needs all of it
 * and none of the failures are visible anywhere a creator would look.
 */
import { GameAudio, type AudioClipSpec } from '@umicat/three-sdk';

const CLIPS: Record<string, AudioClipSpec> = {
  'tower-shot': { volume: 0.35, throttle: 45 },
  'cannon-shot': { volume: 0.4, throttle: 60 },
  'hit-enemy': { volume: 0.4, throttle: 30 },
  'enemy-shot': { volume: 0.3, throttle: 40 },
  'enemy-die': { volume: 0.5, throttle: 40 },
  swing: { volume: 0.45, throttle: 120 },
  'sword-hit': { volume: 0.55, throttle: 40 },
  'hero-hurt': { volume: 0.7, throttle: 200 },
  coin: { volume: 0.5, throttle: 40 },
  build: { volume: 0.6 },
  // The press under every raised button. Kenney's Interface Sounds
  // `click_001`, CC0 — 0.10s, and QUIET at source (RMS 0.048 against `build`'s
  // own), which is why the volume here is high for what is only a click.
  //
  // Throttled: a modal's OK and whatever it opens can land inside one frame,
  // and two clicks on one press reads as a rattle.
  'ui-press': { volume: 0.55, throttle: 60 },
  upgrade: { volume: 0.65 },
  // Uploaded through the Assets tool, and `.mp3` while the rest are `.ogg`.
  // The key IS the filename when it carries an extension, which is how a game
  // mixes formats without the platform having to guess.
  'place-weapon.mp3': { volume: 0.7 },
  'upgrade-weapon.mp3': { volume: 0.7 },
  'enter-door.mp3': { volume: 0.75 },
  // One per staff — see `sound` in `weapons.ts`, which is where a weapon says
  // which of these is its own.
  //
  // The VOLUMES are matched by measurement, not by ear through a laptop
  // speaker: over the loud quarter of each clip, fire and lightning are about
  // one and a half times the RMS of ice. That is a difference between library
  // recordings, not a decision anybody made about fire, and left alone it means
  // changing staff changes how loud the game is.
  'fire-magic-wand-sound-effect.mp3': { volume: 0.5, throttle: 300 },
  'ice-magic-wand-sound-effect.mp3': { volume: 0.75, throttle: 300 },
  'lightning-magic-wand-sound-effect.mp3': { volume: 0.48, throttle: 300 },
  // Once a WAVE, where the jingle used to be. It was one per arrival first,
  // which is a real cue — the gates are at the far end of the board and you
  // spend the wave somewhere else — but fourteen of them a wave is the board
  // talking over the player.
  'enemy-spawn.mp3': { volume: 0.6, throttle: 400 },
  denied: { volume: 0.5 },
  leak: { volume: 0.7 },
  wave: { volume: 0.6 },
  win: { volume: 0.8 },
  lose: { volume: 0.7 },
};


/** Each scene has its own track, uploaded through the Assets tool. They are
 *  `.mp3` next to `.ogg` effects, which the SDK allows precisely so a game can
 *  use whatever its assets came as. */
export const MUSIC = { lobby: 'bgm-lobby.mp3', level: 'bgm-level.mp3' } as const;

/** Named so the call sites read as events rather than filenames. */
export const SFX = {
  placeTower: 'place-weapon.mp3',
  upgradeTower: 'upgrade-weapon.mp3',
  door: 'enter-door.mp3',
  enemySpawn: 'enemy-spawn.mp3',
  uiPress: 'ui-press',
} as const;

/**
 * The click under a button — and why the FIRST press of a session is silent.
 *
 * `GameAudio` creates its context and starts fetching every clip inside the
 * first gesture (its `start()` is private; the game cannot warm it earlier).
 * On that gesture there is therefore no decoded buffer yet, and `play()`
 * returns without a sound. The gesture in question is the title screen's own
 * button, which is the one press every player makes.
 *
 * Measured, both engines: at the moment the title is pressed, ZERO audio files
 * have been requested. The press runs the handler and the context is ready —
 * there is simply nothing to play.
 *
 * A retry was tried and taken out again. It cannot be made safe: the delay has
 * to clear a fetch and a decode, `setTimeout` drifts badly on a page rendering
 * a 3D scene, and a retry that lands outside the clip's throttle window plays
 * the click TWICE on every ordinary button — measured, two buffers for one
 * press. A blip 500ms after a press is not feedback anyway.
 *
 * Every press after the first one sounds. Making the first one sound needs a
 * generic `preload()` on the SDK's audio — which is a capability every game
 * with a title screen wants, not a Balaboo-shaped one.
 */
export const createAudio = (): GameAudio =>
  new GameAudio({ clips: CLIPS, base: 'audio/', music: MUSIC.lobby, musicVolume: 0.3 });
