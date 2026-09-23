// The chat panel: one line at the top when it is closed, a column down the
// right when it is open. See chat.css for why it lives where it does.
//
// It knows nothing about Go and nothing about the AI. It shows messages and
// reports what the player typed or said — so the coach can be swapped, muted or
// unavailable (signed out, out of credits) without any of that reaching here.
import './buttons.css';
import './chat.css';
import { t } from '../i18n';
import { Dictation, waveBars } from './dictation';
import { stripAnchors } from './speech';
import type { ChatMessage } from './coach';
import type { ThreeUmicat } from '@umicat/three-sdk';

const MIC = '<svg viewBox="0 0 24 24"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/></svg>';
/** A stop square, because a mic that is already listening is not an invitation
 *  to start — it is the thing you press to finish. */
const STOP = '<svg viewBox="0 0 24 24"><rect x="7" y="7" width="10" height="10" rx="2" fill="currentColor" stroke="none"/></svg>';
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
  /** The other player's name, when this is a table and not a lesson. */
  private peer: string | null = null;
  private thinking = false;
  private messages: ChatMessage[] = [];
  private bars: HTMLElement[] = [];
  private dictation!: Dictation;
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
        <div class="field">${waveBars()}<input type="text" autocomplete="off" /></div>
        <button class="mic lift dark" hidden>${MIC}</button>
        <button class="send lift" title="Send">${SEND}</button>
      </div>`;
    document.body.appendChild(this.el);

    this.log = this.el.querySelector('.log')!;
    this.pillText = this.el.querySelector('.pill .text')!;
    this.input = this.el.querySelector('input')!;
    this.micBtn = this.el.querySelector('.mic')!;
    this.bars = [...this.el.querySelectorAll('.wave i')] as HTMLElement[];

    this.el.querySelector('.pill')!.addEventListener('click', () => this.toggle());
    this.el.querySelector('.send')!.addEventListener('click', () => this.send());
    this.input.addEventListener('keydown', (e) => { if (e.key === 'Enter') this.send(); });
    this.micBtn.addEventListener('click', () => void this.toggleMic());

    this.dictation = new Dictation(umicat, {
      onFinal: (text) => {
        // Into the field, never straight out: recognition mishears, and these
        // sentences are full of coordinates.
        const prefix = this.draft ? `${this.draft.replace(/\s+$/, '')} ` : '';
        this.draft = '';
        this.input.value = prefix + text;
        this.input.focus();
      },
      onState: (listening) => {
        this.el.classList.toggle('listening', listening);
        this.micBtn.classList.toggle('listening', listening);
        this.micBtn.innerHTML = listening ? STOP : MIC;
        this.micBtn.title = t(listening ? 'chat.stopRecording' : 'chat.speak');
        if (listening) {
          this.draft = this.input.value;
          this.input.value = '';
          this.input.placeholder = '';
          this.dictation.meter(this.bars);
        } else {
          this.input.placeholder = t('chat.ask');
          if (!this.input.value && this.draft) this.input.value = this.draft;
          this.draft = '';
        }
      },
      onError: (kind) => { this.input.placeholder = t(kind === 'not-allowed' ? 'chat.micBlocked' : 'chat.micRetry'); },
    });
    // Only offer the mic where speech actually works. On a surface with neither
    // the browser's recogniser nor a native host bridge, a mic button is a
    // button that does nothing — worse than no button.
    if (this.dictation.supported) this.micBtn.hidden = false;
    this.relabel();
  }

  /**
   * Who this panel is a conversation WITH.
   *
   * `null` is the assistant, which is what it was built for. A name is the
   * person on the other side of the board — and then it must say so, because
   * a panel headed "Assistant" with a box that says "Ask the assistant…" is
   * the game telling a player their opponent is a robot.
   */
  setPeer(name: string | null): void {
    this.peer = name;
    this.relabel();
  }

  /** Re-read every fixed string. Called when the UI language changes under us —
   *  which it does the first time a player types in Chinese. */
  relabel(): void {
    this.el.querySelector('.pill .who')!.textContent = this.peer ?? t('chat.coach');
    this.el.querySelector('.pill .more')!.textContent = t(this.open ? 'chat.close' : 'chat.tap');
    this.input.placeholder = this.peer ? t('chat.sayTo', { name: this.peer }) : t('chat.ask');
    this.micBtn.title = t(this.dictation.listening ? 'chat.stopRecording' : 'chat.speak');
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
      this.dictation.stop();
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
    if (this.peer) {
      // The `[H8]` marker aims the bubble on the board; read as prose it is
      // noise, the same way it is for the assistant's own lines.
      this.pillText.textContent = last ? stripAnchors(last.text) : t('chat.nobodySaid');
      this.log.replaceChildren(...messages.map((m) => {
        const div = document.createElement('div');
        div.className = `msg ${m.from}`;
        div.textContent = stripAnchors(m.text);
        return div;
      }));
      if (this.open) this.scrollToEnd();
      return;
    }
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
    this.setOpen(true);
    await this.dictation.toggle();
  }

  /** Whether the panel currently covers part of the screen, so the board can
   *  give itself the remaining width instead of sitting behind the panel. */
  get isOpen(): boolean { return this.open; }
  get busy(): boolean { return this.thinking; }
  get count(): number { return this.messages.length; }
}
