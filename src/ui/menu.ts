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
  /** Whether the AI assistant is part of this game at all. */
  companion: boolean;
}

export interface MenuOptions {
  /** Start a new game with these settings. */
  onStart(choice: MenuChoice): void;
  /** The level changed. Takes effect immediately, mid-game included. */
  onLevel(level: string): void;
  /** Switched mid-game; a new game takes it from `onStart`'s choice. */
  onCompanion(on: boolean): void;
  onHint(): void;
  onTakeback(): void;
  onResign(): void;
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
  /**
   * Whether the rest of the settings are showing.
   *
   * One or two things decide what game you are about to play — which colour,
   * here — and those get a row on a panel somebody opened in order to press
   * Start. Everything else is a preference, and a preference in front of
   * somebody who wants to play is a question they did not ask. A panel opened
   * again is the short one again.
   */
  private showMore = false;

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
    this.showMore = false;
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

    /**
     * The way out, in the corner where every panel on a phone keeps it.
     *
     * It is `close()` and not "back to the title": what closing MEANS is
     * already the caller's business — over a game it puts the board back,
     * and opened from the title there is no board to put back, so `onClose`
     * returns there. One button, right in both places, instead of a button
     * whose label is a destination.
     */
    const shut = document.createElement('button');
    shut.className = 'shut';
    shut.type = 'button';
    shut.setAttribute('aria-label', t('menu.close'));
    shut.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true">'
      + '<path d="M6 6l12 12M18 6L6 18"/></svg>';
    shut.onclick = () => this.close();
    this.el.appendChild(shut);

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

    // A game-level switch, not a preference: it decides whether this game
    // talks to a language model at all. Off means no calls, no buttons, no
    // bubble — see `companion` in main.ts.
    this.el.appendChild(this.group(t('menu.companion'), [
      { label: t('menu.on'), on: this.choice.companion, pick: () => { this.choice.companion = true; this.opts.onCompanion(true); this.draw(); } },
      { label: t('menu.off'), on: !this.choice.companion, pick: () => { this.choice.companion = false; this.opts.onCompanion(false); this.draw(); } },
    ]));

    const more = document.createElement('div');
    more.className = 'more';
    more.hidden = !this.showMore;

    const levels = this.group(t('menu.opponent'), LEVELS.map((l) => ({
      label: levelLabel(l.id),
      on: l.id === level.id,
      pick: () => { this.choice.level = l.id; this.opts.onLevel(l.id); this.draw(); },
    })));
    const about = document.createElement('div');
    about.className = 'about';
    about.textContent = levelAbout(level.id);
    levels.appendChild(about);
    more.appendChild(levels);

    const odds = this.group(t('menu.odds'), ODDS.map((o) => ({
      label: t(o.key),
      on: this.choice.odds === o.id,
      pick: () => { this.choice.odds = o.id; this.draw(); },
    })));
    const oddsAbout = document.createElement('div');
    oddsAbout.className = 'about';
    oddsAbout.textContent = t('menu.oddsAbout');
    odds.appendChild(oddsAbout);
    more.appendChild(odds);

    if (!this.standalone) more.appendChild(this.group(t('menu.sound'), [
      { label: t('menu.music'), on: this.opts.music(), pick: () => { this.opts.onMusic(!this.opts.music()); this.draw(); } },
      { label: t('menu.effects'), on: this.opts.sound(), pick: () => { this.opts.onSound(!this.opts.sound()); this.draw(); } },
      { label: t('menu.eval'), on: this.opts.evalBar(), pick: () => { this.opts.onEval(!this.opts.evalBar()); this.draw(); } },
    ]));

    const disclose = document.createElement('button');
    disclose.className = 'more-toggle quiet-link';
    disclose.textContent = t(this.showMore ? 'menu.less' : 'menu.more');
    disclose.onclick = () => { this.showMore = !this.showMore; this.draw(); };
    this.el.appendChild(disclose);
    this.el.appendChild(more);

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
      this.el.appendChild(actions);
    }

    // Sound is a setting, not a question about the game being started. Opened
    // from the title this panel asks three things — which side, which
    // opponent, what odds — and everything else it could ask makes that list
    // longer without making the decision better.
    //
    // Switches, not sliders. A chess board makes one sound; the useful
    // question is whether it makes it.


    this.pin();
  }

  /**
   * The button is the floor of the panel.
   *
   * Everything above it scrolls; it does not. On a phone the settings are
   * taller than the panel — open "more" and they are much taller — and a
   * start button that scrolls with them is a start button the player has to
   * go looking for, directly after being given a list of things to read.
   *
   * It is full-bleed, and that is the point rather than a flourish: a button
   * that reaches the panel's own corners IS the bottom of the panel, so there
   * is nothing under it to scroll to and nothing to mistake it for. The
   * panel's `overflow: hidden` is what rounds it — the button sets no radius
   * of its own, so this keeps working if the panel's radius changes.
   *
   * Done here rather than by building the panel in two halves, because each
   * game in the family writes its own `draw()` and they all append to the
   * same element. This is the one step they can share.
   */
  private pin(): void {
    const go = this.el.querySelector(':scope > .go');
    const shut = this.el.querySelector(':scope > .shut');
    // The heading stays too, and not for symmetry: the close button is pinned
    // to the corner, and with the heading scrolled away it was left floating
    // over a row of settings, reading as part of whatever had scrolled under
    // it. A pinned button needs something pinned behind it.
    const head = this.el.querySelector(':scope > .title');
    if (!go) return;
    const body = document.createElement('div');
    body.className = 'body';
    // `appendChild` MOVES, so this empties the panel down to what stays put.
    for (const node of [...this.el.children]) {
      if (node !== go && node !== shut && node !== head) body.appendChild(node);
    }
    this.el.replaceChildren(...(head ? [head] : []), ...(shut ? [shut] : []), body, go);
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
