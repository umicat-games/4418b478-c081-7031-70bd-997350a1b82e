// Xiangqi with me — a game of Chinese chess against a real engine, with an AI
// assistant beside the board.
//
// Two brains, deliberately separate:
//
//   the ENGINE (`src/xiangqi/engine.ts`) decides moves and reads the position.
//   It is an alpha-beta search over the same rules the player moves through,
//   running in a worker in this browser. Everything factual — who is better,
//   by how much, what the better move was — comes from here, because it is
//   measured rather than asserted.
//
//   the ASSISTANT (`src/coach/coach.ts`) talks. It is the platform's runtime
//   AI, handed the engine's numbers to talk ABOUT, and it can point at the
//   board — ring a square, show where a piece may go, show what is hanging. It
//   never decides a move and it never moves a piece.
//
// Keeping them apart is why what it says can be trusted: an assistant that
// could play an illegal move would be an assistant whose explanations mean
// nothing. And the rules themselves are tested rather than believed — see
// `npm run verify`.
//
// This file is the loop that joins the pieces, and nothing else. When
// something is wrong, the first question is which piece it belongs to.
import { ThreeUmicat } from '@umicat/three-sdk';
import { BoardView } from './view/board3d';
import { attachBoardControls } from './view/controls';
import {
  BLACK, RED, XiangqiGame, fileOf, rankOf, sideOf, typeOf,
  type Handicap, type Side,
} from './xiangqi/rules';
import { fromIccs, toIccs } from './xiangqi/coords';
import { LEVELS, Opponent, levelById, levelLabel, type Read } from './xiangqi/opponent';
import { openingName } from './xiangqi/openings';
import { Coach, pieceName } from './coach/coach';
import { ChatPanel } from './ui/chat';
import { Speech, segment, stripAnchors } from './ui/speech';
import { Menu } from './ui/menu';
import { PointActions } from './ui/pointactions';
import { AskHere } from './ui/askhere';
import { EvalBar } from './ui/evalbar';
import { GameOver } from './ui/gameover';
import { Plates } from './ui/plates';
import { showTitle } from './ui/title';
import { underCurtain } from './ui/curtain';
import { Autosave, load } from './save';
import { SFX, createAudio, playStone } from './audio';
import { setLocale, t } from './i18n';
import { bootStep } from './ui/boot';

/** The player is Red: Red moves first, and the beginner should be the one who
 *  opens rather than the one who has to answer. */
const HUMAN: Side = RED;

/** How much of the player's advantage has to evaporate on their own move,
 *  in hundredths of a soldier, before the assistant mentions it unasked.
 *  Two and a half soldiers is a hanging horse; less than that is a slightly
 *  loose move, and nobody wants to be told about those. */
const BLUNDER = 250;
/** Moves of quiet after an unprompted remark, so it is not a narrator. */
const REMARK_COOLDOWN = 4;

