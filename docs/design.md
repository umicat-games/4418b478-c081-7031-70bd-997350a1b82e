# Catopia — Game Design Document

> Version: 0.3 | Date: 2026-07-02 | Status: In Discussion

---

## 1. Game Overview

**Title**: Catopia
**Genre**: Nurturing / Social / Simulation
**Platform**: Browser (landscape 1280×720)
**Art Style**: Sprout Lands Asset Pack (Cup Nooble) — pixel art, warm and fresh palette, cozy island-life feel

### Camera & Viewport

- **Tile size**: 16×16 px (source art)
- **Display scale**: 3× integer zoom — each tile renders as 48×48 px on screen
- **Visible area**: ~26 tiles wide × ~15 tiles tall (1280÷48 ≈ 26.7, 720÷48 = 15)
- **Feel**: Close-up, warm farm view — like Sprout Lands / Stardew Valley. Never pull so far out the character feels tiny
- **Pixel fidelity**: Nearest-neighbor sampling, integer scaling only — absolutely no blur or sub-pixel smoothing. Pixels must stay sharp and crisp at all zoom levels
- **Day & Night**: The island transitions between day and night in sync with in-game time. Lighting shift is achieved via a full-screen color tint overlay — warm golden daylight → soft blue-grey dusk → deep indigo night. The child's schedule (active during day, resting at night) maps to this cycle. Exact palette TBD, but the goal is *felt* atmosphere, not just a dark screen

### Core Premise

> You and Cato are companions exploring this world together.

You share an island with **Cato — a cute little cat-spirit**. Cato is **not a dependent child** you keep alive; he is a **self-sufficient companion** who lives his own small life (he plants and forages the basics on his own). You cannot directly control him — he has his own will, moods, memories, and reactions.

Your role is to be his **partner and his window to the wider world**: you reach beyond the island — trade for new seeds he can't find alone, buy new recipes, open up new islands — and then **you explore all of it *together*, side by side**. The bond grows not from *caring for* him but from *doing things with* him: discovering the unknown, plus the small joys and gifts you share along the way.

Cato is your companion **and** your bridge to this virtual world — new places, new content, and new adventures arrive through him.

> **Relationship model:** companions / friends, **not** parent↔child. See "Relationship Model & The Core Loop" below — it is the current (v0.3) direction and supersedes the older parent/child framing still present in §3–§4.

---

## 2. How Catopia Differs from Animal Crossing

| Dimension | Animal Crossing | Catopia |
|-----------|----------------|---------|
| Player role | You ARE the character (avatar) | You are Cato's **companion** (not his parent) — a partner + his window to the world |
| Character control | Direct control | Cannot directly control — Cato has his own behavior |
| Character intelligence | Scripted NPC dialogue | AI-driven, with real memory and conversation |
| Emotional investment | I'm building my own home | I'm exploring a world **together with a friend** |
| Risk | Almost zero negative consequences | Cato is self-sufficient — neglect **cools the friendship** (recoverable), never kills him |
| Social connection | Players interact directly | Players connect indirectly through their companions |

---

## Core Attraction — What Makes This Genre Work (and What Catopia Must Nail)

> The surface mechanics of farming games (plant, harvest, sell) are the **engine**, not the **hook**. This section names what actually retains players in cozy nurture/farming games, and what that demands of Catopia — because Catopia keeps the engine but swaps the heart. It sharpens the Design Pillars in §8 with the *why* and the *risks*.

### Why farming games actually hook

Beneath "planting and trading" sit five real drivers:

1. **Reliable compounding.** Sow one, reap many, reinvest — a slot machine whose payout is *guaranteed if you show up*. This is the "just one more day" motor.
2. **Time as a resource → a daily ritual.** Growth is gated by day-cycles, so returning is driven by anticipation ("the crops are ready"). Desire lives in the *gap* between action and reward — the genre engineers the wait.
3. **Order out of chaos, visible and permanent.** A wild plot becomes a tidy, productive, beautiful machine. Effort is externalized into a thing you can see — the farm is an "outer self."
4. **Pressure-free, self-authored goals.** Little to no fail state; the player sets their own targets. A gentle optimization sandbox.
5. **Relationships are the real retention.** In Stardew, the villagers (gifting, hearts, festivals) are why people stay; the crops merely *fund* the social layer. The mechanic is the means; the people are the reason.

