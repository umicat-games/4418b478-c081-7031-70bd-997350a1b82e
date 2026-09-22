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
//
// The shell has no idea what the number MEANS — pawns, soldiers, shapes — so
// the game hands it a share of the bar and a label, and keeps its units to
// itself.
import './evalbar.css';

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

  /**
   * `share` is the PLAYER's half of the bar, 0 to 1; `label` is whatever the
   * game wants written under it, and may be empty.
   *
   * Null hides it — between games, and before there is a read. A bar sitting
   * at dead level is a claim that the position is equal rather than that
   * nothing has been measured yet.
   */
  show(v: { share: number; label?: string } | null): void {
    if (!this.on || !v) { this.el.hidden = true; return; }
    this.el.hidden = false;
    this.fill.style.height = `${(Math.min(0.98, Math.max(0.02, v.share)) * 100).toFixed(1)}%`;
    this.label.textContent = v.label ?? '';
    this.el.classList.toggle('losing', v.share < 0.5);
  }

  hide(): void { this.el.hidden = true; }
}
