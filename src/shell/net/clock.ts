// Two clocks, kept without anybody sending a tick.
//
// Nothing here counts down. The snapshot says what each side had left at the
// moment `at` was stamped, and the side to move has been spending since —
// which means the only thing that ever crosses the network is a move. A
// running clock sent sixty times a minute would be sixty messages a minute
// saying what arithmetic already knows.
//
// **The stamp is the mover's own `Date.now()`, and the two machines do not
// agree on what time it is.** Everything below therefore measures ELAPSED
// time — a difference between two readings of the same clock — except the
// one place it cannot, which is a client reading a stamp written by the other
// machine. Two seconds of grace before a flag is claimed is what that costs;
// it is marked where it is spent.
//
// **Two shapes of clock, because two traditions.** An INCREMENT (Fischer)
// adds a few seconds per move to a bank, which is what chess and the
// five-in-a-row games use. BYO-YOMI is what Go is played with: when the main
// time runs out you get a number of periods, and each period RESETS if you
// move inside it — so the game never ends because somebody thought for a
// minute, it ends when they can no longer think for thirty seconds. A single
// increment cannot do that: an increment is a budget, byo-yomi is permission.
import type { SeatNo, Snapshot } from './table';

export interface TimeControl {
  /** The bank, in milliseconds. */
  mainMs: number;
  /** Fischer: added after every move. */
  incrementMs?: number;
  /** Go: what happens when the bank is empty. Each period is spent only if
   *  the move takes longer than it; moving inside it resets it. */
  byoyomi?: { periodMs: number; periods: number };
}

/** A control with a name, for the table-maker to choose from. */
export interface Preset { id: string; label: string; tc: TimeControl }

/** What a game falls back to if it declares nothing: ten minutes and five
 *  seconds a move. Sane for a small board, wrong for Go — which is the whole
 *  reason a game gets to choose. */
export const DEFAULT_TC: TimeControl = { mainMs: 10 * 60_000, incrementMs: 5_000 };

export function controlOf(s: Snapshot | null): TimeControl {
  return s?.tc ?? DEFAULT_TC;
}

/** Both clocks full, both sets of periods whole, and the turn starting now. */
export function freshClock(now: number, tc: TimeControl): Pick<Snapshot, 'clock' | 'at' | 'tc' | 'periods'> {
  const p = tc.byoyomi?.periods ?? 0;
  return { clock: [tc.mainMs, tc.mainMs], at: now, tc, periods: [p, p] };
}

/** What is left, and in which of the two states — `main` is the bank, `period`
 *  is one byo-yomi period with however many remain after it. */
export interface Left {
  ms: number;
  kind: 'main' | 'period';
  periods: number;
  /** Nothing left at all. */
  out: boolean;
}

/**
 * What a seat has left, right now.
 *
 * Only the side to move is spending, so everyone else's number is simply what
 * was banked. A finished game spends nothing at all.
 */
export function left(s: Snapshot, seat: SeatNo, toMove: SeatNo, now: number): Left {
  const tc = controlOf(s);
  const banked = s.clock[seat] ?? tc.mainMs;
  const periods = s.periods?.[seat] ?? tc.byoyomi?.periods ?? 0;
  const spending = !s.end && seat === toMove;
  const elapsed = spending ? Math.max(0, now - s.at) : 0;

  if (elapsed < banked) return { ms: banked - elapsed, kind: 'main', periods, out: false };

  const by = tc.byoyomi;
  if (!by || periods <= 0) {
    // No byo-yomi, or none left: the bank is the whole story.
    return { ms: 0, kind: 'main', periods: 0, out: true };
  }
  // Into the periods. Each whole one that has passed is spent; what shows is
  // the remainder of the one being used.
  const over = elapsed - banked;
  const used = Math.floor(over / by.periodMs);
  if (used >= periods) return { ms: 0, kind: 'period', periods: 0, out: true };
  return {
    ms: by.periodMs - (over % by.periodMs),
    kind: 'period',
    periods: periods - used,
    out: false,
  };
}

/**
 * The clocks after the side to move has played.
 *
 * Their spend comes off, the increment goes on, and any byo-yomi periods they
 * ran through are gone. The period they were IN is not spent — moving inside
 * a period is exactly what resets it, which is the whole point of the format.
 */
export function afterMove(
  s: Snapshot,
  mover: SeatNo,
  now: number,
): Pick<Snapshot, 'clock' | 'at' | 'periods'> {
  const tc = controlOf(s);
  const clock: [number, number] = [...s.clock] as [number, number];
  const periods: [number, number] = [...(s.periods ?? [0, 0])] as [number, number];
  const was = left(s, mover, mover, now);

  if (was.kind === 'main') {
    clock[mover] = was.ms + (tc.incrementMs ?? 0);
  } else {
    // The bank is gone for good once the periods have started.
    clock[mover] = 0;
    periods[mover] = was.periods;
  }
  return { clock, at: now, periods };
}

/**
 * Two seconds, and what they are for.
 *
 * A flag is claimed by the player who is NOT on the clock — the one with time
 * to notice. But they are reading a stamp written by the other machine, whose
 * idea of "now" may differ, and a claim that fires a second early takes a game
 * off somebody who was still moving. The grace is bigger than any clock skew
 * worth caring about and small enough that nobody waits for it.
 */
const GRACE_MS = 2_000;

/** Has the side to move actually run out, from the other side's chair? */
export function flagged(s: Snapshot, toMove: SeatNo, now: number): boolean {
  if (s.end) return false;
  return left(s, toMove, toMove, now).out && left(s, toMove, toMove, now - GRACE_MS).out;
}

/** `9:58`, and `0:09` at the end. Minutes never drop below one digit, because
 *  a clock that changes width is a clock that jitters. */
export function fmt(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

/** The clock as a seat shows it: `2:41`, or `0:28 ×3` once the periods have
 *  started, because in byo-yomi how many are left matters as much as the
 *  seconds on the one being used. */
export function show(l: Left): string {
  return l.kind === 'period' ? `${fmt(l.ms)} ×${l.periods}` : fmt(l.ms);
}

/** Under this, the clock says so — colour and a tick. A byo-yomi period is
 *  ALWAYS the urgent state; that is what it is for. */
export const LOW_MS = 30_000;
export function low(l: Left): boolean {
  return l.kind === 'period' || l.ms <= LOW_MS;
}
