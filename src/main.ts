// Blokus, in three dimensions.
//
// Twenty by twenty, twenty-one pieces each, and one rule: your pieces touch
// your own colour at the corners and never along an edge. Four seats, filled
// by whoever is in the room and by bots for the rest.
//
// This file is the loop that joins the pieces together, and nothing else.
// When something is wrong, the first question is which piece it belongs to:
//
//   `src/blokus/`  the rules, the state and the bots — no DOM, no three.js
//   `src/view/`    the board drawn, and the pointer over it
//   `src/net/`     the table: seats, and the one key the state travels under
//   `src/ui/`      everything made of DOM, which on the web is all of the UI
//
// The order things happen in is: a card (title, lobby, result) is up, or a
// game is. Never both — `Screen` hides the game's furniture while it is
// showing, so there is exactly one thing on screen asking to be pressed.
import { ThreeUmicat } from '@umicat/three-sdk';
import type { ChatMessage } from '@umicat/platform-sdk';
import { BoardView } from './view/board3d';
import { attachBoardControls } from './view/controls';
import { BlokusGame, PLAYERS, type Move } from './blokus/game';
import { chooseMove, type Difficulty } from './blokus/bot';
import {
  BASE, COLOURS, EMPTY, ORIENTATIONS, SIZE, anchors, canPlace, cellsAt, extent, flipped,
  originFor, rotated,
} from './blokus/pieces';
import type { Cell, Cells } from './blokus/pieces';
import { Table } from './net/table';
import { Screen } from './ui/screen';
import { showTitle, showRules, pickDifficulty } from './ui/front';
import { onlineLobby } from './ui/lobby';
import { Hud } from './ui/hud';
import { Tray } from './ui/tray';
import { Actions } from './ui/actions';
import { ChatPanel } from './ui/chat';
import { Menu } from './ui/menu';
import { showResult } from './ui/over';
import { ask } from './ui/confirm';
import { Autosave, load, loadGame, type Settings } from './save';
import { SFX, createAudio, playTile } from './audio';
import { colourName, setLocale, t } from './i18n';

/** Whether this is a finger or a mouse. Read once: it decides which of two
 *  sentences the HUD offers, and a device does not change its mind mid-game. */
const TOUCH = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;

/** How long a bot appears to think. Not a search budget — the search takes a
 *  few milliseconds — but the beat that makes three bots in a row readable as
 *  three moves rather than as the board changing by itself. */
const BOT_PAUSE = 650;

