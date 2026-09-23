// What the game says, in the player's language.
//
// The assistant answers in whatever language it is written to — that is in its
// playbook. This is the other half: the buttons, the status line, the result.
// A game whose assistant speaks Chinese while its buttons say "Resign" is a
// game that looks half-translated, because it is.
//
// English is the source and the fallback; a missing key falls through to it
// rather than showing a key, because a rare English word in a Chinese UI is a
// small blemish and `hud.yourMove` is a bug report.
//
// **The language comes from the platform, and from nowhere else.** The host
// sends `locale` at handshake, from the player's Umicat language setting. It
// arrives once, at init.
//
// FORKING THIS: the keys below are half shell and half game. Everything under
// `title.`, `btn.`, `menu.`, `chat.`, `askhere.`, `speech.` is used by
// `src/shell/` and should keep its name; `hud.`, `result.`, `threat.` and
// `level.` belong to the game and are yours to replace.

type Vars = Record<string, string | number>;

const EN = {
  'title.name': 'Othello with me',
  'title.continue': 'Continue',
  'title.newGame': 'New game',
  'title.fresh': 'Make it forget me',
  'title.freshHint': 'Erase what the assistant knows about you — your games, your habits, everything it has learned.',
  'title.freshConfirm': 'This erases everything the assistant knows about you: its notes, your games, the unfinished board. A new game does NOT do this. Sure?',
  'title.loading': 'Setting up the board…',

  'hud.yourMove': 'Your move · {level}',
  'hud.youPassed': 'You have no legal move — your turn is skipped.',
  'hud.theyPassed': 'White has no legal move — your turn again.',
  'hud.discs': '{black} – {white}',
  'hud.thinking': 'White is thinking…',
  'hud.theirMove': 'White to play',
  // The two seats either side of the board.
  'plate.you': 'You',
  'plate.engine': 'Computer',
  'plate.discs': '{n} discs',
  'plate.thinking': 'thinking…',
  'hud.engineStumbled': 'The engine stumbled — your move again.',
  'hud.looking': 'Looking…',
  'hud.howToPlace': 'Green dots are where you may play. Tap one, then confirm with the tick.',
  'hud.engineWouldPlay': 'The engine would play {point}.',

  'result.youWin': 'You win, {black} discs to {white}.',
  'result.youLose': 'White wins, {white} discs to {black}.',
  'result.draw': 'A draw — {black} each.',
  'result.youResigned': 'You resigned — White wins.',
  'result.theyResigned': 'White resigns — you win.',

  'over.win': 'You win',
  'over.loss': 'White wins',
  'eval.solvedWin': 'won',
  'eval.solvedLoss': 'lost',
  'over.draw': 'A draw',
  'over.again': 'Play again',
  'over.toTitle': 'Back to title',
  'over.close': 'Look at the board',
  'over.counted': '{black} discs to {white}, in {moves} moves.',
  'over.youResigned': 'You resigned after {moves} moves.',
  'over.theyResigned': 'White resigned after {moves} moves.',

  'btn.setup': 'Setup',
  'btn.log': 'Conversation',
  'btn.hint': 'Hint',
  'btn.resign': 'Resign',
  'btn.recentre': 'Recentre',
  'confirm.resign': 'Resign this game?',

  'menu.heading': 'Settings',
  'menu.newHeading': 'New game',
  'menu.opponent': 'Opponent',
  'menu.companion': 'AI assistant',
  'menu.on': 'On',
  'menu.off': 'Off',
  'menu.start': 'Start playing',
  'menu.startNew': 'Start a new game',
  'menu.toTitle': 'Back to title',
  'menu.more': 'More settings',
  'menu.less': 'Fewer settings',
  'menu.sound': 'Sound',
  'menu.music': 'Music',
  'menu.effects': 'Effects',
  'menu.eval': 'Eval bar',

  'chat.coach': 'Assistant',
  'chat.ask': 'Ask the assistant…',
  'chat.tap': 'tap',
  'chat.close': 'close',
  'chat.sayHello': 'Say hello.',
  'chat.thinking': 'thinking…',
  'chat.speak': 'Speak',
  'chat.stopRecording': 'Done',
  'chat.micBlocked': 'Microphone blocked — type instead',
  'chat.micRetry': 'Did not catch that — try again',
  'chat.signIn': 'Sign in and I can talk you through the game. The board works either way.',
  'chat.noCredits': 'I am out of credits, so I will stop talking — the game plays on without me.',
  'chat.lost': 'I lost my train of thought. Ask me again?',
  'chat.marked': 'Marked it on the board.',
  'chat.midGame': 'This game is still going — to start a new one, use the gear at the bottom left.',
  'chat.markFailed': 'I could not find “{points}” on this board — ask me again and I will point properly.',
  'chat.moves': 'You can play: {list}. Ringed on the board.',
  'chat.movesNone': 'You have no legal move — your turn will be skipped.',
  'chat.count': 'Discs: you {black}, White {white}.',

  'askhere.about': 'About {point}',
  'askhere.placeholder': 'Ask about this point…',
  'speech.reply': 'Reply…',
  'speech.playHere': 'Play {point}',

  'eval.won': 'won',
  'eval.lost': 'lost',

  'level.gentle': 'Gentle',
  'level.gentle.about': 'Takes as many discs as it can, every time — the beginner\'s mistake, played straight.',
  'level.steady': 'Steady',
  'level.steady.about': 'Plays for position and counts the last few squares exactly.',
  'level.sharp': 'Sharp',
  'level.sharp.about': 'Looks six moves ahead, and solves the last eleven squares.',
  'level.strong': 'Strong',
  'level.strong.about': 'Everything it has, and the ending is exact. Expect to lose.',
};

