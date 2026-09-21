// How it ended.
//
// The headline is about the player — "you win" or who did — and the table
// below is the whole board's business. In a four-handed game second place is
// a real result, so every seat gets its line, in seat order, with the winners
// lifted rather than sorted to the top: the colours stay where the player has
// been reading them all game.
import { Screen, button, h1, p, row } from './screen';
import { COLOURS, PERFECT } from '../blokus/pieces';
import { t } from '../i18n';

export interface Standing {
  seat: number;
  name: string;
  score: number;
  left: number;
}

export interface ResultOptions {
  rows: Standing[];
  winners: number[];
  mySeat: number;
  /** The player's best score before this game, for "your best yet". */
  best: number;
}

export type ResultChoice = 'again' | 'title';

export function showResult(screen: Screen, opts: ResultOptions): Promise<ResultChoice> {
  return new Promise((resolve) => {
    const iWon = opts.winners.includes(opts.mySeat);
    const mine = opts.rows.find((r) => r.seat === opts.mySeat);

    const headline = iWon
      ? t('over.youWin')
      : opts.winners.length > 1
        ? t('over.tie')
        : t('over.winner', { name: opts.rows.find((r) => r.seat === opts.winners[0])?.name ?? '' });

    const table = document.createElement('div');
    table.className = 'scores';
    for (const r of opts.rows) {
      const line = document.createElement('div');
      line.className = 'line' + (opts.winners.includes(r.seat) ? ' top' : '');
      const dot = document.createElement('span');
      dot.className = 'dot';
      dot.style.background = `#${COLOURS[r.seat].toString(16).padStart(6, '0')}`;
      const who = document.createElement('span');
      who.className = 'who';
      who.textContent = r.name;
      const pts = document.createElement('span');
      pts.className = 'pts';
      pts.textContent = String(r.score);
      const rest = document.createElement('span');
      rest.className = 'rest';
      rest.textContent = t('hud.left', { n: r.left });
      line.append(dot, who, pts, rest);
      table.appendChild(line);
    }

    const nodes: Node[] = [h1(t('over.heading')), p(headline, 'sub'), table];
    // Two things worth saying out loud, and only when they are true: a
    // perfect game is rare enough to be an event, and a personal best is the
    // only reason to care about the number when you did not win.
    if (mine && mine.score === PERFECT) nodes.push(p(t('over.perfect')));
    else if (mine && mine.score > opts.best) nodes.push(p(t('over.best')));

    nodes.push(row(
      button(t('over.title'), () => resolve('title')),
      button(t('over.again'), () => resolve('again'), 'primary'),
    ));

    screen.wide(true);
    screen.show(...nodes);
  });
}
