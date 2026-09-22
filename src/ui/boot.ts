// The boot screen's remote control.
//
// The screen itself lives in `index.html` — markup, styles and all — because
// it has to be painted before this bundle has been parsed, which is most of
// what it is covering for. All this file does is let the game say how far
// along it is without knowing any of that.
//
// Steps are named rather than numeric so the list reads as what the player is
// waiting for. They are honest: each one is reported when the thing has
// actually happened, and the bar creeps between them rather than inventing
// progress. Nothing here fails if the boot screen is absent (a test harness,
// a future host that boots differently) — it is decoration over a real wait.
interface BootRemote { step(progress: number): void; done(): void }

const boot = (): BootRemote | undefined =>
  (window as unknown as { __boot?: BootRemote }).__boot;

/** Roughly how much of the wait each milestone represents. Measured on a cold
 *  load: the bundle and three.js dominate, the handshake is a round trip, and
 *  the saves are usually instant. */
const STEPS = {
  bundle: 0.30,
  platform: 0.55,
  saved: 0.72,
} as const;

export const bootStep = (step: keyof typeof STEPS): void => boot()?.step(STEPS[step]);

/** The game is on screen. Idempotent, and a no-op once the screen has gone —
 *  the title is shown again every time the player leaves a game. */
export const bootDone = (): void => boot()?.done();
