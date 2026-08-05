// Central registry of DEV / debug switches.
//
// All debug flags live HERE (localStorage-backed, runtime-toggleable from the
// in-game Settings → Debug section) instead of scattered `const X = true` across
// the codebase — so cleanup before release is ONE place: flip `DEBUG_PANEL` false
// to hide the UI, and default the individual flags off.
//
// Timing note: some flags are read at LOAD / scene-create (dev-key bindings,
// intro-on-load) → toggling them applies on the NEXT reload; per-frame reads
// (coin floor) apply live. The Settings UI labels this.

const STORE_KEY = 'catopia:debug';

export interface DebugFlagDef {
  key: string;
  /** i18n key for the toggle label (see src/i18n.ts). */
  labelKey: string;
  def: boolean;
  /** true = only takes effect after a reload (create/load-time read). */
  reloadOnly?: boolean;
}

export const DEBUG_FLAGS: DebugFlagDef[] = [
  { key: 'devTools',     labelKey: 'dbg_dev_tools',     def: true, reloadOnly: true },
  { key: 'replayIntro',  labelKey: 'dbg_replay_intro',  def: false, reloadOnly: true },
  { key: 'coinFloor',    labelKey: 'dbg_coin_floor',    def: true },
  { key: 'clearMailbox', labelKey: 'dbg_clear_mailbox', def: true, reloadOnly: true },
];

/** Master switch for whether the Debug section renders in Settings at all.
 *  Flip to `false` before a public release (and default the flags off). */
export const DEBUG_PANEL = true;

type Flags = Record<string, boolean>;
let cache: Flags | null = null;

function load(): Flags {
  if (cache) return cache;
  const out: Flags = {};
  for (const f of DEBUG_FLAGS) out[f.key] = f.def;
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) Object.assign(out, JSON.parse(raw) as Flags);
  } catch { /* localStorage unavailable → defaults */ }
  cache = out;
  return out;
}

export function isDebug(key: string): boolean {
  return load()[key] === true;
}

export function setDebug(key: string, val: boolean): void {
  const f = load();
  f[key] = val;
  try { localStorage.setItem(STORE_KEY, JSON.stringify(f)); } catch { /* ignore */ }
}

/** Toggle a flag; returns the new value. */
export function toggleDebug(key: string): boolean {
  const next = !isDebug(key);
  setDebug(key, next);
  return next;
}
