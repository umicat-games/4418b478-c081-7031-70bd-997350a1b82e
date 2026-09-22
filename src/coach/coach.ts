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
import { locale, t } from '../i18n';
import type { GoGame } from '../go/rules';
import type { Read } from '../go/opponent';
import { LEVELS } from '../go/opponent';

/** What the coach is allowed to ask the game to do. Deliberately short: each
 *  one is a thing a player could do from the menus anyway. */
const ACTIONS = [
  { name: 'set_board_size', description: 'Change the board to 9, 13 or 19. Only between games.', args: { size: 'integer' } },
  { name: 'set_level', description: `How hard the opponent plays. One of: ${LEVELS.map((l) => l.id).join(', ')}.`, args: { level: 'string' } },
  { name: 'start_game', description: 'Begin a new game. handicap 0-5 stones for the student.', args: { handicap: 'integer' } },
  // The description is what the model actually reads when it picks a tool, so
  // it says what this one does NOT do: it kept being chosen for "how many
  // liberties does this stone have?", where it marks the stone the player
  // already knew about and counts nothing.
  { name: 'highlight', description: 'Draw rings on points you are talking about, e.g. "D4,E4" (coordinates only; empty string clears). It COUNTS NOTHING — for liberties or how much air a group has, use show_liberties instead.', args: { points: 'string' } },
  // The course. The coach decides when EXPLAINING is finished, because it is
  // the only one who can tell whether the student followed it; everything after
  // that — whether the exercise was solved, which lesson is next — is the
  // game's, and no action here can touch it.
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
  /** Sound settings, off only when the player has turned them off. */
  music?: boolean;
  sound?: boolean;
  /** They have put a stone on a board at least once — so the "how to place a
   *  stone" line can go away and stay away. */
  placed?: boolean;
}

export const DEFAULT_PROFILE: Profile = {
  mode: 'unknown', level: 'steady', boardSize: 9, summary: '', gamesPlayed: 0,
};

export interface ChatMessage { from: 'coach' | 'player'; text: string; at: number }

/** What the game lets the coach change. Each of these validates, and may say no. */
export interface CoachHooks {
  setBoardSize(size: number): boolean;
  /** Mark a group's liberties and report them back. Null if there is no stone
   *  at that point — which is a thing the model will ask for.
   *
   *  Takes the point AS WRITTEN. Parsing it here would need a board size, and
   *  the only one available is the profile's, which is a remembered preference
   *  rather than the board on screen — a continued 13x13 game left it reading
   *  coordinates against a 9x9 and quietly finding nothing. */
  showLiberties(point: string): { liberties: number; stones: number; points: string[] } | null;
  setLevel(level: string): boolean;
  startGame(handicap: number): boolean;
  /** Mark these points, as written ("D4,E4"); empty clears. Returns how many
   *  were actually put on the board — a coordinate the game cannot read marks
   *  nothing, and saying "marked it" anyway is worse than saying nothing. */
  highlight(points: string): number;
}

export class Coach {
  /** Everything said, oldest first. Trimmed for the model, kept for the player. */
  readonly messages: ChatMessage[] = [];
  /**
   * A question asked while it was still answering the last one.
   *
   * It used to be dropped — `turn()` returned early when busy, so the player's
   * message went into the log, the panel showed "thinking", and nothing was
   * ever sent. From the outside that is a companion that stopped replying, and
   * the only way out was reloading the game.
   *
   * One question, not a queue: if they type three times while it thinks, the
   * last one is what they want an answer to.
   */
  private queued: { text: string; ctx: { game: GoGame | null; read: Read | null } } | null = null;
  profile: Profile = { ...DEFAULT_PROFILE };
  private npc: ReturnType<ThreeUmicat['ai']['npc']>;
  private busy = false;
  /**
   * Called whenever the conversation or its state changed.
   *
   * The UI used to be redrawn by the CALLER, around the await — which meant
   * the player's own message was not on screen until the reply came back,
   * because it is pushed inside the call the caller is waiting on. Anything
   * that changes what the panel should show now says so, here.
   */
  onChange: (() => void) | null = null;

