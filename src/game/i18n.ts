/**
 * 中英双语 —— 一张串表加一个 `t()`，默认跟随玩家的语言。
 *
 * 语言来自 `umicat.locale`（宿主在握手时给的玩家界面语言），不是
 * `navigator.language`。这两者在平台里会不一样：玩家可以在 umicat 里把界面
 * 切成英文而浏览器仍是中文，那时该跟宿主走。独立打开（没有宿主）时 SDK 自己
 * 回落到浏览器语言，所以这里只管读它给的值。
 *
 * **字体**：这个游戏的文字全是 DOM 元素（`hud.ts` 里的 `<div>`），走系统字体，
 * 中英都不会出豆腐块。要注意的是如果哪天把文字画进 3D 场景（伤害飘字之类），
 * 就不能用 bitmapText —— 那是本平台记过的坑，CJK 会渲染成一排 □□□。
 *
 * **敌人名不在这里**，因为它们从来没显示给玩家看过（`ENEMY_TYPES[].name` 只是
 * 内部标签）。把它们翻译了就是在维护一张没人读的表。
 */

const SUPPORTED = ['en', 'zh-CN'] as const;
export type Lang = (typeof SUPPORTED)[number];

let lang: Lang = 'zh-CN';

/** 把宿主给的任意 locale（'zh'、'zh-TW'、'en-US'…）映射到已发布的语言。 */
export function pickSupported(loc: string | null | undefined): Lang {
  if (!loc) return 'en';
  if ((SUPPORTED as readonly string[]).includes(loc)) return loc as Lang;
  const base = loc.split('-')[0];
  return (SUPPORTED.find((l) => l.split('-')[0] === base) as Lang) ?? 'en';
}

/** 定下当前语言：玩家手动选过的优先，其次宿主的 locale，最后英文。
 *  拿到 SDK 的 locale 之后调一次；重复调用是安全的。 */
export function initLang(locale: string | null | undefined): void {
  let saved = '';
  try { saved = localStorage.getItem('starhold:lang') ?? ''; } catch { /* 忽略 */ }
  lang = (SUPPORTED as readonly string[]).includes(saved) ? (saved as Lang) : pickSupported(locale);
  applyDocumentLang();
}

export function getLang(): Lang {
  return lang;
}

export function supportedLangs(): readonly Lang[] {
  return SUPPORTED;
}

/** 语言自己的名字，给切换按钮用。 */
export function langDisplayName(l: Lang): string {
  return l === 'zh-CN' ? '中文' : 'English';
}

/** 当场换语言并记住。调用方负责重画自己已经在屏幕上的文字。 */
export function setLang(l: Lang): void {
  lang = l;
  try { localStorage.setItem('starhold:lang', l); } catch { /* 忽略 */ }
  applyDocumentLang();
}

/** `index.html` 里写死过 `lang="zh-CN"`。那个属性不是装饰：屏幕阅读器按它
 *  选发音，浏览器按它选断行和默认字体。跟着实际语言走。 */
function applyDocumentLang(): void {
  try { document.documentElement.lang = lang; } catch { /* 忽略 */ }
}

/** 取一条串。`vars` 里的键按 `{name}` 替换。
 *
 *  缺串时返回 key 本身而不是空字符串 —— 空白会被当成排版问题，一个突兀的
 *  `wave_banner` 会被当成缺翻译，而后者才是事实。 */
export function t(key: string, vars?: Record<string, string | number>): string {
  const row = STRINGS[key];
  let s = row ? (row[lang] ?? row.en) : key;
  // `split`/`join` 而不是 `replaceAll` —— 这个项目的 tsconfig 目标低于 es2021，
  // 而 `replaceAll` 只在那之后才有。效果一样，不用去动编译目标。
  if (vars) for (const [k, v] of Object.entries(vars)) s = s.split(`{${k}}`).join(String(v));
  return s;
}

