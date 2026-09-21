// The search, off the main thread.
//
// A three-ply search takes a handful of milliseconds and a six-ply one takes
// two seconds; on the main thread the second of those freezes the board, the
// speech bubble and the camera, and on a phone it reads as the game having
// crashed. So the engine lives here and the board keeps drawing while it
// thinks — which is also what makes the "thinking…" line honest.
//
// Nothing but numbers crosses the boundary: the ninety squares, whose turn it
// is, and the limits. Classes do not survive `postMessage`, and a worker that
// rebuilt a game object would be a second implementation of the rules.
import { Position, type Side } from './rules';
import { search, type RootMove } from './engine';

export interface SearchRequest {
  id: number;
  board: number[];
  side: Side;
  depth: number;
  timeMs: number;
}

export interface SearchResponse {
  id: number;
  roots: RootMove[];
  depth: number;
  nodes: number;
  score: number;
  mateIn?: number;
}

self.onmessage = (e: MessageEvent<SearchRequest>): void => {
  const { id, board, side, depth, timeMs } = e.data;
  const result = search(Position.fromBoard(board, side), { depth, timeMs });
  const reply: SearchResponse = {
    id,
    roots: result.roots,
    depth: result.depth,
    nodes: result.nodes,
    score: result.score,
    ...(result.mateIn !== undefined ? { mateIn: result.mateIn } : {}),
  };
  (self as unknown as Worker).postMessage(reply);
};
