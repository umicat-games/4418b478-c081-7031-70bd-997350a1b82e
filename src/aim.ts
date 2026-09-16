import * as THREE from 'three';

/**
 * Placing a spell by dragging, the way a MOBA does it.
 *
 * A tap is what it always was: the staff picks the nearest thing in range and
 * goes off there. HOLDING opens a circle you steer with the same finger — the
 * blast follows it, and letting go casts where it stands.
 *
 * The spell was already a circle on a patch of GROUND rather than a hit on an
 * enemy (see `castBurst`), and the code had already reasoned its way to why:
 * "a burst that always goes off underfoot makes the spell about walking into a
 * crowd; one you can place makes it about choosing which crowd". The only thing
 * missing was the player choosing.
 *
 * Nothing here needs the SDK. Measured before it was written: the on-screen
 * buttons are its divs, but `pointerdown` on one and `setPointerCapture` keeps
 * every subsequent move — eight of eight, out to the far side of the screen —
 * and the right-half look-drag does NOT steal the gesture (camera yaw moved
 * 0.0000 across the whole drag).
 */

/** How long the press has to outlive a tap before the circle opens. The same
 *  200ms the build button uses to tell a tap from a hold, so the game has one
 *  answer to "how long is a press". */
const ARM_MS = 200;

export interface AimOpts {
  scene: THREE.Scene;
  camera: THREE.Camera;
  /** Where the caster is standing, now. */
  from: () => THREE.Vector3;
  /** How far from the caster the circle may be placed. */
  reach: () => number;
  /** How big the blast is — what the circle actually draws. */
  radius: () => number;
  /** Whether the weapon in hand aims at all. A sword does not. */
  enabled: () => boolean;
  /** Let go. `null` means "the way it always worked": let the staff choose. */
  cast: (at: THREE.Vector3 | null) => void;
}

export interface Aim {
  /** The on-screen button to hook, or null on a device that has none. Safe to
   *  call repeatedly with the same element. */
  watch(btn: HTMLElement | null): void;
  /** Once a frame. `ndc` is the mouse in clip space, for the desktop path;
   *  `keyHeld` is whether the attack key is down. */
  update(ndc: THREE.Vector2 | null, keyHeld: boolean): void;
  aiming(): boolean;
  /** Whether this can actually take over the press: there is a button to drag
   *  from, or a mouse to steer with. If it cannot, the caller must let the
   *  ordinary attack latch through — swallowing the press for a gesture that
   *  has no way to start would leave the staff doing nothing at all. */
  canAim(): boolean;
  /** Where the circle is, for probes and for anything that wants to draw. */
  at(): { x: number; z: number } | null;
  dispose(): void;
}

