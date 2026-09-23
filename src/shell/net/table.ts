// Two seats, and where the board lives when somebody else is looking at it.
//
// A solo game and an online game are the same game — `Table` is what lets the
// rest of the code stop asking which one it is. Offline it is one seat with
// the player in it and an engine answering; online it is a room with two
// people, no engine, and no assistant.
//
// **A table is a lifetime, not a hand of cards.** The first version decided
// the seats ONCE, when the second player arrived, and never looked again —
// which was wrong in four ways that all showed up the first time two real
// people used it: the player left behind after a game could not see whoever
// sat down next; the newcomer was handed somebody else's finished game and
// shown its result; two people could end up believing they were the same
// seat; and a room nobody was in stayed on the list of open tables. Seats
// here are therefore DERIVED from who is present, re-derived on every change,
// and maintained by exactly one client.
//
// Two rules carried over from Blokus are still load-bearing:
//
// **The whole state travels as ONE value, under one key.** Board, clocks and
// result in one JSON string; sent as separate keys, a client can read a board
// from after a move and a clock from before it. For these games the state is
// the move LIST, replayed through the referee — which is also how a save
// works, so there is one format, not two.
//
// **Only the player whose turn it is writes it.** That is what makes a
// last-writer-wins map safe: exactly one writer at any moment, and the rules
// say who it is. The exceptions are the end of a game and the start of one,
// and both are marked where they happen.
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
  /**
   * Which game at this table this is.
   *
   * A table outlives its games: people rematch, and people leave and are
   * replaced. Without a number on it, the finished game left in the room is
   * handed to whoever sits down next, who is shown a result they had no part
   * in — which is exactly what happened.
   */
  gen: number;
  /** Whose game it is, by session. A different pair is a different game, and
   *  nobody inherits the last pair's board. */
  for: [string, string];
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

interface PlayerRow { displayName?: string; joinedAt?: number }

export class Table {
  private offs: Unsub[] = [];
  private gone = false;

  constructor(readonly room: UmicatRoom<unknown>, readonly code: string) {}

  get sid(): string { return this.room.sessionId; }

  // ── who is here ─────────────────────────────────────────────────────────

  /** Everyone connected, oldest join first — which is the order seats are
   *  handed out in, and the order the maintainer is chosen in. */
  present(): string[] {
    const players = (this.room.state as {
      players?: { forEach?: (fn: (p: PlayerRow, sid: string) => void) => void };
    })?.players;
    const rows: Array<{ sid: string; at: number }> = [];
    players?.forEach?.((p, sid) => { rows.push({ sid, at: p?.joinedAt ?? 0 }); });
    rows.sort((a, b) => (a.at - b.at) || (a.sid < b.sid ? -1 : 1));
    return rows.map((r) => r.sid);
  }

  here(sid: string | null): boolean { return !!sid && this.present().includes(sid); }

  /**
   * The one client that maintains the seats.
   *
   * Everybody works it out the same way — the longest-standing connection —
   * so there is one writer without anybody having to be told they are it. Two
   * clients each seating themselves is how both of them end up in seat zero.
   */
  get maintainer(): boolean { return this.present()[0] === this.sid; }

  /** The seats as the room has them, with anybody who has gone taken out.
   *  A seat is a session id or nothing. */
  seats(): Array<string | null> {
    const raw = this.room.data.get<Array<string | null>>(KEY.seats) ?? [null, null];
    const out: Array<string | null> = [raw[0] ?? null, raw[1] ?? null];
    return out.map((sid) => (this.here(sid) ? sid : null));
  }

