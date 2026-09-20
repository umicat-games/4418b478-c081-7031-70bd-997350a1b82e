// The chat panel: one line at the top when it is closed, a column down the
// right when it is open. See chat.css for why it lives where it does.
//
// It knows nothing about Go and nothing about the AI. It shows messages and
// reports what the player typed or said — so the coach can be swapped, muted or
// unavailable (signed out, out of credits) without any of that reaching here.
import './buttons.css';
import './chat.css';
import { t } from '../i18n';
import { stripAnchors } from './speech';
import type { ChatMessage } from '../coach/coach';
import type { ThreeUmicat } from '@umicat/three-sdk';

const MIC = '<svg viewBox="0 0 24 24"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/></svg>';
/** A stop square, because a mic that is already listening is not an invitation
 *  to start — it is the thing you press to finish. */
const STOP = '<svg viewBox="0 0 24 24"><rect x="7" y="7" width="10" height="10" rx="2" fill="currentColor" stroke="none"/></svg>';
/** How many bars the level meter has. Enough to read as a waveform, few enough
 *  that each one is a chunky block rather than a hair. */
const BARS = 22;
const SEND = '<svg viewBox="0 0 24 24"><path d="M4 12h15M13 6l6 6-6 6"/></svg>';

export interface ChatOptions {
  onSend(text: string): void;
  /** Called when the panel opens or closes — the board reframes itself so the
   *  panel never lands on top of it. */
  onLayout?(open: boolean): void;
}

export class ChatPanel {
  readonly el: HTMLDivElement;
  private log: HTMLDivElement;
  private pillText: HTMLSpanElement;
  private input: HTMLInputElement;
  private micBtn: HTMLButtonElement;
  private open = false;
  private thinking = false;
  private messages: ChatMessage[] = [];
  private listening: { cancel(): void; stop(): void; level(): number } | null = null;
  private waveEl!: HTMLDivElement;
  private bars: HTMLElement[] = [];
  /** The last `BARS` loudness readings, newest last — the meter is a picture of
   *  the recent past, not of this instant, or it reads as a flicker. */
  private levels: number[] = [];
  private waveFrame = 0;
  /** Whatever was half-typed when the mic was opened, to be put back if the
   *  player says nothing and it closes again. */
  private draft = '';
  /** The bubble on the board is saying this already. */
  private echoed = false;

  constructor(private umicat: ThreeUmicat, private opts: ChatOptions) {
    this.el = document.createElement('div');
    this.el.id = 'chat';
    this.el.className = 'collapsed';
    this.el.innerHTML = `
      <div class="pill"><span class="who"></span><span class="text"></span><span class="more"></span></div>
      <div class="log"></div>
      <div class="composer">
        <div class="field"><div class="wave"></div><input type="text" autocomplete="off" /></div>
        <button class="mic lift dark" hidden>${MIC}</button>
        <button class="send lift" title="Send">${SEND}</button>
      </div>`;
    document.body.appendChild(this.el);

    this.log = this.el.querySelector('.log')!;
    this.pillText = this.el.querySelector('.pill .text')!;
    this.input = this.el.querySelector('input')!;
    this.micBtn = this.el.querySelector('.mic')!;
    this.waveEl = this.el.querySelector('.wave')!;
    this.waveEl.innerHTML = '<i></i>'.repeat(BARS);
    this.bars = [...this.waveEl.querySelectorAll('i')];

    this.el.querySelector('.pill')!.addEventListener('click', () => this.toggle());
    this.el.querySelector('.send')!.addEventListener('click', () => this.send());
    this.input.addEventListener('keydown', (e) => { if (e.key === 'Enter') this.send(); });
    this.micBtn.addEventListener('click', () => void this.toggleMic());

    // Only offer the mic where speech actually works. On a surface with neither
    // the browser's recogniser nor a native host bridge, a mic button is a
    // button that does nothing — worse than no button.
    if (umicat.voice.supported()) this.micBtn.hidden = false;
    this.relabel();
  }

  /** Re-read every fixed string. Called when the UI language changes under us —
   *  which it does the first time a player types in Chinese. */
  relabel(): void {
    this.el.querySelector('.pill .who')!.textContent = t('chat.coach');
    this.el.querySelector('.pill .more')!.textContent = t(this.open ? 'chat.close' : 'chat.tap');
    this.input.placeholder = t('chat.ask');
    this.micBtn.title = t(this.listening ? 'chat.stopRecording' : 'chat.speak');
    this.render(this.messages, this.thinking);
  }

  toggle(): void { this.setOpen(!this.open); }

  setOpen(open: boolean): void {
    if (open === this.open) return;
    this.open = open;
    this.el.className = open ? 'open' : 'collapsed';
    if (open) {
      this.el.querySelector('.pill .more')!.textContent = t('chat.close');
      this.scrollToEnd();
    } else {
      this.el.querySelector('.pill .more')!.textContent = t('chat.tap');
      this.stopMic();
    }
    this.opts.onLayout?.(open);
  }

  /** While the coach's line is up on the board, the pill must not repeat it —
   *  the same sentence twice on one screen reads as a bug, and the pill's job
   *  in that moment is only to be the way into the conversation. */
  setEchoed(echoed: boolean): void {
    if (echoed === this.echoed) return;
    this.echoed = echoed;
    this.render(this.messages, this.thinking);
  }

