import type { Progress } from './main';
import { WEAPON_BY_ID, WEAPONS, WEAPON_MAX_LEVEL, type Weapon } from './weapons';
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
 * `?dev=shop` is the OTHER half of the problem. Unlocking everything hands you
 * a finished village, which is exactly what you cannot look at the shop with:
 * there is nothing left to buy, no building to carry and put down, and no land
 * to expand into. So that mode gives you the materials and the weapons and
 * takes the village AWAY — empty, smallest size, everything still for sale.
 *
 * The rule the two share is that the grind goes and the thing under test stays.
 * A sandbox that skips the feature you opened it to look at is worse than no
 * sandbox, because it looks like it worked.
 *
 * On a phone there is no URL to edit, so THREE TAPS ON THE FRAME COUNTER does
 * the same thing and reloads. That is the only way in inside the iOS app,
 * which builds the game's URL itself and passes nothing through.
 *
 * It says so on screen. A build that is quietly in god mode is a build whose
 * measurements are all wrong, and the frame counter is already up there.
 */
const PARAM = new URLSearchParams(location.search).get('dev');

/** The same switch, without a keyboard.
 *
 *  On a phone `?dev=staff` means typing a CDN URL into Safari, and inside the
 *  iOS app it means nothing at all — the app builds the game's URL itself
 *  (`Game.previewURL`, `?v=<stamp>` and nothing else), so a query parameter
 *  cannot reach the game without shipping a new build. Three taps on the frame
 *  counter does reach it, everywhere: Safari, the app's WebView, and the
 *  editor's preview pane.
 *
 *  Three taps CYCLES: off, everything unlocked, rich-with-nothing-bought, off.
 *  Two modes and one gesture, because the only way in on a phone is that
 *  gesture and a mode you cannot reach from it does not exist there.
 *
 *  SESSION storage, not local: a cheat that outlives the tab it was turned on
 *  in is a cheat you forget is on. */
const KEY = 'balaboo-dev';
const stored = ((): string | null => {
  try { return sessionStorage.getItem(KEY); } catch { return null; }
})();

export const DEV = PARAM !== null || stored !== null;

/** Which sandbox. `shop` is rich with nothing bought; anything else unlocks. */
export const DEV_MODE: 'all' | 'shop' = (PARAM ?? stored) === 'shop' ? 'shop' : 'all';

/** What the banner says. A build quietly in god mode is a build whose every
 *  impression is wrong, and the two modes hand you opposite villages — so the
 *  banner has to say WHICH, not just that something is on. */
export const DEV_BANNER = DEV_MODE === 'shop'
  ? '\u2605 DEV \u2014 rich, nothing bought, nothing saved'
  : '\u2605 DEV \u2014 all unlocked, nothing saved';

/** Step to the next sandbox and reload, because the hub reads progress once at
 *  boot and every unlock in the game comes out of that one read. */
export function toggleDev(): void {
  // off -> everything -> rich-and-empty -> off.
  const next = !DEV ? 'bolt' : DEV_MODE === 'all' ? 'shop' : null;
  try {
    if (next === null) sessionStorage.removeItem(KEY);
    else sessionStorage.setItem(KEY, next);
  } catch { /* private mode: the URL parameter still works */ }
  location.reload();
}

/** Which weapon `?dev=<name>` asked for, if it named one. */
export const DEV_WEAPON: Weapon | null = ((): Weapon | null => {
  const w = PARAM ?? stored;
  // `staff` was the one magic weapon before it split into three; a bookmarked
  // sandbox link should still open something rather than nothing.
  const asked = w === 'staff' ? 'bolt' : w;
  return asked && WEAPON_BY_ID.has(asked as Weapon) ? asked as Weapon : null;
})();

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
  // The shop sandbox takes the village away rather than handing it over: an
  // EMPTY one, at its starting size, with the store full. Written explicitly
  // and not merely left alone, because it has to override a real save — the
  // point is to look at buying things on an account that already bought them.
  const empty = DEV_MODE === 'shop';
  return {
    ...p,
    runs: Math.max(p.runs ?? 0, 3),
    cleared: Math.max(p.cleared ?? 0, LEVELS.length),
    store: { gold: 99999, wood: 99999, stone: 99999 },
    town: empty ? {} : town,
    ...(empty ? { spots: {}, land: 0 } : {}),
    // The whole rack, made and improved. "Unlocks everything" has to include
    // the weapons now that they are bought rather than handed over — a sandbox
    // that makes you forge before you can look at a spell is a sandbox with a
    // shopping trip in front of it.
    weapons: Object.fromEntries(WEAPONS.map((w) => [w.id, WEAPON_MAX_LEVEL])),
    weapon: DEV_WEAPON ?? p.weapon,
  };
}
