// Table talk: what the people at the board say to each other.
//
// It knows nothing about the game. Messages go in, typed text comes out — so
// the room, the seats and whose turn it is can all change without any of it
// reaching here.
//
// The composer is a real `<input>`, which is not an implementation detail:
// it is the only way to get an IME, paste, autocorrect and a soft keyboard on
// a phone. The 2D game had to fight its engine for this; in a three.js game
// the DOM is already where the UI lives, so there is nothing to fight.
import './buttons.css';
import './chat.css';
import { MAX_CHAT_TEXT_LEN } from '@umicat/platform-sdk';
import { t } from '../i18n';

const SEND = '<svg viewBox="0 0 24 24"><path d="M4 12h15M13 6l6 6-6 6"/></svg>';

export interface Line {
  text: string;
  /** A join or a leave, rather than something somebody said. */
  system?: boolean;
  /** This player's own message: shown on the right, with no name on it. */
  mine?: boolean;
  /** Who said it, and in what colour — the seat they are sitting in. */
  name?: string;
  colour?: number;
}

export interface ChatOptions {
  onSend(text: string): void;
  /** Called when the panel opens or closes — the board reframes itself so the
   *  panel never lands on top of it. */
  onLayout(open: boolean): void;
}

/** How much history a panel keeps. Past this, the top is dropped: nobody
 *  scrolls back through a thousand lines of a board game, and an unbounded
 *  array in a tab left open for an evening is a leak. */
const MAX_LINES = 200;

export class ChatPanel {
  readonly el: HTMLDivElement;
  private log: HTMLDivElement;
  private input: HTMLInputElement;
  private lines: Line[] = [];
  private open = false;

  constructor(private opts: ChatOptions) {
    this.el = document.createElement('div');
    this.el.id = 'chat';
    this.el.hidden = true;
    this.el.innerHTML = `
      <div class="head"><span class="who"></span><button class="close">×</button></div>
      <div class="log"></div>
      <div class="composer">
        <input type="text" autocomplete="off" />
        <button class="send lift">${SEND}</button>
      </div>`;
    document.body.appendChild(this.el);

    this.log = this.el.querySelector('.log')!;
    this.input = this.el.querySelector('input')!;
    this.input.maxLength = MAX_CHAT_TEXT_LEN;
    // The things that mangle chat text on a phone if left on.
    this.input.setAttribute('autocorrect', 'off');
    this.input.setAttribute('autocapitalize', 'sentences');
    this.input.setAttribute('enterkeyhint', 'send');

    (this.el.querySelector('.close') as HTMLButtonElement).onclick = () => this.setOpen(false);
    (this.el.querySelector('.send') as HTMLButtonElement).onclick = () => this.send();
    this.input.addEventListener('keydown', (e) => {
      // `isComposing` is the IME guard: pressing Enter to accept a Chinese
      // candidate would otherwise send half a word.
      if (e.key === 'Enter' && !e.isComposing) this.send();
    });
    this.relabel();
  }

  relabel(): void {
    this.el.querySelector('.who')!.textContent = t('chat.title');
    this.input.placeholder = t('chat.say');
    this.render();
  }

  get isOpen(): boolean { return this.open; }

  toggle(): void { this.setOpen(!this.open); }

  setOpen(open: boolean): void {
    if (open === this.open) return;
    this.open = open;
    this.el.hidden = !open;
    document.body.classList.toggle('chatting', open);
    if (open) {
      this.scrollToEnd();
      // Not focused on touch: focusing opens the keyboard over the board,
      // and somebody opening the panel to READ what was said did not ask for
      // half the screen to disappear.
      if (!matchMedia('(pointer: coarse)').matches) this.input.focus();
    } else {
      this.input.blur();
    }
    this.opts.onLayout(open);
  }

  /** How much of the screen the panel covers, for the camera's benefit. */
  get width(): number {
    return this.open ? this.el.getBoundingClientRect().width + 24 : 0;
  }

  push(line: Line): void {
    this.lines.push(line);
    if (this.lines.length > MAX_LINES) this.lines.splice(0, this.lines.length - MAX_LINES);
    this.render();
  }

  private render(): void {
    if (this.lines.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'empty';
      empty.textContent = t('chat.empty');
      this.log.replaceChildren(empty);
      return;
    }
    this.log.replaceChildren(...this.lines.map((line) => {
      const el = document.createElement('div');
      el.className = 'msg' + (line.system ? ' system' : line.mine ? ' mine' : ' theirs');
      if (!line.system && !line.mine && line.name) {
        const who = document.createElement('span');
        who.className = 'name';
        who.textContent = line.name;
        if (line.colour !== undefined) {
          who.style.color = `#${line.colour.toString(16).padStart(6, '0')}`;
        }
        el.appendChild(who);
      }
      const body = document.createElement('span');
      body.className = 'text';
      // As text, never as markup: what another player typed is content.
      body.textContent = line.text;
      el.appendChild(body);
      return el;
    }));
    if (this.open) this.scrollToEnd();
  }

  private send(): void {
    const text = this.input.value.trim();
    if (!text) return;
    this.input.value = '';
    this.opts.onSend(text);
  }

  private scrollToEnd(): void {
    // After replaceChildren the new heights are not laid out yet.
    requestAnimationFrame(() => { this.log.scrollTop = this.log.scrollHeight; });
  }
}
