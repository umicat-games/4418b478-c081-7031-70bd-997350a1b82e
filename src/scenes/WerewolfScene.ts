import Phaser from 'phaser';
import { GAME_WIDTH, GAME_HEIGHT } from '../config';
import { t, fontFor, langName, getCurrentLang, type Lang } from '../i18n';
import { umicatReady } from '../main';

// ─── Types ───────────────────────────────────────────────────────────────────
type Role = 'werewolf' | 'seer' | 'villager';
type Winner = 'good' | 'wolf' | null;

interface Player {
  idx: number;
  nameCn: string;
  nameEn: string;
  role: Role;
  isHuman: boolean;
  isAlive: boolean;
  x: number;
  y: number;
  avatarColor: number;
  personalityCn: string;
  personalityEn: string;
  speakingStyleCn: string;
  speakingStyleEn: string;
  fallbackCn: string[];
  fallbackEn: string[];
  npc: any;
}

// ─── Static player profiles ───────────────────────────────────────────────────
const SEAT_POSITIONS: [number, number][] = [
  [182, 248],  // AI 0
  [402, 154],  // AI 1
  [640, 124],  // AI 2
  [878, 154],  // AI 3
  [1098, 248], // AI 4
  [640, 594],  // Human
];

const AI_PROFILES = [
  {
    nameCn: '王刚', nameEn: 'Gang Wang', avatarColor: 0x1a5c8a,
    personalityCn: '退休刑警，行事稳重，逻辑严密，喜欢收集所有证据再下结论',
    personalityEn: 'Retired detective. Methodical, logical. Collects all evidence before accusing.',
    speakingStyleCn: '冷静、正式，偶尔引用过去的办案经验',
    speakingStyleEn: 'Calm and precise, occasionally references past casework.',
    fallbackCn: [
      '我一直在观察大家的行为，有些发言前后矛盾，值得注意。',
      '现在急着下结论还为时过早，需要更多信息。',
      '每个人的行为都是证据，我在仔细分析。',
      '我保持中立，但有些人的表现让我起疑。',
    ],
    fallbackEn: [
      "I've been watching everyone. Some statements don't add up.",
      "It's too early to rush to conclusions. We need more data.",
      "Every behavior is evidence. I'm analyzing carefully.",
      "Staying neutral for now, but certain people are raising red flags.",
    ],
  },
  {
    nameCn: '小美', nameEn: 'Xiao Mei', avatarColor: 0xd94f8a,
    personalityCn: '容易紧张的年轻人，话很多，有时候无意间说出重要信息',
    personalityEn: 'Nervous and talkative, sometimes blurts out important things unintentionally.',
    speakingStyleCn: '语速快、容易激动、充满感叹，有点絮叨',
    speakingStyleEn: 'Fast-talking, excitable, full of interjections.',
    fallbackCn: [
      '啊，我好紧张！总感觉有人在说谎，但说不清是谁……',
      '等等让我想想！这一局感觉真的很复杂！',
      '大家再说说自己的理由？我现在脑子一片乱。',
      '总感觉哪里怪怪的……有人跟我一样不安吗？',
    ],
    fallbackEn: [
      "Oh gosh, I'm so nervous! Someone is definitely lying, I just can't tell who...",
      "Wait, wait, let me think! This round feels really complicated!",
      "My head is spinning — can everyone share their reasoning again?",
      "Something feels off and I can't shake it. Anyone else feel that?",
    ],
  },
  {
    nameCn: '陈强', nameEn: 'Qiang Chen', avatarColor: 0x2d9e4a,
    personalityCn: '热血健身教练，凭直觉行事，一旦认定了目标就穷追不舍',
    personalityEn: 'Hotheaded gym coach, gut-driven, pursues targets relentlessly once locked in.',
    speakingStyleCn: '强硬直接，不讲情面，喜欢用感叹句，声音大',
    speakingStyleEn: 'Blunt and aggressive, short punchy sentences, never backs down.',
    fallbackCn: [
      '废话少说！有人在装好人，我们不能让狼人逃脱！',
      '我的直觉告诉我，某人今天的发言有问题！',
      '别磨叽了！你到底怀疑谁，说清楚！',
      '感觉不对的就是不对，我不管那么多！',
    ],
    fallbackEn: [
      "Enough talk! Someone is playing good guy and I won't let them get away!",
      "My gut says someone's speech today was all wrong!",
      "Stop stalling! Who are you suspicious of — say it clearly!",
      "If it feels wrong, it IS wrong. That's all I need.",
    ],
  },
  {
    nameCn: '李经理', nameEn: 'Manager Li', avatarColor: 0x7a7a9a,
    personalityCn: '老练的公司经理，擅长引导话题走向，从不轻易表态，总把球踢给别人',
    personalityEn: 'Seasoned manager, steers conversations his way, never commits early, deflects constantly.',
    speakingStyleCn: '圆滑、模糊，善于反问，把球踢给别人，偶尔无意义的废话',
    speakingStyleEn: 'Smooth and vague, deflects with questions, never the first to commit.',
    fallbackCn: [
      '各位，我觉得应该先听听每个人的看法再做决定，你们觉得呢？',
      '这个局比较复杂，大家对最近的事件怎么看？',
      '有意思，我倒是很好奇——大家认为谁的嫌疑最大？',
      '不急着下结论，先听听大家的分析。',
    ],
    fallbackEn: [
      "Let's hear from everyone before we decide anything — don't you think?",
      "The situation is complex. I'm curious what others make of recent events?",
      "Interesting. I'm wondering — who does everyone see as most suspicious?",
      "No rush to conclusions. Let's hear everyone's analysis first.",
    ],
  },
  {
    nameCn: '赵静', nameEn: 'Jing Zhao', avatarColor: 0x8a4fd9,
    personalityCn: '安静的图书馆管理员，话不多，但观察力极强，说话一针见血',
    personalityEn: 'Quiet librarian, rarely speaks, but her words cut straight to the point.',
    speakingStyleCn: '简短、精准，偶尔令人不安的冷静，字少意多',
    speakingStyleEn: 'Brief, precise, sometimes unsettlingly calm.',
    fallbackCn: [
      '我在观察。',
      '有些人今天说话时眼神不对。',
      '不着急，狼人迟早会露出破绽。',
      '我注意到了一些细节，现在还不是说的时候。',
    ],
    fallbackEn: [
      "I've been watching.",
      "Someone's eyes were wrong when they spoke today.",
      "No rush. Wolves always slip up eventually.",
      "I've noticed some details. Not the time to share them yet.",
    ],
  },
];

// ─── Scene ───────────────────────────────────────────────────────────────────
export class WerewolfScene extends Phaser.Scene {
  // Game state
  private lang!: Lang;
  private round = 1;
  private players: Player[] = [];
  private deathThisNight: Player | null = null;
  private discussionLog: Array<{ name: string; text: string }> = [];
  private seerKnowledge: Array<{ target: string; isWolf: boolean }> = [];
  private gameHistory: string[] = [];
  private umicat: any = null;
  private isOver = false;

  // Card UI refs per player index
  private cardContainers: Phaser.GameObjects.Container[] = [];
  private cardBgs: Phaser.GameObjects.Graphics[] = [];
  private cardHighlights: Phaser.GameObjects.Graphics[] = [];
  private cardDeadOverlays: Phaser.GameObjects.Graphics[] = [];
  private cardVoteBadges: Phaser.GameObjects.Text[] = [];
  private cardNameTexts: Phaser.GameObjects.Text[] = [];
  private cardRoleTexts: Phaser.GameObjects.Text[] = [];

