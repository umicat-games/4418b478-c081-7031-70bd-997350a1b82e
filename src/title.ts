import type { Shared } from './main';
import type { Progress } from './main';
import { LEVELS } from './levels';

/**
 * The title screen: Continue, or start again.
 *
 * ONE save, written as you play. That is the shape for a game that autosaves —
 * slots exist so that a player who saves by hand can keep more than one run,
 * and a game that never asks them to save has nothing to put in a second slot.
 *
 * So the whole screen is two questions: is there something to come back to, and
 * do you want to keep it.
 *
 * Plain DOM, like the loading screen, and for the same reason: it has to be up
 * before there is a scene, and it must not care whether one exists. It is also
 * where the first TAP of the session happens, which is what unlocks audio on
 * iOS — a title screen is the one moment in a game where a press is guaranteed.
 */

/** What the save has to contain before Continue means anything.
 *
 *  Not "does the key exist": every session writes something, and a save holding
 *  nothing but defaults would light up Continue and drop the player into a
 *  village they have never seen, having been told they were resuming. */
function hasProgress(p: Progress | null): boolean {
  if (!p) return false;
  return (p.runs ?? 0) > 0
    || (p.cleared ?? 0) > 0
    || Object.keys(p.town ?? {}).length > 0
    || (p.level ?? 1) > 1
    || (p.store?.gold ?? 0) > 0;
}

/** What you would be going back to, in one line. "Continue" on its own is a
 *  button you press to find out what it does. */
function summary(p: Progress): string {
  const bits = [`Lv ${p.level ?? 1}`];
  const cleared = p.cleared ?? 0;
  if (cleared > 0) {
    bits.push(cleared >= LEVELS.length
      ? 'every board cleared'
      : `${LEVELS[cleared - 1].name} cleared`);
  }
  const built = Object.keys(p.town ?? {}).length;
  if (built > 0) bits.push(`${built} building${built > 1 ? 's' : ''}`);
  return bits.join(' · ');
}

/**
 * Put the title up and wait for a choice.
 *
 * Resolves once the player has picked. If they chose to start again the save
 * has already been wiped by then, so the caller does not have to know which
 * happened — it just reads progress as it always does.
 */
export async function showTitle(shared: Shared): Promise<void> {
  const saves = shared.umicat.saves;
  const save = (await saves.get<Progress>('td-progress')) ?? null;
  const resume = hasProgress(save);

  const el = document.createElement('div');
  el.dataset.title = '';
  el.style.cssText = `
    position: fixed; inset: 0; z-index: 110; display: flex;
    align-items: center; justify-content: center; flex-direction: column;
    gap: 18px; padding: 24px; box-sizing: border-box;
    background: linear-gradient(#8fc9e8 0%, #a8d9ee 46%, #6fae63 46%, #4f9245 100%);
    color: #23313c; font: 600 15px/1.5 system-ui, sans-serif; text-align: center;
  `;

  // What a button DOES is passed in, not derived from how it looks. Deriving it
  // from `primary` tagged "Start" on a fresh save as a Continue, because it is
  // the primary button when there is nothing to continue.
  const btn = (act: string, label: string, primary: boolean, note?: string): string => `
    <button data-act="${act}" style="
      display:block; width:min(280px, 74vw); margin:0 auto; padding:14px 22px;
      border:0; border-radius:999px; cursor:pointer; font:800 16px/1.2 system-ui;
      background:${primary ? '#ffd76a' : 'rgba(35,49,60,.14)'};
      color:${primary ? '#241b00' : '#23313c'};">
      ${label}${note ? `<div style="font:600 12px/1.6 system-ui;opacity:.72">${note}</div>` : ''}
    </button>`;

  el.innerHTML = `
    <div style="font:800 min(13vw, 54px)/1 system-ui; letter-spacing:.2em;
                color:#ffd76a; text-shadow:0 3px 0 #b8892b, 0 6px 14px rgba(0,0,0,.28)">BALABOO</div>
    <div style="opacity:.8; letter-spacing:.06em; margin-top:-4px">Defend the village</div>
    <div style="display:flex; flex-direction:column; gap:10px; margin-top:10px">
      ${resume ? btn('go', 'Continue', true, summary(save!)) : ''}
      ${btn('new', resume ? 'New game' : 'Start', !resume)}
    </div>
    <div data-confirm style="
      position:fixed; inset:0; display:none; align-items:center; justify-content:center;
      background:rgba(12,18,24,.62); padding:24px; box-sizing:border-box">
      <div style="background:#fff; color:#23313c; border-radius:18px; padding:22px 24px;
                  width:min(360px, 86vw); box-shadow:0 12px 40px rgba(0,0,0,.3)">
        <div style="font:800 17px/1.4 system-ui">Start again?</div>
        <div style="margin-top:8px; opacity:.8">
          This erases the village you have now. There is only one save.</div>
        <div style="display:flex; gap:10px; margin-top:18px">
          <button data-act="cancel" style="flex:1; padding:12px; border:0; border-radius:999px;
            cursor:pointer; font:800 15px system-ui; background:rgba(35,49,60,.12); color:#23313c">
            Keep it</button>
          <button data-act="wipe" style="flex:1; padding:12px; border:0; border-radius:999px;
            cursor:pointer; font:800 15px system-ui; background:#d0453a; color:#fff">
            Erase</button>
        </div>
      </div>
    </div>
  `;
  document.body.appendChild(el);

  await new Promise<void>((resolve) => {
    const confirm = el.querySelector<HTMLElement>('[data-confirm]')!;
    const done = async (wipe: boolean): Promise<void> => {
      // Straight through `saves`, not `patchSave`: patching merges over what is
      // there, and the one thing this must do is leave nothing behind.
      if (wipe) await saves.set('td-progress', {});
      el.remove();
      resolve();
    };
    el.onclick = (e) => {
      const act = (e.target as HTMLElement).closest<HTMLElement>('[data-act]')?.dataset.act;
      if (!act) return;
      // Starting again is the one irreversible thing on this screen, and there
      // is only one save for it to destroy. It asks — but only when there is
      // something to lose, because a confirmation over an empty save is a
      // question about nothing.
      // Toggled through `style.display`, not the `hidden` attribute: `hidden`
      // is a user-agent `display: none` rule, and the inline `display: flex`
      // this element carries outranks it. It sat open over the whole title.
      if (act === 'new' && resume) { confirm.style.display = 'flex'; return; }
      if (act === 'cancel') { confirm.style.display = 'none'; return; }
      void done(act === 'new' || act === 'wipe');
    };
  });
}
