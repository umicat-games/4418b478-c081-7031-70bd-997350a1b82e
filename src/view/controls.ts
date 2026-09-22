// Pointer handling for the board: where a stone goes, and where the camera looks.
//
// The two are on the same surface, so the split between them has to be decided
// once, here, rather than guessed at every call site.
//
//   touch    one finger chooses a point, two fingers move the camera
//   mouse    left button chooses a point, right button drags, wheel zooms
//
// Choosing is not playing. Both devices pick a point and then confirm it on
// the buttons that appear beside the stone — a Go stone cannot be taken back,
// and on 19x19 an intersection is about three millimetres wide, so one-tap
// placement is a game that loses itself to a fat finger. It used to be
// two-step on touch and one-click on a mouse; one rule is easier to describe
// and the mouse loses nothing by it.
//
// What still branches on the device is the CAMERA: a phone has no second
// button and no wheel, so "choose" and "look" are told apart by finger count.

//
// **Finger counting is the dangerous part, and it is why this file is
// defensive.** Reported from a phone: tap the board with a few fingers
// quickly and it stops taking stones — for good, while every button still
// works. The cause was a pointer that never left the book: `pointerdown`
// recorded the finger and then THREW on `setPointerCapture` ("no active
// pointer with the given id"), which happens when the touch has already
// ended by the time the handler runs. The throw skipped the rest of the
// handler, the entry stayed, and from then on every single tap looked like a
// second finger — so the board was permanently in camera mode.
//
// Three rules came out of that:
//
//   nothing in `pointerdown` may throw before the mode is decided;
//   a release is listened for on the WINDOW as well, because the one the
//   canvas never sees is exactly the one that wedges it;
//   and a primary touch means every other finger has ended — the browser
//   says so — so the book is emptied when one arrives.

export interface BoardControlsHandlers {
  /** Aiming: the ghost should follow. `null` means off-board. */
  onAim(at: { x: number; y: number } | null): void;
  /** A point was chosen — pressed and released on it. What happens next is the
   *  game's business; nothing is played by pointing at it. */
  onPicked(at: { x: number; y: number } | null): void;
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
  /** The fingers currently down — position, and when they were last heard
   *  from, so a stale one can be dropped. */
  const active = new Map<number, { x: number; y: number; at: number }>();
  /** How long a pointer may go unheard-of before it is assumed gone. */
  const STALE_MS = 4000;
  let mode: 'idle' | 'aim' | 'camera' = 'idle';
  let last = { x: 0, y: 0 };
  let pinch = 0;
  let enabled = true;

  /** Forget fingers the browser never told us about again, and put the mode
   *  back if that leaves nothing down. An invariant, checked rather than
   *  assumed: state that can only accumulate will. */
  const sweep = (): void => {
    const now = performance.now();
    for (const [id, p] of active) if (now - p.at > STALE_MS) active.delete(id);
    if (active.size === 0 && mode !== 'idle') mode = 'idle';
  };

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
    // `isPrimary` is the browser saying "this is the first finger of a new
    // gesture", which means every other touch it told us about has ended —
    // whether or not it ever said so.
    if (e.isPrimary && e.pointerType === 'touch') {
      for (const id of [...active.keys()]) if (id !== e.pointerId) active.delete(id);
      mode = 'idle';
    }
    sweep();
    active.set(e.pointerId, { x: e.clientX, y: e.clientY, at: performance.now() });
    // Capture keeps a drag alive when the finger leaves the canvas. It is an
    // improvement, not a requirement — and it THROWS for a pointer that has
    // already ended, which used to take the rest of this handler with it and
    // leave the board deaf. Never let it.
    try { canvas.setPointerCapture(e.pointerId); } catch { /* the pointer is already gone */ }

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
    active.set(e.pointerId, { x: e.clientX, y: e.clientY, at: performance.now() });

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

    if (mode === 'aim') h.onAim(pick(e.clientX, e.clientY));
  };

  const onUp = (e: PointerEvent): void => {
    // A release for a pointer we never saw start is not ours, but it still
    // says that finger is gone — which is the whole point of also listening
    // on the window.
    const known = active.has(e.pointerId);
    const wasAiming = known && mode === 'aim' && (e.pointerType === 'touch' || e.button === 0);
    active.delete(e.pointerId);
    try { if (canvas.hasPointerCapture?.(e.pointerId)) canvas.releasePointerCapture(e.pointerId); } catch { /* already released */ }

    if (!enabled) { mode = active.size ? mode : 'idle'; return; }
    if (wasAiming) h.onPicked(pick(e.clientX, e.clientY));
    if (active.size === 0) mode = 'idle';
    else if (active.size === 1 && mode === 'camera') { last = mid(); pinch = 0; }
  };

  const onWheel = (e: WheelEvent): void => {
    if (!enabled) return;
    e.preventDefault();
    h.onZoom(e.deltaY < 0 ? 1.1 : 1 / 1.1);
  };
  const onContextMenu = (e: Event): void => e.preventDefault();
  /** Capture lost to the browser (a system gesture, a scroll it decided to
   *  own) — the finger is no longer ours, so it is no longer counted. */
  const onLostCapture = (e: PointerEvent): void => {
    active.delete(e.pointerId);
    if (active.size === 0) mode = 'idle';
  };

  canvas.addEventListener('pointerdown', onDown);
  canvas.addEventListener('pointermove', onMove);
  canvas.addEventListener('pointerup', onUp);
  canvas.addEventListener('pointercancel', onUp);
  canvas.addEventListener('lostpointercapture', onLostCapture);
  canvas.addEventListener('wheel', onWheel, { passive: false });
  canvas.addEventListener('contextmenu', onContextMenu);
  // The releases the canvas never sees. Capture normally delivers them here,
  // but capture is exactly what fails in the case this guards against.
  window.addEventListener('pointerup', onUp);
  window.addEventListener('pointercancel', onUp);

  return () => {
    enabled = false;
    canvas.removeEventListener('pointerdown', onDown);
    canvas.removeEventListener('pointermove', onMove);
    canvas.removeEventListener('pointerup', onUp);
    canvas.removeEventListener('pointercancel', onUp);
    canvas.removeEventListener('lostpointercapture', onLostCapture);
    canvas.removeEventListener('wheel', onWheel);
    canvas.removeEventListener('contextmenu', onContextMenu);
    window.removeEventListener('pointerup', onUp);
    window.removeEventListener('pointercancel', onUp);
  };
}
