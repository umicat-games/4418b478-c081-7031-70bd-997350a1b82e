import { umicatReady } from './main';

export interface LeaderboardEntry {
  name: string;
  score: number;
  at: number;
}

const KEY = 'leaderboard';
const MAX_ENTRIES = 100;

/** Fetch top N entries — works for anonymous players. */
export async function fetchLeaderboard(limit = 10): Promise<LeaderboardEntry[]> {
  try {
    const umicat = await umicatReady;
    if (!umicat) return [];
    const raw = await umicat.gameData.get<LeaderboardEntry[]>(KEY);
    const list = Array.isArray(raw) ? raw : [];
    return list.slice(0, limit);
  } catch (e) {
    console.warn('[star-siege] fetch leaderboard failed:', e);
    return [];
  }
}

/** Submit a score — silently skips if player is not authenticated. */
export async function submitScore(score: number): Promise<void> {
  if (score <= 0) return;
  try {
    const umicat = await umicatReady;
    if (!umicat?.isAuthenticated) return;
    const name = umicat.user?.name ?? 'Player';
    for (let attempt = 0; attempt < 3; attempt++) {
      const raw = await umicat.gameData.get<LeaderboardEntry[]>(KEY);
      const list = Array.isArray(raw) ? raw : [];
      const next = [...list, { name, score, at: Date.now() }]
        .sort((a, b) => b.score - a.score)
        .slice(0, MAX_ENTRIES);
      try {
        await umicat.gameData.set(KEY, next);
        return;
      } catch (err: unknown) {
        const e = err as { code?: string };
        if (e?.code !== 'VERSION_MISMATCH') throw err;
        // concurrent write — re-read and retry
      }
    }
  } catch (e) {
    console.warn('[star-siege] submit score failed:', e);
  }
}
