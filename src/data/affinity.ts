// Data-driven AFFINITY / BOND tuning — Cato's relationship with the player (ADR-027).
// Lives in `public/data/affinity.json`; the game LOADS it at boot. The BOND itself is a
// deterministic number the GAME owns (stored in the save, fed to the AI via observation) —
// this table only holds the tuning: how much each signal is worth, how the game integrates
// signals (daily cap / tier diminishing / idle decay), and the tier thresholds. Editable in
// the Data Tables tool (ADR-020). The LLM's per-turn warmth is a Phase-2 micro-adjustment
// (`signals.llmWarmth.scale`), unused until then.

export interface AffinitySignal { gain: number; dailyCountCap?: number; scale?: number }
export interface AffinityTier { name: string; min: number }
export interface AffinityConfig {
  signals: Record<string, AffinitySignal>;
  integration: { dailyCap: number; tierDiminishing: number; decayPerIdleDay: number };
  tiers: AffinityTier[];
}

// The signal keys the game emits (see GameScene.addBond). Kept as string keys so the table
// stays open — a new signal is a new row + a new addBond call-site, no type churn here.
const FALLBACK: AffinityConfig = {
  signals: {
    chatPerDay: { gain: 2, dailyCountCap: 5 },
    followedInstruction: { gain: 3, dailyCountCap: 5 },
    fed: { gain: 2, dailyCountCap: 5 },
    consecutiveDays: { gain: 4 },
    llmWarmth: { scale: 1 },
  },
  integration: { dailyCap: 25, tierDiminishing: 0.35, decayPerIdleDay: 5 },
  tiers: [
    { name: 'stranger', min: 0 },
    { name: 'acquaintance', min: 20 },
    { name: 'friend', min: 60 },
    { name: 'close', min: 120 },
    { name: 'bonded', min: 200 },
  ],
};

// MUTABLE, populated by applyAffinityData() at boot; seeded with the fallback so the game
// works even if the data file never loads. Consumers import the live reference.
export let AFFINITY: AffinityConfig = FALLBACK;

/** The tier NAME for a bond value (highest tier whose `min` ≤ value). */
export function bondTierName(value: number): string {
  let name = AFFINITY.tiers[0]?.name ?? 'stranger';
  for (const t of AFFINITY.tiers) if (value >= t.min) name = t.name;
  return name;
}

/** The tier INDEX (0-based) for a bond value — used for tier-diminishing + gating. */
export function bondTierIndex(value: number): number {
  let idx = 0;
  for (let i = 0; i < AFFINITY.tiers.length; i++) if (value >= AFFINITY.tiers[i].min) idx = i;
  return idx;
}

/** Replace AFFINITY with the loaded table (`public/data/affinity.json`). Tolerant: keeps the
 *  fallback if the payload is unusable; fills missing pieces from the fallback. */
export function applyAffinityData(json: unknown): void {
  const j = json as Partial<AffinityConfig> | null | undefined;
  if (!j || typeof j !== 'object') return;
  const next: AffinityConfig = {
    signals: (j.signals && typeof j.signals === 'object') ? j.signals as Record<string, AffinitySignal> : FALLBACK.signals,
    integration: {
      dailyCap: num(j.integration?.dailyCap, FALLBACK.integration.dailyCap),
      tierDiminishing: num(j.integration?.tierDiminishing, FALLBACK.integration.tierDiminishing),
      decayPerIdleDay: num(j.integration?.decayPerIdleDay, FALLBACK.integration.decayPerIdleDay),
    },
    tiers: Array.isArray(j.tiers) && j.tiers.length
      ? j.tiers.filter((t) => t && typeof t.name === 'string' && typeof t.min === 'number').sort((a, b) => a.min - b.min)
      : FALLBACK.tiers,
  };
  AFFINITY = next;
}

function num(v: unknown, d: number): number { return typeof v === 'number' && isFinite(v) ? v : d; }
