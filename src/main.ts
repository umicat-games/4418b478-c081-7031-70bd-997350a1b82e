// GO with me — a game of Go against KataGo, with an AI companion beside it.
//
// Two brains, deliberately separate:
//
//   the ENGINE (`src/go/opponent.ts`) decides moves and reads the position. It
//   is KataGo's own network and search, running in this browser. Everything
//   factual — who is ahead, by how many points, what the better move was — comes
//   from here, because it is measured rather than asserted.
//
//   the COMPANION (`src/coach/coach.ts`) talks. It is the platform's runtime
//   AI, handed the engine's numbers to talk ABOUT, and it can point at the
//   board — mark a stone, show a group's liberties, suggest a move. It never
//   decides a move and it never puts a stone down.
//
// Keeping them apart is why what it says can be trusted: a companion that could
// play an illegal move would be a companion whose explanations mean nothing.
//
// A course of lessons lived here until 2026-09-20 and was taken out for
// redesign; `src/teach/` is what survives of it, parked and unwired.
//
// This file is the loop that joins the pieces, and nothing else. When something
// is wrong, the first question is which piece it belongs to.
//
// (build trigger: no functional change)
import { ThreeUmicat } from '@umicat/three-sdk';
import { BoardView } from './view/board3d';
import { attachBoardControls } from './view/controls';
import { GoGame, type BoardSize } from './go/rules';
import { fromGtp, toGtp } from './go/coords';
import { LEVELS, Opponent, levelById, levelLabel, type Read } from './go/opponent';
import { describe as describeScore, scoreFrom, type Score } from './go/scoring';
import { getLiberties } from './engine/utils/gameLogic';
import { Coach } from './coach/coach';
import { ChatPanel } from './ui/chat';
import { Speech, segment, stripAnchors } from './ui/speech';
import { Menu } from './ui/menu';
import { PointActions } from './ui/pointactions';
import { AskHere } from './ui/askhere';
import { showTitle } from './ui/title';
import { GameOver } from './ui/gameover';
import { Plates } from './ui/plates';
import { underCurtain } from './ui/curtain';
import { Autosave, load } from './save';
import { SFX, createAudio, playStone } from './audio';
import { setLocale, t } from './i18n';
import { bootStep } from './ui/boot';

/** The player is Black: Black moves first, and the beginner should be the one
 *  who gets to start rather than the one who has to answer. */
const HUMAN = 'black' as const;

/** How many of Black's points have to evaporate on Black's own move before the
 *  companion mentions it unasked. Small enough to catch a real blunder, big
 *  enough not to natter about every slightly loose move. */
const BLUNDER_POINTS = 5;
/** Moves of quiet after an unprompted remark, so it is not a narrator. */
const REMARK_COOLDOWN = 4;

