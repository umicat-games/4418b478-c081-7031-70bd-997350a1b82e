// The opponent, and the one place that decides how strong it is.
//
// The engine is Stockfish 10, vendored (see `vendor/VENDOR.md`) and run in a
// Web Worker in this browser. It is around 3200 Elo, which is to say it is
// stronger than every person who will ever open this game, so the interesting
// problem is the other direction: making it weak in a way that still looks
// like a person playing badly rather than a machine malfunctioning.
//
// Two knobs, and neither of them makes the engine play an absurd move:
//
//   movetime  — how long it reads. A level that sees three plies misses the
//               fourth, which is exactly how a human of that strength walks
//               into a fork.
//   slack     — how many centipawns worse than its best move it is willing to
//               play, sampled over its OWN candidate list by how much each
//               one loses. At 0 it always plays the best move it found.
//
// What we deliberately DON'T do is pick a random legal move. A random move on
// a chess board is not "a weaker player", it is a move no human would consider
// — hanging a queen for nothing on move 4 — and a beginner shown one learns
// something false about what they are playing against.
//
// Stockfish has its own `Skill Level` option that does roughly this, and it is
// deliberately not used: it is opaque, it is capped at "still beats you", and
// the whole point of owning the choice here is being able to say what each
// level does in a sentence a player can check.
import { Chess } from 'chess.js';
import { t, type Key } from '../i18n';
import type { ChessGame, Side } from './rules';

/** Where the engine lives. Both files sit in `public/stockfish/`, so the
 *  worker's own script URL resolves the wasm beside it — which is why this is
 *  a plain path and not the absolute-URL dance the Go game needs. */
const ENGINE_URL = new URL('stockfish/stockfish.js', document.baseURI).href;

export interface Level {
  id: string;
  /** Milliseconds of search per move. */
  movetime: number;
  /** How many moves it looks at, which is also how many it may choose from. */
  multipv: number;
  /** Centipawns of slack. See the note at the top. */
  slack: number;
}

/**
 * The ladder. Calibrated by play-testing, not by Elo arithmetic.
 *
 * What each level is CALLED, and the sentence describing how it plays, live in
 * `i18n.ts` — partly so they translate, and partly because they are a promise
 * about feel ("will let you take a piece") rather than a rating, which we have
 * not measured and will not claim.
 */
export const LEVELS: Level[] = [
  { id: 'gentle', movetime: 60, multipv: 5, slack: 260 },
  { id: 'steady', movetime: 180, multipv: 4, slack: 110 },
  { id: 'sharp', movetime: 500, multipv: 3, slack: 35 },
  { id: 'strong', movetime: 1400, multipv: 1, slack: 0 },
];

export const levelById = (id: string): Level => LEVELS.find((l) => l.id === id) ?? LEVELS[1];
export const levelLabel = (id: string): string => t(`level.${id}` as Key);
export const levelAbout = (id: string): string => t(`level.${id}.about` as Key);

export interface Candidate {
  uci: string;
  /** The move as a person writes it — `Nf3`, not `g1f3`. */
  san: string;
  /** Centipawns, from the point of view of the side to move. */
  cp: number;
  /** Mate in N for the side to move; negative means it gets mated. */
  mate: number | null;
  /** The line the engine expects, in SAN, best first. Short on purpose. */
  line: string[];
}

/** The read the companion talks from. Everything here is measured by the
 *  engine, which is what makes "that dropped a pawn" a fact. */
export interface Read {
  /** Centipawns from the PLAYER's point of view: positive means they are
   *  better. Normalised here, once, because every consumer wants it that way
   *  and a sign error in this number is a coach telling you that you are
   *  winning while you are being mated. */
  cp: number;
  /** Mate in N for the player; negative means the player is being mated. */
  mate: number | null;
  /** The player's chance of winning, 0..1. */
  winRate: number;
  depth: number;
  /** Best moves for whoever is to move, best first. */
  candidates: Candidate[];
}

/**
 * Centipawns to a win probability.
 *
 * Lichess's fit over millions of games: `50 + 50 * (2 / (1 + exp(-0.00368208 *
 * cp)) - 1)`. Worth having rather than showing centipawns directly — "+1.2" is
 * a number only a chess player reads, and the eval bar needs a fraction.
 */
