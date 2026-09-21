// Settings, and everything that would otherwise be a button in a corner.
//
// One gear outside, everything behind it. The things a player does once a
// session — turn the music off, straighten the camera, re-read the rules,
// leave — do not each deserve a button sitting over a board where a thumb
// will find it by accident.
//
// Switches, not sliders. A board game makes one kind of sound; the useful
// question is whether it makes it.
import './buttons.css';
import './menu.css';
import { t } from '../i18n';
import { DIFFICULTIES, type Difficulty } from '../blokus/bot';
import type { Settings } from '../save';

export interface MenuOptions {
  /** Read back, so the panel shows what is actually true rather than what it
   *  set the last time it was open. */
  get(): Settings;
  set(patch: Partial<Settings>): void;
  onRecentre(): void;
  onRules(): void;
  onLeave(): void;
  onClose?(): void;
}

export class Menu {
  readonly el: HTMLDivElement;
  /** Whether there is a game to leave, and bots whose level means anything. */
  private inGame = false;
  private solo = true;

  constructor(private opts: MenuOptions) {
    this.el = document.createElement('div');
    this.el.id = 'menu';
    this.el.hidden = true;
    document.body.appendChild(this.el);
  }

  get open(): boolean { return !this.el.hidden; }

  toggle(): void { this.el.hidden ? this.show() : this.close(); }

  show(): void { this.el.hidden = false; this.draw(); }

  close(): void {
    if (this.el.hidden) return;
    this.el.hidden = true;
    this.opts.onClose?.();
  }

  /** Tell the panel what kind of game it is sitting over. Online, the bot
   *  level is still here — the host is the one running them, and a panel that
   *  hides the setting from everyone else would leave a player wondering
   *  where it went. */
  context(inGame: boolean, solo: boolean): void {
    this.inGame = inGame;
    this.solo = solo;
    if (this.open) this.draw();
  }

  private draw(): void {
    const s = this.opts.get();
    this.el.replaceChildren();

    const head = document.createElement('div');
    head.className = 'title';
    head.textContent = t('menu.heading');
    this.el.appendChild(head);

    this.el.appendChild(this.group(t('menu.sound'), [
      { label: t('menu.music'), on: s.music, pick: () => this.patch({ music: !s.music }) },
      { label: t('menu.effects'), on: s.sound, pick: () => this.patch({ sound: !s.sound }) },
    ]));

    this.el.appendChild(this.group(t('menu.helpers'), [
      { label: t('menu.anchors'), on: s.anchors, pick: () => this.patch({ anchors: !s.anchors }) },
    ]));

    // Changing the level mid-game is allowed and takes effect on the bots'
    // next turn. It is the position that is already on the board, not the
    // opponent, and nobody wants to restart a forty-move game to make the
    // bots easier.
    this.el.appendChild(this.group(t('menu.bots'), DIFFICULTIES.map((d: Difficulty) => ({
      label: t(`diff.${d}`),
      on: s.difficulty === d,
      pick: () => this.patch({ difficulty: d }),
    }))));

    const actions = document.createElement('div');
    actions.className = 'actions';
    const act = (label: string, run: () => void, cls = 'lift quiet'): void => {
      const b = document.createElement('button');
      b.className = cls;
      b.textContent = label;
      b.onclick = () => { this.el.hidden = true; run(); };
      actions.appendChild(b);
    };
    if (this.inGame) act(t('menu.recentre'), () => this.opts.onRecentre());
    act(t('menu.rules'), () => this.opts.onRules());
    this.el.appendChild(actions);

    if (this.inGame) {
      const leave = document.createElement('button');
      leave.className = 'leave lift danger';
      leave.textContent = t('menu.leave');
      leave.onclick = () => {
        // An online game cannot be come back to, and a solo one is saved on
        // the way out — so the question is worth asking once either way.
        if (!window.confirm(t('confirm.leave'))) return;
        this.el.hidden = true;
        this.opts.onLeave();
      };
      this.el.appendChild(leave);
    }

    const note = document.createElement('div');
    note.className = 'note';
    note.textContent = this.solo ? '' : t('lobby.botFill');
    if (note.textContent) this.el.appendChild(note);
  }

  private patch(p: Partial<Settings>): void {
    this.opts.set(p);
    this.draw();
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