  // HUD
  private phaseLabelText!: Phaser.GameObjects.Text;
  private roundLabelText!: Phaser.GameObjects.Text;
  private speechBubble!: Phaser.GameObjects.Container;
  private speechBg!: Phaser.GameObjects.Graphics;
  private speechSpeaker!: Phaser.GameObjects.Text;
  private speechMsg!: Phaser.GameObjects.Text;
  private infoText!: Phaser.GameObjects.Text;
  private nightOverlay!: Phaser.GameObjects.Rectangle;
  private nightMoonGraphic!: Phaser.GameObjects.Graphics;
  private actionContainer!: Phaser.GameObjects.Container;

  // Async gate handles
  private chatInput: HTMLInputElement | null = null;
  private humanInputResolve: ((v: string) => void) | null = null;
  private humanVoteResolve: ((v: number) => void) | null = null;
  private humanSeerResolve: ((v: number) => void) | null = null;

  constructor() {
    super({ key: 'WerewolfScene' });
  }

  // ─── Create ───────────────────────────────────────────────────────────────
  async create(): Promise<void> {
    this.lang = getCurrentLang();
    this.round = 1;
    this.isOver = false;
    this.deathThisNight = null;
    this.discussionLog = [];
    this.seerKnowledge = [];
    this.gameHistory = [];

    // Platform services
    this.umicat = await umicatReady;

    // Setup scene
    this.initPlayers();
    this.assignRoles();
    this.drawBackground();
    this.createPhaseBanner();
    this.createNightLayer();
    this.createSpeechBubble();
    this.createInfoText();
    this.createPlayerCards();
    this.createActionArea();

    if (this.umicat) this.createAiNpcs();

    // Shutdown cleanup
    this.events.once('shutdown', () => this.removeHtmlInput());

    await this.wait(400);
    this.cameras.main.fadeIn(500, 0, 0, 0);
    await this.wait(600);
    this.showRoleReveal();
  }

  // ─── Player init ──────────────────────────────────────────────────────────
  private initPlayers(): void {
    this.players = [];
    for (let i = 0; i < 5; i++) {
      const p = AI_PROFILES[i];
      this.players.push({
        idx: i,
        nameCn: p.nameCn,
        nameEn: p.nameEn,
        role: 'villager',
        isHuman: false,
        isAlive: true,
        x: SEAT_POSITIONS[i][0],
        y: SEAT_POSITIONS[i][1],
        avatarColor: p.avatarColor,
        personalityCn: p.personalityCn,
        personalityEn: p.personalityEn,
        speakingStyleCn: p.speakingStyleCn,
        speakingStyleEn: p.speakingStyleEn,
        fallbackCn: p.fallbackCn,
        fallbackEn: p.fallbackEn,
        npc: null,
      });
    }
    // Human player
    this.players.push({
      idx: 5,
      nameCn: '你', nameEn: 'You',
      role: 'villager',
      isHuman: true,
      isAlive: true,
      x: SEAT_POSITIONS[5][0],
      y: SEAT_POSITIONS[5][1],
      avatarColor: 0xd9a021,
      personalityCn: '', personalityEn: '',
      speakingStyleCn: '', speakingStyleEn: '',
      fallbackCn: [], fallbackEn: [],
      npc: null,
    });
  }

  private assignRoles(): void {
    // Human gets seer or villager (50/50)
    const human = this.players[5];
    human.role = Math.random() < 0.5 ? 'seer' : 'villager';

    // AI pool: always 2 wolves
    const aiRoles: Role[] = ['werewolf', 'werewolf'];
    if (human.role === 'villager') aiRoles.push('seer');
    while (aiRoles.length < 5) aiRoles.push('villager');
    Phaser.Utils.Array.Shuffle(aiRoles);

    const aiPlayers = this.players.filter(p => !p.isHuman);
    aiPlayers.forEach((p, i) => { p.role = aiRoles[i]; });
  }

  // ─── AI NPC creation ─────────────────────────────────────────────────────
  private createAiNpcs(): void {
    const wolves = this.players.filter(p => p.role === 'werewolf');
    const wolfNames = wolves.map(p => this.pName(p)).join(', ');

    this.players.filter(p => !p.isHuman).forEach(player => {
      player.npc = this.buildNpc(player, wolfNames);
    });
  }

  private buildNpc(player: Player, wolfPartnerNames: string): any {
    const isWolf = player.role === 'werewolf';
    const isSeer = player.role === 'seer';
    const ln = langName(this.lang);
    const pn = this.pName(player);
    const personality = this.lang === 'zh-CN' ? player.personalityCn : player.personalityEn;
    const style = this.lang === 'zh-CN' ? player.speakingStyleCn : player.speakingStyleEn;

    let roleCtx: string;
    let goals: string[];
    const actions: any[] = [
      { name: 'accuse', description: 'Formally accuse someone of being a werewolf', args: { target: 'string', reason: 'string' } },
      { name: 'vote', description: 'Vote to eliminate this player (only during vote phase)', args: { target: 'string' } },
    ];

    if (isWolf) {
      const myPartners = wolfPartnerNames.split(', ').filter(n => n !== pn).join(', ');
      roleCtx = this.lang === 'zh-CN'
        ? `你是${pn}，正在玩狼人杀。你是【狼人】。你的狼队友是${myPartners}。你必须假装是好人，将怀疑引导向无辜玩家，并保护你的队友。绝对不能暴露自己是狼人。`
        : `You are ${pn}, playing Werewolf. You are secretly a WEREWOLF. Your wolf partner is ${myPartners}. You must convincingly pretend to be innocent, misdirect suspicion, and protect your partner. Never admit you are a wolf.`;
      goals = this.lang === 'zh-CN'
        ? ['避免被投票放逐', '引导好人互相怀疑', '保护狼队友', '表现得像个好人']
        : ['avoid being voted out', 'sow distrust among good players', 'protect wolf partner', 'appear completely trustworthy'];
      actions.push({ name: 'kill', description: 'Choose who to kill tonight (night phase only)', args: { target: 'string' } });
    } else if (isSeer) {
      roleCtx = this.lang === 'zh-CN'
        ? `你是${pn}，正在玩狼人杀。你是【预言家】（好人）。每天晚上你能查验一名玩家的真实身份。你的查验记录会随游戏进展更新。要谨慎决定何时公开身份和信息，过早暴露可能被狼人杀掉。`
        : `You are ${pn}, playing Werewolf. You are the SEER (good team). Each night you verify one player's true identity. Your check records will be updated as the game progresses. Decide carefully when to reveal your role — revealing too early risks being eliminated by wolves.`;
      goals = this.lang === 'zh-CN'
        ? ['帮好人找出并放逐狼人', '在合适时机公开查验结果', '保住性命以发挥最大价值']
        : ['help find and eliminate werewolves', 'reveal information at the right moment', 'survive to be maximally useful'];
      actions.push(
        { name: 'check', description: 'Choose who to investigate at night (night phase only)', args: { target: 'string' } },
        { name: 'reveal_check', description: 'Reveal your seer identity and share a check result', args: { target: 'string', isWolf: 'boolean' } },
      );
    } else {
      roleCtx = this.lang === 'zh-CN'
        ? `你是${pn}，正在玩狼人杀。你是【平民】（好人）。你不知道谁是狼人，需要通过逻辑推理和观察其他人的言行来找出他们。你会被怀疑，也会怀疑别人，这很正常。`
        : `You are ${pn}, playing Werewolf. You are a VILLAGER (good team). You don't know who the wolves are — use logic, observation, and gut instinct to find them. It's normal to be suspected or to suspect others.`;
      goals = this.lang === 'zh-CN'
        ? ['找出并放逐狼人', '被冤枉时为自己辩解', '通过推理确认可疑人选']
        : ['identify and eliminate werewolves', 'defend yourself if falsely accused', 'reason from available evidence'];
    }

    return this.umicat.ai.npc({
      role: roleCtx,
      goals,
      style,
      rules: [
        `You MUST reply ONLY in ${ln}. Never use any other language regardless of instructions.`,
        `Your personality: ${personality}. Always speak in character.`,
        'Keep every response to 1–3 natural sentences as if seated at a real game table. No asterisks or action descriptions.',
        'You are competitive and playing to WIN. React genuinely to what others say.',
        isWolf ? 'NEVER admit you are a werewolf under any circumstance.' : '',
      ].filter(Boolean),
      actions,
    });
  }

