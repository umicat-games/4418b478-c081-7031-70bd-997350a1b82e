// The assistant's plumbing — the half that is the same in every game.
//
// It is the platform's runtime AI (ADR-017), and it is a virtual player rather
// than a referee: everything it can DO is in the actions the GAME declares,
// every one of those is re-checked by the game before it happens, and none of
// them moves a piece. Its job is language.
//
// What lives here: the conversation, the one queued question, the busy flag
// and the redraw signal, the refusals that are not exceptions, the summary
// that is the long memory, and the reset that makes a new game a new
// conversation. What lives in the GAME (`src/game/assistant.ts` here): what
// the assistant may do, what it can see, and what happens when it asks.
//
// The rule that makes any of it trustworthy: **the assistant never decides
// anything factual.** It is handed the engine's numbers and the referee's
// answers to talk ABOUT. A model asked to judge a position will invent one,
// fluently.
import type { ThreeUmicat } from '@umicat/three-sdk';
import type { AiActResult } from '@umicat/platform-sdk/protocol.js';
import { t } from '../i18n';

export type CoachMode = 'learning' | 'playing' | 'unknown';

export interface Profile<G = Record<string, unknown>> {
  /** What the player is here for. The assistant asks, and sets it. */
  mode: CoachMode;
  level: string;
  /** The assistant's own running note on this player, in its words. Written
   *  by `summarise()` and fed back in as observation — this IS the long
   *  memory. */
  summary: string;
  gamesPlayed: number;
  music?: boolean;
  sound?: boolean;
  evalBar?: boolean;
  /** They have put a stone down at least once, so the how-to line can go. */
  placed?: boolean;
  /** Whatever this game wants remembered about this player. */
  game: G;
}

export interface ChatMessage { from: 'coach' | 'player'; text: string; at: number }

export interface ActionDef { name: string; description?: string; args?: Record<string, string> }

/** What the game plugs into the assistant. */
export interface AssistantSpec<Ctx> {
  /** The markdown in `public/playbooks/<name>.md` — its persona and rules. */
  playbook: string;
  actions: ActionDef[];
  /** What it can see this turn. Small: it ships with every message. */
  observe(ctx: Ctx, profile: Profile<never>): unknown;
  /**
   * Run an intent the model chose. Everything is re-checked by the game; the
   * model choosing it is a request, not permission.
   *
   * `say` puts a line in the conversation as the assistant — use it when the
   * ANSWER is a measurement, so the game states it rather than hoping the
   * model repeats it correctly. `note` tells the model a fact for its next
   * turn. Return whether the action said anything out loud.
   */
  execute(name: string, args: Record<string, unknown>, say: (text: string) => void, note: (text: string) => void): boolean;
  /** The prompt that turns a conversation into the running note. */
  summaryPrompt(previous: string, transcript: string): string;
  /**
   * Last pass over the note before it is kept — only the game knows what a
   * coordinate looks like on its board.
   *
   * The note is the long memory: it outlives the game it was written in and
   * is handed to the model at the start of the NEXT one, where the board is
   * empty and it is the only thing on the table. Measured from a real game: a
   * note that the student "likes to play K13 and L13 to connect groups" came
   * back on move one of a fresh board as "good, this stone is close to L13 —
   * they are connected", with the point ringed. The model was not inventing;
   * it was reading its notes aloud, and nothing in them said they were about
   * somewhere else.
   */
  scrubNote?(note: string): string;
}

export class Coach<Ctx> {
  readonly messages: ChatMessage[] = [];
  /**
   * A question asked while it was still answering the last one.
   *
   * It used to be dropped, which from the outside is an assistant that
   * stopped replying. One question, not a queue: if they type three times
   * while it thinks, the last one is what they want an answer to.
   */
  private queued: { text: string; ctx: Ctx } | null = null;
  profile: Profile;
  private npc: ReturnType<ThreeUmicat['ai']['npc']>;
  private busy = false;

  /**
   * Which conversation is on the board.
   *
   * A turn is a round trip to a language model, and a player can start a new
   * game in the middle of one. The answer then arrives about a position that
   * is no longer there — which is exactly what it looked like: a brand new
   * board being told "your opponent played e5 and blocked your pawn". The
   * number is taken when a turn starts and checked when it lands.
   */
  private gen = 0;
  /**
   * Called whenever the conversation or its state changed.
   *
   * The UI used to be redrawn by the CALLER, around the await — which meant
   * the player's own message was not on screen until the reply came back,
   * because it is pushed inside the call the caller is waiting on.
   */
  onChange: (() => void) | null = null;

  constructor(private umicat: ThreeUmicat, private spec: AssistantSpec<Ctx>, defaults: Profile) {
    this.profile = { ...defaults };
    this.npc = this.freshNpc();
  }

  /**
   * A conversation with nothing in it.
   *
   * **Not `npc.reset()`.** Reset points the NPC's history at a new array, and
   * a `say()` that was already in flight still pushes its answer into
   * `this.npc.history` when it lands — which is now the NEW array. The last
   * game's sentence ends up in the next game's model context, invisible in
   * the panel (the generation fence below drops it from the screen) and fully
   * present to the model, which then carries on from it: "that g4 push left
   * the pawn hanging", on move one of a game where nobody has moved.
   *
   * A new NPC has its own array and the in-flight call keeps pushing into the
   * old one, which nothing reads again. Reproduced with a stubbed `ai.act`
   * held open by hand before this was written.
   */
  private freshNpc(): ReturnType<ThreeUmicat['ai']['npc']> {
    return this.umicat.ai.npc({
      playbook: this.spec.playbook,
      actions: this.spec.actions as unknown as Parameters<ThreeUmicat['ai']['npc']>[0]['actions'],
    });
  }

