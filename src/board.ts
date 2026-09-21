import type { ThreeUmicat } from '@umicat/three-sdk';

/** The platform handle. `ThreeUmicat` IS it — `gameData` and `user` hang
 *  straight off the object the game is handed at boot. */
type Umicat = ThreeUmicat;

/**
 * The score board — everyone's, not yours.
 *
 * `umicat.gameData` is a key-value store scoped to the GAME rather than to a
 * player: one value, visible to every player of it. Reads are public, so a
 * signed-out visitor sees the board; writes need an authenticated user, which
 * is the one asymmetry this file has to keep explaining to the player rather
 * than failing silently on.
 *
 * ## The backend does not police what is inside a value
 *
 * It stores opaque JSON. That means the read-modify-write loop is OURS, and
 * three things follow that are easy to get wrong:
 *
 *  - **Two runs ending together can lose one of them.** `set()` takes an
 *    `ifVersion` for exactly this — but `gameData.get()` in the SDK returns
 *    the VALUE and throws the version away, so there is no version to pass on
 *    the first write of a session. What is done instead is to write, read
 *    back, and retry if our own row is not there. That closes the window
 *    rather than preventing it, and it is worth knowing which of the two this
 *    is: a genuine fix wants `get` to surface the version, which is a change
 *    to the SDK and not to this game.
 *  - **Truncate.** The value has a 100KB ceiling, and a list that only grows
 *    reaches it and then every write fails — for everyone, permanently.
 *  - **Never trust a row.** Everything in the list was written by another
 *    player's client, including the NAME. It is rendered with `textContent`
 *    and nothing else, and it is clamped in length here as well.
 */

const KEY = 'scores';
/** How many are kept. The board shows ten; a few spare rows mean a player who
 *  just missed the cut is not re-ranked by the next write. */
const KEEP = 24;
const SHOWN = 10;
/** Names are drawn in a fixed-width row on a phone. Anything longer is not a
 *  name, it is someone trying to take up the whole board. */
const NAME_MAX = 18;

export interface Row {
  /** The player's id, so one player holds ONE row — their best, not one per
   *  run. A board that is nine entries by the same person is not a board. */
  uid: string;
  name: string;
  score: number;
  /** Seconds survived, shown beside the score. Two runs can score the same
   *  and they are not the same run. */
  secs: number;
}

/** Sort and trim. Exported because the submit path and the read path must
 *  agree on what "the board" means, and two copies of a comparator is two
 *  orderings eventually. */
export const rank = (rows: Row[]): Row[] =>
  [...rows].sort((a, b) => b.score - a.score).slice(0, KEEP);

/** Everything the board knows, best first. Public — a signed-out player sees
 *  the same list. Returns `[]` rather than throwing: a score board that takes
 *  the village down with it when the network is out is a bad trade. */
export async function readBoard(umicat: Umicat): Promise<Row[]> {
  try {
    const v = await umicat.gameData.get<{ rows?: Row[] }>(KEY);
    const rows: unknown[] = Array.isArray(v?.rows) ? v!.rows! : [];
    // Sanitised on the way IN, not at the point of render. Every consumer of
    // this list would otherwise have to remember to, and one that forgets is
    // an injection.
    return rank(rows.filter(isRow).map(clean));
  } catch {
    return [];
  }
}

function isRow(r: unknown): r is Row {
  const o = r as Row;
  return !!o && typeof o.uid === 'string' && typeof o.name === 'string'
    && Number.isFinite(o.score) && Number.isFinite(o.secs);
}

/** Sanitise one row. Exported so a probe can drive the SAME path the live
 *  board uses — a check that renders rows by some other route is a check of
 *  some other code. */
export function clean(r: Row): Row {
  return {
    uid: String(r.uid).slice(0, 64),
    // Control characters stripped: a name with a newline in it breaks the row
    // it is drawn in, whatever the element does about markup.
    // Control characters out. A name with a newline in it breaks the row it
    // is drawn in, whatever the element does about markup — and `textContent`
    // does nothing about a newline, because a newline is not markup.
    //
    // Written as `\uXXXX` escapes rather than the literal range: the class is
    // invisible either way in a source file, and reading it back in a diff or
    // a terminal shows blanks, which is indistinguishable from a class that
    // says "space to hyphen". Escapes can be read.
    name: String(r.name).replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ').trim().slice(0, NAME_MAX) || 'Someone',
    score: Math.max(0, Math.floor(r.score)),
    secs: Math.max(0, Math.floor(r.secs)),
  };
}

