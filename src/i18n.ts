// What the game says, in the player's language.
//
// English is the source and the fallback; a missing key falls through to it
// rather than showing the key, because a stray English word in a Chinese UI is
// a blemish and `hud.yourTurn` is a bug report.
//
// **The language comes from the platform and from nowhere else.** The host
// sends `locale` at handshake, from the player's Umicat language setting, and
// the game switches to it once, at init. Chat is the exception: what other
// players type is their own language and is never touched.
type Vars = Record<string, string | number>;

const EN = {
  'title.tagline': 'Corner to corner. Twenty-one pieces each.',
  'title.solo': 'Play the bots',
  'title.online': 'Play with friends',
  'title.continue': 'Continue',
  'title.rules': 'How to play',
  'title.loading': 'Setting out the board…',

  'rules.heading': 'How to play',
  'rules.one': 'Your first piece has to cover your corner of the board.',
  'rules.two': 'After that, every piece must touch one of your own pieces at a CORNER — and never along an edge.',
  'rules.three': 'Other colours are only in the way: you may sit edge to edge with them all you like.',
  'rules.four': 'When nothing fits, your turn is skipped. Most squares placed wins.',
  'rules.close': 'Got it',

  'diff.heading': 'How hard should the bots play?',
  'diff.easy': 'Easy',
  'diff.easy.about': 'Plays whatever fits. A good place to learn the corner rule.',
  'diff.medium': 'Even',
  'diff.medium.about': 'Gets its big pieces out and keeps its options open.',
  'diff.hard': 'Sharp',
  'diff.hard.about': 'Plays the same game with a steadier hand, and will take your corners.',
  'diff.start': 'Start',
  'diff.back': 'Back',

  'lobby.heading': 'Play with friends',
  'lobby.create': 'Create a room',
  'lobby.join': 'Join with a code',
  'lobby.browse': 'Browse rooms',
  'lobby.quick': 'Quick match',
  'lobby.back': 'Back',
  'lobby.creating': 'Making a room…',
  'lobby.joining': 'Joining…',
  'lobby.finding': 'Finding a match…',
  'lobby.failedCreate': 'Could not make a room. Try again.',
  'lobby.failedJoin': 'Could not join — check the code, or the room may be full.',
  'lobby.offlineFallback': 'No rooms available right now. Playing the bots instead.',
  'lobby.signedOut': 'Sign in to play with other people. You can still play the bots.',
  'lobby.code': 'Room code',
  'lobby.codeShare': 'Give this code to whoever is joining.',
  'lobby.enterCode': 'Room code',
  'lobby.codeHint': 'Ask whoever made the room.',
  'lobby.rooms': 'Open rooms',
  'lobby.noRooms': 'Nobody is waiting right now — make a room and they can join you.',
  'lobby.loadingRooms': 'Looking…',
  'lobby.roomsFailed': 'Could not load the list — trying again.',
  'lobby.joinRoom': 'Join',
  'lobby.players': 'At the table',
  'lobby.you': 'you',
  'lobby.bot': 'bot',
  'lobby.empty': 'Empty',
  'lobby.botFill': 'Empty seats are played by bots.',
  'lobby.start': 'Start the game',
  'lobby.waitHost': 'Waiting for the host to start…',
  'lobby.leave': 'Leave',
  'lobby.lost': 'The connection dropped.',
  'lobby.quickPublic': 'Public table',

  'hud.yourTurn': 'Your turn',
  'hud.turnOf': '{name} to play',
  'hud.botTurn': '{name} is thinking…',
  'hud.skipped': '{name} had nothing that fits.',
  'hud.youSkipped': 'Nothing of yours fits — your turn was skipped.',
  'hud.pickPiece': 'Pick a piece below, then a square on the board.',
  'hud.confirmHint': 'Tap the tick to place it. R turns it, F flips it.',
  'hud.wontGo': 'That will not go there.',
  'hud.youPassed': 'You passed.',
  'hud.left': '{n} left',
  'hud.watching': 'Watching',

  'act.rotate': 'Turn',
  'act.flip': 'Flip',
  'act.pass': 'Pass',
  'act.place': 'Place',
  'act.cancel': 'Cancel',
  'act.chat': 'Chat',
  'act.settings': 'Settings',
  'tray.yours': 'Your pieces',
  'tray.gone': 'All placed',
  'confirm.pass': 'Pass this turn? You keep your pieces.',

  'menu.heading': 'Settings',
  'menu.sound': 'Sound',
  'menu.music': 'Music',
  'menu.effects': 'Effects',
  'menu.helpers': 'Helpers',
  'menu.anchors': 'Mark my corners',
  'menu.bots': 'Bots',
  'menu.on': 'On',
  'menu.off': 'Off',
  'menu.recentre': 'Straighten up',
  'menu.rules': 'How to play',
  'menu.leave': 'Leave the game',
  'confirm.leave': 'Leave this game?',

  'chat.title': 'Table talk',
  'chat.say': 'Say something…',
  'chat.open': 'Chat',
  'chat.close': 'Hide',
  'chat.you': 'You',
  'chat.failed': 'That did not send.',
  'chat.empty': 'Nobody has said anything yet.',

  'over.heading': 'Game over',
  'over.youWin': 'You win',
  'over.winner': '{name} wins',
  'over.tie': 'A tie',
  'over.perfect': 'Every piece placed — a perfect game.',
  'over.best': 'Your best score yet.',
  'over.score': '{score} squares · {left} left',
  'over.again': 'Play again',
  'over.title': 'Back to the title',

  'wait.connecting': 'Connecting…',

  'colour.blue': 'Blue',
  'colour.red': 'Red',
  'colour.green': 'Green',
  'colour.yellow': 'Yellow',
  'player.bot': '{colour} (bot)',
  'player.you': '{colour} (you)',
};