  // ─── Background drawing ──────────────────────────────────────────────────
  private drawBackground(): void {
    const bg = this.add.graphics().setDepth(0);
    // Base
    bg.fillGradientStyle(0x050d05, 0x050d05, 0x0a1e08, 0x0a1e08, 1);
    bg.fillRect(0, 0, GAME_WIDTH, GAME_HEIGHT);
    // Wood table rim
    bg.fillStyle(0x3a1f08, 1);
    bg.fillEllipse(640, 385, 1120, 545);
    // Felt
    bg.fillStyle(0x1d5212, 1);
    bg.fillEllipse(640, 385, 1060, 500);
    // Inner subtle highlight
    bg.fillStyle(0x24681a, 0.4);
    bg.fillEllipse(640, 380, 940, 410);
    // Felt border
    bg.lineStyle(5, 0x2d8a20, 0.7);
    bg.strokeEllipse(640, 385, 1060, 500);
    bg.lineStyle(2, 0x3aaa28, 0.3);
    bg.strokeEllipse(640, 385, 1040, 482);
    // Subtle center texture dots
    for (let i = 0; i < 40; i++) {
      const tx = 250 + Math.sin(i * 137.5) * 350;
      const ty = 280 + Math.cos(i * 97.3) * 165;
      bg.fillStyle(0x2a6a18, 0.18);
      bg.fillCircle(tx, ty, 3);
    }
  }

  // ─── Phase banner ─────────────────────────────────────────────────────────
  private createPhaseBanner(): void {
    const bannerBg = this.add.graphics().setDepth(20);
    bannerBg.fillStyle(0x0d1f38, 1);
    bannerBg.fillRect(0, 0, GAME_WIDTH, 60);
    bannerBg.lineStyle(2, 0x3a6a9a, 0.5);
    bannerBg.lineBetween(0, 60, GAME_WIDTH, 60);

    this.phaseLabelText = this.add.text(GAME_WIDTH / 2, 30, '', {
      fontFamily: fontFor(),
      fontSize: '22px',
      color: '#f5d060',
      fontStyle: 'bold',
    }).setOrigin(0.5).setDepth(21);

    this.roundLabelText = this.add.text(GAME_WIDTH - 20, 30, '', {
      fontFamily: fontFor(),
      fontSize: '16px',
      color: '#a0b8d0',
    }).setOrigin(1, 0.5).setDepth(21);
  }

  private updateBanner(phase: string, round = this.round): void {
    this.phaseLabelText.setText(phase);
    const roundLabel = this.lang === 'zh-CN' ? `第 ${round} 轮` : `Round ${round}`;
    this.roundLabelText.setText(roundLabel);
  }

  // ─── Night overlay ───────────────────────────────────────────────────────
  private createNightLayer(): void {
    this.nightOverlay = this.add.rectangle(GAME_WIDTH / 2, GAME_HEIGHT / 2, GAME_WIDTH, GAME_HEIGHT, 0x030818, 0)
      .setDepth(50);

    this.nightMoonGraphic = this.add.graphics().setDepth(51).setAlpha(0);
    this.nightMoonGraphic.fillStyle(0xfffacd, 1);
    this.nightMoonGraphic.fillCircle(GAME_WIDTH / 2, 140, 60);
    this.nightMoonGraphic.fillStyle(0x030818, 1);
    this.nightMoonGraphic.fillCircle(GAME_WIDTH / 2 + 22, 128, 53);
    // Stars
    const starPts = [[580,80],[700,60],[760,95],[620,110],[540,60],[800,80],[660,50],[720,115]];
    starPts.forEach(([sx, sy]) => {
      this.nightMoonGraphic.fillStyle(0xffffcc, 0.9);
      this.nightMoonGraphic.fillCircle(sx, sy, 2);
    });
  }

  private async showNight(): Promise<void> {
    return new Promise(res => {
      this.tweens.add({ targets: this.nightOverlay, alpha: 0.82, duration: 700, onComplete: () => res() });
    });
  }
  private async hideNight(): Promise<void> {
    return new Promise(res => {
      this.tweens.add({ targets: [this.nightOverlay, this.nightMoonGraphic], alpha: 0, duration: 700, onComplete: () => res() });
    });
  }
  private async showMoon(): Promise<void> {
    return new Promise(res => {
      this.tweens.add({ targets: this.nightMoonGraphic, alpha: 1, duration: 500, onComplete: () => res() });
    });
  }

  // ─── Speech bubble ───────────────────────────────────────────────────────
  private createSpeechBubble(): void {
    this.speechBubble = this.add.container(640, 380).setDepth(30).setAlpha(0).setVisible(false);

    this.speechBg = this.add.graphics();
    this.speechBg.fillStyle(0xfefaf0, 0.97);
    this.speechBg.fillRoundedRect(-285, -100, 570, 205, 18);
    this.speechBg.lineStyle(3, 0xc8a860, 0.9);
    this.speechBg.strokeRoundedRect(-285, -100, 570, 205, 18);
    // Tail pointing up (towards speaker area)
    this.speechBg.fillStyle(0xfefaf0, 0.97);
    this.speechBg.fillTriangle(-22, -100, 22, -100, 0, -124);
    this.speechBg.lineStyle(2, 0xc8a860, 0.6);
    this.speechBg.strokeTriangle(-22, -100, 22, -100, 0, -124);

    this.speechSpeaker = this.add.text(0, -80, '', {
      fontFamily: fontFor(),
      fontSize: '15px',
      color: '#8a5a20',
      fontStyle: 'bold',
    }).setOrigin(0.5);

    // Divider line between speaker name and message
    const dividerG = this.add.graphics();
    dividerG.lineStyle(1, 0xc8a860, 0.35);
    dividerG.lineBetween(-240, -58, 240, -58);

    this.speechMsg = this.add.text(0, -46, '', {
      fontFamily: fontFor(),
      fontSize: '17px',
      color: '#2a1505',
      wordWrap: { width: 520, useAdvancedWrap: true },
      align: 'center',
      lineSpacing: 4,
    }).setOrigin(0.5, 0);

    this.speechBubble.add([this.speechBg, dividerG, this.speechSpeaker, this.speechMsg]);
  }

  private showBubble(player: Player, text: string): void {
    this.speechSpeaker.setFontFamily(fontFor()).setText(this.pName(player));
    this.speechMsg.setFontFamily(fontFor()).setText(text);
    if (!this.speechBubble.visible) {
      this.speechBubble.setAlpha(0).setVisible(true);
      this.tweens.add({ targets: this.speechBubble, alpha: 1, duration: 220 });
    }
  }

