// The opponent, and the one place its strength is decided.
//
// **Strength is depth, the exact ending, and temperature over the engine's
// OWN moves.** Never a random legal cell. A random move in Othello is a
// corner handed over for nothing, which no human plays on purpose, and a
// beginner shown one learns something false.
//
// The gentle level is the interesting one: it is not a crippled engine, it is
// a GREEDY one — it takes the most discs it can, which is exactly the mistake
// every beginner makes and the one this game exists to teach. Losing to it is
// unlikely; beating it teaches the lesson by hand.
import { BLACK, Othello, type Player } from './rules';
import { search } from './engine';
import type { SearchRequest, SearchResponse } from './worker';
import { t, type Key } from '../i18n';

export interface Level {
  id: string;
  depth: number;
  timeMs: number;
  /** Empty squares at which it stops estimating and plays the ending out
   *  exactly. Zero means never. */
  exactFrom: number;
  /** Count discs and nothing else. */
  greedy?: boolean;
  /** How loosely it picks among its own candidates, in evaluation units. */
  temperature: number;
  window: number;
}

export const LEVELS: Level[] = [
  { id: 'gentle', depth: 2, timeMs: 300, exactFrom: 0, greedy: true, temperature: 30, window: 90 },
  { id: 'steady', depth: 4, timeMs: 800, exactFrom: 8, temperature: 120, window: 400 },
  { id: 'sharp', depth: 6, timeMs: 1600, exactFrom: 11, temperature: 40, window: 160 },
  { id: 'strong', depth: 8, timeMs: 3500, exactFrom: 13, temperature: 0, window: 0 },
];

export const levelById = (id: string): Level => LEVELS.find((l) => l.id === id) ?? LEVELS[1];
export const levelLabel = (id: string): string => t(`level.${id}` as Key);
export const levelAbout = (id: string): string => t(`level.${id}.about` as Key);

export interface Candidate { move: number; score: number }

/** The engine's read of a position — the only source of anything factual.
 *  Always from BLACK's point of view, so a positive number always means the
 *  player is better off. The flip happens HERE and nowhere else. */
export interface Read {
  score: number;
  /** Set when the search played the game out to the end rather than
   *  estimating: the final disc difference, from Black's point of view. This
   *  is the one number in the game that is not an opinion. */
  exact?: number;
  depth: number;
  nodes: number;
  candidates: Candidate[];
}

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
        console.warn('[othello] search worker failed, falling back to the main thread', e);
        this.worker = null;
      };
    } catch (err) {
      console.warn('[othello] no worker; searching on the main thread', err);
    }
  }

  /** Nothing to download — the engine is a few hundred lines in this bundle. */
  ready(): Promise<void> { return Promise.resolve(); }

  private run(game: Othello, limits: { depth: number; timeMs: number; exactFrom: number; greedy?: boolean }): Promise<SearchResponse> {
    const id = this.next++;
    if (!this.worker) {
      const r = search(game, limits);
      return Promise.resolve({ id, roots: r.roots, depth: r.depth, nodes: r.nodes, score: r.score, ...(r.exact !== undefined ? { exact: r.exact } : {}) });
    }
    const req: SearchRequest = { id, moves: [...game.moves], ...limits };
    return new Promise<SearchResponse>((resolve) => {
      this.pending.set(id, resolve);
      this.worker!.postMessage(req);
    });
  }

  private toRead(game: Othello, res: SearchResponse): Read {
    const sign = game.toPlay === BLACK ? 1 : -1;
    return {
      score: res.score * sign,
      ...(res.exact !== undefined ? { exact: res.exact * sign } : {}),
      depth: res.depth,
      nodes: res.nodes,
      candidates: res.roots.slice(0, 5).map((r) => ({ move: r.move, score: r.score * sign })),
    };
  }

  /** What the engine makes of the position, from Black's point of view. */
  async read(game: Othello, depth = 4, timeMs = 600, exactFrom = 10): Promise<Read> {
    return this.toRead(game, await this.run(game, { depth, timeMs, exactFrom }));
  }

  /** Its move. */
  async decide(game: Othello, level: Level): Promise<{ move: number | null; read: Read }> {
    const res = await this.run(game, {
      depth: level.depth, timeMs: level.timeMs, exactFrom: level.exactFrom,
      ...(level.greedy ? { greedy: true } : {}),
    });
    const read = this.toRead(game, res);
    if (!res.roots.length) return { move: null, read };
    return { move: this.choose(res.roots, level, res.exact !== undefined), read };
  }

  /** Softmax over the engine's own candidates — see the note at the top. */
  private choose(roots: Candidate[], level: Level, solved: boolean): number {
    const best = roots[0].score;
    // Once the ending is solved there is nothing to be loose about: the
    // engine knows the result of every move and picking a worse one is not
    // personality, it is throwing the game.
    if (solved || level.temperature <= 0) return roots[0].move;

    const pool = roots.filter((r) => best - r.score <= level.window);
    const weights = pool.map((r) => Math.exp(-(best - r.score) / level.temperature));
    const total = weights.reduce((a, b) => a + b, 0);
    let pick = Math.random() * total;
    for (let i = 0; i < pool.length; i++) {
      pick -= weights[i];
      if (pick <= 0) return pool[i].move;
    }
    return pool[pool.length - 1].move;
  }
}

/** Which side the engine plays. The player is Black and moves first. */
export const ENGINE: Player = 1;
