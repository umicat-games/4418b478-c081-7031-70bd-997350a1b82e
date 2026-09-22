// The title screen, and the only decision it asks for: carry on, or start over.
//
// "Start over" is narrower than it sounds, and the wording has to be honest
// about it: a new GAME is a new board, not a new student. What the coach knows
// about the player outlives any one game, the same way a teacher does not
// forget you between lessons. Forgetting is a separate, deliberate thing.
import './buttons.css';
import './title.css';
import { t } from '../i18n';

/**
 * The title art.
 *
 * Uploaded through the platform's Asset Manager, which puts a game's files
 * under its own prefix on the CDN — the same host this game is served from,
 * so there is no CORS to think about and nothing to copy into the repo. The
 * game id is in the path because that prefix IS the game's.
 *
 * Both are decoration: if either fails to load, the wordmark falls back to
 * text and the background falls back to the gradient underneath it, which is
 * what the screen looked like before.
 */
const ART = {
  wordmark: 'https://cdn.umicat.ai/uploads/f60d9eec-40ae-42fd-be1d-2c1f2cf428db/go-with-me-title.png',
  background: 'https://cdn.umicat.ai/uploads/f60d9eec-40ae-42fd-be1d-2c1f2cf428db/go-with-me-title-bg.png',
};

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
    <h1><img class="wordmark" alt="GO with me"><span class="words">GO with me</span></h1>
    <div class="buttons"></div>
    <p class="status"></p>`;

  // The photograph sits under a scrim, so the buttons keep their contrast
  // whatever the picture is doing behind them — but a lighter one than the
  // gradient used to be on its own: at the old 0.40 in the middle the wood
  // went from sunlit to brown, which is throwing away the artwork in order
  // to protect two lines of text that a shadow protects just as well.
  el.style.backgroundImage =
    `radial-gradient(ellipse at center, rgba(12, 14, 18, 0.22), rgba(12, 14, 18, 0.76)), url("${ART.background}")`;

  const wordmark = el.querySelector('.wordmark') as HTMLImageElement;
  // Words until the picture is there, and words again if it never arrives —
  // a title screen with no title on it is worse than a plain one.
  wordmark.onload = () => el.classList.add('arted');
  wordmark.onerror = () => wordmark.remove();
  wordmark.src = ART.wordmark;

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

    void opts.loading
      .then(() => { status.textContent = t('title.ready'); })
      .catch(() => { status.textContent = t('title.failed'); });
  });
}