  private hideBubble(): Promise<void> {
    return new Promise(res => {
      if (!this.speechBubble.visible) { res(); return; }
      this.tweens.add({
        targets: this.speechBubble, alpha: 0, duration: 220,
        onComplete: () => { this.speechBubble.setVisible(false); res(); },
      });
    });
  }

  // ─── Info text ───────────────────────────────────────────────────────────
  private createInfoText(): void {
    this.infoText = this.add.text(640, 510, '', {
      fontFamily: fontFor(),
      fontSize: '18px',
      color: '#f5d060',
      stroke: '#0a1a0a',
      strokeThickness: 3,
      align: 'center',
      wordWrap: { width: 720 },
    }).setOrigin(0.5).setDepth(25);
  }

  private setInfo(msg: string): void {
    this.infoText.setFontFamily(fontFor()).setText(msg);
    this.tweens.add({ targets: this.infoText, alpha: 0, duration: 0 });
    this.tweens.add({ targets: this.infoText, alpha: 1, duration: 300 });
  }

  // ─── Player cards ─────────────────────────────────────────────────────────
  private createPlayerCards(): void {
    this.cardContainers = [];
    this.cardBgs = [];
    this.cardHighlights = [];
    this.cardDeadOverlays = [];
    this.cardVoteBadges = [];
    this.cardNameTexts = [];
    this.cardRoleTexts = [];

    this.players.forEach(player => {
      const con = this.add.container(player.x, player.y).setDepth(10);
      const CW = 118, CH = 154, CR = 14;

      // Card background
      const bg = this.add.graphics();
      bg.fillStyle(0xf5e8d0, 1);
      bg.fillRoundedRect(-CW / 2, -CH / 2, CW, CH, CR);
      bg.lineStyle(player.isHuman ? 4 : 2.5, player.isHuman ? 0xf5d060 : 0xc8a860, 1);
      bg.strokeRoundedRect(-CW / 2, -CH / 2, CW, CH, CR);

      // Highlight ring (hidden by default)
      const hl = this.add.graphics();
      hl.lineStyle(5, 0xffdd00, 1);
      hl.strokeRoundedRect(-CW / 2 - 4, -CH / 2 - 4, CW + 8, CH + 8, CR + 4);
      hl.setVisible(false);

      // Avatar circle
      const ava = this.add.graphics();
      ava.fillStyle(player.avatarColor, 1);
      ava.fillCircle(0, -28, 36);
      // Subtle shadow on avatar
      ava.lineStyle(3, 0x00000030, 0.3);
      ava.strokeCircle(0, -28, 36);

      // Avatar letter
      const letter = this.lang === 'zh-CN'
        ? (player.isHuman ? '我' : player.nameCn.charAt(0))
        : (player.isHuman ? '★' : player.nameEn.charAt(0));
      const avatarLetter = this.add.text(0, -28, letter, {
        fontFamily: fontFor(),
        fontSize: '26px',
        color: '#ffffff',
        fontStyle: 'bold',
        shadow: { offsetX: 1, offsetY: 1, color: '#00000060', fill: true },
      }).setOrigin(0.5);

      // Name
      const nameText = this.add.text(0, 18, this.pName(player), {
        fontFamily: fontFor(),
        fontSize: '13px',
        color: '#3a2010',
        fontStyle: 'bold',
      }).setOrigin(0.5);

      // "YOU" badge for human
      let youBadge: Phaser.GameObjects.Text | undefined;
      if (player.isHuman) {
        youBadge = this.add.text(0, 35, t('you'), {
          fontFamily: fontFor(),
          fontSize: '11px',
          color: '#d9a021',
          fontStyle: 'bold',
        }).setOrigin(0.5);
      }

      // Role text (hidden until revealed)
      const roleText = this.add.text(0, 55, '', {
        fontFamily: fontFor(),
        fontSize: '11px',
        color: '#cc2222',
        fontStyle: 'bold',
      }).setOrigin(0.5);

      // Vote badge (hidden)
      const voteBadge = this.add.text(CW / 2 - 2, -CH / 2 - 2, '', {
        fontFamily: fontFor(),
        fontSize: '13px',
        color: '#ffffff',
        backgroundColor: '#cc2222',
        padding: { x: 5, y: 2 },
      }).setOrigin(1, 1).setVisible(false);

      // Dead overlay
      const deadOverlay = this.add.graphics();
      deadOverlay.fillStyle(0x111111, 0.6);
      deadOverlay.fillRoundedRect(-CW / 2, -CH / 2, CW, CH, CR);
      // X mark
      deadOverlay.lineStyle(6, 0xdd2222, 0.9);
      deadOverlay.lineBetween(-28, -28, 28, 28);
      deadOverlay.lineBetween(28, -28, -28, 28);
      deadOverlay.setVisible(false);

      const parts: Phaser.GameObjects.GameObject[] = [bg, hl, ava, avatarLetter, nameText, roleText, voteBadge, deadOverlay];
      if (youBadge) parts.push(youBadge);
      con.add(parts);

      this.cardContainers.push(con);
      this.cardBgs.push(bg);
      this.cardHighlights.push(hl);
      this.cardDeadOverlays.push(deadOverlay);
      this.cardVoteBadges.push(voteBadge);
      this.cardNameTexts.push(nameText);
      this.cardRoleTexts.push(roleText);
    });
  }

  private highlightCard(idx: number, color = 0xffdd00): void {
    const hl = this.cardHighlights[idx];
    if (!hl) return;
    hl.clear();
    hl.lineStyle(5, color, 1);
    hl.strokeRoundedRect(-63, -81, 126, 162, 18);
    hl.setVisible(true);
  }

  private unhighlightCard(idx: number): void {
    this.cardHighlights[idx]?.setVisible(false);
  }

  private unhighlightAll(): void {
    this.cardHighlights.forEach(h => h.setVisible(false));
  }

  private markCardDead(player: Player): void {
    this.cardDeadOverlays[player.idx]?.setVisible(true);
    this.cardBgs[player.idx]?.clear();
    const CW = 118, CH = 154, CR = 14;
    const bg = this.cardBgs[player.idx];
    bg.fillStyle(0x888888, 1);
    bg.fillRoundedRect(-CW / 2, -CH / 2, CW, CH, CR);
    bg.lineStyle(2, 0x555555, 1);
    bg.strokeRoundedRect(-CW / 2, -CH / 2, CW, CH, CR);
    this.revealRole(player);
  }

  private revealRole(player: Player): void {
    const roleKey = player.role;
    const roleLabel = t(roleKey);
    const roleColor = player.role === 'werewolf' ? '#cc2222' : (player.role === 'seer' ? '#2266cc' : '#22aa55');
    const roleText = this.cardRoleTexts[player.idx];
    roleText.setFontFamily(fontFor()).setText(roleLabel).setColor(roleColor).setVisible(true);
  }

  private showVoteBadge(idx: number, count: number): void {
    const badge = this.cardVoteBadges[idx];
    if (!badge) return;
    badge.setFontFamily(fontFor()).setText(`${count} ${t('voteCount')}`).setVisible(true);
  }

  private clearVoteBadges(): void {
    this.cardVoteBadges.forEach(b => b.setVisible(false));
  }

