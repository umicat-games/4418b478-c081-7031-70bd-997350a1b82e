// The three things you can do to a square: play it, forget it, ask about it.
//
// The tick and the cross are mirror images about the point — that is what makes
// them read as a pair belonging to the stone under them. The first version laid
// all three out in a row and centred the ROW, which put the stone off to one
// side of its own buttons, because a row with two on the right and one on the
// left has its centre in the wrong place. "Ask" sits below instead: it is the
// odd one out, and it should look like it.
//
// They appear beside the point itself. Placing was a button in the bottom-left
// corner on touch and a bare click on a mouse — two rules, and the touch one
// made the player look away from the stone they were aiming at to press
// something in a corner. One rule now, in one place, on every device.
//
// "Ask" is the other half of the assistant being able to point at the board:
// the player can point back. Tapping a piece and asking about THAT is how a
// person sitting at a board asks a question, and it beats typing a coordinate
// they have to work out first.
//
// **They move out of the way of the board.** A button standing on a square is
// a square the player cannot tap, and on a xiangqi board the squares around
// the piece in hand are exactly where it is allowed to GO — so a cluster in a
// fixed place is a cluster that sooner or later makes a legal move
// unplayable. `place()` is told which points must stay reachable and turns
// the whole cluster around the square until it stops covering them. It keeps
// the default arrangement (tick left, cross right) whenever that is free, so
// the positions are still learnable.
import './buttons.css';
import './pointactions.css';

const TICK = '<svg viewBox="0 0 24 24"><path d="M5 13l4.5 4.5L19 7"/></svg>';
const CROSS = '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg>';
/** A speech bubble, not a question mark: what this opens is a conversation
 *  about the point, and the same icon is what opens the log in the corner. */
const ASK = '<svg viewBox="0 0 24 24"><path d="M20.5 11.5a7.5 7.5 0 0 1-7.5 7.5H8.8L4.5 21.8V17A7.5 7.5 0 1 1 20.5 11.5z"/></svg>';

export interface PointActionsOptions {
  onConfirm(at: { x: number; y: number }): void;
  onCancel(): void;
  onAsk(at: { x: number; y: number }): void;
}

/** Which of the three are on offer. A tick over a square nothing can move to
 *  is a button that does nothing, which is how a player learns to stop
 *  trusting the buttons. */
export interface Offered {
  confirm?: boolean;
  cancel?: boolean;
  ask?: boolean;
}

/** How far apart, in degrees, the three buttons sit around the square: tick
 *  and cross opposite each other, ask between them and below. */
const SLOT = { confirm: 180, cancel: 0, ask: 90 } as const;
/** Half a button, plus enough that a fingertip on one is not on the other. */
const BUTTON_R = 21;

export class PointActions {
  private el: HTMLDivElement;
  private okBtn: HTMLButtonElement;
  private noBtn: HTMLButtonElement;
  private askBtn: HTMLButtonElement;
  private point: { x: number; y: number } | null = null;

  constructor(private opts: PointActionsOptions) {
    this.el = document.createElement('div');
    this.el.id = 'pointactions';
    this.el.hidden = true;
    this.el.innerHTML =
      `<button class="ok lift" title="Place">${TICK}</button>`
      + `<button class="no lift dark" title="Cancel">${CROSS}</button>`
      + `<button class="ask lift dark" title="Ask">${ASK}</button>`;
    document.body.appendChild(this.el);

    this.okBtn = this.el.querySelector('.ok')!;
    this.noBtn = this.el.querySelector('.no')!;
    this.askBtn = this.el.querySelector('.ask')!;

    this.okBtn.onclick = () => { const at = this.point; this.hide(); if (at) this.opts.onConfirm(at); };
    this.noBtn.onclick = () => { this.hide(); this.opts.onCancel(); };
    this.askBtn.onclick = () => { const at = this.point; this.hide(); if (at) this.opts.onAsk(at); };
  }

  get at(): { x: number; y: number } | null { return this.point; }
  get showing(): boolean { return !this.el.hidden; }

  /** Offer some of the actions for a square. */
  show(at: { x: number; y: number }, offer: Offered): void {
    this.point = at;
    this.okBtn.hidden = !offer.confirm;
    this.noBtn.hidden = !offer.cancel;
    this.askBtn.hidden = !offer.ask;
    this.el.hidden = !offer.confirm && !offer.cancel && !offer.ask;
  }

  hide(): void {
    this.el.hidden = true;
    this.point = null;
  }

  /**
   * Follow the square on screen, keeping off the points that must stay
   * tappable. Called whenever the board is redrawn, since that is when the
   * camera can have moved.
   *
   * `keepClear` is in screen pixels — the squares the piece in hand may move
   * to, and the piece itself. The cluster is turned in eighths of a circle
   * until it covers as few of them as possible; the default arrangement wins
   * ties, so the tick stays on the left unless staying there would cost the
   * player a move.
   */
  place(screen: { x: number; y: number }, spacing: number, keepClear: Array<{ x: number; y: number }> = []): void {
    // Far enough out to clear the piece (half its width) plus half a button,
    // plus a little air. Derived from the board's line spacing, so it holds at
    // every zoom level.
    const r = Math.max(spacing * 0.55, 22) + 22;
    this.el.style.left = `${Math.round(screen.x)}px`;
    this.el.style.top = `${Math.round(screen.y)}px`;

    const live: Array<[HTMLButtonElement, number]> = [
      [this.okBtn, SLOT.confirm], [this.noBtn, SLOT.cancel], [this.askBtn, SLOT.ask],
    ].filter(([b]) => !(b as HTMLButtonElement).hidden) as Array<[HTMLButtonElement, number]>;

    // How bad a rotation is, in three grades that are genuinely different:
    //
    //   a button ON a point the player needs is the bug this exists to fix —
    //   the move becomes unplayable, so it costs more than everything else
    //   put together;
    //   a button merely CROWDING one is a smaller thing: the dot is still
    //   hittable, it is just tight, and near the far edge of the board the
    //   squares are close enough together that some crowding is unavoidable;
    //   a button off the edge of the SCREEN is unusable, which is its own bug.
    //
    // Twenty-four angles rather than eight, because a chariot's destinations
    // lie along the two axes and the gap to thread is often a diagonal that
    // the eighths happen to miss.
    const covered = BUTTON_R + 8;
    const clearance = BUTTON_R + Math.max(8, spacing * 0.22);
    const cost = (turn: number): number => {
      let total = turn === 0 ? 0 : 1;
      for (const [, slot] of live) {
        const a = ((slot + turn) * Math.PI) / 180;
        const bx = screen.x + Math.cos(a) * r;
        const by = screen.y + Math.sin(a) * r;
        for (const p of keepClear) {
          const gap = Math.hypot(p.x - bx, p.y - by);
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
