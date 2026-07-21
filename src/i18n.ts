// Tiny game i18n — a strings table + `t()`, defaulting to the player's language
// (`umicat.locale`, provided by the host). See the platform `game-i18n` skill.
//
// FONT NOTE: the game renders text in the `zpix` pixel font (loaded via
// `public/uploaded/fonts.json`), which covers **Latin + Simplified Chinese** — so
// `en` and `zh-CN` are tofu-free and keep the pixel look (matching Cato's dialog).
// To add a language whose script zpix can't draw (ja/ko/th/ar, accented Latin),
// add a Noto family to `public/webfonts.json` + return it from `dialogFont()`,
// and add its column to STRINGS — otherwise it'd render as tofu (□□□).

const SUPPORTED = ['en', 'zh-CN'] as const;
export type Lang = (typeof SUPPORTED)[number];

let lang: Lang = 'en';

/** Map any host locale (e.g. 'zh', 'zh-TW', 'en-US') to a shipped language. */
export function pickSupported(loc: string | null | undefined): Lang {
  if (!loc) return 'en';
  if ((SUPPORTED as readonly string[]).includes(loc)) return loc as Lang;
  const base = loc.split('-')[0];
  return (SUPPORTED.find((l) => l.split('-')[0] === base) as Lang) ?? 'en';
}

/** Resolve the active language: a saved pick (localStorage) wins, else the host
 *  locale, else English. Call once the SDK locale is known (safe to call again). */
export function initLang(locale: string | null | undefined): void {
  let saved = '';
  try { saved = localStorage.getItem('game:lang') ?? ''; } catch { /* ignore */ }
  lang = (SUPPORTED as readonly string[]).includes(saved) ? (saved as Lang) : pickSupported(locale);
}

export function getLang(): Lang {
  return lang;
}

/** The font to render UI text in for the active language (pixel-art `zpix` for the
 *  scripts it covers). Centralised so adding a Noto font later is one place. */
export function dialogFont(): string {
  return 'zpix, sans-serif';
}

const STRINGS: Record<string, Record<Lang, string>> = {
  // Demolish confirm — one full sentence per target (avoids cross-language grammar
  // issues from interpolating a noun into a template).
  demolish_floor: { en: 'Remove this floor?', 'zh-CN': '你想拆除这块地板吗？' },
  demolish_wall: { en: 'Remove this wall?', 'zh-CN': '你想拆除这面墙吗？' },
  demolish_window: { en: 'Remove this window?', 'zh-CN': '你想拆除这扇窗户吗？' },
  demolish_door: { en: 'Remove this door?', 'zh-CN': '你想拆除这扇门吗？' },
  demolish_generic: { en: 'Remove this?', 'zh-CN': '你想拆除这个吗？' },
  demolish_furn_plant: { en: 'Remove this potted plant?', 'zh-CN': '你想拆除这盆植物吗？' },
  demolish_furn_flower: { en: 'Remove these flowers?', 'zh-CN': '你想拆除这束花吗？' },
  demolish_furn_lamp: { en: 'Remove this lamp?', 'zh-CN': '你想拆除这盏灯吗？' },
  demolish_furn_dresser: { en: 'Remove this dresser?', 'zh-CN': '你想拆除这个柜子吗？' },
  demolish_furn_chair: { en: 'Remove this chair?', 'zh-CN': '你想拆除这把椅子吗？' },
  demolish_furn_stool: { en: 'Remove this stool?', 'zh-CN': '你想拆除这个凳子吗？' },
  demolish_furn_clock: { en: 'Remove this clock?', 'zh-CN': '你想拆除这个时钟吗？' },
  demolish_furn_rug: { en: 'Remove this rug?', 'zh-CN': '你想拆除这块地毯吗？' },
};

/** Translate a key for the active language (English fallback, then the key itself). */
export function t(key: string): string {
  const row = STRINGS[key];
  if (!row) return key;
  return row[lang] ?? row.en ?? key;
}
