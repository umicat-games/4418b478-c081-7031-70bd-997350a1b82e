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
// The locale comes from the platform (`umicat.locale`), which follows the
// player's account setting, not the browser's — so it matches the rest of
// Umicat around the game.

type Vars = Record<string, string | number>;

const EN = {
  'title.tagline': 'Play Go against a real engine, with a coach who will talk you through it.',
  'title.start': 'Start',
  'title.play': 'Play',
  'title.continue': 'Continue',
  'title.newGame': 'New game',
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
  'hud.engineWouldPlay': 'The engine would play {point}.',
  'hud.engineWouldPass': 'The engine would pass.',

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
  'hud.engineWouldPlay': '引擎会下 {point}。',
  'hud.engineWouldPass': '引擎会停一手。',

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

/** Call once, as early as the platform hands over a locale. */
export function setLocale(locale: string | undefined): void {
  table = TABLES[locale ?? ''] ?? TABLES[(locale ?? '').split('-')[0]] ?? {};
}

/** A string, with `{name}` placeholders filled in. */
export function t(key: Key, vars?: Vars): string {
  const raw = table[key] ?? EN[key];
  if (!vars) return raw;
  return raw.replace(/\{(\w+)\}/g, (_, name: string) => String(vars[name] ?? `{${name}}`));
}