  /** Redraw from the coach's message list. Cheap enough to call on every change:
   *  a Go conversation is tens of lines, not thousands. */
  render(messages: ChatMessage[], thinking: boolean): void {
    this.messages = messages;
    this.thinking = thinking;

    const last = [...messages].reverse().find((m) => m.from === 'coach');
    this.pillText.textContent = thinking ? t('chat.thinking')
      : this.echoed && !this.open ? ''
        : last ? stripAnchors(last.text) : t('chat.sayHello');

    this.log.replaceChildren(...messages.map((m) => {
      const div = document.createElement('div');
      div.className = `msg ${m.from}`;
      // The coach's `[C3]` markers are for the board, not for reading.
      div.textContent = m.from === 'coach' ? stripAnchors(m.text) : m.text;
      return div;
    }));
    if (thinking) {
      // Where the reply will appear, waiting. Three dots that MOVE: a static
      // ellipsis is indistinguishable from a message that says "…", which is
      // what this was and what it looked like.
      const div = document.createElement('div');
      div.className = 'msg coach thinking';
      div.innerHTML = '<i></i><i></i><i></i>';
      this.log.appendChild(div);
    }
    if (this.open) this.scrollToEnd();
  }

  /** Put words in the player's mouth — used for the opening line, so a new
   *  player does not have to think of something to say to get started. */
  prefill(text: string): void {
    this.input.value = text;
    this.setOpen(true);
    this.input.focus();
  }

  private send(): void {
    const text = this.input.value.trim();
    if (!text) return;
    this.input.value = '';
    this.setOpen(true);
    this.opts.onSend(text);
  }

  private scrollToEnd(): void {
    // After replaceChildren the new heights are not laid out yet.
    requestAnimationFrame(() => { this.log.scrollTop = this.log.scrollHeight; });
  }

  private async toggleMic(): Promise<void> {
    // Already listening: this press is "I have finished", which is what the
    // square says it is.
    if (this.listening) { this.listening.stop(); return; }
    this.setOpen(true);
    this.micBtn.classList.add('listening');
    this.micBtn.innerHTML = STOP;
    this.micBtn.title = t('chat.stopRecording');
    this.el.classList.add('listening');
    // The field belongs to the meter while the mic is open. A partial
    // transcript rewriting itself under a waveform is two things moving in the
    // same small box, and neither can be read; the words arrive when they are
    // final, which is the only version worth reading anyway.
    this.draft = this.input.value;
    this.input.value = '';
    this.input.placeholder = '';
    const session = await this.umicat.voice.start(this.umicat.locale === 'zh-CN' ? 'zh-CN' : 'en-US', {
      // Deliberately ignored — see above. The meter is the live feedback.
      onPartial: () => { /* the waveform is what moves while they speak */ },
      onFinal: (text) => {
        // Into the field, NOT straight out. Recognition mishears, and the
        // sentences this game gets are full of coordinates — "D4" and "the
        // top" are exactly what it mangles — so sending unseen means the
        // companion answers a question nobody asked. They can read it, fix it,
        // and press send.
        //
        // Anything they had typed before reaching for the mic is kept in front
        // of it: tapping a stone fills the field with "D4: " and then speaking
        // the question is the natural way to use both.
        const spoken = text.trim();
        if (!spoken) return;
        const prefix = this.draft ? `${this.draft.replace(/\s+$/, '')} ` : '';
        this.draft = '';
        this.input.value = prefix + spoken;
        this.input.focus();
      },
      onError: (kind) => {
        this.input.placeholder = t(kind === 'not-allowed' ? 'chat.micBlocked' : 'chat.micRetry');
      },
      onEnd: () => { this.stopMic(); },
    });
    if (!session) { this.stopMic(); return; }
    this.listening = session;
    this.drawWave();
  }

  /**
   * The level meter, while the mic is open.
   *
   * `level()` is the SDK's own RMS off the microphone — the same number on a
   * phone through the native recogniser as in a browser through Web Audio, so
   * nothing here branches on which one is listening. A waveform is the one
   * thing that tells someone their microphone is actually hearing them; a
   * button that has merely changed colour does not.
   */
  private drawWave(): void {
    cancelAnimationFrame(this.waveFrame);
    const tick = (): void => {
      if (!this.listening) return;
      const level = Math.min(1, Math.max(0, this.listening.level()));
      this.levels.push(level);
      if (this.levels.length > BARS) this.levels.shift();
      for (let i = 0; i < BARS; i++) {
        // Oldest on the left, so the picture scrolls the way reading does.
        const v = this.levels[this.levels.length - BARS + i] ?? 0;
        // A floor, so silence is a flat line of dots rather than nothing at
        // all — "no bars" and "not recording" have to look different.
        this.bars[i].style.height = `${Math.round(3 + Math.min(1, v * 2.2) * 15)}px`;
      }
      this.waveFrame = requestAnimationFrame(tick);
    };
    tick();
  }

  private stopMic(): void {
    // Cleared BEFORE cancelling, and that order is the whole of it: `cancel()`
    // ends the recognition, which fires `onEnd`, which calls this — so
    // cancelling first recurses until the stack gives out. Measured: "Maximum
    // call stack size exceeded" on every stop.
    const session = this.listening;
    this.listening = null;
    session?.cancel();
    cancelAnimationFrame(this.waveFrame);
    this.levels = [];
    this.micBtn.classList.remove('listening');
    this.micBtn.innerHTML = MIC;
    this.micBtn.title = t('chat.speak');
    this.el.classList.remove('listening');
    this.input.placeholder = t('chat.ask');
    // Nothing was said: give them back what they had been typing.
    if (!this.input.value && this.draft) this.input.value = this.draft;
    this.draft = '';
  }

  /** Whether the panel currently covers part of the screen, so the board can
   *  give itself the remaining width instead of sitting behind the panel. */
  get isOpen(): boolean { return this.open; }
  get busy(): boolean { return this.thinking; }
  get count(): number { return this.messages.length; }
}
