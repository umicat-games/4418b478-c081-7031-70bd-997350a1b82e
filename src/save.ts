// What survives leaving.
//
// Four keys, because they have four different lifetimes and one of them is the
// expensive one:
//
//   profile  who this player is and what the coach has learned. Forever.
//   chat     the conversation. Trimmed — the tail is verbatim, the rest lives
//            on inside `profile.summary`, which is why summarising matters.
//   game     the FREE game, if one is unfinished. Cleared when it ends.
//   lesson   the board inside an exercise, mid-flight.
//
// The last two are separate slots and that is not tidiness. They were one, so
// an exercise board was offered on the title screen as "continue your game",
// and the last lesson — which is a whole game of Go, not a one-move problem —
// was rebuilt from its (empty) starting position when the player came back,
// losing every move they had played.
//
// The platform gives a game 100KB per value and 1MB in total per player, which
// a chat log will reach eventually if nothing trims it. So `MAX_MESSAGES` is
// not a nicety: without it the save silently starts failing months in, which is
// the worst possible time to find out.
import type { ChatMessage, Profile } from './coach/coach';
import { DEFAULT_PROFILE } from './coach/coach';
import type { GoSnapshot } from './go/rules';
import type { ThreeUmicat } from '@umicat/three-sdk';

const KEY = { profile: 'profile', chat: 'chat', game: 'game', lesson: 'lesson' } as const;
const MAX_MESSAGES = 60;

/** An exercise the player walked out of. Bound to the lesson AND the phase it
 *  belongs to: restoring a practice board into a test would be worse than
 *  losing it. */
export interface LessonBoard {
  lesson: string;
  phase: string;
  board: GoSnapshot;
  capturesAtStart: number;
}

export interface Saved {
  profile: Profile;
  messages: ChatMessage[];
  game: GoSnapshot | null;
  lessonBoard: LessonBoard | null;
  /** True when this player has been here before — what "Continue" needs to know. */
  returning: boolean;
}

export async function load(umicat: ThreeUmicat): Promise<Saved> {
  const [profile, messages, game, lessonBoard] = await Promise.all([
    umicat.saves.get<Profile>(KEY.profile),
    umicat.saves.get<ChatMessage[]>(KEY.chat),
    umicat.saves.get<GoSnapshot>(KEY.game),
    umicat.saves.get<LessonBoard>(KEY.lesson),
  ]);
  return {
    profile: { ...DEFAULT_PROFILE, ...(profile ?? {}) },
    messages: messages ?? [],
    game: game ?? null,
    lessonBoard: lessonBoard ?? null,
    returning: !!profile || !!game,
  };
}

/**
 * Writes, coalesced.
 *
 * Every stone moves three things at once (board, chat, profile) and a save per
 * change would be three round-trips per move. Queue instead, and flush on the
 * way out — `visibilitychange` rather than `beforeunload`, because on iOS a
 * backgrounded tab may never see the second one.
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
    if (patch.lessonBoard !== undefined) {
      writes.push(patch.lessonBoard
        ? this.umicat.saves.set(KEY.lesson, patch.lessonBoard)
        : this.umicat.saves.delete(KEY.lesson));
    }
    await Promise.all(writes).catch((err) => console.warn('[go] save failed', err));
  }
}
