/**
 * The sweep over the attack button while a weapon is recharging.
 *
 * The cooldown already existed — 1.7 seconds between casts — and it was
 * entirely invisible: `heroAttack` returned early and nothing said why. Press
 * during it and the button does nothing, with no sound, no dimming and no
 * count. **A silent cooldown is indistinguishable from a broken button**, which
 * is a bad thing for a control to be mistaken for even once.
 *
 * Every MOBA draws this, and they draw it the same way — a dark wedge that
 * unwinds — because it answers both questions at a glance: why nothing
 * happened, and how long until it will.
 *
 * Drawn as an overlay tracking the button's rectangle rather than as a child of
 * it. The buttons belong to the SDK; borrowing one to hang a child on it is a
 * thing that breaks the next time the SDK rebuilds its controls.
 */
export interface CooldownDial {
  /** `left` is how much of the wait remains, 0 to 1. Zero hides it. */
  show(el: HTMLElement | null, left: number): void;
  dispose(): void;
}

export function createCooldownDial(host: HTMLElement): CooldownDial {
  const dial = document.createElement('div');
  dial.dataset.cooldown = '';
  dial.style.cssText = `
    position: fixed; border-radius: 50%; pointer-events: none; display: none;
    z-index: 12; mix-blend-mode: normal;
  `;
  host.append(dial);

  return {
    show(el, left) {
      if (!el || left <= 0.001) { dial.style.display = 'none'; return; }
      const r = el.getBoundingClientRect();
      if (r.width < 1) { dial.style.display = 'none'; return; }
      dial.style.left = `${r.left}px`;
      dial.style.top = `${r.top}px`;
      dial.style.width = `${r.width}px`;
      dial.style.height = `${r.height}px`;
      // Unwinding clockwise from the top: the dark part is what is LEFT, so it
      // shrinks away rather than filling up. Filling up reads as "charging",
      // and this is the opposite — the weapon is ready when the dark is gone.
      const deg = Math.max(0, Math.min(1, left)) * 360;
      dial.style.background =
        `conic-gradient(rgba(6,10,14,.66) ${deg}deg, rgba(0,0,0,0) 0deg)`;
      dial.style.display = 'block';
    },
    dispose() { dial.remove(); },
  };
}
