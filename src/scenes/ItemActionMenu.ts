import Phaser from 'phaser';
import { dialogFont } from './../i18n';

// A small contextual ACTION MENU that pops up next to a clicked mailbox/chest item
// (a beige `frame-medium` nine-slice panel + a stack of pixel-font options, the
// primary one tinted blue). The MODAL scene (MailboxScene/ChestScene) renders it
// from a registry model; GameScene owns the model + routes the taps (via the
// per-option SCREEN bounds this returns) — same split as the modals themselves.
const ATLAS = 'inventory';
const FRAME_PANEL = 'frame-medium';
const SCALE = 2;
const BTN = 'square-buttons', GREY = 'grey-button'; // key buttons (9-slice)

export interface MenuOption { label: string; color?: string }
// Menu option text: ONE uniform colour; hover recolours (no per-option colours).
export const MENU_TEXT = '#5b4327';
export const MENU_TEXT_HOVER = '#4aa3df';
export interface ActionMenuModel {
  visible: boolean;
  rev: number;
  x: number; // SCREEN x of the clicked item (the menu / keypad anchors beside it)
  y: number; // SCREEN y
  options?: MenuOption[];
  keypad?: { value: number; max: number }; // when set, render the "How Many?" keypad instead
  slotpick?: { slots: SlotPickSlot[] };    // when set, render the hotbar slot picker instead
}
export interface SlotPickSlot { label: string; iconKey?: string; iconFrame?: string | number }
export interface MenuBound {
  x: number; y: number; w: number; h: number; idx?: number; key?: string;
  bg?: Phaser.GameObjects.GameObject;         // hover tints this (slots / keypad buttons)
  text?: Phaser.GameObjects.Text; base?: string; hoverColor?: string; // OR hover recolours this text (menu options)
}

// Mouse-hover: multiply the bg TEXTURE by this tint (a soft lavender). Tunable.
export const HOVER_TINT = 0xc9b8f0;
export interface HoverTarget {
  x: number; y: number; w: number; h: number;
  bg?: Phaser.GameObjects.GameObject;
  text?: Phaser.GameObjects.Text; base?: string; hoverColor?: string;
}
/** Apply / remove the hover look: tint a bg texture, OR recolour an option's text. */
export function applyHover(t: HoverTarget | null | undefined, on: boolean): void {
  if (!t) return;
  if (t.text?.active) { t.text.setColor(on ? (t.hoverColor ?? MENU_TEXT_HOVER) : (t.base ?? MENU_TEXT)); return; }
  const o = t.bg as (Phaser.GameObjects.GameObject & { active: boolean; setTint?: (c: number) => void; clearTint?: () => void }) | undefined;
  if (!o || !o.active) return;
  if (on) o.setTint?.(HOVER_TINT); else o.clearTint?.();
}

/** Draw the menu into `parent` (a scene-root container at 0,0, so local == screen
 *  coords) and return the per-option hit-boxes in SCREEN space. */
export function renderActionMenu(
  scene: Phaser.Scene,
  parent: Phaser.GameObjects.Container,
  m: ActionMenuModel,
): MenuBound[] {
  const W = scene.scale.width, H = scene.scale.height;
  const PAD = 14, LINE = 32, FS = 21, SIDE = 20, MINW = 108;

  // Build the text objects first so we can measure the widest → panel width. All
  // options share ONE colour; hover recolours the row (no per-option colours).
  const texts = (m.options ?? []).map((o) =>
    scene.add
      .text(0, 0, o.label, { fontFamily: dialogFont(), fontSize: FS + 'px', color: MENU_TEXT })
      .setOrigin(0.5),
  );
  const maxTextW = Math.max(MINW, ...texts.map((t) => t.width));
  const panelW = Math.ceil(maxTextW + SIDE * 2);
  const panelH = PAD * 2 + m.options.length * LINE;

  // Anchor to the RIGHT of the item; flip left if it would overflow; clamp on-screen.
  let left = m.x + 36;
  if (left + panelW > W - 8) left = m.x - 36 - panelW;
  left = Phaser.Math.Clamp(left, 8, Math.max(8, W - panelW - 8));
  let top = m.y - panelH / 2;
  top = Phaser.Math.Clamp(top, 8, Math.max(8, H - panelH - 8));

  // Panel behind (added first), then the option texts on top.
  if (scene.textures.exists(ATLAS)) {
    const panel = scene.add
      .nineslice(left + panelW / 2, top + panelH / 2, ATLAS, FRAME_PANEL, panelW / SCALE, panelH / SCALE, 10, 10, 11, 11)
      .setScale(SCALE);
    parent.add(panel);
  } else {
    const r = scene.add.rectangle(left + panelW / 2, top + panelH / 2, panelW, panelH, 0xf2e2c4).setStrokeStyle(3, 0x5b3a1e);
    parent.add(r);
  }

  const bounds: MenuBound[] = [];
  (m.options ?? []).forEach((_o, i) => {
    const rowCy = top + PAD + i * LINE + LINE / 2;
    texts[i]!.setPosition(left + panelW / 2, rowCy);
    parent.add(texts[i]!);
    // hover recolours the option text (base → hover); no bg.
    bounds.push({ x: left + 10, y: top + PAD + i * LINE, w: panelW - 20, h: LINE, idx: i, text: texts[i], base: MENU_TEXT, hoverColor: MENU_TEXT_HOVER });
  });
  return bounds;
}

