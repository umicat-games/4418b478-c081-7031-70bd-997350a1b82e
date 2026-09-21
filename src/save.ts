// What survives leaving.
//
// Three keys, with three different lifetimes:
//
//   settings  sound, helpers, how hard the bots play. Forever.
//   best      the most squares this player has ever placed. Forever.
//   game      an unfinished game against the bots. Deleted when it ends.
//
// Only SOLO games are saved. An online game belongs to the room and to the
// other people in it: restoring one from this side would put a board on screen
// that nobody else is sitting at.
//
// The platform gives a game 100KB per value and 1MB per player. A snapshot is
// four hundred small numbers and four hands of names — a couple of kilobytes —
// so nothing here needs trimming, which is the only reason it is stored whole.
import type { ThreeUmicat } from '@umicat/three-sdk';
import type { Snapshot } from './blokus/game';
import type { Difficulty } from './blokus/bot';

const KEY = { settings: 'settings', best: 'best', game: 'game' } as const;

export interface Settings {
  music: boolean;
  sound: boolean;
  /** Mark the corners this player could still build from. */
  anchors: boolean;
  difficulty: Difficulty;
}

export const DEFAULT_SETTINGS: Settings = {
  music: true,
  sound: true,
  anchors: true,
  difficulty: 'medium',
};

export interface SavedGame extends Snapshot {
  difficulty: Difficulty;
}

export interface Saved {
  settings: Settings;
  best: number;
  game: SavedGame | null;
}

export async function load(umicat: ThreeUmicat): Promise<Saved> {
  const [settings, best, game] = await Promise.all([
    umicat.saves.get<Partial<Settings>>(KEY.settings),
    umicat.saves.get<number>(KEY.best),
    umicat.saves.get<SavedGame>(KEY.game),
  ]);
  return {
    settings: { ...DEFAULT_SETTINGS, ...(settings ?? {}) },
    best: best ?? 0,
    game: game ?? null,
  };
}

/**
 * Writes, coalesced.
 *
 * A move changes the board, the hands and the scores at once, and a write per
 * change would be three round-trips a turn. Queue instead and flush on the way
 * out — `visibilitychange` rather than `beforeunload`, because on iOS a
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
    this.timer = setTimeout(() => void this.flush(), 700);
  }

  async flush(): Promise<void> {
    clearTimeout(this.timer);
    const patch = this.pending;
    this.pending = {};
    const writes: Array<Promise<unknown>> = [];
    if (patch.settings) writes.push(this.umicat.saves.set(KEY.settings, patch.settings));
    if (patch.best !== undefined) writes.push(this.umicat.saves.set(KEY.best, patch.best));
    if (patch.game !== undefined) {
      writes.push(patch.game
        // A finished game is deleted rather than stored as null, so "is there
        // something to continue?" stays a question about existence.
        ? this.umicat.saves.set(KEY.game, patch.game)
        : this.umicat.saves.delete(KEY.game));
    }
    await Promise.all(writes).catch((err) => console.warn('[blokus] save failed', err));
  }
}

/** The unfinished solo game on its own, for the title screen's Continue —
 *  which is asked once, before there is any reason to read the rest. */
export async function loadGame(umicat: ThreeUmicat): Promise<SavedGame | null> {
  return (await umicat.saves.get<SavedGame>(KEY.game)) ?? null;
}
