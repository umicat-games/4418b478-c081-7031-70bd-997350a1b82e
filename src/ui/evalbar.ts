// The eval bar.
//
// Ported from Chess with me, and it earns its place here for the same reason
// it does there and does not in the Go game: the number is not a verdict the
// game is passing on the player, it is the thing the assistant is talking
// FROM. Showing it means the player can see what is being explained to them
// rather than taking it on trust.
//
// It shows the ENGINE's number and never the assistant's. Off in Settings for
// anyone who would rather just play.
import './evalbar.css';
import { t } from '../i18n';
import type { Read } from '../xiangqi/opponent';

export class EvalBar {
  private el: HTMLDivElement;
  private fill: HTMLDivElement;
  private label: HTMLSpanElement;
  private on = true;

  constructor() {
    this.el = document.createElement('div');
    this.el.id = 'evalbar';
    this.el.hidden = true;
    this.el.innerHTML = '<div class="track"><div class="fill"></div></div><span class="num"></span>';
    document.body.appendChild(this.el);
    this.fill = this.el.querySelector('.fill')!;
    this.label = this.el.querySelector('.num')!;
  }

  setEnabled(on: boolean): void {
    this.on = on;
    if (!on) this.el.hidden = true;
  }

  get enabled(): boolean { return this.on; }

  /** Null hides it — between games, and before there is a read, a bar sitting
   *  at dead level is a claim that the position is equal rather than that
   *  nothing has been measured yet. */
  show(read: Read | null): void {
    if (!this.on || !read) { this.el.hidden = true; return; }
    this.el.hidden = false;
    const share = read.mateIn === undefined ? winning(read.score) : (read.mateIn > 0 ? 1 : 0);
    this.fill.style.height = `${(Math.min(0.98, Math.max(0.02, share)) * 100).toFixed(1)}%`;
    this.label.textContent = read.mateIn !== undefined
      // Plies, as the engine counts them, shown as moves, as a player does.
      ? t('eval.mateIn', { n: Math.ceil(Math.abs(read.mateIn) / 2) })
      : formatSoldiers(read.score);
    this.el.classList.toggle('losing', share < 0.5);
  }

  hide(): void { this.el.hidden = true; }
}

/** A score in hundredths of a soldier, as a share of the bar. The divisor is
 *  wider than a chess engine's would be: xiangqi material swings harder, and a
 *  bar that pins to one end at a horse's worth of advantage stops saying
 *  anything for the rest of the game. */
const winning = (cp: number): number => 1 / (1 + Math.exp(-cp / 300));

/** `+1.2`, `−0.4`, `0.0` — in soldiers, because that is the unit the
 *  assistant speaks in too. */
function formatSoldiers(cp: number): string {
  const p = cp / 100;
  const s = Math.abs(p).toFixed(1);
  return p > 0.05 ? `+${s}` : p < -0.05 ? `−${s}` : '0.0';
}
