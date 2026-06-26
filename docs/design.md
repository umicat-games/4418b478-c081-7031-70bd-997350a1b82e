# Catopia — Game Design Document

> Version: 0.1 | Date: 2026-06-26 | Status: In Discussion

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

> You are not the protagonist. Your child is.

You are a "parent" living on your own island. Your task is to care for a **cute little spirit** — your child. They cannot be directly controlled by you; they have their own will, emotions, memories, and growth trajectory.
Everything you do — farming, gathering, building, shopping — exists to give them a better life.
They are your **only connection** to this virtual world.

---

## 2. How Catopia Differs from Animal Crossing

| Dimension | Animal Crossing | Catopia |
|-----------|----------------|---------|
| Player role | You ARE the character (avatar) | You are the "parent"; the spirit is the "child" |
| Character control | Direct control | Cannot directly control — they have their own behavior |
| Character intelligence | Scripted NPC dialogue | AI-driven, with real memory and conversation |
| Emotional investment | I'm building my own home | I'm raising a living being |
| Risk | Almost zero negative consequences | Real neglect → real consequences; soul departs but can return |
| Social connection | Players interact directly | Players connect indirectly through their children |

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
- [x] Extreme neglect outcome: **Soul departure + Path of Return** — farming, building, and writing letters can call the child back; they remember everything upon their return
- [x] Child's name: **Named by the player at game start** (just like a parent naming their child); can only be changed once in their lifetime — requires filing a request with the island's "Name Registry" NPC and waiting approximately 1 in-game week; the child and all their friends will remember the name change
- [ ] Loan system interest rates and repayment mechanics (details TBD)
- [x] Real-time visits: **Future update**, implemented as a dedicated "Playground" scene; v1.0 covers asynchronous social only
- [ ] How to persist and truncate the child's long-term memory (token limit engineering problem)
- [x] Player title: **Single-parent setup** (v1.0 has only one player caring for the child); the child calls the player by whatever name or nickname the player sets at the start ("What do you want them to call you?") — not forced to "Mom/Dad," kept neutral and warm
