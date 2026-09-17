import { icon } from './icons';

/**
 * The settings dialog, and the button that opens it.
 *
 * It replaces the mute button, which was the only audio control the game had:
 * one switch, all or nothing, with no way to turn the music down and keep
 * hearing what is shooting at you. Those are the two things players actually
 * want to set apart from each other, so they are two sliders — and mute is
 * simply a slider at zero, which is one control fewer to explain.
 *
 * It is also the only way out of a level that is not winning or losing one.
 *
 * **Opening it PAUSES.** A settings panel over a live board is a panel you read
 * while something walks into your base, which makes reading it a cost. The
 * pause is real: the caller stops advancing the world, and input is switched
 * off so the hero does not walk on behind the dialog.
 */

export interface SettingsOpts {
  /** Where the button goes — the HUD's own button row. */
  host: HTMLElement;
  music: { get(): number; set(v: number): void };
  sfx: { get(): number; set(v: number): void };
  /** Remember the levels. Called when a slider settles, not on every pixel. */
  save(): void;
  /** Stop and start the world. */
  pause(on: boolean): void;
  /** Give up on this run and go back to the village, or null where there is
   *  nothing to leave — the village itself. */
  leave: (() => void) | null;
}

export interface Settings {
  readonly button: HTMLElement;
  readonly open: boolean;
  close(): void;
  dispose(): void;
}

const ROW = 'display:flex; align-items:center; gap:10px; margin:14px 0 0;';

