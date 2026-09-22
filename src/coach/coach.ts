// The assistant — the half of the AI that talks.
//
// It is the platform's runtime AI (ADR-017), and it is a virtual player rather
// than a referee: everything it can DO is in `ACTIONS` below, every one of
// those is re-checked by the game before it happens, and none of them moves a
// piece. Its job is language — answering what the player asks, explaining what
// just happened, noticing that they keep losing the same horse.
//
// What makes the explanations worth anything is that it never has to judge the
// position itself. `observe()` hands it the ENGINE's read: who is better, by
// how much, what it would have played. A language model asked to evaluate a
// xiangqi position will confidently invent one — and unlike in Go, it will
// also lose track of which pieces are still on the board. Given the numbers
// and asked to explain them, it is doing what it is good at.
//
// Every call costs the player credits, so nothing here fires on a timer.
import type { ThreeUmicat } from '@umicat/three-sdk';
import type { AiActResult } from '@umicat/platform-sdk/protocol.js';
import { toIccs } from '../xiangqi/coords';
import { locale, t } from '../i18n';
import { RED, fileOf, rankOf, type XiangqiGame } from '../xiangqi/rules';
import { LEVELS, type Read } from '../xiangqi/opponent';
import { openingName } from '../xiangqi/openings';

/** What the assistant may ask the game to do. Deliberately short: every one of
 *  these is something the player could do from the panels anyway. */
const ACTIONS = [
  { name: 'set_level', description: `How hard the opponent plays. One of: ${LEVELS.map((l) => l.id).join(', ')}.`, args: { level: 'string' } },
  { name: 'start_game', description: 'Begin a new game. handicap is what Black gives away: none, horse, horses, chariot.', args: { handicap: 'string' } },
  // The description is what the model reads when it picks a tool, so it says
  // what this one does NOT do. In the Go game the marking tool kept being
  // chosen for questions that needed counting, and it answered nothing.
  { name: 'highlight', description: 'Draw rings on points you are talking about, e.g. "e4,c3" (coordinates only; empty string clears). It WORKS NOTHING OUT — for where a piece can go use show_moves, for what is hanging use show_danger.', args: { points: 'string' } },
  { name: 'show_moves', description: 'Ring every square the piece on this point may legally move to, and say them. Use this whenever the question is about where something can go.', args: { point: 'string' } },
  { name: 'show_danger', description: 'Ring every one of the player\'s pieces that is attacked right now, and say which. Use this for "am I safe", "what is he threatening", "did I hang anything".', args: {} },
] as const;

export type CoachMode = 'learning' | 'playing' | 'unknown';

export interface Profile {
  mode: CoachMode;
  level: string;
  /** What Black gives away at the start, as chosen in the new-game panel. */
  handicap: string;
  /** The assistant's own running note on this player. Written by `summarise()`
   *  and fed back in as observation — this IS the long memory. */
  summary: string;
  gamesPlayed: number;
  music?: boolean;
  sound?: boolean;
  evalBar?: boolean;
  /** They have moved a piece at least once, so the how-to line can go away. */
  moved?: boolean;
}

export const DEFAULT_PROFILE: Profile = {
  mode: 'unknown', level: 'steady', handicap: 'none', summary: '', gamesPlayed: 0,
};

export interface ChatMessage { from: 'coach' | 'player'; text: string; at: number }

/** What the game lets the assistant change. Each validates, and may say no. */
export interface CoachHooks {
  setLevel(level: string): boolean;
  startGame(handicap: string): boolean;
  /** Mark these points, as written ("e4,c3"); empty clears. Returns how many
   *  were actually put on the board — a coordinate the game cannot read marks
   *  nothing, and saying "marked it" anyway is worse than saying nothing. */
  highlight(points: string): number;
  /** Where the piece on this point may go. Null when there is nothing there. */
  showMoves(point: string): { piece: string; points: string[] } | null;
  /** Which of the player's pieces are under attack, and by what. */
  showDanger(): { points: string[]; note: string } | null;
}

