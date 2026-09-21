// Place it, or take it back — beside the piece, not in a corner.
//
// The tick and the cross are mirror images about the piece's centre, which is
// what makes them read as a pair belonging to what is under them. A confirm
// button parked in the bottom corner makes the player look away from the
// thing they are aiming at in order to press something somewhere else, and on
// a phone that is the difference between playing the move you meant and the
// one next to it.
//
// The tick is only offered when the move is LEGAL. A tick that does nothing
// teaches a player to stop trusting the buttons; the refusal belongs on the
// ghost, which is already red.
import './buttons.css';
import './actions.css';
import type { Cell } from '../blokus/pieces';

const TICK = '<svg viewBox="0 0 24 24"><path d="M5 13l4.5 4.5L19 7"/></svg>';
const CROSS = '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg>';
const TURN = '<svg viewBox="0 0 24 24"><path d="M20 12a8 8 0 1 1-2.6-5.9"/><path d="M20 3.5V8h-4.5"/></svg>';

export interface ActionsOptions {
  onConfirm(): void;
  onCancel(): void;
  /** Turning the piece where it stands — the thing a player reaches for
   *  between aiming and confirming, and the one worth having under the thumb
   *  rather than back down in the tray. */
  onRotate(): void;
}

export class Actions {
  private el: HTMLDivElement;
  private ok: HTMLButtonElement;
  private centre: Cell | null = null;

  constructor(opts: ActionsOptions) {
    this.el = document.createElement('div');
    this.el.id = 'actions';
    this.el.hidden = true;
    this.el.innerHTML =
      `<button class="ok lift go">${TICK}</button>`
      + `<button class="no lift dark">${CROSS}</button>`
      + `<button class="turn lift dark">${TURN}</button>`;
    document.body.appendChild(this.el);

    this.ok = this.el.querySelector('.ok')!;
    this.ok.onclick = () => opts.onConfirm();
    (this.el.querySelector('.no') as HTMLButtonElement).onclick = () => opts.onCancel();
    (this.el.querySelector('.turn') as HTMLButtonElement).onclick = () => opts.onRotate();
  }

  get showing(): boolean { return !this.el.hidden; }
  /** The cell the buttons are hung from, so the caller can re-place them when
   *  the camera moves. */
  get at(): Cell | null { return this.centre; }

  show(centre: Cell, legal: boolean): void {
    this.centre = centre;
    this.ok.hidden = !legal;
    this.el.hidden = false;
  }

  hide(): void {
    this.el.hidden = true;
    this.centre = null;
  }

  /** Follow the piece on screen. Called whenever the board is redrawn, since
   *  that is when the camera can have moved. */
  place(screen: { x: number; y: number }, spacing: number): void {
    // Far enough out to clear the piece — a pentomino is up to five cells
    // across, so this is measured from the cell size and not fixed in pixels,
    // and it holds at every zoom level.
    const r = Math.max(spacing * 1.6, 44);
    this.el.style.setProperty('--r', `${Math.round(r)}px`);
    this.el.style.left = `${Math.round(screen.x)}px`;
    this.el.style.top = `${Math.round(screen.y)}px`;
  }
}
