// Getting two people to the same board.
//
// Four ways in, because they answer four different situations: making a table
// for somebody you are already talking to, joining one when they have read you
// a code, looking through what is open, and "just put me somewhere".
//
// The one thing everything here is careful about — learned the hard way in the
// Blokus game — is that **`room.state` is not there when the join resolves**.
// It arrives as its own message a few milliseconds later, so nothing reads
// `state.players` synchronously after joining; the first render is driven by
// the first `onStateChange`, which is also what makes a late joiner and a
// mid-lobby update the same code path.
import './buttons.css';
import './lobby.css';
import type { UmicatRoom, RoomListEntry } from '@umicat/platform-sdk';
import type { ThreeUmicat } from '@umicat/three-sdk';
import { t } from '../i18n';
import { roomCode } from './net/table';
import type { Preset, TimeControl } from './net/clock';

/**
 * How the lobby ends.
 *
 * A ROOM, not a table: sitting down, waiting for somebody, starting a game
 * and getting up again all belong to the table's own lifetime, and the lobby
 * is only the door. It used to hold on until two people were seated, which is
 * why the room had two different ideas of who was in it.
 *
 * `tc` is the clock the table-MAKER chose; somebody joining an existing table
 * gets theirs from the first snapshot instead, because the maker decides and
 * two defaults would be two different games.
 */
export type LobbyResult =
  | { kind: 'room'; room: UmicatRoom<unknown>; code: string; tc: TimeControl }
  | { kind: 'back' };

type Done = (r: LobbyResult) => void;

const ROOM_TYPE = 'lobby';

/** Everyone in the room, in join order — which is also seat order. */
function playersOf(room: UmicatRoom<unknown>): string[] {
  const players = (room.state as {
    players?: { forEach?: (fn: (p: unknown, sid: string) => void) => void };
  })?.players;
  const out: string[] = [];
  players?.forEach?.((_p, sid) => { out.push(sid); });
  return out;
}

/** `presets` are the game's own clocks, in the order they are offered; the
 *  middle one is the default. Go wants byo-yomi, a five-in-a-row game wants an
 *  increment, and neither of those is the shell's business to know. */
export function showLobby(umicat: ThreeUmicat, presets: Preset[] = []): Promise<LobbyResult> {
  // Defaulted rather than required, because the one place this is called from
  // is a click handler — and a click handler that throws does so silently,
  // leaving a button that simply does nothing. That cost a debugging round.
  return new Promise<LobbyResult>((done) => { menu(umicat, presets ?? [], done); });
}

// ── the screen ─────────────────────────────────────────────────────────────

interface Screen {
  el: HTMLDivElement;
  title: HTMLHeadingElement;
  body: HTMLDivElement;
  status: HTMLParagraphElement;
  say(text: string, bad?: boolean): void;
  close(): void;
}

function screen(): Screen {
  const old = document.getElementById('lobby');
  if (old) old.remove();
  const el = document.createElement('div');
  el.id = 'lobby';
  el.innerHTML = '<h2></h2><div class="body"></div><p class="status"></p>';
  document.body.appendChild(el);
  const status = el.querySelector('.status') as HTMLParagraphElement;
  return {
    el,
    title: el.querySelector('h2') as HTMLHeadingElement,
    body: el.querySelector('.body') as HTMLDivElement,
    status,
    say(text, bad = false) {
      status.textContent = text;
      status.classList.toggle('bad', bad);
    },
    close() {
      el.classList.add('leaving');
      setTimeout(() => el.remove(), 380);
    },
  };
}

function button(label: string, primary = false): HTMLButtonElement {
  const b = document.createElement('button');
  b.textContent = label;
  b.className = primary ? 'lift' : 'lift quiet';
  return b;
}

function stack(...kids: HTMLElement[]): HTMLDivElement {
  const d = document.createElement('div');
  d.className = 'stack';
  d.append(...kids);
  return d;
}

// ── the four doors ─────────────────────────────────────────────────────────

