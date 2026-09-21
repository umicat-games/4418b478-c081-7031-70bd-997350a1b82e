// Whose turn it is, how everyone is doing, and the two buttons that open
// everything else.
//
// Two things, in two places, for two reasons. The turn line sits top-left
// where the eye lands, and it is the only thing on screen that changes every
// few seconds. The scoreboard sits top-right and is glanceable rather than
// readable: four colours in a fixed order, so "am I ahead?" is answered by the
// shape of it rather than by reading four numbers.
import './buttons.css';
import './hud.css';
import { COLOURS } from '../blokus/pieces';
import { PLAYERS } from '../blokus/game';
import { t } from '../i18n';

/**
 * A cog, with teeth.
 *
 * The first one here was a small circle with eight spokes radiating off it,
 * which is a SUN — every brightness control ever drawn looks exactly like
 * that, and that is what it was read as. A gear has to have a toothed outline
 * and a hole in the middle, or it is a different icon.
 */
const GEAR = '<svg viewBox="0 0 24 24"><path d="M10.3 2.8a1 1 0 0 1 1-.8h1.4a1 1 0 0 1 1 .8l.3 1.7a7.6 7.6 0 0 1 1.7 1l1.6-.6a1 1 0 0 1 1.2.4l.7 1.2a1 1 0 0 1-.2 1.3l-1.3 1.1a7.6 7.6 0 0 1 0 2l1.3 1.1a1 1 0 0 1 .2 1.3l-.7 1.2a1 1 0 0 1-1.2.4l-1.6-.6a7.6 7.6 0 0 1-1.7 1l-.3 1.7a1 1 0 0 1-1 .8h-1.4a1 1 0 0 1-1-.8l-.3-1.7a7.6 7.6 0 0 1-1.7-1l-1.6.6a1 1 0 0 1-1.2-.4l-.7-1.2a1 1 0 0 1 .2-1.3l1.3-1.1a7.6 7.6 0 0 1 0-2L4.1 8.8a1 1 0 0 1-.2-1.3l.7-1.2a1 1 0 0 1 1.2-.4l1.6.6a7.6 7.6 0 0 1 1.7-1z"/><circle cx="12" cy="12" r="2.9"/></svg>';
const PLUS = '<svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>';
const MINUS = '<svg viewBox="0 0 24 24"><path d="M5 12h14"/></svg>';
const TALK = '<svg viewBox="0 0 24 24"><path d="M21 12a8 8 0 0 1-8 8H7l-4 3 1.2-4.3A8 8 0 1 1 21 12Z"/></svg>';

export interface HudOptions {
  onMenu(): void;
  onChat(): void;
  /** In and out. A pinch does the same thing, but a pinch is a gesture
   *  nobody is told about — and on a twenty-square board seen on a phone,
   *  zooming is not an advanced feature, it is how you read the board. */
  onZoom(factor: number): void;
}

export interface Standing {
  /** Squares placed. */
  score: number;
  /** Squares still in hand. */
  left: number;
  /** What to call them: a display name online, a colour otherwise. */
  name: string;
  bot: boolean;
}

export class Hud {
  private el: HTMLElement;
  private line: HTMLDivElement;
  private tip: HTMLDivElement;
  private board: HTMLDivElement;
  private chatBtn: HTMLButtonElement;
  private zoomer!: HTMLDivElement;
  private unread = 0;

  constructor(host: HTMLElement, opts: HudOptions) {
    this.el = host;
    // Appended, never assigned: `hud.textContent = …` wipes every child the
    // HUD has, including the platform's.
    const wrap = document.createElement('div');
    wrap.className = 'game-hud';
    wrap.innerHTML = `
      <div class="turn"></div>
      <div class="tip"></div>
      <div class="bar"></div>`;
    this.el.appendChild(wrap);

    this.line = wrap.querySelector('.turn')!;
    this.tip = wrap.querySelector('.tip')!;
    const bar = wrap.querySelector('.bar')!;

    this.chatBtn = document.createElement('button');
    this.chatBtn.className = 'lift dark icon';
    this.chatBtn.innerHTML = TALK;
    this.chatBtn.title = t('act.chat');
    this.chatBtn.hidden = true;
    this.chatBtn.onclick = () => { this.clearUnread(); opts.onChat(); };

    const gear = document.createElement('button');
    gear.className = 'lift dark icon';
    gear.innerHTML = GEAR;
    gear.title = t('act.settings');
    gear.onclick = () => opts.onMenu();

    bar.append(this.chatBtn, gear);

    this.board = document.createElement('div');
    this.board.className = 'standings';
    document.body.appendChild(this.board);

    // Down the right-hand edge, where a right thumb already is, and clear of
    // both the scoreboard above and the tray below.
    this.zoomer = document.createElement('div');
    this.zoomer.className = 'zoomer';
    const zoomBtn = (glyph: string, factor: number, title: string): HTMLButtonElement => {
      const b = document.createElement('button');
      b.className = 'lift dark icon';
      b.innerHTML = glyph;
      b.title = title;
      b.onclick = () => opts.onZoom(factor);
      this.zoomer.appendChild(b);
      return b;
    };
    zoomBtn(PLUS, 1.35, t('act.zoomIn'));
    zoomBtn(MINUS, 1 / 1.35, t('act.zoomOut'));
    document.body.appendChild(this.zoomer);
  }

  /** Online games have somebody to talk to; solo games do not, and a chat
   *  button with nobody on the other end is a button that lies. */
  showChat(on: boolean): void { this.chatBtn.hidden = !on; }

  /** A dot on the chat button. Cleared by opening it — the panel is where
   *  the message is, so opening it IS reading it. */
  bumpUnread(): void {
    this.unread++;
    this.chatBtn.classList.add('dot');
  }

  clearUnread(): void {
    this.unread = 0;
    this.chatBtn.classList.remove('dot');
  }

  get unreadCount(): number { return this.unread; }

  /** The sentence at the top-left. `tip` is the quieter second line — how to
   *  do the thing the first line just asked for. */
  say(line: string, tip = ''): void {
    this.line.textContent = line;
    this.tip.textContent = tip;
  }

  /** Paint the turn line in whoever's colour it is about, so "red to play"
   *  is legible before it is read. */
  tint(player: number | null): void {
    this.line.style.color = player === null
      ? '#f3f4fa'
      : `#${COLOURS[player].toString(16).padStart(6, '0')}`;
  }

  /** The scoreboard. Four rows always, in seat order: a table whose rows move
   *  around as the lead changes is a table nobody can read at a glance. */
  standings(rows: Standing[], turn: number, mine: number): void {
    this.board.replaceChildren(...rows.slice(0, PLAYERS).map((row, seat) => {
      const el = document.createElement('div');
      el.className = 'stand'
        + (seat === turn ? ' on' : '')
        + (seat === mine ? ' mine' : '');
      const dot = document.createElement('span');
      dot.className = 'dot';
      dot.style.background = `#${COLOURS[seat].toString(16).padStart(6, '0')}`;
      const who = document.createElement('span');
      who.className = 'who';
      who.textContent = row.name;
      const score = document.createElement('span');
      score.className = 'score';
      score.textContent = String(row.score);
      const left = document.createElement('span');
      left.className = 'left';
      left.textContent = t('hud.left', { n: row.left });
      el.append(dot, who, score, left);
      return el;
    }));
  }

  hide(on: boolean): void {
    this.el.classList.toggle('gone', on);
    this.board.classList.toggle('gone', on);
    this.zoomer.classList.toggle('gone', on);
  }
}
