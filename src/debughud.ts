import * as THREE from 'three';

/**
 * The frame counter, on the device that matters.
 *
 * A laptop renders this board without noticing two hundred draw calls; an
 * iPhone draws at 3x into a 2048 shadow map and very much does, and nothing
 * about a screenshot from either machine shows the difference. So the numbers
 * are on screen by default, in both the hub and the levels — the hub is
 * eleven hundred objects of forest now, and it was the one place with no way
 * to see what that cost.
 *
 * `?debug=0` turns it off; so do three quick taps on the HUD.
 *
 * TOP CENTRE, and never interactive. It started bottom-right, which is where
 * the jump and attack buttons are — a readout added to diagnose performance
 * covered the two controls a player needs most, and made itself one more thing
 * that was perfectly visible and quietly in the way.
 */
export interface DebugHud {
  el: HTMLDivElement;
  /** Call once a frame with the frame's dt, in seconds. */
  tick(now: number, dt: number, extra?: string): void;
  dispose(): void;
}

export function createDebugHud(
  renderer: THREE.WebGLRenderer,
  hudEl: HTMLElement,
  /** A banner that is always shown, above the numbers. `?dev` uses it, because
   *  a build quietly in god mode is a build whose every impression is wrong. */
  banner?: string,
  /** Three taps ON THE READOUT ITSELF. The hide gesture is three taps on the
   *  HUD BEHIND it, which is a different target and cannot be confused with
   *  this one — the readout is `pointer-events: auto` and the HUD's own
   *  listener never sees a tap that lands on it. */
  onTripleTap?: () => void,
): DebugHud {
  const el = document.createElement('div');
  el.style.cssText = `position: fixed; left: 50%; top: 8px; transform: translateX(-50%);
    z-index: 60; font: 600 11px/1.4 ui-monospace, monospace; color: #fff;
    text-align: center; background: rgba(0,0,0,.45); padding: 5px 9px;
    border-radius: 8px; white-space: pre;
    pointer-events: ${onTripleTap ? 'auto' : 'none'}; touch-action: manipulation;`;
  el.style.display = new URLSearchParams(location.search).get('debug') === '0' ? 'none' : 'block';
  document.body.appendChild(el);

  let taps = 0;
  let tapAt = 0;
  hudEl.style.pointerEvents = 'auto';
  const onTap = (e: PointerEvent): void => {
    if ((e.target as HTMLElement).tagName === 'BUTTON') return;
    const t = performance.now();
    taps = t - tapAt < 600 ? taps + 1 : 1;
    tapAt = t;
    if (taps >= 3) { taps = 0; el.style.display = el.style.display === 'none' ? 'block' : 'none'; }
  };
  hudEl.addEventListener('pointerdown', onTap);

  // The readout's own three taps, for the switch that has no keyboard.
  let own = 0;
  let ownAt = 0;
  const onOwnTap = (e: PointerEvent): void => {
    e.stopPropagation();
    const t = performance.now();
    own = t - ownAt < 700 ? own + 1 : 1;
    ownAt = t;
    if (own >= 3) { own = 0; onTripleTap?.(); }
  };
  if (onTripleTap) el.addEventListener('pointerdown', onOwnTap);

  let frames = 0;
  let since = performance.now();
  let worst = 0;

  return {
    el,
    tick(now: number, dt: number, extra?: string): void {
      if (el.style.display === 'none') return;
      frames += 1;
      worst = Math.max(worst, dt * 1000);
      if (now - since <= 500) return;
      const fps = (frames * 1000) / (now - since);
      const info = renderer.info.render;
      el.textContent =
        (banner ? `${banner}\n` : '')
        + `${fps.toFixed(0)} fps   worst ${worst.toFixed(0)}ms\n`
        + `${info.calls} draws  ${(info.triangles / 1000).toFixed(0)}k tris\n`
        + `dpr ${window.devicePixelRatio} → ${renderer.getPixelRatio()}`
        + `  ${renderer.domElement.width}×${renderer.domElement.height}`
        + (extra ? `\n${extra}` : '');
      frames = 0; since = now; worst = 0;
    },
    dispose(): void {
      hudEl.removeEventListener('pointerdown', onTap);
      el.removeEventListener('pointerdown', onOwnTap);
      el.remove();
    },
  };
}
