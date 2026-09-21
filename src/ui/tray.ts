// The pieces in your hand, along the bottom of the screen.
//
// Twenty-one shapes is too many to lay beside a board and still see the
// board, so they live in a strip that scrolls, and the camera gives the strip
// its space rather than drawing behind it (`reserve` in board3d).
//
// Each piece is drawn as its own little grid of squares, in the player's
// colour — not as an icon and not as a letter. The name of a pentomino is
// something Blokus players learn eventually and beginners never do, and the
// only question the tray has to answer is "what shape is that".
//
// **The selected piece shows its CURRENT orientation.** Turning a piece with
// nothing aimed at the board is otherwise invisible, and a button whose
// effect you cannot see is a button you press twice.
import './buttons.css';
import './tray.css';
import { BASE, COLOURS, ORIENTATIONS, extent } from '../blokus/pieces';
import type { Cells } from '../blokus/pieces';
import { t } from '../i18n';

export interface TrayOptions {
  onSelect(piece: string | null): void;
  onRotate(): void;
  onFlip(): void;
  onPass(): void;
}

export class Tray {
  readonly el: HTMLDivElement;
  private strip: HTMLDivElement;
  private rotateBtn: HTMLButtonElement;
  private flipBtn: HTMLButtonElement;
  private passBtn: HTMLButtonElement;
  private label: HTMLSpanElement;
  private buttons = new Map<string, HTMLButtonElement>();
  /** Which colour the hand is drawn in. Set once a seat is known. */
  private colour = COLOURS[0];

  constructor(private opts: TrayOptions) {
    this.el = document.createElement('div');
    this.el.id = 'tray';
    this.el.innerHTML = `
      <div class="bar">
        <span class="label"></span>
        <div class="tools"></div>
      </div>
      <div class="strip"></div>`;
    document.body.appendChild(this.el);

    this.strip = this.el.querySelector('.strip')!;
    this.label = this.el.querySelector('.label')!;
    const tools = this.el.querySelector('.tools')!;

    const tool = (text: string, onClick: () => void, cls = 'lift quiet'): HTMLButtonElement => {
      const b = document.createElement('button');
      b.className = cls;
      b.textContent = text;
      b.onclick = onClick;
      tools.appendChild(b);
      return b;
    };
    this.rotateBtn = tool(t('act.rotate'), () => this.opts.onRotate());
    this.flipBtn = tool(t('act.flip'), () => this.opts.onFlip());
    // Passing is the only thing here that changes the game, and it asks
    // first — but the ASKING belongs to the game (main.ts), not to the tray:
    // it has to be the in-game dialog, because `window.confirm` is ignored
    // outright in the sandboxed iframe this runs in.
    this.passBtn = tool(t('act.pass'), () => this.opts.onPass(), 'lift dark');
  }

  /** Re-draw the hand. Cheap: twenty-one small grids of divs. */
  render(hand: readonly string[], selected: string | null, ori: number, myTurn: boolean): void {
    this.el.classList.toggle('waiting', !myTurn);
    this.label.textContent = hand.length ? t('tray.yours') : t('tray.gone');
    this.rotateBtn.disabled = !selected;
    this.flipBtn.disabled = !selected || ORIENTATIONS[selected].length < 2;
    this.passBtn.disabled = !myTurn;

    this.buttons.clear();
    this.strip.replaceChildren(...hand.map((piece) => {
      const b = document.createElement('button');
      b.className = 'piece';
      b.setAttribute('aria-pressed', String(piece === selected));
      b.title = piece;
      // The selected piece is shown as it is currently turned; the rest sit
      // in their default orientation, which is how they are recognised.
      const cells = piece === selected
        ? ORIENTATIONS[piece][ori % ORIENTATIONS[piece].length]
        : BASE[piece];
      b.appendChild(glyph(cells, this.colour));
      b.onclick = () => this.opts.onSelect(piece === selected ? null : piece);
      this.buttons.set(piece, b);
      return b;
    }));

    // Keep the chosen piece where the player can see it — after a rotation
    // the strip must not have scrolled somewhere else.
    if (selected) {
      this.buttons.get(selected)?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    }
  }

  setSeat(player: number): void { this.colour = COLOURS[player] ?? COLOURS[0]; }

  /** How much of the screen the tray covers, so the board can keep clear of
   *  it. Measured rather than assumed — it grows with the safe-area inset on
   *  a phone, and on a short screen the strip is smaller. */
  get height(): number {
    return this.el.getBoundingClientRect().height;
  }

  relabel(): void {
    this.rotateBtn.textContent = t('act.rotate');
    this.flipBtn.textContent = t('act.flip');
    this.passBtn.textContent = t('act.pass');
  }

  hide(on: boolean): void { this.el.classList.toggle('gone', on); }
}

/**
 * A piece, as a grid of squares.
 *
 * The SQUARE is the same size in every glyph and the box around it is fixed,
 * so an I5 looks long and a monomino looks small — which is the information
 * being picked from. Scaling each piece to fill its button would make every
 * shape the same size and throw that away.
 */
export function glyph(cells: Cells, colour: number): HTMLElement {
  const { w, h } = extent(cells);
  const el = document.createElement('span');
  el.className = 'glyph';
  el.style.setProperty('--w', String(w));
  el.style.setProperty('--h', String(h));
  el.style.setProperty('--c', `#${colour.toString(16).padStart(6, '0')}`);
  const filled = new Set(cells.map(([x, y]) => `${x},${y}`));
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const cell = document.createElement('i');
      if (filled.has(`${x},${y}`)) cell.className = 'on';
      el.appendChild(cell);
    }
  }
  return el;
}
