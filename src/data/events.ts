// Data-driven EVENT / trigger table — the game's progression rules as DATA, not scattered hard-code.
// Each event: when ALL its `when` conditions hold, run each `do` action in order; `once` (default true)
// fires it a single time, tracked in the save. The GAME OWNS the condition/action VOCABULARY (they are
// evaluated + dispatched in GameScene against live state); this table just COMPOSES them. To add a new
// KIND of condition or action, add a case in GameScene.checkEventCondition / runEventAction — then it's
// available to author here (by hand, by the AI, or a future editor). See CLAUDE.md "Data-driven events".
//
// Condition vocabulary (see GameScene.checkEventCondition):
//   { type:'day-since-start', gte:N }   N real days since this game began
//   { type:'day', gte:N }               absolute local day index >= N
//   { type:'item-count', item:'corn', gte:N }  the player HAS >= N of an item (backpack+hotbar+chest)
//   { type:'bond', gte:N }              Cato bond score >= N
//   { type:'bond-tier', tier:'close' }  bond tier >= the named affinity tier
//   { type:'flag', id:'x', is:true }    an event flag set/unset (set by set-flag/unlock actions)
//   { type:'stat', key:'harvests', gte:N }  a lifetime counter >= N
//   { type:'event-done', id:'other' }   another event has already fired (chaining)
// Action vocabulary (see GameScene.runEventAction):
//   { type:'send-mail', sender, titleKey, bodyKey, subst:{name:'@callName',cato:'@catoName'} }
//   { type:'give-item', item, count }
//   { type:'set-flag' | 'unlock', id, value }
//   { type:'cato-say', key }

export interface EventCondition { type: string; [k: string]: unknown; }
export interface EventAction { type: string; [k: string]: unknown; }
export interface GameEvent {
  id: string;
  when: EventCondition[]; // ALL must hold (AND). Empty = always true.
  do: EventAction[];      // run in order once `when` passes
  once: boolean;          // fire only once (tracked in the save); default true
  priority: number;       // higher fires first when several pass the same tick; default 0
}

// MUTABLE, populated by applyEventData() at boot. Consumers import the live reference.
export let EVENTS: GameEvent[] = [];

interface EventRow { id?: string; when?: EventCondition[]; do?: EventAction[]; once?: boolean; priority?: number; }

/** Replace EVENTS with the loaded data table (`public/data/events.json`, shape `{ events: EventRow[] }`).
 *  Tolerant: skips malformed rows (need an id + a `do` array). Sorted by descending priority. */
export function applyEventData(json: unknown): void {
  const rows = (json as { events?: EventRow[] } | null | undefined)?.events;
  if (!Array.isArray(rows)) return; // keep empty
  const next: GameEvent[] = [];
  for (const r of rows) {
    if (!r || typeof r.id !== 'string' || !Array.isArray(r.do)) continue;
    next.push({
      id: r.id,
      when: Array.isArray(r.when) ? r.when : [],
      do: r.do,
      once: r.once !== false, // default true
      priority: typeof r.priority === 'number' ? r.priority : 0,
    });
  }
  EVENTS = next.sort((a, b) => b.priority - a.priority);
}
