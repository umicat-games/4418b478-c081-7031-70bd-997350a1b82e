// The coach — the half of the AI that talks.
//
// It is the platform's runtime AI (ADR-017), and it is a virtual player, not a
// referee: everything it can DO is in the `ACTIONS` list below, every one of
// those is checked by the game before it happens, and none of them puts a stone
// on the board. Its job is language — asking what the player wants, explaining
// what just happened, noticing that someone keeps losing the same corner.
//
// What makes the explanations worth anything is that it does not have to judge
// the position itself: `observe()` hands it the ENGINE's read — who is ahead,
// by how many points, which move was better and by how much. A language model
// asked to evaluate a Go position will confidently invent one; a language model
// given the numbers and asked to explain them is doing what it is good at.
//
// Every call costs the player credits, so nothing here fires on a timer. The
// coach speaks when spoken to, and otherwise only at the moments `shouldRemark`
// judges worth a sentence.
import type { ThreeUmicat } from '@umicat/three-sdk';
import type { AiActResult } from '@umicat/platform-sdk/protocol.js';
import { toGtp } from '../go/coords';
import type { GoGame } from '../go/rules';
import type { Read } from '../go/opponent';
import { LEVELS } from '../go/opponent';

/** What the coach is allowed to ask the game to do. Deliberately short: each
 *  one is a thing a player could do from the menus anyway. */
const ACTIONS = [
  { name: 'set_board_size', description: 'Change the board to 9, 13 or 19. Only between games.', args: { size: 'integer' } },
  { name: 'set_level', description: `How hard the opponent plays. One of: ${LEVELS.map((l) => l.id).join(', ')}.`, args: { level: 'string' } },
  { name: 'start_game', description: 'Begin a new game. handicap 0-5 stones for the student.', args: { handicap: 'integer' } },
  { name: 'highlight', description: 'Mark points on the board while you talk about them, e.g. "D4,E4". Empty string clears.', args: { points: 'string' } },
] as const;

export type CoachMode = 'learning' | 'playing' | 'unknown';

export interface Profile {
  /** What the player is here for. The coach asks, and sets it. */
  mode: CoachMode;
  level: string;
  boardSize: 9 | 13 | 19;
  /** The coach's own running note on this player, in its words. Written by
   *  `summarise()` and fed back in as observation — this IS the long memory. */
  summary: string;
  gamesPlayed: number;
}

export const DEFAULT_PROFILE: Profile = {
  mode: 'unknown', level: 'steady', boardSize: 9, summary: '', gamesPlayed: 0,
};

export interface ChatMessage { from: 'coach' | 'player'; text: string; at: number }

/** What the game lets the coach change. Each of these validates, and may say no. */
export interface CoachHooks {
  setBoardSize(size: number): boolean;
  setLevel(level: string): boolean;
  startGame(handicap: number): boolean;
  highlight(points: Array<{ x: number; y: number }>): void;
}

export class Coach {
  /** Everything said, oldest first. Trimmed for the model, kept for the player. */
  readonly messages: ChatMessage[] = [];
  profile: Profile = { ...DEFAULT_PROFILE };
  private npc: ReturnType<ThreeUmicat['ai']['npc']>;
  private busy = false;

  constructor(private umicat: ThreeUmicat, private hooks: CoachHooks) {
    this.npc = umicat.ai.npc({ playbook: 'coach', actions: ACTIONS as unknown as typeof ACTIONS[number][] });
  }

  get thinking(): boolean { return this.busy; }

  /** The player typed (or said) something. */
  async ask(text: string, ctx: { game: GoGame | null; read: Read | null }): Promise<void> {
    this.messages.push({ from: 'player', text, at: Date.now() });
    await this.turn(text, ctx);
  }

  /** Something happened that the coach should mention unprompted. `note` is the
   *  event in plain words; the model decides how (and whether) to react. */
  async remark(note: string, ctx: { game: GoGame | null; read: Read | null }): Promise<void> {
    await this.turn(note, ctx, { silentIfEmpty: true });
  }

