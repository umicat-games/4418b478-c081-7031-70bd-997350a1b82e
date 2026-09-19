// The setup panel. Board size, opponent strength, handicap, and the button
// that starts the game they describe.
//
// Nothing here changes a game in progress. Picking a size or a level stages a
// choice; "New game" is what applies it — because the alternative is a player
// tapping 19x19 out of curiosity mid-game and losing the position they were in.
// The one exception is the level, which takes effect immediately when there is
// no game running, so the first game starts with what the panel shows.
import './menu.css';
import { LEVELS, levelAbout, levelLabel } from '../go/opponent';
import { t } from '../i18n';
import type { BoardSize } from '../go/rules';

export interface MenuChoice {
  size: BoardSize;
  level: string;
  handicap: number;
}

export interface MenuOptions {
  /** Start a game with these settings. */
  onStart(choice: MenuChoice): void;
  /** The level changed while no game was running. */
  onLevel(level: string): void;
  /** Leave for the title screen. */
  onTitle(): void;
}

const SIZES: BoardSize[] = [9, 13, 19];
const HANDICAPS = [0, 2, 3, 4, 5];

export class Menu {
  readonly el: HTMLDivElement;
  private choice: MenuChoice;
  private inGame = false;

  constructor(initial: MenuChoice, private opts: MenuOptions) {
    this.choice = { ...initial };
    this.el = document.createElement('div');
    this.el.id = 'menu';
    this.el.hidden = true;
    document.body.appendChild(this.el);
    this.draw();
  }

  get open(): boolean { return !this.el.hidden; }
  toggle(): void { this.el.hidden = !this.el.hidden; }
  close(): void { this.el.hidden = true; }

  /** Keep the panel honest about the game's actual state — the coach can change
   *  the level and the size too, and a panel showing something else is worse
   *  than no panel. */
  sync(choice: Partial<MenuChoice>, inGame: boolean): void {
    Object.assign(this.choice, choice);
    this.inGame = inGame;
    this.draw();
  }

  private draw(): void {
    const level = LEVELS.find((l) => l.id === this.choice.level) ?? LEVELS[1];
    this.el.replaceChildren();

    this.el.appendChild(this.group(t('menu.board'), SIZES.map((s) => ({
      label: `${s}×${s}`,
      on: this.choice.size === s,
      pick: () => { this.choice.size = s; this.draw(); },
    }))));

    const levels = this.group(t('menu.opponent'), LEVELS.map((l) => ({
      label: levelLabel(l.id),
      on: l.id === level.id,
      pick: () => {
        this.choice.level = l.id;
        // A level is the one setting that is safe to change mid-game: it is the
        // next move that gets harder, not the position.
        this.opts.onLevel(l.id);
        this.draw();
      },
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
    go.className = 'go';
    go.textContent = this.inGame ? t('menu.startNew') : t('menu.start');
    go.onclick = () => {
      this.close();
      this.opts.onStart({ ...this.choice });
    };
    this.el.appendChild(go);

    if (this.inGame) {
      const note = document.createElement('div');
      note.className = 'note';
      note.textContent = t('menu.note');
      this.el.appendChild(note);
    }

    // The way out. In the settings rather than the button bar because that is
    // where a game keeps "quit to menu", and quiet because leaving mid-game is
    // not what most of the taps in here are for.
    const home = document.createElement('button');
    home.className = 'home';
    home.textContent = t('menu.toTitle');
    home.onclick = () => { this.close(); this.opts.onTitle(); };
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
      b.textContent = item.label;
      b.setAttribute('aria-pressed', String(item.on));
      b.onclick = item.pick;
      choices.appendChild(b);
    }
    wrap.appendChild(choices);
    return wrap;
  }
}