export class Coach {
  readonly messages: ChatMessage[] = [];
  /** A question asked while it was still answering the last one. One, not a
   *  queue: if they type three times while it thinks, the last one is what
   *  they want an answer to. */
  private queued: { text: string; ctx: Context } | null = null;
  profile: Profile = { ...DEFAULT_PROFILE };
  private npc: ReturnType<ThreeUmicat['ai']['npc']>;
  private busy = false;
  /** Called whenever the conversation or its state changed — the panel is
   *  redrawn from here rather than around the await, or the player's own
   *  message does not appear until the reply comes back. */
  onChange: (() => void) | null = null;

  constructor(private umicat: ThreeUmicat, private hooks: CoachHooks) {
    this.npc = umicat.ai.npc({ playbook: 'coach', actions: ACTIONS as unknown as typeof ACTIONS[number][] });
  }

  get thinking(): boolean { return this.busy; }

  async ask(text: string, ctx: Context): Promise<void> {
    this.messages.push({ from: 'player', text, at: Date.now() });
    this.onChange?.();
    if (this.busy) { this.queued = { text, ctx }; return; }
    await this.turn(text, ctx);
  }

  /** An unprompted line. `note` is what just happened, in plain words; the
   *  model decides how, and whether, to react. */
  async remark(note: string, ctx: Context): Promise<void> {
    await this.turn(note, ctx, { silentIfEmpty: true });
  }

