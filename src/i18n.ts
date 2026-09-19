// What the game says, in the player's language.
//
// The coach already answers in whatever language it is written to in — that is
// in its playbook. This is the other half: the buttons, the status line, the
// result. A game whose coach speaks Chinese while its buttons say "Resign" is
// a game that looks half-translated, because it is.
//
// English is the source and the fallback; a missing key falls through to it
// rather than showing a key, because a rare English word in a Chinese UI is a
// small blemish and `hud.yourMove` is a bug report.
//
// **The language comes from the platform, and from nowhere else.** The host
// sends `locale` at handshake, from the player's Umicat language setting, and
// the game switches to it — the same contract every other Umicat surface
// follows, which is what makes the language one setting instead of one per
// place. It arrives once, at init: changing it is a platform action, and the
// game is reloaded around it.
//
// Chat is the exception, and it is not this file's business: the coach replies
// in whatever language it is written to, because a conversation follows the
// person talking. That rule lives in its playbook.
//
// Adding a language: write a table, add it to TABLES under its locale tags.
// Nothing else in the game looks at a language id.

type Vars = Record<string, string | number>;

const EN = {
  'title.tagline': 'Play Go against a real engine, with a coach who will talk you through it.',
  'title.start': 'Start',
  'title.play': 'Play',
  'title.continue': 'Continue',
  'title.newGame': 'New game',
  'title.learn': 'Learn to play',
  'title.continueLesson': 'Continue lesson {index}',
  'title.fresh': 'Start fresh',
  'title.freshHint': 'Forget everything the coach knows about you, and begin again.',
  'title.freshConfirm': 'This clears the coach’s memory of you and any unfinished game. Sure?',
  'title.loading': 'Waking up the engine…',
  'title.ready': 'Engine ready.',
  'title.failed': 'The engine could not load — the coach can still talk.',

  'hud.yourMove': 'Your move · {level}',
  'hud.whiteThinking': 'White is thinking…',
  'hud.whiteToPlay': 'White to play',
  'hud.counting': 'Both passed — counting…',
  'hud.youResigned': 'You resigned — game over.',
  'hud.whiteResigned': 'White resigned — game over.',
  'hud.engineStumbled': 'The engine stumbled — your move again.',
  'hud.looking': 'Looking…',
  'hud.howToPlaceMouse': 'Click an intersection to place a stone.',
  'hud.howToPlaceTouch': 'Touch the board, slide to aim, then tap Place.',
  'hud.engineWouldPlay': 'The engine would play {point}.',
  'hud.engineWouldPass': 'The engine would pass.',

  'btn.retry': 'Try again',
  'btn.nextLesson': 'Next lesson',
  'btn.leaveCourse': 'Just play',
  'btn.learn': 'Teach me',

  'course.banner': 'Lesson {index}/{total} · {name}',
  'course.phase.teach': 'Explaining',
  'course.phase.practice': 'Practice',
  'course.phase.quiz': 'Test',
  'course.phase.done': 'Passed',
  'course.passed': 'Passed.',
  'course.missed': 'That is not it yet.',
  'course.quizSilent': 'Test — no hints on this one.',
  'course.finished': 'You have finished the course.',

  'lesson.liberties': 'Liberties and capture',
  'lesson.liberties.goal': 'Take the white stone off the board.',
  'lesson.liberties.quiz': 'Capture both white stones.',
  'lesson.atari': 'Atari, and getting out',
  'lesson.atari.goal': 'Put the white stone in atari — down to its last liberty.',
  'lesson.atari.quiz': 'Your stone is in atari. Save it.',
  'lesson.connect': 'Connect and cut',
  'lesson.connect.goal': 'Join your two stones into one group.',
  'lesson.connect.quiz': 'Cut White apart so the two stones can never join.',
  'lesson.twoeyes': 'Two eyes',
  'lesson.twoeyes.goal': 'Make this group alive: two separate eyes.',
  'lesson.twoeyes.quiz': 'Same idea, other corner. Make it live.',
  'lesson.territory': 'Territory and counting',
  'lesson.territory.goal': 'Play a whole game to the end.',
  'lesson.territory.quiz': 'Play it out. Pass when nothing useful is left.',

  'btn.place': 'Place',
  'btn.pass': 'Pass',
  'btn.resign': 'Resign',
  'btn.recentre': 'Recentre',
  'btn.setup': 'Setup',
  'btn.hint': 'Hint',
  'confirm.resign': 'Resign this game?',

  'menu.board': 'Board',
  'menu.opponent': 'Opponent',
  'menu.handicap': 'Head start',
  'menu.none': 'None',
  'menu.start': 'Start',
  'menu.startNew': 'Start a new game',
  'menu.note': 'Board and head start apply to the next game.',

  'chat.coach': 'Coach',
  'chat.ask': 'Ask the coach…',
  'chat.tap': 'tap',
  'chat.close': 'close',
  'chat.sayHello': 'Say hello.',
  'chat.thinking': 'thinking…',
  'chat.micBlocked': 'Microphone blocked — type instead',
  'chat.micRetry': 'Did not catch that — try again',
  'chat.signIn': 'Sign in and I can talk you through the game. The board works either way.',
  'chat.noCredits': 'I am out of credits, so I will stop talking — the game plays on without me.',
  'chat.lost': 'I lost my train of thought. Ask me again?',

  'score.youWin': 'You win by {margin} points. Black {black}, White {white} ({komi} of that is komi).',
  'score.whiteWins': 'White wins by {margin} points. Black {black}, White {white} ({komi} of that is komi).',
  'score.youResigned': 'White wins — you resigned.',
  'score.whiteResigned': 'You win — White resigned.',

  'level.gentle': 'Gentle',
  'level.gentle.about': 'Plays sound shapes, misses what you are threatening.',
  'level.steady': 'Steady',
  'level.steady.about': 'Sees one exchange ahead. Will take what you leave hanging.',
  'level.sharp': 'Sharp',
  'level.sharp.about': 'Reads capture races. Punishes loose shape.',
  'level.strong': 'Strong',
  'level.strong.about': 'Full strength for this board. Expect to lose.',
};