async function start(): Promise<void> {
  const umicat = await ThreeUmicat.init();
  // Before any UI exists: everything below asks `t()` for its words.
  setLocale(umicat.locale);

  const canvas = document.getElementById('game') as HTMLCanvasElement;
  const hudEl = document.getElementById('hud')!;
  const view = new BoardView(canvas);

  // ── things the render loop touches ──────────────────────────────────────
  // Declared before it starts. The loop runs from the first frame, long
  // before the rest of this function exists, and a `const` it reads too early
  // is a ReferenceError that takes the whole game down at boot with a blank
  // screen. It has happened twice in the sibling games.
  let idle = true;
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

  const frame = (): void => {
    // The board turns slowly behind the title and the lobby, which is what
    // says "board game" before a word has been read.
    if (idle) view.orbit(0.0011, 0);
    if (performance.now() < repaintUntil) view.invalidate();
    if (view.render() && actions.showing && actions.at) {
      actions.place(view.screenOf(actions.at[0], actions.at[1]), view.screenSpacing);
    }
    requestAnimationFrame(frame);
  };

  const audio = createAudio();
  // Fetch and decode ahead of the first gesture. Without it the very first
  // press of a session is silent — there is no decoded buffer yet — and the
  // press in question is the title screen's own button.
  const loading = audio.preload();
  const lastKnock = { i: -1 };

  // One listener for every button in the game. A click sound wired per button
  // is a click sound that is missing from the next button somebody adds.
  document.addEventListener('click', (e) => {
    if ((e.target as HTMLElement | null)?.closest('button')) audio.play(SFX.uiPress);
  }, true);

  const saved = await load(umicat);
  const autosave = new Autosave(umicat);
  let settings: Settings = saved.settings;
  let best = saved.best;
  audio.setMuted(false);
  audio.setMusicVolume(settings.music ? 0.18 : 0);
  audio.setSfxVolume(settings.sound ? 1 : 0);

  // ── the game, while there is one ────────────────────────────────────────
  let game: BlokusGame | null = null;
  let table: Table = Table.solo();
  /** The piece in hand, how it is turned, and where it is aimed. */
  let selected: string | null = null;
  let ori = 0;
  let aim: Cell | null = null;
  /** True once the player has chosen a spot: the ghost stops following the
   *  pointer and the tick appears. Without this the ghost follows the mouse
   *  as it travels towards the tick, and the piece lands where the BUTTON
   *  was rather than where the player was pointing. */
  let frozen = false;
  /**
   * Where the finger's "cursor" is while it nudges a settled piece.
   *
   * A relative drag has no point on the board of its own — the finger may be
   * anywhere, and usually is deliberately somewhere else so it is not in the
   * way. So the drag moves a virtual pointer that STARTS at the piece and
   * then gets picked against the board like any other point: perspective, the
   * tilt and the zoom all come out right for free, and nothing accumulates
   * rounding the way a cells-per-pixel conversion would.
   */
  let virtual: { x: number; y: number } | null = null;
  let botTimer: ReturnType<typeof setTimeout> | null = null;
  /** The result card is up (or on its way). Both `afterMove` and a message
   *  from the room can notice the same ending, and two result cards over one
   *  game is one card nobody can dismiss. */
  let finishing = false;
  /** The last state this client applied, so its own echo off the room does
   *  not re-apply (and re-animate) a move it just made. */
  let applied = '';

  const screen = new Screen();

  const hud = new Hud(hudEl, {
    onMenu: () => menu.toggle(),
    onChat: () => chat.toggle(),
    onZoom: (factor) => view.zoomBy(factor),
  });

  const tray = new Tray({
    onSelect: (piece) => {
      selected = piece;
      ori = 0;
      clearAim();
      refresh();
    },
    onRotate: () => turn(rotated),
    onFlip: () => turn(flipped),
    onPass: () => {
      if (!game || game.turn !== table.seat || game.over) return;
      void ask(t('confirm.pass'), t('confirm.passYes'), t('confirm.no')).then((yes) => {
        // Asked and answered a moment later: by the time it comes back the
        // turn may have moved on, so the guard is repeated rather than
        // trusted from before the question.
        if (!yes || !game || game.turn !== table.seat || game.over) return;
        game.pass();
        clearAim();
        hud.say(t('hud.youPassed'));
        afterMove();
      });
    },
  });

  const actions = new Actions({
    onConfirm: () => placeSelected(),
    onCancel: () => { clearAim(); refresh(); },
    onRotate: () => turn(rotated),
  });

  const chat = new ChatPanel({
    onSend: (text) => {
      void table.say(text).catch(() => {
        chat.push({ text: t('chat.failed'), system: true });
      });
    },
    onLayout: () => relayout(),
  });

  const menu = new Menu({
    get: () => settings,
    set: (patch) => {
      settings = { ...settings, ...patch };
      autosave.queue({ settings });
      audio.setMusicVolume(settings.music ? 0.18 : 0);
      audio.setSfxVolume(settings.sound ? 1 : 0);
      refresh();
    },
    onRecentre: () => view.recentre(),
    onRules: () => void showRules(screen).then(() => { screen.hide(); }),
    onLeave: () => void toTitle(),
    onClose: () => repaintSoon(),
  });

  window.addEventListener('resize', () => { view.resize(); relayout(); });
  window.addEventListener('keydown', (e) => {
    // Not while somebody is typing a message or a room code.
    if ((e.target as HTMLElement | null)?.tagName === 'INPUT') return;
    if (!game || game.over || game.turn !== table.seat) return;
    if (e.key === 'r' || e.key === 'R') { turn(rotated); e.preventDefault(); }
    else if (e.key === 'f' || e.key === 'F') { turn(flipped); e.preventDefault(); }
    else if (e.key === 'Enter' || e.key === ' ') { if (frozen) { placeSelected(); e.preventDefault(); } }
    else if (e.key === 'Escape') { clearAim(); refresh(); }
  });

  attachBoardControls(canvas, (x, y, clamp) => view.pick(x, y, clamp), {
    aimed: () => !!aim && frozen && !!selected && !!game && !game.over && game.turn === table.seat,
    onNudgeStart: () => {
      virtual = aim ? view.screenOf(aim[0], aim[1]) : null;
    },
    onNudge: (dx, dy) => {
      if (!game || game.over || game.turn !== table.seat || !selected || !aim) return;
      if (!virtual) virtual = view.screenOf(aim[0], aim[1]);
      virtual.x += dx;
      virtual.y += dy;
      const at = view.pick(virtual.x, virtual.y, true);
      if (!at) return;
      aim = at;
      refresh();
    },
    onAim: (at, source) => {
      if (!game || game.over || game.turn !== table.seat || !selected) return;
      // A DRAG always aims, even once the piece is settled: moving it again
      // by tapping means tapping where the confirm buttons are standing.
      // Hovering stops at that point, because a mouse on its way to the tick
      // would otherwise carry the piece along with it.
      if (frozen && source !== 'drag') return;
      aim = at;
      refresh();
    },
    onPan: (dx, dy) => view.panBy(dx, dy),
    onTurnPiece: () => { if (selected) turn(rotated); },
    onPicked: (at) => {
      if (!game || game.over || game.turn !== table.seat || !selected) return;
      if (!at) { clearAim(); refresh(); return; }
      aim = at;
      frozen = true;
      refresh();
    },
    onCamera: (dAz, dPolar) => view.orbit(dAz, dPolar),
    onZoom: (factor) => view.zoomBy(factor),
  });

  frame();

  // ── the piece in hand ───────────────────────────────────────────────────

  /** Where the selected piece's squares would land, given the current aim. */
  function ghostCells(): Cells | null {
    if (!selected || !aim) return null;
    const [ox, oy] = originFor(selected, ori, aim[0], aim[1]);
    return cellsAt(selected, ori, ox, oy);
  }

  function legalNow(cells: Cells | null): boolean {
    if (!game || !cells) return false;
    return canPlace(game.board, cells, table.seat, game.first[table.seat]);
  }

  function turn(by: (piece: string, ori: number) => number): void {
    if (!selected) return;
    ori = by(selected, ori);
    refresh();
  }

  function clearAim(): void {
    aim = null;
    frozen = false;
    virtual = null;
    actions.hide();
  }

  function placeSelected(): void {
    if (!game || !selected) return;
    const cells = ghostCells();
    if (!cells || !legalNow(cells)) {
      audio.play(SFX.denied);
      hud.say(t('hud.yourTurn'), t('hud.wontGo'));
      return;
    }
    const [ox, oy] = originFor(selected, ori, aim![0], aim![1]);
    const move: Move = { piece: selected, ori, x: ox, y: oy };
    const placed = game.play(table.seat, move);
    if (!placed) { audio.play(SFX.denied); return; }
    selected = null;
    ori = 0;
    clearAim();
    land(placed, table.seat);
    afterMove();
  }

  // ── a move, from anywhere ───────────────────────────────────────────────

  /** The sound and the animation of a piece arriving. The board must already
   *  have been `sync`ed — that is what decided where the squares are. */
  function land(cells: Cells, player: number): void {
    if (!game) return;
    view.sync(game.board);
    view.drop(cells, player);
    playTile(audio, lastKnock);
  }

  /**
   * Everything that has to happen after ANY move, wherever it came from.
   *
   * Publishing, saving, the result card and handing the turn to a bot all
   * live here rather than at each call site, because "the bot never moved
   * after a pass" is the shape of bug you get when they do not.
   */
  function afterMove(): void {
    if (!game) return;
    if (table.online) publish();
    else autosave.queue({ game: { ...game.snapshot(), difficulty: settings.difficulty } });
    refresh();
    if (game.over) { void finish(); return; }
    scheduleBot();
  }

  function publish(): void {
    if (!game) return;
    const snap = game.snapshot();
    applied = JSON.stringify(snap);
    table.publish(snap);
  }

  /**
   * A bot's turn, if the seat on move is one and this client is the one that
   * runs them. Exactly one machine does — see `Table.isHost` — because two
   * clients each playing the bot's move would play two different ones.
   */
  function scheduleBot(): void {
    if (botTimer !== null) return;
    if (!game || game.over) return;
    const seat = game.turn;
    if (!table.isBot(seat) || !table.isHost) return;
    botTimer = setTimeout(() => {
      botTimer = null;
      if (!game || game.over) return;
      // The turn moved while this was waiting — a remote player got there
      // first, or somebody left and their seat became ours to play. Ask again
      // rather than returning: the guard above means nothing else will, and
      // the board simply stopped, which is exactly how it failed once.
      if (game.turn !== seat) { scheduleBot(); return; }
      const move = chooseMove(
        game.board, game.hands[seat], seat, game.first[seat], settings.difficulty,
      );
      if (move) {
        const placed = game.play(seat, move);
        if (placed) land(placed, seat);
      } else {
        // Nothing fits. `pass` hands the turn on and skips anyone else who is
        // stuck, which is also how the game finds out it is over.
        game.pass();
      }
      afterMove();
    }, BOT_PAUSE);
  }

  async function finish(): Promise<void> {
    if (!game || finishing) return;
    finishing = true;
    audio.play(SFX.gameOver);
    const mine = game.scores[table.seat] ?? 0;
    const previousBest = best;
    if (mine > best) { best = mine; autosave.queue({ best }); }
    // A finished game is not something to continue.
    if (!table.online) autosave.queue({ game: null });
    await autosave.flush();

    const rows = Array.from({ length: PLAYERS }, (_, seat) => ({
      seat,
      name: nameOf(seat),
      score: game!.scores[seat] ?? 0,
      left: game!.left(seat),
    }));
    idle = true;
    const choice = await showResult(screen, {
      rows, winners: game.winners(), mySeat: table.seat, best: previousBest,
    });
    if (choice === 'again' && !table.online) {
      const difficulty = settings.difficulty;
      endGame();
      startSolo(new BlokusGame(), difficulty);
      return;
    }
    // Online, "again" means back to the doors: the room this game was played
    // in is finished, and a new one is somebody pressing Create again.
    const wasOnline = table.online;
    endGame();
    if (choice === 'again' && wasOnline) await goOnline();
    else await toTitle();
  }

  // ── who is who ──────────────────────────────────────────────────────────

  function nameOf(seat: number): string {
    const name = table.nameOf(seat);
    if (name) return name;
    if (seat === table.seat) return t('player.you', { colour: colourName(seat) });
    return t('player.bot', { colour: colourName(seat) });
  }

  // ── drawing whatever is true right now ──────────────────────────────────

  function refresh(): void {
    if (!game) return;
    const myTurn = game.turn === table.seat && !game.over;

    const cells = ghostCells();
    const legal = legalNow(cells);
    if (myTurn && cells) {
      view.setGhost(cells, table.seat, legal);
      if (frozen) {
        // Hung from the middle of the piece, so the pair straddles it however
        // it is turned.
        const cx = Math.round(cells.reduce((s, c) => s + c[0], 0) / cells.length);
        const cy = Math.round(cells.reduce((s, c) => s + c[1], 0) / cells.length);
        actions.show([cx, cy], legal);
        actions.place(view.screenOf(cx, cy), view.screenSpacing);
      } else {
        actions.hide();
      }
    } else {
      view.setGhost(null, table.seat, true);
      actions.hide();
    }

    // The corners this player could still build from, while a piece is in
    // hand. Not permanently: forty dots on a board is a board covered in
    // dots, and the question only exists once you are holding something.
    view.setAnchors(
      settings.anchors && myTurn && selected
        ? anchors(game.board, table.seat, game.first[table.seat])
        : [],
      table.seat,
    );

    tray.render(game.hands[table.seat], selected, ori, myTurn);
    hud.standings(
      Array.from({ length: PLAYERS }, (_, seat) => ({
        score: game!.scores[seat] ?? 0,
        left: game!.left(seat),
        name: nameOf(seat),
        bot: table.isBot(seat),
      })),
      game.turn,
      table.seat,
    );
    hud.tint(game.over ? null : game.turn);

    if (game.over) hud.say(t('over.heading'));
    else if (myTurn) {
      // Three states, three sentences — and on a finger the middle one is
      // worth saying, because "drag from anywhere" is not a thing a player
      // would guess at a board game.
      hud.say(t('hud.yourTurn'), !selected
        ? t('hud.pickPiece')
        : TOUCH
          ? t(aim ? 'hud.confirmHintTouch' : 'hud.tapToPlace')
          : t('hud.confirmHint'));
    } else if (table.isBot(game.turn)) {
      hud.say(t('hud.botTurn', { name: nameOf(game.turn) }));
    } else {
      hud.say(t('hud.turnOf', { name: nameOf(game.turn) }));
    }
  }

  /** Give the board whatever screen the panels are not using. */
  function relayout(): void {
    view.reserve(chat.width, game ? tray.height : 0);
  }

  // ── starting and stopping a game ────────────────────────────────────────

  function startSolo(g: BlokusGame, difficulty: Difficulty): void {
    settings = { ...settings, difficulty };
    autosave.queue({ settings });
    begin(Table.solo(), g);
  }

  function begin(seatedAt: Table, g: BlokusGame): void {
    table = seatedAt;
    game = g;
    finishing = false;
    selected = null;
    ori = 0;
    clearAim();
    applied = JSON.stringify(g.snapshot());

    idle = false;
    screen.hide();
    hud.hide(false);
    tray.hide(false);
    tray.setSeat(table.seat);
    hud.showChat(table.online);
    hud.clearUnread();
    menu.context(true, !table.online);
    view.setSeat(table.seat);
    view.recentre();
    view.sync(g.board);
    refresh();
    // After a frame, so the tray has been laid out and can be measured.
    requestAnimationFrame(() => relayout());

    if (table.online) {
      table.onChange(() => syncFromRoom());
      table.onChat((msg) => receive(msg));
      table.onError(() => {
        chat.push({ text: t('lobby.lost'), system: true });
        // The host picks up any seat whose player has gone; if it was OUR
        // connection that dropped there is nothing left to do here but say so.
        scheduleBot();
      });
      syncFromRoom();
    }
    scheduleBot();
  }

  function endGame(): void {
    if (botTimer !== null) { clearTimeout(botTimer); botTimer = null; }
    table.close();
    table = Table.solo();
    game = null;
    selected = null;
    clearAim();
    chat.setOpen(false);
    hud.hide(true);
    tray.hide(true);
    hud.showChat(false);
    menu.close();
    menu.context(false, true);
    idle = true;
    relayout();
  }

  // ── the room's copy of the board ────────────────────────────────────────

  /**
   * Take whatever the room says the game is.
   *
   * Everything travels under one key, so this is one read and one restore —
   * there is no half-applied state to guard against. What it does have to
   * work out is WHICH squares are new, because that is the piece that just
   * landed and it should arrive with a knock like any other.
   */
  function syncFromRoom(): void {
    if (!game || !table.online) return;
    const snap = table.read();
    if (!snap) return;
    const raw = JSON.stringify(snap);
    if (raw === applied) { refresh(); return; }
    const before = [...game.board];
    applied = raw;
    game.restore(snap);
    const landed = newCells(before, game.board);
    view.sync(game.board);
    if (landed.cells.length) view.drop(landed.cells, landed.player);
    if (landed.cells.length) playTile(audio, lastKnock);
    // A piece may have landed where this player was aiming.
    if (frozen && !legalNow(ghostCells())) clearAim();
    refresh();
    if (game.over) { void finish(); return; }
    scheduleBot();
  }

  /** The squares that appeared between two boards, and whose they are. */
  function newCells(before: readonly number[], after: readonly number[]): { cells: Cells; player: number } {
    const cells: Cells = [];
    let player = 0;
    for (let i = 0; i < after.length; i++) {
      if (before[i] === EMPTY && after[i] !== EMPTY) {
        cells.push([i % SIZE, Math.floor(i / SIZE)] as Cell);
        player = after[i];
      }
    }
    return { cells, player };
  }

  function receive(msg: ChatMessage): void {
    const seat = table.seats.indexOf(msg.from);
    if (msg.kind === 'user') {
      const mine = msg.from === table.room?.sessionId;
      chat.push({
        text: msg.text,
        mine,
        name: mine ? t('chat.you') : (msg.displayName || nameOf(Math.max(0, seat))),
        colour: seat >= 0 ? COLOURS[seat] : undefined,
      });
      if (!mine && !chat.isOpen) hud.bumpUnread();
    } else {
      chat.push({ text: msg.text, system: true });
    }
  }

  // ── the front of house ──────────────────────────────────────────────────

  async function goOnline(): Promise<void> {
    const result = await onlineLobby(screen, umicat);
    if (result.kind === 'table') { begin(result.table, new BlokusGame()); return; }
    if (result.kind === 'solo') { await soloFlow(); return; }
    await toTitle();
  }

  async function soloFlow(): Promise<void> {
    const difficulty = await pickDifficulty(screen, settings.difficulty);
    if (!difficulty) { await toTitle(); return; }
    startSolo(new BlokusGame(), difficulty);
  }

  async function toTitle(): Promise<void> {
    endGame();
    const resume = await loadGame(umicat);
    const choice = await showTitle(screen, { canContinue: !!resume && !resume.over, loading });
    if (choice === 'continue' && resume) {
      const g = new BlokusGame();
      g.restore(resume);
      startSolo(g, resume.difficulty ?? settings.difficulty);
      return;
    }
    if (choice === 'online') { await goOnline(); return; }
    await soloFlow();
  }

  /**
   * A door for the probes.
   *
   * Driving this game through pixels would mean testing whether a click lands
   * on a cell of a tilted board, which is a test of the test. The probes play
   * through here instead — the same functions the buttons call — and check
   * the BOARD, which is the thing that has to be right.
   */
  (window as unknown as { __blokus: unknown }).__blokus = {
    get game(): BlokusGame | null { return game; },
    get table(): Table { return table; },
    get selected(): string | null { return selected; },
    get ori(): number { return ori; },
    get aim(): Cell | null { return aim; },
    get frozen(): boolean { return frozen; },
    view,
    screen,
    solo: (difficulty: Difficulty = settings.difficulty): void => {
      endGame();
      startSolo(new BlokusGame(), difficulty);
    },
    title: (): Promise<void> => toTitle(),
    select: (piece: string | null): void => { selected = piece; ori = 0; clearAim(); refresh(); },
    turn: (): void => turn(rotated),
    flip: (): void => turn(flipped),
    aimAt: (x: number, y: number): void => { aim = [x, y]; frozen = true; refresh(); },
    place: (): void => placeSelected(),
    pass: (): void => {
      if (!game || game.over || game.turn !== table.seat) return;
      game.pass();
      clearAim();
      afterMove();
    },
    /** Aim at a move's ORIGIN the way a pointer would — through the same
     *  centring `originFor` does — and confirm it. Returns whether the board
     *  took it, which is what makes this a test of the aiming maths and not
     *  just of the rules. */
    play: (move: Move): boolean => {
      if (!game) return false;
      const before = game.scores[table.seat] ?? 0;
      selected = move.piece;
      ori = move.ori;
      const { w, h } = extent(ORIENTATIONS[move.piece][move.ori]);
      aim = [move.x + Math.floor((w - 1) / 2), move.y + Math.floor((h - 1) / 2)];
      frozen = true;
      refresh();
      placeSelected();
      return (game.scores[table.seat] ?? 0) !== before;
    },
    /** The shape tables, so a probe can check the invariants that hold for
     *  every Blokus set ever printed (21 pieces, 89 squares, 91 orientations). */
    pieces: { BASE, ORIENTATIONS },
    /** Any legal move for the seat on turn, from the bot's own search — the
     *  quickest way for a probe to play a whole game out. */
    suggest: (): Move | null => (game
      ? chooseMove(game.board, game.hands[game.turn], game.turn, game.first[game.turn], 'easy')
      : null),
  };

  // The music is already declared to `GameAudio` and starts itself on the
  // first gesture — which is the title screen's own button, and never before
  // anyone has pressed anything.
  void toTitle();
}

void start().catch((err) => {
  console.error('[blokus] failed to start', err);
  const note = document.createElement('div');
  note.style.cssText = 'position:fixed;inset:0;display:grid;place-content:center;color:#f3f4fa;font:15px/1.5 system-ui;text-align:center;padding:24px';
  note.textContent = 'The board could not be set out. Reloading may help.';
  document.body.appendChild(note);
});
