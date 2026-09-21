// Getting four people (or one and three bots) to the same board.
//
// Four ways in, because they answer four different situations: making a room
// for people you are already talking to, joining one when somebody has read
// you a code, looking through what is open, and "just put me somewhere".
//
// Everything here is careful about one thing the 2D game learned the hard
// way: **`room.state` is not there when `joinOrCreate` resolves.** The state
// arrives as its own message a few milliseconds later, so nothing reads
// `state.players` synchronously after a join — the first render is driven by
// the first `onStateChange`, which is also what makes a late joiner and a
// mid-lobby update the same code path.
import type { ThreeUmicat } from '@umicat/three-sdk';
import type { RoomListEntry, UmicatRoom } from '@umicat/platform-sdk';
import { Screen, button, h1, p, row, stack, status } from './screen';
import { t, colourName } from '../i18n';
import { Table, KEY, roomCode } from '../net/table';
import { BlokusGame, PLAYERS } from '../blokus/game';
import { COLOURS } from '../blokus/pieces';

/** What the lobby ends with. `solo` is the honest answer when there is no
 *  multiplayer to be had — better than a spinner that never resolves. */
export type LobbyResult =
  | { kind: 'table'; table: Table }
  | { kind: 'solo' }
  | { kind: 'back' };

type Done = (r: LobbyResult) => void;

const hex = (c: number): string => `#${c.toString(16).padStart(6, '0')}`;

/** Every session in the room, in join order — which is also seat order. */
function seatedPlayers(room: UmicatRoom<unknown>): Array<{ sid: string; name: string }> {
  const players = (room.state as {
    players?: { forEach?: (fn: (p: { displayName?: string }, sid: string) => void) => void };
  })?.players;
  const out: Array<{ sid: string; name: string }> = [];
  players?.forEach?.((p, sid) => { out.push({ sid, name: p.displayName || 'Player' }); });
  return out;
}

export function onlineLobby(screen: Screen, umicat: ThreeUmicat): Promise<LobbyResult> {
  return new Promise<LobbyResult>((done) => { menu(screen, umicat, done); });
}

// ── the four doors ─────────────────────────────────────────────────────────

function menu(screen: Screen, umicat: ThreeUmicat, done: Done): void {
  const line = status();
  const choices = stack(
    button(t('lobby.create'), () => void createRoom(screen, umicat, done), 'primary'),
    button(t('lobby.join'), () => codeEntry(screen, umicat, done)),
    button(t('lobby.browse'), () => browse(screen, umicat, done)),
    button(t('lobby.quick'), () => void quickMatch(screen, umicat, done)),
  );

  // No realtime endpoint, or nobody signed in: say so once, here, rather than
  // letting each of the four buttons fail on its own with its own message.
  const blocked = !umicat.rooms.available || !umicat.isAuthenticated;
  if (blocked) {
    line.textContent = t('lobby.signedOut');
    [...choices.children].forEach((b) => { (b as HTMLButtonElement).disabled = true; });
  }

  screen.wide(false);
  screen.show(
    h1(t('lobby.heading')),
    choices,
    row(
      button(t('lobby.back'), () => done({ kind: 'back' })),
      ...(blocked ? [button(t('title.solo'), () => done({ kind: 'solo' }), 'primary')] : []),
    ),
    line,
  );
}

async function createRoom(screen: Screen, umicat: ThreeUmicat, done: Done): Promise<void> {
  const line = status();
  line.textContent = t('lobby.creating');
  screen.show(h1(t('lobby.heading')), line);
  const code = roomCode();
  try {
    const room = await umicat.rooms.create('lobby', {
      roomCode: code,
      maxClients: PLAYERS,
      displayName: umicat.user?.name ?? 'Player',
      metadata: { hostName: umicat.user?.name ?? 'Player' },
    });
    waitingRoom(screen, umicat, room, code, done);
  } catch (err) {
    fail(screen, umicat, done, err, t('lobby.failedCreate'));
  }
}