**Takeaway:** farming = a reliable-compounding + daily-ritual *engine* that funds *meaning* (beautification, relationships, self-expression).

### Why Animal Crossing works (the design underneath)

- **The real-world clock is the killer mechanic.** The game runs on your actual calendar, so the world keeps happening while you're away (villagers move, seasons turn, holidays arrive). This manufactures *aliveness*: you **visit** a world that exists independently of you. The player's absence is part of the design.
- **No goals, no failure = permission to just *be*.** Pressure is removed; players project their own goals (complete the museum, design the island, collect villagers).
- **Villagers are parasocial anchors.** Low-fidelity animals that **remember you**, greet you, write letters, and notice when you've been gone ("Where have you been?!"). Being *noticed and missed* by a small creature carries enormous emotional weight for very little content.
- **Collection + completion** (bugs, fish, fossils, furniture) taps a deep set-completion drive.
- **Self-expression + slow drip.** Your island/house/outfit is a shareable creative canvas; real-time build timers make each day scarce and precious.

**Takeaway:** AC = *a world that lives without you* + *NPCs who notice your presence and absence* + *a pressure-free canvas for self-expression and collection*, all metered by real time.

### The psychology beneath both

- **Self-Determination Theory** — autonomy (own goals), competence (visible progress), relatedness (NPC bonds). Cozy games satisfy all three, gently.
- **The care / being-needed drive** (Tamagotchi, Neko Atsume) — tending something that *needs you and responds to you* is a powerful hook; its core is **reciprocity**.
- **Investment = ownership** — the more you put in, the more it's "yours," and sunk cost turns into love.

### What this means for Catopia — we keep the engine, swap the heart

Farming's "crop" is a passive machine that reflects your effort. Catopia's "crop" is an **active agent** — Cato — who reflects your effort back *with* agency, memory, and emotion. That is the differentiation and the risk. Concretely, five imperatives:

1. **Being noticed and remembered IS the game, not a garnish.** Cato must perceive what you did and *remember* it (this is the load the Memory System in §5.2 must carry). "You brought me fish yesterday — thank you" is AC's "where have you been?" at 100×. Our reward currency is **Cato's reactions, growth, and memory of you**, not coins.
2. **Uncontrollability = aliveness.** Because you can't puppet Cato, he must *feel alive* — wandering, preferences, moods, small surprises. His independence is the feature (as AC villagers live without you). Treat "you can't control him" as the emotional payoff, not a limitation: he is a being you *influence*, not a puppet.
3. **Your agency is expressed through the environment.** You shape the *world* — plant his favorite flower, build a spot he likes, leave food — and he responds. This is the god-game / gardener model of *indirect* control.
4. **Feedback legibility is the lifeline.** Indirect care only feels good when the player can plainly **see that it landed**. If the player can't perceive that their effort changed Cato, "indirect" becomes "powerless." Every act of care needs a visible, timely echo.
5. **Rewards compound emotionally/narratively, not economically.** Not "harvest → coins → buy → repeat" but "provide → Cato's mood/state/memory shifts → new dialogue, behaviors, and milestones unlock." The long arc of 养成 (raising) is that **Cato grows into a specific individual because of how you raised him** (Tamagotchi/Chao, not a generic pet).

### Design ancestors worth studying (closer to Catopia than AC)

- **Chao Garden (Sonic Adventure)** — ★ closest: you feed / indirectly care, and each Chao grows a different personality, stats, and look from *how* you raise it.
- **Viva Piñata** — you tend a garden to *attract and raise* creatures you don't directly control; agency is entirely environmental.
- **Neko Atsume** — you place things to attract cats; they come and go freely and leave gifts. Pure indirect + collection + surprise.
- **Spiritfarer** — caretaking-of-others *as the core loop*, with strong emotional relationships.
- **Tamagotchi / Digimon** — how you care determines who they become.

### Honest risks

