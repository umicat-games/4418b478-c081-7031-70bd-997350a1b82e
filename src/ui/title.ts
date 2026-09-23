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

/**
 * The title art.
 *
 * The originals were uploaded through the platform's Asset Manager and live
 * at `cdn.umicat.ai/uploads/<game id>/go-with-me-title{,-bg}.png`. What ships
 * here are derived copies: the same pictures at the size they are actually
 * drawn, as WebP. **2.6MB became 181KB**, and that is the difference between
 * a title screen and a loading screen — at the originals' weight the boot bar
 * was still crawling two seconds into a throttled load, because a title
 * screen cannot appear until its title has arrived.
 *
 * Re-export the originals and they will need re-deriving; the recipe is in
 * CLAUDE.md.
 *
 * Both are decoration: if either fails to load, the wordmark falls back to
 * text and the background falls back to the gradient underneath it, which is
 * what the screen looked like before.
 *
 * **The fallback must not be what you see first.** The first version showed
 * the words and the plain gradient immediately and painted the art over them
 * when it arrived — which, with 2.6MB of PNG, read as the title screen
 * flashing the old design before settling into the new one. So the words are
 * hidden to begin with and only appear if the art genuinely is not coming,
 * and the picture fades in rather than popping. `index.html` starts both
 * downloads at parse time, before the bundle has even run.
 */
/** How long the screen waits for its artwork before falling back to words.
 *  Long enough to cover a warm cache and a decent connection, short enough
 *  that nobody is looking at a blank rectangle wondering. */
const ART_WAIT_MS = 1200;

const ART = { logo: 'art/logo.webp', table: 'art/table-bg.webp' };

/**
 * That path, made absolute against the PAGE.
 *
 * A relative `url()` that reaches CSS through a custom property is resolved
 * against the stylesheet it is substituted into — and in a production build
 * that stylesheet is `assets/index-*.css`, so `art/title-bg.webp` became
 * `assets/art/title-bg.webp` and 403'd. It worked in dev, where the CSS is
 * served from the page's own directory, and it worked for the wordmark,
 * which is an `<img src>` and therefore resolved against the document. Two
 * different rules for the same string, one of which only shows up in a
 * deployed build.
 */
const asUrl = (path: string): string => new URL(path, document.baseURI).href;

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
    <img class="logo" alt="GO with me">
    <h1 class="words">GO with me</h1>
    <div class="buttons"></div>
    <p class="status"></p>`;

  // The photograph goes on a layer of its own (`#title::before`) so it can be
  // faded in; the scrim over it is deliberately light — at 0.40 the sunlit
  // wood went brown, which is throwing away the artwork in order to protect
  // two lines of small text that a shadow protects just as well.
  el.style.setProperty('--table', `url("${asUrl(ART.table)}")`);

  const logo = el.querySelector('.logo') as HTMLImageElement;
  logo.src = ART.logo;

  /**
   * Show the art when it is all there, and the words only if it is not.
   *
   * Waiting for both together is what stops the screen assembling itself in
   * front of the player — a wordmark landing a second before its background
   * is the same flash, in two parts. The cap is what stops a slow network
   * leaving them looking at an empty screen: past it, the words appear and
   * the picture is welcome to arrive whenever it likes.
   */
  const settled = (src: string): Promise<boolean> => new Promise((done) => {
    const img = new Image();
    img.onload = () => done(true);
    img.onerror = () => done(false);
    img.src = src;
  });
  let decided = false;
  const decide = (art: boolean): void => {
    if (decided) return;
    decided = true;
    el.classList.add(art ? 'arted' : 'no-art');
    // The first thing the player sees is a finished screen, not one
    // assembling itself: the boot screen stays up until this decides.
    bootDone();
  };
  void Promise.all([settled(ART.logo), settled(ART.table)])
    .then(([a, b]) => decide(a && b));
  setTimeout(() => decide(false), ART_WAIT_MS);

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
