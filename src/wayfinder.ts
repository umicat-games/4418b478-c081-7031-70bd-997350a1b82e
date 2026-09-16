import * as THREE from 'three';

/**
 * A trail of chevrons on the ground, from where you are to where to go.
 *
 * A new player spawns in the village and nothing tells them the gate is the
 * thing. An arrow floating over the hero would say WHICH WAY and nothing else;
 * a trail laid along the ground says which way and HOW FAR, and it is read
 * without being looked at — you follow it the way you follow a path.
 *
 * It is drawn from the hero's actual position every frame rather than baked as
 * a route, because it has to survive the player wandering off. There is no
 * pathfinding in it: the village is open ground with a wall around it, so a
 * straight line at the gate is the route.
 */

/** Far enough back that it is not under the hero's feet. */
const START = 1.25;
/** How long the trail is, at most. Shortened when the target is nearer. */
const SPAN = 4.2;
const COUNT = 5;
/** How close counts as arrived. Past this the trail would be pointing at
 *  something already filling the screen. */
const STOP = 2.2;
const SCROLL_MS = 1150;

/** One chevron, pointing +Z, lying flat. Rotating the shape by +90 degrees
 *  about X maps its +Y to +Z; the face normal ends up pointing down, hence
 *  `DoubleSide` rather than a second rotation to fix it. */
function chevron(w: number, front: number, back: number, thick: number): THREE.BufferGeometry {
  const s = new THREE.Shape();
  s.moveTo(-w, -back);
  s.lineTo(0, front);
  s.lineTo(w, -back);
  s.lineTo(w, -back - thick);
  s.lineTo(0, front - thick);
  s.lineTo(-w, -back - thick);
  s.closePath();
  return new THREE.ShapeGeometry(s).rotateX(Math.PI / 2);
}

export interface Wayfinder {
  /** Redraw for this frame. `null` target hides it. */
  update(fromX: number, fromZ: number, target: { x: number; z: number } | null, nowMs: number): void;
  /** Whether anything is actually on screen, for probes and for callers that
   *  want to know whether the player is being told anything. */
  showing(): boolean;
  dispose(): void;
}

/** What colour the trail is.
 *
 *  The village's is white: it is the only thing pointing at anything there, so
 *  it only has to be legible. The tutorial's is the same cyan as its rings —
 *  the trail, the ring on the ground and the ring on the button are ONE
 *  instruction, and three colours make them three things that happen to be on
 *  screen together. */
export interface WayfinderOpts { color?: number }

export function createWayfinder(scene: THREE.Scene, opts: WayfinderOpts = {}): Wayfinder {
  // Two shapes, one inside the other: a dark chevron with a white one on top
  // of it. White alone is legible on grass in a screenshot and much less so on
  // a phone outdoors, and this village is almost entirely bright green — the
  // dark edge is what makes the trail read without being looked at.
  const edge = chevron(0.40, 0.21, 0.19, 0.30);
  const face = chevron(0.34, 0.16, 0.15, 0.23);
  const group = new THREE.Group();
  // Named so a probe can ask where the chevrons actually ARE. "Is the trail on"
  // is a flag; "does it lie between the player and the gate" is the question.
  group.name = 'wayfinder';
  group.visible = false;
  scene.add(group);
  const marks: { at: THREE.Group; mats: THREE.MeshBasicMaterial[] }[] = [];
  for (let i = 0; i < COUNT; i++) {
    // Materials EACH, because the chevrons fade independently at the two ends
    // of the trail — one shared material would fade all five together and the
    // trail would blink rather than flow.
    const at = new THREE.Group();
    const mats: THREE.MeshBasicMaterial[] = [];
    for (const [geo, color, y, order] of [
      [edge, 0x10242c, 0.03, 5], [face, opts.color ?? 0xffffff, 0.04, 6],
    ] as const) {
      const mat = new THREE.MeshBasicMaterial({
        color, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide,
      });
      const m = new THREE.Mesh(geo, mat);
      m.position.y = y;
      m.renderOrder = order;
      at.add(m);
      mats.push(mat);
    }
    marks.push({ at, mats });
    group.add(at);
  }

  /** In at the near end, out at the far one, so the chevron that wraps from the
   *  front of the queue to the back does not pop. */
  const fade = (k: number): number => Math.min(1, k / 0.18, (1 - k) / 0.22);

  return {
    update(fromX, fromZ, target, nowMs) {
      const dx = target ? target.x - fromX : 0;
      const dz = target ? target.z - fromZ : 0;
      const dist = Math.hypot(dx, dz);
      if (!target || dist < STOP) { group.visible = false; return; }
      group.visible = true;
      const yaw = Math.atan2(dx, dz);
      // Stop short of the target, and shorten rather than overshoot when it is
      // close: a trail that runs past what it is pointing at reads as pointing
      // at something further away.
      const span = Math.min(SPAN, Math.max(0.9, dist - START - 0.7));
      const t = (nowMs / SCROLL_MS) % 1;
      for (let i = 0; i < COUNT; i++) {
        const k = ((i + t) % COUNT) / COUNT;
        const s = START + k * span;
        const m = marks[i];
        m.at.position.set(fromX + (dx / dist) * s, 0, fromZ + (dz / dist) * s);
        m.at.rotation.y = yaw;
        const a = fade(k);
        m.mats[0].opacity = 0.42 * a;
        m.mats[1].opacity = 0.95 * a;
      }
    },
    showing: () => group.visible,
    dispose() {
      scene.remove(group);
      edge.dispose();
      face.dispose();
      for (const m of marks) for (const mat of m.mats) mat.dispose();
    },
  };
}