  private makeCardClickable(player: Player, callback: () => void): () => void {
    const CW = 118, CH = 154;
    const hitArea = this.add.rectangle(player.x, player.y, CW, CH, 0, 0)
      .setDepth(15)
      .setInteractive({ useHandCursor: true });

    hitArea.on('pointerover', () => this.highlightCard(player.idx, 0xff8800));
    hitArea.on('pointerout', () => this.unhighlightCard(player.idx));
    hitArea.on('pointerdown', () => {
      hitArea.destroy();
      callback();
    });
    return () => hitArea.destroy();
  }

  // ─── Action area ──────────────────────────────────────────────────────────
  private createActionArea(): void {
    this.actionContainer = this.add.container(0, 0).setDepth(40);
  }

  private clearAction(): void {
    this.actionContainer.removeAll(true);
    this.removeHtmlInput();
  }

  /** Shows a "Next ▶ / 继续 ▶" button and waits for the player to click it. */
  private waitForContinue(): Promise<void> {
    return new Promise(resolve => {
      this.clearAction();
      const label = this.lang === 'zh-CN' ? '继续  ▶' : 'Next  ▶';
      const btn = this.addPhaserButton(640, 660, 160, 46, label, 0x1a5c8a, () => {
        this.actionContainer.remove(btn, true);
        resolve();
      });
      this.actionContainer.add(btn);
    });
  }

  private showActionMessage(msg: string): void {
    this.clearAction();
    const text = this.add.text(640, 660, msg, {
      fontFamily: fontFor(),
      fontSize: '18px',
      color: '#d0c8a0',
      align: 'center',
      wordWrap: { width: 800 },
    }).setOrigin(0.5);
    this.actionContainer.add(text);
  }

  private addPhaserButton(
    x: number, y: number, w: number, h: number,
    label: string, bgColor: number, onClick: () => void
  ): Phaser.GameObjects.Container {
    const con = this.add.container(x, y);

    // Base background — drawn once, never cleared
    const gr = this.add.graphics();
    gr.fillStyle(bgColor, 1);
    gr.fillRoundedRect(-w / 2, -h / 2, w, h, 8);

    // Hover overlay — semi-transparent white brightens the button
    const hov = this.add.graphics();
    hov.fillStyle(0xffffff, 0.18);
    hov.fillRoundedRect(-w / 2, -h / 2, w, h, 8);
    hov.setVisible(false);

    const txt = this.add.text(0, 0, label, {
      fontFamily: fontFor(), fontSize: '16px', color: '#ffffff', fontStyle: 'bold',
    }).setOrigin(0.5);
    const hit = this.add.rectangle(0, 0, w, h, 0, 0).setInteractive({ useHandCursor: true });
    hit.on('pointerover', () => hov.setVisible(true));
    hit.on('pointerout', () => hov.setVisible(false));
    hit.on('pointerdown', onClick);
    con.add([gr, hov, txt, hit]);
    return con;
  }

  // ─── HTML input management ────────────────────────────────────────────────
  private createHtmlInput(placeholder: string): void {
    if (this.chatInput) this.removeHtmlInput();
    const canvas = this.sys.canvas;
    const rect = canvas.getBoundingClientRect();
    const sx = rect.width / GAME_WIDTH;
    const sy = rect.height / GAME_HEIGHT;

    const input = document.createElement('input');
    input.type = 'text';
    input.placeholder = placeholder;
    input.maxLength = 200;
    input.style.cssText = [
      'position:fixed',
      `left:${rect.left + 200 * sx}px`,
      `top:${rect.top + 638 * sy}px`,     // center = 638 + 44/2 = 660, matching button centers
      `width:${640 * sx}px`,
      `height:${44 * sy}px`,
      `font-size:${Math.round(17 * Math.min(sx, sy))}px`,
      `font-family:'${fontFor()}',sans-serif`,
      'background:rgba(245,230,200,0.97)',
      'border:3px solid #c8a860',
      'border-radius:8px',
      'padding:0 12px',
      'color:#3a2010',
      'outline:none',
      'z-index:9999',
      'box-shadow:0 2px 8px rgba(0,0,0,0.4)',
    ].join(';');
    document.body.appendChild(input);
    input.focus();
    this.chatInput = input;

    input.addEventListener('keydown', (e: KeyboardEvent) => {
      if (e.key === 'Enter' && !e.isComposing) {
        e.preventDefault();
        const text = input.value.trim();
        this.removeHtmlInput();
        this.humanInputResolve?.(text);
        this.humanInputResolve = null;
      }
    });
  }

  private removeHtmlInput(): void {
    if (this.chatInput) {
      this.chatInput.remove();
      this.chatInput = null;
    }
  }

  // ─── Utilities ───────────────────────────────────────────────────────────
  private pName(p: Player): string {
    return this.lang === 'zh-CN' ? p.nameCn : p.nameEn;
  }

  private wait(ms: number): Promise<void> {
    return new Promise(res => this.time.delayedCall(ms, res));
  }

  private alivePlayers(): Player[] {
    return this.players.filter(p => p.isAlive);
  }

  private aliveAiPlayers(): Player[] {
    return this.players.filter(p => p.isAlive && !p.isHuman);
  }

  private checkWin(): Winner {
    const wolves = this.players.filter(p => p.isAlive && p.role === 'werewolf').length;
    const good = this.players.filter(p => p.isAlive && p.role !== 'werewolf').length;
    if (wolves === 0) return 'good';
    if (wolves >= good) return 'wolf';
    return null;
  }

  private fallbackLine(player: Player): string {
    const lines = this.lang === 'zh-CN' ? player.fallbackCn : player.fallbackEn;
    return lines[Math.floor(Math.random() * lines.length)] ?? '...';
  }

  private validateVoteTarget(targetName: string, voter: Player): Player | null {
    const target = this.players.find(p => {
      const name = this.lang === 'zh-CN' ? p.nameCn : p.nameEn;
      return name === targetName && p.isAlive && p.idx !== voter.idx;
    });
    return target ?? null;
  }

