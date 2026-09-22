// The end of a game, as a dialog rather than as a line in the corner.
//
// A game that finishes deserves a beat. The status line at the bottom left is
// where "your move" lives, and a result printed in the same place, in the
// same type, reads as one more turn rather than as the end of something — the
// player has to notice the sentence changed.
//
// Three things belong here and nothing else does: WHAT HAPPENED (won, lost,
// drawn), WHY in one factual line the game itself can write, and the two
// things anybody wants next — another game, or out.
//
// It can be dismissed. The board underneath has the winning line lit on it,
// and a dialog that will not get out of the way of the thing it is telling
// you about is a dialog people learn to close before reading.
import './buttons.css';
import './gameover.css';
import { t } from '../i18n';

export interface GameOverOptions {
  /** Play again, on the same settings. */
  onAgain(): void;
  onTitle(): void;
}

export interface Result {
  /** "You win", "White wins", "A draw" — the headline, in the game's words. */
  title: string;
  /** One factual line: how it ended, in how many moves. */
  body: string;
  /** Colours the headline. Nothing else changes. */
  tone: 'win' | 'loss' | 'draw';
}

export class GameOver {
  private el: HTMLDivElement;
  private card: HTMLDivElement;
  private titleEl: HTMLDivElement;
  private bodyEl: HTMLDivElement;
  private noteEl: HTMLDivElement;

  constructor(private opts: GameOverOptions) {
    this.el = document.createElement('div');
    this.el.id = 'gameover';
    this.el.hidden = true;
    this.el.innerHTML = `
      <div class="card">
        <button class="close" title="${t('over.close')}" aria-label="${t('over.close')}">×</button>
        <div class="result"></div>
        <div class="body"></div>
        <div class="note"></div>
        <div class="buttons">
          <button class="again lift"></button>
          <button class="home lift quiet"></button>
        </div>
      </div>`;
    document.body.appendChild(this.el);

    this.card = this.el.querySelector('.card')!;
    this.titleEl = this.el.querySelector('.result')!;
    this.bodyEl = this.el.querySelector('.body')!;
    this.noteEl = this.el.querySelector('.note')!;

    const again = this.el.querySelector('.again') as HTMLButtonElement;
    const home = this.el.querySelector('.home') as HTMLButtonElement;
    again.textContent = t('over.again');
    home.textContent = t('over.toTitle');
    again.onclick = () => { this.hide(); this.opts.onAgain(); };
    home.onclick = () => { this.hide(); this.opts.onTitle(); };
    (this.el.querySelector('.close') as HTMLButtonElement).onclick = () => this.hide();
    // Tapping the dark part is the same as closing it — the board is what
    // they are reaching for.
    this.el.onclick = (e) => { if (e.target === this.el) this.hide(); };
  }

  get showing(): boolean { return !this.el.hidden; }

  show(result: Result): void {
    this.titleEl.textContent = result.title;
    this.titleEl.className = `result ${result.tone}`;
    this.bodyEl.textContent = result.body;
    this.noteEl.textContent = '';
    this.noteEl.hidden = true;
    this.el.hidden = false;
    // The animation replays on every showing, not just the first.
    this.card.classList.remove('in');
    void this.card.offsetWidth;
    this.card.classList.add('in');
  }

  /**
   * A line from the assistant, once it has one.
   *
   * It arrives seconds after the game ends — it is a round trip to a language
   * model — so it cannot be part of `show()`. It lands here rather than in a
   * speech bubble because the bubble would be behind this dialog, which is
   * the assistant talking to a screen the player cannot see.
   */
  note(text: string): void {
    if (!this.showing || !text.trim()) return;
    this.noteEl.textContent = text.trim();
    this.noteEl.hidden = false;
  }

  hide(): void { this.el.hidden = true; }
}
