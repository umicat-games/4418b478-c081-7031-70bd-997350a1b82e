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
  'title.continue': 'Continue',
  'title.newGame': 'New game',
  'title.fresh': 'Make it forget me',
  'title.freshHint': 'Erase what the companion knows about you — your games, your habits, everything it has learned.',
  'title.freshConfirm': 'This erases everything the assistant knows about you: its notes, your games, the unfinished board. A new game does NOT do this. Sure?',
  'title.loading': 'Waking up the engine…',
  'title.ready': 'Engine ready.',
  'title.failed': 'The engine could not load — the assistant can still talk.',

  'hud.yourMove': 'Your move · {level}',
  'hud.whiteThinking': 'White is thinking…',
  'hud.whiteToPlay': 'White to play',
  'hud.counting': 'Both passed — counting…',
  'hud.youResigned': 'You resigned — game over.',
  'hud.whiteResigned': 'White resigned — game over.',
  'hud.engineStumbled': 'The engine stumbled — your move again.',
  'hud.looking': 'Looking…',
  // The two seats either side of the board.
  'plate.you': 'You',
  'plate.engine': 'KataGo',
  'plate.captures': '{n} captured',
  'plate.thinking': 'thinking…',
  'hud.howToPlace': 'Choose a point, then confirm with the tick beside it.',
  'hud.engineWouldPlay': 'The engine would play {point}.',
  'hud.engineWouldPass': 'The engine would pass.',

  'btn.retry': 'Try again',
  'btn.nextLesson': 'Next lesson',
  'btn.leaveCourse': 'Just play',
  'btn.learn': 'Teach me',
  'speech.playHere': 'Play {point}',

  'course.banner': 'Lesson {index}/{total} · {name}',
  'course.heading': 'The course',
  'course.continue': 'Continue',
  'course.locked': 'Locked',
  'course.inProgress': 'in progress',
  'course.replay': 'passed · replay',
  'course.back': 'Back',
  'course.phase.teach': 'Explaining',
  'course.phase.practice': 'Practice',
  'course.phase.quiz': 'Test',
  'course.phase.done': 'Passed',
  'course.passed': 'Passed.',
  'course.missed': 'That is not it yet.',
  'course.quizSilent': 'Test — no hints on this one.',
  'course.finished': 'You have finished the course.',

  'lesson.liberties.intro': 'A stone lives by the empty points beside it — those are its liberties.\nFill the last one and the stone comes off the board.\nBy the end of this lesson you will be able to count liberties and capture a stone.',
  'lesson.atari.intro': 'A group with one liberty left is in atari: one move from being taken.\nPutting a stone in atari and escaping from one are the same idea from opposite sides.\nBy the end you will be able to do both.',
  'lesson.connect.intro': 'Two stones side by side share their liberties and are hard to kill.\nTwo with a gap are two weak things, and one point decides which they are.\nBy the end you will see that point, and be able to play it from either side.',
  'lesson.twoeyes.intro': 'A group with two separate eyes can never be filled in, so it can never be captured.\nWith a three-point eye space, the middle makes two eyes and either end makes one.\nBy the end you will be able to make a group live.',
  'lesson.territory.intro': 'Empty points your stones surround are yours.\nWhen neither side has anything useful left, both pass and the board is counted.\nBy the end you will have played a whole game and understood the result.',
  'lesson.intro.begin': 'Begin',
  'lesson.intro.head': 'Lesson {index} of {total}',

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

  'over.win': 'You win',
  'over.loss': 'White wins',
  'over.again': 'Play again',
  'over.toTitle': 'Back to title',
  'over.close': 'Look at the board',
  'over.counted': 'Black {black}, White {white} (komi {komi} included) — {margin} points in it.',
  'over.unsettled': 'The position was still unsettled, so treat the count as approximate.',
  'over.youResigned': 'You resigned.',
  'over.theyResigned': 'White resigned.',

  'btn.place': 'Place',
  'btn.pass': 'Pass',
  'btn.resign': 'Resign',
  'btn.recentre': 'Recentre',
  'btn.setup': 'Setup',
  'btn.log': 'Conversation',
  'btn.hint': 'Hint',
  'confirm.resign': 'Resign this game?',

  'menu.heading': 'Settings',
  'menu.newHeading': 'New game',
  'menu.board': 'Board',
  'menu.opponent': 'Opponent',
  'menu.handicap': 'Head start',
  'menu.companion': 'AI assistant',
  'menu.on': 'On',
  'menu.off': 'Off',
  'menu.none': 'None',
  'menu.start': 'Start playing',
  'menu.startNew': 'Start a new game',
  'menu.note': 'Board and head start apply to the next game.',
  'menu.toTitle': 'Back to title',
  'menu.close': 'Close',
  'menu.more': 'More settings',
  'menu.less': 'Fewer settings',
  'menu.sound': 'Sound',
  'menu.music': 'Music',
  'menu.effects': 'Effects',

  'chat.coach': 'Assistant',
  'chat.ask': 'Ask the assistant…',
  'chat.tap': 'tap',
  'chat.close': 'close',
  'chat.sayHello': 'Say hello.',
  'chat.thinking': 'thinking…',
  'askhere.about': 'About {point}',
  'askhere.placeholder': 'Ask about this point…',
  'speech.reply': 'Reply…',
  'chat.speak': 'Speak',
  'chat.stopRecording': 'Done',
  'chat.micBlocked': 'Microphone blocked — type instead',
  'chat.micRetry': 'Did not catch that — try again',
  'chat.signIn': 'Sign in and I can talk you through the game. The board works either way.',
  'chat.noCredits': 'I am out of credits, so I will stop talking — the game plays on without me.',
  'chat.lost': 'I lost my train of thought. Ask me again?',
  'chat.marked': 'Marked it on the board.',
  'chat.midGame': 'This game is still going — to start a new one, or change the board, use the gear at the bottom left.',
  'chat.markFailed': 'I could not find “{points}” on this board — ask me again and I will point properly.',
  'chat.liberties': '{point}: {stones} stone(s), {liberties} liberties — {points}. They are ringed on the board.',
  'chat.libertiesNone': 'There is no stone at {point}, so it has no liberties.',

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
  'title.continue': '继续',
  'title.newGame': '新开一局',
  'title.fresh': '让它忘掉我',
  'title.freshHint': '清除助手对你的全部记忆 —— 下过的棋、你的习惯、它学到的一切。',
  'title.freshConfirm': '这会清掉助手关于你的一切:它的笔记、你的棋局、没下完的那盘。「新开一局」不会这样。确定吗?',
  'title.loading': '正在唤醒引擎…',
  'title.ready': '引擎就绪。',
  'title.failed': '引擎没能加载 —— 助手还是可以说话。',

  'hud.yourMove': '该你了 · {level}',
  'hud.whiteThinking': '白棋在想…',
  'hud.whiteToPlay': '轮到白棋',
  'hud.counting': '双方停一手 —— 正在数子…',
  'hud.youResigned': '你认输了 —— 本局结束。',
  'hud.whiteResigned': '白棋认输 —— 本局结束。',
  'hud.engineStumbled': '引擎出了点岔子 —— 请再下一手。',
  'hud.looking': '正在看…',
  'plate.you': '你',
  'plate.engine': 'KataGo',
  'plate.captures': '提 {n} 子',
  'plate.thinking': '思考中…',
  'hud.howToPlace': '选一个点,再点旁边的对勾确认。',
  'hud.engineWouldPlay': '引擎会下 {point}。',
  'hud.engineWouldPass': '引擎会停一手。',

  'btn.retry': '再试一次',
  'btn.nextLesson': '下一课',
  'btn.leaveCourse': '只想下棋',
  'btn.learn': '教我',
  'speech.playHere': '下在 {point}',

  'course.banner': '第 {index}/{total} 课 · {name}',
  'course.heading': '课程',
  'course.continue': '继续',
  'course.locked': '未解锁',
  'course.inProgress': '进行中',
  'course.replay': '已通过 · 可重学',
  'course.back': '返回',
  'course.phase.teach': '讲解',
  'course.phase.practice': '练习',
  'course.phase.quiz': '测验',
  'course.phase.done': '通过',
  'course.passed': '过了。',
  'course.missed': '这手还不行。',
  'course.quizSilent': '测验 —— 这一题没有提示。',
  'course.finished': '这门课你学完了。',

  'lesson.liberties.intro': '棋子靠旁边的空点活着,那些空点叫「气」。\n把最后一口气堵住,这颗子就被提掉。\n学完这一课,你会数气,也能吃掉一颗子。',
  'lesson.atari.intro': '只剩一口气的棋叫「被打吃」,下一手就会被提走。\n打吃别人和从打吃里逃出来,是同一件事的两面。\n学完这一课,两样你都会。',
  'lesson.connect.intro': '挨在一起的两颗子共用气,不好吃;隔开的两颗,是两块弱棋。\n决定它们是一块还是两块的,往往只有一个点。\n学完这一课,你能看出那个点,而且两边都会下。',
  'lesson.twoeyes.intro': '有两只眼的棋永远填不满,也就永远吃不掉。\n三个点的眼位:下中间做出两只眼,下两头只剩一只。\n学完这一课,你能把一块棋做活。',
  'lesson.territory.intro': '被你的子围住的空点,就是你的地。\n双方都没棋可下时各停一手,然后数子定胜负。\n学完这一课,你会下完整整一盘,并且看得懂结果。',
  'lesson.intro.begin': '开始',
  'lesson.intro.head': '第 {index} 课 / 共 {total} 课',

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

  'over.win': '你赢了',
  'over.loss': '白棋赢了',
  'over.again': '再来一盘',
  'over.toTitle': '返回标题',
  'over.close': '看看棋盘',
  'over.counted': '黑 {black},白 {white}(含贴目 {komi})—— 相差 {margin} 目。',
  'over.unsettled': '局面还没定下来,这个数只能算大概。',
  'over.youResigned': '你认输了。',
  'over.theyResigned': '白棋认输。',

  'btn.place': '落子',
  'btn.pass': '停一手',
  'btn.resign': '认输',
  'btn.recentre': '回正',
  'btn.setup': '设置',
  'btn.log': '对话记录',
  'btn.hint': '提示',
  'confirm.resign': '这局认输?',

  'menu.heading': '设置',
  'menu.newHeading': '新对局',
  'menu.board': '棋盘',
  'menu.opponent': '对手',
  'menu.handicap': '让子',
  'menu.companion': 'AI 助手',
  'menu.on': '打开',
  'menu.off': '关闭',
  'menu.none': '不让',
  'menu.start': '开始下',
  'menu.startNew': '新开一局',
  'menu.note': '棋盘和让子从下一局开始生效。',
  'menu.toTitle': '返回标题',
  'menu.close': '关闭',
  'menu.more': '更多设置',
  'menu.less': '收起',
  'menu.sound': '声音',
  'menu.music': '音乐',
  'menu.effects': '音效',

  'chat.coach': '助手',
  'chat.ask': '问助手…',
  'chat.tap': '点开',
  'chat.close': '收起',
  'chat.sayHello': '打个招呼吧。',
  'chat.thinking': '在想…',
  'askhere.about': '关于 {point}',
  'askhere.placeholder': '问问这个点…',
  'speech.reply': '回复…',
  'chat.speak': '说话',
  'chat.stopRecording': '说完了',
  'chat.micBlocked': '麦克风被挡住了 —— 打字吧',
  'chat.micRetry': '没听清 —— 再说一次',
  'chat.signIn': '登录之后我就能给你讲解。棋盘不登录也能下。',
  'chat.noCredits': '我的额度用完了,先不说话了 —— 棋照样能下。',
  'chat.lost': '我走神了,再问我一次?',
  'chat.marked': '标在棋盘上了。',
  'chat.midGame': '这盘还没下完 —— 要重开或者换棋盘,点左下角的设置。',
  'chat.markFailed': '我没能在棋盘上找到「{points}」—— 再问我一次,我会指对地方。',
  'chat.liberties': '{point}:{stones} 子,{liberties} 口气 —— {points}。已经在棋盘上圈出来了。',
  'chat.libertiesNone': '{point} 上没有棋子,所以谈不上气。',

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
