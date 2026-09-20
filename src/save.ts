// What survives leaving.
//
// Three keys, because they have three different lifetimes:
//
//   profile  who this player is and what the coach has learned. Forever.
//   chat     the conversation. Trimmed — the tail is verbatim, the rest lives
//            on inside `profile.summary`, which is why summarising matters.
//   game     the unfinished game, if there is one. Deleted when it ends.
//
// The platform gives a game 100KB per value and 1MB in total per player, which
// a chat log will reach eventually if nothing trims it. So `MAX_MESSAGES` is
// not a nicety: without it the save silently starts failing months in, which
// is the worst possible time to find out.
//
// A chess game is stored as its starting position plus the moves, not as the
// final FEN — see `ChessSnapshot`. A FEN alone would restore the pieces and
// quietly lose the repetition history, so a game that had already repeated
// twice would come back one repetition short of the draw it was heading for.
import type { ChatMessage, Profile } from './coach/coach';
import { DEFAULT_PROFILE } from './coach/coach';
import type { ChessSnapshot } from './chess/rules';
import type { ThreeUmicat } from '@umicat/three-sdk';

const KEY = { profile: 'profile', chat: 'chat', game: 'game' } as const;
const MAX_MESSAGES = 60;

export interface Saved {
  profile: Profile;
  messages: ChatMessage[];
  game: ChessSnapshot | null;
  /** True when this player has been here before — what "Continue" needs to know. */
  returning: boolean;
}

export async function load(umicat: ThreeUmicat): Promise<Saved> {
  const [profile, messages, game] = await Promise.all([
    umicat.saves.get<Profile>(KEY.profile),
    umicat.saves.get<ChatMessage[]>(KEY.chat),
    umicat.saves.get<ChessSnapshot>(KEY.game),
  ]);
  return {
    profile: { ...DEFAULT_PROFILE, ...(profile ?? {}) },
    messages: messages ?? [],
    game: game ?? null,
    returning: !!profile || !!game,
  };
}

/**
 * Writes, coalesced.
 *
 * Every move changes three things at once (board, chat, profile) and a save
 * per change would be three round-trips per move. Queue instead, and flush on
 * the way out — `visibilitychange` rather than `beforeunload`, because on iOS
 * a backgrounded tab may never see the second one.
 */
export class Autosave {
  private pending: Partial<Saved> = {};
  private timer: ReturnType<typeof setTimeout> | undefined;

  constructor(private umicat: ThreeUmicat) {
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') void this.flush();
    });
  }

  queue(patch: Partial<Saved>): void {
    Object.assign(this.pending, patch);
    clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.flush(), 800);
  }

  async flush(): Promise<void> {
    clearTimeout(this.timer);
    const patch = this.pending;
    this.pending = {};
    const writes: Array<Promise<unknown>> = [];
    if (patch.profile) writes.push(this.umicat.saves.set(KEY.profile, patch.profile));
    if (patch.messages) writes.push(this.umicat.saves.set(KEY.chat, patch.messages.slice(-MAX_MESSAGES)));
    if (patch.game !== undefined) {
      writes.push(patch.game
        ? this.umicat.saves.set(KEY.game, patch.game)
        // An ended game is deleted rather than stored as null, so "is there
        // something to continue?" stays a question about existence.
        : this.umicat.saves.delete(KEY.game));
    }
    await Promise.all(writes).catch((err) => console.warn('[chess] save failed', err));
  }
}
