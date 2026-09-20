// The eval bar.
//
// A chess staple, and a deliberate departure from the Go game — which shows
// the player nothing about who is ahead, on the grounds that a running score
// turns every move into a verdict. Chess is different in one way that matters:
// the number is already on every board the player has ever seen online, and
// hiding it here would read as the game not knowing it rather than as the
// game being tactful.
//
// So it is here, it is small, and it can be turned off in Settings. What it
// shows is the ENGINE's number and never the companion's — it is the same
// `Read` the coach is talking from, which is the point: the player can see
// the thing being explained to them.
import './evalbar.css';
import { t } from '../i18n';
import type { Read } from '../chess/opponent';

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

  /** Null hides it — between games, and while there is no read yet, an eval
   *  bar sitting at dead level is a claim that the position is equal rather
   *  than that nothing has been measured. */
  show(read: Read | null): void {
    if (!this.on || !read) { this.el.hidden = true; return; }
    this.el.hidden = false;
    // The player's share of the bar, from the bottom. Clamped away from the
    // ends so the bar never becomes a solid block with nothing to read.
    const share = read.mate === null ? read.winRate : (read.mate > 0 ? 1 : 0);
    this.fill.style.height = `${(Math.min(0.98, Math.max(0.02, share)) * 100).toFixed(1)}%`;
    this.label.textContent = read.mate !== null
      ? t('eval.mateIn', { n: Math.abs(read.mate) })
      : formatPawns(read.cp);
    this.el.classList.toggle('losing', share < 0.5);
  }

  hide(): void { this.el.hidden = true; }
}

/** Centipawns as a chess player writes them: `+1.2`, `−0.4`, `0.0`. */
function formatPawns(cp: number): string {
  const p = cp / 100;
  const s = Math.abs(p).toFixed(1);
  return p > 0.05 ? `+${s}` : p < -0.05 ? `−${s}` : '0.0';
}