export function createSettings(opts: SettingsOpts): Settings {
  const button = document.createElement('button');
  button.dataset.settingsButton = '';
  button.setAttribute('aria-label', 'Settings');
  button.style.cssText = `
    margin-top: 8px; width: 34px; height: 34px; border-radius: 17px; border: 0;
    background: rgba(0,0,0,.35); color: #fff; cursor: pointer;
    display: flex; align-items: center; justify-content: center;
    pointer-events: auto;   /* the HUD itself is click-through */
  `;
  button.append(icon('settings', '17px'));
  opts.host.append(button);

  // Its own layer over everything, rather than a child of the HUD: the HUD is
  // click-through, and a dialog that lets clicks past it is a dialog you can
  // build a tower through.
  const shade = document.createElement('div');
  shade.dataset.settings = '';
  shade.style.cssText = `
    position: fixed; inset: 0; z-index: 60; display: none;
    background: rgba(0,0,0,.55);
    align-items: center; justify-content: center;
  `;

  const panel = document.createElement('div');
  panel.style.cssText = `
    position: relative; min-width: 280px; max-width: 86vw;
    background: rgba(18,22,28,.96); color: #fff; border-radius: 16px;
    padding: 18px 22px 20px; font: 600 14px/1.6 system-ui, sans-serif;
    max-height: 92vh; max-height: 92svh; overflow: auto;
  `;
  shade.append(panel);
  document.body.append(shade);

  // Top LEFT, macOS-style and the same as every other panel in this game: the
  // right corner belongs to umicat's own quit pill, and two round buttons a few
  // pixels apart — one closing a dialog, one leaving the game — is a misfire
  // waiting to happen, with the expensive one not ours to undo.
  const close = document.createElement('button');
  close.type = 'button';
  // NOT `data-panel-close`. That attribute is the village panel's, and a probe
  // that asks for it started matching two elements the moment this dialog
  // borrowed it — Playwright took the first, which is this one with its layer
  // hidden, and waited for a hidden button to become clickable until it timed
  // out. A hook shared by two dialogs is a hook that names neither.
  close.dataset.settingsClose = '';
  close.setAttribute('aria-label', 'Close');
  close.style.cssText = `
    position: absolute; top: 10px; left: 10px; width: 32px; height: 32px;
    border: 0; border-radius: 999px; background: rgba(255,255,255,.14);
    color: #fff; font: 700 17px/1 system-ui; cursor: pointer; padding: 0;
    display: flex; align-items: center; justify-content: center;
  `;
  close.textContent = '×';
  panel.append(close);

  const title = document.createElement('div');
  title.textContent = 'Settings';
  title.style.cssText = 'font:800 17px/1.3 system-ui; text-align:center; padding:2px 0 4px;';
  panel.append(title);

  /** A slider with its name and its value, because a bare slider tells you
   *  where the handle is and not what it is doing. */
  const slider = (
    label: string, read: () => number, write: (v: number) => void, tag: string,
  ): HTMLElement => {
    const row = document.createElement('div');
    row.style.cssText = ROW;
    const name = document.createElement('span');
    name.textContent = label;
    name.style.cssText = 'width:64px; opacity:.85;';
    const input = document.createElement('input');
    input.type = 'range';
    input.min = '0';
    input.max = '100';
    input.step = '5';
    input.dataset.volume = tag;
    input.style.cssText = 'flex:1; accent-color:#4fd2ff; cursor:pointer;';
    const out = document.createElement('span');
    out.style.cssText = 'width:38px; text-align:right; font-variant-numeric:tabular-nums; opacity:.75;';
    const show = (): void => { out.textContent = `${input.value}%`; };
    const sync = (): void => { input.value = String(Math.round(read() * 100)); show(); };
    // `input` while dragging so it is audible as you move it — a volume slider
    // you cannot hear until you let go is one you set by guessing. `change`
    // only for the save, so a drag does not write the save forty times.
    input.addEventListener('input', () => { write(Number(input.value) / 100); show(); });
    input.addEventListener('change', () => opts.save());
    sync();
    row.append(name, input, out);
    (row as HTMLElement & { sync?: () => void }).sync = sync;
    return row;
  };

  const musicRow = slider('Music', () => opts.music.get(), (v) => opts.music.set(v), 'music');
  const sfxRow = slider('Sound', () => opts.sfx.get(), (v) => opts.sfx.set(v), 'sfx');
  panel.append(musicRow, sfxRow);

  let leaveBtn: HTMLButtonElement | null = null;
  let confirming = false;
  if (opts.leave) {
    const rule = document.createElement('div');
    rule.style.cssText = 'height:1px; background:rgba(255,255,255,.14); margin:18px 0 4px;';
    panel.append(rule);

    leaveBtn = document.createElement('button');
    leaveBtn.dataset.leave = '';
    leaveBtn.style.cssText = `
      display:block; width:100%; margin-top:12px; padding:11px 14px;
      border:0; border-radius:12px; background:rgba(239,75,75,.22);
      color:#ff9b9b; font:700 14px/1.2 system-ui; cursor:pointer;
    `;
    // Two presses, because the cost is not recoverable: the run is not saved,
    // and a player who meant to close the dialog and hit this instead has lost
    // the board. The second press SAYS what is lost rather than asking a yes/no
    // question in a second dialog on top of this one.
    const armed = (on: boolean): void => {
      confirming = on;
      leaveBtn!.textContent = on
        ? 'Really leave? This run is not saved'
        : 'Leave the level';
      leaveBtn!.style.background = on ? 'rgba(239,75,75,.42)' : 'rgba(239,75,75,.22)';
      leaveBtn!.style.color = on ? '#fff' : '#ff9b9b';
    };
    armed(false);
    leaveBtn.onclick = () => {
      if (!confirming) { armed(true); return; }
      hide();
      opts.leave?.();
    };
    panel.append(leaveBtn);
  }

  let open = false;
  const show = (): void => {
    if (open) return;
    open = true;
    // The sliders may have been moved by something else since last time — a
    // save loaded, another scene's dialog — so they are read, not remembered.
    (musicRow as HTMLElement & { sync?: () => void }).sync?.();
    (sfxRow as HTMLElement & { sync?: () => void }).sync?.();
    if (leaveBtn) { confirming = false; leaveBtn.textContent = 'Leave the level';
      leaveBtn.style.background = 'rgba(239,75,75,.22)'; leaveBtn.style.color = '#ff9b9b'; }
    shade.style.display = 'flex';
    opts.pause(true);
  };
  const hide = (): void => {
    if (!open) return;
    open = false;
    shade.style.display = 'none';
    opts.pause(false);
  };

  button.onclick = () => (open ? hide() : show());
  close.onclick = hide;
  // The backdrop dismisses, the panel does not. Clicking through to the game
  // would be a click the player did not mean to make on the board behind.
  shade.addEventListener('pointerdown', (e) => { if (e.target === shade) hide(); });
  const onKey = (e: KeyboardEvent): void => {
    if (e.code !== 'Escape') return;
    if (open) { e.preventDefault(); hide(); }
  };
  window.addEventListener('keydown', onKey);

  return {
    button,
    get open() { return open; },
    close: hide,
    dispose() {
      window.removeEventListener('keydown', onKey);
      shade.remove();
      button.remove();
    },
  };
}
