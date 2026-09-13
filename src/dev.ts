import type { Progress } from './main';
import type { Weapon } from './main';
import { LEVELS } from './levels';
import { TOWN_MAX_LEVEL, TOWN } from './town';

/**
 * The sandbox: `?dev` in the URL and everything is unlocked.
 *
 * It exists because the parts of this game that most need looking at are the
 * ones furthest from the start. A lightning spell you cannot see until you have
 * won two boards is a lightning spell nobody checks, and "play three levels
 * first" is a tax on every change to the staff, the tower mounts, the later
 * boards and the village.
 *
 * Two rules, and the second is the one that makes it safe to leave in:
 *
 *   1. It OVERRIDES what is read. Weapons, boards, buildings and a full store.
 *   2. It NEVER WRITES. `patchSave` drops every write while it is on, so a
 *      sandbox session cannot put `cleared: 4` into a real save. You can open
 *      it on the same browser as your real game and close it again with nothing
 *      changed.
 *
 * `?dev` unlocks. `?dev=staff` (or `sword`/`bow`) also puts that weapon in your
 * hand, so testing a spell is one URL rather than a walk to a pedestal.
 *
 * It says so on screen. A build that is quietly in god mode is a build whose
 * measurements are all wrong, and the frame counter is already up there.
 */
const PARAM = new URLSearchParams(location.search).get('dev');

export const DEV = PARAM !== null;

/** Which weapon `?dev=<name>` asked for, if it named one. */
export const DEV_WEAPON: Weapon | null =
  PARAM === 'sword' || PARAM === 'bow' || PARAM === 'staff' ? PARAM : null;

/** Everything a sandbox run should be handed, folded over the real save.
 *
 *  LEVEL and XP are left alone on purpose. They decide how hard you hit and how
 *  hard you are hit, so handing over level 20 would make every balance
 *  impression from a sandbox session wrong — and looking at a spell is not a
 *  reason to stop being able to judge a fight. */
export function devProgress(p: Progress): Progress {
  if (!DEV) return p;
  const town: Record<string, number> = { ...(p.town ?? {}) };
  for (const b of TOWN) town[b.id] = TOWN_MAX_LEVEL;
  return {
    ...p,
    runs: Math.max(p.runs ?? 0, 3),
    cleared: Math.max(p.cleared ?? 0, LEVELS.length),
    store: { gold: 99999, wood: 99999, stone: 99999 },
    town,
    weapon: DEV_WEAPON ?? p.weapon,
  };
}
