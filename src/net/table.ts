// The table: four seats, and where the board lives when more than one person
// is looking at it.
//
// A solo game and an online game are the same game — `Table` is what lets the
// rest of the code stop asking which one it is. Offline it is four seats with
// one person in the first; online it is the room, with bots in whatever seats
// nobody took.
//
// **The whole state travels as ONE value, under one key.** The 2D game sent
// the board, the turn, the scores and each hand as separate keys, and the
// separate keys is where its bugs lived: a client could read a board from
// after a move and a hand from before it and draw a piece that was both
// played and still in the tray. One key is one JSON string of about three
// kilobytes, which over a websocket is nothing, and it is never half-applied.
//
// **Only the player whose turn it is writes.** That is what makes a
// last-writer-wins map safe here: there is exactly one writer at any moment,
// and it is the one the rules say may move. For seats played by bots, that
// writer is the host.
import type { UmicatRoom, ChatMessage } from '@umicat/platform-sdk';
import type { Snapshot } from '../blokus/game';
import { PLAYERS } from '../blokus/game';

/** Keys in the room's shared map. */
export const KEY = { phase: 'phase', seats: 'seats', state: 'state' } as const;

export type Phase = 'lobby' | 'playing';

/** The name of the only seat in a solo game. It never crosses a wire. */
const SOLO = 'me';

type Unsub = () => void;

export class Table {
  /** `null` in seats nobody is sitting in — those are played by bots. */
  readonly seats: Array<string | null>;
  private offs: Unsub[] = [];

  private constructor(
    readonly room: UmicatRoom<unknown> | null,
    readonly seat: number,
    seats: Array<string | null>,
  ) {
    this.seats = [...seats];
    while (this.seats.length < PLAYERS) this.seats.push(null);
  }

  /** One person against three bots. No network at all — not a room with one
   *  player in it, which would cost a connection to do nothing with.
   *
   *  The first seat is named rather than left empty, because an empty seat is
   *  what `isBot` reads as a bot — and a solo game whose own seat was a bot
   *  played itself while the player watched. */
  static solo(): Table {
    return new Table(null, 0, [SOLO, null, null, null]);
  }

  static online(room: UmicatRoom<unknown>, seats: Array<string | null>): Table {
    const seat = Math.max(0, seats.indexOf(room.sessionId));
    return new Table(room, seat, seats);
  }

  get online(): boolean { return this.room !== null; }

  /**
   * Who runs the bots.
   *
   * Solo, it is the only player there is. Online it is whoever sits in the
   * first seat — one machine, deterministically chosen, because two clients
   * both playing a bot's turn would play two different moves and the second
   * would overwrite the first.
   */
  get isHost(): boolean {
    return !this.room || this.seats[0] === this.room.sessionId;
  }

  /**
   * Is this seat played by a bot?
   *
   * Empty seats are, and so are seats whose player has since left: somebody
   * closing their laptop in the middle of a four-handed game must not stop
   * the other three, and the host picking the seat up is the only outcome
   * that keeps the board moving. (The 2D game left the turn with them, and
   * the game simply stopped.)
   */
  isBot(seat: number): boolean {
    const sid = this.seats[seat];
    if (!sid) return true;
    // Solo: the one named seat is the person holding the phone.
    if (!this.room) return false;
    return !this.present(sid);
  }

  /** Is this session still connected to the room? */
  private present(sid: string): boolean {
    const players = (this.room?.state as { players?: { get?: (k: string) => unknown } } | undefined)?.players;
    return !!players?.get?.(sid);
  }

  /** The display name of whoever is in a seat, or `null` for a bot. */
  nameOf(seat: number): string | null {
    const sid = this.seats[seat];
    if (!sid || !this.room) return null;
    const players = (this.room.state as {
      players?: { get?: (k: string) => { displayName?: string } | undefined };
    }).players;
    const p = players?.get?.(sid);
    return p ? (p.displayName ?? null) : null;
  }

  /** Push the whole game state to everyone else. A no-op solo. */
  publish(snapshot: Snapshot): void {
    this.room?.data.set(KEY.state, snapshot);
  }

  /** The state as the room currently has it, or `null` before the first
   *  publish — which is also how a joining client knows to wait. */
  read(): Snapshot | null {
    return this.room ? this.room.data.get<Snapshot>(KEY.state) : null;
  }

  /**
   * Somebody changed something.
   *
   * Colyseus delivers one callback for any change to the room, so this fires
   * for chat presence and seat changes too — the handler re-reads rather than
   * being told what moved, which is also what makes a late joiner and a
   * mid-game update the same code path.
   */
  onChange(fn: () => void): void {
    if (!this.room) return;
    this.offs.push(this.room.onStateChange(() => fn()));
  }

  onChat(fn: (msg: ChatMessage) => void): void {
    if (!this.room) return;
    this.offs.push(this.room.chat.onMessage(fn));
  }

  async say(text: string): Promise<void> {
    await this.room?.chat.send(text);
  }

  onError(fn: (message: string) => void): void {
    if (!this.room) return;
    this.offs.push(this.room.onError((_code, message) => fn(message ?? 'error')));
    this.offs.push(this.room.onLeave(() => fn('left')));
  }

  /** Stop listening and let go of the room. Safe to call twice: leaving a
   *  game and closing the tab both end up here. */
  close(): void {
    this.offs.forEach((off) => off());
    this.offs = [];
    void this.room?.leave();
  }
}

/** Six characters a person can read out over a phone. No O/0 or I/1 — the
 *  point of the code is that somebody says it out loud to somebody else. */
export function roomCode(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let out = '';
  for (let i = 0; i < 6; i++) out += alphabet[Math.floor(Math.random() * alphabet.length)];
  return out;
}