/** The "How Many?" numeric keypad (replaces the action menu at the same anchor when
 *  you pick Take / Sell). Digits type a quantity, `<`/`>` step it, OK confirms, X
 *  cancels. Returns per-button SCREEN bounds tagged with a `key` (a digit '0'..'9',
 *  'inc' / 'dec', 'ok', 'cancel') that GameScene routes. */
export function renderKeypad(
  scene: Phaser.Scene,
  parent: Phaser.GameObjects.Container,
  m: { x: number; y: number; value: number; max: number },
): MenuBound[] {
  const W = scene.scale.width, H = scene.scale.height;
  const PAD = 18, GAP = 8, BW = 54, BH = 46, TITLE_H = 34, DISP_H = 50, FS = 22;
  const gridW = 3 * BW + 2 * GAP;
  const panelW = gridW + PAD * 2;
  const panelH = PAD + TITLE_H + DISP_H + GAP + 4 * BH + 3 * GAP + PAD;

  let left = m.x + 36;
  if (left + panelW > W - 8) left = m.x - 36 - panelW;
  left = Phaser.Math.Clamp(left, 8, Math.max(8, W - panelW - 8));
  let top = m.y - panelH / 2;
  top = Phaser.Math.Clamp(top, 8, Math.max(8, H - panelH - 8));

  if (scene.textures.exists(ATLAS)) {
    parent.add(scene.add.nineslice(left + panelW / 2, top + panelH / 2, ATLAS, FRAME_PANEL, panelW / SCALE, panelH / SCALE, 10, 10, 11, 11).setScale(SCALE));
  } else {
    parent.add(scene.add.rectangle(left + panelW / 2, top + panelH / 2, panelW, panelH, 0xf2e2c4).setStrokeStyle(3, 0x5b3a1e));
  }

  const bounds: MenuBound[] = [];
  const T = (x: number, y: number, s: string, color: string, size = FS) =>
    parent.add(scene.add.text(x, y, s, { fontFamily: dialogFont(), fontSize: size + 'px', color, resolution: 3 }).setOrigin(0.5));
  const key = (cx: number, cy: number, w: number, h: number, label: string, k: string) => {
    const bg: Phaser.GameObjects.GameObject = (scene.textures.exists(BTN) && scene.textures.get(BTN).has(GREY))
      ? scene.add.nineslice(cx, cy, BTN, GREY, w, h, 6, 6, 6, 6)
      : scene.add.rectangle(cx, cy, w, h, 0xd8c39a).setStrokeStyle(2, 0x5b3a1e);
    parent.add(bg);
    T(cx, cy, label, '#7a5a34');
    bounds.push({ x: cx - w / 2, y: cy - h / 2, w, h, key: k, bg }); // bg tinted on hover
  };

  T(left + panelW / 2, top + PAD + TITLE_H / 2, 'How Many?', '#5b4327');

  // Display row: `<`  [ value ]  `>`
  const dispY = top + PAD + TITLE_H + DISP_H / 2;
  const aw = BW * 0.72;
  key(left + PAD + aw / 2, dispY, aw, DISP_H, '<', 'dec');
  key(left + panelW - PAD - aw / 2, dispY, aw, DISP_H, '>', 'inc');
  const dispL = left + PAD + aw + GAP, dispR = left + panelW - PAD - aw - GAP;
  if (scene.textures.exists(BTN) && scene.textures.get(BTN).has(GREY)) {
    parent.add(scene.add.nineslice((dispL + dispR) / 2, dispY, BTN, GREY, dispR - dispL, DISP_H, 6, 6, 6, 6));
  }
  parent.add(scene.add.text(dispR - 12, dispY, String(m.value), { fontFamily: dialogFont(), fontSize: (FS + 6) + 'px', color: '#5b4327', resolution: 3 }).setOrigin(1, 0.5));

  // Grid: 1..9, then OK / 0 / X.
  const gx0 = left + PAD + BW / 2;
  const gy0 = top + PAD + TITLE_H + DISP_H + GAP + BH / 2;
  const labels = [['1', '2', '3'], ['4', '5', '6'], ['7', '8', '9'], ['OK', '0', 'X']];
  const keys = [['1', '2', '3'], ['4', '5', '6'], ['7', '8', '9'], ['ok', '0', 'cancel']];
  for (let r = 0; r < 4; r++) for (let col = 0; col < 3; col++) {
    key(gx0 + col * (BW + GAP), gy0 + r * (BH + GAP), BW, BH, labels[r]![col]!, keys[r]![col]!);
  }
  return bounds;
}

