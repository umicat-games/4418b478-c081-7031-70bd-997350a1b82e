// Pointer handling for the board: where a piece goes, and where the camera
// looks. The two are on the same surface, so the split between them is decided
// once, here, rather than guessed at every call site.
//
//   touch    one finger puts the piece down, then NUDGES it; two fingers pan
//            and pinch
//   mouse    left drags the piece, right CLICKS turn it and right DRAGS orbit,
//            middle (or shift + right) pans, the wheel zooms
//
// **Aiming is not playing.** Both devices put the piece down under the pointer
// and then confirm it on the tick beside it. A Blokus piece is up to five
// squares of commitment and cannot be taken back, and on a twenty by twenty
// board a cell is a few millimetres wide on a phone — one-tap placement is a
// game that loses itself to a fat finger.
//
// **On a finger, the piece is put down ONCE and then nudged.** The first touch
// after picking a piece aims where it lands — held a little above the
// fingertip, because a finger covers about a centimetre of board and that
// centimetre is the part you are trying to look at. From then on the finger
// is a TRACKPAD: touching somewhere else does not fling the piece there, and
// a drag moves the piece by however far the finger moved, from wherever on
// the screen it is comfortable to put it. That is the whole point — the hand
// can sit off to one side while the piece moves in clear view.
//
// A mouse keeps aiming absolutely, with no lift: a cursor is one pixel and
// covers nothing. Hovering stops once the piece is settled (see `frozen` in
// main.ts — a mouse travelling towards the tick must not take the piece with
// it), but a held-button drag always aims.
//
// Two fingers PAN rather than orbit, because panning is what zooming needs:
// at four times the zoom most of the board is off screen and there is no
// other way to reach it. Turning the board is a luxury, and it is still on
// the right mouse button where there is one.
import type { Cell } from '../blokus/pieces';

/** How the pointer arrived at a cell. A `drag` is a deliberate finger or a
 *  held button; a `hover` is a mouse passing over. */
export type AimSource = 'hover' | 'drag';

export interface BoardControlsHandlers {
  /** Whether a piece is already down on the board waiting to be confirmed.
   *  It decides whether a finger aims (absolutely) or nudges (relatively). */
  aimed(): boolean;
  /** Aiming: the ghost should follow. `null` means off-board. */
  onAim(at: Cell | null, source: AimSource): void;
  /** A relative drag is starting — the piece stays where it is until the
   *  finger moves. */
  onNudgeStart(): void;
  /** Move the piece by this much on SCREEN, not to this point. */
  onNudge(dxPx: number, dyPx: number): void;
  /** A cell was chosen — pressed and released on it. Nothing is played by
   *  pointing at it; what happens next is the game's business. */
  onPicked(at: Cell | null): void;
  onCamera(dAzimuth: number, dPolar: number): void;
  onPan(dxPx: number, dyPx: number): void;
  onZoom(factor: number): void;
  /** A right-click that did not turn into a drag: turn the piece in hand. */
  onTurnPiece(): void;
}

/** Radians of camera turn per pixel dragged. */
const TURN_PER_PX = 0.006;
/** How far the right button may travel and still count as a click. */
const CLICK_SLOP = 6;
/**
 * How far above the fingertip the piece is aimed, in CSS pixels.
 *
 * About the radius of a fingertip. A fixed number of pixels rather than a
 * number of cells because what is doing the covering is a finger, which is
 * the same size however far in the board is zoomed.
 */
const TOUCH_LIFT = 44;

