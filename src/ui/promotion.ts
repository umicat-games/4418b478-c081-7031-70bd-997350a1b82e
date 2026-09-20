// Which piece the pawn becomes.
//
// Asked, not assumed. Auto-queening is right almost every time and the
// exception is the one a beginner needs to meet: there are positions where a
// queen is stalemate and a rook is mate, and a game that quietly queens for
// you has taken that away without mentioning it.
//
// Asked at the LAST moment — after the tick, not before — so the question
// only ever appears for a move that is actually being played.
import './buttons.css';
import './promotion.css';
import { t } from '../i18n';

export type Promotion = 'q' | 'r' | 'b' | 'n';

const CHOICES: Array<{ id: Promotion; key: 'promo.queen' | 'promo.rook' | 'promo.bishop' | 'promo.knight' }> = [
  { id: 'q', key: 'promo.queen' },
  { id: 'r', key: 'promo.rook' },
  { id: 'b', key: 'promo.bishop' },
  { id: 'n', key: 'promo.knight' },
];

/** Resolves with the chosen piece. Dismissing it chooses a queen, because a
 *  dialog that can be escaped into a cancelled move leaves the player holding
 *  a piece with no way to put it down. */
export function askPromotion(): Promise<Promotion> {
  const el = document.createElement('div');
  el.id = 'promotion';
  const box = document.createElement('div');
  box.className = 'box';
  const head = document.createElement('div');
  head.className = 'title';
  head.textContent = t('promo.heading');
  box.appendChild(head);
  const row = document.createElement('div');
  row.className = 'choices';
  box.appendChild(row);
  el.appendChild(box);
  document.body.appendChild(el);

  return new Promise<Promotion>((resolve) => {
    const done = (p: Promotion): void => { el.remove(); resolve(p); };
    for (const c of CHOICES) {
      const b = document.createElement('button');
      b.className = c.id === 'q' ? 'lift' : 'lift quiet';
      b.textContent = t(c.key);
      b.onclick = () => done(c.id);
      row.appendChild(b);
    }
    el.addEventListener('click', (e) => { if (e.target === el) done('q'); });
  });
}
