export type Lang = 'en' | 'zh-CN';

let currentLang: Lang = 'en';

export function setLang(lang: Lang): void {
  currentLang = lang;
  localStorage.setItem('game:lang', lang);
}

export function getCurrentLang(): Lang {
  return currentLang;
}

export function fontFor(lang: Lang = currentLang): string {
  return lang.startsWith('zh') ? 'Noto Sans SC' : 'Noto Sans';
}

export function langName(lang: Lang = currentLang): string {
  return lang === 'zh-CN' ? 'Simplified Chinese' : 'English';
}

const STRINGS: Record<Lang, Record<string, string>> = {
  en: {
    title: 'WEREWOLF',
    selectLang: 'Select Language',
    tagline: '6-Player • AI Opponents • Social Deduction',
    // roles
    werewolf: 'Werewolf',
    seer: 'Seer',
    villager: 'Villager',
    // phase names
    nightFalls: 'Night Falls...',
    dawnBreaks: 'Dawn Breaks',
    discussion: 'Discussion',
    votePhase: 'Vote',
    result: 'Result',
    // role reveal
    yourRole: 'Your Role',
    youAreThe: 'You are the',
    roleDesc_werewolf: 'You are a werewolf but... you must always be on the good side. Wait, that\'s impossible!',
    roleDesc_seer: 'Each night you may investigate one player and learn if they are a Werewolf or Innocent.',
    roleDesc_villager: 'You have no special ability. Use logic and persuasion to unmask the wolves!',
    startGame: 'Start Game',
    you: 'YOU',
    // night
    nightAction: 'Night actions in progress...',
    seerQuestion: 'Who do you want to investigate tonight?',
    seerResult_wolf: ' is a Werewolf!',
    seerResult_good: ' is Innocent.',
    checkResult: 'Tonight\'s check result:',
    wolves_deciding: 'The wolves are deciding...',
    // dawn
    victimAnnounce: ' was found dead at dawn!',
    noVictim: 'A peaceful night — no one was killed.',
    // discussion
    speaking: ' is speaking...',
    thinking: ' is thinking...',
    yourTurn: 'Your turn to speak',
    typeMsg: 'Say something...',
    send: 'Send',
    pass: 'Pass',
    youSaid: 'You said:',
    youPassed: '[passed their turn]',
    // vote
    voteInstruction: 'Click a player card to vote for elimination',
    voteFor: 'You voted to eliminate',
    aiVoted: ' votes to eliminate ',
    tieBreak: "It's a tie! Randomly eliminating...",
    voteCount: 'votes',
    // elimination
    eliminated: ' has been eliminated!',
    wasWolf: '🐺 They were a Werewolf!',
    wasGood: '✓ They were Innocent.',
    wasTheSeer: '🔮 They were the Seer!',
    // end game
    goodWins: '🌟 Good Team Wins!',
    wolfWins: '🐺 Werewolves Win!',
    goodWinsDesc: 'All werewolves have been eliminated!',
    wolfWinsDesc: 'The werewolves have overrun the village...',
    humanDead: 'You have been eliminated! Watch the game unfold...',
    playAgain: 'Play Again',
    round: 'Round',
    // consent dialog
    consent_title: 'Notice',
    consent_msg: 'This game uses AI to power your opponents,\nsimulating real human-level play.\n\nEach game session consumes Credits from your account.',
    consent_agree: 'Agree & Enter Game',
    consent_back: 'Go Back',
    // errors
    signInRequired: 'Sign in to enable AI conversation',
    aiError: '...',
    // misc
    skip: 'Skip',
  },
  'zh-CN': {
    title: '狼人杀',
    selectLang: '选择语言',
    tagline: '6人局 · AI对手 · 社交推理',
    // roles
    werewolf: '狼人',
    seer: '预言家',
    villager: '平民',
    // phase names
    nightFalls: '夜晚降临……',
    dawnBreaks: '天亮了',
    discussion: '白天讨论',
    votePhase: '投票',
    result: '结果',
    // role reveal
    yourRole: '你的身份',
    youAreThe: '你是',
    roleDesc_werewolf: '你是狼人，但……你必须站在好人一边。等等，这不可能！',
    roleDesc_seer: '每天晚上你可以查验一名玩家，了解他们是狼人还是好人。',
    roleDesc_villager: '你没有特殊能力，只能靠逻辑和说服力揪出狼人！',
    startGame: '开始游戏',
    you: '我',
    // night
    nightAction: '夜晚行动进行中……',
    seerQuestion: '今晚你想查验谁？',
    seerResult_wolf: ' 是狼人！',
    seerResult_good: ' 是好人。',
    checkResult: '今晚的查验结果：',
    wolves_deciding: '狼人正在商量……',
    // dawn
    victimAnnounce: ' 昨晚遇害了！',
    noVictim: '平静的一夜，没有人遇难。',
    // discussion
    speaking: ' 正在发言……',
    thinking: ' 正在思考……',
    yourTurn: '轮到你发言',
    typeMsg: '说点什么……',
    send: '发送',
    pass: '跳过',
    youSaid: '你说：',
    youPassed: '【跳过了发言】',
    // vote
    voteInstruction: '点击玩家头像，投票驱逐他',
    voteFor: '你投票驱逐了',
    aiVoted: ' 投票驱逐 ',
    tieBreak: '平票！随机决定……',
    voteCount: '票',
    // elimination
    eliminated: ' 被放逐了！',
    wasWolf: '🐺 他是狼人！',
    wasGood: '✓ 他是好人。',
    wasTheSeer: '🔮 他是预言家！',
    // end game
    goodWins: '🌟 好人阵营获胜！',
    wolfWins: '🐺 狼人获胜！',
    goodWinsDesc: '所有狼人都被放逐了！',
    wolfWinsDesc: '狼人控制了整个村庄……',
    humanDead: '你被淘汰了！继续观看游戏……',
    playAgain: '再来一局',
    round: '第',
    // consent dialog
    consent_title: '温馨提示',
    consent_msg: '本游戏使用 AI 驱动对手，\n模拟真人级别的游戏行为。\n\n每局游戏会消耗您账户的 Credit，\n请确认后再继续。',
    consent_agree: '同意，进入游戏',
    consent_back: '返回',
    // errors
    signInRequired: '登录后才能启用AI对话',
    aiError: '……',
    // misc
    skip: '跳过',
  },
};

export function t(key: string, lang: Lang = currentLang): string {
  return STRINGS[lang]?.[key] ?? STRINGS.en[key] ?? key;
}
