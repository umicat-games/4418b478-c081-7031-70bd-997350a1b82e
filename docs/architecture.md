# Catopia — 系统架构设计（技术）

> 版本 0.1 | 日期 2026-07-02 | 状态：讨论中
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

## 4. 交互协议（游戏端 ↔ 平台端，设计层数据形状）

> 非最终 schema，描述数据"形状"与流向。

### 4.1 当场反应 / 对话（同步）
- **游戏端 → 平台**：
  ```
  observation = {
    sceneId, catoPos, catoState, catoMood,
    timeOfDay, weather,
    nearbyPOIs: [...],          // 近场，非全岛
    playerJustDid: "...",       // 玩家刚做的事
    relevantMemories: [...],    // 挑相关的，非全量
    playerUtterance?: "..."     // 玩家这句话（若点开对话）
  }
  ```
- **平台 → 游戏端**：
  ```
  { say?: "一句话", do?: { action: <词表内>, target } }
  ```
  `say` 空 = 只做动作/只 emoji；`do` 空 = 只说话。AI 只选**声明过的动作**，运动由游戏端执行。

### 4.2 托付（异步，三段）
1. **下达**：游戏端 → 平台 `{ requestText, observation }` → 平台（AI 解析）→
   `{ intent: { primitive: fetch|discover|attempt|vignette, subject, condition, difficulty }, immediateSay }`
2. **结算**（游戏端本地，真实时间 + 条件掷骰）→
   `outcome = { primitive, subject, result: success|partial|empty|surprise, items[], detail, catoFeeling }`
3. **叙述**：游戏端 → 平台 `{ outcome, observation, relevantMemories }` → 平台（AI）→ `{ say: 量身定做的小故事 }`

### 4.3 记忆（`umicat.saves`）
- `saves.set / get`：长期记忆条目（含"共同历史"）、关系状态、未结算托付列表。
- AI 调用时游戏端挑**相关**记忆摘要塞进 observation（非全量）——省 token、更聚焦。

### 4.4 计费 / 降级
- 每次 AI 调用在平台扣 credit；`SIGN_IN_REQUIRED` / 余额不足 → 游戏端收到信号 → **降级为纯 emoji**（用游戏内语言表达"Cato 变安静"，不弹技术提示）。

---

## 5. 待解决（技术）

- [ ] 长期记忆如何持久化与截断（token 限制的工程问题）；`relevantMemories` 的挑选策略。
- [ ] async commission 原语在平台端的落地形态（game-manager 接口 / SDK API）。
- [ ] observation 标准形状的收敛（哪些字段必带、近场半径怎么定）。
- [ ] 托付结算掷骰在游戏端 vs 平台端的最终边界（离线期间的时间推进如何计算）。