export type Key = keyof typeof EN;

const ZH: Partial<Record<Key, string>> = {
  'title.name': '陪你下黑白棋',
  'title.continue': '继续',
  'title.newGame': '新开一局',
  'title.fresh': '让它忘掉我',
  'title.freshHint': '清除助手对你的全部记忆 —— 下过的棋、你的习惯、它学到的一切。',
  'title.freshConfirm': '这会清掉助手关于你的一切:它的笔记、你的棋局、没下完的那盘。「新开一局」不会这样。确定吗?',
  'title.loading': '正在摆棋盘…',

  'hud.yourMove': '该你了 · {level}',
  'hud.youPassed': '你没有可下的地方 —— 这手跳过。',
  'hud.theyPassed': '白棋没有可下的地方 —— 又该你了。',
  'hud.discs': '{black} – {white}',
  'hud.thinking': '白棋在想…',
  'hud.theirMove': '轮到白棋',
  'plate.you': '你',
  'plate.engine': '电脑',
  'plate.discs': '{n} 子',
  'plate.thinking': '思考中…',
  'hud.engineStumbled': '引擎出了点岔子 —— 请再下一手。',
  'hud.looking': '正在看…',
  'hud.howToPlace': '绿点是你能下的地方。点一个,再点对勾确认。',
  'hud.engineWouldPlay': '引擎会下 {point}。',

  'result.youWin': '你赢了,{black} 比 {white}。',
  'result.youLose': '白棋赢了,{white} 比 {black}。',
  'result.draw': '和棋 —— 各 {black} 子。',
  'result.youResigned': '你认输了 —— 白棋赢。',
  'result.theyResigned': '白棋认输 —— 你赢了。',

  'over.win': '你赢了',
  'over.loss': '白棋赢了',
  'eval.solvedWin': '已赢',
  'eval.solvedLoss': '已输',
  'over.draw': '和棋',
  'over.again': '再来一盘',
  'over.toTitle': '返回标题',
  'over.close': '看看棋盘',
  'over.counted': '{black} 比 {white},共 {moves} 手。',
  'over.youResigned': '你在第 {moves} 手认输。',
  'over.theyResigned': '白棋在第 {moves} 手认输。',

  'btn.setup': '设置',
  'btn.log': '对话记录',
  'btn.hint': '提示',
  'btn.resign': '认输',
  'btn.recentre': '回正',
  'confirm.resign': '这局认输?',

  'menu.heading': '设置',
  'menu.newHeading': '新对局',
  'menu.opponent': '对手',
  'menu.companion': 'AI 助手',
  'menu.on': '打开',
  'menu.off': '关闭',
  'menu.start': '开始下',
  'menu.startNew': '新开一局',
  'menu.toTitle': '返回标题',
  'menu.more': '更多设置',
  'menu.less': '收起',
  'menu.sound': '声音',
  'menu.music': '音乐',
  'menu.effects': '音效',
  'menu.eval': '优劣条',

  'chat.coach': '助手',
  'chat.ask': '问助手…',
  'chat.tap': '点开',
  'chat.close': '收起',
  'chat.sayHello': '打个招呼吧。',
  'chat.thinking': '在想…',
  'chat.speak': '说话',
  'chat.stopRecording': '说完了',
  'chat.micBlocked': '麦克风被挡住了 —— 打字吧',
  'chat.micRetry': '没听清 —— 再说一次',
  'chat.signIn': '登录之后我就能给你讲解。棋盘不登录也能下。',
  'chat.noCredits': '我的额度用完了,先不说话了 —— 棋照样能下。',
  'chat.lost': '我走神了,再问我一次?',
  'chat.marked': '标在棋盘上了。',
  'chat.midGame': '这盘还没下完 —— 要重开的话,点左下角的设置。',
  'chat.markFailed': '我没能在棋盘上找到「{points}」—— 再问我一次,我会指对地方。',
  'chat.moves': '你能下:{list}。已经圈在棋盘上了。',
  'chat.movesNone': '你没有可下的地方 —— 这手会被跳过。',
  'chat.count': '子数:你 {black},白棋 {white}。',

  'askhere.about': '关于 {point}',
  'askhere.placeholder': '问问这个点…',
  'speech.reply': '回复…',
  'speech.playHere': '下在 {point}',

  'eval.won': '赢定',
  'eval.lost': '输定',

  'level.gentle': '和气',
  'level.gentle.about': '每一手都吃最多的子 —— 初学者的典型错误,原样演给你看。',
  'level.steady': '稳当',
  'level.steady.about': '按位置下棋,最后几格会精确算完。',
  'level.sharp': '犀利',
  'level.sharp.about': '能算六步,最后十一格精确解完。',
  'level.strong': '全力',
  'level.strong.about': '它的全部实力,而且残局是精确的。做好输的准备。',
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
