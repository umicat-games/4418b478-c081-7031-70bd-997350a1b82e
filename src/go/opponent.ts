// The opponent, and the one place that decides how strong it is.
//
// The engine is KataGo's own network and search, vendored (see vendor/) and run
// in a Web Worker. It is far stronger than anyone this game is for, so the
// interesting problem is the other direction: making it weak in a way that
// still looks like a person playing badly rather than a machine malfunctioning.
//
// Two knobs do that, and neither of them makes the engine play an illegal or
// absurd move:
//
//   visits      — how far it reads. A level that reads three moves ahead misses
//                 the fourth, which is exactly how a human of that strength
//                 loses a capture race.
//   temperature — how often it takes something other than its best move, chosen
//                 from its own candidate list by search weight. At 0 it always
//                 plays the top move; higher spreads it over plausible moves.
//
// What we deliberately DON'T do is inject random moves. A random move on a Go
// board is not "a weaker player", it is a move no human would ever consider,
// and a beginner shown one learns something false.
import { getKataGoEngineClient } from '../engine/katago/client';
import type { GoGame } from './rules';

/**
 * Where the network lives: beside the game, not inside it.
 *
 * ABSOLUTE, deliberately. The fetch happens in the Web Worker, and a relative
 * URL there resolves against the worker's own script — which lives under
 * `assets/` — so `models/x.gz` would be looked for in `assets/models/x.gz` and
 * 404 in a way that looks like a broken engine rather than a broken path.
 *
 * The file is NOT committed: 3.7MB of weights in a git history that every
 * workspace rebuild re-clones, for a file that never changes, is a cost paid
 * for ever. It is uploaded to the game's own CDN prefix instead, and
 * `npm run dev` reads a local copy out of `public/models/` (gitignored — see
 * vendor/VENDOR.md for how to fetch it).
 */
export const MODEL_URL = new URL('models/katago-small.bin.gz', document.baseURI).href;

export interface Level {
  id: string;
  /** Shown to the player. Not a rank claim — see `about`. */
  label: string;
  /** One line on what playing this feels like. */
  about: string;
  visits: number;
  temperature: number;
  /** Stones the player takes before the game starts. */
  handicap?: number;
}

/**
 * The ladder. Calibrated by play-testing rather than by rank arithmetic, and
 * the labels say what it FEELS like rather than claiming a kyu grade — a number
 * we have not measured would be a lie in a game whose whole point is teaching.
 */
export const LEVELS: Level[] = [
  { id: 'gentle', label: 'Gentle', about: 'Plays sound shapes, misses what you are threatening.', visits: 2, temperature: 1.1 },
  { id: 'steady', label: 'Steady', about: 'Sees one exchange ahead. Will take what you leave hanging.', visits: 12, temperature: 0.7 },
  { id: 'sharp', label: 'Sharp', about: 'Reads capture races. Punishes loose shape.', visits: 64, temperature: 0.35 },
  { id: 'strong', label: 'Strong', about: 'Full strength for this board. Expect to lose.', visits: 400, temperature: 0 },
];

export const levelById = (id: string): Level => LEVELS.find((l) => l.id === id) ?? LEVELS[1];

/** What the opponent decided to do. `pass` and `resign` are real answers, not
 *  failure cases — an engine that is behind by enough should say so. */
export type EngineDecision =
  | { kind: 'play'; x: number; y: number }
  | { kind: 'pass' }
  | { kind: 'resign' };

/** The read the coach talks from. Everything here is the engine's, not the
 *  language model's — so "you lost four points there" is a measurement. */
export interface Read {
  /** Black's chance of winning, 0..1. */
  winRate: number;
  /** Black's lead in points. */
  scoreLead: number;
  /** +1 black owns, −1 white owns, per intersection, row-major. */
  ownership: number[];
  /** Best moves the engine saw, best first. */
  candidates: Array<{ x: number; y: number; winRate: number; scoreLead: number; pointsLost: number; visits: number }>;
}

export class Opponent {
  private client = getKataGoEngineClient();
  private started: Promise<void> | null = null;

  /** Load the network. Safe to call repeatedly; the work happens once.
   *  Call it early — at the title screen — so the download is over before
   *  anyone is waiting on a move. */
  ready(): Promise<void> {
    // 'wasm' is not a preference, it is the only real option here: threaded
    // wasm needs SharedArrayBuffer, which needs cross-origin isolation, which a
    // game iframe served from the CDN does not have. Single-threaded wasm turns
    // out to be fast enough (9x9 at 400 visits is under a second on a laptop).
    this.started ??= this.client.init(MODEL_URL, 'wasm');
    return this.started;
  }

  /** Ask the engine what it sees. Used for the opponent's move AND for the
   *  coach's commentary, so one search answers both and is billed once in
   *  battery rather than twice. */
  async read(game: GoGame, visits: number): Promise<Read> {
    await this.ready();
    const pos = game.enginePosition();
    const a = await this.client.analyze({
      modelUrl: MODEL_URL,
      backend: 'wasm',
      ...pos,
      visits: Math.max(1, visits),
      topK: 8,
      ownershipMode: 'root',
      // A thinking opponent that never returns is worse than a weak one.
      maxTimeMs: 20_000,
    });
    return {
      winRate: a.rootWinRate,
      scoreLead: a.rootScoreLead,
      ownership: Array.from(a.ownership ?? []),
      candidates: (a.moves ?? []).map((m) => ({
        x: m.x, y: m.y, winRate: m.winRate, scoreLead: m.scoreLead,
        pointsLost: m.pointsLost, visits: m.visits,
      })),
    };
  }

  /** Decide a move at the given level. */
  async decide(game: GoGame, level: Level): Promise<{ decision: EngineDecision; read: Read }> {
    const read = await this.read(game, level.visits);
    return { decision: this.choose(game, read, level), read };
  }

  /**
   * Turn a candidate list into one move.
   *
   * Sampling is over the engine's own search weight, warped by temperature —
   * so even a "wrong" choice is a move the engine considered, and the mistakes
   * a weak level makes are the mistakes of someone who did not read far enough,
   * not of someone playing at random.
   */
  private choose(game: GoGame, read: Read, level: Level): EngineDecision {
    // The candidate list comes back best-first. A pass arrives as x < 0.
    const playable = read.candidates.filter((c) => c.x >= 0 && game.legal(c.x, c.y));
    if (!playable.length) return { kind: 'pass' };

    if (level.temperature <= 0) return { kind: 'play', x: playable[0].x, y: playable[0].y };

    // Visit counts span orders of magnitude, so warp in log space: temperature
    // then reads as "how much worse a move may be before it stops happening",
    // and 1.0 lands somewhere a beginner recognises rather than on a move that
    // was searched once by accident.
    const weights = playable.map((c) => Math.exp(Math.log(Math.max(c.visits, 1)) / Math.max(level.temperature, 0.01)));
    const total = weights.reduce((a, b) => a + b, 0);
    let roll = Math.random() * total;
    for (let i = 0; i < playable.length; i++) {
      roll -= weights[i];
      if (roll <= 0) return { kind: 'play', x: playable[i].x, y: playable[i].y };
    }
    return { kind: 'play', x: playable[0].x, y: playable[0].y };
  }

  dispose(): void {
    this.client.dispose();
  }
}
