/**
 * What a button in this game looks like when it is pressable.
 *
 * Two things, and only two, turn a coloured rectangle into a surface: the top
 * edge catching the light, and a deeper slab of THE SAME HUE underneath for the
 * face to sit on. The colours themselves are untouched by this file — `#ffd76a`
 * is the yellow it always was; what is added is the relief around it.
 *
 * It is a stylesheet rather than more `cssText` for one reason that cannot be
 * worked around: **`:active` cannot be written inline.** The press is not
 * decoration — a raised button that does not go down when pushed reads as a
 * picture of a button — so the styling had to leave the style attribute.
 *
 * It is SHARED rather than per-screen because the buttons were not: nine
 * `<button>`s across five files, thirty-six inline `border-radius` declarations
 * and no helper between them. Copying a relief block into each one would have
 * turned one kind of duplication into a longer kind.
 *
 * ## Why this is layout-safe
 *
 * The slab is a `box-shadow`, and box-shadows do not take part in layout — no
 * reflow, no element moves. That is what makes it safe to put on the hotbar
 * cells and the action pad, whose widths are measured at runtime from the room
 * left beside the platform's own controls. The only places that need a margin
 * are the ones where the shadow would otherwise land on top of whatever sits
 * directly beneath it.
 *
 * ## Not everything should be raised
 *
 * `scripted.ts`'s Skip is deliberately the quietest thing on the screen — it is
 * offered late, to a player who may be stuck, and making it stand out would be
 * the game suggesting you take it. It keeps its flat pill on purpose.
 */

/** Class names, so call sites do not spell them by hand.
 *
 *  Every button takes `lift`; the rest are modifiers on top of it, and they
 *  work by overriding custom properties rather than restating the shadow. */
export const LIFT = {
  /** The yellow one. At most one per screen — it is the thing to press. */
  primary: 'lift',
  /** Translucent white over the world. The other choice. */
  quiet: 'lift quiet',
  /** A SOLID red face — the title's Erase. Not for a translucent red on a dark
   *  panel: the slab would come out brighter than the button. */
  danger: 'lift danger',
  /** On a white panel, where the dark chrome would be a hole. */
  plain: 'lift plain',
  /** Chrome over the game: close crosses and the desktop pad's button. */
  dark: 'lift dark',
} as const;

/**
 * Flat, with a hairline rim. NOT a `lift`, and that is the point.
 *
 * Relief says "press me", and it was wrong on the three things it was first put
 * on: the readout plate is not pressable at all, and a hotbar cell is SELECTED
 * rather than pressed — the bar is a set of chips showing what you could build,
 * and the one that is chosen says so with a thick gold edge. Raising them made
 * the HUD look like a row of keys.
 *
 * A rim, not a border: it is an inset box-shadow, so it costs no layout and can
 * go on elements whose `border` is already carrying the selection.
 */
export const RIM = 'rim';

const CSS = `
  .lift {
    /* How far it sinks. The slab shrinks by the SAME number when pressed —
       anything else and the face slides rather than seats. */
    --d: 4px;
    --slab: #e8a92b;
    --top: rgba(255,255,255,.58);
    --rim: 0 0 0 0 transparent;
    --inner: inset 0 -3px 0 rgba(180,120,10,.16);
    /* The resting relief as ONE named value, because something else animates
       box-shadow on these same elements: the tutorial's breathing ring. A
       keyframe that writes box-shadow REPLACES the property, so the highlighted
       button would go flat for exactly as long as the tutorial is pointing at
       it. scripted.ts appends this instead of overwriting. */
    --lift-rest: inset 0 2px 0 var(--top), var(--rim), var(--inner),
                 0 var(--d) 0 var(--slab),
                 0 calc(var(--d) + 3px) 10px rgba(0,0,0,.26);
    box-shadow: var(--lift-rest);
    transition: transform .06s ease-out, box-shadow .06s ease-out;
    -webkit-tap-highlight-color: transparent;
  }
  .lift.quiet {
    --slab: rgba(0,0,0,.26); --top: rgba(255,255,255,.34);
    --rim: inset 0 0 0 1px rgba(255,255,255,.20); --inner: 0 0 0 0 transparent;
  }
  .lift.danger {
    --d: 3px; --slab: #9c2f27; --top: rgba(255,255,255,.28);
    --inner: 0 0 0 0 transparent;
  }
  .lift.plain {
    --d: 3px; --slab: rgba(35,49,60,.20); --top: rgba(255,255,255,.55);
    --inner: 0 0 0 0 transparent;
  }
  .lift.dark {
    --d: 3px; --slab: rgba(0,0,0,.40); --top: rgba(255,255,255,.20);
    --inner: 0 0 0 0 transparent;
  }
  .lift:active:not(:disabled), .lift.pressed:not(:disabled) {
    transform: translateY(var(--d));
    box-shadow: inset 0 2px 0 var(--top), var(--rim),
                0 1px 0 var(--slab), 0 2px 5px rgba(0,0,0,.24);
  }
  /* A disabled button must not look pressable and must not move. The shop's
     "needs 40g" is a disabled <button>, and a raised one invites the press
     it is going to refuse. */
  .lift:disabled {
    --slab: rgba(0,0,0,.16); --top: rgba(255,255,255,.08);
    --rim: 0 0 0 0 transparent; --inner: 0 0 0 0 transparent;
    box-shadow: inset 0 1px 0 var(--top), 0 2px 0 var(--slab);
    transform: none;
  }
  .rim { box-shadow: inset 0 0 0 1.5px rgba(255,255,255,.34); }
  @media (prefers-reduced-motion: reduce) { .lift { transition: none; } }
`;

let installed = false;

/**
 * Put the stylesheet in, once.
 *
 * Idempotent and safe to call from anywhere, because the screens that need it
 * come and go in any order — the title may or may not appear, the hub and a
 * level never exist at the same time, and the settings dialog is built by both.
 */
export function installLiftStyles(): void {
  if (installed || typeof document === 'undefined') return;
  installed = true;
  const style = document.createElement('style');
  style.dataset.liftStyles = '';
  style.textContent = CSS;
  document.head.append(style);

  // `:active` DOES NOT FIRE ON TOUCH, and this game is played on phones.
  //
  // Measured rather than assumed: the same button under a real mouse press
  // matches `:active` and travels its 4px, and under a real touch press
  // `matches(':active')` is false and the transform stays `none`. So the one
  // platform the press was FOR was the one platform that never got it.
  //
  // Capture phase, because the layer under all of this stops propagation of
  // its own events; `passive`, because none of this ever cancels a gesture.
  const press = (on: boolean) => (e: Event): void => {
    if (on) {
      const el = (e.target as HTMLElement | null)?.closest?.('.lift');
      if (el && !(el as HTMLButtonElement).disabled) el.classList.add('pressed');
      return;
    }
    for (const el of document.querySelectorAll('.pressed')) el.classList.remove('pressed');
  };
  const opts = { capture: true, passive: true } as const;
  document.addEventListener('pointerdown', press(true), opts);
  // Every way out, not just its own release. A button whose only exit is its
  // own `pointerup` is a button that can be left held — the same rule the
  // aiming gesture and the action pad already follow.
  for (const type of ['pointerup', 'pointercancel', 'blur', 'visibilitychange']) {
    window.addEventListener(type, press(false), opts);
  }
}