async function start(): Promise<void> {
  // The boot screen is already up (see index.html); from here on it is told
  // what has actually finished.
  bootStep('bundle');
  const umicat = await ThreeUmicat.init();
  bootStep('platform');
  // Before any UI exists: everything below asks `t()` for its words. The
  // platform's language setting, and nothing else — see i18n.ts.
  setLocale(umicat.locale);

  const canvas = document.getElementById('game') as HTMLCanvasElement;
  const hud = document.getElementById('hud')!;
  const view = new BoardView(canvas);
  window.addEventListener('resize', () => view.resize());

  // ── things the render loop touches ──────────────────────────────────────
  // Declared before it starts. The loop runs from the first frame, long before
  // the rest of this function exists, and a `const` it reads too early is a
  // ReferenceError that takes the whole game down at boot.
  /**
   * Keep drawing for a moment after anything is touched.
   *
   * The panels over the board use `backdrop-filter`, which samples the canvas
   * behind them — and the canvas only redraws when the BOARD changes. Open a
   * panel while the board is still and the blur keeps the sample it took last
   * time, which paints a ghost of wherever that panel used to be. Measured:
   * the composer beside a stone left an outline of its own taller self behind
   * after sending.
   *
   * A quarter of a second covers a tap and the transitions it starts, and
   * costs about fifteen frames of drawing a board that was going to be drawn
   * anyway if anything had actually happened.
   */
  let repaintUntil = 0;
  const repaintSoon = (): void => { repaintUntil = performance.now() + 250; };
  for (const type of ['pointerdown', 'pointerup', 'click', 'keydown'] as const) {
    document.addEventListener(type, repaintSoon, true);
  }

  const speech = new Speech(umicat, {
    onPage: (page) => {
      // The point being talked about lights up for exactly as long as the
      // sentence about it is on screen — as a FOCUS, not as a mark. Sharing
      // the marks meant a sentence with no coordinate in it cleared the ring
      // the companion had just drawn with `highlight`, so marking a point
      // appeared to do nothing at all.
      view.setFocus(page.at ?? null);
      chat.setEchoed(true);
      placeSpeech();
    },
    onDone: () => {
      view.setFocus(null);
      chat.setEchoed(false);
    },
    // The companion names points it is NOT suggesting — White's reply, a dead
    // shape, the place they should not have played — so the offer to play one
    // appears only where a stone could actually go, this turn.
    canPlay: (at) => !!game && !game.over && !thinking && game.toPlay === HUMAN && game.legal(at.x, at.y),
    onPlay: (at) => commit(at),
    // Answering from the box the answer arrived in, rather than opening the
    // log to type. The box then waits in place and the next reply replaces it.
    onReply: (text) => void talk(text),
  });

  /** Confirm / cancel / ask, beside the stone rather than in a corner. */
  /** The two seats either side of the board — furniture, filled by `refresh()`. */
  const plates = new Plates();

  const actions = new PointActions({
    onConfirm: (at) => commit(at),
    onCancel: () => view.setGhost(null, HUMAN),
    onAsk: (at) => askAbout(at),
  });

  /** And the question itself, in the same place. */
  const askHere = new AskHere(umicat, {
    onAsk: (point, text) => void talk(`${point}: ${text}`),
    onCancel: () => view.setFocus(null),
  });

  const audio = createAudio();
  // Fetch and decode ahead of the first gesture. Without it the very first
  // press of a session is silent — there is no decoded buffer yet — and the
  // press in question is the title screen's own button, which every player
  // makes.
  void audio.preload();
  /** Which stone clip was used last, so the same one is never heard twice. */
  const lastStone = { i: -1 };

  // One listener for every button in the game. A click sound wired per button
  // is a click sound that is missing from the next button somebody adds.
  document.addEventListener('click', (e) => {
    const el = e.target as HTMLElement | null;
    if (el?.closest('button')) audio.play(SFX.uiPress);
  }, true);

  /** The end of a game, as a dialog. The status line is where "your move"
   *  lives; a result printed in the same place, in the same type, reads as
   *  one more turn rather than as the end of something. */
  const over = new GameOver({
    onAgain: () => void freshGame(coach.profile.boardSize, 0, companion),
    onTitle: () => void toTitle(),
  });

  const opponent = new Opponent();
  // Begin the 4MB download now, behind the title screen, so that by the time
  // anyone has read two buttons there is nothing left to wait for.
  const loading = opponent.ready();
  /** Whether that is true yet, for the one case where someone is faster. */
  let engineReady = false;
  void loading.then(() => { engineReady = true; }).catch(() => { engineReady = true; });

  /**
   * The board size the seats are measured against, and the reason it is a
   * variable rather than a read of `game`.
   *
   * The render loop below runs from the very first frame — long before `let
   * game` exists — so anything it touches has to be declared up here or it is
   * a `ReferenceError` that takes the whole game down at boot with a blank
   * screen. This is the third time in this family. Zero means "no board yet,
   * nothing to seat".
   */
  let seatedSize = 0;

  const frame = (): void => {
    if (performance.now() < repaintUntil) view.invalidate();
    // Stones on their way to a bowl. Before the render, so the frame about to
    // be drawn is the one they have just moved into.
    view.animate();
    // Only when the picture actually changed. Between two moves a Go board is
    // a still life, and redrawing it sixty times a second takes a core off the
    // engine — which is the thing the player is waiting for.
    if (view.render()) {
      if (speech.showing) placeSpeech();
      if (actions.showing && actions.at) actions.place(view.screenOf(actions.at.x, actions.at.y), view.screenSpacing);
      if (askHere.showing && askHere.at) askHere.place(view.screenOf(askHere.at.x, askHere.at.y), view.screenSpacing);
      seatPlates();
    }
    requestAnimationFrame(frame);
  };
  frame();

  // ── state ───────────────────────────────────────────────────────────────
  const saved = await load(umicat);
  bootStep('saved');
  const autosave = new Autosave(umicat);

  let game: GoGame | null = null;
  let level = levelById(saved.profile.level);
  /** The engine's read of the position the player is looking at. */
  let read: Read | null = null;
  let leadBeforePlayer: number | null = null;
  let thinking = false;
  let score: Score | null = null;
  let lastRemarkAt = -REMARK_COOLDOWN;
  /** Points the companion has rings on. The speech bubble keeps off them:
   *  "I've marked it" printed over the mark is the companion contradicting
   *  itself, and transparency alone only half-answers that. */
  let shown: Array<{ x: number; y: number }> = [];
  /**
   * Whether this game has an assistant at all.
   *
   * ON for every new game, and only a player turning it off turns it off —
   * it is not a remembered preference, because "I did not want to be talked
   * to during that game" is not the same as "never talk to me". Off means no
   * calls to the platform's AI, no bubble, and no buttons that would open one:
   * a game that costs nothing and says nothing.
   */
  let companion = true;
  /** The same list, as the hook writes it. */
  let marks: Array<{ x: number; y: number }> = [];

  // ── the companion ───────────────────────────────────────────────────────
  const chat = new ChatPanel(umicat, {
    onSend: (text) => void talk(text),
    onLayout: (open) => {
      // The gear moves to the panel's own bottom corner while the panel is
      // open: that is where the hand already is, and the board's corner is
      // behind the panel from the player's point of view.
      document.body.classList.toggle('chatting', open);
      view.reserveRight(open ? panelWidth() : 0);
      // Opening the panel means the player wants to read or type, not to be
      // tapped through a bubble that says the same thing.
      if (open) speech.hide();
    },
  });

  const coach = new Coach(umicat, {
    setBoardSize: (size) => {
      // Agreeing with the board it is already looking at must do nothing. It
      // used to start a new game, which rebuilt the board under a player who
      // was mid-tap: new grain, ghost gone, the confirm buttons gone with it.
      if (game && game.size === size) return true;
      if (game && !game.over && game.turns.length > 0) return false;
      newGame(size as BoardSize, 0);
      return true;
    },
    setLevel: (id) => { level = levelById(id); coach.profile.level = id; refresh(); persist(); return true; },
    startGame: (handicap) => {
      /**
       * A game with stones on it is NOT the assistant's to throw away.
       *
       * Reported from a real game: a stone each, and then both vanished and
       * the companion said hello again — it had called `start_game` in the
       * middle of the game, and this hook obliged, taking the board and the
       * conversation with it. The old guard only covered the case where
       * nothing had been played yet, which is the one case where starting
       * over costs nothing.
       *
       * The player has a button for this. Losing a game in progress must
       * take a deliberate act by the person whose game it is.
       */
      if (game && !game.over && game.turns.length > 0) return false;
      // A game nobody has moved in IS a new game. Starting another one throws
      // away the conversation that has just begun about this one.
      if (game && !game.over && game.turns.length === 0 && handicap === game.handicap) return true;
      void freshGame(coach.profile.boardSize, handicap);
      return true;
    },
    // Parsed HERE, against the board that is actually on screen. The coach
    // hands the points over as it wrote them.
    highlight: (points) => {
      marks = parsePoints(points);
      shown = marks;
      view.setHighlights(marks);
      return marks.length;
    },
    // The companion asks for a group's liberties; the GAME counts them. A model
    // asked to count liberties on a board it cannot really see will answer
    // confidently and be wrong, and that number is the whole point here.
    showLiberties: (point) => {
      const board = game;
      const at = board ? fromGtp(point, board.size) : null;
      if (!board || !at || board.board[at.y]?.[at.x] == null) return null;
      const { liberties, group } = getLiberties(board.board, at.x, at.y);
      const seen = new Set<string>();
      const marks: Array<{ x: number; y: number }> = [];
      for (const s of group) {
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as Array<[number, number]>) {
          const p = { x: s.x + dx, y: s.y + dy };
          if (p.x < 0 || p.y < 0 || p.x >= board.size || p.y >= board.size) continue;
          if (board.board[p.y][p.x] !== null) continue;
          const key = `${p.x},${p.y}`;
          if (seen.has(key)) continue;
          seen.add(key);
          marks.push(p);
        }
      }
      view.setHighlights(marks);
      shown = marks;
      return { liberties, stones: group.length, points: marks.map((m) => toGtp(m.x, m.y, board.size)) };
    },
  });
  coach.load(saved.messages, saved.profile);
  // What they turned off last time stays off. Applied before the first gesture
  // so the music does not get one bar in before being silenced.
  if (coach.profile.music === false) audio.setMusicVolume(0);
  if (coach.profile.sound === false) audio.setSfxVolume(0);

  /** How many companion lines have already been said out loud. Starts at the
   *  restored count: the conversation that came back is history, and history
   *  does not get spoken over the title screen. */
  let spoken = coach.messages.filter((m) => m.from === 'coach').length;

  const redrawChat = (): void => {
    chat.render(coach.messages, coach.thinking);
    const said = coach.messages.filter((m) => m.from === 'coach');
    if (said.length > spoken) {
      spoken = said.length;
      // Something new is on screen over the board; see `repaintSoon`.
      repaintSoon();
      // The reply has arrived, so the waiting dots beside the stone are done —
      // the answer is about to appear as speech, beside whatever point the
      // answer is about, which is often not the point that was asked about.
      askHere.hide();
      const size = game?.size ?? 9;
      const latest = said[said.length - 1].text;
      // While the end-of-game dialog is up, the assistant talks INTO it: a
      // bubble behind that card is the assistant addressing a screen the
      // player cannot see.
      if (over.showing) over.note(stripAnchors(latest));
      else speech.show(segment(latest, size), size);
    }
  };

  // Anything the coach does to the conversation — a message, a queued
  // question, starting or finishing a turn — redraws the panel itself.
  coach.onChange = () => redrawChat();

  // Draw what came back from the save, ONCE, now. The panel only ever redraws
  // when somebody speaks, and "Continue" is the one path where nobody does —
  // so without this the restored conversation sat in memory with an empty
  // panel in front of it. (`spoken` is already at the restored count, so this
  // does not read any of it out loud.)
  redrawChat();

  async function talk(text: string): Promise<void> {
    if (!companion) return;
    await coach.ask(text, { game, read });
    persist();
  }

  /** An unprompted line. `note` is what just happened, in plain words; the
   *  companion decides how, and whether, to react. */
  async function remark(note: string): Promise<void> {
    if (!game || !companion) return;
    lastRemarkAt = game.turns.length;
    await coach.remark(note, { game, read });
    persist();
  }

  /** Points as the companion writes them ("D4,E4"), against the live board. */
  function parsePoints(points: string): Array<{ x: number; y: number }> {
    if (!game) return [];
    return points
      .split(',')
      .map((p) => fromGtp(p, game!.size))
      .filter((p): p is { x: number; y: number } => !!p);
  }

  /**
   * The player pointing back.
   *
   * The companion can point at the board; this is the other direction, and it
   * matters more than it looks. Asking about a stone by tapping it beats
   * working out that it is called Q16 and typing that — which is a thing
   * beginners cannot do and nobody enjoys.
   *
   * It happens AT the stone rather than in the panel. Opening the whole
   * conversation to ask one question moved the board sideways, took four
   * movements, and left the player closing it again afterwards; the panel is
   * for reading back through what was said.
   */
  function askAbout(at: { x: number; y: number }): void {
    if (!game) return;
    // Whatever the companion last said belonged to the last thing that
    // happened. Leaving it up puts two boxes over the board at once, and from
    // a foot away they read as one box with a ghost behind it.
    speech.hide();
    view.setFocus(at);
    askHere.open(at, toGtp(at.x, at.y, game.size));
    askHere.place(view.screenOf(at.x, at.y), view.screenSpacing);
  }

  /** Put the bubble where its sentence belongs. Runs every frame while it is
   *  up, because the camera can move under it. */
  function placeSpeech(): void {
    const page = speech.current;
    if (!page) return;
    const box = speech.rect();
    const margin = 10;
    const free = window.innerWidth - (chat.isOpen ? panelWidth() : 0);
    const floor = window.innerHeight - margin;

    /**
     * On screen beats anywhere else.
     *
     * This used to prefer the side of the point that was not covering a ring
     * it had just drawn — which is a nice thought and the wrong priority: on
     * a phone in landscape there is no room below the board, so dodging put
     * the box off the bottom of the screen and the sentence was simply gone.
     * A box standing on something can be read and then closed; a box nobody
     * can see cannot. So: above the point when it fits, below when it does
     * not, and clamped so the whole of it is always on screen.
     */
    const put = (x: number, bottom: number, pointsAt: { x: number; y: number } | null): void => {
      const left = Math.min(Math.max(x, box.width / 2 + margin), free - box.width / 2 - margin);
      const low = Math.min(Math.max(bottom, margin + box.height), floor);
      // The tail only makes sense when the box really is sitting above the
      // thing it is about, and lined up with it.
      const tail = !!pointsAt && Math.abs(left - pointsAt.x) < 2 && low <= pointsAt.y;
      speech.place(left, low, tail);
    };

    if (page.at && game) {
      const p = view.screenOf(page.at.x, page.at.y);
      const gap = view.screenSpacing * 0.7 + 12;
      const above = p.y - gap;
      // Above unless its top would run off, and then below the point.
      put(p.x, above - box.height >= margin ? above : p.y + gap + box.height, p);
      return;
    }
    // Nothing to point at: the middle of the board, because this is someone
    // talking about the game in front of you, not a notification.
    const size = game?.size ?? 9;
    const middle = view.screenOf((size - 1) / 2, (size - 1) / 2);
    put(middle.x, Math.max(middle.y, box.height + margin), null);
  }

  // ── the board ───────────────────────────────────────────────────────────
  const status = document.createElement('div');
  status.className = 'status';
  hud.appendChild(status);
  /** How to place a stone, until they have placed one — ever. */
  const tip = document.createElement('div');
  tip.className = 'tip';
  hud.appendChild(tip);

  /**
   * The result, for the dialog: a headline and one factual line under it.
   *
   * The line is the COUNT — which stones, how many points, how much komi —
   * because at the end of a game of Go "who won" is the least interesting
   * half of the answer and the arithmetic is the half a beginner wants to see.
   */
  function describeResult(g: GoGame, s: Score | null): { title: string; body: string; tone: 'win' | 'loss' | 'draw' } {
    if (g.resignedBy) {
      const won = g.resignedBy !== HUMAN;
      return {
        title: t(won ? 'over.win' : 'over.loss'),
        body: t(won ? 'over.theyResigned' : 'over.youResigned'),
        tone: won ? 'win' : 'loss',
      };
    }
    const won = s ? s.winner === HUMAN : false;
    const margin = s ? Math.abs(s.lead) : 0;
    return {
      title: t(won ? 'over.win' : 'over.loss'),
      body: s
        ? t('over.counted', {
          black: s.black,
          white: s.white,
          komi: g.komi,
          margin: margin % 1 === 0 ? margin : margin.toFixed(1),
        }) + (s.unsettled ? ` ${t('over.unsettled')}` : '')
        : '',
      tone: won ? 'win' : 'loss',
    };
  }

  /**
   * Put the two seats against the board's own edges.
   *
   * The edges are taken from the grid plus one line spacing, which is what the
   * wooden margin around the grid is — measured rather than assumed, so it
   * stays right on a 9x9 and a 19x19 and while the board is reframing around
   * an open panel.
   */
  function seatPlates(): void {
    if (!seatedSize) return;
    const last = seatedSize - 1;
    const mid = Math.round((seatedSize - 1) / 2);
    // Half a line spacing outside the grid is the wooden margin — the board's
    // real edge, measured rather than assumed, so it stays right on a 9x9 and
    // a 19x19 and while the board is reframing around an open panel.
    const edge = view.screenSpacing * 0.6;
    const l = view.screenOf(0, mid), r = view.screenOf(last, mid);
    const t = view.screenOf(mid, 0), b = view.screenOf(mid, last);
    // The edges are the min and the max, never the first and the second: on a
    // board that can be turned round (chess, when the student has Black)
    // column 0 is on the RIGHT, and taking it as the left edge puts both
    // seats inside the board, on top of the pieces.
    plates.place({
      left: Math.min(l.x, r.x) - edge,
      right: Math.max(l.x, r.x) + edge,
      top: Math.min(t.y, b.y) - edge,
      bottom: Math.max(t.y, b.y) + edge,
    });
  }

  /**
   * What the two plates SAY they have taken, which is not always what the
   * rules say yet.
   *
   * The stones are still on their way there. A count that goes up the instant
   * the move is played is a number contradicting the board in front of it —
   * five stones still visibly sitting on the wood, and the plate already
   * claiming them — so it waits for them to arrive. Everything else reads
   * `game.captures`; only the plates read this.
   */
  const counted = { black: 0, white: 0 };

  /** Put the shown counts back level with the rules — a new game, a restored
   *  one, or anything that cut a cascade short. */
  function settleCounts(): void {
    counted.black = game?.captures.black ?? 0;
    counted.white = game?.captures.white ?? 0;
  }

  /**
   * Take the stones that move just captured off the board, visibly.
   *
   * Called with the game ALREADY in the position after the move: the rules
   * have removed them, so the view is handed the stones themselves. The count
   * on the plate goes up when they land, which is what `settleCounts` is
   * doing inside the callback — and `fillPlates` after it, because a number
   * that changes with nobody redrawing it does not change.
   */
  function liftCaptures(by: 'black' | 'white'): void {
    if (!game || !game.lastCaptured.length) return;
    const last = game.lastStone;
    view.liftCaptures(
      game.lastCaptured,
      by === 'black' ? 'white' : 'black',
      // Towards the seat that is about to count them: the player is on the
      // left of the board, the engine on the right.
      by === HUMAN ? 'left' : 'right',
      last ? { x: last.x, y: last.y } : null,
      () => { settleCounts(); fillPlates(); },
    );
  }

  /** Who is sitting where. The player is on the left, which is the side their
   *  own status line and gear are already on. */
  function fillPlates(): void {
    if (!game) { seatedSize = 0; plates.hide(); return; }
    seatedSize = game.size;
    const me = umicat.user;
    const yourTurn = !game.over && game.toPlay === HUMAN && !thinking;
    plates.set(
      {
        name: me?.name || t('plate.you'),
        avatar: me?.avatar ?? null,
        colour: HUMAN,
        meta: t('plate.captures', { n: counted[HUMAN] }),
        active: yourTurn,
      },
      {
        name: t('plate.engine'),
        colour: HUMAN === 'black' ? 'white' : 'black',
        // How hard it is playing belongs to the opponent, not to the status
        // line in the player's own corner — that is a property of who you are
        // sitting across from.
        meta: `${levelLabel(level.id)} · ${t('plate.captures', { n: counted.white })}`,
        // The dots go BESIDE what the seat already says rather than replacing
        // it: "thinking" is a state, and a state that erases the level and
        // the count is a seat that flickers between two different sentences.
        thinking,
        active: !game.over && !yourTurn,
      },
    );
    seatPlates();
  }

  function refresh(): void {
    if (game) view.sync(game);
    fillPlates();
    if (!game) { status.textContent = ''; tip.textContent = ''; return; }
    if (game.over) {
      status.textContent = score
        ? describeScore(score, game)
        : game.resignedBy
          ? t(game.resignedBy === HUMAN ? 'hud.youResigned' : 'hud.whiteResigned')
          : t('hud.counting');
    } else {
      status.textContent = thinking
        ? t('hud.whiteThinking')
        : game.toPlay === HUMAN ? t('hud.yourMove', { level: levelLabel(level.id) }) : t('hud.whiteToPlay');
    }
    const green = !game.over && game.toPlay === HUMAN && !thinking;
    tip.textContent = green && !coach.profile.placed ? t('hud.howToPlace') : '';
  }

  function newGame(size: BoardSize, handicap: number): void {
    view.clearFlights();
    over.hide();
    game = new GoGame(size, { handicap });
    settleCounts();
    coach.profile.boardSize = size;
    view.setBoardSize(size);
    view.setHighlights([]);
    shown = [];
    view.setFocus(null);
    view.setTerritory(null, [], game);
    actions.hide();
    view.setGhost(null, HUMAN);
    read = null;
    score = null;
    leadBeforePlayer = null;
    lastRemarkAt = -REMARK_COOLDOWN;
    refresh();
    persist();
    if (game.toPlay !== HUMAN) void engineTurn();
  }

  /**
   * A new game is a new conversation.
   *
   * The old one is summarised into the companion's running note first — that is
   * where the long memory lives — and then the thread is cleared, so the next
   * game does not open in the middle of the last one's argument about a corner
   * that no longer exists. Continuing a game keeps the thread, for the same
   * reason in reverse.
   */
  async function freshGame(size: BoardSize, handicap: number, withCompanion = true): Promise<void> {
    setCompanion(withCompanion);
    // **The board first.** Starting a new game used to wait for the
    // assistant to summarise the LAST one — a round trip to a language model
    // — so the player pressed "new game" and looked at an empty board until
    // a note about a finished game had been written. It read as the pieces
    // loading; nothing was loading. `newSession` now clears the conversation
    // in this same tick and writes its note behind us.
    newGame(size, handicap);
    /**
     * **The conversation is cleared BEFORE the counter that tracks it.**
     *
     * `spoken` is how many of the coach's lines have already been said out
     * loud, and `redrawChat()` speaks anything past it. Setting it to 0 while
     * the LAST game's conversation is still in `coach.messages` — which is
     * what these three lines used to do, in this order — makes the redraw
     * find unspoken lines and put the most recent one in the speech bubble.
     *
     * That is a brand new, empty board with the previous game's last sentence
     * floating over it, ringing a point that has nothing on it, offering to
     * play a move from a position that no longer exists. Reported twice as
     * "the assistant is talking about my old game", and it is not the
     * assistant: no model is called on this path at all. The game is reading
     * its own transcript back.
     *
     * It needs a saved conversation to bite, which is why it showed up after
     * walking out of a game mid-way and coming back — `coach.load()` restores
     * the thread, and starting a new game then re-speaks the end of it.
     *
     * `newSession()` empties `messages` synchronously before its first await,
     * so by the time the counter is reset there is nothing left to speak.
     */
    void coach.newSession();
    speech.hide();
    spoken = 0;
    redrawChat();
    void remark(
      'A new game has just started. One line: greet them if you have not yet, and name the first thing '
      + 'worth thinking about on an empty board. Do not recap the last game.',
    );
  }

  /** Read the position the player is about to move in — the baseline a blunder
   *  is measured against. */
  async function observePosition(): Promise<void> {
    if (!game || game.over) return;
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
      if (out.decision.kind === 'play') {
        game.play(out.decision.x, out.decision.y);
        liftCaptures('white');
        playStone(audio, lastStone);
      } else if (out.decision.kind === 'pass') game.pass();
      else game.resign('white');
      if (game.captures.white > before) audio.play(SFX.capture);
    } catch (err) {
      console.error('[go] engine failed', err);
      status.textContent = t('hud.engineStumbled');
    } finally {
      thinking = false;
      refresh();
      persist();
    }

    const taken = game.captures.white - before;
    if (game.over) void finish();
    else if (taken >= 3 && game.turns.length - lastRemarkAt >= REMARK_COOLDOWN) {
      void remark(`White just captured ${taken} of the player's stones.`);
    }
    void observePosition();
  }

  function commit(at: { x: number; y: number }): void {
    if (!game || thinking || game.over || game.toPlay !== HUMAN) return;
    const taken = game.captures.black;
    if (!game.play(at.x, at.y)) return;  // illegal: the board simply does not take it
    liftCaptures(HUMAN);
    playStone(audio, lastStone);
    if (game.captures.black > taken) audio.play(SFX.capture);
    coach.profile.placed = true;
    const played = toGtp(at.x, at.y, game.size);
    actions.hide();
    askHere.hide();
    view.setGhost(null, HUMAN);
    view.setHighlights([]);
    shown = [];
    view.setFocus(null);
    refresh();
    persist();

    void (async () => {
      await engineTurn();
      // Judge the move only against a baseline that exists, and only once the
      // engine has answered — a lead that moved because of White's reply is not
      // the player's mistake.
      if (!game || game.over || leadBeforePlayer === null || !read) return;
      const lost = leadBeforePlayer - read.scoreLead;
      if (lost < BLUNDER_POINTS || game.turns.length - lastRemarkAt < REMARK_COOLDOWN) return;
      const better = read.candidates.slice(0, 3).map((c) => toGtp(c.x, c.y, game!.size)).join(', ');
      void remark(
        `The player played ${played}. By the engine's count that changed their lead by `
        + `${(-lost).toFixed(1)} points, to ${read.scoreLead.toFixed(1)}. It would have played ${better}.`,
      );
    })();
  }

  /** A point was chosen. Nothing is played yet — that is what the tick is for. */
  function select(at: { x: number; y: number } | null): void {
    if (!at || !game) { actions.hide(); view.setGhost(null, HUMAN); return; }
    askHere.hide();
    const canPlace = !game.over && !thinking && game.toPlay === HUMAN && game.legal(at.x, at.y);
    // An empty point that the rules will not take — a ko, or filling your own
    // last liberty. Silence there reads as the game not having noticed the tap.
    if (!canPlace && game.board[at.y][at.x] === null && !game.over && game.toPlay === HUMAN) {
      audio.play(SFX.denied);
    }
    view.setGhost(canPlace ? at : null, HUMAN);
    // Asking about an empty point in the middle of nowhere is not worth a
    // button; asking about a stone, or about a point you could play, is.
    const canAsk = companion && (canPlace || game.board[at.y][at.x] !== null);
    actions.show(at, canPlace, canAsk);
    actions.place(view.screenOf(at.x, at.y), view.screenSpacing);
  }

  attachBoardControls(canvas, (x, y) => view.pick(x, y), {
    onAim: (at) => {
      // While the cluster is up, the ghost belongs to the point it is offering;
      // a hovering mouse must not drag it somewhere else.
      if (actions.showing) return;
      const playable = game && !game.over && !thinking && game.toPlay === HUMAN ? game : null;
      view.setGhost(at && playable?.legal(at.x, at.y) ? at : null, HUMAN);
    },
    onPicked: select,
    // No camera handlers: the view is fixed. See POLAR_DEG in board3d.ts.
  });

  // ── the one button, and everything behind it ────────────────────────────
  const bar = document.createElement('div');
  bar.className = 'bar';
  hud.appendChild(bar);

  const menu = new Menu(
    { size: coach.profile.boardSize, level: level.id, handicap: 0, companion: true },
    {
      onLevel: (id) => { level = levelById(id); coach.profile.level = id; refresh(); persist(); },
      onCompanion: (on) => setCompanion(on),
      onStart: ({ size, handicap, companion: withCompanion }) => void (async () => {
        // Started from the title, the board is still behind a title screen.
        leaveTitle();
        if (!engineReady) await underCurtain(t('title.loading'), loading);
        await freshGame(size, handicap, withCompanion);
      })(),
      onHint: () => void hint(),
      onPass: () => {
        if (!game || thinking || game.over) return;
        game.pass();
        refresh();
        if (game.over) void finish();
        else void engineTurn();
      },
      onResign: () => {
        if (!game || game.over) return;
        if (!window.confirm(t('confirm.resign'))) return;
        game.resign(HUMAN);
        refresh();
        persist();
        void finish();
      },
      onMusic: (on) => { audio.setMusicVolume(on ? 0.22 : 0); coach.profile.music = on; persist(); },
      onSound: (on) => { audio.setSfxVolume(on ? 1 : 0); coach.profile.sound = on; persist(); },
      music: () => coach.profile.music !== false,
      sound: () => coach.profile.sound !== false,
      // Dismissed from the title screen, where there is no board behind it.
      onClose: () => { if (!game) void toTitle(); },
    },
  );

  /** The way into the log, now that the top line is gone. Same icon as the one
   *  beside a stone, because it opens the same thing: what was said. */
  const logBtn = document.createElement('button');
  logBtn.className = 'lift quiet icon';
  logBtn.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true">'
    + '<path d="M20.5 11.5a7.5 7.5 0 0 1-7.5 7.5H8.8L4.5 21.8V17A7.5 7.5 0 1 1 20.5 11.5z"/>'
    + '<path d="M9 10.5h6M9 13.5h4"/>'
    + '</svg>';
  logBtn.title = t('btn.log');
  logBtn.setAttribute('aria-label', t('btn.log'));
  logBtn.onclick = () => chat.toggle();
  bar.appendChild(logBtn);

  const gear = document.createElement('button');
  gear.className = 'lift quiet icon';
  // A gear, not the word. It is the only button outside the panels, it never
  // changes meaning, and an icon that size reads from further away than four
  // characters do — in any language, which is the other half of it.
  gear.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true">'
    + '<circle cx="12" cy="12" r="3.2"/>'
    + '<path d="M19.4 14.4a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-1.8-.3 1.6 1.6 0 0 0-1 1.5v.2a2 2 0 1 1-4 0v-.1a1.6 1.6 0 0 0-1-1.5 1.6 1.6 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0 .3-1.8 1.6 1.6 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.6 1.6 0 0 0 1.5-1 1.6 1.6 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 1.8.3H9a1.6 1.6 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 1 1.5 1.6 1.6 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-.3 1.8V9a1.6 1.6 0 0 0 1.5 1h.2a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1z"/>'
    + '</svg>';
  gear.title = t('btn.setup');
  gear.setAttribute('aria-label', t('btn.setup'));
  gear.onclick = () => {
    menu.sync({ size: game?.size ?? coach.profile.boardSize, level: level.id, companion }, !!game && !game.over);
    menu.toggle();
  };
  bar.appendChild(gear);

  /**
   * Show what the engine would play.
   *
   * Free, in the sense that matters: the engine runs on this machine, so a hint
   * costs a second of battery and nothing of the player's credits. The companion
   * is not involved — if they want to know WHY, they can ask, and that is the
   * call worth paying for.
   */
  async function hint(): Promise<void> {
    if (!game || game.over || thinking || game.toPlay !== HUMAN) return;
    const was = status.textContent;
    status.textContent = t('hud.looking');
    try {
      const r = await opponent.read(game, 200);
      const best = r.candidates.find((c) => c.x >= 0 && game!.legal(c.x, c.y));
      if (best) {
        view.setHighlights([{ x: best.x, y: best.y }]);
        status.textContent = t('hud.engineWouldPlay', { point: toGtp(best.x, best.y, game.size) });
      } else {
        status.textContent = t('hud.engineWouldPass');
      }
    } catch {
      status.textContent = was;
    }
  }

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

  /**
   * The end of a game: count it, show it, talk about it, remember it.
   *
   * The count comes from a fresh read of the final position at high visits —
   * not from the read the last move was chosen with, which is a move stale and
   * can be wrong about a stone that just died. It is also the one moment where
   * a second of thinking is free: nobody is waiting on their turn.
   */
  async function finish(): Promise<void> {
    if (!game?.over) return;
    coach.profile.gamesPlayed += 1;
    persist();

    if (!game.resignedBy) {
      try {
        const final = await opponent.read(game, 300);
        read = final;
        score = scoreFrom(game, final);
        view.setTerritory(score.owner, score.dead, game);
      } catch (err) {
        console.warn('[go] could not count the board', err);
      }
    }
    refresh();
    audio.play(SFX.gameOver);
    // The board keeps the count on it underneath; the dialog closes to show it.
    speech.hide();
    over.show(describeResult(game, score));

    await remark(score
      ? `The game is over and counted. ${describeScore(score, game)}`
        + (score.unsettled ? ' (The position was still unsettled, so treat the count as approximate.)' : '')
        + (score.dead.length ? ` ${score.dead.length} stones were dead on the board.` : '')
      : 'The game just ended.');

    // Written last, when the game it is about is genuinely finished.
    await coach.summarise();
    persist();
  }

  // ── the way in, and back out ────────────────────────────────────────────
  /**
   * The title screen: continue, a new game, or settings.
   *
   * Runs at boot and every time the player leaves a game, so it reads the
   * CURRENT state rather than the save it booted from: after an hour of play,
   * "is there a game to continue?" is a question about the board in front of
   * them, not about what was on disk when the tab opened.
   */
  async function toTitle(): Promise<void> {
    speech.hide();
    actions.hide();
    askHere.hide();
    menu.close();
    over.hide();
    chat.setOpen(false);
    await autosave.flush();

    document.body.classList.add('titling');
    const stored = await umicat.saves.get<ReturnType<GoGame['snapshot']>>('game');
    const choice = await showTitle({
      canContinue: (!!game && !game.over) || !!stored,
      returning: saved.returning || coach.profile.gamesPlayed > 0 || coach.messages.length > 0,
      loading,
    });

    if (choice === 'forget') {
      await Promise.all([
        umicat.saves.delete('profile'), umicat.saves.delete('chat'),
        umicat.saves.delete('game'), umicat.saves.delete('lesson'),
      ]);
      coach.load([], { ...coach.profile, summary: '', gamesPlayed: 0, mode: 'unknown', placed: false });
      spoken = 0;
      redrawChat();
      await toTitle();
      return;
    }

    if (choice === 'new') {
      // Not straight into a game: the board size, the opponent and the
      // handicap are chosen here, and starting without asking is how the
      // choice ended up invisible. The panel's own Start does the rest.
      // A new game always OFFERS the assistant, whatever the last game did.
      menu.sync({ size: coach.profile.boardSize, level: level.id, companion: true }, false, true);
      menu.show();
      return;
    }

    leaveTitle();
    // Almost always already true — the network arrives while the title is
    // being read. The exception is a player who presses through it in under a
    // second, and they are the reason this exists.
    if (!engineReady) await underCurtain(t('title.loading'), loading);

    if (choice === 'continue') {
      // The game in progress if there is one, and the conversation that goes
      // with it — a player who walked out to the title and straight back in
      // should find both exactly as they left them.
      if (game && !game.over) { refresh(); void observePosition(); return; }
      if (stored) {
        game = GoGame.restore(stored);
        // The prisoners in a restored game were taken before this tab
        // existed: there is nothing to fly, and the plates say so at once.
        settleCounts();
        // What is on the board wins over what was last chosen in the panel.
        coach.profile.boardSize = game.size;
        view.setBoardSize(game.size);
        refresh();
        void observePosition();
        return;
      }
    }
    await freshGame(coach.profile.boardSize, 0);
  }

  /** Turn the assistant on or off for this game, and everything that follows
   *  from it: the buttons that reach it, and whatever it had on screen. */
  function setCompanion(on: boolean): void {
    companion = on;
    logBtn.hidden = !on;
    if (!on) {
      speech.hide();
      askHere.hide();
      chat.setOpen(false);
    }
    refresh();
  }

  /** Take the title down and give the board back. */
  function leaveTitle(): void {
    document.body.classList.remove('titling');
  }

  await toTitle();

  // The probe surface. Playwright drives the game through this rather than
  // through pixels: a test that has to click a three-millimetre intersection is
  // a test of the test.
  Object.assign(window as unknown as Record<string, unknown>, {
    __game: {
      umicat, view, opponent, coach, chat, speech, menu, actions, askHere, audio, over,
      get game() { return game; },
      get thinking() { return thinking; },
      get read() { return read; },
      get score() { return score; },
      level: () => level.id,
      setLevel: (id: string) => { level = levelById(id); refresh(); },
      levels: () => LEVELS.map((l) => l.id),
      select,
      play: (x: number, y: number) => commit({ x, y }),
      pass: () => { game?.pass(); refresh(); if (game?.over) void finish(); else void engineTurn(); },
      newGame: (size: BoardSize, handicap = 0) => void freshGame(size, handicap),
      say: (text: string) => talk(text),
      redraw: redrawChat,
      hint,
      finish,
      toTitle: () => toTitle(),
      plates,
      flush: () => autosave.flush(),
      board: () => game?.board.map((row) => row.map((c) => (c === 'black' ? 'b' : c === 'white' ? 'w' : '.')).join('')) ?? [],
    },
  });
}

/** How the chat panel is sized in CSS, in pixels, so the board can dodge it. */
const panelWidth = (): number => Math.min(380, window.innerWidth * 0.42) + 24;

void start().catch((err) => {
  const hud = document.getElementById('hud');
  if (hud) hud.textContent = `Failed to start: ${String(err)}`;
  console.error('[go] failed to start', err);
});
