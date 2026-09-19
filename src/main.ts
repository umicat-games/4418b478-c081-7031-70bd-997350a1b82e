// GO with me — a game of Go against KataGo, with a coach who can talk about it.
//
// Two brains, deliberately separate:
//
//   the ENGINE (`src/go/opponent.ts`) decides moves and reads the position. It
//   is KataGo's own network and search, running in this browser. Everything
//   factual — who is ahead, by how many points, what the better move was — comes
//   from here, because it is measured rather than asserted.
//
//   the COACH (`src/coach/coach.ts`) talks. It is the platform's runtime AI, and
//   it is handed the engine's numbers to talk ABOUT. It never decides a move and
//   it never touches the board.
//
// Keeping them apart is why the teaching can be trusted: a coach that could
// play an illegal move would be a coach whose explanations mean nothing.
//
// This file is the loop that joins them, and nothing else. When something is
// wrong, the first question is which of the two it belongs to.
import { ThreeUmicat } from '@umicat/three-sdk';
import { BoardView } from './view/board3d';
import { attachBoardControls } from './view/controls';
import { GoGame, type BoardSize } from './go/rules';
import { toGtp } from './go/coords';
import { LEVELS, Opponent, levelById, type Read } from './go/opponent';
import { Coach } from './coach/coach';
import { ChatPanel } from './ui/chat';
import { showTitle } from './ui/title';
import { Autosave, load } from './save';

/** The player is Black: Black moves first, and the beginner should be the one
 *  who gets to start rather than the one who has to answer. */
const HUMAN = 'black' as const;

/** How many of Black's points have to evaporate on Black's own move before the
 *  coach says something. Small enough to catch a real blunder, big enough that
 *  it is not commenting on every slightly loose move. */
const BLUNDER_POINTS = 5;
/** Moves of quiet after a remark, so the coach does not become a narrator. */
const REMARK_COOLDOWN = 4;