function menu(umicat: ThreeUmicat, presets: Preset[], done: Done): void {
  const s = screen();
  s.title.textContent = t('lobby.title');

  // Said once, plainly, rather than by four buttons failing one at a time.
  if (!umicat.rooms.available) {
    s.body.append(stack(button(t('lobby.back'), true)));
    (s.body.querySelector('button') as HTMLButtonElement).onclick = () => { s.close(); done({ kind: 'back' }); };
    s.say(t('lobby.unavailable'), true);
    return;
  }

  const create = button(t('lobby.create'), true);
  const join = button(t('lobby.join'));
  const browse = button(t('lobby.browse'));
  const quick = button(t('lobby.quick'));
  const back = button(t('lobby.back'));
  back.className = 'quiet-link';
  s.body.append(stack(create, join, browse, quick, back));
  s.say(t('lobby.hint'));

  create.onclick = () => pickClock(umicat, presets, done);
  join.onclick = () => byCode(umicat, presets, done);
  browse.onclick = () => void openTables(umicat, presets, done);
  quick.onclick = () => void quickMatch(umicat, presets, done);
  back.onclick = () => { s.close(); done({ kind: 'back' }); };
}

/**
 * Which clock, before there is a table to put it on.
 *
 * Asked only of the person MAKING the table: whoever joins is joining a game
 * that already has a shape, and being asked to choose one they cannot choose
 * is worse than not being asked.
 */
function pickClock(umicat: ThreeUmicat, presets: Preset[], done: Done): void {
  if (!presets || presets.length <= 1) { void host(umicat, presets?.[0]?.tc, presets ?? [], done); return; }
  const s = screen();
  s.title.textContent = t('lobby.howLong');
  const buttons = presets.map((p, i) => {
    const b = button(p.label, i === Math.floor(presets.length / 2));
    b.onclick = () => void host(umicat, p.tc, presets, done);
    return b;
  });
  const back = button(t('lobby.back'));
  back.className = 'quiet-link';
  back.onclick = () => menu(umicat, presets, done);
  s.body.append(stack(...buttons, back));
  s.say(t('lobby.clockHint'));
}

/** Make a table and wait beside it, with the code on screen. */
async function host(umicat: ThreeUmicat, tc: TimeControl | undefined, presets: Preset[], done: Done): Promise<void> {
  const s = screen();
  s.title.textContent = t('lobby.creating');
  s.say(t('lobby.oneMoment'));
  const code = roomCode();
  try {
    const room = await twice(() => umicat.rooms.create<unknown>(ROOM_TYPE, {
      roomCode: code,
      maxClients: 2,
      displayName: umicat.user?.name || t('plate.you'),
    }));
    await handOver(umicat, room, code, tc, presets, done);
  } catch (err) {
    fail(s, umicat, presets, done, err, () => void host(umicat, tc, presets, done));
  }
}

/** Somebody read you a code. */
function byCode(umicat: ThreeUmicat, presets: Preset[], done: Done): void {
  const s = screen();
  s.title.textContent = t('lobby.enterCode');
  const input = document.createElement('input');
  input.type = 'text';
  input.maxLength = 6;
  input.autocapitalize = 'characters';
  input.spellcheck = false;
  const go = button(t('lobby.joinGo'), true);
  const back = button(t('lobby.back'));
  back.className = 'quiet-link';
  s.body.append(stack(input, go, back));
  input.focus();

  const attempt = async (): Promise<void> => {
    const code = input.value.trim().toUpperCase();
    if (code.length < 4) { s.say(t('lobby.codeShort'), true); return; }
    go.disabled = true;
    s.say(t('lobby.joining'));
    try {
      // `join`, not `joinOrCreate`: a mistyped code has to say "no such
      // table", not quietly open an empty one and leave them waiting in a
      // room nobody else will ever find.
      const room = await umicat.rooms.join<unknown>(ROOM_TYPE, {
        roomCode: code,
        displayName: umicat.user?.name || t('plate.you'),
      });
      await handOver(umicat, room, code, undefined, presets, done);
    } catch (err) {
      go.disabled = false;
      // A mistyped code and a broken platform are different problems, and
      // telling somebody to check their code when the backend is down sends
      // them looking in the wrong place.
      const e = err as { code?: unknown } | null;
      const missing = !e?.code || e.code === 'ROOM_NOT_FOUND' || /not found|no rooms/i.test(String((err as Error)?.message ?? ''));
      s.say(missing ? t('lobby.noSuchRoom') : `${t('lobby.failed')} ${reason(err)}`, true);
    }
  };
  go.onclick = () => void attempt();
  input.onkeydown = (e) => { if (e.key === 'Enter') void attempt(); };
  back.onclick = () => menu(umicat, presets, done);
}

