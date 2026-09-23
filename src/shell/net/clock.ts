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
import type { SeatNo, Snapshot } from './table';

/**
 * The time control.
 *
 * Ten minutes each with five seconds a move: long enough that nobody loses a
 * friendly game to the clock, short enough that an abandoned one ends by
 * itself. The increment is what stops a long think from being unrecoverable.
 */
export const CLOCK = { initialMs: 10 * 60_000, incrementMs: 5_000 } as const;

/** Both clocks, full, and the turn starting now. */
export function freshClock(now: number): Pick<Snapshot, 'clock' | 'at'> {
  return { clock: [CLOCK.initialMs, CLOCK.initialMs], at: now };
}

/**
 * What a seat has left, right now.
 *
 * Only the side to move is spending, so everyone else's number is simply what
 * was banked. A finished game spends nothing at all.
 */
export function left(s: Snapshot, seat: SeatNo, toMove: SeatNo, now: number): number {
  const banked = s.clock[seat] ?? CLOCK.initialMs;
  if (s.end || seat !== toMove) return Math.max(0, banked);
  return Math.max(0, banked - Math.max(0, now - s.at));
}

/** The clocks after the side to move has played: their spend taken off, the
 *  increment added, and the stamp handed to the other side. */
export function afterMove(s: Snapshot, mover: SeatNo, now: number): Pick<Snapshot, 'clock' | 'at'> {
  const clock: [number, number] = [...s.clock] as [number, number];
  clock[mover] = Math.max(0, left(s, mover, mover, now)) + CLOCK.incrementMs;
  return { clock, at: now };
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
  return left(s, toMove, toMove, now) <= 0 && now - s.at > s.clock[toMove] + GRACE_MS;
}

/** `9:58`, and `0:09` at the end. Minutes never drop below one digit, because
 *  a clock that changes width is a clock that jitters. */
export function fmt(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

/** Under this, the clock says so — colour and a tick. */
export const LOW_MS = 30_000;
