// Pointer handling for the board: where a piece goes, and where the camera
// looks. The two are on the same surface, so the split between them is decided
// once, here, rather than guessed at every call site.
//
//   touch    one finger drags the piece about; two fingers pan and pinch
//   mouse    left drags the piece, right CLICKS turn it and right DRAGS orbit,
//            middle (or shift + right) pans, the wheel zooms
//
// **Aiming is not playing.** Both devices put the piece down under the pointer
// and then confirm it on the tick beside it. A Blokus piece is up to five
// squares of commitment and cannot be taken back, and on a twenty by twenty
// board a cell is a few millimetres wide on a phone — one-tap placement is a
// game that loses itself to a fat finger.
//
// **But a piece already aimed must still follow a DRAG.** Tapping to move it
// again means tapping somewhere the confirm buttons are standing, which is
// exactly where you want to tap. So a drag is always aiming, whether the
// piece is settled or not; it is hovering that stops once it is (see `frozen`
// in main.ts — a mouse travelling towards the tick must not take the piece
// with it).
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
  /** Aiming: the ghost should follow. `null` means off-board. */
  onAim(at: Cell | null, source: AimSource): void;
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

export function attachBoardControls(
  canvas: HTMLCanvasElement,
  pick: (clientX: number, clientY: number) => Cell | null,
  h: BoardControlsHandlers,
): () => void {
  const active = new Map<number, { x: number; y: number }>();
  let mode: 'idle' | 'aim' | 'orbit' | 'pan' = 'idle';
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
      mode = 'aim';
      h.onAim(pick(e.clientX, e.clientY), 'drag');
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
      h.onAim(pick(e.clientX, e.clientY), 'drag');
    }
  };

  const onMove = (e: PointerEvent): void => {
    if (!enabled) return;

    if (!active.has(e.pointerId)) {
      // A mouse moving with no button down still deserves an answer: the
      // ghost follows the cursor, which is what tells a first-time player
      // that the board takes pieces at all, and where this one would land.
      // Touch has no hover — that is what the aim-then-confirm step is for.
      if (mode === 'idle' && e.pointerType !== 'touch') h.onAim(pick(e.clientX, e.clientY), 'hover');
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

    if (mode === 'aim') h.onAim(pick(e.clientX, e.clientY), 'drag');
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
    if (wasAiming) h.onPicked(pick(e.clientX, e.clientY));
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