export type Key = keyof typeof EN;

const ZH: Partial<Record<Key, string>> = {
  'title.tagline': '角对角。每人二十一块。',
  'title.solo': '和电脑下',
  'title.online': '和朋友下',
  'title.continue': '继续上一局',
  'title.rules': '怎么玩',
  'title.loading': '正在摆棋盘…',

  'rules.heading': '怎么玩',
  'rules.one': '第一块必须盖住属于你的那个角。',
  'rules.two': '之后每一块都必须与自己的棋子**角对角**相接，而且不能边贴边。',
  'rules.three': '别人的颜色只是障碍：你可以随便贴着它们摆。',
  'rules.four': '实在放不下就跳过这一轮。摆下的格子最多的人赢。',
  'rules.close': '知道了',

  'diff.heading': '电脑下多难？',
  'diff.easy': '轻松',
  'diff.easy.about': '能放就放。适合先摸清角对角这条规则。',
  'diff.medium': '势均',
  'diff.medium.about': '先出大块，也会给自己留后路。',
  'diff.hard': '犀利',
  'diff.hard.about': '同样的思路但手更稳，会来抢你的角。',
  'diff.start': '开始',
  'diff.back': '返回',

  'lobby.heading': '和朋友下',
  'lobby.create': '创建房间',
  'lobby.join': '用房号加入',
  'lobby.browse': '浏览房间',
  'lobby.quick': '快速匹配',
  'lobby.back': '返回',
  'lobby.creating': '正在创建房间…',
  'lobby.joining': '正在加入…',
  'lobby.finding': '正在匹配…',
  'lobby.failedCreate': '没能创建房间，再试一次。',
  'lobby.failedJoin': '没能加入 —— 房号不对，或者房间满了。',
  'lobby.offlineFallback': '现在连不上房间，先和电脑下。',
  'lobby.signedOut': '登录后才能和别人一起下；和电脑下不需要登录。',
  'lobby.code': '房号',
  'lobby.codeShare': '把这个房号给要加入的人。',
  'lobby.enterCode': '房号',
  'lobby.codeHint': '向开房的人要。',
  'lobby.rooms': '空着的房间',
  'lobby.noRooms': '现在没人在等 —— 开一个房间让他们来找你。',
  'lobby.loadingRooms': '正在找…',
  'lobby.roomsFailed': '列表没加载出来，正在重试。',
  'lobby.joinRoom': '加入',
  'lobby.players': '这桌的人',
  'lobby.you': '你',
  'lobby.bot': '电脑',
  'lobby.empty': '空位',
  'lobby.botFill': '空位由电脑来下。',
  'lobby.start': '开始',
  'lobby.waitHost': '等房主开始…',
  'lobby.leave': '离开',
  'lobby.lost': '连接断开了。',
  'lobby.quickPublic': '公开桌',

  'hud.yourTurn': '轮到你了',
  'hud.turnOf': '轮到{name}',
  'hud.botTurn': '{name}在想…',
  'hud.skipped': '{name}没地方放，跳过。',
  'hud.youSkipped': '你的棋子放不下了，这轮跳过。',
  'hud.pickPiece': '先在下面选一块，再点棋盘。',
  'hud.confirmHint': '点对勾落子。R 转、F 翻。',
  'hud.wontGo': '这儿放不下。',
  'hud.youPassed': '你跳过了这一轮。',
  'hud.left': '还剩 {n} 格',
  'hud.watching': '观战中',

  'act.rotate': '旋转',
  'act.flip': '翻转',
  'act.pass': '跳过',
  'act.place': '落子',
  'act.cancel': '取消',
  'act.chat': '聊天',
  'act.settings': '设置',
  'tray.yours': '你的棋子',
  'tray.gone': '全放完了',
  'confirm.pass': '跳过这一轮？棋子还留着。',

  'menu.heading': '设置',
  'menu.sound': '声音',
  'menu.music': '音乐',
  'menu.effects': '音效',
  'menu.helpers': '辅助',
  'menu.anchors': '标出我的角',
  'menu.bots': '电脑',
  'menu.on': '开',
  'menu.off': '关',
  'menu.recentre': '摆正视角',
  'menu.rules': '怎么玩',
  'menu.leave': '离开这一局',
  'confirm.leave': '离开这一局？',

  'chat.title': '聊两句',
  'chat.say': '说点什么…',
  'chat.open': '聊天',
  'chat.close': '收起',
  'chat.you': '你',
  'chat.failed': '没发出去。',
  'chat.empty': '还没人说话。',

  'over.heading': '结束了',
  'over.youWin': '你赢了',
  'over.winner': '{name}赢了',
  'over.tie': '打平',
  'over.perfect': '全部放完 —— 满分一局。',
  'over.best': '你的最好成绩。',
  'over.score': '{score} 格 · 剩 {left} 格',
  'over.again': '再来一局',
  'over.title': '回到标题',

  'wait.connecting': '正在连接…',

  'colour.blue': '蓝',
  'colour.red': '红',
  'colour.green': '绿',
  'colour.yellow': '黄',
  'player.bot': '{colour}（电脑）',
  'player.you': '{colour}（你）',
};

const TABLES: Record<string, Partial<Record<Key, string>>> = {
  'zh-CN': ZH, zh: ZH, 'zh-TW': ZH, 'zh-HK': ZH,
};

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

/** A colour's name in the player's language. */
export const colourName = (p: number): string =>
  t((['colour.blue', 'colour.red', 'colour.green', 'colour.yellow'] as const)[p] ?? 'colour.blue');
