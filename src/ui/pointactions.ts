// The three things you can do to a point: play it, forget it, ask about it.
//
// They appear beside the point itself. Placing was a button in the bottom-left
// corner on touch and a bare click on a mouse — two rules, and the touch one
// made the player look away from the stone they were aiming at to press
// something in a corner. One rule now, in one place, on every device.
//
// "Ask" is the other half of the coach being able to point at the board: the
// player can point back. Tapping a stone and asking about THAT is how a person
// sitting at a board asks a question, and it beats typing a coordinate they
// have to work out first.
import './buttons.css';
import './pointactions.css';

const TICK = '<svg viewBox="0 0 24 24"><path d="M5 13l4.5 4.5L19 7"/></svg>';
const CROSS = '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg>';
const ASK = '<svg viewBox="0 0 24 24"><path d="M9.2 9a3 3 0 1 1 4 2.8c-.8.3-1.2 1-1.2 1.8v.4"/><path d="M12 17.6v.01"/></svg>';

export interface PointActionsOptions {
  onConfirm(at: { x: number; y: number }): void;
  onCancel(): void;
  onAsk(at: { x: number; y: number }): void;
}

export class PointActions {
  private el: HTMLDivElement;
  private okBtn: HTMLButtonElement;
  private askBtn: HTMLButtonElement;
  private gap: HTMLSpanElement;
  private point: { x: number; y: number } | null = null;

  constructor(private opts: PointActionsOptions) {
    this.el = document.createElement('div');
    this.el.id = 'pointactions';
    this.el.hidden = true;
    this.el.innerHTML =
      `<button class="ok lift" title="Place">${TICK}</button>`
      + '<span class="gap"></span>'
      + `<button class="no lift dark" title="Cancel">${CROSS}</button>`
      + `<button class="ask lift dark" title="Ask">${ASK}</button>`;
    document.body.appendChild(this.el);

    this.okBtn = this.el.querySelector('.ok')!;
    this.askBtn = this.el.querySelector('.ask')!;
    this.gap = this.el.querySelector('.gap')!;

    this.okBtn.onclick = () => { const at = this.point; this.hide(); if (at) this.opts.onConfirm(at); };
    (this.el.querySelector('.no') as HTMLButtonElement).onclick = () => { this.hide(); this.opts.onCancel(); };
    this.askBtn.onclick = () => { const at = this.point; this.hide(); if (at) this.opts.onAsk(at); };
  }

  get at(): { x: number; y: number } | null { return this.point; }
  get showing(): boolean { return !this.el.hidden; }

  /**
   * Offer the actions for a point.
   *
   * `canPlace` is false for a point that already has a stone, or that the rules
   * refuse — and then only asking is offered. A tick over an occupied point
   * would be a button that does nothing, which is how a player learns to stop
   * trusting the buttons.
   */
  show(at: { x: number; y: number }, canPlace: boolean, canAsk: boolean): void {
    this.point = at;
    this.okBtn.hidden = !canPlace;
    this.askBtn.hidden = !canAsk;
    this.el.hidden = !canPlace && !canAsk;
  }

  hide(): void {
    this.el.hidden = true;
    this.point = null;
  }

  /** Follow the point on screen. Called every frame: the camera moves. */
  place(screen: { x: number; y: number }, spacing: number): void {
    // The gap is the stone's own width plus a little, so the two buttons sit
    // either side of it rather than on top of it.
    this.gap.style.width = `${Math.max(spacing * 1.15, 30)}px`;
    this.el.style.left = `${Math.round(screen.x)}px`;
    this.el.style.top = `${Math.round(screen.y)}px`;
  }
}
