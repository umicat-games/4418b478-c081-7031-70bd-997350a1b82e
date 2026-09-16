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
  let screen: { x: number; y: number } | null = null;
  let armed = false;
  const target = new THREE.Vector3();
  let haveTarget = false;
  /** Released back over the button: the MOBA way of saying "never mind". */
  let cancelled = false;
  /** Whether a mouse has ever been seen. A phone has no cursor, and a desktop
   *  has no on-screen button — one of the two has to be there. */
  let hasMouse = false;

  /** Where a screen point lands on the ground, clamped to the reach. */
  const place = (sx: number, sy: number): boolean => {
    const el = (opts.camera as THREE.Camera & { userData?: unknown });
    void el;
    ndcTmp.set((sx / window.innerWidth) * 2 - 1, -(sy / window.innerHeight) * 2 + 1);
    ray.setFromCamera(ndcTmp, opts.camera as THREE.PerspectiveCamera);
    if (!ray.ray.intersectPlane(plane, hitPoint)) return false;
    const from = opts.from();
    const dx = hitPoint.x - from.x;
    const dz = hitPoint.z - from.z;
    const d = Math.hypot(dx, dz);
    const r = opts.reach();
    // Clamped, not refused. A circle that vanishes past the edge of the reach
    // reads as a bug; one that slides along the edge reads as a rule.
    if (d > r) { target.set(from.x + (dx / d) * r, 0, from.z + (dz / d) * r); }
    else target.set(hitPoint.x, 0, hitPoint.z);
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
      if (screen) place(screen.x, screen.y);
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
