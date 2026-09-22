// The title screen, and the only decision it asks for: carry on, or start over.
//
// "Start over" is narrower than it sounds, and the wording has to be honest
// about it: a new GAME is a new board, not a new student. What the coach knows
// about the player outlives any one game, the same way a teacher does not
// forget you between lessons. Forgetting is a separate, deliberate thing.
import './buttons.css';
import './title.css';
import { t } from '../i18n';
import { bootDone } from './boot';

export type TitleChoice = 'continue' | 'new' | 'forget';

export interface TitleOptions {
  /** This player has been here before, even if no game is unfinished. */
  returning: boolean;
  /** There is a game worth going back to. */
  canContinue: boolean;
  /** Resolves when the engine is ready; until then the buttons say so. */
  loading: Promise<unknown>;
}

export function showTitle(opts: TitleOptions): Promise<TitleChoice> {
  const el = document.createElement('div');
  el.id = 'title';
  el.innerHTML = `
    <h1>Chess with me</h1>
    <div class="buttons"></div>
    <p class="status"></p>`;
  // Set as text, not as markup: a translation is content, and content does not
  // go through innerHTML.
  el.querySelector('.status')!.textContent = t('title.loading');
  document.body.appendChild(el);
  // The first thing the player sees is a finished screen, not one assembling
  // itself: the boot screen stays up until this one is in the DOM.
  bootDone();

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
      // One raised green button per screen — the thing to press. The rest are
      // the quiet variant, which is a choice rather than a suggestion.
      b.className = primary ? 'lift' : 'lift quiet';
      b.onclick = () => choose(choice);
      buttons.appendChild(b);
      return b;
    };
    /** Below the row, and quieter. Erasing someone's history is not one of the
     *  four things they came here to choose between. */
    const addQuiet = (label: string, choice: TitleChoice): HTMLButtonElement => {
      const b = add(label, choice);
      b.className = 'quiet-link';
      // Under the row but ABOVE the engine's status line, which is the last
      // thing on the screen because it is the least important.
      el.insertBefore(b, el.querySelector('.status'));
      return b;
    };

    // Two, and the second one opens the panel where the board size, the
    // opponent and the handicap are chosen. There is no separate Settings
    // button because there is no separate settings screen: choosing what to
    // play and changing how it plays are the same panel, and a title screen
    // that offers both is offering the same door twice.
    if (opts.canContinue) add(t('title.continue'), 'continue', true);
    add(t('title.newGame'), 'new', !opts.canContinue);
    // Only offered to someone who has a past worth erasing, and never made the
    // easy button to hit by accident.
    if (opts.returning) {
      const forget = addQuiet(t('title.fresh'), 'forget');
      forget.title = t('title.freshHint');
      forget.onclick = () => { if (window.confirm(t('title.freshConfirm'))) choose('forget'); };
    }

    // Once it's ready there's nothing worth telling the player — the buttons
    // already work. Only a failure is worth a line here.
    void opts.loading
      .then(() => { status.textContent = ''; })
      .catch(() => { status.textContent = t('title.failed'); });
  });
}
