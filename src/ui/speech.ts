// The companion, speaking on the board.
//
// Two problems, one answer. A long reply in a chat panel is a wall of text
// nobody reads, and a reply that says "f3" is a square the player has to find
// for themselves. So the reply is cut into sentences, shown one at a time, and
// each sentence that names a square is shown AT that square with the square
// lit up — which is what a teacher sitting across the table does.
//
// Where a sentence points is decided in three steps, in this order:
//
//   1. the companion SAYS so, by opening the sentence with `[f3]`;
//   2. failing that, the sentence names a square in passing ("Nf3 develops"),
//      and we read it out;
//   3. failing that, the middle of the board.
//
// (1) leads because of what the companion actually writes. Answering in
// Chinese it says "这个马还没出来" — no coordinate anywhere in it — and a reader
// that only parses squares would anchor nothing at all, in the language most
// of its students will use. (2) stays as a fallback because it costs nothing,
// and in chess it earns its keep: every move the companion mentions is written
// `Nf3`, which names its own destination square.
//
// A marker rather than an action, deliberately: a reply is several sentences
// and `do` is a flat list of calls with nothing tying a call to a sentence, so
// three `focus` calls could not say WHICH line each belonged to. The marker
// travels with the sentence it is about.
import './buttons.css';
import './speech.css';
import { fromSan, type Sq } from '../chess/coords';
import { Dictation, waveBars } from './dictation';
import { t } from '../i18n';
import type { ThreeUmicat } from '@umicat/three-sdk';

const MIC = '<svg viewBox="0 0 24 24"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/></svg>';
const STOP = '<svg viewBox="0 0 24 24"><rect x="7" y="7" width="10" height="10" rx="2" fill="currentColor" stroke="none"/></svg>';
const SEND = '<svg viewBox="0 0 24 24"><path d="M4 12h15M13 6l6 6-6 6"/></svg>';

export interface Segment {
  text: string;
  /** The square this sentence is about, if it names one. */
  at?: Sq;
}

/** Roughly how much text fits on one page before it stops being a remark and
 *  starts being a paragraph. CJK says more per character, so it gets less. */
const MAX_CJK = 46;
const MAX_LATIN = 130;

/**
 * Cut a reply into pages, and find what each page is pointing at.
 *
 * Sentences are the unit because they are the unit the companion writes in; a
 * fixed character count would cut "Nf3 is" | "the move" and put half a thought
 * on the board.
 */
export function segment(text: string): Segment[] {
  const clean = text.trim();
  if (!clean) return [];

  // Keep the punctuation: it is what tells a sentence apart from a fragment,
  // and a CJK full stop ends a sentence as much as a Latin one does.
  //
  // Matched rather than split on, deliberately — splitting needs a lookbehind
  // to keep the punctuation, and lookbehind is a syntax error in older WebKit,
  // which does not fail on the line that uses it: it fails when the FILE is
  // parsed, taking the whole game down on those devices.
  const sentences = clean.match(/[^.!?。！？\n]+[.!?。！？]*\s*/g) ?? [clean];
  const isCjk = /[㐀-鿿]/.test(clean);
  const max = isCjk ? MAX_CJK : MAX_LATIN;

  // Each sentence first, with what it points at, and only THEN the merging —
  // because two sentences that name different squares must never end up on one
  // page. Merging them would put "your knight on c3" and "if they play e5" in
  // one bubble, which can only be anchored to one of them, and the pointing is
  // the entire feature.
  const pieces = sentences
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => marker(s) ?? { text: s, at: firstSquare(s) ?? undefined });

  const pages: Segment[] = [];
  for (const piece of pieces) {
    const last = pages[pages.length - 1];
    const sameTarget = last && (!piece.at || !last.at || (last.at.x === piece.at.x && last.at.y === piece.at.y));
    if (last && sameTarget && last.text.length + piece.text.length <= max) {
      last.text = `${last.text} ${piece.text}`.trim();
      last.at = last.at ?? piece.at ?? undefined;
    } else {
      pages.push({ text: piece.text, at: piece.at ?? undefined });
    }
  }
  return pages;
}

/**
 * A sentence the companion opened with `[f3]` — what it explicitly pointed at.
 *
 * Only at the start, and the marker is stripped: it is a stage direction, not
 * something to read out. An unparseable marker ("[the centre]") is left in the
 * text rather than silently eaten, so a companion writing nonsense looks like
 * a companion writing nonsense instead of like a bug in the bubble.
 */
