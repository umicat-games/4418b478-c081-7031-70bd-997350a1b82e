// Chess with me — a game of chess against Stockfish, with an AI companion
// sitting beside the board.
//
// Two brains, deliberately separate:
//
//   the ENGINE (`src/chess/opponent.ts`) decides moves and reads the
//   position. It is Stockfish, running in this browser. Everything factual —
//   who is better, by how much, what the move was, whether that dropped a
//   piece — comes from here, because it is measured rather than asserted.
//
//   the COMPANION (`src/coach/coach.ts`) talks. It is the platform's runtime
//   AI, handed the engine's numbers to talk ABOUT, and it can point at the
//   board — mark squares, show what attacks what, offer a move. It never
//   decides a move and it never moves a piece.
//
// Keeping them apart is why what it says can be trusted. A companion that
// could play an illegal move would be a companion whose explanations mean
// nothing — and chess makes that trap worse than Go does, because a language
// model has read enough chess prose to describe, fluently and in the right
// vocabulary, a position it has misread.
//
// This file is the loop that joins the pieces, and nothing else. When
// something is wrong, the first question is which piece it belongs to.
import { ThreeUmicat } from '@umicat/three-sdk';
import { BoardView } from './view/board3d';
import { attachBoardControls } from './view/controls';
import { ChessGame, other, type Odds, type Side } from './chess/rules';
import { fromSan, toSan, type Sq } from './chess/coords';
import { LEVELS, Opponent, levelById, levelLabel, type Read } from './chess/opponent';
import { openingName } from './chess/openings';
import { Coach } from './coach/coach';
import { ChatPanel } from './ui/chat';
import { Speech, segment, type Segment } from './ui/speech';
import { Menu } from './ui/menu';
import { SquareActions } from './ui/squareactions';
import { AskHere } from './ui/askhere';
import { EvalBar } from './ui/evalbar';
import { askPromotion, type Promotion } from './ui/promotion';
import { showTitle } from './ui/title';
import { underCurtain } from './ui/curtain';
import { Autosave, load } from './save';
import { SFX, createAudio, playPiece } from './audio';
import { setLocale, t, type Key } from './i18n';

/**
 * How much has to evaporate on the player's own move before the companion
 * mentions it unasked, in centipawns.
 *
 * 150 is "you dropped more than a pawn and a half" — big enough that it is a
 * mistake rather than an inaccuracy, small enough to catch a hung knight. A
 * coach that speaks up every time you lose 30 centipawns is a coach nobody
 * finishes a game with.
 */
const BLUNDER_CP = 150;
/** Moves of quiet after an unprompted remark, so it is not a narrator. */
const REMARK_COOLDOWN = 3;
/** How long the engine reads when nobody is waiting on it — the baseline the
 *  next blunder is measured against, and what the eval bar shows. */
const WATCH = { movetime: 240, multipv: 3 };
/** A hint is worth a proper look: nobody is on move while it runs. */
const HINT = { movetime: 1200, multipv: 1 };

