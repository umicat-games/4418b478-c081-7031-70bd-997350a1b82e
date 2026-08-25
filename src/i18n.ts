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
  chatter_pack_full: { en: "The backpack's full! Store some stuff in the chest.", 'zh-CN': '背包满啦！先存点东西到箱子里吧～' },
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
  tab_backpack: { en: 'Backpack', 'zh-CN': '背包' },
  tab_shop: { en: 'Items', 'zh-CN': '物品' },   // the shop's 物品 sub-tab (opens alongside 房子)
  tab_house: { en: 'Houses', 'zh-CN': '房子' }, // the shop's 房子 sub-tab
  tab_catobag: { en: "Cato's bag", 'zh-CN': 'Cato的背包' },
  tab_settings: { en: 'Settings', 'zh-CN': '设置' },
  tab_calendar: { en: 'Calendar', 'zh-CN': '日历' },
  menu_coming_soon: { en: 'Coming soon', 'zh-CN': '敬请期待' },
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
  menu_select_mail: { en: 'Select a mail to read', 'zh-CN': '点一封邮件查看' },
  receipt_total: { en: 'TOTAL', 'zh-CN': '总计' },
  mail_claim: { en: 'Claim', 'zh-CN': '领取' },
  menu_settings_todo: { en: 'Settings (coming soon)', 'zh-CN': '设置（待补充）' },
  shop_pick_item: { en: 'Pick an item to buy', 'zh-CN': '选一个要买的物品' },
  shop_unit_price: { en: 'Price', 'zh-CN': '单价' },       // rendered "Price 20" / "单价 20"
  shop_balance: { en: 'Coins', 'zh-CN': '余额' },          // rendered "Coins 9999" / "余额 9999"
  shop_buy: { en: 'Buy', 'zh-CN': '购买' },                // rendered "Buy 20" / "购买 20"
  shop_no_coins: { en: 'Not enough coins', 'zh-CN': '金币不够' },
  chest_full: { en: 'Chest is full', 'zh-CN': '箱子满了' },
  shop_ordered: { en: 'Ordered — arrives tomorrow', 'zh-CN': '已下单，明早送达' },
  sale_full: { en: 'For-sale bin is full', 'zh-CN': '待售格满了' },
  // House purchase (房子 tab)
  house_pick: { en: 'Pick a house', 'zh-CN': '选一间房子' },
  house_buy: { en: 'Buy', 'zh-CN': '购买' },                  // rendered "Buy 1200" / "购买 1200"
  house_owned: { en: 'Current home', 'zh-CN': '当前的家' },
  house_pending: { en: 'Moving in tomorrow', 'zh-CN': '明天入住' },
  house_bought: { en: "Bought! You'll move in tomorrow", 'zh-CN': '已购买，明天入住新家' },
  home_basic_name: { en: 'Cozy Cabin', 'zh-CN': '温馨小屋' },
  home_basic_desc: { en: 'A snug one-room home to start out in.', 'zh-CN': '起步的一间小屋，简单温馨。' },
  home_kitchen_name: { en: 'Home with Kitchen', 'zh-CN': '带厨房的家' },
  home_kitchen_desc: { en: 'A roomier home with a real kitchen — stove, pots and a dining table.', 'zh-CN': '更宽敞的家，带真正的厨房——灶台、锅具和餐桌。' },
  // Overnight economy: the 3-tab mailbox + delivery/sale letters
  tab_pickup: { en: 'Pickup', 'zh-CN': '取货' },
  tab_forsale: { en: 'For Sale', 'zh-CN': '待售' },
  mail_sender_market: { en: 'Market Manager', 'zh-CN': '集市管理员' },
  mail_sales_receipt: { en: 'Sales Receipt', 'zh-CN': '销售回执' },
  mail_delivery_title: { en: 'Order Delivered', 'zh-CN': '订单送达' },
  // Crafting (work station modal)
  craft_title: { en: 'CRAFTING', 'zh-CN': '合成' },
  craft_pick: { en: 'Pick something to craft', 'zh-CN': '选一个要合成的东西' },
  craft_materials: { en: 'Materials', 'zh-CN': '所需材料' },
  craft_button: { en: 'Craft', 'zh-CN': '合成' },
  craft_need: { en: 'Not enough materials', 'zh-CN': '材料不够' },
  craft_full: { en: 'Chest is full', 'zh-CN': '箱子满了' },
  craft_done: { en: 'Crafted!', 'zh-CN': '合成成功！' },
  cook_title: { en: 'COOKING', 'zh-CN': '烹饪' },
  cook_pick: { en: 'Pick something to cook', 'zh-CN': '选一道要做的菜' },
  cook_ingredients: { en: 'Ingredients', 'zh-CN': '所需食材' },
  cook_button: { en: 'Cook', 'zh-CN': '烹饪' },
  cook_need: { en: 'Not enough ingredients', 'zh-CN': '食材不够' },
  cook_full: { en: 'Chest is full', 'zh-CN': '箱子满了' },
  cook_done: { en: 'Cooked!', 'zh-CN': '做好啦！' },
  cook_empty: { en: 'No recipes yet', 'zh-CN': '还没有菜谱' },
  action_use: { en: 'Use', 'zh-CN': '使用' },
  action_store: { en: 'Store', 'zh-CN': '存入箱子' },
  action_take: { en: 'Take', 'zh-CN': '取出' },
  bag_full: { en: 'Backpack full', 'zh-CN': '背包满了' },
  bag_chest_full: { en: 'Chest full', 'zh-CN': '箱子满了' },
  action_hotbar: { en: 'To Hotbar', 'zh-CN': '放到快捷栏' },
  action_sell: { en: 'Sell', 'zh-CN': '出售' },
  action_list: { en: 'List for sale', 'zh-CN': '上架待售' },
  action_take_back: { en: 'Take back', 'zh-CN': '取回' },
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
  item_fishing_rod: { en: 'Fishing rod', 'zh-CN': '鱼竿' },
  item_fish: { en: 'Fish', 'zh-CN': '鱼' },
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

  // ── Empty-hand HOVER inspect names (shown in the floating label over a hovered
  //    world object). Object-appropriate ("Peach tree", not "Peach"/"seedling").
  hover_cato: { en: 'Cato', 'zh-CN': 'Cato' },
  hover_tree_apple: { en: 'Apple tree', 'zh-CN': '苹果树' },
  hover_tree_pear: { en: 'Pear tree', 'zh-CN': '梨树' },
  hover_tree_peach: { en: 'Peach tree', 'zh-CN': '桃树' },
  hover_tree_plain: { en: 'Tree', 'zh-CN': '树' },
  hover_bush_strawberry: { en: 'Strawberry bush', 'zh-CN': '草莓丛' },
  hover_bush_grape: { en: 'Grape vine', 'zh-CN': '葡萄藤' },
  hover_bush_blueberry: { en: 'Blueberry bush', 'zh-CN': '蓝莓丛' },
  hover_forage_grass: { en: 'Wild grass', 'zh-CN': '野草' },
  hover_forage_sunflower: { en: 'Sunflower', 'zh-CN': '向日葵' },
  hover_forage_wild_flower: { en: 'Wildflower', 'zh-CN': '野花' },
  hover_forage_red_mushroom: { en: 'Red mushroom', 'zh-CN': '红蘑菇' },
  hover_forage_purple_mushroom: { en: 'Purple mushroom', 'zh-CN': '紫蘑菇' },
  hover_forage_small_stone: { en: 'Pebble', 'zh-CN': '小石子' },
  hover_stone: { en: 'Big rock', 'zh-CN': '大石头' },
  hover_mailbox: { en: 'Mailbox', 'zh-CN': '邮箱' },
  hover_chest: { en: 'Chest', 'zh-CN': '箱子' },
  hover_shop: { en: 'Shop', 'zh-CN': '商店' },
  hover_workstation: { en: 'Workbench', 'zh-CN': '工作台' },
  hover_house: { en: 'House', 'zh-CN': '房子' },
};

/** Translate a key for the active language (English fallback, then the key itself). */
export function t(key: string): string {
  const row = STRINGS[key];
  if (!row) return key;
  return row[lang] ?? row.en ?? key;
}