- If gathering is a chore and Cato's responses are shallow, Catopia is just a *worse* farming game. **The AI's reactions and memory must carry real emotional weight**, or the loop is hollow.
- Losing direct control is frustrating unless *influence* is satisfying and legible (see imperative #4).
- "No goals" still needs a gentle progression spine (Cato's needs + milestones) so the experience doesn't dissolve into aimlessness.

### The core hook, in one line

> **Not "plant and sell," but "a small being who lives in real time, remembers you, and changes because of you — with whom, through your care for the world, you slowly grow a relationship that is uniquely yours."** Farming/gathering is the **engine that supplies** it; memory + autonomy + legible response is the **heart**.

---

## Relationship Model & The Core Loop (v0.3 — current direction)

> This is the current converged direction. It **supersedes the parent/child, survival-dependency framing** in the older sections below (§3's "child," §3.4 "Survival Risk & Soul Return," §4's self-enrichment economy) — those are earlier v0.1 exploration, kept for reference and being revised to match this.

### Companions, not caretaking

Cato is **not a dependent child** you keep alive — he is a **self-sufficient companion**. The relationship is **friend / partner**, not parent / child. This single reframe solves three problems at once:

1. **It cures conversation fatigue.** Friends don't sit and *talk*; they *do things together*, and talk spills out of the doing. The main activity is shared adventure; conversation is the seasoning around it, so it never dries up — there's always something new in front of you both to react to.
2. **It answers "why not just use ChatGPT?"** The value was never the chat. ChatGPT out-chats Cato any day — but it can't give you *a world you two share, a history of places you explored together, a companion who remembers the journey.* Catopia's moat is **world + shared history + joint activity**, not conversation quality. The talk earns its meaning from what you've done together — it's grounded, not free-floating.
3. **It makes the bond fun.** You have a deep bond with your parents, yet hanging out with them isn't "fun" — fun comes from *peers* exploring together. Cato as a **companion** (not a ward) shifts the game's energy from duty / worry to curiosity / play. This also fits what a cat *is* — a semi-independent creature that *chooses* to be with you — and aligns with the playbook's existing "guardian ↔ guarded spirit, Pokémon-like, NOT parent/child" lean.

### The division of roles

- **Cato = the local & the basic.** He self-sustains: plants and forages basic crops, lives his own small daily life. He does **not** need you to survive.
- **You = the beyond & the new.** You reach past the island — trade for seeds he can't get alone, buy new recipes, unlock new islands. **You are his window to the wider world.**
- **Together = exploration.** New content (a new island, a new discovery) is experienced **side by side**. **Cato travels *with* you** (confirmed direction) — physically along for the adventure, not left at home.

### Why "travel together" matters: real-time, grounded conversation

Cato being **present with you in a new place** is the engine that keeps talk fresh: standing next to you on a new island, reacting to what you're both seeing *right now* ("What is that thing?!" / "Let's go look!"). The conversation is anchored in a **live, shared, novel situation** — the strongest possible form of grounded talk, and the exact opposite of opening a chat box in a vacuum. **Exploration content directly becomes conversation content.**

*Design/tech consequence:* Cato's AI must be **scene-aware** — his observations include *where we are / what we just found / what you just did* — so he can comment in context. This is exactly the platform's runtime-AI Observation→Say/Do primitive (ADR-017); Catopia's core need drives the hardest, most differentiating platform work, which validates the "Catopia drives the platform" thesis.

### The core loop (light farming, heavy connection)

```
        You reach beyond ─────────────────────────────┐
   (trade for new seeds / recipes / unlock new islands) │
                                                        ▼
              Explore the new — TOGETHER, side by side
              (Cato reacts in real time, in context)
                                                        │
                    ┌───────────────────────────────────┤
                    ▼                                    ▼
   Gift / cook for him / bring things back        Shared discoveries + history
   (deepens the friendship — optional,             (what you two did together;
    NOT survival)                                   Cato remembers it)
                    │                                    │
                    └─────────────────┬──────────────────┘
                                      ▼
             Deeper bond → Cato opens up, grows, wants to go
             further → drives the next expedition

   Meanwhile, back home: Cato self-farms the basics (light, autonomous).
```

The relationship grows from **doing together**, not from **caring for**. Farming / trading is *light in time* but *essential in role* — it's the material and the stakes of your shared life (the well you draw from), never the main time-sink. **Most of a session may well be spent adventuring and talking with Cato, not tending crops — and that's correct** (light farming, heavy connection).

### The #1 risk, and the four things that fight it

The whole game rests on **Cato staying alive as a character over weeks**. The classic AI-companion death is "feels samey after three chats." Talk stays fresh only when grounded in a living context that keeps renewing. Four feeders keep it renewing:

1. **Shared novelty** — new islands / discoveries you experience together give him fresh, in-context things to react to.
2. **Memory** — every exchange carries your shared history ("remember that island with the glowing fish?").
3. **Growth / change** — how you adventure together shapes who Cato becomes; week-4 Cato ≠ day-1 Cato.
4. **What you just did** — the light farming / trading gives each meeting reciprocity and stakes ("did you find the seeds we needed?").

### Consequences of neglect (self-sustaining model)

Cato never dies and never must-be-fed. Away a long time → he simply lives his plainer, self-sufficient life — and, with memory, *notices*: the friendship **cools and must be re-warmed**, and you **missed things you'd otherwise have shared**. The cost is **relational and recoverable** (drift + missed moments), never survival. This replaces §3.4's "hunger → weakness → soul departs." (A heavier "soul departs but returns" beat may return *later* as an optional, recoverable *relationship-rupture* layer — never a v0 survival-failure state.)

### What v0 keeps vs. defers

- **v0 keeps:** self-sufficient Cato + light farming (2–3 crops, one forage type, one small shop pointed at Cato / expeditions) + **travel-together exploration of a second island or two** + real-time in-context chat + memory of shared history + gifting.
- **v0 defers:** seasons & four-season crops, building / furniture / loans, complex crafting & quality tiers, other players' islands (social), survival-failure / soul-departure, any self-enrichment economy.

---

## 3. The Child (Spirit) System

### 3.1 Form & Appearance

The child is a **cute little animal spirit** (non-human), visually inspired by Sprout Lands characters — a small cat or bunny form, expressive face, simple clothing, feeling like both a wild creature and a real little kid.
Each player's child has a **unique appearance** (color, ear shape, outfit, etc. randomized at birth; new clothing can be purchased in-game to change their look).

### 3.2 Behavior Layers

The child's behavior is split into two clear layers:

**Algorithmic Layer (daily life)**:
- Wanders and explores the island
- Spontaneous small actions: sitting under a tree, cloud-watching, fiddling with plants
- Moves toward the food storage or the player when hungry
- Automatically returns home to rest at nightfall
- Emotional state influences daily behavior (happy → runs around; sad → sits quietly in a corner)

**AI Layer (during interaction)**:
- When the player actively talks to the child, AI takes over the response
- The AI can perceive the current game state (hunger, weather, island resources, recent events)
- The AI holds a **history of interactions with the player** (what was said last time, which promises the player kept)
- The child proactively tells the player: what they did today, who they met, what they want
- If the player neglects the child for a long time (not logging in, not feeding), responses become increasingly distant — eventually silence

### 3.3 Personality & Emotional System

The child's personality is not fixed — it **evolves dynamically based on how they are raised**:

**Core Dimensions**:
- **Security**: The more consistently and promptly the player responds, the more secure the child feels; long-term neglect → anxiety / detachment
- **Curiosity**: Encouragement when the child explores → grows more adventurous; neglect → gradually withdraws
- **Sociability**: More interactions with other children → outgoing and sociable; isolation on the island → introverted
- **Materialism**: Frequent gifts of nice things → may become greedy OR may grow grateful (random element)

**Emotional States** (real-time):
- Happy / Content / Bored / Hungry / Sad / Angry / Longing / Anticipating

Emotions are driven by multiple factors: hunger level, time since last interaction, recent gifts, weather, social status.

### 3.4 Survival Risk & Soul Return

> ⚠️ **Superseded (v0.3).** This section reflects the earlier *parent/child, survival-dependency* model. Current direction (see "Relationship Model & The Core Loop") is a **self-sustaining companion**: Cato can't be starved and never dies; neglect **cools the friendship** (recoverable), it doesn't threaten his life. The "soul departs → path of return" idea may return LATER as an optional, recoverable *relationship-rupture* layer — never a v0 survival-failure state. Kept below for reference / future reworking.

The game is designed for **high emotional investment with real consequences — but always leaving room for hope**:

**Decline Stages (progressive warnings)**:
- **Hunger**: The child has a hunger meter; not feeding them gradually lowers their energy, reduces daily activity, and lowers their mood
- **Weakness**: After sustained hunger, the child enters a weakened state — no longer moving on their own, just lying down; AI conversation becomes quieter. This is the final warning
- **System Alert**: Before entering the weakened state, the player receives a platform notification / in-game message. Nothing happens abruptly

**Soul Departure (core consequence mechanic)**:
- After prolonged extreme neglect (genuinely abandoning care — not just missing a day or two), the child's soul quietly leaves the island
- A glowing little **spirit shrine** remains, along with a letter the child left behind — they haven't disappeared, they've simply gone to another world
- The game enters a **"Search & Return" state**: the child is gone, but everything on the island remains. The player can still tend to it

**The Path of Return (redemption gameplay)**:
- The player takes **deliberate action** to call the child's soul back:
  - 🌱 **Farming & Gathering**: Lovingly tend the neglected fields, accumulate a certain amount of "tokens of love"
  - 🏗️ **Building**: Prepare for the child's return — renovate their room, add new furniture
  - ✉️ **Writing Letters**: The player can write letters to the child; they travel to "that other world" and the child reads them (after returning, the AI child will tell you which letters they read and how they felt)
- Once enough is accumulated, the spirit shrine glows warmly and the child's silhouette reappears on the island
- The child returns **remembering everything** — they know what you did for them. This experience becomes part of their shared history, kept in memory forever

**Design Intent**: This is not about punishing the player — it's a story about **loss and finding again**. Departure carries weight; return carries meaning.

---

## 4. World & Economy System

### 4.1 The Island

- A fixed-size island in pixel top-down view (Sprout Lands style)
- Zones: **Home Zone** (player's cottage + child's room), **Farm Zone** (planting), **Nature Zone** (gathering wood, ore, wild fruit), **Beach Zone** (fishing)
- The island can slowly **grow and expand over time** (unlock new zones, new buildings)

### 4.2 Resources & Farming

- **Planting**: Buy seeds → water → wait to ripen → harvest
- **Gathering**: Chop trees (wood), mine rocks (ore), pick wild fruit, go fishing
- **Crafting**: Simple workbench — convert raw materials into higher-value goods (wood → furniture, fish → dried fish)
- All of these are **sources of income**

### 4.3 Economic Loop

```
Farming / Gathering / Fishing → Sell for coins → Buy food to feed the child
                                               → Buy decorations / furniture to improve life
                                               → Buy seeds to expand production
                                               → Repay loans
```

**Loan System** (a nod to Animal Crossing):
- At the start, the player has only a small cottage on the island
- They can take a loan from the island's "bank" (an adorably styled building) to upgrade their home and expand the child's room
- A better room → better child mood → more willing to interact with you

### 4.4 Island Shop (In-Game Online Store)

- A charming "island shopping interface" where players can buy:
  - Food (the child's daily necessity)
  - Toys (boost the child's mood)
  - Furniture (decorate the home)
  - Clothing (dress up the child)
  - Seeds (expand farming)
- Orders require "next-day delivery" (arrives one in-game day later), adding a sense of realism

---

## 5. AI Child — Communication Mechanics

### 5.0 AI and the Credit System

The child's AI conversation capability is provided by the platform and consumes the user's credits. The game itself does not manage billing — the platform SDK handles it centrally. When credits run low, the SDK returns an error, and the game must **express this in game-world language** rather than popping up a technical top-up prompt.

**Recommended in-game presentation**:
- When credits are insufficient, the child doesn't "error out" — instead they enter a "quiet state." They look a little absent-minded, murmuring "I don't really feel like talking today…" or just shaking their head
- The game sends a gentle in-game message: "Your heart-to-heart connection with [child's name] needs a recharge to continue…" and guides the player to top up
- The child's algorithmic-layer behavior (walking, daily actions) is unaffected — only the AI conversation layer pauses, so the player feels the child is "going quiet," not that the game is "throwing an error"

This design preserves immersion while wrapping the monetization prompt in an emotional narrative, making conversion feel more natural.

### 5.1 Controls & Dialogue Triggers

**Input**: Supports both mouse (desktop) and touch (tablet/phone) simultaneously. All interactions are "tap/click + drag" based — no keyboard needed to navigate the game world.

**Building & Gathering** (standard casual game style):
- **Gathering**: Tap/click a harvestable object (tree, ore, crop) → play gather animation → resource auto-added to inventory
- **Planting**: Tap a farm tile → choose a seed → confirm planting
- **Building**: Select a structure / item from the build menu → drag to target position → confirm placement
- **Panning the view**: Drag on empty ground to pan the map (island is fixed size, no zoom needed)
- All actions aim to be **completed in one or two steps** — casual rhythm, no complex crafting chains

**Player-initiated conversation**:
- Tap/click the child on the island → chat window appears (IM-style, with an input field and speech bubbles) → AI takes over the response
- The child's opening line reflects their current state:
  - Hungry: "I'm so hungry… did you forget about me today?"
  - Happy: "You're here! I did something really cool today!"
  - Long neglected: "…(silence, just looking at you)"
- When the chat window closes, the child returns to algorithmic daily behavior

**Child-initiated conversation**:
- Under specific trigger conditions, the child will **automatically pop up a dialogue** to interrupt the player — like a phone notification appearing
- Example triggers:
  - Hunger reaches warning threshold: "I… I'm not sure I can hold on much longer…"
  - After completing something fun: "I found an amazing place! Come see!"
  - After another child visits: "Someone named XX came to play with me today — they were so interesting!"
  - First login after a long absence: "You finally came…"
- These pop-ups have a **cooldown** and won't appear too frequently — maintaining surprise rather than annoyance

### 5.2 Memory System — Using Technical Limits to Simulate Real Forgetting

The child's memory has two layers, together creating a **more human memory experience than an all-knowing AI**:

**Short-term Memory (AI context window)**
- What the child currently "has in their head" is the AI's context window
- As conversation grows, early content naturally fades out — this isn't a flaw, it's how working memory works
- Recent events: the child remembers directly; conversation flows naturally

**Long-term Memory (persistent save data)**
- The game saves key events, important conversation summaries, and milestone moments as structured data in the platform's save system
- When the child can't recall something from their context, they can **trigger a "recall" action**: query the historical save, then inject the key info back into the current conversation
- This "flipping through memories" process has a visible in-game expression: the child furrows their brow in thought, then brightens: "Oh! Now I remember…"

**Three memory states, three corresponding responses**:
- 🟢 **Clearly remembers** (in context): responds directly, naturally
- 🟡 **Needs to recall** (not in context, but in save data): "Let me think…" → queries save → "Oh right! I remember now!"
- 🔴 **Truly forgot** (too long ago or never saved): "That was so long ago, I really can't remember…"

**Design Intent**: Forgetting isn't a bug — it's humanity. A child who occasionally forgets and needs to try hard to remember is more believable than an AI that recalls everything perfectly. Some memories disappear forever, which makes the ones that are remembered all the more precious.

### 5.3 Child's Perception (Observations)

Before responding, the AI can perceive:
- Current hunger and mood values
- Player behavior over the last N days (farming, shopping, login frequency)
- Current island resource status (food stock, money)
- Recent interactions with other children
- Historical conversation summaries with the player (long-term memory)
- Current weather and time of day (morning / evening / rain)

### 5.4 What the Child Can Do

The child can accept simple requests from the player:
- "Go check if the crops are ready" → runs over, comes back to tell you
- "Go say hi to [someone] (another child)" → sends a social request
- "Tell me what happened on the island today" → narrates what they observed

The child also **proactively makes requests**:
- "I want that new toy"
- "I want to visit [X]'s island"
- "I haven't had anything good to eat in a long time"

The player can agree or decline — the child will remember.

---

## 6. Social System (The World Between Children)

> **Scope note**: The social system is implemented in two phases. **v1.0 covers asynchronous social only**, focused on the core single-island experience. Real-time visits (the playground scene) are planned for future updates — like Animal Crossing DLC, continuously enriching the world.

### 6.1 Asynchronous Social (v1.0)

- When the player is offline, the child can automatically "leave the island" and visit other children's islands
- When the player logs back in, the child tells them who they visited yesterday and what happened
- Other players' children may also visit your island, leaving gifts or messages

### 6.2 Real-Time Visits (Future Update)

- A dedicated "Playground" scene where two children arrange to meet and play
- The two players can only communicate through their respective children, maintaining immersion
- The two AI children can talk to each other; the parents watch from the side and occasionally give their child a "nudge"
- **Priority**: Develop after the core island experience is stable

### 6.3 Social Relationship Chain

- Children have **friendship levels** with each other; multiple interactions lead to becoming "best friends"
- Best friends exchange gifts (via the in-game mail system)
- Through their child's social connections, players can discover "someone's mom/dad's island" — a real player's world they'd never have found otherwise
- Players can optionally share "parent contact info" (in-game private messages only) — but it's not required. Your connection can always remain only through the children

### 6.4 Privacy & Safety

- Players don't expose their real names — only in-game titles like "[child's name]'s parent"
- The child's visits require the player to enable "open" permissions
- "Only friends' children can visit" setting available

---

## 7. Game Pacing & Time Design

- **Real-time passage**: In-game time is linked to real time (not 1:1 — approximately 1 real hour = 1 in-game day)
- **No forced login**: Not logging in doesn't cause immediate negative consequences, but prolonged absence has cumulative effects
- **Seasons**: The game has four seasons, affecting available crops and the island's visual style
- **Daily vignettes**: The child has a "little story of the day" waiting for the player each day

---

## 8. Design Pillars

1. **The child is real** — Players must believe the child is a real being with memory and feelings, even if they are code
2. **Nurturing has weight** — Actions have consequences. Love requires effort; neglect has a cost
3. **Connection is magical** — You might form a genuine emotional bond with someone on the other side of the planet, through the friendship of two pixel spirits
4. **Life itself is the game** — There is no clear "win condition" — only the time you and your child spend together
5. **The child is the gateway to the world** — All new content, new scenes, and new features are delivered to the player through the child. They are not just the thing being raised — they are the player's only eyes and voice in this virtual world. The game menu won't tell you "new content is live" — the child comes running to say "I heard there's a new playground on the island — can you take me?" Every update is a story between parent and child, not a feature notification.

---

## 9. Open Questions

- [x] Game name: **Catopia**
- [x] Relationship model (v0.3): **companions / friends, NOT parent↔child** — Cato is self-sufficient; the bond grows from exploring together, not from caretaking (see "Relationship Model & The Core Loop"). Supersedes the parent/child framing in §1–§4.
- [x] Dependency model: **self-sustaining — Cato never starves/dies**; neglect cools the friendship (recoverable), not survival. Survival-failure / soul-departure (§3.4) deferred / reworked as an optional later relationship-rupture layer.
- [x] Exploration of new islands: **Cato travels *with* the player, side by side** (enables real-time, in-context conversation grounded in a shared new place).
- [ ] "Player title" / how Cato addresses the player: the old **single-parent** setup (§9 below) needs revisiting under the companion model — likely a name/nickname a *friend* would use, not "Mom/Dad."
- [x] Extreme neglect outcome: **Soul departure + Path of Return** — farming, building, and writing letters can call the child back; they remember everything upon their return
- [x] Child's name: **Named by the player at game start** (just like a parent naming their child); can only be changed once in their lifetime — requires filing a request with the island's "Name Registry" NPC and waiting approximately 1 in-game week; the child and all their friends will remember the name change
- [ ] Loan system interest rates and repayment mechanics (details TBD)
- [x] Real-time visits: **Future update**, implemented as a dedicated "Playground" scene; v1.0 covers asynchronous social only
- [ ] How to persist and truncate the child's long-term memory (token limit engineering problem)
- [x] Player title: **Single-parent setup** (v1.0 has only one player caring for the child); the child calls the player by whatever name or nickname the player sets at the start ("What do you want them to call you?") — not forced to "Mom/Dad," kept neutral and warm
