// What the game says, in the player's language.
//
// The assistant already answers in whatever language it is written to — that
// is in its playbook. This is the other half: the buttons, the status line,
// the result of a game. A game whose assistant speaks Chinese while its
// buttons say "Resign" is a game that looks half-translated, because it is.
//
// English is the source and the fallback; a missing key falls through to it
// rather than showing a key, because a rare English word in a Chinese UI is a
// small blemish and `hud.yourMove` is a bug report.
//
// **The language comes from the platform, and from nowhere else.** The host
// sends `locale` at handshake, from the player's Umicat language setting, and
// the game switches to it — the same contract every other Umicat surface
// follows. It arrives once, at init.
//
// Chat is the exception and is not this file's business: a conversation
// follows the person talking. That rule lives in the playbook.

type Vars = Record<string, string | number>;

const EN = {
  'title.name': 'Xiangqi with me',
  'title.continue': 'Continue',
  'title.newGame': 'New game',
  'title.fresh': 'Make it forget me',
  'title.freshHint': 'Erase what the assistant knows about you — your games, your habits, everything it has learned.',
  'title.freshConfirm': 'This erases everything the assistant knows about you: its notes, your games, the unfinished board. A new game does NOT do this. Sure?',
  'title.loading': 'Setting up the board…',

  'hud.yourMove': 'Your move · {level}',
  'hud.yourMoveCheck': 'You are in check · {level}',
  'hud.blackThinking': 'Black is thinking…',
  'hud.blackToPlay': 'Black to play',
  'hud.engineStumbled': 'The engine stumbled — your move again.',
  'hud.looking': 'Looking…',
  'hud.howToMove': 'Tap a piece, tap where it goes, then confirm with the tick.',
  'hud.engineWouldPlay': 'The engine would play {move}.',

  'result.youWin': 'Checkmate — you win.',
  'result.youLose': 'Checkmate — Black wins.',
  'result.youWinStuck': 'Black has no legal move — you win.',
  'result.youLoseStuck': 'You have no legal move — Black wins.',
  'result.youResigned': 'You resigned — Black wins.',
  'result.blackResigned': 'Black resigns — you win.',
  'result.youWinPerpetual': 'Black kept checking — that loses. You win.',
  'result.youLosePerpetual': 'Perpetual check loses in xiangqi — Black wins.',
  'result.drawRepetition': 'The same position three times — a draw.',
  'result.drawQuiet': 'Sixty moves without a capture — a draw.',

  'over.win': 'You win',
  'over.loss': 'Black wins',
  'over.draw': 'A draw',
  'over.again': 'Play again',
  'over.toTitle': 'Back to title',
  'over.close': 'Look at the board',
  'over.mate': 'Checkmate on move {moves}.',
  'over.stuck': 'No legal move left — which loses in xiangqi. {moves} moves.',
  'over.perpetual': 'Checking for ever loses. {moves} moves.',
  'over.youResigned': 'You resigned after {moves} moves.',
  'over.theyResigned': 'Black resigned after {moves} moves.',
  'over.drawn': 'Neither side could make progress — {moves} moves.',

  'btn.setup': 'Setup',
  'btn.log': 'Conversation',
  'btn.hint': 'Hint',
  'btn.resign': 'Resign',
  'btn.recentre': 'Recentre',
  'confirm.resign': 'Resign this game?',

  'menu.heading': 'Settings',
  'menu.newHeading': 'New game',
  'menu.opponent': 'Opponent',
  'menu.handicap': 'Head start',
  'menu.companion': 'AI assistant',
  'menu.on': 'On',
  'menu.off': 'Off',
  'menu.start': 'Start playing',
  'menu.startNew': 'Start a new game',
  'menu.note': 'The head start applies to the next game.',
  'menu.toTitle': 'Back to title',
  'menu.eval': 'Eval bar',
  'menu.sound': 'Sound',
  'menu.music': 'Music',
  'menu.effects': 'Effects',

  'handicap.none': 'None',
  'handicap.horse': 'A horse',
  'handicap.horses': 'Both horses',
  'handicap.chariot': 'A chariot',

  'chat.coach': 'Assistant',
  'chat.ask': 'Ask the assistant…',
  'chat.tap': 'tap',
  'chat.close': 'close',
  'chat.thinking': 'thinking…',
  'chat.sayHello': 'Say hello.',
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
  'chat.moves': 'The {piece} on {point} can go to {points}. They are ringed on the board.',
  'chat.movesNone': 'The {piece} on {point} has nowhere legal to go.',
  'chat.noPiece': 'There is no piece of yours on {point}.',
  'chat.danger': 'Under attack right now: {list}. Ringed on the board.',
  'chat.dangerNone': 'Nothing of yours is attacked right now.',

  'askhere.about': 'About {point}',
  'askhere.placeholder': 'Ask about this point…',
  'speech.reply': 'Reply…',
  'speech.playHere': 'Play {point}',

  'eval.mateIn': 'M{n}',

  'level.gentle': 'Gentle',
  'level.gentle.about': 'Develops sensibly, will miss what you are threatening.',
  'level.steady': 'Steady',
  'level.steady.about': 'Sees one exchange ahead. Takes what you leave hanging.',
  'level.sharp': 'Sharp',
  'level.sharp.about': 'Looks two moves deep and punishes loose pieces.',
  'level.strong': 'Strong',
  'level.strong.about': 'Everything it has. Takes a few seconds a move.',
};