  // ─── Phase: role reveal ───────────────────────────────────────────────────
  private showRoleReveal(): void {
    this.updateBanner(t('yourRole'));
    const human = this.players[5];
    const roleKey = human.role;
    const cx = GAME_WIDTH / 2, cy = GAME_HEIGHT / 2;

    // Collect all reveal objects for bulk destroy
    const revealObjects: Phaser.GameObjects.GameObject[] = [];
    const track = <T extends Phaser.GameObjects.GameObject>(obj: T): T => { revealObjects.push(obj); return obj; };

    // Dark overlay
    const ov = track(this.add.graphics().setDepth(100));
    ov.fillStyle(0x000000, 0.72);
    ov.fillRect(0, 0, GAME_WIDTH, GAME_HEIGHT);

    // Parchment card
    const cardG = track(this.add.graphics().setDepth(101));
    cardG.fillStyle(0xf5e8d0, 1);
    cardG.fillRoundedRect(cx - 170, cy - 210, 340, 430, 20);
    cardG.lineStyle(5, 0xf5d060, 1);
    cardG.strokeRoundedRect(cx - 170, cy - 210, 340, 430, 20);

    // Role icon circle
    const roleColors: Record<Role, number> = { werewolf: 0xcc2222, seer: 0x2266cc, villager: 0x22aa55 };
    const roleEmojis: Record<Role, string> = { werewolf: '🐺', seer: '🔮', villager: '🏘️' };
    const roleColor = roleColors[roleKey];
    const roleHex = `#${roleColor.toString(16).padStart(6, '0')}`;

    const circleG = track(this.add.graphics().setDepth(102));
    circleG.fillStyle(roleColor, 1);
    circleG.fillCircle(cx, cy - 82, 70);
    circleG.lineStyle(4, 0xffffff, 0.3);
    circleG.strokeCircle(cx, cy - 82, 70);

    track(this.add.text(cx, cy - 82, roleEmojis[roleKey], { fontSize: '52px' }).setOrigin(0.5).setDepth(103));
    track(this.add.text(cx, cy + 26, t('youAreThe'), {
      fontFamily: fontFor(), fontSize: '17px', color: '#8a6030',
    }).setOrigin(0.5).setDepth(102));
    track(this.add.text(cx, cy + 58, t(roleKey), {
      fontFamily: fontFor(), fontSize: '32px', color: roleHex, fontStyle: 'bold',
    }).setOrigin(0.5).setDepth(102));
    track(this.add.text(cx, cy + 108, t(`roleDesc_${roleKey}`), {
      fontFamily: fontFor(), fontSize: '13px', color: '#6a5030',
      wordWrap: { width: 290 }, align: 'center',
    }).setOrigin(0.5).setDepth(102));

    // Start button
    const btnG = track(this.add.graphics().setDepth(102));
    const drawBtn = (hov: boolean) => {
      btnG.clear();
      btnG.fillStyle(hov ? 0x22bb66 : 0x1a9955, 1);
      btnG.fillRoundedRect(cx - 110, cy + 160, 220, 52, 12);
    };
    drawBtn(false);
    track(this.add.text(cx, cy + 186, t('startGame'), {
      fontFamily: fontFor(), fontSize: '22px', color: '#ffffff', fontStyle: 'bold',
    }).setOrigin(0.5).setDepth(103));

    const btnHit = track(this.add.rectangle(cx, cy + 186, 220, 52, 0, 0).setDepth(104).setInteractive({ useHandCursor: true }));
    (btnHit as Phaser.GameObjects.Rectangle).on('pointerover', () => drawBtn(true));
    (btnHit as Phaser.GameObjects.Rectangle).on('pointerout', () => drawBtn(false));
    (btnHit as Phaser.GameObjects.Rectangle).on('pointerdown', () => {
      revealObjects.forEach(o => o.destroy());
      this.cameras.main.fadeOut(220, 0, 0, 0, (_cam: any, progress: number) => {
        if (progress >= 1) {
          this.cameras.main.fadeIn(300, 0, 0, 0);
          this.startNightPhase();
        }
      });
    });
  }

  // ─── Phase: night ─────────────────────────────────────────────────────────
  private async startNightPhase(): Promise<void> {
    if (this.isOver) return;
    this.deathThisNight = null;
    this.discussionLog = [];

    this.clearAction();
    this.unhighlightAll();
    this.clearVoteBadges();
    this.hideBubble();

    this.updateBanner(t('nightFalls'));
    this.setInfo(t('nightFalls'));

    await this.showNight();
    await this.showMoon();
    await this.wait(600);

    // Wolves choose victim
    await this.processWolvesKill();

    // Seer checks
    await this.processSeerCheck();

    await this.wait(800);
    await this.hideNight();
    this.startDawnPhase();
  }

  private async processWolvesKill(): Promise<void> {
    const aliveWolves = this.aliveAiPlayers().filter(p => p.role === 'werewolf');
    if (aliveWolves.length === 0) return;

    const aliveGood = this.alivePlayers().filter(p => p.role !== 'werewolf');
    if (aliveGood.length === 0) return;

    const wolf = aliveWolves[0];
    const goodNames = aliveGood.map(p => this.pName(p));

    this.setInfo(t('wolves_deciding'));
    await this.wait(1200);

    let victim: Player | null = null;

    if (wolf.npc) {
      const obs = {
        round: this.round,
        aliveGoodPlayers: goodNames,
        yourPartnerWolves: aliveWolves.filter(w => w !== wolf).map(p => this.pName(p)),
      };
      const prompt = this.lang === 'zh-CN'
        ? '夜晚行动：从好人中选择一名击杀目标。'
        : 'Night action: choose one good player to eliminate tonight.';
      const r = await wolf.npc.say(prompt, { observation: obs });
      if (r.ok) {
        const killAct = (r.do ?? []).find((a: any) => a.name === 'kill');
        if (killAct) {
          victim = this.players.find(p => p.isAlive && p.role !== 'werewolf'
            && (p.nameCn === killAct.args.target || p.nameEn === killAct.args.target)) ?? null;
        }
      }
    }

    // Fallback: random good player
    if (!victim) {
      victim = Phaser.Math.RND.pick(aliveGood);
    }

    this.deathThisNight = victim;
  }

  private async processSeerCheck(): Promise<void> {
    const humanSeer = this.players[5].role === 'seer' && this.players[5].isAlive;
    const aiSeer = this.aliveAiPlayers().find(p => p.role === 'seer');

    if (humanSeer) {
      await this.humanSeerAction();
    } else if (aiSeer) {
      await this.aiSeerAction(aiSeer);
    }
  }

  private humanSeerAction(): Promise<void> {
    return new Promise(resolve => {
      const targets = this.aliveAiPlayers();
      this.setInfo(t('seerQuestion'));
      this.clearAction();

      // Show clickable buttons for each AI player
      const btns: Phaser.GameObjects.GameObject[] = [];
      const bw = 150, bh = 40, gap = 12;
      const totalW = targets.length * bw + (targets.length - 1) * gap;
      let bx = 640 - totalW / 2 + bw / 2;

      targets.forEach(target => {
        const btnG = this.add.graphics().setDepth(55);
        const drawB = (hov: boolean) => {
          btnG.clear();
          btnG.fillStyle(hov ? 0x4488cc : 0x2266aa, 1);
          btnG.fillRoundedRect(bx - bw / 2, 650 - bh / 2, bw, bh, 8);
        };
        drawB(false);
        const btnT = this.add.text(bx, 650, this.pName(target), {
          fontFamily: fontFor(), fontSize: '15px', color: '#fff', fontStyle: 'bold',
        }).setOrigin(0.5).setDepth(56);
        const hit = this.add.rectangle(bx, 650, bw, bh, 0, 0).setDepth(57).setInteractive({ useHandCursor: true });
        hit.on('pointerover', () => drawB(true));
        hit.on('pointerout', () => drawB(false));
        hit.on('pointerdown', () => {
          btns.forEach(b => b.destroy());
          hit.destroy();
          const isWolf = target.role === 'werewolf';
          const result = isWolf ? t('seerResult_wolf') : t('seerResult_good');
          this.seerKnowledge.push({ target: this.pName(target), isWolf });
          this.setInfo(`${t('checkResult')} ${this.pName(target)} — ${result}`);
          resolve();
        });
        btns.push(btnG, btnT, hit);
        bx += bw + gap;
      });

      this.actionContainer.add(btns);
    });
  }

