// The search, off the main thread.
//
// The exact ending is hundreds of thousands of nodes and takes the best part
// of a second; on the main thread that freezes the board and the speech
// bubble, and on a phone it reads as the game having crashed.
//
// Nothing but numbers crosses the boundary: the moves so far, and the limits.
// Classes do not survive `postMessage`, and a worker that rebuilt a game
// object would be a second implementation of the rules.
import { Othello } from './rules';
import { search, type RootMove } from './engine';

export interface SearchRequest {
  id: number;
  moves: number[];
  depth: number;
  timeMs: number;
  exactFrom: number;
  greedy?: boolean;
}

export interface SearchResponse {
  id: number;
  roots: RootMove[];
  depth: number;
  nodes: number;
  score: number;
  exact?: number;
}

self.onmessage = (e: MessageEvent<SearchRequest>): void => {
  const { id, moves, depth, timeMs, exactFrom, greedy } = e.data;
  const game = new Othello();
  for (const m of moves) game.play(m);
  const r = search(game, { depth, timeMs, exactFrom, ...(greedy ? { greedy } : {}) });
  const reply: SearchResponse = {
    id, roots: r.roots, depth: r.depth, nodes: r.nodes, score: r.score,
    ...(r.exact !== undefined ? { exact: r.exact } : {}),
  };
  (self as unknown as Worker).postMessage(reply);
};
