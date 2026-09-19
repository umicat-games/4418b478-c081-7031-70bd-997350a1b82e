// What a lesson is about, before anyone starts talking.
//
// The coach introduces the idea in its own words — but it is a language model
// at the end of a network call, and a lesson whose opening depends on that has
// no opening at all for a player who is signed out, out of credits, or on a
// train. The card is the game's own promise about the next few minutes, and it
// is the same every time, which is what a syllabus is for.
//
// It is also where "what will I be able to do at the end" belongs. A level
// without a stated objective is a room you are put in.
import './lessoncard.css';
import { t, type Key } from '../i18n';

export interface LessonCardOptions {
  lessonId: string;
  index: number;
  total: number;
  /** Runs when the player dismisses it — the coach starts talking after. */
  onBegin(): void;
}

export function showLessonCard(opts: LessonCardOptions): void {
  const el = document.createElement('div');
  el.id = 'lessoncard';

  const card = document.createElement('div');
  card.className = 'card';

  const head = document.createElement('div');
  head.className = 'head';
  head.textContent = t('lesson.intro.head', { index: opts.index, total: opts.total });

  const title = document.createElement('h2');
  title.textContent = t(`lesson.${opts.lessonId}` as Key);

  const body = document.createElement('div');
  body.className = 'body';
  // One paragraph per line: the last one is always "by the end you will…",
  // and it reads as a promise rather than as more prose when it stands alone.
  for (const line of t(`lesson.${opts.lessonId}.intro` as Key).split('\n')) {
    const p = document.createElement('p');
    p.textContent = line;
    body.appendChild(p);
  }

  const begin = document.createElement('button');
  begin.textContent = t('lesson.intro.begin');
  begin.onclick = () => {
    el.remove();
    opts.onBegin();
  };

  card.append(head, title, body, begin);
  el.appendChild(card);
  document.body.appendChild(el);
  begin.focus();
}