interface Point { x: number; y: number }
const squareOf = (p: Point): number => p.y * 9 + p.x;
const pointOf = (square: number): Point => ({ x: fileOf(square), y: rankOf(square) });
const nameOf = (p: Point): string => toIccs(p.x, p.y);
/** A move, as the assistant and the opening book write one. */
const moveName = (m: { from: number; to: number }): string =>
  `${toIccs(fileOf(m.from), rankOf(m.from))}${toIccs(fileOf(m.to), rankOf(m.to))}`;

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
  // ReferenceError that takes the whole game down at boot with a blank screen.
  // This happened twice in the Go game; it is the same loop.
  /**
   * Keep drawing for a moment after anything is touched.
   *
   * The panels over the board use `backdrop-filter`, which samples the canvas
   * behind them — and the canvas only redraws when the BOARD changes. Open a
   * panel while the board is still and the blur keeps the sample it took last
   * time, which paints a ghost of wherever that panel used to be.
   */
  let repaintUntil = 0;
  const repaintSoon = (): void => { repaintUntil = performance.now() + 250; };
  for (const type of ['pointerdown', 'pointerup', 'click', 'keydown'] as const) {
    document.addEventListener(type, repaintSoon, true);
  }

  const speech = new Speech(umicat, {
    onPage: (page) => {
      // The point being talked about lights up for exactly as long as the
      // sentence about it is on screen — as a FOCUS, not as a mark.
      view.setFocus(page.at ?? null);
      chat.setEchoed(true);
      placeSpeech();
    },
    onDone: () => {
      view.setFocus(null);
      chat.setEchoed(false);
    },
    // The assistant names squares it is NOT suggesting — Black's reply, the
    // square a horse is heading for — so the offer to play one appears only
    // where the piece in hand could actually go, this turn.
    canPlay: (at) => !!selected && destinations.some((d) => d.x === at.x && d.y === at.y),
    onPlay: (at) => { if (selected) commit(selected, at); },
    // Answering from the box the answer arrived in, rather than opening the
    // log to type.
    onReply: (text) => void talk(text),
  });

  /** Confirm / cancel / ask, beside the piece rather than in a corner. */
  /** The two seats either side of the board — furniture, filled by `refresh()`. */
  const plates = new Plates();

  const actions = new PointActions({
    onConfirm: (at) => { if (selected) commit(selected, at); },
    onCancel: () => {
      view.setGhost(null);
      // Back to the piece in hand rather than all the way to nothing: they
      // changed their mind about the square, not about the piece.
      if (selected) { const at = selected; pickUp(at); actions.show(at, { ask: companion }); placeActions(); }
    },
    onAsk: (at) => askAbout(at),
  });

  /** And the question itself, in the same place. */
  const askHere = new AskHere(umicat, {
    onAsk: (point, text) => void talk(`${point}: ${text}`),
    onCancel: () => view.setFocus(null),
  });

  const audio = createAudio();
  // Fetch and decode ahead of the first gesture. Without it the very first
  // press of a session is silent, and that press is the title screen's own
  // button, which every player makes.
  void audio.preload();
  /** Which piece clip was used last, so the same one is never heard twice. */
  const lastClip = { i: -1 };

  // One listener for every button in the game. A click sound wired per button
  // is a click sound that is missing from the next button somebody adds.
  document.addEventListener('click', (e) => {
    const el = e.target as HTMLElement | null;
    if (el?.closest('button')) audio.play(SFX.uiPress);
  }, true);

  const opponent = new Opponent();
  const loading = opponent.ready();
  /** The engine's opinion, where the player can see it — see `evalbar.ts`. */
  const evalBar = new EvalBar();

  /** The end of a game, as a dialog. The status line is where "your move"
   *  lives; a result printed in the same place, in the same type, reads as
   *  one more turn rather than as the end of something. */
  const over = new GameOver({
    onAgain: () => void freshGame((coach.profile.handicap as Handicap) ?? 'none', companion),
    onTitle: () => void toTitle(),
  });

  /**
   * The board the seats are measured against, and the reason it is a variable
   * rather than a read of `game`: the render loop below runs from the very
   * first frame, long before `let game` exists, so anything it touches has to
   * be declared up here or it is a `ReferenceError` that takes the game down
   * at boot with a blank screen. Null means "no board yet, nothing to seat".
   */
  let seated: { cols: number; rows: number } | null = null;

  const frame = (): void => {
    if (performance.now() < repaintUntil) view.invalidate();
    // Only when the picture actually changed. Between two moves the board is a
    // still life, and redrawing it sixty times a second takes a core off the
    // engine — which is the thing the player is waiting for.
    if (view.render()) {
      if (speech.showing) placeSpeech();
      placeActions();
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

  let game: XiangqiGame | null = null;
  let level = levelById(saved.profile.level);
  /** The engine's read of the position the player is looking at. */
  let read: Read | null = null;
  let leadBeforePlayer: number | null = null;
  /** What the engine would have played instead, read before the player moved.
   *  Kept because by the time the move is judged the read has moved on. */
  let bestBeforePlayer: string[] = [];
  let thinking = false;
  let lastRemarkAt = -REMARK_COOLDOWN;
  /** The piece in hand, and where it may go. Two taps make a move: pick up,
   *  then choose — and then confirm, which is a third. On a phone a piece is
   *  about four millimetres wide and a move cannot be taken back. */
  let selected: Point | null = null;
  let destinations: Point[] = [];
  /** Points the assistant has rings on. The speech bubble keeps off them:
   *  "I've ringed it" printed over the ring is the assistant contradicting
   *  itself. */
  let shown: Point[] = [];
  /**
   * Whether this game has an assistant at all.
   *
   * ON for every new game, and only a player turning it off turns it off — it
   * is not a remembered preference, because "I did not want to be talked to
   * during that game" is not the same as "never talk to me". Off means no
   * calls to the platform's AI, no bubble, and no buttons that would open one.
   */
  let companion = true;

  // ── the assistant ───────────────────────────────────────────────────────
  const chat = new ChatPanel(umicat, {
    onSend: (text) => void talk(text),
    onLayout: (open) => {
      document.body.classList.toggle('chatting', open);
      view.reserveRight(open ? panelWidth() : 0);
      // Opening the panel means the player wants to read or type, not to be
      // tapped through a bubble that says the same thing.
      if (open) speech.hide();
    },
  });

  const coach = new Coach(umicat, {
    setLevel: (id) => { level = levelById(id); coach.profile.level = id; refresh(); persist(); return true; },
    startGame: (handicap) => {
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
      if (game && !game.over && game.moves.length > 0) return false;
      // A game nobody has moved in IS a new game. Starting another one throws
      // away the conversation that has just begun about this one.
      const h = (['none', 'horse', 'horses', 'chariot'] as Handicap[]).includes(handicap as Handicap)
        ? handicap as Handicap : 'none';
      if (game && !game.over && game.moves.length === 0 && h === game.handicap) return true;
      void freshGame(h);
      return true;
    },
    // Parsed HERE, against the board that is actually on screen.
    highlight: (points) => {
      const marks = parsePoints(points);
      shown = marks;
      view.setHighlights(marks);
      return marks.length;
    },
    // The assistant asks where a piece can go; the GAME works it out. A model
    // asked to list a horse's moves off a text board will answer confidently,
    // will forget one of its legs is blocked, and will be wrong — and being
    // right about that is the entire value of asking.
    showMoves: (point) => {
      const at = fromIccs(point);
      if (!game || !at) return null;
      const code = game.position.board[squareOf(at)];
      if (!code) return null;
      const targets = game.movesFrom(squareOf(at)).map(pointOf);
      // Only the player's own pieces have "moves" in the sense being asked
      // about; for Black's, the answer is what it THREATENS, which is a
      // different question and one the engine's read already covers.
      if (sideOf(code) !== game.toPlay) {
        return { piece: pieceName(sideOf(code), typeOf(code)), points: [] };
      }
      view.setHighlights(targets);
      shown = targets;
      return { piece: pieceName(sideOf(code), typeOf(code)), points: targets.map(nameOf) };
    },
    // And what is hanging. Same reason.
    showDanger: () => {
      if (!game) return null;
      const attacked = game.position.pieces()
        .filter((p) => p.side === HUMAN && game!.position.attacked(p.square, BLACK))
        .map((p) => ({ at: pointOf(p.square), name: pieceName(p.side, p.type) }));
      view.setHighlights(attacked.map((a) => a.at));
      shown = attacked.map((a) => a.at);
      return {
        points: attacked.map((a) => nameOf(a.at)),
        note: attacked.map((a) => `${a.name} on ${nameOf(a.at)}`).join(', '),
      };
    },
  });
  coach.load(saved.messages, saved.profile);
  // What they turned off last time stays off. Applied before the first gesture
  // so the music does not get a bar in before being silenced.
  if (coach.profile.music === false) audio.setMusicVolume(0);
  if (coach.profile.sound === false) audio.setSfxVolume(0);
  if (coach.profile.evalBar === false) evalBar.setEnabled(false);

  /** How many assistant lines have already been said out loud. Starts at the
   *  restored count: the conversation that came back is history, and history
   *  does not get spoken over the title screen. */
  let spoken = coach.messages.filter((m) => m.from === 'coach').length;

  const redrawChat = (): void => {
    chat.render(coach.messages, coach.thinking);
    const said = coach.messages.filter((m) => m.from === 'coach');
    if (said.length > spoken) {
      spoken = said.length;
      repaintSoon();
      // The reply has arrived, so the waiting dots beside the piece are done.
      askHere.hide();
      const latest = said[said.length - 1].text;
      // While the end-of-game dialog is up, the assistant talks INTO it: a
      // bubble behind that card is the assistant addressing a screen the
      // player cannot see.
      if (over.showing) over.note(stripAnchors(latest));
      else speech.show(segment(latest));
    }
  };

  // Anything the assistant does to the conversation — a message, a queued
  // question, starting or finishing a turn — redraws the panel itself.
  coach.onChange = () => redrawChat();
  // Draw what came back from the save, ONCE, now: the panel only redraws when
  // somebody speaks, and "Continue" is the one path where nobody does.
  redrawChat();

  async function talk(text: string): Promise<void> {
    if (!companion) return;
    await coach.ask(text, { game, read });
    persist();
  }

  /** An unprompted line. `note` is what just happened, in plain words; the
   *  assistant decides how, and whether, to react. */
  async function remark(note: string): Promise<void> {
    if (!game || !companion) return;
    lastRemarkAt = game.moves.length;
    await coach.remark(note, { game, read });
    persist();
  }

  /** Points as the assistant writes them ("e4,c3"), against the live board. */
  function parsePoints(points: string): Point[] {
    return points.split(',').map((p) => fromIccs(p)).filter((p): p is Point => !!p);
  }

  /**
   * The player pointing back.
   *
   * The assistant can point at the board; this is the other direction, and it
   * matters more than it looks. Asking about a piece by tapping it beats
   * working out that it is called h2 and typing that.
   */
  function askAbout(at: Point): void {
    if (!game) return;
    // Whatever it last said belonged to the last thing that happened. Leaving
    // it up puts two boxes over the board at once.
    speech.hide();
    view.setFocus(at);
    askHere.open(at, nameOf(at));
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
    const middle = view.screenOf(4, 4.5);
    put(middle.x, Math.max(middle.y, box.height + margin), null);
  }

  // ── the board ───────────────────────────────────────────────────────────
  const status = document.createElement('div');
  status.className = 'status';
  hud.appendChild(status);
  /** How to move a piece, until they have moved one — ever. */
  const tip = document.createElement('div');
  tip.className = 'tip';
  hud.appendChild(tip);

  /** Put the two seats against the board's own edges — measured from the grid
   *  plus a bit of the wooden margin, so it stays right at any board size and
   *  while the board reframes around an open panel. */
  function seatPlates(): void {
    if (!seated) return;
    const cx = Math.round((seated.cols - 1) / 2), cy = Math.round((seated.rows - 1) / 2);
    const edge = view.screenSpacing * 0.6;
    const l = view.screenOf(0, cy), r = view.screenOf(seated.cols - 1, cy);
    const t0 = view.screenOf(cx, 0), b0 = view.screenOf(cx, seated.rows - 1);
    // The edges are the min and the max, never the first and the second: on a
    // board that can be turned round (chess, when the student has Black)
    // column 0 is on the RIGHT, and taking it as the left edge puts both
    // seats inside the board, on top of the pieces.
    plates.place({
      left: Math.min(l.x, r.x) - edge,
      right: Math.max(l.x, r.x) + edge,
      top: Math.min(t0.y, b0.y) - edge,
      bottom: Math.max(t0.y, b0.y) + edge,
    });
  }

  /** Who is sitting where. The player is on the left, which is the side their
   *  own status line and gear are already on. */
  function fillPlates(): void {
    if (!game) { seated = null; plates.hide(); return; }
    seated = { cols: 9, rows: 10 };
    const me = umicat.user;
    const yours = !game.over && game.toPlay === HUMAN && !thinking;
    plates.set(
      {
        name: me?.name || t('plate.you'),
        avatar: me?.avatar ?? null,
        colour: HUMAN === RED ? 'white' : 'black',
        meta: t('plate.taken', { n: game.captured[HUMAN].length }),
        active: yours,
      },
      {
        name: t('plate.engine'),
        colour: HUMAN === RED ? 'black' : 'white',
        // How hard it is playing belongs to the opponent, not to a suffix on
        // "your move" in the player's own corner.
        meta: `${levelLabel(level.id)} · ${t('plate.taken', { n: game.captured[HUMAN === RED ? BLACK : RED].length })}`,
        thinking,
        active: !game.over && !yours,
      },
    );
    seatPlates();
  }

  function refresh(): void {
    fillPlates();
    if (game) view.sync(game);
    if (!game) { status.textContent = ''; tip.textContent = ''; return; }
    status.textContent = game.over ? describeOutcome(game) : thinking
      ? t('hud.blackThinking')
      : game.toPlay === HUMAN
        ? t(game.position.inCheck() ? 'hud.yourMoveCheck' : 'hud.yourMove', { level: levelLabel(level.id) })
        : t('hud.blackToPlay');
    const yours = !game.over && game.toPlay === HUMAN && !thinking;
    tip.textContent = yours && !coach.profile.moved ? t('hud.howToMove') : '';
    evalBar.show(game && !game.over ? read : null);
  }

  /** The result, for the dialog: a headline and one factual line under it. */
  function describeResult(g: XiangqiGame): { title: string; body: string; tone: 'win' | 'loss' | 'draw' } {
    const out = g.outcome();
    const moves = g.moves.length;
    const won = 'winner' in out && out.winner === HUMAN;
    const tone = out.kind === 'draw' ? 'draw' : won ? 'win' : 'loss';
    const title = t(out.kind === 'draw' ? 'over.draw' : won ? 'over.win' : 'over.loss');
    const body = out.kind === 'checkmate' ? t('over.mate', { moves })
      : out.kind === 'stalemate' ? t('over.stuck', { moves })
        : out.kind === 'perpetual' ? t('over.perpetual', { moves })
          : out.kind === 'resign' ? t(won ? 'over.theyResigned' : 'over.youResigned', { moves })
            : t('over.drawn', { moves });
    return { title, body, tone };
  }

  function describeOutcome(g: XiangqiGame): string {
    const out = g.outcome();
    const won = 'winner' in out && out.winner === HUMAN;
    switch (out.kind) {
      case 'checkmate': return t(won ? 'result.youWin' : 'result.youLose');
      case 'stalemate': return t(won ? 'result.youWinStuck' : 'result.youLoseStuck');
      case 'perpetual': return t(won ? 'result.youWinPerpetual' : 'result.youLosePerpetual');
      case 'resign': return t(won ? 'result.blackResigned' : 'result.youResigned');
      case 'draw': return t(out.why === 'quiet' ? 'result.drawQuiet' : 'result.drawRepetition');
      default: return '';
    }
  }

  function clearBoardMarks(): void {
    selected = null;
    destinations = [];
    shown = [];
    view.setSelection(null);
    view.setDestinations([]);
    view.setHighlights([]);
    view.setFocus(null);
    view.setGhost(null);
    actions.hide();
  }

  function newGame(handicap: Handicap): void {
    over.hide();
    game = new XiangqiGame(handicap);
    coach.profile.handicap = handicap;
    clearBoardMarks();
    askHere.hide();
    read = null;
    leadBeforePlayer = null;
    lastRemarkAt = -REMARK_COOLDOWN;
    refresh();
    persist();
    void observePosition();
  }

  /**
   * A new game is a new conversation.
   *
   * The old one is summarised into the assistant's running note first — that
   * is where the long memory lives — and then the thread is cleared, so the
   * next game does not open in the middle of the last one's argument about a
   * cannon that is no longer on the board.
   */
  async function freshGame(handicap: Handicap, withCompanion = true): Promise<void> {
    setCompanion(withCompanion);
    // **The board first.** Starting a new game used to wait for the
    // assistant to summarise the LAST one — a round trip to a language model
    // — so the player pressed "new game" and looked at an empty board until
    // a note about a finished game had been written. It read as the pieces
    // loading; nothing was loading. `newSession` now clears the conversation
    // in this same tick and writes its note behind us.
    newGame(handicap);
    spoken = 0;
    redrawChat();
    void coach.newSession();
    void remark(
      'A new game has just started and the student has the first move. One line: greet them if you '
      + 'have not yet, and name the one thing worth thinking about on the opening board. Do not recap '
      + 'the last game.',
    );
  }

  /** Read the position the player is about to move in — the baseline a blunder
   *  is measured against. */
  async function observePosition(): Promise<void> {
    if (!game || game.over) return;
    try {
      read = await opponent.read(game, 3, 500);
      leadBeforePlayer = read.score;
      bestBeforePlayer = read.candidates.slice(0, 2).map(moveName);
      refresh();
    } catch { /* a missing read costs commentary, not the game */ }
  }

  /**
   * Black's move — and the read it decided from, handed back.
   *
   * That read describes the position the PLAYER produced, which is the only
   * fair thing to judge their move against: an evaluation that moved because
   * of Black's reply is not their mistake. `observePosition` overwrites `read`
   * a moment later, so the caller has to be given it rather than look it up.
   * (Learned in Chess with me; the Go game measured the wrong position.)
   */
  async function engineTurn(): Promise<{ read: Read | null; event: string | null }> {
    if (!game || game.over || game.toPlay === HUMAN) return { read: null, event: null };
    thinking = true;
    refresh();
    let took = 0;
    let decidedFrom: Read | null = null;
    try {
      const out = await opponent.decide(game, level);
      read = out.read;
      decidedFrom = out.read;
      if (out.resign) game.resign(BLACK);
      else if (out.move) {
        const captured = game.play(out.move.from, out.move.to);
        // `play` refuses anything the rules refuse, including a move the
        // engine somehow proposed illegally. Silence would be the engine
        // skipping its turn, so it is worth saying out loud.
        if (captured === null) throw new Error(`engine proposed an illegal move ${nameOf(pointOf(out.move.from))}${nameOf(pointOf(out.move.to))}`);
        playStone(audio, lastClip);
        if (captured) { audio.play(SFX.capture); took = captured; }
      }
    } catch (err) {
      console.error('[xiangqi] engine failed', err);
      status.textContent = t('hud.engineStumbled');
    } finally {
      thinking = false;
      refresh();
      persist();
    }

    if (game.over) { void finish(); return { read: decidedFrom, event: null }; }
    // What happened, in plain words — said only if the player's own move does
    // not have a better claim on the one sentence going spare.
    const event = took
      ? `Black just took the student's ${pieceName(HUMAN, typeOf(took))}.`
      : game.position.inCheck()
        ? 'Black has just given check. The student has to deal with it.'
        : null;
    void observePosition();
    return { read: decidedFrom, event };
  }

  function commit(from: Point, to: Point): void {
    if (!game || thinking || game.over || game.toPlay !== HUMAN) return;
    const captured = game.play(squareOf(from), squareOf(to));
    if (captured === null) return;  // illegal: the board simply does not take it
    playStone(audio, lastClip);
    if (captured) audio.play(SFX.capture);
    coach.profile.moved = true;
    const played = `${nameOf(from)}${nameOf(to)}`;
    clearBoardMarks();
    askHere.hide();
    refresh();
    persist();

    void (async () => {
      if (game?.over) { void finish(); return; }
      const before = leadBeforePlayer;
      const instead = bestBeforePlayer.filter((m) => m !== played);
      const { read: after, event } = await engineTurn();
      const speakable = (): boolean => !!game && !game.over && game.moves.length - lastRemarkAt >= REMARK_COOLDOWN;
      // Both numbers are from the student's point of view — `opponent.read`
      // does that flip exactly once, so nothing here has to.
      if (!game || game.over || before === null || !after) return;
      const lost = before - after.score;
      // The blunder has first claim on the one sentence going spare. Only if
      // the move was fine does what the engine did get mentioned.
      if (lost < BLUNDER) { if (event && speakable()) void remark(event); return; }
      if (!speakable()) return;
      void remark(
        `The student played ${played}. By the engine's count that cost them `
        + `${(lost / 100).toFixed(1)} soldiers' worth of position (now `
        + `${(after.score / 100).toFixed(1)} from their point of view). `
        + (instead.length ? `It would rather have played ${instead.join(' or ')}.` : ''),
      );
    })();
  }

  /**
   * Put the confirm/cancel/ask cluster beside its square, off the squares the
   * player still has to be able to tap.
   *
   * Those are the legal destinations of the piece in hand and the piece
   * itself: a button standing on one of them is a move the player cannot
   * make, and on this board the squares around a piece ARE where it goes.
   */
  function placeActions(): void {
    const at = actions.at;
    if (!actions.showing || !at) return;
    const keep = [...destinations, ...(selected ? [selected] : [])]
      .filter((p) => p.x !== at.x || p.y !== at.y)
      .map((p) => view.screenOf(p.x, p.y));
    actions.place(view.screenOf(at.x, at.y), view.screenSpacing, keep);
  }

  /** Pick a piece up: it is selected, and everywhere it may go is dotted. */
  function pickUp(at: Point): void {
    if (!game) return;
    selected = at;
    destinations = game.movesFrom(squareOf(at)).map(pointOf);
    view.setSelection(at);
    view.setDestinations(destinations);
    view.setGhost(null);
    actions.hide();
  }

  /**
   * A square was chosen. Nothing is played yet — that is what the tick is for.
   *
   * Three taps for a move (piece, square, tick) rather than two, and it is the
   * right trade: a xiangqi move cannot be taken back, and a mis-tap that gives
   * away a chariot ends the game there and then. The ghost in between is also
   * what shows a beginner what the move actually DOES.
   */
  function select(at: Point | null): void {
    if (!at || !game || game.over) { clearBoardMarks(); return; }
    askHere.hide();
    const code = game.position.board[squareOf(at)];
    const mine = code && sideOf(code) === HUMAN;
    const yourTurn = !thinking && game.toPlay === HUMAN;

    // A destination for the piece in hand.
    if (selected && destinations.some((d) => d.x === at.x && d.y === at.y)) {
      const from = game.position.board[squareOf(selected)];
      // The dot under the ghost comes off: a dot drawn over the piece that is
      // about to stand there hides the one thing worth looking at.
      view.setDestinations(destinations.filter((d) => d.x !== at.x || d.y !== at.y));
      view.setGhost(at, sideOf(from), typeOf(from));
      actions.show(at, { confirm: true, cancel: true, ask: companion });
      placeActions();
      return;
    }

    // The piece already in hand: tapping it again puts it down. That is what
    // a cancel button would be for, which is why there is no cancel button at
    // this stage — one fewer button is one fewer square standing under one.
    if (selected && selected.x === at.x && selected.y === at.y) { clearBoardMarks(); return; }

    // One of your own, and it is your turn: pick it up.
    if (mine && yourTurn) {
      // A piece with nowhere to go is not a piece you have picked up — say so
      // with the refusal noise rather than with a selection that does nothing.
      const moves = game.movesFrom(squareOf(at));
      if (!moves.length) audio.play(SFX.denied);
      pickUp(at);
      // Asking about it is still worth a button.
      actions.show(at, { ask: companion });
      placeActions();
      return;
    }

    // Anything else — Black's piece, an empty square, the wrong moment — is
    // something to ask about and nothing else.
    clearBoardMarks();
    if (companion && (code || !yourTurn)) {
      view.setFocus(at);
      actions.show(at, { ask: true });
      placeActions();
    }
  }

  attachBoardControls(canvas, (x, y) => view.pick(x, y), {
    onAim: () => { /* no hover ghost: a piece is picked up, not hovered over */ },
    onPicked: select,
    // No camera handlers: the view is fixed. See POLAR_DEG in board3d.ts.
  });

  // ── the one button, and everything behind it ────────────────────────────
  const bar = document.createElement('div');
  bar.className = 'bar';
  hud.appendChild(bar);

  const menu = new Menu(
    { level: level.id, handicap: (coach.profile.handicap as Handicap) ?? 'none', companion: true },
    {
      onLevel: (id) => { level = levelById(id); coach.profile.level = id; refresh(); persist(); },
      onCompanion: (on) => setCompanion(on),
      onStart: ({ handicap, companion: withCompanion }) => void (async () => {
        // Started from the title, the board is still behind a title screen.
        leaveTitle();
        await underCurtain(t('title.loading'), loading);
        await freshGame(handicap, withCompanion);
      })(),
      onHint: () => void hint(),
      onResign: () => {
        if (!game || game.over) return;
        if (!window.confirm(t('confirm.resign'))) return;
        game.resign(HUMAN);
        refresh();
        persist();
        void finish();
      },
      onEval: (on) => { evalBar.setEnabled(on); coach.profile.evalBar = on; refresh(); persist(); },
      evalBar: () => evalBar.enabled,
      onMusic: (on) => { audio.setMusicVolume(on ? 0.22 : 0); coach.profile.music = on; persist(); },
      onSound: (on) => { audio.setSfxVolume(on ? 1 : 0); coach.profile.sound = on; persist(); },
      music: () => coach.profile.music !== false,
      sound: () => coach.profile.sound !== false,
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
  gear.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true">'
    + '<circle cx="12" cy="12" r="3.2"/>'
    + '<path d="M19.4 14.4a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-1.8-.3 1.6 1.6 0 0 0-1 1.5v.2a2 2 0 1 1-4 0v-.1a1.6 1.6 0 0 0-1-1.5 1.6 1.6 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0 .3-1.8 1.6 1.6 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.6 1.6 0 0 0 1.5-1 1.6 1.6 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 1.8.3H9a1.6 1.6 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 1 1.5 1.6 1.6 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-.3 1.8V9a1.6 1.6 0 0 0 1.5 1h.2a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1z"/>'
    + '</svg>';
  gear.title = t('btn.setup');
  gear.setAttribute('aria-label', t('btn.setup'));
  gear.onclick = () => {
    menu.sync({ level: level.id, companion }, !!game && !game.over);
    menu.toggle();
  };
  bar.appendChild(gear);

  /**
   * Show what the engine would play.
   *
   * Free, in the sense that matters: the engine runs on this machine, so a
   * hint costs a second of battery and nothing of the player's credits. The
   * assistant is not involved — if they want to know WHY, they can ask, and
   * that is the call worth paying for.
   */
  async function hint(): Promise<void> {
    if (!game || game.over || thinking || game.toPlay !== HUMAN) return;
    const was = status.textContent;
    status.textContent = t('hud.looking');
    try {
      const r = await opponent.read(game, 5, 2000);
      const best = r.candidates[0];
      if (!best) { status.textContent = was; return; }
      const from = pointOf(best.from), to = pointOf(best.to);
      view.setHighlights([from, to]);
      shown = [from, to];
      status.textContent = t('hud.engineWouldPlay', { move: `${nameOf(from)}→${nameOf(to)}` });
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

  /** The end of a game: show it, talk about it, remember it. */
  async function finish(): Promise<void> {
    if (!game?.over) return;
    coach.profile.gamesPlayed += 1;
    clearBoardMarks();
    evalBar.hide();
    refresh();
    persist();
    audio.play(SFX.gameOver);
    speech.hide();
    over.show(describeResult(game));

    const opening = openingName(game.movesIccs());
    await remark(
      `The game is over after ${game.moves.length} moves${opening ? `, from a ${opening}` : ''}. `
      + `${describeOutcome(game)} Say one thing worth remembering about it, and nothing else.`,
    );
    // Written last, when the game it is about is genuinely finished.
    await coach.summarise();
    persist();
  }

  // ── the way in, and back out ────────────────────────────────────────────
  /**
   * The title screen: continue, a new game, or forget me.
   *
   * Runs at boot and every time the player leaves a game, so it reads the
   * CURRENT state rather than the save it booted from.
   */
  async function toTitle(): Promise<void> {
    speech.hide();
    actions.hide();
    askHere.hide();
    menu.close();
    over.hide();
    chat.setOpen(false);
    await autosave.flush();

    evalBar.hide();
    document.body.classList.add('titling');
    const stored = await umicat.saves.get<ReturnType<XiangqiGame['snapshot']>>('game');
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
      // Not straight into a game: the opponent, the head start and whether
      // there is an assistant are chosen here. A new game always OFFERS the
      // assistant, whatever the last game did.
      menu.sync({ level: level.id, handicap: (coach.profile.handicap as Handicap) ?? 'none', companion: true }, false, true);
      menu.show();
      return;
    }

    leaveTitle();
    if (choice === 'continue') {
      if (game && !game.over) { refresh(); void observePosition(); return; }
      if (stored) {
        game = XiangqiGame.restore(stored);
        clearBoardMarks();
        refresh();
        void observePosition();
        // A game that was saved with Black to move — the tab closed while the
        // engine was thinking — would otherwise sit there forever.
        if (!game.over && game.toPlay !== HUMAN) void engineTurn();
        return;
      }
    }
    await freshGame((coach.profile.handicap as Handicap) ?? 'none');
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
  // through pixels: a test that has to click a four-millimetre piece is a test
  // of the test.
  Object.assign(window as unknown as Record<string, unknown>, {
    __game: {
      umicat, view, opponent, coach, chat, speech, menu, actions, askHere, audio, evalBar, over,
      get game() { return game; },
      get thinking() { return thinking; },
      get read() { return read; },
      get selected() { return selected; },
      level: () => level.id,
      setLevel: (id: string) => { level = levelById(id); refresh(); },
      levels: () => LEVELS.map((l) => l.id),
      /** "e2", or null to clear — the same thing a tap does. */
      select: (point: string | null) => select(point ? fromIccs(point) : null),
      /** "h2e2" — picks the piece up and plays it, rules permitting. */
      play: (move: string) => {
        const from = fromIccs(move.slice(0, 2)), to = fromIccs(move.slice(2, 4));
        if (from && to) commit(from, to);
      },
      moves: (point: string) => {
        const at = fromIccs(point);
        return at && game ? game.movesFrom(squareOf(at)).map((s) => nameOf(pointOf(s))) : [];
      },
      newGame: (handicap: Handicap = 'none') => void freshGame(handicap),
      say: (text: string) => talk(text),
      redraw: redrawChat,
      hint,
      finish,
      toTitle: () => toTitle(),
      flush: () => autosave.flush(),
      board: () => game?.position.diagram() ?? [],
      outcome: () => game?.outcome() ?? null,
    },
  });
}

/** How the chat panel is sized in CSS, in pixels, so the board can dodge it. */
const panelWidth = (): number => Math.min(380, window.innerWidth * 0.42) + 24;

void start().catch((err) => {
  const hud = document.getElementById('hud');
  if (hud) hud.textContent = `Failed to start: ${String(err)}`;
  console.error('[xiangqi] failed to start', err);
});
