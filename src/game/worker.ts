// The search, off the main thread.
//
// A deep gomoku search is a few hundred milliseconds; on the main thread that
// freezes the board, the speech bubble and the camera, and on a phone it reads
// as the game having crashed. So the engine lives here and the board keeps
// drawing while it thinks — which is also what makes the "thinking…" line
// honest.
//
// Nothing but numbers crosses the boundary: the cells, whose turn it is, and
// the limits. Classes do not survive `postMessage`, and a worker that rebuilt
// a game object would be a second implementation of the rules.
import { Gomoku } from './rules';
import { search, type RootMove } from './engine';

export interface SearchRequest {
  id: number;
  size: number;
  /** The moves so far, in order — replayed through the referee, so the worker
   *  cannot be handed a position the rules could not reach. */
  moves: number[];
  depth: number;
  width: number;
  timeMs: number;
}

export interface SearchResponse {
  id: number;
  roots: RootMove[];
  depth: number;
  nodes: number;
  score: number;
  decided?: number;
}

self.onmessage = (e: MessageEvent<SearchRequest>): void => {
  const { id, size, moves, depth, width, timeMs } = e.data;
  const game = new Gomoku(size);
  for (const m of moves) game.play(m);
  const r = search(game, { depth, width, timeMs });
  const reply: SearchResponse = {
    id, roots: r.roots, depth: r.depth, nodes: r.nodes, score: r.score,
    ...(r.decided !== undefined ? { decided: r.decided } : {}),
  };
  (self as unknown as Worker).postMessage(reply);
};
