// The title screen, and the only decision it asks for: carry on, or start over.
//
// "Start over" is narrower than it sounds, and the wording has to be honest
// about it: a new GAME is a new board, not a new student. What the assistant knows
// about the player outlives any one game, the same way a teacher does not
// forget you between lessons. Forgetting is a separate, deliberate thing.
import './buttons.css';
import './title.css';
import { t } from '../i18n';
import { bootDone } from './boot';

/**
 * The title art: a wordmark over the table it is played on.
 *
 * Both files ship in `public/art/` at the size they are actually drawn, as
 * WebP. The originals — uploaded through the platform's Asset Manager and
 * served from `cdn.umicat.ai/uploads/<game id>/` — are well over a megabyte
 * each, and **a title screen cannot appear until its title has arrived**: at
 * the originals' weight the boot bar was still crawling two seconds into a
 * throttled load. CLAUDE.md has the recipe for re-deriving them.
 *
 * Both are decoration. If the wordmark does not load the game's name appears
 * as text; if the photograph does not, the gradient underneath it is what was
 * there before. **But the fallback must not be what you see FIRST** — the
 * words are hidden until the art has either arrived or given up, and the boot
 * screen stays up for that whole time, so the first thing anybody sees is a
 * finished screen rather than one assembling itself.
 */
const ART = { logo: 'art/logo.webp', table: 'art/table-bg.webp' };

/** How long the screen waits for its artwork before falling back to words. */
const ART_WAIT_MS = 1400;

/**
 * A path, made absolute against the PAGE.
 *
 * A relative `url()` that reaches CSS through a custom property is resolved
 * against the STYLESHEET it is substituted into — and in a production build
 * that stylesheet lives in `assets/`, so `art/table-bg.webp` became
 * `assets/art/table-bg.webp` and 403'd. It worked in dev, and it worked for
 * the wordmark, which is an `<img src>` and therefore resolved against the
 * document. Two rules for the same string, and only one of them shows up
 * before deploying.
 */
const asUrl = (path: string): string => new URL(path, document.baseURI).href;

export type TitleChoice = 'continue' | 'new' | 'online' | 'forget';

export interface TitleOptions {
  /** This player has been here before, even if no game is unfinished. */
  returning: boolean;
  /** There is a game worth going back to. */
  canContinue: boolean;
  /** Resolves when the engine is ready. Immediate here, and kept because the
   *  title screen is the one place that would have to wait if that changed. */
  loading: Promise<unknown>;
}

export function showTitle(opts: TitleOptions): Promise<TitleChoice> {
  const el = document.createElement('div');
  el.id = 'title';
  el.innerHTML = `
    <img class="logo" alt="">
    <h1 class="words"></h1>
    <div class="buttons"></div>
    <p class="status"></p>`;
  // Set as text, not as markup: a translation is content, and content does not
  // go through innerHTML.
  el.querySelector('h1')!.textContent = t('title.name');
  const logo = el.querySelector('.logo') as HTMLImageElement;
  logo.alt = t('title.name');
  logo.src = ART.logo;
  // The photograph goes on a layer of its own so it can fade in, and the grey
  // scrim spreads from the middle outwards on the layer above it.
  el.style.setProperty('--table', `url("${asUrl(ART.table)}")`);
  // There is nothing to download — the engine is a few hundred lines in this
  // bundle — so the status line under the buttons exists only to hold the
  // quiet "forget me" link above it.
  el.querySelector('.status')!.textContent = '';
  document.body.appendChild(el);

  /**
   * Show the art when it is ALL there, and the words only if it is not.
   *
   * Waiting for both together is what stops the screen assembling itself in
   * front of the player — a wordmark landing a second before its background
   * is the same flash, in two parts. The cap is what stops a slow network
   * leaving them looking at an empty screen: past it the words appear, and
   * the picture is welcome whenever it likes.
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
  void Promise.all([settled(ART.logo), settled(ART.table)]).then(([a, b]) => decide(a && b));
  setTimeout(() => decide(false), ART_WAIT_MS);

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

    // Two, and the second one opens the panel where the opponent and the
    // head start are chosen. There is no separate Settings
    // button because there is no separate settings screen: choosing what to
    // play and changing how it plays are the same panel, and a title screen
    // that offers both is offering the same door twice.
    if (opts.canContinue) add(t('title.continue'), 'continue', true);
    add(t('title.newGame'), 'new', !opts.canContinue);
    // The third door. Offered whatever the platform says about multiplayer:
    // a button that is missing tells the player nothing, and the lobby can
    // say "you need to be signed in" in a sentence.
    add(t('title.online'), 'online');
    // Only offered to someone who has a past worth erasing, and never made the
    // easy button to hit by accident.
    if (opts.returning) {
      const forget = addQuiet(t('title.fresh'), 'forget');
      forget.title = t('title.freshHint');
      forget.onclick = () => { if (window.confirm(t('title.freshConfirm'))) choose('forget'); };
    }

    void opts.loading.catch(() => { /* nothing to wait for, nothing to say */ });
    void status;
  });
}