/** What is open right now. */
async function openTables(umicat: ThreeUmicat, presets: Preset[], done: Done): Promise<void> {
  const s = screen();
  s.title.textContent = t('lobby.open');
  const list = document.createElement('div');
  list.className = 'rooms';
  const again = button(t('lobby.refresh'));
  const back = button(t('lobby.back'));
  back.className = 'quiet-link';
  s.body.append(stack(list, again, back));
  back.onclick = () => menu(umicat, presets, done);

  const load = async (): Promise<void> => {
    s.say(t('lobby.looking'));
    list.replaceChildren();
    let rooms: RoomListEntry[] = [];
    try {
      rooms = await umicat.rooms.list();
    } catch {
      s.say(t('lobby.listFailed'), true);
      return;
    }
    // A full table is not a table you can join, and showing it is offering
    // something that will fail.
    const open = rooms.filter((r) => r.clients > 0 && r.clients < Math.max(2, r.maxClients));
    s.say(open.length ? t('lobby.pick') : t('lobby.noneOpen'));
    for (const r of open) {
      const row = button('');
      row.classList.add('room');
      const who = document.createElement('span');
      who.className = 'who';
      who.textContent = r.roomCode || t('lobby.table');
      const seats = document.createElement('span');
      seats.className = 'seats';
      seats.textContent = `${r.clients}/${Math.max(2, r.maxClients)}`;
      row.append(who, seats);
      row.onclick = () => void enter(umicat, r, presets, done);
      list.appendChild(row);
    }
  };
  again.onclick = () => void load();
  await load();
}

async function enter(umicat: ThreeUmicat, entry: RoomListEntry, presets: Preset[], done: Done): Promise<void> {
  const s = screen();
  s.title.textContent = t('lobby.joining');
  try {
    const room = await twice(() => umicat.rooms.joinById<unknown>(entry.roomId, {
      displayName: umicat.user?.name || t('plate.you'),
    }));
    await handOver(umicat, room, entry.roomCode, undefined, presets, done);
  } catch (err) {
    fail(s, umicat, presets, done, err, () => void enter(umicat, entry, presets, done));
  }
}

/** Put me anywhere. Joins whatever public table has a seat, or opens one. */
async function quickMatch(umicat: ThreeUmicat, presets: Preset[], done: Done): Promise<void> {
  const s = screen();
  s.title.textContent = t('lobby.quick');
  s.say(t('lobby.looking'));
  try {
    // No roomCode: the default bucket is the public table, and joinOrCreate
    // is exactly "sit at one if there is one, otherwise start one".
    const room = await twice(() => umicat.rooms.joinOrCreate<unknown>(ROOM_TYPE, {
      maxClients: 2,
      displayName: umicat.user?.name || t('plate.you'),
    }));
    await handOver(umicat, room, '', presets[Math.floor(presets.length / 2)]?.tc, presets, done);
  } catch (err) {
    fail(s, umicat, presets, done, err, () => void quickMatch(umicat, presets, done));
  }
}

/**
 * What went wrong, in words the player can repeat to somebody.
 *
 * "That did not work, try again in a moment" is true and useless: it was on
 * screen for a real failure and there was no way — on a phone, with no
 * console — to tell a backend restart from a missing sign-in from a dead
 * network. Whatever the platform called it goes on screen, because the person
 * who can act on it is reading it.
 */
