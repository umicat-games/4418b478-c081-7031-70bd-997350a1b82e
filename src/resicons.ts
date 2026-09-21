import * as THREE from 'three';
import { loadModelAsset, type Manifest3D } from '@umicat/three-sdk';
import { createThumbMaker } from './thumbs';
import { setPhotoIcon, hasPhotoIcon, type IconName } from './icons';

/**
 * Gold, wood and stone, photographed from the things they are.
 *
 * The rest of the icon set is white silhouettes from Kenney's Board Game Icons,
 * which is right for the action buttons: a button has to read at a glance, at
 * one colour, over whatever the camera is pointing at. It is wrong for the
 * materials. Those are not actions, they are THINGS you are carrying, and a
 * white outline of a coin is a worse picture of a coin than a coin is.
 *
 * Rendered from the game's own models rather than drawn, so they cannot drift
 * from the coin you actually pick up, and so they are in the game's palette
 * without anyone matching colours by eye.
 */

/** Which model stands for which material, and how to frame it.
 *
 *  Only the coin comes from a model. The kits have no picture of "wood" or
 *  "stone" that survives being sixteen pixels across: `td-rocks` is a flat
 *  scatter that reads as a pale smudge from the catalogue camera, and
 *  `td-detail-rocks-large` is MOSSY — bright green, which is a fine boulder at
 *  the edge of a board and a nonsense icon for stone. The kit trees and crates
 *  read as scenery and cargo rather than as timber.
 *
 *  So those two are built here: a few solids in the game's palette, shaped to
 *  be legible small, which is the one thing an icon has to be. */
const FROM: { icon: IconName; model?: string; build?: () => THREE.Object3D }[] = [
  { icon: 'coin', model: 'td-coin' },
  { icon: 'wood', build: logs },
  { icon: 'stone', build: blocks },
];

/** Cut stone: three blocks, stacked. Flat-topped and angular so it cannot be
 *  read as the logs beside it at a glance, which is the actual risk — at this
 *  size a shape is a silhouette with colour on it. */
function blocks(): THREE.Object3D {
  const g = new THREE.Object3D();
  const rock = new THREE.MeshStandardMaterial({ color: 0x9aa4ad, roughness: 1, flatShading: true });
  const top = new THREE.MeshStandardMaterial({ color: 0xb9c2c9, roughness: 1, flatShading: true });
  for (const [x, y, z, s] of [
    [-0.3, 0, 0.05, 0.5], [0.32, 0, -0.05, 0.44], [0.02, 0.42, 0, 0.42],
  ] as const) {
    const b = new THREE.Mesh(new THREE.BoxGeometry(s * 1.5, s, s * 1.2), [
      rock, rock, top, rock, rock, rock,
    ]);
    b.position.set(x, y, z);
    b.rotation.y = (x + z) * 1.7;
    g.add(b);
  }
  return g;
}

/** Two cut logs, end-on, the way a woodpile reads from across a clearing. */
function logs(): THREE.Object3D {
  const g = new THREE.Object3D();
  const bark = new THREE.MeshStandardMaterial({ color: 0x8a5a2b, roughness: 0.9 });
  const cut = new THREE.MeshStandardMaterial({ color: 0xd9a566, roughness: 0.8 });
  for (const [x, y, z] of [[-0.26, 0, 0], [0.26, 0, 0], [0, 0.45, 0]] as const) {
    // The cut faces are their own material, because a log is a brown cylinder
    // until you can see that it has been sawn.
    const log = new THREE.Mesh(
      new THREE.CylinderGeometry(0.25, 0.25, 0.9, 14, 1, false),
      [bark, cut, cut],
    );
    log.rotation.z = Math.PI / 2;
    log.position.set(x, y, z);
    g.add(log);
  }
  return g;
}

/**
 * Make them, once per session.
 *
 * Idempotent: the hub and the boards both call it, and whichever runs first
 * pays. Failing is not fatal — the silhouettes are still there underneath, and
 * a HUD that will not draw because an ICON did not render is a worse trade than
 * a monochrome coin.
 */
export async function makeResourceIcons(
  renderer: THREE.WebGLRenderer, manifest: Manifest3D,
): Promise<void> {
  if (FROM.every((f) => hasPhotoIcon(f.icon))) return;
  const thumbs = createThumbMaker(renderer);
  try {
    for (const f of FROM) {
      if (hasPhotoIcon(f.icon)) continue;
      try {
        const obj = f.build
          ? f.build()
          : (await loadModelAsset(manifest, f.model!, { assetBase: '' })).object;
        obj.traverse((o) => { o.visible = true; });
        setPhotoIcon(f.icon, thumbs.make(obj));
      } catch (err) {
        console.warn(`[icons] no photo for ${f.icon}`, err);
      }
    }
  } finally {
    thumbs.dispose();
  }
}
