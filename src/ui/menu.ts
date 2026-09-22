// Settings, and everything that used to be a button in the corner.
//
// The bottom-left had grown to six buttons over the board. Five of them are
// things a player does once a game or once a session — change the board, take
// a hint, pass, resign, straighten the camera, leave — and one of them, the
// gear, is the way to all of it. So that is all that is left outside.
//
// Board size and handicap stage a choice and apply to the NEXT game; the level
// applies at once, because it is the next move that gets harder, not the
// position. The panel says so rather than leaving it to be discovered.
import './buttons.css';
import './menu.css';
import { LEVELS, levelAbout, levelLabel } from '../xiangqi/opponent';
import { t, type Key } from '../i18n';
import type { Handicap } from '../xiangqi/rules';

export interface MenuChoice {
  level: string;
  /** What Black gives away before the first move. Xiangqi has no equivalent of
   *  Go's extra stones — Red already moves first — so a head start is
   *  material, and the engine plays the whole game a piece down. */
  handicap: Handicap;
  /** Whether the AI assistant is part of this game at all. */
  companion: boolean;
}

export interface MenuOptions {
  /** Start a new game with these settings. */
  onStart(choice: MenuChoice): void;
  /** The level changed. Takes effect immediately, mid-game included. */
  onLevel(level: string): void;
  onHint(): void;
  onResign(): void;
  onTitle(): void;
  /** Switched mid-game; a new game takes it from `onStart`'s choice. */
  onCompanion(on: boolean): void;
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

const HANDICAPS: Handicap[] = ['none', 'horse', 'horses', 'chariot'];

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

  /** Dismissed by tapping outside it — the same as close, and the only way out
   *  of the panel when it is opened from the title. */
  private dismiss(): void { this.close(); }

  /** Keep the panel honest about the game's actual state — the level can be
   *  changed from here and from the coach, and a panel showing something else
   *  is worse than no panel. */
  sync(choice: Partial<MenuChoice>, inGame: boolean, standalone = false): void {
    Object.assign(this.choice, choice);
    this.inGame = inGame;
    this.standalone = standalone;
    this.draw();
  }

  private draw(): void {
    const level = LEVELS.find((l: { id: string }) => l.id === this.choice.level) ?? LEVELS[1];
    this.el.className = this.standalone ? 'standalone' : '';
    this.el.replaceChildren();

    const head = document.createElement('div');
    head.className = 'title';
    // Opened to start a game, it is about the game being started; opened over
    // one, it is settings. Same controls either way — only the framing differs.
    head.textContent = t(this.standalone ? 'menu.newHeading' : 'menu.heading');
    this.el.appendChild(head);

    const levels = this.group(t('menu.opponent'), LEVELS.map((l: { id: string }) => ({
      label: levelLabel(l.id),
      on: l.id === level.id,
      pick: () => { this.choice.level = l.id; this.opts.onLevel(l.id); this.draw(); },
    })));
    const about = document.createElement('div');
    about.className = 'about';
    about.textContent = levelAbout(level.id);
    levels.appendChild(about);
    this.el.appendChild(levels);

    // A game-level switch, not a preference: it decides whether this game
    // talks to a language model at all. Off means no calls, no buttons, no
    // bubble — see `companion` in main.ts.
    this.el.appendChild(this.group(t('menu.companion'), [
      { label: t('menu.on'), on: this.choice.companion, pick: () => { this.choice.companion = true; this.opts.onCompanion(true); this.draw(); } },
      { label: t('menu.off'), on: !this.choice.companion, pick: () => { this.choice.companion = false; this.opts.onCompanion(false); this.draw(); } },
    ]));

    this.el.appendChild(this.group(t('menu.handicap'), HANDICAPS.map((h) => ({
      label: t(`handicap.${h}` as Key),
      on: this.choice.handicap === h,
      pick: () => { this.choice.handicap = h; this.draw(); },
    }))));

    const go = document.createElement('button');
    go.className = 'go lift';
    go.textContent = t(this.inGame ? 'menu.startNew' : 'menu.start');
    go.autofocus = true;
    go.onclick = () => { this.el.hidden = true; this.opts.onStart({ ...this.choice }); };
    this.el.appendChild(go);

    // What used to live in the corner. Only while there is a game: a hint or a
    // pass with no board is a button that cannot mean anything.
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
      act('btn.resign', this.opts.onResign);
      this.el.appendChild(actions);
    }

    // Sound is a setting, not a question about the game being started. Opened
    // from the title this panel asks three things — which opponent, whether
    // the assistant is in, how much of a head start — and everything else it
    // could ask makes that list longer without making the decision better.
    //
    // Two switches, not two sliders. The useful question is whether a piece
    // makes a noise when it lands, not how loud it is.
    if (!this.standalone) this.el.appendChild(this.group(t('menu.sound'), [
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
