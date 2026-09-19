// The title screen, and the only decision it asks for: carry on, or start over.
//
// "Start over" is narrower than it sounds, and the wording has to be honest
// about it: a new GAME is a new board, not a new student. What the coach knows
// about the player outlives any one game, the same way a teacher does not
// forget you between lessons. Forgetting is a separate, deliberate thing.
import './title.css';
import { t } from '../i18n';

export type TitleChoice = 'course' | 'play' | 'forget';

export interface TitleOptions {
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
    <div class="buttons"></div>
    <p class="status"></p>`;
  // Set as text, not as markup: a translation is content, and content does not
  // go through innerHTML.
  el.querySelector('.status')!.textContent = t('title.loading');
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
    /** Below the row, and quieter. Erasing someone's history is not one of the
     *  four things they came here to choose between. */
    const addQuiet = (label: string, choice: TitleChoice): HTMLButtonElement => {
      const b = add(label, choice);
      b.className = 'quiet';
      // Under the row but ABOVE the engine's status line, which is the last
      // thing on the screen because it is the least important.
      el.insertBefore(b, el.querySelector('.status'));
      return b;
    };

    // Two doors, and nothing else. Everything the old screen offered —
    // continue this game, continue that lesson, start a new one — is a
    // decision about WHICH, and belongs behind the door it is about. A title
    // screen with four buttons asks a beginner to understand the product
    // before it has shown them anything.
    add(t('title.course'), 'course', true);
    add(t('title.freeplay'), 'play');
    // Only offered to someone who has a past worth erasing, and never made the
    // easy button to hit by accident.
    if (opts.returning) {
      const forget = addQuiet(t('title.fresh'), 'forget');
      forget.title = t('title.freshHint');
      forget.onclick = () => { if (window.confirm(t('title.freshConfirm'))) choose('forget'); };
    }

    void opts.loading
      .then(() => { status.textContent = t('title.ready'); })
      .catch(() => { status.textContent = t('title.failed'); });
  });
}