export function createAim(opts: AimOpts): Aim {
  // The two rings. The wide faint one is how far you may place it — drawn from
  // the caster — and the solid one is the blast itself, at the finger. Without
  // the first, a circle that stops moving at the edge of the reach looks stuck.
  const mk = (colour: number, fill: number): THREE.Mesh => {
    const m = new THREE.Mesh(
      new THREE.RingGeometry(0.9, 1, 64).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({
        color: colour, transparent: true, opacity: fill,
        depthWrite: false, side: THREE.DoubleSide,
      }),
    );
    m.visible = false;
    m.renderOrder = 4;
    opts.scene.add(m);
    return m;
  };
  const reachRing = mk(0xffffff, 0.22);
  const blastRing = mk(0x8fe3ff, 0.85);

  const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  const ray = new THREE.Raycaster();
  const hitPoint = new THREE.Vector3();
  const ndcTmp = new THREE.Vector2();

  let button: HTMLElement | null = null;
  let pressedAt = 0;
  let down = false;
  /** The pointer that started on the button, so a second finger on the walking
   *  stick cannot move the circle. */
  let pointerId: number | null = null;
  /** Where the press began, and where the finger is now. The DELTA between
   *  them is the whole input; neither on its own means anything. */
  let origin: { x: number; y: number } | null = null;
  let screen: { x: number; y: number } | null = null;
  let armed = false;
  const target = new THREE.Vector3();
  let haveTarget = false;
  /** Released back over the button: the MOBA way of saying "never mind". */
  let cancelled = false;
  /** Whether a mouse has ever been seen. A phone has no cursor, and a desktop
   *  has no on-screen button — one of the two has to be there. */
  let hasMouse = false;

  /** How far the finger travels to push the circle the whole reach.
   *
   *  A fraction of the SHORTER side of the screen, not a pixel count: the same
   *  thumb movement should mean the same thing on a phone and on a desktop
   *  window. About a hundred and sixty pixels on a landscape phone, which is a
   *  comfortable thumb arc without lifting. */
  const FULL_DRAG = (): number => Math.min(window.innerWidth, window.innerHeight) * 0.42;

  const fwd = new THREE.Vector3();
  const right = new THREE.Vector3();
  const UP = new THREE.Vector3(0, 1, 0);

  /** Where the circle goes for a drag of (dx, dy) SCREEN pixels from where the
   *  press began.
   *
   *  Relative to the caster, not to the finger. Mapping the finger straight
   *  onto the ground put the circle wherever the thumb happened to be — which
   *  is on the button, in the bottom corner — and then slid it out from there.
   *  The spell comes out of the HERO, so the gesture has to read as pushing it
   *  away from the hero. It is also the only model a directional spell could
   *  ever use: a line or a cone needs an origin and a direction, and an
   *  absolute finger position is neither.
   *
   *  The screen delta is turned into a world one through the CAMERA, so "drag
   *  up" means away from you whichever way the camera has been swung. */
  const place = (dx: number, dy: number): boolean => {
    const cam = opts.camera as THREE.PerspectiveCamera;
    cam.getWorldDirection(fwd);
    fwd.y = 0;
    if (fwd.lengthSq() < 1e-6) return false;
    fwd.normalize();
    right.crossVectors(fwd, UP).normalize();

    const from = opts.from();
    const r = opts.reach();
    const scale = r / FULL_DRAG();
    // Screen y grows downward, so dragging UP is forward.
    const wx = right.x * dx + fwd.x * -dy;
    const wz = right.z * dx + fwd.z * -dy;
    let ox = wx * scale;
    let oz = wz * scale;
    const d = Math.hypot(ox, oz);
    // Clamped, not refused. A circle that vanishes past the edge of the reach
    // reads as a bug; one that slides along the edge reads as a rule.
    if (d > r) { ox = (ox / d) * r; oz = (oz / d) * r; }
    target.set(from.x + ox, 0, from.z + oz);
    haveTarget = true;
    return true;
  };

  const show = (on: boolean): void => {
    reachRing.visible = on;
    blastRing.visible = on;
    if (!on) return;
    const from = opts.from();
    reachRing.position.set(from.x, 0.04, from.z);
    reachRing.scale.setScalar(opts.reach());
    blastRing.position.set(target.x, 0.05, target.z);
    blastRing.scale.setScalar(opts.radius());
  };

  const finish = (): void => {
    const wasArmed = armed;
    const hit = cancelled ? null : (haveTarget ? { x: target.x, z: target.z } : null);
    down = false;
    armed = false;
    haveTarget = false;
    pointerId = null;
    origin = null;
    screen = null;
    show(false);
    if (cancelled) { cancelled = false; return; }
    // A tap casts the old way: whatever the staff would have picked.
    if (!wasArmed || !hit) { opts.cast(null); return; }
    opts.cast(new THREE.Vector3(hit.x, 0, hit.z));
  };

  const onDown = (e: PointerEvent): void => {
    if (!opts.enabled()) return;
    if (pointerId !== null) return;
    pointerId = e.pointerId;
    down = true;
    armed = false;
    cancelled = false;
    pressedAt = performance.now();
    origin = { x: e.clientX, y: e.clientY };
    screen = { x: e.clientX, y: e.clientY };
    try { button?.setPointerCapture(e.pointerId); } catch { /* capture is a nicety */ }
  };
  const onMove = (e: PointerEvent): void => {
    if (!down || e.pointerId !== pointerId) return;
    screen = { x: e.clientX, y: e.clientY };
  };
  const onUp = (e: PointerEvent): void => {
    if (e.pointerId !== pointerId) return;
    // Let go over the button itself and nothing happens — the gesture's own
    // undo, and the only one a thumb already on the button can reach.
    if (armed && button) {
      const r = button.getBoundingClientRect();
      cancelled = e.clientX >= r.left && e.clientX <= r.right
        && e.clientY >= r.top && e.clientY <= r.bottom;
    }
    finish();
  };

  return {
    watch(btn) {
      if (btn === button) return;
      if (button) {
        button.removeEventListener('pointerdown', onDown);
        button.removeEventListener('pointermove', onMove);
        button.removeEventListener('pointerup', onUp);
        button.removeEventListener('pointercancel', onUp);
      }
      button = btn;
      if (!btn) return;
      btn.addEventListener('pointerdown', onDown);
      btn.addEventListener('pointermove', onMove);
      btn.addEventListener('pointerup', onUp);
      btn.addEventListener('pointercancel', onUp);
    },

    update(ndc, keyHeld) {
      if (ndc) hasMouse = true;
      if (!opts.enabled()) { show(false); return; }
      // The keyboard path, for a desktop that has no on-screen button: hold the
      // key and steer with the mouse, which is already an aiming device.
      if (!down && keyHeld && ndc) {
        down = true;
        armed = false;
        cancelled = false;
        pressedAt = performance.now();
        pointerId = -1;
        origin = {
          x: (ndc.x * 0.5 + 0.5) * window.innerWidth,
          y: (-ndc.y * 0.5 + 0.5) * window.innerHeight,
        };
      }
      if (down && pointerId === -1) {
        if (!keyHeld) { finish(); return; }
        if (ndc) {
          screen = {
            x: (ndc.x * 0.5 + 0.5) * window.innerWidth,
            y: (-ndc.y * 0.5 + 0.5) * window.innerHeight,
          };
        }
      }
      if (!down) { show(false); return; }
      if (!armed && performance.now() - pressedAt >= ARM_MS) armed = true;
      if (!armed) { show(false); return; }
      // Zero drag puts it on the caster — a hold with no movement casts at your
      // own feet, which is a real choice and not a mistake.
      if (screen && origin) place(screen.x - origin.x, screen.y - origin.y);
      else if (!haveTarget) place(0, 0);
      show(haveTarget);
    },

    aiming: () => armed,
    canAim: () => button !== null || hasMouse,
    at: () => (haveTarget && armed ? { x: target.x, z: target.z } : null),
    dispose() {
      this.watch(null);
      for (const m of [reachRing, blastRing]) {
        opts.scene.remove(m);
        m.geometry.dispose();
        (m.material as THREE.Material).dispose();
      }
    },
  };
}