  private async turn(line: string, ctx: Context, opts: { silentIfEmpty?: boolean } = {}): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    this.onChange?.();
    try {
      const res = await this.npc.say(line, { observation: observe(ctx, this.profile) });
      this.handle(res, opts);
    } finally {
      this.busy = false;
      this.onChange?.();
    }
    const next = this.queued;
    this.queued = null;
    if (next) await this.turn(next.text, next.ctx);
  }

  private handle(res: AiActResult, opts: { silentIfEmpty?: boolean }): void {
    try { this.handleInner(res, opts); } finally { this.onChange?.(); }
  }

  private handleInner(res: AiActResult, opts: { silentIfEmpty?: boolean }): void {
    if (!res.ok) {
      // Structured refusals, not exceptions: an anonymous player needs a
      // sign-in prompt, and a player out of credits needs to know the game
      // still plays fine without the assistant.
      const text = t(res.reason === 'SIGN_IN_REQUIRED' ? 'chat.signIn'
        : res.reason === 'INSUFFICIENT_CREDITS' ? 'chat.noCredits'
          : 'chat.lost');
      this.messages.push({ from: 'coach', text, at: Date.now() });
      return;
    }

    let spoke = false;
    for (const call of res.do ?? []) spoke = this.execute(call.name, call.args as Record<string, unknown>) || spoke;

    const said = (res.say ?? '').trim();
    if (said) { this.messages.push({ from: 'coach', text: said, at: Date.now() }); return; }
    if (opts.silentIfEmpty || spoke) return;

    // It acted without saying anything — usually marking a point and expecting
    // the mark to speak for itself. It does not: the player asked a question
    // and got an ellipsis.
    this.messages.push({ from: 'coach', text: t((res.do ?? []).length ? 'chat.marked' : 'chat.lost'), at: Date.now() });
  }

  /** Run an intent the model chose. Everything is re-checked here; choosing it
   *  is a request, not permission. Returns whether the action itself said
   *  something to the player. */
  private execute(name: string, args: Record<string, unknown>): boolean {
    switch (name) {
      case 'set_level': {
        const id = String(args.level ?? '');
        if (LEVELS.some((l) => l.id === id) && this.hooks.setLevel(id)) this.profile.level = id;
        return false;
      }
      case 'start_game': {
        const handicap = String(args.handicap ?? 'none');
        if (this.hooks.startGame(handicap)) return false;
        // The game refused: there are pieces on the board. This used to go
        // through, and a game in progress simply disappeared.
        this.npc.note('[the game] a game is in progress, so a new one was NOT started. '
          + 'The student starts one themselves, from the gear at the bottom left.');
        this.messages.push({ from: 'coach', at: Date.now(), text: t('chat.midGame') });
        return true;
      }
      case 'show_moves': {
        const point = String(args.point ?? '');
        const out = this.hooks.showMoves(point);
        // Told back to the model so its NEXT sentence uses the real list, and
        // said out loud by the GAME, now — the model has finished its turn, and
        // waiting for it to speak again means the player is shown five rings
        // and never told what they are.
        this.npc.note(out
          ? `[the board] the ${out.piece} on ${point} can go to: ${out.points.join(', ') || 'nowhere at all'}`
          : `[the board] there is no piece of the player's on ${point}`);
        this.messages.push({
          from: 'coach',
          at: Date.now(),
          text: out
            ? (out.points.length
              ? t('chat.moves', { point, piece: out.piece, points: out.points.join('、') })
              : t('chat.movesNone', { point, piece: out.piece }))
            : t('chat.noPiece', { point }),
        });
        return true;
      }
      case 'show_danger': {
        const out = this.hooks.showDanger();
        this.npc.note(out && out.points.length
          ? `[the board] the player's pieces under attack right now: ${out.note}`
          : '[the board] nothing of the player\'s is attacked right now');
        this.messages.push({
          from: 'coach',
          at: Date.now(),
          text: out && out.points.length ? t('chat.danger', { list: out.note }) : t('chat.dangerNone'),
        });
        return true;
      }
      case 'highlight': {
        const asked = String(args.points ?? '');
        const marked = this.hooks.highlight(asked);
        if (!asked.trim() || marked > 0) return false;
        this.npc.note(`[the board] "${asked}" is not a point on this board, so nothing was marked. Use coordinates like e4.`);
        this.messages.push({ from: 'coach', at: Date.now(), text: t('chat.markFailed', { points: asked }) });
        return true;
      }
      default:
        // An unknown tool name is the model inventing a capability. Ignoring it
        // is the safety story working.
        console.warn('[coach] ignored unknown action', name);
        return false;
    }
  }

  /**
   * Compress the conversation into the running note on this player.
   *
   * Two jobs in one call: it is the game's long memory, and it is what stops
   * the chat history growing without bound — every turn ships the history, so
   * an unsummarised chat gets more expensive every time they speak.
   */
  async summarise(): Promise<string> {
    const transcript = this.messages.slice(-40).map((m) => `${m.from}: ${m.text}`).join('\n');
    if (!transcript) return this.profile.summary;
    const res = await this.umicat.ai.complete({
      prompt:
        `Here is a xiangqi (Chinese chess) coach's running note on a student, and the most recent conversation.\n\n`
        + `PREVIOUS NOTE:\n${this.profile.summary || '(none yet)'}\n\n`
        + `CONVERSATION:\n${transcript}\n\n`
        + `Write the updated note: at most 120 words, third person, factual. Cover what the `
        + `student is here for (learning or just playing), roughly how strong they are and on what `
        + `evidence, which openings or pieces they favour, and anything they keep getting wrong. `
        + `Keep anything from the previous note that still holds. Reply with the note only.`,
      maxTokens: 300,
    });
    if (res.ok && res.text.trim()) this.profile.summary = res.text.trim();
    return this.profile.summary;
  }

  /** Start a fresh conversation, keeping what was learned from the old one.
   *  Nothing is lost: the transcript is summarised into the note first. */
  async newSession(): Promise<void> {
    if (this.messages.length) await this.summarise();
    this.npc.reset();
    this.messages.length = 0;
  }

  /** Restore a saved conversation so the assistant remembers a player who
   *  left. The NPC's own history is rebuilt from the tail, not the whole log:
   *  the summary carries the rest, at a fraction of the tokens. */
  load(messages: ChatMessage[], profile: Profile): void {
    this.messages.splice(0, this.messages.length, ...messages);
    this.profile = { ...DEFAULT_PROFILE, ...profile };
    for (const m of messages.slice(-8)) {
      if (m.from === 'player') this.npc.note(`The student said: ${m.text}`);
      else this.npc.note(`You said: ${m.text}`);
    }
  }
}

export interface Context { game: XiangqiGame | null; read: Read | null }