  /**
   * Put people in the empty seats, and write it down. Maintainer only.
   *
   * Nobody is ever moved: a player who is seated keeps their seat for as long
   * as they are connected, because their colour and their clock hang off it.
   * Returns whether anything changed.
   */
  maintainSeats(): boolean {
    if (!this.maintainer) return false;
    // **Nobody is seated alone.** A seat only means anything opposite another
    // one, and writing one while you are the only person in the room is how
    // the race happened: a client joins, looks around before anybody has told
    // it about anybody else, and writes itself into the first chair — its
    // write landing after the real maintainer's and clobbering it. With
    // nothing written until there are two people, there is exactly one client
    // in a position to write.
    if (this.present().length < 2) return false;
    const started = !!this.read();
    // Before any game has been dealt, the seating can still be PUT RIGHT.
    //
    // A client that joins and looks around before anyone has told it about
    // anybody else believes it is the only one here, decides it is the
    // maintainer, and seats itself first — so the person who opened the table
    // ends up in the second seat behind the person who walked in. Once a game
    // exists nobody is moved (a colour and a clock hang off each seat), but
    // until then the longest-standing connection gets the first chair.
    const seats = started
      ? this.seats()
      : ([null, null] as Array<string | null>);
    const spare = this.present().filter((sid) => !seats.includes(sid));
    for (let i = 0; i < 2 && spare.length; i++) if (!seats[i]) seats[i] = spare.shift()!;
    const raw = this.room.data.get<Array<string | null>>(KEY.seats) ?? [null, null];
    if (raw[0] === seats[0] && raw[1] === seats[1]) return false;
    this.room.data.set(KEY.seats, seats);
    return true;
  }

  /** My seat, or null if I am standing. */
  get seat(): SeatNo | null {
    const i = this.seats().indexOf(this.sid);
    return i === 0 || i === 1 ? (i as SeatNo) : null;
  }

  /** The other seat — which only means anything once I have one. */
  get them(): SeatNo | null {
    const mine = this.seat;
    return mine === null ? null : ((mine === 0 ? 1 : 0) as SeatNo);
  }

  /** Both seats taken, by people who are still here. */
  get full(): boolean {
    const s = this.seats();
    return !!s[0] && !!s[1];
  }

  /** Who is in a seat, as the room knows them. */
  who(seat: SeatNo | null): Person | null {
    if (seat === null) return null;
    const sid = this.seats()[seat];
    if (!sid) return null;
    const players = (this.room.state as {
      players?: { get?: (k: string) => PlayerRow | undefined };
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
  mine(key: string, value: unknown): void { this.room.player.set(key, value); }

  // ── the game ────────────────────────────────────────────────────────────

  publish(s: Snapshot): void { this.room.data.set(KEY.state, s); }
  read(): Snapshot | null { return this.room.data.get<Snapshot>(KEY.state); }

  /** The pair currently seated, as a snapshot records it. */
  pair(): [string, string] | null {
    const s = this.seats();
    return s[0] && s[1] ? [s[0], s[1]] : null;
  }

  /** Is that snapshot about the people sitting here now? A game belongs to a
   *  pair; whoever sits down next gets a new one, not this one's result. */
  isOurs(s: Snapshot | null): boolean {
    const p = this.pair();
    if (!s || !p) return false;
    return (s.for[0] === p[0] && s.for[1] === p[1]) || (s.for[0] === p[1] && s.for[1] === p[0]);
  }

  // ── talking ─────────────────────────────────────────────────────────────

  /** Ask for something the other side has to agree to. Not state: an offer
   *  nobody answered should not survive a reload as a pending question. */
  offer(kind: OfferKind): void { this.room.send(MSG.offer, { kind }); }
  answer(kind: OfferKind, yes: boolean): void { this.room.send(MSG.answer, { kind, yes }); }

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
  onChange(fn: () => void): void { this.offs.push(this.room.onStateChange(() => fn())); }

  onChat(fn: (msg: ChatMessage) => void): void { this.offs.push(this.room.chat.onMessage(fn)); }

  async say(text: string): Promise<void> { await this.room.chat.send(text); }

  /** Our own connection failed or was closed by the other end. */
  onGone(fn: (why: string) => void): void {
    this.offs.push(this.room.onError((_c, m) => fn(m ?? 'error')));
    this.offs.push(this.room.onLeave(() => fn('left')));
  }

  /**
   * Get up.
   *
   * **Every way out of a game has to come through here**, including the ones
   * that do not feel like leaving a room — the gear's "back to the title", a
   * new game against the engine, closing the tab. A client that stays
   * connected while its player is somewhere else is a table that stays on the
   * list of open tables with nobody at it, which is what was happening.
   */
  close(): void {
    if (this.gone) return;
    this.gone = true;
    this.offs.forEach((off) => off());
    this.offs = [];
    void this.room.leave();
  }

  get left(): boolean { return this.gone; }
}

/** Six characters a person can read out over a phone. No O/0 or I/1 — the
 *  whole point of the code is that somebody says it to somebody else. */
export function roomCode(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let out = '';
  for (let i = 0; i < 6; i++) out += alphabet[Math.floor(Math.random() * alphabet.length)];
  return out;
}