export type Key = keyof typeof EN;

const ZH: Partial<Record<Key, string>> = {
  'title.name': '陪你下象棋',
  'title.continue': '继续',
  'title.newGame': '新开一局',
  'title.fresh': '让它忘掉我',
  'title.freshHint': '清除助手对你的全部记忆 —— 下过的棋、你的习惯、它学到的一切。',
  'title.freshConfirm': '这会清掉助手关于你的一切:它的笔记、你的棋局、没下完的那盘。「新开一局」不会这样。确定吗?',
  'title.loading': '正在摆棋…',

  'hud.yourMove': '该你了 · {level}',
  'hud.yourMoveCheck': '将军!该你了 · {level}',
  'hud.blackThinking': '黑方在想…',
  'hud.blackToPlay': '轮到黑方',
  'hud.engineStumbled': '引擎出了点岔子 —— 请再走一步。',
  'hud.looking': '正在看…',
  'hud.howToMove': '点一个子,再点要去的位置,然后点对勾确认。',
  'hud.engineWouldPlay': '引擎会走 {move}。',

  'result.youWin': '将死 —— 你赢了。',
  'result.youLose': '将死 —— 黑方赢了。',
  'result.youWinStuck': '黑方无棋可走(困毙)—— 你赢了。',
  'result.youLoseStuck': '你无棋可走(困毙)—— 黑方赢了。',
  'result.youResigned': '你认输了 —— 黑方赢。',
  'result.blackResigned': '黑方认输 —— 你赢了。',
  'result.youWinPerpetual': '黑方长将 —— 长将作负,你赢了。',
  'result.youLosePerpetual': '长将作负 —— 黑方赢了。',
  'result.drawRepetition': '同一个局面出现三次 —— 和棋。',
  'result.drawQuiet': '六十回合无吃子 —— 和棋。',

  'over.win': '你赢了',
  'over.loss': '黑方赢了',
  'over.draw': '和棋',
  'over.again': '再来一盘',
  'over.toTitle': '返回标题',
  'over.close': '看看棋盘',
  'over.mate': '第 {moves} 手将死。',
  'over.stuck': '无棋可走 —— 困毙在象棋里是负。共 {moves} 手。',
  'over.perpetual': '长将作负。共 {moves} 手。',
  'over.youResigned': '你在第 {moves} 手认输。',
  'over.theyResigned': '黑方在第 {moves} 手认输。',
  'over.drawn': '双方都无法取得进展 —— 共 {moves} 手。',

  'btn.setup': '设置',
  'btn.log': '对话记录',
  'btn.hint': '提示',
  'btn.resign': '认输',
  'btn.recentre': '回正',
  'confirm.resign': '这局认输?',

  'menu.heading': '设置',
  'menu.newHeading': '新对局',
  'menu.opponent': '对手',
  'menu.handicap': '让子',
  'menu.companion': 'AI 助手',
  'menu.on': '打开',
  'menu.off': '关闭',
  'menu.start': '开始下',
  'menu.startNew': '新开一局',
  'menu.note': '让子从下一局开始生效。',
  'menu.toTitle': '返回标题',
  'menu.eval': '优劣条',
  'menu.sound': '声音',
  'menu.music': '音乐',
  'menu.effects': '音效',

  'handicap.none': '不让',
  'handicap.horse': '让一马',
  'handicap.horses': '让双马',
  'handicap.chariot': '让一车',

  'chat.coach': '助手',
  'chat.ask': '问助手…',
  'chat.tap': '点开',
  'chat.close': '收起',
  'chat.thinking': '在想…',
  'chat.sayHello': '打个招呼吧。',
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
  'chat.moves': '{point} 上的{piece}可以走:{points}。已经在棋盘上圈出来了。',
  'chat.movesNone': '{point} 上的{piece}无处可走。',
  'chat.noPiece': '{point} 上没有你的子。',
  'chat.danger': '正被攻击的:{list}。已经在棋盘上圈出来了。',
  'chat.dangerNone': '你的子现在都没有被攻击。',

  'askhere.about': '关于 {point}',
  'askhere.placeholder': '问问这个位置…',
  'speech.reply': '回复…',
  'speech.playHere': '走 {point}',

  'eval.mateIn': '杀{n}',

  'level.gentle': '和气',
  'level.gentle.about': '开局规矩,但看不出你在威胁什么。',
  'level.steady': '稳当',
  'level.steady.about': '能算一个回合。你留下的破绽它会拿。',
  'level.sharp': '犀利',
  'level.sharp.about': '能算两步,子力松了就要挨罚。',
  'level.strong': '全力',
  'level.strong.about': '它的全部实力,一步要想几秒。',
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
