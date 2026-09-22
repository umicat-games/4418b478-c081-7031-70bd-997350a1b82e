// The opponent, and the one place its strength is decided.
//
// **Strength is depth and width plus temperature over the engine's OWN
// moves.** Never a random legal cell. A random move in gomoku is a stone in an
// empty corner, which no human has ever played, and a beginner shown one
// learns something false about the game. Every level here searches, ranks its
// own candidates, and then settles for one it actually likes.
//
// **The engine is asked, never told.** Everything factual the assistant says
// about who is better comes from `read()`; the assistant never decides it.
import { BLACK, Gomoku, type Player } from './rules';
import { MATE, search } from './engine';
import type { SearchRequest, SearchResponse } from './worker';
import { t, type Key } from '../i18n';

export interface Level {
  id: string;
  depth: number;
  /** How many candidates it looks at per node — the biggest single lever on
   *  both strength and speed in this game. */
  width: number;
  timeMs: number;
  /**
   * How loosely it picks among its own candidates. In evaluation units, where
   * an open three is about 12,000 — so 8,000 means it will quite happily take
   * a move it rates a bit below its best, and 0 always takes the best.
   */
  temperature: number;
  /** Never consider a move this much worse than the best. Without it, a warm
   *  temperature eventually ignores a four, which is not "gentle" — it is
   *  broken. */
  window: number;
}

export const LEVELS: Level[] = [
  { id: 'gentle', depth: 2, width: 6, timeMs: 300, temperature: 9000, window: 20000 },
  { id: 'steady', depth: 4, width: 8, timeMs: 800, temperature: 4000, window: 12000 },
  { id: 'sharp', depth: 6, width: 10, timeMs: 1500, temperature: 1200, window: 5000 },
  { id: 'strong', depth: 8, width: 12, timeMs: 3000, temperature: 0, window: 0 },
];

export const levelById = (id: string): Level => LEVELS.find((l) => l.id === id) ?? LEVELS[1];
export const levelLabel = (id: string): string => t(`level.${id}` as Key);
export const levelAbout = (id: string): string => t(`level.${id}.about` as Key);

export interface Candidate { move: number; score: number }

/** The engine's read of a position — the only source of anything factual.
 *  Always from BLACK's point of view, so a positive number always means the
 *  player (who is Black) is better off. The flip happens HERE and nowhere
 *  else; a second one downstream is an assistant telling the player they are
 *  winning while they are being beaten. */
export interface Read {
  score: number;
  /** +1 Black wins by force, -1 Black loses by force. */
  decided?: number;
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
        console.warn('[gomoku] search worker failed, falling back to the main thread', e);
        this.worker = null;
      };
    } catch (err) {
      // Workers are missing in some hosts (an old WebView, a test harness).
      // Searching on the main thread is worse, not broken.
      console.warn('[gomoku] no worker; searching on the main thread', err);
    }
  }

  /** Nothing to download — the engine is a few hundred lines in this bundle.
   *  Kept for the shape of it: the title screen wants something to wait on. */
  ready(): Promise<void> { return Promise.resolve(); }

  private run(game: Gomoku, depth: number, width: number, timeMs: number): Promise<SearchResponse> {
    const id = this.next++;
    if (!this.worker) {
      const r = search(game, { depth, width, timeMs });
      return Promise.resolve({ id, roots: r.roots, depth: r.depth, nodes: r.nodes, score: r.score, ...(r.decided !== undefined ? { decided: r.decided } : {}) });
    }
    const req: SearchRequest = { id, size: game.size, moves: [...game.moves], depth, width, timeMs };
    return new Promise<SearchResponse>((resolve) => {
      this.pending.set(id, resolve);
      this.worker!.postMessage(req);
    });
  }

  private toRead(game: Gomoku, res: SearchResponse): Read {
    const sign = game.toPlay === BLACK ? 1 : -1;
    return {
      score: res.score * sign,
      ...(res.decided !== undefined ? { decided: res.decided * sign } : {}),
      depth: res.depth,
      nodes: res.nodes,
      candidates: res.roots.slice(0, 5).map((r) => ({ move: r.move, score: r.score * sign })),
    };
  }

  /** What the engine makes of the position, from Black's point of view. */
  async read(game: Gomoku, depth = 4, width = 8, timeMs = 600): Promise<Read> {
    return this.toRead(game, await this.run(game, depth, width, timeMs));
  }

  /** Its move. */
  async decide(game: Gomoku, level: Level): Promise<{ move: number | null; read: Read }> {
    const res = await this.run(game, level.depth, level.width, level.timeMs);
    const read = this.toRead(game, res);
    if (!res.roots.length) return { move: null, read };
    return { move: this.choose(res.roots, level, res.decided !== undefined), read };
  }

  /** Softmax over the engine's own candidates — see the note at the top. */
  private choose(roots: Candidate[], level: Level, decided: boolean): number {
    const best = roots[0].score;
    // A win or a forced block is not a place for personality. Neither is the
    // strongest level, which is defined as "the best move it found".
    if (decided || level.temperature <= 0 || Math.abs(best) >= MATE) return roots[0].move;

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

/** Which side the engine plays. The player is Black and moves first — the
 *  beginner should be the one who opens, not the one who has to answer. */
export const ENGINE: Player = 1;