function marker(text: string): Segment | null {
  const m = /^[[［]\s*([a-hA-H])\s?([1-8])\s*[\]］]\s*/.exec(text);
  if (!m) return null;
  const at = fromSan(`${m[1]}${m[2]}`);
  if (!at) return null;
  return { text: text.slice(m[0].length).trim(), at };
}

/** Strip the stage directions, for anywhere the line is shown as prose. */
export function stripAnchors(text: string): string {
  return text.replace(/(^|\n)\s*[[［]\s*[a-hA-H]\s?[1-8]\s*[\]］]\s*/g, '$1');
}

/**
 * The first square named in a page, if any.
 *
 * This catches more than it looks: every move the companion writes — `Nf3`,
 * `exd5`, `Qxh7#` — ends in the square it goes to, which is exactly the square
 * the sentence is about. What it must NOT catch is a letter that is part of a
 * word, so the file letter has to be preceded by something that is not one —
 * which leaves `Nf3` working (N is a letter, but we start the match at `f`
 * only when the character before it is not a lowercase letter... see below).
 *
 * The rule: the file letter is lowercase and the character before it is not a
 * LOWERCASE letter. That keeps `Nf3` and `Rxe8` (capital piece letters) and
 * drops `the4` and `cafe1`. `a1`-style squares at the start of a sentence work
 * because there is nothing before them.
 */
function firstSquare(text: string): Sq | null {
  const re = /(^|[^a-z])([a-h])\s?([1-8])(?![0-9])/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const at = fromSan(`${m[2]}${m[3]}`);
    if (at) return at;
  }
  return null;
}

export interface SpeechOptions {
  /** A page is now showing. `at` is what it points at, if anything. */
  onPage(segment: Segment): void;
  /** The last page has been dismissed. */
  onDone(): void;
  /** The player answered, from the box the answer was in. */
  onReply(text: string): void;
  /**
   * May the student play what this sentence is pointing at, right now?
   *
   * The whole page is handed over rather than just the square, because in
   * chess a square is not a move: two knights can reach f3, and the sentence
   * is what says which one. Returning the move's name turns the button on and
   * labels it; null leaves it off.
   */
  moveOf(page: Segment): string | null;
  /** They took the offer. */
  onPlay(page: Segment): void;
}

export class Speech {
  private el: HTMLDivElement;
  private textEl: HTMLDivElement;
  private moreEl: HTMLSpanElement;
  private playBtn: HTMLButtonElement;
  private pages: Segment[] = [];
  private index = 0;
  private input: HTMLInputElement;
  private micBtn: HTMLButtonElement;
  private bars: HTMLElement[];
  private dictation: Dictation;
  private draft = '';

