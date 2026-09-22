// Who is sitting at the table, on either side of the board.
//
// A square board on a wide screen leaves the two sides empty, and they were
// empty: the only things out there were a status line in one corner and a
// chat pill in the other. What belongs in that space is what would be there
// at a real table — the two players. A face, a name, the colour they are
// playing, and the numbers that are theirs.
//
// Three rules it is built on:
//
//   • **It is furniture, not UI.** `pointer-events: none`, nothing to press,
//     nothing that moves unless the game moved. A seat that can be tapped is
//     a seat someone will tap instead of the board.
//   • **It follows the BOARD, not the window.** `place()` is handed the
//     board's own screen edges, so the seats sit against the board the way
//     two people sit against a table, and a very wide monitor does not push
//     them into the far corners of the room.
//   • **It gets out of the way rather than getting silly.** One step down in
//     size for a narrower gap, and below that both seats go — when the chat
//     panel takes the right-hand side, and when the board grows to fill a
//     small screen. One seat on its own reads as a bug, not as a design.
import './plates.css';

const PERSON = '<svg viewBox="0 0 24 24"><circle cx="12" cy="8.5" r="3.6"/>'
  + '<path d="M5 20c0-3.6 3.1-5.6 7-5.6s7 2 7 5.6"/></svg>';

export interface Seat {
  /** What to call them. Already resolved — this module does not know about
   *  sign-in, or that an engine has no account. */
  name: string;
  /** A picture, if there is one (the platform's `user.avatar`). Anything that
   *  fails to load falls back to the initial, which falls back to a shape. */
  avatar?: string | null;
  colour: 'black' | 'white';
  /** The line under the name — how they play, what they have taken. Empty is
   *  fine and keeps its space. */
  meta?: string;
  /** Whose turn it is. Exactly one seat should have this. */
  active?: boolean;
}

/**
 * Where the two seats sit vertically.
 *
 * `level` puts both against the middle of the board, which is the quiet
 * arrangement. `stagger` lifts the near player and drops the far one, which
 * fills more of the empty wood and reads like two people at opposite corners
 * of a table rather than two entries in a list.
 */
export type SeatLayout = 'level' | 'stagger';

/** How far a seat sits from the edge of the board, how little room it will put
 *  up with, and the two widths it comes in. */
const GAP = 26;
const MIN_EDGE = 10;
const FULL = 224;
const TIGHT = 136;

export class Plates {
  private el: HTMLDivElement;
  private seats: Record<'left' | 'right', HTMLDivElement>;
  private layout: SeatLayout = 'stagger';

  constructor() {
    this.el = document.createElement('div');
    this.el.id = 'plates';
    this.el.hidden = true;
    this.el.innerHTML = ['left', 'right']
      .map((side) => `<div class="seat ${side}">
        <div class="face"><span class="letter"></span></div>
        <div class="text">
          <div class="line"><i class="stone"></i><span class="name"></span></div>
          <div class="meta"></div>
        </div>
      </div>`)
      .join('');
    document.body.appendChild(this.el);
    this.seats = {
      left: this.el.querySelector('.seat.left')!,
      right: this.el.querySelector('.seat.right')!,
    };
  }

  setLayout(layout: SeatLayout): void { this.layout = layout; }

  /** Fill both seats. Safe to call every time anything changes; it only
   *  touches what differs, so the avatar is not re-fetched on every move. */
  set(left: Seat, right: Seat): void {
    this.fill(this.seats.left, left);
    this.fill(this.seats.right, right);
    this.el.hidden = false;
  }

  hide(): void { this.el.hidden = true; }

  private fill(el: HTMLDivElement, seat: Seat): void {
    const face = el.querySelector('.face') as HTMLDivElement;
    const name = el.querySelector('.name') as HTMLElement;
    const meta = el.querySelector('.meta') as HTMLElement;

    if (name.textContent !== seat.name) name.textContent = seat.name;
    const line = seat.meta ?? '';
    if (meta.textContent !== line) meta.textContent = line;
    el.classList.toggle('active', !!seat.active);

    const stone = el.querySelector('.stone') as HTMLElement;
    stone.className = `stone ${seat.colour}`;

    // The picture. `dataset.src` is the guard against re-creating the <img>
    // (and re-fetching it) on every refresh, which at one refresh per move is
    // a request per move.
    const want = seat.avatar ?? '';
    if (face.dataset.src === want) return;
    face.dataset.src = want;
    face.querySelector('img')?.remove();
    const letter = face.querySelector('.letter') as HTMLElement;
    if (want) {
      const img = document.createElement('img');
      img.alt = '';
      // No `crossOrigin`: nothing here reads the pixels, and asking for CORS
      // on an image that does not need it is how a picture that would have
      // loaded fine ends up blocked.
      img.onerror = (): void => { img.remove(); face.dataset.src = ''; };
      img.src = want;
      face.appendChild(img);
      letter.textContent = '';
    } else {
      const initial = [...seat.name.trim()][0] ?? '';
      // A letter if there is one to take; the shape when the name starts with
      // something that is not a letter (an emoji, a bracket, a space).
      if (/\p{L}|\p{N}/u.test(initial)) letter.textContent = initial.toUpperCase();
      else letter.innerHTML = PERSON;
    }
  }

  /**
   * Sit the seats against the board.
   *
   * All four numbers are the BOARD's, in CSS pixels. If either side cannot
   * take a seat with a margin to spare, both go; if the gap is narrow but
   * usable, both shrink by one step. Either way the two sides match, because
   * two seats of different sizes is worse than no seats.
   */
  place(board: { left: number; right: number; top: number; bottom: number }): void {
    const room = Math.min(board.left, window.innerWidth - board.right);
    const tight = room < FULL + GAP + MIN_EDGE;
    const fits = room >= TIGHT + GAP + MIN_EDGE;
    this.el.classList.toggle('tight', tight);
    this.seats.left.hidden = !fits;
    this.seats.right.hidden = !fits;
    if (!fits) return;

    const w = tight ? TIGHT : FULL;
    const mid = (board.top + board.bottom) / 2;
    // A third of the way in from each end, which keeps a staggered seat beside
    // the board rather than off past its corner.
    const third = (board.bottom - board.top) / 3;
    const ys = this.layout === 'stagger'
      ? { left: mid - third, right: mid + third }
      : { left: mid, right: mid };

    this.seats.left.style.left = `${Math.round(Math.max(MIN_EDGE, board.left - GAP - w))}px`;
    this.seats.left.style.top = `${Math.round(ys.left)}px`;
    this.seats.right.style.left =
      `${Math.round(Math.min(window.innerWidth - MIN_EDGE - w, board.right + GAP))}px`;
    this.seats.right.style.top = `${Math.round(ys.right)}px`;
  }
}