  get thinking(): boolean { return this.busy; }

  /** The player typed (or said) something. */
  async ask(text: string, ctx: Ctx): Promise<void> {
    this.messages.push({ from: 'player', text, at: Date.now() });
    this.onChange?.();
    if (this.busy) { this.queued = { text, ctx }; return; }
    await this.turn(text, ctx);
  }

  /**
   * Something happened that the assistant should mention unprompted. `note` is
   * the event in plain words; the model decides how (and whether) to react.
   *
   * **Tagged, because the protocol has no other way to say it.** A remark goes
   * out through the same `say()` the player's own typing does and lands in the
   * history as a turn from the player — so an English event line is, as far as
   * the model can tell, the student switching to English. The tag is what the
   * language rule in the observation points at.
   */
  async remark(note: string, ctx: Ctx): Promise<void> {
    await this.turn(`[the game] ${note}`, ctx, { silentIfEmpty: true });
  }

  private async turn(line: string, ctx: Ctx, opts: { silentIfEmpty?: boolean } = {}): Promise<void> {
    if (this.busy) return;
    const gen = this.gen;
    this.busy = true;
    this.onChange?.();
    try {
      const observation = this.spec.observe(ctx, this.profile as Profile<never>);
      const res = await this.npc.say(line, { observation });
      // The game it was about may be over and cleared away by now.
      if (gen !== this.gen) return;
      this.handle(res, opts);
    } finally {
      // Only the current conversation owns the flag; a stale turn
      // clearing it would let two answers run at once.
      if (gen === this.gen) { this.busy = false; this.onChange?.(); }
    }
    // A question that arrived mid-answer gets its turn now — after `busy` is
    // cleared, so the recursion is one deep.
    if (gen !== this.gen) return;
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
      // sign-in prompt, not a stack trace, and a player out of credits needs
      // to know the game still plays fine without the assistant.
      const text = t(res.reason === 'SIGN_IN_REQUIRED' ? 'chat.signIn'
        : res.reason === 'INSUFFICIENT_CREDITS' ? 'chat.noCredits'
          : 'chat.lost');
      this.messages.push({ from: 'coach', text, at: Date.now() });
      return;
    }

    const say = (text: string): void => { this.messages.push({ from: 'coach', text, at: Date.now() }); };
    const note = (text: string): void => { this.npc.note(text); };

    let spoke = false;
    for (const call of res.do ?? []) {
      spoke = this.spec.execute(call.name, (call.args ?? {}) as Record<string, unknown>, say, note) || spoke;
    }

    const said = (res.say ?? '').trim();
    if (said) { say(said); return; }
    if (opts.silentIfEmpty || spoke) return;

    // It acted without saying anything — usually marking something and
    // expecting the mark to speak for itself. It does not: the player asked a
    // question and got an ellipsis.
    say(t((res.do ?? []).length ? 'chat.marked' : 'chat.lost'));
  }

  /**
   * Compress the conversation into the running note on this player.
   *
   * Two jobs in one call, which is why it is worth its own round-trip: it is
   * the game's long memory, and it is what stops the chat history growing
   * without bound — every turn ships the history, so an unsummarised chat
   * gets more expensive every time they speak.
   */
  async summarise(from?: ChatMessage[]): Promise<string> {
    // Takes the transcript rather than reading the live one, so a caller can
    // hand over what was said, clear the screen, and let the writing happen
    // behind it — see `newSession`.
    const said = from ?? this.messages;
    const transcript = said.slice(-40).map((m) => `${m.from}: ${m.text}`).join('\n');
    if (!transcript) return this.profile.summary;
    const res = await this.umicat.ai.complete({
      prompt: this.spec.summaryPrompt(this.profile.summary || '(none yet)', transcript),
      maxTokens: 300,
    });
    if (res.ok && res.text.trim()) {
      const note = res.text.trim();
      this.profile.summary = this.spec.scrubNote ? this.spec.scrubNote(note) : note;
    }
    return this.profile.summary;
  }

  /** Start a fresh conversation, keeping what was learned from the old one.
   *  Nothing is lost: the transcript is summarised into the note first. */
  async newSession(): Promise<void> {
    /**
     * **The board must not wait for this.**
     *
     * Summarising the last game is a round trip to a language model, and it
     * used to happen BEFORE the new board was built — so pressing "new game"
     * showed an empty board for as long as the model took to write a note
     * about a game that was already over. It looked like the pieces were
     * loading. Nothing was loading; the game was waiting for its own
     * bookkeeping.
     *
     * The conversation is therefore taken and cleared SYNCHRONOUSLY — the
     * caller can put a board up in the same tick — and the note is written
     * from the copy, behind it.
     */
    const past = this.messages.slice();
    // Everything in flight belonged to the game that just ended: it must not
    // speak into this one, and it must not keep holding the turn — a dropped
    // greeting is how a new game opened with the last game's post-mortem and
    // nothing else.
    this.gen++;
    this.busy = false;
    this.queued = null;
    this.npc = this.freshNpc();
    this.messages.length = 0;
    if (past.length) await this.summarise(past);
  }

  /** Restore a saved conversation so the assistant remembers a player who
   *  left. The NPC's own history is rebuilt from the tail, not the whole log:
   *  the summary carries the rest, at a fraction of the tokens. */
  load(messages: ChatMessage[], profile: Profile): void {
    this.messages.splice(0, this.messages.length, ...messages);
    this.profile = { ...this.profile, ...profile, game: { ...this.profile.game, ...(profile.game ?? {}) } };
    for (const m of messages.slice(-8)) {
      if (m.from === 'player') this.npc.note(`The student said: ${m.text}`);
      else this.npc.note(`You said: ${m.text}`);
    }
  }
}