  constructor(umicat: ThreeUmicat, private opts: SpeechOptions) {
    this.el = document.createElement('div');
    this.el.id = 'speech';
    this.el.hidden = true;
    this.el.innerHTML = '<button class="close" title="close">×</button>'
      + '<span class="who"></span><div class="text"></div>'
      + '<button class="play lift" hidden></button><span class="more"></span>'
      // The conversation continues here rather than in the panel: an answer
      // you cannot answer is a dead end, and the only way on used to be
      // opening the whole log and typing there.
      + '<div class="reply">'
      + `<div class="field">${waveBars()}<input type="text" autocomplete="off" /></div>`
      + `<button class="mic lift dark" hidden>${MIC}</button>`
      + `<button class="send lift">${SEND}</button>`
      + '</div>'
      + '<div class="dots"><i></i><i></i><i></i></div>';
    document.body.appendChild(this.el);
    this.textEl = this.el.querySelector('.text')!;
    this.moreEl = this.el.querySelector('.more')!;
    this.playBtn = this.el.querySelector('.play')!;
    this.input = this.el.querySelector('input')!;
    this.micBtn = this.el.querySelector('.mic')!;
    this.bars = [...this.el.querySelectorAll('.wave i')] as HTMLElement[];

    this.dictation = new Dictation(umicat, {
      onFinal: (text) => {
        const prefix = this.draft ? `${this.draft.replace(/\s+$/, '')} ` : '';
        this.draft = '';
        this.input.value = prefix + text;
        this.input.focus();
      },
      onState: (listening) => {
        this.el.classList.toggle('listening', listening);
        this.micBtn.innerHTML = listening ? STOP : MIC;
        this.micBtn.title = t(listening ? 'chat.stopRecording' : 'chat.speak');
        if (listening) {
          this.draft = this.input.value;
          this.input.value = '';
          this.input.placeholder = '';
          this.dictation.meter(this.bars);
        } else {
          this.input.placeholder = t('speech.reply');
          if (!this.input.value && this.draft) this.input.value = this.draft;
          this.draft = '';
        }
      },
    });
    if (this.dictation.supported) this.micBtn.hidden = false;

    // Tapping the bubble turns the page — except on the controls, where a tap
    // means the control.
    this.el.addEventListener('click', () => this.next());
    for (const sel of ['.reply', '.dots']) {
      this.el.querySelector(sel)!.addEventListener('click', (e) => e.stopPropagation());
    }
    (this.el.querySelector('.close') as HTMLButtonElement).addEventListener('click', (e) => {
      e.stopPropagation();
      this.hide();
    });
    (this.el.querySelector('.send') as HTMLButtonElement).addEventListener('click', (e) => {
      e.stopPropagation();
      this.reply();
    });
    this.micBtn.addEventListener('click', (e) => { e.stopPropagation(); void this.dictation.toggle(); });
    this.input.addEventListener('keydown', (e) => { if (e.key === 'Enter') this.reply(); });
    // Its own handler, and it must not also page the bubble on: one tap is one
    // thing. The stop is the whole reason this is a button rather than the
    // highlighted square being tappable — "I touched the board while reading"
    // must never play a move.
    this.playBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const page = this.current;
      if (page) { this.opts.onPlay(page); this.next(); }
    });
    this.relabel();
  }

  relabel(): void {
    this.el.querySelector('.who')!.textContent = t('chat.coach');
    this.input.placeholder = t('speech.reply');
  }

  get showing(): boolean { return !this.el.hidden; }
  get current(): Segment | null { return this.showing ? this.pages[this.index] ?? null : null; }

  /** Say something. Replaces whatever was on screen — the newest thing the
   *  companion said is always the thing worth reading. */
  show(pages: Segment[]): void {
    if (!pages.length) { this.hide(); return; }
    this.pages = pages;
    this.index = 0;
    this.el.hidden = false;
    this.el.classList.remove('fading', 'waiting');
    this.input.value = '';
    this.draw();
  }

  /**
   * Next page. The last one STAYS.
   *
   * Tapping used to dismiss it once there was nothing left to read, which was
   * right when the box was only words. It now ends in a reply field, and a box
   * you are about to type into must not vanish because you tapped it to read
   * on. The cross closes it; so does anything that replaces it.
   */
  next(): void {
    if (!this.showing || this.index >= this.pages.length - 1) return;
    this.index++;
    this.draw();
  }

  hide(): void {
    if (this.el.hidden) return;
    this.dictation.stop();
    this.el.classList.add('fading');
    this.el.hidden = true;
    this.el.classList.remove('waiting');
    this.pages = [];
    this.opts.onDone();
  }

  /** The player answered. The box stays put and waits in place — moving the
   *  conversation somewhere else to show a reply is what the panel does. */
  private reply(): void {
    const text = this.input.value.trim();
    if (!text) return;
    this.dictation.stop();
    this.input.value = '';
    this.el.classList.add('waiting');
    this.opts.onReply(text);
  }

  /** Put the bubble somewhere. `anchored` draws the tail — an unanchored
   *  bubble is parked, not pointing, and should not pretend otherwise. */
  place(x: number, y: number, anchored: boolean): void {
    this.el.style.left = `${Math.round(x)}px`;
    this.el.style.top = `${Math.round(y)}px`;
    this.el.classList.toggle('anchored', anchored);
  }

  /** The bubble's box, for keeping it on screen. */
  rect(): DOMRect { return this.el.getBoundingClientRect(); }

  private draw(): void {
    const page = this.pages[this.index];
    this.textEl.textContent = page.text;
    const last = this.index >= this.pages.length - 1;
    this.moreEl.hidden = last;
    // The reply field belongs at the END of what was said. Offering it under
    // the first of four sentences invites an answer to a thought that is not
    // finished, and puts a text box over the tap that turns the page.
    this.el.classList.toggle('replyable', last);
    // Offered only for a move the student can actually make right now — the
    // companion talks about the engine's replies and about squares to avoid
    // too, and a button offering a move that is not legal is a button that
    // teaches the player not to trust buttons.
    const move = this.opts.moveOf(page);
    this.playBtn.hidden = !move;
    if (move) this.playBtn.textContent = t('speech.playHere', { move });
    this.opts.onPage(page);
  }
}
