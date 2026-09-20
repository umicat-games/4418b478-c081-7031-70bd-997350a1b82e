// Settings, and everything that used to be a button in the corner.
//
// One gear outside, everything behind it. The things a player does once a
// game or once a session — change sides, take a hint, take a move back,
// resign, straighten the camera, leave — do not each deserve a button sitting
// over the board where a thumb will find it by accident.
//
// Side and odds stage a choice and apply to the NEXT game; the level applies
// at once, because it is the next move that gets harder, not the position.
import './buttons.css';
import './menu.css';
import { LEVELS, levelAbout, levelLabel } from '../chess/opponent';
import { t, type Key } from '../i18n';
import type { Odds, Side } from '../chess/rules';

export interface MenuChoice {
  side: Side;
  level: string;
  odds: Odds;
}

export interface MenuOptions {
  /** Start a new game with these settings. */
  onStart(choice: MenuChoice): void;
  /** The level changed. Takes effect immediately, mid-game included. */
  onLevel(level: string): void;
  onHint(): void;
  onTakeback(): void;
  onResign(): void;
  onRecentre(): void;
  onTitle(): void;
  onMusic(on: boolean): void;
  onSound(on: boolean): void;
  onEval(on: boolean): void;
  /** Read back, so the panel shows what is actually true rather than what it
   *  set last time it was open. */
  music(): boolean;
  sound(): boolean;
  evalBar(): boolean;
  /** The panel was dismissed without choosing anything. */
  onClose?(): void;
}

const SIDES: Array<{ id: Side; key: Key }> = [
  { id: 'white', key: 'menu.white' },
  { id: 'black', key: 'menu.black' },
];
const ODDS: Array<{ id: Odds; key: Key }> = [
  { id: 'none', key: 'menu.none' },
  { id: 'knight', key: 'menu.oddsKnight' },
  { id: 'rook', key: 'menu.oddsRook' },
  { id: 'queen', key: 'menu.oddsQueen' },
];

export class Menu {
  readonly el: HTMLDivElement;
  private choice: MenuChoice;
  private inGame = false;
  /** Centred over the whole screen (from the title) rather than parked in the
   *  corner (over a game). */
  private standalone = false;

  constructor(initial: MenuChoice, private opts: MenuOptions) {
    this.choice = { ...initial };
    this.el = document.createElement('div');
    this.el.id = 'menu';
    this.el.hidden = true;
    document.body.appendChild(this.el);
    this.draw();
  }

  get open(): boolean { return !this.el.hidden; }

  toggle(): void { this.el.hidden ? this.show() : this.close(); }

  show(): void {
    this.el.hidden = false;
    this.draw();
  }

  close(): void {
    if (this.el.hidden) return;
    this.el.hidden = true;
    this.opts.onClose?.();
  }

  /** Keep the panel honest about the game's actual state — the level can be
   *  changed from here and from the companion, and a panel showing something
   *  else is worse than no panel. */
  sync(choice: Partial<MenuChoice>, inGame: boolean, standalone = false): void {
    Object.assign(this.choice, choice);
    this.inGame = inGame;
    this.standalone = standalone;
    this.draw();
  }

  private draw(): void {
    const level = LEVELS.find((l) => l.id === this.choice.level) ?? LEVELS[1];
    this.el.className = this.standalone ? 'standalone' : '';
    this.el.replaceChildren();

    const head = document.createElement('div');
    head.className = 'title';
    // Opened to start a game, it is about the game being started; opened over
    // one, it is settings. Same controls either way — only the framing differs.
    head.textContent = t(this.standalone ? 'menu.newHeading' : 'menu.heading');
    this.el.appendChild(head);

    this.el.appendChild(this.group(t('menu.side'), SIDES.map((s) => ({
      label: t(s.key),
      on: this.choice.side === s.id,
      pick: () => { this.choice.side = s.id; this.draw(); },
    }))));

    const levels = this.group(t('menu.opponent'), LEVELS.map((l) => ({
      label: levelLabel(l.id),
      on: l.id === level.id,
      pick: () => { this.choice.level = l.id; this.opts.onLevel(l.id); this.draw(); },
    })));
    const about = document.createElement('div');
    about.className = 'about';
    about.textContent = levelAbout(level.id);
    levels.appendChild(about);
    this.el.appendChild(levels);

    const odds = this.group(t('menu.odds'), ODDS.map((o) => ({
      label: t(o.key),
      on: this.choice.odds === o.id,
      pick: () => { this.choice.odds = o.id; this.draw(); },
    })));
    const oddsAbout = document.createElement('div');
    oddsAbout.className = 'about';
    oddsAbout.textContent = t('menu.oddsAbout');
    odds.appendChild(oddsAbout);
    this.el.appendChild(odds);

    const go = document.createElement('button');
    go.className = 'go lift';
    go.textContent = t(this.inGame ? 'menu.startNew' : 'menu.start');
    go.autofocus = true;
    go.onclick = () => { this.el.hidden = true; this.opts.onStart({ ...this.choice }); };
    this.el.appendChild(go);

    // What used to live in the corner. Only while there is a game: a hint or
    // a take-back with no board is a button that cannot mean anything.
    if (this.inGame) {
      const actions = document.createElement('div');
      actions.className = 'actions';
      const act = (key: Key, run: () => void): void => {
        const b = document.createElement('button');
        b.className = key === 'btn.resign' ? 'lift danger' : 'lift quiet';
        b.textContent = t(key);
        b.onclick = () => { this.el.hidden = true; run(); };
        actions.appendChild(b);
      };
      act('btn.hint', this.opts.onHint);
      act('btn.takeback', this.opts.onTakeback);
      act('btn.resign', this.opts.onResign);
      act('btn.recentre', this.opts.onRecentre);
      this.el.appendChild(actions);
    }

    // Switches, not sliders. A chess board makes one sound; the useful
    // question is whether it makes it.
    this.el.appendChild(this.group(t('menu.sound'), [
      { label: t('menu.music'), on: this.opts.music(), pick: () => { this.opts.onMusic(!this.opts.music()); this.draw(); } },
      { label: t('menu.effects'), on: this.opts.sound(), pick: () => { this.opts.onSound(!this.opts.sound()); this.draw(); } },
      { label: t('menu.eval'), on: this.opts.evalBar(), pick: () => { this.opts.onEval(!this.opts.evalBar()); this.draw(); } },
    ]));

    const home = document.createElement('button');
    home.className = 'home lift quiet';
    home.textContent = t('menu.toTitle');
    home.onclick = () => { this.el.hidden = true; this.opts.onTitle(); };
    this.el.appendChild(home);
  }

  private group(label: string, items: Array<{ label: string; on: boolean; pick(): void }>): HTMLDivElement {
    const wrap = document.createElement('div');
    wrap.className = 'group';
    const title = document.createElement('div');
    title.className = 'label';
    title.textContent = label;
    wrap.appendChild(title);

    const choices = document.createElement('div');
    choices.className = 'choices';
    for (const item of items) {
      const b = document.createElement('button');
      b.className = 'chip';
      b.textContent = item.label;
      b.setAttribute('aria-pressed', String(item.on));
      b.onclick = item.pick;
      choices.appendChild(b);
    }
    wrap.appendChild(choices);
    return wrap;
  }
}
