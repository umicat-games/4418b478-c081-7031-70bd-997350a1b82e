// A curtain over a wait.
//
// Used for exactly one thing, and it should stay that way: the engine's 4MB
// network can still be arriving when a fast player presses through the title.
// Without this, the board appears, they play, and their stone sits there while
// a download nobody told them about finishes — which reads as the game
// ignoring them rather than as loading.
//
// It is NOT used for switching board size or starting a game, both of which
// are instant. A curtain over something that was not slow only adds a delay
// and teaches the player that this game hides things from them.
import './curtain.css';

export async function underCurtain(label: string, work: Promise<unknown>): Promise<void> {
  const el = document.createElement('div');
  el.id = 'curtain';
  el.innerHTML = '<div class="spinner"></div>';
  const text = document.createElement('div');
  text.className = 'label';
  text.textContent = label;
  el.appendChild(text);
  document.body.appendChild(el);
  // A frame between appending and adding the class, or the transition has
  // nothing to transition from and the curtain snaps in.
  requestAnimationFrame(() => el.classList.add('on'));

  try {
    await work;
  } catch { /* the caller reports its own failure; the curtain just lifts */ }

  el.classList.remove('on');
  setTimeout(() => el.remove(), 260);
}