const STRINGS: Record<string, Record<Lang, string>> = {
  // --- 标题界面 ---
  // 标题本身也是可翻译的：英文玩家看到的是游戏的英文名，副标题换成说明。
  title: { en: 'STARHOLD', 'zh-CN': '星港防线' },
  subtitle: { en: 'Wave survival on the station', 'zh-CN': 'STARHOLD · 空间站波次生存' },
  blurb: {
    en: 'Rogue machines are pouring in through all four airlocks. One marine, one gun, hold the pad.',
    'zh-CN': '失控的机械叛军正在从四个舱门涌入。一人，一枪，守住停机坪。',
  },
  start: { en: 'ENTER THE FIGHT', 'zh-CN': '进入战场' },
  // 两台机器两套控件，所以是两条串 —— 桌面报按键，手机报手势。
  controls_desktop: {
    en: 'WASD move · mouse aim · left click fire · R reload<br>1/2/3 or wheel switch weapon · Shift sprint · Space jump',
    'zh-CN': 'WASD 移动 · 鼠标 瞄准 · 左键 射击 · R 换弹<br>1/2/3 或滚轮 切换武器 · Shift 疾跑 · 空格 跳跃',
  },
  controls_touch: {
    en: 'Left stick to move · drag the right half to aim<br>✦ fire · ↻ reload · ▲ jump',
    'zh-CN': '左侧摇杆移动 · 右侧滑动瞄准<br>✦ 射击 · ↻ 换弹 · ▲ 跳跃',
  },
  best_ever: { en: 'Best score: {best}', 'zh-CN': '历史最高分：{best}' },

  // --- 战斗中的 HUD ---
  hp: { en: 'HP', 'zh-CN': '生命' },
  reload_tip: { en: 'Press R to reload', 'zh-CN': '按 R 换弹' },
  reloading: { en: 'Reloading…', 'zh-CN': '换弹中…' },
  wave_n: { en: 'WAVE {n}', 'zh-CN': '第 {n} 波' },
  enemies_left: { en: '{n} left', 'zh-CN': '剩余敌人 {n}' },
  clearing: { en: 'Clearing…', 'zh-CN': '清理战场…' },
  next_wave_in: { en: 'Next wave {s}s', 'zh-CN': '下一波 {s}s' },
  best: { en: 'Best {best}', 'zh-CN': '最高 {best}' },
  score_n: { en: 'Score {score}', 'zh-CN': '得分 {score}' },

  // --- 横幅与飘字 ---
  hold_the_pad: { en: 'Hold the landing pad!', 'zh-CN': '守住停机坪！' },
  incoming: { en: '{n} hostiles inbound', 'zh-CN': '{n} 个敌人正在接近' },
  area_clear: { en: 'AREA CLEAR', 'zh-CN': '区域已清空' },
  wave_bonus: { en: 'Wave bonus +{bonus}', 'zh-CN': '波次奖励 +{bonus}' },
  ammo_refill: { en: 'Ammo resupply', 'zh-CN': '弹药补充' },

  // --- 暂停 / 结算 ---
  paused: { en: 'PAUSED', 'zh-CN': '已暂停' },
  paused_desc: { en: 'Press the button below to get back in', 'zh-CN': '点击下方按钮回到战斗' },
  resume: { en: 'RESUME', 'zh-CN': '继续战斗' },
  game_over: { en: 'LINE BROKEN', 'zh-CN': '防线告破' },
  restart: { en: 'AGAIN', 'zh-CN': '再来一局' },
  new_best: { en: 'NEW RECORD!', 'zh-CN': '新纪录！' },

  // --- 提示 ---
  touch_hint: {
    en: 'Left stick to move · drag the right half to aim',
    'zh-CN': '左侧摇杆移动 · 右侧滑动旋转视角',
  },
  lock_unavailable: {
    en: 'Mouse lock unavailable — hold the right button and drag to look',
    'zh-CN': '鼠标锁定不可用：按住右键拖拽旋转视角',
  },

  // --- 武器 ---
  weapon_pistol: { en: 'Pulse Pistol', 'zh-CN': '脉冲手枪' },
  weapon_rifle: { en: 'Assault Rifle', 'zh-CN': '突击步枪' },
  weapon_heavy: { en: 'Heavy Blaster', 'zh-CN': '重型爆能炮' },

  // --- 启动失败 ---
  // 这条在 SDK 起来之前就可能要显示，那时还没有宿主 locale 可问，所以它由
  // 浏览器语言决定 —— 一个只在「什么都没起来」时出现的串，够用了。
  boot_failed: { en: 'Failed to start: {err}', 'zh-CN': '启动失败：{err}' },
};