export type Key = keyof typeof EN;

const ZH: Partial<Record<Key, string>> = {
  'title.tagline': '跟真正的围棋引擎下棋,旁边有个会讲解的老师。',
  'title.start': '开始',
  'title.play': '开始下',
  'title.continue': '继续',
  'title.newGame': '新开一局',
  'title.learn': '从头学围棋',
  'title.continueLesson': '继续第 {index} 课',
  'title.fresh': '从头开始',
  'title.freshHint': '让老师忘掉关于你的一切,重新认识。',
  'title.freshConfirm': '这会清掉老师对你的记忆和没下完的棋局。确定吗?',
  'title.loading': '正在唤醒引擎…',
  'title.ready': '引擎就绪。',
  'title.failed': '引擎没能加载 —— 老师还是可以说话。',

  'hud.yourMove': '该你了 · {level}',
  'hud.whiteThinking': '白棋在想…',
  'hud.whiteToPlay': '轮到白棋',
  'hud.counting': '双方停一手 —— 正在数子…',
  'hud.youResigned': '你认输了 —— 本局结束。',
  'hud.whiteResigned': '白棋认输 —— 本局结束。',
  'hud.engineStumbled': '引擎出了点岔子 —— 请再下一手。',
  'hud.looking': '正在看…',
  'hud.howToPlaceMouse': '点一下交叉点就能落子。',
  'hud.howToPlaceTouch': '手指按住棋盘挪到位置,再点「落子」。',
  'hud.engineWouldPlay': '引擎会下 {point}。',
  'hud.engineWouldPass': '引擎会停一手。',

  'btn.retry': '再试一次',
  'btn.nextLesson': '下一课',
  'btn.leaveCourse': '只想下棋',
  'btn.learn': '教我',

  'course.banner': '第 {index}/{total} 课 · {name}',
  'course.phase.teach': '讲解',
  'course.phase.practice': '练习',
  'course.phase.quiz': '测验',
  'course.phase.done': '通过',
  'course.passed': '过了。',
  'course.missed': '这手还不行。',
  'course.quizSilent': '测验 —— 这一题没有提示。',
  'course.finished': '这门课你学完了。',

  'lesson.liberties': '气与提子',
  'lesson.liberties.goal': '把那颗白子提掉。',
  'lesson.liberties.quiz': '把两颗白子一起提掉。',
  'lesson.atari': '打吃与逃跑',
  'lesson.atari.goal': '打吃那颗白子 —— 让它只剩一口气。',
  'lesson.atari.quiz': '你的子被打吃了。救它。',
  'lesson.connect': '连接与切断',
  'lesson.connect.goal': '把你的两颗子连成一块。',
  'lesson.connect.quiz': '把白棋断开,让那两颗子再也接不上。',
  'lesson.twoeyes': '两只眼',
  'lesson.twoeyes.goal': '让这块棋活起来:做出两只眼。',
  'lesson.twoeyes.quiz': '同一个道理,换个角。让它活。',
  'lesson.territory': '地盘与数子',
  'lesson.territory.goal': '下完整整一盘。',
  'lesson.territory.quiz': '下到底。没棋可下的时候停一手。',

  'btn.place': '落子',
  'btn.pass': '停一手',
  'btn.resign': '认输',
  'btn.recentre': '回正',
  'btn.setup': '设置',
  'btn.hint': '提示',
  'confirm.resign': '这局认输?',

  'menu.board': '棋盘',
  'menu.opponent': '对手',
  'menu.handicap': '让子',
  'menu.none': '不让',
  'menu.start': '开始',
  'menu.startNew': '新开一局',
  'menu.note': '棋盘和让子从下一局开始生效。',

  'chat.coach': '老师',
  'chat.ask': '问老师…',
  'chat.tap': '点开',
  'chat.close': '收起',
  'chat.sayHello': '打个招呼吧。',
  'chat.thinking': '在想…',
  'chat.micBlocked': '麦克风被挡住了 —— 打字吧',
  'chat.micRetry': '没听清 —— 再说一次',
  'chat.signIn': '登录之后我就能给你讲解。棋盘不登录也能下。',
  'chat.noCredits': '我的额度用完了,先不说话了 —— 棋照样能下。',
  'chat.lost': '我走神了,再问我一次?',

  'score.youWin': '你赢了 {margin} 目。黑 {black},白 {white}(其中 {komi} 是贴目)。',
  'score.whiteWins': '白棋赢了 {margin} 目。黑 {black},白 {white}(其中 {komi} 是贴目)。',
  'score.youResigned': '白棋胜 —— 你认输了。',
  'score.whiteResigned': '你赢了 —— 白棋认输。',

  'level.gentle': '和气',
  'level.gentle.about': '下法规矩,但看不出你在威胁什么。',
  'level.steady': '稳当',
  'level.steady.about': '能算一个回合。你留下的破绽它会拿。',
  'level.sharp': '犀利',
  'level.sharp.about': '会算对杀,形状松了就要挨罚。',
  'level.strong': '全力',
  'level.strong.about': '这块棋盘上的全部实力。做好输的准备。',
};

const TABLES: Record<string, Partial<Record<Key, string>>> = { 'zh-CN': ZH, zh: ZH, 'zh-TW': ZH, 'zh-HK': ZH };

let table: Partial<Record<Key, string>> = {};
let current = 'en';

/** Which language the UI is speaking right now. */
export const locale = (): string => current;

/** Call once, as early as the platform hands over a locale. */
export function setLocale(next: string | undefined): void {
  current = next || 'en';
  table = TABLES[current] ?? TABLES[current.split('-')[0]] ?? {};
}

/** A string, with `{name}` placeholders filled in. */
export function t(key: Key, vars?: Vars): string {
  const raw = table[key] ?? EN[key];
  if (!vars) return raw;
  return raw.replace(/\{(\w+)\}/g, (_, name: string) => String(vars[name] ?? `{${name}}`));
}