async function start(): Promise<void> {
  const umicat = await ThreeUmicat.init();
  // Before any UI exists: everything below asks `t()` for its words.
  setLocale(umicat.locale);

  const canvas = document.getElementById('game') as HTMLCanvasElement;
  const hud = document.getElementById('hud')!;
  const view = new BoardView(canvas);
  window.addEventListener('resize', () => view.resize());

  // ── things the render loop touches ──────────────────────────────────────
  // Declared before it starts. The loop runs from the first frame, long
  // before the rest of this function exists, and a `const` it reads too early
  // is a ReferenceError that takes the whole game down at boot.
  let idleSpin = true;
  /**
   * Keep drawing for a moment after anything is touched.
   *
   * The panels over the board use `backdrop-filter`, which samples the canvas
   * behind them — and the canvas only redraws when the BOARD changes. Open a
   * panel while the board is still and the blur keeps the sample it took last
   * time, which paints a ghost of wherever that panel used to be.
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
      // The square being talked about lights up for exactly as long as the
      // sentence about it is on screen — as a FOCUS, not as a mark. Sharing
      // the marks would mean a sentence with no square in it clearing the
      // ring the companion had just drawn with `highlight`.
      view.setFocus(page.at ?? null);
      chat.setEchoed(true);
      placeSpeech();
    },
    onDone: () => {
      view.setFocus(null);
      chat.setEchoed(false);
    },
    moveOf: (page) => offeredMove(page)?.san ?? null,
    onPlay: (page) => {
      const m = offeredMove(page);
      if (m) void commit(m.from, m.to);
    },
    // Answering from the box the answer arrived in, rather than opening the
    // log to type. The box then waits in place and the next reply replaces it.
    onReply: (text) => void talk(text),
  });

  /** Confirm / cancel / ask, beside the square rather than in a corner. */
  const actions = new SquareActions({
    onConfirm: (at) => { if (from) void commit(from, at); },
    onCancel: () => clearSelection(),
    onAsk: (at) => askAbout(at),
  });

  /** And the question itself, in the same place. */
  const askHere = new AskHere(umicat, {
    onAsk: (square, text) => void talk(`${square}: ${text}`),
    onCancel: () => view.setFocus(null),
  });

  const evalBar = new EvalBar();

  const audio = createAudio();
  // Fetch and decode ahead of the first gesture. Without it the very first
  // press of a session is silent — there is no decoded buffer yet — and the
  // press in question is the title screen's own button.
  void audio.preload();
  const lastKnock = { i: -1 };

  // One listener for every button in the game. A click sound wired per button
  // is a click sound that is missing from the next button somebody adds.
  document.addEventListener('click', (e) => {
    const el = e.target as HTMLElement | null;
    if (el?.closest('button')) audio.play(SFX.uiPress);
  }, true);

  const opponent = new Opponent();
  // Start compiling the wasm now, behind the title screen, so that by the
  // time anyone has read two buttons there is nothing left to wait for.
  const loading = opponent.ready();
  let engineReady = false;
  void loading.then(() => { engineReady = true; }).catch(() => { engineReady = true; });

  const frame = (): void => {
    if (idleSpin) view.orbit(0.0012, 0);
    if (performance.now() < repaintUntil) view.invalidate();
    // Only when the picture actually changed. Between two moves a chess board
    // is a still life, and redrawing it sixty times a second takes a core off
    // the engine — which is the thing the player is waiting for.
    if (view.render()) {
      if (speech.showing) placeSpeech();
      placeActions();
      if (askHere.showing && askHere.at) askHere.place(view.screenOf(askHere.at.x, askHere.at.y), view.screenSpacing);
    }
    requestAnimationFrame(frame);
  };
  frame();

  // ── state ───────────────────────────────────────────────────────────────
  const saved = await load(umicat);
  const autosave = new Autosave(umicat);

  let game: ChessGame | null = null;
  let level = levelById(saved.profile.level);
  /** The engine's read of the position the player is looking at. */
  let read: Read | null = null;
  /** The same number, from before the player moved — the baseline a blunder
   *  is measured against — and what the engine would have played instead.
   *  Both belong to the position the player was LOOKING at, which is the only
   *  position in which "you should have played X" means anything. */
  let cpBeforePlayer: number | null = null;
  let bestBeforePlayer: string[] = [];
  let thinking = false;
  let lastRemarkAt = -REMARK_COOLDOWN;
  /** The move being built: a piece picked up, and where it is going. */
  let from: Sq | null = null;
  /** Squares the assistant has rings on. The speech bubble keeps off them:
   *  "I've marked it" printed over the mark is the assistant contradicting
   *  itself, and transparency alone only half-answers that. */
  let shown: Sq[] = [];
  /**
   * Whether this game has an assistant at all.
   *
   * ON for every new game, and only a player turning it off turns it off —
   * it is not a remembered preference, because "I did not want to be talked
   * to during that game" is not the same as "never talk to me". Off means no
   * calls to the platform's AI, no bubble, and no buttons that would open
   * one: a game that costs nothing and says nothing.
   */
  let companion = true;

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
    setLevel: (id) => { level = levelById(id); coach.profile.level = id; refresh(); persist(); return true; },
    startGame: (side, odds) => {
      /**
       * A game with pieces on it is NOT the assistant's to throw away.
       *
       * Reported in GO with me and fixed across the family: a move each, then
       * both vanished and the companion said hello again — it had called
       * `start_game` mid-game and this hook obliged, taking the board and the
       * conversation with it. The old guard only covered the case where
       * nothing had been played, which is the one case where starting over
       * costs nothing. The player has a button; losing a game in progress has
       * to be their own deliberate act.
       */
      if (game && !game.over && game.plies > 0) return false;
      // A game nobody has moved in IS a new game. Starting another one throws
      // away the conversation that has just begun about this one.
      if (game && !game.over && game.plies === 0 && game.human === side && game.odds === odds) return true;
      void freshGame(side, odds);
      return true;
    },
    // Parsed HERE, against the board that is actually on screen. The
    // assistant hands the squares over as it wrote them.
    highlight: (squares) => {
      shown = parseSquares(squares);
      view.setHighlights(shown);
      return shown.length;
    },
    // The companion asks what is attacking a square; the BOARD answers. A
    // model asked to read that off a text diagram will answer confidently and
    // be wrong, and it is exactly the kind of thing a beginner then believes.
    showAttacks: (at) => {
      if (!game) return null;
      const piece = game.at(at);
      const owner: Side = piece?.side ?? game.human;
      const attackers = game.attackers(at, other(owner));
      const defenders = game.attackers(at, owner);
      shown = [at, ...attackers, ...defenders];
      view.setHighlights(shown);
      return {
        square: toSan(at.x, at.y),
        piece: piece ? `${piece.side} ${piece.kind}` : null,
        attackers: attackers.map((s) => toSan(s.x, s.y)),
        defenders: defenders.map((s) => toSan(s.x, s.y)),
        undefended: attackers.length > 0 && defenders.length === 0,
      };
    },
    showMoves: (at) => {
      if (!game) return null;
      const piece = game.at(at);
      const moves = game.movesFrom(at);
      shown = [at, ...moves.map((m) => m.to)];
      view.setHighlights(shown);
      return {
        square: toSan(at.x, at.y),
        piece: piece ? `${piece.side} ${piece.kind}` : null,
        moves: moves.map((m) => m.san),
      };
    },
  });
  coach.load(saved.messages, saved.profile);
  // What they turned off last time stays off. Applied before the first
  // gesture so the music does not get one bar in before being silenced.
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
      // The reply has arrived, so the waiting dots beside the square are done
      // — the answer is about to appear as speech, beside whatever square the
      // answer is about, which is often not the one that was asked about.
      askHere.hide();
      speech.show(segment(said[said.length - 1].text));
    }
  };

  // Anything the assistant does to the conversation — a message, a queued
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
    lastRemarkAt = game.plies;
    await coach.remark(note, { game, read });
    persist();
  }

  /** Squares as the assistant writes them ("e4,d5"), against the live board. */
  function parseSquares(squares: string): Sq[] {
    return squares.split(',').map((x) => fromSan(x)).filter((x): x is Sq => !!x);
  }

  /**
   * The player pointing back.
   *
   * The companion can point at the board; this is the other direction.
   * Asking about a piece by tapping it beats working out that it is on c6 and
   * typing that — which is a thing beginners cannot do and nobody enjoys.
   */
  function askAbout(at: Sq): void {
    if (!game) return;
    // Whatever the assistant last said belonged to the last thing that
    // happened. Leaving it up puts two boxes over the board at once, and from
    // a foot away they read as one box with a ghost behind it.
    speech.hide();
    view.setFocus(at);
    askHere.open(at, toSan(at.x, at.y));
    askHere.place(view.screenOf(at.x, at.y), view.screenSpacing);
  }

  /**
   * Which move, if any, the bubble is offering to play.
   *
   * A square is not a move — two knights can reach f3 — so the sentence is
   * read first: every move the companion writes is in SAN, and SAN says which
   * piece. Only if there is no move in the text does the anchor square get
   * used, and then only when exactly one legal move ends there.
   */
  function offeredMove(page: Segment): { from: Sq; to: Sq; san: string } | null {
    if (!game || game.over || thinking || game.toPlay !== game.human) return null;
    const legal: Array<{ from: Sq; to: Sq; san: string }> = [];
    for (const f of game.movable(game.human)) {
      for (const m of game.movesFrom(f)) legal.push({ from: f, to: m.to, san: m.san });
    }
    // SAN as written, with the check and capture marks optional — the
    // companion writes `Nf3` where the board says `Nf3+` often enough.
    const bare = (s: string): string => s.replace(/[+#!?]+$/, '');
    for (const m of legal) {
      const re = new RegExp(`(^|[^A-Za-z0-9])${escapeRe(bare(m.san))}([+#!?]*)(?![A-Za-z0-9])`);
      if (re.test(page.text)) return m;
    }
    if (!page.at) return null;
    const ending = legal.filter((m) => m.to.x === page.at!.x && m.to.y === page.at!.y);
    return ending.length === 1 ? ending[0] : null;
  }

  /** Put the bubble where its sentence belongs. Runs every frame while it is
   *  up, because the camera can move under it. */
  function placeSpeech(): void {
    const page = speech.current;
    if (!page) return;
    const box = speech.rect();
    const margin = 10;
    const free = window.innerWidth - (chat.isOpen ? panelWidth() : 0);

    if (page.at && game) {
      const p = view.screenOf(page.at.x, page.at.y);
      const gap = view.screenSpacing * 0.7 + 12;
      const x = Math.min(Math.max(p.x, box.width / 2 + margin), free - box.width / 2 - margin);
      const top = p.y - gap;
      // Above unless there is no room, and then below — but if the side it
      // would take is sitting on a ring it has just drawn, take the other one.
      const above = { top: top - box.height, bottom: top };
      const below = { top: p.y + gap, bottom: p.y + gap + box.height };
      const fits = (r: { top: number; bottom: number }): boolean => r.top >= margin;
      const covers = (r: { top: number; bottom: number }): number => shown.filter((m) => {
        const sc = view.screenOf(m.x, m.y);
        return sc.x > x - box.width / 2 - 8 && sc.x < x + box.width / 2 + 8 && sc.y > r.top - 8 && sc.y < r.bottom + 8;
      }).length;
      if (fits(above) && (covers(above) <= covers(below) || !fits(below))) speech.place(x, top, Math.abs(x - p.x) < 2);
      else speech.place(x, below.bottom, false);
      return;
    }
    // Nothing to point at: the middle of the board, because this is someone
    // talking about the game in front of you, not a notification.
    const middle = view.screenOf(3.5, 3.5);
    const x = Math.min(Math.max(middle.x, box.width / 2 + margin), free - box.width / 2 - margin);
    speech.place(x, Math.max(middle.y, box.height + margin), false);
  }

  // ── the board ───────────────────────────────────────────────────────────
  const status = document.createElement('div');
  hud.appendChild(status);
  /** How to move a piece, until they have moved one — ever. */
  const tip = document.createElement('div');
  tip.className = 'tip';
  hud.appendChild(tip);

  function refresh(): void {
    if (game) view.sync(game);
    evalBar.show(game && !game.over ? read : null);
    if (!game) { status.textContent = ''; tip.textContent = ''; return; }
    if (game.over) {
      status.textContent = resultText(game);
    } else if (thinking) {
      status.textContent = t('hud.thinking');
    } else if (game.toPlay === game.human) {
      status.textContent = t(game.inCheck ? 'hud.yourMoveCheck' : 'hud.yourMove', { level: levelLabel(level.id) });
    } else {
      status.textContent = t('hud.theirMove');
    }
    const yours = !game.over && game.toPlay === game.human && !thinking;
    tip.textContent = yours && !coach.profile.moved ? t('hud.howToMove') : '';
  }

  function resultText(g: ChessGame): string {
    const key: Key = g.outcome === 'resigned'
      ? (g.resignedBy === g.human ? 'result.youResigned' : 'result.theyResigned')
      : g.outcome === 'checkmate'
        ? (g.winner === g.human ? 'result.youMate' : 'result.theyMate')
        : g.outcome === 'stalemate' ? 'result.stalemate'
          : g.outcome === 'repetition' ? 'result.repetition'
            : g.outcome === 'fifty-move' ? 'result.fifty'
              : 'result.insufficient';
    return t(key);
  }

  /**
   * Put the cluster beside its square, off the squares the player still has to
   * be able to tap: where the piece in hand may go, and the piece itself.
   *
   * Without this the cross sat on h1 whenever the king on g1 was picked up,
   * and pressing it only put the king down — so g1-h1 could not be played at
   * all. Measured, and then measured again after.
   */
  function placeActions(): void {
    const at = actions.at;
    if (!actions.showing || !at) return;
    const keep = (from ? game?.movesFrom(from).map((m) => m.to) ?? [] : [])
      .concat(from ? [from] : [])
      .filter((q) => q.x !== at.x || q.y !== at.y)
      .map((q) => view.screenOf(q.x, q.y));
    actions.place(view.screenOf(at.x, at.y), view.screenSpacing, keep);
  }

  function clearSelection(): void {
    from = null;
    actions.hide();
    view.setSelection(null);
    view.setGhost(null, null, 'white');
  }

  function newGame(side: Side, odds: Odds): void {
    game = new ChessGame(side, odds);
    coach.profile.side = side;
    coach.profile.odds = odds;
    view.setSeat(side);
    view.setHighlights([]);
    shown = [];
    view.setFocus(null);
    clearSelection();
    read = null;
    cpBeforePlayer = null;
    bestBeforePlayer = [];
    lastRemarkAt = -REMARK_COOLDOWN;
    refresh();
    persist();
    if (game.toPlay !== game.human) void engineTurnAlone();
    else void observePosition();
  }

  /**
   * A new game is a new conversation.
   *
   * The old one is summarised into the companion's running note first — that
   * is where the long memory lives — and then the thread is cleared, so the
   * next game does not open in the middle of the last one's argument about a
   * bishop that is no longer on the board.
   */
  async function freshGame(side: Side, odds: Odds, withCompanion = true): Promise<void> {
    setCompanion(withCompanion);
    await coach.newSession();
    spoken = 0;
    redrawChat();
    newGame(side, odds);
    void remark(
      `A new game has just started; the student is ${side}. One line: greet them if you have not `
      + 'yet, and say the one thing to think about on the first move. Do not recap the last game.',
    );
  }

  /** Read the position the player is about to move in. Also what the eval bar
   *  is showing, so it is never older than the board. */
  async function observePosition(): Promise<void> {
    if (!game || game.over) return;
    try {
      read = await opponent.read(game, WATCH);
      cpBeforePlayer = read.mate === null ? read.cp : (read.mate > 0 ? 3000 : -3000);
      bestBeforePlayer = read.candidates.slice(0, 3).map((c) => c.san);
      refresh();
    } catch { /* a missing read costs commentary, not the game */ }
  }

  /**
   * The engine's move.
   *
   * Returns two things, and gives away neither of them by itself.
   *
   * `read` is the position AFTER the player's move and BEFORE this one, which
   * is the right thing to judge the player's move against. Returned rather
   * than read off `read` afterwards, because `observePosition` overwrites
   * that a moment later and whether the caller wins that race is not
   * something to leave to chance.
   *
   * `event` is what just happened, if it is worth a word. It is handed BACK
   * rather than said here because the caller may have something better to
   * say: after a blunder, "you dropped two pawns and should have played
   * exd5" beats "they took your knight", and whichever is said first spends
   * the cooldown and silences the other. One event, one sentence, and the
   * one who knows which sentence is better picks.
   */
  async function engineTurn(): Promise<{ read: Read | null; event: string | null }> {
    if (!game || game.over || game.toPlay === game.human) return { read: null, event: null };
    thinking = true;
    clearSelection();
    refresh();
    let took: string | null = null;
    let decided: Read | null = null;
    let moved = false;
    try {
      const out = await opponent.decide(game, level);
      read = out.read;
      decided = out.read;
      if (out.uci) {
        const m = fromSan(out.uci.slice(0, 2));
        const to = fromSan(out.uci.slice(2, 4));
        const promo = out.uci[4] as Promotion | undefined;
        const played = m && to ? game.play(m, to, promo ?? 'q') : null;
        if (played) {
          moved = true;
          playPiece(audio, lastKnock);
          if (played.captured) { audio.play(SFX.capture); took = played.captured; }
        }
      }
    } catch (err) {
      console.error('[chess] engine failed', err);
      status.textContent = t('hud.engineStumbled');
    } finally {
      thinking = false;
      refresh();
      persist();
    }

    // An engine that answered with nothing, or with a move the board refused,
    // leaves it silently NOT the player's turn — the game looks frozen and
    // nothing in the log says why. Say so, and give the move back.
    if (!moved && !game.over) {
      console.error('[chess] engine produced no legal move');
      status.textContent = t('hud.engineStumbled');
      return { read: decided, event: null };
    }

    if (game.over) { void finish(); return { read: decided, event: null }; }
    // The engine taking a real piece is worth a word, once in a while. A pawn
    // is not: most captures in a game are pawns, and a companion that mentions
    // every one of them is a companion nobody leaves open.
    const event = took && took !== 'pawn'
      ? `They just took the student's ${took} with ${game.lastMove?.san}.`
      : game.inCheck
        ? `${game.lastMove?.san} puts the student in check.`
        : null;
    void observePosition();
    return { read: decided, event };
  }

  /** The engine's move when nobody else is going to decide what to say about
   *  it — the opening move of a game it plays first, and a restored game it
   *  was on move in. */
  async function engineTurnAlone(): Promise<void> {
    const { event } = await engineTurn();
    if (event && game && game.plies - lastRemarkAt >= REMARK_COOLDOWN) void remark(event);
  }

  async function commit(f: Sq, to: Sq): Promise<void> {
    if (!game || thinking || game.over || game.toPlay !== game.human) return;
    const moves = game.movesFrom(f).filter((m) => m.to.x === to.x && m.to.y === to.y);
    if (!moves.length) return;   // illegal: the board simply does not take it
    // Asked at the last moment, so the question only ever appears for a move
    // that is actually being played.
    const promotion: Promotion = moves[0].promotion ? await askPromotion() : 'q';

    const played = game.play(f, to, promotion);
    if (!played) return;
    playPiece(audio, lastKnock);
    if (played.captured) audio.play(SFX.capture);
    coach.profile.moved = true;
    clearSelection();
    askHere.hide();
    view.setHighlights([]);
    shown = [];
    view.setFocus(null);
    refresh();
    persist();

    if (game.over) { void finish(); return; }

    void (async () => {
      const before = cpBeforePlayer;
      const instead = bestBeforePlayer.filter((san) => san !== played.san);
      const { read: after, event } = await engineTurn();
      const speakable = (): boolean => !!game && !game.over && game.plies - lastRemarkAt >= REMARK_COOLDOWN;
      // Judged only against a baseline that exists, and against the position
      // the player's move ACTUALLY produced — not the one after the engine
      // has replied, because an evaluation that moved because of the reply is
      // not the player's mistake. Both numbers are from the student's point
      // of view; `opponent.read` does that flip once, so nothing here has to.
      if (!game || game.over || before === null || !after) return;
      const now = after.mate === null ? after.cp : (after.mate > 0 ? 3000 : -3000);
      const lost = before - now;
      // The blunder has first claim on the one sentence going spare. Only if
      // the move was fine does what the engine did get mentioned.
      if (lost < BLUNDER_CP) { if (event && speakable()) void remark(event); return; }
      if (!speakable()) return;
      void remark(
        `The student played ${played.san}. By the engine's count that changed their evaluation by `
        + `${(-lost / 100).toFixed(1)} pawns, to ${(now / 100).toFixed(1)}. `
        + (instead.length ? `It would have played ${instead.join(' or ')}.` : ''),
      );
    })();
  }

  /**
   * A square was chosen. Nothing is played yet — that is what the tick is for.
   *
   * Two taps, always: pick the piece up, then say where it goes. It could be
   * one drag, and a drag is worse here — on a phone the finger covers the
   * square it is over, and a mis-drop in chess is a lost piece rather than a
   * point.
   */
  function select(at: Sq | null): void {
    if (!at || !game) { clearSelection(); return; }
    askHere.hide();
    const yours = !game.over && !thinking && game.toPlay === game.human;
    const piece = game.at(at);

    if (from) {
      const move = game.movesFrom(from).find((m) => m.to.x === at.x && m.to.y === at.y);
      if (move) {
        const moving = game.at(from)!;
        view.setGhost(at, moving.kind, moving.side);
        actions.show(at, { confirm: true, cancel: true, ask: companion });
        placeActions();
        return;
      }
      // The piece already in hand: tapping it again puts it down. That is
      // what a cancel button would be for, which is why there is no cancel
      // button at that stage — one fewer button is one fewer square standing
      // under one.
      if (from.x === at.x && from.y === at.y) { clearSelection(); return; }
      // Tapping another of your own pieces is picking that one up instead,
      // not a mistake worth a noise.
      if (piece && piece.side === game.human && yours) { pickUp(at); return; }
      clearSelection();
      if (piece) { actions.show(at, { cancel: true, ask: companion }); placeActions(); }
      return;
    }

    if (yours && piece && piece.side === game.human) {
      if (game.movesFrom(at).length) { pickUp(at); return; }
      // A piece with nowhere to go — pinned, or blocked. Silence there reads
      // as the game not having noticed the tap.
      audio.play(SFX.denied);
    }
    view.setSelection(null);
    if (piece) {
      actions.show(at, { cancel: true, ask: companion });
      placeActions();
    } else {
      actions.hide();
    }
  }

  function pickUp(at: Sq): void {
    if (!game) return;
    from = at;
    const moves = game.movesFrom(at);
    view.setGhost(null, null, 'white');
    view.setSelection(at, moves.filter((m) => !m.capture).map((m) => m.to), moves.filter((m) => m.capture).map((m) => m.to));
    // Only "ask" while the piece is in hand: the cross here would cancel a
    // pick-up that tapping the piece again already cancels, and it would do
    // it from on top of a square the piece can move to.
    actions.show(at, { ask: companion });
    placeActions();
  }

  attachBoardControls(canvas, (x, y) => view.pick(x, y), {
    onAim: () => { /* no hover ghost: a chess piece only moves where it is sent */ },
    onPicked: select,
    onCamera: (a, p) => view.orbit(a, p),
    onZoom: (f) => view.zoomBy(f),
  });

  // ── the one button, and everything behind it ────────────────────────────
  const bar = document.createElement('div');
  bar.className = 'bar';
  hud.appendChild(bar);

  const menu = new Menu(
    { side: coach.profile.side, level: level.id, odds: coach.profile.odds, companion: true },
    {
      onLevel: (id) => { level = levelById(id); coach.profile.level = id; refresh(); persist(); },
      onCompanion: (on) => setCompanion(on),
      onStart: ({ side, odds, companion: withCompanion }) => void (async () => {
        // Started from the title, the board is still behind a title screen.
        leaveTitle();
        if (!engineReady) await underCurtain(t('title.loading'), loading);
        await freshGame(side, odds, withCompanion);
      })(),
      onHint: () => void hint(),
      onTakeback: () => {
        if (!game || thinking || game.over) return;
        if (!game.undoPair()) return;
        clearSelection();
        refresh();
        persist();
        void observePosition();
      },
      onResign: () => {
        if (!game || game.over) return;
        if (!window.confirm(t('confirm.resign'))) return;
        game.resign(game.human);
        refresh();
        persist();
        void finish();
      },
      onRecentre: () => view.resetCamera(),
      onMusic: (on) => { audio.setMusicVolume(on ? 0.22 : 0); coach.profile.music = on; persist(); },
      onSound: (on) => { audio.setSfxVolume(on ? 1 : 0); coach.profile.sound = on; persist(); },
      onEval: (on) => { evalBar.setEnabled(on); refresh(); },
      music: () => coach.profile.music !== false,
      sound: () => coach.profile.sound !== false,
      evalBar: () => evalBar.enabled,
      onTitle: () => void toTitle(),
      // Dismissed from the title screen, where there is no board behind it.
      onClose: () => { if (!game) void toTitle(); },
    },
  );

  /** The way into the log. Same icon as the one beside a piece, because it
   *  opens the same thing: what was said. */
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
  // changes meaning, and an icon that size reads from further away than five
  // characters do — in any language, which is the other half of it.
  gear.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true">'
    + '<circle cx="12" cy="12" r="3.2"/>'
    + '<path d="M19.4 14.4a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-1.8-.3 1.6 1.6 0 0 0-1 1.5v.2a2 2 0 1 1-4 0v-.1a1.6 1.6 0 0 0-1-1.5 1.6 1.6 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0 .3-1.8 1.6 1.6 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.6 1.6 0 0 0 1.5-1 1.6 1.6 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 1.8.3H9a1.6 1.6 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 1 1.5 1.6 1.6 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-.3 1.8V9a1.6 1.6 0 0 0 1.5 1h.2a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1z"/>'
    + '</svg>';
  gear.title = t('btn.setup');
  gear.setAttribute('aria-label', t('btn.setup'));
  gear.onclick = () => {
    menu.sync({ side: game?.human ?? coach.profile.side, level: level.id, companion }, !!game && !game.over);
    menu.toggle();
  };
  bar.appendChild(gear);

  /**
   * Show what the engine would play.
   *
   * Free, in the sense that matters: the engine runs on this machine, so a
   * hint costs a second of battery and nothing of the player's credits. The
   * companion is not involved — if they want to know WHY, they can ask, and
   * that is the call worth paying for.
   */
  async function hint(): Promise<void> {
    if (!game || game.over || thinking || game.toPlay !== game.human) return;
    const was = status.textContent;
    status.textContent = t('hud.looking');
    try {
      const r = await opponent.read(game, HINT);
      const best = r.candidates[0];
      const squares = best ? [best.uci.slice(0, 2), best.uci.slice(2, 4)].map((s) => fromSan(s)) : [];
      view.setHighlights(squares.filter((s): s is Sq => !!s));
      status.textContent = best ? t('hud.engineWouldPlay', { move: best.san }) : was ?? '';
    } catch {
      status.textContent = was ?? '';
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

  /** The end of a game: show it, talk about it, remember it. */
  async function finish(): Promise<void> {
    if (!game?.over) return;
    coach.profile.gamesPlayed += 1;
    evalBar.hide();
    refresh();
    audio.play(SFX.gameOver);
    persist();

    const g = game;
    await remark(
      `The game is over. ${resultText(g)} It lasted ${g.moveNumber} moves`
      + `${openingName(g.moves) ? `, from a ${openingName(g.moves)}` : ''}. `
      + 'One line worth remembering, not a list.',
    );

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
    evalBar.hide();
    menu.close();
    chat.setOpen(false);
    await autosave.flush();

    document.body.classList.add('titling');
    idleSpin = true;
    const stored = await umicat.saves.get<ReturnType<ChessGame['snapshot']>>('game');
    const choice = await showTitle({
      canContinue: (!!game && !game.over) || !!stored,
      returning: saved.returning || coach.profile.gamesPlayed > 0 || coach.messages.length > 0,
      loading,
    });

    if (choice === 'forget') {
      await Promise.all([
        umicat.saves.delete('profile'), umicat.saves.delete('chat'), umicat.saves.delete('game'),
      ]);
      coach.load([], { ...coach.profile, summary: '', gamesPlayed: 0, mode: 'unknown', moved: false });
      spoken = 0;
      redrawChat();
      await toTitle();
      return;
    }

    if (choice === 'new') {
      // Not straight into a game: which side, which opponent and what odds
      // are chosen here, and starting without asking is how the choice ended
      // up invisible. The panel's own Start does the rest.
      // A new game always OFFERS the assistant, whatever the last game did.
      menu.sync({ side: coach.profile.side, level: level.id, odds: coach.profile.odds, companion: true }, false, true);
      menu.show();
      return;
    }

    leaveTitle();
    // Almost always already true — the wasm compiles while the title is being
    // read. The exception is a player who presses through it in under a
    // second, and they are the reason this exists.
    if (!engineReady) await underCurtain(t('title.loading'), loading);

    if (choice === 'continue') {
      if (game && !game.over) { view.setSeat(game.human); refresh(); void observePosition(); return; }
      if (stored) {
        game = ChessGame.restore(stored);
        view.setSeat(game.human);
        refresh();
        if (game.toPlay === game.human) void observePosition();
        else void engineTurnAlone();
        return;
      }
    }
    await freshGame(coach.profile.side, coach.profile.odds);
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
    idleSpin = false;
    view.resetCamera();
  }

  await toTitle();

  // The probe surface. Playwright drives the game through this rather than
  // through pixels: a test that has to click a square on a tilted board is a
  // test of the test.
  Object.assign(window as unknown as Record<string, unknown>, {
    __game: {
      umicat, view, opponent, coach, chat, speech, menu, actions, askHere, audio, evalBar,
      get companion() { return companion; },
      setCompanion,
      get game() { return game; },
      get thinking() { return thinking; },
      get read() { return read; },
      get from() { return from; },
      level: () => level.id,
      setLevel: (id: string) => { level = levelById(id); refresh(); },
      levels: () => LEVELS.map((l) => l.id),
      select,
      /** Play a move by name: `move('e2', 'e4')` or `move('e7e8q')`. */
      move: (a: string, b?: string, promo: Promotion = 'q') => {
        const f = fromSan(b ? a : a.slice(0, 2));
        const to = fromSan(b ?? a.slice(2, 4));
        if (!f || !to) return false;
        void commit(f, to);
        return true;
      },
      newGame: (side: Side = 'white', odds: Odds = 'none') => void freshGame(side, odds),
      say: (text: string) => talk(text),
      redraw: redrawChat,
      hint,
      finish,
      observe: observePosition,
      toTitle: () => toTitle(),
      flush: () => autosave.flush(),
      fen: () => game?.fen ?? null,
      board: () => game?.diagram() ?? [],
    },
  });
}

/** How the chat panel is sized in CSS, in pixels, so the board can dodge it. */
const panelWidth = (): number => Math.min(380, window.innerWidth * 0.42) + 24;

const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

void start().catch((err) => {
  const hud = document.getElementById('hud');
  if (hud) hud.textContent = `Failed to start: ${String(err)}`;
  console.error('[chess] failed to start', err);
});