async function start(): Promise<void> {
  const umicat = await ThreeUmicat.init();

  const canvas = document.getElementById('game') as HTMLCanvasElement;
  const hud = document.getElementById('hud')!;
  const view = new BoardView(canvas);
  window.addEventListener('resize', () => view.resize());

  const opponent = new Opponent();
  // Begin the 4MB download now, behind the title screen, so that by the time
  // anyone has read two buttons there is nothing left to wait for.
  const loading = opponent.ready();

  // The board is on screen from the first frame, turning slowly, with the
  // title over it — which is also what hides the engine download: by the time
  // anyone has read two buttons there is nothing left to wait for.
  let idleSpin = true;
  const frame = (): void => {
    if (idleSpin) view.orbit(0.0012, 0);
    view.render();
    requestAnimationFrame(frame);
  };
  frame();

  const saved = await load(umicat);
  const autosave = new Autosave(umicat);

  let game: GoGame | null = null;
  let level = levelById(saved.profile.level);
  /** The engine's read of the position the player is looking at. */
  let read: Read | null = null;
  let leadBeforePlayer: number | null = null;
  let thinking = false;
  let armed: { x: number; y: number } | null = null;
  let lastRemarkAt = -REMARK_COOLDOWN;

  // ── the two voices ──────────────────────────────────────────────────────
  const chat = new ChatPanel(umicat, {
    onSend: (text) => void talk(text),
    onLayout: (open) => view.reserveRight(open ? panelWidth() : 0),
  });
  const coach = new Coach(umicat, {
    setBoardSize: (size) => {
      // Mid-game is exactly when a model is most likely to try this, because
      // the student just asked "can we play on a bigger board?".
      if (game && !game.over && game.turns.length > 0) return false;
      newGame(size as BoardSize, 0);
      return true;
    },
    setLevel: (id) => { level = levelById(id); refresh(); return true; },
    startGame: (handicap) => { newGame(coach.profile.boardSize, handicap); return true; },
    highlight: (points) => view.setHighlights(points),
  });
  coach.load(saved.messages, saved.profile);

  const redrawChat = (): void => chat.render(coach.messages, coach.thinking);
  redrawChat();

  async function talk(text: string): Promise<void> {
    redrawChat();
    await coach.ask(text, { game, read });
    redrawChat();
    persist();
  }

  /** The coach's unprompted line. Never for its own sake: `note` is an event
   *  that just happened, and the model may still decide to stay quiet. */
  async function remark(note: string): Promise<void> {
    if (!game) return;
    lastRemarkAt = game.turns.length;
    redrawChat();
    await coach.remark(note, { game, read });
    redrawChat();
    persist();
  }

  // ── the board ───────────────────────────────────────────────────────────
  const status = document.createElement('div');
  hud.appendChild(status);

  function refresh(): void {
    if (game) view.sync(game);
    if (!game) { status.textContent = ''; return; }
    if (game.over) {
      status.textContent = game.resignedBy
        ? `${game.resignedBy === HUMAN ? 'You resigned' : 'White resigned'} — game over.`
        : 'Both passed — game over.';
    } else {
      status.textContent = thinking
        ? 'White is thinking…'
        : game.toPlay === HUMAN ? `Your move · ${level.label}` : 'White to play';
    }
    confirmBtn.hidden = !armed;
  }

  function newGame(size: BoardSize, handicap: number): void {
    game = new GoGame(size, { handicap });
    coach.profile.boardSize = size;
    view.setBoardSize(size);
    view.setHighlights([]);
    armed = null;
    view.setGhost(null, HUMAN);
    read = null;
    leadBeforePlayer = null;
    lastRemarkAt = -REMARK_COOLDOWN;
    refresh();
    persist();
    if (game.toPlay !== HUMAN) void engineTurn();
    else void observePosition();
  }

  /** Read the position the player is about to move in — the baseline a blunder
   *  is measured against. Only worth its CPU when someone is being taught. */
  async function observePosition(): Promise<void> {
    if (!game || game.over || coach.profile.mode !== 'learning') return;
    try {
      read = await opponent.read(game, 24);
      leadBeforePlayer = read.scoreLead;
    } catch { /* a missing read costs commentary, not the game */ }
  }

  async function engineTurn(): Promise<void> {
    if (!game || game.over || game.toPlay === HUMAN) return;
    thinking = true;
    refresh();
    const before = game.captures.white;
    try {
      const out = await opponent.decide(game, level);
      read = out.read;
      if (out.decision.kind === 'play') game.play(out.decision.x, out.decision.y);
      else if (out.decision.kind === 'pass') game.pass();
      else game.resign('white');
    } catch (err) {
      console.error('[go] engine failed', err);
      status.textContent = 'The engine stumbled — your move again.';
    } finally {
      thinking = false;
      refresh();
      persist();
    }

    const taken = game.captures.white - before;
    if (game.over) {
      void remark(`The game just ended. Black ${describeEnd(game)}.`);
    } else if (taken >= 3 && game.turns.length - lastRemarkAt >= REMARK_COOLDOWN) {
      void remark(`White just captured ${taken} of the student's stones.`);
    }
    void observePosition();
  }

  function commit(at: { x: number; y: number }): void {
    if (!game || thinking || game.over || game.toPlay !== HUMAN) return;
    if (!game.play(at.x, at.y)) return;  // illegal: the board simply does not take it
    const played = toGtp(at.x, at.y, game.size);
    armed = null;
    view.setGhost(null, HUMAN);
    view.setHighlights([]);
    refresh();
    persist();

    void (async () => {
      await engineTurn();
      // Judge the student's move only against a baseline that exists, and only
      // once the engine has answered — a lead that moved because of White's
      // reply is not the student's mistake.
      if (!game || leadBeforePlayer === null || !read) return;
      const lost = leadBeforePlayer - read.scoreLead;
      if (lost >= BLUNDER_POINTS && game.turns.length - lastRemarkAt >= REMARK_COOLDOWN) {
        void remark(
          `The student played ${played}. The engine's estimate of their lead fell by ` +
          `${lost.toFixed(1)} points, to ${read.scoreLead.toFixed(1)}. Its own choices were ` +
          `${read.candidates.slice(0, 3).map((c) => toGtp(c.x, c.y, game!.size)).join(', ')}.`,
        );
      }
    })();
  }

  attachBoardControls(canvas, (x, y) => view.pick(x, y), {
    onAim: (at) => view.setGhost(at && game?.legal(at.x, at.y) ? at : null, HUMAN),
    onArmed: (at) => {
      armed = at && game?.legal(at.x, at.y) ? at : null;
      view.setGhost(armed, HUMAN);
      refresh();
    },
    onCommit: commit,
    onCamera: (a, p) => view.orbit(a, p),
    onZoom: (f) => view.zoomBy(f),
  });

  // ── the buttons ─────────────────────────────────────────────────────────
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
  button('Pass', () => {
    if (!game || thinking || game.over) return;
    game.pass();
    refresh();
    void engineTurn();
  });
  button('Resign', () => {
    if (!game || game.over) return;
    if (!window.confirm('Resign this game?')) return;
    game.resign(HUMAN);
    refresh();
    persist();
    void remark('The student resigned.');
  });
  button('Recentre', () => view.resetCamera());

  // ── saving ──────────────────────────────────────────────────────────────
  function persist(): void {
    coach.profile.level = level.id;
    autosave.queue({
      profile: coach.profile,
      messages: coach.messages,
      // An unfinished game is worth coming back to; a finished one is history.
      game: game && !game.over ? game.snapshot() : null,
    });
  }

  /** A finished game is the moment the coach's note is worth rewriting: it is
   *  when the most has just been learned, and it is not in anyone's way. */
  async function closeOut(): Promise<void> {
    if (!game?.over) return;
    coach.profile.gamesPlayed += 1;
    persist();
    await coach.summarise();
    persist();
  }

  // ── the way in ──────────────────────────────────────────────────────────
  // The HUD and the chat belong to the game, not to the title — and a button
  // showing faintly through a title screen reads as a rendering bug.
  document.body.classList.add('titling');
  const choice = await showTitle({
    canContinue: !!saved.game,
    returning: saved.returning,
    loading,
  });

  document.body.classList.remove('titling');
  idleSpin = false;
  view.resetCamera();

  if (choice === 'forget') {
    await Promise.all([umicat.saves.delete('profile'), umicat.saves.delete('chat'), umicat.saves.delete('game')]);
    coach.load([], { ...coach.profile, summary: '', gamesPlayed: 0, mode: 'unknown' });
    redrawChat();
  }

  if (choice === 'continue' && saved.game) {
    game = GoGame.restore(saved.game);
    view.setBoardSize(game.size);
    refresh();
    void observePosition();
  } else {
    newGame(coach.profile.boardSize, 0);
  }

  // The first thing that happens is the coach asking what the player came for
  // — unless it already knows, in which case asking again would be the rudest
  // possible way to greet someone who was here yesterday.
  chat.setOpen(true);
  void coach.remark(
    coach.messages.length
      ? '(The student is back. Greet them briefly and pick up where you left off.)'
      : '(A new student has just sat down at the board. You have not met before.)',
    { game, read },
  ).then(redrawChat);

  // The probe surface. Playwright drives the game through this rather than
  // through pixels: a test that has to click a three-millimetre intersection is
  // a test of the test.
  Object.assign(window as unknown as Record<string, unknown>, {
    __game: {
      umicat, view, opponent, coach, chat,
      get game() { return game; },
      get thinking() { return thinking; },
      get read() { return read; },
      level: () => level.id,
      setLevel: (id: string) => { level = levelById(id); refresh(); },
      levels: () => LEVELS.map((l) => l.id),
      play: (x: number, y: number) => commit({ x, y }),
      pass: () => { game?.pass(); refresh(); void engineTurn(); },
      newGame: (size: BoardSize, handicap = 0) => newGame(size, handicap),
      say: (text: string) => talk(text),
      closeOut,
      board: () => game?.board.map((row) => row.map((c) => (c === 'black' ? 'b' : c === 'white' ? 'w' : '.')).join('')) ?? [],
    },
  });
}

/** How the chat panel is sized in CSS, in pixels, so the board can dodge it. */
const panelWidth = (): number => Math.min(380, window.innerWidth * 0.42) + 24;

function describeEnd(game: GoGame): string {
  if (game.resignedBy) return game.resignedBy === HUMAN ? 'resigned' : 'won by resignation';
  return 'and White both passed, so it goes to the count';
}

void start().catch((err) => {
  const hud = document.getElementById('hud');
  if (hud) hud.textContent = `Failed to start: ${String(err)}`;
  console.error('[go] failed to start', err);
});
