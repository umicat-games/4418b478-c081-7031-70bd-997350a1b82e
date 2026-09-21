// Asking before something that cannot be taken back.
//
// **Never `window.confirm`.** The game runs in a sandboxed iframe
// (`allow-scripts allow-same-origin allow-popups allow-forms` — note what is
// missing), and a sandbox without `allow-modals` makes the browser IGNORE
// `confirm()`: no dialog, no error thrown, and a return value of `false`. So
// the two places that asked — leaving a game, and passing a turn — were
// buttons that did nothing at all, and did it silently. This is that dialog,
// made of the same DOM as everything else.
import './buttons.css';
import './confirm.css';

export function ask(question: string, yes: string, no: string): Promise<boolean> {
  return new Promise((resolve) => {
    const el = document.createElement('div');
    el.id = 'confirm';
    const card = document.createElement('div');
    card.className = 'card';

    const text = document.createElement('p');
    text.textContent = question;

    const row = document.createElement('div');
    row.className = 'row';
    const done = (answer: boolean): void => {
      el.remove();
      document.removeEventListener('keydown', onKey, true);
      resolve(answer);
    };
    const cancel = document.createElement('button');
    cancel.className = 'lift quiet';
    cancel.textContent = no;
    cancel.onclick = () => done(false);
    const confirm = document.createElement('button');
    confirm.className = 'lift';
    confirm.textContent = yes;
    confirm.onclick = () => done(true);
    row.append(cancel, confirm);

    // Escape is no, Enter is what the focused button says. Nothing else gets
    // through: a keypress meant for this dialog must not also turn the piece
    // on the board behind it.
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') { e.preventDefault(); done(false); }
      e.stopPropagation();
    };
    document.addEventListener('keydown', onKey, true);

    // Clicking the shade is the same as saying no — the safe answer, which is
    // the only answer a stray tap is allowed to give.
    el.onclick = (e) => { if (e.target === el) done(false); };

    card.append(text, row);
    el.appendChild(card);
    document.body.appendChild(el);
    requestAnimationFrame(() => { el.classList.add('on'); confirm.focus(); });
  });
}
