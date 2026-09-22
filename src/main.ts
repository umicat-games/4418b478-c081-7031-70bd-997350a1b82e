// Gomoku with me — five in a row against a real engine, with an AI assistant
// beside the board. And the template every game in this family starts from.
//
// Two brains, deliberately separate:
//
//   the ENGINE (`src/game/engine.ts`) decides moves and reads the position.
//   It is an alpha-beta search over the same rules the player moves through,
//   running in a worker in this browser. Everything factual — who is better,
//   what the better move was — comes from here, because it is measured.
//
//   the ASSISTANT (`src/shell/coach.ts` + `src/game/assistant.ts`) talks. It
//   is the platform's runtime AI, handed the engine's numbers and the
//   referee's answers to talk ABOUT, and it can point at the board. It never
//   decides a move and it never puts a stone down.
//
// IF YOU HAVE JUST FORKED THIS: `src/shell/` is the half that is the same in
// every game and is not meant to be edited. This file, `src/game/`,
// `src/i18n.ts` and `public/playbooks/coach.md` are yours. `CLAUDE.md` says
// what each piece does and which of them will bite.
import { ThreeUmicat } from '@umicat/three-sdk';
import { BoardRig } from './shell/boardrig';
import { attachBoardControls } from './shell/controls';
import { Coach, type Profile } from './shell/coach';
import { ChatPanel } from './shell/chat';
import { Speech, segment, stripAnchors } from './shell/speech';
import { Menu, type SetupGroup } from './shell/menu';
import { PointActions } from './shell/pointactions';
import { AskHere } from './shell/askhere';
import { EvalBar } from './shell/evalbar';
import { GameOver } from './shell/gameover';
import { Plates } from './shell/plates';
import { showTitle } from './shell/title';
import { underCurtain } from './shell/curtain';
import { BLACK, Gomoku, SIZES, WHITE, type BoardSize, type Point } from './game/rules';
import { notation } from './game/coords';
import { Board } from './game/board';
import { LEVELS, Opponent, levelAbout, levelById, levelLabel, type Read } from './game/opponent';
import { gomokuAssistant, type Context } from './game/assistant';
import { Autosave, load } from './save';
import { SFX, createAudio, playStone } from './audio';
import { setLocale, t } from './i18n';
import { bootStep } from './shell/boot';

/** The player is Black: Black moves first, and the beginner should be the one
 *  who opens rather than the one who has to answer. */
const HUMAN = BLACK;

/** How much of the player's position has to evaporate on their own move — in
 *  the engine's own units, where an open three is about 12,000 — before the
 *  assistant mentions it unasked. */
const BLUNDER = 20_000;
/** Moves of quiet after an unprompted remark, so it is not a narrator. */
const REMARK_COOLDOWN = 3;

interface GameProfile extends Record<string, unknown> { boardSize: BoardSize }

