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

/** The shipped languages, in a stable order (for a language picker). */
export function supportedLangs(): readonly Lang[] {
  return SUPPORTED;
}

/** Human display name of a language, in ITS OWN script (for a language picker). */
export function langDisplayName(l: Lang): string {
  return l === 'zh-CN' ? '中文' : 'English';
}

/** Switch the active language live + persist the pick (localStorage `game:lang`,
 *  the same key `initLang` prefers). Callers re-render their own visible text. */
export function setLang(l: Lang): void {
  lang = l;
  try { localStorage.setItem('game:lang', l); } catch { /* ignore */ }
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
  // Cato's proactive small-talk chips (top-right, left of his portrait). Generic (no
  // crop-name interpolation) to dodge cross-language grammar — same rule as demolish.
  chatter_harvest_start: { en: 'The {crop} is ripe — going to pick it!', 'zh-CN': '{crop}熟了，我去收一下！' },
  chatter_water_start: { en: 'The {crop} looks thirsty — I\'ll water it.', 'zh-CN': '{crop}渴了，我去浇点水～' },
  chatter_harvest_done: { en: 'All picked — it\'s in the backpack now!', 'zh-CN': '收好啦，放进背包里了！' },
  chatter_water_done: { en: 'Watered! They\'ll grow nice and fast now.', 'zh-CN': '浇完水啦，它们会长得快些～' },
  chatter_tired: { en: "Phew… I'm getting tired. I need a little rest.", 'zh-CN': '呼…我有点累了，得歇一会儿。' },
  chatter_found_food: { en: "Oh! There's a snack in my bag — let me sit down and have a bite.", 'zh-CN': '咦，包里还有吃的～我坐下歇会儿，吃点东西。' },
  chatter_ate: { en: 'Munch munch — that hit the spot!', 'zh-CN': '吃点东西，力气回来啦～' },
  chatter_full: { en: "I'm stuffed — couldn't eat another bite!", 'zh-CN': '我现在饱饱的，吃不下啦～' },
  chatter_bag_full: { en: "My little bag is full — no more room!", 'zh-CN': '我的小背包装不下更多啦～' },
  // Names for the {crop} slot above — crops, tree fruit, and berry bushes.
  crop_generic: { en: 'crops', 'zh-CN': '作物' },
  crop_corn: { en: 'corn', 'zh-CN': '玉米' },
  crop_carrot: { en: 'carrots', 'zh-CN': '胡萝卜' },
  crop_tomato: { en: 'tomatoes', 'zh-CN': '番茄' },
  crop_eggplant: { en: 'eggplants', 'zh-CN': '茄子' },
  crop_pumpkin: { en: 'pumpkins', 'zh-CN': '南瓜' },
  crop_apple: { en: 'apples', 'zh-CN': '苹果' },
  crop_pear: { en: 'pears', 'zh-CN': '梨' },
  crop_peach: { en: 'peaches', 'zh-CN': '桃子' },
  crop_strawberry: { en: 'strawberries', 'zh-CN': '草莓' },
  crop_grape: { en: 'grapes', 'zh-CN': '葡萄' },
  crop_blueberry: { en: 'blueberries', 'zh-CN': '蓝莓' },
  // Item descriptions — shown in the unified menu's right-side detail panel. Keyed by
  // item id (`desc_<id>`); GameScene.itemDesc falls back to '' when a key is missing.
  desc_fruit_apple: { en: 'A crisp, sweet apple from the orchard.', 'zh-CN': '从果园里摘的脆甜苹果。' },
  desc_fruit_pear: { en: 'A juicy pear, ripe and fragrant.', 'zh-CN': '多汁的梨，熟得正香。' },
  desc_fruit_peach: { en: 'A soft, fuzzy peach bursting with juice.', 'zh-CN': '毛茸茸的水蜜桃，满是汁水。' },
  desc_fruit_strawberry: { en: 'A plump red strawberry, sweet and tart.', 'zh-CN': '红扑扑的草莓，酸甜可口。' },
  desc_fruit_grape: { en: 'A cluster of sweet, dewy grapes.', 'zh-CN': '一串挂着露水的甜葡萄。' },
  desc_fruit_blueberry: { en: 'Tiny blueberries, sweet and full of flavor.', 'zh-CN': '小小的蓝莓，香甜浓郁。' },
  desc_crop_corn: { en: 'Golden corn, fresh off the stalk.', 'zh-CN': '金黄的玉米，刚从地里掰下来。' },
  desc_crop_carrot: { en: 'A crunchy carrot pulled from the soil.', 'zh-CN': '从土里拔出的脆嫩胡萝卜。' },
  desc_crop_tomato: { en: 'A round, ripe tomato — red and juicy.', 'zh-CN': '圆润熟透的番茄，又红又多汁。' },
  desc_crop_eggplant: { en: 'A glossy purple eggplant.', 'zh-CN': '紫得发亮的茄子。' },
  desc_crop_pumpkin: { en: 'A big, heavy pumpkin — perfect for autumn.', 'zh-CN': '又大又沉的南瓜，最适合秋天。' },
  desc_forage_red_mushroom: { en: 'A red wild mushroom foraged from the grass.', 'zh-CN': '在草地里采到的红蘑菇。' },
  desc_forage_purple_mushroom: { en: 'A rare purple mushroom with an earthy scent.', 'zh-CN': '少见的紫蘑菇，带着泥土的气息。' },
  desc_forage_wild_flower: { en: 'A pretty wildflower gathered on the island.', 'zh-CN': '在岛上采的漂亮野花。' },
  desc_forage_sunflower: { en: 'A tall, cheerful sunflower.', 'zh-CN': '高高的向日葵，格外精神。' },
  desc_forage_grass: { en: 'A handful of soft wild grass.', 'zh-CN': '一把柔软的野草。' },
  desc_stone: { en: 'A sturdy stone, handy for building.', 'zh-CN': '结实的石头，盖房子用得上。' },
  desc_corn_seed: { en: 'Plant on tilled soil to grow corn.', 'zh-CN': '种在锄好的地里就能长玉米。' },
  desc_carrot_seed: { en: 'Plant on tilled soil to grow carrots.', 'zh-CN': '种在锄好的地里长胡萝卜。' },
  desc_tomato_seed: { en: 'Plant on tilled soil to grow tomatoes.', 'zh-CN': '种在锄好的地里长番茄。' },
  desc_eggplant_seed: { en: 'Plant on tilled soil to grow eggplants.', 'zh-CN': '种在锄好的地里长茄子。' },
  desc_pumpkin_seed: { en: 'Plant on tilled soil to grow pumpkins.', 'zh-CN': '种在锄好的地里长南瓜。' },
  // ── Unified-menu UI chrome (tabs, shop, action menu) ──────────────────────────
  tab_mail: { en: 'Mail', 'zh-CN': '邮件' },
  tab_chest: { en: 'Chest', 'zh-CN': '箱子' },
  tab_shop: { en: 'Shop', 'zh-CN': '商店' },
  tab_catobag: { en: "Cato's bag", 'zh-CN': 'Cato的背包' },
  tab_settings: { en: 'Settings', 'zh-CN': '设置' },
  settings_music: { en: 'Music', 'zh-CN': '音乐' },
  settings_sfx: { en: 'Sound', 'zh-CN': '音效' },
  settings_language: { en: 'Language', 'zh-CN': '语言' },
  loading: { en: 'Loading', 'zh-CN': '加载中' },
  start_play: { en: 'PLAY', 'zh-CN': '开始' },
  menu_return_title: { en: 'Title screen', 'zh-CN': '返回标题' },
  settings_clear_data: { en: 'Clear data & new game', 'zh-CN': '清除数据 · 重新开始' },
  settings_debug: { en: 'Debug', 'zh-CN': '调试' },
  settings_debug_note: { en: '★ = applies after reload', 'zh-CN': '★ = 重新载入后生效' },
  dbg_dev_tools: { en: 'Dev keys & test tools', 'zh-CN': '开发快捷键 / 测试工具' },
  dbg_replay_intro: { en: 'Replay intro on load', 'zh-CN': '每次载入重播开场' },
  dbg_coin_floor: { en: 'Coin floor (5000)', 'zh-CN': '金币保底 (5000)' },
  dbg_clear_mailbox: { en: 'Clear mailbox on load', 'zh-CN': '载入时清空邮箱' },
  action_give_cato: { en: 'Give to Cato', 'zh-CN': '给 Cato' },
  action_feed: { en: 'Feed now', 'zh-CN': '喂食' },
  action_to_chest: { en: 'To Chest', 'zh-CN': '放回箱子' },
  menu_no_mail: { en: 'No mail yet', 'zh-CN': '还没有邮件' },
  menu_settings_todo: { en: 'Settings (coming soon)', 'zh-CN': '设置（待补充）' },
  shop_pick_item: { en: 'Pick an item to buy', 'zh-CN': '选一个要买的物品' },
  shop_unit_price: { en: 'Price', 'zh-CN': '单价' },       // rendered "Price 20" / "单价 20"
  shop_balance: { en: 'Coins', 'zh-CN': '余额' },          // rendered "Coins 9999" / "余额 9999"
  shop_buy: { en: 'Buy', 'zh-CN': '购买' },                // rendered "Buy 20" / "购买 20"
  shop_no_coins: { en: 'Not enough coins', 'zh-CN': '金币不够' },
  chest_full: { en: 'Chest is full', 'zh-CN': '箱子满了' },
  // Crafting (work station modal)
  craft_title: { en: 'CRAFTING', 'zh-CN': '合成' },
  craft_pick: { en: 'Pick something to craft', 'zh-CN': '选一个要合成的东西' },
  craft_materials: { en: 'Materials', 'zh-CN': '所需材料' },
  craft_button: { en: 'Craft', 'zh-CN': '合成' },
  craft_need: { en: 'Not enough materials', 'zh-CN': '材料不够' },
  craft_full: { en: 'Chest is full', 'zh-CN': '箱子满了' },
  craft_done: { en: 'Crafted!', 'zh-CN': '合成成功！' },
  action_hotbar: { en: 'To Hotbar', 'zh-CN': '放到快捷栏' },
  action_sell: { en: 'Sell', 'zh-CN': '出售' },
  action_delete: { en: 'Delete', 'zh-CN': '丢弃' },
  keypad_how_many: { en: 'How Many?', 'zh-CN': '选择数量' },
  // ── Item names (shown in the chest / shop / detail). Keyed `item_<id>` (hyphens→_).
  item_corn_seed: { en: 'Corn seeds', 'zh-CN': '玉米种子' },
  item_carrot_seed: { en: 'Carrot seeds', 'zh-CN': '胡萝卜种子' },
  item_tomato_seed: { en: 'Tomato seeds', 'zh-CN': '番茄种子' },
  item_eggplant_seed: { en: 'Eggplant seeds', 'zh-CN': '茄子种子' },
  item_pumpkin_seed: { en: 'Pumpkin seeds', 'zh-CN': '南瓜种子' },
  item_crop_corn: { en: 'Corn', 'zh-CN': '玉米' },
  item_crop_carrot: { en: 'Carrot', 'zh-CN': '胡萝卜' },
  item_crop_tomato: { en: 'Tomato', 'zh-CN': '番茄' },
  item_crop_eggplant: { en: 'Eggplant', 'zh-CN': '茄子' },
  item_crop_pumpkin: { en: 'Pumpkin', 'zh-CN': '南瓜' },
  item_fruit_apple: { en: 'Apple', 'zh-CN': '苹果' },
  item_fruit_pear: { en: 'Pear', 'zh-CN': '梨' },
  item_fruit_peach: { en: 'Peach', 'zh-CN': '桃子' },
  item_fruit_strawberry: { en: 'Strawberry', 'zh-CN': '草莓' },
  item_fruit_grape: { en: 'Grape', 'zh-CN': '葡萄' },
  item_fruit_blueberry: { en: 'Blueberry', 'zh-CN': '蓝莓' },
  item_forage_red_mushroom: { en: 'Red mushroom', 'zh-CN': '红蘑菇' },
  item_forage_purple_mushroom: { en: 'Purple mushroom', 'zh-CN': '紫蘑菇' },
  item_forage_wild_flower: { en: 'Wildflower', 'zh-CN': '野花' },
  item_forage_sunflower: { en: 'Sunflower', 'zh-CN': '向日葵' },
  item_forage_grass: { en: 'Wild grass', 'zh-CN': '野草' },
  item_stone: { en: 'Stone', 'zh-CN': '石头' },
  item_wall: { en: 'Wooden wall', 'zh-CN': '木墙' },
  item_floor: { en: 'Brick floor', 'zh-CN': '砖地板' },
  item_window: { en: 'Window', 'zh-CN': '窗户' },
  item_door_item: { en: 'Door', 'zh-CN': '门' },
  item_hoe: { en: 'Hoe', 'zh-CN': '锄头' },
  item_watering_can: { en: 'Watering can', 'zh-CN': '洒水壶' },
  item_axe: { en: 'Axe', 'zh-CN': '斧头' },
  item_pickaxe: { en: 'Pickaxe', 'zh-CN': '镐' },
  item_tree_apple: { en: 'Apple tree seedling', 'zh-CN': '苹果树苗' },
  item_tree_pear: { en: 'Pear tree seedling', 'zh-CN': '梨树苗' },
  item_tree_peach: { en: 'Peach tree seedling', 'zh-CN': '桃树苗' },
  item_bush_strawberry: { en: 'Strawberry bush', 'zh-CN': '草莓丛' },
  item_bush_grape: { en: 'Grape bush', 'zh-CN': '葡萄丛' },
  item_bush_blueberry: { en: 'Blueberry bush', 'zh-CN': '蓝莓丛' },
  item_furn_plant: { en: 'Potted plant', 'zh-CN': '盆栽' },
  item_furn_flower: { en: 'Flowers', 'zh-CN': '花' },
  item_furn_lamp: { en: 'Lamp', 'zh-CN': '灯' },
  item_furn_dresser: { en: 'Dresser', 'zh-CN': '柜子' },
  item_furn_chair: { en: 'Chair', 'zh-CN': '椅子' },
  item_furn_stool: { en: 'Stool', 'zh-CN': '凳子' },
  item_furn_clock: { en: 'Clock', 'zh-CN': '时钟' },
  item_furn_rug: { en: 'Rug', 'zh-CN': '地毯' },
};

/** Translate a key for the active language (English fallback, then the key itself). */
export function t(key: string): string {
  const row = STRINGS[key];
  if (!row) return key;
  return row[lang] ?? row.en ?? key;
}
