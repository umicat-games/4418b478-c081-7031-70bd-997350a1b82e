# Catopia — 系统架构设计（技术）

> 版本 0.2 | 日期 2026-07-02 | 状态：讨论中（§4 已与真实代码核对）
>
> 本文是 **Catopia 的技术架构**（游戏端 / 平台端 / 交互协议）。游戏世界观、玩法与交互**设计**在 [`design.md`](./design.md)。本文只谈"怎么把那套设计跑起来"。

---

## 0. 总原则

> **算法层扛日常（免费、即时、在游戏端）；AI 层扛少数有分量的时刻（计费、在平台端）。**

- 90% 的"Cato 活着"靠**游戏端算法**（行为、emoji、活动反应）——零成本、零延迟。
- 只有**稀有的、值得的时刻**才调**平台 AI**（对话、稀有主动说话、托付叙述）——计费、~1–3 秒延迟（用即时 emoji 盖住）。
- 默认能用 emoji 就不调 AI；credit 用尽 → 降级为纯 emoji（Cato 变安静，用游戏内语言表达）。

Catopia 的核心需求会**倒逼平台**长出两个通用能力（见 §2）：**场景感知的 observation** 和 **异步委托 / 延迟意图（async commission）**。

---

## 1. 游戏端（Phaser + `@umicat/phaser-sdk`）

**职责：一切高频、即时、免费的东西都在这里。**

### 1.1 场景即数据
- 岛 / Cato / POI / HUD 都是 `public/scenes/**` + `manifest.json`（可视编辑器可编）；行为逻辑在 `GameScene.ts`。
- 相机：3× 整数缩放、`pixelArt:true`（NEAREST）、RESIZE 自适应 + 整数步长 zoom、HUD 锚点。

### 1.2 算法层（每帧，免费）
- **Cato 行为状态机**：`follow`（松散跟随你的注意力/相机焦点）/ `investigate`（就近查看 POI）/ `idle`；**同屏/在场判定（co-presence gate）**。
- **活动系统**：采集/钓鱼的节拍 + 即时反应触发。
- **表达系统**：emoji / 短话 / 注意力气泡的触发与渲染；决定"这次给 emoji 还是升级到说话"（因子：稀奇度、距上次说话的冷却、心情、羁绊阶段、有没有新东西可说）。
- **托付调度器**：见 §3。

### 1.3 AI 触发点（算法决定何时调平台 AI）
- 玩家点开对话；
- 稀有发现 / 特殊场景的主动说话（省钱模式：先冒廉价 "!"，玩家点了才真调）；
- 托付结算后的叙述。

### 1.4 动作词表（供 AI 的 Do）
- 游戏声明 Cato 能做的动作：`move_to` / `pick_up` / `look_at` / `follow` / `refuse` …
- **AI 只选意图（哪个动作 + target），游戏端执行运动（寻路 / tween）**。一次交互一个 `say()`，绝不每帧调。

### 1.5 本地状态 & 平台依赖
- 本地状态 + 存档同步经 `umicat.saves`；多语言经 `umicat.locale`。

---

## 2. 平台端

**职责：少数有分量的 AI 时刻、持久化、计费。**

| 能力 | 载体 | 说明 |
|---|---|---|
| 运行时 AI | `umicat.ai.npc` → game-manager `RuntimeAiService`（`POST /games/{id}/ai/act`） | Observation → **Say + Do**。用于对话、稀有主动说话、托付叙述 |
| 人格 | Playbook（`public/playbooks/cato.md`，`loadPlaybook` 注入） | 改人格不改代码 |
| 记忆 / 存档 | `umicat.saves` | 长期记忆条目、关系状态、未结算托付、共同历史 |
| 计费 | game-manager credit | 玩家付费、单池记账；`SIGN_IN_REQUIRED`；余额不足 → 游戏端降级为 emoji |
| 多语言 | `umicat.locale` | 平台传玩家语言 |

