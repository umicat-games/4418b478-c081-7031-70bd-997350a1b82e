// The coach — the half of the AI that talks.
//
// It is the platform's runtime AI (ADR-017), and it is a virtual player, not a
// referee: everything it can DO is in the `ACTIONS` list below, every one of
// those is checked by the game before it happens, and none of them moves a
// piece. Its job is language — asking what the player wants, explaining what
// just happened, noticing that someone keeps losing the same bishop.
//
// What makes the explanations worth anything is that it does not have to judge
// the position itself: `observe()` hands it the ENGINE's read — who is better,
// by how much, which move it would have played. A language model asked to
// evaluate a chess position will confidently invent one; a language model
// given the numbers and asked to explain them is doing what it is good at.
//
// The same rule covers the things that look easy. A model asked "what is
// attacking my knight?" will answer off a text diagram, fluently and often
// wrongly — so `show_attacks` exists and the model is told to use it. Chess
// makes this trap worse than Go does, because the model has read a great deal
// of chess prose and can produce the right VOCABULARY for a position it has
// misread.
//
// Every call costs the player credits, so nothing here fires on a timer.
import type { ThreeUmicat } from '@umicat/three-sdk';
import type { AiActResult } from '@umicat/platform-sdk/protocol.js';
import { fromSan, toSan, type Sq } from '../chess/coords';
import { locale, t } from '../i18n';
import type { ChessGame, Odds, Side } from '../chess/rules';
import type { Read } from '../chess/opponent';
import { LEVELS } from '../chess/opponent';
import { openingName } from '../chess/openings';

/** What the coach is allowed to ask the game to do. Deliberately short: each
 *  one is a thing a player could do from the menus anyway, or a question the
 *  board can answer exactly. */
const ACTIONS = [
  { name: 'set_level', description: `How hard the opponent plays. One of: ${LEVELS.map((l) => l.id).join(', ')}.`, args: { level: 'string' } },
  { name: 'start_game', description: 'Begin a new game. side is "white" or "black"; odds is "none", "knight", "rook" or "queen" (a piece taken off the OPPONENT\'s side).', args: { side: 'string', odds: 'string' } },
  { name: 'highlight', description: 'Mark squares on the board while you talk about them, e.g. "e4,d5". Empty string clears.', args: { squares: 'string' } },
  { name: 'show_attacks', description: 'THE BOARD COUNTS FOR YOU. Give a square: it marks and reports every piece attacking and defending it. Use this before saying anything is hanging, defended, or safe.', args: { square: 'string' } },
  { name: 'show_moves', description: 'THE BOARD COUNTS FOR YOU. Give a square: it marks and reports every legal move of the piece standing there. Use this before saying where a piece can or cannot go.', args: { square: 'string' } },
] as const;

export type CoachMode = 'learning' | 'playing' | 'unknown';

export interface Profile {
  /** What the player is here for. The coach asks, and sets it. */
  mode: CoachMode;
  level: string;
  side: Side;
  odds: Odds;
  /** The coach's own running note on this player, in its words. Written by
   *  `summarise()` and fed back in as observation — this IS the long memory. */
  summary: string;
  gamesPlayed: number;
  /** Sound settings, off only when the player has turned them off. */
  music?: boolean;
  sound?: boolean;
  /** They have made a move at least once — so the "how to move" line can go
   *  away and stay away. */
  moved?: boolean;
}

export const DEFAULT_PROFILE: Profile = {
  mode: 'unknown', level: 'steady', side: 'white', odds: 'none', summary: '', gamesPlayed: 0,
};

export interface ChatMessage { from: 'coach' | 'player'; text: string; at: number }

/** Exact answers the board gives back, for the model to put into words. */
export interface AttackReport {
  square: string;
  piece: string | null;
  attackers: string[];
  defenders: string[];
  /** Attacked by the other side and defended by nobody. Geometry, not
   *  judgement — whether taking it is GOOD is the engine's business. */
  undefended: boolean;
}

