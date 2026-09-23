// Settings, and everything that used to be a button in the corner.
//
// The bottom-left had grown to six buttons over the board in the Go game. Five
// of them are things a player does once a game or once a session; one of them,
// the gear, is the way to all of it. So that is all that is left outside.
//
// What is the SHELL's here: the opponent's level, the assistant switch, sound,
// the eval bar, hint/resign/recentre, and the way back to the title. What is
// the GAME's: whatever else a new game needs decided — the board size here,
// the handicap in xiangqi, which colour you play in chess. Those come in as
// `groups`, and the game owns their values because it is the game that knows
// what they mean.
import './buttons.css';
import './menu.css';
import { t, type Key } from '../i18n';

/** One row of chips the game wants in the new-game panel. */
export interface SetupGroup {
  label: string;
  /**
   * Shown without being asked for.
   *
   * At most one or two things decide what game you are about to play — the
   * board size here, which colour in chess — and those are worth a row on a
   * panel somebody opened to press Start. Everything else is a preference,
   * and a preference in front of somebody who wants to play is a question
   * they did not ask.
   */
  primary?: boolean;
  options: Array<{ id: string; label: string }>;
  /** Which one is on, right now. */
  value: string;
  /** Chosen. Staged for the next game, or applied at once — the game decides,
   *  and says so in `note` if it matters. */
  pick(id: string): void;
}

export interface MenuChoice {
  level: string;
  /** Whether the AI assistant is part of this game at all. */
  companion: boolean;
}

export interface MenuOptions {
  /** The levels on offer, in order, with a line each about how they play. */
  levels: Array<{ id: string; label: string; about: string }>;
  /** The game's own new-game choices. Read fresh every time the panel draws. */
  groups(): SetupGroup[];
  /** One line under the group rows, if anything needs explaining. */
  note?: string;

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

export class Menu {
  readonly el: HTMLDivElement;
  private choice: MenuChoice;
  private inGame = false;
  /** Centred over the whole screen (from the title) rather than parked in the
   *  corner (over a game). */
  private standalone = false;
  /** Whether the rest of the settings are showing. A panel opened again is
   *  the short one again: the point is what you see WITHOUT asking. */
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
   *  changed from here and from the assistant, and a panel showing something
   *  else is worse than no panel. */
  sync(choice: Partial<MenuChoice>, inGame: boolean, standalone = false): void {
    Object.assign(this.choice, choice);
    this.inGame = inGame;
    this.standalone = standalone;
    this.draw();
  }

  private draw(): void {
    const levels = this.opts.levels;
    const level = levels.find((l) => l.id === this.choice.level) ?? levels[0];
    this.el.className = this.standalone ? 'standalone' : '';
    this.el.replaceChildren();

    const head = document.createElement('div');
    head.className = 'title';
    // Opened to start a game, it is about the game being started; opened over
    // one, it is settings. Same controls either way — only the framing differs.
    head.textContent = t(this.standalone ? 'menu.newHeading' : 'menu.heading');
    this.el.appendChild(head);

    const rowFor = (group: SetupGroup): HTMLDivElement => this.group(group.label, group.options.map((o) => ({
      label: o.label,
      on: group.value === o.id,
      pick: () => { group.pick(o.id); this.draw(); },
    })));
    const all = this.opts.groups();
    for (const group of all.filter((g) => g.primary)) this.el.appendChild(rowFor(group));

    // Everything that is not one of the two or three things worth asking
    // before a game goes behind one word. The panel is opened to press Start.
    const more = document.createElement('div');
    more.className = 'more';
    more.hidden = !this.showMore;

    for (const group of all.filter((g) => !g.primary)) more.appendChild(rowFor(group));

    const levelRow = this.group(t('menu.opponent'), levels.map((l) => ({
      label: l.label,
      on: l.id === level.id,
      pick: () => { this.choice.level = l.id; this.opts.onLevel(l.id); this.draw(); },
    })));
    const about = document.createElement('div');
    about.className = 'about';
    about.textContent = level.about;
    levelRow.appendChild(about);
    more.appendChild(levelRow);

    // A game-level switch, not a preference: it decides whether this game
    // talks to a language model at all. Off means no calls, no buttons, no
    // bubble.
    this.el.appendChild(this.group(t('menu.companion'), [
      { label: t('menu.on'), on: this.choice.companion, pick: () => { this.choice.companion = true; this.opts.onCompanion(true); this.draw(); } },
      { label: t('menu.off'), on: !this.choice.companion, pick: () => { this.choice.companion = false; this.opts.onCompanion(false); this.draw(); } },
    ]));

    if (!this.standalone) {
      more.appendChild(this.group(t('menu.sound'), [
        { label: t('menu.music'), on: this.opts.music(), pick: () => { this.opts.onMusic(!this.opts.music()); this.draw(); } },
        { label: t('menu.effects'), on: this.opts.sound(), pick: () => { this.opts.onSound(!this.opts.sound()); this.draw(); } },
        { label: t('menu.eval'), on: this.opts.evalBar(), pick: () => { this.opts.onEval(!this.opts.evalBar()); this.draw(); } },
      ]));
    }

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

    if (this.opts.note) {
      const note = document.createElement('div');
      note.className = 'about';
      note.textContent = this.opts.note;
      this.el.appendChild(note);
    }

    // What used to live in the corner. Only while there is a game: a hint with
    // no board is a button that cannot mean anything.
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
    // from the title, this panel asks the fewest things it can.
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
