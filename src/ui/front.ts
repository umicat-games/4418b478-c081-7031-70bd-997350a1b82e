// The screens before the game: the title, the rules, and how hard the bots
// should play. All three are the same card (`Screen`), which is why they live
// together — a player moves between them without anything else appearing or
// disappearing underneath.
import { Screen, button, h1, p, row, stack, status } from './screen';
import { t } from '../i18n';
import type { Difficulty } from '../blokus/bot';

export type TitleChoice = 'continue' | 'solo' | 'online';

export interface TitleOptions {
  /** There is an unfinished game against the bots to go back to. */
  canContinue: boolean;
  /** Resolves when the board and its sounds are ready. */
  loading: Promise<unknown>;
}

export function showTitle(screen: Screen, opts: TitleOptions): Promise<TitleChoice> {
  return new Promise((resolve) => {
    const line = status();
    line.textContent = t('title.loading');

    const buttons = stack();
    const choose = (c: TitleChoice) => () => resolve(c);
    // One raised violet button — the thing to press. Continuing an unfinished
    // game outranks starting one, because somebody who left mid-game came
    // back for the board they left.
    if (opts.canContinue) buttons.appendChild(button(t('title.continue'), choose('continue'), 'primary'));
    buttons.appendChild(button(t('title.solo'), choose('solo'), opts.canContinue ? 'quiet' : 'primary'));
    buttons.appendChild(button(t('title.online'), choose('online')));

    screen.wide(false);
    screen.show(
      h1('Blokus'),
      p(t('title.tagline')),
      buttons,
      row(button(t('title.rules'), () => void showRules(screen).then(() => showTitle(screen, opts).then(resolve)))),
      line,
    );

    void opts.loading.then(() => { line.textContent = ''; }).catch(() => { line.textContent = ''; });
  });
}

/** The four sentences that are the whole game. Shown on request, never
 *  forced: a player who already knows Blokus does not need a tutorial, and
 *  one that cannot be skipped is the first thing they will resent. */
export function showRules(screen: Screen): Promise<void> {
  return new Promise((resolve) => {
    const list = document.createElement('ul');
    list.className = 'rules';
    (['rules.one', 'rules.two', 'rules.three', 'rules.four'] as const).forEach((key, i) => {
      const li = document.createElement('li');
      const n = document.createElement('b');
      n.textContent = String(i + 1);
      const text = document.createElement('span');
      text.textContent = t(key);
      li.append(n, text);
      list.appendChild(li);
    });
    screen.wide(false);
    screen.show(
      h1(t('rules.heading')),
      list,
      row(button(t('rules.close'), () => resolve(), 'primary')),
    );
  });
}

/**
 * How hard the bots play. Asked before a solo game, remembered afterwards.
 *
 * Each level is described by what it DOES, not by a number of stars: "gets its
 * big pieces out and keeps its options open" is something a player can check
 * against the game they just had, and a rating is not.
 */
export function pickDifficulty(screen: Screen, current: Difficulty): Promise<Difficulty | null> {
  return new Promise((resolve) => {
    let chosen = current;
    const list = stack();
    const draw = (): void => {
      list.replaceChildren();
      (['easy', 'medium', 'hard'] as const).forEach((id) => {
        const b = document.createElement('button');
        b.className = 'option';
        b.setAttribute('aria-pressed', String(chosen === id));
        const name = document.createElement('div');
        name.className = 'name';
        name.textContent = t(`diff.${id}`);
        const about = document.createElement('div');
        about.className = 'about';
        about.textContent = t(`diff.${id}.about`);
        b.append(name, about);
        b.onclick = () => { chosen = id; draw(); };
        list.appendChild(b);
      });
    };
    draw();

    screen.wide(false);
    screen.show(
      h1(t('diff.heading')),
      list,
      row(
        button(t('diff.back'), () => resolve(null)),
        button(t('diff.start'), () => resolve(chosen), 'primary'),
      ),
    );
  });
}
