// Othello with me — a game of Othello against a real engine, with an AI
// assistant beside the board.
//
// Two brains, deliberately separate:
//
//   the ENGINE (`src/game/engine.ts`) decides moves and reads the position.
//   It is an alpha-beta search over the same rules the player moves through,
//   running in a worker in this browser — and for the last dozen squares it
//   stops estimating and plays the game out EXACTLY, which is the one moment
//   in this family of games where "who wins" stops being an opinion.
//
//   the ASSISTANT (`src/shell/coach.ts` + `src/game/assistant.ts`) talks. It
//   never decides a move and it never puts a disc down.
//
// What is particular to Othello, and shapes this file:
//
//   THE LEGAL MOVES ARE SHOWN, always. On a board where every move must flip
//   something, "where may I play" is not a question a beginner can answer by
//   looking, and a game that makes them guess is a game they stop playing.
//
//   THE PASS IS AUTOMATIC, and therefore has to be SAID. The rules skip a
//   player with no move; if the game does not tell them, the board simply
//   moves twice and looks broken.
import { ThreeUmicat } from '@umicat/three-sdk';
import { BoardRig } from './shell/boardrig';
import { attachBoardControls } from './shell/controls';
import { Coach, type Profile } from './shell/coach';
import { ChatPanel } from './shell/chat';
import { Speech, segment, stripAnchors } from './shell/speech';
import { Menu } from './shell/menu';
import { PointActions } from './shell/pointactions';
import { AskHere } from './shell/askhere';
import { EvalBar } from './shell/evalbar';
import { GameOver } from './shell/gameover';
import { showTitle } from './shell/title';
import { underCurtain } from './shell/curtain';
import { bootStep } from './shell/boot';
import { BLACK, Othello, SIZE, WHITE, type Player, type Point } from './game/rules';
import { notation } from './game/coords';
import { Board } from './game/board';
import { LEVELS, Opponent, levelAbout, levelById, levelLabel, type Read } from './game/opponent';
import { othelloAssistant, type Context } from './game/assistant';
import { Autosave, load } from './save';
import { SFX, createAudio, playStone } from './audio';
import { setLocale, t } from './i18n';

/** The player is Black: Black moves first, and the beginner should be the one
 *  who opens rather than the one who has to answer. */
const HUMAN: Player = BLACK;

/** How much of the player's position has to evaporate on their own move
 *  before the assistant mentions it unasked, in the engine's own units. */
const BLUNDER = 500;
/** Moves of quiet after an unprompted remark, so it is not a narrator. */
const REMARK_COOLDOWN = 4;

const CORNERS = [0, 7, 56, 63];
/** The square diagonally inside each corner, and the corner it gives away.
 *  Playing one while the corner is still empty is the mistake that decides
 *  most beginners' games, and it is a FACT about the board rather than an
 *  opinion about the position — which is why the game can say it. */
const X_SQUARES: Record<number, number> = { 9: 0, 14: 7, 49: 56, 54: 63 };