function codeEntry(screen: Screen, umicat: ThreeUmicat, done: Done): void {
  const input = document.createElement('input');
  input.maxLength = 8;
  input.autocomplete = 'off';
  input.setAttribute('autocapitalize', 'characters');
  input.setAttribute('autocorrect', 'off');
  input.placeholder = t('lobby.enterCode');
  const line = status();

  const go = async (): Promise<void> => {
    const code = input.value.trim().toUpperCase();
    if (!code) return;
    line.textContent = t('lobby.joining');
    line.classList.remove('bad');
    try {
      // `join`, not `joinOrCreate`: a mistyped code must say "no such room"
      // rather than quietly opening an empty one and leaving somebody sitting
      // in it wondering where their friends are.
      const room = await umicat.rooms.join('lobby', {
        roomCode: code,
        displayName: umicat.user?.name ?? 'Player',
      });
      waitingRoom(screen, umicat, room, code, done);
    } catch {
      line.textContent = t('lobby.failedJoin');
      line.classList.add('bad');
    }
  };

  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') void go(); });

  screen.wide(false);
  screen.show(
    h1(t('lobby.join')),
    input,
    p(t('lobby.codeHint')),
    row(
      button(t('lobby.back'), () => menu(screen, umicat, done)),
      button(t('lobby.joinRoom'), () => void go(), 'primary'),
    ),
    line,
  );
  input.focus();
}

/**
 * The open rooms, polled.
 *
 * Rebuilt rows rather than a rebuilt card: the list refreshes every three
 * seconds and a card that rebuilds its buttons underneath a finger is a card
 * that occasionally joins the wrong room.
 */
function browse(screen: Screen, umicat: ThreeUmicat, done: Done): void {
  const list = document.createElement('div');
  list.className = 'list';
  const line = status();
  line.textContent = t('lobby.loadingRooms');

  let stopped = false;
  const stop = (): void => { stopped = true; clearInterval(timer); };

  const refresh = async (): Promise<void> => {
    let rooms: RoomListEntry[];
    try {
      rooms = await umicat.rooms.list();
    } catch {
      if (!stopped) { line.textContent = t('lobby.roomsFailed'); line.classList.add('bad'); }
      return;
    }
    if (stopped) return;
    line.classList.remove('bad');
    const open = rooms.filter((r) => r.clients < r.maxClients);
    line.textContent = open.length ? '' : t('lobby.noRooms');
    list.replaceChildren(...open.slice(0, 6).map((entry) => {
      const el = document.createElement('div');
      el.className = 'room';
      const code = document.createElement('span');
      code.className = 'rcode';
      code.textContent = entry.roomCode || t('lobby.quickPublic');
      const host = document.createElement('span');
      host.className = 'host';
      host.textContent = (entry.metadata as { hostName?: string } | undefined)?.hostName ?? '—';
      const seats = document.createElement('span');
      seats.className = 'seats';
      for (let i = 0; i < entry.maxClients; i++) {
        const dot = document.createElement('i');
        if (i < entry.clients) dot.style.background = hex(COLOURS[i % PLAYERS]);
        seats.appendChild(dot);
      }
      const join = button(t('lobby.joinRoom'), () => {
        stop();
        void joinById(screen, umicat, entry.roomId, entry.roomCode, done);
      }, 'primary');
      el.append(code, host, seats, join);
      return el;
    }));
  };

  const timer = setInterval(() => void refresh(), 3000);
  void refresh();

  screen.wide(true);
  screen.show(
    h1(t('lobby.rooms')),
    list,
    row(button(t('lobby.back'), () => { stop(); menu(screen, umicat, done); })),
    line,
  );
}

async function joinById(
  screen: Screen, umicat: ThreeUmicat, roomId: string, code: string, done: Done,
): Promise<void> {
  const line = status();
  line.textContent = t('lobby.joining');
  screen.wide(false);
  screen.show(h1(t('lobby.heading')), line);
  try {
    const room = await umicat.rooms.joinById(roomId, {
      displayName: umicat.user?.name ?? 'Player',
    });
    waitingRoom(screen, umicat, room, code, done);
  } catch (err) {
    fail(screen, umicat, done, err, t('lobby.failedJoin'));
  }
}

async function quickMatch(screen: Screen, umicat: ThreeUmicat, done: Done): Promise<void> {
  const line = status();
  line.textContent = t('lobby.finding');
  screen.wide(false);
  screen.show(h1(t('lobby.quick')), line);
  try {
    // No code: everybody looking for a quick game lands in the one public
    // room for this game, and whoever got there first is the host.
    const room = await umicat.rooms.joinOrCreate('lobby', {
      maxClients: PLAYERS,
      displayName: umicat.user?.name ?? 'Player',
      metadata: { hostName: umicat.user?.name ?? 'Player' },
    });
    waitingRoom(screen, umicat, room, '', done);
  } catch (err) {
    fail(screen, umicat, done, err, t('lobby.offlineFallback'));
  }
}