### 2.1 需要平台新增/加强的原语（Catopia 倒逼平台）
1. **场景感知 observation**（部分已有 → 需固化为标准输入）：AI 调用要能带"近场上下文"——在哪 / 刚发生什么 / 附近有什么 POI / 相关记忆摘要。**收窄成近场**既更可信（Cato 只感知得到身边）又更省 token。
2. **异步委托 / 延迟意图（async commission）——新原语**：现在解析请求意图 → 过一段真实时间后结算 → 回来再叙述。区别于当前"当场" Observation→Say+Do。**所有"养一个会替你做事的 AI 伙伴"的游戏都会需要**（ADR-017 之上一层）。
3. **（暂缓）批量预烘焙台词**：若以后 Cato 主动说话变频繁，一次 AI 调用生成一批带前提标签的短句供算法挑用；v0 说话稀有，实时调用足够，不做。

---

## 3. 托付（异步委托）的实现

**通用的关键：把"有界的结果"和"无界的语言/叙述"拆开。** AI 吸收无限的请求与讲法；游戏只维护一小套"结果原语" + 物品/风味池。加内容 = 往原语里倒，不碰机制。

**四个结果原语**：`fetch`（带回物品）/ `discover`（发现地方或东西 + 见闻）/ `attempt`（尝试练习：成功/半成/失败 + 小成长）/ `vignette`（一段经历，无实物，产出情绪/回忆）。

**掷骰在游戏端**（按真实时间 + 条件），**意图解析与叙述在平台端**（AI）。护栏（不总成功/会带错/能拒绝/不可能的请求就地圆场/一次一两件/失败也暖）属设计，见 design.md §3.4。

---

## 4. 交互协议（游戏端 ↔ 平台端）

> **本节已与真实代码核对（SDK 1.0.62 / game-manager RuntimeAiService，2026-07-02）。** 标注 ✅已实现 / ⬜待做。真实 API 是 `umicat.ai.act(params)`（`umicat.ai.npc({...}).say()` 是它的封装）。

### 4.1 当场反应 / 对话 —— ✅ 已实现

**请求 `AiActParams`**（游戏端 → 平台，端点 `POST /games/{id}/ai/act`）：
```
{
  playbook?:    string,                       // 如 'cato'（S3 读 games/{id}/playbooks/cato.md）
  persona?:     { role?, goals?, style?, rules? },
  observation?: <任意游戏自定义 JSON，无固定 schema>,   // 平台原样塞进系统提示
  actions?:     [{ name, description?, args?: { 字段: "string"|"number"|"integer"|"boolean" } }],
  history?:     [{ from: 'player'|'npc'|'event', text?, data? }],   // 游戏端/SDK 维护，每回合全发
  options?:     { model?, maxTokens?, temperature? }   // ⚠️ npc() 不暴露，只在低层 act()
}
```
- **observation 是任意 JSON、无固定 schema**（`unknown` / `JsonNode`）。设计里"近场场景上下文（时间/天气/附近 POI/刚做的事/相关记忆）"= 往这个字段放什么的问题。⬜ **目前 Catopia 只发写死的 `{ island:'home', timeOfDay:'day' }`（stub）**。
- **actions[]** = Cato 能做的动作声明（= `do` 的词表，`args` 简写编译成 Anthropic tool schema）。⬜ **目前 Catopia 声明为空 = 纯说话，没有 Do**。

**响应 `AiActResult`**（平台 → 游戏端，判别联合）：
```
成功: { ok: true, say?: string, do?: [{ name, args }], usage?: { credits, balanceCredits, limitReached, model } }
失败: { ok: false, reason: 'SIGN_IN_REQUIRED' | 'INSUFFICIENT_CREDITS' | 'RATE_LIMITED' | 'UNAVAILABLE' }
```
- `say` = 台词（只显示、无副作用）；**`do` 是 AI 选的意图数组** `[{ name, args }]`，游戏端逐个**校验 + 执行**（平台永不改游戏状态）。
- 模型默认 `claude-haiku-4-5`（可选 `claude-sonnet-4-6`）；`max_tokens` 默认 400 / 上限 1024；RPC 60s 超时；`act()` 从不抛错，失败也走 `{ok:false, reason}`。

