// Pointer handling for the board: where a stone goes, and where the camera looks.
//
// The two are on the same surface, so the split between them has to be decided
// once, here, rather than guessed at every call site.
//
//   touch    one finger places, two fingers move the camera
//   mouse    left button places, right button drags the camera, wheel zooms
//
// This is one of the few places the code legitimately branches on input device.
// A phone has no second button and no wheel, so "place" and "look" have to be
// told apart by finger count; a mouse has both, and making a mouse user tap
// twice to place a stone would be tapping twice for no reason.
//
// On touch, placing is TWO STEPS: drag to aim, then confirm. A Go stone cannot
// be taken back, and on 19x19 an intersection is about three millimetres wide.
// One-tap placement on that grid is a game that loses itself to a fat finger.

export interface BoardControlsHandlers {
  /** A touch player is aiming: the ghost should follow. `null` means off-board. */
  onAim(at: { x: number; y: number } | null): void;
  /** A move is being committed outright (mouse click, or a confirmed touch). */
  onCommit(at: { x: number; y: number }): void;
  /** A touch player let go while on a legal point — arm the confirm button. */
  onArmed(at: { x: number; y: number } | null): void;
  onCamera(dAzimuth: number, dPolar: number): void;
  onZoom(factor: number): void;
}

/** Radians of camera turn per pixel dragged. */
const TURN_PER_PX = 0.006;

export function attachBoardControls(
  canvas: HTMLCanvasElement,
  pick: (clientX: number, clientY: number) => { x: number; y: number } | null,
  h: BoardControlsHandlers,
): () => void {
  const active = new Map<number, { x: number; y: number }>();
  let mode: 'idle' | 'aim' | 'camera' = 'idle';
  let last = { x: 0, y: 0 };
  let pinch = 0;
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
        mode = 'camera';
        h.onAim(null);
        last = mid();
        pinch = spread();
        return;
      }
      mode = 'aim';
      h.onAim(pick(e.clientX, e.clientY));
      return;
    }

    // Mouse (and pen). The right button is the camera — and nothing else may
    // be, because the context menu is the only other thing it could do.
    if (e.button === 2 || e.button === 1) {
      mode = 'camera';
      last = { x: e.clientX, y: e.clientY };
      return;
    }
    if (e.button === 0) mode = 'aim';
  };

  const onMove = (e: PointerEvent): void => {
    if (!enabled || !active.has(e.pointerId)) {
      if (mode === 'camera' && e.pointerType !== 'touch') {
        h.onCamera(-(e.clientX - last.x) * TURN_PER_PX, -(e.clientY - last.y) * TURN_PER_PX);
        last = { x: e.clientX, y: e.clientY };
        return;
      }
      // A mouse moving with no button down still deserves an answer: the ghost
      // follows the cursor, which is what tells a first-time player that the
      // board takes stones at all, and which intersection this one would go on.
      // Touch has no hover — that is what the aim-then-confirm step is for.
      if (mode === 'idle' && e.pointerType !== 'touch') h.onAim(pick(e.clientX, e.clientY));
      return;
    }
    active.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (mode === 'camera') {
      if (e.pointerType === 'touch' && active.size >= 2) {
        const m = mid();
        h.onCamera(-(m.x - last.x) * TURN_PER_PX, -(m.y - last.y) * TURN_PER_PX);
        last = m;
        const s = spread();
        if (pinch > 0 && s > 0) h.onZoom(s / pinch);
        pinch = s;
      } else {
        h.onCamera(-(e.clientX - last.x) * TURN_PER_PX, -(e.clientY - last.y) * TURN_PER_PX);
        last = { x: e.clientX, y: e.clientY };
      }
      return;
    }

    if (mode === 'aim' && e.pointerType === 'touch') h.onAim(pick(e.clientX, e.clientY));
  };

  const onUp = (e: PointerEvent): void => {
    const wasTouchAim = mode === 'aim' && e.pointerType === 'touch';
    const wasMouseAim = mode === 'aim' && e.pointerType !== 'touch';
    active.delete(e.pointerId);
    if (canvas.hasPointerCapture?.(e.pointerId)) canvas.releasePointerCapture(e.pointerId);

    if (!enabled) { mode = active.size ? mode : 'idle'; return; }
    if (wasTouchAim) h.onArmed(pick(e.clientX, e.clientY));
    // A mouse click commits where it landed. No ghost, no confirm: a mouse
    // lands where it is pointing and the player can see the cursor.
    if (wasMouseAim && e.button === 0) {
      const at = pick(e.clientX, e.clientY);
      if (at) h.onCommit(at);
    }
    if (active.size === 0) mode = 'idle';
    else if (active.size === 1 && mode === 'camera') { last = mid(); pinch = 0; }
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
