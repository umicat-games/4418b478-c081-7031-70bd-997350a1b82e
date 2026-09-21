import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Scene3D, Manifest3D } from '@umicat/three-sdk';

/**
 * Fold everything that never moves into a handful of meshes.
 *
 * A board is a tile per cell, a road, scenery, and — since the walls became a
 * forest — about four hundred trees. That is eleven hundred objects and eleven
 * hundred draw calls for a picture that never changes. A desktop does not
 * notice; a phone very much does.
 *
 * Three groups, differing only in what they do with light:
 *
 *  - the board receives shadows and casts none (flat ground casting onto flat
 *    ground draws nothing anyone can see)
 *  - scenery inside the play area does both
 *  - the forest does NEITHER. It stands outside the board, nobody looks at its
 *    shadows, and receiving costs shader work on every pixel of four hundred
 *    trees. Keeping it out of the shadow pass is most of what makes it free.
 *
 * Colliders survive all of this: a collider is a rigid body in the physics
 * world keyed by entity id, and taking the mesh out of the scene does not touch
 * it. That is what lets the trees stop you while costing one draw between them.
 */

/** What each name is, for the three groups. Anything unlisted is left alone —
 *  which is how the markers, the doors, the town buildings and anything else
 *  that is shown, hidden or moved at runtime keeps being its own object. */
const FLAT = new Set(['ground_tile', 'grass', 'river', 'bridge']);
const CASTS = new Set([
  'scenery', 'prop',
  // The hub's furniture. The name in blocks is a HUNDRED AND FOUR little cubes
  // — on its own it was two thirds of the hub's draw calls.
  'title', 'plot', 'plot_sign', 'plot_lantern', 'door_frame', 'door_sign',
  'decor', 'village_wall',
]);
// `pedestal` is NOT in that list, and the omission is load-bearing. The rack
// only shows the weapons you have made plus the next one, which means plinths
// that appear one at a time — and an entity folded into a merged mesh has no
// visibility of its own left to turn off. Five cylinders is five draw calls at
// the very most, and only once the whole rack is full.
const OUTSIDE = new Set(['forest', 'forest_ground', 'ground_skirt']);
/** The far rings, merged on their own so they can be switched off together. */
const FAR = new Set(['forest_far']);
/** Names that get a mesh of their OWN, named after them, instead of being
 *  folded in with everything that looks like them.
 *
 *  The village changes size: there is a wall set per size and only one of them
 *  is up, and the trees standing on land that can still be bought vanish when
 *  it is. A merged entity has no visibility of its own left to turn off, so the
 *  thing that has to be switchable is the MESH — which means it has to be the
 *  only thing in it. Shadow behaviour follows the group it would have joined:
 *  walls cast, trees do not.
 *
 *  Colliders are untouched by any of this — a collider is a body keyed by
 *  entity id, so the hub still enables the five that belong to the wall it is
 *  showing.
 *
 *  Matched by PREFIX, not by a list of names. The number of wall sets and of
 *  clearable tree rings is decided by the scene generator, and a hardcoded list
 *  here would quietly fold a new one in with the permanent forest — visible
 *  only as a ring of trees standing inside your own wall.
 *
 *  @returns whether the mesh casts and receives shadows, or undefined if the
 *  name is not one that gets a mesh to itself. */
const ownMesh = (name: string): boolean | undefined => {
  if (/^wall_\d+_/.test(name)) return true;
  if (/^forest_claim_\d+$/.test(name)) return false;
  return undefined;
};

export interface MergeResult {
  /** How many objects went in, and how many meshes came out. */
  folded: number;
  meshes: number;
}