### 4.2 托付（异步，三段）—— ⬜ 待做（新原语，平台侧尚不存在）

> 现有 `ai.act` 是**当场**单发。托付需要平台新增"异步委托 / 延迟意图"能力。下面是提案形状。

1. **下达**：游戏端 → 平台 `{ requestText, observation }` → 平台（AI 解析）→ `{ intent: { primitive: fetch|discover|attempt|vignette, subject, condition, difficulty }, immediateSay }`
2. **结算**（游戏端本地，真实时间 + 条件掷骰）→ `outcome = { primitive, subject, result: success|partial|empty|surprise, items[], detail, catoFeeling }`
3. **叙述**：游戏端 → 平台（可复用 `ai.act`，把 outcome 当 observation）→ `{ say: 量身定做的小故事 }`

### 4.3 记忆（`umicat.saves`）—— API ✅ 已实现，⬜ Catopia 未接

- 真实 API：`saves.get(key)` / `saves.set(key, value, {ifVersion?}) → version` / `saves.delete(key)` / `saves.list()`，全 async，走后端（登录）或 localStorage（匿名/单机）。限额：单值 100KB、单游戏单用户共 1MB、最多 64 key、key 需匹配 `^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$`。
- ⬜ **目前 Catopia 完全没用 saves**：对话 `history` 只在内存 `Npc` 对象里、**重载即丢**。设计的三层记忆 / 长期记忆 / 共同历史**尚未落地**——接入记忆的第一步就是把它们 `saves.set` 持久化，并在 AI 调用时挑相关摘要塞进 observation。

### 4.4 计费 / 降级 —— ✅ 已实现（降级表现待对齐）

- 每次 AI 调用在 game-manager 扣 credit（`source="runtime_ai"`，与 agent 同池同 markup，进 Credit Usage）。**玩家付费、须登录。** 门控顺序：登录 → 是成员 → 限流(429) → 余额(402) → 游戏存在。
- reason 门控已实现：匿名 → home-ui broker 直接返回 `SIGN_IN_REQUIRED`（不打后端、不扣费）；402→`INSUFFICIENT_CREDITS`；429→`RATE_LIMITED`；其余→`UNAVAILABLE`。
- ⬜ **降级表现**：目前 Catopia 收到 reason 时显示**一句文字**（"Cato 打了个哈欠…"）；设计里是"降级成纯 emoji / 安静"——待对齐。

### 4.5 当前实现状态小结（GAP 一览）

| 项 | 状态 |
|---|---|
| Observation→Say+Do、`ai.act` 协议、reason 门控、playbook、billing | ✅ 已实现 |
| 丰富的近场 observation（时间/天气/POI/刚做的事/记忆） | ⬜ 现在是 `{island, timeOfDay}` stub |
| `actions[]`（Do 半边：可命令 / 一起做事 / 托付执行） | ⬜ 未声明，Cato 纯说话 |
| `umicat.saves` 持久化记忆（三层记忆 / 共同历史） | ⬜ 完全没接，history 重载即丢 |
| 托付（async commission） | ⬜ 平台新原语，未实现 |
| credit 用尽降级成 emoji | ⬜ 现在是一句文字 |
| emoji 默认 / 稀有实时 AI / 同屏才反应 / 行为状态机 | ⬜ 未实现（现在是点击→单发对话） |

---

## 5. 待解决（技术）

- [ ] 长期记忆如何持久化与截断（token 限制的工程问题）；`relevantMemories` 的挑选策略。
- [ ] async commission 原语在平台端的落地形态（game-manager 接口 / SDK API）。
- [ ] observation 标准形状的收敛（哪些字段必带、近场半径怎么定）。
- [ ] 托付结算掷骰在游戏端 vs 平台端的最终边界（离线期间的时间推进如何计算）。