export type SubmitResult =
  | { ok: true; rank: number; best: boolean }
  | { ok: false; why: 'anonymous' | 'failed' };

/**
 * Put a run on the board, if it beats what that player already had.
 *
 * Read, modify, write, and retry on conflict — the loop the backend explicitly
 * leaves to the client. Four attempts: the window for a collision is the
 * moment two runs end together, which is short, and a player watching a
 * summary panel should not wait on a long retry chain.
 */
export async function submit(
  umicat: Umicat,
  score: number,
  secs: number,
): Promise<SubmitResult> {
  const user = umicat.user;
  // Not an error, and worth being precise about: a signed-out player can READ
  // the board and cannot write to it. Saying "failed" here would send them
  // looking for a problem that is a rule.
  if (!user) return { ok: false, why: 'anonymous' };

  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const raw = await umicat.gameData.get<{ rows?: Row[] }>(KEY);
      const rows: Row[] = (Array.isArray(raw?.rows) ? raw!.rows! : [])
        .filter(isRow).map(clean);

      const mine = rows.find((r) => r.uid === user.id);
      // One row per player, and only their best. Anything else and a person
      // who plays all evening owns the board by volume rather than by score.
      if (mine && mine.score >= score) {
        return { ok: true, rank: rank(rows).findIndex((r) => r.uid === user.id) + 1, best: false };
      }
      const next = rank([
        ...rows.filter((r) => r.uid !== user.id),
        clean({ uid: user.id, name: user.name, score, secs }),
      ]);

      await umicat.gameData.set(KEY, { rows: next });
      // Read back, because the write could have raced another player's. If our
      // row survived, the board has it; if it did not, go round again with
      // whatever is there now rather than reporting a success nobody can see.
      const after = await readBoard(umicat);
      const seat = after.findIndex((r) => r.uid === user.id && r.score >= score);
      if (seat >= 0) return { ok: true, rank: seat + 1, best: true };
      continue;
    } catch {
      // A conflict means somebody else wrote between the read and the write,
      // so the right move is to read again rather than to force.
      if (attempt === 3) return { ok: false, why: 'failed' };
    }
  }
  return { ok: false, why: 'failed' };
}

/**
 * The board as an element.
 *
 * **Names go in with `textContent`.** They were typed by other people. The
 * hub's own card renderer takes HTML — it has to, because prices carry icons —
 * and its comment says in as many words that this is safe only because nothing
 * there shows player text. A score board is exactly the thing that breaks that
 * assumption, so it never goes through that path.
 */
export function boardElement(rows: Row[], meId: string | null): HTMLElement {
  const wrap = document.createElement('div');
  wrap.dataset.scoreboard = '';
  wrap.style.cssText = 'font: 500 14px/1.6 system-ui, sans-serif; min-width: min(360px, 82vw);';

  if (!rows.length) {
    const empty = document.createElement('div');
    empty.style.cssText = 'opacity:.7; text-align:center; padding:10px 0;';
    empty.textContent = 'No scores yet. Be the first.';
    wrap.append(empty);
    return wrap;
  }

  rows.slice(0, SHOWN).forEach((r, i) => {
    const row = document.createElement('div');
    const me = meId !== null && r.uid === meId;
    row.style.cssText = `display:flex; gap:10px; align-items:baseline; padding:3px 6px;
      border-radius:8px; ${me ? 'background:rgba(255,215,106,.16);' : ''}`;
    const n = document.createElement('span');
    n.style.cssText = 'width:1.6em; opacity:.6; font-variant-numeric: tabular-nums;';
    n.textContent = `${i + 1}`;
    const who = document.createElement('span');
    who.style.cssText = 'flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;'
      + (me ? ' font-weight:800;' : '');
    // textContent. This is the line that matters in this whole file.
    who.textContent = r.name;
    const sc = document.createElement('span');
    sc.style.cssText = 'font-weight:800; font-variant-numeric: tabular-nums;';
    sc.textContent = `${r.score}`;
    const t = document.createElement('span');
    t.style.cssText = 'opacity:.55; width:3.4em; text-align:right; font-variant-numeric: tabular-nums;';
    t.textContent = `${Math.floor(r.secs / 60)}:${String(r.secs % 60).padStart(2, '0')}`;
    row.append(n, who, sc, t);
    wrap.append(row);
  });
  return wrap;
}