  constructor(private umicat: ThreeUmicat, private hooks: CoachHooks) {
    this.npc = umicat.ai.npc({ playbook: 'coach', actions: ACTIONS as unknown as typeof ACTIONS[number][] });
  }

  get thinking(): boolean { return this.busy; }

  /** The player typed (or said) something. */
  async ask(text: string, ctx: { game: GoGame | null; read: Read | null }): Promise<void> {
    this.messages.push({ from: 'player', text, at: Date.now() });
    this.onChange?.();
    if (this.busy) { this.queued = { text, ctx }; return; }
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
    this.onChange?.();
    try {
      const res = await this.npc.say(line, { observation: observe(ctx.game, ctx.read, this.profile) });
      this.handle(res, opts);
    } finally {
      this.busy = false;
      this.onChange?.();
    }
    // A question that arrived mid-answer gets its turn now. After `busy` is
    // cleared, so the recursion is one deep and not a chain of stacked awaits.
    const next = this.queued;
    this.queued = null;
    if (next) await this.turn(next.text, next.ctx);
  }

  private handle(res: AiActResult, opts: { silentIfEmpty?: boolean }): void {
    // Every path out of here ends in a redraw, including the ones that push
    // nothing: `busy` has changed, and the dots have to stop.
    try { this.handleInner(res, opts); } finally { this.onChange?.(); }
  }

  private handleInner(res: AiActResult, opts: { silentIfEmpty?: boolean }): void {
    if (!res.ok) {
      // Structured refusals, not exceptions: an anonymous player needs a
      // sign-in prompt, not a stack trace, and a player out of credits needs to
      // know the game still plays fine without the coach.
      const text = t(res.reason === 'SIGN_IN_REQUIRED' ? 'chat.signIn'
        : res.reason === 'INSUFFICIENT_CREDITS' ? 'chat.noCredits'
          : 'chat.lost');
      this.messages.push({ from: 'coach', text, at: Date.now() });
      return;
    }

    const did = res.do ?? [];
    // Whether any of them said something to the player by itself — a timestamp
    // comparison was tried and is not a signal: two pushes a millisecond apart
    // look like two different moments.
    let spoke = false;
    for (const call of did) spoke = this.execute(call.name, call.args as Record<string, unknown>) || spoke;

    const said = (res.say ?? '').trim();
    if (said) { this.messages.push({ from: 'coach', text: said, at: Date.now() }); return; }
    if (opts.silentIfEmpty || spoke) return;

    // It acted without saying anything — usually marking a point and expecting
    // the mark to speak for itself. It does not: the player asked a question
    // and got an ellipsis, which reads as the companion having stopped. Say
    // what happened instead. (The playbook also tells it not to do this.)
    this.messages.push({
      from: 'coach',
      text: t(did.length ? 'chat.marked' : 'chat.lost'),
      at: Date.now(),
    });
  }

