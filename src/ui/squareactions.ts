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
//
// **They move out of the way of the board.** A button standing on a square is
// a square the player cannot tap — and the squares beside a piece in hand are
// often where it is allowed to GO, so a cluster in a fixed place makes some
// legal moves unreachable. Measured here before the fix: with the king on g1,
// the cross sat 33px from h1 on a 77px square, and pressing it only put the
// king down again — pick it up and the cross is back on h1, so g1-h1 could
// not be played at all. Same for a queen on d1 going to e1.
//
// So `place()` is told which points must stay tappable and turns the whole
// cluster around the square until it is off them, keeping the default
// arrangement whenever that is free so the positions stay learnable. Ported
// from Xiangqi with me, where a board full of chariots made it unmissable.
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

/** Which of the three are on offer. A tick that plays nothing is a button
 *  that teaches the player to stop trusting the buttons. */
export interface Offered {
  confirm?: boolean;
  cancel?: boolean;
  ask?: boolean;
}

/** Where the three sit around the square: tick and cross opposite each other,
 *  ask between them and below. */
const SLOT = { confirm: 180, cancel: 0, ask: 90 } as const;
/** Half a button, plus enough that a fingertip on one is not on the other. */
const BUTTON_R = 21;

export class SquareActions {
  private el: HTMLDivElement;
  private okBtn: HTMLButtonElement;
  private noBtn: HTMLButtonElement;
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
    this.noBtn = this.el.querySelector('.no')!;
    this.askBtn = this.el.querySelector('.ask')!;

    this.okBtn.onclick = () => { const at = this.square; this.hide(); if (at) this.opts.onConfirm(at); };
    this.noBtn.onclick = () => { this.hide(); this.opts.onCancel(); };
    this.askBtn.onclick = () => { const at = this.square; this.hide(); if (at) this.opts.onAsk(at); };
  }

  get at(): Sq | null { return this.square; }
  get showing(): boolean { return !this.el.hidden; }

  /** Offer some of the actions for a square. */
  show(at: Sq, offer: Offered): void {
    this.square = at;
    this.okBtn.hidden = !offer.confirm;
    this.noBtn.hidden = !offer.cancel;
    this.askBtn.hidden = !offer.ask;
    this.el.hidden = !offer.confirm && !offer.cancel && !offer.ask;
  }

  hide(): void {
    this.el.hidden = true;
    this.square = null;
  }

  /**
   * Follow the square on screen, keeping off the squares that must stay
   * tappable. Called whenever the board is redrawn, since that is when the
   * camera can have moved.
   *
   * `keepClear` is in screen pixels — where the piece in hand may go, and the
   * piece itself. The cluster is turned in fifteen-degree steps until it
   * covers as few of them as possible; the default arrangement wins ties, so
   * the tick stays on the left unless staying there would cost the player a
   * move.
   */
  place(screen: { x: number; y: number }, spacing: number, keepClear: Array<{ x: number; y: number }> = []): void {
    // Far enough out to clear the piece (half a square) plus half a button,
    // plus a little air. Derived from the board's square size, so it holds at
    // every zoom level.
    const r = Math.max(spacing * 0.55, 22) + 22;
    this.el.style.left = `${Math.round(screen.x)}px`;
    this.el.style.top = `${Math.round(screen.y)}px`;

    const live: Array<[HTMLButtonElement, number]> =
      ([[this.okBtn, SLOT.confirm], [this.noBtn, SLOT.cancel], [this.askBtn, SLOT.ask]] as Array<[HTMLButtonElement, number]>)
        .filter(([b]) => !b.hidden);

    // Three grades, because they are genuinely different things: a button ON
    // a square the player needs is the bug this exists to fix, crowding one is
    // minor, and a button off the edge of the screen is unusable.
    const covered = BUTTON_R + 8;
    const clearance = BUTTON_R + Math.max(8, spacing * 0.22);
    const cost = (turn: number): number => {
      let total = turn === 0 ? 0 : 1;
      for (const [, slot] of live) {
        const a = ((slot + turn) * Math.PI) / 180;
        const bx = screen.x + Math.cos(a) * r;
        const by = screen.y + Math.sin(a) * r;
        for (const q of keepClear) {
          const gap = Math.hypot(q.x - bx, q.y - by);
          if (gap < covered) total += 40;
          else if (gap < clearance) total += 4;
        }
        if (bx < BUTTON_R || bx > window.innerWidth - BUTTON_R
          || by < BUTTON_R || by > window.innerHeight - BUTTON_R) total += 8;
      }
      return total;
    };

    let best = 0, bestCost = Infinity;
    for (let turn = 0; turn < 360; turn += 15) {
      const c = cost(turn);
      if (c < bestCost) { bestCost = c; best = turn; }
    }

    for (const [button, slot] of live) {
      const a = ((slot + best) * Math.PI) / 180;
      button.style.transform =
        `translate(calc(-50% + ${Math.round(Math.cos(a) * r)}px), calc(-50% + ${Math.round(Math.sin(a) * r)}px))`;
    }
  }
}