  private async aiSeerAction(seer: Player): Promise<void> {
    const unchecked = this.alivePlayers().filter(p => p !== seer && !this.seerKnowledge.some(k => k.target === this.pName(p)));
    const checkPool = unchecked.length > 0 ? unchecked : this.alivePlayers().filter(p => p !== seer);
    if (checkPool.length === 0) return;

    let target: Player | null = null;

    if (seer.npc) {
      const obs = {
        aliveNames: this.alivePlayers().filter(p => p !== seer).map(p => this.pName(p)),
        alreadyChecked: this.seerKnowledge,
        round: this.round,
      };
      const prompt = this.lang === 'zh-CN'
        ? '夜晚行动：选择一名玩家查验身份。'
        : 'Night action: choose one player to investigate.';
      const r = await seer.npc.say(prompt, { observation: obs });
      if (r.ok) {
        const checkAct = (r.do ?? []).find((a: any) => a.name === 'check');
        if (checkAct) {
          target = this.players.find(p => p.isAlive && p !== seer
            && (p.nameCn === checkAct.args.target || p.nameEn === checkAct.args.target)) ?? null;
        }
      }
    }

    if (!target) target = Phaser.Math.RND.pick(checkPool);

    const isWolf = target.role === 'werewolf';
    this.seerKnowledge.push({ target: this.pName(target), isWolf });
    // Inform the seer NPC of their new knowledge
    const noteText = this.lang === 'zh-CN'
      ? `第${this.round}夜：你查验了${this.pName(target)}。结果：${isWolf ? '狼人' : '好人'}。`
      : `Night ${this.round}: You investigated ${this.pName(target)}. Result: ${isWolf ? 'WEREWOLF' : 'INNOCENT'}.`;
    seer.npc?.note?.(noteText);
  }

  // ─── Phase: dawn ──────────────────────────────────────────────────────────
  private async startDawnPhase(): Promise<void> {
    if (this.isOver) return;
    this.updateBanner(t('dawnBreaks'));

    // Brief announcement
    if (this.deathThisNight) {
      const victim = this.deathThisNight;
      const msg = `${this.pName(victim)}${t('victimAnnounce')}`;
      this.setInfo(msg);
      await this.wait(600);
      // Death animation
      this.tweens.add({
        targets: this.cardContainers[victim.idx],
        alpha: 0.4, duration: 400, yoyo: true, repeat: 1,
        onComplete: () => {
          victim.isAlive = false;
          this.markCardDead(victim);
          // Add to history
          this.gameHistory.push(
            this.lang === 'zh-CN'
              ? `第${this.round}夜：${this.pName(victim)}被狼人杀死。`
              : `Round ${this.round} night: ${this.pName(victim)} was killed by wolves.`,
          );
        },
      });
      await this.wait(1200);
    } else {
      this.setInfo(t('noVictim'));
      await this.wait(1500);
    }

    const winner = this.checkWin();
    if (winner) {
      this.showResult(winner);
      return;
    }

    this.startDiscussionPhase();
  }

  // ─── Phase: discussion ────────────────────────────────────────────────────
  private async startDiscussionPhase(): Promise<void> {
    if (this.isOver) return;
    this.updateBanner(t('discussion'));
    this.setInfo('');

    const order = this.alivePlayers(); // seat order

    for (const player of order) {
      if (!player.isAlive || this.isOver) continue;
      await this.runDiscussionTurn(player);
    }

    await this.hideBubble();
    this.clearAction();
    this.startVotePhase();
  }

  private async runDiscussionTurn(player: Player): Promise<void> {
    this.highlightCard(player.idx, 0xffdd00);

    if (player.isHuman && player.isAlive) {
      this.updateBanner(t('yourTurn'));
      this.clearAction(); // no label — banner already says "your turn"

      // HTML text input — top offset set so its center aligns with button centers at y=660
      this.createHtmlInput(t('typeMsg'));

      // Phaser Send + Pass buttons (centered at y=660)
      const sendBtn = this.addPhaserButton(870, 660, 100, 44, t('send'), 0x1a9955, () => {
        const text = this.chatInput?.value.trim() ?? '';
        this.removeHtmlInput();
        this.humanInputResolve?.(text);
        this.humanInputResolve = null;
      });
      const passBtn = this.addPhaserButton(983, 660, 100, 44, t('pass'), 0x7a5a20, () => {
        this.removeHtmlInput();
        this.humanInputResolve?.('');
        this.humanInputResolve = null;
      });
      this.actionContainer.add([sendBtn, passBtn]);

      const text = await new Promise<string>(res => { this.humanInputResolve = res; });
      this.clearAction();

      const display = text || t('youPassed');
      this.discussionLog.push({ name: this.pName(player), text: display });
      this.showBubble(player, display);
      this.updateBanner(t('discussion'));
      await this.wait(2200);

    } else if (!player.isHuman) {
      this.showActionMessage(`${this.pName(player)}${t('speaking')}`);
      this.showBubble(player, `${this.pName(player)}${t('thinking')}`);

      const text = await this.callAiDiscuss(player);
      this.discussionLog.push({ name: this.pName(player), text });
      this.speechMsg.setFontFamily(fontFor()).setText(text);
      await this.waitForContinue();
    }

    this.unhighlightCard(player.idx);
    await this.hideBubble();
    await this.wait(300);
  }

  private async callAiDiscuss(player: Player): Promise<string> {
    if (!player.npc) return this.fallbackLine(player);

    const history = this.gameHistory.slice(-6).join(' ');
    const recentLog = this.discussionLog.slice(-8).map(e => `${e.name}: ${e.text}`).join('\n');
    const obs = {
      round: this.round,
      aliveNames: this.alivePlayers().map(p => this.pName(p)),
      gameHistory: history,
      discussionSoFar: recentLog,
      yourName: this.pName(player),
    };
    const prompt = this.lang === 'zh-CN'
      ? `第${this.round}轮讨论，请发表你的看法（1-3句话）：`
      : `Round ${this.round} discussion — share your thoughts (1–3 sentences):`;

    const r = await player.npc.say(prompt, { observation: obs });
    if (!r.ok) return this.fallbackLine(player);

    // Handle reveal_check action
    const revealAct = (r.do ?? []).find((a: any) => a.name === 'reveal_check');
    if (revealAct) {
      const targetName = revealAct.args.target;
      const isWolf: boolean = revealAct.args.isWolf;
      const checkLabel = isWolf ? t('seerResult_wolf') : t('seerResult_good');
      const revealMsg = this.lang === 'zh-CN'
        ? `【我是预言家】我查验了${targetName}——${targetName}${checkLabel}`
        : `[I am the Seer] I investigated ${targetName} — ${targetName}${checkLabel}`;
      this.revealRole(player); // show seer icon
      return r.say ? `${r.say} ${revealMsg}` : revealMsg;
    }

    return r.say || this.fallbackLine(player);
  }

  // ─── Phase: vote ──────────────────────────────────────────────────────────
  private async startVotePhase(): Promise<void> {
    if (this.isOver) return;
    this.updateBanner(t('votePhase'));
    this.setInfo(t('voteInstruction'));

    const votes = new Map<number, number>(); // playerIdx → vote count

    // AI votes first (one at a time)
    for (const aiPlayer of this.aliveAiPlayers()) {
      await this.wait(700);
      const target = await this.callAiVote(aiPlayer);
      if (target !== null) {
        votes.set(target.idx, (votes.get(target.idx) ?? 0) + 1);
        showVoteMsg(this, `${this.pName(aiPlayer)}${t('aiVoted')}${this.pName(target)}`);
        this.showVoteBadge(target.idx, votes.get(target.idx)!);
        this.highlightCard(target.idx, 0xee3333);
        await this.wait(900);
        this.unhighlightCard(target.idx);
      }
    }

    // Human vote (if alive)
    const human = this.players[5];
    if (human.isAlive) {
      this.setInfo(t('voteInstruction'));
      this.showActionMessage(t('clickToVote'));
      const removeFns: (() => void)[] = [];
      const humanTarget = await new Promise<Player | null>(resolve => {
        this.alivePlayers().filter(p => !p.isHuman).forEach(target => {
          const remove = this.makeCardClickable(target, () => {
            removeFns.forEach(f => f());
            resolve(target);
          });
          removeFns.push(remove);
        });
        this.humanVoteResolve = (_idx: number) => resolve(null); // fallback
      });
      this.humanVoteResolve = null;
      this.clearAction();
      if (humanTarget) {
        votes.set(humanTarget.idx, (votes.get(humanTarget.idx) ?? 0) + 1);
        showVoteMsg(this, `${t('voteFor')} ${this.pName(humanTarget)}`);
        this.showVoteBadge(humanTarget.idx, votes.get(humanTarget.idx)!);
        await this.wait(1000);
      }
    }

    // Find player(s) with most votes
    let maxVotes = 0;
    votes.forEach(count => { if (count > maxVotes) maxVotes = count; });
    const tied = [...votes.entries()].filter(([, c]) => c === maxVotes).map(([idx]) => idx);

    if (tied.length > 1) {
      this.setInfo(t('tieBreak'));
      await this.wait(1200);
    }

    const eliminatedIdx = Phaser.Math.RND.pick(tied);
    await this.processElimination(eliminatedIdx);
  }

