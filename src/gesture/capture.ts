import { recognize, type Glyph, type Result, type Stroke, type Pt } from './recognize';

/**
 * Turning pointer events into committed gestures.
 *
 * Two things here are not obvious and both have bitten this codebase before.
 *
 * **No `setPointerCapture`.** Four board games froze on a multi-finger tap
 * because capture threw and left a pointer id nobody would ever clear. Moves
 * and ups are read off `window` instead, filtered by id, which gets the same
 * "the stroke continues outside the element" behaviour with nothing to leak.
 *
 * **Only the cross waits.** Committing every gesture on a timer would put a
 * ~300ms dead spot between every move in a game whose whole appeal is tempo.
 * So a finished stroke is recognised immediately and only held when it is a
 * lone straight line — the one thing that might be half of an X.
 */
export interface GestureCaptureOptions {
  /** Where pointerdown is read. Coordinates are relative to its bounding box. */
  el: HTMLElement;
  onResult: (r: Result, strokes: Stroke[]) => void;
  /** Called on every sample, for drawing the trail. */
  onChange?: (strokes: Stroke[], live: boolean) => void;
  /** The glyphs that mean something right now — see `RecognizeOptions.expect`. */
  expect?: () => Glyph[] | undefined;
  /** How long a lone straight stroke waits for its partner. */
  multiStrokeWindowMs?: number;
  minSize?: number;
}

export class GestureCapture {
  private readonly opts: GestureCaptureOptions;
  private strokes: Stroke[] = [];
  private current: Stroke | null = null;
  private activeId: number | null = null;
  private timer: number | null = null;
  private enabled = true;

  constructor(opts: GestureCaptureOptions) {
    this.opts = opts;
    opts.el.addEventListener('pointerdown', this.down);
    window.addEventListener('pointermove', this.move, { passive: false });
    window.addEventListener('pointerup', this.up);
    window.addEventListener('pointercancel', this.cancel);
    window.addEventListener('blur', this.cancel);
  }

  dispose(): void {
    this.opts.el.removeEventListener('pointerdown', this.down);
    window.removeEventListener('pointermove', this.move);
    window.removeEventListener('pointerup', this.up);
    window.removeEventListener('pointercancel', this.cancel);
    window.removeEventListener('blur', this.cancel);
    this.clearTimer();
  }

  setEnabled(on: boolean): void {
    this.enabled = on;
    if (!on) this.cancel();
  }

  reset(): void {
    this.clearTimer();
    this.strokes = [];
    this.current = null;
    this.activeId = null;
    this.opts.onChange?.([], false);
  }

  private at(e: PointerEvent): Pt {
    const r = this.opts.el.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top, t: e.timeStamp };
  }

  private down = (e: PointerEvent): void => {
    if (!this.enabled) return;
    // Right button is the platform's camera; a game that draws on any button
    // draws every time the player turns to look at something.
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    // A second finger landing mid-stroke is a palm or a fidget, not input.
    if (this.activeId !== null) return;
    this.clearTimer();
    this.activeId = e.pointerId;
    this.current = [this.at(e)];
    this.opts.onChange?.([...this.strokes, this.current], true);
  };

  private move = (e: PointerEvent): void => {
    if (this.activeId !== e.pointerId || !this.current) return;
    e.preventDefault();
    // A fast flick is delivered as one coalesced event holding a dozen samples.
    // Without this a 120ms gesture arrives as four points and every feature
    // built on curvature is measuring quantisation noise. Safari has no such
    // method, which is why the fallback is the event itself and not an error.
    const batch = typeof e.getCoalescedEvents === 'function' ? e.getCoalescedEvents() : [];
    const pts = batch.length ? batch : [e];
    for (const p of pts) this.current.push(this.at(p as PointerEvent));
    this.opts.onChange?.([...this.strokes, this.current], true);
  };

  private up = (e: PointerEvent): void => {
    if (this.activeId !== e.pointerId || !this.current) return;
    this.current.push(this.at(e));
    const stroke = this.current;
    this.current = null;
    this.activeId = null;
    if (stroke.length < 2) { this.reset(); return; }
    this.strokes.push(stroke);
    this.opts.onChange?.([...this.strokes], false);

    const r = this.evaluate();
    if (this.strokes.length >= 2 || !r.pending) { this.commit(r); return; }
    this.timer = window.setTimeout(() => {
      this.timer = null;
      this.commit(this.evaluate());
    }, this.opts.multiStrokeWindowMs ?? 300);
  };

  /** A finger that left the glass mid-stroke drew half a shape; half a shape
   *  recognised is a move the player did not make. */
  private cancel = (): void => {
    this.clearTimer();
    this.current = null;
    this.activeId = null;
    this.strokes = [];
    this.opts.onChange?.([], false);
  };

  private evaluate(): Result {
    return recognize(this.strokes, {
      expect: this.opts.expect?.(),
      minSize: this.opts.minSize,
    });
  }

  private commit(r: Result): void {
    const drawn = this.strokes;
    this.strokes = [];
    this.opts.onResult(r, drawn);
    this.opts.onChange?.([], false);
  }

  private clearTimer(): void {
    if (this.timer !== null) { clearTimeout(this.timer); this.timer = null; }
  }
}
