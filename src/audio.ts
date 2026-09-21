// This game's sound.
//
// Everything hard about web audio — Web Audio rather than `<audio>` elements
// (forty of those took another game to 11fps on an iPhone), the gesture
// unlock, the asynchronous `resume()`, iOS suspending the context when the app
// goes away — lives in `GameAudio` in the SDK. What is here is which clips,
// how loud, and when they play.
//
// Blokus is a quiet game of tiles being set down, so the sound design is: a
// knock when a piece lands, a click under a button, a short refusal when the
// rules will not take a square, and one phrase at the end.
import { GameAudio, type AudioClipSpec } from '@umicat/three-sdk';

/**
 * Three knocks, deliberately.
 *
 * A real board never makes the same noise twice, and the ear notices a repeat
 * far faster than it notices a difference — one clip played two hundred times
 * in a game is the sound of a machine, not of a table. Kenney's casino pack,
 * CC0: chips laid on felt, which is close to a plastic tile on a board.
 */
const KNOCKS = ['piece-1', 'piece-2', 'piece-3'] as const;

const CLIPS: Record<string, AudioClipSpec> = {
  // Throttled just enough that a bot's reply and the player's own move do not
  // land on top of each other when three bots answer in a row.
  'piece-1': { volume: 0.55, throttle: 60 },
  'piece-2': { volume: 0.55, throttle: 60 },
  'piece-3': { volume: 0.55, throttle: 60 },
  // The press under every button. Kenney's Interface Sounds `click_001`,
  // quiet at source, which is why 0.5 is right for what is only a click.
  'ui-press': { volume: 0.5, throttle: 60 },
  // A square the rules will not take.
  denied: { volume: 0.4, throttle: 250 },
  // The end of a game. One phrase, not a fanfare.
  win: { volume: 0.6 },
};

/** Named so the call sites read as events rather than as filenames. */
export const SFX = {
  uiPress: 'ui-press',
  denied: 'denied',
  gameOver: 'win',
} as const;

export const createAudio = (): GameAudio =>
  new GameAudio({ clips: CLIPS, base: 'audio/', music: 'bgm.mp3', musicVolume: 0.18 });

/** One knock, never the same one twice in a row. */
export function playTile(audio: GameAudio, last: { i: number }): void {
  let i = Math.floor(Math.random() * KNOCKS.length);
  if (i === last.i) i = (i + 1) % KNOCKS.length;
  last.i = i;
  audio.play(KNOCKS[i]);
}
