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
import { LEVELS, levelAbout, levelLabel } from '../go/opponent';
import { t, type Key } from '../i18n';
import type { BoardSize } from '../go/rules';

export interface MenuChoice {
  size: BoardSize;
  level: string;
  handicap: number;
}

export interface MenuOptions {
  /** Start a new game with these settings. */
  onStart(choice: MenuChoice): void;
  /** The level changed. Takes effect immediately, mid-game included. */
  onLevel(level: string): void;
  onHint(): void;
  onPass(): void;
  onResign(): void;
  onRecentre(): void;
  onTitle(): void;
  onMusic(on: boolean): void;
  onSound(on: boolean): void;
  /** Read back, so the panel shows what is actually true rather than what it
   *  set last time it was open. */
  music(): boolean;
  sound(): boolean;
  /** The panel was dismissed without choosing anything. */
  onClose?(): void;
}

const SIZES: BoardSize[] = [9, 13, 19];
const HANDICAPS = [0, 2, 3, 4, 5];

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
    const level = LEVELS.find((l) => l.id === this.choice.level) ?? LEVELS[1];
    this.el.className = this.standalone ? 'standalone' : '';
    this.el.replaceChildren();

    const head = document.createElement('div');
    head.className = 'title';
    // Opened to start a game, it is about the game being started; opened over
    // one, it is settings. Same controls either way — only the framing differs.
    head.textContent = t(this.standalone ? 'menu.newHeading' : 'menu.heading');
    this.el.appendChild(head);

    this.el.appendChild(this.group(t('menu.board'), SIZES.map((s) => ({
      label: `${s}×${s}`,
      on: this.choice.size === s,
      pick: () => { this.choice.size = s; this.draw(); },
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

    this.el.appendChild(this.group(t('menu.handicap'), HANDICAPS.map((h) => ({
      label: h === 0 ? t('menu.none') : `${h}`,
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
      act('btn.pass', this.opts.onPass);
      act('btn.resign', this.opts.onResign);
      act('btn.recentre', this.opts.onRecentre);
      this.el.appendChild(actions);
    }

    // Sound is a setting, not a question about the game being started. Opened
    // from the title this panel asks three things — which board, which
    // opponent, how many stones — and everything else it could ask makes that
    // list longer without making the decision better.
    //
    // Two switches, not two sliders. A Go board makes one sound; the useful
    // question is whether it makes it, not how loudly.
    if (!this.standalone) this.el.appendChild(this.group(t('menu.sound'), [
      { label: t('menu.music'), on: this.opts.music(), pick: () => { this.opts.onMusic(!this.opts.music()); this.draw(); } },
      { label: t('menu.effects'), on: this.opts.sound(), pick: () => { this.opts.onSound(!this.opts.sound()); this.draw(); } },
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
