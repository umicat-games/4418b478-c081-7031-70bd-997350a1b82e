# 狼人杀 / Werewolf

## What this is
Single-player AI Werewolf (social deduction game). Human always plays good side (Seer or Villager). 5 AI opponents powered by umicat.ai — lie, accuse, shift blame like real players. 6-player table: 2 Wolves, 1 Seer, 3 Villagers. Chinese/English bilingual.

## Implemented Features
- **Main menu** (LangScene) — reads `umicat.locale` as default language (fallback: localStorage → zh-CN); two buttons: "Start Game" and "Select Language"; lang picker is a pixel-style popup dialog (ESC/click-outside to close); choosing a language rebuilds the UI with updated labels
- **Role assignment** — Human always gets Seer or Villager; AI fills remaining roles (always 2 wolves)
- **5 distinct AI personas**: Victor (suspicious artist), Lily (beauty-obsessed nervous), Marcus (hothead), Arthur (smooth talker), Serena (silent observer)
- **Night phase** — AI wolves pick a victim via `umicat.ai`; seer investigates (human UI or AI auto-check)
- **Dawn phase** — victim revealed, death animation, win check
- **Discussion phase** — each alive player speaks in turn; human has real HTML `<input>` + Send/Pass buttons; AI responds dynamically to discussion log
- **Vote phase** — AI votes one by one with visual feedback; human clicks player card to vote; tie-breaking by random
- **Elimination** — card shake → grey-out → role reveal
- **Win conditions** — All wolves out → Good wins; Wolves ≥ Good players → Wolf wins
- **Graceful AI fallback** — if umicat unavailable or sign-in required, pre-written personality-appropriate lines used
- **Visual design** — green felt table on dark wood background; cream player cards with avatar circles; speech bubbles; night overlay with moon/stars; phase banner

## Key Implementation Details
- **Scenes**: BootScene → LangScene → WerewolfScene (GameScene exists but unused)
- **i18n**: `src/i18n.ts` — `t(key)`, `fontFor(lang)`, `setLang()`, `getCurrentLang()`
- **Fonts**: `public/webfonts.json` → ["Noto Sans SC", "Noto Sans"] (prevents CJK tofu)
- **AI NPCs**: One `umicat.ai.npc()` per AI player, created in `create()` after `await umicatReady`
- **Async game loop**: Phase functions chain via async/await; no while loops in `create()`
- **HTML input**: Real `<input>` element overlaid on canvas for discussion (IME-safe); cleaned up on shutdown
- **Player seats**: AI at [182,248], [402,154], [640,124], [878,154], [1098,248]; Human at [640,594]
- **Canvas**: 1280×720 landscape

## Changed This Turn
- **Main menu redesign**: LangScene now has "Start Game" + "Select Language" buttons. Platform locale (`umicat.locale`) used as default; saved preference still wins. Language picker is a pixel-style modal popup (sharp corners, double gold border, two language buttons, ESC/click-outside to close). On language change, scene rebuilds via `this.children.removeAll(true)` + `buildUI()`.
- **LangScene refactor**: Split into `buildUI()` (drawable, rebuilds on lang change) + `makePixelBtn()` (shared factory) + `showLangDialog()` + `showConsentDialog()`.
