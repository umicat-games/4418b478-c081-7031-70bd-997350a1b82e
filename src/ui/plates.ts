// Who is sitting at the table, on either side of the board.
//
// A square board on a wide screen leaves the two sides empty, and they were
// empty: the only things out there were a status line in one corner and a
// chat pill in the other. What belongs in that space is what would be there
// at a real table — the two players. A face, a name, the colour they are
// playing, and the one number that is theirs (here, the stones they have
// taken).
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
//   • **It gets out of the way rather than getting smaller.** When the chat
//     panel opens it takes the right-hand side and the board slides left;
//     there is no honest way to keep two seats in what is left, so they go.
//     Same when the board itself grows to fill a narrow screen.
import './plates.css';

const PERSON = '<svg viewBox="0 0 24 24"><circle cx="12" cy="8.5" r="3.6"/>'
  + '<path d="M5 20c0-3.6 3.1-5.6 7-5.6s7 2 7 5.6"/></svg>';

export interface Seat {
  /** What to call them. Already resolved — this module does not know about
   *  sign-in, or that an engine has no account. */
  name: string;
  /** A picture, if there is one. Anything that fails to load falls back to
   *  the initial, which falls back to a shape. */
  avatar?: string | null;
  colour: 'black' | 'white';
  /** The line under the name. Empty is fine and keeps its space. */
  stat?: string;
  /** Whose turn it is. Exactly one seat should have this. */
  active?: boolean;
}

/** How far a seat sits from the edge of the board, and how little room it will
 *  put up with before leaving. */
const GAP = 22;
const MIN_EDGE = 8;

export class Plates {
  private el: HTMLDivElement;
  private seats: Record<'left' | 'right', HTMLDivElement>;

  constructor() {
    this.el = document.createElement('div');
    this.el.id = 'plates';
    this.el.hidden = true;
    this.el.innerHTML = ['left', 'right']
      .map((side) => `<div class="seat ${side}">
        <div class="face"><span class="letter"></span><i class="stone"></i></div>
        <div class="name"></div>
        <div class="stat"></div>
      </div>`)
      .join('');
    document.body.appendChild(this.el);
    this.seats = {
      left: this.el.querySelector('.seat.left')!,
      right: this.el.querySelector('.seat.right')!,
    };
  }

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
    const name = el.querySelector('.name') as HTMLDivElement;
    const stat = el.querySelector('.stat') as HTMLDivElement;

    if (name.textContent !== seat.name) name.textContent = seat.name;
    const line = seat.stat ?? '';
    if (stat.textContent !== line) stat.textContent = line;
    el.classList.toggle('active', !!seat.active);

    const stone = face.querySelector('.stone') as HTMLElement;
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
      // A picture that does not arrive leaves the initial showing rather than
      // a broken-image glyph in a nameplate.
      img.onerror = (): void => { img.remove(); face.dataset.src = ''; };
      img.src = want;
      face.appendChild(img);
      letter.textContent = '';
      letter.innerHTML = '';
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
   * `boardLeft` / `boardRight` are the board's own edges in CSS pixels; `midY`
   * is where its middle is, which is what the seats line up with. If either
   * side cannot take a whole seat with a margin to spare, BOTH go — one seat
   * on its own reads as a bug rather than as a design.
   */
  place(boardLeft: number, boardRight: number, midY: number): void {
    const seat = this.seats.left;
    const w = seat.offsetWidth || 132;
    const need = w + GAP + MIN_EDGE;
    const fits = boardLeft >= need && window.innerWidth - boardRight >= need;
    this.seats.left.hidden = !fits;
    this.seats.right.hidden = !fits;
    if (!fits) return;

    const top = `${Math.round(midY)}px`;
    this.seats.left.style.left = `${Math.round(Math.max(MIN_EDGE, boardLeft - GAP - w))}px`;
    this.seats.left.style.top = top;
    this.seats.right.style.left =
      `${Math.round(Math.min(window.innerWidth - MIN_EDGE - w, boardRight + GAP))}px`;
    this.seats.right.style.top = top;
  }
}
