/**
 * The plate the readout sits on.
 *
 * White text on a white cloud is not text. The HUD had a shadow, which is
 * enough over grass and snow and nothing like enough over the clouds that
 * arrived in the sky — the whole top-left corner went unreadable at certain
 * camera angles, and that corner is where the lives, the gold and the wave are.
 *
 * Shared by the hub and the levels, because the hub's purse is the same white
 * text in the same corner over the same sky, and two copies of a colour is two
 * colours eventually.
 */
/** `fit-content`, so it is the width of the numbers rather than of the HUD's
 *  80vw. No `backdrop-filter`: this game is drawn on phones, and a blur is a
 *  read-modify-write of every pixel under it. A darker plate costs nothing and
 *  does the same job. */
export function readoutPlate(...rows: HTMLElement[]): HTMLDivElement {
  const el = document.createElement('div');
  el.style.cssText = `background: rgba(10,14,20,.46); border-radius: 14px;
    padding: 7px 13px 8px; width: fit-content; max-width: 100%;
    box-shadow: inset 0 0 0 1.5px rgba(255,255,255,.34);`;
  el.append(...rows);
  return el;
}