const DEFAULTS: Profile<GameProfile> = {
  mode: 'unknown', level: 'steady', summary: '', gamesPlayed: 0, game: { boardSize: 15 },
};

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
  const rig = new BoardRig(canvas, { cols: 15, rows: 15 });
  const board = new Board(rig, 15);
  window.addEventListener('resize', () => rig.resize());

  // ── things the render loop touches ──────────────────────────────────────
  // Declared before it starts. The loop runs from the first frame, long before
  // the rest of this function exists, and a `const` it reads too early is a
  // ReferenceError that takes the whole game down at boot with a blank screen.
  // This has happened twice in this family of games.
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
      // The cell being talked about lights up for exactly as long as the
      // sentence about it is on screen — as a FOCUS, not as a mark. Sharing
      // one list with the assistant's own marks meant a sentence with no
      // coordinate in it cleared the rings it had just drawn.
      rig.setFocus(page.at ?? null);
      chat.setEchoed(true);
      placeSpeech();
    },
    onDone: () => {
      rig.setFocus(null);
      chat.setEchoed(false);
    },
    // It names cells it is NOT suggesting — where White would answer, where
    // the threat runs — so the offer to play one appears only where a stone
    // could actually go, this turn.
    canPlay: (at) => !!game && !game.over && !thinking && game.toPlay === HUMAN && game.legal(game.idx(at.x, at.y)),
    onPlay: (at) => commit(at),
    // Answering from the box the answer arrived in, rather than opening the
    // log to type.
    onReply: (text) => void talk(text),
  });
  speech.notation = notation(15);

  /** Confirm / cancel / ask, beside the stone rather than in a corner. */
  /** The two seats either side of the board — furniture, filled by `refresh()`. */
  const plates = new Plates();

  const actions = new PointActions({
    onConfirm: (at) => commit(at),
    onCancel: () => { chosen = null; board.setGhost(null); },
    onAsk: (at) => askAbout(at),
  });

  /** And the question itself, in the same place. */
  const askHere = new AskHere(umicat, {
    onAsk: (point, text) => void talk(`${point}: ${text}`),
    onCancel: () => rig.setFocus(null),
  });

  const audio = createAudio();
  // Fetch and decode ahead of the first gesture. Without it the very first
  // press of a session is silent, and that press is the title screen's own
  // button, which every player makes.
  void audio.preload();
  /** Which stone clip was used last, so the same one is never heard twice. */
  const lastClip = { i: -1 };

  // One listener for every button in the game. A click sound wired per button
  // is a click sound missing from the next button somebody adds.
  document.addEventListener('click', (e) => {
    const el = e.target as HTMLElement | null;
    if (el?.closest('button')) audio.play(SFX.uiPress);
  }, true);

  const opponent = new Opponent();
  const loading = opponent.ready();
  /** The engine's opinion, where the player can see it. */
  const evalBar = new EvalBar();

  /** The end of a game, as a dialog. The status line is where "your move"
   *  lives; a result in the same place, in the same type, reads as one more
   *  turn rather than as the end of something. */
  const over = new GameOver({
    onAgain: () => void freshGame(nextSize, companion),
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
    if (performance.now() < repaintUntil) rig.invalidate();
    // Only when the picture actually changed. Between two moves the board is
    // a still life, and redrawing it sixty times a second takes a core off
    // the engine — which is the thing the player is waiting for.
    if (rig.render()) {
      if (speech.showing) placeSpeech();
      placeActions();
      if (askHere.showing && askHere.at) askHere.place(rig.screenOf(askHere.at.x, askHere.at.y), rig.screenSpacing);
      seatPlates();
    }
    requestAnimationFrame(frame);
  };
  frame();

  // ── state ───────────────────────────────────────────────────────────────
  const saved = await load(umicat, DEFAULTS as Profile);
  bootStep('saved');
  const autosave = new Autosave(umicat);

  let game: Gomoku | null = null;
  let level = levelById(saved.profile.level);
  /** The engine's read of the position the player is looking at. */
  let read: Read | null = null;
  let leadBefore: number | null = null;
  /** What the engine would have played, read before the player moved. */
  let bestBefore: string[] = [];
  /** Cells where the player could have made five, before they moved. */
  let winBefore: number[] = [];
  let thinking = false;
  let lastRemarkAt = -REMARK_COOLDOWN;
  /** The cell the player has aimed at but not committed to. */
  let chosen: Point | null = null;
  /** Cells the assistant has rings on. The speech bubble keeps off them:
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
  /** Staged in the new-game panel; applies to the next game. */
  let nextSize: BoardSize = ((saved.profile.game as GameProfile)?.boardSize ?? 15) as BoardSize;

  // ── the assistant ───────────────────────────────────────────────────────
  const chat = new ChatPanel(umicat, {
    onSend: (text) => void talk(text),
    onLayout: (open) => {
      document.body.classList.toggle('chatting', open);
      rig.reserveRight(open ? panelWidth() : 0);
      // Opening the panel means the player wants to read or type, not to be
      // tapped through a bubble that says the same thing.
      if (open) speech.hide();
    },
  });

  const coach = new Coach<Context>(umicat, gomokuAssistant({
    setBoardSize: (size) => {
      if (game && !game.over && game.moves.length > 0) return false;
      nextSize = size as BoardSize;
      void freshGame(nextSize);
      return true;
    },
    setLevel: (id) => { level = levelById(id); coach.profile.level = id; refresh(); persist(); return true; },
    startGame: () => {
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
      if (game && !game.over && game.moves.length === 0) return true;
      void freshGame(nextSize);
      return true;
    },
    // Parsed HERE, against the board that is actually on screen.
    highlight: (points) => {
      const marks = parsePoints(points);
      shown = marks;
      rig.setHighlights(marks);
      return marks.length;
    },
    // The referee works these out; see `threats()` in rules.ts for why a
    // model must not be asked to.
    showThreats: () => {
      if (!game) return null;
      const mine = game.threats(HUMAN);
      const theirs = game.threats(WHITE);
      const marks = [...mine.win, ...mine.openFour, ...mine.openThree, ...theirs.win, ...theirs.openFour]
        .map((i) => point(i));
      shown = marks;
      rig.setHighlights(marks);
      return { mine: describeThreats(mine), theirs: describeThreats(theirs) };
    },
  }), DEFAULTS as Profile);

  coach.load(saved.messages, saved.profile);
  // What they turned off last time stays off. Applied before the first
  // gesture so the music does not get a bar in before being silenced.
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
      // The reply has arrived, so the waiting dots beside the stone are done.
      askHere.hide();
      const latest = said[said.length - 1].text;
      // While the end-of-game dialog is up, the assistant talks INTO it: a
      // speech bubble behind that card is the assistant addressing a screen
      // the player cannot see.
      if (over.showing) over.note(stripAnchors(latest));
      else speech.show(segment(latest, speech.notation));
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

  const point = (i: number): Point => ({ x: game!.xOf(i), y: game!.yOf(i) });
  const nameOf = (i: number): string => speech.notation.format(point(i));

  /** A side's threats, in the game's words rather than the model's. */
  function describeThreats(th: { win: number[]; openFour: number[]; openThree: number[] }): string {
    const bits: string[] = [];
    const list = (cells: number[]): string => cells.slice(0, 6).map(nameOf).join('、');
    if (th.win.length) bits.push(t('threat.win', { points: list(th.win) }));
    if (th.openFour.length) bits.push(t('threat.openFour', { points: list(th.openFour) }));
    if (th.openThree.length) bits.push(t('threat.openThree', { points: list(th.openThree) }));
    return bits.length ? bits.join('、') : t('threat.none');
  }

  /** Points as the assistant writes them ("H8,J10"), against the live board. */
  function parsePoints(points: string): Point[] {
    return points.split(',').map((p) => speech.notation.parse(p)).filter((p): p is Point => !!p);
  }

  /**
   * The player pointing back.
   *
   * The assistant can point at the board; this is the other direction, and it
   * matters more than it looks. Asking about a point by tapping it beats
   * working out that it is called H8 and typing that.
   */
  function askAbout(at: Point): void {
    if (!game) return;
    // Whatever it last said belonged to the last thing that happened. Leaving
    // it up puts two boxes over the board at once.
    speech.hide();
    rig.setFocus(at);
    askHere.open(at, speech.notation.format(at));
    askHere.place(rig.screenOf(at.x, at.y), rig.screenSpacing);
  }

  /**
   * Put the confirm/cancel/ask cluster beside its cell, off the cells the
   * player still has to be able to tap.
   *
   * A button standing on a cell is a cell that cannot be tapped — and on a
   * board of intersections, the cells around the one in hand are exactly
   * where the player might mean instead.
   */
  function placeActions(): void {
    const at = actions.at;
    if (!actions.showing || !at) return;
    const keep: Point[] = [];
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const p = { x: at.x + dx, y: at.y + dy };
        if (p.x >= 0 && p.y >= 0 && p.x < rig.cols && p.y < rig.rows) keep.push(p);
      }
    }
    actions.place(rig.screenOf(at.x, at.y), rig.screenSpacing, keep.map((p) => rig.screenOf(p.x, p.y)));
  }

  /** Put the bubble where its sentence belongs. Runs every frame while it is
   *  up, because the camera can move under it. */
  function placeSpeech(): void {
    const page = speech.current;
    if (!page) return;
    const box = speech.rect();
    const margin = 10;
    const free = window.innerWidth - (chat.isOpen ? panelWidth() : 0);

    if (page.at) {
      const p = rig.screenOf(page.at.x, page.at.y);
      const gap = rig.screenSpacing * 0.7 + 12;
      const x = Math.min(Math.max(p.x, box.width / 2 + margin), free - box.width / 2 - margin);
      const top = p.y - gap;
      // Above unless there is no room, and then below — but if the side it
      // would take is sitting on a ring it has just drawn, take the other one.
      const above = { top: top - box.height, bottom: top };
      const below = { top: p.y + gap, bottom: p.y + gap + box.height };
      const fits = (r: { top: number; bottom: number }): boolean => r.top >= margin;
      const covers = (r: { top: number; bottom: number }): number => shown.filter((mark) => {
        const s = rig.screenOf(mark.x, mark.y);
        return s.x > x - box.width / 2 - 8 && s.x < x + box.width / 2 + 8 && s.y > r.top - 8 && s.y < r.bottom + 8;
      }).length;
      const useAbove = fits(above) && (covers(above) <= covers(below) || !fits(below));
      if (useAbove) speech.place(x, top, Math.abs(x - p.x) < 2);
      else speech.place(x, below.bottom, false);
      return;
    }
    // Nothing to point at: the middle of the board, because this is someone
    // talking about the game in front of you, not a notification.
    const middle = rig.screenOf((rig.cols - 1) / 2, (rig.rows - 1) / 2);
    const x = Math.min(Math.max(middle.x, box.width / 2 + margin), free - box.width / 2 - margin);
    speech.place(x, Math.max(middle.y, box.height + margin), false);
  }

  // ── the board ───────────────────────────────────────────────────────────
  const status = document.createElement('div');
  hud.appendChild(status);
  /** How to place a stone, until they have placed one — ever. */
  const tip = document.createElement('div');
  tip.className = 'tip';
  hud.appendChild(tip);

  /** Put the two seats against the board's own edges — measured from the grid
   *  plus a bit of the wooden margin, so it stays right at any board size and
   *  while the board reframes around an open panel. */
  function seatPlates(): void {
    if (!seated) return;
    const cx = Math.round((seated.cols - 1) / 2), cy = Math.round((seated.rows - 1) / 2);
    const edge = rig.screenSpacing * 0.6;
    const l = rig.screenOf(0, cy), r = rig.screenOf(seated.cols - 1, cy);
    const t0 = rig.screenOf(cx, 0), b0 = rig.screenOf(cx, seated.rows - 1);
    plates.place({ left: l.x - edge, right: r.x + edge, top: t0.y - edge, bottom: b0.y + edge });
  }

  /** Who is sitting where. The player is on the left, which is the side their
   *  own status line and gear are already on. */
  function fillPlates(): void {
    if (!game) { seated = null; plates.hide(); return; }
    seated = { cols: rig.cols, rows: rig.rows };
    const me = umicat.user;
    const yours = !game.over && game.toPlay === HUMAN && !thinking;
    plates.set(
      {
        name: me?.name || t('plate.you'),
        avatar: me?.avatar ?? null,
        colour: 'black',
        meta: t('plate.moves', { n: game.moves.length }),
        active: yours,
      },
      {
        name: t('plate.engine'),
        colour: 'white',
        meta: thinking ? t('plate.thinking') : levelLabel(level.id),
        active: !game.over && !yours,
      },
    );
    seatPlates();
  }

  function refresh(): void {
    fillPlates();
    if (game) board.sync(game);
    if (!game) { status.textContent = ''; tip.textContent = ''; evalBar.hide(); return; }
    status.textContent = game.over ? describeOutcome(game) : thinking
      ? t('hud.thinking')
      : game.toPlay === HUMAN ? t('hud.yourMove', { level: levelLabel(level.id) }) : t('hud.theirMove');
    const yours = !game.over && game.toPlay === HUMAN && !thinking;
    tip.textContent = yours && !coach.profile.placed ? t('hud.howToPlace') : '';
    evalBar.show(game.over || !read ? null : {
      // The engine's units are shapes, not points. A logistic curve turns
      // them into a share of the bar; the number itself would be noise.
      share: 1 / (1 + Math.exp(-read.score / 20_000)),
      label: read.decided === 1 ? t('eval.won') : read.decided === -1 ? t('eval.lost') : '',
    });
  }

  /**
   * The result, for the dialog: a headline, and one factual line under it.
   *
   * The facts come from the referee — which stone made five, on which move —
   * because "you won" and "you lost" are the two sentences a player is most
   * likely to want a reason for, and a reason the game can prove is worth
   * more than a reason the assistant can phrase.
   */
  function describeResult(g: Gomoku): { title: string; body: string; tone: 'win' | 'loss' | 'draw' } {
    const out = g.outcome();
    const moves = g.moves.length;
    const won = 'winner' in out && out.winner === HUMAN;
    if (out.kind === 'draw') {
      return { title: t('over.draw'), body: t('over.drawFull', { moves }), tone: 'draw' };
    }
    if (out.kind === 'resign') {
      return {
        title: t(won ? 'over.win' : 'over.loss'),
        body: t(won ? 'over.theyResigned' : 'over.youResigned', { moves }),
        tone: won ? 'win' : 'loss',
      };
    }
    const last = g.last;
    const point = last !== null ? nameOf(last) : '';
    return {
      title: t(won ? 'over.win' : 'over.loss'),
      body: t(won ? 'over.fiveYou' : 'over.fiveThem', { point, moves }),
      tone: won ? 'win' : 'loss',
    };
  }

  function describeOutcome(g: Gomoku): string {
    const out = g.outcome();
    const won = 'winner' in out && out.winner === HUMAN;
    switch (out.kind) {
      case 'win': return t(won ? 'result.youWin' : 'result.youLose');
      case 'resign': return t(won ? 'result.theyResigned' : 'result.youResigned');
      case 'draw': return t('result.draw');
      default: return '';
    }
  }

  function clearMarks(): void {
    chosen = null;
    shown = [];
    rig.setHighlights([]);
    rig.setFocus(null);
    rig.setSelection(null);
    board.setGhost(null);
    actions.hide();
  }

  function newGame(size: BoardSize): void {
    over.hide();
    game = new Gomoku(size);
    (coach.profile.game as GameProfile).boardSize = size;
    speech.notation = notation(size);
    board.build(size);
    clearMarks();
    askHere.hide();
    read = null;
    leadBefore = null;
    winBefore = [];
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
   * shape that is no longer on the board.
   */
  async function freshGame(size: BoardSize, withCompanion = true): Promise<void> {
    setCompanion(withCompanion);
    await coach.newSession();
    spoken = 0;
    redrawChat();
    newGame(size);
    void remark(
      'A new game has just started and the student has the first move, playing Black. One line: greet '
      + 'them if you have not yet, and say the one thing worth knowing about the opening. Do not recap '
      + 'the last game.',
    );
  }

  /** Read the position the player is about to move in — the baseline a
   *  blunder is measured against, and what the eval bar shows. */
  async function observePosition(): Promise<void> {
    if (!game || game.over) return;
    try {
      read = await opponent.read(game, 4, 8, 500);
      leadBefore = read.score;
      bestBefore = read.candidates.slice(0, 2).map((c) => nameOf(c.move));
      winBefore = game.threats(HUMAN).win;
      refresh();
    } catch { /* a missing read costs commentary, not the game */ }
  }

  /**
   * White's move — and the read it decided from, handed back.
   *
   * That read describes the position the PLAYER produced, which is the only
   * fair thing to judge their move against: an evaluation that moved because
   * of White's reply is not their mistake. `observePosition` overwrites
   * `read` a moment later, so the caller has to be given it.
   */
  async function engineTurn(): Promise<Read | null> {
    if (!game || game.over || game.toPlay === HUMAN) return null;
    thinking = true;
    refresh();
    let decidedFrom: Read | null = null;
    try {
      const out = await opponent.decide(game, level);
      read = out.read;
      decidedFrom = out.read;
      if (out.move !== null) {
        // `play` refuses anything the rules refuse. Silence would be the
        // engine skipping its turn, so it is worth saying out loud.
        if (!game.play(out.move)) throw new Error(`engine proposed an illegal move ${out.move}`);
        playStone(audio, lastClip);
      }
    } catch (err) {
      console.error('[gomoku] engine failed', err);
      status.textContent = t('hud.engineStumbled');
    } finally {
      thinking = false;
      refresh();
      persist();
    }
    if (game.over) void finish();
    else void observePosition();
    return decidedFrom;
  }

  function commit(at: Point): void {
    if (!game || thinking || game.over || game.toPlay !== HUMAN) return;
    const i = game.idx(at.x, at.y);
    const missedWin = winBefore.filter((c) => c !== i);
    const hadWin = winBefore.length > 0;
    if (!game.play(i)) return;  // illegal: the board simply does not take it
    playStone(audio, lastClip);
    coach.profile.placed = true;
    const played = nameOf(i);
    clearMarks();
    askHere.hide();
    refresh();
    persist();

    void (async () => {
      if (game?.over) { void finish(); return; }
      const before = leadBefore;
      const instead = bestBefore.filter((m) => m !== played);
      // What the referee knows about the position they just made, before the
      // engine answers it. Facts first: "they can make five next move" beats
      // any number as something to say.
      const theirWin = game ? game.threats(WHITE).win : [];
      const after = await engineTurn();
      const speakable = (): boolean => !!game && !game.over && game.moves.length - lastRemarkAt >= REMARK_COOLDOWN;
      if (!game || !speakable()) return;

      if (hadWin && missedWin.length) {
        void remark(`The student had five available at ${missedWin.map(nameOf).join(' or ')} and played ${played} instead.`);
        return;
      }
      if (theirWin.length) {
        void remark(`After ${played}, White can make five at ${theirWin.map(nameOf).join(' or ')} — the student did not block it.`);
        return;
      }
      if (game.over || before === null || !after) return;
      const lost = before - after.score;
      if (lost < BLUNDER) return;
      void remark(
        `The student played ${played}, and by the engine's count that lost a lot of ground. `
        + (instead.length ? `It would rather have played ${instead.join(' or ')}.` : ''),
      );
    })();
  }

  /** A point was chosen. Nothing is played yet — that is what the tick is
   *  for. One tap to aim, one to confirm: a stone cannot be taken back, and
   *  an intersection is a few millimetres wide on a phone. */
  function select(at: Point | null): void {
    if (!at || !game) { clearMarks(); return; }
    askHere.hide();
    const i = game.idx(at.x, at.y);
    const yours = !game.over && !thinking && game.toPlay === HUMAN;
    const canPlace = yours && game.legal(i);

    // Tapping the aimed-at point again puts the stone down there — the same
    // as the tick, for a player who does not notice the tick.
    if (chosen && chosen.x === at.x && chosen.y === at.y && canPlace) { commit(at); return; }

    if (canPlace) {
      chosen = at;
      rig.setSelection(at);
      board.setGhost(at, HUMAN);
      actions.show(at, { confirm: true, cancel: true, ask: companion });
      placeActions();
      return;
    }

    // An occupied point, or not your turn. Nothing to place; still worth
    // asking about.
    clearMarks();
    if (companion) {
      rig.setFocus(at);
      actions.show(at, { ask: true });
      placeActions();
    }
  }

  attachBoardControls(canvas, (x, y) => rig.pick(x, y), {
    onAim: () => { /* the ghost belongs to the chosen point, not to the cursor */ },
    onPicked: select,
    // No camera handlers: the view is fixed. See the tilt note in boardrig.ts.
  });

  // ── the one button, and everything behind it ────────────────────────────
  const bar = document.createElement('div');
  bar.className = 'bar';
  hud.appendChild(bar);

  const sizeGroup = (): SetupGroup => ({
    label: t('menu.board'),
    options: SIZES.map((s) => ({ id: String(s), label: `${s}×${s}` })),
    value: String(nextSize),
    pick: (id) => { nextSize = Number(id) as BoardSize; },
  });

  const menu = new Menu(
    { level: level.id, companion: true },
    {
      levels: LEVELS.map((l) => ({ id: l.id, label: levelLabel(l.id), about: levelAbout(l.id) })),
      groups: () => [sizeGroup()],
      onLevel: (id) => { level = levelById(id); coach.profile.level = id; refresh(); persist(); },
      onCompanion: (on) => setCompanion(on),
      onStart: ({ companion: withCompanion }) => void (async () => {
        // Started from the title, the board is still behind a title screen.
        leaveTitle();
        await underCurtain(t('title.loading'), loading);
        await freshGame(nextSize, withCompanion);
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
      onMusic: (on) => { audio.setMusicVolume(on ? 0.22 : 0); coach.profile.music = on; persist(); },
      onSound: (on) => { audio.setSfxVolume(on ? 1 : 0); coach.profile.sound = on; persist(); },
      onEval: (on) => { evalBar.setEnabled(on); coach.profile.evalBar = on; refresh(); persist(); },
      music: () => coach.profile.music !== false,
      sound: () => coach.profile.sound !== false,
      evalBar: () => evalBar.enabled,
      onTitle: () => void toTitle(),
      // Dismissed from the title screen, where there is no board behind it.
      onClose: () => { if (!game) void toTitle(); },
    },
  );

  /** The way into the log. Same icon as the one beside a stone, because it
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
      const r = await opponent.read(game, 6, 10, 2000);
      const best = r.candidates[0];
      if (!best) { status.textContent = was; return; }
      const at = point(best.move);
      rig.setHighlights([at]);
      shown = [at];
      status.textContent = t('hud.engineWouldPlay', { point: nameOf(best.move) });
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
    clearMarks();
    evalBar.hide();
    refresh();
    persist();
    audio.play(SFX.gameOver);
    // The board keeps the winning line lit underneath; the dialog can be
    // closed to look at it.
    speech.hide();
    over.show(describeResult(game));

    await remark(`The game is over after ${game.moves.length} moves. ${describeOutcome(game)} `
      + 'Say one thing worth remembering about it, and nothing else.');
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
    evalBar.hide();
    await autosave.flush();

    document.body.classList.add('titling');
    const stored = await umicat.saves.get<ReturnType<Gomoku['snapshot']>>('game');
    const choice = await showTitle({
      canContinue: (!!game && !game.over) || !!stored,
      returning: saved.returning || coach.profile.gamesPlayed > 0 || coach.messages.length > 0,
      loading,
    });

    if (choice === 'forget') {
      await Promise.all([
        umicat.saves.delete('profile'), umicat.saves.delete('chat'), umicat.saves.delete('game'),
      ]);
      coach.load([], { ...coach.profile, summary: '', gamesPlayed: 0, mode: 'unknown', placed: false });
      spoken = 0;
      redrawChat();
      await toTitle();
      return;
    }

    if (choice === 'new') {
      // Not straight into a game: the board, the opponent and whether there
      // is an assistant are chosen here. A new game always OFFERS the
      // assistant, whatever the last game did.
      menu.sync({ level: level.id, companion: true }, false, true);
      menu.show();
      return;
    }

    leaveTitle();
    if (choice === 'continue') {
      if (game && !game.over) { refresh(); void observePosition(); return; }
      if (stored) {
        game = Gomoku.restore(stored);
        nextSize = game.size as BoardSize;
        speech.notation = notation(game.size);
        board.build(game.size);
        clearMarks();
        refresh();
        void observePosition();
        // A game saved with White to move — the tab closed while the engine
        // was thinking — would otherwise sit there forever.
        if (!game.over && game.toPlay !== HUMAN) void engineTurn();
        return;
      }
    }
    await freshGame(nextSize);
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
  // through pixels: a test that has to click a four-millimetre intersection is
  // a test of the test.
  Object.assign(window as unknown as Record<string, unknown>, {
    __game: {
      umicat, rig, board, opponent, coach, chat, speech, menu, actions, askHere, audio, evalBar, over,
      get game() { return game; },
      get thinking() { return thinking; },
      get read() { return read; },
      get chosen() { return chosen; },
      get companion() { return companion; },
      level: () => level.id,
      setLevel: (id: string) => { level = levelById(id); refresh(); },
      levels: () => LEVELS.map((l) => l.id),
      /** "H8", or null to clear — the same thing a tap does. */
      select: (p: string | null) => select(p ? speech.notation.parse(p) : null),
      /** "H8" — aims and confirms in one, for a probe that is testing the
       *  game rather than the buttons. */
      play: (p: string) => { const at = speech.notation.parse(p); if (at) commit(at); },
      name: (i: number) => nameOf(i),
      newGame: (size: BoardSize = nextSize) => void freshGame(size),
      say: (text: string) => talk(text),
      redraw: redrawChat,
      hint,
      finish,
      toTitle: () => toTitle(),
      flush: () => autosave.flush(),
      board3d: board,
      diagram: () => game?.diagram() ?? [],
      outcome: () => game?.outcome() ?? null,
    },
  });
}

/** How the chat panel is sized in CSS, in pixels, so the board can dodge it. */
const panelWidth = (): number => Math.min(380, window.innerWidth * 0.42) + 24;

void start().catch((err) => {
  const hud = document.getElementById('hud');
  if (hud) hud.textContent = `Failed to start: ${String(err)}`;
  console.error('[gomoku] failed to start', err);
});
