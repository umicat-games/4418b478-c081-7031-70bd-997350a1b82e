// What the game says, in the player's language.
//
// The companion already answers in whatever language it is written to in —
// that is in its playbook. This is the other half: the buttons, the status
// line, the result. A game whose coach speaks Chinese while its buttons say
// "Resign" is a game that looks half-translated, because it is.
//
// English is the source and the fallback; a missing key falls through to it
// rather than showing a key, because a rare English word in a Chinese UI is a
// small blemish and `hud.yourMove` is a bug report.
//
// **The language comes from the platform, and from nowhere else.** The host
// sends `locale` at handshake, from the player's Umicat language setting, and
// the game switches to it. It arrives once, at init.
//
// Move notation is NOT translated. `Nf3` is `Nf3` in every language a chess
// player reads, and localising the piece letters would make the board and the
// coach disagree about what a move is called.
type Vars = Record<string, string | number>;

const EN = {
  'title.continue': 'Continue',
  'title.newGame': 'New game',
  'title.fresh': 'Make it forget me',
  'title.freshHint': 'Erase what the companion knows about you — your games, your habits, everything it has learned.',
  'title.freshConfirm': 'This erases everything the companion knows about you: its notes, your games, the unfinished board. A new game does NOT do this. Sure?',
  'title.loading': 'Waking up the engine…',
  'title.failed': 'The engine could not load — the coach can still talk.',

  'hud.yourMove': 'Your move · {level}',
  'hud.yourMoveCheck': 'You are in check · {level}',
  'hud.thinking': 'Thinking…',
  'hud.theirMove': 'Their move',
  'hud.youResigned': 'You resigned — game over.',
  'hud.theyResigned': 'They resigned — you win.',
  'hud.engineStumbled': 'The engine stumbled — your move again.',
  'hud.looking': 'Looking…',
  'hud.howToMove': 'Tap a piece, then a square, and confirm with the tick.',
  'hud.engineWouldPlay': 'The engine would play {move}.',

  'btn.log': 'Conversation',
  'btn.place': 'Play',
  'over.win': 'You win',
  'over.loss': 'You lose',
  'over.draw': 'A draw',
  'over.again': 'Play again',
  'over.toTitle': 'Back to title',
  'over.close': 'Look at the board',
  'over.mate': 'Checkmate on move {moves}.',
  'over.stalemate': 'Stalemate — no legal move, and not in check. {moves} moves.',
  'over.repetition': 'The same position three times — {moves} moves.',
  'over.fifty': 'Fifty moves with no pawn moved and nothing captured.',
  'over.insufficient': 'Neither side has enough left to mate.',
  'over.youResigned': 'You resigned after {moves} moves.',
  'over.theyResigned': 'Your opponent resigned after {moves} moves.',

  'btn.setup': 'Setup',
  'btn.hint': 'Hint',
  'btn.takeback': 'Take back',
  'btn.resign': 'Resign',
  'btn.recentre': 'Straighten up',
  'confirm.resign': 'Resign this game?',

  'menu.heading': 'Settings',
  'menu.newHeading': 'New game',
  'menu.side': 'You play',
  'menu.white': 'White',
  'menu.black': 'Black',
  'menu.opponent': 'Opponent',
  'menu.companion': 'AI assistant',
  'menu.on': 'On',
  'menu.off': 'Off',
  'menu.odds': 'Odds',
  'menu.none': 'None',
  'menu.oddsKnight': 'No knight',
  'menu.oddsRook': 'No rook',
  'menu.oddsQueen': 'No queen',
  'menu.oddsAbout': 'Take a piece off their side. An old and honest way to make a game fair.',
  'menu.start': 'Start playing',
  'menu.startNew': 'Start a new game',
  'menu.toTitle': 'Back to title',
  'menu.sound': 'Sound',
  'menu.music': 'Music',
  'menu.effects': 'Effects',
  'menu.eval': 'Eval bar',

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
  'chat.speak': 'Speak',
  'chat.stopRecording': 'Done',
  'chat.marked': 'Marked it on the board.',
  'chat.midGame': 'This game is still going — to start a new one, use the gear at the bottom left.',
  'chat.markFailed': 'I could not find “{squares}” on this board — ask me again and I will point properly.',
  // What the board counted, said out loud by the GAME. The model asked on the
  // player's behalf and has already finished its turn; waiting for it to speak
  // again shows the player some rings and never tells them the answer.
  'chat.attacks': '{square}: attacked by {attackers}, defended by {defenders}. Marked on the board.',
  'chat.attacksNothing': 'nothing',
  'chat.moves': 'The {piece} on {square} has {count} legal move(s): {moves}.',
  'chat.movesNone': 'The piece on {square} has nowhere to go.',
  'chat.notASquare': '“{square}” is not a square on this board.',

  'speech.playHere': 'Play {move}',
  'speech.reply': 'Reply…',

  'askhere.about': 'About {square}',
  'askhere.placeholder': 'Ask about this square…',

  'promo.heading': 'Promote to',
  'promo.queen': 'Queen',
  'promo.rook': 'Rook',
  'promo.bishop': 'Bishop',
  'promo.knight': 'Knight',

  'result.youMate': 'Checkmate — you win.',
  'result.theyMate': 'Checkmate — you lose.',
  'result.youResigned': 'You resigned — they win.',
  'result.theyResigned': 'They resigned — you win.',
  'result.stalemate': 'Stalemate — a draw. They had no legal move and were not in check.',
  'result.repetition': 'Draw — the same position three times.',
  'result.fifty': 'Draw — fifty moves with no capture and no pawn move.',
  'result.insufficient': 'Draw — neither side has enough material to mate.',

  'eval.you': 'You',
  'eval.them': 'Them',
  'eval.mateIn': 'M{n}',

  'level.gentle': 'Gentle',
  'level.gentle.about': 'Looks one move ahead. Will leave a piece hanging, and will not always take yours.',
  'level.steady': 'Steady',
  'level.steady.about': 'Sees a short exchange. Takes what you leave hanging, misses a two-move trick.',
  'level.sharp': 'Sharp',
  'level.sharp.about': 'Finds forks and pins. Punishes a loose piece the move after you drop it.',
  'level.strong': 'Strong',
  'level.strong.about': 'Full strength. Expect to lose.',
};

