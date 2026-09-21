// The opponent, and the one place its strength is decided.
//
// Two ideas, both carried over from the Go game because both were right there:
//
// **Strength is depth plus temperature over the engine's OWN moves.** Never a
// random legal move. A random move in xiangqi is not a weaker player — it is a
// horse walking off into a corner, which no human has ever played, and a
// beginner who is shown one learns something false about the game. Every level
// here searches, ranks its own moves, and then picks among the ones it
// actually likes; a gentle opponent is one that settles for its fourth-best
// idea, not one that has no ideas.
//
// **The engine is asked, never told.** Everything factual in this game — who
// is better, by how much, what the better move was — comes from `read()`, and
// the assistant is handed those numbers to talk about. It never gets to decide
// them.
import { XiangqiGame, moveFrom, moveTo, other, type Move, type Side } from './rules';
import { search, materialBalance } from './engine';
import { t, type Key } from '../i18n';
import type { SearchRequest, SearchResponse } from './worker';

export interface Level {
  id: string;
  depth: number;
  /** A ceiling on thinking time. The board is drawn while it thinks, but a
   *  player waiting eight seconds for a reply has stopped enjoying it. */
  timeMs: number;
  /**
   * How loosely it picks among its own candidates, in hundredths of a soldier.
   * Zero always plays the best move it found; 120 means a move it thinks is
   * 120 worse is still chosen about a third of the time.
   */
  temperature: number;
  /** Never consider a move this much worse than the best. Without it, a warm
   *  temperature eventually gives a chariot away for nothing, which is not
   *  "gentle" — it is broken. */
  window: number;
}

export const LEVELS: Level[] = [
  { id: 'gentle', depth: 2, timeMs: 400, temperature: 140, window: 220 },
  { id: 'steady', depth: 3, timeMs: 900, temperature: 70, window: 160 },
  { id: 'sharp', depth: 4, timeMs: 1800, temperature: 30, window: 90 },
  { id: 'strong', depth: 6, timeMs: 3000, temperature: 0, window: 0 },
];

export const levelById = (id: string): Level => LEVELS.find((l) => l.id === id) ?? LEVELS[1];

export interface Candidate { from: number; to: number; score: number }

/** The engine's read of a position — the only source of anything factual. */
export interface Read {
  /** Hundredths of a soldier, from RED's point of view, so a positive number
   *  always means the player (who is Red) is better off. */
  score: number;
  /** Plies to mate, when there is one, from Red's point of view. */
  mateIn?: number;
  depth: number;
  candidates: Candidate[];
}

/** One search in flight at a time; a second request supersedes the first. */
export class Opponent {
  private worker: Worker | null = null;
  private next = 1;
  private pending = new Map<number, (r: SearchResponse) => void>();

  constructor() {
    try {
      this.worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
      this.worker.onmessage = (e: MessageEvent<SearchResponse>): void => {
        const resolve = this.pending.get(e.data.id);
        this.pending.delete(e.data.id);
        resolve?.(e.data);
      };
      this.worker.onerror = (e): void => {
        console.warn('[xiangqi] search worker failed, falling back to the main thread', e);
        this.worker = null;
      };
    } catch (err) {
      // Workers are not available in every host (an old WebView, a test
      // harness). Searching on the main thread is worse, not broken.
      console.warn('[xiangqi] no worker; searching on the main thread', err);
    }
  }

  /** There is nothing to download, so this is only here for the shape of it —
   *  the title screen wants something to wait on. */
  ready(): Promise<void> { return Promise.resolve(); }

  private run(game: XiangqiGame, depth: number, timeMs: number): Promise<SearchResponse> {
    const id = this.next++;
    const req: SearchRequest = { id, board: Array.from(game.position.board), side: game.toPlay, depth, timeMs };
    if (!this.worker) {
      const r = search(game.position.clone(), { depth, timeMs });
      return Promise.resolve({ id, roots: r.roots, depth: r.depth, nodes: r.nodes, score: r.score, ...(r.mateIn !== undefined ? { mateIn: r.mateIn } : {}) });
    }
    return new Promise<SearchResponse>((resolve) => {
      this.pending.set(id, resolve);
      this.worker!.postMessage(req);
    });
  }

