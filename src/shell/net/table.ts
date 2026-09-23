// Two seats, and where the board lives when somebody else is looking at it.
//
// A solo game and an online game are the same game — `Table` is what lets the
// rest of the code stop asking which one it is. Offline it is one seat with
// the player in it and an engine answering; online it is a room with two
// people, no engine, and no assistant.
//
// Most of what is in here was learned in Blokus (`work/umicat/blokus`), and
// two of its rules are load-bearing:
//
// **The whole state travels as ONE value, under one key.** Board, clocks and
// result in one JSON string. Sent as separate keys, a client can read a board
// from after a move and a clock from before it; one key is never half-applied.
// For these games the state is the move LIST, replayed through the referee —
// which is also how a save works, so there is one format, not two.
//
// **Only the player whose turn it is writes it.** That is what makes a
// last-writer-wins map safe: there is exactly one writer at any moment, and
// the rules say who it is. The one exception is the end of the game — a
// resignation, a flag, an opponent who left — and it is marked where it
// happens.
import type { UmicatRoom, ChatMessage } from '@umicat/platform-sdk';
import type { TimeControl } from './clock';

/** Seats, in move order. Seat 0 moves first. */
export type SeatNo = 0 | 1;

/** Why a game stopped, when it was not the board that stopped it. */
export type EndKind = 'resign' | 'timeout' | 'left' | 'draw';

/**
 * Everything both sides need, in one value.
 *
 * `moves` is the game, replayed through the referee. `clock` is what each
 * side had left the moment `at` was stamped; the side to move is spending
 * from `at` onwards, which is why nobody has to send a tick.
 */
export interface Snapshot {
  moves: number[];
  clock: [number, number];
  /** `Date.now()` on the machine that wrote it, when the current turn began. */
  at: number;
  /**
   * The time control, written once by whoever opened the table.
   *
   * It rides in the snapshot rather than being a constant on both sides
   * because the table-maker CHOOSES it: two clients each using their own
   * default would each be right about a different game.
   */
  tc?: TimeControl;
  /** Byo-yomi periods left, per seat. Absent when the control has none. */
  periods?: [number, number];
  end?: { kind: EndKind; by?: SeatNo };
}

/** Keys in the room's shared map. */
export const KEY = { seats: 'seats', state: 'state' } as const;

/** Transient messages — offers and answers, which are not state. */
export const MSG = { offer: 'offer', answer: 'answer' } as const;
export type OfferKind = 'draw' | 'rematch';

type Unsub = () => void;

export interface Person {
  name: string;
  avatar: string | null;
}

export class Table {
  private offs: Unsub[] = [];

  private constructor(
    readonly room: UmicatRoom<unknown> | null,
    readonly seat: SeatNo,
    readonly seats: string[],
  ) {}

  /** One person against the engine. No network at all — not a room with one
   *  player in it, which would cost a connection to do nothing with. */
  static solo(): Table { return new Table(null, 0, []); }

  static online(room: UmicatRoom<unknown>, seats: string[]): Table {
    const seat = seats.indexOf(room.sessionId) === 1 ? 1 : 0;
    return new Table(room, seat, [...seats]);
  }

  get online(): boolean { return this.room !== null; }
  /** The other seat. In a two-seat game this is all "the opponent" means. */
  get them(): SeatNo { return this.seat === 0 ? 1 : 0; }

  /** Is that seat's player still connected? */
  present(seat: SeatNo): boolean {
    const sid = this.seats[seat];
    if (!this.room || !sid) return false;
    const players = (this.room.state as {
      players?: { get?: (k: string) => unknown };
    })?.players;
    return !!players?.get?.(sid);
  }

  /** Who is in a seat, as the room knows them. */
  who(seat: SeatNo): Person | null {
    const sid = this.seats[seat];
    if (!this.room || !sid) return null;
    const players = (this.room.state as {
      players?: { get?: (k: string) => { displayName?: string } | undefined };
    })?.players;
    const p = players?.get?.(sid);
    if (!p) return null;
    return {
      name: p.displayName || 'Player',
      // The avatar rides in the player's own map rather than in displayName,
      // because the room's Player schema only carries a name.
      avatar: this.room.player.get<string>(sid, 'avatar') ?? null,
    };
  }

  /** Put something of mine where the other side can read it. */
  mine(key: string, value: unknown): void { this.room?.player.set(key, value); }

  publish(s: Snapshot): void { this.room?.data.set(KEY.state, s); }
  read(): Snapshot | null {
    return this.room ? this.room.data.get<Snapshot>(KEY.state) : null;
  }

  /** Ask for something the other side has to agree to. Not state: an offer
   *  nobody answered should not survive a reload as a pending question. */
  offer(kind: OfferKind): void { this.room?.send(MSG.offer, { kind }); }
  answer(kind: OfferKind, yes: boolean): void { this.room?.send(MSG.answer, { kind, yes }); }

  onOffer(fn: (kind: OfferKind) => void): void {
    this.listen(MSG.offer, (p) => fn((p as { kind: OfferKind }).kind));
  }
  onAnswer(fn: (kind: OfferKind, yes: boolean) => void): void {
    this.listen(MSG.answer, (p) => {
      const a = p as { kind: OfferKind; yes: boolean };
      fn(a.kind, a.yes);
    });
  }

  private listen(type: string, fn: (payload: unknown) => void): void {
    if (!this.room) return;
    // Colyseus relays a client's own message back to everyone ELSE, so there
    // is no need to filter out our own — but `from` is stamped, and a game
    // that grows a third seat will want it.
    this.offs.push(this.room.on(type, fn));
  }

  /**
   * Somebody changed something.
   *
   * One callback for any change to the room — a move, a player joining, a
   * player leaving — so the handler re-reads rather than being told what
   * moved. That is also what makes a late joiner and a mid-game update the
   * same code path.
   */
  onChange(fn: () => void): void {
    if (!this.room) return;
    this.offs.push(this.room.onStateChange(() => fn()));
  }

  onChat(fn: (msg: ChatMessage) => void): void {
    if (!this.room) return;
    this.offs.push(this.room.chat.onMessage(fn));
  }

  async say(text: string): Promise<void> { await this.room?.chat.send(text); }

  /** The connection itself failed or was closed by the other end. */
  onGone(fn: (why: string) => void): void {
    if (!this.room) return;
    this.offs.push(this.room.onError((_c, m) => fn(m ?? 'error')));
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
 *  whole point of the code is that somebody says it to somebody else. */
export function roomCode(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let out = '';
  for (let i = 0; i < 6; i++) out += alphabet[Math.floor(Math.random() * alphabet.length)];
  return out;
}
