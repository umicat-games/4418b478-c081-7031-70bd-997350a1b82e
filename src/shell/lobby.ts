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
import { KEY, Table, roomCode } from './net/table';
import type { Preset, TimeControl } from './net/clock';

/**
 * How the lobby ends.
 *
 * `tc` is the clock the table-MAKER chose; a player joining somebody else's
 * table gets theirs from the first snapshot instead, because the table-maker
 * is the one who decides and two defaults would be two different games.
 */
export type LobbyResult =
  | { kind: 'table'; table: Table; tc: TimeControl }
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
    const room = await umicat.rooms.create<unknown>(ROOM_TYPE, {
      roomCode: code,
      maxClients: 2,
      displayName: umicat.user?.name || t('plate.you'),
    });
    await waitingRoom(umicat, room, code, true, tc, presets, done);
  } catch (err) {
    fail(s, umicat, presets, done, err);
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
      await waitingRoom(umicat, room, code, false, undefined, presets, done);
    } catch {
      go.disabled = false;
      s.say(t('lobby.noSuchRoom'), true);
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
    const room = await umicat.rooms.joinById<unknown>(entry.roomId, {
      displayName: umicat.user?.name || t('plate.you'),
    });
    await waitingRoom(umicat, room, entry.roomCode, false, undefined, presets, done);
  } catch (err) {
    fail(s, umicat, presets, done, err);
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
    const room = await umicat.rooms.joinOrCreate<unknown>(ROOM_TYPE, {
      maxClients: 2,
      displayName: umicat.user?.name || t('plate.you'),
    });
    await waitingRoom(umicat, room, '', false, presets[Math.floor(presets.length / 2)]?.tc, presets, done);
  } catch (err) {
    fail(s, umicat, presets, done, err);
  }
}

function fail(s: Screen, umicat: ThreeUmicat, presets: Preset[], done: Done, err: unknown): void {
  console.warn('[lobby]', err);
  s.say(t('lobby.failed'), true);
  const back = button(t('lobby.back'), true);
  s.body.replaceChildren(stack(back));
  back.onclick = () => menu(umicat, presets, done);
}

// ── the waiting room ───────────────────────────────────────────────────────

/**
 * Both of us are here; one of us says so.
 *
 * Seats are decided ONCE, by the player who made the table, and written into
 * the room's shared map. Two clients each deciding for themselves would each
 * decide they were first — join order is not the same thing as agreement.
 */
async function waitingRoom(
  umicat: ThreeUmicat,
  room: UmicatRoom<unknown>,
  code: string,
  hosting: boolean,
  tc: TimeControl | undefined,
  presets: Preset[],
  done: Done,
): Promise<void> {
  const s = screen();
  s.title.textContent = t('lobby.waiting');
  const wrap = document.createElement('div');
  wrap.className = 'waiting';
  if (code) {
    const c = document.createElement('div');
    c.className = 'code';
    c.textContent = code;
    wrap.appendChild(c);
  }
  const dots = document.createElement('div');
  dots.className = 'dots';
  dots.innerHTML = '<i></i><i></i><i></i>';
  wrap.appendChild(dots);
  const leave = button(t('lobby.leave'));
  leave.className = 'quiet-link';
  wrap.appendChild(leave);
  s.body.replaceChildren(wrap);
  s.say(code ? t('lobby.readItOut') : t('lobby.waitingQuick'));

  // The avatar goes in my own player map, where the other side can read it —
  // the room's Player schema carries a display name and nothing else.
  if (umicat.user?.avatar) room.player.set('avatar', umicat.user.avatar);

  let settled = false;
  const finish = (table: Table): void => {
    if (settled) return;
    settled = true;
    off();
    s.close();
    done({ kind: 'table', table, tc: tc ?? presets[Math.floor(presets.length / 2)]?.tc ?? { mainMs: 600_000, incrementMs: 5_000 } });
  };

  const look = (): void => {
    if (settled) return;
    const seated = room.data.get<string[]>(KEY.seats);
    if (seated && seated.length === 2) { finish(Table.online(room, seated)); return; }
    const here = playersOf(room);
    // Only the table's maker writes the seats — and only when there are two
    // people to seat.
    if (hosting && here.length >= 2) room.data.set(KEY.seats, here.slice(0, 2));
  };

  const offChange = room.onStateChange(() => look());
  const offGone = room.onLeave(() => {
    if (settled) return;
    s.say(t('lobby.lost'), true);
  });
  const off = (): void => { offChange(); offGone(); };

  leave.onclick = () => {
    if (settled) return;
    settled = true;
    off();
    void room.leave();
    menu(umicat, presets, done);
  };

  // And once now, in case the state arrived before the handler did.
  look();
}
