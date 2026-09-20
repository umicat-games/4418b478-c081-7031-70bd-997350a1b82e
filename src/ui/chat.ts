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
  private listening: { cancel(): void; stop(): void } | null = null;
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
        <input type="text" autocomplete="off" />
        <button class="mic lift dark" title="Speak" hidden>${MIC}</button>
        <button class="send lift" title="Send">${SEND}</button>
      </div>`;
    document.body.appendChild(this.el);

    this.log = this.el.querySelector('.log')!;
    this.pillText = this.el.querySelector('.pill .text')!;
    this.input = this.el.querySelector('input')!;
    this.micBtn = this.el.querySelector('.mic')!;

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
      const div = document.createElement('div');
      div.className = 'msg coach thinking';
      div.textContent = '…';
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
    if (this.listening) { this.listening.stop(); return; }
    this.setOpen(true);
    this.micBtn.classList.add('listening');
    const session = await this.umicat.voice.start(this.umicat.locale === 'zh-CN' ? 'zh-CN' : 'en-US', {
      onPartial: (text) => { this.input.value = text; },
      onFinal: (text) => {
        this.input.value = text.trim();
        // Speaking is a whole utterance; making someone then reach for a send
        // button is asking them to finish the sentence twice.
        if (this.input.value) this.send();
      },
      onError: (kind) => {
        this.input.placeholder = t(kind === 'not-allowed' ? 'chat.micBlocked' : 'chat.micRetry');
      },
      onEnd: () => { this.stopMic(); },
    });
    if (!session) { this.stopMic(); return; }
    this.listening = session;
  }

  private stopMic(): void {
    this.listening?.cancel();
    this.listening = null;
    this.micBtn.classList.remove('listening');
  }

  /** Whether the panel currently covers part of the screen, so the board can
   *  give itself the remaining width instead of sitting behind the panel. */
  get isOpen(): boolean { return this.open; }
  get busy(): boolean { return this.thinking; }
  get count(): number { return this.messages.length; }
}
