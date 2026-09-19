// GO with me — a game of Go against KataGo, with a coach who can talk about it.
//
// Two brains, deliberately separate:
//
//   the ENGINE (`src/go/opponent.ts`) decides moves and reads the position. It
//   is KataGo's own network and search, running in this browser. Everything
//   factual — who is ahead, by how many points, what the better move was — comes
//   from here, because it is measured rather than asserted.
//
//   the COACH (`src/coach/*`) talks. It is the platform's runtime AI, and it is
//   handed the engine's numbers to talk ABOUT. It never decides a move and it
//   never touches the board.
//
// Keeping them apart is why the teaching can be trusted: a coach that could
// play an illegal move would be a coach whose explanations mean nothing.
import { ThreeUmicat } from '@umicat/three-sdk';
import { BoardView } from './view/board3d';
import { attachBoardControls } from './view/controls';
import { GoGame, type BoardSize } from './go/rules';
import { LEVELS, Opponent, levelById } from './go/opponent';

async function start(): Promise<void> {
  const umicat = await ThreeUmicat.init();

  const canvas = document.getElementById('game') as HTMLCanvasElement;
  const hud = document.getElementById('hud')!;
  const view = new BoardView(canvas);
  window.addEventListener('resize', () => view.resize());

  const opponent = new Opponent();
  // Start the 4MB download before anyone is waiting on it.
  const loading = opponent.ready();

  let game = new GoGame(9 as BoardSize);
  let level = levelById('steady');
  /** The human's colour. Black moves first, which is also the beginner's side. */
  const human = 'black' as const;
  let armed: { x: number; y: number } | null = null;
  let thinking = false;

  const status = document.createElement('div');
  hud.appendChild(status);
  const say = (text: string): void => { status.textContent = text; };
  say('Loading the engine…');

  const refresh = (): void => {
    view.sync(game);
    if (game.over) {
      say(game.resignedBy ? `${game.resignedBy} resigned.` : 'Both passed — the game is over.');
      return;
    }
    say(thinking ? 'Thinking…' : game.toPlay === human ? 'Your move (black).' : 'White to play.');
  };

  const engineTurn = async (): Promise<void> => {
    if (game.over || game.toPlay === human) return;
    thinking = true;
    refresh();
    try {
      const { decision } = await opponent.decide(game, level);
      if (decision.kind === 'play') game.play(decision.x, decision.y);
      else if (decision.kind === 'pass') game.pass();
      else game.resign('white');
    } catch (err) {
      console.error('[go] engine failed', err);
      say('The engine stumbled. Your move again.');
    } finally {
      thinking = false;
      refresh();
    }
  };

  const commit = (at: { x: number; y: number }): void => {
    if (thinking || game.over || game.toPlay !== human) return;
    if (!game.play(at.x, at.y)) return;   // illegal: the board simply does not take it
    armed = null;
    view.setGhost(null, human);
    refresh();
    void engineTurn();
  };

  attachBoardControls(canvas, (x, y) => view.pick(x, y), {
    onAim: (at) => view.setGhost(at && game.legal(at.x, at.y) ? at : null, human),
    onArmed: (at) => {
      armed = at && game.legal(at.x, at.y) ? at : null;
      view.setGhost(armed, human);
      confirmBtn.hidden = !armed;
    },
    onCommit: commit,
    onCamera: (a, p) => view.orbit(a, p),
    onZoom: (f) => view.zoomBy(f),
  });

  // Buttons live in the HUD, which sits above the platform's control layer.
  const bar = document.createElement('div');
  bar.className = 'bar';
  hud.appendChild(bar);
  const button = (label: string, onClick: () => void): HTMLButtonElement => {
    const b = document.createElement('button');
    b.textContent = label;
    b.onclick = onClick;
    bar.appendChild(b);
    return b;
  };
  const confirmBtn = button('Place', () => { if (armed) commit(armed); });
  confirmBtn.hidden = true;
  button('Pass', () => { if (!thinking && !game.over) { game.pass(); refresh(); void engineTurn(); } });
  button('Recentre', () => view.resetCamera());

  const frame = (): void => {
    view.render();
    requestAnimationFrame(frame);
  };
  frame();

  await loading;
  refresh();

  // The probe surface. Playwright drives the game through this rather than
  // through pixels — a test that clicks a 3mm intersection tests the test.
  Object.assign(window as unknown as Record<string, unknown>, {
    __game: {
      umicat, view, opponent,
      get game() { return game; },
      get thinking() { return thinking; },
      level: () => level.id,
      setLevel: (id: string) => { level = levelById(id); },
      levels: () => LEVELS.map((l) => l.id),
      play: (x: number, y: number) => { commit({ x, y }); },
      pass: () => { game.pass(); refresh(); void engineTurn(); },
      newGame: (size: BoardSize, handicap = 0) => {
        game = new GoGame(size, { handicap });
        view.setBoardSize(size);
        refresh();
        if (game.toPlay !== human) void engineTurn();
      },
      board: () => game.board.map((row) => row.map((c) => (c === 'black' ? 'b' : c === 'white' ? 'w' : '.')).join('')),
    },
  });
}

void start().catch((err) => {
  const hud = document.getElementById('hud');
  if (hud) hud.textContent = `Failed to start: ${String(err)}`;
  console.error('[go] failed to start', err);
});