  /** Run an intent the model chose. Everything is re-checked here; the model's
   *  choosing it is a request, not permission. Returns whether the action
   *  itself said something to the player. */
  private execute(name: string, args: Record<string, unknown>): boolean {
    switch (name) {
      case 'set_board_size': {
        const size = Number(args.size);
        if (![9, 13, 19].includes(size)) return false;
        if (this.hooks.setBoardSize(size)) { this.profile.boardSize = size as 9 | 13 | 19; return false; }
        // Refused, which here means a game is in progress. Say so — to the
        // model, so its next sentence is not about a board that did not
        // change, and to the player, who was told something was happening.
        this.npc.note('[the game] the board cannot change in the middle of a game. It was NOT changed.');
        this.messages.push({ from: 'coach', at: Date.now(), text: t('chat.midGame'), });
        return true;
      }
      case 'set_level': {
        const id = String(args.level ?? '');
        if (LEVELS.some((l) => l.id === id) && this.hooks.setLevel(id)) this.profile.level = id;
        return false;
      }
      case 'start_game': {
        const handicap = Math.max(0, Math.min(5, Number(args.handicap) || 0));
        if (this.hooks.startGame(handicap)) return false;
        // The game refused: there are stones on the board. This used to go
        // through, and a game in progress simply disappeared.
        this.npc.note('[the game] a game is in progress, so a new one was NOT started. '
          + 'The student starts one themselves, from the gear at the bottom left.');
        this.messages.push({ from: 'coach', at: Date.now(), text: t('chat.midGame') });
        return true;
      }
      case 'show_liberties': {
        const point = String(args.point ?? '');
        const out = this.hooks.showLiberties(point);
        // Told back to the model, so its NEXT sentence can use the real number
        // rather than one it invented.
        this.npc.note(out
          ? `[the board] the group at ${point} has ${out.stones} stone(s) and ${out.liberties} liberties: ${out.points.join(', ')}`
          : `[the board] there is no stone at ${point}, so it has no liberties`);
        // AND said out loud, by the game, now. The model asked the question on
        // the player's behalf and has already finished its turn — waiting for
        // it to speak again means the player is shown four rings and never
        // told the number. This is a measurement, so the game states it.
        this.messages.push({
          from: 'coach',
          at: Date.now(),
          text: out
            ? t('chat.liberties', { point, stones: out.stones, liberties: out.liberties, points: out.points.join('、') })
            : t('chat.libertiesNone', { point }),
        });
        return true;
      }
      case 'highlight': {
        const asked = String(args.points ?? '');
        const marked = this.hooks.highlight(asked);
        if (!asked.trim() || marked > 0) return false;
        // It named something the board does not have. Told to the player,
        // because they are looking at a board with nothing new on it, and to
        // the model, because it can try again with a real coordinate.
        this.npc.note(`[the board] "${asked}" is not a point on this board, so nothing was marked. Use coordinates like D4.`);
        this.messages.push({ from: 'coach', at: Date.now(), text: t('chat.markFailed', { points: asked }) });
        return true;
      }
      default:
        // An unknown tool name is the model inventing a capability. Ignoring it
        // is the whole safety story working, so it is worth a line in the log
        // and nothing more.
        console.warn('[coach] ignored unknown action', name);
        return false;
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

  /**
   * Start a fresh conversation, keeping what was learned from the old one.
   *
   * A lesson is a session. Without this, opening lesson 2 dropped the coach
   * into the middle of the thread from lesson 1 — it picked up where that
   * conversation had stopped instead of starting the new subject, and every
   * turn kept paying to ship a transcript about capturing stones to a lesson
   * about eyes.
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
 * paid for on every turn of the conversation. The board is included because a
 * coach that cannot see the position can only give generic advice; the engine's
 * read is included because without it the model would guess at who is winning,
 * and it would guess wrong.
 */
function observe(game: GoGame | null, read: Read | null, profile: Profile): unknown {
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
    settings: { board_size: profile.boardSize, opponent_level: profile.level },
  };
  if (!game) return { ...base, game: 'no game in progress' };

  return {
    ...base,
    game: {
      board_size: game.size,
      // A picture of the position beats any list of moves for a model trying
      // to answer "is this group alive".
      position: game.board.map((row) => row.map((c) => (c === 'black' ? 'b' : c === 'white' ? 'w' : '.')).join('')),
      /**
       * How to read it — SAID OUT LOUD, not left as a comment in this file.
       *
       * It used to be a comment, and the model was left to work out for
       * itself which end of the picture was the top and which character was
       * the student. It does not work it out; it guesses, and then it narrates
       * the guess. Reported from a real game: "the engine wants D8 — that is
       * where most of your stones are", with every black stone on the other
       * side of the board.
       */
      legend: `Each string is one row. The FIRST row printed is the TOP of the board — `
        + `row ${game.size} — and the LAST is row 1. The first character of every row is `
        + `column A, the last is column ${'ABCDEFGHJKLMNOPQRST'[game.size - 1]}; columns skip `
        + `the letter I, as Go boards always do. So the top-left corner is A${game.size} and `
        + `the bottom-left is A1. "b" is the student, playing Black. "w" is you, playing White. `
        + `"." is an empty point.`,
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