/** The "To Hotbar" slot picker: a titled grid of the hotbar slots (number + current
 *  item icon so you see what you'd replace) + a Cancel. Each slot button is tagged
 *  key 'slot<i>' (Cancel = 'cancel'). Placed beside the item like the keypad. */
export function renderSlotPicker(
  scene: Phaser.Scene,
  parent: Phaser.GameObjects.Container,
  m: { x: number; y: number; slots: SlotPickSlot[] },
): MenuBound[] {
  const W = scene.scale.width, H = scene.scale.height;
  const PAD = 16, GAP = 8, BW = 58, BH = 58, TITLE_H = 32, FS = 20, COLS = 4;
  const rows = Math.max(1, Math.ceil(m.slots.length / COLS));
  const gridW = COLS * BW + (COLS - 1) * GAP;
  const panelW = gridW + PAD * 2;
  const panelH = PAD + TITLE_H + rows * BH + (rows - 1) * GAP + PAD; // no Cancel (tap-away / close button dismiss)

  let left = m.x + 36;
  if (left + panelW > W - 8) left = m.x - 36 - panelW;
  left = Phaser.Math.Clamp(left, 8, Math.max(8, W - panelW - 8));
  let top = m.y - panelH / 2;
  top = Phaser.Math.Clamp(top, 8, Math.max(8, H - panelH - 8));

  if (scene.textures.exists(ATLAS)) {
    parent.add(scene.add.nineslice(left + panelW / 2, top + panelH / 2, ATLAS, FRAME_PANEL, panelW / SCALE, panelH / SCALE, 10, 10, 11, 11).setScale(SCALE));
  } else {
    parent.add(scene.add.rectangle(left + panelW / 2, top + panelH / 2, panelW, panelH, 0xf2e2c4).setStrokeStyle(3, 0x5b3a1e));
  }
  parent.add(scene.add.text(left + panelW / 2, top + PAD + TITLE_H / 2, 'To Hotbar', { fontFamily: dialogFont(), fontSize: FS + 'px', color: '#5b4327', resolution: 3 }).setOrigin(0.5));

  const bounds: MenuBound[] = [];
  const gx0 = left + PAD + BW / 2;
  const gy0 = top + PAD + TITLE_H + BH / 2;
  m.slots.forEach((s, i) => {
    const col = i % COLS, row = Math.floor(i / COLS);
    const cx = gx0 + col * (BW + GAP), cy = gy0 + row * (BH + GAP);
    const bg: Phaser.GameObjects.GameObject = (scene.textures.exists(BTN) && scene.textures.get(BTN).has(GREY))
      ? scene.add.nineslice(cx, cy, BTN, GREY, BW, BH, 6, 6, 6, 6)
      : scene.add.rectangle(cx, cy, BW, BH, 0xd8c39a).setStrokeStyle(2, 0x5b3a1e);
    parent.add(bg);
    if (s.iconKey && scene.textures.exists(s.iconKey)) {
      const icon = scene.add.image(cx, cy + 4, s.iconKey, s.iconFrame);
      icon.setScale((BW * 0.52) / Math.max(icon.width, icon.height));
      parent.add(icon);
    }
    parent.add(scene.add.text(cx - BW / 2 + 5, cy - BH / 2 + 3, s.label, { fontFamily: dialogFont(), fontSize: '13px', color: '#5b4327', resolution: 3 }).setOrigin(0, 0));
    bounds.push({ x: cx - BW / 2, y: cy - BH / 2, w: BW, h: BH, key: 'slot' + i, bg });
  });
  return bounds;
}