async function start(): Promise<void> {
  bootStep('bundle');
  const umicat = await ThreeUmicat.init();
  bootStep('platform');
  setLocale(umicat.locale);

  const canvas = document.getElementById('game') as HTMLCanvasElement;
  const hud = document.getElementById('hud')!;
  const rig = new BoardRig(canvas, { cols: SIZE, rows: SIZE, margin: 0.5 });
  const board = new Board(rig);
  window.addEventListener('resize', () => rig.resize());

  // ── things the render loop touches ──────────────────────────────────────
  // Declared before it starts: the loop runs from the first frame, long
  // before the rest of this function exists.
  let repaintUntil = 0;
  const repaintSoon = (): void => { repaintUntil = performance.now() + 250; };
  for (const type of ['pointerdown', 'pointerup', 'click', 'keydown'] as const) {
    document.addEventListener(type, repaintSoon, true);
  }

  const speech = new Speech(umicat, {
    onPage: (page) => {
      rig.setFocus(page.at ?? null);
      chat.setEchoed(true);
      placeSpeech();
    },
    onDone: () => {
      rig.setFocus(null);
      chat.setEchoed(false);
    },
    canPlay: (at) => !!game && !game.over && !thinking && game.toPlay === HUMAN && game.legal(game.idx(at.x, at.y)),
    onPlay: (at) => commit(at),
    onReply: (text) => void talk(text),
  });
  speech.notation = notation();

  const actions = new PointActions({
    onConfirm: (at) => commit(at),
    onCancel: () => { chosen = null; board.setGhost(null); showLegal(); },
    onAsk: (at) => askAbout(at),
  });

  const askHere = new AskHere(umicat, {
    onAsk: (point, text) => void talk(`${point}: ${text}`),
    onCancel: () => rig.setFocus(null),
  });

  const audio = createAudio();
  void audio.preload();
  const lastClip = { i: -1 };

  document.addEventListener('click', (e) => {
    const el = e.target as HTMLElement | null;
    if (el?.closest('button')) audio.play(SFX.uiPress);
  }, true);

  const opponent = new Opponent();
  const loading = opponent.ready();
  const evalBar = new EvalBar();

  const over = new GameOver({
    onAgain: () => void freshGame(companion),
    onTitle: () => void toTitle(),
  });

  const frame = (): void => {
    if (performance.now() < repaintUntil) rig.invalidate();
    // The discs turning over are the one thing on this board that moves of
    // its own accord; while they do, the still-life rule is suspended.
    board.animate();
    if (rig.render()) {
      if (speech.showing) placeSpeech();
      placeActions();
      if (askHere.showing && askHere.at) askHere.place(rig.screenOf(askHere.at.x, askHere.at.y), rig.screenSpacing);
    }
    requestAnimationFrame(frame);
  };
  frame();

  // ── state ───────────────────────────────────────────────────────────────
  const DEFAULTS: Profile = { mode: 'unknown', level: 'steady', summary: '', gamesPlayed: 0, game: {} };
  const saved = await load(umicat, DEFAULTS);
  bootStep('saved');
  const autosave = new Autosave(umicat);

  let game: Othello | null = null;
  let level = levelById(saved.profile.level);
  let read: Read | null = null;
  let leadBefore: number | null = null;
  let bestBefore: string[] = [];
  let thinking = false;
  let lastRemarkAt = -REMARK_COOLDOWN;
  let chosen: Point | null = null;
  let shown: Point[] = [];
  let companion = true;

  // ── the assistant ───────────────────────────────────────────────────────
  const chat = new ChatPanel(umicat, {
    onSend: (text) => void talk(text),
    onLayout: (open) => {
      document.body.classList.toggle('chatting', open);
      rig.reserveRight(open ? panelWidth() : 0);
      if (open) speech.hide();
    },
  });

  const coach = new Coach<Context>(umicat, othelloAssistant({
    setLevel: (id) => { level = levelById(id); coach.profile.level = id; refresh(); persist(); return true; },
    startGame: () => {
      // A game with discs played on it is not the assistant's to throw away.
      if (game && !game.over && game.moves.length > 0) return false;
      if (game && !game.over && game.moves.length === 0) return true;
      void freshGame();
      return true;
    },
    highlight: (points) => {
      const marks = parsePoints(points);
      shown = marks;
      rig.setHighlights(marks);
      return marks.length;
    },
    // The referee counts; the model does not. On this board the count is the
    // whole argument, so it is the one thing it must never do by eye.
    showMoves: () => {
      if (!game) return null;
      const moves = game.legalMoves(HUMAN);
      const marks = moves.map(point);
      shown = marks;
      rig.setHighlights(marks);
      return {
        count: moves.length,
        list: moves.map((m) => `${nameOf(m)} (${game!.flips(m, HUMAN).length})`).join('、'),
      };
    },
    showCount: () => (game ? game.counts() : null),
  }), DEFAULTS);

  coach.load(saved.messages, saved.profile);
  if (coach.profile.music === false) audio.setMusicVolume(0);
  if (coach.profile.sound === false) audio.setSfxVolume(0);
  if (coach.profile.evalBar === false) evalBar.setEnabled(false);

  let spoken = coach.messages.filter((m) => m.from === 'coach').length;

  const redrawChat = (): void => {
    chat.render(coach.messages, coach.thinking);
    const said = coach.messages.filter((m) => m.from === 'coach');
    if (said.length > spoken) {
      spoken = said.length;
      repaintSoon();
      askHere.hide();
      const latest = said[said.length - 1].text;
      if (over.showing) over.note(stripAnchors(latest));
      else speech.show(segment(latest, speech.notation));
    }
  };
  coach.onChange = () => redrawChat();
  redrawChat();

  async function talk(text: string): Promise<void> {
    if (!companion) return;
    await coach.ask(text, { game, read });
    persist();
  }

  async function remark(note: string): Promise<void> {
    if (!game || !companion) return;
    lastRemarkAt = game.moves.length;
    await coach.remark(note, { game, read });
    persist();
  }

  const point = (i: number): Point => ({ x: i % SIZE, y: (i / SIZE) | 0 });
  const nameOf = (i: number): string => speech.notation.format(point(i));

  function parsePoints(points: string): Point[] {
    return points.split(',').map((p) => speech.notation.parse(p)).filter((p): p is Point => !!p);
  }

  function askAbout(at: Point): void {
    if (!game) return;
    speech.hide();
    rig.setFocus(at);
    askHere.open(at, speech.notation.format(at));
    askHere.place(rig.screenOf(at.x, at.y), rig.screenSpacing);
  }

  /** The cluster goes beside its cell, off the cells the player still has to
   *  be able to tap — which here are the other legal moves. */
  function placeActions(): void {
    const at = actions.at;
    if (!actions.showing || !at) return;
    const keep = (game && !game.over ? game.legalMoves(HUMAN).map(point) : [])
      .filter((p) => p.x !== at.x || p.y !== at.y)
      .map((p) => rig.screenOf(p.x, p.y));
    actions.place(rig.screenOf(at.x, at.y), rig.screenSpacing, keep);
  }

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
    const middle = rig.screenOf((SIZE - 1) / 2, (SIZE - 1) / 2);
    const x = Math.min(Math.max(middle.x, box.width / 2 + margin), free - box.width / 2 - margin);
    speech.place(x, Math.max(middle.y, box.height + margin), false);
  }

  // ── the board ───────────────────────────────────────────────────────────
  const status = document.createElement('div');
  hud.appendChild(status);
  const tip = document.createElement('div');
  tip.className = 'tip';
  hud.appendChild(tip);
  /** What the last pass was, if the player has not moved since — the sentence
   *  that stops an automatic skip looking like the board moving twice. */
  let passNote = '';

  function refresh(): void {
    if (game) board.sync(game);
    if (!game) { status.textContent = ''; tip.textContent = ''; evalBar.hide(); return; }
    const counts = game.counts();
    status.textContent = game.over ? describeOutcome(game) : thinking
      ? t('hud.thinking')
      : game.toPlay === HUMAN
        ? `${t('hud.yourMove', { level: levelLabel(level.id) })}${passNote ? ` · ${passNote}` : ''}`
        : t('hud.theirMove');
    const yours = !game.over && game.toPlay === HUMAN && !thinking;
    tip.textContent = yours && !coach.profile.placed ? t('hud.howToPlace') : '';
    showLegal();
    evalBar.show(game.over || !read ? null : {
      share: read.exact !== undefined
        ? (read.exact > 0 ? 1 : read.exact < 0 ? 0 : 0.5)
        : 1 / (1 + Math.exp(-read.score / 600)),
      // The label is the DISC COUNT, which is a fact, next to a bar that is
      // the engine's opinion. Two different things, and the player can see
      // both — which is the lesson of the game in one widget.
      label: read.exact !== undefined
        ? t(read.exact > 0 ? 'eval.solvedWin' : read.exact < 0 ? 'eval.solvedLoss' : 'over.draw')
        : t('hud.discs', { black: counts.black, white: counts.white }),
    });
  }

  /** Every legal move, dotted. Only on the player's turn, and never while a
   *  move is being confirmed — the ghost is the answer then. */
  function showLegal(): void {
    if (!game || game.over || thinking || game.toPlay !== HUMAN || chosen) { rig.setDestinations([]); return; }
    rig.setDestinations(game.legalMoves(HUMAN).map(point));
  }

  function describeOutcome(g: Othello): string {
    const out = g.outcome();
    if (out.kind === 'playing') return '';
    const won = 'winner' in out && out.winner === HUMAN;
    if (out.kind === 'draw') return t('result.draw', { black: out.black, white: out.white });
    return t(won ? 'result.youWin' : 'result.youLose', { black: out.black, white: out.white });
  }

  /** The result, for the dialog: a headline and one factual line under it. */
  function describeResult(g: Othello): { title: string; body: string; tone: 'win' | 'loss' | 'draw' } {
    const out = g.outcome();
    const moves = g.moves.length;
    const { black, white } = g.counts();
    if (out.kind === 'resign') {
      const won = out.winner === HUMAN;
      return {
        title: t(won ? 'over.win' : 'over.loss'),
        body: t(won ? 'over.theyResigned' : 'over.youResigned', { moves }),
        tone: won ? 'win' : 'loss',
      };
    }
    const drawn = out.kind === 'draw';
    const won = 'winner' in out && out.winner === HUMAN;
    return {
      title: t(drawn ? 'over.draw' : won ? 'over.win' : 'over.loss'),
      body: t('over.counted', { black, white, moves }),
      tone: drawn ? 'draw' : won ? 'win' : 'loss',
    };
  }

  function clearMarks(): void {
    chosen = null;
    shown = [];
    rig.setHighlights([]);
    rig.setFocus(null);
    rig.setSelection(null);
    rig.setDestinations([]);
    board.setGhost(null);
    actions.hide();
  }

  function newGame(): void {
    over.hide();
    game = new Othello();
    clearMarks();
    askHere.hide();
    read = null;
    leadBefore = null;
    passNote = '';
    lastRemarkAt = -REMARK_COOLDOWN;
    refresh();
    persist();
    void observePosition();
  }

  async function freshGame(withCompanion = true): Promise<void> {
    setCompanion(withCompanion);
    await coach.newSession();
    spoken = 0;
    redrawChat();
    newGame();
    void remark(
      'A new game has just started; the student plays Black and moves first. One line: greet them if '
      + 'you have not yet, and say the one thing worth knowing before the first move. Do not recap the '
      + 'last game.',
    );
  }

  async function observePosition(): Promise<void> {
    if (!game || game.over) return;
    try {
      read = await opponent.read(game, 4, 600, 10);
      leadBefore = read.score;
      bestBefore = read.candidates.slice(0, 2).map((c) => nameOf(c.move));
      refresh();
    } catch { /* a missing read costs commentary, not the game */ }
  }

  /** White's move, and the read it decided from — which describes the
   *  position the PLAYER produced, the only thing fair to judge them on. */
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
        const before = game.toPlay;
        if (!game.play(out.move)) throw new Error(`engine proposed an illegal move ${out.move}`);
        playStone(audio, lastClip);
        // The rules pass for a player with nothing; if that was the student,
        // say so, or the board appears to move twice.
        passNote = game.toPlay === before ? t('hud.youPassed') : '';
      }
    } catch (err) {
      console.error('[othello] engine failed', err);
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
    const before = leadBefore;
    const instead = bestBefore.filter((m) => m !== nameOf(i));
    const flipped = game.play(i);
    if (!flipped) return;  // illegal: the board simply does not take it
    playStone(audio, lastClip);
    if (flipped.length >= 4) audio.play(SFX.capture);
    coach.profile.placed = true;
    const played = nameOf(i);
    // White may have had nothing to answer with, in which case it is the
    // student's move again and they need telling.
    passNote = game.toPlay === HUMAN ? t('hud.theyPassed') : '';
    clearMarks();
    askHere.hide();
    refresh();
    persist();

    void (async () => {
      if (game?.over) { void finish(); return; }
      // Facts first, and this game has two that are worth more than any
      // evaluation: a corner taken, and a corner given away.
      const corner = CORNERS.includes(i);
      const gave = X_SQUARES[i] !== undefined && game!.board[X_SQUARES[i]] === 0;
      const after = game!.toPlay === HUMAN ? read : await engineTurn();
      const speakable = (): boolean => !!game && !game.over && game.moves.length - lastRemarkAt >= REMARK_COOLDOWN;
      if (!game || !speakable()) return;

      if (gave) {
        void remark(`The student played ${played}, which is the square diagonally inside the empty corner `
          + `${nameOf(X_SQUARES[i])}. Say what that usually costs, in one line.`);
        return;
      }
      if (corner) {
        void remark(`The student took the corner at ${played}. One line about why that is worth having.`);
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

  /**
   * A cell was chosen. Nothing is played yet — that is what the tick is for.
   */
  function select(at: Point | null): void {
    if (!at || !game || game.over) { clearMarks(); refresh(); return; }
    askHere.hide();
    const i = game.idx(at.x, at.y);
    const yours = !thinking && game.toPlay === HUMAN;
    const canPlace = yours && game.legal(i, HUMAN);

    // Tapping the aimed-at cell again plays it — the same as the tick, for a
    // player who does not notice the tick.
    if (chosen && chosen.x === at.x && chosen.y === at.y && canPlace) { commit(at); return; }

    if (canPlace) {
      chosen = at;
      rig.setSelection(at);
      board.setGhost(at, HUMAN);
      rig.setDestinations([]);
      actions.show(at, { confirm: true, cancel: true, ask: companion });
      placeActions();
      return;
    }

    // Somewhere they cannot play. A disc that is already there is worth
    // asking about; an empty square that flips nothing is the commonest
    // question a beginner has, so it gets the noise and the ask button too.
    if (yours && game.board[i] === 0) audio.play(SFX.denied);
    clearMarks();
    refresh();
    if (companion) {
      rig.setFocus(at);
      actions.show(at, { ask: true });
      placeActions();
    }
  }

  attachBoardControls(canvas, (x, y) => rig.pick(x, y), {
    onAim: () => { /* the ghost belongs to the chosen cell, not to the cursor */ },
    onPicked: select,
  });

  // ── the one button, and everything behind it ────────────────────────────
  const bar = document.createElement('div');
  bar.className = 'bar';
  hud.appendChild(bar);

  const menu = new Menu(
    { level: level.id, companion: true },
    {
      levels: LEVELS.map((l) => ({ id: l.id, label: levelLabel(l.id), about: levelAbout(l.id) })),
      groups: () => [],
      onLevel: (id) => { level = levelById(id); coach.profile.level = id; refresh(); persist(); },
      onCompanion: (on) => setCompanion(on),
      onStart: ({ companion: withCompanion }) => void (async () => {
        leaveTitle();
        await underCurtain(t('title.loading'), loading);
        await freshGame(withCompanion);
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
      onClose: () => { if (!game) void toTitle(); },
    },
  );

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

  /** What the engine would play. Free: it runs on this machine. */
  async function hint(): Promise<void> {
    if (!game || game.over || thinking || game.toPlay !== HUMAN) return;
    const was = status.textContent;
    status.textContent = t('hud.looking');
    try {
      const r = await opponent.read(game, 7, 2500, 13);
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
      game: game && !game.over ? game.snapshot() : null,
    });
  }

  async function finish(): Promise<void> {
    if (!game?.over) return;
    coach.profile.gamesPlayed += 1;
    clearMarks();
    evalBar.hide();
    refresh();
    persist();
    audio.play(SFX.gameOver);
    speech.hide();
    over.show(describeResult(game));

    const { black, white } = game.counts();
    await remark(`The game is over: ${black} discs to ${white} after ${game.moves.length} moves. `
      + 'Say one thing worth remembering about it, and nothing else.');
    await coach.summarise();
    persist();
  }

  // ── the way in, and back out ────────────────────────────────────────────
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
    const stored = await umicat.saves.get<ReturnType<Othello['snapshot']>>('game');
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
      menu.sync({ level: level.id, companion: true }, false, true);
      menu.show();
      return;
    }

    leaveTitle();
    if (choice === 'continue') {
      if (game && !game.over) { refresh(); void observePosition(); return; }
      if (stored) {
        game = Othello.restore(stored);
        clearMarks();
        refresh();
        void observePosition();
        if (!game.over && game.toPlay !== HUMAN) void engineTurn();
        return;
      }
    }
    await freshGame();
  }

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

  function leaveTitle(): void {
    document.body.classList.remove('titling');
  }

  await toTitle();

  // The probe surface. Playwright drives the game through this rather than
  // through pixels.
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
      select: (p: string | null) => select(p ? speech.notation.parse(p) : null),
      play: (p: string) => { const at = speech.notation.parse(p); if (at) commit(at); },
      name: (i: number) => nameOf(i),
      newGame: () => void freshGame(),
      say: (text: string) => talk(text),
      redraw: redrawChat,
      hint,
      finish,
      toTitle: () => toTitle(),
      flush: () => autosave.flush(),
      diagram: () => game?.diagram() ?? [],
      counts: () => game?.counts() ?? null,
      outcome: () => game?.outcome() ?? null,
    },
  });
}

/** How the chat panel is sized in CSS, in pixels, so the board can dodge it. */
const panelWidth = (): number => Math.min(380, window.innerWidth * 0.42) + 24;

void start().catch((err) => {
  const hud = document.getElementById('hud');
  if (hud) hud.textContent = `Failed to start: ${String(err)}`;
  console.error('[othello] failed to start', err);
});