export const winChance = (cp: number): number => 1 / (1 + Math.exp(-0.00368208 * cp));

/** Mate scores, put on the centipawn scale so one comparison orders both.
 *  Deliberately far above any material advantage: mate in 8 beats a queen. */
const MATE_CP = 32000;
const asCp = (c: { cp: number; mate: number | null }): number =>
  c.mate === null ? c.cp : (c.mate > 0 ? MATE_CP - c.mate * 100 : -MATE_CP - c.mate * 100);

export class Opponent {
  private worker: Worker | null = null;
  private started: Promise<void> | null = null;
  /** Lines arriving from the engine go to whoever is waiting for them. One
   *  search at a time: UCI has no request ids, so two overlapping searches
   *  would be indistinguishable in the output. */
  private waiting: ((line: string) => void) | null = null;
  private queue: Promise<unknown> = Promise.resolve();

  /** Start the engine. Safe to call repeatedly; the work happens once. Call it
   *  early — at the title screen — so the wasm is compiled before anyone is
   *  waiting on a move. */
  ready(): Promise<void> {
    this.started ??= this.boot();
    return this.started;
  }

  private async boot(): Promise<void> {
    const w = new Worker(ENGINE_URL);
    this.worker = w;
    w.onmessage = (e: MessageEvent) => {
      const line = typeof e.data === 'string' ? e.data : String(e.data);
      this.waiting?.(line);
    };
    await this.until('uciok', () => w.postMessage('uci'));
    // 16MB is this build's only choice (`Hash` is `min 16 max 16`), and
    // `Threads` likewise — see vendor/VENDOR.md. Nothing to tune.
    await this.until('readyok', () => w.postMessage('isready'));
  }

  /** Send something and wait for the line that answers it. */
  private until(token: string, send: () => void): Promise<string[]> {
    return new Promise<string[]>((resolve, reject) => {
      const lines: string[] = [];
      const timer = setTimeout(() => {
        this.waiting = null;
        reject(new Error(`engine did not answer '${token}' in time`));
      }, 30_000);
      this.waiting = (line) => {
        lines.push(line);
        if (!line.startsWith(token)) return;
        clearTimeout(timer);
        this.waiting = null;
        resolve(lines);
      };
      send();
    });
  }

  /** Searches, one after another. Two `go` commands in flight at once is not
   *  slower, it is wrong: the second one's `bestmove` would be read as the
   *  first one's. */
  private serialise<T>(work: () => Promise<T>): Promise<T> {
    const next = this.queue.then(work, work);
    this.queue = next.catch(() => undefined);
    return next;
  }

  /**
   * Ask the engine what it sees.
   *
   * Used both for the opponent's move and for the companion's commentary, so
   * one search answers both — the coach never costs a second search, and what
   * it says about a move is what the move was actually chosen by.
   */
  read(game: ChessGame, opts: { movetime: number; multipv: number }): Promise<Read> {
    return this.serialise(async () => {
      await this.ready();
      const w = this.worker!;
      const { fen, moves } = game.enginePosition();
      const mover = game.toPlay;

      w.postMessage(`setoption name MultiPV value ${Math.max(1, opts.multipv)}`);
      w.postMessage(`position fen ${fen}${moves.length ? ` moves ${moves.join(' ')}` : ''}`);
      const lines = await this.until('bestmove', () => w.postMessage(`go movetime ${Math.max(20, opts.movetime)}`));
      return parse(lines, fen, moves, mover, game.human);
    });
  }

  /** Decide a move at the given level. */
  async decide(game: ChessGame, level: Level): Promise<{ uci: string | null; read: Read }> {
    const read = await this.read(game, { movetime: level.movetime, multipv: level.multipv });
    return { uci: this.choose(read, level), read };
  }

