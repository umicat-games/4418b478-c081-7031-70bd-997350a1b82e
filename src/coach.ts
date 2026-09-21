import { installLiftStyles, LIFT } from './buttons';

/**
 * The tutorial, and it is not a script.
 *
 * The tower defense this is forked from taught itself with a scripted board:
 * nine steps in a fixed order, each one staging the world it needed — spawn
 * this, open that, wait for the player to stand there. It worked because
 * building a tower is a thing you do at leisure, on a board that can be made
 * to hold still.
 *
 * Nothing here holds still. Enemies cross on a clock, bullets are in the air,
 * and the moment a lesson MEANS anything is the moment its subject happens to
 * exist — the first bullet of your own colour, the first time you have enough
 * magic to spend. So a lesson is a CONDITION, not a position in a list:
 *
 *   - it fires the first time its `when` is true, and never again;
 *   - the order between lessons is whatever order the game produces them in;
 *   - a lesson whose moment never arrives simply never fires, and costs
 *     nothing. There is no queue to get stuck in and no step to fail to
 *     complete, which is the entire class of bug the scripted board spent
 *     three sections of its own notes defending against.
 *
 * **It does not pause and it does not dim.** The scripted board could put a
 * panel over the world because the world was waiting for it. A panel here
 * would be read while something crosses the screen, which makes reading it a
 * cost — and worse, the thing being explained is usually happening RIGHT NOW,
 * behind the panel. So a lesson is a strip at the top, it holds for a few
 * seconds, and it goes.
 */

export interface Lesson {
  id: string;
  /** Fires the first time this is true. Called once a frame; keep it cheap. */
  when(): boolean;
  /** Two or three words, a verb first, and it NAMES the thing — never "it".
   *  The heading is read in the instant before the body, so at that moment
   *  there is nothing behind a pronoun at all. */
  title: string;
  /** One sentence. What to do, or what just happened and why. */
  text: string;
  /** How long it holds, in real seconds. */
  hold?: number;
}

export interface Coach {
  /** Call once a frame with real (unclamped) seconds. */
  update(realDt: number): void;
  /** Which lessons have fired, for the save. */
  seen(): string[];
  dispose(): void;
}

export interface CoachOpts {
  host: HTMLElement;
  lessons: Lesson[];
  /** Ids already learned in an earlier session. A player does not get taught
   *  the same thing on their second run. */
  already: string[];
  /** Told whenever one fires, so the caller can persist it. */
  onFire?(id: string): void;
}

/** The shortest gap between two lessons.
 *
 *  Conditions come true in clumps — your first orb absorbed is very likely to
 *  be within a second of your first enemy — and two strips replacing each
 *  other inside a second is one strip nobody read. */
const GAP = 1.6;

export function createCoach(opts: CoachOpts): Coach {
  installLiftStyles();
  const fired = new Set(opts.already);
  const pending: Lesson[] = [];
  let showing: { left: number } | null = null;
  let cooldown = 0;

  const strip = document.createElement('div');
  strip.dataset.coach = '';
  strip.style.cssText = `
    position: fixed; left: 50%; top: 14px; transform: translateX(-50%) translateY(-14px);
    z-index: 90; max-width: min(560px, 92vw); padding: 10px 16px 11px;
    border-radius: 14px; background: rgba(10,14,20,.86); color: #fff;
    font: 500 14px/1.45 system-ui, sans-serif; text-align: center;
    box-shadow: inset 0 0 0 1.5px rgba(255,255,255,.34);
    opacity: 0; transition: opacity .22s, transform .22s;
    pointer-events: none;   /* it is never in the way of a control */
  `;
  const h = document.createElement('div');
  // Cyan, the colour this game's ancestor reserved for pointing at things.
  // Gold already means "chosen" and red means "you are being hurt".
  h.style.cssText = 'font:800 12px/1.3 system-ui; letter-spacing:.09em; color:#4fd2ff;';
  const body = document.createElement('div');
  body.style.cssText = 'margin-top:3px;';
  strip.append(h, body);
  opts.host.append(strip);

  const show = (l: Lesson): void => {
    // `innerHTML`, deliberately. `pressName()` returns MARKUP — it puts the
    // button's own icon into the sentence, which is the whole point of it:
    // "press the ⟨swap⟩ button" has to show the picture the button is
    // actually wearing. Into a `textContent` sink that prints four hundred
    // characters of `<span style=...>` on screen, which this game has shipped
    // once already. Every string reaching here is authored in `main.ts`.
    h.innerHTML = l.title.toUpperCase();
    body.innerHTML = l.text;
    strip.style.opacity = '1';
    strip.style.transform = 'translateX(-50%) translateY(0)';
    showing = { left: l.hold ?? 4.4 };
  };

  const hide = (): void => {
    strip.style.opacity = '0';
    strip.style.transform = 'translateX(-50%) translateY(-14px)';
    showing = null;
    cooldown = GAP;
  };

  return {
    update(realDt: number) {
      if (showing) {
        showing.left -= realDt;
        if (showing.left <= 0) hide();
        // Conditions are still WATCHED while one is on screen — a lesson whose
        // moment passes behind another lesson would otherwise be lost for the
        // rest of the run. It queues instead.
      } else if (cooldown > 0) {
        cooldown -= realDt;
      }

      for (const l of opts.lessons) {
        if (fired.has(l.id)) continue;
        let ready = false;
        try { ready = l.when(); } catch { ready = false; }
        if (!ready) continue;
        // Marked the moment the condition is TRUE, not when it is shown. A
        // lesson that waits its turn behind another must not re-arm each
        // frame, or the queue fills with copies of itself.
        fired.add(l.id);
        opts.onFire?.(l.id);
        pending.push(l);
      }

      if (!showing && cooldown <= 0 && pending.length) show(pending.shift()!);
    },
    seen: () => [...fired],
    dispose() { strip.remove(); },
  };
}
