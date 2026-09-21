// A question about this point, asked at this point.
//
// Tapping "?" beside a stone used to open the whole chat panel: the board slid
// sideways, you typed, you read the answer, you closed it again. Four
// movements for one question. The panel's job is reading back through a
// conversation; asking about the stone under your finger is a different job and
// it happens here, anchored to the stone, and it turns into the waiting dots in
// the same place when it is sent.
//
// The answer does not come back here — it arrives as the companion's own
// speech, beside whatever point the answer is about, which is often not the
// point that was asked about.
import './buttons.css';
import './askhere.css';
import { Dictation, waveBars } from './dictation';
import { t } from '../i18n';
import type { ThreeUmicat } from '@umicat/three-sdk';

const MIC = '<svg viewBox="0 0 24 24"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/></svg>';
const STOP = '<svg viewBox="0 0 24 24"><rect x="7" y="7" width="10" height="10" rx="2" fill="currentColor" stroke="none"/></svg>';
const SEND = '<svg viewBox="0 0 24 24"><path d="M4 12h15M13 6l6 6-6 6"/></svg>';

export interface AskHereOptions {
  /** The player asked something about `point`. */
  onAsk(point: string, text: string): void;
  /** Dismissed without asking. */
  onCancel(): void;
}

export class AskHere {
  private el: HTMLDivElement;
  private input: HTMLInputElement;
  private micBtn: HTMLButtonElement;
  private bars: HTMLElement[];
  private dictation: Dictation;
  private point: { x: number; y: number } | null = null;
  private label = '';
  private draft = '';

  constructor(umicat: ThreeUmicat, private opts: AskHereOptions) {
    this.el = document.createElement('div');
    this.el.id = 'askhere';
    this.el.hidden = true;
    this.el.innerHTML = '<div class="about"></div>'
      + '<div class="row">'
      + `<div class="field">${waveBars()}<input type="text" autocomplete="off" /></div>`
      + `<button class="mic lift dark" hidden>${MIC}</button>`
      + `<button class="send lift">${SEND}</button>`
      + '</div>'
      + '<div class="dots"><i></i><i></i><i></i></div>';
    document.body.appendChild(this.el);

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
          // The field is the meter while it listens, never both.
          this.draft = this.input.value;
          this.input.value = '';
          this.input.placeholder = '';
          this.dictation.meter(this.bars);
        } else {
          this.input.placeholder = t('askhere.placeholder');
          if (!this.input.value && this.draft) this.input.value = this.draft;
          this.draft = '';
        }
      },
      onError: (kind) => { this.input.placeholder = t(kind === 'not-allowed' ? 'chat.micBlocked' : 'chat.micRetry'); },
    });
    if (this.dictation.supported) this.micBtn.hidden = false;

    this.el.querySelector('.send')!.addEventListener('click', () => this.send());
    this.micBtn.addEventListener('click', () => void this.dictation.toggle());
    this.input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') this.send();
      if (e.key === 'Escape') { this.hide(); this.opts.onCancel(); }
    });
  }

  get showing(): boolean { return !this.el.hidden; }
  get at(): { x: number; y: number } | null { return this.point; }

  /** Open at a point. `label` is how the point is said out loud — "D4". */
  open(point: { x: number; y: number }, label: string): void {
    this.point = point;
    this.label = label;
    this.el.hidden = false;
    this.el.classList.remove('waiting');
    this.el.querySelector('.about')!.textContent = t('askhere.about', { point: label });
    this.input.placeholder = t('askhere.placeholder');
    this.input.value = '';
    this.input.focus();
  }

  hide(): void {
    if (this.el.hidden) return;
    this.dictation.stop();
    this.el.hidden = true;
    this.el.classList.remove('waiting');
    this.point = null;
  }

  /** Keep it over its point. Called whenever the board redraws. */
  place(screen: { x: number; y: number }, spacing: number): void {
    const gap = spacing * 0.7 + 14;
    const box = this.el.getBoundingClientRect();
    const margin = 10;
    const x = Math.min(Math.max(screen.x, box.width / 2 + margin), window.innerWidth - box.width / 2 - margin);
    this.el.style.left = `${Math.round(x)}px`;
    this.el.style.top = `${Math.round(Math.max(screen.y - gap, box.height + margin))}px`;
  }

  private send(): void {
    const text = this.input.value.trim();
    if (!text || !this.label) return;
    this.dictation.stop();
    // Same box, same place, now waiting. Closing it and opening something else
    // would move the answer away from the question.
    this.el.classList.add('waiting');
    this.opts.onAsk(this.label, text);
  }
}
