// This game's sound.
//
// Everything hard about web audio — Web Audio rather than `<audio>` elements
// (forty of those took another game to 11fps on an iPhone), the gesture unlock,
// the asynchronous `resume()`, iOS suspending the context when the app goes
// away — lives in `GameAudio` in the SDK. What is here is which clips, how
// loud, and when they play.
//
// A Go board is a quiet game, and the sound design follows from that: one
// small noise when a stone lands, one when stones come off, one click under a
// button, and music that stays well under all of it. Nothing marks the passing
// of time, because nothing in Go does.
import { GameAudio, type AudioClipSpec } from '@umicat/three-sdk';

/**
 * Three stones, deliberately.
 *
 * A real board never makes the same noise twice, and the ear notices a repeat
 * far faster than it notices a difference — one stone clip played two hundred
 * times in a game is the sound of a machine, not of a board. Kenney's casino
 * pack, CC0; they are poker chips being laid on felt, which is the closest
 * thing in any free library to slate on wood.
 */
const STONES = ['stone-1', 'stone-2', 'stone-3'] as const;

const CLIPS: Record<string, AudioClipSpec> = {
  // Throttled just enough to stop the player's stone and White's reply landing
  // on top of each other when the engine answers instantly at a low level.
  'stone-1': { volume: 0.55, throttle: 60 },
  'stone-2': { volume: 0.55, throttle: 60 },
  'stone-3': { volume: 0.55, throttle: 60 },
  // Stones coming off the board. Louder than placing one, because being
  // captured is the loudest thing that happens in a game of Go.
  capture: { volume: 0.7, throttle: 120 },
  // The press under every button. Kenney's Interface Sounds `click_001`, and
  // quiet at source, which is why 0.5 is right for what is only a click.
  // Throttled: a panel's button and whatever it opens can land in one frame,
  // and two clicks on one press reads as a rattle.
  'ui-press': { volume: 0.5, throttle: 60 },
  // A point the rules will not take.
  denied: { volume: 0.45, throttle: 200 },
  // The end of a game. One phrase, not a fanfare: this game ends with counting.
  win: { volume: 0.6 },
};

/** Named so the call sites read as events rather than as filenames. */
export const SFX = {
  capture: 'capture',
  uiPress: 'ui-press',
  denied: 'denied',
  gameOver: 'win',
} as const;

export const createAudio = (): GameAudio =>
  new GameAudio({ clips: CLIPS, base: 'audio/', music: 'bgm.mp3', musicVolume: 0.22 });

/** One stone, never the same one twice in a row. */
export function playStone(audio: GameAudio, last: { i: number }): void {
  let i = Math.floor(Math.random() * STONES.length);
  if (i === last.i) i = (i + 1) % STONES.length;
  last.i = i;
  audio.play(STONES[i]);
}