/** The names the assistant speaks in — the same words that are on the pieces,
 *  so "your 马 on c3" matches what the player is looking at. */
const NAMES: Record<number, [string, string]> = {
  1: ['帅 (general)', '将 (general)'],
  2: ['仕 (advisor)', '士 (advisor)'],
  3: ['相 (elephant)', '象 (elephant)'],
  4: ['马 (horse)', '马 (horse)'],
  5: ['车 (chariot)', '车 (chariot)'],
  6: ['炮 (cannon)', '砲 (cannon)'],
  7: ['兵 (soldier)', '卒 (soldier)'],
};

export const pieceName = (side: number, type: number): string => NAMES[type][side === RED ? 0 : 1];

/**
 * What the assistant can see this turn.
 *
 * Small on purpose — it rides along with every message, so anything in here is
 * paid for on every turn. The board is a picture rather than a move list,
 * because "is this horse trapped" is a question about a picture; the engine's
 * read is included because without it the model would guess at who is winning,
 * and it would guess wrong.
 */
function observe(ctx: Context, profile: Profile): unknown {
  const { game, read } = ctx;
  const base = {
    language: {
      the_game_is_in: locale(),
      rule: 'Reply in the language the student writes to you in. When you speak first, use the language above.',
    },
    student: {
      here_for: profile.mode,
      games_played: profile.gamesPlayed,
      what_you_know_about_them: profile.summary || '(you have not met them before)',
    },
    settings: { opponent_level: profile.level, handicap: profile.handicap },
    notation: 'Squares are files a-i left to right from Red\'s seat and ranks 0-9 up from Red\'s back line. Red\'s general starts on e0, Black\'s on e9.',
  };
  if (!game) return { ...base, game: 'no game in progress' };

  const last = game.lastMove;
  return {
    ...base,
    game: {
      // Uppercase is Red (the student), lowercase is Black (the engine). The
      // first row printed is Black's back line, rank 9.
      position: game.position.diagram(),
      /**
       * How to read it — SAID OUT LOUD, not left as a comment in this file.
       *
       * The Go game left the orientation implicit and the assistant narrated
       * a guess about which half of the board the player's stones were on. A
       * model that has to work out which end of the picture is the top will
       * work out something, and then say it in the voice of someone who
       * knows.
       */
      legend: 'Each string is one rank. The FIRST rank printed is rank 9 — Black\'s back line, '
        + 'the far side from the student — and the LAST is rank 0, Red\'s own back line. The first '
        + 'character of every rank is file a, the last is file i. So the top-left square of the '
        + 'picture is a9 and the bottom-left is a0. UPPERCASE is Red, which is the student; '
        + 'lowercase is Black, which is you. K/k general, A/a advisor, B/b elephant, N/n horse, '
        + 'R/r chariot, C/c cannon, P/p soldier, "." empty.',
      student_plays: 'red',
      to_play: game.toPlay === RED ? 'red' : 'black',
      move_number: game.moves.length,
      last_move: last ? `${toIccs(fileOf(last.from), rankOf(last.from))}${toIccs(fileOf(last.to), rankOf(last.to))}` : null,
      in_check: game.position.inCheck() ? (game.toPlay === RED ? 'red is in check' : 'black is in check') : null,
      // Looked up, never guessed — see `openings.ts`. Null means the book does
      // not know this one, and saying nothing is then the honest answer.
      opening: openingName(game.movesIccs()),
      finished: game.over,
    },
    engine_read: read
      ? {
        note: 'Measured by the xiangqi engine, not by you. Trust these over your own reading.',
        // In soldiers rather than the engine's hundredths: "a horse and a bit"
        // is what a person says, and the model talks to people.
        red_ahead_by_in_soldiers: Math.round(read.score) / 100,
        mate_in_plies: read.mateIn ?? null,
        searched_plies: read.depth,
        engine_would_play: read.candidates.slice(0, 3).map((c) => `${toIccs(fileOf(c.from), rankOf(c.from))}${toIccs(fileOf(c.to), rankOf(c.to))}`),
      }
      : null,
  };
}