  /** What the engine makes of the position, from Red's point of view. */
  async read(game: XiangqiGame, depth = 4, timeMs = 1200): Promise<Read> {
    const res = await this.run(game, depth, timeMs);
    const sign = game.toPlay === 0 ? 1 : -1;  // scores come back for the side to move
    return {
      score: res.score * sign,
      ...(res.mateIn !== undefined ? { mateIn: res.mateIn * sign } : {}),
      depth: res.depth,
      candidates: res.roots.slice(0, 5).map((r) => ({
        from: moveFrom(r.move), to: moveTo(r.move), score: r.score * sign,
      })),
    };
  }

  /**
   * Its move.
   *
   * The level's temperature picks among the candidates it found; the only
   * thing that overrides that choice is a repetition, because an engine that
   * walks into its third identical position has agreed to a draw it never
   * meant to offer.
   */
  async decide(game: XiangqiGame, level: Level): Promise<{ move: { from: number; to: number } | null; resign: boolean; read: Read }> {
    const res = await this.run(game, level.depth, level.timeMs);
    const sign = game.toPlay === 0 ? 1 : -1;
    const read: Read = {
      score: res.score * sign,
      ...(res.mateIn !== undefined ? { mateIn: res.mateIn * sign } : {}),
      depth: res.depth,
      candidates: res.roots.slice(0, 5).map((r) => ({ from: moveFrom(r.move), to: moveTo(r.move), score: r.score * sign })),
    };
    if (!res.roots.length) return { move: null, resign: false, read };

    const chosen = this.choose(game, res.roots.map((r) => ({ move: r.move, score: r.score })), level);
    const move = { from: moveFrom(chosen), to: moveTo(chosen) };
    // Resigning on material, not on a search score: a score is the engine's
    // opinion of a position it may be about to be proved wrong about, and an
    // opponent that resigns a game the player could still lose has taken the
    // game away from them. Down a chariot and a horse with nothing for it is
    // not an opinion.
    const hopeless = materialBalance(game.position, game.toPlay) <= -1300 && game.moves.length > 20;
    return { move, resign: hopeless, read };
  }

  /** Softmax over the engine's own candidates — see the note at the top. */
  private choose(game: XiangqiGame, roots: Array<{ move: Move; score: number }>, level: Level): Move {
    const best = roots[0].score;
    // A forced mate is not a place for personality.
    if (Math.abs(best) > 29_900 || level.temperature <= 0) return this.avoidRepetition(game, roots, roots[0].move);

    const pool = roots.filter((r) => best - r.score <= level.window);
    const weights = pool.map((r) => Math.exp(-(best - r.score) / level.temperature));
    const total = weights.reduce((a, b) => a + b, 0);
    let pick = Math.random() * total;
    for (let i = 0; i < pool.length; i++) {
      pick -= weights[i];
      if (pick <= 0) return this.avoidRepetition(game, pool, pool[i].move);
    }
    return this.avoidRepetition(game, pool, pool[pool.length - 1].move);
  }

  private avoidRepetition(game: XiangqiGame, pool: Array<{ move: Move }>, wanted: Move): Move {
    if (game.repetitionsAfter(moveFrom(wanted), moveTo(wanted)) < 3) return wanted;
    const alt = pool.find((r) => r.move !== wanted && game.repetitionsAfter(moveFrom(r.move), moveTo(r.move)) < 3);
    return alt?.move ?? wanted;
  }
}

/** Which side the engine plays. The player is Red and moves first — the
 *  beginner should be the one who opens, not the one who has to answer. */
export const ENGINE_SIDE: Side = other(0 as Side);

/** What a level is called, and what it feels like to play — the panel's words
 *  and the assistant's, from one place. */
export const levelLabel = (id: string): string => t(`level.${id}` as Key);
export const levelAbout = (id: string): string => t(`level.${id}.about` as Key);
