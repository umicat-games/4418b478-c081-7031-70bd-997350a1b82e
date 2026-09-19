// The course screen: carry on, or choose a lesson.
//
// Locked lessons are SHOWN, not hidden. A list of five with two crossed off,
// one open and two locked is a course you can see yourself getting through;
// a single "next lesson" button is a corridor with no end in sight. The lock
// also says what it wants — pass the one before — which is the only honest way
// to present a gate.
//
// Passed lessons stay open for ever. Nobody learns two eyes the first time.
import './coursemenu.css';
import { LESSONS } from '../teach/curriculum';
import { t, type Key } from '../i18n';

export interface CourseMenuOptions {
  /** Lessons whose test has been passed. */
  passed: string[];
  /** The lesson currently open, if any. */
  current: string | null;
  /** Start (or restart) a lesson from its explanation. */
  onPick(id: string): void;
  /** Carry on where they left off. */
  onContinue(): void;
  /** Back to the title. */
  onBack(): void;
}

export function showCourseMenu(opts: CourseMenuOptions): void {
  document.getElementById('coursemenu')?.remove();

  const el = document.createElement('div');
  el.id = 'coursemenu';
  const close = (): void => el.remove();

  const heading = document.createElement('h2');
  heading.textContent = t('course.heading');
  el.appendChild(heading);

  // Where "continue" goes: the lesson in progress, or the first one not passed.
  const resumeId = opts.current ?? LESSONS.find((l) => !opts.passed.includes(l.id))?.id ?? null;
  const cont = document.createElement('button');
  cont.className = 'continue';
  cont.hidden = !resumeId;
  if (resumeId) {
    const index = LESSONS.findIndex((l) => l.id === resumeId) + 1;
    cont.textContent = `${t('course.continue')} · ${t('course.banner', { index, total: LESSONS.length, name: t(`lesson.${resumeId}` as Key) })}`;
  }
  cont.onclick = () => { close(); opts.onContinue(); };
  el.appendChild(cont);

  const list = document.createElement('div');
  list.className = 'list';
  LESSONS.forEach((lesson, i) => {
    const passed = opts.passed.includes(lesson.id);
    // Open if it is the first, if it has been passed, or if the one before it
    // has. Everything past that is locked — and a lesson in progress counts as
    // open even when its test has not been passed yet.
    const unlocked = i === 0 || passed || opts.passed.includes(LESSONS[i - 1].id) || opts.current === lesson.id;

    const row = document.createElement('button');
    row.className = `lesson${passed ? ' passed' : ''}${opts.current === lesson.id ? ' open' : ''}`;
    row.disabled = !unlocked;

    const n = document.createElement('span');
    n.className = 'n';
    n.textContent = passed ? '✓' : unlocked ? String(i + 1) : '🔒';

    const name = document.createElement('span');
    name.className = 'name';
    name.textContent = t(`lesson.${lesson.id}` as Key);

    const state = document.createElement('span');
    state.className = 'state';
    state.textContent = passed ? t('course.replay')
      : opts.current === lesson.id ? t('course.inProgress')
        : unlocked ? '' : t('course.locked');

    row.append(n, name, state);
    row.onclick = () => { close(); opts.onPick(lesson.id); };
    list.appendChild(row);
  });
  el.appendChild(list);

  const back = document.createElement('button');
  back.className = 'back';
  back.textContent = t('course.back');
  back.onclick = () => { close(); opts.onBack(); };
  el.appendChild(back);

  document.body.appendChild(el);
}