function reason(err: unknown): string {
  const e = err as { code?: unknown; message?: unknown } | null;
  const code = typeof e?.code === 'string' ? e.code : '';
  const known: Record<string, string> = {
    UNAUTHENTICATED: t('lobby.needSignIn'),
    SIGN_IN_REQUIRED: t('lobby.needSignIn'),
    REALTIME_UNAVAILABLE: t('lobby.unavailable'),
    RATE_LIMITED: t('lobby.tooFast'),
  };
  if (code && known[code]) return known[code];
  const said = typeof e?.message === 'string' ? e.message : String(err ?? '');
  // The code first — it is the part worth reading out — and then whatever the
  // platform said, trimmed to a line.
  return [code, said].filter(Boolean).join(' · ').slice(0, 160) || t('lobby.failed');
}

function fail(s: Screen, umicat: ThreeUmicat, presets: Preset[], done: Done, err: unknown, again?: () => void): void {
  console.warn('[lobby]', err);
  s.say(`${t('lobby.failed')} ${reason(err)}`, true);
  const retry = again ? button(t('lobby.tryAgain'), true) : null;
  const back = button(t('lobby.back'), !again);
  s.body.replaceChildren(stack(...(retry ? [retry] : []), back));
  if (retry && again) retry.onclick = () => again();
  back.onclick = () => menu(umicat, presets, done);
}

/**
 * Once more, a beat later, before giving up.
 *
 * The backend restarts (twice in an hour, the day this was written), and a
 * restart is a few seconds during which minting a token fails. One quiet
 * retry turns that into a pause instead of a dead end; two would just be
 * hiding something worse.
 */
async function twice<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (err) {
    console.warn('[lobby] first try failed, retrying', err);
    await new Promise((r) => setTimeout(r, 1200));
    return run();
  }
}

// ── handing over ───────────────────────────────────────────────────────────

/**
 * We have a room. That is the lobby's whole job.
 *
 * Note what is NOT done here: nobody is seated, no game is started and
 * nothing waits for a second person. A table looks after all of that for as
 * long as it exists, which is longer than one game and longer than one pair
 * of people.
 */
async function handOver(
  umicat: ThreeUmicat,
  room: UmicatRoom<unknown>,
  code: string,
  tc: TimeControl | undefined,
  presets: Preset[],
  done: Done,
): Promise<void> {
  // The avatar goes in my own player map, where the other side can read it —
  // the room's Player schema carries a display name and nothing else.
  if (umicat.user?.avatar) room.player.set('avatar', umicat.user.avatar);
  const chosen = tc ?? presets[Math.floor(presets.length / 2)]?.tc ?? { mainMs: 600_000, incrementMs: 5_000 };
  document.getElementById('lobby')?.classList.add('leaving');
  setTimeout(() => document.getElementById('lobby')?.remove(), 380);
  done({ kind: 'room', room, code, tc: chosen });
}

/**
 * Waiting for somebody, with the code on screen — shown by the GAME, over its
 * own board, for as long as a seat is empty.
 *
 * It lives here because it is the lobby's screen, and because the code has to
 * look the same when you are waiting for the first person as when you are
 * waiting for the next one.
 */
export function showWaiting(opts: { code: string; note: string; onLeave(): void }): void {
  const s = screen();
  s.title.textContent = t('lobby.waiting');
  const wrap = document.createElement('div');
  wrap.className = 'waiting';
  if (opts.code) {
    const c = document.createElement('div');
    c.className = 'code';
    c.textContent = opts.code;
    wrap.appendChild(c);
  }
  const dots = document.createElement('div');
  dots.className = 'dots';
  dots.innerHTML = '<i></i><i></i><i></i>';
  wrap.appendChild(dots);
  const leave = button(t('lobby.leave'));
  leave.className = 'quiet-link';
  leave.onclick = () => { hideWaiting(); opts.onLeave(); };
  wrap.appendChild(leave);
  s.body.replaceChildren(wrap);
  s.say(opts.note);
}

export function hideWaiting(): void {
  const el = document.getElementById('lobby');
  if (!el) return;
  el.classList.add('leaving');
  setTimeout(() => el.remove(), 380);
}