export type Key = keyof typeof EN;

const ZH: Partial<Record<Key, string>> = {
  'title.continue': '继续',
  'title.newGame': '新开一局',
  'title.fresh': '让它忘了我',
  'title.freshHint': '清除陪练对你的全部记忆——下过的棋、你的习惯、它学到的一切。',
  'title.freshConfirm': '这会清除陪练关于你的一切：它的笔记、你的对局、没下完的棋。新开一局不会这样。确定吗？',
  'title.loading': '正在唤醒引擎…',
  'title.failed': '引擎没能加载——陪练照样能说话。',

  'hud.yourMove': '该你走 · {level}',
  'hud.yourMoveCheck': '你被将军了 · {level}',
  'hud.thinking': '思考中…',
  'hud.theirMove': '对方走棋',
  'hud.youResigned': '你认输了——本局结束。',
  'hud.theyResigned': '对方认输——你赢了。',
  'hud.engineStumbled': '引擎出了点岔子——还是你走。',
  'hud.looking': '看一下…',
  'hud.howToMove': '点一个子，再点要去的格子，然后按对勾确认。',
  'hud.engineWouldPlay': '引擎会走 {move}。',

  'btn.log': '对话记录',
  'btn.place': '走这步',
  'over.win': '你赢了',
  'over.loss': '你输了',
  'over.draw': '和棋',
  'over.again': '再来一盘',
  'over.toTitle': '返回标题',
  'over.close': '看看棋盘',
  'over.mate': '第 {moves} 回合将死。',
  'over.stalemate': '逼和 —— 无子可动,也没有被将。共 {moves} 回合。',
  'over.repetition': '同一局面出现三次 —— 共 {moves} 回合。',
  'over.fifty': '五十回合无吃子、无兵动。',
  'over.insufficient': '双方子力都不足以将死。',
  'over.youResigned': '你在第 {moves} 回合认输。',
  'over.theyResigned': '对手在第 {moves} 回合认输。',

  'btn.setup': '设置',
  'btn.hint': '提示',
  'btn.takeback': '悔棋',
  'btn.resign': '认输',
  'btn.recentre': '摆正视角',
  'confirm.resign': '这局认输？',

  'menu.heading': '设置',
  'menu.newHeading': '新开一局',
  'menu.side': '你执',
  'menu.white': '白',
  'menu.black': '黑',
  'menu.opponent': '对手',
  'menu.companion': 'AI 助手',
  'menu.on': '打开',
  'menu.off': '关闭',
  'menu.odds': '让子',
  'menu.none': '不让',
  'menu.oddsKnight': '让一马',
  'menu.oddsRook': '让一车',
  'menu.oddsQueen': '让一后',
  'menu.oddsAbout': '从对方那边拿掉一个子。让棋是几百年的老办法，不丢人。',
  'menu.start': '开始下',
  'menu.startNew': '重新开一局',
  'menu.toTitle': '回到标题',
  'menu.sound': '声音',
  'menu.music': '音乐',
  'menu.effects': '音效',
  'menu.eval': '优劣条',

  'chat.coach': '陪练',
  'chat.ask': '问陪练…',
  'chat.tap': '点开',
  'chat.close': '收起',
  'chat.sayHello': '打个招呼吧。',
  'chat.thinking': '想一下…',
  'chat.micBlocked': '麦克风被挡住了——打字吧',
  'chat.micRetry': '没听清——再说一次',
  'chat.signIn': '登录之后我就能一路讲给你听。棋盘本身登不登录都能下。',
  'chat.noCredits': '我的额度用完了，先不说话了——棋照下。',
  'chat.lost': '我走神了，再问我一遍？',

  'speech.playHere': '走 {move}',
  'speech.reply': '回复…',

  'askhere.about': '关于 {square}',
  'askhere.placeholder': '问问这个格子…',

  'promo.heading': '升变成',
  'promo.queen': '后',
  'promo.rook': '车',
  'promo.bishop': '象',
  'promo.knight': '马',

  'result.youMate': '将死——你赢了。',
  'result.theyMate': '将死——你输了。',
  'result.youResigned': '你认输了——对方赢。',
  'result.theyResigned': '对方认输——你赢了。',
  'result.stalemate': '逼和——和棋。对方无子可动，又没有被将军。',
  'result.repetition': '和棋——同一个局面出现了三次。',
  'result.fifty': '和棋——五十回合没有吃子、没有动兵。',
  'result.insufficient': '和棋——双方的子力都不足以将死对方。',

  'eval.you': '你',
  'eval.them': '对方',
  'eval.mateIn': '杀{n}',

  'level.gentle': '温和',
  'level.gentle.about': '只看一步。会把子放在那儿被吃，也不一定会来吃你的。',
  'level.steady': '稳健',
  'level.steady.about': '能算一个短兑换。你送的子它会拿，两步的战术它看不见。',
  'level.sharp': '犀利',
  'level.sharp.about': '会抓双击和牵制。你一松手，下一步就被罚。',
  'level.strong': '全力',
  'level.strong.about': '不留手。做好输的准备。',
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
