// The coach, speaking on the board.
//
// Two problems, one answer. A long reply in a chat panel is a wall of text
// nobody reads, and a reply that says "D4" is a coordinate the player has to
// find for themselves. So the reply is cut into sentences, shown one at a
// time, and each sentence that names a point is shown AT that point with the
// point lit up — which is what a teacher sitting across the table does.
//
// Where a sentence points is decided in three steps, in this order:
//
//   1. the coach SAYS so, by opening the sentence with `[C3]`;
//   2. failing that, the sentence names a point in passing ("C3 has three
//      liberties") and we read it out;
//   3. failing that, the middle of the board.
//
// (1) leads because of what the coach actually writes. A coach answering in
// Chinese says "这颗子还没活" — no coordinate anywhere in it — and a reader that
// only parses coordinates would anchor nothing at all, in the language most of
// its students will use. (2) stays as a fallback because it costs nothing and
// catches the sentences where the coach names a point without marking it.
//
// A marker rather than an action, deliberately: a reply is several sentences
// and `do` is a flat list of calls with nothing tying a call to a sentence, so
// three `focus` calls could not say WHICH line each belonged to. The marker
// travels with the sentence it is about.
import './buttons.css';
import './speech.css';
import { fromGtp, toGtp } from '../go/coords';
import { Dictation, waveBars } from './dictation';
import { t } from '../i18n';
import type { ThreeUmicat } from '@umicat/three-sdk';

export interface Segment {
  text: string;
  /** The point this sentence is about, if it names one. */
  at?: { x: number; y: number };
}

/** Roughly how much text fits on one page before it stops being a remark and
 *  starts being a paragraph. CJK says more per character, so it gets less. */
const MIC = '<svg viewBox="0 0 24 24"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/></svg>';
const STOP = '<svg viewBox="0 0 24 24"><rect x="7" y="7" width="10" height="10" rx="2" fill="currentColor" stroke="none"/></svg>';
const SEND = '<svg viewBox="0 0 24 24"><path d="M4 12h15M13 6l6 6-6 6"/></svg>';

const MAX_CJK = 46;
const MAX_LATIN = 130;

/**
 * Cut a reply into pages, and find what each page is pointing at.
 *
 * Sentences are the unit because they are the unit the coach writes in; a
 * fixed character count would cut "D4 is" | "the cutting point" and put half a
 * thought on the board.
 */
export function segment(text: string, size: number): Segment[] {
  const clean = text.trim();
  if (!clean) return [];

  // Keep the punctuation: it is what tells a sentence apart from a fragment,
  // and a CJK full stop ends a sentence as much as a Latin one does.
  //
  // Matched rather than split on, deliberately — splitting needs a lookbehind
  // to keep the punctuation, and lookbehind is a syntax error in older
  // WebKit, which does not fail on the line that uses it: it fails when the
  // FILE is parsed, taking the whole game down on those devices.
  const sentences = clean.match(/[^.!?。！？\n]+[.!?。！？]*\s*/g) ?? [clean];
  const isCjk = /[㐀-鿿]/.test(clean);
  const max = isCjk ? MAX_CJK : MAX_LATIN;

  // Each sentence first, with what it points at, and only THEN the merging —
  // because two sentences that name different points must never end up on one
  // page. Merging them would put "look at C3" and "if White plays E5" in one
  // bubble, which can only be anchored to one of them, and the pointing is the
  // entire feature.
  const pieces = sentences
    .map((text) => text.trim())
    .filter(Boolean)
    .map((text) => {
      const marked = marker(text, size);
      return marked ?? { text, at: firstPoint(text, size) };
    });

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
 * A sentence the coach opened with `[C3]` — what it explicitly pointed at.
 *
 * Only at the start, and the marker is stripped: it is a stage direction, not
 * something to read out. An unparseable marker ("[the corner]") is left in the
 * text rather than silently eaten, so a coach writing nonsense looks like a
 * coach writing nonsense instead of like a bug in the bubble.
 */
function marker(text: string, size: number): Segment | null {
  const m = /^[[［]\s*([A-HJ-Ta-hj-t])\s?([1-9]|1[0-9])\s*[\]］]\s*/.exec(text);
  if (!m) return null;
  const at = fromGtp(`${m[1]}${m[2]}`, size);
  if (!at) return null;
  return { text: text.slice(m[0].length).trim(), at };
}

/** Strip the stage directions, for anywhere the line is shown as prose. */
export function stripAnchors(text: string): string {
  return text.replace(/(^|\n)\s*[[［]\s*[A-HJ-Ta-hj-t]\s?(?:[1-9]|1[0-9])\s*[\]］]\s*/g, '$1');
}

/**
 * The first board point named in a page, if any.
 *
 * Deliberately strict about what counts: a letter that is not part of a word,
 * an optional space, a number that is not part of a longer number. Without
 * that, "9x9" and the D in "Don't" become points on the board, and the bubble
 * jumps to a corner mid-sentence for no reason anyone can see.
 */
function firstPoint(text: string, size: number): { x: number; y: number } | null {
  const re = /(^|[^A-Za-z])([A-HJ-Ta-hj-t])\s?([1-9]|1[0-9])(?![0-9])/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const at = fromGtp(`${m[2]}${m[3]}`, size);
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
  /** May the student put a stone on this point right now? Decides whether the
   *  bubble offers to play it. */
  canPlay(at: { x: number; y: number }): boolean;
  /** They took the offer. */
  onPlay(at: { x: number; y: number }): void;
}

export class Speech {
  private el: HTMLDivElement;
  private textEl: HTMLDivElement;
  private moreEl: HTMLSpanElement;
  private playBtn: HTMLButtonElement;
  private pages: Segment[] = [];
  private index = 0;
  private input!: HTMLInputElement;
  private micBtn!: HTMLButtonElement;
  private bars: HTMLElement[] = [];
  private dictation!: Dictation;
  private draft = '';
  /** Board size, for turning an anchor back into something to read. */
  private size = 9;

  constructor(umicat: ThreeUmicat, private opts: SpeechOptions) {
    this.el = document.createElement('div');
    this.el.id = 'speech';
    this.el.hidden = true;
    this.el.innerHTML = '<button class="close" title="close">×</button>'
      + '<span class="who"></span><div class="text"></div>'
      + '<button class="play lift" hidden></button><span class="more"></span>'
      // The conversation continues here rather than in the panel: an answer you
      // cannot answer is a dead end, and the only way on used to be opening the
      // whole log and typing there.
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
    // highlighted point on the board being tappable — a stone cannot be taken
    // back, and "I touched the board while reading" must never place one.
    this.playBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const at = this.current?.at;
      if (at) { this.opts.onPlay(at); this.next(); }
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
   *  coach said is always the thing worth reading. */
  show(pages: Segment[], size = this.size): void {
    this.size = size;
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
    // Offered only when the point is actually playable by the student right
    // now — the coach talks about White's moves and about dead shapes too, and
    // a button that says "Play E5" where a stone already sits is a button that
    // teaches the player not to trust buttons.
    const at = page.at;
    const offer = !!at && this.opts.canPlay(at);
    this.playBtn.hidden = !offer;
    if (offer && at) this.playBtn.textContent = t('speech.playHere', { point: toGtp(at.x, at.y, this.size) });
    this.opts.onPage(page);
  }
}