  /**
   * Turn a candidate list into one move.
   *
   * Sampled over the engine's own list, weighted by how much each move loses
   * against its best — so a weak level's mistakes are moves Stockfish looked
   * at and rated, which is what makes them look like a person's mistakes
   * rather than noise.
   */
  private choose(read: Read, level: Level): string | null {
    const cands = read.candidates;
    if (!cands.length) return null;
    if (level.slack <= 0) return cands[0].uci;

    const best = asCp(cands[0]);
    // Anything more than three times the slack worse is not a weaker move, it
    // is a different game. Dropped rather than given a tiny weight, so it can
    // never come up at all.
    const pool = cands.filter((c) => best - asCp(c) <= level.slack * 3);
    const weights = pool.map((c) => Math.exp(-(best - asCp(c)) / level.slack));
    const total = weights.reduce((a, b) => a + b, 0);
    let roll = Math.random() * total;
    for (let i = 0; i < pool.length; i++) {
      roll -= weights[i];
      if (roll <= 0) return pool[i].uci;
    }
    return cands[0].uci;
  }

  dispose(): void {
    this.worker?.terminate();
    this.worker = null;
    this.started = null;
  }
}

/**
 * Read a search's output.
 *
 * Only the LAST `info` line for each `multipv` counts: the engine reports as it
 * deepens, so the same move arrives five times with five different scores, and
 * the shallow ones are exactly the numbers we do not want the coach quoting.
 */
function parse(lines: string[], fen: string, played: string[], mover: Side, human: Side): Read {
  const byPv = new Map<number, Candidate & { depth: number }>();
  let depth = 0;

  for (const line of lines) {
    if (!line.startsWith('info ') || !line.includes(' pv ')) continue;
    const d = /\bdepth (\d+)/.exec(line);
    const pv = /\bmultipv (\d+)/.exec(line);
    const cp = /\bscore cp (-?\d+)/.exec(line);
    const mate = /\bscore mate (-?\d+)/.exec(line);
    const moves = /\bpv (.+)$/.exec(line);
    if (!d || !moves) continue;
    // `upperbound`/`lowerbound` scores are the engine telling us it did not
    // finish checking this move. Quoting one as an evaluation is how a coach
    // ends up announcing a blunder that never happened.
    if (/\b(upper|lower)bound\b/.test(line)) continue;
    depth = Math.max(depth, Number(d[1]));
    const index = pv ? Number(pv[1]) : 1;
    const uciLine = moves[1].trim().split(/\s+/);
    byPv.set(index, {
      depth: Number(d[1]),
      uci: uciLine[0],
      san: '',
      line: uciLine.slice(0, 6),
      cp: cp ? Number(cp[1]) : 0,
      mate: mate ? Number(mate[1]) : null,
    });
  }

  // `bestmove` is the engine's actual answer and does not always equal
  // multipv 1 — with a slack-sampled level we override it anyway, but when the
  // list is empty (mate on the board, or a search too short to report) it is
  // the only thing there is.
  const bestLine = lines.find((l) => l.startsWith('bestmove'));
  const bestMove = bestLine?.split(/\s+/)[1];

  const candidates = [...byPv.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([, c]) => c);
  if (!candidates.length && bestMove && bestMove !== '(none)') {
    candidates.push({ uci: bestMove, san: '', line: [bestMove], cp: 0, mate: null, depth: 0 });
  }

  // UCI is all `g1f3`; people read `Nf3`. Converted here, once, on a scratch
  // board replayed from the game's own start — the coach must never be handed
  // a move in a notation it then has to translate, because it will get castling
  // and promotions wrong and sound certain about it.
  const scratch = new Chess(fen);
  for (const m of played) { try { scratch.move(m); } catch { break; } }
  for (const c of candidates) {
    c.san = sanOf(scratch, c.uci) ?? c.uci;
    c.line = c.line.map((u, i) => (i === 0 ? c.san : u));
  }

  const top = candidates[0];
  // Engine scores are from the side to move's point of view. One flip, here.
  const flip = mover === human ? 1 : -1;
  const cp = (top?.cp ?? 0) * flip;
  const mate = top?.mate == null ? null : top.mate * flip;
  return {
    cp,
    mate,
    winRate: mate === null ? winChance(cp) : (mate > 0 ? 1 : 0),
    depth,
    candidates,
  };
}

function sanOf(board: Chess, uci: string): string | null {
  const m = /^([a-h][1-8])([a-h][1-8])([qrbn])?$/.exec(uci);
  if (!m) return null;
  try {
    const move = board.move({ from: m[1], to: m[2], promotion: m[3] ?? 'q' });
    board.undo();
    return move?.san ?? null;
  } catch {
    return null;
  }
}