  private async turn(
    line: string,
    ctx: { game: GoGame | null; read: Read | null },
    opts: { silentIfEmpty?: boolean } = {},
  ): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    try {
      const res = await this.npc.say(line, { observation: observe(ctx.game, ctx.read, this.profile) });
      this.handle(res, opts);
    } finally {
      this.busy = false;
    }
  }

  private handle(res: AiActResult, opts: { silentIfEmpty?: boolean }): void {
    if (!res.ok) {
      // Structured refusals, not exceptions: an anonymous player needs a
      // sign-in prompt, not a stack trace, and a player out of credits needs to
      // know the game still plays fine without the coach.
      const text = res.reason === 'SIGN_IN_REQUIRED'
        ? 'Sign in and I can talk you through the game. The board works either way.'
        : res.reason === 'INSUFFICIENT_CREDITS'
          ? 'I am out of credits, so I will stop talking — the game plays on without me.'
          : 'I lost my train of thought. Ask me again?';
      this.messages.push({ from: 'coach', text, at: Date.now() });
      return;
    }

    for (const call of res.do ?? []) this.execute(call.name, call.args as Record<string, unknown>);
    const said = (res.say ?? '').trim();
    if (said) this.messages.push({ from: 'coach', text: said, at: Date.now() });
    else if (!opts.silentIfEmpty) this.messages.push({ from: 'coach', text: '…', at: Date.now() });
  }

  /** Run an intent the model chose. Everything is re-checked here; the model's
   *  choosing it is a request, not permission. */
  private execute(name: string, args: Record<string, unknown>): void {
    switch (name) {
      case 'set_board_size': {
        const size = Number(args.size);
        if ([9, 13, 19].includes(size) && this.hooks.setBoardSize(size)) this.profile.boardSize = size as 9 | 13 | 19;
        return;
      }
      case 'set_level': {
        const id = String(args.level ?? '');
        if (LEVELS.some((l) => l.id === id) && this.hooks.setLevel(id)) this.profile.level = id;
        return;
      }
      case 'start_game': {
        const handicap = Math.max(0, Math.min(5, Number(args.handicap) || 0));
        this.hooks.startGame(handicap);
        return;
      }
      case 'highlight': {
        const size = this.profile.boardSize;
        const points = String(args.points ?? '')
          .split(',')
          .map((s) => fromGtpSafe(s, size))
          .filter((p): p is { x: number; y: number } => !!p);
        this.hooks.highlight(points);
        return;
      }
      default:
        // An unknown tool name is the model inventing a capability. Ignoring it
        // is the whole safety story working, so it is worth a line in the log
        // and nothing more.
        console.warn('[coach] ignored unknown action', name);
    }
  }

  /**
   * Compress the conversation into the coach's running note on this player.
   *
   * Two jobs in one call, which is why it is worth its own LLM round-trip: it
   * is the game's long memory (what the player is working on, how strong they
   * are), and it is what stops the chat history growing without bound — every
   * turn ships the history, so an unsummarised chat gets more expensive for the
   * player every time they speak.
   */
  async summarise(): Promise<string> {
    const transcript = this.messages.slice(-40).map((m) => `${m.from}: ${m.text}`).join('\n');
    if (!transcript) return this.profile.summary;
    const res = await this.umicat.ai.complete({
      prompt:
        `Here is a Go coach's running note on a student, and the most recent conversation.\n\n` +
        `PREVIOUS NOTE:\n${this.profile.summary || '(none yet)'}\n\n` +
        `CONVERSATION:\n${transcript}\n\n` +
        `Write the updated note: at most 120 words, third person, factual. Cover what the ` +
        `student is here for (learning or just playing), roughly how strong they are and on what ` +
        `evidence, what they have been taught already, and anything they keep getting wrong. ` +
        `Keep anything from the previous note that still holds. Reply with the note only.`,
      maxTokens: 300,
    });
    if (res.ok && res.text.trim()) this.profile.summary = res.text.trim();
    return this.profile.summary;
  }

  /** Restore a saved conversation so the coach remembers a player who left. */
  load(messages: ChatMessage[], profile: Profile): void {
    this.messages.splice(0, this.messages.length, ...messages);
    this.profile = { ...DEFAULT_PROFILE, ...profile };
    // The NPC's own history is rebuilt from the tail, not the whole log: the
    // summary carries the rest, at a fraction of the tokens.
    for (const m of messages.slice(-8)) {
      if (m.from === 'player') this.npc.note(`The student said: ${m.text}`);
      else this.npc.note(`You said: ${m.text}`);
    }
  }
}

const fromGtpSafe = (s: string, size: number): { x: number; y: number } | null => {
  const m = /^\s*([A-HJ-Ta-hj-t])\s*(\d{1,2})\s*$/.exec(s);
  if (!m) return null;
  const x = 'ABCDEFGHJKLMNOPQRST'.indexOf(m[1].toUpperCase());
  const y = size - Number(m[2]);
  return x >= 0 && x < size && y >= 0 && y < size ? { x, y } : null;
};

/**
 * What the coach can see this turn.
 *
 * Small on purpose — it rides along with every message, so anything in here is
 * paid for on every turn of the conversation. The board is included because a
 * coach that cannot see the position can only give generic advice; the engine's
 * read is included because without it the model would guess at who is winning,
 * and it would guess wrong.
 */
function observe(game: GoGame | null, read: Read | null, profile: Profile): unknown {
  const base = {
    student: {
      here_for: profile.mode,
      games_played: profile.gamesPlayed,
      what_you_know_about_them: profile.summary || '(you have not met them before)',
    },
    settings: { board_size: profile.boardSize, opponent_level: profile.level },
  };
  if (!game) return { ...base, game: 'no game in progress' };

  return {
    ...base,
    game: {
      board_size: game.size,
      // Row 1 is the TOP of the board, so row indices match the letters-and-
      // numbers the coach speaks in only after the conversion in coords.ts.
      // Given as `.`/`b`/`w` because a picture of the position beats any
      // list of moves for a model trying to answer "is this group alive".
      position: game.board.map((row) => row.map((c) => (c === 'black' ? 'b' : c === 'white' ? 'w' : '.')).join('')),
      student_plays: 'black',
      to_play: game.toPlay,
      move_number: game.turns.length,
      last_move: game.lastStone ? toGtp(game.lastStone.x, game.lastStone.y, game.size) : null,
      captures: { by_black: game.captures.black, by_white: game.captures.white },
      finished: game.over,
    },
    engine_read: read
      ? {
        note: 'Measured by the Go engine, not by you. Trust these over your own reading.',
        black_win_chance: Math.round(read.winRate * 100) / 100,
        black_points_ahead: Math.round(read.scoreLead * 10) / 10,
        engine_would_play: read.candidates.slice(0, 3).map((c) => toGtp(c.x, c.y, game.size)),
      }
      : null,
  };
}