export function attachBoardControls(
  canvas: HTMLCanvasElement,
  pick: (clientX: number, clientY: number, clamp: boolean) => Cell | null,
  h: BoardControlsHandlers,
): () => void {
  const active = new Map<number, { x: number; y: number }>();
  let mode: 'idle' | 'aim' | 'nudge' | 'orbit' | 'pan' = 'idle';
  let last = { x: 0, y: 0 };
  let pinch = 0;
  /** How far the right button has moved since it went down. */
  let travelled = 0;
  let enabled = true;

  const mid = (): { x: number; y: number } => {
    const pts = [...active.values()];
    return {
      x: pts.reduce((a, p) => a + p.x, 0) / pts.length,
      y: pts.reduce((a, p) => a + p.y, 0) / pts.length,
    };
  };
  const spread = (): number => {
    const [a, b] = [...active.values()];
    return Math.hypot(a.x - b.x, a.y - b.y);
  };

  const onDown = (e: PointerEvent): void => {
    if (!enabled) return;
    active.set(e.pointerId, { x: e.clientX, y: e.clientY });
    canvas.setPointerCapture(e.pointerId);

    if (e.pointerType === 'touch') {
      if (active.size >= 2) {
        // A second finger means the first one was never aiming.
        mode = 'pan';
        last = mid();
        pinch = spread();
        return;
      }
      last = { x: e.clientX, y: e.clientY };
      if (h.aimed()) {
        // The piece is already down: this finger moves it, and does not
        // teleport it to wherever it happens to have landed.
        mode = 'nudge';
        h.onNudgeStart();
        return;
      }
      mode = 'aim';
      h.onAim(pick(e.clientX, e.clientY - TOUCH_LIFT, true), 'drag');
      return;
    }

    // Mouse (and pen). The right button is the camera and the piece's
    // rotation, told apart on the way up by whether it moved.
    if (e.button === 2 || e.button === 1) {
      mode = e.button === 1 || e.shiftKey ? 'pan' : 'orbit';
      travelled = 0;
      last = { x: e.clientX, y: e.clientY };
      return;
    }
    if (e.button === 0) {
      mode = 'aim';
      h.onAim(pick(e.clientX, e.clientY, false), 'drag');
    }
  };

  const onMove = (e: PointerEvent): void => {
    if (!enabled) return;

    if (!active.has(e.pointerId)) {
      // A mouse moving with no button down still deserves an answer: the
      // ghost follows the cursor, which is what tells a first-time player
      // that the board takes pieces at all, and where this one would land.
      // Touch has no hover — that is what the aim-then-confirm step is for.
      if (mode === 'idle' && e.pointerType !== 'touch') h.onAim(pick(e.clientX, e.clientY, false), 'hover');
      return;
    }
    active.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (mode === 'orbit' || mode === 'pan') {
      if (e.pointerType === 'touch' && active.size >= 2) {
        const m = mid();
        h.onPan(m.x - last.x, m.y - last.y);
        last = m;
        const s = spread();
        if (pinch > 0 && s > 0) h.onZoom(s / pinch);
        pinch = s;
        return;
      }
      const dx = e.clientX - last.x, dy = e.clientY - last.y;
      travelled += Math.hypot(dx, dy);
      if (mode === 'pan') h.onPan(dx, dy);
      else h.onCamera(-dx * TURN_PER_PX, -dy * TURN_PER_PX);
      last = { x: e.clientX, y: e.clientY };
      return;
    }

    if (mode === 'nudge') {
      h.onNudge(e.clientX - last.x, e.clientY - last.y);
      last = { x: e.clientX, y: e.clientY };
      return;
    }

    if (mode === 'aim') {
      const lift = e.pointerType === 'touch' ? TOUCH_LIFT : 0;
      h.onAim(pick(e.clientX, e.clientY - lift, lift > 0), 'drag');
    }
  };

  const onUp = (e: PointerEvent): void => {
    const wasAiming = mode === 'aim' && (e.pointerType === 'touch' || e.button === 0);
    // A right button that never really moved was a click, and a click turns
    // the piece. Checked before the mode is cleared, and only for the button
    // that owns the gesture.
    const wasTurn = mode === 'orbit' && e.button === 2 && travelled < CLICK_SLOP;
    active.delete(e.pointerId);
    if (canvas.hasPointerCapture?.(e.pointerId)) canvas.releasePointerCapture(e.pointerId);

    if (!enabled) { mode = active.size ? mode : 'idle'; return; }
    if (wasAiming) {
      const lift = e.pointerType === 'touch' ? TOUCH_LIFT : 0;
      h.onPicked(pick(e.clientX, e.clientY - lift, lift > 0));
    }
    if (wasTurn) h.onTurnPiece();
    if (active.size === 0) mode = 'idle';
    else if (active.size === 1 && (mode === 'pan' || mode === 'orbit')) { last = mid(); pinch = 0; }
  };

  const onWheel = (e: WheelEvent): void => {
    if (!enabled) return;
    e.preventDefault();
    h.onZoom(e.deltaY < 0 ? 1.1 : 1 / 1.1);
  };
  const onContextMenu = (e: Event): void => e.preventDefault();

  canvas.addEventListener('pointerdown', onDown);
  canvas.addEventListener('pointermove', onMove);
  canvas.addEventListener('pointerup', onUp);
  canvas.addEventListener('pointercancel', onUp);
  canvas.addEventListener('wheel', onWheel, { passive: false });
  canvas.addEventListener('contextmenu', onContextMenu);

  return () => {
    enabled = false;
    canvas.removeEventListener('pointerdown', onDown);
    canvas.removeEventListener('pointermove', onMove);
    canvas.removeEventListener('pointerup', onUp);
    canvas.removeEventListener('pointercancel', onUp);
    canvas.removeEventListener('wheel', onWheel);
    canvas.removeEventListener('contextmenu', onContextMenu);
  };
}
