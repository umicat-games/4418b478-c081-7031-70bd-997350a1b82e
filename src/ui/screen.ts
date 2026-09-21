// The front of house: one card, centred over the board.
//
// The title, the bot level, the rooms, the result — every screen that is not
// the game itself is this same card with different contents. One element that
// is rebuilt rather than four that are shown and hidden, because four screens
// that can each be left on by accident is four ways to end up with two of them
// on screen at once.
//
// The board keeps rendering behind it, slowly turning. That is not decoration:
// it is what tells a player, before they have pressed anything, what they are
// about to be looking at.
import './buttons.css';
import './screen.css';

export class Screen {
  readonly el: HTMLDivElement;
  private card: HTMLDivElement;

  constructor() {
    this.el = document.createElement('div');
    this.el.id = 'screen';
    this.el.hidden = true;
    this.card = document.createElement('div');
    this.card.className = 'card';
    this.el.appendChild(this.card);
    document.body.appendChild(this.el);
  }

  get showing(): boolean { return !this.el.hidden; }

  /** Replace what is on the card. Returns it, so a caller can keep a handle
   *  on the nodes it built and update them in place — a room list refreshing
   *  every three seconds must not rebuild the buttons under a finger. */
  show(...nodes: Node[]): HTMLDivElement {
    this.card.replaceChildren(...nodes);
    if (this.el.hidden) {
      this.el.hidden = false;
      document.body.classList.add('screening');
      // A frame between appearing and animating, or there is nothing to
      // animate from and the card snaps in.
      requestAnimationFrame(() => this.el.classList.add('on'));
    }
    return this.card;
  }

  hide(): void {
    if (this.el.hidden) return;
    this.el.classList.remove('on');
    document.body.classList.remove('screening');
    // Let the fade finish before the card goes — but never leave it up if the
    // transition never fires, which is what a backgrounded tab does.
    setTimeout(() => { this.el.hidden = true; this.card.replaceChildren(); }, 260);
  }

  /** The card, sized to hold a list rather than a sentence. */
  wide(on: boolean): void { this.card.classList.toggle('wide', on); }
}

// ── the pieces a card is made of ───────────────────────────────────────────

export function h1(text: string): HTMLHeadingElement {
  const el = document.createElement('h1');
  el.textContent = text;
  return el;
}

export function p(text: string, className = 'sub'): HTMLParagraphElement {
  const el = document.createElement('p');
  el.className = className;
  el.textContent = text;
  return el;
}

export function row(...children: Node[]): HTMLDivElement {
  const el = document.createElement('div');
  el.className = 'row';
  el.append(...children);
  return el;
}

export function stack(...children: Node[]): HTMLDivElement {
  const el = document.createElement('div');
  el.className = 'stack';
  el.append(...children);
  return el;
}

export type ButtonKind = 'primary' | 'quiet' | 'danger' | 'go';

export function button(label: string, onClick: () => void, kind: ButtonKind = 'quiet'): HTMLButtonElement {
  const b = document.createElement('button');
  b.className = kind === 'primary' ? 'lift' : `lift ${kind}`;
  b.textContent = label;
  b.onclick = onClick;
  return b;
}

/** The quiet line at the bottom of a card: what is happening, or what went
 *  wrong. Always present, even when empty, so the card does not resize under
 *  a finger when a message arrives. */
export function status(): HTMLParagraphElement {
  return p('', 'status');
}