export function mergeStatic(
  world: { scene: THREE.Scene; entities: Map<string, THREE.Object3D> },
  scene3d: Scene3D,
  manifest: Manifest3D,
): MergeResult {
  // Which kit each entity's model came out of.
  //
  // Every model in a kit points at the same colormap, but each GLB embeds its
  // own copy — so the loaded textures are distinct objects wrapping identical
  // pixels, with no URL to compare and an ImageBitmap for an image. Merging by
  // material, by texture uuid, or by image source all give the same answer: one
  // mesh per source FILE, which was nineteen of them. The kit directory is the
  // thing that actually says "these look the same", and it is in the manifest.
  const kitOf = new Map<string, string>();
  {
    const dirOfModel = new Map<string, string>();
    for (const m of manifest.models ?? []) {
      dirOfModel.set(m.id, (m.path ?? '').split('/').slice(0, -1).join('/'));
    }
    for (const e of scene3d.entities ?? []) {
      if (e.modelAssetId) kitOf.set(e.id, dirOfModel.get(e.modelAssetId) ?? e.modelAssetId);
    }
  }

  const groups: { objs: THREE.Object3D[]; cast: boolean; receive: boolean; name: string }[] = [
    { objs: [], cast: false, receive: true, name: 'board' },
    { objs: [], cast: true, receive: true, name: 'board_props' },
    { objs: [], cast: false, receive: false, name: 'forest' },
    { objs: [], cast: false, receive: false, name: 'forest_far' },
  ];
  /** Look up (or start) the private group for a name that gets its own mesh. */
  const ownGroup = (name: string, casts: boolean): typeof groups[number] => {
    let g = groups.find((x) => x.name === name);
    if (!g) { g = { objs: [], cast: casts, receive: casts, name }; groups.push(g); }
    return g;
  };
  for (const [id, obj] of world.entities) {
    const own = ownMesh(obj.name);
    if (own !== undefined) ownGroup(obj.name, own).objs.push(obj);
    else if (CASTS.has(obj.name)) groups[1].objs.push(obj);
    else if (FAR.has(obj.name)) groups[3].objs.push(obj);
    else if (OUTSIDE.has(obj.name)) groups[2].objs.push(obj);
    else if (FLAT.has(obj.name) || id.startsWith('path_')) groups[0].objs.push(obj);
  }

  let folded = 0;
  let meshes = 0;
  for (const group of groups) {
    const byLook = new Map<string, { mat: THREE.Material; geos: THREE.BufferGeometry[] }>();
    for (const obj of group.objs) {
      obj.updateWorldMatrix(true, true);
      const kit = kitOf.get(obj.userData.entityId as string);
      obj.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (!mesh.isMesh) return;
        const mat = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
        const std = mat as THREE.MeshStandardMaterial;
        const key = kit
          ? `${kit}|${std.color?.getHexString() ?? ''}|${std.transparent ? 1 : 0}`
          // A primitive box has no model and no texture; its colour is all it is.
          : `primitive|${std.color?.getHexString() ?? mat.uuid}`;
        // Bake the world transform into the vertices — after merging there is
        // one object, so the individual transforms have nowhere left to live.
        const g = mesh.geometry.clone();
        g.applyMatrix4(mesh.matrixWorld);
        // Merging requires identical attribute sets; drop anything unshared
        // rather than letting `mergeGeometries` return null and silently lose
        // the entire board.
        for (const name of Object.keys(g.attributes)) {
          if (!['position', 'normal', 'uv'].includes(name)) g.deleteAttribute(name);
        }
        const slot = byLook.get(key) ?? { mat, geos: [] };
        slot.geos.push(g);
        byLook.set(key, slot);
      });
    }
    const own = ownMesh(group.name) !== undefined;
    let mergedHere = 0;
    for (const { mat, geos } of byLook.values()) {
      const combined = mergeGeometries(geos, false);
      if (!combined) continue;      // mismatched attributes: leave those alone
      // A mesh that gets switched, faded or tinted on its own needs a material
      // of its own. `byLook` keys on how a thing LOOKS, so every wall in the
      // village — all three rings, all five sides — arrives here pointing at
      // one material object, and fading one side would fade the lot.
      const mesh = new THREE.Mesh(combined, own ? mat.clone() : mat);
      // Named, because after this the individual pieces are gone and this is
      // the only thing left that knows where the board is.
      mesh.name = group.name;
      mesh.castShadow = group.cast;
      mesh.receiveShadow = group.receive;
      mesh.matrixAutoUpdate = false;
      world.scene.add(mesh);
      mergedHere += geos.length;
      meshes += 1;
      for (const g of geos) g.dispose();
    }
    if (mergedHere > 0) {
      folded += group.objs.length;
      for (const obj of group.objs) {
        obj.removeFromParent();
        world.entities.delete(obj.userData.entityId as string);
      }
    }
  }
  return { folded, meshes };
}
