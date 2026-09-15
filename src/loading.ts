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
let el: HTMLElement | null = null;

function ensure(): HTMLElement {
  if (el) return el;
  const d = document.createElement('div');
  d.id = 'loading';
  d.style.cssText = `
    position: fixed; inset: 0; z-index: 100; display: none;
    align-items: center; justify-content: center; flex-direction: column; gap: 14px;
    background: linear-gradient(#26414f 0%, #233a44 48%, #1d3327 48%, #182a1e 100%);
    color: #fff; font: 700 20px/1.4 system-ui, sans-serif;
    transition: opacity 220ms ease-out; opacity: 1;
  `;
  // The same word, the same size, the same colour, in the same place as the
  // title screen's.
  //
  // It used to be flat blue with dark letters, and the title screen that came
  // after it was a different colour with different letters — so the handover
  // read as TWO title screens rather than as one screen finishing loading. The
  // only thing that changes now is the bar turning into buttons.
  d.innerHTML = `
    <div style="font:800 min(13vw, 54px)/1 system-ui; letter-spacing:.2em; color:#ffd76a;
                text-shadow:0 3px 0 #b8892b, 0 6px 14px rgba(0,0,0,.28)">BALABOO</div>
    <div class="msg" style="font:600 14px/1.5 system-ui;letter-spacing:.06em;opacity:.8"></div>
    <div style="width:120px;height:5px;border-radius:99px;background:rgba(255,255,255,.16);overflow:hidden">
      <div class="bar" style="width:38%;height:100%;border-radius:99px;background:#ffd76a;
        animation: slide 1.1s ease-in-out infinite"></div>
    </div>
    <style>@keyframes slide { 0%{transform:translateX(-110%)} 100%{transform:translateX(320%)} }</style>
  `;
  document.body.appendChild(d);
  el = d;
  return d;
}

export function showLoading(message: string): void {
  const d = ensure();
  (d.querySelector('.msg') as HTMLElement).textContent = message;
  d.style.display = 'flex';
  d.style.opacity = '1';
}

/** Fades out rather than vanishing: a hard cut from a flat colour to a 3D
 *  scene reads as a flicker, and the fade also covers the first frame or two
 *  while the camera settles onto the character. */
export function hideLoading(): void {
  if (!el) return;
  const d = el;
  d.style.opacity = '0';
  setTimeout(() => { if (d.style.opacity === '0') d.style.display = 'none'; }, 240);
}
