// The title screen, and the only decision it asks for: carry on, or start over.
//
// "Start over" is narrower than it sounds, and the wording has to be honest
// about it: a new GAME is a new board, not a new student. What the coach knows
// about the player outlives any one game, the same way a teacher does not
// forget you between lessons. Forgetting is a separate, deliberate thing.
import './title.css';

export type TitleChoice = 'continue' | 'new' | 'forget';

export interface TitleOptions {
  /** There is an unfinished game to go back to. */
  canContinue: boolean;
  /** This player has been here before, even if no game is unfinished. */
  returning: boolean;
  /** Resolves when the engine is ready; until then the buttons say so. */
  loading: Promise<unknown>;
}

export function showTitle(opts: TitleOptions): Promise<TitleChoice> {
  const el = document.createElement('div');
  el.id = 'title';
  el.innerHTML = `
    <h1>GO with me</h1>
    <p class="sub">Play Go against a real engine, with a coach who will talk you through it.</p>
    <div class="buttons"></div>
    <p class="status">Waking up the engine…</p>`;
  document.body.appendChild(el);

  const buttons = el.querySelector('.buttons')!;
  const status = el.querySelector('.status')!;

  return new Promise<TitleChoice>((resolve) => {
    const choose = (choice: TitleChoice): void => {
      el.classList.add('leaving');
      // Let the fade finish before the node goes, but never leave it in the
      // DOM if the transition never fires (a backgrounded tab does that).
      setTimeout(() => el.remove(), 400);
      resolve(choice);
    };

    const add = (label: string, choice: TitleChoice, primary = false): HTMLButtonElement => {
      const b = document.createElement('button');
      b.textContent = label;
      if (primary) b.className = 'primary';
      b.onclick = () => choose(choice);
      buttons.appendChild(b);
      return b;
    };

    if (opts.canContinue) {
      add('Continue', 'continue', true);
      add('New game', 'new');
    } else {
      add(opts.returning ? 'Play' : 'Start', 'new', true);
    }
    // Only offered to someone who has a past worth erasing, and never made the
    // easy button to hit by accident.
    if (opts.returning) {
      const forget = add('Start fresh', 'forget');
      forget.title = 'Forget everything the coach knows about you, and begin again.';
      forget.onclick = () => {
        if (window.confirm('This clears the coach’s memory of you and any unfinished game. Sure?')) choose('forget');
      };
    }

    void opts.loading
      .then(() => { status.textContent = 'Engine ready.'; })
      .catch(() => { status.textContent = 'The engine could not load — the coach can still talk.'; });
  });
}