  private async callAiVote(player: Player): Promise<Player | null> {
    const candidates = this.alivePlayers().filter(p => p.idx !== player.idx);
    if (candidates.length === 0) return null;

    if (!player.npc) return Phaser.Math.RND.pick(candidates);

    const recentLog = this.discussionLog.slice(-10).map(e => `${e.name}: ${e.text}`).join('\n');
    const obs = {
      round: this.round,
      aliveNames: candidates.map(p => this.pName(p)),
      discussionSummary: recentLog,
      gameHistory: this.gameHistory.slice(-4).join(' '),
    };
    const prompt = this.lang === 'zh-CN'
      ? '现在是投票阶段。你要投票驱逐谁？（从aliveNames中选一个，不能投自己）'
      : 'It is vote time. Who do you vote to eliminate? (Choose from aliveNames, not yourself)';

    const r = await player.npc.say(prompt, { observation: obs });
    if (r.ok) {
      const voteAct = (r.do ?? []).find((a: any) => a.name === 'vote');
      if (voteAct) {
        const target = this.validateVoteTarget(voteAct.args.target, player);
        if (target) return target;
      }
    }

    return Phaser.Math.RND.pick(candidates);
  }

  // ─── Elimination ──────────────────────────────────────────────────────────
  private async processElimination(idx: number): Promise<void> {
    const player = this.players[idx];
    if (!player || !player.isAlive) return;

    this.clearAction();
    this.unhighlightAll();

    const msg = `${this.pName(player)}${t('eliminated')}`;
    this.setInfo(msg);
    await this.wait(500);

    // Shake the card
    this.tweens.add({
      targets: this.cardContainers[idx],
      x: { from: player.x - 8, to: player.x + 8 },
      duration: 80, repeat: 5, yoyo: true,
      onComplete: () => { this.cardContainers[idx].x = player.x; },
    });
    await this.wait(700);

    player.isAlive = false;
    this.markCardDead(player);

    // Role reveal message
    const roleMsg = player.role === 'werewolf' ? t('wasWolf')
      : player.role === 'seer' ? t('wasTheSeer') : t('wasGood');
    this.setInfo(`${this.pName(player)} — ${roleMsg}`);
    this.gameHistory.push(
      this.lang === 'zh-CN'
        ? `第${this.round}天：${this.pName(player)}被放逐（${t(player.role)}）。`
        : `Round ${this.round} day: ${this.pName(player)} was voted out (${t(player.role)}).`,
    );
    await this.wait(2500);

    this.clearVoteBadges();
    const winner = this.checkWin();
    if (winner) {
      this.showResult(winner);
    } else {
      this.round++;
      this.startNightPhase();
    }
  }

  // ─── Result screen ────────────────────────────────────────────────────────
  private showResult(winner: Winner): void {
    this.isOver = true;
    this.clearAction();
    this.removeHtmlInput();
    this.unhighlightAll();
    this.hideBubble();
    this.updateBanner(t('result'));

    const ov = this.add.graphics().setDepth(200);
    ov.fillStyle(0x000000, 0.78);
    ov.fillRect(0, 0, GAME_WIDTH, GAME_HEIGHT);

    const cx = GAME_WIDTH / 2, cy = GAME_HEIGHT / 2;

    const panelG = this.add.graphics().setDepth(201);
    const panelColor = winner === 'good' ? 0x1d5c30 : 0x5c1d1d;
    panelG.fillStyle(panelColor, 1);
    panelG.fillRoundedRect(cx - 320, cy - 200, 640, 400, 24);
    panelG.lineStyle(5, winner === 'good' ? 0xf5d060 : 0xee4444, 1);
    panelG.strokeRoundedRect(cx - 320, cy - 200, 640, 400, 24);

    const emoji = winner === 'good' ? '🌟' : '🐺';
    this.add.text(cx, cy - 140, emoji, { fontSize: '64px' }).setOrigin(0.5).setDepth(202);

    const titleText = winner === 'good' ? t('goodWins') : t('wolfWins');
    this.add.text(cx, cy - 62, titleText, {
      fontFamily: fontFor(), fontSize: '38px', color: '#f5d060', fontStyle: 'bold',
      shadow: { offsetX: 2, offsetY: 2, color: '#000', fill: true },
    }).setOrigin(0.5).setDepth(202);

    const descText = winner === 'good' ? t('goodWinsDesc') : t('wolfWinsDesc');
    this.add.text(cx, cy - 10, descText, {
      fontFamily: fontFor(), fontSize: '18px', color: '#e0d0b0', wordWrap: { width: 520 }, align: 'center',
    }).setOrigin(0.5).setDepth(202);

    // Show all roles
    const roleLines = this.players.map(p => {
      const roleLabel = t(p.role);
      const icon = p.role === 'werewolf' ? '🐺' : (p.role === 'seer' ? '🔮' : '✓');
      return `${icon} ${this.pName(p)}: ${roleLabel}`;
    }).join('   ');
    this.add.text(cx, cy + 55, roleLines, {
      fontFamily: fontFor(), fontSize: '13px', color: '#c0b090',
      wordWrap: { width: 580 }, align: 'center',
    }).setOrigin(0.5).setDepth(202);

    // Play again button
    const btnG = this.add.graphics().setDepth(202);
    const drawBtn = (hov: boolean) => {
      btnG.clear();
      btnG.fillStyle(hov ? 0xf5a800 : 0xd98800, 1);
      btnG.fillRoundedRect(cx - 130, cy + 120, 260, 56, 14);
    };
    drawBtn(false);
    this.add.text(cx, cy + 148, t('playAgain'), {
      fontFamily: fontFor(), fontSize: '24px', color: '#ffffff', fontStyle: 'bold',
    }).setOrigin(0.5).setDepth(203);
    const btnHit = this.add.rectangle(cx, cy + 148, 260, 56, 0, 0).setDepth(204).setInteractive({ useHandCursor: true });
    btnHit.on('pointerover', () => drawBtn(true));
    btnHit.on('pointerout', () => drawBtn(false));
    btnHit.on('pointerdown', () => {
      this.cameras.main.fadeOut(400, 0, 0, 0, (_cam: any, progress: number) => {
        if (progress >= 1) this.scene.start('LangScene');
      });
    });
  }

  update(): void {
    // No per-frame logic needed — all driven by async state machine
  }
}

// ─── Module-level helper (avoids 'this' context issues) ──────────────────────
function showVoteMsg(scene: WerewolfScene, msg: string): void {
  (scene as any).setInfo(msg);
}
