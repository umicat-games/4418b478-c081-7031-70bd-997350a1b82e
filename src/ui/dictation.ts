// Speaking, for any field that takes words.
//
// Extracted from the chat panel when a second place needed it — the little
// composer that opens beside a stone. Two copies of this would have been two
// copies of the awkward parts: the level meter's history buffer, the draft that
// has to come back if nothing is said, and the stop order below.
import type { ThreeUmicat } from '@umicat/three-sdk';

/** How many bars a level meter has. Enough to read as a waveform, few enough
 *  that each is a chunky block rather than a hair. */
export const BARS = 22;

export interface DictationHandlers {
  /** The recognised sentence. Never auto-sent — recognition mishears, and the
   *  sentences this game gets are full of coordinates. */
  onFinal(text: string): void;
  /** Recording started or stopped; the field swaps between words and meter. */
  onState(listening: boolean): void;
  onError?(kind: string): void;
}

/**
 * Which language to listen for, from the platform's locale tag.
 *
 * **Never compare a locale tag with `===`.** The three hosts send three
 * different shapes of the same answer: home-ui sends the platform language
 * setting (`zh-CN`), Android sends `Locale.getDefault().toLanguageTag()`
 * (`zh-CN`), and iOS sends `Locale.preferredLanguages.first`, which carries
 * the SCRIPT — `zh-Hans-CN`. An exact test against 'zh-CN' therefore passed
 * on the web and on Android and failed on an iPhone, where the UI came up in
 * Chinese (the string table falls back on the base language) while the
 * microphone listened in English. Nobody testing in a browser could ever see
 * it.
 *
 * Nothing auto-detects the spoken language: the web `SpeechRecognition`, iOS
 * `SFSpeechRecognizer(locale:)` and Android's `EXTRA_LANGUAGE` all listen for
 * exactly the one language they are given, so getting this wrong does not
 * degrade — it returns confident nonsense.
 */
export function speechLang(tag: string): string {
  const t = (tag || '').toLowerCase();
  if (!t.startsWith('zh')) return 'en-US';
  // Traditional-script regions get the Traditional recognizer; everything
  // else Chinese gets Simplified.
  return /hant|-tw|-hk|-mo/.test(t) ? 'zh-TW' : 'zh-CN';
}

export class Dictation {
  private session: { cancel(): void; stop(): void; level(): number } | null = null;
  private levels: number[] = [];
  private frame = 0;

  constructor(private umicat: ThreeUmicat, private handlers: DictationHandlers) {}

  get supported(): boolean { return this.umicat.voice.supported(); }
  get listening(): boolean { return !!this.session; }

  /** Start, or finish if already going. */
  async toggle(): Promise<void> {
    if (this.session) { this.session.stop(); return; }
    this.handlers.onState(true);
    const session = await this.umicat.voice.start(speechLang(this.umicat.locale), {
      onPartial: () => { /* the meter is what moves while they speak */ },
      onFinal: (text) => { const said = text.trim(); if (said) this.handlers.onFinal(said); },
      onError: (kind) => this.handlers.onError?.(kind),
      onEnd: () => this.stop(),
    });
    if (!session) { this.stop(); return; }
    this.session = session;
  }

  stop(): void {
    // Cleared BEFORE cancelling, and that order is the whole of it: `cancel()`
    // ends the recognition, which fires `onEnd`, which calls this — so
    // cancelling first recurses until the stack gives out.
    const session = this.session;
    this.session = null;
    session?.cancel();
    cancelAnimationFrame(this.frame);
    this.levels = [];
    this.handlers.onState(false);
  }

  /**
   * Drive a row of bars from the microphone.
   *
   * `level()` is the SDK's own RMS — the same number through the native
   * recogniser on a phone as through Web Audio in a browser, so nothing here
   * branches on which is listening. The bars hold the last few hundred
   * milliseconds rather than this instant, or the meter reads as a flicker.
   */
  meter(bars: HTMLElement[]): void {
    cancelAnimationFrame(this.frame);
    const tick = (): void => {
      if (!this.session) return;
      this.levels.push(Math.min(1, Math.max(0, this.session.level())));
      if (this.levels.length > bars.length) this.levels.shift();
      for (let i = 0; i < bars.length; i++) {
        const v = this.levels[this.levels.length - bars.length + i] ?? 0;
        // A floor, so silence is a flat row of dots rather than nothing at
        // all — "hearing nothing" and "not recording" have to look different.
        bars[i].style.height = `${Math.round(3 + Math.min(1, v * 2.2) * 15)}px`;
      }
      this.frame = requestAnimationFrame(tick);
    };
    tick();
  }
}

/** The markup for a meter, so both fields draw the same one. */
export const waveBars = (): string => `<div class="wave">${'<i></i>'.repeat(BARS)}</div>`;
