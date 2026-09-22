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
    this.el.style.left = `${Math.round(screen.x)}px`;
    this.el.style.top = `${Math.round(screen.y)}px`;

    /**
     * How far out to sit, in order of preference.
     *
     * The first one is the interesting one. On a board of INTERSECTIONS every
     * neighbour of the aimed-at point is itself a legal move, so no rotation
     * is free — a button one spacing out lands on one of them whatever angle
     * it is at. The middle of the four cells around a point is free, and that
     * is 0.707 of a spacing away, which is why it is tried first.
     *
     * The second is the old default (clear of a piece, plus air), the third
     * is further out for when the near ones are crowded. Never closer than a
     * button's own radius plus a little, or it sits on the stone the player
     * just aimed at.
     */
    /**
     * One spacing, HERE.
     *
     * `spacing` is measured once, at one edge of the board — but the camera
     * is a perspective one, so a cell near the player is wider on screen than
     * a cell at the back, and the lattice arithmetic below is out by that
     * much wherever it is used. The points that must stay clear are the
     * neighbours, so the nearest of them IS the local spacing; measured, the
     * difference is 43px against 48px in the middle of a 15 line board, which
     * is enough to put a button back on a point.
     */
    const nearest = keepClear.length
      ? Math.min(...keepClear.map((p) => Math.hypot(p.x - screen.x, p.y - screen.y)))
      : spacing;
    const unit = Math.max(12, Math.min(nearest, spacing * 1.6));

    const radii = [
      // The middle of the four cells around the point, and the middle of the
      // ones a ring further out. On a lattice these are the only places a
      // button is not standing on a point somebody might want to tap.
      unit * 0.707,
      unit * 1.581,
      // And the two that suit a board of CELLS, where the neighbours are a
      // whole square away and clearing the piece is what matters.
      Math.max(spacing * 0.55, 22) + 22,
      spacing * 1.15,
    ].filter((r) => r >= BUTTON_R + 6);
    if (!radii.length) radii.push(BUTTON_R + 16);

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
    const covered = BUTTON_R + 5;
    const clearance = BUTTON_R + Math.max(8, unit * 0.22);
    const cost = (turn: number, r: number, rIndex: number): number => {
      // Turning away from the arrangement the player has learned costs a
      // little; sitting further out than necessary costs a little more,
      // because a cluster that has drifted stops reading as belonging to the
      // point it is about.
      let total = (turn === 0 ? 0 : 1) + rIndex * 1.5;
      for (const [, slot] of live) {
        const a = ((slot + turn) * Math.PI) / 180;
        const bx = screen.x + Math.cos(a) * r;
        const by = screen.y + Math.sin(a) * r;
        for (const p of keepClear) {
          const gap = Math.hypot(p.x - bx, p.y - by);
          if (gap < covered) total += 40;
          else if (gap < clearance) total += 3;
        }
        // Sitting ON the point the player just aimed at hides the GHOST — the
        // preview of the move, which is the only thing the extra confirm tap
        // buys them. Weighted above a handful of crowding nudges: measured at
        // six, the cluster piled onto the stone every time, because the ring
        // of free cell-centres one step further out costs a nudge per button.
        if (Math.hypot(screen.x - bx, screen.y - by) < BUTTON_R + Math.max(10, spacing * 0.42)) total += 12;
        if (bx < BUTTON_R || bx > window.innerWidth - BUTTON_R
          || by < BUTTON_R || by > window.innerHeight - BUTTON_R) total += 8;
      }
      return total;
    };

    let best = 0, bestR = radii[0], bestCost = Infinity;
    radii.forEach((r, rIndex) => {
      // Five degrees rather than fifteen: the free angles on a lattice are
      // not multiples of fifteen (the middle of a 1.5-by-0.5 cell is at
      // eighteen and a half), and missing them by six degrees puts the button
      // back on a point.
      for (let turn = 0; turn < 360; turn += 5) {
        const c = cost(turn, r, rIndex);
        if (c < bestCost) { bestCost = c; best = turn; bestR = r; }
      }
    });

    for (const [button, slot] of live) {
      const a = ((slot + best) * Math.PI) / 180;
      button.style.transform =
        `translate(calc(-50% + ${Math.round(Math.cos(a) * bestR)}px), calc(-50% + ${Math.round(Math.sin(a) * bestR)}px))`;
    }
  }
}
