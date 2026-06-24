# 狼人杀 / Werewolf — Game Design Document

## Concept

A single-player social deduction game where the human always plays on the good side and must identify and eliminate the werewolves among 5 AI-controlled players. The AI players behave like real humans: they lie, cast suspicion, shift blame, form alliances, and react dynamically to what the human player says.

## Players & Roles (6-player table)

| Seat | Controller | Possible Roles |
|------|-----------|----------------|
| You  | Human     | Seer OR Villager (randomly assigned, always good) |
| 5 others | AI (umicat.ai) | 2 Werewolves + remaining good roles |

**Role distribution:** 2 Werewolves · 1 Seer · 3 Villagers  
The human is always assigned Seer or Villager at random. If human is Seer, 1 AI gets the remaining Villager slot; if human is Villager, 1 AI gets Seer.

## Win Conditions

- **Good team wins:** All werewolves are eliminated by vote.  
- **Werewolf team wins:** Werewolves equal or outnumber the remaining good players.

## Game Flow

### 1. Language Selection
Choose Chinese or English at startup. All AI dialogue, UI text, and game messages use the selected language throughout.

### 2. Role Reveal
Private screen shows the human player their role. Werewolf AIs know each other's identity; Seer AI (if any) begins with no extra info.

### 3. Night Phase (repeated each round)
- **Werewolves act:** The 2 AI werewolves "discuss" and choose a victim. Shown to player as a brief dramatic pause ("夜晚降临…").
- **Seer acts:** If human is Seer, they pick one player to check (result: Good / Werewolf). If AI is Seer, AI secretly checks someone and stores the info for use in daytime discussion.
- Victim is announced at dawn.

### 4. Day Phase
1. **Announcement:** Who was killed last night.
2. **Discussion round:** Each player speaks in turn (AI players speak first/last based on seat order). Human can type freely; AI players read what was said and respond dynamically — challenging, agreeing, deflecting, accusing.
3. **Vote:** All players vote to eliminate one person. Human picks via click; AI players vote based on suspicion level, role agenda, and game state.
4. **Elimination:** Voted-out player is revealed and removed. Win condition is checked.

## AI Player Design

### Personas
5 distinct AI characters, each with a name and personality trait that affects their speaking style (skeptical analyst, anxious talker, cool deflector, loud accuser, quiet observer). Traits are cosmetic — all AIs reason from their actual role and game state.

### Role-based behavior
- **Werewolf AI:** Claims to be Villager or Seer (fake). Deflects suspicion onto others, builds false alibis, coordinates silently with the other wolf when possible. Will lie about night events.
- **Good AI (Villager):** Reasons from public information. Accuses based on behavioral patterns. May be wrong. Reacts to human player input.
- **Seer AI:** Possesses verified private information. Decides strategically when to reveal it (too early = risk getting killed by wolves; too late = good team loses votes).

### Dynamic response to human input
AI NPCs receive the human's message as context and generate a contextually relevant response — they can be swayed, challenged, or tricked. Werewolves may deny accusations convincingly; good AIs might shift suspicion based on what the human reveals.

## Visual Style

**Cartoon board-game aesthetic:**  
- Warm parchment/green felt table background  
- Player cards arranged in a semicircle (5 AI around the table, human at bottom center)  
- Each player has a cute illustrated avatar and name plate  
- Speech bubbles for AI dialogue  
- Phase indicator banner (Night / Dawn / Discussion / Vote)  
- Role cards shown face-down during game, revealed on elimination  
- Bright accent colors: gold for Seer, red for Werewolf reveal, grey for eliminated

## Language Support

- Language picker on title screen: **中文 / English**  
- All UI strings, AI prompts, system messages, and phase announcements are fully bilingual  
- AI dialogue is generated in the selected language  
- Choice persists for the session

## Controls

- **Click** player card → vote for elimination / (Seer) select for night check  
- **Text input box** → type your discussion message; press Enter or Send button  
- **Pass button** → skip speaking turn (optional)
