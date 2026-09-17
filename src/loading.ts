/**
 * The loading screen.
 *
 * Plain DOM on purpose: it has to be on screen before three.js exists, and it
 * has to survive a scene being torn down. There is no platform trap here —
 * nothing about it is hard on a phone — so it belongs to the game.
 *
 * It exists because the handover between scenes is not instant, and what the
 * screen shows while it happens is the LAST RENDERED FRAME: the loop has
 * stopped and the scene is gone, so a frozen picture of where you just were
 * sits there looking like a hang. Measured at 4.4s before the hub started
 * prefetching, about a second after.
 */
import * as THREE from 'three';
import { WORDMARK } from './wordmark';

let el: HTMLElement | null = null;
let barEl: HTMLElement | null = null;

/** How far along the bar is drawn, 0..1. Only ever goes up within one load —
 *  a bar that slips backwards is worse than one that does not move. */
let shown = 0;
/** Items three has finished for the load now on screen. */
let done = 0;
/** Which load this is, so the count below can be looked up. */
let phase = '';
/** What this phase needed LAST time, per device. See `expected` below. */
let expected = 0;

const KEY = 'bala-load-';

/**
 * Why the denominator comes from last time instead of from three.
 *
 * `LoadingManager` reports `itemsLoaded / itemsTotal`, and the total is what it
 * knows about SO FAR — it grows as the loaders queue more. Measured on the real
 * boot: the total climbed 15 → 21 → 67 → 84 → 93, and `n === total` five times
 * on the way. A bar driven off that ratio reaches **100% at 254ms of a 713ms
 * load** and then sits there, which is the exact bar this was replacing.
 *
 * The count is deterministic per screen, though, so the honest denominator is
 * what that screen needed the last time it loaded. The first time on a device
 * there is no answer, and the bar says so by sliding instead of filling — an
 * indeterminate bar means "still working"; a percentage means "this much of
 * it", and inventing the second one is how a loading bar starts lying.
 */
const remember = (): void => {
  if (!phase || done <= 0) return;
  try { localStorage.setItem(KEY + phase, String(done)); } catch { /* private mode */ }
};
const recall = (p: string): number => {
  try { return Number(localStorage.getItem(KEY + p)) || 0; } catch { return 0; }
};

/** Chained, not replaced: the manager is three's own shared one and something
 *  else may be listening. */
const prevProgress = THREE.DefaultLoadingManager.onProgress;
THREE.DefaultLoadingManager.onProgress = (url, loaded, total): void => {
  prevProgress?.(url, loaded, total);
  if (!el || el.style.display === 'none') return;
  done = loaded;
  if (!expected) return;            // still sliding; just counting for next time
  // Never over 100 and never backwards. `max(expected, loaded)` covers a load
  // that turns out bigger than last time's — a village with more in it.
  const frac = loaded / Math.max(expected, loaded);
  draw(Math.max(shown, frac));
};

/** The last stretch is not measured, and is not pretended to be.
 *
 *  Downloads are about nine tenths of the wait (545ms of loading screen, last
 *  fetch landing at 498ms), and what is left is building the scene and warming
 *  the shaders. The bar stops at 92% while that happens rather than creeping
 *  towards 100 on a timer, because a bar that moves without anything happening
 *  is the thing this whole file is trying not to be. `hideLoading` fills it. */
const TAIL = 0.92;

function draw(next: number): void {
  shown = Math.min(1, Math.max(shown, next));
  if (!barEl) return;
  barEl.style.animation = 'none';
  barEl.style.width = `${(shown * TAIL * 100).toFixed(1)}%`;
  barEl.style.transform = 'none';
}

function slide(): void {
  if (!barEl) return;
  barEl.style.width = '38%';
  barEl.style.animation = 'slide 1.1s ease-in-out infinite';
}

function ensure(): HTMLElement {
  if (el) return el;
  const d = document.createElement('div');
  d.id = 'loading';
  // The cover art, with the gradient still behind it: if the image has not
  // arrived — and it is the first thing a new player's browser asks for — the
  // screen is a deliberate colour rather than white.
  d.style.cssText = `
    position: fixed; inset: 0; z-index: 100; display: none;
    align-items: center; justify-content: center; flex-direction: column; gap: 14px;
    background-color: #233a44;
    background-image: linear-gradient(rgba(10,16,20,.55), rgba(10,16,20,.72)),
                      url('uploaded/background-cover.jpg');
    background-size: cover, cover; background-position: center, center;
    color: #fff; font: 700 20px/1.4 system-ui, sans-serif;
    transition: opacity 220ms ease-out; opacity: 1;
  `;
  // The wordmark, at the same size and in the same PLACE as the title screen's
  // — one definition, in `src/wordmark.ts`, so they cannot drift.
  //
  // Both stacks are centred vertically, so the taller one pushes its heading
  // up, and the spacer below makes the two stacks the same height. Measured
  // each time, never guessed — the difference is whatever the two screens
  // happen to carry under the name, and it has changed twice: it was 44 while
  // the title had a subtitle under the wordmark, and dropping that line left
  // the title's name sitting 19 pixels LOWER, so this stack had to lose 38.
  // (Both are centred, so a stack-height difference shows up halved.)
  d.innerHTML = `
    ${WORDMARK}
    <div class="msg" style="font:600 14px/1.5 system-ui;letter-spacing:.06em;opacity:.85;
      text-shadow:0 1px 6px rgba(0,0,0,.6)"></div>
    <div style="width:min(260px, 56vw);height:6px;border-radius:99px;
      background:rgba(0,0,0,.38);box-shadow:0 0 0 1px rgba(255,255,255,.12);overflow:hidden">
      <div class="bar" style="width:38%;height:100%;border-radius:99px;background:#ffd76a;
        transition:width 180ms linear; animation: slide 1.1s ease-in-out infinite"></div>
    </div>
    <div style="height:6px"></div>
    <style>@keyframes slide { 0%{transform:translateX(-110%)} 100%{transform:translateX(320%)} }</style>
  `;
  document.body.appendChild(d);
  el = d;
  barEl = d.querySelector('.bar');
  return d;
}

/** `phaseKey` names WHICH load this is, so its size can be remembered per
 *  screen. Loads of different screens take very different numbers of items. */
export function showLoading(message: string, phaseKey = 'scene'): void {
  const d = ensure();
  (d.querySelector('.msg') as HTMLElement).textContent = message;
  phase = phaseKey;
  expected = recall(phaseKey);
  done = 0;
  shown = 0;
  if (expected) draw(0); else slide();
  d.style.display = 'flex';
  d.style.opacity = '1';
}

/** Fades out rather than vanishing: a hard cut from a flat colour to a 3D
 *  scene reads as a flicker, and the fade also covers the first frame or two
 *  while the camera settles onto the character. */
export function hideLoading(): void {
  remember();
  if (!el) return;
  const d = el;
  // Full, then gone. The last stretch is the scene being built, which nothing
  // here can see; arriving at 100 as it finishes is the truth, and a bar that
  // disappears at 92% reads as having given up.
  if (expected) { shown = 1; if (barEl) { barEl.style.animation = 'none'; barEl.style.width = '100%'; } }
  d.style.opacity = '0';
  setTimeout(() => { if (d.style.opacity === '0') d.style.display = 'none'; }, 240);
}

/** For probes: what the bar is showing, and whether it is measuring at all. */
export function loadingState(): { shown: number; done: number; expected: number; phase: string } {
  return { shown, done, expected, phase };
}
