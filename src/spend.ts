import { icon, type IconName } from './icons';
import { installLiftStyles, LIFT } from './buttons';

/**
 * The one place mana is spent on something other than an attack.
 *
 * **It pauses.** Choosing between healing and a better weapon is a decision,
 * and a decision taken while the board keeps shooting is not a decision — it
 * is a reflex with a menu in front of it. The tower defense this grew out of
 * made the opposite call for its own upgrades and was right to: there you are
 * standing on a tower, the thing you are buying is in front of you, and the
 * board is meant to keep running. Here the panel covers the field, so the
 * field has to stop.
 *
 * Two offers, never more. Heal, or make the weapon better. A list that grows
 * is a list that gets read; two buttons get PRESSED, which is what a panel
 * opened mid-fight has to be.
 */

export interface Offer {
  id: 'heal' | 'upgrade';
  glyph: IconName;
  title: string;
  /** What it does, in the player's terms. Never a stat line. */
  body: string;
  cost: number;
  /** Why it cannot be taken, or null when it can. Shown INSTEAD of the price:
   *  "you cannot afford it" and "there is nothing left to buy" are different
   *  problems and only one of them is fixed by playing on. */
  blocked: string | null;
}

export interface SpendPanel {
  readonly open: boolean;
  show(): void;
  close(): void;
  dispose(): void;
}

export interface SpendOpts {
  pause(on: boolean): void;
  /** Read at the moment it opens, not when it was built — mana moves. */
  offers(): Offer[];
  mana(): number;
  manaMax(): number;
  take(id: Offer['id']): void;
  press(): void;
}

export function createSpendPanel(opts: SpendOpts): SpendPanel {
  installLiftStyles();
  let open = false;

  // Its own layer over everything. The HUD is click-through, so a panel
  // parented to it is a panel you can press straight past.
  const layer = document.createElement('div');
  layer.dataset.spendPanel = '';
  layer.style.cssText = `
    position: fixed; inset: 0; z-index: 120; display: none;
    align-items: center; justify-content: center;
    background: rgba(8,10,14,.62); padding: 16px;
  `;

  const card = document.createElement('div');
  card.style.cssText = `
    width: min(520px, 94vw); max-height: 92svh; overflow: auto;
    background: rgba(18,22,28,.97); border-radius: 18px; padding: 18px;
    font: 500 15px/1.5 system-ui, sans-serif; color: #fff;
  `;
  layer.append(card);

  const render = (): void => {
    card.textContent = '';

    const head = document.createElement('div');
    head.style.cssText = 'display:flex; align-items:baseline; justify-content:space-between; gap:12px;';
    const h = document.createElement('div');
    h.style.cssText = 'font:800 18px/1.4 system-ui;';
    h.textContent = 'Spend magic';
    const have = document.createElement('div');
    have.style.cssText = 'opacity:.75; font-variant-numeric: tabular-nums;';
    have.textContent = `${Math.floor(opts.mana())} / ${opts.manaMax()}`;
    head.append(h, have);
    card.append(head);

    for (const o of opts.offers()) {
      const row = document.createElement('button');
      const affordable = !o.blocked && opts.mana() >= o.cost;
      row.className = LIFT.plain;
      row.disabled = !affordable;
      row.style.cssText = `
        display: flex; gap: 12px; align-items: center; text-align: left;
        width: 100%; margin-top: 12px; padding: 12px 14px; border: 0;
        border-radius: 14px; cursor: ${affordable ? 'pointer' : 'not-allowed'};
        opacity: ${affordable ? 1 : 0.55};
      `;
      const g = icon(o.glyph, '22px');
      const text = document.createElement('div');
      text.style.cssText = 'flex:1; min-width:0;';
      const t = document.createElement('div');
      t.style.cssText = 'font:800 15px/1.4 system-ui;';
      t.textContent = o.title;
      const b = document.createElement('div');
      b.style.cssText = 'opacity:.72; font-size:13px;';
      b.textContent = o.body;
      text.append(t, b);
      const price = document.createElement('div');
      price.style.cssText = 'font:800 14px/1.4 system-ui; white-space:nowrap; opacity:.9;';
      // The reason, where the price would be. A refusal the player cannot read
      // is a button that does nothing.
      price.textContent = o.blocked ?? `${o.cost}`;
      row.append(g, text, price);
      row.addEventListener('click', () => {
        if (!affordable) return;
        opts.take(o.id);
        close();
      });
      card.append(row);
    }

    const back = document.createElement('button');
    back.className = LIFT.quiet;
    back.style.cssText = `
      width: 100%; margin-top: 14px; padding: 11px; border: 0; border-radius: 14px;
      cursor: pointer; font: 700 15px/1 system-ui;
    `;
    back.textContent = 'Back to the fight';
    back.addEventListener('click', () => close());
    card.append(back);
  };

  const show = (): void => {
    if (open) return;
    open = true;
    render();
    layer.style.display = 'flex';
    opts.pause(true);
  };

  const close = (): void => {
    if (!open) return;
    open = false;
    layer.style.display = 'none';
    opts.pause(false);
  };

  document.body.append(layer);

  return {
    get open() { return open; },
    show,
    close,
    dispose() { close(); layer.remove(); },
  };
}