export interface MovesReport {
  square: string;
  piece: string | null;
  moves: string[];
}

/** What the game lets the coach change. Each of these validates, and may say no. */
export interface CoachHooks {
  setLevel(level: string): boolean;
  startGame(side: Side, odds: Odds): boolean;
  highlight(squares: Sq[]): void;
  showAttacks(at: Sq): AttackReport | null;
  showMoves(at: Sq): MovesReport | null;
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
  async ask(text: string, ctx: { game: ChessGame | null; read: Read | null }): Promise<void> {
    this.messages.push({ from: 'player', text, at: Date.now() });
    await this.turn(text, ctx);
  }

  /** Something happened that the coach should mention unprompted. `note` is
   *  the event in plain words; the model decides how (and whether) to react. */
  async remark(note: string, ctx: { game: ChessGame | null; read: Read | null }): Promise<void> {
    await this.turn(note, ctx, { silentIfEmpty: true });
  }

  private async turn(
    line: string,
    ctx: { game: ChessGame | null; read: Read | null },
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
      // sign-in prompt, not a stack trace, and a player out of credits needs
      // to know the game still plays fine without the coach.
      const text = t(res.reason === 'SIGN_IN_REQUIRED' ? 'chat.signIn'
        : res.reason === 'INSUFFICIENT_CREDITS' ? 'chat.noCredits'
          : 'chat.lost');
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
      case 'set_level': {
        const id = String(args.level ?? '');
        if (LEVELS.some((l) => l.id === id) && this.hooks.setLevel(id)) this.profile.level = id;
        return;
      }
      case 'start_game': {
        const side: Side = String(args.side ?? '').toLowerCase() === 'black' ? 'black' : 'white';
        const raw = String(args.odds ?? 'none').toLowerCase();
        const odds: Odds = raw === 'knight' || raw === 'rook' || raw === 'queen' ? raw : 'none';
        this.hooks.startGame(side, odds);
        return;
      }
      case 'highlight': {
        const squares = String(args.squares ?? '')
          .split(',')
          .map((s) => fromSan(s))
          .filter((s): s is Sq => !!s);
        this.hooks.highlight(squares);
        return;
      }
      case 'show_attacks': {
        const at = fromSan(String(args.square ?? ''));
        const out = at ? this.hooks.showAttacks(at) : null;
        // Told back to the model as an event, so its NEXT sentence can use the
        // real answer instead of the one it was about to invent.
        this.npc.note(out
          ? `[the board] ${out.square}: ${out.piece ?? 'empty'}. `
            + `attacked by ${out.attackers.join(', ') || 'nothing'}; `
            + `defended by ${out.defenders.join(', ') || 'nothing'}`
            + (out.undefended ? '. It is attacked and undefended.' : '')
          : `[the board] "${String(args.square ?? '')}" is not a square.`);
        return;
      }
      case 'show_moves': {
        const at = fromSan(String(args.square ?? ''));
        const out = at ? this.hooks.showMoves(at) : null;
        this.npc.note(out
          ? `[the board] the ${out.piece ?? 'nothing'} on ${out.square} has ${out.moves.length} legal move(s): ${out.moves.join(', ') || 'none'}`
          : `[the board] "${String(args.square ?? '')}" is not a square.`);
        return;
      }
      default:
        // An unknown tool name is the model inventing a capability. Ignoring
        // it is the whole safety story working, so it is worth a line in the
        // log and nothing more.
        console.warn('[coach] ignored unknown action', name);
    }
  }

  /**
   * Compress the conversation into the coach's running note on this player.
   *
   * Two jobs in one call, which is why it is worth its own LLM round-trip: it
   * is the game's long memory (what the player is working on, how strong they
   * are), and it is what stops the chat history growing without bound — every
   * turn ships the history, so an unsummarised chat gets more expensive for
   * the player every time they speak.
   */
  async summarise(): Promise<string> {
    const transcript = this.messages.slice(-40).map((m) => `${m.from}: ${m.text}`).join('\n');
    if (!transcript) return this.profile.summary;
    const res = await this.umicat.ai.complete({
      prompt:
        `Here is a chess coach's running note on a student, and the most recent conversation.\n\n`
        + `PREVIOUS NOTE:\n${this.profile.summary || '(none yet)'}\n\n`
        + `CONVERSATION:\n${transcript}\n\n`
        + `Write the updated note: at most 120 words, third person, factual. Cover what the `
        + `student is here for (learning or just playing), roughly how strong they are and on `
        + `what evidence, which openings they play, and the mistakes they keep making. `
        + `Keep anything from the previous note that still holds. Reply with the note only.`,
      maxTokens: 300,
    });
    if (res.ok && res.text.trim()) this.profile.summary = res.text.trim();
    return this.profile.summary;
  }

  /**
   * Start a fresh conversation, keeping what was learned from the old one.
   *
   * Nothing is lost: the transcript is summarised into the running note first,
   * which is where the long memory has always lived.
   */
  async newSession(): Promise<void> {
    if (this.messages.length) await this.summarise();
    this.npc.reset();
    this.messages.length = 0;
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

/**
 * What the coach can see this turn.
 *
 * Small on purpose — it rides along with every message, so anything in here is
 * paid for on every turn of the conversation. The diagram is included because
 * a coach that cannot see the position can only give generic advice; the
 * engine's read is included because without it the model would guess at who is
 * winning, and it would guess wrong.
 */
function observe(game: ChessGame | null, read: Read | null, profile: Profile): unknown {
  const base = {
    // The platform's language, for the times the coach speaks FIRST — a
    // greeting has no student sentence to take its language from, and guessing
    // it from an English system prompt is how a Chinese player gets greeted in
    // English by a coach that will then switch the moment they reply.
    language: {
      the_game_is_in: locale(),
      rule: 'Reply in the language the student writes to you in. When you speak first, use the language above.',
    },
    student: {
      here_for: profile.mode,
      games_played: profile.gamesPlayed,
      what_you_know_about_them: profile.summary || '(you have not met them before)',
    },
    settings: { opponent_level: profile.level, student_plays: profile.side, odds: profile.odds },
  };
  if (!game) return { ...base, game: 'no game in progress' };

  const moves = game.moves;
  return {
    ...base,
    game: {
      // Rank 8 first, the way a book prints a diagram. Uppercase is White.
      // A picture of the position beats a move list for a model trying to
      // answer "is my knight safe" — though it must still use show_attacks
      // rather than reading the answer off this.
      position: game.diagram(),
      student_plays: game.human,
      to_play: game.toPlay,
      move_number: game.moveNumber,
      moves_so_far: moves.slice(-16).join(' '),
      last_move: game.lastMove?.san ?? null,
      in_check: game.inCheck ? game.toPlay : null,
      opening: openingName(moves),
      material_balance_for_student: game.material(game.human),
      captured_by_student: game.captured()[game.human],
      captured_by_opponent: game.captured()[game.human === 'white' ? 'black' : 'white'],
      finished: game.over,
      outcome: game.outcome,
    },
    engine_read: read
      ? {
        note: 'Measured by Stockfish, not by you. Trust these over your own reading of the position.',
        // Pawns, not centipawns: "+1.2" is what a chess player reads, and the
        // model is writing for one.
        student_advantage_in_pawns: read.mate === null ? Math.round(read.cp) / 100 : null,
        mate_in: read.mate,
        student_win_chance: Math.round(read.winRate * 100) / 100,
        depth: read.depth,
        best_moves_for_the_side_to_move: read.candidates.slice(0, 3).map((c) => c.san),
        main_line: read.candidates[0]?.line.join(' ') ?? null,
      }
      : null,
  };
}

/** `{x,y}` → `"e4"`, for the reports handed back to the model. */
export const sq = (s: Sq): string => toSan(s.x, s.y);
