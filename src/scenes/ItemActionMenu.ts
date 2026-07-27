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

export interface MenuOption { label: string; color: string }
export interface ActionMenuModel {
  visible: boolean;
  rev: number;
  x: number; // SCREEN x of the clicked item (the menu anchors beside it)
  y: number; // SCREEN y
  options: MenuOption[];
}
export interface MenuBound { x: number; y: number; w: number; h: number; idx: number }

/** Draw the menu into `parent` (a scene-root container at 0,0, so local == screen
 *  coords) and return the per-option hit-boxes in SCREEN space. */
export function renderActionMenu(
  scene: Phaser.Scene,
  parent: Phaser.GameObjects.Container,
  m: ActionMenuModel,
): MenuBound[] {
  const W = scene.scale.width, H = scene.scale.height;
  const PAD = 14, LINE = 32, FS = 21, SIDE = 20, MINW = 108;

  // Build the text objects first so we can measure the widest → panel width.
  const texts = m.options.map((o) =>
    scene.add
      .text(0, 0, o.label, { fontFamily: dialogFont(), fontSize: FS + 'px', color: o.color })
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
  m.options.forEach((_o, i) => {
    const rowCy = top + PAD + i * LINE + LINE / 2;
    texts[i].setPosition(left + panelW / 2, rowCy);
    parent.add(texts[i]);
    bounds.push({ x: left + 10, y: top + PAD + i * LINE, w: panelW - 20, h: LINE, idx: i });
  });
  return bounds;
}