function fail(
  screen: Screen, umicat: ThreeUmicat, done: Done, err: unknown, message: string,
): void {
  // The one error worth translating into a different OUTCOME rather than a
  // different sentence: with no realtime at all, "try again" is advice that
  // cannot work, and the bots are right there.
  if ((err as { code?: string } | null)?.code === 'REALTIME_UNAVAILABLE') {
    done({ kind: 'solo' });
    return;
  }
  const line = status();
  line.textContent = message;
  line.classList.add('bad');
  screen.wide(false);
  screen.show(
    h1(t('lobby.heading')),
    row(button(t('lobby.back'), () => menu(screen, umicat, done), 'primary')),
    line,
  );
}

// ── the room, before the game ──────────────────────────────────────────────

/**
 * Who is at the table, and the one button that starts it.
 *
 * The host is whoever is in the first seat — join order, which is the order
 * `room.state.players` keeps. It is not a role anybody chooses: somebody has
 * to write the opening board and run the bots, and "the first person here" is
 * the only rule that every client works out the same way without asking.
 */
function waitingRoom(
  screen: Screen, umicat: ThreeUmicat, room: UmicatRoom<unknown>, code: string, done: Done,
): void {
  const list = document.createElement('div');
  list.className = 'list';
  const line = status();
  let launched = false;

  const start = document.createElement('button');
  start.className = 'lift';
  start.textContent = t('lobby.start');
  start.hidden = true;
  start.onclick = () => {
    const seats = seatedPlayers(room).slice(0, PLAYERS).map((s) => s.sid);
    const game = new BlokusGame();
    // Seats and the opening board FIRST, phase last: a client that saw
    // `playing` before it had either would launch into an empty game. The
    // guard on the other side checks all three anyway — belt and braces,
    // because this is the one message that cannot be retried.
    room.data.set(KEY.seats, seats);
    room.data.set(KEY.state, game.snapshot());
    room.data.set(KEY.phase, 'playing');
  };

  const leave = button(t('lobby.leave'), () => {
    void room.leave();
    menu(screen, umicat, done);
  });

  const draw = (): void => {
    const players = seatedPlayers(room);
    const mine = room.sessionId;
    const isHost = players[0]?.sid === mine;

    list.replaceChildren(...Array.from({ length: PLAYERS }, (_, seat) => {
      const el = document.createElement('div');
      el.className = 'seat' + (players[seat] ? '' : ' empty');
      const dot = document.createElement('span');
      dot.className = 'dot';
      dot.style.background = hex(COLOURS[seat]);
      const who = document.createElement('span');
      who.className = 'who';
      who.textContent = players[seat]?.name ?? `${colourName(seat)} · ${t('lobby.bot')}`;
      const tag = document.createElement('span');
      tag.className = 'tag';
      tag.textContent = players[seat]
        ? (players[seat].sid === mine ? t('lobby.you') : '')
        : t('lobby.bot');
      el.append(dot, who, tag);
      return el;
    }));

    start.hidden = !isHost;
    line.textContent = isHost ? t('lobby.botFill') : t('lobby.waitHost');
  };

  const launch = (): void => {
    if (launched) return;
    const phase = room.data.get<string>(KEY.phase);
    const seats = room.data.get<string[]>(KEY.seats);
    if (phase !== 'playing' || !Array.isArray(seats) || seats.length === 0) return;
    launched = true;
    offState();
    offError();
    const padded: Array<string | null> = Array.from(
      { length: PLAYERS },
      (_, i) => seats[i] ?? null,
    );
    done({ kind: 'table', table: Table.online(room, padded) });
  };

  const offState = room.onStateChange(() => { draw(); launch(); });
  const offError = room.onError(() => {
    line.textContent = t('lobby.lost');
    line.classList.add('bad');
  });

  screen.wide(false);
  const nodes: Node[] = [h1(t('lobby.players'))];
  if (code) {
    const codeEl = document.createElement('div');
    codeEl.className = 'code';
    codeEl.textContent = code;
    nodes.push(codeEl, p(t('lobby.codeShare')));
  }
  nodes.push(list, row(leave, start), line);
  screen.show(...nodes);
  draw();
  // A room that was already playing when we arrived — or a state message that
  // beat this function to it — still has to be honoured.
  launch();
}
