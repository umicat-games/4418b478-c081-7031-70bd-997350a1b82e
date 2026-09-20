// The three things you can do to a square: play the move, forget it, ask about it.
//
// The tick and the cross are mirror images about the square — that is what
// makes them read as a pair belonging to the piece under them. "Ask" sits
// below: it is the odd one out, and it should look like it.
//
// They appear beside the square itself rather than in a corner. A confirm
// button in the bottom-left makes the player look away from the piece they
// are aiming at to press something somewhere else, and on a phone that is the
// difference between playing the move you meant and playing the one next to it.
//
// "Ask" is the other half of the companion being able to point at the board:
// the player can point back. Tapping a piece and asking about THAT is how a
// person sitting at a board asks a question, and it beats typing a square
// they have to work out first.
import './buttons.css';
import './squareactions.css';
import type { Sq } from '../chess/coords';

const TICK = '<svg viewBox="0 0 24 24"><path d="M5 13l4.5 4.5L19 7"/></svg>';
const CROSS = '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg>';
/** A speech bubble, not a question mark: what this opens is a conversation
 *  about the square, and the same icon is what opens the log in the corner. */
const ASK = '<svg viewBox="0 0 24 24"><path d="M20.5 11.5a7.5 7.5 0 0 1-7.5 7.5H8.8L4.5 21.8V17A7.5 7.5 0 1 1 20.5 11.5z"/></svg>';

export interface SquareActionsOptions {
  onConfirm(at: Sq): void;
  onCancel(): void;
  onAsk(at: Sq): void;
}

export class SquareActions {
  private el: HTMLDivElement;
  private okBtn: HTMLButtonElement;
  private askBtn: HTMLButtonElement;
  private square: Sq | null = null;

  constructor(private opts: SquareActionsOptions) {
    this.el = document.createElement('div');
    this.el.id = 'squareactions';
    this.el.hidden = true;
    this.el.innerHTML =
      `<button class="ok lift" title="Play">${TICK}</button>`
      + `<button class="no lift dark" title="Cancel">${CROSS}</button>`
      + `<button class="ask lift dark" title="Ask">${ASK}</button>`;
    document.body.appendChild(this.el);

    this.okBtn = this.el.querySelector('.ok')!;
    this.askBtn = this.el.querySelector('.ask')!;

    this.okBtn.onclick = () => { const at = this.square; this.hide(); if (at) this.opts.onConfirm(at); };
    (this.el.querySelector('.no') as HTMLButtonElement).onclick = () => { this.hide(); this.opts.onCancel(); };
    this.askBtn.onclick = () => { const at = this.square; this.hide(); if (at) this.opts.onAsk(at); };
  }

  get at(): Sq | null { return this.square; }
  get showing(): boolean { return !this.el.hidden; }

  /**
   * Offer the actions for a square.
   *
   * `canPlay` is false while the player has only picked a piece up and has
   * not said where it is going, and for a square nothing can reach. A tick
   * that plays nothing is a button that teaches the player to stop trusting
   * the buttons.
   */
  show(at: Sq, canPlay: boolean, canAsk: boolean): void {
    this.square = at;
    this.okBtn.hidden = !canPlay;
    this.askBtn.hidden = !canAsk;
    this.el.hidden = !canPlay && !canAsk;
  }

  hide(): void {
    this.el.hidden = true;
    this.square = null;
  }

  /** Follow the square on screen. Called whenever the board is redrawn, since
   *  that is when the camera can have moved. */
  place(screen: { x: number; y: number }, spacing: number): void {
    // Far enough out to clear the piece (half a square) plus half a button,
    // plus a little air. Derived from the board's square size, so it holds at
    // every zoom level.
    const r = Math.max(spacing * 0.55, 22) + 22;
    this.el.style.setProperty('--r', `${Math.round(r)}px`);
    this.el.style.left = `${Math.round(screen.x)}px`;
    this.el.style.top = `${Math.round(screen.y)}px`;
  }
}
