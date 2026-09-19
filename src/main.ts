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
import { LEVELS, Opponent, levelById, levelLabel, type Read } from './go/opponent';
import { describe as describeScore, scoreFrom, type Score } from './go/scoring';
import { Coach } from './coach/coach';
import { ChatPanel } from './ui/chat';
import { Speech, segment } from './ui/speech';
import { Menu } from './ui/menu';
import { showTitle } from './ui/title';
import { Autosave, load } from './save';
import { Course, type Phase } from './teach/course';
import { LESSONS } from './teach/curriculum';
import { goalMet, setUp } from './teach/curriculum';
import { setLocale, t } from './i18n';

/** The player is Black: Black moves first, and the beginner should be the one
 *  who gets to start rather than the one who has to answer. */
const HUMAN = 'black' as const;

/** How many of Black's points have to evaporate on Black's own move before the
 *  coach mentions it UNASKED while they are just playing. Small enough to catch
 *  a real blunder, big enough not to natter about every slightly loose move. */
const BLUNDER_POINTS = 5;
/** Moves of quiet after an unprompted remark, so the coach is not a narrator. */
const REMARK_COOLDOWN = 4;

async function start(): Promise<void> {
  const umicat = await ThreeUmicat.init();
  // Before any UI exists: everything below asks `t()` for its words.
  // The platform's setting, and nothing else — see i18n.ts.
  setLocale(umicat.locale);

  const canvas = document.getElementById('game') as HTMLCanvasElement;
  const hud = document.getElementById('hud')!;
  const view = new BoardView(canvas);
  window.addEventListener('resize', () => view.resize());

  // The coach's own voice, on the board. The chat panel keeps the history and
  // is where the player types; this is where the coach is actually read.
  const speech = new Speech({
    onPage: (page) => {
      // The point being talked about lights up for exactly as long as the
      // sentence about it is on screen.
      view.setHighlights(page.at ? [page.at] : []);
      chat.setEchoed(true);
      placeSpeech();
    },
    onDone: () => {
      view.setHighlights([]);
      chat.setEchoed(false);
    },
  });

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
    if (speech.showing) placeSpeech();
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
  let score: Score | null = null;
  const course = new Course(saved.profile.course);
  /** Stones the student had taken when the current exercise was set up — the
   *  baseline a `capture` goal is measured against. */
  let capturesAtStart = 0;

  // ── the two voices ──────────────────────────────────────────────────────
  const chat = new ChatPanel(umicat, {
    onSend: (text) => void talk(text),
    onLayout: (open) => {
      view.reserveRight(open ? panelWidth() : 0);
      // Opening the panel means the player wants to read or type, not to be
      // tapped through a bubble that says the same thing.
      if (open) speech.hide();
    },
  });
  const coach = new Coach(umicat, {
    setMode: (mode) => {
      persist();
      // Teaching needs a baseline read of the position the student is about to
      // move in, and that only starts being taken once the mode says so — so
      // the switch has to reach the CURRENT game, not just the next one.
      if (mode === 'learning') void observePosition();
      refresh();
    },
    setBoardSize: (size) => {
      // Mid-game is exactly when a model is most likely to try this, because
      // the student just asked "can we play on a bigger board?".
      if (game && !game.over && game.turns.length > 0) return false;
      newGame(size as BoardSize, 0);
      return true;
    },
    setLevel: (id) => { level = levelById(id); refresh(); return true; },
    startGame: (handicap) => {
      // A game and a lesson cannot both own the board. Asking for one ends the
      // other — the student keeps the lessons they have passed.
      course.leave();
      newGame(coach.profile.boardSize, handicap);
      return true;
    },
    highlight: (points) => view.setHighlights(points),
    startLesson: (id) => {
      const lesson = course.start(id || undefined);
      if (!lesson) return false;
      coach.profile.mode = 'learning';
      setUpPhase({ announce: true });
      return true;
    },
    beginExercise: () => {
      // Only from the explaining phase. A model that calls this twice would
      // otherwise skip the practice and put the student straight into a test.
      if (!course.active || course.phase !== 'teach') return false;
      course.advance();
      setUpPhase({ announce: true });
      return true;
    },
    leaveCourse: () => {
      course.leave();
      newGame(coach.profile.boardSize, 0);
    },
  });
  coach.load(saved.messages, saved.profile);

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
      // Above the point, unless there is no room up there — a bubble pinned to
      // the top of the screen while pointing at a stone near it is pointing at
      // nothing. Below, and the tail comes off, because it would be lying.
      if (top - box.height >= margin) speech.place(x, top, Math.abs(x - p.x) < 2);
      else speech.place(x, p.y + gap + box.height, false);
      return;
    }
    // Nothing to point at: the middle of the board. Not the top of the screen —
    // a bubble parked over the HUD reads as a notification, and this is the
    // coach talking about the game in front of both of you.
    const size = game?.size ?? 9;
    const middle = view.screenOf((size - 1) / 2, (size - 1) / 2);
    const x = Math.min(Math.max(middle.x, box.width / 2 + margin), free - box.width / 2 - margin);
    speech.place(x, Math.max(middle.y, box.height + margin), false);
  }

  /** How many coach lines have already been spoken aloud. */
  let spoken = 0;
  const redrawChat = (): void => {
    chat.render(coach.messages, coach.thinking);
    const said = coach.messages.filter((m) => m.from === 'coach');
    if (said.length > spoken) {
      spoken = said.length;
      // Only the newest: if the coach got two lines in while the player was
      // reading, the older one is history, and history is what the panel is for.
      speech.show(segment(said[said.length - 1].text, game?.size ?? 9));
    }
  };
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
  // Where the student is, and what this exercise wants. Both sides of the
  // lesson can see it: the same sentence goes into the coach's observation.
  const lessonBar = document.createElement('div');
  lessonBar.className = 'lesson';
  hud.appendChild(lessonBar);

  const status = document.createElement('div');
  hud.appendChild(status);
  // How to play a stone at all. Shown until the player has played one, ever —
  // the first session had someone sitting in front of their own turn with no
  // idea the board was waiting for them.
  const tip = document.createElement('div');
  tip.className = 'tip';
  hud.appendChild(tip);
  /** True on a device that has no mouse, which is also the one that needs the
   *  two-step placement explained. */
  const coarse = window.matchMedia('(pointer: coarse)').matches;

  function refresh(): void {
    if (game) view.sync(game);
    if (!game) { status.textContent = ''; return; }
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
    confirmBtn.hidden = !armed;

    const lesson = course.lesson;
    const phase = course.phase;
    lessonBar.replaceChildren();
    if (lesson) {
      const { index, total } = course.position;
      const head = document.createElement('div');
      head.className = 'head';
      head.textContent = `${t('course.banner', { index, total, name: t(`lesson.${lesson.id}` as Parameters<typeof t>[0]) })} · ${t(`course.phase.${phase}` as Parameters<typeof t>[0])}`;
      lessonBar.appendChild(head);
      const goal = document.createElement('div');
      goal.className = 'goal';
      goal.textContent = phase === 'quiz' ? `${goalText(lesson.id, 'quiz')} ${t('course.quizSilent')}`
        : phase === 'practice' ? goalText(lesson.id, 'practice')
          : phase === 'done' ? t('course.passed') : '';
      lessonBar.appendChild(goal);
    }
    retryBtn.hidden = !(course.active && (phase === 'practice' || phase === 'quiz'));
    nextLessonBtn.hidden = !(course.lesson && phase === 'done');
    leaveBtn.hidden = !course.lesson;
    // No hints in a test. A hint button that works during the one part of the
    // lesson that is being marked is not a hint button, it is the answer.
    hintBtn.hidden = phase === 'quiz' && course.active;
    // Passing and resigning are moves in a GAME. In a one-move exercise they
    // are two buttons that can only confuse — except in the last lesson, which
    // IS a whole game, and where passing is the thing being taught.
    const exercise = course.active && phase !== 'teach' && course.problem()?.goal.kind !== 'finish';
    passBtn.hidden = !!exercise;
    resignBtn.hidden = !!exercise;

    const green = !!game && !game.over && game.toPlay === HUMAN && !thinking;
    tip.textContent = green && coach.profile.gamesPlayed === 0 && game.turns.length < 2
      ? t(coarse ? 'hud.howToPlaceTouch' : 'hud.howToPlaceMouse')
      : '';
  }

  function newGame(size: BoardSize, handicap: number): void {
    game = new GoGame(size, { handicap });
    coach.profile.boardSize = size;
    view.setBoardSize(size);
    view.setHighlights([]);
    armed = null;
    view.setGhost(null, HUMAN);
    read = null;
    score = null;
    view.setTerritory(null, [], game);
    leadBeforePlayer = null;
    lastRemarkAt = -REMARK_COOLDOWN;
    refresh();
    persist();
    if (game.toPlay !== HUMAN) void engineTurn();
    else void observePosition();

    // "Right, let's begin" followed by nothing is how the first teaching
    // session actually went: the coach announced a game and then waited, and
    // the student had no idea it was their turn or where to put anything.
    if (coach.profile.mode === 'learning') {
      void remark(
        `A new teaching game has just started on a ${size}x${size} board` +
        `${handicap ? ` with ${handicap} handicap stones for the student` : ''}. ` +
        'They are Black and it is their move. Tell them the ONE concrete thing to do now — ' +
        'a point to play and why it is a reasonable first move — not a summary of the rules.',
      );
    }
  }

  /**
   * Put the current phase's position on the board.
   *
   * Every phase gets a FRESH game rather than an edited one: an exercise that
   * inherits the last one's ko history or capture count is an exercise whose
   * goal checker quietly reads the wrong number.
   */
  function setUpPhase(opts: { announce?: boolean } = {}): void {
    const lesson = course.lesson;
    if (!lesson) return;
    const problem = course.problem();

    game = new GoGame(lesson.size);
    if (problem) setUp(game, problem);
    capturesAtStart = game.captures.black;

    view.setBoardSize(lesson.size);
    view.setHighlights([]);
    view.setTerritory(null, [], game);
    armed = null;
    view.setGhost(null, HUMAN);
    read = null;
    score = null;
    leadBeforePlayer = null;
    refresh();
    persist();

    if (!opts.announce) return;
    const phase = course.phase;
    if (phase === 'teach') {
      void remark(
        `A new lesson is open: "${lesson.id}". ${lesson.brief} ` +
        `${problem ? 'There is a position on the board to talk about. ' : ''}` +
        'Explain it in two or three sentences, then call begin_exercise to put the practice up. ' +
        'Do not ask them to play yet.',
      );
    } else if (phase === 'practice') {
      void remark(
        `The practice position for "${lesson.id}" is now on the board, and the student is Black. ` +
        `What they have to do: ${goalText(lesson.id, 'practice')} Tell them, in one line. Do not give the answer.`,
      );
    } else if (phase === 'quiz') {
      // Deliberately no remark: the test is the one part of a lesson where the
      // coach has to be quiet, or it is not a test.
      void 0;
    }
  }

  /** What the banner says the student has to do — the same sentence the coach
   *  is briefed with, so they cannot drift apart. */
  function goalText(lessonId: string, phase: 'practice' | 'quiz'): string {
    return t(`lesson.${lessonId}${phase === 'quiz' ? '.quiz' : '.goal'}` as Parameters<typeof t>[0]);
  }

  /** Did that move finish the exercise? Called once White has answered, where
   *  White answers at all. */
  function judgeExercise(played: string): void {
    const lesson = course.lesson;
    const problem = course.problem();
    if (!game || !lesson || !problem) return;
    const phase = course.phase;
    const met = goalMet(problem.goal, { game, capturesBefore: capturesAtStart });

    if (met) {
      const passedQuiz = phase === 'quiz';
      course.advance();
      if (passedQuiz && course.phase === 'done') {
        void remark(
          `The student passed the test for "${lesson.id}" with ${played}. Say one short thing worth ` +
          'remembering about the idea, and tell them the next lesson is ready.',
        );
        void coach.summarise();
      } else {
        void remark(`The student solved the practice for "${lesson.id}" with ${played}. One line of praise, then say the test is next.`);
      }
      setUpPhase({ announce: false });
      refresh();
      persist();
      return;
    }

    const attempts = course.missed();
    if (phase === 'quiz') {
      // A test is one attempt at a time, and silence in between. Two failures
      // and it goes back to practice — the explaining was not what failed, so
      // the lesson does not restart from the top.
      if (attempts >= 2) {
        course.backToPractice();
        setUpPhase({ announce: true });
        void remark(`The student failed the test for "${lesson.id}" twice (last try ${played}). Take them back to the practice and explain what they missed.`);
      } else {
        setUpPhase({ announce: false });
      }
    } else {
      setUpPhase({ announce: false });
      void remark(`The student tried ${played} in the "${lesson.id}" practice and it did not achieve it. Nudge them — a hint, not the answer.`);
    }
    refresh();
    persist();
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
      status.textContent = t('hud.engineStumbled');
    } finally {
      thinking = false;
      refresh();
      persist();
    }

    const taken = game.captures.white - before;
    if (game.over) {
      void finish();
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

    // Inside a lesson the move is judged against the exercise, not against the
    // engine's opinion of the whole board — "you lost 3 points" is not an
    // answer to "did you capture that stone".
    if (course.active && course.phase !== 'teach') {
      const problem = course.problem();
      void (async () => {
        // White answers only where the exercise says so: a one-move problem
        // that fires back a reply punishes a beginner for a move they were
        // never asked to read.
        if (problem?.reply) await engineTurn();
        judgeExercise(played);
      })();
      return;
    }

    void (async () => {
      await engineTurn();
      // Judge the student's move only against a baseline that exists, and only
      // once the engine has answered — a lead that moved because of White's
      // reply is not the student's mistake.
      if (!game || game.over || leadBeforePlayer === null || !read) return;
      const lost = leadBeforePlayer - read.scoreLead;
      const better = read.candidates.slice(0, 3).map((c) => toGtp(c.x, c.y, game!.size)).join(', ');
      const note =
        `The student played ${played}. By the engine's count that changed their lead by ` +
        `${(-lost).toFixed(1)} points, to ${read.scoreLead.toFixed(1)}. It would have played ${better}.`;

      // A student who said they are here to LEARN gets a word every move. That
      // is what being taught is; waiting for a five-point blunder before saying
      // anything is what "the coach never talks" looked like from the outside.
      // Someone who came to play gets left alone unless something happened.
      if (coach.profile.mode === 'learning') void remark(note);
      else if (lost >= BLUNDER_POINTS && game.turns.length - lastRemarkAt >= REMARK_COOLDOWN) void remark(note);
    })();
  }

  attachBoardControls(canvas, (x, y) => view.pick(x, y), {
    onAim: (at) => {
      const playable = game && !game.over && !thinking && game.toPlay === HUMAN ? game : null;
      view.setGhost(at && playable?.legal(at.x, at.y) ? at : null, HUMAN);
    },
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
  const button = (key: Parameters<typeof t>[0], onClick: () => void): HTMLButtonElement => {
    const b = document.createElement('button');
    b.textContent = t(key);
    b.onclick = onClick;
    bar.appendChild(b);
    return b;
  };
  const menu = new Menu(
    { size: coach.profile.boardSize, level: level.id, handicap: 0 },
    {
      onLevel: (id) => { level = levelById(id); coach.profile.level = id; refresh(); persist(); },
      onStart: ({ size, handicap }) => { course.leave(); newGame(size, handicap); },
    },
  );
  button('btn.setup', () => {
    menu.sync({ size: game?.size ?? coach.profile.boardSize, level: level.id }, !!game && !game.over);
    menu.toggle();
  });

  /**
   * Show what the engine would play.
   *
   * Free, in the sense that matters: the engine runs on this machine, so a hint
   * costs a second of battery and nothing of the player's credits. The coach is
   * not involved — if they want to know WHY, they can ask, and that is the call
   * worth paying for.
   */
  const hintBtn = button('btn.hint', async () => {
    if (!game || game.over || thinking || game.toPlay !== HUMAN) return;
    hintBtn.disabled = true;
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
    } finally {
      hintBtn.disabled = false;
    }
  });

  const retryBtn = button('btn.retry', () => setUpPhase({ announce: false }));
  const nextLessonBtn = button('btn.nextLesson', () => {
    if (!course.next()) {
      // Course finished: back to an ordinary game, and the coach gets to say so.
      newGame(coach.profile.boardSize, 0);
      void remark('The student has finished the whole course. Say so, briefly, and offer a game.');
      refresh();
      return;
    }
    setUpPhase({ announce: true });
  });
  const leaveBtn = button('btn.leaveCourse', () => {
    course.leave();
    newGame(coach.profile.boardSize, 0);
  });

  const confirmBtn = button('btn.place', () => { if (armed) commit(armed); });
  confirmBtn.hidden = true;
  const passBtn = button('btn.pass', () => {
    if (!game || thinking || game.over) return;
    game.pass();
    refresh();
    // Two passes end it there and then; the engine never gets a turn.
    if (game.over) void finish();
    else void engineTurn();
  });
  const resignBtn = button('btn.resign', () => {
    if (!game || game.over) return;
    if (!window.confirm(t('confirm.resign'))) return;
    game.resign(HUMAN);
    refresh();
    persist();
    void finish();
  });
  button('btn.recentre', () => view.resetCamera());

  // ── saving ──────────────────────────────────────────────────────────────
  function persist(): void {
    coach.profile.level = level.id;
    coach.profile.course = course.progress;
    coach.course = courseView();
    autosave.queue({
      profile: coach.profile,
      messages: coach.messages,
      // An unfinished game is worth coming back to; a finished one is history.
      game: game && !game.over ? game.snapshot() : null,
    });
  }

  /** What the coach is told about the course, every turn — so it cannot lose
   *  its place in a lesson the way a long conversation loses its thread. */
  function courseView(): NonNullable<typeof coach.course> | null {
    const lesson = course.lesson;
    if (!lesson) return null;
    const { index, total } = course.position;
    const phase: Phase = course.phase;
    return {
      lesson: lesson.id,
      lesson_is_about: lesson.brief,
      phase,
      goal: phase === 'quiz' ? goalText(lesson.id, 'quiz')
        : phase === 'practice' ? goalText(lesson.id, 'practice')
          : 'explain the idea, then call begin_exercise',
      attempts: course.attempts,
      position: `${index} of ${total}`,
    };
  }

  /**
   * The end of a game: count it, show it, talk about it, remember it.
   *
   * The count comes from a FRESH read of the final position at high visits —
   * not from the read the last move was chosen with, which is one move stale
   * and can be wrong about a stone that just died. It is also the one moment in
   * the game where spending a second of thinking is free: nobody is waiting on
   * their turn.
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

    await remark(score
      ? `The game is over and counted. ${describeScore(score, game)}` +
        (score.unsettled ? ' (The position was still unsettled, so treat the count as approximate.)' : '') +
        (score.dead.length ? ` ${score.dead.length} stones were dead on the board.` : '')
      : `The game just ended. ${describeEnd(game)}.`);

    // Written last, when the game it is about is genuinely finished.
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
    // Where "continue the course" would land: the first lesson not yet passed.
    lesson: course.finished ? 0 : LESSONS.indexOf(Course.nextFor(course.progress.passed)) + 1,
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

  if (choice === 'learn') {
    coach.profile.mode = 'learning';
    course.start(course.progress.lesson ?? undefined);
    setUpPhase({ announce: true });
  } else if (choice === 'continue' && saved.game) {
    game = GoGame.restore(saved.game);
    view.setBoardSize(game.size);
    refresh();
    void observePosition();
  } else {
    course.leave();
    newGame(coach.profile.boardSize, 0);
  }

  // The first thing that happens is the coach asking what the player came for
  // — unless it already knows, in which case asking again would be the rudest
  // possible way to greet someone who was here yesterday.
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
      newGame: (size: BoardSize, handicap = 0) => { course.leave(); newGame(size, handicap); },
      menu,
      course,
      learn: (id?: string) => {
        coach.profile.mode = 'learning';
        course.start(id);
        setUpPhase({ announce: false });
      },
      beginExercise: () => { if (course.phase === 'teach') { course.advance(); setUpPhase({ announce: false }); } },
      phase: () => course.phase,
      say: (text: string) => talk(text),
      redraw: redrawChat,
      speech,
      finish,
      get score() { return score; },
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
